//! Every model revision a session knows, kept compactly: a revision whose predecessor is known is kept as its changes
//! from it, and only a revision without one is kept whole. A full model is rebuilt from those changes when it is asked
//! for and checked against its hash; the most recently used ones stay rebuilt. Memory and the stored history therefore
//! grow with what each revision changed, not with the size of the whole model times the number of revisions.
//!
//! A durable session keeps the rows in its file. It holds every revision's header (id, number, predecessor and
//! provenance, from its seal), the rows not yet written, and a cache of rows it has read; a row read from the file is
//! checked against its seal before it is used. A session without a file holds every row.

use super::model_delta::{self, ModelDelta};
use super::store_rows::{
    check_row, ModelHeader, RowCache, SealKind, SealRef, StoreReader, MODEL_ROWS_CACHED_BYTES,
};
use crate::limits::serialized_size;
use crate::model::{compile_model, CompiledModel, ModelDefinition};
use crate::{error, EngineResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// How many rebuilt models stay ready. The head of a lineage is asked for on almost every call, so it stays.
const REBUILT_MODELS_KEPT: usize = 4;

/// A model revision as it is stored: whole, or as its changes from the revision it was made from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StoredModel {
    Changes {
        model_hash: String,
        base_model_hash: String,
        delta: ModelDelta,
    },
    Whole {
        model_hash: String,
        definition: Box<ModelDefinition>,
    },
}

impl StoredModel {
    pub fn model_hash(&self) -> &str {
        match self {
            StoredModel::Changes { model_hash, .. } | StoredModel::Whole { model_hash, .. } => {
                model_hash
            }
        }
    }

    /// The revision this one is rebuilt after: its base, or for a whole revision the one it was made from.
    fn rebuilt_after(&self) -> Option<&str> {
        match self {
            StoredModel::Changes {
                base_model_hash, ..
            } => Some(base_model_hash),
            StoredModel::Whole { definition, .. } => {
                definition.revision.previous_model_hash.as_deref()
            }
        }
    }

    pub fn base_model_hash(&self) -> Option<&str> {
        match self {
            StoredModel::Changes {
                base_model_hash, ..
            } => Some(base_model_hash),
            StoredModel::Whole { .. } => None,
        }
    }

    /// Reads a row as the file holds it.
    pub fn from_row(
        model_hash: String,
        bytes: &[u8],
        base_model_hash: Option<String>,
    ) -> EngineResult<Self> {
        Ok(match base_model_hash {
            None => StoredModel::Whole {
                definition: Box::new(serde_json::from_slice(bytes).map_err(|cause| {
                    error(format!(
                        "failed to decode stored model {model_hash}: {cause}"
                    ))
                })?),
                model_hash,
            },
            Some(base_model_hash) => StoredModel::Changes {
                delta: serde_json::from_slice(bytes).map_err(|cause| {
                    error(format!(
                        "failed to decode stored model {model_hash}: {cause}"
                    ))
                })?,
                model_hash,
                base_model_hash,
            },
        })
    }
}

pub fn model_header(model: &CompiledModel) -> ModelHeader {
    ModelHeader {
        id: model.id.clone(),
        revision_number: model.revision.number,
        previous_model_hash: model.revision.previous_model_hash.clone(),
        reason: model.revision.reason.clone(),
        provenance: model.revision.provenance.clone(),
    }
}

/// What is known about a revision without rebuilding it.
#[derive(Debug, Clone)]
pub struct ModelEntry {
    pub header: ModelHeader,
    /// The revision the row is kept against, or none for a row kept whole.
    pub base_model_hash: Option<String>,
    pub row_bytes: usize,
    /// The seal a row read from the file must match. A row not yet written has none.
    pub seal: Option<SealRef>,
}

#[derive(Debug)]
pub struct ModelStore {
    entries: BTreeMap<String, ModelEntry>,
    rows: RowCache<StoredModel>,
    reader: Option<Arc<StoreReader>>,
    rebuilt: RefCell<Rebuilt>,
}

impl Default for ModelStore {
    fn default() -> Self {
        Self {
            entries: BTreeMap::new(),
            rows: RowCache::new(MODEL_ROWS_CACHED_BYTES),
            reader: None,
            rebuilt: RefCell::default(),
        }
    }
}

#[derive(Debug, Default)]
struct Rebuilt {
    models: BTreeMap<String, (Arc<CompiledModel>, u64)>,
    clock: u64,
}

impl ModelStore {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains_key(&self, model_hash: &str) -> bool {
        self.entries.contains_key(model_hash)
    }

    /// Reads rows the session does not hold from this file from now on.
    pub fn set_reader(&mut self, reader: Option<Arc<StoreReader>>) {
        self.reader = reader;
    }

    /// The bytes of the rows held in memory because the file does not have them yet (all of them without a file).
    pub fn held_bytes(&self) -> usize {
        self.rows.held_bytes()
    }

    pub fn cached_bytes(&self) -> usize {
        self.rows.cached_bytes()
    }

    /// The bytes every stored row takes, held or in the file.
    pub fn row_bytes_total(&self) -> usize {
        self.entries.values().map(|entry| entry.row_bytes).sum()
    }

    pub fn entries(&self) -> impl Iterator<Item = (&String, &ModelEntry)> {
        self.entries.iter()
    }

    pub fn entry(&self, model_hash: &str) -> Option<&ModelEntry> {
        self.entries.get(model_hash)
    }

    pub fn set_seal(&mut self, model_hash: &str, seal: SealRef) {
        if let Some(entry) = self.entries.get_mut(model_hash) {
            entry.seal = Some(seal);
        }
    }

    /// Moves written rows from what is held to the cache: the file has them now.
    pub fn release(&mut self, model_hashes: impl IntoIterator<Item = String>) {
        if self.reader.is_some() {
            self.rows.release(model_hashes);
        }
    }

    /// A stored row: held, cached, or read from the file and checked against its seal.
    pub fn row(&self, model_hash: &str) -> EngineResult<Arc<StoredModel>> {
        if let Some(row) = self
            .rows
            .held(model_hash)
            .or_else(|| self.rows.cached(model_hash))
        {
            return Ok(row);
        }
        let entry = self
            .entries
            .get(model_hash)
            .ok_or_else(|| error(format!("unknown model {model_hash}")))?;
        let reader = self
            .reader
            .as_ref()
            .ok_or_else(|| error(format!("stored model revision {model_hash} is not held")))?;
        let (bytes, base_model_hash) = reader.model_row(model_hash)?.ok_or_else(|| {
            error(format!(
                "stored model revision {model_hash} is missing from the state file"
            ))
        })?;
        let seal = entry.seal.as_ref().ok_or_else(|| {
            error(format!(
                "stored model revision {model_hash} is neither held nor sealed"
            ))
        })?;
        check_row(SealKind::Model, model_hash, &bytes, seal)?;
        if base_model_hash != entry.base_model_hash {
            return Err(error(format!(
                "stored model revision {model_hash} names another base than its seal"
            )));
        }
        let row = Arc::new(StoredModel::from_row(
            model_hash.to_owned(),
            &bytes,
            base_model_hash,
        )?);
        self.rows
            .cache(model_hash.to_owned(), row.clone(), bytes.len());
        crate::heartbeat::tick();
        Ok(row)
    }

    /// The revision with this hash, rebuilt if it is not ready, or `None` when the session does not know it.
    pub fn get(&self, model_hash: &str) -> EngineResult<Option<Arc<CompiledModel>>> {
        if !self.entries.contains_key(model_hash) {
            return Ok(None);
        }
        if let Some(model) = self.ready(model_hash) {
            return Ok(Some(model));
        }
        let model = Arc::new(self.rebuild(model_hash)?);
        self.keep(&model);
        Ok(Some(model))
    }

    /// How a new revision would be kept: as its changes from its previous revision when the session knows that one
    /// and the changes are smaller than the whole, otherwise whole.
    pub fn kept_form(&self, model: &CompiledModel) -> EngineResult<StoredModel> {
        match &model.revision.previous_model_hash {
            Some(previous) if self.entries.contains_key(previous) => {
                let base = self
                    .get(previous)?
                    .ok_or_else(|| error("the previous model revision is unavailable"))?;
                kept_form(model, Some((previous.as_str(), base.definition())))
            }
            _ => kept_form(model, None),
        }
    }

    /// Rebuilds a stored revision whose base, if it has one, the session already knows, and checks it against its hash.
    pub fn rebuild_stored(&self, stored: &StoredModel) -> EngineResult<CompiledModel> {
        let (model_hash, definition) = match stored {
            StoredModel::Whole {
                model_hash,
                definition,
            } => (model_hash, (**definition).clone()),
            StoredModel::Changes {
                model_hash,
                base_model_hash,
                delta,
            } => {
                let base = self.get(base_model_hash)?.ok_or_else(|| {
                    error(format!(
                        "stored model revision {model_hash} lacks its base {base_model_hash}"
                    ))
                })?;
                let mut value = definition_value(base.definition())?;
                model_delta::apply(&mut value, delta).map_err(|cause| {
                    error(format!(
                        "stored model revision {model_hash} does not rebuild: {cause}"
                    ))
                })?;
                let definition = serde_json::from_value(value).map_err(|cause| {
                    error(format!(
                        "stored model revision {model_hash} does not rebuild: {cause}"
                    ))
                })?;
                (model_hash, definition)
            }
        };
        let model = compile_model(definition)?;
        if &model.model_hash != model_hash {
            return Err(error(format!(
                "stored model revision {model_hash} does not match its content hash"
            )));
        }
        Ok(model)
    }

    /// Adds a revision held in memory until it is written: a new one, or any one in a session without a file. The
    /// caller has rebuilt it and checked its hash.
    pub fn insert_stored(
        &mut self,
        model: Arc<CompiledModel>,
        stored: StoredModel,
    ) -> EngineResult<()> {
        self.check_new(&model, &stored)?;
        let bytes = serialized_size(&stored)?;
        self.entries.insert(
            model.model_hash.clone(),
            ModelEntry {
                header: model_header(&model),
                base_model_hash: stored.base_model_hash().map(str::to_owned),
                row_bytes: bytes,
                seal: None,
            },
        );
        self.rows
            .hold(model.model_hash.clone(), Arc::new(stored), bytes);
        self.keep(&model);
        Ok(())
    }

    /// Adds a revision the file has and that was validated as it was read: its row goes to the cache.
    pub fn insert_validated(
        &mut self,
        model: Arc<CompiledModel>,
        stored: StoredModel,
        row_bytes: usize,
        seal: Option<SealRef>,
    ) -> EngineResult<()> {
        self.check_new(&model, &stored)?;
        self.entries.insert(
            model.model_hash.clone(),
            ModelEntry {
                header: model_header(&model),
                base_model_hash: stored.base_model_hash().map(str::to_owned),
                row_bytes,
                seal,
            },
        );
        self.rows
            .cache(model.model_hash.clone(), Arc::new(stored), row_bytes);
        self.keep(&model);
        Ok(())
    }

    /// Adds a sealed revision by its header alone; its row stays in the file until it is needed.
    pub fn insert_sealed(
        &mut self,
        model_hash: String,
        header: ModelHeader,
        base_model_hash: Option<String>,
        row_bytes: usize,
        seal: SealRef,
    ) -> EngineResult<()> {
        if self.entries.contains_key(&model_hash) {
            return Err(error("a sealed model revision repeats a known hash"));
        }
        self.entries.insert(
            model_hash,
            ModelEntry {
                header,
                base_model_hash,
                row_bytes,
                seal: Some(seal),
            },
        );
        Ok(())
    }

    fn check_new(&self, model: &CompiledModel, stored: &StoredModel) -> EngineResult<()> {
        if stored.model_hash() != model.model_hash || self.entries.contains_key(&model.model_hash) {
            return Err(error(
                "a stored model revision does not match its place in the session",
            ));
        }
        if let StoredModel::Changes {
            base_model_hash, ..
        } = stored
        {
            if !self.entries.contains_key(base_model_hash) {
                return Err(error(
                    "a stored model revision names a base the session does not know",
                ));
            }
        }
        Ok(())
    }

    fn ready(&self, model_hash: &str) -> Option<Arc<CompiledModel>> {
        let mut rebuilt = self.rebuilt.borrow_mut();
        rebuilt.clock += 1;
        let clock = rebuilt.clock;
        let (model, used) = rebuilt.models.get_mut(model_hash)?;
        *used = clock;
        Some(model.clone())
    }

    fn keep(&self, model: &Arc<CompiledModel>) {
        let mut rebuilt = self.rebuilt.borrow_mut();
        rebuilt.clock += 1;
        let clock = rebuilt.clock;
        rebuilt
            .models
            .insert(model.model_hash.clone(), (model.clone(), clock));
        while rebuilt.models.len() > REBUILT_MODELS_KEPT {
            let Some(oldest) = rebuilt
                .models
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(hash, _)| hash.clone())
            else {
                break;
            };
            rebuilt.models.remove(&oldest);
        }
    }

    /// Rebuilds a revision from the nearest ancestor that is ready or kept whole, applying each revision's changes in
    /// turn to one working copy, and checks the result against its hash.
    fn rebuild(&self, model_hash: &str) -> EngineResult<CompiledModel> {
        self.rebuild_with_rows(model_hash, |hash| self.row(hash))
    }

    fn rebuild_with_rows(
        &self,
        model_hash: &str,
        mut read: impl FnMut(&str) -> EngineResult<Arc<StoredModel>>,
    ) -> EngineResult<CompiledModel> {
        // Walk headers first. Holding the delta rows here would defeat their cache's byte budget: an evicted row
        // would remain alive in this walk until the entire lineage had been reconstructed.
        let mut changes: Vec<String> = Vec::new();
        let mut cursor = model_hash.to_owned();
        let mut value = loop {
            if changes.len() > self.entries.len() {
                return Err(error("stored model revisions form a cycle"));
            }
            if cursor != model_hash {
                if let Some(model) = self.ready(&cursor) {
                    break definition_value(model.definition())?;
                }
            }
            let entry = self.entries.get(&cursor).ok_or_else(|| {
                error(format!(
                    "stored model revision {model_hash} lacks its base {cursor}"
                ))
            })?;
            match &entry.base_model_hash {
                None => {
                    let row = read(&cursor)?;
                    let StoredModel::Whole { definition, .. } = row.as_ref() else {
                        return Err(error("stored model revision does not match its header"));
                    };
                    break definition_value(definition)?;
                }
                Some(base_model_hash) => {
                    let next = base_model_hash.clone();
                    changes.push(cursor);
                    cursor = next;
                }
            }
        };
        for hash in changes.iter().rev() {
            let row = read(hash)?;
            if let StoredModel::Changes { delta, .. } = row.as_ref() {
                model_delta::apply(&mut value, delta).map_err(|cause| {
                    error(format!(
                        "stored model revision {model_hash} does not rebuild: {cause}"
                    ))
                })?;
                crate::heartbeat::tick();
            } else {
                return Err(error("stored model revision does not match its header"));
            }
        }
        let definition: ModelDefinition = serde_json::from_value(value).map_err(|cause| {
            error(format!(
                "stored model revision {model_hash} does not rebuild: {cause}"
            ))
        })?;
        let model = compile_model(definition)?;
        if model.model_hash != model_hash {
            return Err(error(format!(
                "stored model revision {model_hash} rebuilds with a different hash"
            )));
        }
        Ok(model)
    }

    /// A revision's ancestry from its header chain, newest first, without rebuilding any: at most `limit` revisions,
    /// stopping after `stop_at`. Returns the headers and whether the walk reached a first revision or `stop_at`.
    pub fn lineage(
        &self,
        model_hash: &str,
        stop_at: Option<&str>,
        limit: usize,
    ) -> EngineResult<(Vec<(String, ModelHeader)>, bool)> {
        let mut found = Vec::new();
        let mut cursor = Some(model_hash.to_owned());
        let mut seen = BTreeSet::new();
        while let Some(hash) = cursor {
            if found.len() >= limit {
                return Ok((found, false));
            }
            if !seen.insert(hash.clone()) {
                return Err(error("stored model revisions form a cycle"));
            }
            let entry = self
                .entries
                .get(&hash)
                .ok_or_else(|| error(format!("unknown model {hash}")))?;
            let reached = stop_at == Some(hash.as_str());
            cursor = entry.header.previous_model_hash.clone();
            found.push((hash, entry.header.clone()));
            if reached {
                return Ok((found, true));
            }
        }
        Ok((found, true))
    }

    /// The revisions nothing was made from, each with its header.
    pub fn leaves(&self) -> Vec<(&String, &ModelHeader)> {
        let parents: BTreeSet<&str> = self
            .entries
            .values()
            .filter_map(|entry| entry.header.previous_model_hash.as_deref())
            .collect();
        self.entries
            .iter()
            .filter(|(hash, _)| !parents.contains(hash.as_str()))
            .map(|(hash, entry)| (hash, &entry.header))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cold_lineage_rebuild_drops_each_delta_before_reading_the_next() {
        let mut store = ModelStore::default();
        let mut source = BTreeMap::new();
        let mut expected = None;
        for number in 0..24 {
            let mut definition = crate::test_support::test_model();
            definition.revision.number = number;
            definition.revision.previous_model_hash = expected
                .as_ref()
                .map(|model: &Arc<CompiledModel>| model.model_hash.clone());
            definition.revision.reason = format!("reading {number}");
            let model = Arc::new(compile_model(definition).unwrap());
            let row = store.kept_form(&model).unwrap();
            if number > 0 {
                assert!(matches!(row, StoredModel::Changes { .. }));
            }
            source.insert(model.model_hash.clone(), row.clone());
            store.insert_stored(model.clone(), row).unwrap();
            expected = Some(model);
        }
        // Simulate cold reads after eviction, so no cache or previously compiled ancestor keeps the lineage alive.
        store.rows = RowCache::new(0);
        *store.rebuilt.borrow_mut() = Rebuilt::default();
        let expected = expected.unwrap();
        let mut prior = std::sync::Weak::<StoredModel>::new();
        let mut reads = 0;
        let actual = store
            .rebuild_with_rows(&expected.model_hash, |hash| {
                assert_eq!(
                    prior.strong_count(),
                    0,
                    "the prior row is still retained outside the cache"
                );
                let row = Arc::new(source[hash].clone());
                prior = Arc::downgrade(&row);
                reads += 1;
                Ok(row)
            })
            .unwrap();
        assert_eq!(reads, source.len());
        assert_eq!(prior.strong_count(), 0);
        assert_eq!(actual.model_hash, expected.model_hash);
        assert_eq!(actual.definition(), expected.definition());
    }
}

/// How a revision is kept: as its changes from `base` when they rebuild it exactly and are smaller, otherwise whole.
pub fn kept_form(
    model: &CompiledModel,
    base: Option<(&str, &ModelDefinition)>,
) -> EngineResult<StoredModel> {
    let whole = StoredModel::Whole {
        model_hash: model.model_hash.clone(),
        definition: Box::new(model.definition().clone()),
    };
    let Some((base_model_hash, base)) = base else {
        return Ok(whole);
    };
    let Some(delta) = model_delta::compute(
        &definition_value(base)?,
        &definition_value(model.definition())?,
    ) else {
        return Ok(whole);
    };
    let changes = StoredModel::Changes {
        model_hash: model.model_hash.clone(),
        base_model_hash: base_model_hash.to_owned(),
        delta,
    };
    Ok(if serialized_size(&changes)? < serialized_size(&whole)? {
        changes
    } else {
        whole
    })
}

fn definition_value(definition: &ModelDefinition) -> EngineResult<Value> {
    serde_json::to_value(definition)
        .map_err(|cause| error(format!("failed to encode a model definition: {cause}")))
}

/// The order in which revisions can be rebuilt: every revision after the one it is rebuilt from. Each item is a
/// revision's hash and the hash it is rebuilt after; one rebuilt after a revision outside the list must be whole or
/// known already, which `known` decides.
pub fn rebuild_order_of(
    items: &[(String, Option<String>, bool)],
    known: impl Fn(&str) -> bool,
) -> EngineResult<Vec<usize>> {
    let index: BTreeMap<&str, usize> = items
        .iter()
        .enumerate()
        .map(|(i, (hash, _, _))| (hash.as_str(), i))
        .collect();
    if index.len() != items.len() {
        return Err(error("state file contains a duplicate model hash"));
    }
    let mut children: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut roots = Vec::new();
    for (i, (hash, after, is_changes)) in items.iter().enumerate() {
        match after.as_deref().and_then(|hash| index.get(hash)) {
            Some(parent) => children.entry(*parent).or_default().push(i),
            None => {
                if *is_changes && !after.as_deref().is_some_and(&known) {
                    return Err(error(format!(
                        "stored model revision {hash} lacks its base"
                    )));
                }
                roots.push(i);
            }
        }
    }
    let mut order = Vec::with_capacity(items.len());
    let mut stack: Vec<usize> = roots.into_iter().rev().collect();
    let mut seen = BTreeSet::new();
    while let Some(i) = stack.pop() {
        if !seen.insert(i) {
            continue;
        }
        order.push(i);
        if let Some(next) = children.get(&i) {
            stack.extend(next.iter().rev());
        }
    }
    if order.len() != items.len() {
        return Err(error("stored model revisions form a cycle"));
    }
    Ok(order)
}

/// The order in which stored revisions can be rebuilt: every revision after the one it is rebuilt from.
#[cfg(test)]
pub fn rebuild_order(stored: &[StoredModel]) -> EngineResult<Vec<usize>> {
    rebuild_order_after(stored, |_| false)
}

/// The same, for rows some of which are rebuilt after a revision the session already knows (`known`).
pub fn rebuild_order_after(
    stored: &[StoredModel],
    known: impl Fn(&str) -> bool,
) -> EngineResult<Vec<usize>> {
    let items: Vec<(String, Option<String>, bool)> = stored
        .iter()
        .map(|row| {
            (
                row.model_hash().to_owned(),
                row.rebuilt_after().map(str::to_owned),
                matches!(row, StoredModel::Changes { .. }),
            )
        })
        .collect();
    rebuild_order_of(&items, known)
}
