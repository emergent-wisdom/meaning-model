//! Every bound the engine enforces on a model, a query, a session and a stored file, in one table that `describe`
//! reports to callers, and how a value's serialized size is measured against them without serializing it into memory.
//! The bounds of the optional Meaning Model layer, of narrative graphs and of the legacy registry live beside their
//! records (model/meaning.rs, model/narrative.rs, registry.rs), and `describe` reports them too.
//!
//! Each bound is checked before the work or the change it limits: a transition's budget before it rolls
//! (model/transition.rs), the session's capacity before it stores anything (session/capacity.rs).

use std::io::{self, Write};

use serde::Serialize;

use crate::{error, EngineResult};

pub(super) const MAX_STEP_COUNT: usize = 1_000_000;
pub(super) const MAX_LAW_PROCESS_EVALUATIONS: usize = 50_000_000;
pub(super) const MAX_RETAINED_STATE_BYTES: usize = 16 * 1024 * 1024;
pub(super) const MAX_POTENTIAL_ACTIVITY_RECORDS: usize = 250_000;
pub(super) const MAX_POTENTIAL_ACTIVITY_BYTES: usize = 64 * 1024 * 1024;
pub(super) const MAX_STATE_BYTE_STEPS: usize = 1024 * 1024 * 1024;
pub(super) const MAX_EXPRESSION_DEPTH: usize = 96;
pub(super) const MAX_MODEL_EXPRESSION_NODES: usize = 250_000;
pub(super) const MAX_QUERY_DURATION: f64 = 30.0;
pub(super) const MAX_QUERY_INTERVENTIONS: usize = 1_000;
pub(super) const MAX_QUERY_OBSERVATIONS: usize = 1_000;
pub(super) const MAX_OBSERVATION_PROVENANCE: usize = 64;
pub(super) const MAX_QUERY_SUPPORT: usize = 2_048;
pub(super) const MAX_QUERY_OBSERVABLES: usize = 2_048;
pub(super) const MAX_QUERY_ACCESS_SCOPES: usize = 64;
pub(super) const MAX_QUERY_STRING_BYTES: usize = 1_024;
pub(super) const MAX_MODEL_IDENTIFIER_BYTES: usize = 1_024;
// Set from measurement (0.12.1): a revision of a model this size takes about 15 s and needs about 8 GB at its peak; a
// model of 2.8 MB takes under half a second. Larger models need changes applied in the engine instead of whole
// definitions passing through the server.
pub(super) const MAX_MODEL_DEFINITION_BYTES: usize = 128 * 1024 * 1024;
// Every revision keeps a header in memory. Durable stores leave sealed revision rows on disk; the byte bound below
// applies to unwritten rows (all rows in an in-memory session), separately from the bounded read caches.
pub(super) const MAX_SESSION_MODELS: usize = 262_144;
pub(super) const MAX_SESSION_WORLDS: usize = 64;
pub(super) const MAX_SESSION_CANDIDATES: usize = 2_048;
pub(super) const MAX_SESSION_WORLD_REVISIONS: usize = 2_048;
pub(super) const MAX_SESSION_WORLD_REVISION_BYTES: usize = 64 * 1024 * 1024;
// Every graph revision keeps its header. Heads and recently used revisions are materialized with shared records.
pub(super) const MAX_SESSION_NARRATIVE_GRAPHS: usize = 262_144;
pub(super) const MAX_SESSION_MODEL_BYTES: usize = 2 * 1024 * 1024 * 1024;
pub(super) const MAX_SESSION_WORLD_BYTES: usize = 64 * 1024 * 1024;
pub(super) const MAX_SESSION_CANDIDATE_BYTES: usize = 128 * 1024 * 1024;
// Narrative history is stored as shared source snapshots plus append-only
// revision deltas. This bound applies to unwritten rows and snapshots (all rows in an in-memory session),
// not to the complete disk history or transient materialized graph views.
pub(super) const MAX_SESSION_NARRATIVE_BYTES: usize = 1024 * 1024 * 1024;
pub(super) const MAX_PROJECT_CHECKPOINTS: usize = 1_024;
pub(super) const MAX_PROJECT_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
pub(super) const MAX_PROJECT_STORAGE_BYTES: usize = 2 * 1024 * 1024 * 1024;
pub(super) const MAX_PROJECT_EXPORT_BYTES: usize = 480 * 1024 * 1024;
pub(super) const MAX_SESSION_REPLAY_WORK: usize = 250_000_000;
pub(super) const MAX_TRAJECTORY_SUMMARY_WORK: usize = 10_000_000;
pub(super) const MAX_GRAPH_NEIGHBORHOOD_DEPTH: usize = 16;
pub(super) const MAX_GRAPH_SKELETON_ROOTS: usize = 20;
pub(super) const MAX_GRAPH_SKELETON_HUBS: usize = 12;
pub(super) const MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW: usize = 128;
pub(super) const MAX_VALUE_POINTS: usize = 4_000_000;
pub(super) const MAX_VALUE_TEXT_BYTES: usize = 4_000;

/// Counts the bytes written to it, so a value's serialized size is known without keeping its serialization.
#[derive(Default)]
struct CountingWriter {
    bytes: usize,
}

impl Write for CountingWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes = self
            .bytes
            .checked_add(buffer.len())
            .ok_or_else(|| io::Error::other("serialized size overflow"))?;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn serialized_size(value: &impl Serialize) -> EngineResult<usize> {
    let mut writer = CountingWriter::default();
    serde_json::to_writer(&mut writer, value)
        .map_err(|cause| error(format!("failed to estimate serialized size: {cause}")))?;
    Ok(writer.bytes)
}

pub(super) fn serialized_sum<'a, T: Serialize + 'a>(
    mut values: impl Iterator<Item = &'a T>,
) -> EngineResult<usize> {
    values.try_fold(0usize, |total, value| {
        total
            .checked_add(serialized_size(value)?)
            .ok_or_else(|| error("aggregate serialized size overflow"))
    })
}
