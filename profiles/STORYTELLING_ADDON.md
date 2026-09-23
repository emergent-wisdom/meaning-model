# Storytelling add-on

The bundled storytelling add-on supplies an author model, overall character life trends,
random-word naming and structure exploration, numerical trajectory exploration
and local revision, model-depth review, a scene workflow, chapter purpose review,
and a mode for deepening an existing work.
All authoring uses the Meaning Model's existing narrative graph. Enable the add-on for a storytelling MCP session with
`MEANING_MODEL_ADDONS=storytelling`. When it is unset, the server retains its
default tools, resources, and prompts.

The add-on does not change the shared model, record schemas, or executable
laws. Company valuation processes, physical processes, and other applications
continue to choose their own categories, relationships, units, and depth.
The scene workflow requires an overall life-trend model for the principal
cast. New trajectory exploration uses numbers on explicitly defined dimensions,
including emotional ones. It does not prescribe a fixed psychology, the
experimental numerical `story` profile, or a universal story-quality score.
The existing low-level narrative and writer tools remain available.

The calling LLM must develop or reuse the author model and overall life trends
automatically before drafting scenes. The user need not request the step, remember its tool
name, or fill in a dossier. Within the human author's delegated scope, the LLM
authors needed details and identifies them as authored additions. Respect the
agreed decision checkpoints before adopting those details. For existing canon,
reuse established facts, distinguish inferences, and ask only about gaps whose
resolution truly requires the user's choice. This responsibility is part of
the storytelling workflow, not an optional depth setting.

The narrative graph is the authoritative authoring record. Create the model
and graph before developing story material; store candidates, seed draws and
alternatives, drafts, assessments, selections, local revisions, and disclosure
plans through the tool. Files and PDFs are exports of graph content, not a
parallel manuscript or model. Use `life_story_author_record` for authoring
material and concise Understanding Nodes. Numerical exploration and revision
persist their results directly; neither accepts them as world facts.

## Entry point

Read the required Meaning Model and Life Simulation paper resources and common
modeling protocol before authoring a model. With the add-on enabled, read
`life-sim://addon/storytelling` and use the
`life_story_scene_start` prompt to begin the scene workflow,
`life_story_structure_explore` to explore possible structures, or
`life_story_purpose_review` for an advisory chapter or section review, or
`life_story_deepen` to refine an existing work. The
[Story Modeling Profile](STORY_MODELING.md) describes the broader authoring
convention; this add-on makes life-trend modeling, numerical exploration,
local revision, model-depth review, preparation, review, and prose commitment explicit. It exposes
twelve tools and the four prompts listed above.

## Initial settings and ongoing involvement

For a new story project, distinguish two choices. Reuse preferences and
delegation the human author has already stated; ask only what remains unknown.
When neither choice is established, ask two short questions:

1. Would you like to set the initial story settings yourself, supply a few,
   or have the tool propose them? Settings can include genre, length, cast
   size, tone, premise, and constraints.
2. Once the story is underway, should the assistant work autonomously, check
   with you at selected milestones, or collaborate with you throughout?
   Custom checkpoints are welcome.

These choices are independent. An author can specify every initial detail and
then delegate the writing, or ask for a proposed brief and remain closely
involved. Partial details are enough to begin the agreed work; this is not a
required questionnaire for every setting. For milestone or ongoing
collaboration, establish which decisions need the human's response, such as
the premise, cast, major turns, or chapter drafts. Do not infer permission from
silence. An already authorized autonomous run does not need another intake.
A standalone review or edit request stays within its requested scope and does
not trigger a full new-project intake.

Once the graph exists, use `life_story_author_record` to save the chosen brief
and collaboration expectations as scoped, author-only records. Use `context`
for the brief and `selection` for the human's stated preferences; retain who
supplied each choice in the text or data. A changed preference gets a new
record linked with `supersedes`; later explicit human instructions take
precedence. The human author is the person directing the work. The invoking
LLM may write and record it, but the record's `authorId` identifies its author
and does not by itself establish human approval.

Automatic naming, numerical exploration, life modeling, depth checks, and
reviews remain the LLM's responsibility within this delegated scope. They do
not require approval for every tool call. Keep alternatives hypothetical
until selected within that scope or approved at the agreed checkpoint; a
review recommendation does not authorize a creative revision the human has
reserved. Record decisions and resulting changes in the graph.

## Persist authoring and understanding

`life_story_author_record` takes `graphHash`, `requestId`, `nodeId`,
`storyRootId`, `authorId`, nonempty `accessScopes`, `kind`, and `text`.
Optional `data` retains exact JSON tasks, numeric evidence or review results.
Optional `links` contain `{relation, targetNodeId}` with specific relations
such as `about`, `supports`, `contradicts`, `refines`, or `supersedes`.
Kinds `candidate`, `draft`, `context` and `author_model` save nonrendered material;
`assessment`, `selection`, `revision` and `disclosure` save genuine scoped
`externalized_reflection` nodes. The tool creates or reuses a named author
understanding root, adds typed `contains` ancestry, and assigns an
`authoring_step` from the authoritative graph revision number, separate from
world chronology. This clock can have gaps and does not depend on whether
earlier private notes are visible. Use the returned graph hash
for subsequent operations. Earlier nodes and graph revisions remain available.

The tool validates visible targets and preserves a common permitted scope;
it does not establish whether an authored explanation is true. Record concise
rationales and inspectable conclusions, not hidden internal reasoning.

Record as you write, not only at milestones. The kinds `idea`, `prediction`,
`question`, `decision`, `reference` and `voice` hold ideas for later scenes,
predictions of what could happen, open questions, editing choices, references back,
and phrasing and voice decisions, such as why a line sounds like its speaker. Link
each to the passages it concerns with `links`, and to the model records it concerns
with `about`: `event:`, `cut:`, `process:`, `referent:` and the other kinds, with an
optional JSON Pointer `path`. A later agent then reads the thought beside its subject.
Every Event that carries a Cut needs a description of what happens in it; scene
preparation reports an `undescribed-numbers` blocker until it has one.

## Model the author and its effect on prose

For new generation, automatically build or reuse a meaningful author model
within the agreed delegation. Connect relevant experience, preferences, or
writing evidence to habits of attention and outlook, then to concrete writing
choices and their risks or restraints. This is not a second character dossier
or a request for a complete personal history. A few supported preferences can
be enough. The human may supply or approve the choices at their agreed
checkpoints; autonomous work uses the scope already delegated.
When authorial choices are delegated and no real author model was supplied,
create an explicitly fictional persona and record that choice. Do not silently
invent a profile of the real user. Respect an explicit request to omit author
modeling or to perform only a bounded review or edit.

As part of that step, place the author at the time of composition: establish
their life stage and circumstances, prior writing and development as a writer,
and their reason or reasons for writing this particular work now. Record the
relevant material in the existing labeled `basis` entries, then connect its
consequences to `dispositions`; no extra fields or approval gate are needed.
Only experience available by that composition point can shape this version
of the author. For a real author, leave unavailable background or motives
unknown; for an invented persona, label these choices `invented`.

Reasons can include curiosity, play, a commission, earning a living, unresolved
experience, or an experiment with form. They may conflict or evolve, and an
exploratory work need not have a settled thesis. Distinguish why the author
writes from a chapter's intended narrative purpose, narrator or character
motives, and effects actually achieved for readers. Let relevant motives shape
choices without requiring a message or its expression in every scene.

Save the model with `life_story_author_record`, `kind: "author_model"`, a
readable summary in `text`, and the typed model in `data`:

- `schema`: `meaning-model-story-author-model/v1`;
- `mode`: `real_author` or `fictional_author`, plus `label` and `modeledAuthorId`;
- `basis`: entries with `id`, `kind`, and `description`. Kinds are
  `author_statement`, `writing_sample`, `interpretation`, or `invented`;
- `dispositions`: entries with `id`, `basisIds` (array of basis IDs),
  `outlookOrHabit` (string), `writingConsequences` (array of strings),
  `usefulContexts` (string), `risksOrCounterweights` (string), and
  `dimensionIds` (array, may be empty);
- optional `dimensions`: entries with `id`, `meaning`, `comparisonQuestion`,
  `unit`, `minimum`, `maximum`, and `value`.

`modeledAuthorId` identifies the author being modeled. The record's `authorId`
identifies who authored the record; these are separate roles, and recording a
profile is not proof of the human's approval. `real_author` rejects invented
basis. A `writing_sample` requires a visible `sourceNodeId` and an exact
`excerpt` from it. Mark interpretations as interpretations: a fictional scene
does not establish its writer's biography. Do not fill missing real experience
with a plausible life story. An invented author persona uses `fictional_author`
and explicitly invented evidence, without claims about a real person.

Choose numerical dimensions only when they support a useful comparison. Define
what each value means; these are authored modeling choices, not universal
psychological scales, literary-quality measures, or a diversity score. A
disposition might connect a supported preference for practical detail to
attention to maintenance work, with a risk of explaining the scene before the
reader can experience it. The restraint might be to retain a necessary causal
detail while letting a gesture carry the feeling. Such a connection is useful
without forcing every scene into the same pattern.

Supply the stored node as `authorModelNodeId` during scene preparation and
purpose review. For a scene, `scene.authorApplication` names selected
`dispositionIds` and explains `intendedEffect`, `restraint`, and
`narratorRelation`. Supply known, unique disposition IDs with an intended
effect, or explain deliberate restraint when none is being applied. Always
explain the narrator's relation to the model. A narrator may differ from or
oppose the modeled author's outlook; a character's beliefs are not the author's
beliefs. Packets and reviews retain the exact profile and its application in
`authorModel`, and committed prose links to its author model through `shaped_by`
provenance. Keep these records author-only,
outside rendered prose and separate from world facts, viewpoint knowledge,
and reader disclosure. Do not add the author model as ordinary scene context.
Inaccessible models and models belonging to another story are rejected.

Preserve models and their revisions in the graph; use a new record with
`supersedes` when the profile changes and prepare affected work against the
chosen version. Review the actual prose for the intended effect and unwanted
repetition. Explain where the composition context or motives meaningfully
affected the writing, where restraint helped, or where the connection remains
uncertain. A changed motive or a better interpretation can warrant a revised
author model; preserve the earlier version and reason for the change rather
than inventing a convenient intention afterward to declare the draft a success.
No disposition must appear in every paragraph, and neither a valid
profile nor a provenance link proves that a style choice works. The scene's
`author:application` check reviews the declared application and separation of
roles; it imposes no style-success threshold or quota. Style judgments remain
advisory. The optional reference supports existing and standalone
workflows; new generation still develops or reuses an author model automatically
unless the human explicitly chooses otherwise.

## Review author and character voices in the prose

After a draft and after a substantive revision, automatically assess the
author's voice and each relevant principal character separately. Compare the
intended voice with what the actual passages achieve. For the author, connect
the selected profile at the time of composition to concrete prose choices.
For each character, connect speech, silence, viewpoint and behavior to the
processes explaining their attention, motives, learned habits, understanding,
relationships and present situation. Where emotion, anticipation, surprise or
adaptation changes a response, examine that connection. A voice adjective,
accent or catchphrase is not an explanation. Characters can share language or
change register without becoming interchangeable, and author, narrator and
character remain separate roles.

Save this analysis with `life_story_author_record`, `kind: "assessment"`, as
an actual `externalized_reflection` Understanding Node. Link `about` the exact
draft or passage nodes and `shaped_by` the selected author model when present.
Retain the reviewed graph, source and model hashes, the author-model ID and
record hash when supplied, and individual findings in `data`. Each finding
cites exact prose and graph process IDs or model paths, distinguishes intended
from observed effects, identifies weakness or uncertainty, and proposes the
smallest useful repair or explains why to keep the passage. Retrieve missing
evidence or state its limits; an external review file alone does not complete
this step.

This is an advisory literary assessment, not a hard style gate or a claim to
know a real person's objectively true voice. There is no universal set of
voice axes, forced contrast, or quota for expressing every trait. A weak voice
may need better prose, a better explanation of character behavior, or a revised
author interpretation; distinguish those cases before changing the work.

## Random-word naming and optional structure exploration

Use `life_story_structure_explore` when a random word could help suggest a new
event, character, relationship, or storyline. Structure exploration is an
optional ideation step. Use the same tool's `name` target automatically when
creating new principal-character, place, or organization names. Both modes
prepare inspiration without changing accepted facts. Store the returned seed and
authored alternatives in the story graph with `life_story_author_record`.

Supply a nonempty `brief` describing what you want to explore. The optional
fields are:

| Field | Purpose |
| --- | --- |
| `targetKind` | `event` (default), `character`, `relationship`, `storyline`, or `name` |
| `context` | Relevant existing material, facts, and circumstances |
| `constraints` | An array of requirements the proposals must respect |
| `seedWord` | A supplied inspiration word, or `null`/omitted for a random draw |

The same-named MCP prompt accepts `constraints` as a JSON string, such as
`["The siblings remain unaware of the letter"]`; the tool accepts the array
directly. Write the brief in the desired response language, including Swedish.

Random seeds are drawn uniformly from a fixed bank of 160 reviewed common
English words, independently of the brief. The bank avoids unrestricted
dictionary sampling and specialist terminology. It is not an exhaustive
vocabulary or a frequency-ranked list of the 5,000 most common words. A supplied
word is labeled `caller_supplied`; reuse it to explore the same inspiration.
The LLM can translate or explain English seeds when the brief uses another
language. This bank has not been replaced with the STLM TinyStories vocabulary.

For names, call with `targetKind: "name"` and omit `seedWord` so the tool draws
the inspiration independently. Include the story's culture, language, genre,
tone, and existing names in `context` and `constraints`. Use the seed's sound,
rhythm, or associations to develop names that belong in that setting and are
distinguishable from its existing cast. The name need not reuse the word,
describe a character's destiny, or carry a symbolic explanation. Compare
possibilities and reject an awkward result. Label an invented etymology as
fictional rather than presenting it as a real linguistic fact. Preserve
established names unless the user requests a change.

The tool returns a task for the calling LLM with `generator: "calling_llm"`
and `candidates: null`. The server does not invoke another model or produce
the proposed names or structures itself. For structure targets, the LLM
considers several meanings or properties of the seed, then translates their
patterns of relation or change
into two or three distinct possibilities that fit the brief. Merely placing
the word in a name, object, or description is not the intended method.

For example, a supplied word such as *erosion* might suggest a meeting where a
series of small concessions gradually removes one participant's freedom to
choose. It could
also suggest a character whose repeated compromises wear away a former
conviction. The word provides a possible structure; it does not need to appear
in the eventual prose.

Treat these as possibilities. Proposals must respect supplied facts and
constraints, or explicitly flag any suggested revision. Novelty alone does not
make a structure worthwhile: quiet developments are valid, a character need not
reduce to one metaphor, and every scene need not use this method. Reject all
proposals or draw again when the seed adds nothing useful. The preparation call is read-only. Save its returned task and your alternatives
with `life_story_author_record` before continuing. Selecting a suggestion does
not accept it as canon; use an explicit model or narrative revision for that.

## Explore numerical event and whole-life trajectories

When generating new event or whole-life trajectories, automatically use
`life_story_trajectory_explore` to sample candidate values at selected points.
Its input is `{record, exploration}`. The `record` fields are `graphHash`,
`requestId`, `nodeId`, `storyRootId`, `authorId`, and nonempty `accessScopes`.
`exploration` supplies `definition`, `points`, optional `randomness`,
`candidateCount`, and `seed`. The definition declares `targetKind` (event/life),
`subjectId`, `brief`, optional `context`/`constraints`, `timeUnit`, `axes`,
and optional `allocations`. Points have `id`, `at`, `label`, numerical
`values` keyed by axis ID, and optional `fixed` axis IDs. Baseline and all
sampled candidates are persisted before a result is returned. Without a seed,
a request-derived seed keeps retries identical; a new request draws again.

The calling LLM defines meaningful numerical
dimensions first, including emotional, relational, or material states where
relevant. Do not replace numerical modeling with a list of qualitative labels.
Choose categories and comparisons that make the numbers interpretable.

Each axis specifies its `meaning`, `comparisonQuestion`, `unit`, `minimum`, and
`maximum`. Establish an expected baseline at each ordered point and explicitly
mark any axis values that must stay fixed. Event exploration requires at least
two points; whole-life exploration requires at least three. A life candidate
must cover the intended lifetime interval, rather than rename a short crisis
as a life, and a life-trends dossier needs numerical points from its
`lifeBeginning`; the explorer warns when the first point is later. Fix axes that
do not yet apply at birth at stated conventional values. Points are sampled
independently, so adding one later with the same seed leaves the others unchanged. Give each number a declared meaning: a share of available attention
allocated to seeking company is different from a count of social encounters.
There is no built-in universal happiness, shock, or personality scale.

Optional disjoint allocation groups supply an `id`, a `question`, `axisIds`, and `total`.
Use these when the axes divide one quantity among mutually exclusive answers;
the sampler preserves their total, including fixed allocations. Independent
axes need not sum to anything. Declare exclusions and remainders honestly;
naming a group does not establish that its categories are complete or useful.

The server produces actual bounded numerical candidate points. `randomness`
is between 0 and 1, defaults to 0.5, and mixes the baseline with a bounded random
proposal. Zero preserves the baseline; one uses the proposal, subject to fixed
values, bounds, and allocation totals. `candidateCount` is a separate exploration
budget: it defaults to 3 and has a maximum of 8. A supplied seed allows replay.
More variation is not automatically better, and more candidates do not imply
that the LLM must select the most unusual one.

Evaluate each candidate for both coherence and storytelling potential in the
intended style. For example, decreasing confidence during successful rescue
could reveal a meaningful conflict if there is a credible cause; it could also
be an arbitrary sample that needs repair. Explain how sampled points could
arise through events, choices, pressures, expectations, and adaptation. Stable,
quiet, cyclical, worsening, and mixed trajectories are all valid. No shock,
redemption, growth, or death is required.

Prefer a useful local revision to discarding a promising character. Use
`life_story_trajectory_revise` to change selected numerical point values with
explicit reasons. Input is `{record, sourceNodeId, candidateId, reason, changes}`.
It reads the original from the graph. Each change has `pointId`, `axisId`,
`value`, and `reason`, and may name a `compensateAxisId` in the same allocation
group that absorbs the difference exactly, so a share can be moved without
computing the other value from the stored floats; an empty changes array
records an interpretation-only revision. It saves a new Understanding Node containing the numbers and reasons,
linked to the original with `refines`. It retains unlisted and fixed values, checks the original
bounds and allocation totals, and binds the result to its parent candidate
hash. If a revised allocation raises one component, explicitly revise the
other affected components so the total remains valid. Preserve the original
samples and the revision history. A change to the categories or point times
requires an explicit new proposal or numerical-model revision; it is not a
silent numeric patch. Causal explanations can be repaired without changing
sound values. Revise the numerical model when its categories fail to express
what matters, rather than treating a poor category as a flaw in the character.

These results are unaccepted creative hypotheses. They are not physical
simulations, calibrated psychological measurements, or accepted character
history. The LLM must interpret them, preserve established facts, decide what to
keep, and model accepted developments through the existing explicit workflow.
The sampler only preserves the fixed values and constraints supplied to it;
it does not infer every fixed fact from prose context. Neither numerical
plausibility nor the candidate hash proves literary merit or semantic coherence.

For a character dossier, `trajectoryProposal: {definition, candidate}` with its required
`trajectoryRecordNodeId` can retain the numerical evidence alongside the life phases and trend summaries.
The summaries explain the numbers and their causal interpretation; they do not
substitute for the numerical proposal. Keeping this field optional preserves
existing dossiers and permits explicitly authored models outside the sampler.

## Record evaluations as Understanding Nodes

After exploring candidates, keep concise author-facing assessments: which
candidate is promising, what needs revision, and why a local repair was chosen.
Use genuine Understanding Nodes in the existing narrative graph, rather than
leaving every evaluation only in metadata or a chat transcript. Maintain a
named author-understanding root and add `externalized_reflection` nodes with
an explicit `holder`, nonempty author `access_scopes`, provenance, authority,
and `render: "exclude"`. Link each assessment to the candidate evidence,
character, or event it is `about`; use specific typed `refines` and `supports`
links where appropriate. Preserve hashes and earlier assessments when revising.

These nodes hold deliberate, concise authored explanations for inspection.
They are not hidden model reasoning, story passages, accepted world facts, or
automatic character knowledge. Keep their scopes distinct from reader-visible
prose. `life_story_author_record` creates the named root, authoring clock and typed
containment automatically. Numerical revision automatically stores its reasons
as an Understanding Node linked with `refines` to the earlier candidate.
The LLM records its additional assessments and selections explicitly through
`life_story_author_record`. Existing low-level narrative operations remain available. See the [narrative graph contract](../docs/NARRATIVE_UNDERSTANDING_GRAPH.md).

## Model overall life trends before scenes

The narrated interval is only part of a character's life. Model the overall
direction of that life before explaining the decisions inside a scene. A
current personality description, a list of biographical facts, or several
minutes of crisis behavior does not supply that trajectory.

Use `life_story_life_trends` to store a dossier in the existing narrative graph.
The calling LLM constructs the model as a normal part of story creation; the
tool validates its structure and stores it. The server does not call a
separate remote LLM. Its input is `graphHash`, `requestId`, `nodeId`,
`accessScopes`, and `dossier`. The dossier contains:

| Field | Purpose |
| --- | --- |
| `schema` | `meaning-model-story-life-trends/v1` |
| `storyRootId` | Existing narrative root for the story this dossier covers |
| `storyInterval` | `start` and `end` of the narrated world interval |
| `characters` | Declared principal cast and their life trends, using stable `characterId` model anchors |

Each character supplies `name`, `lifeTimeUnit`, `lifeBeginning`, and
`storyEntry`, then at least three ordered `phases` from `lifeBeginning` to
`storyEntry`. Each phase has `id`, `at`, `label`, and `situation`. Choose a
coarse lifetime scale, such as early life, the period of becoming independent,
and entry into the story, rather than dividing the current crisis into three
moments. Refine formative experiences when they explain an important choice.
`lifeBeginning` means birth or emergence, or the earliest established phase
when the origin is unknown. State that uncertainty in `situation`; do not
invent certainty merely to fill a field.
Phase times use the character's declared lifetime scale; `storyInterval` uses
the graph's world chronology. A lifespan measured in years can therefore
provide the context for a story interval measured in minutes.

Supply at least two `trends` with an `id` and a chosen `dimension`. Every trend
contains a `states` entry (`phaseId`, `state`) for every phase and a
`developments` entry (`fromPhaseId`, `toPhaseId`, `explanation`) for each
adjacent pair. Explain persistence as well as change. Dimensions might concern
trust, attachments, work, material security, responsibility, autonomy, or the
character's relation to an institution. They are authored categories, not a
required inventory or universal personality scores. For generated trajectories,
retain the numerical candidate and use these summaries to explain its values,
causes, and consequences.

For example, a possible life model for Ivo could trace practical work as a
childhood expression of care, usefulness as a way to belong among changing
crews, and the growth of lasting companionship. A possible Mara trajectory
could connect scientific self-sufficiency with chosen interdependence while
preserving her agency. These are illustrations of the needed scope, not
facts established by the earlier eighteen-minute story trial. The model must
also explain contrary tendencies, stable commitments, and regressions when
they matter; characters need not steadily improve or follow one arc.

Finish with `future: {status, outlook}`. Use `status: "open"` when the later
life is undecided, or `"planned"` for an authored direction. An open future is
valid. Do not invent an ending or death merely to complete the structure.

The stored dossier is author context, excluded from prose rendering and
training projection. Its presence does not grant a character knowledge of
another person's life or disclose that history to the reader. Model facts
that a scene actually reveals as ordinary, granular context nodes with their
own knowledge and disclosure timings.

## Review whether the model explains the story

Before drafting prose, automatically ask whether the model is developed enough
to explain the story's consequential choices and outcomes. Use
`life_story_model_depth_review`, then store the LLM's findings with
`life_story_model_depth_record`. This examines the model's adequacy for the
intended story; the separate purpose review examines the resulting prose.

The preparation input supplies `graphHash`, `storyRootId`, `lifeTrendsNodeId`,
`focusNodeId`, `contextNodeIds`, and `accessScopes`. First store the outline,
goals, important choices, or intended outcomes in the graph and select that
record as the focus. The story root can serve as the focus when it contains
substantive story material. Include the context the affected scenes need.
The tool reads those actual records and derives the model hash from the
graph's frozen source snapshot; a caller's summary is not the model evidence.
If the full model is too large to include in the task, follow its explicit
read-more route and inspect the relevant records before assessing it.

Choose review subjects from what explains this story. Relevant questions may
concern a person's overall life, a flaw affecting a choice, the meaning of a
concept, a physical limitation, an institution's rules or incentives, a causal
event, or a disclosure process. For example, if the ending depends on a
character refusing a feasible rescue, inspect the character's reasons and the
rescue's actual feasibility. A trait label and an assertion that the rescue
cannot work may leave the central choice unexplained. Open only the detail
needed to resolve that gap. The review imposes no fixed *Book of Conditions*
taxonomy, decomposition count, universal psychology, or story-quality score.

Consequential speech and behavior also need an explanation in the actual
model. Inspect how the character's history, motives, attention, understanding
and present relationships produce the response; consider changes by situation
where relevant. A number or voice label alone is insufficient. When reviewing
an existing draft, its passages identify the conduct needing explanation.
Whether that explanation produces effective or distinctive prose remains a
separate advisory voice review.

`life_story_model_depth_record` takes the original `preparation`,
`expectedTaskHash`, `requestId`, `nodeId`, `reviewer`, a `coverage` explanation,
and `findings`. Each finding contains:

- `subject`: the particular question or dependency examined;
- `status`: `sufficient`, `needs_opening`, or `unclear`;
- `explanation`: why the available model does or does not explain it;
- `evidence`: references of the form `{kind: "node", nodeId}` or
  `{kind: "model", path}`, where `path` is a JSON Pointer into the bound model;
- `smallestRepair`: the smallest useful refinement or missing evidence for a
  gap, or `null` when the model is sufficient.

The coverage explanation states why the selected subjects and evidence cover
the focus's consequential choices and outcomes. The record tool validates the
task binding and evidence references, then saves the findings as a scoped
Understanding Node with typed links under the named author-process root.
Each finding needs evidence, and the assessment must include at least one
reference into the actual model rather than citing only narrative summaries.
Record uncertain findings and gaps as well as successful assessments. A gap
produces a blocker in the scene packet and prevents commitment until it is
addressed and reassessed; it never prevents saving assessments, drafts, or
proposals. Sufficiency remains an authored
LLM judgment, not a machine proof or an aesthetic approval gate.

Depth-review freshness follows the exact model/source and selected story
evidence. Changes to that evidence require a new assessment. Appending an
unrelated draft or author note does not by itself invalidate the review, so
the assessment can be reused for scenes it adequately covers. After
consequential model, trajectory, causal, or disclosure revisions, review the
affected explanation again and then review the affected scenes.

The native graph resolves model anchors against its one bound model. After a
model revision, rebind the story to the successor model with
`life_narrative_rebind`, which submits one complete successor that retains the
old depth-review nodes as historical assessments and removes only their
model-anchor edges identifying the predecessor model. A manual
`life_narrative_revise` remains possible for the same purpose. The earlier immutable graph keeps
those exact anchors and evidence. Never retarget old findings to new values or
rewrite their historical model hash. Record a fresh depth assessment with a
new node and new model anchors before committing affected scenes; the old
assessment is stale for the successor source. This uses the existing model
and graph revision operations, without changing anchor semantics.

The model read is an administrative read of the static model definition; it
is not filtered by narrative `accessScopes`. Do not treat initial process
values as the current values of a world or candidate. The frozen source
identity establishes the review's binding, but does not supply every runtime
value needed for every question. Identify missing evidence rather than
silently substituting a newer world state. The server prepares and records
the task; the calling LLM performs the judgment.

## Model, prepare, review, commit

1. Automatically construct or reuse the author model and the principal cast's
   overall life trends. Keep the author's basis and writing dispositions
   separate from the characters' histories.
   For new trajectories, explore numerical candidate points, assess their
   coherence and storytelling potential, and repair promising candidates
   locally. Record concise assessments as Understanding Nodes. Store a new
   dossier with `life_story_life_trends` when needed. Do this
   before drafting, without asking the user to supply the dossier. Use its
   graph revision for scene work.
2. Before prose, automatically use `life_story_model_depth_review` to inspect
   the bound model and stored story focus, life trends, and relevant context.
   Record the assessment with `life_story_model_depth_record`. Where an
   explanation needs more detail, make the smallest useful explicit refinement
   and review again. Keep sufficient abstractions unchanged.
3. Use `life_story_scene_prepare` to select the narrative context for a scene
   and provide its required `lifeTrendsNodeId` and `modelDepthReviewNodeId`.
   Supply `authorModelNodeId` and `scene.authorApplication` to connect the
   intended prose choices and restraint to the selected author model.
   Connect each present principal
   character, including characters materially affected off-screen, to relevant
   trends through `scene.characterConnections`.
   The returned immutable packet binds that selection to an exact graph
   revision. Supply the character and reader knowledge constraints and their
   timings explicitly. World chronology and the order in which a reader learns
   facts serve different purposes and must be authored separately.
4. Draft the scene using the packet and save it with `life_story_author_record`
   (`kind: "draft"`). Re-prepare against the returned graph hash, then use
   `life_story_scene_review` with that `draftNodeId`, the exact stored text, a finding for every declared check, and exact excerpts
   supporting those findings. Review records the relationship between the
   declared constraints and this particular draft; a revised draft needs its
   own stored version and review. Store rejected reviews as assessment records.
5. Use `life_story_scene_commit` to commit the reviewed draft. It reruns the
   same checks, then sends the story text and a linked Understanding Node review to
   the existing Rust narrative batch operation. The batch creates one atomic
   graph successor. The world is unchanged and previous graph revisions remain
   addressable.
   When an external estimator is configured, or when you can answer the questions
   yourself, run `life_narrative_alignment_audit` on the committed scene and store
   its flagged findings as an `assessment` record. Phrase canon and context records
   as events and facts, not as transient knowledge states, so that contradiction
   checks stay meaningful; use withheld entries for knowledge that must not leak.
6. At a completed chapter, significant turning point, completed part or work,
   or consequential revision, automatically use `life_story_purpose_review`
   on the relevant unit. Assess the need for changes from the text and its
   context. Keeping the work as it is can be the right result.

After drafting and substantive revision, also save the individual author and
character voice findings described above as Understanding Nodes. Purpose and
voice findings may share an assessment record when their evidence and
conclusions remain explicit.

After a consequential model, life-trajectory, causal, or disclosure revision,
repeat the depth review before preparing affected scenes. Update the graph,
record the new assessment, and review any affected prose again.

Packets and reviews are reproducible values, not session-local handles. Review
receives the complete preparation input and its expected packet hash. Commit
receives the complete review input and its expected review hash. Repeating the
calculation checks that the supplied input still describes the prepared context
and reviewed text; the hashes do not prove the reviewer's interpretation.

Choose context deliberately. A packet records the selected facts and
constraints; it does not claim that they include every relevant fact in the
world. If the scene requires a world change, use the existing explicit world
revision workflow, then prepare a scene against the appropriate graph.

## Preparation input and timing

`life_story_scene_prepare` takes `graphHash`, `accessScopes`,
`lifeTrendsNodeId`, `modelDepthReviewNodeId`, and `scene`.
The optional `authorModelNodeId` binds the stored author model described above.
`graphHash` identifies an existing immutable Rust narrative graph. Preparation
loads the selected nodes from that graph's scoped view. A model-bound or
world-bound graph is allowed. A candidate-bound graph must record a committed
candidate; pending, rejected, and superseded candidate sources are refused.
The depth-review record must cover the same story source, life dossier, and
selected context and remain fresh. Missing or stale records fail preparation.
Unresolved findings produce a packet with a blocker that prevents scene
commitment until the gaps are addressed and reassessed. Saving drafts,
recording gaps, and the general-purpose modeling tools remain available.

The scene fields are:

| Field | Purpose |
| --- | --- |
| `id` | Identity for the scene being added |
| `parentNodeId` | Existing narrative parent to which the scene will be attached |
| `order` | Nonnegative safe integer specifying child order under that parent |
| `worldTime` | The scene's start in the world chronology |
| `worldTimeEnd` | Optional end of the scene; knowledge the viewpoint acquires by this time may be declared. Defaults to `worldTime`. |
| `readerOrder` | Nonnegative safe integer specifying the scene's position in the authored disclosure sequence |
| `viewpoint` | Authored holder label; use the stable `characterId` for a principal viewpoint so preparation can require that character's connection |
| `brief` | What this scene should accomplish |
| `characterConnections` | Present or affected principal characters, each with `characterId`, selected `trendIds`, and a `connection` explaining how the scene continues, tests, or changes those trends |
| `authorApplication` | With an author model, selected `dispositionIds`, `intendedEffect`, `restraint`, and `narratorRelation`; describes the application without requiring every disposition in every scene |
| `context` | Selected source node IDs and the knowledge timings below |
| `requirements` | Authored checks, each with an `id` and `instruction` |

Each context entry contains `nodeId`, `viewpointKnownAt`, and `readerKnownAt`.
Use `null` when that audience must not receive the selected information in this
scene. The timing rules distinguish character access from reader disclosure:

| Timing | Meaning in the prepared scene |
| --- | --- |
| `viewpointKnownAt <= worldTimeEnd` (or `worldTime` when no end is declared) | Available to the viewpoint, provided the source node has an `evidence_cutoff` no later than that time |
| Later or null `viewpointKnownAt` | Unavailable to the viewpoint |
| `readerKnownAt < readerOrder` | Already known to the reader |
| `readerKnownAt == readerOrder` | Must be revealed in this scene |
| Later or null `readerKnownAt` | Withheld from the reader |

Declaring viewpoint knowledge without the required source cutoff produces a
preparation blocker. A standing canon record without an `evidence_cutoff` can
never be declared as viewpoint knowledge; give every fact a character may be
shown knowing a dated context node, and keep undated canon reader-facing. A source's cutoff supports its declared temporal boundary;
the reviewer still assesses whether the authored knowledge timing is justified.

`readerKnownAt` uses the same nonnegative integer sequence as `readerOrder`.
That sequence is independent of world time and parent child order, allowing
flashbacks and other changes in narrative order without changing world history.
Preparation returns `packetHash`, audience contexts, checks, and blockers.

Preparation requires a valid life-trend dossier in the selected graph. Its
story root must contain the scene's parent, and its `storyInterval` must cover
the scene's `worldTime`. A viewpoint matching a principal `characterId` must
have a scene connection. A scene without present or affected principal
characters can use an empty connection list, but the dossier still has to
cover the story's principal cast. Review must catch omitted characters and
aliases that do not match a canonical ID.

Life-trend and cast-coverage checks join the packet's ordinary fact and
knowledge checks. The reviewer must judge whether the supplied connections
and the draft actually fit the overall lives. A surprising choice may express
a modeled conflict or turning point; its explanation cannot simply be that the
plot needs it. Mark an unresolved contradiction `conflict` or `unknown`, revise
the model or draft explicitly, and review again. Withholding that explanation
for suspense is an authored disclosure process; it does not change the
underlying character history.

Knowledge assignments are explicit for each prepared scene. The add-on retains
them in review metadata but does not propagate character knowledge or reader
state automatically to later scenes.

## Review input and evidence

`life_story_scene_review` takes:

- `preparation`: the complete preparation input;
- `expectedPacketHash`: the hash returned by preparation;
- `draftNodeId`: a draft record already stored in this graph for this story;
- `text`: exactly the text saved in that draft record;
- optional `passages`: ordered `{id, text}` units whose text joined with
  `"\n\n"` exactly equals `text`;
- `reviewer`: the authored reviewer identity;
- `findings`: one result for every check in the packet; and
- `uses`: explicit declarations of where selected source information appears
  for the viewpoint or reader.

Each finding supplies `checkId`, a `status` of `satisfied`, `conflict`, or
`unknown`, an `explanation`, and `citations`. A citation contains `start`, `end`,
and `quote`. Offsets are zero-based JavaScript UTF-16 indices with an exclusive
end: `text.slice(start, end)` must equal `quote`. Empty citations can support a
whole-scene omission finding, but an explanation is still required.

Each use supplies `nodeId`, `audience` (`viewpoint` or `reader`), and the same
`start`, `end`, and `quote` evidence. A declared use of unavailable viewpoint
knowledge or withheld reader information blocks commitment. A required reveal
needs a matching reader use. Findings must cover the packet's checks; a
conflict or unknown finding cannot establish a completed review.

Review returns `reviewHash`, the exact draft's `textHash`, `readyToCommit`, and
any blockers. Commitment requires `readyToCommit: true` and the matching hash.

Use `passages` when parts of the scene need to be linked, revised, or moved
independently. Choose useful units rather than meeting a subdivision or word
quota. Passage IDs must be fresh, and each text must be nonblank. The ordered
IDs, texts, and boundaries enter the review hash; changing or removing that
segmentation requires a new review even when the full draft text is unchanged.
The whole-scene review and citation offsets still refer to the complete `text`.
Omitting `passages` preserves the single-passage scene form.

The declarations need to be complete and accurate. The tool can reject a
declared leak, but it cannot discover an undeclared implication simply by
matching text spans. A passage that implies a secret without quoting its source
still needs the reviewer's attention.

## Commitment and revision

`life_story_scene_commit` takes the same input as review, plus `requestId` and
`expectedReviewHash`. It recomputes preparation and review before appending.
A changed draft, finding, source selection, or other bound input requires a
new matching review. Blockers prevent commitment.

The canonical successor contains the exact story text and a scoped
Understanding Node holding the packet and review, with typed containment under
the named author-process root and an `about` link to the passage. They are
committed in the same Rust narrative batch, preserving the stored draft.
When `passages` are supplied, the scene becomes an empty, nonrendered
`storytelling.scene` container whose `storytelling.passage` children render in
the supplied order. Each leaf retains links to its review, draft, depth review,
life model, selected author model when supplied, and selected context.
The receipt returns `passageIds`; without
segmentation, this contains the original scene leaf ID. The graph's text is
canonical, and rendering the container reproduces the exact reviewed draft.
The existing graph and world remain unchanged. Graph hashes identify immutable
revisions: passing an older graph can intentionally create a branch; the
add-on does not silently substitute the latest graph. Choose the intended
`graphHash` when preparing the next scene.

The added text, review metadata, and edges retain only audience labels shared
by all restricted parent, life-trend dossier, depth-review, selected author-model,
context, and draft nodes. Public nodes
impose no restriction, and caller query scopes do not add output audiences. Understanding Nodes
always require an explicit author scope; an otherwise public scene uses
`story-author` for its review.
Restricted inputs with no shared audience produce an
`incompatible-context-scopes` preparation blocker
and cannot be committed. These labels remain graph projections, not
authenticated access control.
The prose node records `worldTime` as its `value_time`, but it receives no
automatic `evidence_cutoff`: a narrator may disclose events from other times.
For later character knowledge, select appropriate evidence nodes with explicit
cutoffs or author a suitable narrative revision.

Packet and review metadata are retained with the Rust graph. Persistence across
server restarts follows the existing Rust session persistence configuration;
enabling the add-on does not create a separate durable store.

The commit receipt includes a `nextStep` reminder to review when a meaningful
unit or turning point is complete. The calling LLM determines whether that
condition applies: committing a scene does not tell the server that a chapter
has ended. The reminder does not invoke a model, schedule a background review,
or make the advisory review a commitment gate.

## What review establishes

The checks bind review findings and cited excerpts to the exact draft and
prepared context. Missing life-trend dossiers and incomplete phase/trend
structures are rejected; merely supplying a current-character snapshot cannot
satisfy that structure. The calling LLM must still construct substantive,
coherent lives. The tool does not prove that phase descriptions are meaningful
or automatically discover every principal character from prose.

Character knowledge and reader disclosure are authored
constraints, with authored review findings. The writer or reviewer must
interpret the prose, determine whether its implications fit those constraints,
and decide whether the selected context is sufficient. Matching an excerpt
does not establish that an interpretation is true.

This workflow does not automatically understand finished prose, measure
literary quality, or demonstrate improved pacing, voice, or reader engagement.
Review metadata is kept outside rendered story text, so the manuscript
contains the prose rather than its review record.

Committed prose inherits the author-only scope of the dossier, drafts and
reviews it was built from, so a reader's render shows only the title. When the
human's agreement allows publishing, release it with `life_story_release`: it
records the decision and its reason as an author record and widens the scopes
of the prose passages, their scenes and their structural edges to the reader
scopes you name, or to every reader. The dossier, drafts, reviews and author
model keep their scopes. Render with the reader scopes afterwards and read what
a reader sees; the release does not check what the prose itself reveals.

## Character flaws and independent reviews

Review principal characters for limitations that affect choices and
consequences: a mistaken belief, costly habit, avoidance, competing priority,
or a strength overused in the wrong circumstances. Trace the tension through
numerical categories and life developments, then inspect how it appears in
behavior. A biography label alone is insufficient; hardship, bad luck and low
sampled values do not by themselves establish a flaw. Preserve competence and
individuality, and repair a specific choice or consequence when useful.
Random trajectories provide possible material; they do not replace review.

At substantial milestones or consequential revisions, use an independent
reviewer when available, supplied with the exact graph revision and relevant
model context. Record each review with `life_review_record` under its actual
reviewer: a blind reader, another model, an estimator or a person. State what it
was given (the rendered text only, text and records, or records), how independent
it was, the exact revision it read, with a hash of the text, and the prompt. Link
the changes that answer it with `answers`. Otherwise explicitly label the result
as self-review. The server does not launch a reviewer or claim independence merely
because a reviewer name was supplied.

## Continue a story someone else began

Read `life_construction_replay` on the story's graph from the first revision, at
outline level, then open the steps you need at reasoning or full level, and read
`life_model_outline` for the present state. The replay shows every model revision,
note, review and prose change in order, each note beside the records it concerned
as they were then, so you continue from the recorded choices rather than from the
text alone.

## Deepen an existing work

Use `life_story_deepen` for a separate revision round on an existing story or
unit. It is a read-only preparation tool and a same-named prompt; the calling
LLM performs and records the assessment and revisions through existing tools.
The mode preserves a specific baseline so before/after claims can be checked.
It does not reroll the story, require more words, or declare that added detail
is an improvement.

Supply `graphHash`, `storyRootId`, `rootId`, `lifeTrendsNodeId`, `focusNodeId`,
`contextNodeIds`, and `accessScopes`. `rootId` selects the prose unit;
`focusNodeId` selects the stored plan whose explanations need inspection.
The optional `authorModelNodeId` selects the exact author profile. `unit`
accepts `chapter`, `section`, `part`, or `whole_work` (the default).
`revisionScope` is `local` by default or `structural` when broader changes are
authorized; `brief` supplies the requested improvement. The prompt takes
arrays as JSON strings, as the other storytelling prompts do.

The task binds the baseline graph, source, model, rendered projection and
text hashes, selected prose and node IDs, author profile when selected, and
model-depth and purpose-review preparations. Read that evidence before
recommending changes. Store combined findings within the returned task's
`accessScopes`, even if an individual nested review permits broader scopes.
Save the baseline analysis and revision plan as
Understanding Nodes, including author and individual character voice
findings. Distinguish a missing causal explanation from weak prose realization,
and distinguish both from an optional artistic preference. Evidence-limited
findings and a justified decision to keep a successful passage are valid.

Under `local`, preserve the premise, established cast and ending while
strengthening selected processes, relationships, transitions, voice or prose.
Under `structural`, justify larger revisions within the human's brief and
delegated authority. In either case preserve successful work and earlier
versions. Make the smallest useful changes, update affected model or life
records when needed, repeat depth review after consequential changes, and
review the resulting prose. Save the after-analysis as new Understanding
Nodes linked to the revised passages and earlier findings.

Scene commitment appends new material. Use the shared `life_narrative_edit`
tool to split or merge existing text units, move a subtree, reorder children,
or replace a selected node's text with an exact `expectedText` guard. Supply
the exact graph hash, reason, scopes, and operation list; the tool reads the
complete graph and submits one atomic successor while preserving untouched
records and earlier revisions. The tool is available without the add-on. See
the [local editing contract](../docs/NARRATIVE_UNDERSTANDING_GRAPH.md#local-graph-editing)
for input fields and topology restrictions.

Choose independently changeable units when a scene needs finer work; do not
split successful prose merely to meet a count. A split preserves the exact
joined text and original links; a merge preserves its source nodes as history.
Semantic links are not automatically reinterpreted after text or placement
changes. Inspect the affected links and refresh scene, depth, purpose, and
voice reviews where their evidence changed. Retained reviews describe their
original inputs; they do not certify a later edit.

Full `life_narrative_revise` remains available for unsupported topology or
source changes. Before manually constructing a complete successor, retrieve
the full graph with all required scopes and verify node, edge, and root counts;
never submit a scope-filtered projection as the whole graph. An append-based
replacement can still use fresh scene IDs and the preparation, stored-draft,
review, and commit workflow, while explicitly retiring the superseded prose
from rendering and rewiring its active placement. Render and review the final
topology for duplicate, missing, or reordered passages. Preserve the immutable
baseline and do not export a temporary gap as the finished revision. Neither
the preparation nor edit tool certifies literary improvement automatically.

## Automatic review checkpoints

Use `life_story_purpose_review` to ask the calling LLM two questions about an
existing chapter or section:

1. What is its purpose?
2. Does it fulfill that purpose in context, and why?

The calling LLM performs this review automatically after a completed chapter,
significant turning point, completed part or whole work, or a consequential
revision. Choose the unit that makes the development intelligible. This is a
context-sensitive writing checkpoint, not a timer or a requirement to judge
every paragraph. The LLM need not wait for the user to request a review.

Supply `graphHash` and `rootId` for the narrative text to review. The optional
`unit` defaults to `chapter` and also accepts `section`, `part`, or `whole_work`.
Supply `authorGoal` when the author's intention is known; otherwise the LLM must
label its proposed purpose as inferred. Use `context` for relevant surrounding
material and `accessScopes` for the narrative projection. The same-named MCP
prompt accepts these arguments, with `accessScopes` encoded as a JSON string.
Supply `authorModelNodeId` to include the exact author profile as separate
author-only evidence. Review whether its intended writing choices help this
unit, whether restraint is needed, and whether the narrator remains distinct.
The task's scopes narrow to the audiences shared by the prose and selected
author model; including the profile does not broaden access to either.
Include relevant life trends, prior expectations, unresolved consequences,
and authored disclosure processes in `context`. The tool's text selection does
not automatically retrieve all of that surrounding evidence.

Selection uses the existing renderer's `contains` and `next` links. Check the
returned `target.nodeIds`: a leaf linked to later chapters can include those
successors. Use the intended chapter container, and qualify the review if its
boundary or the available surrounding context is unclear. Oversized selections
require a smaller section; the tool never silently truncates the text.

The tool returns the exact rendered text and instructions, bound by `taskHash`,
with `assessment: null` and `evaluator: "calling_llm"`. The calling LLM supplies
a brief qualitative answer: `fulfilled`, `partly_fulfilled`, `not_fulfilled`, or
`unclear`, supported by textual evidence. The tool does not contact another LLM
or manufacture an assessment.

Review allows multiple purposes, ambiguity, atmosphere, breathing room, rhythm,
characterization, and delayed payoff. It must not require every paragraph to
show an immediate use or follow a prescribed plot arc. Missing context is a
reason to qualify the judgment, not evidence of failure; effective writing does
not need a revision recommendation.

Where relevant, review what characters and readers anticipate, what changes
those expectations, whether the change has a credible cause, and how its
consequences persist. Check actions against the characters' life trajectories
and disclosure against the authored reader process. Distinguish an intentionally
unresolved question from a contradiction; missing evidence warrants `unclear`.
Suggest specific changes only where the evidence supports them. There is no
rewrite quota, numerical quality threshold, or requirement to accept a
suggestion. An accepted change to canon, prose, or disclosure must follow the
explicit revision and review workflow.

This review is advisory only. It neither writes to the graph nor persists the
LLM's answer, and it is independent of scene requirements and cannot block
prose commitment.

## Anticipation, shock, and adaptation

Use the core `change_arc_scaffold` when anticipation, a focal change, and
adaptation help explain an event. It already provides optional structural
Events for these roles; the storytelling add-on does not introduce a required
three-beat plot or a numerical emotional formula.

Model whose expectation is involved, what they can know at that time, what
changes, and how they respond over time. A shock may be welcome, unwelcome, or
expected yet still consequential. Adaptation may begin in anticipation,
overlap the event, remain partial, fail, or leave lasting changes in a life
trend. Quiet persistence and an absence of shock are also valid.

When a consequential decision is modeled as a direction Cut over mutually exclusive
continuations, fix its proposal weights and a seed before drawing, then draw with
`life_direction_draw` and record it in the story graph. The server computes the
draw, and a later draw over the same Cut is recorded and linked as a reroll. If the
remainder is drawn, model a new admissible continuation under the remainder's
meaning; do not renormalize the named answers. In the successor model, link the
continuation's Event from the Cut's parent Event with a `realizes_forecast`
relation whose `forecast_answer` names the Cut and the realized answer key. When two actors decide jointly,
consider whether each attempts a different named continuation: their combination
can realize an outcome none of them chose.

Keep the character's experience separate from the intended reader response.
Author processes govern how disclosure creates anticipation, surprise, or
temporary uncertainty for the reader; they must not alter the underlying
world history. Review whether the supplied text supports that intended effect
and its aftermath, without treating the intended response as a measured fact.

## Configuration

Add the environment variable to the MCP client's existing server entry:

```json
{
  "mcpServers": {
    "meaning-model": {
      "command": "node",
      "args": ["/absolute/path/to/meaning-model/mcp-server/bin/meaning-model-mcp.mjs"],
      "env": {
        "MEANING_MODEL_ADDONS": "storytelling"
      }
    }
  }
}
```

Keep any existing `LIFE_SIM_ENGINE_BIN` setting in that `env` object. Restart
the MCP server after changing its environment so the client discovers the
enabled tools, resource, and prompts. The add-on ships with the server and uses
the same Rust engine and narrative storage; no separate package or store is
required.
