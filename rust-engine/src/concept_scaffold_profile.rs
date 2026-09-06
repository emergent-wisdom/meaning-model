//! Minimal loader for one flat Concept definition.
//!
//! The scaffold records a stable concept identifier and a one-line boundary
//! description. The remaining fields are optional descriptive parts of the
//! existing [`ConceptDefinition`] schema. It deliberately emits no
//! [`crate::RealizationRecord`], canonical model, prototype, score, or executable
//! recognizer. Those require separate evidence and an explicit later opening.

use crate::profiles::{OptionalModelProfile, ProfileFragment};
use crate::{
    ClaimUncertainty, ConceptDefinition, EngineError, EngineResult, GraphValue,
    MeaningModelDefinition, ProcessDefinition, ProcessType, ProcessUpdateMode, ProcessValue,
    MEANING_MODEL_SCHEMA, OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_CONCEPT_TEXT_BYTES: usize = 1_024;
const CONCEPT_SCAFFOLD_PROFILE_VERSION: &str = "book-concept/v1";

fn concept_error(message: impl Into<String>) -> EngineError {
    EngineError(format!("concept scaffold: {}", message.into()))
}

fn validate_text(value: &str, label: &str) -> EngineResult<()> {
    if value.trim().is_empty() || value.len() > MAX_CONCEPT_TEXT_BYTES {
        Err(concept_error(format!(
            "{label} must be nonempty and no longer than {MAX_CONCEPT_TEXT_BYTES} bytes"
        )))
    } else {
        Ok(())
    }
}

fn validate_one_line(value: &str, label: &str) -> EngineResult<()> {
    validate_text(value, label)?;
    if value.contains('\n') || value.contains('\r') {
        Err(concept_error(format!("{label} must be one line")))
    } else {
        Ok(())
    }
}

fn validate_unique_texts(values: &[String], label: &str) -> EngineResult<()> {
    let mut seen = BTreeSet::new();
    for value in values {
        validate_text(value, label)?;
        if !seen.insert(value) {
            return Err(concept_error(format!("{label} values must be unique")));
        }
    }
    Ok(())
}

fn normalized_provenance(values: &[String]) -> EngineResult<Vec<String>> {
    if values.is_empty() {
        return Err(concept_error("provenance must be nonempty"));
    }
    for value in values {
        validate_text(value, "provenance")?;
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

/// Loads one shallow concept bundle into the existing Meaning Model schema.
///
/// `description` becomes the concept's boundary: the single sentence that
/// says what the identifier means for this construction. Optional schema
/// fields remain descriptive declarations. Their presence does not imply that
/// the engine can recognize, instantiate, or numerically score the concept.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConceptScaffoldProfile {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(alias = "boundary")]
    pub description: String,
    #[serde(default)]
    pub differentia: Vec<String>,
    #[serde(default)]
    pub state_schema: BTreeMap<String, String>,
    #[serde(default)]
    pub direction_families: Vec<String>,
    #[serde(default)]
    pub observation_methods: Vec<String>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for ConceptScaffoldProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_text(&self.id, "concept id")?;
        if let Some(label) = self.label.as_deref() {
            validate_one_line(label, "concept label")?;
        }
        validate_one_line(&self.description, "concept description")?;
        validate_unique_texts(&self.differentia, "concept differentia")?;
        validate_unique_texts(&self.direction_families, "concept direction families")?;
        validate_unique_texts(&self.observation_methods, "concept observation methods")?;
        for (field, value_type) in &self.state_schema {
            validate_text(field, "concept state field")?;
            validate_text(value_type, "concept state value type")?;
        }
        let provenance = normalized_provenance(&self.provenance)?;
        let process_id = format!("concept-index.{}", self.id);

        Ok(ProfileFragment {
            processes: vec![ProcessDefinition {
                id: process_id,
                value_type: ProcessType::Graph,
                initial_value: ProcessValue::Graph(GraphValue {
                    nodes: vec![],
                    edges: vec![],
                }),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: provenance.clone(),
                axes: vec![],
                unit: None,
                reference_frame: Some(format!("concept-definition:{}", self.id)),
                scale: BTreeMap::from([
                    (
                        "semantic_role".to_owned(),
                        "concept_definition_index".to_owned(),
                    ),
                    (
                        "profile_version".to_owned(),
                        CONCEPT_SCAFFOLD_PROFILE_VERSION.to_owned(),
                    ),
                ]),
                support: vec![format!("concept:{}.definition", self.id)],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Observed,
            }],
            meaning_model: Some(MeaningModelDefinition {
                schema: MEANING_MODEL_SCHEMA.to_owned(),
                concepts: vec![ConceptDefinition {
                    id: self.id.clone(),
                    label: self.label.clone(),
                    differentia: self.differentia.clone(),
                    boundary: Some(self.description.clone()),
                    state_schema: self.state_schema.clone(),
                    direction_families: self.direction_families.clone(),
                    observation_methods: self.observation_methods.clone(),
                    provenance,
                }],
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
                temporal_cut_recompositions: vec![],
            }),
            ..ProfileFragment::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::OptionalProfileCompiler;

    fn fixture() -> ConceptScaffoldProfile {
        ConceptScaffoldProfile {
            id: "paradigm_shift".to_owned(),
            label: Some("paradigm shift".to_owned()),
            description: "A field reorganizes around a new account of its central problems."
                .to_owned(),
            differentia: vec![],
            state_schema: BTreeMap::new(),
            direction_families: vec![],
            observation_methods: vec![
                "changes in accepted explanations, problems, and methods".to_owned()
            ],
            provenance: vec!["concept scaffold fixture".to_owned()],
        }
    }

    #[test]
    fn loads_a_flat_concept_without_a_score_or_canonical_model() {
        let mut compiler = OptionalProfileCompiler::revision_zero(
            "concept-scaffold-model",
            "year",
            "Load one shallow concept definition.",
            vec!["concept scaffold test".to_owned()],
        );
        compiler.apply(&fixture()).unwrap();
        let definition = compiler.finish().unwrap();
        let meaning = definition.meaning_model.as_ref().unwrap();

        assert_eq!(definition.processes.len(), 1);
        assert!(matches!(
            definition.processes[0].initial_value,
            ProcessValue::Graph(_)
        ));
        assert_eq!(meaning.concepts.len(), 1);
        assert_eq!(meaning.concepts[0].id, "paradigm_shift");
        assert_eq!(
            meaning.concepts[0].boundary.as_deref(),
            Some("A field reorganizes around a new account of its central problems.")
        );
        assert!(meaning.abstract_cuts.is_empty());
        assert!(meaning.referents.is_empty());
        assert!(meaning.events.is_empty());
        assert!(meaning.realizations.is_empty());
    }

    #[test]
    fn carries_optional_existing_schema_fields_without_making_them_executable() {
        let mut profile = fixture();
        profile.differentia = vec!["reorganization, not merely another result".to_owned()];
        profile.state_schema = BTreeMap::from([(
            "field_consensus".to_owned(),
            "descriptive state to be opened later".to_owned(),
        )]);
        profile.direction_families = vec!["adoption, resistance, or refinement".to_owned()];

        let fragment = profile.compile_profile().unwrap();
        let meaning = fragment.meaning_model.unwrap();
        let concept = &meaning.concepts[0];
        assert_eq!(concept.differentia, profile.differentia);
        assert_eq!(concept.state_schema, profile.state_schema);
        assert_eq!(concept.direction_families, profile.direction_families);
        assert!(meaning.realizations.is_empty());
    }

    #[test]
    fn rejects_a_multiline_description() {
        let mut profile = fixture();
        profile.description = "A field changes.\nA second hidden sentence follows.".to_owned();
        let error = profile.compile_profile().unwrap_err().to_string();
        assert!(error.contains("concept description must be one line"));
    }
}
