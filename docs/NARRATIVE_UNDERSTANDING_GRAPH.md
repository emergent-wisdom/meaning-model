# Narrative Understanding Graph

The Narrative Understanding Graph is an optional Rust-native layer for keeping story text, explicit reflections, and their links to the simulation in one graph. Nothing creates or requires this layer during normal model, world, or candidate operations.

## Authority and mutation model

Rust is the single authority for narrative graphs. The MCP service validates transport limits and keeps idempotency receipts, but it does not maintain a second authoritative story store. A graph lives in the Rust `MachineSession`; it is durable across restarts when the engine is configured with its optional single-writer state file, and otherwise lives only for the Rust process lifetime.

The layer supports complete revisions, additive atomic batches, and local edit
operations:

- Registration accepts one complete revision-zero `life-sim-rust-narrative-graph/v1` definition.
- Revision accepts one complete immutable successor whose `previous_graph_hash` names the earlier revision and whose revision number increments by one.
- Additive batching accepts one or many new roots, nodes, and edges. Rust constructs the complete immutable successor automatically; it never mutates the earlier graph.
- `life_narrative_edit` applies an explicit operation list to a complete graph
  read and submits one immutable successor through the existing Rust revision
  operation. It does not create another store or require the storytelling add-on.
- Rust normalizes, hashes, and validates the entire node/edge set, structural ordering, access metadata, anchors, and exact source before inserting it. Earlier revisions remain addressable.
- The session mutation, including state-file persistence when configured, uses the same atomic checkpoint/rollback boundary as other Rust mutations.

The complete graph remains the initial authoring unit because text, story order, reflection, semantic links, and model state arrive as one coherent context. Later work may use a smaller additive transaction or local edit list. A batch may contain exactly one node, but on a nonempty graph every newly added node component must connect in that same batch to an existing narrative node or a validated stable anchor. The first graph may instead begin with one declared root. This preserves the useful one-call topology behavior without forcing callers to resend the whole graph, prevents disconnected islands, and ensures readers never observe a half-written transaction. The engine does not itself claim or measure a training-quality improvement.

Complete registration and revision enforce the corresponding global invariant: every node component must reach a declared root or a validated external anchor. Full revision remains available for arbitrary replacement, deletion, or changing the source binding; the local edit tool constructs that same kind of successor for its supported operations.

## Graph contents

`NarrativeNode.role` provides the stable cross-domain contract:

- `document_root`
- `story_passage`
- `character_interior`
- `externalized_reflection`
- `reader_response`
- `metadata`

`node_type` and `epistemic_status` are intentionally open vocabularies. Nodes also carry evidence type, uncertainty, holder/subject/estimator, time and evidence-cutoff metadata, provenance, authority, access scopes, and independent `render` and `training` inclusion policies. Both policies default to `exclude`. A node with nonempty text must have provenance and authority.

Any record a character may later be shown knowing needs an `evidence_cutoff`; the storytelling scene checks refuse undated sources as viewpoint knowledge. Standing canon without a cutoff remains reader-facing.

Story passages are canonical artifact units: the authoritative prose is the `text` stored in those Rust-owned nodes. An `externalized_reflection` is deliberately authored testimony about the work, not hidden model chain-of-thought. Rust requires it to have a holder and at least one access scope, and rejects any attempt to mark it for story rendering. It may be training-eligible only when explicitly marked and requested through an allowed scope.

Choose units that can usefully change independently: a passage, an event
description, or an explanatory note can have its own identity and links within
a larger container. A paragraph can be a useful passage, but there is no
required subdivision count or word quota. Keep enough context to understand
each unit's relationships. Rendered files remain projections of this source
text, not a second place to maintain it.

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
`physical_cut`, `realization`, and `normalized_cut`), and source-bound runtime
objects (`world`, `candidate`, and `occurrence`). A `normalized_cut` anchor with
the path `/answers/0` addresses one answer of that Cut.

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

## Local graph editing

`life_narrative_edit` is available with or without the storytelling add-on.
Supply `requestId`, the exact `graphHash`, `accessScopes`, a nonempty `reason`,
and an ordered `operations` list. Each operation sees the results of earlier
operations in that list. The tool preserves the source binding, its exact frozen
snapshot, and untouched records, then submits the final graph as one atomic Rust revision. A failed
operation or Rust validation rejects the whole transaction; previous revisions
remain addressable.

| Operation | Fields and behavior |
| --- | --- |
| `split` | `nodeId`, `parts: [{id, text, title?}]`. Split a text leaf into at least two fresh children. Their text joined with `"\n\n"` must exactly equal the original. |
| `merge` | `nodeIds`, `mergedNodeId`, optional `title`. Combine at least two consecutive compatible leaf siblings into one fresh text node. |
| `move` | `nodeId`, `parentNodeId`, `index`. Move a node and its subtree to the requested child position, counted after removal from its old position, while preserving their identities. |
| `reorder` | `parentNodeId`, `nodeIds`. Supply every immediate child exactly once in the desired order. |
| `replace_text` | `nodeId`, `expectedText`, `text`. Replace text only when the existing text exactly matches `expectedText`. |

Every operation includes its name as `kind`. Splitting keeps the original node
as a nonrendered container and preserves its semantic and model links. The
children inherit its metadata and receive `split_from` lineage links. An
outgoing `next` edge moves to the last new child so rendering can continue.
Merging requires matching roles, scopes, authority, timing, evidence, and
render/training policies, and joins the selected texts with a blank line.
Its placement metadata must also match. The combined text is restricted by
the source nodes, their placements and their parent, so a private ordering is not
exposed through a public merged node; incompatible audiences are rejected.
It retains the original IDs, texts, and nonstructural links as history nodes
excluded from rendering and training, with `merged_from` lineage. The merged
passage remains a leaf that can be split or merged again. Merge and reorder reject incident `next`
links and a parent with outgoing `next` links. Move rejects shared-parent or
crossing-`next` arrangements, and parents with outgoing `next` links, whose
intended placement is ambiguous. Use an explicit full revision for unsupported
topology changes.

The tool requires a complete graph read: visible node, edge, and root counts
must match the whole graph. It refuses to construct a successor from a partial
scope projection, which would drop hidden records. Supply the scopes needed
for the entire selected graph; access remains the projection boundary described
below. The receipt includes `changedNodeIds`, `changedEdgeIds`,
`affectedNodeIds`, and `affectedReviewNodeIds`, with review-refresh guidance.
`directlyAffectedReviewNodeIds` lists reviews linked to the changed nodes
themselves; `ancestorReviewNodeIds` lists reviews linked only to their
containers, such as whole-document assessments, which need a lighter check.

These operations preserve structure and provenance, but do not reinterpret
semantic links or establish that changed text still supports them. Inspect
the affected meaning and evidence after an edit. A review of earlier text or
order remains a historical assessment; refresh affected reviews against the
new rendered result. Neither an edit receipt nor retained review links certify
the revised content. Raw registration, complete revision, and additive batch
tools remain available.

## Training export

Training export is a deterministic, read-only projection. It selects explicitly named training-eligible nodes, or all visible nodes marked `training: "include"`, then emits records containing exact text and text hash, graph/source identity, narrative order, epistemic metadata, visible incident links, and optionally directly linked visible process values from the frozen snapshot. The response labels three single-snapshot uses: joint alignment, inverse reading, and rendering. It explicitly marks causal chronology as unestablished.

`requireAcceptedHistory: true` rejects model-initial and noncommitted candidate sources; world sources and committed candidates satisfy it. Export does not train, fine-tune, evaluate, upload, or write a dataset.

## The construction record

The model and its Understanding Graph are the modeler's understanding, not a report
about it. What is done and not recorded cannot be picked up by a later agent, and a
thought that is not linked to what it concerns is lost. The workflows therefore keep
four practices.

- **Descriptions give numbers meaning.** Every Event that parents a Cut carries a
  `description` of what happens in it, and most other Events do too. Model
  registration and revision return `descriptionCoverage`, listing Cut-bearing Events
  without one; `requireDescribedNumbers` refuses them. The ingest refuses to place a
  Cut on an undescribed Event before asking for any estimate, the Cut-share tool
  records the situation text it judged as the description, and story scene
  preparation blocks commits until the numbers are described.
- **Thoughts are linked to their subjects.** `life_understanding_record` stores
  choices, ideas, predictions, questions, voice and phrasing decisions, references
  and their reasons as Understanding Nodes held by a named holder, each linked to the
  model records (`event:`, `cut:`, `process:` and the other kinds, optionally with a
  path) or nodes it concerns. A note must be about something. Each note records the
  graph revision and model revision it was written against. Story notes use
  `life_story_author_record`, which takes the same `about` targets.
- **Reviews are held by their reviewers.** `life_review_record` records a review from
  another model, a blind reader, an estimator or a person under that reviewer, with
  what it was given, how independent it was, the exact graph revision and a hash of
  the text it read, the prompt, its verdict and findings. A later change that answers
  it links to it with `answers`.
- **The construction can be read back.** `life_model_outline` shows the present
  state: description coverage, Things, the Event tree with descriptions and the Cuts
  under each Event, processes, concepts, understanding roots and documents, with the
  linked notes at the depth asked for (none, count, first line or full).
  `life_construction_replay` walks the graph revisions from the first: each step's
  reason, the model revisions it adopted and what they changed, and the notes,
  reviews and prose it added. Each note appears beside the records it concerned as
  they were at that step. It has three levels (outline, reasoning, full), pages with
  offset and limit, and can focus on records or nodes. An agent continuing existing
  work replays it first. In both views a review leads with its verdict, and a note
  linked to several records is shown once and named at the later ones.
- **The construction travels.** `life_construction_export` writes a portable
  history of a model-bound graph: every model revision it was bound to with their
  ancestors, the first graph revision in full and each later revision as its change,
  with a bundle hash. `life_construction_import` rebuilds it on another engine and
  checks that every rebuilt model and graph hash equals the exported one, so the
  replay there is the same replay. A step that only added records goes in as an
  additive batch and any other as a revision by change, so the import keeps only
  each change in its receipts.

Batch related notes into one call (up to 32): every recording call creates one graph
revision, and a session keeps at most 4,096.

## MCP tools

| MCP tool | Rust operation | Effect |
| --- | --- | --- |
| `life_narrative_register` | `register_narrative_graph` | Atomically register a complete revision-zero graph. |
| `life_narrative_revise` | `revise_narrative_graph` | Atomically register a complete immutable successor. |
| `life_narrative_batch` | `apply_narrative_batch` | Add one or many connected roots, nodes, and edges as one immutable successor. |
| `life_narrative_edit` | `query_narrative_graph`, then `revise_narrative_graph_by_change` | Apply split, merge, move, reorder, or guarded text replacement as one immutable successor, sent and stored as its change. |
| `life_narrative_query` | `query_narrative_graph` | Read a full, skeleton, or neighborhood projection; `forRevision` returns a full content projection stripped to the fields revise accepts. |
| `life_narrative_render` | `render_narrative_graph` | Derive ordered story text from canonical nodes. |
| `life_narrative_training_export` | `export_narrative_training` | Derive aligned text/state training records. |
| `life_narrative_rebind` | `query_narrative_graph`, then `revise_narrative_graph_by_change` | Rebind a model-bound graph to a successor model as one complete successor, keeping every node and dropping only predecessor model anchors; sent and stored as its change. |
| `life_narrative_alignment_audit` | `render_narrative_graph`, then `query_narrative_graph` | Read-only: generate narrated/contradicted/leaked questions from the graph's records for a rendered unit, per passage and whole; optionally scored by the configured external estimator. |
| `life_direction_draw` | `inspect_model`, then `query_narrative_graph` and `apply_narrative_batch` when recording | Compute a seeded draw over a model's normalized Cut; optionally record it in a graph bound to that model, linking earlier draws over the same Cut as rerolls. |
| `life_understanding_record` | `query_narrative_graph`, `get_model`, then `apply_narrative_batch` | Record held Understanding Nodes linked to model records and nodes, as one immutable successor. |
| `life_review_record` | `query_narrative_graph`, `render_narrative_graph`, then `apply_narrative_batch` | Record a review under its actual reviewer, with the revision and text hash it read. |
| `life_model_outline` | `get_model`, `query_narrative_graph` | Read-only: the present state as an outline, with linked notes at a chosen depth. |
| `life_construction_replay` | `list_narrative_revisions`, `query_narrative_graph`, `get_model` | Read-only: replay the graph and model revisions from the first, with each step's reasons, changes and notes. |
| `life_construction_export` | `list_narrative_revisions`, `query_narrative_graph`, `get_model` | Read-only: export the whole construction as a portable history with a bundle hash. |
| `life_construction_import` | `register_model`, `revise_model`, `register_narrative_graph`, `apply_narrative_batch`, `revise_narrative_graph_by_change` | Rebuild an exported history, checking every model and graph hash. |

The mutations require request IDs and are idempotent. A rebind, an edit and an
imported revision are sent as their change: Rust's `revise_narrative_graph_by_change`
applies the upserts and removals to the stored predecessor, refuses a caller whose
scopes hide any of it, and validates the successor as a complete revision. Neither
the call nor the idempotency receipt carries the whole graph, so the service's
64 MiB receipt budget lasts through long sessions on large graphs. A caller that
sends `life_narrative_revise` a complete definition still retains that definition
in the receipt. The query, render, outline, replay and export tools are read-only; the alignment audit is read-only unless `record` is supplied, and it contacts an external service only when `MEANING_MODEL_ESTIMATOR` is set.

## Access boundary

Access scopes are projection labels, not authentication or confidentiality. The current MCP caller supplies them; neither MCP nor Rust establishes a principal, proves entitlement to a scope, encrypts private text, or prevents an already-authorized caller from copying returned content. Production integration must authenticate outside this service and derive scopes from that identity rather than accepting arbitrary caller claims.

## Current limitations

- Additive batches cannot replace or remove existing nodes, edges, or roots.
  Local editing supports the bounded operations above, including node merge;
  there is no dedicated delete, archive, branch-merge, validate, or
  implicit-latest MCP tool. `life_construction_replay` reads the revision
  lineage of one head through Rust's `list_narrative_revisions`, and reports other
  heads and branch points without replaying them.
  Callers retain exact graph hashes and multiple successor branches are possible.
- Rust keeps every revision materialized with unchanged records shared with its
  parent, so reading any revision takes about a millisecond on a 1.8 MB graph and
  writing costs about the size of the change plus one compile of the successor.
  Restart validates every revision, which is linear in their number (about 0.7 s
  for a 147-revision story). A session keeps at most 4,096 revisions.
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
- MCP limits one submitted graph to 8 MiB. Rust additionally limits a graph to 50,000 nodes, 200,000 edges, 1,024 roots, and 1 MiB of text per node, with at most 4,096 stored narrative graph revisions and 64 MiB of narrative data per session.
