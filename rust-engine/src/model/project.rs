//! Project checkpoints: immutable, content-addressed documents with the frozen model, world and narrative graph they
//! were written against, and the checks that an imported checkpoint's frozen material is consistent.
//!
//! A checkpoint's hash covers its document and every frozen snapshot (by their hashes), so it names exactly one
//! checkpoint. Frozen material is trusted only once it agrees with itself: the graph's source with the frozen world or
//! candidate, a frozen candidate with a replay from its frozen parent, and every anchor of the graph (narrative.rs).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::limits::MAX_SESSION_REPLAY_WORK;
use crate::model::candidate::{
    validate_candidate_with_frozen_parent, validate_project_candidate_replay, ModelCandidate,
};
use crate::model::compile::CompiledModel;
use crate::model::definition::ModelDefinition;
use crate::model::narrative::{
    compile_narrative_graph, validate_narrative_anchor_references, NarrativeGraphSource,
    NarrativeSourceSnapshot, StoredNarrativeGraph,
};
use crate::model::transition::candidate_replay_work;
use crate::model::world::{build_world_head, validate_world, WorldHead};
use crate::{error, hash_serializable, EngineResult};

const PROJECT_GRAPH_SNAPSHOT_IDENTITY_SCHEMA: &str =
    "life-sim-rust-project-graph-snapshot-identity/v1";

pub(crate) fn is_project_checkpoint_hash_shaped_name(name: &str) -> bool {
    name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Serialize)]
struct ProjectGraphSnapshotIdentity<'a> {
    schema: &'static str,
    graph_hash: &'a str,
    source_snapshot_hash: &'a str,
}

pub(crate) fn project_graph_snapshot_hash(graph: &StoredNarrativeGraph) -> EngineResult<String> {
    hash_serializable(&ProjectGraphSnapshotIdentity {
        schema: PROJECT_GRAPH_SNAPSHOT_IDENTITY_SCHEMA,
        graph_hash: &graph.graph_hash,
        source_snapshot_hash: &graph.snapshot_hash,
    })
}

fn project_candidate_anchors(
    snapshot: &NarrativeSourceSnapshot,
) -> EngineResult<BTreeMap<String, ModelCandidate>> {
    snapshot
        .candidate_anchors
        .iter()
        .map(|(key, value)| {
            let candidate: ModelCandidate =
                serde_json::from_value(value.clone()).map_err(|cause| {
                    error(format!(
                        "project narrative candidate anchor {key} is invalid: {cause}"
                    ))
                })?;
            if candidate.candidate_hash != *key {
                return Err(error(format!(
                    "project narrative candidate anchor key {key} does not match its candidate hash"
                )));
            }
            Ok((key.clone(), candidate))
        })
        .collect()
}

fn candidate_successor_world(
    model: &CompiledModel,
    candidate: &ModelCandidate,
) -> EngineResult<WorldHead> {
    build_world_head(
        model,
        candidate.world_id.clone(),
        candidate
            .expected_parent_version
            .checked_add(1)
            .ok_or_else(|| error("project narrative candidate version overflow"))?,
        candidate.end_time,
        candidate.successor_state.clone(),
        candidate.successor_claims.clone(),
        Some(candidate.candidate_hash.clone()),
    )
}

fn validate_project_world_candidate_chain(
    model: &CompiledModel,
    supplied_world: Option<&WorldHead>,
    world_id: &str,
    world_hash: &str,
    snapshot: &NarrativeSourceSnapshot,
    anchors: &BTreeMap<String, ModelCandidate>,
) -> EngineResult<BTreeSet<String>> {
    let source_world = if let Some(world) = supplied_world {
        validate_world(model, world)?;
        world.clone()
    } else if anchors.is_empty() {
        model.genesis_world(world_id.to_owned())?
    } else {
        let matching: Vec<WorldHead> = anchors
            .values()
            .map(|candidate| candidate_successor_world(model, candidate))
            .collect::<EngineResult<Vec<_>>>()?
            .into_iter()
            .filter(|candidate_world| candidate_world.world_hash == world_hash)
            .collect();
        if matching.len() != 1 {
            return Err(error(
                "project narrative world snapshot does not identify exactly one candidate-chain head",
            ));
        }
        matching
            .into_iter()
            .next()
            .expect("one source world exists")
    };
    if source_world.world_id != world_id
        || source_world.world_hash != world_hash
        || source_world.model_hash != snapshot.model_hash
        || snapshot.world_version != Some(source_world.version)
        || snapshot.time != Some(source_world.time)
        || snapshot.state != source_world.state
        || snapshot.claims != source_world.claims
    {
        return Err(error(
            "project narrative graph world identity or state does not match its source snapshot",
        ));
    }
    let expected_occurrences = source_world
        .lineage_head
        .as_ref()
        .map(|candidate_hash| {
            anchors
                .get(candidate_hash)
                .map(|candidate| candidate.marks.clone())
                .ok_or_else(|| {
                    error(format!(
                        "project narrative world lineage lacks candidate anchor {candidate_hash}"
                    ))
                })
        })
        .transpose()?
        .unwrap_or_default();

    let mut used = BTreeSet::new();
    let mut replay_work = 0usize;
    let mut current = source_world;
    while let Some(candidate_hash) = current.lineage_head.clone() {
        if !used.insert(candidate_hash.clone()) {
            return Err(error(
                "project narrative candidate lineage contains a cycle",
            ));
        }
        let candidate = anchors.get(&candidate_hash).ok_or_else(|| {
            error(format!(
                "project narrative world lineage lacks candidate anchor {candidate_hash}"
            ))
        })?;
        if candidate_successor_world(model, candidate)? != current {
            return Err(error(format!(
                "project narrative candidate anchor {candidate_hash} does not reconstruct its successor world"
            )));
        }
        let parent = if candidate.expected_parent_version == 0 {
            model.genesis_world(candidate.world_id.clone())?
        } else {
            let matching: Vec<WorldHead> = anchors
                .values()
                .filter(|possible_parent| {
                    possible_parent.candidate_hash != candidate.candidate_hash
                })
                .map(|possible_parent| candidate_successor_world(model, possible_parent))
                .collect::<EngineResult<Vec<_>>>()?
                .into_iter()
                .filter(|possible_parent| possible_parent.world_hash == candidate.parent_world_hash)
                .collect();
            if matching.len() != 1 {
                return Err(error(format!(
                    "project narrative candidate anchor {candidate_hash} does not identify exactly one parent"
                )));
            }
            matching
                .into_iter()
                .next()
                .expect("one parent world exists")
        };
        validate_candidate_with_frozen_parent(model, &parent, candidate)?;
        replay_work = replay_work
            .checked_add(candidate_replay_work(model, &parent, &candidate.query)?)
            .ok_or_else(|| error("project narrative candidate replay-work estimate overflow"))?;
        if replay_work > MAX_SESSION_REPLAY_WORK {
            return Err(error(format!(
                "project narrative candidate replay work exceeds {MAX_SESSION_REPLAY_WORK}"
            )));
        }
        validate_project_candidate_replay(model, &parent, candidate)?;
        current = parent;
    }
    if current.version != 0 || current != model.genesis_world(world_id.to_owned())? {
        return Err(error(
            "project narrative candidate anchors do not terminate at the canonical genesis world",
        ));
    }
    if used.len() != anchors.len() {
        return Err(error(
            "project narrative source snapshot contains candidate anchors outside its exact world lineage",
        ));
    }
    if snapshot.occurrences != expected_occurrences {
        return Err(error(
            "project narrative world occurrences do not match its lineage head candidate",
        ));
    }
    Ok(used)
}

pub(crate) fn validate_project_graph_source_binding(
    model: &CompiledModel,
    world: Option<&WorldHead>,
    graph: &StoredNarrativeGraph,
) -> EngineResult<BTreeSet<String>> {
    let snapshot = &graph.snapshot;
    if snapshot.model_hash != model.model_hash || snapshot.model_revision != model.revision.number {
        return Err(error(
            "project graph source snapshot does not match its frozen model",
        ));
    }
    let anchors = project_candidate_anchors(snapshot)?;
    let bound_candidate_ids = match &graph.definition.source {
        NarrativeGraphSource::Model { model_hash }
            if model_hash == &snapshot.model_hash
                && snapshot.source_kind == "model"
                && snapshot.source_hash == snapshot.model_hash
                && snapshot.world_id.is_none()
                && snapshot.world_version.is_none()
                && snapshot.time.is_none()
                && snapshot.candidate_status.is_none()
                && snapshot.state
                    == model
                        .processes
                        .values()
                        .map(|process| (process.id.clone(), process.initial_value.clone()))
                        .collect()
                && snapshot.claims == model.initial_claims
                && snapshot.occurrences.is_empty()
                && anchors.is_empty() =>
        {
            BTreeSet::new()
        }
        NarrativeGraphSource::World {
            world_id,
            world_hash,
        } if snapshot.source_kind == "world"
            && snapshot.source_hash == *world_hash
            && snapshot.world_id.as_deref() == Some(world_id.as_str())
            && snapshot.world_version.is_some()
            && snapshot.time.is_some()
            && snapshot.candidate_status.as_deref() == Some("committed") =>
        {
            validate_project_world_candidate_chain(
                model, world, world_id, world_hash, snapshot, &anchors,
            )?
        }
        NarrativeGraphSource::Candidate { candidate_hash }
            if snapshot.source_kind == "candidate"
                && snapshot.source_hash == *candidate_hash
                && matches!(
                    snapshot.candidate_status.as_deref(),
                    Some("pending" | "committed" | "rejected" | "superseded")
                ) =>
        {
            let candidate = anchors.get(candidate_hash).ok_or_else(|| {
                error("project narrative candidate source lacks its exact candidate anchor")
            })?;
            let successor = candidate_successor_world(model, candidate)?;
            if snapshot.world_id.as_deref() != Some(candidate.world_id.as_str())
                || snapshot.world_version != candidate.expected_parent_version.checked_add(1)
                || snapshot.time != Some(candidate.end_time)
                || snapshot.state != candidate.successor_state
                || snapshot.claims != candidate.successor_claims
                || snapshot.occurrences != candidate.marks
            {
                return Err(error(
                    "project narrative candidate source does not match its frozen candidate",
                ));
            }
            validate_project_world_candidate_chain(
                model,
                None,
                &candidate.world_id,
                &successor.world_hash,
                snapshot,
                &anchors,
            )?
        }
        _ => {
            return Err(error(
                "project narrative graph source and frozen source snapshot do not match",
            ));
        }
    };
    let compiled = compile_narrative_graph(graph.definition.clone())?;
    validate_narrative_anchor_references(model, &compiled, snapshot, &bound_candidate_ids)?;
    Ok(bound_candidate_ids)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "encoding", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProjectDocumentContent {
    Utf8 { text: String },
    Bytes { bytes: Vec<u8> },
}

impl ProjectDocumentContent {
    pub(crate) fn into_bytes(self) -> Vec<u8> {
        match self {
            Self::Utf8 { text } => text.into_bytes(),
            Self::Bytes { bytes } => bytes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectDocumentDefinition {
    pub schema: String,
    pub media_type: String,
    pub content: ProjectDocumentContent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_external_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectDocument {
    pub(crate) document_hash: String,
    pub(crate) media_type: String,
    pub(crate) content: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProjectCheckpointDefinition {
    pub schema: String,
    pub name: String,
    /// A checkpoint name or immutable checkpoint hash. It is resolved to the
    /// hash before storage so a later name can never redirect ancestry.
    #[serde(default)]
    pub parent_checkpoint: Option<String>,
    pub document: ProjectDocumentDefinition,
    #[serde(default)]
    pub model_hash: Option<String>,
    #[serde(default)]
    pub world_hash: Option<String>,
    #[serde(default)]
    pub narrative_graph_hash: Option<String>,
    /// Identity of the frozen graph definition together with its exact source
    /// snapshot. A graph definition hash alone does not identify the state
    /// against which that definition was authored.
    #[serde(default)]
    pub narrative_graph_snapshot_hash: Option<String>,
    /// Optional frozen material for importing a checkpoint from another
    /// active session. Hash fields above remain the immutable identities.
    #[serde(default)]
    pub model_snapshot: Option<ModelDefinition>,
    /// Lossless JSON transport for model snapshots. Model definitions include
    /// untyped realization parameters as well as signed floating-point and
    /// `u64` fields. Keeping the nested JSON text opaque across a JavaScript
    /// client preserves lexical values such as `9.0` and `-0.0` and integers
    /// above `2^53`; portable exports use this form instead of
    /// `model_snapshot`.
    #[serde(default)]
    pub model_snapshot_json: Option<String>,
    #[serde(default)]
    pub world_snapshot: Option<WorldHead>,
    /// Lossless JSON transport for world snapshots. This protects signed
    /// floating-point values and `u64` revision/version fields from numeric
    /// normalization by intermediary JSON clients. Portable exports use this
    /// form instead of `world_snapshot`.
    #[serde(default)]
    pub world_snapshot_json: Option<String>,
    #[serde(default)]
    pub narrative_graph_snapshot: Option<StoredNarrativeGraph>,
    /// Lossless JSON transport for graph snapshots whose untyped candidate
    /// anchors preserve numeric distinctions such as `9.0` versus `9` and may
    /// contain integers above JavaScript's safe range. Portable exports use
    /// this form so an intermediary JSON client cannot normalize a nested
    /// number and invalidate the frozen source-snapshot hash.
    #[serde(default)]
    pub narrative_graph_snapshot_json: Option<String>,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProjectCheckpointCore {
    pub(crate) schema: String,
    pub(crate) name: String,
    pub(crate) parent_checkpoint_hash: Option<String>,
    pub(crate) document_hash: String,
    pub(crate) canonical_external_path: Option<String>,
    pub(crate) model_hash: Option<String>,
    pub(crate) world_hash: Option<String>,
    pub(crate) narrative_graph_hash: Option<String>,
    pub(crate) narrative_graph_snapshot_hash: Option<String>,
    pub(crate) reason: String,
    pub(crate) provenance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProjectCheckpoint {
    pub(crate) checkpoint_hash: String,
    pub(crate) checkpoint_sequence: u64,
    #[serde(flatten)]
    pub(crate) core: ProjectCheckpointCore,
}
