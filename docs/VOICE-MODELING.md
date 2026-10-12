# Modeling a voice

These instructions are for an agent that models how someone writes or speaks, so that it can write new pieces that
read as theirs, use their corrections the next time, and show where each choice came from. They work for any voice:
a founder's posts, an author's essays, a support team's replies, talks recorded as transcripts, an organization's
voice across its channels. A fictional character's voice is modeled in the storytelling add-on instead, where speech
is a process in the story's own time (see [the storytelling add-on](../profiles/STORYTELLING_ADDON.md)). It is one of a
set: start with [PERSON-AND-VOICE.md](PERSON-AND-VOICE.md) (`life-sim://guide/person-and-voice`), which also covers
the person model, ideas, and reading the voice and the person apart.

The model is an account of the voice, built from evidence and checked with the person. It is not a claim to capture
the person, and it never makes up what they lived.

## How to use these instructions

The tool serves this guide as `life-sim://guide/voice-modeling`, and the set starts at
`life-sim://guide/person-and-voice`: an agent reads them with `life_modeling_read`. Server instructions are long and
some clients cut them short, so name the guide in the request, for example "read life-sim://guide/person-and-voice
and model this voice".

## What a voice model holds

**The voice as processes.** A voice changes: between registers (a LinkedIn post and a newsletter, a reply to an
angry customer and to a curious one), with the audience, and over the years. So each part of it is followed as a
process per register, with readings at the times the samples show, rather than written down once as a fixed
description. Where you know why it changed (a new role, a new audience, a piece of feedback), record the cause.

**What writing in their voice also needs:**

- what each piece is for: the register's audience, and what they should think or do afterwards;
- what they lived and can draw on: the moments they are willing to talk about, as events with when, what happened
  and who was there, so that only experiences that happened are used;
- what they stand for, in their words;
- what they never do;
- what they like and dislike in others' writing, each with their reason;
- every correction they make, kept in order.

**Three views, kept apart:**

- what the samples show: your readings of their texts, tagged `inferred` and linked to the samples;
- their own account of their voice: what they say about it, tagged `source`, with the conversation it came from;
- your hypotheses: tagged `inferred` or `exploring` and held by you until they confirm or reject them.

Their account has authority as their account; it is not automatically a complete description, and a sample can show
a habit they did not mention. Your reading is an estimate, not access to how they think.

## 1. Set up

- **Consent.** For a real person, agree on the material, its purpose, where it is stored and who will see the model
  and the pieces. Nothing is published in their name without their approval of that piece.
- **Scope.** Whose voice; which registers; which audiences; which kinds of piece; which period.
- **Purpose.** With the person taking part, use `person_reflection` in `life_modeling_context`: the categories come
  from them and their history is never invented. From their texts alone, without them, use `observation`: every
  reading comes from the evidence and is tagged as observed or inferred.
- **The clock.** Decimal calendar years (2026.5 is mid-2026) for every sample, reading and event.
- **One model, one graph.** Register a model with the person and their life, then start a memory context with
  `life_memory_start` (purpose `user_memory`, the person as subject, and the model's hash). The context's graph
  holds the samples, the conversation, the notes and the corrections. A voice model alone keeps their life coarse
  and says so; the person model ([MODELING-A-PERSON.md](MODELING-A-PERSON.md)) builds the life to the depth the
  process breakdown asks of a principal.
- **Names for the voice layer.** Give voice processes ids beginning `voice.`, voice series ids beginning `voice-`,
  and voice notes the topic `voice`, so that a writer can read the voice apart from the person
  ([PERSON-AND-VOICE.md](PERSON-AND-VOICE.md)).

## 2. Collect the samples, with authorship

Import each sample with `life_document_import` under the memory context's root (`contextRootId`). Its text is kept
byte for byte as source material, not as an accepted fact. Record for each sample:

- its date, register and intended audience, and whether it worked, if known;
- **who wrote it:** the person alone; the person, edited by someone else; drafted by an agent or another AI tool and
  edited by the person; or unknown.

Authorship decides what a sample is evidence of. A voice read from agent-drafted or heavily edited texts is partly
someone else's voice. Such a sample still shows what the person was willing to put their name to. Ask about it
rather than guess.

Gather several registers and several years if they exist; the pieces they consider their best and their worst; and
a few texts by others that they like and dislike, with one sentence on why. Some people describe how they wish they
wrote rather than how they write. Record both, labeled, and ask which the pieces should follow.

## 3. Read the samples

Read in three passes.

1. **First impression.** The three to five things that make these texts recognizably theirs, recorded as your
   hypotheses.
2. **Count what can be counted.** Each count needs a pool that can be counted: sentences, paragraphs, posts, words,
   replies. For example: mean sentence length and its spread; the share of short sentences; questions and
   exclamations per piece; "I" against "we"; direct address to the reader; contractions; emoji and hashtags; how
   pieces open and close, counted over pieces; recurring words and phrases. Record a number with a unit, at the
   sample's time, with `life_values_record`, and a share over the pieces of a period with `life_series_record`.
   Counts belong to one language: sentence length and word lists differ between languages, so follow a bilingual
   voice in each language separately.
3. **Read the qualities.** Tone and warmth, confidence and hedging, humor, the relationship with the reader,
   signature moves, what they leave out. Where a quality has no countable pool, use states, or a scale anchored at
   several points with examples from their own texts ("as she talks to her team", "as she writes to a customer",
   "as in an investor memo"), never one anchored only at its ends.

Note what is absent: things they never do are as distinctive as what they do. Note signs of AI-written text in the
samples too; they may show which samples were drafted by a tool.

## 4. Ask the person

Start with their categories: what they think makes their writing theirs, in their own words. Then ask as the person
profile describes (`life-sim://profile/person`): you decide what to ask, one question at a time, and prefer questions
that tell live alternatives apart. Put your hypotheses to them with the passage that suggested each ("most of your
posts open with a moment from your day; is that you, or an editor?").

Record the conversation with `life_memory_transcript_configure` and `life_memory_transcript_capture`, so their own
words are the source. Record what they confirm as their report (kind `report`, held by them, with the conversation
message as its source). Mark a hypothesis they reject as invalidated, or drop it.

Carve what their voice is made of with the process breakdown's conceptual decomposition algorithm
(`life-sim://guide/process-breakdown`), from their texts and their own categories, not from a fixed list of
dimensions.

## 5. Build the account

- **The person** and their life: the periods and turning points they talk about, with the dates they give. For the
  person in full, see [MODELING-A-PERSON.md](MODELING-A-PERSON.md).
- **Their moments** as events: what happened, when, who was there. Keep private what they say is private.
- **The audiences** and, for each register, what a piece should make that audience think or do.
- **The voice processes:** each part of the voice they recognize, per register, with readings over time.
- **What they stand for,** in their words.
- **What they never do,** and the signs of AI-written text to avoid, built for each language from their own dislikes
  and samples.

After a model revision (values, series or any other change), rebind the graph to the new model with
`life_narrative_rebind`, then link each reading to the samples it came from: a note (`life_memory_record`, kind
`interpretation`) about the reading's event or process, with a `learned_from` link to the sample. A series reading
becomes an event inside the person's life, so their life event must cover the times of the readings.

## 6. Write a piece

1. **Read the model for this piece.** Query it (`life_memory_query`, `life_model_questions` with the person in focus
   and the present as `at`, `life_model_outline`) and write a short brief: the register; the audience and what they
   should do; the voice readings for this register now, with numbers where recorded; the moments and facts that may
   be used; what to avoid; open questions. Cite the records each line comes from. No tool writes this brief; you
   write it from the model's answers. Save it as a note linked to the task.
2. **Draft from the brief.** Use only moments and facts the model holds. If a piece needs one that is not there, ask
   the person rather than invent it.
3. **Check the draft** against the brief: the counts within the register's recorded range, nothing they never do,
   no claim the model does not hold.
4. **Record what was used:** the brief, the queries behind it and the draft, so it is visible what was retrieved and
   how it shaped the piece.

## 7. Learn from feedback

- Record their feedback as their report, with its source, linked to the piece and the brief.
- A correction of an earlier account supersedes it (`supersedes`, held by the same holder). A real change of
  preference is a new account at its own time, not a correction of the old one. Someone else's disagreement is
  `contradicts` or `refines`.
- A corrected source does not update what was built on it. Review the readings, notes and briefs that depend on it,
  and revise them or mark them unresolved.
- A piece they approved becomes a sample too, with its authorship: drafted by an agent, approved (or edited) by them.
- The next brief starts from the corrected account; check that they do not have to repeat the correction.

## 8. Judge it against working without it

To know whether the model helps, compare it with the same agent working from the same information without the model:
the same material, goals and feedback, given as an ordinary brief or a written voice profile. The person judges the
pieces unlabeled and in mixed order. Record the time and hands-on work for both, building the model included, and
record their judgments with `life_review_record`, held by them. Credit what the model supplies (material, memory,
corrections that stick), not only how often it wins.

## 9. Forecast, then check

Forecasts test the model where it matters: does it know how the person and their readers will respond?

- **The person's judgment.** Before they judge a piece, forecast their verdict: which of two versions they will
  prefer, or whether they will approve it unchanged, as probabilities over the outcomes. Their judgment settles it,
  so these forecasts can be scored from the first piece on, and over many pieces the scores show how well the model
  knows their taste and where it misreads them. Keep the forecasts from the person until they have judged.
- **The readers' response.** Once pieces are published, forecast what each audience does within a stated window
  (replies from founders within a week, a meeting request within two weeks), from what the model holds about earlier
  pieces. Settle it with what was observed, and score it beside a simple baseline such as their usual rate.
- **Alternatives.** Where a piece could take different angles, reason through each one's consequences before
  choosing: who it reaches, what they would do, how it fits what the person is building over the coming months. Only
  the chosen angle is ever observed; the others stay hypothetical.

Follow the model's forecasting practice (read it with `life_modeling_context`, your purpose and
`modes: ["forecasting"]`): record each forecast as its own record before the outcome, with when it was made, the
evidence it used and what will settle it; never revise an issued forecast, but issue a new one beside it; link the
outcome when it arrives, and score each forecast as issued.

## 10. Share and continue

`life_construction_export` writes the whole construction, with every sample, note, reading and correction, to one
file. `life_construction_import` loads it into another store, where another agent continues from the same head. Each
update is a new export.

## Boundaries

- The model is revisable, and it is not a diagnosis or a personality score. The person can reject, rename, correct,
  restrict, export or delete any part of it, and the history of those changes is kept.
- Imitating a real person's voice needs their consent. A piece goes out in their name only with their approval.
- Never invent experiences, quotes, results, customers or endorsements.

## Notes from a run on 0.10.0

These steps were run once on Meaning Model 0.10.0 with an invented person:

- Series ids take lowercase letters, digits, `-` and `_` only.
- A series reading becomes an event inside the subject's life; the life event must cover its times.
- After `life_values_record` or `life_series_record`, rebind the graph before linking notes to the new records.
- A report needs its actual source (`source.citation`).
- `supersedes` replaces only an account by the same holder; `life_memory_query` then returns the correction.
- An export imported into a fresh store arrives at the same head, verified.
