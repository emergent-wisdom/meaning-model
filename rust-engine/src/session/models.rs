//! Model commands: compiling, validating, registering, revising and reading model revisions.
//!
//! A model is stored under its content hash. Registering the same definition again answers with the stored revision,
//! and a hash already bound to different content is a `conflict`, as is a second revision zero under an id already
//! used. A revision keeps its model's id, is numbered one past the revision it names, and may change processes only as
//! model/revision.rs allows.

use crate::model::compile::{compile_model, CompiledModel};
use crate::model::revision::validate_revision_process_changes;
use crate::profiles::compile_profiles;
use crate::session::operation::ModelOperation;
use crate::session::{
    encode, machine_error, required, DirtyRow, MachineCommand, MachineError, MachineSession,
};

impl MachineSession {
    /// The model commands: compile_profiles, validate_model, register_model, revise_model and get_model.
    pub(super) fn execute_model_command(
        &mut self,
        operation: ModelOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            ModelOperation::CompileProfiles => {
                let request = required(
                    command.profile_request,
                    "compile_profiles requires profile_request",
                )?;
                let model = compile_profiles(request)?;
                let compiled = compile_model(model)?;
                encode(serde_json::json!({
                    "summary": compiled.summary(),
                    "model": compiled.definition(),
                    "stored": false,
                    "mutation_performed": false
                }))
            }
            ModelOperation::ValidateModel => {
                let model = required(command.model, "validate_model requires model")?;
                let compiled = compile_model(model)?;
                encode(serde_json::json!({
                    "summary": compiled.summary(),
                    "model": compiled.definition()
                }))
            }
            ModelOperation::RegisterModel | ModelOperation::ReviseModel => {
                self.register_or_revise_model(operation, command)
            }
            ModelOperation::GetModel => {
                let model_hash = required(command.model_hash, "get_model requires model_hash")?;
                let model = self.models.get(&model_hash)?.ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {model_hash}"))
                })?;
                encode(serde_json::json!({
                    "model_hash": model.model_hash,
                    "summary": model.summary(),
                    "model": model.definition()
                }))
            }
        }
    }

    /// Registers a model at revision zero or a revision of one already held; a model already held is answered as it is.
    fn register_or_revise_model(
        &mut self,
        operation: ModelOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let model = required(command.model, "model operation requires model")?;
        let compiled = compile_model(model)?;
        if operation == ModelOperation::RegisterModel && compiled.revision.number != 0 {
            return Err(machine_error(
                "invalid_request",
                "register_model requires revision 0; use revise_model",
            ));
        }
        if operation == ModelOperation::ReviseModel && compiled.revision.number == 0 {
            return Err(machine_error(
                "invalid_request",
                "revise_model requires a nonzero revision",
            ));
        }
        self.validate_revision_link(&compiled)?;
        let result = serde_json::json!({
            "summary": compiled.summary(),
            "model": compiled.definition()
        });
        let model_hash = compiled.model_hash.clone();
        if !self.models.contains_key(&model_hash) {
            let stored = self.models.kept_form(&compiled)?;
            self.ensure_model_insert(&compiled, &stored)?;
            self.models
                .insert_stored(std::sync::Arc::new(compiled), stored)?;
            self.mark_dirty(DirtyRow::Model, model_hash);
        }
        encode(result)
    }

    fn validate_revision_link(&self, model: &CompiledModel) -> Result<(), MachineError> {
        if let Some(existing) = self.models.get(&model.model_hash)? {
            if existing.definition == model.definition {
                return Ok(());
            }
            return Err(machine_error(
                "conflict",
                "model hash is already bound to different content",
            ));
        }
        let Some(previous_hash) = &model.revision.previous_model_hash else {
            if self.models.entries().any(|(hash, existing)| {
                existing.header.id == model.id
                    && existing.header.revision_number == 0
                    && hash != &model.model_hash
            }) {
                return Err(machine_error(
                    "conflict",
                    "a different revision-zero model already uses this model id",
                ));
            }
            return Ok(());
        };
        let previous = self.models.get(previous_hash)?.ok_or_else(|| {
            machine_error(
                "not_found",
                format!("unknown previous model {previous_hash}"),
            )
        })?;
        if previous.id != model.id || model.revision.number != previous.revision.number + 1 {
            return Err(machine_error(
                "invalid_request",
                "model revision must preserve id and increment the previous revision by one",
            ));
        }
        validate_revision_process_changes(&previous, model)?;
        Ok(())
    }
}
