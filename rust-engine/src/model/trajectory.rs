//! Trajectory summaries: read-only statistics of a candidate's retained path over a time interval, by
//! piecewise-linear interpolation between retained samples. Nothing is rerolled and no uncertainty is propagated.
//!
//! A summary is bound to the candidate it summarizes and carries its own hash, so a tampered summary is detected.

use serde::{Deserialize, Serialize};

use crate::limits::{
    MAX_QUERY_ACCESS_SCOPES, MAX_QUERY_OBSERVABLES, MAX_QUERY_STRING_BYTES,
    MAX_TRAJECTORY_SUMMARY_WORK,
};
use crate::model::candidate::{
    validate_candidate_with_frozen_parent, ModelCandidate, ModelPathSample,
};
use crate::model::compile::CompiledModel;
use crate::model::definition::{ClaimUncertainty, ProcessValue};
use crate::model::query::require_query_access;
use crate::model::world::WorldHead;
use crate::model::{TRAJECTORY_SUMMARY_QUERY_SCHEMA, TRAJECTORY_SUMMARY_SCHEMA};
use crate::{error, finite, hash_serializable, EngineResult, PathSpec};

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

pub(crate) fn trajectory_summary_hash(summary: &TrajectorySummary) -> EngineResult<String> {
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
