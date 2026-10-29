//! Compiling a model: every authored definition is validated (processes, values, claims, decomposition and dependency
//! edges, expressions and laws) and indexed into a CompiledModel.
//!
//! A definition that compiles is executable; one that does not is refused with the first problem found, and nothing is
//! compiled from it. A compiled model's hash is the hash of its definition, so the same definition always has the same
//! hash and a hash names exactly one definition. The checks of single values and claims that other modules reuse
//! (`validate_process_value`, `validate_claim`, `validate_uncertainty`) live here, as do the facts read off a compiled
//! model's laws: what a law reads and writes, and which law writes a process.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::Serialize;

use crate::limits::{
    serialized_size, MAX_EXPRESSION_DEPTH, MAX_MODEL_DEFINITION_BYTES, MAX_MODEL_EXPRESSION_NODES,
    MAX_MODEL_IDENTIFIER_BYTES, MAX_QUERY_ACCESS_SCOPES, MAX_QUERY_STRING_BYTES, MAX_VALUE_POINTS,
    MAX_VALUE_TEXT_BYTES,
};
use crate::model::definition::{
    Claim, ClaimAuthority, ClaimMode, ClaimTemplate, ClaimUncertainty, DecompositionEdge,
    DependencyEdge, DependencyKind, EvidenceType, LawActivation, LawDefinition, LawOperator,
    ModelDefinition, ModelRevision, NumericBounds, OccurrenceTrigger, ProcessDefinition,
    ProcessType, ProcessValue, ScalarExpression, StateEffect, ValueSeries, VALUE_TAGS,
};
use crate::model::meaning::{self, MeaningModelDefinition, MeaningModelSummary};
use crate::model::MODEL_SCHEMA;
use crate::{error, finite, hash_serializable, EngineResult};

#[derive(Debug, Clone, Serialize)]
pub struct ProcessSummary {
    pub id: String,
    pub value_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelSummary {
    pub schema: &'static str,
    pub model_hash: String,
    pub id: String,
    pub time_unit: String,
    pub revision: ModelRevision,
    pub process_count: usize,
    pub decomposition_edge_count: usize,
    pub dependency_edge_count: usize,
    pub law_count: usize,
    pub law_roles: BTreeMap<String, usize>,
    pub process_ids: Vec<String>,
    pub processes: Vec<ProcessSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meaning_model: Option<MeaningModelSummary>,
}

#[derive(Debug, Clone)]
pub struct CompiledModel {
    pub model_hash: String,
    pub id: String,
    pub time_unit: String,
    pub revision: ModelRevision,
    pub(crate) definition: ModelDefinition,
    pub(crate) processes: BTreeMap<String, ProcessDefinition>,
    pub(super) laws: Vec<LawDefinition>,
    pub(crate) initial_claims: BTreeMap<String, Claim>,
    pub(super) derived_order: Vec<usize>,
    pub(super) expression_node_count: usize,
}

impl CompiledModel {
    pub fn summary(&self) -> ModelSummary {
        let mut roles = BTreeMap::new();
        for law in &self.laws {
            *roles
                .entry(law.operator.role_name().to_owned())
                .or_insert(0) += 1;
        }
        ModelSummary {
            schema: MODEL_SCHEMA,
            model_hash: self.model_hash.clone(),
            id: self.id.clone(),
            time_unit: self.time_unit.clone(),
            revision: self.revision.clone(),
            process_count: self.processes.len(),
            decomposition_edge_count: self.definition.decomposition.len(),
            dependency_edge_count: self.definition.dependencies.len(),
            law_count: self.laws.len(),
            law_roles: roles,
            process_ids: self.processes.keys().cloned().collect(),
            processes: self
                .processes
                .values()
                .map(|process| ProcessSummary {
                    id: process.id.clone(),
                    value_type: process.value_type.name().to_owned(),
                })
                .collect(),
            meaning_model: self
                .definition
                .meaning_model
                .as_ref()
                .map(MeaningModelDefinition::summary),
        }
    }

    pub fn definition(&self) -> &ModelDefinition {
        &self.definition
    }
}

pub fn compile_model(mut definition: ModelDefinition) -> EngineResult<CompiledModel> {
    if definition.schema != MODEL_SCHEMA {
        return Err(error(format!(
            "unsupported model schema {}; expected {MODEL_SCHEMA}",
            definition.schema
        )));
    }
    if definition.id.trim().is_empty() || definition.time_unit.trim().is_empty() {
        return Err(error("model id and time_unit must be nonempty"));
    }
    let definition_bytes = serialized_size(&definition)?;
    if definition_bytes > MAX_MODEL_DEFINITION_BYTES {
        return Err(error(format!(
            "model definition is {definition_bytes} bytes; limit is {MAX_MODEL_DEFINITION_BYTES}"
        )));
    }
    validate_revision(&definition.revision)?;
    if definition.processes.is_empty() {
        return Err(error("model must contain at least one process"));
    }
    definition.processes.sort_by(|a, b| a.id.cmp(&b.id));
    definition.decomposition.sort_by(|a, b| a.id.cmp(&b.id));
    definition.dependencies.sort_by(|a, b| a.id.cmp(&b.id));
    definition.laws.sort_by(|a, b| a.id.cmp(&b.id));
    definition.initial_claims.sort_by(|a, b| a.id.cmp(&b.id));
    definition.value_series.sort_by(|a, b| a.id.cmp(&b.id));
    if let Some(meaning_model) = &mut definition.meaning_model {
        meaning::normalize_meaning_model(meaning_model);
    }

    let mut processes = BTreeMap::new();
    for process in &definition.processes {
        validate_process(process)?;
        if processes
            .insert(process.id.clone(), process.clone())
            .is_some()
        {
            return Err(error(format!("duplicate process id {}", process.id)));
        }
    }
    if let Some(meaning_model) = &definition.meaning_model {
        meaning::validate_meaning_model(meaning_model, &processes)?;
    }
    validate_decomposition(&definition.decomposition, &processes)?;
    let derived_order = validate_laws(&definition.laws, &processes)?;
    let expression_node_count = model_expression_node_count(&definition.laws)?;
    validate_dependencies(&definition.dependencies, &definition.laws, &processes)?;
    let mut initial_claims = BTreeMap::new();
    for claim in &definition.initial_claims {
        validate_claim(claim, &processes)?;
        if claim.evidence_cutoff > 0.0 {
            return Err(error(format!(
                "initial claim {} has evidence from after genesis time 0",
                claim.id
            )));
        }
        if initial_claims
            .insert(claim.id.clone(), claim.clone())
            .is_some()
        {
            return Err(error(format!("duplicate initial claim id {}", claim.id)));
        }
    }
    validate_value_series(&definition.value_series, &processes)?;
    let model_hash = hash_serializable(&definition)?;
    Ok(CompiledModel {
        model_hash,
        id: definition.id.clone(),
        time_unit: definition.time_unit.clone(),
        revision: definition.revision.clone(),
        processes,
        laws: definition.laws.clone(),
        initial_claims,
        derived_order,
        expression_node_count,
        definition,
    })
}

fn validate_revision(revision: &ModelRevision) -> EngineResult<()> {
    if revision.reason.trim().is_empty()
        || revision.provenance.is_empty()
        || revision.provenance.iter().any(|v| v.trim().is_empty())
    {
        return Err(error(
            "model revision requires reason and nonempty provenance",
        ));
    }
    match (revision.number, &revision.previous_model_hash) {
        (0, None) => Ok(()),
        (0, Some(_)) => Err(error("model revision 0 cannot name a previous model")),
        (_, None) => Err(error("model revision above 0 requires previous_model_hash")),
        (_, Some(hash)) if hash.trim().is_empty() => Err(error("previous_model_hash is empty")),
        _ => Ok(()),
    }
}

fn validate_bounds(bounds: &NumericBounds, label: &str) -> EngineResult<()> {
    finite(bounds.minimum, &format!("{label} minimum"))?;
    finite(bounds.maximum, &format!("{label} maximum"))?;
    if bounds.maximum <= bounds.minimum {
        return Err(error(format!("{label} maximum must exceed minimum")));
    }
    Ok(())
}

fn validate_labels(values: &[String], label: &str) -> EngineResult<()> {
    if values.is_empty() {
        return Err(error(format!("{label} must not be empty")));
    }
    let mut unique = BTreeSet::new();
    for value in values {
        if value.trim().is_empty() || !unique.insert(value) {
            return Err(error(format!("{label} must be unique and nonempty")));
        }
    }
    Ok(())
}

fn validate_process(process: &ProcessDefinition) -> EngineResult<()> {
    if process.id.trim().is_empty() || process.id.len() > MAX_MODEL_IDENTIFIER_BYTES {
        return Err(error("process id must be nonempty and bounded"));
    }
    if process.provenance.is_empty() || process.provenance.iter().any(|item| item.trim().is_empty())
    {
        return Err(error(format!(
            "process {} requires nonempty provenance",
            process.id
        )));
    }
    validate_uncertainty(
        &process.uncertainty,
        &format!("process {} uncertainty", process.id),
    )?;
    let mut axes = BTreeSet::new();
    if process
        .axes
        .iter()
        .any(|axis| axis.id.trim().is_empty() || !axes.insert(&axis.id))
    {
        return Err(error(format!(
            "process {} axes must have unique nonempty ids",
            process.id
        )));
    }
    if process.support.is_empty() || process.support.iter().any(|item| item.trim().is_empty()) {
        return Err(error(format!(
            "process {} requires at least one nonempty support declaration",
            process.id
        )));
    }
    let mut access_scopes = BTreeSet::new();
    if process.access_scopes.iter().any(|scope| {
        scope.trim().is_empty()
            || scope.len() > MAX_MODEL_IDENTIFIER_BYTES
            || !access_scopes.insert(scope)
    }) {
        return Err(error(format!(
            "process {} access scopes must be unique, nonempty, and bounded",
            process.id
        )));
    }
    match &process.value_type {
        ProcessType::Scalar { bounds } => validate_bounds(bounds, &process.id)?,
        ProcessType::Vector { dimensions, bounds } => {
            if *dimensions == 0 {
                return Err(error(format!("process {} has zero dimensions", process.id)));
            }
            validate_bounds(bounds, &process.id)?;
            if !process.axes.is_empty() && process.axes.len() != *dimensions {
                return Err(error(format!(
                    "process {} axes do not match dimensions",
                    process.id
                )));
            }
        }
        ProcessType::Category { variants } | ProcessType::Regime { variants } => {
            validate_labels(variants, &format!("process {} variants", process.id))?
        }
        ProcessType::Distribution { outcomes } => {
            validate_labels(outcomes, &format!("process {} outcomes", process.id))?
        }
        ProcessType::Graph => {}
        ProcessType::ObjectPose {
            position_dimensions,
            orientation_dimensions,
        } => {
            if *position_dimensions == 0 || *orientation_dimensions == 0 {
                return Err(error(format!(
                    "process {} has zero pose dimensions",
                    process.id
                )));
            }
        }
    }
    validate_process_value(&process.value_type, &process.initial_value, &process.id)
}

pub(crate) fn validate_process_value(
    value_type: &ProcessType,
    value: &ProcessValue,
    label: &str,
) -> EngineResult<()> {
    match (value_type, value) {
        (ProcessType::Scalar { bounds }, ProcessValue::Scalar(value)) => {
            validate_numeric(*value, bounds, label)
        }
        (ProcessType::Vector { dimensions, bounds }, ProcessValue::Vector(values)) => {
            if values.len() != *dimensions {
                return Err(error(format!("{label} vector has wrong dimension")));
            }
            for value in values {
                validate_numeric(*value, bounds, label)?;
            }
            Ok(())
        }
        (ProcessType::Category { variants }, ProcessValue::Category(value))
        | (ProcessType::Regime { variants }, ProcessValue::Regime(value)) => {
            if variants.contains(value) {
                Ok(())
            } else {
                Err(error(format!("{label} is outside declared support")))
            }
        }
        (ProcessType::Distribution { outcomes }, ProcessValue::Distribution(values)) => {
            if values.len() != outcomes.len() {
                return Err(error(format!("{label} distribution has wrong dimension")));
            }
            let mut total = 0.0;
            for value in values {
                finite(*value, label)?;
                if *value < 0.0 {
                    return Err(error(format!("{label} probabilities must be nonnegative")));
                }
                total += value;
            }
            if (total - 1.0).abs() > 1e-9 {
                return Err(error(format!("{label} probabilities must sum to one")));
            }
            Ok(())
        }
        (ProcessType::Graph, ProcessValue::Graph(graph)) => {
            let nodes: BTreeSet<_> = graph.nodes.iter().collect();
            if nodes.len() != graph.nodes.len()
                || graph.nodes.iter().any(|node| node.trim().is_empty())
                || graph.edges.iter().any(|edge| {
                    edge.relation.trim().is_empty()
                        || !nodes.contains(&edge.source)
                        || !nodes.contains(&edge.target)
                })
            {
                return Err(error(format!("{label} graph is invalid")));
            }
            Ok(())
        }
        (
            ProcessType::ObjectPose {
                position_dimensions,
                orientation_dimensions,
            },
            ProcessValue::ObjectPose(pose),
        ) => {
            if pose.position.len() != *position_dimensions
                || pose.orientation.len() != *orientation_dimensions
            {
                return Err(error(format!("{label} pose has wrong dimension")));
            }
            for value in pose.position.iter().chain(&pose.orientation) {
                finite(*value, label)?;
            }
            Ok(())
        }
        _ => Err(error(format!(
            "{label} does not match declared {} type",
            value_type.name()
        ))),
    }
}

fn validate_numeric(value: f64, bounds: &NumericBounds, label: &str) -> EngineResult<()> {
    finite(value, label)?;
    if value < bounds.minimum || value > bounds.maximum {
        return Err(error(format!("{label} is outside declared bounds")));
    }
    Ok(())
}

fn validate_value_series(
    series: &[ValueSeries],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    let mut ids = BTreeSet::new();
    let mut owners = BTreeSet::new();
    let mut total = 0usize;
    for item in series {
        if !owners.insert((item.process_id.as_str(), item.holder.as_str())) {
            return Err(error(format!(
                "two value series hold {} for {}; one series per process and holder",
                item.process_id, item.holder
            )));
        }
        if item.id.trim().is_empty() || item.id.len() > MAX_MODEL_IDENTIFIER_BYTES {
            return Err(error("value series id must be nonempty and short"));
        }
        if !ids.insert(item.id.as_str()) {
            return Err(error(format!("duplicate value series id {}", item.id)));
        }
        if item.holder.trim().is_empty() || item.holder.len() > MAX_MODEL_IDENTIFIER_BYTES {
            return Err(error(format!(
                "value series {} needs a holder of at most {MAX_MODEL_IDENTIFIER_BYTES} bytes",
                item.id
            )));
        }
        if item
            .provenance
            .iter()
            .any(|entry| entry.trim().is_empty() || entry.len() > MAX_VALUE_TEXT_BYTES)
        {
            return Err(error(format!("value series {} provenance entries must be nonempty and at most {MAX_VALUE_TEXT_BYTES} bytes", item.id)));
        }
        if item
            .reason
            .as_ref()
            .is_some_and(|text| text.len() > MAX_VALUE_TEXT_BYTES)
        {
            return Err(error(format!(
                "value series {} reason is too long",
                item.id
            )));
        }
        let process = processes.get(&item.process_id).ok_or_else(|| {
            error(format!(
                "value series {} names unknown process {}",
                item.id, item.process_id
            ))
        })?;
        let bounds = process.value_type.scalar_bounds();
        let states: Option<&Vec<String>> = match &process.value_type {
            ProcessType::Category { variants } | ProcessType::Regime { variants } => Some(variants),
            _ => None,
        };
        if bounds.is_none() && states.is_none() {
            return Err(error(format!(
                "value series {} needs a scalar, category or regime process; {} is {}",
                item.id,
                item.process_id,
                process.value_type.name()
            )));
        }
        if item.points.is_empty() {
            return Err(error(format!("value series {} has no points", item.id)));
        }
        total += item.points.len();
        if total > MAX_VALUE_POINTS {
            return Err(error(format!(
                "model holds more than {MAX_VALUE_POINTS} values"
            )));
        }
        let mut previous: Option<f64> = None;
        for point in &item.points {
            let at = format!("value series {} at {}", item.id, point.time);
            finite(point.time, &at)?;
            if previous.is_some_and(|time| point.time <= time) {
                return Err(error(format!(
                    "value series {} times must increase; {} repeats or goes back",
                    item.id, point.time
                )));
            }
            previous = Some(point.time);
            if let Some(bounds) = bounds {
                let value = point
                    .value
                    .ok_or_else(|| error(format!("{at}: a scalar process needs a value")))?;
                if point.lower.is_some() != point.upper.is_some() {
                    return Err(error(format!(
                        "{at}: a band needs both lower and upper, or neither"
                    )));
                }
                if point.state.is_some() {
                    return Err(error(format!(
                        "{at}: a scalar process takes a value, not a state"
                    )));
                }
                validate_numeric(value, bounds, &at)?;
                for (name, edge) in [("lower", point.lower), ("upper", point.upper)] {
                    if let Some(edge) = edge {
                        validate_numeric(edge, bounds, &format!("{at} {name}"))?;
                    }
                }
                if point.lower.is_some_and(|lower| lower > value)
                    || point.upper.is_some_and(|upper| upper < value)
                {
                    return Err(error(format!(
                        "{at}: lower and upper must surround the value"
                    )));
                }
            } else if let Some(states) = states {
                let state = point.state.as_ref().ok_or_else(|| {
                    error(format!("{at}: a process with defined states needs a state"))
                })?;
                if point.value.is_some() || point.lower.is_some() || point.upper.is_some() {
                    return Err(error(format!(
                        "{at}: a process with defined states takes a state, not a number"
                    )));
                }
                if !states.contains(state) {
                    return Err(error(format!(
                        "{at}: {state} is not one of the process's states ({})",
                        states.join(", ")
                    )));
                }
            }
            if !VALUE_TAGS.contains(&point.tag.as_str()) {
                return Err(error(format!(
                    "{at}: tag {} is not one of {}",
                    point.tag,
                    VALUE_TAGS.join(", ")
                )));
            }
            if point
                .note
                .as_ref()
                .is_some_and(|text| text.len() > MAX_VALUE_TEXT_BYTES)
            {
                return Err(error(format!("{at}: note is too long")));
            }
        }
    }
    Ok(())
}

pub(super) fn validate_claim(
    claim: &Claim,
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    validate_claim_metadata(
        &claim.id,
        &claim.subject,
        &claim.uncertainty,
        &claim.holder,
        &claim.provenance,
        &claim.authority,
        &claim.access_scopes,
    )?;
    finite(
        claim.evidence_cutoff,
        &format!("claim {} evidence_cutoff", claim.id),
    )?;
    if let Some(value_time) = claim.value_time {
        finite(value_time, &format!("claim {} value_time", claim.id))?;
        if value_time > claim.evidence_cutoff {
            return Err(error(format!(
                "claim {} value_time cannot be after its evidence cutoff",
                claim.id
            )));
        }
    }
    if claim.mode == Some(ClaimMode::Observed)
        && (claim.value_time.is_none()
            || !matches!(
                claim.evidence_type,
                EvidenceType::Observation | EvidenceType::Report
            ))
    {
        return Err(error(format!(
            "observed claim {} requires value_time and observation or report evidence",
            claim.id
        )));
    }
    let process = processes
        .get(&claim.subject)
        .ok_or_else(|| error(format!("claim {} has unknown subject", claim.id)))?;
    validate_process_value(&process.value_type, &claim.value, &claim.id)
}

fn validate_claim_template(
    claim: &ClaimTemplate,
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    validate_claim_metadata(
        &claim.id,
        &claim.subject,
        &claim.uncertainty,
        &claim.holder,
        &claim.provenance,
        &claim.authority,
        &claim.access_scopes,
    )?;
    require_scalar_process(processes, &claim.subject, &claim.id)
}

fn validate_claim_metadata(
    id: &str,
    subject: &str,
    uncertainty: &ClaimUncertainty,
    holder: &str,
    provenance: &[String],
    authority: &ClaimAuthority,
    access_scopes: &[String],
) -> EngineResult<()> {
    if id.trim().is_empty()
        || subject.trim().is_empty()
        || holder.trim().is_empty()
        || provenance.is_empty()
        || provenance.iter().any(|v| v.trim().is_empty())
        || authority.source.trim().is_empty()
        || access_scopes.len() > MAX_QUERY_ACCESS_SCOPES
        || access_scopes
            .iter()
            .any(|scope| scope.trim().is_empty() || scope.len() > MAX_QUERY_STRING_BYTES)
    {
        return Err(error("claim metadata contains an empty required field"));
    }
    finite(authority.weight, &format!("claim {id} authority"))?;
    if !(0.0..=1.0).contains(&authority.weight) {
        return Err(error(format!("claim {id} authority must be in [0,1]")));
    }
    validate_uncertainty(uncertainty, &format!("claim {id} uncertainty"))
}

pub(super) fn validate_uncertainty(
    uncertainty: &ClaimUncertainty,
    label: &str,
) -> EngineResult<()> {
    match uncertainty {
        ClaimUncertainty::Exact | ClaimUncertainty::Unknown => Ok(()),
        ClaimUncertainty::StandardDeviation { value } => {
            finite(*value, label)?;
            if *value < 0.0 {
                Err(error(format!("{label} is negative")))
            } else {
                Ok(())
            }
        }
        ClaimUncertainty::Interval { lower, upper } => {
            finite(*lower, &format!("{label} lower"))?;
            finite(*upper, &format!("{label} upper"))?;
            if upper < lower {
                Err(error(format!("{label} interval is reversed")))
            } else {
                Ok(())
            }
        }
    }
}

fn validate_decomposition(
    edges: &[DecompositionEdge],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    let mut ids = BTreeSet::new();
    for edge in edges {
        if edge.id.trim().is_empty() || !ids.insert(edge.id.as_str()) {
            return Err(error("decomposition edge ids must be unique and nonempty"));
        }
        if edge.parent == edge.child
            || !processes.contains_key(&edge.parent)
            || !processes.contains_key(&edge.child)
        {
            return Err(error(format!("decomposition edge {} is invalid", edge.id)));
        }
    }
    crate::ensure_acyclic(
        processes.keys().map(String::as_str),
        edges
            .iter()
            .map(|edge| (edge.parent.as_str(), edge.child.as_str())),
        "decomposition graph",
    )
}

fn validate_dependencies(
    edges: &[DependencyEdge],
    laws: &[LawDefinition],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<()> {
    let law_by_id: BTreeMap<_, _> = laws.iter().map(|law| (law.id.as_str(), law)).collect();
    let law_shapes: BTreeMap<_, _> = laws
        .iter()
        .map(|law| (law.id.as_str(), law_dependency_shape(law, &law_by_id)))
        .collect();
    let mut ids = BTreeSet::new();
    for edge in edges {
        if edge.id.trim().is_empty()
            || !ids.insert(edge.id.as_str())
            || !processes.contains_key(&edge.source)
            || !processes.contains_key(&edge.target)
        {
            return Err(error(format!("dependency edge {} is invalid", edge.id)));
        }
        let Some(law_id) = &edge.law_id else {
            continue;
        };
        let law = law_by_id.get(law_id.as_str()).ok_or_else(|| {
            error(format!(
                "dependency edge {} names unknown law {law_id}",
                edge.id
            ))
        })?;
        let compatible = match edge.kind {
            DependencyKind::Derives => matches!(
                law.operator,
                LawOperator::Relation { .. } | LawOperator::Resolution { .. }
            ),
            DependencyKind::Causes => matches!(
                law.operator,
                LawOperator::Evolution { .. } | LawOperator::Occurrence { .. }
            ),
            DependencyKind::Constrains => matches!(
                law.operator,
                LawOperator::Relation { .. }
                    | LawOperator::Occurrence { .. }
                    | LawOperator::Resolution { .. }
            ),
            DependencyKind::Observes => matches!(law.operator, LawOperator::Epistemic { .. }),
        };
        if !compatible {
            return Err(error(format!(
                "dependency edge {} kind is incompatible with law {law_id}",
                edge.id
            )));
        }
        let (sources, targets) = law_shapes
            .get(law_id.as_str())
            .expect("dependency law shape was precomputed");
        if !targets.contains(&edge.target) {
            return Err(error(format!(
                "dependency edge {} target {} is not a target or subject of law {law_id}",
                edge.id, edge.target
            )));
        }
        if !sources.contains(&edge.source) {
            return Err(error(format!(
                "dependency edge {} source {} is not read by law {law_id}",
                edge.id, edge.source
            )));
        }
    }
    Ok(())
}

fn law_dependency_shape(
    law: &LawDefinition,
    laws: &BTreeMap<&str, &LawDefinition>,
) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut sources = BTreeSet::new();
    let mut targets = BTreeSet::new();
    match &law.operator {
        LawOperator::Evolution {
            target,
            derivative,
            innovation,
        } => {
            targets.insert(target.clone());
            expression_references(derivative, &mut sources);
            if let Some(innovation) = innovation {
                expression_references(&innovation.scale, &mut sources);
            }
        }
        LawOperator::Relation { target, value } | LawOperator::Resolution { target, value, .. } => {
            targets.insert(target.clone());
            expression_references(value, &mut sources);
        }
        LawOperator::Occurrence {
            trigger,
            effects,
            activates,
        } => {
            match trigger {
                OccurrenceTrigger::Always => {}
                OccurrenceTrigger::Threshold { expression, .. } => {
                    expression_references(expression, &mut sources)
                }
                OccurrenceTrigger::Hazard { rate } => expression_references(rate, &mut sources),
            }
            for effect in effects {
                targets.insert(effect.target.clone());
                expression_references(&effect.value, &mut sources);
            }
            // A marked occurrence may cause or constrain the target of a law it
            // gates, even when it has no direct state effect of its own.
            for activated in activates {
                if let Some(activated_law) = laws.get(activated.as_str()) {
                    targets.extend(law_direct_targets(activated_law));
                }
            }
        }
        LawOperator::Epistemic { claim, value } => {
            targets.insert(claim.subject.clone());
            expression_references(value, &mut sources);
        }
    }
    (sources, targets)
}

pub(super) fn law_direct_targets(law: &LawDefinition) -> BTreeSet<String> {
    match &law.operator {
        LawOperator::Evolution { target, .. }
        | LawOperator::Relation { target, .. }
        | LawOperator::Resolution { target, .. } => BTreeSet::from([target.clone()]),
        LawOperator::Occurrence { effects, .. } => {
            effects.iter().map(|effect| effect.target.clone()).collect()
        }
        LawOperator::Epistemic { claim, .. } => BTreeSet::from([claim.subject.clone()]),
    }
}

/// The first enabled law that writes a process's state, if any. An epistemic law writes a claim, not the state.
pub(super) fn process_state_writer<'a>(model: &'a CompiledModel, target: &str) -> Option<&'a str> {
    model.laws.iter().find_map(|law| {
        if !law.enabled {
            return None;
        }
        let writes = match &law.operator {
            LawOperator::Evolution {
                target: law_target, ..
            }
            | LawOperator::Relation {
                target: law_target, ..
            }
            | LawOperator::Resolution {
                target: law_target, ..
            } => law_target == target,
            LawOperator::Occurrence { effects, .. } => {
                effects.iter().any(|effect| effect.target == target)
            }
            LawOperator::Epistemic { .. } => false,
        };
        writes.then_some(law.id.as_str())
    })
}

fn require_scalar_process(
    processes: &BTreeMap<String, ProcessDefinition>,
    process_id: &str,
    law_id: &str,
) -> EngineResult<()> {
    let process = processes.get(process_id).ok_or_else(|| {
        error(format!(
            "law {law_id} references unknown process {process_id}"
        ))
    })?;
    if matches!(process.value_type, ProcessType::Scalar { .. }) {
        Ok(())
    } else {
        Err(error(format!(
            "law {law_id} requires scalar process {process_id}; non-scalar execution is not implemented"
        )))
    }
}

fn validate_expression(
    expression: &ScalarExpression,
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    expression_metrics(expression)?;
    validate_expression_structure(expression, processes, law_id)
}

fn validate_expression_structure(
    expression: &ScalarExpression,
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    match expression {
        ScalarExpression::Constant { value } => finite(*value, &format!("law {law_id} constant")),
        ScalarExpression::Process { process } => require_scalar_process(processes, process, law_id),
        ScalarExpression::Time => Ok(()),
        ScalarExpression::Add { terms } => {
            validate_expression_list_structure(terms, processes, law_id)
        }
        ScalarExpression::Multiply { factors } => {
            validate_expression_list_structure(factors, processes, law_id)
        }
        ScalarExpression::Subtract { left, right } => {
            validate_expression_structure(left, processes, law_id)?;
            validate_expression_structure(right, processes, law_id)
        }
        ScalarExpression::Divide {
            numerator,
            denominator,
        } => {
            validate_expression_structure(numerator, processes, law_id)?;
            validate_expression_structure(denominator, processes, law_id)
        }
        ScalarExpression::Negate { value }
        | ScalarExpression::Absolute { value }
        | ScalarExpression::Exponential { value }
        | ScalarExpression::Logistic { value } => {
            validate_expression_structure(value, processes, law_id)
        }
        ScalarExpression::Minimum { values } | ScalarExpression::Maximum { values } => {
            validate_expression_list_structure(values, processes, law_id)
        }
        ScalarExpression::Clamp {
            value,
            minimum,
            maximum,
        } => {
            finite(*minimum, &format!("law {law_id} clamp minimum"))?;
            finite(*maximum, &format!("law {law_id} clamp maximum"))?;
            if maximum < minimum {
                return Err(error(format!("law {law_id} clamp is reversed")));
            }
            validate_expression_structure(value, processes, law_id)
        }
    }
}

fn validate_expression_list_structure(
    values: &[ScalarExpression],
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    if values.is_empty() {
        return Err(error(format!("law {law_id} expression list is empty")));
    }
    for value in values {
        validate_expression_structure(value, processes, law_id)?;
    }
    Ok(())
}

pub(super) fn expression_metrics(expression: &ScalarExpression) -> EngineResult<(usize, usize)> {
    let mut nodes = 0usize;
    let mut maximum_depth = 0usize;
    let mut pending = vec![(expression, 1usize)];
    while let Some((current, depth)) = pending.pop() {
        if depth > MAX_EXPRESSION_DEPTH {
            return Err(error(format!(
                "expression depth {depth} exceeds limit {MAX_EXPRESSION_DEPTH}"
            )));
        }
        nodes = nodes
            .checked_add(1)
            .ok_or_else(|| error("expression node count overflow"))?;
        maximum_depth = maximum_depth.max(depth);
        let child_depth = depth
            .checked_add(1)
            .ok_or_else(|| error("expression depth overflow"))?;
        match current {
            ScalarExpression::Constant { .. }
            | ScalarExpression::Process { .. }
            | ScalarExpression::Time => {}
            ScalarExpression::Add { terms } => {
                pending.extend(terms.iter().map(|child| (child, child_depth)));
            }
            ScalarExpression::Multiply { factors } => {
                pending.extend(factors.iter().map(|child| (child, child_depth)));
            }
            ScalarExpression::Subtract { left, right } => {
                pending.push((left, child_depth));
                pending.push((right, child_depth));
            }
            ScalarExpression::Divide {
                numerator,
                denominator,
            } => {
                pending.push((numerator, child_depth));
                pending.push((denominator, child_depth));
            }
            ScalarExpression::Negate { value }
            | ScalarExpression::Clamp { value, .. }
            | ScalarExpression::Absolute { value }
            | ScalarExpression::Exponential { value }
            | ScalarExpression::Logistic { value } => pending.push((value, child_depth)),
            ScalarExpression::Minimum { values } | ScalarExpression::Maximum { values } => {
                pending.extend(values.iter().map(|child| (child, child_depth)));
            }
        }
    }
    Ok((nodes, maximum_depth))
}

fn model_expression_node_count(laws: &[LawDefinition]) -> EngineResult<usize> {
    let mut total = 0usize;
    let mut add = |expression: &ScalarExpression| -> EngineResult<()> {
        let (nodes, _) = expression_metrics(expression)?;
        total = total
            .checked_add(nodes)
            .ok_or_else(|| error("model expression node count overflow"))?;
        if total > MAX_MODEL_EXPRESSION_NODES {
            return Err(error(format!(
                "model expression nodes {total} exceed limit {MAX_MODEL_EXPRESSION_NODES}"
            )));
        }
        Ok(())
    };
    for law in laws {
        match &law.operator {
            LawOperator::Evolution {
                derivative,
                innovation,
                ..
            } => {
                add(derivative)?;
                if let Some(innovation) = innovation {
                    add(&innovation.scale)?;
                }
            }
            LawOperator::Relation { value, .. }
            | LawOperator::Epistemic { value, .. }
            | LawOperator::Resolution { value, .. } => add(value)?,
            LawOperator::Occurrence {
                trigger, effects, ..
            } => {
                match trigger {
                    OccurrenceTrigger::Always => {}
                    OccurrenceTrigger::Threshold { expression, .. } => add(expression)?,
                    OccurrenceTrigger::Hazard { rate } => add(rate)?,
                }
                for effect in effects {
                    add(&effect.value)?;
                }
            }
        }
    }
    Ok(total)
}

pub(super) fn validate_effect(
    effect: &StateEffect,
    processes: &BTreeMap<String, ProcessDefinition>,
    law_id: &str,
) -> EngineResult<()> {
    require_scalar_process(processes, &effect.target, law_id)?;
    validate_expression(&effect.value, processes, law_id)
}

fn validate_laws(
    laws: &[LawDefinition],
    processes: &BTreeMap<String, ProcessDefinition>,
) -> EngineResult<Vec<usize>> {
    let mut law_ids = BTreeMap::new();
    for (index, law) in laws.iter().enumerate() {
        if law.id.trim().is_empty()
            || law.id.len() > MAX_MODEL_IDENTIFIER_BYTES
            || law_ids.insert(law.id.as_str(), index).is_some()
        {
            return Err(error("law ids must be unique, nonempty, and bounded"));
        }
        if law.provenance.is_empty() || law.provenance.iter().any(|item| item.trim().is_empty()) {
            return Err(error(format!(
                "law {} requires nonempty provenance",
                law.id
            )));
        }
    }
    let mut derived_targets = BTreeMap::new();
    let mut evolved_targets = BTreeSet::new();
    let mut claim_ids = BTreeSet::new();
    let mut activated = BTreeSet::new();
    for (index, law) in laws.iter().enumerate() {
        match &law.operator {
            LawOperator::Evolution {
                target,
                derivative,
                innovation,
            } => {
                require_scalar_process(processes, target, &law.id)?;
                validate_expression(derivative, processes, &law.id)?;
                if let Some(innovation) = innovation {
                    if innovation.name.trim().is_empty()
                        || innovation.name.len() > MAX_MODEL_IDENTIFIER_BYTES
                    {
                        return Err(error(format!(
                            "law {} innovation name must be nonempty and bounded",
                            law.id
                        )));
                    }
                    validate_expression(&innovation.scale, processes, &law.id)?;
                }
                evolved_targets.insert(target.as_str());
            }
            LawOperator::Relation { target, value }
            | LawOperator::Resolution { target, value, .. } => {
                require_scalar_process(processes, target, &law.id)?;
                validate_expression(value, processes, &law.id)?;
                if derived_targets.insert(target.as_str(), index).is_some() {
                    return Err(error(format!(
                        "multiple relation/resolution laws target {target}"
                    )));
                }
            }
            LawOperator::Occurrence {
                trigger,
                effects,
                activates,
            } => {
                if law.activation == LawActivation::Gated {
                    return Err(error(format!("occurrence law {} cannot be gated", law.id)));
                }
                match trigger {
                    OccurrenceTrigger::Always => {}
                    OccurrenceTrigger::Threshold {
                        expression,
                        threshold,
                        ..
                    } => {
                        finite(*threshold, &format!("law {} threshold", law.id))?;
                        validate_expression(expression, processes, &law.id)?;
                    }
                    OccurrenceTrigger::Hazard { rate } => {
                        validate_expression(rate, processes, &law.id)?
                    }
                }
                for effect in effects {
                    validate_effect(effect, processes, &law.id)?;
                }
                for target_law in activates {
                    if target_law == &law.id || !law_ids.contains_key(target_law.as_str()) {
                        return Err(error(format!(
                            "law {} activates invalid law {target_law}",
                            law.id
                        )));
                    }
                    activated.insert(target_law.as_str());
                }
            }
            LawOperator::Epistemic { claim, value } => {
                validate_claim_template(claim, processes)?;
                validate_expression(value, processes, &law.id)?;
                if !claim_ids.insert(claim.id.as_str()) {
                    return Err(error(format!(
                        "multiple epistemic laws emit claim {}",
                        claim.id
                    )));
                }
            }
        }
    }
    for law in laws {
        if law.enabled
            && law.activation == LawActivation::Gated
            && !activated.contains(law.id.as_str())
        {
            return Err(error(format!(
                "gated law {} has no occurrence gate",
                law.id
            )));
        }
    }
    for target in evolved_targets {
        if derived_targets.contains_key(target) {
            return Err(error(format!(
                "process {target} cannot be both evolved and exactly derived"
            )));
        }
    }
    derived_topological_order(laws, &derived_targets)
}

pub(super) fn expression_references(expression: &ScalarExpression, output: &mut BTreeSet<String>) {
    match expression {
        ScalarExpression::Process { process } => {
            output.insert(process.clone());
        }
        ScalarExpression::Add { terms } => {
            for value in terms {
                expression_references(value, output);
            }
        }
        ScalarExpression::Multiply { factors } => {
            for value in factors {
                expression_references(value, output);
            }
        }
        ScalarExpression::Subtract { left, right } => {
            expression_references(left, output);
            expression_references(right, output);
        }
        ScalarExpression::Divide {
            numerator,
            denominator,
        } => {
            expression_references(numerator, output);
            expression_references(denominator, output);
        }
        ScalarExpression::Negate { value }
        | ScalarExpression::Absolute { value }
        | ScalarExpression::Exponential { value }
        | ScalarExpression::Logistic { value }
        | ScalarExpression::Clamp { value, .. } => expression_references(value, output),
        ScalarExpression::Minimum { values } | ScalarExpression::Maximum { values } => {
            for value in values {
                expression_references(value, output);
            }
        }
        ScalarExpression::Constant { .. } | ScalarExpression::Time => {}
    }
}

// Kahn's algorithm with the lowest ready index first. The order is part of the
// compiled model (relations and resolutions are evaluated in it), so it stays
// here rather than taking a library sort whose tie-breaking could differ.
fn derived_topological_order(
    laws: &[LawDefinition],
    targets: &BTreeMap<&str, usize>,
) -> EngineResult<Vec<usize>> {
    let mut outgoing: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    let mut indegree: BTreeMap<usize, usize> = targets.values().map(|index| (*index, 0)).collect();
    for target_index in targets.values() {
        let expression = match &laws[*target_index].operator {
            LawOperator::Relation { value, .. } | LawOperator::Resolution { value, .. } => value,
            LawOperator::Evolution { .. }
            | LawOperator::Occurrence { .. }
            | LawOperator::Epistemic { .. } => unreachable!(),
        };
        let mut references = BTreeSet::new();
        expression_references(expression, &mut references);
        for reference in references {
            if let Some(source_index) = targets.get(reference.as_str()) {
                if source_index == target_index {
                    return Err(error(format!(
                        "derived law {} depends on itself",
                        laws[*target_index].id
                    )));
                }
                if outgoing
                    .entry(*source_index)
                    .or_default()
                    .insert(*target_index)
                {
                    *indegree.get_mut(target_index).unwrap() += 1;
                }
            }
        }
    }
    let mut ready: VecDeque<_> = indegree
        .iter()
        .filter_map(|(index, degree)| (*degree == 0).then_some(*index))
        .collect();
    let mut order = Vec::new();
    while let Some(index) = ready.pop_front() {
        order.push(index);
        if let Some(dependents) = outgoing.get(&index) {
            for dependent in dependents {
                let degree = indegree.get_mut(dependent).unwrap();
                *degree -= 1;
                if *degree == 0 {
                    ready.push_back(*dependent);
                }
            }
        }
    }
    if order.len() != indegree.len() {
        return Err(error(
            "relation/resolution dependency graph must be acyclic",
        ));
    }
    Ok(order)
}
