//! Small authoring loader for a generic Thing and its lifecycle Event.
//!
//! This is intentionally only a convenience over the ordinary Meaning Model
//! records. It does not infer a kind, add coordinates, assign semantic scores,
//! or install a second template runtime.

use crate::profiles::{OptionalModelProfile, ProfileFragment};
use crate::{
    ClaimUncertainty, EngineError, EngineResult, EventInterval, EventReferentBinding,
    EventReferentBindingTarget, GraphValue, MeaningEventDefinition, MeaningModelDefinition,
    ProcessDefinition, ProcessType, ProcessUpdateMode, ProcessValue, ReferentDefinition,
    MEANING_MODEL_SCHEMA, OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const THING_SCAFFOLD_PROFILE_VERSION: &str = "book-thing/v1";

fn scaffold_error(message: impl Into<String>) -> EngineError {
    EngineError(format!("thing scaffold: {}", message.into()))
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

/// Loads one stable Thing and its complete coarse lifecycle Event.
///
/// The emitted graph process is only an addressable structural index. It has
/// no scalar or distribution value. Containment, place, extent, state, and
/// local Cuts are explicit later openings, because none is implied by merely
/// registering a Thing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ThingScaffoldProfile {
    pub id: String,
    pub thing_id: String,
    pub boundary: String,
    pub continuity_criterion: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    pub lifecycle_description: String,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for ThingScaffoldProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "profile id")?;
        validate_segment(&self.thing_id, "Thing id")?;
        validate_text(&self.boundary, "Thing boundary")?;
        validate_text(&self.continuity_criterion, "continuity criterion")?;
        validate_text(&self.lifecycle_description, "lifecycle description")?;
        if let Some(interval) = &self.interval {
            if !interval.start.is_finite() || !interval.end.is_finite() {
                return Err(scaffold_error("lifecycle interval must be finite"));
            }
            if interval.end < interval.start {
                return Err(scaffold_error("lifecycle interval must be ordered"));
            }
        }

        let provenance = normalize_provenance(&self.provenance)?;
        let base = format!("profile.{}.thing.{}", self.id, self.thing_id);
        let referent_id = format!("referent.{base}");
        let lifecycle_event_id = format!("event.{base}.life");
        let lifecycle_index_id = format!("{base}.life.index");

        let process = ProcessDefinition {
            id: lifecycle_index_id.clone(),
            value_type: ProcessType::Graph,
            initial_value: ProcessValue::Graph(GraphValue {
                nodes: vec![],
                edges: vec![],
            }),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            axes: vec![],
            unit: None,
            reference_frame: Some(format!("thing-life:{}", self.id)),
            scale: BTreeMap::from([
                (
                    "semantic_role".to_owned(),
                    "thing_lifecycle_index".to_owned(),
                ),
                (
                    "profile_version".to_owned(),
                    THING_SCAFFOLD_PROFILE_VERSION.to_owned(),
                ),
                ("subject_referent_id".to_owned(), referent_id.clone()),
            ]),
            support: vec![format!("thing_scaffold:{}", self.id)],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Observed,
        };

        let referent = ReferentDefinition {
            id: referent_id.clone(),
            boundary: self.boundary.clone(),
            continuity_criterion: self.continuity_criterion.clone(),
            interval: self.interval.clone(),
            lifecycle_event_id: Some(lifecycle_event_id.clone()),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        };
        let lifecycle = MeaningEventDefinition {
            id: lifecycle_event_id.clone(),
            boundary: self.lifecycle_description.clone(),
            description: None,
            interval: self.interval.clone(),
            process_ids: vec![lifecycle_index_id],
            observation_process_ids: vec![],
            participants: BTreeMap::from([("subject".to_owned(), referent_id.clone())]),
            substrate: None,
            region: None,
            provenance: provenance.clone(),
        };
        let subject_binding = EventReferentBinding {
            id: format!("binding.{base}.life.subject"),
            target: EventReferentBindingTarget::Event {
                event_id: lifecycle_event_id,
            },
            role: "subject".to_owned(),
            referent_id,
            binding_type: "lifecycle_subject".to_owned(),
            interval: self.interval.clone(),
            uncertainty: ClaimUncertainty::Unknown,
            provenance,
            authority: None,
        };

        Ok(ProfileFragment {
            processes: vec![process],
            meaning_model: Some(MeaningModelDefinition {
                schema: MEANING_MODEL_SCHEMA.to_owned(),
                concepts: vec![],
                abstract_relations: vec![],
                abstract_cuts: vec![],
                referents: vec![referent],
                encapsulation_cuts: vec![],
                events: vec![lifecycle],
                event_relations: vec![],
                event_referent_bindings: vec![subject_binding],
                physical_cuts: vec![],
                realizations: vec![],
                semantic_coverage: None,
                normalized_cuts: vec![],
                context_roots: vec![],
            }),
            ..ProfileFragment::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{
        compile_profiles, OptionalProfileCompiler, ProfileCompilationRequest, ProfileModelHeader,
        ProfileSpec, PROFILE_COMPILATION_SCHEMA,
    };

    fn fixture() -> ThingScaffoldProfile {
        ThingScaffoldProfile {
            id: "analytical_engine".to_owned(),
            thing_id: "engine".to_owned(),
            boundary: "the first Analytical Engine as one continuing designed machine".to_owned(),
            continuity_criterion: "the same project and machine through revision and assembly"
                .to_owned(),
            interval: Some(EventInterval {
                start: 1834.0,
                end: 1871.0,
            }),
            lifecycle_description:
                "The Engine exists as a designed and partly constructed machine.".to_owned(),
            provenance: vec!["thing scaffold fixture".to_owned()],
        }
    }

    #[test]
    fn loads_only_one_thing_and_its_lifecycle_without_semantic_numbers() {
        let mut compiler = OptionalProfileCompiler::revision_zero(
            "thing-scaffold-model",
            "year",
            "Load one coarse Thing.",
            vec!["thing scaffold test".to_owned()],
        );
        compiler.apply(&fixture()).unwrap();
        let definition = compiler.finish().unwrap();
        let meaning = definition.meaning_model.as_ref().unwrap();

        assert_eq!(meaning.referents.len(), 1);
        assert_eq!(meaning.events.len(), 1);
        assert_eq!(meaning.event_referent_bindings.len(), 1);
        assert!(meaning.event_relations.is_empty());
        assert!(meaning.encapsulation_cuts.is_empty());
        assert!(meaning.physical_cuts.is_empty());
        assert!(definition.processes.iter().all(|process| {
            !matches!(process.initial_value, ProcessValue::Scalar(_))
                && !matches!(process.initial_value, ProcessValue::Distribution(_))
        }));
    }

    #[test]
    fn rejects_an_inverted_lifecycle_interval() {
        let mut profile = fixture();
        profile.interval = Some(EventInterval {
            start: 1871.0,
            end: 1834.0,
        });
        let error = profile.compile_profile().unwrap_err().to_string();
        assert!(error.contains("lifecycle interval must be ordered"));
    }

    #[test]
    fn tagged_profile_compiler_loads_the_thing_scaffold() {
        let definition = compile_profiles(ProfileCompilationRequest {
            schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
            model: ProfileModelHeader {
                id: "tagged-thing-scaffold".to_owned(),
                time_unit: "year".to_owned(),
                reason: "Exercise the public tagged loader.".to_owned(),
                provenance: vec!["thing scaffold test".to_owned()],
            },
            profiles: vec![ProfileSpec::ThingScaffold(fixture())],
        })
        .unwrap();

        let meaning = definition.meaning_model.as_ref().unwrap();
        assert_eq!(meaning.referents[0].boundary, fixture().boundary);
        assert_eq!(meaning.events[0].process_ids.len(), 1);
    }
}
