//! Header-only lineage and head queries, store status, and explicit full validation.
use crate::limits::{
    MAX_SESSION_MODELS, MAX_SESSION_MODEL_BYTES, MAX_SESSION_NARRATIVE_BYTES,
    MAX_SESSION_NARRATIVE_GRAPHS,
};
use crate::session::operation::StoreOperation;
use crate::session::persistence::write_seals;
use crate::session::{
    encode, machine_error, model_header_json, required, MachineCommand, MachineError,
    MachineSession, StoreAuditSpec, MODEL_HEADS_SCHEMA, MODEL_LINEAGE_SCHEMA, STORE_AUDIT_SCHEMA,
    STORE_STATUS_SCHEMA,
};

impl MachineSession {
    pub(super) fn execute_store_command(
        &mut self,
        operation: StoreOperation,
        command: MachineCommand,
    ) -> Result<serde_json::Value, MachineError> {
        match operation {
            StoreOperation::ModelLineage => {
                let model_hash = required(command.model_hash, "model_lineage requires model_hash")?;
                if !self.models.contains_key(&model_hash) {
                    return Err(machine_error(
                        "not_found",
                        format!("unknown model {model_hash}"),
                    ));
                }
                let spec = command.model_lineage.unwrap_or_default();
                let limit = spec
                    .limit
                    .unwrap_or(MAX_SESSION_MODELS)
                    .clamp(1, MAX_SESSION_MODELS);
                let (revisions, complete) =
                    self.models
                        .lineage(&model_hash, spec.stop_at_model_hash.as_deref(), limit)?;
                let reached = spec
                    .stop_at_model_hash
                    .as_ref()
                    .map(|stop| revisions.last().is_some_and(|(hash, _)| hash == stop));
                encode(serde_json::json!({
                    "schema": MODEL_LINEAGE_SCHEMA,
                    "model_hash": model_hash,
                    "revisions": revisions.iter().map(|(hash, header)| model_header_json(hash, header)).collect::<Vec<_>>(),
                    "complete": complete,
                    "reached_stop_at": reached,
                }))
            }
            StoreOperation::ModelHeads => {
                let spec = command.model_heads.unwrap_or_default();
                if let Some(start) = &spec.descending_from {
                    if !self.models.contains_key(start) {
                        return Err(machine_error("not_found", format!("unknown model {start}")));
                    }
                }
                let mut heads = Vec::new();
                for (hash, header) in self.models.leaves() {
                    if spec.model_id.as_ref().is_some_and(|id| id != &header.id) {
                        continue;
                    }
                    let mut entry = model_header_json(hash, header);
                    if let Some(start) = &spec.descending_from {
                        let (path, _) =
                            self.models.lineage(hash, Some(start), MAX_SESSION_MODELS)?;
                        if !path.last().is_some_and(|(found, _)| found == start) {
                            continue;
                        }
                        entry["steps_from"] = serde_json::json!(path.len() - 1);
                    }
                    heads.push(entry);
                }
                heads.sort_by(|a, b| {
                    b["revision_number"]
                        .as_u64()
                        .cmp(&a["revision_number"].as_u64())
                        .then_with(|| a["model_hash"].as_str().cmp(&b["model_hash"].as_str()))
                });
                encode(serde_json::json!({ "schema": MODEL_HEADS_SCHEMA, "heads": heads }))
            }
            StoreOperation::AuditStore => self.audit_store(command.store_audit.unwrap_or_default()),
            StoreOperation::StoreStatus => encode(self.store_status()),
        }
    }
    fn audit_store(&self, spec: StoreAuditSpec) -> Result<serde_json::Value, MachineError> {
        let path = self.state_file.clone().ok_or_else(|| {
            machine_error(
                "invalid_request",
                "audit_store needs a session opened with a state file",
            )
        })?;
        let started = std::time::Instant::now();
        let (audited, seals, stored) = Self::open_store(&path, false)?;
        let stored = stored.unwrap_or_default();
        let (mut matched, mut missing, mut differing) = (0usize, 0usize, 0usize);
        let mut to_write = Vec::new();
        for seal in &seals {
            match stored.get(&(seal.kind, seal.object_hash.clone())) {
                Some(existing) if existing == seal => matched += 1,
                Some(_) => {
                    differing += 1;
                    to_write.push(seal.clone());
                }
                None => {
                    missing += 1;
                    to_write.push(seal.clone());
                }
            }
        }
        let resealed = if spec.reseal && !to_write.is_empty() {
            write_seals(&path, &to_write)?;
            to_write.len()
        } else {
            0
        };
        encode(serde_json::json!({
            "schema": STORE_AUDIT_SCHEMA,
            "verified": true,
            "models": audited.models.len(),
            "narrative_revisions": audited.narrative_revisions.len(),
            "source_snapshots": audited.narrative_source_snapshots.len(),
            "seals": { "matched": matched, "missing": missing, "differing": differing },
            "resealed": resealed,
            "elapsed_ms": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        }))
    }
    fn store_status(&self) -> serde_json::Value {
        let sealed_models = self
            .models
            .entries()
            .filter(|(_, entry)| entry.seal.is_some())
            .count();
        let sealed_narratives = self
            .narrative_revisions
            .values()
            .filter(|entry| entry.seal.is_some())
            .count();
        serde_json::json!({
            "schema": STORE_STATUS_SCHEMA,
            "state_file": self.state_file.is_some(),
            "models": {
                "count": self.models.len(),
                "sealed": sealed_models,
                "row_bytes": self.models.row_bytes_total(),
                "held_bytes": self.models.held_bytes(),
                "cached_bytes": self.models.cached_bytes(),
                "max_count": MAX_SESSION_MODELS,
                "max_held_bytes": MAX_SESSION_MODEL_BYTES,
            },
            "narrative_revisions": {
                "count": self.narrative_revisions.len(),
                "sealed": sealed_narratives,
                "row_bytes": self.narrative_revisions.values().map(|entry| entry.row_bytes).sum::<usize>(),
                "held_bytes": self.narrative_held_bytes(),
                "cached_bytes": self.narrative_records.cached_bytes(),
                "materialized": self.narrative_materialized.borrow().len(),
                "max_count": MAX_SESSION_NARRATIVE_GRAPHS,
                "max_held_bytes": MAX_SESSION_NARRATIVE_BYTES,
            },
            "source_snapshots": self.narrative_source_snapshots.len(),
        })
    }
}
