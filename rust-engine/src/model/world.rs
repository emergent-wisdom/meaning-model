//! World heads and world revisions. A head is one world's accepted state at one time under one model; a revision is
//! the immutable record of moving a head to the direct next model revision at an unchanged time.
//!
//! A head's hash covers its model and revision, world id, version, time, state, claims and lineage, and its version
//! counts its accepted changes, so an expected hash or version names exactly one head. A head is checked against its
//! model before it is trusted (`validate_world`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::limits::MAX_OBSERVATION_PROVENANCE;
use crate::model::compile::{validate_claim, validate_process_value, CompiledModel};
use crate::model::definition::{Claim, ProcessValue};
use crate::model::narrative::MAX_NARRATIVE_STRING_BYTES;
use crate::model::revision::validate_monotonic_genesis_refinement;
use crate::model::{WORLD_HEAD_SCHEMA, WORLD_REVISION_SCHEMA};
use crate::{error, finite, hash_serializable, EngineResult};

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

pub(crate) fn build_world_revision(
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
            != source
                .revision
                .number
                .checked_add(1)
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
        || spec
            .provenance
            .iter()
            .any(|value| value.trim().is_empty() || value.len() > MAX_NARRATIVE_STRING_BYTES)
    {
        return Err(error(
            "world revision requires nonempty bounded reason and provenance",
        ));
    }
    if spec.mode == WorldRevisionMode::Refine {
        validate_monotonic_genesis_refinement(source, target)?;
    }
    for (id, old) in &source.processes {
        let new = target
            .processes
            .get(id)
            .ok_or_else(|| error(format!("world revision cannot remove process {id}")))?;
        if old.value_type != new.value_type
            || old.axes != new.axes
            || old.unit != new.unit
            || old.reference_frame != new.reference_frame
            || old.scale != new.scale
        {
            return Err(error(format!(
                "world revision cannot reshape or change units, frame, or scale of process {id}"
            )));
        }
    }
    let mut state = current.state.clone();
    for (id, value) in &spec.state_values {
        let process = target.processes.get(id).ok_or_else(|| {
            error(format!(
                "world revision state_values names unknown process {id}"
            ))
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
        current
            .version
            .checked_add(1)
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

pub(super) fn build_world_head(
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

pub(crate) fn validate_world(model: &CompiledModel, world: &WorldHead) -> EngineResult<()> {
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

pub(super) fn validate_world_parts(
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
