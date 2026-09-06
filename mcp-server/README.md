# Meaning Model MCP server

`@emergent-wisdom/meaning-model-mcp` is the stdio interface and control plane for the
authoritative Rust machine in the Meaning Model repository. It is not a second simulation
engine. A single long-lived `life-sim-engine --ndjson` process validates and
hashes typed models, owns accepted world heads and candidate lineage, performs
every transition and reroll, and commits one complete candidate atomically.
The Node layer supplies MCP schemas, quotas, opaque handles, bounded views,
annotations, and writer-planning policy. It never silently executes a
JavaScript simulation when Rust is unavailable.

The `life-sim-engine` binary, `LIFE_SIM_ENGINE_BIN` override,
`life_*` tools, `life-sim://` resource URIs, and serialized schema identifiers
retain their existing names for compatibility.

The built-in `north-harbor/12` and `north-harbor/48` profiles are conveniences,
not the product boundary. They are immutable precompiled Rust model definitions
whose extraction identity is checked in
[`resources/presets/SOURCE.json`](resources/presets/SOURCE.json). The former
JavaScript simulator is neither a runtime dependency nor part of this release.

## Optional expressiveness

The invariant is that the smallest useful machine remains a set of typed
process values changing through time under declared laws. Everything else is
an optional articulation of that same machine. A caller may use no Meaning
Model records, no Decision profile, no causal-graph projection, no candidate
routing, and no writer or revision-diagnostic layer. Enabling one of those
layers does not create a second world, simulation engine, or source of canon:

- Meaning Model records add semantic identity, reference, and grounding;
- Story, Person, and Decision profiles compile reusable authoring conventions
  into ordinary processes, laws, edges, and claims;
- graph queries derive navigable views from the registered Rust model and a
  selected model, world, or candidate snapshot;
- narrative/understanding graphs optionally make story passages and explicit
  testimony canonical, snapshot-bound Rust records whose edges can address
  stable model objects and nested subpaths;
- candidate routing compares already rolled alternatives without accepting
  one;
- writer contracts constrain a projection of committed history; and
- story-revision diagnosis localizes a cited problem without changing any
  model, trajectory, or prose.

This permits progressive addition of detail without requiring every domain to
pay for every representational layer.

## Tools

### Paper-grounded modeling entry

The server exposes the canonical Meaning Model paper source at
[`paper/meaning-model.tex`](../paper/meaning-model.tex) and the frozen Life
Simulation companion paper source at
[`docs/companions/life-simulation/life-simulation.tex`](../docs/companions/life-simulation/life-simulation.tex)
as MCP resources, followed by the operational
[`MODELING_PROTOCOL.md`](../docs/MODELING_PROTOCOL.md), Story and Person profiles,
the Decision compilation convention, the optional
[`Narrative Understanding Graph`](../docs/NARRATIVE_UNDERSTANDING_GRAPH.md)
protocol, and checked examples.
`life_modeling_context` returns their SHA-256 digests and
an ordered reading contract for creative story, source reconstruction,
person-reflection, observation, forecasting, or counterfactual work. The
`life_modeling_start` MCP prompt provides the same paper-first entry point.

The Life Simulation snapshot is bound to its source file digests in
[`SOURCE.json`](../docs/companions/life-simulation/SOURCE.json); its canonical
manuscript remains in the separate Life Simulation repository. Run
`node scripts/verify-resources.mjs` from the Meaning Model repository root to
check the companion snapshot, precompiled presets, and resource availability.

First use, a changed theory version, a new domain, or consequential real-person
work requires reading the complete papers before using the short protocol. The
live MCP process records access to both theory resources and refuses profile
compilation until both have been accessed. Same-domain repeat work in that process
may reuse the access record, but caller-supplied digests never satisfy the gate
and the record is lost on restart. Resource access is not evidence that an
agent understood the papers, and the server does not claim to verify
comprehension.

The protocol deliberately does not hardcode an interview. The intelligent
agent selects questions and interpretations; the server preserves model,
claim, viewpoint, revision, candidate, and persistence boundaries. Sampled
values can be submitted as data-only provisional claims. A generating function
requires a separately reviewed complete successor model and explicit
registration.

The model tools expose immutable typed profiles:

- `life_profile_compile`, after the paper-access gate is satisfied, asks Rust
  to compile one or more optional Story, Person, Decision, `concept_scaffold`,
  `change_arc_scaffold`, `person_scaffold`, `thing_scaffold`, or
  `relationship_scaffold` authoring profiles
  into one ordinary complete revision-0
  `ModelDefinition`. It is read-only: the returned model is neither registered
  nor persisted until a caller separately invokes `life_model_register`.
  Person compilation preserves one shared evidence history, one external
  description, one or more candidate actor-local views, and one self-reported
  view; none may claim access to latent operative truth.
  `person_scaffold` is the simpler construction template. Level `lifecycle`
  loads only one Thing and its complete coarse life Event. Level `processes`
  also loads the nine concurrent `IS` process addresses and, when requested,
  a health-condition Cut beneath `body`. The process addresses carry no
  default semantic numbers; a separately named Cut must supply a comparison
  question and unit. WHAT, HOW, FEELS, periods, episodes, and scenes remain
  unopened.
  `thing_scaffold` loads any other Thing and its lifecycle;
  `relationship_scaffold` loads one joint Event between two Things;
  `concept_scaffold` loads a shallow definition; and `change_arc_scaffold`
  loads an invention or paradigm shift with optional anticipation, focal
  change, and adaptation Events. These are structural and unweighted by
  default.
  Decision compilation turns authored wants, fears or drives, perceived
  options, habits, impulses, and deliberative weights into explicit attraction,
  avoidance, commitment, feedback, and occurrence state. It remains optional
  and hypothetical. Options are independent by default, so mutual exclusion or
  winner selection must be supplied as an additional ordinary law when the
  domain requires it.
- `life_model_validate` validates and hashes a complete model without storing
  it.
- `life_model_register` validates and stores a complete revision-0 model.
- `life_model_inspect` returns a model summary and, when requested, its bounded
  complete definition.
- `life_model_revise` stores a complete hash-linked successor revision. Adding
  a dimension or law is an atomic schema revision, never an in-place patch.
- `life_meaning_query` pages authored records from an optional Meaning Model
  layer by collection and exact id without returning the full model.
- `life_world_refine_genesis` applies an already registered direct-next
  revision to one untouched genesis world, but only when the revision preserves
  every existing model record and makes at most monotonic authored additions.
- `life_world_revise` applies a registered direct-next model at an exact accepted
  world hash, including after history has begun. `refine` preserves prior commitments;
  `revise` permits explicit compatible changes. Both retain an immutable receipt,
  require a reason and provenance, and require current values for new processes.
- `life_world_revision_inspect` reads that receipt by hash, with explicit state
  projection. Empty requested observables return no state values.

## Optional Meaning Model layer

A model may opt in with a nested
`meaning_model: { schema: "life-sim-rust-meaning-model/v1", ... }` block. Models
without that block keep their existing representation and behavior. The block
stores thirteen collections within the bounded nested layer: `concepts`,
`abstract_relations`, `abstract_cuts`, `referents`, `encapsulation_cuts`,
`events`, `event_relations`, `event_referent_bindings`, `physical_cuts`, and
`realizations`, `normalized_cuts`, `context_roots`, and
`temporal_cut_recompositions`. The last three provide sibling-relative weights
with explicit remainder, typed perspective roots, and opt-in duration-weighted
recomposition contracts. Complete partitions must reproduce their parent Cut;
partial partitions must leave a feasible nonnegative residual. Referents give bounded entities stable authored identities,
encapsulation cuts record their optional parent/child organization, and event-referent bindings
record optional typed participation by targeting either a semantic event or an
executable state-bearing process. None of those collections is a prerequisite
for ordinary event/process modeling. Physical cuts distinguish parallel from
sequential decomposition, and realization records retain the `define` versus
`describe` purpose, role bindings, parameters, degree, uncertainty,
  provenance, viewpoint, and optional authority. Events refer to the existing
process ids; their records add explicit boundaries, optional intervals,
observation-process membership, participants, substrate, and region. Processes
and laws remain the one physical execution substrate.

Event relations are read-only authored causal claims between declared events.
They use `causes`, `enables`, `prevents`, `constrains`, or an explicitly
described `other` kind and retain uncertainty, provenance, and optional
authority. They neither prove causal chronology nor create executable laws.
The collection is omitted by Rust when empty, preserving pre-extension model
hashes when no event relations are supplied.

`life_meaning_query` is a read-only projection over the complete definition
returned by the Rust model store. It supports exact-id filtering and stable
offset pagination because a `modelHash` names an immutable revision. A page is
limited to 250 definitions and 512 KiB of encoded definition data; at most 256
ids and 50,000 total Meaning Model records are accepted by this MCP control
plane. The response reports whether the layer is enabled, per-collection
counts, truncation, and the next offset. It preserves Rust-stored canonical
collection order and the meaningful child-event order of sequential cuts.

The query surface exposes static administrative semantic data. It does not
infer realization or referent links, expand or aggregate cuts, discover
concepts, or execute or apply any Meaning Model collection in Node. The
separate `life_world_refine_genesis` tool exposes one deliberately narrow Rust
lifecycle operation: an authored successor revision may replace a world only
at version 0, time 0, with no accepted lineage, and only when every old process,
edge, law, initial claim, and Meaning Model record remains exact. The target
must already be registered and directly linked to the current revision. This
is not automatic discovery, adaptive cut opening, or migration after history
has begun.

For explicit post-history authoring, use `life_world_revise` instead. The model
identity, time unit, and existing process shapes/units must remain compatible.
Refinement preserves existing state and records, allowing new detail and a
compatible partial temporal partition to be completed. Revision may change
existing values or descriptions explicitly; neither mode resets the world to
the new model's genesis. Old candidates cannot commit against the revised head,
and existing narrative graphs remain bound to their old snapshots. Portable
project/checkpoint exports and accepted-history training exports spanning a
world revision currently return `unsupported_history`; SQLite persistence and
continued world construction are supported. See the
[progressive authoring example](../examples/progressive-authoring/README.md).

## Provider-neutral estimation exchange

Four tools let an intelligent AI estimate state or propose a richer model
without becoming a second simulation authority:

- `life_estimation_request_create` freezes an immutable request against one
  model hash, model revision, accepted world-head hash/version/time, evidence
  cutoff, and Rust-enforced coordinate projection. It distinguishes
  `assimilate`, `estimate`, `predict`, `infer`, `counterfactual`, and `simulate`,
  and keeps `reality` separate from `creative` intent.
- `life_estimation_response_submit` requires exactly one `known`, `unknown`, or
  `unmodeled` disposition for every coordinate. A known result requires one
  typed provisional Rust claim with uncertainty, evidence kind and cutoff,
  provenance, holder, authority, and access scopes. Outputs additionally say
  whether they are `observed`, `estimated`, `simulated`, or `derived` and carry
  the exact time of the value. A data-only response does not need to invent a
  successor model revision.
- `life_estimation_proposal_inspect` reads the resulting immutable proposal and
  can administratively return its complete proposed model when the proposal
  contains one.
- `life_estimation_proposal_review` records an explicit review and rejects
  approval when the bound world head is stale. For proposals containing a
  model, it revalidates that model in Rust and names `life_model_revise` as a
  separate explicit registration step. A data-only proposal has no model
  registration step. If the approved response contains observed outputs, the
  review also returns an exact Rust observation query fragment; it does not
  execute that fragment.

The response may contain only provisional claims, or it may additionally
propose explicitly declared additions, replacements, or removals in any
Meaning Model collection. When `semanticChanges` is empty, `proposedModel` and
`proposalReason` may be omitted. A nonempty `semanticChanges` list requires
both: every change must exactly match the complete successor
`ModelDefinition`, and undeclared semantic changes are rejected. That proposed
model must be the next hash-linked revision, preserve model identity, time
unit, and genesis claims, and pass Rust's `validate_model`. A supplied model is
not accepted without a reason. Submission and review never call
`register_model`, `revise_model`, or a world transition.

Observed or reported accepted-head claims are never silently overwritten. A
conflicting provisional claim must name every stronger conflict explicitly;
both remain visible and the response records `overwritePerformed: false`.
Reality requests reject fictional evidence types and every evidence cutoff must
be no later than the request cutoff. A cutoff before the accepted-head time is
rejected because Rust does not retain a historical state-and-evidence
projection for this exchange. Operations other than `assimilate` use the
accepted-head cutoff. `assimilate` may declare later external evidence, but its
Rust projection remains the explicitly bound accepted head; the external
evidence must therefore be present in the bounded request context or provider
input rather than silently borrowed from a later world projection.

An AI may return a time-stamped output for a process whose `update_mode` is
`observed` without inventing a transition law. Rust now accepts such values as
typed `ModelTransitionSpec.observations`: each value must have observation or
report evidence, exact process type, unit and scopes, and a strictly positive
forward offset from the frozen parent. On approval, MCP maps every observed
claim into that exact provider-neutral fragment with
`offset = valueTime - acceptedHeadTime`.

The caller still chooses `delta_time`, `step_size`, path retention, seed, and
request id. The chosen numerical grid must make every observation offset an
exact reachable step boundary. The caller then invokes `life_candidate_roll`,
inspects the resulting pending candidate, and separately invokes
`life_candidate_accept`. Only acceptance makes the values canonical. The
accepted candidate carries observed state, claims, marks, path, and lineage;
Rust state-file mode makes the accepted world durable. Submission and review
perform none of those mutations.

This forward transition is not a zero-time or historical append API. An
observed value at or before the accepted-head time remains a valid provisional
record but produces a blocked materialization plan, because excluding it from a
partial query would silently change the approved proposal. Estimation requests,
proposals, reviews, and their raw values remain bounded process-local
control-plane records until a returned forward plan is explicitly rolled and
committed.

The state-machine tools are:

- `life_engine_status`
- `life_world_create`
- `life_world_refine_genesis`
- `life_world_inspect`
- `life_view_query`
- `life_graph_query`
- `life_narrative_register`
- `life_narrative_revise`
- `life_narrative_batch`
- `life_narrative_query`
- `life_narrative_render`
- `life_narrative_training_export`
- `life_candidate_roll`
- `life_candidate_reroll`
- `life_candidate_reject`
- `life_candidate_observe`
- `life_candidate_compare`
- `life_trajectory_query`
- `life_trajectory_summarize`
- `life_candidate_annotate`
- `life_candidate_accept`

`roll` creates a complete pending Rust candidate without changing the accepted
world. `reroll` replaces that whole roll from the same frozen parent and fixed
query, increments `roll_index`, and marks the source superseded. Use two
independent rolls when both alternatives must remain pending. Superseded and
rejected candidates remain inspectable, but only a pending candidate can be
committed. `accept` delegates the compare-and-swap and whole-head replacement
to Rust; pending siblings from the same parent become superseded.

`life_view_query` asks Rust for an explicit world or candidate projection.
Requested process ids are checked against their model-declared access scopes;
an empty observable list returns metadata and no state. The supplied scopes are
an access context, not authentication. A production host must derive them from
an authenticated principal rather than accepting arbitrary caller assertions.
Global candidate/world hashes and aggregate activity counts remain visible.
`life_model_inspect` is an administrative surface that can return complete
definitions and initial values, and `life_meaning_query` is an administrative
semantic-data surface that can return definitions, provenance, authority, and
viewpoints. It does not execute those records. The current view mechanism is
therefore value projection, not a complete confidentiality or traffic-analysis
boundary.

`life_graph_query` is a separate read-only navigation surface over the causal
factor graph derived by Rust. It does not add graph state to Node and is not a
replacement for the optional Meaning Model collections. Process and law nodes
are connected by expression-derived `reads`, direct `writes`, occurrence
`activates`, authored `decomposition`, and declared-dependency edges. A source
is exactly one immutable model revision, accepted world head, or complete
candidate. Three modes support resolution-aware use:

- `skeleton` returns whole-graph counts, edge-kind counts, decomposition roots,
  and high-degree hubs without returning node or edge payloads;
- `neighborhood` traverses from a process or law in the requested direction and
  depth, then includes every edge incident to the selected core and both of its
  endpoints so the crossing boundary is explicit; and
- `full` returns every scope-visible process and law node and edge, including
  complete process metadata and executable law definitions.

In `full` and `neighborhood` mode, values are omitted unless `includeValues` is
requested. A candidate source can also expose bounded occurrence marks on its
law nodes. All modes return a `snapshotHash`; passing it back as
`expectedSnapshotHash` rejects a view if the source snapshot changed between
queries. Scope filtering removes inaccessible processes and any law or edge
that would expose them. As with `life_view_query`, supplied scopes are caller
context rather than authentication, and “full” means full within that context.

The six `life_narrative_*` tools expose an optional graph-native artifact
owned and persisted by the same Rust session. Register and revise accept a
complete graph. `life_narrative_batch` accepts one or many additive roots,
nodes, and edges and lets Rust construct the complete immutable successor. On
a nonempty graph, every newly added node component must bridge in the same
transaction to an existing node or stable anchor. A one-node batch is valid
when it includes such an edge; the first declared root is the only standalone
bootstrap. Rust validates references, structural order, acyclicity, scopes,
revision lineage, object anchors, nested RFC 6901 paths, and connectivity
before storing anything atomically.

Read operations remain granular. `life_narrative_query` returns a full graph,
skeleton, or bounded neighborhood. `life_narrative_render` projects ordered
prose from the canonical story nodes with contributing hashes.
`life_narrative_training_export` returns deterministic records binding exact
text to an exact model/world/candidate snapshot and any explicitly linked
process values. These are single-snapshot alignments; causal chronological use
still requires cutoff-safe snapshots or a downstream mask. Export does not
train a model. Externalized reflections are authored
testimony, never hidden chain-of-thought; they require a holder and scope and
cannot render into the story. The scopes are projection labels rather than
authenticated confidentiality.

`observe`, `compare`, and `trajectory_query` work only over the projection Rust
retained for the candidate's original query; they cannot recover hidden fields
in JavaScript. `life_trajectory_summarize` delegates bounded subinterval
statistics to Rust and binds the result to the candidate, canonical trajectory,
retained path, and summary query hashes. It requires a full or decimated path;
for decimated retention it summarizes that coarser piecewise-linear curve and
does not claim knowledge of discarded samples. `annotate` writes only to an MCP-owned evaluation ledger and
cannot mutate canon. `life_candidate_roll` retains the convenient North Harbor
arguments and also accepts a complete Rust `life-sim-rust-model-query/v1` for
generic support, resolution, access, intervention, observable, direction, and
precedence metadata.

Every mutating tool binds its `requestId` to a SHA-256 hash of a canonicalized
payload. An exact retry returns the original receipt, including the bound hash;
reusing that id with different arguments is rejected. In-flight identical
retries also share one operation rather than creating duplicate state. These
receipts live only in the Node process. A timeout after a durable Rust mutation
or an MCP restart can therefore leave the caller to reconcile by inspecting
lineage; cross-restart exactly-once delivery is not claimed.

`reroll`, `reject`, and `accept` are marked destructive in MCP metadata because
they irreversibly change candidate status; `accept` also advances canon and
supersedes siblings. Rust independently preserves committed status under
deterministic retries and refuses stale-parent commits.

## Optional candidate routing

`life_candidate_route` is a read-only Director aid for two or more pending
candidates produced from the same model, frozen parent, interval, and dynamics.
It reads only the scope-checked scalar projections named by the caller, which
declares endpoint or interval-change terms, a `maximize`, `minimize`, or
`target` preference, and explicit positive weights. The tool returns a
deterministic ranking and the contribution of every term.
Change terms require a retained path containing the interval start; an
endpoint-only candidate can still be routed by its endpoint but not by change.

The route can use authored wants, fears, relationships, finances, or any other
declared scalar actor/world state; it does not require a Decision profile. It
does not claim to discover an actor's true utility, choose an in-world action,
mutate a candidate, or accept its recommendation into canon. Acceptance remains
the separate consequential `life_candidate_accept` operation.

## Writer constraint negotiation

Two post-acceptance control-plane tools help an intelligent writer decide how
to use state without pretending that every coordinate belongs in prose. The
entire writer layer is optional:

- `life_writer_contract_create` classifies up to 100 scalar fields as `hard`,
  `soft`, `optional`, or `renegotiable`. Its source must be a Rust-committed
  candidate whose retained path includes the interval start. With `graph: null`
  it returns the original field-only v1 contract. Supplying `graph` returns a
  v2 contract containing a compact whole-graph skeleton, one value-bearing
  causal neighborhood focused on a requested field, the complete crossing
  boundary, a shared Rust snapshot hash, and an exact `life_graph_query` route
  back to the full graph.
- `life_writer_plan_evaluate` requires exactly one disposition per field:
  `explicit_dramatization`, `implicit_adherence`, `omit_surface_prose`,
  `conflict_detected`, or `request_profile_revision`.

A causally relevant hard field may only be explicitly dramatized or implicitly
obeyed. A conflict blocks rendering. A profile-revision request is valid only
for a renegotiable field and returns a `revise-model-and-rerun-from-source-parent`
request; it never edits the accepted candidate. Every plan includes the five
remediation classes:

- bad wording: rerender the same canon;
- excessive state: hide redundant soft fields;
- implausible dynamics: revise the profile and rerun;
- an uninteresting random future: wholly reroll from the same frozen parent;
- conflict with accepted history: fork before the conflict and resimulate.

This negotiates structured intent. It does not yet read finished prose and
prove that every sentence adheres to the plan.

## Optional story-revision diagnosis

`life_story_revision_diagnose` accepts cited reader or mechanical observations,
caller-supplied hashes identifying the model, cut, trajectory, writer packet,
and story, and an explicit adequacy finding for each layer. It tests the layers
in foundational order—model, cut, trajectory, then rendering—and recommends
the smallest supported repair. An unresolved earlier layer yields
`undetermined` rather than allowing a convenient later-layer rewrite to hide
the uncertainty.

This is an evidence-organizing diagnostic, not an automatic critic. It neither
inspects canon by itself nor establishes that supplied findings are true. It
does not score literary quality, rewrite prose, revise a model, reroll a
trajectory, or mutate accepted history.

## Install the npm package

The generated package includes its Rust sources, lockfile, reading resources,
profiles, and presets. It requires Node.js 22.18 or later, Cargo, a C compiler,
and native build tools. Build the engine explicitly after installing a release:

```sh
npm install @emergent-wisdom/meaning-model-mcp
npx meaning-model-mcp --build-engine
```

During release preparation, install the generated local `.tgz` in place of the
registry package name. See the [npm package guide](NPM-README.md) for a client
configuration using the installed launcher. The build may fetch dependencies
pinned by Cargo.lock; it does not download a prebuilt engine. No build runs
automatically during npm installation. Rebuild after upgrading, or provide an
existing compatible engine through `LIFE_SIM_ENGINE_BIN`.

## Build and run from source

Build the Rust machine before starting MCP:

```sh
cd mcp-server
npm ci
npm run build:engine
npm test
npm start
```

By default the adapter checks the deterministic repository-relative release
path and then the debug path. Set `LIFE_SIM_ENGINE_BIN` to an explicit executable
when the binary lives elsewhere:

```sh
LIFE_SIM_ENGINE_BIN=/absolute/path/to/life-sim-engine npm start
```

An unavailable, malformed, oversized, timed-out, or unexpectedly terminated
Rust process fails explicitly. The adapter bounds each command to 16 MiB, each
response line to 64 MiB, aggregate pending command bytes to 32 MiB, pending
calls to 32, and a call to 30 seconds. It also caps model/world/candidate
handles, receipts and retained receipt bytes, trajectory fields/samples,
annotations, evaluations, and writer inputs within the current Node lifetime;
capacity is reserved before concurrent mutations. Rust separately rejects
queries whose step count, law/process work, retained-state or activity-byte
estimate, or cumulative restart-replay work exceeds its machine-described
limits. The exact live limits are returned by `life_engine_status`; hosted
tenant isolation still needs authenticated principals and a scheduler.

Example client configuration:

```json
{
  "mcpServers": {
    "meaning-model": {
      "command": "node",
      "args": ["/absolute/path/to/meaning-model/mcp-server/bin/meaning-model-mcp.mjs"],
      "env": {
        "LIFE_SIM_ENGINE_BIN": "/absolute/path/to/life-sim-engine"
      }
    }
  }
}
```

## Prepare an npm tarball

From `mcp-server`, run:

```sh
npm run pack:release -- --dry-run
npm run pack:release
```

The command creates a fresh generated package under the repository's `build/`
directory and reports the tarball path. It preserves the resource layout,
converts the server entry point to JavaScript, and includes only runtime code,
Rust sources, reading resources, and licensing notices. It excludes compiled
binaries, dependencies, Git history, PDFs, and the development Book artifacts.
Source changes require a new package. Runtime sources remain maintained in
their existing locations; the staged copies are generated release artifacts.

Direct `npm pack` or `npm publish` from `mcp-server` is blocked because that
subdirectory alone is not a complete runtime. The generated stage has public
package metadata and no install/build lifecycle hook. Packaging never publishes
to npm. Publication and ownership of the npm scope require a separate release
decision; no registry availability is implied by the package name.

## Honest boundary

This is an experimental local process. Without the Rust machine's optional
single-writer state file, Rust-held models, worlds, candidates, and narrative
graphs disappear on restart. Even with that file, the present MCP-owned world index, request
receipts, annotations, writer plans, and estimation exchange are process-local
and are not recovered after restart. Durable multi-user use still needs an append-only store,
authentication and authorization, principal-scoped handles, and resource
endpoints for large paths.

The Rust state file contains complete model and world data. On Unix its
replacement temp files use mode `0600`; operators must still place it in a
trusted directory, protect backups, and treat `persistence_uncertain` as an
indeterminate acknowledgement requiring lineage inspection rather than a safe
blind retry.

The typed IR represents scalar, vector, categorical, distributional, graph,
object-pose, and regime values; distinct decomposition and dependency edges;
claims; and evolution, relation, occurrence, epistemic, and resolution roles.
Current numerical execution is narrower: scalar expressions evolve, derived
scalar order is checked, occurrences and keyed named randomness execute, and
non-scalar values are validated and carried but not numerically updated.

The project inventory contains 33 normalized semantic families: 12 have
dedicated reusable implementations, 22 have at least partial or fixture
coverage, 11 remain paper-only, and validated learned coverage is 0. Generic IR
representability is not evidence that MCP has a validated implementation of
every family. The status tool reports both that inventory and the Rust
machine's own executable boundary. It separately reports the current MCP-facing
semantic estimate as approximately 10 of 33 families; that count must not be
conflated with generic structural encodability.
