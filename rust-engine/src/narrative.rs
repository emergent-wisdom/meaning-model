use super::{
    validate_uncertainty, Claim, ClaimAuthority, ClaimUncertainty, EventInterval, EvidenceType,
    OccurrenceMark, ProcessValue, MAX_MODEL_IDENTIFIER_BYTES,
};
use crate::{error, hash_serializable, EngineResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const NARRATIVE_GRAPH_SCHEMA: &str = "life-sim-rust-narrative-graph/v1";
pub const NARRATIVE_BATCH_SCHEMA: &str = "life-sim-rust-narrative-batch/v1";
pub const NARRATIVE_GRAPH_VIEW_SCHEMA: &str = "life-sim-rust-narrative-graph-view/v1";
pub const NARRATIVE_RENDER_SCHEMA: &str = "life-sim-rust-narrative-render/v1";
pub const NARRATIVE_TRAINING_SCHEMA: &str = "life-sim-rust-narrative-training/v1";
pub const NARRATIVE_HISTORY_SCHEMA: &str = "life-sim-rust-narrative-history/v1";
pub const NARRATIVE_REVISION_STORE_SCHEMA: &str = "life-sim-rust-narrative-revision-store/v2";
pub const MAX_NARRATIVE_NODES: usize = 50_000;
pub const MAX_NARRATIVE_EDGES: usize = 200_000;
pub const MAX_NARRATIVE_ROOTS: usize = 1_024;
pub const MAX_NARRATIVE_TEXT_BYTES: usize = 1_048_576;
pub const MAX_NARRATIVE_STRING_BYTES: usize = 8_192;
pub const MAX_NARRATIVE_SCOPES: usize = 64;
pub const MAX_NARRATIVE_NEIGHBORHOOD_DEPTH: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeGraphRevision {
    pub number: u64,
    #[serde(default)]
    pub previous_graph_hash: Option<String>,
    pub reason: String,
    pub provenance: Vec<String>,
}

/// Binds canonical artifact text to one exact state of the Rust authority.
/// A world binding includes the expected hash to prevent a stale authoring
/// request from silently attaching prose to a newer accepted history.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeGraphSource {
    Model {
        model_hash: String,
    },
    World {
        world_id: String,
        world_hash: String,
    },
    Candidate {
        candidate_hash: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeNodeRole {
    DocumentRoot,
    StoryPassage,
    CharacterInterior,
    ExternalizedReflection,
    ReaderResponse,
    Metadata,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeInclusionPolicy {
    Include,
    #[default]
    Exclude,
}

/// `node_type` and `epistemic_status` deliberately remain open vocabularies.
/// `role` supplies the small interoperable contract; domains may add finer
/// node kinds without revising the universal schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeNode {
    pub id: String,
    pub node_type: String,
    pub role: NarrativeNodeRole,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub epistemic_status: String,
    pub evidence_type: EvidenceType,
    #[serde(default)]
    pub holder: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub estimator: Option<String>,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
    #[serde(default)]
    pub value_time: Option<f64>,
    #[serde(default)]
    pub evidence_cutoff: Option<f64>,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    #[serde(default)]
    pub render: NarrativeInclusionPolicy,
    #[serde(default)]
    pub training: NarrativeInclusionPolicy,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeAnchorKind {
    Model,
    Process,
    Decomposition,
    Dependency,
    Law,
    Claim,
    Concept,
    AbstractRelation,
    AbstractCut,
    Referent,
    EncapsulationCut,
    Event,
    EventRelation,
    EventReferentBinding,
    PhysicalCut,
    Realization,
    World,
    Candidate,
    Occurrence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeEndpoint {
    Node {
        node_id: String,
    },
    Anchor {
        anchor_kind: NarrativeAnchorKind,
        anchor_id: String,
        /// Optional RFC 6901 JSON Pointer relative to the stable anchored
        /// object, validated against the exact bound model/source snapshot.
        #[serde(default)]
        path: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeEdgeFamily {
    Structural,
    Grounding,
    Semantic,
    Provenance,
    Revision,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeEdge {
    pub id: String,
    pub source: NarrativeEndpoint,
    pub target: NarrativeEndpoint,
    pub family: NarrativeEdgeFamily,
    /// Open relation vocabulary. `contains` and `next` have structural
    /// validation; relations such as `expresses`, `evidenced_by`, or
    /// `inspired_by` remain domain-extensible.
    pub relation: String,
    #[serde(default)]
    pub order: Option<u64>,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeGraphDefinition {
    pub schema: String,
    pub id: String,
    pub revision: NarrativeGraphRevision,
    pub source: NarrativeGraphSource,
    #[serde(default)]
    pub roots: Vec<String>,
    pub nodes: Vec<NarrativeNode>,
    #[serde(default)]
    pub edges: Vec<NarrativeEdge>,
}

/// An additive transaction over one immutable narrative graph revision. The
/// Rust session constructs and stores a complete successor; callers need send
/// only the new roots, nodes, and edges.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeGraphBatch {
    pub schema: String,
    pub previous_graph_hash: String,
    pub reason: String,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub add_roots: Vec<String>,
    #[serde(default)]
    pub add_nodes: Vec<NarrativeNode>,
    #[serde(default)]
    pub add_edges: Vec<NarrativeEdge>,
}

#[derive(Debug, Clone)]
pub struct CompiledNarrativeGraph {
    pub graph_hash: String,
    pub definition: NarrativeGraphDefinition,
    pub nodes: BTreeMap<String, NarrativeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeSourceSnapshot {
    pub model_hash: String,
    pub model_revision: u64,
    pub source_kind: String,
    pub source_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_version: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_status: Option<String>,
    /// The captured values make the text/state alignment durable even after a
    /// mutable world handle advances. Access is still checked at export time.
    pub state: BTreeMap<String, ProcessValue>,
    #[serde(default)]
    pub claims: BTreeMap<String, Claim>,
    #[serde(default)]
    pub occurrences: Vec<OccurrenceMark>,
    /// Exact candidate objects available to candidate anchors when this
    /// snapshot was captured. Candidate retention can later be enriched under
    /// the same canonical candidate hash, so anchor paths must resolve against
    /// this frozen material rather than the live candidate store.
    #[serde(default)]
    pub candidate_anchors: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StoredNarrativeGraph {
    pub graph_hash: String,
    pub snapshot_hash: String,
    pub definition: NarrativeGraphDefinition,
    pub snapshot: NarrativeSourceSnapshot,
}

/// One source snapshot stored once and referenced by every narrative revision
/// that is grounded in the same frozen model, world, or candidate state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StoredNarrativeSourceSnapshot {
    pub snapshot_hash: String,
    pub snapshot: NarrativeSourceSnapshot,
}

/// Ordered patch operations are deliberately separate from semantic edge
/// order and event time. They reconstruct the exact vectors that participate
/// in a graph hash without assigning insertion chronology semantic meaning.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeRootPatchOperation {
    Insert { index: usize, node_id: String },
    Remove { node_id: String },
    Move { node_id: String, index: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeNodePatchOperation {
    Insert { index: usize, node: NarrativeNode },
    Replace { node: NarrativeNode },
    Remove { node_id: String },
    Move { node_id: String, index: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeEdgePatchOperation {
    Insert { index: usize, edge: NarrativeEdge },
    Replace { edge: NarrativeEdge },
    Remove { edge_id: String },
    Move { edge_id: String, index: usize },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeGraphDelta {
    #[serde(default)]
    pub root_operations: Vec<NarrativeRootPatchOperation>,
    #[serde(default)]
    pub node_operations: Vec<NarrativeNodePatchOperation>,
    #[serde(default)]
    pub edge_operations: Vec<NarrativeEdgePatchOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeRevisionPayload {
    Root {
        roots: Vec<String>,
        nodes: Vec<NarrativeNode>,
        edges: Vec<NarrativeEdge>,
    },
    Delta {
        delta: NarrativeGraphDelta,
    },
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeInsertionScope {
    #[default]
    FullDefinition,
    AdditiveBatch,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeInsertionOrder {
    /// Raw caller order for a full graph request, or raw additive order for a
    /// batch. These identifiers are provenance only: compilation, hashing,
    /// semantic traversal, and rendering never consult them.
    pub scope: NarrativeInsertionScope,
    pub root_ids: Vec<String>,
    pub node_ids: Vec<String>,
    pub edge_ids: Vec<String>,
}

/// Append-only storage record for one immutable narrative revision. The
/// operation sequence captures commit/insertion provenance across roots and
/// branches; it is intentionally absent from `NarrativeGraphDefinition`, so
/// graph hashes and all domain-level ordering remain unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StoredNarrativeRevision {
    pub schema: String,
    pub operation_sequence: u64,
    pub record_hash: String,
    pub graph_hash: String,
    pub snapshot_hash: String,
    pub graph_schema: String,
    pub graph_id: String,
    pub revision: NarrativeGraphRevision,
    pub source: NarrativeGraphSource,
    pub insertion_order: NarrativeInsertionOrder,
    pub payload: NarrativeRevisionPayload,
}

pub(crate) fn seal_narrative_revision_record(
    mut record: StoredNarrativeRevision,
) -> EngineResult<StoredNarrativeRevision> {
    record.record_hash.clear();
    record.record_hash = hash_serializable(&record)?;
    Ok(record)
}

pub(crate) fn validate_narrative_revision_record_hash(
    record: &StoredNarrativeRevision,
) -> EngineResult<()> {
    let mut unhashed = record.clone();
    unhashed.record_hash.clear();
    if hash_serializable(&unhashed)? != record.record_hash {
        return Err(error("narrative revision record hash is invalid"));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NarrativeTraversalDirection {
    Ancestors,
    Descendants,
    #[default]
    Both,
}

fn default_narrative_depth() -> usize {
    1
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum NarrativeGraphQuery {
    Full {
        #[serde(default)]
        include_content: bool,
        #[serde(default)]
        access_scopes: Vec<String>,
        #[serde(default)]
        expected_graph_hash: Option<String>,
    },
    Skeleton {
        #[serde(default)]
        access_scopes: Vec<String>,
        #[serde(default)]
        expected_graph_hash: Option<String>,
    },
    Neighborhood {
        center_node_id: String,
        #[serde(default = "default_narrative_depth")]
        depth: usize,
        #[serde(default)]
        direction: NarrativeTraversalDirection,
        #[serde(default)]
        include_content: bool,
        #[serde(default)]
        access_scopes: Vec<String>,
        #[serde(default)]
        expected_graph_hash: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NarrativeRenderSpec {
    #[serde(default)]
    pub root_ids: Vec<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    #[serde(default)]
    pub expected_graph_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NarrativeTrainingSpec {
    #[serde(default)]
    pub node_ids: Vec<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    #[serde(default = "default_true")]
    pub include_linked_values: bool,
    /// When true, model-initial, pending, rejected, and superseded sources are
    /// refused rather than exported as if they were accepted world history.
    #[serde(default)]
    pub require_accepted_history: bool,
    #[serde(default)]
    pub expected_graph_hash: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NarrativeHistorySpec {
    /// Omit to enumerate every graph history in the session.
    #[serde(default)]
    pub graph_id: Option<String>,
}

fn default_true() -> bool {
    true
}

fn nonempty_bounded(value: &str, label: &str, maximum: usize) -> EngineResult<()> {
    if value.trim().is_empty() || value.len() > maximum {
        return Err(error(format!(
            "{label} must be nonempty and at most {maximum} bytes"
        )));
    }
    Ok(())
}

fn validate_scopes(scopes: &mut Vec<String>, label: &str) -> EngineResult<()> {
    if scopes.len() > MAX_NARRATIVE_SCOPES {
        return Err(error(format!(
            "{label} exceeds {MAX_NARRATIVE_SCOPES} access scopes"
        )));
    }
    for scope in scopes.iter() {
        nonempty_bounded(scope, label, MAX_MODEL_IDENTIFIER_BYTES)?;
    }
    scopes.sort();
    scopes.dedup();
    Ok(())
}

fn endpoint_node_id(endpoint: &NarrativeEndpoint) -> Option<&str> {
    match endpoint {
        NarrativeEndpoint::Node { node_id } => Some(node_id),
        NarrativeEndpoint::Anchor { .. } => None,
    }
}

pub fn compile_narrative_graph(
    mut definition: NarrativeGraphDefinition,
) -> EngineResult<CompiledNarrativeGraph> {
    if definition.schema != NARRATIVE_GRAPH_SCHEMA {
        return Err(error(format!(
            "unsupported narrative graph schema {}; expected {NARRATIVE_GRAPH_SCHEMA}",
            definition.schema
        )));
    }
    nonempty_bounded(
        &definition.id,
        "narrative graph id",
        MAX_MODEL_IDENTIFIER_BYTES,
    )?;
    nonempty_bounded(
        &definition.revision.reason,
        "narrative graph revision reason",
        MAX_NARRATIVE_STRING_BYTES,
    )?;
    if definition.revision.number == 0 && definition.revision.previous_graph_hash.is_some() {
        return Err(error(
            "narrative graph revision 0 cannot name a previous graph hash",
        ));
    }
    if definition.revision.number > 0 && definition.revision.previous_graph_hash.is_none() {
        return Err(error(
            "nonzero narrative graph revision requires previous_graph_hash",
        ));
    }
    if definition.nodes.len() > MAX_NARRATIVE_NODES
        || definition.edges.len() > MAX_NARRATIVE_EDGES
        || definition.roots.len() > MAX_NARRATIVE_ROOTS
    {
        return Err(error("narrative graph exceeds a node, edge, or root limit"));
    }
    definition.nodes.sort_by(|a, b| a.id.cmp(&b.id));
    definition.edges.sort_by(|a, b| a.id.cmp(&b.id));
    let mut nodes = BTreeMap::new();
    for mut node in definition.nodes.drain(..) {
        nonempty_bounded(&node.id, "narrative node id", MAX_MODEL_IDENTIFIER_BYTES)?;
        nonempty_bounded(
            &node.node_type,
            "narrative node type",
            MAX_MODEL_IDENTIFIER_BYTES,
        )?;
        nonempty_bounded(
            &node.epistemic_status,
            "narrative epistemic status",
            MAX_MODEL_IDENTIFIER_BYTES,
        )?;
        if node.text.len() > MAX_NARRATIVE_TEXT_BYTES {
            return Err(error(format!(
                "narrative node {} text exceeds {MAX_NARRATIVE_TEXT_BYTES} bytes",
                node.id
            )));
        }
        if !node.text.is_empty() && (node.provenance.is_empty() || node.authority.is_none()) {
            return Err(error(format!(
                "content-bearing narrative node {} requires provenance and authority",
                node.id
            )));
        }
        if let Some(title) = &node.title {
            if title.len() > MAX_NARRATIVE_STRING_BYTES {
                return Err(error(format!(
                    "narrative node {} title is too long",
                    node.id
                )));
            }
        }
        if let Some(summary) = &node.summary {
            if summary.len() > MAX_NARRATIVE_STRING_BYTES {
                return Err(error(format!(
                    "narrative node {} summary is too long",
                    node.id
                )));
            }
        }
        if let Some(holder) = &node.holder {
            nonempty_bounded(holder, "narrative node holder", MAX_MODEL_IDENTIFIER_BYTES)?;
        }
        for (label, value) in [
            ("narrative node subject", node.subject.as_deref()),
            ("narrative node estimator", node.estimator.as_deref()),
        ] {
            if let Some(value) = value {
                nonempty_bounded(value, label, MAX_MODEL_IDENTIFIER_BYTES)?;
            }
        }
        if node.value_time.is_some_and(|value| !value.is_finite())
            || node.evidence_cutoff.is_some_and(|value| !value.is_finite())
        {
            return Err(error(format!(
                "narrative node {} has non-finite time metadata",
                node.id
            )));
        }
        validate_uncertainty(
            &node.uncertainty,
            &format!("narrative node {} uncertainty", node.id),
        )?;
        if let Some(authority) = &node.authority {
            nonempty_bounded(
                &authority.source,
                "narrative node authority source",
                MAX_MODEL_IDENTIFIER_BYTES,
            )?;
            if !authority.weight.is_finite() || !(0.0..=1.0).contains(&authority.weight) {
                return Err(error(format!(
                    "narrative node {} authority weight must be in [0,1]",
                    node.id
                )));
            }
        }
        if matches!(node.role, NarrativeNodeRole::ExternalizedReflection) && node.holder.is_none() {
            return Err(error(format!(
                "externalized reflection node {} requires an explicit holder",
                node.id
            )));
        }
        if matches!(node.role, NarrativeNodeRole::ExternalizedReflection)
            && node.access_scopes.is_empty()
        {
            return Err(error(format!(
                "externalized reflection node {} requires an explicit access scope",
                node.id
            )));
        }
        if matches!(node.role, NarrativeNodeRole::ExternalizedReflection)
            && node.render == NarrativeInclusionPolicy::Include
        {
            return Err(error(format!(
                "externalized reflection node {} cannot render into the story projection",
                node.id
            )));
        }
        if let Some(interval) = &node.interval {
            if !interval.start.is_finite()
                || !interval.end.is_finite()
                || interval.end < interval.start
            {
                return Err(error(format!(
                    "narrative node {} has an invalid interval",
                    node.id
                )));
            }
        }
        validate_scopes(&mut node.access_scopes, "narrative node access scope")?;
        if nodes.insert(node.id.clone(), node).is_some() {
            return Err(error("narrative graph contains a duplicate node id"));
        }
    }
    definition.nodes = nodes.values().cloned().collect();
    let mut roots = BTreeSet::new();
    for root in &definition.roots {
        if !nodes.contains_key(root) {
            return Err(error(format!("narrative root names unknown node {root}")));
        }
        if !roots.insert(root.clone()) {
            return Err(error(format!("narrative root {root} is duplicated")));
        }
    }
    let mut edge_ids = BTreeSet::new();
    let mut contains_orders = BTreeSet::new();
    let mut structural_edges = Vec::new();
    for edge in &mut definition.edges {
        nonempty_bounded(&edge.id, "narrative edge id", MAX_MODEL_IDENTIFIER_BYTES)?;
        nonempty_bounded(
            &edge.relation,
            "narrative edge relation",
            MAX_MODEL_IDENTIFIER_BYTES,
        )?;
        if !edge_ids.insert(edge.id.clone()) {
            return Err(error("narrative graph contains a duplicate edge id"));
        }
        if edge.relation == "relates" {
            return Err(error(format!(
                "narrative edge {} must use a specific relation instead of relates",
                edge.id
            )));
        }
        if matches!(edge.family, NarrativeEdgeFamily::Structural)
            != matches!(edge.relation.as_str(), "contains" | "next")
        {
            return Err(error(format!(
                "narrative edge {} must pair the structural family exactly with contains or next",
                edge.id
            )));
        }
        for endpoint in [&edge.source, &edge.target] {
            match endpoint {
                NarrativeEndpoint::Node { node_id } => {
                    if !nodes.contains_key(node_id) {
                        return Err(error(format!(
                            "narrative edge {} names unknown node {node_id}",
                            edge.id
                        )));
                    }
                }
                NarrativeEndpoint::Anchor {
                    anchor_id, path, ..
                } => {
                    nonempty_bounded(anchor_id, "narrative anchor id", MAX_MODEL_IDENTIFIER_BYTES)?;
                    if let Some(path) = path {
                        if !path.starts_with('/') || path.len() > MAX_NARRATIVE_STRING_BYTES {
                            return Err(error(format!(
                                "narrative edge {} anchor path must be a bounded RFC 6901 JSON Pointer",
                                edge.id
                            )));
                        }
                    }
                }
            }
        }
        if edge.relation == "contains" || edge.relation == "next" {
            let Some(source) = endpoint_node_id(&edge.source) else {
                return Err(error(format!(
                    "structural narrative edge {} must connect nodes",
                    edge.id
                )));
            };
            let Some(target) = endpoint_node_id(&edge.target) else {
                return Err(error(format!(
                    "structural narrative edge {} must connect nodes",
                    edge.id
                )));
            };
            structural_edges.push((source.to_owned(), target.to_owned(), edge.relation.clone()));
            if edge.relation == "contains" {
                let order = edge
                    .order
                    .ok_or_else(|| error(format!("contains edge {} requires an order", edge.id)))?;
                if !contains_orders.insert((source.to_owned(), order)) {
                    return Err(error(format!(
                        "contains siblings under {source} reuse order {order}"
                    )));
                }
            }
        }
        if let Some(explanation) = &edge.explanation {
            if explanation.len() > MAX_NARRATIVE_STRING_BYTES {
                return Err(error(format!(
                    "narrative edge {} explanation is too long",
                    edge.id
                )));
            }
        }
        validate_scopes(&mut edge.access_scopes, "narrative edge access scope")?;
        if edge.provenance.is_empty() {
            return Err(error(format!(
                "narrative edge {} requires provenance",
                edge.id
            )));
        }
    }
    validate_structural_acyclicity(nodes.keys(), &structural_edges)?;
    validate_component_grounding(&definition, nodes.keys())?;
    let graph_hash = hash_serializable(&definition)?;
    Ok(CompiledNarrativeGraph {
        graph_hash,
        definition,
        nodes,
    })
}

pub(crate) fn build_narrative_graph_delta(
    previous: &NarrativeGraphDefinition,
    successor: &NarrativeGraphDefinition,
) -> NarrativeGraphDelta {
    let mut root_operations = Vec::new();
    let mut roots = previous.roots.clone();
    for node_id in previous
        .roots
        .iter()
        .filter(|node_id| !successor.roots.contains(node_id))
    {
        root_operations.push(NarrativeRootPatchOperation::Remove {
            node_id: node_id.clone(),
        });
        roots.retain(|existing| existing != node_id);
    }
    for (index, node_id) in successor.roots.iter().enumerate() {
        match roots.iter().position(|existing| existing == node_id) {
            None => {
                root_operations.push(NarrativeRootPatchOperation::Insert {
                    index,
                    node_id: node_id.clone(),
                });
                roots.insert(index, node_id.clone());
            }
            Some(current) if current != index => {
                root_operations.push(NarrativeRootPatchOperation::Move {
                    node_id: node_id.clone(),
                    index,
                });
                let moved = roots.remove(current);
                roots.insert(index, moved);
            }
            Some(_) => {}
        }
    }

    let mut node_operations = Vec::new();
    let successor_node_ids: BTreeSet<&str> = successor
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect();
    let mut nodes = previous.nodes.clone();
    for node_id in previous
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .filter(|node_id| !successor_node_ids.contains(node_id))
    {
        node_operations.push(NarrativeNodePatchOperation::Remove {
            node_id: node_id.to_owned(),
        });
        nodes.retain(|node| node.id != node_id);
    }
    for (index, target) in successor.nodes.iter().enumerate() {
        match nodes.iter().position(|node| node.id == target.id) {
            None => {
                node_operations.push(NarrativeNodePatchOperation::Insert {
                    index,
                    node: target.clone(),
                });
                nodes.insert(index, target.clone());
            }
            Some(current) => {
                if current != index {
                    node_operations.push(NarrativeNodePatchOperation::Move {
                        node_id: target.id.clone(),
                        index,
                    });
                    let moved = nodes.remove(current);
                    nodes.insert(index, moved);
                }
                if nodes[index] != *target {
                    node_operations.push(NarrativeNodePatchOperation::Replace {
                        node: target.clone(),
                    });
                    nodes[index] = target.clone();
                }
            }
        }
    }

    let mut edge_operations = Vec::new();
    let successor_edge_ids: BTreeSet<&str> = successor
        .edges
        .iter()
        .map(|edge| edge.id.as_str())
        .collect();
    let mut edges = previous.edges.clone();
    for edge_id in previous
        .edges
        .iter()
        .map(|edge| edge.id.as_str())
        .filter(|edge_id| !successor_edge_ids.contains(edge_id))
    {
        edge_operations.push(NarrativeEdgePatchOperation::Remove {
            edge_id: edge_id.to_owned(),
        });
        edges.retain(|edge| edge.id != edge_id);
    }
    for (index, target) in successor.edges.iter().enumerate() {
        match edges.iter().position(|edge| edge.id == target.id) {
            None => {
                edge_operations.push(NarrativeEdgePatchOperation::Insert {
                    index,
                    edge: target.clone(),
                });
                edges.insert(index, target.clone());
            }
            Some(current) => {
                if current != index {
                    edge_operations.push(NarrativeEdgePatchOperation::Move {
                        edge_id: target.id.clone(),
                        index,
                    });
                    let moved = edges.remove(current);
                    edges.insert(index, moved);
                }
                if edges[index] != *target {
                    edge_operations.push(NarrativeEdgePatchOperation::Replace {
                        edge: target.clone(),
                    });
                    edges[index] = target.clone();
                }
            }
        }
    }

    debug_assert_eq!(roots, successor.roots);
    debug_assert_eq!(nodes, successor.nodes);
    debug_assert_eq!(edges, successor.edges);
    NarrativeGraphDelta {
        root_operations,
        node_operations,
        edge_operations,
    }
}

fn checked_insert_index(index: usize, len: usize, label: &str) -> EngineResult<()> {
    if index > len {
        return Err(error(format!(
            "narrative {label} patch insertion index {index} exceeds length {len}"
        )));
    }
    Ok(())
}

pub(crate) fn apply_narrative_revision_record(
    previous: Option<&NarrativeGraphDefinition>,
    record: &StoredNarrativeRevision,
) -> EngineResult<NarrativeGraphDefinition> {
    if record.schema != NARRATIVE_REVISION_STORE_SCHEMA {
        return Err(error(format!(
            "unsupported narrative revision record schema {}; expected {NARRATIVE_REVISION_STORE_SCHEMA}",
            record.schema
        )));
    }
    let (mut roots, mut nodes, mut edges) = match (&record.payload, previous) {
        (
            NarrativeRevisionPayload::Root {
                roots,
                nodes,
                edges,
            },
            None,
        ) => {
            if record.revision.number != 0 || record.revision.previous_graph_hash.is_some() {
                return Err(error("narrative root record has invalid revision metadata"));
            }
            (roots.clone(), nodes.clone(), edges.clone())
        }
        (NarrativeRevisionPayload::Delta { delta }, Some(previous)) => {
            if record.revision.number == 0 || record.revision.previous_graph_hash.is_none() {
                return Err(error(
                    "narrative delta record has invalid revision metadata",
                ));
            }
            let mut roots = previous.roots.clone();
            let mut nodes = previous.nodes.clone();
            let mut edges = previous.edges.clone();
            for operation in &delta.root_operations {
                match operation {
                    NarrativeRootPatchOperation::Insert { index, node_id } => {
                        checked_insert_index(*index, roots.len(), "root")?;
                        if roots.contains(node_id) {
                            return Err(error("narrative root patch inserts an existing root"));
                        }
                        roots.insert(*index, node_id.clone());
                    }
                    NarrativeRootPatchOperation::Remove { node_id } => {
                        let index = roots
                            .iter()
                            .position(|existing| existing == node_id)
                            .ok_or_else(|| error("narrative root patch removes an unknown root"))?;
                        roots.remove(index);
                    }
                    NarrativeRootPatchOperation::Move { node_id, index } => {
                        let current = roots
                            .iter()
                            .position(|existing| existing == node_id)
                            .ok_or_else(|| error("narrative root patch moves an unknown root"))?;
                        let moved = roots.remove(current);
                        checked_insert_index(*index, roots.len(), "root move")?;
                        roots.insert(*index, moved);
                    }
                }
            }
            for operation in &delta.node_operations {
                match operation {
                    NarrativeNodePatchOperation::Insert { index, node } => {
                        checked_insert_index(*index, nodes.len(), "node")?;
                        if nodes.iter().any(|existing| existing.id == node.id) {
                            return Err(error("narrative node patch inserts an existing node"));
                        }
                        nodes.insert(*index, node.clone());
                    }
                    NarrativeNodePatchOperation::Replace { node } => {
                        let current = nodes
                            .iter()
                            .position(|existing| existing.id == node.id)
                            .ok_or_else(|| {
                                error("narrative node patch replaces an unknown node")
                            })?;
                        nodes[current] = node.clone();
                    }
                    NarrativeNodePatchOperation::Remove { node_id } => {
                        let current = nodes
                            .iter()
                            .position(|existing| existing.id == *node_id)
                            .ok_or_else(|| error("narrative node patch removes an unknown node"))?;
                        nodes.remove(current);
                    }
                    NarrativeNodePatchOperation::Move { node_id, index } => {
                        let current = nodes
                            .iter()
                            .position(|existing| existing.id == *node_id)
                            .ok_or_else(|| error("narrative node patch moves an unknown node"))?;
                        let moved = nodes.remove(current);
                        checked_insert_index(*index, nodes.len(), "node move")?;
                        nodes.insert(*index, moved);
                    }
                }
            }
            for operation in &delta.edge_operations {
                match operation {
                    NarrativeEdgePatchOperation::Insert { index, edge } => {
                        checked_insert_index(*index, edges.len(), "edge")?;
                        if edges.iter().any(|existing| existing.id == edge.id) {
                            return Err(error("narrative edge patch inserts an existing edge"));
                        }
                        edges.insert(*index, edge.clone());
                    }
                    NarrativeEdgePatchOperation::Replace { edge } => {
                        let current = edges
                            .iter()
                            .position(|existing| existing.id == edge.id)
                            .ok_or_else(|| {
                                error("narrative edge patch replaces an unknown edge")
                            })?;
                        edges[current] = edge.clone();
                    }
                    NarrativeEdgePatchOperation::Remove { edge_id } => {
                        let current = edges
                            .iter()
                            .position(|existing| existing.id == *edge_id)
                            .ok_or_else(|| error("narrative edge patch removes an unknown edge"))?;
                        edges.remove(current);
                    }
                    NarrativeEdgePatchOperation::Move { edge_id, index } => {
                        let current = edges
                            .iter()
                            .position(|existing| existing.id == *edge_id)
                            .ok_or_else(|| error("narrative edge patch moves an unknown edge"))?;
                        let moved = edges.remove(current);
                        checked_insert_index(*index, edges.len(), "edge move")?;
                        edges.insert(*index, moved);
                    }
                }
            }
            (roots, nodes, edges)
        }
        (NarrativeRevisionPayload::Root { .. }, Some(_)) => {
            return Err(error("non-root narrative revision stores a root payload"));
        }
        (NarrativeRevisionPayload::Delta { .. }, None) => {
            return Err(error("narrative root revision stores a delta payload"));
        }
    };
    Ok(NarrativeGraphDefinition {
        schema: record.graph_schema.clone(),
        id: record.graph_id.clone(),
        revision: record.revision.clone(),
        source: record.source.clone(),
        roots: std::mem::take(&mut roots),
        nodes: std::mem::take(&mut nodes),
        edges: std::mem::take(&mut edges),
    })
}

pub(crate) fn validate_narrative_insertion_order(
    record: &StoredNarrativeRevision,
    materialized: &NarrativeGraphDefinition,
) -> EngineResult<()> {
    fn unique(values: &[String]) -> bool {
        values.iter().collect::<BTreeSet<_>>().len() == values.len()
    }
    let order = &record.insertion_order;
    if !unique(&order.root_ids) || !unique(&order.node_ids) || !unique(&order.edge_ids) {
        return Err(error(
            "narrative insertion-order provenance contains duplicate identifiers",
        ));
    }
    match order.scope {
        NarrativeInsertionScope::FullDefinition => {
            let materialized_roots: BTreeSet<&str> =
                materialized.roots.iter().map(String::as_str).collect();
            let materialized_nodes: BTreeSet<&str> = materialized
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect();
            let materialized_edges: BTreeSet<&str> = materialized
                .edges
                .iter()
                .map(|edge| edge.id.as_str())
                .collect();
            if order
                .root_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                != materialized_roots
                || order
                    .node_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>()
                    != materialized_nodes
                || order
                    .edge_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>()
                    != materialized_edges
            {
                return Err(error(
                    "full-definition insertion provenance does not name exactly the materialized graph records",
                ));
            }
        }
        NarrativeInsertionScope::AdditiveBatch => {
            let NarrativeRevisionPayload::Delta { delta } = &record.payload else {
                return Err(error(
                    "additive insertion provenance requires a narrative delta payload",
                ));
            };
            let added_roots: Vec<&str> = delta
                .root_operations
                .iter()
                .filter_map(|operation| match operation {
                    NarrativeRootPatchOperation::Insert { node_id, .. } => Some(node_id.as_str()),
                    _ => None,
                })
                .collect();
            let added_nodes: Vec<&str> = delta
                .node_operations
                .iter()
                .filter_map(|operation| match operation {
                    NarrativeNodePatchOperation::Insert { node, .. } => Some(node.id.as_str()),
                    _ => None,
                })
                .collect();
            let added_edges: Vec<&str> = delta
                .edge_operations
                .iter()
                .filter_map(|operation| match operation {
                    NarrativeEdgePatchOperation::Insert { edge, .. } => Some(edge.id.as_str()),
                    _ => None,
                })
                .collect();
            if order
                .root_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                != added_roots.into_iter().collect()
                || order
                    .node_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>()
                    != added_nodes.into_iter().collect()
                || order
                    .edge_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>()
                    != added_edges.into_iter().collect()
            {
                return Err(error(
                    "additive insertion provenance does not name exactly the inserted delta records",
                ));
            }
        }
    }
    Ok(())
}

pub fn validate_narrative_batch(
    batch: &mut NarrativeGraphBatch,
    previous: &NarrativeGraphDefinition,
) -> EngineResult<()> {
    if batch.schema != NARRATIVE_BATCH_SCHEMA {
        return Err(error(format!(
            "unsupported narrative batch schema {}; expected {NARRATIVE_BATCH_SCHEMA}",
            batch.schema
        )));
    }
    nonempty_bounded(
        &batch.previous_graph_hash,
        "narrative batch previous graph hash",
        MAX_MODEL_IDENTIFIER_BYTES,
    )?;
    nonempty_bounded(
        &batch.reason,
        "narrative batch reason",
        MAX_NARRATIVE_STRING_BYTES,
    )?;
    if batch.provenance.is_empty() {
        return Err(error("narrative batch requires provenance"));
    }
    for item in &batch.provenance {
        nonempty_bounded(
            item,
            "narrative batch provenance",
            MAX_NARRATIVE_STRING_BYTES,
        )?;
    }
    if batch.add_roots.is_empty() && batch.add_nodes.is_empty() && batch.add_edges.is_empty() {
        return Err(error("narrative batch must add a root, node, or edge"));
    }
    if batch.add_roots.len() > MAX_NARRATIVE_ROOTS
        || batch.add_nodes.len() > MAX_NARRATIVE_NODES
        || batch.add_edges.len() > MAX_NARRATIVE_EDGES
    {
        return Err(error("narrative batch exceeds a root, node, or edge limit"));
    }
    let mut added_roots = BTreeSet::new();
    for root in &batch.add_roots {
        if !added_roots.insert(root.clone()) {
            return Err(error(format!("narrative batch root {root} is duplicated")));
        }
    }

    let existing: BTreeSet<String> = previous.nodes.iter().map(|node| node.id.clone()).collect();
    let mut added = BTreeSet::new();
    for node in &batch.add_nodes {
        if existing.contains(&node.id) || !added.insert(node.id.clone()) {
            return Err(error(format!(
                "narrative batch node {} collides with an existing or added node",
                node.id
            )));
        }
    }
    let existing_edges: BTreeSet<String> =
        previous.edges.iter().map(|edge| edge.id.clone()).collect();
    let mut added_edges = BTreeSet::new();
    for edge in &batch.add_edges {
        if existing_edges.contains(&edge.id) || !added_edges.insert(edge.id.clone()) {
            return Err(error(format!(
                "narrative batch edge {} collides with an existing or added edge",
                edge.id
            )));
        }
    }
    for root in &batch.add_roots {
        if !existing.contains(root) && !added.contains(root) {
            return Err(error(format!(
                "narrative batch root names unknown node {root}"
            )));
        }
        if !existing.is_empty() && !added.contains(root) {
            return Err(error(format!(
                "narrative batch can only add a newly added node as root; {root} already exists"
            )));
        }
    }
    if added.is_empty() {
        return Ok(());
    }

    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    let mut bridged = BTreeSet::new();
    for edge in &batch.add_edges {
        let source = endpoint_node_id(&edge.source);
        let target = endpoint_node_id(&edge.target);
        match (source, target) {
            (Some(source), Some(target)) if added.contains(source) && added.contains(target) => {
                adjacency
                    .entry(source.to_owned())
                    .or_default()
                    .push(target.to_owned());
                adjacency
                    .entry(target.to_owned())
                    .or_default()
                    .push(source.to_owned());
            }
            (Some(source), Some(target)) => {
                if added.contains(source) && existing.contains(target) {
                    bridged.insert(source.to_owned());
                }
                if added.contains(target) && existing.contains(source) {
                    bridged.insert(target.to_owned());
                }
            }
            (Some(node), None) | (None, Some(node)) if added.contains(node) => {
                bridged.insert(node.to_owned());
            }
            _ => {}
        }
    }
    let initial_roots: BTreeSet<String> = if existing.is_empty() {
        batch.add_roots.iter().cloned().collect()
    } else {
        BTreeSet::new()
    };
    let mut visited = BTreeSet::new();
    for start in &added {
        if visited.contains(start) {
            continue;
        }
        let mut component = BTreeSet::new();
        let mut queue = VecDeque::from([start.clone()]);
        visited.insert(start.clone());
        while let Some(node) = queue.pop_front() {
            component.insert(node.clone());
            for neighbor in adjacency.get(&node).into_iter().flatten() {
                if visited.insert(neighbor.clone()) {
                    queue.push_back(neighbor.clone());
                }
            }
        }
        if !component
            .iter()
            .any(|node| bridged.contains(node) || initial_roots.contains(node))
        {
            return Err(error(format!(
                "narrative batch would create an unconnected new-node component beginning at {}; connect it to an existing node or stable anchor in the same batch{}",
                start,
                if existing.is_empty() {
                    ", or declare its first node as a root"
                } else {
                    ""
                }
            )));
        }
    }
    Ok(())
}

fn validate_component_grounding<'a>(
    definition: &NarrativeGraphDefinition,
    node_ids: impl Iterator<Item = &'a String>,
) -> EngineResult<()> {
    let nodes: BTreeSet<String> = node_ids.cloned().collect();
    let roots: BTreeSet<&str> = definition.roots.iter().map(String::as_str).collect();
    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    let mut externally_anchored = BTreeSet::new();
    for edge in &definition.edges {
        let source = endpoint_node_id(&edge.source);
        let target = endpoint_node_id(&edge.target);
        match (source, target) {
            (Some(source), Some(target)) => {
                adjacency
                    .entry(source.to_owned())
                    .or_default()
                    .push(target.to_owned());
                adjacency
                    .entry(target.to_owned())
                    .or_default()
                    .push(source.to_owned());
            }
            (Some(node), None) | (None, Some(node)) => {
                externally_anchored.insert(node.to_owned());
            }
            (None, None) => {}
        }
    }
    let mut visited = BTreeSet::new();
    for start in &nodes {
        if !visited.insert(start.clone()) {
            continue;
        }
        let mut grounded = roots.contains(start.as_str()) || externally_anchored.contains(start);
        let mut queue = VecDeque::from([start.clone()]);
        while let Some(node) = queue.pop_front() {
            grounded |= roots.contains(node.as_str()) || externally_anchored.contains(&node);
            for neighbor in adjacency.get(&node).into_iter().flatten() {
                if visited.insert(neighbor.clone()) {
                    queue.push_back(neighbor.clone());
                }
            }
        }
        if !grounded {
            return Err(error(format!(
                "narrative node component beginning at {start} must reach a declared root or stable anchor"
            )));
        }
    }
    Ok(())
}

fn validate_structural_acyclicity<'a>(
    node_ids: impl Iterator<Item = &'a String>,
    edges: &[(String, String, String)],
) -> EngineResult<()> {
    let mut indegree: BTreeMap<String, usize> = node_ids.map(|id| (id.clone(), 0)).collect();
    let mut outgoing: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (source, target, _) in edges {
        *indegree
            .get_mut(target)
            .expect("structural target was validated") += 1;
        outgoing
            .entry(source.clone())
            .or_default()
            .push(target.clone());
    }
    let mut queue: VecDeque<String> = indegree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(id, _)| id.clone())
        .collect();
    let mut visited = 0usize;
    while let Some(id) = queue.pop_front() {
        visited += 1;
        for target in outgoing.get(&id).into_iter().flatten() {
            let degree = indegree.get_mut(target).expect("known structural target");
            *degree -= 1;
            if *degree == 0 {
                queue.push_back(target.clone());
            }
        }
    }
    if visited != indegree.len() {
        return Err(error("narrative contains/next structure must be acyclic"));
    }
    Ok(())
}

pub fn node_is_visible(node: &NarrativeNode, access_scopes: &[String]) -> bool {
    node.access_scopes.is_empty()
        || node
            .access_scopes
            .iter()
            .any(|scope| access_scopes.contains(scope))
}

pub fn validate_narrative_access_scopes(scopes: &mut Vec<String>) -> EngineResult<()> {
    validate_scopes(scopes, "narrative query access scope")
}

pub fn validate_expected_graph_hash(expected: &Option<String>, actual: &str) -> EngineResult<()> {
    if expected.as_deref().is_some_and(|value| value != actual) {
        return Err(error(format!(
            "narrative graph changed: expected {}, found {actual}",
            expected.as_deref().unwrap_or_default()
        )));
    }
    Ok(())
}

pub fn narrative_graph_summary(
    graph: &CompiledNarrativeGraph,
    snapshot: &NarrativeSourceSnapshot,
) -> serde_json::Value {
    let roles =
        graph
            .definition
            .nodes
            .iter()
            .fold(BTreeMap::<String, usize>::new(), |mut counts, node| {
                let role = serde_json::to_value(node.role)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| "unknown".to_owned());
                *counts.entry(role).or_default() += 1;
                counts
            });
    serde_json::json!({
        "schema": NARRATIVE_GRAPH_SCHEMA,
        "graph_hash": graph.graph_hash,
        "id": graph.definition.id,
        "revision": graph.definition.revision,
        "source": graph.definition.source,
        "source_snapshot": {
            "model_hash": snapshot.model_hash,
            "model_revision": snapshot.model_revision,
            "source_kind": snapshot.source_kind,
            "source_hash": snapshot.source_hash,
            "world_id": snapshot.world_id,
            "world_version": snapshot.world_version,
            "time": snapshot.time,
            "candidate_status": snapshot.candidate_status,
        },
        "root_count": graph.definition.roots.len(),
        "node_count": graph.definition.nodes.len(),
        "edge_count": graph.definition.edges.len(),
        "roles": roles,
    })
}
