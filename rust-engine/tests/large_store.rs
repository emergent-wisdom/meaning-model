//! A durable store that outgrew holding everything: revisions are sealed when they are written, an open trusts the
//! seals and reads rows when they are needed, an audit validates everything again, and the engine answers lineage
//! questions from headers alone.
use life_sim_engine::MachineSession;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

fn command(operation: &str, fields: Value) -> String {
    let mut value = json!({ "schema": "life-sim-rust-command/v1", "request_id": format!("{operation}-test"), "operation": operation });
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    value.to_string()
}

fn execute(session: &mut MachineSession, operation: &str, fields: Value) -> Value {
    let response = session.parse_and_execute(&command(operation, fields));
    assert!(
        response.ok,
        "{operation}: {:?}",
        response.error.map(|error| error.message)
    );
    response.result.unwrap()
}

fn failure(session: &mut MachineSession, operation: &str, fields: Value) -> String {
    let response = session.parse_and_execute(&command(operation, fields));
    assert!(!response.ok, "{operation} was expected to fail");
    response.error.unwrap().message
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

fn remove_store(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

fn model(revision: u64, previous: Option<&str>, trust: f64) -> Value {
    json!({
        "schema": "life-sim-rust-model/v1",
        "id": "large-store-model",
        "time_unit": "year",
        "revision": {
            "number": revision,
            "previous_model_hash": previous,
            "reason": format!("revision {revision}"),
            "provenance": ["large store test"]
        },
        "processes": [{
            "id": "society.trust",
            "value_type": { "kind": "scalar", "bounds": { "minimum": 0.0, "maximum": 1.0 } },
            "initial_value": { "kind": "scalar", "value": trust },
            "provenance": ["large store test"],
            "support": ["trust coordinate"],
            "access_scopes": []
        }],
        "decomposition": [],
        "dependencies": [],
        "laws": [],
        "initial_claims": [],
        "meaning_model": {
            "schema": "life-sim-rust-meaning-model/v1",
            "concepts": [],
            "events": [{
                "id": "society.turn",
                "boundary": format!("The turn as revision {revision} saw it."),
                "process_ids": ["society.trust"],
                "provenance": ["large store test"]
            }]
        }
    })
}

fn node(id: &str, text: String) -> Value {
    json!({
        "id": id, "node_type": "paragraph", "role": "story_passage", "text": text,
        "epistemic_status": "fictional_canon", "evidence_type": "fictional_canon",
        "authority": { "source": "author", "weight": 1.0 },
        "render": "include", "training": "include", "provenance": ["large store test"]
    })
}

fn edge(id: &str, target: &str, order: u64) -> Value {
    json!({
        "id": id, "source": { "kind": "node", "node_id": "root" }, "target": { "kind": "node", "node_id": target },
        "family": "structural", "relation": "contains", "order": order, "provenance": ["large store test"]
    })
}

/// A store with a lineage of model revisions (one branch off revision 4) and a graph of revisions bound to the first.
struct Built {
    models: Vec<(String, Value)>,
    branch: String,
    graphs: Vec<String>,
}

fn build_store(path: &Path, revisions: u64, appends: u64) -> Built {
    let mut session = MachineSession::with_state_file(path).unwrap();
    let mut models: Vec<(String, Value)> = Vec::new();
    for number in 0..=revisions {
        let previous = models.last().map(|(hash, _)| hash.clone());
        let stored = execute(
            &mut session,
            if number == 0 {
                "register_model"
            } else {
                "revise_model"
            },
            json!({ "model": model(number, previous.as_deref(), 0.5 + number as f64 / 1000.0) }),
        );
        models.push((
            stored["summary"]["model_hash"].as_str().unwrap().to_owned(),
            stored["model"].clone(),
        ));
    }
    let branch = execute(
        &mut session,
        "revise_model",
        json!({ "model": model(5, Some(&models[4].0), 0.9) }),
    )["summary"]["model_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let root = json!({
        "schema": "life-sim-rust-narrative-graph/v1",
        "id": "large-store-story",
        "revision": { "number": 0, "reason": "Root.", "provenance": ["large store test"] },
        "source": { "kind": "model", "model_hash": models[0].0 },
        "roots": ["root"],
        "nodes": [{
            "id": "root", "node_type": "short_story", "role": "document_root", "epistemic_status": "fictional_artifact",
            "evidence_type": "fictional_canon", "render": "exclude", "training": "exclude", "provenance": ["large store test"]
        }, node("first", "The first passage.".to_owned())],
        "edges": [edge("root-first", "first", 0)]
    });
    let mut head = execute(
        &mut session,
        "register_narrative_graph",
        json!({ "narrative_graph": root }),
    )["summary"]["graph_hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut graphs = vec![head.clone()];
    for index in 0..appends {
        let id = format!("passage-{index:03}");
        let stored = execute(
            &mut session,
            "apply_narrative_batch",
            json!({ "narrative_batch": {
                "schema": "life-sim-rust-narrative-batch/v1",
                "previous_graph_hash": head,
                "reason": format!("append {index}"),
                "provenance": ["large store test"],
                "add_nodes": [node(&id, format!("Passage {index} of the story."))],
                "add_edges": [edge(&format!("root-{id}"), &id, index + 1)]
            } }),
        );
        head = stored["summary"]["graph_hash"].as_str().unwrap().to_owned();
        graphs.push(head.clone());
    }
    Built {
        models,
        branch,
        graphs,
    }
}

fn seal_count(path: &Path, kind: &str) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT count(*) FROM revision_seals WHERE kind = ?1",
            [kind],
            |row| row.get(0),
        )
        .unwrap()
}

fn query_full(session: &mut MachineSession, graph_hash: &str) -> Value {
    execute(
        session,
        "query_narrative_graph",
        json!({ "narrative_graph_hash": graph_hash, "narrative_query": { "mode": "full", "include_content": true } }),
    )
}

#[test]
fn revisions_are_sealed_as_they_are_written_and_a_reopened_store_reads_them_when_needed() {
    let path = state_path("large-store-sealed");
    let built = build_store(&path, 30, 20);
    assert_eq!(
        seal_count(&path, "model"),
        32,
        "every model revision, the branch included, is sealed in the write that stored it"
    );
    assert_eq!(seal_count(&path, "narrative"), 21);

    let mut session = MachineSession::with_state_file(&path).unwrap();
    let status = execute(&mut session, "store_status", json!({}));
    assert_eq!(status["models"]["count"], 32);
    assert_eq!(status["models"]["sealed"], 32);
    assert_eq!(
        status["models"]["held_bytes"], 0,
        "a reopened store holds no rows of its own: the file has them"
    );
    assert_eq!(status["narrative_revisions"]["sealed"], 21);
    assert_eq!(status["narrative_revisions"]["held_bytes"], 0);
    assert!(status["narrative_revisions"]["row_bytes"].as_u64().unwrap() > 0);

    // An early revision of each is read on demand, exactly as it was stored.
    for (hash, definition) in [&built.models[3], &built.models[17]] {
        let read = execute(&mut session, "get_model", json!({ "model_hash": hash }));
        assert_eq!(&read["model"], definition);
    }
    let early = query_full(&mut session, &built.graphs[2]);
    assert_eq!(early["graph_hash"], built.graphs[2]);
    assert_eq!(early["nodes"].as_array().unwrap().len(), 4);
    let head = query_full(&mut session, built.graphs.last().unwrap());
    assert_eq!(head["nodes"].as_array().unwrap().len(), 22);

    // New revisions in the reopened session are sealed too, chained to the sealed ones.
    execute(
        &mut session,
        "revise_model",
        json!({ "model": model(31, Some(&built.models[30].0), 0.7) }),
    );
    drop(session);
    assert_eq!(seal_count(&path, "model"), 33);
    let reopened = MachineSession::with_state_file(&path).unwrap();
    drop(reopened);
    assert_eq!(
        seal_count(&path, "model"),
        33,
        "a trusted open writes no seals"
    );
    remove_store(&path);
}

#[test]
fn a_store_without_seals_is_validated_once_on_open_and_sealed() {
    let path = state_path("large-store-unsealed");
    let built = build_store(&path, 12, 8);
    // As a store written before seals, or by an engine that predates them.
    Connection::open(&path)
        .unwrap()
        .execute("DELETE FROM revision_seals", [])
        .unwrap();
    let mut session = MachineSession::with_state_file(&path).unwrap();
    assert_eq!(seal_count(&path, "model"), 14);
    assert_eq!(seal_count(&path, "narrative"), 9);
    let read = execute(
        &mut session,
        "get_model",
        json!({ "model_hash": built.models[2].0 }),
    );
    assert_eq!(read["model"], built.models[2].1);
    drop(session);

    // A seal whose own fields no longer hash to it is not trusted: its revision is validated again and resealed.
    let connection = Connection::open(&path).unwrap();
    let before: String = connection
        .query_row(
            "SELECT seal_sha256 FROM revision_seals WHERE object_hash = ?1",
            [&built.models[6].0],
            |row| row.get(0),
        )
        .unwrap();
    connection
        .execute(
            "UPDATE revision_seals SET header_json = CAST('{}' AS BLOB) WHERE object_hash = ?1",
            [&built.models[6].0],
        )
        .unwrap();
    drop(connection);
    MachineSession::with_state_file(&path).unwrap();
    let after: (String, Vec<u8>) = Connection::open(&path)
        .unwrap()
        .query_row(
            "SELECT seal_sha256, header_json FROM revision_seals WHERE object_hash = ?1",
            [&built.models[6].0],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        after.0, before,
        "validated again, the revision gets the same seal back"
    );
    assert_ne!(after.1, b"{}".to_vec());
    remove_store(&path);
}

#[test]
fn a_row_changed_after_it_was_sealed_is_refused() {
    // A changed row of another size loses its seal's trust, is validated again, and fails.
    let path = state_path("large-store-tampered-size");
    let built = build_store(&path, 6, 6);
    let connection = Connection::open(&path).unwrap();
    let json: Vec<u8> = connection
        .query_row(
            "SELECT revision_json FROM narrative_revisions WHERE graph_hash = ?1",
            [&built.graphs[3]],
            |row| row.get(0),
        )
        .unwrap();
    let mut record: Value = serde_json::from_slice(&json).unwrap();
    record["revision"]["reason"] = json!("a reason someone changed afterwards");
    connection
        .execute(
            "UPDATE narrative_revisions SET revision_json = ?1 WHERE graph_hash = ?2",
            rusqlite::params![serde_json::to_vec(&record).unwrap(), built.graphs[3]],
        )
        .unwrap();
    drop(connection);
    let failure = MachineSession::with_state_file(&path).unwrap_err();
    assert!(
        failure.to_string().contains("record hash is invalid"),
        "{failure}"
    );
    remove_store(&path);

    // A changed row of the same size keeps a whole seal, and is refused when it is read: here at open, since the
    // model head is rebuilt through it.
    let path = state_path("large-store-tampered-bytes");
    let built = build_store(&path, 6, 2);
    let connection = Connection::open(&path).unwrap();
    let json: Vec<u8> = connection
        .query_row(
            "SELECT definition_json FROM models WHERE model_hash = ?1",
            [&built.models[3].0],
            |row| row.get(0),
        )
        .unwrap();
    let text = String::from_utf8(json).unwrap();
    assert!(text.contains("revision 3"));
    let changed = text.replacen("revision 3", "revision 9", 1);
    connection
        .execute(
            "UPDATE models SET definition_json = ?1 WHERE model_hash = ?2",
            rusqlite::params![changed.into_bytes(), built.models[3].0],
        )
        .unwrap();
    drop(connection);
    let failure = MachineSession::with_state_file(&path).unwrap_err();
    assert!(
        failure.to_string().contains("no longer matches its seal"),
        "{failure}"
    );
    remove_store(&path);
}

#[test]
fn audit_store_validates_every_revision_again_and_reseals_what_is_missing() {
    let path = state_path("large-store-audit");
    let built = build_store(&path, 8, 5);
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let audit = execute(&mut session, "audit_store", json!({}));
    assert_eq!(audit["verified"], true);
    assert_eq!(audit["models"], 10);
    assert_eq!(audit["narrative_revisions"], 6);
    assert_eq!(
        audit["seals"],
        json!({ "matched": 16, "missing": 0, "differing": 0 })
    );

    Connection::open(&path)
        .unwrap()
        .execute(
            "DELETE FROM revision_seals WHERE object_hash IN (?1, ?2)",
            [&built.models[2].0, &built.graphs[4]],
        )
        .unwrap();
    let audit = execute(&mut session, "audit_store", json!({}));
    assert_eq!(
        audit["seals"],
        json!({ "matched": 14, "missing": 2, "differing": 0 })
    );
    assert_eq!(audit["resealed"], 0);
    let audit = execute(
        &mut session,
        "audit_store",
        json!({ "store_audit": { "reseal": true } }),
    );
    assert_eq!(audit["resealed"], 2);
    let audit = execute(&mut session, "audit_store", json!({}));
    assert_eq!(audit["seals"]["matched"], 16);
    drop(session);

    let memory = failure(&mut MachineSession::default(), "audit_store", json!({}));
    assert!(memory.contains("state file"));

    // The same audit from the command line, for a store no server has open.
    let output = Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .args(["--audit", "--state-file"])
        .arg(&path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let printed: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(printed["result"]["verified"], true);
    remove_store(&path);
}

#[test]
fn lineage_and_heads_are_read_from_headers() {
    let path = state_path("large-store-lineage");
    let built = build_store(&path, 10, 1);
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let head = &built.models[10].0;
    let lineage = execute(
        &mut session,
        "model_lineage",
        json!({ "model_hash": head, "model_lineage": { "stop_at_model_hash": built.models[2].0 } }),
    );
    let revisions = lineage["revisions"].as_array().unwrap();
    assert_eq!(revisions.len(), 9);
    assert_eq!(revisions[0]["model_hash"], *head);
    assert_eq!(revisions[0]["revision_number"], 10);
    assert_eq!(revisions[8]["model_hash"], built.models[2].0);
    assert_eq!(revisions[3]["provenance"], json!(["large store test"]));
    assert_eq!(lineage["reached_stop_at"], true);
    assert_eq!(lineage["complete"], true);
    let whole = execute(&mut session, "model_lineage", json!({ "model_hash": head }));
    assert_eq!(whole["revisions"].as_array().unwrap().len(), 11);
    assert!(whole["revisions"][10]["previous_model_hash"].is_null());
    let cut = execute(
        &mut session,
        "model_lineage",
        json!({ "model_hash": head, "model_lineage": { "limit": 3 } }),
    );
    assert_eq!(cut["revisions"].as_array().unwrap().len(), 3);
    assert_eq!(cut["complete"], false);

    let heads = execute(
        &mut session,
        "model_heads",
        json!({ "model_heads": { "descending_from": built.models[4].0 } }),
    );
    let heads = heads["heads"].as_array().unwrap();
    assert_eq!(heads.len(), 2);
    assert_eq!(heads[0]["model_hash"], *head, "the newest head comes first");
    assert_eq!(heads[0]["steps_from"], 6);
    assert_eq!(heads[1]["model_hash"], built.branch);
    assert_eq!(heads[1]["steps_from"], 1);
    let later = execute(
        &mut session,
        "model_heads",
        json!({ "model_heads": { "descending_from": built.models[6].0 } }),
    );
    assert_eq!(later["heads"].as_array().unwrap().len(), 1);
    let none = execute(
        &mut session,
        "model_heads",
        json!({ "model_heads": { "model_id": "another-model" } }),
    );
    assert!(none["heads"].as_array().unwrap().is_empty());
    assert!(failure(
        &mut session,
        "model_lineage",
        json!({ "model_hash": "0".repeat(64) })
    )
    .contains("unknown model"));
    remove_store(&path);
}

#[test]
fn a_session_without_a_file_holds_its_history_and_counts_all_of_it() {
    let mut session = MachineSession::default();
    let first = execute(
        &mut session,
        "register_model",
        json!({ "model": model(0, None, 0.5) }),
    );
    let hash = first["summary"]["model_hash"].as_str().unwrap().to_owned();
    execute(
        &mut session,
        "revise_model",
        json!({ "model": model(1, Some(&hash), 0.6) }),
    );
    let status = execute(&mut session, "store_status", json!({}));
    assert_eq!(status["state_file"], false);
    assert_eq!(
        status["models"]["held_bytes"],
        status["models"]["row_bytes"]
    );
    assert_eq!(status["models"]["sealed"], 0);
}

#[test]
fn heartbeats_name_the_work_on_stderr_when_asked_for() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .arg("--ndjson")
        .env("LIFE_SIM_HEARTBEAT_MS", "50")
        .env_remove("LIFE_SIM_STATE_FILE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Read beats as they come (a freshly built binary can take a while to start), then end the engine.
    let mut stderr = BufReader::new(child.stderr.take().unwrap()).lines();
    let mut beats = Vec::new();
    while beats.len() < 3 {
        let line = stderr.next().expect("the engine kept beating").unwrap();
        beats.push(serde_json::from_str::<Value>(&line).unwrap());
    }
    let mut stdin = child.stdin.take().unwrap();
    stdin
        .write_all(format!("{}\n", command("describe", json!({}))).as_bytes())
        .unwrap();
    drop(stdin);
    child.wait().unwrap();
    assert!(beats
        .iter()
        .all(|beat| beat["schema"] == "life-sim-rust-heartbeat/v1"));
    assert!(beats
        .windows(2)
        .all(|pair| pair[1]["sequence"].as_u64() > pair[0]["sequence"].as_u64()));
    assert!(
        beats[0]["busy"].is_null(),
        "an engine waiting for a command is not busy"
    );

    // Without the variable, stderr carries none.
    let quiet = Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .arg("--ndjson")
        .env_remove("LIFE_SIM_HEARTBEAT_MS")
        .env_remove("LIFE_SIM_STATE_FILE")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(quiet.stderr.is_empty());
}

#[cfg(unix)]
#[test]
fn a_read_only_sealed_store_can_still_be_opened_and_queried() {
    use std::os::unix::fs::PermissionsExt;
    let path = state_path("sealed-read-only");
    let built = build_store(&path, 6, 2);
    let original = fs::metadata(&path).unwrap().permissions();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
    let opened = MachineSession::with_state_file(&path);
    // Restore permissions even if the regression fails, so the temporary file can be removed.
    fs::set_permissions(&path, original).unwrap();
    let mut session =
        opened.expect("reading sealed revisions does not require a writable database");
    let read = execute(
        &mut session,
        "get_model",
        json!({"model_hash": built.models[0].0}),
    );
    assert_eq!(read["model"], built.models[0].1);
    drop(session);
    remove_store(&path);
}

#[test]
fn a_snapshot_bound_to_another_model_is_refused_on_open_and_audit() {
    let path = state_path("large-store-snapshot-binding");
    let built = build_store(&path, 6, 2);
    let mut session = MachineSession::with_state_file(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    assert!(
        connection
            .execute(
                "UPDATE narrative_source_snapshots SET model_hash = ?1",
                [&built.models[3].0],
            )
            .unwrap()
            > 0
    );
    drop(connection);
    let audit_error = failure(&mut session, "audit_store", json!({}));
    assert!(
        audit_error.contains("does not match its model binding"),
        "{audit_error}"
    );
    let open_error = MachineSession::with_state_file(&path)
        .unwrap_err()
        .to_string();
    assert!(
        open_error.contains("does not match its model binding"),
        "{open_error}"
    );
    drop(session);
    remove_store(&path);
}

#[test]
fn a_live_command_heartbeat_names_its_operation_and_request() {
    let path = state_path("large-store-command-heartbeat");
    // A full audit rebuilds this lineage rather than trusting its seals, so a real command stays active across beats.
    build_store(&path, 400, 300);
    let mut child = Command::new(env!("CARGO_BIN_EXE_life-sim-engine"))
        .args(["--ndjson", "--state-file"])
        .arg(&path)
        .env("LIFE_SIM_HEARTBEAT_MS", "50")
        .env_remove("LIFE_SIM_STATE_FILE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (send, receive) = std::sync::mpsc::channel();
    let stderr = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if send.send(line).is_err() {
                break;
            }
        }
    });
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    writeln!(stdin, "{}", command("describe", json!({}))).unwrap();
    let mut ready = String::new();
    stdout.read_line(&mut ready).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&ready).unwrap()["ok"], true);
    writeln!(stdin, "{}", command("audit_store", json!({}))).unwrap();
    drop(stdin);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut saw_command = false;
    let mut notices = Vec::new();
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        let Ok(line) = receive.recv_timeout(left) else {
            break;
        };
        notices.push(line.clone());
        let Ok(beat) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if beat["busy"]["operation"] == "audit_store"
            && beat["busy"]["request_id"] == "audit_store-test"
        {
            saw_command = true;
            break;
        }
    }
    let mut output = String::new();
    stdout.read_line(&mut output).unwrap();
    let status = child.wait().unwrap();
    reader.join().unwrap();
    assert!(
        saw_command,
        "a waiting command must name its parsed operation and request: {notices:?}; stdout: {output}"
    );
    assert!(status.success());
    let response: Value = serde_json::from_str(&output).unwrap();
    assert_eq!(response["ok"], true, "{response}");
    remove_store(&path);
}
