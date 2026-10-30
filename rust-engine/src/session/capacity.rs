//! The session's capacity: every insertion or replacement is checked against the session limits before anything
//! changes, so a refused change leaves the session as it was.

use std::collections::BTreeMap;

use crate::limits::{
    serialized_size, serialized_sum, MAX_PROJECT_CHECKPOINTS, MAX_PROJECT_STORAGE_BYTES,
    MAX_SESSION_CANDIDATES, MAX_SESSION_CANDIDATE_BYTES, MAX_SESSION_MODELS,
    MAX_SESSION_MODEL_BYTES, MAX_SESSION_NARRATIVE_BYTES, MAX_SESSION_NARRATIVE_GRAPHS,
    MAX_SESSION_REPLAY_WORK, MAX_SESSION_WORLDS, MAX_SESSION_WORLD_BYTES,
    MAX_SESSION_WORLD_REVISIONS, MAX_SESSION_WORLD_REVISION_BYTES,
};
use crate::model::candidate::StoredCandidate;
use crate::model::compile::CompiledModel;
use crate::model::narrative::{
    NarrativeSourceSnapshot, StoredNarrativeRevision, StoredNarrativeSourceSnapshot,
};
use crate::model::transition::candidate_replay_work;
use crate::model::world::{WorldHead, WorldRevision};
use crate::session::model_store::StoredModel;
use crate::session::MachineSession;
use crate::{error, EngineResult};

impl MachineSession {
    pub(super) fn validate_storage_limits(&self) -> EngineResult<()> {
        if self.models.len() > MAX_SESSION_MODELS
            || self.worlds.len() > MAX_SESSION_WORLDS
            || self.world_revisions.len() > MAX_SESSION_WORLD_REVISIONS
            || self.candidates.len() > MAX_SESSION_CANDIDATES
            || self.narrative_revisions.len() > MAX_SESSION_NARRATIVE_GRAPHS
            || self.project_checkpoints.len() > MAX_PROJECT_CHECKPOINTS
        {
            return Err(error("session object-count limit exceeded"));
        }
        let model_bytes = self.models.held_bytes();
        let world_bytes = serialized_sum(self.worlds.values())?;
        let world_revision_bytes = serialized_sum(self.world_revisions.values())?;
        let candidate_bytes = serialized_sum(self.candidates.values())?
            .checked_add(self.candidates.len().saturating_mul(16))
            .ok_or_else(|| error("candidate storage estimate overflow"))?;
        let narrative_bytes = self.narrative_held_bytes();
        let project_bytes = self.project_storage_bytes()?;
        if model_bytes > MAX_SESSION_MODEL_BYTES
            || world_bytes > MAX_SESSION_WORLD_BYTES
            || world_revision_bytes > MAX_SESSION_WORLD_REVISION_BYTES
            || candidate_bytes > MAX_SESSION_CANDIDATE_BYTES
            || narrative_bytes > MAX_SESSION_NARRATIVE_BYTES
            || project_bytes > MAX_PROJECT_STORAGE_BYTES
        {
            return Err(error(format!(
                "session byte limit exceeded (models held {model_bytes}/{MAX_SESSION_MODEL_BYTES}, worlds {world_bytes}/{MAX_SESSION_WORLD_BYTES}, candidates {candidate_bytes}/{MAX_SESSION_CANDIDATE_BYTES}, narrative graphs held {narrative_bytes}/{MAX_SESSION_NARRATIVE_BYTES}, project checkpoints {project_bytes}/{MAX_PROJECT_STORAGE_BYTES})"
            )));
        }
        Ok(())
    }

    pub(super) fn ensure_narrative_insert(
        &self,
        revision: &StoredNarrativeRevision,
        snapshot: &NarrativeSourceSnapshot,
    ) -> EngineResult<(usize, usize)> {
        if self.narrative_revisions.contains_key(&revision.graph_hash) {
            return Ok((0, 0));
        }
        if self.narrative_revisions.len() >= MAX_SESSION_NARRATIVE_GRAPHS {
            return Err(error(format!(
                "session narrative graph count would exceed {MAX_SESSION_NARRATIVE_GRAPHS}"
            )));
        }
        let snapshot_bytes = if self
            .narrative_source_snapshots
            .contains_key(&revision.snapshot_hash)
        {
            0
        } else {
            serialized_size(&StoredNarrativeSourceSnapshot {
                snapshot_hash: revision.snapshot_hash.clone(),
                snapshot: snapshot.clone(),
            })?
        };
        let revision_bytes = serialized_size(revision)?;
        let bytes = self
            .narrative_held_bytes()
            .checked_add(snapshot_bytes)
            .and_then(|value| value.checked_add(revision_bytes))
            .ok_or_else(|| error("session narrative graph byte estimate overflow"))?;
        if bytes > MAX_SESSION_NARRATIVE_BYTES {
            return Err(error(format!(
                "session narrative graph bytes held in memory would exceed {MAX_SESSION_NARRATIVE_BYTES}"
            )));
        }
        Ok((snapshot_bytes, revision_bytes))
    }

    pub(super) fn project_storage_bytes(&self) -> EngineResult<usize> {
        let document_bytes = serialized_sum(self.project_documents.values())?;
        let model_bytes = serialized_sum(
            self.project_model_snapshots
                .values()
                .map(|model| &model.definition),
        )?;
        let world_bytes = serialized_sum(self.project_world_snapshots.values())?;
        let graph_bytes = serialized_sum(self.project_graph_snapshots.values())?;
        let checkpoint_bytes = serialized_sum(self.project_checkpoints.values())?;
        document_bytes
            .checked_add(model_bytes)
            .and_then(|bytes| bytes.checked_add(world_bytes))
            .and_then(|bytes| bytes.checked_add(graph_bytes))
            .and_then(|bytes| bytes.checked_add(checkpoint_bytes))
            .ok_or_else(|| error("project checkpoint storage estimate overflow"))
    }

    /// The bound counts the models as they are stored, a revision kept as its changes counting only those, so a long
    /// history of small revisions does not exhaust it, and nothing is re-serialized to check it.
    pub(super) fn ensure_model_insert(
        &self,
        model: &CompiledModel,
        stored: &StoredModel,
    ) -> EngineResult<()> {
        if self.models.contains_key(&model.model_hash) {
            return Ok(());
        }
        if self.models.len() >= MAX_SESSION_MODELS {
            return Err(error(format!(
                "session model count would exceed {MAX_SESSION_MODELS}"
            )));
        }
        let bytes = self
            .models
            .held_bytes()
            .checked_add(serialized_size(stored)?)
            .ok_or_else(|| error("session model byte estimate overflow"))?;
        if bytes > MAX_SESSION_MODEL_BYTES {
            return Err(error(format!(
                "session model bytes would exceed {MAX_SESSION_MODEL_BYTES}"
            )));
        }
        Ok(())
    }

    pub(super) fn ensure_world_insert(&self, world: &WorldHead) -> EngineResult<()> {
        if self.worlds.len() >= MAX_SESSION_WORLDS {
            return Err(error(format!(
                "session world count would exceed {MAX_SESSION_WORLDS}"
            )));
        }
        let bytes = serialized_sum(self.worlds.values())?
            .checked_add(serialized_size(world)?)
            .ok_or_else(|| error("session world byte estimate overflow"))?;
        if bytes > MAX_SESSION_WORLD_BYTES {
            return Err(error(format!(
                "session world bytes would exceed {MAX_SESSION_WORLD_BYTES}"
            )));
        }
        Ok(())
    }

    pub(super) fn ensure_world_replacement(
        &self,
        world_id: &str,
        world: &WorldHead,
    ) -> EngineResult<()> {
        let current = self
            .worlds
            .get(world_id)
            .ok_or_else(|| error(format!("unknown world {world_id}")))?;
        let current_bytes = serialized_size(current)?;
        let replacement_bytes = serialized_size(world)?;
        let bytes = serialized_sum(self.worlds.values())?
            .checked_sub(current_bytes)
            .and_then(|value| value.checked_add(replacement_bytes))
            .ok_or_else(|| error("session world replacement byte estimate overflow"))?;
        if bytes > MAX_SESSION_WORLD_BYTES {
            return Err(error(format!(
                "session world bytes would exceed {MAX_SESSION_WORLD_BYTES}"
            )));
        }
        Ok(())
    }

    pub(super) fn ensure_world_revision_insert(
        &self,
        revision: &WorldRevision,
    ) -> EngineResult<()> {
        if self.world_revisions.len() >= MAX_SESSION_WORLD_REVISIONS {
            return Err(error("session world revision count limit exceeded"));
        }
        let bytes = serialized_sum(self.world_revisions.values())?
            .checked_add(serialized_size(revision)?)
            .ok_or_else(|| error("session world revision byte estimate overflow"))?;
        if bytes > MAX_SESSION_WORLD_REVISION_BYTES {
            return Err(error("session world revision byte limit exceeded"));
        }
        Ok(())
    }

    pub(super) fn ensure_candidate_insert(&self, candidate: &StoredCandidate) -> EngineResult<()> {
        self.ensure_candidate_changes(&BTreeMap::new(), Some(candidate))
    }

    pub(super) fn ensure_candidate_replacement(
        &self,
        candidate_hash: &str,
        replacement: &StoredCandidate,
    ) -> EngineResult<()> {
        let mut replacements = BTreeMap::new();
        replacements.insert(candidate_hash.to_owned(), replacement.clone());
        self.ensure_candidate_changes(&replacements, None)
    }

    pub(super) fn ensure_candidate_changes(
        &self,
        replacements: &BTreeMap<String, StoredCandidate>,
        insertion: Option<&StoredCandidate>,
    ) -> EngineResult<()> {
        if replacements
            .keys()
            .any(|hash| !self.candidates.contains_key(hash))
        {
            return Err(error("candidate replacement names an unknown candidate"));
        }
        if let Some(inserted) = insertion {
            if self
                .candidates
                .contains_key(&inserted.record.candidate.candidate_hash)
            {
                return Err(error(
                    "candidate insertion collides with an existing candidate",
                ));
            }
        }
        let count = self
            .candidates
            .len()
            .checked_add(usize::from(insertion.is_some()))
            .ok_or_else(|| error("session candidate count overflow"))?;
        if count > MAX_SESSION_CANDIDATES {
            return Err(error(format!(
                "session candidate count would exceed {MAX_SESSION_CANDIDATES}"
            )));
        }
        let mut bytes = count
            .checked_mul(16)
            .ok_or_else(|| error("session candidate byte estimate overflow"))?;
        let mut replay_work = 0usize;
        for (hash, current) in &self.candidates {
            let stored = replacements.get(hash).unwrap_or(current);
            bytes = bytes
                .checked_add(serialized_size(stored)?)
                .ok_or_else(|| error("session candidate byte estimate overflow"))?;
            let model = self
                .models
                .get(&stored.record.candidate.model_hash)?
                .ok_or_else(|| error("candidate model is unavailable"))?;
            replay_work = replay_work
                .checked_add(candidate_replay_work(
                    &model,
                    &stored.parent,
                    &stored.record.candidate.query,
                )?)
                .ok_or_else(|| error("session replay-work estimate overflow"))?;
        }
        if let Some(stored) = insertion {
            bytes = bytes
                .checked_add(serialized_size(stored)?)
                .ok_or_else(|| error("session candidate byte estimate overflow"))?;
            let model = self
                .models
                .get(&stored.record.candidate.model_hash)?
                .ok_or_else(|| error("candidate model is unavailable"))?;
            replay_work = replay_work
                .checked_add(candidate_replay_work(
                    &model,
                    &stored.parent,
                    &stored.record.candidate.query,
                )?)
                .ok_or_else(|| error("session replay-work estimate overflow"))?;
        }
        if bytes > MAX_SESSION_CANDIDATE_BYTES {
            return Err(error(format!(
                "session candidate bytes would exceed {MAX_SESSION_CANDIDATE_BYTES}; export the result and start a new bounded session"
            )));
        }
        if replay_work > MAX_SESSION_REPLAY_WORK {
            return Err(error(format!(
                "session replay work would exceed {MAX_SESSION_REPLAY_WORK}; export the result and start a new bounded session"
            )));
        }
        Ok(())
    }
}

impl MachineSession {
    pub(super) fn narrative_held_bytes(&self) -> usize {
        self.narrative_records
            .held_bytes()
            .saturating_add(self.narrative_source_snapshots.rows.held_bytes())
    }
}
