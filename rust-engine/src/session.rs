//! The machine session: the engine's authoritative store of model revisions, worlds and their revisions, candidates,
//! narrative graphs and project checkpoints. It runs each machine command against the model and keeps what changes.
//!
//! A command flows through `parse_and_execute` in three steps. It is read: a command naming a machine operation is
//! parsed into a `MachineCommand`, and anything else goes to the legacy registry commands. It is run durably: its
//! group's handler (models.rs, worlds.rs, candidates.rs, queries.rs, narrative.rs, checkpoints.rs) runs it, and a
//! durable session writes what it changed. It is answered in the response envelope.
//!
//! The session keeps these invariants:
//! - Validate, then change. A handler checks the command, the expectations it carries (the head, hash or version it
//!   was written against) and the session's capacity, and builds its answer, before its first change, so a refused
//!   command leaves the session as it was. Should a command still fail after changing a durable session, its changes
//!   are discarded by reloading the file; an in-memory session has no file to return to and keeps them.
//! - Every change marks its row dirty, and a durable session writes all of a command's dirty rows in one SQLite
//!   transaction before it answers. A mutating command is refused while earlier rows are unwritten.
//! - A failed write returns the session to what its file holds, and the caller is told which outcome it has:
//!   `persistence_error` when the write certainly did not happen, and `persistence_uncertain` when its COMMIT was
//!   attempted and the file then cannot be read back or holds a later generation.
//! - The model's errors are answered as `invalid_request`; every other code a machine command can get (`not_found`,
//!   `conflict`, `persistence_error`, `persistence_uncertain`, `internal_error`) is chosen here.
//! - The store's fields are private to this module and its children, so nothing else can change them.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::candidate::StoredCandidate;
use crate::model::compile::CompiledModel;
use crate::model::definition::ModelDefinition;
use crate::model::graph::{GraphQuery, GraphQueryError};
use crate::model::narrative::{
    MaterializedNarrative, NarrativeGraphBatch, NarrativeGraphChange, NarrativeGraphDefinition,
    NarrativeGraphQuery, NarrativeHistorySpec, NarrativeRenderSpec, NarrativeSourceSnapshot,
    NarrativeTrainingSpec, StoredNarrativeGraph, StoredNarrativeRevision,
};
use crate::model::project::{
    ProjectCheckpointDefinition, StoredProjectCheckpoint, StoredProjectDocument,
};
use crate::model::query::ModelTransitionSpec;
use crate::model::trajectory::TrajectorySummarySpec;
use crate::model::view::ViewSpec;
use crate::model::world::{WorldHead, WorldRevision, WorldRevisionSpec};
use crate::profiles::ProfileCompilationRequest;
use crate::session::model_store::ModelStore;
use crate::session::operation::MachineOperation;
use crate::session::persistence::{
    load_sqlite_session, persist_sqlite_changes, PersistenceFailure,
};
use crate::{error, EngineResult, ErrorBody, ResponseEnvelope};

// The command handlers, one per operation group, and the reads of narrative graphs.
mod candidates;
mod checkpoints;
mod models;
mod narrative;
mod narrative_views;
mod queries;
mod worlds;

// The store itself: which operations exist and which change it, its capacity, model revisions kept as their
// changes, the SQLite state file, and restoring a session from it.
mod capacity;
mod model_delta;
mod model_store;
mod operation;
mod persistence;
mod restore;
pub use operation::is_machine_operation;

/// The name of every machine operation, in the order `describe` lists them.
pub(crate) fn machine_operation_names() -> [&'static str; 32] {
    MachineOperation::ALL.map(MachineOperation::name)
}

#[cfg(test)]
mod tests;

/// The schema of the SQLite state file. v3 keeps a model revision whose previous revision is stored as its changes
/// from it (models.base_model_hash). A v2 file, where every revision is whole, is read as it is and rewritten as v3 on
/// its first write.
pub const SESSION_STATE_SCHEMA: &str = "life-sim-rust-session-state/v3";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct MachineCommand {
    schema: String,
    #[serde(default)]
    request_id: Option<String>,
    operation: MachineOperation,
    #[serde(default)]
    model: Option<ModelDefinition>,
    #[serde(default)]
    profile_request: Option<ProfileCompilationRequest>,
    #[serde(default)]
    model_hash: Option<String>,
    #[serde(default)]
    world_id: Option<String>,
    #[serde(default)]
    world_revision: Option<WorldRevisionSpec>,
    #[serde(default)]
    world_revision_hash: Option<String>,
    #[serde(default)]
    candidate_hash: Option<String>,
    #[serde(default)]
    query: Option<ModelTransitionSpec>,
    #[serde(default)]
    trajectory_summary: Option<TrajectorySummarySpec>,
    #[serde(default)]
    view: Option<ViewSpec>,
    #[serde(default)]
    graph_query: Option<GraphQuery>,
    #[serde(default)]
    narrative_graph: Option<NarrativeGraphDefinition>,
    #[serde(default)]
    preserve_narrative_source_snapshot: bool,
    #[serde(default)]
    narrative_batch: Option<NarrativeGraphBatch>,
    #[serde(default)]
    narrative_change: Option<NarrativeGraphChange>,
    #[serde(default)]
    narrative_graph_hash: Option<String>,
    #[serde(default)]
    narrative_query: Option<NarrativeGraphQuery>,
    #[serde(default)]
    narrative_render: Option<NarrativeRenderSpec>,
    #[serde(default)]
    narrative_training: Option<NarrativeTrainingSpec>,
    #[serde(default)]
    narrative_history: Option<NarrativeHistorySpec>,
    #[serde(default)]
    project_checkpoint: Option<ProjectCheckpointDefinition>,
    #[serde(default)]
    project_checkpoint_id: Option<String>,
}

#[derive(Debug)]
struct MachineError {
    code: &'static str,
    message: String,
}

impl From<crate::EngineError> for MachineError {
    fn from(value: crate::EngineError) -> Self {
        Self {
            code: "invalid_request",
            message: value.0,
        }
    }
}

impl From<GraphQueryError> for MachineError {
    fn from(value: GraphQueryError) -> Self {
        match value {
            GraphQueryError::Invalid(message) => machine_error("invalid_request", message),
            GraphQueryError::NotFound(message) => machine_error("not_found", message),
            GraphQueryError::Conflict(message) => machine_error("conflict", message),
        }
    }
}

fn machine_error(code: &'static str, message: impl Into<String>) -> MachineError {
    MachineError {
        code,
        message: message.into(),
    }
}

fn required<T>(value: Option<T>, message: &'static str) -> Result<T, MachineError> {
    value.ok_or_else(|| machine_error("invalid_request", message))
}

fn encode(value: impl Serialize) -> Result<serde_json::Value, MachineError> {
    serde_json::to_value(value).map_err(|cause| {
        machine_error(
            "internal_error",
            format!("failed to encode machine response: {cause}"),
        )
    })
}

/// A kind of stored row, one per table of the state file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirtyRow {
    Model,
    World,
    WorldRevision,
    Candidate,
    NarrativeSourceSnapshot,
    NarrativeRevision,
    ProjectDocument,
    ProjectModelSnapshot,
    ProjectWorldSnapshot,
    ProjectGraphSnapshot,
    ProjectCheckpoint,
}

/// The keys of the rows a command has changed, by kind, which the next write stores.
#[derive(Debug, Clone, Default)]
struct SessionDirty {
    models: BTreeSet<String>,
    worlds: BTreeSet<String>,
    world_revisions: BTreeSet<String>,
    candidates: BTreeSet<String>,
    narrative_source_snapshots: BTreeSet<String>,
    narrative_revisions: BTreeSet<String>,
    project_documents: BTreeSet<String>,
    project_model_snapshots: BTreeSet<String>,
    project_world_snapshots: BTreeSet<String>,
    project_graph_snapshots: BTreeSet<String>,
    project_checkpoints: BTreeSet<String>,
}

impl SessionDirty {
    fn is_empty(&self) -> bool {
        self.models.is_empty()
            && self.worlds.is_empty()
            && self.world_revisions.is_empty()
            && self.candidates.is_empty()
            && self.narrative_source_snapshots.is_empty()
            && self.narrative_revisions.is_empty()
            && self.project_documents.is_empty()
            && self.project_model_snapshots.is_empty()
            && self.project_world_snapshots.is_empty()
            && self.project_graph_snapshots.is_empty()
            && self.project_checkpoints.is_empty()
    }

    fn rows(&mut self, row: DirtyRow) -> &mut BTreeSet<String> {
        match row {
            DirtyRow::Model => &mut self.models,
            DirtyRow::World => &mut self.worlds,
            DirtyRow::WorldRevision => &mut self.world_revisions,
            DirtyRow::Candidate => &mut self.candidates,
            DirtyRow::NarrativeSourceSnapshot => &mut self.narrative_source_snapshots,
            DirtyRow::NarrativeRevision => &mut self.narrative_revisions,
            DirtyRow::ProjectDocument => &mut self.project_documents,
            DirtyRow::ProjectModelSnapshot => &mut self.project_model_snapshots,
            DirtyRow::ProjectWorldSnapshot => &mut self.project_world_snapshots,
            DirtyRow::ProjectGraphSnapshot => &mut self.project_graph_snapshots,
            DirtyRow::ProjectCheckpoint => &mut self.project_checkpoints,
        }
    }
}

#[cfg(test)]
thread_local! {
    /// A test can make the next command fail after it has made its changes, as a command would that failed after
    /// marking rows dirty.
    static FAIL_AFTER_EXECUTE: std::cell::RefCell<Option<MachineError>> = const { std::cell::RefCell::new(None) };
}

/// The authoritative store of one engine process: model revisions, world heads and their revisions, candidates,
/// narrative graph revisions and project checkpoints. It answers every machine command through `parse_and_execute`.
/// Opened with `with_state_file` it is durable: each command's changes are written to the SQLite file before the
/// command is answered, and reopening the file restores the session after checking all of it.
#[derive(Debug, Default)]
pub struct MachineSession {
    models: ModelStore,
    worlds: BTreeMap<String, WorldHead>,
    world_revisions: BTreeMap<String, WorldRevision>,
    candidates: BTreeMap<String, StoredCandidate>,
    narrative_source_snapshots: BTreeMap<String, NarrativeSourceSnapshot>,
    narrative_revisions: BTreeMap<String, StoredNarrativeRevision>,
    // Every stored revision materialized, sharing unchanged records with its
    // parent. Rebuilt on restore and extended by insert_narrative_revision;
    // never persisted, because the revision records are the durable form.
    narrative_materialized: BTreeMap<String, MaterializedNarrative>,
    project_documents: BTreeMap<String, StoredProjectDocument>,
    project_model_snapshots: BTreeMap<String, CompiledModel>,
    project_world_snapshots: BTreeMap<String, WorldHead>,
    project_graph_snapshots: BTreeMap<String, StoredNarrativeGraph>,
    project_checkpoints: BTreeMap<String, StoredProjectCheckpoint>,
    project_checkpoint_names: BTreeMap<String, String>,
    // Exact serialized size of the compact narrative snapshots and revision
    // records. It is rebuilt once on restore and then maintained
    // incrementally, so an append does not rescan the whole history.
    narrative_storage_bytes: usize,
    next_narrative_operation_sequence: u64,
    next_project_checkpoint_sequence: u64,
    persistence_generation: u64,
    dirty: SessionDirty,
    state_file: Option<PathBuf>,
}

impl MachineSession {
    /// Opens a single-writer durable session. If the path does not exist, the
    /// first successful mutation creates it; construction itself has no file
    /// side effects.
    pub fn with_state_file(path: impl Into<PathBuf>) -> EngineResult<Self> {
        let path = path.into();
        if path.as_os_str().is_empty() {
            return Err(error("state file path must be nonempty"));
        }
        if !path.exists() {
            return Ok(Self {
                state_file: Some(path),
                ..Self::default()
            });
        }
        let persisted = load_sqlite_session(&path)?;
        let mut session = Self::restore(persisted)?;
        session.state_file = Some(path);
        Ok(session)
    }

    /// The state file of a durable session.
    pub fn state_file(&self) -> Option<&Path> {
        self.state_file.as_deref()
    }

    /// Records that a row changed and must be written when the command ends. A session without a state file has
    /// nothing to write, and records nothing.
    fn mark_dirty(&mut self, row: DirtyRow, key: impl Into<String>) {
        if self.state_file.is_some() {
            self.dirty.rows(row).insert(key.into());
        }
    }

    /// Returns a durable session to what its state file holds, dropping changes that were not written: it is
    /// reloaded from the file, or emptied when no file has been written yet. On a reload failure the session is
    /// left as it was, unwritten changes included.
    fn discard_unwritten_changes(&mut self) -> EngineResult<()> {
        match self.state_file.clone() {
            Some(path) if path.exists() => self.reload_from_sqlite(),
            Some(path) => {
                *self = Self {
                    state_file: Some(path),
                    ..Self::default()
                };
                Ok(())
            }
            None => Ok(()),
        }
    }

    fn persist(&mut self) -> Result<(), PersistenceFailure> {
        if self.dirty.is_empty() {
            return Ok(());
        }
        let Some(path) = &self.state_file else {
            return Ok(());
        };
        let next_generation = persist_sqlite_changes(path, self)?;
        self.persistence_generation = next_generation;
        self.dirty = SessionDirty::default();
        Ok(())
    }

    /// Answers one command. A machine operation is run by this session; any other command (`describe`,
    /// `compile_registry`, `roll`, or an operation nothing knows) is answered by the legacy registry commands.
    pub fn parse_and_execute(&mut self, input: &str) -> ResponseEnvelope {
        let command = match read_machine_command(input) {
            Ok(command) => command,
            Err(answered) => return answered,
        };
        let request_id = command.request_id.clone();
        let outcome = self.execute_durably(command);
        answer(request_id, outcome)
    }

    /// Runs a command and, in a durable session, makes its changes durable. A mutating command is refused while
    /// earlier changes are unwritten. Its changes are written to the state file before it is answered; when they
    /// cannot be, the session returns to what the file holds and the caller is told whether the write certainly did
    /// not happen or may have. A command that fails after changing the session has its changes discarded the same way.
    fn execute_durably(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let durable_mutation = self.state_file.is_some() && command.operation.mutates();
        if durable_mutation && !self.dirty.is_empty() {
            return Err(machine_error(
                "internal_error",
                "durable session began a command with unflushed dirty rows",
            ));
        }
        let prior_generation = self.persistence_generation;
        let outcome = self.execute(command);
        #[cfg(test)]
        let outcome = match FAIL_AFTER_EXECUTE.with(|cell| cell.borrow_mut().take()) {
            Some(failure) => Err(failure),
            None => outcome,
        };
        if !durable_mutation || self.dirty.is_empty() {
            return outcome;
        }
        match outcome {
            Ok(result) => match self.persist() {
                Ok(()) => Ok(result),
                Err(failure) => Err(self.failed_write(failure, prior_generation)),
            },
            Err(cause) => {
                // The command's own error is what the caller is told; a failed reload is reported beside it, since
                // the session then keeps the unwritten changes in memory and refuses further mutations.
                if let Err(reload) = self.discard_unwritten_changes() {
                    eprintln!(
                        "failed command left changes the session could not discard: authoritative reload failed: {}",
                        reload.0
                    );
                }
                Err(cause)
            }
        }
    }

    /// Returns the session to its state file after a failed write, and says what the caller is told. The write did
    /// not happen (`persistence_error`) unless its COMMIT was attempted and the file then either could not be read
    /// back or holds a later generation (`persistence_uncertain`). A failed reload is added to either message.
    fn failed_write(&mut self, failure: PersistenceFailure, prior_generation: u64) -> MachineError {
        let recovery = self.discard_unwritten_changes();
        let uncertain = failure.state_file_replaced
            && (recovery.is_err() || self.persistence_generation > prior_generation);
        let recovery_suffix = recovery
            .err()
            .map(|cause| format!("; authoritative reload also failed: {}", cause.0))
            .unwrap_or_default();
        if uncertain {
            machine_error(
                "persistence_uncertain",
                format!(
                    "SQLite commit outcome is uncertain: {}{recovery_suffix}",
                    failure.cause.0
                ),
            )
        } else {
            machine_error(
                "persistence_error",
                format!(
                    "state mutation was not committed: {}{recovery_suffix}",
                    failure.cause.0
                ),
            )
        }
    }

    fn execute(&mut self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        if command.schema != crate::COMMAND_SCHEMA {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "unsupported command schema {}; expected {}",
                    command.schema,
                    crate::COMMAND_SCHEMA
                ),
            ));
        }
        match command.operation {
            MachineOperation::Model(operation) => self.execute_model_command(operation, command),
            MachineOperation::World(operation) => self.execute_world_command(operation, command),
            MachineOperation::Candidate(operation) => {
                self.execute_candidate_command(operation, command)
            }
            MachineOperation::Query(operation) => self.execute_query_command(operation, command),
            MachineOperation::Narrative(operation) => {
                self.execute_narrative_command(operation, command)
            }
            MachineOperation::Checkpoint(operation) => {
                self.execute_checkpoint_command(operation, command)
            }
        }
    }
}

/// Reads a command that names a machine operation. Any other input is answered at once, and the answer is returned
/// as the error: input that is not JSON, or a machine command whose fields do not parse, as `invalid_json`; any
/// other operation by the legacy registry commands.
fn read_machine_command(input: &str) -> Result<MachineCommand, ResponseEnvelope> {
    let probe = serde_json::from_str::<serde_json::Value>(input)
        .map_err(|cause| answer(None, Err(machine_error("invalid_json", cause.to_string()))))?;
    let names_machine_operation = probe
        .get("operation")
        .and_then(serde_json::Value::as_str)
        .is_some_and(is_machine_operation);
    if !names_machine_operation {
        return Err(crate::parse_and_execute(input));
    }
    let probed_request_id = probe
        .get("request_id")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    serde_json::from_value::<MachineCommand>(probe).map_err(|cause| {
        answer(
            probed_request_id,
            Err(machine_error("invalid_json", cause.to_string())),
        )
    })
}

/// The response to a command: its result, or its error's code and message.
fn answer(
    request_id: Option<String>,
    outcome: Result<serde_json::Value, MachineError>,
) -> ResponseEnvelope {
    match outcome {
        Ok(result) => ResponseEnvelope {
            schema: crate::RESPONSE_SCHEMA,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(cause) => ResponseEnvelope {
            schema: crate::RESPONSE_SCHEMA,
            request_id,
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: cause.code,
                message: cause.message,
            }),
        },
    }
}
