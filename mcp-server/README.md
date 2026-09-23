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

Choose the processes, categories, relationships, and resolution that serve your
application. The supplied profiles are starting programs, not required world or
person categories. An AI modeler may develop a different vocabulary, use only a
single process, and leave unnecessary layers absent. The external model is for
use as well as retention: the modeler can compare explanations, propose
developments, and choose further questions using the process accounts it builds.

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

### Choose a starter deliberately

- **Structural starters** load identities, Events, and optional detail without
  inventing semantic scores. The person starter's explicit `lifecycle` level
  creates only a person and life Event; `processes` adds the Book's nine
  concurrent life processes. Omitting the level retains that existing
  `processes` default. These processes can overlap and are not a single Cut.
- **Experimental behaviour models** add substantive assumptions. The `story`
  profile includes authored tension/coherence/progress values and a progress
  law, even at its minimal tier. The `decision` profile uses authored motives
  and deliberative/habitual/impulsive weights; options are independent unless
  another law makes them exclusive. They are examples to inspect and test,
  not neutral defaults or validated theories of people.
- **Direct modeling** uses the same ordinary model forms without compiling a
  profile. You may also adapt a compiled model before registration, or submit
  a complete explicit successor after registration. Template parameter fields
  do not limit the vocabulary of models authored this way.

Choose and document the template's meanings and laws before using its numbers.
Revise the vocabulary when a different account explains or predicts better;
preserve earlier versions rather than silently relabeling their values. The
[application guide](../docs/examples/APPLICATION-CATEGORIES.md) demonstrates
that workflow and distinguishes model revision from applying it to a live world.

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
A `realizes_forecast` relation links a direction Cut's parent event to the
continuation that was built; its `forecast_answer` names the Cut and the
realized answer key, remainder included, and each Cut has at most one.
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
- `life_narrative_edit`
- `life_narrative_query`
- `life_narrative_render`
- `life_narrative_training_export`
- `life_narrative_rebind`
- `life_narrative_alignment_audit`
- `life_direction_draw`
- `life_estimate_cut_shares`
- `life_model_ingest`
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

The seven `life_narrative_*` tools expose an optional graph-native artifact
owned and persisted by the same Rust session. Register and revise accept a
complete graph. `life_narrative_batch` accepts one or many additive roots,
nodes, and edges and lets Rust construct the complete immutable successor. On
a nonempty graph, every newly added node component must bridge in the same
transaction to an existing node or stable anchor. A one-node batch is valid
when it includes such an edge; the first declared root is the only standalone
bootstrap. Rust validates references, structural order, acyclicity, scopes,
revision lineage, object anchors, nested RFC 6901 paths, and connectivity
before storing anything atomically.

`life_narrative_edit` is a shared editing surface available without the
storytelling add-on. Supply `requestId`, an exact `graphHash`, `accessScopes`,
`reason`, and an ordered `operations` list to split or merge text leaves, move
a subtree, reorder all children of a parent, or replace text with an exact
`expectedText` guard. It reads the complete graph and submits one atomic
successor through the existing Rust revision operation, preserving untouched
records and the source binding. An incomplete scoped view is refused. Splits
preserve the exact joined text and original links; merges retain source nodes
as history. Choose useful independently changeable units, without a required
subdivision count or word quota.

Edits do not automatically reinterpret semantic links or update earlier
reviews. Inspect changed meaning and evidence, render the new result, and
refresh affected reviews after content or order changes. The receipt identifies
changed records and affected reviews. Complete revision and additive batch
tools remain available. See the
[local graph editing contract](../docs/NARRATIVE_UNDERSTANDING_GRAPH.md#local-graph-editing)
for operation fields and topology restrictions.

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

## Optional external estimator

Three tools turn an external classifier into a modeling aid, and one tool makes model
revisions cheap to follow. They are always registered. Without configuration the
estimator tools return their generated questions as a task for the calling LLM and
send nothing anywhere. Set `MEANING_MODEL_ESTIMATOR=typesafe` with `TYPESAFE_API_KEY`
(optionally `TYPESAFE_MODEL`, default `jev-latest`) to have TypeSafe's Jev score the
questions instead. With the estimator on, the text supplied to these tools leaves the
machine; no other tool changes behaviour.

`life_estimate_cut_shares` takes one comparison question, its answer keys with
meanings, and targets: free-text situations, or event IDs in a bound model whose
boundary and description supply the situation text. Each target returns a normalized
Cut proposal, the estimator's distribution over the answers plus an automatic
`remainder`, with provenance naming the estimator and its confidence. With `apply`
and a `requestId` the tool registers the Cuts as one complete immutable model revision
itself, under their parent events; `rebind` moves a model-bound story graph to that
revision in the same call; `distributions` lets you place your own numbers without an
estimator. Proposals are AI inference, not canon: a large remainder usually means a
missing answer category.

`life_model_ingest` is the one-call entry for general modeling. You write the event's
boundary and description once, list the questions to ask about it, and optionally add
notes; the tool creates the events under their declared parent, asks every question
for every event, writes the distributions as Cuts, registers the revision, rebinds the
bound graph, and stores the notes as Understanding Nodes anchored to the events. Text
is yours; weights are the estimator's; both carry provenance and can be revised.

`life_narrative_rebind` rebinds a model-bound narrative graph to a successor model as
one complete graph revision. It refuses partial projections and unrelated models, keeps
every node including historical assessments, and drops only edges anchored to
predecessor model hashes. Record fresh depth assessments afterwards.

`life_narrative_alignment_audit` renders a prose unit from an exact graph revision and
audits it against the graph's records, per passage and as a whole. Questions are
generated mechanically from each record (narrated? contradicted?) and from declared
withheld nodes (leaked to the viewpoint or reader?), plus one advisory holistic
question. Passage-level flags at or above 0.5 are the actionable signal; whole-unit
scores arbitrate proposals and reported speech, which score high at passage scope.

`life_direction_draw` draws one answer from a registered model's normalized Cut, usually a
direction Cut over mutually exclusive continuations, with a caller-supplied seed. The server
computes the draw (the first 32 bits of SHA-256 of the seed, divided by 2^32, against the
answers' cumulative weights in model order), so anyone can recompute it. With `record`, the
draw is stored in a graph bound to that model; an earlier draw over the same Cut is reported
and linked, so a second draw shows up as a reroll. A drawn remainder asks for a new admissible
continuation, never a renormalization of the named answers.
List `knowledgeStateNodeIds` for records phrased as transient knowledge states so they
are checked only for narration and leaks. With `record` the tool stores the scores and
flags itself as a derived-diagnostic metadata node under the document root. The audit
is advisory and does not verify meaning or literary quality; resolve flags by revising
prose, revising a record with justification, or recording an ambiguity.

## Opt-in storytelling add-on

The narrative graph is the authoritative authoring record. Create the model
and graph before developing story material; store candidates, seed draws and
alternatives, drafts, assessments, selections, local revisions, and disclosure
plans through the tool. Files and PDFs are exports of graph content, not a
parallel manuscript or model. Use `life_story_author_record` for authoring
material and concise Understanding Nodes. Numerical exploration and revision
persist their results directly; neither accepts them as world facts.

Start the server with `MEANING_MODEL_ADDONS=storytelling` to enable twelve
bundled tools, the `life-sim://addon/storytelling` resource, and the
`life_story_scene_start`, `life_story_structure_explore`,
`life_story_purpose_review`, and `life_story_deepen` prompts:

- `life_story_author_record` saves candidates, drafts, context, and scoped
  Understanding Nodes for assessments, selection, revision and disclosure,
  with typed links and an authoring clock separate from story time.
- `life_story_structure_explore` prepares a task for the calling LLM to use an
  ordinary word's meanings and relationships to suggest alternative events,
  characters, relationships, or storylines, or its sounds and associations to
  develop fitting names. The LLM records its seed task and alternatives with `life_story_author_record`; suggestions remain unaccepted.
- `life_story_trajectory_explore` samples bounded numerical candidate points
  for events or whole lives on caller-defined axes. It preserves explicit
  fixed values and allocation totals. Randomness and candidate count are
  separate controls; candidates remain unaccepted creative hypotheses.
- `life_story_trajectory_revise` changes selected candidate values with reasons
  and a parent hash. It preserves unlisted and fixed values and checks bounds
  and allocation totals, allowing local repair of a promising character or event.
- `life_story_life_trends` validates and stores the principal cast's overall
  life trends in the narrative graph. Each character needs at least three
  ordered coarse life phases, two chosen dimensions carried across every
  phase, explanations for adjacent developments, and an open or planned future.
  The calling LLM must construct or reuse this model automatically before
  drafting, without asking the user to fill in the dossier.
- `life_story_model_depth_review` prepares the actual bound model, stored story
  focus, life dossier, and selected context for the LLM to judge whether they
  explain the story's consequential choices and outcomes.
- `life_story_model_depth_record` validates that task and its cited graph/model
  evidence, then saves the LLM's coverage explanation and findings as a scoped
  Understanding Node. Save gaps as well as sufficient assessments.
- `life_story_scene_prepare` creates an immutable scene packet bound to a
  narrative graph revision, a required life-trend dossier, a current
  model-depth assessment, explicitly selected
  context nodes, and authored character and reader knowledge timings. Present
  or affected principal characters need explicit connections to the dossier's
  trends.
- `life_story_scene_review` checks an exact draft against that packet using
  caller-provided findings and exact supporting excerpts for each check. It
  requires `draftNodeId` matching a stored draft exactly; save the draft first
  and re-prepare using the returned graph revision. Optional `passages` supplies
  ordered `{id, text}` leaves whose text joined with `"\n\n"` must exactly match
  that draft. The segmentation is bound to the review hash.
- `life_story_scene_commit` reruns the same checks and uses Rust's narrative
  batch operation to atomically append canonical story text and nonrendered
  Understanding Node reviews. It preserves previous graph revisions and leaves the world
  unchanged. With `passages`, it creates a nonrendered scene container and
  individually linked, renderable children; omitting them preserves the
  original single-leaf scene form. Its `nextStep` receipt reminds the LLM to perform a purpose review
  if a meaningful unit or turning point has finished; the LLM decides whether
  that condition applies.
- `life_story_purpose_review` prepares the exact rendered chapter or section
  for the calling LLM to answer: what is its purpose, and is that purpose
  fulfilled in context? Its instructions distinguish inferred goals, allow
  multiple purposes and delayed payoff, and caution against mechanical
  judgments. The LLM records its advisory assessment with `life_story_author_record`;
  the preparation tool itself is read-only and the judgment cannot block saving. The calling LLM performs it automatically at completed
  chapters, significant turning points, completed parts or works, and
  consequential revisions.
- `life_story_deepen` prepares a later revision of an existing work against
  an exact graph, model and rendered-text baseline, with depth and purpose
  review tasks. The tool is read-only; the LLM records its before/after voice
  findings and revision plan as Understanding Nodes and uses existing tools
  to make and review justified changes. Default local scope preserves premise,
  cast and ending; structural scope allows larger changes within the brief.

After a draft and substantive revision, the LLM reviews the author's voice
and each relevant principal character separately. Character speech and
behavior need explanations in their actual modeled processes, including
meaningful changes by situation. Save each finding's prose citations, relevant
process IDs or model paths, intended versus observed effects, uncertainty and
smallest repair or keep decision through `life_story_author_record`,
`kind: "assessment"`. These are actual `externalized_reflection` Understanding
Nodes linked to the exact prose and selected author model, with reviewed
hashes in `data`; an external review alone does not complete the step. Literary
effectiveness is advisory, with no trait quota or universal voice scale.

Structure exploration takes `brief`, optional `targetKind` (default `event`;
also `character`, `relationship`, `storyline`, or `name`), `context`, `constraints`,
and `seedWord`. Omit `seedWord` for a uniform draw from a fixed bank of common
English words, independent of the brief, or supply one to reuse an inspiration.
The bank is deliberately bounded; it is not a statistical top-5,000 list. The
tool returns a task with `generator: "calling_llm"` and `candidates: null`.
The same-named prompt uses a JSON string for `constraints`, while the tool
accepts an array. The LLM answers in the brief's language, explores two or three
possible structures, and may reject the seed when none fits. Novelty is not a
quality score, and quieter structures are valid.

For new principal-character, place, or organization names, the LLM automatically
calls with `targetKind: "name"` and omits `seedWord`. Supply culture, language,
genre, tone, and existing names in `context` and `constraints`; use the random
word's sound, rhythm, or associations to develop distinct names that fit. Do
not force the seed into the spelling or make names explain the plot. Preserve
established names unless the user requests a change, and label any invented
etymology as fictional. The bank remains 160 reviewed common English words;
the STLM vocabulary has not replaced it.

Numerical exploration defines each axis by its `meaning`, `comparisonQuestion`,
`unit`, `minimum`, and `maximum`, alongside expected baseline points and
explicitly fixed axis values. Event candidates have at least two ordered points;
whole-life candidates have at least three. Optional disjoint allocation groups
specify a `question`, `axisIds`, and `total`; the sampler preserves that total.
`randomness` (0–1, default 0.5) mixes the baseline with bounded random proposals.
`candidateCount` (default 3, maximum 8) separately limits exploration, and a seed
permits replay. Emotional states use meaningful numerical dimensions as well.
These samples are not physical simulations or calibrated psychology.

The calling LLM assesses coherence and storytelling potential. Prefer a local
repair of a promising candidate to discarding the whole person: revise selected
values or causal explanations, retain the original evidence and revision
history, and record reasons. Category or point-time changes need an explicit
new proposal or numerical-model revision. The sampler checks only declared
fixed values and constraints; it does not infer all canon from prose context.

Review principal-character flaws for their effect on decisions and consequences,
not merely a label in a biography. Randomness cannot establish this. At major
milestones, seek an independent reading when available and record its findings;
otherwise identify the assessment as self-review.

Keep concise candidate assessments and revision reasons as genuine
Understanding Nodes in the existing narrative graph. Use a named
author-understanding root and `externalized_reflection` nodes with explicit
holders, author scopes, provenance, authority, and rendering excluded. Connect
them to candidate evidence or model entities with specific `about`, `refines`,
and `supports` links as appropriate. These are deliberate authored explanations,
not hidden model reasoning or world facts. `life_story_author_record` stores them under the named root and an authoring
clock. Numerical revisions automatically store their reasons as linked
Understanding Nodes; the LLM records its evaluations and selections separately.

Life-trend storage takes `graphHash`, `requestId`, `nodeId`, `accessScopes`, and
`dossier`. The dossier's schema is `meaning-model-story-life-trends/v1`; it
identifies `storyRootId`, `storyInterval`, and the principal `characters` by
stable model anchors. Each character's phases span `lifeBeginning` through
`storyEntry` in a declared `lifeTimeUnit`. Model the overall life before the
narrated interval, rather than dividing a short crisis into phases. The tool
stores content constructed by the calling LLM; it does not invoke a separate
remote LLM. For new fiction, author and label the needed details. For existing
canon, reuse established facts and identify inferences or unknown origins.
Ask only about gaps that require the user's choice. A character's optional
`trajectoryProposal: {definition, candidate}` with `trajectoryRecordNodeId` retains numerical evidence; phase
and trend summaries explain those values instead of replacing them.

Before prose and after consequential model, trajectory, causal, or disclosure
revisions, automatically call `life_story_model_depth_review`. Its preparation
fields are `graphHash`, `storyRootId`, `lifeTrendsNodeId`, `focusNodeId`,
`contextNodeIds`, and `accessScopes`. Store the focus's outline, goals, choices,
and outcomes in the graph first. The model hash comes from the graph's frozen
source snapshot. Review actual evidence, choosing relevant subjects rather
than filling a fixed taxonomy or meeting a depth quota.

Save the assessment with `life_story_model_depth_record`: supply
`preparation`, `expectedTaskHash`, `requestId`, `nodeId`, `reviewer`, a
`coverage` explanation, and `findings`. Each finding supplies `subject`,
`status` (`sufficient`, `needs_opening`, or `unclear`), `explanation`,
`evidence`, and `smallestRepair` (nullable for sufficient findings). Evidence
uses `{kind: "node", nodeId}` or `{kind: "model", path}` with a JSON Pointer
into the bound model; the assessment must cite actual model evidence, not
only narrative summaries. Follow the task's explicit read-more route if a
large definition is not included inline. Inspect relevant lives and flaws, concepts, physical or
institutional constraints, causes, and author disclosure processes. If an
explanation is inadequate, make the smallest useful refinement and reassess.
The tool validates bindings and references, not the LLM's semantic judgment.

The model read is administrative and is not filtered by narrative scopes.
Its initial values describe the static model, not current world or candidate
values. Identify missing runtime evidence instead of silently reading a newer
world. Review freshness binds the source and selected story evidence;
unrelated appended drafts or author notes do not invalidate the assessment.
All findings are saveable. Missing or stale records fail scene preparation;
unresolved gaps produce a packet with a blocker that prevents commitment
until repaired and reassessed. They do not block saving drafts or general
authoring, and do not grade prose.

Depth-review model anchors name the exact reviewed model hash. After a model
revision, `life_narrative_revise` must rebind the story while retaining old
review nodes as historical records and removing their predecessor-model
anchor edges from the successor graph. The prior immutable graph retains
the exact evidence; never retarget an old finding to revised values. Record
a new depth review and its new anchors before committing affected scenes.

Scene preparation requires `lifeTrendsNodeId`, `modelDepthReviewNodeId`, and
`scene.characterConnections`, whose entries supply `characterId`, `trendIds`,
and `connection`. The dossier must cover the scene's story root and world
time. Life-trend and cast-coverage checks require review findings and can block
commitment. Dossier content is author context: it grants no character knowledge
or reader disclosure, and is excluded from rendered prose and training
projection. Select granular source facts separately when they are disclosed.

Purpose review takes `graphHash`, `rootId`, optional `unit` (default `chapter`;
also `section`, `part`, or `whole_work`), `authorGoal`, `context`, and
`accessScopes`. It returns a text-bound task with `taskHash` and
`assessment: null`; the calling LLM supplies its answer with textual evidence.
The same-named prompt uses a JSON string for `accessScopes`. No external LLM is
called by the server. Record the returned task and your assessment with
`life_story_author_record`, linked to the reviewed passages.
Use `context` to supply relevant life trajectories, prior expectations,
consequences, and authored disclosure processes; the renderer does not collect
all of this evidence. Review causal continuity and aftermath where relevant,
including how intended reader anticipation or surprise differs from character
knowledge. Qualify missing context as unclear. Keeping the text unchanged is
valid, and there is no rewrite quota, required acceptance of suggestions, or
timer that grades each paragraph.

Deepening takes `graphHash`, `storyRootId`, `rootId`, `lifeTrendsNodeId`,
`focusNodeId`, `contextNodeIds`, and `accessScopes`, plus optional
`authorModelNodeId`, `unit` (default `whole_work`), `revisionScope` (`local` or
`structural`, default `local`), and `brief`. The same-named prompt encodes arrays
as JSON strings. The task preserves exact baseline identities and hashes,
rendered prose and node IDs, selected author model, and model-depth and purpose
review preparations. Save the diagnosis and plan before revising, then save
the after-analysis within the combined task's returned `accessScopes`, even
when a nested task permits broader scopes. Evidence limits and justified keep decisions are valid;
there is no reroll, rewrite or length quota.

Scene commit appends new material. Use shared `life_narrative_edit` operations
for targeted text replacement or structural changes to existing passages,
then inspect retained semantic links and refresh reviews whose text, order,
or other evidence changed. The optional scene `passages` form makes its leaves
independently addressable from commitment. Complete `life_narrative_revise`
remains available for unsupported topology or source changes; manually
constructed successors require a full graph read with verified node, edge,
and root counts, never a scope-filtered projection. An append-based replacement
can still use fresh scene IDs and the preparation/draft/review/commit workflow
while explicitly retiring and rewiring the superseded prose. Render and review
the exact final topology for missing, duplicate, or reordered passages. Preserve
the immutable baseline and do not export an intermediate gap. Neither
preparation nor editing verifies literary improvement. See the [add-on guide](../profiles/STORYTELLING_ADDON.md#deepen-an-existing-work).

The core `change_arc_scaffold` already offers optional anticipation, focal
change, and adaptation Events. Use these to model character experience when
helpful, and separately model author processes for intended reader response.
Shock can be welcome, unwelcome, or expected but consequential; adaptation can
begin beforehand, overlap, remain partial, or fail. No fixed three-beat pattern
is required, and an intended reader response is not a measured outcome.

The writer or reviewer interprets the draft and chooses sufficient context.
The tool checks the life-trend structure and supplied review record; it does
not automatically infer everything the prose implies, prove the life model's
substance, or prove that every relevant fact was selected.
The add-on introduces no required psychology, numerical story scores, or
dependency on the experimental `story` compiler.

With the variable unset, the default MCP surface is unchanged. The existing
low-level narrative, writer, and revision-diagnostic tools remain available
with or without the add-on. Shared record schemas and executable laws are
unchanged, so company valuation processes, physical processes, and other
domains retain their application-defined models.

Read the [storytelling add-on guide](../profiles/STORYTELLING_ADDON.md) for
the workflow and client configuration. To enable it from a source checkout:

```sh
MEANING_MODEL_ADDONS=storytelling npm start
```

Restart the MCP server after changing its environment. The add-on is bundled
with the server and uses the existing Rust narrative store.

## Opt-in alien add-on

Set `MEANING_MODEL_ADDONS=alien` (or `storytelling,alien`) to add world-diversity
ideation from *Ontology of the Alien*. The server writes each role's task with
only what that role may see:

- a target-blind builder turns a seed word into an invented world;
- a purpose-blind solver solves the problem inside that world;
- a compiler brings the operative mechanism back into the problem's domain.

The paper is bundled and must be read before a search: the write tools refuse
until it has been read in the MCP process. Every cell of the paper's condition
matrix can be run, from direct proposals with a Semantic Tabu archive or the
curated map to map-conditioned compilation.

Curators keep three revisable ontologies: mechanism families, claimed outcomes
and causal world regimes. A new family is admitted only when the recorded
equivalence test says the primary causal operator changed. Diagnosis of those
ontologies decides which world to commission next, including family and outcome
combinations no candidate has yet. Promising mechanisms are transferred onto a
target model, with every role mapped and every disanalogy stated.

Everything lives in the narrative graph as Understanding Nodes. Every task text
is stored, so each output cites what its role actually saw. Graded fits and
weighted selections follow the Meaning Model's Cut rule. Each ontology can be
exported as Meaning Model concepts and specialization relations. Worlds are
textual thought experiments and transfers are ideas, not evidence. See the
[alien add-on guide](../profiles/ALIEN_ADDON.md).

Start the server with `MEANING_MODEL_ADDONS=alien` to enable six tools:

- `life_alien_search_start`
- `life_alien_task`, which is read-only
- `life_alien_record`
- `life_alien_ontology_revise`
- `life_alien_search_diagnose`, which is read-only
- `life_alien_atlas`, which is read-only

It also enables the `life-sim://addon/alien` resource and the
`life_alien_start` prompt.

The server re-derives every recorded output's task from its `taskRef`. It
binds each world's seed and target blindness from that task, and checks:

- rule and role bindings;
- ontology structure and the admission guard;
- model refs in transfers;
- diagnosis hashes;
- target terms in target-blind tasks.

Coherence, equivalence and whether an idea works remain the caller's judgments.

## General-purpose modeling and optional Jev estimation

Start with `life_general_modeling_start`. The general workflow supports
domain-defined processes across technology, adoption, institutions, markets,
physical systems and other applications. `life_world_model_build` constructs
the initial model and graph from a compact scaffold. Its required context review
starts with the enclosing system and longer-term developments before focal
processes; represented context, unknowns and justified exclusions become
Understanding Nodes. It also requires consideration of authored numerical
judgments, useful native conceptual decomposition, and meanings across dates or
perspectives. The agent may explain why a dimension is unnecessary or unresolved;
the tool does not demand arbitrary scores or depth. These checks do not prove
completeness or causal relevance.
The builder's preview can evaluate Jev
`initialEstimate` questions; applying that exact proposal adopts the initial
values as estimates without another provider call. `life_process_estimate`
uses bounded questions to create typed process-value proposals;
`life_process_estimation_record` saves the exact proposal, process records and
review in the graph. Estimates retain their status and evidence, and do not
silently become observations in accepted runtime history.

Set `MEANING_MODEL_ESTIMATOR=typesafe` and `TYPESAFE_API_KEY` to use Jev for
batched structured judgments. This is independent of the storytelling add-on
and is off by default. The LLM chooses the scope and questions; tool code
handles repetitive record construction. Reduced end-to-end cost and latency
require measurement, including setup and review work.

Read `life-sim://guide/general-modeling` for the complete workflow and limits.

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
