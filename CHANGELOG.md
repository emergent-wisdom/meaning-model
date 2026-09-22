# Changelog

User-facing changes to the Meaning Model engine, MCP package, and bundled
artifacts. Released entries use package versions and UTC publication dates;
unpublished work stays under Unreleased. This is not a development transcript.

## Unreleased

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
