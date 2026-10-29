//! What a model revision may change: the process changes any revision may make, and the stricter monotonic additions a
//! genesis refinement requires.
//!
//! A genesis refinement may only add. Every record of the earlier revision stays exactly as it was, apart from a
//! partial temporal recomposition, which may be extended with the child projections it already preserves; so a world
//! refined from an untouched genesis keeps every fact it already had.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::model::compile::CompiledModel;
use crate::model::definition::{LawOperator, ProcessUpdateMode};
use crate::model::meaning::{SemanticCoverageMode, TemporalCutCoverage};
use crate::{error, EngineResult};

pub(crate) fn validate_revision_process_changes(
    previous: &CompiledModel,
    revised: &CompiledModel,
) -> EngineResult<()> {
    let mut linked_targets = BTreeSet::new();
    for edge in &revised.definition.dependencies {
        if edge.law_id.is_some() {
            linked_targets.insert(edge.target.clone());
        }
    }
    let mut updated_targets = BTreeSet::new();
    for law in &revised.laws {
        match &law.operator {
            LawOperator::Evolution { target, .. }
            | LawOperator::Relation { target, .. }
            | LawOperator::Resolution { target, .. } => {
                updated_targets.insert(target.clone());
            }
            LawOperator::Occurrence { effects, .. } => {
                updated_targets.extend(effects.iter().map(|effect| effect.target.clone()));
            }
            LawOperator::Epistemic { .. } => {}
        }
    }
    for process in revised.processes.values() {
        let newly_introduced_or_reshaped = previous
            .processes
            .get(&process.id)
            .map(|old| old.value_type != process.value_type || old.axes != process.axes)
            .unwrap_or(true);
        if !newly_introduced_or_reshaped {
            continue;
        }
        if process.update_mode == ProcessUpdateMode::Unspecified
            && (!updated_targets.contains(&process.id) || !linked_targets.contains(&process.id))
        {
            return Err(error(format!(
                "new or reshaped process {} requires an updating law with a validated dependency edge or explicit static/observed update_mode",
                process.id
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub(crate) struct GenesisRefinementAudit {
    pub(super) preserved_records: BTreeMap<String, usize>,
    pub(super) added_records: BTreeMap<String, usize>,
}

/// Shared definition-preservation audit for genesis and post-history
/// refinement. Existing records remain exact, apart from extending partial
/// temporal recompositions with preserved child projections. World state
/// transition rules are enforced separately by each operation.
pub(crate) fn validate_monotonic_genesis_refinement(
    previous: &CompiledModel,
    revised: &CompiledModel,
) -> EngineResult<GenesisRefinementAudit> {
    if previous.id != revised.id || previous.time_unit != revised.time_unit {
        return Err(error(
            "genesis refinement must preserve the model id and time unit",
        ));
    }
    if revised.revision.number != previous.revision.number + 1
        || revised.revision.previous_model_hash.as_deref() != Some(previous.model_hash.as_str())
    {
        return Err(error(
            "genesis refinement requires the direct next model revision",
        ));
    }

    let mut preserved_records = BTreeMap::new();
    let mut added_records = BTreeMap::new();

    macro_rules! preserve_collection {
        ($label:literal, $previous:expr, $revised:expr) => {
            preserve_collection!($label, $previous, $revised, id)
        };
        ($label:literal, $previous:expr, $revised:expr, $key:ident) => {{
            let previous_records = $previous;
            let revised_records = $revised;
            let revised_by_id: BTreeMap<&str, _> = revised_records
                .iter()
                .map(|record| (record.$key.as_str(), record))
                .collect();
            for old in previous_records {
                match revised_by_id.get(old.$key.as_str()) {
                    None => {
                        return Err(error(format!(
                            "genesis refinement removed existing {} record {}; additions only",
                            $label, old.$key
                        )))
                    }
                    Some(new) if *new != old => {
                        return Err(error(format!(
                            "genesis refinement changed existing {} record {}; additions only",
                            $label, old.$key
                        )))
                    }
                    Some(_) => {}
                }
            }
            preserved_records.insert($label.to_owned(), previous_records.len());
            added_records.insert(
                $label.to_owned(),
                revised_records.len().saturating_sub(previous_records.len()),
            );
        }};
    }

    preserve_collection!(
        "processes",
        &previous.definition.processes,
        &revised.definition.processes
    );
    preserve_collection!(
        "decomposition",
        &previous.definition.decomposition,
        &revised.definition.decomposition
    );
    preserve_collection!(
        "dependencies",
        &previous.definition.dependencies,
        &revised.definition.dependencies
    );
    preserve_collection!("laws", &previous.definition.laws, &revised.definition.laws);
    preserve_collection!(
        "initial_claims",
        &previous.definition.initial_claims,
        &revised.definition.initial_claims
    );
    preserve_collection!(
        "value_series",
        &previous.definition.value_series,
        &revised.definition.value_series
    );

    match (
        previous.definition.meaning_model.as_ref(),
        revised.definition.meaning_model.as_ref(),
    ) {
        (Some(_), None) => {
            return Err(error(
                "genesis refinement removed the existing Meaning Model; additions only",
            ))
        }
        (Some(old), Some(new)) => {
            if old.schema != new.schema {
                return Err(error(
                    "genesis refinement changed the existing Meaning Model schema",
                ));
            }
            match (&old.semantic_coverage, &new.semantic_coverage) {
                (Some(_), None) => {
                    return Err(error(
                        "genesis refinement removed the existing semantic coverage policy",
                    ))
                }
                (Some(old_coverage), Some(new_coverage)) => {
                    if old_coverage.mode == SemanticCoverageMode::Strict
                        && new_coverage.mode != SemanticCoverageMode::Strict
                    {
                        return Err(error(
                            "genesis refinement weakened strict semantic coverage",
                        ));
                    }
                    let revised_by_event: BTreeMap<&str, _> = new_coverage
                        .unresolved_events
                        .iter()
                        .map(|record| (record.event_id.as_str(), record))
                        .collect();
                    for old_record in &old_coverage.unresolved_events {
                        match revised_by_event.get(old_record.event_id.as_str()) {
                            None => {
                                return Err(error(format!(
                                    "genesis refinement removed existing meaning.semantic_coverage.unresolved_events record {}; additions only",
                                    old_record.event_id
                                )))
                            }
                            Some(new_record) if *new_record != old_record => {
                                return Err(error(format!(
                                    "genesis refinement changed existing meaning.semantic_coverage.unresolved_events record {}; additions only",
                                    old_record.event_id
                                )))
                            }
                            Some(_) => {}
                        }
                    }
                    preserved_records.insert(
                        "meaning.semantic_coverage.unresolved_events".to_owned(),
                        old_coverage.unresolved_events.len(),
                    );
                    added_records.insert(
                        "meaning.semantic_coverage.unresolved_events".to_owned(),
                        new_coverage
                            .unresolved_events
                            .len()
                            .saturating_sub(old_coverage.unresolved_events.len()),
                    );
                }
                (None, Some(new_coverage)) => {
                    preserved_records
                        .insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
                    added_records.insert(
                        "meaning.semantic_coverage.unresolved_events".to_owned(),
                        new_coverage.unresolved_events.len(),
                    );
                }
                (None, None) => {
                    preserved_records
                        .insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
                    added_records
                        .insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
                }
            }
            preserve_collection!("meaning.concepts", &old.concepts, &new.concepts);
            preserve_collection!(
                "meaning.abstract_relations",
                &old.abstract_relations,
                &new.abstract_relations
            );
            preserve_collection!(
                "meaning.abstract_cuts",
                &old.abstract_cuts,
                &new.abstract_cuts
            );
            preserve_collection!("meaning.referents", &old.referents, &new.referents);
            preserve_collection!(
                "meaning.encapsulation_cuts",
                &old.encapsulation_cuts,
                &new.encapsulation_cuts
            );
            preserve_collection!("meaning.events", &old.events, &new.events);
            preserve_collection!(
                "meaning.event_relations",
                &old.event_relations,
                &new.event_relations
            );
            preserve_collection!(
                "meaning.event_referent_bindings",
                &old.event_referent_bindings,
                &new.event_referent_bindings
            );
            preserve_collection!(
                "meaning.physical_cuts",
                &old.physical_cuts,
                &new.physical_cuts
            );
            preserve_collection!("meaning.realizations", &old.realizations, &new.realizations);
            preserve_collection!(
                "meaning.normalized_cuts",
                &old.normalized_cuts,
                &new.normalized_cuts
            );
            preserve_collection!(
                "meaning.context_roots",
                &old.context_roots,
                &new.context_roots,
                event_id
            );
            preserve_collection!(
                "meaning.importance_scales",
                &old.importance_scales,
                &new.importance_scales
            );
            preserve_collection!(
                "meaning.event_importance",
                &old.event_importance,
                &new.event_importance
            );
            preserve_collection!(
                "meaning.cause_questions",
                &old.cause_questions,
                &new.cause_questions
            );
            preserve_collection!(
                "meaning.cause_assessments",
                &old.cause_assessments,
                &new.cause_assessments
            );
            // A partial declaration can expose additional already-validated
            // children and become complete without changing any committed Cut
            // vector or existing projection. Complete contracts stay exact.
            for previous_contract in &old.temporal_cut_recompositions {
                let next_contract = new.temporal_cut_recompositions.iter()
                    .find(|contract| contract.parent_cut_id == previous_contract.parent_cut_id)
                    .ok_or_else(|| error("genesis refinement removed existing meaning.temporal_cut_recompositions record; additions only"))?;
                if previous_contract == next_contract {
                    continue;
                }
                if previous_contract.coverage != TemporalCutCoverage::Partial
                    || previous_contract.provenance != next_contract.provenance
                    || previous_contract
                        .children
                        .iter()
                        .any(|child| !next_contract.children.contains(child))
                {
                    return Err(error("genesis refinement changed existing meaning.temporal_cut_recompositions record; only preserved-child partial extensions are allowed"));
                }
            }
            preserved_records.insert(
                "meaning.temporal_cut_recompositions".to_owned(),
                old.temporal_cut_recompositions.len(),
            );
            added_records.insert(
                "meaning.temporal_cut_recompositions".to_owned(),
                new.temporal_cut_recompositions
                    .len()
                    .saturating_sub(old.temporal_cut_recompositions.len()),
            );
            if !old.context_roots.is_empty() {
                let old_events: BTreeSet<&str> =
                    old.events.iter().map(|event| event.id.as_str()).collect();
                let old_roots: BTreeSet<&str> = old
                    .context_roots
                    .iter()
                    .map(|root| root.event_id.as_str())
                    .collect();
                for root in &new.context_roots {
                    if old_events.contains(root.event_id.as_str())
                        && !old_roots.contains(root.event_id.as_str())
                    {
                        return Err(error(format!(
                            "genesis refinement changes the context of existing event {}; additions only",
                            root.event_id
                        )));
                    }
                }
            }
        }
        (None, Some(new)) => {
            macro_rules! added_meaning_collection {
                ($label:literal, $records:expr) => {{
                    preserved_records.insert($label.to_owned(), 0);
                    added_records.insert($label.to_owned(), $records.len());
                }};
            }
            added_meaning_collection!("meaning.concepts", &new.concepts);
            added_meaning_collection!("meaning.abstract_relations", &new.abstract_relations);
            added_meaning_collection!("meaning.abstract_cuts", &new.abstract_cuts);
            added_meaning_collection!("meaning.referents", &new.referents);
            added_meaning_collection!("meaning.encapsulation_cuts", &new.encapsulation_cuts);
            added_meaning_collection!("meaning.events", &new.events);
            added_meaning_collection!("meaning.event_relations", &new.event_relations);
            added_meaning_collection!(
                "meaning.event_referent_bindings",
                &new.event_referent_bindings
            );
            added_meaning_collection!("meaning.physical_cuts", &new.physical_cuts);
            added_meaning_collection!("meaning.realizations", &new.realizations);
            added_meaning_collection!("meaning.normalized_cuts", &new.normalized_cuts);
            added_meaning_collection!("meaning.context_roots", &new.context_roots);
            added_meaning_collection!(
                "meaning.temporal_cut_recompositions",
                &new.temporal_cut_recompositions
            );
            added_meaning_collection!("meaning.importance_scales", &new.importance_scales);
            added_meaning_collection!("meaning.event_importance", &new.event_importance);
            added_meaning_collection!("meaning.cause_questions", &new.cause_questions);
            added_meaning_collection!("meaning.cause_assessments", &new.cause_assessments);
            preserved_records.insert("meaning.semantic_coverage.unresolved_events".to_owned(), 0);
            added_records.insert(
                "meaning.semantic_coverage.unresolved_events".to_owned(),
                new.semantic_coverage
                    .as_ref()
                    .map_or(0, |coverage| coverage.unresolved_events.len()),
            );
        }
        (None, None) => {
            for label in [
                "meaning.concepts",
                "meaning.abstract_relations",
                "meaning.abstract_cuts",
                "meaning.referents",
                "meaning.encapsulation_cuts",
                "meaning.events",
                "meaning.event_relations",
                "meaning.event_referent_bindings",
                "meaning.physical_cuts",
                "meaning.realizations",
                "meaning.normalized_cuts",
                "meaning.context_roots",
                "meaning.temporal_cut_recompositions",
                "meaning.importance_scales",
                "meaning.event_importance",
                "meaning.cause_questions",
                "meaning.cause_assessments",
                "meaning.semantic_coverage.unresolved_events",
            ] {
                preserved_records.insert(label.to_owned(), 0);
                added_records.insert(label.to_owned(), 0);
            }
        }
    }

    Ok(GenesisRefinementAudit {
        preserved_records,
        added_records,
    })
}
