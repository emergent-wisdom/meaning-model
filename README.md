# The Meaning Model

**Construct worlds coarsely, then develop the parts that matter.** The Meaning
Model connects world records, concepts, descriptions, understanding, and story
text in one addressed representation. Finer detail must respect an accepted
account or revise it explicitly.

This repository brings together the theory, its compact grammar appendix, the
Rust engine and MCP interface, and *The Book of Conditions*, a worked
construction with a complete twelve-chapter manuscript.

See the [changelog](CHANGELOG.md) for release changes, upgrade notes, and
unreleased work.

## Three workflows in one server

One MCP server covers three kinds of work over the same engine and graph:

- **Modeling.** General-purpose, revisable world models of whatever you choose
  to model, such as a market, an institution or a technology, with an optional
  Jev estimator for cheap first estimates. See
  [general-purpose modeling](#general-purpose-modeling-and-optional-jev-estimation).
- **Narration.** The storytelling add-on writes fiction from a model, with an
  author model, whole-life character trends, scene review, alignment audits and
  deepening passes. See the [storytelling add-on guide](profiles/STORYTELLING_ADDON.md).
- **Ideation.** The alien add-on searches for solution mechanisms through
  invented worlds, following *Ontology of the Alien*, and curates them into a
  revisable map of idea families. See the [alien add-on guide](profiles/ALIEN_ADDON.md).

Modeling is always available; the two add-ons are opt-in with
`MEANING_MODEL_ADDONS`. Each workflow keeps what it does as revisable,
inspectable structure. None of them turns an estimate, a review or an idea into
evidence.

## Choose the model your application needs

Model only what serves your purpose. Choose the processes, categories,
relationships, and level of detail; use a supplied template, adapt its output,
or author a model directly. A single process is a valid starting point. A
browser, learning tool, or relationship application need not build the same
account of a person, or a complete person model at all.

The intended use is an external model an AI can work with: connect observations
across time, compare explanations, explore possible developments, and decide
what to investigate next. The modeler supplies those interpretations; the tool
preserves their structure and revisions and executes supported, declared laws.
Categories and decompositions are part of what the modeler develops and tests,
not a fixed inventory to fill in. Shared record and validation rules remain in
force as the application vocabulary changes.

See [application-specific categories](docs/examples/APPLICATION-CATEGORIES.md)
for template choices and a runnable vocabulary-revision example.

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

### Optional storytelling add-on

The narrative graph is the authoritative authoring record. Create the model
and graph before developing story material; store candidates, seed draws and
alternatives, drafts, assessments, selections, local revisions, and disclosure
plans through the tool. Files and PDFs are exports of graph content, not a
parallel manuscript or model. Use `life_story_author_record` for authoring
material and concise Understanding Nodes. Numerical exploration and revision
persist their results directly; neither accepts them as world facts.

Scenes can contain ordered, independently editable passage nodes. The shared
`life_narrative_edit` tool splits, merges, moves, reorders, or revises text in
one immutable graph revision. Splitting preserves the exact rendered prose;
editing reports affected reviews for reassessment. This tool is also available
without the storytelling add-on, for other graph-backed documents.

Set `MEANING_MODEL_ADDONS=storytelling` when starting the MCP server to expose
life-trend modeling, numerical trajectory exploration and local revision,
model-depth review, scene preparation, draft review, prose commitment, and advisory chapter or
section purpose review. The scene workflow requires overall
life trends for the principal cast: coarse life phases, changes and
continuities across them, and connections between those trends and each
scene. The calling LLM develops or reuses them automatically before drafting;
the user need not supply a dossier or request this step. A snapshot of the
current crisis is insufficient. The LLM supplies the model and review
judgments; the tool validates the dossier's
structure and binds scene reviews to it.

The LLM also builds or reuses an author model within the agreed delegation:
supported real-author evidence or an explicitly fictional persona, connected
to writing choices, useful contexts, and restraint. It stores the profile
through `life_story_author_record`, binds the selected version in scene and
purpose-review packets, and links committed prose through `shaped_by`.
The author remains distinct from the narrator and characters; the profile
does not require uniform prose or establish literary quality.

After drafting and substantive revision, the LLM assesses the author's voice
and each relevant principal character using actual prose and the processes
behind their speech and behavior. It saves intended versus observed effects,
evidence, uncertainty and repair-or-keep conclusions as Understanding Nodes.
The read-only `life_story_deepen` tool and prompt prepare a later revision of
the same work against an exact baseline. Local revision preserves premise,
cast and ending by default; structural revision is available within the agreed
brief. More detail or length is not automatically an improvement.

Before prose and after consequential model or story-context revisions, the
LLM automatically reviews whether the model explains the important choices
and outcomes. `life_story_model_depth_review` reads the bound model and
selected graph evidence; `life_story_model_depth_record` saves its findings
as an Understanding Node. The LLM examines relevant lives and flaws, concepts,
physical or institutional constraints, causes, and disclosure processes,
opening detail only where needed. Scene preparation requires a current
assessment; unresolved findings block commitment. Gaps remain saveable; this is no fixed taxonomy,
depth quota, or literary-quality score.

For new trajectories, the LLM samples numerical points for events and whole
lives, including emotional states on dimensions with explicit meanings, comparisons, units,
and bounds. `randomness` controls variation around a baseline, while a separate
candidate count controls the exploration budget. It assesses the candidates
for coherence and storytelling potential, then keeps, locally revises, or
rejects them. A weak transition need not cost the whole character: local
revisions preserve other values, fixed facts supplied to the sampler, and
allocation totals. Concise assessments and revision reasons belong in
Understanding Nodes linked to the relevant evidence. These candidates remain
creative hypotheses until accepted; they are not calibrated psychology or
physical simulations.

Optional structure exploration uses an ordinary seed
word to inspire alternative events, characters, relationships, or storylines
within the graph authoring workflow. Its suggestions remain unaccepted until the author
chooses and models them. For new principal-character, place, and organization
names, the LLM automatically uses a random word's sound, rhythm, or associations
to develop names that fit the story's style and existing names.

The LLM automatically performs advisory purpose reviews at completed chapters,
significant turning points, completed parts or works, and consequential
revisions. It considers the text's purpose, expectations, causal changes,
aftermath, life trajectories, and authored disclosure, while allowing ambiguity,
atmosphere, and delayed payoff. Keeping the text unchanged is a valid outcome;
the review cannot block saving. Anticipation, focal change, and adaptation can
use the core's optional change-arc structure without imposing a fixed plot
pattern. The bundled add-on uses the existing
narrative graph and preserves earlier revisions. It leaves the shared model,
laws, and default tools unchanged: company valuation
processes, physical processes, and other applications keep choosing their own
vocabulary and depth. See the [storytelling add-on guide](profiles/STORYTELLING_ADDON.md)
for the workflow and configuration.

### Optional alien add-on

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
ontologies informs which world to commission next, including family and outcome
combinations no candidate has yet; the choice stays with the caller. Promising mechanisms are transferred onto a
target model, with every role mapped and every disanalogy stated.

Everything lives in the narrative graph as Understanding Nodes. Every task text
is stored, so each output cites what its role actually saw. Graded fits and
weighted selections follow the Meaning Model's Cut rule. Each ontology can be
exported as Meaning Model concepts and specialization relations. Worlds are
textual thought experiments and transfers are ideas, not evidence. See the
[alien add-on guide](profiles/ALIEN_ADDON.md).

## Read first

The paper was revised on September 23, 2026, and the grammar appendix on
September 12, 2026.
The [Zenodo series](https://doi.org/10.5281/zenodo.22313515) provides the
archived versions.

- [Meaning Model paper](output/pdf/meaning-model.pdf) - the argument, grammar,
  construction method, examples, and numerical portrait.
- [Grammar appendix](output/pdf/meaning-model-grammar.pdf) - a focused reference
  to the same rules, not a separate theory or additional set of requirements.
- [The Book of Conditions](output/pdf/the-book-of-conditions.pdf)
  - the completed story; [Markdown and model sources](examples/book-of-conditions/README.md)
  are also included.

The six world-record forms are Concept, Thing, Event, Binding, Cut, and
Realization. A Cut divides one declared unit among exclusive sibling answers
and an explicit remainder; its weights sum to one. Ordinary process links are
unweighted. Dates, money, counts, and physical measurements keep their external
units. Understanding Nodes and Document Nodes share the address space without
acquiring the authority of accepted world facts.

## Try it

The smallest demonstration requires only Node.js:

```sh
node --test examples/refinement-trial/example.test.mjs
```

It shows a refinement that fits its parent, a locally valid refinement that
contradicts the parent, and an explicit revision. The example is synthetic,
not evidence that the full implementation or learning proposal is complete.

For the Rust engine and MCP tools, install Rust/Cargo, Node.js 22.18 or newer,
and npm, then run:

```sh
make install
make build
make test
```

For a native example, run `node examples/progressive-authoring/run.mjs` after
building. [Progressive authoring in Rust](examples/progressive-authoring/README.md)
opens a Cut after accepted history, rejects incompatible detail, completes a
partial temporal contract, and explicitly revises and continues the same world.

Start the MCP server after building:

```sh
cd mcp-server
npm start
```

See the [MCP guide](mcp-server/README.md), [engine guide](rust-engine/README.md),
and [modeling protocol](docs/MODELING_PROTOCOL.md). Existing `life-sim` command,
schema, resource, and binary identifiers are retained for compatibility with
saved artifacts. They do not identify a second engine.

The package name is
[`@emergent-wisdom/meaning-model-mcp`](https://www.npmjs.com/package/@emergent-wisdom/meaning-model-mcp).
Its official MCP Registry identity is `io.github.emergent-wisdom/meaning-model`,
described by [`server.json`](server.json). Registry-based clients must supply
the path to an explicitly installed or built engine. Install the engine matching
the package version. `meaning-model-mcp --install-engine` explicitly downloads
and verifies that version's published release engine. Alternatively, use
`meaning-model-mcp --build-engine` to build the included Rust source.
Neither npm installation nor normal server startup downloads or builds an
engine. To prepare a local npm tarball, run `make npm-package`. See the
[package installation guide](mcp-server/NPM-README.md). Creating a tarball does
not publish it or establish ownership of the npm scope.

## What is demonstrated

The Book is a bounded example of model-assisted authorship: macro accounts,
complete lives, local Cuts, event descriptions, linked construction rationales,
and prose were developed and revised together. Its accepted sources can be
imported into Rust and the manuscript rendered from document nodes. That
retrospective import is not a recovered transaction log of the original
authoring process.

The engine implements typed records, immutable revisions, persistence,
candidate acceptance, normalized Cuts, and bounded narrative graph operations.
Optional temporal Cut contracts check explicit answer projections and duration
mixtures, including whether partial detail leaves a feasible remainder.
An accepted world can move to its direct next model revision after time has
advanced, with an explicit refinement or revision, a compare-and-swap check,
and an immutable receipt preserving both heads. Portable narrative training
and project checkpoint exports across that revision boundary remain unsupported;
the session database retains the complete history.
It does **not** implement every contract in the paper. The
[implementation boundary](docs/IMPLEMENTATION.md) distinguishes implemented
checks, authoring conventions, and missing behavior. The preregistered matched
comparison and independent read-back study remain prospective. Neither a
passing validator nor an authored numerical portrait establishes historical
truth, psychological validity, or an advantage over ordinary writing.

## Repository map

| Path | Contents |
| --- | --- |
| `paper/` | Paper and appendix sources, shared style, figures, bibliography |
| `rust-engine/` | Shared Rust implementation, optional numerical simulation capabilities, tests and examples |
| `mcp-server/` | MCP interface to that engine |
| `profiles/` | Reusable authoring conventions, not mandatory human categories |
| `docs/` | Operational documentation and implementation limits |
| `examples/refinement-trial/` | Small standalone construction example |
| `examples/progressive-authoring/` | Native temporal refinement, explicit revision, and continued world history |
| `examples/book-of-conditions/` | Accepted Book, model sources, rationale nodes, and reproducible export |
| `output/pdf/` | Ready-to-read paper, grammar appendix, and Book PDFs |

Meaning Model owns the representation and joint construction method. The
separate **Life Simulation** project studies process-history generation,
inference, learning, and their empirical evaluation. It consumes this engine;
it does not maintain a second implementation. A digest-bound copy of its paper
is included only as a companion MCP reading resource under
`docs/companions/life-simulation/`.

## Build the documents

With `latexmk` and a LaTeX installation containing the imported packages:

```sh
make paper
make grammar
make book
```

To check the code, examples, resources, and documents together:

```sh
make check
```

## Release packaging

`make release` checks and builds the package, then exports an allowlisted clean
directory beneath `build/`. The export includes the three PDFs and their
sources, but not `.git`, build caches, private planning, review transcripts,
or earlier constructions.

See the [release guide](docs/RELEASE.md) for packaging and provenance details.
Exporting files does not push to GitHub or publish a package.

## License and citation

Original code is [MIT licensed](LICENSE). Original papers, documentation,
authored model data, and the Book are [CC BY 4.0](LICENSE-CONTENT).
[NOTICE](NOTICE) preserves the boundary for third-party material.
[CITATION.cff](CITATION.cff) identifies the author and preferred paper citation;
it includes the repository URL and the Meaning Model's Zenodo concept DOI.
The DOI identifies the paper's version series; the release manifest identifies
the exact files.
