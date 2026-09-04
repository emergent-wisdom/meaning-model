# Narrative Understanding Graph

The Narrative Understanding Graph is an optional Rust-native layer for keeping story text, explicit reflections, and their links to the simulation in one graph. Nothing creates or requires this layer during normal model, world, or candidate operations.

## Authority and mutation model

Rust is the single authority for narrative graphs. The MCP service validates transport limits and keeps idempotency receipts, but it does not maintain a second authoritative story store. A graph lives in the Rust `MachineSession`; it is durable across restarts when the engine is configured with its optional single-writer state file, and otherwise lives only for the Rust process lifetime.

The layer supports complete revisions and additive atomic batches:

- Registration accepts one complete revision-zero `life-sim-rust-narrative-graph/v1` definition.
- Revision accepts one complete immutable successor whose `previous_graph_hash` names the earlier revision and whose revision number increments by one.
- Additive batching accepts one or many new roots, nodes, and edges. Rust constructs the complete immutable successor automatically; it never mutates the earlier graph.
- Rust normalizes, hashes, and validates the entire node/edge set, structural ordering, access metadata, anchors, and exact source before inserting it. Earlier revisions remain addressable.
- The session mutation, including state-file persistence when configured, uses the same atomic checkpoint/rollback boundary as other Rust mutations.

The complete graph remains the initial authoring unit because text, story order, reflection, semantic links, and model state arrive as one coherent context. Later work may use a smaller additive transaction. A batch may contain exactly one node, but on a nonempty graph every newly added node component must connect in that same batch to an existing narrative node or a validated stable anchor. The first graph may instead begin with one declared root. This preserves the useful one-call topology behavior without forcing callers to resend the whole graph, prevents disconnected islands, and ensures readers never observe a half-written transaction. The engine does not itself claim or measure a training-quality improvement.

Complete registration and revision enforce the corresponding global invariant: every node component must reach a declared root or a validated external anchor. Full revision remains the route for replacement, deletion, reordering, or changing the source binding.

## Graph contents

`NarrativeNode.role` provides the stable cross-domain contract:

- `document_root`
- `story_passage`
- `character_interior`
- `externalized_reflection`
- `reader_response`
- `metadata`

`node_type` and `epistemic_status` are intentionally open vocabularies. Nodes also carry evidence type, uncertainty, holder/subject/estimator, time and evidence-cutoff metadata, provenance, authority, access scopes, and independent `render` and `training` inclusion policies. Both policies default to `exclude`. A node with nonempty text must have provenance and authority.

Story passages are canonical artifact units: the authoritative prose is the `text` stored in those Rust-owned nodes. An `externalized_reflection` is deliberately authored testimony about the work, not hidden model chain-of-thought. Rust requires it to have a holder and at least one access scope, and rejects any attempt to mark it for story rendering. It may be training-eligible only when explicitly marked and requested through an allowed scope.

Edges use the families `structural`, `grounding`, `semantic`, `provenance`, and `revision`, plus a specific open-vocabulary relation and required provenance. `contains` and `next` are the structural relations: they must connect narrative nodes, structural cycles are rejected, and `contains` siblings require unique order values. The generic relation `relates` is rejected.

## Stable model anchors

An edge endpoint may be another narrative node or a typed anchor:

```json
{
  "kind": "anchor",
  "anchor_kind": "process",
  "anchor_id": "mara.trust",
  "path": "/value_type/kind"
}
```

The supported anchor kinds cover stable model objects (`model`, `process`,
`decomposition`, `dependency`, `law`, and `claim`), Meaning Model objects
(`concept`, `abstract_relation`, `abstract_cut`, `referent`,
`encapsulation_cut`, `event`, `event_relation`, `event_referent_binding`,
`physical_cut`, and `realization`), and source-bound runtime objects (`world`,
`candidate`, and `occurrence`).

`anchor_id` identifies the stable object. Optional `path` is an RFC 6901 JSON Pointer relative to that object's serialized representation. Rust resolves the object and pointer against the exact bound model/source snapshot during registration, so an unknown object, stale branch object, or nonexistent nested field rejects the whole batch. Candidate anchor material is frozen because a candidate's retained trajectory can later become richer under the same canonical hash. An edge to a scoped process or claim must carry the required endpoint scopes, and projection checks both the edge and each scoped endpoint; adding a second broad edge scope cannot expose a private anchor.

These links are descriptive grounding. They do not become executable causal laws or mutate simulation state.

## Exact source snapshots

Every graph revision binds to exactly one source:

- `model`: the exact model hash, initial process values, and initial claims;
- `world`: an exact world ID and world hash, including its version, time, state, claims, and source occurrences;
- `candidate`: an exact candidate hash, status, proposed world version/end time, successor state, successor claims, and occurrence marks.

Rust stores this frozen source alongside the graph and returns separate `graph_hash` and `source_snapshot_hash` identities. Both are revalidated when a durable session is restored. A later world-head advance therefore cannot silently change the text/state pairing represented by an older graph revision.

## Granular reads

Every stored revision is a complete graph, while reads are deliberately granular:

- `full` returns all nodes and edges visible to the supplied scopes. Node text is included only when `includeContent` is true.
- `skeleton` returns visible roots, relation counts, and visible graph counts without node text.
- `neighborhood` performs a bounded `ancestors`, `descendants`, or `both` traversal around one visible narrative node. Incident crossing edges and their visible boundary nodes are retained and boundary nodes are marked.

All reads address an exact graph hash and may also provide `expectedGraphHash` for stale-read detection. Each projection includes the safe graph/source summary, including revision lineage and frozen source status. Scope filtering removes inaccessible nodes and their incident edges before traversal or counting.

## Rendering is a projection

Rendering never creates a second story authority. It starts from the requested roots, or the graph's roots by default, visits visible `contains` children in deterministic order, and follows `next` successors only when the current node has no `contains` children. It emits only nodes whose `render` policy is `include`. Externalized reflections cannot enter that sequence.

The result contains the contributing node sequence, per-unit content hashes, text joined with a blank line, a projection hash, the graph and source-snapshot hashes, and an explicit `world_authority: "unchanged"` marker. Editing a rendered document outside the graph does not revise the canonical story.

## Training export

Training export is a deterministic, read-only projection. It selects explicitly named training-eligible nodes, or all visible nodes marked `training: "include"`, then emits records containing exact text and text hash, graph/source identity, narrative order, epistemic metadata, visible incident links, and optionally directly linked visible process values from the frozen snapshot. The response labels three single-snapshot uses: joint alignment, inverse reading, and rendering. It explicitly marks causal chronology as unestablished.

`requireAcceptedHistory: true` rejects model-initial and noncommitted candidate sources; world sources and committed candidates satisfy it. Export does not train, fine-tune, evaluate, upload, or write a dataset.

## MCP tools

| MCP tool | Rust operation | Effect |
| --- | --- | --- |
| `life_narrative_register` | `register_narrative_graph` | Atomically register a complete revision-zero graph. |
| `life_narrative_revise` | `revise_narrative_graph` | Atomically register a complete immutable successor. |
| `life_narrative_batch` | `apply_narrative_batch` | Add one or many connected roots, nodes, and edges as one immutable successor. |
| `life_narrative_query` | `query_narrative_graph` | Read a full, skeleton, or neighborhood projection. |
| `life_narrative_render` | `render_narrative_graph` | Derive ordered story text from canonical nodes. |
| `life_narrative_training_export` | `export_narrative_training` | Derive aligned text/state training records. |

The three mutations require request IDs and are idempotent. The other three tools are read-only and idempotent.

## Access boundary

Access scopes are projection labels, not authentication or confidentiality. The current MCP caller supplies them; neither MCP nor Rust establishes a principal, proves entitlement to a scope, encrypts private text, or prevents an already-authorized caller from copying returned content. Production integration must authenticate outside this service and derive scopes from that identity rather than accepting arbitrary caller claims.

## Current limitations

- Additive batches cannot replace or remove existing nodes, edges, or roots. There is no delete, archive, diff, merge, dedicated validate, list, or implicit-latest operation. Full immutable revision supports replacement and reordering; callers retain exact graph hashes and multiple successor branches are possible.
- Revision validation preserves the graph ID and revision sequence but does not currently require a successor to keep the same source binding.
- Candidate sources may be pending, rejected, or superseded. Accepted-history enforcement is opt-in on training export and is not applied to registration, query, or rendering.
- Narrative links do not affect simulation dynamics, and existing writer-planning/story-diagnostic tools are not automatically synchronized with these graphs.
- Full views include anchor-to-anchor edges. Neighborhood traversal is centered on narrative nodes and does not traverse through anchor-only relations; use a full view when those relations are required.
- General anchor objects are validated and remain addressable as edge endpoints, but training export currently materializes linked values only for directly linked process anchors, not every anchor kind or JSON-pointer subvalue.
- Training export aligns selected text with one frozen source snapshot. It does not yet prove that a linked value predates each node's evidence cutoff; downstream chronological training must apply a causal mask or use separately time-bound snapshots.
- Rendering is plain text with one blank line between included units; it has no formatting/layout model.
- The engine does not infer a graph, generate prose, establish that a model understands it, or evaluate literary quality. It exports aligned records but performs no model training or dataset management.
- MCP currently exposes `narrativeGraph` as an opaque object rather than a fully expanded discoverable input schema; callers need this contract or the Rust schema when constructing a batch.
- Durability requires the optional Rust state file. Persistence is single-writer; there is no multi-process coordination or at-rest encryption.
- MCP limits one submitted graph to 8 MiB. Rust additionally limits a graph to 50,000 nodes, 200,000 edges, 1,024 roots, and 1 MiB of text per node, with at most 512 stored narrative graph revisions and 64 MiB of narrative data per session.
