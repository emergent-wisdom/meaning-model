# Forecasting mode (optional add-on)

Forecasting is a mode you can pull into whatever you build: a world history, a market, a person's life, a story, a
voice, a memory of a user. Whatever the work, its model can say what should happen next, and saying it before it
happens is how the model is tested. Ask for it with `life_modeling_context` and `modes: ["forecasting"]` beside your
purpose; the result's `method.forecasting` says what forecasting means in that purpose.

Enable the add-on with `MEANING_MODEL_ADDONS=forecasting` (comma-separated with other add-ons) for branches: sibling
continuations of the model under each answer of a forecast, each option of a decision, several assumptions, or a change
to the past, which you can move between quickly and compare. Forecasts themselves need no add-on.

This is a first part of what the Life Simulation paper describes in "Simulating implementation and following its
effects" and "Perspective-limited rehearsal", sections of its revision of October 25, 2026, which is the companion copy
this server serves (`life-sim://theory/life-simulation`). Nothing here learns or runs
dynamics: you continue each branch with the
ordinary tools, and the add-on keeps branches apart, records what each assumes and with what probability, asks what
each premise may change, and sets siblings side by side.

## Forecasts

A forecast is its own dated record, issued before the outcome under the forecaster's perspective: a forecast Event
under an understanding root (or a person's inner root), with a Cut whose answers are the outcomes, a remainder for what
they leave unnamed, and weights declared as probabilities before the outcome. Its provenance gives the evidence cutoff,
the horizon and what will settle it. Section 6 of `life-sim://example/minimal-model-and-graph` shows the records.

Predictions in the graph stay as they are. A `prediction` note (`life_understanding_record`), about the records it
concerns, is the quickest way to say what you expect, in your own words and without probabilities; judge it later
with a `validates` or `invalidates` link. Nothing converts or replaces these notes. When you can name the outcomes and
weigh them, issue a forecast Event and Cut as well; a note can point at it (`about` `cut:<id>`).

A rough forecast is still a forecast: issue it when you have it, and a better one beside it when you know more.
Declare its weights as probabilities with a provenance line beginning `forecast:`, in the documented words
(`forecast: probabilities declared before the outcome`) or your own; only a line that denies it ("not probabilities",
"shares rather than probabilities") is no declaration. Give the evidence cutoff and the horizon in model time
(`evidence cutoff: 2025.9 (October 2025)`, `horizon: 2032`): each is one complete number, optionally followed by a
parenthesized date, or the only number in prose (`hour 7`). Signed decimals and scientific notation are accepted;
ambiguous or malformed numbers leave the window unstated. The forecast's window runs from that cutoff to that horizon. `settled by: ...` says what will
settle it; scoring needs it, branching does not.

To freeze the exact meaning of its probabilities, add one provenance entry beginning `meaning-model-forecast/v1 `,
followed by JSON with `probabilities: true`, `cutoff`, `window: {start, end}`, `question`, `unit`, the Cut's exact
`answers`, and `settledBy`. The question, unit and answers are copied from the issued Cut; later changes to them do
not transfer its probabilities to another outcome.

A branch carries the forecast's probability for the cutoff and window the forecast was issued for. Without a stated
cutoff and horizon, it carries the probabilities as guesses for the window you give when forking, marked
`windowStated: false` wherever the probability is shown; a joint probability that multiplies one is marked
`jointIncludesGuess`. For another cutoff or window, or where the weights are not declared as probabilities, the
branches still fork, without probabilities or unnamed probability mass, and say why, so you can issue the forecast that
is missing. A changed window also leaves out the original answer's realization: the branch explores an assumption
about that other window. To explore a timing within the issued answer, keep its window and add a narrowing.

- Never revise an issued forecast. When the evidence changes, issue a new one beside it, in the same words and unit.
- When the outcome comes, record it as an accepted-world Event and link it from each forecast it settles with
  `realizes_forecast`. Score each forecast as it was issued, beside a baseline scored the same way (uniform, a base
  rate, persistence, or a forecast made directly from the same history without the model).
- A forecast issued from a model that already holds records dated after its cutoff is hindsight, not a prediction.
  Building a model of the past with what you know now and then forecasting that past is a backtest, never a score.
- A record kept in the same local store cannot show it was written before the outcome. Until forecasts carry an outside
  timestamp, they are practice.

## Branches

`life_future_fork` forks one **stage**: a set of sibling branches from one trunk revision and one information cutoff.
Each branch is a model revision with the premise in its accepted world, plus its own narrative graph for the reasoning
you do in it. Every sibling is validated before any is written. The horizon reaches at least the end of every premise,
narrowing, decision time and forecast window; the result says when it was extended.

Kinds of stage:

- **forecast**: the answers of a forecast Cut in the trunk. Each premise spans the forecast's whole window, because
  that is what was forecast: "a pandemic starts by 2032, 0.30" is not "a pandemic starts in 2029 to 2031, 0.30". A
  narrower timing or severity goes in `narrowings`, which are recorded inside the premise without probability. A
  timing given as the premise's interval is kept the same way when it starts inside the window, and the premise
  continues as far as it runs. A timing that starts outside the window is not what was forecast: that branch assumes it
  as given, without the answer's realization or probability. A window includes its start and excludes its end; a
  zero-duration window names its exact instant. You may follow a single answer. The remainder is never
  branched; it and any answer you do not branch stay unmodeled mass. A forecast already settled in the trunk is
  scored, not branched.
- **decision**: the options of a choice, with waiting or doing nothing among them (`baseline: true`) unless
  `noBaseline` says why that is not meaningful; without either, the options still fork, and each is asked what doing
  nothing would give. A waiting option says what it waits to learn and until when. Options carry no probability. One
  course followed alone is an assumption.
- **assumption**: one or more premises about the future with no forecast behind them, and no probability.
- **counterfactual**: a change to the past, before the cutoff. The trunk keeps the actual history beside it. It is
  never scored, because what did not happen cannot be observed.

A stage inside a branch forks from that branch's head. Its probabilities are conditional on the branch; the joint
probability multiplies along the branches and is unknown once one of them is a decision or an assumption. A forecast
issued before the outer branch forked does not condition on its premise, and the result says that the joint probability
then assumes the two are independent.

### Working in a branch

Continue a branch with the ordinary tools from its own `modelHash`: `life_model_revise`, `life_values_record`,
`life_series_record`, `life_cause_record`. Link each consequence to the premise or to what follows from it with causal
relations, so its path can be traced. Rebind the branch's graph to the new head with `life_narrative_rebind`, and record
your reasoning in that graph with `life_understanding_record`.

`life_future_load` returns a bounded digest for switching between branches: the premise and narrowings, the
probability, what the branch added to the trunk, its values after the premise, people's states, and its open
consequence questions:

- consequences added with no causal path from the premise;
- earlier Events like the premise (sharing a process it moves, or linked from it with `about`) and what drove them by
  the model's own weighed causes: does each driver hold in this branch?
- the model's most connected processes that this branch has not followed past its premise;
- what sibling branches follow that this one does not;
- the stretch between what is modeled and the horizon, including effects that arrive late;
- for a change to the past, actual history after the change that the branch still carries;
- for a waiting option, what waiting would let you learn.

Close a question by modeling it, or by a note in the branch's graph saying why it is sufficient here
(`life_understanding_record` with data `{schema: "meaning-model-sufficient/v1", kind, reason}` about the records the
question names).

Native values retain their holder and uncertainty bands. Series made with `life_series_record` appear separately as
dated Cut readings, with their shares, subject, perspective, question, unit, answers and conditioning. Readings across
branches are compared as one series when they share subject, question, unit, answer keys and references, perspective
and conditioning. Rewording an answer or a conditioning ancestor stays comparable but is flagged; each reading keeps
its own words and its full chain of conditioning meanings. Different references to Events, Things or processes stay
separate, even when their keys match. A person's conflicting accounts stay separate; the latest account from one holder is not silently selected
as their state. All digests, comparisons and their questions honor the reader's access scopes, while the full
original model remains in each branch.

Develop every sibling as far as the others. A branch that is easy to imagine is not more likely for it.

### Comparing

`life_future_compare` sets the branches of a stage side by side: probabilities and unnamed mass, trajectories after the
fork for each process, each person's state in each branch, the Events each branch added, processes followed in some
branches and not others, and siblings left thin. It computes no total. Who gains and who bears the costs stays visible
for each person; an expected value of a declared quantity may be reported beside those rows, never instead of them. A
judgment between branches is yours to record, with the records it rests on. When one option comes out ahead under every
answer of a forecast, the choice does not depend on the forecast; when the better option changes with the answer, the
observation that settles the forecast is worth waiting for.

The comparison includes both native trajectories and Cut series, and names questions followed in one sibling but
not another. Truncated readings say how many remain; a missing reading is not a prediction of no change.

### Branches stay hypothetical

Everything in a branch is assumed or simulated from its premise. The premise and its narrowings carry the mark
`meaning-model-branch-premise/v1`, and the fork revision carries `meaning-model-branch/v1` with what the branch assumes.
A live view of the trunk never follows into a branch, and a graph on the trunk is not rebound into one. Never copy a
branch's records into the trunk as what happened: when a premise does happen, record the observation in the trunk and
compare it with what the branch predicted.

## Not built yet

Recording a branch's assessment (per-person costs and benefits, reversibility, overrides, a recommendation to act, ask,
wait or decline), signposts that tell branches apart before their horizon, issuing and scoring forecasts with dedicated
tools, settling or adopting a branch, rehearsing a decision with each counterpart answering from its own knowledge in
its own invocation, rebasing a branch onto a newer trunk, and ensembles of runs.
