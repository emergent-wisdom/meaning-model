//! Restoring a session from its state file. Everything read back is checked before it is trusted: hashes, the
//! narrative revision chains, the complete accepted lineage, and an exact replay of every stored candidate. A file that
//! fails any check is refused whole, so a session is never half-restored.

use std::collections::{BTreeMap, BTreeSet};

use crate::limits::{
    serialized_sum, MAX_MODEL_IDENTIFIER_BYTES, MAX_OBSERVATION_PROVENANCE,
    MAX_PROJECT_CHECKPOINTS, MAX_PROJECT_DOCUMENT_BYTES, MAX_SESSION_CANDIDATES,
    MAX_SESSION_CANDIDATE_BYTES, MAX_SESSION_NARRATIVE_GRAPHS, MAX_SESSION_REPLAY_WORK,
    MAX_SESSION_WORLD_REVISIONS, MAX_SESSION_WORLD_REVISION_BYTES,
};
use crate::model::candidate::CandidateStatus;
use crate::model::compile::{compile_model, validate_process_value};
#[cfg(test)]
use crate::model::narrative::StoredNarrativeSourceSnapshot;
use crate::model::narrative::{
    build_narrative_graph_delta, compile_narrative_graph, validate_narrative_insertion_order,
    validate_narrative_revision_record_hash, MaterializedNarrative, NarrativeGraphDefinition,
    NarrativeRevisionPayload, StoredNarrativeRevision, MAX_NARRATIVE_STRING_BYTES,
    NARRATIVE_REVISION_STORE_SCHEMA,
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
use crate::session::model_store::{self, StoredModel};
use crate::session::persistence::{load_sqlite_session, PersistedSession};
use crate::session::MachineSession;
use crate::session::SESSION_STATE_SCHEMA;
use crate::{error, hash_serializable, EngineResult};

impl MachineSession {
    pub(super) fn restore(persisted: PersistedSession) -> EngineResult<Self> {
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
        // Every revision is rebuilt once, after the revision it is rebuilt from, checked against its hash and against
        // the revision before it, and kept as its changes from that revision when they are smaller than the whole.
        // A whole revision read from an older file is converted here, so only this pass ever holds it whole.
        let order = model_store::rebuild_order(&persisted.models)?;
        let mut rows: Vec<Option<StoredModel>> = persisted.models.into_iter().map(Some).collect();
        let mut revision_zero_ids = BTreeSet::new();
        for index in order {
            let row = rows[index]
                .take()
                .ok_or_else(|| error("a stored model revision is rebuilt twice"))?;
            let model = std::sync::Arc::new(session.models.rebuild_stored(&row)?);
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
            let stored = match row {
                StoredModel::Changes { ref base_model_hash, .. }
                    if model.revision.previous_model_hash.as_ref() == Some(base_model_hash) => row,
                StoredModel::Changes { .. } => {
                    return Err(error("a stored model revision is kept against a revision other than its previous one"))
                }
                StoredModel::Whole { .. } => model_store::kept_form(
                    &model,
                    previous.as_ref().map(|previous| (previous.model_hash.as_str(), previous.definition())),
                )?,
            };
            session.models.insert_stored(model, stored)?;
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
        if persisted.narrative_revisions.len() > MAX_SESSION_NARRATIVE_GRAPHS {
            return Err(error(
                "state file exceeds the session narrative-graph count limit",
            ));
        }
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
                .insert(stored.snapshot_hash, stored.snapshot)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate narrative snapshot hash",
                ));
            }
        }
        let mut expected_operation_sequence = 0u64;
        for stored in persisted.narrative_revisions {
            if stored.operation_sequence != expected_operation_sequence {
                return Err(error(
                    "state file narrative operation sequences must be unique, contiguous, and ordered",
                ));
            }
            expected_operation_sequence = expected_operation_sequence
                .checked_add(1)
                .ok_or_else(|| error("narrative operation sequence overflow"))?;
            if stored.schema != NARRATIVE_REVISION_STORE_SCHEMA {
                return Err(error(format!(
                    "unsupported narrative revision record schema {}; expected {NARRATIVE_REVISION_STORE_SCHEMA}",
                    stored.schema
                )));
            }
            if !session
                .narrative_source_snapshots
                .contains_key(&stored.snapshot_hash)
            {
                return Err(error(
                    "state file narrative revision names an unknown source snapshot",
                ));
            }
            if session
                .narrative_revisions
                .insert(stored.graph_hash.clone(), stored)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate narrative graph hash",
                ));
            }
        }
        session.next_narrative_operation_sequence = expected_operation_sequence;
        session.validate_narrative_revision_chains()?;
        let mut ordered_revisions: Vec<StoredNarrativeRevision> =
            session.narrative_revisions.values().cloned().collect();
        ordered_revisions.sort_by_key(|record| record.operation_sequence);
        let mut remaining_children = BTreeMap::<String, usize>::new();
        for record in &ordered_revisions {
            if let Some(previous_hash) = &record.revision.previous_graph_hash {
                *remaining_children.entry(previous_hash.clone()).or_default() += 1;
            }
        }
        let mut materialized_definitions = BTreeMap::<String, NarrativeGraphDefinition>::new();
        let mut referenced_snapshots = BTreeSet::new();
        for record in ordered_revisions {
            validate_narrative_revision_record_hash(&record)?;
            let previous = record
                .revision
                .previous_graph_hash
                .as_ref()
                .map(|hash| {
                    materialized_definitions.get(hash).ok_or_else(|| {
                        error("narrative revision parent was not materialized before its child")
                    })
                })
                .transpose()?;
            let parent_materialized = record
                .revision
                .previous_graph_hash
                .as_ref()
                .map(|hash| {
                    session.narrative_materialized.get(hash).ok_or_else(|| {
                        error("narrative revision parent was not materialized before its child")
                    })
                })
                .transpose()?;
            let materialized = MaterializedNarrative::apply(parent_materialized, &record)?;
            let compiled = compile_narrative_graph(materialized.definition(&record))?;
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
            validate_narrative_insertion_order(&record, &compiled.definition)?;
            if let (Some(previous), NarrativeRevisionPayload::Delta { delta }) =
                (previous, &record.payload)
            {
                if build_narrative_graph_delta(previous, &compiled.definition) != *delta {
                    return Err(error(format!(
                        "narrative revision {} contains a noncanonical or tampered delta",
                        record.operation_sequence
                    )));
                }
            }
            let snapshot = session
                .narrative_source_snapshots
                .get(&record.snapshot_hash)
                .ok_or_else(|| error("narrative revision names an unknown source snapshot"))?;
            session.validate_narrative_snapshot_binding(&compiled, snapshot)?;
            session.validate_narrative_anchors(&compiled, snapshot)?;
            referenced_snapshots.insert(record.snapshot_hash.clone());
            session
                .narrative_materialized
                .insert(record.graph_hash.clone(), materialized);
            if let Some(previous_hash) = &record.revision.previous_graph_hash {
                let remaining = remaining_children
                    .get_mut(previous_hash)
                    .ok_or_else(|| error("narrative revision child accounting is invalid"))?;
                *remaining = remaining
                    .checked_sub(1)
                    .ok_or_else(|| error("narrative revision child accounting underflow"))?;
                if *remaining == 0 {
                    materialized_definitions.remove(previous_hash);
                }
            }
            if remaining_children
                .get(&record.graph_hash)
                .copied()
                .unwrap_or_default()
                > 0
            {
                materialized_definitions.insert(record.graph_hash, compiled.definition);
            }
        }
        if referenced_snapshots.len() != session.narrative_source_snapshots.len() {
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
        session.narrative_storage_bytes = session.compute_narrative_storage_bytes()?;
        session.validate_storage_limits()?;
        Ok(session)
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
        let persisted = load_sqlite_session(&path)?;
        let mut restored = Self::restore(persisted)?;
        restored.state_file = Some(path);
        *self = restored;
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn snapshot(&self) -> PersistedSession {
        PersistedSession {
            schema: SESSION_STATE_SCHEMA.to_owned(),
            persistence_generation: self.persistence_generation,
            models: self
                .models
                .entries()
                .map(|(_, entry)| entry.stored.clone())
                .collect(),
            worlds: self.worlds.values().cloned().collect(),
            world_revisions: self.world_revisions.values().cloned().collect(),
            candidates: self.candidates.values().cloned().collect(),
            narrative_source_snapshots: self
                .narrative_source_snapshots
                .iter()
                .map(|(snapshot_hash, snapshot)| StoredNarrativeSourceSnapshot {
                    snapshot_hash: snapshot_hash.clone(),
                    snapshot: snapshot.clone(),
                })
                .collect(),
            narrative_revisions: {
                let mut revisions: Vec<StoredNarrativeRevision> =
                    self.narrative_revisions.values().cloned().collect();
                revisions.sort_by_key(|revision| revision.operation_sequence);
                revisions
            },
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
