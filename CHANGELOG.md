# Changelog

User-facing changes to the Meaning Model engine, MCP package, and bundled
artifacts. Released entries use package versions and UTC publication dates;
unpublished work stays under Unreleased. This is not a development transcript.

## 0.4.0 — 2026-09-26

- The MCP bundles its browser viewer. Ask the assistant to open a model or
  model-bound graph; `life_model_viewer_open` returns a local link to the exact
  revision without requiring a separate viewer checkout or run transcript.
  Calendar-based stories with numeric paths use the visual timeline; other
  models use a record inspector that preserves their units. Views are read-only
  snapshots, require complete scope access, and last while the MCP runs (up to
  sixteen open snapshots). Nothing is published by opening a view.
- The reading-position track selects passages independently of world time, with
  proportional prose lengths and Previous/Next controls. Selection highlights
  documents and their explicit Event links; reading opens separately and retains
  the entire manuscript. Document roots and their links remain visible.
- `life_document_project` derives UTF-8 byte coordinates from one exact native
  render. Optional `document.span` records follow stable passage boundaries and
  retained split containers through length edits; missing or reversed endpoints
  remain unresolved. World intervals and process values are unchanged.
- Split and merge operations accept explicit incoming or outgoing semantic-link
  assignments, preserve originals as history, and report omitted assignments.
  New leaves do not silently inherit every claim from the old passage.
- The Book of Conditions importer now records reviewed depiction links separately
  from general route associations, including the publication scene in Chapter IX.
- Source and npm exports reject local model databases and scratch artifacts;
  viewer packages exclude generated datasets. Legend and span labels render as
  literal text.
- Revision checks do not ask for Event links on title-only document roots.
  Prose-drift checks match whole words, so removed phrases beginning with "he"
  no longer match current text beginning with "she".
- Director findings distinguish model repairs from prose repairs. Contextual
  evidence can make any principle inapplicable, and shared voices or quiet scenes
  need not be defects. A prose-only repair requires an answer and a fresh passing
  review of the exact changed prose, without forcing a world-model change.

- Lenses: ways of seeing that the modeler finds, defines and asks of the model.
  `life_lens_define` records a lens (a question such as whether an act comes
  from fear or from love, or whether a person is wanting, bartering or standing
  for something; the kinds of record it is asked of; and its answers, or none
  when they are to be found case by case) as an Understanding Node of kind
  `lens`, linked to who or what it looks at. `life_lens_questions` asks every
  lens of every act, period, life or Event it applies to, lists the records
  still without an answer with the Cut id to answer each, follows where a
  person's answer changes over their life and where it never does, and keeps
  asking which other lenses would see what these cannot. Answers are ordinary
  Cuts whose ids begin `lens.<id>.`, so they are weighted, keep a remainder, and
  can be estimated and drawn; the engine is unchanged. Fear or love is built in,
  and its answers recorded before lenses existed still count. A lens on acts asks
  of every drawn decision through what was then done (the realized
  continuation), of the acts its `about` names, and of any moment answered
  under it; the other moments a person is the subject of are listed as
  candidates, since the model does not say which are acts and which merely
  happen to them, and answering one makes it a record. Change arcs are not
  periods, and a lens's Cut id keeps the Event id unchanged. Moments inside a
  person's change arcs are candidates too; an act lists the other principals
  who take part, whose own act is asked of them once it is modeled as its own
  Event; a record whose description reads like a note to the modeler is
  flagged; and defining a lens again revises it, the new version superseding
  the old while its answers keep their Cut ids.
- `life_estimate_cut_shares` no longer tells the estimator the lens readings of
  a person (lens answers, and fear-or-love answers in their own words) as part
  of their modeled state, so an estimate cannot read its own lens's answer for
  the period around it. It warns when a situation text reads like a note to
  the modeler, and it normalizes and records an estimator's rounding drift of
  up to two hundredths instead of refusing it; a caller's distribution must
  still sum to one.
- The estimator is told whose act it judges, the Event's subject by the name the
  model gives them, so a situation that centres someone else is still read as
  the subject's. A lens reading of an act that has happened is not warned about
  for being lopsided, and defining a lens warns when an answer shares a word
  with the model's own Cuts (wants, feelings, expectations, decisions).
- From an independent review (26 September): a lens version has a signature
  (its question, records and answers), which its answers carry in their unit;
  answers given to an earlier version are listed as stale, to be answered again
  under the same Cut id. Trajectories compare readings as distributions: a
  reading that puts most weight on none of the answers is unclear and asserts
  nothing, a close difference is a possible change to look into, a clear move a
  change whose cause is missing, and a large move under one answer a shift.
  Revising a lens from a stale graph hash writes at the newest head. Timed
  model questions without a story graph say the draw history is unknown rather
  than failing. A draft direction records the prose it read, and release
  refuses prose changed since; the director's draft task renders only the
  story it directs. An estimator's complete shares are scaled to one in both
  directions.
- Lens trajectories follow the theory's rules for comparing readings: only
  compatible readings (one person, one kind of record, one lens version with a
  fixed vocabulary; fear or love compares by its love and fear families), with
  the remainder kept in the distance, each labeled an attributed account, and a
  change placed in the estimate, the situation or the person before a cause is
  sought. A lens whose answers are found case by case is exploratory and has no
  trajectories. A record a lens does not fit is declined with a note, not a
  number; old not_applicable answers count as declined.
- An estimate records a signature of its Event's text, and a lens reading of an
  Event rewritten since it was read is listed as stale. Every Event answered
  under a lens is one of its records, change arcs included. `life_lens_questions`
  takes an optional `modelHash` to read a model the graph is not yet bound to.
  A lens reading that fits none of the answers is warned about in the lens's
  terms, and a rebind names dropped anchors only when there are some.
- A withdrawn record leaves the current account in the engine: a withdrawn
  abstract cut no longer takes part in the hierarchy's acyclicity check, so a
  replacement may reverse it, and a realization of a withdrawn concept no longer
  covers its Events in semantic coverage.
- The engine keeps up to 512 model revisions (256 MB) in a state file, up from
  64 (64 MB). A story model is revised often, every applied estimate being a
  revision, and a construction replays through every one, so 64 was reached in
  three rounds of lens estimates on one story.
  `life_model_questions` gives lenses with unanswered records up to two places,
  and its standing questions now ask which ways of seeing could explain what is
  being modeled.
- A lens reading is held by someone, so it now sits beneath its holder instead
  of on the record it reads, where it carried the world's authority. The engine
  has an `about` Event relation: the source is about the target without taking
  part in it, and it carries no causal meaning and no context.
  `life_lens_place` adds the holder's understanding root (a context root of
  kind `understanding`) and one reading Event per record, contained by that
  root and linked `about` the record, and moves the lens's Cuts that sit on the
  record onto it with the same ids, questions, units and weights. A lens has a
  `perspective`: the modeler's reading (the default), or the actor's own
  reasons as canon, which go on an inner Event under the actor's inner root at
  the decision. A lens keeps its perspective across its versions: a different
  holder is a different lens. It also has a reading type (allocation or
  support, by default support), the divided unit in words and a status.
  A model that declared no context roots gets its world's top Events declared
  as accepted world, and placement refuses to split Cuts that condition across
  them. A Cut that merely matches a lens's question is reported and left in
  place, since it may be canon, and Cuts in a conditioning or recomposition
  chain are not moved alone. The tool lists the estimates to recheck: those
  made without an Event-text signature, which may have read lens readings as
  part of a person's state. The estimator reads a reading Event through its
  `about` link: the record's text, subject and signature, and the record as the
  model holds it for the modeler's reading, and the actor at the decision, from
  the decision's text, for an inner Event. `life_lens_questions` shows where each open
  record's and candidate's reading goes, and the model's open questions ask for
  readings still on their records to be placed; declined records no longer
  count as open there.
- From the fifth round on the published story: a reading of an Event rewritten
  since it was read is stale even when it answers the lens's current version
  (the check was skipped for signed readings). Readings of Events that overlap
  in time are compared as concurrent, two stances held at once, not as a change
  from one to the other. An Event beneath an inner root is what a person thinks
  or feels, not an act, and is no longer offered as an act candidate. The
  estimator names each person in the modeled state by the name the model gives
  them, as it already named the subject. A record that names no person says
  so, since a lens about people would otherwise be asked of no one in
  particular.
- From a theory review of the placement:
  - What is a reading is decided by where an Event sits (under an
    understanding root, or made by `life_lens_place`), not by an `about` link,
    which world Events use too.
  - A model without context roots stays one world. `life_lens_place` first
    lists its top Events. Given `worldRoot`, it contains them under one untimed
    History Event, declared accepted world, and gives any that are not this
    world a root of their own; it refuses where that would split a
    conditioning chain.
  - A Cut that only asks a lens's question in its own words no longer counts as
    the lens's answer until the modeler says whose it is, with `resolve`: canon,
    reading or direction. Direction Cuts (decisions, forecasts a relation names,
    drawn Cuts) never count.
  - Trajectories check every pair of records. Overlapping records are a split.
    A record nested in another is a finer record of the same stretch, neither
    a change nor a split. Only disjoint neighbours are compared for a change. Families are
    total, so an answer in no family compares as other, and a defined lens may
    declare families.
  - A lens can be asked of inner records (what a person thinks, feels or tells
    themselves), compared only with other inner records. Events under inner,
    understanding, document or candidate roots are not offered as acts. Lens
    Cuts and Cuts on reading Events stay out of the model's uncaused-shift
    questions and its jumps.
- From the sixth round: a shift in a person's state that the model gives a
  cause for (a causal relation into the later record or what contains it, or
  into the person's Events from an Event between the two) is no longer asked
  about. An estimate signs the situation text it read, and the estimator warns
  when that text is too short to judge, as a decision Event's description that
  defers to its Cut often is. The placement's lists say when they are cut short,
  and its recheck says how to recheck: with the situation an estimate was made
  from.
- A lens reading opens deeper, level by level, as the theory's Cut hierarchy
  does: fear, then fear of what. A lens's answers may have children, the kinds
  they open into, and a level may also be found case by case. Each opening is a Cut on the same reading Event, conditioned on the
  answer it divides, with its own remainder, and a remainder can itself be
  opened ("what else"). Each level is versioned by itself, so opening deeper
  leaves the levels above valid. `life_lens_questions` shows each reading's
  joint shares down every path, so answers at different depths are measured
  against each other. Its openings name, for each answer or remainder that
  carries at least 0.3 of a reading and for an answer that holds while its
  reading shifts, the Cut id, question, unit, conditioning and kinds to estimate,
  and why to open it. A stop is recorded as a sufficiency note and is not asked
  again. Kinds found case by case that recur in three readings ask for their
  level to be fixed. A trajectory's new kind, composition, finds an answer that
  holds while what it is made of changes. The estimator is told which answer a
  level divides but never its weight, and a lens reading's levels stay on one
  reading Event. Placement moves a reading's deeper levels with it.
- A drawn Cut keeps the weights it was drawn from: the estimator refuses to replace one, before any estimate is paid for
  when a realized forecast names it, and at apply when the graph records its
  draw. An estimate is not told the answer it is estimating again. A period is
  also cut by the person's own inner states within it.
- It is always possible to revise, and a revision keeps the whole consistent.
  `life_revision_check` takes the model before a revision and after it, names
  what changed (Events rewritten, retimed or removed; Cuts reweighted,
  withdrawn, removed or moved) and everything that depended on it: Cuts
  conditioned on a changed Cut, draws made from weights that have changed,
  readings and estimates whose Event text changed, later Events a changed one
  causes, and the passages and notes anchored to changed records. A passage
  that renders no Event is reported as unchecked, not as unaffected.
- A committed scene links each segmented passage by `renders` only to the
  Events that passage explicitly names. Omitted mappings remain unchecked;
  route and scene Event lists apply only to an unsegmented scene leaf. Selections
  are validated against the bound model and included in its review hash. That link is
  the passage's declared dependency, which is how a revision finds the prose to
  regenerate or mark, and how a view places a passage in world time as well as
  in reading order.
  `life_lens_reread` reads every stale lens reading of the records named again,
  across lenses, with the same questions, answers and units, in one model
  revision, and reports how far each moved.
- From the seventh round: a decision followed by a long stretch (months of a
  rebuild after one evening's choice) no longer lends the moment's readings to
  the stretch: the stretch is its own record, read as a stretch. Wants that last
  most of a life are not inner records, since they are what an account is
  about, and inner records are not checked for fit like world stretches. A
  lens's about list is optional again.
- From a theoretical review of generality, and the rule that only what a model
  needs is added:
  - General modeling assumes no human narrative. Fear or love is built in only
    when the storytelling profile is adopted, and so are the questions that give
    people whole lives (a life, its periods, wants, shocks and choices), the
    standing question about the reasons behind acts, and the suggestion to draw
    undrawn decisions:
    a draw constructs fiction, and in a model of what happened a decision is
    observed. The lens survey and the general guide ask about processes,
    dependencies, thresholds and observers instead.
  - Nothing holds a stretch to what it contains unless the model declares how
    it composes, as a temporal recomposition the engine checks: meaning,
    evidence and success do not average (two stages that each succeed at 0.9
    succeed together at 0.81). A record nested in another is neither a change
    nor a split.
  - A lens's reading is an allocation or support. Answers that co-occur (an act
    can be a quarrel and a farewell at once) are a joint answer or separate
    lenses; a fit reading type will be added when a model needs one.
  - Opening has no ceiling. The questions suggest openings down to a default
    depth of four, report the ones beyond it as beyond the limit, and take
    maxDepth to go further.
  - A model question can be answered "sufficient here": an Understanding Node
    about the records it concerns, with data { schema:
    meaning-model-sufficient/v1, kind, reason, reopenIf }. It is not asked
    again while the note stands. A note covers every question of its kind only
    when it is about the document root; a note whose records are gone lapses.
  - A lens offers only what a model needs: the reader perspective, the text
    and prose evidence policies, and placing readings by an earlier version's
    perspective are gone. A character's estimate of another person is an
    ordinary inner estimate Event with its Cut.
  - A lens reading depends on the text it read, and is stale when that text is
    rewritten. Its dependence on the modeled state is not tracked until a model
    needs it.
- From the eighth round: the revision check counts a draw whose Cut carries its
  own drawn weights again as consistent. The bulk re-read also answers readings
  given to an earlier version of a lens, under this one, and can read each
  several times, applying the mean and reporting the spread and the estimator's
  confidence, so a move within its noise shows as noise. A lens defined with a
  built-in's id keeps the families and matching the built-in declared, and an
  answer given under the same question to the exploratory version, in keys the
  fixed vocabulary has, carries over. A note may be an assessment, and a lens
  that names no one is about the whole work.

## 0.3.0 — 2026-09-25

- A refused `life_profile_compile` request returns a complete valid example of
  the scaffold kind it asked for, from the engine's own example command, rather
  than one missing field at a time. The tool presents the scaffolds as starting
  structures to adapt: a whole life, a shock with its anticipation and
  adaptation, a Thing, a relationship or a concept.
- Learn from the novel run of 2026-09-24:
  - The questions shown after a model change cover as many kinds as they can,
    the principals taking at most half, and eight are shown instead of six.
    In that run four undrawn decisions filled the list for over an hour while
    the missing laws and places were counted but never shown. Missing laws and
    places now rank before thin concepts.
  - Draws live in the story graph, not the model, so a model change names its
    decision Cuts together instead of claiming each is undrawn; every drawn
    decision had been asked about again. A rebind returns the questions read
    with the graph, which names the ones truly undrawn.
  - A principal who never chooses is asked what they choose. A route part
    whose Events hold no decision is asked who chooses in it, when the route
    is recorded and in each scene's preparation, and a scene's unplaced Events
    are asked where they happen.
  - The estimator reads the model: for an Event target it sends the modeled
    state of the people taking part (their period, latest Cuts and the shock
    they are adapting to). It warns when 0.3 or more falls on none of the
    options, which means the options miss what the person would do, and when
    the model holds no laws, claims or abstract relations, which means the
    situation text is carrying rules that belong in the model.
  - Decisions drawn after the author and the buttons were recorded, or after
    the director last held the world, bring both back as questions.
  - The catalog's secrets element asks for the secret's social life: a
    knowledge or belief process for everyone who could know or suspect it.
  - A decision's moment is its own time. A motive Cut counts for it within
    the decision Event, give or take the longest of its own length, a
    twentieth of the Event containing it, or a thousandth of the life. Before,
    one unit of the model's clock counted, which is a year in a model counted
    in years, so the question never fired.
  - A drawn remainder that nothing opens, a process with only a starting value
    that no Event observes, and a life that is one Event with nothing inside
    are asked about.
  - The route's record returns the route's questions:
    - parts with no decision;
    - decisions it renders that the model has since withdrawn;
    - principals with no shock inside the story's present, which runs from the
      first part's moment to the last one's;
    - the largest jumps it leaves out without saying why;
    - aspects still open.

    Scene preparation asks the story-wide ones.
- Hold a real era to its sources. The opening stage takes an optional `era`:
  real, alternate or invented, with a documentary cutoff, where the modeler's
  own knowledge ends, and the invented people and companies that take the
  place of living ones. What it leaves unstated comes back as questions when
  the opening is recorded and in every scene's preparation. Understanding
  notes gain the kind `report`, which carries its source (citation, url,
  published, reportsOn) and is stored as a report rather than a belief, so a
  documented fact stays distinct from what the modeler supposed or invented.
  The director gains `world.documented`, and `draft.documented` keeps living
  people and real organizations out of the story.
- Ask where acts come from. A standing question, asked at every step in every
  mode, asks what kinds of reasons lie behind what the people in focus do,
  whether they are primarily out of fear or out of love, and what that fear or
  love asks of them. The same act can come from either, and what it does to
  the person depends on which. The story catalog gains the element *Fear or
  love*: the reasons as Cuts whose shares shift over a life with shocks and
  with being seen, what the person believes the reason is against what others
  read, and what the act does afterwards. A choice and the author's reason for
  writing are asked the same.
- Make the model the place where the work is thought, in every mode. Every model
  registration and revision now returns the model's own open questions, and the
  new `life_model_questions` tool returns all of them. They are read from its
  structure, and each names the tool that answers it:
  - a person with a name and no life, or a life with no periods;
  - a shift in a Cut with nothing modeled between to cause it;
  - a shock whose adaptation was never opened;
  - a decision nobody drew, or weights nobody estimated;
  - a world in which nothing lasts longer than one life;
  - Events that instantiate no concept, and no law linking what recurs.

  The same tool returns the model's jumps, where it changes most, and each
  person's state at a moment: their period, latest Cuts, the shock they are
  adapting to, and what is decided and undecided. Standing questions ask at
  every step how the thing in focus could be understood better, which macro
  aspect is missing, what could be richer and what it is an instance of. The
  modeling prompts no longer say "model only what the application needs" or
  that a person model is optional. Templates are presented as suggestions: the
  model is a language and none of its constructs is mandatory.
- Storytelling now follows a written-down process before any scene:
  - the author's life as its own life model, then why they write this story,
    what they are figuring out, and the buttons it presses in a reader;
  - candidate worlds, an opening in successive accounts, and a list of every
    aspect of the story to understand better, each investigated by modeling;
  - implications traced into the model, and a route through the model's jumps.

  All six stages are recorded with `life_story_world_record`. Scene
  preparation gives each present person's state at that moment from the
  model, together with the model's questions for the scene, and every scene
  commit returns the open questions before the next scene. The stages are
  investigations in any order, not a sequence.
- Add a catalog of what makes a story interesting, from flaws, conflicting
  wants and choices to the era, mechanisms, objects that return, theme and the
  ending. Each element says why it makes a story interesting and how to
  investigate it by modeling. The aspects stage records every element and a
  flaw for each principal, modeled as a process over the life. It also records
  at least one element of the agent's own: the catalog is a beginning, not a
  boundary.
- It is not a strict workflow. The world stages can be recorded in any order
  and revised whenever the model leads back to them, and each checks only
  against whichever related stages exist. Scene preparation reports missing
  stages, the route part and the director's findings as questions, not
  blockers. Only correctness checks block a scene, and release still waits for
  an answered draft direction.
- Stop chaining graph hashes by hand for add-only records. Notes, reviews,
  author records, world stages, directions and life dossiers may name any
  earlier revision and go to the graph's newest head. A retry keeps its
  receipt, a branched graph names its heads, and `exactRevision` branches on
  purpose. Before this, a stale hash silently forked the graph.
- Let notes and reviews be about records of any stored model. An `about`
  target with a `modelHash` names a record of another model: an author's life,
  a concept definition, another world. The tool checks it and keeps a reference
  node showing the record's description, so one note can hold the author's life
  and the story together.
- Ask whether the author lives in the story's world or a separate one. If this
  one, the author stage records when they write the book and what they know
  then. The questions ask for understanding that joins the author and the
  story, in either layout.
- Engine refusals from the person and change-arc templates, and an empty first
  model, now say what they expect.
- Keep instructions short and open-ended. The specifics reach the agent where
  they are used: in the model's questions, its jumps, each person's state at a
  moment, the schema descriptions and the validation messages.
- Add the director, `life_story_direct`. It holds the world, before the first
  scene, and the draft, after each part and before release, to principles of a
  good story. The principles come from the Book of Conditions' own record of
  how it was made. Each failure must be answered in the model first: scene
  preparation and `life_story_release` stop until the bound model has changed
  and a record answers the direction. Every direction also records at least one
  finding of the director's own.

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
- Keep model anchors that name the model by its stable id when
  `life_narrative_rebind` moves a graph to a successor model; only anchors that
  name the predecessor hash are dropped.
- Add the construction record: the model and its Understanding Graph are the
  modeler's understanding, so what is done and why is recorded where a later agent
  can read it.
  - `life_understanding_record` records choices, ideas, predictions, questions,
    voice decisions and reasons as Understanding Nodes held by a named holder,
    each linked to the model records or nodes it concerns and stamped with the
    model revision it was written against.
  - `life_review_record` records a review under its actual reviewer (another
    model, a blind reader, an estimator or a person), with what it was given, how
    independent it was, the exact revision and text hash it read, and its findings.
  - `life_model_outline` reads the present state as an outline with the linked
    notes at a chosen depth.
  - `life_construction_replay` replays the graph and model revisions from the
    first, each step with its reasons, changes and notes, each note beside the
    records as they were when it was written. It pages, focuses on records, and
    replays a model revision chain alone.
  - `life_construction_export` writes the whole construction of a model-bound
    graph as a portable history with a bundle hash, and
    `life_construction_import` rebuilds it on another engine, checking that every
    model and graph hash is reproduced. Steps that only added records go in as
    additive batches and the others as revisions by change.
  - In the outline and the replay, a review leads with its verdict, and a note
    linked to several records is shown once and named at the later ones.
    Structured records, such as alien worlds, mechanisms and ontology decisions,
    show their title and their most readable field. The replay names titled
    records at outline level and gives each readable record a line at the
    reasoning level.
  - The modeling, storytelling and alien prompts ask for this record, and for a
    replay before continuing existing work. Story author records gain the kinds
    `idea`, `prediction`, `question`, `decision`, `reference` and `voice`, and
    `about` links to model records.
- Require descriptions where numbers live. Model registration and revision report
  `descriptionCoverage`, the Events that carry a Cut without a description, and
  `requireDescribedNumbers` refuses them. `life_model_ingest` refuses to place a
  Cut on an undescribed Event before asking for any estimate, and can now add a
  missing description without `replaceExisting`. `life_estimate_cut_shares`
  records the situation text it judged as a missing description. Story scene
  preparation reports an `undescribed-numbers` blocker.
- Let narrative graph edges anchor to a normalized Cut (`normalized_cut`), and with
  a path to one of its answers.
- Revise a narrative graph by its change. The engine operation
  `revise_narrative_graph_by_change` applies upserts and removals to the stored
  predecessor, refuses a caller whose scopes hide any of it, and validates the
  successor as a complete revision. `life_narrative_rebind`, `life_narrative_edit`
  and `life_construction_import` use it, and `life_narrative_revise` accepts a
  `change` instead of the complete graph, so neither the call nor the idempotency
  receipt carries the whole graph. A 147-revision story now imports with about
  3 MB of retained receipts instead of exceeding the 64 MiB budget.
- Keep every narrative revision materialized in the engine as persistent maps
  (the `rpds` crate) that share each unchanged node and edge with the parent
  revision. A read no longer replays the history from the first revision or
  recompiles the graph, and change records are built by a linear merge instead
  of a quadratic search. On a 147-revision story, reading the newest revision
  takes 1 ms instead of 57 ms and importing the history 0.9 s instead of 7.3 s.
  A session may now keep 4,096 revisions instead of 512.
- Check structural acyclicity with `petgraph` instead of three hand-written
  copies, and name one cycle in the error, for example
  `decomposition graph must be acyclic; this cycle must be broken: a -> b -> a`.
- Keep edge explanations through rebinds, history exports and revision reads.
  The list of revision fields had left out the stored `explanation` of an edge, so
  a rebind silently dropped every explanation in the graph.
- Fix friction found when fresh agents used the tool with no coaching
  (2026-09-23):
  - `life_model_ingest` files each note under its holder's own understanding
    root, the one `life_understanding_record` uses. It used to take the first
    root in the graph, so a modeler's notes could land under an estimator
    review. The ingest's question definitions and situation texts go under
    `understanding.ingest`, and notes may carry a kind and a title.
  - A `continuation` session mode for continuing recorded work. Its prompt starts
    with the construction replay and the outline, and asks for the reading and
    the plan as notes before the first change.
  - The recording instruction shared by prompts and tools asks the agent to put
    every reason it gives the user into the graph before replying. A later agent
    reads the graph, not the reply.
  - `life_model_outline` shows each Cut's unit, so a share of a change and a
    credence no longer look alike, and accepts a graph and a model hash together
    when the graph is bound to that model.
  - `life_direction_draw` now says that its intervals run in the stored order,
    which sorts a Cut's answers by key, and refuses a withdrawn Cut.
  - Withdraw a Cut, a concept or an abstract cut instead of deleting it:
    `withdrawn: {reason, superseded_by?}` keeps the record as history, so the
    notes anchored to it keep their links, and the outline marks it withdrawn.
    The engine refuses a current Cut conditioned on a withdrawn one and a
    current abstract cut that names a withdrawn concept; existing model hashes
    are unchanged. `life_narrative_rebind` now refuses a successor that removes
    a record notes are anchored to, names the links, and points to withdrawal,
    instead of failing inside the engine.
  - `life_model_revise` takes a `change` instead of the whole model: records to
    add or replace and ids to remove, per collection. The server applies it to
    the stored predecessor and the engine validates the complete successor.
    Agents had fetched, scripted and resent definitions of 170 to 321 KB to
    change a few records.
  - A world outlives the server process that created it. The engine kept world
    heads in its state file, but the server held world handles only in memory,
    so after a restart the world a graph named was "unknown". The server now
    reopens a persisted world by its id.
  - The replay and the outline show each review's findings and which later
    notes answered, contradicted, refined or superseded it; a replay focused on
    a review also finds the steps that responded to it; and model changes now
    include abstract relations and encapsulation cuts.
  - A distribution the caller supplies to `life_estimate_cut_shares` or
    `life_model_ingest` is recorded as the caller's (`suppliedBy`, such as the
    modeler), not labelled as estimator output.
  - Estimate results carry `estimatorCallsThisRequest`; an apply that adopts a
    saved proposal reports the estimate's usage but makes no provider call.
  - The start prompts list their allowed purposes and session modes, and the
    general guide says what Jev's weights are and are not: uncalibrated on
    "main driver" questions, led by the supplied text and prior knowledge,
    anchored by current values in dated estimates, and answered one question at
    a time.
  - `life_understanding_read` reads named notes or reviews whole, with their
    data and the links into and out of them. The replay now cuts reasoning-level
    notes at 8,000 characters instead of 4,000 and says where it cut and how to
    read the rest; probes had pulled graph neighborhoods of 231 KB and 809 KB to
    read one review.
  - A node read back from a query can be written again as it came. Narrative
    registration, revision, revision by change and batches drop the fields a
    query adds for display (`boundary`, `content_included`), which batches had
    refused; a node read without its content is refused, because writing it
    back would blank its text.
  - A review of material outside the graph names it in its revision reason,
    provenance and data instead of claiming a graph revision the reviewer never
    saw, and a first review that is about nothing in the graph is refused with
    the fields that would link it.
  - `life_understanding_record` asks for one holder id per agent for the whole
    session, with roles named in the note; a continuation had written under three
    spellings of itself.
  - `life_narrative_edit` lists the records that still quote text the edit
    removed from the prose (`recordsQuotingRemovedText`): the model's Event
    descriptions, plans, disclosure records and writer's notes, but not reviews,
    drafts, assessments, revision notes or superseded notes, which quote old text
    as history. A probe had found Events and notes still quoting sentences that
    revisions had cut, with no tool saying so. The match is textual: it finds
    copied or quoted sentences, not paraphrases. `life_narrative_drift_check`
    finds drift that already exists, from the graph's history: on the
    45-revision test story it named the plan, a writer's note and an Event that
    the probe had found by hand, and nothing else.
  - `life_narrative_alignment_audit` takes `unnarratedNodeIds` for records the
    prose leaves out on purpose: they are still checked for contradiction but no
    longer flagged as not narrated. Narration flags are reported for the whole
    unit only, not for every passage that does not carry the fact.
  - `life_story_life_trends` takes `links`, so a revised dossier can supersede
    the one it replaces.
  - `life_story_release` in the storytelling add-on releases a story's
    committed prose to readers. Prose inherits the author-only scope of the
    records it was built from, so a reader's render showed only the title. The
    release records the author's decision and widens the scopes of the rendered
    passages and the containers on their way from the root, with their
    structural edges; excluded passages, canon, the dossier, drafts, reviews and
    the author model keep theirs, and prose that is already public stays public.
    A container the render does not show but that still holds text, such as a
    passage later split into parts, stops the release unless `clearHiddenText`
    clears it in the released revision. `releaseTo` is required, so publishing
    to everyone is always explicit.
- Add a guides-first reading mode, `MEANING_MODEL_READING=guides`. The start
  prompts, `life_modeling_context`, the served protocol and the storytelling guide
  then make the guides, the protocol and an example the entry, and the two papers
  a reference to open where a rule needs its reason; the paper gate on
  `life_profile_compile` is lifted. The default stays paper-first. The mode exists
  to test whether the tool's own guidance is enough.
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

Install or build the matching 0.3.0 engine when upgrading the MCP package.
The engine gains the `realizes_forecast` event relation, a source-preserving
narrative revision flag, withdrawn Cuts and native narrative revision by
change, and keeps narrative revisions materialized, holding at most 4,096
graph revisions in a session. The new fields are optional: models without
them serialize and hash as before, and models and graphs written by 0.2.x load
unchanged, so no data migration is required. A storytelling project begun on
0.2.x needs the director's draft review (`life_story_direct`, stage `draft`),
with every failure answered in the model, before `life_story_release`. The
alien add-on is a first release; its worlds are textual thought experiments and
its transfers are ideas, not evidence. Jev estimates remain AI inference and
never enter a model or graph without an explicit apply or record. The matched
comparison with ordinary writing and the independent read-back study remain
prospective.

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
