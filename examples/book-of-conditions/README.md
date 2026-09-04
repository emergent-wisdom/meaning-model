# The Book of Conditions

The accepted first construction is a twelve-chapter alternate history about
Charles Babbage, Ada Lovelace, and a fictional engineering estimator, Edward
Halden. Its accepted world contains one bounded calculating apparatus, a
successful test, and a calculation office whose commitments exceed its
independent checking capacity.

Read [the manuscript](BOOK-DRAFT.md) or the
[typeset book](../../output/pdf/the-book-of-conditions.pdf).
The text is authored fiction, not a historical reconstruction.

## What is included

- `WORLD-MODEL.md`, `WORLD-DATA.md`, `PROGRESSIVE-MACRO.md`, and
  `MACRO-PROCESSES.json` describe the accepted world, quantities, and trajectories.
- `PERSON-TEMPLATE.md` and `.json`, `PERSON-INSTANCES.json`,
  `PERSON-MODELS.md`, `HEALTH-PROCESSES.md`, `LIFECYCLE-REGISTRY.md`, and
  `FOUNDER-ROLE.md` expose the person models and their declared resolution.
- `SCENE-PROFILE-CUTS.md` and `NUMERICAL-STATISTICS.md` expose the compositional
  judgments and their numerical inventory.
- `STORY-ROUTE.md` associates the twelve chapters with world Events.
  `UNDERSTANDING-NOTES.md` preserves seventeen public construction rationales,
  including superseded assumptions explicitly identified by later notes.
- `MODEL-SCAFFOLDS-COMPILE.json`, the import and narrative scripts, and their
  tests reproduce the native model and linked text graph.
- `rust-construction/` contains a fresh release model, narrative graph, source
  manifest, and import receipt. Intermediate API responses and the SQLite
  database can be regenerated with the commands below.
- `grounding/` retains the frozen registry, adapter specification, 34 Sema
  Pattern Cards, and their recorded identities and verification results.

The inventory is 107 authored Cuts with 472 weights, plus one duration-derived
Cut with seven answers: 108 native Cuts and 479 weights. Thirteen people carry
117 unweighted life-process addresses. The narrative graph contains twelve
chapters and seventeen Understanding Nodes, plus their two roots. The
manuscript has 11,046 whitespace-delimited words.

## Provenance and scope

The Book was constructed under Henrik Westerberg's direction using
**GPT-5.6 Sol Ultra**, followed by **GPT-6 Astra Ultra** for later development
and revision.

This is a curated release of the accepted `07r2-pragmatic-successor`
construction. The original construction checkpoint remains in the Life
Simulation archive. This bundle reproduces the accepted model and manuscript;
it does not reproduce the original authoring process or its archival research.

The grounding files are copied byte for byte from the frozen source bundle.
Their recorded archival paths identify the original locations; in this release
the registry, adapter, index, manifest, and verification report are together in
`grounding/`, with cards in `grounding/patterns/`. Source hashes, the 34 encoded
bundle hashes, and full Sema identities were checked during release packaging.
The manifest's Pattern Card file hashes describe the pre-mint cards; retained
cards also carry the resulting Sema identity fields. Removing only those added
fields recovers all 34 recorded pre-mint file hashes.
The earlier mint and strict-handshake report is retained as an earlier receipt;
no new Sema mint is claimed. The retrospective Rust adapter does not import
these 34 definitions. Its separate local canonical claim example and its
grounding status are explicit in the exported native model.

The ordinary documentary cutoff is 14 August 1843. Babbage's access to
Lovelace's proposal is attested by a response meeting on 15 or possibly 16
August. The counterfactual transition spans 15–18 August; 18 August is its
first committed continuation, not an asserted historical reply date. Later
world facts and literal quantities are authored commitments unless separately
identified as historical.

This release includes a small prose revision and corresponding Event-description
and construction-note updates. Plot, dates, accounts, and Cut values are unchanged.
It removes the title-page dedication and internal subtitle, model-specific editorial labels, private preparation paths,
and external comparison commentary. Public rationale notes retain their
seventeen identifiers and Event associations; their retained text is not an
original execution log. Source paths now resolve within Meaning Model.
Consequently, source digests and registered model/graph hashes are new release
identities. Stable record IDs retain `07r2` to preserve their associations.

The Rust import is retrospective: it transcribes existing descriptions and
weights, validates structural constraints, persists the model and text graph,
and checks that native document rendering recovers the manuscript exactly.
It does not establish within-commit editing order, independent semantic
read-back, calibrated psychology, or superiority over another writing process.

## Reproduce

Run from the Meaning Model repository root with Node.js, Rust/Cargo, and a
LaTeX installation containing `latexmk` and Libertinus:

```sh
cargo build --release --manifest-path rust-engine/Cargo.toml
node --test --test-concurrency=1 examples/book-of-conditions/import-rust.test.mjs examples/book-of-conditions/rust-narrative.test.mjs
book_run="$(mktemp -d /tmp/book-of-conditions.XXXXXX)"
node examples/book-of-conditions/import-rust.mjs "$book_run/construction"
make book
```

The import requires a fresh output directory and accepts an optional engine
binary as its second argument. Otherwise the import and tests use
`LIFE_SIM_ENGINE_BIN` when set, then the release binary if present, or the debug
binary as a fallback. Each run writes a SQLite database, source
manifest, compilation/validation/registration responses, model, graph,
document rendering, and a receipt. The source manifest hashes all import
inputs and the engine binary. Timestamps and binary hashes can vary across
builds; they are provenance, not authored world values. The retained compact
export includes the receipt and the canonical model and graph, while the
receipt's other output hashes refer to reproducible intermediate files.

The Book build converts `BOOK-DRAFT.md` to a temporary TeX body and typesets
`story.tex`. Its output is
`output/pdf/the-book-of-conditions.pdf`.

To inspect a fresh database, run the engine with
`--state-file "$book_run/construction/construction.sqlite"` and send a command
on standard input, using hashes from that run's receipt:

```json
{"schema":"life-sim-rust-command/v1","operation":"get_model","model_hash":"<modelHash>"}
```

```json
{"schema":"life-sim-rust-command/v1","operation":"render_narrative_graph","narrative_graph_hash":"<graphHash>","narrative_render":{"root_ids":["document.book.07r2"],"access_scopes":[],"expected_graph_hash":"<graphHash>"}}
```

Understanding Nodes are public in the exported source and graph, but remain
excluded from the story rendering. To retrieve their content through the
native graph query, use the existing `book.07r2.authoring` access scope.
