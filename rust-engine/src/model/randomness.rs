//! Randomness: every draw is named, keyed by a master key derived from the seed, roll index and step schedule, and
//! recorded on the candidate, so a roll replays exactly and paired comparisons can share draws when asked to.
//!
//! No draw depends on anything outside the candidate's own seed, roll index, schedule and draw name: there is no
//! global generator and no clock.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::model::query::TimeDirection;
use crate::{hash_serializable, EngineResult};

pub(crate) const RANDOM_SCHEDULE_SCHEMA: &str = "life-sim-rust-random-schedule/v1";

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

#[derive(Serialize)]
struct RandomScheduleFingerprint {
    schema: &'static str,
    delta_time: f64,
    actual_step_size: f64,
    step_count: usize,
    direction: TimeDirection,
}

pub(super) fn random_schedule_hash(
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

pub(super) fn master_key(
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

pub(super) fn random_draw(master: [u8; 32], key: &str, step: usize, index: u64) -> RandomDraw {
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

pub(super) fn normal_draws(
    master: [u8; 32],
    key: &str,
    step: usize,
) -> (f64, RandomDraw, RandomDraw) {
    let first = random_draw(master, key, step, 0);
    let second = random_draw(master, key, step, 1);
    let normal =
        (-2.0 * first.uniform.ln()).sqrt() * (std::f64::consts::TAU * second.uniform).cos();
    (normal, first, second)
}
