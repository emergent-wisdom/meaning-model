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

Provenance: written by Claude (Opus 5.5) as the calling LLM, under an invented
author persona (Inge Salas), in September 2026.

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
The first two are summaries; the last three are verbatim.

## Files

| File | What it is |
|---|---|
| `story.md` | The story, version 6, exported from the graph render |
| `model.json` | The final story model (revision 9) |
| `graph.json` | The final narrative graph: passages, canon records, reviews, audits, reader reports and deepening records |
| `readers/` | The five blind readers' reports |
| `MANIFEST.json` | SHA-256 digests and source identities |
| `example.test.mjs` | Re-registers the model and graph on a fresh engine and renders the story byte for byte |

## Boundaries

The readers were Claude contexts, independent of the run's context but not of the
model family, and their verdicts are editorial opinions, not publication. The
science is checked but fictional. Self-review and the alignment audits kept the
prose consistent with the story's records. Only blind reading checked the records
against the world, and it found something every time.
