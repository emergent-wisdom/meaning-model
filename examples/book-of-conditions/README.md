# The Book of Conditions

This independent rewrite begins with Ada Lovelace's offer to conduct the
business of the Analytical Engine. Babbage goes on negotiating instead of
refusing. The writer follows what that change could mean for their lives,
the people drawn into the work, and the machine they try to build.
The resulting twelve-chapter novel is alternate history, not a historical
reconstruction.

Read [the manuscript](BOOK-DRAFT.md) or the
[typeset book](../../output/pdf/the-book-of-conditions.pdf).
`BOOK-DRAFT.md` is the exact native rendering of the published story graph.
The graph remains the source of the manuscript.

## How it was made

Claude Opus 5.5 generated the world model, story and revisions automatically
from a [human-supplied task](CONSTRUCTION-TASK.md) and
[historical source package](HISTORICAL-SOURCES.md). The human authorized
continuation and a deeper pass; three fresh Claude Sonnet 5.5 readers supplied
editorial criticism, without seeing the older book. The writing agent revised
its model and chapters in response. No human supplied replacement prose.
Automatic authorship here does not mean an absence of human inputs,
supervision, feedback or stopping decisions.

The writer used the Meaning Model candidates `7e4f6b7`, then `76f18f1`,
leading to 0.10.0, with the storytelling add-on and Sema. The earlier Book
modeling example, the two papers describing it, its trajectory figure and
the number-test guide were withheld. Generic Babbage, Lovelace and engine
dates and unopened scaffolds remained available. They contained no earlier
plot, prose, wants or values. The run is an independent construction, not a
continuation of the earlier Book's graph.

Margaret Ellery Vane is an explicitly invented narrative persona recorded
by the writing agent. She is not a real author, and this run declares no
separate native author-life model. Nora Vale belongs to the earlier edition.

## The published construction

- [The portable model](the-book-of-conditions.meaning-model.json) holds the
  complete selected construction: 85 native model definitions and 84 graph
  revisions, including the attributed reasoning, drafts and reviews.
- [The publication manifest](PUBLICATION-MANIFEST.json) identifies the model,
  graph, manuscript and bundle by their hashes.
- [The full-history record](the-book-of-conditions-full-history-2026-10-11.json)
  describes the input, generation, publication scope and remaining limits.
- `import-rust.mjs` imports and checks the bundle through the public MCP tools.
  `story.tex` and `build-story-body.mjs` typeset the exact manuscript.

The selected model is revision 84, with 571 Events, 202 processes, 540
normalized Cuts, 13 Concepts and 188 dated value series. Six causal questions
have 19 authored assessments. The complete manuscript has 23,441 whitespace-delimited words, including
its five-word title; the twelve chapter passages contain 23,436. These are construction measurements, not
validation of the historical or psychological quantities.

The agent initially mislabeled three editorial readers as human. Three later
records identify them as fresh, no-tool Claude Sonnet 5.5 instances and
explicitly supersede the originals. The reviewed graph, model and rendering, verdicts, finding counts, categories,
severities and quotations stay the same. Reader 3 also paraphrased two finding
texts; both versions remain in the native history. The correction does not
renew approval of the final manuscript.

Four further fresh Claude Sonnet 5.5 comparative readers preferred the rewrite
to the earlier published book overall. Two received each order. The normalized
manuscripts differed in length: 23,448 versus 13,337 words. This is a bounded
model-reader judgment, not human literary validation or a controlled test
of the full method.

The model is still open. The 0.10.0 coverage check reports 6,817 scheduled
readings missing and 141 processes passing over some Events without a value;
all 14 people pass its basic development check. It has no executable laws,
separate author life or qualitative telling-process records. Subjective
values and counterfactual causal readings remain authored and revisable.

## Open or continue

Install the tool from [meaningmodel.ai](https://meaningmodel.ai/), then download
the model file separately. Ask your assistant to import it with
`life_construction_import`, using its absolute local path as `sourcePath` and
a new `requestId`. Open the returned graph with `life_model_viewer_open`,
using `accessScopes: ["author"]`. Choose `mode: "live"` when continuing so
the viewer follows saved revisions.

The compact bundle uses the v2 history format, supported from 0.8.0; its full
import, hashes and rendering are checked with the released 0.10.0 tools.
Construction order is preserved. Wall-clock construction times are not
invented. The exported native construction was screened across every stored
revision, including embedded record JSON, for private material. No replacement
was needed. Private databases, conversations, harness files and coordination
notes are not included.

## Verify locally

From the Meaning Model repository root, with Node.js and Rust/Cargo installed:

```sh
make install build
node --test examples/book-of-conditions/import-rust.test.mjs
book_run="$(mktemp -d /tmp/book-of-conditions.XXXXXX)"
node examples/book-of-conditions/import-rust.mjs "$book_run/construction"
```

The importer refuses an existing output directory. It verifies the full chain,
exact manuscript, passage grounding, authored persona and corrected reviewer
records in a fresh database. It never touches a canonical writer database.
With LaTeX, `latexmk` and Libertinus installed, `make book` rebuilds the PDF.

## Earlier editions

The previous active example, with the prose of 2 October and model of 6 October
2026, remains in the
[v0.10.0 repository history](https://github.com/emergent-wisdom/meaning-model/tree/v0.10.0/examples/book-of-conditions).
It is a different construction with its own measurements, privacy projection
and fictional author life. This rewrite does not retroactively change its
reviews or the paper's historical measurements. The older
[Story publication](https://github.com/emergent-wisdom/story#readme) remains a
separate edition unless its own publication manifest is updated.
