//! Candidates: the proposed successor of a frozen world head that a roll produces, with the path it retained and the
//! randomness it drew, its lineage status, and the checks that a stored candidate replays exactly.
//!
//! A candidate's hash covers its canon: the parent head, the dynamics of its query, its seed and roll index, the draws
//! it made, its whole trajectory (by hash) and its successor; not what the caller asked to retain or to see. The same
//! roll therefore always gives the same hash, and a stored candidate's canon never changes; only its lineage status,
//! and a richer retained path on a retention upgrade, may. A candidate is trusted only once rolling it again from its
//! frozen parent gives the same canon.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::compile::CompiledModel;
use crate::model::definition::{Claim, ProcessValue};
use crate::model::query::{transition_identity, ModelTransitionSpec, TimeDirection};
use crate::model::randomness::{ModelRandomness, RandomnessPolicy};
use crate::model::transition::{hash_sample, roll_model_transition};
use crate::model::world::{validate_world, validate_world_parts, WorldHead};
use crate::model::{MODEL_CANDIDATE_SCHEMA, MODEL_PATH_SCHEMA};
use crate::{error, hash_serializable, hex_digest, EngineResult, PathSpec};

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
pub(super) struct CandidateFingerprint<'a> {
    pub(super) schema: &'static str,
    pub(super) model_hash: &'a str,
    pub(super) model_revision: u64,
    pub(super) world_id: &'a str,
    pub(super) parent_world_hash: &'a str,
    pub(super) expected_parent_version: u64,
    pub(super) start_time: f64,
    pub(super) end_time: f64,
    pub(super) seed: &'a str,
    pub(super) roll_index: u64,
    pub(super) dynamics_hash: &'a str,
    pub(super) trajectory_hash: &'a str,
    pub(super) successor_state: &'a BTreeMap<String, ProcessValue>,
    pub(super) successor_claims: &'a BTreeMap<String, Claim>,
    pub(super) marks: &'a [OccurrenceMark],
    pub(super) draw_set_hash: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) comparison_randomness: Option<ComparisonRandomnessFingerprint<'a>>,
}

#[derive(Debug, Serialize)]
pub(super) struct ComparisonRandomnessFingerprint<'a> {
    pub(super) stream: &'a str,
    pub(super) schedule_hash: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRollResult {
    pub candidate: ModelCandidate,
    pub proposed_head: WorldHead,
}

pub(crate) fn validate_candidate_with_frozen_parent(
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

pub(super) fn validate_project_candidate_replay(
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
        if candidate.trajectory_hash != hex_digest(hasher.finalize()) {
            return Err(error(
                "trajectory-summary full retained path does not match the canonical trajectory hash",
            ));
        }
    }
    Ok(())
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
pub(crate) struct StoredCandidate {
    pub(crate) record: CandidateRecord,
    pub(crate) parent: WorldHead,
}

pub(crate) fn same_candidate_canon(left: &ModelCandidate, right: &ModelCandidate) -> bool {
    let mut normalized = left.clone();
    normalized.query = right.query.clone();
    normalized.query_hash = right.query_hash.clone();
    normalized.path = right.path.clone();
    normalized == *right
}

pub(crate) fn path_is_richer(candidate: &RetainedModelPath, stored: &RetainedModelPath) -> bool {
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

pub(crate) fn attach_retention_upgrade(
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
