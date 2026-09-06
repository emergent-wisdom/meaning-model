//! Minimal relationship scaffold for the optional profile compiler.
//!
//! A relationship is emitted as one joint Event backed by one graph process
//! and bound to two existing Things. It carries no trust, attachment, or other
//! semantic score. Those readings may be opened later as person-specific
//! events and cuts beneath the relevant lifecycle when the construction needs
//! them.

use crate::{
    ClaimUncertainty, EngineError, EngineResult, EventInterval, EventReferentBinding,
    EventReferentBindingTarget, GraphValue, MeaningEventDefinition, MeaningModelDefinition,
    OptionalModelProfile, ProcessDefinition, ProcessType, ProcessUpdateMode, ProcessValue,
    ProfileFragment, MEANING_MODEL_SCHEMA, OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const RELATIONSHIP_SCAFFOLD_PROFILE_VERSION: &str = "book-relationship/v1";

fn relationship_error(message: impl Into<String>) -> EngineError {
    EngineError(format!("optional profile: {}", message.into()))
}

fn validate_segment(value: &str, label: &str) -> EngineResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(relationship_error(format!(
            "{label} must be a 1..=128 byte ASCII identifier segment"
        )));
    }
    Ok(())
}

fn validate_text(value: &str, label: &str) -> EngineResult<()> {
    if value.trim().is_empty() {
        Err(relationship_error(format!("{label} must be nonempty")))
    } else {
        Ok(())
    }
}

fn normalized_provenance(values: &[String]) -> EngineResult<Vec<String>> {
    if values.is_empty() || values.iter().any(|value| value.trim().is_empty()) {
        return Err(relationship_error(
            "relationship scaffold provenance must be nonempty",
        ));
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

/// Loads one coarse relationship between two Things that already exist in the
/// model (or are loaded by sibling scaffold profiles in the same request).
///
/// The emitted Event is the relationship process itself. Its two bindings are
/// authoritative; the legacy participant map is retained only for convenient
/// inspection. No number is assigned because merely relating two Things does
/// not yet name a quantity or comparison class.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RelationshipScaffoldProfile {
    pub id: String,
    pub relationship_kind: String,
    pub left_referent_id: String,
    pub right_referent_id: String,
    pub description: String,
    #[serde(default)]
    pub interval: Option<EventInterval>,
    pub provenance: Vec<String>,
}

impl OptionalModelProfile for RelationshipScaffoldProfile {
    fn compile_profile(&self) -> EngineResult<ProfileFragment> {
        validate_segment(&self.id, "relationship scaffold profile id")?;
        validate_segment(
            &self.relationship_kind,
            "relationship scaffold relationship kind",
        )?;
        validate_text(
            &self.left_referent_id,
            "relationship scaffold left referent id",
        )?;
        validate_text(
            &self.right_referent_id,
            "relationship scaffold right referent id",
        )?;
        validate_text(&self.description, "relationship scaffold description")?;
        if self.left_referent_id == self.right_referent_id {
            return Err(relationship_error(
                "relationship scaffold requires two distinct referents",
            ));
        }
        if let Some(interval) = &self.interval {
            if !interval.start.is_finite() || !interval.end.is_finite() {
                return Err(relationship_error(
                    "relationship scaffold interval bounds must be finite",
                ));
            }
            if interval.end < interval.start {
                return Err(relationship_error(
                    "relationship scaffold interval must be ordered",
                ));
            }
        }

        let provenance = normalized_provenance(&self.provenance)?;
        let base = format!("profile.{}.relationship", self.id);
        let process_id = format!("{base}.index");
        let event_id = format!("event.{base}");

        let process = ProcessDefinition {
            id: process_id.clone(),
            value_type: ProcessType::Graph,
            initial_value: ProcessValue::Graph(GraphValue {
                nodes: vec![],
                edges: vec![],
            }),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            axes: vec![],
            unit: None,
            reference_frame: Some(format!("relationship:{}", self.id)),
            scale: BTreeMap::from([
                (
                    "semantic_role".to_owned(),
                    "joint_relationship_process".to_owned(),
                ),
                (
                    "relationship_kind".to_owned(),
                    self.relationship_kind.clone(),
                ),
                (
                    "relationship".to_owned(),
                    "unweighted_joint_event".to_owned(),
                ),
                (
                    "profile_version".to_owned(),
                    RELATIONSHIP_SCAFFOLD_PROFILE_VERSION.to_owned(),
                ),
            ]),
            support: vec![event_id.clone()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Observed,
        };

        let event = MeaningEventDefinition {
            id: event_id.clone(),
            boundary: self.description.clone(),
            description: None,
            interval: self.interval.clone(),
            process_ids: vec![process_id],
            observation_process_ids: vec![],
            participants: BTreeMap::from([
                ("participant_a".to_owned(), self.left_referent_id.clone()),
                ("participant_b".to_owned(), self.right_referent_id.clone()),
            ]),
            substrate: None,
            region: None,
            provenance: provenance.clone(),
        };

        let binding = |side: &str, referent_id: &str| EventReferentBinding {
            id: format!("binding.{base}.{side}"),
            target: EventReferentBindingTarget::Event {
                event_id: event_id.clone(),
            },
            role: side.to_owned(),
            referent_id: referent_id.to_owned(),
            binding_type: "relationship_participant".to_owned(),
            interval: self.interval.clone(),
            uncertainty: ClaimUncertainty::Unknown,
            provenance: provenance.clone(),
            authority: None,
        };

        Ok(ProfileFragment {
            processes: vec![process],
            meaning_model: Some(MeaningModelDefinition {
                schema: MEANING_MODEL_SCHEMA.to_owned(),
                concepts: vec![],
                abstract_relations: vec![],
                abstract_cuts: vec![],
                referents: vec![],
                encapsulation_cuts: vec![],
                events: vec![event],
                event_relations: vec![],
                event_referent_bindings: vec![
                    binding("participant_a", &self.left_referent_id),
                    binding("participant_b", &self.right_referent_id),
                ],
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
