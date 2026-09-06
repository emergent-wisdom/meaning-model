use life_sim_engine::{MachineSession, ResponseEnvelope};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn command(session: &mut MachineSession, operation: &str, mut fields: Value) -> ResponseEnvelope {
    fields["schema"] = json!("life-sim-rust-command/v1");
    fields["operation"] = json!(operation);
    session.parse_and_execute(&fields.to_string())
}

fn execute(session: &mut MachineSession, operation: &str, fields: Value) -> Value {
    let response = command(session, operation, fields);
    assert!(response.ok, "{operation}: {:?}", response.error);
    response.result.unwrap()
}

fn scalar(value: f64) -> Value {
    json!({"kind":"scalar", "value":value})
}

fn process(id: &str, value: f64) -> Value {
    json!({"id":id, "value_type":{"kind":"scalar", "bounds":{"minimum":0.0,"maximum":100.0}},
           "initial_value":scalar(value), "unit":"unit", "update_mode":"static",
           "provenance":["world revision test"], "support":["authored test coordinate"]})
}

fn model() -> Value {
    json!({
        "schema":"life-sim-rust-model/v1", "id":"world-revision-fixture", "time_unit":"day",
        "revision":{"number":0,"reason":"Base model", "provenance":["test"]},
        "processes":[process("x",1.0)],
        "laws":[{"id":"drift", "provenance":["test"], "operator":{"role":"evolution", "target":"x", "derivative":{"op":"constant","value":1.0}}}],
        "initial_claims":[{"id":"claim-x","subject":"x","value":scalar(1.0),
            "uncertainty":{"kind":"exact"},"evidence_type":"observation","holder":"observer",
            "evidence_cutoff":0.0,"provenance":["test"],"authority":{"source":"observer","weight":1.0}}]
    })
}

fn revision(previous: &Value, previous_hash: &str) -> Value {
    let mut next = previous.clone();
    next["revision"] = json!({"number": previous["revision"]["number"].as_u64().unwrap()+1,
        "previous_model_hash":previous_hash,"reason":"Next model","provenance":["test"]});
    next
}

fn register(session: &mut MachineSession, model: &Value) -> String {
    let operation = if model["revision"]["number"] == 0 {
        "register_model"
    } else {
        "revise_model"
    };
    execute(session, operation, json!({"model":model}))["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .into()
}

fn world(session: &mut MachineSession) -> Value {
    let head = execute(session, "get_world", json!({"world_id":"world"}));
    let model = execute(
        session,
        "get_model",
        json!({"model_hash":head["model_hash"]}),
    );
    let observables: Vec<Value> = model["model"]["processes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|process| {
            process["access_scopes"]
                .as_array()
                .is_none_or(|scopes| scopes.is_empty())
        })
        .map(|process| process["id"].clone())
        .collect();
    execute(
        session,
        "get_world",
        json!({"world_id":"world","view":{"requested_observables":observables}}),
    )
}

fn roll(session: &mut MachineSession, index: u64) -> String {
    execute(
        session,
        "roll_world",
        json!({"world_id":"world","query":{
            "schema":"life-sim-rust-model-query/v1","delta_time":1.0,"step_size":0.25,
            "seed":"revision-test","roll_index":index,"path":{"mode":"full"}
        }}),
    )["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .into()
}

fn advance(session: &mut MachineSession, index: u64) -> Value {
    let hash = roll(session, index);
    execute(session, "commit_candidate", json!({"candidate_hash":hash}));
    world(session)
}

fn revise_request(head: &Value, model_hash: &str, mode: &str, state_values: Value) -> Value {
    let mut observables = vec!["x".to_owned()];
    observables.extend(
        state_values
            .as_object()
            .unwrap()
            .keys()
            .filter(|key| key.as_str() != "x" && key.as_str() != "private")
            .cloned(),
    );
    json!({"world_id":"world","model_hash":model_hash,"view":{"requested_observables":observables},"world_revision":{
        "expected_world_hash":head["world_hash"],"mode":mode,"state_values":state_values,
        "reason":"Explicit authored revision at the current time","provenance":["test"]
    }})
}

fn path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "life-sim-world-revision-{label}-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn graph(session: &mut MachineSession, id: &str, head: &Value) -> String {
    execute(session,"register_narrative_graph",json!({"narrative_graph":{
        "schema":"life-sim-rust-narrative-graph/v1","id":id,
        "revision":{"number":0,"reason":"Frozen source","provenance":["test"]},
        "source":{"kind":"world","world_id":"world","world_hash":head["world_hash"]},
        "roots":["root"],"nodes":[{"id":"root","node_type":"story","role":"document_root",
            "text":id,"epistemic_status":"fictional_canon","evidence_type":"fictional_canon",
            "authority":{"source":"author","weight":1.0},"render":"include","training":"include",
            "provenance":["test"]}],"edges":[]
    }}))["summary"]["graph_hash"].as_str().unwrap().into()
}

#[test]
fn accepted_history_survives_refine_revise_continue_and_reopen() {
    let state_path = path("history");
    let mut session = MachineSession::with_state_file(&state_path).unwrap();
    let original = model();
    let original_hash = register(&mut session, &original);
    execute(
        &mut session,
        "create_world",
        json!({"model_hash":original_hash,"world_id":"world"}),
    );
    let before = advance(&mut session, 0);
    assert_eq!(before["state"]["x"], scalar(2.0));
    let old_graph = graph(&mut session, "before-revision", &before);
    let pending = roll(&mut session, 1);
    let mut added = revision(&original, &original_hash);
    added["processes"]
        .as_array_mut()
        .unwrap()
        .push(process("y", 99.0));
    let added_hash = register(&mut session, &added);
    let refined = execute(
        &mut session,
        "revise_world",
        revise_request(&before, &added_hash, "refine", json!({"y":scalar(7.0)})),
    );
    let receipt_hash = refined["world_revision_hash"].as_str().unwrap().to_owned();
    let refined_head = refined["world_head"].clone();
    assert_eq!(refined_head["time"], before["time"]);
    assert_eq!(refined_head["version"], 2);
    assert_eq!(refined_head["state"]["x"], before["state"]["x"]);
    assert_eq!(refined_head["state"]["y"], scalar(7.0));
    assert_eq!(refined_head["claims"], before["claims"]);
    assert_eq!(refined_head["lineage_head"], receipt_hash);
    assert_eq!(
        refined["world_revision"]["source_head"]["world_hash"],
        before["world_hash"]
    );
    let frozen_receipt = execute(
        &mut session,
        "get_world_revision",
        json!({"world_revision_hash":receipt_hash}),
    );
    let stale = command(
        &mut session,
        "commit_candidate",
        json!({"candidate_hash":pending}),
    );
    assert!(!stale.ok);
    assert_eq!(stale.error.unwrap().code, "conflict");
    let refined_graph = graph(&mut session, "refined", &refined_head);
    drop(session);

    let mut session = MachineSession::with_state_file(&state_path).unwrap();
    assert_eq!(world(&mut session), refined_head);
    let after_refine = advance(&mut session, 2);
    assert_eq!(after_refine["state"]["x"], scalar(3.0));
    assert_eq!(after_refine["state"]["y"], scalar(7.0));
    let mut changed = revision(&added, &added_hash);
    changed["laws"][0]["operator"]["derivative"]["value"] = json!(2.0);
    changed["processes"][0]["initial_value"] = scalar(88.0);
    let changed_hash = register(&mut session, &changed);
    let revised = execute(
        &mut session,
        "revise_world",
        revise_request(
            &after_refine,
            &changed_hash,
            "revise",
            json!({"y":scalar(9.0)}),
        ),
    );
    assert_eq!(revised["world_head"]["state"]["x"], scalar(3.0));
    assert_eq!(revised["world_head"]["claims"], before["claims"]);
    let final_head = advance(&mut session, 3);
    assert_eq!(final_head["state"]["x"], scalar(5.0));
    assert_eq!(final_head["state"]["y"], scalar(9.0));
    assert_eq!(final_head["version"], 5);
    assert_eq!(final_head["time"], 3.0);
    let final_graph = graph(&mut session, "final", &final_head);
    drop(session);

    let mut session = MachineSession::with_state_file(&state_path).unwrap();
    assert_eq!(world(&mut session), final_head);
    assert_eq!(
        execute(
            &mut session,
            "get_world_revision",
            json!({"world_revision_hash":receipt_hash})
        ),
        frozen_receipt
    );
    for (hash, text) in [
        (&old_graph, "before-revision"),
        (&refined_graph, "refined"),
        (&final_graph, "final"),
    ] {
        let rendered = execute(
            &mut session,
            "render_narrative_graph",
            json!({"narrative_graph_hash":hash,"narrative_render":{}}),
        );
        assert!(rendered.to_string().contains(text));
    }
    execute(
        &mut session,
        "export_narrative_training",
        json!({"narrative_graph_hash":old_graph,"narrative_training":{"require_accepted_history":true}}),
    );
    for hash in [&refined_graph, &final_graph] {
        let response = command(
            &mut session,
            "export_narrative_training",
            json!({"narrative_graph_hash":hash,"narrative_training":{"require_accepted_history":true}}),
        );
        assert_eq!(response.error.unwrap().code, "unsupported_history");
        let checkpoint = command(
            &mut session,
            "register_project_checkpoint",
            json!({"project_checkpoint":{
                "schema":"life-sim-rust-project-checkpoint/v1","name":"revised-export",
                "document":{"schema":"life-sim-rust-project-document/v1","content":{"encoding":"utf8","text":"draft"},"media_type":"text/plain"},"narrative_graph_hash":hash,
                "reason":"Export","provenance":["test"]
            }}),
        );
        assert_eq!(checkpoint.error.unwrap().code, "unsupported_history");
    }
    let continued = advance(&mut session, 4);
    assert_eq!(continued["state"]["x"], scalar(7.0));
    drop(session);
    std::fs::remove_file(state_path).unwrap();
}

#[test]
fn invalid_revision_requests_leave_head_and_receipts_unchanged() {
    let mut session = MachineSession::default();
    let original = model();
    let original_hash = register(&mut session, &original);
    execute(
        &mut session,
        "create_world",
        json!({"model_hash":original_hash,"world_id":"world"}),
    );
    let before = advance(&mut session, 0);
    let mut added = revision(&original, &original_hash);
    added["processes"]
        .as_array_mut()
        .unwrap()
        .push(process("y", 99.0));
    let added_hash = register(&mut session, &added);
    let valid = revise_request(&before, &added_hash, "refine", json!({"y":scalar(7.0)}));
    let mut invalid = Vec::new();
    for field in ["mode", "reason", "provenance", "expected_world_hash"] {
        let mut request = valid.clone();
        request["world_revision"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        invalid.push(request);
    }
    for state in [
        json!({}),
        json!({"y":scalar(101.0)}),
        json!({"y":scalar(7.0),"x":scalar(2.0)}),
        json!({"y":scalar(7.0),"unknown":scalar(0.0)}),
    ] {
        let mut request = valid.clone();
        request["world_revision"]["state_values"] = state;
        invalid.push(request);
    }
    let mut stale = valid.clone();
    stale["world_revision"]["expected_world_hash"] = json!("stale");
    assert_eq!(
        command(&mut session, "revise_world", stale)
            .error
            .unwrap()
            .code,
        "conflict"
    );
    for request in invalid {
        assert!(!command(&mut session, "revise_world", request).ok);
        assert_eq!(world(&mut session), before);
    }
    for edit in ["law", "unit", "shape", "deletion", "time_unit"] {
        let mut next = revision(&original, &original_hash);
        match edit {
            "law" => next["laws"][0]["operator"]["derivative"]["value"] = json!(2.0),
            "unit" => next["processes"][0]["unit"] = json!("other-unit"),
            "shape" => next["processes"][0]["value_type"]["bounds"]["maximum"] = json!(200.0),
            "deletion" => {
                next["processes"] = json!([process("replacement", 0.0)]);
                next["laws"] = json!([]);
                next["initial_claims"] = json!([]);
            }
            _ => next["time_unit"] = json!("hour"),
        }
        let hash = register(&mut session, &next);
        let mode = if edit == "law" { "refine" } else { "revise" };
        let response = command(
            &mut session,
            "revise_world",
            revise_request(&before, &hash, mode, json!({})),
        );
        assert!(!response.ok, "{edit} unexpectedly accepted");
        assert_eq!(world(&mut session), before);
    }
    let mut skipped = revision(&added, &added_hash);
    skipped["revision"]["reason"] = json!("Skipped revision");
    let skipped_hash = register(&mut session, &skipped);
    assert!(
        !command(
            &mut session,
            "revise_world",
            revise_request(&before, &skipped_hash, "revise", json!({"y":scalar(7.0)}))
        )
        .ok
    );
    assert_eq!(world(&mut session), before);
    execute(&mut session, "revise_world", valid);
}

#[test]
fn receipts_project_private_state_and_source_only_requests_safely() {
    let mut session = MachineSession::default();
    let mut original = model();
    let mut private = process("private", 42.0);
    private["access_scopes"] = json!(["owner"]);
    original["processes"].as_array_mut().unwrap().push(private);
    let mut private_claim = original["initial_claims"][0].clone();
    private_claim["id"] = json!("private-claim");
    private_claim["subject"] = json!("private");
    private_claim["value"] = scalar(42.0);
    original["initial_claims"]
        .as_array_mut()
        .unwrap()
        .push(private_claim);
    let original_hash = register(&mut session, &original);
    let before = execute(
        &mut session,
        "create_world",
        json!({"model_hash":original_hash,"world_id":"world"}),
    );
    let mut added = revision(&original, &original_hash);
    added["processes"]
        .as_array_mut()
        .unwrap()
        .push(process("new", 99.0));
    let added_hash = register(&mut session, &added);
    let response = execute(
        &mut session,
        "revise_world",
        revise_request(
            &before,
            &added_hash,
            "revise",
            json!({"new":scalar(8.0),"private":scalar(43.0)}),
        ),
    );
    let receipt = &response["world_revision"];
    assert!(receipt["state_values"].get("private").is_none());
    for key in ["source_head", "target_head"] {
        assert!(receipt[key]["state"].get("private").is_none());
        assert!(!receipt[key]["claims"].to_string().contains("private-claim"));
    }
    let hash = response["world_revision_hash"].clone();
    let restricted = execute(
        &mut session,
        "get_world_revision",
        json!({"world_revision_hash":hash,"view":{"requested_observables":["new"]}}),
    );
    assert_eq!(
        restricted["world_revision"]["source_head"]["state"],
        json!({})
    );
    assert_eq!(
        restricted["world_revision"]["target_head"]["state"],
        json!({"new":scalar(8.0)})
    );
    let owner = execute(
        &mut session,
        "get_world_revision",
        json!({"world_revision_hash":hash,"view":{"requested_observables":["private"],"access_scopes":["owner"]}}),
    );
    assert_eq!(
        owner["world_revision"]["source_head"]["state"]["private"],
        scalar(42.0)
    );
    assert_eq!(
        owner["world_revision"]["target_head"]["state"]["private"],
        scalar(43.0)
    );
}

#[test]
fn durable_receipts_reject_tampering_and_stale_writer_does_not_replace_history() {
    let state_path = path("tamper");
    let mut session = MachineSession::with_state_file(&state_path).unwrap();
    let original = model();
    let hash = register(&mut session, &original);
    execute(
        &mut session,
        "create_world",
        json!({"model_hash":hash,"world_id":"world"}),
    );
    let before = advance(&mut session, 0);
    let next = revision(&original, &hash);
    let next_hash = register(&mut session, &next);
    let mut stale = MachineSession::with_state_file(&state_path).unwrap();
    let revised = execute(
        &mut session,
        "revise_world",
        revise_request(&before, &next_hash, "refine", json!({})),
    );
    let stale_response = command(
        &mut stale,
        "revise_world",
        revise_request(&before, &next_hash, "refine", json!({})),
    );
    assert_eq!(stale_response.error.unwrap().code, "persistence_error");
    assert_eq!(world(&mut stale), revised["world_head"]);
    drop(stale);
    drop(session);
    let connection = Connection::open(&state_path).unwrap();
    let bytes: Vec<u8> = connection
        .query_row("SELECT revision_json FROM world_revisions", [], |row| {
            row.get(0)
        })
        .unwrap();
    let mut receipt: Value = serde_json::from_slice(&bytes).unwrap();
    receipt["source_head"]["state"]["x"] = scalar(50.0);
    connection
        .execute(
            "UPDATE world_revisions SET revision_json=?1",
            params![serde_json::to_vec(&receipt).unwrap()],
        )
        .unwrap();
    drop(connection);
    assert!(MachineSession::with_state_file(&state_path).is_err());
    std::fs::remove_file(state_path).unwrap();
}

#[test]
fn refinement_can_complete_a_partial_contract_without_rewriting_existing_detail() {
    let mut session = MachineSession::default();
    let mut original = model();
    let event = |id: &str, start: f64, end: f64| json!({"id":id,"boundary":id,"interval":{"start":start,"end":end},"provenance":["test"]});
    let cut = |id: &str, event: &str| {
        json!({"id":id,"parent_event_id":event,"question":"Allocation?","unit":"allocation",
        "answers":[{"key":"known","weight":0.5},{"key":"remainder","weight":0.5}],"provenance":["test"]})
    };
    let relation = |id: &str, child: &str| json!({"id":id,"source_event_id":"whole","target_event_id":child,"kind":"contains","provenance":["test"]});
    original["meaning_model"] = json!({"schema":"life-sim-rust-meaning-model/v1",
        "events":[event("whole",0.0,2.0),event("first",0.0,1.0)],
        "event_relations":[relation("whole-first","first")],
        "context_roots":[{"event_id":"whole","kind":"accepted_world","provenance":["test"]}],
        "normalized_cuts":[cut("coarse","whole"),cut("first-cut","first")],
        "temporal_cut_recompositions":[{"parent_cut_id":"coarse","coverage":"partial",
            "children":[{"cut_id":"first-cut","projection":{"kind":"identity"}}],"provenance":["test"]}]
    });
    let original_hash = register(&mut session, &original);
    execute(
        &mut session,
        "create_world",
        json!({"model_hash":original_hash,"world_id":"world"}),
    );
    let before = advance(&mut session, 0);
    let mut completed = revision(&original, &original_hash);
    completed["meaning_model"]["events"]
        .as_array_mut()
        .unwrap()
        .push(event("second", 1.0, 2.0));
    completed["meaning_model"]["event_relations"]
        .as_array_mut()
        .unwrap()
        .push(relation("whole-second", "second"));
    completed["meaning_model"]["normalized_cuts"]
        .as_array_mut()
        .unwrap()
        .push(cut("second-cut", "second"));
    completed["meaning_model"]["temporal_cut_recompositions"][0]["coverage"] = json!("complete");
    completed["meaning_model"]["temporal_cut_recompositions"][0]["children"]
        .as_array_mut()
        .unwrap()
        .push(json!({"cut_id":"second-cut","projection":{"kind":"identity"}}));
    for edit in ["projection", "provenance", "cut"] {
        let mut invalid = completed.clone();
        match edit {
            "projection" => {
                invalid["meaning_model"]["temporal_cut_recompositions"][0]["children"][0]
                    ["projection"] =
                    json!({"kind":"answer_map","answers":{"known":"known","remainder":"remainder"}})
            }
            "provenance" => {
                invalid["meaning_model"]["temporal_cut_recompositions"][0]["provenance"] =
                    json!(["changed"])
            }
            _ => invalid["meaning_model"]["normalized_cuts"][0]["provenance"] = json!(["changed"]),
        }
        let hash = register(&mut session, &invalid);
        let failed = command(
            &mut session,
            "revise_world",
            revise_request(&before, &hash, "refine", json!({})),
        );
        assert!(!failed.ok, "{edit} unexpectedly accepted");
        assert_eq!(world(&mut session), before);
    }
    let complete_hash = register(&mut session, &completed);
    let refined = execute(
        &mut session,
        "revise_world",
        revise_request(&before, &complete_hash, "refine", json!({})),
    );
    assert_eq!(refined["world_head"]["state"], before["state"]);
    assert_eq!(refined["world_head"]["claims"], before["claims"]);
    let mut weakened = revision(&completed, &complete_hash);
    weakened["meaning_model"]["temporal_cut_recompositions"][0]["coverage"] = json!("partial");
    let weak_hash = register(&mut session, &weakened);
    assert!(
        !command(
            &mut session,
            "revise_world",
            revise_request(&refined["world_head"], &weak_hash, "refine", json!({}))
        )
        .ok
    );
}
