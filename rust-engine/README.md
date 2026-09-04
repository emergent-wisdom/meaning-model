# Meaning Model Rust machine

This crate is the authoritative Rust machine hosted in Meaning Model. MCP, a CLI, or another
client is an interface to this process; it is not a second simulation engine.
When the binary runs in NDJSON mode, one in-process session owns registered
model revisions, accepted world heads, uncommitted candidates, rerolls,
rejections, and compare-and-swap commits.

The `life-sim-engine` package and binary names, `life_sim_engine` library name,
and existing serialized identifiers remain unchanged for compatibility. Life
Simulation consumes this same implementation from the Meaning Model repository.

The machine now provides:

- a recursively decomposable typed process graph covering scalar, vector,
  category, distribution, graph, object-pose, and regime values;
- separate containment edges and typed derivation, causal, constraint, and
  observation dependency edges;
- an executable scalar-expression Law IR with exactly five roles: evolution,
  relation, occurrence, epistemic, and resolution;
- attributed claims that preserve uncertainty, evidence type, holder, evidence
  cutoff, provenance, authority, and their own access scopes separately from
  world state;
- hash-linked complete-model revisions, so adding a dimension or law is an
  explicit schema change rather than an in-place numeric mutation;
- genesis-only authored refinement, which can replace an untouched world with
  its direct next revision while preserving every existing model record,
  initial state value, and claim exactly;
- synchronous whole-world candidates from one frozen parent, named keyed random
  draws, whole-candidate rerolls, and atomic accepted-head replacement;
- backward-compatible timed interventions with an explicit opt-in
  `initial_boundary` application for phase values that must affect first-step
  dynamics;
- typed observed-series ingestion at exact transition boundaries, with durable
  attributed claims and last-value carry between observations;
- an explicit common-random comparison stream for variance-reduced matched
  experiments, without weakening candidate or world lineage identity;
- endpoint-only, full, or decimated path retention, plus canonical read-only
  subinterval summaries over retained full or decimated paths; and
- the original sparse scalar registry API for numerical compatibility and
  large state-only experiments.

## Optional authoring profile compiler

The read-only `compile_profiles` operation translates one or more Story,
Concept Scaffold, Change Arc Scaffold, Person, Person Scaffold, Thing Scaffold,
Relationship Scaffold, or Decision authoring profiles into the same complete
revision-0 `ModelDefinition` accepted by `validate_model` and `register_model`.
Compilation is pure: it creates no
session model, state file, receipt, world, or candidate. A caller must inspect
the output and register it explicitly before it can support a world.

The `person_scaffold` profile is the small loader used by the Book
construction. Level `lifecycle` creates only a stable Person referent and its
complete lifecycle Event. Level `processes` additionally creates nine
concurrent, recursively openable Event-process addresses: body, kin,
partnership, work, place, means, knowledge, standing, and meaning. These
children are unweighted containment and carry no semantic numbers. A number is
introduced only by a separately named comparison Cut; the optional health
opening is one such Cut under body, divided among healthy functioning, illness
burden, and remainder.

The `thing_scaffold` profile loads any other bounded Thing---a machine, place,
document, institution, household, or material object---as one stable referent
with one complete coarse lifecycle Event. Its graph-valued lifecycle index is
structural and introduces no semantic number. Containment, location, extent,
state, and local Cuts are opened explicitly only when the construction needs
them.

The `relationship_scaffold` profile loads one joint Event-process between two
Things already present in the model, or loaded by sibling profiles in the same
request. It records the relationship kind, interval, description, and two
authoritative participant bindings. It deliberately assigns no trust,
attachment, or other number: those become person-specific readings beneath the
relevant lifecycle only when the construction opens them under a declared Cut
and comparison question.

The `concept_scaffold` profile loads one shallow concept definition without a
realization degree, prototype, canonical model, or recognizer. The
`change_arc_scaffold` profile loads an invention, discovery, paradigm shift, or
other bounded process as one Event and may open anticipation, focal change, and
adaptation as overlapping contained Events. Those phases are unweighted
topology, not an automatic sequential Cut or a jump-diffusion law.

The older Person profile is deliberately smaller than a universal personality
ontology. It binds one continuing referent and one evidence event to exactly
one external descriptive view, at least one AI-estimated candidate actor view,
and exactly one self-reported view. Each view is represented through an
ordinary graph-valued process plus bounded node-position processes and
attributed claims. Estimates and reports are rejected if they claim latent
operative-model authority. This supports distinct revisable perspectives; it
does not infer the person's true internal organization, interview them, or
diagnose them.

## Optional Meaning Model layer

A `life-sim-rust-model/v1` definition may optionally include a nested
`meaning_model` member while ordinary Life Simulation models remain byte-for-byte
unchanged after normalization. The layer keeps reusable abstract concepts,
typed abstract relations, stable physical referents, time-scoped encapsulation,
concrete physical events, typed uncertainty-bearing event-to-event structural
or causal relations, authoritative event/process--referent bindings, abstract cuts,
parallel or sequential physical cuts, and typed `define` or `describe`
realization records distinct. An event relation records unweighted `contains`
topology or an authored `causes`, `enables`, `prevents`, `constrains`, or
explicitly described `other` claim; it does not schedule events or create an
executable law. A binding records its
participant or subject role separately from its open-vocabulary binding type;
realizations likewise keep event roles and referent roles in separate
namespaces. A `define` realization supplies the static cut-indexed canonical
physical-model representation. The layer is validated, hashed, revised, retrieved, and
persisted with the complete model definition; the existing process graph and
laws remain the physical execution substrate.

`event_relations`, `normalized_cuts`, and `context_roots` are defaulted and omitted from canonical serialization when
empty. Existing models—including models with a Meaning Model—therefore retain
their exact normalized definition and hash when they do not supply these
later-added collections; an explicitly empty collection normalizes identically
to an absent one.

An Event may remain a static semantic record with empty `process_ids`; supplied
process references must still resolve. Its optional `description` holds up to
64 KiB of nonblank text separately from the short `boundary`, and is omitted
when absent. It does not create a numerical process or execute an occurrence.

`normalized_cuts` contains `{id, parent_event_id, question, unit, answers,
conditioning?, provenance}`. Each answer is `{key, weight}`. Keys are unique
within the Cut, weights are finite and nonnegative, and an explicit answer
whose reserved key is `remainder` is required even at zero weight. The sum must
be one within the fixed `1e-9` tolerance. Optional conditioning is
`{cut_id, answer_key}`; it resolves within the same immutable model and must be
acyclic. Cut and answer order is canonicalized for hashing; zero-weight keys
remain addressable. This collection does not change the older unweighted
physical/abstract Cut schemas or migrate legacy Realization degrees.
An unweighted `define` Realization (`degree: 1`) may omit the legacy
`abstract_cut_id` when one of its role-bound Events parents a normalized Cut;
otherwise the legacy abstract-cut requirement remains in force.

`context_roots` contains `{event_id, kind, provenance}` declarations on existing
Events, with kinds `accepted_world`, `inner`, `understanding`, `document`, and
`candidate`. Supplying any roots opts all Events into context validation:
`contains` edges must be acyclic, known child intervals must lie within known
parent intervals, and every upward path must stop at the same nearest root.
A nested inner root therefore overrides the containing accepted-world root.
Causal and `other` links do not confer authority. Cuts inherit their parent
Event's context; conditioning cannot cross roots. This checks static declared
ancestry, not evidence disclosure, permissions, or future-information cutoffs.

All semantic collections default independently. A model may remain event-only,
contain unbound referents, or combine both planes; the entire `meaning_model`
member remains optional. Referents record bounded identity and continuity, not
mutable state. Their lifecycle links, encapsulation cuts, and bindings are
static declarations over the event/process substrate.

Event-to-concept coverage is also optional. When `semantic_coverage` is absent,
the existing permissive contract is unchanged. `report` mode partitions every
declared semantic event into direct, inherited, explicitly unresolved, or
orphaned coverage without rejecting orphans. `strict` mode rejects a model with
any orphan. Direct coverage requires an event role on a nonzero-degree
realization. Inherited coverage applies only to the parent and children of a
physical cut explicitly named by such a realization; the validator does not
silently traverse unrelated or nested cuts. Unresolved allowances require a
reason and provenance, and later direct or inherited coverage supersedes them
in the derived summary. This invariant concerns static declared events, not
accepted runtime event occurrences, which do not yet have a separate semantic
identity link.

This is static semantic hosting, not entity resolution, cut execution, or
learning. Identity claims, role bindings, cut membership, and sequential order
are declarations. They do not create referents, change membership, schedule
laws, expand or aggregate state, check recomposition, estimate abstract state,
or discover concepts and functions. See
[MEANING_MODEL_CONFORMANCE.md](MEANING_MODEL_CONFORMANCE.md) for the precise
implemented and unimplemented boundary.

The `refine_genesis_world` session operation is a narrow model-lifecycle
exception to an otherwise fixed world/model binding. Its target must be an
already registered direct-next revision; the current head must still be the
exact version-0, time-0 genesis with no lineage; and every old process,
decomposition edge, dependency, law, initial claim, and record in all twelve
Meaning Model collections must remain structurally identical. Additions are
allowed. Semantic coverage may be enabled or strengthened, but not removed or
weakened; existing unresolved declarations are additions-only. Rust rebuilds
the target genesis under the same world id, verifies all
old state and claims, and replaces the head only after the requested view,
storage bound, and response have succeeded. The response reports preserved and
added record counts. This does not infer new structure, execute a cut, open
detail adaptively, or migrate a world after accepted time has begun.

A complete `validate_model` request is available in
[examples/meaning-model-command.json](examples/meaning-model-command.json):

```sh
cargo run --manifest-path rust-engine/Cargo.toml --release -- --pretty \
  < rust-engine/examples/meaning-model-command.json
```

A single read-only request that composes the construction scaffolds is in
[examples/construction-scaffolds-command.json](examples/construction-scaffolds-command.json).

## Retained-trajectory summaries

`summarize_trajectory` reads an existing candidate without rerunning its laws or
changing candidate status, accepted world state, or persistence. The request
names a strictly positive chronological interval, one or more scalar process
ids, and any access scopes required by those processes. For each process, the
machine treats adjacent retained samples as a piecewise-linear curve and
returns its interpolated start and end values, trapezoidal integral, time mean,
minimum, and maximum. Units and source-process uncertainty metadata accompany
the numbers; uncertainty is not silently propagated through interpolation or
aggregation.

The result is bound to the candidate, canonical full-trajectory hash,
candidate-query hash, exact retained-path hash, retention policy, and normalized
summary query, and has its own canonical summary hash. Full paths are checked
against the canonical trajectory hash. Decimated summaries are deliberately
statistics of the coarser retained curve, not claims about hidden samples.
Endpoint-only candidates are rejected because one endpoint cannot identify a
time integral or interior extremum. A caller that needs this operation must roll
with `path.mode: full` or `path.mode: decimated`; requesting a summary never
upgrades retention by rerolling.

## Intervention timing

`TimedIntervention.application` is optional. When it is absent, the machine
preserves the original successor-boundary contract: an intervention is consumed
by the first numerical step whose completed boundary reaches its offset. The
step's evolution reads the frozen pre-effect state, and the intervention then
lands together with occurrence effects before exact relation and resolution
laws. Consequently, a legacy intervention at offset zero changes the first
successor but does not affect the evolution that produced it.

A phase or decision input that must govern the first interval can opt in with
`"application": "initial_boundary"`. This value is valid only at offset zero.
The machine retains and hashes the unchanged frozen parent as path sample zero,
then applies all initial-boundary effects simultaneously at the parent's time,
closes every enabled always-active relation and applicable resolution law in
validated dependency order, and evaluates first-step occurrences and evolution
from that right-hand boundary state. The candidate records the jump with an
intervention mark at step zero and the parent's time. It does not add a duplicate
path sample, so retained-curve summaries still begin with the frozen parent.

For example:

```json
{
  "id": "activate-phase-controls",
  "offset": 0.0,
  "application": "initial_boundary",
  "effect": {
    "target": "world.phase_control",
    "mode": "set",
    "value": { "op": "constant", "value": 0.8 }
  }
}
```

The optional field is omitted during canonical serialization when absent, so
existing query and dynamics fingerprints, random streams, persisted candidates,
and successor semantics remain unchanged. An explicit application value is
bound into the query and dynamics hashes; its realized state path determines
the trajectory hash, and the candidate and accepted-world lineage bind both.
Positive-offset initial-boundary application is intentionally rejected;
positive offsets retain the legacy successor-boundary behavior.

## Observed-series ingestion

A transition query may include typed `observations` for processes whose model
definition declares `update_mode: observed`. The initial process value remains
the value at the frozen parent's time: each observation must therefore use a
strictly positive offset no greater than `delta_time`. Observed-series queries
are forward-only, and every offset must land exactly on a reachable numerical
step after the machine normalizes the requested step size. Observation ids and
process/time pairs must be unique within the query.

The supplied value must match the process type, bounds, unit, and access scope.
Observation or report evidence is required together with uncertainty, holder,
provenance, and authority metadata. An observed target cannot simultaneously be
written by an enabled evolution, relation, resolution, or occurrence law, and
an intervention cannot stand in for an observation. This keeps the contract
unambiguous: after an observed value arrives it carries unchanged until the next
observation. The machine applies it after evolved and occurrence/intervention
effects but before exact relation and resolution laws, so derived fields see the
new value on the same step.

Each validated input becomes an `observed` claim with its own value time and
evidence cutoff, plus an observation mark in a pending candidate. Only explicit
candidate commit makes that result part of the accepted world. Normalized
observations participate in query and dynamics hashes, and every simulated
step contributes to the canonical trajectory hash. Successor values, claims,
marks, and that trajectory hash participate in candidate identity; the
accepted world then binds its endpoint state, claims, and candidate lineage.
The selected retained-path policy and samples are query-hashed and stored with
the candidate but intentionally do not change candidate identity. Full or
decimated retention therefore exposes the observed trajectory without a second
ingestion store, and opt-in session persistence deterministically replays the
same observations on restart. This is ingestion of supplied evidence, not
automatic estimation or truth adjudication.

When the values are outputs from an AI or another estimator, the honest target
is a process such as `estimator.stress_estimate`, with report evidence naming
that producer. The machine then records that the estimate was emitted without
silently promoting the estimated human state itself to a direct observation.

## Explicit common-random comparisons

Ordinary queries remain candidate-bound: their named random draws depend on the
seed, frozen parent, complete dynamics hash, and roll index. This is unchanged
when `comparison_stream` is absent. For a deliberately matched experiment, a
caller may add a bounded, nonempty `comparison_stream` identifier to two or more
queries. The random master then depends only on the seed, that explicit stream,
a canonical schedule hash, and the roll index. Consequently, overlapping law
draw keys at the same step and draw index receive the same raw innovation even
when a matched variant changes an intervention or model.

The schedule hash binds direction, duration, actual step size, and step count.
Two requested step sizes that normalize to the same grid may therefore match;
different actual grids cannot. Observations already have to land on existing
exact step boundaries, so their timing does not alter this schedule. The
candidate's query and dynamics hashes still bind every actual intervention,
observation, model-specific transition, and comparison-stream choice. Its
trajectory, successor, candidate, and accepted world hashes remain distinct
whenever the actual variant produces distinct content.

`ModelRandomness` records `candidate_bound` or `common_random_comparison`, the
optional stream, and the schedule hash. Candidate views expose this metadata,
so comparison identifiers must not contain secrets. This mechanism is only a
variance-reduction aid for controlled experiments. Shared raw draws do not make
two branches identical, permit branch splicing, establish a counterfactual
identity, or by themselves support a causal claim; the experimental design must
justify those interpretations separately.

Persistence has two explicit modes. With no configuration, state is held only
in one process and the machine causes no filesystem side effects. With
`--state-file PATH` or `LIFE_SIM_STATE_FILE=PATH`, Rust uses one transactional
SQLite v2 state file. Foreign keys are enabled, the journal is WAL, synchronous
durability is FULL, and Unix database and sidecar permissions are restricted to
`0600`. One successful command writes only its dirty model, world, candidate,
source-snapshot, narrative-revision, and project-checkpoint rows. A generation compare-and-swap
rejects stale session writers before their rows are applied. Schema bootstrap,
generation advance, and row changes commit atomically; failed persistence is
not acknowledged and the in-memory session reloads authoritative durable state.
An ambiguous failed commit is reported as `persistence_uncertain`.

Narrative history stores one deduplicated source snapshot plus append-only
revision deltas, rather than another full graph for every edit. Raw insertion
order and global commit order are retained as provenance independently of
semantic traversal order and simulated world time. Any immutable revision can
be listed, queried, rendered, exported, or used as the parent of a new branch.
Startup checks SQLite integrity and relational shadow columns, content and
record hashes, canonical deltas, source anchors, complete lineages, storage
bounds, and deterministic candidate replay. Cold narrative lookup replays one
selected chain and compiles only its final graph; restart validation reuses each
materialized parent and retains only the live branch frontier. No destructive
pruning or durable materialization cache exists yet. Export results and begin a
new bounded session before configured limits are reached. Treat the state file
as sensitive complete-world data.

### Narrative checkpoints and projections

One SQLite state file is one logical, versioned project save. While it is open,
SQLite may create transient `-wal` and `-shm` sidecars; distribute the closed
database file. `list_narrative_revisions` returns every immutable checkpoint,
its parent and children, and every current branch head. Selecting an earlier
`graph_hash` is a non-destructive rewind: later checkpoints remain available,
and applying a batch or complete revision to the selected hash creates a new
branch.

`render_narrative_graph` reconstructs and prints the exact selected checkpoint.
Its optional `root_ids` and `access_scopes` select an authored document subtree
or visibility layer. `query_narrative_graph` separately exposes full, skeleton,
and bounded-neighborhood graph views. These are faithful projections of stored
material; the engine does not pretend that truncation is semantic refinement or
invent a coarse summary automatically. To print the same story at authored
coarse, intermediate, and full detail, store those projections as connected
roots or summary nodes and select the appropriate root. An intelligent caller
may generate additional summaries, but they become durable only through an
explicit new revision.

### Project checkpoints

Project checkpoints put several previously separate authored editions in one
SQLite project without forcing their active execution namespaces or legacy
narrative insertion sequences together. `register_project_checkpoint` stores
an immutable named checkpoint with a parent hash, a content-addressed document,
and optional frozen model, world, and materialized narrative-graph snapshots.
Models and worlds use canonical content hashes as database keys. A frozen graph
uses a derived identity that binds its semantic graph hash to its exact source
snapshot hash, so evaluating the same definition against two source states
cannot collapse them by first-wins insertion. A reused human-facing model or
world ID is indexed metadata and therefore cannot conflate two historical
editions.

The document accepts UTF-8 text or explicit bytes plus a media type. An optional
`canonical_external_path` is preserved on the checkpoint link but excluded from
the document content hash, so identical content deduplicates even when working
paths differ. Early editions can keep external Markdown canonical while storing
an exact portable copy. Later editions can additionally bind that Markdown to
frozen executable and graph state.

`list_project_checkpoints` returns checkpoints in append order with immutable
parent links; those links may form a DAG rather than one linear lineage.
`get_project_checkpoint` returns one immutable summary;
`render_project_checkpoint` returns either the embedded canonical document or,
with a narrative render specification, an authored projection of its frozen
graph; and `query_project_checkpoint_graph` supplies full, skeleton, or
neighborhood views. `export_project_checkpoint` returns a bounded exact
registration payload, including frozen material, so independently replayed
editions can be imported sequentially into one project without direct SQLite
copying. Portable exports carry model, world, and graph snapshots as
`model_snapshot_json`, `world_snapshot_json`, and
`narrative_graph_snapshot_json`. These opaque JSON strings preserve signed
floating-point spelling and integers above JavaScript's safe range while a
payload crosses a JSON client. Registration also accepts the corresponding
nested `model_snapshot`, `world_snapshot`, or `narrative_graph_snapshot` for
direct Rust clients, but each nested form is mutually exclusive with its
lossless string form.

Imported graph-backed checkpoints are treated as untrusted frozen material.
Rust checks every source candidate, reconstructs the exact genesis-to-head
lineage without extra anchors, bounds and deterministically replays its work,
and validates retained paths, source state, occurrences, and every narrative
anchor and JSON-pointer subpath against the imported model. The frozen graph
identity binds both the definition hash and source-snapshot hash.

Checkpoint selection is read-only. It does not currently hydrate an old save
into the active mutable world namespace or automatically fork a new executable
branch. A caller can inspect and render every save; active checkout and branch
hydration remain a separate operation.

## Context-conditioned strategy routing

The ordinary scalar Law IR can represent a finite repertoire of authored
problem-solving component signals without adding a separate Solver runtime. A
profile may derive one score per component from the current context, normalize
the scores into positive weights, and derive a composed output as
`sum(weight_i * component_i)`. Component values, routing weights, context, and
the mixture then advance together inside the same complete candidate.

The conformance test
`ordinary_ir_routes_a_normalized_solver_repertoire_by_context` demonstrates
three retained component outputs with context-sensitive abstract, relational,
and procedural weights. It establishes bounded representability only. Rust does
not execute arbitrary LLM or tool Solvers, discover the repertoire, learn the
router, change membership without a model revision, or natively choose one
exclusive winner. Those remain external or future mechanisms.

## Law and refinement extension boundary

The typed Law IR is deliberately a coherent vertical slice, not a claim that
every declared value type has a native numerical backend. Scalar expressions,
Euler evolution, exact acyclic relations, threshold and hazard occurrences,
endpoint epistemic claims, and aggregate, refine, or reconcile assignments
execute today. Vector, category, distribution, graph, object-pose, and regime
values are type-checked and retained in every complete candidate, but remain
static unless replaced by a future typed operator. ODE solver selection,
conserved quantities, PDE, reaction, history-dependent, collision, and genuine
quantum backends remain explicit extensions.

A dependency linked to a law is more than a diagram label: its kind must match
the law role, its target must match the law's target or epistemic subject, and
its source must actually be read by the law expression. A dependency without a
`law_id` remains an explicit descriptive or not-yet-executable hypothesis. On
revision, every process must declare support. A new or reshaped process must
either be a target of an updating law with a validated linked dependency or
declare `update_mode: static` or `update_mode: observed`; merely appearing as a
law input or on an unlinked descriptive edge is not enough.

Likewise, endpoint or decimated retention is not adaptive world refinement. A
coarse-to-fine backend must represent each unresolved lower boundary's
hyperposition---its constrained or weighted compatible descendant space---then
condition jointly on the accepted macrostate, laws, objective, and evidence,
refine correlated descendants together, and reject a detailed path whose
aggregate contradicts the coarse authority. Hyperposition is general simulator
semantics rather than physical quantum superposition, and classical conditional
sampling should remain the default. A literal quantum backend would require
native states, dynamics, instruments, conditional branch updates, decoherence,
and classical-record semantics. A higher-level outcome selector would then be
an additional designed-world meta-law, not standard quantum mechanics or a
claim about actual reality. Keyed pseudo-random innovation supplies none of
those things.

## Instrumented audio-renderer extension

The scalar kernel is **not currently a music player or audio engine**. It has no
PCM buffer graph, device callback, transport, oscillator, sampler, effect,
sample-accurate automation, plug-in host, or audio trace recorder. Its reusable
parts are narrower: stable registries, sparse incoming dependencies,
deterministic time-indexed control paths, whole-candidate rerolls, path
retention, and conformance discipline.
The existing `noise_scale * sqrt(dt) * draw` term is stochastic innovation on a
scalar state path, not a band-limited audio noise generator. The reported
scalar-update throughput is not a deadline, jitter, or xrun measurement.

A future audio extension may use the Rust process as the engine that renders and
plays an accepted Life Simulation trajectory. It should remain layered:

1. The Rust machine's non-real-time control plane owns typed functions,
   project versions, provenance, validation, candidate lineage, and graph
   compilation.
2. The real-time data plane processes preallocated audio buffers through a
   bounded DSP graph and evaluates compiled controls at sample or block
   boundaries.
3. An asynchronous recorder receives selected node taps, summaries, and render
   metadata for later training.
4. MCP and intelligent-AI calls inspect traces, propose edits, compare versions,
   and request rerolls outside the audio callback.

The callback must not wait for a model or MCP, parse JSON, perform file I/O,
allocate unpredictably, acquire contended locks, or rebuild an arbitrary graph.
Compile proposed state off-thread and swap it at a declared safe boundary. Start
with deterministic offline rendering of a small open-source graph—source or
noise generator, envelope, filter, gain, and mix—then verify exact replay and a
fixed-randomness intervention before adding device playback or third-party
plug-in hosting.

A standalone host may eventually own transport and audio-device playback. When
embedded in an existing DAW, the DAW normally owns those responsibilities and
this system becomes an instrument/effect plug-in, automation or stem source, or
connected offline renderer. Never move PCM or dense node traces through the
JSON/MCP boundary; expose file or resource handles and downsampled summaries.
Canonical rejection can discard an unaccepted composition/render lineage, but
live audition has already affected the listener and is not side-effect-free in
that external sense.

## Financial-market extension boundary

The same crate is also **not currently an exchange or market simulator**. A
market data plane would need a versioned venue and instrument model, an ordered
event queue, price/time-priority matching, order lifecycle and book state,
participant or strategy interfaces, fees and latency, and market-data trace
capture. Continuous-time semantic fields such as liquidity pressure or risk
regime do not replace those mechanics. Orders, cancels, and trades may jump the
book, and their exact sequence inside an outer Life Simulation interval must be
preserved.

A future Rust service could combine three layers: exact exchange-event
resolution, lower-rate Life Simulation trajectories over participants and wider
conditions, and an asynchronous provenance/observation stream controlled over
MCP. Whole-reroll remains Monte Carlo sampling from one frozen as-of state; a
reality-facing caller must retain and score the distribution rather than select
the profitable history after seeing its outcome. Begin with deterministic
offline replay against a tiny synthetic book, then add calibrated agents and
licensed historical data. Scalar throughput in this crate is not evidence of
matching-engine realism, forecast skill, market impact, or live-trading safety.

## Why the machine is Rust

Rust is the current product-language choice because the same authority is meant
to support large simulations, deterministic standalone deployment, controlled
memory use, and eventual native game, audio, or systems embedding while keeping
invalid model and lineage states explicit in types. Haskell would be a strong
language for a compact executable semantics or a research DSL for the operator
algebra, but replacing the runtime with it would not prove the dynamics and
would add deployment and native-integration cost. If transition equivalence or
coarse/fine commutation later needs machine-checked proof, a small Lean, Coq, or
Isabelle specification is a better complement to the Rust authority than a
second production engine.

## Build and test

Rust is intentionally not vendored. With a current stable toolchain installed:

```sh
cargo fmt --manifest-path rust-engine/Cargo.toml --check
cargo test --manifest-path rust-engine/Cargo.toml
cargo build --manifest-path rust-engine/Cargo.toml --release
```

This checkout's normal shell may not expose `cargo` or `rustc`; the release was
also verified with an isolated toolchain already available on the development
host. Install a normal stable toolchain for ongoing development and CI.

An allocation-inclusive sparse-ring benchmark is included. Its positional
arguments are field count and step count:

```sh
cargo run --manifest-path rust-engine/Cargo.toml --release \
  --example benchmark -- 10000 1000
```

On the development host (arm64 macOS 26.5.1, Rust 1.98.0, release profile),
the endpoint-only sparse-ring benchmark produced these single-run observations:

| Fields | Sparse couplings | Steps | Scalar updates | Kernel time | Throughput |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 10,000 | 1,000 | 10,000,000 | 0.748 s | 13.37 M updates/s |
| 100,000 | 100,000 | 1,000 | 100,000,000 | 7.686 s | 13.01 M updates/s |

These are engineering smoke measurements, not a comparative benchmark against
the JavaScript machine. They include deterministic innovations and trajectory
hashing but retain only the endpoint; full paths trade memory for inspection.

## JSON boundary

The binary accepts one command as JSON on stdin and emits one response on
stdout. `--ndjson` keeps the process alive and handles one command per line;
this is the lower-overhead mode for a Node service. `--pretty` is available for
manual inspection. Add `--state-file PATH` for opt-in restart recovery. The
equivalent environment variable is `LIFE_SIM_STATE_FILE`; an explicit flag
takes precedence.

The authoritative stateful operations are:

| Operation | Required payload | Result |
| --- | --- | --- |
| `validate_model` | `model` | normalized model and summary, without storage |
| `register_model` | revision-zero `model` | stored model, hash, and typed inventory |
| `revise_model` | complete hash-linked `model` | atomically registered revision |
| `get_model` | `model_hash` | canonical model and summary |
| `create_world` | `model_hash`, `world_id`, optional `view` | accepted genesis metadata and projected values |
| `get_world` | `world_id`, optional `view` | current accepted metadata and projected values |
| `roll_world` | `world_id`, typed `query` | pending candidate projected to the query observables |
| `inspect_candidate` | `candidate_hash`, optional explicit `view` | requested candidate projection and status; default exposes no values |
| `summarize_trajectory` | `candidate_hash`, `trajectory_summary` | hashed piecewise-linear scalar statistics for a bounded interval of the already-retained path; no state change |
| `reroll_candidate` | `candidate_hash`, optional explicit `view` | requested projection of the successor from the same frozen parent with the next roll index |
| `reject_candidate` | `candidate_hash`, optional explicit `view` | requested projection of the rejected candidate; accepted head unchanged |
| `commit_candidate` | `candidate_hash`, optional explicit `view` | requested projection of the committed candidate and atomically replaced head |
| `query_view` | exactly one source id plus `view` | an explicit world or candidate projection |

Run `describe` for the machine-readable value kinds, five operator roles,
edge kinds, schemas, operations, ownership boundary, and numerical limits.
The Rust-owned candidate remains complete, but protocol responses expose only
the exact `requested_observables` authorized by an intersecting access scope.
Claims additionally require their own scope when one is declared, so a private
actor-held claim about a public subject is not exposed merely because the
subject is visible. Caller-supplied interventions must be authorized to read
every process in their expression and to write their target.
An empty observable list returns metadata with no state or claim values; it is
never shorthand for all fields. Candidate views filter every retained path
sample and proposed head as well as the endpoint. Candidate and world hashes,
aggregate occurrence/draw/sample counts, and commitment hashes remain global
lineage or activity metadata; this projection is not a traffic-analysis
confidentiality boundary. Authentication and deciding which scopes a caller
owns remain interface duties. Full model definitions and their initial values
are administrative configuration and must be access-controlled by that
interface rather than treated as a public state view.

The canonical view payload is:

```json
{
  "operation": "query_view",
  "candidate_hash": "...",
  "view": {
    "requested_observables": ["person.ada.stress"],
    "access_scopes": ["therapist:session-42"],
    "include_path": true
  }
}
```

Use `world_id` instead of `candidate_hash` for an accepted-head view. Exactly
one source is required. Model summaries expose both `process_ids` and typed
process summaries so an administrative interface can construct an explicit
view. The runtime rejects a query before mutation when its step count,
duration, expression/evaluation work, state-byte work, retained-state size
estimate, intervention/observable/scope cardinality, or potential draw/mark
records exceed the machine-described limits. Model expression depth/node
counts and aggregate session model/world/candidate counts and serialized bytes
are also bounded. Interventions are sorted and consumed once with a cursor
rather than rescanned at every numerical step.

The older scalar registry API remains available for compatibility. First
compile and validate a registry:

```json
{
  "schema": "life-sim-rust-command/v1",
  "request_id": "compile-1",
  "operation": "compile_registry",
  "registry": {
    "schema": "life-sim-rust-registry/v1",
    "id": "two-field-demo",
    "time_unit": "day",
    "fields": [
      {
        "id": "world.pressure",
        "minimum": 0.0,
        "maximum": 1.0,
        "initial_value": 0.2,
        "drift_target": 0.1,
        "drift_rate": 0.05,
        "noise_scale": 0.01
      },
      {
        "id": "person.ada.stress",
        "minimum": 0.0,
        "maximum": 1.0,
        "initial_value": 0.3,
        "drift_target": 0.2,
        "drift_rate": 0.1,
        "noise_scale": 0.02
      }
    ],
    "couplings": [
      {
        "id": "pressure-to-stress",
        "source": "world.pressure",
        "target": "person.ada.stress",
        "mode": "centered",
        "source_center": 0.5,
        "gain": 0.4
      }
    ]
  }
}
```

The compile response includes the canonical field order, registry hash, and a
hashed genesis parent. Pass that parent and the same registry to `roll`:

```json
{
  "schema": "life-sim-rust-command/v1",
  "request_id": "roll-1",
  "operation": "roll",
  "registry": { "...": "same registry as above" },
  "parent": { "...": "genesis_parent from compile response" },
  "transition": {
    "delta_time": 10.0,
    "step_size": 0.1,
    "seed": "demo-seed",
    "roll_index": 0,
    "events": [
      {
        "id": "heat-wave",
        "start_offset": 1.0,
        "end_offset": 5.0,
        "intensity": { "start": 0.0, "end": 1.0 },
        "effects": [
          { "target": "world.pressure", "rate": 0.08 }
        ]
      }
    ]
  },
  "path": { "mode": "decimated", "every": 10 }
}
```

Every legacy `roll` result contains the complete endpoint and a
`proposed_successor`, but this stateless compatibility operation does not
commit it. Use `register_model`, `create_world`, `roll_world`, and
`commit_candidate` when Rust must own the accepted lineage.

Path retention is an output policy, not part of the simulated transition.
Consequently, the same registry, parent, transition, seed, and roll index yield
the same candidate and trajectory hashes in `endpoint`, `full`, and
`decimated` modes.

## Retained legacy adapters

The public `encode_legacy_registry_as_model` and
`decode_model_world_as_legacy_parent` adapters cover the deterministic,
noise-free legacy scalar subset. Rust tests establish genesis round-trip,
one-step transition, and complete retained-trace equivalence for that subset.
They deliberately reject nonzero legacy noise because the two APIs use
different named random-stream contracts. The former JavaScript simulator and
its development-only cross-kernel conformance runner are not part of this
release repository; they are not required to build, test, or operate the Rust
engine. The standalone MCP's North Harbor conveniences are checked-in,
digest-bound Rust model resources.

## Explicit limitations

- The authored dynamics are scaffolding, not learned or validated life laws.
- World, candidate, reroll, reject, and compare-and-swap commit authority is
  in Rust. Optional crash-safe snapshots recover one writer across restart;
  concurrent writers, distributed consensus, incremental journaling, and
  online compaction are not implemented. The snapshot backend rewrites the
  bounded complete session and is intended for local, small-scale use rather
  than high-throughput hosted storage.
- Rust validates explicit observable projections and declared scopes, but does
  not authenticate principals, hide global activity metadata, or protect the
  complete administrative model definition. Those remain interface
  responsibilities.
- Legacy-registry innovations use a fast deterministic counter generator and a
  12-uniform normal approximation. Typed-model innovations use named SHA-256
  keyed draws and Box--Muller. Neither is suitable for cryptography or
  statistical claims without validation.
- Registry, parent, query, trajectory, and candidate hashes are canonical only
  inside this Rust protocol version. JavaScript/Rust byte-for-byte hash or
  random-stream parity is **not** claimed.
- Floating-point reproducibility is tested within this engine. Cross-platform
  bit identity is not promised because typed stochastic and hazard laws use
  platform transcendental functions. Exact replay is presently scoped to the
  same pinned engine build and platform.
- The typed machine executes scalar expressions only. Non-scalar values are
  validated and retained losslessly but do not yet have numerical operators.
- Complete model revisions can add dimensions and laws. Migrating an existing
  accepted world to a new model revision is not yet implemented.
- The legacy stateless form still resends and recompiles a registry. Stateful
  model/world/lineage operations require one NDJSON authority process; an
  optional state file recovers that authority after a restart.
