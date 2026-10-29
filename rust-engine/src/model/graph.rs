//! The factor graph of a model, world or candidate: process and law nodes joined by the edges their laws read, write
//! and activate, served whole, as a skeleton, or as a neighbourhood, bound to the snapshot it was built from.
//!
//! A graph never changes what it is built from. It shows only the processes the caller's scopes allow (access.rs), and
//! a law only when every process it touches is shown. Its snapshot hash names its source exactly, so a caller can
//! expect one; a different snapshot is a `GraphQueryError::Conflict`, which the session answers as `conflict`.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::limits::{
    MAX_GRAPH_NEIGHBORHOOD_DEPTH, MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW, MAX_GRAPH_SKELETON_HUBS,
    MAX_GRAPH_SKELETON_ROOTS, MAX_QUERY_ACCESS_SCOPES, MAX_QUERY_STRING_BYTES,
};
use crate::model::access::visible_to;
use crate::model::candidate::{CandidateStatus, OccurrenceMark};
use crate::model::compile::{expression_references, law_direct_targets, CompiledModel};
use crate::model::definition::{
    AxisDefinition, ClaimUncertainty, DecompositionKind, DependencyKind, LawActivation,
    LawDefinition, LawOperator, OccurrenceTrigger, ProcessType, ProcessUpdateMode, ProcessValue,
};
use crate::model::MODEL_GRAPH_SCHEMA;
use crate::{hash_serializable, EngineError, EngineResult};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GraphTraversalDirection {
    Ancestors,
    Descendants,
    #[default]
    Both,
}

fn default_graph_neighborhood_depth() -> usize {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum GraphQuery {
    Full {
        #[serde(default)]
        include_values: bool,
        #[serde(default)]
        access_scopes: Vec<String>,
        #[serde(default)]
        expected_snapshot_hash: Option<String>,
    },
    Skeleton {
        #[serde(default)]
        include_values: bool,
        #[serde(default)]
        access_scopes: Vec<String>,
        #[serde(default)]
        expected_snapshot_hash: Option<String>,
    },
    Neighborhood {
        center: String,
        #[serde(default = "default_graph_neighborhood_depth")]
        depth: usize,
        #[serde(default)]
        direction: GraphTraversalDirection,
        #[serde(default)]
        include_values: bool,
        #[serde(default)]
        access_scopes: Vec<String>,
        #[serde(default)]
        expected_snapshot_hash: Option<String>,
    },
}

impl GraphQuery {
    fn include_values(&self) -> bool {
        match self {
            Self::Full { include_values, .. }
            | Self::Skeleton { include_values, .. }
            | Self::Neighborhood { include_values, .. } => *include_values,
        }
    }

    fn access_scopes(&self) -> &[String] {
        match self {
            Self::Full { access_scopes, .. }
            | Self::Skeleton { access_scopes, .. }
            | Self::Neighborhood { access_scopes, .. } => access_scopes,
        }
    }

    fn expected_snapshot_hash(&self) -> Option<&str> {
        match self {
            Self::Full {
                expected_snapshot_hash,
                ..
            }
            | Self::Skeleton {
                expected_snapshot_hash,
                ..
            }
            | Self::Neighborhood {
                expected_snapshot_hash,
                ..
            } => expected_snapshot_hash.as_deref(),
        }
    }
}

/// Why a graph query was refused. The session answers each kind with its own error code.
#[derive(Debug)]
pub(crate) enum GraphQueryError {
    /// The query itself is malformed or over a limit, or the graph could not be built.
    Invalid(String),
    /// The neighbourhood's centre names no node of the graph.
    NotFound(String),
    /// The caller expected a snapshot other than the one the graph was built from.
    Conflict(String),
}

impl From<EngineError> for GraphQueryError {
    fn from(value: EngineError) -> Self {
        Self::Invalid(value.0)
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum GraphFactorKind {
    Process,
    Law,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct FactorGraphProcessMetadata {
    value_type: ProcessType,
    uncertainty: ClaimUncertainty,
    provenance: Vec<String>,
    axes: Vec<AxisDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_frame: Option<String>,
    scale: BTreeMap<String, String>,
    support: Vec<String>,
    update_mode: ProcessUpdateMode,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum FactorGraphEdgeKind {
    Reads,
    Writes,
    Activates,
    Decomposition,
    DeclaredDependency,
}

impl FactorGraphEdgeKind {
    fn name(self) -> &'static str {
        match self {
            Self::Reads => "reads",
            Self::Writes => "writes",
            Self::Activates => "activates",
            Self::Decomposition => "decomposition",
            Self::DeclaredDependency => "declared_dependency",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct FactorGraphNode {
    id: String,
    source_id: String,
    kind: GraphFactorKind,
    role: String,
    /// Process metadata excluding the separately scope-guarded value. Skeleton
    /// projections intentionally omit all nodes, while full and neighborhood
    /// projections retain selected metadata so a caller can inspect the actual
    /// modeled quantity rather than topology alone.
    #[serde(skip_serializing_if = "Option::is_none")]
    process_metadata: Option<FactorGraphProcessMetadata>,
    /// Lossless executable payload for a law factor node.
    #[serde(skip_serializing_if = "Option::is_none")]
    law_definition: Option<LawDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    activation: Option<LawActivation>,
    access_scopes: Vec<String>,
    value_access: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<ProcessValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    occurrence_mark_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    occurrence_marks_truncated: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    occurrence_marks: Vec<OccurrenceMark>,
    boundary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct FactorGraphEdge {
    id: String,
    kind: FactorGraphEdgeKind,
    source: String,
    target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    law_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    decomposition_kind: Option<DecompositionKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dependency_kind: Option<DependencyKind>,
    crossing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GraphSnapshotSource {
    pub(crate) kind: String,
    pub(crate) model_hash: String,
    pub(crate) model_revision: u64,
    pub(crate) source_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) world_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) world_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) candidate_status: Option<CandidateStatus>,
}

#[derive(Debug, Serialize)]
struct GraphSnapshotFingerprint<'a> {
    schema: &'static str,
    source_kind: &'a str,
    model_hash: &'a str,
    source_hash: &'a str,
    candidate_status: Option<CandidateStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct GraphSkeletonHub {
    node_id: String,
    source_id: String,
    kind: GraphFactorKind,
    degree: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct GraphSkeleton {
    process_count: usize,
    law_count: usize,
    edge_kinds: BTreeMap<String, usize>,
    decomposition_root_count: usize,
    decomposition_roots: Vec<String>,
    hubs: Vec<GraphSkeletonHub>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct GraphNeighborhoodSummary {
    center: String,
    depth: usize,
    direction: GraphTraversalDirection,
    core_node_count: usize,
    boundary_node_count: usize,
    crossing_edge_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FactorGraphResponse {
    schema: &'static str,
    snapshot_hash: String,
    source: GraphSnapshotSource,
    mode: String,
    value_projection_requested: bool,
    access_scopes: Vec<String>,
    total_node_count: usize,
    total_edge_count: usize,
    returned_node_count: usize,
    returned_edge_count: usize,
    nodes: Vec<FactorGraphNode>,
    edges: Vec<FactorGraphEdge>,
    #[serde(skip_serializing_if = "Option::is_none")]
    skeleton: Option<GraphSkeleton>,
    #[serde(skip_serializing_if = "Option::is_none")]
    neighborhood: Option<GraphNeighborhoodSummary>,
}

#[derive(Serialize)]
struct FactorGraphEdgeFingerprint<'a> {
    schema: &'static str,
    kind: &'a str,
    source: &'a str,
    target: &'a str,
    record_id: Option<&'a str>,
    law_id: Option<&'a str>,
}

fn process_factor_id(process_id: &str) -> String {
    format!("process:{process_id}")
}

fn law_factor_id(law_id: &str) -> String {
    format!("law:{law_id}")
}

fn factor_graph_edge(
    kind: FactorGraphEdgeKind,
    source: String,
    target: String,
    record_id: Option<String>,
    law_id: Option<String>,
    decomposition_kind: Option<DecompositionKind>,
    dependency_kind: Option<DependencyKind>,
) -> EngineResult<FactorGraphEdge> {
    let id = format!(
        "edge:{}",
        hash_serializable(&FactorGraphEdgeFingerprint {
            schema: MODEL_GRAPH_SCHEMA,
            kind: kind.name(),
            source: &source,
            target: &target,
            record_id: record_id.as_deref(),
            law_id: law_id.as_deref(),
        })?
    );
    Ok(FactorGraphEdge {
        id,
        kind,
        source,
        target,
        record_id,
        law_id,
        decomposition_kind,
        dependency_kind,
        crossing: false,
    })
}

/// Extracts only references present in the executable expression AST. This is
/// deliberately separate from declared dependency overlays and from targets of
/// laws activated by an occurrence: activation is its own factor edge.
fn law_ast_reads(law: &LawDefinition) -> BTreeSet<String> {
    let mut reads = BTreeSet::new();
    match &law.operator {
        LawOperator::Evolution {
            derivative,
            innovation,
            ..
        } => {
            expression_references(derivative, &mut reads);
            if let Some(innovation) = innovation {
                expression_references(&innovation.scale, &mut reads);
            }
        }
        LawOperator::Relation { value, .. }
        | LawOperator::Epistemic { value, .. }
        | LawOperator::Resolution { value, .. } => expression_references(value, &mut reads),
        LawOperator::Occurrence {
            trigger, effects, ..
        } => {
            match trigger {
                OccurrenceTrigger::Always => {}
                OccurrenceTrigger::Threshold { expression, .. } => {
                    expression_references(expression, &mut reads)
                }
                OccurrenceTrigger::Hazard { rate } => expression_references(rate, &mut reads),
            }
            for effect in effects {
                expression_references(&effect.value, &mut reads);
            }
        }
    }
    reads
}

fn normalized_graph_access_scopes(query: &GraphQuery) -> Result<Vec<String>, GraphQueryError> {
    let mut access_scopes = query.access_scopes().to_vec();
    if access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
        || access_scopes
            .iter()
            .any(|scope| scope.is_empty() || scope.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(GraphQueryError::Invalid(
            "graph query exceeds an access-scope limit".to_owned(),
        ));
    }
    access_scopes.sort();
    access_scopes.dedup();
    Ok(access_scopes)
}

fn build_factor_graph(
    model: &CompiledModel,
    state: &BTreeMap<String, ProcessValue>,
    value_source: &str,
    include_values: bool,
    access_scopes: &[String],
    candidate_marks: Option<&[OccurrenceMark]>,
) -> EngineResult<(Vec<FactorGraphNode>, Vec<FactorGraphEdge>)> {
    let visible_processes: BTreeSet<&str> = model
        .processes
        .values()
        .filter(|process| visible_to(&process.access_scopes, access_scopes))
        .map(|process| process.id.as_str())
        .collect();
    let mut visible_laws: BTreeSet<&str> = model
        .laws
        .iter()
        .filter(|law| {
            law_ast_reads(law)
                .into_iter()
                .chain(law_direct_targets(law))
                .all(|process_id| visible_processes.contains(process_id.as_str()))
        })
        .map(|law| law.id.as_str())
        .collect();
    // A visible occurrence payload must not name a hidden activated law. Repeat
    // to a fixed point because activation chains can be longer than one edge.
    loop {
        let previous_len = visible_laws.len();
        let previous = visible_laws.clone();
        visible_laws.retain(|law_id| {
            let law = model
                .laws
                .iter()
                .find(|law| law.id == *law_id)
                .expect("visible law came from the compiled model");
            match &law.operator {
                LawOperator::Occurrence { activates, .. } => activates
                    .iter()
                    .all(|activated| previous.contains(activated.as_str())),
                LawOperator::Evolution { .. }
                | LawOperator::Relation { .. }
                | LawOperator::Epistemic { .. }
                | LawOperator::Resolution { .. } => true,
            }
        });
        if visible_laws.len() == previous_len {
            break;
        }
    }
    let mut marks_by_law: BTreeMap<&str, Vec<&OccurrenceMark>> = BTreeMap::new();
    if let Some(candidate_marks) = candidate_marks {
        for mark in candidate_marks
            .iter()
            .filter(|mark| mark.kind == "law_occurrence")
        {
            marks_by_law
                .entry(mark.source.as_str())
                .or_default()
                .push(mark);
        }
    }
    let mut nodes = BTreeMap::new();
    for process in model
        .processes
        .values()
        .filter(|process| visible_processes.contains(process.id.as_str()))
    {
        let (value_access, node_value_source, value) = if !include_values {
            ("not_requested", None, None)
        } else {
            (
                "included",
                Some(value_source.to_owned()),
                state.get(&process.id).cloned(),
            )
        };
        let id = process_factor_id(&process.id);
        nodes.insert(
            id.clone(),
            FactorGraphNode {
                id,
                source_id: process.id.clone(),
                kind: GraphFactorKind::Process,
                role: process.value_type.name().to_owned(),
                process_metadata: Some(FactorGraphProcessMetadata {
                    value_type: process.value_type.clone(),
                    uncertainty: process.uncertainty.clone(),
                    provenance: process.provenance.clone(),
                    axes: process.axes.clone(),
                    unit: process.unit.clone(),
                    reference_frame: process.reference_frame.clone(),
                    scale: process.scale.clone(),
                    support: process.support.clone(),
                    update_mode: process.update_mode,
                }),
                law_definition: None,
                enabled: None,
                activation: None,
                access_scopes: process.access_scopes.clone(),
                value_access: value_access.to_owned(),
                value_source: node_value_source,
                value,
                occurrence_mark_count: None,
                occurrence_marks_truncated: None,
                occurrence_marks: Vec::new(),
                boundary: false,
            },
        );
    }
    for law in model
        .laws
        .iter()
        .filter(|law| visible_laws.contains(law.id.as_str()))
    {
        let all_marks = marks_by_law
            .get(law.id.as_str())
            .cloned()
            .unwrap_or_default();
        let occurrence_mark_count = candidate_marks.map(|_| all_marks.len());
        let occurrence_marks: Vec<OccurrenceMark> = all_marks
            .iter()
            .take(MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW)
            .map(|mark| (*mark).clone())
            .collect();
        let occurrence_marks_truncated =
            candidate_marks.map(|_| occurrence_marks.len() < all_marks.len());
        let id = law_factor_id(&law.id);
        nodes.insert(
            id.clone(),
            FactorGraphNode {
                id,
                source_id: law.id.clone(),
                kind: GraphFactorKind::Law,
                role: law.operator.role_name().to_owned(),
                process_metadata: None,
                law_definition: Some(law.clone()),
                enabled: Some(law.enabled),
                activation: Some(law.activation),
                access_scopes: Vec::new(),
                value_access: "not_applicable".to_owned(),
                value_source: None,
                value: None,
                occurrence_mark_count,
                occurrence_marks_truncated,
                occurrence_marks,
                boundary: false,
            },
        );
    }

    let mut edges = BTreeMap::new();
    for law in model
        .laws
        .iter()
        .filter(|law| visible_laws.contains(law.id.as_str()))
    {
        let law_node = law_factor_id(&law.id);
        for process_id in law_ast_reads(law) {
            let edge = factor_graph_edge(
                FactorGraphEdgeKind::Reads,
                process_factor_id(&process_id),
                law_node.clone(),
                None,
                Some(law.id.clone()),
                None,
                None,
            )?;
            edges.insert(edge.id.clone(), edge);
        }
        for process_id in law_direct_targets(law) {
            let edge = factor_graph_edge(
                FactorGraphEdgeKind::Writes,
                law_node.clone(),
                process_factor_id(&process_id),
                None,
                Some(law.id.clone()),
                None,
                None,
            )?;
            edges.insert(edge.id.clone(), edge);
        }
        if let LawOperator::Occurrence { activates, .. } = &law.operator {
            for activated in activates {
                let edge = factor_graph_edge(
                    FactorGraphEdgeKind::Activates,
                    law_node.clone(),
                    law_factor_id(activated),
                    None,
                    Some(law.id.clone()),
                    None,
                    None,
                )?;
                edges.insert(edge.id.clone(), edge);
            }
        }
    }
    for record in model.definition.decomposition.iter().filter(|record| {
        visible_processes.contains(record.parent.as_str())
            && visible_processes.contains(record.child.as_str())
    }) {
        let edge = factor_graph_edge(
            FactorGraphEdgeKind::Decomposition,
            process_factor_id(&record.parent),
            process_factor_id(&record.child),
            Some(record.id.clone()),
            None,
            Some(record.kind),
            None,
        )?;
        edges.insert(edge.id.clone(), edge);
    }
    for record in model.definition.dependencies.iter().filter(|record| {
        visible_processes.contains(record.source.as_str())
            && visible_processes.contains(record.target.as_str())
            && record
                .law_id
                .as_deref()
                .is_none_or(|law_id| visible_laws.contains(law_id))
    }) {
        let edge = factor_graph_edge(
            FactorGraphEdgeKind::DeclaredDependency,
            process_factor_id(&record.source),
            process_factor_id(&record.target),
            Some(record.id.clone()),
            record.law_id.clone(),
            None,
            Some(record.kind),
        )?;
        edges.insert(edge.id.clone(), edge);
    }
    Ok((nodes.into_values().collect(), edges.into_values().collect()))
}

fn factor_graph_skeleton(nodes: &[FactorGraphNode], edges: &[FactorGraphEdge]) -> GraphSkeleton {
    let mut edge_kinds = BTreeMap::new();
    let mut degrees: BTreeMap<&str, usize> = nodes
        .iter()
        .map(|node| (node.id.as_str(), 0usize))
        .collect();
    for edge in edges {
        *edge_kinds.entry(edge.kind.name().to_owned()).or_insert(0) += 1;
        *degrees.entry(edge.source.as_str()).or_insert(0) += 1;
        *degrees.entry(edge.target.as_str()).or_insert(0) += 1;
    }
    let children: BTreeSet<&str> = edges
        .iter()
        .filter(|edge| edge.kind == FactorGraphEdgeKind::Decomposition)
        .map(|edge| edge.target.as_str())
        .collect();
    let roots: Vec<String> = nodes
        .iter()
        .filter(|node| {
            node.kind == GraphFactorKind::Process && !children.contains(node.id.as_str())
        })
        .map(|node| node.source_id.clone())
        .collect();
    let node_by_id: BTreeMap<&str, &FactorGraphNode> =
        nodes.iter().map(|node| (node.id.as_str(), node)).collect();
    let mut ranked: Vec<(&str, usize)> = degrees.into_iter().collect();
    ranked.sort_by(|(left_id, left_degree), (right_id, right_degree)| {
        right_degree
            .cmp(left_degree)
            .then_with(|| left_id.cmp(right_id))
    });
    let hubs = ranked
        .into_iter()
        .take(MAX_GRAPH_SKELETON_HUBS)
        .filter_map(|(node_id, degree)| {
            node_by_id.get(node_id).map(|node| GraphSkeletonHub {
                node_id: node.id.clone(),
                source_id: node.source_id.clone(),
                kind: node.kind,
                degree,
            })
        })
        .collect();
    GraphSkeleton {
        process_count: nodes
            .iter()
            .filter(|node| node.kind == GraphFactorKind::Process)
            .count(),
        law_count: nodes
            .iter()
            .filter(|node| node.kind == GraphFactorKind::Law)
            .count(),
        edge_kinds,
        decomposition_root_count: roots.len(),
        decomposition_roots: roots.into_iter().take(MAX_GRAPH_SKELETON_ROOTS).collect(),
        hubs,
    }
}

fn factor_graph_neighborhood(
    all_nodes: &[FactorGraphNode],
    all_edges: &[FactorGraphEdge],
    center: &str,
    depth: usize,
    direction: GraphTraversalDirection,
) -> Result<
    (
        Vec<FactorGraphNode>,
        Vec<FactorGraphEdge>,
        GraphNeighborhoodSummary,
    ),
    GraphQueryError,
> {
    if depth > MAX_GRAPH_NEIGHBORHOOD_DEPTH {
        return Err(GraphQueryError::Invalid(format!(
            "graph neighborhood depth {depth} exceeds {MAX_GRAPH_NEIGHBORHOOD_DEPTH}"
        )));
    }
    let node_by_id: BTreeMap<&str, &FactorGraphNode> = all_nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let resolved_center = if node_by_id.contains_key(center) {
        center.to_owned()
    } else {
        let process_candidate = process_factor_id(center);
        let law_candidate = law_factor_id(center);
        match (
            node_by_id.contains_key(process_candidate.as_str()),
            node_by_id.contains_key(law_candidate.as_str()),
        ) {
            (true, false) => process_candidate,
            (false, true) => law_candidate,
            (true, true) => {
                return Err(GraphQueryError::Invalid(format!(
                    "graph source id {center} is ambiguous; use process:{center} or law:{center}"
                )))
            }
            (false, false) => {
                return Err(GraphQueryError::NotFound(format!(
                    "unknown graph node or source id {center}"
                )))
            }
        }
    };
    let center = resolved_center.as_str();
    let mut incoming: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut outgoing: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for edge in all_edges {
        outgoing
            .entry(edge.source.as_str())
            .or_default()
            .insert(edge.target.as_str());
        incoming
            .entry(edge.target.as_str())
            .or_default()
            .insert(edge.source.as_str());
    }
    let mut core = BTreeSet::from([center]);
    let mut queue = VecDeque::from([(center, 0usize)]);
    while let Some((node_id, distance)) = queue.pop_front() {
        if distance == depth {
            continue;
        }
        let mut next = BTreeSet::new();
        if matches!(
            direction,
            GraphTraversalDirection::Ancestors | GraphTraversalDirection::Both
        ) {
            next.extend(incoming.get(node_id).into_iter().flatten().copied());
        }
        if matches!(
            direction,
            GraphTraversalDirection::Descendants | GraphTraversalDirection::Both
        ) {
            next.extend(outgoing.get(node_id).into_iter().flatten().copied());
        }
        for adjacent in next {
            if core.insert(adjacent) {
                queue.push_back((adjacent, distance + 1));
            }
        }
    }

    // Include the complete boundary of the traversed core: every incident edge
    // and both endpoints. This prevents a neighborhood response from silently
    // hiding that a selected node reads, writes, activates, contains, or
    // declares a dependency on a node just outside the requested depth.
    let mut returned_node_ids = core.clone();
    let mut returned_edges = Vec::new();
    let mut crossing_edge_count = 0usize;
    for edge in all_edges {
        if core.contains(edge.source.as_str()) || core.contains(edge.target.as_str()) {
            returned_node_ids.insert(edge.source.as_str());
            returned_node_ids.insert(edge.target.as_str());
            let mut selected = edge.clone();
            selected.crossing =
                core.contains(edge.source.as_str()) != core.contains(edge.target.as_str());
            if selected.crossing {
                crossing_edge_count += 1;
            }
            returned_edges.push(selected);
        }
    }
    let mut returned_nodes = Vec::new();
    for node_id in returned_node_ids {
        let mut selected = (*node_by_id
            .get(node_id)
            .expect("graph edge endpoints were validated during model compilation"))
        .clone();
        selected.boundary = !core.contains(node_id);
        returned_nodes.push(selected);
    }
    let summary = GraphNeighborhoodSummary {
        center: center.to_owned(),
        depth,
        direction,
        core_node_count: core.len(),
        boundary_node_count: returned_nodes.iter().filter(|node| node.boundary).count(),
        crossing_edge_count,
    };
    Ok((returned_nodes, returned_edges, summary))
}

fn graph_snapshot_hash(source: &GraphSnapshotSource) -> EngineResult<String> {
    hash_serializable(&GraphSnapshotFingerprint {
        schema: MODEL_GRAPH_SCHEMA,
        source_kind: &source.kind,
        model_hash: &source.model_hash,
        source_hash: &source.source_hash,
        candidate_status: source.candidate_status,
    })
}

fn validate_expected_graph_snapshot(
    expected: Option<&str>,
    actual: &str,
) -> Result<(), GraphQueryError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(GraphQueryError::Invalid(
            "expected_snapshot_hash must be a lowercase 64-character hexadecimal hash".to_owned(),
        ));
    }
    if expected != actual {
        return Err(GraphQueryError::Conflict(format!(
            "graph snapshot changed; expected {expected}, found {actual}"
        )));
    }
    Ok(())
}

pub(crate) fn factor_graph_response(
    model: &CompiledModel,
    state: &BTreeMap<String, ProcessValue>,
    value_source: &str,
    candidate_marks: Option<&[OccurrenceMark]>,
    source: GraphSnapshotSource,
    query: GraphQuery,
) -> Result<FactorGraphResponse, GraphQueryError> {
    let access_scopes = normalized_graph_access_scopes(&query)?;
    let snapshot_hash = graph_snapshot_hash(&source)?;
    validate_expected_graph_snapshot(query.expected_snapshot_hash(), &snapshot_hash)?;
    let include_values = query.include_values();
    let (all_nodes, all_edges) = build_factor_graph(
        model,
        state,
        value_source,
        include_values,
        &access_scopes,
        candidate_marks,
    )?;
    let total_node_count = all_nodes.len();
    let total_edge_count = all_edges.len();
    let (mode, nodes, edges, skeleton, neighborhood) = match query {
        GraphQuery::Full { .. } => ("full".to_owned(), all_nodes, all_edges, None, None),
        GraphQuery::Skeleton { .. } => (
            "skeleton".to_owned(),
            Vec::new(),
            Vec::new(),
            Some(factor_graph_skeleton(&all_nodes, &all_edges)),
            None,
        ),
        GraphQuery::Neighborhood {
            center,
            depth,
            direction,
            ..
        } => {
            let (nodes, edges, summary) =
                factor_graph_neighborhood(&all_nodes, &all_edges, &center, depth, direction)?;
            ("neighborhood".to_owned(), nodes, edges, None, Some(summary))
        }
    };
    Ok(FactorGraphResponse {
        schema: MODEL_GRAPH_SCHEMA,
        snapshot_hash,
        source,
        mode,
        value_projection_requested: include_values,
        access_scopes,
        total_node_count,
        total_edge_count,
        returned_node_count: nodes.len(),
        returned_edge_count: edges.len(),
        nodes,
        edges,
        skeleton,
        neighborhood,
    })
}
