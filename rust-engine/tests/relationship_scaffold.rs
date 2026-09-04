use life_sim_engine::{
    compile_model, compile_profiles, EventInterval, PersonScaffoldLevel, PersonScaffoldProfile,
    ProcessValue, ProfileCompilationRequest, ProfileModelHeader, ProfileSpec,
    RelationshipScaffoldProfile, PROFILE_COMPILATION_SCHEMA,
};

fn provenance() -> Vec<String> {
    vec!["relationship scaffold fixture".to_owned()]
}

fn person(id: &str) -> PersonScaffoldProfile {
    PersonScaffoldProfile {
        id: id.to_owned(),
        subject_id: id.to_owned(),
        person_boundary: format!("the person {id}"),
        continuity_criterion: "one continuous human life".to_owned(),
        interval: Some(EventInterval {
            start: 0.0,
            end: 80.0,
        }),
        life_description: format!("the complete coarse life of {id}"),
        level: PersonScaffoldLevel::Lifecycle,
        health: None,
        provenance: provenance(),
    }
}

#[test]
fn relationship_scaffold_loads_one_unweighted_joint_event_between_two_things() {
    let definition = compile_profiles(ProfileCompilationRequest {
        schema: PROFILE_COMPILATION_SCHEMA.to_owned(),
        model: ProfileModelHeader {
            id: "relationship-model".to_owned(),
            time_unit: "year".to_owned(),
            reason: "Load two people and their coarse partnership.".to_owned(),
            provenance: provenance(),
        },
        profiles: vec![
            ProfileSpec::PersonScaffold(person("ada")),
            ProfileSpec::PersonScaffold(person("charles")),
            ProfileSpec::RelationshipScaffold(RelationshipScaffoldProfile {
                id: "ada-charles".to_owned(),
                relationship_kind: "working_partnership".to_owned(),
                left_referent_id: "referent.profile.ada.person.ada".to_owned(),
                right_referent_id: "referent.profile.charles.person.charles".to_owned(),
                description: "Ada and Charles's working partnership.".to_owned(),
                interval: Some(EventInterval {
                    start: 20.0,
                    end: 29.0,
                }),
                provenance: provenance(),
            }),
        ],
    })
    .unwrap();
    compile_model(definition.clone()).unwrap();

    let relationship = definition
        .processes
        .iter()
        .find(|process| {
            process.scale.get("semantic_role") == Some(&"joint_relationship_process".to_owned())
        })
        .unwrap();
    assert_eq!(relationship.unit, None);
    assert!(matches!(relationship.initial_value, ProcessValue::Graph(_)));

    let meaning = definition.meaning_model.as_ref().unwrap();
    let event_id = "event.profile.ada-charles.relationship";
    let event = meaning
        .events
        .iter()
        .find(|event| event.id == event_id)
        .unwrap();
    assert_eq!(event.participants.len(), 2);

    let mut bound_referents: Vec<_> = meaning
        .event_referent_bindings
        .iter()
        .filter(|binding| match &binding.target {
            life_sim_engine::EventReferentBindingTarget::Event { event_id: target } => {
                target == event_id
            }
            _ => false,
        })
        .map(|binding| binding.referent_id.as_str())
        .collect();
    bound_referents.sort_unstable();
    assert_eq!(
        bound_referents,
        vec![
            "referent.profile.ada.person.ada",
            "referent.profile.charles.person.charles"
        ]
    );
    assert!(definition.processes.iter().all(|process| {
        !matches!(process.initial_value, ProcessValue::Scalar(_))
            && !matches!(process.initial_value, ProcessValue::Distribution(_))
    }));
}

#[test]
fn relationship_scaffold_rejects_a_self_relationship() {
    let relationship = RelationshipScaffoldProfile {
        id: "self".to_owned(),
        relationship_kind: "partnership".to_owned(),
        left_referent_id: "referent.person.alex".to_owned(),
        right_referent_id: "referent.person.alex".to_owned(),
        description: "An invalid self relationship.".to_owned(),
        interval: None,
        provenance: provenance(),
    };
    let error = life_sim_engine::OptionalModelProfile::compile_profile(&relationship)
        .unwrap_err()
        .to_string();
    assert!(error.contains("requires two distinct referents"));
}
