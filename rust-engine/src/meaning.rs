use super::{
    ClaimAuthority, ClaimUncertainty, ProcessDefinition, MAX_MODEL_IDENTIFIER_BYTES,
    MAX_QUERY_STRING_BYTES,
};
use crate::{error, finite, EngineResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const MEANING_MODEL_SCHEMA: &str = "life-sim-rust-meaning-model/v1";
pub const MAX_MEANING_MODEL_RECORDS: usize = 50_000;
pub const MAX_MEANING_CUT_CHILDREN: usize = 2_048;
pub const MAX_MEANING_EVENT_PROCESSES: usize = 2_048;
pub const MAX_MEANING_REALIZATION_BINDINGS: usize = 2_048;
pub const NORMALIZED_CUT_REMAINDER_KEY: &str = "remainder";
pub const NORMALIZED_CUT_SUM_TOLERANCE: f64 = 1e-9;
pub const MAX_MEANING_EVENT_DESCRIPTION_BYTES: usize = 64 * 1024;

/// An abstract schema in the optional Meaning Model layer.
///
/// The fields intentionally admit incomplete concepts. They make the known
/// parts of the concept schema addressable without pretending that an authored
/// string is already executable behavior.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ConceptDefinition {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub differentia: Vec<String>,
    #[serde(default)]
    pub boundary: Option<String>,
    #[serde(default)]
    pub state_schema: BTreeMap<String, String>,
    #[serde(default)]
    pub direction_families: Vec<String>,
    #[serde(default)]
    pub observation_methods: Vec<String>,
    pub provenance: Vec<String>,
}

/// A typed edge in the abstract concept graph. For specialization, `source`
/// is the more general parent and `target` is the more specific child.
/// Conceptual decomposition is represented only by `AbstractCutDefinition`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AbstractRelationKind {
    Specialization,
    Constrains,
    Analogy,
    Opposition,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AbstractRelationDefinition {
    pub id: String,
    pub source_concept_id: String,
    pub target_concept_id: String,
    pub kind: AbstractRelationKind,
    #[serde(default)]
    pub label: Option<String>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AbstractCutDefinition {
    pub id: String,
    pub parent_concept_id: String,
    pub child_concept_ids: Vec<String>,
    pub lens: String,
    #[serde(default)]
    pub query: Option<String>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EventInterval {
    pub start: f64,
    pub end: f64,
}

/// A stable model address for one bounded physical target. The optional
/// lifecycle event records the paper's partial `lambda_O` link; cuts remain
/// separate records so alternative lenses do not mutate or duplicate identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReferentDefinition {
    pub id: String,
    pub boundary: String,
    pub continuity_criterion: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    #[serde(default)]
    pub lifecycle_event_id: Option<String>,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
}

/// One typed child relation `(alpha_i, O_i, J_i, v_i, p_i)` in an
/// encapsulation cut. Relation names are an open, validated vocabulary so a
/// domain can distinguish material parts, members, regions, interfaces, and
/// other paper-compatible relations without changing the engine schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EncapsulationChildDefinition {
    pub relation: String,
    pub referent_id: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
}

/// A static, lens-relative opening of one referent. `residual` records the
/// unresolved `R_O` descriptively; it does not expand, aggregate, or execute.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EncapsulationCutDefinition {
    pub id: String,
    pub parent_referent_id: String,
    pub children: Vec<EncapsulationChildDefinition>,
    pub lens: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub residual: Option<String>,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
}

/// A semantic event may group existing executable processes or remain a static
/// description with no process bindings. Accepted world lineage supplies history; these semantic
/// fields declare its boundary, interval, state/observation support, and legacy
/// participant/substrate/region context annotations without adding execution
/// rules. `EventReferentBinding` is the authoritative typed referential link
/// store.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MeaningEventDefinition {
    pub id: String,
    pub boundary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    #[serde(default)]
    pub process_ids: Vec<String>,
    #[serde(default)]
    pub observation_process_ids: Vec<String>,
    #[serde(default)]
    pub participants: BTreeMap<String, String>,
    #[serde(default)]
    pub substrate: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    pub provenance: Vec<String>,
}

/// The semantic direction of one authored event-to-event relation. `contains`
/// gives unweighted parent-to-child process topology; the other built-in kinds
/// describe causal world structure. None schedules either event or adds an
/// executable law to the physical process substrate.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventRelationKind {
    Contains,
    Causes,
    Enables,
    Prevents,
    Constrains,
    Other,
}

/// One uncertainty- and provenance-bearing claim about how two declared
/// semantic events are related. Multiple records may connect the same event
/// pair so distinct authored claims do not lose their authority or evidence
/// history. `description` is optional for the built-in kinds and names the
/// semantics of `other`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EventRelationDefinition {
    pub id: String,
    pub source_event_id: String,
    pub target_event_id: String,
    pub kind: EventRelationKind,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
}

/// Selects the paper's `E`: either a semantic event-process grouping or one
/// executable state-bearing process directly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EventReferentBindingTarget {
    Event { event_id: String },
    Process { process_id: String },
}

/// The authoritative static `(E, eta, O, tau, I, p)` bridge between an event
/// or state-bearing process and a referent. `role` is `eta`; `binding_type` is
/// the independently typed `tau`. Neither field schedules or otherwise changes
/// event execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EventReferentBinding {
    pub id: String,
    pub target: EventReferentBindingTarget,
    pub role: String,
    pub referent_id: String,
    pub binding_type: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PhysicalCutKind {
    Parallel,
    Sequential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PhysicalCutDefinition {
    pub id: String,
    pub parent_event_id: String,
    /// Order is semantically significant for sequential cuts. Parallel child
    /// ids are canonicalized before hashing.
    pub child_event_ids: Vec<String>,
    pub kind: PhysicalCutKind,
    pub lens: String,
    #[serde(default)]
    pub query: Option<String>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RealizationPurpose {
    Define,
    Describe,
}

/// A typed, uncertainty-bearing bridge from one abstract concept to a tuple of
/// physical events and/or referents. `roles` retains the original event-role
/// JSON contract; `referent_roles` adds the referential half of the physical
/// model without conflating the two namespaces.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RealizationRecord {
    pub id: String,
    pub concept_id: String,
    pub purpose: RealizationPurpose,
    #[serde(default)]
    pub abstract_cut_id: Option<String>,
    #[serde(default)]
    pub physical_cut_id: Option<String>,
    #[serde(default)]
    pub roles: BTreeMap<String, String>,
    #[serde(default)]
    pub referent_roles: BTreeMap<String, String>,
    #[serde(default)]
    pub parameters: BTreeMap<String, serde_json::Value>,
    pub degree: f64,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub provenance: Vec<String>,
    pub viewpoint: String,
    #[serde(default)]
    pub authority: Option<ClaimAuthority>,
}

/// Controls whether declared semantic events are merely audited or must be
/// accounted for by the abstract plane. Coverage is derived wherever possible:
/// authors declare unresolved exceptions, not redundant event-to-concept links.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SemanticCoverageMode {
    Report,
    Strict,
}

/// An explicit, provenance-bearing acknowledgement that the current semantic
/// articulation does not yet assign a concept to one declared event. A later
/// immutable revision may retain this record while adding a realization that
/// supersedes it in the derived coverage classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UnresolvedSemanticEvent {
    pub event_id: String,
    pub reason: String,
    pub provenance: Vec<String>,
}

/// Optional audit/enforcement policy for declared semantic events. Direct
/// coverage comes from nonzero-degree realization roles. Inherited coverage
/// comes only from the parent and children of a physical cut explicitly named
/// by such a realization; unrelated and nested cuts are not traversed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SemanticCoverageDefinition {
    pub mode: SemanticCoverageMode,
    #[serde(default)]
    pub unresolved_events: Vec<UnresolvedSemanticEvent>,
}

/// One answer's share of a Cut's declared unit. Keys are stable within the Cut;
/// `remainder` is reserved and must be present even when its weight is zero.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NormalizedCutAnswer {
    pub key: String,
    pub weight: f64,
}

/// An exact local component address within this immutable model revision.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NormalizedCutCondition {
    pub cut_id: String,
    pub answer_key: String,
}

/// Static, question-relative allocation. Validation checks its accounting and
/// references; it does not establish answer exclusivity, calibration, temporal
/// mixture recomposition, or empirical validity of the authored question.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NormalizedCutDefinition {
    pub id: String,
    pub parent_event_id: String,
    pub question: String,
    pub unit: String,
    pub answers: Vec<NormalizedCutAnswer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditioning: Option<NormalizedCutCondition>,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MeaningContextRootKind {
    AcceptedWorld,
    Inner,
    Understanding,
    Document,
    Candidate,
}

/// Opt-in authority context on an existing Event. In a model declaring roots,
/// Contains edges alone carry context, and traversal stops at the nearest root.
/// This does not implement evidence disclosure or story-time access cutoffs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MeaningContextRootDefinition {
    pub event_id: String,
    pub kind: MeaningContextRootKind,
    pub provenance: Vec<String>,
}

/// Optional static semantic layer over the executable Life Simulation kernel.
/// Its collections default independently so producers can author either plane
/// incrementally while the entire layer remains an explicit opt-in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MeaningModelDefinition {
    pub schema: String,
    #[serde(default)]
    pub concepts: Vec<ConceptDefinition>,
    #[serde(default)]
    pub abstract_relations: Vec<AbstractRelationDefinition>,
    #[serde(default)]
    pub abstract_cuts: Vec<AbstractCutDefinition>,
    #[serde(default)]
    pub referents: Vec<ReferentDefinition>,
    #[serde(default)]
    pub encapsulation_cuts: Vec<EncapsulationCutDefinition>,
    #[serde(default)]
    pub events: Vec<MeaningEventDefinition>,
    /// Empty relations are omitted so a model authored before this optional
    /// collection was introduced retains its exact canonical JSON and hash.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub event_relations: Vec<EventRelationDefinition>,
    #[serde(default)]
    pub event_referent_bindings: Vec<EventReferentBinding>,
    #[serde(default)]
    pub physical_cuts: Vec<PhysicalCutDefinition>,
    #[serde(default)]
    pub realizations: Vec<RealizationRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semantic_coverage: Option<SemanticCoverageDefinition>,
    /// Omission preserves pre-extension canonical JSON and model hashes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub normalized_cuts: Vec<NormalizedCutDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_roots: Vec<MeaningContextRootDefinition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemanticCoverageSummary {
    pub mode: SemanticCoverageMode,
    pub event_count: usize,
    pub direct_count: usize,
    pub direct_event_ids: Vec<String>,
    pub inherited_count: usize,
    pub inherited_event_ids: Vec<String>,
    pub unresolved_count: usize,
    pub unresolved_event_ids: Vec<String>,
    pub orphaned_count: usize,
    pub orphaned_event_ids: Vec<String>,
    pub semantically_resolved_count: usize,
    pub semantically_accounted_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeaningModelSummary {
    pub schema: &'static str,
    pub concept_count: usize,
    pub concept_ids: Vec<String>,
    pub abstract_relation_count: usize,
    pub abstract_relation_ids: Vec<String>,
    pub abstract_cut_count: usize,
    pub abstract_cut_ids: Vec<String>,
    pub referent_count: usize,
    pub referent_ids: Vec<String>,
    pub encapsulation_cut_count: usize,
    pub encapsulation_cut_ids: Vec<String>,
    pub event_count: usize,
    pub event_ids: Vec<String>,
    pub event_relation_count: usize,
    pub event_relation_ids: Vec<String>,
    pub event_referent_binding_count: usize,
    pub event_referent_binding_ids: Vec<String>,
    pub physical_cut_count: usize,
    pub physical_cut_ids: Vec<String>,
    pub realization_count: usize,
    pub realization_ids: Vec<String>,
    pub normalized_cut_count: usize,
    pub normalized_cut_ids: Vec<String>,
    pub context_root_count: usize,
    pub context_root_event_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_coverage: Option<SemanticCoverageSummary>,
}

#[derive(Debug, Default)]
struct SemanticCoverageClassification {
    direct: BTreeSet<String>,
    inherited: BTreeSet<String>,
    unresolved: BTreeSet<String>,
    orphaned: BTreeSet<String>,
}

fn classify_semantic_coverage(
    meaning_model: &MeaningModelDefinition,
) -> SemanticCoverageClassification {
    let all_events = meaning_model
        .events
        .iter()
        .map(|event| event.id.clone())
        .collect::<BTreeSet<_>>();
    let physical_cuts = meaning_model
        .physical_cuts
        .iter()
        .map(|cut| (cut.id.as_str(), cut))
        .collect::<BTreeMap<_, _>>();
    let mut direct = BTreeSet::new();
    let mut cut_members = BTreeSet::new();

    for realization in &meaning_model.realizations {
        if realization.degree <= 0.0 {
            continue;
        }
        direct.extend(realization.roles.values().cloned());
        if let Some(cut_id) = realization.physical_cut_id.as_deref() {
            if let Some(cut) = physical_cuts.get(cut_id) {
                cut_members.insert(cut.parent_event_id.clone());
                cut_members.extend(cut.child_event_ids.iter().cloned());
            }
        }
    }

    direct.retain(|event_id| all_events.contains(event_id));
    cut_members.retain(|event_id| all_events.contains(event_id));
    let inherited = cut_members
        .difference(&direct)
        .cloned()
        .collect::<BTreeSet<_>>();
    let declared_unresolved = meaning_model
        .semantic_coverage
        .as_ref()
        .into_iter()
        .flat_map(|coverage| coverage.unresolved_events.iter())
        .map(|record| record.event_id.clone())
        .collect::<BTreeSet<_>>();
    let unresolved = declared_unresolved
        .difference(&direct)
        .filter(|event_id| !inherited.contains(*event_id))
        .cloned()
        .collect::<BTreeSet<_>>();
    let accounted = direct
        .union(&inherited)
        .cloned()
        .collect::<BTreeSet<_>>()
        .union(&unresolved)
        .cloned()
        .collect::<BTreeSet<_>>();
    let orphaned = all_events
        .difference(&accounted)
        .cloned()
        .collect::<BTreeSet<_>>();

    SemanticCoverageClassification {
        direct,
        inherited,
        unresolved,
        orphaned,
    }
}

impl MeaningModelDefinition {
    pub fn summary(&self) -> MeaningModelSummary {
        let semantic_coverage = self.semantic_coverage.as_ref().map(|coverage| {
            let classification = classify_semantic_coverage(self);
            let semantically_resolved_count = classification
                .direct
                .len()
                .saturating_add(classification.inherited.len());
            let semantically_accounted_count =
                semantically_resolved_count.saturating_add(classification.unresolved.len());
            SemanticCoverageSummary {
                mode: coverage.mode,
                event_count: self.events.len(),
                direct_count: classification.direct.len(),
                direct_event_ids: classification.direct.into_iter().collect(),
                inherited_count: classification.inherited.len(),
                inherited_event_ids: classification.inherited.into_iter().collect(),
                unresolved_count: classification.unresolved.len(),
                unresolved_event_ids: classification.unresolved.into_iter().collect(),
                orphaned_count: classification.orphaned.len(),
                orphaned_event_ids: classification.orphaned.into_iter().collect(),
                semantically_resolved_count,
                semantically_accounted_count,
            }
        });
        MeaningModelSummary {
            schema: MEANING_MODEL_SCHEMA,
            concept_count: self.concepts.len(),
            concept_ids: self.concepts.iter().map(|item| item.id.clone()).collect(),
            abstract_relation_count: self.abstract_relations.len(),
            abstract_relation_ids: self
                .abstract_relations
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            abstract_cut_count: self.abstract_cuts.len(),
            abstract_cut_ids: self
                .abstract_cuts
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            referent_count: self.referents.len(),
            referent_ids: self.referents.iter().map(|item| item.id.clone()).collect(),
            encapsulation_cut_count: self.encapsulation_cuts.len(),
            encapsulation_cut_ids: self
                .encapsulation_cuts
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            event_count: self.events.len(),
            event_ids: self.events.iter().map(|item| item.id.clone()).collect(),
            event_relation_count: self.event_relations.len(),
            event_relation_ids: self
                .event_relations
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            event_referent_binding_count: self.event_referent_bindings.len(),
            event_referent_binding_ids: self
                .event_referent_bindings
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            physical_cut_count: self.physical_cuts.len(),
            physical_cut_ids: self
                .physical_cuts
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            realization_count: self.realizations.len(),
            realization_ids: self
                .realizations
                .iter()
                .map(|item| item.id.clone())
                .collect(),
            normalized_cut_count: self.normalized_cuts.len(),
            normalized_cut_ids: self.normalized_cuts.iter().map(|item| item.id.clone()).collect(),
            context_root_count: self.context_roots.len(),
            context_root_event_ids: self.context_roots.iter().map(|item| item.event_id.clone()).collect(),
            semantic_coverage,
        }
    }
}

pub(super) fn normalize_meaning_model(meaning_model: &mut MeaningModelDefinition) {
    meaning_model.concepts.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model
        .abstract_relations
        .sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.abstract_cuts.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.referents.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model
        .encapsulation_cuts
        .sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.events.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model
        .event_relations
        .sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model
        .event_referent_bindings
        .sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.physical_cuts.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.realizations.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.normalized_cuts.sort_by(|a, b| a.id.cmp(&b.id));
    meaning_model.context_roots.sort_by(|a, b| a.event_id.cmp(&b.event_id));
    for cut in &mut meaning_model.normalized_cuts {
        cut.answers.sort_by(|a, b| a.key.cmp(&b.key));
        for answer in &mut cut.answers {
            if answer.weight == 0.0 {
                answer.weight = 0.0; // Canonicalize signed zero without changing any allocation.
            }
        }
    }
    if let Some(coverage) = &mut meaning_model.semantic_coverage {
        coverage
            .unresolved_events
            .sort_by(|a, b| a.event_id.cmp(&b.event_id));
    }
    for cut in &mut meaning_model.abstract_cuts {
        cut.child_concept_ids.sort();
    }
    for cut in &mut meaning_model.encapsulation_cuts {
        cut.children.sort_by(|a, b| {
            a.referent_id
                .cmp(&b.referent_id)
                .then_with(|| a.relation.cmp(&b.relation))
                .then_with(|| match (&a.interval, &b.interval) {
                    (None, None) => std::cmp::Ordering::Equal,
                    (None, Some(_)) => std::cmp::Ordering::Less,
                    (Some(_), None) => std::cmp::Ordering::Greater,
                    (Some(left), Some(right)) => left
                        .start
                        .total_cmp(&right.start)
                        .then_with(|| left.end.total_cmp(&right.end)),
                })
        });
    }
    for event in &mut meaning_model.events {
        event.process_ids.sort();
        event.observation_process_ids.sort();
    }
    for cut in &mut meaning_model.physical_cuts {
        if cut.kind == PhysicalCutKind::Parallel {
            cut.child_event_ids.sort();
        }
    }
}

fn validate_identifier(value: &str, label: &str) -> EngineResult<()> {
    if value.trim().is_empty() || value.len() > MAX_MODEL_IDENTIFIER_BYTES {
        return Err(error(format!("{label} must be nonempty and bounded")));
    }
    Ok(())
}

fn validate_text(value: &str, label: &str) -> EngineResult<()> {
    if value.trim().is_empty() || value.len() > MAX_QUERY_STRING_BYTES {
        return Err(error(format!("{label} must be nonempty and bounded")));
    }
    Ok(())
}

fn validate_optional_text(value: Option<&str>, label: &str) -> EngineResult<()> {
    if let Some(value) = value {
        validate_text(value, label)?;
    }
    Ok(())
}

fn validate_text_set(values: &[String], label: &str) -> EngineResult<()> {
    let mut unique = BTreeSet::new();
    for value in values {
        validate_text(value, label)?;
        if !unique.insert(value.as_str()) {
            return Err(error(format!("{label} values must be unique")));
        }
    }
    Ok(())
}

fn validate_provenance(values: &[String], label: &str) -> EngineResult<()> {
    if values.is_empty() {
        return Err(error(format!("{label} requires nonempty provenance")));
    }
    for value in values {
        validate_text(value, &format!("{label} provenance"))?;
    }
    Ok(())
}

fn validate_interval(interval: &EventInterval, label: &str) -> EngineResult<()> {
    finite(interval.start, &format!("{label} start"))?;
    finite(interval.end, &format!("{label} end"))?;
    if interval.end < interval.start {
        return Err(error(format!("{label} end precedes start")));
    }
    Ok(())
}

fn interval_contains(container: &EventInterval, scoped: &EventInterval) -> bool {
    container.start <= scoped.start && scoped.end <= container.end
}

fn intervals_overlap(left: &EventInterval, right: &EventInterval) -> bool {
    left.start <= right.end && right.start <= left.end
}

fn validate_authority(authority: Option<&ClaimAuthority>, label: &str) -> EngineResult<()> {
    if let Some(authority) = authority {
        validate_text(&authority.source, &format!("{label} source"))?;
        finite(authority.weight, &format!("{label} weight"))?;
        if !(0.0..=1.0).contains(&authority.weight) {
            return Err(error(format!("{label} weight must be in [0,1]")));
        }
    }
    Ok(())
}

fn validate_dag<'a>(
    nodes: &BTreeSet<&'a str>,
    edges: &[(&'a str, &'a str)],
    label: &str,
) -> EngineResult<()> {
    let mut adjacency: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut indegree: BTreeMap<&str, usize> = nodes.iter().map(|node| (*node, 0)).collect();
    for (parent, child) in edges {
        adjacency.entry(parent).or_default().push(child);
        *indegree
            .get_mut(child)
            .expect("meaning graph references were validated") += 1;
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
                    .expect("meaning graph references were validated");
                *degree -= 1;
                if *degree == 0 {
                    ready.push_back(child);
                }
            }
        }
    }
    if visited != nodes.len() {
        return Err(error(format!("{label} must be acyclic")));
    }
    Ok(())
}

fn validate_event_contexts<'a>(
    meaning_model: &'a MeaningModelDefinition,
    events: &BTreeMap<&'a str, &'a MeaningEventDefinition>,
) -> EngineResult<BTreeMap<&'a str, &'a str>> {
    if meaning_model.context_roots.is_empty() {
        return Ok(BTreeMap::new());
    }
    let mut roots = BTreeSet::new();
    for root in &meaning_model.context_roots {
        validate_identifier(&root.event_id, "context root event id")?;
        if !events.contains_key(root.event_id.as_str()) {
            return Err(error(format!("context root names unknown event {}", root.event_id)));
        }
        if !roots.insert(root.event_id.as_str()) {
            return Err(error(format!("duplicate context root event {}", root.event_id)));
        }
        validate_provenance(&root.provenance, &format!("context root {}", root.event_id))?;
    }

    let mut parents: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut edges = Vec::new();
    let nodes: BTreeSet<&str> = events.keys().copied().collect();
    let mut indegree: BTreeMap<&str, usize> = nodes.iter().map(|node| (*node, 0)).collect();
    for relation in &meaning_model.event_relations {
        if relation.kind != EventRelationKind::Contains {
            continue;
        }
        let parent = relation.source_event_id.as_str();
        let child = relation.target_event_id.as_str();
        // Event-relation endpoint existence is checked before this function.
        if let (Some(parent_interval), Some(child_interval)) =
            (&events[parent].interval, &events[child].interval)
        {
            if !interval_contains(parent_interval, child_interval) {
                return Err(error(format!(
                    "contains relation {} child interval exceeds parent event interval",
                    relation.id
                )));
            }
        }
        parents.entry(child).or_default().push(parent);
        children.entry(parent).or_default().push(child);
        *indegree.get_mut(child).expect("validated event endpoint") += 1;
        edges.push((parent, child));
    }
    // Root declarations stop context lookup, but may not hide containment cycles.
    validate_dag(&nodes, &edges, "context containment graph")?;
    let mut ready: VecDeque<&str> = indegree.iter()
        .filter_map(|(node, degree)| (*degree == 0).then_some(*node)).collect();
    let mut contexts = BTreeMap::new();
    while let Some(event_id) = ready.pop_front() {
        let context = if roots.contains(event_id) {
            event_id
        } else {
            let event_parents = parents.get(event_id).ok_or_else(|| error(format!(
                "event {event_id} has an ancestry path without a declared context root"
            )))?;
            let context = contexts[event_parents[0]];
            if event_parents.iter().any(|parent| contexts[parent] != context) {
                return Err(error(format!(
                    "event {event_id} has conflicting nearest context roots"
                )));
            }
            context
        };
        contexts.insert(event_id, context);
        if let Some(event_children) = children.get(event_id) {
            for child in event_children {
                let degree = indegree.get_mut(child).expect("validated event endpoint");
                *degree -= 1;
                if *degree == 0 {
                    ready.push_back(child);
                }
            }
        }
    }
    Ok(contexts)
}

fn validate_normalized_cuts<'a>(
    meaning_model: &'a MeaningModelDefinition,
    event_ids: &BTreeSet<&'a str>,
    event_contexts: &BTreeMap<&'a str, &'a str>,
) -> EngineResult<()> {
    let mut cuts = BTreeMap::new();
    for cut in &meaning_model.normalized_cuts {
        validate_identifier(&cut.id, "normalized cut id")?;
        if cuts.insert(cut.id.as_str(), cut).is_some() {
            return Err(error(format!("duplicate normalized cut id {}", cut.id)));
        }
        validate_identifier(&cut.parent_event_id, &format!("normalized cut {} parent event id", cut.id))?;
        if !event_ids.contains(cut.parent_event_id.as_str()) {
            return Err(error(format!(
                "normalized cut {} names unknown parent event {}", cut.id, cut.parent_event_id
            )));
        }
        validate_text(&cut.question, &format!("normalized cut {} question", cut.id))?;
        validate_text(&cut.unit, &format!("normalized cut {} unit", cut.id))?;
        validate_provenance(&cut.provenance, &format!("normalized cut {}", cut.id))?;
        if cut.answers.is_empty() || cut.answers.len() > MAX_MEANING_CUT_CHILDREN {
            return Err(error(format!(
                "normalized cut {} requires 1..={MAX_MEANING_CUT_CHILDREN} answers including remainder", cut.id
            )));
        }
        let mut keys = BTreeSet::new();
        let mut total = 0.0;
        for answer in &cut.answers {
            validate_identifier(&answer.key, &format!("normalized cut {} answer key", cut.id))?;
            if !keys.insert(answer.key.as_str()) {
                return Err(error(format!("normalized cut {} has duplicate answer key {}", cut.id, answer.key)));
            }
            finite(answer.weight, &format!("normalized cut {} answer {} weight", cut.id, answer.key))?;
            if answer.weight < 0.0 {
                return Err(error(format!("normalized cut {} answer {} weight must be nonnegative", cut.id, answer.key)));
            }
            total += answer.weight;
        }
        if !keys.contains(NORMALIZED_CUT_REMAINDER_KEY) {
            return Err(error(format!("normalized cut {} requires explicit remainder answer", cut.id)));
        }
        if !total.is_finite() || (total - 1.0).abs() > NORMALIZED_CUT_SUM_TOLERANCE {
            return Err(error(format!(
                "normalized cut {} weights must sum to one within {NORMALIZED_CUT_SUM_TOLERANCE}; got {total}", cut.id
            )));
        }
    }
    let mut edges = Vec::new();
    for cut in &meaning_model.normalized_cuts {
        if let Some(condition) = &cut.conditioning {
            validate_identifier(&condition.cut_id, &format!("normalized cut {} conditioning cut id", cut.id))?;
            validate_identifier(&condition.answer_key, &format!("normalized cut {} conditioning answer key", cut.id))?;
            let enclosing = cuts.get(condition.cut_id.as_str()).ok_or_else(|| error(format!(
                "normalized cut {} conditions on unknown cut {}", cut.id, condition.cut_id
            )))?;
            if !enclosing.answers.iter().any(|answer| answer.key == condition.answer_key) {
                return Err(error(format!(
                    "normalized cut {} conditions on unknown answer {} in cut {}", cut.id, condition.answer_key, condition.cut_id
                )));
            }
            if !event_contexts.is_empty()
                && event_contexts[cut.parent_event_id.as_str()] != event_contexts[enclosing.parent_event_id.as_str()]
            {
                return Err(error(format!("normalized cut {} conditioning crosses context roots", cut.id)));
            }
            edges.push((enclosing.id.as_str(), cut.id.as_str()));
        }
    }
    let nodes = cuts.keys().copied().collect();
    validate_dag(&nodes, &edges, "normalized cut conditioning graph")
}

pub(super) fn validate_meaning_model(
    meaning_model: &MeaningModelDefinition,
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    if meaning_model.schema != MEANING_MODEL_SCHEMA {
        return Err(error(format!(
            "unsupported meaning model schema {}; expected {MEANING_MODEL_SCHEMA}",
            meaning_model.schema
        )));
    }
    if meaning_model.concepts.is_empty()
        && meaning_model.referents.is_empty()
        && meaning_model.events.is_empty()
    {
        return Err(error(
            "enabled meaning_model must contain at least one concept, referent, or event",
        ));
    }
    let record_count = [
        meaning_model.concepts.len(),
        meaning_model.abstract_relations.len(),
        meaning_model.abstract_cuts.len(),
        meaning_model.referents.len(),
        meaning_model.encapsulation_cuts.len(),
        meaning_model.events.len(),
        meaning_model.event_relations.len(),
        meaning_model.event_referent_bindings.len(),
        meaning_model.physical_cuts.len(),
        meaning_model.realizations.len(),
        meaning_model.normalized_cuts.len(),
        meaning_model.context_roots.len(),
        meaning_model
            .semantic_coverage
            .as_ref()
            .map_or(0, |coverage| coverage.unresolved_events.len()),
    ]
    .into_iter()
    .try_fold(0usize, |total, count| total.checked_add(count))
    .ok_or_else(|| error("meaning model record count overflow"))?;
    if record_count > MAX_MEANING_MODEL_RECORDS {
        return Err(error(format!(
            "meaning model has {record_count} records; limit is {MAX_MEANING_MODEL_RECORDS}"
        )));
    }

    let mut concept_ids = BTreeSet::new();
    for concept in &meaning_model.concepts {
        validate_identifier(&concept.id, "concept id")?;
        if !concept_ids.insert(concept.id.as_str()) {
            return Err(error(format!("duplicate concept id {}", concept.id)));
        }
        validate_optional_text(
            concept.label.as_deref(),
            &format!("concept {} label", concept.id),
        )?;
        validate_optional_text(
            concept.boundary.as_deref(),
            &format!("concept {} boundary", concept.id),
        )?;
        validate_text_set(
            &concept.differentia,
            &format!("concept {} differentia", concept.id),
        )?;
        validate_text_set(
            &concept.direction_families,
            &format!("concept {} direction families", concept.id),
        )?;
        validate_text_set(
            &concept.observation_methods,
            &format!("concept {} observation methods", concept.id),
        )?;
        for (dimension, value_type) in &concept.state_schema {
            validate_identifier(
                dimension,
                &format!("concept {} state dimension", concept.id),
            )?;
            validate_text(value_type, &format!("concept {} state type", concept.id))?;
        }
        validate_provenance(&concept.provenance, &format!("concept {}", concept.id))?;
    }

    let mut referent_ids = BTreeSet::new();
    let mut referents = BTreeMap::new();
    for referent in &meaning_model.referents {
        validate_identifier(&referent.id, "referent id")?;
        if !referent_ids.insert(referent.id.as_str()) {
            return Err(error(format!("duplicate referent id {}", referent.id)));
        }
        validate_text(
            &referent.boundary,
            &format!("referent {} boundary", referent.id),
        )?;
        validate_text(
            &referent.continuity_criterion,
            &format!("referent {} continuity criterion", referent.id),
        )?;
        if let Some(interval) = &referent.interval {
            validate_interval(interval, &format!("referent {} interval", referent.id))?;
        }
        super::validate_uncertainty(
            &referent.uncertainty,
            &format!("referent {} uncertainty", referent.id),
        )?;
        validate_provenance(&referent.provenance, &format!("referent {}", referent.id))?;
        validate_authority(
            referent.authority.as_ref(),
            &format!("referent {} authority", referent.id),
        )?;
        referents.insert(referent.id.as_str(), referent);
    }

    let mut event_ids = BTreeSet::new();
    let mut events = BTreeMap::new();
    for event in &meaning_model.events {
        validate_identifier(&event.id, "event id")?;
        if !event_ids.insert(event.id.as_str()) {
            return Err(error(format!("duplicate event id {}", event.id)));
        }
        validate_text(&event.boundary, &format!("event {} boundary", event.id))?;
        if let Some(description) = &event.description {
            if description.trim().is_empty() || description.len() > MAX_MEANING_EVENT_DESCRIPTION_BYTES {
                return Err(error(format!(
                    "event {} description must be nonempty and at most {MAX_MEANING_EVENT_DESCRIPTION_BYTES} bytes",
                    event.id
                )));
            }
        }
        if event.process_ids.len() > MAX_MEANING_EVENT_PROCESSES
            || event.observation_process_ids.len() > MAX_MEANING_EVENT_PROCESSES
        {
            return Err(error(format!(
                "event {} process collection exceeds {MAX_MEANING_EVENT_PROCESSES}",
                event.id
            )));
        }
        if let Some(interval) = &event.interval {
            validate_interval(interval, &format!("event {} interval", event.id))?;
        }
        let mut grouped_processes = BTreeSet::new();
        for process_id in &event.process_ids {
            validate_identifier(process_id, &format!("event {} process id", event.id))?;
            if !processes.contains_key(process_id) {
                return Err(error(format!(
                    "event {} names unknown process {process_id}",
                    event.id
                )));
            }
            if !grouped_processes.insert(process_id.as_str()) {
                return Err(error(format!(
                    "event {} process ids must be unique",
                    event.id
                )));
            }
        }
        let mut observation_processes = BTreeSet::new();
        for process_id in &event.observation_process_ids {
            validate_identifier(
                process_id,
                &format!("event {} observation process id", event.id),
            )?;
            if !processes.contains_key(process_id) {
                return Err(error(format!(
                    "event {} names unknown observation process {process_id}",
                    event.id
                )));
            }
            if !observation_processes.insert(process_id.as_str()) {
                return Err(error(format!(
                    "event {} observation process ids must be unique",
                    event.id
                )));
            }
        }
        for (role, participant) in &event.participants {
            validate_identifier(role, &format!("event {} participant role", event.id))?;
            validate_identifier(
                participant,
                &format!("event {} participant binding", event.id),
            )?;
        }
        validate_optional_text(
            event.substrate.as_deref(),
            &format!("event {} substrate", event.id),
        )?;
        validate_optional_text(
            event.region.as_deref(),
            &format!("event {} region", event.id),
        )?;
        validate_provenance(&event.provenance, &format!("event {}", event.id))?;
        events.insert(event.id.as_str(), event);
    }

    for referent in &meaning_model.referents {
        if let Some(event_id) = &referent.lifecycle_event_id {
            validate_identifier(
                event_id,
                &format!("referent {} lifecycle event id", referent.id),
            )?;
            let event = events.get(event_id.as_str()).ok_or_else(|| {
                error(format!(
                    "referent {} names unknown lifecycle event {event_id}",
                    referent.id
                ))
            })?;
            if let (Some(referent_interval), Some(event_interval)) =
                (&referent.interval, &event.interval)
            {
                if !intervals_overlap(referent_interval, event_interval) {
                    return Err(error(format!(
                        "referent {} lifecycle event interval does not overlap its identity interval",
                        referent.id
                    )));
                }
            }
        }
    }

    let mut event_relation_ids = BTreeSet::new();
    for relation in &meaning_model.event_relations {
        validate_identifier(&relation.id, "event relation id")?;
        if !event_relation_ids.insert(relation.id.as_str()) {
            return Err(error(format!(
                "duplicate event relation id {}",
                relation.id
            )));
        }
        validate_identifier(
            &relation.source_event_id,
            &format!("event relation {} source event id", relation.id),
        )?;
        validate_identifier(
            &relation.target_event_id,
            &format!("event relation {} target event id", relation.id),
        )?;
        if relation.source_event_id == relation.target_event_id {
            return Err(error(format!(
                "event relation {} must connect distinct events",
                relation.id
            )));
        }
        if !event_ids.contains(relation.source_event_id.as_str()) {
            return Err(error(format!(
                "event relation {} names unknown source event {}",
                relation.id, relation.source_event_id
            )));
        }
        if !event_ids.contains(relation.target_event_id.as_str()) {
            return Err(error(format!(
                "event relation {} names unknown target event {}",
                relation.id, relation.target_event_id
            )));
        }
        validate_optional_text(
            relation.description.as_deref(),
            &format!("event relation {} description", relation.id),
        )?;
        if relation.kind == EventRelationKind::Other && relation.description.is_none() {
            return Err(error(format!(
                "event relation {} kind other requires a description",
                relation.id
            )));
        }
        super::validate_uncertainty(
            &relation.uncertainty,
            &format!("event relation {} uncertainty", relation.id),
        )?;
        validate_provenance(
            &relation.provenance,
            &format!("event relation {}", relation.id),
        )?;
        validate_authority(
            relation.authority.as_ref(),
            &format!("event relation {} authority", relation.id),
        )?;
    }

    let event_contexts = validate_event_contexts(meaning_model, &events)?;
    validate_normalized_cuts(meaning_model, &event_ids, &event_contexts)?;

    let mut relation_ids = BTreeSet::new();
    let mut abstract_edges = Vec::new();
    for relation in &meaning_model.abstract_relations {
        validate_identifier(&relation.id, "abstract relation id")?;
        if !relation_ids.insert(relation.id.as_str()) {
            return Err(error(format!(
                "duplicate abstract relation id {}",
                relation.id
            )));
        }
        if relation.source_concept_id == relation.target_concept_id
            || !concept_ids.contains(relation.source_concept_id.as_str())
            || !concept_ids.contains(relation.target_concept_id.as_str())
        {
            return Err(error(format!(
                "abstract relation {} has invalid concept references",
                relation.id
            )));
        }
        match (relation.kind, relation.label.as_deref()) {
            (AbstractRelationKind::Other, Some(label)) => {
                validate_text(label, &format!("abstract relation {} label", relation.id))?;
            }
            (AbstractRelationKind::Other, None) => {
                return Err(error(format!(
                    "abstract relation {} kind other requires a label",
                    relation.id
                )));
            }
            (_, Some(_)) => {
                return Err(error(format!(
                    "abstract relation {} label is only valid for kind other",
                    relation.id
                )));
            }
            (_, None) => {}
        }
        validate_provenance(
            &relation.provenance,
            &format!("abstract relation {}", relation.id),
        )?;
        if relation.kind == AbstractRelationKind::Specialization {
            abstract_edges.push((
                relation.source_concept_id.as_str(),
                relation.target_concept_id.as_str(),
            ));
        }
    }

    let mut abstract_cut_ids = BTreeSet::new();
    let mut abstract_cuts = BTreeMap::new();
    for cut in &meaning_model.abstract_cuts {
        validate_identifier(&cut.id, "abstract cut id")?;
        if !abstract_cut_ids.insert(cut.id.as_str()) {
            return Err(error(format!("duplicate abstract cut id {}", cut.id)));
        }
        if !concept_ids.contains(cut.parent_concept_id.as_str()) {
            return Err(error(format!(
                "abstract cut {} names unknown parent concept {}",
                cut.id, cut.parent_concept_id
            )));
        }
        if !(2..=MAX_MEANING_CUT_CHILDREN).contains(&cut.child_concept_ids.len()) {
            return Err(error(format!(
                "abstract cut {} must contain 2..={MAX_MEANING_CUT_CHILDREN} child concepts",
                cut.id
            )));
        }
        let mut children = BTreeSet::new();
        for child in &cut.child_concept_ids {
            if child == &cut.parent_concept_id
                || !concept_ids.contains(child.as_str())
                || !children.insert(child.as_str())
            {
                return Err(error(format!(
                    "abstract cut {} has invalid child concepts",
                    cut.id
                )));
            }
            abstract_edges.push((cut.parent_concept_id.as_str(), child.as_str()));
        }
        validate_text(&cut.lens, &format!("abstract cut {} lens", cut.id))?;
        validate_optional_text(
            cut.query.as_deref(),
            &format!("abstract cut {} query", cut.id),
        )?;
        validate_provenance(&cut.provenance, &format!("abstract cut {}", cut.id))?;
        abstract_cuts.insert(cut.id.as_str(), cut);
    }
    validate_dag(&concept_ids, &abstract_edges, "abstract structural graph")?;

    let mut encapsulation_cut_ids = BTreeSet::new();
    for cut in &meaning_model.encapsulation_cuts {
        validate_identifier(&cut.id, "encapsulation cut id")?;
        if !encapsulation_cut_ids.insert(cut.id.as_str()) {
            return Err(error(format!("duplicate encapsulation cut id {}", cut.id)));
        }
        let parent = referents
            .get(cut.parent_referent_id.as_str())
            .ok_or_else(|| {
                error(format!(
                    "encapsulation cut {} names unknown parent referent {}",
                    cut.id, cut.parent_referent_id
                ))
            })?;
        if cut.children.is_empty() || cut.children.len() > MAX_MEANING_CUT_CHILDREN {
            return Err(error(format!(
                "encapsulation cut {} must contain 1..={MAX_MEANING_CUT_CHILDREN} children",
                cut.id
            )));
        }
        let mut children = BTreeSet::new();
        for child in &cut.children {
            validate_text(
                &child.relation,
                &format!("encapsulation cut {} child relation", cut.id),
            )?;
            validate_identifier(
                &child.referent_id,
                &format!("encapsulation cut {} child referent id", cut.id),
            )?;
            let child_referent = referents.get(child.referent_id.as_str()).ok_or_else(|| {
                error(format!(
                    "encapsulation cut {} names unknown child referent {}",
                    cut.id, child.referent_id
                ))
            })?;
            if child.referent_id == cut.parent_referent_id {
                return Err(error(format!(
                    "encapsulation cut {} has a self-referential child",
                    cut.id
                )));
            }
            if let Some(interval) = &child.interval {
                validate_interval(
                    interval,
                    &format!(
                        "encapsulation cut {} child {} interval",
                        cut.id, child.referent_id
                    ),
                )?;
                if parent
                    .interval
                    .as_ref()
                    .is_some_and(|parent_interval| !interval_contains(parent_interval, interval))
                {
                    return Err(error(format!(
                        "encapsulation cut {} child {} interval exceeds the parent identity interval",
                        cut.id, child.referent_id
                    )));
                }
                if child_referent
                    .interval
                    .as_ref()
                    .is_some_and(|identity_interval| {
                        !interval_contains(identity_interval, interval)
                    })
                {
                    return Err(error(format!(
                        "encapsulation cut {} child {} interval exceeds the child identity interval",
                        cut.id, child.referent_id
                    )));
                }
            } else if let (Some(parent_interval), Some(child_interval)) =
                (&parent.interval, &child_referent.interval)
            {
                if !intervals_overlap(parent_interval, child_interval) {
                    return Err(error(format!(
                        "encapsulation cut {} child {} identity interval does not overlap the parent",
                        cut.id, child.referent_id
                    )));
                }
            }
            let interval_key = child.interval.as_ref().map(|interval| {
                let canonical_bits = |value: f64| {
                    if value == 0.0 {
                        0
                    } else {
                        value.to_bits()
                    }
                };
                (canonical_bits(interval.start), canonical_bits(interval.end))
            });
            if !children.insert((
                child.referent_id.as_str(),
                child.relation.as_str(),
                interval_key,
            )) {
                return Err(error(format!(
                    "encapsulation cut {} has duplicate child relation records",
                    cut.id
                )));
            }
            super::validate_uncertainty(
                &child.uncertainty,
                &format!(
                    "encapsulation cut {} child {} uncertainty",
                    cut.id, child.referent_id
                ),
            )?;
            validate_provenance(
                &child.provenance,
                &format!("encapsulation cut {} child {}", cut.id, child.referent_id),
            )?;
            validate_authority(
                child.authority.as_ref(),
                &format!(
                    "encapsulation cut {} child {} authority",
                    cut.id, child.referent_id
                ),
            )?;
        }
        validate_text(&cut.lens, &format!("encapsulation cut {} lens", cut.id))?;
        validate_optional_text(
            cut.query.as_deref(),
            &format!("encapsulation cut {} query", cut.id),
        )?;
        validate_optional_text(
            cut.resolution.as_deref(),
            &format!("encapsulation cut {} resolution", cut.id),
        )?;
        validate_optional_text(
            cut.residual.as_deref(),
            &format!("encapsulation cut {} residual", cut.id),
        )?;
        super::validate_uncertainty(
            &cut.uncertainty,
            &format!("encapsulation cut {} uncertainty", cut.id),
        )?;
        validate_provenance(&cut.provenance, &format!("encapsulation cut {}", cut.id))?;
        validate_authority(
            cut.authority.as_ref(),
            &format!("encapsulation cut {} authority", cut.id),
        )?;
    }
    let mut physical_cut_ids = BTreeSet::new();
    let mut physical_cuts = BTreeMap::new();
    let mut physical_edges = Vec::new();
    for cut in &meaning_model.physical_cuts {
        validate_identifier(&cut.id, "physical cut id")?;
        if !physical_cut_ids.insert(cut.id.as_str()) {
            return Err(error(format!("duplicate physical cut id {}", cut.id)));
        }
        let parent_event = events.get(cut.parent_event_id.as_str()).ok_or_else(|| {
            error(format!(
                "physical cut {} names unknown parent event {}",
                cut.id, cut.parent_event_id
            ))
        })?;
        if !(2..=MAX_MEANING_CUT_CHILDREN).contains(&cut.child_event_ids.len()) {
            return Err(error(format!(
                "physical cut {} must contain 2..={MAX_MEANING_CUT_CHILDREN} child events",
                cut.id
            )));
        }
        let mut children = BTreeSet::new();
        let mut previous_sequential_start = None;
        for child in &cut.child_event_ids {
            let Some(child_event) = events.get(child.as_str()) else {
                return Err(error(format!(
                    "physical cut {} has invalid child events",
                    cut.id
                )));
            };
            if child == &cut.parent_event_id || !children.insert(child.as_str()) {
                return Err(error(format!(
                    "physical cut {} has invalid child events",
                    cut.id
                )));
            }
            if let Some(child_interval) = &child_event.interval {
                if parent_event
                    .interval
                    .as_ref()
                    .is_some_and(|parent_interval| {
                        !interval_contains(parent_interval, child_interval)
                    })
                {
                    return Err(error(format!(
                        "physical cut {} child event {} interval exceeds the parent event interval",
                        cut.id, child
                    )));
                }
                if cut.kind == PhysicalCutKind::Sequential {
                    if previous_sequential_start
                        .is_some_and(|previous| child_interval.start < previous)
                    {
                        return Err(error(format!(
                            "physical cut {} sequential child event starts must be nondecreasing",
                            cut.id
                        )));
                    }
                    previous_sequential_start = Some(child_interval.start);
                }
            }
            physical_edges.push((cut.parent_event_id.as_str(), child.as_str()));
        }
        validate_text(&cut.lens, &format!("physical cut {} lens", cut.id))?;
        validate_optional_text(
            cut.query.as_deref(),
            &format!("physical cut {} query", cut.id),
        )?;
        validate_provenance(&cut.provenance, &format!("physical cut {}", cut.id))?;
        physical_cuts.insert(cut.id.as_str(), cut);
    }
    validate_dag(&event_ids, &physical_edges, "physical cut graph")?;

    if let Some(coverage) = &meaning_model.semantic_coverage {
        let mut unresolved_event_ids = BTreeSet::new();
        for unresolved in &coverage.unresolved_events {
            validate_identifier(
                &unresolved.event_id,
                "semantic coverage unresolved event id",
            )?;
            if !event_ids.contains(unresolved.event_id.as_str()) {
                return Err(error(format!(
                    "semantic coverage unresolved event {} names an unknown event",
                    unresolved.event_id
                )));
            }
            if !unresolved_event_ids.insert(unresolved.event_id.as_str()) {
                return Err(error(format!(
                    "duplicate semantic coverage unresolved event {}",
                    unresolved.event_id
                )));
            }
            validate_text(
                &unresolved.reason,
                &format!(
                    "semantic coverage unresolved event {} reason",
                    unresolved.event_id
                ),
            )?;
            validate_provenance(
                &unresolved.provenance,
                &format!("semantic coverage unresolved event {}", unresolved.event_id),
            )?;
        }
    }

    let mut event_referent_binding_ids = BTreeSet::new();
    for binding in &meaning_model.event_referent_bindings {
        validate_identifier(&binding.id, "event-referent binding id")?;
        if !event_referent_binding_ids.insert(binding.id.as_str()) {
            return Err(error(format!(
                "duplicate event-referent binding id {}",
                binding.id
            )));
        }
        let target_interval = match &binding.target {
            EventReferentBindingTarget::Event { event_id } => {
                validate_identifier(
                    event_id,
                    &format!("event-referent binding {} target event id", binding.id),
                )?;
                events
                    .get(event_id.as_str())
                    .ok_or_else(|| {
                        error(format!(
                            "event-referent binding {} names unknown event {event_id}",
                            binding.id
                        ))
                    })?
                    .interval
                    .as_ref()
            }
            EventReferentBindingTarget::Process { process_id } => {
                validate_identifier(
                    process_id,
                    &format!("event-referent binding {} target process id", binding.id),
                )?;
                if !processes.contains_key(process_id) {
                    return Err(error(format!(
                        "event-referent binding {} names unknown process {process_id}",
                        binding.id
                    )));
                }
                None
            }
        };
        let referent = referents.get(binding.referent_id.as_str()).ok_or_else(|| {
            error(format!(
                "event-referent binding {} names unknown referent {}",
                binding.id, binding.referent_id
            ))
        })?;
        validate_identifier(
            &binding.role,
            &format!("event-referent binding {} role", binding.id),
        )?;
        validate_text(
            &binding.binding_type,
            &format!("event-referent binding {} type", binding.id),
        )?;
        if let Some(interval) = &binding.interval {
            validate_interval(
                interval,
                &format!("event-referent binding {} interval", binding.id),
            )?;
            if target_interval
                .is_some_and(|event_interval| !interval_contains(event_interval, interval))
            {
                return Err(error(format!(
                    "event-referent binding {} interval exceeds the target event interval",
                    binding.id
                )));
            }
            if referent
                .interval
                .as_ref()
                .is_some_and(|identity_interval| !interval_contains(identity_interval, interval))
            {
                return Err(error(format!(
                    "event-referent binding {} interval exceeds the referent identity interval",
                    binding.id
                )));
            }
        } else if let (Some(event_interval), Some(referent_interval)) =
            (target_interval, &referent.interval)
        {
            if !intervals_overlap(event_interval, referent_interval) {
                return Err(error(format!(
                    "event-referent binding {} connects disjoint event and referent intervals",
                    binding.id
                )));
            }
        }
        super::validate_uncertainty(
            &binding.uncertainty,
            &format!("event-referent binding {} uncertainty", binding.id),
        )?;
        validate_provenance(
            &binding.provenance,
            &format!("event-referent binding {}", binding.id),
        )?;
        validate_authority(
            binding.authority.as_ref(),
            &format!("event-referent binding {} authority", binding.id),
        )?;
    }

    let normalized_cut_parents: BTreeSet<&str> = meaning_model.normalized_cuts.iter()
        .map(|cut| cut.parent_event_id.as_str()).collect();
    let mut realization_ids = BTreeSet::new();
    for realization in &meaning_model.realizations {
        validate_identifier(&realization.id, "realization id")?;
        if !realization_ids.insert(realization.id.as_str()) {
            return Err(error(format!(
                "duplicate realization id {}",
                realization.id
            )));
        }
        if !concept_ids.contains(realization.concept_id.as_str()) {
            return Err(error(format!(
                "realization {} names unknown concept {}",
                realization.id, realization.concept_id
            )));
        }
        if realization.roles.is_empty() && realization.referent_roles.is_empty() {
            return Err(error(format!(
                "realization {} requires at least one event or referent role",
                realization.id
            )));
        }
        let physical_role_count = realization
            .roles
            .len()
            .checked_add(realization.referent_roles.len())
            .ok_or_else(|| error("realization physical role count overflow"))?;
        if physical_role_count > MAX_MEANING_REALIZATION_BINDINGS
            || realization.parameters.len() > MAX_MEANING_REALIZATION_BINDINGS
        {
            return Err(error(format!(
                "realization {} role or parameter count exceeds {MAX_MEANING_REALIZATION_BINDINGS}",
                realization.id
            )));
        }
        for (role, event_id) in &realization.roles {
            validate_identifier(role, &format!("realization {} role", realization.id))?;
            if !event_ids.contains(event_id.as_str()) {
                return Err(error(format!(
                    "realization {} role {role} names unknown event {event_id}",
                    realization.id
                )));
            }
        }
        for (role, referent_id) in &realization.referent_roles {
            validate_identifier(
                role,
                &format!("realization {} referent role", realization.id),
            )?;
            if !referent_ids.contains(referent_id.as_str()) {
                return Err(error(format!(
                    "realization {} role {role} names unknown referent {referent_id}",
                    realization.id
                )));
            }
        }
        for parameter in realization.parameters.keys() {
            validate_identifier(
                parameter,
                &format!("realization {} parameter", realization.id),
            )?;
        }
        finite(
            realization.degree,
            &format!("realization {} degree", realization.id),
        )?;
        if !(0.0..=1.0).contains(&realization.degree) {
            return Err(error(format!(
                "realization {} degree must be in [0,1]",
                realization.id
            )));
        }
        super::validate_uncertainty(
            &realization.uncertainty,
            &format!("realization {} uncertainty", realization.id),
        )?;
        validate_provenance(
            &realization.provenance,
            &format!("realization {}", realization.id),
        )?;
        validate_text(
            &realization.viewpoint,
            &format!("realization {} viewpoint", realization.id),
        )?;
        validate_authority(
            realization.authority.as_ref(),
            &format!("realization {} authority", realization.id),
        )?;
        let abstract_cut = match &realization.abstract_cut_id {
            Some(cut_id) => Some(abstract_cuts.get(cut_id.as_str()).ok_or_else(|| {
                error(format!(
                    "realization {} names unknown abstract cut {cut_id}",
                    realization.id
                ))
            })?),
            None => None,
        };
        let normalized_definition = realization.degree == 1.0
            && realization.roles.values().any(|event_id| normalized_cut_parents.contains(event_id.as_str()));
        if realization.purpose == RealizationPurpose::Define
            && abstract_cut.is_none()
            && !normalized_definition
        {
            return Err(error(format!(
                "define realization {} requires an abstract_cut_id or a role-bound canonical Event with a normalized Cut and degree 1",
                realization.id
            )));
        }
        if let Some(cut) = abstract_cut {
            let concept_is_in_cut = cut.parent_concept_id == realization.concept_id
                || (realization.purpose == RealizationPurpose::Describe
                    && cut.child_concept_ids.contains(&realization.concept_id));
            if !concept_is_in_cut {
                return Err(error(format!(
                    "realization {} concept is not compatible with abstract cut {}",
                    realization.id, cut.id
                )));
            }
        }
        if let Some(cut_id) = &realization.physical_cut_id {
            let cut = physical_cuts.get(cut_id.as_str()).ok_or_else(|| {
                error(format!(
                    "realization {} names unknown physical cut {cut_id}",
                    realization.id
                ))
            })?;
            if !realization.roles.values().any(|event_id| {
                event_id == &cut.parent_event_id || cut.child_event_ids.contains(event_id)
            }) {
                return Err(error(format!(
                    "realization {} has no role in physical cut {cut_id}",
                    realization.id
                )));
            }
        }
    }
    if meaning_model
        .semantic_coverage
        .as_ref()
        .is_some_and(|coverage| coverage.mode == SemanticCoverageMode::Strict)
    {
        let orphaned = classify_semantic_coverage(meaning_model).orphaned;
        if !orphaned.is_empty() {
            return Err(error(format!(
                "semantic coverage strict mode found {} orphaned events: {}; each declared Meaning Model event must be directly named by a nonzero-degree realization, inherited through a realization-bound physical cut, or explicitly listed in semantic_coverage.unresolved_events",
                orphaned.len(),
                orphaned.into_iter().collect::<Vec<_>>().join(", ")
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn test_meaning_model_fixture() -> MeaningModelDefinition {
    fn concept(id: &str) -> ConceptDefinition {
        ConceptDefinition {
            id: id.to_owned(),
            label: Some(id.replace('-', " ")),
            differentia: vec![],
            boundary: None,
            state_schema: BTreeMap::new(),
            direction_families: vec![],
            observation_methods: vec![],
            provenance: vec!["unit-test".to_owned()],
        }
    }
    fn event(id: &str, boundary: &str, process_id: &str) -> MeaningEventDefinition {
        MeaningEventDefinition {
            id: id.to_owned(),
            boundary: boundary.to_owned(),
            description: None,
            interval: Some(EventInterval {
                start: 0.0,
                end: 10.0,
            }),
            process_ids: vec![process_id.to_owned()],
            observation_process_ids: vec![],
            participants: BTreeMap::new(),
            substrate: None,
            region: None,
            provenance: vec!["unit-test".to_owned()],
        }
    }
    fn referent(id: &str, boundary: &str) -> ReferentDefinition {
        ReferentDefinition {
            id: id.to_owned(),
            boundary: boundary.to_owned(),
            continuity_criterion: "stable authored identity over the fixture interval".to_owned(),
            interval: Some(EventInterval {
                start: 0.0,
                end: 10.0,
            }),
            lifecycle_event_id: None,
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            authority: None,
        }
    }

    let mut social_process = concept("social-process");
    social_process.direction_families = vec!["interaction".to_owned()];
    let mut love = concept("love");
    love.differentia = vec!["other-directed valuation".to_owned()];
    love.boundary = Some("bounded relationship history".to_owned());
    love.state_schema
        .insert("intensity".to_owned(), "bounded_scalar".to_owned());
    love.observation_methods = vec!["reported and behavioral evidence".to_owned()];
    let mut relationship = event(
        "relationship-event",
        "one accepted relationship history",
        "family.pressure",
    );
    relationship.participants = BTreeMap::from([
        ("person_a".to_owned(), "alice".to_owned()),
        ("person_b".to_owned(), "bob".to_owned()),
    ]);
    relationship.substrate = Some("interpersonal interaction".to_owned());
    relationship.region = Some("shared social context".to_owned());
    let mut relationship_referent = referent(
        "relationship-referent",
        "the bounded relationship group in this fixture",
    );
    relationship_referent.lifecycle_event_id = Some("relationship-event".to_owned());
    MeaningModelDefinition {
        schema: MEANING_MODEL_SCHEMA.to_owned(),
        concepts: vec![concept("trust"), love, concept("care"), social_process],
        abstract_relations: vec![AbstractRelationDefinition {
            id: "social-process-specializes-to-love".to_owned(),
            source_concept_id: "social-process".to_owned(),
            target_concept_id: "love".to_owned(),
            kind: AbstractRelationKind::Specialization,
            label: None,
            provenance: vec!["unit-test".to_owned()],
        }],
        abstract_cuts: vec![AbstractCutDefinition {
            id: "love-components".to_owned(),
            parent_concept_id: "love".to_owned(),
            child_concept_ids: vec!["trust".to_owned(), "care".to_owned()],
            lens: "relationship dynamics".to_owned(),
            query: Some("what sustains this relationship?".to_owned()),
            provenance: vec!["unit-test".to_owned()],
        }],
        referents: vec![
            referent("bob", "the fixture person Bob"),
            relationship_referent,
            referent("alice", "the fixture person Alice"),
        ],
        encapsulation_cuts: vec![EncapsulationCutDefinition {
            id: "relationship-members".to_owned(),
            parent_referent_id: "relationship-referent".to_owned(),
            children: vec![
                EncapsulationChildDefinition {
                    relation: "member".to_owned(),
                    referent_id: "bob".to_owned(),
                    interval: Some(EventInterval {
                        start: 0.0,
                        end: 10.0,
                    }),
                    uncertainty: ClaimUncertainty::Unknown,
                    provenance: vec!["unit-test".to_owned()],
                    authority: None,
                },
                EncapsulationChildDefinition {
                    relation: "member".to_owned(),
                    referent_id: "alice".to_owned(),
                    interval: Some(EventInterval {
                        start: 0.0,
                        end: 10.0,
                    }),
                    uncertainty: ClaimUncertainty::Exact,
                    provenance: vec!["unit-test".to_owned()],
                    authority: None,
                },
            ],
            lens: "relationship membership".to_owned(),
            query: Some("who participates in this relationship?".to_owned()),
            resolution: Some("named people".to_owned()),
            residual: Some("other social context remains unresolved".to_owned()),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            authority: None,
        }],
        events: vec![
            event(
                "trust-event",
                "trust over the interval",
                "person.error_propensity",
            ),
            relationship,
            event("repair-event", "one repair phase", "person.regime"),
            event("care-event", "care over the interval", "person.stress"),
        ],
        event_relations: vec![EventRelationDefinition {
            id: "trust-enables-repair".to_owned(),
            source_event_id: "trust-event".to_owned(),
            target_event_id: "repair-event".to_owned(),
            kind: EventRelationKind::Enables,
            description: Some(
                "established trust makes the authored repair phase possible".to_owned(),
            ),
            uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
            provenance: vec!["unit-test".to_owned()],
            authority: Some(ClaimAuthority {
                source: "fixture-author".to_owned(),
                weight: 0.8,
            }),
        }],
        event_referent_bindings: vec![
            EventReferentBinding {
                id: "relationship-person-b".to_owned(),
                target: EventReferentBindingTarget::Event {
                    event_id: "relationship-event".to_owned(),
                },
                role: "person_b".to_owned(),
                referent_id: "bob".to_owned(),
                binding_type: "participant".to_owned(),
                interval: Some(EventInterval {
                    start: 0.0,
                    end: 10.0,
                }),
                uncertainty: ClaimUncertainty::Exact,
                provenance: vec!["unit-test".to_owned()],
                authority: None,
            },
            EventReferentBinding {
                id: "relationship-person-a".to_owned(),
                target: EventReferentBindingTarget::Event {
                    event_id: "relationship-event".to_owned(),
                },
                role: "person_a".to_owned(),
                referent_id: "alice".to_owned(),
                binding_type: "participant".to_owned(),
                interval: Some(EventInterval {
                    start: 0.0,
                    end: 10.0,
                }),
                uncertainty: ClaimUncertainty::Exact,
                provenance: vec!["unit-test".to_owned()],
                authority: None,
            },
            EventReferentBinding {
                id: "relationship-state".to_owned(),
                target: EventReferentBindingTarget::Process {
                    process_id: "family.pressure".to_owned(),
                },
                role: "state".to_owned(),
                referent_id: "relationship-referent".to_owned(),
                binding_type: "coordinate".to_owned(),
                interval: Some(EventInterval {
                    start: 0.0,
                    end: 10.0,
                }),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                authority: None,
            },
        ],
        physical_cuts: vec![
            PhysicalCutDefinition {
                id: "relationship-sequence".to_owned(),
                parent_event_id: "care-event".to_owned(),
                child_event_ids: vec!["trust-event".to_owned(), "repair-event".to_owned()],
                kind: PhysicalCutKind::Sequential,
                lens: "repair sequence".to_owned(),
                query: None,
                provenance: vec!["unit-test".to_owned()],
            },
            PhysicalCutDefinition {
                id: "relationship-components".to_owned(),
                parent_event_id: "relationship-event".to_owned(),
                child_event_ids: vec!["trust-event".to_owned(), "care-event".to_owned()],
                kind: PhysicalCutKind::Parallel,
                lens: "coactive relationship processes".to_owned(),
                query: None,
                provenance: vec!["unit-test".to_owned()],
            },
        ],
        realizations: vec![
            RealizationRecord {
                id: "describe-trust".to_owned(),
                concept_id: "trust".to_owned(),
                purpose: RealizationPurpose::Describe,
                abstract_cut_id: Some("love-components".to_owned()),
                physical_cut_id: None,
                roles: BTreeMap::from([("observed".to_owned(), "trust-event".to_owned())]),
                referent_roles: BTreeMap::from([("subject".to_owned(), "alice".to_owned())]),
                parameters: BTreeMap::new(),
                degree: 0.7,
                uncertainty: ClaimUncertainty::Interval {
                    lower: 0.6,
                    upper: 0.8,
                },
                provenance: vec!["unit-test".to_owned()],
                viewpoint: "relationship-observer".to_owned(),
                authority: None,
            },
            RealizationRecord {
                id: "define-love".to_owned(),
                concept_id: "love".to_owned(),
                purpose: RealizationPurpose::Define,
                abstract_cut_id: Some("love-components".to_owned()),
                physical_cut_id: Some("relationship-components".to_owned()),
                roles: BTreeMap::from([(
                    "canonical_model".to_owned(),
                    "relationship-event".to_owned(),
                )]),
                referent_roles: BTreeMap::from([
                    ("person_a".to_owned(), "alice".to_owned()),
                    ("person_b".to_owned(), "bob".to_owned()),
                ]),
                parameters: BTreeMap::from([
                    ("culture".to_owned(), serde_json::json!("fixture")),
                    ("minimum_fit".to_owned(), serde_json::json!(0.5)),
                ]),
                degree: 0.9,
                uncertainty: ClaimUncertainty::StandardDeviation { value: 0.05 },
                provenance: vec!["unit-test".to_owned()],
                viewpoint: "canonical-author".to_owned(),
                authority: Some(ClaimAuthority {
                    source: "fixture-author".to_owned(),
                    weight: 0.8,
                }),
            },
        ],
        semantic_coverage: None,
        normalized_cuts: vec![],
        context_roots: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AxisDefinition, NumericBounds, ProcessType, ProcessUpdateMode, ProcessValue,
    };

    fn test_process(id: &str) -> ProcessDefinition {
        ProcessDefinition {
            id: id.to_owned(),
            value_type: ProcessType::Scalar {
                bounds: NumericBounds {
                    minimum: -10.0,
                    maximum: 10.0,
                },
            },
            initial_value: ProcessValue::Scalar(0.0),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![AxisDefinition {
                id: "value".to_owned(),
                unit: None,
            }],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::new(),
            support: vec!["meaning validation test".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Static,
        }
    }

    fn test_processes() -> BTreeMap<String, ProcessDefinition> {
        [
            "family.pressure",
            "person.error_propensity",
            "person.regime",
            "person.stress",
        ]
        .into_iter()
        .map(|id| (id.to_owned(), test_process(id)))
        .collect()
    }

    fn failure(meaning_model: MeaningModelDefinition) -> String {
        validate_meaning_model(&meaning_model, &test_processes())
            .unwrap_err()
            .0
    }

    fn coverage(
        mode: SemanticCoverageMode,
        unresolved_events: Vec<UnresolvedSemanticEvent>,
    ) -> SemanticCoverageDefinition {
        SemanticCoverageDefinition {
            mode,
            unresolved_events,
        }
    }

    fn unresolved(event_id: &str) -> UnresolvedSemanticEvent {
        UnresolvedSemanticEvent {
            event_id: event_id.to_owned(),
            reason: "meaning remains deliberately unresolved at this fixture resolution".to_owned(),
            provenance: vec!["unit-test".to_owned()],
        }
    }

    #[test]
    fn normalization_preserves_sequential_order_and_canonicalizes_sets() {
        let mut meaning_model = test_meaning_model_fixture();
        normalize_meaning_model(&mut meaning_model);
        assert_eq!(
            meaning_model.abstract_cuts[0].child_concept_ids,
            ["care", "trust"]
        );
        assert_eq!(
            meaning_model
                .referents
                .iter()
                .map(|referent| referent.id.as_str())
                .collect::<Vec<_>>(),
            ["alice", "bob", "relationship-referent"]
        );
        assert_eq!(
            meaning_model.encapsulation_cuts[0]
                .children
                .iter()
                .map(|child| child.referent_id.as_str())
                .collect::<Vec<_>>(),
            ["alice", "bob"]
        );
        assert_eq!(
            meaning_model
                .event_referent_bindings
                .iter()
                .map(|binding| binding.id.as_str())
                .collect::<Vec<_>>(),
            [
                "relationship-person-a",
                "relationship-person-b",
                "relationship-state"
            ]
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
    }

    #[test]
    fn event_relations_are_validated_normalized_and_summarized_as_static_claims() {
        let mut meaning_model = test_meaning_model_fixture();
        meaning_model.event_relations.push(EventRelationDefinition {
            id: "care-constrains-repair".to_owned(),
            source_event_id: "care-event".to_owned(),
            target_event_id: "repair-event".to_owned(),
            kind: EventRelationKind::Constrains,
            description: None,
            uncertainty: ClaimUncertainty::Exact,
            provenance: vec!["unit-test".to_owned()],
            authority: None,
        });
        meaning_model.event_relations.reverse();

        validate_meaning_model(&meaning_model, &test_processes()).unwrap();
        normalize_meaning_model(&mut meaning_model);
        assert_eq!(
            meaning_model
                .event_relations
                .iter()
                .map(|relation| relation.id.as_str())
                .collect::<Vec<_>>(),
            ["care-constrains-repair", "trust-enables-repair"]
        );
        let summary = meaning_model.summary();
        assert_eq!(summary.event_relation_count, 2);
        assert_eq!(
            summary.event_relation_ids,
            ["care-constrains-repair", "trust-enables-repair"]
        );
    }

    #[test]
    fn event_relations_reject_invalid_ids_references_text_and_claim_metadata() {
        let mut duplicate = test_meaning_model_fixture();
        let repeated = duplicate.event_relations[0].clone();
        duplicate.event_relations.push(repeated);
        assert!(failure(duplicate).contains("duplicate event relation id"));

        let mut self_relation = test_meaning_model_fixture();
        self_relation.event_relations[0].target_event_id = "trust-event".to_owned();
        assert!(failure(self_relation).contains("must connect distinct events"));

        let mut dangling_source = test_meaning_model_fixture();
        dangling_source.event_relations[0].source_event_id = "missing-event".to_owned();
        assert!(failure(dangling_source).contains("unknown source event missing-event"));

        let mut dangling_target = test_meaning_model_fixture();
        dangling_target.event_relations[0].target_event_id = "missing-event".to_owned();
        assert!(failure(dangling_target).contains("unknown target event missing-event"));

        let mut unlabeled_other = test_meaning_model_fixture();
        unlabeled_other.event_relations[0].kind = EventRelationKind::Other;
        unlabeled_other.event_relations[0].description = None;
        assert!(failure(unlabeled_other).contains("kind other requires a description"));

        let mut blank_description = test_meaning_model_fixture();
        blank_description.event_relations[0].description = Some(" ".to_owned());
        assert!(failure(blank_description).contains("description must be nonempty and bounded"));

        let mut invalid_uncertainty = test_meaning_model_fixture();
        invalid_uncertainty.event_relations[0].uncertainty =
            ClaimUncertainty::StandardDeviation { value: -0.1 };
        assert!(failure(invalid_uncertainty).contains("uncertainty is negative"));

        let mut missing_provenance = test_meaning_model_fixture();
        missing_provenance.event_relations[0].provenance.clear();
        assert!(failure(missing_provenance).contains("requires nonempty provenance"));

        let mut invalid_authority = test_meaning_model_fixture();
        invalid_authority.event_relations[0].authority = Some(ClaimAuthority {
            source: " ".to_owned(),
            weight: 0.5,
        });
        assert!(failure(invalid_authority).contains("source must be nonempty and bounded"));
    }

    #[test]
    fn referent_only_meaning_model_is_a_valid_optional_profile() {
        let fixture = test_meaning_model_fixture();
        let referent_only = MeaningModelDefinition {
            schema: MEANING_MODEL_SCHEMA.to_owned(),
            concepts: vec![],
            abstract_relations: vec![],
            abstract_cuts: vec![],
            referents: vec![ReferentDefinition {
                lifecycle_event_id: None,
                ..fixture.referents[0].clone()
            }],
            encapsulation_cuts: vec![],
            events: vec![],
            event_relations: vec![],
            event_referent_bindings: vec![],
            physical_cuts: vec![],
            realizations: vec![],
            semantic_coverage: None,
            normalized_cuts: vec![],
            context_roots: vec![],
        };
        validate_meaning_model(&referent_only, &test_processes()).unwrap();
    }

    #[test]
    fn encapsulation_allows_recurrent_time_scoped_membership() {
        let mut meaning_model = test_meaning_model_fixture();
        let cut = &mut meaning_model.encapsulation_cuts[0];
        let alice_index = cut
            .children
            .iter()
            .position(|child| child.referent_id == "alice")
            .unwrap();
        cut.children[alice_index].interval = Some(EventInterval {
            start: 0.0,
            end: 3.0,
        });
        let mut reentry = cut.children[alice_index].clone();
        reentry.interval = Some(EventInterval {
            start: 7.0,
            end: 10.0,
        });
        cut.children.push(reentry);
        validate_meaning_model(&meaning_model, &test_processes()).unwrap();
        normalize_meaning_model(&mut meaning_model);
        let alice_intervals = meaning_model.encapsulation_cuts[0]
            .children
            .iter()
            .filter(|child| child.referent_id == "alice")
            .map(|child| child.interval.as_ref().unwrap().start)
            .collect::<Vec<_>>();
        assert_eq!(alice_intervals, [0.0, 7.0]);
    }

    #[test]
    fn realization_role_can_bind_both_event_and_referent_namespaces() {
        let mut meaning_model = test_meaning_model_fixture();
        meaning_model.realizations[0]
            .referent_roles
            .insert("observed".to_owned(), "alice".to_owned());
        validate_meaning_model(&meaning_model, &test_processes()).unwrap();
    }

    #[test]
    fn semantic_coverage_reports_direct_inherited_and_orphaned_events() {
        let mut meaning_model = test_meaning_model_fixture();
        meaning_model.semantic_coverage = Some(coverage(SemanticCoverageMode::Report, vec![]));
        validate_meaning_model(&meaning_model, &test_processes()).unwrap();

        let summary = meaning_model.summary().semantic_coverage.unwrap();
        assert_eq!(
            summary.direct_event_ids,
            ["relationship-event", "trust-event"]
        );
        assert_eq!(summary.inherited_event_ids, ["care-event"]);
        assert_eq!(summary.unresolved_event_ids, Vec::<String>::new());
        assert_eq!(summary.orphaned_event_ids, ["repair-event"]);
        assert_eq!(summary.semantically_resolved_count, 3);
        assert_eq!(summary.semantically_accounted_count, 3);
    }

    #[test]
    fn strict_semantic_coverage_requires_every_declared_event_to_be_accounted_for() {
        let mut orphaned = test_meaning_model_fixture();
        orphaned.semantic_coverage = Some(coverage(SemanticCoverageMode::Strict, vec![]));
        let message = failure(orphaned);
        assert!(message.contains("strict mode found 1 orphaned events: repair-event"));
        assert!(message.contains("directly named by a nonzero-degree realization"));

        let mut explicitly_unresolved = test_meaning_model_fixture();
        explicitly_unresolved.semantic_coverage = Some(coverage(
            SemanticCoverageMode::Strict,
            vec![unresolved("repair-event")],
        ));
        validate_meaning_model(&explicitly_unresolved, &test_processes()).unwrap();
        let summary = explicitly_unresolved.summary().semantic_coverage.unwrap();
        assert_eq!(summary.unresolved_event_ids, ["repair-event"]);
        assert_eq!(summary.orphaned_count, 0);
        assert_eq!(summary.semantically_resolved_count, 3);
        assert_eq!(summary.semantically_accounted_count, 4);
    }

    #[test]
    fn semantic_coverage_inherits_only_through_explicitly_realized_cuts() {
        let mut meaning_model = test_meaning_model_fixture();
        meaning_model.realizations[0].physical_cut_id = Some("relationship-sequence".to_owned());
        meaning_model.semantic_coverage = Some(coverage(SemanticCoverageMode::Strict, vec![]));
        validate_meaning_model(&meaning_model, &test_processes()).unwrap();
        let summary = meaning_model.summary().semantic_coverage.unwrap();
        assert_eq!(summary.direct_count, 2);
        assert_eq!(summary.inherited_event_ids, ["care-event", "repair-event"]);
        assert_eq!(summary.orphaned_count, 0);

        let mut zero_degree = test_meaning_model_fixture();
        zero_degree.realizations[1].degree = 0.0;
        zero_degree.semantic_coverage = Some(coverage(SemanticCoverageMode::Report, vec![]));
        validate_meaning_model(&zero_degree, &test_processes()).unwrap();
        let zero_summary = zero_degree.summary().semantic_coverage.unwrap();
        assert_eq!(zero_summary.direct_event_ids, ["trust-event"]);
        assert_eq!(
            zero_summary.orphaned_event_ids,
            ["care-event", "relationship-event", "repair-event"]
        );
    }

    #[test]
    fn semantic_coverage_validates_unresolved_declarations_and_normalizes_them() {
        let mut unknown = test_meaning_model_fixture();
        unknown.semantic_coverage = Some(coverage(
            SemanticCoverageMode::Report,
            vec![unresolved("missing-event")],
        ));
        assert!(failure(unknown).contains("names an unknown event"));

        let mut duplicate = test_meaning_model_fixture();
        duplicate.semantic_coverage = Some(coverage(
            SemanticCoverageMode::Report,
            vec![unresolved("repair-event"), unresolved("repair-event")],
        ));
        assert!(failure(duplicate).contains("duplicate semantic coverage unresolved event"));

        let mut blank_reason = test_meaning_model_fixture();
        let mut blank = unresolved("repair-event");
        blank.reason = " ".to_owned();
        blank_reason.semantic_coverage = Some(coverage(SemanticCoverageMode::Report, vec![blank]));
        assert!(failure(blank_reason).contains("reason must be nonempty and bounded"));

        let mut no_provenance = test_meaning_model_fixture();
        let mut unprovenanced = unresolved("repair-event");
        unprovenanced.provenance.clear();
        no_provenance.semantic_coverage =
            Some(coverage(SemanticCoverageMode::Report, vec![unprovenanced]));
        assert!(failure(no_provenance).contains("requires nonempty provenance"));

        let mut reordered = test_meaning_model_fixture();
        let mut later_unresolved = reordered.events[0].clone();
        later_unresolved.id = "later-unresolved".to_owned();
        later_unresolved.boundary = "another deliberately unresolved event".to_owned();
        reordered.events.push(later_unresolved);
        reordered.semantic_coverage = Some(coverage(
            SemanticCoverageMode::Report,
            vec![unresolved("repair-event"), unresolved("later-unresolved")],
        ));
        normalize_meaning_model(&mut reordered);
        assert_eq!(
            reordered
                .semantic_coverage
                .unwrap()
                .unresolved_events
                .into_iter()
                .map(|record| record.event_id)
                .collect::<Vec<_>>(),
            ["later-unresolved", "repair-event"]
        );
    }

    #[test]
    fn physical_cut_intervals_stay_within_the_parent_and_preserve_sequential_order() {
        let set_interval =
            |meaning_model: &mut MeaningModelDefinition, event_id: &str, start: f64, end: f64| {
                meaning_model
                    .events
                    .iter_mut()
                    .find(|event| event.id == event_id)
                    .unwrap()
                    .interval = Some(EventInterval { start, end });
            };

        let mut outside_parent = test_meaning_model_fixture();
        set_interval(&mut outside_parent, "trust-event", 1.0, 10.5);
        assert!(failure(outside_parent).contains(
            "physical cut relationship-sequence child event trust-event interval exceeds the parent event interval"
        ));

        let mut reversed_sequence = test_meaning_model_fixture();
        set_interval(&mut reversed_sequence, "trust-event", 4.0, 9.0);
        set_interval(&mut reversed_sequence, "repair-event", 3.0, 8.0);
        assert!(failure(reversed_sequence).contains(
            "physical cut relationship-sequence sequential child event starts must be nondecreasing"
        ));

        let mut overlapping_sequence = test_meaning_model_fixture();
        set_interval(&mut overlapping_sequence, "trust-event", 1.0, 8.0);
        set_interval(&mut overlapping_sequence, "repair-event", 2.0, 9.0);
        validate_meaning_model(&overlapping_sequence, &test_processes()).unwrap();
    }

    #[test]
    fn validation_rejects_dangling_references_cycles_and_invalid_links() {
        let mut dangling = test_meaning_model_fixture();
        dangling.events[0].process_ids = vec!["missing.process".to_owned()];
        assert!(failure(dangling).contains("unknown process"));

        let mut abstract_cycle = test_meaning_model_fixture();
        abstract_cycle
            .abstract_relations
            .push(AbstractRelationDefinition {
                id: "care-specializes-to-social-process".to_owned(),
                source_concept_id: "care".to_owned(),
                target_concept_id: "social-process".to_owned(),
                kind: AbstractRelationKind::Specialization,
                label: None,
                provenance: vec!["unit-test".to_owned()],
            });
        assert!(failure(abstract_cycle).contains("abstract structural graph must be acyclic"));

        let mut physical_cycle = test_meaning_model_fixture();
        physical_cycle.physical_cuts.push(PhysicalCutDefinition {
            id: "trust-to-relationship".to_owned(),
            parent_event_id: "trust-event".to_owned(),
            child_event_ids: vec!["relationship-event".to_owned(), "repair-event".to_owned()],
            kind: PhysicalCutKind::Sequential,
            lens: "invalid recursive decomposition".to_owned(),
            query: None,
            provenance: vec!["unit-test".to_owned()],
        });
        assert!(failure(physical_cycle).contains("physical cut graph must be acyclic"));

        let mut unindexed_definition = test_meaning_model_fixture();
        unindexed_definition
            .realizations
            .iter_mut()
            .find(|record| record.purpose == RealizationPurpose::Define)
            .unwrap()
            .abstract_cut_id = None;
        assert!(failure(unindexed_definition).contains("requires an abstract_cut_id"));

        let mut invalid_degree = test_meaning_model_fixture();
        invalid_degree.realizations[0].degree = 1.01;
        assert!(failure(invalid_degree).contains("degree must be in [0,1]"));

        let mut unlabeled_other = test_meaning_model_fixture();
        unlabeled_other.abstract_relations[0].kind = AbstractRelationKind::Other;
        assert!(failure(unlabeled_other).contains("kind other requires a label"));

        let mut duplicate_child = test_meaning_model_fixture();
        duplicate_child.abstract_cuts[0].child_concept_ids =
            vec!["care".to_owned(), "care".to_owned()];
        assert!(failure(duplicate_child).contains("invalid child concepts"));

        let mut reversed_interval = test_meaning_model_fixture();
        reversed_interval.events[0].interval = Some(EventInterval {
            start: 2.0,
            end: 1.0,
        });
        assert!(failure(reversed_interval).contains("interval end precedes start"));

        let mut dangling_lifecycle = test_meaning_model_fixture();
        dangling_lifecycle.referents[0].lifecycle_event_id = Some("missing-event".to_owned());
        assert!(failure(dangling_lifecycle).contains("unknown lifecycle event"));

        let mut self_encapsulation = test_meaning_model_fixture();
        self_encapsulation.encapsulation_cuts[0].children[0].referent_id =
            "relationship-referent".to_owned();
        assert!(failure(self_encapsulation).contains("self-referential"));

        let mut duplicate_encapsulation_child = test_meaning_model_fixture();
        duplicate_encapsulation_child.encapsulation_cuts[0].children[1].referent_id =
            duplicate_encapsulation_child.encapsulation_cuts[0].children[0]
                .referent_id
                .clone();
        assert!(failure(duplicate_encapsulation_child).contains("duplicate child relation records"));

        let mut dangling_binding = test_meaning_model_fixture();
        dangling_binding.event_referent_bindings[0].referent_id = "missing".to_owned();
        assert!(failure(dangling_binding).contains("unknown referent"));

        let mut dangling_process_binding = test_meaning_model_fixture();
        dangling_process_binding.event_referent_bindings[0].target =
            EventReferentBindingTarget::Process {
                process_id: "missing.process".to_owned(),
            };
        assert!(failure(dangling_process_binding).contains("unknown process"));

        let mut out_of_scope_binding = test_meaning_model_fixture();
        out_of_scope_binding.event_referent_bindings[0].interval = Some(EventInterval {
            start: 0.0,
            end: 11.0,
        });
        assert!(failure(out_of_scope_binding).contains("exceeds the target event interval"));

        let mut dangling_realization_referent = test_meaning_model_fixture();
        dangling_realization_referent.realizations[0]
            .referent_roles
            .insert("other".to_owned(), "missing".to_owned());
        assert!(failure(dangling_realization_referent).contains("unknown referent"));
    }
}
