// Exercise the runnable example itself, rather than maintain a second fixture.
#[path = "../examples/category_revision.rs"]
mod category_revision;

use life_sim_engine::{compile_model, ModelDefinition};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn weights(model: &Value) -> BTreeMap<String, f64> {
    model["meaning_model"]["normalized_cuts"][0]["answers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|answer| {
            (
                answer["key"].as_str().unwrap().to_owned(),
                answer["weight"].as_f64().unwrap(),
            )
        })
        .collect()
}

#[test]
fn category_revision_preserves_original_and_starter_without_old_category_leaking() {
    let report = category_revision::run_example();
    let original = &report["original"]["model"];
    let revised = &report["revised"]["model"];

    assert_ne!(
        report["original"]["model_hash"],
        report["revised"]["model_hash"]
    );
    assert_eq!(original["revision"]["number"], 0);
    assert_eq!(revised["revision"]["number"], 1);
    assert_eq!(
        revised["revision"]["previous_model_hash"],
        report["original"]["model_hash"]
    );
    assert_eq!(
        weights(original),
        BTreeMap::from([
            ("attempted".to_owned(), 0.4),
            ("not_attempted".to_owned(), 0.5),
            ("remainder".to_owned(), 0.1),
        ])
    );
    assert_eq!(
        weights(revised),
        BTreeMap::from([
            ("not_attempted".to_owned(), 0.5),
            ("practicing".to_owned(), 0.3),
            ("ready_for_review".to_owned(), 0.1),
            ("remainder".to_owned(), 0.1),
        ])
    );

    // Vocabulary revision changes neither the starter's identity/topology nor
    // the Cut's population and question. No execution law is invented.
    assert_eq!(original["processes"], revised["processes"]);
    assert_eq!(original["laws"], json!([]));
    assert_eq!(revised["laws"], json!([]));
    for field in ["referents", "events", "event_referent_bindings"] {
        assert_eq!(
            original["meaning_model"][field],
            revised["meaning_model"][field]
        );
    }
    for field in ["id", "parent_event_id", "question", "unit"] {
        assert_eq!(
            original["meaning_model"]["normalized_cuts"][0][field],
            revised["meaning_model"]["normalized_cuts"][0][field]
        );
    }
}

#[test]
fn suggested_next_step_reads_categories_and_their_authored_allocation() {
    let report = category_revision::run_example();
    assert_eq!(
        report["next_steps"]["original"],
        "Ask which attempted exercises still need practice and which are ready for review."
    );
    assert_eq!(
        report["next_steps"]["revised"],
        "Review the ready subset, then continue any remaining practice."
    );

    // A separate synthetic fixture keeps every category, but marks none ready
    // and four practicing. This is a policy sensitivity check, not a later event.
    let mut alternative: ModelDefinition =
        serde_json::from_value(report["revised"]["model"].clone()).unwrap();
    for answer in &mut alternative.meaning_model.as_mut().unwrap().normalized_cuts[0].answers {
        match answer.key.as_str() {
            "practicing" => answer.weight = 0.4,
            "ready_for_review" => answer.weight = 0.0,
            _ => {}
        }
    }
    let validated = compile_model(alternative).expect("compatible normalized allocation");
    let alternative = serde_json::to_value(validated.definition()).unwrap();
    assert_eq!(
        category_revision::suggested_next_step(&alternative),
        "Continue practice; no exercises are currently marked ready for review."
    );
}
