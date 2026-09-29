# The Book of Conditions

The current twelve-chapter alternate history follows Charles Babbage, Ada
Lovelace, and the fictional engineering estimator Edward Halden. One bounded
calculating apparatus passes its test; the calculation office then promises
more work than its independent checking capacity can support. The story is
authored fiction, not a historical reconstruction.

Read [the manuscript](BOOK-DRAFT.md) or the
[typeset book](../../output/pdf/the-book-of-conditions.pdf). Both render the
same current edition. Its model comes from the same canonical authoring state
used to prepare editions for the [story repository](https://github.com/emergent-wisdom/story#readme).
Each repository's publication manifest identifies its actual edition; a release
copy is not a second authoring source.

## The current example

- [The portable model](the-book-of-conditions.meaning-model.json) contains the
  current native Book model, document graph, attributed understanding and
  reviews, and Nora Vale's separate fictional author life.
- [The publication manifest](PUBLICATION-MANIFEST.json) records model, graph,
  prose and bundle hashes, the inventory, and the publication projection.
- `BOOK-DRAFT.md` is the exact native rendering of that graph.
- `import-rust.mjs` imports and verifies the bundle through the public MCP tools.
  Its name preserves the existing command; it no longer rebuilds an earlier
  model from separate Markdown tables.
- `story.tex` and `build-story-body.mjs` typeset the manuscript.

The 29 September 2026 edition has 581 Events, 256 processes, 120 Cuts, and
34 rendered passage leaves across twelve chapters (13,020 whitespace-delimited
words). Every leaf explicitly links to the Events it depicts. Nine qualitative
telling processes have 63 phases attached to positions in the text. Spatial
records distinguish declared geography, scene staging and unknown journeys.
Nora's life belongs to a separate world and time; the viewer groups her with
the Book through explicit declarations.

The latest pass develops the characters' beginnings, the undertaking's mechanisms,
shared pleasure and the household's exposure. Independent readings led to bounded
model and prose repairs. A three-question read-back used a frozen key and one
isolated model reader per condition: the revised passage made the undisclosed
household authorization recoverable, while the other two points were already
recoverable in the control. Two small copyedits followed that reading. This is
limited qualitative evidence, not the planned comparative evaluation.

Fifty of the 120 current Cuts record a textual basis; the other 70 retain
untracked text freshness. Reassessments preserve their attributed reasons and
history. Recorded text matching does not calibrate the quantities or establish
psychological truth. All current telling phases have been checked against their
passages; their interpretations remain authored and revisable.

## Open or continue with the MCP

Download the model file separately from the tool. Ask your MCP-enabled assistant
to import it with `life_construction_import`, using its absolute local path as
`sourcePath` and a new `requestId`. Then open the returned graph with
`life_model_viewer_open`, using `accessScopes: ["book.07r2.authoring"]`. Choose
`mode: "live"` when continuing the work so the viewer follows saved revisions.

The package contains a current-state publication, not private development
history: one graph revision and two model roots. Historical review records
retain their original reviewed hashes and findings. Personal commissioning
wording is summarized in the public projection; source-world quantities and
accepted prose are unchanged. New authoring builds on the imported edition.

## Verify locally

From the Meaning Model repository root, with Node.js and Rust/Cargo installed:

```sh
make install build
node --test examples/book-of-conditions/import-rust.test.mjs
book_run="$(mktemp -d /tmp/book-of-conditions.XXXXXX)"
node examples/book-of-conditions/import-rust.mjs "$book_run/construction"
```

The importer refuses an existing output directory. It checks the bundle and
manuscript hashes, imports into a fresh SQLite database, inspects the model and
author dependency, and verifies exact prose rendering and current telling
phases. Its tests also verify passage grounding. Generated database and
verification receipts stay in the chosen output directory. No canonical
writer database is touched.

With LaTeX, `latexmk` and Libertinus installed, `make book` rebuilds
`output/pdf/the-book-of-conditions.pdf`.

## Provenance and earlier results

The Book was constructed under Henrik Westerberg's direction using GPT-5.6 Sol
Ultra, followed by GPT-6 Astra Ultra for later development and revision. Nora is
an invented compositional persona for continuation, not the recovered identity
of an original author or a character living in nineteenth-century England.

The ordinary documentary cutoff is 14 August 1843. Babbage's access to
Lovelace's proposal is attested by a response meeting on 15 or possibly 16
August. The counterfactual transition spans 15–18 August; 18 August is its
first committed continuation, not an asserted historical reply date. Later
world facts and quantities are fictional commitments unless separately sourced.

The paper distinguishes the first construction's historical measurements and
validation limits from this revised edition. Its earlier tables, grounding
cards, retrospective importer and receipts remain available in the
[v0.5.2 repository history](https://github.com/emergent-wisdom/meaning-model/tree/v0.5.2/examples/book-of-conditions).
They are no longer a parallel active example. Structural checks establish
record integrity and reproducible rendering, not historical truth,
psychological calibration or literary quality.
