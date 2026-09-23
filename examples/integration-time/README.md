# Integration Time: a story written in the storytelling add-on

*Integration Time* is a 3,606-word hard science-fiction story written entirely
inside the Meaning Model with the storytelling add-on
(`MEANING_MODEL_ADDONS=storytelling`), then revised in five passes, each answering
a blind reader.

A mother has spent eleven years alone at a solar-gravitational-lens station 672 AU
from the Sun, mapping a dark photosynthetic mat on TRAPPIST-1e. Her daughter comes
to automate the station and bring her home. The daughter's new change detector
finds parallel swaths moving across the mat, apparently cut, which eleven years of
integration had averaged into stillness. Every question to Earth takes longer than
one orbit of the planet, and each woman secretly arranges to stay so the other can
go.

## Credits

Written by **Claude Opus 5.5** (Anthropic), at maximum reasoning effort, as the
calling model of the storytelling add-on, in September 2026. **Jev** (jev-1.13.0,
TypeSafe AI) estimated the weights of the direction Cut from which the ending was
drawn, and audited the prose against the story's records in every pass.

No person chose the premise, steered the writing, edited the text or picked the
story for this release. Henrik Westerberg asked for a new science-fiction story
written inside the tool, and for fixes to the problems found while writing it.
The five blind readers were separate Claude contexts. "Inge Salas" is the author
persona the add-on's author model wrote in, not a person.

## How it was written

Everything the story rests on is a record in the tool:

- **The model.** The story world is modeled with its processes, things, events and
  Cuts: light time, orbit, swath rotation, stores, and each woman's attention and
  reliance as attributed Cuts.
- **Lives and the ending.** Both principals' whole-life trajectories were explored
  and assessed. The ending came from a seeded direction draw over a Cut, not
  rerolled: it landed on the remainder, which became the collision of two
  attempted continuations.
- **The prose.** Scenes were drafted, reviewed and committed as independently
  editable passages in the narrative graph.
- **Reviews.** Depth, purpose, voice and alignment-audit reviews are Understanding
  Nodes linked to what they review.

Five deepening passes followed, each bound by `life_story_deepen` to the version it
revised. Each pass revised the model or the canon first where a cause was wrong or
missing, then changed only the passages that needed it, in one atomic edit.

## The construction record

The whole construction is in `history.json`: 11 model revisions and 147 graph
revisions, from the empty story root to this text. Import it on any engine with
`life_construction_import`. The engine rebuilds every revision and checks each hash
against the exported one. Then `life_construction_replay` walks the history one
step at a time: why each step was taken, what each model revision changed, and each
note shown beside the records it concerned, as those records were at that step.

- `REPLAY.md` is the replay at outline level, one entry per step. The reasoning and
  full levels add whole notes, model diffs and prose.
- `OUTLINE.md` is the present state: all 45 Events with their descriptions, the
  Cuts under them, the Things, processes and concepts, and the first line of every
  note linked to each record.

An agent continuing the story should read the replay from the start, then the
outline, and open detail where it needs it.

Some of the record was added after the story was finished. The maintainer (Claude
Opus 5.5, in the session that prepared this release) made these changes through the
same tools, and they appear as the last steps of the replay:

- **Descriptions.** Model revision 10 describes every Event, including the fifteen
  that carry Cuts, so each attention and reliance number says what the woman faces
  that day. No world fact, weight or boundary changed, and the story text is
  unchanged.
- **Reviews.** Each blind reader's report is recorded as a review held by that
  reader. It carries the reader's prompt, the graph revision it read, and a hash of
  the exact text it was given.
- **Links.** Each deepening plan is linked to the review it answered.
- **Open finding.** One note records a finding that no pass has answered yet. The
  second reader found that by the last scene both women speak in the narrator's
  register. The fifth found that they differ more in what they do than in how they
  talk. The note leaves this for a later pass.

## What the blind readers found

Each reader was a fresh context that saw only the finished text, with no model,
notes or earlier reports.

| Version | Verdict | Errors it found that the rest of the workflow missed |
|---|---|---|
| 1 | "Yes, if it is rewritten" | a lentil of sunlight through an open port; the swath arithmetic; a 6.6-day "orbit"; unaccounted passenger rations |
| 2 | "Yes, after one revision pass" | 80 person-days for an eleven-month voyage; full-Moon light too dim for the images without low light; a natural rival (tiger bush) not ruled out |
| 3 | "Buy after a light pass on the last scene" | an unstated torch at 1.2 percent of light speed; wind-driven fir waves as the stronger rival; one window resolving stripes |
| 4 | "Buy after a light rewrite" | cloud checks that dilute rather than erase a swath; a torch lit in view of the port; a bet that is really three-quarter rations |
| 5 | "Yes, with a light revision" | weight and weightlessness with no cause; the ration fraction; a deadline with no reason; a muddled frame test |

Version 6, this text, has not been read blind. The full reports are in `readers/`.
The first two are summaries; the last three are verbatim. In the graph, each report
is a review node (`review.reader.1` to `review.reader.5`) held by its reader.

## Files

| File | What it is |
|---|---|
| `story.md` | The story, version 6, exported from the graph render |
| `history.json` | The whole construction: every model revision and every graph revision as its change |
| `REPLAY.md` | The construction replayed at outline level, one entry per graph revision |
| `OUTLINE.md` | The present model and graph as an outline, with the first line of each linked note |
| `model.json` | The final story model (revision 10) |
| `graph.json` | The final narrative graph (revision 146): passages, canon records, reviews, audits, reader reports, deepening records and notes |
| `readers/` | The five blind readers' reports |
| `MANIFEST.json` | SHA-256 digests and source identities |
| `example.test.mjs` | Imports `history.json` on a fresh engine, checks every hash, renders the story byte for byte, and regenerates `REPLAY.md`, `OUTLINE.md`, `model.json` and `graph.json` from the rebuilt history |

## Boundaries

The readers were Claude contexts, independent of the run's context but not of the
model family, and their verdicts are editorial opinions, not publication. The
science is checked but fictional. Self-review and the alignment audits kept the
prose consistent with the story's records. Only blind reading checked the records
against the world, and it found something every time. The descriptions, review
records and maintainer notes were added after the writing, as described above. They
record what happened; they did not shape the text.
