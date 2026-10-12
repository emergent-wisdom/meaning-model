# Modeling a person

How to model a real person the way the Meaning Model models the characters of its books: a whole life from its
beginning, broken down as the [process breakdown](PROCESS-BREAKDOWN.md) breaks down a principal character. This is
the account from which their words and choices make sense. To model their voice as well, start with
[PERSON-AND-VOICE.md](PERSON-AND-VOICE.md) (`life-sim://guide/person-and-voice`).

## Two ways: inferring or known only

Ask which, unless your instructions say. Inferring is the default: filling in the blanks is where the model's value
comes from.

- **Inferring.** Fill the person to full depth by guessing: read who they are from what they write, what they tell
  about their life, and how they meet setbacks and wins. Wherever the material allows more than one reading of their
  inner life, make several guesses and keep them side by side. Choose one as the working reading, with its
  confidence, and record the others as hypotheses with their own shares, the evidence for and against each, and what
  would tell them apart. A sparse period, such as a childhood they mention in one line, gets readings too, tagged
  `exploring`.
- **Known only.** Record only what the material states or directly shows: their own words about themselves (`source`)
  and what can be counted or observed. Where the material is silent, leave the record open and ask. This is the way
  when others will rely on the model as a record of the person.

In both ways nothing they lived is invented. A guess about what they want or fear is allowed; a moment, quote, result
or relationship they never described is not. Whatever is built on the model keeps a guess labeled as a guess.

## Read first

- **The process breakdown,** Part 3 (a person), Part 4 (the inner life, in numbers) and Part 8 (the minimum):
  `life_modeling_read` with `life-sim://guide/process-breakdown`. When inferring, model the person to the depth
  Part 8 asks of a principal: a model with one or two processes per person is not a model of that person. Known only,
  lay out the same structure and fill what the material shows; the rest stays open.
- **The person profile,** `life-sim://profile/person` ([PERSON_MODELING.md](../profiles/PERSON_MODELING.md)): the
  three views below and the record for each wanted future.
- **The Book of Conditions example,** `life-sim://example/book-of-conditions-modeling`
  ([BOOK-OF-CONDITIONS-MODELING.md](examples/BOOK-OF-CONDITIONS-MODELING.md)): how the IS, WHAT, outlook, HOW and
  FEELS accounts stay distinct, and how a voice depends on the person and the encounter.

## Three views, kept apart

- **What happened:** their life as events and dates, the moments they describe, the people in it, what they did and
  what followed. Only what the material shows.
- **Your hypotheses about their inner life:** what they want, fear, believe and attend to, tagged `inferred` or
  `exploring`, held by you, with competing readings where the material allows more than one.
- **Their own account:** what they say about themselves, tagged `source`. It has authority as their account; it is
  not automatically complete, and a later account can reinterpret an earlier one.

## 1. Set up

- **Purpose.** From their texts alone, use `observation` in `life_modeling_context`. With the person taking part,
  use `person_reflection`.
- **One model, one graph.** Register a model of the person, or continue an existing model of them (import its export
  if needed), and start a memory context with `life_memory_start` (purpose `user_memory`, the person as subject). Its
  graph holds the material, the notes and the readings. A graph holds one memory context; to keep the person's notes
  apart from other notes in it, give them a topic and read them with `life_memory_query` by that topic.
- **The clock.** Decimal calendar years (2026.5 is mid-2026). The life runs from birth to the model's present.
- **After each model revision,** rebind the graph with `life_narrative_rebind` before linking notes to new records.

## 2. Read the material for the person

Read everything for the life:

- every dated fact about their life, and every moment they describe, with when, where and who was there;
- everyone they name, and what each person is to them;
- what they say they want, fear, believe and stand for, in their words;
- how they meet a loss, a win, a no, a delay, an unfair moment;
- what they return to again and again, and what they never mention.

Record the moments as events and the people as referents. Keep their words as the source.

## 3. The person, as the breakdown builds a principal

Follow Part 3 and Part 8 of the process breakdown, carving with its conceptual decomposition algorithm where the
material asks for categories of your own:

- **IS, the slow processes across the whole life:** body, kin, partnership, work, place, means, knowledge, standing
  and meaning (`life_profile_compile` with `person_scaffold` gives their addresses; on an existing model, add them as
  processes), plus speech, each with values across the life.
- **Processes of their own:** at least one, and several for a principal: what belongs only to this person.
- **Periods:** the life cut into stages from birth (childhood, youth, each adult stage) and, finer, the recent periods
  the work is about. Each period is a child event with an interval; where its dates are uncertain, say so.
- **In every period, Cuts over a named pool:**
  - **WHAT:** their wants, as a Cut over the choices of the period by the want each serves. Start from autonomy,
    belonging, competence, understanding and well-being, then carve their own wants.
  - **Outlook:** the share of their active wants they see as assured or threatened.
  - **Threat,** conditioned on the threatened outlook: what is at stake (body and health, home and safety, the people
    they care for, self and meaning, standing and belonging, what they depend on, work and livelihood) and which of
    their own wants is at risk.
  - **HOW:** problem solving over the decisions of the period: framing (abstract or concrete) and deciding
    (impartial or personal).
  - **FEELS:** their waking hours by the feeling that colours them (anger, anticipation, disgust, fear, joy, sadness,
    surprise, neutral).
  - **Body and days:** their condition, and where their waking hours go.
- **Shocks:** each a change arc: anticipation, focal change, adaptation.
- **Turning points:** for each, why it happened rather than its contrast, with weighed causes (`life_cause_record`).
- **Decisions:** in a real life they are not drawn. Record what they chose and the alternatives they faced, as far as
  the material shows them.
- **Relationships:** each person who matters, as a relationship: closeness, trust each way, what flows between them,
  its conflicts.
- **Places** over time.
- **Lenses,** at least two: fear or love, opened into what the fear is of and what the love is for (Part 4), and the
  lenses this person's material suggests (`life_lens_define`, `life_lens_place`).

Record a Cut as a series over the periods (`life_series_plan`, then `life_series_record` with the period as
`parentEventId`; the threat Cut with `conditionedOn` the outlook's threatened answer). Record states and intensities
with `life_values_record`. Give every scale its anchors and every Cut its pool (the number test). Tag every reading,
put its evidence in `why` or `note`, and give its `confidence`. When inferring, record the competing readings as
notes of kind `hypothesis`, each with its shares and evidence, linked to the working reading with `contradicts` or
`refines`. Where the material is silent about a period, keep it coarse and say what would open it.

## 4. The futures they want

For each future they are working toward, record what the person profile suggests: what it is, how much it matters to
them and over what horizon, how attainable they seem to believe it is, the wants that support or conflict with it, the
losses they fear, the strategies they use, and the evidence for and against your reading.

## 5. Their voice

If a model of their voice shares the graph, keep the two apart as [PERSON-AND-VOICE.md](PERSON-AND-VOICE.md)
describes: person processes with ids beginning `person.`, person series beginning `person-`, and person notes with the
topic `person`. For each change in how they write or speak, find what in their life caused it: a cause, or a note on
the voice reading with a `shaped_by` link to the life record. As the Book of Conditions puts it, a voice depends on the
person and the encounter: their knowledge, wants, outlook, relationships and constraints come before any voice
adjective.

## 6. The portrait

Check the account with `life_model_questions` and the coverage it reports. When inferring, continue until no part
of the person is missing. Known only, continue until every part is either recorded from the material or left open
with the question that would open it. Then write a short portrait as a note, the first thing anyone using the model
reads: their life phase by phase, what drives them and what they fear, how they solve problems and meet setbacks,
what they stand for in their words, the strongest evidence for and against your main readings, and the questions you
would ask them.

## What the model is

A revisable account, not a diagnosis, a personality score or a claim to know their inner life. Every guess is labeled,
and no event, quote, result or relationship is invented.

## Notes from a run on 0.10.0

These steps were run once on Meaning Model 0.10.0, on a copy of an existing model of a person:

- A graph holds one memory context; a second context on the same graph is refused. Notes given a topic in the
  existing context are returned on their own by `life_memory_query` with that topic.
- A person process can be added to an existing model with `life_values_record`; rebind, then link notes to it.
- Per-period Cuts work as series with the period as `parentEventId`, including a threat Cut `conditionedOn` the
  outlook. Answer keys are lowercase identifiers (`well_being`, not `well-being`); each reading's shares sum to 1,
  with the remainder named in `series.remainder`.
- `life_series_plan` takes a numeric step in years.
- `life_lens_define` applies a lens to `act`, `period`, `life`, `event` or `inner`; its `why` and `life_lens_place`'s
  `reason` need at least 8 characters.
- `life_cause_record` works on an existing model with an existing outcome event and cause events.
