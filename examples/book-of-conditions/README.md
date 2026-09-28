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

The 28 September 2026 edition has 401 Events, 238 processes, 108 Cuts, and
34 rendered passage leaves across twelve chapters (11,675 whitespace-delimited
words). Every leaf explicitly links to the Events it depicts. Three qualitative
telling processes have 22 phases attached to positions in the text. Spatial
records distinguish declared geography, scene staging and unknown journeys.
Nora's life belongs to a separate world and time; the viewer groups her with
the Book through explicit declarations.

The manuscript and model remain open to revision. The latest literary pass
clarifies supervised lessons versus protected training, gives production's
interruption of teaching a concrete scene, and reduces repeated explanation.
Independent readers compared complete baseline and candidate texts, followed
by targeted repairs. This was not a blind evaluation of the exact final edition.
All 108 numerical compositions are preserved. A subsequent content review
resolved six succession-Cut flags, replaced four question-only assessment
descriptions with scene-specific accounts, and recorded why the existing
values still fit. The six Cuts retain their earlier provenance and now track
their current assessment texts; the review also links to the succession Event
and supporting passages. The other 102 Cuts retain untracked text freshness.
This is an attributed reassessment, not calibration of the quantities.

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
