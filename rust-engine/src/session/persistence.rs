//! The SQLite state file: its tables, the transaction that writes a session's dirty rows, and the load that reads a
//! whole session back and checks it before the session is rebuilt from it (session/restore.rs).
//!
//! A write is one transaction. It first compare-and-swaps the file's generation, from the one this session last read or
//! wrote to the next, so a session opened before another writer's commit cannot overwrite that commit. It then writes
//! exactly the dirty rows (and, when it migrates a v2 file, every model row in its kept form). A failed write reports
//! whether its COMMIT was attempted, which is what decides whether its outcome is certain. A load reads one consistent
//! snapshot of the file, even while another session migrates it.

use std::collections::BTreeSet;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::limits::{
    MAX_PROJECT_CHECKPOINTS, MAX_PROJECT_STORAGE_BYTES, MAX_SESSION_CANDIDATES,
    MAX_SESSION_CANDIDATE_BYTES, MAX_SESSION_MODELS, MAX_SESSION_MODEL_BYTES,
    MAX_SESSION_NARRATIVE_BYTES, MAX_SESSION_NARRATIVE_GRAPHS, MAX_SESSION_WORLDS,
    MAX_SESSION_WORLD_BYTES, MAX_SESSION_WORLD_REVISIONS, MAX_SESSION_WORLD_REVISION_BYTES,
};
use crate::model::candidate::StoredCandidate;
use crate::model::compile::compile_model;
use crate::model::definition::ModelDefinition;
use crate::model::narrative::{
    NarrativeSourceSnapshot, StoredNarrativeGraph, StoredNarrativeRevision,
    StoredNarrativeSourceSnapshot,
};
use crate::model::project::{
    project_graph_snapshot_hash, StoredProjectCheckpoint, StoredProjectDocument,
};
use crate::model::world::{WorldHead, WorldRevision};
use crate::session::model_store::StoredModel;
use crate::session::MachineSession;
use crate::session::SESSION_STATE_SCHEMA;
use crate::{error, EngineResult};

pub(super) const SESSION_STATE_SCHEMA_V2: &str = "life-sim-rust-session-state/v2";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PersistedSession {
    pub(super) schema: String,
    pub(super) persistence_generation: u64,
    pub(super) models: Vec<StoredModel>,
    pub(super) worlds: Vec<WorldHead>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) world_revisions: Vec<WorldRevision>,
    pub(super) candidates: Vec<StoredCandidate>,
    pub(super) narrative_source_snapshots: Vec<StoredNarrativeSourceSnapshot>,
    pub(super) narrative_revisions: Vec<StoredNarrativeRevision>,
    #[serde(default)]
    pub(super) project_documents: Vec<StoredProjectDocument>,
    #[serde(default)]
    pub(super) project_model_snapshots: Vec<ModelDefinition>,
    #[serde(default)]
    pub(super) project_world_snapshots: Vec<WorldHead>,
    #[serde(default)]
    pub(super) project_graph_snapshots: Vec<StoredNarrativeGraph>,
    #[serde(default)]
    pub(super) project_checkpoints: Vec<StoredProjectCheckpoint>,
}

#[derive(Debug)]
pub(super) struct PersistenceFailure {
    pub(super) cause: crate::EngineError,
    pub(super) state_file_replaced: bool,
}

fn state_parent(path: &Path) -> &Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

pub(super) const SQLITE_SESSION_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS session_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- A row holds a revision's whole definition, or, when base_model_hash names the revision it was made from, its changes
-- from that revision (a life-sim-rust-model-delta/v1 document).
CREATE TABLE IF NOT EXISTS models (
    model_hash TEXT PRIMARY KEY,
    definition_json BLOB NOT NULL,
    base_model_hash TEXT REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS worlds (
    world_id TEXT PRIMARY KEY,
    model_hash TEXT NOT NULL,
    world_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS candidates (
    candidate_hash TEXT PRIMARY KEY,
    model_hash TEXT NOT NULL,
    candidate_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS world_revisions (
    world_revision_hash TEXT PRIMARY KEY,
    revision_json BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS narrative_source_snapshots (
    snapshot_hash TEXT PRIMARY KEY,
    model_hash TEXT NOT NULL,
    snapshot_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS narrative_revisions (
    graph_hash TEXT PRIMARY KEY,
    operation_sequence INTEGER NOT NULL UNIQUE CHECK(operation_sequence >= 0),
    graph_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK(revision_number >= 0),
    previous_graph_hash TEXT,
    snapshot_hash TEXT NOT NULL,
    revision_json BLOB NOT NULL,
    FOREIGN KEY(previous_graph_hash) REFERENCES narrative_revisions(graph_hash),
    FOREIGN KEY(snapshot_hash) REFERENCES narrative_source_snapshots(snapshot_hash)
);
CREATE INDEX IF NOT EXISTS narrative_revisions_graph_id_revision
    ON narrative_revisions(graph_id, revision_number);
CREATE INDEX IF NOT EXISTS narrative_revisions_previous
    ON narrative_revisions(previous_graph_hash);
CREATE TABLE IF NOT EXISTS project_documents (
    document_hash TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    content BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS project_model_snapshots (
    model_hash TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    definition_json BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS project_model_snapshots_domain_id
    ON project_model_snapshots(model_id);
CREATE TABLE IF NOT EXISTS project_world_snapshots (
    world_hash TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    world_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES project_model_snapshots(model_hash)
);
CREATE INDEX IF NOT EXISTS project_world_snapshots_domain_id
    ON project_world_snapshots(world_id);
CREATE TABLE IF NOT EXISTS project_graph_snapshots (
    narrative_graph_snapshot_hash TEXT PRIMARY KEY,
    graph_hash TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    graph_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES project_model_snapshots(model_hash)
);
CREATE INDEX IF NOT EXISTS project_graph_snapshots_graph_hash
    ON project_graph_snapshots(graph_hash);
CREATE TABLE IF NOT EXISTS project_checkpoints (
    checkpoint_hash TEXT PRIMARY KEY,
    checkpoint_name TEXT NOT NULL UNIQUE,
    checkpoint_sequence INTEGER NOT NULL UNIQUE CHECK(checkpoint_sequence >= 0),
    parent_checkpoint_hash TEXT,
    document_hash TEXT NOT NULL,
    model_hash TEXT,
    world_hash TEXT,
    graph_hash TEXT,
    narrative_graph_snapshot_hash TEXT,
    checkpoint_json BLOB NOT NULL,
    FOREIGN KEY(parent_checkpoint_hash) REFERENCES project_checkpoints(checkpoint_hash),
    FOREIGN KEY(document_hash) REFERENCES project_documents(document_hash),
    FOREIGN KEY(model_hash) REFERENCES project_model_snapshots(model_hash),
    FOREIGN KEY(world_hash) REFERENCES project_world_snapshots(world_hash),
    FOREIGN KEY(narrative_graph_snapshot_hash)
        REFERENCES project_graph_snapshots(narrative_graph_snapshot_hash)
);
CREATE INDEX IF NOT EXISTS project_checkpoints_parent
    ON project_checkpoints(parent_checkpoint_hash);
"#;

fn sqlite_error(context: &str, cause: impl std::fmt::Display) -> crate::EngineError {
    error(format!("{context}: {cause}"))
}

fn configure_sqlite(connection: &Connection) -> EngineResult<()> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;\
             PRAGMA journal_mode = WAL;\
             PRAGMA synchronous = FULL;\
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|cause| sqlite_error("failed to configure SQLite session", cause))?;
    let foreign_keys: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to verify SQLite foreign keys", cause))?;
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to verify SQLite journal mode", cause))?;
    let synchronous: i64 = connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to verify SQLite synchronous mode", cause))?;
    if foreign_keys != 1 || !journal_mode.eq_ignore_ascii_case("wal") || synchronous != 2 {
        return Err(error(format!(
            "SQLite safety configuration was not applied (foreign_keys={foreign_keys}, journal_mode={journal_mode}, synchronous={synchronous})"
        )));
    }
    Ok(())
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn harden_sqlite_permissions(path: &Path) -> EngineResult<()> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|cause| {
            error(format!(
                "failed to set owner-only permissions on SQLite state file {}: {cause}",
                path.display()
            ))
        })?;
        for suffix in ["-wal", "-shm"] {
            let sidecar = sqlite_sidecar_path(path, suffix);
            if sidecar.exists() {
                fs::set_permissions(&sidecar, fs::Permissions::from_mode(0o600)).map_err(
                    |cause| {
                        error(format!(
                            "failed to set owner-only permissions on SQLite sidecar {}: {cause}",
                            sidecar.display()
                        ))
                    },
                )?;
            }
        }
    }
    Ok(())
}

fn encode_sqlite_json(value: &impl Serialize) -> EngineResult<Vec<u8>> {
    serde_json::to_vec(value)
        .map_err(|cause| error(format!("failed to encode SQLite session row: {cause}")))
}

fn decode_sqlite_json<T: for<'de> Deserialize<'de>>(
    bytes: Vec<u8>,
    label: &str,
) -> EngineResult<T> {
    serde_json::from_slice(&bytes)
        .map_err(|cause| error(format!("failed to decode SQLite {label} row: {cause}")))
}

fn sqlite_count_and_bytes(
    connection: &Connection,
    sql: &str,
    label: &str,
) -> EngineResult<(usize, usize)> {
    let (count, bytes): (i64, i64) = connection
        .query_row(sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|cause| sqlite_error(&format!("failed to preflight SQLite {label}"), cause))?;
    let count =
        usize::try_from(count).map_err(|_| error(format!("SQLite {label} count is invalid")))?;
    let bytes = usize::try_from(bytes)
        .map_err(|_| error(format!("SQLite {label} byte count is invalid")))?;
    Ok((count, bytes))
}

fn sqlite_table_exists(connection: &Connection, table: &str) -> EngineResult<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(|cause| sqlite_error("failed to inspect SQLite table availability", cause))
}

fn preflight_sqlite_limits(connection: &Connection) -> EngineResult<()> {
    let (model_count, model_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(definition_json)), 0) FROM models",
        "models",
    )?;
    let (world_count, world_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(world_json)), 0) FROM worlds",
        "worlds",
    )?;
    let (candidate_count, candidate_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(candidate_json)), 0) FROM candidates",
        "candidates",
    )?;
    let (world_revision_count, world_revision_bytes) =
        if sqlite_table_exists(connection, "world_revisions")? {
            sqlite_count_and_bytes(
                connection,
                "SELECT count(*), coalesce(sum(length(revision_json)), 0) FROM world_revisions",
                "world revisions",
            )?
        } else {
            (0, 0)
        };
    let (snapshot_count, snapshot_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(snapshot_json)), 0) FROM narrative_source_snapshots",
        "narrative source snapshots",
    )?;
    let (revision_count, revision_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(revision_json)), 0) FROM narrative_revisions",
        "narrative revisions",
    )?;
    let narrative_bytes = snapshot_bytes
        .checked_add(revision_bytes)
        .ok_or_else(|| error("SQLite narrative byte count overflow"))?;
    let project_bytes = if sqlite_table_exists(connection, "project_checkpoints")? {
        let (document_count, document_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(content)), 0) FROM project_documents",
            "project documents",
        )?;
        let (model_snapshot_count, model_snapshot_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(definition_json)), 0) FROM project_model_snapshots",
            "project model snapshots",
        )?;
        let (world_snapshot_count, world_snapshot_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(world_json)), 0) FROM project_world_snapshots",
            "project world snapshots",
        )?;
        let (graph_snapshot_count, graph_snapshot_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(graph_json)), 0) FROM project_graph_snapshots",
            "project graph snapshots",
        )?;
        let (checkpoint_count, checkpoint_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(checkpoint_json)), 0) FROM project_checkpoints",
            "project checkpoints",
        )?;
        if document_count > MAX_PROJECT_CHECKPOINTS
            || model_snapshot_count > MAX_PROJECT_CHECKPOINTS
            || world_snapshot_count > MAX_PROJECT_CHECKPOINTS
            || graph_snapshot_count > MAX_PROJECT_CHECKPOINTS
            || checkpoint_count > MAX_PROJECT_CHECKPOINTS
        {
            return Err(error("SQLite project checkpoint count exceeds its limit"));
        }
        document_bytes
            .checked_add(model_snapshot_bytes)
            .and_then(|bytes| bytes.checked_add(world_snapshot_bytes))
            .and_then(|bytes| bytes.checked_add(graph_snapshot_bytes))
            .and_then(|bytes| bytes.checked_add(checkpoint_bytes))
            .ok_or_else(|| error("SQLite project checkpoint byte count overflow"))?
    } else {
        0
    };
    if model_count > MAX_SESSION_MODELS
        || model_bytes > MAX_SESSION_MODEL_BYTES
        || world_count > MAX_SESSION_WORLDS
        || world_bytes > MAX_SESSION_WORLD_BYTES
        || candidate_count > MAX_SESSION_CANDIDATES
        || candidate_bytes > MAX_SESSION_CANDIDATE_BYTES
        || world_revision_count > MAX_SESSION_WORLD_REVISIONS
        || world_revision_bytes > MAX_SESSION_WORLD_REVISION_BYTES
        || snapshot_count > MAX_SESSION_NARRATIVE_GRAPHS
        || revision_count > MAX_SESSION_NARRATIVE_GRAPHS
        || narrative_bytes > MAX_SESSION_NARRATIVE_BYTES
        || project_bytes > MAX_PROJECT_STORAGE_BYTES
    {
        return Err(error("SQLite state file exceeds a session storage limit"));
    }
    Ok(())
}

/// Prepares the schema for a write. Returns true when a v2 file was migrated to v3, in which case every model row must
/// be rewritten in its kept form.
fn initialize_sqlite_schema(transaction: &Transaction<'_>) -> EngineResult<bool> {
    transaction
        .execute_batch(SQLITE_SESSION_SCHEMA)
        .map_err(|cause| sqlite_error("failed to initialize SQLite session schema", cause))?;
    let existing: Option<String> = transaction
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to inspect SQLite session schema", cause))?;
    let generation: Option<String> = transaction
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to inspect SQLite session generation", cause))?;
    match (existing, generation) {
        (Some(schema), Some(generation)) if schema == SESSION_STATE_SCHEMA_V2 => {
            generation
                .parse::<u64>()
                .map_err(|cause| error(format!("invalid SQLite session generation: {cause}")))?;
            transaction
                .execute_batch("ALTER TABLE models ADD COLUMN base_model_hash TEXT REFERENCES models(model_hash);")
                .map_err(|cause| sqlite_error("failed to migrate SQLite model rows", cause))?;
            transaction
                .execute(
                    "UPDATE session_metadata SET value = ?1 WHERE key = 'session_schema'",
                    [SESSION_STATE_SCHEMA],
                )
                .map_err(|cause| sqlite_error("failed to record SQLite session schema", cause))?;
            Ok(true)
        }
        (Some(schema), _) if schema != SESSION_STATE_SCHEMA => Err(error(format!(
            "unsupported session state schema {schema}; expected {SESSION_STATE_SCHEMA}"
        ))),
        (Some(_), Some(generation)) => {
            generation
                .parse::<u64>()
                .map_err(|cause| error(format!("invalid SQLite session generation: {cause}")))?;
            Ok(false)
        }
        (Some(_), None) | (None, Some(_)) => {
            Err(error("SQLite session metadata is partially initialized"))
        }
        (None, None) => {
            transaction
                .execute(
                    "INSERT INTO session_metadata(key, value) VALUES ('session_schema', ?1)",
                    [SESSION_STATE_SCHEMA],
                )
                .map_err(|cause| sqlite_error("failed to record SQLite session schema", cause))?;
            transaction
                .execute(
                    "INSERT INTO session_metadata(key, value) VALUES ('generation', '0')",
                    [],
                )
                .map_err(|cause| {
                    sqlite_error("failed to initialize SQLite session generation", cause)
                })?;
            Ok(false)
        }
    }
}

fn persist_model_row(transaction: &Transaction<'_>, stored: &StoredModel) -> EngineResult<()> {
    let (json, base_model_hash) = match stored {
        StoredModel::Whole { definition, .. } => (encode_sqlite_json(definition)?, None),
        StoredModel::Changes {
            base_model_hash,
            delta,
            ..
        } => (encode_sqlite_json(delta)?, Some(base_model_hash)),
    };
    transaction
        .execute(
            "INSERT INTO models(model_hash, definition_json, base_model_hash) VALUES (?1, ?2, ?3)\
             ON CONFLICT(model_hash) DO UPDATE SET definition_json = excluded.definition_json,\
             base_model_hash = excluded.base_model_hash",
            params![stored.model_hash(), json, base_model_hash],
        )
        .map_err(|cause| sqlite_error("failed to persist model row", cause))?;
    Ok(())
}

fn persist_world_row(transaction: &Transaction<'_>, world: &WorldHead) -> EngineResult<()> {
    let json = encode_sqlite_json(world)?;
    transaction
        .execute(
            "INSERT INTO worlds(world_id, model_hash, world_json) VALUES (?1, ?2, ?3)\
             ON CONFLICT(world_id) DO UPDATE SET model_hash = excluded.model_hash, world_json = excluded.world_json",
            params![world.world_id, world.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist world row", cause))?;
    Ok(())
}

fn persist_candidate_row(
    transaction: &Transaction<'_>,
    candidate: &StoredCandidate,
) -> EngineResult<()> {
    let hash = &candidate.record.candidate.candidate_hash;
    let model_hash = &candidate.record.candidate.model_hash;
    let json = encode_sqlite_json(candidate)?;
    transaction
        .execute(
            "INSERT INTO candidates(candidate_hash, model_hash, candidate_json) VALUES (?1, ?2, ?3)\
             ON CONFLICT(candidate_hash) DO UPDATE SET model_hash = excluded.model_hash, candidate_json = excluded.candidate_json",
            params![hash, model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist candidate row", cause))?;
    Ok(())
}

fn persist_narrative_snapshot_row(
    transaction: &Transaction<'_>,
    snapshot_hash: &str,
    snapshot: &NarrativeSourceSnapshot,
) -> EngineResult<()> {
    let stored = StoredNarrativeSourceSnapshot {
        snapshot_hash: snapshot_hash.to_owned(),
        snapshot: snapshot.clone(),
    };
    let json = encode_sqlite_json(&stored)?;
    transaction
        .execute(
            "INSERT INTO narrative_source_snapshots(snapshot_hash, model_hash, snapshot_json)\
             VALUES (?1, ?2, ?3)",
            params![snapshot_hash, snapshot.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist narrative source snapshot", cause))?;
    Ok(())
}

fn persist_narrative_revision_row(
    transaction: &Transaction<'_>,
    revision: &StoredNarrativeRevision,
) -> EngineResult<()> {
    let operation_sequence = i64::try_from(revision.operation_sequence)
        .map_err(|_| error("narrative operation sequence exceeds SQLite integer range"))?;
    let revision_number = i64::try_from(revision.revision.number)
        .map_err(|_| error("narrative revision number exceeds SQLite integer range"))?;
    let json = encode_sqlite_json(revision)?;
    transaction
        .execute(
            "INSERT INTO narrative_revisions(\
                 graph_hash, operation_sequence, graph_id, revision_number,\
                 previous_graph_hash, snapshot_hash, revision_json\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                revision.graph_hash,
                operation_sequence,
                revision.graph_id,
                revision_number,
                revision.revision.previous_graph_hash,
                revision.snapshot_hash,
                json
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist narrative revision", cause))?;
    Ok(())
}

fn persist_project_document_row(
    transaction: &Transaction<'_>,
    document: &StoredProjectDocument,
) -> EngineResult<()> {
    transaction
        .execute(
            "INSERT INTO project_documents(document_hash, media_type, content)\
             VALUES (?1, ?2, ?3)",
            params![
                document.document_hash,
                document.media_type,
                document.content
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist project document", cause))?;
    Ok(())
}

fn persist_project_model_snapshot_row(
    transaction: &Transaction<'_>,
    model_hash: &str,
    definition: &ModelDefinition,
) -> EngineResult<()> {
    let json = encode_sqlite_json(definition)?;
    transaction
        .execute(
            "INSERT INTO project_model_snapshots(model_hash, model_id, definition_json)\
             VALUES (?1, ?2, ?3)",
            params![model_hash, definition.id, json],
        )
        .map_err(|cause| sqlite_error("failed to persist project model snapshot", cause))?;
    Ok(())
}

fn persist_project_world_snapshot_row(
    transaction: &Transaction<'_>,
    world: &WorldHead,
) -> EngineResult<()> {
    let json = encode_sqlite_json(world)?;
    transaction
        .execute(
            "INSERT INTO project_world_snapshots(world_hash, world_id, model_hash, world_json)\
             VALUES (?1, ?2, ?3, ?4)",
            params![world.world_hash, world.world_id, world.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist project world snapshot", cause))?;
    Ok(())
}

fn persist_project_graph_snapshot_row(
    transaction: &Transaction<'_>,
    narrative_graph_snapshot_hash: &str,
    graph: &StoredNarrativeGraph,
) -> EngineResult<()> {
    let json = encode_sqlite_json(graph)?;
    transaction
        .execute(
            "INSERT INTO project_graph_snapshots(narrative_graph_snapshot_hash, graph_hash, model_hash, source_snapshot_hash, graph_json)\
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                narrative_graph_snapshot_hash,
                graph.graph_hash,
                graph.snapshot.model_hash,
                graph.snapshot_hash,
                json
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist project graph snapshot", cause))?;
    Ok(())
}

fn persist_project_checkpoint_row(
    transaction: &Transaction<'_>,
    checkpoint: &StoredProjectCheckpoint,
) -> EngineResult<()> {
    let sequence = i64::try_from(checkpoint.checkpoint_sequence)
        .map_err(|_| error("project checkpoint sequence exceeds SQLite integer range"))?;
    let json = encode_sqlite_json(checkpoint)?;
    transaction
        .execute(
            "INSERT INTO project_checkpoints(\
                checkpoint_hash, checkpoint_name, checkpoint_sequence, parent_checkpoint_hash,\
                document_hash, model_hash, world_hash, graph_hash, narrative_graph_snapshot_hash, checkpoint_json\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                checkpoint.checkpoint_hash,
                checkpoint.core.name,
                sequence,
                checkpoint.core.parent_checkpoint_hash,
                checkpoint.core.document_hash,
                checkpoint.core.model_hash,
                checkpoint.core.world_hash,
                checkpoint.core.narrative_graph_hash,
                checkpoint.core.narrative_graph_snapshot_hash,
                json
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist project checkpoint", cause))?;
    Ok(())
}

pub(super) fn persist_sqlite_changes(
    path: &Path,
    after: &MachineSession,
) -> Result<u64, PersistenceFailure> {
    let parent = state_parent(path);
    if !parent.is_dir() {
        return Err(PersistenceFailure {
            cause: error(format!(
                "state file parent directory {} does not exist",
                parent.display()
            )),
            state_file_replaced: false,
        });
    }
    let existed_before = path.exists();
    let mut commit_attempted = false;
    let mut committed_generation = None;
    let write_result = (|| -> EngineResult<()> {
        let mut connection = Connection::open(path).map_err(|cause| {
            sqlite_error(
                &format!("failed to open SQLite state file {}", path.display()),
                cause,
            )
        })?;
        harden_sqlite_permissions(path)?;
        configure_sqlite(&connection)?;
        let transaction = connection
            .transaction()
            .map_err(|cause| sqlite_error("failed to begin SQLite session transaction", cause))?;
        let migrated = initialize_sqlite_schema(&transaction)?;

        let next_generation = after
            .persistence_generation
            .checked_add(1)
            .ok_or_else(|| error("SQLite session generation overflow"))?;
        let updated = transaction
            .execute(
                "UPDATE session_metadata SET value = ?1\
                 WHERE key = 'generation' AND value = ?2",
                params![
                    next_generation.to_string(),
                    after.persistence_generation.to_string()
                ],
            )
            .map_err(|cause| {
                sqlite_error("failed to compare-and-swap session generation", cause)
            })?;
        if updated != 1 {
            return Err(error(
                "SQLite session changed since it was opened; reopen before writing",
            ));
        }

        // A migrated file gets every model row rewritten in its kept form; otherwise only the new ones are written.
        // Each row is written after the row its changes are kept against.
        let pending: BTreeSet<&String> = if migrated {
            after.models.entries().map(|(hash, _)| hash).collect()
        } else {
            after.dirty.models.iter().collect()
        };
        let mut written: BTreeSet<&String> = BTreeSet::new();
        while written.len() < pending.len() {
            let before = written.len();
            for hash in &pending {
                if written.contains(*hash) {
                    continue;
                }
                let entry = after
                    .models
                    .entry(hash)
                    .ok_or_else(|| error("dirty model key is unavailable"))?;
                if let StoredModel::Changes {
                    base_model_hash, ..
                } = &entry.stored
                {
                    if pending.contains(base_model_hash) && !written.contains(base_model_hash) {
                        continue;
                    }
                }
                persist_model_row(&transaction, &entry.stored)?;
                written.insert(*hash);
            }
            if written.len() == before {
                return Err(error("model rows to write form a cycle"));
            }
        }
        for id in &after.dirty.worlds {
            let world = after
                .worlds
                .get(id)
                .ok_or_else(|| error("dirty world key is unavailable"))?;
            persist_world_row(&transaction, world)?;
        }
        for hash in &after.dirty.world_revisions {
            let revision = after
                .world_revisions
                .get(hash)
                .ok_or_else(|| error("dirty world revision key is unavailable"))?;
            transaction.execute(
                "INSERT INTO world_revisions(world_revision_hash, revision_json) VALUES (?1, ?2)",
                params![hash, encode_sqlite_json(revision)?],
            ).map_err(|cause| sqlite_error("failed to persist world revision", cause))?;
        }
        for hash in &after.dirty.candidates {
            let candidate = after
                .candidates
                .get(hash)
                .ok_or_else(|| error("dirty candidate key is unavailable"))?;
            persist_candidate_row(&transaction, candidate)?;
        }
        for hash in &after.dirty.narrative_source_snapshots {
            let snapshot = after
                .narrative_source_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty narrative snapshot key is unavailable"))?;
            persist_narrative_snapshot_row(&transaction, hash, snapshot)?;
        }
        let mut new_revisions: Vec<&StoredNarrativeRevision> = after
            .dirty
            .narrative_revisions
            .iter()
            .map(|hash| {
                after
                    .narrative_revisions
                    .get(hash)
                    .ok_or_else(|| error("dirty narrative revision key is unavailable"))
            })
            .collect::<EngineResult<Vec<_>>>()?;
        new_revisions.sort_by_key(|revision| revision.operation_sequence);
        for revision in new_revisions {
            persist_narrative_revision_row(&transaction, revision)?;
        }
        for hash in &after.dirty.project_documents {
            let document = after
                .project_documents
                .get(hash)
                .ok_or_else(|| error("dirty project document is unavailable"))?;
            persist_project_document_row(&transaction, document)?;
        }
        for hash in &after.dirty.project_model_snapshots {
            let model = after
                .project_model_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty project model snapshot is unavailable"))?;
            persist_project_model_snapshot_row(&transaction, hash, &model.definition)?;
        }
        for hash in &after.dirty.project_world_snapshots {
            let world = after
                .project_world_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty project world snapshot is unavailable"))?;
            persist_project_world_snapshot_row(&transaction, world)?;
        }
        for hash in &after.dirty.project_graph_snapshots {
            let graph = after
                .project_graph_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty project graph snapshot is unavailable"))?;
            persist_project_graph_snapshot_row(&transaction, hash, graph)?;
        }
        let mut checkpoints: Vec<&StoredProjectCheckpoint> = after
            .dirty
            .project_checkpoints
            .iter()
            .map(|hash| {
                after
                    .project_checkpoints
                    .get(hash)
                    .ok_or_else(|| error("dirty project checkpoint is unavailable"))
            })
            .collect::<EngineResult<Vec<_>>>()?;
        checkpoints.sort_by_key(|checkpoint| checkpoint.checkpoint_sequence);
        for checkpoint in checkpoints {
            persist_project_checkpoint_row(&transaction, checkpoint)?;
        }
        #[cfg(test)]
        before_commit(&transaction);
        commit_attempted = true;
        transaction
            .commit()
            .map_err(|cause| sqlite_error("failed to commit SQLite session transaction", cause))?;
        committed_generation = Some(next_generation);
        if migrated {
            // The whole revisions a v2 file held leave their pages free; give them back once. The write has already
            // committed, so a failure here only leaves the file larger than it needs to be.
            let _ = connection.execute_batch("VACUUM;");
        }
        harden_sqlite_permissions(path)?;
        Ok(())
    })();
    if write_result.is_err() && !existed_before && !commit_attempted {
        let _ = fs::remove_file(path);
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(sqlite_sidecar_path(path, suffix));
        }
    }
    write_result
        .map(|()| committed_generation.expect("successful commit records a generation"))
        .map_err(|cause| PersistenceFailure {
            cause,
            // A failed SQLite COMMIT can be ambiguous at the filesystem boundary.
            // Preserve the in-memory state and report the existing uncertainty code.
            state_file_replaced: commit_attempted,
        })
}

#[cfg(test)]
thread_local! {
    /// A test can run something once, between a load reading the file's storage version and reading its rows.
    pub(super) static AFTER_SCHEMA_READ: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = std::cell::RefCell::new(None);
}

#[cfg(test)]
fn after_schema_read() {
    let hook = AFTER_SCHEMA_READ.with(|cell| cell.borrow_mut().take());
    if let Some(hook) = hook {
        hook();
    }
}

#[cfg(test)]
thread_local! {
    /// A test can run something once inside a write transaction, just before it commits, to make the commit fail.
    pub(super) static BEFORE_COMMIT: std::cell::RefCell<Option<CommitHook>> = std::cell::RefCell::new(None);
}

/// What a test runs inside a write transaction before it commits.
#[cfg(test)]
pub(super) type CommitHook = Box<dyn FnOnce(&Transaction<'_>)>;

#[cfg(test)]
fn before_commit(transaction: &Transaction<'_>) {
    let hook = BEFORE_COMMIT.with(|cell| cell.borrow_mut().take());
    if let Some(hook) = hook {
        hook(transaction);
    }
}

pub(super) fn load_sqlite_session(path: &Path) -> EngineResult<PersistedSession> {
    let identity =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|cause| {
            sqlite_error(
                &format!("failed to inspect SQLite state file {}", path.display()),
                cause,
            )
        })?;
    let identity_schema: Option<String> = identity
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to inspect SQLite session identity", cause))?;
    match identity_schema {
        Some(schema) if schema == SESSION_STATE_SCHEMA || schema == SESSION_STATE_SCHEMA_V2 => {}
        Some(schema) => {
            return Err(error(format!(
                "unsupported session state schema {schema}; expected {SESSION_STATE_SCHEMA}"
            )))
        }
        None => return Err(error("SQLite state file lacks a session schema")),
    }
    drop(identity);
    let mut connection = Connection::open(path).map_err(|cause| {
        sqlite_error(
            &format!("failed to open SQLite state file {}", path.display()),
            cause,
        )
    })?;
    harden_sqlite_permissions(path)?;
    configure_sqlite(&connection)?;
    // Everything below is read from one snapshot of the file, starting with its storage version: another process that
    // writes or migrates it meanwhile cannot show this load an old version with new rows, or new rows with an old
    // generation (which would let this session's next write pass the generation check over newer content).
    let connection = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)
        .map_err(|cause| sqlite_error("failed to begin SQLite read transaction", cause))?;
    let schema: Option<String> = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to read SQLite session schema", cause))?;
    let schema = schema.ok_or_else(|| error("SQLite state file lacks a session schema"))?;
    #[cfg(test)]
    after_schema_read();
    let kept_as_changes = schema == SESSION_STATE_SCHEMA;
    if schema != SESSION_STATE_SCHEMA && schema != SESSION_STATE_SCHEMA_V2 {
        return Err(error(format!(
            "unsupported session state schema {schema}; expected {SESSION_STATE_SCHEMA}"
        )));
    }
    let generation_text: String = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .map_err(|cause| sqlite_error("failed to read SQLite session generation", cause))?;
    let persistence_generation = generation_text
        .parse::<u64>()
        .map_err(|cause| error(format!("invalid SQLite session generation: {cause}")))?;
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to check SQLite session integrity", cause))?;
    if quick_check != "ok" {
        return Err(error(format!(
            "SQLite session integrity check failed: {quick_check}"
        )));
    }
    let foreign_key_failure: Option<String> = connection
        .query_row(
            "SELECT printf('%s:%s', \"table\", rowid) FROM pragma_foreign_key_check LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to check SQLite foreign keys", cause))?;
    if let Some(failure) = foreign_key_failure {
        return Err(error(format!(
            "SQLite session foreign-key check failed at {failure}"
        )));
    }
    preflight_sqlite_limits(&connection)?;

    let mut models = Vec::new();
    {
        // Each row's hash is checked when the session rebuilds it (restore), once per revision.
        let mut statement = connection
            .prepare(if kept_as_changes {
                "SELECT model_hash, definition_json, base_model_hash FROM models ORDER BY model_hash"
            } else {
                "SELECT model_hash, definition_json, NULL FROM models ORDER BY model_hash"
            })
            .map_err(|cause| sqlite_error("failed to prepare model restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query model rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read model row", cause))?
        {
            let model_hash: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid model hash column", cause))?;
            let json: Vec<u8> = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid model JSON column", cause))?;
            let base_model_hash: Option<String> = row
                .get(2)
                .map_err(|cause| sqlite_error("invalid model base column", cause))?;
            models.push(match base_model_hash {
                None => StoredModel::Whole {
                    model_hash,
                    definition: Box::new(decode_sqlite_json(json, "model")?),
                },
                Some(base_model_hash) => StoredModel::Changes {
                    model_hash,
                    base_model_hash,
                    delta: decode_sqlite_json(json, "model delta")?,
                },
            });
        }
    }
    let mut worlds = Vec::new();
    {
        let mut statement = connection
            .prepare("SELECT world_id, model_hash, world_json FROM worlds ORDER BY world_id")
            .map_err(|cause| sqlite_error("failed to prepare world restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query world rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read world row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid world id column", cause))?;
            let model_hash: String = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid world model hash column", cause))?;
            let world: WorldHead = decode_sqlite_json(
                row.get(2)
                    .map_err(|cause| sqlite_error("invalid world JSON column", cause))?,
                "world",
            )?;
            if world.world_id != key || world.model_hash != model_hash {
                return Err(error(
                    "SQLite world row key or model hash does not match its content",
                ));
            }
            worlds.push(world);
        }
    }
    let mut candidates = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT candidate_hash, model_hash, candidate_json FROM candidates ORDER BY candidate_hash",
            )
            .map_err(|cause| sqlite_error("failed to prepare candidate restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query candidate rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read candidate row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid candidate hash column", cause))?;
            let model_hash: String = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid candidate model hash column", cause))?;
            let candidate: StoredCandidate = decode_sqlite_json(
                row.get(2)
                    .map_err(|cause| sqlite_error("invalid candidate JSON column", cause))?,
                "candidate",
            )?;
            if candidate.record.candidate.candidate_hash != key
                || candidate.record.candidate.model_hash != model_hash
            {
                return Err(error(
                    "SQLite candidate row key or model hash does not match its content",
                ));
            }
            candidates.push(candidate);
        }
    }
    let mut world_revisions = Vec::new();
    if sqlite_table_exists(&connection, "world_revisions")? {
        let mut statement = connection.prepare("SELECT world_revision_hash, revision_json FROM world_revisions ORDER BY world_revision_hash")
            .map_err(|cause| sqlite_error("failed to prepare world revision restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query world revisions", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read world revision", cause))?
        {
            let hash: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid world revision hash", cause))?;
            let revision: WorldRevision = decode_sqlite_json(
                row.get(1)
                    .map_err(|cause| sqlite_error("invalid world revision JSON", cause))?,
                "world revision",
            )?;
            if hash != revision.world_revision_hash {
                return Err(error(
                    "SQLite world revision key does not match its content",
                ));
            }
            world_revisions.push(revision);
        }
    }
    let mut narrative_source_snapshots = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT snapshot_hash, model_hash, snapshot_json FROM narrative_source_snapshots ORDER BY snapshot_hash",
            )
            .map_err(|cause| sqlite_error("failed to prepare narrative snapshot restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query narrative snapshot rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read narrative snapshot row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid narrative snapshot hash column", cause))?;
            let model_hash: String = row.get(1).map_err(|cause| {
                sqlite_error("invalid narrative snapshot model hash column", cause)
            })?;
            let stored: StoredNarrativeSourceSnapshot = decode_sqlite_json(
                row.get(2).map_err(|cause| {
                    sqlite_error("invalid narrative snapshot JSON column", cause)
                })?,
                "narrative snapshot",
            )?;
            if stored.snapshot_hash != key || stored.snapshot.model_hash != model_hash {
                return Err(error(
                    "SQLite narrative snapshot row key or model hash does not match its content",
                ));
            }
            narrative_source_snapshots.push(stored);
        }
    }
    let mut narrative_revisions = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT graph_hash, operation_sequence, graph_id, revision_number, previous_graph_hash, snapshot_hash, revision_json FROM narrative_revisions ORDER BY operation_sequence",
            )
            .map_err(|cause| sqlite_error("failed to prepare narrative revision restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query narrative revision rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read narrative revision row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid narrative graph hash column", cause))?;
            let sequence: i64 = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid narrative operation sequence", cause))?;
            let graph_id: String = row
                .get(2)
                .map_err(|cause| sqlite_error("invalid narrative graph id column", cause))?;
            let revision_number: i64 = row
                .get(3)
                .map_err(|cause| sqlite_error("invalid narrative revision number", cause))?;
            let previous_graph_hash: Option<String> = row
                .get(4)
                .map_err(|cause| sqlite_error("invalid previous narrative graph hash", cause))?;
            let snapshot_hash: String = row
                .get(5)
                .map_err(|cause| sqlite_error("invalid narrative snapshot hash", cause))?;
            let stored: StoredNarrativeRevision = decode_sqlite_json(
                row.get(6).map_err(|cause| {
                    sqlite_error("invalid narrative revision JSON column", cause)
                })?,
                "narrative revision",
            )?;
            if stored.graph_hash != key
                || i64::try_from(stored.operation_sequence).ok() != Some(sequence)
                || stored.graph_id != graph_id
                || i64::try_from(stored.revision.number).ok() != Some(revision_number)
                || stored.revision.previous_graph_hash != previous_graph_hash
                || stored.snapshot_hash != snapshot_hash
            {
                return Err(error(
                    "SQLite narrative revision columns do not match their content",
                ));
            }
            narrative_revisions.push(stored);
        }
    }
    let mut project_documents = Vec::new();
    let mut project_model_snapshots = Vec::new();
    let mut project_world_snapshots = Vec::new();
    let mut project_graph_snapshots = Vec::new();
    let mut project_checkpoints = Vec::new();
    if sqlite_table_exists(&connection, "project_checkpoints")? {
        {
            let mut statement = connection
                .prepare("SELECT document_hash, media_type, content FROM project_documents ORDER BY document_hash")
                .map_err(|cause| sqlite_error("failed to prepare project document restore", cause))?;
            let rows = statement
                .query_map([], |row| {
                    Ok(StoredProjectDocument {
                        document_hash: row.get(0)?,
                        media_type: row.get(1)?,
                        content: row.get(2)?,
                    })
                })
                .map_err(|cause| sqlite_error("failed to query project documents", cause))?;
            for row in rows {
                project_documents.push(
                    row.map_err(|cause| sqlite_error("failed to read project document", cause))?,
                );
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT model_hash, model_id, definition_json FROM project_model_snapshots ORDER BY model_hash")
                .map_err(|cause| sqlite_error("failed to prepare project model restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project models", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project model", cause))?
            {
                let hash: String = row
                    .get(0)
                    .map_err(|cause| sqlite_error("invalid project model hash", cause))?;
                let id: String = row
                    .get(1)
                    .map_err(|cause| sqlite_error("invalid project model id", cause))?;
                let definition: ModelDefinition = decode_sqlite_json(
                    row.get(2)
                        .map_err(|cause| sqlite_error("invalid project model JSON", cause))?,
                    "project model",
                )?;
                let compiled = compile_model(definition.clone())?;
                if compiled.model_hash != hash || compiled.id != id {
                    return Err(error("SQLite project model columns do not match content"));
                }
                project_model_snapshots.push(definition);
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT world_hash, world_id, model_hash, world_json FROM project_world_snapshots ORDER BY world_hash")
                .map_err(|cause| sqlite_error("failed to prepare project world restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project worlds", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project world", cause))?
            {
                let hash: String = row
                    .get(0)
                    .map_err(|cause| sqlite_error("invalid project world hash", cause))?;
                let id: String = row
                    .get(1)
                    .map_err(|cause| sqlite_error("invalid project world id", cause))?;
                let model_hash: String = row
                    .get(2)
                    .map_err(|cause| sqlite_error("invalid project world model hash", cause))?;
                let world: WorldHead = decode_sqlite_json(
                    row.get(3)
                        .map_err(|cause| sqlite_error("invalid project world JSON", cause))?,
                    "project world",
                )?;
                if world.world_hash != hash
                    || world.world_id != id
                    || world.model_hash != model_hash
                {
                    return Err(error("SQLite project world columns do not match content"));
                }
                project_world_snapshots.push(world);
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT narrative_graph_snapshot_hash, graph_hash, model_hash, source_snapshot_hash, graph_json FROM project_graph_snapshots ORDER BY narrative_graph_snapshot_hash")
                .map_err(|cause| sqlite_error("failed to prepare project graph restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project graphs", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project graph", cause))?
            {
                let project_snapshot_hash: String = row.get(0).map_err(|cause| {
                    sqlite_error("invalid project graph snapshot identity", cause)
                })?;
                let graph_hash: String = row
                    .get(1)
                    .map_err(|cause| sqlite_error("invalid project graph hash", cause))?;
                let model_hash: String = row
                    .get(2)
                    .map_err(|cause| sqlite_error("invalid project graph model hash", cause))?;
                let snapshot_hash: String = row
                    .get(3)
                    .map_err(|cause| sqlite_error("invalid project graph snapshot hash", cause))?;
                let graph: StoredNarrativeGraph = decode_sqlite_json(
                    row.get(4)
                        .map_err(|cause| sqlite_error("invalid project graph JSON", cause))?,
                    "project graph",
                )?;
                if graph.graph_hash != graph_hash
                    || graph.snapshot.model_hash != model_hash
                    || graph.snapshot_hash != snapshot_hash
                    || project_graph_snapshot_hash(&graph)? != project_snapshot_hash
                {
                    return Err(error("SQLite project graph columns do not match content"));
                }
                project_graph_snapshots.push(graph);
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT checkpoint_hash, checkpoint_name, checkpoint_sequence, parent_checkpoint_hash, document_hash, model_hash, world_hash, graph_hash, narrative_graph_snapshot_hash, checkpoint_json FROM project_checkpoints ORDER BY checkpoint_sequence")
                .map_err(|cause| sqlite_error("failed to prepare project checkpoint restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project checkpoints", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project checkpoint", cause))?
            {
                let checkpoint: StoredProjectCheckpoint = decode_sqlite_json(
                    row.get(9)
                        .map_err(|cause| sqlite_error("invalid project checkpoint JSON", cause))?,
                    "project checkpoint",
                )?;
                let sequence: i64 = row
                    .get(2)
                    .map_err(|cause| sqlite_error("invalid project checkpoint sequence", cause))?;
                if checkpoint.checkpoint_hash
                    != row
                        .get::<_, String>(0)
                        .map_err(|cause| sqlite_error("invalid project checkpoint hash", cause))?
                    || checkpoint.core.name
                        != row.get::<_, String>(1).map_err(|cause| {
                            sqlite_error("invalid project checkpoint name", cause)
                        })?
                    || i64::try_from(checkpoint.checkpoint_sequence).ok() != Some(sequence)
                    || checkpoint.core.parent_checkpoint_hash
                        != row.get::<_, Option<String>>(3).map_err(|cause| {
                            sqlite_error("invalid project checkpoint parent", cause)
                        })?
                    || checkpoint.core.document_hash
                        != row.get::<_, String>(4).map_err(|cause| {
                            sqlite_error("invalid project checkpoint document", cause)
                        })?
                    || checkpoint.core.model_hash
                        != row.get::<_, Option<String>>(5).map_err(|cause| {
                            sqlite_error("invalid project checkpoint model", cause)
                        })?
                    || checkpoint.core.world_hash
                        != row.get::<_, Option<String>>(6).map_err(|cause| {
                            sqlite_error("invalid project checkpoint world", cause)
                        })?
                    || checkpoint.core.narrative_graph_hash
                        != row.get::<_, Option<String>>(7).map_err(|cause| {
                            sqlite_error("invalid project checkpoint graph", cause)
                        })?
                    || checkpoint.core.narrative_graph_snapshot_hash
                        != row.get::<_, Option<String>>(8).map_err(|cause| {
                            sqlite_error("invalid project checkpoint graph snapshot", cause)
                        })?
                {
                    return Err(error(
                        "SQLite project checkpoint columns do not match content",
                    ));
                }
                project_checkpoints.push(checkpoint);
            }
        }
    }
    Ok(PersistedSession {
        // A v2 file's whole revisions are read into the same form; the file itself is migrated on its first write.
        schema: if kept_as_changes {
            schema
        } else {
            SESSION_STATE_SCHEMA.to_owned()
        },
        persistence_generation,
        models,
        worlds,
        world_revisions,
        candidates,
        narrative_source_snapshots,
        narrative_revisions,
        project_documents,
        project_model_snapshots,
        project_world_snapshots,
        project_graph_snapshots,
        project_checkpoints,
    })
}
