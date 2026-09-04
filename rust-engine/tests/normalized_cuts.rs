use life_sim_engine::{compile_model, MachineSession, ModelDefinition};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

fn event(id: &str, start: f64, end: f64) -> Value {
    json!({
        "id": id, "boundary": id, "interval": {"start": start, "end": end},
        "process_ids": [], "provenance": ["normalized Cut fixture"]
    })
}

fn relation(id: &str, parent: &str, child: &str, kind: &str) -> Value {
    json!({
        "id": id, "source_event_id": parent, "target_event_id": child,
        "kind": kind, "description": if kind == "other" { "about" } else { kind },
        "provenance": ["normalized Cut fixture"]
    })
}

fn model() -> Value {
    let mut model: Value =
        serde_json::from_str::<Value>(include_str!("../examples/meaning-model-command.json"))
            .unwrap()["model"]
            .clone();
    model["id"] = json!("normalized-cut-fixture");
    model["meaning_model"] = json!({
        "schema": "life-sim-rust-meaning-model/v1",
        "events": [
            event("history", 0.0, 10.0), event("life", 1.0, 9.0),
            event("inner", 1.0, 9.0), event("assessment", 2.0, 3.0),
            event("public", 2.0, 3.0)
        ],
        "event_relations": [
            relation("history-life", "history", "life", "contains"),
            relation("life-inner", "life", "inner", "contains"),
            relation("inner-assessment", "inner", "assessment", "contains"),
            relation("history-public", "history", "public", "contains"),
            relation("public-causes-assessment", "public", "assessment", "causes"),
            relation("assessment-about-public", "assessment", "public", "other")
        ],
        "context_roots": [
            {"event_id":"history", "kind":"accepted_world", "provenance":["fixture"]},
            {"event_id":"inner", "kind":"inner", "provenance":["fixture"]}
        ],
        "normalized_cuts": [
            {"id":"outlook", "parent_event_id":"assessment",
             "question":"How does this comparison unit divide?", "unit":"comparison",
             "answers":[{"key":"matches","weight":0.6},{"key":"unmatched","weight":0.3},
                        {"key":"remainder","weight":0.1},{"key":"zero","weight":0.0}],
             "provenance":["fixture"]},
            {"id":"detail", "parent_event_id":"assessment",
             "question":"Which part of matched comparison is opened?", "unit":"matched comparison",
             "answers":[{"key":"part","weight":0.8},{"key":"remainder","weight":0.2}],
             "conditioning":{"cut_id":"outlook","answer_key":"matches"},
             "provenance":["fixture"]},
            {"id":"unopened", "parent_event_id":"public",
             "question":"What remains to be opened?", "unit":"allocation",
             "answers":[{"key":"remainder","weight":1.0}], "provenance":["fixture"]}
        ]
    });
    model["meaning_model"]["events"][3]["description"] =
        json!("Detailed event description. ".repeat(100));
    model
}

fn compile(value: Value) -> life_sim_engine::EngineResult<life_sim_engine::CompiledModel> {
    compile_model(serde_json::from_value(value).unwrap())
}

fn execute(session: &mut MachineSession, operation: &str, fields: Value) -> Value {
    let mut command = fields;
    command["schema"] = json!("life-sim-rust-command/v1");
    command["operation"] = json!(operation);
    let response = session.parse_and_execute(&command.to_string());
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
}

#[test]
fn normalized_cuts_accept_static_events_and_stop_at_nearest_roots() {
    // Both inner and accepted-world paths exist, but the inner declaration
    // stops ancestry. The cross-context causal/about links carry no authority.
    let compiled = compile(model()).unwrap();
    let summary = compiled.summary().meaning_model.unwrap();
    assert_eq!(summary.normalized_cut_count, 3);
    assert_eq!(summary.context_root_count, 2);
    assert_eq!(
        summary.normalized_cut_ids,
        ["detail", "outlook", "unopened"]
    );
    assert!(compiled
        .definition()
        .meaning_model
        .as_ref()
        .unwrap()
        .events
        .iter()
        .all(|event| event.process_ids.is_empty()));

    // Zero-weight components remain addressable, including the remainder.
    for key in ["zero", "remainder"] {
        let mut candidate = model();
        candidate["meaning_model"]["normalized_cuts"][1]["conditioning"]["answer_key"] = json!(key);
        compile(candidate).unwrap();
    }
}

#[test]
fn normalized_cuts_reject_invalid_accounting_and_component_addresses() {
    let variants: &[(&str, fn(&mut Value))] = &[
        ("unknown parent event", |m| {
            m["meaning_model"]["normalized_cuts"][0]["parent_event_id"] = json!("missing")
        }),
        ("duplicate normalized cut id", |m| {
            m["meaning_model"]["normalized_cuts"][1]["id"] = json!("outlook")
        }),
        ("nonnegative", |m| {
            m["meaning_model"]["normalized_cuts"][0]["answers"][0]["weight"] = json!(-0.1)
        }),
        ("sum to one", |m| {
            m["meaning_model"]["normalized_cuts"][0]["answers"][0]["weight"] = json!(0.7)
        }),
        ("explicit remainder", |m| {
            m["meaning_model"]["normalized_cuts"][0]["answers"][2]["key"] = json!("other")
        }),
        ("duplicate answer key", |m| {
            m["meaning_model"]["normalized_cuts"][0]["answers"][1]["key"] = json!("matches")
        }),
        ("unknown cut", |m| {
            m["meaning_model"]["normalized_cuts"][1]["conditioning"]["cut_id"] = json!("missing")
        }),
        ("unknown answer", |m| {
            m["meaning_model"]["normalized_cuts"][1]["conditioning"]["answer_key"] =
                json!("missing")
        }),
        ("acyclic", |m| {
            m["meaning_model"]["normalized_cuts"][0]["conditioning"] =
                json!({"cut_id":"detail","answer_key":"part"})
        }),
        ("crosses context roots", |m| {
            m["meaning_model"]["normalized_cuts"][1]["parent_event_id"] = json!("public")
        }),
        ("question must be nonempty", |m| {
            m["meaning_model"]["normalized_cuts"][0]["question"] = json!(" ")
        }),
        ("requires nonempty provenance", |m| {
            m["meaning_model"]["normalized_cuts"][0]["provenance"] = json!([])
        }),
    ];
    for (expected, mutate) in variants {
        let mut candidate = model();
        mutate(&mut candidate);
        let failure = compile(candidate).unwrap_err().to_string();
        assert!(failure.contains(expected), "expected {expected}: {failure}");
    }
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut candidate: ModelDefinition = serde_json::from_value(model()).unwrap();
        candidate.meaning_model.as_mut().unwrap().normalized_cuts[0].answers[0].weight = invalid;
        assert!(compile_model(candidate)
            .unwrap_err()
            .to_string()
            .contains("must be finite"));
    }
}

#[test]
fn context_roots_reject_unrooted_ambiguous_cyclic_and_escaping_ancestry() {
    let variants: &[(&str, fn(&mut Value))] = &[
        ("unknown event", |m| {
            m["meaning_model"]["context_roots"][0]["event_id"] = json!("missing")
        }),
        ("duplicate context root", |m| {
            m["meaning_model"]["context_roots"][1]["event_id"] = json!("history")
        }),
        ("without a declared context root", |m| {
            m["meaning_model"]["event_relations"][2]["kind"] = json!("other");
            m["meaning_model"]["event_relations"][2]["description"] = json!("about");
        }),
        ("conflicting nearest context roots", |m| {
            m["meaning_model"]["event_relations"]
                .as_array_mut()
                .unwrap()
                .push(relation("ambiguous", "history", "assessment", "contains"));
        }),
        ("acyclic", |m| {
            for event in m["meaning_model"]["events"].as_array_mut().unwrap() {
                event["interval"] = Value::Null;
            }
            m["meaning_model"]["event_relations"]
                .as_array_mut()
                .unwrap()
                .push(relation("cycle", "assessment", "history", "contains"));
        }),
        ("child interval exceeds", |m| {
            m["meaning_model"]["events"][3]["interval"]["end"] = json!(9.5)
        }),
    ];
    for (expected, mutate) in variants {
        let mut candidate = model();
        mutate(&mut candidate);
        let failure = compile(candidate).unwrap_err().to_string();
        assert!(failure.contains(expected), "expected {expected}: {failure}");
    }
}

#[test]
fn normalized_cuts_hash_canonically_without_changing_legacy_models() {
    let original = compile(model()).unwrap();
    let mut reordered = model();
    for key in [
        "events",
        "event_relations",
        "normalized_cuts",
        "context_roots",
    ] {
        reordered["meaning_model"][key]
            .as_array_mut()
            .unwrap()
            .reverse();
    }
    for cut in reordered["meaning_model"]["normalized_cuts"]
        .as_array_mut()
        .unwrap()
    {
        cut["answers"].as_array_mut().unwrap().reverse();
    }
    assert_eq!(compile(reordered).unwrap().model_hash, original.model_hash);

    let mut legacy: Value =
        serde_json::from_str::<Value>(include_str!("../examples/meaning-model-command.json"))
            .unwrap()["model"]
            .clone();
    legacy["meaning_model"]["normalized_cuts"] = json!([]);
    legacy["meaning_model"]["context_roots"] = json!([]);
    let compiled = compile(legacy).unwrap();
    assert_eq!(
        compiled.model_hash,
        "e4205b620a12e5f51c1fa92b4fc4fe06607ebda68cc52f304ba78e94a1c4d7e7"
    );
    let encoded = serde_json::to_value(compiled.definition()).unwrap();
    assert!(encoded["meaning_model"].get("normalized_cuts").is_none());
    assert!(encoded["meaning_model"].get("context_roots").is_none());
    assert!(encoded["meaning_model"]["events"][0]
        .get("description")
        .is_none());
}

#[test]
fn semantic_event_description_is_bounded_and_distinct_from_boundary() {
    let compiled = compile(model()).unwrap();
    let assessment = compiled
        .definition()
        .meaning_model
        .as_ref()
        .unwrap()
        .events
        .iter()
        .find(|event| event.id == "assessment")
        .unwrap();
    assert!(assessment.description.as_ref().unwrap().len() > 1024);
    assert_eq!(assessment.boundary, "assessment");
    for text in [
        " ".to_owned(),
        "x".repeat(life_sim_engine::MAX_MEANING_EVENT_DESCRIPTION_BYTES + 1),
    ] {
        let mut candidate = model();
        candidate["meaning_model"]["events"][3]["description"] = json!(text);
        assert!(compile(candidate)
            .unwrap_err()
            .to_string()
            .contains("description must be nonempty and at most"));
    }
}

#[test]
fn normalized_canonical_event_supports_unweighted_define_realization() {
    let mut candidate = model();
    candidate["meaning_model"]["concepts"] = json!([
        {"id":"concept.claim", "provenance":["fixture"]}
    ]);
    candidate["meaning_model"]["realizations"] = json!([
        {"id":"define.claim", "concept_id":"concept.claim", "purpose":"define",
         "roles":{"canonical_model":"assessment"}, "degree":1.0,
         "viewpoint":"fixture constructor", "provenance":["fixture"]}
    ]);
    compile(candidate.clone()).unwrap();
    for variant in ["noncanonical role", "graded degree", "missing cut"] {
        let mut invalid = candidate.clone();
        match variant {
            "noncanonical role" => {
                invalid["meaning_model"]["realizations"][0]["roles"]["canonical_model"] =
                    json!("life")
            }
            "graded degree" => invalid["meaning_model"]["realizations"][0]["degree"] = json!(0.5),
            _ => invalid["meaning_model"]["normalized_cuts"] = json!([]),
        }
        let failure = compile(invalid).unwrap_err().to_string();
        assert!(
            failure.contains("requires an abstract_cut_id or"),
            "{variant}: {failure}"
        );
    }
}

#[test]
fn normalized_cuts_and_roots_survive_native_revision_and_durable_restart() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "life-sim-normalized-cuts-{}-{nonce}.sqlite",
        std::process::id()
    ));
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let registered = execute(&mut session, "register_model", json!({"model": model()}));
    let first_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut revision = model();
    revision["revision"]["number"] = json!(1);
    revision["revision"]["previous_model_hash"] = json!(first_hash);
    revision["revision"]["reason"] = json!("Explicitly revise the authored allocation.");
    revision["meaning_model"]["normalized_cuts"][0]["answers"][0]["weight"] = json!(0.5);
    revision["meaning_model"]["normalized_cuts"][0]["answers"][1]["weight"] = json!(0.4);
    let revised = execute(&mut session, "revise_model", json!({"model": revision}));
    let second_hash = revised["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(first_hash, second_hash);
    drop(session);

    let mut restored = MachineSession::with_state_file(&path).unwrap();
    for (hash, expected) in [(first_hash, registered), (second_hash, revised)] {
        let fetched = execute(&mut restored, "get_model", json!({"model_hash": hash}));
        assert_eq!(fetched["model"], expected["model"]);
        assert_eq!(fetched["summary"]["model_hash"], hash);
        assert_eq!(
            fetched["summary"]["meaning_model"]["normalized_cut_count"],
            3
        );
        assert_eq!(fetched["summary"]["meaning_model"]["context_root_count"], 2);
    }
    drop(restored);
    std::fs::remove_file(path).unwrap();
}
