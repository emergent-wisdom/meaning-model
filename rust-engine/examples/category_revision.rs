//! Run with `cargo run --example category_revision` from `rust-engine`.
//!
//! Start with an unweighted Thing, supply application-specific categories, then
//! explicitly revise those categories. All exercise counts are invented fixture
//! data, not observed learning outcomes. This example registers model definitions
//! in memory; it creates no world and performs no world migration.
//! The revisions describe the same snapshot, not learning progress through time.

use life_sim_engine::{
    MachineSession, ModelRevision, NormalizedCutAnswer, NormalizedCutDefinition,
    OptionalProfileCompiler, ThingScaffoldProfile, COMMAND_SCHEMA,
};
use serde_json::{json, Value};

fn execute(session: &mut MachineSession, operation: &str, mut fields: Value) -> Value {
    fields["schema"] = json!(COMMAND_SCHEMA);
    fields["operation"] = json!(operation);
    let response = session.parse_and_execute(&fields.to_string());
    assert!(response.ok, "{operation}: {:?}", response.error);
    response.result.expect("successful command result")
}

fn answers(counts: &[(&str, u32)]) -> Vec<NormalizedCutAnswer> {
    counts
        .iter()
        .map(|(key, count)| NormalizedCutAnswer {
            key: (*key).to_owned(),
            weight: f64::from(*count) / 10.0,
        })
        .collect()
}

/// An illustrative application policy over this example's authored categories.
/// It neither infers learning nor implements validated pedagogical advice.
pub fn suggested_next_step(model: &Value) -> &'static str {
    let cut = model["meaning_model"]["normalized_cuts"]
        .as_array()
        .expect("model Cuts")
        .iter()
        .find(|cut| cut["id"] == "practice-status")
        .expect("application practice-status Cut");
    let answers = cut["answers"].as_array().expect("Cut answers");
    let share = |key: &str| {
        answers
            .iter()
            .find(|answer| answer["key"] == key)
            .map_or(0.0, |answer| answer["weight"].as_f64().unwrap())
    };

    if share("attempted") > 0.0 {
        "Ask which attempted exercises still need practice and which are ready for review."
    } else if share("ready_for_review") > 0.0 {
        "Review the ready subset, then continue any remaining practice."
    } else if share("practicing") > 0.0 {
        "Continue practice; no exercises are currently marked ready for review."
    } else {
        "Clarify the unclassified or not-yet-attempted work before choosing a next step."
    }
}

/// Return both full definitions fetched by hash after the vocabulary revision.
pub fn run_example() -> Value {
    let provenance = vec!["authored ten-exercise example; synthetic counts".to_owned()];
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "learning-category-example",
        "day",
        "Describe the practice status of ten planned exercises.",
        provenance.clone(),
    );
    compiler
        .apply(&ThingScaffoldProfile {
            id: "learning".to_owned(),
            thing_id: "project".to_owned(),
            boundary: "One learning project with ten planned exercises.".to_owned(),
            continuity_criterion: "The same project and the same ten exercises.".to_owned(),
            interval: None,
            lifecycle_description: "The learning project's complete coarse history.".to_owned(),
            provenance: provenance.clone(),
        })
        .expect("valid structural starter");
    let mut original = compiler.finish().expect("valid starter model");

    // The starter supplies identity and a lifecycle, not a practice taxonomy.
    // The application defines one status per exercise at this example snapshot:
    // five not attempted, four attempted, and one not yet classified.
    let meaning = original.meaning_model.as_mut().expect("starter semantics");
    assert!(meaning.normalized_cuts.is_empty());
    meaning.normalized_cuts.push(NormalizedCutDefinition {
        id: "practice-status".to_owned(),
        parent_event_id: "event.profile.learning.thing.project.life".to_owned(),
        question: "At this authored snapshot, what is each planned exercise's practice status?"
            .to_owned(),
        unit: "share of the ten planned exercises".to_owned(),
        answers: answers(&[("not_attempted", 5), ("attempted", 4), ("remainder", 1)]),
        conditioning: None,
        provenance: provenance.clone(),
    });

    let mut session = MachineSession::default();
    // Registration validates the complete model, including the authored Cut.
    let registered = execute(&mut session, "register_model", json!({"model": original}));
    let original_hash = registered["summary"]["model_hash"]
        .as_str()
        .expect("registered model hash")
        .to_owned();

    // Revise the application vocabulary: replace "attempted" with two more
    // useful statuses. The author explicitly assigns three exercises still
    // practicing and one ready for review at the SAME snapshot. The engine does
    // not infer this split, and revision 1 does not mean a later learning stage.
    let mut revised = original.clone();
    revised.revision = ModelRevision {
        number: 1,
        previous_model_hash: Some(original_hash.clone()),
        reason:
            "Replace attempted with practicing and ready_for_review; retain the same exercise set."
                .to_owned(),
        provenance: provenance.clone(),
    };
    revised.meaning_model.as_mut().unwrap().normalized_cuts[0].answers = answers(&[
        ("not_attempted", 5),
        ("practicing", 3),
        ("ready_for_review", 1),
        ("remainder", 1),
    ]);
    let successor = execute(&mut session, "revise_model", json!({"model": revised}));
    let revised_hash = successor["summary"]["model_hash"]
        .as_str()
        .expect("revised model hash");

    // Both queries happen after revision, so the old result comes from the
    // model store rather than merely from our saved local copy.
    let original_after_revision = execute(
        &mut session,
        "get_model",
        json!({"model_hash": original_hash}),
    );
    let revised_after_revision = execute(
        &mut session,
        "get_model",
        json!({"model_hash": revised_hash}),
    );
    assert_eq!(original_after_revision["model"], registered["model"]);

    // Active use comes from a declared application policy reading the fetched
    // records. Finer categories can support a more specific suggestion without
    // implying that the learner has changed or improved.
    let next_steps = json!({
        "basis": "Illustrative authored policy; no inferred learning or validated pedagogy.",
        "original": suggested_next_step(&original_after_revision["model"]),
        "revised": suggested_next_step(&revised_after_revision["model"]),
    });
    json!({
        "scope": "Synthetic category revision at the same snapshot; no progress through time, observed outcomes, or world migration.",
        "original": original_after_revision,
        "revised": revised_after_revision,
        "next_steps": next_steps,
    })
}

#[cfg(not(test))]
fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&run_example()).expect("example report must serialize")
    );
}
