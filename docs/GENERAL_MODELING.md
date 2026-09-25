# General-purpose world modeling with optional Jev estimation

Use this workflow to build and revise an account of a real or hypothetical system.
Choose the processes that answer the user's question: protocol development,
adoption, institutions, public discussion, markets, a company's operations, or a
physical process. Price is one possible dimension. There is no required crypto,
personality, or storytelling vocabulary.

## Start with the user's question

Use `life_general_modeling_start` or `life_modeling_context` and read the required
resources. Establish the purpose, system boundary, time interval, resolution,
available evidence, and decisions the user wants to retain. The purpose
`observation` keeps each report, estimate and judgment in its own authority and
suits explanatory or retrospective accounts built from records or recalled
knowledge; `forecasting` adds values after the evidence cutoff that later
observations can test; `counterfactual` holds an explicit alternative premise. Reuse instructions
already supplied. A fully delegated run may select and revise its own categories;
it still records its evidence, assumptions, review findings, and uncertainties.

Begin with the enclosing system and its longer history, then work through the
relevant sector to the focal actors and processes. Examine how local developments
can feed back into that broader context. Deepen every level the question's
causality runs through, and keep deepening: an account that answers the first
question is where the modeling starts, not where it ends.
Preserve competing explanations instead of assigning unsupported causal laws.
Connect models through explicit referents and supported relationships; the tool
does not automatically reconcile separately modeled systems.

## Think in the model

The model is where the account is thought, and the forecast or explanation is
a consequence of it. A language model has no sense of time of its own and has
not lived in the system it describes; the model gives it one.

- **Open questions.** Every model registration and revision returns the model's
  own open questions (`openQuestions`); `life_model_questions` returns all of
  them. Examples: a process with nothing longer behind it; a decision nobody
  drew; weights nobody estimated; a series that shifts with nothing modeled to
  cause the shift; Events that instantiate no concept; no regularity linking
  Events that recur. Take them between every step.
- **Standing questions.** Ask them all the time. Is there a macro aspect I must
  model to truly understand what is going on here, a regime change, an
  institution's history, a war decades back? What kinds of reasons lie behind
  what the actors here do, are they primarily out of fear or out of love, and
  what does that fear or love ask of them? What can be richer about this
  process? What is it an instance of? Climb up to the concept or law that
  explains it together with other things, and test what that abstraction
  predicts elsewhere.
- **Background processes.** Model far more than the question shows: the
  surrounding economy, institutions, technology, people and their incentives,
  and long histories run in the model whether or not the answer mentions them.
- **Jumps.** `life_model_questions` also returns where the model changes most:
  the largest shifts, the closest-run decisions and the moments actors read
  most differently. They are where an explanation or a forecast should look.

The model is never finished. There is no depth at which the questions stop.

## Record what you do

The model and its graph are your understanding. A later agent can continue only from
what was recorded, and a thought helps only when it is linked to what it concerns.

- Give every Event that carries a Cut a `description` of what happens in it, and
  describe most other Events. Model writes report `descriptionCoverage`; the ingest
  refuses Cuts on undescribed Events before any estimate.
- Record your choices, ideas, predictions, questions and reasons with
  `life_understanding_record`, linked to the records they concern (`event:`, `cut:`,
  `process:` and the other kinds) or to graph nodes. Batch related notes.
- Record outside reviews with `life_review_record` under their actual reviewer, with
  the revision and text they saw, and link the changes that answer them.
- Put every reason you give the user into the graph before you reply; a later agent
  reads the graph, not your reply.
- When a Cut, concept or opening no longer holds, mark it withdrawn in the next model
  revision (`withdrawn: {reason, superseded_by}`) instead of deleting it. It stays as
  history, the notes about it keep their links, and the outline shows it as withdrawn.
  `life_narrative_rebind` refuses a successor that removes a record notes are anchored
  to, and names them.
- To continue someone's model, start with `sessionMode` `continuation`, read
  `life_construction_replay` from the start at outline level, then
  `life_model_outline`, and open detail where you need it. Record what you read and
  what you plan before your first change.

## Review broader context and longer-term developments

Before construction, the agent completes `scaffold.contextReview` within the
user's existing delegation. If the review is absent, the builder returns
`needs_context_review` before Jev calls or model/graph writes; it is a modeling
task for the agent, not an automatic request for another human approval.

The review names its `holder` and the `focalInterval` (`start`, `end`) in model
time units. It assesses two aspects:

- `broaderContext` names the enclosing `boundary` and explains how it relates to
  the focal processes.
- `longerTerm` declares an `interval`, or `null` if unresolved, and explains the
  developments or trends needed to understand the focal interval.

Each aspect supplies an `assessment`, a `status` of `represented`, `unknown`, or
`out_of_scope`, and lists of `processIds`, `eventIds`, and `sourceIds`. Represented
context requires linked processes and sources. Represented longer-term context
also requires dated events and an interval containing and extending beyond the
focal interval; at least one linked event must extend beyond that focal window.
Unknowns identify missing evidence. Exclusions explain why a narrower account
is adequate for the task, rather than silently leaving context out.

For a crypto inquiry, possible context includes the formation of its underlying
ideas, protocol development, technology adoption, finance and liquidity,
regulation and institutions, and public narratives. These are candidate
dimensions to assess for relevance, not a required vocabulary. There is no fixed
number of processes or universal number of years to cover.

The builder validates references and temporal coverage and stores each aspect as
an attributed Understanding Node. These checks establish that a review was
recorded; they cannot establish causal relevance, historical completeness, or
an adequate explanation. A long event interval is also not a numerical trend.
Where change over time matters, sample defined numerical processes at explicit
time coordinates through the estimation exchange, preserving each evidence
cutoff and distinguishing retrospective inference from historical observations.
Revisit both context assessments when deepening or changing the scope. The
construction gate belongs to this builder; lower-level tools remain unchanged.

## Review numerical meaning and conceptual depth

Do this review automatically within the existing delegation, before selecting
only the quantities that happen to be measurable. The user should not have to
ask for judgment scales or conceptual decomposition. `contextReview` also
contains `authoredJudgments`, `conceptualStructure`, and `conceptVariation`.
If these considerations are absent, the builder returns `needs_modeling_review`
before calling Jev or writing the model or graph.

- **Authored judgments:** consider numerical dimensions for meanings, motives,
  capacities or changes that require interpretation. For example, define how
  broadly a document understands flexibility, or how coordinated a process is.
  Declare the comparison, units, bounds and numeric anchors before estimating.
  Keep the rubric with the process and preserve the supporting evidence and
  uncertainty. A score of 80 does not imply twice as much of a quality as 40
  unless the declared scale supports that interpretation. A category judgment
  with a choice rubric is recorded, but this review needs at least one numeric
  scale (a scalar or distribution process); otherwise mark it `unknown` or
  `out_of_scope` with the reason.
- **Conceptual structure:** decide which important concepts need opening.
  Represent the concepts and abstract cuts themselves, with source provenance;
  a prose note saying "decomposed" is not a native decomposition. Use alternative
  lenses where useful. Flexibility might open into supply, demand, storage,
  network use and coordination; coordination might open again into noticing,
  control and incentives. Overlapping conceptual views are not physical shares
  and need not sum to one. Explain when the present boundary is sufficient.
- **Concept variation:** consider how meanings differ across dates, actors or
  contexts. Link the concepts, dated events and sources used in the comparison.
  Separate a changed process or concept from a revised estimate, rubric, viewpoint
  or source genre. Do not invent an evolution where the evidence supports only
  different framings or leaves the question unresolved.

Each consideration has an attributed assessment and a `represented`, `unknown`
or `out_of_scope` status. Represented claims must refer to actual matching model
records. Unknowns and exclusions need reasons; a narrowly scoped measurement
model can remain narrow. There is no quota of invented numbers, cuts or layers.
These considerations become real Understanding Nodes, and the builder supports
native concepts and abstract cuts so it can ingest the declared opening itself.
Revisit the review when new evidence or a consequential revision challenges it.
Reference validation establishes structure, not the quality of the judgment.

The compact inputs use these fields:

| Input | Fields |
| --- | --- |
| Each new review consideration | `status`, `assessment`; relevant `processIds`, `conceptIds`, `abstractCutIds`, `eventIds`, `sourceIds` (reference lists default to empty) |
| `scaffold.concepts[]` | `id`, `boundary`; optional `label`, `differentia`, `stateSchema`, `directionFamilies`, `observationMethods`, `sourceIds`, `eventIds` |
| `scaffold.abstractCuts[]` | `id`, `parentConceptId`, `childConceptIds`, `lens`; optional `question`, `sourceIds` |
| Supplied authored process value | The ordinary `initial` estimate plus `judgmentQuestion`, using the same typed question contract as `initialEstimate.question` |

Concept and cut IDs name actual native records. Cuts have at least two distinct
children, reference declared concepts, and form an acyclic opening. A represented
structure review references its concepts and any selected cuts; an unopened
concept is allowed with an explanation. A variation review links its compared
meanings to their contextual events and sources. A supplied `judgmentQuestion`
must match the process type and units, and cannot relabel a reported measurement
as an authored score. Initial Jev questions are retained automatically as rubric
metadata in the native process's `scale.authored_judgment_question`.

For an unresolved judgment, the graph retains its definition and rubric but no
numeric placeholder or native process value is created. Review summaries mark
that distinction explicitly; declaring a dimension does not mean it was scored.

## Division of work

The calling LLM chooses and revises the scope, evidence, process definitions,
candidate interpretations, and bounded questions. It writes process descriptions,
Document Nodes, and concise Understanding Nodes containing
interpretations and review reasons. Jev evaluates suitable bounded questions.
Deterministic tool code maps validated answers into typed proposals and graph
records. The LLM need not rewrite every numeric claim or graph edge by hand.

Jev provides Choice, Score, and Noul answers to supplied questions, rather than
inventing an unrestricted ontology or generating explanations. Independent
questions over the same evidence can be batched; dependent questions need later
steps. See the [TypeSafe documentation](https://docs.typesafe.ai/introduction).
External inference is optional and independent of storytelling:

```sh
MEANING_MODEL_ESTIMATOR=typesafe
TYPESAFE_API_KEY=your-key
```

Configure these in the server environment. Do not put keys in model provenance,
graphs, examples, or transcripts. Supplied evidence is sent to the configured
provider when estimation is enabled. With no estimator configured, the workflow
returns bounded tasks for the caller or accepts supplied answers.

## Construction and revision loop

1. **Build a compact scaffold.** Complete the context and conceptual reviews
   above. `life_world_model_build` mechanically constructs
   the initial model, world, and graph from the declared scope, evidence, entities,
   processes, and events. A process can supply a sourced initial value, an explicit
   unknown disposition, or an `initialEstimate` question. Jev evaluates initial
   questions in one batch; inspect the preview and apply its exact `proposalId`
   and `expectedProposalHash`. Apply can name only those identifiers plus
   `requestId` and `apply: true`; the scaffold need not be repeated. No estimator
   runs during apply. `validateOnly: true` runs every structural check first, with
   initial-estimate questions standing in as unknowns, and never calls the
   estimator. Initial values and evidence cutoff use time 0 in the declared time
   basis, so earlier history has negative times (see "Record dated history").
   An initial value with evidence type `observation` or `report` becomes an
   observed claim on an observed process; its `evidence_type` stays `report`, so
   it remains distinguishable from a measurement. File a recollection as `estimate`
   when that is its real strength. Unknown processes remain graph definitions
   with no native process, so they cannot yet hold dated values or be anchor
   targets; link to their definition node instead. At least one supported process
   value is needed to create an executable world. The tool does not invent a zero
   to satisfy this constraint.
2. **Estimate process states.** `life_process_estimate` binds questions to process
   coordinates, evidence cutoff, access scopes, and an exact world/model revision.
   Jev answers are validated and submitted to the existing estimation exchange.
   The provider sees the `context` string, each target process definition, and the
   current state and claims of the requested processes within `accessScopes`. It
   does not see graph evidence nodes or the builder's sources, so put the relevant
   evidence text in `context`. Questions are answered independently: an answer that
   fails validation is declined on its own coordinate (disposed `unknown`, with the
   raw answer kept) and the rest of the batch still counts. Usage is always returned.
3. **Review and record.** `life_process_estimation_record` records the exact
   typed process-value proposal and its review in the graph, with process anchors
   and an Understanding Node containing the review rationale. It records either a
   `life_process_estimate` proposal or a data-only proposal the caller submitted
   through the exchange. Approval records an interpretation; it does not promote an
   estimate into an observation or advance accepted runtime history.
4. **Add events and comparisons.** `life_model_ingest` can add described events,
   declared Cut questions, estimates and Understanding notes to an existing model.
   A preview's proposal ID binds its exact values; apply that ID rather than asking
   the provider to generate a replacement. A direct apply requests a fresh estimate.
   With a graph, the ingest also records each question's answer and remainder
   meanings and the exact situation text judged for each event, so every Cut
   stays traceable to what was asked. Graph anchors cannot yet address a Cut
   itself, so these records name their Cut ids and anchor to the Cut's event.
   Notes may link to each other. A question
   with `conditionedOn: {questionId, answerKey}` divides only the part of the same
   event that another question gave to that answer, for example the conduits of
   the monetary share of a price move. The Cut stores the conditioning, and the
   result warns when that part carries less than 0.05, because such shares then
   describe almost nothing of the whole.
5. **Revise the model and world.** `life_model_revise` registers a complete
   successor. A world adopts it through `life_world_revise` only if no process was
   removed and none changed its value type, axes, unit, reference frame or scale;
   the scale holds the process meaning. The revision result's `worldAdoption` lists
   any such change, and `requireWorldAdoptable: true` refuses the revision before
   it is registered. To correct a mis-defined process, keep its definition, add a
   process with the corrected meaning or unit, and record the supersession in the
   graph. A world revision sets state values but writes no claims: its
   `claimConsistency` names current claims that now disagree with the revised
   state and new processes that have no claim, which you then submit through the
   exchange. Records added by a revision get no builder-style graph node; describe
   them in Understanding Nodes anchored to them.
6. **Inspect and deepen.** Reassess broader context, longer-term developments,
   judgment scales, conceptual openings and variation, and feedback from focal
   processes. Query the graph/model, compare explanations,
   identify missing evidence, revise boundaries or categories, and retain the predecessor.
   Save substantive assessments as Understanding Nodes linked to their subjects.
   Later observations can test forecasts; an internally consistent graph cannot.

Records and assessments belong in the graph. Reading documents and tables are
exports, not parallel sources of modeling truth. A partial multi-step operation
reports completed work and a retry path; do not mistake it for an atomic world update.
Process-local request and proposal handles do not survive an MCP restart; graph
records and engine persistence have their own explicit retention guarantees.

## Record dated history

A long event is not a trend. To keep dated values, file them as claims at their
own times and record them in the graph. With time 0 at the evidence cutoff, a
value twelve months earlier sits at time -12 in a monthly model.

1. Create a request with `life_estimation_request_create`: `operation: "infer"`,
   `intent: "reality"`, `evidenceCutoff: 0`, and one coordinate per dated value,
   for example `{ id: "rate.m12", processId: "rate", targetTime: -12 }`.
2. Submit the values with `life_estimation_response_submit`. Dispose every
   coordinate as `known`, `unknown` or `unmodeled`, and give each known one a claim
   with exactly these fields:

   ```json
   { "coordinateId": "rate.m12", "outputMode": "observed", "valueTime": -12,
     "claim": { "id": "hist.rate.m12", "subject": "rate", "value": { "kind": "scalar", "value": 4.5 },
       "uncertainty": { "kind": "exact" }, "evidence_type": "report", "holder": "modeler",
       "evidence_cutoff": -12, "provenance": ["recalled FOMC statement"],
       "authority": { "source": "modeler", "weight": 1 }, "access_scopes": ["market"] } }
   ```

   `observed` output needs an observed process, `observation` or `report`
   evidence, and `evidence_cutoff` equal to `valueTime`. A process is observed
   when its initial value was an observation or report, or when the scaffold
   declares `updateMode: "observed"`, the right choice for a measured series whose
   starting value is only an estimate. An existing model can be revised to set a
   process's `update_mode` to `observed`, and a world can adopt that revision. A retrospective estimate
   of a past value uses `outputMode: "estimated"`, `evidence_type: "estimate"`, the
   cutoff of the knowledge it rests on (0 for present recollection), and an honest
   `uncertainty` such as `{ "kind": "interval", "lower": 90000, "upper": 97000 }`.
   `valueTime` and the claim's `subject` must match the coordinate. The claim takes
   no `value_time` or `mode` field.
3. Review the proposal and record it with `life_process_estimation_record`. Each
   value becomes a graph node anchored to its process at its value time, keeping
   its holder, evidence type, cutoff and uncertainty, beside an Understanding Node
   with the review.

Proposals and requests are process-local, so record them in the same server
session. The graph copy is durable.

## Rejected answers

If initial provider answers fail validation, the builder returns `status:
"rejected"` with the original questions, answers, evidence context, provider
usage and validation error. It creates no applicable proposal or model/graph/world.
An identical request with the same `requestId` in that server session returns the
cached diagnostic; it does not call Jev again. Inspect the mismatch before changing
the question or validation policy. A new request ID can incur a new provider call
and is not a way to erase the previous rejection. Transport failures with an
uncertain outcome remain separate from an explicitly received rejected answer.

## Numerical meaning and authority

Keep reported prices, energy, counts, rates and volumes in their declared units.
Jev's probability of a category is not a measured share of a physical quantity.
A rubric score requires explicit numeric anchors and its interpretation; retain
the distribution and confidence with the derived estimate. A Score answer becomes
the mean of Jev's distribution over the declared level values, stored with its
standard deviation as the claim's uncertainty. For an ordinal rubric, where +2 is
not twice +1, set `summary: "median"` to store the median level with its
interquartile levels instead. The raw answer's `score` is on the level-index scale
(0 to n-1), not the declared scale. Jev reports probabilities to two decimals, so
its score may differ slightly from their expectation; that rounding is accepted.
The builder preview shows each answer's probabilities and confidence before apply.
Use a normalized Cut only for an explicitly declared comparison/partition, with a
remainder.

### What Jev's weights are, and are not

Fresh agents using the tool without coaching (2026-09-23) found these patterns;
plan for them before you rely on an estimate:

- The weights are not calibrated. Asked which cause is the main driver, Jev often
  puts 0.95 or more on one answer even when the text holds evidence against it.
  Ask for each cause's share of a change instead, keep your own distribution beside
  Jev's under your own holder (`suppliedBy` on a supplied distribution), and record
  which one the model uses.
- Answers follow the supplied text and Jev's prior knowledge. Removing the key
  evidence can leave an answer unchanged. A sensitivity test shows which: ask again
  unchanged, add an irrelevant sentence, then remove or reverse one piece of
  evidence. A situation text you wrote carries your framing; a text written by a
  separate context gives a second perspective.
- A dated estimate sees the current value of the same quantity and can anchor on
  it. Where the present would dominate, ask for timing as a choice between periods.
- Each question is answered on its own; there is no joint consistency check.
  Compare related answers yourself.
- `usage` belongs to the estimate. An apply that adopts a saved `proposalId`
  repeats the preview's usage without calling Jev again;
  `estimatorCallsThisRequest` says how many calls the request itself made.

Distinguish observations, reports, estimates, beliefs, forecasts, counterfactuals
and fictional premises. Missing evidence means unknown or unmodeled, not zero.
Public statements can support an attributed account of a person's stated views;
they do not reveal that person's private reasoning. Review contradictory evidence
and source selection as well as the numbers.

Current process estimation stores reviewable numerical claims and durable graph
records. It does not synthesize transition laws, forecast accurately by virtue of
being structured, or automatically inject inferred claims into accepted runtime
state. Runtime observations continue through the existing candidate and acceptance
path. The compact builder covers a useful subset of the core; lower-level tools
remain available for richer representations.

Conflict checks preserve accepted claims visible to the estimation request or
the public head projection. They cannot establish the absence of conflicts with
claims hidden by narrower access scopes. Missing access is not evidence of agreement.

## Evaluate the workflow

Report the scope and source selection, estimator model, question count, calls,
latency, provider-reported token usage, rejected answers, revisions, and retained
artifacts. Compare equivalent outputs and include LLM setup/review work before
claiming an end-to-end cost or speed improvement. One successful run establishes
an integration example, not general modeling accuracy, calibration, or a speedup.

Automatic storytelling uses the same core plus the opt-in storytelling add-on.
It adds author/character models, life trends, numerical exploration, voice and
depth reviews, passage editing, and graph-backed prose. General modeling imposes
none of those literary requirements.
