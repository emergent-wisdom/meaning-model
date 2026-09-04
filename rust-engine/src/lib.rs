use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};
use std::time::Instant;

mod model;
pub use model::*;

mod profiles;
pub use profiles::*;

mod change_arc_profile;
pub use change_arc_profile::*;

mod concept_scaffold_profile;
pub use concept_scaffold_profile::*;

mod relationship_profile;
pub use relationship_profile::*;

mod thing_scaffold_profile;
pub use thing_scaffold_profile::*;

pub const COMMAND_SCHEMA: &str = "life-sim-rust-command/v1";
pub const RESPONSE_SCHEMA: &str = "life-sim-rust-response/v1";
pub const REGISTRY_SCHEMA: &str = "life-sim-rust-registry/v1";
pub const PARENT_SCHEMA: &str = "life-sim-rust-parent/v1";
pub const CANDIDATE_SCHEMA: &str = "life-sim-rust-candidate/v1";
pub const PATH_SCHEMA: &str = "life-sim-rust-path/v1";
pub const MAX_COMMAND_BYTES: usize = 16 * 1024 * 1024;
const MAX_STEPS: usize = 1_000_000;
const MAX_LEGACY_FIELDS: usize = 50_000;
const MAX_LEGACY_COUPLINGS: usize = 200_000;
const MAX_LEGACY_EVENTS: usize = 10_000;
const MAX_LEGACY_EVENT_EFFECTS: usize = 100_000;
const MAX_LEGACY_WORK: usize = 50_000_000;
const MAX_LEGACY_RETAINED_BYTES: usize = 16 * 1024 * 1024;
const MAX_LEGACY_STATE_BYTE_STEPS: usize = 1024 * 1024 * 1024;
const MAX_LEGACY_DURATION: f64 = 30.0;
const MAX_LEGACY_STRING_BYTES: usize = 1_024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineError(pub String);

impl Display for EngineError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for EngineError {}

pub type EngineResult<T> = Result<T, EngineError>;

fn error(message: impl Into<String>) -> EngineError {
    EngineError(message.into())
}

fn finite(value: f64, label: &str) -> EngineResult<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(error(format!("{label} must be finite")))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistryDefinition {
    pub schema: String,
    pub id: String,
    pub time_unit: String,
    pub fields: Vec<FieldDefinition>,
    #[serde(default)]
    pub couplings: Vec<CouplingDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldDefinition {
    pub id: String,
    pub minimum: f64,
    pub maximum: f64,
    pub initial_value: f64,
    pub drift_target: f64,
    #[serde(default)]
    pub drift_rate: f64,
    #[serde(default)]
    pub noise_scale: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CouplingMode {
    Centered,
    Difference,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CouplingDefinition {
    pub id: String,
    pub source: String,
    pub target: String,
    pub mode: CouplingMode,
    #[serde(default)]
    pub source_center: Option<f64>,
    pub gain: f64,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedRegistry {
    schema: &'static str,
    id: String,
    time_unit: String,
    fields: Vec<FieldDefinition>,
    couplings: Vec<NormalizedCoupling>,
}

#[derive(Debug, Clone, Serialize)]
struct NormalizedCoupling {
    id: String,
    source: String,
    target: String,
    mode: CouplingMode,
    source_center: f64,
    gain: f64,
}

#[derive(Debug, Clone)]
struct CompiledCoupling {
    source_index: usize,
    mode: CouplingMode,
    source_center: f64,
    gain: f64,
}

#[derive(Debug, Clone)]
pub struct CompiledRegistry {
    pub registry_hash: String,
    pub id: String,
    pub time_unit: String,
    pub field_ids: Vec<String>,
    fields: Vec<FieldDefinition>,
    incoming: Vec<Vec<CompiledCoupling>>,
    coupling_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ParentState {
    pub schema: String,
    pub registry_hash: String,
    pub version: u64,
    pub time: f64,
    pub values: Vec<f64>,
    #[serde(default)]
    pub lineage_head: Option<String>,
    pub parent_hash: String,
}

#[derive(Debug, Serialize)]
struct ParentFingerprint<'a> {
    schema: &'static str,
    registry_hash: &'a str,
    version: u64,
    time: f64,
    values: &'a [f64],
    lineage_head: &'a Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionSpec {
    pub delta_time: f64,
    pub step_size: f64,
    #[serde(default)]
    pub events: Vec<EventDefinition>,
    #[serde(default = "default_seed")]
    pub seed: String,
    #[serde(default)]
    pub roll_index: u64,
}

fn default_seed() -> String {
    "life-sim-rust".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventDefinition {
    pub id: String,
    #[serde(default)]
    pub start_offset: f64,
    #[serde(default)]
    pub end_offset: Option<f64>,
    #[serde(default)]
    pub intensity: LinearEnvelope,
    pub effects: Vec<EventEffectDefinition>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinearEnvelope {
    pub start: f64,
    pub end: f64,
}

impl Default for LinearEnvelope {
    fn default() -> Self {
        Self {
            start: 1.0,
            end: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventEffectDefinition {
    pub target: String,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedEvent {
    pub id: String,
    pub start_offset: f64,
    pub end_offset: f64,
    pub intensity: LinearEnvelope,
    pub effects: Vec<EventEffectDefinition>,
}

#[derive(Debug, Clone)]
struct CompiledEvent {
    start_offset: f64,
    end_offset: f64,
    intensity: LinearEnvelope,
}

#[derive(Debug, Clone)]
struct CompiledEventEffect {
    event_index: usize,
    rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum PathSpec {
    Endpoint,
    Full,
    Decimated { every: usize },
}

impl Default for PathSpec {
    fn default() -> Self {
        Self::Endpoint
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandEnvelope {
    pub schema: String,
    #[serde(default)]
    pub request_id: Option<String>,
    pub operation: String,
    #[serde(default)]
    pub registry: Option<RegistryDefinition>,
    #[serde(default)]
    pub parent: Option<ParentState>,
    #[serde(default)]
    pub transition: Option<TransitionSpec>,
    #[serde(default)]
    pub path: Option<PathSpec>,
}

#[derive(Debug, Serialize)]
pub struct ResponseEnvelope {
    pub schema: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct CompiledRegistryResult {
    pub schema: &'static str,
    pub registry_hash: String,
    pub id: String,
    pub time_unit: String,
    pub field_count: usize,
    pub coupling_count: usize,
    pub fields: Vec<IndexedField>,
    pub genesis_parent: ParentState,
}

#[derive(Debug, Serialize)]
pub struct IndexedField {
    pub index: usize,
    pub id: String,
    pub incoming_coupling_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PathSample {
    pub step: usize,
    pub time: f64,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetainedPath {
    pub schema: &'static str,
    pub retention: PathSpec,
    pub interpolation: &'static str,
    pub total_sample_count: usize,
    pub samples: Vec<PathSample>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuerySummary {
    pub delta_time: f64,
    pub requested_step_size: f64,
    pub actual_step_size: f64,
    pub step_count: usize,
    pub start_time: f64,
    pub end_time: f64,
    pub events: Vec<NormalizedEvent>,
    pub query_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RandomnessSummary {
    pub generator: &'static str,
    pub keyed_per_field_and_step: bool,
    pub draw_set_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CandidateClaims {
    pub complete_registry_coverage: bool,
    pub frozen_parent: bool,
    pub synchronous_steps: bool,
    pub side_effect_free_candidate: bool,
    pub persistent_commit: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Candidate {
    pub schema: &'static str,
    pub registry_hash: String,
    pub parent_hash: String,
    pub expected_parent_version: u64,
    pub seed: String,
    pub roll_index: u64,
    pub query: QuerySummary,
    pub trajectory_hash: String,
    pub path: RetainedPath,
    pub end_values: Vec<f64>,
    pub randomness: RandomnessSummary,
    pub claims: CandidateClaims,
    pub candidate_hash: String,
}

#[derive(Debug, Serialize)]
struct CandidateFingerprint<'a> {
    schema: &'static str,
    registry_hash: &'a str,
    parent_hash: &'a str,
    expected_parent_version: u64,
    seed: &'a str,
    roll_index: u64,
    query_hash: &'a str,
    trajectory_hash: &'a str,
    end_values: &'a [f64],
    draw_set_hash: &'a str,
}

#[derive(Debug, Clone, Serialize)]
pub struct SimulationMetrics {
    pub field_count: usize,
    pub coupling_count: usize,
    pub event_effect_count: usize,
    pub step_count: usize,
    pub scalar_updates: u64,
    pub retained_sample_count: usize,
    pub kernel_micros: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RollResult {
    pub schema: &'static str,
    pub field_ids: Vec<String>,
    pub candidate: Candidate,
    pub proposed_successor: ParentState,
    pub metrics: SimulationMetrics,
}

#[derive(Debug, Serialize)]
struct QueryFingerprint<'a> {
    schema: &'static str,
    delta_time: f64,
    requested_step_size: f64,
    actual_step_size: f64,
    step_count: usize,
    events: &'a [NormalizedEvent],
}

pub fn compile_registry(definition: RegistryDefinition) -> EngineResult<CompiledRegistry> {
    if definition.schema != REGISTRY_SCHEMA {
        return Err(error(format!(
            "unsupported registry schema {}; expected {REGISTRY_SCHEMA}",
            definition.schema
        )));
    }
    let definition_bytes = serde_json::to_vec(&definition)
        .map_err(|cause| error(format!("failed to estimate registry size: {cause}")))?
        .len();
    if definition_bytes > MAX_COMMAND_BYTES {
        return Err(error(format!(
            "registry is {definition_bytes} bytes; limit is {MAX_COMMAND_BYTES}"
        )));
    }
    if definition.id.trim().is_empty()
        || definition.time_unit.trim().is_empty()
        || definition.id.len() > MAX_LEGACY_STRING_BYTES
        || definition.time_unit.len() > MAX_LEGACY_STRING_BYTES
    {
        return Err(error("registry id and time_unit must be nonempty"));
    }
    if definition.fields.is_empty() {
        return Err(error("registry must contain at least one field"));
    }
    if definition.fields.len() > MAX_LEGACY_FIELDS
        || definition.couplings.len() > MAX_LEGACY_COUPLINGS
    {
        return Err(error("registry exceeds the legacy field or coupling limit"));
    }

    let mut fields = definition.fields;
    fields.sort_by(|left, right| left.id.cmp(&right.id));
    let mut field_indices = BTreeMap::new();
    for (index, field) in fields.iter().enumerate() {
        validate_field(field)?;
        if field_indices.insert(field.id.clone(), index).is_some() {
            return Err(error(format!("duplicate field id {}", field.id)));
        }
    }

    let mut coupling_defs = definition.couplings;
    coupling_defs.sort_by(|left, right| left.id.cmp(&right.id));
    let mut coupling_ids = BTreeSet::new();
    let mut normalized_couplings = Vec::with_capacity(coupling_defs.len());
    let mut incoming = vec![Vec::new(); fields.len()];
    for coupling in coupling_defs {
        if coupling.id.trim().is_empty() {
            return Err(error("coupling id must be nonempty"));
        }
        if !coupling_ids.insert(coupling.id.clone()) {
            return Err(error(format!("duplicate coupling id {}", coupling.id)));
        }
        finite(coupling.gain, &format!("coupling {} gain", coupling.id))?;
        let source_index = *field_indices.get(&coupling.source).ok_or_else(|| {
            error(format!(
                "coupling {} has unknown source {}",
                coupling.id, coupling.source
            ))
        })?;
        let target_index = *field_indices.get(&coupling.target).ok_or_else(|| {
            error(format!(
                "coupling {} has unknown target {}",
                coupling.id, coupling.target
            ))
        })?;
        let source_center = coupling
            .source_center
            .unwrap_or((fields[source_index].minimum + fields[source_index].maximum) / 2.0);
        finite(
            source_center,
            &format!("coupling {} source_center", coupling.id),
        )?;
        incoming[target_index].push(CompiledCoupling {
            source_index,
            mode: coupling.mode,
            source_center,
            gain: coupling.gain,
        });
        normalized_couplings.push(NormalizedCoupling {
            id: coupling.id,
            source: coupling.source,
            target: coupling.target,
            mode: coupling.mode,
            source_center,
            gain: coupling.gain,
        });
    }

    let normalized = NormalizedRegistry {
        schema: REGISTRY_SCHEMA,
        id: definition.id.clone(),
        time_unit: definition.time_unit.clone(),
        fields: fields.clone(),
        couplings: normalized_couplings,
    };
    let registry_hash = hash_serializable(&normalized)?;
    Ok(CompiledRegistry {
        registry_hash,
        id: definition.id,
        time_unit: definition.time_unit,
        field_ids: fields.iter().map(|field| field.id.clone()).collect(),
        fields,
        incoming,
        coupling_count: coupling_ids.len(),
    })
}

fn validate_field(field: &FieldDefinition) -> EngineResult<()> {
    if field.id.trim().is_empty() || field.id.len() > MAX_LEGACY_STRING_BYTES {
        return Err(error("field id must be nonempty"));
    }
    finite(field.minimum, &format!("field {} minimum", field.id))?;
    finite(field.maximum, &format!("field {} maximum", field.id))?;
    finite(
        field.initial_value,
        &format!("field {} initial_value", field.id),
    )?;
    finite(
        field.drift_target,
        &format!("field {} drift_target", field.id),
    )?;
    finite(field.drift_rate, &format!("field {} drift_rate", field.id))?;
    finite(
        field.noise_scale,
        &format!("field {} noise_scale", field.id),
    )?;
    if field.maximum <= field.minimum {
        return Err(error(format!(
            "field {} maximum must exceed minimum",
            field.id
        )));
    }
    if !(field.minimum..=field.maximum).contains(&field.initial_value) {
        return Err(error(format!(
            "field {} initial_value is outside its bounds",
            field.id
        )));
    }
    if !(field.minimum..=field.maximum).contains(&field.drift_target) {
        return Err(error(format!(
            "field {} drift_target is outside its bounds",
            field.id
        )));
    }
    if field.drift_rate < 0.0 || field.noise_scale < 0.0 {
        return Err(error(format!(
            "field {} drift_rate and noise_scale must be nonnegative",
            field.id
        )));
    }
    Ok(())
}

impl CompiledRegistry {
    pub fn genesis_parent(&self) -> EngineResult<ParentState> {
        let values = self
            .fields
            .iter()
            .map(|field| field.initial_value)
            .collect();
        build_parent(self, 0, 0.0, values, None)
    }

    pub fn summary(&self) -> EngineResult<CompiledRegistryResult> {
        Ok(CompiledRegistryResult {
            schema: REGISTRY_SCHEMA,
            registry_hash: self.registry_hash.clone(),
            id: self.id.clone(),
            time_unit: self.time_unit.clone(),
            field_count: self.fields.len(),
            coupling_count: self.coupling_count,
            fields: self
                .field_ids
                .iter()
                .enumerate()
                .map(|(index, id)| IndexedField {
                    index,
                    id: id.clone(),
                    incoming_coupling_count: self.incoming[index].len(),
                })
                .collect(),
            genesis_parent: self.genesis_parent()?,
        })
    }
}

fn build_parent(
    registry: &CompiledRegistry,
    version: u64,
    time: f64,
    values: Vec<f64>,
    lineage_head: Option<String>,
) -> EngineResult<ParentState> {
    finite(time, "parent time")?;
    validate_values(registry, &values, "parent")?;
    let fingerprint = ParentFingerprint {
        schema: PARENT_SCHEMA,
        registry_hash: &registry.registry_hash,
        version,
        time,
        values: &values,
        lineage_head: &lineage_head,
    };
    let parent_hash = hash_serializable(&fingerprint)?;
    Ok(ParentState {
        schema: PARENT_SCHEMA.to_owned(),
        registry_hash: registry.registry_hash.clone(),
        version,
        time,
        values,
        lineage_head,
        parent_hash,
    })
}

fn validate_parent(registry: &CompiledRegistry, parent: &ParentState) -> EngineResult<()> {
    if parent.schema != PARENT_SCHEMA {
        return Err(error(format!(
            "unsupported parent schema {}; expected {PARENT_SCHEMA}",
            parent.schema
        )));
    }
    if parent.registry_hash != registry.registry_hash {
        return Err(error("parent belongs to a different registry"));
    }
    finite(parent.time, "parent time")?;
    validate_values(registry, &parent.values, "parent")?;
    let fingerprint = ParentFingerprint {
        schema: PARENT_SCHEMA,
        registry_hash: &parent.registry_hash,
        version: parent.version,
        time: parent.time,
        values: &parent.values,
        lineage_head: &parent.lineage_head,
    };
    if hash_serializable(&fingerprint)? != parent.parent_hash {
        return Err(error("parent hash is stale"));
    }
    Ok(())
}

fn validate_values(registry: &CompiledRegistry, values: &[f64], label: &str) -> EngineResult<()> {
    if values.len() != registry.fields.len() {
        return Err(error(format!(
            "{label} has {} values but registry requires {}",
            values.len(),
            registry.fields.len()
        )));
    }
    for (index, (value, field)) in values.iter().zip(&registry.fields).enumerate() {
        if !value.is_finite() || *value < field.minimum || *value > field.maximum {
            return Err(error(format!(
                "{label} value {index} ({}) is invalid for field {}",
                value, field.id
            )));
        }
    }
    Ok(())
}

fn normalize_events(
    registry: &CompiledRegistry,
    events: Vec<EventDefinition>,
    delta_time: f64,
) -> EngineResult<(
    Vec<NormalizedEvent>,
    Vec<CompiledEvent>,
    Vec<Vec<CompiledEventEffect>>,
    usize,
)> {
    let field_indices: BTreeMap<&str, usize> = registry
        .field_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect();
    let mut events = events;
    events.sort_by(|left, right| left.id.cmp(&right.id));
    let mut ids = BTreeSet::new();
    let mut normalized = Vec::with_capacity(events.len());
    let mut compiled = Vec::with_capacity(events.len());
    let mut effects_by_target = vec![Vec::new(); registry.fields.len()];
    let mut effect_count = 0;

    for event in events {
        if event.id.trim().is_empty() {
            return Err(error("event id must be nonempty"));
        }
        if !ids.insert(event.id.clone()) {
            return Err(error(format!("duplicate event id {}", event.id)));
        }
        let end_offset = event.end_offset.unwrap_or(delta_time);
        finite(
            event.start_offset,
            &format!("event {} start_offset", event.id),
        )?;
        finite(end_offset, &format!("event {} end_offset", event.id))?;
        finite(
            event.intensity.start,
            &format!("event {} intensity.start", event.id),
        )?;
        finite(
            event.intensity.end,
            &format!("event {} intensity.end", event.id),
        )?;
        if event.start_offset < 0.0 || end_offset <= event.start_offset || end_offset > delta_time {
            return Err(error(format!(
                "event {} must have 0 <= start_offset < end_offset <= delta_time",
                event.id
            )));
        }
        if event.effects.is_empty() {
            return Err(error(format!(
                "event {} must contain at least one effect",
                event.id
            )));
        }
        let mut event_effects = event.effects;
        event_effects.sort_by(|left, right| {
            left.target
                .cmp(&right.target)
                .then_with(|| left.rate.total_cmp(&right.rate))
        });
        let event_index = compiled.len();
        for effect in &event_effects {
            finite(effect.rate, &format!("event {} effect rate", event.id))?;
            let target_index = *field_indices.get(effect.target.as_str()).ok_or_else(|| {
                error(format!(
                    "event {} has unknown target {}",
                    event.id, effect.target
                ))
            })?;
            effects_by_target[target_index].push(CompiledEventEffect {
                event_index,
                rate: effect.rate,
            });
            effect_count += 1;
        }
        normalized.push(NormalizedEvent {
            id: event.id,
            start_offset: event.start_offset,
            end_offset,
            intensity: event.intensity,
            effects: event_effects,
        });
        compiled.push(CompiledEvent {
            start_offset: event.start_offset,
            end_offset,
            intensity: event.intensity,
        });
    }
    Ok((normalized, compiled, effects_by_target, effect_count))
}

fn event_intensity(event: &CompiledEvent, elapsed: f64) -> f64 {
    if elapsed < event.start_offset || elapsed > event.end_offset {
        return 0.0;
    }
    let fraction = (elapsed - event.start_offset) / (event.end_offset - event.start_offset);
    event.intensity.start + fraction * (event.intensity.end - event.intensity.start)
}

pub fn roll_transition(
    registry: &CompiledRegistry,
    parent: &ParentState,
    transition: TransitionSpec,
    path_spec: PathSpec,
) -> EngineResult<RollResult> {
    validate_parent(registry, parent)?;
    finite(transition.delta_time, "delta_time")?;
    finite(transition.step_size, "step_size")?;
    let transition_bytes = serde_json::to_vec(&transition)
        .map_err(|cause| error(format!("failed to estimate transition size: {cause}")))?
        .len();
    if transition_bytes > MAX_COMMAND_BYTES {
        return Err(error(format!(
            "transition is {transition_bytes} bytes; limit is {MAX_COMMAND_BYTES}"
        )));
    }
    if transition.delta_time <= 0.0
        || transition.step_size <= 0.0
        || transition.delta_time > MAX_LEGACY_DURATION
        || transition.step_size > MAX_LEGACY_DURATION
    {
        return Err(error(
            "delta_time and step_size must be positive and at most 30",
        ));
    }
    if transition.seed.is_empty() || transition.seed.len() > MAX_LEGACY_STRING_BYTES {
        return Err(error("seed must be nonempty"));
    }
    if transition.events.len() > MAX_LEGACY_EVENTS {
        return Err(error("transition exceeds the legacy event limit"));
    }
    let declared_effect_count = transition.events.iter().try_fold(0usize, |total, event| {
        total
            .checked_add(event.effects.len())
            .ok_or_else(|| error("legacy event-effect count overflow"))
    })?;
    if declared_effect_count > MAX_LEGACY_EVENT_EFFECTS {
        return Err(error("transition exceeds the legacy event-effect limit"));
    }
    if let PathSpec::Decimated { every } = &path_spec {
        if *every == 0 {
            return Err(error("decimated path interval must be positive"));
        }
    }
    let raw_step_count = (transition.delta_time / transition.step_size).ceil();
    if !raw_step_count.is_finite() || raw_step_count < 1.0 || raw_step_count > MAX_STEPS as f64 {
        return Err(error(format!(
            "transition step count must be between 1 and {MAX_STEPS}"
        )));
    }
    let step_count = raw_step_count as usize;
    let actual_step_size = transition.delta_time / step_count as f64;
    let end_time = parent.time + transition.delta_time;
    if !end_time.is_finite() || end_time <= parent.time {
        return Err(error("transition end time is invalid"));
    }
    let (normalized_events, compiled_events, effects_by_target, event_effect_count) =
        normalize_events(registry, transition.events, transition.delta_time)?;
    let work_width = registry
        .fields
        .len()
        .checked_add(registry.coupling_count)
        .and_then(|value| value.checked_add(compiled_events.len()))
        .and_then(|value| value.checked_add(event_effect_count))
        .ok_or_else(|| error("legacy transition work estimate overflow"))?;
    let work = step_count
        .checked_mul(work_width)
        .ok_or_else(|| error("legacy transition work estimate overflow"))?;
    if work > MAX_LEGACY_WORK {
        return Err(error(format!(
            "legacy transition estimated work {work} exceeds limit {MAX_LEGACY_WORK}"
        )));
    }
    let state_bytes = registry
        .fields
        .len()
        .checked_mul(std::mem::size_of::<f64>())
        .ok_or_else(|| error("legacy state-size estimate overflow"))?;
    let state_byte_steps = state_bytes
        .checked_mul(step_count.saturating_add(1))
        .ok_or_else(|| error("legacy state-byte work estimate overflow"))?;
    if state_byte_steps > MAX_LEGACY_STATE_BYTE_STEPS {
        return Err(error(format!(
            "legacy transition state-byte work {state_byte_steps} exceeds limit {MAX_LEGACY_STATE_BYTE_STEPS}"
        )));
    }
    let retained_bytes = retained_capacity(&path_spec, step_count)
        .checked_mul(state_bytes.saturating_add(24))
        .ok_or_else(|| error("legacy retained-state estimate overflow"))?;
    if retained_bytes > MAX_LEGACY_RETAINED_BYTES {
        return Err(error(format!(
            "legacy transition retained-state estimate {retained_bytes} exceeds limit {MAX_LEGACY_RETAINED_BYTES}"
        )));
    }
    let query_fingerprint = QueryFingerprint {
        schema: "life-sim-rust-query/v1",
        delta_time: transition.delta_time,
        requested_step_size: transition.step_size,
        actual_step_size,
        step_count,
        events: &normalized_events,
    };
    let query_hash = hash_serializable(&query_fingerprint)?;
    let master_key = master_key(
        &transition.seed,
        &parent.parent_hash,
        &query_hash,
        transition.roll_index,
    );

    let started = Instant::now();
    let mut values = parent.values.clone();
    let mut next = vec![0.0; values.len()];
    let mut event_intensities = vec![0.0; compiled_events.len()];
    let mut samples = Vec::with_capacity(retained_capacity(&path_spec, step_count));
    let mut trajectory_hasher = Sha256::new();
    trajectory_hasher.update(b"life-sim-rust-trajectory/v1\0");
    let mut draw_hasher = Sha256::new();
    draw_hasher.update(b"life-sim-rust-draw-set/v1\0");

    hash_trajectory_sample(&mut trajectory_hasher, 0, parent.time, &values);
    if retain_step(&path_spec, 0, step_count) {
        samples.push(PathSample {
            step: 0,
            time: parent.time,
            values: values.clone(),
        });
    }

    for step_index in 0..step_count {
        let elapsed_midpoint = (step_index as f64 + 0.5) * actual_step_size;
        for (intensity, event) in event_intensities.iter_mut().zip(&compiled_events) {
            *intensity = event_intensity(event, elapsed_midpoint);
        }
        for field_index in 0..registry.fields.len() {
            let field = &registry.fields[field_index];
            let mut derivative = field.drift_rate * (field.drift_target - values[field_index]);
            for coupling in &registry.incoming[field_index] {
                let signal = match coupling.mode {
                    CouplingMode::Centered => {
                        values[coupling.source_index] - coupling.source_center
                    }
                    CouplingMode::Difference => values[coupling.source_index] - values[field_index],
                };
                derivative += coupling.gain * signal;
            }
            for effect in &effects_by_target[field_index] {
                derivative += event_intensities[effect.event_index] * effect.rate;
            }
            let (draw, draw_a, draw_b) = normal_approximation(master_key, field_index, step_index);
            draw_hasher.update((field_index as u64).to_le_bytes());
            draw_hasher.update((step_index as u64).to_le_bytes());
            draw_hasher.update(draw_a.to_le_bytes());
            draw_hasher.update(draw_b.to_le_bytes());
            let innovation = field.noise_scale * actual_step_size.sqrt() * draw;
            let proposed = values[field_index] + derivative * actual_step_size + innovation;
            if !proposed.is_finite() {
                return Err(error(format!(
                    "dynamics produced a non-finite value for field {} at step {}",
                    field.id,
                    step_index + 1
                )));
            }
            next[field_index] = proposed.clamp(field.minimum, field.maximum);
        }
        std::mem::swap(&mut values, &mut next);
        let completed_step = step_index + 1;
        let time = if completed_step == step_count {
            end_time
        } else {
            parent.time + completed_step as f64 * actual_step_size
        };
        hash_trajectory_sample(&mut trajectory_hasher, completed_step, time, &values);
        if retain_step(&path_spec, completed_step, step_count) {
            samples.push(PathSample {
                step: completed_step,
                time,
                values: values.clone(),
            });
        }
    }

    let trajectory_hash = hex_digest(trajectory_hasher.finalize());
    let draw_set_hash = hex_digest(draw_hasher.finalize());
    let candidate_fingerprint = CandidateFingerprint {
        schema: CANDIDATE_SCHEMA,
        registry_hash: &registry.registry_hash,
        parent_hash: &parent.parent_hash,
        expected_parent_version: parent.version,
        seed: &transition.seed,
        roll_index: transition.roll_index,
        query_hash: &query_hash,
        trajectory_hash: &trajectory_hash,
        end_values: &values,
        draw_set_hash: &draw_set_hash,
    };
    let candidate_hash = hash_serializable(&candidate_fingerprint)?;
    let successor_version = parent
        .version
        .checked_add(1)
        .ok_or_else(|| error("parent version overflow"))?;
    let proposed_successor = build_parent(
        registry,
        successor_version,
        end_time,
        values.clone(),
        Some(candidate_hash.clone()),
    )?;
    let retained_sample_count = samples.len();
    let elapsed_micros = started.elapsed().as_micros().min(u64::MAX as u128) as u64;
    let candidate = Candidate {
        schema: CANDIDATE_SCHEMA,
        registry_hash: registry.registry_hash.clone(),
        parent_hash: parent.parent_hash.clone(),
        expected_parent_version: parent.version,
        seed: transition.seed,
        roll_index: transition.roll_index,
        query: QuerySummary {
            delta_time: transition.delta_time,
            requested_step_size: transition.step_size,
            actual_step_size,
            step_count,
            start_time: parent.time,
            end_time,
            events: normalized_events,
            query_hash,
        },
        trajectory_hash,
        path: RetainedPath {
            schema: PATH_SCHEMA,
            retention: path_spec,
            interpolation: "piecewise-linear-continuous",
            total_sample_count: step_count + 1,
            samples,
        },
        end_values: values,
        randomness: RandomnessSummary {
            generator: "splitmix64-irwin-hall-12/v1",
            keyed_per_field_and_step: true,
            draw_set_hash,
        },
        claims: CandidateClaims {
            complete_registry_coverage: true,
            frozen_parent: true,
            synchronous_steps: true,
            side_effect_free_candidate: true,
            persistent_commit: false,
        },
        candidate_hash,
    };
    Ok(RollResult {
        schema: "life-sim-rust-roll-result/v1",
        field_ids: registry.field_ids.clone(),
        candidate,
        proposed_successor,
        metrics: SimulationMetrics {
            field_count: registry.fields.len(),
            coupling_count: registry.coupling_count,
            event_effect_count,
            step_count,
            scalar_updates: (registry.fields.len() as u64).saturating_mul(step_count as u64),
            retained_sample_count,
            kernel_micros: elapsed_micros,
        },
    })
}

fn retained_capacity(spec: &PathSpec, step_count: usize) -> usize {
    match spec {
        PathSpec::Endpoint => 1,
        PathSpec::Full => step_count.saturating_add(1),
        PathSpec::Decimated { every } => step_count / *every + 2,
    }
}

fn retain_step(spec: &PathSpec, step: usize, step_count: usize) -> bool {
    match spec {
        PathSpec::Endpoint => step == step_count,
        PathSpec::Full => true,
        PathSpec::Decimated { every } => step == 0 || step == step_count || step % *every == 0,
    }
}

fn hash_trajectory_sample(hasher: &mut Sha256, step: usize, time: f64, values: &[f64]) {
    hasher.update((step as u64).to_le_bytes());
    hasher.update(time.to_bits().to_le_bytes());
    hasher.update((values.len() as u64).to_le_bytes());
    for value in values {
        hasher.update(value.to_bits().to_le_bytes());
    }
}

fn master_key(seed: &str, parent_hash: &str, query_hash: &str, roll_index: u64) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(b"life-sim-rust-master-key/v1\0");
    hasher.update(seed.as_bytes());
    hasher.update([0u8]);
    hasher.update(parent_hash.as_bytes());
    hasher.update([0u8]);
    hasher.update(query_hash.as_bytes());
    hasher.update([0u8]);
    hasher.update(roll_index.to_le_bytes());
    let digest = hasher.finalize();
    u64::from_le_bytes(
        digest[..8]
            .try_into()
            .expect("sha256 prefix is eight bytes"),
    )
}

fn normal_approximation(master: u64, field_index: usize, step_index: usize) -> (f64, u64, u64) {
    let counter = master
        ^ (field_index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (step_index as u64).wrapping_mul(0xD1B5_4A32_D192_ED03);
    let draw_a = splitmix64(counter);
    let draw_b = splitmix64(counter ^ 0x94D0_49BB_1331_11EB);
    let mut sum = 0.0;
    for offset in 0..6 {
        let shift = offset * 10;
        sum += (((draw_a >> shift) & 0x3ff) as f64 + 0.5) / 1024.0;
        sum += (((draw_b >> shift) & 0x3ff) as f64 + 0.5) / 1024.0;
    }
    (sum - 6.0, draw_a, draw_b)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9E37_79B9_7F4A_7C15);
    value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^ (value >> 31)
}

fn hash_serializable<T: Serialize>(value: &T) -> EngineResult<String> {
    let encoded = serde_json::to_vec(value)
        .map_err(|cause| error(format!("failed to encode canonical engine value: {cause}")))?;
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    Ok(hex_digest(hasher.finalize()))
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    let mut output = String::with_capacity(bytes.len() * 2);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn execute_command(command: CommandEnvelope) -> ResponseEnvelope {
    let request_id = command.request_id.clone();
    let outcome = execute_operation(command);
    match outcome {
        Ok(result) => ResponseEnvelope {
            schema: RESPONSE_SCHEMA,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(cause) => ResponseEnvelope {
            schema: RESPONSE_SCHEMA,
            request_id,
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: "invalid_request",
                message: cause.0,
            }),
        },
    }
}

fn execute_operation(command: CommandEnvelope) -> EngineResult<serde_json::Value> {
    if command.schema != COMMAND_SCHEMA {
        return Err(error(format!(
            "unsupported command schema {}; expected {COMMAND_SCHEMA}",
            command.schema
        )));
    }
    match command.operation.as_str() {
        "describe" => serde_json::to_value(machine_description())
            .map_err(|cause| error(format!("failed to encode describe response: {cause}"))),
        "compile_registry" => {
            let definition = command
                .registry
                .ok_or_else(|| error("compile_registry requires registry"))?;
            let compiled = compile_registry(definition)?;
            serde_json::to_value(compiled.summary()?)
                .map_err(|cause| error(format!("failed to encode compile response: {cause}")))
        }
        "roll" => {
            let definition = command
                .registry
                .ok_or_else(|| error("roll requires registry"))?;
            let parent = command
                .parent
                .ok_or_else(|| error("roll requires parent"))?;
            let transition = command
                .transition
                .ok_or_else(|| error("roll requires transition"))?;
            let compiled = compile_registry(definition)?;
            let result = roll_transition(
                &compiled,
                &parent,
                transition,
                command.path.unwrap_or_default(),
            )?;
            serde_json::to_value(result)
                .map_err(|cause| error(format!("failed to encode roll response: {cause}")))
        }
        unknown => Err(error(format!("unsupported operation {unknown}"))),
    }
}

pub fn parse_and_execute(input: &str) -> ResponseEnvelope {
    match serde_json::from_str::<CommandEnvelope>(input) {
        Ok(command) => execute_command(command),
        Err(cause) => ResponseEnvelope {
            schema: RESPONSE_SCHEMA,
            request_id: None,
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: "invalid_json",
                message: cause.to_string(),
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_definition() -> RegistryDefinition {
        RegistryDefinition {
            schema: REGISTRY_SCHEMA.to_owned(),
            id: "test-world".to_owned(),
            time_unit: "day".to_owned(),
            fields: vec![
                FieldDefinition {
                    id: "person.stress".to_owned(),
                    minimum: 0.0,
                    maximum: 1.0,
                    initial_value: 0.2,
                    drift_target: 0.2,
                    drift_rate: 0.0,
                    noise_scale: 0.1,
                },
                FieldDefinition {
                    id: "world.pressure".to_owned(),
                    minimum: 0.0,
                    maximum: 1.0,
                    initial_value: 0.8,
                    drift_target: 0.8,
                    drift_rate: 0.0,
                    noise_scale: 0.1,
                },
            ],
            couplings: vec![CouplingDefinition {
                id: "pressure-to-stress".to_owned(),
                source: "world.pressure".to_owned(),
                target: "person.stress".to_owned(),
                mode: CouplingMode::Centered,
                source_center: Some(0.5),
                gain: 0.25,
            }],
        }
    }

    fn transition(roll_index: u64) -> TransitionSpec {
        TransitionSpec {
            delta_time: 1.0,
            step_size: 0.25,
            events: vec![],
            seed: "stable-test-seed".to_owned(),
            roll_index,
        }
    }

    #[test]
    fn registry_uses_sorted_indices_and_sparse_incoming_lists() {
        let registry = compile_registry(registry_definition()).unwrap();
        assert_eq!(registry.field_ids, vec!["person.stress", "world.pressure"]);
        assert_eq!(registry.incoming[0].len(), 1);
        assert_eq!(registry.incoming[1].len(), 0);
        assert_eq!(registry.incoming[0][0].source_index, 1);
    }

    #[test]
    fn same_roll_is_deterministic_and_path_retention_does_not_change_identity() {
        let registry = compile_registry(registry_definition()).unwrap();
        let parent = registry.genesis_parent().unwrap();
        let endpoint =
            roll_transition(&registry, &parent, transition(3), PathSpec::Endpoint).unwrap();
        let full = roll_transition(&registry, &parent, transition(3), PathSpec::Full).unwrap();
        let decimated = roll_transition(
            &registry,
            &parent,
            transition(3),
            PathSpec::Decimated { every: 2 },
        )
        .unwrap();

        assert_eq!(endpoint.candidate.end_values, full.candidate.end_values);
        assert_eq!(
            endpoint.candidate.trajectory_hash,
            full.candidate.trajectory_hash
        );
        assert_eq!(
            endpoint.candidate.candidate_hash,
            full.candidate.candidate_hash
        );
        assert_eq!(
            endpoint.candidate.candidate_hash,
            decimated.candidate.candidate_hash
        );
        assert_eq!(endpoint.candidate.path.samples.len(), 1);
        assert_eq!(full.candidate.path.samples.len(), 5);
        assert_eq!(decimated.candidate.path.samples.len(), 3);
    }

    #[test]
    fn reroll_changes_the_whole_candidate_without_mutating_parent() {
        let registry = compile_registry(registry_definition()).unwrap();
        let parent = registry.genesis_parent().unwrap();
        let before = parent.clone();
        let first = roll_transition(&registry, &parent, transition(0), PathSpec::Endpoint).unwrap();
        let second =
            roll_transition(&registry, &parent, transition(1), PathSpec::Endpoint).unwrap();

        assert_eq!(parent, before);
        assert_ne!(
            first.candidate.candidate_hash,
            second.candidate.candidate_hash
        );
        assert_ne!(first.candidate.end_values, second.candidate.end_values);
        assert_eq!(first.candidate.parent_hash, second.candidate.parent_hash);
    }

    #[test]
    fn updates_are_synchronous_from_the_frozen_step_snapshot() {
        let definition = RegistryDefinition {
            schema: REGISTRY_SCHEMA.to_owned(),
            id: "synchronous".to_owned(),
            time_unit: "tick".to_owned(),
            fields: vec![
                FieldDefinition {
                    id: "a".to_owned(),
                    minimum: -10.0,
                    maximum: 10.0,
                    initial_value: 1.0,
                    drift_target: 3.0,
                    drift_rate: 1.0,
                    noise_scale: 0.0,
                },
                FieldDefinition {
                    id: "b".to_owned(),
                    minimum: -10.0,
                    maximum: 10.0,
                    initial_value: 0.0,
                    drift_target: 0.0,
                    drift_rate: 0.0,
                    noise_scale: 0.0,
                },
            ],
            couplings: vec![CouplingDefinition {
                id: "a-to-b".to_owned(),
                source: "a".to_owned(),
                target: "b".to_owned(),
                mode: CouplingMode::Centered,
                source_center: Some(0.0),
                gain: 1.0,
            }],
        };
        let registry = compile_registry(definition).unwrap();
        let parent = registry.genesis_parent().unwrap();
        let result = roll_transition(
            &registry,
            &parent,
            TransitionSpec {
                delta_time: 1.0,
                step_size: 1.0,
                events: vec![],
                seed: "sync".to_owned(),
                roll_index: 0,
            },
            PathSpec::Endpoint,
        )
        .unwrap();
        assert_eq!(result.candidate.end_values, vec![3.0, 1.0]);
    }

    #[test]
    fn event_envelope_is_continuous_and_sampled_at_step_midpoint() {
        let definition = RegistryDefinition {
            schema: REGISTRY_SCHEMA.to_owned(),
            id: "event".to_owned(),
            time_unit: "tick".to_owned(),
            fields: vec![FieldDefinition {
                id: "pressure".to_owned(),
                minimum: 0.0,
                maximum: 2.0,
                initial_value: 0.0,
                drift_target: 0.0,
                drift_rate: 0.0,
                noise_scale: 0.0,
            }],
            couplings: vec![],
        };
        let registry = compile_registry(definition).unwrap();
        let parent = registry.genesis_parent().unwrap();
        let result = roll_transition(
            &registry,
            &parent,
            TransitionSpec {
                delta_time: 1.0,
                step_size: 1.0,
                events: vec![EventDefinition {
                    id: "ramp".to_owned(),
                    start_offset: 0.0,
                    end_offset: Some(1.0),
                    intensity: LinearEnvelope {
                        start: 0.0,
                        end: 1.0,
                    },
                    effects: vec![EventEffectDefinition {
                        target: "pressure".to_owned(),
                        rate: 1.0,
                    }],
                }],
                seed: "event".to_owned(),
                roll_index: 0,
            },
            PathSpec::Full,
        )
        .unwrap();
        assert_eq!(result.candidate.end_values, vec![0.5]);
    }

    #[test]
    fn bounds_are_enforced() {
        let mut definition = registry_definition();
        definition.fields[0].noise_scale = 0.0;
        definition.fields[1].noise_scale = 0.0;
        let registry = compile_registry(definition).unwrap();
        let parent = registry.genesis_parent().unwrap();
        let result = roll_transition(
            &registry,
            &parent,
            TransitionSpec {
                delta_time: 1.0,
                step_size: 1.0,
                events: vec![EventDefinition {
                    id: "overload".to_owned(),
                    start_offset: 0.0,
                    end_offset: Some(1.0),
                    intensity: LinearEnvelope::default(),
                    effects: vec![EventEffectDefinition {
                        target: "person.stress".to_owned(),
                        rate: 100.0,
                    }],
                }],
                seed: "bounds".to_owned(),
                roll_index: 0,
            },
            PathSpec::Endpoint,
        )
        .unwrap();
        assert_eq!(result.candidate.end_values[0], 1.0);
    }

    #[test]
    fn stale_parent_hash_and_zero_decimation_are_rejected() {
        let registry = compile_registry(registry_definition()).unwrap();
        let mut parent = registry.genesis_parent().unwrap();
        parent.values[0] += 0.1;
        assert!(roll_transition(&registry, &parent, transition(0), PathSpec::Endpoint).is_err());

        let parent = registry.genesis_parent().unwrap();
        assert!(roll_transition(
            &registry,
            &parent,
            transition(0),
            PathSpec::Decimated { every: 0 }
        )
        .is_err());
    }

    #[test]
    fn json_protocol_returns_structured_errors() {
        let response = parse_and_execute(r#"{"schema":"wrong","operation":"describe"}"#);
        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, "invalid_request");

        let response = parse_and_execute("not json");
        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, "invalid_json");
    }
}
