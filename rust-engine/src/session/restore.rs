//! Restoring a session from its state file. Revision seal chains are checked first; unsealed revisions are rebuilt
//! and validated, while sealed rows stay on disk and are checked against their seals when read. The accepted lineage
//! and stored candidates are still validated and replayed. A failed startup check refuses the whole open. An explicit
//! audit rebuilds every revision, including those already sealed.

use std::collections::{BTreeMap, BTreeSet};

use crate::limits::{
    serialized_size, serialized_sum, MAX_MODEL_IDENTIFIER_BYTES, MAX_OBSERVATION_PROVENANCE,
    MAX_PROJECT_CHECKPOINTS, MAX_PROJECT_DOCUMENT_BYTES, MAX_SESSION_CANDIDATES,
    MAX_SESSION_CANDIDATE_BYTES, MAX_SESSION_MODELS, MAX_SESSION_NARRATIVE_GRAPHS,
    MAX_SESSION_REPLAY_WORK, MAX_SESSION_WORLD_REVISIONS, MAX_SESSION_WORLD_REVISION_BYTES,
};
use crate::model::candidate::CandidateStatus;
use crate::model::compile::{compile_model, validate_process_value};
#[cfg(test)]
use crate::model::narrative::StoredNarrativeSourceSnapshot;
use crate::model::narrative::{
    build_narrative_graph_delta, compile_narrative_graph, validate_narrative_insertion_order,
    validate_narrative_revision_record_hash, MaterializedNarrative, NarrativeRevisionPayload,
    StoredNarrativeRevision, MAX_NARRATIVE_STRING_BYTES, NARRATIVE_REVISION_STORE_SCHEMA,
};
#[cfg(test)]
use crate::model::project::StoredProjectCheckpoint;
use crate::model::project::{
    is_project_checkpoint_hash_shaped_name, project_graph_snapshot_hash,
    validate_project_graph_source_binding,
};
use crate::model::revision::validate_revision_process_changes;
use crate::model::transition::{candidate_replay_work, roll_model_transition};
use crate::model::world::{build_world_revision, validate_world, WorldRevisionSpec};
use crate::model::PROJECT_CHECKPOINT_SCHEMA;
use crate::session::model_store::model_header;
use crate::session::model_store::{self, StoredModel};
use crate::session::persistence::{load_sqlite, LoadMode, PersistedSession, StoreIndex};
use crate::session::store_rows::{NarrativeHeader, Seal, SealKind, SealRef};
use crate::session::MachineSession;
use crate::session::NarrativeEntry;
use crate::session::SESSION_STATE_SCHEMA;
use crate::{error, hash_serializable, EngineResult};
use std::path::Path;

impl MachineSession {
    pub(super) fn restore(persisted: PersistedSession) -> EngineResult<Self> {
        Ok(Self::build(persisted, None)?.0)
    }

    fn validate_narrative_revision_chains(&self) -> EngineResult<()> {
        let mut roots = BTreeSet::new();
        let mut operation_sequences = BTreeSet::new();
        for stored in self.narrative_revisions.values() {
            if !operation_sequences.insert(stored.operation_sequence) {
                return Err(error("narrative operation sequence is duplicated"));
            }
            let revision = &stored.revision;
            match &revision.previous_graph_hash {
                None => {
                    if revision.number != 0 || !roots.insert(stored.graph_id.as_str()) {
                        return Err(error(
                            "narrative graph store contains an invalid revision root",
                        ));
                    }
                }
                Some(previous_hash) => {
                    let previous =
                        self.narrative_revisions.get(previous_hash).ok_or_else(|| {
                            error(format!(
                                "narrative graph {} lacks previous revision {previous_hash}",
                                stored.graph_hash
                            ))
                        })?;
                    if previous.graph_id != stored.graph_id
                        || revision.number != previous.revision.number + 1
                        || previous.operation_sequence >= stored.operation_sequence
                    {
                        return Err(error("narrative graph revision chain is broken"));
                    }
                }
            }
        }
        if operation_sequences.len() != self.next_narrative_operation_sequence as usize
            || operation_sequences
                .iter()
                .copied()
                .ne(0..self.next_narrative_operation_sequence)
        {
            return Err(error(
                "narrative operation sequences must form one contiguous append-only history",
            ));
        }
        Ok(())
    }

    fn validate_restored_lineage(&self) -> EngineResult<()> {
        let mut accepted = BTreeSet::new();
        let mut accepted_revisions = BTreeSet::new();
        for world in self.worlds.values() {
            let mut cursor = world.clone();
            loop {
                if cursor.version == 0 {
                    let model = self
                        .models
                        .get(&cursor.model_hash)?
                        .ok_or_else(|| error("state file world model is unavailable"))?;
                    if cursor.lineage_head.is_some()
                        || cursor != model.genesis_world(cursor.world_id.clone())?
                    {
                        return Err(error(
                            "state file accepted lineage does not end at the model genesis world",
                        ));
                    }
                    break;
                }
                let hash = cursor.lineage_head.clone().ok_or_else(|| {
                    error("state file accepted world lacks a lineage-head candidate")
                })?;
                if let Some(revision) = self.world_revisions.get(&hash) {
                    if !accepted_revisions.insert(hash.clone()) || revision.target_head != cursor {
                        return Err(error("state file accepted lineage has an incoherent or repeated world revision"));
                    }
                    cursor = revision.source_head.clone();
                    continue;
                }
                if !accepted.insert(hash.clone()) {
                    return Err(error("state file accepted lineage repeats a candidate"));
                }
                let stored = self.candidates.get(&hash).ok_or_else(|| {
                    error(format!(
                        "state file accepted lineage names unknown candidate {hash}"
                    ))
                })?;
                if stored.record.status != CandidateStatus::Committed
                    || stored.record.candidate.candidate_hash != hash
                    || stored.record.candidate.world_id != cursor.world_id
                    || stored.record.proposed_head != cursor
                    || stored.parent.world_id != cursor.world_id
                    || stored.parent.version.checked_add(1) != Some(cursor.version)
                    || stored.record.candidate.parent_world_hash != stored.parent.world_hash
                    || stored.record.candidate.expected_parent_version != stored.parent.version
                {
                    return Err(error(
                        "state file accepted lineage has incoherent status, world, or parent links",
                    ));
                }
                cursor = stored.parent.clone();
            }
        }
        if accepted_revisions.len() != self.world_revisions.len() {
            return Err(error(
                "state file world revisions do not match accepted world ancestry",
            ));
        }
        for (hash, stored) in &self.candidates {
            let is_accepted = accepted.contains(hash);
            if (stored.record.status == CandidateStatus::Committed) != is_accepted {
                return Err(error(
                    "state file committed candidate set does not match accepted world ancestry",
                ));
            }
        }
        Ok(())
    }

    pub(super) fn reload_from_sqlite(&mut self) -> EngineResult<()> {
        let path = self
            .state_file
            .clone()
            .ok_or_else(|| error("cannot reload a session without a state file"))?;
        let (restored, _, _) = Self::open_store(&path, true)?;
        *self = restored;
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn snapshot(&self) -> PersistedSession {
        let mut narrative_revisions: Vec<StoredNarrativeRevision> = self
            .narrative_revisions
            .keys()
            .map(|hash| {
                self.narrative_record(hash)
                    .expect("a narrative record reads back")
                    .as_ref()
                    .clone()
            })
            .collect();
        narrative_revisions.sort_by_key(|revision| revision.operation_sequence);
        PersistedSession {
            schema: SESSION_STATE_SCHEMA.to_owned(),
            persistence_generation: self.persistence_generation,
            models: self
                .models
                .entries()
                .map(|(hash, _)| {
                    self.models
                        .row(hash)
                        .expect("a model row reads back")
                        .as_ref()
                        .clone()
                })
                .collect(),
            worlds: self.worlds.values().cloned().collect(),
            world_revisions: self.world_revisions.values().cloned().collect(),
            candidates: self.candidates.values().cloned().collect(),
            narrative_source_snapshots: self
                .narrative_source_snapshots
                .index
                .keys()
                .map(|snapshot_hash| StoredNarrativeSourceSnapshot {
                    snapshot_hash: snapshot_hash.clone(),
                    snapshot: self
                        .narrative_snapshot(snapshot_hash)
                        .expect("a snapshot reads back")
                        .as_ref()
                        .clone(),
                })
                .collect(),
            narrative_revisions,
            project_documents: self.project_documents.values().cloned().collect(),
            project_model_snapshots: self
                .project_model_snapshots
                .values()
                .map(|model| model.definition.clone())
                .collect(),
            project_world_snapshots: self.project_world_snapshots.values().cloned().collect(),
            project_graph_snapshots: self.project_graph_snapshots.values().cloned().collect(),
            project_checkpoints: {
                let mut checkpoints: Vec<StoredProjectCheckpoint> =
                    self.project_checkpoints.values().cloned().collect();
                checkpoints.sort_by_key(|checkpoint| checkpoint.checkpoint_sequence);
                checkpoints
            },
        }
    }
}

impl MachineSession {
    pub(super) fn open_store(
        path: &Path,
        trust: bool,
    ) -> EngineResult<(Self, Vec<Seal>, Option<BTreeMap<(SealKind, String), Seal>>)> {
        let owns_heartbeat = crate::heartbeat::begin_if_idle(if trust {
            "open_state_file"
        } else {
            "audit_store"
        });
        let opened = (|| {
            let (persisted, index) = load_sqlite(
                path,
                if trust {
                    LoadMode::Trusting
                } else {
                    LoadMode::Auditing
                },
            )?;
            match index {
                None => Ok((Self::restore(persisted)?, Vec::new(), None)),
                Some(mut index) => {
                    let stored = std::mem::take(&mut index.stored_seals);
                    let (session, seals) = Self::build(persisted, Some(index))?;
                    Ok((session, seals, Some(stored)))
                }
            }
        })();
        if owns_heartbeat {
            crate::heartbeat::end();
        }
        let (mut session, seals, stored) = opened?;
        session.state_file = Some(path.to_path_buf());
        Ok((session, seals, stored))
    }

    pub(super) fn build(
        persisted: PersistedSession,
        index: Option<StoreIndex>,
    ) -> EngineResult<(Self, Vec<Seal>)> {
        if persisted.schema != SESSION_STATE_SCHEMA {
            return Err(error(format!(
                "unsupported session state schema {}; expected {SESSION_STATE_SCHEMA}",
                persisted.schema
            )));
        }
        let mut session = Self {
            persistence_generation: persisted.persistence_generation,
            ..Self::default()
        };
        let mut seals = Vec::new();
        let in_file = index.is_some();
        let (sealed_models, sealed_narratives, mut row_digests, snapshot_index) = match index {
            Some(index) => {
                session.reader = Some(index.reader.clone());
                session.models.set_reader(Some(index.reader));
                (
                    index.sealed_models,
                    index.sealed_narratives,
                    index.row_digests,
                    Some(index.snapshots),
                )
            }
            None => (Vec::new(), Vec::new(), BTreeMap::new(), None),
        };
        if sealed_models.len() + persisted.models.len() > MAX_SESSION_MODELS {
            return Err(error("state file exceeds the session model-count limit"));
        }
        let mut revision_zero_ids = BTreeSet::new();
        for (model_hash, header, base_model_hash, row_bytes, seal) in sealed_models {
            if header.previous_model_hash.is_none()
                && (header.revision_number != 0 || !revision_zero_ids.insert(header.id.clone()))
            {
                return Err(error("state file contains an invalid model revision root"));
            }
            session
                .models
                .insert_sealed(model_hash, header, base_model_hash, row_bytes, seal)?;
        }
        // A sealed revision's link to the one before it is checked on the headers alone; it was validated in full
        // when it was sealed.
        for (model_hash, entry) in session.models.entries() {
            if let Some(previous_hash) = &entry.header.previous_model_hash {
                let previous = session.models.entry(previous_hash).ok_or_else(|| {
                    error(format!(
                        "state file model {model_hash} lacks previous revision {previous_hash}"
                    ))
                })?;
                if previous.header.id != entry.header.id
                    || entry.header.revision_number != previous.header.revision_number + 1
                {
                    return Err(error("state file contains a broken model revision link"));
                }
            }
        }
        // Every other revision is rebuilt once, after the revision it is rebuilt from, checked against its hash and
        // against the revision before it. In memory, a whole revision read from an older file is kept as its changes
        // when they are smaller; a durable session keeps each row as the file holds it, since its seal covers those
        // bytes.
        let order = model_store::rebuild_order_after(&persisted.models, |hash| {
            session.models.contains_key(hash)
        })?;
        let mut rows: Vec<Option<StoredModel>> = persisted.models.into_iter().map(Some).collect();
        for index in order {
            let row = rows[index]
                .take()
                .ok_or_else(|| error("a stored model revision is rebuilt twice"))?;
            let model = std::sync::Arc::new(session.models.rebuild_stored(&row)?);
            crate::heartbeat::tick();
            let previous = match &model.revision.previous_model_hash {
                None => {
                    if model.revision.number != 0 || !revision_zero_ids.insert(model.id.clone()) {
                        return Err(error("state file contains an invalid model revision root"));
                    }
                    None
                }
                Some(previous_hash) => {
                    let previous = session.models.get(previous_hash)?.ok_or_else(|| {
                        error(format!(
                            "state file model {} lacks previous revision {previous_hash}",
                            model.model_hash
                        ))
                    })?;
                    if previous.id != model.id
                        || model.revision.number != previous.revision.number + 1
                    {
                        return Err(error("state file contains a broken model revision link"));
                    }
                    validate_revision_process_changes(&previous, &model)?;
                    Some(previous)
                }
            };
            if let StoredModel::Changes {
                base_model_hash, ..
            } = &row
            {
                if model.revision.previous_model_hash.as_ref() != Some(base_model_hash) {
                    return Err(error("a stored model revision is kept against a revision other than its previous one"));
                }
            }
            if in_file {
                let (row_sha256, row_bytes) = row_digests
                    .remove(&(SealKind::Model, model.model_hash.clone()))
                    .ok_or_else(|| error("an unsealed model row was read without its digest"))?;
                let parent_seal = match &model.revision.previous_model_hash {
                    Some(previous_hash) => Some(
                        session
                            .models
                            .entry(previous_hash)
                            .and_then(|entry| entry.seal.clone())
                            .ok_or_else(|| error("a model revision's predecessor has no seal"))?
                            .seal_sha256,
                    ),
                    None => None,
                };
                let seal = Seal::from_digest(
                    SealKind::Model,
                    &model.model_hash,
                    row_sha256,
                    row_bytes as u64,
                    &model_header(&model),
                    parent_seal,
                )?;
                session.models.insert_validated(
                    model,
                    row,
                    row_bytes,
                    Some(SealRef::from(&seal)),
                )?;
                seals.push(seal);
            } else {
                let stored = match row {
                    StoredModel::Changes { .. } => row,
                    StoredModel::Whole { .. } => model_store::kept_form(
                        &model,
                        previous
                            .as_ref()
                            .map(|previous| (previous.model_hash.as_str(), previous.definition())),
                    )?,
                };
                session.models.insert_stored(model, stored)?;
            }
        }
        for world in persisted.worlds {
            let model = session.models.get(&world.model_hash)?.ok_or_else(|| {
                error(format!(
                    "state file world {} names an unknown model",
                    world.world_id
                ))
            })?;
            validate_world(&model, &world)?;
            if session
                .worlds
                .insert(world.world_id.clone(), world)
                .is_some()
            {
                return Err(error("state file contains a duplicate world id"));
            }
        }
        if persisted.world_revisions.len() > MAX_SESSION_WORLD_REVISIONS
            || serialized_sum(persisted.world_revisions.iter())? > MAX_SESSION_WORLD_REVISION_BYTES
        {
            return Err(error("state file exceeds world revision storage limits"));
        }
        for revision in persisted.world_revisions {
            let source = session
                .models
                .get(&revision.source_head.model_hash)?
                .ok_or_else(|| error("world revision source model is unavailable"))?;
            let target = session
                .models
                .get(&revision.target_head.model_hash)?
                .ok_or_else(|| error("world revision target model is unavailable"))?;
            let rebuilt = build_world_revision(
                &source,
                &target,
                &revision.source_head,
                WorldRevisionSpec {
                    expected_world_hash: revision.source_head.world_hash.clone(),
                    mode: revision.mode,
                    state_values: revision.state_values.clone(),
                    reason: revision.reason.clone(),
                    provenance: revision.provenance.clone(),
                },
            )?;
            if rebuilt != revision {
                return Err(error(
                    "state file world revision does not reconstruct its frozen transition",
                ));
            }
            if session
                .world_revisions
                .insert(revision.world_revision_hash.clone(), revision)
                .is_some()
            {
                return Err(error("state file contains duplicate world revision hash"));
            }
        }
        session.validate_storage_limits()?;
        if persisted.candidates.len() > MAX_SESSION_CANDIDATES {
            return Err(error(
                "state file exceeds the session candidate-count limit",
            ));
        }
        let candidate_bytes = serialized_sum(persisted.candidates.iter())?
            .checked_add(persisted.candidates.len().saturating_mul(16))
            .ok_or_else(|| error("state-file candidate storage estimate overflow"))?;
        if candidate_bytes > MAX_SESSION_CANDIDATE_BYTES {
            return Err(error("state file exceeds the session candidate-byte limit"));
        }
        let mut replay_work = 0usize;
        for stored in &persisted.candidates {
            let model = session
                .models
                .get(&stored.record.candidate.model_hash)?
                .ok_or_else(|| error("state file candidate names an unknown model"))?;
            replay_work = replay_work
                .checked_add(candidate_replay_work(
                    &model,
                    &stored.parent,
                    &stored.record.candidate.query,
                )?)
                .ok_or_else(|| error("state-file replay-work estimate overflow"))?;
            if replay_work > MAX_SESSION_REPLAY_WORK {
                return Err(error(format!(
                    "state file replay work exceeds {MAX_SESSION_REPLAY_WORK}"
                )));
            }
        }
        for stored in persisted.candidates {
            let model = session
                .models
                .get(&stored.record.candidate.model_hash)?
                .ok_or_else(|| error("state file candidate names an unknown model"))?;
            validate_world(&model, &stored.parent)?;
            let replay = roll_model_transition(
                &model,
                &stored.parent,
                stored.record.candidate.query.clone(),
            )?;
            if replay.candidate != stored.record.candidate
                || replay.proposed_head != stored.record.proposed_head
            {
                return Err(error(
                    "state file candidate does not replay from its frozen parent",
                ));
            }
            let hash = stored.record.candidate.candidate_hash.clone();
            if session.candidates.insert(hash, stored).is_some() {
                return Err(error("state file contains a duplicate candidate hash"));
            }
        }
        session.validate_restored_lineage()?;
        if sealed_narratives.len() + persisted.narrative_revisions.len()
            > MAX_SESSION_NARRATIVE_GRAPHS
        {
            return Err(error(
                "state file exceeds the session narrative-graph count limit",
            ));
        }
        // Source snapshots: in memory each is held and checked against its hash here; a durable session knows them
        // by hash and reads one, checking it, when it is needed.
        match snapshot_index {
            Some(snapshot_index) => {
                if snapshot_index.len() > MAX_SESSION_NARRATIVE_GRAPHS {
                    return Err(error(
                        "state file exceeds the narrative source-snapshot count limit",
                    ));
                }
                session.narrative_source_snapshots.index = snapshot_index;
            }
            None => {
                if persisted.narrative_source_snapshots.len() > MAX_SESSION_NARRATIVE_GRAPHS {
                    return Err(error(
                        "state file exceeds the narrative source-snapshot count limit",
                    ));
                }
                for stored in persisted.narrative_source_snapshots {
                    if hash_serializable(&stored.snapshot)? != stored.snapshot_hash {
                        return Err(error("state file narrative snapshot hash is invalid"));
                    }
                    if session
                        .narrative_source_snapshots
                        .contains_key(&stored.snapshot_hash)
                    {
                        return Err(error(
                            "state file contains a duplicate narrative snapshot hash",
                        ));
                    }
                    let bytes = serialized_size(&stored)?;
                    session.narrative_source_snapshots.index.insert(
                        stored.snapshot_hash.clone(),
                        stored.snapshot.model_hash.clone(),
                    );
                    session.narrative_source_snapshots.rows.hold(
                        stored.snapshot_hash,
                        std::sync::Arc::new(stored.snapshot),
                        bytes,
                    );
                }
            }
        }
        // Every revision's header, in operation order. The unsealed revisions' records are held while they are
        // validated.
        let mut entries: Vec<NarrativeEntry> = sealed_narratives
            .into_iter()
            .map(|(header, row_bytes, seal)| NarrativeEntry {
                header,
                row_bytes,
                seal: Some(seal),
            })
            .collect();
        let mut unsealed = Vec::new();
        for stored in persisted.narrative_revisions {
            let row_bytes = match row_digests.get(&(SealKind::Narrative, stored.graph_hash.clone()))
            {
                Some((_, bytes)) => *bytes,
                None => serialized_size(&stored)?,
            };
            entries.push(NarrativeEntry {
                header: NarrativeHeader::from(&stored),
                row_bytes,
                seal: None,
            });
            unsealed.push((std::sync::Arc::new(stored), row_bytes));
        }
        entries.sort_by_key(|entry| entry.operation_sequence);
        let mut expected_operation_sequence = 0u64;
        for entry in entries {
            if entry.operation_sequence != expected_operation_sequence {
                return Err(error(
                    "state file narrative operation sequences must be unique, contiguous, and ordered",
                ));
            }
            expected_operation_sequence = expected_operation_sequence
                .checked_add(1)
                .ok_or_else(|| error("narrative operation sequence overflow"))?;
            if entry.schema != NARRATIVE_REVISION_STORE_SCHEMA {
                return Err(error(format!(
                    "unsupported narrative revision record schema {}; expected {NARRATIVE_REVISION_STORE_SCHEMA}",
                    entry.schema
                )));
            }
            if !session
                .narrative_source_snapshots
                .contains_key(&entry.snapshot_hash)
            {
                return Err(error(
                    "state file narrative revision names an unknown source snapshot",
                ));
            }
            if let Some(previous) = &entry.revision.previous_graph_hash {
                *session
                    .narrative_children
                    .entry(previous.clone())
                    .or_default() += 1;
            }
            session
                .narrative_children
                .entry(entry.graph_hash.clone())
                .or_default();
            if session
                .narrative_revisions
                .insert(entry.graph_hash.clone(), entry)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate narrative graph hash",
                ));
            }
        }
        session.next_narrative_operation_sequence = expected_operation_sequence;
        session.validate_narrative_revision_chains()?;
        unsealed.sort_by_key(|(record, _)| record.operation_sequence);
        for (record, row_bytes) in &unsealed {
            session
                .narrative_records
                .hold(record.graph_hash.clone(), record.clone(), *row_bytes);
        }
        for (record, _) in &unsealed {
            session.admit_narrative_record(record)?;
            if in_file {
                let (row_sha256, row_bytes) = row_digests
                    .remove(&(SealKind::Narrative, record.graph_hash.clone()))
                    .ok_or_else(|| {
                        error("an unsealed narrative row was read without its digest")
                    })?;
                let parent_seal = match &record.revision.previous_graph_hash {
                    Some(previous_hash) => Some(
                        session
                            .narrative_revisions
                            .get(previous_hash)
                            .and_then(|entry| entry.seal.clone())
                            .ok_or_else(|| error("a narrative revision's predecessor has no seal"))?
                            .seal_sha256,
                    ),
                    None => None,
                };
                let header = NarrativeHeader::from(record.as_ref());
                let seal = Seal::from_digest(
                    SealKind::Narrative,
                    &record.graph_hash,
                    row_sha256,
                    row_bytes as u64,
                    &header,
                    parent_seal,
                )?;
                if let Some(entry) = session.narrative_revisions.get_mut(&record.graph_hash) {
                    entry.seal = Some(SealRef::from(&seal));
                }
                seals.push(seal);
            }
        }
        if in_file {
            // The file holds them; the cache keeps what fits.
            session.narrative_records.release_all();
        }
        let referenced: BTreeSet<&str> = session
            .narrative_revisions
            .values()
            .map(|entry| entry.snapshot_hash.as_str())
            .collect();
        if referenced.len() != session.narrative_source_snapshots.len() {
            return Err(error(
                "state file contains an unreferenced narrative source snapshot",
            ));
        }
        for document in persisted.project_documents {
            let expected_hash = hash_serializable(&serde_json::json!({
                "media_type": document.media_type,
                "content": document.content,
            }))?;
            if document.document_hash != expected_hash
                || document.media_type.trim().is_empty()
                || document.media_type.len() > MAX_NARRATIVE_STRING_BYTES
                || document.content.len() > MAX_PROJECT_DOCUMENT_BYTES
            {
                return Err(error(
                    "state file project document hash, media type, or size is invalid",
                ));
            }
            if session
                .project_documents
                .insert(document.document_hash.clone(), document)
                .is_some()
            {
                return Err(error("state file contains a duplicate project document"));
            }
        }
        for definition in persisted.project_model_snapshots {
            let compiled = compile_model(definition)?;
            if session
                .project_model_snapshots
                .insert(compiled.model_hash.clone(), compiled)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate project model snapshot",
                ));
            }
        }
        for world in persisted.project_world_snapshots {
            let model = session
                .project_model_snapshots
                .get(&world.model_hash)
                .ok_or_else(|| error("project world snapshot names an unknown project model"))?;
            validate_world(model, &world)?;
            if session
                .project_world_snapshots
                .insert(world.world_hash.clone(), world)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate project world snapshot",
                ));
            }
        }
        for graph in persisted.project_graph_snapshots {
            let model = session
                .project_model_snapshots
                .get(&graph.snapshot.model_hash)
                .ok_or_else(|| error("project graph snapshot names an unknown project model"))?;
            if compile_narrative_graph(graph.definition.clone())?.graph_hash != graph.graph_hash
                || hash_serializable(&graph.snapshot)? != graph.snapshot_hash
                || graph.snapshot.model_revision != model.revision.number
                || graph.snapshot.state.len() != model.processes.len()
            {
                return Err(error("state file project graph snapshot is invalid"));
            }
            for (id, process) in &model.processes {
                let value =
                    graph.snapshot.state.get(id).ok_or_else(|| {
                        error(format!("project graph snapshot lacks process {id}"))
                    })?;
                validate_process_value(&process.value_type, value, id)?;
            }
            validate_project_graph_source_binding(model, None, &graph)?;
            let project_snapshot_hash = project_graph_snapshot_hash(&graph)?;
            if session
                .project_graph_snapshots
                .insert(project_snapshot_hash, graph)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate project graph snapshot",
                ));
            }
        }
        if persisted.project_checkpoints.len() > MAX_PROJECT_CHECKPOINTS {
            return Err(error("state file exceeds project checkpoint count limit"));
        }
        for (expected_sequence, checkpoint) in (0u64..).zip(persisted.project_checkpoints) {
            let checkpoint_model_hash = checkpoint.core.model_hash.as_deref();
            let checkpoint_world = checkpoint
                .core
                .world_hash
                .as_ref()
                .and_then(|hash| session.project_world_snapshots.get(hash));
            let checkpoint_graph = checkpoint
                .core
                .narrative_graph_snapshot_hash
                .as_ref()
                .and_then(|hash| session.project_graph_snapshots.get(hash));
            if checkpoint.checkpoint_sequence != expected_sequence
                || checkpoint.core.schema != PROJECT_CHECKPOINT_SCHEMA
                || hash_serializable(&checkpoint.core)? != checkpoint.checkpoint_hash
                || checkpoint.core.name.trim().is_empty()
                || checkpoint.core.name.len() > MAX_MODEL_IDENTIFIER_BYTES
                || is_project_checkpoint_hash_shaped_name(&checkpoint.core.name)
                || checkpoint.core.reason.len() > MAX_NARRATIVE_STRING_BYTES
                || checkpoint.core.provenance.len() > MAX_OBSERVATION_PROVENANCE
                || checkpoint.core.provenance.iter().any(|value| {
                    value.trim().is_empty() || value.len() > MAX_NARRATIVE_STRING_BYTES
                })
                || checkpoint
                    .core
                    .canonical_external_path
                    .as_ref()
                    .is_some_and(|path| {
                        path.trim().is_empty() || path.len() > MAX_NARRATIVE_STRING_BYTES
                    })
                || !session
                    .project_documents
                    .contains_key(&checkpoint.core.document_hash)
                || checkpoint
                    .core
                    .model_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_model_snapshots.contains_key(hash))
                || checkpoint
                    .core
                    .world_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_world_snapshots.contains_key(hash))
                || checkpoint
                    .core
                    .narrative_graph_snapshot_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_graph_snapshots.contains_key(hash))
                || checkpoint.core.narrative_graph_hash.is_some()
                    != checkpoint.core.narrative_graph_snapshot_hash.is_some()
                || checkpoint
                    .core
                    .parent_checkpoint_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_checkpoints.contains_key(hash))
                || checkpoint_world
                    .is_some_and(|world| Some(world.model_hash.as_str()) != checkpoint_model_hash)
                || checkpoint_graph.is_some_and(|graph| {
                    Some(graph.snapshot.model_hash.as_str()) != checkpoint_model_hash
                        || Some(graph.graph_hash.as_str())
                            != checkpoint.core.narrative_graph_hash.as_deref()
                })
                || checkpoint_world
                    .zip(checkpoint_graph)
                    .is_some_and(|(world, graph)| {
                        validate_project_graph_source_binding(
                            session
                                .project_model_snapshots
                                .get(&graph.snapshot.model_hash)
                                .expect("project graph model was checked above"),
                            Some(world),
                            graph,
                        )
                        .is_err()
                    })
            {
                return Err(error(
                    "state file project checkpoint is invalid or out of order",
                ));
            }
            if session
                .project_checkpoint_names
                .insert(
                    checkpoint.core.name.clone(),
                    checkpoint.checkpoint_hash.clone(),
                )
                .is_some()
                || session
                    .project_checkpoints
                    .insert(checkpoint.checkpoint_hash.clone(), checkpoint)
                    .is_some()
            {
                return Err(error("state file contains a duplicate project checkpoint"));
            }
            session.next_project_checkpoint_sequence = expected_sequence
                .checked_add(1)
                .ok_or_else(|| error("project checkpoint sequence overflow"))?;
        }
        session.validate_storage_limits()?;
        if in_file {
            session.load_working_set()?;
        }
        Ok((session, seals))
    }

    pub(super) fn admit_narrative_record(
        &self,
        record: &StoredNarrativeRevision,
    ) -> EngineResult<()> {
        validate_narrative_revision_record_hash(record)?;
        let parent = record
            .revision
            .previous_graph_hash
            .as_ref()
            .map(|hash| {
                self.materialized_narrative(hash).map_err(|_| {
                    error("narrative revision parent was not materialized before its child")
                })
            })
            .transpose()?;
        let materialized = MaterializedNarrative::apply(parent.as_ref(), record)?;
        let compiled = compile_narrative_graph(materialized.definition(record))?;
        if compiled.graph_hash != record.graph_hash {
            return Err(error(format!(
                "narrative revision {} does not reconstruct its graph hash",
                record.operation_sequence
            )));
        }
        if !materialized.matches(&compiled.definition) {
            return Err(error(format!(
                "narrative revision {} is not stored in compiled form",
                record.operation_sequence
            )));
        }
        validate_narrative_insertion_order(record, &compiled.definition)?;
        if let (Some(parent), NarrativeRevisionPayload::Delta { delta }) =
            (&parent, &record.payload)
        {
            let previous_hash = record
                .revision
                .previous_graph_hash
                .as_ref()
                .ok_or_else(|| error("a narrative delta names no predecessor"))?;
            let previous = self.narrative_revisions.get(previous_hash).ok_or_else(|| {
                error("narrative revision parent was not materialized before its child")
            })?;
            if build_narrative_graph_delta(
                &parent.definition(&previous.header),
                &compiled.definition,
            ) != *delta
            {
                return Err(error(format!(
                    "narrative revision {} contains a noncanonical or tampered delta",
                    record.operation_sequence
                )));
            }
        }
        let snapshot = self.narrative_snapshot(&record.snapshot_hash)?;
        self.validate_narrative_snapshot_binding(&compiled, &snapshot)?;
        self.validate_narrative_anchors(&compiled, &snapshot)?;
        self.keep_materialized(&record.graph_hash, materialized);
        crate::heartbeat::tick();
        Ok(())
    }

    pub(super) fn load_working_set(&mut self) -> EngineResult<()> {
        let heads: Vec<String> = self
            .narrative_children
            .iter()
            .filter(|(_, children)| **children == 0)
            .map(|(hash, _)| hash.clone())
            .collect();
        for head in heads {
            let header = self
                .narrative_revisions
                .get(&head)
                .ok_or_else(|| error("a narrative head is unknown"))?
                .header
                .clone();
            let materialized = self.materialized_narrative(&head)?;
            if compile_narrative_graph(materialized.definition(&header))?.graph_hash != head {
                return Err(error(format!(
                    "narrative revision {} does not reconstruct its graph hash from the state file",
                    header.operation_sequence
                )));
            }
            crate::heartbeat::tick();
        }
        let mut newest: BTreeMap<&str, (&str, u64)> = BTreeMap::new();
        for (hash, header) in self.models.leaves() {
            let current = newest
                .entry(header.id.as_str())
                .or_insert((hash.as_str(), header.revision_number));
            if header.revision_number > current.1 {
                *current = (hash.as_str(), header.revision_number);
            }
        }
        let newest: Vec<String> = newest
            .into_values()
            .map(|(hash, _)| hash.to_owned())
            .collect();
        for hash in newest {
            self.models.get(&hash)?;
        }
        Ok(())
    }
}
