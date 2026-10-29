//! The model's tests: compiling and revising models, rolling and replaying candidates, randomness, trajectories,
//! views, factor graphs and access scopes. Most drive a session through its JSON commands, as a caller would; the
//! session's own durability and storage are tested beside it (session/tests.rs).

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};

use super::revision::*;
use super::*;
use crate::limits::*;
use crate::test_support::*;
use crate::{MachineSession, PathSpec, ResponseEnvelope};

fn decomposition_kinds() -> [(&'static str, DecompositionKind); 7] {
    [
        ("contains", DecompositionKind::Contains),
        ("physical_part", DecompositionKind::PhysicalPart),
        ("membership_view", DecompositionKind::MembershipView),
        ("semantic_subtype", DecompositionKind::SemanticSubtype),
        ("temporal_phase", DecompositionKind::TemporalPhase),
        (
            "functional_refinement",
            DecompositionKind::FunctionalRefinement,
        ),
        (
            "observational_partition",
            DecompositionKind::ObservationalPartition,
        ),
    ]
}

#[test]
fn value_series_hold_numbers_and_states_at_any_time() {
    let mut model = test_model();
    model.value_series = vec![
        ValueSeries {
            id: "values.person.stress.modeler".to_owned(),
            process_id: "person.stress".to_owned(),
            holder: "modeler".to_owned(),
            reason: None,
            points: vec![
                ValuePoint {
                    time: -30.0,
                    value: Some(0.1),
                    state: None,
                    lower: Some(0.0),
                    upper: Some(0.2),
                    tag: "sketch".to_owned(),
                    note: None,
                },
                ValuePoint {
                    time: 40.0,
                    value: Some(0.6),
                    state: None,
                    lower: None,
                    upper: None,
                    tag: "inferred".to_owned(),
                    note: None,
                },
            ],
            provenance: vec![],
        },
        ValueSeries {
            id: "values.person.regime.modeler".to_owned(),
            process_id: "person.regime".to_owned(),
            holder: "modeler".to_owned(),
            reason: Some("a first guess".to_owned()),
            points: vec![ValuePoint {
                time: 5.0,
                value: None,
                state: Some("alert".to_owned()),
                lower: None,
                upper: None,
                tag: "exploring".to_owned(),
                note: Some("after the letter".to_owned()),
            }],
            provenance: vec![],
        },
    ];
    let compiled = compile_model(model).expect("value series compile");
    assert_eq!(compiled.definition().value_series.len(), 2);
}

#[test]
fn value_series_refuse_what_their_process_cannot_hold() {
    let point = |time: f64, value: Option<f64>, state: Option<&str>, tag: &str| ValuePoint {
        time,
        value,
        state: state.map(str::to_owned),
        lower: None,
        upper: None,
        tag: tag.to_owned(),
        note: None,
    };
    let series = |process: &str, points: Vec<ValuePoint>| ValueSeries {
        id: format!("values.{process}"),
        process_id: process.to_owned(),
        holder: "modeler".to_owned(),
        reason: None,
        points,
        provenance: vec![],
    };
    for (bad, why) in [
        (
            series(
                "person.regime",
                vec![point(1.0, None, Some("asleep"), "sketch")],
            ),
            "not one of",
        ),
        (
            series("person.regime", vec![point(1.0, Some(1.0), None, "sketch")]),
            "needs a state",
        ),
        (
            series(
                "person.stress",
                vec![point(1.0, None, Some("calm"), "sketch")],
            ),
            "needs a value",
        ),
        (
            series(
                "person.stress",
                vec![
                    point(2.0, Some(0.1), None, "sketch"),
                    point(1.0, Some(0.2), None, "sketch"),
                ],
            ),
            "must increase",
        ),
        (
            series("person.stress", vec![point(1.0, Some(0.1), None, "guess")]),
            "tag",
        ),
        (
            series(
                "person.stress",
                vec![point(1.0, Some(50.0), None, "sketch")],
            ),
            "bounds",
        ),
        (
            series("nobody", vec![point(1.0, Some(0.1), None, "sketch")]),
            "unknown process",
        ),
        (
            series(
                "person.stress",
                vec![ValuePoint {
                    lower: Some(0.05),
                    ..point(1.0, Some(0.1), None, "sketch")
                }],
            ),
            "both lower and upper",
        ),
    ] {
        let mut model = test_model();
        model.value_series = vec![bad];
        let message = compile_model(model).expect_err("refused").0;
        assert!(message.contains(why), "{message}");
    }
    // A holder and provenance are bounded like every other record's text.
    let mut long_holder = test_model();
    long_holder.value_series = vec![ValueSeries {
        holder: "h".repeat(2_000),
        ..series("person.stress", vec![point(1.0, Some(0.1), None, "sketch")])
    }];
    assert!(compile_model(long_holder)
        .expect_err("refused")
        .0
        .contains("holder of at most"));
    let mut blank_provenance = test_model();
    blank_provenance.value_series = vec![ValueSeries {
        provenance: vec![" ".to_owned()],
        ..series("person.stress", vec![point(1.0, Some(0.1), None, "sketch")])
    }];
    assert!(compile_model(blank_provenance)
        .expect_err("refused")
        .0
        .contains("provenance entries"));
    // Two series for one process and holder would split one account in two, whatever their ids.
    let mut model = test_model();
    let other = ValueSeries {
        id: "values.other".to_owned(),
        ..series("person.stress", vec![point(2.0, Some(0.3), None, "sketch")])
    };
    model.value_series = vec![
        series("person.stress", vec![point(1.0, Some(0.1), None, "sketch")]),
        other,
    ];
    let message = compile_model(model).expect_err("refused").0;
    assert!(
        message.contains("one series per process and holder"),
        "{message}"
    );
}

#[test]
fn a_model_without_value_series_keeps_its_serialization() {
    let json = serde_json::to_string(&test_model()).unwrap();
    assert!(!json.contains("value_series"));
}

fn turning_trajectory_model() -> ModelDefinition {
    ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "turning-trajectory".to_owned(),
        time_unit: "second".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "interior-extremum trajectory fixture".to_owned(),
            provenance: vec!["trajectory-summary-test".to_owned()],
        },
        processes: vec![
            trajectory_process("position", 0.0, "meter", ClaimUncertainty::Exact),
            trajectory_process("velocity", 1.0, "meter/second", ClaimUncertainty::Exact),
        ],
        decomposition: vec![],
        dependencies: vec![DependencyEdge {
            id: "velocity-drives-position".to_owned(),
            source: "velocity".to_owned(),
            target: "position".to_owned(),
            kind: DependencyKind::Causes,
            law_id: Some("position-motion".to_owned()),
        }],
        laws: vec![
            LawDefinition {
                id: "position-motion".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "position".to_owned(),
                    derivative: process("velocity"),
                    innovation: None,
                },
                provenance: vec!["dx/dt=v".to_owned()],
            },
            LawDefinition {
                id: "velocity-motion".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "velocity".to_owned(),
                    derivative: constant(-2.0),
                    innovation: None,
                },
                provenance: vec!["dv/dt=-2".to_owned()],
            },
        ],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    }
}

#[test]
fn query_graph_values_are_source_bound_and_scopes_filter_structure() {
    let mut model = test_model();
    model
        .processes
        .iter_mut()
        .find(|process| process.id == "person.stress")
        .unwrap()
        .access_scopes = vec!["private:stress".to_owned()];
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": model}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let unscoped = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "model_hash": model_hash,
            "graph_query": {"mode": "full", "include_values": true}
        }),
    )));
    assert!(!unscoped["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|node| { node["id"] == "process:person.stress" || node["id"] == "law:derive-error" }));
    let scoped = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "model_hash": model_hash,
            "graph_query": {
                "mode": "full",
                "include_values": true,
                "access_scopes": ["private:stress"]
            }
        }),
    )));
    assert_eq!(unscoped["snapshot_hash"], scoped["snapshot_hash"]);
    let stress = scoped["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "process:person.stress")
        .unwrap();
    assert_eq!(
        stress["value"],
        serde_json::json!({"kind": "scalar", "value": 0.2})
    );
    assert_eq!(stress["value_source"], "model_initial_value");

    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "graph-world"}),
    )));
    let world = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "world_id": "graph-world",
            "graph_query": {
                "mode": "full",
                "include_values": true,
                "access_scopes": ["private:stress"]
            }
        }),
    )));
    assert_eq!(world["source"]["kind"], "world");
    assert!(world["nodes"].as_array().unwrap().iter().any(|node| {
        node["id"] == "process:person.stress" && node["value_source"] == "accepted_world_state"
    }));
    let mut candidate_query = query(0, PathSpec::Endpoint);
    candidate_query.access_scopes = vec!["private:stress".to_owned()];
    let candidate = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "graph-world", "query": candidate_query}),
    )));
    let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
    let candidate_graph = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "candidate_hash": candidate_hash,
            "graph_query": {
                "mode": "full",
                "include_values": true,
                "access_scopes": ["private:stress"]
            }
        }),
    )));
    assert_eq!(candidate_graph["source"]["kind"], "candidate");
    assert_eq!(candidate_graph["source"]["candidate_status"], "pending");
    assert!(candidate_graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|node| {
            node["id"] == "process:person.stress"
                && node["value_source"] == "candidate_successor_state"
        }));
    let occurrence = candidate_graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "law:pressure-gate")
        .unwrap();
    assert_eq!(occurrence["occurrence_mark_count"], 4);
    assert_eq!(occurrence["occurrence_marks_truncated"], false);
    assert_eq!(occurrence["occurrence_marks"].as_array().unwrap().len(), 4);
    assert!(occurrence["occurrence_marks"]
        .as_array()
        .unwrap()
        .iter()
        .all(|mark| mark["source"] == "pressure-gate"));
}

fn refusal(response: ResponseEnvelope) -> (&'static str, String) {
    assert!(!response.ok, "{:?}", response.result);
    let error = response.error.unwrap();
    (error.code, error.message)
}

#[test]
fn every_read_shows_a_scoped_process_to_a_caller_holding_any_one_of_its_scopes() {
    let mut model = test_model();
    model
        .processes
        .iter_mut()
        .find(|process| process.id == "person.stress")
        .unwrap()
        .access_scopes = vec!["scope:b".to_owned(), "scope:a".to_owned()];
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": model}),
    )));
    let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
    result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "scoped-world"}),
    )));
    // Held scopes in any order, among others the process does not name, are enough; a scope the process does not
    // name is not.
    let holding = serde_json::json!(["scope:z", "scope:a"]);
    let lacking = serde_json::json!(["scope:c"]);

    let graph_shows_stress = |session: &mut MachineSession, scopes: &serde_json::Value| {
        let graph = result(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {"mode": "full", "access_scopes": scopes}
            }),
        )));
        graph["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["id"] == "process:person.stress")
    };
    assert!(graph_shows_stress(&mut session, &holding));
    assert!(!graph_shows_stress(&mut session, &lacking));

    let view = |scopes: &serde_json::Value| {
        command(
            "query_view",
            serde_json::json!({
                "world_id": "scoped-world",
                "view": {"requested_observables": ["person.stress"], "access_scopes": scopes}
            }),
        )
    };
    let shown = result(session.parse_and_execute(&view(&holding)));
    assert_eq!(
        shown["state"]["person.stress"],
        serde_json::json!({"kind": "scalar", "value": 0.2})
    );
    assert_eq!(
        refusal(session.parse_and_execute(&view(&lacking))),
        (
            "invalid_request",
            "view lacks an access scope for observable person.stress".to_owned()
        )
    );

    let roll = |scopes: &serde_json::Value| {
        let mut rolled = serde_json::to_value(query(0, PathSpec::Endpoint)).unwrap();
        rolled["access_scopes"] = scopes.clone();
        command(
            "roll_world",
            serde_json::json!({"world_id": "scoped-world", "query": rolled}),
        )
    };
    assert_eq!(
        refusal(session.parse_and_execute(&roll(&lacking))),
        (
            "invalid_request",
            "query lacks an access scope for query support person.stress".to_owned()
        )
    );
    result(session.parse_and_execute(&roll(&holding)));
}

#[test]
fn graph_query_refusals_keep_their_codes_and_messages() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
    let mut graph = |graph_query: serde_json::Value| {
        session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({"model_hash": model_hash, "graph_query": graph_query}),
        ))
    };
    let snapshot_hash = result(graph(serde_json::json!({"mode": "skeleton"})))["snapshot_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let stale = "0".repeat(64);

    assert_eq!(
        result(graph(serde_json::json!({
            "mode": "full",
            "expected_snapshot_hash": snapshot_hash
        })))["snapshot_hash"],
        snapshot_hash
    );
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "full",
            "expected_snapshot_hash": stale
        }))),
        (
            "conflict",
            format!("graph snapshot changed; expected {stale}, found {snapshot_hash}")
        )
    );
    let malformed = (
        "invalid_request",
        "expected_snapshot_hash must be a lowercase 64-character hexadecimal hash".to_owned(),
    );
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "skeleton",
            "expected_snapshot_hash": "ABC"
        }))),
        malformed
    );
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "skeleton",
            "expected_snapshot_hash": snapshot_hash.to_uppercase()
        }))),
        malformed
    );
    // The access scopes are checked before the expected snapshot.
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "full",
            "access_scopes": [""],
            "expected_snapshot_hash": "ABC"
        }))),
        (
            "invalid_request",
            "graph query exceeds an access-scope limit".to_owned()
        )
    );
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "neighborhood",
            "center": "person.stress",
            "depth": 17
        }))),
        (
            "invalid_request",
            "graph neighborhood depth 17 exceeds 16".to_owned()
        )
    );
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "neighborhood",
            "center": "person.missing"
        }))),
        (
            "not_found",
            "unknown graph node or source id person.missing".to_owned()
        )
    );
    // The snapshot is checked before the neighbourhood is looked for.
    assert_eq!(
        refusal(graph(serde_json::json!({
            "mode": "neighborhood",
            "center": "person.missing",
            "expected_snapshot_hash": stale
        })))
        .0,
        "conflict"
    );
    assert_eq!(
        result(graph(serde_json::json!({
            "mode": "neighborhood",
            "center": "person.stress"
        })))["neighborhood"]["center"],
        "process:person.stress"
    );
}

#[test]
fn a_graph_center_naming_both_a_process_and_a_law_is_ambiguous() {
    let mut model = test_model();
    let law = model
        .laws
        .iter_mut()
        .find(|law| law.id == "derive-error")
        .unwrap();
    law.id = "person.stress".to_owned();
    for dependency in &mut model.dependencies {
        if dependency.law_id.as_deref() == Some("derive-error") {
            dependency.law_id = Some("person.stress".to_owned());
        }
    }
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": model}),
    )));
    let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
    assert_eq!(
        refusal(session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {"mode": "neighborhood", "center": "person.stress"}
            }),
        ))),
        (
            "invalid_request",
            "graph source id person.stress is ambiguous; use process:person.stress or law:person.stress"
                .to_owned()
        )
    );
}

#[test]
fn query_graph_skeleton_and_neighborhood_are_snapshot_bound_and_boundary_complete() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let full = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "model_hash": model_hash,
            "graph_query": {"mode": "full"}
        }),
    )));
    let snapshot_hash = full["snapshot_hash"].as_str().unwrap().to_owned();
    let skeleton = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "model_hash": model_hash,
            "graph_query": {
                "mode": "skeleton",
                "expected_snapshot_hash": snapshot_hash
            }
        }),
    )));
    assert_eq!(skeleton["snapshot_hash"], full["snapshot_hash"]);
    assert_eq!(skeleton["returned_node_count"], 0);
    assert_eq!(skeleton["returned_edge_count"], 0);
    assert_eq!(skeleton["skeleton"]["process_count"], 4);
    assert_eq!(skeleton["skeleton"]["law_count"], 6);

    let neighborhood = result(session.parse_and_execute(&command(
        "query_graph",
        serde_json::json!({
            "model_hash": model_hash,
            "graph_query": {
                "mode": "neighborhood",
                "center": "derive-error",
                "depth": 0,
                "direction": "both",
                "expected_snapshot_hash": full["snapshot_hash"]
            }
        }),
    )));
    assert_eq!(neighborhood["neighborhood"]["center"], "law:derive-error");
    assert_eq!(neighborhood["neighborhood"]["core_node_count"], 1);
    assert_eq!(neighborhood["neighborhood"]["boundary_node_count"], 2);
    assert_eq!(neighborhood["returned_edge_count"], 2);
    let returned_ids: BTreeSet<&str> = neighborhood["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["id"].as_str().unwrap())
        .collect();
    for edge in neighborhood["edges"].as_array().unwrap() {
        assert!(returned_ids.contains(edge["source"].as_str().unwrap()));
        assert!(returned_ids.contains(edge["target"].as_str().unwrap()));
        assert_eq!(edge["crossing"], true);
    }
    let incident_in_full = full["edges"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|edge| edge["source"] == "law:derive-error" || edge["target"] == "law:derive-error")
        .count();
    assert_eq!(incident_in_full, neighborhood["returned_edge_count"]);

    let stale = session.parse_and_execute(&command(
            "query_graph",
            serde_json::json!({
                "model_hash": model_hash,
                "graph_query": {
                    "mode": "full",
                    "expected_snapshot_hash": "0000000000000000000000000000000000000000000000000000000000000000"
                }
            }),
        ));
    assert!(!stale.ok);
    assert_eq!(stale.error.unwrap().code, "conflict");
}

#[test]
fn typed_ir_validates_all_five_roles_and_keeps_edges_distinct() {
    let compiled = compile_model(test_model()).unwrap();
    let summary = compiled.summary();
    assert_eq!(summary.process_count, 4);
    assert_eq!(summary.decomposition_edge_count, 2);
    assert_eq!(summary.dependency_edge_count, 4);
    for role in [
        "evolution",
        "relation",
        "occurrence",
        "epistemic",
        "resolution",
    ] {
        assert!(summary.law_roles.contains_key(role));
    }
    assert_eq!(
        compiled.genesis_world("world").unwrap().state["person.regime"],
        ProcessValue::Regime("calm".to_owned())
    );
}

#[test]
fn meaning_model_is_opt_in_canonical_and_visible_in_summary() {
    let legacy = test_model();
    let legacy_json = serde_json::to_value(&legacy).unwrap();
    assert!(!legacy_json
        .as_object()
        .unwrap()
        .contains_key("meaning_model"));
    let legacy_compiled = compile_model(legacy).unwrap();
    assert!(legacy_compiled.summary().meaning_model.is_none());

    let mut definition = test_model();
    definition.meaning_model = Some(meaning::test_meaning_model_fixture());
    let compiled = compile_model(definition).unwrap();
    assert_ne!(compiled.model_hash, legacy_compiled.model_hash);
    let summary = compiled.summary().meaning_model.unwrap();
    assert_eq!(summary.schema, MEANING_MODEL_SCHEMA);
    assert_eq!(summary.concept_count, 4);
    assert_eq!(
        summary.concept_ids,
        ["care", "love", "social-process", "trust"]
    );
    assert_eq!(summary.abstract_relation_count, 1);
    assert_eq!(summary.abstract_cut_count, 1);
    assert_eq!(summary.referent_count, 3);
    assert_eq!(
        summary.referent_ids,
        ["alice", "bob", "relationship-referent"]
    );
    assert_eq!(summary.encapsulation_cut_count, 1);
    assert_eq!(summary.event_count, 4);
    assert_eq!(summary.event_relation_count, 1);
    assert_eq!(summary.event_relation_ids, ["trust-enables-repair"]);
    assert_eq!(summary.event_referent_binding_count, 3);
    assert_eq!(
        summary.event_referent_binding_ids,
        [
            "relationship-person-a",
            "relationship-person-b",
            "relationship-state"
        ]
    );
    assert_eq!(summary.physical_cut_count, 2);
    assert_eq!(summary.realization_count, 2);
    assert_eq!(summary.realization_ids, ["define-love", "describe-trust"]);

    let meaning_model = compiled.definition().meaning_model.as_ref().unwrap();
    assert_eq!(
        meaning_model.abstract_cuts[0].child_concept_ids,
        ["care", "trust"]
    );
    assert_eq!(
        meaning_model.encapsulation_cuts[0]
            .children
            .iter()
            .map(|child| child.referent_id.as_str())
            .collect::<Vec<_>>(),
        ["alice", "bob"]
    );
    let parallel = meaning_model
        .physical_cuts
        .iter()
        .find(|cut| cut.kind == PhysicalCutKind::Parallel)
        .unwrap();
    assert_eq!(parallel.child_event_ids, ["care-event", "trust-event"]);
    let sequential = meaning_model
        .physical_cuts
        .iter()
        .find(|cut| cut.kind == PhysicalCutKind::Sequential)
        .unwrap();
    assert_eq!(sequential.child_event_ids, ["trust-event", "repair-event"]);

    let encoded = serde_json::to_vec(compiled.definition()).unwrap();
    let decoded: ModelDefinition = serde_json::from_slice(&encoded).unwrap();
    assert_eq!(&decoded, compiled.definition());

    let mut reordered = test_model();
    let mut meaning_model = meaning::test_meaning_model_fixture();
    meaning_model.concepts.reverse();
    meaning_model.referents.reverse();
    meaning_model.encapsulation_cuts[0].children.reverse();
    meaning_model.events.reverse();
    meaning_model.event_relations.reverse();
    meaning_model.event_referent_bindings.reverse();
    meaning_model.physical_cuts.reverse();
    meaning_model.realizations.reverse();
    reordered.meaning_model = Some(meaning_model);
    assert_eq!(
        compile_model(reordered).unwrap().model_hash,
        compiled.model_hash
    );
}

#[test]
fn canonical_world_hash_survives_exact_float_json_roundtrip() {
    let model = compile_model(test_model()).unwrap();
    let mut state = model.genesis_world("float-roundtrip").unwrap().state;
    state.insert(
        "person.stress".to_owned(),
        ProcessValue::Scalar(0.9091999999999999),
    );
    let world = build_world_head(
        &model,
        "float-roundtrip".to_owned(),
        1,
        1.0,
        state,
        model.initial_claims.clone(),
        None,
    )
    .unwrap();
    let encoded = serde_json::to_vec(&world).unwrap();
    let decoded: WorldHead = serde_json::from_slice(&encoded).unwrap();
    validate_world(&model, &decoded).unwrap();
    assert_eq!(decoded.world_hash, world.world_hash);
    assert_eq!(serde_json::to_vec(&decoded).unwrap(), encoded);
}

#[test]
fn typed_ir_rejects_unknown_semantic_fields() {
    let mut model = serde_json::to_value(test_model()).unwrap();
    model["laws"][0]["operator"]["innovaton"] = serde_json::json!({"name": "typo"});
    assert!(serde_json::from_value::<ModelDefinition>(model).is_err());

    let value = serde_json::json!({"kind": "scalar", "value": 0.5, "ignored": true});
    assert!(serde_json::from_value::<ProcessValue>(value).is_err());
}

#[test]
fn retained_decimation_only_upgrades_when_it_is_a_sample_superset() {
    let path = |every| RetainedModelPath {
        schema: MODEL_PATH_SCHEMA.to_owned(),
        retention: PathSpec::Decimated { every },
        total_sample_count: 0,
        samples: vec![],
    };
    assert!(path_is_richer(&path(2), &path(4)));
    assert!(!path_is_richer(&path(2), &path(3)));
}

#[test]
fn complete_roll_is_deterministic_and_path_policy_does_not_change_canon() {
    let compiled = compile_model(test_model()).unwrap();
    let parent = compiled.genesis_world("world").unwrap();
    let endpoint = roll_model_transition(&compiled, &parent, query(0, PathSpec::Endpoint)).unwrap();
    let full = roll_model_transition(&compiled, &parent, query(0, PathSpec::Full)).unwrap();
    assert_eq!(
        endpoint.candidate.candidate_hash,
        full.candidate.candidate_hash
    );
    assert_eq!(
        endpoint.candidate.successor_state,
        full.candidate.successor_state
    );
    assert_eq!(endpoint.candidate.path.samples.len(), 1);
    assert_eq!(full.candidate.path.samples.len(), 5);
    assert!(endpoint
        .candidate
        .successor_state
        .contains_key("person.regime"));
    assert!(endpoint
        .candidate
        .successor_claims
        .contains_key("observer:stress"));
    assert!(!endpoint.candidate.marks.is_empty());
    assert!(!endpoint.candidate.randomness.draws.is_empty());
    assert_eq!(parent.version, 0);
}

#[test]
fn ordinary_ir_routes_a_normalized_solver_repertoire_by_context() {
    let field = |id: &str,
                 initial: f64,
                 minimum: f64,
                 maximum: f64,
                 role: &str,
                 update_mode: ProcessUpdateMode| {
        let mut field = scalar_process(id, initial);
        field.value_type = ProcessType::Scalar {
            bounds: NumericBounds { minimum, maximum },
        };
        field.axes.clear();
        field.scale = BTreeMap::from([
            ("semantic_role".to_owned(), role.to_owned()),
            (
                "claim_boundary".to_owned(),
                "authored strategy signal, not validated cognition".to_owned(),
            ),
        ]);
        field.support = vec!["contextual solver repertoire fixture".to_owned()];
        field.update_mode = update_mode;
        field
    };
    let relation = |id: &str, target: &str, value: ScalarExpression| LawDefinition {
        id: id.to_owned(),
        enabled: true,
        activation: LawActivation::Always,
        operator: LawOperator::Relation {
            target: target.to_owned(),
            value,
        },
        provenance: vec!["contextual solver repertoire fixture".to_owned()],
    };
    let components = [
        ("abstract", 0.9, 0.4),
        ("relational", 0.2, 0.2),
        ("procedural", -0.4, 0.4),
    ];
    let mut processes = vec![field(
        "problem.context.abstraction_relevance",
        0.5,
        0.0,
        1.0,
        "problem_context",
        ProcessUpdateMode::Static,
    )];
    for (id, output, initial_weight) in components {
        processes.push(field(
            &format!("solver.{id}.output"),
            output,
            -1.0,
            1.0,
            "solver_component_output",
            ProcessUpdateMode::Static,
        ));
        processes.push(field(
            &format!("solver.{id}.weight"),
            initial_weight,
            0.0,
            1.0,
            "normalized_solver_weight",
            ProcessUpdateMode::Unspecified,
        ));
    }
    processes.push(field(
        "solver.routed.output",
        0.24,
        -1.0,
        1.0,
        "routed_solver_output",
        ProcessUpdateMode::Unspecified,
    ));

    let mut laws = Vec::new();
    let context = || process("problem.context.abstraction_relevance");
    for (id, weight) in [
        (
            "abstract",
            ScalarExpression::Add {
                terms: vec![
                    constant(0.1),
                    ScalarExpression::Multiply {
                        factors: vec![constant(0.6), context()],
                    },
                ],
            },
        ),
        ("relational", constant(0.2)),
        (
            "procedural",
            ScalarExpression::Subtract {
                left: Box::new(constant(0.7)),
                right: Box::new(ScalarExpression::Multiply {
                    factors: vec![constant(0.6), context()],
                }),
            },
        ),
    ] {
        laws.push(relation(
            &format!("derive-solver-{id}-weight"),
            &format!("solver.{id}.weight"),
            weight,
        ));
    }
    laws.push(relation(
        "derive-routed-solver-output",
        "solver.routed.output",
        ScalarExpression::Add {
            terms: components
                .iter()
                .map(|(id, _, _)| ScalarExpression::Multiply {
                    factors: vec![
                        process(&format!("solver.{id}.weight")),
                        process(&format!("solver.{id}.output")),
                    ],
                })
                .collect(),
        },
    ));

    let definition = ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "contextual-solver-repertoire".to_owned(),
        time_unit: "decision_interval".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "Exercise a contextual continuous mixture using only ordinary IR.".to_owned(),
            provenance: vec!["contextual solver repertoire fixture".to_owned()],
        },
        processes,
        decomposition: vec![],
        dependencies: vec![],
        laws,
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    };
    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("solver-routing-world").unwrap();
    let observables = model
        .definition()
        .processes
        .iter()
        .map(|field| field.id.clone())
        .collect::<Vec<_>>();
    let roll_in_context = |label: &str, context: f64| {
        roll_model_transition(
            &model,
            &parent,
            ModelTransitionSpec {
                schema: MODEL_QUERY_SCHEMA.to_owned(),
                delta_time: 0.1,
                step_size: 0.1,
                seed: "contextual-solver-repertoire".to_owned(),
                roll_index: 0,
                direction: TimeDirection::Forward,
                precedence: ResolutionPrecedence::Balanced,
                temporal_resolution: None,
                semantic_resolution: Some("solver-interface".to_owned()),
                interventions: vec![TimedIntervention {
                    id: format!("set-{label}-context"),
                    offset: 0.0,
                    effect: StateEffect {
                        target: "problem.context.abstraction_relevance".to_owned(),
                        mode: EffectMode::Set,
                        value: constant(context),
                    },
                    application: None,
                }],
                observations: vec![],
                comparison_stream: None,
                selected_support: vec![],
                requested_observables: observables.clone(),
                access_scopes: vec![],
                path: PathSpec::Full,
            },
        )
        .unwrap()
    };

    let concrete = roll_in_context("concrete", 0.1);
    let abstracted = roll_in_context("abstract", 0.9);
    let read = |state: &BTreeMap<String, ProcessValue>, id: &str| scalar(state, id).unwrap();
    for result in [&concrete, &abstracted] {
        let state = &result.candidate.successor_state;
        let weight_sum: f64 = components
            .iter()
            .map(|(id, _, _)| read(state, &format!("solver.{id}.weight")))
            .sum();
        assert!((weight_sum - 1.0).abs() < 1.0e-12);
        assert!(components.iter().all(|(id, _, _)| {
            let weight = read(state, &format!("solver.{id}.weight"));
            weight > 0.0 && weight < 1.0
        }));
        assert_eq!(read(state, "solver.abstract.output"), 0.9);
        assert_eq!(read(state, "solver.relational.output"), 0.2);
        assert_eq!(read(state, "solver.procedural.output"), -0.4);

        let reconstructed: f64 = components
            .iter()
            .map(|(id, _, _)| {
                read(state, &format!("solver.{id}.weight"))
                    * read(state, &format!("solver.{id}.output"))
            })
            .sum();
        assert!((read(state, "solver.routed.output") - reconstructed).abs() < 1.0e-12);
        assert_eq!(state.len(), model.definition().processes.len());
        assert_eq!(result.proposed_head.state, *state);
        assert_eq!(result.candidate.expected_parent_version, parent.version);
        assert_eq!(result.proposed_head.version, parent.version + 1);
        assert_eq!(
            result.proposed_head.lineage_head.as_deref(),
            Some(result.candidate.candidate_hash.as_str())
        );
        assert_eq!(result.candidate.path.samples.last().unwrap().state, *state);
    }

    let concrete_state = &concrete.candidate.successor_state;
    let abstract_state = &abstracted.candidate.successor_state;
    assert!(
        read(concrete_state, "solver.procedural.weight")
            > read(concrete_state, "solver.abstract.weight")
    );
    assert!(
        read(abstract_state, "solver.abstract.weight")
            > read(abstract_state, "solver.procedural.weight")
    );
    assert!(
        read(abstract_state, "solver.routed.output") > read(concrete_state, "solver.routed.output")
    );
    assert_ne!(
        concrete.candidate.candidate_hash,
        abstracted.candidate.candidate_hash
    );
    assert_eq!(parent.version, 0);
}

#[test]
fn epistemic_endpoint_claims_are_derived_at_the_successor_time() {
    let compiled = compile_model(test_model()).unwrap();
    let parent = compiled.genesis_world("derived-claim-world").unwrap();
    let rolled = roll_model_transition(&compiled, &parent, query(0, PathSpec::Endpoint)).unwrap();
    let claim = &rolled.candidate.successor_claims["observer:stress"];
    assert_eq!(claim.mode, Some(ClaimMode::Derived));
    assert_eq!(claim.value_time, Some(rolled.candidate.end_time));
    assert_eq!(claim.evidence_cutoff, rolled.candidate.end_time);
    assert_eq!(claim.evidence_type, EvidenceType::Estimate);
}

#[test]
fn lawless_observed_series_carries_and_relations_see_each_observation() {
    let model = compile_model(observed_series_model()).unwrap();
    let parent = model.genesis_world("observed-world").unwrap();
    let late = observed_value("late", 0.75, 40.0);
    let early = observed_value("early", 0.25, 20.0);
    let rolled = roll_model_transition(
        &model,
        &parent,
        observed_query(PathSpec::Full, vec![late.clone(), early.clone()]),
    )
    .unwrap();

    assert_eq!(
        rolled
            .candidate
            .query
            .observations
            .iter()
            .map(|observation| observation.id.as_str())
            .collect::<Vec<_>>(),
        ["early", "late"]
    );
    let temperatures = rolled
        .candidate
        .path
        .samples
        .iter()
        .map(|sample| scalar(&sample.state, "sensor.temperature").unwrap())
        .collect::<Vec<_>>();
    let derived = rolled
        .candidate
        .path
        .samples
        .iter()
        .map(|sample| scalar(&sample.state, "sensor.derived_heat").unwrap())
        .collect::<Vec<_>>();
    assert_eq!(temperatures, [10.0, 20.0, 20.0, 40.0, 40.0]);
    assert_eq!(derived, [20.0, 40.0, 40.0, 80.0, 80.0]);
    assert_eq!(rolled.candidate.marks.len(), 2);
    assert!(rolled
        .candidate
        .marks
        .iter()
        .all(|mark| mark.kind == "observation"));

    let mut claims = rolled
        .candidate
        .successor_claims
        .values()
        .collect::<Vec<_>>();
    claims.sort_by(|left, right| {
        left.value_time
            .unwrap()
            .total_cmp(&right.value_time.unwrap())
    });
    assert_eq!(claims.len(), 2);
    assert_eq!(claims[0].value, ProcessValue::Scalar(20.0));
    assert_eq!(claims[1].value, ProcessValue::Scalar(40.0));
    for (claim, expected_time) in claims.iter().zip([0.25, 0.75]) {
        assert_eq!(claim.mode, Some(ClaimMode::Observed));
        assert_eq!(claim.value_time, Some(expected_time));
        assert_eq!(claim.evidence_cutoff, expected_time);
        assert_eq!(claim.evidence_type, EvidenceType::Observation);
        assert_eq!(claim.holder, "sensor-operator");
        assert_eq!(claim.provenance, ["calibrated sensor fixture"]);
        assert_eq!(claim.authority.source, "sensor-A");
        assert_eq!(claim.authority.weight, 0.9);
        assert_eq!(
            claim.uncertainty,
            ClaimUncertainty::StandardDeviation { value: 0.25 }
        );
        assert_eq!(claim.access_scopes, ["sensor:private"]);
    }

    let reordered = roll_model_transition(
        &model,
        &parent,
        observed_query(PathSpec::Full, vec![early, late]),
    )
    .unwrap();
    assert_eq!(rolled, reordered);

    let carried =
        roll_model_transition(&model, &parent, observed_query(PathSpec::Full, vec![])).unwrap();
    assert_ne!(rolled.candidate.query_hash, carried.candidate.query_hash);
    assert_ne!(
        rolled.candidate.dynamics_hash,
        carried.candidate.dynamics_hash
    );
    assert_ne!(
        rolled.candidate.candidate_hash,
        carried.candidate.candidate_hash
    );
    assert!(carried.candidate.path.samples.iter().all(|sample| {
        scalar(&sample.state, "sensor.temperature").unwrap() == 10.0
            && scalar(&sample.state, "sensor.derived_heat").unwrap() == 20.0
    }));
}

#[test]
fn ai_report_can_ingest_a_non_scalar_observed_output_without_a_law() {
    let mut definition = observed_series_model();
    definition.id = "ai-vector-report".to_owned();
    let estimate = &mut definition.processes[0];
    estimate.id = "estimator.affect_estimate".to_owned();
    estimate.value_type = ProcessType::Vector {
        dimensions: 2,
        bounds: NumericBounds {
            minimum: -1.0,
            maximum: 1.0,
        },
    };
    estimate.initial_value = ProcessValue::Vector(vec![0.0, 0.0]);
    estimate.unit = Some("normalized-affect".to_owned());
    estimate.provenance = vec!["AI estimate channel fixture".to_owned()];
    definition.processes.truncate(1);
    definition.dependencies.clear();
    definition.laws.clear();

    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("ai-report-world").unwrap();
    let mut query = trajectory_query(PathSpec::Full, &["estimator.affect_estimate"]);
    query.access_scopes = vec!["sensor:private".to_owned()];
    query.observations = vec![TimedObservation {
        id: "agent-output-1".to_owned(),
        target: "estimator.affect_estimate".to_owned(),
        offset: 0.5,
        value: ProcessValue::Vector(vec![0.25, -0.5]),
        unit: Some("normalized-affect".to_owned()),
        uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
        evidence_type: EvidenceType::Report,
        holder: "agent:model-a".to_owned(),
        provenance: vec!["model-a emitted affect estimate".to_owned()],
        authority: ClaimAuthority {
            source: "agent:model-a".to_owned(),
            weight: 0.6,
        },
    }];

    let rolled = roll_model_transition(&model, &parent, query).unwrap();
    assert!(model.laws.is_empty());
    assert_eq!(
        rolled.candidate.successor_state["estimator.affect_estimate"],
        ProcessValue::Vector(vec![0.25, -0.5])
    );
    assert_eq!(
        rolled.candidate.path.samples[1].state["estimator.affect_estimate"],
        ProcessValue::Vector(vec![0.0, 0.0])
    );
    assert_eq!(
        rolled.candidate.path.samples[2].state["estimator.affect_estimate"],
        ProcessValue::Vector(vec![0.25, -0.5])
    );
    let claim = rolled.candidate.successor_claims.values().next().unwrap();
    assert_eq!(claim.mode, Some(ClaimMode::Observed));
    assert_eq!(claim.evidence_type, EvidenceType::Report);
    assert_eq!(claim.holder, "agent:model-a");
    assert_eq!(claim.value, ProcessValue::Vector(vec![0.25, -0.5]));
    assert_eq!(claim.value_time, Some(0.5));
}

#[test]
fn observed_series_rejects_invalid_mode_type_unit_scope_time_and_duplicates() {
    let model = compile_model(observed_series_model()).unwrap();
    let parent = model.genesis_world("observed-errors").unwrap();
    let failure = |query| roll_model_transition(&model, &parent, query).unwrap_err().0;

    let mut wrong_mode = observed_value("wrong-mode", 0.25, 20.0);
    wrong_mode.target = "sensor.derived_heat".to_owned();
    wrong_mode.unit = Some("derived-celsius".to_owned());
    assert!(failure(observed_query(PathSpec::Full, vec![wrong_mode]))
        .contains("must declare update_mode observed"));

    let mut wrong_type = observed_value("wrong-type", 0.25, 20.0);
    wrong_type.value = ProcessValue::Category("hot".to_owned());
    assert!(failure(observed_query(PathSpec::Full, vec![wrong_type]))
        .contains("does not match declared scalar type"));

    let outside_bounds = observed_value("outside-bounds", 0.25, 101.0);
    assert!(
        failure(observed_query(PathSpec::Full, vec![outside_bounds]))
            .contains("outside declared bounds")
    );

    let mut wrong_unit = observed_value("wrong-unit", 0.25, 20.0);
    wrong_unit.unit = Some("fahrenheit".to_owned());
    assert!(failure(observed_query(PathSpec::Full, vec![wrong_unit]))
        .contains("unit does not exactly match"));

    let mut wrong_evidence = observed_value("wrong-evidence", 0.25, 20.0);
    wrong_evidence.evidence_type = EvidenceType::Estimate;
    assert!(
        failure(observed_query(PathSpec::Full, vec![wrong_evidence]))
            .contains("requires observation or report evidence")
    );

    let mut missing_scope = observed_query(
        PathSpec::Full,
        vec![observed_value("missing-scope", 0.25, 20.0)],
    );
    missing_scope.access_scopes.clear();
    assert!(failure(missing_scope).contains("lacks an access scope"));

    assert!(failure(observed_query(
        PathSpec::Full,
        vec![observed_value("at-genesis", 0.0, 20.0)]
    ))
    .contains("0 < offset <= delta_time"));
    assert!(failure(observed_query(
        PathSpec::Full,
        vec![observed_value("too-late", 1.25, 20.0)]
    ))
    .contains("0 < offset <= delta_time"));
    assert!(failure(observed_query(
        PathSpec::Full,
        vec![observed_value("unaligned", 0.3, 20.0)]
    ))
    .contains("exactly reachable transition step boundary"));

    let mut backward = observed_query(PathSpec::Full, vec![observed_value("backward", 0.25, 20.0)]);
    backward.direction = TimeDirection::Backward;
    assert!(failure(backward).contains("require forward transition direction"));

    assert!(failure(observed_query(
        PathSpec::Full,
        vec![
            observed_value("duplicate", 0.25, 20.0),
            observed_value("duplicate", 0.75, 40.0),
        ]
    ))
    .contains("id must be unique"));
    assert!(failure(observed_query(
        PathSpec::Full,
        vec![
            observed_value("same-time-a", 0.25, 20.0),
            observed_value("same-time-b", 0.25, 21.0),
        ]
    ))
    .contains("multiple observations target sensor.temperature"));

    let mut conflicting_definition = observed_series_model();
    conflicting_definition.laws.push(LawDefinition {
        id: "illegal-temperature-writer".to_owned(),
        enabled: true,
        activation: LawActivation::Always,
        operator: LawOperator::Evolution {
            target: "sensor.temperature".to_owned(),
            derivative: constant(1.0),
            innovation: None,
        },
        provenance: vec!["invalid observed-series fixture".to_owned()],
    });
    let conflicting = compile_model(conflicting_definition).unwrap();
    let conflicting_parent = conflicting.genesis_world("writer-conflict").unwrap();
    let conflict = roll_model_transition(
        &conflicting,
        &conflicting_parent,
        observed_query(
            PathSpec::Full,
            vec![observed_value("writer-conflict", 0.25, 20.0)],
        ),
    )
    .unwrap_err();
    assert!(conflict
        .0
        .contains("also written by law illegal-temperature-writer"));

    let mut intervention = observed_query(PathSpec::Full, vec![]);
    intervention.interventions.push(TimedIntervention {
        id: "not-an-observation".to_owned(),
        offset: 0.25,
        effect: StateEffect {
            target: "sensor.temperature".to_owned(),
            mode: EffectMode::Set,
            value: constant(20.0),
        },
        application: None,
    });
    assert!(failure(intervention).contains("use a timed observation"));
}

#[test]
fn initial_boundary_intervention_closes_relations_before_first_evolution_and_preserves_legacy_default(
) {
    let model = compile_model(intervention_timing_model()).unwrap();
    let parent = model.genesis_world("intervention-timing-world").unwrap();

    let legacy_query = intervention_timing_query(None);
    let legacy_json = serde_json::to_value(&legacy_query).unwrap();
    assert!(legacy_json["interventions"][0]
        .as_object()
        .unwrap()
        .get("application")
        .is_none());
    let legacy = roll_model_transition(&model, &parent, legacy_query).unwrap();
    assert_eq!(legacy.candidate.path.samples[0].state, parent.state);
    assert_close(
        scalar(&legacy.candidate.path.samples[1].state, "timing.stock").unwrap(),
        0.5,
    );
    assert_close(
        scalar(&legacy.candidate.path.samples[2].state, "timing.stock").unwrap(),
        1.5,
    );
    assert_eq!(legacy.candidate.marks.len(), 1);
    assert_eq!(legacy.candidate.marks[0].step, 1);
    assert_eq!(legacy.candidate.marks[0].time, 0.25);

    let initial_query = intervention_timing_query(Some(InterventionApplication::InitialBoundary));
    let initial_json = serde_json::to_value(&initial_query).unwrap();
    assert_eq!(
        initial_json["interventions"][0]["application"],
        "initial_boundary"
    );
    let initial = roll_model_transition(&model, &parent, initial_query).unwrap();
    assert_eq!(initial.candidate.path.samples[0].state, parent.state);
    assert_close(
        scalar(&initial.candidate.path.samples[1].state, "timing.control").unwrap(),
        2.0,
    );
    assert_close(
        scalar(&initial.candidate.path.samples[1].state, "timing.signal").unwrap(),
        4.0,
    );
    assert_close(
        scalar(&initial.candidate.path.samples[1].state, "timing.stock").unwrap(),
        1.0,
    );
    assert_close(
        scalar(&initial.candidate.path.samples[2].state, "timing.stock").unwrap(),
        2.0,
    );
    assert_eq!(initial.candidate.marks.len(), 1);
    assert_eq!(initial.candidate.marks[0].step, 0);
    assert_eq!(initial.candidate.marks[0].time, parent.time);
    assert_ne!(initial.candidate.query_hash, legacy.candidate.query_hash);
    assert_ne!(
        initial.candidate.dynamics_hash,
        legacy.candidate.dynamics_hash
    );
    assert_ne!(
        initial.candidate.trajectory_hash,
        legacy.candidate.trajectory_hash
    );
    assert_ne!(
        initial.candidate.candidate_hash,
        legacy.candidate.candidate_hash
    );

    let view = ViewSpec {
        requested_observables: vec![
            "timing.control".to_owned(),
            "timing.signal".to_owned(),
            "timing.stock".to_owned(),
        ],
        access_scopes: vec![],
        include_path: false,
    };
    let legacy_view = candidate_record_view(
        &model,
        &CandidateRecord {
            status: CandidateStatus::Pending,
            candidate: legacy.candidate,
            proposed_head: legacy.proposed_head,
        },
        view.clone(),
    )
    .unwrap();
    let legacy_query = legacy_view["candidate"]["query"].as_object().unwrap();
    let legacy_keys: BTreeSet<_> = legacy_query.keys().map(String::as_str).collect();
    let expected_legacy_keys = BTreeSet::from([
        "access_scopes",
        "delta_time",
        "direction",
        "intervention_count",
        "observation_count",
        "path",
        "precedence",
        "requested_observables",
        "roll_index",
        "schema",
        "selected_support_count",
        "semantic_resolution",
        "step_size",
        "temporal_resolution",
    ]);
    assert_eq!(legacy_keys, expected_legacy_keys);

    let initial_view = candidate_record_view(
        &model,
        &CandidateRecord {
            status: CandidateStatus::Pending,
            candidate: initial.candidate,
            proposed_head: initial.proposed_head,
        },
        view,
    )
    .unwrap();
    assert_eq!(
        initial_view["candidate"]["query"]["initial_boundary_intervention_count"],
        1
    );
    assert_eq!(
        initial_view["candidate"]["query"]
            .as_object()
            .unwrap()
            .len(),
        expected_legacy_keys.len() + 1
    );
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-12,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn trajectory_summary_matches_an_analytic_linear_subinterval() {
    let model = compile_model(linear_trajectory_model()).unwrap();
    let parent = model.genesis_world("linear-world").unwrap();
    let full = roll_model_transition(
        &model,
        &parent,
        trajectory_query(PathSpec::Full, &["position"]),
    )
    .unwrap();
    let summary = summarize_model_trajectory(
        &model,
        &parent,
        &full.candidate,
        trajectory_summary_spec(0.125, 0.875, &["position"]),
    )
    .unwrap();
    let position = &summary.fields[0];
    assert_close(position.start, 1.25);
    assert_close(position.end, 2.75);
    assert_close(position.integral, 1.5);
    assert_close(position.time_mean, 2.0);
    assert_close(position.minimum, 1.25);
    assert_close(position.maximum, 2.75);
    assert_eq!(position.unit.as_deref(), Some("meter"));
    assert_eq!(position.integral_unit.as_deref(), Some("meter*second"));
    assert_eq!(
        position.uncertainty_boundary.source_process,
        ClaimUncertainty::StandardDeviation { value: 0.1 }
    );
    assert_eq!(summary.retention, PathSpec::Full);
    assert_eq!(summary.total_sample_count, 5);
    assert_eq!(summary.retained_sample_count, 5);
    validate_model_trajectory_summary(&model, &parent, &full.candidate, &summary).unwrap();

    let decimated = roll_model_transition(
        &model,
        &parent,
        trajectory_query(PathSpec::Decimated { every: 2 }, &["position"]),
    )
    .unwrap();
    let coarse = summarize_model_trajectory(
        &model,
        &parent,
        &decimated.candidate,
        trajectory_summary_spec(0.125, 0.875, &["position"]),
    )
    .unwrap();
    assert_eq!(
        full.candidate.candidate_hash,
        decimated.candidate.candidate_hash
    );
    assert_eq!(
        full.candidate.trajectory_hash,
        decimated.candidate.trajectory_hash
    );
    assert_ne!(summary.candidate_query_hash, coarse.candidate_query_hash);
    assert_ne!(summary.retained_path_hash, coarse.retained_path_hash);
    assert_ne!(summary.summary_hash, coarse.summary_hash);
    assert_eq!(coarse.retained_sample_count, 3);
    assert_close(coarse.fields[0].integral, 1.5);
    assert_close(coarse.fields[0].time_mean, 2.0);

    let mut backward_query = trajectory_query(PathSpec::Full, &["position"]);
    backward_query.direction = TimeDirection::Backward;
    let backward = roll_model_transition(&model, &parent, backward_query).unwrap();
    let chronological = summarize_model_trajectory(
        &model,
        &parent,
        &backward.candidate,
        trajectory_summary_spec(-0.875, -0.125, &["position"]),
    )
    .unwrap();
    assert_close(chronological.fields[0].start, -0.75);
    assert_close(chronological.fields[0].end, 0.75);
    assert_close(chronological.fields[0].integral, 0.0);
    assert_close(chronological.fields[0].time_mean, 0.0);
    assert_close(chronological.fields[0].minimum, -0.75);
    assert_close(chronological.fields[0].maximum, 0.75);
}

#[test]
fn trajectory_summary_finds_interior_and_endpoint_extrema() {
    let model = compile_model(turning_trajectory_model()).unwrap();
    let parent = model.genesis_world("turning-world").unwrap();
    let rolled = roll_model_transition(
        &model,
        &parent,
        trajectory_query(PathSpec::Full, &["position", "velocity"]),
    )
    .unwrap();
    let summary = summarize_model_trajectory(
        &model,
        &parent,
        &rolled.candidate,
        trajectory_summary_spec(0.0, 1.0, &["velocity", "position"]),
    )
    .unwrap();
    assert_eq!(summary.fields[0].process_id, "position");
    let position = &summary.fields[0];
    assert_close(position.start, 0.0);
    assert_close(position.end, 0.25);
    assert_close(position.integral, 0.28125);
    assert_close(position.time_mean, 0.28125);
    assert_close(position.minimum, 0.0);
    assert_close(position.maximum, 0.375);

    let velocity = &summary.fields[1];
    assert_eq!(velocity.process_id, "velocity");
    assert_close(velocity.start, 1.0);
    assert_close(velocity.end, -1.0);
    assert_close(velocity.integral, 0.0);
    assert_close(velocity.time_mean, 0.0);
    assert_close(velocity.minimum, -1.0);
    assert_close(velocity.maximum, 1.0);
}

#[test]
fn trajectory_summary_rejects_endpoint_retention_and_invalid_requests() {
    let model = compile_model(linear_trajectory_model()).unwrap();
    let parent = model.genesis_world("summary-errors").unwrap();
    let endpoint = roll_model_transition(
        &model,
        &parent,
        trajectory_query(PathSpec::Endpoint, &["position"]),
    )
    .unwrap();
    let failure = summarize_model_trajectory(
        &model,
        &parent,
        &endpoint.candidate,
        trajectory_summary_spec(0.0, 1.0, &["position"]),
    )
    .unwrap_err();
    assert!(failure
        .0
        .contains("endpoint-only retention is insufficient"));

    let full = roll_model_transition(
        &model,
        &parent,
        trajectory_query(PathSpec::Full, &["position"]),
    )
    .unwrap();
    let outside = summarize_model_trajectory(
        &model,
        &parent,
        &full.candidate,
        trajectory_summary_spec(-0.01, 0.5, &["position"]),
    )
    .unwrap_err();
    assert!(outside.0.contains("outside retained coverage"));
    let missing = summarize_model_trajectory(
        &model,
        &parent,
        &full.candidate,
        trajectory_summary_spec(0.0, 0.5, &["missing"]),
    )
    .unwrap_err();
    assert!(missing.0.contains("unknown process missing"));
    let reversed = summarize_model_trajectory(
        &model,
        &parent,
        &full.candidate,
        trajectory_summary_spec(0.5, 0.5, &["position"]),
    )
    .unwrap_err();
    assert!(reversed.0.contains("strictly less"));
}

#[test]
fn view_and_access_metadata_do_not_change_dynamics_or_randomness() {
    let compiled = compile_model(test_model()).unwrap();
    let parent = compiled.genesis_world("world").unwrap();
    let baseline = roll_model_transition(&compiled, &parent, query(0, PathSpec::Full)).unwrap();
    let mut alternate_query = query(0, PathSpec::Full);
    alternate_query
        .requested_observables
        .push("family.pressure".to_owned());
    alternate_query
        .access_scopes
        .push("irrelevant-view-scope".to_owned());
    alternate_query.temporal_resolution = Some("metadata-only-fine".to_owned());
    alternate_query.semantic_resolution = Some("metadata-only-public".to_owned());
    alternate_query.selected_support = vec!["family.pressure".to_owned()];
    let alternate = roll_model_transition(&compiled, &parent, alternate_query).unwrap();

    assert_eq!(
        baseline.candidate.dynamics_hash,
        alternate.candidate.dynamics_hash
    );
    assert_ne!(
        baseline.candidate.query_hash,
        alternate.candidate.query_hash
    );
    assert_eq!(
        baseline.candidate.candidate_hash,
        alternate.candidate.candidate_hash
    );
    assert_eq!(
        baseline.proposed_head.world_hash,
        alternate.proposed_head.world_hash
    );
    assert_eq!(
        baseline.candidate.randomness.draw_set_hash,
        alternate.candidate.randomness.draw_set_hash
    );
    assert_eq!(
        baseline.candidate.trajectory_hash,
        alternate.candidate.trajectory_hash
    );
    assert_eq!(
        baseline.candidate.successor_state,
        alternate.candidate.successor_state
    );
    assert_eq!(
        baseline.candidate.successor_claims,
        alternate.candidate.successor_claims
    );
    assert_eq!(baseline.candidate.marks, alternate.candidate.marks);
}

#[test]
fn oversized_transition_work_is_rejected_before_simulation() {
    let compiled = compile_model(test_model()).unwrap();
    let parent = compiled.genesis_world("world").unwrap();
    let mut oversized = query(0, PathSpec::Endpoint);
    oversized.step_size = 1.0 / (MAX_STEP_COUNT as f64 + 1.0);
    let failure = roll_model_transition(&compiled, &parent, oversized).unwrap_err();
    assert!(failure.0.contains("step count"));
    assert!(failure.0.contains("exceeds limit"));
}

#[test]
fn expression_depth_and_query_cardinality_are_bounded_before_execution() {
    let mut definition = test_model();
    let mut expression = constant(0.0);
    for _ in 0..MAX_EXPRESSION_DEPTH {
        expression = ScalarExpression::Negate {
            value: Box::new(expression),
        };
    }
    let LawOperator::Evolution { derivative, .. } = &mut definition.laws[0].operator else {
        panic!("first sorted fixture law must be evolution");
    };
    *derivative = expression;
    let failure = compile_model(definition).unwrap_err();
    assert!(failure.0.contains("expression depth"));

    let compiled = compile_model(test_model()).unwrap();
    let parent = compiled.genesis_world("bounded-query").unwrap();
    let mut oversized = query(0, PathSpec::Endpoint);
    oversized.requested_observables = vec!["person.stress".to_owned(); MAX_QUERY_OBSERVABLES + 1];
    let failure = roll_model_transition(&compiled, &parent, oversized).unwrap_err();
    assert!(failure.0.contains("query exceeds"));
}

#[test]
fn intervention_writes_and_epistemic_claims_enforce_independent_scopes() {
    let mut definition = test_model();
    definition
        .processes
        .iter_mut()
        .find(|process| process.id == "person.stress")
        .unwrap()
        .access_scopes = vec!["private-state".to_owned()];
    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("private-world").unwrap();
    let mut unauthorized = query(0, PathSpec::Endpoint);
    unauthorized.selected_support.clear();
    unauthorized.requested_observables.clear();
    unauthorized.interventions.push(TimedIntervention {
        id: "private-write".to_owned(),
        offset: 0.5,
        effect: StateEffect {
            target: "person.stress".to_owned(),
            mode: EffectMode::Set,
            value: constant(0.0),
        },
        application: None,
    });
    let failure = roll_model_transition(&model, &parent, unauthorized).unwrap_err();
    assert!(failure.0.contains("intervention private-write target"));

    let mut exfiltration = query(0, PathSpec::Endpoint);
    exfiltration.selected_support.clear();
    exfiltration.requested_observables = vec!["family.pressure".to_owned()];
    exfiltration.interventions.push(TimedIntervention {
        id: "private-read-public-write".to_owned(),
        offset: 0.5,
        effect: StateEffect {
            target: "family.pressure".to_owned(),
            mode: EffectMode::Set,
            value: process("person.stress"),
        },
        application: None,
    });
    let failure = roll_model_transition(&model, &parent, exfiltration).unwrap_err();
    assert!(failure
        .0
        .contains("intervention private-read-public-write input"));

    let mut definition = test_model();
    for law in &mut definition.laws {
        if let LawOperator::Epistemic { claim, .. } = &mut law.operator {
            claim.access_scopes = vec!["alice-beliefs".to_owned()];
        }
    }
    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("claim-world").unwrap();
    let rolled = roll_model_transition(&model, &parent, query(0, PathSpec::Endpoint)).unwrap();
    let record = CandidateRecord {
        status: CandidateStatus::Pending,
        candidate: rolled.candidate,
        proposed_head: rolled.proposed_head,
    };
    let public = candidate_record_view(
        &model,
        &record,
        ViewSpec {
            requested_observables: vec!["person.stress".to_owned()],
            access_scopes: vec![],
            include_path: false,
        },
    )
    .unwrap();
    assert_eq!(
        public["candidate"]["successor_claims"],
        serde_json::json!({})
    );
    let private = candidate_record_view(
        &model,
        &record,
        ViewSpec {
            requested_observables: vec!["person.stress".to_owned()],
            access_scopes: vec!["alice-beliefs".to_owned()],
            include_path: false,
        },
    )
    .unwrap();
    assert!(private["candidate"]["successor_claims"]["observer:stress"].is_object());
}

#[test]
fn claim_evidence_never_arrives_from_the_worlds_future() {
    let mut definition = test_model();
    definition.initial_claims.push(Claim {
        id: "future-evidence".to_owned(),
        subject: "person.stress".to_owned(),
        value: ProcessValue::Scalar(0.2),
        uncertainty: ClaimUncertainty::Exact,
        evidence_type: EvidenceType::Observation,
        holder: "observer".to_owned(),
        evidence_cutoff: 1.0,
        provenance: vec!["unit-test".to_owned()],
        authority: ClaimAuthority {
            source: "unit-test".to_owned(),
            weight: 1.0,
        },
        mode: None,
        value_time: None,
        access_scopes: vec![],
    });
    let failure = compile_model(definition).unwrap_err();
    assert!(failure.0.contains("after genesis time 0"));

    let model = compile_model(test_model()).unwrap();
    let forward = roll_model_transition(
        &model,
        &model.genesis_world("causal-claims").unwrap(),
        query(0, PathSpec::Endpoint),
    )
    .unwrap();
    let mut backward = query(0, PathSpec::Endpoint);
    backward.direction = TimeDirection::Backward;
    let reconstructed = roll_model_transition(&model, &forward.proposed_head, backward).unwrap();
    assert!(reconstructed
        .candidate
        .successor_claims
        .values()
        .all(|claim| claim.evidence_cutoff <= reconstructed.candidate.end_time));
}

#[test]
fn reroll_replaces_every_named_draw_without_changing_parent() {
    let compiled = compile_model(test_model()).unwrap();
    let parent = compiled.genesis_world("world").unwrap();
    let first = roll_model_transition(&compiled, &parent, query(0, PathSpec::Endpoint)).unwrap();
    let second = roll_model_transition(&compiled, &parent, query(1, PathSpec::Endpoint)).unwrap();
    assert_eq!(
        first.candidate.parent_world_hash,
        second.candidate.parent_world_hash
    );
    assert_ne!(
        first.candidate.randomness.draw_set_hash,
        second.candidate.randomness.draw_set_hash
    );
    assert_ne!(
        first.candidate.candidate_hash,
        second.candidate.candidate_hash
    );
    assert_eq!(parent.version, 0);
}

#[test]
fn common_random_stream_pairs_only_matching_named_draws_on_the_same_schedule() {
    let model = compile_model(test_model()).unwrap();
    let parent = model.genesis_world("paired-world").unwrap();

    let mut baseline_query = query(0, PathSpec::Full);
    baseline_query.comparison_stream = Some("experiment-42-pair-a".to_owned());
    let baseline = roll_model_transition(&model, &parent, baseline_query.clone()).unwrap();

    let mut intervened_query = baseline_query.clone();
    intervened_query.interventions.push(TimedIntervention {
        id: "paired-stress-increase".to_owned(),
        offset: 0.5,
        effect: StateEffect {
            target: "person.stress".to_owned(),
            mode: EffectMode::Add,
            value: constant(0.1),
        },
        application: None,
    });
    let intervened = roll_model_transition(&model, &parent, intervened_query.clone()).unwrap();

    assert_eq!(
        baseline.candidate.randomness.policy,
        RandomnessPolicy::CommonRandomComparison
    );
    assert_eq!(
        baseline.candidate.randomness.comparison_stream.as_deref(),
        Some("experiment-42-pair-a")
    );
    assert_eq!(
        baseline.candidate.randomness.schedule_hash,
        intervened.candidate.randomness.schedule_hash
    );
    assert_eq!(
        baseline.candidate.randomness.draws,
        intervened.candidate.randomness.draws
    );
    assert_ne!(
        baseline.candidate.query_hash,
        intervened.candidate.query_hash
    );
    assert_ne!(
        baseline.candidate.dynamics_hash,
        intervened.candidate.dynamics_hash
    );
    assert_ne!(
        baseline.candidate.trajectory_hash,
        intervened.candidate.trajectory_hash
    );
    assert_ne!(baseline.candidate.path, intervened.candidate.path);
    assert_ne!(
        baseline.candidate.candidate_hash,
        intervened.candidate.candidate_hash
    );
    assert_ne!(
        baseline.proposed_head.world_hash,
        intervened.proposed_head.world_hash
    );

    let mut unpaired_baseline_query = baseline_query.clone();
    unpaired_baseline_query.comparison_stream = None;
    let unpaired_baseline =
        roll_model_transition(&model, &parent, unpaired_baseline_query).unwrap();
    let mut unpaired_intervened_query = intervened_query;
    unpaired_intervened_query.comparison_stream = None;
    let unpaired_intervened =
        roll_model_transition(&model, &parent, unpaired_intervened_query).unwrap();
    assert_eq!(
        unpaired_baseline.candidate.randomness.policy,
        RandomnessPolicy::CandidateBound
    );
    assert_ne!(
        unpaired_baseline.candidate.randomness.draws,
        unpaired_intervened.candidate.randomness.draws
    );

    let first_raw = |roll: &ModelRollResult| roll.candidate.randomness.draws[0].raw_hex.clone();
    let mut equivalent_grid_query = baseline_query.clone();
    equivalent_grid_query.step_size = 0.3;
    let equivalent_grid = roll_model_transition(&model, &parent, equivalent_grid_query).unwrap();
    assert_eq!(
        baseline.candidate.randomness.schedule_hash,
        equivalent_grid.candidate.randomness.schedule_hash
    );
    assert_eq!(
        baseline.candidate.randomness.draws,
        equivalent_grid.candidate.randomness.draws
    );
    assert_ne!(
        baseline.candidate.query_hash,
        equivalent_grid.candidate.query_hash
    );

    let mut different_schedule_query = baseline_query.clone();
    different_schedule_query.step_size = 0.5;
    let different_schedule =
        roll_model_transition(&model, &parent, different_schedule_query).unwrap();
    assert_ne!(
        baseline.candidate.randomness.schedule_hash,
        different_schedule.candidate.randomness.schedule_hash
    );
    assert_ne!(first_raw(&baseline), first_raw(&different_schedule));

    let mut different_stream_query = baseline_query.clone();
    different_stream_query.comparison_stream = Some("experiment-42-pair-b".to_owned());
    let different_stream = roll_model_transition(&model, &parent, different_stream_query).unwrap();
    assert_eq!(
        baseline.candidate.randomness.schedule_hash,
        different_stream.candidate.randomness.schedule_hash
    );
    assert_ne!(first_raw(&baseline), first_raw(&different_stream));

    let mut different_roll_query = baseline_query;
    different_roll_query.roll_index = 1;
    let different_roll = roll_model_transition(&model, &parent, different_roll_query).unwrap();
    assert_eq!(
        baseline.candidate.randomness.schedule_hash,
        different_roll.candidate.randomness.schedule_hash
    );
    assert_ne!(first_raw(&baseline), first_raw(&different_roll));
}

#[test]
fn comparison_stream_is_optional_bounded_and_omitted_by_default() {
    let model = compile_model(test_model()).unwrap();
    let parent = model.genesis_world("comparison-validation").unwrap();
    let ordinary_query = query(0, PathSpec::Endpoint);
    let encoded = serde_json::to_value(&ordinary_query).unwrap();
    assert!(!encoded
        .as_object()
        .unwrap()
        .contains_key("comparison_stream"));
    let ordinary = roll_model_transition(&model, &parent, ordinary_query).unwrap();
    assert_eq!(
        ordinary.candidate.query_hash,
        "20bc2b4d303e57b3abd6f7a93fb69f81dacb1735da34a7ada5507135fe786ec4"
    );
    assert_eq!(
        ordinary.candidate.randomness.policy,
        RandomnessPolicy::CandidateBound
    );
    assert_eq!(ordinary.candidate.randomness.comparison_stream, None);
    assert_eq!(ordinary.candidate.randomness.schedule_hash.len(), 64);

    let mut legacy_master = Sha256::new();
    legacy_master.update(b"life-sim-rust-model-master-key/v1\0");
    legacy_master.update(ordinary.candidate.seed.as_bytes());
    legacy_master.update([0]);
    legacy_master.update(parent.world_hash.as_bytes());
    legacy_master.update([0]);
    legacy_master.update(ordinary.candidate.dynamics_hash.as_bytes());
    legacy_master.update([0]);
    legacy_master.update(ordinary.candidate.roll_index.to_le_bytes());
    let legacy_master: [u8; 32] = legacy_master.finalize().into();
    let legacy_first = random_draw(
        legacy_master,
        "law:stress-drift:innovation:stress-innovation",
        0,
        0,
    );
    assert_eq!(ordinary.candidate.randomness.draws[0], legacy_first);

    let mut empty = query(0, PathSpec::Endpoint);
    empty.comparison_stream = Some("   ".to_owned());
    let failure = roll_model_transition(&model, &parent, empty).unwrap_err();
    assert!(failure.0.contains("comparison_stream must be nonempty"));

    let mut oversized = query(0, PathSpec::Endpoint);
    oversized.comparison_stream = Some("x".repeat(MAX_QUERY_STRING_BYTES + 1));
    let failure = roll_model_transition(&model, &parent, oversized).unwrap_err();
    assert!(failure.0.contains("comparison_stream must be nonempty"));
}

#[test]
fn hazard_occurrence_uses_a_named_candidate_bound_draw() {
    let mut definition = test_model();
    definition.laws.push(LawDefinition {
        id: "certain-hazard".to_owned(),
        enabled: true,
        activation: LawActivation::Always,
        operator: LawOperator::Occurrence {
            trigger: OccurrenceTrigger::Hazard {
                rate: ScalarExpression::Add {
                    terms: vec![
                        constant(1_000_000.0),
                        ScalarExpression::Absolute {
                            value: Box::new(process("person.stress")),
                        },
                    ],
                },
            },
            effects: vec![StateEffect {
                target: "person.stress".to_owned(),
                mode: EffectMode::Add,
                value: constant(0.1),
            }],
            activates: vec![],
        },
        provenance: vec!["hazard-fixture".to_owned()],
    });
    definition.dependencies.push(DependencyEdge {
        id: "hazard-causes-stress".to_owned(),
        source: "person.stress".to_owned(),
        target: "person.stress".to_owned(),
        kind: DependencyKind::Causes,
        law_id: Some("certain-hazard".to_owned()),
    });
    let model = compile_model(definition).unwrap();
    let result = roll_model_transition(
        &model,
        &model.genesis_world("hazard").unwrap(),
        query(0, PathSpec::Endpoint),
    )
    .unwrap();
    assert!(result
        .candidate
        .marks
        .iter()
        .any(|mark| mark.source == "certain-hazard"));
    assert!(result
        .candidate
        .randomness
        .draws
        .iter()
        .any(|draw| draw.key.contains("certain-hazard:hazard")));
}

#[test]
fn session_commit_is_atomic_and_stale_siblings_are_superseded() {
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
        serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
    )));
    let first = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    let second = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(1, PathSpec::Endpoint)}),
    )));
    let first_hash = first["candidate"]["candidate_hash"].as_str().unwrap();
    let second_hash = second["candidate"]["candidate_hash"].as_str().unwrap();
    let committed = result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": first_hash}),
    )));
    assert_eq!(committed["world_head"]["version"], 1);
    assert_eq!(
        committed["world_head"]["lineage_head"],
        committed["candidate"]["candidate"]["candidate_hash"]
    );
    let inspected = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({"candidate_hash": second_hash}),
    )));
    assert_eq!(inspected["status"], "superseded");
    let rejected_commit = session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": second_hash}),
    ));
    assert!(!rejected_commit.ok);
    assert_eq!(rejected_commit.error.unwrap().code, "conflict");
}

#[test]
fn session_reroll_and_reject_leave_the_accepted_head_unchanged() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let model_hash = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let genesis = result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "world"}),
    )));
    let first = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    let first_hash = first["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let rerolled = result(session.parse_and_execute(&command(
        "reroll_candidate",
        serde_json::json!({"candidate_hash": first_hash}),
    )));
    assert_eq!(rerolled["candidate"]["roll_index"], 1);
    assert_eq!(
        rerolled["candidate"]["parent_world_hash"],
        first["candidate"]["parent_world_hash"]
    );
    assert_ne!(
        rerolled["candidate"]["randomness"]["draw_set_hash"],
        first["candidate"]["randomness"]["draw_set_hash"]
    );
    let original = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({"candidate_hash": first_hash}),
    )));
    assert_eq!(original["status"], "superseded");
    let rerolled_hash = rerolled["candidate"]["candidate_hash"].as_str().unwrap();
    result(session.parse_and_execute(&command(
        "reject_candidate",
        serde_json::json!({"candidate_hash": rerolled_hash}),
    )));
    let unchanged = result(session.parse_and_execute(&command(
        "get_world",
        serde_json::json!({"world_id": "world"}),
    )));
    assert_eq!(unchanged["world_hash"], genesis["world_hash"]);
    assert_eq!(unchanged["version"], 0);
}

#[test]
fn reroll_retry_cannot_demote_an_existing_committed_successor() {
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
    let original = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    let original_hash = original["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let successor = result(session.parse_and_execute(&command(
        "reroll_candidate",
        serde_json::json!({"candidate_hash": original_hash}),
    )));
    let successor_hash = successor["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let committed = result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": successor_hash}),
    )));
    let accepted_hash = committed["world_head"]["world_hash"].clone();

    let retry = result(session.parse_and_execute(&command(
        "reroll_candidate",
        serde_json::json!({"candidate_hash": original_hash}),
    )));
    assert_eq!(retry["status"], "committed");
    assert_eq!(retry["candidate"]["candidate_hash"], successor_hash);
    let inspected = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({"candidate_hash": successor_hash}),
    )));
    assert_eq!(inspected["status"], "committed");
    let head = result(session.parse_and_execute(&command(
        "get_world",
        serde_json::json!({"world_id": "world"}),
    )));
    assert_eq!(head["world_hash"], accepted_hash);
}

#[test]
fn repeated_roll_preserves_status_and_path_is_only_a_response_view() {
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
    let endpoint = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    let candidate_hash = endpoint["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "reject_candidate",
        serde_json::json!({"candidate_hash": candidate_hash}),
    )));
    let repeated = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Full)}),
    )));
    assert_eq!(repeated["status"], "rejected");
    assert_eq!(repeated["retention_upgraded"], true);
    assert_eq!(repeated["candidate"]["candidate_hash"], candidate_hash);
    assert_eq!(
        repeated["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    let stored = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({
            "candidate_hash": candidate_hash,
            "view": {"requested_observables": ["person.stress"], "include_path": true}
        }),
    )));
    assert_eq!(stored["status"], "rejected");
    assert_eq!(
        stored["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    let endpoint_again = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    assert_eq!(endpoint_again["retention_upgraded"], false);
    let still_full = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({
            "candidate_hash": candidate_hash,
            "view": {"requested_observables": ["person.stress"], "include_path": true}
        }),
    )));
    assert_eq!(
        still_full["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
}

#[test]
fn reroll_to_an_existing_child_still_supersedes_the_source() {
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
    let source = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Full)}),
    )));
    let child = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(1, PathSpec::Endpoint)}),
    )));
    let source_hash = source["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let child_hash = child["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let rerolled = result(session.parse_and_execute(&command(
        "reroll_candidate",
        serde_json::json!({"candidate_hash": source_hash}),
    )));
    assert_eq!(rerolled["status"], "pending");
    assert_eq!(rerolled["retention_upgraded"], true);
    assert_eq!(rerolled["candidate"]["candidate_hash"], child_hash);
    let source_after = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({"candidate_hash": source_hash}),
    )));
    assert_eq!(source_after["status"], "superseded");
    let child_after = result(session.parse_and_execute(&command(
        "inspect_candidate",
        serde_json::json!({
            "candidate_hash": child_hash,
            "view": {"requested_observables": ["person.stress"], "include_path": true}
        }),
    )));
    assert_eq!(
        child_after["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
}

#[test]
fn reroll_cannot_create_a_new_candidate_from_a_stale_parent() {
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
    let stale = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(5, PathSpec::Endpoint)}),
    )));
    let accepted = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "world", "query": query(0, PathSpec::Endpoint)}),
    )));
    let accepted_hash = accepted["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    result(session.parse_and_execute(&command(
        "commit_candidate",
        serde_json::json!({"candidate_hash": accepted_hash}),
    )));
    let stale_hash = stale["candidate"]["candidate_hash"].as_str().unwrap();
    let response = session.parse_and_execute(&command(
        "reroll_candidate",
        serde_json::json!({"candidate_hash": stale_hash}),
    ));
    assert!(!response.ok);
    let failure = response.error.unwrap();
    assert_eq!(failure.code, "conflict");
    assert!(failure.message.contains("stale frozen parent"));
}

#[test]
fn describe_exposes_exact_roles_edges_authority_and_execution_limits() {
    let response =
        crate::parse_and_execute(r#"{"schema":"life-sim-rust-command/v1","operation":"describe"}"#);
    let description = result(response);
    assert_eq!(description["operator_roles"].as_array().unwrap().len(), 5);
    assert_eq!(
        description["edge_kinds"]["decomposition"],
        serde_json::json!([
            "contains",
            "physical_part",
            "membership_view",
            "semantic_subtype",
            "temporal_phase",
            "functional_refinement",
            "observational_partition"
        ])
    );
    assert_eq!(
        description["edge_kinds"]["dependency"],
        serde_json::json!(["derives", "causes", "constrains", "observes"])
    );
    assert_eq!(
        description["schemas"]["meaning_model"],
        MEANING_MODEL_SCHEMA
    );
    assert_eq!(
        description["schemas"]["trajectory_summary_query"],
        TRAJECTORY_SUMMARY_QUERY_SCHEMA
    );
    assert_eq!(
        description["schemas"]["trajectory_summary"],
        TRAJECTORY_SUMMARY_SCHEMA
    );
    assert_eq!(
        description["profile_compilation"]["profiles"],
        serde_json::json!([
            "story",
            "concept_scaffold",
            "change_arc_scaffold",
            "person",
            "person_scaffold",
            "thing_scaffold",
            "relationship_scaffold",
            "decision"
        ])
    );
    assert!(
        description["profile_compilation"]["change_arc_scaffold"]["number_rule"]
            .as_str()
            .unwrap()
            .contains("unweighted")
    );
    assert_eq!(
        description["profile_compilation"]["person_scaffold"]["levels"],
        serde_json::json!(["lifecycle", "processes"])
    );
    assert!(
        description["profile_compilation"]["person_scaffold"]["number_rule"]
            .as_str()
            .unwrap()
            .contains("separately named Cut")
    );
    assert!(
        description["profile_compilation"]["thing_scaffold"]["number_rule"]
            .as_str()
            .unwrap()
            .contains("explicit later openings")
    );
    assert!(
        description["profile_compilation"]["relationship_scaffold"]["number_rule"]
            .as_str()
            .unwrap()
            .contains("no default trust")
    );
    assert!(description["operations"]
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("summarize_trajectory")));
    assert!(description["operations"]
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("refine_genesis_world")));
    assert_eq!(
        description["execution_limits"]["max_query_observations"],
        MAX_QUERY_OBSERVATIONS
    );
    assert_eq!(
        description["execution_limits"]["max_observation_provenance"],
        MAX_OBSERVATION_PROVENANCE
    );
    assert_eq!(
        description["observation_ingestion"]["query_field"],
        "ModelTransitionSpec.observations"
    );
    assert_eq!(
        description["observation_ingestion"]["claim_mode"],
        "observed"
    );
    assert_eq!(
        description["observation_ingestion"]["evidence_types"],
        serde_json::json!(["observation", "report"])
    );
    assert_eq!(
        description["observation_ingestion"]["initial_value_at_offset_zero"],
        true
    );
    assert_eq!(
        description["schemas"]["random_schedule_fingerprint"],
        RANDOM_SCHEDULE_SCHEMA
    );
    assert_eq!(
        description["execution"]["randomness_policies"],
        serde_json::json!(["candidate_bound", "common_random_comparison"])
    );
    assert_eq!(
        description["execution"]["common_random_comparison"]["query_field"],
        "comparison_stream"
    );
    assert_eq!(
        description["execution"]["common_random_comparison"]["opt_in_only"],
        true
    );
    assert_eq!(
        description["execution"]["intervention_timing"]["query_field"],
        "TimedIntervention.application"
    );
    assert_eq!(
        description["execution"]["intervention_timing"]["default_when_absent"],
        "successor_boundary"
    );
    assert_eq!(
        description["execution"]["intervention_timing"]["initial_boundary_offset"],
        0
    );
    assert!(
        description["execution"]["intervention_timing"]["parent_sample"]
            .as_str()
            .unwrap()
            .contains("unchanged frozen parent")
    );
    assert!(
        description["execution"]["common_random_comparison"]["claim_boundary"]
            .as_str()
            .unwrap()
            .contains("not branch splicing")
    );
    assert_eq!(
        description["edge_kinds"]["abstract_relation"],
        serde_json::json!([
            "specialization",
            "constrains",
            "analogy",
            "opposition",
            "other"
        ])
    );
    assert_eq!(
        description["edge_kinds"]["physical_cut"],
        serde_json::json!(["parallel", "sequential"])
    );
    assert_eq!(
        description["edge_kinds"]["event_relation"],
        serde_json::json!([
            "contains",
            "causes",
            "enables",
            "prevents",
            "constrains",
            "other"
        ])
    );
    assert_eq!(
        description["meaning_model"]["collections"],
        serde_json::json!([
            "concepts",
            "abstract_relations",
            "abstract_cuts",
            "referents",
            "encapsulation_cuts",
            "events",
            "event_relations",
            "event_referent_bindings",
            "physical_cuts",
            "realizations",
            "normalized_cuts",
            "context_roots",
            "temporal_cut_recompositions",
            "importance_scales",
            "event_importance",
            "cause_questions",
            "cause_assessments"
        ])
    );
    assert_eq!(
        description["meaning_model"]["event_referent_binding_targets"],
        serde_json::json!(["event", "process"])
    );
    assert_eq!(
        description["meaning_model"]["event_relation_semantics"]["execution"],
        "validated static causal claim; does not schedule events or create a law"
    );
    assert!(
        description["narrative_understanding_graph"]["model_anchor_kinds"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("event_relation"))
    );
    assert_eq!(
        description["meaning_model"]["realization_purposes"],
        serde_json::json!(["define", "describe"])
    );
    assert_eq!(
        description["meaning_model"]["genesis_refinement_boundary"],
        "not automatic discovery, adaptive runtime opening, or post-history migration"
    );
    assert_eq!(
        description["execution"]["genesis_refinement"]["implemented"],
        true
    );
    assert_eq!(
        description["execution"]["genesis_refinement"]["operation"],
        "refine_genesis_world"
    );
    assert_eq!(
        description["execution_limits"]["max_meaning_model_records"],
        MAX_MEANING_MODEL_RECORDS
    );
    assert_eq!(
        description["execution_limits"]["max_trajectory_summary_work"],
        MAX_TRAJECTORY_SUMMARY_WORK
    );
    assert_eq!(description["authority"]["atomic_commit"], true);
    assert_eq!(
        description["authority"]["durable_across_restart"],
        "when --state-file or LIFE_SIM_STATE_FILE is configured"
    );
    assert_eq!(
        description["execution"]["non_scalar_values"],
        "validated_and_carried_but_not_numerically_updated"
    );
    assert_eq!(
        description["execution"]["decomposition_edges"],
        "schema-time acyclic structural lenses only; no numeric, causal, or world-time effect"
    );
    assert_eq!(
            description["execution"]["dynamic_membership"],
            "represent as a time-indexed process updated by a relation law, not as a membership_view edge"
        );
    assert_eq!(
        description["execution"]["partial_refinement_reconciliation"],
        "not implemented"
    );
}

#[test]
fn typed_decomposition_kinds_round_trip_and_remain_structural_only() {
    let mut baseline = test_model();
    baseline.decomposition.clear();
    for law in &mut baseline.laws {
        if let LawOperator::Evolution { innovation, .. } = &mut law.operator {
            *innovation = None;
        }
    }
    let baseline = compile_model(baseline).unwrap();
    let baseline_roll = roll_model_transition(
        &baseline,
        &baseline.genesis_world("baseline").unwrap(),
        query(0, PathSpec::Endpoint),
    )
    .unwrap();

    for (wire_kind, kind) in decomposition_kinds() {
        assert_eq!(serde_json::to_value(kind).unwrap(), wire_kind);
        assert_eq!(
            serde_json::from_value::<DecompositionKind>(serde_json::json!(wire_kind)).unwrap(),
            kind
        );

        let mut model = test_model();
        for edge in &mut model.decomposition {
            edge.kind = kind;
        }
        for law in &mut model.laws {
            if let LawOperator::Evolution { innovation, .. } = &mut law.operator {
                *innovation = None;
            }
        }
        let compiled = compile_model(model).unwrap();
        assert!(compiled
            .definition()
            .decomposition
            .iter()
            .all(|edge| edge.kind == kind));
        let roll = roll_model_transition(
            &compiled,
            &compiled.genesis_world(wire_kind).unwrap(),
            query(0, PathSpec::Endpoint),
        )
        .unwrap();
        assert_eq!(
            roll.candidate.successor_state,
            baseline_roll.candidate.successor_state
        );
    }

    assert!(serde_json::from_value::<DecompositionKind>(serde_json::json!("causes")).is_err());
}

#[test]
fn typed_command_decode_errors_preserve_the_request_id() {
    let mut session = MachineSession::default();
    let response = session.parse_and_execute(
            r#"{"schema":"life-sim-rust-command/v1","request_id":"bad-model","operation":"validate_model","model":{"unexpected":true}}"#,
        );
    assert!(!response.ok);
    assert_eq!(response.request_id.as_deref(), Some("bad-model"));
    assert_eq!(response.error.unwrap().code, "invalid_json");

    let description = result(session.parse_and_execute(
        r#"{"schema":"life-sim-rust-command/v1","request_id":"still-live","operation":"describe"}"#,
    ));
    assert_eq!(description["engine"], "life-sim-engine");
}

#[test]
fn genesis_refinement_preserves_normalized_cuts_and_context_roots() {
    let mut base = genesis_refinement_base_model();
    let meaning = base.meaning_model.as_mut().unwrap();
    meaning.normalized_cuts.push(NormalizedCutDefinition {
        id: "outlook".to_owned(),
        parent_event_id: "trust-event".to_owned(),
        question: "Which comparison share is resolved?".to_owned(),
        unit: "comparison".to_owned(),
        answers: vec![
            NormalizedCutAnswer {
                key: "resolved".to_owned(),
                weight: 0.6,
                meaning: None,
                refers_to: None,
            },
            NormalizedCutAnswer {
                key: "remainder".to_owned(),
                weight: 0.4,
                meaning: None,
                refers_to: None,
            },
        ],
        conditioning: None,
        provenance: vec!["genesis refinement fixture".to_owned()],
        withdrawn: None,
    });
    meaning.context_roots.push(MeaningContextRootDefinition {
        event_id: "relationship-event".to_owned(),
        kind: MeaningContextRootKind::AcceptedWorld,
        provenance: vec!["genesis refinement fixture".to_owned()],
    });
    for event in &meaning.events {
        if event.id != "relationship-event" {
            meaning.event_relations.push(EventRelationDefinition {
                id: format!("root-contains-{}", event.id),
                source_event_id: "relationship-event".to_owned(),
                target_event_id: event.id.clone(),
                kind: EventRelationKind::Contains,
                description: None,
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["genesis refinement fixture".to_owned()],
                authority: None,
                forecast_answer: None,
            });
        }
    }
    let compiled_base = compile_model(base).unwrap();
    let mut addition = additive_genesis_revision(
        compiled_base.definition(),
        &compiled_base.model_hash,
        "cut-addition",
    );
    let mut extra_cut = addition.meaning_model.as_ref().unwrap().normalized_cuts[0].clone();
    extra_cut.id = "another-outlook".to_owned();
    addition
        .meaning_model
        .as_mut()
        .unwrap()
        .normalized_cuts
        .push(extra_cut);
    let audit =
        validate_monotonic_genesis_refinement(&compiled_base, &compile_model(addition).unwrap())
            .unwrap();
    assert_eq!(audit.preserved_records["meaning.normalized_cuts"], 1);
    assert_eq!(audit.added_records["meaning.normalized_cuts"], 1);
    assert_eq!(audit.preserved_records["meaning.context_roots"], 1);

    for variant in [
        "cut removed",
        "cut changed",
        "root removed",
        "root changed",
        "new nearest root",
    ] {
        let mut revision = additive_genesis_revision(
            compiled_base.definition(),
            &compiled_base.model_hash,
            "invalid-cut-revision",
        );
        let meaning = revision.meaning_model.as_mut().unwrap();
        match variant {
            "cut removed" => meaning.normalized_cuts.clear(),
            "cut changed" => {
                meaning.normalized_cuts[0].answers[0].weight = 0.5;
                meaning.normalized_cuts[0].answers[1].weight = 0.5;
            }
            "root removed" => meaning.context_roots.clear(),
            "root changed" => meaning.context_roots[0].kind = MeaningContextRootKind::Inner,
            _ => meaning.context_roots.push(MeaningContextRootDefinition {
                event_id: "trust-event".to_owned(),
                kind: MeaningContextRootKind::Inner,
                provenance: vec!["genesis refinement fixture".to_owned()],
            }),
        }
        let compiled = compile_model(revision).unwrap();
        let failure = validate_monotonic_genesis_refinement(&compiled_base, &compiled).unwrap_err();
        assert!(
            failure.0.contains("genesis refinement"),
            "{variant}: {failure}"
        );
    }
}

#[test]
fn genesis_refinement_can_strengthen_but_not_weaken_semantic_coverage() {
    let mut base = genesis_refinement_base_model();
    base.meaning_model.as_mut().unwrap().semantic_coverage = Some(SemanticCoverageDefinition {
        mode: SemanticCoverageMode::Report,
        unresolved_events: vec![UnresolvedSemanticEvent {
            event_id: "repair-event".to_owned(),
            reason: "the fixture intentionally leaves repair semantics unresolved".to_owned(),
            provenance: vec!["genesis-refinement-fixture".to_owned()],
        }],
    });
    let compiled_base = compile_model(base).unwrap();

    let mut strict_revision = additive_genesis_revision(
        compiled_base.definition(),
        &compiled_base.model_hash,
        "strict-coverage",
    );
    strict_revision
        .meaning_model
        .as_mut()
        .unwrap()
        .semantic_coverage
        .as_mut()
        .unwrap()
        .mode = SemanticCoverageMode::Strict;
    let compiled_strict = compile_model(strict_revision).unwrap();
    let audit = validate_monotonic_genesis_refinement(&compiled_base, &compiled_strict).unwrap();
    assert_eq!(
        audit.preserved_records["meaning.semantic_coverage.unresolved_events"],
        1
    );

    let mut weakened_revision = additive_genesis_revision(
        compiled_strict.definition(),
        &compiled_strict.model_hash,
        "weakened-coverage",
    );
    weakened_revision
        .meaning_model
        .as_mut()
        .unwrap()
        .semantic_coverage
        .as_mut()
        .unwrap()
        .mode = SemanticCoverageMode::Report;
    let compiled_weakened = compile_model(weakened_revision).unwrap();
    let failure =
        validate_monotonic_genesis_refinement(&compiled_strict, &compiled_weakened).unwrap_err();
    assert!(failure.0.contains("weakened strict semantic coverage"));
}

#[test]
fn model_revision_is_hash_linked_and_can_add_a_dimension() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let previous = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut revision = test_model();
    revision.revision = ModelRevision {
        number: 1,
        previous_model_hash: Some(previous.clone()),
        reason: "add temperature dimension".to_owned(),
        provenance: vec!["unit-test-revision".to_owned()],
    };
    let mut temperature = scalar_process("world.temperature", 1.0);
    temperature.update_mode = ProcessUpdateMode::Observed;
    revision.processes.push(temperature);
    let revised = result(session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({"model": revision}),
    )));
    assert_eq!(revised["summary"]["revision"]["number"], 1);
    assert_eq!(revised["summary"]["process_count"], 5);
    let replayed_root = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    assert_eq!(replayed_root["summary"]["model_hash"], previous);
}

#[test]
fn revision_additions_require_support_and_dynamics_or_wiring() {
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": test_model()}),
    )));
    let previous = registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision = |mut process: ProcessDefinition| {
        let mut model = test_model();
        model.revision = ModelRevision {
            number: 1,
            previous_model_hash: Some(previous.clone()),
            reason: "add a test process".to_owned(),
            provenance: vec!["unit-test-revision".to_owned()],
        };
        process.id = "world.new-process".to_owned();
        model.processes.push(process);
        model
    };

    let unwired = revision(scalar_process("placeholder", 0.0));
    let response = session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({"model": unwired}),
    ));
    assert!(!response.ok);
    assert!(response.error.unwrap().message.contains("static/observed"));

    let mut unsupported_process = scalar_process("placeholder", 0.0);
    unsupported_process.update_mode = ProcessUpdateMode::Static;
    unsupported_process.support.clear();
    let unsupported = revision(unsupported_process);
    let response = session.parse_and_execute(&command(
        "revise_model",
        serde_json::json!({"model": unsupported}),
    ));
    assert!(!response.ok);
    assert!(response
        .error
        .unwrap()
        .message
        .contains("support declaration"));
}

#[test]
fn linked_dependencies_must_match_law_reads_and_targets() {
    let mut wrong_source = test_model();
    wrong_source.dependencies[0].source = "family.pressure".to_owned();
    let failure = compile_model(wrong_source).unwrap_err();
    assert!(failure.0.contains("is not read by law"));

    let mut wrong_target = test_model();
    wrong_target.dependencies[0].target = "family.pressure".to_owned();
    let failure = compile_model(wrong_target).unwrap_err();
    assert!(failure.0.contains("is not a target or subject"));
}

#[test]
fn views_require_explicit_observables_and_enforce_scopes() {
    let mut definition = test_model();
    definition
        .processes
        .iter_mut()
        .find(|process| process.id == "person.stress")
        .unwrap()
        .access_scopes = vec!["private".to_owned()];
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": definition}),
    )));
    let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
    let genesis = result(session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({"model_hash": model_hash, "world_id": "private-world"}),
    )));
    assert_eq!(genesis["schema"], MODEL_VIEW_SCHEMA);
    assert_eq!(genesis["state"].as_object().unwrap().len(), 0);

    let denied = session.parse_and_execute(&command(
        "query_view",
        serde_json::json!({
            "world_id": "private-world",
            "view": {
                "requested_observables": ["person.stress"],
                "access_scopes": []
            }
        }),
    ));
    assert!(!denied.ok);
    assert!(denied.error.unwrap().message.contains("access scope"));

    let visible = result(session.parse_and_execute(&command(
        "query_view",
        serde_json::json!({
            "world_id": "private-world",
            "view": {
                "requested_observables": ["person.stress"],
                "access_scopes": ["private"]
            }
        }),
    )));
    assert_eq!(visible["state"].as_object().unwrap().len(), 1);
    assert!(visible["state"].get("person.stress").is_some());

    let mut private_query = query(0, PathSpec::Full);
    private_query.access_scopes = vec!["private".to_owned()];
    let candidate = result(session.parse_and_execute(&command(
        "roll_world",
        serde_json::json!({"world_id": "private-world", "query": private_query}),
    )));
    assert_eq!(
        candidate["candidate"]["successor_state"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    for sample in candidate["candidate"]["path"]["samples"]
        .as_array()
        .unwrap()
    {
        assert_eq!(sample["state"].as_object().unwrap().len(), 1);
    }
    let candidate_hash = candidate["candidate"]["candidate_hash"].as_str().unwrap();
    let alternate = result(session.parse_and_execute(&command(
        "query_view",
        serde_json::json!({
            "candidate_hash": candidate_hash,
            "view": {
                "requested_observables": ["family.pressure"],
                "access_scopes": [],
                "include_path": false
            }
        }),
    )));
    assert_eq!(
        alternate["candidate"]["successor_state"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        alternate["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    let encoded = serde_json::to_string(&alternate).unwrap();
    assert!(!encoded.contains("person.stress"));
    assert!(!encoded.contains("\"access_scopes\":[\"private\"]"));
    assert!(!alternate["candidate"]
        .as_object()
        .unwrap()
        .contains_key("seed"));
    assert!(!alternate["candidate"]["randomness"]
        .as_object()
        .unwrap()
        .contains_key("seed"));
    assert_eq!(
        alternate["candidate"]["query"]["requested_observables"],
        serde_json::json!(["family.pressure"])
    );
}

#[test]
fn invalid_creation_view_does_not_leave_a_world_behind() {
    let mut definition = test_model();
    definition
        .processes
        .iter_mut()
        .find(|process| process.id == "person.stress")
        .unwrap()
        .access_scopes = vec!["private".to_owned()];
    let mut session = MachineSession::default();
    let registered = result(session.parse_and_execute(&command(
        "register_model",
        serde_json::json!({"model": definition}),
    )));
    let model_hash = registered["summary"]["model_hash"].as_str().unwrap();
    let denied = session.parse_and_execute(&command(
        "create_world",
        serde_json::json!({
            "model_hash": model_hash,
            "world_id": "ghost-world",
            "view": {
                "requested_observables": ["person.stress"],
                "access_scopes": []
            }
        }),
    ));
    assert!(!denied.ok);
    let absent = session.parse_and_execute(&command(
        "get_world",
        serde_json::json!({"world_id": "ghost-world"}),
    ));
    assert!(!absent.ok);
    assert_eq!(absent.error.unwrap().code, "not_found");
}

#[test]
fn exact_coarse_fine_transition_commutes_with_aggregation() {
    let fine = compile_model(ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "fine".to_owned(),
        time_unit: "tick".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "commutation fixture".to_owned(),
            provenance: vec!["unit-test".to_owned()],
        },
        processes: vec![
            scalar_process("fine.a", 0.2),
            scalar_process("fine.b", 0.6),
            scalar_process("coarse.mean", 0.4),
        ],
        decomposition: vec![
            DecompositionEdge {
                id: "mean-a".to_owned(),
                parent: "coarse.mean".to_owned(),
                child: "fine.a".to_owned(),
                kind: DecompositionKind::Contains,
            },
            DecompositionEdge {
                id: "mean-b".to_owned(),
                parent: "coarse.mean".to_owned(),
                child: "fine.b".to_owned(),
                kind: DecompositionKind::Contains,
            },
        ],
        dependencies: vec![],
        laws: vec![
            LawDefinition {
                id: "advance-a".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "fine.a".to_owned(),
                    derivative: constant(0.1),
                    innovation: None,
                },
                provenance: vec!["commutation-fixture".to_owned()],
            },
            LawDefinition {
                id: "advance-b".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "fine.b".to_owned(),
                    derivative: constant(0.1),
                    innovation: None,
                },
                provenance: vec!["commutation-fixture".to_owned()],
            },
            LawDefinition {
                id: "aggregate".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Resolution {
                    target: "coarse.mean".to_owned(),
                    value: ScalarExpression::Multiply {
                        factors: vec![
                            constant(0.5),
                            ScalarExpression::Add {
                                terms: vec![process("fine.a"), process("fine.b")],
                            },
                        ],
                    },
                    direction: ResolutionDirection::Aggregate,
                },
                provenance: vec!["commutation-fixture".to_owned()],
            },
        ],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    })
    .unwrap();
    let coarse = compile_model(ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "coarse".to_owned(),
        time_unit: "tick".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "commutation fixture".to_owned(),
            provenance: vec!["unit-test".to_owned()],
        },
        processes: vec![scalar_process("coarse.mean", 0.4)],
        decomposition: vec![],
        dependencies: vec![],
        laws: vec![LawDefinition {
            id: "advance-mean".to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: "coarse.mean".to_owned(),
                derivative: constant(0.1),
                innovation: None,
            },
            provenance: vec!["commutation-fixture".to_owned()],
        }],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    })
    .unwrap();
    let mut fine_query = query(0, PathSpec::Endpoint);
    fine_query.step_size = 1.0;
    fine_query.precedence = ResolutionPrecedence::Fine;
    fine_query.selected_support.clear();
    fine_query.requested_observables.clear();
    let fine_result =
        roll_model_transition(&fine, &fine.genesis_world("fine").unwrap(), fine_query).unwrap();
    let mut coarse_query = query(0, PathSpec::Endpoint);
    coarse_query.step_size = 1.0;
    coarse_query.selected_support.clear();
    coarse_query.requested_observables.clear();
    let coarse_result = roll_model_transition(
        &coarse,
        &coarse.genesis_world("coarse").unwrap(),
        coarse_query,
    )
    .unwrap();
    assert_eq!(
        scalar(&fine_result.candidate.successor_state, "coarse.mean").unwrap(),
        scalar(&coarse_result.candidate.successor_state, "coarse.mean").unwrap()
    );
}

#[test]
fn every_declared_process_type_is_validated_and_retained() {
    let mut model = test_model();
    model.processes.extend([
        ProcessDefinition {
            id: "typed.vector".to_owned(),
            value_type: ProcessType::Vector {
                dimensions: 2,
                bounds: NumericBounds {
                    minimum: -1.0,
                    maximum: 1.0,
                },
            },
            initial_value: ProcessValue::Vector(vec![0.1, -0.1]),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::new(),
            support: vec!["two-dimensional".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Static,
        },
        ProcessDefinition {
            id: "typed.category".to_owned(),
            value_type: ProcessType::Category {
                variants: vec!["a".to_owned(), "b".to_owned()],
            },
            initial_value: ProcessValue::Category("a".to_owned()),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::new(),
            support: vec!["enumerated".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Static,
        },
        ProcessDefinition {
            id: "typed.distribution".to_owned(),
            value_type: ProcessType::Distribution {
                outcomes: vec!["a".to_owned(), "b".to_owned()],
            },
            initial_value: ProcessValue::Distribution(vec![0.25, 0.75]),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::new(),
            support: vec!["simplex".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Static,
        },
        ProcessDefinition {
            id: "typed.graph".to_owned(),
            value_type: ProcessType::Graph,
            initial_value: ProcessValue::Graph(GraphValue {
                nodes: vec!["a".to_owned(), "b".to_owned()],
                edges: vec![GraphEdgeValue {
                    source: "a".to_owned(),
                    target: "b".to_owned(),
                    relation: "knows".to_owned(),
                }],
            }),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::new(),
            support: vec!["finite graph".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Static,
        },
        ProcessDefinition {
            id: "typed.pose".to_owned(),
            value_type: ProcessType::ObjectPose {
                position_dimensions: 3,
                orientation_dimensions: 4,
            },
            initial_value: ProcessValue::ObjectPose(ObjectPoseValue {
                position: vec![0.0, 1.0, 2.0],
                orientation: vec![1.0, 0.0, 0.0, 0.0],
            }),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: vec!["unit-test".to_owned()],
            axes: vec![],
            unit: Some("meter".to_owned()),
            reference_frame: Some("room".to_owned()),
            scale: BTreeMap::new(),
            support: vec!["three-dimensional room".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Static,
        },
    ]);
    let compiled = compile_model(model).unwrap();
    let world = compiled.genesis_world("all-types").unwrap();
    for id in [
        "family.pressure",
        "person.regime",
        "typed.vector",
        "typed.category",
        "typed.distribution",
        "typed.graph",
        "typed.pose",
    ] {
        assert!(world.state.contains_key(id));
    }
}

#[test]
fn mixed_kind_cyclic_decomposition_and_non_scalar_laws_are_rejected() {
    let mut cyclic = test_model();
    cyclic.decomposition.push(DecompositionEdge {
        id: "cycle".to_owned(),
        parent: "person.stress".to_owned(),
        child: "family.pressure".to_owned(),
        kind: DecompositionKind::ObservationalPartition,
    });
    assert!(compile_model(cyclic).is_err());

    let mut wrong_type = test_model();
    wrong_type.laws.push(LawDefinition {
        id: "move-regime".to_owned(),
        enabled: true,
        activation: LawActivation::Always,
        operator: LawOperator::Evolution {
            target: "person.regime".to_owned(),
            derivative: constant(1.0),
            innovation: None,
        },
        provenance: vec!["invalid-type-fixture".to_owned()],
    });
    assert!(compile_model(wrong_type).is_err());
}
