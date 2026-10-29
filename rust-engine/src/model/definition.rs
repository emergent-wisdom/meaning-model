//! The model definition: the authored, serializable form of a model. Processes carry typed values; decomposition and
//! dependency edges relate them; claims record who asserts what; laws, written as scalar expressions, evolve, relate,
//! trigger, observe and resolve process values.
//!
//! A definition is plain data and checks nothing itself; compiling it (compile.rs) decides whether it is valid. Unknown
//! fields are refused when a definition is read, so what is stored is exactly what was authored.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::meaning::MeaningModelDefinition;

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
    pub(super) fn name(&self) -> &'static str {
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

    pub(super) fn scalar_bounds(&self) -> Option<&NumericBounds> {
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

/// The tags a value carries: what kind of claim it is. A guess is a value too; it is tagged, not withheld.
pub const VALUE_TAGS: [&str; 5] = ["source", "inferred", "invented", "exploring", "sketch"];

/// One process's states over time, held by one holder: numbers for a scalar process, defined states for a category
/// or regime process. The model's working surface. Values are an
/// account's estimates at their own times, past or present, not the state of a running world, so the engine does
/// not bind them to genesis or copy them into worlds; a process's initial value is its own field. Recording a time
/// again replaces its value; the model's revision history keeps the earlier one.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ValueSeries {
    pub id: String,
    pub process_id: String,
    pub holder: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub points: Vec<ValuePoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ValuePoint {
    pub time: f64,
    /// A number, for a scalar process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    /// One of the process's defined states, for a category or regime process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lower: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upper: Option<f64>,
    pub tag: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_series: Vec<ValueSeries>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meaning_model: Option<MeaningModelDefinition>,
}
