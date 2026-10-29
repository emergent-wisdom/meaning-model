//! Fixtures shared by the model's and the session's unit tests: a small typed model, its queries, and the commands
//! that drive a session through its public JSON interface.

use std::collections::BTreeMap;

use crate::*;

pub(crate) fn scalar_process(id: &str, initial: f64) -> ProcessDefinition {
    ProcessDefinition {
        id: id.to_owned(),
        value_type: ProcessType::Scalar {
            bounds: NumericBounds {
                minimum: -10.0,
                maximum: 10.0,
            },
        },
        initial_value: ProcessValue::Scalar(initial),
        uncertainty: ClaimUncertainty::Unknown,
        provenance: vec!["unit-test".to_owned()],
        axes: vec![AxisDefinition {
            id: "intensity".to_owned(),
            unit: None,
        }],
        unit: Some("normalized".to_owned()),
        reference_frame: Some("world".to_owned()),
        scale: BTreeMap::from([("temporal".to_owned(), "scene".to_owned())]),
        support: vec!["finite scalar test support".to_owned()],
        access_scopes: vec![],
        update_mode: ProcessUpdateMode::Unspecified,
    }
}

pub(crate) fn constant(value: f64) -> ScalarExpression {
    ScalarExpression::Constant { value }
}

pub(crate) fn process(id: &str) -> ScalarExpression {
    ScalarExpression::Process {
        process: id.to_owned(),
    }
}

pub(crate) fn test_model() -> ModelDefinition {
    ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "typed-world".to_owned(),
        time_unit: "day".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "initial test model".to_owned(),
            provenance: vec!["unit-test".to_owned()],
        },
        processes: vec![
            scalar_process("family.pressure", 0.0),
            scalar_process("person.error_propensity", 0.0),
            scalar_process("person.stress", 0.2),
            ProcessDefinition {
                id: "person.regime".to_owned(),
                value_type: ProcessType::Regime {
                    variants: vec!["calm".to_owned(), "alert".to_owned()],
                },
                initial_value: ProcessValue::Regime("calm".to_owned()),
                uncertainty: ClaimUncertainty::Unknown,
                provenance: vec!["unit-test".to_owned()],
                axes: vec![],
                unit: None,
                reference_frame: None,
                scale: BTreeMap::new(),
                support: vec!["named regime".to_owned()],
                access_scopes: vec![],
                update_mode: ProcessUpdateMode::Static,
            },
        ],
        decomposition: vec![
            DecompositionEdge {
                id: "family-contains-stress".to_owned(),
                parent: "family.pressure".to_owned(),
                child: "person.stress".to_owned(),
                kind: DecompositionKind::Contains,
            },
            DecompositionEdge {
                id: "family-contains-regime".to_owned(),
                parent: "family.pressure".to_owned(),
                child: "person.regime".to_owned(),
                kind: DecompositionKind::Contains,
            },
        ],
        dependencies: vec![
            DependencyEdge {
                id: "stress-causes-stress".to_owned(),
                source: "person.stress".to_owned(),
                target: "person.stress".to_owned(),
                kind: DependencyKind::Causes,
                law_id: Some("stress-drift".to_owned()),
            },
            DependencyEdge {
                id: "stress-derives-error".to_owned(),
                source: "person.stress".to_owned(),
                target: "person.error_propensity".to_owned(),
                kind: DependencyKind::Derives,
                law_id: Some("derive-error".to_owned()),
            },
            DependencyEdge {
                id: "stress-observed".to_owned(),
                source: "person.stress".to_owned(),
                target: "person.stress".to_owned(),
                kind: DependencyKind::Observes,
                law_id: Some("observe-stress".to_owned()),
            },
            DependencyEdge {
                id: "stress-constrains-relief".to_owned(),
                source: "person.stress".to_owned(),
                target: "person.stress".to_owned(),
                kind: DependencyKind::Constrains,
                law_id: Some("pressure-gate".to_owned()),
            },
        ],
        laws: vec![
            LawDefinition {
                id: "stress-drift".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "person.stress".to_owned(),
                    derivative: ScalarExpression::Multiply {
                        factors: vec![constant(0.1), process("person.stress")],
                    },
                    innovation: Some(InnovationSpec {
                        name: "stress-innovation".to_owned(),
                        distribution: InnovationDistribution::Normal,
                        scale: constant(0.02),
                    }),
                },
                provenance: vec!["authored-test".to_owned()],
            },
            LawDefinition {
                id: "gated-relief".to_owned(),
                enabled: true,
                activation: LawActivation::Gated,
                operator: LawOperator::Evolution {
                    target: "person.stress".to_owned(),
                    derivative: constant(-0.03),
                    innovation: None,
                },
                provenance: vec!["authored-test".to_owned()],
            },
            LawDefinition {
                id: "derive-error".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Relation {
                    target: "person.error_propensity".to_owned(),
                    value: ScalarExpression::Multiply {
                        factors: vec![constant(2.0), process("person.stress")],
                    },
                },
                provenance: vec!["authored-test".to_owned()],
            },
            LawDefinition {
                id: "pressure-gate".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Occurrence {
                    trigger: OccurrenceTrigger::Threshold {
                        expression: process("person.stress"),
                        comparison: Comparison::GreaterOrEqual,
                        threshold: 0.0,
                        firing: TriggerFiring::WhileTrue,
                    },
                    effects: vec![StateEffect {
                        target: "person.stress".to_owned(),
                        mode: EffectMode::Add,
                        value: constant(0.01),
                    }],
                    activates: vec!["gated-relief".to_owned()],
                },
                provenance: vec!["authored-test".to_owned()],
            },
            LawDefinition {
                id: "observe-stress".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Epistemic {
                    claim: ClaimTemplate {
                        id: "observer:stress".to_owned(),
                        subject: "person.stress".to_owned(),
                        uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
                        evidence_type: EvidenceType::Estimate,
                        holder: "observer".to_owned(),
                        provenance: vec!["derived-at-endpoint".to_owned()],
                        authority: ClaimAuthority {
                            source: "test-observer".to_owned(),
                            weight: 0.5,
                        },
                        access_scopes: vec![],
                    },
                    value: process("person.stress"),
                },
                provenance: vec!["authored-test".to_owned()],
            },
            LawDefinition {
                id: "aggregate-pressure".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Resolution {
                    target: "family.pressure".to_owned(),
                    value: process("person.stress"),
                    direction: ResolutionDirection::Aggregate,
                },
                provenance: vec!["authored-test".to_owned()],
            },
        ],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    }
}

pub(crate) fn genesis_refinement_base_model() -> ModelDefinition {
    let mut model = test_model();
    model.meaning_model = Some(crate::model::test_meaning_model_fixture());
    model.initial_claims.push(Claim {
        id: "baseline-stress-estimate".to_owned(),
        subject: "person.stress".to_owned(),
        value: ProcessValue::Scalar(0.2),
        uncertainty: ClaimUncertainty::StandardDeviation { value: 0.1 },
        evidence_type: EvidenceType::Estimate,
        holder: "test-observer".to_owned(),
        evidence_cutoff: 0.0,
        provenance: vec!["genesis-refinement-fixture".to_owned()],
        authority: ClaimAuthority {
            source: "unit-test".to_owned(),
            weight: 0.5,
        },
        mode: Some(ClaimMode::Estimated),
        value_time: Some(0.0),
        access_scopes: vec![],
    });
    model
}

pub(crate) fn additive_genesis_revision(
    base: &ModelDefinition,
    previous_model_hash: &str,
    suffix: &str,
) -> ModelDefinition {
    let mut model = base.clone();
    model.revision = ModelRevision {
        number: base.revision.number + 1,
        previous_model_hash: Some(previous_model_hash.to_owned()),
        reason: format!("authored genesis refinement {suffix}"),
        provenance: vec!["genesis-refinement-fixture".to_owned()],
    };
    let process_id = format!("world.{suffix}");
    let mut added_process = scalar_process(&process_id, 1.0);
    added_process.update_mode = ProcessUpdateMode::Static;
    model.processes.push(added_process);
    model.decomposition.push(DecompositionEdge {
        id: format!("family-contains-{suffix}"),
        parent: "family.pressure".to_owned(),
        child: process_id.clone(),
        kind: DecompositionKind::Contains,
    });
    model.initial_claims.push(Claim {
        id: format!("{suffix}-initial-claim"),
        subject: process_id,
        value: ProcessValue::Scalar(1.0),
        uncertainty: ClaimUncertainty::Exact,
        evidence_type: EvidenceType::CreativeHypothesis,
        holder: "author".to_owned(),
        evidence_cutoff: 0.0,
        provenance: vec!["genesis-refinement-fixture".to_owned()],
        authority: ClaimAuthority {
            source: "unit-test-author".to_owned(),
            weight: 1.0,
        },
        mode: Some(ClaimMode::Simulated),
        value_time: Some(0.0),
        access_scopes: vec![],
    });
    model
        .meaning_model
        .as_mut()
        .unwrap()
        .referents
        .push(ReferentDefinition {
            id: format!("referent-{suffix}"),
            boundary: format!("authored {suffix} boundary"),
            continuity_criterion: "stable fixture identity".to_owned(),
            interval: None,
            lifecycle_event_id: None,
            uncertainty: ClaimUncertainty::Exact,
            provenance: vec!["genesis-refinement-fixture".to_owned()],
            authority: Some(ClaimAuthority {
                source: "unit-test-author".to_owned(),
                weight: 1.0,
            }),
        });
    model
}

pub(crate) fn query(roll_index: u64, path: PathSpec) -> ModelTransitionSpec {
    ModelTransitionSpec {
        schema: MODEL_QUERY_SCHEMA.to_owned(),
        delta_time: 1.0,
        step_size: 0.25,
        seed: "typed-seed".to_owned(),
        roll_index,
        direction: TimeDirection::Forward,
        precedence: ResolutionPrecedence::Fine,
        temporal_resolution: Some("quarter-day".to_owned()),
        semantic_resolution: Some("test".to_owned()),
        interventions: vec![],
        observations: vec![],
        comparison_stream: None,
        selected_support: vec!["person.stress".to_owned()],
        requested_observables: vec!["person.stress".to_owned()],
        access_scopes: vec![],
        path,
    }
}

pub(crate) fn trajectory_process(
    id: &str,
    initial: f64,
    unit: &str,
    uncertainty: ClaimUncertainty,
) -> ProcessDefinition {
    ProcessDefinition {
        id: id.to_owned(),
        value_type: ProcessType::Scalar {
            bounds: NumericBounds {
                minimum: -100.0,
                maximum: 100.0,
            },
        },
        initial_value: ProcessValue::Scalar(initial),
        uncertainty,
        provenance: vec!["trajectory-summary-test".to_owned()],
        axes: vec![],
        unit: Some(unit.to_owned()),
        reference_frame: None,
        scale: BTreeMap::new(),
        support: vec!["analytic fixture".to_owned()],
        access_scopes: vec![],
        update_mode: ProcessUpdateMode::Unspecified,
    }
}

pub(crate) fn intervention_timing_model() -> ModelDefinition {
    let mut control = trajectory_process("timing.control", 1.0, "control", ClaimUncertainty::Exact);
    control.update_mode = ProcessUpdateMode::Static;
    ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "intervention-timing".to_owned(),
        time_unit: "second".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "Distinguish legacy successor effects from initial-boundary inputs.".to_owned(),
            provenance: vec!["intervention timing test".to_owned()],
        },
        processes: vec![
            control,
            trajectory_process("timing.signal", 2.0, "signal", ClaimUncertainty::Exact),
            trajectory_process("timing.stock", 0.0, "stock", ClaimUncertainty::Exact),
        ],
        decomposition: vec![],
        dependencies: vec![
            DependencyEdge {
                id: "control-derives-signal".to_owned(),
                source: "timing.control".to_owned(),
                target: "timing.signal".to_owned(),
                kind: DependencyKind::Derives,
                law_id: Some("derive-signal".to_owned()),
            },
            DependencyEdge {
                id: "signal-causes-stock".to_owned(),
                source: "timing.signal".to_owned(),
                target: "timing.stock".to_owned(),
                kind: DependencyKind::Causes,
                law_id: Some("evolve-stock".to_owned()),
            },
        ],
        laws: vec![
            LawDefinition {
                id: "derive-signal".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Relation {
                    target: "timing.signal".to_owned(),
                    value: ScalarExpression::Multiply {
                        factors: vec![constant(2.0), process("timing.control")],
                    },
                },
                provenance: vec!["signal equals twice the control".to_owned()],
            },
            LawDefinition {
                id: "evolve-stock".to_owned(),
                enabled: true,
                activation: LawActivation::Always,
                operator: LawOperator::Evolution {
                    target: "timing.stock".to_owned(),
                    derivative: process("timing.signal"),
                    innovation: None,
                },
                provenance: vec!["stock integrates the exact signal".to_owned()],
            },
        ],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    }
}

pub(crate) fn intervention_timing_query(
    application: Option<InterventionApplication>,
) -> ModelTransitionSpec {
    ModelTransitionSpec {
        schema: MODEL_QUERY_SCHEMA.to_owned(),
        delta_time: 0.5,
        step_size: 0.25,
        seed: "intervention-timing-seed".to_owned(),
        roll_index: 0,
        direction: TimeDirection::Forward,
        precedence: ResolutionPrecedence::Balanced,
        temporal_resolution: Some("quarter-second".to_owned()),
        semantic_resolution: Some("intervention-timing".to_owned()),
        interventions: vec![TimedIntervention {
            id: "set-control".to_owned(),
            offset: 0.0,
            effect: StateEffect {
                target: "timing.control".to_owned(),
                mode: EffectMode::Set,
                value: constant(2.0),
            },
            application,
        }],
        observations: vec![],
        comparison_stream: None,
        selected_support: vec![],
        requested_observables: vec![
            "timing.control".to_owned(),
            "timing.signal".to_owned(),
            "timing.stock".to_owned(),
        ],
        access_scopes: vec![],
        path: PathSpec::Full,
    }
}

pub(crate) fn linear_trajectory_model() -> ModelDefinition {
    ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "linear-trajectory".to_owned(),
        time_unit: "second".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "analytic trajectory fixture".to_owned(),
            provenance: vec!["trajectory-summary-test".to_owned()],
        },
        processes: vec![trajectory_process(
            "position",
            1.0,
            "meter",
            ClaimUncertainty::StandardDeviation { value: 0.1 },
        )],
        decomposition: vec![],
        dependencies: vec![],
        laws: vec![LawDefinition {
            id: "linear-motion".to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Evolution {
                target: "position".to_owned(),
                derivative: constant(2.0),
                innovation: None,
            },
            provenance: vec!["analytic dx/dt=2".to_owned()],
        }],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    }
}

pub(crate) fn trajectory_query(path: PathSpec, fields: &[&str]) -> ModelTransitionSpec {
    ModelTransitionSpec {
        schema: MODEL_QUERY_SCHEMA.to_owned(),
        delta_time: 1.0,
        step_size: 0.25,
        seed: "trajectory-summary-seed".to_owned(),
        roll_index: 0,
        direction: TimeDirection::Forward,
        precedence: ResolutionPrecedence::Balanced,
        temporal_resolution: Some("quarter-second".to_owned()),
        semantic_resolution: None,
        interventions: vec![],
        observations: vec![],
        comparison_stream: None,
        selected_support: vec![],
        requested_observables: fields.iter().map(|field| (*field).to_owned()).collect(),
        access_scopes: vec![],
        path,
    }
}

pub(crate) fn trajectory_summary_spec(
    start_time: f64,
    end_time: f64,
    fields: &[&str],
) -> TrajectorySummarySpec {
    TrajectorySummarySpec {
        schema: TRAJECTORY_SUMMARY_QUERY_SCHEMA.to_owned(),
        start_time,
        end_time,
        fields: fields.iter().map(|field| (*field).to_owned()).collect(),
        access_scopes: vec![],
    }
}

pub(crate) fn observed_series_model() -> ModelDefinition {
    let mut temperature = trajectory_process(
        "sensor.temperature",
        10.0,
        "celsius",
        ClaimUncertainty::StandardDeviation { value: 0.5 },
    );
    temperature.update_mode = ProcessUpdateMode::Observed;
    temperature.access_scopes = vec!["sensor:private".to_owned()];
    let mut derived = trajectory_process(
        "sensor.derived_heat",
        20.0,
        "derived-celsius",
        ClaimUncertainty::Unknown,
    );
    derived.access_scopes = vec!["sensor:private".to_owned()];
    ModelDefinition {
        schema: MODEL_SCHEMA.to_owned(),
        id: "observed-series".to_owned(),
        time_unit: "second".to_owned(),
        revision: ModelRevision {
            number: 0,
            previous_model_hash: None,
            reason: "observed-series fixture".to_owned(),
            provenance: vec!["observed-series-test".to_owned()],
        },
        processes: vec![temperature, derived],
        decomposition: vec![],
        dependencies: vec![DependencyEdge {
            id: "temperature-derives-heat".to_owned(),
            source: "sensor.temperature".to_owned(),
            target: "sensor.derived_heat".to_owned(),
            kind: DependencyKind::Derives,
            law_id: Some("derive-heat".to_owned()),
        }],
        laws: vec![LawDefinition {
            id: "derive-heat".to_owned(),
            enabled: true,
            activation: LawActivation::Always,
            operator: LawOperator::Relation {
                target: "sensor.derived_heat".to_owned(),
                value: ScalarExpression::Multiply {
                    factors: vec![constant(2.0), process("sensor.temperature")],
                },
            },
            provenance: vec!["analytic derived relation".to_owned()],
        }],
        initial_claims: vec![],
        value_series: vec![],
        meaning_model: None,
    }
}

pub(crate) fn observed_value(id: &str, offset: f64, value: f64) -> TimedObservation {
    TimedObservation {
        id: id.to_owned(),
        target: "sensor.temperature".to_owned(),
        offset,
        value: ProcessValue::Scalar(value),
        unit: Some("celsius".to_owned()),
        uncertainty: ClaimUncertainty::StandardDeviation { value: 0.25 },
        evidence_type: EvidenceType::Observation,
        holder: "sensor-operator".to_owned(),
        provenance: vec!["calibrated sensor fixture".to_owned()],
        authority: ClaimAuthority {
            source: "sensor-A".to_owned(),
            weight: 0.9,
        },
    }
}

pub(crate) fn observed_query(
    path: PathSpec,
    observations: Vec<TimedObservation>,
) -> ModelTransitionSpec {
    let mut query = trajectory_query(path, &["sensor.temperature", "sensor.derived_heat"]);
    query.seed = "observed-series-seed".to_owned();
    query.access_scopes = vec!["sensor:private".to_owned()];
    query.observations = observations;
    query
}

pub(crate) fn command(operation: &str, fields: serde_json::Value) -> String {
    let mut value = serde_json::json!({
        "schema": crate::COMMAND_SCHEMA,
        "request_id": format!("{operation}-request"),
        "operation": operation
    });
    let target = value.as_object_mut().unwrap();
    for (key, value) in fields.as_object().unwrap() {
        target.insert(key.clone(), value.clone());
    }
    serde_json::to_string(&value).unwrap()
}

pub(crate) fn result(response: ResponseEnvelope) -> serde_json::Value {
    assert!(
        response.ok,
        "{:?}",
        response.error.map(|error| error.message)
    );
    response.result.unwrap()
}
