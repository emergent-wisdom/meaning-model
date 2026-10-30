//! The answer to `describe`: what this engine build implements, its schemas, limits and semantics, for a caller to
//! check before relying on it.
//!
//! It is built from the constants and the operation table the engine runs on (the machine operations come from the
//! session's table, in its order), so it cannot list an operation, schema or bound the build does not have. The legacy
//! command path in registry.rs answers `describe` with it.

use crate::limits::{
    MAX_EXPRESSION_DEPTH, MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW, MAX_LAW_PROCESS_EVALUATIONS,
    MAX_MODEL_DEFINITION_BYTES, MAX_MODEL_EXPRESSION_NODES, MAX_MODEL_IDENTIFIER_BYTES,
    MAX_OBSERVATION_PROVENANCE, MAX_POTENTIAL_ACTIVITY_BYTES, MAX_POTENTIAL_ACTIVITY_RECORDS,
    MAX_PROJECT_CHECKPOINTS, MAX_PROJECT_DOCUMENT_BYTES, MAX_PROJECT_EXPORT_BYTES,
    MAX_PROJECT_STORAGE_BYTES, MAX_QUERY_ACCESS_SCOPES, MAX_QUERY_DURATION,
    MAX_QUERY_INTERVENTIONS, MAX_QUERY_OBSERVABLES, MAX_QUERY_OBSERVATIONS, MAX_QUERY_STRING_BYTES,
    MAX_QUERY_SUPPORT, MAX_RETAINED_STATE_BYTES, MAX_SESSION_CANDIDATES,
    MAX_SESSION_CANDIDATE_BYTES, MAX_SESSION_MODELS, MAX_SESSION_MODEL_BYTES,
    MAX_SESSION_NARRATIVE_BYTES, MAX_SESSION_NARRATIVE_GRAPHS, MAX_SESSION_REPLAY_WORK,
    MAX_SESSION_WORLDS, MAX_SESSION_WORLD_BYTES, MAX_SESSION_WORLD_REVISIONS,
    MAX_SESSION_WORLD_REVISION_BYTES, MAX_STATE_BYTE_STEPS, MAX_STEP_COUNT,
    MAX_TRAJECTORY_SUMMARY_WORK,
};
use crate::model::meaning::{
    MAX_MEANING_CUT_CHILDREN, MAX_MEANING_EVENT_PROCESSES, MAX_MEANING_MODEL_RECORDS,
    MAX_MEANING_REALIZATION_BINDINGS, MEANING_MODEL_SCHEMA, NORMALIZED_CUT_REMAINDER_KEY,
    NORMALIZED_CUT_SUM_TOLERANCE,
};
use crate::model::narrative::{
    NARRATIVE_BATCH_SCHEMA, NARRATIVE_CHANGE_SCHEMA, NARRATIVE_GRAPH_SCHEMA,
    NARRATIVE_GRAPH_VIEW_SCHEMA, NARRATIVE_HISTORY_SCHEMA, NARRATIVE_RENDER_SCHEMA,
    NARRATIVE_TRAINING_SCHEMA,
};
use crate::model::randomness::RANDOM_SCHEDULE_SCHEMA;
use crate::model::{
    MODEL_CANDIDATE_SCHEMA, MODEL_GRAPH_SCHEMA, MODEL_QUERY_SCHEMA, MODEL_SCHEMA,
    MODEL_VIEW_SCHEMA, PROJECT_CHECKPOINT_EXPORT_SCHEMA, PROJECT_CHECKPOINT_LIST_SCHEMA,
    PROJECT_CHECKPOINT_RENDER_SCHEMA, PROJECT_CHECKPOINT_SCHEMA, PROJECT_DOCUMENT_SCHEMA,
    TRAJECTORY_SUMMARY_QUERY_SCHEMA, TRAJECTORY_SUMMARY_SCHEMA, WORLD_HEAD_SCHEMA,
    WORLD_REVISION_SCHEMA,
};
use crate::profiles::PROFILE_COMPILATION_SCHEMA;
use crate::session::{
    machine_operation_names, MODEL_HEADS_SCHEMA, MODEL_LINEAGE_SCHEMA, SESSION_STATE_SCHEMA,
    STORE_AUDIT_SCHEMA, STORE_STATUS_SCHEMA,
};

/// The legacy registry commands, which the crate root handles, then every machine operation.
fn described_operations() -> Vec<&'static str> {
    let mut operations = vec!["describe", "compile_registry", "roll"];
    operations.extend(machine_operation_names());
    operations
}

pub fn machine_description() -> serde_json::Value {
    let mut description = serde_json::json!({
        "engine": "life-sim-engine",
        "engine_version": env!("CARGO_PKG_VERSION"),
        "authority": {
            "world_heads": "rust_process_memory_or_optional_transactional_sqlite_state_file",
            "candidate_lineage": "rust_process_memory_or_optional_transactional_sqlite_state_file",
            "atomic_commit": true,
            "durable_across_restart": "when --state-file or LIFE_SIM_STATE_FILE is configured",
            "default_filesystem_side_effects": false,
            "multi_process_writers": "serialized_by_SQLite_and_stale_sessions_rejected_by_generation_CAS"
        },
        "schemas": {
            "command": crate::COMMAND_SCHEMA,
            "response": crate::RESPONSE_SCHEMA,
            "legacy_registry": crate::REGISTRY_SCHEMA,
            "model": MODEL_SCHEMA,
            "profile_compilation": PROFILE_COMPILATION_SCHEMA,
            "meaning_model": MEANING_MODEL_SCHEMA,
            "model_query": MODEL_QUERY_SCHEMA,
            "world_head": WORLD_HEAD_SCHEMA,
            "model_candidate": MODEL_CANDIDATE_SCHEMA,
            "random_schedule_fingerprint": RANDOM_SCHEDULE_SCHEMA,
            "graph": MODEL_GRAPH_SCHEMA,
            "view": MODEL_VIEW_SCHEMA,
            "narrative_graph": NARRATIVE_GRAPH_SCHEMA,
            "narrative_graph_view": NARRATIVE_GRAPH_VIEW_SCHEMA,
            "narrative_render": NARRATIVE_RENDER_SCHEMA,
            "narrative_training": NARRATIVE_TRAINING_SCHEMA,
            "narrative_history": NARRATIVE_HISTORY_SCHEMA,
            "session_state": SESSION_STATE_SCHEMA
        },
        "operations": described_operations(),
        "value_kinds": [
            "scalar", "vector", "category", "distribution", "graph",
            "object_pose", "regime"
        ],
        "operator_roles": [
            "evolution", "relation", "occurrence", "epistemic", "resolution"
        ],
        "edge_kinds": {
            "decomposition": [
                "contains", "physical_part", "membership_view", "semantic_subtype",
                "temporal_phase", "functional_refinement", "observational_partition"
            ],
            "dependency": ["derives", "causes", "constrains", "observes"],
            "abstract_relation": [
                "specialization", "constrains", "analogy", "opposition", "other"
            ],
            "event_relation": ["contains", "causes", "enables", "prevents", "constrains", "other"],
            "physical_cut": ["parallel", "sequential"]
        },
        "meaning_model": {
            "opt_in_field": "model.meaning_model",
            "collections": [
                "concepts", "abstract_relations", "abstract_cuts",
                "referents", "encapsulation_cuts", "events",
                "event_relations", "event_referent_bindings", "physical_cuts", "realizations",
                "normalized_cuts", "context_roots", "temporal_cut_recompositions",
                "importance_scales", "event_importance", "cause_questions", "cause_assessments"
            ],
            "importance": {
                "scales": "an audience (a world's inhabitants, or those who follow one category, optionally naming a concept) and 2 to 12 levels ordered from the most important down, each with an anchor",
                "judgments": "one level per Event, scale and holder; a reassessment replaces it and the revision history keeps the earlier one",
                "scope": "a perspective-relative judgment that chooses what a reader is shown; not containment, a Cut's shares or a process value, and never scheduled or executed"
            },
            "causes": {
                "questions": "one holder's question why an outcome Event came about rather than its contrast, read on one measure (a probability from 0 to 1, or a nonnegative amount in a unit, optionally a process's) with the actual reading; one per outcome, contrast, holder and measure",
                "assessments": "a causal relation (causes, enables, prevents, constrains) ending at the question's outcome, the outcome read without that cause everything else as it was, an optional role (enabling, trigger, sustaining, success_condition, hindering) and band, and optional relations removed together with it; one per question, relation and set removed with it",
                "direction": "without a cause that brings the outcome about the reading is at most the actual one; without one that stands in its way, at least",
                "scope": "a perspective-relative counterfactual judgment: differences between readings rank causes and do not sum; never scheduled or executed"
            },
            "normalized_cuts": {
                "remainder_key": NORMALIZED_CUT_REMAINDER_KEY,
                "sum_tolerance": NORMALIZED_CUT_SUM_TOLERANCE,
                "conditioning": "cut_id and stable answer_key within the same immutable model and governing context",
                "scope": "static normalized allocations with optional declared temporal recomposition; no semantic exclusivity proof or forecast calibration"
            },
            "temporal_cut_recompositions": {
                "coverage": ["complete", "partial"],
                "projection": ["identity", "answer_map"],
                "weights": "duration shares derived from disjoint bounded child Event intervals",
                "validation": "same question, unit, conditioning and declared context; complete mixtures reproduce parent; partial mixtures leave feasible nonnegative residual",
                "scope": "explicit structural contract, not automatic semantic decomposition or a rule for overlapping episodes"
            },
            "context_roots": {
                "kinds": ["accepted_world", "inner", "understanding", "document", "candidate"],
                "ancestry": "Contains edges only, acyclic, every path reaches the same nearest declared root; known intervals must be contained",
                "scope": "opt-in static authority validation; no evidence disclosure or story-time cutoff access"
            },
            "realization_purposes": ["define", "describe"],
            "semantic_coverage": {
                "opt_in_field": "model.meaning_model.semantic_coverage",
                "modes": ["report", "strict"],
                "direct": "event is named by a role of a nonzero-degree realization",
                "inherited": "event is the parent or child of a physical cut explicitly named by a nonzero-degree realization; unrelated and nested cuts are not traversed",
                "unresolved": "explicit event id, bounded reason, and provenance; later direct or inherited coverage supersedes the allowance",
                "strict_invariant": "every declared semantic event is direct, inherited, or explicitly unresolved",
                "scope": "compiled static Meaning Model declarations, not accepted runtime event occurrences"
            },
            "referent_semantics": [
                "boundary", "continuity_criterion", "interval",
                "lifecycle_event_id", "uncertainty", "provenance", "authority"
            ],
            "event_referent_binding_targets": ["event", "process"],
            "event_semantics": [
                "boundary", "description", "interval", "process_ids", "observation_process_ids",
                "participants", "substrate", "region"
            ],
            "event_relation_semantics": {
                "kinds": ["contains", "causes", "enables", "prevents", "constrains", "other"],
                "direction": "source_event_id_to_target_event_id",
                "metadata": ["description", "uncertainty", "provenance", "authority"],
                "execution": "validated static causal claim; does not schedule events or create a law"
            },
            "event_context_annotations": "participants, substrate, and region are legacy free-form context; event_referent_bindings is the typed referential authority",
            "execution": "validated static semantic layer; processes and laws remain the physical execution substrate",
            "genesis_refinement": "authored additions may replace only an untouched genesis world through its direct next model revision; every old process, edge, law, initial claim, and Meaning Model record is preserved exactly",
            "genesis_refinement_boundary": "not automatic discovery, adaptive runtime opening, or post-history migration",
            "define_indexing": "define realizations require an abstract cut whose parent is the realized concept",
            "ordering": "abstract, encapsulation, and parallel children are unordered canonical sets; sequential child order is significant"
        },
        "lineage_operations": [
            "roll_world", "inspect_candidate", "reroll_candidate",
            "reject_candidate", "commit_candidate", "revise_world", "get_world_revision"
        ],
        "execution": {
            "scalar_expressions": true,
            "all_values_retained_in_complete_candidates": true,
            "non_scalar_values": "validated_and_carried_but_not_numerically_updated",
            "relation_resolution_order": "validated_acyclic",
            "randomness": "named_keyed_draws_bound_to_candidate",
            "randomness_policies": ["candidate_bound", "common_random_comparison"],
            "common_random_comparison": {
                "query_field": "comparison_stream",
                "opt_in_only": true,
                "default_unchanged_when_absent": true,
                "master_key_inputs": ["seed", "comparison_stream", "schedule_hash", "roll_index"],
                "deliberately_excluded_from_master_key": ["model", "parent", "interventions", "observations", "outputs"],
                "schedule_binding": ["direction", "delta_time", "actual_step_size", "step_count"],
                "observation_timing": "observations already require existing exact step boundaries and therefore do not alter the execution grid",
                "sharing_scope": "only overlapping named draw keys at the same step and draw index",
                "lineage_boundary": "query, dynamics, trajectory, candidate, and world hashes remain bound to each variant's actual inputs and outputs",
                "claim_boundary": "variance-reduction experiment aid only; not branch splicing, counterfactual identity, or causal identification",
                "visibility": "comparison_stream is returned as candidate randomness metadata; do not place secrets in it"
            },
            "intervention_timing": {
                "query_field": "TimedIntervention.application",
                "default_when_absent": "successor_boundary",
                "legacy_successor_boundary": "the effect lands after evolution on the first completed numerical boundary at or after its offset and before exact relation/resolution closure; offset zero therefore lands on the first successor",
                "initial_boundary": "opt-in value applied simultaneously at the frozen parent's time before first-step occurrence and evolution evaluation, followed by always-active exact relation/resolution closure",
                "initial_boundary_offset": 0,
                "parent_sample": "retained step zero remains the unchanged frozen parent; the parent-time intervention mark records the right-hand boundary jump",
                "mark": "initial_boundary interventions are marked at step zero and the frozen parent's time",
                "lineage_binding": "application is omitted from serialization when absent; an explicit value participates in query and dynamics identity, realized samples determine trajectory identity, and candidate/world lineage binds them",
                "projected_query_count": "initial_boundary_intervention_count is emitted only when nonzero; absence means zero"
            },
            "determinism_scope": "exact replay is established for the same pinned engine build and platform; cross-platform transcendental equivalence is not claimed",
            "legacy_scalar_kernel_compatible": true,
            "access_projection": "explicit observable ids; empty ids return no state values",
            "claim_projection": "subject visibility plus independent claim access scopes",
            "scope_security_boundary": "scope strings are projection labels, not authenticated principals",
            "view_identity": "observables, access scopes, path retention, and presently inert resolution/support labels do not alter canonical candidate or world identity",
            "selected_support": "validated metadata only; active-frontier pruning is not implemented",
            "decomposition_edges": "schema-time acyclic structural lenses only; no numeric, causal, or world-time effect",
            "meaning_model": "optional validated static schema with authored event-to-event causal claims and optional declared-event semantic coverage audit/enforcement; no automatic expansion, aggregation, residual, recomposition, discovery, scheduling, or causal execution behavior",
            "genesis_refinement": {
                "implemented": true,
                "operation": "refine_genesis_world",
                "target": "already_registered_direct_next_model_revision",
                "authority": "monotonic authored additions before accepted time begins",
                "requires": ["world version 0", "world time 0", "no lineage", "exact old-record preservation"],
                "not_implemented": ["automatic discovery", "post-history migration", "adaptive execution pruning"]
            },
            "dynamic_membership": "represent as a time-indexed process updated by a relation law, not as a membership_view edge",
            "partial_refinement_reconciliation": "not implemented",
            "revision_additions": "support plus law/dependency or static/observed declaration"
        },
        "persistence": {
            "default": "process_memory_no_filesystem_side_effects",
            "opt_in": ["--state-file PATH", "LIFE_SIM_STATE_FILE=PATH"],
            "backend": "SQLite",
            "commit_protocol": "dirty_rows_in_one_foreign_key_checked_transaction_with_generation_compare_and_swap",
            "journal_mode": "WAL",
            "synchronous": "FULL",
            "unix_permissions": "0600_for_database_and_present_WAL_SHM_sidecars",
            "startup_validation": "SQLite identity, integrity, foreign keys, relational shadow columns, and bounds; model/world/narrative hashes; exact narrative source snapshots; operation sequences; complete lineage; deterministic candidate replay",
            "failure_semantics": "no success response before transaction commit; failures reload authoritative SQLite state; an ambiguous failed COMMIT is reported as persistence_uncertain",
            "writer_model": "generation_compare_and_swap_rejects_stale_session_writers; SQLite serializes transactions",
            "longevity": "bounded append-only narrative deltas and row-addressed mutable world/candidate heads; no destructive pruning operation",
            "narrative_materialization": "graph heads and recent revisions each use a 64 MiB serialized-payload cache, with one oversized entry allowed per cache; recent entries also capped at 64; evicted revisions replay from the nearest cached ancestor; no durable cache or checkpoint compaction",
            "seals": "each model and graph revision is sealed when it is written, or validated and sealed on the first open of a store without seals: the sha256 of its row's bytes, its header, and its parent's seal; an open trusts a whole seal chain and validates only unsealed revisions; a row read later is checked against its seal; audit_store (or --audit) validates everything again",
            "held_in_memory": "a durable session holds every revision's header, the rows not yet written, and bounded caches of rows read; a session without a file holds every row"
        },
        "execution_limits": {
            "max_command_bytes": crate::MAX_COMMAND_BYTES,
            "max_step_count": MAX_STEP_COUNT,
            "max_law_process_evaluations": MAX_LAW_PROCESS_EVALUATIONS,
            "max_state_byte_steps": MAX_STATE_BYTE_STEPS,
            "max_retained_state_bytes_estimate": MAX_RETAINED_STATE_BYTES,
            "max_potential_activity_records": MAX_POTENTIAL_ACTIVITY_RECORDS,
            "max_potential_activity_bytes_estimate": MAX_POTENTIAL_ACTIVITY_BYTES,
            "max_expression_depth": MAX_EXPRESSION_DEPTH,
            "max_model_expression_nodes": MAX_MODEL_EXPRESSION_NODES,
            "max_meaning_model_records": MAX_MEANING_MODEL_RECORDS,
            "max_meaning_cut_children": MAX_MEANING_CUT_CHILDREN,
            "max_meaning_event_processes": MAX_MEANING_EVENT_PROCESSES,
            "max_meaning_realization_bindings": MAX_MEANING_REALIZATION_BINDINGS,
            "max_query_duration": MAX_QUERY_DURATION,
            "max_query_interventions": MAX_QUERY_INTERVENTIONS,
            "max_query_support": MAX_QUERY_SUPPORT,
            "max_query_observables": MAX_QUERY_OBSERVABLES,
            "max_query_access_scopes": MAX_QUERY_ACCESS_SCOPES,
            "max_query_string_bytes": MAX_QUERY_STRING_BYTES,
            "max_model_identifier_bytes": MAX_MODEL_IDENTIFIER_BYTES,
            "max_model_definition_bytes": MAX_MODEL_DEFINITION_BYTES,
            "max_session_models": MAX_SESSION_MODELS,
            "max_session_worlds": MAX_SESSION_WORLDS,
            "max_session_candidates": MAX_SESSION_CANDIDATES,
            "max_session_model_bytes": MAX_SESSION_MODEL_BYTES,
            "max_session_world_bytes": MAX_SESSION_WORLD_BYTES,
            "max_session_candidate_bytes": MAX_SESSION_CANDIDATE_BYTES,
            "max_session_replay_work": MAX_SESSION_REPLAY_WORK
        },
        "legacy_execution_limits": {
            "max_steps": crate::MAX_STEPS,
            "max_fields": crate::MAX_LEGACY_FIELDS,
            "max_couplings": crate::MAX_LEGACY_COUPLINGS,
            "max_events": crate::MAX_LEGACY_EVENTS,
            "max_event_effects": crate::MAX_LEGACY_EVENT_EFFECTS,
            "max_work": crate::MAX_LEGACY_WORK,
            "max_retained_bytes": crate::MAX_LEGACY_RETAINED_BYTES,
            "max_state_byte_steps": crate::MAX_LEGACY_STATE_BYTE_STEPS,
            "max_duration": crate::MAX_LEGACY_DURATION
        },
        "path_modes": ["endpoint", "full", "decimated"]
    });
    description["authority"]["narrative_graphs"] =
        serde_json::json!("rust_process_memory_or_optional_transactional_sqlite_state_file");
    description["schemas"]["narrative_batch"] = serde_json::json!(NARRATIVE_BATCH_SCHEMA);
    description["schemas"]["narrative_change"] = serde_json::json!(NARRATIVE_CHANGE_SCHEMA);
    description["schemas"]["project_document"] = serde_json::json!(PROJECT_DOCUMENT_SCHEMA);
    description["schemas"]["project_checkpoint"] = serde_json::json!(PROJECT_CHECKPOINT_SCHEMA);
    description["schemas"]["project_checkpoint_list"] =
        serde_json::json!(PROJECT_CHECKPOINT_LIST_SCHEMA);
    description["schemas"]["project_checkpoint_render"] =
        serde_json::json!(PROJECT_CHECKPOINT_RENDER_SCHEMA);
    description["schemas"]["project_checkpoint_export"] =
        serde_json::json!(PROJECT_CHECKPOINT_EXPORT_SCHEMA);
    description["persistence"]["startup_validation"] = serde_json::json!(
        "SQLite identity/integrity/foreign keys/relational shadow columns/bounds, seal chains and header links for sealed revisions, and for unsealed ones model/world/narrative hashes, exact narrative source snapshots, canonical deltas, unique append-only operation sequences, causal evidence cutoffs, complete lineage, and deterministic candidate replay; every graph head and newest model revision rebuilt and checked against its hash"
    );
    description["heartbeat"] = serde_json::json!({
        "schema": crate::heartbeat::HEARTBEAT_SCHEMA,
        "environment": crate::heartbeat::HEARTBEAT_ENV,
        "stream": "stderr",
        "interval_ms": crate::heartbeat::interval_ms(),
        "fields": ["sequence", "progress", "busy.operation", "busy.request_id", "busy.elapsed_ms"]
    });
    description["schemas"]["model_lineage"] = serde_json::json!(MODEL_LINEAGE_SCHEMA);
    description["schemas"]["model_heads"] = serde_json::json!(MODEL_HEADS_SCHEMA);
    description["schemas"]["store_audit"] = serde_json::json!(STORE_AUDIT_SCHEMA);
    description["schemas"]["store_status"] = serde_json::json!(STORE_STATUS_SCHEMA);
    description["execution_limits"]["max_session_narrative_graphs"] =
        serde_json::json!(MAX_SESSION_NARRATIVE_GRAPHS);
    description["schemas"]["world_revision"] = serde_json::json!(WORLD_REVISION_SCHEMA);
    description["execution_limits"]["max_session_world_revisions"] =
        serde_json::json!(MAX_SESSION_WORLD_REVISIONS);
    description["execution_limits"]["max_session_world_revision_bytes"] =
        serde_json::json!(MAX_SESSION_WORLD_REVISION_BYTES);
    description["execution"]["world_revision"] = serde_json::json!({
        "implemented": true,
        "operation": "revise_world",
        "modes": ["refine", "revise"],
        "boundary": "explicit direct-next registered model transition at unchanged world time with exact expected-world-hash compare-and-swap",
        "state": "source values and claims persist; new processes require explicit current-time values; revise may explicitly replace existing state values",
        "history": "immutable source and target heads are hash-linked into accepted lineage and validated on database restore",
        "portable_export": "narrative training and portable checkpoint export crossing world revisions is rejected with unsupported_history; complete accepted history remains in the session database"
    });
    description["execution_limits"]["max_session_narrative_bytes"] =
        serde_json::json!(MAX_SESSION_NARRATIVE_BYTES);
    description["execution_limits"]["max_project_checkpoints"] =
        serde_json::json!(MAX_PROJECT_CHECKPOINTS);
    description["execution_limits"]["max_project_document_bytes"] =
        serde_json::json!(MAX_PROJECT_DOCUMENT_BYTES);
    description["execution_limits"]["max_project_storage_bytes"] =
        serde_json::json!(MAX_PROJECT_STORAGE_BYTES);
    description["execution_limits"]["max_project_export_bytes"] =
        serde_json::json!(MAX_PROJECT_EXPORT_BYTES);
    description["persistence"]["project_checkpoints"] = serde_json::json!(
        "immutable content-addressed documents plus frozen model/world/graph snapshots; portable model/world/graph material uses mutually exclusive lossless JSON-string carriers; imported graph sources require exact bounded candidate-lineage replay and frozen anchor validation; active execution heads and legacy narrative operation sequences remain separate"
    );
    description["graph_query"] = serde_json::json!({
        "source": "exactly_one_of_model_hash_world_id_candidate_hash",
        "modes": ["full", "skeleton", "neighborhood"],
        "neighborhood_directions": ["ancestors", "descendants", "both"],
        "snapshot_bound": true,
        "full_graph_directly_available": true,
        "factor_nodes": ["process", "law"],
        "factor_edges": [
            "ast_reads", "direct_writes", "activates",
            "decomposition", "declared_dependency"
        ],
        "candidate_law_occurrences": {
            "source_bound": true,
            "exact_count": true,
            "marks_per_law_limit": MAX_GRAPH_OCCURRENCE_MARKS_PER_LAW,
            "truncation_reported": true
        },
        "values": "optional_and_process_access_scope_guarded",
        "access": "process scopes filter inaccessible process nodes, dependent law payloads, and incident overlays",
        "neighborhood_boundary": "every_incident crossing edge and both endpoints",
        "center": "stable process:<id>/law:<id>, or an unambiguous raw source id"
    });
    description["narrative_understanding_graph"] = serde_json::json!({
        "optional": true,
        "authority": "rust_session",
        "canonical_artifact_units": true,
        "node_roles": [
            "document_root", "story_passage", "character_interior",
            "externalized_reflection", "reader_response", "metadata"
        ],
        "custom_node_types": true,
        "mutation_units": [
            "one_complete_graph_revision_validated_and_stored_as_an_append_only_delta",
            "one_additive_batch_of_one_or_more_roots_nodes_or_edges_validated_and_stored_as_an_append_only_delta"
        ],
        "history": "list_narrative_revisions enumerates every root, revision, branch point, and immutable head in operation-sequence order; any graph hash remains directly queryable/renderable and may receive a new successor",
        "ordering_boundary": "operation_sequence records insertion provenance only; structural edge order, event intervals, and simulated world time remain independent",
        "additive_batch_connectivity": "every_new_node_component_must_bridge_to_an_existing_node_or_stable_anchor; an_initial_component_may_instead_declare_a_root",
        "edge_families": ["structural", "grounding", "semantic", "provenance", "revision"],
        "structural_relations": ["contains", "next"],
        "model_anchor_kinds": [
            "model", "process", "decomposition", "dependency", "law", "claim",
            "concept", "abstract_relation", "abstract_cut", "referent",
            "encapsulation_cut", "event", "event_relation", "event_referent_binding",
            "physical_cut", "realization", "world", "candidate", "occurrence"
        ],
        "anchor_subpaths": "optional_rfc6901_json_pointer_validated_against_the_exact_stable_object",
        "source_binding": "exact_model_world_or_candidate_snapshot",
        "query_modes": ["full", "skeleton", "neighborhood"],
        "projections": ["story_render", "aligned_training_records"],
        "thought_boundary": "externalized_testimony_only_not_hidden_chain_of_thought",
        "privacy_boundary": "access_scopes_are_projection_guards_not_authentication"
    });
    description["schemas"]["trajectory_summary_query"] =
        serde_json::Value::String(TRAJECTORY_SUMMARY_QUERY_SCHEMA.to_owned());
    description["profile_compilation"] = serde_json::json!({
        "operation": "compile_profiles",
        "read_only": true,
        "implicit_registration": false,
        "profiles": [
            "story", "concept_scaffold", "change_arc_scaffold", "person",
            "person_scaffold", "thing_scaffold", "relationship_scaffold", "decision"
        ],
        "concept_scaffold": {
            "topology": "one shallow Concept definition",
            "number_rule": "no realization degree, canonical model, prototype, or recognizer is implied"
        },
        "change_arc_scaffold": {
            "topology": "one Event with optional anticipation, focal-change, and adaptation Event children",
            "number_rule": "phase containment is unweighted and may overlap; no shock magnitude or diffusion law is implied"
        },
        "person_scaffold": {
            "levels": ["lifecycle", "processes"],
            "topology": "lifecycle loads identity and one life Event; processes also loads nine concurrent unweighted process Events",
            "number_rule": "process containment carries no semantic number; numbers require a separately named Cut with a comparison unit",
            "optional_openings": ["body.health"]
        },
        "thing_scaffold": {
            "topology": "one stable Thing and one complete coarse lifecycle Event",
            "number_rule": "the lifecycle index is structural; containment, place, extent, state, and local Cuts are explicit later openings"
        },
        "relationship_scaffold": {
            "topology": "one unweighted joint Event bound to two existing Things",
            "number_rule": "the relationship carries no default trust, attachment, or other semantic score"
        },
        "output": "ordinary_complete_model_definition",
        "person_views": [
            "external_descriptive", "candidate_actor", "self_reported"
        ],
        "operative_model_boundary":
            "latent operative organization is not asserted by any compiled person view",
        "decision_boundary":
            "authored decision dynamics are executable hypotheses, not inferred actor truth or acceptance authority"
    });
    description["schemas"]["trajectory_summary"] =
        serde_json::Value::String(TRAJECTORY_SUMMARY_SCHEMA.to_owned());
    description["execution"]["trajectory_summary"] = serde_json::Value::String(
        "read-only piecewise-linear interpolation and subinterval statistics over already-retained full or decimated candidate paths; no reroll and no uncertainty propagation"
            .to_owned(),
    );
    description["execution_limits"]["max_trajectory_summary_work"] =
        serde_json::json!(MAX_TRAJECTORY_SUMMARY_WORK);
    description["execution_limits"]["max_query_observations"] =
        serde_json::json!(MAX_QUERY_OBSERVATIONS);
    description["execution_limits"]["max_observation_provenance"] =
        serde_json::json!(MAX_OBSERVATION_PROVENANCE);
    description["execution"]["observed_series"] = serde_json::Value::String(
        "forward-only, exact-step, typed assignments to lawless update_mode observed processes; applied after evolution/effects and before exact relations/resolution"
            .to_owned(),
    );
    description["observation_ingestion"] = serde_json::json!({
        "query_field": "ModelTransitionSpec.observations",
        "standalone_schema": false,
        "claim_mode": "observed",
        "evidence_types": ["observation", "report"],
        "initial_value_at_offset_zero": true,
        "value_carry": "last observation carries until the next observation",
        "path_retention": "observed values are retained in every selected candidate path sample",
        "lineage_binding": "normalized observations are included in query and dynamics hashes; generated marks and claims are included in the candidate hash",
        "persistence": "queries, observed states, marks, and claims persist in existing candidate/world snapshots and are deterministically replayed at startup"
    });
    description["trajectory_summary_statistics"] = serde_json::json!([
        "start",
        "end",
        "integral",
        "time_mean",
        "minimum",
        "maximum"
    ]);
    description
}
