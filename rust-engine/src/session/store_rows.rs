//! What a durable session keeps in its SQLite file and reads when it needs it, and the seals that let it trust what it
//! has already validated.
//!
//! A long construction can hold many large revisions. A durable store validates a revision when it is written or
//! when an unsealed store is first opened, and then seals it. A seal records the sha256 of the row's exact bytes, the
//! revision's header (what a lineage walk needs without rebuilding the revision) and its parent's seal, so each seal
//! stands for its revision's whole validated ancestry. Opening checks the seals and validates only what is unsealed;
//! a row read later is checked against its seal before it is used. Validating every revision again is an explicit
//! audit. The session holds the headers of every revision, the rows it has not yet written, and caches of what it read.

use crate::model::narrative::{
    MaterializedNarrative, NarrativeGraphRevision, NarrativeGraphSource, NarrativeSourceSnapshot,
    StoredNarrativeRevision,
};
use crate::{error, hash_serializable, EngineResult};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub const SEAL_SCHEMA: &str = "life-sim-rust-revision-seal/v1";

/// Rows read from the file that stay in memory while they fit. A model row is a revision's changes from the one before
/// (about 40 KB on the world history), so rebuilding a head from its first revision reads every row of its lineage once.
pub const MODEL_ROWS_CACHED_BYTES: usize = 128 * 1024 * 1024;
pub const NARRATIVE_ROWS_CACHED_BYTES: usize = 64 * 1024 * 1024;
pub const SNAPSHOTS_CACHED_BYTES: usize = 32 * 1024 * 1024;
/// Graph revisions kept materialized besides the heads of every graph. They share unchanged records with each other.
pub const MATERIALIZED_KEPT: usize = 64;
pub const MATERIALIZED_HEADS_CACHED_BYTES: usize = 64 * 1024 * 1024;
pub const MATERIALIZED_RECENT_CACHED_BYTES: usize = 64 * 1024 * 1024;

pub fn sha256_hex(bytes: &[u8]) -> String {
    crate::hex_digest(Sha256::digest(bytes))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SealKind {
    Model,
    Narrative,
}

impl SealKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SealKind::Model => "model",
            SealKind::Narrative => "narrative",
        }
    }
}

/// What a lineage walk or a replay of the revision chain needs of a model revision, without rebuilding it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelHeader {
    pub id: String,
    pub revision_number: u64,
    pub previous_model_hash: Option<String>,
    pub reason: String,
    pub provenance: Vec<String>,
}

/// A graph revision's record without its roots, nodes and edges.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NarrativeHeader {
    pub schema: String,
    pub operation_sequence: u64,
    pub record_hash: String,
    pub graph_hash: String,
    pub snapshot_hash: String,
    pub graph_schema: String,
    pub graph_id: String,
    pub revision: NarrativeGraphRevision,
    pub source: NarrativeGraphSource,
}

impl From<&StoredNarrativeRevision> for NarrativeHeader {
    fn from(record: &StoredNarrativeRevision) -> Self {
        Self {
            schema: record.schema.clone(),
            operation_sequence: record.operation_sequence,
            record_hash: record.record_hash.clone(),
            graph_hash: record.graph_hash.clone(),
            snapshot_hash: record.snapshot_hash.clone(),
            graph_schema: record.graph_schema.clone(),
            graph_id: record.graph_id.clone(),
            revision: record.revision.clone(),
            source: record.source.clone(),
        }
    }
}

impl crate::model::narrative::RevisionFields for NarrativeHeader {
    fn graph_schema(&self) -> &str {
        &self.graph_schema
    }
    fn graph_id(&self) -> &str {
        &self.graph_id
    }
    fn revision(&self) -> &NarrativeGraphRevision {
        &self.revision
    }
    fn source(&self) -> &NarrativeGraphSource {
        &self.source
    }
}

/// A seal as the file keeps it.
#[derive(Debug, Clone, PartialEq)]
pub struct Seal {
    pub kind: SealKind,
    pub object_hash: String,
    pub row_sha256: String,
    pub row_bytes: u64,
    pub header_json: Vec<u8>,
    pub parent_seal: Option<String>,
    pub seal_sha256: String,
}

#[derive(Serialize)]
struct SealContent<'a> {
    schema: &'a str,
    kind: SealKind,
    object_hash: &'a str,
    row_sha256: &'a str,
    row_bytes: u64,
    header_sha256: String,
    parent_seal: Option<&'a str>,
}

impl Seal {
    pub fn new(
        kind: SealKind,
        object_hash: &str,
        row: &[u8],
        header: &impl Serialize,
        parent_seal: Option<String>,
    ) -> EngineResult<Self> {
        let header_json = serde_json::to_vec(header)
            .map_err(|cause| error(format!("failed to encode a seal header: {cause}")))?;
        let mut seal = Self {
            kind,
            object_hash: object_hash.to_owned(),
            row_sha256: sha256_hex(row),
            row_bytes: row.len() as u64,
            header_json,
            parent_seal,
            seal_sha256: String::new(),
        };
        seal.seal_sha256 = seal.computed_hash()?;
        Ok(seal)
    }

    /// A seal for a row whose bytes were digested as they were read.
    pub fn from_digest(
        kind: SealKind,
        object_hash: &str,
        row_sha256: String,
        row_bytes: u64,
        header: &impl Serialize,
        parent_seal: Option<String>,
    ) -> EngineResult<Self> {
        let header_json = serde_json::to_vec(header)
            .map_err(|cause| error(format!("failed to encode a seal header: {cause}")))?;
        let mut seal = Self {
            kind,
            object_hash: object_hash.to_owned(),
            row_sha256,
            row_bytes,
            header_json,
            parent_seal,
            seal_sha256: String::new(),
        };
        seal.seal_sha256 = seal.computed_hash()?;
        Ok(seal)
    }

    pub fn computed_hash(&self) -> EngineResult<String> {
        hash_serializable(&SealContent {
            schema: SEAL_SCHEMA,
            kind: self.kind,
            object_hash: &self.object_hash,
            row_sha256: &self.row_sha256,
            row_bytes: self.row_bytes,
            header_sha256: sha256_hex(&self.header_json),
            parent_seal: self.parent_seal.as_deref(),
        })
    }

    /// Whether the seal is whole: its hash covers its fields as they are.
    pub fn is_intact(&self) -> bool {
        self.computed_hash()
            .is_ok_and(|hash| hash == self.seal_sha256)
    }

    pub fn header<T: for<'de> Deserialize<'de>>(&self) -> EngineResult<T> {
        serde_json::from_slice(&self.header_json).map_err(|cause| {
            error(format!(
                "seal of {} {} has an unreadable header: {cause}",
                self.kind.as_str(),
                self.object_hash
            ))
        })
    }
}

/// What a sealed row read from the file must be: its exact bytes' digest, and the seal it carries for its children.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealRef {
    pub row_sha256: String,
    pub seal_sha256: String,
}

impl From<&Seal> for SealRef {
    fn from(seal: &Seal) -> Self {
        Self {
            row_sha256: seal.row_sha256.clone(),
            seal_sha256: seal.seal_sha256.clone(),
        }
    }
}

/// Checks that a row read from the file is the one that was sealed.
pub fn check_row(
    kind: SealKind,
    object_hash: &str,
    row: &[u8],
    seal: &SealRef,
) -> EngineResult<()> {
    if sha256_hex(row) != seal.row_sha256 {
        return Err(error(format!(
            "stored {} {object_hash} no longer matches its seal; the state file changed after it was validated. Run audit_store to find what changed.",
            kind.as_str()
        )));
    }
    Ok(())
}

/// One read connection to the state file, opened when it is first needed.
pub struct StoreReader {
    path: PathBuf,
    connection: Mutex<Option<Connection>>,
}

impl std::fmt::Debug for StoreReader {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoreReader")
            .field("path", &self.path)
            .finish()
    }
}

impl StoreReader {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            connection: Mutex::new(None),
        }
    }

    fn with_connection<T>(
        &self,
        label: &str,
        read: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> EngineResult<T> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| error("the state file reader is unavailable"))?;
        if guard.is_none() {
            // Never creates the file: a session reads only the store it opened.
            let connection = Connection::open_with_flags(
                &self.path,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|cause| {
                error(format!(
                    "failed to reopen the state file {} to read {label}: {cause}",
                    self.path.display()
                ))
            })?;
            connection
                .busy_timeout(std::time::Duration::from_secs(30))
                .map_err(|cause| {
                    error(format!(
                        "failed to configure the state file reader: {cause}"
                    ))
                })?;
            *guard = Some(connection);
        }
        let connection = guard
            .as_ref()
            .expect("the reader connection was just opened");
        read(connection).map_err(|cause| {
            error(format!(
                "failed to read {label} from the state file: {cause}"
            ))
        })
    }

    pub fn model_row(&self, model_hash: &str) -> EngineResult<Option<(Vec<u8>, Option<String>)>> {
        self.with_connection("a model revision", |connection| {
            connection
                .query_row(
                    "SELECT definition_json, base_model_hash FROM models WHERE model_hash = ?1",
                    [model_hash],
                    |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
        })
    }

    pub fn narrative_row(&self, graph_hash: &str) -> EngineResult<Option<Vec<u8>>> {
        self.with_connection("a graph revision", |connection| {
            connection
                .query_row(
                    "SELECT revision_json FROM narrative_revisions WHERE graph_hash = ?1",
                    [graph_hash],
                    |row| row.get(0),
                )
                .optional()
        })
    }

    pub fn snapshot_row(&self, snapshot_hash: &str) -> EngineResult<Option<Vec<u8>>> {
        self.with_connection("a source snapshot", |connection| {
            connection
                .query_row(
                    "SELECT snapshot_json FROM narrative_source_snapshots WHERE snapshot_hash = ?1",
                    [snapshot_hash],
                    |row| row.get(0),
                )
                .optional()
        })
    }
}

/// Values kept by key while they fit a budget, the least recently used dropped first. The value just added is always
/// kept, however large.
#[derive(Debug)]
pub struct Lru<T> {
    values: BTreeMap<String, (T, usize, u64)>,
    order: BTreeMap<u64, String>,
    size: usize,
    budget: usize,
    clock: u64,
}

impl<T: Clone> Lru<T> {
    pub fn new(budget: usize) -> Self {
        Self {
            values: BTreeMap::new(),
            order: BTreeMap::new(),
            size: 0,
            budget,
            clock: 0,
        }
    }

    pub fn get(&mut self, key: &str) -> Option<T> {
        self.clock += 1;
        let clock = self.clock;
        let (value, _, used) = self.values.get_mut(key)?;
        self.order.remove(used);
        *used = clock;
        self.order.insert(clock, key.to_owned());
        Some(value.clone())
    }

    pub fn insert(&mut self, key: String, value: T, size: usize) {
        self.remove(&key);
        self.clock += 1;
        self.order.insert(self.clock, key.clone());
        self.values.insert(key.clone(), (value, size, self.clock));
        self.size = self.size.saturating_add(size);
        while self.size > self.budget && self.values.len() > 1 {
            let Some((&oldest, _)) = self.order.iter().next() else {
                break;
            };
            let victim = self.order.remove(&oldest).expect("an ordered key is held");
            if victim == key {
                self.order.insert(oldest, victim);
                break;
            }
            if let Some((_, size, _)) = self.values.remove(&victim) {
                self.size -= size;
            }
        }
    }

    pub fn remove(&mut self, key: &str) -> Option<T> {
        let (value, size, used) = self.values.remove(key)?;
        self.order.remove(&used);
        self.size -= size;
        Some(value)
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn len(&self) -> usize {
        self.values.len()
    }

    fn remove_oldest(&mut self) {
        if let Some(key) = self.order.values().next().cloned() {
            self.remove(&key);
        }
    }
}

/// One kind of row: those held in memory because the file does not have them yet (or there is no file), and those read
/// from the file and cached.
#[derive(Debug)]
pub struct RowCache<T> {
    held: BTreeMap<String, (Arc<T>, usize)>,
    held_bytes: usize,
    cached: RefCell<Lru<Arc<T>>>,
}

impl<T> RowCache<T> {
    pub fn new(budget: usize) -> Self {
        Self {
            held: BTreeMap::new(),
            held_bytes: 0,
            cached: RefCell::new(Lru::new(budget)),
        }
    }

    pub fn hold(&mut self, key: String, value: Arc<T>, bytes: usize) {
        if let Some((_, previous)) = self.held.insert(key, (value, bytes)) {
            self.held_bytes -= previous;
        }
        self.held_bytes = self.held_bytes.saturating_add(bytes);
    }

    pub fn held(&self, key: &str) -> Option<Arc<T>> {
        self.held.get(key).map(|(value, _)| value.clone())
    }

    pub fn held_bytes(&self) -> usize {
        self.held_bytes
    }

    pub fn cached(&self, key: &str) -> Option<Arc<T>> {
        self.cached.borrow_mut().get(key)
    }

    pub fn cache(&self, key: String, value: Arc<T>, bytes: usize) {
        self.cached.borrow_mut().insert(key, value, bytes);
    }

    pub fn cached_bytes(&self) -> usize {
        self.cached.borrow().size()
    }

    /// Moves held rows into the cache once the file has them.
    pub fn release(&mut self, keys: impl IntoIterator<Item = String>) {
        for key in keys {
            if let Some((value, bytes)) = self.held.remove(&key) {
                self.held_bytes -= bytes;
                self.cache(key, value, bytes);
            }
        }
    }

    /// Moves every held row into the cache, for a session whose file now has all of them.
    pub fn release_all(&mut self) {
        let keys: Vec<String> = self.held.keys().cloned().collect();
        self.release(keys);
    }
}

/// Graph heads and recent revisions, each in a byte-budgeted cache. An evicted head is rebuilt on demand.
#[derive(Debug)]
pub struct MaterializedCache {
    pinned: Lru<MaterializedNarrative>,
    recent: Lru<MaterializedNarrative>,
}

impl Default for MaterializedCache {
    fn default() -> Self {
        Self {
            pinned: Lru::new(MATERIALIZED_HEADS_CACHED_BYTES),
            recent: Lru::new(MATERIALIZED_RECENT_CACHED_BYTES),
        }
    }
}

impl MaterializedCache {
    pub fn get(&mut self, graph_hash: &str) -> Option<MaterializedNarrative> {
        if let Some(found) = self.pinned.get(graph_hash) {
            return Some(found);
        }
        self.recent.get(graph_hash)
    }

    pub fn keep(&mut self, graph_hash: String, materialized: MaterializedNarrative) {
        let bytes = materialized.cache_bytes();
        if self.pinned.get(&graph_hash).is_some() {
            self.pinned.insert(graph_hash, materialized, bytes);
        } else {
            self.recent.insert(graph_hash, materialized, bytes);
            while self.recent.len() > MATERIALIZED_KEPT {
                self.recent.remove_oldest();
            }
        }
    }

    /// Prefers a graph's head over older revisions, within the head cache's byte budget.
    pub fn pin(&mut self, graph_hash: String, materialized: MaterializedNarrative) {
        self.recent.remove(&graph_hash);
        let bytes = materialized.cache_bytes();
        self.pinned.insert(graph_hash, materialized, bytes);
    }

    pub fn unpin(&mut self, graph_hash: &str) {
        if let Some(materialized) = self.pinned.remove(graph_hash) {
            self.keep(graph_hash.to_owned(), materialized);
        }
    }

    pub fn len(&self) -> usize {
        self.pinned.len() + self.recent.len()
    }
}

/// The source snapshots that graph revisions are grounded in, by hash, each with the model it captured.
#[derive(Debug)]
pub struct SnapshotStore {
    pub index: BTreeMap<String, String>,
    pub rows: RowCache<NarrativeSourceSnapshot>,
}

impl Default for SnapshotStore {
    fn default() -> Self {
        Self {
            index: BTreeMap::new(),
            rows: RowCache::new(SNAPSHOTS_CACHED_BYTES),
        }
    }
}

impl SnapshotStore {
    pub fn contains_key(&self, snapshot_hash: &str) -> bool {
        self.index.contains_key(snapshot_hash)
    }

    pub fn len(&self) -> usize {
        self.index.len()
    }

    /// A snapshot held or cached, or read from the file and checked against its hash.
    pub fn get(
        &self,
        snapshot_hash: &str,
        reader: Option<&StoreReader>,
    ) -> EngineResult<Option<Arc<NarrativeSourceSnapshot>>> {
        let Some(model_hash) = self.index.get(snapshot_hash) else {
            return Ok(None);
        };
        if let Some(found) = self
            .rows
            .held(snapshot_hash)
            .or_else(|| self.rows.cached(snapshot_hash))
        {
            return Ok(Some(found));
        }
        let reader = reader.ok_or_else(|| {
            error(format!(
                "narrative source snapshot {snapshot_hash} is not held"
            ))
        })?;
        let bytes = reader.snapshot_row(snapshot_hash)?.ok_or_else(|| {
            error(format!(
                "narrative source snapshot {snapshot_hash} is missing from the state file"
            ))
        })?;
        let stored: crate::model::narrative::StoredNarrativeSourceSnapshot =
            serde_json::from_slice(&bytes).map_err(|cause| {
                error(format!(
                    "failed to decode narrative source snapshot {snapshot_hash}: {cause}"
                ))
            })?;
        if stored.snapshot_hash != snapshot_hash
            || hash_serializable(&stored.snapshot)? != snapshot_hash
        {
            return Err(error(format!(
                "narrative source snapshot {snapshot_hash} does not match its hash"
            )));
        }
        if &stored.snapshot.model_hash != model_hash {
            return Err(error(format!(
                "narrative source snapshot {snapshot_hash} does not match its model binding"
            )));
        }
        let snapshot = Arc::new(stored.snapshot);
        self.rows
            .cache(snapshot_hash.to_owned(), snapshot.clone(), bytes.len());
        Ok(Some(snapshot))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn materialized_heads_and_recent_revisions_obey_their_byte_budgets() {
        let record: StoredNarrativeRevision = serde_json::from_value(json!({
            "schema": "life-sim-rust-narrative-revision-store/v2",
            "operation_sequence": 0, "record_hash": "record", "graph_hash": "graph", "snapshot_hash": "snapshot",
            "graph_schema": "life-sim-rust-narrative-graph/v1", "graph_id": "cache-test",
            "revision": {"number": 0, "reason": "cache test", "provenance": []},
            "source": {"kind": "model", "model_hash": "model"},
            "insertion_order": {"scope": "full_definition", "root_ids": [], "node_ids": [], "edge_ids": []},
            "payload": {"kind": "root", "roots": [], "edges": [], "nodes": [{
                "id": "text", "node_type": "paragraph", "role": "story_passage", "text": "x".repeat(2000),
                "epistemic_status": "fictional_canon", "evidence_type": "fictional_canon", "provenance": []
            }]}
        })).unwrap();
        let graph = MaterializedNarrative::apply(None, &record).unwrap();
        let charge = graph.cache_bytes();
        assert!(charge > 2000);
        let mut cache = MaterializedCache {
            pinned: Lru::new(charge * 2),
            recent: Lru::new(charge * 2),
        };
        for index in 0..10 {
            cache.pin(format!("head-{index}"), graph.clone());
            cache.keep(format!("revision-{index}"), graph.clone());
            assert!(cache.pinned.size() <= charge * 2);
            assert!(cache.recent.size() <= charge * 2);
        }
        assert_eq!(cache.len(), 4);
        assert!(
            cache.get("head-0").is_none(),
            "heads cannot escape the byte bound"
        );
        assert!(cache.get("revision-0").is_none());
        assert!(cache.get("head-9").is_some());
        assert!(cache.get("revision-9").is_some());
        cache.unpin("head-9");
        assert!(cache.pinned.get("head-9").is_none());
        assert!(cache.get("head-9").is_some());
    }
}
