//! Views: what a caller is shown of a world head, a world revision or a candidate, limited to the observables it asks
//! for and the access scopes it holds (access.rs).
//!
//! A view never changes what it projects, and an observable the caller's scopes do not allow is refused rather than
//! silently left out.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::limits::{MAX_QUERY_ACCESS_SCOPES, MAX_QUERY_OBSERVABLES, MAX_QUERY_STRING_BYTES};
use crate::model::access::visible_to;
use crate::model::candidate::{CandidateRecord, ModelCandidate};
use crate::model::compile::CompiledModel;
use crate::model::definition::{Claim, ProcessValue};
use crate::model::query::InterventionApplication;
use crate::model::world::{validate_world, WorldHead, WorldRevision};
use crate::model::{
    MODEL_CANDIDATE_SCHEMA, MODEL_PATH_SCHEMA, MODEL_VIEW_SCHEMA, WORLD_HEAD_SCHEMA,
};
use crate::{error, EngineResult};

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

pub(crate) fn normalize_view(
    model: &CompiledModel,
    view: &mut ViewSpec,
) -> EngineResult<BTreeSet<String>> {
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
        if !visible_to(&process.access_scopes, &view.access_scopes) {
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
            visible.contains(&claim.subject) && visible_to(&claim.access_scopes, access_scopes)
        })
        .map(|(id, claim)| (id.clone(), claim.clone()))
        .collect()
}

pub(crate) fn world_view(
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

pub(crate) fn world_revision_view(
    source: &CompiledModel,
    target: &CompiledModel,
    revision: &WorldRevision,
    mut view: ViewSpec,
) -> EngineResult<serde_json::Value> {
    let visible = normalize_view(target, &mut view)?;
    let source_visible: Vec<String> = visible
        .iter()
        .filter(|id| {
            source
                .processes
                .get(*id)
                .is_some_and(|process| visible_to(&process.access_scopes, &view.access_scopes))
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

pub(crate) fn candidate_record_view(
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

pub(crate) fn candidate_original_view(candidate: &ModelCandidate) -> ViewSpec {
    ViewSpec {
        requested_observables: candidate.query.requested_observables.clone(),
        access_scopes: candidate.query.access_scopes.clone(),
        include_path: true,
    }
}
