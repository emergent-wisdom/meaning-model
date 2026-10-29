//! The Meaning Model engine (`life-sim-engine`): the one authoritative process that holds model revisions, worlds,
//! candidates, narrative graphs and project checkpoints. Every request is one JSON command answered by one JSON
//! response, read once from stdin or as NDJSON lines (see main.rs).
//!
//! The crate is carved into layers whose dependencies point one way (see ARCHITECTURE.md):
//! - the crate root holds what every command shares: the response envelope, the engine error and the canonical hash,
//!   with `limits` (every bound the engine enforces) and `graph_algorithms` (the shared cycle check);
//! - `model` is the Meaning Model itself: pure values and functions that compile, roll, check and project models,
//!   worlds, candidates, narrative graphs and checkpoints, with no state, files or response codes;
//! - `session` is the authoritative store: it runs each machine command against the model, keeps what changes, and,
//!   with a state file, writes it to SQLite before it answers;
//! - `profiles` compiles optional authoring profiles into ordinary model definitions;
//! - `registry` is the legacy registry engine, which answers the commands the session passes on (`describe`,
//!   `compile_registry`, `roll`), and `description` is the engine's answer to `describe`;
//! - `main.rs` is the process: its arguments, stdin and stdout.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::{Display, Formatter};

mod graph_algorithms;
pub(crate) use graph_algorithms::ensure_acyclic;

mod limits;

mod model;
pub use model::*;

mod session;
pub use session::*;

mod description;
pub use description::*;

mod registry;
pub use registry::*;

#[cfg(test)]
mod test_support;

mod profiles;
pub use profiles::*;

pub const COMMAND_SCHEMA: &str = "life-sim-rust-command/v1";
pub const RESPONSE_SCHEMA: &str = "life-sim-rust-response/v1";
pub const MAX_COMMAND_BYTES: usize = 256 * 1024 * 1024;

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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum PathSpec {
    #[default]
    Endpoint,
    Full,
    Decimated {
        every: usize,
    },
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
