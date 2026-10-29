//! The transition: rolling a frozen world head forward under its model's laws, step by step, into a candidate.
//!
//! Laws are evaluated in a fixed order and their effects land simultaneously. The work a roll may do (steps, law
//! evaluations, retained state, draws and marks) is estimated and bounded before it starts, so an over-budget query is
//! refused without rolling. Given the same head, model and query, a roll always gives the same candidate.

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};

use crate::limits::{
    serialized_size, MAX_LAW_PROCESS_EVALUATIONS, MAX_POTENTIAL_ACTIVITY_BYTES,
    MAX_POTENTIAL_ACTIVITY_RECORDS, MAX_RETAINED_STATE_BYTES, MAX_STATE_BYTE_STEPS, MAX_STEP_COUNT,
};
use crate::model::candidate::{
    CandidateFingerprint, ComparisonRandomnessFingerprint, ModelCandidate, ModelPathSample,
    ModelRollResult, OccurrenceMark, RetainedModelPath,
};
use crate::model::compile::{
    expression_metrics, validate_claim, validate_process_value, CompiledModel,
};
use crate::model::definition::{
    Claim, ClaimMode, Comparison, EffectMode, LawActivation, LawOperator, OccurrenceTrigger,
    ProcessUpdateMode, ProcessValue, ResolutionDirection, ScalarExpression, StateEffect,
    TriggerFiring,
};
use crate::model::query::{
    transition_identity, InterventionApplication, ModelTransitionSpec, ResolutionPrecedence,
    TimeDirection,
};
use crate::model::randomness::{
    master_key, normal_draws, random_draw, ModelRandomness, RandomnessPolicy,
};
use crate::model::world::{build_world_head, validate_world, WorldHead};
use crate::model::{MODEL_CANDIDATE_SCHEMA, MODEL_PATH_SCHEMA};
use crate::{error, finite, hash_serializable, hex_digest, EngineResult, PathSpec};

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

pub(crate) fn scalar(state: &BTreeMap<String, ProcessValue>, id: &str) -> EngineResult<f64> {
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

fn retain(path: &PathSpec, step: usize, total: usize) -> bool {
    match path {
        PathSpec::Endpoint => step == total,
        PathSpec::Full => true,
        PathSpec::Decimated { every } => step == 0 || step == total || step.is_multiple_of(*every),
    }
}

fn path_capacity(path: &PathSpec, total: usize) -> usize {
    match path {
        PathSpec::Endpoint => 1,
        PathSpec::Full => total.saturating_add(1),
        PathSpec::Decimated { every } => total / every + 2,
    }
}

pub(super) fn hash_sample(
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
            LawOperator::Evolution {
                innovation: None, ..
            }
            | LawOperator::Relation { .. }
            | LawOperator::Epistemic { .. }
            | LawOperator::Resolution { .. } => (0, 0),
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

pub(crate) fn candidate_replay_work(
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
            LawOperator::Evolution { .. }
            | LawOperator::Occurrence { .. }
            | LawOperator::Epistemic { .. } => unreachable!(),
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

    let trajectory_hash = hex_digest(trajectory_hasher.finalize());
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
