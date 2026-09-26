use life_sim_engine::{
    EventRelationDefinition, EventRelationKind, MachineSession, MeaningEventDefinition,
};

#[test]
fn semantic_event_has_a_non_shadowed_public_rust_type() {
    let event: MeaningEventDefinition = serde_json::from_value(serde_json::json!({
        "id": "event.public-type",
        "boundary": "one semantic event",
        "process_ids": ["process.example"],
        "provenance": ["type visibility test"]
    }))
    .unwrap();
    assert_eq!(event.id, "event.public-type");

    let relation: EventRelationDefinition = serde_json::from_value(serde_json::json!({
        "id": "event-relation.public-type",
        "source_event_id": "event.cause",
        "target_event_id": "event.effect",
        "kind": "causes",
        "uncertainty": {"kind": "unknown"},
        "provenance": ["type visibility test"]
    }))
    .unwrap();
    assert_eq!(relation.kind, EventRelationKind::Causes);
}

#[test]
fn optional_meaning_model_example_validates_as_static_model_data() {
    let mut session = MachineSession::default();
    let response =
        session.parse_and_execute(include_str!("../examples/meaning-model-command.json"));
    assert!(
        response.ok,
        "example validation failed: {}",
        response
            .error
            .as_ref()
            .map(|error| error.message.as_str())
            .unwrap_or("missing error detail")
    );

    let result = response.result.expect("validation result");
    assert_eq!(
        result["summary"]["model_hash"],
        "e4205b620a12e5f51c1fa92b4fc4fe06607ebda68cc52f304ba78e94a1c4d7e7",
        "an absent event_relations collection must preserve the pre-extension model hash"
    );
    let summary = &result["summary"]["meaning_model"];
    assert_eq!(summary["schema"], "life-sim-rust-meaning-model/v1");
    assert_eq!(summary["concept_count"], 3);
    assert_eq!(summary["abstract_cut_count"], 1);
    assert_eq!(summary["referent_count"], 3);
    assert_eq!(summary["encapsulation_cut_count"], 1);
    assert_eq!(summary["event_count"], 3);
    assert_eq!(summary["event_relation_count"], 0);
    assert_eq!(summary["event_referent_binding_count"], 3);
    assert_eq!(summary["physical_cut_count"], 1);
    assert_eq!(summary["realization_count"], 2);

    let normalized = &result["model"]["meaning_model"];
    assert!(normalized.get("event_relations").is_none());
    assert!(normalized.get("semantic_coverage").is_none());
    assert!(summary.get("semantic_coverage").is_none());
    assert_eq!(normalized["physical_cuts"][0]["kind"], "sequential");
    assert_eq!(
        normalized["physical_cuts"][0]["child_event_ids"],
        serde_json::json!(["event.care-phase", "event.trust-phase"])
    );
    assert_eq!(
        normalized["encapsulation_cuts"][0]["children"][0]["referent_id"],
        "referent.alice"
    );
    assert_eq!(
        normalized["event_referent_bindings"][0]["id"],
        "binding.relationship-alice"
    );
    assert_eq!(
        normalized["event_referent_bindings"][2]["target"],
        serde_json::json!({
            "kind": "process",
            "process_id": "relationship.strength"
        })
    );
    assert_eq!(
        normalized["realizations"][0]["referent_roles"]["person_a"],
        "referent.alice"
    );

    let mut explicit_empty: serde_json::Value =
        serde_json::from_str(include_str!("../examples/meaning-model-command.json")).unwrap();
    explicit_empty["request_id"] = serde_json::json!("meaning-model-explicit-empty-relations");
    explicit_empty["model"]["meaning_model"]["event_relations"] = serde_json::json!([]);
    let explicit_response = MachineSession::default()
        .parse_and_execute(&serde_json::to_string(&explicit_empty).unwrap());
    assert!(explicit_response.ok);
    let explicit_result = explicit_response.result.unwrap();
    assert_eq!(
        explicit_result["summary"]["model_hash"],
        "e4205b620a12e5f51c1fa92b4fc4fe06607ebda68cc52f304ba78e94a1c4d7e7"
    );
    assert!(explicit_result["model"]["meaning_model"]
        .get("event_relations")
        .is_none());
}

// Withdrawal keeps a record as history and removes it from the current account (review of 26 September 2026).
fn validate(meaning_model: serde_json::Value) -> life_sim_engine::ResponseEnvelope {
    let mut command: serde_json::Value =
        serde_json::from_str(include_str!("../examples/meaning-model-command.json")).unwrap();
    command.as_object_mut().unwrap().remove("request_id");
    command["model"]["meaning_model"] = meaning_model;
    MachineSession::default().parse_and_execute(&command.to_string())
}

fn abstract_cut(id: &str, parent: &str, children: &[&str]) -> serde_json::Value {
    serde_json::json!({"id": id, "parent_concept_id": parent, "child_concept_ids": children, "lens": "fixture", "provenance": ["fixture"]})
}

#[test]
fn a_withdrawn_decomposition_does_not_stop_its_replacement_from_reversing_it() {
    let concepts: Vec<serde_json::Value> = ["a", "b", "c"].iter().map(|id| serde_json::json!({"id": id, "provenance": ["fixture"]})).collect();
    let mut old = abstract_cut("old", "a", &["b", "c"]);
    assert!(validate(serde_json::json!({"schema": "life-sim-rust-meaning-model/v1", "concepts": concepts, "abstract_cuts": [old]})).ok);
    old["withdrawn"] = serde_json::json!({"reason": "The relationship was backward", "superseded_by": ["new"]});
    let replaced = validate(serde_json::json!({"schema": "life-sim-rust-meaning-model/v1", "concepts": concepts,
        "abstract_cuts": [old, abstract_cut("new", "b", &["a", "c"])]}));
    assert!(replaced.ok, "replacement after withdrawal was refused: {:?}", replaced.error.map(|error| error.message));
    // Two current cuts that reverse each other are still a cycle.
    let both = validate(serde_json::json!({"schema": "life-sim-rust-meaning-model/v1", "concepts": concepts,
        "abstract_cuts": [abstract_cut("old", "a", &["b", "c"]), abstract_cut("new", "b", &["a", "c"])]}));
    assert!(!both.ok);
}

#[test]
fn a_withdrawn_concept_no_longer_covers_its_events() {
    let layer = |withdrawn: bool| {
        let mut concept = serde_json::json!({"id": "a", "provenance": ["fixture"]});
        if withdrawn { concept["withdrawn"] = serde_json::json!({"reason": "No longer an account of this Event"}); }
        serde_json::json!({"schema": "life-sim-rust-meaning-model/v1", "concepts": [concept],
            "events": [{"id": "e", "boundary": "event", "process_ids": [], "provenance": ["fixture"]}],
            "realizations": [{"id": "r", "concept_id": "a", "purpose": "describe", "roles": {"subject": "e"}, "degree": 1, "provenance": ["fixture"], "viewpoint": "fixture"}],
            "semantic_coverage": {"mode": "strict"}})
    };
    assert!(validate(layer(false)).ok);
    let after = validate(layer(true));
    assert!(!after.ok);
    assert!(after.error.unwrap().message.contains("strict mode found 1 orphaned events: e"));
}

#[test]
fn an_about_relation_refers_without_causing() {
    let layer = |extra: serde_json::Value| {
        let mut relation = serde_json::json!({"id": "reading.about", "source_event_id": "reading", "target_event_id": "act", "kind": "about", "uncertainty": {"kind": "unknown"}, "provenance": ["fixture"]});
        if let Some(object) = extra.as_object() { for (key, value) in object { relation[key] = value.clone(); } }
        serde_json::json!({"schema": "life-sim-rust-meaning-model/v1",
            "events": [{"id": "act", "boundary": "an act", "process_ids": [], "provenance": ["fixture"]}, {"id": "reading", "boundary": "a reading of the act", "process_ids": [], "provenance": ["fixture"]}],
            "event_relations": [relation]})
    };
    let plain = validate(layer(serde_json::json!({})));
    assert!(plain.ok, "an about relation was refused: {:?}", plain.error.map(|error| error.message));
    assert!(!validate(layer(serde_json::json!({"forecast_answer": {"cut_id": "c", "answer_key": "a"}}))).ok);
}
