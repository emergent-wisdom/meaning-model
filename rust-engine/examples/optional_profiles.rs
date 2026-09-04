use life_sim_engine::{
    NumericBounds, OptionalProfileCompiler, ScalarSpatialProfile, SpatialDimensions, SpatialEntity,
};

fn main() {
    let profile = ScalarSpatialProfile {
        id: "walk".to_owned(),
        reference_frame: "local-east-north".to_owned(),
        unit: "meter".to_owned(),
        dimensions: SpatialDimensions::Two,
        entities: vec![SpatialEntity {
            id: "traveller".to_owned(),
            position: vec![0.0, 0.0],
            velocity: vec![1.0, 0.25],
            position_bounds: NumericBounds {
                minimum: -100.0,
                maximum: 100.0,
            },
            velocity_bounds: NumericBounds {
                minimum: -10.0,
                maximum: 10.0,
            },
            access_scopes: vec![],
        }],
        provenance: vec!["authored optional-profile example".to_owned()],
    };
    let mut compiler = OptionalProfileCompiler::revision_zero(
        "optional-profile-example",
        "second",
        "Compile a spatial convenience profile into the ordinary model IR.",
        vec!["rust-engine example".to_owned()],
    );
    compiler
        .apply(&profile)
        .expect("the authored profile must be valid");
    let model = compiler
        .finish()
        .expect("profile output must pass ordinary model validation");
    println!(
        "{}",
        serde_json::to_string_pretty(&model).expect("ordinary model must serialize")
    );
}
