use life_sim_engine::{
    compile_registry, roll_transition, CouplingDefinition, CouplingMode, FieldDefinition, PathSpec,
    RegistryDefinition, TransitionSpec, REGISTRY_SCHEMA,
};
use serde::Serialize;
use std::env;
use std::time::Instant;

#[derive(Serialize)]
struct BenchmarkReport {
    schema: &'static str,
    field_count: usize,
    coupling_count: usize,
    step_count: usize,
    scalar_updates: u64,
    compile_micros: u64,
    kernel_micros: u64,
    total_micros: u64,
    scalar_updates_per_second: f64,
    endpoint_checksum: f64,
    candidate_hash: String,
}

fn argument(index: usize, default: usize) -> usize {
    env::args()
        .nth(index)
        .map(|value| {
            value
                .parse()
                .expect("benchmark arguments must be positive integers")
        })
        .unwrap_or(default)
}

fn main() {
    let field_count = argument(1, 10_000);
    let step_count = argument(2, 1_000);
    assert!(field_count > 1, "field_count must exceed one");
    assert!(step_count > 0, "step_count must be positive");

    let fields = (0..field_count)
        .map(|index| FieldDefinition {
            id: format!("field.{index:09}"),
            minimum: 0.0,
            maximum: 1.0,
            initial_value: (index % 100) as f64 / 100.0,
            drift_target: 0.5,
            drift_rate: 0.0005,
            noise_scale: 0.002,
        })
        .collect();
    let couplings = (0..field_count)
        .map(|index| CouplingDefinition {
            id: format!("ring.{index:09}"),
            source: format!("field.{:09}", (index + field_count - 1) % field_count),
            target: format!("field.{index:09}"),
            mode: CouplingMode::Difference,
            source_center: None,
            gain: 0.001,
        })
        .collect();
    let definition = RegistryDefinition {
        schema: REGISTRY_SCHEMA.to_owned(),
        id: "sparse-ring-benchmark".to_owned(),
        time_unit: "tick".to_owned(),
        fields,
        couplings,
    };

    let total_started = Instant::now();
    let compile_started = Instant::now();
    let registry = compile_registry(definition).expect("benchmark registry must compile");
    let compile_micros = compile_started.elapsed().as_micros().min(u64::MAX as u128) as u64;
    let parent = registry
        .genesis_parent()
        .expect("benchmark genesis must be valid");
    let result = roll_transition(
        &registry,
        &parent,
        TransitionSpec {
            delta_time: step_count as f64,
            step_size: 1.0,
            events: vec![],
            seed: "large-sparse-benchmark".to_owned(),
            roll_index: 0,
        },
        PathSpec::Endpoint,
    )
    .expect("benchmark roll must succeed");
    let total_micros = total_started.elapsed().as_micros().min(u64::MAX as u128) as u64;
    let scalar_updates_per_second = if result.metrics.kernel_micros == 0 {
        f64::INFINITY
    } else {
        result.metrics.scalar_updates as f64 * 1_000_000.0 / result.metrics.kernel_micros as f64
    };
    let report = BenchmarkReport {
        schema: "life-sim-rust-benchmark/v1",
        field_count,
        coupling_count: result.metrics.coupling_count,
        step_count: result.metrics.step_count,
        scalar_updates: result.metrics.scalar_updates,
        compile_micros,
        kernel_micros: result.metrics.kernel_micros,
        total_micros,
        scalar_updates_per_second,
        endpoint_checksum: result.candidate.end_values.iter().sum(),
        candidate_hash: result.candidate.candidate_hash,
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("benchmark report must encode")
    );
}
