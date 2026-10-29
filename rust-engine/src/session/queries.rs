//! The read-only projections of a model, world or candidate: its factor graph and its view. Neither changes the
//! session, and a graph query that expects a snapshot other than the one it would read is refused with `conflict`.

use std::collections::BTreeMap;

use crate::model::definition::ProcessValue;
use crate::model::graph::{factor_graph_response, GraphSnapshotSource};
use crate::model::view::{candidate_record_view, world_view};
use crate::model::world::validate_world;
use crate::session::operation::QueryOperation;
use crate::session::{
    encode, machine_error, required, MachineCommand, MachineError, MachineSession,
};

impl MachineSession {
    /// The read-only projections: query_graph and query_view.
    pub(super) fn execute_query_command(
        &self,
        operation: QueryOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            QueryOperation::QueryGraph => self.query_graph(command),
            QueryOperation::QueryView => self.query_view(command),
        }
    }

    fn query_view(&self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        let view = required(command.view, "query_view requires view")?;
        match (command.world_id, command.candidate_hash) {
            (Some(world_id), None) => {
                let world = self.worlds.get(&world_id).ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                let model = self.models.get(&world.model_hash)?.ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {}", world.model_hash))
                })?;
                encode(world_view(&model, world, view)?)
            }
            (None, Some(candidate_hash)) => {
                let stored = self.candidates.get(&candidate_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {candidate_hash}"))
                })?;
                let model = self
                    .models
                    .get(&stored.record.candidate.model_hash)?
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                encode(candidate_record_view(&model, &stored.record, view)?)
            }
            _ => Err(machine_error(
                "invalid_request",
                "query_view requires exactly one of world_id or candidate_hash",
            )),
        }
    }

    fn query_graph(&self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        let query = required(command.graph_query, "query_graph requires graph_query")?;
        let source_count = usize::from(command.model_hash.is_some())
            + usize::from(command.world_id.is_some())
            + usize::from(command.candidate_hash.is_some());
        if source_count != 1 {
            return Err(machine_error(
                "invalid_request",
                "query_graph requires exactly one of model_hash, world_id, or candidate_hash",
            ));
        }
        if let Some(model_hash) = command.model_hash {
            let model = self
                .models
                .get(&model_hash)?
                .ok_or_else(|| machine_error("not_found", format!("unknown model {model_hash}")))?;
            let state: BTreeMap<String, ProcessValue> = model
                .processes
                .values()
                .map(|process| (process.id.clone(), process.initial_value.clone()))
                .collect();
            let source = GraphSnapshotSource {
                kind: "model".to_owned(),
                model_hash: model.model_hash.clone(),
                model_revision: model.revision.number,
                source_hash: model.model_hash.clone(),
                world_id: None,
                world_version: None,
                time: None,
                candidate_status: None,
            };
            return encode(factor_graph_response(
                &model,
                &state,
                "model_initial_value",
                None,
                source,
                query,
            )?);
        }
        if let Some(world_id) = command.world_id {
            let world = self
                .worlds
                .get(&world_id)
                .ok_or_else(|| machine_error("not_found", format!("unknown world {world_id}")))?;
            let model = self.models.get(&world.model_hash)?.ok_or_else(|| {
                machine_error("not_found", format!("unknown model {}", world.model_hash))
            })?;
            validate_world(&model, world)?;
            let source = GraphSnapshotSource {
                kind: "world".to_owned(),
                model_hash: model.model_hash.clone(),
                model_revision: model.revision.number,
                source_hash: world.world_hash.clone(),
                world_id: Some(world.world_id.clone()),
                world_version: Some(world.version),
                time: Some(world.time),
                candidate_status: None,
            };
            return encode(factor_graph_response(
                &model,
                &world.state,
                "accepted_world_state",
                None,
                source,
                query,
            )?);
        }
        let candidate_hash = command
            .candidate_hash
            .expect("exactly one graph source was already required");
        let stored = self.candidates.get(&candidate_hash).ok_or_else(|| {
            machine_error("not_found", format!("unknown candidate {candidate_hash}"))
        })?;
        let model = self
            .models
            .get(&stored.record.candidate.model_hash)?
            .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
        let source = GraphSnapshotSource {
            kind: "candidate".to_owned(),
            model_hash: model.model_hash.clone(),
            model_revision: model.revision.number,
            source_hash: stored.record.candidate.candidate_hash.clone(),
            world_id: Some(stored.record.candidate.world_id.clone()),
            world_version: Some(stored.record.proposed_head.version),
            time: Some(stored.record.candidate.end_time),
            candidate_status: Some(stored.record.status),
        };
        encode(factor_graph_response(
            &model,
            &stored.record.candidate.successor_state,
            "candidate_successor_state",
            Some(&stored.record.candidate.marks),
            source,
            query,
        )?)
    }
}
