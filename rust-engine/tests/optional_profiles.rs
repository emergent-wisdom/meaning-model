use life_sim_engine::{
    compile_model, compile_profiles, roll_model_transition, ClaimAuthority, ClaimMode,
    ClaimUncertainty, ContinuousEventEnvelopeProfile, CreativeStorytellingProfile,
    DecisionActionRule, DecisionFeedback, DecisionModeParameters, DecisionMotive,
    DecisionMotiveKind, DecisionOption, DecisionProfile, DependencyKind, DirectedStoryRelation,
    EventEnvelopeCoupling, EventInterval, EventRelationKind, EvidenceType, HolderSubjectiveGraph,
    ModelTransitionSpec, NumericBounds, OptionalProfileCompiler, PathSpec,
    PersonEvidenceCoordinate, PersonHealthCondition, PersonModelView, PersonModelViewKind,
    PersonProfile, PersonScaffoldLevel, PersonScaffoldProfile, ProcessValue,
    ProfileCompilationRequest, ProfileModelHeader, ProfileSpec, ReaderAffordance,
    ResolutionPrecedence, ScalarSpatialProfile, SpatialDimensions, SpatialEntity, StoryActor,
    StorytellingDynamics, StorytellingTier, SubjectiveGraphEdge, SubjectiveGraphNode,
    SubjectiveHolderGraphProfile, TimeDirection, MODEL_QUERY_SCHEMA,
    OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY, OPTIONAL_PROFILE_EXECUTION_BOUNDARY,
    PROFILE_COMPILATION_SCHEMA,
};
use std::collections::{BTreeMap, BTreeSet};

fn provenance() -> Vec<String> {
    vec!["optional-profile conformance fixture".to_owned()]
}

fn query(delta_time: f64, step_size: f64) -> ModelTransitionSpec {
    ModelTransitionSpec {
        schema: MODEL_QUERY_SCHEMA.to_owned(),
        delta_time,
        step_size,
        seed: "optional-profile-tests".to_owned(),
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
        path: PathSpec::Endpoint,
    }
}

fn decision(action: DecisionActionRule) -> DecisionProfile {
    DecisionProfile {
        id: "choice".to_owned(),
        holder: "alex".to_owned(),
        access_scopes: vec!["private:alex".to_owned()],
        options: vec![
            DecisionOption {
                id: "act".to_owned(),
                objective_value: 0.9,
                perceived_value: 1.0,
                habit_strength: 0.8,
                impulse_bias: 0.7,
                initial_commitment: -0.6,
            },
            DecisionOption {
                id: "wait".to_owned(),
                objective_value: -0.3,
                perceived_value: -0.8,
                habit_strength: -0.2,
                impulse_bias: -0.4,
                initial_commitment: -0.5,
            },
        ],
        motives: vec![
            DecisionMotive {
                id: "care".to_owned(),
                kind: DecisionMotiveKind::Want,
                intensity: 0.9,
                option_weights: BTreeMap::from([("act".to_owned(), 1.0), ("wait".to_owned(), 0.1)]),
            },
            DecisionMotive {
                id: "harm".to_owned(),
                kind: DecisionMotiveKind::Fear,
                intensity: 0.3,
                option_weights: BTreeMap::from([("act".to_owned(), 0.2), ("wait".to_owned(), 0.8)]),
            },
            DecisionMotive {
                id: "agency".to_owned(),
                kind: DecisionMotiveKind::Drive,
                intensity: 0.7,
                option_weights: BTreeMap::from([("act".to_owned(), 0.8), ("wait".to_owned(), 0.1)]),
            },
        ],
        modes: DecisionModeParameters {
            deliberative_weight: 1.0,
            habitual_weight: 0.8,
            impulsive_weight: 0.6,
            commitment_rate: 4.0,
        },
        action,
        feedback: DecisionFeedback {
            attraction_delta: 0.2,
            avoidance_delta: -0.1,
            commitment_delta: 0.15,
        },
        provenance: provenance(),
    }
}

fn spatial() -> ScalarSpatialProfile {
    ScalarSpatialProfile {
        id: "room".to_owned(),
        reference_frame: "room-origin-east-north-up".to_owned(),
        unit: "meter".to_owned(),
        dimensions: SpatialDimensions::Three,
        entities: vec![SpatialEntity {
            id: "agent".to_owned(),
            position: vec![0.0, 1.0, -1.0],
            velocity: vec![1.0, -0.5, 0.25],
            position_bounds: NumericBounds {
                minimum: -20.0,
                maximum: 20.0,
            },
            velocity_bounds: NumericBounds {
                minimum: -5.0,
                maximum: 5.0,
            },
            access_scopes: vec![],
        }],
        provenance: provenance(),
    }
}

fn story(tier: StorytellingTier) -> CreativeStorytellingProfile {
    CreativeStorytellingProfile {
        id: "story".to_owned(),
        tier,
        initial_tension: 0.4,
        initial_coherence: 0.7,
        initial_progress: 0.0,
        initial_novelty: 0.2,
        actors: vec![
            StoryActor {
                id: "alex".to_owned(),
                personality_gravity: 0.6,
                situated_expression: -0.2,
                development: 0.1,
                growth: 0.05,
            },
            StoryActor {
                id: "blair".to_owned(),
                personality_gravity: -0.3,
                situated_expression: 0.4,
                development: 0.2,
                growth: 0.1,
            },
        ],
        directed_relations: vec![DirectedStoryRelation {
            id: "alex_to_blair".to_owned(),
            source_actor: "alex".to_owned(),
            target_actor: "blair".to_owned(),
            strength: 0.2,
        }],
        reader_affordances: vec![ReaderAffordance {
            id: "doubt".to_owned(),
            cue: "contradictory testimony".to_owned(),
            invited_response: "reconsider the apparent motive".to_owned(),
            baseline: 0.1,
        }],
        dynamics: StorytellingDynamics {
            progress_rate: 0.1,
            social_tension_gain: 0.1,
            expression_adaptation_rate: 0.5,
            development_rate: 0.2,
            growth_rate: 0.1,
            novelty_rate: 0.05,
            affordance_coherence_weight: 0.4,
            affordance_novelty_weight: 0.5,
        },
        access_scopes: vec![],
        provenance: provenance(),
    }
}

fn subjective() -> SubjectiveHolderGraphProfile {
    SubjectiveHolderGraphProfile {
        id: "beliefs".to_owned(),
        position_bounds: NumericBounds {
            minimum: -1.0,
            maximum: 1.0,
        },
        holders: vec![
            HolderSubjectiveGraph {
                holder: "alex".to_owned(),
                access_scopes: vec!["private:alex".to_owned()],
                authority_weight: 0.6,
                nodes: vec![
                    SubjectiveGraphNode {
                        id: "trust".to_owned(),
                        position: 0.7,
                        uncertainty: ClaimUncertainty::Interval {
                            lower: 0.5,
                            upper: 0.9,
                        },
                    },
                    SubjectiveGraphNode {
                        id: "risk".to_owned(),
                        position: -0.2,
                        uncertainty: ClaimUncertainty::Unknown,
                    },
                ],
                edges: vec![SubjectiveGraphEdge {
                    source: "trust".to_owned(),
                    target: "risk".to_owned(),
                    relation: "constrains".to_owned(),
                }],
            },
            HolderSubjectiveGraph {
                holder: "blair".to_owned(),
                access_scopes: vec!["private:blair".to_owned()],
                authority_weight: 0.5,
                nodes: vec![SubjectiveGraphNode {
                    id: "trust".to_owned(),
                    position: -0.4,
                    uncertainty: ClaimUncertainty::Unknown,
                }],
                edges: vec![],
            },
        ],
        provenance: provenance(),
    }
}

fn envelope() -> ContinuousEventEnvelopeProfile {
    ContinuousEventEnvelopeProfile {
        id: "arrival".to_owned(),
        boundary: "the bounded arrival pressure on the moving agent".to_owned(),
        start_time: 0.2,
        end_time: 0.8,
        peak_intensity: 1.0,
        sharpness: 20.0,
        couplings: vec![EventEnvelopeCoupling {
            id: "lift".to_owned(),
            target_process: "profile.room.spatial.entity.agent.position.z".to_owned(),
            gain: 0.5,
        }],
        access_scopes: vec![],
        provenance: provenance(),
    }
}

fn person() -> PersonProfile {
    let view =
        |id: &str, kind: PersonModelViewKind, holder: &str, estimator: &str, position: f64| {
            PersonModelView {
                id: id.to_owned(),
                kind,
                holder: holder.to_owned(),
                estimator: estimator.to_owned(),
                authority_weight: 0.6,
                claims_operative_authority: false,
                access_scopes: vec![format!("private:{holder}")],
                nodes: vec![SubjectiveGraphNode {
                    id: "research_as_path".to_owned(),
                    position,
                    uncertainty: ClaimUncertainty::Interval {
                        lower: (position - 0.2).max(-1.0),
                        upper: (position + 0.2).min(1.0),
                    },
                }],
                edges: vec![],
            }
        };
    PersonProfile {
        id: "year_in_research".to_owned(),
        subject_id: "alex".to_owned(),
        person_boundary: "Alex during one bounded year of research and travel.".to_owned(),
        continuity_criterion: "The same embodied person across the interval.".to_owned(),
        interval: None,
        evidence_boundary: "Observed and reported events from the same bounded year.".to_owned(),
        evidence: vec![
            PersonEvidenceCoordinate {
                id: "public_release".to_owned(),
                value: 1.0,
                bounds: NumericBounds {
                    minimum: 0.0,
                    maximum: 1.0,
                },
                uncertainty: ClaimUncertainty::Unknown,
                evidence_type: EvidenceType::Observation,
                holder: "operator".to_owned(),
                authority: ClaimAuthority {
                    source: "release_record".to_owned(),
                    weight: 1.0,
                },
                unit: None,
                access_scopes: vec![],
            },
            PersonEvidenceCoordinate {
                id: "felt_confused".to_owned(),
                value: 0.8,
                bounds: NumericBounds {
                    minimum: 0.0,
                    maximum: 1.0,
                },
                uncertainty: ClaimUncertainty::Interval {
                    lower: 0.6,
                    upper: 1.0,
                },
                evidence_type: EvidenceType::Report,
                holder: "alex".to_owned(),
                authority: ClaimAuthority {
                    source: "alex".to_owned(),
                    weight: 1.0,
                },
                unit: None,
                access_scopes: vec!["private:alex".to_owned()],
            },
        ],
        position_bounds: NumericBounds {
            minimum: -1.0,
            maximum: 1.0,
        },
        views: vec![
            view(
                "outside_description",
                PersonModelViewKind::ExternalDescriptive,
                "operator",
                "research_agent",
                0.4,
            ),
            view(
                "candidate_purpose",
                PersonModelViewKind::CandidateActor,
                "operator",
                "research_agent",
                0.7,
            ),
            view(
                "self_understanding",
                PersonModelViewKind::SelfReported,
                "alex",
                "alex",
                0.9,
            ),
        ],
        provenance: provenance(),
    }
}

fn scalar(state: &BTreeMap<String, ProcessValue>, id: &str) -> f64 {
    match state.get(id) {
        Some(ProcessValue::Scalar(value)) => *value,
        other => panic!("expected scalar {id}, got {other:?}"),
    }
}

#[test]
fn all_profiles_compile_to_one_model_and_roll_in_one_candidate_transaction() {
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "combined-optional-profiles",
        "second",
        "Compile independent optional profiles into one ordinary model.",
        provenance(),
    );
    compiler
        .apply(&decision(DecisionActionRule::Threshold { threshold: 0.1 }))
        .unwrap()
        .apply(&spatial())
        .unwrap()
        .apply(&story(StorytellingTier::Creative))
        .unwrap()
        .apply(&subjective())
        .unwrap()
        .apply(&envelope())
        .unwrap();

    assert_eq!(
        OPTIONAL_PROFILE_EXECUTION_BOUNDARY,
        "ordinary ModelDefinition and common laws; one existing candidate transaction"
    );
    let definition = compiler.finish().unwrap();
    assert_eq!(
        definition
            .meaning_model
            .as_ref()
            .unwrap()
            .events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        vec!["event.profile.arrival"]
    );
    assert!(!definition
        .laws
        .iter()
        .any(|law| law.id == "event.profile.arrival"));
    assert!(definition.processes.iter().any(|process| {
        process.id == "profile.choice.decision.option.act.objective"
            && process.scale["semantic_role"] == "objective_option"
    }));
    assert!(definition.processes.iter().any(|process| {
        process.id == "profile.choice.decision.option.act.perceived"
            && process.scale["semantic_role"] == "holder_perceived_option"
    }));
    assert!(definition.processes.iter().all(|process| process
        .provenance
        .iter()
        .any(|item| item == OPTIONAL_PROFILE_EMPIRICAL_BOUNDARY)));

    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("combined-world").unwrap();
    let result = roll_model_transition(&model, &parent, query(1.2, 0.1)).unwrap();
    assert_eq!(result.candidate.expected_parent_version, 0);
    assert_eq!(result.proposed_head.version, 1);
    assert_eq!(
        result.proposed_head.lineage_head.as_deref(),
        Some(result.candidate.candidate_hash.as_str())
    );
    assert_eq!(
        result.candidate.successor_state.len(),
        model.definition().processes.len()
    );

    let sources: BTreeSet<_> = result
        .candidate
        .marks
        .iter()
        .map(|mark| mark.source.as_str())
        .collect();
    assert!(sources.contains("profile.arrival.event_envelope.mark.start"));
    assert!(sources.contains("profile.arrival.event_envelope.mark.end"));
    assert!(sources.contains("profile.choice.decision.option.act.action"));
    assert!(
        scalar(
            &result.candidate.successor_state,
            "profile.choice.decision.option.act.feedback.attraction"
        ) > 0.0
    );
    assert!(
        scalar(
            &result.candidate.successor_state,
            "profile.room.spatial.entity.agent.position.x"
        ) > 1.0
    );
    assert!(
        scalar(
            &result.candidate.successor_state,
            "profile.room.spatial.entity.agent.position.z"
        ) > -0.7
    );
    assert!(result
        .candidate
        .successor_claims
        .contains_key("profile.beliefs.subjective.holder.alex.claim.topology"));
}

#[test]
fn read_only_compiler_exposes_tagged_executable_decision_state() {
    let request = ProfileCompilationRequest {
        schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
        model: ProfileModelHeader {
            id: "compiled-decision-profile".to_owned(),
            time_unit: "second".to_owned(),
            reason: "Compile an authored decision profile through the public profile surface."
                .to_owned(),
            provenance: provenance(),
        },
        profiles: vec![ProfileSpec::Decision(decision(
            DecisionActionRule::Threshold { threshold: 0.1 },
        ))],
    };
    let serialized = serde_json::to_value(&request.profiles[0]).unwrap();
    assert_eq!(serialized["kind"], "decision");

    let definition = compile_profiles(request).unwrap();
    let decision_processes: Vec<_> = definition
        .processes
        .iter()
        .filter(|process| process.id.starts_with("profile.choice.decision."))
        .collect();
    assert!(!decision_processes.is_empty());
    assert!(decision_processes.iter().all(|process| {
        process.scale.get("profile_kind").map(String::as_str) == Some("decision")
            && process.scale.get("decision_id").map(String::as_str) == Some("choice")
            && process.scale.contains_key("semantic_role")
    }));

    let act_processes: Vec<_> = decision_processes
        .iter()
        .filter(|process| process.id.contains(".option.act."))
        .collect();
    assert!(!act_processes.is_empty());
    assert!(act_processes
        .iter()
        .all(|process| { process.scale.get("option_id").map(String::as_str) == Some("act") }));
    let mode_process = decision_processes
        .iter()
        .find(|process| process.id.ends_with(".mode.deliberative"))
        .unwrap();
    assert_eq!(mode_process.scale["semantic_role"], "decision_mode");
    assert!(!mode_process.scale.contains_key("option_id"));
    let objective_process = decision_processes
        .iter()
        .find(|process| process.id.ends_with(".option.act.objective"))
        .unwrap();
    assert_eq!(objective_process.scale["semantic_role"], "objective_option");

    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("compiled-decision-world").unwrap();
    let result = roll_model_transition(&model, &parent, query(1.2, 0.1)).unwrap();
    assert!(result
        .candidate
        .marks
        .iter()
        .any(|mark| mark.source == "profile.choice.decision.option.act.action"));
    assert!(result
        .candidate
        .successor_state
        .contains_key("profile.choice.decision.option.act.commitment"));
}

#[test]
fn decision_hazard_uses_common_draws_marks_and_post_mark_feedback() {
    let invalid = decision(DecisionActionRule::Hazard {
        base_rate: 1.0,
        sensitivity: -1.0,
    });
    let mut invalid_compiler = OptionalProfileCompiler::revision_zero(
        "invalid-hazard-decision",
        "second",
        "Reject inverted hazard semantics.",
        provenance(),
    );
    assert!(invalid_compiler
        .apply(&invalid)
        .unwrap_err()
        .to_string()
        .contains("hazard sensitivity must be positive"));

    let profile = decision(DecisionActionRule::Hazard {
        base_rate: 1_000_000.0,
        sensitivity: 1.0,
    });
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "hazard-decision",
        "second",
        "Exercise the hazard action form.",
        provenance(),
    );
    compiler.apply(&profile).unwrap();
    let model = compile_model(compiler.finish().unwrap()).unwrap();
    let parent = model.genesis_world("hazard-world").unwrap();
    let result = roll_model_transition(&model, &parent, query(0.2, 0.1)).unwrap();
    assert!(!result.candidate.randomness.draws.is_empty());
    assert!(result
        .candidate
        .marks
        .iter()
        .any(|mark| mark.source == "profile.choice.decision.option.act.action"));
    assert!(
        scalar(
            &result.candidate.successor_state,
            "profile.choice.decision.option.act.feedback.attraction"
        ) > 0.0
    );
}

#[test]
fn event_envelope_reaches_its_declared_peak_without_executing_meaning_data() {
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "event-envelope-peak",
        "second",
        "Check the normalized common-law envelope.",
        provenance(),
    );
    compiler
        .apply(&spatial())
        .unwrap()
        .apply(&envelope())
        .unwrap();
    let definition = compiler.finish().unwrap();
    assert!(!definition
        .laws
        .iter()
        .any(|law| law.id == "event.profile.arrival"));
    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("event-envelope-world").unwrap();
    let result = roll_model_transition(&model, &parent, query(0.5, 0.1)).unwrap();
    let intensity = scalar(
        &result.candidate.successor_state,
        "profile.arrival.event_envelope.intensity",
    );
    assert!((intensity - 1.0).abs() < 1.0e-12);
}

#[test]
fn storytelling_tiers_are_cumulative_and_keep_semantic_distinctions_explicit() {
    let tiers = [
        StorytellingTier::Minimal,
        StorytellingTier::Social,
        StorytellingTier::Character,
        StorytellingTier::Creative,
    ];
    let mut definitions = vec![];
    for tier in tiers {
        let mut compiler = OptionalProfileCompiler::revision_zero(
            format!("story-{tier:?}"),
            "scene",
            "Check cumulative storytelling tiers.",
            provenance(),
        );
        compiler.apply(&story(tier)).unwrap();
        definitions.push(compiler.finish().unwrap());
    }
    for pair in definitions.windows(2) {
        let lower_processes: BTreeSet<_> = pair[0].processes.iter().map(|item| &item.id).collect();
        let upper_processes: BTreeSet<_> = pair[1].processes.iter().map(|item| &item.id).collect();
        let lower_laws: BTreeSet<_> = pair[0].laws.iter().map(|item| &item.id).collect();
        let upper_laws: BTreeSet<_> = pair[1].laws.iter().map(|item| &item.id).collect();
        assert!(lower_processes.is_subset(&upper_processes));
        assert!(lower_laws.is_subset(&upper_laws));
    }
    let creative = definitions.last().unwrap();
    let scale = |suffix: &str| {
        &creative
            .processes
            .iter()
            .find(|process| process.id.ends_with(suffix))
            .unwrap()
            .scale
    };
    assert_eq!(
        scale("alex.personality_gravity")["semantic_role"],
        "personality_gravity"
    );
    assert_eq!(
        scale("alex.situated_expression")["semantic_role"],
        "situated_expression"
    );
    assert_eq!(
        scale("alex.development")["semantic_role"],
        "development_within_current_organization"
    );
    assert_eq!(
        scale("alex.growth")["semantic_role"],
        "growth_of_organization"
    );
    let relation = scale("social.relation.alex_to_blair");
    assert_eq!(relation["source_actor"], "alex");
    assert_eq!(relation["target_actor"], "blair");
    let affordance = scale("creative.reader_affordance.doubt");
    assert_eq!(affordance["direction"], "text_to_reader");
    assert_eq!(
        affordance["claim_boundary"],
        "affordance_not_observed_reader_response"
    );
}

#[test]
fn subjective_holder_positions_claims_and_topology_enforce_holder_scopes() {
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "subjective-holder-test",
        "day",
        "Keep holder-local models separate.",
        provenance(),
    );
    compiler.apply(&subjective()).unwrap();
    let definition = compiler.finish().unwrap();
    let alex_position = "profile.beliefs.subjective.holder.alex.node.trust.position";
    let blair_position = "profile.beliefs.subjective.holder.blair.node.trust.position";
    let alex = definition
        .processes
        .iter()
        .find(|process| process.id == alex_position)
        .unwrap();
    let blair = definition
        .processes
        .iter()
        .find(|process| process.id == blair_position)
        .unwrap();
    assert!(alex.access_scopes.contains(&"holder:alex".to_owned()));
    assert!(blair.access_scopes.contains(&"holder:blair".to_owned()));
    assert_ne!(alex.initial_value, blair.initial_value);
    assert!(definition.initial_claims.iter().any(|claim| {
        claim.holder == "alex"
            && claim.subject == alex_position
            && claim.mode == Some(ClaimMode::Estimated)
            && claim.value_time == Some(0.0)
    }));
    let topology = definition
        .processes
        .iter()
        .find(|process| process.id == "profile.beliefs.subjective.holder.alex.topology")
        .unwrap();
    let ProcessValue::Graph(topology) = &topology.initial_value else {
        panic!("holder topology must remain an ordinary graph process");
    };
    assert_eq!(topology.nodes, vec!["risk", "trust"]);

    let model = compile_model(definition).unwrap();
    let parent = model.genesis_world("subjective-world").unwrap();
    let mut denied = query(0.1, 0.1);
    denied.requested_observables = vec![alex_position.to_owned()];
    assert!(roll_model_transition(&model, &parent, denied)
        .unwrap_err()
        .to_string()
        .contains("lacks an access scope"));
    let mut allowed = query(0.1, 0.1);
    allowed.requested_observables = vec![alex_position.to_owned()];
    allowed.access_scopes = vec!["holder:alex".to_owned()];
    roll_model_transition(&model, &parent, allowed).unwrap();
}

#[test]
fn compiler_rejects_collisions_and_missing_common_ir_targets() {
    let mut duplicate = OptionalProfileCompiler::revision_zero(
        "duplicate-profile",
        "second",
        "Reject duplicate profile namespaces.",
        provenance(),
    );
    duplicate.apply(&spatial()).unwrap();
    assert!(duplicate
        .apply(&spatial())
        .unwrap_err()
        .to_string()
        .contains("duplicate process id"));

    let base = duplicate.finish().unwrap();
    let mut extending_existing = OptionalProfileCompiler::from_definition(base);
    extending_existing
        .apply(&story(StorytellingTier::Minimal))
        .unwrap();
    let extended = extending_existing.finish().unwrap();
    assert!(extended
        .processes
        .iter()
        .any(|process| process.id.starts_with("profile.room.spatial")));
    assert!(extended
        .processes
        .iter()
        .any(|process| process.id.starts_with("profile.story.story")));

    let mut missing_target = OptionalProfileCompiler::revision_zero(
        "missing-target",
        "second",
        "Do not invent an event target or a second runtime.",
        provenance(),
    );
    let mut invalid_envelope = envelope();
    invalid_envelope.id = "orphan".to_owned();
    invalid_envelope.couplings[0].target_process = "missing.process".to_owned();
    missing_target.apply(&invalid_envelope).unwrap();
    let error = missing_target.finish().unwrap_err().to_string();
    assert!(error.contains("unknown process missing.process"));
}

#[test]
fn person_profile_keeps_three_views_distinct_over_one_referent_and_evidence_event() {
    let definition = compile_profiles(ProfileCompilationRequest {
        schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
        model: ProfileModelHeader {
            id: "person-profile-model".to_owned(),
            time_unit: "day".to_owned(),
            reason: "Compile separate evidence, external, candidate, and self views.".to_owned(),
            provenance: provenance(),
        },
        profiles: vec![ProfileSpec::Person(person())],
    })
    .unwrap();
    compile_model(definition.clone()).unwrap();

    let meaning = definition.meaning_model.as_ref().unwrap();
    assert_eq!(meaning.referents.len(), 1);
    assert_eq!(
        meaning.referents[0].id,
        "referent.profile.year_in_research.person.alex"
    );
    assert!(meaning
        .events
        .iter()
        .any(|event| event.id == "event.profile.year_in_research.person.evidence"));
    assert_eq!(meaning.realizations.len(), 3);
    let realized_concepts: BTreeSet<_> = meaning
        .realizations
        .iter()
        .map(|realization| realization.concept_id.as_str())
        .collect();
    assert_eq!(realized_concepts.len(), 3);
    assert!(meaning.realizations.iter().all(|realization| {
        realization.referent_roles["subject"] == "referent.profile.year_in_research.person.alex"
    }));

    let view_processes: Vec<_> = definition
        .processes
        .iter()
        .filter(|process| {
            process.scale.get("semantic_role") == Some(&"person_model_view".to_owned())
        })
        .collect();
    assert_eq!(view_processes.len(), 6);
    let view_kinds: BTreeSet<_> = view_processes
        .iter()
        .map(|process| process.scale["view_kind"].as_str())
        .collect();
    assert_eq!(
        view_kinds,
        BTreeSet::from(["candidate_actor", "external_descriptive", "self_reported"])
    );
    assert!(view_processes.iter().all(|process| {
        process
            .support
            .contains(&"event.profile.year_in_research.person.evidence".to_owned())
    }));

    let evidence_processes: Vec<_> = definition
        .processes
        .iter()
        .filter(|process| process.scale.get("semantic_role") == Some(&"person_evidence".to_owned()))
        .collect();
    assert_eq!(evidence_processes.len(), 2);
    let observed_links = definition
        .dependencies
        .iter()
        .filter(|edge| edge.kind == DependencyKind::Observes)
        .count();
    assert_eq!(observed_links, evidence_processes.len() * 3);

    let self_claim = definition
        .initial_claims
        .iter()
        .find(|claim| claim.id.contains("self_understanding.claim.topology"))
        .unwrap();
    assert_eq!(self_claim.holder, "alex");
    assert_eq!(self_claim.evidence_type, EvidenceType::Report);
    assert_eq!(self_claim.mode, Some(ClaimMode::Observed));
    let candidate_claim = definition
        .initial_claims
        .iter()
        .find(|claim| claim.id.contains("candidate_purpose.claim.topology"))
        .unwrap();
    assert_eq!(candidate_claim.holder, "operator");
    assert_eq!(candidate_claim.evidence_type, EvidenceType::Estimate);
    assert_eq!(candidate_claim.mode, Some(ClaimMode::Estimated));
}

#[test]
fn person_profile_rejects_false_operative_authority_and_incomplete_view_families() {
    let mut false_authority = person();
    false_authority.views[1].claims_operative_authority = true;
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "false-authority",
        "day",
        "Reject a false claim of access to latent operative organization.",
        provenance(),
    );
    let error = compiler.apply(&false_authority).unwrap_err().to_string();
    assert!(error.contains("cannot claim latent operative-model authority"));

    let mut incomplete = person();
    incomplete
        .views
        .retain(|view| view.kind != PersonModelViewKind::CandidateActor);
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "incomplete-views",
        "day",
        "Require every epistemic viewpoint family.",
        provenance(),
    );
    let error = compiler.apply(&incomplete).unwrap_err().to_string();
    assert!(error.contains("requires exactly one external descriptive view"));
}

#[test]
fn read_only_compiler_composes_story_and_person_profiles_deterministically() {
    let request = ProfileCompilationRequest {
        schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
        model: ProfileModelHeader {
            id: "story-person-model".to_owned(),
            time_unit: "scene".to_owned(),
            reason: "Compose optional story and person authoring profiles.".to_owned(),
            provenance: provenance(),
        },
        profiles: vec![
            ProfileSpec::Story(story(StorytellingTier::Creative)),
            ProfileSpec::Person(person()),
        ],
    };
    let first = compile_profiles(request.clone()).unwrap();
    let second = compile_profiles(request).unwrap();
    assert_eq!(first, second);
    assert!(first
        .processes
        .iter()
        .any(|process| process.id.starts_with("profile.story.story")));
    assert!(first
        .processes
        .iter()
        .any(|process| process.id.starts_with("profile.year_in_research.person")));
}

#[test]
fn person_scaffold_loads_one_life_nine_concurrent_processes_and_optional_health() {
    let request = ProfileCompilationRequest {
        schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
        model: ProfileModelHeader {
            id: "loaded-person-model".to_owned(),
            time_unit: "year".to_owned(),
            reason: "Load the bundled coarse person scaffold.".to_owned(),
            provenance: provenance(),
        },
        profiles: vec![ProfileSpec::PersonScaffold(PersonScaffoldProfile {
            id: "ada".to_owned(),
            subject_id: "ada_lovelace".to_owned(),
            person_boundary: "the historical person Ada Lovelace".to_owned(),
            continuity_criterion: "one continuous human life".to_owned(),
            interval: Some(EventInterval {
                start: -28.0,
                end: 9.0,
            }),
            life_description: "A coarse complete life, to be opened progressively.".to_owned(),
            level: PersonScaffoldLevel::Processes,
            health: Some(PersonHealthCondition {
                healthy_functioning: 0.62,
                illness_burden: 0.31,
                remainder: 0.07,
            }),
            provenance: provenance(),
        })],
    };
    let first = compile_profiles(request.clone()).unwrap();
    let second = compile_profiles(request).unwrap();
    assert_eq!(first, second);
    compile_model(first.clone()).unwrap();

    let meaning = first.meaning_model.as_ref().unwrap();
    assert_eq!(meaning.referents.len(), 1);
    assert_eq!(
        meaning.referents[0].lifecycle_event_id.as_deref(),
        Some("event.profile.ada.person.ada_lovelace.life")
    );
    let is_processes: Vec<_> = first
        .processes
        .iter()
        .filter(|process| {
            process.scale.get("semantic_role") == Some(&"person_is_process".to_owned())
        })
        .collect();
    assert_eq!(is_processes.len(), 9);
    assert!(is_processes.iter().all(|process| {
        process.scale.get("relationship") == Some(&"concurrent_non_summing".to_owned())
    }));
    let contained_by_life = meaning
        .event_relations
        .iter()
        .filter(|relation| {
            relation.kind == EventRelationKind::Contains
                && relation.source_event_id == "event.profile.ada.person.ada_lovelace.life"
        })
        .count();
    assert_eq!(contained_by_life, 9);

    let health = first
        .processes
        .iter()
        .find(|process| {
            process.scale.get("semantic_role") == Some(&"health_condition_cut".to_owned())
        })
        .unwrap();
    assert_eq!(
        health.initial_value,
        ProcessValue::Distribution(vec![0.62, 0.31, 0.07])
    );
    assert!(meaning.event_relations.iter().any(|relation| {
        relation.kind == EventRelationKind::Contains
            && relation.source_event_id == "event.profile.ada.person.ada_lovelace.is.body"
            && relation.target_event_id == "event.profile.ada.person.ada_lovelace.is.body.health"
    }));
}

#[test]
fn person_scaffold_rejects_a_health_cut_that_does_not_sum_to_one() {
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "invalid-person-scaffold",
        "year",
        "Reject an invalid local health Cut.",
        provenance(),
    );
    let profile = PersonScaffoldProfile {
        id: "person".to_owned(),
        subject_id: "alex".to_owned(),
        person_boundary: "one bounded person".to_owned(),
        continuity_criterion: "one continuous life".to_owned(),
        interval: None,
        life_description: "A coarse whole life.".to_owned(),
        level: PersonScaffoldLevel::Processes,
        health: Some(PersonHealthCondition {
            healthy_functioning: 0.6,
            illness_burden: 0.3,
            remainder: 0.2,
        }),
        provenance: provenance(),
    };
    let error = compiler.apply(&profile).unwrap_err().to_string();
    assert!(error.contains("health Cut must sum to one"));
}

#[test]
fn person_scaffold_can_load_only_identity_and_lifecycle_without_numbers() {
    let definition = compile_profiles(ProfileCompilationRequest {
        schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
        model: ProfileModelHeader {
            id: "top-level-person".to_owned(),
            time_unit: "year".to_owned(),
            reason: "Load only identity and lifecycle.".to_owned(),
            provenance: provenance(),
        },
        profiles: vec![ProfileSpec::PersonScaffold(PersonScaffoldProfile {
            id: "minimal".to_owned(),
            subject_id: "alex".to_owned(),
            person_boundary: "one person".to_owned(),
            continuity_criterion: "one continuous life".to_owned(),
            interval: None,
            life_description: "A complete coarse life.".to_owned(),
            level: PersonScaffoldLevel::Lifecycle,
            health: None,
            provenance: provenance(),
        })],
    })
    .unwrap();

    let meaning = definition.meaning_model.as_ref().unwrap();
    assert_eq!(meaning.referents.len(), 1);
    assert_eq!(meaning.events.len(), 1);
    assert!(meaning.event_relations.is_empty());
    assert!(definition.processes.iter().all(|process| {
        process.scale.get("semantic_role") != Some(&"person_is_process".to_owned())
    }));
    assert!(definition.processes.iter().all(|process| {
        !matches!(process.initial_value, ProcessValue::Scalar(_))
            && !matches!(process.initial_value, ProcessValue::Distribution(_))
    }));
}
