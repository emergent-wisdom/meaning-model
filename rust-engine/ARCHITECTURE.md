# Engine architecture

The engine is one process that holds model revisions, worlds, candidates, narrative graphs and project checkpoints,
and answers one JSON command with one JSON response. Each module below has one purpose, and its doc comment states
the invariants it keeps.

## Module map

| Module | Purpose | Invariants it owns |
|---|---|---|
| `main.rs` | The process: arguments, stdin and stdout, one session | Every command gets exactly one response; an oversized or non-UTF-8 command never reaches the session |
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
  `narrative_views` and `checkpoints`.
- **The store:**
  - `operation`: every operation, its group, and whether it mutates;
  - `capacity`: the session's bounds;
  - `model_store` and `model_delta`: revisions kept as their changes;
  - `persistence`: the SQLite file;
  - `restore`: reopening a session and checking everything.

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
