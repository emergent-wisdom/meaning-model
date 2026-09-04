//! Optional authored-profile compilers for the ordinary typed model IR.
//!
//! A profile is only a compact authoring convenience. Compilation appends
//! ordinary processes, laws, dependencies, claims, and (when requested) static
//! Meaning Model records to one [`ModelDefinition`]. The resulting definition
//! is validated by [`compile_model`] and is rolled and committed by the same
//! candidate transaction as every hand-authored model. There is no profile
//! runtime, scheduler, inference engine, or alternate source of canon.

use crate::{
    compile_model, ChangeArcScaffoldProfile, Claim, ClaimAuthority, ClaimMode, ClaimUncertainty,
    Comparison, ConceptDefinition, ConceptScaffoldProfile, DecompositionEdge, DependencyEdge,
    DependencyKind, EffectMode, EngineError, EngineResult, EventInterval, EventReferentBinding,
    EventReferentBindingTarget, EventRelationDefinition, EventRelationKind, EvidenceType,
    GraphEdgeValue, GraphValue, LawActivation, LawDefinition, LawOperator, MeaningEventDefinition,
    MeaningModelDefinition, ModelDefinition, ModelRevision, NumericBounds, OccurrenceTrigger,
    ProcessDefinition, ProcessType, ProcessUpdateMode, ProcessValue, RealizationPurpose,
    RealizationRecord, ReferentDefinition, RelationshipScaffoldProfile, ScalarExpression,
    StateEffect, ThingScaffoldProfile, TriggerFiring, MEANING_MODEL_SCHEMA, MODEL_SCHEMA,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Every bundled profile is an authored structural hypothesis. Compiling one
/// demonstrates IR expressibility, not psychological, spatial, narrative, or
/// social validity. Calibration and held-out evaluation remain caller work.
pub const OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY: &str =
    "authored optional profile; structurally executable, not empirically validated";

/// Profiles never create another machine. All emitted fields participate in a
/// single ordinary model candidate and the existing compare-and-swap commit.
pub const OPTIONAL_PROFILE_EXECUTION_BOUNDARY: &str =
    "ordinary ModelDefinition and common laws; one existing candidate transaction";

pub const PROFILE_COMPILATION_SCHEMA: &str = "life-sim-rust-profile-compilation/v1";
const MAX_PROFILE_SPECS: usize = 256;

fn profile_error(message: impl Into<String>) -> EngineError {
    EngineError(format!("optional profile: {}", message.into()))
}

fn finite(value: f64, label: &str) -> EngineResult<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(profile_error(format!("{label} must be finite")))
    }
}

fn unit_interval(value: f64, label: &str) -> EngineResult<()> {
    finite(value, label)?;
    if (0.0..=1.0).contains(&value) {
        Ok(())
    } else {
        Err(profile_error(format!("{label} must be in [0,1]")))
    }
}

fn signed_unit(value: f64, label: &str) -> EngineResult<()> {
    finite(value, label)?;
    if (-1.0..=1.0).contains(&value) {
        Ok(())
    } else {
        Err(profile_error(format!("{label} must be in [-1,1]")))
    }
}

fn positive(value: f64, label: &str) -> EngineResult<()> {
    finite(value, label)?;
    if value > 0.0 {
        Ok(())
    } else {
        Err(profile_error(format!("{label} must be positive")))
    }
}

fn nonnegative(value: f64, label: &str) -> EngineResult<()> {
    finite(value, label)?;
    if value >= 0.0 {
        Ok(())
    } else {
        Err(profile_error(format!("{label} must be nonnegative")))
    }
}

fn validate_segment(value: &str, label: &str) -> EngineResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(profile_error(format!(
            "{label} must be a 1..=128 byte ASCII identifier segment"
        )));
    }
    Ok(())
}

fn validate_text(value: &str, label: &str) -> EngineResult<()> {
    if value.trim().is_empty() {
        Err(profile_error(format!("{label} must be nonempty")))
    } else {
        Ok(())
    }
}

fn profile_provenance(values: &[String]) -> EngineResult<Vec<String>> {
    if values.is_empty() || values.iter().any(|value| value.trim().is_empty()) {
        return Err(profile_error("profile provenance must be nonempty"));
    }
    let mut normalized = values.to_vec();
    if !normalized
        .iter()
        .any(|value| value == OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY)
    {
        normalized.push(OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY.to_owned());
    }
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

fn normalized_scopes(
    mut values: Vec<String>,
    required: Option<String>,
) -> EngineResult<Vec<String>> {
    if let Some(required) = required {
        values.push(required);
    }
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(profile_error("access scopes must be nonempty"));
    }
    values.sort();
    values.dedup();
    Ok(values)
}

fn empty_meaning_model() -> MeaningModelDefinition {
    MeaningModelDefinition {
        schema: MEANING_MODEL_SCHEMA.to_owned(),
        concepts: vec![],
        abstract_relations: vec![],
        abstract_cuts: vec![],
        referents: vec![],
        encapsulation_cuts: vec![],
        events: vec![],
        event_relations: vec![],
        event_referent_bindings: vec![],
        physical_cuts: vec![],
        realizations: vec![],
        semantic_coverage: None,
        normalized_cuts: vec![],
        context_roots: vec![],
    }
}

/// A pure collection of ordinary model records emitted by one profile.
#[derive(Debug, Clone, Default)]
pub struct ProfileFragment {
    pub processes: Vec<ProcessDefinition>,
    pub decomposition: Vec<DecompositionEdge>,
    pub dependencies: Vec<DependencyEdge>,
    pub laws: Vec<LawDefinition>,
    pub initial_claims: Vec<Claim>,
    pub meaning_model: Option<MeaningModelDefinition>,
}

pub trait OptionalModelProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment>;
}

/// Incrementally appends independent profile fragments to one existing model.
/// `finish` reuses `compile_model`, returning its normalized ordinary
/// definition so profile output cannot bypass kernel validation.
#[derive(Debug, Clone)]
pub struct OptionalProfileCompiler {
    definition: ModelDefinition,
}

impl OptionalProfileCompiler {
    pub fn from_definition(definition: ModelDefinition) -> Self {
        Self { definition }
    }

    pub fn revision_zero(
        model_id: impl Into<String>,
        time_unit: impl Into<String>,
        reason: impl Into<String>,
        provenance: Vec<String>,
    ) -> Self {
        Self::from_definition(ModelDefinition {
            schema: MODEL_SCHEMA.to_owned(),
            id: model_id.into(),
            time_unit: time_unit.into(),
            revision: ModelRevision {
                number: 0,
                previous_model_hash: None,
                reason: reason.into(),
                provenance,
            },
            processes: vec![],
            decomposition: vec![],
            dependencies: vec![],
            laws: vec![],
            initial_claims: vec![],
            meaning_model: None,
        })
    }

    pub fn definition(&self) -> &ModelDefinition {
        &self.definition
    }

    pub fn apply<P: OptionalModelProfile>(&mut self, profile: &P) -> EngineResult<&mut Self> {
        let fragment = profile.compile_profile()?;
        ensure_disjoint(
            "process",
            self.definition
                .processes
                .iter()
                .map(|item| item.id.as_str()),
            fragment.processes.iter().map(|item| item.id.as_str()),
        )?;
        ensure_disjoint(
            "decomposition edge",
            self.definition
                .decomposition
                .iter()
                .map(|item| item.id.as_str()),
            fragment.decomposition.iter().map(|item| item.id.as_str()),
        )?;
        ensure_disjoint(
            "dependency edge",
            self.definition
                .dependencies
                .iter()
                .map(|item| item.id.as_str()),
            fragment.dependencies.iter().map(|item| item.id.as_str()),
        )?;
        ensure_disjoint(
            "law",
            self.definition.laws.iter().map(|item| item.id.as_str()),
            fragment.laws.iter().map(|item| item.id.as_str()),
        )?;
        ensure_disjoint(
            "initial claim",
            self.definition
                .initial_claims
                .iter()
                .map(|item| item.id.as_str()),
            fragment.initial_claims.iter().map(|item| item.id.as_str()),
        )?;
        if fragment
            .meaning_model
            .as_ref()
            .is_some_and(|value| value.schema != MEANING_MODEL_SCHEMA)
        {
            return Err(profile_error(
                "profile emitted an unsupported Meaning Model schema",
            ));
        }
        if self
            .definition
            .meaning_model
            .as_ref()
            .is_some_and(|value| value.schema != MEANING_MODEL_SCHEMA)
        {
            return Err(profile_error(
                "base model has an unsupported Meaning Model schema",
            ));
        }

        self.definition.processes.extend(fragment.processes);
        self.definition.decomposition.extend(fragment.decomposition);
        self.definition.dependencies.extend(fragment.dependencies);
        self.definition.laws.extend(fragment.laws);
        self.definition
            .initial_claims
            .extend(fragment.initial_claims);
        merge_meaning_model(&mut self.definition.meaning_model, fragment.meaning_model)?;
        Ok(self)
    }

    pub fn finish(self) -> EngineResult<ModelDefinition> {
        let compiled = compile_model(self.definition)?;
        Ok(compiled.definition().clone())
    }
}

/// Minimal revision-zero header used by the read-only profile compiler.
/// Successor revisions remain explicit complete `ModelDefinition` operations;
/// this convenience surface does not patch registered models.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProfileModelHeader {
    pub id: String,
    pub time_unit: String,
    pub reason: String,
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "profile", rename_all = "snake_case")]
pub enum ProfileSpec {
    Story(CreativeStorytellingProfile),
    ConceptScaffold(ConceptScaffoldProfile),
    ChangeArcScaffold(ChangeArcScaffoldProfile),
    Person(PersonProfile),
    PersonScaffold(PersonScaffoldProfile),
    ThingScaffold(ThingScaffoldProfile),
    RelationshipScaffold(RelationshipScaffoldProfile),
    Decision(DecisionProfile),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProfileCompilationRequest {
    pub schema: String,
    pub model: ProfileModelHeader,
    pub profiles: Vec<ProfileSpec>,
}

/// Compiles optional authoring profiles to one ordinary, normalized revision-0
/// model. The operation is pure: registration and persistence remain separate
/// explicit machine operations.
pub fn compile_profiles(request: ProfileCompilationRequest) -> EngineResult<ModelDefinition> {
    if request.schema != PROFILE_COMPILATION_SCHEMA {
        return Err(profile_error(format!(
            "unsupported profile compilation schema {}; expected {PROFILE_COMPILATION_SCHEMA}",
            request.schema
        )));
    }
    if request.profiles.is_empty() || request.profiles.len() > MAX_PROFILE_SPECS {
        return Err(profile_error(format!(
            "profile compilation requires 1..={MAX_PROFILE_SPECS} profiles"
        )));
    }
    let mut compiler = OptionalProfileCompiler::revision_zero(
        request.model.id,
        request.model.time_unit,
        request.model.reason,
        request.model.provenance,
    );
    for profile in request.profiles {
        match profile {
            ProfileSpec::Story(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::ConceptScaffold(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::ChangeArcScaffold(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::Person(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::PersonScaffold(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::ThingScaffold(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::RelationshipScaffold(profile) => {
                compiler.apply(&profile)?;
            }
            ProfileSpec::Decision(profile) => {
                compiler.apply(&profile)?;
            }
        }
    }
    compiler.finish()
}

fn ensure_disjoint<'a, 'b>(
    label: &str,
    existing: impl Iterator<Item = &'a str>,
    incoming: impl Iterator<Item = &'b str>,
) -> EngineResult<()> {
    let existing: BTreeSet<&str> = existing.collect();
    let mut seen = BTreeSet::new();
    for id in incoming {
        if !seen.insert(id) || existing.contains(id) {
            return Err(profile_error(format!("duplicate {label} id {id}")));
        }
    }
    Ok(())
}

fn merge_meaning_model(
    target: &mut Option<MeaningModelDefinition>,
    source: Option<MeaningModelDefinition>,
) -> EngineResult<()> {
    let Some(mut source) = source else {
        return Ok(());
    };
    let target = target.get_or_insert_with(empty_meaning_model);
    match (
        target.semantic_coverage.as_mut(),
        source.semantic_coverage.take(),
    ) {
        (None, Some(coverage)) => target.semantic_coverage = Some(coverage),
        (Some(existing), Some(mut incoming)) => {
            if existing.mode != incoming.mode {
                return Err(profile_error(
                    "profile Meaning Model semantic coverage modes conflict",
                ));
            }
            existing
                .unresolved_events
                .append(&mut incoming.unresolved_events);
        }
        _ => {}
    }
    target.concepts.append(&mut source.concepts);
    target
        .abstract_relations
        .append(&mut source.abstract_relations);
    target.abstract_cuts.append(&mut source.abstract_cuts);
    target.referents.append(&mut source.referents);
    target
        .encapsulation_cuts
        .append(&mut source.encapsulation_cuts);
    target.events.append(&mut source.events);
    target.event_relations.append(&mut source.event_relations);
    target
        .event_referent_bindings
        .append(&mut source.event_referent_bindings);
    target.physical_cuts.append(&mut source.physical_cuts);
    target.realizations.append(&mut source.realizations);
    target.normalized_cuts.append(&mut source.normalized_cuts);
    target.context_roots.append(&mut source.context_roots);
    Ok(())
}

// Keeping this as a one-to-one shorthand for ordinary ProcessDefinition fields
// is smaller and clearer than introducing a shadow metadata builder.
#[allow(clippy::too_many_arguments)]
fn scalar_process(
    id: String,
    initial: f64,
    bounds: NumericBounds,
    provenance: &[String],
    support: Vec<String>,
    access_scopes: Vec<String>,
    update_mode: ProcessUpdateMode,
    unit: Option<String>,
    reference_frame: Option<String>,
    scale: BTreeMap<String, String>,
) -> ProcessDefinition {
    ProcessDefinition {
        id,
        value_type: ProcessType::Scalar { bounds },
        initial_value: ProcessValue::Scalar(initial),
        uncertainty: ClaimUncertainty::Unknown,
        provenance: provenance.to_vec(),
        axes: vec![],
        unit,
        reference_frame,
        scale,
        support,
        access_scopes,
        update_mode,
    }
}

fn constant(value: f64) -> ScalarExpression {
    ScalarExpression::Constant { value }
}

fn process(id: impl Into<String>) -> ScalarExpression {
    ScalarExpression::Process { process: id.into() }
}

fn add(terms: Vec<ScalarExpression>) -> ScalarExpression {
    ScalarExpression::Add { terms }
}

fn multiply(factors: Vec<ScalarExpression>) -> ScalarExpression {
    ScalarExpression::Multiply { factors }
}

fn subtract(left: ScalarExpression, right: ScalarExpression) -> ScalarExpression {
    ScalarExpression::Subtract {
        left: Box::new(left),
        right: Box::new(right),
    }
}

fn negate(value: ScalarExpression) -> ScalarExpression {
    ScalarExpression::Negate {
        value: Box::new(value),
    }
}

fn absolute(value: ScalarExpression) -> ScalarExpression {
    ScalarExpression::Absolute {
        value: Box::new(value),
    }
}

fn logistic(value: ScalarExpression) -> ScalarExpression {
    ScalarExpression::Logistic {
        value: Box::new(value),
    }
}

fn clamp(value: ScalarExpression, minimum: f64, maximum: f64) -> ScalarExpression {
    ScalarExpression::Clamp {
        value: Box::new(value),
        minimum,
        maximum,
    }
}

fn law(id: String, operator: LawOperator, provenance: &[String]) -> LawDefinition {
    LawDefinition {
        id,
        enabled: true,
        activation: LawActivation::Always,
        operator,
        provenance: provenance.to_vec(),
    }
}

fn dependency(
    id: String,
    source: String,
    target: String,
    kind: DependencyKind,
    law_id: String,
) -> DependencyEdge {
    DependencyEdge {
        id,
        source,
        target,
        kind,
        law_id: Some(law_id),
    }
}

fn decision_scale(
    decision_id: &str,
    option_id: Option<&str>,
    semantic_role: impl Into<String>,
) -> BTreeMap<String, String> {
    let mut scale = BTreeMap::from([
        ("profile_kind".to_owned(), "decision".to_owned()),
        ("decision_id".to_owned(), decision_id.to_owned()),
        ("semantic_role".to_owned(), semantic_role.into()),
    ]);
    if let Some(option_id) = option_id {
        scale.insert("option_id".to_owned(), option_id.to_owned());
    }
    scale
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionMotiveKind {
    Want,
    Fear,
    Drive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DecisionMotive {
    pub id: String,
    pub kind: DecisionMotiveKind,
    pub intensity: f64,
    #[serde(default)]
    pub option_weights: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DecisionOption {
    pub id: String,
    pub objective_value: f64,
    pub perceived_value: f64,
    pub habit_strength: f64,
    pub impulse_bias: f64,
    pub initial_commitment: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DecisionModeParameters {
    pub deliberative_weight: f64,
    pub habitual_weight: f64,
    pub impulsive_weight: f64,
    pub commitment_rate: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DecisionActionRule {
    Threshold { threshold: f64 },
    Hazard { base_rate: f64, sensitivity: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DecisionFeedback {
    pub attraction_delta: f64,
    pub avoidance_delta: f64,
    pub commitment_delta: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
/// Compiles independent option propensities and marks. Multiple options may
/// mark in one transition; mutual-exclusion or winner selection, when needed,
/// must be authored as an additional ordinary law. Parameters are authored
/// hypotheses rather than inferred preferences or validated behavior.
pub struct DecisionProfile {
    pub id: String,
    pub holder: String,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    pub options: Vec<DecisionOption>,
    pub motives: Vec<DecisionMotive>,
    pub modes: DecisionModeParameters,
    pub action: DecisionActionRule,
    pub feedback: DecisionFeedback,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for DecisionProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "decision profile id")?;
        validate_segment(&self.holder, "decision holder")?;
        if self.options.len() < 2 {
            return Err(profile_error(
                "decision profile requires at least two options",
            ));
        }
        if self.motives.is_empty() {
            return Err(profile_error(
                "decision profile requires at least one motive",
            ));
        }
        for (label, value) in [
            ("deliberative weight", self.modes.deliberative_weight),
            ("habitual weight", self.modes.habitual_weight),
            ("impulsive weight", self.modes.impulsive_weight),
        ] {
            unit_interval(value, label)?;
        }
        positive(self.modes.commitment_rate, "commitment rate")?;
        if self.modes.deliberative_weight + self.modes.habitual_weight + self.modes.impulsive_weight
            <= 0.0
        {
            return Err(profile_error(
                "at least one decision mode weight must be positive",
            ));
        }
        for (label, value) in [
            ("attraction feedback", self.feedback.attraction_delta),
            ("avoidance feedback", self.feedback.avoidance_delta),
            ("commitment feedback", self.feedback.commitment_delta),
        ] {
            signed_unit(value, label)?;
        }
        match self.action {
            DecisionActionRule::Threshold { threshold } => {
                signed_unit(threshold, "decision threshold")?
            }
            DecisionActionRule::Hazard {
                base_rate,
                sensitivity,
            } => {
                positive(base_rate, "decision hazard base rate")?;
                positive(sensitivity, "decision hazard sensitivity")?;
            }
        }

        let provenance = profile_provenance(&self.provenance)?;
        let private_scopes = normalized_scopes(
            self.access_scopes.clone(),
            Some(format!("holder:{}", self.holder)),
        )?;
        let mut fragment = ProfileFragment::default();
        let base = format!("profile.{}.decision", self.id);
        let support = vec![format!("decision:{}", self.id)];
        let parameter_bounds = NumericBounds {
            minimum: 0.0,
            maximum: 1.0,
        };
        let mode_values = [
            (
                "deliberative",
                self.modes.deliberative_weight,
                parameter_bounds.clone(),
            ),
            (
                "habitual",
                self.modes.habitual_weight,
                parameter_bounds.clone(),
            ),
            ("impulsive", self.modes.impulsive_weight, parameter_bounds),
            (
                "commitment_rate",
                self.modes.commitment_rate,
                NumericBounds {
                    minimum: 0.0,
                    maximum: self.modes.commitment_rate.max(1.0) * 2.0,
                },
            ),
        ];
        for (name, value, bounds) in mode_values {
            fragment.processes.push(scalar_process(
                format!("{base}.mode.{name}"),
                value,
                bounds,
                &provenance,
                support.clone(),
                private_scopes.clone(),
                ProcessUpdateMode::Static,
                None,
                None,
                decision_scale(&self.id, None, "decision_mode"),
            ));
        }

        let option_ids: BTreeSet<_> = self
            .options
            .iter()
            .map(|option| option.id.as_str())
            .collect();
        if option_ids.len() != self.options.len() {
            return Err(profile_error("decision option ids must be unique"));
        }
        for option in &self.options {
            validate_segment(&option.id, "decision option id")?;
            for (label, value) in [
                ("objective option value", option.objective_value),
                ("perceived option value", option.perceived_value),
                ("habit strength", option.habit_strength),
                ("impulse bias", option.impulse_bias),
                ("initial commitment", option.initial_commitment),
            ] {
                signed_unit(value, label)?;
            }
        }

        let motive_ids: BTreeSet<_> = self
            .motives
            .iter()
            .map(|motive| motive.id.as_str())
            .collect();
        if motive_ids.len() != self.motives.len() {
            return Err(profile_error("decision motive ids must be unique"));
        }
        let mut motive_process_ids = BTreeMap::new();
        for motive in &self.motives {
            validate_segment(&motive.id, "decision motive id")?;
            unit_interval(motive.intensity, "decision motive intensity")?;
            for (option_id, weight) in &motive.option_weights {
                if !option_ids.contains(option_id.as_str()) {
                    return Err(profile_error(format!(
                        "motive {} weights unknown option {option_id}",
                        motive.id
                    )));
                }
                unit_interval(*weight, "decision motive option weight")?;
            }
            let id = format!("{base}.motive.{}", motive.id);
            motive_process_ids.insert(motive.id.as_str(), id.clone());
            fragment.processes.push(scalar_process(
                id,
                motive.intensity,
                NumericBounds {
                    minimum: 0.0,
                    maximum: 1.0,
                },
                &provenance,
                support.clone(),
                private_scopes.clone(),
                ProcessUpdateMode::Observed,
                None,
                None,
                decision_scale(&self.id, None, format!("{:?}", motive.kind).to_lowercase()),
            ));
        }

        let deliberative_id = format!("{base}.mode.deliberative");
        let habitual_id = format!("{base}.mode.habitual");
        let impulsive_id = format!("{base}.mode.impulsive");
        let commitment_rate_id = format!("{base}.mode.commitment_rate");
        let mut dependency_index = 0usize;
        for option in &self.options {
            let option_base = format!("{base}.option.{}", option.id);
            let objective_id = format!("{option_base}.objective");
            let perceived_id = format!("{option_base}.perceived");
            let habit_id = format!("{option_base}.habit");
            let impulse_id = format!("{option_base}.impulse");
            let attraction_feedback_id = format!("{option_base}.feedback.attraction");
            let avoidance_feedback_id = format!("{option_base}.feedback.avoidance");
            let attraction_id = format!("{option_base}.attraction");
            let avoidance_id = format!("{option_base}.avoidance");
            let commitment_id = format!("{option_base}.commitment");

            for (id, value, role, scopes, update_mode) in [
                (
                    objective_id.clone(),
                    option.objective_value,
                    "objective_option",
                    vec![],
                    ProcessUpdateMode::Static,
                ),
                (
                    perceived_id.clone(),
                    option.perceived_value,
                    "holder_perceived_option",
                    private_scopes.clone(),
                    ProcessUpdateMode::Observed,
                ),
                (
                    habit_id.clone(),
                    option.habit_strength,
                    "habit_strength",
                    private_scopes.clone(),
                    ProcessUpdateMode::Observed,
                ),
                (
                    impulse_id.clone(),
                    option.impulse_bias,
                    "impulse_bias",
                    private_scopes.clone(),
                    ProcessUpdateMode::Observed,
                ),
            ] {
                fragment.processes.push(scalar_process(
                    id,
                    value,
                    NumericBounds {
                        minimum: -1.0,
                        maximum: 1.0,
                    },
                    &provenance,
                    support.clone(),
                    scopes,
                    update_mode,
                    None,
                    None,
                    decision_scale(&self.id, Some(&option.id), role),
                ));
            }
            for (id, role) in [
                (
                    attraction_feedback_id.clone(),
                    "post_mark_attraction_feedback",
                ),
                (
                    avoidance_feedback_id.clone(),
                    "post_mark_avoidance_feedback",
                ),
            ] {
                fragment.processes.push(scalar_process(
                    id,
                    0.0,
                    NumericBounds {
                        minimum: -1.0,
                        maximum: 1.0,
                    },
                    &provenance,
                    support.clone(),
                    private_scopes.clone(),
                    ProcessUpdateMode::Unspecified,
                    None,
                    None,
                    decision_scale(&self.id, Some(&option.id), role),
                ));
            }
            for (id, initial, bounds, role) in [
                (
                    attraction_id.clone(),
                    0.5,
                    NumericBounds {
                        minimum: 0.0,
                        maximum: 1.0,
                    },
                    "attraction",
                ),
                (
                    avoidance_id.clone(),
                    0.5,
                    NumericBounds {
                        minimum: 0.0,
                        maximum: 1.0,
                    },
                    "avoidance",
                ),
                (
                    commitment_id.clone(),
                    option.initial_commitment,
                    NumericBounds {
                        minimum: -1.0,
                        maximum: 1.0,
                    },
                    "commitment",
                ),
            ] {
                fragment.processes.push(scalar_process(
                    id,
                    initial,
                    bounds,
                    &provenance,
                    support.clone(),
                    private_scopes.clone(),
                    ProcessUpdateMode::Unspecified,
                    None,
                    None,
                    decision_scale(&self.id, Some(&option.id), role),
                ));
            }

            fragment.initial_claims.push(Claim {
                id: format!("{option_base}.claim.perceived"),
                subject: perceived_id.clone(),
                value: ProcessValue::Scalar(option.perceived_value),
                uncertainty: ClaimUncertainty::Unknown,
                evidence_type: EvidenceType::CreativeHypothesis,
                holder: self.holder.clone(),
                evidence_cutoff: 0.0,
                provenance: provenance.clone(),
                authority: ClaimAuthority {
                    source: format!("profile:{}", self.id),
                    weight: 0.0,
                },
                mode: Some(ClaimMode::Simulated),
                value_time: Some(0.0),
                access_scopes: private_scopes.clone(),
            });

            let mut attraction_terms = vec![
                multiply(vec![process(&deliberative_id), process(&perceived_id)]),
                multiply(vec![process(&habitual_id), process(&habit_id)]),
                multiply(vec![process(&impulsive_id), process(&impulse_id)]),
                process(&attraction_feedback_id),
            ];
            let mut avoidance_terms = vec![
                multiply(vec![
                    process(&deliberative_id),
                    negate(process(&perceived_id)),
                ]),
                process(&avoidance_feedback_id),
            ];
            for motive in &self.motives {
                let weight = motive
                    .option_weights
                    .get(&option.id)
                    .copied()
                    .unwrap_or(0.0);
                if weight == 0.0 {
                    continue;
                }
                let term = multiply(vec![
                    constant(weight),
                    process(
                        motive_process_ids
                            .get(motive.id.as_str())
                            .expect("motive id was inserted"),
                    ),
                ]);
                match motive.kind {
                    DecisionMotiveKind::Fear => avoidance_terms.push(term),
                    DecisionMotiveKind::Want | DecisionMotiveKind::Drive => {
                        attraction_terms.push(term)
                    }
                }
            }
            let attraction_law_id = format!("{option_base}.derive.attraction");
            fragment.laws.push(law(
                attraction_law_id.clone(),
                LawOperator::Relation {
                    target: attraction_id.clone(),
                    value: logistic(add(attraction_terms)),
                },
                &provenance,
            ));
            let avoidance_law_id = format!("{option_base}.derive.avoidance");
            fragment.laws.push(law(
                avoidance_law_id.clone(),
                LawOperator::Relation {
                    target: avoidance_id.clone(),
                    value: logistic(add(avoidance_terms)),
                },
                &provenance,
            ));
            let commitment_law_id = format!("{option_base}.evolve.commitment");
            fragment.laws.push(law(
                commitment_law_id.clone(),
                LawOperator::Evolution {
                    target: commitment_id.clone(),
                    derivative: multiply(vec![
                        process(&commitment_rate_id),
                        subtract(
                            subtract(process(&attraction_id), process(&avoidance_id)),
                            process(&commitment_id),
                        ),
                    ]),
                    innovation: None,
                },
                &provenance,
            ));
            let action_law_id = format!("{option_base}.action");
            let trigger = match self.action {
                DecisionActionRule::Threshold { threshold } => OccurrenceTrigger::Threshold {
                    expression: process(&commitment_id),
                    comparison: Comparison::GreaterOrEqual,
                    threshold,
                    firing: TriggerFiring::OnEnter,
                },
                DecisionActionRule::Hazard {
                    base_rate,
                    sensitivity,
                } => OccurrenceTrigger::Hazard {
                    rate: multiply(vec![
                        constant(base_rate),
                        logistic(multiply(vec![
                            constant(sensitivity),
                            process(&commitment_id),
                        ])),
                    ]),
                },
            };
            fragment.laws.push(law(
                action_law_id.clone(),
                LawOperator::Occurrence {
                    trigger,
                    effects: vec![
                        StateEffect {
                            target: attraction_feedback_id.clone(),
                            mode: EffectMode::Set,
                            value: clamp(
                                add(vec![
                                    process(&attraction_feedback_id),
                                    constant(self.feedback.attraction_delta),
                                ]),
                                -1.0,
                                1.0,
                            ),
                        },
                        StateEffect {
                            target: avoidance_feedback_id.clone(),
                            mode: EffectMode::Set,
                            value: clamp(
                                add(vec![
                                    process(&avoidance_feedback_id),
                                    constant(self.feedback.avoidance_delta),
                                ]),
                                -1.0,
                                1.0,
                            ),
                        },
                        StateEffect {
                            target: commitment_id.clone(),
                            mode: EffectMode::Set,
                            value: clamp(
                                add(vec![
                                    process(&commitment_id),
                                    constant(self.feedback.commitment_delta),
                                ]),
                                -1.0,
                                1.0,
                            ),
                        },
                    ],
                    activates: vec![],
                },
                &provenance,
            ));

            for (source, target, kind, law_id, role) in [
                (
                    perceived_id.clone(),
                    attraction_id.clone(),
                    DependencyKind::Derives,
                    attraction_law_id.clone(),
                    "perception-attraction",
                ),
                (
                    attraction_feedback_id.clone(),
                    attraction_id.clone(),
                    DependencyKind::Derives,
                    attraction_law_id,
                    "feedback-attraction",
                ),
                (
                    perceived_id.clone(),
                    avoidance_id.clone(),
                    DependencyKind::Derives,
                    avoidance_law_id.clone(),
                    "perception-avoidance",
                ),
                (
                    avoidance_feedback_id.clone(),
                    avoidance_id.clone(),
                    DependencyKind::Derives,
                    avoidance_law_id,
                    "feedback-avoidance",
                ),
                (
                    attraction_id.clone(),
                    commitment_id.clone(),
                    DependencyKind::Causes,
                    commitment_law_id.clone(),
                    "attraction-commitment",
                ),
                (
                    avoidance_id.clone(),
                    commitment_id.clone(),
                    DependencyKind::Causes,
                    commitment_law_id,
                    "avoidance-commitment",
                ),
                (
                    commitment_id.clone(),
                    attraction_feedback_id,
                    DependencyKind::Causes,
                    action_law_id.clone(),
                    "action-attraction-feedback",
                ),
                (
                    commitment_id,
                    avoidance_feedback_id,
                    DependencyKind::Causes,
                    action_law_id,
                    "action-avoidance-feedback",
                ),
            ] {
                fragment.dependencies.push(dependency(
                    format!("{option_base}.dependency.{dependency_index}.{role}"),
                    source,
                    target,
                    kind,
                    law_id,
                ));
                dependency_index += 1;
            }
        }
        Ok(fragment)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpatialDimensions {
    Two,
    Three,
}

impl SpatialDimensions {
    fn count(self) -> usize {
        match self {
            Self::Two => 2,
            Self::Three => 3,
        }
    }

    fn axes(self) -> &'static [&'static str] {
        match self {
            Self::Two => &["x", "y"],
            Self::Three => &["x", "y", "z"],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SpatialEntity {
    pub id: String,
    pub position: Vec<f64>,
    pub velocity: Vec<f64>,
    pub position_bounds: NumericBounds,
    pub velocity_bounds: NumericBounds,
    #[serde(default)]
    pub access_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
/// Emits independent scalar coordinates and constant velocities. It does not
/// add geometry, collision handling, coordinate transforms, or observations.
pub struct ScalarSpatialProfile {
    pub id: String,
    pub reference_frame: String,
    pub unit: String,
    pub dimensions: SpatialDimensions,
    pub entities: Vec<SpatialEntity>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for ScalarSpatialProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "spatial profile id")?;
        validate_text(&self.reference_frame, "spatial reference frame")?;
        validate_text(&self.unit, "spatial unit")?;
        if self.entities.is_empty() {
            return Err(profile_error(
                "spatial profile requires at least one entity",
            ));
        }
        let provenance = profile_provenance(&self.provenance)?;
        let mut fragment = ProfileFragment::default();
        let base = format!("profile.{}.spatial", self.id);
        let dimension_count = self.dimensions.count();
        let entity_ids: BTreeSet<_> = self
            .entities
            .iter()
            .map(|entity| entity.id.as_str())
            .collect();
        if entity_ids.len() != self.entities.len() {
            return Err(profile_error("spatial entity ids must be unique"));
        }
        for entity in &self.entities {
            validate_segment(&entity.id, "spatial entity id")?;
            if entity.position.len() != dimension_count || entity.velocity.len() != dimension_count
            {
                return Err(profile_error(format!(
                    "spatial entity {} must provide {dimension_count} position and velocity coordinates",
                    entity.id
                )));
            }
            for (bounds, label) in [
                (&entity.position_bounds, "spatial position bounds"),
                (&entity.velocity_bounds, "spatial velocity bounds"),
            ] {
                finite(bounds.minimum, label)?;
                finite(bounds.maximum, label)?;
                if bounds.maximum <= bounds.minimum {
                    return Err(profile_error(format!("{label} must be increasing")));
                }
            }
            let scopes = normalized_scopes(entity.access_scopes.clone(), None)?;
            let entity_support = vec![
                format!("space:{}", self.id),
                format!("spatial_entity:{}", entity.id),
            ];
            for (index, axis) in self.dimensions.axes().iter().enumerate() {
                let position = entity.position[index];
                let velocity = entity.velocity[index];
                finite(position, "spatial position")?;
                finite(velocity, "spatial velocity")?;
                if position < entity.position_bounds.minimum
                    || position > entity.position_bounds.maximum
                    || velocity < entity.velocity_bounds.minimum
                    || velocity > entity.velocity_bounds.maximum
                {
                    return Err(profile_error(format!(
                        "spatial entity {} {axis} coordinate is outside its bounds",
                        entity.id
                    )));
                }
                let position_id = format!("{base}.entity.{}.position.{axis}", entity.id);
                let velocity_id = format!("{base}.entity.{}.velocity.{axis}", entity.id);
                fragment.processes.push(scalar_process(
                    position_id.clone(),
                    position,
                    entity.position_bounds.clone(),
                    &provenance,
                    entity_support.clone(),
                    scopes.clone(),
                    ProcessUpdateMode::Unspecified,
                    Some(self.unit.clone()),
                    Some(self.reference_frame.clone()),
                    BTreeMap::from([
                        ("semantic_role".to_owned(), "position".to_owned()),
                        ("axis".to_owned(), (*axis).to_owned()),
                    ]),
                ));
                fragment.processes.push(scalar_process(
                    velocity_id.clone(),
                    velocity,
                    entity.velocity_bounds.clone(),
                    &provenance,
                    entity_support.clone(),
                    scopes.clone(),
                    ProcessUpdateMode::Static,
                    Some(format!("{}/{}", self.unit, "time_unit")),
                    Some(self.reference_frame.clone()),
                    BTreeMap::from([
                        ("semantic_role".to_owned(), "velocity".to_owned()),
                        ("axis".to_owned(), (*axis).to_owned()),
                    ]),
                ));
                let law_id = format!("{base}.entity.{}.evolve.position.{axis}", entity.id);
                fragment.laws.push(law(
                    law_id.clone(),
                    LawOperator::Evolution {
                        target: position_id.clone(),
                        derivative: process(&velocity_id),
                        innovation: None,
                    },
                    &provenance,
                ));
                fragment.dependencies.push(dependency(
                    format!(
                        "{base}.entity.{}.dependency.velocity-position.{axis}",
                        entity.id
                    ),
                    velocity_id,
                    position_id,
                    DependencyKind::Causes,
                    law_id,
                ));
            }
        }
        Ok(fragment)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum StorytellingTier {
    Minimal,
    Social,
    Character,
    Creative,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StoryActor {
    pub id: String,
    pub personality_gravity: f64,
    pub situated_expression: f64,
    pub development: f64,
    pub growth: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DirectedStoryRelation {
    pub id: String,
    pub source_actor: String,
    pub target_actor: String,
    pub strength: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ReaderAffordance {
    pub id: String,
    pub cue: String,
    pub invited_response: String,
    pub baseline: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StorytellingDynamics {
    pub progress_rate: f64,
    pub social_tension_gain: f64,
    pub expression_adaptation_rate: f64,
    pub development_rate: f64,
    pub growth_rate: f64,
    pub novelty_rate: f64,
    pub affordance_coherence_weight: f64,
    pub affordance_novelty_weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
/// Emits authored narrative heuristics in cumulative tiers. Its state is not a
/// validated measure of character, creativity, or a reader's actual response.
pub struct CreativeStorytellingProfile {
    pub id: String,
    pub tier: StorytellingTier,
    pub initial_tension: f64,
    pub initial_coherence: f64,
    pub initial_progress: f64,
    pub initial_novelty: f64,
    #[serde(default)]
    pub actors: Vec<StoryActor>,
    #[serde(default)]
    pub directed_relations: Vec<DirectedStoryRelation>,
    #[serde(default)]
    pub reader_affordances: Vec<ReaderAffordance>,
    pub dynamics: StorytellingDynamics,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for CreativeStorytellingProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "storytelling profile id")?;
        for (label, value) in [
            ("initial tension", self.initial_tension),
            ("initial coherence", self.initial_coherence),
            ("initial progress", self.initial_progress),
            ("initial novelty", self.initial_novelty),
        ] {
            unit_interval(value, label)?;
        }
        nonnegative(self.dynamics.progress_rate, "story progress rate")?;
        signed_unit(self.dynamics.social_tension_gain, "social tension gain")?;
        nonnegative(
            self.dynamics.expression_adaptation_rate,
            "expression adaptation rate",
        )?;
        nonnegative(self.dynamics.development_rate, "development rate")?;
        nonnegative(self.dynamics.growth_rate, "growth rate")?;
        nonnegative(self.dynamics.novelty_rate, "novelty rate")?;
        signed_unit(
            self.dynamics.affordance_coherence_weight,
            "affordance coherence weight",
        )?;
        signed_unit(
            self.dynamics.affordance_novelty_weight,
            "affordance novelty weight",
        )?;

        let provenance = profile_provenance(&self.provenance)?;
        let scopes = normalized_scopes(self.access_scopes.clone(), None)?;
        let mut fragment = ProfileFragment::default();
        let base = format!("profile.{}.story", self.id);
        let support = vec![format!("story:{}", self.id)];
        let bounded = NumericBounds {
            minimum: 0.0,
            maximum: 1.0,
        };
        let tension_id = format!("{base}.minimal.tension");
        let coherence_id = format!("{base}.minimal.coherence");
        let progress_id = format!("{base}.minimal.progress");
        let progress_rate_id = format!("{base}.minimal.progress_rate");
        for (id, initial, role, update_mode) in [
            (
                tension_id.clone(),
                self.initial_tension,
                "narrative_tension",
                if self.tier >= StorytellingTier::Social {
                    ProcessUpdateMode::Unspecified
                } else {
                    ProcessUpdateMode::Static
                },
            ),
            (
                coherence_id.clone(),
                self.initial_coherence,
                "narrative_coherence",
                ProcessUpdateMode::Observed,
            ),
            (
                progress_id.clone(),
                self.initial_progress,
                "narrative_progress",
                ProcessUpdateMode::Unspecified,
            ),
        ] {
            fragment.processes.push(scalar_process(
                id,
                initial,
                bounded.clone(),
                &provenance,
                support.clone(),
                scopes.clone(),
                update_mode,
                None,
                None,
                BTreeMap::from([
                    ("story_tier".to_owned(), "minimal".to_owned()),
                    ("semantic_role".to_owned(), role.to_owned()),
                ]),
            ));
        }
        fragment.processes.push(scalar_process(
            progress_rate_id.clone(),
            self.dynamics.progress_rate,
            NumericBounds {
                minimum: 0.0,
                maximum: self.dynamics.progress_rate.max(1.0) * 2.0,
            },
            &provenance,
            support.clone(),
            scopes.clone(),
            ProcessUpdateMode::Static,
            None,
            None,
            BTreeMap::from([
                ("story_tier".to_owned(), "minimal".to_owned()),
                (
                    "semantic_role".to_owned(),
                    "narrative_progress_rate".to_owned(),
                ),
            ]),
        ));
        let progress_law_id = format!("{base}.minimal.evolve.progress");
        fragment.laws.push(law(
            progress_law_id.clone(),
            LawOperator::Evolution {
                target: progress_id.clone(),
                derivative: multiply(vec![
                    process(&progress_rate_id),
                    subtract(constant(1.0), process(&progress_id)),
                ]),
                innovation: None,
            },
            &provenance,
        ));
        fragment.dependencies.push(dependency(
            format!("{base}.minimal.dependency.progress-rate"),
            progress_rate_id,
            progress_id,
            DependencyKind::Causes,
            progress_law_id,
        ));

        let actor_ids: BTreeSet<_> = self.actors.iter().map(|actor| actor.id.as_str()).collect();
        if actor_ids.len() != self.actors.len() {
            return Err(profile_error("story actor ids must be unique"));
        }
        for actor in &self.actors {
            validate_segment(&actor.id, "story actor id")?;
            signed_unit(actor.personality_gravity, "personality gravity")?;
            signed_unit(actor.situated_expression, "situated expression")?;
            unit_interval(actor.development, "character development")?;
            unit_interval(actor.growth, "character growth")?;
        }

        if self.tier >= StorytellingTier::Social {
            if self.actors.len() < 2 || self.directed_relations.is_empty() {
                return Err(profile_error(
                    "social storytelling tier requires two actors and a directed relation",
                ));
            }
            let relation_ids: BTreeSet<_> = self
                .directed_relations
                .iter()
                .map(|relation| relation.id.as_str())
                .collect();
            if relation_ids.len() != self.directed_relations.len() {
                return Err(profile_error("directed story relation ids must be unique"));
            }
            for relation in &self.directed_relations {
                validate_segment(&relation.id, "directed story relation id")?;
                if relation.source_actor == relation.target_actor
                    || !actor_ids.contains(relation.source_actor.as_str())
                    || !actor_ids.contains(relation.target_actor.as_str())
                {
                    return Err(profile_error(format!(
                        "directed relation {} has invalid endpoints",
                        relation.id
                    )));
                }
                signed_unit(relation.strength, "directed relation strength")?;
                let relation_id = format!("{base}.social.relation.{}", relation.id);
                fragment.processes.push(scalar_process(
                    relation_id.clone(),
                    relation.strength,
                    NumericBounds {
                        minimum: -1.0,
                        maximum: 1.0,
                    },
                    &provenance,
                    support.clone(),
                    scopes.clone(),
                    ProcessUpdateMode::Observed,
                    None,
                    None,
                    BTreeMap::from([
                        ("story_tier".to_owned(), "social".to_owned()),
                        ("semantic_kind".to_owned(), "directed_relation".to_owned()),
                        ("source_actor".to_owned(), relation.source_actor.clone()),
                        ("target_actor".to_owned(), relation.target_actor.clone()),
                    ]),
                ));
                let law_id = format!("{base}.social.evolve.tension.{}", relation.id);
                fragment.laws.push(law(
                    law_id.clone(),
                    LawOperator::Evolution {
                        target: tension_id.clone(),
                        derivative: multiply(vec![
                            constant(self.dynamics.social_tension_gain),
                            subtract(constant(0.5), process(&relation_id)),
                            process(&tension_id),
                            subtract(constant(1.0), process(&tension_id)),
                        ]),
                        innovation: None,
                    },
                    &provenance,
                ));
                fragment.dependencies.push(dependency(
                    format!("{base}.social.dependency.{}.tension", relation.id),
                    relation_id,
                    tension_id.clone(),
                    DependencyKind::Causes,
                    law_id,
                ));
            }
        }

        if self.tier >= StorytellingTier::Character {
            if self.actors.is_empty() {
                return Err(profile_error("character tier requires at least one actor"));
            }
            for actor in &self.actors {
                let actor_base = format!("{base}.character.actor.{}", actor.id);
                let gravity_id = format!("{actor_base}.personality_gravity");
                let expression_id = format!("{actor_base}.situated_expression");
                let development_id = format!("{actor_base}.development");
                let growth_id = format!("{actor_base}.growth");
                for (id, initial, bounds, role, update_mode) in [
                    (
                        gravity_id.clone(),
                        actor.personality_gravity,
                        NumericBounds {
                            minimum: -1.0,
                            maximum: 1.0,
                        },
                        "personality_gravity",
                        ProcessUpdateMode::Static,
                    ),
                    (
                        expression_id.clone(),
                        actor.situated_expression,
                        NumericBounds {
                            minimum: -1.0,
                            maximum: 1.0,
                        },
                        "situated_expression",
                        ProcessUpdateMode::Unspecified,
                    ),
                    (
                        development_id.clone(),
                        actor.development,
                        bounded.clone(),
                        "development_within_current_organization",
                        ProcessUpdateMode::Unspecified,
                    ),
                    (
                        growth_id.clone(),
                        actor.growth,
                        bounded.clone(),
                        "growth_of_organization",
                        ProcessUpdateMode::Unspecified,
                    ),
                ] {
                    fragment.processes.push(scalar_process(
                        id,
                        initial,
                        bounds,
                        &provenance,
                        support.clone(),
                        scopes.clone(),
                        update_mode,
                        None,
                        None,
                        BTreeMap::from([
                            ("story_tier".to_owned(), "character".to_owned()),
                            ("semantic_role".to_owned(), role.to_owned()),
                        ]),
                    ));
                }
                let expression_law_id = format!("{actor_base}.evolve.situated_expression");
                fragment.laws.push(law(
                    expression_law_id.clone(),
                    LawOperator::Evolution {
                        target: expression_id.clone(),
                        derivative: multiply(vec![
                            constant(self.dynamics.expression_adaptation_rate),
                            subtract(process(&gravity_id), process(&expression_id)),
                        ]),
                        innovation: None,
                    },
                    &provenance,
                ));
                let development_law_id = format!("{actor_base}.evolve.development");
                fragment.laws.push(law(
                    development_law_id.clone(),
                    LawOperator::Evolution {
                        target: development_id.clone(),
                        derivative: multiply(vec![
                            constant(self.dynamics.development_rate),
                            absolute(subtract(process(&expression_id), process(&gravity_id))),
                            subtract(constant(1.0), process(&development_id)),
                        ]),
                        innovation: None,
                    },
                    &provenance,
                ));
                let growth_law_id = format!("{actor_base}.evolve.growth");
                fragment.laws.push(law(
                    growth_law_id.clone(),
                    LawOperator::Evolution {
                        target: growth_id.clone(),
                        derivative: multiply(vec![
                            constant(self.dynamics.growth_rate),
                            process(&development_id),
                            subtract(constant(1.0), process(&growth_id)),
                        ]),
                        innovation: None,
                    },
                    &provenance,
                ));
                fragment.dependencies.extend([
                    dependency(
                        format!("{actor_base}.dependency.gravity-expression"),
                        gravity_id,
                        expression_id.clone(),
                        DependencyKind::Causes,
                        expression_law_id,
                    ),
                    dependency(
                        format!("{actor_base}.dependency.expression-development"),
                        expression_id,
                        development_id.clone(),
                        DependencyKind::Causes,
                        development_law_id,
                    ),
                    dependency(
                        format!("{actor_base}.dependency.development-growth"),
                        development_id,
                        growth_id,
                        DependencyKind::Causes,
                        growth_law_id,
                    ),
                ]);
            }
        }

        if self.tier >= StorytellingTier::Creative {
            if self.reader_affordances.is_empty() {
                return Err(profile_error("creative tier requires a reader affordance"));
            }
            let novelty_id = format!("{base}.creative.novelty");
            let novelty_rate_id = format!("{base}.creative.novelty_rate");
            fragment.processes.push(scalar_process(
                novelty_id.clone(),
                self.initial_novelty,
                bounded.clone(),
                &provenance,
                support.clone(),
                scopes.clone(),
                ProcessUpdateMode::Unspecified,
                None,
                None,
                BTreeMap::from([
                    ("story_tier".to_owned(), "creative".to_owned()),
                    ("semantic_role".to_owned(), "creative_novelty".to_owned()),
                ]),
            ));
            fragment.processes.push(scalar_process(
                novelty_rate_id.clone(),
                self.dynamics.novelty_rate,
                NumericBounds {
                    minimum: 0.0,
                    maximum: self.dynamics.novelty_rate.max(1.0) * 2.0,
                },
                &provenance,
                support.clone(),
                scopes.clone(),
                ProcessUpdateMode::Static,
                None,
                None,
                BTreeMap::from([
                    ("story_tier".to_owned(), "creative".to_owned()),
                    (
                        "semantic_role".to_owned(),
                        "creative_novelty_rate".to_owned(),
                    ),
                ]),
            ));
            let novelty_law_id = format!("{base}.creative.evolve.novelty");
            fragment.laws.push(law(
                novelty_law_id.clone(),
                LawOperator::Evolution {
                    target: novelty_id.clone(),
                    derivative: multiply(vec![
                        process(&novelty_rate_id),
                        subtract(constant(1.0), process(&novelty_id)),
                    ]),
                    innovation: None,
                },
                &provenance,
            ));
            fragment.dependencies.push(dependency(
                format!("{base}.creative.dependency.novelty-rate"),
                novelty_rate_id,
                novelty_id.clone(),
                DependencyKind::Causes,
                novelty_law_id,
            ));
            let affordance_ids: BTreeSet<_> = self
                .reader_affordances
                .iter()
                .map(|affordance| affordance.id.as_str())
                .collect();
            if affordance_ids.len() != self.reader_affordances.len() {
                return Err(profile_error("reader affordance ids must be unique"));
            }
            for affordance in &self.reader_affordances {
                validate_segment(&affordance.id, "reader affordance id")?;
                validate_text(&affordance.cue, "reader affordance cue")?;
                validate_text(
                    &affordance.invited_response,
                    "reader affordance invited response",
                )?;
                unit_interval(affordance.baseline, "reader affordance baseline")?;
                let affordance_id = format!("{base}.creative.reader_affordance.{}", affordance.id);
                fragment.processes.push(scalar_process(
                    affordance_id.clone(),
                    affordance.baseline,
                    bounded.clone(),
                    &provenance,
                    support.clone(),
                    scopes.clone(),
                    ProcessUpdateMode::Unspecified,
                    None,
                    None,
                    BTreeMap::from([
                        ("story_tier".to_owned(), "creative".to_owned()),
                        ("semantic_kind".to_owned(), "reader_affordance".to_owned()),
                        ("direction".to_owned(), "text_to_reader".to_owned()),
                        ("cue".to_owned(), affordance.cue.clone()),
                        (
                            "invited_response".to_owned(),
                            affordance.invited_response.clone(),
                        ),
                        (
                            "claim_boundary".to_owned(),
                            "affordance_not_observed_reader_response".to_owned(),
                        ),
                    ]),
                ));
                let law_id = format!("{base}.creative.derive.reader_affordance.{}", affordance.id);
                fragment.laws.push(law(
                    law_id.clone(),
                    LawOperator::Relation {
                        target: affordance_id.clone(),
                        value: clamp(
                            add(vec![
                                constant(affordance.baseline),
                                multiply(vec![
                                    constant(self.dynamics.affordance_coherence_weight),
                                    process(&coherence_id),
                                ]),
                                multiply(vec![
                                    constant(self.dynamics.affordance_novelty_weight),
                                    process(&novelty_id),
                                ]),
                            ]),
                            0.0,
                            1.0,
                        ),
                    },
                    &provenance,
                ));
                fragment.dependencies.extend([
                    dependency(
                        format!(
                            "{base}.creative.dependency.coherence-affordance.{}",
                            affordance.id
                        ),
                        coherence_id.clone(),
                        affordance_id.clone(),
                        DependencyKind::Derives,
                        law_id.clone(),
                    ),
                    dependency(
                        format!(
                            "{base}.creative.dependency.novelty-affordance.{}",
                            affordance.id
                        ),
                        novelty_id.clone(),
                        affordance_id,
                        DependencyKind::Derives,
                        law_id,
                    ),
                ]);
            }
        }
        Ok(fragment)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PersonEvidenceCoordinate {
    pub id: String,
    pub value: f64,
    pub bounds: NumericBounds,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
    pub evidence_type: EvidenceType,
    pub holder: String,
    pub authority: ClaimAuthority,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum PersonModelViewKind {
    ExternalDescriptive,
    CandidateActor,
    SelfReported,
}

impl PersonModelViewKind {
    fn name(self) -> &'static str {
        match self {
            Self::ExternalDescriptive => "external_descriptive",
            Self::CandidateActor => "candidate_actor",
            Self::SelfReported => "self_reported",
        }
    }

    fn evidence(self) -> (EvidenceType, ClaimMode, &'static str) {
        match self {
            Self::ExternalDescriptive | Self::CandidateActor => (
                EvidenceType::Estimate,
                ClaimMode::Estimated,
                "estimate_not_operative_model",
            ),
            Self::SelfReported => (
                EvidenceType::Report,
                ClaimMode::Observed,
                "report_not_operative_model",
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PersonModelView {
    pub id: String,
    pub kind: PersonModelViewKind,
    pub holder: String,
    pub estimator: String,
    pub authority_weight: f64,
    /// This sentinel is accepted only so callers receive an explicit semantic
    /// error instead of accidentally treating an estimate or report as the
    /// actor's unknown operative organization.
    #[serde(default)]
    pub claims_operative_authority: bool,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    pub nodes: Vec<SubjectiveGraphNode>,
    #[serde(default)]
    pub edges: Vec<SubjectiveGraphEdge>,
}

/// The optional health opening used by [`PersonScaffoldProfile`]. The three
/// values answer one local Cut question and therefore sum to one; they are not
/// a clinical score or a tenth top-level life process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PersonHealthCondition {
    pub healthy_functioning: f64,
    pub illness_burden: f64,
    pub remainder: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersonScaffoldLevel {
    Lifecycle,
    #[default]
    Processes,
}

/// A small, named authoring template for loading one complete coarse person.
///
/// It creates identity, a lifecycle Event, and the nine concurrent `IS`
/// process addresses used by the first Book construction. The processes do not
/// form a Cut and receive no psychological scores. WHAT, HOW, FEELS, context,
/// direction, periods, and episodes remain closed until the author supplies a
/// scene or temporal decomposition. This is a convenience profile over the
/// ordinary IR, not a second runtime or a universal theory of persons.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PersonScaffoldProfile {
    pub id: String,
    pub subject_id: String,
    pub person_boundary: String,
    pub continuity_criterion: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    pub life_description: String,
    #[serde(default)]
    pub level: PersonScaffoldLevel,
    #[serde(default)]
    pub health: Option<PersonHealthCondition>,
    pub provenance: Vec<String>,
}

const PERSON_SCAFFOLD_PROFILE_VERSION: &str = "book-person/v1";
const PERSON_SCAFFOLD_IS_PROCESSES: [(&str, &str); 9] = [
    (
        "body",
        "growth, embodiment, physical capacity, disability, aging, and mortality",
    ),
    ("kin", "family, household, dependency, support, and rupture"),
    (
        "partnership",
        "participation in joint relationships and the person's readings of them",
    ),
    (
        "work",
        "roles, projects, labor, duties, and institutional work",
    ),
    (
        "place",
        "residence, presence, access, travel, and spatial constraint",
    ),
    ("means", "money, time, tools, capacity, debt, and runway"),
    (
        "knowledge",
        "perception, belief, learning, correction, and capability",
    ),
    (
        "standing",
        "office, audience, attributed recognition, and reputation",
    ),
    (
        "meaning",
        "constitutive aims, commitments, and self-understanding",
    ),
];

impl OptionalModelProfile for PersonScaffoldProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "person scaffold profile id")?;
        validate_segment(&self.subject_id, "person scaffold subject id")?;
        validate_text(&self.person_boundary, "person scaffold boundary")?;
        validate_text(
            &self.continuity_criterion,
            "person scaffold continuity criterion",
        )?;
        validate_text(&self.life_description, "person scaffold life description")?;
        if self.level == PersonScaffoldLevel::Lifecycle && self.health.is_some() {
            return Err(profile_error(
                "person scaffold health requires level processes",
            ));
        }
        if let Some(interval) = &self.interval {
            finite(interval.start, "person scaffold interval start")?;
            finite(interval.end, "person scaffold interval end")?;
            if interval.end < interval.start {
                return Err(profile_error("person scaffold interval must be ordered"));
            }
        }
        if let Some(health) = &self.health {
            for (label, value) in [
                ("healthy functioning", health.healthy_functioning),
                ("illness burden", health.illness_burden),
                ("health remainder", health.remainder),
            ] {
                unit_interval(value, label)?;
            }
            let total = health.healthy_functioning + health.illness_burden + health.remainder;
            if (total - 1.0).abs() > 1e-9 {
                return Err(profile_error(format!(
                    "person health Cut must sum to one; got {total}"
                )));
            }
        }

        let provenance = profile_provenance(&self.provenance)?;
        let base = format!("profile.{}.person.{}", self.id, self.subject_id);
        let referent_id = format!("referent.{base}");
        let life_event_id = format!("event.{base}.life");
        let life_index_id = format!("{base}.life.index");
        let mut fragment = ProfileFragment::default();

        fragment.processes.push(ProcessDefinition {
            id: life_index_id.clone(),
            value_type: ProcessType::Graph,
            initial_value: ProcessValue::Graph(GraphValue {
                nodes: vec![],
                edges: vec![],
            }),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            axes: vec![],
            unit: None,
            reference_frame: Some(format!("person-life:{}", self.id)),
            scale: BTreeMap::from([
                (
                    "semantic_role".to_owned(),
                    "person_lifecycle_index".to_owned(),
                ),
                (
                    "profile_version".to_owned(),
                    PERSON_SCAFFOLD_PROFILE_VERSION.to_owned(),
                ),
                ("subject_referent_id".to_owned(), referent_id.clone()),
            ]),
            support: vec![format!("person_scaffold:{}", self.id)],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Observed,
        });

        let mut meaning = empty_meaning_model();
        meaning.referents.push(ReferentDefinition {
            id: referent_id.clone(),
            boundary: self.person_boundary.clone(),
            continuity_criterion: self.continuity_criterion.clone(),
            interval: self.interval.clone(),
            lifecycle_event_id: Some(life_event_id.clone()),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        });
        meaning.events.push(MeaningEventDefinition {
            id: life_event_id.clone(),
            boundary: self.life_description.clone(),
            description: None,
            interval: self.interval.clone(),
            process_ids: vec![life_index_id],
            observation_process_ids: vec![],
            participants: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
            substrate: None,
            region: None,
            provenance: provenance.clone(),
        });
        meaning.event_referent_bindings.push(EventReferentBinding {
            id: format!("binding.{base}.life.subject"),
            target: EventReferentBindingTarget::Event {
                event_id: life_event_id.clone(),
            },
            role: "subject".to_owned(),
            referent_id: referent_id.clone(),
            binding_type: "lifecycle_subject".to_owned(),
            interval: self.interval.clone(),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        });

        let mut body_event_id = None;
        if self.level == PersonScaffoldLevel::Processes {
            for (key, description) in PERSON_SCAFFOLD_IS_PROCESSES {
                let process_id = format!("{base}.is.{key}");
                let event_id = format!("event.{base}.is.{key}");
                if key == "body" {
                    body_event_id = Some(event_id.clone());
                }
                fragment.processes.push(ProcessDefinition {
                    id: process_id.clone(),
                    value_type: ProcessType::Graph,
                    initial_value: ProcessValue::Graph(GraphValue {
                        nodes: vec![],
                        edges: vec![],
                    }),
                    uncertainty: ClaimUncertainty::Unknown,
                    provenance: provenance.clone(),
                    axes: vec![],
                    unit: None,
                    reference_frame: Some(format!("person-is:{}", self.id)),
                    scale: BTreeMap::from([
                        ("semantic_role".to_owned(), "person_is_process".to_owned()),
                        ("process_key".to_owned(), key.to_owned()),
                        (
                            "relationship".to_owned(),
                            "concurrent_non_summing".to_owned(),
                        ),
                        (
                            "profile_version".to_owned(),
                            PERSON_SCAFFOLD_PROFILE_VERSION.to_owned(),
                        ),
                        ("subject_referent_id".to_owned(), referent_id.clone()),
                    ]),
                    support: vec![life_event_id.clone()],
                    access_scopes: vec![],
                    update_mode: ProcessUpdateMode::Observed,
                });
                meaning.events.push(MeaningEventDefinition {
                    id: event_id.clone(),
                    boundary: format!("{key} process for {}: {description}", self.subject_id),
                    description: None,
                    interval: self.interval.clone(),
                    process_ids: vec![process_id],
                    observation_process_ids: vec![],
                    participants: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
                    substrate: Some(life_event_id.clone()),
                    region: None,
                    provenance: provenance.clone(),
                });
                meaning.event_relations.push(EventRelationDefinition {
                    id: format!("relation.{base}.life.contains.{key}"),
                    source_event_id: life_event_id.clone(),
                    target_event_id: event_id.clone(),
                    kind: EventRelationKind::Contains,
                    description: None,
                    uncertainty: ClaimUncertainty::Unknown,
                    provenance: provenance.clone(),
                    authority: None,
                });
                meaning.event_referent_bindings.push(EventReferentBinding {
                    id: format!("binding.{base}.is.{key}.subject"),
                    target: EventReferentBindingTarget::Event {
                        event_id: event_id.clone(),
                    },
                    role: "subject".to_owned(),
                    referent_id: referent_id.clone(),
                    binding_type: "person_process_subject".to_owned(),
                    interval: self.interval.clone(),
                    uncertainty: ClaimUncertainty::Unknown,
                    provenance: provenance.clone(),
                    authority: None,
                });
            }
        }

        if let Some(health) = &self.health {
            let body_event_id = body_event_id.expect("body is part of the fixed person scaffold");
            let process_id = format!("{base}.is.body.health.condition");
            let event_id = format!("event.{base}.is.body.health");
            fragment.processes.push(ProcessDefinition {
                id: process_id.clone(),
                value_type: ProcessType::Distribution {
                    outcomes: vec![
                        "healthy_functioning".to_owned(),
                        "illness_burden".to_owned(),
                        "remainder".to_owned(),
                    ],
                },
                initial_value: ProcessValue::Distribution(vec![
                    health.healthy_functioning,
                    health.illness_burden,
                    health.remainder,
                ]),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                axes: vec![],
                unit: Some("one current bodily health condition".to_owned()),
                reference_frame: Some(format!("person-health:{}", self.id)),
                scale: BTreeMap::from([
                    (
                        "semantic_role".to_owned(),
                        "health_condition_cut".to_owned(),
                    ),
                    (
                        "question".to_owned(),
                        "how is current bodily health condition divided".to_owned(),
                    ),
                    (
                        "profile_version".to_owned(),
                        PERSON_SCAFFOLD_PROFILE_VERSION.to_owned(),
                    ),
                    ("subject_referent_id".to_owned(), referent_id.clone()),
                ]),
                support: vec![body_event_id.clone()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Observed,
            });
            meaning.events.push(MeaningEventDefinition {
                id: event_id.clone(),
                description: None,
                boundary: format!(
                    "health process for {}: healthy functioning, illness burden, and unresolved remainder",
                    self.subject_id
                ),
                interval: self.interval.clone(),
                process_ids: vec![process_id],
                observation_process_ids: vec![],
                participants: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
                substrate: Some(body_event_id.clone()),
                region: None,
                provenance: provenance.clone(),
            });
            meaning.event_relations.push(EventRelationDefinition {
                id: format!("relation.{base}.body.contains.health"),
                source_event_id: body_event_id,
                target_event_id: event_id.clone(),
                kind: EventRelationKind::Contains,
                description: None,
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                authority: None,
            });
            meaning.event_referent_bindings.push(EventReferentBinding {
                id: format!("binding.{base}.is.body.health.subject"),
                target: EventReferentBindingTarget::Event { event_id },
                role: "subject".to_owned(),
                referent_id,
                binding_type: "person_health_subject".to_owned(),
                interval: self.interval.clone(),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                authority: None,
            });
        }

        fragment.meaning_model = Some(meaning);
        Ok(fragment)
    }
}

/// A deliberately sparse authoring profile for one bounded person interval.
/// It emits one evidence-bearing event and three non-interchangeable families
/// of view: external description, alternative candidate actor models, and the
/// person's reported self-model. It never claims access to the latent
/// operative model and does not prescribe a personality ontology.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PersonProfile {
    pub id: String,
    pub subject_id: String,
    pub person_boundary: String,
    pub continuity_criterion: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    pub evidence_boundary: String,
    pub evidence: Vec<PersonEvidenceCoordinate>,
    pub position_bounds: NumericBounds,
    pub views: Vec<PersonModelView>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for PersonProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "person profile id")?;
        validate_segment(&self.subject_id, "person subject id")?;
        validate_text(&self.person_boundary, "person boundary")?;
        validate_text(&self.continuity_criterion, "person continuity criterion")?;
        validate_text(&self.evidence_boundary, "person evidence boundary")?;
        finite(self.position_bounds.minimum, "person view position minimum")?;
        finite(self.position_bounds.maximum, "person view position maximum")?;
        if self.position_bounds.maximum <= self.position_bounds.minimum {
            return Err(profile_error(
                "person view position bounds must be increasing",
            ));
        }
        if let Some(interval) = &self.interval {
            finite(interval.start, "person interval start")?;
            finite(interval.end, "person interval end")?;
            if interval.end < interval.start || interval.start > 0.0 || interval.end < 0.0 {
                return Err(profile_error(
                    "person profile interval must be ordered and contain genesis time 0",
                ));
            }
        }
        if self.evidence.is_empty() {
            return Err(profile_error(
                "person profile requires at least one observed or reported evidence coordinate",
            ));
        }
        if self.views.is_empty() {
            return Err(profile_error("person profile requires linked views"));
        }

        let evidence_ids: BTreeSet<_> = self.evidence.iter().map(|item| item.id.as_str()).collect();
        if evidence_ids.len() != self.evidence.len() {
            return Err(profile_error(
                "person evidence coordinate ids must be unique",
            ));
        }
        for coordinate in &self.evidence {
            validate_segment(&coordinate.id, "person evidence coordinate id")?;
            validate_segment(&coordinate.holder, "person evidence holder")?;
            finite(coordinate.bounds.minimum, "person evidence minimum")?;
            finite(coordinate.bounds.maximum, "person evidence maximum")?;
            if coordinate.bounds.maximum <= coordinate.bounds.minimum
                || coordinate.value < coordinate.bounds.minimum
                || coordinate.value > coordinate.bounds.maximum
            {
                return Err(profile_error(format!(
                    "person evidence coordinate {} has invalid bounds or value",
                    coordinate.id
                )));
            }
            if !matches!(
                coordinate.evidence_type,
                EvidenceType::Observation | EvidenceType::Report
            ) {
                return Err(profile_error(format!(
                    "person evidence coordinate {} must be observation or report evidence",
                    coordinate.id
                )));
            }
            validate_text(
                &coordinate.authority.source,
                "person evidence authority source",
            )?;
            unit_interval(
                coordinate.authority.weight,
                "person evidence authority weight",
            )?;
            if coordinate
                .unit
                .as_deref()
                .is_some_and(|unit| unit.trim().is_empty())
            {
                return Err(profile_error("person evidence unit must be nonempty"));
            }
        }

        let view_ids: BTreeSet<_> = self.views.iter().map(|view| view.id.as_str()).collect();
        if view_ids.len() != self.views.len() {
            return Err(profile_error("person view ids must be unique"));
        }
        let mut kind_counts = BTreeMap::new();
        for view in &self.views {
            validate_segment(&view.id, "person view id")?;
            validate_segment(&view.holder, "person view holder")?;
            validate_segment(&view.estimator, "person view estimator")?;
            unit_interval(view.authority_weight, "person view authority weight")?;
            if view.claims_operative_authority {
                return Err(profile_error(format!(
                    "person view {} cannot claim latent operative-model authority",
                    view.id
                )));
            }
            if view.kind == PersonModelViewKind::SelfReported
                && (view.holder != self.subject_id || view.estimator != self.subject_id)
            {
                return Err(profile_error(
                    "self-reported view holder and estimator must equal the person subject id",
                ));
            }
            if view.nodes.is_empty() {
                return Err(profile_error(format!(
                    "person view {} requires at least one node",
                    view.id
                )));
            }
            let node_ids: BTreeSet<_> = view.nodes.iter().map(|node| node.id.as_str()).collect();
            if node_ids.len() != view.nodes.len() {
                return Err(profile_error(format!(
                    "person view {} node ids must be unique",
                    view.id
                )));
            }
            for node in &view.nodes {
                validate_segment(&node.id, "person view node id")?;
                finite(node.position, "person view node position")?;
                if node.position < self.position_bounds.minimum
                    || node.position > self.position_bounds.maximum
                {
                    return Err(profile_error(format!(
                        "person view {} node {} is outside position bounds",
                        view.id, node.id
                    )));
                }
            }
            let mut edge_keys = BTreeSet::new();
            for edge in &view.edges {
                validate_text(&edge.relation, "person view edge relation")?;
                if !node_ids.contains(edge.source.as_str())
                    || !node_ids.contains(edge.target.as_str())
                    || !edge_keys.insert((
                        edge.source.as_str(),
                        edge.target.as_str(),
                        edge.relation.as_str(),
                    ))
                {
                    return Err(profile_error(format!(
                        "person view {} contains an invalid or duplicate edge",
                        view.id
                    )));
                }
            }
            *kind_counts.entry(view.kind).or_insert(0usize) += 1;
        }
        if kind_counts.get(&PersonModelViewKind::ExternalDescriptive) != Some(&1)
            || kind_counts.get(&PersonModelViewKind::SelfReported) != Some(&1)
            || kind_counts
                .get(&PersonModelViewKind::CandidateActor)
                .copied()
                .unwrap_or(0)
                == 0
        {
            return Err(profile_error(
                "person profile requires exactly one external descriptive view, one self-reported view, and at least one candidate actor view",
            ));
        }

        let provenance = profile_provenance(&self.provenance)?;
        let base = format!("profile.{}.person", self.id);
        let evidence_event_id = format!("event.{base}.evidence");
        let referent_id = format!("referent.{base}.{}", self.subject_id);
        let mut fragment = ProfileFragment::default();
        let mut evidence_process_ids = Vec::with_capacity(self.evidence.len());

        for coordinate in &self.evidence {
            let process_id = format!("{base}.evidence.{}", coordinate.id);
            let scopes = normalized_scopes(coordinate.access_scopes.clone(), None)?;
            fragment.processes.push(ProcessDefinition {
                id: process_id.clone(),
                value_type: ProcessType::Scalar {
                    bounds: coordinate.bounds.clone(),
                },
                initial_value: ProcessValue::Scalar(coordinate.value),
                uncertainty: coordinate.uncertainty.clone(),
                provenance: provenance.clone(),
                axes: vec![],
                unit: coordinate.unit.clone(),
                reference_frame: Some(format!("person-evidence:{}", self.id)),
                scale: BTreeMap::from([
                    ("semantic_role".to_owned(), "person_evidence".to_owned()),
                    ("subject_referent_id".to_owned(), referent_id.clone()),
                    (
                        "evidence_type".to_owned(),
                        match coordinate.evidence_type {
                            EvidenceType::Observation => "observation",
                            EvidenceType::Report => "report",
                            _ => unreachable!("validated evidence type"),
                        }
                        .to_owned(),
                    ),
                ]),
                support: vec![evidence_event_id.clone()],
                access_scopes: scopes.clone(),
                update_mode: ProcessUpdateMode::Observed,
            });
            fragment.initial_claims.push(Claim {
                id: format!("{process_id}.claim"),
                subject: process_id.clone(),
                value: ProcessValue::Scalar(coordinate.value),
                uncertainty: coordinate.uncertainty.clone(),
                evidence_type: coordinate.evidence_type,
                holder: coordinate.holder.clone(),
                evidence_cutoff: 0.0,
                provenance: provenance.clone(),
                authority: coordinate.authority.clone(),
                mode: Some(ClaimMode::Observed),
                value_time: Some(0.0),
                access_scopes: scopes,
            });
            evidence_process_ids.push(process_id);
        }

        let mut meaning = empty_meaning_model();
        meaning.referents.push(ReferentDefinition {
            id: referent_id.clone(),
            boundary: self.person_boundary.clone(),
            continuity_criterion: self.continuity_criterion.clone(),
            interval: self.interval.clone(),
            lifecycle_event_id: Some(evidence_event_id.clone()),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        });
        meaning.events.push(MeaningEventDefinition {
            id: evidence_event_id.clone(),
            boundary: self.evidence_boundary.clone(),
            description: None,
            interval: self.interval.clone(),
            process_ids: evidence_process_ids.clone(),
            observation_process_ids: evidence_process_ids.clone(),
            participants: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
            substrate: None,
            region: None,
            provenance: provenance.clone(),
        });
        meaning.event_referent_bindings.push(EventReferentBinding {
            id: format!("binding.{base}.evidence.subject"),
            target: EventReferentBindingTarget::Event {
                event_id: evidence_event_id.clone(),
            },
            role: "subject".to_owned(),
            referent_id: referent_id.clone(),
            binding_type: "evidence_about".to_owned(),
            interval: self.interval.clone(),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        });

        for kind in [
            PersonModelViewKind::ExternalDescriptive,
            PersonModelViewKind::CandidateActor,
            PersonModelViewKind::SelfReported,
        ] {
            meaning.concepts.push(ConceptDefinition {
                id: format!("concept.{base}.view.{}", kind.name()),
                label: Some(kind.name().replace('_', " ")),
                differentia: vec![
                    "viewpoint-indexed representation, not latent operative truth".to_owned(),
                ],
                boundary: Some(format!(
                    "one {} representation of the bounded person interval",
                    kind.name()
                )),
                state_schema: BTreeMap::from([
                    ("topology".to_owned(), "graph".to_owned()),
                    ("node_position".to_owned(), "bounded scalar".to_owned()),
                ]),
                direction_families: vec!["reported or estimated revision".to_owned()],
                observation_methods: vec!["shared evidence event".to_owned()],
                provenance: provenance.clone(),
            });
        }

        for view in &self.views {
            let view_base = format!("{base}.view.{}", view.id);
            let view_event_id = format!("event.{view_base}");
            let topology_id = format!("{view_base}.topology");
            let scopes = normalized_scopes(
                view.access_scopes.clone(),
                Some(format!("holder:{}", view.holder)),
            )?;
            let mut graph_nodes: Vec<_> = view.nodes.iter().map(|node| node.id.clone()).collect();
            graph_nodes.sort();
            let mut graph_edges: Vec<_> = view
                .edges
                .iter()
                .map(|edge| GraphEdgeValue {
                    source: edge.source.clone(),
                    target: edge.target.clone(),
                    relation: edge.relation.clone(),
                })
                .collect();
            graph_edges.sort_by(|left, right| {
                (&left.source, &left.target, &left.relation).cmp(&(
                    &right.source,
                    &right.target,
                    &right.relation,
                ))
            });
            let graph = GraphValue {
                nodes: graph_nodes,
                edges: graph_edges,
            };
            let (evidence_type, mode, epistemic_boundary) = view.kind.evidence();
            let view_scale = BTreeMap::from([
                ("semantic_role".to_owned(), "person_model_view".to_owned()),
                ("view_kind".to_owned(), view.kind.name().to_owned()),
                ("view_id".to_owned(), view.id.clone()),
                ("subject_referent_id".to_owned(), referent_id.clone()),
                ("holder".to_owned(), view.holder.clone()),
                ("estimator".to_owned(), view.estimator.clone()),
                (
                    "epistemic_boundary".to_owned(),
                    epistemic_boundary.to_owned(),
                ),
            ]);
            fragment.processes.push(ProcessDefinition {
                id: topology_id.clone(),
                value_type: ProcessType::Graph,
                initial_value: ProcessValue::Graph(graph.clone()),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                axes: vec![],
                unit: None,
                reference_frame: Some(format!("person-view:{}:{}", self.id, view.id)),
                scale: view_scale.clone(),
                support: vec![evidence_event_id.clone()],
                access_scopes: scopes.clone(),
                update_mode: ProcessUpdateMode::Observed,
            });
            fragment.initial_claims.push(Claim {
                id: format!("{view_base}.claim.topology"),
                subject: topology_id.clone(),
                value: ProcessValue::Graph(graph),
                uncertainty: ClaimUncertainty::Unknown,
                evidence_type,
                holder: view.holder.clone(),
                evidence_cutoff: 0.0,
                provenance: provenance.clone(),
                authority: ClaimAuthority {
                    source: view.estimator.clone(),
                    weight: view.authority_weight,
                },
                mode: Some(mode),
                value_time: Some(0.0),
                access_scopes: scopes.clone(),
            });
            let mut view_process_ids = vec![topology_id.clone()];
            for node in &view.nodes {
                let position_id = format!("{view_base}.node.{}.position", node.id);
                let mut node_scale = view_scale.clone();
                node_scale.insert("node".to_owned(), node.id.clone());
                fragment.processes.push(ProcessDefinition {
                    id: position_id.clone(),
                    value_type: ProcessType::Scalar {
                        bounds: self.position_bounds.clone(),
                    },
                    initial_value: ProcessValue::Scalar(node.position),
                    uncertainty: node.uncertainty.clone(),
                    provenance: provenance.clone(),
                    axes: vec![],
                    unit: None,
                    reference_frame: Some(format!("person-view:{}:{}", self.id, view.id)),
                    scale: node_scale,
                    support: vec![evidence_event_id.clone(), topology_id.clone()],
                    access_scopes: scopes.clone(),
                    update_mode: ProcessUpdateMode::Observed,
                });
                fragment.initial_claims.push(Claim {
                    id: format!("{view_base}.claim.node.{}.position", node.id),
                    subject: position_id.clone(),
                    value: ProcessValue::Scalar(node.position),
                    uncertainty: node.uncertainty.clone(),
                    evidence_type,
                    holder: view.holder.clone(),
                    evidence_cutoff: 0.0,
                    provenance: provenance.clone(),
                    authority: ClaimAuthority {
                        source: view.estimator.clone(),
                        weight: view.authority_weight,
                    },
                    mode: Some(mode),
                    value_time: Some(0.0),
                    access_scopes: scopes.clone(),
                });
                for (evidence_index, evidence_id) in evidence_process_ids.iter().enumerate() {
                    fragment.dependencies.push(DependencyEdge {
                        id: format!("{view_base}.evidence.{evidence_index}.observes.{}", node.id),
                        source: evidence_id.clone(),
                        target: position_id.clone(),
                        kind: DependencyKind::Observes,
                        law_id: None,
                    });
                }
                view_process_ids.push(position_id);
            }
            meaning.events.push(MeaningEventDefinition {
                id: view_event_id.clone(),
                description: None,
                boundary: format!(
                    "{} view {} of person {} over the shared evidence interval",
                    view.kind.name(),
                    view.id,
                    self.subject_id
                ),
                interval: self.interval.clone(),
                process_ids: view_process_ids,
                observation_process_ids: vec![],
                participants: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
                substrate: Some(evidence_event_id.clone()),
                region: None,
                provenance: provenance.clone(),
            });
            meaning.event_referent_bindings.push(EventReferentBinding {
                id: format!("binding.{view_base}.subject"),
                target: EventReferentBindingTarget::Event {
                    event_id: view_event_id.clone(),
                },
                role: "about".to_owned(),
                referent_id: referent_id.clone(),
                binding_type: "representation_about".to_owned(),
                interval: self.interval.clone(),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                authority: Some(ClaimAuthority {
                    source: view.estimator.clone(),
                    weight: view.authority_weight,
                }),
            });
            meaning.realizations.push(RealizationRecord {
                id: format!("realization.{view_base}"),
                concept_id: format!("concept.{base}.view.{}", view.kind.name()),
                purpose: RealizationPurpose::Describe,
                abstract_cut_id: None,
                physical_cut_id: None,
                roles: BTreeMap::from([("model_event".to_owned(), view_event_id)]),
                referent_roles: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
                parameters: BTreeMap::from([
                    (
                        "view_id".to_owned(),
                        serde_json::Value::String(view.id.clone()),
                    ),
                    (
                        "estimator".to_owned(),
                        serde_json::Value::String(view.estimator.clone()),
                    ),
                    (
                        "epistemic_boundary".to_owned(),
                        serde_json::Value::String(epistemic_boundary.to_owned()),
                    ),
                ]),
                degree: 1.0,
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                viewpoint: format!("holder:{}", view.holder),
                authority: Some(ClaimAuthority {
                    source: view.estimator.clone(),
                    weight: view.authority_weight,
                }),
            });
        }
        fragment.meaning_model = Some(meaning);
        Ok(fragment)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SubjectiveGraphNode {
    pub id: String,
    pub position: f64,
    #[serde(default)]
    pub uncertainty: ClaimUncertainty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SubjectiveGraphEdge {
    pub source: String,
    pub target: String,
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HolderSubjectiveGraph {
    pub holder: String,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    pub authority_weight: f64,
    pub nodes: Vec<SubjectiveGraphNode>,
    #[serde(default)]
    pub edges: Vec<SubjectiveGraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
/// Emits holder-scoped claim state and topology. Different holders need not
/// agree, and no emitted claim is promoted to shared-world truth.
pub struct SubjectiveHolderGraphProfile {
    pub id: String,
    pub position_bounds: NumericBounds,
    pub holders: Vec<HolderSubjectiveGraph>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for SubjectiveHolderGraphProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "subjective-holder graph profile id")?;
        finite(self.position_bounds.minimum, "subjective position minimum")?;
        finite(self.position_bounds.maximum, "subjective position maximum")?;
        if self.position_bounds.maximum <= self.position_bounds.minimum {
            return Err(profile_error(
                "subjective position bounds must be increasing",
            ));
        }
        if self.holders.is_empty() {
            return Err(profile_error(
                "subjective-holder graph profile requires at least one holder",
            ));
        }
        let holder_ids: BTreeSet<_> = self
            .holders
            .iter()
            .map(|holder| holder.holder.as_str())
            .collect();
        if holder_ids.len() != self.holders.len() {
            return Err(profile_error("subjective holder ids must be unique"));
        }
        let provenance = profile_provenance(&self.provenance)?;
        let mut fragment = ProfileFragment::default();
        let base = format!("profile.{}.subjective", self.id);
        for holder in &self.holders {
            validate_segment(&holder.holder, "subjective graph holder")?;
            unit_interval(
                holder.authority_weight,
                "subjective holder authority weight",
            )?;
            if holder.nodes.is_empty() {
                return Err(profile_error(format!(
                    "subjective holder {} requires at least one node",
                    holder.holder
                )));
            }
            let scopes = normalized_scopes(
                holder.access_scopes.clone(),
                Some(format!("holder:{}", holder.holder)),
            )?;
            let node_ids: BTreeSet<_> = holder.nodes.iter().map(|node| node.id.as_str()).collect();
            if node_ids.len() != holder.nodes.len() {
                return Err(profile_error(format!(
                    "subjective holder {} node ids must be unique",
                    holder.holder
                )));
            }
            for node in &holder.nodes {
                validate_segment(&node.id, "subjective graph node id")?;
                finite(node.position, "subjective node position")?;
                if node.position < self.position_bounds.minimum
                    || node.position > self.position_bounds.maximum
                {
                    return Err(profile_error(format!(
                        "subjective node {} position is outside bounds",
                        node.id
                    )));
                }
            }
            let mut edge_keys = BTreeSet::new();
            let mut graph_edges: Vec<_> = holder
                .edges
                .iter()
                .map(|edge| {
                    validate_text(&edge.relation, "subjective graph edge relation")?;
                    if !node_ids.contains(edge.source.as_str())
                        || !node_ids.contains(edge.target.as_str())
                    {
                        return Err(profile_error(format!(
                            "subjective edge {} -> {} names an unknown node",
                            edge.source, edge.target
                        )));
                    }
                    if !edge_keys.insert((
                        edge.source.as_str(),
                        edge.target.as_str(),
                        edge.relation.as_str(),
                    )) {
                        return Err(profile_error("subjective graph edges must be unique"));
                    }
                    Ok(GraphEdgeValue {
                        source: edge.source.clone(),
                        target: edge.target.clone(),
                        relation: edge.relation.clone(),
                    })
                })
                .collect::<EngineResult<Vec<_>>>()?;
            graph_edges.sort_by(|left, right| {
                (&left.source, &left.target, &left.relation).cmp(&(
                    &right.source,
                    &right.target,
                    &right.relation,
                ))
            });
            let mut graph_nodes: Vec<_> = holder.nodes.iter().map(|node| node.id.clone()).collect();
            graph_nodes.sort();
            let graph = GraphValue {
                nodes: graph_nodes,
                edges: graph_edges,
            };
            let holder_base = format!("{base}.holder.{}", holder.holder);
            let topology_id = format!("{holder_base}.topology");
            fragment.processes.push(ProcessDefinition {
                id: topology_id.clone(),
                value_type: ProcessType::Graph,
                initial_value: ProcessValue::Graph(graph.clone()),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                axes: vec![],
                unit: None,
                reference_frame: Some(format!("subjective-holder:{}", holder.holder)),
                scale: BTreeMap::from([
                    (
                        "semantic_kind".to_owned(),
                        "holder_scoped_topology".to_owned(),
                    ),
                    ("holder".to_owned(), holder.holder.clone()),
                ]),
                support: vec![format!("subjective_graph:{}", self.id)],
                access_scopes: scopes.clone(),
                update_mode: ProcessUpdateMode::Observed,
            });
            fragment.initial_claims.push(Claim {
                id: format!("{holder_base}.claim.topology"),
                subject: topology_id.clone(),
                value: ProcessValue::Graph(graph),
                uncertainty: ClaimUncertainty::Unknown,
                evidence_type: EvidenceType::Belief,
                holder: holder.holder.clone(),
                evidence_cutoff: 0.0,
                provenance: provenance.clone(),
                authority: ClaimAuthority {
                    source: holder.holder.clone(),
                    weight: holder.authority_weight,
                },
                mode: Some(ClaimMode::Estimated),
                value_time: Some(0.0),
                access_scopes: scopes.clone(),
            });
            for node in &holder.nodes {
                let position_id = format!("{holder_base}.node.{}.position", node.id);
                fragment.processes.push(scalar_process(
                    position_id.clone(),
                    node.position,
                    self.position_bounds.clone(),
                    &provenance,
                    vec![topology_id.clone()],
                    scopes.clone(),
                    ProcessUpdateMode::Observed,
                    None,
                    Some(format!("subjective-holder:{}", holder.holder)),
                    BTreeMap::from([
                        (
                            "semantic_kind".to_owned(),
                            "holder_scoped_node_position".to_owned(),
                        ),
                        ("holder".to_owned(), holder.holder.clone()),
                        ("node".to_owned(), node.id.clone()),
                    ]),
                ));
                fragment.initial_claims.push(Claim {
                    id: format!("{holder_base}.claim.node.{}.position", node.id),
                    subject: position_id,
                    value: ProcessValue::Scalar(node.position),
                    uncertainty: node.uncertainty.clone(),
                    evidence_type: EvidenceType::Belief,
                    holder: holder.holder.clone(),
                    evidence_cutoff: 0.0,
                    provenance: provenance.clone(),
                    authority: ClaimAuthority {
                        source: holder.holder.clone(),
                        weight: holder.authority_weight,
                    },
                    mode: Some(ClaimMode::Estimated),
                    value_time: Some(0.0),
                    access_scopes: scopes.clone(),
                });
            }
        }
        Ok(fragment)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EventEnvelopeCoupling {
    pub id: String,
    pub target_process: String,
    pub gain: f64,
}

/// A smooth, deterministic event envelope expressed entirely with the common
/// scalar IR. Forward-time `OnEnter` thresholds add start/end marks; the
/// continuously derived intensity drives ordinary evolution laws. The smooth
/// envelope has asymptotic tails outside its semantic interval. The Meaning
/// Model event is a static index and is not an execution mechanism.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ContinuousEventEnvelopeProfile {
    pub id: String,
    pub boundary: String,
    pub start_time: f64,
    pub end_time: f64,
    pub peak_intensity: f64,
    pub sharpness: f64,
    pub couplings: Vec<EventEnvelopeCoupling>,
    #[serde(default)]
    pub access_scopes: Vec<String>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for ContinuousEventEnvelopeProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "event-envelope profile id")?;
        validate_text(&self.boundary, "event-envelope boundary")?;
        finite(self.start_time, "event-envelope start time")?;
        finite(self.end_time, "event-envelope end time")?;
        if self.start_time <= 0.0 || self.end_time <= self.start_time {
            return Err(profile_error(
                "event-envelope times require 0 < start_time < end_time",
            ));
        }
        unit_interval(self.peak_intensity, "event-envelope peak intensity")?;
        if self.peak_intensity == 0.0 {
            return Err(profile_error(
                "event-envelope peak intensity must be positive",
            ));
        }
        positive(self.sharpness, "event-envelope sharpness")?;
        if self.couplings.is_empty() {
            return Err(profile_error(
                "event envelope requires at least one target coupling",
            ));
        }
        let coupling_ids: BTreeSet<_> =
            self.couplings.iter().map(|item| item.id.as_str()).collect();
        let targets: BTreeSet<_> = self
            .couplings
            .iter()
            .map(|item| item.target_process.as_str())
            .collect();
        if coupling_ids.len() != self.couplings.len() || targets.len() != self.couplings.len() {
            return Err(profile_error(
                "event-envelope coupling ids and target processes must be unique",
            ));
        }
        for coupling in &self.couplings {
            validate_segment(&coupling.id, "event-envelope coupling id")?;
            validate_text(&coupling.target_process, "event-envelope target process")?;
            finite(coupling.gain, "event-envelope coupling gain")?;
        }
        let provenance = profile_provenance(&self.provenance)?;
        let scopes = normalized_scopes(self.access_scopes.clone(), None)?;
        let mut fragment = ProfileFragment::default();
        let base = format!("profile.{}.event_envelope", self.id);
        let intensity_id = format!("{base}.intensity");
        let peak_intensity_id = format!("{base}.peak_intensity");
        let midpoint = self.start_time + (self.end_time - self.start_time) / 2.0;
        let midpoint_window = stable_logistic(self.sharpness * (midpoint - self.start_time))
            * stable_logistic(self.sharpness * (self.end_time - midpoint));
        let window_normalizer = 1.0 / midpoint_window;
        let initial_rise = stable_logistic(self.sharpness * (0.0 - self.start_time));
        let initial_fall = stable_logistic(self.sharpness * (self.end_time - 0.0));
        fragment.processes.push(scalar_process(
            peak_intensity_id.clone(),
            self.peak_intensity,
            NumericBounds {
                minimum: 0.0,
                maximum: 1.0,
            },
            &provenance,
            vec![format!("event-envelope:{}", self.id)],
            scopes.clone(),
            ProcessUpdateMode::Static,
            None,
            None,
            BTreeMap::from([(
                "semantic_role".to_owned(),
                "event_envelope_peak_intensity".to_owned(),
            )]),
        ));
        fragment.processes.push(scalar_process(
            intensity_id.clone(),
            self.peak_intensity * window_normalizer * initial_rise * initial_fall,
            NumericBounds {
                minimum: 0.0,
                maximum: 1.0,
            },
            &provenance,
            vec![format!("event-envelope:{}", self.id)],
            scopes,
            ProcessUpdateMode::Unspecified,
            None,
            None,
            BTreeMap::from([
                (
                    "semantic_kind".to_owned(),
                    "continuous_event_envelope".to_owned(),
                ),
                (
                    "execution_boundary".to_owned(),
                    "common_scalar_relation_and_evolution_laws".to_owned(),
                ),
            ]),
        ));
        let time = ScalarExpression::Time;
        let rise = logistic(multiply(vec![
            constant(self.sharpness),
            subtract(time.clone(), constant(self.start_time)),
        ]));
        let fall = logistic(multiply(vec![
            constant(self.sharpness),
            subtract(constant(self.end_time), time.clone()),
        ]));
        let intensity_law_id = format!("{base}.derive.intensity");
        fragment.laws.push(law(
            intensity_law_id.clone(),
            LawOperator::Relation {
                target: intensity_id.clone(),
                value: multiply(vec![
                    process(&peak_intensity_id),
                    constant(window_normalizer),
                    rise,
                    fall,
                ]),
            },
            &provenance,
        ));
        fragment.dependencies.push(dependency(
            format!("{base}.dependency.peak-intensity"),
            peak_intensity_id,
            intensity_id.clone(),
            DependencyKind::Derives,
            intensity_law_id,
        ));
        for (name, threshold) in [("start", self.start_time), ("end", self.end_time)] {
            fragment.laws.push(law(
                format!("{base}.mark.{name}"),
                LawOperator::Occurrence {
                    trigger: OccurrenceTrigger::Threshold {
                        expression: time.clone(),
                        comparison: Comparison::GreaterOrEqual,
                        threshold,
                        firing: TriggerFiring::OnEnter,
                    },
                    effects: vec![],
                    activates: vec![],
                },
                &provenance,
            ));
        }
        for coupling in &self.couplings {
            let law_id = format!("{base}.coupling.{}", coupling.id);
            fragment.laws.push(law(
                law_id.clone(),
                LawOperator::Evolution {
                    target: coupling.target_process.clone(),
                    derivative: multiply(vec![constant(coupling.gain), process(&intensity_id)]),
                    innovation: None,
                },
                &provenance,
            ));
            fragment.dependencies.push(dependency(
                format!("{base}.dependency.{}", coupling.id),
                intensity_id.clone(),
                coupling.target_process.clone(),
                DependencyKind::Causes,
                law_id,
            ));
        }
        let mut meaning = empty_meaning_model();
        meaning.events.push(MeaningEventDefinition {
            id: format!("event.profile.{}", self.id),
            boundary: self.boundary.clone(),
            description: None,
            interval: Some(EventInterval {
                start: self.start_time,
                end: self.end_time,
            }),
            process_ids: std::iter::once(intensity_id)
                .chain(
                    self.couplings
                        .iter()
                        .map(|coupling| coupling.target_process.clone()),
                )
                .collect(),
            observation_process_ids: vec![],
            participants: BTreeMap::new(),
            substrate: None,
            region: None,
            provenance,
        });
        fragment.meaning_model = Some(meaning);
        Ok(fragment)
    }
}

fn stable_logistic(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exponential = value.exp();
        exponential / (1.0 + exponential)
    }
}
