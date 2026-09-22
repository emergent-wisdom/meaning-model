# Story Modeling Profile

Use this profile after reading the current *Meaning Model* and *Life
Simulation* papers and the common modeling protocol.

This is a modeling workflow, not a required vocabulary. Choose and revise the
processes and categories that the story needs. The separately compiled `story`
profile is one experimental numerical convention, including a built-in progress
law; reading this guide does not require using that compiler. Structural
starters or directly authored models are alternatives within the same engine.

The narrative graph is the authoritative authoring record. Create the model
and graph before developing story material; store candidates, seed draws and
alternatives, drafts, assessments, selections, local revisions, and disclosure
plans through the tool. Files and PDFs are exports of graph content, not a
parallel manuscript or model. Use `life_story_author_record` with the add-on, or existing narrative batch
operations without it, for authoring material and concise Understanding Nodes. Numerical exploration and revision
persist their results directly; neither accepts them as world facts.

## Purpose

Construct or reconstruct a story as one accepted world history before prose is
treated as authoritative. The model should preserve character continuity,
causal pressure, hidden history, viewpoint, and the distinction between world
chronology and narrated order.

## Initial settings and involvement

For a new story project, establish two independent choices with the human
author. Reuse explicit preferences or delegation already given. If unknown,
ask two short questions:

1. Would they like to set the initial settings themselves, supply some, or
   have the tool propose them? Genre, length, cast size, tone, premise, and
   constraints are possible settings, not a mandatory form.
2. Do they want autonomous work, consultation at selected milestones, or
   ongoing collaboration? They can specify their own checkpoints.

Partial initial details are valid. Setting the brief does not determine how
involved the author will be later. Agree which creative decisions need a
response, honor existing authorization, and do not treat silence as permission.
Do not restart this intake for an already delegated autonomous run or expand
a standalone review/edit request into a new story project.

Once the graph exists, store the brief and involvement choices as scoped,
author-only records through `life_story_author_record` with the add-on, or
the existing narrative operations without it. Record who supplied the choices;
the invoking LLM's record identity is not proof of human approval. Preserve
earlier preferences when a new record `supersedes` them. Later explicit human
instructions take precedence.

The modeling sequence below operates within the agreed scope. The LLM still
performs numerical exploration, life modeling, depth checks, and reviews
without needing approval for each tool call. Alternatives stay hypothetical
until selected under delegated authority or approved at an agreed checkpoint;
review findings do not grant permission for a reserved creative decision.

## Modeling sequence

Apply the shared conceptual review during construction and later depth reviews,
without waiting for the human author to request it. Consider numerical scales
for relevant judgments, open broad concepts such as attachment or flexibility
when their parts explain different actions or voices, and compare an actor's
meanings across life periods or viewpoints. Use actual model concepts and cuts
when claiming a conceptual opening. Keep the interpretation and revision reasons
in Understanding Nodes. Sufficient existing boundaries and explicitly unresolved
questions are valid; additional scores or detail are not an end in themselves.

1. Create stable referents for the world, principal actors, places, and
   identity-bearing objects. With the storytelling add-on, automatically use
   `life_story_structure_explore` with `targetKind: "name"` and no `seedWord`
   when creating new principal-character, place, or organization names. Supply
   the story's culture, language, tone, and existing names; use the random
   word's sound, rhythm, or associations to develop fitting names. Preserve
   existing canon names unless a change is requested, and label invented
   etymologies as fictional.
   Automatically build or reuse an author model within the agreed delegation,
   distinct from the cast, narrator, and viewpoint. Connect supported or
   explicitly fictional author dispositions to intended writing choices and
   their risks or restraints, as described below.
2. Model each principal actor's overall life trends before the narrated
   interval. Establish a coarse sequence from their life's beginning to entry
   into the story, and explain how chosen dimensions persist or change across
   it. A present-day personality sketch or a few backstory facts is
   insufficient: show the longer direction of attachments, work, beliefs,
   capacities, pressures, or other dimensions that matter to this person.
   Leave the later life open when no future has been authored.
3. With the add-on, use `life_story_trajectory_explore` to sample numerical
   candidate points for whole lives and consequential events. Define each
   dimension's meaning, comparison, unit, and bounds; include emotional
   dimensions where relevant. Declare fixed values and any allocation totals.
   Separate the amount of randomness from the number of candidates explored.
4. Evaluate candidate coherence and storytelling potential. Prefer local
   repairs through `life_story_trajectory_revise` when a character or event is
   promising: revise the weak point or explanation without discarding sound
   material. Record concise assessments and revision reasons as Understanding
   Nodes. Keep proposals hypothetical until one lineage is explicitly accepted.
5. Decompose the accepted history into acts, chapters, and scenes. Refine from
   the frozen accepted parent; do not silently contradict the life-scale path.
6. Advance relevant off-screen actors as well as the focal character.
7. Before prose, automatically review whether the model explains the intended
   consequential choices and outcomes. With the add-on, use
   `life_story_model_depth_review` and save the findings through
   `life_story_model_depth_record`. Ground the judgment in the actual bound
   model and stored story focus, life trends, and context. Open only the
   detail needed to repair an explanation; record the result as an
   Understanding Node and reassess unresolved gaps before committing scenes.
8. Build a writer packet containing hard facts, important
   trajectories, causal explanations, viewpoint-indexed beliefs, hidden
   backstory, and soft or renegotiable fields.
   Bind the selected author model separately and explain how its relevant
   dispositions inform this scene, including restraint and the narrator's
   relationship to the author's outlook.
   For a large model, retain a compact whole-graph skeleton beside the active
   causal neighborhood and every crossing boundary edge. The packet is a view;
   the complete Rust graph remains available for further traversal.
9. Let the writer omit surface mention of a parameter while preserving its
   consequences. If prose requires a contradictory fact, revise the model and
   rerun rather than hiding the conflict.
10. After each accepted scene, update later uncommitted possibilities while
   preserving committed history.
11. With the add-on, automatically use `life_story_purpose_review` at completed
    chapters, significant turning points, completed parts or works, and
    consequential revisions. Review the relevant unit in context; retain work
    that already succeeds and revise only where there is a supported reason.
12. After drafting and substantive revision, save actual-prose author and
    character voice assessments as Understanding Nodes. For a later round,
    use `life_story_deepen` to inspect and improve the existing work against
    an exact baseline; do not automatically generate a replacement story.

## Author model

Model the author when generating new work, using the scope already delegated
by the human. Relate relevant experience, stated preferences, or writing
evidence to attention and outlook, then to concrete prose choices and their
possible costs. Reuse a sufficient profile; a full biography or another intake
is unnecessary. Honor the human's agreed involvement and decision checkpoints.
If authorial choices are delegated without a supplied real-author model,
create an explicitly fictional persona and record the choice. Do not silently
model the real user. An explicit choice to omit the author model, or a bounded
review or edit, remains valid.

Distinguish a real author from an invented persona. For a real author, retain
the source and uncertainty of each statement or interpretation; writing a
particular scene does not establish a matching personal experience. Never
fabricate missing real biography. An invented persona is explicitly fictional.
Also distinguish the modeled author from whoever records the profile, the
narrator, the viewpoint holder, and the characters. Narrators can contrast
with the author's outlook, and one author can produce varied work.

With the add-on, store a typed `meaning-model-story-author-model/v1` record
through `life_story_author_record` with `kind: "author_model"`. It contains
`modeledAuthorId`, `mode`, `label`, evidence in `basis`, writing dispositions,
and optional numerical dimensions. Dispositions link to their basis and
describe writing consequences, useful contexts, and risks or counterweights.
Writing samples require exact excerpts from graph source nodes. Define any
numerical dimension's meaning, comparison question, unit, and bounds; use
numbers for useful comparisons, not a universal personality or quality scale.
The [add-on guide](STORYTELLING_ADDON.md) specifies the fields.

Keep the model and revisions in scoped author-only graph records. Supply
`authorModelNodeId` during scene preparation and purpose review; for scenes,
`scene.authorApplication` connects selected dispositions to intended effects,
restraint, and the narrator's relation to them. Packets retain the exact
profile, and committed prose records `shaped_by` provenance. These links do
not make the profile world history or character knowledge.

Review whether the choices work in the actual text. A habit of noticing
maintenance, for example, can support causal clarity but overwhelm a scene
with explanation. Model both possibilities. Do not make each disposition a
requirement for every paragraph, mistake consistency for uniformity, or treat
the profile as proof of literary quality. Style efficacy remains an advisory
judgment, and deliberate variety remains available.

At composition time, locate the author in their life and writing history and
record why they are writing this work now. Keep unsupported real-author
information unknown; label fictional persona history as invented. These
causes can shape the work without requiring autobiographical exposition or a
message in each scene.

## Voice and later deepening

Characters' speech, silence and behavior should follow from their own modeled
processes: what they notice, want, understand, anticipate and have learned,
and how they respond to this relationship and situation. Use relevant emotion,
status and adaptation without making them universal axes. Adjectives, accents
and catchphrases do not replace the explanatory connections. Shared language,
deliberate similarity and changes of register are valid; distinguish them from
unintentional flattening.

Automatically review the author's voice and each relevant principal character
in the actual draft. Cite passages and the exact author-model dispositions or
character-process nodes/model paths. Distinguish intended effects from observed
ones, identify uncertainty, and give a smallest useful repair or a reason to
keep what works. Store this analysis with `life_story_author_record`,
`kind: "assessment"`, as an `externalized_reflection` Understanding Node linked
to the reviewed prose and selected author model; retain the reviewed hashes and
per-subject findings in `data`. Do not leave the analysis only in an exported
review. This is an advisory assessment against the model and text, not proof
of a real person's true voice or private beliefs.

`life_story_deepen` prepares a separate pass over an exact existing graph and
rendered-text baseline, with the model, life dossier, stored focus, context and
selected author model. Its default `local` scope preserves premise, cast and
ending; `structural` permits justified larger changes within the agreed brief.
Save the before-analysis, revision plan and after-analysis as Understanding
Nodes. Revise only where useful, preserving successful scenes and earlier
versions. There is no reroll or length quota. Refresh model-depth and scene
reviews when their evidence changes, then render and review the final graph.
Replacing committed prose needs explicit successor-graph placement because
scene commit is append-only; see the
[add-on replacement workflow](STORYTELLING_ADDON.md#deepen-an-existing-work).

## Overall life trends

Begin with a few broad phases rather than an exhaustive biography. Those
phases must span the life leading into the story, even when the narrated
events last only minutes. Carry the same selected dimensions through each
phase and explain the developments between them. A stable tendency needs an
account of what sustains it; a reversal needs circumstances that make it
credible. Multiple dimensions can move differently, and a character need not
have a single lesson, fixed personality, or continuous growth.

The calling LLM performs this step automatically before drafting scenes. Do
not wait for the user to request deeper characters or ask them to fill in a
life-history form. Reuse a sufficient existing life model; otherwise construct
one. Author needed life details within the agreed delegation, label them as
authored additions, and respect any reserved decision checkpoints. Preserve established canon, identify
inferences and unknown origins, and ask only about gaps that genuinely need
the user's decision.

Then connect scenes to these trends. Identify whose life is being continued,
tested, redirected, or brought into conflict with another person's life.
Refine a formative experience where a coarse explanation is inadequate.
Preserve uncertainty and alternative interpretations rather than inventing
precision or filling every year. Overall scope does not require a planned
death or a finished future.

The optional [storytelling add-on](STORYTELLING_ADDON.md) makes this an explicit
scene-workflow requirement. Before preparing scenes, store a life-trend
dossier with `life_story_life_trends`: at least three ordered phases and two
trend dimensions per principal character, covering each phase and
explaining each adjacent development. For newly generated trajectories, retain
the numerical proposal in `trajectoryProposal` and explain its values in these
summaries. Reference that dossier during scene
preparation and connect present or affected principal characters to its trends. These
counts establish a minimum structure; the author and reviewer remain
responsible for its substance and for semantic consistency with the prose.
The general-purpose engine and existing low-level tools retain their own
application-defined scope.

## Numerical exploration and local repair

An exploratory trajectory consists of numerical values at defined points,
not qualitative states chosen from a fixed psychology vocabulary. Emotional
and relational dimensions also need a precise meaning, comparison question,
unit, and bounds. If dimensions allocate a shared quantity among exclusive
answers, declare a disjoint allocation group and total. The sampler preserves
that total and explicitly fixed values. It does not discover unstated canon
constraints from context.

`life_story_trajectory_explore` uses at least two points for events and three
for whole lives. `randomness` (0–1, default 0.5) mixes the baseline with bounded
random proposals; `candidateCount` (default 3, maximum 8) separately controls
the exploration budget. A seed permits replay. These are creative hypotheses,
not simulation results or calibrated measures of real psychology.

Ask whether an unusual point has a believable cause and offers useful story
possibilities. A promising person need not be discarded because one transition
fails. `life_story_trajectory_revise` changes explicitly selected values with
reasons and a parent-candidate hash, while retaining unlisted and fixed values
and checking bounds and allocation totals. Preserve the original and revisions.
Repair the explanation when the values are sound; create an explicit new
proposal when categories or point times need to change. Stable or quiet lives
can be compelling; no compulsory shock, improvement, or ending is implied.

Store concise candidate assessments and local-revision explanations as genuine
Understanding Nodes through the existing narrative graph. Use a named
author-understanding root, `externalized_reflection` roles, explicit holders,
author scopes, and specific `about`, `refines`, or `supports` links to the
relevant model or candidate evidence. These nodes are deliberate explanations
for review, excluded from story rendering; they are not hidden model reasoning
or accepted world facts. The LLM is responsible for writing them. The numerical
tools do not evaluate literary merit. They persist numerical proposals and
revision reasons; use `life_story_author_record` for assessments and selections.

## Reconstruction mode

When modeling an existing work, exact source statements and actions remain
source authority. Internal states are alternative inferences unless the text
establishes them. Preserve narrator reliability, focalization, dramatic irony,
and narrative order separately from world chronology.

## Reader model

A creative run may model predicted reader knowledge, uncertainty, tension,
surprise, humor, attachment, or other responses. Reader state is a separate
observer process; it must not redefine what happened in the story world.

## Anticipation, change, and adaptation

The core `change_arc_scaffold` can supply optional anticipation, focal-change,
and adaptation Events. Use them when they explain the development rather than
imposing a three-beat pattern. Model what each character expects, what they
know, what changes, and how their responses interact with their overall life
trends. A shock can be welcome, unwelcome, or expected but still consequential.
Adaptation may begin before the focal change, overlap it, remain incomplete,
or fail; some developments need no shock at all.

Separately model author processes for intended reader anticipation, surprise,
and delayed understanding. A reader can be surprised by something a character
expected. Temporary suspense must have an authored disclosure explanation
while world history and character knowledge remain coherent.

## Review checkpoints

Before prose and after consequential model, trajectory, causal, or disclosure
revisions, review whether the model is deep enough to explain the story. Choose
subjects from the actual dependency: life trends and flaws, concepts,
physical constraints, institutional rules or incentives, causal events, and
author disclosure processes may matter. No story needs a fixed taxonomy or a
quota of decompositions. Preserve an adequate abstraction and explain why it
is enough; otherwise identify the smallest useful opening and its evidence.

With the add-on, `life_story_model_depth_review` reads the bound model and
selected graph records. `life_story_model_depth_record` saves the coverage
explanation and sufficient, unresolved, or unclear findings as a linked
Understanding Node. Evidence names stored nodes or JSON Pointers into the
actual model. Scene preparation requires a current
`modelDepthReviewNodeId` covering its life dossier and selected context.
Unrelated author notes or drafts do not invalidate it. Changes to its model,
source, or relevant story evidence require reassessment; review the affected
prose after a repair. Unresolved findings produce a packet with a commitment
blocker; missing or stale assessments fail preparation. Assessments, drafts,
and gaps can always be saved while their resolution is developed.

When an explicit model revision changes the graph's bound model, use
`life_narrative_revise` to rebind it. Retain earlier depth-review nodes as
historical assessments and remove their predecessor-model anchor edges only
from the successor graph. Earlier immutable revisions retain the exact
evidence. Do not retarget old findings to new values; create a new assessment
and its new model anchors for the revised story.

The static model definition is an administrative read, not a scope-filtered
projection or a substitute for current world values. State missing evidence
and uncertainty explicitly. The tool validates bindings and references; the
LLM remains responsible for the judgment of adequacy.

At a meaningful completed unit, the calling LLM reviews the text's purpose and
whether it is fulfilled. Use surrounding material to examine expectations,
causes, consequences, life trajectories, and the intended disclosure process.
The add-on prepares exact text for this judgment; it does not independently
invoke another model or retrieve all relevant context. A scene commit includes
a conditional reminder because the LLM must determine whether a chapter or
turning point has finished.

Purpose review is qualitative and advisory. Missing context can make a conclusion
unclear; uncertainty or delayed payoff is not itself a flaw. Keep-as-is is a
valid outcome, and there is no automatic rewrite quota or requirement to accept
a suggestion. Review after consequential revisions as well as completed
chapters, parts, or works, rather than applying a timer or grading each
paragraph. Make accepted changes explicitly and check their consequences for
canon and later uncommitted developments.

## Output contract

Every output should identify:

- accepted story facts;
- inferred or authored hidden state;
- alternative interpretations;
- hard, soft, optional, and renegotiable constraints;
- the causal explanation for important changes; and
- the resolution available if the user asks to zoom in.

The current software can execute authored trajectories and negotiate writer
constraints. It does not yet demonstrate that this method improves prose in a
blinded comparison.

The optional `life_profile_compile` MCP tool can translate the repository's
bounded Story authoring convention into an ordinary Rust model without
registering it. It is a convenience for explicit structure, not an automatic
story planner or prose generator.

Optional Decision profiles can be composed into that same model when a story
needs executable actor choice. They derive attraction, avoidance, commitment,
and action pressure from authored wants, fears, perceived options, habits, and
mode parameters. They are not mandatory personality types, empirical truths,
or Director authority over canon.
