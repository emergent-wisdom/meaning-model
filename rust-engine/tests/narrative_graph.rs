use life_sim_engine::{
    compile_model, compile_narrative_graph, Claim, ClaimUncertainty, MachineSession,
    NarrativeGraphDefinition, ProcessValue, StoredNarrativeGraph,
};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn execute(session: &mut MachineSession, command: Value) -> Value {
    let response = session.parse_and_execute(&command.to_string());
    assert!(response.ok, "{:?}", response.error);
    response.result.expect("successful command has a result")
}

fn model() -> Value {
    json!({
        "schema": "life-sim-rust-model/v1",
        "id": "graph-native-story",
        "time_unit": "hour",
        "revision": {
            "number": 0,
            "reason": "Narrative graph integration fixture.",
            "provenance": ["rust narrative graph test"]
        },
        "processes": [{
            "id": "mara.trust",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 1.0}
            },
            "initial_value": {"kind": "scalar", "value": 0.58},
            "provenance": ["rust narrative graph test"],
            "support": ["modeled trust coordinate"],
            "access_scopes": []
        }, {
            "id": "mara.private_signal",
            "value_type": {
                "kind": "scalar",
                "bounds": {"minimum": 0.0, "maximum": 1.0}
            },
            "initial_value": {"kind": "scalar", "value": 0.2},
            "provenance": ["rust narrative graph test"],
            "support": ["private coordinate for projection tests"],
            "access_scopes": ["private-owner"]
        }],
        "decomposition": [],
        "dependencies": [],
        "laws": [],
        "initial_claims": [],
        "meaning_model": {
            "schema": "life-sim-rust-meaning-model/v1",
            "concepts": [{
                "id": "disclosure",
                "label": "Disclosure",
                "differentia": ["previously concealed information becomes shared"],
                "provenance": ["rust narrative graph test"]
            }],
            "events": [{
                "id": "mara-discloses",
                "boundary": "Mara tells Jonas the concealed fact.",
                "process_ids": ["mara.trust"],
                "provenance": ["rust narrative graph test"]
            }]
        }
    })
}

fn graph(world_hash: &str, revision: u64, previous: Option<&str>, passage: &str) -> Value {
    json!({
        "schema": "life-sim-rust-narrative-graph/v1",
        "id": "mara-story",
        "revision": {
            "number": revision,
            "previous_graph_hash": previous,
            "reason": if revision == 0 { "First graph-native draft." } else { "Revise one canonical passage." },
            "provenance": ["rust narrative graph test"]
        },
        "source": {
            "kind": "world",
            "world_id": "story-world",
            "world_hash": world_hash
        },
        "roots": ["document"],
        "nodes": [{
            "id": "document",
            "node_type": "short_story",
            "role": "document_root",
            "epistemic_status": "fictional_artifact",
            "evidence_type": "fictional_canon",
            "render": "exclude",
            "training": "exclude",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "passage-1",
            "node_type": "paragraph",
            "role": "story_passage",
            "text": passage,
            "epistemic_status": "fictional_canon",
            "evidence_type": "fictional_canon",
            "authority": {"source": "author", "weight": 1.0},
            "render": "include",
            "training": "include",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "reflection-1",
            "node_type": "hypothesis",
            "role": "externalized_reflection",
            "text": "Trust should remain visible beneath the dialogue.",
            "epistemic_status": "author_hypothesis",
            "evidence_type": "creative_hypothesis",
            "holder": "author",
            "subject": "passage-1",
            "estimator": "author",
            "authority": {"source": "author", "weight": 0.8},
            "access_scopes": ["author:private"],
            "render": "exclude",
            "training": "include",
            "provenance": ["rust narrative graph test"]
        }],
        "edges": [{
            "id": "document-contains-passage",
            "source": {"kind": "node", "node_id": "document"},
            "target": {"kind": "node", "node_id": "passage-1"},
            "family": "structural",
            "relation": "contains",
            "order": 0,
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "passage-expresses-trust-type",
            "source": {"kind": "node", "node_id": "passage-1"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "process",
                "anchor_id": "mara.trust",
                "path": "/value_type/kind"
            },
            "family": "grounding",
            "relation": "expresses",
            "explanation": "The paragraph realizes the modeled trust coordinate.",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "passage-depicts-event-boundary",
            "source": {"kind": "node", "node_id": "passage-1"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "event",
                "anchor_id": "mara-discloses",
                "path": "/boundary"
            },
            "family": "grounding",
            "relation": "depicts",
            "explanation": "The passage depicts one named semantic event.",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "passage-expresses-concept-differentia",
            "source": {"kind": "node", "node_id": "passage-1"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "model",
                "anchor_id": "graph-native-story",
                "path": "/meaning_model/concepts/0/differentia/0"
            },
            "family": "grounding",
            "relation": "expresses",
            "explanation": "A model-root pointer can address any nested stable model part.",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "passage-aligns-world-value",
            "source": {"kind": "node", "node_id": "passage-1"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "world",
                "anchor_id": "story-world",
                "path": "/state/mara.trust/value"
            },
            "family": "grounding",
            "relation": "aligned_with",
            "explanation": "The passage is aligned to an exact nested world-state value.",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "process-type-contextualizes-event-boundary",
            "source": {
                "kind": "anchor",
                "anchor_kind": "process",
                "anchor_id": "mara.trust",
                "path": "/value_type/kind"
            },
            "target": {
                "kind": "anchor",
                "anchor_kind": "event",
                "anchor_id": "mara-discloses",
                "path": "/boundary"
            },
            "family": "semantic",
            "relation": "contextualizes",
            "explanation": "Stable model parts may also be related directly.",
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "reflection-about-passage",
            "source": {"kind": "node", "node_id": "reflection-1"},
            "target": {"kind": "node", "node_id": "passage-1"},
            "family": "semantic",
            "relation": "questions",
            "explanation": "An explicit private authoring hypothesis.",
            "access_scopes": ["author:private"],
            "provenance": ["rust narrative graph test"]
        }, {
            "id": "passage-private-signal",
            "source": {"kind": "node", "node_id": "passage-1"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "process",
                "anchor_id": "mara.private_signal"
            },
            "family": "grounding",
            "relation": "expresses",
            "explanation": "A multi-scoped edge must not make a private anchor visible through its other scope.",
            "access_scopes": ["private-owner", "editor"],
            "provenance": ["rust narrative graph test"]
        }]
    })
}

fn state_path(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "life-sim-{label}-{}-{nonce}.sqlite",
        std::process::id()
    ))
}

fn register_test_model(session: &mut MachineSession, id: &str) -> String {
    let mut definition = model();
    definition["id"] = json!(id);
    let registered = execute(
        session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": definition
        }),
    );
    registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn story_node(id: &str, text: String) -> Value {
    json!({
        "id": id,
        "node_type": "paragraph",
        "role": "story_passage",
        "text": text,
        "epistemic_status": "fictional_canon",
        "evidence_type": "fictional_canon",
        "authority": {"source": "author", "weight": 1.0},
        "render": "include",
        "training": "include",
        "provenance": ["SQLite narrative persistence test"]
    })
}

fn story_edge(id: &str, target: &str, order: u64) -> Value {
    json!({
        "id": id,
        "source": {"kind": "node", "node_id": "root"},
        "target": {"kind": "node", "node_id": target},
        "family": "structural",
        "relation": "contains",
        "order": order,
        "provenance": ["SQLite narrative persistence test"]
    })
}

fn root_story_graph(
    model_hash: &str,
    graph_id: &str,
    nodes: Vec<Value>,
    edges: Vec<Value>,
) -> Value {
    let mut all_nodes = vec![json!({
        "id": "root",
        "node_type": "short_story",
        "role": "document_root",
        "epistemic_status": "fictional_artifact",
        "evidence_type": "fictional_canon",
        "render": "exclude",
        "training": "exclude",
        "provenance": ["SQLite narrative persistence test"]
    })];
    all_nodes.extend(nodes);
    json!({
        "schema": "life-sim-rust-narrative-graph/v1",
        "id": graph_id,
        "revision": {
            "number": 0,
            "reason": "Root narrative revision.",
            "provenance": ["SQLite narrative persistence test"]
        },
        "source": {"kind": "model", "model_hash": model_hash},
        "roots": ["root"],
        "nodes": all_nodes,
        "edges": edges
    })
}

fn append_story_nodes(
    session: &mut MachineSession,
    previous_graph_hash: &str,
    nodes: Vec<Value>,
    edges: Vec<Value>,
) -> Value {
    execute(
        session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "apply_narrative_batch",
            "narrative_batch": {
                "schema": "life-sim-rust-narrative-batch/v1",
                "previous_graph_hash": previous_graph_hash,
                "reason": "Append connected narrative material.",
                "provenance": ["SQLite narrative persistence test"],
                "add_nodes": nodes,
                "add_edges": edges
            }
        }),
    )
}

#[test]
fn narrative_node_uncertainty_rejects_invalid_values() {
    let definition: NarrativeGraphDefinition = serde_json::from_value(root_story_graph(
        &"a".repeat(64),
        "uncertainty-validation",
        vec![],
        vec![],
    ))
    .unwrap();
    let mut invalid = vec![
        (
            ClaimUncertainty::StandardDeviation { value: -0.1 },
            "narrative node root uncertainty is negative",
        ),
        (
            ClaimUncertainty::Interval {
                lower: 1.0,
                upper: 0.0,
            },
            "narrative node root uncertainty interval is reversed",
        ),
    ];
    for value in [f64::NAN, f64::NEG_INFINITY, f64::INFINITY] {
        invalid.extend([
            (
                ClaimUncertainty::StandardDeviation { value },
                "narrative node root uncertainty must be finite",
            ),
            (
                ClaimUncertainty::Interval {
                    lower: value,
                    upper: 1.0,
                },
                "narrative node root uncertainty lower must be finite",
            ),
            (
                ClaimUncertainty::Interval {
                    lower: 0.0,
                    upper: value,
                },
                "narrative node root uncertainty upper must be finite",
            ),
        ]);
    }
    for (uncertainty, expected_error) in invalid {
        let mut graph = definition.clone();
        graph.nodes[0].uncertainty = uncertainty;
        let error = compile_narrative_graph(graph).unwrap_err();
        assert_eq!(error.to_string(), expected_error);
    }
}

#[test]
fn narrative_node_uncertainty_preserves_valid_values() {
    let definition: NarrativeGraphDefinition = serde_json::from_value(root_story_graph(
        &"a".repeat(64),
        "uncertainty-validation",
        vec![],
        vec![],
    ))
    .unwrap();
    for uncertainty in [
        ClaimUncertainty::Unknown,
        ClaimUncertainty::Exact,
        ClaimUncertainty::StandardDeviation { value: 0.0 },
        ClaimUncertainty::StandardDeviation { value: 0.1 },
        ClaimUncertainty::Interval {
            lower: -1.0,
            upper: 1.0,
        },
        ClaimUncertainty::Interval {
            lower: 0.0,
            upper: 0.0,
        },
    ] {
        let mut graph = definition.clone();
        graph.nodes[0].uncertainty = uncertainty.clone();
        let compiled = compile_narrative_graph(graph).unwrap();
        assert_eq!(compiled.nodes["root"].uncertainty, uncertainty);
        assert_eq!(compiled.definition.nodes[0].uncertainty, uncertainty);
    }
}

#[test]
fn project_checkpoints_preserve_document_only_and_graph_backed_saves_across_restart() {
    let state_file = state_path("project-checkpoints");
    let mut session = MachineSession::with_state_file(&state_file).unwrap();
    let model_hash = register_test_model(&mut session, "checkpoint-story-model");
    execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "reused-human-world-id"
        }),
    );
    for (seed, roll_index) in [("checkpoint-lineage-one", 0), ("checkpoint-lineage-two", 1)] {
        let rolled = execute(
            &mut session,
            json!({
                "schema": "life-sim-rust-command/v1",
                "operation": "roll_world",
                "world_id": "reused-human-world-id",
                "query": {
                    "schema": "life-sim-rust-model-query/v1",
                    "delta_time": 1.0,
                    "step_size": 0.25,
                    "seed": seed,
                    "roll_index": roll_index,
                    "path": {"mode": "decimated", "every": 2}
                }
            }),
        );
        execute(
            &mut session,
            json!({
                "schema": "life-sim-rust-command/v1",
                "operation": "commit_candidate",
                "candidate_hash": rolled["candidate"]["candidate_hash"]
            }),
        );
    }
    let final_world = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "get_world",
            "world_id": "reused-human-world-id"
        }),
    );
    let world_hash = final_world["world_hash"].as_str().unwrap().to_owned();
    let mut root_definition = root_story_graph(
        &model_hash,
        "checkpoint-story-graph",
        vec![story_node(
            "passage",
            "The graph-backed edition.".to_owned(),
        )],
        vec![story_edge("root-passage", "passage", 0)],
    );
    root_definition["edges"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id": "passage-grounds-trust",
            "source": {"kind": "node", "node_id": "passage"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "process",
                "anchor_id": "mara.trust",
                "path": "/initial_value/value"
            },
            "family": "grounding",
            "relation": "expresses",
            "provenance": ["rust project checkpoint integration test"]
        }));
    root_definition["source"] = json!({
        "kind": "world",
        "world_id": "reused-human-world-id",
        "world_hash": world_hash
    });
    let graph = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": root_definition
        }),
    );
    let graph_hash = graph["summary"]["graph_hash"].as_str().unwrap().to_owned();

    let first = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "v1",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown; charset=utf-8",
                    "content": {"encoding": "utf8", "text": "# External Version One\n\nCanonical prose.\n"},
                    "canonical_external_path": "experiments/story-v1/story.md"
                },
                "reason": "Preserve the external Markdown as an exact portable copy.",
                "provenance": ["rust project checkpoint integration test"]
            }
        }),
    );
    assert_eq!(first["checkpoint_sequence"], 0);
    assert_eq!(
        first["document"]["canonical_external_path"],
        "experiments/story-v1/story.md"
    );
    let first_hash = first["checkpoint_hash"].as_str().unwrap().to_owned();

    let hash_named = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": first_hash,
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown; charset=utf-8",
                    "content": {"encoding": "utf8", "text": "# Ambiguous checkpoint name\n"}
                },
                "reason": "A human-facing name must not collide with the hash namespace."
            }
        })
        .to_string(),
    );
    assert!(!hash_named.ok);
    assert_eq!(hash_named.error.as_ref().unwrap().code, "invalid_request");
    assert!(hash_named
        .error
        .unwrap()
        .message
        .contains("not a 64-character hexadecimal hash"));

    let uppercase_hash_named = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown; charset=utf-8",
                    "content": {"encoding": "utf8", "text": "# Uppercase ambiguous name\n"}
                }
            }
        })
        .to_string(),
    );
    assert!(!uppercase_hash_named.ok);

    let first_by_hash = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "get_project_checkpoint",
            "project_checkpoint_id": first_hash
        }),
    );
    assert_eq!(first_by_hash["checkpoint_hash"], first["checkpoint_hash"]);
    assert_eq!(first_by_hash["name"], "v1");

    let second = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "v4",
                "parent_checkpoint": first_hash,
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown; charset=utf-8",
                    "content": {"encoding": "utf8", "text": "# Graph Version Four\n\nThe graph-backed edition.\n"},
                    "canonical_external_path": "experiments/story-v4/story.md"
                },
                "model_hash": model_hash,
                "world_hash": world_hash,
                "narrative_graph_hash": graph_hash,
                "reason": "Bind canonical prose to frozen executable state.",
                "provenance": ["rust project checkpoint integration test"]
            }
        }),
    );
    assert_eq!(second["checkpoint_sequence"], 1);
    assert_eq!(second["parent_checkpoint_hash"], first_hash);

    let inferred_model = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "v5-inferred-model",
                "parent_checkpoint": "v4",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown; charset=utf-8",
                    "content": {"encoding": "utf8", "text": "# Version Five\n\nInfer the graph's required model.\n"}
                },
                "narrative_graph_hash": graph_hash,
                "reason": "A graph reference automatically captures its required model.",
                "provenance": ["rust project checkpoint integration test"]
            }
        }),
    );
    assert_eq!(inferred_model["checkpoint_sequence"], 2);
    assert_eq!(inferred_model["model_hash"], model_hash);

    let listing = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "list_project_checkpoints"
        }),
    );
    assert_eq!(listing["checkpoint_count"], 3);
    assert_eq!(listing["checkpoints"][0]["name"], "v1");
    assert_eq!(listing["checkpoints"][1]["name"], "v4");
    assert_eq!(listing["checkpoints"][2]["name"], "v5-inferred-model");

    let document_render = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_project_checkpoint",
            "project_checkpoint_id": "v1"
        }),
    );
    assert_eq!(
        document_render["content"]["text"],
        "# External Version One\n\nCanonical prose.\n"
    );
    assert_eq!(
        document_render["canonical_external_path"],
        "experiments/story-v1/story.md"
    );

    let graph_render = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_project_checkpoint",
            "project_checkpoint_id": "v4",
            "narrative_render": {
                "expected_graph_hash": graph_hash
            }
        }),
    );
    assert_eq!(graph_render["text"], "The graph-backed edition.");
    let skeleton = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_project_checkpoint_graph",
            "project_checkpoint_id": "v4",
            "narrative_query": {
                "mode": "skeleton",
                "expected_graph_hash": graph_hash
            }
        }),
    );
    assert_eq!(skeleton["mode"], "skeleton");
    let first_export = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_project_checkpoint",
            "project_checkpoint_id": "v1"
        }),
    );
    let second_export = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_project_checkpoint",
            "project_checkpoint_id": "v4"
        }),
    );
    assert!(second_export["project_checkpoint"]["narrative_graph_snapshot"].is_null());
    assert!(second_export["project_checkpoint"]["model_snapshot"].is_null());
    assert!(second_export["project_checkpoint"]["world_snapshot"].is_null());
    let portable_model_json = second_export["project_checkpoint"]["model_snapshot_json"]
        .as_str()
        .expect("portable model export uses lossless nested JSON text");
    let portable_world_json = second_export["project_checkpoint"]["world_snapshot_json"]
        .as_str()
        .expect("portable world export uses lossless nested JSON text");
    let portable_world: Value = serde_json::from_str(portable_world_json).unwrap();
    assert_eq!(portable_world["world_hash"], world_hash);
    assert_eq!(
        serde_json::from_str::<Value>(portable_model_json).unwrap()["id"],
        "checkpoint-story-model"
    );
    assert_eq!(
        second_export["project_checkpoint"]["narrative_graph_snapshot_hash"],
        second["narrative_graph_snapshot_hash"]
    );
    let portable_graph_json = second_export["project_checkpoint"]["narrative_graph_snapshot_json"]
        .as_str()
        .expect("portable graph export uses lossless nested JSON text");
    let portable_graph: Value = serde_json::from_str(portable_graph_json).unwrap();
    assert_eq!(portable_graph["graph_hash"], graph_hash);
    assert_eq!(
        portable_graph["snapshot"]["candidate_anchors"]
            .as_object()
            .unwrap()
            .len(),
        2
    );
    let mut imported_project = MachineSession::default();
    let imported_first = execute(
        &mut imported_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": first_export["project_checkpoint"]
        }),
    );
    let imported_second = execute(
        &mut imported_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": second_export["project_checkpoint"]
        }),
    );
    assert_eq!(imported_first["checkpoint_hash"], first["checkpoint_hash"]);
    assert_eq!(
        imported_second["checkpoint_hash"],
        second["checkpoint_hash"]
    );
    let imported_graph_render = execute(
        &mut imported_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_project_checkpoint",
            "project_checkpoint_id": "v4",
            "narrative_render": {"expected_graph_hash": graph_hash}
        }),
    );
    assert_eq!(imported_graph_render["text"], "The graph-backed edition.");

    let mut forged_graph: StoredNarrativeGraph = serde_json::from_str(portable_graph_json).unwrap();
    forged_graph.snapshot.candidate_status = Some("forged".to_owned());
    forged_graph.snapshot_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&forged_graph.snapshot).unwrap())
    );
    let mut forged_definition = second_export["project_checkpoint"].clone();
    forged_definition["name"] = json!("v4-forged-source");
    forged_definition["narrative_graph_snapshot_hash"] = Value::Null;
    forged_definition["narrative_graph_snapshot_json"] =
        json!(serde_json::to_string(&forged_graph).unwrap());
    let forged = imported_project.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": forged_definition
        })
        .to_string(),
    );
    assert!(!forged.ok);
    assert!(forged
        .error
        .unwrap()
        .message
        .contains("source and frozen source snapshot do not match"));
    let original_after_forgery = execute(
        &mut imported_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_project_checkpoint_graph",
            "project_checkpoint_id": "v4",
            "narrative_query": {
                "mode": "full",
                "include_content": false,
                "expected_graph_hash": graph_hash
            }
        }),
    );
    assert_eq!(
        original_after_forgery["source_snapshot_hash"],
        portable_graph["snapshot_hash"]
    );

    let mut non_head_forgery: StoredNarrativeGraph =
        serde_json::from_str(portable_graph_json).unwrap();
    let lineage_head = portable_world["lineage_head"].as_str().unwrap();
    let non_head = non_head_forgery
        .snapshot
        .candidate_anchors
        .keys()
        .find(|candidate_hash| candidate_hash.as_str() != lineage_head)
        .cloned()
        .expect("two-candidate fixture has a non-head anchor");
    non_head_forgery
        .snapshot
        .candidate_anchors
        .get_mut(&non_head)
        .unwrap()["seed"] = json!("forged-non-head-seed");
    non_head_forgery.snapshot_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&non_head_forgery.snapshot).unwrap())
    );
    let mut non_head_definition = second_export["project_checkpoint"].clone();
    non_head_definition["name"] = json!("v4-forged-non-head");
    non_head_definition["narrative_graph_snapshot_hash"] = Value::Null;
    non_head_definition["narrative_graph_snapshot_json"] =
        json!(serde_json::to_string(&non_head_forgery).unwrap());
    let rejected_non_head = imported_project.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": non_head_definition
        })
        .to_string(),
    );
    assert!(!rejected_non_head.ok);
    assert!(rejected_non_head
        .error
        .unwrap()
        .message
        .contains("stale query or dynamics binding"));

    let mut path_forgery: StoredNarrativeGraph = serde_json::from_str(portable_graph_json).unwrap();
    path_forgery
        .snapshot
        .candidate_anchors
        .get_mut(&non_head)
        .unwrap()["path"]["samples"][1]["state"]["mara.trust"]["value"] = json!(0.59);
    path_forgery.snapshot_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&path_forgery.snapshot).unwrap())
    );
    let mut path_definition = second_export["project_checkpoint"].clone();
    path_definition["name"] = json!("v4-forged-retained-path");
    path_definition["narrative_graph_snapshot_hash"] = Value::Null;
    path_definition["narrative_graph_snapshot_json"] =
        json!(serde_json::to_string(&path_forgery).unwrap());
    let rejected_path = imported_project.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": path_definition
        })
        .to_string(),
    );
    assert!(!rejected_path.ok);
    assert!(rejected_path
        .error
        .unwrap()
        .message
        .contains("does not match deterministic replay"));

    let mut anchor_forgery: StoredNarrativeGraph =
        serde_json::from_str(portable_graph_json).unwrap();
    let mut forged_graph_definition = serde_json::to_value(&anchor_forgery.definition).unwrap();
    let grounding_edge = forged_graph_definition["edges"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|edge| edge["id"] == "passage-grounds-trust")
        .expect("fixture includes a process anchor");
    grounding_edge["target"]["anchor_id"] = json!("forged.missing.process");
    anchor_forgery.definition = serde_json::from_value(forged_graph_definition).unwrap();
    anchor_forgery.graph_hash = compile_narrative_graph(anchor_forgery.definition.clone())
        .unwrap()
        .graph_hash;
    let mut anchor_definition = second_export["project_checkpoint"].clone();
    anchor_definition["name"] = json!("v4-forged-missing-anchor");
    anchor_definition["narrative_graph_hash"] = json!(anchor_forgery.graph_hash);
    anchor_definition["narrative_graph_snapshot_hash"] = Value::Null;
    anchor_definition["narrative_graph_snapshot_json"] =
        json!(serde_json::to_string(&anchor_forgery).unwrap());
    let rejected_anchor = imported_project.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": anchor_definition
        })
        .to_string(),
    );
    assert!(!rejected_anchor.ok);
    assert!(rejected_anchor
        .error
        .unwrap()
        .message
        .contains("unknown or source-incompatible Process anchor forged.missing.process"));
    drop(session);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    let restored_listing = execute(
        &mut restored,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "list_project_checkpoints"
        }),
    );
    assert_eq!(restored_listing, listing);
    let restored_document = execute(
        &mut restored,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_project_checkpoint",
            "project_checkpoint_id": first_hash
        }),
    );
    assert_eq!(
        restored_document["content"]["text"],
        document_render["content"]["text"]
    );
    assert_eq!(
        restored_document["canonical_external_path"],
        "experiments/story-v1/story.md"
    );
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn portable_project_snapshots_preserve_lossless_model_and_world_numbers() {
    const LARGE_REVISION: u64 = 9_007_199_254_740_993;
    const LARGE_WORLD_VERSION: u64 = 9_007_199_254_740_995;

    #[derive(Serialize)]
    struct TestWorldFingerprint<'a> {
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

    let mut definition = model();
    definition["id"] = json!("lossless-project-model");
    definition["revision"] = json!({
        "number": LARGE_REVISION,
        "previous_model_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "reason": "Exercise lossless portable project snapshots.",
        "provenance": ["rust lossless project snapshot test"]
    });
    definition["meaning_model"]["realizations"] = json!([{
        "id": "realization.lossless",
        "concept_id": "disclosure",
        "purpose": "describe",
        "roles": {"subject": "mara-discloses"},
        "parameters": {
            "large_integer": LARGE_REVISION,
            "lexical_float": 9.0
        },
        "degree": -0.0,
        "uncertainty": {"kind": "exact"},
        "provenance": ["rust lossless project snapshot test"],
        "viewpoint": "test"
    }]);
    let compiled = compile_model(serde_json::from_value(definition).unwrap()).unwrap();
    let mut world = compiled.genesis_world("lossless-project-world").unwrap();
    world.version = LARGE_WORLD_VERSION;
    world.time = -0.0;
    let fingerprint = TestWorldFingerprint {
        schema: "life-sim-rust-world-head/v1",
        model_hash: &world.model_hash,
        model_revision: world.model_revision,
        world_id: &world.world_id,
        version: world.version,
        time: world.time,
        state: &world.state,
        claims: &world.claims,
        lineage_head: &world.lineage_head,
    };
    world.world_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&fingerprint).unwrap())
    );
    let model_snapshot_json = serde_json::to_string(compiled.definition()).unwrap();
    let world_snapshot_json = serde_json::to_string(&world).unwrap();
    assert!(model_snapshot_json.contains("\"number\":9007199254740993"));
    assert!(model_snapshot_json.contains("\"large_integer\":9007199254740993"));
    assert!(model_snapshot_json.contains("\"lexical_float\":9.0"));
    assert!(model_snapshot_json.contains("\"degree\":-0.0"));
    assert!(world_snapshot_json.contains("\"model_revision\":9007199254740993"));
    assert!(world_snapshot_json.contains("\"version\":9007199254740995"));
    assert!(world_snapshot_json.contains("\"time\":-0.0"));

    let mut source = MachineSession::default();
    let checkpoint = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "lossless-numbers",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/plain",
                    "content": {"encoding": "utf8", "text": "Lossless numbers.\n"}
                },
                "model_hash": compiled.model_hash,
                "world_hash": world.world_hash,
                "model_snapshot_json": model_snapshot_json,
                "world_snapshot_json": world_snapshot_json
            }
        }),
    );
    let exported = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_project_checkpoint",
            "project_checkpoint_id": "lossless-numbers"
        }),
    );
    let portable = &exported["project_checkpoint"];
    assert!(portable["model_snapshot"].is_null());
    assert!(portable["world_snapshot"].is_null());
    assert!(portable["model_snapshot_json"]
        .as_str()
        .unwrap()
        .contains("\"large_integer\":9007199254740993"));
    assert!(portable["model_snapshot_json"]
        .as_str()
        .unwrap()
        .contains("\"degree\":-0.0"));
    assert!(portable["world_snapshot_json"]
        .as_str()
        .unwrap()
        .contains("\"version\":9007199254740995"));
    assert!(portable["world_snapshot_json"]
        .as_str()
        .unwrap()
        .contains("\"time\":-0.0"));

    let mut imported = MachineSession::default();
    let imported_checkpoint = execute(
        &mut imported,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": portable
        }),
    );
    assert_eq!(
        imported_checkpoint["checkpoint_hash"],
        checkpoint["checkpoint_hash"]
    );

    let mut ambiguous_model = portable.clone();
    ambiguous_model["name"] = json!("ambiguous-model-snapshot");
    ambiguous_model["model_snapshot"] =
        serde_json::from_str(ambiguous_model["model_snapshot_json"].as_str().unwrap()).unwrap();
    let rejected_model = imported.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": ambiguous_model
        })
        .to_string(),
    );
    assert!(!rejected_model.ok);
    assert!(rejected_model
        .error
        .unwrap()
        .message
        .contains("at most one model snapshot representation"));

    let mut ambiguous_world = portable.clone();
    ambiguous_world["name"] = json!("ambiguous-world-snapshot");
    ambiguous_world["world_snapshot"] =
        serde_json::from_str(ambiguous_world["world_snapshot_json"].as_str().unwrap()).unwrap();
    let rejected_world = imported.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": ambiguous_world
        })
        .to_string(),
    );
    assert!(!rejected_world.ok);
    assert!(rejected_world
        .error
        .unwrap()
        .message
        .contains("at most one world snapshot representation"));
}

#[test]
fn imported_project_snapshots_allow_reused_domain_ids_without_active_namespace_collision() {
    let mut first_source = MachineSession::default();
    let first_model = model();
    let first_registered = execute(
        &mut first_source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": first_model
        }),
    );
    let first_model_hash = first_registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_world = execute(
        &mut first_source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": first_model_hash,
            "world_id": "historically-reused-world"
        }),
    );
    let first_world_snapshot = json!({
        "schema": "life-sim-rust-world-head/v1",
        "model_hash": first_world["model_hash"],
        "model_revision": first_world["model_revision"],
        "world_id": first_world["world_id"],
        "version": first_world["version"],
        "time": first_world["time"],
        "state": {
            "mara.trust": {"kind": "scalar", "value": 0.58},
            "mara.private_signal": {"kind": "scalar", "value": 0.2}
        },
        "claims": {},
        "lineage_head": first_world["lineage_head"],
        "world_hash": first_world["world_hash"]
    });

    let mut second_source = MachineSession::default();
    let mut second_model = model();
    second_model["processes"][0]["initial_value"]["value"] = json!(0.61);
    let second_registered = execute(
        &mut second_source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": second_model
        }),
    );
    let second_model_hash = second_registered["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let second_world = execute(
        &mut second_source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": second_model_hash,
            "world_id": "historically-reused-world"
        }),
    );
    let second_world_snapshot = json!({
        "schema": "life-sim-rust-world-head/v1",
        "model_hash": second_world["model_hash"],
        "model_revision": second_world["model_revision"],
        "world_id": second_world["world_id"],
        "version": second_world["version"],
        "time": second_world["time"],
        "state": {
            "mara.trust": {"kind": "scalar", "value": 0.61},
            "mara.private_signal": {"kind": "scalar", "value": 0.2}
        },
        "claims": {},
        "lineage_head": second_world["lineage_head"],
        "world_hash": second_world["world_hash"]
    });
    assert_ne!(first_model_hash, second_model_hash);
    assert_ne!(first_world["world_hash"], second_world["world_hash"]);

    let state_file = state_path("project-import-collisions");
    let mut project = MachineSession::with_state_file(&state_file).unwrap();
    let first = execute(
        &mut project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "historical-a",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown",
                    "content": {"encoding": "utf8", "text": "# Historical A\n"},
                    "canonical_external_path": "historical-a/story.md"
                },
                "model_hash": first_model_hash,
                "world_hash": first_world["world_hash"],
                "model_snapshot": model(),
                "world_snapshot": first_world_snapshot,
                "provenance": ["rust project import collision test"]
            }
        }),
    );
    execute(
        &mut project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "historical-b",
                "parent_checkpoint": first["checkpoint_hash"],
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown",
                    "content": {"encoding": "utf8", "text": "# Historical B\n"},
                    "canonical_external_path": "historical-b/story.md"
                },
                "model_hash": second_model_hash,
                "world_hash": second_world["world_hash"],
                "model_snapshot": second_model,
                "world_snapshot": second_world_snapshot,
                "provenance": ["rust project import collision test"]
            }
        }),
    );
    drop(project);

    let connection = Connection::open(&state_file).unwrap();
    let active_world_count: i64 = connection
        .query_row("SELECT count(*) FROM worlds", [], |row| row.get(0))
        .unwrap();
    let project_model_count: i64 = connection
        .query_row("SELECT count(*) FROM project_model_snapshots", [], |row| {
            row.get(0)
        })
        .unwrap();
    let project_world_count: i64 = connection
        .query_row("SELECT count(*) FROM project_world_snapshots", [], |row| {
            row.get(0)
        })
        .unwrap();
    let reused_world_id_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM project_world_snapshots WHERE world_id = 'historically-reused-world'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(active_world_count, 0);
    assert_eq!(project_model_count, 2);
    assert_eq!(project_world_count, 2);
    assert_eq!(reused_world_id_count, 2);
    drop(connection);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    let listing = execute(
        &mut restored,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "list_project_checkpoints"
        }),
    );
    assert_eq!(listing["checkpoint_count"], 2);
    assert_eq!(listing["checkpoints"][0]["name"], "historical-a");
    assert_eq!(listing["checkpoints"][1]["name"], "historical-b");
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn rust_owns_graph_native_story_reflection_render_revision_and_training() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-narrative-graph-{}-{nonce}.sqlite",
        std::process::id()
    ));
    let mut session = MachineSession::with_state_file(&state_file).unwrap();
    let registered_model = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": model()
        }),
    );
    let model_hash = registered_model["summary"]["model_hash"].as_str().unwrap();
    let world = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "story-world"
        }),
    );
    let world_hash = world["world_hash"].as_str().unwrap();
    let first_root_only = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": {
                "schema": "life-sim-rust-narrative-graph/v1",
                "id": "first-root-only",
                "revision": {
                    "number": 0,
                    "reason": "The first rooted node may stand alone.",
                    "provenance": ["rust narrative graph batch test"]
                },
                "source": {
                    "kind": "world",
                    "world_id": "story-world",
                    "world_hash": world_hash
                },
                "roots": ["root"],
                "nodes": [{
                    "id": "root",
                    "node_type": "document",
                    "role": "document_root",
                    "epistemic_status": "fictional_artifact",
                    "evidence_type": "fictional_canon",
                    "provenance": ["rust narrative graph batch test"]
                }],
                "edges": []
            }
        }),
    );
    assert_eq!(first_root_only["summary"]["node_count"], 1);
    let rejected_unrooted = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": {
                "schema": "life-sim-rust-narrative-graph/v1",
                "id": "unrooted-first-node",
                "revision": {
                    "number": 0,
                    "reason": "An unrooted first node must fail.",
                    "provenance": ["rust narrative graph batch test"]
                },
                "source": {
                    "kind": "world",
                    "world_id": "story-world",
                    "world_hash": world_hash
                },
                "roots": [],
                "nodes": [{
                    "id": "orphan",
                    "node_type": "paragraph",
                    "role": "metadata",
                    "epistemic_status": "draft",
                    "evidence_type": "creative_hypothesis",
                    "provenance": ["rust narrative graph batch test"]
                }],
                "edges": []
            }
        })
        .to_string(),
    );
    assert!(!rejected_unrooted.ok);
    assert!(rejected_unrooted
        .error
        .unwrap()
        .message
        .contains("must reach a declared root or stable anchor"));
    let first_text = "Mara watched Jonas wait, and trusted the silence enough to speak.";
    let mut unsafe_reflection = graph(world_hash, 0, None, first_text);
    unsafe_reflection["nodes"][2]
        .as_object_mut()
        .unwrap()
        .remove("access_scopes");
    let rejected = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": unsafe_reflection
        })
        .to_string(),
    );
    assert!(!rejected.ok);
    assert!(rejected
        .error
        .unwrap()
        .message
        .contains("requires an explicit access scope"));
    let mut unsafe_anchor = graph(world_hash, 0, None, first_text);
    unsafe_anchor["edges"][1]["target"]["path"] = json!("/does/not/exist");
    let rejected = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": unsafe_anchor
        })
        .to_string(),
    );
    assert!(!rejected.ok);
    assert!(rejected
        .error
        .unwrap()
        .message
        .contains("unresolved subpath"));
    let mut registered_graph = graph(world_hash, 0, None, first_text);
    registered_graph["roots"] = json!(["document", "reflection-1"]);
    let registered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": registered_graph
        }),
    );
    let graph_hash = registered["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(registered["summary"]["node_count"], 3);

    let public = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_query": {"mode": "full", "include_content": true}
        }),
    );
    assert_eq!(public["returned_node_count"], 2);
    assert_eq!(public["returned_edge_count"], 6);
    assert!(public["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .all(|node| node["id"] != "reflection-1"));

    let editor = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_query": {
                "mode": "full",
                "include_content": false,
                "access_scopes": ["editor"]
            }
        }),
    );
    assert!(editor["edges"]
        .as_array()
        .unwrap()
        .iter()
        .all(|edge| edge["id"] != "passage-private-signal"));
    let private_owner = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_query": {
                "mode": "full",
                "include_content": false,
                "access_scopes": ["private-owner"]
            }
        }),
    );
    assert!(private_owner["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|edge| edge["id"] == "passage-private-signal"));

    let private = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_query": {
                "mode": "neighborhood",
                "center_node_id": "reflection-1",
                "depth": 1,
                "include_content": true,
                "access_scopes": ["author:private"]
            }
        }),
    );
    assert_eq!(private["returned_node_count"], 3);

    let publicly_rendered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_render": {}
        }),
    );
    assert_eq!(publicly_rendered["roots"], json!(["document"]));
    assert_eq!(publicly_rendered["sequence"], json!(["passage-1"]));
    let inaccessible_explicit_root = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_render": {"root_ids": ["reflection-1"]}
        })
        .to_string(),
    );
    assert!(!inaccessible_explicit_root.ok);

    let rendered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": graph_hash,
            "narrative_render": {"access_scopes": ["author:private"]}
        }),
    );
    assert_eq!(rendered["text"], first_text);
    assert_eq!(rendered["sequence"], json!(["passage-1"]));
    assert_eq!(rendered["roots"], json!(["document", "reflection-1"]));

    let exported = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_narrative_training",
            "narrative_graph_hash": graph_hash,
            "narrative_training": {
                "access_scopes": [],
                "include_linked_values": true,
                "require_accepted_history": true
            }
        }),
    );
    assert_eq!(exported["record_count"], 1);
    assert_eq!(
        exported["records"][0]["record"]["linked_values"]["mara.trust"],
        json!({"kind": "scalar", "value": 0.58})
    );
    let exported_again = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_narrative_training",
            "narrative_graph_hash": graph_hash,
            "narrative_training": {
                "access_scopes": [],
                "include_linked_values": true,
                "require_accepted_history": true
            }
        }),
    );
    assert_eq!(exported["export_hash"], exported_again["export_hash"]);

    let revised_text = "Mara watched Jonas wait. Trust moved before language; she spoke.";
    let revised = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "revise_narrative_graph",
            "narrative_graph": graph(world_hash, 1, Some(&graph_hash), revised_text)
        }),
    );
    let revised_hash = revised["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_ne!(graph_hash, revised_hash);

    let second_text = "Jonas answered slowly, making the new truth part of their shared history.";
    let passage_two = json!({
        "id": "passage-2",
        "node_type": "paragraph",
        "role": "story_passage",
        "text": second_text,
        "epistemic_status": "fictional_canon",
        "evidence_type": "fictional_canon",
        "authority": {"source": "author", "weight": 1.0},
        "render": "include",
        "training": "include",
        "provenance": ["rust narrative graph batch test"]
    });
    let rejected_orphan = session.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "apply_narrative_batch",
            "narrative_batch": {
                "schema": "life-sim-rust-narrative-batch/v1",
                "previous_graph_hash": revised_hash,
                "reason": "An orphan must fail atomically.",
                "provenance": ["rust narrative graph batch test"],
                "add_nodes": [passage_two.clone()]
            }
        })
        .to_string(),
    );
    assert!(!rejected_orphan.ok);
    assert!(rejected_orphan
        .error
        .unwrap()
        .message
        .contains("unconnected new-node component"));

    let appended = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "apply_narrative_batch",
            "narrative_batch": {
                "schema": "life-sim-rust-narrative-batch/v1",
                "previous_graph_hash": revised_hash,
                "reason": "Append one connected story node atomically.",
                "provenance": ["rust narrative graph batch test"],
                "add_nodes": [passage_two],
                "add_edges": [{
                    "id": "document-contains-passage-2",
                    "source": {"kind": "node", "node_id": "document"},
                    "target": {"kind": "node", "node_id": "passage-2"},
                    "family": "structural",
                    "relation": "contains",
                    "order": 1,
                    "provenance": ["rust narrative graph batch test"]
                }]
            }
        }),
    );
    let appended_hash = appended["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(appended["summary"]["revision"]["number"], 2);
    assert_eq!(appended["batch"]["added_node_count"], 1);
    assert_eq!(appended["batch"]["added_edge_count"], 1);
    let rendered_appended = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": appended_hash,
            "narrative_render": {}
        }),
    );
    assert_eq!(
        rendered_appended["text"],
        format!("{revised_text}\n\n{second_text}")
    );
    let unchanged_previous = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": revised_hash,
            "narrative_render": {}
        }),
    );
    assert_eq!(unchanged_previous["text"], revised_text);
    drop(session);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    let rendered_after_restart = execute(
        &mut restored,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": appended_hash,
            "narrative_render": {}
        }),
    );
    assert_eq!(
        rendered_after_restart["text"],
        format!("{revised_text}\n\n{second_text}")
    );
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn candidate_anchor_material_is_frozen_across_retention_upgrades() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let state_file = std::env::temp_dir().join(format!(
        "life-sim-candidate-anchor-{}-{nonce}.sqlite",
        std::process::id()
    ));
    let mut session = MachineSession::with_state_file(&state_file).unwrap();
    let registered_model = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": model()
        }),
    );
    let model_hash = registered_model["summary"]["model_hash"].as_str().unwrap();
    let world = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "story-world"
        }),
    );
    let world_hash = world["world_hash"].as_str().unwrap();
    let endpoint_query = json!({
        "schema": "life-sim-rust-model-query/v1",
        "delta_time": 1.0,
        "step_size": 0.5,
        "seed": "candidate-anchor-freeze",
        "path": {"mode": "endpoint"}
    });
    let rolled = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "story-world",
            "query": endpoint_query
        }),
    );
    let candidate_hash = rolled["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut candidate_graph = graph(
        world_hash,
        0,
        None,
        "Mara considered one possible continuation.",
    );
    candidate_graph["source"] = json!({
        "kind": "candidate",
        "candidate_hash": candidate_hash
    });
    candidate_graph["edges"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id": "passage-inspects-candidate-retention",
            "source": {"kind": "node", "node_id": "passage-1"},
            "target": {
                "kind": "anchor",
                "anchor_kind": "candidate",
                "anchor_id": candidate_hash,
                "path": "/path/retention/mode"
            },
            "family": "provenance",
            "relation": "derived_from",
            "provenance": ["rust candidate anchor freeze test"]
        }));
    let registered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": candidate_graph
        }),
    );
    let narrative_hash = registered["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let snapshot_hash = registered["snapshot_hash"].as_str().unwrap().to_owned();

    let pending_checkpoint = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "candidate-pending",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/markdown",
                    "content": {"encoding": "utf8", "text": "Candidate pending.\n"}
                },
                "narrative_graph_hash": narrative_hash
            }
        }),
    );
    let pending_export = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_project_checkpoint",
            "project_checkpoint_id": pending_checkpoint["checkpoint_hash"]
        }),
    );
    let mut committed_graph: StoredNarrativeGraph = serde_json::from_str(
        pending_export["project_checkpoint"]["narrative_graph_snapshot_json"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        committed_graph.snapshot.candidate_status.as_deref(),
        Some("pending")
    );
    committed_graph.snapshot.candidate_status = Some("committed".to_owned());
    committed_graph.snapshot_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&committed_graph.snapshot).unwrap())
    );
    let mut committed_definition = pending_export["project_checkpoint"].clone();
    committed_definition["name"] = json!("candidate-committed");
    committed_definition["parent_checkpoint"] = pending_checkpoint["checkpoint_hash"].clone();
    committed_definition["narrative_graph_snapshot_hash"] = Value::Null;
    committed_definition["narrative_graph_snapshot_json"] =
        json!(serde_json::to_string(&committed_graph).unwrap());

    let mut two_snapshot_project = MachineSession::default();
    let imported_pending = execute(
        &mut two_snapshot_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": pending_export["project_checkpoint"]
        }),
    );
    committed_definition["parent_checkpoint"] = imported_pending["checkpoint_hash"].clone();
    let imported_committed = execute(
        &mut two_snapshot_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": committed_definition
        }),
    );
    assert_eq!(
        imported_pending["narrative_graph_hash"],
        imported_committed["narrative_graph_hash"]
    );
    assert_ne!(
        imported_pending["narrative_graph_snapshot_hash"],
        imported_committed["narrative_graph_snapshot_hash"]
    );
    let pending_view = execute(
        &mut two_snapshot_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_project_checkpoint_graph",
            "project_checkpoint_id": "candidate-pending",
            "narrative_query": {"mode": "skeleton"}
        }),
    );
    let committed_view = execute(
        &mut two_snapshot_project,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_project_checkpoint_graph",
            "project_checkpoint_id": "candidate-committed",
            "narrative_query": {"mode": "skeleton"}
        }),
    );
    assert_eq!(
        pending_view["graph"]["source_snapshot"]["candidate_status"],
        "pending"
    );
    assert_eq!(
        committed_view["graph"]["source_snapshot"]["candidate_status"],
        "committed"
    );
    assert_ne!(
        pending_view["source_snapshot_hash"],
        committed_view["source_snapshot_hash"]
    );

    let upgraded = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "story-world",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 1.0,
                "step_size": 0.5,
                "seed": "candidate-anchor-freeze",
                "path": {"mode": "full"}
            }
        }),
    );
    assert_eq!(upgraded["candidate"]["candidate_hash"], candidate_hash);
    assert_eq!(upgraded["retention_upgraded"], true);
    drop(session);

    let connection = Connection::open(&state_file).unwrap();
    let stored_snapshot: Vec<u8> = connection
        .query_row(
            "SELECT snapshot_json FROM narrative_source_snapshots WHERE snapshot_hash = ?1",
            [&snapshot_hash],
            |row| row.get(0),
        )
        .unwrap();
    let stored_graph: Value = serde_json::from_slice(&stored_snapshot).unwrap();
    assert_eq!(stored_graph["snapshot_hash"], snapshot_hash);
    assert_eq!(
        stored_graph["snapshot"]["candidate_anchors"][&candidate_hash]["path"]["retention"]["mode"],
        "endpoint"
    );
    drop(connection);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    let inspected = execute(
        &mut restored,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "query_narrative_graph",
            "narrative_graph_hash": narrative_hash,
            "narrative_query": {"mode": "full", "include_content": false}
        }),
    );
    assert_eq!(inspected["source_snapshot_hash"], snapshot_hash);
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn candidate_source_checkpoint_round_trips_with_committed_parent_ancestry() {
    let mut source = MachineSession::default();
    let registered_model = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": model()
        }),
    );
    let model_hash = registered_model["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let genesis = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "create_world",
            "model_hash": model_hash,
            "world_id": "story-world"
        }),
    );
    let committed = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "story-world",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 1.0,
                "step_size": 0.5,
                "seed": "candidate-parent",
                "path": {"mode": "endpoint"}
            }
        }),
    );
    execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "commit_candidate",
            "candidate_hash": committed["candidate"]["candidate_hash"]
        }),
    );
    let pending = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "roll_world",
            "world_id": "story-world",
            "query": {
                "schema": "life-sim-rust-model-query/v1",
                "delta_time": 1.0,
                "step_size": 0.5,
                "seed": "candidate-child",
                "path": {"mode": "endpoint"}
            }
        }),
    );
    let pending_hash = pending["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut candidate_graph = graph(
        genesis["world_hash"].as_str().unwrap(),
        0,
        None,
        "A possible continuation remained open.",
    );
    candidate_graph["source"] = json!({
        "kind": "candidate",
        "candidate_hash": pending_hash
    });
    let registered_graph = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": candidate_graph
        }),
    );
    let graph_hash = registered_graph["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": {
                "schema": "life-sim-rust-project-checkpoint/v1",
                "name": "candidate-child-checkpoint",
                "document": {
                    "schema": "life-sim-rust-project-document/v1",
                    "media_type": "text/plain",
                    "content": {"encoding": "utf8", "text": "A possible continuation remained open."}
                },
                "narrative_graph_hash": graph_hash
            }
        }),
    );
    let exported = execute(
        &mut source,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "export_project_checkpoint",
            "project_checkpoint_id": "candidate-child-checkpoint"
        }),
    );
    let frozen_graph: Value = serde_json::from_str(
        exported["project_checkpoint"]["narrative_graph_snapshot_json"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        frozen_graph["snapshot"]["candidate_anchors"]
            .as_object()
            .unwrap()
            .len(),
        2
    );

    let mut imported = MachineSession::default();
    execute(
        &mut imported,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_project_checkpoint",
            "project_checkpoint": exported["project_checkpoint"]
        }),
    );
    let rendered = execute(
        &mut imported,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_project_checkpoint",
            "project_checkpoint_id": "candidate-child-checkpoint",
            "narrative_render": {}
        }),
    );
    assert_eq!(rendered["text"], "A possible continuation remained open.");
}

#[test]
fn sqlite_delta_history_grows_by_changes_and_restarts_without_projection_drift() {
    let state_file = state_path("narrative-delta-growth");
    let mut session = MachineSession::with_state_file(&state_file).unwrap();
    let model_hash = register_test_model(&mut session, "delta-growth-model");

    let mut root_nodes = Vec::new();
    let mut root_edges = Vec::new();
    for index in 0..32u64 {
        let id = format!("root-passage-{index:02}");
        root_nodes.push(story_node(
            &id,
            format!("Root passage {index}: {}", "foundation ".repeat(64)),
        ));
        root_edges.push(story_edge(&format!("root-contains-{index:02}"), &id, index));
    }
    let registered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": root_story_graph(
                &model_hash,
                "growth-story",
                root_nodes,
                root_edges
            )
        }),
    );
    let mut head = registered["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    for index in 0..24u64 {
        let id = format!("appended-passage-{index:02}");
        let result = append_story_nodes(
            &mut session,
            &head,
            vec![story_node(&id, format!("Small appended fact {index}."))],
            vec![story_edge(
                &format!("root-appends-{index:02}"),
                &id,
                32 + index,
            )],
        );
        head = result["summary"]["graph_hash"].as_str().unwrap().to_owned();
    }

    let query_command = json!({
        "schema": "life-sim-rust-command/v1",
        "operation": "query_narrative_graph",
        "narrative_graph_hash": head,
        "narrative_query": {"mode": "full", "include_content": true}
    });
    let render_command = json!({
        "schema": "life-sim-rust-command/v1",
        "operation": "render_narrative_graph",
        "narrative_graph_hash": head,
        "narrative_render": {}
    });
    let training_command = json!({
        "schema": "life-sim-rust-command/v1",
        "operation": "export_narrative_training",
        "narrative_graph_hash": head,
        "narrative_training": {
            "include_linked_values": false,
            "require_accepted_history": false
        }
    });
    let before_query = execute(&mut session, query_command.clone());
    let before_render = execute(&mut session, render_command.clone());
    let before_training = execute(&mut session, training_command.clone());
    drop(session);

    let bytes = fs::read(&state_file).unwrap();
    assert_eq!(&bytes[..16], b"SQLite format 3\0");
    let connection = Connection::open(&state_file).unwrap();
    let snapshot_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM narrative_source_snapshots",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let revision_count: i64 = connection
        .query_row("SELECT count(*) FROM narrative_revisions", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(snapshot_count, 1);
    assert_eq!(revision_count, 25);
    let root_bytes: i64 = connection
        .query_row(
            "SELECT length(revision_json) FROM narrative_revisions WHERE operation_sequence = 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let total_revision_bytes: i64 = connection
        .query_row(
            "SELECT sum(length(revision_json)) FROM narrative_revisions",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        total_revision_bytes < root_bytes * 5,
        "delta rows unexpectedly resemble full snapshots: root={root_bytes}, total={total_revision_bytes}"
    );
    let mut statement = connection
        .prepare("SELECT revision_json FROM narrative_revisions ORDER BY operation_sequence")
        .unwrap();
    let rows = statement
        .query_map([], |row| row.get::<_, Vec<u8>>(0))
        .unwrap();
    let records: Vec<Value> = rows
        .map(|row| serde_json::from_slice(&row.unwrap()).unwrap())
        .collect();
    assert_eq!(records[0]["payload"]["kind"], "root");
    assert!(records[1..]
        .iter()
        .all(|record| record["payload"]["kind"] == "delta"));
    drop(statement);
    drop(connection);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    assert_eq!(execute(&mut restored, query_command), before_query);
    assert_eq!(execute(&mut restored, render_command), before_render);
    assert_eq!(execute(&mut restored, training_command), before_training);
    let history = execute(
        &mut restored,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "list_narrative_revisions",
            "narrative_history": {"graph_id": "growth-story"}
        }),
    );
    assert_eq!(history["revision_count"], 25);
    assert_eq!(history["heads"], json!([head]));
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn history_preserves_raw_insertion_order_while_semantic_order_and_branches_stay_independent() {
    let state_file = state_path("narrative-order-branches");
    let mut session = MachineSession::with_state_file(&state_file).unwrap();
    let model_hash = register_test_model(&mut session, "order-branch-model");
    let registered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": root_story_graph(
                &model_hash,
                "branch-story",
                vec![
                    story_node("z-passage", "Z follows in semantic order.".to_owned()),
                    story_node("a-passage", "A leads in semantic order.".to_owned())
                ],
                vec![
                    story_edge("z-edge", "z-passage", 1),
                    story_edge("a-edge", "a-passage", 0)
                ]
            )
        }),
    );
    let root_hash = registered["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let root_render = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": root_hash,
            "narrative_render": {}
        }),
    );
    assert_eq!(root_render["sequence"], json!(["a-passage", "z-passage"]));

    let first_branch = append_story_nodes(
        &mut session,
        &root_hash,
        vec![
            story_node("z-added", "Branch one Z.".to_owned()),
            story_node("a-added", "Branch one A.".to_owned()),
        ],
        vec![
            story_edge("z-added-edge", "z-added", 3),
            story_edge("a-added-edge", "a-added", 2),
        ],
    );
    let first_branch_hash = first_branch["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let second_branch = append_story_nodes(
        &mut session,
        &root_hash,
        vec![story_node(
            "other-added",
            "A different successor remains possible.".to_owned(),
        )],
        vec![story_edge("other-added-edge", "other-added", 2)],
    );
    let second_branch_hash = second_branch["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();

    let history_command = json!({
        "schema": "life-sim-rust-command/v1",
        "operation": "list_narrative_revisions",
        "narrative_history": {"graph_id": "branch-story"}
    });
    let history = execute(&mut session, history_command.clone());
    assert_eq!(history["revision_count"], 3);
    assert_eq!(history["revisions"][0]["operation_sequence"], 0);
    assert_eq!(history["revisions"][1]["operation_sequence"], 1);
    assert_eq!(history["revisions"][2]["operation_sequence"], 2);
    assert_eq!(history["revisions"][1]["revision_number"], 1);
    assert_eq!(history["revisions"][2]["revision_number"], 1);
    assert_eq!(history["revisions"][0]["is_branch_point"], true);
    assert_eq!(history["revisions"][0]["child_count"], 2);
    assert_eq!(
        history["heads"],
        json!([first_branch_hash, second_branch_hash])
    );
    drop(session);

    let connection = Connection::open(&state_file).unwrap();
    let root_record: Vec<u8> = connection
        .query_row(
            "SELECT revision_json FROM narrative_revisions WHERE operation_sequence = 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let branch_record: Vec<u8> = connection
        .query_row(
            "SELECT revision_json FROM narrative_revisions WHERE operation_sequence = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let root_record: Value = serde_json::from_slice(&root_record).unwrap();
    let branch_record: Value = serde_json::from_slice(&branch_record).unwrap();
    assert_eq!(
        root_record["insertion_order"]["node_ids"],
        json!(["root", "z-passage", "a-passage"])
    );
    assert_eq!(
        root_record["insertion_order"]["edge_ids"],
        json!(["z-edge", "a-edge"])
    );
    assert_eq!(
        branch_record["insertion_order"]["node_ids"],
        json!(["z-added", "a-added"])
    );
    assert_eq!(
        branch_record["insertion_order"]["edge_ids"],
        json!(["z-added-edge", "a-added-edge"])
    );
    drop(connection);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    assert_eq!(execute(&mut restored, history_command), history);
    for graph_hash in [&first_branch_hash, &second_branch_hash] {
        let rendered = execute(
            &mut restored,
            json!({
                "schema": "life-sim-rust-command/v1",
                "operation": "render_narrative_graph",
                "narrative_graph_hash": graph_hash,
                "narrative_render": {}
            }),
        );
        assert!(!rendered["text"].as_str().unwrap().is_empty());
    }
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn full_revision_delta_replaces_removes_and_reorders_without_mutating_its_parent() {
    let state_file = state_path("narrative-full-revision");
    let mut session = MachineSession::with_state_file(&state_file).unwrap();
    let model_hash = register_test_model(&mut session, "full-revision-model");
    let document = |id: &str| {
        json!({
            "id": id,
            "node_type": "short_story",
            "role": "document_root",
            "epistemic_status": "fictional_artifact",
            "evidence_type": "fictional_canon",
            "render": "exclude",
            "training": "exclude",
            "provenance": ["full revision delta test"]
        })
    };
    let structural = |id: &str, root: &str, target: &str, order: u64| {
        json!({
            "id": id,
            "source": {"kind": "node", "node_id": root},
            "target": {"kind": "node", "node_id": target},
            "family": "structural",
            "relation": "contains",
            "order": order,
            "provenance": ["full revision delta test"]
        })
    };
    let initial = json!({
        "schema": "life-sim-rust-narrative-graph/v1",
        "id": "full-revision-story",
        "revision": {
            "number": 0,
            "reason": "Initial multi-root story.",
            "provenance": ["full revision delta test"]
        },
        "source": {"kind": "model", "model_hash": model_hash},
        "roots": ["root-c", "root-a", "root-b"],
        "nodes": [
            document("root-c"),
            story_node("c-passage", "C section will be removed.".to_owned()),
            document("root-a"),
            story_node("a-first", "A first, original.".to_owned()),
            story_node("a-second", "A second, original.".to_owned()),
            story_node("a-toss", "This passage will be removed.".to_owned()),
            document("root-b"),
            story_node("b-passage", "B section remains.".to_owned())
        ],
        "edges": [
            structural("c-edge", "root-c", "c-passage", 0),
            structural("a-first-edge", "root-a", "a-first", 0),
            structural("a-second-edge", "root-a", "a-second", 1),
            structural("a-toss-edge", "root-a", "a-toss", 2),
            structural("b-edge", "root-b", "b-passage", 0)
        ]
    });
    let registered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": initial
        }),
    );
    let parent_hash = registered["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let parent_render = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": parent_hash,
            "narrative_render": {}
        }),
    );

    let revised_definition = json!({
        "schema": "life-sim-rust-narrative-graph/v1",
        "id": "full-revision-story",
        "revision": {
            "number": 1,
            "previous_graph_hash": parent_hash,
            "reason": "Remove a section, replace prose, and reorder retained material.",
            "provenance": ["full revision delta test"]
        },
        "source": {"kind": "model", "model_hash": model_hash},
        "roots": ["root-b", "root-a"],
        "nodes": [
            document("root-b"),
            story_node("b-passage", "B section remains.".to_owned()),
            document("root-a"),
            story_node("a-second", "A second now leads.".to_owned()),
            story_node("a-first", "A first is revised and follows.".to_owned())
        ],
        "edges": [
            structural("b-edge", "root-b", "b-passage", 0),
            structural("a-second-edge", "root-a", "a-second", 0),
            structural("a-first-edge", "root-a", "a-first", 1)
        ]
    });
    let revised = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "revise_narrative_graph",
            "narrative_graph": revised_definition
        }),
    );
    let child_hash = revised["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let child_render = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "render_narrative_graph",
            "narrative_graph_hash": child_hash,
            "narrative_render": {}
        }),
    );
    assert_eq!(
        child_render["sequence"],
        json!(["b-passage", "a-second", "a-first"])
    );
    assert_eq!(
        child_render["text"],
        "B section remains.\n\nA second now leads.\n\nA first is revised and follows."
    );
    assert_eq!(
        execute(
            &mut session,
            json!({
                "schema": "life-sim-rust-command/v1",
                "operation": "render_narrative_graph",
                "narrative_graph_hash": parent_hash,
                "narrative_render": {}
            })
        ),
        parent_render
    );
    drop(session);

    let connection = Connection::open(&state_file).unwrap();
    let revision_json: Vec<u8> = connection
        .query_row(
            "SELECT revision_json FROM narrative_revisions WHERE operation_sequence = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let revision: Value = serde_json::from_slice(&revision_json).unwrap();
    let root_operations = revision["payload"]["delta"]["root_operations"]
        .as_array()
        .unwrap();
    let node_operations = revision["payload"]["delta"]["node_operations"]
        .as_array()
        .unwrap();
    let edge_operations = revision["payload"]["delta"]["edge_operations"]
        .as_array()
        .unwrap();
    assert!(root_operations
        .iter()
        .any(|operation| operation["operation"] == "remove"));
    assert!(root_operations
        .iter()
        .any(|operation| operation["operation"] == "move"));
    assert!(node_operations
        .iter()
        .any(|operation| operation["operation"] == "remove"));
    assert!(node_operations
        .iter()
        .any(|operation| operation["operation"] == "replace"));
    assert!(edge_operations
        .iter()
        .any(|operation| operation["operation"] == "remove"));
    assert!(edge_operations
        .iter()
        .any(|operation| operation["operation"] == "replace"));
    drop(connection);

    let mut restored = MachineSession::with_state_file(&state_file).unwrap();
    assert_eq!(
        execute(
            &mut restored,
            json!({
                "schema": "life-sim-rust-command/v1",
                "operation": "render_narrative_graph",
                "narrative_graph_hash": child_hash,
                "narrative_render": {}
            })
        ),
        child_render
    );
    assert_eq!(
        execute(
            &mut restored,
            json!({
                "schema": "life-sim-rust-command/v1",
                "operation": "render_narrative_graph",
                "narrative_graph_hash": parent_hash,
                "narrative_render": {}
            })
        ),
        parent_render
    );
    fs::remove_file(&state_file).unwrap();
}

#[test]
fn restart_rejects_tampered_revision_metadata_and_stale_writers_cannot_overwrite() {
    let tampered_state = state_path("narrative-tamper");
    let mut session = MachineSession::with_state_file(&tampered_state).unwrap();
    let model_hash = register_test_model(&mut session, "tamper-model");
    let registered = execute(
        &mut session,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_narrative_graph",
            "narrative_graph": root_story_graph(
                &model_hash,
                "tamper-story",
                vec![story_node("passage", "Untampered text.".to_owned())],
                vec![story_edge("contains-passage", "passage", 0)]
            )
        }),
    );
    assert_eq!(registered["operation_sequence"], 0);
    drop(session);

    let connection = Connection::open(&tampered_state).unwrap();
    let stored: Vec<u8> = connection
        .query_row(
            "SELECT revision_json FROM narrative_revisions WHERE operation_sequence = 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let mut record: Value = serde_json::from_slice(&stored).unwrap();
    record["insertion_order"]["node_ids"] = json!(["root"]);
    connection
        .execute(
            "UPDATE narrative_revisions SET revision_json = ?1 WHERE operation_sequence = 0",
            [serde_json::to_vec(&record).unwrap()],
        )
        .unwrap();
    drop(connection);
    let failure = MachineSession::with_state_file(&tampered_state).unwrap_err();
    assert!(
        failure.0.contains("record hash is invalid"),
        "{}",
        failure.0
    );

    let connection = Connection::open(&tampered_state).unwrap();
    connection
        .execute(
            "UPDATE narrative_revisions SET revision_json = ?1, graph_id = 'wrong-shadow-value' WHERE operation_sequence = 0",
            [&stored],
        )
        .unwrap();
    drop(connection);
    let shadow_failure = MachineSession::with_state_file(&tampered_state).unwrap_err();
    assert!(
        shadow_failure.0.contains("columns do not match"),
        "{}",
        shadow_failure.0
    );
    fs::remove_file(&tampered_state).unwrap();

    let concurrent_state = state_path("sqlite-generation-cas");
    let mut first = MachineSession::with_state_file(&concurrent_state).unwrap();
    let mut stale = MachineSession::with_state_file(&concurrent_state).unwrap();
    let first_hash = register_test_model(&mut first, "first-writer-model");
    let generation_before_noop: String = Connection::open(&concurrent_state)
        .unwrap()
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        register_test_model(&mut first, "first-writer-model"),
        first_hash
    );
    let generation_after_noop: String = Connection::open(&concurrent_state)
        .unwrap()
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(generation_after_noop, generation_before_noop);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&concurrent_state)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let mut stale_model = model();
    stale_model["id"] = json!("stale-writer-model");
    let rejected = stale.parse_and_execute(
        &json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "register_model",
            "model": stale_model
        })
        .to_string(),
    );
    assert!(!rejected.ok);
    let error = rejected.error.unwrap();
    assert_eq!(error.code, "persistence_error");
    assert!(error.message.contains("changed since it was opened"));
    let visible_after_reload = execute(
        &mut stale,
        json!({
            "schema": "life-sim-rust-command/v1",
            "operation": "get_model",
            "model_hash": first_hash
        }),
    );
    assert_eq!(visible_after_reload["summary"]["id"], "first-writer-model");
    fs::remove_file(&concurrent_state).unwrap();
}
