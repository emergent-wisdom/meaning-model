//! The transition query: how far and how finely to roll a world, with which interventions and observations, and what
//! to retain. A query is validated and normalized against its model before it runs, and its normalized form fixes the
//! identity hashes a candidate is bound to.
//!
//! What a query asks to see (observables, access scopes, retention) is kept out of its dynamics hash, so it never
//! changes what is rolled or which draws are made.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::limits::{
    MAX_OBSERVATION_PROVENANCE, MAX_QUERY_ACCESS_SCOPES, MAX_QUERY_DURATION,
    MAX_QUERY_INTERVENTIONS, MAX_QUERY_OBSERVABLES, MAX_QUERY_OBSERVATIONS, MAX_QUERY_STRING_BYTES,
    MAX_QUERY_SUPPORT,
};
use crate::model::access::visible_to;
use crate::model::compile::{
    expression_references, process_state_writer, validate_effect, validate_process_value,
    validate_uncertainty, CompiledModel,
};
use crate::model::definition::{
    ClaimAuthority, ClaimUncertainty, EvidenceType, ProcessUpdateMode, ProcessValue, StateEffect,
};
use crate::model::randomness::random_schedule_hash;
use crate::model::MODEL_QUERY_SCHEMA;
use crate::{error, finite, hash_serializable, EngineResult, PathSpec};

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

pub(super) fn transition_identity(
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

pub(super) fn require_query_access(
    model: &CompiledModel,
    process_id: &str,
    access_scopes: &[String],
    context: &str,
) -> EngineResult<()> {
    let process = model
        .processes
        .get(process_id)
        .ok_or_else(|| error(format!("{context} names unknown process {process_id}")))?;
    if !visible_to(&process.access_scopes, access_scopes) {
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
