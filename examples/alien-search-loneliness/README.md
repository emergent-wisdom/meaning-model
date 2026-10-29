# A search through modelled worlds: urban loneliness

This records one search with the alien add-on of Meaning Model 0.16.0. Its code is identical to the
released 0.16.0: the `mcp-server/src` tree is `643bdeb9e261`. The paper's section "Mechanism search through invented
worlds" cites it.

The problem: *How do we end loneliness in a big city where nobody has time, people move every few years, and talking
to strangers feels unsafe?*

## What ran

- **Ten invented worlds,** imported from an earlier search with the add-on's world library. Their builders never saw
  the problem.
- **World modelling, on:**
  - a modeller wrote each world's laws as processes and laws, and the server ran the model;
  - a solver set the problem inside the world, with one measure fixed before any run, and proposed up to three
    interventions made of named parts;
  - the server ran the scenario, each intervention, and each intervention without each part, five draws each.
- **Then the original method:**
  - a solver read the runs;
  - a compiler turned each solution into a mechanism, with the map of mechanisms found so far in view (condition H);
  - curators placed each mechanism in the ontologies;
  - each mechanism was transferred onto a model of loneliness in our world and checked with PURE.
- **Every role** ran on Claude Opus 5.5 at high effort, each in a fresh context with no tools, with the grammar
  supplied. Each role's system prompt had one added line: "You can do this well. Take the time it needs, and say
  plainly where something does not work."

## What it found

| | |
|---|---|
| Worlds modelled and run | 10 of 10. Model and frame refusals: 2 |
| Runs | 115, five draws each. Every run replays exactly from the graph. |
| How varied the ideas are (mean successive distance, each text cut to 20 content words) | 0.64, against 0.38 for ten direct answers from the same model |
| Blind jury against direct answers (Claude models; scale 1–7) | Original 4.6 against 2.5. Likely to work 3.7 against 4.1. No unneeded parts 2.3 against 5.4. Funding picks: 27 of 30 to world ideas. |
| Blind jury against the same ten worlds' ideas when the worlds were only written | Likely to work 4.3 against 3.1, higher in 8 of 10 worlds (paired Wilcoxon p = 0.016). Original 3.9 against 4.7. |
| PURE after transfer | No idea verified on all four axes. Parsimony was falsified for all ten. |

The written-only comparison comes from an earlier search on an earlier tool version. That search had no added line in
the system prompt. So the comparison shows a difference, not its cause; a search with world modelling switched off on
0.16.0 would separate the two.

**An example from the record.** In the geyser world, the obvious remedy was wider channels, so that residents reach
out more often. It met almost no reach-outs (0.01), because in that world a wide channel leaks instead of erupting.
Gathering at the great vent's surge, with a relay to neighbours already close to erupting, met 0.93. Without the
relay it met 0.52, and the compiler kept the relay.

## Files

- `atlas.md` — every world, summaries of its model, scenarios and runs, solver excerpts,
  mechanisms, curation, transfers and PURE checks. Solver excerpts are abbreviated.
- `diagnosis.json`, `diagnosis-refine.json` — the add-on's diagnosis after the worlds and after the transfers.
- `results/sameness.json`, `results/sameness-against-written-worlds.json`, `results/piles.json` — the variety
  measure, after Wenger and Kenett (2026), with the texts it compared.
- `results/jury-against-direct-answers/`, `results/jury-against-written-worlds/` — the blind jury.
  - Each idea was rewritten into one plain format: `formatted.json`. The sources are in `key.json`.
  - Five perspectives on two Claude models rated every idea on one axis per call: `judgments.jsonl`.
  - The statistics are in `quality.json`.
- `results/replay-check.json` — the results of replaying every run offline under its recorded seeds, with every draw matched.

The executable construction graph, model definitions, run plans and seeds are not included. These files document
the search and its replay results; they do not let a reader independently rerun the models.

## Limits

- One problem and one search.
- The judges are Claude models rating Claude text, with no human expert.
- Nothing checks that a world's model is faithful to its text.
- A run shows what follows from a world's laws as modelled, not what works in a city.
