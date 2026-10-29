//! The legacy registry as a model: a registry and its parent state written as an ordinary model and world, and a
//! model world read back as a legacy parent. For the deterministic scalar subset the two engines roll the same
//! trajectory, which the test below checks step by step.
//!
//! The adapter lives with the registry because it knows both engines; the model knows neither the registry nor this
//! adapter, so it depends on nothing above the crate root.

use std::collections::BTreeMap;

use super::{build_parent, CompiledRegistry, CouplingMode, ParentState, RegistryDefinition};
use crate::model::definition::{
    ClaimUncertainty, DependencyEdge, DependencyKind, LawActivation, LawDefinition, LawOperator,
    ModelDefinition, ModelRevision, NumericBounds, ProcessDefinition, ProcessType,
    ProcessUpdateMode, ProcessValue, ScalarExpression,
};
use crate::model::transition::scalar;
use crate::model::world::WorldHead;
use crate::model::MODEL_SCHEMA;
use crate::{error, EngineResult};

/// Lossless encoder for the deterministic scalar subset of the legacy registry.
///
/// The legacy and typed engines intentionally use different random generators,
/// so registries with nonzero noise must remain on the legacy path until a
/// random-stream adapter is specified.
pub fn encode_legacy_registry_as_model(
    definition: &RegistryDefinition,
) -> EngineResult<ModelDefinition> {
    crate::compile_registry(definition.clone())?;
    if definition
        .fields
        .iter()
        .any(|field| field.noise_scale != 0.0)
    {
        return Err(error(
            "legacy encoder currently requires zero noise_scale for exact transition equivalence",
        ));
    }
    let fields: BTreeMap<_, _> = definition
        .fields
        .iter()
        .map(|field| (field.id.as_str(), field))
        .collect();
    let processes = definition
        .fields
        .iter()
        .map(|field| ProcessDefinition {
            id: field.id.clone(),
            value_type: ProcessType::Scalar {
                bounds: NumericBounds {
                    minimum: field.minimum,
                    maximum: field.maximum,
                },
            },
            initial_value: ProcessValue::Scalar(field.initial_value),
            uncertainty: ClaimUncertainty::Exact,
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
            axes: vec![],
            unit: None,
            reference_frame: None,
            scale: BTreeMap::from([("temporal".to_owned(), definition.time_unit.clone())]),
            support: vec!["legacy bounded scalar".to_owned()],
            access_scopes: vec![],
            update_mode: ProcessUpdateMode::Unspecified,
        })
        .collect();
    let mut laws = Vec::new();
    let mut dependencies = Vec::new();
    for field in &definition.fields {
        let law_id = format!("legacy:0:drift:{}", field.id);
        laws.push(LawDefinition {
            id: law_id.clone(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: field.id.clone(),
                derivative: ScalarExpression::Multiply {
                    factors: vec![
                        ScalarExpression::Constant {
                            value: field.drift_rate,
                        },
                        ScalarExpression::Subtract {
                            left: Box::new(ScalarExpression::Constant {
                                value: field.drift_target,
                            }),
                            right: Box::new(ScalarExpression::Process {
                                process: field.id.clone(),
                            }),
                        },
                    ],
                },
                innovation: None,
            },
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
        });
        dependencies.push(DependencyEdge {
            id: format!("legacy:0:drift-edge:{}", field.id),
            source: field.id.clone(),
            target: field.id.clone(),
            kind: DependencyKind::Causes,
            law_id: Some(law_id),
        });
    }
    for coupling in &definition.couplings {
        let source = fields
            .get(coupling.source.as_str())
            .expect("legacy registry validation checked coupling source");
        let signal = match coupling.mode {
            CouplingMode::Centered => ScalarExpression::Subtract {
                left: Box::new(ScalarExpression::Process {
                    process: coupling.source.clone(),
                }),
                right: Box::new(ScalarExpression::Constant {
                    value: coupling
                        .source_center
                        .unwrap_or((source.minimum + source.maximum) / 2.0),
                }),
            },
            CouplingMode::Difference => ScalarExpression::Subtract {
                left: Box::new(ScalarExpression::Process {
                    process: coupling.source.clone(),
                }),
                right: Box::new(ScalarExpression::Process {
                    process: coupling.target.clone(),
                }),
            },
        };
        let law_id = format!("legacy:1:coupling:{}", coupling.id);
        laws.push(LawDefinition {
            id: law_id.clone(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: coupling.target.clone(),
                derivative: ScalarExpression::Multiply {
                    factors: vec![
                        ScalarExpression::Constant {
                            value: coupling.gain,
                        },
                        signal,
                    ],
                },
                innovation: None,
            },
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
        });
        dependencies.push(DependencyEdge {
            id: format!("legacy:1:coupling-edge:{}", coupling.id),
            source: coupling.source.clone(),
            target: coupling.target.clone(),
            kind: DependencyKind::Causes,
            law_id: Some(law_id),
        });
    }
    Ok(ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: definition.id.clone(),
        time_unit: definition.time_unit.clone(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "encoded deterministic legacy scalar registry".to_owned(),
            provenance: vec!["legacy-registry-encoder/v1".to_owned()],
        },
        processes,
        decomposition: vec![],
        dependencies,
        laws,
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    })
}

/// Decode a typed world into the legacy registry's canonical field order.
pub fn decode_model_world_as_legacy_parent(
    registry: &CompiledRegistry,
    world: &WorldHead,
) -> EngineResult<ParentState> {
    let mut values = Vec::with_capacity(registry.field_ids.len());
    for field_id in &registry.field_ids {
        values.push(scalar(&world.state, field_id)?);
    }
    build_parent(
        registry,
        world.version,
        world.time,
        values,
        world.lineage_head.clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::query::{ModelTransitionSpec, ResolutionPrecedence, TimeDirection};
    use crate::model::{compile_model, roll_model_transition, MODEL_QUERY_SCHEMA};
    use crate::PathSpec;

    #[test]
    fn legacy_encoder_decoder_and_transition_trace_are_equivalent() {
        let legacy_definition = crate::RegistryDefinition {
            schema: crate::REGISTRY_SCHEMA.to_owned(),
            id: "legacy-equivalence".to_owned(),
            time_unit: "tick".to_owned(),
            fields: vec![
                crate::FieldDefinition {
                    id: "a".to_owned(),
                    minimum: -10.0,
                    maximum: 10.0,
                    initial_value: 1.0,
                    drift_target: 2.0,
                    drift_rate: 0.2,
                    noise_scale: 0.0,
                },
                crate::FieldDefinition {
                    id: "b".to_owned(),
                    minimum: -10.0,
                    maximum: 10.0,
                    initial_value: 0.0,
                    drift_target: 0.0,
                    drift_rate: 0.1,
                    noise_scale: 0.0,
                },
            ],
            couplings: vec![crate::CouplingDefinition {
                id: "a-to-b".to_owned(),
                source: "a".to_owned(),
                target: "b".to_owned(),
                mode: crate::CouplingMode::Difference,
                source_center: None,
                gain: 0.3,
            }],
        };
        let legacy = crate::compile_registry(legacy_definition.clone()).unwrap();
        let encoded = encode_legacy_registry_as_model(&legacy_definition).unwrap();
        let typed = compile_model(encoded).unwrap();
        let legacy_parent = legacy.genesis_parent().unwrap();
        let typed_parent = typed.genesis_world("equivalence").unwrap();
        let decoded_genesis = decode_model_world_as_legacy_parent(&legacy, &typed_parent).unwrap();
        assert_eq!(decoded_genesis.time, legacy_parent.time);
        assert_eq!(decoded_genesis.values, legacy_parent.values);

        let legacy_roll = crate::roll_transition(
            &legacy,
            &legacy_parent,
            crate::TransitionSpec {
                delta_time: 1.0,
                step_size: 0.25,
                events: vec![],
                seed: "deterministic".to_owned(),
                roll_index: 0,
            },
            PathSpec::Full,
        )
        .unwrap();
        let typed_roll = roll_model_transition(
            &typed,
            &typed_parent,
            ModelTransitionSpec {
                schema: MODEL_QUERY_SCHEMA.to_owned(),
                delta_time: 1.0,
                step_size: 0.25,
                seed: "deterministic".to_owned(),
                roll_index: 0,
                direction: TimeDirection::Forward,
                precedence: ResolutionPrecedence::Balanced,
                temporal_resolution: None,
                semantic_resolution: None,
                interventions: vec![],
                observations: vec![],
                comparison_stream: None,
                selected_support: vec![],
                requested_observables: vec![],
                access_scopes: vec![],
                path: PathSpec::Full,
            },
        )
        .unwrap();
        assert_eq!(
            legacy_roll.candidate.path.samples.len(),
            typed_roll.candidate.path.samples.len()
        );
        for (legacy_sample, typed_sample) in legacy_roll
            .candidate
            .path
            .samples
            .iter()
            .zip(&typed_roll.candidate.path.samples)
        {
            assert_eq!(legacy_sample.time, typed_sample.time);
            assert_eq!(
                legacy_sample.values,
                vec![
                    scalar(&typed_sample.state, "a").unwrap(),
                    scalar(&typed_sample.state, "b").unwrap()
                ]
            );
        }
        let decoded_successor =
            decode_model_world_as_legacy_parent(&legacy, &typed_roll.proposed_head).unwrap();
        assert_eq!(
            decoded_successor.values,
            legacy_roll.proposed_successor.values
        );
    }
}
