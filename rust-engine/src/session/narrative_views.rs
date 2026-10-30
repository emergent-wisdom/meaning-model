//! Reading narrative graphs: queries of a whole graph, its skeleton or a neighbourhood, the revision history, the
//! rendered story, and aligned training records. Every read shows only what the caller's access scopes allow, under the
//! one rule of model/access.rs, and none changes the session.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::hash_serializable;
use crate::limits::MAX_MODEL_IDENTIFIER_BYTES;
use crate::model::access::visible_to;
use crate::model::compile::CompiledModel;
use crate::model::narrative::{
    compiled_stored_narrative, narrative_edge_is_visible, narrative_graph_summary, node_is_visible,
    validate_expected_graph_hash, validate_narrative_access_scopes, CompiledNarrativeGraph,
    NarrativeAnchorKind, NarrativeEdge, NarrativeEndpoint, NarrativeGraphQuery,
    NarrativeHistorySpec, NarrativeInclusionPolicy, NarrativeNode, NarrativeRenderSpec,
    NarrativeTraversalDirection, StoredNarrativeGraph, MAX_NARRATIVE_NEIGHBORHOOD_DEPTH,
    MAX_NARRATIVE_NODES, MAX_NARRATIVE_ROOTS, NARRATIVE_GRAPH_VIEW_SCHEMA,
    NARRATIVE_HISTORY_SCHEMA, NARRATIVE_RENDER_SCHEMA, NARRATIVE_TRAINING_SCHEMA,
};
use crate::session::NarrativeEntry;
use crate::session::{
    encode, machine_error, required, MachineCommand, MachineError, MachineSession,
};

impl MachineSession {
    pub(super) fn query_narrative_graph(
        &self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let graph_hash = required(
            command.narrative_graph_hash,
            "query_narrative_graph requires narrative_graph_hash",
        )?;
        let query = required(
            command.narrative_query,
            "query_narrative_graph requires narrative_query",
        )?;
        let stored = self.materialize_narrative_graph(&graph_hash).map_err(|_| {
            machine_error("not_found", format!("unknown narrative graph {graph_hash}"))
        })?;
        self.query_stored_narrative_graph(stored, query)
    }

    pub(super) fn query_stored_narrative_graph(
        &self,
        stored: StoredNarrativeGraph,
        query: NarrativeGraphQuery,
    ) -> Result<serde_json::Value, MachineError> {
        let graph = compiled_stored_narrative(&stored.graph_hash, stored.definition.clone());
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
        let (mode, include_content, mut access_scopes, expected, center, depth, direction) =
            match query {
                NarrativeGraphQuery::Full {
                    include_content,
                    access_scopes,
                    expected_graph_hash,
                } => (
                    "full",
                    include_content,
                    access_scopes,
                    expected_graph_hash,
                    None,
                    0,
                    NarrativeTraversalDirection::Both,
                ),
                NarrativeGraphQuery::Skeleton {
                    access_scopes,
                    expected_graph_hash,
                } => (
                    "skeleton",
                    false,
                    access_scopes,
                    expected_graph_hash,
                    None,
                    0,
                    NarrativeTraversalDirection::Both,
                ),
                NarrativeGraphQuery::Neighborhood {
                    center_node_id,
                    depth,
                    direction,
                    include_content,
                    access_scopes,
                    expected_graph_hash,
                } => (
                    "neighborhood",
                    include_content,
                    access_scopes,
                    expected_graph_hash,
                    Some(center_node_id),
                    depth,
                    direction,
                ),
            };
        validate_narrative_access_scopes(&mut access_scopes)?;
        validate_expected_graph_hash(&expected, &graph.graph_hash)?;
        if depth > MAX_NARRATIVE_NEIGHBORHOOD_DEPTH {
            return Err(machine_error(
                "invalid_request",
                format!("narrative neighborhood depth exceeds {MAX_NARRATIVE_NEIGHBORHOOD_DEPTH}"),
            ));
        }
        let visible: BTreeSet<String> = graph
            .definition
            .nodes
            .iter()
            .filter(|node| node_is_visible(node, &access_scopes))
            .map(|node| node.id.clone())
            .collect();
        let visible_edges: Vec<&NarrativeEdge> = graph
            .definition
            .edges
            .iter()
            .filter(|edge| {
                narrative_edge_is_visible(edge, &visible, &access_scopes, model, &stored.snapshot)
            })
            .collect();

        if mode == "skeleton" {
            let root_nodes: Vec<serde_json::Value> = graph
                .definition
                .roots
                .iter()
                .filter(|id| visible.contains(*id))
                .filter_map(|id| graph.nodes.get(id))
                .map(|node| narrative_node_projection(node, false, false))
                .collect();
            let mut relations = BTreeMap::<String, usize>::new();
            for edge in &visible_edges {
                *relations.entry(edge.relation.clone()).or_default() += 1;
            }
            return encode(serde_json::json!({
                "schema": NARRATIVE_GRAPH_VIEW_SCHEMA,
                "mode": "skeleton",
                "graph": narrative_graph_summary(&graph, &stored.snapshot),
                "graph_hash": graph.graph_hash,
                "source_snapshot_hash": stored.snapshot_hash,
                "total_node_count": visible.len(),
                "visible_node_count": visible.len(),
                "visible_edge_count": visible_edges.len(),
                "roots": root_nodes,
                "relations": relations,
                "content_included": false,
                "access_scopes": access_scopes,
            }));
        }

        let (core, returned, neighborhood_summary) = if let Some(center) = center {
            if !visible.contains(&center) {
                return Err(machine_error(
                    "not_found",
                    format!("unknown or inaccessible narrative node {center}"),
                ));
            }
            let core =
                narrative_neighborhood_core(&center, depth, direction, &visible_edges, &visible);
            let mut returned = core.clone();
            for edge in &visible_edges {
                let source = endpoint_node_id_local(&edge.source);
                let target = endpoint_node_id_local(&edge.target);
                if source.is_some_and(|id| core.contains(id))
                    || target.is_some_and(|id| core.contains(id))
                {
                    if let Some(id) = source {
                        returned.insert(id.to_owned());
                    }
                    if let Some(id) = target {
                        returned.insert(id.to_owned());
                    }
                }
            }
            let boundary_count = returned.len().saturating_sub(core.len());
            let core_node_count = core.len();
            (
                core,
                returned,
                Some(serde_json::json!({
                    "center_node_id": center,
                    "depth": depth,
                    "direction": direction,
                    "core_node_count": core_node_count,
                    "boundary_node_count": boundary_count,
                })),
            )
        } else {
            (visible.clone(), visible.clone(), None)
        };
        let nodes: Vec<serde_json::Value> = graph
            .definition
            .nodes
            .iter()
            .filter(|node| returned.contains(&node.id))
            .map(|node| narrative_node_projection(node, include_content, !core.contains(&node.id)))
            .collect();
        let edges: Vec<&NarrativeEdge> = visible_edges
            .into_iter()
            .filter(|edge| {
                let source = endpoint_node_id_local(&edge.source);
                let target = endpoint_node_id_local(&edge.target);
                match (source, target) {
                    (Some(source), Some(target)) => {
                        returned.contains(source) && returned.contains(target)
                    }
                    (Some(source), None) => returned.contains(source),
                    (None, Some(target)) => returned.contains(target),
                    (None, None) => mode == "full",
                }
            })
            .collect();
        encode(serde_json::json!({
            "schema": NARRATIVE_GRAPH_VIEW_SCHEMA,
            "mode": mode,
            "graph": narrative_graph_summary(&graph, &stored.snapshot),
            "graph_hash": graph.graph_hash,
            "source_snapshot_hash": stored.snapshot_hash,
            "total_node_count": visible.len(),
            "total_edge_count": graph.definition.edges.iter().filter(|edge| narrative_edge_is_visible(edge, &visible, &access_scopes, model, &stored.snapshot)).count(),
            "returned_node_count": nodes.len(),
            "returned_edge_count": edges.len(),
            "content_included": include_content,
            "access_scopes": access_scopes,
            "roots": graph.definition.roots.iter().filter(|id| returned.contains(*id)).collect::<Vec<_>>(),
            "nodes": nodes,
            "edges": edges,
            "neighborhood": neighborhood_summary,
        }))
    }

    pub(super) fn list_narrative_revisions(
        &self,
        spec: NarrativeHistorySpec,
    ) -> Result<serde_json::Value, MachineError> {
        if let Some(graph_id) = &spec.graph_id {
            if graph_id.trim().is_empty() || graph_id.len() > MAX_MODEL_IDENTIFIER_BYTES {
                return Err(machine_error(
                    "invalid_request",
                    "narrative history graph_id must be nonempty and bounded",
                ));
            }
        }
        let selected: BTreeSet<&str> = self
            .narrative_revisions
            .values()
            .filter(|revision| {
                spec.graph_id
                    .as_ref()
                    .is_none_or(|graph_id| &revision.graph_id == graph_id)
            })
            .map(|revision| revision.graph_hash.as_str())
            .collect();
        let mut children = BTreeMap::<&str, Vec<&str>>::new();
        for revision in self.narrative_revisions.values() {
            if !selected.contains(revision.graph_hash.as_str()) {
                continue;
            }
            if let Some(previous) = revision.revision.previous_graph_hash.as_deref() {
                if selected.contains(previous) {
                    children
                        .entry(previous)
                        .or_default()
                        .push(revision.graph_hash.as_str());
                }
            }
        }
        for successors in children.values_mut() {
            successors.sort_by_key(|hash| {
                self.narrative_revisions
                    .get(*hash)
                    .map_or(u64::MAX, |revision| revision.operation_sequence)
            });
        }
        let mut ordered: Vec<&NarrativeEntry> = self
            .narrative_revisions
            .values()
            .filter(|revision| selected.contains(revision.graph_hash.as_str()))
            .collect();
        ordered.sort_by_key(|revision| revision.operation_sequence);
        let revisions: Vec<serde_json::Value> = ordered
            .iter()
            .map(|revision| {
                let successors = children
                    .get(revision.graph_hash.as_str())
                    .cloned()
                    .unwrap_or_default();
                serde_json::json!({
                    "operation_sequence": revision.operation_sequence,
                    "graph_id": revision.graph_id,
                    "graph_hash": revision.graph_hash,
                    "revision_number": revision.revision.number,
                    "previous_graph_hash": revision.revision.previous_graph_hash,
                    "snapshot_hash": revision.snapshot_hash,
                    "child_hashes": successors,
                    "child_count": successors.len(),
                    "is_root": revision.revision.previous_graph_hash.is_none(),
                    "is_head": successors.is_empty(),
                    "is_branch_point": successors.len() > 1,
                    "reason_present": !revision.revision.reason.is_empty(),
                    "provenance_record_count": revision.revision.provenance.len(),
                })
            })
            .collect();
        let heads: Vec<&str> = ordered
            .iter()
            .filter(|revision| !children.contains_key(revision.graph_hash.as_str()))
            .map(|revision| revision.graph_hash.as_str())
            .collect();
        encode(serde_json::json!({
            "schema": NARRATIVE_HISTORY_SCHEMA,
            "graph_id_filter": spec.graph_id,
            "revision_count": revisions.len(),
            "heads": heads,
            "revisions": revisions,
            "ordering": "append_only_operation_sequence",
            "semantic_order_independent": true,
            "simulated_world_time_independent": true,
            "metadata_policy": "reason_and_provenance_content_not_exposed",
            "navigation": {
                "select_by": "graph_hash",
                "branch_with": "apply_narrative_batch_or_revise_narrative_graph",
                "active_mutable_head": false
            }
        }))
    }

    pub(super) fn render_narrative_graph(
        &self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let graph_hash = required(
            command.narrative_graph_hash,
            "render_narrative_graph requires narrative_graph_hash",
        )?;
        let spec = required(
            command.narrative_render,
            "render_narrative_graph requires narrative_render",
        )?;
        let stored = self.materialize_narrative_graph(&graph_hash).map_err(|_| {
            machine_error("not_found", format!("unknown narrative graph {graph_hash}"))
        })?;
        self.render_stored_narrative_graph(stored, spec)
    }

    pub(super) fn render_stored_narrative_graph(
        &self,
        stored: StoredNarrativeGraph,
        mut spec: NarrativeRenderSpec,
    ) -> Result<serde_json::Value, MachineError> {
        let graph = compiled_stored_narrative(&stored.graph_hash, stored.definition.clone());
        validate_narrative_access_scopes(&mut spec.access_scopes)?;
        validate_expected_graph_hash(&spec.expected_graph_hash, &graph.graph_hash)?;
        let roots = if spec.root_ids.is_empty() {
            graph
                .definition
                .roots
                .iter()
                .filter(|root| {
                    graph
                        .nodes
                        .get(root.as_str())
                        .is_some_and(|node| node_is_visible(node, &spec.access_scopes))
                })
                .cloned()
                .collect()
        } else {
            if spec.root_ids.len() > MAX_NARRATIVE_ROOTS {
                return Err(machine_error(
                    "invalid_request",
                    "narrative render requests too many roots",
                ));
            }
            for root in &spec.root_ids {
                let node = graph.nodes.get(root).ok_or_else(|| {
                    machine_error("not_found", format!("unknown narrative root {root}"))
                })?;
                if !node_is_visible(node, &spec.access_scopes) {
                    return Err(machine_error(
                        "not_found",
                        format!("unknown or inaccessible narrative root {root}"),
                    ));
                }
            }
            spec.root_ids.clone()
        };
        let sequence = narrative_render_sequence(&graph, &roots, &spec.access_scopes);
        let units: Vec<serde_json::Value> = sequence
            .iter()
            .filter_map(|id| graph.nodes.get(id))
            .map(|node| {
                let content_hash = hash_serializable(&node.text).unwrap_or_default();
                serde_json::json!({
                    "node_id": node.id,
                    "node_type": node.node_type,
                    "role": node.role,
                    "title": node.title,
                    "text": node.text,
                    "content_hash": content_hash,
                })
            })
            .collect();
        let text = sequence
            .iter()
            .filter_map(|id| graph.nodes.get(id))
            .map(|node| node.text.as_str())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        let projection_hash = hash_serializable(&serde_json::json!({
            "graph_hash": graph.graph_hash,
            "roots": roots,
            "sequence": sequence,
            "text": text,
            "join_policy": "blank_line",
        }))?;
        encode(serde_json::json!({
            "schema": NARRATIVE_RENDER_SCHEMA,
            "graph": narrative_graph_summary(&graph, &stored.snapshot),
            "graph_hash": graph.graph_hash,
            "source_snapshot_hash": stored.snapshot_hash,
            "roots": roots,
            "sequence": sequence,
            "units": units,
            "join_policy": "blank_line",
            "text": text,
            "projection_hash": projection_hash,
            "canonical_artifact_source": "narrative_graph_nodes",
            "world_authority": "unchanged",
        }))
    }

    pub(super) fn export_narrative_training(
        &self,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        let graph_hash = required(
            command.narrative_graph_hash,
            "export_narrative_training requires narrative_graph_hash",
        )?;
        let mut spec = required(
            command.narrative_training,
            "export_narrative_training requires narrative_training",
        )?;
        let stored = self.materialize_narrative_graph(&graph_hash).map_err(|_| {
            machine_error("not_found", format!("unknown narrative graph {graph_hash}"))
        })?;
        self.ensure_portable_source_history(&stored.snapshot)?;
        let graph = compiled_stored_narrative(&stored.graph_hash, stored.definition.clone());
        validate_narrative_access_scopes(&mut spec.access_scopes)?;
        validate_expected_graph_hash(&spec.expected_graph_hash, &graph.graph_hash)?;
        if spec.require_accepted_history
            && !(stored.snapshot.source_kind == "world"
                || stored.snapshot.candidate_status.as_deref() == Some("committed"))
        {
            return Err(machine_error(
                "conflict",
                "accepted-history export requires a world or committed candidate source",
            ));
        }
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
        let explicit = !spec.node_ids.is_empty();
        if spec.node_ids.len() > MAX_NARRATIVE_NODES {
            return Err(machine_error(
                "invalid_request",
                "narrative training selection exceeds the node limit",
            ));
        }
        let requested: BTreeSet<String> = if explicit {
            let mut selected = BTreeSet::new();
            for id in &spec.node_ids {
                let node = graph.nodes.get(id).ok_or_else(|| {
                    machine_error("not_found", format!("unknown narrative node {id}"))
                })?;
                if !node_is_visible(node, &spec.access_scopes) {
                    return Err(machine_error(
                        "not_found",
                        format!("unknown or inaccessible narrative node {id}"),
                    ));
                }
                if node.training != NarrativeInclusionPolicy::Include {
                    return Err(machine_error(
                        "conflict",
                        format!("narrative node {id} is excluded from training"),
                    ));
                }
                selected.insert(id.clone());
            }
            selected
        } else {
            graph
                .definition
                .nodes
                .iter()
                .filter(|node| {
                    node.training == NarrativeInclusionPolicy::Include
                        && node_is_visible(node, &spec.access_scopes)
                })
                .map(|node| node.id.clone())
                .collect()
        };
        let mut order =
            narrative_render_sequence(&graph, &graph.definition.roots, &spec.access_scopes);
        for id in requested.iter() {
            if !order.contains(id) {
                order.push(id.clone());
            }
        }
        order.retain(|id| requested.contains(id));
        let visible_nodes: BTreeSet<String> = graph
            .definition
            .nodes
            .iter()
            .filter(|node| node_is_visible(node, &spec.access_scopes))
            .map(|node| node.id.clone())
            .collect();
        let mut records = Vec::new();
        for (sequence_index, id) in order.iter().enumerate() {
            let node = graph
                .nodes
                .get(id)
                .expect("training selection names a compiled node");
            let incident: Vec<&NarrativeEdge> = graph
                .definition
                .edges
                .iter()
                .filter(|edge| {
                    endpoint_node_id_local(&edge.source) == Some(id.as_str())
                        || endpoint_node_id_local(&edge.target) == Some(id.as_str())
                })
                .filter(|edge| {
                    narrative_edge_is_visible(
                        edge,
                        &visible_nodes,
                        &spec.access_scopes,
                        model,
                        &stored.snapshot,
                    )
                })
                .collect();
            let mut linked_values = BTreeMap::new();
            if spec.include_linked_values {
                for edge in &incident {
                    for endpoint in [&edge.source, &edge.target] {
                        if let NarrativeEndpoint::Anchor {
                            anchor_kind: NarrativeAnchorKind::Process,
                            anchor_id,
                            ..
                        } = endpoint
                        {
                            if let Some(process) = model.processes.get(anchor_id) {
                                if visible_to(&process.access_scopes, &spec.access_scopes) {
                                    if let Some(value) = stored.snapshot.state.get(anchor_id) {
                                        linked_values.insert(anchor_id.clone(), value.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let text_hash = hash_serializable(&node.text)?;
            let record_core = serde_json::json!({
                "sequence_index": sequence_index,
                "graph_revision": graph.definition.revision.number,
                "graph_hash": graph.graph_hash,
                "source_snapshot": {
                    "model_hash": stored.snapshot.model_hash,
                    "model_revision": stored.snapshot.model_revision,
                    "source_kind": stored.snapshot.source_kind,
                    "source_hash": stored.snapshot.source_hash,
                    "world_id": stored.snapshot.world_id,
                    "world_version": stored.snapshot.world_version,
                    "world_time": stored.snapshot.time,
                    "candidate_status": stored.snapshot.candidate_status,
                },
                "node": {
                    "id": node.id,
                    "node_type": node.node_type,
                    "role": node.role,
                    "title": node.title,
                    "text": node.text,
                    "text_hash": text_hash,
                    "epistemic_status": node.epistemic_status,
                    "evidence_type": node.evidence_type,
                    "holder": node.holder,
                    "subject": node.subject,
                    "estimator": node.estimator,
                    "uncertainty": node.uncertainty,
                    "authority": node.authority,
                    "interval": node.interval,
                    "value_time": node.value_time,
                    "evidence_cutoff": node.evidence_cutoff,
                    "provenance": node.provenance,
                },
                "links": incident,
                "linked_values": linked_values,
                "causal_use": "single_snapshot_alignment_only; chronological ordering is not established",
            });
            let record_id = hash_serializable(&record_core)?;
            records.push(serde_json::json!({
                "record_id": record_id,
                "record": record_core,
            }));
        }
        let export_hash = hash_serializable(&records)?;
        encode(serde_json::json!({
            "schema": NARRATIVE_TRAINING_SCHEMA,
            "graph": narrative_graph_summary(&graph, &stored.snapshot),
            "graph_hash": graph.graph_hash,
            "source_snapshot_hash": stored.snapshot_hash,
            "accepted_history_required": spec.require_accepted_history,
            "record_count": records.len(),
            "records": records,
            "export_hash": export_hash,
            "training_views": {
                "joint_snapshot_alignment": "text plus semantic state from one exact frozen snapshot",
                "inverse_snapshot_reading": "text -> semantic state aligned to that snapshot",
                "snapshot_rendering": "semantic state from that snapshot -> text"
            },
            "causal_chronology": {
                "established": false,
                "reason": "node cutoffs are metadata; this export does not prove that linked snapshot values predate each node"
            },
            "limitations": [
                "export creates aligned records but does not train a model",
                "chronological training requires separately time-bound snapshots or a downstream causal mask",
                "externalized reflections are explicit testimony, never hidden chain-of-thought",
                "access scopes are projection guards, not authenticated confidentiality"
            ],
        }))
    }
}

fn endpoint_node_id_local(endpoint: &NarrativeEndpoint) -> Option<&str> {
    match endpoint {
        NarrativeEndpoint::Node { node_id } => Some(node_id),
        NarrativeEndpoint::Anchor { .. } => None,
    }
}

fn narrative_node_projection(
    node: &NarrativeNode,
    include_content: bool,
    boundary: bool,
) -> serde_json::Value {
    let mut value = serde_json::json!({
        "id": node.id,
        "node_type": node.node_type,
        "role": node.role,
        "title": node.title,
        "summary": node.summary,
        "epistemic_status": node.epistemic_status,
        "evidence_type": node.evidence_type,
        "holder": node.holder,
        "subject": node.subject,
        "estimator": node.estimator,
        "uncertainty": node.uncertainty,
        "authority": node.authority,
        "interval": node.interval,
        "value_time": node.value_time,
        "evidence_cutoff": node.evidence_cutoff,
        "access_scopes": node.access_scopes,
        "render": node.render,
        "training": node.training,
        "provenance": node.provenance,
        "boundary": boundary,
        "content_included": include_content,
    });
    if include_content {
        value
            .as_object_mut()
            .expect("narrative node projection is an object")
            .insert(
                "text".to_owned(),
                serde_json::Value::String(node.text.clone()),
            );
    }
    value
}

fn narrative_neighborhood_core(
    center: &str,
    depth: usize,
    direction: NarrativeTraversalDirection,
    edges: &[&NarrativeEdge],
    visible: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    for edge in edges {
        let (Some(source), Some(target)) = (
            endpoint_node_id_local(&edge.source),
            endpoint_node_id_local(&edge.target),
        ) else {
            continue;
        };
        if !visible.contains(source) || !visible.contains(target) {
            continue;
        }
        if matches!(
            direction,
            NarrativeTraversalDirection::Descendants | NarrativeTraversalDirection::Both
        ) {
            adjacency
                .entry(source.to_owned())
                .or_default()
                .push(target.to_owned());
        }
        if matches!(
            direction,
            NarrativeTraversalDirection::Ancestors | NarrativeTraversalDirection::Both
        ) {
            adjacency
                .entry(target.to_owned())
                .or_default()
                .push(source.to_owned());
        }
    }
    let mut result = BTreeSet::from([center.to_owned()]);
    let mut queue = VecDeque::from([(center.to_owned(), 0usize)]);
    while let Some((node, distance)) = queue.pop_front() {
        if distance >= depth {
            continue;
        }
        for neighbor in adjacency.get(&node).into_iter().flatten() {
            if result.insert(neighbor.clone()) {
                queue.push_back((neighbor.clone(), distance + 1));
            }
        }
    }
    result
}

fn narrative_render_sequence(
    graph: &CompiledNarrativeGraph,
    roots: &[String],
    access_scopes: &[String],
) -> Vec<String> {
    let visible: BTreeSet<String> = graph
        .definition
        .nodes
        .iter()
        .filter(|node| node_is_visible(node, access_scopes))
        .map(|node| node.id.clone())
        .collect();
    let mut contains = BTreeMap::<String, Vec<(u64, String, String)>>::new();
    let mut next = BTreeMap::<String, Vec<(u64, String, String)>>::new();
    for edge in &graph.definition.edges {
        let (Some(source), Some(target)) = (
            endpoint_node_id_local(&edge.source),
            endpoint_node_id_local(&edge.target),
        ) else {
            continue;
        };
        if !visible.contains(source)
            || !visible.contains(target)
            || !visible_to(&edge.access_scopes, access_scopes)
        {
            continue;
        }
        let tuple = (
            edge.order.unwrap_or(u64::MAX),
            edge.id.clone(),
            target.to_owned(),
        );
        if edge.relation == "contains" {
            contains.entry(source.to_owned()).or_default().push(tuple);
        } else if edge.relation == "next" {
            next.entry(source.to_owned()).or_default().push(tuple);
        }
    }
    for children in contains.values_mut().chain(next.values_mut()) {
        children.sort();
    }
    fn visit(
        id: &str,
        graph: &CompiledNarrativeGraph,
        visible: &BTreeSet<String>,
        contains: &BTreeMap<String, Vec<(u64, String, String)>>,
        next: &BTreeMap<String, Vec<(u64, String, String)>>,
        seen: &mut BTreeSet<String>,
        output: &mut Vec<String>,
    ) {
        if !visible.contains(id) || !seen.insert(id.to_owned()) {
            return;
        }
        let node = graph
            .nodes
            .get(id)
            .expect("visible narrative node is compiled");
        if node.render == NarrativeInclusionPolicy::Include {
            output.push(id.to_owned());
        }
        if let Some(children) = contains.get(id) {
            for (_, _, child) in children {
                visit(child, graph, visible, contains, next, seen, output);
            }
        } else if let Some(successors) = next.get(id) {
            for (_, _, successor) in successors {
                visit(successor, graph, visible, contains, next, seen, output);
            }
        }
    }
    let mut seen = BTreeSet::new();
    let mut output = Vec::new();
    for root in roots {
        visit(
            root,
            graph,
            &visible,
            &contains,
            &next,
            &mut seen,
            &mut output,
        );
    }
    output
}
