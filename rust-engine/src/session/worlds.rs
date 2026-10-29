//! World commands: creating a world from a model's genesis, reading it, refining an untouched genesis, and revising an
//! accepted head to the direct next model revision.
//!
//! A world id is created once. A revision names the head it was written against and is refused with `conflict` when the
//! head has moved. Refining a genesis is allowed only while the head is untouched (version 0, time 0, no lineage), and
//! only to the direct next model revision.

use crate::model::compile::CompiledModel;
use crate::model::revision::validate_monotonic_genesis_refinement;
use crate::model::view::{world_revision_view, world_view};
use crate::model::world::{build_world_revision, validate_world};
use crate::session::operation::WorldOperation;
use crate::session::{
    encode, machine_error, required, DirtyRow, MachineCommand, MachineError, MachineSession,
};

impl MachineSession {
    /// The world commands: create_world, get_world, refine_genesis_world, revise_world and get_world_revision.
    pub(super) fn execute_world_command(
        &mut self,
        operation: WorldOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            WorldOperation::CreateWorld => self.create_world(command),
            WorldOperation::GetWorld => {
                let world_id = required(command.world_id, "get_world requires world_id")?;
                let world = self.worlds.get(&world_id).ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                let model = self.models.get(&world.model_hash)?.ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {}", world.model_hash))
                })?;
                encode(world_view(&model, world, command.view.unwrap_or_default())?)
            }
            WorldOperation::RefineGenesisWorld => self.refine_genesis_world(command),
            WorldOperation::ReviseWorld => self.revise_world(command),
            WorldOperation::GetWorldRevision => self.get_world_revision(command),
        }
    }

    /// Creates a world at the genesis of a registered model.
    fn create_world(&mut self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        let model_hash = required(command.model_hash, "create_world requires model_hash")?;
        let world_id = required(command.world_id, "create_world requires world_id")?;
        if self.worlds.contains_key(&world_id) {
            return Err(machine_error(
                "conflict",
                format!("world {world_id} already exists"),
            ));
        }
        let model = self
            .models
            .get(&model_hash)?
            .ok_or_else(|| machine_error("not_found", format!("unknown model {model_hash}")))?;
        let world = model.genesis_world(world_id.clone())?;
        let projected = world_view(&model, &world, command.view.unwrap_or_default())?;
        self.ensure_world_insert(&world)?;
        self.worlds.insert(world_id.clone(), world.clone());
        self.mark_dirty(DirtyRow::World, world_id);
        encode(projected)
    }

    /// Moves an untouched genesis world to the direct next revision of its model, which may only add to it.
    fn refine_genesis_world(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let world_id = required(command.world_id, "refine_genesis_world requires world_id")?;
        let target_model_hash = required(
            command.model_hash,
            "refine_genesis_world requires target model_hash",
        )?;
        let current = self
            .worlds
            .get(&world_id)
            .cloned()
            .ok_or_else(|| machine_error("not_found", format!("unknown world {world_id}")))?;
        let source = self
            .models
            .get(&current.model_hash)?
            .map(|model| CompiledModel::clone(&model))
            .ok_or_else(|| {
                machine_error(
                    "not_found",
                    format!("unknown source model {}", current.model_hash),
                )
            })?;
        validate_world(&source, &current)?;
        if current.version != 0
            || current.time != 0.0
            || current.lineage_head.is_some()
            || current != source.genesis_world(world_id.clone())?
        {
            return Err(machine_error(
                "conflict",
                "refine_genesis_world requires an untouched genesis head (version 0, time 0, no lineage); use revise_world for an explicit revision after accepted history",
            ));
        }

        let target = self
            .models
            .get(&target_model_hash)?
            .map(|model| CompiledModel::clone(&model))
            .ok_or_else(|| {
                machine_error(
                    "not_found",
                    format!("unknown target model {target_model_hash}"),
                )
            })?;
        if target.revision.number != source.revision.number + 1
            || target.revision.previous_model_hash.as_deref() != Some(source.model_hash.as_str())
        {
            return Err(machine_error(
                "conflict",
                "refine_genesis_world requires the direct next revision of the world's current model; sibling or skipped revisions are not accepted",
            ));
        }
        let audit = validate_monotonic_genesis_refinement(&source, &target)?;
        let refined = target.genesis_world(world_id.clone())?;
        let old_state_preserved = current
            .state
            .iter()
            .all(|(id, value)| refined.state.get(id) == Some(value));
        let old_claims_preserved = current
            .claims
            .iter()
            .all(|(id, claim)| refined.claims.get(id) == Some(claim));
        if !old_state_preserved || !old_claims_preserved {
            return Err(machine_error(
                "internal_error",
                "validated genesis refinement failed to preserve old state or claims",
            ));
        }

        let projected = world_view(&target, &refined, command.view.unwrap_or_default())?;
        self.ensure_world_replacement(&world_id, &refined)?;
        let response = serde_json::json!({
            "operation": "refine_genesis_world",
            "boundary": "genesis_only_authored_refinement",
            "source_model_hash": source.model_hash,
            "target_model_hash": target.model_hash,
            "source_revision": source.revision.number,
            "target_revision": target.revision.number,
            "conservation": {
                "world_id_preserved": current.world_id == refined.world_id,
                "old_state_preserved": old_state_preserved,
                "old_claims_preserved": old_claims_preserved,
                "accepted_history_preserved": current.version == refined.version
                    && current.time == refined.time
                    && current.lineage_head == refined.lineage_head,
                "monotonic_definition": true
            },
            "records": audit,
            "world_head": projected,
            "limitations": [
                "authored target revision must already be registered",
                "automatic cut or concept discovery is not implemented",
                "use revise_world for an explicit revision after accepted history"
            ]
        });
        let encoded = encode(response)?;
        self.worlds.insert(world_id.clone(), refined);
        self.mark_dirty(DirtyRow::World, world_id);
        Ok(encoded)
    }

    /// Moves a world's accepted head to the direct next model revision at an unchanged time, recording the revision.
    fn revise_world(&mut self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        let world_id = required(command.world_id, "revise_world requires world_id")?;
        let target_model_hash = required(
            command.model_hash,
            "revise_world requires target model_hash",
        )?;
        let spec = required(
            command.world_revision,
            "revise_world requires world_revision",
        )?;
        let current = self
            .worlds
            .get(&world_id)
            .ok_or_else(|| machine_error("not_found", format!("unknown world {world_id}")))?;
        if spec.expected_world_hash != current.world_hash {
            return Err(machine_error(
                "conflict",
                format!(
                    "world {world_id} changed: expected {}, found {}",
                    spec.expected_world_hash, current.world_hash
                ),
            ));
        }
        let source = self
            .models
            .get(&current.model_hash)?
            .ok_or_else(|| machine_error("not_found", "world source model is unavailable"))?;
        let target = self.models.get(&target_model_hash)?.ok_or_else(|| {
            machine_error(
                "not_found",
                format!("unknown target model {target_model_hash}"),
            )
        })?;
        let revision = build_world_revision(&source, &target, current, spec)?;
        self.ensure_world_replacement(&world_id, &revision.target_head)?;
        self.ensure_world_revision_insert(&revision)?;
        let view = command.view.unwrap_or_default();
        let response = encode(serde_json::json!({
            "operation": "revise_world",
            "world_revision_hash": revision.world_revision_hash,
            "world_revision": world_revision_view(&source, &target, &revision, view.clone())?,
            "world_head": world_view(&target, &revision.target_head, view)?,
            "limitations": [
                "new process values must be explicitly supplied at the current world time; target model initial values and claims are not injected",
                "portable narrative and checkpoint export across world revisions is unsupported; complete accepted history remains in the session database"
            ]
        }))?;
        self.worlds
            .insert(world_id.clone(), revision.target_head.clone());
        self.mark_dirty(DirtyRow::World, world_id);
        let hash = revision.world_revision_hash.clone();
        self.world_revisions.insert(hash.clone(), revision);
        self.mark_dirty(DirtyRow::WorldRevision, hash);
        Ok(response)
    }

    /// Projects a stored world revision.
    fn get_world_revision(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let hash = required(
            command.world_revision_hash,
            "get_world_revision requires world_revision_hash",
        )?;
        let revision = self
            .world_revisions
            .get(&hash)
            .ok_or_else(|| machine_error("not_found", format!("unknown world revision {hash}")))?;
        let source = self
            .models
            .get(&revision.source_head.model_hash)?
            .ok_or_else(|| machine_error("not_found", "revision source model is unavailable"))?;
        let target = self
            .models
            .get(&revision.target_head.model_hash)?
            .ok_or_else(|| machine_error("not_found", "revision target model is unavailable"))?;
        encode(
            serde_json::json!({"world_revision": world_revision_view(&source, &target, revision, command.view.unwrap_or_default())?}),
        )
    }
}
