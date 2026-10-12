# Modeling a person and their voice: start here

These guides help an agent model a real person so that it can write in their voice, from what they have written and
said. Start by settling what is wanted.

## What do you want?

Ask the person you work for, unless your instructions already say. In a run, the instructions fix the mode and the
view, and you do not choose.

1. **A voice model:** how they write, per register and over time, read from their texts.
   [VOICE-MODELING.md](VOICE-MODELING.md) (`life-sim://guide/voice-modeling`)
2. **A person model:** who they are, modeled like a character in a book: their life from its beginning, what drives
   them, what they want and fear, the people around them, their turning points and why those happened.
   [MODELING-A-PERSON.md](MODELING-A-PERSON.md) (`life-sim://guide/modeling-a-person`)

   Ask which way, too: **inferring**, which fills the person to full depth with several guesses held side by side,
   or **known only**, which records only what the material states or directly shows. Inferring is the default:
   filling in the blanks is where a model's value comes from.
3. **Both:** one graph holding the person and their voice, where each change in the voice is explained by something in
   the life. Build the person model first if neither exists; if a voice model exists, add the person to its graph.
4. **Ideas for pieces in their voice:** what they could publish next, why it is theirs, and what it would need. This
   needs a model from 1, 2 or 3. [PIECE-IDEAS.md](PIECE-IDEAS.md) (`life-sim://guide/piece-ideas`)
5. **Forecasting how pieces will be received:** the voice guide's forecasting step (their verdict, then readers'
   response once pieces are published), with the forecasting add-on (`life-sim://addon/forecasting`) when angles
   should be followed as branches.

## One graph, three layers

Everything about one person lives in one graph and one model. A graph holds one memory context, so the voice and the
person share it and are kept apart by naming:

- **Shared evidence**, read by every view: the samples, the dated facts of their life, their moments, the people
  around them, their audiences, and their reach.
- **The voice layer:** processes whose ids begin `voice.`, the series that read them, and notes with the topic
  `voice`.
- **The person layer:** processes whose ids begin `person.`, series whose ids begin `person-`, the causes and lens
  readings about their life, and notes with the topic `person`.
- **Ideas** are notes with the topic `ideas`.

A model built before these guides may lack the prefixes or topics. Then work out which records belong to which layer
from what they read, and record that mapping as a note before using a view.

## Views

A writer can read the voice, the person, or both, as its instructions say:

- **Voice only:** the shared evidence and the voice layer.
- **Person only:** the shared evidence and the person layer.
- **Both:** everything.

For notes, the view is applied mechanically: `life_memory_query` takes a `topic`. For the model's own records, the
view is a reading rule: `life_model_outline` shows everything, so read only the processes, series and causes of your
view (`life_meaning_query` reads named ids). State the view you used at the top of every brief.

## Writing a piece

Writing follows "Write a piece" in [VOICE-MODELING.md](VOICE-MODELING.md) (`life-sim://guide/voice-modeling`): a
brief from the model that cites its records, then the draft from the brief. With the person view, the brief also says
what in the person the piece comes from: the drive, stance or turning point behind it.
