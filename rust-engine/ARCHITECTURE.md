# Engine architecture

The engine is one process that holds model revisions, worlds, candidates, narrative graphs and project checkpoints,
and answers one JSON command with one JSON response. Each module below has one purpose, and its doc comment states
the invariants it keeps.

## Module map

| Module | Purpose | Invariants it owns |
|---|---|---|
| `main.rs` | The process: arguments, stdin and stdout, one session | Every command gets exactly one response; an oversized or non-UTF-8 command never reaches the session |
| `heartbeat.rs` | Optional progress notices during commands | Notices go to stderr and never alter stdout responses |
| `lib.rs` | What every command shares: the response envelope, `EngineError`, the canonical hash | One canonical encoding: `hash_serializable` and `hex_digest` produce every content hash |
| `limits.rs` | Every bound the engine enforces, reported by `describe` | A bound is checked before the work or change it limits |
| `graph_algorithms.rs` | The shared cycle check | A refusal names one cycle |
| `model/` | The Meaning Model: values and pure functions | No state, files, clock or response codes; same inputs give the same outputs |
| `session/` | The authoritative store and its commands | Validate, then change; dirty rows written in one transaction; two failure outcomes |
| `profiles/` | Authoring profiles compiled into ordinary model definitions | A profile emits a plain `ModelDefinition`; there is no profile runtime |
| `registry/` | The legacy registry engine, its command path, and its adapter to the model | The legacy protocol is kept as it was |
| `description.rs` | The answer to `describe` | Built from the constants and the operation table the engine runs on |

Inside `model/`:
- **The authored form:** `definition`, and `meaning` (the optional Meaning Model layer).
- **Validity:** `compile` (validation, indexing and the model hash) and `revision` (what a revision may change).
- **A world over time:**
  - `world`: heads and revisions;
  - `query`: the transition query and its identity hashes;
  - `randomness`: named, keyed draws;
  - `transition`: the roll;
  - `candidate`: the proposed successor and its replay check;
  - `trajectory`: read-only summaries.
- **Reading:** `access` (the one access-scope rule), `view` and `graph`.
- **Writing about them:** `narrative` (graphs and their anchor check) and `project` (checkpoints).

Inside `session/`:
- **The command handlers**, one per operation group: `models`, `worlds`, `candidates`, `queries`, `narrative`,
  `narrative_views`, `checkpoints` and `store_queries` (lineage, heads, status and audit).
- **The store:**
  - `operation`: every operation, its group, and whether it mutates;
  - `capacity`: the session's bounds;
  - `model_store` and `model_delta`: revisions kept as their changes;
  - `store_rows`: revision seals, on-demand file reads and bounded row caches;
  - `persistence`: the SQLite file and atomic revision/seal writes;
  - `restore`: reopening from checked headers and the working set, or rebuilding every revision for an audit.

**Dependencies point one way:** `main` → `session` → `model` → crate root. `profiles` depends on the model, and the
session on `profiles` for `compile_profiles`. `model` imports nothing above the crate root, and the session's fields
are private to `session/`. The one loop is the legacy command path: the session passes any non-machine command to
`registry`, which answers `describe` from `description`, which lists the session's operations.

## How a command flows

1. `main` reads one command and calls `MachineSession::parse_and_execute`.
2. **Read** (`session.rs`): a command naming a machine operation is parsed into a `MachineCommand`, with the
   operation as an enum (`session/operation.rs`). Anything else goes to the legacy command path in `registry.rs`.
3. **Guard:** in a durable session, a mutating command is refused while earlier rows are unwritten.
4. **Validate** (handler and model): the handler resolves what the command names (`not_found`), checks its
   expectations against the store (`conflict`), and calls the model's pure functions, which compile, validate and
   roll (`invalid_request`). It checks capacity (`session/capacity.rs`) and builds its answer.
5. **Change:** only then does the handler change the store, marking each changed row dirty.
6. **Persist** (`session/persistence.rs`): a durable session writes the dirty rows in one SQLite transaction. The
   transaction first compare-and-swaps the file's generation, so a stale writer cannot overwrite a newer commit. If
   the write fails, the session reloads its file, and the caller gets `persistence_error` (not written) or
   `persistence_uncertain` (the COMMIT may have happened).
7. **Answer:** the result or error goes into the response envelope.

## Reading a large construction

A durable session holds the header of each revision and rows it has not written yet. Sealed revision rows stay in
SQLite until needed. A seal records the exact row's digest, its header and its parent's seal; reopening checks those
chains. Unsealed revisions are fully validated before seals are added. A later row read checks its digest before
using it. `audit_store` validates every revision again, and can replace the seals after a successful audit.

Row caches have byte budgets, with at most one oversized row retained. Model reconstruction walks headers first,
then reads and applies one delta at a time, so a long ancestry does not retain every delta outside the cache. Four
rebuilt models remain cached. Narrative revisions share unchanged records; heads and recent materializations each
have a 64 MiB cache budget, charged by serialized record size even when records are shared. At most one oversized
materialization remains in each cache. The recent cache also keeps at most 64 entries. Evicted heads can be rebuilt
on demand. These budgets measure payloads, not total process memory; revision headers and indexes still grow with
the construction, and rebuilding or answering a request needs temporary memory.

The first open of an unsealed store and a full audit still collect the unsealed rows before validating them. They do
not receive the sealed startup path's memory benefit; a store that is too large for that first validation must be
opened on a machine with enough memory. Subsequent sealed opens read the working set on demand.

`model_lineage` and `model_heads` use headers without rebuilding models. These store changes preserve the existing
revision rows and v3 SQLite format, so an engine without seal support can still read the same history. Seals are
integrity metadata, not a signature or protection against a party that can rewrite the database and its seals.

**Content addressing** runs through every step: a model, world head, candidate, narrative revision and checkpoint
are each named by the hash of their canonical content. A hash already bound to other content is a `conflict`.

## Where new things belong

**A new command:**
- Add a variant to its group's enum in `session/operation.rs`, with its name and whether it mutates; the exhaustive
  matches will not compile until both are given.
- Add it to `ALL`. `describe` lists it from there.
- Add any new command field to `MachineCommand`.
- Write the handler in that group's file: validate with model functions, check expectations and capacity, build the
  answer, then change the store and call `mark_dirty`.
- A new kind of stored row needs a `DirtyRow` variant, a table in `persistence.rs`, its checks in `restore.rs`, and
  a new `SESSION_STATE_SCHEMA`.

**A new law:** add a `LawOperator` variant in `model/definition.rs`. Every `match` on it is exhaustive, so the
compiler then lists each place to update:
- `compile.rs`: validation, and what the law reads and writes;
- `revision.rs`: what a refinement may change;
- `graph.rs`: its edges and visibility;
- `transition.rs`: its share of the work budget.

Two places are not checked by the compiler:
- `transition.rs` evaluates each kind in its own pass, picked out with `if let`, so a new kind needs its own pass
  in the step loop.
- `description.rs` lists the law kinds by name for `describe`.

**A new read** projects through the model and filters with `model/access.rs`. It never marks a row dirty.
