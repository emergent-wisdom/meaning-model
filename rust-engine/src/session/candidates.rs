//! Candidate commands: rolling a world into a pending candidate, rerolling, inspecting and summarizing it, and
//! rejecting or committing it as the world's next accepted head.
//!
//! A candidate is bound to the frozen head it was rolled from. Commit accepts it only while that head is still the
//! world's accepted head (otherwise `conflict`), and supersedes its pending siblings in the same change. Rolling or
//! rerolling to a candidate that is already stored answers with the stored one, never a second copy, and a candidate
//! already bound to different content is a `conflict`.

use std::collections::BTreeMap;

use crate::model::candidate::{
    attach_retention_upgrade, path_is_richer, same_candidate_canon, CandidateRecord,
    CandidateStatus, StoredCandidate,
};
use crate::model::compile::CompiledModel;
use crate::model::trajectory::summarize_model_trajectory;
use crate::model::transition::roll_model_transition;
use crate::model::view::{
    candidate_original_view, candidate_record_view, normalize_view, world_view, ViewSpec,
};
use crate::model::world::WorldHead;
use crate::session::operation::CandidateOperation;
use crate::session::{
    encode, machine_error, required, DirtyRow, MachineCommand, MachineError, MachineSession,
};

/// What rolled a candidate that turned out to be stored already.
enum RolledBy<'a> {
    /// roll_world, from the world's current head.
    RollWorld,
    /// reroll_candidate of the stored candidate `source`.
    Reroll {
        source_hash: &'a str,
        source: &'a StoredCandidate,
    },
}

/// A reroll supersedes its source while the source is still pending: the source as superseded, keyed by its hash.
fn superseded_by_reroll(
    source_hash: &str,
    source: &StoredCandidate,
) -> Option<(String, StoredCandidate)> {
    (source.record.status == CandidateStatus::Pending).then(|| {
        let mut superseded = source.clone();
        superseded.record.status = CandidateStatus::Superseded;
        (source_hash.to_owned(), superseded)
    })
}

impl MachineSession {
    /// The candidate commands: roll_world, inspect_candidate, summarize_trajectory, reroll_candidate,
    /// reject_candidate and commit_candidate.
    pub(super) fn execute_candidate_command(
        &mut self,
        operation: CandidateOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            CandidateOperation::RollWorld => self.roll_world(command),
            CandidateOperation::InspectCandidate => self.inspect_candidate(command),
            CandidateOperation::SummarizeTrajectory => self.summarize_trajectory(command),
            CandidateOperation::RerollCandidate => self.reroll_candidate(command),
            CandidateOperation::RejectCandidate => self.reject_candidate(command),
            CandidateOperation::CommitCandidate => {
                let hash = required(
                    command.candidate_hash,
                    "commit_candidate requires candidate_hash",
                )?;
                self.commit_candidate(&hash, command.view.unwrap_or_default())
            }
        }
    }

    /// Rolls a world's current head forward into a pending candidate, or answers the candidate already stored.
    fn roll_world(&mut self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        let world_id = required(command.world_id, "roll_world requires world_id")?;
        let query = required(command.query, "roll_world requires query")?;
        let parent = self
            .worlds
            .get(&world_id)
            .cloned()
            .ok_or_else(|| machine_error("not_found", format!("unknown world {world_id}")))?;
        let model = self.models.get(&parent.model_hash)?.ok_or_else(|| {
            machine_error("not_found", format!("unknown model {}", parent.model_hash))
        })?;
        let result = roll_model_transition(&model, &parent, query)?;
        let record = CandidateRecord {
            status: CandidateStatus::Pending,
            candidate: result.candidate,
            proposed_head: result.proposed_head,
        };
        if let Some(existing) = self
            .candidates
            .get(&record.candidate.candidate_hash)
            .cloned()
        {
            let view = candidate_original_view(&record.candidate);
            return self.answer_existing_candidate(
                &model,
                &parent,
                record,
                existing,
                view,
                RolledBy::RollWorld,
            );
        }
        let stored = StoredCandidate {
            record: record.clone(),
            parent,
        };
        self.ensure_candidate_insert(&stored)?;
        self.candidates
            .insert(record.candidate.candidate_hash.clone(), stored);
        self.mark_dirty(DirtyRow::Candidate, record.candidate.candidate_hash.clone());
        let view = candidate_original_view(&record.candidate);
        Ok(attach_retention_upgrade(
            candidate_record_view(&model, &record, view)?,
            false,
        ))
    }

    /// Projects a stored candidate under the caller's view.
    fn inspect_candidate(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let hash = required(
            command.candidate_hash,
            "inspect_candidate requires candidate_hash",
        )?;
        let stored = self
            .candidates
            .get(&hash)
            .ok_or_else(|| machine_error("not_found", format!("unknown candidate {hash}")))?;
        let model = self
            .models
            .get(&stored.record.candidate.model_hash)?
            .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
        let view = command.view.unwrap_or_default();
        encode(candidate_record_view(&model, &stored.record, view)?)
    }

    /// Summarizes a stored candidate's retained path over an interval.
    fn summarize_trajectory(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let hash = required(
            command.candidate_hash,
            "summarize_trajectory requires candidate_hash",
        )?;
        let spec = required(
            command.trajectory_summary,
            "summarize_trajectory requires trajectory_summary",
        )?;
        let stored = self
            .candidates
            .get(&hash)
            .ok_or_else(|| machine_error("not_found", format!("unknown candidate {hash}")))?;
        let model = self
            .models
            .get(&stored.record.candidate.model_hash)?
            .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
        encode(summarize_model_trajectory(
            &model,
            &stored.parent,
            &stored.record.candidate,
            spec,
        )?)
    }

    /// Rolls a stored candidate's frozen parent again with the next roll index, superseding the candidate while it is
    /// pending. A new reroll needs the parent to still be the world's head.
    fn reroll_candidate(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let hash = required(
            command.candidate_hash,
            "reroll_candidate requires candidate_hash",
        )?;
        let original = self
            .candidates
            .get(&hash)
            .cloned()
            .ok_or_else(|| machine_error("not_found", format!("unknown candidate {hash}")))?;
        if original.record.status == CandidateStatus::Committed {
            return Err(machine_error(
                "conflict",
                "committed candidate cannot be rerolled",
            ));
        }
        let model = self
            .models
            .get(&original.record.candidate.model_hash)?
            .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
        let mut response_view = command.view.unwrap_or_default();
        normalize_view(&model, &mut response_view)?;
        let mut query = original.record.candidate.query.clone();
        query.roll_index = query
            .roll_index
            .checked_add(1)
            .ok_or_else(|| machine_error("invalid_request", "roll_index overflow"))?;
        let result = roll_model_transition(&model, &original.parent, query)?;
        let record = CandidateRecord {
            status: CandidateStatus::Pending,
            candidate: result.candidate,
            proposed_head: result.proposed_head,
        };
        if let Some(existing) = self
            .candidates
            .get(&record.candidate.candidate_hash)
            .cloned()
        {
            return self.answer_existing_candidate(
                &model,
                &original.parent,
                record,
                existing,
                response_view,
                RolledBy::Reroll {
                    source_hash: &hash,
                    source: &original,
                },
            );
        }
        let current_head = self
            .worlds
            .get(&original.record.candidate.world_id)
            .ok_or_else(|| machine_error("not_found", "candidate world is unavailable"))?;
        if current_head.world_hash != original.parent.world_hash
            || current_head.version != original.parent.version
        {
            return Err(machine_error(
                "conflict",
                "cannot create a new reroll from a stale frozen parent; fork or resimulate from the current head",
            ));
        }
        let stored = StoredCandidate {
            record: record.clone(),
            parent: original.parent.clone(),
        };
        let replacements: BTreeMap<String, StoredCandidate> =
            superseded_by_reroll(&hash, &original).into_iter().collect();
        self.ensure_candidate_changes(&replacements, Some(&stored))?;
        self.candidates
            .insert(record.candidate.candidate_hash.clone(), stored);
        self.mark_dirty(DirtyRow::Candidate, record.candidate.candidate_hash.clone());
        for (candidate_hash, replacement) in replacements {
            self.candidates.insert(candidate_hash.clone(), replacement);
            self.mark_dirty(DirtyRow::Candidate, candidate_hash);
        }
        Ok(attach_retention_upgrade(
            candidate_record_view(&model, &record, response_view)?,
            false,
        ))
    }

    /// Marks a pending candidate rejected.
    fn reject_candidate(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let hash = required(
            command.candidate_hash,
            "reject_candidate requires candidate_hash",
        )?;
        let stored = self
            .candidates
            .get(&hash)
            .ok_or_else(|| machine_error("not_found", format!("unknown candidate {hash}")))?;
        if stored.record.status != CandidateStatus::Pending {
            return Err(machine_error(
                "conflict",
                format!("candidate is already {:?}", stored.record.status),
            ));
        }
        let mut record = stored.record.clone();
        record.status = CandidateStatus::Rejected;
        let model = self
            .models
            .get(&record.candidate.model_hash)?
            .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
        let view = command.view.unwrap_or_default();
        let projected = candidate_record_view(&model, &record, view)?;
        let mut replacement = stored.clone();
        replacement.record = record;
        self.ensure_candidate_replacement(&hash, &replacement)?;
        self.candidates.insert(hash.clone(), replacement);
        self.mark_dirty(DirtyRow::Candidate, hash);
        encode(projected)
    }

    /// Answers a roll or reroll whose candidate is already stored. The stored candidate must hold the same canonical
    /// content from the same frozen parent, or the roll is refused as a conflict. A richer retained path replaces
    /// the stored one, and a reroll's pending source is marked superseded with it; nothing else changes, and nothing
    /// is written when neither applies. The answer projects the rolled record, under `view`, with the stored
    /// candidate's status and whether its retention was upgraded.
    fn answer_existing_candidate(
        &mut self,
        model: &CompiledModel,
        parent: &WorldHead,
        rolled: CandidateRecord,
        existing: StoredCandidate,
        view: ViewSpec,
        rolled_by: RolledBy<'_>,
    ) -> Result<serde_json::Value, MachineError> {
        if existing.parent != *parent
            || !same_candidate_canon(&existing.record.candidate, &rolled.candidate)
            || existing.record.proposed_head != rolled.proposed_head
        {
            let message = match rolled_by {
                RolledBy::RollWorld => {
                    "candidate hash is already bound to different canonical content"
                }
                RolledBy::Reroll { .. } => {
                    "reroll candidate hash is already bound to different content"
                }
            };
            return Err(machine_error("conflict", message));
        }
        let retention_upgraded =
            path_is_richer(&rolled.candidate.path, &existing.record.candidate.path);
        let mut replacements = BTreeMap::new();
        if retention_upgraded {
            let mut replacement = existing.clone();
            replacement.record.candidate.query = rolled.candidate.query.clone();
            replacement.record.candidate.query_hash = rolled.candidate.query_hash.clone();
            replacement.record.candidate.path = rolled.candidate.path.clone();
            replacements.insert(rolled.candidate.candidate_hash.clone(), replacement);
        }
        if let RolledBy::Reroll {
            source_hash,
            source,
        } = rolled_by
        {
            replacements.extend(superseded_by_reroll(source_hash, source));
        }
        if !replacements.is_empty() {
            self.ensure_candidate_changes(&replacements, None)?;
            for (candidate_hash, replacement) in replacements {
                self.candidates.insert(candidate_hash.clone(), replacement);
                self.mark_dirty(DirtyRow::Candidate, candidate_hash);
            }
        }
        let answered = CandidateRecord {
            status: existing.record.status,
            ..rolled
        };
        let projected = candidate_record_view(model, &answered, view)?;
        Ok(attach_retention_upgrade(projected, retention_upgraded))
    }

    fn commit_candidate(
        &mut self,
        hash: &str,
        view: ViewSpec,
    ) -> Result<serde_json::Value, MachineError> {
        // Everything is cloned and validated before the one accepted-head replacement.
        let stored = self
            .candidates
            .get(hash)
            .cloned()
            .ok_or_else(|| machine_error("not_found", format!("unknown candidate {hash}")))?;
        if stored.record.status != CandidateStatus::Pending {
            return Err(machine_error(
                "conflict",
                format!("candidate is already {:?}", stored.record.status),
            ));
        }
        let world_id = stored.record.candidate.world_id.clone();
        let current = self
            .worlds
            .get(&world_id)
            .ok_or_else(|| machine_error("not_found", format!("unknown world {world_id}")))?;
        if current.world_hash != stored.record.candidate.parent_world_hash
            || current.version != stored.record.candidate.expected_parent_version
        {
            return Err(machine_error(
                "conflict",
                "candidate parent is no longer the accepted world head",
            ));
        }
        let proposed = stored.record.proposed_head.clone();
        self.ensure_world_replacement(&world_id, &proposed)?;
        let model = self
            .models
            .get(&stored.record.candidate.model_hash)?
            .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
        let mut committed = stored.record.clone();
        committed.status = CandidateStatus::Committed;
        let mut replacements = BTreeMap::new();
        for (candidate_hash, candidate) in &self.candidates {
            if candidate.record.candidate.world_id == world_id
                && candidate.record.candidate.parent_world_hash
                    == stored.record.candidate.parent_world_hash
                && candidate.record.status == CandidateStatus::Pending
            {
                let mut replacement = candidate.clone();
                replacement.record.status = if replacement.record.candidate.candidate_hash == hash {
                    CandidateStatus::Committed
                } else {
                    CandidateStatus::Superseded
                };
                replacements.insert(candidate_hash.clone(), replacement);
            }
        }
        self.ensure_candidate_changes(&replacements, None)?;
        let response = serde_json::json!({
            "candidate": candidate_record_view(&model, &committed, view.clone())?,
            "world_head": world_view(&model, &proposed, view)?
        });
        self.worlds.insert(world_id.clone(), proposed.clone());
        self.mark_dirty(DirtyRow::World, world_id);
        for (candidate_hash, replacement) in replacements {
            self.candidates.insert(candidate_hash.clone(), replacement);
            self.mark_dirty(DirtyRow::Candidate, candidate_hash);
        }
        Ok(response)
    }
}
