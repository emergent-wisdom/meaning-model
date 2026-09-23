# Mechanism search through invented worlds: retirement without steady income

The first live search run with the alien add-on (`MEANING_MODEL_ADDONS=alien`), on
the problem studied in *Ontology of the Alien*:

> How do we build a retirement system for people who don't know how much they will
> earn next month, where 'consistency' is impossible?

Four worlds were built target-blind, solved inside, compiled back into the
problem's domain and curated. One direct proposal was added, and three mechanisms
were transferred onto a small target model. The search is an ideation record. Its
worlds are textual thought experiments and its transfers are ideas with their
mappings, not evidence that any design works.

## Files

| File | What it is |
|---|---|
| `atlas.md` | The whole search as rendered by `life_alien_atlas`: problem, the three ontologies, worlds, solves, mechanisms, transfers, the commission and the selection |
| `world-library.json` | The four target-blind worlds as a content-addressed world library, with seeds, builder isolation, regime classification and signature codes, from `life_alien_worlds_export` |
| `ontologies.json` | The mechanism, claimed-outcome and world-regime ontologies as Meaning Model concepts and relations, ready to merge into a successor of the target model |
| `target-model.json` | The target model the transfers bind to (illustrative, authored values), at revision 2 |
| `history.json` | The whole construction: the three target-model revisions and all 53 graph revisions of the search |
| `REPLAY.md` | The construction replayed at outline level, one entry per graph revision |
| `OUTLINE.md` | The target model as an outline, with the first line of each linked note |
| `MANIFEST.json` | SHA-256 digests of these files and the source identities |
| `example.test.mjs` | Checks the digests; imports `history.json` on a fresh engine, checks every hash and regenerates the replay, the outline, the target model and the atlas from it; imports the world library into a search on another problem; and registers the target model with the ontologies merged in |

## What was run

- **Worlds.** Seeds were buttress, whirlpool and vigil, drawn from the bank. The
  fourth world, potlatch, came from a commission. Builders, solvers and world
  curators ran as fresh contexts that saw only their server-written task; builders
  and world curators never saw the problem.
- **Mechanisms.** Three open compiles came first (the paper's condition F). Then a
  cued explorer that saw the curated map (condition E), and a map-conditioned
  compile of the fourth world (condition H). Each of the five founded a new family,
  so the search is far from saturated.
- **Curation.** Mechanism and claimed-outcome decisions were made by the calling
  session, which knew the problem; world decisions came from fresh target-blind
  curators. The decisions are not independent of the caller's knowledge.
- **Transfers.** Three mechanisms were mapped onto the target model, each with
  dated proxy labels, at least seven disanalogies, and a fit Cut with a remainder.

## The construction record

`history.json` holds the whole search as it was built: every world, solve, task,
mechanism, ontology revision, transfer, commission and selection, one graph
revision each. Import it on any engine with `life_construction_import`. The engine
rebuilds every revision and checks each hash against the exported one. Then
`life_construction_replay` walks the search step by step. `REPLAY.md` is that
replay at outline level, and the reasoning level adds each record's principle,
decision or rationale.

After the run the maintainer (Claude Opus 5.5, in the session that prepared this
release) made two changes through the same tools. The last steps of the replay
show them:

- Revision 2 of the target model describes its five Events, which had none. No
  value changed.
- The search was rebound to that revision, and a note held by the maintainer says
  why. The rebind dropped no anchor.

The atlas re-rendered at the new head is byte-identical to `atlas.md`, and the
world library and ontologies are as exported at the end of the run.

## What it found

- **Commissioning changed the map, not only its contents.** The diagnosis showed
  that all three first worlds shared one causal relation: left alone, things decay,
  so something must keep them. A commission removed exactly that relation. The world
  built from it, *The Kept World*, made the shared premise visible to its
  target-blind curator. The curator put *answered decay* above the two earlier
  roots and *paid change* beside it as a second root.
- **Six mechanism families under three roots.** Among them are savings as rented
  bearing capacity, averaging by irrevocable temporal scatter, continuity kept by a
  relay, commitment by hindsight on money a year of need left untouched, and claims
  settled only out of the debtor's later surplus.
- **Transfers found their own weak points.** For the hindsight pension, a year of
  stillness can mean money reserved for a rarer shock or owed tax rather than money
  that is spare. For the relay, lean months within a real circle of households are
  correlated.

## Reuse the worlds

The worlds never saw the problem, so any search can start from them:

```json
{
  "graphHash": "<your search graph>",
  "requestId": "import-worlds",
  "searchRootId": "<your search root>",
  "authorId": "you",
  "accessScopes": ["author"],
  "library": "<the object in world-library.json>"
}
```

Pass that to `life_alien_worlds_import`, then prepare solver tasks for the imported
worlds. The import checks the bundle hash, each world's text hash and your
search's own target terms. Reusing a library trades diversity for cost; commission
fresh worlds for the regimes it lacks.

## Boundaries

This is one search with unmatched budgets per condition, so condition yields are
not comparable. The fresh contexts ran the same model family as the caller, and
target blindness is procedural: server-written tasks, and no access to the
conversation. Whether governed world coverage finds more useful mechanisms than
unguided generation at equal cost is still the open experiment.
