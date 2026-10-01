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

Let the work choose its form. Fiction, nonfiction, poetry, letters, field guides
and unfamiliar forms need not share a plot structure. A protagonist, conflict,
climax, resolution or tension curve is not compulsory. Use the scene workflow
where scenes fit, and the shared narrative graph and editing tools for other
forms; do not invent a cast or fictional author to fill a template. Explore
language, attention, explanation, arrangement or other processes when useful,
with the same evidence and revision discipline.

For work using the scene workflow, the calling LLM models the relevant lives and
world through the recursive process below, letting model discoveries and
provisional prose inform one another. Supply the required life dossier and current depth review
before preparing scenes for acceptance; exploration need not wait for a
finished account. The user need not request the step, remember its tool
name, or fill in a dossier. Within the human author's delegated scope, the LLM
authors needed details and identifies them as authored additions. Respect the
agreed decision checkpoints before adopting those details. For existing canon,
reuse established facts, distinguish inferences, and ask only about gaps whose
resolution truly requires the user's choice. This responsibility is part of
the storytelling workflow, not an optional depth setting.

From the first exploration, consider how the telling develops as well as what
happens in the world: anticipation, rhythm, disclosure, humor, intimacy, or a
process discovered in this particular work. Follow useful questions recursively;
let exploratory prose change the model and let the model suggest new writing.
These are invitations, not required tracks, a dramatic formula, or a reason to
remove quietness and pleasure. Review the actual prose before treating an intended
effect as achieved.

When useful, record a qualitative telling process through
`life_story_author_record` with `kind: "assessment"` and optional
`data.schema: "meaning-model-document-process/v1"`. Supply `documentId`, `label`,
`question`, `summary`, and `states` containing a label, description, existing
`document.span` ID as `spanId`, and exact passage evidence as `{nodeId, excerpt}`.
The tool checks the quotations within their spans and automatically records the
reviewed passage hashes, reading order, and explicit links. The viewer exposes
these authored interpretations under **Reading position → Story processes**.
Document position follows the ordered text, separately from world time, the
author's life, and the authoring history. A numeric rubric is optional: use the
existing numerical grammar with a declared holder, anchors, units and uncertainty
when it answers a useful question; do not imply measured reader psychology.

Stable spans follow their passages through edits, but do not establish that an
earlier interpretation still holds. Changed passages or reading order mark phases
for review; missing attachments remain unresolved. Re-read the affected text and
record a new assessment with `supersedes` when replacing the earlier account.

After model revisions, use `life_revision_check` and, for adopted lenses,
`life_lens_questions` to revisit numerical readings. The revision check retains
older unresolved text dependencies as well as new ones. It follows numbers too:
when only a Cut's weights, a process's declared state or an account of its value
changes, it lists the scenes and notes of the Events concerned and the Events
they cause, so an upstream change reaches the scenes that depend on it. A state
and the attributed accounts of it are kept apart. The viewer separates
readings whose recorded Event text changed into **Needs review**, preserving
their exact values and attribution. Unchanged text is not proof that an
interpretation is correct; do not invent fresh measurements or alter historical
values simply to clear a warning.

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
fifteen tools and the four prompts listed above.

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

`life_story_author_record`, `life_story_world_record`, `life_story_life_trends`,
and recorded `life_story_direct` findings append to the newest head by default:
`graphHash` may name an earlier revision when it has exactly one descendant
head. If the graph has branched, name the intended head; the tool does not
choose a branch. Set `exactRevision: true` to use the supplied revision exactly,
which can create a branch when that revision is no longer the head. Automatic
advancement does not refresh the evidence behind your findings: inspect the
current records before recording a judgment about them. Use the returned
`graphHash` to continue. Author-record, world-record and recorded-direction
receipts also identify automatic advancement with `advancedFrom`. Scene
preparation, edits and release still use their exact requested revisions.

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

## Think in the model

The Meaning Model is where the story is thought. A language model has not
lived in the world it writes about. It knows people from text, not from a
life, and it has no sense of time of its own: it cannot tell what is true of
a person at a given moment, or what must follow from it. The model gives it
that. People are whole lives over time, with the wants their lives taught
them and the deepest wants underneath. The world has long developments that
explain why something happens today, and every person has a state at every
moment. The model drives the story, and the story is a consequence of the
model.

Anyone can get a small story from a language model alone. The reason to use
this tool is the depth only a model gives, so the tool keeps asking for more:

- **Open questions.** Every model registration and revision, in every mode,
  returns the model's own open questions (`openQuestions`), and
  `life_model_questions` returns all of them. Each question is read from the
  model's structure and names the tool that answers it. Typical ones: a person
  with a name and no life; a life with no periods; an outlook that drops from
  .78 to .22 with nothing between to cause it; a shock whose adaptation was
  never opened; a decision nobody drew; a principal who never chooses; a
  world in which nothing lasts longer than one life; Events that instantiate
  no concept; no laws; moments with no place; a drawn remainder nobody opened;
  a quantity no Event observes; a life that is one Event with nothing inside.
  The questions shown cover as
  many kinds as they can, and a rebind returns them read with the story graph,
  which knows which decisions are drawn. When a character decides, the
  estimator reads the model's state of the people taking part, and warns when
  much of the share falls on none of the options (the options miss what the
  person would do) or when the model holds no laws (the situation text is
  carrying rules that belong in the model).
- **Standing questions,** asked at every step about whatever is being worked
  on. Is there a macro aspect I must model to truly understand what is going
  on here? It could be something from a character's childhood or a war a
  hundred years ago, and you will not know unless you model it. Which
  assumptions have I not modeled yet? Which assumptions could stretch back far
  in time to create a deeper story? A story rests on what it takes for granted,
  such as why a house, a debt, a rule or a silence is as it is; model the
  consequential assumptions and follow the deepest back through the lives and
  the world's long processes. What kinds of
  reasons and circumstances explain what each person does? Fear/love is one
  optional lens when its question fits; duty, habit, curiosity, knowledge and
  material constraints can suggest other openings. What can be
  richer about this event, this scene, this character? What is it an instance
  of? Climb up to the concept or regularity that explains it together with
  other things.
- **Background reality.** Model far more than the story will show: the
  economy, seasons, bodies, institutions, other families, the technology of
  the day, the long histories. They run in the model whether or not a scene
  touches them. What the story shows is real because of what it does not show.
- **Jumps.** `life_model_questions` also returns the model's jumps, the places
  where it changes most: the largest shifts in what a person wants, expects or
  feels, the shocks that reach furthest, the closest-run decisions, and the
  moments two people read most differently. That is where the story should
  look.

The model is a language, not a form. Nothing in it is mandatory, and it can
express the same understanding in many ways, as a programming language can.
Templates and conventions such as the person template, periods and change
arcs are suggestions: look at them and ask whether this person, thing or era
is understood better through them, through processes of your own, or through
subcategories. The questions read common constructs; where you expressed the
same understanding your own way, a question may not see it. The model is never
finished, and there is no depth at which the tool stops asking. Open a process
or meaning, discover sub-processes, relationships and new categories or
questions, follow the fruitful ones, and revisit connected regions as the
account changes. Curiosity, play and surprise can start that recursion even
when the current account is sufficient. A run may pause with open branches
recorded; local sufficiency neither closes inquiry nor demands endless work.

## The process, from author to release

*The Book of Conditions* was made by a loop. Its human director told the
writing model what makes a good story, and each principle sent the model back
into the world model to make it deeper; the prose was then rebuilt from the
deeper model. The director never read the book. This process writes that loop
down so any agent can follow it without a human in the room. It is not a strict
workflow: the steps come in any order and recur whenever the model leads back
to them, understanding is recorded when it happens, and processes are modeled
whenever they are needed or an interesting question invites an opening. A
provisional draft may discover what to model next, and a model discovery may
change the prose. Save candidates and drafts while exploring; accepting their
commitments still needs the applicable model and scene reviews. Scene
preparation shows what the world holds and what is still open; it does not
wait for every world stage. Continue within existing creative delegation,
without requesting approval for each recursive opening.

**1. The author, and optionally a reader.** A book comes out of a life: what
its author lived through, what they could not settle, and why they write this
now. So model the author's life first, as its own life model:

- Give the author a lifecycle Event over the whole life, holding the
  processes the life runs through. Templates are suggestions: look at the
  person template (`person_scaffold`, the Book's nine slow processes) and ask
  whether this person is understood better through it, through processes
  invented for them, or through subcategories of either. Register the life and
  open it with the model's questions.
- Give it periods with intervals, shocks as change arcs with their
  anticipation and adaptation, and Cuts at the moments that matter for what
  the author wants, expects and feels.
- Model the author as an authentic person with conflicting wants. A life is
  learning, over its whole length, how to satisfy the deepest wants: to be
  safe, loved, known, free, to matter. The wants a life teaches are ways of
  getting them. Several live in one person, take over in different
  situations and bargain, and one can become a proxy that displaces the aim
  it served. This follows shard theory ([Udell, "Shard Theory: An
  Overview"](https://www.lesswrong.com/posts/xqkGmfikqapbJ2YMj/shard-theory-an-overview)).
- A shock changes many of a person's functions at once: what they want and
  believe, their habits, relationships, body, work and voice. Any concept can
  be a process over time (love, self-worth, grief, faith, a self-image, a voice,
  a style), and meaning is temporal: one state must be consistent with the
  next. A fixed description records one moment of such a process.

Ask whether the author lives in this world or a separate one. A memoir or a
story among the author's own people lives in this world; an invented world
usually does not. If the author lives in this world, when they write the book
matters: what they know then, and how far they stand from what they tell, shape
what can be documented. The author stage records both (`livesIn`, `writing`).
The author's life can be a model of its own or a realm of the story's model.
Either way, notes and reviews can be about records of both at once: an `about`
target with a `modelHash` reaches any stored model. So record what the author
lived together with what it shapes in the story.

Record the author's voice as the author model, derived from this life. Then
record the stage `author_reader` with `life_story_world_record`. It holds why
this author writes this story now, what they want to teach, and what they are
figuring out by writing it, citing the life records it rests on. It also names
the buttons the story presses in its reader: the fear, longing, shame or hope
it touches, and what the reader could learn about their own life. Just one
example: the cast of a sitcom, or something similar, who believe they are real
people until they see the show and recognize themselves as caricatures. That
premise presses a common fear: what if we are all just characters in a show,
and everything is fake? An example reader is
optional, and is modeled as a life the same way. The stage checks that each
life model exists and holds its person, and returns the model's open
questions about them.

**2. Candidate worlds** that come out of the author's life and press the
buttons (stage `candidates`). Propose at least three. Each needs an
interesting world, or an interesting event in our world, with its most
interesting processes, which are often long ones. Each needs interesting people
inside it and a premise with an emotional core. Test each for pressure: do
choices cost something, do the principals read the central shock differently,
does it change what they want rather than confirm it, would this reader keep
reading? Choose by argument.

**3. Opening** (stage `opening`). Expand the chosen world in successive
accounts of the same history: one paragraph, then two, then three. Build what
each account commits to into the model, macro processes first
(`life_general_modeling_start` models long developments before local ones).
What a scene later shows is believable when it follows from that larger
structure. Backtrack when the parent history could not have happened, or when it is
dramatically inert.

When the era is real, say so in the opening's `era`, with a documentary
cutoff: up to that date the world is what the sources document, and after it
the story invents. Your own knowledge ends where your training does, often
before the story's time, so find out what happened since with whatever
research tools you have. Record each documented fact as a report with its
source (`life_understanding_record`, kind `report`), linked to the model
records it grounds, and leave open what you cannot find rather than guessing
it. Where living people and real organizations would appear, invent the people
and companies that take their place, and keep the real world in the
background: its events, technology, prices and laws.

**3b. Aspects** (stage `aspects`). A book is a way of communicating specific
ideas. The goal is to use the model to create something unique that conveys
them: a story only this model could produce. Write down what ideas you want to
convey, often one for a short form and several for a long one, and for each idea
the strategy for conveying it: where the reader meets it, where the story tests
it and where it lands. A telling process can follow a strategy through the text,
and a blind read-back shows which ideas actually reached a reader. Compress the
story as you go: say it in one sentence, then in a paragraph, then in a page,
and record them as an author record about the story root (a compression is not
an opening of the world). If the sentence does not make it interesting, go back to the
model until it does; as the story grows, check that it still fits its sentence,
and revise one or the other. Find all the things
that make this story interesting, and investigate each in the model. The
opening and aspects stages return a
catalog (`interestCatalog`) of elements that often make a story interesting,
each with why it does and how to investigate it by modeling:
- people: flaws, conflicting wants, fear or love, choices, change,
  relationships, self-image, voices and secondary lives;
- events: the central shock, stakes and costs, causality, surprise with
  inevitability, tension, secrets and knowledge, open questions, reversals;
- the world: the era and its long history, place, mechanisms and technology,
  institutions and money, objects that return, the senses;
- meaning: the author, style, theme, what it presses in the reader, moral
  weight, joy and competence, humor, the ending.

The catalog is a beginning, not a boundary. Its questions are tips, not tests
to pass, such as what each person present wants in a scene, what stands in a
principal's way, how a place works against someone's aim, or what people handle
when they cannot say what they feel. Use your curiosity and your own knowledge
of what makes a good story as well, and the unique shape of this model: its
particular lives, processes, jumps and concepts show where this story's
interest lies in a way no general list can. The aspects stage records every
element, a flaw for each principal of the chosen world, and at least one
element of your own that no list names, with its category and why it makes
this story interesting. An element that turns out absent is still
investigated: say what the model showed.

A flaw is a process over a life, not a label. Model:
- the event that taught it, often a strategy that once served a deep want;
- the situations in which it takes over;
- where the same trait is a strength and where it does harm;
- what it costs in the story's choices;
- whether the person sees it, and whether it changes.

For example, someone who turns every threatened dependence into more
control: brilliant when the problem is design, damaging when authority has to
be shared.

Fear and love can be useful questions about particular motives and relationships.
Choose this lens when it explains something relevant, and identify what is feared
or cared for. It does not exhaust an act's reasons or replace its circumstances.
Keep the person's own account distinct from what another reader interprets.
Use numerical shares only for a declared comparison with a meaningful unit and
remainder. A qualitative account or a different lens may be sufficient.
The built-in template is available through explicit `lensIds` selection or
`life_lens_define`; new stories have no automatic fear/love reading backlog.
Existing authored readings remain available with their original meanings.

Investigating can take many forms, and so much can be done:
- create new processes, or refine existing ones;
- open sub-processes;
- add earlier Events that explain (a childhood, a war a century back) or later
  Events that follow;
- add Cuts and estimate them, and draw decisions;
- name the concepts and laws things instantiate;
- model how Things work and where everything is;
- try another decomposition, or sample trajectories.

Record a revised list as the model deepens and new aspects appear. Scene
preparation shows the aspects still open.

**4. Implications and lives** (stage `implications`). Follow each consequential
commitment into the model, and give every principal a whole life in the story
model, the way the author's was modeled. Ask which assumptions under the
commitments you have not modeled yet, and which could stretch back far in time
to create a deeper story; open the consequential ones in the model. Estimate meaningful quantities where
useful. For an unresolved fictional choice with a declared quantitative
question and delegated uncertainty, `life_direction_draw` can select among
modeled alternatives. Qualitative exploration and directly authored choices
remain possible; do not redraw an accepted outcome.

**5. Route** (stage `route`). Find where in the model the story is. Choose the
parts to render through the model's jumps; a route that renders none of the
largest jumps must say why the story is elsewhere. The route's record returns
its questions:
- parts without a recognized decision Cut, whose choices may already be recorded
  in another form or whose purpose may need no choice;
- decisions it renders that the model has since withdrawn;
- principals with no shock inside the story's present;
- the largest jumps it leaves out without saying why;
- aspects still open.

**6. The director on the world** (`life_story_direct`, stage `world`). Before
the first scene, the director holds the world to what makes a good story.
Examples:
- the story comes out of what the author is figuring out;
- the ideas it means to convey are written down, each with its strategy for
  conveying it;
- every principal is necessary to the causality;
- the central shock changes wants in different directions;
- no death or accident does the plot's work;
- the long developments and background processes are modeled;
- the Things the causality runs through are modeled as they work;
- a real era holds to its sources up to a stated cutoff, and living people
  are replaced by invented ones.

Each failure says whether the model, the prose, or both need to change. Any
principle may be inapplicable to this story when the review gives contextual
evidence; shared voices, quiet scenes, and restraint can be intentional.
Unanswered findings come back as questions in scene preparation. Model repairs
require a changed model and an `answers` record; prose-only repairs require an
answer and a fresh passing review of the exact changed prose. Give the director's
task to a fresh reviewer who has not written the work where you can.

**7. Scenes from the model's state.** Prepare each scene with its
`routePartId`. The packet gives each present person's state at that moment,
from the model: their period, the latest Cuts about them, the shock they are
still adapting to, what they decided and what is still undecided. It also
returns the model's questions for this scene, including any decision the scene
renders that the model has not drawn. Write each person from that state. After every commit, go back to the model's open questions
before the next scene.

**8. The director on the draft** (`life_story_direct`, stage `draft`), after
each completed part. The draft principles come from the Book's own passes:
- every scene passes the Book's character test;
- adaptation shows through objects that return with a changed use;
- principals are fallible and secondary people have lives;
- nobody delivers balanced, thesis-bearing speech;
- joy and discovery are felt;
- voices come from the modeled lives;
- sensory detail comes from the Things taking part;
- a fresh reader finds no causal gap;
- each person matches the model's state at each moment;
- every principal pays for the ending;
- each recorded idea reaches the reader through its strategy, as a blind
  read-back can show.

The principles are a start, not a boundary: every direction also records at
least one finding of the director's own, about what the work needs that no
principle names. What is interesting differs between stories and can lead to
further model openings as well as choices about what the story shows. No
fixed amount of modeling settles all future questions. `life_story_release`
refuses until a draft direction exists and its failures have been answered
through the applicable model or prose repair and review.

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
character remain separate roles. Where distinct voices matter, a blind
attribution check is one useful test: give a fresh reader an exchange with
speaker names and tags removed and report how many lines they attribute
correctly, with the denominator. A resemblance can be intended; the check
locates it and does not grade it.

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

When a declared quantitative question and delegated creative uncertainty benefit
from sampling, use `life_story_trajectory_explore` for candidate values at selected
points. First establish what the processes and quantities mean and why their
variation matters. New lives, Events and flaws do not require numerical scores.
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
relevant. Choose categories and comparisons that make the numbers interpretable.
Preserve the values and provenance of numerical proposals you actually use;
develop causal explanations alongside them. Unweighted process structure and
qualitative explanations remain valid when no useful quantitative question arises.

Each axis specifies its `meaning`, `comparisonQuestion`, `unit`, `minimum`, and
`maximum`. Establish an expected baseline at each ordered point and explicitly
mark any axis values that must stay fixed. Event exploration requires at least
two points; whole-life exploration requires at least three. A life candidate
must cover the intended lifetime interval, rather than rename a short crisis
as a life. When a life-trends dossier adopts a numerical proposal, its points
must cover `lifeBeginning`; the explorer warns when the first point is later. Fix axes that
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

Before preparing a scene for acceptance, automatically ask whether the model
supports the story's consequential commitments. Exploratory drafts and
candidates can precede this review and help discover what to investigate. Use
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
Use optional `modelEvidenceRefs` with the dossier to request exact records for
the focus. Model anchors from selected graph nodes also bring their full records,
including a Cut's question, unit and provenance when its anchor names one weight.
If the full model is too large, these selected records still accompany the task.
`omittedModelEvidence` identifies records beyond the inline budget and their
read routes; frozen runtime anchors are explicitly marked unavailable in this
static packet. Inspect the exact bound source for runtime claims, and mark
dependent findings unclear while it is unavailable. Follow other relevant
dependencies before assessing sufficiency; the automatic selection does not
claim that all necessary evidence has been found.

For existing work whose life histories and causes are already represented in
native model records, set `lifeTrendsNodeId: null` and supply `modelEvidenceRefs`
such as `event:<id>`, `process:<id>`, or `referent:<id>`. The tool returns those
records from the bound model for inspection. Do not invent a dossier merely to
repeat existing evidence; judge its adequacy for the selected focus and record
unknown history or insufficient coverage. This mode supports existing-work
review and revision. It does not satisfy the separate life-dossier and matching
depth-review requirement for committing a new scene.

Choose review subjects from what explains this story. Relevant questions may
concern a person's overall life, a flaw affecting a choice, the meaning of a
concept, a physical limitation, an institution's rules or incentives, a causal
event, or a disclosure process. For example, if the ending depends on a
character refusing a feasible rescue, inspect the character's reasons and the
rescue's actual feasibility. A trait label and an assertion that the rescue
cannot work may leave the central choice unexplained. Repair the relevant gap
without turning that repair into a ceiling on further exploration. The review
imposes no fixed *Book of Conditions* taxonomy, decomposition count, universal
psychology, or story-quality score.

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
proposals. An intentionally unresolved matter is not automatically a gap in
the scene's commitments: the model may preserve competing interpretations,
unreliable testimony, unknown motives or an open future. Explain why those
boundaries support this scene rather than inventing certainty to pass. An
unsupported claim that the scene relies on still needs repair. Sufficiency
remains a local authored LLM judgment, not a machine proof or an aesthetic
approval gate; a fresh question may reopen a sufficient account. A finding
about a well-represented open boundary may be `sufficient`; an actual `unclear`
or `needs_opening` finding still blocks scene commitment.

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

This describes accepting a scene, not a ban on earlier exploratory prose.
Move between discovery, model refinement and provisional drafting as the work
reveals new questions, preserving those candidates in the graph.

1. Follow the process above: the author's life, candidate worlds, opening,
   implications with every principal's life in the model, a route through the
   model's jumps, and the director on the world. Then automatically construct
   or reuse the author model and the principal cast's overall life trends,
   which summarize the modeled lives. Keep the author's basis and writing dispositions
   separate from the characters' histories.
   For useful quantitative questions, optionally explore numerical candidate
   points, assess coherence and storytelling potential, and repair promising
   candidates locally. Record concise assessments as Understanding Nodes. Store a new
   dossier with `life_story_life_trends` when needed. Supply it before scene
   preparation, without asking the user to supply the dossier. Use its graph
   revision for scene work.
2. Before preparing the scene for acceptance, use `life_story_model_depth_review`
   to inspect the bound model and stored story focus, life trends, and relevant context.
   Record the assessment with `life_story_model_depth_record`. Where an
   explanation needs more detail, make the smallest useful explicit refinement
   and review again. Reuse sufficient abstractions for this commitment;
   another question may still make opening them worthwhile.
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
- optional `passages`: ordered `{id, text, renders?, noLinkReason?}` units whose text joined with
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
IDs, texts, boundaries, `renders` selections and no-link reasons enter the review hash; changing or removing that
segmentation requires a new review even when the full draft text is unchanged.
The whole-scene review and citation offsets still refer to the complete `text`.
Omitting `passages` preserves the single-passage scene form.

Each passage defaults to the selected route part's Events plus `scene.renders`.
Review that scene association: a passage's own `renders` array overrides it
with the Events this particular text depicts. The tool validates identities
and creates native `grounding` / `renders` Event anchors. For a passage that
intentionally depicts no Event, supply its own substantive `noLinkReason`,
which suppresses inheritance and is recorded against the exact text. An empty
array alone is refused. Without segmented passages, the single scene leaf
uses the route-plus-scene selection, or `scene.noLinkReason` if it depicts no
Event. A link declares a dependency, not every fact the viewpoint or reader knows.

Every rendered passage needs an Event declaration or its own no-link reason,
including after narrative edits, splits, merges and raw batches. For old
unlinked prose, `life_narrative_grounding_propose` returns reviewable candidates
for all passages in one read-only call; the calling agent confirms or corrects
them with `life_narrative_grounding_apply`. Lexical retrieval does not establish
meaning. These tools preserve prose and require no external estimator keys.

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
human's agreement allows sharing with readers, use `life_story_release`: it
records the decision and its reason as an author record and widens the scopes
of the prose passages, their scenes, structural edges and declared Event/renders edges to the reader
scopes in `releaseTo`, or to every reader when `releaseTo: []` is explicit.
This changes reader access in a graph revision; it does not publish a website,
upload a manuscript or release a software package. The dossier, drafts, reviews
and author model keep their scopes. Render with the reader scopes afterwards
and read what a reader sees; the release does not check what the prose itself reveals.
Release refuses any rendered passage lacking an Event/renders link or a
current text-bound no-link reason; its recorded decision lists all such reasons.
It also names any telling phase whose reviewed passages or reading order have
changed since it was recorded, in its result and in the recorded decision.
Telling phases are author-only, so a stale phase does not stop the release;
re-read it and record a superseding assessment, or record why it stands.

Excluded containers included in the release may still hold text that a reader
could retrieve through a graph query, even though it is absent from the render.
For example, a passage split into children may retain its earlier text as a
container. Release refuses this case without writing anything. Edit that text
first, or pass `clearHiddenText: true` to clear it in the released revision.
Earlier revisions retain the text and their existing scopes; the receipt lists
`clearedHiddenTextNodeIds` so the change can be inspected.

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

The existing-work model-evidence mode also applies here: pass
`lifeTrendsNodeId: null` and `modelEvidenceRefs` to the tool. For the prompt, use
the string `"null"` and a JSON-encoded reference array. New-scene commitment
still requires its life dossier even after a sufficient existing-work review.

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
The returned `disclosureReview` automatically retrieves visible disclosure
plans linked to the selected passages, their containing nodes, or resolved
`document.span` intervals. Span coverage uses the current document projection,
including interior passages and the descendants of split passages. Superseded
plans are excluded; automatic membership in a story does not declare that a
plan covers every passage in it.

Inspect `unresolvedSpans` and `passageIdsWithoutLinkedPlan`. These are prompts
to investigate, not proof of a defect or of a plan's absence from the whole
model: unlinked or inaccessible plans cannot establish coverage here. Linked
plans do not prove what the prose discloses or what a reader understands;
`completenessVerified` and `semanticDisclosureVerified` remain false.

The task's scopes narrow to the audiences shared by the prose, selected author
model and disclosure evidence, including the links and paths used to associate
plans with passages. A review with no common scope is refused; retrieving a
plan does not broaden access to it. Still supply relevant life trends, prior
expectations, unresolved consequences and other surrounding evidence in
`context`; automatic plan retrieval does not retrieve all of that material.

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

When generative sampling is useful for a still-open fictional choice with a
meaningful quantitative question and delegated uncertainty, model its mutually
exclusive continuations as a direction Cut. Preserve accepted or observed
outcomes; a missing draw receipt does not make them undecided. Qualitative
exploration and directly authored choices remain valid, and a scene need not
contain a decision. If you choose to sample, fix the proposal weights and a seed
before drawing, then draw with
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
