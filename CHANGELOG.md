# Changelog

User-facing changes to the Meaning Model engine, MCP package, and bundled
artifacts. Released entries use package versions and UTC publication dates;
unpublished work stays under Unreleased. This is not a development transcript.

## Unreleased

Together these changes make one server cover three kinds of work: general-purpose
modeling with an optional Jev estimator, narration through the storytelling
add-on, and ideation through the new alien add-on. Both add-ons are opt-in with
`MEANING_MODEL_ADDONS`; without it the server exposes the base tools only.

- Add the opt-in alien add-on (`MEANING_MODEL_ADDONS=alien`), following *Ontology
  of the Alien*, whose paper is bundled and must be read before a search. The
  add-on:
  - builds target-blind worlds from seed words or commissions, solves the problem
    inside them, and compiles the operative mechanisms, under any cell of the
    paper's condition matrix;
  - curates the results in three revisable ontologies: mechanism families, claimed
    outcomes and causal world regimes;
  - transfers promising mechanisms onto the target model.

  The server stores every role task and checks each recorded output against the
  task it cites. It admits a new family only when the equivalence test records a
  changed primary operator, and it diagnoses gaps, uncombined family and outcome
  pairs, saturation, redirect chains and world coverage. Fits and weighted
  selections are Cuts with a remainder. Every record is an Understanding Node in
  the narrative graph, and each ontology can be exported as Meaning Model concepts
  and specialization relations.
- Label estimator results with `epistemicStatus: "ai_inference"` and
  `evidenceType: "estimate"`, the pair the graph records they produce already
  use, instead of reporting the inference status as an evidence type.
- Name the prose size, the bound model size and the largest context records
  when a story deepening task exceeds its size limit.
- Add a second judge for alien curator decisions, `life_alien_decision_check`.
  With the Jev estimator configured it answers the curator's comparison as
  bounded questions (nearest earlier concept, whether the primary operator
  changed, fit) without seeing the curator's reasons, can record the result,
  and the diagnosis lists disagreements.
- Add world libraries: `life_alien_worlds_export` writes target-blind worlds with
  their regime classification and signature codes as a content-addressed bundle,
  and `life_alien_worlds_import` records them in another search, checked against
  that search's target terms, so it starts at the solver.
- Let an alien candidate carry a graded membership, a Cut over the families it
  draws on with a remainder, beside its categorical assignment; the diagnosis
  lists hybrids.
- Split long concept operators, boundaries and lenses in the alien atlas's Meaning
  Model fragments into several entries within the engine's 1,024-byte bound per
  text, instead of exporting concepts the engine refuses to register.
- Add `examples/alien-retirement`, the first live alien search: its atlas, a
  four-world library, the ontologies as Meaning Model fragments and the target
  model, with a test that imports the library into a search on another problem
  and registers the model with the ontologies merged in.
- Add `examples/integration-time`, a hard science-fiction story written in the
  storytelling add-on and revised in five passes, each answering a blind reader:
  the story, its final model and narrative graph with every review and audit,
  and the readers' reports, with a test that re-registers the model and graph on
  a fresh engine and renders the story byte for byte.
- Keep model anchors that name the model by its stable id when
  `life_narrative_rebind` moves a graph to a successor model; only anchors that
  name the predecessor hash are dropped.
- Accept Jev Score answers whose score differs from its two-decimal probabilities
  by rounding, and decline an answer that fails validation on its own coordinate
  in `life_process_estimate` instead of discarding the whole batch. Declined
  answers are kept, and usage is always returned. A malformed provider response
  now returns a diagnostic with the response and usage instead of a bare error.
- Store a Score estimate with the standard deviation of Jev's distribution over
  the declared levels as its uncertainty, or, with `summary: "median"` for an
  ordinal rubric, the median level with its interquartile levels. The world
  builder's preview shows each answer's probabilities and confidence.
- Let `life_process_estimation_record` record a data-only proposal submitted
  through the estimation exchange, such as the caller's own dated history. Each
  value keeps its holder, evidence type, cutoff and uncertainty. Add
  `validateOnly` to `life_world_model_build`, which checks a scaffold without
  calling the estimator, and a per-process `updateMode`, so a measured series
  whose starting value is only an estimate can still take observed reports.
- Report in `life_model_revise` which changes a world on the parent revision
  cannot adopt: a removed process, or a changed value type, axes, unit, reference
  frame or scale. `requireWorldAdoptable` refuses such a revision before it is
  registered. `life_world_revise` names claims that disagree with the revised
  state and new processes with no claim.
- Let `life_model_ingest` and `life_estimate_cut_shares` declare a conditioned
  question, whose Cut divides one answer of another Cut, and warn when that
  answer carries under 0.05. With a graph, the ingest records each question's
  answer and remainder meanings and the exact situation text judged, and its
  notes can link to each other.
- Serve the Meaning Model and Ontology of the Alien papers with their included
  files inline, so the resource carries the core schema box, the figures and the
  decision trees. State the default purpose in `life_general_modeling_start`, and
  name the owning tool when an estimator preview id is passed to the estimation
  inspector. The general modeling guide gains a worked recipe for recording dated
  history.
- Add `examples/crypto-market`, a general-modeling run on how US monetary
  conditions reach the crypto market, built from recalled public records and
  checked against retrieved sources, with a test that re-registers the model and
  graph on a fresh engine and runs a world from it.

- Add the `realizes_forecast` event relation. Its `forecast_answer` names a
  normalized Cut on the source event and the answer key, remainder included, that
  the target continuation realized; the engine checks the Cut, its parent event and
  the answer, and allows one realized continuation per Cut. Models without the
  field serialize and hash as before.
- Let model-depth evidence cite model records by `kind:id` (for example
  `process:bakery.debt_nok`) instead of array-index JSON pointers; the server
  resolves the reference and rejects unknown ones.
- Keep model-depth reviews fresh when only the story root's text changes, such
  as a retitle, and name the changed nodes and edges when a review is stale.
  Reviews recorded before this change keep their original freshness rule.
- Report reviews linked to a document root as ancestor reviews when only that
  root is edited, instead of listing every whole-document record as directly
  affected.
- Add a `life_narrative_batch` request to the minimal model-and-graph example and
  state the batch payload shape in the tool description.
- Shorten the `life_story_structure_explore` generator task for names and
  structures: it keeps the target instructions and graph-authoring rules and
  points to the author-model guidance instead of repeating it.
- In chunked alignment audits, attach the whole-unit score for the same record to
  each passage contradiction flag and report the arbitration as upheld, cleared
  or close.

- Add `life_direction_draw`: the server computes a seeded draw over a registered
  model's normalized Cut and can record it in a graph bound to that model. An
  earlier draw over the same Cut is reported and linked, so a second draw is a
  visible reroll rather than a silent replacement.
- Keep the paper-first access record when `life_modeling_context` is called again
  for the same purpose, so the gate can be checked after reading; a different
  purpose, `new_domain` or `consequential` still begins a new record. The tool is
  no longer annotated read-only.
- Return the successor graph as `graphHash` from a recorded alignment audit, with
  the audited revision as `auditedGraphHash`, so later writes do not branch from
  the pre-audit graph.
- Name the finding and the node when a model-depth record cites evidence outside
  the reviewed context, listing every such node at once.
- Warn at exploration time when a life trajectory's first point is after birth,
  before a life-trends dossier would reject it.
- Lead each storytelling tool description with what the tool does and include the
  intake rule once; the scene-start prompt no longer repeats it.
- Prompt every modeling purpose to consider authored numerical judgment scales,
  useful conceptual decomposition, and variation across dates or perspectives.
  Require these considerations before general world construction, with actual
  record references or reasons for uncertainty and scope exclusions; ingest
  declared native concepts and abstract cuts and preserve the reviews as
  Understanding Nodes. No fixed vocabulary or quota of scores or cuts is required.
- Return inspectable cached diagnostics for rejected initial-estimation answers,
  preserving the received questions, answers, source context and usage without
  creating a proposal or writing a model, graph or world. Identical retries do
  not repeat the provider call; numerical validation policy is unchanged.
- Require a broader-context and longer-term review before compact world-model
  construction, including its Jev initial estimates. Validate processes, sources and
  temporal coverage; preserve represented context, unknowns and justified
  exclusions as Understanding Nodes. Guide agents from enclosing systems and
  history toward focal processes, and revisit context during later deepening.
- Add a general-purpose modeling workflow alongside the opt-in storytelling
  add-on: compact world/model/graph construction, optional batched Jev process
  estimation, exact proposal review, and durable numerical records with
  Understanding Nodes. Process definitions, units, evidence, scope and depth
  remain application-defined; estimates are not promoted to runtime observations.
- Bind estimator previews to exact apply proposals and retain bounded retry
  receipts. Preflight graph completeness and note references; report partial
  multi-step results. Preserve hidden graph records during rebind. Validate audit
  answers, preserve evidence audiences, distinguish disclosure audiences, and
  exclude earlier diagnostics from default audit evidence.
- Add estimator tools to the default surface: `life_estimate_cut_shares`,
  `life_model_ingest` and `life_narrative_alignment_audit`, plus `life_narrative_rebind`.
  Without configuration the estimator tools return their mechanically generated
  questions as a task for the calling LLM. With `MEANING_MODEL_ESTIMATOR=typesafe` and
  `TYPESAFE_API_KEY`, TypeSafe's Jev scores them. Cut-share proposals carry estimator
  provenance and an automatic remainder and can be placed as one model revision with
  `apply`; ingest creates described events, estimates several Cuts each, registers the
  revision, rebinds a bound graph and stores notes as Understanding Nodes in one call;
  the audit checks rendered prose against the graph's records per passage and can
  record its scores as a derived-diagnostic node. Rebind moves a model-bound graph to a
  successor model, keeping every node and dropping only predecessor model anchors.
  Weights and scores are AI inference; nothing enters the model or graph without an
  explicit `apply` or `record`.
- Reduce authoring friction found in the 2026-09-22 dogfood run. Serve
  `life-sim://example/minimal-model-and-graph` with complete, test-verified compile,
  model and graph payloads, and point the registration tools at it. Say in the
  paper-first gate message that the access record starts at `life_modeling_context`.
  Add `forRevision` to `life_narrative_query` so a full read can be resubmitted as a
  successor. Accept an optional scene `worldTimeEnd` so knowledge acquired during a
  scene can be declared. Accept `compensateAxisId` in trajectory revisions. Name the
  changed component in stale depth-assessment errors, distinguish a missing draft
  node from a text mismatch in review errors, and report directly affected reviews
  separately from container reviews in edit receipts. Document field types and the
  allocation `id` in the add-on guide.

- Add the shared `life_narrative_edit` tool for atomic passage splitting,
  merging, moving, reordering and local text changes through immutable Rust
  graph revisions. Preserve unrelated records, predecessor versions, the
  frozen source snapshot and explicit model grounding; reject incomplete scoped views and ambiguous
  topology. Report affected review evidence for reassessment.
- Allow the storytelling add-on to commit a reviewed scene as a container
  with independently editable passage nodes. Passage boundaries and IDs bind
  to the exact reviewed draft, and creation remains one atomic graph write.
  Choose units by what can change independently, without a paragraph quota.

- Add the read-only `life_story_deepen` tool and prompt to the storytelling
  add-on, bringing it to twelve tools and four prompts. Bind an existing
  work's exact graph, model and rendered baseline, with depth and purpose
  review tasks, for a later revision round. Default local scope preserves
  premise, cast and ending; structural scope permits justified larger changes
  within the agreed brief. Preserve baseline and revision evidence in the
  graph, re-review affected work, and check final narrative placement when
  replacing append-only scene commits. There is no reroll or length quota.
- Require the calling LLM to assess actual-prose author and principal-character
  voices after drafts and substantive revisions, with character speech and
  behavior grounded in modeled processes. Save individual evidenced findings,
  uncertainty and repair-or-keep conclusions as Understanding Nodes. Model
  depth review now inspects these explanatory connections; literary success
  remains advisory.

- Add typed `author_model` records to the storytelling add-on's existing
  `life_story_author_record` tool. Model a real author from supported evidence
  or an explicitly fictional author persona; distinguish the modeled author
  from the recorder, narrator, viewpoint, and cast. Connect outlook and habits
  to writing consequences, useful contexts, and restraint, with optional
  dimensions defined for meaningful comparisons. Automatically build or reuse
  the model for new generation within the human's delegated scope, including
  life stage at composition, writing history, and reasons for this work now.
  Store these in existing evidence and dispositions; keep unknown real-author
  context unknown and invented choices explicit. Allow mixed, evolving motives
  and exploratory work without imposing a thesis. Scene
  preparation and purpose review can bind the exact author profile; scenes
  record its application and `shaped_by` provenance. Profiles and revisions
  stay author-only, and style judgments remain advisory. No new tool or
  shared-model semantics are introduced.

- Distinguish initial story settings from the human author's ongoing
  involvement. When unknown, ask whether they want to supply all, some, or
  receive proposed settings, and whether work should be autonomous, checked
  at selected milestones, or collaborative throughout, with custom
  checkpoints allowed. Reuse explicit preferences and delegation, accept
  partial briefs, and record choices in scoped graph records. Automatic
  modeling and reviews stay within the agreed scope; standalone reviews and
  edits do not trigger a full intake.

- Add `life_story_model_depth_review` and `life_story_model_depth_record` to
  the optional storytelling add-on. Review the actual bound model and stored
  story evidence before prose and after consequential revisions, then save
  coverage explanations and findings as linked Understanding Nodes. Require
  a fresh assessment during scene preparation and block commitment on
  unresolved findings; save those findings and drafts while their smallest
  useful repairs are developed.
  Bind evidence to the frozen source and relevant graph records, allowing
  unrelated author notes or drafts without invalidating the assessment.
  The LLM chooses relevant explanatory subjects; no fixed taxonomy, depth
  quota, or story-quality score is imposed.

- Review whether principal-character flaws affect choices and consequences,
  and prefer local repairs. Request independent readings at substantial
  milestones when available; otherwise label self-review. Randomness alone
  does not establish characterization or review quality.

- Keep authoring in the existing graph: add `life_story_author_record` for
  drafts, candidates, decisions and scoped Understanding Nodes under a named
  author-process root and authoring clock. Numerical exploration/revision
  persist their records; revisions read their predecessor from the graph.
  Scene review requires the exact stored draft, and commit writes its review
  as a linked Understanding Node. Files and PDFs are graph exports.

- Add a bundled storytelling workflow, enabled explicitly with
  `MEANING_MODEL_ADDONS=storytelling`, for preparing graph-bound scenes,
  reviewing exact drafts with authored findings and excerpts, and committing
  prose with a linked Understanding Node review in one Rust narrative batch.
- Require principal-character life trends in that scene workflow. Add
  `life_story_life_trends` to validate and store author-supplied overall lives
  as ordered phases, trend summaries, and explanations of change or
  continuity. Scene preparation requires the dossier and explicit character
  connections; life-trend and cast-coverage review findings can block
  commitment. An open future is valid, and the dossier remains author context
  rather than automatic character knowledge or reader disclosure.
  Direct the calling LLM to construct or reuse these life models automatically
  before drafting, without requiring the user to request or fill them in.
- Add `life_story_trajectory_explore` and `life_story_trajectory_revise` to the
  optional add-on. Explore actual bounded numerical points for events or whole
  lives on explicitly defined axes, including emotional dimensions. Separate
  the amount of randomness from the candidate budget, support seeded replay,
  and preserve declared fixed values and disjoint allocation totals. Candidates
  are unaccepted creative hypotheses, not physical simulations or calibrated
  psychology. Local revisions preserve unlisted values and bind the parent
  candidate hash and reasons; category or time changes require a new proposal.
  Direct the LLM to evaluate coherence and storytelling potential and prefer
  useful local repairs over discarding an entire promising character. Optional
  life-dossier `trajectoryProposal` evidence retains the numerical candidate.
- Direct the storytelling LLM to store concise candidate assessments and
  revision reasons as genuine Understanding Nodes, using a named author root,
  `externalized_reflection`, explicit holders and author scopes, and specific
  `about`, `refines`, or `supports` links. These are deliberately authored
  explanations, not hidden model reasoning or automatically verified judgments.
- Add an optional `life_story_purpose_review` tool and prompt for the calling
  LLM to assess a chapter or section's purpose and fulfillment in context.
  Review distinguishes authored from inferred goals and allows atmosphere,
  ambiguity, and delayed payoff. It is advisory, writes no graph data, and
  cannot block saving.
  Direct the calling LLM to review automatically at completed chapters,
  significant turning points, completed parts or works, and consequential
  revisions. Scene commit receipts include a conditional review reminder.
  Review considers expectations, causality, aftermath, life trajectories, and
  authored disclosure when supported by context, with keep-as-is as a valid
  outcome and no rewrite quota.
- Add an optional `life_story_structure_explore` tool and prompt that prepare
  random-word inspiration tasks for the calling LLM. A bounded bank of common
  English words supplies seeds independently of the story brief; callers can
  also supply a word. The preparation call writes no model data and
  keeps candidate structures separate from accepted story facts.
  Add a `name` target and direct the LLM to use random-word inspiration for new
  principal-character, place, and organization names that fit the story's
  culture, language, tone, and existing names. Preserve established canon names
  unless a change is requested. The existing 160-word bank is unchanged.
- Connect storytelling guidance to the core's optional `change_arc_scaffold`
  for anticipation, focal change, and adaptation. Keep character experience
  separate from author processes for intended reader response, without
  requiring a fixed plot pattern or claiming to measure reader reactions.
- Add the `life-sim://addon/storytelling` resource and
  `life_story_scene_start` prompt for the scene workflow. Default tools,
  shared record schemas, executable laws, and general-purpose modeling remain
  unchanged; existing low-level tools remain available.

Install or build the matching engine when upgrading the MCP package.
The engine gains the `realizes_forecast` event relation and a source-preserving
narrative revision flag. Both are optional: models without the new field
serialize and hash as before, and models and graphs written by 0.2.x load
unchanged, so no data migration is required. The alien add-on is a first
release with one live search behind it; its worlds are textual thought
experiments and its transfers are ideas, not evidence. Jev estimates remain AI
inference and never enter a model or graph without an explicit apply or record.

## 0.2.1 — 2026-09-12

- Make application-selected processes, categories, depth, and optional layers
  explicit in the MCP modeling context, starter prompt, and user guides.
- Distinguish structural starters from experimental Story/Decision models;
  preserve existing template defaults, wire formats, and engine behaviour.
- Add a runnable category-revision example and a bundled guide to developing
  application-specific vocabularies.
- Clarify the paper's general-purpose scope, continuity of understanding, and
  linked world, understanding, and artifact surfaces while retaining its
  storytelling examples and preservation contracts.

Install or build the matching 0.2.1 engine when upgrading the MCP package.
Compared with 0.2.0, this release changes guidance and examples, not the engine's
modeling behavior or stored-data format; no data migration is required. Users
upgrading from 0.1.x should also read the 0.2.0 compatibility and limits below.

## 0.2.0 — 2026-09-06

### Added

- Refine an existing world after accepted history, or explicitly revise its
  commitments. Both operations check the expected world head and preserve
  immutable before-and-after receipts with a reason and provenance.
- Native temporal Cut recomposition checks: complete duration-weighted
  partitions must reproduce their parent; partial detail must leave a feasible
  remainder. Compatible partial partitions can be completed without rewriting
  earlier children.
- An explicit `--install-engine` command for version-matched prebuilt engines,
  with SHA-256 verification and safe replacement. The release workflow builds
  and checks macOS arm64/x64, Linux x64, and Windows x64 binaries before preparing
  a draft release.
- A runnable progressive-authoring example, including rejection of detail that
  normalizes locally but contradicts its parent.

### Fixed

- Invalid uncertainty values on narrative nodes are rejected.
- MCP command payloads cannot replace reserved operation, schema, or request-ID
  fields.
- Meaning Model queries and estimation-change validation include normalized
  Cuts, context roots, and temporal recomposition contracts, using each
  collection's correct record identifier.

### Changed

- Exclude internal manuscript-maintenance files from future source exports;
  functional engine, model, and example tests remain included.

### Compatibility and limits

- Install or build the matching engine when upgrading the MCP package. Existing
  wire names are retained; models without the new optional temporal contracts
  keep their previous hashes. No automatic data conversion is performed.
- New processes need explicit values at the current world time. Existing process
  shapes and units cannot be changed by a world revision.
- Revision-spanning histories persist in SQLite, and their narrative graphs can
  still be rendered. Portable project/checkpoint and accepted-history training
  exports across those revision boundaries remain unsupported.
- Prebuilt installation supports macOS 14+ arm64/x64, Linux x64 with glibc 2.35+,
  and Windows x64. It needs matching published assets; normal startup never
  downloads or builds an engine. Other platforms can build from source.
- The Book text and paper PDFs are unchanged by these engine improvements.

## 0.1.1 — 2026-09-05

- Added official MCP Registry metadata and the listing
  `io.github.emergent-wisdom/meaning-model`.
- Clarified `npx` setup and the required path to an explicitly built engine.
- Updated package/version reporting. Rust behavior and bundled model resources
  were unchanged from 0.1.0.

## 0.1.0 — 2026-09-05

- Initial npm release of `@emergent-wisdom/meaning-model-mcp`, providing a
  stdio MCP interface to the Rust engine with 36 tools and eight resources.
- Bundled Rust sources, modeling resources, presets, and an explicit
  `--build-engine` command. Ordinary installation and startup did not build
  an engine automatically.
