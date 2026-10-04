# Meaning Model Modeling Protocol

This document is the operational entry to Meaning Model construction. It states
the common contracts needed to use the tools; purpose-specific guides add their
workflows. *The Meaning Model* and *Life Simulation* explain the reasons and
broader theory and remain optional references.

The MCP resources serve the canonical Meaning Model manuscript from
`paper/meaning-model.tex` and the frozen Life Simulation companion from
`docs/companions/life-simulation/life-simulation.tex`. The companion's source
file digests are recorded beside it in `SOURCE.json`.

## Entry

At the start of a new task, ask what the user wants to do with the Meaning Model
and what they want to understand or create, unless their request already says.
Reuse the agreed scope and delegation on continuation; a bounded edit or review
does not need a new intake. Offer once to open the viewer so the user can see the
processes and their changes over time. Reuse a stated viewer preference, and do
not hold up modeling while an optional viewer offer is unanswered. If requested,
call `life_model_viewer_open` once a model is available, return the local URL and
open it in the browser when supported. For ongoing work with a stored graph, use
`mode: "live"` with the intended `graphHash` and existing `accessScopes`; use a
snapshot for a fixed revision or a model-only view. The viewer runs on the MCP
computer and follows saved revisions in live mode; it does not publish the model
or authorize access to more material.

Call `life_modeling_context`, read this protocol and the guide or profile for the
purpose, and inspect its worked example before expanding a model. A profile's
categories and compiler remain optional. Open a relevant paper section when a
distinction needs its reason or a difficult case exceeds this guidance; complete
paper reading is not a prerequisite. Resource digests identify versions, not
comprehension, and the server does not track reading or gate compilation on it.
Reuse unchanged guidance that you retain. Read it again when its content changes,
the purpose needs an unfamiliar guide, or relevant context has been lost; a new
conversational reply does not require rereading or a compliance record.

## Common modeling contracts

- **Identity and roles:** reuse continuing Thing and Event identities across views.
  Changes in location, ownership, role or interpretation do not alone create a
  new Thing. Record the identity boundary and continuity criterion; explicit
  splits, mergers or replacements may require linked successors. Bindings state
  time-scoped participation; an `about` link only references its target.
- **Numbers:** a normalized Cut divides one declared unit under one question
  among mutually exclusive answers and an explicit remainder. Nonnegative shares
  sum to one and are local to those siblings, never an Event's global importance.
  If increasing one answer need not reduce another and no competing unit can be
  named, use unweighted process or concept relations. Concurrent processes and
  overlapping lenses are not automatically allocations. Measurements and authored
  rubric values instead retain their unit or protocol, version, question, anchors,
  provenance and uncertainty; a zero-to-one encoding does not make a Cut. A rubric
  must justify the comparisons or aggregation claimed for it.
- **Perspective:** each claim or assessment belongs under its declared context
  root; a Cut inherits its parent Event's context. Participation, `about`, grounding
  and rendering links do not confer another record's authority. Conflicting
  perspectives require separate claims or assessment Events and Cuts. Accepting
  that someone believed, remembered or imagined something does not accept the
  depicted content. Actor speech and action can use their represented beliefs,
  wants, plans and inferences, with evidential access limited to what was available
  to that actor by the cutoff; co-presence does not disclose every fact or another
  person's private state.
- **Grounding:** `define` associates a Concept with its grounding; `describe`
  applies an exact grounding version to a target, retaining attribution, evidence
  and role alignment. Realizations are unweighted. If useful, grade each Concept
  independently with an assessment Event's fit Cut over matches, nonmatches and
  remainder. Concurrent Concepts need not compete for one unit. Fit is separate
  from confidence that the target occurred; fit remainder is not general uncertainty.
  Preserve earlier definitions and application versions when revising a Concept;
  a semantic split or merger normally uses linked successor Concept identities.
- **Use the dated account:** before a consequential answer, decision or rendering,
  read the relevant state, definitions and evidence at the intended time under the
  relevant holder and context. Use `life_model_questions` with `at`, or inspect the
  exact linked records; a current summary is not a historical state. Missing
  coverage remains unknown. State whether uncertainty concerns missing evidence,
  measurement noise, unresolved allocation, an inferred interpretation or a
  hypothetical continuation, in the existing descriptions and records.

The compatibility host has older `abstract_cuts`, `physical_cuts` and Realization
fields alongside `normalized_cuts`; their shared names do not imply shared
semantics. Use `normalized_cuts` for the numerical contract above. Keep legacy
Realization `degree` at `1` for an unweighted link and record the exact grounding
used in the available provenance and linked records; do not treat the legacy
degree as fit. Native `context_roots` and `contains` express Event ancestry;
when roots are declared, every Event's upward paths must agree on its nearest
root. `holder` metadata or a target link alone does not establish that ancestry.
These conventions do not imply that the host enforces every semantic distinction.
See the [engine guide](../rust-engine/README.md#optional-meaning-model-layer) for
the wire fields and *The Meaning Model*, §§2–4, for the underlying contracts.

## Common procedure

The same procedure applies to general modeling, storytelling, human-author
feedback, agent/user memory and ideation. Their authority differs; their
recursive exploration and attributed Understanding Graph do not. For memory,
model the ongoing processes behind useful records within the chosen scope.
For human-author feedback, the human keeps creative decisions and the LLM
supplies feedback unless further work is delegated. See [memory](MEMORY.md) and
[human-author feedback](HUMAN_AUTHOR_FEEDBACK.md).

### 1. Declare purpose and authority

Choose one purpose before modeling:

- **creative fiction:** authored premises may become fictional canon;
- **source reconstruction:** source facts remain authoritative and completion
  remains visibly inferred;
- **self-reflection:** the participant owns corrections and access decisions;
- **observation:** measurements and reports retain their original authority;
- **forecasting:** every prediction is frozen at its evidence cutoff; or
- **counterfactual analysis:** the branch never silently becomes accepted
  history.

These labels set the task's evidence and authority rules, not its industry or
category vocabulary. An application's own goal determines what it models.

Do not mix creative invention with claims about reality without a typed,
versioned boundary.

### 2. Select interval, scope, and resolution

State what interval is being modeled, which part of the world is in scope, what
questions the model should answer, and the coarsest adequate resolution. Start
with a coarse account across the system, then develop its processes. Coarse
resolution does not mean modeling only one outcome or leaving the rest as prose.
Add detail to change an answer, explain a residual, preserve continuity, support
a declared projection, or explore a promising conjectured structure.
Exploratory detail can be developed before its
usefulness is known; keep it provisional and follow what it reveals.

Start macro to micro. Before local detail, assess the enclosing system and the
longer-term developments that could change the interpretation. Choose a broader
time horizon appropriate to the question, identify enduring events and changing
processes, and explain their connections to the focal processes. Record this
assessment in Understanding Nodes with supporting sources, competing hypotheses,
missing evidence and deliberate scope exclusions. A narrow task may stay narrow;
it should not silently imply that the larger context is settled or irrelevant.
Revisit this account when later local findings challenge it.

For general construction, `life_world_model_build` requires this context review
before estimation or writing. The caller completes it within the agreed
delegation. Its structural checks validate the declared references and temporal
anchors, not the adequacy of the explanation. Other core tools remain available
without this construction gate; this review is a workflow responsibility when
using them. See [general modeling](GENERAL_MODELING.md) for the exact fields.

Optional expressiveness is an invariant. A valid run may contain one sampled
or generated process and no semantic, actor, causal-analysis, or writer layer.
Meaning Model records, Decision profiles, graph projections, reader models,
and writer contracts are added only when they serve the declared purpose.
Adding a view or analysis layer must not silently add canonical world state.

Choose the application's own processes and categories, and explore their depth
within the purpose and delegation. Follow the useful history of a person, market,
institution or technology as far as the evidence and inquiry warrant, including
background processes the final work never shows. Person templates, periods,
shocks and wants are available starting points. A browser's task history, a
learner's changing understanding, and a relationship account may adapt or replace
those categories. Every model change returns open questions; use them to discover
promising processes and concepts, without a quota between steps or a requirement
to construct every person's whole life. Structural starters and experimental
Story/Decision models serve different purposes: inspect the latter's authored
numerical meanings and behavioural laws before choosing them. Reading a profile
does not require compiling it or adopting its vocabulary.

Before construction, also review these questions within the agreed delegation;
do not wait for the user to suggest them:

- Which relevant meanings, dispositions, capacities or process changes need an
  **authored numerical scale**, even though no instrument measures them? Define
  the comparison, units, numeric anchors and uncertainty. A judgment about how
  coordinated a process is can be numerical without being a physical measurement.
- Which important concepts need to be **opened** to explain the distinctions or
  behavior in question? Use native concepts and abstract cuts for alternative
  lenses, and deepen a child when its broad label is insufficient. For example,
  flexibility can be opened by functional roles, response characteristics or
  coordination functions. These views may overlap; do not force them into shares
  of a physical total. A concept description in graph metadata is not a native cut.
- Do meanings differ across **dates, actors or contexts**? Preserve the definitions,
  evidence and holder for each comparison. A changed rubric or different source
  genre does not by itself establish conceptual change in the world.

Save concise assessments as Understanding Nodes linked to the actual records.
Explain when existing boundaries are sufficient, evidence is missing or a
dimension is irrelevant. The requirement is to consider useful depth, not to
produce a quota of scores or cuts. Revisit these questions after consequential
findings or revisions. The general builder checks that these considerations and
their references are present; the other core paths receive this guidance but do
not enforce the builder's review schema. Story depth and voice reviews should
apply these questions to the character and author processes they already inspect.

### 3. Identify continuing referents

Create stable identities for the people, groups, places, objects, or other
continuing things that the model must distinguish. Record uncertainty about
identity rather than silently merging or splitting referents.

### 4. Establish accepted event history

Represent what happened as ordered or overlapping event-processes. Preserve
temporal uncertainty, alternative segmentations, source order, and narrative
order where relevant. A possible event remains separate from an accepted one.

### 5. Separate evidence classes

Every material claim must be typed as one of the following, or an explicitly
defined extension:

- observed measurement or collected record;
- participant self-report;
- attributed report from another observer;
- derived statistic;
- AI inference or latent estimate;
- model completion;
- forecast or counterfactual; or
- creative premise.

Keep value or distribution, time, support, uncertainty, evidence cutoff,
holder or viewpoint, provenance, authority, and access scope together.

### 6. Develop the processes across the model

Prioritize developing the model itself. Discover and represent as many distinct
processes that change over time as the user's purpose, scope and available time
allow. Look across the system's actors, relationships, conditions and activities,
then follow discoveries into further processes and connections. A starter or an
answer to the first question is a beginning. Give processes stable identities and
represent their changing states or phases in native model records, with time,
evidence or authored premises, uncertainty and links to related processes. A list
of names or notes about possible modeling does not supply those trajectories.
Refine an existing process when that is more informative than adding another.
Use qualitative phases when numerical values are not justified, and leave unknown
periods unknown. Process count is not a success measure: do not duplicate
processes, invent observations or expand beyond the agreed task merely to add
more. At a useful stopping point, state what is represented and what remains to
develop.

Candidate actor processes may include wants, fears, concern, attachment, beliefs,
strategies, decisions, emotions, relationships, bodily state, and perceived options. These are
revisable hypotheses unless fictional canon or direct report gives them a
different authority.

Use the model to compare explanations, explore possible developments, and
identify what evidence or question would improve the account. Category design
is part of that work: propose new distinctions, combine or replace unhelpful
ones, and compare the resulting accounts against the application's task and
available observations. For narrative construction, test whether the changed
representation produces coherent, distinctive behaviour and whether relevant
numerical changes affect generated developments. Record the reason for a
revision and retain earlier definitions; a finer model is not automatically
a better one. See [application-specific categories](examples/APPLICATION-CATEGORIES.md)
for a small executable revision example.

When representing an actor's perspectives, distinguish these views wherever
they are recorded; do not invent missing views merely to complete a template:

1. **External event model:** what appears to happen to and through the actor.
2. **Candidate actor-local models:** alternative hypotheses about what the
   actor notices, means, wants, fears, believes, and considers possible.
3. **Reported self-model:** how the actor describes themselves.

The operative actor-local model is whatever organization actually conditions
the modeled action. Neither an external estimate nor a self-description is
automatically operative.

### 7. Prefer sampled trajectories before invented laws

If evidence supports values at particular times but not a transition function,
store the values, uncertainty, and interpolation assumptions. Do not invent a
law merely to make the series executable.

Cover the chosen longer-term horizon as well as local changes, at the resolution
the evidence supports. An Event with a long interval represents an extended
episode; its duration does not by itself supply a numerical process trajectory.
An interval is not an uncertainty window for an occurrence's date. If only a
year or month is known, record that period separately and keep the occurrence
undated within it, with its source and known ordering. Coarse containment does
not establish an exact date or make the uncertainty executable by a time query.
Distinguish dated observations, retrospective estimates and forecasts, including
the evidence available for each assessment.

Add a generating function only when the mechanism is authored for a creative
world, supplied by a trusted domain model, or has earned credibility through
held-out prediction, intervention, compression, calibration, and stability.
The MCP estimation exchange supports both data-only provisional claims and a
separate, explicit proposal for a successor model containing new laws.
`life_estimate_cut_shares` can propose normalized Cut weights from situation text
through an optional external estimator, and `life_model_ingest` can create described
events, estimate several Cuts for each, register the revision, rebind a bound graph
and store notes in one call. Such weights are AI inference, carry estimator
provenance, and enter the model only through an explicit `apply`.

### 8. Preserve alternatives and residuals

Maintain competing explanations when the evidence cannot discriminate among
them. Mark unobserved, unknown, and unmodeled separately from zero. Record the
residual left by a decomposition rather than pretending the named children
exhaust the parent.

### 9. Test causal use and conservation

When causal laws or predictions are introduced, change one relevant input while
holding the parent, evidence cutoff, and other conditions fixed. The predicted
downstream state should change for a declared
reason. Change an irrelevant input and require stability. When opening or
closing resolution, require identity, accepted history, authority, viewpoint,
and query-relevant consequences to remain consistent.

When opening existing commitments as a conservative refinement, fix the base
revision, protected coarse answers, their comparison and fine-to-coarse mapping,
with numerical tolerances where applicable. Reconstruct those answers from the
proposed fine records; rereading cached coarse values is not a check. Keep the
comparison fixed while checking that refinement. If it changes, record a new view
or explicit revision and recheck affected records and prose. A new hypothesis or
concept does not by itself require a numerical comparator.

For a time-averaged Cut, disjoint children of a finite bounded parent use duration
shares `lambda_i = child_duration / parent_duration`. Only compatible question,
unit, answer mapping, remainder meaning and perspective may mix. Complete
coverage requires `parent = sum(lambda_i * child_i)` within the fixed tolerance.
For partial coverage, report the known contribution and gap; do not invent its
composition. Against an already committed parent, the residual must be nonnegative
in every component and total the uncovered duration share, or the refinement must
be rejected or the parent explicitly revised. Varying resource totals require
resource-mass weights or another justified operator, not a duration average.
A conditional Cut's full-unit shares are its local shares times the enclosing
answer's weight. Opening a remainder accounts for that same mass. Presence,
identity, overlapping processes and physical parts retain their own checks.

Declare `temporal_cut_recompositions` when using the host's supported duration
mixture checks; mere containment does not request them. The engine checks those
declared arithmetic and structural contracts, not semantic exclusivity or every
protected query. Record any further comparison and its result as attributed
Understanding Nodes. No general automatic Close operation is implied.

### 10. Let the person or author correct the model

An intelligent agent may ask questions where expected information value
justifies the burden, but the interview policy is not hardcoded into the
engine. Corrections append or supersede claims with provenance; they do not
erase the fact that a previous estimate existed.

### 11. Produce a projection, not a total dump

Return the view requested by the user: an event graph, trajectory summary,
character portrait, story diagnosis, writer packet, forecast, counterfactual,
or unresolved-question list. State which facts are hard, which parameters are
soft, which hypotheses compete, and which details remain unmodeled.

For a large causal model, begin with `life_graph_query` in `skeleton` mode.
Open a `neighborhood` around a relevant process or law when more explanation is
needed. A neighborhood is a view over the same snapshot: it includes every
edge crossing its selected core and both endpoints, and it never replaces the
complete graph. The `full` mode remains available when the agent truly needs
the whole factor graph. Bind successive views with `expectedSnapshotHash` so a
world change cannot be mistaken for simple zooming.

When the output itself should remain linked to the model, use the optional
narrative/understanding graph. Begin with a complete node-and-edge transaction
through `life_narrative_register`. Use `life_narrative_batch` to add one or many
connected nodes and edges without resending the graph, or
`life_narrative_revise` when replacement or deletion requires a successor, sent
as its `change` (new or replaced records and removed ids) or as a complete
definition. A one-node batch must connect to an existing node or stable anchor;
only the first declared root may stand alone. This lets the agent plan each
local topology together and lets Rust reject the entire transaction if a node,
edge, scope, order, stable-object anchor, nested path, or connectivity condition
is invalid.
Then use `life_narrative_query` in skeleton or neighborhood mode for ordinary
work and open the full graph only when necessary. The canonical story remains
in graph nodes; `life_narrative_render` is a derived document projection.

### 12. Preserve revision and persistence boundaries

New dimensions or laws require an immutable model revision. A rolled candidate
does not become reality until explicitly accepted. The Rust state-file mode can
persist accepted models, worlds, claims, paths, lineage, and immutable
narrative graphs with their exact source snapshots; control-plane handles are
not all durable across server restart.

Model, world and narrative revisions use separate mutation paths, not one atomic
transaction across all three. Track the exact source versions, recheck affected
dependents, and record any incomplete update rather than assuming co-storage
establishes agreement.

To open compatible detail after accepted history, register a direct-next model
and use `life_world_revise` in `refine` mode against the exact current world hash.
Supply current values for newly introduced processes. If existing commitments
must change, use `revise` instead and state why; the engine retains both heads
in an immutable receipt. Explicit temporal Cut contracts check duration-weighted
recomposition, including whether partial detail can still complete its parent.
These arithmetic checks do not judge narrative plausibility. Histories spanning
world revisions persist in SQLite, but portable project/checkpoint and
accepted-history training exports across those boundaries are not yet supported.

### 13. Record the construction as you go

The model and its Understanding Graph are the modeler's understanding. Give every
Event that carries a Cut a description of what happens in it. Record consequential
choices, ideas, predictions, questions and reasons with `life_understanding_record`, linked to
the records they concern, and outside reviews with `life_review_record` under their
actual reviewers. Batch related durable findings, decisions and open questions;
no separate record is needed for each thought, reading step or reply. Reuse
existing records when they already preserve the reasons needed to continue.

When continuing existing work, reuse reading at the exact known graph head and
inspect subsequent revisions and relevant records. If saved work may have
advanced, establish the intended head and lineage first. For unfamiliar history,
lost context or an ambiguous branch, read `life_construction_replay` from the first
revision and `life_model_outline` before changing anything.

Use controlled read-back for a substantial communication deliverable or a
specific unresolved risk about what an output conveys. Routine dialogue and
memory updates do not alone require independent readers. Where the comparison is
needed, preserve the fixed answer key, separate blind selected/control readers,
actual reviewer records and bounded claims about the results.

## Fear, concern, and operative motivation

Modeling a state is not the same as adopting it. A character's fear, the Reader
Core's evaluation, and an AI system's operative motivation are separate
records. Fear should not be reduced to any prediction that a wanted future may
fail. A useful profile distinguishes:

- the valued future or protected target;
- believed obstruction, likelihood, imminence, and expected loss;
- attachment and perceived control;
- aversive urgency, arousal, and defensive narrowing;
- concern or care that remains action-guiding without self-protective panic;
- the strategies and actions actually selected; and
- whether each represented state causally affected those selections.

This permits an AI to model fear accurately while testing the separate
hypothesis that care, calibrated threat prediction, and proportional urgency
can remain operative without fear governing the policy.

## Safety boundary for person modeling

Personal models are structured, revisable hypotheses. They are not diagnoses,
mind reading, moral rankings, or permission to manipulate. Use explicit
consent, local-first storage where possible, access control, correction,
export, and deletion. A fluent explanation can still be wrong. High-stakes
clinical, legal, employment, credit, insurance, or coercive uses require
separate governance and validated domain practice beyond this protocol.

## MCP tool sequence

The flow is:

0. When continuing existing work, use `sessionMode` `continuation`, then read
   the relevant construction history and outline on the intended graph. Reuse
   retained reading at an exact known head; inspect subsequent revisions and
   relevant records. Replay from the start when history is unfamiliar, context
   is lost or the branch is ambiguous. Record consequential findings or changed
   plans, not a separate reading-plan or compliance note on every continuation.
1. `life_modeling_context` for the purpose's guide and versioned references.
2. Read the protocol, relevant guide or profile, and example, reusing unchanged
   guidance that you retain. Consult a paper
   section when the work needs a fuller explanation; reading is not tracked.
   `life-sim://example/minimal-model-and-graph` holds complete, test-verified
   compile, register and graph payloads.
3. For the supported Story, Person, or Decision conventions, optionally use
   `life_profile_compile` to obtain an ordinary complete model without storing
   it; otherwise author the model directly.
4. `life_model_validate` and `life_model_register` for a complete initial
   model. Profile compilation never performs registration implicitly.
5. `life_world_create` for an isolated world.
6. `life_estimation_request_create` and
   `life_estimation_response_submit` for data or candidate semantic changes.
7. Review explicitly; register any successor model separately.
8. Roll, inspect, compare, and reject or accept complete candidates. To decide a
   continuation from a direction Cut, draw with `life_direction_draw` and a seed
   fixed beforehand; recorded draws make any later draw over the same Cut a
   visible reroll. Link the continuation you build from the Cut's parent Event
   with a `realizes_forecast` event relation naming the Cut and the answer.
9. Optionally use `life_candidate_route` to compare pending alternatives from
   one frozen parent, interval, and dynamics through explicit scalar
   actor/world-state preferences. Its recommendation is advisory and never
   selects an actor action or accepts canon.
10. If story text, character interiors, reader responses, or explicit
    authoring reflections should remain addressable beside semantic state,
    submit one complete graph revision with `life_narrative_register`. Add
    connected material atomically with `life_narrative_batch`, or use a
    complete hash-linked `life_narrative_revise` successor for replacement and
    deletion. Query at the smallest sufficient resolution. Externalized
    reflections are authored testimony, not hidden chain-of-thought.
11. Use `life_narrative_render`, writer contracts, or another authorized
    projection for the final output. A resolution-aware writer contract may
    include a whole-graph skeleton, one active causal neighborhood, its crossing
    boundary, and an exact route back to the full Rust snapshot.
12. Optionally use `life_narrative_training_export` to obtain deterministic
    text--state records from the exact bound snapshot. This exports data; it
    does not train a model.
13. If a reader reports a weakness, use `life_story_revision_diagnose` to test
    the least foundational repair in the order model, cut, trajectory, then
    rendering. It localizes supplied evidence; it does not score literary
    quality.

The server provides representation, validation, execution, and persistence
boundaries. The intelligent agent supplies interpretation and questions, and
must preserve the epistemic distinctions above.
