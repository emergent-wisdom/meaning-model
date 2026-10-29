//! The machine protocol as a caller sees it: which operations exist and where each is dispatched, which ones mutate
//! the session and are therefore written to SQLite, what a roll or reroll answers when its candidate already exists,
//! and how a failed durable write is reported. Internal restructuring must leave every assertion here unchanged.

use life_sim_engine::{
    is_machine_operation, machine_description, MachineSession, ResponseEnvelope,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const COMMAND: &str = "life-sim-rust-command/v1";

/// Each machine operation with the error it answers when sent without fields, or `None` when it needs none.
const MACHINE_OPERATIONS: [(&str, Option<&str>); 32] = [
    (
        "compile_profiles",
        Some("compile_profiles requires profile_request"),
    ),
    ("validate_model", Some("validate_model requires model")),
    ("register_model", Some("model operation requires model")),
    ("revise_model", Some("model operation requires model")),
    ("get_model", Some("get_model requires model_hash")),
    ("create_world", Some("create_world requires model_hash")),
    ("get_world", Some("get_world requires world_id")),
    (
        "refine_genesis_world",
        Some("refine_genesis_world requires world_id"),
    ),
    ("revise_world", Some("revise_world requires world_id")),
    (
        "get_world_revision",
        Some("get_world_revision requires world_revision_hash"),
    ),
    ("query_graph", Some("query_graph requires graph_query")),
    ("query_view", Some("query_view requires view")),
    (
        "register_narrative_graph",
        Some("narrative graph operation requires narrative_graph"),
    ),
    (
        "revise_narrative_graph",
        Some("narrative graph operation requires narrative_graph"),
    ),
    (
        "revise_narrative_graph_by_change",
        Some("revise_narrative_graph_by_change requires narrative_change"),
    ),
    (
        "apply_narrative_batch",
        Some("apply_narrative_batch requires narrative_batch"),
    ),
    ("list_narrative_revisions", None),
    (
        "query_narrative_graph",
        Some("query_narrative_graph requires narrative_graph_hash"),
    ),
    (
        "render_narrative_graph",
        Some("render_narrative_graph requires narrative_graph_hash"),
    ),
    (
        "export_narrative_training",
        Some("export_narrative_training requires narrative_graph_hash"),
    ),
    (
        "register_project_checkpoint",
        Some("register_project_checkpoint requires project_checkpoint"),
    ),
    ("list_project_checkpoints", None),
    (
        "get_project_checkpoint",
        Some("get_project_checkpoint requires project_checkpoint_id"),
    ),
    (
        "export_project_checkpoint",
        Some("export_project_checkpoint requires project_checkpoint_id"),
    ),
    (
        "render_project_checkpoint",
        Some("render_project_checkpoint requires project_checkpoint_id"),
    ),
    (
        "query_project_checkpoint_graph",
        Some("query_project_checkpoint_graph requires project_checkpoint_id"),
    ),
    ("roll_world", Some("roll_world requires world_id")),
    (
        "inspect_candidate",
        Some("inspect_candidate requires candidate_hash"),
    ),
    (
        "summarize_trajectory",
        Some("summarize_trajectory requires candidate_hash"),
    ),
    (
        "reroll_candidate",
        Some("reroll_candidate requires candidate_hash"),
    ),
    (
        "reject_candidate",
        Some("reject_candidate requires candidate_hash"),
    ),
    (
        "commit_candidate",
        Some("commit_candidate requires candidate_hash"),
    ),
];

/// The operations that change a session and are written to its state file.
const MUTATING_OPERATIONS: [&str; 14] = [
    "register_model",
    "revise_model",
    "create_world",
    "refine_genesis_world",
    "revise_world",
    "roll_world",
    "reroll_candidate",
    "reject_candidate",
    "commit_candidate",
    "register_narrative_graph",
    "revise_narrative_graph",
    "revise_narrative_graph_by_change",
    "apply_narrative_batch",
    "register_project_checkpoint",
];

fn command_text(operation: &str, mut fields: Value) -> String {
    fields["schema"] = json!(COMMAND);
    fields["operation"] = json!(operation);
    fields.to_string()
}

fn send(session: &mut MachineSession, operation: &str, fields: Value) -> ResponseEnvelope {
    session.parse_and_execute(&command_text(operation, fields))
}

fn ok(session: &mut MachineSession, operation: &str, fields: Value) -> Value {
    let response = send(session, operation, fields);
    assert!(response.ok, "{operation}: {:?}", response.error);
    response.result.unwrap()
}

fn failure(session: &mut MachineSession, operation: &str, fields: Value) -> (&'static str, String) {
    let response = send(session, operation, fields);
    assert!(!response.ok, "{operation} unexpectedly succeeded");
    let error = response.error.unwrap();
    (error.code, error.message)
}

fn envelope(response: &ResponseEnvelope) -> Value {
    serde_json::to_value(response).unwrap()
}

fn temp_path(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "life-sim-protocol-{label}-{}-{nonce}",
        std::process::id()
    ))
}

fn remove_state(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

/// The stored session generation, or `None` while no state file exists.
fn generation(path: &Path) -> Option<u64> {
    if !path.exists() {
        return None;
    }
    let connection = Connection::open(path).unwrap();
    let value: Option<String> = connection
        .query_row(
            "SELECT value FROM session_metadata WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    value.map(|value| value.parse().unwrap())
}

fn scalar(value: f64) -> Value {
    json!({"kind": "scalar", "value": value})
}

fn process(id: &str, value: f64, update_mode: Option<&str>) -> Value {
    let mut process = json!({
        "id": id, "value_type": {"kind": "scalar", "bounds": {"minimum": 0.0, "maximum": 100.0}},
        "initial_value": scalar(value), "unit": "unit", "provenance": ["protocol test"],
        "support": ["authored test coordinate"]
    });
    if let Some(mode) = update_mode {
        process["update_mode"] = json!(mode);
    }
    process
}

fn base_model() -> Value {
    json!({
        "schema": "life-sim-rust-model/v1", "id": "protocol-model", "time_unit": "day",
        "revision": {"number": 0, "reason": "Base model", "provenance": ["protocol test"]},
        "processes": [process("x", 1.0, None)],
        "laws": [{"id": "drift", "provenance": ["protocol test"],
                  "operator": {"role": "evolution", "target": "x", "derivative": {"op": "constant", "value": 1.0}}}],
        "initial_claims": [{"id": "claim-x", "subject": "x", "value": scalar(1.0), "uncertainty": {"kind": "exact"},
                            "evidence_type": "observation", "holder": "observer", "evidence_cutoff": 0.0,
                            "provenance": ["protocol test"], "authority": {"source": "observer", "weight": 1.0}}]
    })
}

fn next_revision(previous: &Value, previous_hash: &str) -> Value {
    let mut model = previous.clone();
    model["revision"] = json!({
        "number": previous["revision"]["number"].as_u64().unwrap() + 1,
        "previous_model_hash": previous_hash, "reason": "Next model", "provenance": ["protocol test"]
    });
    model
}

fn query(roll_index: u64, path: Option<Value>) -> Value {
    let mut query = json!({
        "schema": "life-sim-rust-model-query/v1", "delta_time": 1.0, "step_size": 0.25,
        "seed": "protocol-seed", "roll_index": roll_index, "requested_observables": ["x"]
    });
    if let Some(path) = path {
        query["path"] = path;
    }
    query
}

fn full() -> Option<Value> {
    Some(json!({"mode": "full"}))
}

fn narrative_node(id: &str, text: &str, role: &str) -> Value {
    json!({"id": id, "node_type": "story", "role": role, "text": text, "epistemic_status": "fictional_canon",
           "evidence_type": "fictional_canon", "authority": {"source": "author", "weight": 1.0},
           "render": "include", "training": "include", "provenance": ["protocol test"]})
}

fn contains_edge(id: &str, target: &str, order: u64) -> Value {
    json!({"id": id, "family": "structural", "relation": "contains", "order": order,
           "source": {"kind": "node", "node_id": "root"}, "target": {"kind": "node", "node_id": target},
           "provenance": ["protocol test"]})
}

fn person_profile_request() -> Value {
    let view = |id: &str, kind: &str, holder: &str, weight: f64, position: f64| {
        json!({"id": id, "kind": kind, "holder": holder, "estimator": holder, "authority_weight": weight,
               "nodes": [{"id": "research_as_path", "position": position}]})
    };
    json!({
        "schema": "life-sim-rust-profile-compilation/v1",
        "model": {"id": "protocol-person", "time_unit": "day", "reason": "Compile without storing.",
                  "provenance": ["protocol test"]},
        "profiles": [{"kind": "person", "profile": {
            "id": "research_year", "subject_id": "alex", "person_boundary": "Alex during one bounded year.",
            "continuity_criterion": "The same embodied person across the interval.",
            "evidence_boundary": "Events observed or reported during that year.",
            "evidence": [{"id": "release", "value": 1.0, "bounds": {"minimum": 0.0, "maximum": 1.0},
                          "evidence_type": "observation", "holder": "operator",
                          "authority": {"source": "release_record", "weight": 1.0}}],
            "position_bounds": {"minimum": -1.0, "maximum": 1.0},
            "views": [view("outside", "external_descriptive", "operator", 0.6, 0.4),
                      view("candidate", "candidate_actor", "operator", 0.5, 0.7),
                      view("self", "self_reported", "alex", 1.0, 0.9)],
            "provenance": ["protocol test"]}}]
    })
}

/// Compares a value with its pinned fixture. Set LIFE_SIM_BLESS_FIXTURES=1 to write the fixture from today's answer.
fn assert_fixture(name: &str, actual: &Value) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    if std::env::var_os("LIFE_SIM_BLESS_FIXTURES").is_some() {
        std::fs::write(&path, serde_json::to_string_pretty(actual).unwrap() + "\n").unwrap();
    }
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(actual, &expected, "{name} differs from its pinned fixture");
}

fn candidate_hash(result: &Value) -> String {
    result["candidate"]["candidate_hash"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn every_machine_operation_is_known_dispatched_and_described() {
    let description = machine_description();
    let described: Vec<&str> = description["operations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|operation| operation.as_str().unwrap())
        .collect();
    assert_eq!(
        described,
        [
            "describe",
            "compile_registry",
            "roll",
            "compile_profiles",
            "validate_model",
            "register_model",
            "revise_model",
            "get_model",
            "create_world",
            "get_world",
            "refine_genesis_world",
            "revise_world",
            "get_world_revision",
            "roll_world",
            "inspect_candidate",
            "summarize_trajectory",
            "reroll_candidate",
            "reject_candidate",
            "commit_candidate",
            "query_graph",
            "query_view",
            "register_narrative_graph",
            "revise_narrative_graph",
            "revise_narrative_graph_by_change",
            "apply_narrative_batch",
            "list_narrative_revisions",
            "query_narrative_graph",
            "render_narrative_graph",
            "export_narrative_training",
            "register_project_checkpoint",
            "list_project_checkpoints",
            "get_project_checkpoint",
            "export_project_checkpoint",
            "render_project_checkpoint",
            "query_project_checkpoint_graph",
        ]
    );
    for legacy in ["describe", "compile_registry", "roll"] {
        assert!(!is_machine_operation(legacy), "{legacy}");
    }
    for unknown in [
        "",
        "Describe",
        "no_such_operation",
        "register_model ",
        "list_project_checkpoint",
    ] {
        assert!(!is_machine_operation(unknown), "{unknown:?}");
    }
    let mut session = MachineSession::default();
    for (operation, required) in MACHINE_OPERATIONS {
        assert!(is_machine_operation(operation), "{operation}");
        assert!(described.contains(&operation), "{operation}");
        let response = send(&mut session, operation, json!({"request_id": operation}));
        assert_eq!(response.request_id.as_deref(), Some(operation));
        match required {
            None => assert!(response.ok, "{operation}: {:?}", response.error),
            Some(message) => {
                let error = response.error.expect(operation);
                assert_eq!(
                    (error.code, error.message.as_str()),
                    ("invalid_request", message),
                    "{operation}"
                );
            }
        }
    }
    for operation in MUTATING_OPERATIONS {
        assert!(
            MACHINE_OPERATIONS
                .iter()
                .any(|(known, _)| *known == operation),
            "{operation}"
        );
    }
}

#[test]
fn malformed_unknown_and_legacy_commands_keep_their_envelopes() {
    let mut session = MachineSession::default();
    let cases: Vec<(&str, Value)> = vec![
        (
            "{not json",
            json!({"schema": "life-sim-rust-response/v1", "ok": false,
            "error": {"code": "invalid_json", "message": "key must be a string at line 1 column 2"}}),
        ),
        (
            "{}",
            json!({"schema": "life-sim-rust-response/v1", "ok": false,
            "error": {"code": "invalid_json", "message": "missing field `schema` at line 1 column 2"}}),
        ),
        (
            r#"{"schema":"life-sim-rust-command/v1","operation":5}"#,
            json!({"schema": "life-sim-rust-response/v1",
            "ok": false, "error": {"code": "invalid_json",
            "message": "invalid type: integer `5`, expected a string at line 1 column 50"}}),
        ),
        (
            r#"{"schema":"life-sim-rust-command/v1","request_id":"r","operation":"no_such_operation"}"#,
            json!({"schema": "life-sim-rust-response/v1", "request_id": "r", "ok": false,
            "error": {"code": "invalid_request", "message": "unsupported operation no_such_operation"}}),
        ),
        (
            r#"{"schema":"life-sim-rust-command/v1","operation":""}"#,
            json!({"schema": "life-sim-rust-response/v1",
            "ok": false, "error": {"code": "invalid_request", "message": "unsupported operation "}}),
        ),
        (
            r#"{"schema":"wrong/v1","request_id":"r","operation":"describe"}"#,
            json!({"schema": "life-sim-rust-response/v1", "request_id": "r", "ok": false,
            "error": {"code": "invalid_request",
            "message": "unsupported command schema wrong/v1; expected life-sim-rust-command/v1"}}),
        ),
        (
            r#"{"schema":"wrong/v1","request_id":"r","operation":"get_model","model_hash":"x"}"#,
            json!({"schema": "life-sim-rust-response/v1", "request_id": "r", "ok": false,
            "error": {"code": "invalid_request",
            "message": "unsupported command schema wrong/v1; expected life-sim-rust-command/v1"}}),
        ),
        (
            r#"{"schema":"life-sim-rust-command/v1","request_id":"r","operation":"get_model","bogus":1}"#,
            json!({"schema": "life-sim-rust-response/v1", "request_id": "r", "ok": false,
            "error": {"code": "invalid_json", "message": "unknown field `bogus`, expected one of `schema`, `request_id`, `operation`, `model`, `profile_request`, `model_hash`, `world_id`, `world_revision`, `world_revision_hash`, `candidate_hash`, `query`, `trajectory_summary`, `view`, `graph_query`, `narrative_graph`, `preserve_narrative_source_snapshot`, `narrative_batch`, `narrative_change`, `narrative_graph_hash`, `narrative_query`, `narrative_render`, `narrative_training`, `narrative_history`, `project_checkpoint`, `project_checkpoint_id`"}}),
        ),
        (
            r#"{"schema":"life-sim-rust-command/v1","request_id":7,"operation":"get_model"}"#,
            json!({"schema": "life-sim-rust-response/v1", "ok": false,
            "error": {"code": "invalid_json", "message": "invalid type: integer `7`, expected a string"}}),
        ),
        (
            r#"{"schema":"life-sim-rust-command/v1","request_id":"r","operation":"describe","bogus":1}"#,
            json!({"schema": "life-sim-rust-response/v1", "ok": false,
            "error": {"code": "invalid_json", "message": "unknown field `bogus`, expected one of `schema`, `request_id`, `operation`, `registry`, `parent`, `transition`, `path` at line 1 column 84"}}),
        ),
    ];
    for (input, expected) in cases {
        assert_eq!(
            envelope(&session.parse_and_execute(input)),
            expected,
            "{input}"
        );
    }
    let described = session.parse_and_execute(
        r#"{"schema":"life-sim-rust-command/v1","request_id":"d","operation":"describe"}"#,
    );
    assert_eq!(described.request_id.as_deref(), Some("d"));
    assert_eq!(described.result.unwrap(), machine_description());
}

/// One step of a durable session: the command, and whether it must write a new generation to the state file.
struct Step {
    operation: &'static str,
    fields: Value,
    writes: bool,
}

fn step(operation: &'static str, fields: Value, writes: bool) -> Step {
    Step {
        operation,
        fields,
        writes,
    }
}

/// Every read a caller can make of the whole session, used to compare a live session with one reopened from disk.
fn session_reads(session: &mut MachineSession, known: &Known) -> Vec<Value> {
    let mut reads = vec![
        envelope(&send(session, "list_narrative_revisions", json!({}))),
        envelope(&send(session, "list_project_checkpoints", json!({}))),
    ];
    for hash in &known.models {
        reads.push(envelope(&send(
            session,
            "get_model",
            json!({"model_hash": hash}),
        )));
    }
    for world in &known.worlds {
        reads.push(envelope(&send(
            session,
            "get_world",
            json!({"world_id": world, "view": {"requested_observables": ["x"]}}),
        )));
    }
    for hash in &known.candidates {
        reads.push(envelope(&send(session, "inspect_candidate",
            json!({"candidate_hash": hash, "view": {"requested_observables": ["x"], "include_path": true}}))));
    }
    for hash in &known.world_revisions {
        reads.push(envelope(&send(
            session,
            "get_world_revision",
            json!({"world_revision_hash": hash}),
        )));
    }
    // A graph read uses its frozen source snapshot; a checkpoint export carries its frozen model, world and graph.
    for hash in &known.graphs {
        reads.push(envelope(&send(
            session,
            "query_narrative_graph",
            json!({"narrative_graph_hash": hash, "narrative_query": {"mode": "full", "include_content": true}}),
        )));
    }
    for hash in &known.checkpoints {
        reads.push(envelope(&send(
            session,
            "export_project_checkpoint",
            json!({"project_checkpoint_id": hash}),
        )));
    }
    reads
}

#[derive(Default)]
struct Known {
    models: Vec<String>,
    worlds: Vec<String>,
    candidates: Vec<String>,
    world_revisions: Vec<String>,
    graphs: Vec<String>,
    checkpoints: Vec<String>,
    /// Operations that wrote a generation, and operations that succeeded without writing.
    written: BTreeSet<&'static str>,
    read: BTreeSet<&'static str>,
}

impl Known {
    fn learn(&mut self, result: &Value) {
        let add = |list: &mut Vec<String>, value: &Value| {
            if let Some(text) = value.as_str() {
                if !list.iter().any(|known| known == text) {
                    list.push(text.to_owned());
                }
            }
        };
        add(&mut self.models, &result["summary"]["model_hash"]);
        add(&mut self.candidates, &result["candidate"]["candidate_hash"]);
        add(&mut self.world_revisions, &result["world_revision_hash"]);
        add(&mut self.worlds, &result["world_id"]);
        add(&mut self.worlds, &result["world_head"]["world_id"]);
        add(&mut self.graphs, &result["summary"]["graph_hash"]);
        add(&mut self.checkpoints, &result["checkpoint_hash"]);
    }
}

/// Runs each step on a durable session and checks that a mutating command writes exactly one new generation when it
/// changes something, that nothing else writes, and that a session reopened from the file then answers every read
/// exactly as the live session does.
fn run_durable(
    path: &Path,
    steps: Vec<Step>,
    session: &mut MachineSession,
    known: &mut Known,
) -> Vec<ResponseEnvelope> {
    let mut responses = Vec::new();
    for Step {
        operation,
        fields,
        writes,
    } in steps
    {
        let before = generation(path);
        let response = send(session, operation, fields);
        if let Some(result) = &response.result {
            known.learn(result);
        }
        let after = generation(path);
        if writes {
            known.written.insert(operation);
            assert!(response.ok, "{operation}: {:?}", response.error);
            assert!(
                MUTATING_OPERATIONS.contains(&operation),
                "{operation} is not a mutating operation"
            );
            assert_eq!(
                after,
                Some(before.unwrap_or(0) + 1),
                "{operation} must write one generation"
            );
            let mut reopened = MachineSession::with_state_file(path).unwrap();
            assert_eq!(
                session_reads(&mut reopened, known),
                session_reads(session, known),
                "{operation} was not fully flushed"
            );
        } else {
            assert_eq!(after, before, "{operation} must not write the state file");
            if response.ok {
                known.read.insert(operation);
            }
        }
        responses.push(response);
    }
    responses
}

#[test]
fn every_mutating_operation_is_written_to_sqlite_and_nothing_else_is() {
    let path = temp_path("flush").with_extension("sqlite");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let mut known = Known::default();
    let model = base_model();
    // Reads before anything exists create no file.
    run_durable(
        &path,
        vec![
            step("describe", json!({}), false),
            step("validate_model", json!({"model": model}), false),
            step("list_narrative_revisions", json!({}), false),
            step("list_project_checkpoints", json!({}), false),
        ],
        &mut session,
        &mut known,
    );
    assert!(!path.exists());

    let registered = run_durable(
        &path,
        vec![
            step("register_model", json!({"model": model}), true),
            step("register_model", json!({"model": model}), false),
        ],
        &mut session,
        &mut known,
    );
    let base_hash = registered[0].result.as_ref().unwrap()["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let world_steps = run_durable(
        &path,
        vec![
            step(
                "create_world",
                json!({"model_hash": base_hash, "world_id": "world"}),
                true,
            ),
            step(
                "create_world",
                json!({"model_hash": base_hash, "world_id": "world"}),
                false,
            ),
            step("get_model", json!({"model_hash": base_hash}), false),
            step("get_world", json!({"world_id": "world"}), false),
            step(
                "roll_world",
                json!({"world_id": "world", "query": query(0, None)}),
                true,
            ),
            step(
                "roll_world",
                json!({"world_id": "world", "query": query(0, None)}),
                false,
            ),
            step(
                "roll_world",
                json!({"world_id": "world", "query": query(0, full())}),
                true,
            ),
            step(
                "roll_world",
                json!({"world_id": "world", "query": query(0, full())}),
                false,
            ),
        ],
        &mut session,
        &mut known,
    );
    let a = candidate_hash(world_steps[4].result.as_ref().unwrap());
    let summary = json!({"schema": "life-sim-rust-trajectory-summary-query/v1", "start_time": 0.0, "end_time": 1.0, "fields": ["x"]});
    let rerolled = run_durable(
        &path,
        vec![
            step("inspect_candidate", json!({"candidate_hash": a}), false),
            step(
                "summarize_trajectory",
                json!({"candidate_hash": a, "trajectory_summary": summary}),
                false,
            ),
            step(
                "query_view",
                json!({"candidate_hash": a, "view": {"requested_observables": ["x"]}}),
                false,
            ),
            step(
                "query_graph",
                json!({"candidate_hash": a, "graph_query": {"mode": "full"}}),
                false,
            ),
            step("reroll_candidate", json!({"candidate_hash": a}), true),
            step("reroll_candidate", json!({"candidate_hash": a}), false),
            step(
                "roll_world",
                json!({"world_id": "world", "query": query(2, None)}),
                true,
            ),
        ],
        &mut session,
        &mut known,
    );
    let b = candidate_hash(rerolled[4].result.as_ref().unwrap());
    let c = candidate_hash(rerolled[6].result.as_ref().unwrap());
    let rejected = run_durable(
        &path,
        vec![
            // B rerolls to C, which exists with a poorer path: C's path is upgraded and B is superseded.
            step("reroll_candidate", json!({"candidate_hash": b}), true),
            step("reroll_candidate", json!({"candidate_hash": c}), true),
        ],
        &mut session,
        &mut known,
    );
    let d = candidate_hash(rejected[1].result.as_ref().unwrap());
    let committed = run_durable(
        &path,
        vec![
            step("reject_candidate", json!({"candidate_hash": d}), true),
            step("reject_candidate", json!({"candidate_hash": d}), false),
            step("reroll_candidate", json!({"candidate_hash": d}), true),
        ],
        &mut session,
        &mut known,
    );
    let e = candidate_hash(committed[2].result.as_ref().unwrap());
    let head = run_durable(
        &path,
        vec![
            step("commit_candidate", json!({"candidate_hash": e}), true),
            step("commit_candidate", json!({"candidate_hash": e}), false),
            step("reroll_candidate", json!({"candidate_hash": e}), false),
            step("get_world", json!({"world_id": "world"}), false),
        ],
        &mut session,
        &mut known,
    );
    let head = head[3].result.clone().unwrap();

    let mut added = next_revision(&model, &base_hash);
    added["processes"]
        .as_array_mut()
        .unwrap()
        .push(process("y", 99.0, Some("static")));
    let revised = run_durable(
        &path,
        vec![
            step("revise_model", json!({"model": added}), true),
            step("revise_model", json!({"model": added}), false),
        ],
        &mut session,
        &mut known,
    );
    let added_hash = revised[0].result.as_ref().unwrap()["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let revision = json!({"expected_world_hash": head["world_hash"], "mode": "refine",
                          "state_values": {"y": scalar(7.0)}, "reason": "Refine", "provenance": ["protocol test"]});
    let world_revision = run_durable(
        &path,
        vec![
            step(
                "revise_world",
                json!({"world_id": "world", "model_hash": added_hash, "world_revision": revision}),
                true,
            ),
            step(
                "revise_world",
                json!({"world_id": "world", "model_hash": added_hash, "world_revision": revision}),
                false,
            ),
            step(
                "create_world",
                json!({"model_hash": base_hash, "world_id": "genesis"}),
                true,
            ),
            step(
                "refine_genesis_world",
                json!({"world_id": "genesis", "model_hash": added_hash}),
                true,
            ),
            step(
                "refine_genesis_world",
                json!({"world_id": "genesis", "model_hash": added_hash}),
                false,
            ),
            step("get_world", json!({"world_id": "genesis"}), false),
        ],
        &mut session,
        &mut known,
    );
    let revision_hash = world_revision[0].result.as_ref().unwrap()["world_revision_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let genesis = world_revision[5].result.clone().unwrap();
    run_durable(
        &path,
        vec![step(
            "get_world_revision",
            json!({"world_revision_hash": revision_hash}),
            false,
        )],
        &mut session,
        &mut known,
    );

    let graph = json!({"schema": "life-sim-rust-narrative-graph/v1", "id": "story",
        "revision": {"number": 0, "reason": "Frozen source", "provenance": ["protocol test"]},
        "source": {"kind": "world", "world_id": "genesis", "world_hash": genesis["world_hash"]},
        "roots": ["root"], "nodes": [narrative_node("root", "story", "document_root")], "edges": []});
    let first = run_durable(
        &path,
        vec![
            step(
                "register_narrative_graph",
                json!({"narrative_graph": graph}),
                true,
            ),
            step(
                "register_narrative_graph",
                json!({"narrative_graph": graph}),
                false,
            ),
        ],
        &mut session,
        &mut known,
    );
    let first_hash = first[0].result.as_ref().unwrap()["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut second_graph = graph.clone();
    second_graph["revision"] = json!({"number": 1, "previous_graph_hash": first_hash, "reason": "Add passage", "provenance": ["protocol test"]});
    second_graph["nodes"]
        .as_array_mut()
        .unwrap()
        .push(narrative_node("p1", "First passage.", "story_passage"));
    second_graph["edges"]
        .as_array_mut()
        .unwrap()
        .push(contains_edge("root-contains-p1", "p1", 0));
    let second = run_durable(
        &path,
        vec![step(
            "revise_narrative_graph",
            json!({"narrative_graph": second_graph, "preserve_narrative_source_snapshot": true}),
            true,
        )],
        &mut session,
        &mut known,
    );
    let second_hash = second[0].result.as_ref().unwrap()["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let change = json!({"schema": "life-sim-rust-narrative-change/v1", "previous_graph_hash": second_hash,
        "revision": {"number": 2, "previous_graph_hash": second_hash, "reason": "Change text", "provenance": ["protocol test"]},
        "upsert_nodes": [narrative_node("root", "story, revised", "document_root")]});
    let third = run_durable(
        &path,
        vec![step(
            "revise_narrative_graph_by_change",
            json!({"narrative_change": change}),
            true,
        )],
        &mut session,
        &mut known,
    );
    let third_hash = third[0].result.as_ref().unwrap()["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let batch = json!({"schema": "life-sim-rust-narrative-batch/v1", "previous_graph_hash": third_hash, "reason": "Add",
        "provenance": ["protocol test"], "add_nodes": [narrative_node("p2", "Second passage.", "story_passage")],
        "add_edges": [contains_edge("root-contains-p2", "p2", 1)]});
    let fourth = run_durable(
        &path,
        vec![
            step(
                "apply_narrative_batch",
                json!({"narrative_batch": batch}),
                true,
            ),
            step(
                "apply_narrative_batch",
                json!({"narrative_batch": batch}),
                false,
            ),
        ],
        &mut session,
        &mut known,
    );
    let fourth_hash = fourth[0].result.as_ref().unwrap()["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let document = json!({"schema": "life-sim-rust-project-document/v1", "media_type": "text/markdown; charset=utf-8",
        "content": {"encoding": "utf8", "text": "# Version One\n"}});
    let checkpoint = json!({"schema": "life-sim-rust-project-checkpoint/v1", "name": "version-1", "document": document,
        "model_hash": added_hash, "world_hash": genesis["world_hash"], "narrative_graph_hash": first_hash,
        "reason": "First", "provenance": ["protocol test"]});
    run_durable(
        &path,
        vec![
            step(
                "query_narrative_graph",
                json!({"narrative_graph_hash": fourth_hash, "narrative_query": {"mode": "full"}}),
                false,
            ),
            step(
                "render_narrative_graph",
                json!({"narrative_graph_hash": fourth_hash, "narrative_render": {}}),
                false,
            ),
            step(
                "export_narrative_training",
                json!({"narrative_graph_hash": fourth_hash, "narrative_training": {}}),
                false,
            ),
            step(
                "list_narrative_revisions",
                json!({"narrative_history": {"graph_id": "story"}}),
                false,
            ),
            step(
                "register_project_checkpoint",
                json!({"project_checkpoint": checkpoint}),
                true,
            ),
            step(
                "register_project_checkpoint",
                json!({"project_checkpoint": checkpoint}),
                false,
            ),
            step("list_project_checkpoints", json!({}), false),
            step(
                "get_project_checkpoint",
                json!({"project_checkpoint_id": "version-1"}),
                false,
            ),
            step(
                "export_project_checkpoint",
                json!({"project_checkpoint_id": "version-1"}),
                false,
            ),
            step(
                "render_project_checkpoint",
                json!({"project_checkpoint_id": "version-1"}),
                false,
            ),
            step(
                "query_project_checkpoint_graph",
                json!({"project_checkpoint_id": "version-1", "narrative_query": {"mode": "skeleton"}}),
                false,
            ),
            step(
                "query_graph",
                json!({"world_id": "world", "graph_query": {"mode": "skeleton"}}),
                false,
            ),
            step(
                "query_view",
                json!({"world_id": "world", "view": {"requested_observables": ["x", "y"]}}),
                false,
            ),
            step(
                "compile_profiles",
                json!({"profile_request": person_profile_request()}),
                false,
            ),
        ],
        &mut session,
        &mut known,
    );
    // Every mutating operation was seen writing, and every other machine operation was seen succeeding unwritten.
    assert_eq!(known.written, BTreeSet::from(MUTATING_OPERATIONS));
    for (operation, _) in MACHINE_OPERATIONS {
        assert!(
            MUTATING_OPERATIONS.contains(&operation) || known.read.contains(operation),
            "{operation}"
        );
    }
    drop(session);
    remove_state(&path);
}

#[test]
fn an_existing_candidate_answers_the_same_for_roll_and_reroll() {
    let mut session = MachineSession::default();
    let model_hash = ok(
        &mut session,
        "register_model",
        json!({"model": base_model()}),
    )["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    ok(
        &mut session,
        "create_world",
        json!({"model_hash": model_hash, "world_id": "world"}),
    );
    let roll = |session: &mut MachineSession, index: u64, path: Option<Value>| {
        ok(
            session,
            "roll_world",
            json!({"world_id": "world", "query": query(index, path)}),
        )
    };
    let inspect = |session: &mut MachineSession, hash: &str| {
        ok(
            session,
            "inspect_candidate",
            json!({"candidate_hash": hash, "view": {"requested_observables": ["x"], "include_path": true}}),
        )
    };

    // roll_world: the same query answers the same projection; the stored record keeps its status.
    let first = roll(&mut session, 0, None);
    let a = candidate_hash(&first);
    assert_eq!(first["status"], "pending");
    assert_eq!(first["retention_upgraded"], false);
    assert_eq!(roll(&mut session, 0, None), first);
    // A richer path upgrades the stored candidate's retention and is answered with its own path.
    let upgraded = roll(&mut session, 0, full());
    assert_eq!(candidate_hash(&upgraded), a);
    assert_eq!(upgraded["retention_upgraded"], true);
    assert_eq!(
        upgraded["candidate"]["path"]["retention"],
        json!({"mode": "full"})
    );
    assert_eq!(
        upgraded["candidate"]["path"]["samples"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        inspect(&mut session, &a)["candidate"]["path"]["retention"],
        json!({"mode": "full"})
    );
    // A poorer path never downgrades what is stored, and is answered with the path it asked for.
    let poorer = roll(&mut session, 0, None);
    assert_eq!(poorer["retention_upgraded"], false);
    assert_eq!(poorer, first);
    assert_eq!(
        inspect(&mut session, &a)["candidate"]["path"]["retention"],
        json!({"mode": "full"})
    );

    // reroll_candidate: a new successor supersedes its pending source.
    let view = json!({"requested_observables": ["x"], "include_path": true});
    let b_new = ok(
        &mut session,
        "reroll_candidate",
        json!({"candidate_hash": a, "view": view}),
    );
    let b = candidate_hash(&b_new);
    assert_eq!(b_new["status"], "pending");
    assert_eq!(b_new["retention_upgraded"], false);
    assert_eq!(inspect(&mut session, &a)["status"], "superseded");
    // The same query rolled again finds A, superseded, and answers with A's stored status.
    let superseded = roll(&mut session, 0, full());
    assert_eq!(superseded["status"], "superseded");
    assert_eq!(superseded["retention_upgraded"], false);
    // Rerolling the superseded A finds B: B's status, the caller's view, nothing changed.
    let again = ok(
        &mut session,
        "reroll_candidate",
        json!({"candidate_hash": a, "view": view}),
    );
    assert_eq!(again, b_new);
    // Rerolling B finds C, rolled earlier with a poorer path: C is upgraded and B superseded.
    let c_first = roll(&mut session, 2, None);
    let c = candidate_hash(&c_first);
    let c_found = ok(
        &mut session,
        "reroll_candidate",
        json!({"candidate_hash": b, "view": view}),
    );
    assert_eq!(candidate_hash(&c_found), c);
    assert_eq!(c_found["status"], "pending");
    assert_eq!(c_found["retention_upgraded"], true);
    assert_eq!(inspect(&mut session, &b)["status"], "superseded");
    assert_eq!(
        inspect(&mut session, &c)["candidate"]["path"]["retention"],
        json!({"mode": "full"})
    );
    // The whole of each answer is pinned.
    let pinned = json!({
        "first_roll": first, "upgraded_roll": upgraded, "superseded_roll": superseded,
        "new_reroll": b_new, "existing_reroll_upgraded": c_found,
    });
    assert_fixture("existing_candidate_answers.json", &pinned);
}

#[test]
fn an_existing_candidate_keeps_its_status_and_writes_only_what_changes() {
    let path = temp_path("existing").with_extension("sqlite");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let model_hash = ok(
        &mut session,
        "register_model",
        json!({"model": base_model()}),
    )["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    ok(
        &mut session,
        "create_world",
        json!({"model_hash": model_hash, "world_id": "world"}),
    );
    let roll = |session: &mut MachineSession, index: u64, path: Option<Value>| {
        ok(
            session,
            "roll_world",
            json!({"world_id": "world", "query": query(index, path)}),
        )
    };
    let status = |session: &mut MachineSession, hash: &str| {
        ok(
            session,
            "inspect_candidate",
            json!({"candidate_hash": hash}),
        )["status"]
            .clone()
    };
    let a = candidate_hash(&roll(&mut session, 0, None));
    let b = candidate_hash(&roll(&mut session, 1, None));

    // Rerolling A finds B with the same path: only A, still pending, is superseded and written.
    let before = generation(&path);
    let view = json!({"requested_observables": ["x"], "include_path": true});
    let found = ok(
        &mut session,
        "reroll_candidate",
        json!({"candidate_hash": a, "view": view}),
    );
    assert_eq!(candidate_hash(&found), b);
    assert_eq!(found["status"], "pending");
    assert_eq!(found["retention_upgraded"], false);
    assert_eq!(generation(&path), Some(before.unwrap() + 1));
    assert_eq!(status(&mut session, &a), "superseded");

    // A rejected candidate rolled again keeps its status; nothing is written unless its path grows richer.
    ok(
        &mut session,
        "reject_candidate",
        json!({"candidate_hash": b}),
    );
    let before = generation(&path);
    let rejected = roll(&mut session, 1, None);
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(rejected["retention_upgraded"], false);
    assert_eq!(generation(&path), before);
    let rejected_upgraded = roll(&mut session, 1, full());
    assert_eq!(rejected_upgraded["status"], "rejected");
    assert_eq!(rejected_upgraded["retention_upgraded"], true);
    assert_eq!(generation(&path), Some(before.unwrap() + 1));
    drop(session);

    let mut reopened = MachineSession::with_state_file(&path).unwrap();
    let stored = ok(
        &mut reopened,
        "inspect_candidate",
        json!({"candidate_hash": b, "view": view}),
    );
    assert_eq!(stored["status"], "rejected");
    assert_eq!(
        stored["candidate"]["path"]["retention"],
        json!({"mode": "full"})
    );
    assert_fixture(
        "existing_candidate_status.json",
        &json!({"reroll_found_successor": found, "rejected_roll": rejected,
                "rejected_roll_upgraded": rejected_upgraded}),
    );
    drop(reopened);
    remove_state(&path);
}

#[test]
fn a_missing_state_directory_reports_an_uncommitted_mutation() {
    let directory = temp_path("missing-directory");
    let path = directory.join("state.sqlite");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let (code, message) = failure(
        &mut session,
        "register_model",
        json!({"model": base_model()}),
    );
    assert_eq!(code, "persistence_error");
    assert_eq!(
        message,
        format!(
            "state mutation was not committed: state file parent directory {} does not exist",
            directory.display()
        )
    );
    let models = ok(
        &mut session,
        "validate_model",
        json!({"model": base_model()}),
    );
    let (code, _) = failure(
        &mut session,
        "get_model",
        json!({"model_hash": models["summary"]["model_hash"]}),
    );
    assert_eq!(code, "not_found");
    assert!(!directory.exists());
}

#[test]
fn a_stale_writer_reports_an_uncommitted_mutation_and_reloads() {
    let path = temp_path("stale").with_extension("sqlite");
    let mut first = MachineSession::with_state_file(&path).unwrap();
    ok(&mut first, "register_model", json!({"model": base_model()}));
    let mut stale = MachineSession::with_state_file(&path).unwrap();
    let mut other = base_model();
    other["id"] = json!("other-model");
    let other_hash =
        ok(&mut first, "register_model", json!({"model": other}))["summary"]["model_hash"].clone();
    let mut third = base_model();
    third["id"] = json!("third-model");
    let (code, message) = failure(&mut stale, "register_model", json!({"model": third}));
    assert_eq!(code, "persistence_error");
    assert_eq!(
        message,
        "state mutation was not committed: SQLite session changed since it was opened; reopen before writing"
    );
    // The stale session reloaded the stored state: it sees the other writer's model, not its own.
    ok(&mut stale, "get_model", json!({"model_hash": other_hash}));
    let third_hash =
        ok(&mut stale, "validate_model", json!({"model": third}))["summary"]["model_hash"].clone();
    assert_eq!(
        failure(&mut stale, "get_model", json!({"model_hash": third_hash})).0,
        "not_found"
    );
    // And it writes again from the reloaded generation.
    ok(&mut stale, "register_model", json!({"model": third}));
    assert_eq!(generation(&path), Some(3));
    drop(first);
    drop(stale);
    remove_state(&path);
}

/// Whether this process can read a file whose permissions forbid it (true when running as root).
#[cfg(unix)]
fn permissions_are_bypassed(path: &Path) -> bool {
    std::fs::File::open(path).is_ok()
}

#[cfg(unix)]
#[test]
fn an_unreadable_state_file_reports_the_failed_reload_and_then_refuses_mutations() {
    use std::os::unix::fs::PermissionsExt;
    let path = temp_path("unreadable").with_extension("sqlite");
    let mut session = MachineSession::with_state_file(&path).unwrap();
    ok(
        &mut session,
        "register_model",
        json!({"model": base_model()}),
    );
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    if permissions_are_bypassed(&path) {
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        remove_state(&path);
        return;
    }
    let mut other = base_model();
    other["id"] = json!("other-model");
    let (code, message) = failure(&mut session, "register_model", json!({"model": other}));
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(code, "persistence_error");
    let shown = path.display();
    assert_eq!(
        message,
        format!(
            "state mutation was not committed: failed to open SQLite state file {shown}: unable to open database file: \
             {shown}; authoritative reload also failed: failed to inspect SQLite state file {shown}: unable to open \
             database file: {shown}"
        )
    );
    // The failed reload left the unwritten change in memory: it is still read, and no further mutation is accepted.
    let other_hash = ok(&mut session, "validate_model", json!({"model": other}))["summary"]
        ["model_hash"]
        .clone();
    ok(&mut session, "get_model", json!({"model_hash": other_hash}));
    let mut third = base_model();
    third["id"] = json!("third-model");
    let refused = send(
        &mut session,
        "register_model",
        json!({"model": third, "request_id": "after"}),
    );
    assert_eq!(
        envelope(&refused),
        json!({"schema": "life-sim-rust-response/v1", "request_id": "after", "ok": false,
               "error": {"code": "internal_error", "message": "durable session began a command with unflushed dirty rows"}})
    );
    // The file itself still holds only the first model.
    let mut reopened = MachineSession::with_state_file(&path).unwrap();
    assert_eq!(
        failure(
            &mut reopened,
            "get_model",
            json!({"model_hash": other_hash})
        )
        .0,
        "not_found"
    );
    drop(session);
    remove_state(&path);
}

/// A session with a model, its genesis world, a narrative graph about that world, and a checkpoint freezing all
/// three, with the checkpoint's portable export.
fn checkpointed_session() -> (MachineSession, Value) {
    let mut session = MachineSession::default();
    let model_hash = ok(
        &mut session,
        "register_model",
        json!({"model": base_model()}),
    )["summary"]["model_hash"]
        .clone();
    let world = ok(
        &mut session,
        "create_world",
        json!({"model_hash": model_hash, "world_id": "world"}),
    );
    let graph = ok(
        &mut session,
        "register_narrative_graph",
        json!({"narrative_graph": {
            "schema": "life-sim-rust-narrative-graph/v1", "id": "story",
            "revision": {"number": 0, "reason": "Frozen source", "provenance": ["protocol test"]},
            "source": {"kind": "world", "world_id": "world", "world_hash": world["world_hash"]},
            "roots": ["root"], "nodes": [narrative_node("root", "story", "document_root")], "edges": []
        }}),
    );
    ok(
        &mut session,
        "register_project_checkpoint",
        json!({"project_checkpoint": {
            "schema": "life-sim-rust-project-checkpoint/v1", "name": "full",
            "document": {"schema": "life-sim-rust-project-document/v1", "media_type": "text/plain",
                         "content": {"encoding": "utf8", "text": "A frozen draft."},
                         "canonical_external_path": "drafts/full.txt"},
            "model_hash": model_hash, "world_hash": world["world_hash"],
            "narrative_graph_hash": graph["summary"]["graph_hash"],
            "reason": "Freeze everything", "provenance": ["protocol test"]
        }}),
    );
    let exported = ok(
        &mut session,
        "export_project_checkpoint",
        json!({"project_checkpoint_id": "full"}),
    )["project_checkpoint"]
        .clone();
    (session, exported)
}

#[test]
fn checkpoint_registration_reports_the_first_problem_in_order() {
    let (mut session, exported) = checkpointed_session();
    let simple = json!({
        "schema": "life-sim-rust-project-checkpoint/v1", "name": "simple",
        "document": {"schema": "life-sim-rust-project-document/v1", "media_type": "text/plain",
                     "content": {"encoding": "utf8", "text": "Plain."}},
        "reason": "A document only", "provenance": ["protocol test"]
    });
    let with = |base: &Value, changes: &[(&str, Value)]| {
        let mut definition = base.clone();
        for (pointer, value) in changes {
            let (parent, key) = pointer.rsplit_once('/').unwrap();
            let target = if parent.is_empty() {
                &mut definition
            } else {
                definition.pointer_mut(parent).unwrap()
            };
            if value.is_null() {
                target.as_object_mut().unwrap().remove(key);
            } else {
                target[key] = value.clone();
            }
        }
        definition
    };
    let graph_json: Value =
        serde_json::from_str(exported["narrative_graph_snapshot_json"].as_str().unwrap()).unwrap();
    let mut tampered_definition = graph_json.clone();
    tampered_definition["definition"]["nodes"][0]["text"] = json!("a different story");
    let mut tampered_snapshot = graph_json.clone();
    tampered_snapshot["snapshot"]["state"]["x"]["value"] = json!(2.0);
    let world_json: Value =
        serde_json::from_str(exported["world_snapshot_json"].as_str().unwrap()).unwrap();
    let hex64 = "ab".repeat(32);
    let cases: Vec<(&str, Value)> = vec![
        ("schema", with(&simple, &[("/schema", json!("x"))])),
        ("empty name", with(&simple, &[("/name", json!(" "))])),
        (
            "hash-shaped name",
            with(&simple, &[("/name", json!(hex64))]),
        ),
        ("taken name", with(&simple, &[("/name", json!("full"))])),
        (
            "long reason",
            with(&simple, &[("/reason", json!("r".repeat(9_000)))]),
        ),
        (
            "blank provenance",
            with(&simple, &[("/provenance", json!([" "]))]),
        ),
        (
            "unknown parent",
            with(&simple, &[("/parent_checkpoint", json!("nope"))]),
        ),
        (
            "document schema",
            with(&simple, &[("/document/schema", json!("x"))]),
        ),
        (
            "empty media type",
            with(&simple, &[("/document/media_type", json!(""))]),
        ),
        (
            "blank path",
            with(
                &simple,
                &[("/document/canonical_external_path", json!(" "))],
            ),
        ),
        (
            "two model forms",
            with(
                &exported,
                &[("/name", json!("m")), ("/model_snapshot", base_model())],
            ),
        ),
        (
            "bad model json",
            with(&simple, &[("/model_snapshot_json", json!("{"))]),
        ),
        (
            "invalid model",
            with(
                &simple,
                &[(
                    "/model_snapshot",
                    with(&base_model(), &[("/processes", json!([]))]),
                )],
            ),
        ),
        (
            "two world forms",
            with(
                &exported,
                &[
                    ("/name", json!("w")),
                    ("/world_snapshot", world_json.clone()),
                ],
            ),
        ),
        (
            "bad world json",
            with(&simple, &[("/world_snapshot_json", json!("[]"))]),
        ),
        (
            "world hash mismatch",
            with(
                &exported,
                &[("/name", json!("w2")), ("/world_hash", json!(hex64))],
            ),
        ),
        (
            "unknown world",
            with(&simple, &[("/world_hash", json!(hex64))]),
        ),
        (
            "two graph forms",
            with(
                &exported,
                &[
                    ("/name", json!("g")),
                    ("/narrative_graph_snapshot", graph_json.clone()),
                ],
            ),
        ),
        (
            "bad graph json",
            with(&simple, &[("/narrative_graph_snapshot_json", json!("1"))]),
        ),
        (
            "unknown graph snapshot",
            with(&simple, &[("/narrative_graph_snapshot_hash", json!(hex64))]),
        ),
        (
            "unknown active graph",
            with(&simple, &[("/narrative_graph_hash", json!(hex64))]),
        ),
        (
            "graph hash mismatch",
            with(
                &exported,
                &[
                    ("/name", json!("g2")),
                    ("/narrative_graph_hash", json!(hex64)),
                ],
            ),
        ),
        (
            "graph identity mismatch",
            with(
                &exported,
                &[
                    ("/name", json!("g3")),
                    ("/narrative_graph_snapshot_hash", json!(hex64)),
                ],
            ),
        ),
        (
            "model disagrees",
            with(
                &exported,
                &[("/name", json!("m2")), ("/model_hash", json!(hex64))],
            ),
        ),
        (
            "unknown model",
            with(&simple, &[("/model_hash", json!(hex64))]),
        ),
        (
            "tampered graph definition",
            with(
                &exported,
                &[
                    ("/name", json!("t1")),
                    ("/narrative_graph_snapshot_hash", Value::Null),
                    (
                        "/narrative_graph_snapshot_json",
                        json!(tampered_definition.to_string()),
                    ),
                ],
            ),
        ),
        (
            "tampered graph snapshot",
            with(
                &exported,
                &[
                    ("/name", json!("t2")),
                    ("/narrative_graph_snapshot_hash", Value::Null),
                    (
                        "/narrative_graph_snapshot_json",
                        json!(tampered_snapshot.to_string()),
                    ),
                ],
            ),
        ),
        (
            "document before snapshots",
            with(
                &exported,
                &[
                    ("/name", json!("o1")),
                    ("/document/schema", json!("x")),
                    ("/model_snapshot", base_model()),
                ],
            ),
        ),
        (
            "parent before document",
            with(
                &simple,
                &[
                    ("/parent_checkpoint", json!("nope")),
                    ("/document/schema", json!("x")),
                ],
            ),
        ),
        (
            "name before everything",
            with(&exported, &[("/model_snapshot", base_model())]),
        ),
    ];
    let mut answers = serde_json::Map::new();
    for (label, definition) in cases {
        let response = send(
            &mut session,
            "register_project_checkpoint",
            json!({ "project_checkpoint": definition }),
        );
        assert!(!response.ok, "{label} was accepted");
        answers.insert(label.to_owned(), envelope(&response)["error"].clone());
    }
    // The same checkpoint registered again is refused by its name, which comes first.
    let again = send(
        &mut session,
        "register_project_checkpoint",
        json!({ "project_checkpoint": exported }),
    );
    answers.insert(
        "registered again".to_owned(),
        envelope(&again)["error"].clone(),
    );
    let listed = ok(
        &mut session,
        "get_project_checkpoint",
        json!({"project_checkpoint_id": "full"}),
    );
    // The export registers into a session that holds none of its material, under the same hash.
    let mut fresh = MachineSession::default();
    let imported = ok(
        &mut fresh,
        "register_project_checkpoint",
        json!({ "project_checkpoint": exported }),
    );
    assert_eq!(imported["checkpoint_hash"], listed["checkpoint_hash"]);
    let rendered = ok(
        &mut fresh,
        "render_project_checkpoint",
        json!({"project_checkpoint_id": "full"}),
    );
    answers.insert("imported".to_owned(), imported);
    answers.insert("imported render".to_owned(), rendered);
    assert_fixture(
        "checkpoint_registration_answers.json",
        &Value::Object(answers),
    );
}
