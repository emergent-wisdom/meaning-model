# The Book of Conditions

The current twelve-chapter alternate history follows Charles Babbage, Ada
Lovelace, and the fictional engineering estimator Edward Halden. One bounded
calculating apparatus passes its test; the calculation office then promises
more work than its independent checking capacity can support. The story is
authored fiction, not a historical reconstruction.

Read [the manuscript](BOOK-DRAFT.md) or the
[typeset book](../../output/pdf/the-book-of-conditions.pdf). Both render the
same reviewed edition. This example is an exported continuation, also available
for import into the [story repository](https://github.com/emergent-wisdom/story#readme).
Each repository's publication manifest identifies its actual edition. Updating
this example does not update the Writer's database or establish that the two
repositories contain the same revision.

## The current example

- [The portable model](the-book-of-conditions.meaning-model.json) contains the
  current native Book model, document graph, attributed understanding and
  reviews, and Nora Vale's separate fictional author life.
- [The publication manifest](PUBLICATION-MANIFEST.json) records model, graph,
  prose and bundle hashes, the inventory, and the publication projection.
- [The publication mapping](book-publication-exploration-manifest-2026-10-02.json)
  records the latest path cleanup without discarding construction history or
  relabeling historical reviews as new approvals.
- `BOOK-DRAFT.md` is the exact native rendering of that graph.
- `import-rust.mjs` imports and verifies the bundle through the public MCP tools.
  Its name preserves the existing command; it no longer rebuilds an earlier
  model from separate Markdown tables.
- `story.tex` and `build-story-body.mjs` typeset the manuscript.

The 2 October 2026 edition has 589 Events, 257 processes, 120 normalized Cuts, and
34 rendered passage leaves across twelve chapters (13,342 whitespace-delimited
words). Every leaf explicitly links to the Events it depicts. Nine qualitative
telling processes have 63 phases attached to positions in the text. Spatial
records distinguish declared geography, scene staging and unknown journeys.
Nora's life belongs to a separate world and time; the viewer groups her with
the Book through explicit declarations.

The latest exploration asks which question makes two checks independent, and
when earlier evidence still applies after source figures or operating conditions
change. It refines two existing concepts and five case readings, then adds one
qualitative process, three openings of existing Events and twelve relations.
The four accepted jobs require 160 total checking hours: 60 in preparation and
100 after the final returns, twenty more than the 80 hours then available.

Independent readings supported keeping the already reviewed prose unchanged.
A fixed four-target read-back used one isolated reader per condition: selected
passages with context conveyed all four targets; the same context alone conveyed
two and partially supported two. This is bounded evidence of meaning recovery,
not a claim that the unchanged prose improved or that the planned comparative
evaluation has been run.

Fifty of the 120 current normalized Cuts record a textual basis; the other 70 retain
untracked text freshness. Reassessments preserve their attributed reasons and
history. The latest qualitative pass does not renew all those assessments or
re-estimate their values. Recorded text matching does not calibrate the quantities
or establish psychological truth. All current telling phases have been checked against their
passages; their interpretations remain authored and revisable.

## Open or continue with the MCP

Download the model file separately from the tool. Ask your MCP-enabled assistant
to import it with `life_construction_import`, using its absolute local path as
`sourcePath` and a new `requestId`. Then open the returned graph with
`life_model_viewer_open`, using `accessScopes: ["book.07r2.authoring"]`. Choose
`mode: "live"` when continuing the work so the viewer follows saved revisions.

The bundle contains 66 graph revisions and seven native model definitions:
six successive Book revisions and Nora's separate life model. The two current
models are the selected Book revision and Nora; the others preserve the Book's
development. The exported lineage starts at the September 29 publication root;
missing earlier private history and construction clock times are not invented.

The latest publication cleanup changes one local path in a historical review
to its artifact filename, replays the affected suffix and adds a disclosure.
Historical reviewer, task and reviewed-material hashes retain their original
meaning. Native models and rendered prose are unchanged by that cleanup, and
private source artifacts are not bundled. New authoring builds on the imported
head; construction replay can inspect the preserved sequence.

## Verify locally

From the Meaning Model repository root, with Node.js and Rust/Cargo installed:

```sh
make install build
node --test examples/book-of-conditions/import-rust.test.mjs
book_run="$(mktemp -d /tmp/book-of-conditions.XXXXXX)"
node examples/book-of-conditions/import-rust.mjs "$book_run/construction"
```

The importer refuses an existing output directory. It checks the bundle and
manuscript hashes, imports into a fresh SQLite database, verifies the complete
selected revision chain, inspects the model and
author dependency, and verifies exact prose rendering and current telling
phases. Its tests also verify passage grounding. Generated database and
verification receipts stay in the chosen output directory. No canonical
writer database is touched.

With LaTeX, `latexmk` and Libertinus installed, `make book` rebuilds
`output/pdf/the-book-of-conditions.pdf`.

## Provenance and earlier results

The Book was constructed under Henrik Westerberg's direction by Codex and Claude,
using GPT-5.6 Sol Ultra, then GPT-6 Astra Ultra and Claude Opus 5.5 for later
development and revision. The latest continuation used GPT-6.1 Sol Ultra through
the frozen `0.6.4-dev.exploration.6c5047708861` tool package. Nora is
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
