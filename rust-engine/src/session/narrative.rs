//! Storing narrative graphs. A revision is compiled, linked to its predecessor, bound to an exact snapshot of the
//! model, world or candidate it was written against, and kept as an append-only delta from that predecessor.
//!
//! A stored revision never changes. A revision is refused with `conflict` when its hash is already bound to different
//! content, when another revision zero already uses its id, or when the world it was written against has moved; and
//! every anchor it names must resolve against its frozen snapshot (model/narrative.rs).

use std::collections::{BTreeMap, BTreeSet};

use crate::model::candidate::{
    same_candidate_canon, validate_candidate_with_frozen_parent, CandidateStatus, ModelCandidate,
    OccurrenceMark,
};
use crate::model::compile::{validate_process_value, CompiledModel};
use crate::model::narrative::{
    apply_narrative_change, build_narrative_graph_delta, compile_narrative_graph,
    narrative_change_insertion_order, narrative_edge_is_visible, narrative_graph_summary,
    node_is_visible, seal_narrative_revision_record, validate_narrative_access_scopes,
    validate_narrative_anchor_references, validate_narrative_batch,
    validate_narrative_revision_record_hash, CompiledNarrativeGraph, MaterializedNarrative,
    NarrativeGraphDefinition, NarrativeGraphRevision, NarrativeGraphSource,
    NarrativeInsertionOrder, NarrativeInsertionScope, NarrativeRevisionPayload,
    NarrativeSourceSnapshot, StoredNarrativeGraph, StoredNarrativeRevision,
    NARRATIVE_REVISION_STORE_SCHEMA,
};
use crate::session::operation::NarrativeOperation;
use crate::session::persistence::decode_sqlite_json;
use crate::session::store_rows::{self, NarrativeHeader, SealKind};
use crate::session::NarrativeEntry;
use crate::session::{
    encode, machine_error, required, DirtyRow, MachineCommand, MachineError, MachineSession,
};
use crate::{error, hash_serializable, EngineResult};

impl MachineSession {
    /// The narrative graph commands: register_narrative_graph, revise_narrative_graph,
    /// revise_narrative_graph_by_change, apply_narrative_batch, list_narrative_revisions, query_narrative_graph,
    /// render_narrative_graph and export_narrative_training.
    pub(super) fn execute_narrative_command(
        &mut self,
        operation: NarrativeOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            NarrativeOperation::RegisterNarrativeGraph
            | NarrativeOperation::ReviseNarrativeGraph => {
                let definition = required(
                    command.narrative_graph,
                    "narrative graph operation requires narrative_graph",
                )?;
                self.store_complete_narrative_graph(
                    operation,
                    definition,
                    command.preserve_narrative_source_snapshot,
                    None,
                )
            }
            NarrativeOperation::ReviseNarrativeGraphByChange => {
                self.revise_narrative_graph_by_change(command)
            }
            NarrativeOperation::ApplyNarrativeBatch => self.apply_narrative_batch(command),
            NarrativeOperation::ListNarrativeRevisions => {
                self.list_narrative_revisions(command.narrative_history.unwrap_or_default())
            }
            NarrativeOperation::QueryNarrativeGraph => self.query_narrative_graph(command),
            NarrativeOperation::RenderNarrativeGraph => self.render_narrative_graph(command),
            NarrativeOperation::ExportNarrativeTraining => self.export_narrative_training(command),
        }
    }

    /// Revises a narrative graph by the change from its predecessor, which the caller must see whole.
    fn revise_narrative_graph_by_change(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let mut change = required(
            command.narrative_change,
            "revise_narrative_graph_by_change requires narrative_change",
        )?;
        validate_narrative_access_scopes(&mut change.access_scopes)?;
        let previous = self
            .materialize_narrative_graph(&change.previous_graph_hash)
            .map_err(|_| {
                machine_error(
                    "not_found",
                    format!(
                        "unknown previous narrative graph {}",
                        change.previous_graph_hash
                    ),
                )
            })?;
        self.ensure_narrative_fully_visible(&previous, &change.access_scopes)?;
        let definition = apply_narrative_change(&previous.definition, &change)?;
        let insertion_order = narrative_change_insertion_order(&previous.definition, &change);
        self.store_complete_narrative_graph(
            NarrativeOperation::ReviseNarrativeGraph,
            definition,
            command.preserve_narrative_source_snapshot,
            Some(insertion_order),
        )
    }

    /// Adds roots, nodes and edges to a narrative graph, answering an identical earlier batch as it was stored.
    fn apply_narrative_batch(
        &mut self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let mut batch = required(
            command.narrative_batch,
            "apply_narrative_batch requires narrative_batch",
        )?;
        let insertion_order = NarrativeInsertionOrder {
            scope: NarrativeInsertionScope::AdditiveBatch,
            root_ids: batch.add_roots.clone(),
            node_ids: batch.add_nodes.iter().map(|node| node.id.clone()).collect(),
            edge_ids: batch.add_edges.iter().map(|edge| edge.id.clone()).collect(),
        };
        let previous = self
            .materialize_narrative_graph(&batch.previous_graph_hash)
            .map_err(|_| {
                machine_error(
                    "not_found",
                    format!(
                        "unknown previous narrative graph {}",
                        batch.previous_graph_hash
                    ),
                )
            })?;
        validate_narrative_batch(&mut batch, &previous.definition)?;
        let mut definition = previous.definition.clone();
        let revision_number = previous
            .definition
            .revision
            .number
            .checked_add(1)
            .ok_or_else(|| {
                machine_error("invalid_request", "narrative revision number overflow")
            })?;
        definition.revision = NarrativeGraphRevision {
            number: revision_number,
            previous_graph_hash: Some(previous.graph_hash.clone()),
            reason: batch.reason.clone(),
            provenance: batch.provenance.clone(),
        };
        definition.roots.extend(batch.add_roots.iter().cloned());
        definition.nodes.extend(batch.add_nodes.iter().cloned());
        definition.edges.extend(batch.add_edges.iter().cloned());
        let compiled = compile_narrative_graph(definition)?;
        if self.narrative_revisions.contains_key(&compiled.graph_hash) {
            let existing = self.materialize_narrative_graph(&compiled.graph_hash)?;
            return encode(serde_json::json!({
                "summary": narrative_graph_summary(&compiled, &existing.snapshot),
                "snapshot_hash": existing.snapshot_hash,
                "stored": true,
                "reused_existing": true,
                "batch": {
                    "added_root_count": batch.add_roots.len(),
                    "added_node_count": batch.add_nodes.len(),
                    "added_edge_count": batch.add_edges.len(),
                }
            }));
        }
        self.validate_narrative_revision_link(&compiled)?;
        self.validate_narrative_snapshot_binding(&compiled, &previous.snapshot)?;
        self.validate_narrative_anchors(&compiled, &previous.snapshot)?;
        let snapshot_hash = hash_serializable(&previous.snapshot)?;
        if snapshot_hash != previous.snapshot_hash {
            return Err(machine_error(
                "internal_error",
                "previous narrative source snapshot hash changed",
            ));
        }
        let revision = self.narrative_delta_revision(
            &previous.definition,
            &compiled,
            snapshot_hash.clone(),
            insertion_order,
        )?;
        let result = serde_json::json!({
            "summary": narrative_graph_summary(&compiled, &previous.snapshot),
            "snapshot_hash": snapshot_hash,
            "operation_sequence": revision.operation_sequence,
            "stored": true,
            "reused_existing": false,
            "batch": {
                "added_root_count": batch.add_roots.len(),
                "added_node_count": batch.add_nodes.len(),
                "added_edge_count": batch.add_edges.len(),
            }
        });
        self.insert_narrative_revision(revision, previous.snapshot, &compiled.definition)?;
        encode(result)
    }

    fn capture_candidate_anchor(
        &self,
        candidate_hash: &str,
    ) -> Result<serde_json::Value, MachineError> {
        let stored = self.candidates.get(candidate_hash).ok_or_else(|| {
            machine_error("not_found", format!("unknown candidate {candidate_hash}"))
        })?;
        serde_json::to_value(&stored.record.candidate).map_err(|cause| {
            machine_error(
                "internal_error",
                format!("failed to freeze candidate anchor {candidate_hash}: {cause}"),
            )
        })
    }

    fn capture_world_candidate_anchors(
        &self,
        world_hash: &str,
    ) -> Result<BTreeMap<String, serde_json::Value>, MachineError> {
        let mut anchors = BTreeMap::new();
        let mut cursor_hash = Some(world_hash.to_owned());
        while let Some(current_world_hash) = cursor_hash.take() {
            let Some((candidate_hash, stored)) = self.candidates.iter().find(|(_, stored)| {
                stored.record.proposed_head.world_hash == current_world_hash
                    && stored.record.status == CandidateStatus::Committed
            }) else {
                break;
            };
            if anchors.contains_key(candidate_hash) {
                break;
            }
            anchors.insert(
                candidate_hash.clone(),
                serde_json::to_value(&stored.record.candidate).map_err(|cause| {
                    machine_error(
                        "internal_error",
                        format!("failed to freeze candidate anchor {candidate_hash}: {cause}"),
                    )
                })?,
            );
            cursor_hash = Some(stored.parent.world_hash.clone());
        }
        Ok(anchors)
    }

    fn capture_narrative_source(
        &self,
        source: &NarrativeGraphSource,
    ) -> Result<NarrativeSourceSnapshot, MachineError> {
        match source {
            NarrativeGraphSource::Model { model_hash } => {
                let model = self.models.get(model_hash)?.ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {model_hash}"))
                })?;
                Ok(NarrativeSourceSnapshot {
                    model_hash: model.model_hash.clone(),
                    model_revision: model.revision.number,
                    source_kind: "model".to_owned(),
                    source_hash: model.model_hash.clone(),
                    world_id: None,
                    world_version: None,
                    time: None,
                    candidate_status: None,
                    state: model
                        .processes
                        .values()
                        .map(|process| (process.id.clone(), process.initial_value.clone()))
                        .collect(),
                    claims: model.initial_claims.clone(),
                    occurrences: Vec::new(),
                    candidate_anchors: BTreeMap::new(),
                })
            }
            NarrativeGraphSource::World {
                world_id,
                world_hash,
            } => {
                let world = self.worlds.get(world_id).ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                if &world.world_hash != world_hash {
                    return Err(machine_error(
                        "conflict",
                        format!(
                            "world {world_id} changed: expected {world_hash}, found {}",
                            world.world_hash
                        ),
                    ));
                }
                let model = self.models.get(&world.model_hash)?.ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {}", world.model_hash))
                })?;
                let occurrences = world
                    .lineage_head
                    .as_ref()
                    .and_then(|hash| self.candidates.get(hash))
                    .map(|candidate| candidate.record.candidate.marks.to_vec())
                    .unwrap_or_default();
                let candidate_anchors = self.capture_world_candidate_anchors(&world.world_hash)?;
                Ok(NarrativeSourceSnapshot {
                    model_hash: model.model_hash.clone(),
                    model_revision: model.revision.number,
                    source_kind: "world".to_owned(),
                    source_hash: world.world_hash.clone(),
                    world_id: Some(world.world_id.clone()),
                    world_version: Some(world.version),
                    time: Some(world.time),
                    candidate_status: Some("committed".to_owned()),
                    state: world.state.clone(),
                    claims: world.claims.clone(),
                    occurrences,
                    candidate_anchors,
                })
            }
            NarrativeGraphSource::Candidate { candidate_hash } => {
                let stored = self.candidates.get(candidate_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {candidate_hash}"))
                })?;
                let candidate = &stored.record.candidate;
                let model = self
                    .models
                    .get(&candidate.model_hash)?
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                let candidate_status = serde_json::to_value(stored.record.status)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "unknown".to_owned());
                let mut candidate_anchors =
                    self.capture_world_candidate_anchors(&stored.parent.world_hash)?;
                candidate_anchors.insert(
                    candidate_hash.clone(),
                    self.capture_candidate_anchor(candidate_hash)?,
                );
                Ok(NarrativeSourceSnapshot {
                    model_hash: model.model_hash.clone(),
                    model_revision: model.revision.number,
                    source_kind: "candidate".to_owned(),
                    source_hash: candidate.candidate_hash.clone(),
                    world_id: Some(candidate.world_id.clone()),
                    world_version: Some(stored.record.proposed_head.version),
                    time: Some(candidate.end_time),
                    candidate_status: Some(candidate_status),
                    state: candidate.successor_state.clone(),
                    claims: candidate.successor_claims.clone(),
                    occurrences: candidate.marks.clone(),
                    candidate_anchors,
                })
            }
        }
    }

    pub(super) fn validate_narrative_anchors(
        &self,
        graph: &CompiledNarrativeGraph,
        snapshot: &NarrativeSourceSnapshot,
    ) -> EngineResult<()> {
        let model = self
            .models
            .get(&snapshot.model_hash)?
            .ok_or_else(|| error("narrative source model is unavailable"))?;
        if model.revision.number != snapshot.model_revision {
            return Err(error(
                "narrative source model revision does not match snapshot",
            ));
        }
        let mut bound_candidate_ids = BTreeSet::new();
        if snapshot.source_kind == "candidate" {
            bound_candidate_ids.insert(snapshot.source_hash.clone());
            let source = self
                .candidates
                .get(&snapshot.source_hash)
                .ok_or_else(|| error("narrative source candidate is unavailable"))?;
            let mut cursor_hash = Some(source.parent.world_hash.clone());
            while let Some(world_hash) = cursor_hash.take() {
                let Some((candidate_hash, stored)) = self.candidates.iter().find(|(_, stored)| {
                    stored.record.proposed_head.world_hash == world_hash
                        && stored.record.status == CandidateStatus::Committed
                }) else {
                    break;
                };
                if !bound_candidate_ids.insert(candidate_hash.clone()) {
                    break;
                }
                cursor_hash = Some(stored.parent.world_hash.clone());
            }
        } else if snapshot.source_kind == "world" {
            let mut cursor_hash = Some(snapshot.source_hash.clone());
            while let Some(world_hash) = cursor_hash.take() {
                let Some((candidate_hash, stored)) = self.candidates.iter().find(|(_, stored)| {
                    stored.record.proposed_head.world_hash == world_hash
                        && stored.record.status == CandidateStatus::Committed
                }) else {
                    break;
                };
                if !bound_candidate_ids.insert(candidate_hash.clone()) {
                    break;
                }
                cursor_hash = Some(stored.parent.world_hash.clone());
            }
        }
        let frozen_candidate_ids: BTreeSet<String> =
            snapshot.candidate_anchors.keys().cloned().collect();
        if frozen_candidate_ids != bound_candidate_ids {
            return Err(error(
                "narrative snapshot candidate anchors do not match its bound source lineage",
            ));
        }
        for (candidate_hash, value) in &snapshot.candidate_anchors {
            let frozen: ModelCandidate =
                serde_json::from_value(value.clone()).map_err(|cause| {
                    error(format!(
                        "narrative snapshot candidate anchor {candidate_hash} is invalid: {cause}"
                    ))
                })?;
            let stored = self.candidates.get(candidate_hash).ok_or_else(|| {
                error(format!(
                    "narrative snapshot candidate anchor {candidate_hash} is unavailable"
                ))
            })?;
            if frozen.candidate_hash != *candidate_hash
                || !same_candidate_canon(&frozen, &stored.record.candidate)
            {
                return Err(error(format!(
                    "narrative snapshot candidate anchor {candidate_hash} changed canonical identity"
                )));
            }
            validate_candidate_with_frozen_parent(&model, &stored.parent, &frozen)?;
        }
        validate_narrative_anchor_references(&model, graph, snapshot, &bound_candidate_ids)
    }

    fn narrative_root_revision(
        &self,
        graph: &CompiledNarrativeGraph,
        snapshot_hash: String,
        insertion_order: NarrativeInsertionOrder,
    ) -> EngineResult<StoredNarrativeRevision> {
        seal_narrative_revision_record(StoredNarrativeRevision {
            schema: NARRATIVE_REVISION_STORE_SCHEMA.to_owned(),
            operation_sequence: self.next_narrative_operation_sequence,
            record_hash: String::new(),
            graph_hash: graph.graph_hash.clone(),
            snapshot_hash,
            graph_schema: graph.definition.schema.clone(),
            graph_id: graph.definition.id.clone(),
            revision: graph.definition.revision.clone(),
            source: graph.definition.source.clone(),
            insertion_order,
            payload: NarrativeRevisionPayload::Root {
                roots: graph.definition.roots.clone(),
                nodes: graph.definition.nodes.clone(),
                edges: graph.definition.edges.clone(),
            },
        })
    }

    pub(super) fn narrative_delta_revision(
        &self,
        previous: &NarrativeGraphDefinition,
        graph: &CompiledNarrativeGraph,
        snapshot_hash: String,
        insertion_order: NarrativeInsertionOrder,
    ) -> EngineResult<StoredNarrativeRevision> {
        seal_narrative_revision_record(StoredNarrativeRevision {
            schema: NARRATIVE_REVISION_STORE_SCHEMA.to_owned(),
            operation_sequence: self.next_narrative_operation_sequence,
            record_hash: String::new(),
            graph_hash: graph.graph_hash.clone(),
            snapshot_hash,
            graph_schema: graph.definition.schema.clone(),
            graph_id: graph.definition.id.clone(),
            revision: graph.definition.revision.clone(),
            source: graph.definition.source.clone(),
            insertion_order,
            payload: NarrativeRevisionPayload::Delta {
                delta: build_narrative_graph_delta(previous, &graph.definition),
            },
        })
    }

    pub(super) fn insert_narrative_revision(
        &mut self,
        revision: StoredNarrativeRevision,
        snapshot: NarrativeSourceSnapshot,
        definition: &NarrativeGraphDefinition,
    ) -> EngineResult<()> {
        validate_narrative_revision_record_hash(&revision)?;
        let parent = match revision.revision.previous_graph_hash.as_deref() {
            Some(previous_hash) => Some(self.materialized_narrative(previous_hash).map_err(
                |cause| {
                    error(format!(
                        "narrative revision parent is not available: {}",
                        cause.0
                    ))
                },
            )?),
            None => None,
        };
        let materialized = MaterializedNarrative::apply(parent.as_ref(), &revision)?;
        if !materialized.matches(definition) {
            return Err(error(
                "narrative revision record does not reconstruct its compiled graph",
            ));
        }
        if revision.operation_sequence != self.next_narrative_operation_sequence {
            return Err(error(
                "narrative operation sequence is not the next append position",
            ));
        }
        if hash_serializable(&snapshot)? != revision.snapshot_hash {
            return Err(error("narrative source snapshot hash is invalid"));
        }
        if self
            .narrative_source_snapshots
            .contains_key(&revision.snapshot_hash)
        {
            let existing = self.narrative_snapshot(&revision.snapshot_hash)?;
            if existing.as_ref() != &snapshot {
                return Err(error(
                    "narrative snapshot hash is already bound to different content",
                ));
            }
        }
        let (snapshot_bytes, revision_bytes) =
            self.ensure_narrative_insert(&revision, &snapshot)?;
        let next = self
            .next_narrative_operation_sequence
            .checked_add(1)
            .ok_or_else(|| error("narrative operation sequence overflow"))?;
        let snapshot_is_new = !self
            .narrative_source_snapshots
            .contains_key(&revision.snapshot_hash);
        let snapshot_hash = revision.snapshot_hash.clone();
        let graph_hash = revision.graph_hash.clone();
        if self.narrative_revisions.contains_key(&graph_hash) {
            return Err(error("narrative graph hash insertion collided"));
        }
        if snapshot_is_new {
            self.narrative_source_snapshots
                .index
                .insert(snapshot_hash.clone(), snapshot.model_hash.clone());
            self.narrative_source_snapshots.rows.hold(
                snapshot_hash.clone(),
                std::sync::Arc::new(snapshot),
                snapshot_bytes,
            );
        }
        let previous_hash = revision.revision.previous_graph_hash.clone();
        self.narrative_revisions.insert(
            graph_hash.clone(),
            NarrativeEntry {
                header: NarrativeHeader::from(&revision),
                row_bytes: revision_bytes,
                seal: None,
            },
        );
        self.narrative_records.hold(
            graph_hash.clone(),
            std::sync::Arc::new(revision),
            revision_bytes,
        );
        if let Some(previous_hash) = &previous_hash {
            *self
                .narrative_children
                .entry(previous_hash.clone())
                .or_default() += 1;
            self.narrative_materialized
                .borrow_mut()
                .unpin(previous_hash);
        }
        self.narrative_children.insert(graph_hash.clone(), 0);
        self.narrative_materialized
            .borrow_mut()
            .pin(graph_hash.clone(), materialized);
        self.next_narrative_operation_sequence = next;
        if snapshot_is_new {
            self.mark_dirty(DirtyRow::NarrativeSourceSnapshot, snapshot_hash);
        }
        self.mark_dirty(DirtyRow::NarrativeRevision, graph_hash);
        Ok(())
    }

    /// Registers or revises a narrative graph from its complete definition:
    /// the one path through which a complete revision is compiled, validated
    /// against its predecessor, source and anchors, and stored. A complete
    /// request records its caller's whole order; a revision by change passes
    /// the order of what it adds.
    pub(super) fn store_complete_narrative_graph(
        &mut self,
        operation: NarrativeOperation,
        definition: NarrativeGraphDefinition,
        preserve_snapshot: bool,
        insertion_order: Option<NarrativeInsertionOrder>,
    ) -> Result<serde_json::Value, MachineError> {
        let insertion_order = insertion_order.unwrap_or_else(|| NarrativeInsertionOrder {
            scope: NarrativeInsertionScope::FullDefinition,
            root_ids: definition.roots.clone(),
            node_ids: definition
                .nodes
                .iter()
                .map(|node| node.id.clone())
                .collect(),
            edge_ids: definition
                .edges
                .iter()
                .map(|edge| edge.id.clone())
                .collect(),
        });
        let compiled = compile_narrative_graph(definition)?;
        if operation == NarrativeOperation::RegisterNarrativeGraph
            && compiled.definition.revision.number != 0
        {
            return Err(machine_error(
                "invalid_request",
                "register_narrative_graph requires revision 0; use revise_narrative_graph",
            ));
        }
        if operation == NarrativeOperation::ReviseNarrativeGraph
            && compiled.definition.revision.number == 0
        {
            return Err(machine_error(
                "invalid_request",
                "revise_narrative_graph requires a nonzero revision",
            ));
        }
        let preserved_snapshot = if preserve_snapshot {
            if operation != NarrativeOperation::ReviseNarrativeGraph {
                return Err(machine_error(
                    "invalid_request",
                    "Source preservation requires a narrative revision.",
                ));
            }
            let previous_hash = compiled
                .definition
                .revision
                .previous_graph_hash
                .as_deref()
                .ok_or_else(|| {
                    machine_error(
                        "invalid_request",
                        "Source preservation requires a predecessor graph.",
                    )
                })?;
            let previous = self.materialize_narrative_graph(previous_hash)?;
            if previous.definition.source != compiled.definition.source {
                return Err(machine_error(
                    "conflict",
                    "A source-preserving narrative edit cannot change its source binding.",
                ));
            }
            Some(previous.snapshot)
        } else {
            None
        };
        if self.narrative_revisions.contains_key(&compiled.graph_hash) {
            let existing = self.materialize_narrative_graph(&compiled.graph_hash)?;
            if existing.definition != compiled.definition {
                return Err(machine_error(
                    "conflict",
                    "narrative graph hash is already bound to different content",
                ));
            }
            if preserved_snapshot
                .as_ref()
                .is_some_and(|snapshot| snapshot != &existing.snapshot)
            {
                return Err(machine_error(
                    "conflict",
                    "Existing narrative revision has a different frozen source snapshot.",
                ));
            }
            return encode(serde_json::json!({
                "summary": narrative_graph_summary(&compiled, &existing.snapshot),
                "snapshot_hash": existing.snapshot_hash,
                "stored": true,
                "reused_existing": true,
            }));
        }
        self.validate_narrative_revision_link(&compiled)?;
        let snapshot = match preserved_snapshot {
            Some(snapshot) => snapshot,
            None => self.capture_narrative_source(&compiled.definition.source)?,
        };
        self.validate_narrative_snapshot_binding(&compiled, &snapshot)?;
        self.validate_narrative_anchors(&compiled, &snapshot)?;
        let snapshot_hash = hash_serializable(&snapshot)?;
        let revision = match compiled.definition.revision.previous_graph_hash.as_deref() {
            None => self.narrative_root_revision(
                &compiled,
                snapshot_hash.clone(),
                insertion_order.clone(),
            )?,
            Some(previous_hash) => {
                let previous = self.materialize_narrative_graph(previous_hash)?;
                self.narrative_delta_revision(
                    &previous.definition,
                    &compiled,
                    snapshot_hash.clone(),
                    insertion_order.clone(),
                )?
            }
        };
        let result = serde_json::json!({
            "summary": narrative_graph_summary(&compiled, &snapshot),
            "snapshot_hash": snapshot_hash,
            "operation_sequence": revision.operation_sequence,
            "stored": true,
            "reused_existing": false,
        });
        self.insert_narrative_revision(revision, snapshot, &compiled.definition)?;
        encode(result)
    }

    /// A revision by change is written only by a caller who sees the whole
    /// predecessor, so no hidden record is changed or dropped unseen.
    pub(super) fn ensure_narrative_fully_visible(
        &self,
        stored: &StoredNarrativeGraph,
        access_scopes: &[String],
    ) -> Result<(), MachineError> {
        let rebuilt = self.models.get(&stored.snapshot.model_hash)?;
        let model: &CompiledModel = match rebuilt.as_deref() {
            Some(model) => model,
            None => self
                .project_model_snapshots
                .get(&stored.snapshot.model_hash)
                .ok_or_else(|| {
                    machine_error("not_found", "narrative source model is unavailable")
                })?,
        };
        let visible: BTreeSet<String> = stored
            .definition
            .nodes
            .iter()
            .filter(|node| node_is_visible(node, access_scopes))
            .map(|node| node.id.clone())
            .collect();
        if visible.len() != stored.definition.nodes.len()
            || !stored.definition.edges.iter().all(|edge| {
                narrative_edge_is_visible(edge, &visible, access_scopes, model, &stored.snapshot)
            })
        {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "A revision by change needs every node, edge and root of graph revision {}; these accessScopes hide some of them.",
                    stored.definition.revision.number
                ),
            ));
        }
        Ok(())
    }

    /// A stored revision. Each record was validated, and its hash and snapshot
    /// checked, when it was inserted or restored, so a read neither replays
    /// the history nor revalidates it.
    pub(super) fn materialize_narrative_graph(
        &self,
        graph_hash: &str,
    ) -> EngineResult<StoredNarrativeGraph> {
        let target = self
            .narrative_revisions
            .get(graph_hash)
            .ok_or_else(|| error(format!("unknown narrative graph {graph_hash}")))?;
        let materialized = self.materialized_narrative(graph_hash)?;
        let snapshot = self
            .narrative_snapshot(&target.snapshot_hash)?
            .as_ref()
            .clone();
        Ok(StoredNarrativeGraph {
            graph_hash: target.graph_hash.clone(),
            snapshot_hash: target.snapshot_hash.clone(),
            definition: materialized.definition(&target.header),
            snapshot,
        })
    }

    pub(super) fn validate_narrative_snapshot_binding(
        &self,
        graph: &CompiledNarrativeGraph,
        snapshot: &NarrativeSourceSnapshot,
    ) -> EngineResult<()> {
        let model = self
            .models
            .get(&snapshot.model_hash)?
            .ok_or_else(|| error("narrative snapshot names an unknown model"))?;
        if model.revision.number != snapshot.model_revision
            || snapshot.state.len() != model.processes.len()
        {
            return Err(error("narrative snapshot model or state shape is invalid"));
        }
        for (id, process) in &model.processes {
            let value = snapshot
                .state
                .get(id)
                .ok_or_else(|| error(format!("narrative snapshot lacks process {id}")))?;
            validate_process_value(&process.value_type, value, id)?;
        }
        let source_matches = match &graph.definition.source {
            NarrativeGraphSource::Model { model_hash } => {
                model_hash == &snapshot.model_hash
                    && snapshot.source_kind == "model"
                    && snapshot.source_hash == snapshot.model_hash
                    && snapshot.world_id.is_none()
                    && snapshot.world_version.is_none()
                    && snapshot.time.is_none()
                    && snapshot.state
                        == model
                            .processes
                            .values()
                            .map(|process| (process.id.clone(), process.initial_value.clone()))
                            .collect()
                    && snapshot.claims == model.initial_claims
                    && snapshot.occurrences.is_empty()
            }
            NarrativeGraphSource::World {
                world_id,
                world_hash,
            } => {
                let source_world = self
                    .worlds
                    .get(world_id)
                    .filter(|world| &world.world_hash == world_hash)
                    .cloned()
                    .or_else(|| self.find_world_by_hash(world_hash))
                    .or_else(|| {
                        self.candidates
                            .values()
                            .map(|stored| &stored.record.proposed_head)
                            .find(|world| {
                                &world.world_id == world_id && &world.world_hash == world_hash
                            })
                            .cloned()
                    })
                    .or_else(|| {
                        model
                            .genesis_world(world_id.clone())
                            .ok()
                            .filter(|world| &world.world_hash == world_hash)
                    });
                source_world.is_some_and(|world| {
                    let occurrences: Vec<OccurrenceMark> = world
                        .lineage_head
                        .as_ref()
                        .and_then(|hash| self.candidates.get(hash))
                        .map(|candidate| candidate.record.candidate.marks.to_vec())
                        .unwrap_or_default();
                    snapshot.source_kind == "world"
                        && world.model_hash == snapshot.model_hash
                        && world.model_revision == snapshot.model_revision
                        && &world.world_id == world_id
                        && snapshot.world_id.as_deref() == Some(world_id)
                        && &snapshot.source_hash == world_hash
                        && snapshot.world_version == Some(world.version)
                        && snapshot.time == Some(world.time)
                        && snapshot.state == world.state
                        && snapshot.claims == world.claims
                        && snapshot.occurrences == occurrences
                })
            }
            NarrativeGraphSource::Candidate { candidate_hash } => {
                self.candidates.get(candidate_hash).is_some_and(|stored| {
                    let candidate = &stored.record.candidate;
                    snapshot.source_kind == "candidate"
                        && &snapshot.source_hash == candidate_hash
                        && candidate.model_hash == snapshot.model_hash
                        && snapshot.world_id.as_deref() == Some(candidate.world_id.as_str())
                        && snapshot.world_version == Some(stored.record.proposed_head.version)
                        && snapshot.time == Some(candidate.end_time)
                        && snapshot.state == candidate.successor_state
                        && snapshot.claims == candidate.successor_claims
                        && snapshot.occurrences == candidate.marks
                })
            }
        };
        if !source_matches {
            return Err(error(
                "narrative graph source and captured source snapshot do not match",
            ));
        }
        Ok(())
    }

    pub(super) fn validate_narrative_revision_link(
        &self,
        graph: &CompiledNarrativeGraph,
    ) -> Result<(), MachineError> {
        let revision = &graph.definition.revision;
        let Some(previous_hash) = &revision.previous_graph_hash else {
            if self.narrative_revisions.values().any(|existing| {
                existing.graph_id == graph.definition.id && existing.revision.number == 0
            }) {
                return Err(machine_error(
                    "conflict",
                    "a different revision-zero narrative graph already uses this id",
                ));
            }
            return Ok(());
        };
        let previous = self
            .materialize_narrative_graph(previous_hash)
            .map_err(|_| {
                machine_error(
                    "not_found",
                    format!("unknown previous narrative graph {previous_hash}"),
                )
            })?;
        if previous.definition.id != graph.definition.id
            || revision.number != previous.definition.revision.number + 1
        {
            return Err(machine_error(
                "invalid_request",
                "narrative graph revision must preserve id and increment the previous revision by one",
            ));
        }
        Ok(())
    }
}

impl MachineSession {
    pub(super) fn narrative_record(
        &self,
        graph_hash: &str,
    ) -> EngineResult<std::sync::Arc<StoredNarrativeRevision>> {
        if let Some(record) = self
            .narrative_records
            .held(graph_hash)
            .or_else(|| self.narrative_records.cached(graph_hash))
        {
            return Ok(record);
        }
        let entry = self
            .narrative_revisions
            .get(graph_hash)
            .ok_or_else(|| error(format!("unknown narrative graph {graph_hash}")))?;
        let reader = self
            .reader
            .as_ref()
            .ok_or_else(|| error(format!("narrative revision {graph_hash} is not held")))?;
        let bytes = reader.narrative_row(graph_hash)?.ok_or_else(|| {
            error(format!(
                "narrative revision {graph_hash} is missing from the state file"
            ))
        })?;
        let seal = entry.seal.as_ref().ok_or_else(|| {
            error(format!(
                "narrative revision {graph_hash} is neither held nor sealed"
            ))
        })?;
        store_rows::check_row(SealKind::Narrative, graph_hash, &bytes, seal)?;
        let record: StoredNarrativeRevision =
            decode_sqlite_json(bytes.clone(), "narrative revision")?;
        if NarrativeHeader::from(&record) != entry.header {
            return Err(error(format!(
                "narrative revision {graph_hash} does not match its sealed header"
            )));
        }
        let record = std::sync::Arc::new(record);
        self.narrative_records
            .cache(graph_hash.to_owned(), record.clone(), bytes.len());
        crate::heartbeat::tick();
        Ok(record)
    }

    pub(super) fn narrative_snapshot(
        &self,
        snapshot_hash: &str,
    ) -> EngineResult<std::sync::Arc<NarrativeSourceSnapshot>> {
        self.narrative_source_snapshots
            .get(snapshot_hash, self.reader.as_deref())?
            .ok_or_else(|| error("narrative revision names an unknown source snapshot"))
    }

    pub(super) fn is_narrative_head(&self, graph_hash: &str) -> bool {
        self.narrative_children
            .get(graph_hash)
            .copied()
            .unwrap_or_default()
            == 0
    }

    pub(super) fn keep_materialized(&self, graph_hash: &str, materialized: MaterializedNarrative) {
        let mut cache = self.narrative_materialized.borrow_mut();
        if self.is_narrative_head(graph_hash) {
            cache.pin(graph_hash.to_owned(), materialized);
        } else {
            cache.keep(graph_hash.to_owned(), materialized);
        }
    }

    pub(super) fn materialized_narrative(
        &self,
        graph_hash: &str,
    ) -> EngineResult<MaterializedNarrative> {
        if let Some(found) = self.narrative_materialized.borrow_mut().get(graph_hash) {
            return Ok(found);
        }
        let mut path = Vec::new();
        let mut cursor = Some(graph_hash.to_owned());
        let mut base = None;
        while let Some(hash) = cursor {
            if hash != graph_hash {
                if let Some(found) = self.narrative_materialized.borrow_mut().get(&hash) {
                    base = Some(found);
                    break;
                }
            }
            let entry = self
                .narrative_revisions
                .get(&hash)
                .ok_or_else(|| error(format!("unknown narrative graph {hash}")))?;
            cursor = entry.revision.previous_graph_hash.clone();
            path.push(hash);
            if path.len() > self.narrative_revisions.len() {
                return Err(error("narrative revisions form a cycle"));
            }
        }
        let total = path.len();
        for (step, hash) in path.into_iter().rev().enumerate() {
            let record = self.narrative_record(&hash)?;
            let next = MaterializedNarrative::apply(base.as_ref(), &record)?;
            crate::heartbeat::tick();
            // Keep the revision asked for, and every 32nd one of a long replay, so a later read nearby starts close.
            if step + 1 == total || (total - step - 1) % 32 == 0 {
                self.keep_materialized(&hash, next.clone());
            }
            base = Some(next);
        }
        base.ok_or_else(|| {
            error(format!(
                "narrative graph {graph_hash} could not be materialized"
            ))
        })
    }
}
