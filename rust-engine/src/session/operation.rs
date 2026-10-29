//! The machine operations: every command the machine session handles itself, the group whose handler runs it, and
//! whether it changes the session. The legacy registry commands (`describe`, `compile_registry`, `roll`) are handled by
//! registry.rs and are not machine operations.
//!
//! Whether an operation mutates decides two things in a durable session: its changes are written to SQLite before it is
//! acknowledged, and it is refused while earlier changes are unwritten. Each group's `mutates` is an exhaustive match,
//! so a new operation cannot compile without saying which it is. `ALL` lists every operation once, in the order
//! `describe` reports them, and parsing an operation's name is the inverse of naming it.

use serde::{Deserialize, Deserializer};

/// A machine operation, by the group whose handler runs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum MachineOperation {
    Model(ModelOperation),
    World(WorldOperation),
    Candidate(CandidateOperation),
    Query(QueryOperation),
    Narrative(NarrativeOperation),
    Checkpoint(CheckpointOperation),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ModelOperation {
    CompileProfiles,
    ValidateModel,
    RegisterModel,
    ReviseModel,
    GetModel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WorldOperation {
    CreateWorld,
    GetWorld,
    RefineGenesisWorld,
    ReviseWorld,
    GetWorldRevision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CandidateOperation {
    RollWorld,
    InspectCandidate,
    SummarizeTrajectory,
    RerollCandidate,
    RejectCandidate,
    CommitCandidate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum QueryOperation {
    QueryGraph,
    QueryView,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NarrativeOperation {
    RegisterNarrativeGraph,
    ReviseNarrativeGraph,
    ReviseNarrativeGraphByChange,
    ApplyNarrativeBatch,
    ListNarrativeRevisions,
    QueryNarrativeGraph,
    RenderNarrativeGraph,
    ExportNarrativeTraining,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CheckpointOperation {
    RegisterProjectCheckpoint,
    ListProjectCheckpoints,
    GetProjectCheckpoint,
    ExportProjectCheckpoint,
    RenderProjectCheckpoint,
    QueryProjectCheckpointGraph,
}

impl MachineOperation {
    /// Every machine operation, in the order `describe` lists them.
    pub(super) const ALL: [Self; 32] = [
        Self::Model(ModelOperation::CompileProfiles),
        Self::Model(ModelOperation::ValidateModel),
        Self::Model(ModelOperation::RegisterModel),
        Self::Model(ModelOperation::ReviseModel),
        Self::Model(ModelOperation::GetModel),
        Self::World(WorldOperation::CreateWorld),
        Self::World(WorldOperation::GetWorld),
        Self::World(WorldOperation::RefineGenesisWorld),
        Self::World(WorldOperation::ReviseWorld),
        Self::World(WorldOperation::GetWorldRevision),
        Self::Candidate(CandidateOperation::RollWorld),
        Self::Candidate(CandidateOperation::InspectCandidate),
        Self::Candidate(CandidateOperation::SummarizeTrajectory),
        Self::Candidate(CandidateOperation::RerollCandidate),
        Self::Candidate(CandidateOperation::RejectCandidate),
        Self::Candidate(CandidateOperation::CommitCandidate),
        Self::Query(QueryOperation::QueryGraph),
        Self::Query(QueryOperation::QueryView),
        Self::Narrative(NarrativeOperation::RegisterNarrativeGraph),
        Self::Narrative(NarrativeOperation::ReviseNarrativeGraph),
        Self::Narrative(NarrativeOperation::ReviseNarrativeGraphByChange),
        Self::Narrative(NarrativeOperation::ApplyNarrativeBatch),
        Self::Narrative(NarrativeOperation::ListNarrativeRevisions),
        Self::Narrative(NarrativeOperation::QueryNarrativeGraph),
        Self::Narrative(NarrativeOperation::RenderNarrativeGraph),
        Self::Narrative(NarrativeOperation::ExportNarrativeTraining),
        Self::Checkpoint(CheckpointOperation::RegisterProjectCheckpoint),
        Self::Checkpoint(CheckpointOperation::ListProjectCheckpoints),
        Self::Checkpoint(CheckpointOperation::GetProjectCheckpoint),
        Self::Checkpoint(CheckpointOperation::ExportProjectCheckpoint),
        Self::Checkpoint(CheckpointOperation::RenderProjectCheckpoint),
        Self::Checkpoint(CheckpointOperation::QueryProjectCheckpointGraph),
    ];

    /// The operation a command names, or `None` when the name is not a machine operation.
    pub(super) fn parse(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|operation| operation.name() == name)
    }

    /// The name a command uses for this operation.
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Model(operation) => operation.name(),
            Self::World(operation) => operation.name(),
            Self::Candidate(operation) => operation.name(),
            Self::Query(operation) => operation.name(),
            Self::Narrative(operation) => operation.name(),
            Self::Checkpoint(operation) => operation.name(),
        }
    }

    /// Whether the operation can change the session, and so is persisted and guarded in a durable one.
    pub(super) fn mutates(self) -> bool {
        match self {
            Self::Model(operation) => operation.mutates(),
            Self::World(operation) => operation.mutates(),
            Self::Candidate(operation) => operation.mutates(),
            Self::Query(operation) => operation.mutates(),
            Self::Narrative(operation) => operation.mutates(),
            Self::Checkpoint(operation) => operation.mutates(),
        }
    }
}

/// A command's `operation` field. The session reads a command only after its name has parsed, so the error here is
/// never seen by a caller.
impl<'de> Deserialize<'de> for MachineOperation {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let name = String::deserialize(deserializer)?;
        Self::parse(&name).ok_or_else(|| {
            serde::de::Error::custom(format!("unsupported machine operation {name}"))
        })
    }
}

impl ModelOperation {
    fn name(self) -> &'static str {
        match self {
            Self::CompileProfiles => "compile_profiles",
            Self::ValidateModel => "validate_model",
            Self::RegisterModel => "register_model",
            Self::ReviseModel => "revise_model",
            Self::GetModel => "get_model",
        }
    }

    fn mutates(self) -> bool {
        match self {
            Self::RegisterModel | Self::ReviseModel => true,
            Self::CompileProfiles | Self::ValidateModel | Self::GetModel => false,
        }
    }
}

impl WorldOperation {
    fn name(self) -> &'static str {
        match self {
            Self::CreateWorld => "create_world",
            Self::GetWorld => "get_world",
            Self::RefineGenesisWorld => "refine_genesis_world",
            Self::ReviseWorld => "revise_world",
            Self::GetWorldRevision => "get_world_revision",
        }
    }

    fn mutates(self) -> bool {
        match self {
            Self::CreateWorld | Self::RefineGenesisWorld | Self::ReviseWorld => true,
            Self::GetWorld | Self::GetWorldRevision => false,
        }
    }
}

impl CandidateOperation {
    fn name(self) -> &'static str {
        match self {
            Self::RollWorld => "roll_world",
            Self::InspectCandidate => "inspect_candidate",
            Self::SummarizeTrajectory => "summarize_trajectory",
            Self::RerollCandidate => "reroll_candidate",
            Self::RejectCandidate => "reject_candidate",
            Self::CommitCandidate => "commit_candidate",
        }
    }

    fn mutates(self) -> bool {
        match self {
            Self::RollWorld
            | Self::RerollCandidate
            | Self::RejectCandidate
            | Self::CommitCandidate => true,
            Self::InspectCandidate | Self::SummarizeTrajectory => false,
        }
    }
}

impl QueryOperation {
    fn name(self) -> &'static str {
        match self {
            Self::QueryGraph => "query_graph",
            Self::QueryView => "query_view",
        }
    }

    fn mutates(self) -> bool {
        match self {
            Self::QueryGraph | Self::QueryView => false,
        }
    }
}

impl NarrativeOperation {
    fn name(self) -> &'static str {
        match self {
            Self::RegisterNarrativeGraph => "register_narrative_graph",
            Self::ReviseNarrativeGraph => "revise_narrative_graph",
            Self::ReviseNarrativeGraphByChange => "revise_narrative_graph_by_change",
            Self::ApplyNarrativeBatch => "apply_narrative_batch",
            Self::ListNarrativeRevisions => "list_narrative_revisions",
            Self::QueryNarrativeGraph => "query_narrative_graph",
            Self::RenderNarrativeGraph => "render_narrative_graph",
            Self::ExportNarrativeTraining => "export_narrative_training",
        }
    }

    fn mutates(self) -> bool {
        match self {
            Self::RegisterNarrativeGraph
            | Self::ReviseNarrativeGraph
            | Self::ReviseNarrativeGraphByChange
            | Self::ApplyNarrativeBatch => true,
            Self::ListNarrativeRevisions
            | Self::QueryNarrativeGraph
            | Self::RenderNarrativeGraph
            | Self::ExportNarrativeTraining => false,
        }
    }
}

impl CheckpointOperation {
    fn name(self) -> &'static str {
        match self {
            Self::RegisterProjectCheckpoint => "register_project_checkpoint",
            Self::ListProjectCheckpoints => "list_project_checkpoints",
            Self::GetProjectCheckpoint => "get_project_checkpoint",
            Self::ExportProjectCheckpoint => "export_project_checkpoint",
            Self::RenderProjectCheckpoint => "render_project_checkpoint",
            Self::QueryProjectCheckpointGraph => "query_project_checkpoint_graph",
        }
    }

    fn mutates(self) -> bool {
        match self {
            Self::RegisterProjectCheckpoint => true,
            Self::ListProjectCheckpoints
            | Self::GetProjectCheckpoint
            | Self::ExportProjectCheckpoint
            | Self::RenderProjectCheckpoint
            | Self::QueryProjectCheckpointGraph => false,
        }
    }
}

/// Whether the session handles this operation itself rather than passing it to the legacy registry commands.
pub fn is_machine_operation(operation: &str) -> bool {
    MachineOperation::parse(operation).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_operation_name_parses_and_round_trips() {
        let mut names = std::collections::BTreeSet::new();
        for operation in MachineOperation::ALL {
            let name = operation.name();
            assert!(names.insert(name), "{name} is listed twice");
            assert_eq!(MachineOperation::parse(name), Some(operation), "{name}");
            let parsed: MachineOperation = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(parsed, operation, "{name}");
            assert!(is_machine_operation(name), "{name}");
        }
        assert_eq!(names.len(), 32);
    }

    #[test]
    fn only_exact_machine_operation_names_parse() {
        for name in [
            "",
            "describe",
            "compile_registry",
            "roll",
            "Register_model",
            "register_model ",
            "registerModel",
            "list_project_checkpoint",
        ] {
            assert_eq!(MachineOperation::parse(name), None, "{name:?}");
            assert!(!is_machine_operation(name), "{name:?}");
        }
    }

    #[test]
    fn describe_lists_the_legacy_commands_then_every_machine_operation_in_order() {
        let description = crate::machine_description();
        let listed: Vec<&str> = description["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| name.as_str().unwrap())
            .collect();
        let mut expected = vec!["describe", "compile_registry", "roll"];
        expected.extend(MachineOperation::ALL.map(MachineOperation::name));
        assert_eq!(listed, expected);
    }

    #[test]
    fn exactly_the_operations_that_change_a_session_mutate() {
        let mutating: Vec<&str> = MachineOperation::ALL
            .into_iter()
            .filter(|operation| operation.mutates())
            .map(MachineOperation::name)
            .collect();
        assert_eq!(
            mutating,
            [
                "register_model",
                "revise_model",
                "create_world",
                "refine_genesis_world",
                "revise_world",
                "roll_world",
                "reroll_candidate",
                "reject_candidate",
                "commit_candidate",
                "register_narrative_graph",
                "revise_narrative_graph",
                "revise_narrative_graph_by_change",
                "apply_narrative_batch",
                "register_project_checkpoint",
            ]
        );
    }
}
