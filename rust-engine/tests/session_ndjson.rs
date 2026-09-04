use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

fn exchange_raw(stdin: &mut impl Write, stdout: &mut impl BufRead, command: Value) -> Value {
    writeln!(stdin, "{}", serde_json::to_string(&command).unwrap()).unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

fn exchange(stdin: &mut impl Write, stdout: &mut impl BufRead, command: Value) -> Value {
    let response = exchange_raw(stdin, stdout, command);
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

fn spawn_durable(state_file: &Path) -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .arg("--ndjson")
        .arg("--state-file")
        .arg(state_file)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap()
}

#[test]
fn ndjson_project_checkpoint_document_survives_restart_and_exports_portably() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-project-checkpoint-{}-{nonce}.sqlite",
        std::process::id()
    ));
    let mut first = spawn_durable(&state_file);
    let mut first_stdin = first.stdin.take().unwrap();
    let mut first_stdout = BufReader::new(first.stdout.take().unwrap());
    let registered = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "version-1",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown; charset=utf-8",
                    "content": {"encoding": "utf8", "text": "# Version One\n\nPortable prose.\n"},
                    "canonical_external_path": "experiments/version-1/story.md"
                },
                "reason": "Preserve an externally canonical early edition.",
                "provenance": ["rust NDJSON project checkpoint test"]
            }
        }),
    );
    let checkpoint_hash = registered["checkpoint_hash"].as_str().unwrap().to_owned();
    drop(first_stdin);
    assert!(first.wait().unwrap().success());

    let mut second = spawn_durable(&state_file);
    let mut second_stdin = second.stdin.take().unwrap();
    let mut second_stdout = BufReader::new(second.stdout.take().unwrap());
    let rendered = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_project_checkpoint",
            "project_checkpoint_id": checkpoint_hash
        }),
    );
    assert_eq!(
        rendered["content"]["text"],
        "# Version One\n\nPortable prose.\n"
    );
    assert_eq!(
        rendered["canonical_external_path"],
        "experiments/version-1/story.md"
    );
    let exported = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_project_checkpoint",
            "project_checkpoint_id": "version-1"
        }),
    );
    assert_eq!(exported["checkpoint_hash"], checkpoint_hash);
    assert_eq!(
        exported["project_checkpoint"]["document"]["content"]["text"],
        "# Version One\n\nPortable prose.\n"
    );
    drop(second_stdin);
    assert!(second.wait().unwrap().success());

    let connection = Connection::open(&state_file).unwrap();
    let checkpoint_count: i64 = connection
        .query_row("SELECT count(*) FROM project_checkpoints", [], |row| {
            row.get(0)
        })
        .unwrap();
    let document_count: i64 = connection
        .query_row("SELECT count(*) FROM project_documents", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(checkpoint_count, 1);
    assert_eq!(document_count, 1);
    drop(connection);
    fs::remove_file(&state_file).unwrap();
}

fn person_profile_request() -> Value {
    json!({
        "schema": "life-sim-rust-profile-compilation/v1",
        "model": {
            "id": "ndjson-person-profile",
            "time_unit": "day",
            "reason": "Compile three bounded interpretations without persisting them.",
            "provenance": ["rust ndjson integration test"]
        },
        "profiles": [{
            "kind": "person",
            "profile": {
                "id": "research_year",
                "subject_id": "alex",
                "person_boundary": "Alex during one bounded year.",
                "continuity_criterion": "The same embodied person across the interval.",
                "evidence_boundary": "Events observed or reported during that year.",
                "evidence": [{
                    "id": "release",
                    "value": 1.0,
                    "bounds": {"minimum": 0.0, "maximum": 1.0},
                    "evidence_type": "observation",
                    "holder": "operator",
                    "authority": {"source": "release_record", "weight": 1.0}
                }],
                "position_bounds": {"minimum": -1.0, "maximum": 1.0},
                "views": [{
                    "id": "outside",
                    "kind": "external_descriptive",
                    "holder": "operator",
                    "estimator": "research_agent",
                    "authority_weight": 0.6,
                    "nodes": [{"id": "research_as_path", "position": 0.4}]
                }, {
                    "id": "candidate",
                    "kind": "candidate_actor",
                    "holder": "operator",
                    "estimator": "research_agent",
                    "authority_weight": 0.5,
                    "nodes": [{"id": "research_as_path", "position": 0.7}]
                }, {
                    "id": "self",
                    "kind": "self_reported",
                    "holder": "alex",
                    "estimator": "alex",
                    "authority_weight": 1.0,
                    "nodes": [{"id": "research_as_path", "position": 0.9}]
                }],
                "provenance": ["rust ndjson integration test"]
            }
        }]
    })
}

#[test]
fn persistent_ndjson_process_owns_world_candidate_and_commit() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .arg("--ndjson")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let model = json!({
        "schema": "life-sim-rust-model/v1",
        "id": "ndjson-world",
        "time_unit": "tick",
        "revision": {
            "number": 0,
            "reason": "NDJSON integration fixture",
            "provenance": ["rust integration test"]
        },
        "processes": [{
            "id": "world.signal",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 1.0}
            },
            "initial_value": {"kind": "scalar", "value": 0.2},
            "provenance": ["rust integration test"],
            "support": ["bounded test signal"]
        }],
        "laws": [{
            "id": "signal-drift",
            "operator": {
                "role": "evolution",
                "target": "world.signal",
                "derivative": {"op": "constant", "value": 0.1}
            },
            "provenance": ["rust integration test"]
        }]
    });
    let registered = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "register",
            "operation": "register_model",
            "model": model
        }),
    );
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "create",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "persistent-world"
        }),
    );
    let candidate = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "roll",
            "operation": "roll_world",
            "world_id": "persistent-world",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 1.0,
                "step_size": 0.5,
                "seed": "ndjson-seed",
                "path": {"mode": "full"}
            }
        }),
    );
    assert_eq!(candidate["status"], "pending");
    assert_eq!(
        candidate["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let candidate_hash = candidate["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let committed = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "commit",
            "operation": "commit_candidate",
            "candidate_hash": candidate_hash
        }),
    );
    assert_eq!(committed["candidate"]["status"], "committed");
    assert_eq!(committed["world_head"]["version"], 1);
    let accepted = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "get",
            "operation": "get_world",
            "world_id": "persistent-world"
        }),
    );
    assert_eq!(
        accepted["world_hash"],
        committed["world_head"]["world_hash"]
    );

    drop(stdin);
    assert!(child.wait().unwrap().success());
}

#[test]
fn ndjson_initial_boundary_intervention_affects_the_first_step_without_changing_legacy_default() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .arg("--ndjson")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let model = json!({
        "schema": "life-sim-rust-model/v1",
        "id": "ndjson-intervention-timing",
        "time_unit": "second",
        "revision": {
            "number": 0,
            "reason": "Exercise explicit initial-boundary intervention timing.",
            "provenance": ["rust ndjson integration test"]
        },
        "processes": [{
            "id": "timing.control",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 10.0}
            },
            "initial_value": {"kind": "scalar", "value": 1.0},
            "provenance": ["rust ndjson integration test"],
            "support": ["phase control"],
            "update_mode": "static"
        }, {
            "id": "timing.signal",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 10.0}
            },
            "initial_value": {"kind": "scalar", "value": 2.0},
            "provenance": ["rust ndjson integration test"],
            "support": ["derived signal"]
        }, {
            "id": "timing.stock",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 10.0}
            },
            "initial_value": {"kind": "scalar", "value": 0.0},
            "provenance": ["rust ndjson integration test"],
            "support": ["integrated stock"]
        }],
        "dependencies": [{
            "id": "control-derives-signal",
            "source": "timing.control",
            "target": "timing.signal",
            "kind": "derives",
            "law_id": "derive-signal"
        }, {
            "id": "signal-causes-stock",
            "source": "timing.signal",
            "target": "timing.stock",
            "kind": "causes",
            "law_id": "evolve-stock"
        }],
        "laws": [{
            "id": "derive-signal",
            "operator": {
                "role": "relation",
                "target": "timing.signal",
                "value": {
                    "op": "multiply",
                    "factors": [
                        {"op": "constant", "value": 2.0},
                        {"op": "process", "process": "timing.control"}
                    ]
                }
            },
            "provenance": ["rust ndjson integration test"]
        }, {
            "id": "evolve-stock",
            "operator": {
                "role": "evolution",
                "target": "timing.stock",
                "derivative": {"op": "process", "process": "timing.signal"}
            },
            "provenance": ["rust ndjson integration test"]
        }]
    });
    let registered = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": model
        }),
    );
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "ndjson-intervention-timing-world"
        }),
    );
    let legacy_query = json!({
        "schema": "life-sim-rust-model-query/v1",
        "delta_time": 0.5,
        "step_size": 0.25,
        "interventions": [{
            "id": "set-control",
            "offset": 0.0,
            "effect": {
                "target": "timing.control",
                "mode": "set",
                "value": {"op": "constant", "value": 2.0}
            }
        }],
        "requested_observables": ["timing.control", "timing.signal", "timing.stock"],
        "path": {"mode": "full"}
    });
    let legacy = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "ndjson-intervention-timing-world",
            "query": legacy_query.clone()
        }),
    );
    assert!(legacy["candidate"]["query"]
        .as_object()
        .unwrap()
        .get("initial_boundary_intervention_count")
        .is_none());
    assert_eq!(
        legacy["candidate"]["path"]["samples"][1]["state"]["timing.stock"]["value"],
        0.5
    );

    let mut initial_query = legacy_query;
    initial_query["interventions"][0]["application"] = json!("initial_boundary");
    let initial = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "ndjson-intervention-timing-world",
            "query": initial_query
        }),
    );
    assert_eq!(
        initial["candidate"]["query"]["initial_boundary_intervention_count"],
        1
    );
    assert_eq!(
        initial["candidate"]["path"]["samples"][0]["state"]["timing.control"]["value"],
        1.0
    );
    assert_eq!(
        initial["candidate"]["path"]["samples"][1]["state"]["timing.control"]["value"],
        2.0
    );
    assert_eq!(
        initial["candidate"]["path"]["samples"][1]["state"]["timing.signal"]["value"],
        4.0
    );
    assert_eq!(
        initial["candidate"]["path"]["samples"][1]["state"]["timing.stock"]["value"],
        1.0
    );
    assert_ne!(
        initial["candidate"]["dynamics_hash"],
        legacy["candidate"]["dynamics_hash"]
    );
    assert_ne!(
        initial["candidate"]["candidate_hash"],
        legacy["candidate"]["candidate_hash"]
    );

    drop(stdin);
    assert!(child.wait().unwrap().success());
}

#[test]
fn durable_session_recovers_pending_candidate_and_atomic_commit_across_restarts() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-rust-restart-{}-{nonce}.sqlite",
        std::process::id()
    ));
    assert!(!state_file.exists());
    let model = json!({
        "schema": "life-sim-rust-model/v1",
        "id": "restart-world",
        "time_unit": "tick",
        "revision": {
            "number": 0,
            "reason": "restart integration fixture",
            "provenance": ["rust integration test"]
        },
        "processes": [{
            "id": "world.signal",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 1.0}
            },
            "initial_value": {"kind": "scalar", "value": 0.2},
            "provenance": ["rust integration test"],
            "support": ["bounded test signal"]
        }],
        "laws": [{
            "id": "signal-drift",
            "operator": {
                "role": "evolution",
                "target": "world.signal",
                "derivative": {"op": "constant", "value": 0.1}
            },
            "provenance": ["rust integration test"]
        }]
    });

    let mut first = spawn_durable(&state_file);
    assert!(
        !state_file.exists(),
        "opening a new durable session is side-effect free"
    );
    let mut first_stdin = first.stdin.take().unwrap();
    let mut first_stdout = BufReader::new(first.stdout.take().unwrap());
    let registered = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": model
        }),
    );
    assert!(state_file.exists());
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "restartable"
        }),
    );
    let rolled = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "restartable",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 1.0,
                "step_size": 0.5,
                "requested_observables": ["world.signal"],
                "path": {"mode": "full"}
            }
        }),
    );
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(first_stdin);
    assert!(first.wait().unwrap().success());

    let mut second = spawn_durable(&state_file);
    let mut second_stdin = second.stdin.take().unwrap();
    let mut second_stdout = BufReader::new(second.stdout.take().unwrap());
    let recovered = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "inspect_candidate",
            "candidate_hash": candidate_hash
        }),
    );
    assert_eq!(recovered["status"], "pending");
    let committed = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "commit_candidate",
            "candidate_hash": candidate_hash
        }),
    );
    assert_eq!(committed["candidate"]["status"], "committed");
    assert_eq!(committed["world_head"]["version"], 1);
    drop(second_stdin);
    assert!(second.wait().unwrap().success());

    let mut third = spawn_durable(&state_file);
    let mut third_stdin = third.stdin.take().unwrap();
    let mut third_stdout = BufReader::new(third.stdout.take().unwrap());
    let world = exchange(
        &mut third_stdin,
        &mut third_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "get_world",
            "world_id": "restartable",
            "view": {
                "requested_observables": ["world.signal"],
                "access_scopes": []
            }
        }),
    );
    assert_eq!(world["version"], 1);
    assert!(world["state"].get("world.signal").is_some());
    let candidate = exchange(
        &mut third_stdin,
        &mut third_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "inspect_candidate",
            "candidate_hash": candidate_hash
        }),
    );
    assert_eq!(candidate["status"], "committed");
    drop(third_stdin);
    assert!(third.wait().unwrap().success());

    fs::remove_file(&state_file).unwrap();
}

#[test]
fn compile_profiles_is_deterministic_read_only_and_requires_explicit_registration() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-profile-compile-{}-{nonce}.sqlite",
        std::process::id()
    ));
    assert!(!state_file.exists());

    let mut first = spawn_durable(&state_file);
    let mut first_stdin = first.stdin.take().unwrap();
    let mut first_stdout = BufReader::new(first.stdout.take().unwrap());
    let compiled = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "compile-person",
            "operation": "compile_profiles",
            "profile_request": person_profile_request()
        }),
    );
    assert_eq!(compiled["stored"], false);
    assert_eq!(compiled["mutation_performed"], false);
    assert_eq!(
        compiled["model"]["meaning_model"]["realizations"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(
        !state_file.exists(),
        "pure profile compilation must not create the durable state file"
    );

    let compiled_again = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "compile-person-again",
            "operation": "compile_profiles",
            "profile_request": person_profile_request()
        }),
    );
    assert_eq!(compiled_again["model"], compiled["model"]);
    assert_eq!(compiled_again["summary"], compiled["summary"]);
    assert!(!state_file.exists());

    let model_hash = compiled["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let not_registered = exchange_raw(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "get-before-register",
            "operation": "get_model",
            "model_hash": model_hash
        }),
    );
    assert_eq!(not_registered["ok"], false);
    assert!(not_registered["error"]["message"]
        .as_str()
        .unwrap()
        .contains("unknown model"));
    assert!(!state_file.exists());

    let registered = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "explicit-register",
            "operation": "register_model",
            "model": compiled["model"].clone()
        }),
    );
    assert_eq!(registered["summary"]["model_hash"], model_hash);
    assert!(state_file.exists());
    drop(first_stdin);
    assert!(first.wait().unwrap().success());

    let mut second = spawn_durable(&state_file);
    let mut second_stdin = second.stdin.take().unwrap();
    let mut second_stdout = BufReader::new(second.stdout.take().unwrap());
    let recovered = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "request_id": "get-after-register",
            "operation": "get_model",
            "model_hash": model_hash
        }),
    );
    assert_eq!(recovered["summary"]["model_hash"], model_hash);
    assert_eq!(recovered["model"], compiled["model"]);
    drop(second_stdin);
    assert!(second.wait().unwrap().success());

    fs::remove_file(&state_file).unwrap();
}

#[test]
fn durable_session_recovers_lawless_observation_and_carries_it_after_commit() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-rust-observed-restart-{}-{nonce}.sqlite",
        std::process::id()
    ));
    let model = json!({
        "schema": "life-sim-rust-model/v1",
        "id": "observed-restart-world",
        "time_unit": "hour",
        "revision": {
            "number": 0,
            "reason": "observed restart integration fixture",
            "provenance": ["rust integration test"]
        },
        "processes": [{
            "id": "estimator.stress_estimate",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 1.0}
            },
            "initial_value": {"kind": "scalar", "value": 0.2},
            "provenance": ["rust integration test"],
            "unit": "normalized",
            "support": ["externally supplied estimate"],
            "update_mode": "observed"
        }]
    });

    let mut first = spawn_durable(&state_file);
    let mut first_stdin = first.stdin.take().unwrap();
    let mut first_stdout = BufReader::new(first.stdout.take().unwrap());
    let registered = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": model
        }),
    );
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "observed-restart"
        }),
    );
    let rolled = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "observed-restart",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 1.0,
                "step_size": 0.5,
                "observations": [{
                    "id": "estimator-output-1",
                    "target": "estimator.stress_estimate",
                    "offset": 0.5,
                    "value": {"kind": "scalar", "value": 0.7},
                    "unit": "normalized",
                    "uncertainty": {"kind": "standard_deviation", "value": 0.1},
                    "evidence_type": "report",
                    "holder": "test-estimator",
                    "provenance": ["synthetic estimator fixture"],
                    "authority": {"source": "test-estimator", "weight": 0.8}
                }],
                "requested_observables": ["estimator.stress_estimate"],
                "path": {"mode": "full"}
            }
        }),
    );
    assert_eq!(rolled["status"], "pending");
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let committed = exchange(
        &mut first_stdin,
        &mut first_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "commit_candidate",
            "candidate_hash": candidate_hash,
            "view": {"requested_observables": ["estimator.stress_estimate"]}
        }),
    );
    assert_eq!(committed["candidate"]["status"], "committed");
    assert_eq!(
        committed["world_head"]["state"]["estimator.stress_estimate"]["value"],
        0.7
    );
    drop(first_stdin);
    assert!(first.wait().unwrap().success());

    let connection = Connection::open(&state_file).unwrap();
    let candidate_json: Vec<u8> = connection
        .query_row(
            "SELECT candidate_json FROM candidates WHERE candidate_hash = ?1",
            [&candidate_hash],
            |row| row.get(0),
        )
        .unwrap();
    let persisted: Value = serde_json::from_slice(&candidate_json).unwrap();
    let stored_observation = &persisted["record"]["candidate"]["query"]["observations"][0];
    assert_eq!(stored_observation["id"], "estimator-output-1");
    assert_eq!(stored_observation["value"]["value"], 0.7);
    assert_eq!(stored_observation["evidence_type"], "report");
    drop(connection);

    let mut second = spawn_durable(&state_file);
    let mut second_stdin = second.stdin.take().unwrap();
    let mut second_stdout = BufReader::new(second.stdout.take().unwrap());
    let recovered = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "inspect_candidate",
            "candidate_hash": candidate_hash,
            "view": {
                "requested_observables": ["estimator.stress_estimate"],
                "include_path": true
            }
        }),
    );
    assert_eq!(recovered["status"], "committed");
    assert_eq!(recovered["candidate"]["query"]["observation_count"], 1);
    let samples = recovered["candidate"]["path"]["samples"]
        .as_array()
        .unwrap();
    assert_eq!(samples.len(), 3);
    assert_eq!(
        samples[0]["state"]["estimator.stress_estimate"]["value"],
        0.2
    );
    assert_eq!(
        samples[1]["state"]["estimator.stress_estimate"]["value"],
        0.7
    );
    assert_eq!(
        samples[2]["state"]["estimator.stress_estimate"]["value"],
        0.7
    );
    let claims = recovered["candidate"]["successor_claims"]
        .as_object()
        .unwrap();
    assert_eq!(claims.len(), 1);
    let claim = claims.values().next().unwrap();
    assert_eq!(claim["mode"], "observed");
    assert_eq!(claim["evidence_type"], "report");
    assert_eq!(claim["value_time"], 0.5);
    assert_eq!(claim["value"]["value"], 0.7);

    let world = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "get_world",
            "world_id": "observed-restart",
            "view": {"requested_observables": ["estimator.stress_estimate"]}
        }),
    );
    assert_eq!(world["version"], 1);
    assert_eq!(world["state"]["estimator.stress_estimate"]["value"], 0.7);
    assert_eq!(world["claims"].as_object().unwrap().len(), 1);

    let carried = exchange(
        &mut second_stdin,
        &mut second_stdout,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "observed-restart",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 0.5,
                "step_size": 0.5,
                "requested_observables": ["estimator.stress_estimate"],
                "path": {"mode": "full"}
            }
        }),
    );
    let carried_samples = carried["candidate"]["path"]["samples"].as_array().unwrap();
    assert_eq!(carried_samples.len(), 2);
    assert!(carried_samples
        .iter()
        .all(|sample| { sample["state"]["estimator.stress_estimate"]["value"] == json!(0.7) }));
    drop(second_stdin);
    assert!(second.wait().unwrap().success());

    fs::remove_file(&state_file).unwrap();
}
