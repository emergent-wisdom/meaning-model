//! The session's own tests: durable writes and their failure outcomes, restoring and migrating the state file, the
//! compact model store, the guard against unflushed rows, and what the session keeps in memory.

use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Transaction};

use super::model_store::*;
use super::persistence::*;
use super::*;
use crate::model::trajectory::trajectory_summary_hash;
use crate::model::*;
use crate::test_support::*;
use crate::{hash_serializable, PathSpec};

#[test]
fn meaning_model_survives_session_serialization_and_restore() {
    let mut definition = test_model();
    definition.meaning_model = Some(crate::model::test_meaning_model_fixture());
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": definition}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(registered["summary"]["meaning_model"]["concept_count"], 4);
    assert_eq!(registered["summary"]["meaning_model"]["referent_count"], 3);
    assert_eq!(
        registered["model"]["meaning_model"]["schema"],
        MEANING_MODEL_SCHEMA
    );

    let bytes = serde_json::to_vec(&session.snapshot()).unwrap();
    let persisted: PersistedSession = serde_json::from_slice(&bytes).unwrap();
    let mut restored = MachineSession::restore(persisted).unwrap();
    let fetched = result(restored.parse_and_execute(&command(
        "get_model",
        serde_json::json!({"model_hash": model_hash}),
    )));
    assert_eq!(fetched["model_hash"], model_hash);
    assert_eq!(fetched["summary"]["meaning_model"]["event_count"], 4);
    assert_eq!(
        fetched["summary"]["meaning_model"]["event_relation_count"],
        1
    );
    assert_eq!(
        fetched["summary"]["meaning_model"]["event_referent_binding_count"],
        3
    );
    assert_eq!(
        fetched["model"]["meaning_model"]["realizations"][0]["id"],
        "define-love"
    );
}

#[test]
fn observed_series_commits_persists_replays_and_rejects_tampering() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": observed_series_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "observed-persist"}),
    )));
    let rolled = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({
            "world_id": "observed-persist",
            "query": observed_query(
                PathSpec::Full,
                vec![
                    observed_value("early", 0.25, 20.0),
                    observed_value("late", 0.75, 40.0),
                ]
            )
        }),
    )));
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({
            "candidate_hash": candidate_hash,
            "view": {
                "requested_observables": ["sensor.temperature", "sensor.derived_heat"],
                "access_scopes": ["sensor:private"]
            }
        }),
    )));

    let accepted = session.worlds.get("observed-persist").unwrap();
    assert_eq!(
        accepted.lineage_head.as_deref(),
        Some(candidate_hash.as_str())
    );
    assert_eq!(
        accepted.state["sensor.temperature"],
        ProcessValue::Scalar(40.0)
    );
    assert_eq!(
        accepted.state["sensor.derived_heat"],
        ProcessValue::Scalar(80.0)
    );
    assert_eq!(accepted.claims.len(), 2);

    let snapshot = session.snapshot();
    let encoded = serde_json::to_vec(&snapshot).unwrap();
    let persisted: PersistedSession = serde_json::from_slice(&encoded).unwrap();
    let mut restored = MachineSession::restore(persisted).unwrap();
    assert_eq!(restored.snapshot().worlds, snapshot.worlds);
    assert_eq!(restored.snapshot().candidates, snapshot.candidates);

    let carried = result(restored.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({
            "world_id": "observed-persist",
            "query": observed_query(PathSpec::Full, vec![])
        }),
    )));
    let samples = carried["candidate"]["path"]["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 5);
    for sample in samples {
        assert_eq!(sample["state"]["sensor.temperature"]["value"], 40.0);
        assert_eq!(sample["state"]["sensor.derived_heat"]["value"], 80.0);
    }

    let mut query_tamper = snapshot.clone();
    let stored = query_tamper
        .candidates
        .iter_mut()
        .find(|stored| stored.record.candidate.candidate_hash == candidate_hash)
        .unwrap();
    stored.record.candidate.query.observations[0].value = ProcessValue::Scalar(21.0);
    let replay_failure = MachineSession::restore(query_tamper).unwrap_err();
    assert!(replay_failure
        .0
        .contains("does not replay from its frozen parent"));

    let mut claim_tamper = snapshot;
    let observed_claim = claim_tamper.worlds[0]
        .claims
        .values_mut()
        .find(|claim| claim.mode == Some(ClaimMode::Observed))
        .unwrap();
    observed_claim.evidence_cutoff = observed_claim.value_time.unwrap() - 0.01;
    let claim_failure = MachineSession::restore(claim_tamper).unwrap_err();
    assert!(claim_failure
        .0
        .contains("value_time cannot be after its evidence cutoff"));
}

#[test]
fn initial_boundary_requires_offset_zero_and_persists_with_replay_validation() {
    let model = compile_model(intervention_timing_model()).unwrap();
    let parent = model.genesis_world("invalid-intervention-timing").unwrap();
    let mut invalid = intervention_timing_query(Some(InterventionApplication::InitialBoundary));
    invalid.interventions[0].offset = 0.25;
    let failure = roll_model_transition(&model, &parent, invalid).unwrap_err();
    assert!(failure
        .0
        .contains("application initial_boundary requires offset 0"));

    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": intervention_timing_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({
            "model_hash": model_hash,
            "world_id": "initial-boundary-persist"
        }),
    )));
    let rolled = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({
            "world_id": "initial-boundary-persist",
            "query": intervention_timing_query(Some(
                InterventionApplication::InitialBoundary
            ))
        }),
    )));
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();

    let snapshot = session.snapshot();
    let encoded = serde_json::to_vec(&snapshot).unwrap();
    let persisted: PersistedSession = serde_json::from_slice(&encoded).unwrap();
    let restored = MachineSession::restore(persisted).unwrap();
    let restored_candidate = restored
        .candidates
        .get(&candidate_hash)
        .unwrap()
        .record
        .candidate
        .clone();
    assert_eq!(
        restored_candidate.query.interventions[0].application,
        Some(InterventionApplication::InitialBoundary)
    );
    assert_eq!(restored_candidate.marks[0].step, 0);
    assert_eq!(restored_candidate.marks[0].time, 0.0);

    let mut tampered = snapshot;
    tampered
        .candidates
        .iter_mut()
        .find(|candidate| candidate.record.candidate.candidate_hash == candidate_hash)
        .unwrap()
        .record
        .candidate
        .query
        .interventions[0]
        .application = None;
    let failure = MachineSession::restore(tampered).unwrap_err();
    assert!(failure.0.contains("does not replay from its frozen parent"));
}

#[test]
fn trajectory_summary_is_replayable_tamper_evident_and_read_only() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": linear_trajectory_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "summary-world"}),
    )));
    let rolled = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({
            "world_id": "summary-world",
            "query": trajectory_query(PathSpec::Full, &["position"])
        }),
    )));
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let before = serde_json::to_value(session.snapshot()).unwrap();
    let fields = serde_json::json!({
        "candidate_hash": candidate_hash,
        "trajectory_summary": trajectory_summary_spec(0.125, 0.875, &["position"])
    });
    let first = result(session.parse_and_execute(&command("summarize_trajectory", fields.clone())));
    let second = result(session.parse_and_execute(&command("summarize_trajectory", fields)));
    let after = serde_json::to_value(session.snapshot()).unwrap();
    assert_eq!(before, after);
    assert_eq!(first, second);

    let replayed: TrajectorySummary = serde_json::from_value(first).unwrap();
    let stored = session.candidates.get(&candidate_hash).unwrap();
    let model = session
        .models
        .get(&stored.record.candidate.model_hash)
        .unwrap()
        .unwrap();
    let model = &*model;
    validate_model_trajectory_summary(model, &stored.parent, &stored.record.candidate, &replayed)
        .unwrap();

    let mut tampered_summary = replayed.clone();
    tampered_summary.fields[0].maximum += 1.0;
    tampered_summary.summary_hash = trajectory_summary_hash(&tampered_summary).unwrap();
    let failure = validate_model_trajectory_summary(
        model,
        &stored.parent,
        &stored.record.candidate,
        &tampered_summary,
    )
    .unwrap_err();
    assert!(failure.0.contains("does not match"));

    let mut tampered_candidate = stored.record.candidate.clone();
    tampered_candidate.path.samples[1]
        .state
        .insert("position".to_owned(), ProcessValue::Scalar(99.0));
    let failure = summarize_model_trajectory(
        model,
        &stored.parent,
        &tampered_candidate,
        trajectory_summary_spec(0.125, 0.875, &["position"]),
    )
    .unwrap_err();
    assert!(failure.0.contains("canonical trajectory hash"));
}

#[test]
fn common_random_stream_persists_replays_and_is_tamper_evident() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "paired-persist"}),
    )));
    let mut paired_query = query(0, PathSpec::Full);
    paired_query.comparison_stream = Some("persistent-comparison".to_owned());
    let rolled = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "paired-persist", "query": paired_query}),
    )));
    assert_eq!(
        rolled["candidate"]["randomness"]["policy"],
        "common_random_comparison"
    );
    assert_eq!(
        rolled["candidate"]["randomness"]["comparison_stream"],
        "persistent-comparison"
    );
    assert!(rolled["candidate"]["randomness"]["schedule_hash"]
        .as_str()
        .is_some_and(|hash| hash.len() == 64));
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": candidate_hash}),
    )));

    let snapshot = session.snapshot();
    let mut restored = MachineSession::restore(snapshot.clone()).unwrap();
    let inspected = result(restored.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({"candidate_hash": candidate_hash}),
    )));
    assert_eq!(inspected["status"], "committed");
    assert_eq!(
        inspected["candidate"]["randomness"]["comparison_stream"],
        "persistent-comparison"
    );
    assert_eq!(
        restored.worlds["paired-persist"].lineage_head.as_deref(),
        Some(candidate_hash.as_str())
    );

    let mut tampered_schedule = snapshot.clone();
    let stored = tampered_schedule
        .candidates
        .iter_mut()
        .find(|stored| stored.record.candidate.candidate_hash == candidate_hash)
        .unwrap();
    stored.record.candidate.randomness.schedule_hash = "0".repeat(64);
    let failure = MachineSession::restore(tampered_schedule).unwrap_err();
    assert!(failure.0.contains("does not replay from its frozen parent"));

    let mut tampered_stream = snapshot;
    let stored = tampered_stream
        .candidates
        .iter_mut()
        .find(|stored| stored.record.candidate.candidate_hash == candidate_hash)
        .unwrap();
    stored.record.candidate.query.comparison_stream = Some("different-comparison".to_owned());
    let failure = MachineSession::restore(tampered_stream).unwrap_err();
    assert!(failure.0.contains("does not replay from its frozen parent"));
}

#[test]
fn genesis_refinement_preserves_old_canon_and_adds_authored_detail() {
    let base = genesis_refinement_base_model();
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": base.clone()}),
    )));
    let source_model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": source_model_hash, "world_id": "refined-world"}),
    )));
    let source_world = session.worlds["refined-world"].clone();

    let revision = additive_genesis_revision(&base, &source_model_hash, "temperature");
    let revised = result(session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({"model": revision}),
    )));
    let target_model_hash = revised["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let refined = result(session.parse_and_execute(&command(
        "refine_genesis_world",
        serde_json::json!({
            "world_id": "refined-world",
            "model_hash": target_model_hash,
            "view": {
                "requested_observables": ["person.stress", "world.temperature"]
            }
        }),
    )));

    assert_eq!(refined["boundary"], "genesis_only_authored_refinement");
    assert_eq!(refined["source_model_hash"], source_model_hash);
    assert_eq!(refined["target_model_hash"], target_model_hash);
    assert_eq!(refined["source_revision"], 0);
    assert_eq!(refined["target_revision"], 1);
    assert_eq!(refined["conservation"]["old_state_preserved"], true);
    assert_eq!(refined["conservation"]["old_claims_preserved"], true);
    assert_eq!(refined["records"]["preserved_records"]["processes"], 4);
    assert_eq!(refined["records"]["added_records"]["processes"], 1);
    assert_eq!(refined["records"]["added_records"]["decomposition"], 1);
    assert_eq!(refined["records"]["added_records"]["meaning.referents"], 1);
    assert_eq!(
        refined["records"]["preserved_records"]["meaning.event_relations"],
        1
    );
    assert_eq!(refined["world_head"]["version"], 0);
    assert_eq!(refined["world_head"]["time"], 0.0);
    assert_eq!(
        refined["world_head"]["state"]["person.stress"],
        serde_json::json!({"kind": "scalar", "value": 0.2})
    );
    assert_eq!(
        refined["world_head"]["state"]["world.temperature"],
        serde_json::json!({"kind": "scalar", "value": 1.0})
    );

    let accepted = &session.worlds["refined-world"];
    assert_eq!(accepted.world_id, source_world.world_id);
    assert_eq!(accepted.version, source_world.version);
    assert_eq!(accepted.time, source_world.time);
    assert_eq!(accepted.lineage_head, source_world.lineage_head);
    for (id, value) in &source_world.state {
        assert_eq!(accepted.state.get(id), Some(value));
    }
    for (id, claim) in &source_world.claims {
        assert_eq!(accepted.claims.get(id), Some(claim));
    }
    assert_eq!(
        accepted.state["world.temperature"],
        ProcessValue::Scalar(1.0)
    );
}

#[test]
fn genesis_refinement_rejects_non_monotonic_model_changes() {
    let base = genesis_refinement_base_model();
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": base.clone()}),
    )));
    let source_model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": source_model_hash, "world_id": "non-monotonic"}),
    )));
    let original_world_hash = session.worlds["non-monotonic"].world_hash.clone();

    let mut revision = additive_genesis_revision(&base, &source_model_hash, "temperature");
    revision
        .processes
        .iter_mut()
        .find(|process| process.id == "person.stress")
        .unwrap()
        .initial_value = ProcessValue::Scalar(0.3);
    let revised = result(session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({"model": revision}),
    )));
    let target_model_hash = revised["summary"]["model_hash"].as_str().unwrap();
    let response = session.parse_and_execute(&command(
        "refine_genesis_world",
        serde_json::json!({
            "world_id": "non-monotonic",
            "model_hash": target_model_hash
        }),
    ));
    assert!(!response.ok);
    let failure = response.error.unwrap();
    assert_eq!(failure.code, "invalid_request");
    assert!(failure
        .message
        .contains("changed existing processes record"));
    assert!(failure.message.contains("additions only"));
    assert_eq!(
        session.worlds["non-monotonic"].world_hash,
        original_world_hash
    );
    assert_eq!(
        session.worlds["non-monotonic"].model_hash,
        source_model_hash
    );
}

#[test]
fn genesis_refinement_rejects_worlds_with_accepted_history() {
    let base = genesis_refinement_base_model();
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": base.clone()}),
    )));
    let source_model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": source_model_hash, "world_id": "advanced-world"}),
    )));
    let revision = additive_genesis_revision(&base, &source_model_hash, "temperature");
    let revised = result(session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({"model": revision}),
    )));
    let target_model_hash = revised["summary"]["model_hash"].as_str().unwrap();

    let candidate = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({
            "world_id": "advanced-world",
            "query": query(0, PathSpec::Endpoint)
        }),
    )));
    let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
    result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": candidate_hash}),
    )));

    let response = session.parse_and_execute(&command(
        "refine_genesis_world",
        serde_json::json!({
            "world_id": "advanced-world",
            "model_hash": target_model_hash
        }),
    ));
    assert!(!response.ok);
    let failure = response.error.unwrap();
    assert_eq!(failure.code, "conflict");
    assert!(failure.message.contains("untouched genesis head"));
    assert!(failure.message.contains("use revise_world"));
    assert_eq!(session.worlds["advanced-world"].version, 1);
}

#[test]
fn genesis_refinement_rejects_a_sibling_revision_after_acceptance() {
    let base = genesis_refinement_base_model();
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": base.clone()}),
    )));
    let source_model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": source_model_hash, "world_id": "sibling-world"}),
    )));

    let first = result(session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({
            "model": additive_genesis_revision(&base, &source_model_hash, "temperature")
        }),
    )));
    let first_hash = first["summary"]["model_hash"].as_str().unwrap().to_owned();
    let sibling = result(session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({
            "model": additive_genesis_revision(&base, &source_model_hash, "humidity")
        }),
    )));
    let sibling_hash = sibling["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();

    result(session.parse_and_execute(&command(
        "refine_genesis_world",
        serde_json::json!({"world_id": "sibling-world", "model_hash": first_hash}),
    )));
    let response = session.parse_and_execute(&command(
        "refine_genesis_world",
        serde_json::json!({"world_id": "sibling-world", "model_hash": sibling_hash}),
    ));
    assert!(!response.ok);
    let failure = response.error.unwrap();
    assert_eq!(failure.code, "conflict");
    assert!(failure.message.contains("direct next revision"));
    assert!(failure.message.contains("sibling"));
    assert_eq!(session.worlds["sibling-world"].model_hash, first_hash);
}

fn stored_model_example() -> ModelDefinition {
    let command: serde_json::Value =
        serde_json::from_str(include_str!("../../examples/meaning-model-command.json")).unwrap();
    let mut model: ModelDefinition = serde_json::from_value(command["model"].clone()).unwrap();
    // A model of some size, so that a revision changing one Event is small next to the whole.
    let events = &mut model.meaning_model.as_mut().unwrap().events;
    let template = events[0].clone();
    for index in 0..120 {
        let mut event = template.clone();
        event.id = format!("event.stored-test-{index:03}");
        event.boundary =
            format!("one of the many moments the stored-model test adds, number {index}");
        events.push(event);
    }
    model
}

/// A lineage of revisions, each changing one Event's boundary, registered in a durable session.
fn stored_model_lineage(state_file: &Path, revisions: u64) -> Vec<(String, serde_json::Value)> {
    let mut session = MachineSession::with_state_file(state_file).unwrap();
    let mut model = stored_model_example();
    let mut lineage = Vec::new();
    for number in 0..=revisions {
        if number > 0 {
            model.revision = ModelRevision {
                number,
                previous_model_hash: Some(
                    lineage
                        .last()
                        .map(|(hash, _): &(String, serde_json::Value)| hash.clone())
                        .unwrap(),
                ),
                reason: format!("revision {number}"),
                provenance: vec!["stored-model-test".to_owned()],
            };
            let events = &mut model.meaning_model.as_mut().unwrap().events;
            let index = number as usize % events.len();
            events[index].boundary = format!("revised in revision {number}");
        }
        let registered = result(session.parse_and_execute(&command(
            if number == 0 {
                "register_model"
            } else {
                "revise_model"
            },
            serde_json::json!({ "model": model.clone() }),
        )));
        lineage.push((
            registered["summary"]["model_hash"]
                .as_str()
                .unwrap()
                .to_owned(),
            registered["model"].clone(),
        ));
    }
    lineage
}

fn stored_model_rows(state_file: &Path) -> (String, usize, usize, usize) {
    let connection = Connection::open(state_file).unwrap();
    let schema: String = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let (whole, changes, bytes): (i64, i64, i64) = connection
            .query_row("SELECT sum(base_model_hash IS NULL), sum(base_model_hash IS NOT NULL), sum(length(definition_json)) FROM models", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap();
    (schema, whole as usize, changes as usize, bytes as usize)
}

fn assert_lineage_rebuilds(state_file: &Path, lineage: &[(String, serde_json::Value)]) {
    let mut session = MachineSession::with_state_file(state_file).unwrap();
    // Newest first, so every revision is rebuilt from changes rather than read from what is ready.
    for (hash, definition) in lineage.iter().rev() {
        let read = result(session.parse_and_execute(&command(
            "get_model",
            serde_json::json!({ "model_hash": hash }),
        )));
        assert_eq!(
            serde_json::to_vec(&read["model"]).unwrap(),
            serde_json::to_vec(definition).unwrap(),
            "revision {hash} rebuilds exactly"
        );
    }
}

fn stored_model_state_file(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "life-sim-{label}-{}-{nonce}.sqlite",
        std::process::id()
    ))
}

fn remove_state_file(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

#[test]
fn model_revisions_are_stored_as_their_changes_and_rebuild_exactly() {
    let state_file = stored_model_state_file("stored-model-changes");
    let lineage = stored_model_lineage(&state_file, 24);
    let (schema, whole, changes, bytes) = stored_model_rows(&state_file);
    assert_eq!(schema, SESSION_STATE_SCHEMA);
    assert_eq!(
        (whole, changes),
        (1, 24),
        "only the first revision is stored whole"
    );
    let full: usize = lineage
        .iter()
        .map(|(_, definition)| serde_json::to_vec(definition).unwrap().len())
        .sum();
    assert!(
        bytes * 8 < full,
        "25 revisions take {bytes} bytes stored, {full} as whole copies"
    );
    let session = MachineSession::with_state_file(&state_file).unwrap();
    assert!(
        session.models.row_bytes_total() * 8 < full,
        "the stored rows take what each revision changed"
    );
    assert_eq!(
        session.models.held_bytes(),
        0,
        "a reopened session holds no rows beyond its caches: the file has them"
    );
    drop(session);
    assert_lineage_rebuilds(&state_file, &lineage);
    remove_state_file(&state_file);
}

#[test]
fn a_revision_that_only_changes_the_sign_of_a_zero_is_kept_and_reopens() {
    // 0.0 and -0.0 compare equal as values but are written, and hashed, differently.
    let state_file = stored_model_state_file("stored-model-signed-zero");
    let mut lineage = stored_model_lineage(&state_file, 6);
    {
        let mut session = MachineSession::with_state_file(&state_file).unwrap();
        let (previous, current) = lineage.last().unwrap().clone();
        let mut next = current.clone();
        let events = next["meaning_model"]["events"].as_array_mut().unwrap();
        let event = events
            .iter_mut()
            .find(|event| event["interval"]["start"].as_f64() == Some(0.0))
            .expect("an event starting at 0.0");
        event["interval"]["start"] = serde_json::json!(-0.0);
        next["revision"] = serde_json::json!({ "number": current["revision"]["number"].as_u64().unwrap() + 1,
                "previous_model_hash": previous, "reason": "only the sign of a zero", "provenance": ["stored-model-test"] });
        let revised = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({ "model": next }),
        )));
        let hash = revised["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_ne!(&hash, &previous, "the sign of a zero changes the hash");
        lineage.push((hash.clone(), revised["model"].clone()));
        // Read four others, so it is no longer ready, then read it again from what is kept.
        for (other, _) in lineage.iter().take(4) {
            result(session.parse_and_execute(&command(
                "get_model",
                serde_json::json!({ "model_hash": other }),
            )));
        }
        let read = result(session.parse_and_execute(&command(
            "get_model",
            serde_json::json!({ "model_hash": hash }),
        )));
        assert_eq!(
            serde_json::to_vec(&read["model"]).unwrap(),
            serde_json::to_vec(&lineage.last().unwrap().1).unwrap()
        );
    }
    assert_lineage_rebuilds(&state_file, &lineage);
    remove_state_file(&state_file);
}

/// A v2 state file holding a short lineage, every revision whole, as an older engine wrote it.
fn v2_state_file(label: &str, lineage: &[(String, serde_json::Value)]) -> PathBuf {
    let state_file = stored_model_state_file(label);
    let connection = Connection::open(&state_file).unwrap();
    connection
        .execute_batch("PRAGMA journal_mode = WAL;")
        .unwrap();
    let v2_schema = SQLITE_SESSION_SCHEMA.replace(
        ",\n    base_model_hash TEXT REFERENCES models(model_hash)\n);",
        "\n);",
    );
    assert_ne!(v2_schema, SQLITE_SESSION_SCHEMA);
    connection.execute_batch(&v2_schema).unwrap();
    connection
        .execute(
            "INSERT INTO session_metadata(key, value) VALUES ('session_schema', ?1)",
            [SESSION_STATE_SCHEMA_V2],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO session_metadata(key, value) VALUES ('generation', '7')",
            [],
        )
        .unwrap();
    for (hash, definition) in lineage {
        connection
            .execute(
                "INSERT INTO models(model_hash, definition_json) VALUES (?1, ?2)",
                params![hash, serde_json::to_vec(definition).unwrap()],
            )
            .unwrap();
    }
    state_file
}

fn next_revision(lineage: &[(String, serde_json::Value)], reason: &str) -> serde_json::Value {
    let (previous, current) = lineage.last().unwrap();
    let mut next = current.clone();
    next["revision"] = serde_json::json!({ "number": current["revision"]["number"].as_u64().unwrap() + 1,
            "previous_model_hash": previous, "reason": reason, "provenance": ["stored-model-test"] });
    next
}

#[test]
fn a_load_reads_one_snapshot_while_another_session_migrates_the_file() {
    let lineage = {
        let source = stored_model_state_file("stored-model-race-source");
        let lineage = stored_model_lineage(&source, 6);
        remove_state_file(&source);
        lineage
    };
    let state_file = v2_state_file("stored-model-race", &lineage);
    // Between this load reading "v2" and reading the rows, another session writes, which migrates the file.
    let other = state_file.clone();
    let written = next_revision(&lineage, "written by the other session");
    AFTER_SCHEMA_READ.with(|cell| {
        *cell.borrow_mut() = Some(Box::new(move || {
            let mut session = MachineSession::with_state_file(&other).unwrap();
            result(session.parse_and_execute(&command(
                "revise_model",
                serde_json::json!({ "model": written }),
            )));
        }))
    });
    let mut session = MachineSession::with_state_file(&state_file)
        .expect("the load sees the file as it was when it began");
    for (hash, definition) in &lineage {
        let read = result(session.parse_and_execute(&command(
            "get_model",
            serde_json::json!({ "model_hash": hash }),
        )));
        assert_eq!(
            serde_json::to_vec(&read["model"]).unwrap(),
            serde_json::to_vec(definition).unwrap()
        );
    }
    // Its generation is the one it read the rows with, so it cannot overwrite what the other session wrote.
    let late = session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({ "model": next_revision(&lineage, "written late") }),
    ));
    assert!(!late.ok, "a write from the earlier snapshot is refused");
    assert!(
        late.error
            .as_ref()
            .unwrap()
            .message
            .contains("changed since it was opened"),
        "{:?}",
        late.error
    );
    drop(session);
    let (schema, whole, changes, _) = stored_model_rows(&state_file);
    assert_eq!(
        (schema.as_str(), whole, changes),
        (SESSION_STATE_SCHEMA, 1, lineage.len())
    );
    assert_lineage_rebuilds(&state_file, &lineage);
    remove_state_file(&state_file);
}

#[test]
fn a_v2_state_file_is_read_as_it_is_and_migrated_on_its_first_write() {
    let source = stored_model_state_file("stored-model-v2-source");
    let lineage = stored_model_lineage(&source, 6);
    remove_state_file(&source);
    // The file a v2 engine wrote: the same tables, with every model revision stored whole.
    let state_file = stored_model_state_file("stored-model-v2");
    {
        let connection = Connection::open(&state_file).unwrap();
        let v2_schema = SQLITE_SESSION_SCHEMA.replace(
            ",\n    base_model_hash TEXT REFERENCES models(model_hash)\n);",
            "\n);",
        );
        assert_ne!(v2_schema, SQLITE_SESSION_SCHEMA);
        connection.execute_batch(&v2_schema).unwrap();
        connection
            .execute(
                "INSERT INTO session_metadata(key, value) VALUES ('session_schema', ?1)",
                [SESSION_STATE_SCHEMA_V2],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO session_metadata(key, value) VALUES ('generation', '7')",
                [],
            )
            .unwrap();
        for (hash, definition) in &lineage {
            connection
                .execute(
                    "INSERT INTO models(model_hash, definition_json) VALUES (?1, ?2)",
                    params![hash, serde_json::to_vec(definition).unwrap()],
                )
                .unwrap();
        }
    }
    // Reading it leaves it a v2 file, so an older engine can still open it.
    assert_lineage_rebuilds(&state_file, &lineage);
    let connection = Connection::open(&state_file).unwrap();
    let schema: String = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'session_schema'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(schema, SESSION_STATE_SCHEMA_V2);
    drop(connection);
    // Its first write migrates it: every revision but the first is rewritten as its changes.
    {
        let mut session = MachineSession::with_state_file(&state_file).unwrap();
        let mut next: ModelDefinition =
            serde_json::from_value(lineage.last().unwrap().1.clone()).unwrap();
        next.revision = ModelRevision {
            number: next.revision.number + 1,
            previous_model_hash: Some(lineage.last().unwrap().0.clone()),
            reason: "after migration".to_owned(),
            provenance: vec!["stored-model-test".to_owned()],
        };
        result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({ "model": next }),
        )));
    }
    let (schema, whole, changes, _) = stored_model_rows(&state_file);
    assert_eq!(schema, SESSION_STATE_SCHEMA);
    assert_eq!(
        (whole, changes),
        (1, lineage.len()),
        "the migrated file keeps only the first revision whole"
    );
    assert_lineage_rebuilds(&state_file, &lineage);
    remove_state_file(&state_file);
}

#[test]
fn a_stored_change_that_does_not_rebuild_its_revision_is_refused() {
    let state_file = stored_model_state_file("stored-model-tampered");
    let lineage = stored_model_lineage(&state_file, 3);
    {
        let connection = Connection::open(&state_file).unwrap();
        let json: Vec<u8> = connection
            .query_row(
                "SELECT definition_json FROM models WHERE model_hash = ?1",
                [&lineage[2].0],
                |row| row.get(0),
            )
            .unwrap();
        let tampered = String::from_utf8(json)
            .unwrap()
            .replace("revised in revision 2", "quietly changed");
        connection
            .execute(
                "UPDATE models SET definition_json = ?1 WHERE model_hash = ?2",
                params![tampered.into_bytes(), &lineage[2].0],
            )
            .unwrap();
    }
    let refused = MachineSession::with_state_file(&state_file).unwrap_err();
    assert!(refused.to_string().contains("content hash"), "{refused}");
    remove_state_file(&state_file);
}

#[test]
fn stored_revisions_must_each_have_their_base() {
    let lineage = {
        let state_file = stored_model_state_file("stored-model-order");
        let lineage = stored_model_lineage(&state_file, 2);
        remove_state_file(&state_file);
        lineage
    };
    let delta = model_delta::compute(&lineage[0].1, &lineage[1].1).unwrap();
    let orphan = StoredModel::Changes {
        model_hash: lineage[1].0.clone(),
        base_model_hash: "0".repeat(64),
        delta,
    };
    assert!(model_store::rebuild_order(&[orphan])
        .unwrap_err()
        .to_string()
        .contains("lacks its base"));
    let whole = |index: usize| StoredModel::Whole {
        model_hash: lineage[index].0.clone(),
        definition: Box::new(serde_json::from_value(lineage[index].1.clone()).unwrap()),
    };
    assert!(model_store::rebuild_order(&[whole(0), whole(0)])
        .unwrap_err()
        .to_string()
        .contains("duplicate"));
    // Rows arrive in hash order; the order rebuilds each after the revision it is rebuilt from.
    let order = model_store::rebuild_order(&[whole(2), whole(0), whole(1)]).unwrap();
    assert_eq!(order, vec![1, 2, 0]);
}

#[test]
fn genesis_refinement_persists_across_restart() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-genesis-refinement-{}-{nonce}.sqlite",
        std::process::id()
    ));
    assert!(!state_file.exists());
    let target_model_hash;
    {
        let base = genesis_refinement_base_model();
        let mut session = MachineSession::with_state_file(&state_file).unwrap();
        let registered = result(session.parse_and_execute(&command(
            "register_model",
            serde_json::json!({"model": base.clone()}),
        )));
        let source_model_hash = registered["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "create_world",
            serde_json::json!({"model_hash": source_model_hash, "world_id": "durable-refinement"}),
        )));
        let revised = result(session.parse_and_execute(&command(
            "revise_model",
            serde_json::json!({
                "model": additive_genesis_revision(&base, &source_model_hash, "temperature")
            }),
        )));
        target_model_hash = revised["summary"]["model_hash"]
            .as_str()
            .unwrap()
            .to_owned();
        result(session.parse_and_execute(&command(
            "refine_genesis_world",
            serde_json::json!({
                "world_id": "durable-refinement",
                "model_hash": target_model_hash,
                "view": {"requested_observables": ["world.temperature"]}
            }),
        )));
    }

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    let world = result(restored.parse_and_execute(&command(
        "get_world",
        serde_json::json!({
            "world_id": "durable-refinement",
            "view": {"requested_observables": ["person.stress", "world.temperature"]}
        }),
    )));
    assert_eq!(world["model_hash"], target_model_hash);
    assert_eq!(world["model_revision"], 1);
    assert_eq!(world["version"], 0);
    assert_eq!(world["time"], 0.0);
    assert!(world["state"].get("person.stress").is_some());
    assert!(world["state"].get("world.temperature").is_some());
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn failed_durable_write_is_not_acknowledged_and_rolls_back_memory() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let missing_parent = std::env::temp_dir().join(format!(
        "life-sim-missing-parent-{}-{nonce}",
        std::process::id()
    ));
    assert!(!missing_parent.exists());
    let state_file = missing_parent.join("state.sqlite");
    let mut session = MachineSession::with_state_file(state_file).unwrap();
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    ));
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "persistence_error");
    assert!(session.models.is_empty());
    assert!(session.worlds.is_empty());
    assert!(session.candidates.is_empty());
    assert!(!missing_parent.exists());
}

#[test]
fn restart_rejects_a_status_tampered_accepted_lineage() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
    )));
    let candidate = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
    result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": candidate_hash}),
    )));

    let mut snapshot = session.snapshot();
    snapshot
        .candidates
        .iter_mut()
        .find(|candidate| candidate.record.candidate.candidate_hash == candidate_hash)
        .unwrap()
        .record
        .status = CandidateStatus::Pending;
    let failure = MachineSession::restore(snapshot).unwrap_err();
    assert!(failure.0.contains("accepted lineage"));
}

/// Every machine operation, and whether it changes the session and so is written to a state file.
const OPERATION_CLASSIFICATION: [(&str, bool); 36] = [
    ("compile_profiles", false),
    ("validate_model", false),
    ("register_model", true),
    ("revise_model", true),
    ("get_model", false),
    ("create_world", true),
    ("get_world", false),
    ("refine_genesis_world", true),
    ("revise_world", true),
    ("get_world_revision", false),
    ("query_graph", false),
    ("query_view", false),
    ("register_narrative_graph", true),
    ("revise_narrative_graph", true),
    ("revise_narrative_graph_by_change", true),
    ("apply_narrative_batch", true),
    ("list_narrative_revisions", false),
    ("query_narrative_graph", false),
    ("render_narrative_graph", false),
    ("export_narrative_training", false),
    ("register_project_checkpoint", true),
    ("list_project_checkpoints", false),
    ("get_project_checkpoint", false),
    ("export_project_checkpoint", false),
    ("render_project_checkpoint", false),
    ("query_project_checkpoint_graph", false),
    ("roll_world", true),
    ("inspect_candidate", false),
    ("summarize_trajectory", false),
    ("reroll_candidate", true),
    ("reject_candidate", true),
    ("commit_candidate", true),
    ("model_lineage", false),
    ("model_heads", false),
    ("store_status", false),
    ("audit_store", true),
];

fn unique_state_path(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "life-sim-{label}-{}-{nonce}.sqlite",
        std::process::id()
    ))
}

fn remove_state_files(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

fn other_model() -> ModelDefinition {
    ModelDefinition {
        id: "other-world".to_owned(),
        ..test_model()
    }
}

fn register(session: &mut MachineSession, model: ModelDefinition) -> String {
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": model }),
    )));
    registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn model_hash_of(model: ModelDefinition) -> String {
    compile_model(model).unwrap().model_hash
}

/// Whether this process can still open a file whose permissions forbid it, as root can.
#[cfg(unix)]
fn permissions_are_bypassed() -> bool {
    let probe = unique_state_path("permission-probe");
    fs::write(&probe, b"probe").unwrap();
    fs::set_permissions(&probe, fs::Permissions::from_mode(0o000)).unwrap();
    let bypassed = fs::File::open(&probe).is_ok();
    let _ = fs::remove_file(&probe);
    bypassed
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

/// Makes the next durable write fail at COMMIT, with a row whose foreign key is checked only then, after running
/// `also` inside the transaction.
fn fail_next_commit(also: impl FnOnce() + 'static) {
    BEFORE_COMMIT.with(|cell| {
        *cell.borrow_mut() = Some(Box::new(move |transaction: &Transaction<'_>| {
            transaction
                .execute_batch(
                    "PRAGMA defer_foreign_keys = ON;
                         INSERT INTO worlds(world_id, model_hash, world_json)
                             VALUES ('injected', 'no-such-model', x'00');",
                )
                .unwrap();
            also();
        }))
    });
}

fn fail_next_command(message: &str) {
    FAIL_AFTER_EXECUTE
        .with(|cell| *cell.borrow_mut() = Some(machine_error("internal_error", message)));
}

#[test]
fn unflushed_rows_refuse_exactly_the_mutating_operations_of_a_durable_session() {
    let path = unique_state_path("unflushed-guard");
    let mut durable = MachineSession::with_state_file(&path).unwrap();
    let mut memory = MachineSession::default();
    durable.dirty.models.insert("unflushed".to_owned());
    memory.dirty.models.insert("unflushed".to_owned());
    for (operation, mutating) in OPERATION_CLASSIFICATION {
        assert!(is_machine_operation(operation), "{operation}");
        let line = command(operation, serde_json::json!({}));
        let unguarded = serde_json::to_value(memory.parse_and_execute(&line)).unwrap();
        let mut answered = serde_json::to_value(durable.parse_and_execute(&line)).unwrap();
        assert_ne!(unguarded["error"]["code"], "internal_error", "{operation}");
        if mutating {
            assert_eq!(
                answered,
                serde_json::json!({
                    "schema": crate::RESPONSE_SCHEMA,
                    "request_id": format!("{operation}-request"),
                    "ok": false,
                    "error": {
                        "code": "internal_error",
                        "message": "durable session began a command with unflushed dirty rows"
                    }
                }),
                "{operation}"
            );
        } else {
            if operation == "store_status" {
                assert_eq!(answered["result"]["state_file"], true);
                assert_eq!(unguarded["result"]["state_file"], false);
                // This status field deliberately distinguishes durable and memory-only sessions.
                answered["result"]["state_file"] = serde_json::json!(false);
            }
            assert_eq!(answered, unguarded, "{operation}");
        }
    }
    assert!(!path.exists());
}

#[test]
fn a_failed_commit_whose_reload_finds_the_old_generation_is_not_committed() {
    let path = unique_state_path("failed-commit");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let first = register(&mut session, test_model());
    fail_next_commit(|| {});
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": other_model() }),
    ));
    let error = response.error.unwrap();
    assert_eq!(error.code, "persistence_error");
    assert_eq!(
            error.message,
            "state mutation was not committed: failed to commit SQLite session transaction: FOREIGN KEY constraint failed"
        );
    // The session was reloaded from the file: the first model only, nothing left to write.
    assert_eq!(session.persistence_generation, 1);
    assert!(session.models.contains_key(&first));
    assert!(!session.models.contains_key(&model_hash_of(other_model())));
    assert!(session.dirty.is_empty());
    register(&mut session, other_model());
    assert_eq!(session.persistence_generation, 2);
    remove_state_files(&path);
}

#[cfg(unix)]
#[test]
fn a_failed_commit_whose_reload_also_fails_is_uncertain() {
    if permissions_are_bypassed() {
        return;
    }
    let path = unique_state_path("uncertain-commit");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    register(&mut session, test_model());
    let locked = path.clone();
    fail_next_commit(move || set_mode(&locked, 0o000));
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": other_model() }),
    ));
    set_mode(&path, 0o600);
    let error = response.error.unwrap();
    let shown = path.display();
    assert_eq!(error.code, "persistence_uncertain");
    assert_eq!(
            error.message,
            format!(
                "SQLite commit outcome is uncertain: failed to commit SQLite session transaction: FOREIGN KEY \
                 constraint failed; authoritative reload also failed: failed to inspect SQLite state file {shown}: \
                 unable to open database file: {shown}"
            )
        );
    // The unwritten change stays in memory, still dirty, and the file holds only the first model.
    let other = model_hash_of(other_model());
    assert!(session.models.contains_key(&other));
    assert!(!session.dirty.is_empty());
    let reopened = MachineSession::with_state_file(&path).unwrap();
    assert!(!reopened.models.contains_key(&other));
    remove_state_files(&path);
}

#[test]
fn a_durable_command_that_fails_after_its_changes_is_reloaded_from_sqlite() {
    let path = unique_state_path("failed-after-changes");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let first = register(&mut session, test_model());
    fail_next_command("injected failure after changes");
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": other_model() }),
    ));
    assert_eq!(
        serde_json::to_value(&response).unwrap(),
        serde_json::json!({
            "schema": crate::RESPONSE_SCHEMA,
            "request_id": "register_model-request",
            "ok": false,
            "error": {"code": "internal_error", "message": "injected failure after changes"}
        })
    );
    assert!(session.models.contains_key(&first));
    assert!(!session.models.contains_key(&model_hash_of(other_model())));
    assert!(session.dirty.is_empty());
    assert_eq!(session.persistence_generation, 1);
    remove_state_files(&path);
}

#[test]
fn a_first_durable_command_that_fails_after_its_changes_leaves_an_empty_session() {
    let path = unique_state_path("first-failed-after-changes");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    fail_next_command("injected failure after changes");
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": test_model() }),
    ));
    assert_eq!(
        response.error.unwrap().message,
        "injected failure after changes"
    );
    assert!(session.models.is_empty());
    assert!(session.dirty.is_empty());
    assert_eq!(session.state_file(), Some(path.as_path()));
    assert!(!path.exists());
    register(&mut session, test_model());
    assert!(path.exists());
    remove_state_files(&path);
}

#[cfg(unix)]
#[test]
fn a_durable_command_that_fails_after_its_changes_keeps_its_error_when_the_reload_fails() {
    if permissions_are_bypassed() {
        return;
    }
    let path = unique_state_path("failed-reload-after-changes");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    register(&mut session, test_model());
    set_mode(&path, 0o000);
    fail_next_command("injected failure after changes");
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": other_model() }),
    ));
    set_mode(&path, 0o600);
    let error = response.error.unwrap();
    assert_eq!(
        (error.code, error.message.as_str()),
        ("internal_error", "injected failure after changes")
    );
    // The reload failed, so the change stays in memory and the next mutation is refused.
    assert!(session.models.contains_key(&model_hash_of(other_model())));
    assert!(!session.dirty.is_empty());
    let refused = session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash_of(test_model()), "world_id": "world"}),
    ));
    assert_eq!(
        refused.error.unwrap().message,
        "durable session began a command with unflushed dirty rows"
    );
    remove_state_files(&path);
}

#[test]
fn an_in_memory_command_that_fails_after_its_changes_keeps_them() {
    let mut session = MachineSession::default();
    fail_next_command("injected failure after changes");
    let response = session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({ "model": test_model() }),
    ));
    assert!(!response.ok);
    assert!(session.models.contains_key(&model_hash_of(test_model())));
    assert!(session.dirty.is_empty());
}

#[test]
fn an_existing_candidate_bound_to_different_content_is_a_conflict_for_roll_and_reroll() {
    let mut session = MachineSession::default();
    let model_hash = register(&mut session, test_model());
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
    )));
    let roll = |session: &mut MachineSession, index: u64| {
        session.parse_and_execute(&command(
            "roll_world",
            serde_json::json!({"world_id": "world", "query": query(index, PathSpec::Endpoint)}),
        ))
    };
    let first = result(roll(&mut session, 0));
    let a = first["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let second = result(roll(&mut session, 1));
    let b = second["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();

    // The stored A no longer matches what the same query computes.
    session
        .candidates
        .get_mut(&a)
        .unwrap()
        .record
        .proposed_head
        .time += 1.0;
    let before = session.candidates.clone();
    let error = roll(&mut session, 0).error.unwrap();
    assert_eq!(
        (error.code, error.message.as_str()),
        (
            "conflict",
            "candidate hash is already bound to different canonical content"
        )
    );
    assert_eq!(session.candidates, before);
    session
        .candidates
        .get_mut(&a)
        .unwrap()
        .record
        .proposed_head
        .time -= 1.0;

    // Rerolling A computes B, whose stored content no longer matches.
    session
        .candidates
        .get_mut(&b)
        .unwrap()
        .record
        .proposed_head
        .time += 1.0;
    let before = session.candidates.clone();
    let error = session
        .parse_and_execute(&command(
            "reroll_candidate",
            serde_json::json!({ "candidate_hash": a }),
        ))
        .error
        .unwrap();
    assert_eq!(
        (error.code, error.message.as_str()),
        (
            "conflict",
            "reroll candidate hash is already bound to different content"
        )
    );
    assert_eq!(session.candidates, before);
}

#[cfg(unix)]
#[test]
fn discarding_unwritten_changes_reports_a_failed_reload_and_keeps_the_session() {
    if permissions_are_bypassed() {
        return;
    }
    let path = unique_state_path("discard-unwritten");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let first = register(&mut session, test_model());
    session.dirty.models.insert("unwritten".to_owned());
    set_mode(&path, 0o000);
    let failed = session.discard_unwritten_changes();
    set_mode(&path, 0o600);
    let shown = path.display();
    assert_eq!(
        failed.unwrap_err().0,
        format!(
            "failed to inspect SQLite state file {shown}: unable to open database file: {shown}"
        )
    );
    assert!(session.models.contains_key(&first));
    assert!(session.dirty.models.contains("unwritten"));
    // Once the file can be read, the unwritten change is dropped and the stored state reloaded.
    session.discard_unwritten_changes().unwrap();
    assert!(session.models.contains_key(&first));
    assert!(session.dirty.is_empty());
    remove_state_files(&path);
}

#[test]
fn discarding_the_changes_of_a_session_not_yet_written_empties_it() {
    let path = unique_state_path("discard-unwritten-empty");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    session.dirty.models.insert("unwritten".to_owned());
    session.discard_unwritten_changes().unwrap();
    assert!(session.dirty.is_empty());
    assert_eq!(session.state_file(), Some(path.as_path()));
    assert!(!path.exists());
    let mut memory = MachineSession::default();
    register(&mut memory, test_model());
    memory.discard_unwritten_changes().unwrap();
    assert!(memory.models.contains_key(&model_hash_of(test_model())));
}

#[test]
fn query_graph_full_exposes_factor_payloads_ast_edges_and_overlays_without_mutation() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let before = hash_serializable(&session.snapshot()).unwrap();
    let full = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "model_hash": model_hash,
            "graph_query": {"mode": "full"}
        }),
    )));
    assert_eq!(full["schema"], MODEL_GRAPH_SCHEMA);
    assert_eq!(full["mode"], "full");
    assert_eq!(full["total_node_count"], 10);
    assert_eq!(full["total_edge_count"], 18);
    assert_eq!(full["returned_node_count"], 10);
    assert_eq!(full["returned_edge_count"], 18);

    let nodes = full["nodes"].as_array().unwrap();
    let relation = nodes
        .iter()
        .find(|node| node["id"] == "law:derive-error")
        .unwrap();
    assert_eq!(relation["law_definition"]["operator"]["role"], "relation");
    assert_eq!(relation["law_definition"]["provenance"][0], "authored-test");
    let stress = nodes
        .iter()
        .find(|node| node["id"] == "process:person.stress")
        .unwrap();
    assert_eq!(stress["process_metadata"]["unit"], "normalized");
    assert_eq!(stress["process_metadata"]["scale"]["temporal"], "scene");
    assert_eq!(
        stress["process_metadata"]["support"][0],
        "finite scalar test support"
    );
    assert!(stress.get("value").is_none());

    let edges = full["edges"].as_array().unwrap();
    let has_edge = |kind: &str, source: &str, target: &str| {
        edges.iter().any(|edge| {
            edge["kind"] == kind && edge["source"] == source && edge["target"] == target
        })
    };
    assert!(has_edge(
        "reads",
        "process:person.stress",
        "law:derive-error"
    ));
    assert!(has_edge(
        "writes",
        "law:derive-error",
        "process:person.error_propensity"
    ));
    assert!(has_edge(
        "activates",
        "law:pressure-gate",
        "law:gated-relief"
    ));
    assert!(has_edge(
        "decomposition",
        "process:family.pressure",
        "process:person.stress"
    ));
    assert!(has_edge(
        "declared_dependency",
        "process:person.stress",
        "process:person.error_propensity"
    ));
    assert!(edges.iter().all(|edge| edge["id"]
        .as_str()
        .is_some_and(|id| id.starts_with("edge:"))));
    assert_eq!(hash_serializable(&session.snapshot()).unwrap(), before);
}

#[test]
fn a_sealed_store_still_loads_whole_as_an_engine_without_seals_reads_it() {
    // An engine that predates seals reads every row and validates it; the seal table is ignored.
    let state_file = stored_model_state_file("sealed-whole-load");
    let lineage = stored_model_lineage(&state_file, 6);
    let persisted = load_sqlite_session(&state_file).unwrap();
    assert_eq!(persisted.models.len(), 7);
    let mut restored = MachineSession::restore(persisted).unwrap();
    let (head, definition) = lineage.last().unwrap();
    let read = result(restored.parse_and_execute(&command(
        "get_model",
        serde_json::json!({ "model_hash": head }),
    )));
    assert_eq!(&read["model"], definition);
    remove_state_file(&state_file);
}
