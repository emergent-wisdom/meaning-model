//! The Meaning Model: what models, worlds, candidates, narrative graphs and project checkpoints are, and the pure
//! functions that compile, roll, check and project them.
//!
//! A model is authored as a `ModelDefinition` and compiled into a `CompiledModel`. A world is one model's accepted
//! state over time: a transition query rolls its head into a candidate, which is rerolled, rejected, or committed as
//! the next head. Narrative graphs and project checkpoints are written about models, worlds and candidates, against
//! frozen snapshots of them.
//!
//! Nothing here holds state between commands, touches a file, or chooses a response code. Every function takes the
//! values it works on and returns a new value or an `EngineError`, which the session answers as `invalid_request`
//! (the graph query alone distinguishes "not found" and "conflict", in its own error type). Given the same inputs,
//! every function returns the same output, so a candidate replays exactly and every content hash is stable. The
//! session (crate::session) holds these values and decides what changes; this module never depends on it.
//!
//! The public items of the submodules are re-exported here, and from here at the crate root. A submodule is visible to
//! the crate so that the session can name where each piece comes from; an item the session uses is `pub(crate)`, and
//! one only this module uses stays `pub(super)`.

// A model: its authored definition, compilation, revision rules, and the optional Meaning Model layer.
pub(crate) mod compile;
pub(crate) mod definition;
pub(crate) mod meaning;
pub(crate) mod revision;
pub use compile::*;
pub use definition::*;
pub use meaning::*;

// A world over time: heads and revisions, the query a roll is asked to do, its keyed randomness, the roll itself,
// the candidate it proposes, and summaries of a candidate's retained path.
pub(crate) mod candidate;
pub(crate) mod query;
pub(crate) mod randomness;
pub(crate) mod trajectory;
pub(crate) mod transition;
pub(crate) mod world;
pub use candidate::*;
pub use query::*;
pub use randomness::*;
pub use trajectory::*;
pub use transition::*;
pub use world::*;

// Reading them: what a caller is shown, under the one access-scope rule, and the factor graph.
pub(crate) mod access;
pub(crate) mod graph;
pub(crate) mod view;
pub use view::*;

// Writing about them: narrative understanding graphs and project checkpoints.
pub(crate) mod narrative;
pub(crate) mod project;
pub use narrative::*;
pub use project::*;

// The identifiers of the documents the engine reads and writes.
pub const MODEL_SCHEMA: &str = "life-sim-rust-model/v1";
pub const MODEL_QUERY_SCHEMA: &str = "life-sim-rust-model-query/v1";
pub const WORLD_HEAD_SCHEMA: &str = "life-sim-rust-world-head/v1";
pub const WORLD_REVISION_SCHEMA: &str = "life-sim-rust-world-revision/v1";
pub const MODEL_CANDIDATE_SCHEMA: &str = "life-sim-rust-model-candidate/v1";
pub const MODEL_PATH_SCHEMA: &str = "life-sim-rust-model-path/v1";
pub const MODEL_VIEW_SCHEMA: &str = "life-sim-rust-view/v1";
pub const MODEL_GRAPH_SCHEMA: &str = "life-sim-rust-graph/v1";
pub const TRAJECTORY_SUMMARY_QUERY_SCHEMA: &str = "life-sim-rust-trajectory-summary-query/v1";
pub const TRAJECTORY_SUMMARY_SCHEMA: &str = "life-sim-rust-trajectory-summary/v1";
pub const PROJECT_DOCUMENT_SCHEMA: &str = "life-sim-rust-project-document/v1";
pub const PROJECT_CHECKPOINT_SCHEMA: &str = "life-sim-rust-project-checkpoint/v1";
pub const PROJECT_CHECKPOINT_LIST_SCHEMA: &str = "life-sim-rust-project-checkpoint-list/v1";
pub const PROJECT_CHECKPOINT_RENDER_SCHEMA: &str = "life-sim-rust-project-checkpoint-render/v1";
pub const PROJECT_CHECKPOINT_EXPORT_SCHEMA: &str = "life-sim-rust-project-checkpoint-export/v1";

#[cfg(test)]
mod tests;
