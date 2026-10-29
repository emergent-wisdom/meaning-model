//! Project checkpoints in the session: registering one with its document and frozen snapshots, and listing, reading,
//! exporting, rendering and querying them by name or hash.
//!
//! A checkpoint is immutable: its name is registered once, and its hash names exactly one checkpoint. Its frozen model,
//! world and graph must agree with one another and with the source they were taken from (`conflict` otherwise), and a
//! checkpoint imported with its frozen material is checked again in full before it is stored.

use std::collections::BTreeSet;

use serde::de::DeserializeOwned;

use crate::limits::{
    serialized_size, MAX_MODEL_IDENTIFIER_BYTES, MAX_OBSERVATION_PROVENANCE,
    MAX_PROJECT_CHECKPOINTS, MAX_PROJECT_DOCUMENT_BYTES, MAX_PROJECT_EXPORT_BYTES,
    MAX_PROJECT_STORAGE_BYTES,
};
use crate::model::compile::{compile_model, validate_process_value, CompiledModel};
use crate::model::definition::ModelDefinition;
use crate::model::narrative::{
    compile_narrative_graph, NarrativeGraphQuery, NarrativeRenderSpec, NarrativeSourceSnapshot,
    StoredNarrativeGraph, MAX_NARRATIVE_STRING_BYTES,
};
use crate::model::project::{
    is_project_checkpoint_hash_shaped_name, project_graph_snapshot_hash,
    validate_project_graph_source_binding, ProjectCheckpointCore, ProjectCheckpointDefinition,
    ProjectDocumentContent, ProjectDocumentDefinition, StoredProjectCheckpoint,
    StoredProjectDocument,
};
use crate::model::world::{validate_world, WorldHead};
use crate::model::{
    PROJECT_CHECKPOINT_EXPORT_SCHEMA, PROJECT_CHECKPOINT_LIST_SCHEMA,
    PROJECT_CHECKPOINT_RENDER_SCHEMA, PROJECT_CHECKPOINT_SCHEMA, PROJECT_DOCUMENT_SCHEMA,
};
use crate::session::operation::CheckpointOperation;
use crate::session::{
    encode, machine_error, required, DirtyRow, MachineCommand, MachineError, MachineSession,
};
use crate::{error, hash_serializable, EngineResult};

impl MachineSession {
    /// The project checkpoint commands: register_project_checkpoint, list_project_checkpoints,
    /// get_project_checkpoint, export_project_checkpoint, render_project_checkpoint and query_project_checkpoint_graph.
    pub(super) fn execute_checkpoint_command(
        &mut self,
        operation: CheckpointOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            CheckpointOperation::RegisterProjectCheckpoint => {
                let checkpoint = required(
                    command.project_checkpoint,
                    "register_project_checkpoint requires project_checkpoint",
                )?;
                self.register_project_checkpoint(checkpoint)
            }
            CheckpointOperation::ListProjectCheckpoints => self.list_project_checkpoints(),
            CheckpointOperation::GetProjectCheckpoint => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "get_project_checkpoint requires project_checkpoint_id",
                )?;
                self.get_project_checkpoint(&identifier)
            }
            CheckpointOperation::ExportProjectCheckpoint => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "export_project_checkpoint requires project_checkpoint_id",
                )?;
                self.export_project_checkpoint(&identifier)
            }
            CheckpointOperation::RenderProjectCheckpoint => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "render_project_checkpoint requires project_checkpoint_id",
                )?;
                self.render_project_checkpoint(&identifier, command.narrative_render)
            }
            CheckpointOperation::QueryProjectCheckpointGraph => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "query_project_checkpoint_graph requires project_checkpoint_id",
                )?;
                let query = required(
                    command.narrative_query,
                    "query_project_checkpoint_graph requires narrative_query",
                )?;
                self.query_project_checkpoint_graph(&identifier, query)
            }
        }
    }

    fn resolve_project_checkpoint(
        &self,
        identifier: &str,
    ) -> Result<&StoredProjectCheckpoint, MachineError> {
        if identifier.trim().is_empty() || identifier.len() > MAX_MODEL_IDENTIFIER_BYTES {
            return Err(machine_error(
                "invalid_request",
                "project checkpoint identifier must be nonempty and bounded",
            ));
        }
        let hash = self
            .project_checkpoints
            .contains_key(identifier)
            .then_some(identifier)
            .or_else(|| {
                self.project_checkpoint_names
                    .get(identifier)
                    .map(String::as_str)
            })
            .ok_or_else(|| {
                machine_error(
                    "not_found",
                    format!("unknown project checkpoint {identifier}"),
                )
            })?;
        self.project_checkpoints.get(hash).ok_or_else(|| {
            machine_error(
                "internal_error",
                "project checkpoint name index is inconsistent",
            )
        })
    }

    pub(super) fn find_world_by_hash(&self, world_hash: &str) -> Option<WorldHead> {
        self.worlds
            .values()
            .find(|world| world.world_hash == world_hash)
            .cloned()
            .or_else(|| {
                self.candidates.values().find_map(|stored| {
                    if stored.record.proposed_head.world_hash == world_hash {
                        Some(stored.record.proposed_head.clone())
                    } else if stored.parent.world_hash == world_hash {
                        Some(stored.parent.clone())
                    } else {
                        None
                    }
                })
            })
            .or_else(|| self.project_world_snapshots.get(world_hash).cloned())
            .or_else(|| {
                self.world_revisions.values().find_map(|revision| {
                    [&revision.source_head, &revision.target_head]
                        .into_iter()
                        .find(|world| world.world_hash == world_hash)
                        .cloned()
                })
            })
    }

    fn world_has_revision_history(&self, world: &WorldHead) -> bool {
        let mut cursor = world;
        let mut seen = BTreeSet::new();
        while let Some(hash) = cursor.lineage_head.as_deref() {
            if self.world_revisions.contains_key(hash) {
                return true;
            }
            if !seen.insert(hash) {
                break;
            }
            let Some(candidate) = self.candidates.get(hash) else {
                break;
            };
            cursor = &candidate.parent;
        }
        false
    }

    pub(super) fn ensure_portable_source_history(
        &self,
        snapshot: &NarrativeSourceSnapshot,
    ) -> Result<(), MachineError> {
        let world = if snapshot.source_kind == "candidate" {
            self.candidates
                .get(&snapshot.source_hash)
                .map(|stored| stored.parent.clone())
        } else if snapshot.source_kind == "world" {
            self.find_world_by_hash(&snapshot.source_hash)
        } else {
            None
        };
        if world
            .as_ref()
            .is_some_and(|world| self.world_has_revision_history(world))
        {
            return Err(machine_error("unsupported_history", "portable narrative/checkpoint export across world revisions is not supported; the complete accepted history remains preserved in the session database"));
        }
        Ok(())
    }

    fn project_checkpoint_summary(
        &self,
        checkpoint: &StoredProjectCheckpoint,
    ) -> EngineResult<serde_json::Value> {
        let document = self
            .project_documents
            .get(&checkpoint.core.document_hash)
            .ok_or_else(|| error("project checkpoint document is unavailable"))?;
        Ok(serde_json::json!({
            "schema": PROJECT_CHECKPOINT_SCHEMA,
            "checkpoint_hash": checkpoint.checkpoint_hash,
            "checkpoint_sequence": checkpoint.checkpoint_sequence,
            "name": checkpoint.core.name,
            "parent_checkpoint_hash": checkpoint.core.parent_checkpoint_hash,
            "document": {
                "document_hash": document.document_hash,
                "media_type": document.media_type,
                "byte_count": document.content.len(),
                "canonical_external_path": checkpoint.core.canonical_external_path,
            },
            "model_hash": checkpoint.core.model_hash,
            "world_hash": checkpoint.core.world_hash,
            "narrative_graph_hash": checkpoint.core.narrative_graph_hash,
            "narrative_graph_snapshot_hash": checkpoint.core.narrative_graph_snapshot_hash,
            "reason": checkpoint.core.reason,
            "provenance": checkpoint.core.provenance,
            "immutable": true,
        }))
    }

    /// Registers a project checkpoint: a document, and whichever of a model, world and narrative graph it freezes,
    /// each named by hash or carried as imported material. Everything is checked before anything is stored, in a
    /// fixed order, and the first problem found is the one reported: the checkpoint's own fields, its parent, its
    /// document, the model, world and graph snapshots, their agreement on one model, and last the storage bound.
    pub(super) fn register_project_checkpoint(
        &mut self,
        definition: ProjectCheckpointDefinition,
    ) -> Result<serde_json::Value, MachineError> {
        self.check_checkpoint_fields(&definition)?;
        let parent_checkpoint_hash = definition
            .parent_checkpoint
            .as_deref()
            .map(|identifier| {
                self.resolve_project_checkpoint(identifier)
                    .map(|checkpoint| checkpoint.checkpoint_hash.clone())
            })
            .transpose()?;
        let canonical_external_path = definition.document.canonical_external_path.clone();
        let document = self.checkpoint_document(definition.document)?;
        let imported_model = imported_snapshot::<ModelDefinition>(
            definition.model_snapshot,
            definition.model_snapshot_json,
            "model",
        )?
        .map(compile_model)
        .transpose()?;
        let imported_world = imported_snapshot::<WorldHead>(
            definition.world_snapshot,
            definition.world_snapshot_json,
            "world",
        )?;
        let (world_hash, world) = self.checkpoint_world(definition.world_hash, imported_world)?;
        let imported_graph = imported_snapshot::<StoredNarrativeGraph>(
            definition.narrative_graph_snapshot,
            definition.narrative_graph_snapshot_json,
            "graph",
        )?;
        let graph = self.checkpoint_graph(
            imported_graph,
            definition.narrative_graph_hash,
            definition.narrative_graph_snapshot_hash,
        )?;
        let (model_hash, model) = self.checkpoint_model(
            definition.model_hash,
            imported_model,
            world.as_ref(),
            graph.as_ref().map(|frozen| &frozen.graph),
        )?;
        if let Some(model) = &model {
            validate_frozen_against_model(
                model,
                world.as_ref(),
                graph.as_ref().map(|frozen| &frozen.graph),
            )?;
        }

        let core = ProjectCheckpointCore {
            schema: PROJECT_CHECKPOINT_SCHEMA.to_owned(),
            name: definition.name,
            parent_checkpoint_hash,
            document_hash: document.document_hash.clone(),
            canonical_external_path,
            model_hash,
            world_hash,
            narrative_graph_hash: graph.as_ref().map(|frozen| frozen.graph_hash.clone()),
            narrative_graph_snapshot_hash: graph
                .as_ref()
                .map(|frozen| frozen.snapshot_hash.clone()),
            reason: definition.reason,
            provenance: definition.provenance,
        };
        let checkpoint_hash = hash_serializable(&core)?;
        if let Some(existing) = self.project_checkpoints.get(&checkpoint_hash) {
            return encode(self.project_checkpoint_summary(existing)?);
        }
        let checkpoint = StoredProjectCheckpoint {
            checkpoint_hash: checkpoint_hash.clone(),
            checkpoint_sequence: self.next_project_checkpoint_sequence,
            core,
        };
        let next_sequence = self
            .next_project_checkpoint_sequence
            .checked_add(1)
            .ok_or_else(|| {
                machine_error("invalid_request", "project checkpoint sequence overflow")
            })?;

        // Material another checkpoint already froze is shared, not stored again.
        let document_is_new = !self.project_documents.contains_key(&document.document_hash);
        let model_is_new = model
            .as_ref()
            .is_some_and(|model| !self.project_model_snapshots.contains_key(&model.model_hash));
        let world_is_new = world
            .as_ref()
            .is_some_and(|world| !self.project_world_snapshots.contains_key(&world.world_hash));
        let graph_is_new = graph.as_ref().is_some_and(|frozen| {
            !self
                .project_graph_snapshots
                .contains_key(&frozen.snapshot_hash)
        });
        let overflow = || {
            machine_error(
                "invalid_request",
                "project checkpoint storage estimate overflow",
            )
        };
        let mut added = serialized_size(&checkpoint)?;
        let mut add = |size: EngineResult<usize>| -> Result<(), MachineError> {
            added = added.checked_add(size?).ok_or_else(overflow)?;
            Ok(())
        };
        if document_is_new {
            add(serialized_size(&document))?;
        }
        if model_is_new {
            add(serialized_size(
                &model.as_ref().expect("new model is present").definition,
            ))?;
        }
        if world_is_new {
            add(serialized_size(
                world.as_ref().expect("new world is present"),
            ))?;
        }
        if graph_is_new {
            add(serialized_size(
                &graph.as_ref().expect("new graph is present").graph,
            ))?;
        }
        let projected_storage = self
            .project_storage_bytes()?
            .checked_add(added)
            .ok_or_else(overflow)?;
        if projected_storage > MAX_PROJECT_STORAGE_BYTES {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "project checkpoint storage would exceed {MAX_PROJECT_STORAGE_BYTES} bytes"
                ),
            ));
        }

        let document_hash = document.document_hash.clone();
        if document_is_new {
            self.project_documents
                .insert(document_hash.clone(), document);
            self.mark_dirty(DirtyRow::ProjectDocument, document_hash);
        }
        if let Some(model) = model {
            let model_hash = model.model_hash.clone();
            self.project_model_snapshots
                .entry(model_hash.clone())
                .or_insert(model);
            if model_is_new {
                self.mark_dirty(DirtyRow::ProjectModelSnapshot, model_hash);
            }
        }
        if let Some(world) = world {
            let world_hash = world.world_hash.clone();
            self.project_world_snapshots
                .entry(world_hash.clone())
                .or_insert(world);
            if world_is_new {
                self.mark_dirty(DirtyRow::ProjectWorldSnapshot, world_hash);
            }
        }
        if let Some(frozen) = graph {
            self.project_graph_snapshots
                .entry(frozen.snapshot_hash.clone())
                .or_insert(frozen.graph);
            if graph_is_new {
                self.mark_dirty(DirtyRow::ProjectGraphSnapshot, frozen.snapshot_hash);
            }
        }
        self.project_checkpoint_names
            .insert(checkpoint.core.name.clone(), checkpoint_hash.clone());
        self.project_checkpoints
            .insert(checkpoint_hash.clone(), checkpoint.clone());
        self.next_project_checkpoint_sequence = next_sequence;
        self.mark_dirty(DirtyRow::ProjectCheckpoint, checkpoint_hash);
        encode(self.project_checkpoint_summary(&checkpoint)?)
    }

    /// The checkpoint's own fields: its schema, a free and well-formed name, room for one more checkpoint, and a
    /// bounded reason and provenance.
    fn check_checkpoint_fields(
        &self,
        definition: &ProjectCheckpointDefinition,
    ) -> Result<(), MachineError> {
        if definition.schema != PROJECT_CHECKPOINT_SCHEMA {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "unsupported project checkpoint schema {}; expected {PROJECT_CHECKPOINT_SCHEMA}",
                    definition.schema
                ),
            ));
        }
        if definition.name.trim().is_empty()
            || definition.name.len() > MAX_MODEL_IDENTIFIER_BYTES
            || is_project_checkpoint_hash_shaped_name(&definition.name)
        {
            return Err(machine_error(
                "invalid_request",
                "project checkpoint name must be nonempty, bounded, and not a 64-character hexadecimal hash",
            ));
        }
        if self.project_checkpoint_names.contains_key(&definition.name) {
            return Err(machine_error(
                "conflict",
                format!("project checkpoint {} already exists", definition.name),
            ));
        }
        if self.project_checkpoints.len() >= MAX_PROJECT_CHECKPOINTS {
            return Err(machine_error(
                "invalid_request",
                format!("project checkpoint count would exceed {MAX_PROJECT_CHECKPOINTS}"),
            ));
        }
        if definition.reason.len() > MAX_NARRATIVE_STRING_BYTES
            || definition.provenance.len() > MAX_OBSERVATION_PROVENANCE
            || definition
                .provenance
                .iter()
                .any(|value| value.trim().is_empty() || value.len() > MAX_NARRATIVE_STRING_BYTES)
        {
            return Err(machine_error(
                "invalid_request",
                "project checkpoint reason or provenance is invalid or unbounded",
            ));
        }
        Ok(())
    }

    /// The checkpoint's document as it is stored: checked, bounded, and addressed by the hash of its media type and
    /// content. A document already held under that hash must be the same document.
    fn checkpoint_document(
        &self,
        document: ProjectDocumentDefinition,
    ) -> Result<StoredProjectDocument, MachineError> {
        if document.schema != PROJECT_DOCUMENT_SCHEMA {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "unsupported project document schema {}; expected {PROJECT_DOCUMENT_SCHEMA}",
                    document.schema
                ),
            ));
        }
        if document.media_type.trim().is_empty()
            || document.media_type.len() > MAX_NARRATIVE_STRING_BYTES
            || document
                .canonical_external_path
                .as_ref()
                .is_some_and(|path| {
                    path.trim().is_empty() || path.len() > MAX_NARRATIVE_STRING_BYTES
                })
        {
            return Err(machine_error(
                "invalid_request",
                "project document media type or canonical path is invalid or unbounded",
            ));
        }
        let content = document.content.into_bytes();
        if content.len() > MAX_PROJECT_DOCUMENT_BYTES {
            return Err(machine_error(
                "invalid_request",
                format!("project document exceeds {MAX_PROJECT_DOCUMENT_BYTES} bytes"),
            ));
        }
        let document_hash = hash_serializable(&serde_json::json!({
            "media_type": document.media_type,
            "content": content,
        }))?;
        let stored = StoredProjectDocument {
            document_hash,
            media_type: document.media_type,
            content,
        };
        if let Some(existing) = self.project_documents.get(&stored.document_hash) {
            if existing != &stored {
                return Err(machine_error(
                    "conflict",
                    "project document hash is bound to different content",
                ));
            }
        }
        Ok(stored)
    }

    /// The world a checkpoint freezes, named by hash or imported, with the hash it is recorded under. An imported
    /// world must be the one named; a world with revision history cannot be frozen portably.
    fn checkpoint_world(
        &self,
        world_hash: Option<String>,
        imported_world: Option<WorldHead>,
    ) -> Result<(Option<String>, Option<WorldHead>), MachineError> {
        let world_hash = world_hash.or_else(|| {
            imported_world
                .as_ref()
                .map(|world| world.world_hash.clone())
        });
        if let (Some(expected), Some(imported)) = (world_hash.as_ref(), imported_world.as_ref()) {
            if expected != &imported.world_hash {
                return Err(machine_error(
                    "conflict",
                    "project checkpoint world hash does not match imported world snapshot",
                ));
            }
        }
        let world = world_hash
            .as_deref()
            .map(|hash| {
                imported_world
                    .as_ref()
                    .filter(|world| world.world_hash == hash)
                    .cloned()
                    .or_else(|| self.find_world_by_hash(hash))
                    .ok_or_else(|| {
                        machine_error("not_found", format!("unknown world snapshot {hash}"))
                    })
            })
            .transpose()?;
        if world
            .as_ref()
            .is_some_and(|world| self.world_has_revision_history(world))
        {
            return Err(machine_error("unsupported_history", "portable checkpoint snapshots across world revisions are not supported; the complete accepted history remains preserved in the session database"));
        }
        Ok((world_hash, world))
    }

    /// The narrative graph a checkpoint freezes: the imported one, else a frozen graph snapshot already held, else an
    /// active graph. Its source must have portable history, and it must carry the hashes the request names.
    fn checkpoint_graph(
        &self,
        imported_graph: Option<StoredNarrativeGraph>,
        requested_graph_hash: Option<String>,
        requested_snapshot_hash: Option<String>,
    ) -> Result<Option<FrozenGraph>, MachineError> {
        let graph = if let Some(graph) = imported_graph {
            graph
        } else if let Some(snapshot_hash) = requested_snapshot_hash.as_deref() {
            self.project_graph_snapshots
                .get(snapshot_hash)
                .cloned()
                .ok_or_else(|| {
                    machine_error(
                        "not_found",
                        format!("unknown narrative graph snapshot {snapshot_hash}"),
                    )
                })?
        } else if let Some(graph_hash) = requested_graph_hash.as_deref() {
            self.materialize_narrative_graph(graph_hash).map_err(|_| {
                machine_error(
                    "not_found",
                    format!("unknown active narrative graph {graph_hash}; a frozen project graph requires narrative_graph_snapshot_hash"),
                )
            })?
        } else {
            return Ok(None);
        };
        self.ensure_portable_source_history(&graph.snapshot)?;
        if requested_graph_hash
            .as_ref()
            .is_some_and(|expected| expected != &graph.graph_hash)
        {
            return Err(machine_error(
                "conflict",
                "project checkpoint graph hash does not match its frozen graph snapshot",
            ));
        }
        let snapshot_hash = project_graph_snapshot_hash(&graph)?;
        if requested_snapshot_hash
            .as_ref()
            .is_some_and(|expected| expected != &snapshot_hash)
        {
            return Err(machine_error(
                "conflict",
                "project checkpoint graph snapshot identity does not match its frozen graph and source snapshot",
            ));
        }
        Ok(Some(FrozenGraph {
            graph_hash: graph.graph_hash.clone(),
            snapshot_hash,
            graph,
        }))
    }

    /// The model a checkpoint freezes. Every model hash it names or implies (the requested one, an imported model's,
    /// the world's and the graph's) must be the same; the model is then the imported one, a registered one, or a
    /// model snapshot another checkpoint froze.
    fn checkpoint_model(
        &self,
        requested_model_hash: Option<String>,
        imported_model: Option<CompiledModel>,
        world: Option<&WorldHead>,
        graph: Option<&StoredNarrativeGraph>,
    ) -> Result<(Option<String>, Option<CompiledModel>), MachineError> {
        let required_model_hashes: Vec<String> = [
            requested_model_hash,
            imported_model
                .as_ref()
                .map(|model| model.model_hash.clone()),
            world.map(|world| world.model_hash.clone()),
            graph.map(|graph| graph.snapshot.model_hash.clone()),
        ]
        .into_iter()
        .flatten()
        .collect();
        if let Some(first) = required_model_hashes.first() {
            if required_model_hashes.iter().any(|hash| hash != first) {
                return Err(machine_error(
                    "conflict",
                    "project checkpoint model, world, and graph snapshots disagree",
                ));
            }
        }
        let Some(model_hash) = required_model_hashes.into_iter().next() else {
            return Ok((None, None));
        };
        let model = match imported_model.filter(|model| model.model_hash == model_hash) {
            Some(model) => model,
            None => match self.models.get(&model_hash)? {
                Some(model) => CompiledModel::clone(&model),
                None => self
                    .project_model_snapshots
                    .get(&model_hash)
                    .cloned()
                    .ok_or_else(|| {
                        machine_error("not_found", format!("unknown model {model_hash}"))
                    })?,
            },
        };
        Ok((Some(model_hash), Some(model)))
    }

    pub(super) fn list_project_checkpoints(&self) -> Result<serde_json::Value, MachineError> {
        let mut checkpoints: Vec<&StoredProjectCheckpoint> =
            self.project_checkpoints.values().collect();
        checkpoints.sort_by_key(|checkpoint| checkpoint.checkpoint_sequence);
        let entries = checkpoints
            .iter()
            .map(|checkpoint| self.project_checkpoint_summary(checkpoint))
            .collect::<EngineResult<Vec<_>>>()?;
        encode(serde_json::json!({
            "schema": PROJECT_CHECKPOINT_LIST_SCHEMA,
            "checkpoint_count": entries.len(),
            "checkpoints": entries,
            "ordering": "immutable_checkpoint_sequence",
            "identity": "content_hash_with_unique_human_readable_name",
            "active_session_unchanged": true,
        }))
    }

    pub(super) fn get_project_checkpoint(
        &self,
        identifier: &str,
    ) -> Result<serde_json::Value, MachineError> {
        let checkpoint = self.resolve_project_checkpoint(identifier)?;
        encode(self.project_checkpoint_summary(checkpoint)?)
    }

    pub(super) fn export_project_checkpoint(
        &self,
        identifier: &str,
    ) -> Result<serde_json::Value, MachineError> {
        let checkpoint = self.resolve_project_checkpoint(identifier)?;
        let document = self
            .project_documents
            .get(&checkpoint.core.document_hash)
            .ok_or_else(|| machine_error("internal_error", "project document is unavailable"))?;
        let content = String::from_utf8(document.content.clone()).map_or_else(
            |_| ProjectDocumentContent::Bytes {
                bytes: document.content.clone(),
            },
            |text| ProjectDocumentContent::Utf8 { text },
        );
        let model_snapshot_json = checkpoint
            .core
            .model_hash
            .as_ref()
            .map(|hash| {
                self.project_model_snapshots
                    .get(hash)
                    .ok_or_else(|| error("project model snapshot is unavailable"))
                    .and_then(|model| {
                        serde_json::to_string(&model.definition).map_err(|cause| {
                            error(format!(
                                "failed to encode portable project model snapshot: {cause}"
                            ))
                        })
                    })
            })
            .transpose()?;
        let world_snapshot_json = checkpoint
            .core
            .world_hash
            .as_ref()
            .map(|hash| {
                self.project_world_snapshots
                    .get(hash)
                    .ok_or_else(|| error("project world snapshot is unavailable"))
                    .and_then(|world| {
                        serde_json::to_string(world).map_err(|cause| {
                            error(format!(
                                "failed to encode portable project world snapshot: {cause}"
                            ))
                        })
                    })
            })
            .transpose()?;
        let narrative_graph_snapshot_json = checkpoint
            .core
            .narrative_graph_snapshot_hash
            .as_ref()
            .map(|hash| {
                self.project_graph_snapshots
                    .get(hash)
                    .ok_or_else(|| error("project graph snapshot is unavailable"))
                    .and_then(|graph| {
                        serde_json::to_string(graph).map_err(|cause| {
                            error(format!(
                                "failed to encode portable project graph snapshot: {cause}"
                            ))
                        })
                    })
            })
            .transpose()?;
        let definition = ProjectCheckpointDefinition {
            schema: PROJECT_CHECKPOINT_SCHEMA.to_owned(),
            name: checkpoint.core.name.clone(),
            parent_checkpoint: checkpoint.core.parent_checkpoint_hash.clone(),
            document: ProjectDocumentDefinition {
                schema: PROJECT_DOCUMENT_SCHEMA.to_owned(),
                media_type: document.media_type.clone(),
                content,
                canonical_external_path: checkpoint.core.canonical_external_path.clone(),
            },
            model_hash: checkpoint.core.model_hash.clone(),
            world_hash: checkpoint.core.world_hash.clone(),
            narrative_graph_hash: checkpoint.core.narrative_graph_hash.clone(),
            narrative_graph_snapshot_hash: checkpoint.core.narrative_graph_snapshot_hash.clone(),
            model_snapshot: None,
            model_snapshot_json,
            world_snapshot: None,
            world_snapshot_json,
            narrative_graph_snapshot: None,
            narrative_graph_snapshot_json,
            reason: checkpoint.core.reason.clone(),
            provenance: checkpoint.core.provenance.clone(),
        };
        let export_bytes = serialized_size(&definition)?;
        if export_bytes > MAX_PROJECT_EXPORT_BYTES {
            return Err(machine_error(
                "invalid_request",
                format!("project checkpoint export exceeds {MAX_PROJECT_EXPORT_BYTES} bytes"),
            ));
        }
        encode(serde_json::json!({
            "schema": PROJECT_CHECKPOINT_EXPORT_SCHEMA,
            "checkpoint_hash": checkpoint.checkpoint_hash,
            "byte_count": export_bytes,
            "project_checkpoint": definition,
            "portable_registration_payload": true,
        }))
    }

    pub(super) fn render_project_checkpoint(
        &self,
        identifier: &str,
        narrative_render: Option<NarrativeRenderSpec>,
    ) -> Result<serde_json::Value, MachineError> {
        let checkpoint = self.resolve_project_checkpoint(identifier)?;
        if let Some(spec) = narrative_render {
            let graph_snapshot_hash = checkpoint
                .core
                .narrative_graph_snapshot_hash
                .as_ref()
                .ok_or_else(|| {
                    machine_error(
                        "conflict",
                        "project checkpoint has no frozen narrative graph",
                    )
                })?;
            let graph = self
                .project_graph_snapshots
                .get(graph_snapshot_hash)
                .cloned()
                .ok_or_else(|| {
                    machine_error(
                        "internal_error",
                        "project checkpoint graph snapshot is unavailable",
                    )
                })?;
            return self.render_stored_narrative_graph(graph, spec);
        }
        let document = self
            .project_documents
            .get(&checkpoint.core.document_hash)
            .ok_or_else(|| {
                machine_error(
                    "internal_error",
                    "project checkpoint document is unavailable",
                )
            })?;
        let text = String::from_utf8(document.content.clone()).ok();
        let content = text.as_ref().map_or_else(
            || serde_json::json!({ "bytes": document.content }),
            |text| serde_json::json!({ "text": text }),
        );
        let projection_hash = hash_serializable(&serde_json::json!({
            "checkpoint_hash": checkpoint.checkpoint_hash,
            "document_hash": document.document_hash,
            "content": content,
        }))?;
        encode(serde_json::json!({
            "schema": PROJECT_CHECKPOINT_RENDER_SCHEMA,
            "checkpoint": self.project_checkpoint_summary(checkpoint)?,
            "document_hash": document.document_hash,
            "media_type": document.media_type,
            "canonical_external_path": checkpoint.core.canonical_external_path,
            "canonical_authority": if checkpoint.core.canonical_external_path.is_some() {
                "declared_external_path; embedded_content_is_checkpoint_authority"
            } else {
                "embedded_content"
            },
            "content": content,
            "projection_hash": projection_hash,
        }))
    }

    pub(super) fn query_project_checkpoint_graph(
        &self,
        identifier: &str,
        query: NarrativeGraphQuery,
    ) -> Result<serde_json::Value, MachineError> {
        let checkpoint = self.resolve_project_checkpoint(identifier)?;
        let graph_snapshot_hash = checkpoint
            .core
            .narrative_graph_snapshot_hash
            .as_ref()
            .ok_or_else(|| {
                machine_error(
                    "conflict",
                    "project checkpoint has no frozen narrative graph",
                )
            })?;
        let graph = self
            .project_graph_snapshots
            .get(graph_snapshot_hash)
            .cloned()
            .ok_or_else(|| {
                machine_error(
                    "internal_error",
                    "project checkpoint graph snapshot is unavailable",
                )
            })?;
        self.query_stored_narrative_graph(graph, query)
    }
}

/// A checkpoint's frozen narrative graph, with the definition hash and the snapshot identity it is recorded under.
struct FrozenGraph {
    graph: StoredNarrativeGraph,
    graph_hash: String,
    snapshot_hash: String,
}

/// A snapshot a checkpoint carries, as a value or as lossless JSON text, never both. The JSON form keeps numbers a
/// JavaScript client would otherwise normalize.
fn imported_snapshot<T: DeserializeOwned>(
    value: Option<T>,
    json: Option<String>,
    kind: &str,
) -> Result<Option<T>, MachineError> {
    match (value, json) {
        (Some(_), Some(_)) => Err(machine_error(
            "invalid_request",
            format!("project checkpoint must provide at most one {kind} snapshot representation"),
        )),
        (Some(value), None) => Ok(Some(value)),
        (None, Some(encoded)) => {
            if encoded.len() > MAX_PROJECT_EXPORT_BYTES {
                return Err(machine_error(
                    "invalid_request",
                    format!("project checkpoint {kind} snapshot JSON is unbounded"),
                ));
            }
            serde_json::from_str(&encoded).map(Some).map_err(|cause| {
                machine_error(
                    "invalid_request",
                    format!("project checkpoint {kind} snapshot JSON is invalid: {cause}"),
                )
            })
        }
        (None, None) => Ok(None),
    }
}

/// What a checkpoint freezes must agree with its model: the world validates against it, and the graph's definition
/// and source snapshot recompute to their recorded hashes, its snapshot is of the same model revision and holds a
/// valid value for every process, and its source binding holds.
fn validate_frozen_against_model(
    model: &CompiledModel,
    world: Option<&WorldHead>,
    graph: Option<&StoredNarrativeGraph>,
) -> Result<(), MachineError> {
    if let Some(world) = world {
        if world.model_hash != model.model_hash {
            return Err(machine_error(
                "conflict",
                "project checkpoint model and world snapshots disagree",
            ));
        }
        validate_world(model, world)?;
    }
    let Some(graph) = graph else {
        return Ok(());
    };
    if graph.snapshot.model_hash != model.model_hash {
        return Err(machine_error(
            "conflict",
            "project checkpoint model and graph snapshots disagree",
        ));
    }
    let compiled_graph_hash = compile_narrative_graph(graph.definition.clone())?.graph_hash;
    if compiled_graph_hash != graph.graph_hash {
        return Err(machine_error(
            "conflict",
            "project checkpoint graph definition hash is invalid",
        ));
    }
    let computed_snapshot_hash = hash_serializable(&graph.snapshot)?;
    if computed_snapshot_hash != graph.snapshot_hash {
        return Err(machine_error(
            "conflict",
            format!(
                "project checkpoint graph source snapshot hash is invalid: expected {}, computed {computed_snapshot_hash}",
                graph.snapshot_hash
            ),
        ));
    }
    if graph.snapshot.model_revision != model.revision.number {
        return Err(machine_error(
            "conflict",
            "project checkpoint graph and model revisions disagree",
        ));
    }
    if graph.snapshot.state.len() != model.processes.len() {
        return Err(machine_error(
            "conflict",
            "project checkpoint graph state does not cover the model processes",
        ));
    }
    for (id, process) in &model.processes {
        let value = graph.snapshot.state.get(id).ok_or_else(|| {
            machine_error(
                "conflict",
                format!("project graph snapshot lacks process {id}"),
            )
        })?;
        validate_process_value(&process.value_type, value, id)?;
    }
    validate_project_graph_source_binding(model, world, graph)?;
    Ok(())
}
