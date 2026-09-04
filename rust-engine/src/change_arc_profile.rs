//! Minimal loader for an invention, discovery, paradigm shift, or other
//! bounded arc of change.
//!
//! The profile emits ordinary Meaning Model records: one parent Event-process
//! bound to an existing affected Thing, and optional contained anticipation,
//! focal-change, and adaptation Event-processes. The children are unweighted
//! topology. They are not a sequential Cut, need not be disjoint or exhaustive,
//! and may overlap in time. The profile adds no shock magnitude, diffusion law,
//! semantic score, or other number whose unit has not been declared.
//!
//! If the invention or concept must itself persist as an identifiable Thing,
//! register that Thing separately. This scaffold describes the process of
//! change around an affected Thing; it does not silently mint a new identity.

use crate::profiles::{OptionalModelProfile, ProfileFragment};
use crate::{
    ClaimUncertainty, EngineError, EngineResult, EventInterval, EventReferentBinding,
    EventReferentBindingTarget, EventRelationDefinition, EventRelationKind, GraphValue,
    MeaningEventDefinition, MeaningModelDefinition, ProcessDefinition, ProcessType,
    ProcessUpdateMode, ProcessValue, MEANING_MODEL_SCHEMA, OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const CHANGE_ARC_SCAFFOLD_PROFILE_VERSION: &str = "book-change-arc/v1";

fn scaffold_error(message: impl Into<String>) -> EngineError {
    EngineError(format!("change arc scaffold: {}", message.into()))
}

fn validate_segment(value: &str, label: &str) -> EngineResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(scaffold_error(format!(
            "{label} must be a 1..=128 byte ASCII identifier segment"
        )));
    }
    Ok(())
}

fn validate_text(value: &str, label: &str) -> EngineResult<()> {
    if value.trim().is_empty() {
        Err(scaffold_error(format!("{label} must be nonempty")))
    } else {
        Ok(())
    }
}

fn validate_interval(interval: &EventInterval, label: &str) -> EngineResult<()> {
    if !interval.start.is_finite() || !interval.end.is_finite() {
        return Err(scaffold_error(format!("{label} bounds must be finite")));
    }
    if interval.end < interval.start {
        return Err(scaffold_error(format!("{label} must be ordered")));
    }
    Ok(())
}

fn interval_contains(parent: &EventInterval, child: &EventInterval) -> bool {
    child.start >= parent.start && child.end <= parent.end
}

fn normalize_provenance(values: &[String]) -> EngineResult<Vec<String>> {
    if values.is_empty() || values.iter().any(|value| value.trim().is_empty()) {
        return Err(scaffold_error("provenance must be nonempty"));
    }
    let mut normalized = values.to_vec();
    if !normalized
        .iter()
        .any(|value| value == OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY)
    {
        normalized.push(OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY.to_owned());
    }
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

/// One optional opening of a change arc. Its interval may overlap the other
/// phases; containment names scope, not a mutually exclusive partition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ChangeArcPhaseProfile {
    pub description: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
}

/// Loads a coarse process of change affecting one existing Thing.
///
/// With every optional phase omitted, this is a top-level loader for a single
/// change arc. Supplying phases progressively opens that same arc without
/// assigning weights or pretending that anticipation, change, and adaptation
/// form a temporal partition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ChangeArcScaffoldProfile {
    pub id: String,
    pub change_kind: String,
    pub affected_referent_id: String,
    pub description: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    #[serde(default)]
    pub anticipation: Option<ChangeArcPhaseProfile>,
    #[serde(default)]
    pub focal_change: Option<ChangeArcPhaseProfile>,
    #[serde(default)]
    pub adaptation: Option<ChangeArcPhaseProfile>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for ChangeArcScaffoldProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "profile id")?;
        validate_segment(&self.change_kind, "change kind")?;
        validate_text(&self.affected_referent_id, "affected referent id")?;
        validate_text(&self.description, "description")?;
        if let Some(interval) = &self.interval {
            validate_interval(interval, "parent interval")?;
        }
        for (phase_name, phase) in [
            ("anticipation", self.anticipation.as_ref()),
            ("focal change", self.focal_change.as_ref()),
            ("adaptation", self.adaptation.as_ref()),
        ] {
            let Some(phase) = phase else {
                continue;
            };
            validate_text(&phase.description, &format!("{phase_name} description"))?;
            if let Some(interval) = &phase.interval {
                validate_interval(interval, &format!("{phase_name} interval"))?;
                if self
                    .interval
                    .as_ref()
                    .is_some_and(|parent| !interval_contains(parent, interval))
                {
                    return Err(scaffold_error(format!(
                        "{phase_name} interval must lie within the parent interval"
                    )));
                }
            }
        }

        let provenance = normalize_provenance(&self.provenance)?;
        let base = format!("profile.{}.change_arc", self.id);
        let parent_process_id = format!("{base}.index");
        let parent_event_id = format!("event.{base}");
        let mut fragment = ProfileFragment::default();

        fragment.processes.push(graph_process(
            parent_process_id.clone(),
            format!("change-arc:{}", self.id),
            BTreeMap::from([
                ("semantic_role".to_owned(), "change_arc_process".to_owned()),
                ("change_kind".to_owned(), self.change_kind.clone()),
                (
                    "relationship".to_owned(),
                    "unweighted_event_topology".to_owned(),
                ),
                (
                    "profile_version".to_owned(),
                    CHANGE_ARC_SCAFFOLD_PROFILE_VERSION.to_owned(),
                ),
                (
                    "affected_referent_id".to_owned(),
                    self.affected_referent_id.clone(),
                ),
            ]),
            vec![format!("change_arc_scaffold:{}", self.id)],
            &provenance,
        ));

        let mut meaning = empty_meaning_model();
        meaning.events.push(MeaningEventDefinition {
            id: parent_event_id.clone(),
            boundary: self.description.clone(),
            description: None,
            interval: self.interval.clone(),
            process_ids: vec![parent_process_id],
            observation_process_ids: vec![],
            participants: BTreeMap::from([(
                "affected".to_owned(),
                self.affected_referent_id.clone(),
            )]),
            substrate: None,
            region: None,
            provenance: provenance.clone(),
        });
        meaning.event_referent_bindings.push(EventReferentBinding {
            id: format!("binding.{base}.affected"),
            target: EventReferentBindingTarget::Event {
                event_id: parent_event_id.clone(),
            },
            role: "affected".to_owned(),
            referent_id: self.affected_referent_id.clone(),
            binding_type: "change_arc_subject".to_owned(),
            interval: self.interval.clone(),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        });

        for (phase_key, phase) in [
            ("anticipation", self.anticipation.as_ref()),
            ("focal_change", self.focal_change.as_ref()),
            ("adaptation", self.adaptation.as_ref()),
        ] {
            let Some(phase) = phase else {
                continue;
            };
            let process_id = format!("{base}.{phase_key}.index");
            let event_id = format!("event.{base}.{phase_key}");
            fragment.processes.push(graph_process(
                process_id.clone(),
                format!("change-arc-phase:{}:{phase_key}", self.id),
                BTreeMap::from([
                    (
                        "semantic_role".to_owned(),
                        "change_arc_phase_process".to_owned(),
                    ),
                    ("phase".to_owned(), phase_key.to_owned()),
                    (
                        "relationship".to_owned(),
                        "unweighted_contained_event".to_owned(),
                    ),
                    (
                        "profile_version".to_owned(),
                        CHANGE_ARC_SCAFFOLD_PROFILE_VERSION.to_owned(),
                    ),
                ]),
                vec![parent_event_id.clone()],
                &provenance,
            ));
            meaning.events.push(MeaningEventDefinition {
                id: event_id.clone(),
                boundary: phase.description.clone(),
                description: None,
                interval: phase.interval.clone(),
                process_ids: vec![process_id],
                observation_process_ids: vec![],
                participants: BTreeMap::new(),
                substrate: Some(parent_event_id.clone()),
                region: None,
                provenance: provenance.clone(),
            });
            meaning.event_relations.push(EventRelationDefinition {
                id: format!("relation.{base}.contains.{phase_key}"),
                source_event_id: parent_event_id.clone(),
                target_event_id: event_id,
                kind: EventRelationKind::Contains,
                description: None,
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                authority: None,
            });
        }

        fragment.meaning_model = Some(meaning);
        Ok(fragment)
    }
}

fn graph_process(
    id: String,
    reference_frame: String,
    scale: BTreeMap<String, String>,
    support: Vec<String>,
    provenance: &[String],
) -> ProcessDefinition {
    ProcessDefinition {
        id,
        value_type: ProcessType::Graph,
        initial_value: ProcessValue::Graph(GraphValue {
            nodes: vec![],
            edges: vec![],
        }),
        uncertainty: ClaimUncertainty::Unknown,
        provenance: provenance.to_vec(),
        axes: vec![],
        unit: None,
        reference_frame: Some(reference_frame),
        scale,
        support,
        access_scopes: vec![],
        update_mode: ProcessUpdateMode::Observed,
    }
}

fn empty_meaning_model() -> MeaningModelDefinition {
    MeaningModelDefinition {
        schema: MEANING_MODEL_SCHEMA.to_owned(),
        concepts: vec![],
        abstract_relations: vec![],
        abstract_cuts: vec![],
        referents: vec![],
        encapsulation_cuts: vec![],
        events: vec![],
        event_relations: vec![],
        event_referent_bindings: vec![],
        physical_cuts: vec![],
        realizations: vec![],
        semantic_coverage: None,
        normalized_cuts: vec![],
        context_roots: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{OptionalProfileCompiler, ThingScaffoldProfile};

    fn provenance() -> Vec<String> {
        vec!["change arc fixture".to_owned()]
    }

    fn thing() -> ThingScaffoldProfile {
        ThingScaffoldProfile {
            id: "analytical_engine".to_owned(),
            thing_id: "engine".to_owned(),
            boundary: "the Analytical Engine project".to_owned(),
            continuity_criterion: "the same project through design revisions".to_owned(),
            interval: Some(EventInterval {
                start: 1834.0,
                end: 1871.0,
            }),
            lifecycle_description: "The Engine exists as a continuing project.".to_owned(),
            provenance: provenance(),
        }
    }

    fn parent_only() -> ChangeArcScaffoldProfile {
        ChangeArcScaffoldProfile {
            id: "stored_program".to_owned(),
            change_kind: "invention".to_owned(),
            affected_referent_id: "referent.profile.analytical_engine.thing.engine".to_owned(),
            description: "The stored-program idea emerges within the Engine project.".to_owned(),
            interval: Some(EventInterval {
                start: 1840.0,
                end: 1870.0,
            }),
            anticipation: None,
            focal_change: None,
            adaptation: None,
            provenance: provenance(),
        }
    }

    #[test]
    fn parent_only_loads_one_bound_event_without_a_semantic_number() {
        let profile = parent_only();
        let fragment = profile.compile_profile().unwrap();
        let meaning = fragment.meaning_model.as_ref().unwrap();

        assert_eq!(fragment.processes.len(), 1);
        assert_eq!(meaning.events.len(), 1);
        assert_eq!(meaning.event_referent_bindings.len(), 1);
        assert!(meaning.event_relations.is_empty());
        assert!(meaning.physical_cuts.is_empty());
        assert!(fragment.processes.iter().all(|process| {
            process.unit.is_none() && matches!(process.initial_value, ProcessValue::Graph(_))
        }));
    }

    #[test]
    fn phases_are_overlapping_contained_events_not_a_sequential_cut() {
        let mut profile = parent_only();
        profile.anticipation = Some(ChangeArcPhaseProfile {
            description: "Earlier designs make the new organization conceivable.".to_owned(),
            interval: Some(EventInterval {
                start: 1840.0,
                end: 1850.0,
            }),
        });
        profile.focal_change = Some(ChangeArcPhaseProfile {
            description: "The organizing idea is stated and demonstrated.".to_owned(),
            interval: Some(EventInterval {
                start: 1848.0,
                end: 1855.0,
            }),
        });
        profile.adaptation = Some(ChangeArcPhaseProfile {
            description: "People and institutions adopt, resist, and alter the idea.".to_owned(),
            interval: Some(EventInterval {
                start: 1850.0,
                end: 1870.0,
            }),
        });

        let mut compiler = OptionalProfileCompiler::revision_zero(
            "change-arc-model",
            "year",
            "Load one affected Thing and progressively open its change arc.",
            provenance(),
        );
        compiler.apply(&thing()).unwrap();
        compiler.apply(&profile).unwrap();
        let definition = compiler.finish().unwrap();
        let meaning = definition.meaning_model.as_ref().unwrap();

        assert_eq!(meaning.events.len(), 5); // Thing lifecycle + arc + three phases.
        assert_eq!(meaning.event_relations.len(), 3);
        assert!(meaning
            .event_relations
            .iter()
            .all(|relation| relation.kind == EventRelationKind::Contains));
        assert!(meaning.physical_cuts.is_empty());
        assert!(definition.processes.iter().all(|process| {
            !matches!(process.initial_value, ProcessValue::Scalar(_))
                && !matches!(process.initial_value, ProcessValue::Distribution(_))
        }));
    }

    #[test]
    fn rejects_a_phase_outside_the_known_parent_interval() {
        let mut profile = parent_only();
        profile.adaptation = Some(ChangeArcPhaseProfile {
            description: "Adaptation outside the declared arc.".to_owned(),
            interval: Some(EventInterval {
                start: 1860.0,
                end: 1880.0,
            }),
        });

        let error = profile.compile_profile().unwrap_err().to_string();
        assert!(error.contains("adaptation interval must lie within the parent interval"));
    }
}
