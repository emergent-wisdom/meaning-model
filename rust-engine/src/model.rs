use super::{
    build_parent, compile_profiles, error, finite, hash_serializable, CompiledRegistry,
    CouplingMode, EngineResult, ErrorBody, ParentState, PathSpec, ProfileCompilationRequest,
    RegistryDefinition, ResponseEnvelope, PROFILE_COMPILATION_SCHEMA,
};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "meaning.rs"]
mod meaning;
pub use meaning::*;

#[path = "narrative.rs"]
mod narrative;
pub use narrative::*;

pub const MODEL_SCHEMA: &str = "life-sim-rust-model/v1";
pub const MODEL_QUERY_SCHEMA: &str = "life-sim-rust-model-query/v1";
pub const WORLD_HEAD_SCHEMA: &str = "life-sim-rust-world-head/v1";
pub const WORLD_REVISION_SCHEMA: &str = "life-sim-rust-world-revision/v1";
pub const MODEL_CANDIDATE_SCHEMA: &str = "life-sim-rust-model-candidate/v1";
pub const MODEL_PATH_SCHEMA: &str = "life-sim-rust-model-path/v1";
pub const MODEL_VIEW_SCHEMA: &str = "life-sim-rust-view/v1";
pub const MODEL_GRAPH_SCHEMA: &str = "life-sim-rust-graph/v1";
pub const TRAJECTORY_SUMMARY_QUERY_SCHEMA: &str = "life-sim-rust-trajectory-summary-query/v1";
pub const TRAJECTORY_SUMMARY_SCHEMA: &str = "life-sim-rust-trajectory-summary/v1";
pub const SESSION_STATE_SCHEMA: &str = "life-sim-rust-session-state/v2";
pub const PROJECT_DOCUMENT_SCHEMA: &str = "life-sim-rust-project-document/v1";
pub const PROJECT_CHECKPOINT_SCHEMA: &str = "life-sim-rust-project-checkpoint/v1";
pub const PROJECT_CHECKPOINT_LIST_SCHEMA: &str = "life-sim-rust-project-checkpoint-list/v1";
pub const PROJECT_CHECKPOINT_RENDER_SCHEMA: &str = "life-sim-rust-project-checkpoint-render/v1";
pub const PROJECT_CHECKPOINT_EXPORT_SCHEMA: &str = "life-sim-rust-project-checkpoint-export/v1";
const PROJECT_GRAPH_SNAPSHOT_IDENTITY_SCHEMA: &str =
    "life-sim-rust-project-graph-snapshot-identity/v1";
const RANDOM_SCHEDULE_SCHEMA: &str = "life-sim-rust-random-schedule/v1";

const MAX_STEP_COUNT: usize = 1_000_000;
const MAX_LAW_PROCESS_EVALUATIONS: usize = 50_000_000;
const MAX_RETAINED_STATE_BYTES: usize = 16 * 1024 * 1024;
const MAX_POTENTIAL_ACTIVITY_RECORDS: usize = 250_000;
const MAX_POTENTIAL_ACTIVITY_BYTES: usize = 64 * 1024 * 1024;
const MAX_STATE_BYTE_STEPS: usize = 1024 * 1024 * 1024;
const MAX_EXPRESSION_DEPTH: usize = 96;
const MAX_MODEL_EXPRESSION_NODES: usize = 250_000;
const MAX_QUERY_DURATION: f64 = 30.0;
const MAX_QUERY_INTERVENTIONS: usize = 1_000;
const MAX_QUERY_OBSERVATIONS: usize = 1_000;
const MAX_OBSERVATION_PROVENANCE: usize = 64;
const MAX_QUERY_SUPPORT: usize = 2_048;
const MAX_QUERY_OBSERVABLES: usize = 2_048;
const MAX_QUERY_ACCESS_SCOPES: usize = 64;
const MAX_QUERY_STRING_BYTES: usize = 1_024;
const MAX_MODEL_IDENTIFIER_BYTES: usize = 1_024;
const MAX_MODEL_DEFINITION_BYTES: usize = 8 * 1024 * 1024;
const MAX_SESSION_MODELS: usize = 64;
const MAX_SESSION_WORLDS: usize = 64;
const MAX_SESSION_CANDIDATES: usize = 2_048;
const MAX_SESSION_WORLD_REVISIONS: usize = 2_048;
const MAX_SESSION_WORLD_REVISION_BYTES: usize = 64 * 1024 * 1024;
const MAX_SESSION_NARRATIVE_GRAPHS: usize = 512;
const MAX_SESSION_MODEL_BYTES: usize = 64 * 1024 * 1024;
const MAX_SESSION_WORLD_BYTES: usize = 64 * 1024 * 1024;
const MAX_SESSION_CANDIDATE_BYTES: usize = 128 * 1024 * 1024;
// Narrative history is stored as shared source snapshots plus append-only
// revision deltas. This bound applies to that compact durable representation,
// not to transient materialized graph views.
const MAX_SESSION_NARRATIVE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PROJECT_CHECKPOINTS: usize = 1_024;
const MAX_PROJECT_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_PROJECT_STORAGE_BYTES: usize = 256 * 1024 * 1024;
const MAX_PROJECT_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_SESSION_REPLAY_WORK: usize = 250_000_000;
const MAX_TRAJECTORY_SUMMARY_WORK: usize = 10_000_000;
const MAX_GRAPH_NEIGHBORHOOD_DEPTH: usize = 16;
const MAX_GRAPH_SKELETON_ROOTS: usize = 20;
const MAX_GRAPH_SKELETON_HUBS: usize = 12;
const MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW: usize = 128;

#[derive(Default)]
struct CountingWriter {
    bytes: usize,
}

impl Write for CountingWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes = self
            .bytes
            .checked_add(buffer.len())
            .ok_or_else(|| io::Error::other("serialized size overflow"))?;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn serialized_size(value: &impl Serialize) -> EngineResult<usize> {
    let mut writer = CountingWriter::default();
    serde_json::to_writer(&mut writer, value)
        .map_err(|cause| error(format!("failed to estimate serialized size: {cause}")))?;
    Ok(writer.bytes)
}

fn serialized_sum<'a, T: Serialize + 'a>(
    mut values: impl Iterator<Item = &'a T>,
) -> EngineResult<usize> {
    values.try_fold(0usize, |total, value| {
        total
            .checked_add(serialized_size(value)?)
            .ok_or_else(|| error("aggregate serialized size overflow"))
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NumericBounds {
    pub minimum: f64,
    pub maximum: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProcessType {
    Scalar {
        bounds: NumericBounds,
    },
    Vector {
        dimensions: usize,
        bounds: NumericBounds,
    },
    Category {
        variants: Vec<String>,
    },
    Distribution {
        outcomes: Vec<String>,
    },
    Graph,
    ObjectPose {
        position_dimensions: usize,
        orientation_dimensions: usize,
    },
    Regime {
        variants: Vec<String>,
    },
}

impl ProcessType {
    fn name(&self) -> &'static str {
        match self {
            Self::Scalar { .. } => "scalar",
            Self::Vector { .. } => "vector",
            Self::Category { .. } => "category",
            Self::Distribution { .. } => "distribution",
            Self::Graph => "graph",
            Self::ObjectPose { .. } => "object_pose",
            Self::Regime { .. } => "regime",
        }
    }

    fn scalar_bounds(&self) -> Option<&NumericBounds> {
        match self {
            Self::Scalar { bounds } => Some(bounds),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GraphEdgeValue {
    pub source: String,
    pub target: String,
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GraphValue {
    pub nodes: Vec<String>,
    pub edges: Vec<GraphEdgeValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ObjectPoseValue {
    pub position: Vec<f64>,
    pub orientation: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum ProcessValue {
    Scalar(f64),
    Vector(Vec<f64>),
    Category(String),
    Distribution(Vec<f64>),
    Graph(GraphValue),
    ObjectPose(ObjectPoseValue),
    Regime(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AxisDefinition {
    pub id: String,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProcessDefinition {
    pub id: String,
    pub value_type: ProcessType,
    pub initial_value: ProcessValue,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub axes: Vec<AxisDefinition>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub reference_frame: Option<String>,
    #[serde(default)]
    pub scale: BTreeMap<String, String>,
    #[serde(default)]
    pub support: Vec<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    #[serde(default)]
    pub update_mode: ProcessUpdateMode,
}

/// Declares why a process may intentionally have no executable law or
/// dependency. `Unspecified` is retained for backwards-compatible revision-zero
/// models; newly introduced revision fields must be wired or explicitly static
/// or observed.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessUpdateMode {
    #[default]
    Unspecified,
    Static,
    Observed,
}

/// Selects a schema-time lens for one edge in the acyclic decomposition DAG.
///
/// These kinds do not add numeric, causal, or world-time behavior. In
/// particular, `MembershipView` declares an available administrative grouping,
/// not changing group incidence; dynamic membership belongs in a time-indexed
/// process updated by a `Relation` law. Likewise, `TemporalPhase` declares a
/// possible phase decomposition, not the current phase, and
/// `FunctionalRefinement` does not implement partial-refinement reconciliation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecompositionKind {
    /// Legacy generic structural containment.
    Contains,
    /// Physical or material part-of decomposition.
    PhysicalPart,
    /// An available membership or administrative grouping view.
    MembershipView,
    /// Semantic classification from a broader type to a narrower subtype.
    SemanticSubtype,
    /// A possible temporal phase decomposition, independent of current state.
    TemporalPhase,
    /// Functional or process refinement into constituent work.
    FunctionalRefinement,
    /// An observational or analytic partition of the parent.
    ObservationalPartition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DecompositionEdge {
    pub id: String,
    pub parent: String,
    pub child: String,
    pub kind: DecompositionKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    Derives,
    Causes,
    Constrains,
    Observes,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DependencyEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: DependencyKind,
    #[serde(default)]
    pub law_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClaimUncertainty {
    Exact,
    StandardDeviation {
        value: f64,
    },
    Interval {
        lower: f64,
        upper: f64,
    },
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    Observation,
    Report,
    Belief,
    Estimate,
    Forecast,
    CreativeHypothesis,
    FictionalCanon,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaimMode {
    Observed,
    Estimated,
    Simulated,
    Derived,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClaimAuthority {
    pub source: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Claim {
    pub id: String,
    pub subject: String,
    pub value: ProcessValue,
    pub uncertainty: ClaimUncertainty,
    pub evidence_type: EvidenceType,
    pub holder: String,
    pub evidence_cutoff: f64,
    pub provenance: Vec<String>,
    pub authority: ClaimAuthority,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<ClaimMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_time: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub access_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClaimTemplate {
    pub id: String,
    pub subject: String,
    pub uncertainty: ClaimUncertainty,
    pub evidence_type: EvidenceType,
    pub holder: String,
    pub provenance: Vec<String>,
    pub authority: ClaimAuthority,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub access_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRevision {
    pub number: u64,
    #[serde(default)]
    pub previous_model_hash: Option<String>,
    pub reason: String,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScalarExpression {
    Constant {
        value: f64,
    },
    Process {
        process: String,
    },
    Time,
    Add {
        terms: Vec<ScalarExpression>,
    },
    Multiply {
        factors: Vec<ScalarExpression>,
    },
    Subtract {
        left: Box<ScalarExpression>,
        right: Box<ScalarExpression>,
    },
    Divide {
        numerator: Box<ScalarExpression>,
        denominator: Box<ScalarExpression>,
    },
    Negate {
        value: Box<ScalarExpression>,
    },
    Minimum {
        values: Vec<ScalarExpression>,
    },
    Maximum {
        values: Vec<ScalarExpression>,
    },
    Clamp {
        value: Box<ScalarExpression>,
        minimum: f64,
        maximum: f64,
    },
    Absolute {
        value: Box<ScalarExpression>,
    },
    Exponential {
        value: Box<ScalarExpression>,
    },
    Logistic {
        value: Box<ScalarExpression>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InnovationDistribution {
    Normal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct InnovationSpec {
    pub name: String,
    pub distribution: InnovationDistribution,
    pub scale: ScalarExpression,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Comparison {
    LessThan,
    LessOrEqual,
    GreaterThan,
    GreaterOrEqual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerFiring {
    OnEnter,
    WhileTrue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OccurrenceTrigger {
    Always,
    Threshold {
        expression: ScalarExpression,
        comparison: Comparison,
        threshold: f64,
        firing: TriggerFiring,
    },
    Hazard {
        rate: ScalarExpression,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EffectMode {
    Add,
    Set,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StateEffect {
    pub target: String,
    pub mode: EffectMode,
    pub value: ScalarExpression,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionDirection {
    Aggregate,
    Refine,
    Reconcile,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LawActivation {
    #[default]
    Always,
    Gated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "role", rename_all = "snake_case", deny_unknown_fields)]
pub enum LawOperator {
    Evolution {
        target: String,
        derivative: ScalarExpression,
        #[serde(default)]
        innovation: Option<InnovationSpec>,
    },
    Relation {
        target: String,
        value: ScalarExpression,
    },
    Occurrence {
        trigger: OccurrenceTrigger,
        #[serde(default)]
        effects: Vec<StateEffect>,
        #[serde(default)]
        activates: Vec<String>,
    },
    Epistemic {
        claim: ClaimTemplate,
        value: ScalarExpression,
    },
    Resolution {
        target: String,
        value: ScalarExpression,
        direction: ResolutionDirection,
    },
}

impl LawOperator {
    pub fn role_name(&self) -> &'static str {
        match self {
            Self::Evolution { .. } => "evolution",
            Self::Relation { .. } => "relation",
            Self::Occurrence { .. } => "occurrence",
            Self::Epistemic { .. } => "epistemic",
            Self::Resolution { .. } => "resolution",
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LawDefinition {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub activation: LawActivation,
    pub operator: LawOperator,
    #[serde(default)]
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelDefinition {
    pub schema: String,
    pub id: String,
    pub time_unit: String,
    pub revision: ModelRevision,
    pub processes: Vec<ProcessDefinition>,
    #[serde(default)]
    pub decomposition: Vec<DecompositionEdge>,
    #[serde(default)]
    pub dependencies: Vec<DependencyEdge>,
    #[serde(default)]
    pub laws: Vec<LawDefinition>,
    #[serde(default)]
    pub initial_claims: Vec<Claim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meaning_model: Option<MeaningModelDefinition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessSummary {
    pub id: String,
    pub value_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelSummary {
    pub schema: &'static str,
    pub model_hash: String,
    pub id: String,
    pub time_unit: String,
    pub revision: ModelRevision,
    pub process_count: usize,
    pub decomposition_edge_count: usize,
    pub dependency_edge_count: usize,
    pub law_count: usize,
    pub law_roles: BTreeMap<String, usize>,
    pub process_ids: Vec<String>,
    pub processes: Vec<ProcessSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meaning_model: Option<MeaningModelSummary>,
}

#[derive(Debug, Clone)]
pub struct CompiledModel {
    pub model_hash: String,
    pub id: String,
    pub time_unit: String,
    pub revision: ModelRevision,
    definition: ModelDefinition,
    processes: BTreeMap<String, ProcessDefinition>,
    laws: Vec<LawDefinition>,
    initial_claims: BTreeMap<String, Claim>,
    derived_order: Vec<usize>,
    expression_node_count: usize,
}

impl CompiledModel {
    pub fn summary(&self) -> ModelSummary {
        let mut roles = BTreeMap::new();
        for law in &self.laws {
            *roles
                .entry(law.operator.role_name().to_owned())
                .or_insert(0) += 1;
        }
        ModelSummary {
            schema: MODEL_SCHEMA,
            model_hash: self.model_hash.clone(),
            id: self.id.clone(),
            time_unit: self.time_unit.clone(),
            revision: self.revision.clone(),
            process_count: self.processes.len(),
            decomposition_edge_count: self.definition.decomposition.len(),
            dependency_edge_count: self.definition.dependencies.len(),
            law_count: self.laws.len(),
            law_roles: roles,
            process_ids: self.processes.keys().cloned().collect(),
            processes: self
                .processes
                .values()
                .map(|process| ProcessSummary {
                    id: process.id.clone(),
                    value_type: process.value_type.name().to_owned(),
                })
                .collect(),
            meaning_model: self
                .definition
                .meaning_model
                .as_ref()
                .map(MeaningModelDefinition::summary),
        }
    }

    pub fn definition(&self) -> &ModelDefinition {
        &self.definition
    }
}

pub fn compile_model(mut definition: ModelDefinition) -> EngineResult<CompiledModel> {
    if definition.schema != MODEL_SCHEMA {
        return Err(error(format!(
            "unsupported model schema {}; expected {MODEL_SCHEMA}",
            definition.schema
        )));
    }
    if definition.id.trim().is_empty() || definition.time_unit.trim().is_empty() {
        return Err(error("model id and time_unit must be nonempty"));
    }
    let definition_bytes = serialized_size(&definition)?;
    if definition_bytes > MAX_MODEL_DEFINITION_BYTES {
        return Err(error(format!(
            "model definition is {definition_bytes} bytes; limit is {MAX_MODEL_DEFINITION_BYTES}"
        )));
    }
    validate_revision(&definition.revision)?;
    if definition.processes.is_empty() {
        return Err(error("model must contain at least one process"));
    }
    definition.processes.sort_by(|a, b| a.id.cmp(&b.id));
    definition.decomposition.sort_by(|a, b| a.id.cmp(&b.id));
    definition.dependencies.sort_by(|a, b| a.id.cmp(&b.id));
    definition.laws.sort_by(|a, b| a.id.cmp(&b.id));
    definition.initial_claims.sort_by(|a, b| a.id.cmp(&b.id));
    if let Some(meaning_model) = &mut definition.meaning_model {
        meaning::normalize_meaning_model(meaning_model);
    }

    let mut processes = BTreeMap::new();
    for process in &definition.processes {
        validate_process(process)?;
        if processes
            .insert(process.id.clone(), process.clone())
            .is_some()
        {
            return Err(error(format!("duplicate process id {}", process.id)));
        }
    }
    if let Some(meaning_model) = &definition.meaning_model {
        meaning::validate_meaning_model(meaning_model, &processes)?;
    }
    validate_decomposition(&definition.decomposition, &processes)?;
    let derived_order = validate_laws(&definition.laws, &processes)?;
    let expression_node_count = model_expression_node_count(&definition.laws)?;
    validate_dependencies(&definition.dependencies, &definition.laws, &processes)?;
    let mut initial_claims = BTreeMap::new();
    for claim in &definition.initial_claims {
        validate_claim(claim, &processes)?;
        if claim.evidence_cutoff > 0.0 {
            return Err(error(format!(
                "initial claim {} has evidence from after genesis time 0",
                claim.id
            )));
        }
        if initial_claims
            .insert(claim.id.clone(), claim.clone())
            .is_some()
        {
            return Err(error(format!("duplicate initial claim id {}", claim.id)));
        }
    }
    let model_hash = hash_serializable(&definition)?;
    Ok(CompiledModel {
        model_hash,
        id: definition.id.clone(),
        time_unit: definition.time_unit.clone(),
        revision: definition.revision.clone(),
        processes,
        laws: definition.laws.clone(),
        initial_claims,
        derived_order,
        expression_node_count,
        definition,
    })
}

/// Lossless encoder for the deterministic scalar subset of the legacy registry.
///
/// The legacy and typed engines intentionally use different random generators,
/// so registries with nonzero noise must remain on the legacy path until a
/// random-stream adapter is specified.
pub fn encode_legacy_registry_as_model(
    definition: &RegistryDefinition,
) -> EngineResult<ModelDefinition> {
    super::compile_registry(definition.clone())?;
    if definition
        .fields
        .iter()
        .any(|field| field.noise_scale != 0.0)
    {
        return Err(error(
            "legacy encoder currently requires zero noise_scale for exact transition equivalence",
        ));
    }
    let fields: BTreeMap<_, _> = definition
        .fields
        .iter()
        .map(|field| (field.id.as_str(), field))
        .collect();
    let processes = definition
        .fields
        .iter()
        .map(|field| ProcessDefinition {
            id: field.id.clone(),
            value_type: ProcessType::Scalar {
                bounds: NumericBounds {
                    minimum: field.minimum,
                    maximum: field.maximum,
                },
            },
            initial_value: ProcessValue::Scalar(field.initial_value),
            uncertainty: ClaimUncertainty::Exact,
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
            axes: vec![],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::from([("temporal".to_owned(), definition.time_unit.clone())]),
            support: vec!["legacy bounded scalar".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Unspecified,
        })
        .collect();
    let mut laws = Vec::new();
    let mut dependencies = Vec::new();
    for field in &definition.fields {
        let law_id = format!("legacy:0:drift:{}", field.id);
        laws.push(LawDefinition {
            id: law_id.clone(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: field.id.clone(),
                derivative: ScalarExpression::Multiply {
                    factors: vec![
                        ScalarExpression::Constant {
                            value: field.drift_rate,
                        },
                        ScalarExpression::Subtract {
                            left: Box::new(ScalarExpression::Constant {
                                value: field.drift_target,
                            }),
                            right: Box::new(ScalarExpression::Process {
                                process: field.id.clone(),
                            }),
                        },
                    ],
                },
                innovation: None,
            },
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
        });
        dependencies.push(DependencyEdge {
            id: format!("legacy:0:drift-edge:{}", field.id),
            source: field.id.clone(),
            target: field.id.clone(),
            kind: DependencyKind::Causes,
            law_id: Some(law_id),
        });
    }
    for coupling in &definition.couplings {
        let source = fields
            .get(coupling.source.as_str())
            .expect("legacy registry validation checked coupling source");
        let signal = match coupling.mode {
            CouplingMode::Centered => ScalarExpression::Subtract {
                left: Box::new(ScalarExpression::Process {
                    process: coupling.source.clone(),
                }),
                right: Box::new(ScalarExpression::Constant {
                    value: coupling
                        .source_center
                        .unwrap_or((source.minimum + source.maximum) / 2.0),
                }),
            },
            CouplingMode::Difference => ScalarExpression::Subtract {
                left: Box::new(ScalarExpression::Process {
                    process: coupling.source.clone(),
                }),
                right: Box::new(ScalarExpression::Process {
                    process: coupling.target.clone(),
                }),
            },
        };
        let law_id = format!("legacy:1:coupling:{}", coupling.id);
        laws.push(LawDefinition {
            id: law_id.clone(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: coupling.target.clone(),
                derivative: ScalarExpression::Multiply {
                    factors: vec![
                        ScalarExpression::Constant {
                            value: coupling.gain,
                        },
                        signal,
                    ],
                },
                innovation: None,
            },
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
        });
        dependencies.push(DependencyEdge {
            id: format!("legacy:1:coupling-edge:{}", coupling.id),
            source: coupling.source.clone(),
            target: coupling.target.clone(),
            kind: DependencyKind::Causes,
            law_id: Some(law_id),
        });
    }
    Ok(ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: definition.id.clone(),
        time_unit: definition.time_unit.clone(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "encoded deterministic legacy scalar registry".to_owned(),
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
        },
        processes,
        decomposition: vec![],
        dependencies,
        laws,
        initial_claims: vec![],
        meaning_model: None,
    })
}

/// Decode a typed world into the legacy registry's canonical field order.
pub fn decode_model_world_as_legacy_parent(
    registry: &CompiledRegistry,
    world: &WorldHead,
) -> EngineResult<ParentState> {
    let mut values = Vec::with_capacity(registry.field_ids.len());
    for field_id in &registry.field_ids {
        values.push(scalar(&world.state, field_id)?);
    }
    build_parent(
        registry,
        world.version,
        world.time,
        values,
        world.lineage_head.clone(),
    )
}

fn validate_revision(revision: &ModelRevision) -> EngineResult<()> {
    if revision.reason.trim().is_empty()
        || revision.provenance.is_empty()
        || revision.provenance.iter().any(|v| v.trim().is_empty())
    {
        return Err(error(
            "model revision requires reason and nonempty provenance",
        ));
    }
    match (revision.number, &revision.previous_model_hash) {
        (0, None) => Ok(()),
        (0, Some(_)) => Err(error("model revision 0 cannot name a previous model")),
        (_, None) => Err(error("model revision above 0 requires previous_model_hash")),
        (_, Some(hash)) if hash.trim().is_empty() => Err(error("previous_model_hash is empty")),
        _ => Ok(()),
    }
}

fn validate_bounds(bounds: &NumericBounds, label: &str) -> EngineResult<()> {
    finite(bounds.minimum, &format!("{label} minimum"))?;
    finite(bounds.maximum, &format!("{label} maximum"))?;
    if bounds.maximum <= bounds.minimum {
        return Err(error(format!("{label} maximum must exceed minimum")));
    }
    Ok(())
}

fn validate_labels(values: &[String], label: &str) -> EngineResult<()> {
    if values.is_empty() {
        return Err(error(format!("{label} must not be empty")));
    }
    let mut unique = BTreeSet::new();
    for value in values {
        if value.trim().is_empty() || !unique.insert(value) {
            return Err(error(format!("{label} must be unique and nonempty")));
        }
    }
    Ok(())
}

fn validate_process(process: &ProcessDefinition) -> EngineResult<()> {
    if process.id.trim().is_empty() || process.id.len() > MAX_MODEL_IDENTIFIER_BYTES {
        return Err(error("process id must be nonempty and bounded"));
    }
    if process.provenance.is_empty() || process.provenance.iter().any(|item| item.trim().is_empty())
    {
        return Err(error(format!(
            "process {} requires nonempty provenance",
            process.id
        )));
    }
    validate_uncertainty(
        &process.uncertainty,
        &format!("process {} uncertainty", process.id),
    )?;
    let mut axes = BTreeSet::new();
    if process
        .axes
        .iter()
        .any(|axis| axis.id.trim().is_empty() || !axes.insert(&axis.id))
    {
        return Err(error(format!(
            "process {} axes must have unique nonempty ids",
            process.id
        )));
    }
    if process.support.is_empty() || process.support.iter().any(|item| item.trim().is_empty()) {
        return Err(error(format!(
            "process {} requires at least one nonempty support declaration",
            process.id
        )));
    }
    let mut access_scopes = BTreeSet::new();
    if process.access_scopes.iter().any(|scope| {
        scope.trim().is_empty()
            || scope.len() > MAX_MODEL_IDENTIFIER_BYTES
            || !access_scopes.insert(scope)
    }) {
        return Err(error(format!(
            "process {} access scopes must be unique, nonempty, and bounded",
            process.id
        )));
    }
    match &process.value_type {
        ProcessType::Scalar { bounds } => validate_bounds(bounds, &process.id)?,
        ProcessType::Vector { dimensions, bounds } => {
            if *dimensions == 0 {
                return Err(error(format!("process {} has zero dimensions", process.id)));
            }
            validate_bounds(bounds, &process.id)?;
            if !process.axes.is_empty() && process.axes.len() != *dimensions {
                return Err(error(format!(
                    "process {} axes do not match dimensions",
                    process.id
                )));
            }
        }
        ProcessType::Category { variants } | ProcessType::Regime { variants } => {
            validate_labels(variants, &format!("process {} variants", process.id))?
        }
        ProcessType::Distribution { outcomes } => {
            validate_labels(outcomes, &format!("process {} outcomes", process.id))?
        }
        ProcessType::Graph => {}
        ProcessType::ObjectPose {
            position_dimensions,
            orientation_dimensions,
        } => {
            if *position_dimensions == 0 || *orientation_dimensions == 0 {
                return Err(error(format!(
                    "process {} has zero pose dimensions",
                    process.id
                )));
            }
        }
    }
    validate_process_value(&process.value_type, &process.initial_value, &process.id)
}

fn validate_process_value(
    value_type: &ProcessType,
    value: &ProcessValue,
    label: &str,
) -> EngineResult<()> {
    match (value_type, value) {
        (ProcessType::Scalar { bounds }, ProcessValue::Scalar(value)) => {
            validate_numeric(*value, bounds, label)
        }
        (ProcessType::Vector { dimensions, bounds }, ProcessValue::Vector(values)) => {
            if values.len() != *dimensions {
                return Err(error(format!("{label} vector has wrong dimension")));
            }
            for value in values {
                validate_numeric(*value, bounds, label)?;
            }
            Ok(())
        }
        (ProcessType::Category { variants }, ProcessValue::Category(value))
        | (ProcessType::Regime { variants }, ProcessValue::Regime(value)) => {
            if variants.contains(value) {
                Ok(())
            } else {
                Err(error(format!("{label} is outside declared support")))
            }
        }
        (ProcessType::Distribution { outcomes }, ProcessValue::Distribution(values)) => {
            if values.len() != outcomes.len() {
                return Err(error(format!("{label} distribution has wrong dimension")));
            }
            let mut total = 0.0;
            for value in values {
                finite(*value, label)?;
                if *value < 0.0 {
                    return Err(error(format!("{label} probabilities must be nonnegative")));
                }
                total += value;
            }
            if (total - 1.0).abs() > 1e-9 {
                return Err(error(format!("{label} probabilities must sum to one")));
            }
            Ok(())
        }
        (ProcessType::Graph, ProcessValue::Graph(graph)) => {
            let nodes: BTreeSet<_> = graph.nodes.iter().collect();
            if nodes.len() != graph.nodes.len()
                || graph.nodes.iter().any(|node| node.trim().is_empty())
                || graph.edges.iter().any(|edge| {
                    edge.relation.trim().is_empty()
                        || !nodes.contains(&edge.source)
                        || !nodes.contains(&edge.target)
                })
            {
                return Err(error(format!("{label} graph is invalid")));
            }
            Ok(())
        }
        (
            ProcessType::ObjectPose {
                position_dimensions,
                orientation_dimensions,
            },
            ProcessValue::ObjectPose(pose),
        ) => {
            if pose.position.len() != *position_dimensions
                || pose.orientation.len() != *orientation_dimensions
            {
                return Err(error(format!("{label} pose has wrong dimension")));
            }
            for value in pose.position.iter().chain(&pose.orientation) {
                finite(*value, label)?;
            }
            Ok(())
        }
        _ => Err(error(format!(
            "{label} does not match declared {} type",
            value_type.name()
        ))),
    }
}

fn validate_numeric(value: f64, bounds: &NumericBounds, label: &str) -> EngineResult<()> {
    finite(value, label)?;
    if value < bounds.minimum || value > bounds.maximum {
        return Err(error(format!("{label} is outside declared bounds")));
    }
    Ok(())
}

fn validate_claim(
    claim: &Claim,
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    validate_claim_metadata(
        &claim.id,
        &claim.subject,
        &claim.uncertainty,
        &claim.holder,
        &claim.provenance,
        &claim.authority,
        &claim.access_scopes,
    )?;
    finite(
        claim.evidence_cutoff,
        &format!("claim {} evidence_cutoff", claim.id),
    )?;
    if let Some(value_time) = claim.value_time {
        finite(value_time, &format!("claim {} value_time", claim.id))?;
        if value_time > claim.evidence_cutoff {
            return Err(error(format!(
                "claim {} value_time cannot be after its evidence cutoff",
                claim.id
            )));
        }
    }
    if claim.mode == Some(ClaimMode::Observed) {
        if claim.value_time.is_none()
            || !matches!(
                claim.evidence_type,
                EvidenceType::Observation | EvidenceType::Report
            )
        {
            return Err(error(format!(
                "observed claim {} requires value_time and observation or report evidence",
                claim.id
            )));
        }
    }
    let process = processes
        .get(&claim.subject)
        .ok_or_else(|| error(format!("claim {} has unknown subject", claim.id)))?;
    validate_process_value(&process.value_type, &claim.value, &claim.id)
}

fn validate_claim_template(
    claim: &ClaimTemplate,
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    validate_claim_metadata(
        &claim.id,
        &claim.subject,
        &claim.uncertainty,
        &claim.holder,
        &claim.provenance,
        &claim.authority,
        &claim.access_scopes,
    )?;
    require_scalar_process(processes, &claim.subject, &claim.id)
}

fn validate_claim_metadata(
    id: &str,
    subject: &str,
    uncertainty: &ClaimUncertainty,
    holder: &str,
    provenance: &[String],
    authority: &ClaimAuthority,
    access_scopes: &[String],
) -> EngineResult<()> {
    if id.trim().is_empty()
        || subject.trim().is_empty()
        || holder.trim().is_empty()
        || provenance.is_empty()
        || provenance.iter().any(|v| v.trim().is_empty())
        || authority.source.trim().is_empty()
        || access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
        || access_scopes
            .iter()
            .any(|scope| scope.trim().is_empty() || scope.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(error("claim metadata contains an empty required field"));
    }
    finite(authority.weight, &format!("claim {id} authority"))?;
    if !(0.0..=1.0).contains(&authority.weight) {
        return Err(error(format!("claim {id} authority must be in [0,1]")));
    }
    validate_uncertainty(uncertainty, &format!("claim {id} uncertainty"))
}

fn validate_uncertainty(uncertainty: &ClaimUncertainty, label: &str) -> EngineResult<()> {
    match uncertainty {
        ClaimUncertainty::Exact | ClaimUncertainty::Unknown => Ok(()),
        ClaimUncertainty::StandardDeviation { value } => {
            finite(*value, label)?;
            if *value < 0.0 {
                Err(error(format!("{label} is negative")))
            } else {
                Ok(())
            }
        }
        ClaimUncertainty::Interval { lower, upper } => {
            finite(*lower, &format!("{label} lower"))?;
            finite(*upper, &format!("{label} upper"))?;
            if upper < lower {
                Err(error(format!("{label} interval is reversed")))
            } else {
                Ok(())
            }
        }
    }
}

fn validate_decomposition(
    edges: &[DecompositionEdge],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    let mut ids = BTreeSet::new();
    let mut adjacency: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut indegree: BTreeMap<&str, usize> = processes.keys().map(|id| (id.as_str(), 0)).collect();
    for edge in edges {
        if edge.id.trim().is_empty() || !ids.insert(edge.id.as_str()) {
            return Err(error("decomposition edge ids must be unique and nonempty"));
        }
        if edge.parent == edge.child
            || !processes.contains_key(&edge.parent)
            || !processes.contains_key(&edge.child)
        {
            return Err(error(format!("decomposition edge {} is invalid", edge.id)));
        }
        adjacency
            .entry(edge.parent.as_str())
            .or_default()
            .push(edge.child.as_str());
        *indegree
            .get_mut(edge.child.as_str())
            .expect("decomposition child was validated") += 1;
    }
    let mut ready: VecDeque<&str> = indegree
        .iter()
        .filter_map(|(node, degree)| (*degree == 0).then_some(*node))
        .collect();
    let mut visited = 0usize;
    while let Some(node) = ready.pop_front() {
        visited += 1;
        if let Some(children) = adjacency.get(node) {
            for child in children {
                let degree = indegree
                    .get_mut(child)
                    .expect("decomposition child was validated");
                *degree -= 1;
                if *degree == 0 {
                    ready.push_back(child);
                }
            }
        }
    }
    if visited != processes.len() {
        return Err(error("decomposition graph must be acyclic"));
    }
    Ok(())
}

fn validate_dependencies(
    edges: &[DependencyEdge],
    laws: &[LawDefinition],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    let law_by_id: BTreeMap<_, _> = laws.iter().map(|law| (law.id.as_str(), law)).collect();
    let law_shapes: BTreeMap<_, _> = laws
        .iter()
        .map(|law| (law.id.as_str(), law_dependency_shape(law, &law_by_id)))
        .collect();
    let mut ids = BTreeSet::new();
    for edge in edges {
        if edge.id.trim().is_empty()
            || !ids.insert(edge.id.as_str())
            || !processes.contains_key(&edge.source)
            || !processes.contains_key(&edge.target)
        {
            return Err(error(format!("dependency edge {} is invalid", edge.id)));
        }
        let Some(law_id) = &edge.law_id else {
            continue;
        };
        let law = law_by_id.get(law_id.as_str()).ok_or_else(|| {
            error(format!(
                "dependency edge {} names unknown law {law_id}",
                edge.id
            ))
        })?;
        let compatible = match edge.kind {
            DependencyKind::Derives => matches!(
                law.operator,
                LawOperator::Relation { .. } | LawOperator::Resolution { .. }
            ),
            DependencyKind::Causes => matches!(
                law.operator,
                LawOperator::Evolution { .. } | LawOperator::Occurrence { .. }
            ),
            DependencyKind::Constrains => matches!(
                law.operator,
                LawOperator::Relation { .. }
                    | LawOperator::Occurrence { .. }
                    | LawOperator::Resolution { .. }
            ),
            DependencyKind::Observes => matches!(law.operator, LawOperator::Epistemic { .. }),
        };
        if !compatible {
            return Err(error(format!(
                "dependency edge {} kind is incompatible with law {law_id}",
                edge.id
            )));
        }
        let (sources, targets) = law_shapes
            .get(law_id.as_str())
            .expect("dependency law shape was precomputed");
        if !targets.contains(&edge.target) {
            return Err(error(format!(
                "dependency edge {} target {} is not a target or subject of law {law_id}",
                edge.id, edge.target
            )));
        }
        if !sources.contains(&edge.source) {
            return Err(error(format!(
                "dependency edge {} source {} is not read by law {law_id}",
                edge.id, edge.source
            )));
        }
    }
    Ok(())
}

fn law_dependency_shape(
    law: &LawDefinition,
    laws: &BTreeMap<&str, &LawDefinition>,
) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut sources = BTreeSet::new();
    let mut targets = BTreeSet::new();
    match &law.operator {
        LawOperator::Evolution {
            target,
            derivative,
            innovation,
        } => {
            targets.insert(target.clone());
            expression_references(derivative, &mut sources);
            if let Some(innovation) = innovation {
                expression_references(&innovation.scale, &mut sources);
            }
        }
        LawOperator::Relation { target, value } | LawOperator::Resolution { target, value, .. } => {
            targets.insert(target.clone());
            expression_references(value, &mut sources);
        }
        LawOperator::Occurrence {
            trigger,
            effects,
            activates,
        } => {
            match trigger {
                OccurrenceTrigger::Always => {}
                OccurrenceTrigger::Threshold { expression, .. } => {
                    expression_references(expression, &mut sources)
                }
                OccurrenceTrigger::Hazard { rate } => expression_references(rate, &mut sources),
            }
            for effect in effects {
                targets.insert(effect.target.clone());
                expression_references(&effect.value, &mut sources);
            }
            // A marked occurrence may cause or constrain the target of a law it
            // gates, even when it has no direct state effect of its own.
            for activated in activates {
                if let Some(activated_law) = laws.get(activated.as_str()) {
                    targets.extend(law_direct_targets(activated_law));
                }
            }
        }
        LawOperator::Epistemic { claim, value } => {
            targets.insert(claim.subject.clone());
            expression_references(value, &mut sources);
        }
    }
    (sources, targets)
}

fn law_direct_targets(law: &LawDefinition) -> BTreeSet<String> {
    match &law.operator {
        LawOperator::Evolution { target, .. }
        | LawOperator::Relation { target, .. }
        | LawOperator::Resolution { target, .. } => BTreeSet::from([target.clone()]),
        LawOperator::Occurrence { effects, .. } => {
            effects.iter().map(|effect| effect.target.clone()).collect()
        }
        LawOperator::Epistemic { claim, .. } => BTreeSet::from([claim.subject.clone()]),
    }
}

fn require_scalar_process(
    processes: &BTreeMap<String, ProcessDefinition>,
    process_id: &str,
    law_id: &str,
) -> EngineResult<()> {
    let process = processes.get(process_id).ok_or_else(|| {
        error(format!(
            "law {law_id} references unknown process {process_id}"
        ))
    })?;
    if matches!(process.value_type, ProcessType::Scalar { .. }) {
        Ok(())
    } else {
        Err(error(format!(
            "law {law_id} requires scalar process {process_id}; non-scalar execution is not implemented"
        )))
    }
}

fn validate_expression(
    expression: &ScalarExpression,
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    expression_metrics(expression)?;
    validate_expression_structure(expression, processes, law_id)
}

fn validate_expression_structure(
    expression: &ScalarExpression,
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    match expression {
        ScalarExpression::Constant { value } => finite(*value, &format!("law {law_id} constant")),
        ScalarExpression::Process { process } => require_scalar_process(processes, process, law_id),
        ScalarExpression::Time => Ok(()),
        ScalarExpression::Add { terms } => {
            validate_expression_list_structure(terms, processes, law_id)
        }
        ScalarExpression::Multiply { factors } => {
            validate_expression_list_structure(factors, processes, law_id)
        }
        ScalarExpression::Subtract { left, right } => {
            validate_expression_structure(left, processes, law_id)?;
            validate_expression_structure(right, processes, law_id)
        }
        ScalarExpression::Divide {
            numerator,
            denominator,
        } => {
            validate_expression_structure(numerator, processes, law_id)?;
            validate_expression_structure(denominator, processes, law_id)
        }
        ScalarExpression::Negate { value }
        | ScalarExpression::Absolute { value }
        | ScalarExpression::Exponential { value }
        | ScalarExpression::Logistic { value } => {
            validate_expression_structure(value, processes, law_id)
        }
        ScalarExpression::Minimum { values } | ScalarExpression::Maximum { values } => {
            validate_expression_list_structure(values, processes, law_id)
        }
        ScalarExpression::Clamp {
            value,
            minimum,
            maximum,
        } => {
            finite(*minimum, &format!("law {law_id} clamp minimum"))?;
            finite(*maximum, &format!("law {law_id} clamp maximum"))?;
            if maximum < minimum {
                return Err(error(format!("law {law_id} clamp is reversed")));
            }
            validate_expression_structure(value, processes, law_id)
        }
    }
}

fn validate_expression_list_structure(
    values: &[ScalarExpression],
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    if values.is_empty() {
        return Err(error(format!("law {law_id} expression list is empty")));
    }
    for value in values {
        validate_expression_structure(value, processes, law_id)?;
    }
    Ok(())
}

fn expression_metrics(expression: &ScalarExpression) -> EngineResult<(usize, usize)> {
    let mut nodes = 0usize;
    let mut maximum_depth = 0usize;
    let mut pending = vec![(expression, 1usize)];
    while let Some((current, depth)) = pending.pop() {
        if depth > MAX_EXPRESSION_DEPTH {
            return Err(error(format!(
                "expression depth {depth} exceeds limit {MAX_EXPRESSION_DEPTH}"
            )));
        }
        nodes = nodes
            .checked_add(1)
            .ok_or_else(|| error("expression node count overflow"))?;
        maximum_depth = maximum_depth.max(depth);
        let child_depth = depth
            .checked_add(1)
            .ok_or_else(|| error("expression depth overflow"))?;
        match current {
            ScalarExpression::Constant { .. }
            | ScalarExpression::Process { .. }
            | ScalarExpression::Time => {}
            ScalarExpression::Add { terms } => {
                pending.extend(terms.iter().map(|child| (child, child_depth)));
            }
            ScalarExpression::Multiply { factors } => {
                pending.extend(factors.iter().map(|child| (child, child_depth)));
            }
            ScalarExpression::Subtract { left, right } => {
                pending.push((left, child_depth));
                pending.push((right, child_depth));
            }
            ScalarExpression::Divide {
                numerator,
                denominator,
            } => {
                pending.push((numerator, child_depth));
                pending.push((denominator, child_depth));
            }
            ScalarExpression::Negate { value }
            | ScalarExpression::Clamp { value, .. }
            | ScalarExpression::Absolute { value }
            | ScalarExpression::Exponential { value }
            | ScalarExpression::Logistic { value } => pending.push((value, child_depth)),
            ScalarExpression::Minimum { values } | ScalarExpression::Maximum { values } => {
                pending.extend(values.iter().map(|child| (child, child_depth)));
            }
        }
    }
    Ok((nodes, maximum_depth))
}

fn model_expression_node_count(laws: &[LawDefinition]) -> EngineResult<usize> {
    let mut total = 0usize;
    let mut add = |expression: &ScalarExpression| -> EngineResult<()> {
        let (nodes, _) = expression_metrics(expression)?;
        total = total
            .checked_add(nodes)
            .ok_or_else(|| error("model expression node count overflow"))?;
        if total > MAX_MODEL_EXPRESSION_NODES {
            return Err(error(format!(
                "model expression nodes {total} exceed limit {MAX_MODEL_EXPRESSION_NODES}"
            )));
        }
        Ok(())
    };
    for law in laws {
        match &law.operator {
            LawOperator::Evolution {
                derivative,
                innovation,
                ..
            } => {
                add(derivative)?;
                if let Some(innovation) = innovation {
                    add(&innovation.scale)?;
                }
            }
            LawOperator::Relation { value, .. }
            | LawOperator::Epistemic { value, .. }
            | LawOperator::Resolution { value, .. } => add(value)?,
            LawOperator::Occurrence {
                trigger, effects, ..
            } => {
                match trigger {
                    OccurrenceTrigger::Always => {}
                    OccurrenceTrigger::Threshold { expression, .. } => add(expression)?,
                    OccurrenceTrigger::Hazard { rate } => add(rate)?,
                }
                for effect in effects {
                    add(&effect.value)?;
                }
            }
        }
    }
    Ok(total)
}

fn validate_effect(
    effect: &StateEffect,
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    require_scalar_process(processes, &effect.target, law_id)?;
    validate_expression(&effect.value, processes, law_id)
}

fn validate_laws(
    laws: &[LawDefinition],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<Vec<usize>> {
    let mut law_ids = BTreeMap::new();
    for (index, law) in laws.iter().enumerate() {
        if law.id.trim().is_empty()
            || law.id.len() > MAX_MODEL_IDENTIFIER_BYTES
            || law_ids.insert(law.id.as_str(), index).is_some()
        {
            return Err(error("law ids must be unique, nonempty, and bounded"));
        }
        if law.provenance.is_empty() || law.provenance.iter().any(|item| item.trim().is_empty()) {
            return Err(error(format!(
                "law {} requires nonempty provenance",
                law.id
            )));
        }
    }
    let mut derived_targets = BTreeMap::new();
    let mut evolved_targets = BTreeSet::new();
    let mut claim_ids = BTreeSet::new();
    let mut activated = BTreeSet::new();
    for (index, law) in laws.iter().enumerate() {
        match &law.operator {
            LawOperator::Evolution {
                target,
                derivative,
                innovation,
            } => {
                require_scalar_process(processes, target, &law.id)?;
                validate_expression(derivative, processes, &law.id)?;
                if let Some(innovation) = innovation {
                    if innovation.name.trim().is_empty()
                        || innovation.name.len() > MAX_MODEL_IDENTIFIER_BYTES
                    {
                        return Err(error(format!(
                            "law {} innovation name must be nonempty and bounded",
                            law.id
                        )));
                    }
                    validate_expression(&innovation.scale, processes, &law.id)?;
                }
                evolved_targets.insert(target.as_str());
            }
            LawOperator::Relation { target, value }
            | LawOperator::Resolution { target, value, .. } => {
                require_scalar_process(processes, target, &law.id)?;
                validate_expression(value, processes, &law.id)?;
                if derived_targets.insert(target.as_str(), index).is_some() {
                    return Err(error(format!(
                        "multiple relation/resolution laws target {target}"
                    )));
                }
            }
            LawOperator::Occurrence {
                trigger,
                effects,
                activates,
            } => {
                if law.activation == LawActivation::Gated {
                    return Err(error(format!("occurrence law {} cannot be gated", law.id)));
                }
                match trigger {
                    OccurrenceTrigger::Always => {}
                    OccurrenceTrigger::Threshold {
                        expression,
                        threshold,
                        ..
                    } => {
                        finite(*threshold, &format!("law {} threshold", law.id))?;
                        validate_expression(expression, processes, &law.id)?;
                    }
                    OccurrenceTrigger::Hazard { rate } => {
                        validate_expression(rate, processes, &law.id)?
                    }
                }
                for effect in effects {
                    validate_effect(effect, processes, &law.id)?;
                }
                for target_law in activates {
                    if target_law == &law.id || !law_ids.contains_key(target_law.as_str()) {
                        return Err(error(format!(
                            "law {} activates invalid law {target_law}",
                            law.id
                        )));
                    }
                    activated.insert(target_law.as_str());
                }
            }
            LawOperator::Epistemic { claim, value } => {
                validate_claim_template(claim, processes)?;
                validate_expression(value, processes, &law.id)?;
                if !claim_ids.insert(claim.id.as_str()) {
                    return Err(error(format!(
                        "multiple epistemic laws emit claim {}",
                        claim.id
                    )));
                }
            }
        }
    }
    for law in laws {
        if law.enabled
            && law.activation == LawActivation::Gated
            && !activated.contains(law.id.as_str())
        {
            return Err(error(format!(
                "gated law {} has no occurrence gate",
                law.id
            )));
        }
    }
    for target in evolved_targets {
        if derived_targets.contains_key(target) {
            return Err(error(format!(
                "process {target} cannot be both evolved and exactly derived"
            )));
        }
    }
    derived_topological_order(laws, &derived_targets)
}

fn expression_references(expression: &ScalarExpression, output: &mut BTreeSet<String>) {
    match expression {
        ScalarExpression::Process { process } => {
            output.insert(process.clone());
        }
        ScalarExpression::Add { terms } => {
            for value in terms {
                expression_references(value, output);
            }
        }
        ScalarExpression::Multiply { factors } => {
            for value in factors {
                expression_references(value, output);
            }
        }
        ScalarExpression::Subtract { left, right } => {
            expression_references(left, output);
            expression_references(right, output);
        }
        ScalarExpression::Divide {
            numerator,
            denominator,
        } => {
            expression_references(numerator, output);
            expression_references(denominator, output);
        }
        ScalarExpression::Negate { value }
        | ScalarExpression::Absolute { value }
        | ScalarExpression::Exponential { value }
        | ScalarExpression::Logistic { value }
        | ScalarExpression::Clamp { value, .. } => expression_references(value, output),
        ScalarExpression::Minimum { values } | ScalarExpression::Maximum { values } => {
            for value in values {
                expression_references(value, output);
            }
        }
        ScalarExpression::Constant { .. } | ScalarExpression::Time => {}
    }
}

fn derived_topological_order(
    laws: &[LawDefinition],
    targets: &BTreeMap<&str, usize>,
) -> EngineResult<Vec<usize>> {
    let mut outgoing: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    let mut indegree: BTreeMap<usize, usize> = targets.values().map(|index| (*index, 0)).collect();
    for target_index in targets.values() {
        let expression = match &laws[*target_index].operator {
            LawOperator::Relation { value, .. } | LawOperator::Resolution { value, .. } => value,
            _ => unreachable!(),
        };
        let mut references = BTreeSet::new();
        expression_references(expression, &mut references);
        for reference in references {
            if let Some(source_index) = targets.get(reference.as_str()) {
                if source_index == target_index {
                    return Err(error(format!(
                        "derived law {} depends on itself",
                        laws[*target_index].id
                    )));
                }
                if outgoing
                    .entry(*source_index)
                    .or_default()
                    .insert(*target_index)
                {
                    *indegree.get_mut(target_index).unwrap() += 1;
                }
            }
        }
    }
    let mut ready: VecDeque<_> = indegree
        .iter()
        .filter_map(|(index, degree)| (*degree == 0).then_some(*index))
        .collect();
    let mut order = Vec::new();
    while let Some(index) = ready.pop_front() {
        order.push(index);
        if let Some(dependents) = outgoing.get(&index) {
            for dependent in dependents {
                let degree = indegree.get_mut(dependent).unwrap();
                *degree -= 1;
                if *degree == 0 {
                    ready.push_back(*dependent);
                }
            }
        }
    }
    if order.len() != indegree.len() {
        return Err(error(
            "relation/resolution dependency graph must be acyclic",
        ));
    }
    Ok(order)
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimeDirection {
    #[default]
    Forward,
    Backward,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionPrecedence {
    Coarse,
    Fine,
    #[default]
    Balanced,
}

/// Optional execution timing for a caller-supplied intervention. Absence is
/// the legacy successor-boundary contract and is deliberately omitted from
/// serialization so existing query fingerprints remain unchanged.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InterventionApplication {
    InitialBoundary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TimedIntervention {
    pub id: String,
    pub offset: f64,
    pub effect: StateEffect,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<InterventionApplication>,
}

/// One externally supplied value on a process whose update mode is `observed`.
/// Offsets are normalized to exact reachable step boundaries before hashing and
/// execution; the genesis value remains authoritative at offset zero.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TimedObservation {
    pub id: String,
    pub target: String,
    pub offset: f64,
    pub value: ProcessValue,
    #[serde(default)]
    pub unit: Option<String>,
    pub uncertainty: ClaimUncertainty,
    pub evidence_type: EvidenceType,
    pub holder: String,
    pub provenance: Vec<String>,
    pub authority: ClaimAuthority,
}

fn default_model_seed() -> String {
    "life-sim-rust-model".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelTransitionSpec {
    pub schema: String,
    pub delta_time: f64,
    pub step_size: f64,
    #[serde(default = "default_model_seed")]
    pub seed: String,
    #[serde(default)]
    pub roll_index: u64,
    #[serde(default)]
    pub direction: TimeDirection,
    #[serde(default)]
    pub precedence: ResolutionPrecedence,
    #[serde(default)]
    pub temporal_resolution: Option<String>,
    #[serde(default)]
    pub semantic_resolution: Option<String>,
    #[serde(default)]
    pub interventions: Vec<TimedIntervention>,
    #[serde(default)]
    pub observations: Vec<TimedObservation>,
    /// Optional experiment identifier for explicitly paired common-random
    /// comparisons. This is public lineage metadata, not a secret seed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison_stream: Option<String>,
    #[serde(default)]
    pub selected_support: Vec<String>,
    #[serde(default)]
    pub requested_observables: Vec<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    #[serde(default)]
    pub path: PathSpec,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ViewSpec {
    #[serde(default)]
    pub requested_observables: Vec<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    #[serde(default)]
    pub include_path: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum GraphTraversalDirection {
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
enum GraphQuery {
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
struct GraphSnapshotSource {
    kind: String,
    model_hash: String,
    model_revision: u64,
    source_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    world_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    world_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidate_status: Option<CandidateStatus>,
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
struct FactorGraphResponse {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WorldHead {
    pub schema: String,
    pub model_hash: String,
    pub model_revision: u64,
    pub world_id: String,
    pub version: u64,
    pub time: f64,
    pub state: BTreeMap<String, ProcessValue>,
    pub claims: BTreeMap<String, Claim>,
    #[serde(default)]
    pub lineage_head: Option<String>,
    pub world_hash: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorldRevisionMode {
    Refine,
    Revise,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WorldRevisionSpec {
    pub expected_world_hash: String,
    pub mode: WorldRevisionMode,
    #[serde(default)]
    pub state_values: BTreeMap<String, ProcessValue>,
    pub reason: String,
    pub provenance: Vec<String>,
}

/// An immutable operational transition between model revisions at one world
/// time. The frozen heads retain both sides without rewriting accepted history.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WorldRevision {
    pub schema: String,
    pub world_revision_hash: String,
    pub mode: WorldRevisionMode,
    pub state_values: BTreeMap<String, ProcessValue>,
    pub reason: String,
    pub provenance: Vec<String>,
    pub source_head: WorldHead,
    pub target_head: WorldHead,
}

fn build_world_revision(
    source: &CompiledModel,
    target: &CompiledModel,
    current: &WorldHead,
    spec: WorldRevisionSpec,
) -> EngineResult<WorldRevision> {
    validate_world(source, current)?;
    if spec.expected_world_hash != current.world_hash {
        return Err(error(
            "world revision expected_world_hash does not match its source head",
        ));
    }
    if target.id != source.id
        || target.revision.number
            != source.revision.number.checked_add(1)
                .ok_or_else(|| error("model revision overflow"))?
        || target.revision.previous_model_hash.as_deref() != Some(source.model_hash.as_str())
    {
        return Err(error(
            "world revision requires the direct next revision of the current model",
        ));
    }
    if source.time_unit != target.time_unit {
        return Err(error("world revision must preserve the model time unit"));
    }
    if spec.reason.trim().is_empty()
        || spec.reason.len() > MAX_NARRATIVE_STRING_BYTES
        || spec.provenance.is_empty()
        || spec.provenance.len() > MAX_OBSERVATION_PROVENANCE
        || spec.provenance.iter().any(|value| {
            value.trim().is_empty() || value.len() > MAX_NARRATIVE_STRING_BYTES
        })
    {
        return Err(error(
            "world revision requires nonempty bounded reason and provenance",
        ));
    }
    if spec.mode == WorldRevisionMode::Refine {
        validate_monotonic_genesis_refinement(source, target)?;
    }
    for (id, old) in &source.processes {
        let new = target.processes.get(id)
            .ok_or_else(|| error(format!("world revision cannot remove process {id}")))?;
        if old.value_type != new.value_type
            || old.axes != new.axes
            || old.unit != new.unit
            || old.reference_frame != new.reference_frame
            || old.scale != new.scale
        {
            return Err(error(format!("world revision cannot reshape or change units, frame, or scale of process {id}")));
        }
    }
    let mut state = current.state.clone();
    for (id, value) in &spec.state_values {
        let process = target.processes.get(id).ok_or_else(|| {
            error(format!("world revision state_values names unknown process {id}"))
        })?;
        if spec.mode == WorldRevisionMode::Refine && source.processes.contains_key(id) {
            return Err(error(format!("refine state_values may name only new processes; existing process {id} must be preserved")));
        }
        validate_process_value(&process.value_type, value, id)?;
        state.insert(id.clone(), value.clone());
    }
    for id in target.processes.keys() {
        if !state.contains_key(id) {
            return Err(error(format!("world revision requires an explicit at-current-time state_values entry for new process {id}")));
        }
    }
    let world_revision_hash = hash_serializable(&serde_json::json!({
        "schema": WORLD_REVISION_SCHEMA,
        "source_world_hash": current.world_hash,
        "target_model_hash": target.model_hash,
        "mode": spec.mode,
        "state_values": spec.state_values,
        "reason": spec.reason,
        "provenance": spec.provenance,
    }))?;
    let target_head = build_world_head(
        target,
        current.world_id.clone(),
        current.version.checked_add(1)
            .ok_or_else(|| error("world version overflow"))?,
        current.time,
        state,
        current.claims.clone(),
        Some(world_revision_hash.clone()),
    )?;
    Ok(WorldRevision {
        schema: WORLD_REVISION_SCHEMA.to_owned(),
        world_revision_hash,
        mode: spec.mode,
        state_values: spec.state_values,
        reason: spec.reason,
        provenance: spec.provenance,
        source_head: current.clone(),
        target_head,
    })
}

#[derive(Debug, Serialize)]
struct WorldFingerprint<'a> {
    schema: &'static str,
    model_hash: &'a str,
    model_revision: u64,
    world_id: &'a str,
    version: u64,
    time: f64,
    state: &'a BTreeMap<String, ProcessValue>,
    claims: &'a BTreeMap<String, Claim>,
    lineage_head: &'a Option<String>,
}

impl CompiledModel {
    pub fn genesis_world(&self, world_id: impl Into<String>) -> EngineResult<WorldHead> {
        let world_id = world_id.into();
        if world_id.trim().is_empty() {
            return Err(error("world_id must be nonempty"));
        }
        let state = self
            .processes
            .iter()
            .map(|(id, process)| (id.clone(), process.initial_value.clone()))
            .collect();
        build_world_head(
            self,
            world_id,
            0,
            0.0,
            state,
            self.initial_claims.clone(),
            None,
        )
    }
}

fn build_world_head(
    model: &CompiledModel,
    world_id: String,
    version: u64,
    time: f64,
    state: BTreeMap<String, ProcessValue>,
    claims: BTreeMap<String, Claim>,
    lineage_head: Option<String>,
) -> EngineResult<WorldHead> {
    validate_world_parts(model, time, &state, &claims)?;
    let fingerprint = WorldFingerprint {
        schema: WORLD_HEAD_SCHEMA,
        model_hash: &model.model_hash,
        model_revision: model.revision.number,
        world_id: &world_id,
        version,
        time,
        state: &state,
        claims: &claims,
        lineage_head: &lineage_head,
    };
    let world_hash = hash_serializable(&fingerprint)?;
    Ok(WorldHead {
        schema: WORLD_HEAD_SCHEMA.to_owned(),
        model_hash: model.model_hash.clone(),
        model_revision: model.revision.number,
        world_id,
        version,
        time,
        state,
        claims,
        lineage_head,
        world_hash,
    })
}

fn validate_world(model: &CompiledModel, world: &WorldHead) -> EngineResult<()> {
    if world.schema != WORLD_HEAD_SCHEMA
        || world.model_hash != model.model_hash
        || world.model_revision != model.revision.number
    {
        return Err(error("world head belongs to a different model or schema"));
    }
    validate_world_parts(model, world.time, &world.state, &world.claims)?;
    let fingerprint = WorldFingerprint {
        schema: WORLD_HEAD_SCHEMA,
        model_hash: &world.model_hash,
        model_revision: world.model_revision,
        world_id: &world.world_id,
        version: world.version,
        time: world.time,
        state: &world.state,
        claims: &world.claims,
        lineage_head: &world.lineage_head,
    };
    if hash_serializable(&fingerprint)? != world.world_hash {
        return Err(error("world head hash is stale"));
    }
    Ok(())
}

fn validate_world_parts(
    model: &CompiledModel,
    time: f64,
    state: &BTreeMap<String, ProcessValue>,
    claims: &BTreeMap<String, Claim>,
) -> EngineResult<()> {
    finite(time, "world time")?;
    if state.len() != model.processes.len() {
        return Err(error("world state does not cover every model process"));
    }
    for (id, process) in &model.processes {
        let value = state
            .get(id)
            .ok_or_else(|| error(format!("world state is missing process {id}")))?;
        validate_process_value(&process.value_type, value, id)?;
    }
    for (id, claim) in claims {
        if id != &claim.id {
            return Err(error("world claim map key does not match claim id"));
        }
        validate_claim(claim, &model.processes)?;
        if claim.evidence_cutoff > time {
            return Err(error(format!(
                "world claim {id} has evidence from after world time {time}"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OccurrenceMark {
    pub id: String,
    pub source: String,
    pub kind: String,
    pub step: usize,
    pub time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RandomDraw {
    pub key: String,
    pub step: usize,
    pub raw_hex: String,
    pub uniform: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RandomnessPolicy {
    #[default]
    CandidateBound,
    CommonRandomComparison,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRandomness {
    pub generator: String,
    pub policy: RandomnessPolicy,
    pub seed: String,
    pub roll_index: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison_stream: Option<String>,
    pub schedule_hash: String,
    pub draws: Vec<RandomDraw>,
    pub draw_set_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelPathSample {
    pub step: usize,
    pub time: f64,
    pub state: BTreeMap<String, ProcessValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RetainedModelPath {
    pub schema: String,
    pub retention: PathSpec,
    pub total_sample_count: usize,
    pub samples: Vec<ModelPathSample>,
}

/// Selects a chronological subinterval and scalar processes from an already
/// retained candidate path. This is a read-only analysis request: it never
/// reruns dynamics or changes candidate/world state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TrajectorySummarySpec {
    pub schema: String,
    pub start_time: f64,
    pub end_time: f64,
    pub fields: Vec<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TrajectoryUncertaintyBoundary {
    /// Uncertainty declared for the source process. The numerical statistics
    /// below summarize retained values and do not silently propagate it.
    pub source_process: ClaimUncertainty,
    pub propagation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TrajectoryFieldSummary {
    pub process_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integral_unit: Option<String>,
    pub uncertainty_boundary: TrajectoryUncertaintyBoundary,
    pub start: f64,
    pub end: f64,
    pub integral: f64,
    pub time_mean: f64,
    pub minimum: f64,
    pub maximum: f64,
}

/// Canonical statistics for the piecewise-linear curve implied by one retained
/// candidate path. `retained_path_hash` deliberately binds the answer to the
/// actual retained resolution, which can be coarser than the full trajectory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TrajectorySummary {
    pub schema: String,
    pub model_hash: String,
    pub world_id: String,
    pub candidate_hash: String,
    pub trajectory_hash: String,
    pub candidate_query_hash: String,
    pub retained_path_hash: String,
    pub retention: PathSpec,
    pub total_sample_count: usize,
    pub retained_sample_count: usize,
    pub time_unit: String,
    pub summary_query: TrajectorySummarySpec,
    pub summary_query_hash: String,
    pub fields: Vec<TrajectoryFieldSummary>,
    pub summary_hash: String,
}

#[derive(Serialize)]
struct TrajectorySummaryFingerprint<'a> {
    schema: &'static str,
    model_hash: &'a str,
    world_id: &'a str,
    candidate_hash: &'a str,
    trajectory_hash: &'a str,
    candidate_query_hash: &'a str,
    retained_path_hash: &'a str,
    retention: &'a PathSpec,
    total_sample_count: usize,
    retained_sample_count: usize,
    time_unit: &'a str,
    summary_query: &'a TrajectorySummarySpec,
    summary_query_hash: &'a str,
    fields: &'a [TrajectoryFieldSummary],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelCandidate {
    pub schema: String,
    pub model_hash: String,
    pub model_revision: u64,
    pub world_id: String,
    pub parent_world_hash: String,
    pub expected_parent_version: u64,
    pub start_time: f64,
    pub end_time: f64,
    pub seed: String,
    pub roll_index: u64,
    pub query: ModelTransitionSpec,
    pub query_hash: String,
    pub dynamics_hash: String,
    pub trajectory_hash: String,
    pub successor_state: BTreeMap<String, ProcessValue>,
    pub successor_claims: BTreeMap<String, Claim>,
    pub marks: Vec<OccurrenceMark>,
    pub randomness: ModelRandomness,
    pub path: RetainedModelPath,
    pub candidate_hash: String,
}

#[derive(Debug, Serialize)]
struct CandidateFingerprint<'a> {
    schema: &'static str,
    model_hash: &'a str,
    model_revision: u64,
    world_id: &'a str,
    parent_world_hash: &'a str,
    expected_parent_version: u64,
    start_time: f64,
    end_time: f64,
    seed: &'a str,
    roll_index: u64,
    dynamics_hash: &'a str,
    trajectory_hash: &'a str,
    successor_state: &'a BTreeMap<String, ProcessValue>,
    successor_claims: &'a BTreeMap<String, Claim>,
    marks: &'a [OccurrenceMark],
    draw_set_hash: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    comparison_randomness: Option<ComparisonRandomnessFingerprint<'a>>,
}

#[derive(Debug, Serialize)]
struct ComparisonRandomnessFingerprint<'a> {
    stream: &'a str,
    schedule_hash: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRollResult {
    pub candidate: ModelCandidate,
    pub proposed_head: WorldHead,
}

fn normalize_trajectory_summary_spec(
    model: &CompiledModel,
    spec: &mut TrajectorySummarySpec,
) -> EngineResult<()> {
    if spec.schema != TRAJECTORY_SUMMARY_QUERY_SCHEMA {
        return Err(error(format!(
            "unsupported trajectory-summary query schema {}; expected {TRAJECTORY_SUMMARY_QUERY_SCHEMA}",
            spec.schema
        )));
    }
    finite(spec.start_time, "trajectory-summary start_time")?;
    finite(spec.end_time, "trajectory-summary end_time")?;
    if spec.start_time >= spec.end_time {
        return Err(error(
            "trajectory-summary start_time must be strictly less than end_time",
        ));
    }
    if spec.fields.is_empty()
        || spec.fields.len() > MAX_QUERY_OBSERVABLES
        || spec.access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
    {
        return Err(error(
            "trajectory-summary fields must be nonempty and field/access-scope limits must be respected",
        ));
    }
    if spec
        .fields
        .iter()
        .chain(&spec.access_scopes)
        .any(|value| value.trim().is_empty() || value.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(error(
            "trajectory-summary fields and access scopes must be nonempty and bounded",
        ));
    }
    spec.fields.sort();
    spec.fields.dedup();
    spec.access_scopes.sort();
    spec.access_scopes.dedup();
    for process_id in &spec.fields {
        require_query_access(
            model,
            process_id,
            &spec.access_scopes,
            "trajectory-summary field",
        )?;
        let process = model.processes.get(process_id).ok_or_else(|| {
            error(format!(
                "trajectory-summary names unknown process {process_id}"
            ))
        })?;
        if process.value_type.scalar_bounds().is_none() {
            return Err(error(format!(
                "trajectory-summary field {process_id} is not scalar"
            )));
        }
    }
    Ok(())
}

fn transition_identity(
    model: &CompiledModel,
    query: &ModelTransitionSpec,
) -> EngineResult<(ModelTransitionSpec, usize, f64, String, String, String)> {
    let mut normalized = query.clone();
    validate_query(model, &mut normalized)?;
    let raw_steps = (normalized.delta_time / normalized.step_size).ceil();
    if !raw_steps.is_finite() || raw_steps < 1.0 || raw_steps > usize::MAX as f64 {
        return Err(error(
            "query step count is invalid or exceeds the platform range",
        ));
    }
    let step_count = raw_steps as usize;
    let actual_step = normalized.delta_time / step_count as f64;
    normalize_observation_boundaries(&mut normalized, step_count, actual_step)?;
    let query_hash = hash_serializable(&QueryFingerprint {
        schema: MODEL_QUERY_SCHEMA,
        delta_time: normalized.delta_time,
        requested_step_size: normalized.step_size,
        actual_step_size: actual_step,
        step_count,
        direction: normalized.direction,
        precedence: normalized.precedence,
        temporal_resolution: &normalized.temporal_resolution,
        semantic_resolution: &normalized.semantic_resolution,
        interventions: &normalized.interventions,
        observations: &normalized.observations,
        selected_support: &normalized.selected_support,
        requested_observables: &normalized.requested_observables,
        access_scopes: &normalized.access_scopes,
        path: &normalized.path,
        comparison_stream: &normalized.comparison_stream,
    })?;
    let dynamics_hash = hash_serializable(&DynamicsFingerprint {
        schema: MODEL_QUERY_SCHEMA,
        delta_time: normalized.delta_time,
        requested_step_size: normalized.step_size,
        actual_step_size: actual_step,
        step_count,
        direction: normalized.direction,
        precedence: normalized.precedence,
        interventions: &normalized.interventions,
        observations: &normalized.observations,
        comparison_stream: &normalized.comparison_stream,
    })?;
    let schedule_hash = random_schedule_hash(
        normalized.delta_time,
        actual_step,
        step_count,
        normalized.direction,
    )?;
    Ok((
        normalized,
        step_count,
        actual_step,
        query_hash,
        dynamics_hash,
        schedule_hash,
    ))
}

fn validate_candidate_with_frozen_parent(
    model: &CompiledModel,
    parent: &WorldHead,
    candidate: &ModelCandidate,
) -> EngineResult<()> {
    validate_world(model, parent)?;
    if candidate.world_id != parent.world_id
        || candidate.parent_world_hash != parent.world_hash
        || candidate.expected_parent_version != parent.version
        || candidate.start_time.to_bits() != parent.time.to_bits()
    {
        return Err(error(
            "trajectory-summary candidate does not match its model and frozen parent",
        ));
    }
    let step_count = validate_candidate_internal(model, candidate)?;
    validate_retained_candidate_path(model, parent, candidate, step_count)
}

fn validate_project_candidate_replay(
    model: &CompiledModel,
    parent: &WorldHead,
    candidate: &ModelCandidate,
) -> EngineResult<()> {
    let replay = roll_model_transition(model, parent, candidate.query.clone())?;
    if replay.candidate != *candidate {
        return Err(error(format!(
            "project narrative candidate {} does not match deterministic replay from its frozen parent",
            candidate.candidate_hash
        )));
    }
    Ok(())
}

fn validate_candidate_internal(
    model: &CompiledModel,
    candidate: &ModelCandidate,
) -> EngineResult<usize> {
    if candidate.schema != MODEL_CANDIDATE_SCHEMA
        || candidate.model_hash != model.model_hash
        || candidate.model_revision != model.revision.number
    {
        return Err(error(
            "trajectory-summary candidate does not match its model or schema",
        ));
    }
    let (normalized, step_count, actual_step, query_hash, dynamics_hash, schedule_hash) =
        transition_identity(model, &candidate.query)?;
    if normalized != candidate.query
        || candidate.query_hash != query_hash
        || candidate.dynamics_hash != dynamics_hash
        || candidate.seed != candidate.query.seed
        || candidate.roll_index != candidate.query.roll_index
        || candidate.path.retention != candidate.query.path
    {
        return Err(error(
            "trajectory-summary candidate has a stale query or dynamics binding",
        ));
    }
    let signed_step = match candidate.query.direction {
        TimeDirection::Forward => actual_step,
        TimeDirection::Backward => -actual_step,
    };
    let expected_end = candidate.start_time + signed_step * step_count as f64;
    if candidate.end_time.to_bits() != expected_end.to_bits() {
        return Err(error(
            "trajectory-summary candidate end time is inconsistent with its query",
        ));
    }
    validate_world_parts(
        model,
        candidate.end_time,
        &candidate.successor_state,
        &candidate.successor_claims,
    )?;
    let expected_policy = if candidate.query.comparison_stream.is_some() {
        RandomnessPolicy::CommonRandomComparison
    } else {
        RandomnessPolicy::CandidateBound
    };
    if candidate.randomness.generator != "sha256-keyed-box-muller/v1"
        || candidate.randomness.policy != expected_policy
        || candidate.randomness.seed != candidate.seed
        || candidate.randomness.roll_index != candidate.roll_index
        || candidate.randomness.comparison_stream != candidate.query.comparison_stream
        || candidate.randomness.schedule_hash != schedule_hash
        || candidate.randomness.draw_set_hash != hash_serializable(&candidate.randomness.draws)?
    {
        return Err(error(
            "trajectory-summary candidate has a stale randomness binding",
        ));
    }
    let fingerprint =
        CandidateFingerprint {
            schema: MODEL_CANDIDATE_SCHEMA,
            model_hash: &candidate.model_hash,
            model_revision: candidate.model_revision,
            world_id: &candidate.world_id,
            parent_world_hash: &candidate.parent_world_hash,
            expected_parent_version: candidate.expected_parent_version,
            start_time: candidate.start_time,
            end_time: candidate.end_time,
            seed: &candidate.seed,
            roll_index: candidate.roll_index,
            dynamics_hash: &candidate.dynamics_hash,
            trajectory_hash: &candidate.trajectory_hash,
            successor_state: &candidate.successor_state,
            successor_claims: &candidate.successor_claims,
            marks: &candidate.marks,
            draw_set_hash: &candidate.randomness.draw_set_hash,
            comparison_randomness: candidate.randomness.comparison_stream.as_deref().map(
                |stream| ComparisonRandomnessFingerprint {
                    stream,
                    schedule_hash: &candidate.randomness.schedule_hash,
                },
            ),
        };
    if candidate.candidate_hash != hash_serializable(&fingerprint)? {
        return Err(error(
            "trajectory-summary candidate hash is stale or candidate content was modified",
        ));
    }
    Ok(step_count)
}

fn expected_retained_sample_count(path: &PathSpec, total_steps: usize) -> EngineResult<usize> {
    match path {
        PathSpec::Endpoint => Ok(1),
        PathSpec::Full => total_steps
            .checked_add(1)
            .ok_or_else(|| error("trajectory retained-sample count overflow")),
        PathSpec::Decimated { every } => {
            if *every == 0 {
                return Err(error("trajectory decimation interval must be positive"));
            }
            (total_steps.saturating_sub(1) / every)
                .checked_add(2)
                .ok_or_else(|| error("trajectory retained-sample count overflow"))
        }
    }
}

fn validate_retained_candidate_path(
    model: &CompiledModel,
    parent: &WorldHead,
    candidate: &ModelCandidate,
    expected_step_count: usize,
) -> EngineResult<()> {
    let path = &candidate.path;
    if path.schema != MODEL_PATH_SCHEMA {
        return Err(error("trajectory-summary path has an unsupported schema"));
    }
    if path.total_sample_count
        != expected_step_count
            .checked_add(1)
            .ok_or_else(|| error("trajectory retained-sample count overflow"))?
    {
        return Err(error(
            "trajectory-summary path sample count does not match its transition query",
        ));
    }
    let total_steps = path.total_sample_count - 1;
    let expected_count = expected_retained_sample_count(&path.retention, total_steps)?;
    if path.samples.len() != expected_count {
        return Err(error(format!(
            "trajectory-summary retained path has {} samples; expected {expected_count}",
            path.samples.len()
        )));
    }
    let endpoint_mismatch = path.samples.last().map(|sample| sample.step) != Some(total_steps)
        || path.samples.last().map(|sample| &sample.state) != Some(&candidate.successor_state);
    let start_mismatch = !matches!(path.retention, PathSpec::Endpoint)
        && (path.samples.first().map(|sample| sample.step) != Some(0)
            || path.samples.first().map(|sample| &sample.state) != Some(&parent.state));
    if endpoint_mismatch || start_mismatch {
        return Err(error(
            "trajectory-summary retained path does not match its frozen-parent and successor endpoints",
        ));
    }
    let actual_step = candidate.query.delta_time / total_steps as f64;
    let signed_step = match candidate.query.direction {
        TimeDirection::Forward => actual_step,
        TimeDirection::Backward => -actual_step,
    };
    let mut previous_step = None;
    for sample in &path.samples {
        if previous_step.is_some_and(|previous| sample.step <= previous)
            || sample.step > total_steps
        {
            return Err(error(
                "trajectory-summary retained path steps must be strictly increasing and bounded",
            ));
        }
        match path.retention {
            PathSpec::Full if previous_step.is_some_and(|previous| sample.step != previous + 1) => {
                return Err(error(
                    "trajectory-summary full path is missing an intermediate step",
                ));
            }
            PathSpec::Decimated { every }
                if sample.step != 0 && sample.step != total_steps && sample.step % every != 0 =>
            {
                return Err(error(
                    "trajectory-summary decimated path contains an off-cadence step",
                ));
            }
            _ => {}
        }
        let expected_time = candidate.start_time + signed_step * sample.step as f64;
        if sample.time.to_bits() != expected_time.to_bits() {
            return Err(error(
                "trajectory-summary retained path time is inconsistent with its step",
            ));
        }
        validate_world_parts(model, sample.time, &sample.state, &BTreeMap::new())?;
        previous_step = Some(sample.step);
    }
    if matches!(path.retention, PathSpec::Full) {
        let mut hasher = Sha256::new();
        hasher.update(b"life-sim-rust-model-trajectory/v1\0");
        for sample in &path.samples {
            hash_sample(&mut hasher, sample.step, sample.time, &sample.state)?;
        }
        if candidate.trajectory_hash != hex(hasher.finalize()) {
            return Err(error(
                "trajectory-summary full retained path does not match the canonical trajectory hash",
            ));
        }
    }
    Ok(())
}

fn require_summary_retention(candidate: &ModelCandidate) -> EngineResult<()> {
    if matches!(candidate.path.retention, PathSpec::Endpoint) {
        return Err(error(
            "trajectory-summary requires full or decimated retention; endpoint-only retention is insufficient",
        ));
    }
    Ok(())
}

fn scalar_sample(sample: &ModelPathSample, process_id: &str) -> EngineResult<f64> {
    let value = sample.state.get(process_id).ok_or_else(|| {
        error(format!(
            "trajectory-summary retained sample is missing field {process_id}"
        ))
    })?;
    let ProcessValue::Scalar(value) = value else {
        return Err(error(format!(
            "trajectory-summary retained field {process_id} is not scalar"
        )));
    };
    finite(
        *value,
        &format!("trajectory-summary retained field {process_id}"),
    )?;
    Ok(*value)
}

fn interpolate_scalar(
    chronological: &[&ModelPathSample],
    process_id: &str,
    time: f64,
) -> EngineResult<f64> {
    for pair in chronological.windows(2) {
        let left = pair[0];
        let right = pair[1];
        if time >= left.time && time <= right.time {
            let left_value = scalar_sample(left, process_id)?;
            let right_value = scalar_sample(right, process_id)?;
            let fraction = (time - left.time) / (right.time - left.time);
            let value = left_value + fraction * (right_value - left_value);
            finite(
                value,
                &format!("trajectory-summary interpolation for {process_id}"),
            )?;
            return Ok(value);
        }
    }
    Err(error(format!(
        "trajectory-summary time {time} is outside retained coverage for {process_id}"
    )))
}

fn trajectory_summary_hash(summary: &TrajectorySummary) -> EngineResult<String> {
    hash_serializable(&TrajectorySummaryFingerprint {
        schema: TRAJECTORY_SUMMARY_SCHEMA,
        model_hash: &summary.model_hash,
        world_id: &summary.world_id,
        candidate_hash: &summary.candidate_hash,
        trajectory_hash: &summary.trajectory_hash,
        candidate_query_hash: &summary.candidate_query_hash,
        retained_path_hash: &summary.retained_path_hash,
        retention: &summary.retention,
        total_sample_count: summary.total_sample_count,
        retained_sample_count: summary.retained_sample_count,
        time_unit: &summary.time_unit,
        summary_query: &summary.summary_query,
        summary_query_hash: &summary.summary_query_hash,
        fields: &summary.fields,
    })
}

/// Computes exact statistics for the piecewise-linear curve represented by the
/// retained samples. It does not reroll, interpolate hidden samples, or mutate
/// the model session. Decimated summaries are therefore explicitly summaries
/// of the coarser retained path.
pub fn summarize_model_trajectory(
    model: &CompiledModel,
    parent: &WorldHead,
    candidate: &ModelCandidate,
    mut spec: TrajectorySummarySpec,
) -> EngineResult<TrajectorySummary> {
    validate_candidate_with_frozen_parent(model, parent, candidate)?;
    require_summary_retention(candidate)?;
    normalize_trajectory_summary_spec(model, &mut spec)?;

    let mut chronological: Vec<_> = candidate.path.samples.iter().collect();
    if chronological[0].time > chronological[chronological.len() - 1].time {
        chronological.reverse();
    }
    let coverage_start = chronological[0].time;
    let coverage_end = chronological[chronological.len() - 1].time;
    if spec.start_time < coverage_start || spec.end_time > coverage_end {
        return Err(error(format!(
            "trajectory-summary interval [{}, {}] lies outside retained coverage [{coverage_start}, {coverage_end}]",
            spec.start_time, spec.end_time
        )));
    }
    let work = spec
        .fields
        .len()
        .checked_mul(chronological.len())
        .ok_or_else(|| error("trajectory-summary work estimate overflow"))?;
    if work > MAX_TRAJECTORY_SUMMARY_WORK {
        return Err(error(format!(
            "trajectory-summary work {work} exceeds limit {MAX_TRAJECTORY_SUMMARY_WORK}"
        )));
    }

    let mut summaries = Vec::with_capacity(spec.fields.len());
    for process_id in &spec.fields {
        let process = model.processes.get(process_id).ok_or_else(|| {
            error(format!(
                "trajectory-summary names unknown process {process_id}"
            ))
        })?;
        let start = interpolate_scalar(&chronological, process_id, spec.start_time)?;
        let end = interpolate_scalar(&chronological, process_id, spec.end_time)?;
        let mut knots = Vec::new();
        knots.push((spec.start_time, start));
        for sample in &chronological {
            if sample.time > spec.start_time && sample.time < spec.end_time {
                knots.push((sample.time, scalar_sample(sample, process_id)?));
            }
        }
        knots.push((spec.end_time, end));

        let mut integral = 0.0;
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        for (_, value) in &knots {
            minimum = minimum.min(*value);
            maximum = maximum.max(*value);
        }
        for pair in knots.windows(2) {
            integral += (pair[1].0 - pair[0].0) * (pair[0].1 + pair[1].1) / 2.0;
        }
        let time_mean = integral / (spec.end_time - spec.start_time);
        for (label, value) in [
            ("integral", integral),
            ("time mean", time_mean),
            ("minimum", minimum),
            ("maximum", maximum),
        ] {
            finite(
                value,
                &format!("trajectory-summary {label} for {process_id}"),
            )?;
        }
        summaries.push(TrajectoryFieldSummary {
            process_id: process_id.clone(),
            unit: process.unit.clone(),
            integral_unit: process
                .unit
                .as_ref()
                .map(|unit| format!("{unit}*{}", model.time_unit)),
            uncertainty_boundary: TrajectoryUncertaintyBoundary {
                source_process: process.uncertainty.clone(),
                propagation:
                    "source process metadata only; interpolation and aggregation uncertainty are not propagated"
                        .to_owned(),
            },
            start,
            end,
            integral,
            time_mean,
            minimum,
            maximum,
        });
    }

    let summary_query_hash = hash_serializable(&spec)?;
    let mut summary = TrajectorySummary {
        schema: TRAJECTORY_SUMMARY_SCHEMA.to_owned(),
        model_hash: model.model_hash.clone(),
        world_id: candidate.world_id.clone(),
        candidate_hash: candidate.candidate_hash.clone(),
        trajectory_hash: candidate.trajectory_hash.clone(),
        candidate_query_hash: candidate.query_hash.clone(),
        retained_path_hash: hash_serializable(&candidate.path)?,
        retention: candidate.path.retention.clone(),
        total_sample_count: candidate.path.total_sample_count,
        retained_sample_count: candidate.path.samples.len(),
        time_unit: model.time_unit.clone(),
        summary_query: spec,
        summary_query_hash,
        fields: summaries,
        summary_hash: String::new(),
    };
    summary.summary_hash = trajectory_summary_hash(&summary)?;
    Ok(summary)
}

/// Recomputes a summary from its bound candidate path and rejects stale hashes,
/// altered statistics, altered bindings, or noncanonical field ordering.
pub fn validate_model_trajectory_summary(
    model: &CompiledModel,
    parent: &WorldHead,
    candidate: &ModelCandidate,
    summary: &TrajectorySummary,
) -> EngineResult<()> {
    if summary.schema != TRAJECTORY_SUMMARY_SCHEMA
        || summary.summary_hash != trajectory_summary_hash(summary)?
    {
        return Err(error("trajectory summary hash is stale"));
    }
    let expected =
        summarize_model_trajectory(model, parent, candidate, summary.summary_query.clone())?;
    if expected != *summary {
        return Err(error(
            "trajectory summary does not match its candidate, retained path, and query",
        ));
    }
    Ok(())
}

fn evaluate_expression(
    expression: &ScalarExpression,
    state: &BTreeMap<String, ProcessValue>,
    time: f64,
) -> EngineResult<f64> {
    let result = match expression {
        ScalarExpression::Constant { value } => *value,
        ScalarExpression::Process { process } => scalar(state, process)?,
        ScalarExpression::Time => time,
        ScalarExpression::Add { terms } => {
            let mut sum = 0.0;
            for term in terms {
                sum += evaluate_expression(term, state, time)?;
            }
            sum
        }
        ScalarExpression::Multiply { factors } => {
            let mut product = 1.0;
            for factor in factors {
                product *= evaluate_expression(factor, state, time)?;
            }
            product
        }
        ScalarExpression::Subtract { left, right } => {
            evaluate_expression(left, state, time)? - evaluate_expression(right, state, time)?
        }
        ScalarExpression::Divide {
            numerator,
            denominator,
        } => {
            let denominator = evaluate_expression(denominator, state, time)?;
            if denominator == 0.0 {
                return Err(error("scalar expression divided by zero"));
            }
            evaluate_expression(numerator, state, time)? / denominator
        }
        ScalarExpression::Negate { value } => -evaluate_expression(value, state, time)?,
        ScalarExpression::Minimum { values } => {
            let mut minimum = f64::INFINITY;
            for value in values {
                minimum = minimum.min(evaluate_expression(value, state, time)?);
            }
            minimum
        }
        ScalarExpression::Maximum { values } => {
            let mut maximum = f64::NEG_INFINITY;
            for value in values {
                maximum = maximum.max(evaluate_expression(value, state, time)?);
            }
            maximum
        }
        ScalarExpression::Clamp {
            value,
            minimum,
            maximum,
        } => evaluate_expression(value, state, time)?.clamp(*minimum, *maximum),
        ScalarExpression::Absolute { value } => evaluate_expression(value, state, time)?.abs(),
        ScalarExpression::Exponential { value } => evaluate_expression(value, state, time)?.exp(),
        ScalarExpression::Logistic { value } => {
            let value = evaluate_expression(value, state, time)?;
            if value >= 0.0 {
                1.0 / (1.0 + (-value).exp())
            } else {
                let exponential = value.exp();
                exponential / (1.0 + exponential)
            }
        }
    };
    finite(result, "scalar expression result")?;
    Ok(result)
}

fn scalar(state: &BTreeMap<String, ProcessValue>, id: &str) -> EngineResult<f64> {
    match state.get(id) {
        Some(ProcessValue::Scalar(value)) => Ok(*value),
        Some(_) => Err(error(format!("process {id} is not scalar"))),
        None => Err(error(format!("unknown process {id}"))),
    }
}

fn set_scalar(
    model: &CompiledModel,
    state: &mut BTreeMap<String, ProcessValue>,
    id: &str,
    value: f64,
) -> EngineResult<()> {
    finite(value, &format!("process {id} result"))?;
    let bounds = model
        .processes
        .get(id)
        .and_then(|process| process.value_type.scalar_bounds())
        .ok_or_else(|| error(format!("process {id} is not scalar")))?;
    state.insert(
        id.to_owned(),
        ProcessValue::Scalar(value.clamp(bounds.minimum, bounds.maximum)),
    );
    Ok(())
}

fn set_observed_value(
    model: &CompiledModel,
    state: &mut BTreeMap<String, ProcessValue>,
    id: &str,
    value: &ProcessValue,
) -> EngineResult<()> {
    let process = model
        .processes
        .get(id)
        .ok_or_else(|| error(format!("unknown observed process {id}")))?;
    if process.update_mode != ProcessUpdateMode::Observed {
        return Err(error(format!(
            "process {id} does not declare update_mode observed"
        )));
    }
    validate_process_value(
        &process.value_type,
        value,
        &format!("observed process {id}"),
    )?;
    state.insert(id.to_owned(), value.clone());
    Ok(())
}

fn compare(value: f64, comparison: Comparison, threshold: f64) -> bool {
    match comparison {
        Comparison::LessThan => value < threshold,
        Comparison::LessOrEqual => value <= threshold,
        Comparison::GreaterThan => value > threshold,
        Comparison::GreaterOrEqual => value >= threshold,
    }
}

fn resolution_applies(precedence: ResolutionPrecedence, direction: ResolutionDirection) -> bool {
    match precedence {
        ResolutionPrecedence::Coarse => matches!(
            direction,
            ResolutionDirection::Refine | ResolutionDirection::Reconcile
        ),
        ResolutionPrecedence::Fine => matches!(
            direction,
            ResolutionDirection::Aggregate | ResolutionDirection::Reconcile
        ),
        ResolutionPrecedence::Balanced => true,
    }
}

fn process_state_writer<'a>(model: &'a CompiledModel, target: &str) -> Option<&'a str> {
    model.laws.iter().find_map(|law| {
        if !law.enabled {
            return None;
        }
        let writes = match &law.operator {
            LawOperator::Evolution {
                target: law_target, ..
            }
            | LawOperator::Relation {
                target: law_target, ..
            }
            | LawOperator::Resolution {
                target: law_target, ..
            } => law_target == target,
            LawOperator::Occurrence { effects, .. } => {
                effects.iter().any(|effect| effect.target == target)
            }
            LawOperator::Epistemic { .. } => false,
        };
        writes.then_some(law.id.as_str())
    })
}

fn normalize_observation_boundaries(
    query: &mut ModelTransitionSpec,
    step_count: usize,
    actual_step: f64,
) -> EngineResult<()> {
    let mut process_steps = BTreeSet::new();
    for observation in &mut query.observations {
        let raw_step = observation.offset / actual_step;
        let rounded = raw_step.round();
        let tolerance = f64::EPSILON
            * 16.0
            * query
                .delta_time
                .abs()
                .max(observation.offset.abs())
                .max(1.0);
        if !rounded.is_finite()
            || rounded < 1.0
            || rounded > step_count as f64
            || (observation.offset - rounded * actual_step).abs() > tolerance
        {
            return Err(error(format!(
                "observation {} offset {} is not an exactly reachable transition step boundary",
                observation.id, observation.offset
            )));
        }
        let step = rounded as usize;
        observation.offset = step as f64 * actual_step;
        if !process_steps.insert((observation.target.clone(), step)) {
            return Err(error(format!(
                "multiple observations target {} at transition step {step}",
                observation.target
            )));
        }
    }
    query.observations.sort_by(|left, right| {
        left.offset
            .total_cmp(&right.offset)
            .then_with(|| left.target.cmp(&right.target))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(())
}

fn validate_query(model: &CompiledModel, query: &mut ModelTransitionSpec) -> EngineResult<()> {
    if query.schema != MODEL_QUERY_SCHEMA {
        return Err(error(format!(
            "unsupported model query schema {}; expected {MODEL_QUERY_SCHEMA}",
            query.schema
        )));
    }
    finite(query.delta_time, "query delta_time")?;
    finite(query.step_size, "query step_size")?;
    if query.delta_time <= 0.0
        || query.step_size <= 0.0
        || query.delta_time > MAX_QUERY_DURATION
        || query.step_size > MAX_QUERY_DURATION
        || query.seed.is_empty()
        || query.seed.len() > MAX_QUERY_STRING_BYTES
    {
        return Err(error(
            "query delta_time and step_size must be positive and at most 30, and seed must be nonempty and bounded",
        ));
    }
    if query
        .comparison_stream
        .as_ref()
        .is_some_and(|stream| stream.trim().is_empty() || stream.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(error(
            "query comparison_stream must be nonempty and bounded when supplied",
        ));
    }
    if query.interventions.len() > MAX_QUERY_INTERVENTIONS
        || query.observations.len() > MAX_QUERY_OBSERVATIONS
        || query.selected_support.len() > MAX_QUERY_SUPPORT
        || query.requested_observables.len() > MAX_QUERY_OBSERVABLES
        || query.access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
    {
        return Err(error(
            "query exceeds an intervention, observation, support, observable, or access-scope limit",
        ));
    }
    if !query.observations.is_empty() && query.direction != TimeDirection::Forward {
        return Err(error(
            "time-stamped observations require forward transition direction",
        ));
    }
    for label in [&query.temporal_resolution, &query.semantic_resolution]
        .into_iter()
        .flatten()
    {
        if label.is_empty() || label.len() > MAX_QUERY_STRING_BYTES {
            return Err(error(
                "query resolution labels must be nonempty and bounded",
            ));
        }
    }
    if matches!(query.path, PathSpec::Decimated { every: 0 }) {
        return Err(error("query decimation interval must be positive"));
    }
    query
        .interventions
        .sort_by(|a, b| a.offset.total_cmp(&b.offset).then_with(|| a.id.cmp(&b.id)));
    let mut ids = BTreeSet::new();
    for intervention in &query.interventions {
        finite(
            intervention.offset,
            &format!("intervention {} offset", intervention.id),
        )?;
        if intervention.id.trim().is_empty()
            || intervention.id.len() > MAX_QUERY_STRING_BYTES
            || !ids.insert(intervention.id.as_str())
            || intervention.offset < 0.0
            || intervention.offset > query.delta_time
        {
            return Err(error(format!(
                "intervention {} is invalid",
                intervention.id
            )));
        }
        if intervention.application == Some(InterventionApplication::InitialBoundary)
            && intervention.offset != 0.0
        {
            return Err(error(format!(
                "intervention {} application initial_boundary requires offset 0",
                intervention.id
            )));
        }
        validate_effect(&intervention.effect, &model.processes, &intervention.id)?;
    }
    let mut observation_ids = BTreeSet::new();
    for observation in &query.observations {
        finite(
            observation.offset,
            &format!("observation {} offset", observation.id),
        )?;
        if observation.id.trim().is_empty()
            || observation.id.len() > MAX_QUERY_STRING_BYTES
            || !observation_ids.insert(observation.id.as_str())
        {
            return Err(error(format!(
                "observation {} id must be unique, nonempty, and bounded",
                observation.id
            )));
        }
        if observation.offset <= 0.0 || observation.offset > query.delta_time {
            return Err(error(format!(
                "observation {} offset must satisfy 0 < offset <= delta_time",
                observation.id
            )));
        }
        if observation.holder.trim().is_empty()
            || observation.holder.len() > MAX_QUERY_STRING_BYTES
            || observation.provenance.is_empty()
            || observation.provenance.len() > MAX_OBSERVATION_PROVENANCE
            || observation
                .provenance
                .iter()
                .any(|item| item.trim().is_empty() || item.len() > MAX_QUERY_STRING_BYTES)
            || observation.authority.source.trim().is_empty()
            || observation.authority.source.len() > MAX_QUERY_STRING_BYTES
            || observation
                .unit
                .as_ref()
                .is_some_and(|unit| unit.trim().is_empty() || unit.len() > MAX_QUERY_STRING_BYTES)
        {
            return Err(error(format!(
                "observation {} has invalid or unbounded metadata",
                observation.id
            )));
        }
        if !matches!(
            observation.evidence_type,
            EvidenceType::Observation | EvidenceType::Report
        ) {
            return Err(error(format!(
                "observation {} requires observation or report evidence",
                observation.id
            )));
        }
        finite(
            observation.authority.weight,
            &format!("observation {} authority", observation.id),
        )?;
        if !(0.0..=1.0).contains(&observation.authority.weight) {
            return Err(error(format!(
                "observation {} authority must be in [0,1]",
                observation.id
            )));
        }
        validate_uncertainty(
            &observation.uncertainty,
            &format!("observation {} uncertainty", observation.id),
        )?;
        let process = model.processes.get(&observation.target).ok_or_else(|| {
            error(format!(
                "observation {} names unknown process {}",
                observation.id, observation.target
            ))
        })?;
        if process.update_mode != ProcessUpdateMode::Observed {
            return Err(error(format!(
                "observation {} target {} must declare update_mode observed",
                observation.id, observation.target
            )));
        }
        if observation.unit != process.unit {
            return Err(error(format!(
                "observation {} unit does not exactly match process {} unit",
                observation.id, observation.target
            )));
        }
        validate_process_value(
            &process.value_type,
            &observation.value,
            &format!("observation {} value", observation.id),
        )?;
        if let Some(writer) = process_state_writer(model, &observation.target) {
            return Err(error(format!(
                "observation {} target {} is also written by law {writer}; observed values must carry between observations",
                observation.id, observation.target
            )));
        }
    }
    query.requested_observables.sort();
    query.requested_observables.dedup();
    query.access_scopes.sort();
    query.access_scopes.dedup();
    query.selected_support.sort();
    query.selected_support.dedup();
    if query
        .access_scopes
        .iter()
        .chain(&query.selected_support)
        .chain(&query.requested_observables)
        .any(|value| value.is_empty() || value.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(error("query access scopes must be nonempty and bounded"));
    }
    for intervention in &query.interventions {
        require_query_access(
            model,
            &intervention.effect.target,
            &query.access_scopes,
            &format!("intervention {} target", intervention.id),
        )?;
        if model
            .processes
            .get(&intervention.effect.target)
            .is_some_and(|process| process.update_mode == ProcessUpdateMode::Observed)
        {
            return Err(error(format!(
                "intervention {} cannot write observed process {}; use a timed observation",
                intervention.id, intervention.effect.target
            )));
        }
        let mut references = BTreeSet::new();
        expression_references(&intervention.effect.value, &mut references);
        for process_id in references {
            require_query_access(
                model,
                &process_id,
                &query.access_scopes,
                &format!("intervention {} input", intervention.id),
            )?;
        }
    }
    for observation in &query.observations {
        require_query_access(
            model,
            &observation.target,
            &query.access_scopes,
            &format!("observation {} target", observation.id),
        )?;
    }
    for process_id in &query.selected_support {
        require_query_access(model, process_id, &query.access_scopes, "query support")?;
    }
    for observable in &query.requested_observables {
        require_query_access(model, observable, &query.access_scopes, "query observable")?;
    }
    Ok(())
}

fn require_query_access(
    model: &CompiledModel,
    process_id: &str,
    access_scopes: &[String],
    context: &str,
) -> EngineResult<()> {
    let process = model
        .processes
        .get(process_id)
        .ok_or_else(|| error(format!("{context} names unknown process {process_id}")))?;
    if !process.access_scopes.is_empty()
        && !process
            .access_scopes
            .iter()
            .any(|scope| access_scopes.contains(scope))
    {
        return Err(error(format!(
            "query lacks an access scope for {context} {process_id}"
        )));
    }
    Ok(())
}

#[derive(Serialize)]
struct QueryFingerprint<'a> {
    schema: &'static str,
    delta_time: f64,
    requested_step_size: f64,
    actual_step_size: f64,
    step_count: usize,
    direction: TimeDirection,
    precedence: ResolutionPrecedence,
    temporal_resolution: &'a Option<String>,
    semantic_resolution: &'a Option<String>,
    interventions: &'a [TimedIntervention],
    observations: &'a [TimedObservation],
    selected_support: &'a [String],
    requested_observables: &'a [String],
    access_scopes: &'a [String],
    path: &'a PathSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    comparison_stream: &'a Option<String>,
}

#[derive(Serialize)]
struct DynamicsFingerprint<'a> {
    schema: &'static str,
    delta_time: f64,
    requested_step_size: f64,
    actual_step_size: f64,
    step_count: usize,
    direction: TimeDirection,
    precedence: ResolutionPrecedence,
    interventions: &'a [TimedIntervention],
    observations: &'a [TimedObservation],
    #[serde(skip_serializing_if = "Option::is_none")]
    comparison_stream: &'a Option<String>,
}

#[derive(Serialize)]
struct RandomScheduleFingerprint {
    schema: &'static str,
    delta_time: f64,
    actual_step_size: f64,
    step_count: usize,
    direction: TimeDirection,
}

fn random_schedule_hash(
    delta_time: f64,
    actual_step_size: f64,
    step_count: usize,
    direction: TimeDirection,
) -> EngineResult<String> {
    hash_serializable(&RandomScheduleFingerprint {
        schema: RANDOM_SCHEDULE_SCHEMA,
        delta_time,
        actual_step_size,
        step_count,
        direction,
    })
}

fn master_key(
    seed: &str,
    parent: &str,
    dynamics_hash: &str,
    comparison_stream: Option<&str>,
    schedule_hash: &str,
    roll_index: u64,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    if let Some(stream) = comparison_stream {
        hasher.update(b"life-sim-rust-model-common-random-master-key/v1\0");
        hasher.update(seed.as_bytes());
        hasher.update([0]);
        hasher.update(stream.as_bytes());
        hasher.update([0]);
        hasher.update(schedule_hash.as_bytes());
        hasher.update([0]);
    } else {
        // Preserve the original candidate-bound stream byte-for-byte when no
        // explicit comparison stream is requested.
        hasher.update(b"life-sim-rust-model-master-key/v1\0");
        hasher.update(seed.as_bytes());
        hasher.update([0]);
        hasher.update(parent.as_bytes());
        hasher.update([0]);
        hasher.update(dynamics_hash.as_bytes());
        hasher.update([0]);
    }
    hasher.update(roll_index.to_le_bytes());
    hasher.finalize().into()
}

fn random_draw(master: [u8; 32], key: &str, step: usize, index: u64) -> RandomDraw {
    let mut hasher = Sha256::new();
    hasher.update(b"life-sim-rust-model-draw/v1\0");
    hasher.update(master);
    hasher.update(key.as_bytes());
    hasher.update([0]);
    hasher.update((step as u64).to_le_bytes());
    hasher.update(index.to_le_bytes());
    let digest = hasher.finalize();
    let raw = u64::from_le_bytes(digest[..8].try_into().unwrap());
    RandomDraw {
        key: format!("{key}:{index}"),
        step,
        raw_hex: format!("{raw:016x}"),
        uniform: (raw as f64 + 0.5) / 18_446_744_073_709_551_616.0,
    }
}

fn normal_draws(master: [u8; 32], key: &str, step: usize) -> (f64, RandomDraw, RandomDraw) {
    let first = random_draw(master, key, step, 0);
    let second = random_draw(master, key, step, 1);
    let normal =
        (-2.0 * first.uniform.ln()).sqrt() * (std::f64::consts::TAU * second.uniform).cos();
    (normal, first, second)
}

fn retain(path: &PathSpec, step: usize, total: usize) -> bool {
    match path {
        PathSpec::Endpoint => step == total,
        PathSpec::Full => true,
        PathSpec::Decimated { every } => step == 0 || step == total || step % every == 0,
    }
}

fn path_capacity(path: &PathSpec, total: usize) -> usize {
    match path {
        PathSpec::Endpoint => 1,
        PathSpec::Full => total.saturating_add(1),
        PathSpec::Decimated { every } => total / every + 2,
    }
}

fn hash_sample(
    hasher: &mut Sha256,
    step: usize,
    time: f64,
    state: &BTreeMap<String, ProcessValue>,
) -> EngineResult<()> {
    hasher.update((step as u64).to_le_bytes());
    hasher.update(time.to_bits().to_le_bytes());
    let encoded = serde_json::to_vec(state)
        .map_err(|cause| error(format!("failed to encode trajectory state: {cause}")))?;
    hasher.update((encoded.len() as u64).to_le_bytes());
    hasher.update(encoded);
    Ok(())
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    let mut output = String::new();
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes.as_ref() {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0xf) as usize] as char);
    }
    output
}

fn validate_execution_budget(
    model: &CompiledModel,
    parent: &WorldHead,
    query: &ModelTransitionSpec,
    step_count: usize,
) -> EngineResult<()> {
    if step_count > MAX_STEP_COUNT {
        return Err(error(format!(
            "query step count {step_count} exceeds limit {MAX_STEP_COUNT}"
        )));
    }
    let work = execution_work_estimate(model, query, step_count)?;
    if work > MAX_LAW_PROCESS_EVALUATIONS {
        return Err(error(format!(
            "query estimated law/process work {work} exceeds limit {MAX_LAW_PROCESS_EVALUATIONS}"
        )));
    }

    let retained_samples = path_capacity(&query.path, step_count);
    let state_bytes = serde_json::to_vec(&parent.state)
        .map_err(|cause| error(format!("failed to estimate retained state size: {cause}")))?
        .len();
    let state_byte_steps = state_bytes
        .checked_mul(step_count.saturating_add(1))
        .ok_or_else(|| error("query state-byte work estimate overflow"))?;
    if state_byte_steps > MAX_STATE_BYTE_STEPS {
        return Err(error(format!(
            "query state-byte work {state_byte_steps} exceeds limit {MAX_STATE_BYTE_STEPS}; use fewer steps or a smaller state"
        )));
    }
    let retained_bytes = retained_samples
        .checked_mul(state_bytes)
        .ok_or_else(|| error("query retained-state estimate overflow"))?;
    if retained_bytes > MAX_RETAINED_STATE_BYTES {
        return Err(error(format!(
            "query retained-state estimate {retained_bytes} bytes exceeds limit {MAX_RETAINED_STATE_BYTES}; request endpoint or decimated retention"
        )));
    }

    let mut activity_width = 0usize;
    let mut activity_bytes_per_step = 0usize;
    for law in &model.laws {
        let (records, bytes) = match &law.operator {
            LawOperator::Evolution {
                innovation: Some(innovation),
                ..
            } => (
                2usize,
                law.id
                    .len()
                    .checked_add(innovation.name.len())
                    .and_then(|value| value.checked_add(256))
                    .and_then(|value| value.checked_mul(2))
                    .ok_or_else(|| error("query activity-byte estimate overflow"))?,
            ),
            LawOperator::Occurrence {
                trigger: OccurrenceTrigger::Hazard { .. },
                ..
            } => (
                2usize,
                law.id
                    .len()
                    .checked_mul(3)
                    .and_then(|value| value.checked_add(512))
                    .ok_or_else(|| error("query activity-byte estimate overflow"))?,
            ),
            LawOperator::Occurrence { .. } => (
                1usize,
                law.id
                    .len()
                    .checked_mul(2)
                    .and_then(|value| value.checked_add(256))
                    .ok_or_else(|| error("query activity-byte estimate overflow"))?,
            ),
            _ => (0, 0),
        };
        activity_width = activity_width
            .checked_add(records)
            .ok_or_else(|| error("query activity-record estimate overflow"))?;
        activity_bytes_per_step = activity_bytes_per_step
            .checked_add(bytes)
            .ok_or_else(|| error("query activity-byte estimate overflow"))?;
    }
    let activity = step_count
        .checked_mul(activity_width)
        .and_then(|value| value.checked_add(query.interventions.len()))
        .and_then(|value| value.checked_add(query.observations.len()))
        .ok_or_else(|| error("query activity-record estimate overflow"))?;
    if activity > MAX_POTENTIAL_ACTIVITY_RECORDS {
        return Err(error(format!(
            "query potential draw/mark records {activity} exceed limit {MAX_POTENTIAL_ACTIVITY_RECORDS}"
        )));
    }
    let intervention_activity_bytes =
        query.interventions.iter().try_fold(0usize, |total, item| {
            total
                .checked_add(item.id.len().saturating_mul(2).saturating_add(256))
                .ok_or_else(|| error("query activity-byte estimate overflow"))
        })?;
    let observation_activity_bytes = serialized_size(&query.observations)?;
    let activity_bytes = step_count
        .checked_mul(activity_bytes_per_step)
        .and_then(|value| value.checked_add(intervention_activity_bytes))
        .and_then(|value| value.checked_add(observation_activity_bytes))
        .ok_or_else(|| error("query activity-byte estimate overflow"))?;
    if activity_bytes > MAX_POTENTIAL_ACTIVITY_BYTES {
        return Err(error(format!(
            "query potential activity bytes {activity_bytes} exceed limit {MAX_POTENTIAL_ACTIVITY_BYTES}"
        )));
    }
    Ok(())
}

fn execution_work_estimate(
    model: &CompiledModel,
    query: &ModelTransitionSpec,
    step_count: usize,
) -> EngineResult<usize> {
    let work_width = model
        .processes
        .len()
        .checked_add(model.laws.len())
        .and_then(|value| value.checked_add(model.expression_node_count))
        .ok_or_else(|| error("query work estimate overflow"))?;
    let stepped_work = step_count
        .checked_mul(work_width)
        .ok_or_else(|| error("query work estimate overflow"))?;
    let initial_boundary_work = if query.interventions.iter().any(|intervention| {
        intervention.application == Some(InterventionApplication::InitialBoundary)
    }) {
        work_width
    } else {
        0
    };
    let intervention_work = query.interventions.iter().try_fold(0usize, |total, item| {
        let (nodes, _) = expression_metrics(&item.effect.value)?;
        total
            .checked_add(nodes.saturating_add(1))
            .ok_or_else(|| error("query intervention work estimate overflow"))
    })?;
    stepped_work
        .checked_add(initial_boundary_work)
        .and_then(|value| value.checked_add(intervention_work))
        .and_then(|value| value.checked_add(query.observations.len()))
        .ok_or_else(|| error("query work estimate overflow"))
}

fn candidate_replay_work(
    model: &CompiledModel,
    parent: &WorldHead,
    query: &ModelTransitionSpec,
) -> EngineResult<usize> {
    validate_world(model, parent)?;
    let (normalized, step_count, _, _, _, _) = transition_identity(model, query)?;
    validate_execution_budget(model, parent, &normalized, step_count)?;
    execution_work_estimate(model, &normalized, step_count)
}

fn apply_simultaneous_effects(
    model: &CompiledModel,
    evaluation_state: &BTreeMap<String, ProcessValue>,
    destination: &mut BTreeMap<String, ProcessValue>,
    time: f64,
    effects: impl IntoIterator<Item = (String, StateEffect)>,
) -> EngineResult<()> {
    let mut additions: BTreeMap<String, f64> = BTreeMap::new();
    let mut sets: BTreeMap<String, (String, f64)> = BTreeMap::new();
    for (source, effect) in effects {
        let value = evaluate_expression(&effect.value, evaluation_state, time)?;
        match effect.mode {
            EffectMode::Add => *additions.entry(effect.target).or_insert(0.0) += value,
            EffectMode::Set => {
                if let Some((previous, _)) =
                    sets.insert(effect.target.clone(), (source.clone(), value))
                {
                    return Err(error(format!(
                        "conflicting set effects from {previous} and {source} target {}",
                        effect.target
                    )));
                }
            }
        }
    }
    let targets: BTreeSet<_> = additions.keys().chain(sets.keys()).cloned().collect();
    for target in targets {
        let base = sets
            .get(&target)
            .map(|(_, value)| *value)
            .unwrap_or(scalar(destination, &target)?);
        set_scalar(
            model,
            destination,
            &target,
            base + additions.get(&target).copied().unwrap_or(0.0),
        )?;
    }
    Ok(())
}

fn apply_exact_state_laws(
    model: &CompiledModel,
    state: &mut BTreeMap<String, ProcessValue>,
    time: f64,
    precedence: ResolutionPrecedence,
    active: &BTreeSet<String>,
) -> EngineResult<()> {
    for index in &model.derived_order {
        let law = &model.laws[*index];
        if !law.enabled || !active.contains(&law.id) {
            continue;
        }
        let (target, expression, applies) = match &law.operator {
            LawOperator::Relation { target, value } => (target, value, true),
            LawOperator::Resolution {
                target,
                value,
                direction,
            } => (target, value, resolution_applies(precedence, *direction)),
            _ => unreachable!(),
        };
        if applies {
            let value = evaluate_expression(expression, state, time)?;
            set_scalar(model, state, target, value)?;
        }
    }
    Ok(())
}

pub fn roll_model_transition(
    model: &CompiledModel,
    parent: &WorldHead,
    query: ModelTransitionSpec,
) -> EngineResult<ModelRollResult> {
    validate_world(model, parent)?;
    let (query, step_count, actual_step, query_hash, dynamics_hash, schedule_hash) =
        transition_identity(model, &query)?;
    validate_execution_budget(model, parent, &query, step_count)?;
    let signed_step = match query.direction {
        TimeDirection::Forward => actual_step,
        TimeDirection::Backward => -actual_step,
    };
    let end_time = parent.time + signed_step * step_count as f64;
    finite(end_time, "query end time")?;
    let master = master_key(
        &query.seed,
        &parent.world_hash,
        &dynamics_hash,
        query.comparison_stream.as_deref(),
        &schedule_hash,
        query.roll_index,
    );

    let mut state = parent.state.clone();
    let mut claims = parent.claims.clone();
    let mut marks = Vec::new();
    let mut draws = Vec::new();
    let mut activated_ever = BTreeSet::new();
    let mut threshold_previous = BTreeMap::new();
    for law in &model.laws {
        if let LawOperator::Occurrence {
            trigger:
                OccurrenceTrigger::Threshold {
                    expression,
                    comparison,
                    threshold,
                    ..
                },
            ..
        } = &law.operator
        {
            let value = evaluate_expression(expression, &state, parent.time)?;
            threshold_previous.insert(law.id.clone(), compare(value, *comparison, *threshold));
        }
    }

    let mut samples = Vec::with_capacity(path_capacity(&query.path, step_count));
    if retain(&query.path, 0, step_count) {
        samples.push(ModelPathSample {
            step: 0,
            time: parent.time,
            state: state.clone(),
        });
    }
    let mut trajectory_hasher = Sha256::new();
    trajectory_hasher.update(b"life-sim-rust-model-trajectory/v1\0");
    hash_sample(&mut trajectory_hasher, 0, parent.time, &state)?;

    let initial_boundary_interventions: Vec<_> = query
        .interventions
        .iter()
        .filter(|intervention| {
            intervention.application == Some(InterventionApplication::InitialBoundary)
        })
        .collect();
    if !initial_boundary_interventions.is_empty() {
        let parent_boundary_state = state.clone();
        apply_simultaneous_effects(
            model,
            &parent_boundary_state,
            &mut state,
            parent.time,
            initial_boundary_interventions.iter().map(|intervention| {
                (
                    format!("intervention:{}", intervention.id),
                    intervention.effect.clone(),
                )
            }),
        )?;
        for intervention in &initial_boundary_interventions {
            marks.push(OccurrenceMark {
                id: format!("intervention:{}", intervention.id),
                source: intervention.id.clone(),
                kind: "intervention".to_owned(),
                step: 0,
                time: parent.time,
            });
        }
        let always_active = model
            .laws
            .iter()
            .filter(|law| law.enabled && law.activation == LawActivation::Always)
            .map(|law| law.id.clone())
            .collect();
        apply_exact_state_laws(
            model,
            &mut state,
            parent.time,
            query.precedence,
            &always_active,
        )?;
    }

    let scheduled_interventions: Vec<_> = query
        .interventions
        .iter()
        .filter(|intervention| intervention.application.is_none())
        .collect();
    let mut intervention_index = 0usize;
    let mut observation_index = 0usize;
    for step_index in 0..step_count {
        let start_offset = step_index as f64 * actual_step;
        let end_offset = (step_index + 1) as f64 * actual_step;
        let time = parent.time + signed_step * step_index as f64;
        let completed_time = parent.time + signed_step * (step_index + 1) as f64;
        let mut active = BTreeSet::new();
        for law in &model.laws {
            if law.enabled && law.activation == LawActivation::Always {
                active.insert(law.id.clone());
            }
        }
        let mut effects: Vec<(String, StateEffect)> = Vec::new();
        for law in &model.laws {
            if !law.enabled {
                continue;
            }
            let LawOperator::Occurrence {
                trigger,
                effects: law_effects,
                activates,
            } = &law.operator
            else {
                continue;
            };
            let fired = match trigger {
                OccurrenceTrigger::Always => true,
                OccurrenceTrigger::Threshold {
                    expression,
                    comparison,
                    threshold,
                    firing,
                } => {
                    let current = compare(
                        evaluate_expression(expression, &state, time)?,
                        *comparison,
                        *threshold,
                    );
                    let previous = threshold_previous
                        .insert(law.id.clone(), current)
                        .unwrap_or(false);
                    match firing {
                        TriggerFiring::OnEnter => current && !previous,
                        TriggerFiring::WhileTrue => current,
                    }
                }
                OccurrenceTrigger::Hazard { rate } => {
                    let rate = evaluate_expression(rate, &state, time)?;
                    if rate < 0.0 {
                        return Err(error(format!(
                            "hazard law {} produced a negative rate",
                            law.id
                        )));
                    }
                    let key = format!("law:{}:hazard", law.id);
                    let draw = random_draw(master, &key, step_index, 0);
                    let fired = draw.uniform < 1.0 - (-rate * actual_step).exp();
                    draws.push(draw);
                    fired
                }
            };
            if fired {
                activated_ever.insert(law.id.clone());
                for target in activates {
                    active.insert(target.clone());
                    activated_ever.insert(target.clone());
                }
                effects.extend(
                    law_effects
                        .iter()
                        .cloned()
                        .map(|effect| (law.id.clone(), effect)),
                );
                marks.push(OccurrenceMark {
                    id: format!("{}:{step_index}", law.id),
                    source: law.id.clone(),
                    kind: "law_occurrence".to_owned(),
                    step: step_index + 1,
                    time: completed_time,
                });
            }
        }
        while let Some(intervention) = scheduled_interventions.get(intervention_index) {
            if intervention.offset > end_offset {
                break;
            }
            debug_assert!(
                intervention.offset > start_offset
                    || (step_index == 0 && intervention.offset == 0.0)
            );
            effects.push((
                format!("intervention:{}", intervention.id),
                intervention.effect.clone(),
            ));
            marks.push(OccurrenceMark {
                id: format!("intervention:{}", intervention.id),
                source: intervention.id.clone(),
                kind: "intervention".to_owned(),
                step: step_index + 1,
                time: completed_time,
            });
            intervention_index += 1;
        }

        // Every evolution law reads the same frozen state. Contributions add.
        let mut derivatives: BTreeMap<String, f64> = BTreeMap::new();
        let mut innovations: BTreeMap<String, f64> = BTreeMap::new();
        for law in &model.laws {
            if !law.enabled || !active.contains(&law.id) {
                continue;
            }
            let LawOperator::Evolution {
                target,
                derivative,
                innovation,
            } = &law.operator
            else {
                continue;
            };
            *derivatives.entry(target.clone()).or_insert(0.0) +=
                evaluate_expression(derivative, &state, time)?;
            if let Some(innovation) = innovation {
                let scale = evaluate_expression(&innovation.scale, &state, time)?;
                if scale < 0.0 {
                    return Err(error(format!(
                        "law {} innovation scale is negative",
                        law.id
                    )));
                }
                let key = format!("law:{}:innovation:{}", law.id, innovation.name);
                let (normal, first, second) = normal_draws(master, &key, step_index);
                draws.push(first);
                draws.push(second);
                *innovations.entry(target.clone()).or_insert(0.0) +=
                    scale * actual_step.sqrt() * normal;
            }
        }
        let mut next = state.clone();
        for (target, derivative) in derivatives {
            let value = scalar(&state, &target)?
                + derivative * signed_step
                + innovations.remove(&target).unwrap_or(0.0);
            set_scalar(model, &mut next, &target, value)?;
        }

        // Occurrence and legacy intervention effects are simultaneous: at most
        // one set, plus summed additions, after the evolved proposal.
        apply_simultaneous_effects(model, &state, &mut next, time, effects)?;

        // External observations are authoritative at their exact value time.
        // They land after evolved and marked-event effects, but before exact
        // relations/resolution so derived values see the newly observed state.
        while let Some(observation) = query.observations.get(observation_index) {
            if observation.offset > end_offset {
                break;
            }
            if observation.offset.to_bits() != end_offset.to_bits() {
                return Err(error(format!(
                    "observation {} did not resolve to its exact transition boundary",
                    observation.id
                )));
            }
            set_observed_value(model, &mut next, &observation.target, &observation.value)?;
            let claim_id = format!(
                "observation:{}:{:016x}:{}",
                observation.target,
                completed_time.to_bits(),
                observation.id
            );
            let process = model
                .processes
                .get(&observation.target)
                .expect("observation target was validated");
            let claim = Claim {
                id: claim_id.clone(),
                subject: observation.target.clone(),
                value: observation.value.clone(),
                uncertainty: observation.uncertainty.clone(),
                evidence_type: observation.evidence_type,
                holder: observation.holder.clone(),
                evidence_cutoff: completed_time,
                provenance: observation.provenance.clone(),
                authority: observation.authority.clone(),
                mode: Some(ClaimMode::Observed),
                value_time: Some(completed_time),
                access_scopes: process.access_scopes.clone(),
            };
            validate_claim(&claim, &model.processes)?;
            if claims.insert(claim_id.clone(), claim).is_some() {
                return Err(error(format!(
                    "observation {} would overwrite existing claim {claim_id}",
                    observation.id
                )));
            }
            marks.push(OccurrenceMark {
                id: format!("observation:{}", observation.id),
                source: observation.id.clone(),
                kind: "observation".to_owned(),
                step: step_index + 1,
                time: completed_time,
            });
            observation_index += 1;
        }

        // Exact relations and scale resolution run after the successor proposal,
        // in a validated acyclic order.
        apply_exact_state_laws(model, &mut next, completed_time, query.precedence, &active)?;
        state = next;
        hash_sample(
            &mut trajectory_hasher,
            step_index + 1,
            completed_time,
            &state,
        )?;
        if retain(&query.path, step_index + 1, step_count) {
            samples.push(ModelPathSample {
                step: step_index + 1,
                time: completed_time,
                state: state.clone(),
            });
        }
    }
    debug_assert_eq!(intervention_index, scheduled_interventions.len());
    debug_assert_eq!(observation_index, query.observations.len());

    // Backward reconstruction remains causal at the reconstructed time: later
    // evidence cannot silently survive as if it had already been observed.
    if query.direction == TimeDirection::Backward {
        claims.retain(|_, claim| claim.evidence_cutoff <= end_time);
    }

    // Epistemic laws produce typed, attributed endpoint claims; state remains distinct.
    for law in &model.laws {
        if !law.enabled
            || (law.activation == LawActivation::Gated && !activated_ever.contains(&law.id))
        {
            continue;
        }
        let LawOperator::Epistemic {
            claim: template,
            value,
        } = &law.operator
        else {
            continue;
        };
        let claim = Claim {
            id: template.id.clone(),
            subject: template.subject.clone(),
            value: ProcessValue::Scalar(evaluate_expression(value, &state, end_time)?),
            uncertainty: template.uncertainty.clone(),
            evidence_type: template.evidence_type,
            holder: template.holder.clone(),
            evidence_cutoff: end_time,
            provenance: template.provenance.clone(),
            authority: template.authority.clone(),
            mode: Some(ClaimMode::Derived),
            value_time: Some(end_time),
            access_scopes: template.access_scopes.clone(),
        };
        validate_claim(&claim, &model.processes)?;
        if claims
            .get(&claim.id)
            .is_some_and(|existing| existing.mode == Some(ClaimMode::Observed))
        {
            return Err(error(format!(
                "epistemic law {} cannot overwrite durable observed claim {}",
                law.id, claim.id
            )));
        }
        claims.insert(claim.id.clone(), claim);
    }

    let trajectory_hash = hex(trajectory_hasher.finalize());
    let draw_set_hash = hash_serializable(&draws)?;
    let fingerprint = CandidateFingerprint {
        schema: MODEL_CANDIDATE_SCHEMA,
        model_hash: &model.model_hash,
        model_revision: model.revision.number,
        world_id: &parent.world_id,
        parent_world_hash: &parent.world_hash,
        expected_parent_version: parent.version,
        start_time: parent.time,
        end_time,
        seed: &query.seed,
        roll_index: query.roll_index,
        dynamics_hash: &dynamics_hash,
        trajectory_hash: &trajectory_hash,
        successor_state: &state,
        successor_claims: &claims,
        marks: &marks,
        draw_set_hash: &draw_set_hash,
        comparison_randomness: query.comparison_stream.as_deref().map(|stream| {
            ComparisonRandomnessFingerprint {
                stream,
                schedule_hash: &schedule_hash,
            }
        }),
    };
    let candidate_hash = hash_serializable(&fingerprint)?;
    let proposed_head = build_world_head(
        model,
        parent.world_id.clone(),
        parent
            .version
            .checked_add(1)
            .ok_or_else(|| error("world version overflow"))?,
        end_time,
        state.clone(),
        claims.clone(),
        Some(candidate_hash.clone()),
    )?;
    let retention = query.path.clone();
    let seed = query.seed.clone();
    let roll_index = query.roll_index;
    let comparison_stream = query.comparison_stream.clone();
    let randomness_policy = if comparison_stream.is_some() {
        RandomnessPolicy::CommonRandomComparison
    } else {
        RandomnessPolicy::CandidateBound
    };
    Ok(ModelRollResult {
        candidate: ModelCandidate {
            schema: MODEL_CANDIDATE_SCHEMA.to_owned(),
            model_hash: model.model_hash.clone(),
            model_revision: model.revision.number,
            world_id: parent.world_id.clone(),
            parent_world_hash: parent.world_hash.clone(),
            expected_parent_version: parent.version,
            start_time: parent.time,
            end_time,
            seed: seed.clone(),
            roll_index,
            query,
            query_hash,
            dynamics_hash,
            trajectory_hash,
            successor_state: state,
            successor_claims: claims,
            marks,
            randomness: ModelRandomness {
                generator: "sha256-keyed-box-muller/v1".to_owned(),
                policy: randomness_policy,
                seed,
                roll_index,
                comparison_stream,
                schedule_hash,
                draws,
                draw_set_hash,
            },
            path: RetainedModelPath {
                schema: MODEL_PATH_SCHEMA.to_owned(),
                retention,
                total_sample_count: step_count + 1,
                samples,
            },
            candidate_hash,
        },
        proposed_head,
    })
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Pending,
    Committed,
    Rejected,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CandidateRecord {
    pub status: CandidateStatus,
    pub candidate: ModelCandidate,
    pub proposed_head: WorldHead,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct StoredCandidate {
    record: CandidateRecord,
    parent: WorldHead,
}

fn same_candidate_canon(left: &ModelCandidate, right: &ModelCandidate) -> bool {
    let mut normalized = left.clone();
    normalized.query = right.query.clone();
    normalized.query_hash = right.query_hash.clone();
    normalized.path = right.path.clone();
    normalized == *right
}

fn path_is_richer(candidate: &RetainedModelPath, stored: &RetainedModelPath) -> bool {
    match (&candidate.retention, &stored.retention) {
        (PathSpec::Full, PathSpec::Full) => false,
        (PathSpec::Full, _) => true,
        (_, PathSpec::Full) => false,
        (
            PathSpec::Decimated {
                every: candidate_every,
            },
            PathSpec::Decimated {
                every: stored_every,
            },
        ) => candidate_every < stored_every && stored_every % candidate_every == 0,
        (PathSpec::Decimated { .. }, PathSpec::Endpoint) => true,
        (PathSpec::Endpoint, _) => false,
    }
}

fn attach_retention_upgrade(
    mut value: serde_json::Value,
    retention_upgraded: bool,
) -> serde_json::Value {
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "retention_upgraded".to_owned(),
            serde_json::Value::Bool(retention_upgraded),
        );
    }
    value
}

fn normalize_view(model: &CompiledModel, view: &mut ViewSpec) -> EngineResult<BTreeSet<String>> {
    if view.requested_observables.len() > MAX_QUERY_OBSERVABLES
        || view.access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
        || view
            .access_scopes
            .iter()
            .any(|scope| scope.is_empty() || scope.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(error("view exceeds an observable/access-scope limit"));
    }
    view.requested_observables.sort();
    view.requested_observables.dedup();
    view.access_scopes.sort();
    view.access_scopes.dedup();
    let mut visible = BTreeSet::new();
    for observable in &view.requested_observables {
        let process = model
            .processes
            .get(observable)
            .ok_or_else(|| error(format!("view requests unknown observable {observable}")))?;
        if !process.access_scopes.is_empty()
            && !process
                .access_scopes
                .iter()
                .any(|scope| view.access_scopes.contains(scope))
        {
            return Err(error(format!(
                "view lacks an access scope for observable {observable}"
            )));
        }
        visible.insert(observable.clone());
    }
    Ok(visible)
}

fn projected_state(
    state: &BTreeMap<String, ProcessValue>,
    visible: &BTreeSet<String>,
) -> BTreeMap<String, ProcessValue> {
    visible
        .iter()
        .filter_map(|id| state.get(id).cloned().map(|value| (id.clone(), value)))
        .collect()
}

fn projected_claims(
    claims: &BTreeMap<String, Claim>,
    visible: &BTreeSet<String>,
    access_scopes: &[String],
) -> BTreeMap<String, Claim> {
    claims
        .iter()
        .filter(|(_, claim)| {
            visible.contains(&claim.subject)
                && (claim.access_scopes.is_empty()
                    || claim
                        .access_scopes
                        .iter()
                        .any(|scope| access_scopes.contains(scope)))
        })
        .map(|(id, claim)| (id.clone(), claim.clone()))
        .collect()
}

fn world_view(
    model: &CompiledModel,
    world: &WorldHead,
    mut view: ViewSpec,
) -> EngineResult<serde_json::Value> {
    validate_world(model, world)?;
    let visible = normalize_view(model, &mut view)?;
    Ok(serde_json::json!({
        "schema": MODEL_VIEW_SCHEMA,
        "source_schema": WORLD_HEAD_SCHEMA,
        "source_kind": "world",
        "model_hash": world.model_hash,
        "model_revision": world.model_revision,
        "world_id": world.world_id,
        "version": world.version,
        "time": world.time,
        "state": projected_state(&world.state, &visible),
        "claims": projected_claims(&world.claims, &visible, &view.access_scopes),
        "lineage_head": world.lineage_head,
        "world_hash": world.world_hash,
        "view": view
    }))
}

fn world_revision_view(
    source: &CompiledModel,
    target: &CompiledModel,
    revision: &WorldRevision,
    mut view: ViewSpec,
) -> EngineResult<serde_json::Value> {
    let visible = normalize_view(target, &mut view)?;
    let source_visible: Vec<String> = visible.iter()
        .filter(|id| {
            source.processes.get(*id).is_some_and(|process| {
                process_value_is_visible(process, &view.access_scopes)
            })
        })
        .cloned()
        .collect();
    let source_head = world_view(
        source,
        &revision.source_head,
        ViewSpec {
            requested_observables: source_visible,
            access_scopes: view.access_scopes.clone(),
            ..ViewSpec::default()
        },
    )?;
    Ok(serde_json::json!({
        "schema": revision.schema,
        "world_revision_hash": revision.world_revision_hash,
        "mode": revision.mode,
        "state_values": projected_state(&revision.state_values, &visible),
        "reason": revision.reason,
        "provenance": revision.provenance,
        "source_head": source_head,
        "target_head": world_view(target, &revision.target_head, view)?,
    }))
}

fn candidate_record_view(
    model: &CompiledModel,
    record: &CandidateRecord,
    mut view: ViewSpec,
) -> EngineResult<serde_json::Value> {
    let visible = normalize_view(model, &mut view)?;
    let path_samples: Vec<_> = if view.include_path {
        record
            .candidate
            .path
            .samples
            .iter()
            .map(|sample| {
                serde_json::json!({
                    "step": sample.step,
                    "time": sample.time,
                    "state": projected_state(&sample.state, &visible)
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    let proposed = world_view(model, &record.proposed_head, view.clone())?;
    let initial_boundary_intervention_count = record
        .candidate
        .query
        .interventions
        .iter()
        .filter(|intervention| {
            intervention.application == Some(InterventionApplication::InitialBoundary)
        })
        .count();
    let mut projected_query = serde_json::json!({
        "schema": record.candidate.query.schema,
        "delta_time": record.candidate.query.delta_time,
        "step_size": record.candidate.query.step_size,
        "roll_index": record.candidate.query.roll_index,
        "direction": record.candidate.query.direction,
        "precedence": record.candidate.query.precedence,
        "temporal_resolution": record.candidate.query.temporal_resolution,
        "semantic_resolution": record.candidate.query.semantic_resolution,
        "requested_observables": view.requested_observables,
        "access_scopes": view.access_scopes,
        "path": record.candidate.query.path,
        "selected_support_count": record.candidate.query.selected_support.len(),
        "intervention_count": record.candidate.query.interventions.len(),
        "observation_count": record.candidate.query.observations.len()
    });
    if initial_boundary_intervention_count > 0 {
        projected_query
            .as_object_mut()
            .expect("projected query is an object")
            .insert(
                "initial_boundary_intervention_count".to_owned(),
                serde_json::json!(initial_boundary_intervention_count),
            );
    }
    Ok(serde_json::json!({
        "status": record.status,
        "candidate": {
            "schema": MODEL_VIEW_SCHEMA,
            "source_schema": MODEL_CANDIDATE_SCHEMA,
            "source_kind": "candidate",
            "model_hash": record.candidate.model_hash,
            "model_revision": record.candidate.model_revision,
            "world_id": record.candidate.world_id,
            "parent_world_hash": record.candidate.parent_world_hash,
            "expected_parent_version": record.candidate.expected_parent_version,
            "start_time": record.candidate.start_time,
            "end_time": record.candidate.end_time,
            "roll_index": record.candidate.roll_index,
            "query": projected_query,
            "dynamics_hash": record.candidate.dynamics_hash,
            "trajectory_hash": record.candidate.trajectory_hash,
            "successor_state": projected_state(&record.candidate.successor_state, &visible),
            "successor_claims": projected_claims(
                &record.candidate.successor_claims,
                &visible,
                &view.access_scopes
            ),
            "mark_count": record.candidate.marks.len(),
            "randomness": {
                "generator": record.candidate.randomness.generator,
                "policy": record.candidate.randomness.policy,
                "roll_index": record.candidate.randomness.roll_index,
                "comparison_stream": record.candidate.randomness.comparison_stream,
                "schedule_hash": record.candidate.randomness.schedule_hash,
                "draw_count": record.candidate.randomness.draws.len(),
                "draw_set_hash": record.candidate.randomness.draw_set_hash
            },
            "path": {
                "schema": MODEL_VIEW_SCHEMA,
                "source_schema": MODEL_PATH_SCHEMA,
                "retention": record.candidate.path.retention,
                "total_sample_count": record.candidate.path.total_sample_count,
                "samples": path_samples
            },
            "candidate_hash": record.candidate.candidate_hash,
            "view": view
        },
        "proposed_head": proposed
    }))
}

fn candidate_original_view(candidate: &ModelCandidate) -> ViewSpec {
    ViewSpec {
        requested_observables: candidate.query.requested_observables.clone(),
        access_scopes: candidate.query.access_scopes.clone(),
        include_path: true,
    }
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

fn normalized_graph_access_scopes(query: &GraphQuery) -> Result<Vec<String>, MachineError> {
    let mut access_scopes = query.access_scopes().to_vec();
    if access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
        || access_scopes
            .iter()
            .any(|scope| scope.is_empty() || scope.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(machine_error(
            "invalid_request",
            "graph query exceeds an access-scope limit",
        ));
    }
    access_scopes.sort();
    access_scopes.dedup();
    Ok(access_scopes)
}

fn process_value_is_visible(process: &ProcessDefinition, access_scopes: &[String]) -> bool {
    process.access_scopes.is_empty()
        || process
            .access_scopes
            .iter()
            .any(|scope| access_scopes.binary_search(scope).is_ok())
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
        .filter(|process| process_value_is_visible(process, access_scopes))
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
                _ => true,
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
    MachineError,
> {
    if depth > MAX_GRAPH_NEIGHBORHOOD_DEPTH {
        return Err(machine_error(
            "invalid_request",
            format!("graph neighborhood depth {depth} exceeds {MAX_GRAPH_NEIGHBORHOOD_DEPTH}"),
        ));
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
                return Err(machine_error(
                    "invalid_request",
                    format!(
                    "graph source id {center} is ambiguous; use process:{center} or law:{center}"
                ),
                ))
            }
            (false, false) => {
                return Err(machine_error(
                    "not_found",
                    format!("unknown graph node or source id {center}"),
                ))
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
) -> Result<(), MachineError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(machine_error(
            "invalid_request",
            "expected_snapshot_hash must be a lowercase 64-character hexadecimal hash",
        ));
    }
    if expected != actual {
        return Err(machine_error(
            "conflict",
            format!("graph snapshot changed; expected {expected}, found {actual}"),
        ));
    }
    Ok(())
}

fn is_project_checkpoint_hash_shaped_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Serialize)]
struct ProjectGraphSnapshotIdentity<'a> {
    schema: &'static str,
    graph_hash: &'a str,
    source_snapshot_hash: &'a str,
}

fn project_graph_snapshot_hash(graph: &StoredNarrativeGraph) -> EngineResult<String> {
    hash_serializable(&ProjectGraphSnapshotIdentity {
        schema: PROJECT_GRAPH_SNAPSHOT_IDENTITY_SCHEMA,
        graph_hash: &graph.graph_hash,
        source_snapshot_hash: &graph.snapshot_hash,
    })
}

fn project_candidate_anchors(
    snapshot: &NarrativeSourceSnapshot,
) -> EngineResult<BTreeMap<String, ModelCandidate>> {
    snapshot
        .candidate_anchors
        .iter()
        .map(|(key, value)| {
            let candidate: ModelCandidate =
                serde_json::from_value(value.clone()).map_err(|cause| {
                    error(format!(
                        "project narrative candidate anchor {key} is invalid: {cause}"
                    ))
                })?;
            if candidate.candidate_hash != *key {
                return Err(error(format!(
                    "project narrative candidate anchor key {key} does not match its candidate hash"
                )));
            }
            Ok((key.clone(), candidate))
        })
        .collect()
}

fn candidate_successor_world(
    model: &CompiledModel,
    candidate: &ModelCandidate,
) -> EngineResult<WorldHead> {
    build_world_head(
        model,
        candidate.world_id.clone(),
        candidate
            .expected_parent_version
            .checked_add(1)
            .ok_or_else(|| error("project narrative candidate version overflow"))?,
        candidate.end_time,
        candidate.successor_state.clone(),
        candidate.successor_claims.clone(),
        Some(candidate.candidate_hash.clone()),
    )
}

fn validate_project_world_candidate_chain(
    model: &CompiledModel,
    supplied_world: Option<&WorldHead>,
    world_id: &str,
    world_hash: &str,
    snapshot: &NarrativeSourceSnapshot,
    anchors: &BTreeMap<String, ModelCandidate>,
) -> EngineResult<BTreeSet<String>> {
    let source_world = if let Some(world) = supplied_world {
        validate_world(model, world)?;
        world.clone()
    } else if anchors.is_empty() {
        model.genesis_world(world_id.to_owned())?
    } else {
        let matching: Vec<WorldHead> = anchors
            .values()
            .map(|candidate| candidate_successor_world(model, candidate))
            .collect::<EngineResult<Vec<_>>>()?
            .into_iter()
            .filter(|candidate_world| candidate_world.world_hash == world_hash)
            .collect();
        if matching.len() != 1 {
            return Err(error(
                "project narrative world snapshot does not identify exactly one candidate-chain head",
            ));
        }
        matching
            .into_iter()
            .next()
            .expect("one source world exists")
    };
    if source_world.world_id != world_id
        || source_world.world_hash != world_hash
        || source_world.model_hash != snapshot.model_hash
        || snapshot.world_version != Some(source_world.version)
        || snapshot.time != Some(source_world.time)
        || snapshot.state != source_world.state
        || snapshot.claims != source_world.claims
    {
        return Err(error(
            "project narrative graph world identity or state does not match its source snapshot",
        ));
    }
    let expected_occurrences = source_world
        .lineage_head
        .as_ref()
        .map(|candidate_hash| {
            anchors
                .get(candidate_hash)
                .map(|candidate| candidate.marks.clone())
                .ok_or_else(|| {
                    error(format!(
                        "project narrative world lineage lacks candidate anchor {candidate_hash}"
                    ))
                })
        })
        .transpose()?
        .unwrap_or_default();

    let mut used = BTreeSet::new();
    let mut replay_work = 0usize;
    let mut current = source_world;
    while let Some(candidate_hash) = current.lineage_head.clone() {
        if !used.insert(candidate_hash.clone()) {
            return Err(error(
                "project narrative candidate lineage contains a cycle",
            ));
        }
        let candidate = anchors.get(&candidate_hash).ok_or_else(|| {
            error(format!(
                "project narrative world lineage lacks candidate anchor {candidate_hash}"
            ))
        })?;
        if candidate_successor_world(model, candidate)? != current {
            return Err(error(format!(
                "project narrative candidate anchor {candidate_hash} does not reconstruct its successor world"
            )));
        }
        let parent = if candidate.expected_parent_version == 0 {
            model.genesis_world(candidate.world_id.clone())?
        } else {
            let matching: Vec<WorldHead> = anchors
                .values()
                .filter(|possible_parent| {
                    possible_parent.candidate_hash != candidate.candidate_hash
                })
                .map(|possible_parent| candidate_successor_world(model, possible_parent))
                .collect::<EngineResult<Vec<_>>>()?
                .into_iter()
                .filter(|possible_parent| possible_parent.world_hash == candidate.parent_world_hash)
                .collect();
            if matching.len() != 1 {
                return Err(error(format!(
                    "project narrative candidate anchor {candidate_hash} does not identify exactly one parent"
                )));
            }
            matching
                .into_iter()
                .next()
                .expect("one parent world exists")
        };
        validate_candidate_with_frozen_parent(model, &parent, candidate)?;
        replay_work = replay_work
            .checked_add(candidate_replay_work(model, &parent, &candidate.query)?)
            .ok_or_else(|| error("project narrative candidate replay-work estimate overflow"))?;
        if replay_work > MAX_SESSION_REPLAY_WORK {
            return Err(error(format!(
                "project narrative candidate replay work exceeds {MAX_SESSION_REPLAY_WORK}"
            )));
        }
        validate_project_candidate_replay(model, &parent, candidate)?;
        current = parent;
    }
    if current.version != 0 || current != model.genesis_world(world_id.to_owned())? {
        return Err(error(
            "project narrative candidate anchors do not terminate at the canonical genesis world",
        ));
    }
    if used.len() != anchors.len() {
        return Err(error(
            "project narrative source snapshot contains candidate anchors outside its exact world lineage",
        ));
    }
    if snapshot.occurrences != expected_occurrences {
        return Err(error(
            "project narrative world occurrences do not match its lineage head candidate",
        ));
    }
    Ok(used)
}

fn validate_project_graph_source_binding(
    model: &CompiledModel,
    world: Option<&WorldHead>,
    graph: &StoredNarrativeGraph,
) -> EngineResult<BTreeSet<String>> {
    let snapshot = &graph.snapshot;
    if snapshot.model_hash != model.model_hash || snapshot.model_revision != model.revision.number {
        return Err(error(
            "project graph source snapshot does not match its frozen model",
        ));
    }
    let anchors = project_candidate_anchors(snapshot)?;
    let bound_candidate_ids = match &graph.definition.source {
        NarrativeGraphSource::Model { model_hash }
            if model_hash == &snapshot.model_hash
                && snapshot.source_kind == "model"
                && snapshot.source_hash == snapshot.model_hash
                && snapshot.world_id.is_none()
                && snapshot.world_version.is_none()
                && snapshot.time.is_none()
                && snapshot.candidate_status.is_none()
                && snapshot.state
                    == model
                        .processes
                        .values()
                        .map(|process| (process.id.clone(), process.initial_value.clone()))
                        .collect()
                && snapshot.claims == model.initial_claims
                && snapshot.occurrences.is_empty()
                && anchors.is_empty() =>
        {
            BTreeSet::new()
        }
        NarrativeGraphSource::World {
            world_id,
            world_hash,
        } if snapshot.source_kind == "world"
            && snapshot.source_hash == *world_hash
            && snapshot.world_id.as_deref() == Some(world_id.as_str())
            && snapshot.world_version.is_some()
            && snapshot.time.is_some()
            && snapshot.candidate_status.as_deref() == Some("committed") =>
        {
            validate_project_world_candidate_chain(
                model, world, world_id, world_hash, snapshot, &anchors,
            )?
        }
        NarrativeGraphSource::Candidate { candidate_hash }
            if snapshot.source_kind == "candidate"
                && snapshot.source_hash == *candidate_hash
                && matches!(
                    snapshot.candidate_status.as_deref(),
                    Some("pending" | "committed" | "rejected" | "superseded")
                ) =>
        {
            let candidate = anchors.get(candidate_hash).ok_or_else(|| {
                error("project narrative candidate source lacks its exact candidate anchor")
            })?;
            let successor = candidate_successor_world(model, candidate)?;
            if snapshot.world_id.as_deref() != Some(candidate.world_id.as_str())
                || snapshot.world_version != candidate.expected_parent_version.checked_add(1)
                || snapshot.time != Some(candidate.end_time)
                || snapshot.state != candidate.successor_state
                || snapshot.claims != candidate.successor_claims
                || snapshot.occurrences != candidate.marks
            {
                return Err(error(
                    "project narrative candidate source does not match its frozen candidate",
                ));
            }
            validate_project_world_candidate_chain(
                model,
                None,
                &candidate.world_id,
                &successor.world_hash,
                snapshot,
                &anchors,
            )?
        }
        _ => {
            return Err(error(
                "project narrative graph source and frozen source snapshot do not match",
            ));
        }
    };
    let compiled = compile_narrative_graph(graph.definition.clone())?;
    validate_frozen_narrative_anchor_references(model, &compiled, snapshot, &bound_candidate_ids)?;
    Ok(bound_candidate_ids)
}

fn validate_frozen_narrative_anchor_references(
    model: &CompiledModel,
    graph: &CompiledNarrativeGraph,
    snapshot: &NarrativeSourceSnapshot,
    bound_candidate_ids: &BTreeSet<String>,
) -> EngineResult<()> {
    let meaning = model.definition.meaning_model.as_ref();
    let anchor_value = |kind: NarrativeAnchorKind, id: &str| -> Option<serde_json::Value> {
        match kind {
            NarrativeAnchorKind::Model if id == model.model_hash || id == model.id => {
                serde_json::to_value(&model.definition).ok()
            }
            NarrativeAnchorKind::Process => model
                .processes
                .get(id)
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Decomposition => model
                .definition
                .decomposition
                .iter()
                .find(|record| record.id == id)
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Dependency => model
                .definition
                .dependencies
                .iter()
                .find(|record| record.id == id)
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Law => model
                .laws
                .iter()
                .find(|record| record.id == id)
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Claim => snapshot
                .claims
                .get(id)
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Concept => meaning
                .and_then(|layer| layer.concepts.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::AbstractRelation => meaning
                .and_then(|layer| {
                    layer
                        .abstract_relations
                        .iter()
                        .find(|record| record.id == id)
                })
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::AbstractCut => meaning
                .and_then(|layer| layer.abstract_cuts.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Referent => meaning
                .and_then(|layer| layer.referents.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::EncapsulationCut => meaning
                .and_then(|layer| {
                    layer
                        .encapsulation_cuts
                        .iter()
                        .find(|record| record.id == id)
                })
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Event => meaning
                .and_then(|layer| layer.events.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::EventRelation => meaning
                .and_then(|layer| layer.event_relations.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::EventReferentBinding => meaning
                .and_then(|layer| {
                    layer
                        .event_referent_bindings
                        .iter()
                        .find(|record| record.id == id)
                })
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::PhysicalCut => meaning
                .and_then(|layer| layer.physical_cuts.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::Realization => meaning
                .and_then(|layer| layer.realizations.iter().find(|record| record.id == id))
                .and_then(|record| serde_json::to_value(record).ok()),
            NarrativeAnchorKind::World if snapshot.world_id.as_deref() == Some(id) => {
                serde_json::to_value(snapshot).ok()
            }
            NarrativeAnchorKind::Candidate if bound_candidate_ids.contains(id) => {
                snapshot.candidate_anchors.get(id).cloned()
            }
            NarrativeAnchorKind::Occurrence => snapshot
                .occurrences
                .iter()
                .find(|record| record.id == id)
                .and_then(|record| serde_json::to_value(record).ok()),
            _ => None,
        }
    };
    for edge in &graph.definition.edges {
        for endpoint in [&edge.source, &edge.target] {
            if let NarrativeEndpoint::Anchor {
                anchor_kind,
                anchor_id,
                path,
            } = endpoint
            {
                let Some(value) = anchor_value(*anchor_kind, anchor_id) else {
                    return Err(error(format!(
                        "narrative edge {} names unknown or source-incompatible {:?} anchor {anchor_id}",
                        edge.id, anchor_kind
                    )));
                };
                if path
                    .as_deref()
                    .is_some_and(|pointer| value.pointer(pointer).is_none())
                {
                    return Err(error(format!(
                        "narrative edge {} anchor {:?}:{anchor_id} has an unresolved subpath {}",
                        edge.id,
                        anchor_kind,
                        path.as_deref().unwrap_or_default()
                    )));
                }
                let mut required_scope_groups: Vec<&[String]> = Vec::new();
                match anchor_kind {
                    NarrativeAnchorKind::Process => {
                        if let Some(process) = model.processes.get(anchor_id) {
                            required_scope_groups.push(process.access_scopes.as_slice());
                        }
                    }
                    NarrativeAnchorKind::Claim => {
                        if let Some(claim) = snapshot.claims.get(anchor_id) {
                            required_scope_groups.push(claim.access_scopes.as_slice());
                            if let Some(subject) = model.processes.get(&claim.subject) {
                                required_scope_groups.push(subject.access_scopes.as_slice());
                            }
                        }
                    }
                    _ => {}
                }
                for required_scopes in required_scope_groups {
                    if !required_scopes.is_empty()
                        && !required_scopes
                            .iter()
                            .any(|scope| edge.access_scopes.contains(scope))
                    {
                        return Err(error(format!(
                            "narrative edge {} must carry an access scope for private {:?} anchor {anchor_id}",
                            edge.id, anchor_kind
                        )));
                    }
                }
            }
        }
    }
    Ok(())
}

fn factor_graph_response(
    model: &CompiledModel,
    state: &BTreeMap<String, ProcessValue>,
    value_source: &str,
    candidate_marks: Option<&[OccurrenceMark]>,
    source: GraphSnapshotSource,
    query: GraphQuery,
) -> Result<FactorGraphResponse, MachineError> {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "encoding", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProjectDocumentContent {
    Utf8 { text: String },
    Bytes { bytes: Vec<u8> },
}

impl ProjectDocumentContent {
    fn into_bytes(self) -> Vec<u8> {
        match self {
            Self::Utf8 { text } => text.into_bytes(),
            Self::Bytes { bytes } => bytes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectDocumentDefinition {
    pub schema: String,
    pub media_type: String,
    pub content: ProjectDocumentContent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_external_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct StoredProjectDocument {
    document_hash: String,
    media_type: String,
    content: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectCheckpointDefinition {
    pub schema: String,
    pub name: String,
    /// A checkpoint name or immutable checkpoint hash. It is resolved to the
    /// hash before storage so a later name can never redirect ancestry.
    #[serde(default)]
    pub parent_checkpoint: Option<String>,
    pub document: ProjectDocumentDefinition,
    #[serde(default)]
    pub model_hash: Option<String>,
    #[serde(default)]
    pub world_hash: Option<String>,
    #[serde(default)]
    pub narrative_graph_hash: Option<String>,
    /// Identity of the frozen graph definition together with its exact source
    /// snapshot. A graph definition hash alone does not identify the state
    /// against which that definition was authored.
    #[serde(default)]
    pub narrative_graph_snapshot_hash: Option<String>,
    /// Optional frozen material for importing a checkpoint from another
    /// active session. Hash fields above remain the immutable identities.
    #[serde(default)]
    pub model_snapshot: Option<ModelDefinition>,
    /// Lossless JSON transport for model snapshots. Model definitions include
    /// untyped realization parameters as well as signed floating-point and
    /// `u64` fields. Keeping the nested JSON text opaque across a JavaScript
    /// client preserves lexical values such as `9.0` and `-0.0` and integers
    /// above `2^53`; portable exports use this form instead of
    /// `model_snapshot`.
    #[serde(default)]
    pub model_snapshot_json: Option<String>,
    #[serde(default)]
    pub world_snapshot: Option<WorldHead>,
    /// Lossless JSON transport for world snapshots. This protects signed
    /// floating-point values and `u64` revision/version fields from numeric
    /// normalization by intermediary JSON clients. Portable exports use this
    /// form instead of `world_snapshot`.
    #[serde(default)]
    pub world_snapshot_json: Option<String>,
    #[serde(default)]
    pub narrative_graph_snapshot: Option<StoredNarrativeGraph>,
    /// Lossless JSON transport for graph snapshots whose untyped candidate
    /// anchors preserve numeric distinctions such as `9.0` versus `9` and may
    /// contain integers above JavaScript's safe range. Portable exports use
    /// this form so an intermediary JSON client cannot normalize a nested
    /// number and invalidate the frozen source-snapshot hash.
    #[serde(default)]
    pub narrative_graph_snapshot_json: Option<String>,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProjectCheckpointCore {
    schema: String,
    name: String,
    parent_checkpoint_hash: Option<String>,
    document_hash: String,
    canonical_external_path: Option<String>,
    model_hash: Option<String>,
    world_hash: Option<String>,
    narrative_graph_hash: Option<String>,
    narrative_graph_snapshot_hash: Option<String>,
    reason: String,
    provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct StoredProjectCheckpoint {
    checkpoint_hash: String,
    checkpoint_sequence: u64,
    #[serde(flatten)]
    core: ProjectCheckpointCore,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct MachineCommand {
    schema: String,
    #[serde(default)]
    request_id: Option<String>,
    operation: String,
    #[serde(default)]
    model: Option<ModelDefinition>,
    #[serde(default)]
    profile_request: Option<ProfileCompilationRequest>,
    #[serde(default)]
    model_hash: Option<String>,
    #[serde(default)]
    world_id: Option<String>,
    #[serde(default)]
    world_revision: Option<WorldRevisionSpec>,
    #[serde(default)]
    world_revision_hash: Option<String>,
    #[serde(default)]
    candidate_hash: Option<String>,
    #[serde(default)]
    query: Option<ModelTransitionSpec>,
    #[serde(default)]
    trajectory_summary: Option<TrajectorySummarySpec>,
    #[serde(default)]
    view: Option<ViewSpec>,
    #[serde(default)]
    graph_query: Option<GraphQuery>,
    #[serde(default)]
    narrative_graph: Option<NarrativeGraphDefinition>,
    #[serde(default)]
    narrative_batch: Option<NarrativeGraphBatch>,
    #[serde(default)]
    narrative_graph_hash: Option<String>,
    #[serde(default)]
    narrative_query: Option<NarrativeGraphQuery>,
    #[serde(default)]
    narrative_render: Option<NarrativeRenderSpec>,
    #[serde(default)]
    narrative_training: Option<NarrativeTrainingSpec>,
    #[serde(default)]
    narrative_history: Option<NarrativeHistorySpec>,
    #[serde(default)]
    project_checkpoint: Option<ProjectCheckpointDefinition>,
    #[serde(default)]
    project_checkpoint_id: Option<String>,
}

#[derive(Debug)]
struct MachineError {
    code: &'static str,
    message: String,
}

impl From<super::EngineError> for MachineError {
    fn from(value: super::EngineError) -> Self {
        Self {
            code: "invalid_request",
            message: value.0,
        }
    }
}

fn machine_error(code: &'static str, message: impl Into<String>) -> MachineError {
    MachineError {
        code,
        message: message.into(),
    }
}

fn required<T>(value: Option<T>, message: &'static str) -> Result<T, MachineError> {
    value.ok_or_else(|| machine_error("invalid_request", message))
}

fn encode(value: impl Serialize) -> Result<serde_json::Value, MachineError> {
    serde_json::to_value(value).map_err(|cause| {
        machine_error(
            "internal_error",
            format!("failed to encode machine response: {cause}"),
        )
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedSession {
    schema: String,
    persistence_generation: u64,
    models: Vec<ModelDefinition>,
    worlds: Vec<WorldHead>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    world_revisions: Vec<WorldRevision>,
    candidates: Vec<StoredCandidate>,
    narrative_source_snapshots: Vec<StoredNarrativeSourceSnapshot>,
    narrative_revisions: Vec<StoredNarrativeRevision>,
    #[serde(default)]
    project_documents: Vec<StoredProjectDocument>,
    #[serde(default)]
    project_model_snapshots: Vec<ModelDefinition>,
    #[serde(default)]
    project_world_snapshots: Vec<WorldHead>,
    #[serde(default)]
    project_graph_snapshots: Vec<StoredNarrativeGraph>,
    #[serde(default)]
    project_checkpoints: Vec<StoredProjectCheckpoint>,
}

#[derive(Debug)]
struct PersistenceFailure {
    cause: super::EngineError,
    state_file_replaced: bool,
}

#[derive(Debug, Clone, Default)]
struct SessionDirty {
    models: BTreeSet<String>,
    worlds: BTreeSet<String>,
    world_revisions: BTreeSet<String>,
    candidates: BTreeSet<String>,
    narrative_source_snapshots: BTreeSet<String>,
    narrative_revisions: BTreeSet<String>,
    project_documents: BTreeSet<String>,
    project_model_snapshots: BTreeSet<String>,
    project_world_snapshots: BTreeSet<String>,
    project_graph_snapshots: BTreeSet<String>,
    project_checkpoints: BTreeSet<String>,
}

impl SessionDirty {
    fn is_empty(&self) -> bool {
        self.models.is_empty()
            && self.worlds.is_empty()
            && self.world_revisions.is_empty()
            && self.candidates.is_empty()
            && self.narrative_source_snapshots.is_empty()
            && self.narrative_revisions.is_empty()
            && self.project_documents.is_empty()
            && self.project_model_snapshots.is_empty()
            && self.project_world_snapshots.is_empty()
            && self.project_graph_snapshots.is_empty()
            && self.project_checkpoints.is_empty()
    }
}

#[derive(Debug, Default)]
pub struct MachineSession {
    models: BTreeMap<String, CompiledModel>,
    worlds: BTreeMap<String, WorldHead>,
    world_revisions: BTreeMap<String, WorldRevision>,
    candidates: BTreeMap<String, StoredCandidate>,
    narrative_source_snapshots: BTreeMap<String, NarrativeSourceSnapshot>,
    narrative_revisions: BTreeMap<String, StoredNarrativeRevision>,
    project_documents: BTreeMap<String, StoredProjectDocument>,
    project_model_snapshots: BTreeMap<String, CompiledModel>,
    project_world_snapshots: BTreeMap<String, WorldHead>,
    project_graph_snapshots: BTreeMap<String, StoredNarrativeGraph>,
    project_checkpoints: BTreeMap<String, StoredProjectCheckpoint>,
    project_checkpoint_names: BTreeMap<String, String>,
    // Exact serialized size of the compact narrative snapshots and revision
    // records. It is rebuilt once on restore and then maintained
    // incrementally, so an append does not rescan the whole history.
    narrative_storage_bytes: usize,
    next_narrative_operation_sequence: u64,
    next_project_checkpoint_sequence: u64,
    persistence_generation: u64,
    dirty: SessionDirty,
    state_file: Option<PathBuf>,
}

impl MachineSession {
    /// Opens a single-writer durable session. If the path does not exist, the
    /// first successful mutation creates it; construction itself has no file
    /// side effects.
    pub fn with_state_file(path: impl Into<PathBuf>) -> EngineResult<Self> {
        let path = path.into();
        if path.as_os_str().is_empty() {
            return Err(error("state file path must be nonempty"));
        }
        if !path.exists() {
            return Ok(Self {
                state_file: Some(path),
                ..Self::default()
            });
        }
        let persisted = load_sqlite_session(&path)?;
        let mut session = Self::restore(persisted)?;
        session.state_file = Some(path);
        Ok(session)
    }

    pub fn state_file(&self) -> Option<&Path> {
        self.state_file.as_deref()
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
                let model = self.models.get(model_hash).ok_or_else(|| {
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
                let model = self.models.get(&world.model_hash).ok_or_else(|| {
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
                    .get(&candidate.model_hash)
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

    fn validate_narrative_anchors(
        &self,
        graph: &CompiledNarrativeGraph,
        snapshot: &NarrativeSourceSnapshot,
    ) -> EngineResult<()> {
        let model = self
            .models
            .get(&snapshot.model_hash)
            .ok_or_else(|| error("narrative source model is unavailable"))?;
        if model.revision.number != snapshot.model_revision {
            return Err(error(
                "narrative source model revision does not match snapshot",
            ));
        }
        let meaning = model.definition.meaning_model.as_ref();
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
            validate_candidate_with_frozen_parent(model, &stored.parent, &frozen)?;
        }
        let anchor_value = |kind: NarrativeAnchorKind, id: &str| -> Option<serde_json::Value> {
            match kind {
                NarrativeAnchorKind::Model if id == model.model_hash || id == model.id => {
                    serde_json::to_value(&model.definition).ok()
                }
                NarrativeAnchorKind::Process => model
                    .processes
                    .get(id)
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Decomposition => model
                    .definition
                    .decomposition
                    .iter()
                    .find(|record| record.id == id)
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Dependency => model
                    .definition
                    .dependencies
                    .iter()
                    .find(|record| record.id == id)
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Law => model
                    .laws
                    .iter()
                    .find(|record| record.id == id)
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Claim => snapshot
                    .claims
                    .get(id)
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Concept => meaning
                    .and_then(|layer| layer.concepts.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::AbstractRelation => meaning
                    .and_then(|layer| {
                        layer
                            .abstract_relations
                            .iter()
                            .find(|record| record.id == id)
                    })
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::AbstractCut => meaning
                    .and_then(|layer| layer.abstract_cuts.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Referent => meaning
                    .and_then(|layer| layer.referents.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::EncapsulationCut => meaning
                    .and_then(|layer| {
                        layer
                            .encapsulation_cuts
                            .iter()
                            .find(|record| record.id == id)
                    })
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Event => meaning
                    .and_then(|layer| layer.events.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::EventRelation => meaning
                    .and_then(|layer| layer.event_relations.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::EventReferentBinding => meaning
                    .and_then(|layer| {
                        layer
                            .event_referent_bindings
                            .iter()
                            .find(|record| record.id == id)
                    })
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::PhysicalCut => meaning
                    .and_then(|layer| layer.physical_cuts.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::Realization => meaning
                    .and_then(|layer| layer.realizations.iter().find(|record| record.id == id))
                    .and_then(|record| serde_json::to_value(record).ok()),
                NarrativeAnchorKind::World if snapshot.world_id.as_deref() == Some(id) => {
                    serde_json::to_value(snapshot).ok()
                }
                NarrativeAnchorKind::Candidate if bound_candidate_ids.contains(id) => {
                    snapshot.candidate_anchors.get(id).cloned()
                }
                NarrativeAnchorKind::Occurrence => snapshot
                    .occurrences
                    .iter()
                    .find(|record| record.id == id)
                    .and_then(|record| serde_json::to_value(record).ok()),
                _ => None,
            }
        };
        for edge in &graph.definition.edges {
            for endpoint in [&edge.source, &edge.target] {
                if let NarrativeEndpoint::Anchor {
                    anchor_kind,
                    anchor_id,
                    path,
                } = endpoint
                {
                    let Some(value) = anchor_value(*anchor_kind, anchor_id) else {
                        return Err(error(format!(
                            "narrative edge {} names unknown or source-incompatible {:?} anchor {anchor_id}",
                            edge.id, anchor_kind
                        )));
                    };
                    if path
                        .as_deref()
                        .is_some_and(|pointer| value.pointer(pointer).is_none())
                    {
                        return Err(error(format!(
                            "narrative edge {} anchor {:?}:{anchor_id} has an unresolved subpath {}",
                            edge.id,
                            anchor_kind,
                            path.as_deref().unwrap_or_default()
                        )));
                    }
                    let mut required_scope_groups: Vec<&[String]> = Vec::new();
                    match anchor_kind {
                        NarrativeAnchorKind::Process => {
                            if let Some(process) = model.processes.get(anchor_id) {
                                required_scope_groups.push(process.access_scopes.as_slice());
                            }
                        }
                        NarrativeAnchorKind::Claim => {
                            if let Some(claim) = snapshot.claims.get(anchor_id) {
                                required_scope_groups.push(claim.access_scopes.as_slice());
                                if let Some(subject) = model.processes.get(&claim.subject) {
                                    required_scope_groups.push(subject.access_scopes.as_slice());
                                }
                            }
                        }
                        _ => {}
                    }
                    for required_scopes in required_scope_groups {
                        if !required_scopes.is_empty()
                            && !required_scopes
                                .iter()
                                .any(|scope| edge.access_scopes.contains(scope))
                        {
                            return Err(error(format!(
                                "narrative edge {} must carry an access scope for private {:?} anchor {anchor_id}",
                                edge.id, anchor_kind
                            )));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn validate_storage_limits(&self) -> EngineResult<()> {
        if self.models.len() > MAX_SESSION_MODELS
            || self.worlds.len() > MAX_SESSION_WORLDS
            || self.world_revisions.len() > MAX_SESSION_WORLD_REVISIONS
            || self.candidates.len() > MAX_SESSION_CANDIDATES
            || self.narrative_revisions.len() > MAX_SESSION_NARRATIVE_GRAPHS
            || self.project_checkpoints.len() > MAX_PROJECT_CHECKPOINTS
        {
            return Err(error("session object-count limit exceeded"));
        }
        let model_bytes = serialized_sum(self.models.values().map(|model| &model.definition))?;
        let world_bytes = serialized_sum(self.worlds.values())?;
        let world_revision_bytes = serialized_sum(self.world_revisions.values())?;
        let candidate_bytes = serialized_sum(self.candidates.values())?
            .checked_add(self.candidates.len().saturating_mul(16))
            .ok_or_else(|| error("candidate storage estimate overflow"))?;
        let narrative_bytes = self.narrative_storage_bytes;
        let project_bytes = self.project_storage_bytes()?;
        if model_bytes > MAX_SESSION_MODEL_BYTES
            || world_bytes > MAX_SESSION_WORLD_BYTES
            || world_revision_bytes > MAX_SESSION_WORLD_REVISION_BYTES
            || candidate_bytes > MAX_SESSION_CANDIDATE_BYTES
            || narrative_bytes > MAX_SESSION_NARRATIVE_BYTES
            || project_bytes > MAX_PROJECT_STORAGE_BYTES
        {
            return Err(error(format!(
                "session byte limit exceeded (models {model_bytes}/{MAX_SESSION_MODEL_BYTES}, worlds {world_bytes}/{MAX_SESSION_WORLD_BYTES}, candidates {candidate_bytes}/{MAX_SESSION_CANDIDATE_BYTES}, narrative graphs {narrative_bytes}/{MAX_SESSION_NARRATIVE_BYTES}, project checkpoints {project_bytes}/{MAX_PROJECT_STORAGE_BYTES})"
            )));
        }
        Ok(())
    }

    fn compute_narrative_storage_bytes(&self) -> EngineResult<usize> {
        let snapshots: Vec<StoredNarrativeSourceSnapshot> = self
            .narrative_source_snapshots
            .iter()
            .map(|(snapshot_hash, snapshot)| StoredNarrativeSourceSnapshot {
                snapshot_hash: snapshot_hash.clone(),
                snapshot: snapshot.clone(),
            })
            .collect();
        serialized_sum(snapshots.iter())?
            .checked_add(serialized_sum(self.narrative_revisions.values())?)
            .ok_or_else(|| error("session narrative storage estimate overflow"))
    }

    fn ensure_narrative_insert(
        &self,
        revision: &StoredNarrativeRevision,
        snapshot: &NarrativeSourceSnapshot,
    ) -> EngineResult<usize> {
        if self.narrative_revisions.contains_key(&revision.graph_hash) {
            return Ok(0);
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
        let added_bytes = snapshot_bytes
            .checked_add(revision_bytes)
            .ok_or_else(|| error("session narrative graph byte estimate overflow"))?;
        let bytes = self
            .narrative_storage_bytes
            .checked_add(snapshot_bytes)
            .and_then(|value| value.checked_add(revision_bytes))
            .ok_or_else(|| error("session narrative graph byte estimate overflow"))?;
        if bytes > MAX_SESSION_NARRATIVE_BYTES {
            return Err(error(format!(
                "session narrative graph bytes would exceed {MAX_SESSION_NARRATIVE_BYTES}"
            )));
        }
        Ok(added_bytes)
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

    fn narrative_delta_revision(
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

    fn insert_narrative_revision(
        &mut self,
        revision: StoredNarrativeRevision,
        snapshot: NarrativeSourceSnapshot,
    ) -> EngineResult<()> {
        validate_narrative_revision_record_hash(&revision)?;
        if revision.operation_sequence != self.next_narrative_operation_sequence {
            return Err(error(
                "narrative operation sequence is not the next append position",
            ));
        }
        if hash_serializable(&snapshot)? != revision.snapshot_hash {
            return Err(error("narrative source snapshot hash is invalid"));
        }
        if let Some(existing) = self.narrative_source_snapshots.get(&revision.snapshot_hash) {
            if existing != &snapshot {
                return Err(error(
                    "narrative snapshot hash is already bound to different content",
                ));
            }
        }
        let added_storage_bytes = self.ensure_narrative_insert(&revision, &snapshot)?;
        let next = self
            .next_narrative_operation_sequence
            .checked_add(1)
            .ok_or_else(|| error("narrative operation sequence overflow"))?;
        let snapshot_is_new = !self
            .narrative_source_snapshots
            .contains_key(&revision.snapshot_hash);
        self.narrative_source_snapshots
            .entry(revision.snapshot_hash.clone())
            .or_insert(snapshot);
        let snapshot_hash = revision.snapshot_hash.clone();
        let graph_hash = revision.graph_hash.clone();
        if self
            .narrative_revisions
            .insert(revision.graph_hash.clone(), revision)
            .is_some()
        {
            return Err(error("narrative graph hash insertion collided"));
        }
        self.next_narrative_operation_sequence = next;
        self.narrative_storage_bytes = self
            .narrative_storage_bytes
            .checked_add(added_storage_bytes)
            .ok_or_else(|| error("session narrative graph byte estimate overflow"))?;
        if self.state_file.is_some() {
            if snapshot_is_new {
                self.dirty.narrative_source_snapshots.insert(snapshot_hash);
            }
            self.dirty.narrative_revisions.insert(graph_hash);
        }
        Ok(())
    }

    fn materialize_narrative_graph(&self, graph_hash: &str) -> EngineResult<StoredNarrativeGraph> {
        let target = self
            .narrative_revisions
            .get(graph_hash)
            .ok_or_else(|| error(format!("unknown narrative graph {graph_hash}")))?;
        let mut chain = Vec::new();
        let mut cursor = target;
        let mut visited = BTreeSet::new();
        loop {
            if !visited.insert(cursor.graph_hash.as_str()) {
                return Err(error("narrative revision chain contains a cycle"));
            }
            chain.push(cursor);
            let Some(previous_hash) = cursor.revision.previous_graph_hash.as_deref() else {
                break;
            };
            cursor = self.narrative_revisions.get(previous_hash).ok_or_else(|| {
                error(format!(
                    "narrative graph {} lacks previous revision {previous_hash}",
                    cursor.graph_hash
                ))
            })?;
        }
        chain.reverse();
        let mut definition: Option<NarrativeGraphDefinition> = None;
        for record in chain {
            validate_narrative_revision_record_hash(record)?;
            let next_definition = apply_narrative_revision_record(definition.as_ref(), record)?;
            validate_narrative_insertion_order(record, &next_definition)?;
            definition = Some(next_definition);
        }
        let compiled = compile_narrative_graph(
            definition.ok_or_else(|| error("narrative revision chain is empty"))?,
        )?;
        if compiled.graph_hash != target.graph_hash {
            return Err(error(
                "narrative revision chain does not reconstruct its target hash",
            ));
        }
        let snapshot = self
            .narrative_source_snapshots
            .get(&target.snapshot_hash)
            .ok_or_else(|| error("narrative revision names an unknown source snapshot"))?
            .clone();
        if hash_serializable(&snapshot)? != target.snapshot_hash {
            return Err(error("narrative source snapshot hash is invalid"));
        }
        Ok(StoredNarrativeGraph {
            graph_hash: target.graph_hash.clone(),
            snapshot_hash: target.snapshot_hash.clone(),
            definition: compiled.definition,
            snapshot,
        })
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

    fn find_world_by_hash(&self, world_hash: &str) -> Option<WorldHead> {
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

    fn ensure_portable_source_history(
        &self,
        snapshot: &NarrativeSourceSnapshot,
    ) -> Result<(), MachineError> {
        let world = if snapshot.source_kind == "candidate" {
            self.candidates.get(&snapshot.source_hash)
                .map(|stored| stored.parent.clone())
        } else if snapshot.source_kind == "world" {
            self.find_world_by_hash(&snapshot.source_hash)
        } else {
            None
        };
        if world.as_ref().is_some_and(|world| self.world_has_revision_history(world)) {
            return Err(machine_error("unsupported_history", "portable narrative/checkpoint export across world revisions is not supported; the complete accepted history remains preserved in the session database"));
        }
        Ok(())
    }

    fn project_storage_bytes(&self) -> EngineResult<usize> {
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

    fn register_project_checkpoint(
        &mut self,
        definition: ProjectCheckpointDefinition,
    ) -> Result<serde_json::Value, MachineError> {
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
        let parent_checkpoint_hash = definition
            .parent_checkpoint
            .as_deref()
            .map(|identifier| {
                self.resolve_project_checkpoint(identifier)
                    .map(|checkpoint| checkpoint.checkpoint_hash.clone())
            })
            .transpose()?;
        if definition.document.schema != PROJECT_DOCUMENT_SCHEMA {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "unsupported project document schema {}; expected {PROJECT_DOCUMENT_SCHEMA}",
                    definition.document.schema
                ),
            ));
        }
        if definition.document.media_type.trim().is_empty()
            || definition.document.media_type.len() > MAX_NARRATIVE_STRING_BYTES
            || definition
                .document
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
        let canonical_external_path = definition.document.canonical_external_path;
        let document = StoredProjectDocument {
            document_hash: String::new(),
            media_type: definition.document.media_type,
            content: definition.document.content.into_bytes(),
        };
        if document.content.len() > MAX_PROJECT_DOCUMENT_BYTES {
            return Err(machine_error(
                "invalid_request",
                format!("project document exceeds {MAX_PROJECT_DOCUMENT_BYTES} bytes"),
            ));
        }
        let document_hash = hash_serializable(&serde_json::json!({
            "media_type": document.media_type,
            "content": document.content,
        }))?;
        let document = StoredProjectDocument {
            document_hash: document_hash.clone(),
            ..document
        };
        if let Some(existing) = self.project_documents.get(&document_hash) {
            if existing != &document {
                return Err(machine_error(
                    "conflict",
                    "project document hash is bound to different content",
                ));
            }
        }

        if definition.model_snapshot.is_some() && definition.model_snapshot_json.is_some() {
            return Err(machine_error(
                "invalid_request",
                "project checkpoint must provide at most one model snapshot representation",
            ));
        }
        let imported_model_definition =
            match (definition.model_snapshot, definition.model_snapshot_json) {
                (Some(model), None) => Some(model),
                (None, Some(encoded)) => {
                    if encoded.len() > MAX_PROJECT_EXPORT_BYTES {
                        return Err(machine_error(
                            "invalid_request",
                            "project checkpoint model snapshot JSON is unbounded",
                        ));
                    }
                    Some(
                        serde_json::from_str::<ModelDefinition>(&encoded).map_err(|cause| {
                            machine_error(
                                "invalid_request",
                                format!(
                                    "project checkpoint model snapshot JSON is invalid: {cause}"
                                ),
                            )
                        })?,
                    )
                }
                (None, None) => None,
                (Some(_), Some(_)) => unreachable!("both forms were rejected above"),
            };
        let imported_model = imported_model_definition.map(compile_model).transpose()?;
        let requested_model_hash = definition.model_hash;
        if definition.world_snapshot.is_some() && definition.world_snapshot_json.is_some() {
            return Err(machine_error(
                "invalid_request",
                "project checkpoint must provide at most one world snapshot representation",
            ));
        }
        let imported_world = match (definition.world_snapshot, definition.world_snapshot_json) {
            (Some(world), None) => Some(world),
            (None, Some(encoded)) => {
                if encoded.len() > MAX_PROJECT_EXPORT_BYTES {
                    return Err(machine_error(
                        "invalid_request",
                        "project checkpoint world snapshot JSON is unbounded",
                    ));
                }
                Some(
                    serde_json::from_str::<WorldHead>(&encoded).map_err(|cause| {
                        machine_error(
                            "invalid_request",
                            format!("project checkpoint world snapshot JSON is invalid: {cause}"),
                        )
                    })?,
                )
            }
            (None, None) => None,
            (Some(_), Some(_)) => unreachable!("both forms were rejected above"),
        };
        let world_hash = definition.world_hash.or_else(|| {
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

        if world.as_ref().is_some_and(|world| self.world_has_revision_history(world)) {
            return Err(machine_error("unsupported_history", "portable checkpoint snapshots across world revisions are not supported; the complete accepted history remains preserved in the session database"));
        }

        if definition.narrative_graph_snapshot.is_some()
            && definition.narrative_graph_snapshot_json.is_some()
        {
            return Err(machine_error(
                "invalid_request",
                "project checkpoint must provide at most one graph snapshot representation",
            ));
        }
        let imported_graph = match (
            definition.narrative_graph_snapshot,
            definition.narrative_graph_snapshot_json,
        ) {
            (Some(graph), None) => Some(graph),
            (None, Some(encoded)) => {
                if encoded.len() > MAX_PROJECT_EXPORT_BYTES {
                    return Err(machine_error(
                        "invalid_request",
                        "project checkpoint graph snapshot JSON is unbounded",
                    ));
                }
                Some(
                    serde_json::from_str::<StoredNarrativeGraph>(&encoded).map_err(|cause| {
                        machine_error(
                            "invalid_request",
                            format!("project checkpoint graph snapshot JSON is invalid: {cause}"),
                        )
                    })?,
                )
            }
            (None, None) => None,
            (Some(_), Some(_)) => unreachable!("both forms were rejected above"),
        };
        let requested_graph_hash = definition.narrative_graph_hash;
        let requested_graph_snapshot_hash = definition.narrative_graph_snapshot_hash;
        let graph = if let Some(graph) = imported_graph {
            Some(graph)
        } else if let Some(snapshot_hash) = requested_graph_snapshot_hash.as_deref() {
            Some(
                self.project_graph_snapshots
                    .get(snapshot_hash)
                    .cloned()
                    .ok_or_else(|| {
                        machine_error(
                            "not_found",
                            format!("unknown narrative graph snapshot {snapshot_hash}"),
                        )
                    })?,
            )
        } else if let Some(graph_hash) = requested_graph_hash.as_deref() {
            Some(self.materialize_narrative_graph(graph_hash).map_err(|_| {
                machine_error(
                    "not_found",
                    format!("unknown active narrative graph {graph_hash}; a frozen project graph requires narrative_graph_snapshot_hash"),
                )
            })?)
        } else {
            None
        };
        let narrative_graph_hash = graph.as_ref().map(|graph| graph.graph_hash.clone());
        if let Some(graph) = &graph {
            self.ensure_portable_source_history(&graph.snapshot)?;
        }
        if let (Some(expected), Some(actual)) =
            (requested_graph_hash.as_ref(), narrative_graph_hash.as_ref())
        {
            if expected != actual {
                return Err(machine_error(
                    "conflict",
                    "project checkpoint graph hash does not match its frozen graph snapshot",
                ));
            }
        }
        let narrative_graph_snapshot_hash = graph
            .as_ref()
            .map(project_graph_snapshot_hash)
            .transpose()?;
        if let (Some(expected), Some(actual)) = (
            requested_graph_snapshot_hash.as_ref(),
            narrative_graph_snapshot_hash.as_ref(),
        ) {
            if expected != actual {
                return Err(machine_error(
                    "conflict",
                    "project checkpoint graph snapshot identity does not match its frozen graph and source snapshot",
                ));
            }
        }

        let mut required_model_hashes = Vec::new();
        if let Some(hash) = requested_model_hash.as_ref() {
            required_model_hashes.push(hash.clone());
        }
        if let Some(model) = imported_model.as_ref() {
            required_model_hashes.push(model.model_hash.clone());
        }
        if let Some(world) = world.as_ref() {
            required_model_hashes.push(world.model_hash.clone());
        }
        if let Some(graph) = graph.as_ref() {
            required_model_hashes.push(graph.snapshot.model_hash.clone());
        }
        if let Some(first) = required_model_hashes.first() {
            if required_model_hashes.iter().any(|hash| hash != first) {
                return Err(machine_error(
                    "conflict",
                    "project checkpoint model, world, and graph snapshots disagree",
                ));
            }
        }
        let model_hash = required_model_hashes.into_iter().next();
        let model = model_hash
            .as_deref()
            .map(|hash| {
                imported_model
                    .as_ref()
                    .filter(|model| model.model_hash == hash)
                    .or_else(|| self.models.get(hash))
                    .or_else(|| self.project_model_snapshots.get(hash))
                    .cloned()
                    .ok_or_else(|| machine_error("not_found", format!("unknown model {hash}")))
            })
            .transpose()?;
        if let (Some(model), Some(world)) = (model.as_ref(), world.as_ref()) {
            if world.model_hash != model.model_hash {
                return Err(machine_error(
                    "conflict",
                    "project checkpoint model and world snapshots disagree",
                ));
            }
            validate_world(model, world)?;
        }
        if let (Some(model), Some(graph)) = (model.as_ref(), graph.as_ref()) {
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
            validate_project_graph_source_binding(model, world.as_ref(), graph)?;
        }
        let core = ProjectCheckpointCore {
            schema: PROJECT_CHECKPOINT_SCHEMA.to_owned(),
            name: definition.name,
            parent_checkpoint_hash,
            document_hash: document_hash.clone(),
            canonical_external_path,
            model_hash,
            world_hash,
            narrative_graph_hash,
            narrative_graph_snapshot_hash,
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

        let document_is_new = !self.project_documents.contains_key(&document_hash);
        let model_is_new = model
            .as_ref()
            .is_some_and(|model| !self.project_model_snapshots.contains_key(&model.model_hash));
        let world_is_new = world
            .as_ref()
            .is_some_and(|world| !self.project_world_snapshots.contains_key(&world.world_hash));
        let graph_is_new = checkpoint
            .core
            .narrative_graph_snapshot_hash
            .as_ref()
            .is_some_and(|hash| !self.project_graph_snapshots.contains_key(hash));
        let mut added = serialized_size(&checkpoint)?;
        if document_is_new {
            added = added
                .checked_add(serialized_size(&document)?)
                .ok_or_else(|| {
                    machine_error(
                        "invalid_request",
                        "project checkpoint storage estimate overflow",
                    )
                })?;
        }
        if model_is_new {
            added = added
                .checked_add(serialized_size(
                    &model.as_ref().expect("new model is present").definition,
                )?)
                .ok_or_else(|| {
                    machine_error(
                        "invalid_request",
                        "project checkpoint storage estimate overflow",
                    )
                })?;
        }
        if world_is_new {
            added = added
                .checked_add(serialized_size(
                    world.as_ref().expect("new world is present"),
                )?)
                .ok_or_else(|| {
                    machine_error(
                        "invalid_request",
                        "project checkpoint storage estimate overflow",
                    )
                })?;
        }
        if graph_is_new {
            added = added
                .checked_add(serialized_size(
                    graph.as_ref().expect("new graph is present"),
                )?)
                .ok_or_else(|| {
                    machine_error(
                        "invalid_request",
                        "project checkpoint storage estimate overflow",
                    )
                })?;
        }
        let projected_storage = self
            .project_storage_bytes()?
            .checked_add(added)
            .ok_or_else(|| {
                machine_error(
                    "invalid_request",
                    "project checkpoint storage estimate overflow",
                )
            })?;
        if projected_storage > MAX_PROJECT_STORAGE_BYTES {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "project checkpoint storage would exceed {MAX_PROJECT_STORAGE_BYTES} bytes"
                ),
            ));
        }

        if document_is_new {
            self.project_documents
                .insert(document_hash.clone(), document);
        }
        if let Some(model) = model {
            self.project_model_snapshots
                .entry(model.model_hash.clone())
                .or_insert(model);
        }
        if let Some(world) = world {
            self.project_world_snapshots
                .entry(world.world_hash.clone())
                .or_insert(world);
        }
        if let Some(graph) = graph {
            let snapshot_hash = project_graph_snapshot_hash(&graph)?;
            self.project_graph_snapshots
                .entry(snapshot_hash)
                .or_insert(graph);
        }
        self.project_checkpoint_names
            .insert(checkpoint.core.name.clone(), checkpoint_hash.clone());
        self.project_checkpoints
            .insert(checkpoint_hash.clone(), checkpoint.clone());
        self.next_project_checkpoint_sequence = next_sequence;
        if self.state_file.is_some() {
            if document_is_new {
                self.dirty.project_documents.insert(document_hash);
            }
            if model_is_new {
                if let Some(hash) = &checkpoint.core.model_hash {
                    self.dirty.project_model_snapshots.insert(hash.clone());
                }
            }
            if world_is_new {
                if let Some(hash) = &checkpoint.core.world_hash {
                    self.dirty.project_world_snapshots.insert(hash.clone());
                }
            }
            if graph_is_new {
                if let Some(hash) = &checkpoint.core.narrative_graph_snapshot_hash {
                    self.dirty.project_graph_snapshots.insert(hash.clone());
                }
            }
            self.dirty.project_checkpoints.insert(checkpoint_hash);
        }
        encode(self.project_checkpoint_summary(&checkpoint)?)
    }

    fn ensure_model_insert(&self, model: &CompiledModel) -> EngineResult<()> {
        if self.models.contains_key(&model.model_hash) {
            return Ok(());
        }
        if self.models.len() >= MAX_SESSION_MODELS {
            return Err(error(format!(
                "session model count would exceed {MAX_SESSION_MODELS}"
            )));
        }
        let bytes = serialized_sum(self.models.values().map(|item| &item.definition))?
            .checked_add(serialized_size(&model.definition)?)
            .ok_or_else(|| error("session model byte estimate overflow"))?;
        if bytes > MAX_SESSION_MODEL_BYTES {
            return Err(error(format!(
                "session model bytes would exceed {MAX_SESSION_MODEL_BYTES}"
            )));
        }
        Ok(())
    }

    fn ensure_world_insert(&self, world: &WorldHead) -> EngineResult<()> {
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

    fn ensure_world_replacement(&self, world_id: &str, world: &WorldHead) -> EngineResult<()> {
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

    fn ensure_world_revision_insert(&self, revision: &WorldRevision) -> EngineResult<()> {
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

    fn ensure_candidate_insert(&self, candidate: &StoredCandidate) -> EngineResult<()> {
        self.ensure_candidate_changes(&BTreeMap::new(), Some(candidate))
    }

    fn ensure_candidate_replacement(
        &self,
        candidate_hash: &str,
        replacement: &StoredCandidate,
    ) -> EngineResult<()> {
        let mut replacements = BTreeMap::new();
        replacements.insert(candidate_hash.to_owned(), replacement.clone());
        self.ensure_candidate_changes(&replacements, None)
    }

    fn ensure_candidate_changes(
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
                .get(&stored.record.candidate.model_hash)
                .ok_or_else(|| error("candidate model is unavailable"))?;
            replay_work = replay_work
                .checked_add(candidate_replay_work(
                    model,
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
                .get(&stored.record.candidate.model_hash)
                .ok_or_else(|| error("candidate model is unavailable"))?;
            replay_work = replay_work
                .checked_add(candidate_replay_work(
                    model,
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

    fn restore(persisted: PersistedSession) -> EngineResult<Self> {
        if persisted.schema != SESSION_STATE_SCHEMA {
            return Err(error(format!(
                "unsupported session state schema {}; expected {SESSION_STATE_SCHEMA}",
                persisted.schema
            )));
        }
        let mut session = Self {
            persistence_generation: persisted.persistence_generation,
            ..Self::default()
        };
        for definition in persisted.models {
            let compiled = compile_model(definition)?;
            if session
                .models
                .insert(compiled.model_hash.clone(), compiled)
                .is_some()
            {
                return Err(error("state file contains a duplicate model hash"));
            }
        }
        let mut revision_zero_ids = BTreeSet::new();
        for model in session.models.values() {
            match &model.revision.previous_model_hash {
                None => {
                    if model.revision.number != 0 || !revision_zero_ids.insert(model.id.as_str()) {
                        return Err(error("state file contains an invalid model revision root"));
                    }
                }
                Some(previous_hash) => {
                    let previous = session.models.get(previous_hash).ok_or_else(|| {
                        error(format!(
                            "state file model {} lacks previous revision {previous_hash}",
                            model.model_hash
                        ))
                    })?;
                    if previous.id != model.id
                        || model.revision.number != previous.revision.number + 1
                    {
                        return Err(error("state file contains a broken model revision link"));
                    }
                    validate_revision_process_changes(previous, model)?;
                }
            }
        }
        for world in persisted.worlds {
            let model = session.models.get(&world.model_hash).ok_or_else(|| {
                error(format!(
                    "state file world {} names an unknown model",
                    world.world_id
                ))
            })?;
            validate_world(model, &world)?;
            if session
                .worlds
                .insert(world.world_id.clone(), world)
                .is_some()
            {
                return Err(error("state file contains a duplicate world id"));
            }
        }
        if persisted.world_revisions.len() > MAX_SESSION_WORLD_REVISIONS
            || serialized_sum(persisted.world_revisions.iter())? > MAX_SESSION_WORLD_REVISION_BYTES
        {
            return Err(error("state file exceeds world revision storage limits"));
        }
        for revision in persisted.world_revisions {
            let source = session.models.get(&revision.source_head.model_hash)
                .ok_or_else(|| error("world revision source model is unavailable"))?;
            let target = session.models.get(&revision.target_head.model_hash)
                .ok_or_else(|| error("world revision target model is unavailable"))?;
            let rebuilt = build_world_revision(source, target, &revision.source_head, WorldRevisionSpec {
                expected_world_hash: revision.source_head.world_hash.clone(),
                mode: revision.mode,
                state_values: revision.state_values.clone(),
                reason: revision.reason.clone(),
                provenance: revision.provenance.clone(),
            })?;
            if rebuilt != revision {
                return Err(error("state file world revision does not reconstruct its frozen transition"));
            }
            if session.world_revisions.insert(revision.world_revision_hash.clone(), revision).is_some() {
                return Err(error("state file contains duplicate world revision hash"));
            }
        }
        session.validate_storage_limits()?;
        if persisted.candidates.len() > MAX_SESSION_CANDIDATES {
            return Err(error(
                "state file exceeds the session candidate-count limit",
            ));
        }
        let candidate_bytes = serialized_sum(persisted.candidates.iter())?
            .checked_add(persisted.candidates.len().saturating_mul(16))
            .ok_or_else(|| error("state-file candidate storage estimate overflow"))?;
        if candidate_bytes > MAX_SESSION_CANDIDATE_BYTES {
            return Err(error("state file exceeds the session candidate-byte limit"));
        }
        let mut replay_work = 0usize;
        for stored in &persisted.candidates {
            let model = session
                .models
                .get(&stored.record.candidate.model_hash)
                .ok_or_else(|| error("state file candidate names an unknown model"))?;
            replay_work = replay_work
                .checked_add(candidate_replay_work(
                    model,
                    &stored.parent,
                    &stored.record.candidate.query,
                )?)
                .ok_or_else(|| error("state-file replay-work estimate overflow"))?;
            if replay_work > MAX_SESSION_REPLAY_WORK {
                return Err(error(format!(
                    "state file replay work exceeds {MAX_SESSION_REPLAY_WORK}"
                )));
            }
        }
        for stored in persisted.candidates {
            let model = session
                .models
                .get(&stored.record.candidate.model_hash)
                .ok_or_else(|| error("state file candidate names an unknown model"))?;
            validate_world(model, &stored.parent)?;
            let replay = roll_model_transition(
                model,
                &stored.parent,
                stored.record.candidate.query.clone(),
            )?;
            if replay.candidate != stored.record.candidate
                || replay.proposed_head != stored.record.proposed_head
            {
                return Err(error(
                    "state file candidate does not replay from its frozen parent",
                ));
            }
            let hash = stored.record.candidate.candidate_hash.clone();
            if session.candidates.insert(hash, stored).is_some() {
                return Err(error("state file contains a duplicate candidate hash"));
            }
        }
        session.validate_restored_lineage()?;
        if persisted.narrative_revisions.len() > MAX_SESSION_NARRATIVE_GRAPHS {
            return Err(error(
                "state file exceeds the session narrative-graph count limit",
            ));
        }
        if persisted.narrative_source_snapshots.len() > MAX_SESSION_NARRATIVE_GRAPHS {
            return Err(error(
                "state file exceeds the narrative source-snapshot count limit",
            ));
        }
        for stored in persisted.narrative_source_snapshots {
            if hash_serializable(&stored.snapshot)? != stored.snapshot_hash {
                return Err(error("state file narrative snapshot hash is invalid"));
            }
            if session
                .narrative_source_snapshots
                .insert(stored.snapshot_hash, stored.snapshot)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate narrative snapshot hash",
                ));
            }
        }
        let mut expected_operation_sequence = 0u64;
        for stored in persisted.narrative_revisions {
            if stored.operation_sequence != expected_operation_sequence {
                return Err(error(
                    "state file narrative operation sequences must be unique, contiguous, and ordered",
                ));
            }
            expected_operation_sequence = expected_operation_sequence
                .checked_add(1)
                .ok_or_else(|| error("narrative operation sequence overflow"))?;
            if stored.schema != NARRATIVE_REVISION_STORE_SCHEMA {
                return Err(error(format!(
                    "unsupported narrative revision record schema {}; expected {NARRATIVE_REVISION_STORE_SCHEMA}",
                    stored.schema
                )));
            }
            if !session
                .narrative_source_snapshots
                .contains_key(&stored.snapshot_hash)
            {
                return Err(error(
                    "state file narrative revision names an unknown source snapshot",
                ));
            }
            if session
                .narrative_revisions
                .insert(stored.graph_hash.clone(), stored)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate narrative graph hash",
                ));
            }
        }
        session.next_narrative_operation_sequence = expected_operation_sequence;
        session.validate_narrative_revision_chains()?;
        let mut ordered_revisions: Vec<StoredNarrativeRevision> =
            session.narrative_revisions.values().cloned().collect();
        ordered_revisions.sort_by_key(|record| record.operation_sequence);
        let mut remaining_children = BTreeMap::<String, usize>::new();
        for record in &ordered_revisions {
            if let Some(previous_hash) = &record.revision.previous_graph_hash {
                *remaining_children.entry(previous_hash.clone()).or_default() += 1;
            }
        }
        let mut materialized_definitions = BTreeMap::<String, NarrativeGraphDefinition>::new();
        let mut referenced_snapshots = BTreeSet::new();
        for record in ordered_revisions {
            validate_narrative_revision_record_hash(&record)?;
            let previous = record
                .revision
                .previous_graph_hash
                .as_ref()
                .map(|hash| {
                    materialized_definitions.get(hash).ok_or_else(|| {
                        error("narrative revision parent was not materialized before its child")
                    })
                })
                .transpose()?;
            let definition = apply_narrative_revision_record(previous, &record)?;
            let compiled = compile_narrative_graph(definition)?;
            if compiled.graph_hash != record.graph_hash {
                return Err(error(format!(
                    "narrative revision {} does not reconstruct its graph hash",
                    record.operation_sequence
                )));
            }
            validate_narrative_insertion_order(&record, &compiled.definition)?;
            if let (Some(previous), NarrativeRevisionPayload::Delta { delta }) =
                (previous, &record.payload)
            {
                if build_narrative_graph_delta(previous, &compiled.definition) != *delta {
                    return Err(error(format!(
                        "narrative revision {} contains a noncanonical or tampered delta",
                        record.operation_sequence
                    )));
                }
            }
            let snapshot = session
                .narrative_source_snapshots
                .get(&record.snapshot_hash)
                .ok_or_else(|| error("narrative revision names an unknown source snapshot"))?;
            session.validate_narrative_snapshot_binding(&compiled, snapshot)?;
            session.validate_narrative_anchors(&compiled, snapshot)?;
            referenced_snapshots.insert(record.snapshot_hash.clone());
            if let Some(previous_hash) = &record.revision.previous_graph_hash {
                let remaining = remaining_children
                    .get_mut(previous_hash)
                    .ok_or_else(|| error("narrative revision child accounting is invalid"))?;
                *remaining = remaining
                    .checked_sub(1)
                    .ok_or_else(|| error("narrative revision child accounting underflow"))?;
                if *remaining == 0 {
                    materialized_definitions.remove(previous_hash);
                }
            }
            if remaining_children
                .get(&record.graph_hash)
                .copied()
                .unwrap_or_default()
                > 0
            {
                materialized_definitions.insert(record.graph_hash, compiled.definition);
            }
        }
        if referenced_snapshots.len() != session.narrative_source_snapshots.len() {
            return Err(error(
                "state file contains an unreferenced narrative source snapshot",
            ));
        }
        for document in persisted.project_documents {
            let expected_hash = hash_serializable(&serde_json::json!({
                "media_type": document.media_type,
                "content": document.content,
            }))?;
            if document.document_hash != expected_hash
                || document.media_type.trim().is_empty()
                || document.media_type.len() > MAX_NARRATIVE_STRING_BYTES
                || document.content.len() > MAX_PROJECT_DOCUMENT_BYTES
            {
                return Err(error(
                    "state file project document hash, media type, or size is invalid",
                ));
            }
            if session
                .project_documents
                .insert(document.document_hash.clone(), document)
                .is_some()
            {
                return Err(error("state file contains a duplicate project document"));
            }
        }
        for definition in persisted.project_model_snapshots {
            let compiled = compile_model(definition)?;
            if session
                .project_model_snapshots
                .insert(compiled.model_hash.clone(), compiled)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate project model snapshot",
                ));
            }
        }
        for world in persisted.project_world_snapshots {
            let model = session
                .project_model_snapshots
                .get(&world.model_hash)
                .ok_or_else(|| error("project world snapshot names an unknown project model"))?;
            validate_world(model, &world)?;
            if session
                .project_world_snapshots
                .insert(world.world_hash.clone(), world)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate project world snapshot",
                ));
            }
        }
        for graph in persisted.project_graph_snapshots {
            let model = session
                .project_model_snapshots
                .get(&graph.snapshot.model_hash)
                .ok_or_else(|| error("project graph snapshot names an unknown project model"))?;
            if compile_narrative_graph(graph.definition.clone())?.graph_hash != graph.graph_hash
                || hash_serializable(&graph.snapshot)? != graph.snapshot_hash
                || graph.snapshot.model_revision != model.revision.number
                || graph.snapshot.state.len() != model.processes.len()
            {
                return Err(error("state file project graph snapshot is invalid"));
            }
            for (id, process) in &model.processes {
                let value =
                    graph.snapshot.state.get(id).ok_or_else(|| {
                        error(format!("project graph snapshot lacks process {id}"))
                    })?;
                validate_process_value(&process.value_type, value, id)?;
            }
            validate_project_graph_source_binding(model, None, &graph)?;
            let project_snapshot_hash = project_graph_snapshot_hash(&graph)?;
            if session
                .project_graph_snapshots
                .insert(project_snapshot_hash, graph)
                .is_some()
            {
                return Err(error(
                    "state file contains a duplicate project graph snapshot",
                ));
            }
        }
        if persisted.project_checkpoints.len() > MAX_PROJECT_CHECKPOINTS {
            return Err(error("state file exceeds project checkpoint count limit"));
        }
        for (expected_sequence, checkpoint) in (0u64..).zip(persisted.project_checkpoints) {
            let checkpoint_model_hash = checkpoint.core.model_hash.as_deref();
            let checkpoint_world = checkpoint
                .core
                .world_hash
                .as_ref()
                .and_then(|hash| session.project_world_snapshots.get(hash));
            let checkpoint_graph = checkpoint
                .core
                .narrative_graph_snapshot_hash
                .as_ref()
                .and_then(|hash| session.project_graph_snapshots.get(hash));
            if checkpoint.checkpoint_sequence != expected_sequence
                || checkpoint.core.schema != PROJECT_CHECKPOINT_SCHEMA
                || hash_serializable(&checkpoint.core)? != checkpoint.checkpoint_hash
                || checkpoint.core.name.trim().is_empty()
                || checkpoint.core.name.len() > MAX_MODEL_IDENTIFIER_BYTES
                || is_project_checkpoint_hash_shaped_name(&checkpoint.core.name)
                || checkpoint.core.reason.len() > MAX_NARRATIVE_STRING_BYTES
                || checkpoint.core.provenance.len() > MAX_OBSERVATION_PROVENANCE
                || checkpoint.core.provenance.iter().any(|value| {
                    value.trim().is_empty() || value.len() > MAX_NARRATIVE_STRING_BYTES
                })
                || checkpoint
                    .core
                    .canonical_external_path
                    .as_ref()
                    .is_some_and(|path| {
                        path.trim().is_empty() || path.len() > MAX_NARRATIVE_STRING_BYTES
                    })
                || !session
                    .project_documents
                    .contains_key(&checkpoint.core.document_hash)
                || checkpoint
                    .core
                    .model_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_model_snapshots.contains_key(hash))
                || checkpoint
                    .core
                    .world_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_world_snapshots.contains_key(hash))
                || checkpoint
                    .core
                    .narrative_graph_snapshot_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_graph_snapshots.contains_key(hash))
                || checkpoint.core.narrative_graph_hash.is_some()
                    != checkpoint.core.narrative_graph_snapshot_hash.is_some()
                || checkpoint
                    .core
                    .parent_checkpoint_hash
                    .as_ref()
                    .is_some_and(|hash| !session.project_checkpoints.contains_key(hash))
                || checkpoint_world
                    .is_some_and(|world| Some(world.model_hash.as_str()) != checkpoint_model_hash)
                || checkpoint_graph.is_some_and(|graph| {
                    Some(graph.snapshot.model_hash.as_str()) != checkpoint_model_hash
                        || Some(graph.graph_hash.as_str())
                            != checkpoint.core.narrative_graph_hash.as_deref()
                })
                || checkpoint_world
                    .zip(checkpoint_graph)
                    .is_some_and(|(world, graph)| {
                        validate_project_graph_source_binding(
                            session
                                .project_model_snapshots
                                .get(&graph.snapshot.model_hash)
                                .expect("project graph model was checked above"),
                            Some(world),
                            graph,
                        )
                        .is_err()
                    })
            {
                return Err(error(
                    "state file project checkpoint is invalid or out of order",
                ));
            }
            if session
                .project_checkpoint_names
                .insert(
                    checkpoint.core.name.clone(),
                    checkpoint.checkpoint_hash.clone(),
                )
                .is_some()
                || session
                    .project_checkpoints
                    .insert(checkpoint.checkpoint_hash.clone(), checkpoint)
                    .is_some()
            {
                return Err(error("state file contains a duplicate project checkpoint"));
            }
            session.next_project_checkpoint_sequence = expected_sequence
                .checked_add(1)
                .ok_or_else(|| error("project checkpoint sequence overflow"))?;
        }
        session.narrative_storage_bytes = session.compute_narrative_storage_bytes()?;
        session.validate_storage_limits()?;
        Ok(session)
    }

    fn validate_narrative_snapshot_binding(
        &self,
        graph: &CompiledNarrativeGraph,
        snapshot: &NarrativeSourceSnapshot,
    ) -> EngineResult<()> {
        let model = self
            .models
            .get(&snapshot.model_hash)
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

    fn validate_narrative_revision_chains(&self) -> EngineResult<()> {
        let mut roots = BTreeSet::new();
        let mut operation_sequences = BTreeSet::new();
        for stored in self.narrative_revisions.values() {
            if !operation_sequences.insert(stored.operation_sequence) {
                return Err(error("narrative operation sequence is duplicated"));
            }
            let revision = &stored.revision;
            match &revision.previous_graph_hash {
                None => {
                    if revision.number != 0 || !roots.insert(stored.graph_id.as_str()) {
                        return Err(error(
                            "narrative graph store contains an invalid revision root",
                        ));
                    }
                }
                Some(previous_hash) => {
                    let previous =
                        self.narrative_revisions.get(previous_hash).ok_or_else(|| {
                            error(format!(
                                "narrative graph {} lacks previous revision {previous_hash}",
                                stored.graph_hash
                            ))
                        })?;
                    if previous.graph_id != stored.graph_id
                        || revision.number != previous.revision.number + 1
                        || previous.operation_sequence >= stored.operation_sequence
                    {
                        return Err(error("narrative graph revision chain is broken"));
                    }
                }
            }
        }
        if operation_sequences.len() != self.next_narrative_operation_sequence as usize
            || operation_sequences
                .iter()
                .copied()
                .ne(0..self.next_narrative_operation_sequence)
        {
            return Err(error(
                "narrative operation sequences must form one contiguous append-only history",
            ));
        }
        Ok(())
    }

    fn validate_restored_lineage(&self) -> EngineResult<()> {
        let mut accepted = BTreeSet::new();
        let mut accepted_revisions = BTreeSet::new();
        for world in self.worlds.values() {
            let mut cursor = world.clone();
            loop {
                if cursor.version == 0 {
                    let model = self.models.get(&cursor.model_hash)
                        .ok_or_else(|| error("state file world model is unavailable"))?;
                    if cursor.lineage_head.is_some()
                        || cursor != model.genesis_world(cursor.world_id.clone())?
                    {
                        return Err(error(
                            "state file accepted lineage does not end at the model genesis world",
                        ));
                    }
                    break;
                }
                let hash = cursor.lineage_head.clone().ok_or_else(|| {
                    error("state file accepted world lacks a lineage-head candidate")
                })?;
                if let Some(revision) = self.world_revisions.get(&hash) {
                    if !accepted_revisions.insert(hash.clone()) || revision.target_head != cursor {
                        return Err(error("state file accepted lineage has an incoherent or repeated world revision"));
                    }
                    cursor = revision.source_head.clone();
                    continue;
                }
                if !accepted.insert(hash.clone()) {
                    return Err(error("state file accepted lineage repeats a candidate"));
                }
                let stored = self.candidates.get(&hash).ok_or_else(|| {
                    error(format!(
                        "state file accepted lineage names unknown candidate {hash}"
                    ))
                })?;
                if stored.record.status != CandidateStatus::Committed
                    || stored.record.candidate.candidate_hash != hash
                    || stored.record.candidate.world_id != cursor.world_id
                    || stored.record.proposed_head != cursor
                    || stored.parent.world_id != cursor.world_id
                    || stored.parent.version.checked_add(1) != Some(cursor.version)
                    || stored.record.candidate.parent_world_hash != stored.parent.world_hash
                    || stored.record.candidate.expected_parent_version != stored.parent.version
                {
                    return Err(error(
                        "state file accepted lineage has incoherent status, world, or parent links",
                    ));
                }
                cursor = stored.parent.clone();
            }
        }
        if accepted_revisions.len() != self.world_revisions.len() {
            return Err(error("state file world revisions do not match accepted world ancestry"));
        }
        for (hash, stored) in &self.candidates {
            let is_accepted = accepted.contains(hash);
            if (stored.record.status == CandidateStatus::Committed) != is_accepted {
                return Err(error(
                    "state file committed candidate set does not match accepted world ancestry",
                ));
            }
        }
        Ok(())
    }

    fn mark_model_dirty(&mut self, model_hash: impl Into<String>) {
        if self.state_file.is_some() {
            self.dirty.models.insert(model_hash.into());
        }
    }

    fn mark_world_dirty(&mut self, world_id: impl Into<String>) {
        if self.state_file.is_some() {
            self.dirty.worlds.insert(world_id.into());
        }
    }

    fn mark_candidate_dirty(&mut self, candidate_hash: impl Into<String>) {
        if self.state_file.is_some() {
            self.dirty.candidates.insert(candidate_hash.into());
        }
    }

    fn reload_from_sqlite(&mut self) -> EngineResult<()> {
        let path = self
            .state_file
            .clone()
            .ok_or_else(|| error("cannot reload a session without a state file"))?;
        let persisted = load_sqlite_session(&path)?;
        let mut restored = Self::restore(persisted)?;
        restored.state_file = Some(path);
        *self = restored;
        Ok(())
    }

    #[cfg(test)]
    fn snapshot(&self) -> PersistedSession {
        PersistedSession {
            schema: SESSION_STATE_SCHEMA.to_owned(),
            persistence_generation: self.persistence_generation,
            models: self
                .models
                .values()
                .map(|model| model.definition.clone())
                .collect(),
            worlds: self.worlds.values().cloned().collect(),
            world_revisions: self.world_revisions.values().cloned().collect(),
            candidates: self.candidates.values().cloned().collect(),
            narrative_source_snapshots: self
                .narrative_source_snapshots
                .iter()
                .map(|(snapshot_hash, snapshot)| StoredNarrativeSourceSnapshot {
                    snapshot_hash: snapshot_hash.clone(),
                    snapshot: snapshot.clone(),
                })
                .collect(),
            narrative_revisions: {
                let mut revisions: Vec<StoredNarrativeRevision> =
                    self.narrative_revisions.values().cloned().collect();
                revisions.sort_by_key(|revision| revision.operation_sequence);
                revisions
            },
            project_documents: self.project_documents.values().cloned().collect(),
            project_model_snapshots: self
                .project_model_snapshots
                .values()
                .map(|model| model.definition.clone())
                .collect(),
            project_world_snapshots: self.project_world_snapshots.values().cloned().collect(),
            project_graph_snapshots: self.project_graph_snapshots.values().cloned().collect(),
            project_checkpoints: {
                let mut checkpoints: Vec<StoredProjectCheckpoint> =
                    self.project_checkpoints.values().cloned().collect();
                checkpoints.sort_by_key(|checkpoint| checkpoint.checkpoint_sequence);
                checkpoints
            },
        }
    }

    fn persist(&mut self) -> Result<(), PersistenceFailure> {
        if self.dirty.is_empty() {
            return Ok(());
        }
        let Some(path) = &self.state_file else {
            return Ok(());
        };
        let next_generation = persist_sqlite_changes(path, self)?;
        self.persistence_generation = next_generation;
        self.dirty = SessionDirty::default();
        Ok(())
    }

    pub fn parse_and_execute(&mut self, input: &str) -> ResponseEnvelope {
        let probe = match serde_json::from_str::<serde_json::Value>(input) {
            Ok(value) => value,
            Err(cause) => {
                return ResponseEnvelope {
                    schema: super::RESPONSE_SCHEMA,
                    request_id: None,
                    ok: false,
                    result: None,
                    error: Some(ErrorBody {
                        code: "invalid_json",
                        message: cause.to_string(),
                    }),
                }
            }
        };
        let operation = probe
            .get("operation")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !is_machine_operation(operation) {
            return super::parse_and_execute(input);
        }
        let probed_request_id = probe
            .get("request_id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        let command = match serde_json::from_value::<MachineCommand>(probe) {
            Ok(command) => command,
            Err(cause) => {
                return ResponseEnvelope {
                    schema: super::RESPONSE_SCHEMA,
                    request_id: probed_request_id,
                    ok: false,
                    result: None,
                    error: Some(ErrorBody {
                        code: "invalid_json",
                        message: cause.to_string(),
                    }),
                }
            }
        };
        let request_id = command.request_id.clone();
        let durable_mutation =
            self.state_file.is_some() && is_mutating_operation(&command.operation);
        if durable_mutation && !self.dirty.is_empty() {
            return ResponseEnvelope {
                schema: super::RESPONSE_SCHEMA,
                request_id,
                ok: false,
                result: None,
                error: Some(ErrorBody {
                    code: "internal_error",
                    message: "durable session began a command with unflushed dirty rows".to_owned(),
                }),
            };
        }
        let prior_generation = self.persistence_generation;
        let mut outcome = self.execute(command);
        if outcome.is_ok() && durable_mutation && !self.dirty.is_empty() {
            if let Err(failure) = self.persist() {
                let state_path = self.state_file.clone();
                let recovery = match state_path {
                    Some(path) if path.exists() => self.reload_from_sqlite(),
                    Some(path) => {
                        *self = Self {
                            state_file: Some(path),
                            ..Self::default()
                        };
                        Ok(())
                    }
                    None => Ok(()),
                };
                let uncertain = failure.state_file_replaced
                    && (recovery.is_err() || self.persistence_generation > prior_generation);
                let recovery_suffix = recovery
                    .err()
                    .map(|cause| format!("; authoritative reload also failed: {}", cause.0))
                    .unwrap_or_default();
                outcome = Err(if uncertain {
                    machine_error(
                        "persistence_uncertain",
                        format!(
                            "SQLite commit outcome is uncertain: {}{recovery_suffix}",
                            failure.cause.0
                        ),
                    )
                } else {
                    machine_error(
                        "persistence_error",
                        format!(
                            "state mutation was not committed: {}{recovery_suffix}",
                            failure.cause.0
                        ),
                    )
                });
            }
        } else if outcome.is_err() && durable_mutation && !self.dirty.is_empty() {
            let state_path = self.state_file.clone();
            if let Some(path) = state_path {
                if path.exists() {
                    let _ = self.reload_from_sqlite();
                } else {
                    *self = Self {
                        state_file: Some(path),
                        ..Self::default()
                    };
                }
            }
        }
        match outcome {
            Ok(result) => ResponseEnvelope {
                schema: super::RESPONSE_SCHEMA,
                request_id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(cause) => ResponseEnvelope {
                schema: super::RESPONSE_SCHEMA,
                request_id,
                ok: false,
                result: None,
                error: Some(ErrorBody {
                    code: cause.code,
                    message: cause.message,
                }),
            },
        }
    }

    fn execute(&mut self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        if command.schema != super::COMMAND_SCHEMA {
            return Err(machine_error(
                "invalid_request",
                format!(
                    "unsupported command schema {}; expected {}",
                    command.schema,
                    super::COMMAND_SCHEMA
                ),
            ));
        }
        match command.operation.as_str() {
            "compile_profiles" => {
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
            "validate_model" => {
                let model = required(command.model, "validate_model requires model")?;
                let compiled = compile_model(model)?;
                encode(serde_json::json!({
                    "summary": compiled.summary(),
                    "model": compiled.definition()
                }))
            }
            "register_model" | "revise_model" => {
                let operation = command.operation;
                let model = required(command.model, "model operation requires model")?;
                let compiled = compile_model(model)?;
                if operation == "register_model" && compiled.revision.number != 0 {
                    return Err(machine_error(
                        "invalid_request",
                        "register_model requires revision 0; use revise_model",
                    ));
                }
                if operation == "revise_model" && compiled.revision.number == 0 {
                    return Err(machine_error(
                        "invalid_request",
                        "revise_model requires a nonzero revision",
                    ));
                }
                self.validate_revision_link(&compiled)?;
                self.ensure_model_insert(&compiled)?;
                let result = serde_json::json!({
                    "summary": compiled.summary(),
                    "model": compiled.definition()
                });
                let model_hash = compiled.model_hash.clone();
                if !self.models.contains_key(&model_hash) {
                    self.models.insert(model_hash.clone(), compiled);
                    self.mark_model_dirty(model_hash);
                }
                encode(result)
            }
            "get_model" => {
                let model_hash = required(command.model_hash, "get_model requires model_hash")?;
                let model = self.models.get(&model_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {model_hash}"))
                })?;
                encode(serde_json::json!({
                    "model_hash": model.model_hash,
                    "summary": model.summary(),
                    "model": model.definition()
                }))
            }
            "create_world" => {
                let model_hash = required(command.model_hash, "create_world requires model_hash")?;
                let world_id = required(command.world_id, "create_world requires world_id")?;
                if self.worlds.contains_key(&world_id) {
                    return Err(machine_error(
                        "conflict",
                        format!("world {world_id} already exists"),
                    ));
                }
                let model = self.models.get(&model_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {model_hash}"))
                })?;
                let world = model.genesis_world(world_id.clone())?;
                let projected = world_view(model, &world, command.view.unwrap_or_default())?;
                self.ensure_world_insert(&world)?;
                self.worlds.insert(world_id.clone(), world.clone());
                self.mark_world_dirty(world_id);
                encode(projected)
            }
            "get_world" => {
                let world_id = required(command.world_id, "get_world requires world_id")?;
                let world = self.worlds.get(&world_id).ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                let model = self.models.get(&world.model_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {}", world.model_hash))
                })?;
                encode(world_view(model, world, command.view.unwrap_or_default())?)
            }
            "refine_genesis_world" => {
                let world_id =
                    required(command.world_id, "refine_genesis_world requires world_id")?;
                let target_model_hash = required(
                    command.model_hash,
                    "refine_genesis_world requires target model_hash",
                )?;
                let current = self.worlds.get(&world_id).cloned().ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                let source = self
                    .models
                    .get(&current.model_hash)
                    .cloned()
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
                    .get(&target_model_hash)
                    .cloned()
                    .ok_or_else(|| {
                        machine_error(
                            "not_found",
                            format!("unknown target model {target_model_hash}"),
                        )
                    })?;
                if target.revision.number != source.revision.number + 1
                    || target.revision.previous_model_hash.as_deref()
                        != Some(source.model_hash.as_str())
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
                self.mark_world_dirty(world_id);
                Ok(encoded)
            }
            "revise_world" => {
                let world_id = required(command.world_id, "revise_world requires world_id")?;
                let target_model_hash = required(command.model_hash, "revise_world requires target model_hash")?;
                let spec = required(command.world_revision, "revise_world requires world_revision")?;
                let current = self.worlds.get(&world_id).ok_or_else(|| machine_error("not_found", format!("unknown world {world_id}")))?;
                if spec.expected_world_hash != current.world_hash {
                    return Err(machine_error("conflict", format!("world {world_id} changed: expected {}, found {}", spec.expected_world_hash, current.world_hash)));
                }
                let source = self.models.get(&current.model_hash).ok_or_else(|| machine_error("not_found", "world source model is unavailable"))?;
                let target = self.models.get(&target_model_hash).ok_or_else(|| machine_error("not_found", format!("unknown target model {target_model_hash}")))?;
                let revision = build_world_revision(source, target, current, spec)?;
                self.ensure_world_replacement(&world_id, &revision.target_head)?;
                self.ensure_world_revision_insert(&revision)?;
                let view = command.view.unwrap_or_default();
                let response = encode(serde_json::json!({
                    "operation": "revise_world",
                    "world_revision_hash": revision.world_revision_hash,
                    "world_revision": world_revision_view(source, target, &revision, view.clone())?,
                    "world_head": world_view(target, &revision.target_head, view)?,
                    "limitations": [
                        "new process values must be explicitly supplied at the current world time; target model initial values and claims are not injected",
                        "portable narrative and checkpoint export across world revisions is unsupported; complete accepted history remains in the session database"
                    ]
                }))?;
                self.worlds.insert(world_id.clone(), revision.target_head.clone());
                self.mark_world_dirty(world_id);
                let hash = revision.world_revision_hash.clone();
                self.world_revisions.insert(hash.clone(), revision);
                if self.state_file.is_some() {
                    self.dirty.world_revisions.insert(hash);
                }
                Ok(response)
            }
            "get_world_revision" => {
                let hash = required(command.world_revision_hash, "get_world_revision requires world_revision_hash")?;
                let revision = self.world_revisions.get(&hash).ok_or_else(|| machine_error("not_found", format!("unknown world revision {hash}")))?;
                let source = self.models.get(&revision.source_head.model_hash).ok_or_else(|| machine_error("not_found", "revision source model is unavailable"))?;
                let target = self.models.get(&revision.target_head.model_hash).ok_or_else(|| machine_error("not_found", "revision target model is unavailable"))?;
                encode(serde_json::json!({"world_revision": world_revision_view(source, target, revision, command.view.unwrap_or_default())?}))
            }
            "roll_world" => {
                let world_id = required(command.world_id, "roll_world requires world_id")?;
                let query = required(command.query, "roll_world requires query")?;
                let parent = self.worlds.get(&world_id).cloned().ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                let model = self.models.get(&parent.model_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {}", parent.model_hash))
                })?;
                let result = roll_model_transition(model, &parent, query)?;
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
                    if existing.parent != parent
                        || !same_candidate_canon(&existing.record.candidate, &record.candidate)
                        || existing.record.proposed_head != record.proposed_head
                    {
                        return Err(machine_error(
                            "conflict",
                            "candidate hash is already bound to different canonical content",
                        ));
                    }
                    let retention_upgraded =
                        path_is_richer(&record.candidate.path, &existing.record.candidate.path);
                    if retention_upgraded {
                        let mut replacement = existing.clone();
                        replacement.record.candidate.query = record.candidate.query.clone();
                        replacement.record.candidate.query_hash =
                            record.candidate.query_hash.clone();
                        replacement.record.candidate.path = record.candidate.path.clone();
                        self.ensure_candidate_replacement(
                            &record.candidate.candidate_hash,
                            &replacement,
                        )?;
                        self.candidates
                            .insert(record.candidate.candidate_hash.clone(), replacement);
                        if self.state_file.is_some() {
                            self.dirty
                                .candidates
                                .insert(record.candidate.candidate_hash.clone());
                        }
                    }
                    let mut response_record = record;
                    response_record.status = existing.record.status;
                    let view = candidate_original_view(&response_record.candidate);
                    let projected = candidate_record_view(model, &response_record, view)?;
                    return Ok(attach_retention_upgrade(projected, retention_upgraded));
                }
                let stored = StoredCandidate {
                    record: record.clone(),
                    parent,
                };
                self.ensure_candidate_insert(&stored)?;
                self.candidates
                    .insert(record.candidate.candidate_hash.clone(), stored);
                if self.state_file.is_some() {
                    self.dirty
                        .candidates
                        .insert(record.candidate.candidate_hash.clone());
                }
                let view = candidate_original_view(&record.candidate);
                Ok(attach_retention_upgrade(
                    candidate_record_view(model, &record, view)?,
                    false,
                ))
            }
            "inspect_candidate" => {
                let hash = required(
                    command.candidate_hash,
                    "inspect_candidate requires candidate_hash",
                )?;
                let stored = self.candidates.get(&hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {hash}"))
                })?;
                let model = self
                    .models
                    .get(&stored.record.candidate.model_hash)
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                let view = command.view.unwrap_or_default();
                encode(candidate_record_view(model, &stored.record, view)?)
            }
            "summarize_trajectory" => {
                let hash = required(
                    command.candidate_hash,
                    "summarize_trajectory requires candidate_hash",
                )?;
                let spec = required(
                    command.trajectory_summary,
                    "summarize_trajectory requires trajectory_summary",
                )?;
                let stored = self.candidates.get(&hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {hash}"))
                })?;
                let model = self
                    .models
                    .get(&stored.record.candidate.model_hash)
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                encode(summarize_model_trajectory(
                    model,
                    &stored.parent,
                    &stored.record.candidate,
                    spec,
                )?)
            }
            "reroll_candidate" => {
                let hash = required(
                    command.candidate_hash,
                    "reroll_candidate requires candidate_hash",
                )?;
                let original = self.candidates.get(&hash).cloned().ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {hash}"))
                })?;
                if original.record.status == CandidateStatus::Committed {
                    return Err(machine_error(
                        "conflict",
                        "committed candidate cannot be rerolled",
                    ));
                }
                let model = self
                    .models
                    .get(&original.record.candidate.model_hash)
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                let mut response_view = command.view.unwrap_or_default();
                normalize_view(model, &mut response_view)?;
                let mut query = original.record.candidate.query.clone();
                query.roll_index = query
                    .roll_index
                    .checked_add(1)
                    .ok_or_else(|| machine_error("invalid_request", "roll_index overflow"))?;
                let result = roll_model_transition(model, &original.parent, query)?;
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
                    if existing.parent != original.parent
                        || !same_candidate_canon(&existing.record.candidate, &record.candidate)
                        || existing.record.proposed_head != record.proposed_head
                    {
                        return Err(machine_error(
                            "conflict",
                            "reroll candidate hash is already bound to different content",
                        ));
                    }
                    let existing_status = existing.record.status;
                    let retention_upgraded =
                        path_is_richer(&record.candidate.path, &existing.record.candidate.path);
                    let mut replacements = BTreeMap::new();
                    if retention_upgraded {
                        let mut replacement = existing.clone();
                        replacement.record.candidate.query = record.candidate.query.clone();
                        replacement.record.candidate.query_hash =
                            record.candidate.query_hash.clone();
                        replacement.record.candidate.path = record.candidate.path.clone();
                        replacements.insert(record.candidate.candidate_hash.clone(), replacement);
                    }
                    if original.record.status == CandidateStatus::Pending {
                        let mut source = original.clone();
                        source.record.status = CandidateStatus::Superseded;
                        replacements.insert(hash.clone(), source);
                    }
                    if !replacements.is_empty() {
                        self.ensure_candidate_changes(&replacements, None)?;
                        for (candidate_hash, replacement) in replacements {
                            self.candidates.insert(candidate_hash.clone(), replacement);
                            if self.state_file.is_some() {
                                self.dirty.candidates.insert(candidate_hash);
                            }
                        }
                    }
                    let mut response_record = record;
                    response_record.status = existing_status;
                    let projected = candidate_record_view(model, &response_record, response_view)?;
                    return Ok(attach_retention_upgrade(projected, retention_upgraded));
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
                let mut replacements = BTreeMap::new();
                if original.record.status == CandidateStatus::Pending {
                    let mut source = original.clone();
                    source.record.status = CandidateStatus::Superseded;
                    replacements.insert(hash.clone(), source);
                }
                self.ensure_candidate_changes(&replacements, Some(&stored))?;
                self.candidates
                    .insert(record.candidate.candidate_hash.clone(), stored);
                if self.state_file.is_some() {
                    self.dirty
                        .candidates
                        .insert(record.candidate.candidate_hash.clone());
                }
                for (candidate_hash, replacement) in replacements {
                    self.candidates.insert(candidate_hash.clone(), replacement);
                    if self.state_file.is_some() {
                        self.dirty.candidates.insert(candidate_hash);
                    }
                }
                Ok(attach_retention_upgrade(
                    candidate_record_view(model, &record, response_view)?,
                    false,
                ))
            }
            "reject_candidate" => {
                let hash = required(
                    command.candidate_hash,
                    "reject_candidate requires candidate_hash",
                )?;
                let stored = self.candidates.get(&hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {hash}"))
                })?;
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
                    .get(&record.candidate.model_hash)
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                let view = command.view.unwrap_or_default();
                let projected = candidate_record_view(model, &record, view)?;
                let mut replacement = stored.clone();
                replacement.record = record;
                self.ensure_candidate_replacement(&hash, &replacement)?;
                self.candidates.insert(hash.clone(), replacement);
                self.mark_candidate_dirty(hash);
                encode(projected)
            }
            "commit_candidate" => {
                let hash = required(
                    command.candidate_hash,
                    "commit_candidate requires candidate_hash",
                )?;
                self.commit_candidate(&hash, command.view.unwrap_or_default())
            }
            "register_narrative_graph" | "revise_narrative_graph" => {
                let operation = command.operation;
                let definition = required(
                    command.narrative_graph,
                    "narrative graph operation requires narrative_graph",
                )?;
                let insertion_order = NarrativeInsertionOrder {
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
                };
                let compiled = compile_narrative_graph(definition)?;
                if operation == "register_narrative_graph"
                    && compiled.definition.revision.number != 0
                {
                    return Err(machine_error(
                        "invalid_request",
                        "register_narrative_graph requires revision 0; use revise_narrative_graph",
                    ));
                }
                if operation == "revise_narrative_graph" && compiled.definition.revision.number == 0
                {
                    return Err(machine_error(
                        "invalid_request",
                        "revise_narrative_graph requires a nonzero revision",
                    ));
                }
                if self.narrative_revisions.contains_key(&compiled.graph_hash) {
                    let existing = self.materialize_narrative_graph(&compiled.graph_hash)?;
                    if existing.definition != compiled.definition {
                        return Err(machine_error(
                            "conflict",
                            "narrative graph hash is already bound to different content",
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
                let snapshot = self.capture_narrative_source(&compiled.definition.source)?;
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
                self.insert_narrative_revision(revision, snapshot)?;
                encode(result)
            }
            "apply_narrative_batch" => {
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
                self.insert_narrative_revision(revision, previous.snapshot)?;
                encode(result)
            }
            "list_narrative_revisions" => {
                self.list_narrative_revisions(command.narrative_history.unwrap_or_default())
            }
            "register_project_checkpoint" => {
                let checkpoint = required(
                    command.project_checkpoint,
                    "register_project_checkpoint requires project_checkpoint",
                )?;
                self.register_project_checkpoint(checkpoint)
            }
            "list_project_checkpoints" => self.list_project_checkpoints(),
            "get_project_checkpoint" => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "get_project_checkpoint requires project_checkpoint_id",
                )?;
                self.get_project_checkpoint(&identifier)
            }
            "export_project_checkpoint" => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "export_project_checkpoint requires project_checkpoint_id",
                )?;
                self.export_project_checkpoint(&identifier)
            }
            "render_project_checkpoint" => {
                let identifier = required(
                    command.project_checkpoint_id,
                    "render_project_checkpoint requires project_checkpoint_id",
                )?;
                self.render_project_checkpoint(&identifier, command.narrative_render)
            }
            "query_project_checkpoint_graph" => {
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
            "query_narrative_graph" => self.query_narrative_graph(command),
            "render_narrative_graph" => self.render_narrative_graph(command),
            "export_narrative_training" => self.export_narrative_training(command),
            "query_graph" => self.query_graph(command),
            "query_view" => self.query_view(command),
            unknown => Err(machine_error(
                "invalid_request",
                format!("unsupported machine operation {unknown}"),
            )),
        }
    }

    fn validate_revision_link(&self, model: &CompiledModel) -> Result<(), MachineError> {
        if let Some(existing) = self.models.get(&model.model_hash) {
            if existing.definition == model.definition {
                return Ok(());
            }
            return Err(machine_error(
                "conflict",
                "model hash is already bound to different content",
            ));
        }
        let Some(previous_hash) = &model.revision.previous_model_hash else {
            if self.models.values().any(|existing| {
                existing.id == model.id
                    && existing.revision.number == 0
                    && existing.model_hash != model.model_hash
            }) {
                return Err(machine_error(
                    "conflict",
                    "a different revision-zero model already uses this model id",
                ));
            }
            return Ok(());
        };
        let previous = self.models.get(previous_hash).ok_or_else(|| {
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
        validate_revision_process_changes(previous, model)?;
        Ok(())
    }

    fn validate_narrative_revision_link(
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

    fn query_view(&self, command: MachineCommand) -> Result<serde_json::Value, MachineError> {
        let view = required(command.view, "query_view requires view")?;
        match (command.world_id, command.candidate_hash) {
            (Some(world_id), None) => {
                let world = self.worlds.get(&world_id).ok_or_else(|| {
                    machine_error("not_found", format!("unknown world {world_id}"))
                })?;
                let model = self.models.get(&world.model_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown model {}", world.model_hash))
                })?;
                encode(world_view(model, world, view)?)
            }
            (None, Some(candidate_hash)) => {
                let stored = self.candidates.get(&candidate_hash).ok_or_else(|| {
                    machine_error("not_found", format!("unknown candidate {candidate_hash}"))
                })?;
                let model = self
                    .models
                    .get(&stored.record.candidate.model_hash)
                    .ok_or_else(|| machine_error("not_found", "candidate model is unavailable"))?;
                encode(candidate_record_view(model, &stored.record, view)?)
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
                .get(&model_hash)
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
                model,
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
            let model = self.models.get(&world.model_hash).ok_or_else(|| {
                machine_error("not_found", format!("unknown model {}", world.model_hash))
            })?;
            validate_world(model, world)?;
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
                model,
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
            .get(&stored.record.candidate.model_hash)
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
            model,
            &stored.record.candidate.successor_state,
            "candidate_successor_state",
            Some(&stored.record.candidate.marks),
            source,
            query,
        )?)
    }

    fn query_narrative_graph(
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

    fn query_stored_narrative_graph(
        &self,
        stored: StoredNarrativeGraph,
        query: NarrativeGraphQuery,
    ) -> Result<serde_json::Value, MachineError> {
        let graph = compile_narrative_graph(stored.definition.clone())?;
        let model = self
            .models
            .get(&stored.snapshot.model_hash)
            .or_else(|| {
                self.project_model_snapshots
                    .get(&stored.snapshot.model_hash)
            })
            .ok_or_else(|| machine_error("not_found", "narrative source model is unavailable"))?;
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

    fn list_narrative_revisions(
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
        let mut ordered: Vec<&StoredNarrativeRevision> = self
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

    fn list_project_checkpoints(&self) -> Result<serde_json::Value, MachineError> {
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

    fn get_project_checkpoint(&self, identifier: &str) -> Result<serde_json::Value, MachineError> {
        let checkpoint = self.resolve_project_checkpoint(identifier)?;
        encode(self.project_checkpoint_summary(checkpoint)?)
    }

    fn export_project_checkpoint(
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

    fn render_project_checkpoint(
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

    fn query_project_checkpoint_graph(
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

    fn render_narrative_graph(
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

    fn render_stored_narrative_graph(
        &self,
        stored: StoredNarrativeGraph,
        mut spec: NarrativeRenderSpec,
    ) -> Result<serde_json::Value, MachineError> {
        let graph = compile_narrative_graph(stored.definition.clone())?;
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

    fn export_narrative_training(
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
        let graph = compile_narrative_graph(stored.definition.clone())?;
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
        let model = self
            .models
            .get(&stored.snapshot.model_hash)
            .or_else(|| {
                self.project_model_snapshots
                    .get(&stored.snapshot.model_hash)
            })
            .ok_or_else(|| machine_error("not_found", "narrative source model is unavailable"))?;
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
                                if process_value_is_visible(process, &spec.access_scopes) {
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
            .get(&stored.record.candidate.model_hash)
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
            "candidate": candidate_record_view(model, &committed, view.clone())?,
            "world_head": world_view(model, &proposed, view)?
        });
        self.worlds.insert(world_id.clone(), proposed.clone());
        self.mark_world_dirty(world_id);
        for (candidate_hash, replacement) in replacements {
            self.candidates.insert(candidate_hash.clone(), replacement);
            self.mark_candidate_dirty(candidate_hash);
        }
        Ok(response)
    }
}

fn endpoint_node_id_local(endpoint: &NarrativeEndpoint) -> Option<&str> {
    match endpoint {
        NarrativeEndpoint::Node { node_id } => Some(node_id),
        NarrativeEndpoint::Anchor { .. } => None,
    }
}

fn narrative_edge_is_visible(
    edge: &NarrativeEdge,
    visible: &BTreeSet<String>,
    access_scopes: &[String],
    model: &CompiledModel,
    snapshot: &NarrativeSourceSnapshot,
) -> bool {
    (edge.access_scopes.is_empty()
        || edge
            .access_scopes
            .iter()
            .any(|scope| access_scopes.contains(scope)))
        && [&edge.source, &edge.target]
            .into_iter()
            .all(|endpoint| match endpoint {
                NarrativeEndpoint::Node { node_id } => visible.contains(node_id),
                NarrativeEndpoint::Anchor {
                    anchor_kind: NarrativeAnchorKind::Process,
                    anchor_id,
                    ..
                } => model.processes.get(anchor_id).is_none_or(|process| {
                    scopes_are_visible(&process.access_scopes, access_scopes)
                }),
                NarrativeEndpoint::Anchor {
                    anchor_kind: NarrativeAnchorKind::Claim,
                    anchor_id,
                    ..
                } => snapshot.claims.get(anchor_id).is_none_or(|claim| {
                    scopes_are_visible(&claim.access_scopes, access_scopes)
                        && model.processes.get(&claim.subject).is_none_or(|process| {
                            scopes_are_visible(&process.access_scopes, access_scopes)
                        })
                }),
                NarrativeEndpoint::Anchor { .. } => true,
            })
}

fn scopes_are_visible(required: &[String], supplied: &[String]) -> bool {
    required.is_empty() || required.iter().any(|scope| supplied.contains(scope))
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
            || (!edge.access_scopes.is_empty()
                && !edge
                    .access_scopes
                    .iter()
                    .any(|scope| access_scopes.contains(scope)))
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

fn validate_revision_process_changes(
    previous: &CompiledModel,
    revised: &CompiledModel,
) -> EngineResult<()> {
    let mut linked_targets = BTreeSet::new();
    for edge in &revised.definition.dependencies {
        if edge.law_id.is_some() {
            linked_targets.insert(edge.target.clone());
        }
    }
    let mut updated_targets = BTreeSet::new();
    for law in &revised.laws {
        match &law.operator {
            LawOperator::Evolution { target, .. }
            | LawOperator::Relation { target, .. }
            | LawOperator::Resolution { target, .. } => {
                updated_targets.insert(target.clone());
            }
            LawOperator::Occurrence { effects, .. } => {
                updated_targets.extend(effects.iter().map(|effect| effect.target.clone()));
            }
            LawOperator::Epistemic { .. } => {}
        }
    }
    for process in revised.processes.values() {
        let newly_introduced_or_reshaped = previous
            .processes
            .get(&process.id)
            .map(|old| old.value_type != process.value_type || old.axes != process.axes)
            .unwrap_or(true);
        if !newly_introduced_or_reshaped {
            continue;
        }
        if process.update_mode == ProcessUpdateMode::Unspecified
            && (!updated_targets.contains(&process.id) || !linked_targets.contains(&process.id))
        {
            return Err(error(format!(
                "new or reshaped process {} requires an updating law with a validated dependency edge or explicit static/observed update_mode",
                process.id
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct GenesisRefinementAudit {
    preserved_records: BTreeMap<String, usize>,
    added_records: BTreeMap<String, usize>,
}

/// Shared definition-preservation audit for genesis and post-history
/// refinement. Existing records remain exact, apart from extending partial
/// temporal recompositions with preserved child projections. World state
/// transition rules are enforced separately by each operation.
fn validate_monotonic_genesis_refinement(
    previous: &CompiledModel,
    revised: &CompiledModel,
) -> EngineResult<GenesisRefinementAudit> {
    if previous.id != revised.id || previous.time_unit != revised.time_unit {
        return Err(error(
            "genesis refinement must preserve the model id and time unit",
        ));
    }
    if revised.revision.number != previous.revision.number + 1
        || revised.revision.previous_model_hash.as_deref() != Some(previous.model_hash.as_str())
    {
        return Err(error(
            "genesis refinement requires the direct next model revision",
        ));
    }

    let mut preserved_records = BTreeMap::new();
    let mut added_records = BTreeMap::new();

    macro_rules! preserve_collection {
        ($label:literal, $previous:expr, $revised:expr) => {
            preserve_collection!($label, $previous, $revised, id)
        };
        ($label:literal, $previous:expr, $revised:expr, $key:ident) => {{
            let previous_records = $previous;
            let revised_records = $revised;
            let revised_by_id: BTreeMap<&str, _> = revised_records
                .iter()
                .map(|record| (record.$key.as_str(), record))
                .collect();
            for old in previous_records {
                match revised_by_id.get(old.$key.as_str()) {
                    None => {
                        return Err(error(format!(
                            "genesis refinement removed existing {} record {}; additions only",
                            $label, old.$key
                        )))
                    }
                    Some(new) if *new != old => {
                        return Err(error(format!(
                            "genesis refinement changed existing {} record {}; additions only",
                            $label, old.$key
                        )))
                    }
                    Some(_) => {}
                }
            }
            preserved_records.insert($label.to_owned(), previous_records.len());
            added_records.insert(
                $label.to_owned(),
                revised_records.len().saturating_sub(previous_records.len()),
            );
        }};
    }

    preserve_collection!(
        "processes",
        &previous.definition.processes,
        &revised.definition.processes
    );
    preserve_collection!(
        "decomposition",
        &previous.definition.decomposition,
        &revised.definition.decomposition
    );
    preserve_collection!(
        "dependencies",
        &previous.definition.dependencies,
        &revised.definition.dependencies
    );
    preserve_collection!("laws", &previous.definition.laws, &revised.definition.laws);
    preserve_collection!(
        "initial_claims",
        &previous.definition.initial_claims,
        &revised.definition.initial_claims
    );

    match (
        previous.definition.meaning_model.as_ref(),
        revised.definition.meaning_model.as_ref(),
    ) {
        (Some(_), None) => {
            return Err(error(
                "genesis refinement removed the existing Meaning Model; additions only",
            ))
        }
        (Some(old), Some(new)) => {
            if old.schema != new.schema {
                return Err(error(
                    "genesis refinement changed the existing Meaning Model schema",
                ));
            }
            match (&old.semantic_coverage, &new.semantic_coverage) {
                (Some(_), None) => {
                    return Err(error(
                        "genesis refinement removed the existing semantic coverage policy",
                    ))
                }
                (Some(old_coverage), Some(new_coverage)) => {
                    if old_coverage.mode == SemanticCoverageMode::Strict
                        && new_coverage.mode != SemanticCoverageMode::Strict
                    {
                        return Err(error(
                            "genesis refinement weakened strict semantic coverage",
                        ));
                    }
                    let revised_by_event: BTreeMap<&str, _> = new_coverage
                        .unresolved_events
                        .iter()
                        .map(|record| (record.event_id.as_str(), record))
                        .collect();
                    for old_record in &old_coverage.unresolved_events {
                        match revised_by_event.get(old_record.event_id.as_str()) {
                            None => {
                                return Err(error(format!(
                                    "genesis refinement removed existing meaning.semantic_coverage.unresolved_events record {}; additions only",
                                    old_record.event_id
                                )))
                            }
                            Some(new_record) if *new_record != old_record => {
                                return Err(error(format!(
                                    "genesis refinement changed existing meaning.semantic_coverage.unresolved_events record {}; additions only",
                                    old_record.event_id
                                )))
                            }
                            Some(_) => {}
                        }
                    }
                    preserved_records.insert(
                        "meaning.semantic_coverage.unresolved_events".to_owned(),
                        old_coverage.unresolved_events.len(),
                    );
                    added_records.insert(
                        "meaning.semantic_coverage.unresolved_events".to_owned(),
                        new_coverage
                            .unresolved_events
                            .len()
                            .saturating_sub(old_coverage.unresolved_events.len()),
                    );
                }
                (None, Some(new_coverage)) => {
                    preserved_records
                        .insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
                    added_records.insert(
                        "meaning.semantic_coverage.unresolved_events".to_owned(),
                        new_coverage.unresolved_events.len(),
                    );
                }
                (None, None) => {
                    preserved_records
                        .insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
                    added_records
                        .insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
                }
            }
            preserve_collection!("meaning.concepts", &old.concepts, &new.concepts);
            preserve_collection!(
                "meaning.abstract_relations",
                &old.abstract_relations,
                &new.abstract_relations
            );
            preserve_collection!(
                "meaning.abstract_cuts",
                &old.abstract_cuts,
                &new.abstract_cuts
            );
            preserve_collection!("meaning.referents", &old.referents, &new.referents);
            preserve_collection!(
                "meaning.encapsulation_cuts",
                &old.encapsulation_cuts,
                &new.encapsulation_cuts
            );
            preserve_collection!("meaning.events", &old.events, &new.events);
            preserve_collection!(
                "meaning.event_relations",
                &old.event_relations,
                &new.event_relations
            );
            preserve_collection!(
                "meaning.event_referent_bindings",
                &old.event_referent_bindings,
                &new.event_referent_bindings
            );
            preserve_collection!(
                "meaning.physical_cuts",
                &old.physical_cuts,
                &new.physical_cuts
            );
            preserve_collection!("meaning.realizations", &old.realizations, &new.realizations);
            preserve_collection!("meaning.normalized_cuts", &old.normalized_cuts, &new.normalized_cuts);
            preserve_collection!("meaning.context_roots", &old.context_roots, &new.context_roots, event_id);
            // A partial declaration can expose additional already-validated
            // children and become complete without changing any committed Cut
            // vector or existing projection. Complete contracts stay exact.
            for previous_contract in &old.temporal_cut_recompositions {
                let next_contract = new.temporal_cut_recompositions.iter()
                    .find(|contract| contract.parent_cut_id == previous_contract.parent_cut_id)
                    .ok_or_else(|| error("genesis refinement removed existing meaning.temporal_cut_recompositions record; additions only"))?;
                if previous_contract == next_contract {
                    continue;
                }
                if previous_contract.coverage != TemporalCutCoverage::Partial
                    || previous_contract.provenance != next_contract.provenance
                    || previous_contract.children.iter().any(|child| !next_contract.children.contains(child))
                {
                    return Err(error("genesis refinement changed existing meaning.temporal_cut_recompositions record; only preserved-child partial extensions are allowed"));
                }
            }
            preserved_records.insert("meaning.temporal_cut_recompositions".to_owned(), old.temporal_cut_recompositions.len());
            added_records.insert("meaning.temporal_cut_recompositions".to_owned(), new.temporal_cut_recompositions.len().saturating_sub(old.temporal_cut_recompositions.len()));
            if !old.context_roots.is_empty() {
                let old_events: BTreeSet<&str> = old.events.iter().map(|event| event.id.as_str()).collect();
                let old_roots: BTreeSet<&str> = old.context_roots.iter().map(|root| root.event_id.as_str()).collect();
                for root in &new.context_roots {
                    if old_events.contains(root.event_id.as_str()) && !old_roots.contains(root.event_id.as_str()) {
                        return Err(error(format!(
                            "genesis refinement changes the context of existing event {}; additions only",
                            root.event_id
                        )));
                    }
                }
            }
        }
        (None, Some(new)) => {
            macro_rules! added_meaning_collection {
                ($label:literal, $records:expr) => {{
                    preserved_records.insert($label.to_owned(), 0);
                    added_records.insert($label.to_owned(), $records.len());
                }};
            }
            added_meaning_collection!("meaning.concepts", &new.concepts);
            added_meaning_collection!("meaning.abstract_relations", &new.abstract_relations);
            added_meaning_collection!("meaning.abstract_cuts", &new.abstract_cuts);
            added_meaning_collection!("meaning.referents", &new.referents);
            added_meaning_collection!("meaning.encapsulation_cuts", &new.encapsulation_cuts);
            added_meaning_collection!("meaning.events", &new.events);
            added_meaning_collection!("meaning.event_relations", &new.event_relations);
            added_meaning_collection!(
                "meaning.event_referent_bindings",
                &new.event_referent_bindings
            );
            added_meaning_collection!("meaning.physical_cuts", &new.physical_cuts);
            added_meaning_collection!("meaning.realizations", &new.realizations);
            added_meaning_collection!("meaning.normalized_cuts", &new.normalized_cuts);
            added_meaning_collection!("meaning.context_roots", &new.context_roots);
            added_meaning_collection!("meaning.temporal_cut_recompositions", &new.temporal_cut_recompositions);
            preserved_records.insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
            added_records.insert(
                "meaning.semantic_coverage.unresolved_events".to_owned(),
                new.semantic_coverage
                    .as_ref()
                    .map_or(0, |coverage| coverage.unresolved_events.len()),
            );
        }
        (None, None) => {
            for label in [
                "meaning.concepts",
                "meaning.abstract_relations",
                "meaning.abstract_cuts",
                "meaning.referents",
                "meaning.encapsulation_cuts",
                "meaning.events",
                "meaning.event_relations",
                "meaning.event_referent_bindings",
                "meaning.physical_cuts",
                "meaning.realizations",
                "meaning.normalized_cuts",
                "meaning.context_roots",
                "meaning.temporal_cut_recompositions",
                "meaning.semantic_coverage.unresolved_events",
            ] {
                preserved_records.insert(label.to_owned(), 0);
                added_records.insert(label.to_owned(), 0);
            }
        }
    }

    Ok(GenesisRefinementAudit {
        preserved_records,
        added_records,
    })
}

fn state_parent(path: &Path) -> &Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

const SQLITE_SESSION_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS session_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
    model_hash TEXT PRIMARY KEY,
    definition_json BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS worlds (
    world_id TEXT PRIMARY KEY,
    model_hash TEXT NOT NULL,
    world_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS candidates (
    candidate_hash TEXT PRIMARY KEY,
    model_hash TEXT NOT NULL,
    candidate_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS world_revisions (
    world_revision_hash TEXT PRIMARY KEY,
    revision_json BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS narrative_source_snapshots (
    snapshot_hash TEXT PRIMARY KEY,
    model_hash TEXT NOT NULL,
    snapshot_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES models(model_hash)
);
CREATE TABLE IF NOT EXISTS narrative_revisions (
    graph_hash TEXT PRIMARY KEY,
    operation_sequence INTEGER NOT NULL UNIQUE CHECK(operation_sequence >= 0),
    graph_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK(revision_number >= 0),
    previous_graph_hash TEXT,
    snapshot_hash TEXT NOT NULL,
    revision_json BLOB NOT NULL,
    FOREIGN KEY(previous_graph_hash) REFERENCES narrative_revisions(graph_hash),
    FOREIGN KEY(snapshot_hash) REFERENCES narrative_source_snapshots(snapshot_hash)
);
CREATE INDEX IF NOT EXISTS narrative_revisions_graph_id_revision
    ON narrative_revisions(graph_id, revision_number);
CREATE INDEX IF NOT EXISTS narrative_revisions_previous
    ON narrative_revisions(previous_graph_hash);
CREATE TABLE IF NOT EXISTS project_documents (
    document_hash TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    content BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS project_model_snapshots (
    model_hash TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    definition_json BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS project_model_snapshots_domain_id
    ON project_model_snapshots(model_id);
CREATE TABLE IF NOT EXISTS project_world_snapshots (
    world_hash TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    world_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES project_model_snapshots(model_hash)
);
CREATE INDEX IF NOT EXISTS project_world_snapshots_domain_id
    ON project_world_snapshots(world_id);
CREATE TABLE IF NOT EXISTS project_graph_snapshots (
    narrative_graph_snapshot_hash TEXT PRIMARY KEY,
    graph_hash TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    source_snapshot_hash TEXT NOT NULL,
    graph_json BLOB NOT NULL,
    FOREIGN KEY(model_hash) REFERENCES project_model_snapshots(model_hash)
);
CREATE INDEX IF NOT EXISTS project_graph_snapshots_graph_hash
    ON project_graph_snapshots(graph_hash);
CREATE TABLE IF NOT EXISTS project_checkpoints (
    checkpoint_hash TEXT PRIMARY KEY,
    checkpoint_name TEXT NOT NULL UNIQUE,
    checkpoint_sequence INTEGER NOT NULL UNIQUE CHECK(checkpoint_sequence >= 0),
    parent_checkpoint_hash TEXT,
    document_hash TEXT NOT NULL,
    model_hash TEXT,
    world_hash TEXT,
    graph_hash TEXT,
    narrative_graph_snapshot_hash TEXT,
    checkpoint_json BLOB NOT NULL,
    FOREIGN KEY(parent_checkpoint_hash) REFERENCES project_checkpoints(checkpoint_hash),
    FOREIGN KEY(document_hash) REFERENCES project_documents(document_hash),
    FOREIGN KEY(model_hash) REFERENCES project_model_snapshots(model_hash),
    FOREIGN KEY(world_hash) REFERENCES project_world_snapshots(world_hash),
    FOREIGN KEY(narrative_graph_snapshot_hash)
        REFERENCES project_graph_snapshots(narrative_graph_snapshot_hash)
);
CREATE INDEX IF NOT EXISTS project_checkpoints_parent
    ON project_checkpoints(parent_checkpoint_hash);
"#;

fn sqlite_error(context: &str, cause: impl std::fmt::Display) -> super::EngineError {
    error(format!("{context}: {cause}"))
}

fn configure_sqlite(connection: &Connection) -> EngineResult<()> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;\
             PRAGMA journal_mode = WAL;\
             PRAGMA synchronous = FULL;\
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|cause| sqlite_error("failed to configure SQLite session", cause))?;
    let foreign_keys: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to verify SQLite foreign keys", cause))?;
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to verify SQLite journal mode", cause))?;
    let synchronous: i64 = connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to verify SQLite synchronous mode", cause))?;
    if foreign_keys != 1 || !journal_mode.eq_ignore_ascii_case("wal") || synchronous != 2 {
        return Err(error(format!(
            "SQLite safety configuration was not applied (foreign_keys={foreign_keys}, journal_mode={journal_mode}, synchronous={synchronous})"
        )));
    }
    Ok(())
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn harden_sqlite_permissions(path: &Path) -> EngineResult<()> {
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|cause| {
            error(format!(
                "failed to set owner-only permissions on SQLite state file {}: {cause}",
                path.display()
            ))
        })?;
        for suffix in ["-wal", "-shm"] {
            let sidecar = sqlite_sidecar_path(path, suffix);
            if sidecar.exists() {
                fs::set_permissions(&sidecar, fs::Permissions::from_mode(0o600)).map_err(
                    |cause| {
                        error(format!(
                            "failed to set owner-only permissions on SQLite sidecar {}: {cause}",
                            sidecar.display()
                        ))
                    },
                )?;
            }
        }
    }
    Ok(())
}

fn encode_sqlite_json(value: &impl Serialize) -> EngineResult<Vec<u8>> {
    serde_json::to_vec(value)
        .map_err(|cause| error(format!("failed to encode SQLite session row: {cause}")))
}

fn decode_sqlite_json<T: for<'de> Deserialize<'de>>(
    bytes: Vec<u8>,
    label: &str,
) -> EngineResult<T> {
    serde_json::from_slice(&bytes)
        .map_err(|cause| error(format!("failed to decode SQLite {label} row: {cause}")))
}

fn sqlite_count_and_bytes(
    connection: &Connection,
    sql: &str,
    label: &str,
) -> EngineResult<(usize, usize)> {
    let (count, bytes): (i64, i64) = connection
        .query_row(sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|cause| sqlite_error(&format!("failed to preflight SQLite {label}"), cause))?;
    let count =
        usize::try_from(count).map_err(|_| error(format!("SQLite {label} count is invalid")))?;
    let bytes = usize::try_from(bytes)
        .map_err(|_| error(format!("SQLite {label} byte count is invalid")))?;
    Ok((count, bytes))
}

fn sqlite_table_exists(connection: &Connection, table: &str) -> EngineResult<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(|cause| sqlite_error("failed to inspect SQLite table availability", cause))
}

fn preflight_sqlite_limits(connection: &Connection) -> EngineResult<()> {
    let (model_count, model_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(definition_json)), 0) FROM models",
        "models",
    )?;
    let (world_count, world_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(world_json)), 0) FROM worlds",
        "worlds",
    )?;
    let (candidate_count, candidate_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(candidate_json)), 0) FROM candidates",
        "candidates",
    )?;
    let (world_revision_count, world_revision_bytes) = if sqlite_table_exists(connection, "world_revisions")? {
        sqlite_count_and_bytes(connection,
            "SELECT count(*), coalesce(sum(length(revision_json)), 0) FROM world_revisions",
            "world revisions")?
    } else { (0, 0) };
    let (snapshot_count, snapshot_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(snapshot_json)), 0) FROM narrative_source_snapshots",
        "narrative source snapshots",
    )?;
    let (revision_count, revision_bytes) = sqlite_count_and_bytes(
        connection,
        "SELECT count(*), coalesce(sum(length(revision_json)), 0) FROM narrative_revisions",
        "narrative revisions",
    )?;
    let narrative_bytes = snapshot_bytes
        .checked_add(revision_bytes)
        .ok_or_else(|| error("SQLite narrative byte count overflow"))?;
    let project_bytes = if sqlite_table_exists(connection, "project_checkpoints")? {
        let (document_count, document_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(content)), 0) FROM project_documents",
            "project documents",
        )?;
        let (model_snapshot_count, model_snapshot_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(definition_json)), 0) FROM project_model_snapshots",
            "project model snapshots",
        )?;
        let (world_snapshot_count, world_snapshot_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(world_json)), 0) FROM project_world_snapshots",
            "project world snapshots",
        )?;
        let (graph_snapshot_count, graph_snapshot_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(graph_json)), 0) FROM project_graph_snapshots",
            "project graph snapshots",
        )?;
        let (checkpoint_count, checkpoint_bytes) = sqlite_count_and_bytes(
            connection,
            "SELECT count(*), coalesce(sum(length(checkpoint_json)), 0) FROM project_checkpoints",
            "project checkpoints",
        )?;
        if document_count > MAX_PROJECT_CHECKPOINTS
            || model_snapshot_count > MAX_PROJECT_CHECKPOINTS
            || world_snapshot_count > MAX_PROJECT_CHECKPOINTS
            || graph_snapshot_count > MAX_PROJECT_CHECKPOINTS
            || checkpoint_count > MAX_PROJECT_CHECKPOINTS
        {
            return Err(error("SQLite project checkpoint count exceeds its limit"));
        }
        document_bytes
            .checked_add(model_snapshot_bytes)
            .and_then(|bytes| bytes.checked_add(world_snapshot_bytes))
            .and_then(|bytes| bytes.checked_add(graph_snapshot_bytes))
            .and_then(|bytes| bytes.checked_add(checkpoint_bytes))
            .ok_or_else(|| error("SQLite project checkpoint byte count overflow"))?
    } else {
        0
    };
    if model_count > MAX_SESSION_MODELS
        || model_bytes > MAX_SESSION_MODEL_BYTES
        || world_count > MAX_SESSION_WORLDS
        || world_bytes > MAX_SESSION_WORLD_BYTES
        || candidate_count > MAX_SESSION_CANDIDATES
        || candidate_bytes > MAX_SESSION_CANDIDATE_BYTES
        || world_revision_count > MAX_SESSION_WORLD_REVISIONS
        || world_revision_bytes > MAX_SESSION_WORLD_REVISION_BYTES
        || snapshot_count > MAX_SESSION_NARRATIVE_GRAPHS
        || revision_count > MAX_SESSION_NARRATIVE_GRAPHS
        || narrative_bytes > MAX_SESSION_NARRATIVE_BYTES
        || project_bytes > MAX_PROJECT_STORAGE_BYTES
    {
        return Err(error("SQLite state file exceeds a session storage limit"));
    }
    Ok(())
}

fn initialize_sqlite_schema(transaction: &Transaction<'_>) -> EngineResult<()> {
    transaction
        .execute_batch(SQLITE_SESSION_SCHEMA)
        .map_err(|cause| sqlite_error("failed to initialize SQLite session schema", cause))?;
    let existing: Option<String> = transaction
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to inspect SQLite session schema", cause))?;
    let generation: Option<String> = transaction
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to inspect SQLite session generation", cause))?;
    match (existing, generation) {
        (Some(schema), _) if schema != SESSION_STATE_SCHEMA => Err(error(format!(
            "unsupported session state schema {schema}; expected {SESSION_STATE_SCHEMA}"
        ))),
        (Some(_), Some(generation)) => {
            generation
                .parse::<u64>()
                .map_err(|cause| error(format!("invalid SQLite session generation: {cause}")))?;
            Ok(())
        }
        (Some(_), None) | (None, Some(_)) => {
            Err(error("SQLite session metadata is partially initialized"))
        }
        (None, None) => {
            transaction
                .execute(
                    "INSERT INTO session_metadata(key, value) VALUES ('session_schema', ?1)",
                    [SESSION_STATE_SCHEMA],
                )
                .map_err(|cause| sqlite_error("failed to record SQLite session schema", cause))?;
            transaction
                .execute(
                    "INSERT INTO session_metadata(key, value) VALUES ('generation', '0')",
                    [],
                )
                .map_err(|cause| {
                    sqlite_error("failed to initialize SQLite session generation", cause)
                })?;
            Ok(())
        }
    }
}

fn persist_model_row(transaction: &Transaction<'_>, model: &CompiledModel) -> EngineResult<()> {
    let json = encode_sqlite_json(&model.definition)?;
    transaction
        .execute(
            "INSERT INTO models(model_hash, definition_json) VALUES (?1, ?2)\
             ON CONFLICT(model_hash) DO UPDATE SET definition_json = excluded.definition_json",
            params![model.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist model row", cause))?;
    Ok(())
}

fn persist_world_row(transaction: &Transaction<'_>, world: &WorldHead) -> EngineResult<()> {
    let json = encode_sqlite_json(world)?;
    transaction
        .execute(
            "INSERT INTO worlds(world_id, model_hash, world_json) VALUES (?1, ?2, ?3)\
             ON CONFLICT(world_id) DO UPDATE SET model_hash = excluded.model_hash, world_json = excluded.world_json",
            params![world.world_id, world.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist world row", cause))?;
    Ok(())
}

fn persist_candidate_row(
    transaction: &Transaction<'_>,
    candidate: &StoredCandidate,
) -> EngineResult<()> {
    let hash = &candidate.record.candidate.candidate_hash;
    let model_hash = &candidate.record.candidate.model_hash;
    let json = encode_sqlite_json(candidate)?;
    transaction
        .execute(
            "INSERT INTO candidates(candidate_hash, model_hash, candidate_json) VALUES (?1, ?2, ?3)\
             ON CONFLICT(candidate_hash) DO UPDATE SET model_hash = excluded.model_hash, candidate_json = excluded.candidate_json",
            params![hash, model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist candidate row", cause))?;
    Ok(())
}

fn persist_narrative_snapshot_row(
    transaction: &Transaction<'_>,
    snapshot_hash: &str,
    snapshot: &NarrativeSourceSnapshot,
) -> EngineResult<()> {
    let stored = StoredNarrativeSourceSnapshot {
        snapshot_hash: snapshot_hash.to_owned(),
        snapshot: snapshot.clone(),
    };
    let json = encode_sqlite_json(&stored)?;
    transaction
        .execute(
            "INSERT INTO narrative_source_snapshots(snapshot_hash, model_hash, snapshot_json)\
             VALUES (?1, ?2, ?3)",
            params![snapshot_hash, snapshot.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist narrative source snapshot", cause))?;
    Ok(())
}

fn persist_narrative_revision_row(
    transaction: &Transaction<'_>,
    revision: &StoredNarrativeRevision,
) -> EngineResult<()> {
    let operation_sequence = i64::try_from(revision.operation_sequence)
        .map_err(|_| error("narrative operation sequence exceeds SQLite integer range"))?;
    let revision_number = i64::try_from(revision.revision.number)
        .map_err(|_| error("narrative revision number exceeds SQLite integer range"))?;
    let json = encode_sqlite_json(revision)?;
    transaction
        .execute(
            "INSERT INTO narrative_revisions(\
                 graph_hash, operation_sequence, graph_id, revision_number,\
                 previous_graph_hash, snapshot_hash, revision_json\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                revision.graph_hash,
                operation_sequence,
                revision.graph_id,
                revision_number,
                revision.revision.previous_graph_hash,
                revision.snapshot_hash,
                json
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist narrative revision", cause))?;
    Ok(())
}

fn persist_project_document_row(
    transaction: &Transaction<'_>,
    document: &StoredProjectDocument,
) -> EngineResult<()> {
    transaction
        .execute(
            "INSERT INTO project_documents(document_hash, media_type, content)\
             VALUES (?1, ?2, ?3)",
            params![
                document.document_hash,
                document.media_type,
                document.content
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist project document", cause))?;
    Ok(())
}

fn persist_project_model_snapshot_row(
    transaction: &Transaction<'_>,
    model_hash: &str,
    definition: &ModelDefinition,
) -> EngineResult<()> {
    let json = encode_sqlite_json(definition)?;
    transaction
        .execute(
            "INSERT INTO project_model_snapshots(model_hash, model_id, definition_json)\
             VALUES (?1, ?2, ?3)",
            params![model_hash, definition.id, json],
        )
        .map_err(|cause| sqlite_error("failed to persist project model snapshot", cause))?;
    Ok(())
}

fn persist_project_world_snapshot_row(
    transaction: &Transaction<'_>,
    world: &WorldHead,
) -> EngineResult<()> {
    let json = encode_sqlite_json(world)?;
    transaction
        .execute(
            "INSERT INTO project_world_snapshots(world_hash, world_id, model_hash, world_json)\
             VALUES (?1, ?2, ?3, ?4)",
            params![world.world_hash, world.world_id, world.model_hash, json],
        )
        .map_err(|cause| sqlite_error("failed to persist project world snapshot", cause))?;
    Ok(())
}

fn persist_project_graph_snapshot_row(
    transaction: &Transaction<'_>,
    narrative_graph_snapshot_hash: &str,
    graph: &StoredNarrativeGraph,
) -> EngineResult<()> {
    let json = encode_sqlite_json(graph)?;
    transaction
        .execute(
            "INSERT INTO project_graph_snapshots(narrative_graph_snapshot_hash, graph_hash, model_hash, source_snapshot_hash, graph_json)\
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                narrative_graph_snapshot_hash,
                graph.graph_hash,
                graph.snapshot.model_hash,
                graph.snapshot_hash,
                json
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist project graph snapshot", cause))?;
    Ok(())
}

fn persist_project_checkpoint_row(
    transaction: &Transaction<'_>,
    checkpoint: &StoredProjectCheckpoint,
) -> EngineResult<()> {
    let sequence = i64::try_from(checkpoint.checkpoint_sequence)
        .map_err(|_| error("project checkpoint sequence exceeds SQLite integer range"))?;
    let json = encode_sqlite_json(checkpoint)?;
    transaction
        .execute(
            "INSERT INTO project_checkpoints(\
                checkpoint_hash, checkpoint_name, checkpoint_sequence, parent_checkpoint_hash,\
                document_hash, model_hash, world_hash, graph_hash, narrative_graph_snapshot_hash, checkpoint_json\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                checkpoint.checkpoint_hash,
                checkpoint.core.name,
                sequence,
                checkpoint.core.parent_checkpoint_hash,
                checkpoint.core.document_hash,
                checkpoint.core.model_hash,
                checkpoint.core.world_hash,
                checkpoint.core.narrative_graph_hash,
                checkpoint.core.narrative_graph_snapshot_hash,
                json
            ],
        )
        .map_err(|cause| sqlite_error("failed to persist project checkpoint", cause))?;
    Ok(())
}

fn persist_sqlite_changes(path: &Path, after: &MachineSession) -> Result<u64, PersistenceFailure> {
    let parent = state_parent(path);
    if !parent.is_dir() {
        return Err(PersistenceFailure {
            cause: error(format!(
                "state file parent directory {} does not exist",
                parent.display()
            )),
            state_file_replaced: false,
        });
    }
    let existed_before = path.exists();
    let mut commit_attempted = false;
    let mut committed_generation = None;
    let write_result = (|| -> EngineResult<()> {
        let mut connection = Connection::open(path).map_err(|cause| {
            sqlite_error(
                &format!("failed to open SQLite state file {}", path.display()),
                cause,
            )
        })?;
        harden_sqlite_permissions(path)?;
        configure_sqlite(&connection)?;
        let transaction = connection
            .transaction()
            .map_err(|cause| sqlite_error("failed to begin SQLite session transaction", cause))?;
        initialize_sqlite_schema(&transaction)?;

        let next_generation = after
            .persistence_generation
            .checked_add(1)
            .ok_or_else(|| error("SQLite session generation overflow"))?;
        let updated = transaction
            .execute(
                "UPDATE session_metadata SET value = ?1\
                 WHERE key = 'generation' AND value = ?2",
                params![
                    next_generation.to_string(),
                    after.persistence_generation.to_string()
                ],
            )
            .map_err(|cause| {
                sqlite_error("failed to compare-and-swap session generation", cause)
            })?;
        if updated != 1 {
            return Err(error(
                "SQLite session changed since it was opened; reopen before writing",
            ));
        }

        for hash in &after.dirty.models {
            let model = after
                .models
                .get(hash)
                .ok_or_else(|| error("dirty model key is unavailable"))?;
            persist_model_row(&transaction, model)?;
        }
        for id in &after.dirty.worlds {
            let world = after
                .worlds
                .get(id)
                .ok_or_else(|| error("dirty world key is unavailable"))?;
            persist_world_row(&transaction, world)?;
        }
        for hash in &after.dirty.world_revisions {
            let revision = after.world_revisions.get(hash).ok_or_else(|| error("dirty world revision key is unavailable"))?;
            transaction.execute(
                "INSERT INTO world_revisions(world_revision_hash, revision_json) VALUES (?1, ?2)",
                params![hash, encode_sqlite_json(revision)?],
            ).map_err(|cause| sqlite_error("failed to persist world revision", cause))?;
        }
        for hash in &after.dirty.candidates {
            let candidate = after
                .candidates
                .get(hash)
                .ok_or_else(|| error("dirty candidate key is unavailable"))?;
            persist_candidate_row(&transaction, candidate)?;
        }
        for hash in &after.dirty.narrative_source_snapshots {
            let snapshot = after
                .narrative_source_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty narrative snapshot key is unavailable"))?;
            persist_narrative_snapshot_row(&transaction, hash, snapshot)?;
        }
        let mut new_revisions: Vec<&StoredNarrativeRevision> = after
            .dirty
            .narrative_revisions
            .iter()
            .map(|hash| {
                after
                    .narrative_revisions
                    .get(hash)
                    .ok_or_else(|| error("dirty narrative revision key is unavailable"))
            })
            .collect::<EngineResult<Vec<_>>>()?;
        new_revisions.sort_by_key(|revision| revision.operation_sequence);
        for revision in new_revisions {
            persist_narrative_revision_row(&transaction, revision)?;
        }
        for hash in &after.dirty.project_documents {
            let document = after
                .project_documents
                .get(hash)
                .ok_or_else(|| error("dirty project document is unavailable"))?;
            persist_project_document_row(&transaction, document)?;
        }
        for hash in &after.dirty.project_model_snapshots {
            let model = after
                .project_model_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty project model snapshot is unavailable"))?;
            persist_project_model_snapshot_row(&transaction, hash, &model.definition)?;
        }
        for hash in &after.dirty.project_world_snapshots {
            let world = after
                .project_world_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty project world snapshot is unavailable"))?;
            persist_project_world_snapshot_row(&transaction, world)?;
        }
        for hash in &after.dirty.project_graph_snapshots {
            let graph = after
                .project_graph_snapshots
                .get(hash)
                .ok_or_else(|| error("dirty project graph snapshot is unavailable"))?;
            persist_project_graph_snapshot_row(&transaction, hash, graph)?;
        }
        let mut checkpoints: Vec<&StoredProjectCheckpoint> = after
            .dirty
            .project_checkpoints
            .iter()
            .map(|hash| {
                after
                    .project_checkpoints
                    .get(hash)
                    .ok_or_else(|| error("dirty project checkpoint is unavailable"))
            })
            .collect::<EngineResult<Vec<_>>>()?;
        checkpoints.sort_by_key(|checkpoint| checkpoint.checkpoint_sequence);
        for checkpoint in checkpoints {
            persist_project_checkpoint_row(&transaction, checkpoint)?;
        }
        commit_attempted = true;
        transaction
            .commit()
            .map_err(|cause| sqlite_error("failed to commit SQLite session transaction", cause))?;
        committed_generation = Some(next_generation);
        harden_sqlite_permissions(path)?;
        Ok(())
    })();
    if write_result.is_err() && !existed_before && !commit_attempted {
        let _ = fs::remove_file(path);
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(sqlite_sidecar_path(path, suffix));
        }
    }
    write_result
        .map(|()| committed_generation.expect("successful commit records a generation"))
        .map_err(|cause| PersistenceFailure {
            cause,
            // A failed SQLite COMMIT can be ambiguous at the filesystem boundary.
            // Preserve the in-memory state and report the existing uncertainty code.
            state_file_replaced: commit_attempted,
        })
}

fn load_sqlite_session(path: &Path) -> EngineResult<PersistedSession> {
    let identity =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|cause| {
            sqlite_error(
                &format!("failed to inspect SQLite state file {}", path.display()),
                cause,
            )
        })?;
    let identity_schema: Option<String> = identity
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to inspect SQLite session identity", cause))?;
    match identity_schema {
        Some(schema) if schema == SESSION_STATE_SCHEMA => {}
        Some(schema) => {
            return Err(error(format!(
                "unsupported session state schema {schema}; expected {SESSION_STATE_SCHEMA}"
            )))
        }
        None => return Err(error("SQLite state file lacks a session schema")),
    }
    drop(identity);
    let connection = Connection::open(path).map_err(|cause| {
        sqlite_error(
            &format!("failed to open SQLite state file {}", path.display()),
            cause,
        )
    })?;
    harden_sqlite_permissions(path)?;
    configure_sqlite(&connection)?;
    let schema: Option<String> = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to read SQLite session schema", cause))?;
    let schema = schema.ok_or_else(|| error("SQLite state file lacks a session schema"))?;
    if schema != SESSION_STATE_SCHEMA {
        return Err(error(format!(
            "unsupported session state schema {schema}; expected {SESSION_STATE_SCHEMA}"
        )));
    }
    let generation_text: String = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .map_err(|cause| sqlite_error("failed to read SQLite session generation", cause))?;
    let persistence_generation = generation_text
        .parse::<u64>()
        .map_err(|cause| error(format!("invalid SQLite session generation: {cause}")))?;
    let quick_check: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|cause| sqlite_error("failed to check SQLite session integrity", cause))?;
    if quick_check != "ok" {
        return Err(error(format!(
            "SQLite session integrity check failed: {quick_check}"
        )));
    }
    let foreign_key_failure: Option<String> = connection
        .query_row(
            "SELECT printf('%s:%s', \"table\", rowid) FROM pragma_foreign_key_check LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|cause| sqlite_error("failed to check SQLite foreign keys", cause))?;
    if let Some(failure) = foreign_key_failure {
        return Err(error(format!(
            "SQLite session foreign-key check failed at {failure}"
        )));
    }
    preflight_sqlite_limits(&connection)?;

    let mut models = Vec::new();
    {
        let mut statement = connection
            .prepare("SELECT model_hash, definition_json FROM models ORDER BY model_hash")
            .map_err(|cause| sqlite_error("failed to prepare model restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query model rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read model row", cause))?
        {
            let stored_hash: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid model hash column", cause))?;
            let definition: ModelDefinition = decode_sqlite_json(
                row.get(1)
                    .map_err(|cause| sqlite_error("invalid model JSON column", cause))?,
                "model",
            )?;
            if compile_model(definition.clone())?.model_hash != stored_hash {
                return Err(error(
                    "SQLite model row key does not match its content hash",
                ));
            }
            models.push(definition);
        }
    }
    let mut worlds = Vec::new();
    {
        let mut statement = connection
            .prepare("SELECT world_id, model_hash, world_json FROM worlds ORDER BY world_id")
            .map_err(|cause| sqlite_error("failed to prepare world restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query world rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read world row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid world id column", cause))?;
            let model_hash: String = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid world model hash column", cause))?;
            let world: WorldHead = decode_sqlite_json(
                row.get(2)
                    .map_err(|cause| sqlite_error("invalid world JSON column", cause))?,
                "world",
            )?;
            if world.world_id != key || world.model_hash != model_hash {
                return Err(error(
                    "SQLite world row key or model hash does not match its content",
                ));
            }
            worlds.push(world);
        }
    }
    let mut candidates = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT candidate_hash, model_hash, candidate_json FROM candidates ORDER BY candidate_hash",
            )
            .map_err(|cause| sqlite_error("failed to prepare candidate restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query candidate rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read candidate row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid candidate hash column", cause))?;
            let model_hash: String = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid candidate model hash column", cause))?;
            let candidate: StoredCandidate = decode_sqlite_json(
                row.get(2)
                    .map_err(|cause| sqlite_error("invalid candidate JSON column", cause))?,
                "candidate",
            )?;
            if candidate.record.candidate.candidate_hash != key
                || candidate.record.candidate.model_hash != model_hash
            {
                return Err(error(
                    "SQLite candidate row key or model hash does not match its content",
                ));
            }
            candidates.push(candidate);
        }
    }
    let mut world_revisions = Vec::new();
    if sqlite_table_exists(&connection, "world_revisions")? {
        let mut statement = connection.prepare("SELECT world_revision_hash, revision_json FROM world_revisions ORDER BY world_revision_hash")
            .map_err(|cause| sqlite_error("failed to prepare world revision restore", cause))?;
        let mut rows = statement.query([]).map_err(|cause| sqlite_error("failed to query world revisions", cause))?;
        while let Some(row) = rows.next().map_err(|cause| sqlite_error("failed to read world revision", cause))? {
            let hash: String = row.get(0).map_err(|cause| sqlite_error("invalid world revision hash", cause))?;
            let revision: WorldRevision = decode_sqlite_json(row.get(1).map_err(|cause| sqlite_error("invalid world revision JSON", cause))?, "world revision")?;
            if hash != revision.world_revision_hash {
                return Err(error("SQLite world revision key does not match its content"));
            }
            world_revisions.push(revision);
        }
    }
    let mut narrative_source_snapshots = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT snapshot_hash, model_hash, snapshot_json FROM narrative_source_snapshots ORDER BY snapshot_hash",
            )
            .map_err(|cause| sqlite_error("failed to prepare narrative snapshot restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query narrative snapshot rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read narrative snapshot row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid narrative snapshot hash column", cause))?;
            let model_hash: String = row.get(1).map_err(|cause| {
                sqlite_error("invalid narrative snapshot model hash column", cause)
            })?;
            let stored: StoredNarrativeSourceSnapshot = decode_sqlite_json(
                row.get(2).map_err(|cause| {
                    sqlite_error("invalid narrative snapshot JSON column", cause)
                })?,
                "narrative snapshot",
            )?;
            if stored.snapshot_hash != key || stored.snapshot.model_hash != model_hash {
                return Err(error(
                    "SQLite narrative snapshot row key or model hash does not match its content",
                ));
            }
            narrative_source_snapshots.push(stored);
        }
    }
    let mut narrative_revisions = Vec::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT graph_hash, operation_sequence, graph_id, revision_number, previous_graph_hash, snapshot_hash, revision_json FROM narrative_revisions ORDER BY operation_sequence",
            )
            .map_err(|cause| sqlite_error("failed to prepare narrative revision restore", cause))?;
        let mut rows = statement
            .query([])
            .map_err(|cause| sqlite_error("failed to query narrative revision rows", cause))?;
        while let Some(row) = rows
            .next()
            .map_err(|cause| sqlite_error("failed to read narrative revision row", cause))?
        {
            let key: String = row
                .get(0)
                .map_err(|cause| sqlite_error("invalid narrative graph hash column", cause))?;
            let sequence: i64 = row
                .get(1)
                .map_err(|cause| sqlite_error("invalid narrative operation sequence", cause))?;
            let graph_id: String = row
                .get(2)
                .map_err(|cause| sqlite_error("invalid narrative graph id column", cause))?;
            let revision_number: i64 = row
                .get(3)
                .map_err(|cause| sqlite_error("invalid narrative revision number", cause))?;
            let previous_graph_hash: Option<String> = row
                .get(4)
                .map_err(|cause| sqlite_error("invalid previous narrative graph hash", cause))?;
            let snapshot_hash: String = row
                .get(5)
                .map_err(|cause| sqlite_error("invalid narrative snapshot hash", cause))?;
            let stored: StoredNarrativeRevision = decode_sqlite_json(
                row.get(6).map_err(|cause| {
                    sqlite_error("invalid narrative revision JSON column", cause)
                })?,
                "narrative revision",
            )?;
            if stored.graph_hash != key
                || i64::try_from(stored.operation_sequence).ok() != Some(sequence)
                || stored.graph_id != graph_id
                || i64::try_from(stored.revision.number).ok() != Some(revision_number)
                || stored.revision.previous_graph_hash != previous_graph_hash
                || stored.snapshot_hash != snapshot_hash
            {
                return Err(error(
                    "SQLite narrative revision columns do not match their content",
                ));
            }
            narrative_revisions.push(stored);
        }
    }
    let mut project_documents = Vec::new();
    let mut project_model_snapshots = Vec::new();
    let mut project_world_snapshots = Vec::new();
    let mut project_graph_snapshots = Vec::new();
    let mut project_checkpoints = Vec::new();
    if sqlite_table_exists(&connection, "project_checkpoints")? {
        {
            let mut statement = connection
                .prepare("SELECT document_hash, media_type, content FROM project_documents ORDER BY document_hash")
                .map_err(|cause| sqlite_error("failed to prepare project document restore", cause))?;
            let rows = statement
                .query_map([], |row| {
                    Ok(StoredProjectDocument {
                        document_hash: row.get(0)?,
                        media_type: row.get(1)?,
                        content: row.get(2)?,
                    })
                })
                .map_err(|cause| sqlite_error("failed to query project documents", cause))?;
            for row in rows {
                project_documents.push(
                    row.map_err(|cause| sqlite_error("failed to read project document", cause))?,
                );
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT model_hash, model_id, definition_json FROM project_model_snapshots ORDER BY model_hash")
                .map_err(|cause| sqlite_error("failed to prepare project model restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project models", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project model", cause))?
            {
                let hash: String = row
                    .get(0)
                    .map_err(|cause| sqlite_error("invalid project model hash", cause))?;
                let id: String = row
                    .get(1)
                    .map_err(|cause| sqlite_error("invalid project model id", cause))?;
                let definition: ModelDefinition = decode_sqlite_json(
                    row.get(2)
                        .map_err(|cause| sqlite_error("invalid project model JSON", cause))?,
                    "project model",
                )?;
                let compiled = compile_model(definition.clone())?;
                if compiled.model_hash != hash || compiled.id != id {
                    return Err(error("SQLite project model columns do not match content"));
                }
                project_model_snapshots.push(definition);
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT world_hash, world_id, model_hash, world_json FROM project_world_snapshots ORDER BY world_hash")
                .map_err(|cause| sqlite_error("failed to prepare project world restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project worlds", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project world", cause))?
            {
                let hash: String = row
                    .get(0)
                    .map_err(|cause| sqlite_error("invalid project world hash", cause))?;
                let id: String = row
                    .get(1)
                    .map_err(|cause| sqlite_error("invalid project world id", cause))?;
                let model_hash: String = row
                    .get(2)
                    .map_err(|cause| sqlite_error("invalid project world model hash", cause))?;
                let world: WorldHead = decode_sqlite_json(
                    row.get(3)
                        .map_err(|cause| sqlite_error("invalid project world JSON", cause))?,
                    "project world",
                )?;
                if world.world_hash != hash
                    || world.world_id != id
                    || world.model_hash != model_hash
                {
                    return Err(error("SQLite project world columns do not match content"));
                }
                project_world_snapshots.push(world);
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT narrative_graph_snapshot_hash, graph_hash, model_hash, source_snapshot_hash, graph_json FROM project_graph_snapshots ORDER BY narrative_graph_snapshot_hash")
                .map_err(|cause| sqlite_error("failed to prepare project graph restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project graphs", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project graph", cause))?
            {
                let project_snapshot_hash: String = row.get(0).map_err(|cause| {
                    sqlite_error("invalid project graph snapshot identity", cause)
                })?;
                let graph_hash: String = row
                    .get(1)
                    .map_err(|cause| sqlite_error("invalid project graph hash", cause))?;
                let model_hash: String = row
                    .get(2)
                    .map_err(|cause| sqlite_error("invalid project graph model hash", cause))?;
                let snapshot_hash: String = row
                    .get(3)
                    .map_err(|cause| sqlite_error("invalid project graph snapshot hash", cause))?;
                let graph: StoredNarrativeGraph = decode_sqlite_json(
                    row.get(4)
                        .map_err(|cause| sqlite_error("invalid project graph JSON", cause))?,
                    "project graph",
                )?;
                if graph.graph_hash != graph_hash
                    || graph.snapshot.model_hash != model_hash
                    || graph.snapshot_hash != snapshot_hash
                    || project_graph_snapshot_hash(&graph)? != project_snapshot_hash
                {
                    return Err(error("SQLite project graph columns do not match content"));
                }
                project_graph_snapshots.push(graph);
            }
        }
        {
            let mut statement = connection
                .prepare("SELECT checkpoint_hash, checkpoint_name, checkpoint_sequence, parent_checkpoint_hash, document_hash, model_hash, world_hash, graph_hash, narrative_graph_snapshot_hash, checkpoint_json FROM project_checkpoints ORDER BY checkpoint_sequence")
                .map_err(|cause| sqlite_error("failed to prepare project checkpoint restore", cause))?;
            let mut rows = statement
                .query([])
                .map_err(|cause| sqlite_error("failed to query project checkpoints", cause))?;
            while let Some(row) = rows
                .next()
                .map_err(|cause| sqlite_error("failed to read project checkpoint", cause))?
            {
                let checkpoint: StoredProjectCheckpoint = decode_sqlite_json(
                    row.get(9)
                        .map_err(|cause| sqlite_error("invalid project checkpoint JSON", cause))?,
                    "project checkpoint",
                )?;
                let sequence: i64 = row
                    .get(2)
                    .map_err(|cause| sqlite_error("invalid project checkpoint sequence", cause))?;
                if checkpoint.checkpoint_hash
                    != row
                        .get::<_, String>(0)
                        .map_err(|cause| sqlite_error("invalid project checkpoint hash", cause))?
                    || checkpoint.core.name
                        != row.get::<_, String>(1).map_err(|cause| {
                            sqlite_error("invalid project checkpoint name", cause)
                        })?
                    || i64::try_from(checkpoint.checkpoint_sequence).ok() != Some(sequence)
                    || checkpoint.core.parent_checkpoint_hash
                        != row.get::<_, Option<String>>(3).map_err(|cause| {
                            sqlite_error("invalid project checkpoint parent", cause)
                        })?
                    || checkpoint.core.document_hash
                        != row.get::<_, String>(4).map_err(|cause| {
                            sqlite_error("invalid project checkpoint document", cause)
                        })?
                    || checkpoint.core.model_hash
                        != row.get::<_, Option<String>>(5).map_err(|cause| {
                            sqlite_error("invalid project checkpoint model", cause)
                        })?
                    || checkpoint.core.world_hash
                        != row.get::<_, Option<String>>(6).map_err(|cause| {
                            sqlite_error("invalid project checkpoint world", cause)
                        })?
                    || checkpoint.core.narrative_graph_hash
                        != row.get::<_, Option<String>>(7).map_err(|cause| {
                            sqlite_error("invalid project checkpoint graph", cause)
                        })?
                    || checkpoint.core.narrative_graph_snapshot_hash
                        != row.get::<_, Option<String>>(8).map_err(|cause| {
                            sqlite_error("invalid project checkpoint graph snapshot", cause)
                        })?
                {
                    return Err(error(
                        "SQLite project checkpoint columns do not match content",
                    ));
                }
                project_checkpoints.push(checkpoint);
            }
        }
    }
    Ok(PersistedSession {
        schema,
        persistence_generation,
        models,
        worlds,
        world_revisions,
        candidates,
        narrative_source_snapshots,
        narrative_revisions,
        project_documents,
        project_model_snapshots,
        project_world_snapshots,
        project_graph_snapshots,
        project_checkpoints,
    })
}

fn is_mutating_operation(operation: &str) -> bool {
    matches!(
        operation,
        "register_model"
            | "revise_model"
            | "create_world"
            | "refine_genesis_world"
            | "revise_world"
            | "roll_world"
            | "reroll_candidate"
            | "reject_candidate"
            | "commit_candidate"
            | "register_narrative_graph"
            | "revise_narrative_graph"
            | "apply_narrative_batch"
            | "register_project_checkpoint"
    )
}

pub fn is_machine_operation(operation: &str) -> bool {
    matches!(
        operation,
        "compile_profiles"
            | "validate_model"
            | "register_model"
            | "revise_model"
            | "get_model"
            | "create_world"
            | "get_world"
            | "refine_genesis_world"
            | "revise_world"
            | "get_world_revision"
            | "query_graph"
            | "query_view"
            | "register_narrative_graph"
            | "revise_narrative_graph"
            | "apply_narrative_batch"
            | "list_narrative_revisions"
            | "query_narrative_graph"
            | "render_narrative_graph"
            | "export_narrative_training"
            | "register_project_checkpoint"
            | "list_project_checkpoints"
            | "get_project_checkpoint"
            | "export_project_checkpoint"
            | "render_project_checkpoint"
            | "query_project_checkpoint_graph"
            | "roll_world"
            | "inspect_candidate"
            | "summarize_trajectory"
            | "reroll_candidate"
            | "reject_candidate"
            | "commit_candidate"
    )
}

pub fn machine_description() -> serde_json::Value {
    let mut description = serde_json::json!({
        "engine": "life-sim-engine",
        "engine_version": env!("CARGO_PKG_VERSION"),
        "authority": {
            "world_heads": "rust_process_memory_or_optional_transactional_sqlite_state_file",
            "candidate_lineage": "rust_process_memory_or_optional_transactional_sqlite_state_file",
            "atomic_commit": true,
            "durable_across_restart": "when --state-file or LIFE_SIM_STATE_FILE is configured",
            "default_filesystem_side_effects": false,
            "multi_process_writers": "serialized_by_SQLite_and_stale_sessions_rejected_by_generation_CAS"
        },
        "schemas": {
            "command": super::COMMAND_SCHEMA,
            "response": super::RESPONSE_SCHEMA,
            "legacy_registry": super::REGISTRY_SCHEMA,
            "model": MODEL_SCHEMA,
            "profile_compilation": PROFILE_COMPILATION_SCHEMA,
            "meaning_model": MEANING_MODEL_SCHEMA,
            "model_query": MODEL_QUERY_SCHEMA,
            "world_head": WORLD_HEAD_SCHEMA,
            "model_candidate": MODEL_CANDIDATE_SCHEMA,
            "random_schedule_fingerprint": RANDOM_SCHEDULE_SCHEMA,
            "graph": MODEL_GRAPH_SCHEMA,
            "view": MODEL_VIEW_SCHEMA,
            "narrative_graph": NARRATIVE_GRAPH_SCHEMA,
            "narrative_graph_view": NARRATIVE_GRAPH_VIEW_SCHEMA,
            "narrative_render": NARRATIVE_RENDER_SCHEMA,
            "narrative_training": NARRATIVE_TRAINING_SCHEMA,
            "narrative_history": NARRATIVE_HISTORY_SCHEMA,
            "session_state": SESSION_STATE_SCHEMA
        },
        "operations": [
            "describe", "compile_registry", "roll",
            "compile_profiles", "validate_model", "register_model", "revise_model", "get_model",
            "create_world", "get_world", "refine_genesis_world", "revise_world", "get_world_revision", "roll_world", "inspect_candidate",
            "summarize_trajectory", "reroll_candidate", "reject_candidate", "commit_candidate",
            "query_graph", "query_view", "register_narrative_graph", "revise_narrative_graph",
            "apply_narrative_batch", "list_narrative_revisions", "query_narrative_graph",
            "render_narrative_graph", "export_narrative_training"
        ],
        "value_kinds": [
            "scalar", "vector", "category", "distribution", "graph",
            "object_pose", "regime"
        ],
        "operator_roles": [
            "evolution", "relation", "occurrence", "epistemic", "resolution"
        ],
        "edge_kinds": {
            "decomposition": [
                "contains", "physical_part", "membership_view", "semantic_subtype",
                "temporal_phase", "functional_refinement", "observational_partition"
            ],
            "dependency": ["derives", "causes", "constrains", "observes"],
            "abstract_relation": [
                "specialization", "constrains", "analogy", "opposition", "other"
            ],
            "event_relation": ["contains", "causes", "enables", "prevents", "constrains", "other"],
            "physical_cut": ["parallel", "sequential"]
        },
        "meaning_model": {
            "opt_in_field": "model.meaning_model",
            "collections": [
                "concepts", "abstract_relations", "abstract_cuts",
                "referents", "encapsulation_cuts", "events",
                "event_relations", "event_referent_bindings", "physical_cuts", "realizations",
                "normalized_cuts", "context_roots", "temporal_cut_recompositions"
            ],
            "normalized_cuts": {
                "remainder_key": NORMALIZED_CUT_REMAINDER_KEY,
                "sum_tolerance": NORMALIZED_CUT_SUM_TOLERANCE,
                "conditioning": "cut_id and stable answer_key within the same immutable model and governing context",
                "scope": "static normalized allocations with optional declared temporal recomposition; no semantic exclusivity proof or forecast calibration"
            },
            "temporal_cut_recompositions": {
                "coverage": ["complete", "partial"],
                "projection": ["identity", "answer_map"],
                "weights": "duration shares derived from disjoint bounded child Event intervals",
                "validation": "same question, unit, conditioning and declared context; complete mixtures reproduce parent; partial mixtures leave feasible nonnegative residual",
                "scope": "explicit structural contract, not automatic semantic decomposition or a rule for overlapping episodes"
            },
            "context_roots": {
                "kinds": ["accepted_world", "inner", "understanding", "document", "candidate"],
                "ancestry": "Contains edges only, acyclic, every path reaches the same nearest declared root; known intervals must be contained",
                "scope": "opt-in static authority validation; no evidence disclosure or story-time cutoff access"
            },
            "realization_purposes": ["define", "describe"],
            "semantic_coverage": {
                "opt_in_field": "model.meaning_model.semantic_coverage",
                "modes": ["report", "strict"],
                "direct": "event is named by a role of a nonzero-degree realization",
                "inherited": "event is the parent or child of a physical cut explicitly named by a nonzero-degree realization; unrelated and nested cuts are not traversed",
                "unresolved": "explicit event id, bounded reason, and provenance; later direct or inherited coverage supersedes the allowance",
                "strict_invariant": "every declared semantic event is direct, inherited, or explicitly unresolved",
                "scope": "compiled static Meaning Model declarations, not accepted runtime event occurrences"
            },
            "referent_semantics": [
                "boundary", "continuity_criterion", "interval",
                "lifecycle_event_id", "uncertainty", "provenance", "authority"
            ],
            "event_referent_binding_targets": ["event", "process"],
            "event_semantics": [
                "boundary", "description", "interval", "process_ids", "observation_process_ids",
                "participants", "substrate", "region"
            ],
            "event_relation_semantics": {
                "kinds": ["contains", "causes", "enables", "prevents", "constrains", "other"],
                "direction": "source_event_id_to_target_event_id",
                "metadata": ["description", "uncertainty", "provenance", "authority"],
                "execution": "validated static causal claim; does not schedule events or create a law"
            },
            "event_context_annotations": "participants, substrate, and region are legacy free-form context; event_referent_bindings is the typed referential authority",
            "execution": "validated static semantic layer; processes and laws remain the physical execution substrate",
            "genesis_refinement": "authored additions may replace only an untouched genesis world through its direct next model revision; every old process, edge, law, initial claim, and Meaning Model record is preserved exactly",
            "genesis_refinement_boundary": "not automatic discovery, adaptive runtime opening, or post-history migration",
            "define_indexing": "define realizations require an abstract cut whose parent is the realized concept",
            "ordering": "abstract, encapsulation, and parallel children are unordered canonical sets; sequential child order is significant"
        },
        "lineage_operations": [
            "roll_world", "inspect_candidate", "reroll_candidate",
            "reject_candidate", "commit_candidate", "revise_world", "get_world_revision"
        ],
        "execution": {
            "scalar_expressions": true,
            "all_values_retained_in_complete_candidates": true,
            "non_scalar_values": "validated_and_carried_but_not_numerically_updated",
            "relation_resolution_order": "validated_acyclic",
            "randomness": "named_keyed_draws_bound_to_candidate",
            "randomness_policies": ["candidate_bound", "common_random_comparison"],
            "common_random_comparison": {
                "query_field": "comparison_stream",
                "opt_in_only": true,
                "default_unchanged_when_absent": true,
                "master_key_inputs": ["seed", "comparison_stream", "schedule_hash", "roll_index"],
                "deliberately_excluded_from_master_key": ["model", "parent", "interventions", "observations", "outputs"],
                "schedule_binding": ["direction", "delta_time", "actual_step_size", "step_count"],
                "observation_timing": "observations already require existing exact step boundaries and therefore do not alter the execution grid",
                "sharing_scope": "only overlapping named draw keys at the same step and draw index",
                "lineage_boundary": "query, dynamics, trajectory, candidate, and world hashes remain bound to each variant's actual inputs and outputs",
                "claim_boundary": "variance-reduction experiment aid only; not branch splicing, counterfactual identity, or causal identification",
                "visibility": "comparison_stream is returned as candidate randomness metadata; do not place secrets in it"
            },
            "intervention_timing": {
                "query_field": "TimedIntervention.application",
                "default_when_absent": "successor_boundary",
                "legacy_successor_boundary": "the effect lands after evolution on the first completed numerical boundary at or after its offset and before exact relation/resolution closure; offset zero therefore lands on the first successor",
                "initial_boundary": "opt-in value applied simultaneously at the frozen parent's time before first-step occurrence and evolution evaluation, followed by always-active exact relation/resolution closure",
                "initial_boundary_offset": 0,
                "parent_sample": "retained step zero remains the unchanged frozen parent; the parent-time intervention mark records the right-hand boundary jump",
                "mark": "initial_boundary interventions are marked at step zero and the frozen parent's time",
                "lineage_binding": "application is omitted from serialization when absent; an explicit value participates in query and dynamics identity, realized samples determine trajectory identity, and candidate/world lineage binds them",
                "projected_query_count": "initial_boundary_intervention_count is emitted only when nonzero; absence means zero"
            },
            "determinism_scope": "exact replay is established for the same pinned engine build and platform; cross-platform transcendental equivalence is not claimed",
            "legacy_scalar_kernel_compatible": true,
            "access_projection": "explicit observable ids; empty ids return no state values",
            "claim_projection": "subject visibility plus independent claim access scopes",
            "scope_security_boundary": "scope strings are projection labels, not authenticated principals",
            "view_identity": "observables, access scopes, path retention, and presently inert resolution/support labels do not alter canonical candidate or world identity",
            "selected_support": "validated metadata only; active-frontier pruning is not implemented",
            "decomposition_edges": "schema-time acyclic structural lenses only; no numeric, causal, or world-time effect",
            "meaning_model": "optional validated static schema with authored event-to-event causal claims and optional declared-event semantic coverage audit/enforcement; no automatic expansion, aggregation, residual, recomposition, discovery, scheduling, or causal execution behavior",
            "genesis_refinement": {
                "implemented": true,
                "operation": "refine_genesis_world",
                "target": "already_registered_direct_next_model_revision",
                "authority": "monotonic authored additions before accepted time begins",
                "requires": ["world version 0", "world time 0", "no lineage", "exact old-record preservation"],
                "not_implemented": ["automatic discovery", "post-history migration", "adaptive execution pruning"]
            },
            "dynamic_membership": "represent as a time-indexed process updated by a relation law, not as a membership_view edge",
            "partial_refinement_reconciliation": "not implemented",
            "revision_additions": "support plus law/dependency or static/observed declaration"
        },
        "persistence": {
            "default": "process_memory_no_filesystem_side_effects",
            "opt_in": ["--state-file PATH", "LIFE_SIM_STATE_FILE=PATH"],
            "backend": "SQLite",
            "commit_protocol": "dirty_rows_in_one_foreign_key_checked_transaction_with_generation_compare_and_swap",
            "journal_mode": "WAL",
            "synchronous": "FULL",
            "unix_permissions": "0600_for_database_and_present_WAL_SHM_sidecars",
            "startup_validation": "SQLite identity, integrity, foreign keys, relational shadow columns, and bounds; model/world/narrative hashes; exact narrative source snapshots; operation sequences; complete lineage; deterministic candidate replay",
            "failure_semantics": "no success response before transaction commit; failures reload authoritative SQLite state; an ambiguous failed COMMIT is reported as persistence_uncertain",
            "writer_model": "generation_compare_and_swap_rejects_stale_session_writers; SQLite serializes transactions",
            "longevity": "bounded append-only narrative deltas and row-addressed mutable world/candidate heads; no destructive pruning operation",
            "narrative_materialization": "cold lookup replays one selected chain and compiles only its final graph; startup validation reuses each parent and retains only the live branch frontier; no durable cache or checkpoint compaction"
        },
        "execution_limits": {
            "max_command_bytes": super::MAX_COMMAND_BYTES,
            "max_step_count": MAX_STEP_COUNT,
            "max_law_process_evaluations": MAX_LAW_PROCESS_EVALUATIONS,
            "max_state_byte_steps": MAX_STATE_BYTE_STEPS,
            "max_retained_state_bytes_estimate": MAX_RETAINED_STATE_BYTES,
            "max_potential_activity_records": MAX_POTENTIAL_ACTIVITY_RECORDS,
            "max_potential_activity_bytes_estimate": MAX_POTENTIAL_ACTIVITY_BYTES,
            "max_expression_depth": MAX_EXPRESSION_DEPTH,
            "max_model_expression_nodes": MAX_MODEL_EXPRESSION_NODES,
            "max_meaning_model_records": MAX_MEANING_MODEL_RECORDS,
            "max_meaning_cut_children": MAX_MEANING_CUT_CHILDREN,
            "max_meaning_event_processes": MAX_MEANING_EVENT_PROCESSES,
            "max_meaning_realization_bindings": MAX_MEANING_REALIZATION_BINDINGS,
            "max_query_duration": MAX_QUERY_DURATION,
            "max_query_interventions": MAX_QUERY_INTERVENTIONS,
            "max_query_support": MAX_QUERY_SUPPORT,
            "max_query_observables": MAX_QUERY_OBSERVABLES,
            "max_query_access_scopes": MAX_QUERY_ACCESS_SCOPES,
            "max_query_string_bytes": MAX_QUERY_STRING_BYTES,
            "max_model_identifier_bytes": MAX_MODEL_IDENTIFIER_BYTES,
            "max_model_definition_bytes": MAX_MODEL_DEFINITION_BYTES,
            "max_session_models": MAX_SESSION_MODELS,
            "max_session_worlds": MAX_SESSION_WORLDS,
            "max_session_candidates": MAX_SESSION_CANDIDATES,
            "max_session_model_bytes": MAX_SESSION_MODEL_BYTES,
            "max_session_world_bytes": MAX_SESSION_WORLD_BYTES,
            "max_session_candidate_bytes": MAX_SESSION_CANDIDATE_BYTES,
            "max_session_replay_work": MAX_SESSION_REPLAY_WORK
        },
        "legacy_execution_limits": {
            "max_steps": super::MAX_STEPS,
            "max_fields": super::MAX_LEGACY_FIELDS,
            "max_couplings": super::MAX_LEGACY_COUPLINGS,
            "max_events": super::MAX_LEGACY_EVENTS,
            "max_event_effects": super::MAX_LEGACY_EVENT_EFFECTS,
            "max_work": super::MAX_LEGACY_WORK,
            "max_retained_bytes": super::MAX_LEGACY_RETAINED_BYTES,
            "max_state_byte_steps": super::MAX_LEGACY_STATE_BYTE_STEPS,
            "max_duration": super::MAX_LEGACY_DURATION
        },
        "path_modes": ["endpoint", "full", "decimated"]
    });
    description["authority"]["narrative_graphs"] =
        serde_json::json!("rust_process_memory_or_optional_transactional_sqlite_state_file");
    description["schemas"]["narrative_batch"] = serde_json::json!(NARRATIVE_BATCH_SCHEMA);
    description["schemas"]["project_document"] = serde_json::json!(PROJECT_DOCUMENT_SCHEMA);
    description["schemas"]["project_checkpoint"] = serde_json::json!(PROJECT_CHECKPOINT_SCHEMA);
    description["schemas"]["project_checkpoint_list"] =
        serde_json::json!(PROJECT_CHECKPOINT_LIST_SCHEMA);
    description["schemas"]["project_checkpoint_render"] =
        serde_json::json!(PROJECT_CHECKPOINT_RENDER_SCHEMA);
    description["schemas"]["project_checkpoint_export"] =
        serde_json::json!(PROJECT_CHECKPOINT_EXPORT_SCHEMA);
    if let Some(operations) = description["operations"].as_array_mut() {
        operations.extend(
            [
                "register_project_checkpoint",
                "list_project_checkpoints",
                "get_project_checkpoint",
                "export_project_checkpoint",
                "render_project_checkpoint",
                "query_project_checkpoint_graph",
            ]
            .into_iter()
            .map(serde_json::Value::from),
        );
    }
    description["persistence"]["startup_validation"] = serde_json::json!(
        "SQLite identity/integrity/foreign keys/relational shadow columns/bounds, model/world/narrative hashes, exact narrative source snapshots, canonical deltas, unique append-only operation sequences, causal evidence cutoffs, complete lineage, and deterministic candidate replay"
    );
    description["execution_limits"]["max_session_narrative_graphs"] =
        serde_json::json!(MAX_SESSION_NARRATIVE_GRAPHS);
    description["schemas"]["world_revision"] = serde_json::json!(WORLD_REVISION_SCHEMA);
    description["execution_limits"]["max_session_world_revisions"] = serde_json::json!(MAX_SESSION_WORLD_REVISIONS);
    description["execution_limits"]["max_session_world_revision_bytes"] = serde_json::json!(MAX_SESSION_WORLD_REVISION_BYTES);
    description["execution"]["world_revision"] = serde_json::json!({
        "implemented": true,
        "operation": "revise_world",
        "modes": ["refine", "revise"],
        "boundary": "explicit direct-next registered model transition at unchanged world time with exact expected-world-hash compare-and-swap",
        "state": "source values and claims persist; new processes require explicit current-time values; revise may explicitly replace existing state values",
        "history": "immutable source and target heads are hash-linked into accepted lineage and validated on database restore",
        "portable_export": "narrative training and portable checkpoint export crossing world revisions is rejected with unsupported_history; complete accepted history remains in the session database"
    });
    description["execution_limits"]["max_session_narrative_bytes"] =
        serde_json::json!(MAX_SESSION_NARRATIVE_BYTES);
    description["execution_limits"]["max_project_checkpoints"] =
        serde_json::json!(MAX_PROJECT_CHECKPOINTS);
    description["execution_limits"]["max_project_document_bytes"] =
        serde_json::json!(MAX_PROJECT_DOCUMENT_BYTES);
    description["execution_limits"]["max_project_storage_bytes"] =
        serde_json::json!(MAX_PROJECT_STORAGE_BYTES);
    description["execution_limits"]["max_project_export_bytes"] =
        serde_json::json!(MAX_PROJECT_EXPORT_BYTES);
    description["persistence"]["project_checkpoints"] = serde_json::json!(
        "immutable content-addressed documents plus frozen model/world/graph snapshots; portable model/world/graph material uses mutually exclusive lossless JSON-string carriers; imported graph sources require exact bounded candidate-lineage replay and frozen anchor validation; active execution heads and legacy narrative operation sequences remain separate"
    );
    description["graph_query"] = serde_json::json!({
        "source": "exactly_one_of_model_hash_world_id_candidate_hash",
        "modes": ["full", "skeleton", "neighborhood"],
        "neighborhood_directions": ["ancestors", "descendants", "both"],
        "snapshot_bound": true,
        "full_graph_directly_available": true,
        "factor_nodes": ["process", "law"],
        "factor_edges": [
            "ast_reads", "direct_writes", "activates",
            "decomposition", "declared_dependency"
        ],
        "candidate_law_occurrences": {
            "source_bound": true,
            "exact_count": true,
            "marks_per_law_limit": MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW,
            "truncation_reported": true
        },
        "values": "optional_and_process_access_scope_guarded",
        "access": "process scopes filter inaccessible process nodes, dependent law payloads, and incident overlays",
        "neighborhood_boundary": "every_incident crossing edge and both endpoints",
        "center": "stable process:<id>/law:<id>, or an unambiguous raw source id"
    });
    description["narrative_understanding_graph"] = serde_json::json!({
        "optional": true,
        "authority": "rust_session",
        "canonical_artifact_units": true,
        "node_roles": [
            "document_root", "story_passage", "character_interior",
            "externalized_reflection", "reader_response", "metadata"
        ],
        "custom_node_types": true,
        "mutation_units": [
            "one_complete_graph_revision_validated_and_stored_as_an_append_only_delta",
            "one_additive_batch_of_one_or_more_roots_nodes_or_edges_validated_and_stored_as_an_append_only_delta"
        ],
        "history": "list_narrative_revisions enumerates every root, revision, branch point, and immutable head in operation-sequence order; any graph hash remains directly queryable/renderable and may receive a new successor",
        "ordering_boundary": "operation_sequence records insertion provenance only; structural edge order, event intervals, and simulated world time remain independent",
        "additive_batch_connectivity": "every_new_node_component_must_bridge_to_an_existing_node_or_stable_anchor; an_initial_component_may_instead_declare_a_root",
        "edge_families": ["structural", "grounding", "semantic", "provenance", "revision"],
        "structural_relations": ["contains", "next"],
        "model_anchor_kinds": [
            "model", "process", "decomposition", "dependency", "law", "claim",
            "concept", "abstract_relation", "abstract_cut", "referent",
            "encapsulation_cut", "event", "event_relation", "event_referent_binding",
            "physical_cut", "realization", "world", "candidate", "occurrence"
        ],
        "anchor_subpaths": "optional_rfc6901_json_pointer_validated_against_the_exact_stable_object",
        "source_binding": "exact_model_world_or_candidate_snapshot",
        "query_modes": ["full", "skeleton", "neighborhood"],
        "projections": ["story_render", "aligned_training_records"],
        "thought_boundary": "externalized_testimony_only_not_hidden_chain_of_thought",
        "privacy_boundary": "access_scopes_are_projection_guards_not_authentication"
    });
    description["schemas"]["trajectory_summary_query"] =
        serde_json::Value::String(TRAJECTORY_SUMMARY_QUERY_SCHEMA.to_owned());
    description["profile_compilation"] = serde_json::json!({
        "operation": "compile_profiles",
        "read_only": true,
        "implicit_registration": false,
        "profiles": [
            "story", "concept_scaffold", "change_arc_scaffold", "person",
            "person_scaffold", "thing_scaffold", "relationship_scaffold", "decision"
        ],
        "concept_scaffold": {
            "topology": "one shallow Concept definition",
            "number_rule": "no realization degree, canonical model, prototype, or recognizer is implied"
        },
        "change_arc_scaffold": {
            "topology": "one Event with optional anticipation, focal-change, and adaptation Event children",
            "number_rule": "phase containment is unweighted and may overlap; no shock magnitude or diffusion law is implied"
        },
        "person_scaffold": {
            "levels": ["lifecycle", "processes"],
            "topology": "lifecycle loads identity and one life Event; processes also loads nine concurrent unweighted process Events",
            "number_rule": "process containment carries no semantic number; numbers require a separately named Cut with a comparison unit",
            "optional_openings": ["body.health"]
        },
        "thing_scaffold": {
            "topology": "one stable Thing and one complete coarse lifecycle Event",
            "number_rule": "the lifecycle index is structural; containment, place, extent, state, and local Cuts are explicit later openings"
        },
        "relationship_scaffold": {
            "topology": "one unweighted joint Event bound to two existing Things",
            "number_rule": "the relationship carries no default trust, attachment, or other semantic score"
        },
        "output": "ordinary_complete_model_definition",
        "person_views": [
            "external_descriptive", "candidate_actor", "self_reported"
        ],
        "operative_model_boundary":
            "latent operative organization is not asserted by any compiled person view",
        "decision_boundary":
            "authored decision dynamics are executable hypotheses, not inferred actor truth or acceptance authority"
    });
    description["schemas"]["trajectory_summary"] =
        serde_json::Value::String(TRAJECTORY_SUMMARY_SCHEMA.to_owned());
    description["execution"]["trajectory_summary"] = serde_json::Value::String(
        "read-only piecewise-linear interpolation and subinterval statistics over already-retained full or decimated candidate paths; no reroll and no uncertainty propagation"
            .to_owned(),
    );
    description["execution_limits"]["max_trajectory_summary_work"] =
        serde_json::json!(MAX_TRAJECTORY_SUMMARY_WORK);
    description["execution_limits"]["max_query_observations"] =
        serde_json::json!(MAX_QUERY_OBSERVATIONS);
    description["execution_limits"]["max_observation_provenance"] =
        serde_json::json!(MAX_OBSERVATION_PROVENANCE);
    description["execution"]["observed_series"] = serde_json::Value::String(
        "forward-only, exact-step, typed assignments to lawless update_mode observed processes; applied after evolution/effects and before exact relations/resolution"
            .to_owned(),
    );
    description["observation_ingestion"] = serde_json::json!({
        "query_field": "ModelTransitionSpec.observations",
        "standalone_schema": false,
        "claim_mode": "observed",
        "evidence_types": ["observation", "report"],
        "initial_value_at_offset_zero": true,
        "value_carry": "last observation carries until the next observation",
        "path_retention": "observed values are retained in every selected candidate path sample",
        "lineage_binding": "normalized observations are included in query and dynamics hashes; generated marks and claims are included in the candidate hash",
        "persistence": "queries, observed states, marks, and claims persist in existing candidate/world snapshots and are deterministically replayed at startup"
    });
    description["trajectory_summary_statistics"] = serde_json::json!([
        "start",
        "end",
        "integral",
        "time_mean",
        "minimum",
        "maximum"
    ]);
    description
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scalar_process(id: &str, initial: f64) -> ProcessDefinition {
        ProcessDefinition {
            id: id.to_owned(),
            value_type: ProcessType::Scalar {
                bounds: NumericBounds {
                    minimum: -10.0,
                    maximum: 10.0,
                },
            },
            initial_value: ProcessValue::Scalar(initial),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![AxisDefinition {
                id: "intensity".to_owned(),
                unit: None,
            }],
            unit: Some("normalized".to_owned()),
            reference_frame: Some("world".to_owned()),
            scale: BTreeMap::from([("temporal".to_owned(), "scene".to_owned())]),
            support: vec!["finite scalar test support".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Unspecified,
        }
    }

    fn constant(value: f64) -> ScalarExpression {
        ScalarExpression::Constant { value }
    }

    fn process(id: &str) -> ScalarExpression {
        ScalarExpression::Process {
            process: id.to_owned(),
        }
    }

    fn decomposition_kinds() -> [(&'static str, DecompositionKind); 7] {
        [
            ("contains", DecompositionKind::Contains),
            ("physical_part", DecompositionKind::PhysicalPart),
            ("membership_view", DecompositionKind::MembershipView),
            ("semantic_subtype", DecompositionKind::SemanticSubtype),
            ("temporal_phase", DecompositionKind::TemporalPhase),
            (
                "functional_refinement",
                DecompositionKind::FunctionalRefinement,
            ),
            (
                "observational_partition",
                DecompositionKind::ObservationalPartition,
            ),
        ]
    }

    fn test_model() -> ModelDefinition {
        ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "typed-world".to_owned(),
            time_unit: "day".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "initial test model".to_owned(),
                provenance: vec!["unit-test".to_owned()],
            },
            processes: vec![
                scalar_process("family.pressure", 0.0),
                scalar_process("person.error_propensity", 0.0),
                scalar_process("person.stress", 0.2),
                ProcessDefinition {
                    id: "person.regime".to_owned(),
                    value_type: ProcessType::Regime {
                        variants: vec!["calm".to_owned(), "alert".to_owned()],
                    },
                    initial_value: ProcessValue::Regime("calm".to_owned()),
                    uncertainty: ClaimUncertainty::Unknown,
                    provenance: vec!["unit-test".to_owned()],
                    axes: vec![],
                    unit: None,
                    reference_frame: None,
                    scale: BTreeMap::new(),
                    support: vec!["named regime".to_owned()],
                    access_scopes: vec![],
                    update_mode: ProcessUpdateMode::Static,
                },
            ],
            decomposition: vec![
                DecompositionEdge {
                    id: "family-contains-stress".to_owned(),
                    parent: "family.pressure".to_owned(),
                    child: "person.stress".to_owned(),
                    kind: DecompositionKind::Contains,
                },
                DecompositionEdge {
                    id: "family-contains-regime".to_owned(),
                    parent: "family.pressure".to_owned(),
                    child: "person.regime".to_owned(),
                    kind: DecompositionKind::Contains,
                },
            ],
            dependencies: vec![
                DependencyEdge {
                    id: "stress-causes-stress".to_owned(),
                    source: "person.stress".to_owned(),
                    target: "person.stress".to_owned(),
                    kind: DependencyKind::Causes,
                    law_id: Some("stress-drift".to_owned()),
                },
                DependencyEdge {
                    id: "stress-derives-error".to_owned(),
                    source: "person.stress".to_owned(),
                    target: "person.error_propensity".to_owned(),
                    kind: DependencyKind::Derives,
                    law_id: Some("derive-error".to_owned()),
                },
                DependencyEdge {
                    id: "stress-observed".to_owned(),
                    source: "person.stress".to_owned(),
                    target: "person.stress".to_owned(),
                    kind: DependencyKind::Observes,
                    law_id: Some("observe-stress".to_owned()),
                },
                DependencyEdge {
                    id: "stress-constrains-relief".to_owned(),
                    source: "person.stress".to_owned(),
                    target: "person.stress".to_owned(),
                    kind: DependencyKind::Constrains,
                    law_id: Some("pressure-gate".to_owned()),
                },
            ],
            laws: vec![
                LawDefinition {
                    id: "stress-drift".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Evolution {
                        target: "person.stress".to_owned(),
                        derivative: ScalarExpression::Multiply {
                            factors: vec![constant(0.1), process("person.stress")],
                        },
                        innovation: Some(InnovationSpec {
                            name: "stress-innovation".to_owned(),
                            distribution: InnovationDistribution::Normal,
                            scale: constant(0.02),
                        }),
                    },
                    provenance: vec!["authored-test".to_owned()],
                },
                LawDefinition {
                    id: "gated-relief".to_owned(),
                    enabled: true,
                    activation: LawActivation::Gated,
                    operator: LawOperator::Evolution {
                        target: "person.stress".to_owned(),
                        derivative: constant(-0.03),
                        innovation: None,
                    },
                    provenance: vec!["authored-test".to_owned()],
                },
                LawDefinition {
                    id: "derive-error".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Relation {
                        target: "person.error_propensity".to_owned(),
                        value: ScalarExpression::Multiply {
                            factors: vec![constant(2.0), process("person.stress")],
                        },
                    },
                    provenance: vec!["authored-test".to_owned()],
                },
                LawDefinition {
                    id: "pressure-gate".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Occurrence {
                        trigger: OccurrenceTrigger::Threshold {
                            expression: process("person.stress"),
                            comparison: Comparison::GreaterOrEqual,
                            threshold: 0.0,
                            firing: TriggerFiring::WhileTrue,
                        },
                        effects: vec![StateEffect {
                            target: "person.stress".to_owned(),
                            mode: EffectMode::Add,
                            value: constant(0.01),
                        }],
                        activates: vec!["gated-relief".to_owned()],
                    },
                    provenance: vec!["authored-test".to_owned()],
                },
                LawDefinition {
                    id: "observe-stress".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Epistemic {
                        claim: ClaimTemplate {
                            id: "observer:stress".to_owned(),
                            subject: "person.stress".to_owned(),
                            uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
                            evidence_type: EvidenceType::Estimate,
                            holder: "observer".to_owned(),
                            provenance: vec!["derived-at-endpoint".to_owned()],
                            authority: ClaimAuthority {
                                source: "test-observer".to_owned(),
                                weight: 0.5,
                            },
                            access_scopes: vec![],
                        },
                        value: process("person.stress"),
                    },
                    provenance: vec!["authored-test".to_owned()],
                },
                LawDefinition {
                    id: "aggregate-pressure".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Resolution {
                        target: "family.pressure".to_owned(),
                        value: process("person.stress"),
                        direction: ResolutionDirection::Aggregate,
                    },
                    provenance: vec!["authored-test".to_owned()],
                },
            ],
            initial_claims: vec![],
            meaning_model: None,
        }
    }

    fn genesis_refinement_base_model() -> ModelDefinition {
        let mut model = test_model();
        model.meaning_model = Some(meaning::test_meaning_model_fixture());
        model.initial_claims.push(Claim {
            id: "baseline-stress-estimate".to_owned(),
            subject: "person.stress".to_owned(),
            value: ProcessValue::Scalar(0.2),
            uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
            evidence_type: EvidenceType::Estimate,
            holder: "test-observer".to_owned(),
            evidence_cutoff: 0.0,
            provenance: vec!["genesis-refinement-fixture".to_owned()],
            authority: ClaimAuthority {
                source: "unit-test".to_owned(),
                weight: 0.5,
            },
            mode: Some(ClaimMode::Estimated),
            value_time: Some(0.0),
            access_scopes: vec![],
        });
        model
    }

    fn additive_genesis_revision(
        base: &ModelDefinition,
        previous_model_hash: &str,
        suffix: &str,
    ) -> ModelDefinition {
        let mut model = base.clone();
        model.revision = ModelRevision {
            number: base.revision.number + 1,
            previous_model_hash: Some(previous_model_hash.to_owned()),
            reason: format!("authored genesis refinement {suffix}"),
            provenance: vec!["genesis-refinement-fixture".to_owned()],
        };
        let process_id = format!("world.{suffix}");
        let mut added_process = scalar_process(&process_id, 1.0);
        added_process.update_mode = ProcessUpdateMode::Static;
        model.processes.push(added_process);
        model.decomposition.push(DecompositionEdge {
            id: format!("family-contains-{suffix}"),
            parent: "family.pressure".to_owned(),
            child: process_id.clone(),
            kind: DecompositionKind::Contains,
        });
        model.initial_claims.push(Claim {
            id: format!("{suffix}-initial-claim"),
            subject: process_id,
            value: ProcessValue::Scalar(1.0),
            uncertainty: ClaimUncertainty::Exact,
            evidence_type: EvidenceType::CreativeHypothesis,
            holder: "author".to_owned(),
            evidence_cutoff: 0.0,
            provenance: vec!["genesis-refinement-fixture".to_owned()],
            authority: ClaimAuthority {
                source: "unit-test-author".to_owned(),
                weight: 1.0,
            },
            mode: Some(ClaimMode::Simulated),
            value_time: Some(0.0),
            access_scopes: vec![],
        });
        model
            .meaning_model
            .as_mut()
            .unwrap()
            .referents
            .push(ReferentDefinition {
                id: format!("referent-{suffix}"),
                boundary: format!("authored {suffix} boundary"),
                continuity_criterion: "stable fixture identity".to_owned(),
                interval: None,
                lifecycle_event_id: None,
                uncertainty: ClaimUncertainty::Exact,
                provenance: vec!["genesis-refinement-fixture".to_owned()],
                authority: Some(ClaimAuthority {
                    source: "unit-test-author".to_owned(),
                    weight: 1.0,
                }),
            });
        model
    }

    fn query(roll_index: u64, path: PathSpec) -> ModelTransitionSpec {
        ModelTransitionSpec {
            schema: MODEL_QUERY_SCHEMA.to_owned(),
            delta_time: 1.0,
            step_size: 0.25,
            seed: "typed-seed".to_owned(),
            roll_index,
            direction: TimeDirection::Forward,
            precedence: ResolutionPrecedence::Fine,
            temporal_resolution: Some("quarter-day".to_owned()),
            semantic_resolution: Some("test".to_owned()),
            interventions: vec![],
            observations: vec![],
            comparison_stream: None,
            selected_support: vec!["person.stress".to_owned()],
            requested_observables: vec!["person.stress".to_owned()],
            access_scopes: vec![],
            path,
        }
    }

    fn trajectory_process(
        id: &str,
        initial: f64,
        unit: &str,
        uncertainty: ClaimUncertainty,
    ) -> ProcessDefinition {
        ProcessDefinition {
            id: id.to_owned(),
            value_type: ProcessType::Scalar {
                bounds: NumericBounds {
                    minimum: -100.0,
                    maximum: 100.0,
                },
            },
            initial_value: ProcessValue::Scalar(initial),
            uncertainty,
            provenance: vec!["trajectory-summary-test".to_owned()],
            axes: vec![],
            unit: Some(unit.to_owned()),
            reference_frame: None,
            scale: BTreeMap::new(),
            support: vec!["analytic fixture".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Unspecified,
        }
    }

    fn intervention_timing_model() -> ModelDefinition {
        let mut control =
            trajectory_process("timing.control", 1.0, "control", ClaimUncertainty::Exact);
        control.update_mode = ProcessUpdateMode::Static;
        ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "intervention-timing".to_owned(),
            time_unit: "second".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "Distinguish legacy successor effects from initial-boundary inputs."
                    .to_owned(),
                provenance: vec!["intervention timing test".to_owned()],
            },
            processes: vec![
                control,
                trajectory_process("timing.signal", 2.0, "signal", ClaimUncertainty::Exact),
                trajectory_process("timing.stock", 0.0, "stock", ClaimUncertainty::Exact),
            ],
            decomposition: vec![],
            dependencies: vec![
                DependencyEdge {
                    id: "control-derives-signal".to_owned(),
                    source: "timing.control".to_owned(),
                    target: "timing.signal".to_owned(),
                    kind: DependencyKind::Derives,
                    law_id: Some("derive-signal".to_owned()),
                },
                DependencyEdge {
                    id: "signal-causes-stock".to_owned(),
                    source: "timing.signal".to_owned(),
                    target: "timing.stock".to_owned(),
                    kind: DependencyKind::Causes,
                    law_id: Some("evolve-stock".to_owned()),
                },
            ],
            laws: vec![
                LawDefinition {
                    id: "derive-signal".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Relation {
                        target: "timing.signal".to_owned(),
                        value: ScalarExpression::Multiply {
                            factors: vec![constant(2.0), process("timing.control")],
                        },
                    },
                    provenance: vec!["signal equals twice the control".to_owned()],
                },
                LawDefinition {
                    id: "evolve-stock".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Evolution {
                        target: "timing.stock".to_owned(),
                        derivative: process("timing.signal"),
                        innovation: None,
                    },
                    provenance: vec!["stock integrates the exact signal".to_owned()],
                },
            ],
            initial_claims: vec![],
            meaning_model: None,
        }
    }

    fn intervention_timing_query(
        application: Option<InterventionApplication>,
    ) -> ModelTransitionSpec {
        ModelTransitionSpec {
            schema: MODEL_QUERY_SCHEMA.to_owned(),
            delta_time: 0.5,
            step_size: 0.25,
            seed: "intervention-timing-seed".to_owned(),
            roll_index: 0,
            direction: TimeDirection::Forward,
            precedence: ResolutionPrecedence::Balanced,
            temporal_resolution: Some("quarter-second".to_owned()),
            semantic_resolution: Some("intervention-timing".to_owned()),
            interventions: vec![TimedIntervention {
                id: "set-control".to_owned(),
                offset: 0.0,
                effect: StateEffect {
                    target: "timing.control".to_owned(),
                    mode: EffectMode::Set,
                    value: constant(2.0),
                },
                application,
            }],
            observations: vec![],
            comparison_stream: None,
            selected_support: vec![],
            requested_observables: vec![
                "timing.control".to_owned(),
                "timing.signal".to_owned(),
                "timing.stock".to_owned(),
            ],
            access_scopes: vec![],
            path: PathSpec::Full,
        }
    }

    fn linear_trajectory_model() -> ModelDefinition {
        ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "linear-trajectory".to_owned(),
            time_unit: "second".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "analytic trajectory fixture".to_owned(),
                provenance: vec!["trajectory-summary-test".to_owned()],
            },
            processes: vec![trajectory_process(
                "position",
                1.0,
                "meter",
                ClaimUncertainty::StandardDeviation { value: 0.1 },
            )],
            decomposition: vec![],
            dependencies: vec![],
            laws: vec![LawDefinition {
                id: "linear-motion".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "position".to_owned(),
                    derivative: constant(2.0),
                    innovation: None,
                },
                provenance: vec!["analytic dx/dt=2".to_owned()],
            }],
            initial_claims: vec![],
            meaning_model: None,
        }
    }

    fn turning_trajectory_model() -> ModelDefinition {
        ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "turning-trajectory".to_owned(),
            time_unit: "second".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "interior-extremum trajectory fixture".to_owned(),
                provenance: vec!["trajectory-summary-test".to_owned()],
            },
            processes: vec![
                trajectory_process("position", 0.0, "meter", ClaimUncertainty::Exact),
                trajectory_process("velocity", 1.0, "meter/second", ClaimUncertainty::Exact),
            ],
            decomposition: vec![],
            dependencies: vec![DependencyEdge {
                id: "velocity-drives-position".to_owned(),
                source: "velocity".to_owned(),
                target: "position".to_owned(),
                kind: DependencyKind::Causes,
                law_id: Some("position-motion".to_owned()),
            }],
            laws: vec![
                LawDefinition {
                    id: "position-motion".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Evolution {
                        target: "position".to_owned(),
                        derivative: process("velocity"),
                        innovation: None,
                    },
                    provenance: vec!["dx/dt=v".to_owned()],
                },
                LawDefinition {
                    id: "velocity-motion".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Evolution {
                        target: "velocity".to_owned(),
                        derivative: constant(-2.0),
                        innovation: None,
                    },
                    provenance: vec!["dv/dt=-2".to_owned()],
                },
            ],
            initial_claims: vec![],
            meaning_model: None,
        }
    }

    fn trajectory_query(path: PathSpec, fields: &[&str]) -> ModelTransitionSpec {
        ModelTransitionSpec {
            schema: MODEL_QUERY_SCHEMA.to_owned(),
            delta_time: 1.0,
            step_size: 0.25,
            seed: "trajectory-summary-seed".to_owned(),
            roll_index: 0,
            direction: TimeDirection::Forward,
            precedence: ResolutionPrecedence::Balanced,
            temporal_resolution: Some("quarter-second".to_owned()),
            semantic_resolution: None,
            interventions: vec![],
            observations: vec![],
            comparison_stream: None,
            selected_support: vec![],
            requested_observables: fields.iter().map(|field| (*field).to_owned()).collect(),
            access_scopes: vec![],
            path,
        }
    }

    fn trajectory_summary_spec(
        start_time: f64,
        end_time: f64,
        fields: &[&str],
    ) -> TrajectorySummarySpec {
        TrajectorySummarySpec {
            schema: TRAJECTORY_SUMMARY_QUERY_SCHEMA.to_owned(),
            start_time,
            end_time,
            fields: fields.iter().map(|field| (*field).to_owned()).collect(),
            access_scopes: vec![],
        }
    }

    fn observed_series_model() -> ModelDefinition {
        let mut temperature = trajectory_process(
            "sensor.temperature",
            10.0,
            "celsius",
            ClaimUncertainty::StandardDeviation { value: 0.5 },
        );
        temperature.update_mode = ProcessUpdateMode::Observed;
        temperature.access_scopes = vec!["sensor:private".to_owned()];
        let mut derived = trajectory_process(
            "sensor.derived_heat",
            20.0,
            "derived-celsius",
            ClaimUncertainty::Unknown,
        );
        derived.access_scopes = vec!["sensor:private".to_owned()];
        ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "observed-series".to_owned(),
            time_unit: "second".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "observed-series fixture".to_owned(),
                provenance: vec!["observed-series-test".to_owned()],
            },
            processes: vec![temperature, derived],
            decomposition: vec![],
            dependencies: vec![DependencyEdge {
                id: "temperature-derives-heat".to_owned(),
                source: "sensor.temperature".to_owned(),
                target: "sensor.derived_heat".to_owned(),
                kind: DependencyKind::Derives,
                law_id: Some("derive-heat".to_owned()),
            }],
            laws: vec![LawDefinition {
                id: "derive-heat".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Relation {
                    target: "sensor.derived_heat".to_owned(),
                    value: ScalarExpression::Multiply {
                        factors: vec![constant(2.0), process("sensor.temperature")],
                    },
                },
                provenance: vec!["analytic derived relation".to_owned()],
            }],
            initial_claims: vec![],
            meaning_model: None,
        }
    }

    fn observed_value(id: &str, offset: f64, value: f64) -> TimedObservation {
        TimedObservation {
            id: id.to_owned(),
            target: "sensor.temperature".to_owned(),
            offset,
            value: ProcessValue::Scalar(value),
            unit: Some("celsius".to_owned()),
            uncertainty: ClaimUncertainty::StandardDeviation { value: 0.25 },
            evidence_type: EvidenceType::Observation,
            holder: "sensor-operator".to_owned(),
            provenance: vec!["calibrated sensor fixture".to_owned()],
            authority: ClaimAuthority {
                source: "sensor-A".to_owned(),
                weight: 0.9,
            },
        }
    }

    fn observed_query(path: PathSpec, observations: Vec<TimedObservation>) -> ModelTransitionSpec {
        let mut query = trajectory_query(path, &["sensor.temperature", "sensor.derived_heat"]);
        query.seed = "observed-series-seed".to_owned();
        query.access_scopes = vec!["sensor:private".to_owned()];
        query.observations = observations;
        query
    }

    fn command(operation: &str, fields: serde_json::Value) -> String {
        let mut value = serde_json::json!({
            "schema": super::super::COMMAND_SCHEMA,
            "request_id": format!("{operation}-request"),
            "operation": operation
        });
        let target = value.as_object_mut().unwrap();
        for (key, value) in fields.as_object().unwrap() {
            target.insert(key.clone(), value.clone());
        }
        serde_json::to_string(&value).unwrap()
    }

    fn result(response: ResponseEnvelope) -> serde_json::Value {
        assert!(
            response.ok,
            "{:?}",
            response.error.map(|error| error.message)
        );
        response.result.unwrap()
    }

    #[test]
    fn query_graph_full_exposes_factor_payloads_ast_edges_and_overlays_without_mutation() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let before = hash_serializable(&session.snapshot()).unwrap();
        let full = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {"mode": "full"}
            }),
        )));
        assert_eq!(full["schema"], MODEL_GRAPH_SCHEMA);
        assert_eq!(full["mode"], "full");
        assert_eq!(full["total_node_count"], 10);
        assert_eq!(full["total_edge_count"], 18);
        assert_eq!(full["returned_node_count"], 10);
        assert_eq!(full["returned_edge_count"], 18);

        let nodes = full["nodes"].as_array().unwrap();
        let relation = nodes
            .iter()
            .find(|node| node["id"] == "law:derive-error")
            .unwrap();
        assert_eq!(relation["law_definition"]["operator"]["role"], "relation");
        assert_eq!(relation["law_definition"]["provenance"][0], "authored-test");
        let stress = nodes
            .iter()
            .find(|node| node["id"] == "process:person.stress")
            .unwrap();
        assert_eq!(stress["process_metadata"]["unit"], "normalized");
        assert_eq!(stress["process_metadata"]["scale"]["temporal"], "scene");
        assert_eq!(
            stress["process_metadata"]["support"][0],
            "finite scalar test support"
        );
        assert!(stress.get("value").is_none());

        let edges = full["edges"].as_array().unwrap();
        let has_edge = |kind: &str, source: &str, target: &str| {
            edges.iter().any(|edge| {
                edge["kind"] == kind && edge["source"] == source && edge["target"] == target
            })
        };
        assert!(has_edge(
            "reads",
            "process:person.stress",
            "law:derive-error"
        ));
        assert!(has_edge(
            "writes",
            "law:derive-error",
            "process:person.error_propensity"
        ));
        assert!(has_edge(
            "activates",
            "law:pressure-gate",
            "law:gated-relief"
        ));
        assert!(has_edge(
            "decomposition",
            "process:family.pressure",
            "process:person.stress"
        ));
        assert!(has_edge(
            "declared_dependency",
            "process:person.stress",
            "process:person.error_propensity"
        ));
        assert!(edges.iter().all(|edge| edge["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("edge:"))));
        assert_eq!(hash_serializable(&session.snapshot()).unwrap(), before);
    }

    #[test]
    fn query_graph_values_are_source_bound_and_scopes_filter_structure() {
        let mut model = test_model();
        model
            .processes
            .iter_mut()
            .find(|process| process.id == "person.stress")
            .unwrap()
            .access_scopes = vec!["private:stress".to_owned()];
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": model}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let unscoped = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {"mode": "full", "include_values": true}
            }),
        )));
        assert!(!unscoped["nodes"].as_array().unwrap().iter().any(|node| {
            node["id"] == "process:person.stress" || node["id"] == "law:derive-error"
        }));
        let scoped = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {
                    "mode": "full",
                    "include_values": true,
                    "access_scopes": ["private:stress"]
                }
            }),
        )));
        assert_eq!(unscoped["snapshot_hash"], scoped["snapshot_hash"]);
        let stress = scoped["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == "process:person.stress")
            .unwrap();
        assert_eq!(
            stress["value"],
            serde_json::json!({"kind": "scalar", "value": 0.2})
        );
        assert_eq!(stress["value_source"], "model_initial_value");

        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "graph-world"}),
        )));
        let world = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "world_id": "graph-world",
                "graph_query": {
                    "mode": "full",
                    "include_values": true,
                    "access_scopes": ["private:stress"]
                }
            }),
        )));
        assert_eq!(world["source"]["kind"], "world");
        assert!(world["nodes"].as_array().unwrap().iter().any(|node| {
            node["id"] == "process:person.stress" && node["value_source"] == "accepted_world_state"
        }));
        let mut candidate_query = query(0, PathSpec::Endpoint);
        candidate_query.access_scopes = vec!["private:stress".to_owned()];
        let candidate = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "graph-world", "query": candidate_query}),
        )));
        let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
        let candidate_graph = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "candidate_hash": candidate_hash,
                "graph_query": {
                    "mode": "full",
                    "include_values": true,
                    "access_scopes": ["private:stress"]
                }
            }),
        )));
        assert_eq!(candidate_graph["source"]["kind"], "candidate");
        assert_eq!(candidate_graph["source"]["candidate_status"], "pending");
        assert!(candidate_graph["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| {
                node["id"] == "process:person.stress"
                    && node["value_source"] == "candidate_successor_state"
            }));
        let occurrence = candidate_graph["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == "law:pressure-gate")
            .unwrap();
        assert_eq!(occurrence["occurrence_mark_count"], 4);
        assert_eq!(occurrence["occurrence_marks_truncated"], false);
        assert_eq!(occurrence["occurrence_marks"].as_array().unwrap().len(), 4);
        assert!(occurrence["occurrence_marks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|mark| mark["source"] == "pressure-gate"));
    }

    #[test]
    fn query_graph_skeleton_and_neighborhood_are_snapshot_bound_and_boundary_complete() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let full = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {"mode": "full"}
            }),
        )));
        let snapshot_hash = full["snapshot_hash"].as_str().unwrap().to_owned();
        let skeleton = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {
                    "mode": "skeleton",
                    "expected_snapshot_hash": snapshot_hash
                }
            }),
        )));
        assert_eq!(skeleton["snapshot_hash"], full["snapshot_hash"]);
        assert_eq!(skeleton["returned_node_count"], 0);
        assert_eq!(skeleton["returned_edge_count"], 0);
        assert_eq!(skeleton["skeleton"]["process_count"], 4);
        assert_eq!(skeleton["skeleton"]["law_count"], 6);

        let neighborhood = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {
                    "mode": "neighborhood",
                    "center": "derive-error",
                    "depth": 0,
                    "direction": "both",
                    "expected_snapshot_hash": full["snapshot_hash"]
                }
            }),
        )));
        assert_eq!(neighborhood["neighborhood"]["center"], "law:derive-error");
        assert_eq!(neighborhood["neighborhood"]["core_node_count"], 1);
        assert_eq!(neighborhood["neighborhood"]["boundary_node_count"], 2);
        assert_eq!(neighborhood["returned_edge_count"], 2);
        let returned_ids: BTreeSet<&str> = neighborhood["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["id"].as_str().unwrap())
            .collect();
        for edge in neighborhood["edges"].as_array().unwrap() {
            assert!(returned_ids.contains(edge["source"].as_str().unwrap()));
            assert!(returned_ids.contains(edge["target"].as_str().unwrap()));
            assert_eq!(edge["crossing"], true);
        }
        let incident_in_full = full["edges"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|edge| {
                edge["source"] == "law:derive-error" || edge["target"] == "law:derive-error"
            })
            .count();
        assert_eq!(incident_in_full, neighborhood["returned_edge_count"]);

        let stale = session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {
                    "mode": "full",
                    "expected_snapshot_hash": "0000000000000000000000000000000000000000000000000000000000000000"
                }
            }),
        ));
        assert!(!stale.ok);
        assert_eq!(stale.error.unwrap().code, "conflict");
    }

    #[test]
    fn typed_ir_validates_all_five_roles_and_keeps_edges_distinct() {
        let compiled = compile_model(test_model()).unwrap();
        let summary = compiled.summary();
        assert_eq!(summary.process_count, 4);
        assert_eq!(summary.decomposition_edge_count, 2);
        assert_eq!(summary.dependency_edge_count, 4);
        for role in [
            "evolution",
            "relation",
            "occurrence",
            "epistemic",
            "resolution",
        ] {
            assert!(summary.law_roles.contains_key(role));
        }
        assert_eq!(
            compiled.genesis_world("world").unwrap().state["person.regime"],
            ProcessValue::Regime("calm".to_owned())
        );
    }

    #[test]
    fn meaning_model_is_opt_in_canonical_and_visible_in_summary() {
        let legacy = test_model();
        let legacy_json = serde_json::to_value(&legacy).unwrap();
        assert!(!legacy_json
            .as_object()
            .unwrap()
            .contains_key("meaning_model"));
        let legacy_compiled = compile_model(legacy).unwrap();
        assert!(legacy_compiled.summary().meaning_model.is_none());

        let mut definition = test_model();
        definition.meaning_model = Some(meaning::test_meaning_model_fixture());
        let compiled = compile_model(definition).unwrap();
        assert_ne!(compiled.model_hash, legacy_compiled.model_hash);
        let summary = compiled.summary().meaning_model.unwrap();
        assert_eq!(summary.schema, MEANING_MODEL_SCHEMA);
        assert_eq!(summary.concept_count, 4);
        assert_eq!(
            summary.concept_ids,
            ["care", "love", "social-process", "trust"]
        );
        assert_eq!(summary.abstract_relation_count, 1);
        assert_eq!(summary.abstract_cut_count, 1);
        assert_eq!(summary.referent_count, 3);
        assert_eq!(
            summary.referent_ids,
            ["alice", "bob", "relationship-referent"]
        );
        assert_eq!(summary.encapsulation_cut_count, 1);
        assert_eq!(summary.event_count, 4);
        assert_eq!(summary.event_relation_count, 1);
        assert_eq!(summary.event_relation_ids, ["trust-enables-repair"]);
        assert_eq!(summary.event_referent_binding_count, 3);
        assert_eq!(
            summary.event_referent_binding_ids,
            [
                "relationship-person-a",
                "relationship-person-b",
                "relationship-state"
            ]
        );
        assert_eq!(summary.physical_cut_count, 2);
        assert_eq!(summary.realization_count, 2);
        assert_eq!(summary.realization_ids, ["define-love", "describe-trust"]);

        let meaning_model = compiled.definition().meaning_model.as_ref().unwrap();
        assert_eq!(
            meaning_model.abstract_cuts[0].child_concept_ids,
            ["care", "trust"]
        );
        assert_eq!(
            meaning_model.encapsulation_cuts[0]
                .children
                .iter()
                .map(|child| child.referent_id.as_str())
                .collect::<Vec<_>>(),
            ["alice", "bob"]
        );
        let parallel = meaning_model
            .physical_cuts
            .iter()
            .find(|cut| cut.kind == PhysicalCutKind::Parallel)
            .unwrap();
        assert_eq!(parallel.child_event_ids, ["care-event", "trust-event"]);
        let sequential = meaning_model
            .physical_cuts
            .iter()
            .find(|cut| cut.kind == PhysicalCutKind::Sequential)
            .unwrap();
        assert_eq!(sequential.child_event_ids, ["trust-event", "repair-event"]);

        let encoded = serde_json::to_vec(compiled.definition()).unwrap();
        let decoded: ModelDefinition = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(&decoded, compiled.definition());

        let mut reordered = test_model();
        let mut meaning_model = meaning::test_meaning_model_fixture();
        meaning_model.concepts.reverse();
        meaning_model.referents.reverse();
        meaning_model.encapsulation_cuts[0].children.reverse();
        meaning_model.events.reverse();
        meaning_model.event_relations.reverse();
        meaning_model.event_referent_bindings.reverse();
        meaning_model.physical_cuts.reverse();
        meaning_model.realizations.reverse();
        reordered.meaning_model = Some(meaning_model);
        assert_eq!(
            compile_model(reordered).unwrap().model_hash,
            compiled.model_hash
        );
    }

    #[test]
    fn meaning_model_survives_session_serialization_and_restore() {
        let mut definition = test_model();
        definition.meaning_model = Some(meaning::test_meaning_model_fixture());
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": definition}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(registered["summary"]["meaning_model"]["concept_count"], 4);
        assert_eq!(registered["summary"]["meaning_model"]["referent_count"], 3);
        assert_eq!(
            registered["model"]["meaning_model"]["schema"],
            MEANING_MODEL_SCHEMA
        );

        let bytes = serde_json::to_vec(&session.snapshot()).unwrap();
        let persisted: PersistedSession = serde_json::from_slice(&bytes).unwrap();
        let mut restored = MachineSession::restore(persisted).unwrap();
        let fetched = result(restored.parse_and_execute(&command(
            "get_model",
            serde_json::json!({"model_hash": model_hash}),
        )));
        assert_eq!(fetched["model_hash"], model_hash);
        assert_eq!(fetched["summary"]["meaning_model"]["event_count"], 4);
        assert_eq!(
            fetched["summary"]["meaning_model"]["event_relation_count"],
            1
        );
        assert_eq!(
            fetched["summary"]["meaning_model"]["event_referent_binding_count"],
            3
        );
        assert_eq!(
            fetched["model"]["meaning_model"]["realizations"][0]["id"],
            "define-love"
        );
    }

    #[test]
    fn canonical_world_hash_survives_exact_float_json_roundtrip() {
        let model = compile_model(test_model()).unwrap();
        let mut state = model.genesis_world("float-roundtrip").unwrap().state;
        state.insert(
            "person.stress".to_owned(),
            ProcessValue::Scalar(0.9091999999999999),
        );
        let world = build_world_head(
            &model,
            "float-roundtrip".to_owned(),
            1,
            1.0,
            state,
            model.initial_claims.clone(),
            None,
        )
        .unwrap();
        let encoded = serde_json::to_vec(&world).unwrap();
        let decoded: WorldHead = serde_json::from_slice(&encoded).unwrap();
        validate_world(&model, &decoded).unwrap();
        assert_eq!(decoded.world_hash, world.world_hash);
        assert_eq!(serde_json::to_vec(&decoded).unwrap(), encoded);
    }

    #[test]
    fn typed_ir_rejects_unknown_semantic_fields() {
        let mut model = serde_json::to_value(test_model()).unwrap();
        model["laws"][0]["operator"]["innovaton"] = serde_json::json!({"name": "typo"});
        assert!(serde_json::from_value::<ModelDefinition>(model).is_err());

        let value = serde_json::json!({"kind": "scalar", "value": 0.5, "ignored": true});
        assert!(serde_json::from_value::<ProcessValue>(value).is_err());
    }

    #[test]
    fn retained_decimation_only_upgrades_when_it_is_a_sample_superset() {
        let path = |every| RetainedModelPath {
            schema: MODEL_PATH_SCHEMA.to_owned(),
            retention: PathSpec::Decimated { every },
            total_sample_count: 0,
            samples: vec![],
        };
        assert!(path_is_richer(&path(2), &path(4)));
        assert!(!path_is_richer(&path(2), &path(3)));
    }

    #[test]
    fn complete_roll_is_deterministic_and_path_policy_does_not_change_canon() {
        let compiled = compile_model(test_model()).unwrap();
        let parent = compiled.genesis_world("world").unwrap();
        let endpoint =
            roll_model_transition(&compiled, &parent, query(0, PathSpec::Endpoint)).unwrap();
        let full = roll_model_transition(&compiled, &parent, query(0, PathSpec::Full)).unwrap();
        assert_eq!(
            endpoint.candidate.candidate_hash,
            full.candidate.candidate_hash
        );
        assert_eq!(
            endpoint.candidate.successor_state,
            full.candidate.successor_state
        );
        assert_eq!(endpoint.candidate.path.samples.len(), 1);
        assert_eq!(full.candidate.path.samples.len(), 5);
        assert!(endpoint
            .candidate
            .successor_state
            .contains_key("person.regime"));
        assert!(endpoint
            .candidate
            .successor_claims
            .contains_key("observer:stress"));
        assert!(!endpoint.candidate.marks.is_empty());
        assert!(!endpoint.candidate.randomness.draws.is_empty());
        assert_eq!(parent.version, 0);
    }

    #[test]
    fn ordinary_ir_routes_a_normalized_solver_repertoire_by_context() {
        let field = |id: &str,
                     initial: f64,
                     minimum: f64,
                     maximum: f64,
                     role: &str,
                     update_mode: ProcessUpdateMode| {
            let mut field = scalar_process(id, initial);
            field.value_type = ProcessType::Scalar {
                bounds: NumericBounds { minimum, maximum },
            };
            field.axes.clear();
            field.scale = BTreeMap::from([
                ("semantic_role".to_owned(), role.to_owned()),
                (
                    "claim_boundary".to_owned(),
                    "authored strategy signal, not validated cognition".to_owned(),
                ),
            ]);
            field.support = vec!["contextual solver repertoire fixture".to_owned()];
            field.update_mode = update_mode;
            field
        };
        let relation = |id: &str, target: &str, value: ScalarExpression| LawDefinition {
            id: id.to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Relation {
                target: target.to_owned(),
                value,
            },
            provenance: vec!["contextual solver repertoire fixture".to_owned()],
        };
        let components = [
            ("abstract", 0.9, 0.4),
            ("relational", 0.2, 0.2),
            ("procedural", -0.4, 0.4),
        ];
        let mut processes = vec![field(
            "problem.context.abstraction_relevance",
            0.5,
            0.0,
            1.0,
            "problem_context",
            ProcessUpdateMode::Static,
        )];
        for (id, output, initial_weight) in components {
            processes.push(field(
                &format!("solver.{id}.output"),
                output,
                -1.0,
                1.0,
                "solver_component_output",
                ProcessUpdateMode::Static,
            ));
            processes.push(field(
                &format!("solver.{id}.weight"),
                initial_weight,
                0.0,
                1.0,
                "normalized_solver_weight",
                ProcessUpdateMode::Unspecified,
            ));
        }
        processes.push(field(
            "solver.routed.output",
            0.24,
            -1.0,
            1.0,
            "routed_solver_output",
            ProcessUpdateMode::Unspecified,
        ));

        let mut laws = Vec::new();
        let context = || process("problem.context.abstraction_relevance");
        for (id, weight) in [
            (
                "abstract",
                ScalarExpression::Add {
                    terms: vec![
                        constant(0.1),
                        ScalarExpression::Multiply {
                            factors: vec![constant(0.6), context()],
                        },
                    ],
                },
            ),
            ("relational", constant(0.2)),
            (
                "procedural",
                ScalarExpression::Subtract {
                    left: Box::new(constant(0.7)),
                    right: Box::new(ScalarExpression::Multiply {
                        factors: vec![constant(0.6), context()],
                    }),
                },
            ),
        ] {
            laws.push(relation(
                &format!("derive-solver-{id}-weight"),
                &format!("solver.{id}.weight"),
                weight,
            ));
        }
        laws.push(relation(
            "derive-routed-solver-output",
            "solver.routed.output",
            ScalarExpression::Add {
                terms: components
                    .iter()
                    .map(|(id, _, _)| ScalarExpression::Multiply {
                        factors: vec![
                            process(&format!("solver.{id}.weight")),
                            process(&format!("solver.{id}.output")),
                        ],
                    })
                    .collect(),
            },
        ));

        let definition = ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "contextual-solver-repertoire".to_owned(),
            time_unit: "decision_interval".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "Exercise a contextual continuous mixture using only ordinary IR."
                    .to_owned(),
                provenance: vec!["contextual solver repertoire fixture".to_owned()],
            },
            processes,
            decomposition: vec![],
            dependencies: vec![],
            laws,
            initial_claims: vec![],
            meaning_model: None,
        };
        let model = compile_model(definition).unwrap();
        let parent = model.genesis_world("solver-routing-world").unwrap();
        let observables = model
            .definition()
            .processes
            .iter()
            .map(|field| field.id.clone())
            .collect::<Vec<_>>();
        let roll_in_context = |label: &str, context: f64| {
            roll_model_transition(
                &model,
                &parent,
                ModelTransitionSpec {
                    schema: MODEL_QUERY_SCHEMA.to_owned(),
                    delta_time: 0.1,
                    step_size: 0.1,
                    seed: "contextual-solver-repertoire".to_owned(),
                    roll_index: 0,
                    direction: TimeDirection::Forward,
                    precedence: ResolutionPrecedence::Balanced,
                    temporal_resolution: None,
                    semantic_resolution: Some("solver-interface".to_owned()),
                    interventions: vec![TimedIntervention {
                        id: format!("set-{label}-context"),
                        offset: 0.0,
                        effect: StateEffect {
                            target: "problem.context.abstraction_relevance".to_owned(),
                            mode: EffectMode::Set,
                            value: constant(context),
                        },
                        application: None,
                    }],
                    observations: vec![],
                    comparison_stream: None,
                    selected_support: vec![],
                    requested_observables: observables.clone(),
                    access_scopes: vec![],
                    path: PathSpec::Full,
                },
            )
            .unwrap()
        };

        let concrete = roll_in_context("concrete", 0.1);
        let abstracted = roll_in_context("abstract", 0.9);
        let read = |state: &BTreeMap<String, ProcessValue>, id: &str| scalar(state, id).unwrap();
        for result in [&concrete, &abstracted] {
            let state = &result.candidate.successor_state;
            let weight_sum: f64 = components
                .iter()
                .map(|(id, _, _)| read(state, &format!("solver.{id}.weight")))
                .sum();
            assert!((weight_sum - 1.0).abs() < 1.0e-12);
            assert!(components.iter().all(|(id, _, _)| {
                let weight = read(state, &format!("solver.{id}.weight"));
                weight > 0.0 && weight < 1.0
            }));
            assert_eq!(read(state, "solver.abstract.output"), 0.9);
            assert_eq!(read(state, "solver.relational.output"), 0.2);
            assert_eq!(read(state, "solver.procedural.output"), -0.4);

            let reconstructed: f64 = components
                .iter()
                .map(|(id, _, _)| {
                    read(state, &format!("solver.{id}.weight"))
                        * read(state, &format!("solver.{id}.output"))
                })
                .sum();
            assert!((read(state, "solver.routed.output") - reconstructed).abs() < 1.0e-12);
            assert_eq!(state.len(), model.definition().processes.len());
            assert_eq!(result.proposed_head.state, *state);
            assert_eq!(result.candidate.expected_parent_version, parent.version);
            assert_eq!(result.proposed_head.version, parent.version + 1);
            assert_eq!(
                result.proposed_head.lineage_head.as_deref(),
                Some(result.candidate.candidate_hash.as_str())
            );
            assert_eq!(result.candidate.path.samples.last().unwrap().state, *state);
        }

        let concrete_state = &concrete.candidate.successor_state;
        let abstract_state = &abstracted.candidate.successor_state;
        assert!(
            read(concrete_state, "solver.procedural.weight")
                > read(concrete_state, "solver.abstract.weight")
        );
        assert!(
            read(abstract_state, "solver.abstract.weight")
                > read(abstract_state, "solver.procedural.weight")
        );
        assert!(
            read(abstract_state, "solver.routed.output")
                > read(concrete_state, "solver.routed.output")
        );
        assert_ne!(
            concrete.candidate.candidate_hash,
            abstracted.candidate.candidate_hash
        );
        assert_eq!(parent.version, 0);
    }

    #[test]
    fn epistemic_endpoint_claims_are_derived_at_the_successor_time() {
        let compiled = compile_model(test_model()).unwrap();
        let parent = compiled.genesis_world("derived-claim-world").unwrap();
        let rolled =
            roll_model_transition(&compiled, &parent, query(0, PathSpec::Endpoint)).unwrap();
        let claim = &rolled.candidate.successor_claims["observer:stress"];
        assert_eq!(claim.mode, Some(ClaimMode::Derived));
        assert_eq!(claim.value_time, Some(rolled.candidate.end_time));
        assert_eq!(claim.evidence_cutoff, rolled.candidate.end_time);
        assert_eq!(claim.evidence_type, EvidenceType::Estimate);
    }

    #[test]
    fn lawless_observed_series_carries_and_relations_see_each_observation() {
        let model = compile_model(observed_series_model()).unwrap();
        let parent = model.genesis_world("observed-world").unwrap();
        let late = observed_value("late", 0.75, 40.0);
        let early = observed_value("early", 0.25, 20.0);
        let rolled = roll_model_transition(
            &model,
            &parent,
            observed_query(PathSpec::Full, vec![late.clone(), early.clone()]),
        )
        .unwrap();

        assert_eq!(
            rolled
                .candidate
                .query
                .observations
                .iter()
                .map(|observation| observation.id.as_str())
                .collect::<Vec<_>>(),
            ["early", "late"]
        );
        let temperatures = rolled
            .candidate
            .path
            .samples
            .iter()
            .map(|sample| scalar(&sample.state, "sensor.temperature").unwrap())
            .collect::<Vec<_>>();
        let derived = rolled
            .candidate
            .path
            .samples
            .iter()
            .map(|sample| scalar(&sample.state, "sensor.derived_heat").unwrap())
            .collect::<Vec<_>>();
        assert_eq!(temperatures, [10.0, 20.0, 20.0, 40.0, 40.0]);
        assert_eq!(derived, [20.0, 40.0, 40.0, 80.0, 80.0]);
        assert_eq!(rolled.candidate.marks.len(), 2);
        assert!(rolled
            .candidate
            .marks
            .iter()
            .all(|mark| mark.kind == "observation"));

        let mut claims = rolled
            .candidate
            .successor_claims
            .values()
            .collect::<Vec<_>>();
        claims.sort_by(|left, right| {
            left.value_time
                .unwrap()
                .total_cmp(&right.value_time.unwrap())
        });
        assert_eq!(claims.len(), 2);
        assert_eq!(claims[0].value, ProcessValue::Scalar(20.0));
        assert_eq!(claims[1].value, ProcessValue::Scalar(40.0));
        for (claim, expected_time) in claims.iter().zip([0.25, 0.75]) {
            assert_eq!(claim.mode, Some(ClaimMode::Observed));
            assert_eq!(claim.value_time, Some(expected_time));
            assert_eq!(claim.evidence_cutoff, expected_time);
            assert_eq!(claim.evidence_type, EvidenceType::Observation);
            assert_eq!(claim.holder, "sensor-operator");
            assert_eq!(claim.provenance, ["calibrated sensor fixture"]);
            assert_eq!(claim.authority.source, "sensor-A");
            assert_eq!(claim.authority.weight, 0.9);
            assert_eq!(
                claim.uncertainty,
                ClaimUncertainty::StandardDeviation { value: 0.25 }
            );
            assert_eq!(claim.access_scopes, ["sensor:private"]);
        }

        let reordered = roll_model_transition(
            &model,
            &parent,
            observed_query(PathSpec::Full, vec![early, late]),
        )
        .unwrap();
        assert_eq!(rolled, reordered);

        let carried =
            roll_model_transition(&model, &parent, observed_query(PathSpec::Full, vec![])).unwrap();
        assert_ne!(rolled.candidate.query_hash, carried.candidate.query_hash);
        assert_ne!(
            rolled.candidate.dynamics_hash,
            carried.candidate.dynamics_hash
        );
        assert_ne!(
            rolled.candidate.candidate_hash,
            carried.candidate.candidate_hash
        );
        assert!(carried.candidate.path.samples.iter().all(|sample| {
            scalar(&sample.state, "sensor.temperature").unwrap() == 10.0
                && scalar(&sample.state, "sensor.derived_heat").unwrap() == 20.0
        }));
    }

    #[test]
    fn ai_report_can_ingest_a_non_scalar_observed_output_without_a_law() {
        let mut definition = observed_series_model();
        definition.id = "ai-vector-report".to_owned();
        let estimate = &mut definition.processes[0];
        estimate.id = "estimator.affect_estimate".to_owned();
        estimate.value_type = ProcessType::Vector {
            dimensions: 2,
            bounds: NumericBounds {
                minimum: -1.0,
                maximum: 1.0,
            },
        };
        estimate.initial_value = ProcessValue::Vector(vec![0.0, 0.0]);
        estimate.unit = Some("normalized-affect".to_owned());
        estimate.provenance = vec!["AI estimate channel fixture".to_owned()];
        definition.processes.truncate(1);
        definition.dependencies.clear();
        definition.laws.clear();

        let model = compile_model(definition).unwrap();
        let parent = model.genesis_world("ai-report-world").unwrap();
        let mut query = trajectory_query(PathSpec::Full, &["estimator.affect_estimate"]);
        query.access_scopes = vec!["sensor:private".to_owned()];
        query.observations = vec![TimedObservation {
            id: "agent-output-1".to_owned(),
            target: "estimator.affect_estimate".to_owned(),
            offset: 0.5,
            value: ProcessValue::Vector(vec![0.25, -0.5]),
            unit: Some("normalized-affect".to_owned()),
            uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
            evidence_type: EvidenceType::Report,
            holder: "agent:model-a".to_owned(),
            provenance: vec!["model-a emitted affect estimate".to_owned()],
            authority: ClaimAuthority {
                source: "agent:model-a".to_owned(),
                weight: 0.6,
            },
        }];

        let rolled = roll_model_transition(&model, &parent, query).unwrap();
        assert!(model.laws.is_empty());
        assert_eq!(
            rolled.candidate.successor_state["estimator.affect_estimate"],
            ProcessValue::Vector(vec![0.25, -0.5])
        );
        assert_eq!(
            rolled.candidate.path.samples[1].state["estimator.affect_estimate"],
            ProcessValue::Vector(vec![0.0, 0.0])
        );
        assert_eq!(
            rolled.candidate.path.samples[2].state["estimator.affect_estimate"],
            ProcessValue::Vector(vec![0.25, -0.5])
        );
        let claim = rolled.candidate.successor_claims.values().next().unwrap();
        assert_eq!(claim.mode, Some(ClaimMode::Observed));
        assert_eq!(claim.evidence_type, EvidenceType::Report);
        assert_eq!(claim.holder, "agent:model-a");
        assert_eq!(claim.value, ProcessValue::Vector(vec![0.25, -0.5]));
        assert_eq!(claim.value_time, Some(0.5));
    }

    #[test]
    fn observed_series_rejects_invalid_mode_type_unit_scope_time_and_duplicates() {
        let model = compile_model(observed_series_model()).unwrap();
        let parent = model.genesis_world("observed-errors").unwrap();
        let failure = |query| roll_model_transition(&model, &parent, query).unwrap_err().0;

        let mut wrong_mode = observed_value("wrong-mode", 0.25, 20.0);
        wrong_mode.target = "sensor.derived_heat".to_owned();
        wrong_mode.unit = Some("derived-celsius".to_owned());
        assert!(failure(observed_query(PathSpec::Full, vec![wrong_mode]))
            .contains("must declare update_mode observed"));

        let mut wrong_type = observed_value("wrong-type", 0.25, 20.0);
        wrong_type.value = ProcessValue::Category("hot".to_owned());
        assert!(failure(observed_query(PathSpec::Full, vec![wrong_type]))
            .contains("does not match declared scalar type"));

        let outside_bounds = observed_value("outside-bounds", 0.25, 101.0);
        assert!(
            failure(observed_query(PathSpec::Full, vec![outside_bounds]))
                .contains("outside declared bounds")
        );

        let mut wrong_unit = observed_value("wrong-unit", 0.25, 20.0);
        wrong_unit.unit = Some("fahrenheit".to_owned());
        assert!(failure(observed_query(PathSpec::Full, vec![wrong_unit]))
            .contains("unit does not exactly match"));

        let mut wrong_evidence = observed_value("wrong-evidence", 0.25, 20.0);
        wrong_evidence.evidence_type = EvidenceType::Estimate;
        assert!(
            failure(observed_query(PathSpec::Full, vec![wrong_evidence]))
                .contains("requires observation or report evidence")
        );

        let mut missing_scope = observed_query(
            PathSpec::Full,
            vec![observed_value("missing-scope", 0.25, 20.0)],
        );
        missing_scope.access_scopes.clear();
        assert!(failure(missing_scope).contains("lacks an access scope"));

        assert!(failure(observed_query(
            PathSpec::Full,
            vec![observed_value("at-genesis", 0.0, 20.0)]
        ))
        .contains("0 < offset <= delta_time"));
        assert!(failure(observed_query(
            PathSpec::Full,
            vec![observed_value("too-late", 1.25, 20.0)]
        ))
        .contains("0 < offset <= delta_time"));
        assert!(failure(observed_query(
            PathSpec::Full,
            vec![observed_value("unaligned", 0.3, 20.0)]
        ))
        .contains("exactly reachable transition step boundary"));

        let mut backward =
            observed_query(PathSpec::Full, vec![observed_value("backward", 0.25, 20.0)]);
        backward.direction = TimeDirection::Backward;
        assert!(failure(backward).contains("require forward transition direction"));

        assert!(failure(observed_query(
            PathSpec::Full,
            vec![
                observed_value("duplicate", 0.25, 20.0),
                observed_value("duplicate", 0.75, 40.0),
            ]
        ))
        .contains("id must be unique"));
        assert!(failure(observed_query(
            PathSpec::Full,
            vec![
                observed_value("same-time-a", 0.25, 20.0),
                observed_value("same-time-b", 0.25, 21.0),
            ]
        ))
        .contains("multiple observations target sensor.temperature"));

        let mut conflicting_definition = observed_series_model();
        conflicting_definition.laws.push(LawDefinition {
            id: "illegal-temperature-writer".to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: "sensor.temperature".to_owned(),
                derivative: constant(1.0),
                innovation: None,
            },
            provenance: vec!["invalid observed-series fixture".to_owned()],
        });
        let conflicting = compile_model(conflicting_definition).unwrap();
        let conflicting_parent = conflicting.genesis_world("writer-conflict").unwrap();
        let conflict = roll_model_transition(
            &conflicting,
            &conflicting_parent,
            observed_query(
                PathSpec::Full,
                vec![observed_value("writer-conflict", 0.25, 20.0)],
            ),
        )
        .unwrap_err();
        assert!(conflict
            .0
            .contains("also written by law illegal-temperature-writer"));

        let mut intervention = observed_query(PathSpec::Full, vec![]);
        intervention.interventions.push(TimedIntervention {
            id: "not-an-observation".to_owned(),
            offset: 0.25,
            effect: StateEffect {
                target: "sensor.temperature".to_owned(),
                mode: EffectMode::Set,
                value: constant(20.0),
            },
            application: None,
        });
        assert!(failure(intervention).contains("use a timed observation"));
    }

    #[test]
    fn observed_series_commits_persists_replays_and_rejects_tampering() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": observed_series_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "observed-persist"}),
        )));
        let rolled = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({
                "world_id": "observed-persist",
                "query": observed_query(
                    PathSpec::Full,
                    vec![
                        observed_value("early", 0.25, 20.0),
                        observed_value("late", 0.75, 40.0),
                    ]
                )
            }),
        )));
        let candidate_hash = rolled["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({
                "candidate_hash": candidate_hash,
                "view": {
                    "requested_observables": ["sensor.temperature", "sensor.derived_heat"],
                    "access_scopes": ["sensor:private"]
                }
            }),
        )));

        let accepted = session.worlds.get("observed-persist").unwrap();
        assert_eq!(
            accepted.lineage_head.as_deref(),
            Some(candidate_hash.as_str())
        );
        assert_eq!(
            accepted.state["sensor.temperature"],
            ProcessValue::Scalar(40.0)
        );
        assert_eq!(
            accepted.state["sensor.derived_heat"],
            ProcessValue::Scalar(80.0)
        );
        assert_eq!(accepted.claims.len(), 2);

        let snapshot = session.snapshot();
        let encoded = serde_json::to_vec(&snapshot).unwrap();
        let persisted: PersistedSession = serde_json::from_slice(&encoded).unwrap();
        let mut restored = MachineSession::restore(persisted).unwrap();
        assert_eq!(restored.snapshot().worlds, snapshot.worlds);
        assert_eq!(restored.snapshot().candidates, snapshot.candidates);

        let carried = result(restored.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({
                "world_id": "observed-persist",
                "query": observed_query(PathSpec::Full, vec![])
            }),
        )));
        let samples = carried["candidate"]["path"]["samples"].as_array().unwrap();
        assert_eq!(samples.len(), 5);
        for sample in samples {
            assert_eq!(sample["state"]["sensor.temperature"]["value"], 40.0);
            assert_eq!(sample["state"]["sensor.derived_heat"]["value"], 80.0);
        }

        let mut query_tamper = snapshot.clone();
        let stored = query_tamper
            .candidates
            .iter_mut()
            .find(|stored| stored.record.candidate.candidate_hash == candidate_hash)
            .unwrap();
        stored.record.candidate.query.observations[0].value = ProcessValue::Scalar(21.0);
        let replay_failure = MachineSession::restore(query_tamper).unwrap_err();
        assert!(replay_failure
            .0
            .contains("does not replay from its frozen parent"));

        let mut claim_tamper = snapshot;
        let observed_claim = claim_tamper.worlds[0]
            .claims
            .values_mut()
            .find(|claim| claim.mode == Some(ClaimMode::Observed))
            .unwrap();
        observed_claim.evidence_cutoff = observed_claim.value_time.unwrap() - 0.01;
        let claim_failure = MachineSession::restore(claim_tamper).unwrap_err();
        assert!(claim_failure
            .0
            .contains("value_time cannot be after its evidence cutoff"));
    }

    #[test]
    fn initial_boundary_intervention_closes_relations_before_first_evolution_and_preserves_legacy_default(
    ) {
        let model = compile_model(intervention_timing_model()).unwrap();
        let parent = model.genesis_world("intervention-timing-world").unwrap();

        let legacy_query = intervention_timing_query(None);
        let legacy_json = serde_json::to_value(&legacy_query).unwrap();
        assert!(legacy_json["interventions"][0]
            .as_object()
            .unwrap()
            .get("application")
            .is_none());
        let legacy = roll_model_transition(&model, &parent, legacy_query).unwrap();
        assert_eq!(legacy.candidate.path.samples[0].state, parent.state);
        assert_close(
            scalar(&legacy.candidate.path.samples[1].state, "timing.stock").unwrap(),
            0.5,
        );
        assert_close(
            scalar(&legacy.candidate.path.samples[2].state, "timing.stock").unwrap(),
            1.5,
        );
        assert_eq!(legacy.candidate.marks.len(), 1);
        assert_eq!(legacy.candidate.marks[0].step, 1);
        assert_eq!(legacy.candidate.marks[0].time, 0.25);

        let initial_query =
            intervention_timing_query(Some(InterventionApplication::InitialBoundary));
        let initial_json = serde_json::to_value(&initial_query).unwrap();
        assert_eq!(
            initial_json["interventions"][0]["application"],
            "initial_boundary"
        );
        let initial = roll_model_transition(&model, &parent, initial_query).unwrap();
        assert_eq!(initial.candidate.path.samples[0].state, parent.state);
        assert_close(
            scalar(&initial.candidate.path.samples[1].state, "timing.control").unwrap(),
            2.0,
        );
        assert_close(
            scalar(&initial.candidate.path.samples[1].state, "timing.signal").unwrap(),
            4.0,
        );
        assert_close(
            scalar(&initial.candidate.path.samples[1].state, "timing.stock").unwrap(),
            1.0,
        );
        assert_close(
            scalar(&initial.candidate.path.samples[2].state, "timing.stock").unwrap(),
            2.0,
        );
        assert_eq!(initial.candidate.marks.len(), 1);
        assert_eq!(initial.candidate.marks[0].step, 0);
        assert_eq!(initial.candidate.marks[0].time, parent.time);
        assert_ne!(initial.candidate.query_hash, legacy.candidate.query_hash);
        assert_ne!(
            initial.candidate.dynamics_hash,
            legacy.candidate.dynamics_hash
        );
        assert_ne!(
            initial.candidate.trajectory_hash,
            legacy.candidate.trajectory_hash
        );
        assert_ne!(
            initial.candidate.candidate_hash,
            legacy.candidate.candidate_hash
        );

        let view = ViewSpec {
            requested_observables: vec![
                "timing.control".to_owned(),
                "timing.signal".to_owned(),
                "timing.stock".to_owned(),
            ],
            access_scopes: vec![],
            include_path: false,
        };
        let legacy_view = candidate_record_view(
            &model,
            &CandidateRecord {
                status: CandidateStatus::Pending,
                candidate: legacy.candidate,
                proposed_head: legacy.proposed_head,
            },
            view.clone(),
        )
        .unwrap();
        let legacy_query = legacy_view["candidate"]["query"].as_object().unwrap();
        let legacy_keys: BTreeSet<_> = legacy_query.keys().map(String::as_str).collect();
        let expected_legacy_keys = BTreeSet::from([
            "access_scopes",
            "delta_time",
            "direction",
            "intervention_count",
            "observation_count",
            "path",
            "precedence",
            "requested_observables",
            "roll_index",
            "schema",
            "selected_support_count",
            "semantic_resolution",
            "step_size",
            "temporal_resolution",
        ]);
        assert_eq!(legacy_keys, expected_legacy_keys);

        let initial_view = candidate_record_view(
            &model,
            &CandidateRecord {
                status: CandidateStatus::Pending,
                candidate: initial.candidate,
                proposed_head: initial.proposed_head,
            },
            view,
        )
        .unwrap();
        assert_eq!(
            initial_view["candidate"]["query"]["initial_boundary_intervention_count"],
            1
        );
        assert_eq!(
            initial_view["candidate"]["query"]
                .as_object()
                .unwrap()
                .len(),
            expected_legacy_keys.len() + 1
        );
    }

    #[test]
    fn initial_boundary_requires_offset_zero_and_persists_with_replay_validation() {
        let model = compile_model(intervention_timing_model()).unwrap();
        let parent = model.genesis_world("invalid-intervention-timing").unwrap();
        let mut invalid = intervention_timing_query(Some(InterventionApplication::InitialBoundary));
        invalid.interventions[0].offset = 0.25;
        let failure = roll_model_transition(&model, &parent, invalid).unwrap_err();
        assert!(failure
            .0
            .contains("application initial_boundary requires offset 0"));

        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": intervention_timing_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({
                "model_hash": model_hash,
                "world_id": "initial-boundary-persist"
            }),
        )));
        let rolled = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({
                "world_id": "initial-boundary-persist",
                "query": intervention_timing_query(Some(
                    InterventionApplication::InitialBoundary
                ))
            }),
        )));
        let candidate_hash = rolled["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();

        let snapshot = session.snapshot();
        let encoded = serde_json::to_vec(&snapshot).unwrap();
        let persisted: PersistedSession = serde_json::from_slice(&encoded).unwrap();
        let restored = MachineSession::restore(persisted).unwrap();
        let restored_candidate = restored
            .candidates
            .get(&candidate_hash)
            .unwrap()
            .record
            .candidate
            .clone();
        assert_eq!(
            restored_candidate.query.interventions[0].application,
            Some(InterventionApplication::InitialBoundary)
        );
        assert_eq!(restored_candidate.marks[0].step, 0);
        assert_eq!(restored_candidate.marks[0].time, 0.0);

        let mut tampered = snapshot;
        tampered
            .candidates
            .iter_mut()
            .find(|candidate| candidate.record.candidate.candidate_hash == candidate_hash)
            .unwrap()
            .record
            .candidate
            .query
            .interventions[0]
            .application = None;
        let failure = MachineSession::restore(tampered).unwrap_err();
        assert!(failure.0.contains("does not replay from its frozen parent"));
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-12,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn trajectory_summary_matches_an_analytic_linear_subinterval() {
        let model = compile_model(linear_trajectory_model()).unwrap();
        let parent = model.genesis_world("linear-world").unwrap();
        let full = roll_model_transition(
            &model,
            &parent,
            trajectory_query(PathSpec::Full, &["position"]),
        )
        .unwrap();
        let summary = summarize_model_trajectory(
            &model,
            &parent,
            &full.candidate,
            trajectory_summary_spec(0.125, 0.875, &["position"]),
        )
        .unwrap();
        let position = &summary.fields[0];
        assert_close(position.start, 1.25);
        assert_close(position.end, 2.75);
        assert_close(position.integral, 1.5);
        assert_close(position.time_mean, 2.0);
        assert_close(position.minimum, 1.25);
        assert_close(position.maximum, 2.75);
        assert_eq!(position.unit.as_deref(), Some("meter"));
        assert_eq!(position.integral_unit.as_deref(), Some("meter*second"));
        assert_eq!(
            position.uncertainty_boundary.source_process,
            ClaimUncertainty::StandardDeviation { value: 0.1 }
        );
        assert_eq!(summary.retention, PathSpec::Full);
        assert_eq!(summary.total_sample_count, 5);
        assert_eq!(summary.retained_sample_count, 5);
        validate_model_trajectory_summary(&model, &parent, &full.candidate, &summary).unwrap();

        let decimated = roll_model_transition(
            &model,
            &parent,
            trajectory_query(PathSpec::Decimated { every: 2 }, &["position"]),
        )
        .unwrap();
        let coarse = summarize_model_trajectory(
            &model,
            &parent,
            &decimated.candidate,
            trajectory_summary_spec(0.125, 0.875, &["position"]),
        )
        .unwrap();
        assert_eq!(
            full.candidate.candidate_hash,
            decimated.candidate.candidate_hash
        );
        assert_eq!(
            full.candidate.trajectory_hash,
            decimated.candidate.trajectory_hash
        );
        assert_ne!(summary.candidate_query_hash, coarse.candidate_query_hash);
        assert_ne!(summary.retained_path_hash, coarse.retained_path_hash);
        assert_ne!(summary.summary_hash, coarse.summary_hash);
        assert_eq!(coarse.retained_sample_count, 3);
        assert_close(coarse.fields[0].integral, 1.5);
        assert_close(coarse.fields[0].time_mean, 2.0);

        let mut backward_query = trajectory_query(PathSpec::Full, &["position"]);
        backward_query.direction = TimeDirection::Backward;
        let backward = roll_model_transition(&model, &parent, backward_query).unwrap();
        let chronological = summarize_model_trajectory(
            &model,
            &parent,
            &backward.candidate,
            trajectory_summary_spec(-0.875, -0.125, &["position"]),
        )
        .unwrap();
        assert_close(chronological.fields[0].start, -0.75);
        assert_close(chronological.fields[0].end, 0.75);
        assert_close(chronological.fields[0].integral, 0.0);
        assert_close(chronological.fields[0].time_mean, 0.0);
        assert_close(chronological.fields[0].minimum, -0.75);
        assert_close(chronological.fields[0].maximum, 0.75);
    }

    #[test]
    fn trajectory_summary_finds_interior_and_endpoint_extrema() {
        let model = compile_model(turning_trajectory_model()).unwrap();
        let parent = model.genesis_world("turning-world").unwrap();
        let rolled = roll_model_transition(
            &model,
            &parent,
            trajectory_query(PathSpec::Full, &["position", "velocity"]),
        )
        .unwrap();
        let summary = summarize_model_trajectory(
            &model,
            &parent,
            &rolled.candidate,
            trajectory_summary_spec(0.0, 1.0, &["velocity", "position"]),
        )
        .unwrap();
        assert_eq!(summary.fields[0].process_id, "position");
        let position = &summary.fields[0];
        assert_close(position.start, 0.0);
        assert_close(position.end, 0.25);
        assert_close(position.integral, 0.28125);
        assert_close(position.time_mean, 0.28125);
        assert_close(position.minimum, 0.0);
        assert_close(position.maximum, 0.375);

        let velocity = &summary.fields[1];
        assert_eq!(velocity.process_id, "velocity");
        assert_close(velocity.start, 1.0);
        assert_close(velocity.end, -1.0);
        assert_close(velocity.integral, 0.0);
        assert_close(velocity.time_mean, 0.0);
        assert_close(velocity.minimum, -1.0);
        assert_close(velocity.maximum, 1.0);
    }

    #[test]
    fn trajectory_summary_rejects_endpoint_retention_and_invalid_requests() {
        let model = compile_model(linear_trajectory_model()).unwrap();
        let parent = model.genesis_world("summary-errors").unwrap();
        let endpoint = roll_model_transition(
            &model,
            &parent,
            trajectory_query(PathSpec::Endpoint, &["position"]),
        )
        .unwrap();
        let failure = summarize_model_trajectory(
            &model,
            &parent,
            &endpoint.candidate,
            trajectory_summary_spec(0.0, 1.0, &["position"]),
        )
        .unwrap_err();
        assert!(failure
            .0
            .contains("endpoint-only retention is insufficient"));

        let full = roll_model_transition(
            &model,
            &parent,
            trajectory_query(PathSpec::Full, &["position"]),
        )
        .unwrap();
        let outside = summarize_model_trajectory(
            &model,
            &parent,
            &full.candidate,
            trajectory_summary_spec(-0.01, 0.5, &["position"]),
        )
        .unwrap_err();
        assert!(outside.0.contains("outside retained coverage"));
        let missing = summarize_model_trajectory(
            &model,
            &parent,
            &full.candidate,
            trajectory_summary_spec(0.0, 0.5, &["missing"]),
        )
        .unwrap_err();
        assert!(missing.0.contains("unknown process missing"));
        let reversed = summarize_model_trajectory(
            &model,
            &parent,
            &full.candidate,
            trajectory_summary_spec(0.5, 0.5, &["position"]),
        )
        .unwrap_err();
        assert!(reversed.0.contains("strictly less"));
    }

    #[test]
    fn trajectory_summary_is_replayable_tamper_evident_and_read_only() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": linear_trajectory_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "summary-world"}),
        )));
        let rolled = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({
                "world_id": "summary-world",
                "query": trajectory_query(PathSpec::Full, &["position"])
            }),
        )));
        let candidate_hash = rolled["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let before = serde_json::to_value(session.snapshot()).unwrap();
        let fields = serde_json::json!({
            "candidate_hash": candidate_hash,
            "trajectory_summary": trajectory_summary_spec(0.125, 0.875, &["position"])
        });
        let first =
            result(session.parse_and_execute(&command("summarize_trajectory", fields.clone())));
        let second = result(session.parse_and_execute(&command("summarize_trajectory", fields)));
        let after = serde_json::to_value(session.snapshot()).unwrap();
        assert_eq!(before, after);
        assert_eq!(first, second);

        let replayed: TrajectorySummary = serde_json::from_value(first).unwrap();
        let stored = session.candidates.get(&candidate_hash).unwrap();
        let model = session
            .models
            .get(&stored.record.candidate.model_hash)
            .unwrap();
        validate_model_trajectory_summary(
            model,
            &stored.parent,
            &stored.record.candidate,
            &replayed,
        )
        .unwrap();

        let mut tampered_summary = replayed.clone();
        tampered_summary.fields[0].maximum += 1.0;
        tampered_summary.summary_hash = trajectory_summary_hash(&tampered_summary).unwrap();
        let failure = validate_model_trajectory_summary(
            model,
            &stored.parent,
            &stored.record.candidate,
            &tampered_summary,
        )
        .unwrap_err();
        assert!(failure.0.contains("does not match"));

        let mut tampered_candidate = stored.record.candidate.clone();
        tampered_candidate.path.samples[1]
            .state
            .insert("position".to_owned(), ProcessValue::Scalar(99.0));
        let failure = summarize_model_trajectory(
            model,
            &stored.parent,
            &tampered_candidate,
            trajectory_summary_spec(0.125, 0.875, &["position"]),
        )
        .unwrap_err();
        assert!(failure.0.contains("canonical trajectory hash"));
    }

    #[test]
    fn view_and_access_metadata_do_not_change_dynamics_or_randomness() {
        let compiled = compile_model(test_model()).unwrap();
        let parent = compiled.genesis_world("world").unwrap();
        let baseline = roll_model_transition(&compiled, &parent, query(0, PathSpec::Full)).unwrap();
        let mut alternate_query = query(0, PathSpec::Full);
        alternate_query
            .requested_observables
            .push("family.pressure".to_owned());
        alternate_query
            .access_scopes
            .push("irrelevant-view-scope".to_owned());
        alternate_query.temporal_resolution = Some("metadata-only-fine".to_owned());
        alternate_query.semantic_resolution = Some("metadata-only-public".to_owned());
        alternate_query.selected_support = vec!["family.pressure".to_owned()];
        let alternate = roll_model_transition(&compiled, &parent, alternate_query).unwrap();

        assert_eq!(
            baseline.candidate.dynamics_hash,
            alternate.candidate.dynamics_hash
        );
        assert_ne!(
            baseline.candidate.query_hash,
            alternate.candidate.query_hash
        );
        assert_eq!(
            baseline.candidate.candidate_hash,
            alternate.candidate.candidate_hash
        );
        assert_eq!(
            baseline.proposed_head.world_hash,
            alternate.proposed_head.world_hash
        );
        assert_eq!(
            baseline.candidate.randomness.draw_set_hash,
            alternate.candidate.randomness.draw_set_hash
        );
        assert_eq!(
            baseline.candidate.trajectory_hash,
            alternate.candidate.trajectory_hash
        );
        assert_eq!(
            baseline.candidate.successor_state,
            alternate.candidate.successor_state
        );
        assert_eq!(
            baseline.candidate.successor_claims,
            alternate.candidate.successor_claims
        );
        assert_eq!(baseline.candidate.marks, alternate.candidate.marks);
    }

    #[test]
    fn oversized_transition_work_is_rejected_before_simulation() {
        let compiled = compile_model(test_model()).unwrap();
        let parent = compiled.genesis_world("world").unwrap();
        let mut oversized = query(0, PathSpec::Endpoint);
        oversized.step_size = 1.0 / (MAX_STEP_COUNT as f64 + 1.0);
        let failure = roll_model_transition(&compiled, &parent, oversized).unwrap_err();
        assert!(failure.0.contains("step count"));
        assert!(failure.0.contains("exceeds limit"));
    }

    #[test]
    fn expression_depth_and_query_cardinality_are_bounded_before_execution() {
        let mut definition = test_model();
        let mut expression = constant(0.0);
        for _ in 0..MAX_EXPRESSION_DEPTH {
            expression = ScalarExpression::Negate {
                value: Box::new(expression),
            };
        }
        let LawOperator::Evolution { derivative, .. } = &mut definition.laws[0].operator else {
            panic!("first sorted fixture law must be evolution");
        };
        *derivative = expression;
        let failure = compile_model(definition).unwrap_err();
        assert!(failure.0.contains("expression depth"));

        let compiled = compile_model(test_model()).unwrap();
        let parent = compiled.genesis_world("bounded-query").unwrap();
        let mut oversized = query(0, PathSpec::Endpoint);
        oversized.requested_observables =
            vec!["person.stress".to_owned(); MAX_QUERY_OBSERVABLES + 1];
        let failure = roll_model_transition(&compiled, &parent, oversized).unwrap_err();
        assert!(failure.0.contains("query exceeds"));
    }

    #[test]
    fn intervention_writes_and_epistemic_claims_enforce_independent_scopes() {
        let mut definition = test_model();
        definition
            .processes
            .iter_mut()
            .find(|process| process.id == "person.stress")
            .unwrap()
            .access_scopes = vec!["private-state".to_owned()];
        let model = compile_model(definition).unwrap();
        let parent = model.genesis_world("private-world").unwrap();
        let mut unauthorized = query(0, PathSpec::Endpoint);
        unauthorized.selected_support.clear();
        unauthorized.requested_observables.clear();
        unauthorized.interventions.push(TimedIntervention {
            id: "private-write".to_owned(),
            offset: 0.5,
            effect: StateEffect {
                target: "person.stress".to_owned(),
                mode: EffectMode::Set,
                value: constant(0.0),
            },
            application: None,
        });
        let failure = roll_model_transition(&model, &parent, unauthorized).unwrap_err();
        assert!(failure.0.contains("intervention private-write target"));

        let mut exfiltration = query(0, PathSpec::Endpoint);
        exfiltration.selected_support.clear();
        exfiltration.requested_observables = vec!["family.pressure".to_owned()];
        exfiltration.interventions.push(TimedIntervention {
            id: "private-read-public-write".to_owned(),
            offset: 0.5,
            effect: StateEffect {
                target: "family.pressure".to_owned(),
                mode: EffectMode::Set,
                value: process("person.stress"),
            },
            application: None,
        });
        let failure = roll_model_transition(&model, &parent, exfiltration).unwrap_err();
        assert!(failure
            .0
            .contains("intervention private-read-public-write input"));

        let mut definition = test_model();
        for law in &mut definition.laws {
            if let LawOperator::Epistemic { claim, .. } = &mut law.operator {
                claim.access_scopes = vec!["alice-beliefs".to_owned()];
            }
        }
        let model = compile_model(definition).unwrap();
        let parent = model.genesis_world("claim-world").unwrap();
        let rolled = roll_model_transition(&model, &parent, query(0, PathSpec::Endpoint)).unwrap();
        let record = CandidateRecord {
            status: CandidateStatus::Pending,
            candidate: rolled.candidate,
            proposed_head: rolled.proposed_head,
        };
        let public = candidate_record_view(
            &model,
            &record,
            ViewSpec {
                requested_observables: vec!["person.stress".to_owned()],
                access_scopes: vec![],
                include_path: false,
            },
        )
        .unwrap();
        assert_eq!(
            public["candidate"]["successor_claims"],
            serde_json::json!({})
        );
        let private = candidate_record_view(
            &model,
            &record,
            ViewSpec {
                requested_observables: vec!["person.stress".to_owned()],
                access_scopes: vec!["alice-beliefs".to_owned()],
                include_path: false,
            },
        )
        .unwrap();
        assert!(private["candidate"]["successor_claims"]["observer:stress"].is_object());
    }

    #[test]
    fn claim_evidence_never_arrives_from_the_worlds_future() {
        let mut definition = test_model();
        definition.initial_claims.push(Claim {
            id: "future-evidence".to_owned(),
            subject: "person.stress".to_owned(),
            value: ProcessValue::Scalar(0.2),
            uncertainty: ClaimUncertainty::Exact,
            evidence_type: EvidenceType::Observation,
            holder: "observer".to_owned(),
            evidence_cutoff: 1.0,
            provenance: vec!["unit-test".to_owned()],
            authority: ClaimAuthority {
                source: "unit-test".to_owned(),
                weight: 1.0,
            },
            mode: None,
            value_time: None,
            access_scopes: vec![],
        });
        let failure = compile_model(definition).unwrap_err();
        assert!(failure.0.contains("after genesis time 0"));

        let model = compile_model(test_model()).unwrap();
        let forward = roll_model_transition(
            &model,
            &model.genesis_world("causal-claims").unwrap(),
            query(0, PathSpec::Endpoint),
        )
        .unwrap();
        let mut backward = query(0, PathSpec::Endpoint);
        backward.direction = TimeDirection::Backward;
        let reconstructed =
            roll_model_transition(&model, &forward.proposed_head, backward).unwrap();
        assert!(reconstructed
            .candidate
            .successor_claims
            .values()
            .all(|claim| claim.evidence_cutoff <= reconstructed.candidate.end_time));
    }

    #[test]
    fn reroll_replaces_every_named_draw_without_changing_parent() {
        let compiled = compile_model(test_model()).unwrap();
        let parent = compiled.genesis_world("world").unwrap();
        let first =
            roll_model_transition(&compiled, &parent, query(0, PathSpec::Endpoint)).unwrap();
        let second =
            roll_model_transition(&compiled, &parent, query(1, PathSpec::Endpoint)).unwrap();
        assert_eq!(
            first.candidate.parent_world_hash,
            second.candidate.parent_world_hash
        );
        assert_ne!(
            first.candidate.randomness.draw_set_hash,
            second.candidate.randomness.draw_set_hash
        );
        assert_ne!(
            first.candidate.candidate_hash,
            second.candidate.candidate_hash
        );
        assert_eq!(parent.version, 0);
    }

    #[test]
    fn common_random_stream_pairs_only_matching_named_draws_on_the_same_schedule() {
        let model = compile_model(test_model()).unwrap();
        let parent = model.genesis_world("paired-world").unwrap();

        let mut baseline_query = query(0, PathSpec::Full);
        baseline_query.comparison_stream = Some("experiment-42-pair-a".to_owned());
        let baseline = roll_model_transition(&model, &parent, baseline_query.clone()).unwrap();

        let mut intervened_query = baseline_query.clone();
        intervened_query.interventions.push(TimedIntervention {
            id: "paired-stress-increase".to_owned(),
            offset: 0.5,
            effect: StateEffect {
                target: "person.stress".to_owned(),
                mode: EffectMode::Add,
                value: constant(0.1),
            },
            application: None,
        });
        let intervened = roll_model_transition(&model, &parent, intervened_query.clone()).unwrap();

        assert_eq!(
            baseline.candidate.randomness.policy,
            RandomnessPolicy::CommonRandomComparison
        );
        assert_eq!(
            baseline.candidate.randomness.comparison_stream.as_deref(),
            Some("experiment-42-pair-a")
        );
        assert_eq!(
            baseline.candidate.randomness.schedule_hash,
            intervened.candidate.randomness.schedule_hash
        );
        assert_eq!(
            baseline.candidate.randomness.draws,
            intervened.candidate.randomness.draws
        );
        assert_ne!(
            baseline.candidate.query_hash,
            intervened.candidate.query_hash
        );
        assert_ne!(
            baseline.candidate.dynamics_hash,
            intervened.candidate.dynamics_hash
        );
        assert_ne!(
            baseline.candidate.trajectory_hash,
            intervened.candidate.trajectory_hash
        );
        assert_ne!(baseline.candidate.path, intervened.candidate.path);
        assert_ne!(
            baseline.candidate.candidate_hash,
            intervened.candidate.candidate_hash
        );
        assert_ne!(
            baseline.proposed_head.world_hash,
            intervened.proposed_head.world_hash
        );

        let mut unpaired_baseline_query = baseline_query.clone();
        unpaired_baseline_query.comparison_stream = None;
        let unpaired_baseline =
            roll_model_transition(&model, &parent, unpaired_baseline_query).unwrap();
        let mut unpaired_intervened_query = intervened_query;
        unpaired_intervened_query.comparison_stream = None;
        let unpaired_intervened =
            roll_model_transition(&model, &parent, unpaired_intervened_query).unwrap();
        assert_eq!(
            unpaired_baseline.candidate.randomness.policy,
            RandomnessPolicy::CandidateBound
        );
        assert_ne!(
            unpaired_baseline.candidate.randomness.draws,
            unpaired_intervened.candidate.randomness.draws
        );

        let first_raw = |roll: &ModelRollResult| roll.candidate.randomness.draws[0].raw_hex.clone();
        let mut equivalent_grid_query = baseline_query.clone();
        equivalent_grid_query.step_size = 0.3;
        let equivalent_grid =
            roll_model_transition(&model, &parent, equivalent_grid_query).unwrap();
        assert_eq!(
            baseline.candidate.randomness.schedule_hash,
            equivalent_grid.candidate.randomness.schedule_hash
        );
        assert_eq!(
            baseline.candidate.randomness.draws,
            equivalent_grid.candidate.randomness.draws
        );
        assert_ne!(
            baseline.candidate.query_hash,
            equivalent_grid.candidate.query_hash
        );

        let mut different_schedule_query = baseline_query.clone();
        different_schedule_query.step_size = 0.5;
        let different_schedule =
            roll_model_transition(&model, &parent, different_schedule_query).unwrap();
        assert_ne!(
            baseline.candidate.randomness.schedule_hash,
            different_schedule.candidate.randomness.schedule_hash
        );
        assert_ne!(first_raw(&baseline), first_raw(&different_schedule));

        let mut different_stream_query = baseline_query.clone();
        different_stream_query.comparison_stream = Some("experiment-42-pair-b".to_owned());
        let different_stream =
            roll_model_transition(&model, &parent, different_stream_query).unwrap();
        assert_eq!(
            baseline.candidate.randomness.schedule_hash,
            different_stream.candidate.randomness.schedule_hash
        );
        assert_ne!(first_raw(&baseline), first_raw(&different_stream));

        let mut different_roll_query = baseline_query;
        different_roll_query.roll_index = 1;
        let different_roll = roll_model_transition(&model, &parent, different_roll_query).unwrap();
        assert_eq!(
            baseline.candidate.randomness.schedule_hash,
            different_roll.candidate.randomness.schedule_hash
        );
        assert_ne!(first_raw(&baseline), first_raw(&different_roll));
    }

    #[test]
    fn common_random_stream_persists_replays_and_is_tamper_evident() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "paired-persist"}),
        )));
        let mut paired_query = query(0, PathSpec::Full);
        paired_query.comparison_stream = Some("persistent-comparison".to_owned());
        let rolled = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "paired-persist", "query": paired_query}),
        )));
        assert_eq!(
            rolled["candidate"]["randomness"]["policy"],
            "common_random_comparison"
        );
        assert_eq!(
            rolled["candidate"]["randomness"]["comparison_stream"],
            "persistent-comparison"
        );
        assert!(rolled["candidate"]["randomness"]["schedule_hash"]
            .as_str()
            .is_some_and(|hash| hash.len() == 64));
        let candidate_hash = rolled["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": candidate_hash}),
        )));

        let snapshot = session.snapshot();
        let mut restored = MachineSession::restore(snapshot.clone()).unwrap();
        let inspected = result(restored.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({"candidate_hash": candidate_hash}),
        )));
        assert_eq!(inspected["status"], "committed");
        assert_eq!(
            inspected["candidate"]["randomness"]["comparison_stream"],
            "persistent-comparison"
        );
        assert_eq!(
            restored.worlds["paired-persist"].lineage_head.as_deref(),
            Some(candidate_hash.as_str())
        );

        let mut tampered_schedule = snapshot.clone();
        let stored = tampered_schedule
            .candidates
            .iter_mut()
            .find(|stored| stored.record.candidate.candidate_hash == candidate_hash)
            .unwrap();
        stored.record.candidate.randomness.schedule_hash = "0".repeat(64);
        let failure = MachineSession::restore(tampered_schedule).unwrap_err();
        assert!(failure.0.contains("does not replay from its frozen parent"));

        let mut tampered_stream = snapshot;
        let stored = tampered_stream
            .candidates
            .iter_mut()
            .find(|stored| stored.record.candidate.candidate_hash == candidate_hash)
            .unwrap();
        stored.record.candidate.query.comparison_stream = Some("different-comparison".to_owned());
        let failure = MachineSession::restore(tampered_stream).unwrap_err();
        assert!(failure.0.contains("does not replay from its frozen parent"));
    }

    #[test]
    fn comparison_stream_is_optional_bounded_and_omitted_by_default() {
        let model = compile_model(test_model()).unwrap();
        let parent = model.genesis_world("comparison-validation").unwrap();
        let ordinary_query = query(0, PathSpec::Endpoint);
        let encoded = serde_json::to_value(&ordinary_query).unwrap();
        assert!(!encoded
            .as_object()
            .unwrap()
            .contains_key("comparison_stream"));
        let ordinary = roll_model_transition(&model, &parent, ordinary_query).unwrap();
        assert_eq!(
            ordinary.candidate.query_hash,
            "20bc2b4d303e57b3abd6f7a93fb69f81dacb1735da34a7ada5507135fe786ec4"
        );
        assert_eq!(
            ordinary.candidate.randomness.policy,
            RandomnessPolicy::CandidateBound
        );
        assert_eq!(ordinary.candidate.randomness.comparison_stream, None);
        assert_eq!(ordinary.candidate.randomness.schedule_hash.len(), 64);

        let mut legacy_master = Sha256::new();
        legacy_master.update(b"life-sim-rust-model-master-key/v1\0");
        legacy_master.update(ordinary.candidate.seed.as_bytes());
        legacy_master.update([0]);
        legacy_master.update(parent.world_hash.as_bytes());
        legacy_master.update([0]);
        legacy_master.update(ordinary.candidate.dynamics_hash.as_bytes());
        legacy_master.update([0]);
        legacy_master.update(ordinary.candidate.roll_index.to_le_bytes());
        let legacy_master: [u8; 32] = legacy_master.finalize().into();
        let legacy_first = random_draw(
            legacy_master,
            "law:stress-drift:innovation:stress-innovation",
            0,
            0,
        );
        assert_eq!(ordinary.candidate.randomness.draws[0], legacy_first);

        let mut empty = query(0, PathSpec::Endpoint);
        empty.comparison_stream = Some("   ".to_owned());
        let failure = roll_model_transition(&model, &parent, empty).unwrap_err();
        assert!(failure.0.contains("comparison_stream must be nonempty"));

        let mut oversized = query(0, PathSpec::Endpoint);
        oversized.comparison_stream = Some("x".repeat(MAX_QUERY_STRING_BYTES + 1));
        let failure = roll_model_transition(&model, &parent, oversized).unwrap_err();
        assert!(failure.0.contains("comparison_stream must be nonempty"));
    }

    #[test]
    fn hazard_occurrence_uses_a_named_candidate_bound_draw() {
        let mut definition = test_model();
        definition.laws.push(LawDefinition {
            id: "certain-hazard".to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Occurrence {
                trigger: OccurrenceTrigger::Hazard {
                    rate: ScalarExpression::Add {
                        terms: vec![
                            constant(1_000_000.0),
                            ScalarExpression::Absolute {
                                value: Box::new(process("person.stress")),
                            },
                        ],
                    },
                },
                effects: vec![StateEffect {
                    target: "person.stress".to_owned(),
                    mode: EffectMode::Add,
                    value: constant(0.1),
                }],
                activates: vec![],
            },
            provenance: vec!["hazard-fixture".to_owned()],
        });
        definition.dependencies.push(DependencyEdge {
            id: "hazard-causes-stress".to_owned(),
            source: "person.stress".to_owned(),
            target: "person.stress".to_owned(),
            kind: DependencyKind::Causes,
            law_id: Some("certain-hazard".to_owned()),
        });
        let model = compile_model(definition).unwrap();
        let result = roll_model_transition(
            &model,
            &model.genesis_world("hazard").unwrap(),
            query(0, PathSpec::Endpoint),
        )
        .unwrap();
        assert!(result
            .candidate
            .marks
            .iter()
            .any(|mark| mark.source == "certain-hazard"));
        assert!(result
            .candidate
            .randomness
            .draws
            .iter()
            .any(|draw| draw.key.contains("certain-hazard:hazard")));
    }

    #[test]
    fn session_commit_is_atomic_and_stale_siblings_are_superseded() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let first = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        let second = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(1, PathSpec::Endpoint)}),
        )));
        let first_hash = first["candidate"]["candidate_hash"].as_str().unwrap();
        let second_hash = second["candidate"]["candidate_hash"].as_str().unwrap();
        let committed = result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": first_hash}),
        )));
        assert_eq!(committed["world_head"]["version"], 1);
        assert_eq!(
            committed["world_head"]["lineage_head"],
            committed["candidate"]["candidate"]["candidate_hash"]
        );
        let inspected = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({"candidate_hash": second_hash}),
        )));
        assert_eq!(inspected["status"], "superseded");
        let rejected_commit = session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": second_hash}),
        ));
        assert!(!rejected_commit.ok);
        assert_eq!(rejected_commit.error.unwrap().code, "conflict");
    }

    #[test]
    fn session_reroll_and_reject_leave_the_accepted_head_unchanged() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let genesis = result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let first = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        let first_hash = first["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let rerolled = result(session.parse_and_execute(&command(
            "reroll_candidate",
            serde_json::json!({"candidate_hash": first_hash}),
        )));
        assert_eq!(rerolled["candidate"]["roll_index"], 1);
        assert_eq!(
            rerolled["candidate"]["parent_world_hash"],
            first["candidate"]["parent_world_hash"]
        );
        assert_ne!(
            rerolled["candidate"]["randomness"]["draw_set_hash"],
            first["candidate"]["randomness"]["draw_set_hash"]
        );
        let original = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({"candidate_hash": first_hash}),
        )));
        assert_eq!(original["status"], "superseded");
        let rerolled_hash = rerolled["candidate"]["candidate_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "reject_candidate",
            serde_json::json!({"candidate_hash": rerolled_hash}),
        )));
        let unchanged = result(session.parse_and_execute(&command(
            "get_world",
            serde_json::json!({"world_id": "world"}),
        )));
        assert_eq!(unchanged["world_hash"], genesis["world_hash"]);
        assert_eq!(unchanged["version"], 0);
    }

    #[test]
    fn reroll_retry_cannot_demote_an_existing_committed_successor() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let original = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        let original_hash = original["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let successor = result(session.parse_and_execute(&command(
            "reroll_candidate",
            serde_json::json!({"candidate_hash": original_hash}),
        )));
        let successor_hash = successor["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let committed = result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": successor_hash}),
        )));
        let accepted_hash = committed["world_head"]["world_hash"].clone();

        let retry = result(session.parse_and_execute(&command(
            "reroll_candidate",
            serde_json::json!({"candidate_hash": original_hash}),
        )));
        assert_eq!(retry["status"], "committed");
        assert_eq!(retry["candidate"]["candidate_hash"], successor_hash);
        let inspected = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({"candidate_hash": successor_hash}),
        )));
        assert_eq!(inspected["status"], "committed");
        let head = result(session.parse_and_execute(&command(
            "get_world",
            serde_json::json!({"world_id": "world"}),
        )));
        assert_eq!(head["world_hash"], accepted_hash);
    }

    #[test]
    fn repeated_roll_preserves_status_and_path_is_only_a_response_view() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let endpoint = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        let candidate_hash = endpoint["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "reject_candidate",
            serde_json::json!({"candidate_hash": candidate_hash}),
        )));
        let repeated = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Full)}),
        )));
        assert_eq!(repeated["status"], "rejected");
        assert_eq!(repeated["retention_upgraded"], true);
        assert_eq!(repeated["candidate"]["candidate_hash"], candidate_hash);
        assert_eq!(
            repeated["candidate"]["path"]["samples"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        let stored = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({
                "candidate_hash": candidate_hash,
                "view": {"requested_observables": ["person.stress"], "include_path": true}
            }),
        )));
        assert_eq!(stored["status"], "rejected");
        assert_eq!(
            stored["candidate"]["path"]["samples"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        let endpoint_again = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        assert_eq!(endpoint_again["retention_upgraded"], false);
        let still_full = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({
                "candidate_hash": candidate_hash,
                "view": {"requested_observables": ["person.stress"], "include_path": true}
            }),
        )));
        assert_eq!(
            still_full["candidate"]["path"]["samples"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
    }

    #[test]
    fn reroll_to_an_existing_child_still_supersedes_the_source() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let source = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Full)}),
        )));
        let child = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(1, PathSpec::Endpoint)}),
        )));
        let source_hash = source["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let child_hash = child["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let rerolled = result(session.parse_and_execute(&command(
            "reroll_candidate",
            serde_json::json!({"candidate_hash": source_hash}),
        )));
        assert_eq!(rerolled["status"], "pending");
        assert_eq!(rerolled["retention_upgraded"], true);
        assert_eq!(rerolled["candidate"]["candidate_hash"], child_hash);
        let source_after = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({"candidate_hash": source_hash}),
        )));
        assert_eq!(source_after["status"], "superseded");
        let child_after = result(session.parse_and_execute(&command(
            "inspect_candidate",
            serde_json::json!({
                "candidate_hash": child_hash,
                "view": {"requested_observables": ["person.stress"], "include_path": true}
            }),
        )));
        assert_eq!(
            child_after["candidate"]["path"]["samples"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
    }

    #[test]
    fn reroll_cannot_create_a_new_candidate_from_a_stale_parent() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let stale = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(5, PathSpec::Endpoint)}),
        )));
        let accepted = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        let accepted_hash = accepted["candidate"]["candidate_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": accepted_hash}),
        )));
        let stale_hash = stale["candidate"]["candidate_hash"].as_str().unwrap();
        let response = session.parse_and_execute(&command(
            "reroll_candidate",
            serde_json::json!({"candidate_hash": stale_hash}),
        ));
        assert!(!response.ok);
        let failure = response.error.unwrap();
        assert_eq!(failure.code, "conflict");
        assert!(failure.message.contains("stale frozen parent"));
    }

    #[test]
    fn describe_exposes_exact_roles_edges_authority_and_execution_limits() {
        let response = crate::parse_and_execute(
            r#"{"schema":"life-sim-rust-command/v1","operation":"describe"}"#,
        );
        let description = result(response);
        assert_eq!(description["operator_roles"].as_array().unwrap().len(), 5);
        assert_eq!(
            description["edge_kinds"]["decomposition"],
            serde_json::json!([
                "contains",
                "physical_part",
                "membership_view",
                "semantic_subtype",
                "temporal_phase",
                "functional_refinement",
                "observational_partition"
            ])
        );
        assert_eq!(
            description["edge_kinds"]["dependency"],
            serde_json::json!(["derives", "causes", "constrains", "observes"])
        );
        assert_eq!(
            description["schemas"]["meaning_model"],
            MEANING_MODEL_SCHEMA
        );
        assert_eq!(
            description["schemas"]["trajectory_summary_query"],
            TRAJECTORY_SUMMARY_QUERY_SCHEMA
        );
        assert_eq!(
            description["schemas"]["trajectory_summary"],
            TRAJECTORY_SUMMARY_SCHEMA
        );
        assert_eq!(
            description["profile_compilation"]["profiles"],
            serde_json::json!([
                "story",
                "concept_scaffold",
                "change_arc_scaffold",
                "person",
                "person_scaffold",
                "thing_scaffold",
                "relationship_scaffold",
                "decision"
            ])
        );
        assert!(
            description["profile_compilation"]["change_arc_scaffold"]["number_rule"]
                .as_str()
                .unwrap()
                .contains("unweighted")
        );
        assert_eq!(
            description["profile_compilation"]["person_scaffold"]["levels"],
            serde_json::json!(["lifecycle", "processes"])
        );
        assert!(
            description["profile_compilation"]["person_scaffold"]["number_rule"]
                .as_str()
                .unwrap()
                .contains("separately named Cut")
        );
        assert!(
            description["profile_compilation"]["thing_scaffold"]["number_rule"]
                .as_str()
                .unwrap()
                .contains("explicit later openings")
        );
        assert!(
            description["profile_compilation"]["relationship_scaffold"]["number_rule"]
                .as_str()
                .unwrap()
                .contains("no default trust")
        );
        assert!(description["operations"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("summarize_trajectory")));
        assert!(description["operations"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("refine_genesis_world")));
        assert_eq!(
            description["execution_limits"]["max_query_observations"],
            MAX_QUERY_OBSERVATIONS
        );
        assert_eq!(
            description["execution_limits"]["max_observation_provenance"],
            MAX_OBSERVATION_PROVENANCE
        );
        assert_eq!(
            description["observation_ingestion"]["query_field"],
            "ModelTransitionSpec.observations"
        );
        assert_eq!(
            description["observation_ingestion"]["claim_mode"],
            "observed"
        );
        assert_eq!(
            description["observation_ingestion"]["evidence_types"],
            serde_json::json!(["observation", "report"])
        );
        assert_eq!(
            description["observation_ingestion"]["initial_value_at_offset_zero"],
            true
        );
        assert_eq!(
            description["schemas"]["random_schedule_fingerprint"],
            RANDOM_SCHEDULE_SCHEMA
        );
        assert_eq!(
            description["execution"]["randomness_policies"],
            serde_json::json!(["candidate_bound", "common_random_comparison"])
        );
        assert_eq!(
            description["execution"]["common_random_comparison"]["query_field"],
            "comparison_stream"
        );
        assert_eq!(
            description["execution"]["common_random_comparison"]["opt_in_only"],
            true
        );
        assert_eq!(
            description["execution"]["intervention_timing"]["query_field"],
            "TimedIntervention.application"
        );
        assert_eq!(
            description["execution"]["intervention_timing"]["default_when_absent"],
            "successor_boundary"
        );
        assert_eq!(
            description["execution"]["intervention_timing"]["initial_boundary_offset"],
            0
        );
        assert!(
            description["execution"]["intervention_timing"]["parent_sample"]
                .as_str()
                .unwrap()
                .contains("unchanged frozen parent")
        );
        assert!(
            description["execution"]["common_random_comparison"]["claim_boundary"]
                .as_str()
                .unwrap()
                .contains("not branch splicing")
        );
        assert_eq!(
            description["edge_kinds"]["abstract_relation"],
            serde_json::json!([
                "specialization",
                "constrains",
                "analogy",
                "opposition",
                "other"
            ])
        );
        assert_eq!(
            description["edge_kinds"]["physical_cut"],
            serde_json::json!(["parallel", "sequential"])
        );
        assert_eq!(
            description["edge_kinds"]["event_relation"],
            serde_json::json!(["contains", "causes", "enables", "prevents", "constrains", "other"])
        );
        assert_eq!(
            description["meaning_model"]["collections"],
            serde_json::json!([
                "concepts",
                "abstract_relations",
                "abstract_cuts",
                "referents",
                "encapsulation_cuts",
                "events",
                "event_relations",
                "event_referent_bindings",
                "physical_cuts",
                "realizations",
                "normalized_cuts",
                "context_roots",
                "temporal_cut_recompositions"
            ])
        );
        assert_eq!(
            description["meaning_model"]["event_referent_binding_targets"],
            serde_json::json!(["event", "process"])
        );
        assert_eq!(
            description["meaning_model"]["event_relation_semantics"]["execution"],
            "validated static causal claim; does not schedule events or create a law"
        );
        assert!(
            description["narrative_understanding_graph"]["model_anchor_kinds"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!("event_relation"))
        );
        assert_eq!(
            description["meaning_model"]["realization_purposes"],
            serde_json::json!(["define", "describe"])
        );
        assert_eq!(
            description["meaning_model"]["genesis_refinement_boundary"],
            "not automatic discovery, adaptive runtime opening, or post-history migration"
        );
        assert_eq!(
            description["execution"]["genesis_refinement"]["implemented"],
            true
        );
        assert_eq!(
            description["execution"]["genesis_refinement"]["operation"],
            "refine_genesis_world"
        );
        assert_eq!(
            description["execution_limits"]["max_meaning_model_records"],
            MAX_MEANING_MODEL_RECORDS
        );
        assert_eq!(
            description["execution_limits"]["max_trajectory_summary_work"],
            MAX_TRAJECTORY_SUMMARY_WORK
        );
        assert_eq!(description["authority"]["atomic_commit"], true);
        assert_eq!(
            description["authority"]["durable_across_restart"],
            "when --state-file or LIFE_SIM_STATE_FILE is configured"
        );
        assert_eq!(
            description["execution"]["non_scalar_values"],
            "validated_and_carried_but_not_numerically_updated"
        );
        assert_eq!(
            description["execution"]["decomposition_edges"],
            "schema-time acyclic structural lenses only; no numeric, causal, or world-time effect"
        );
        assert_eq!(
            description["execution"]["dynamic_membership"],
            "represent as a time-indexed process updated by a relation law, not as a membership_view edge"
        );
        assert_eq!(
            description["execution"]["partial_refinement_reconciliation"],
            "not implemented"
        );
    }

    #[test]
    fn typed_decomposition_kinds_round_trip_and_remain_structural_only() {
        let mut baseline = test_model();
        baseline.decomposition.clear();
        for law in &mut baseline.laws {
            if let LawOperator::Evolution { innovation, .. } = &mut law.operator {
                *innovation = None;
            }
        }
        let baseline = compile_model(baseline).unwrap();
        let baseline_roll = roll_model_transition(
            &baseline,
            &baseline.genesis_world("baseline").unwrap(),
            query(0, PathSpec::Endpoint),
        )
        .unwrap();

        for (wire_kind, kind) in decomposition_kinds() {
            assert_eq!(serde_json::to_value(kind).unwrap(), wire_kind);
            assert_eq!(
                serde_json::from_value::<DecompositionKind>(serde_json::json!(wire_kind)).unwrap(),
                kind
            );

            let mut model = test_model();
            for edge in &mut model.decomposition {
                edge.kind = kind;
            }
            for law in &mut model.laws {
                if let LawOperator::Evolution { innovation, .. } = &mut law.operator {
                    *innovation = None;
                }
            }
            let compiled = compile_model(model).unwrap();
            assert!(compiled
                .definition()
                .decomposition
                .iter()
                .all(|edge| edge.kind == kind));
            let roll = roll_model_transition(
                &compiled,
                &compiled.genesis_world(wire_kind).unwrap(),
                query(0, PathSpec::Endpoint),
            )
            .unwrap();
            assert_eq!(
                roll.candidate.successor_state,
                baseline_roll.candidate.successor_state
            );
        }

        assert!(serde_json::from_value::<DecompositionKind>(serde_json::json!("causes")).is_err());
    }

    #[test]
    fn typed_command_decode_errors_preserve_the_request_id() {
        let mut session = MachineSession::default();
        let response = session.parse_and_execute(
            r#"{"schema":"life-sim-rust-command/v1","request_id":"bad-model","operation":"validate_model","model":{"unexpected":true}}"#,
        );
        assert!(!response.ok);
        assert_eq!(response.request_id.as_deref(), Some("bad-model"));
        assert_eq!(response.error.unwrap().code, "invalid_json");

        let description = result(session.parse_and_execute(
            r#"{"schema":"life-sim-rust-command/v1","request_id":"still-live","operation":"describe"}"#,
        ));
        assert_eq!(description["engine"], "life-sim-engine");
    }

    #[test]
    fn genesis_refinement_preserves_old_canon_and_adds_authored_detail() {
        let base = genesis_refinement_base_model();
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": base.clone()}),
        )));
        let source_model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": source_model_hash, "world_id": "refined-world"}),
        )));
        let source_world = session.worlds["refined-world"].clone();

        let revision = additive_genesis_revision(&base, &source_model_hash, "temperature");
        let revised = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({"model": revision}),
        )));
        let target_model_hash = revised["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let refined = result(session.parse_and_execute(&command(
            "refine_genesis_world",
            serde_json::json!({
                "world_id": "refined-world",
                "model_hash": target_model_hash,
                "view": {
                    "requested_observables": ["person.stress", "world.temperature"]
                }
            }),
        )));

        assert_eq!(refined["boundary"], "genesis_only_authored_refinement");
        assert_eq!(refined["source_model_hash"], source_model_hash);
        assert_eq!(refined["target_model_hash"], target_model_hash);
        assert_eq!(refined["source_revision"], 0);
        assert_eq!(refined["target_revision"], 1);
        assert_eq!(refined["conservation"]["old_state_preserved"], true);
        assert_eq!(refined["conservation"]["old_claims_preserved"], true);
        assert_eq!(refined["records"]["preserved_records"]["processes"], 4);
        assert_eq!(refined["records"]["added_records"]["processes"], 1);
        assert_eq!(refined["records"]["added_records"]["decomposition"], 1);
        assert_eq!(refined["records"]["added_records"]["meaning.referents"], 1);
        assert_eq!(
            refined["records"]["preserved_records"]["meaning.event_relations"],
            1
        );
        assert_eq!(refined["world_head"]["version"], 0);
        assert_eq!(refined["world_head"]["time"], 0.0);
        assert_eq!(
            refined["world_head"]["state"]["person.stress"],
            serde_json::json!({"kind": "scalar", "value": 0.2})
        );
        assert_eq!(
            refined["world_head"]["state"]["world.temperature"],
            serde_json::json!({"kind": "scalar", "value": 1.0})
        );

        let accepted = &session.worlds["refined-world"];
        assert_eq!(accepted.world_id, source_world.world_id);
        assert_eq!(accepted.version, source_world.version);
        assert_eq!(accepted.time, source_world.time);
        assert_eq!(accepted.lineage_head, source_world.lineage_head);
        for (id, value) in &source_world.state {
            assert_eq!(accepted.state.get(id), Some(value));
        }
        for (id, claim) in &source_world.claims {
            assert_eq!(accepted.claims.get(id), Some(claim));
        }
        assert_eq!(
            accepted.state["world.temperature"],
            ProcessValue::Scalar(1.0)
        );
    }

    #[test]
    fn genesis_refinement_preserves_normalized_cuts_and_context_roots() {
        let mut base = genesis_refinement_base_model();
        let meaning = base.meaning_model.as_mut().unwrap();
        meaning.normalized_cuts.push(NormalizedCutDefinition {
            id: "outlook".to_owned(),
            parent_event_id: "trust-event".to_owned(),
            question: "Which comparison share is resolved?".to_owned(),
            unit: "comparison".to_owned(),
            answers: vec![
                NormalizedCutAnswer { key: "resolved".to_owned(), weight: 0.6 },
                NormalizedCutAnswer { key: "remainder".to_owned(), weight: 0.4 },
            ],
            conditioning: None,
            provenance: vec!["genesis refinement fixture".to_owned()],
        });
        meaning.context_roots.push(MeaningContextRootDefinition {
            event_id: "relationship-event".to_owned(),
            kind: MeaningContextRootKind::AcceptedWorld,
            provenance: vec!["genesis refinement fixture".to_owned()],
        });
        for event in &meaning.events {
            if event.id != "relationship-event" {
                meaning.event_relations.push(EventRelationDefinition {
                    id: format!("root-contains-{}", event.id),
                    source_event_id: "relationship-event".to_owned(),
                    target_event_id: event.id.clone(),
                    kind: EventRelationKind::Contains,
                    description: None,
                    uncertainty: ClaimUncertainty::Unknown,
                    provenance: vec!["genesis refinement fixture".to_owned()],
                    authority: None,
                });
            }
        }
        let compiled_base = compile_model(base).unwrap();
        let mut addition = additive_genesis_revision(compiled_base.definition(), &compiled_base.model_hash, "cut-addition");
        let mut extra_cut = addition.meaning_model.as_ref().unwrap().normalized_cuts[0].clone();
        extra_cut.id = "another-outlook".to_owned();
        addition.meaning_model.as_mut().unwrap().normalized_cuts.push(extra_cut);
        let audit = validate_monotonic_genesis_refinement(&compiled_base, &compile_model(addition).unwrap()).unwrap();
        assert_eq!(audit.preserved_records["meaning.normalized_cuts"], 1);
        assert_eq!(audit.added_records["meaning.normalized_cuts"], 1);
        assert_eq!(audit.preserved_records["meaning.context_roots"], 1);

        for variant in ["cut removed", "cut changed", "root removed", "root changed", "new nearest root"] {
            let mut revision = additive_genesis_revision(compiled_base.definition(), &compiled_base.model_hash, "invalid-cut-revision");
            let meaning = revision.meaning_model.as_mut().unwrap();
            match variant {
                "cut removed" => meaning.normalized_cuts.clear(),
                "cut changed" => {
                    meaning.normalized_cuts[0].answers[0].weight = 0.5;
                    meaning.normalized_cuts[0].answers[1].weight = 0.5;
                }
                "root removed" => meaning.context_roots.clear(),
                "root changed" => meaning.context_roots[0].kind = MeaningContextRootKind::Inner,
                _ => meaning.context_roots.push(MeaningContextRootDefinition {
                    event_id: "trust-event".to_owned(),
                    kind: MeaningContextRootKind::Inner,
                    provenance: vec!["genesis refinement fixture".to_owned()],
                }),
            }
            let compiled = compile_model(revision).unwrap();
            let failure = validate_monotonic_genesis_refinement(&compiled_base, &compiled).unwrap_err();
            assert!(failure.0.contains("genesis refinement"), "{variant}: {failure}");
        }
    }

    #[test]
    fn genesis_refinement_can_strengthen_but_not_weaken_semantic_coverage() {
        let mut base = genesis_refinement_base_model();
        base.meaning_model.as_mut().unwrap().semantic_coverage = Some(SemanticCoverageDefinition {
            mode: SemanticCoverageMode::Report,
            unresolved_events: vec![UnresolvedSemanticEvent {
                event_id: "repair-event".to_owned(),
                reason: "the fixture intentionally leaves repair semantics unresolved".to_owned(),
                provenance: vec!["genesis-refinement-fixture".to_owned()],
            }],
        });
        let compiled_base = compile_model(base).unwrap();

        let mut strict_revision = additive_genesis_revision(
            compiled_base.definition(),
            &compiled_base.model_hash,
            "strict-coverage",
        );
        strict_revision
            .meaning_model
            .as_mut()
            .unwrap()
            .semantic_coverage
            .as_mut()
            .unwrap()
            .mode = SemanticCoverageMode::Strict;
        let compiled_strict = compile_model(strict_revision).unwrap();
        let audit =
            validate_monotonic_genesis_refinement(&compiled_base, &compiled_strict).unwrap();
        assert_eq!(
            audit.preserved_records["meaning.semantic_coverage.unresolved_events"],
            1
        );

        let mut weakened_revision = additive_genesis_revision(
            compiled_strict.definition(),
            &compiled_strict.model_hash,
            "weakened-coverage",
        );
        weakened_revision
            .meaning_model
            .as_mut()
            .unwrap()
            .semantic_coverage
            .as_mut()
            .unwrap()
            .mode = SemanticCoverageMode::Report;
        let compiled_weakened = compile_model(weakened_revision).unwrap();
        let failure = validate_monotonic_genesis_refinement(&compiled_strict, &compiled_weakened)
            .unwrap_err();
        assert!(failure.0.contains("weakened strict semantic coverage"));
    }

    #[test]
    fn genesis_refinement_rejects_non_monotonic_model_changes() {
        let base = genesis_refinement_base_model();
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": base.clone()}),
        )));
        let source_model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": source_model_hash, "world_id": "non-monotonic"}),
        )));
        let original_world_hash = session.worlds["non-monotonic"].world_hash.clone();

        let mut revision = additive_genesis_revision(&base, &source_model_hash, "temperature");
        revision
            .processes
            .iter_mut()
            .find(|process| process.id == "person.stress")
            .unwrap()
            .initial_value = ProcessValue::Scalar(0.3);
        let revised = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({"model": revision}),
        )));
        let target_model_hash = revised["summary"]["model_hash"].as_str().unwrap();
        let response = session.parse_and_execute(&command(
            "refine_genesis_world",
            serde_json::json!({
                "world_id": "non-monotonic",
                "model_hash": target_model_hash
            }),
        ));
        assert!(!response.ok);
        let failure = response.error.unwrap();
        assert_eq!(failure.code, "invalid_request");
        assert!(failure
            .message
            .contains("changed existing processes record"));
        assert!(failure.message.contains("additions only"));
        assert_eq!(
            session.worlds["non-monotonic"].world_hash,
            original_world_hash
        );
        assert_eq!(
            session.worlds["non-monotonic"].model_hash,
            source_model_hash
        );
    }

    #[test]
    fn genesis_refinement_rejects_worlds_with_accepted_history() {
        let base = genesis_refinement_base_model();
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": base.clone()}),
        )));
        let source_model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": source_model_hash, "world_id": "advanced-world"}),
        )));
        let revision = additive_genesis_revision(&base, &source_model_hash, "temperature");
        let revised = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({"model": revision}),
        )));
        let target_model_hash = revised["summary"]["model_hash"].as_str().unwrap();

        let candidate = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({
                "world_id": "advanced-world",
                "query": query(0, PathSpec::Endpoint)
            }),
        )));
        let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": candidate_hash}),
        )));

        let response = session.parse_and_execute(&command(
            "refine_genesis_world",
            serde_json::json!({
                "world_id": "advanced-world",
                "model_hash": target_model_hash
            }),
        ));
        assert!(!response.ok);
        let failure = response.error.unwrap();
        assert_eq!(failure.code, "conflict");
        assert!(failure.message.contains("untouched genesis head"));
        assert!(failure
            .message
            .contains("use revise_world"));
        assert_eq!(session.worlds["advanced-world"].version, 1);
    }

    #[test]
    fn genesis_refinement_rejects_a_sibling_revision_after_acceptance() {
        let base = genesis_refinement_base_model();
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": base.clone()}),
        )));
        let source_model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": source_model_hash, "world_id": "sibling-world"}),
        )));

        let first = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({
                "model": additive_genesis_revision(&base, &source_model_hash, "temperature")
            }),
        )));
        let first_hash = first["summary"]["model_hash"].as_str().unwrap().to_owned();
        let sibling = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({
                "model": additive_genesis_revision(&base, &source_model_hash, "humidity")
            }),
        )));
        let sibling_hash = sibling["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();

        result(session.parse_and_execute(&command(
            "refine_genesis_world",
            serde_json::json!({"world_id": "sibling-world", "model_hash": first_hash}),
        )));
        let response = session.parse_and_execute(&command(
            "refine_genesis_world",
            serde_json::json!({"world_id": "sibling-world", "model_hash": sibling_hash}),
        ));
        assert!(!response.ok);
        let failure = response.error.unwrap();
        assert_eq!(failure.code, "conflict");
        assert!(failure.message.contains("direct next revision"));
        assert!(failure.message.contains("sibling"));
        assert_eq!(session.worlds["sibling-world"].model_hash, first_hash);
    }

    #[test]
    fn genesis_refinement_persists_across_restart() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let state_file = std::env::temp_dir().join(format!(
            "life-sim-genesis-refinement-{}-{nonce}.sqlite",
            std::process::id()
        ));
        assert!(!state_file.exists());
        let target_model_hash;
        {
            let base = genesis_refinement_base_model();
            let mut session = MachineSession::with_state_file(&state_file).unwrap();
            let registered = result(session.parse_and_execute(&command(
                "register_model",
                serde_json::json!({"model": base.clone()}),
            )));
            let source_model_hash = registered["summary"]["model_hash"]
                .as_str()
                .unwrap()
                .to_owned();
            result(session.parse_and_execute(&command(
                "create_world",
                serde_json::json!({"model_hash": source_model_hash, "world_id": "durable-refinement"}),
            )));
            let revised = result(session.parse_and_execute(&command(
                "revise_model",
                serde_json::json!({
                    "model": additive_genesis_revision(&base, &source_model_hash, "temperature")
                }),
            )));
            target_model_hash = revised["summary"]["model_hash"]
                .as_str()
                .unwrap()
                .to_owned();
            result(session.parse_and_execute(&command(
                "refine_genesis_world",
                serde_json::json!({
                    "world_id": "durable-refinement",
                    "model_hash": target_model_hash,
                    "view": {"requested_observables": ["world.temperature"]}
                }),
            )));
        }

        let mut restored = MachineSession::with_state_file(&state_file).unwrap();
        let world = result(restored.parse_and_execute(&command(
            "get_world",
            serde_json::json!({
                "world_id": "durable-refinement",
                "view": {"requested_observables": ["person.stress", "world.temperature"]}
            }),
        )));
        assert_eq!(world["model_hash"], target_model_hash);
        assert_eq!(world["model_revision"], 1);
        assert_eq!(world["version"], 0);
        assert_eq!(world["time"], 0.0);
        assert!(world["state"].get("person.stress").is_some());
        assert!(world["state"].get("world.temperature").is_some());
        fs::remove_file(&state_file).unwrap();
    }

    #[test]
    fn model_revision_is_hash_linked_and_can_add_a_dimension() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let previous = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut revision = test_model();
        revision.revision = ModelRevision {
            number: 1,
            previous_model_hash: Some(previous.clone()),
            reason: "add temperature dimension".to_owned(),
            provenance: vec!["unit-test-revision".to_owned()],
        };
        let mut temperature = scalar_process("world.temperature", 1.0);
        temperature.update_mode = ProcessUpdateMode::Observed;
        revision.processes.push(temperature);
        let revised = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({"model": revision}),
        )));
        assert_eq!(revised["summary"]["revision"]["number"], 1);
        assert_eq!(revised["summary"]["process_count"], 5);
        let replayed_root = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        assert_eq!(replayed_root["summary"]["model_hash"], previous);
    }

    #[test]
    fn revision_additions_require_support_and_dynamics_or_wiring() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let previous = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        let revision = |mut process: ProcessDefinition| {
            let mut model = test_model();
            model.revision = ModelRevision {
                number: 1,
                previous_model_hash: Some(previous.clone()),
                reason: "add a test process".to_owned(),
                provenance: vec!["unit-test-revision".to_owned()],
            };
            process.id = "world.new-process".to_owned();
            model.processes.push(process);
            model
        };

        let unwired = revision(scalar_process("placeholder", 0.0));
        let response = session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({"model": unwired}),
        ));
        assert!(!response.ok);
        assert!(response.error.unwrap().message.contains("static/observed"));

        let mut unsupported_process = scalar_process("placeholder", 0.0);
        unsupported_process.update_mode = ProcessUpdateMode::Static;
        unsupported_process.support.clear();
        let unsupported = revision(unsupported_process);
        let response = session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({"model": unsupported}),
        ));
        assert!(!response.ok);
        assert!(response
            .error
            .unwrap()
            .message
            .contains("support declaration"));
    }

    #[test]
    fn linked_dependencies_must_match_law_reads_and_targets() {
        let mut wrong_source = test_model();
        wrong_source.dependencies[0].source = "family.pressure".to_owned();
        let failure = compile_model(wrong_source).unwrap_err();
        assert!(failure.0.contains("is not read by law"));

        let mut wrong_target = test_model();
        wrong_target.dependencies[0].target = "family.pressure".to_owned();
        let failure = compile_model(wrong_target).unwrap_err();
        assert!(failure.0.contains("is not a target or subject"));
    }

    #[test]
    fn views_require_explicit_observables_and_enforce_scopes() {
        let mut definition = test_model();
        definition
            .processes
            .iter_mut()
            .find(|process| process.id == "person.stress")
            .unwrap()
            .access_scopes = vec!["private".to_owned()];
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": definition}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        let genesis = result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "private-world"}),
        )));
        assert_eq!(genesis["schema"], MODEL_VIEW_SCHEMA);
        assert_eq!(genesis["state"].as_object().unwrap().len(), 0);

        let denied = session.parse_and_execute(&command(
            "query_view",
            serde_json::json!({
                "world_id": "private-world",
                "view": {
                    "requested_observables": ["person.stress"],
                    "access_scopes": []
                }
            }),
        ));
        assert!(!denied.ok);
        assert!(denied.error.unwrap().message.contains("access scope"));

        let visible = result(session.parse_and_execute(&command(
            "query_view",
            serde_json::json!({
                "world_id": "private-world",
                "view": {
                    "requested_observables": ["person.stress"],
                    "access_scopes": ["private"]
                }
            }),
        )));
        assert_eq!(visible["state"].as_object().unwrap().len(), 1);
        assert!(visible["state"].get("person.stress").is_some());

        let mut private_query = query(0, PathSpec::Full);
        private_query.access_scopes = vec!["private".to_owned()];
        let candidate = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "private-world", "query": private_query}),
        )));
        assert_eq!(
            candidate["candidate"]["successor_state"]
                .as_object()
                .unwrap()
                .len(),
            1
        );
        for sample in candidate["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
        {
            assert_eq!(sample["state"].as_object().unwrap().len(), 1);
        }
        let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
        let alternate = result(session.parse_and_execute(&command(
            "query_view",
            serde_json::json!({
                "candidate_hash": candidate_hash,
                "view": {
                    "requested_observables": ["family.pressure"],
                    "access_scopes": [],
                    "include_path": false
                }
            }),
        )));
        assert_eq!(
            alternate["candidate"]["successor_state"]
                .as_object()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            alternate["candidate"]["path"]["samples"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        let encoded = serde_json::to_string(&alternate).unwrap();
        assert!(!encoded.contains("person.stress"));
        assert!(!encoded.contains("\"access_scopes\":[\"private\"]"));
        assert!(!alternate["candidate"]
            .as_object()
            .unwrap()
            .contains_key("seed"));
        assert!(!alternate["candidate"]["randomness"]
            .as_object()
            .unwrap()
            .contains_key("seed"));
        assert_eq!(
            alternate["candidate"]["query"]["requested_observables"],
            serde_json::json!(["family.pressure"])
        );
    }

    #[test]
    fn invalid_creation_view_does_not_leave_a_world_behind() {
        let mut definition = test_model();
        definition
            .processes
            .iter_mut()
            .find(|process| process.id == "person.stress")
            .unwrap()
            .access_scopes = vec!["private".to_owned()];
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": definition}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        let denied = session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({
                "model_hash": model_hash,
                "world_id": "ghost-world",
                "view": {
                    "requested_observables": ["person.stress"],
                    "access_scopes": []
                }
            }),
        ));
        assert!(!denied.ok);
        let absent = session.parse_and_execute(&command(
            "get_world",
            serde_json::json!({"world_id": "ghost-world"}),
        ));
        assert!(!absent.ok);
        assert_eq!(absent.error.unwrap().code, "not_found");
    }

    #[test]
    fn failed_durable_write_is_not_acknowledged_and_rolls_back_memory() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let missing_parent = std::env::temp_dir().join(format!(
            "life-sim-missing-parent-{}-{nonce}",
            std::process::id()
        ));
        assert!(!missing_parent.exists());
        let state_file = missing_parent.join("state.sqlite");
        let mut session = MachineSession::with_state_file(state_file).unwrap();
        let response = session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        ));
        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, "persistence_error");
        assert!(session.models.is_empty());
        assert!(session.worlds.is_empty());
        assert!(session.candidates.is_empty());
        assert!(!missing_parent.exists());
    }

    #[test]
    fn restart_rejects_a_status_tampered_accepted_lineage() {
        let mut session = MachineSession::default();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": test_model()}),
        )));
        let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
        )));
        let candidate = result(session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
        )));
        let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
        result(session.parse_and_execute(&command(
            "commit_candidate",
            serde_json::json!({"candidate_hash": candidate_hash}),
        )));

        let mut snapshot = session.snapshot();
        snapshot
            .candidates
            .iter_mut()
            .find(|candidate| candidate.record.candidate.candidate_hash == candidate_hash)
            .unwrap()
            .record
            .status = CandidateStatus::Pending;
        let failure = MachineSession::restore(snapshot).unwrap_err();
        assert!(failure.0.contains("accepted lineage"));
    }

    #[test]
    fn legacy_encoder_decoder_and_transition_trace_are_equivalent() {
        let legacy_definition = crate::RegistryDefinition {
            schema: crate::REGISTRY_SCHEMA.to_owned(),
            id: "legacy-equivalence".to_owned(),
            time_unit: "tick".to_owned(),
            fields: vec![
                crate::FieldDefinition {
                    id: "a".to_owned(),
                    minimum: -10.0,
                    maximum: 10.0,
                    initial_value: 1.0,
                    drift_target: 2.0,
                    drift_rate: 0.2,
                    noise_scale: 0.0,
                },
                crate::FieldDefinition {
                    id: "b".to_owned(),
                    minimum: -10.0,
                    maximum: 10.0,
                    initial_value: 0.0,
                    drift_target: 0.0,
                    drift_rate: 0.1,
                    noise_scale: 0.0,
                },
            ],
            couplings: vec![crate::CouplingDefinition {
                id: "a-to-b".to_owned(),
                source: "a".to_owned(),
                target: "b".to_owned(),
                mode: crate::CouplingMode::Difference,
                source_center: None,
                gain: 0.3,
            }],
        };
        let legacy = crate::compile_registry(legacy_definition.clone()).unwrap();
        let encoded = encode_legacy_registry_as_model(&legacy_definition).unwrap();
        let typed = compile_model(encoded).unwrap();
        let legacy_parent = legacy.genesis_parent().unwrap();
        let typed_parent = typed.genesis_world("equivalence").unwrap();
        let decoded_genesis = decode_model_world_as_legacy_parent(&legacy, &typed_parent).unwrap();
        assert_eq!(decoded_genesis.time, legacy_parent.time);
        assert_eq!(decoded_genesis.values, legacy_parent.values);

        let legacy_roll = crate::roll_transition(
            &legacy,
            &legacy_parent,
            crate::TransitionSpec {
                delta_time: 1.0,
                step_size: 0.25,
                events: vec![],
                seed: "deterministic".to_owned(),
                roll_index: 0,
            },
            PathSpec::Full,
        )
        .unwrap();
        let typed_roll = roll_model_transition(
            &typed,
            &typed_parent,
            ModelTransitionSpec {
                schema: MODEL_QUERY_SCHEMA.to_owned(),
                delta_time: 1.0,
                step_size: 0.25,
                seed: "deterministic".to_owned(),
                roll_index: 0,
                direction: TimeDirection::Forward,
                precedence: ResolutionPrecedence::Balanced,
                temporal_resolution: None,
                semantic_resolution: None,
                interventions: vec![],
                observations: vec![],
                comparison_stream: None,
                selected_support: vec![],
                requested_observables: vec![],
                access_scopes: vec![],
                path: PathSpec::Full,
            },
        )
        .unwrap();
        assert_eq!(
            legacy_roll.candidate.path.samples.len(),
            typed_roll.candidate.path.samples.len()
        );
        for (legacy_sample, typed_sample) in legacy_roll
            .candidate
            .path
            .samples
            .iter()
            .zip(&typed_roll.candidate.path.samples)
        {
            assert_eq!(legacy_sample.time, typed_sample.time);
            assert_eq!(
                legacy_sample.values,
                vec![
                    scalar(&typed_sample.state, "a").unwrap(),
                    scalar(&typed_sample.state, "b").unwrap()
                ]
            );
        }
        let decoded_successor =
            decode_model_world_as_legacy_parent(&legacy, &typed_roll.proposed_head).unwrap();
        assert_eq!(
            decoded_successor.values,
            legacy_roll.proposed_successor.values
        );
    }

    #[test]
    fn exact_coarse_fine_transition_commutes_with_aggregation() {
        let fine = compile_model(ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "fine".to_owned(),
            time_unit: "tick".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "commutation fixture".to_owned(),
                provenance: vec!["unit-test".to_owned()],
            },
            processes: vec![
                scalar_process("fine.a", 0.2),
                scalar_process("fine.b", 0.6),
                scalar_process("coarse.mean", 0.4),
            ],
            decomposition: vec![
                DecompositionEdge {
                    id: "mean-a".to_owned(),
                    parent: "coarse.mean".to_owned(),
                    child: "fine.a".to_owned(),
                    kind: DecompositionKind::Contains,
                },
                DecompositionEdge {
                    id: "mean-b".to_owned(),
                    parent: "coarse.mean".to_owned(),
                    child: "fine.b".to_owned(),
                    kind: DecompositionKind::Contains,
                },
            ],
            dependencies: vec![],
            laws: vec![
                LawDefinition {
                    id: "advance-a".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Evolution {
                        target: "fine.a".to_owned(),
                        derivative: constant(0.1),
                        innovation: None,
                    },
                    provenance: vec!["commutation-fixture".to_owned()],
                },
                LawDefinition {
                    id: "advance-b".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Evolution {
                        target: "fine.b".to_owned(),
                        derivative: constant(0.1),
                        innovation: None,
                    },
                    provenance: vec!["commutation-fixture".to_owned()],
                },
                LawDefinition {
                    id: "aggregate".to_owned(),
                    enabled: true,
                    activation: LawActivation::Always,
                    operator: LawOperator::Resolution {
                        target: "coarse.mean".to_owned(),
                        value: ScalarExpression::Multiply {
                            factors: vec![
                                constant(0.5),
                                ScalarExpression::Add {
                                    terms: vec![process("fine.a"), process("fine.b")],
                                },
                            ],
                        },
                        direction: ResolutionDirection::Aggregate,
                    },
                    provenance: vec!["commutation-fixture".to_owned()],
                },
            ],
            initial_claims: vec![],
            meaning_model: None,
        })
        .unwrap();
        let coarse = compile_model(ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: "coarse".to_owned(),
            time_unit: "tick".to_owned(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: "commutation fixture".to_owned(),
                provenance: vec!["unit-test".to_owned()],
            },
            processes: vec![scalar_process("coarse.mean", 0.4)],
            decomposition: vec![],
            dependencies: vec![],
            laws: vec![LawDefinition {
                id: "advance-mean".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "coarse.mean".to_owned(),
                    derivative: constant(0.1),
                    innovation: None,
                },
                provenance: vec!["commutation-fixture".to_owned()],
            }],
            initial_claims: vec![],
            meaning_model: None,
        })
        .unwrap();
        let mut fine_query = query(0, PathSpec::Endpoint);
        fine_query.step_size = 1.0;
        fine_query.precedence = ResolutionPrecedence::Fine;
        fine_query.selected_support.clear();
        fine_query.requested_observables.clear();
        let fine_result =
            roll_model_transition(&fine, &fine.genesis_world("fine").unwrap(), fine_query).unwrap();
        let mut coarse_query = query(0, PathSpec::Endpoint);
        coarse_query.step_size = 1.0;
        coarse_query.selected_support.clear();
        coarse_query.requested_observables.clear();
        let coarse_result = roll_model_transition(
            &coarse,
            &coarse.genesis_world("coarse").unwrap(),
            coarse_query,
        )
        .unwrap();
        assert_eq!(
            scalar(&fine_result.candidate.successor_state, "coarse.mean").unwrap(),
            scalar(&coarse_result.candidate.successor_state, "coarse.mean").unwrap()
        );
    }

    #[test]
    fn every_declared_process_type_is_validated_and_retained() {
        let mut model = test_model();
        model.processes.extend([
            ProcessDefinition {
                id: "typed.vector".to_owned(),
                value_type: ProcessType::Vector {
                    dimensions: 2,
                    bounds: NumericBounds {
                        minimum: -1.0,
                        maximum: 1.0,
                    },
                },
                initial_value: ProcessValue::Vector(vec![0.1, -0.1]),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                axes: vec![],
                unit: None,
                reference_frame: None,
                scale: BTreeMap::new(),
                support: vec!["two-dimensional".to_owned()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Static,
            },
            ProcessDefinition {
                id: "typed.category".to_owned(),
                value_type: ProcessType::Category {
                    variants: vec!["a".to_owned(), "b".to_owned()],
                },
                initial_value: ProcessValue::Category("a".to_owned()),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                axes: vec![],
                unit: None,
                reference_frame: None,
                scale: BTreeMap::new(),
                support: vec!["enumerated".to_owned()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Static,
            },
            ProcessDefinition {
                id: "typed.distribution".to_owned(),
                value_type: ProcessType::Distribution {
                    outcomes: vec!["a".to_owned(), "b".to_owned()],
                },
                initial_value: ProcessValue::Distribution(vec![0.25, 0.75]),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                axes: vec![],
                unit: None,
                reference_frame: None,
                scale: BTreeMap::new(),
                support: vec!["simplex".to_owned()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Static,
            },
            ProcessDefinition {
                id: "typed.graph".to_owned(),
                value_type: ProcessType::Graph,
                initial_value: ProcessValue::Graph(GraphValue {
                    nodes: vec!["a".to_owned(), "b".to_owned()],
                    edges: vec![GraphEdgeValue {
                        source: "a".to_owned(),
                        target: "b".to_owned(),
                        relation: "knows".to_owned(),
                    }],
                }),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                axes: vec![],
                unit: None,
                reference_frame: None,
                scale: BTreeMap::new(),
                support: vec!["finite graph".to_owned()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Static,
            },
            ProcessDefinition {
                id: "typed.pose".to_owned(),
                value_type: ProcessType::ObjectPose {
                    position_dimensions: 3,
                    orientation_dimensions: 4,
                },
                initial_value: ProcessValue::ObjectPose(ObjectPoseValue {
                    position: vec![0.0, 1.0, 2.0],
                    orientation: vec![1.0, 0.0, 0.0, 0.0],
                }),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                axes: vec![],
                unit: Some("meter".to_owned()),
                reference_frame: Some("room".to_owned()),
                scale: BTreeMap::new(),
                support: vec!["three-dimensional room".to_owned()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Static,
            },
        ]);
        let compiled = compile_model(model).unwrap();
        let world = compiled.genesis_world("all-types").unwrap();
        for id in [
            "family.pressure",
            "person.regime",
            "typed.vector",
            "typed.category",
            "typed.distribution",
            "typed.graph",
            "typed.pose",
        ] {
            assert!(world.state.contains_key(id));
        }
    }

    #[test]
    fn mixed_kind_cyclic_decomposition_and_non_scalar_laws_are_rejected() {
        let mut cyclic = test_model();
        cyclic.decomposition.push(DecompositionEdge {
            id: "cycle".to_owned(),
            parent: "person.stress".to_owned(),
            child: "family.pressure".to_owned(),
            kind: DecompositionKind::ObservationalPartition,
        });
        assert!(compile_model(cyclic).is_err());

        let mut wrong_type = test_model();
        wrong_type.laws.push(LawDefinition {
            id: "move-regime".to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: "person.regime".to_owned(),
                derivative: constant(1.0),
                innovation: None,
            },
            provenance: vec!["invalid-type-fixture".to_owned()],
        });
        assert!(compile_model(wrong_type).is_err());
    }
}
