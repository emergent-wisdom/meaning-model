# Dollar liquidity and the crypto market: a general-modeling example

A worked example of the general modeling workflow: base tools and the Jev
estimator, no add-ons. A fresh Claude context (Claude Opus 5.5) used the server
for the first time and modeled how US monetary conditions reach Bitcoin's price.
It worked from its own recollection of public records up to 2025-12-31. A
separate pass then checked the dated figures against retrieved sources.

**This is an illustrative, revisable explanatory model. It is not a forecast, a
trading signal or investment analysis.** Its allocations are attributed
judgments, not causal estimates.

## The question

> How do changes in US monetary conditions reach Bitcoin's price through two
> dollar conduits, stablecoin supply and US spot bitcoin ETP flows, and a leverage
> amplifier, over 2024–2025, compared with the 2020–2023 cycle? The conditions
> covered are the policy-rate path, Fed balance-sheet and reserve plumbing (runoff,
> ON RRP and the TGA), and the dollar.

Time is in months, with month 0 at 2026-01-01, the evidence cutoff. Earlier
history has negative times, back to the 2008 crisis (month -208), because
Bitcoin's founding framing formed against bank bailouts and the first QE.

## What the model contains

The agent worked macro to micro, from the enclosing dollar system through the
crypto conduits to the focal price:

- **13 processes with values at the cutoff:**
  - the policy-rate upper bound, Fed total assets, the TGA, the dollar index and
    the 10-year real yield;
  - stablecoin supply in two definitions, cumulative spot-ETP net flows and the
    BTC price;
  - one ordinal judgment of monetary accommodation, and three categorical
    judgments (leverage regime, policy regime, monetary coupling).

  Two more processes, ON RRP and stablecoin issuers' T-bill holdings, stay
  unknown at the cutoff rather than being given an invented value.
- **Dated history as graph records:** 59 dated values, each anchored to its
  process with its evidence cutoff, evidence type and interval. The 12
  policy-rate values are observed reports; the rest are retrospective estimates.
  There are also 22 dated judgment samples under the same rubrics.
- **50 events:** four eras, 32 dated episodes and five assessment events. The
  episodes include the SVB and USDC depeg, the spot-ETF launch, the yen carry
  unwind, the GENIUS Act, the October 2025 liquidation cascade and the end of
  runoff.
- **22 concepts and 5 abstract cuts.** Dollar liquidity is opened under two
  overlapping lenses, instruments and price versus quantity, and the competing
  explanations split along the second. Stablecoin supply is opened by functional
  role, and Bitcoin's monetary meaning into four dated framings.
- **15 Cuts** allocating each episode's BTC move among drivers, and the monetary
  part among conduits. Ten are Jev's and five are the agent's own, under a revised
  category set. Every Cut keeps an explicit remainder.
- **22 Understanding Nodes:** the context and modeling reviews, sample reviews,
  a disagreement note, the provisional reading, the category revision and its
  rationale, a causal-use test and the limits.

## What it suggests (provisional)

- **2020–22:** US monetary conditions carry the largest share of Bitcoin's large
  moves: 0.83 (Jev) and 0.55 (the agent) for the 2020–21 easing. That part moved
  mainly through stablecoin liquidity. In 2022 the monetary share (0.40 and 0.45)
  is split about equally with crypto-internal failures and travels through
  leverage and credit.
- **2024–25:** the monetary share is small (0.00–0.17 by Jev, 0.10–0.15 by the
  agent). Regulatory and political shifts, new access demand and leverage carry
  more. Stablecoin supply more than doubled while the Fed balance sheet shrank, so
  the stablecoin conduit does not simply mirror dollar liquidity.
- **Q4 2025** is the anomaly: easing coincided with a leverage-led fall.
- **A missing category.** Jev's 2024 driver Cut left 0.36 in the remainder. The
  agent read that as a missing category and added "access and adoption demand"
  in a second question, keeping Jev's version beside it. Measured as total
  variation, the two allocations disagree most about 2025 (0.41 and 0.43).

These are shares of one declared budget under one question. They are not
probabilities of events, physical shares or causal effects, and both estimators
judged situation texts the agent wrote, so their agreement is not independent.

## How it was built

| Step | Tool | What happened |
|---|---|---|
| Orientation | `life_general_modeling_start`, `life_modeling_context` | Read both papers, the protocol, the guide and the examples |
| Construction | `life_world_model_build` | A dry preview, then one Jev call for three initial judgments; model, graph and world created |
| Correction | `life_model_revise`, `life_world_revise` | The stablecoin process was mis-defined (fiat-backed only). A second process holds the all-USD-pegged total |
| History | estimation exchange | 59 dated values filed as claims and reviewed |
| Allocations | `life_model_ingest` | One Jev call for ten Cut questions across five episodes, with notes |
| Category revision | `life_model_revise` | A driver category added under a second question; Jev's version kept |
| Close | `life_narrative_batch` | The reading, the limits and the tests as Understanding Nodes |

Jev was called three times, using 20,457 input and 843 output tokens in total.
One call was lost to a validation bug, described below. The steps after the run
made no Jev call.

Revisions 0 to 3 are the agent's run. Three revisions were added afterwards by
the maintainer, and none changes a value:

- **Revision 4** declares that each conduit Cut is conditioned on its episode's
  monetary share. The agent could state that only in the question text. In 2024
  and Q4 2025 the share is 0.02 and 0.00, so those conduit shares describe almost
  nothing of the move. The tool now warns about that case.
- **Revision 5** marks the eight measured series as observed processes, so
  retrieved values can be filed as observed reports. The builder had made them
  static only because the agent's cutoff values were recollections.
- **Revision 6** describes the 30 Events that had no description, so every dated
  value and Cut sits in a described situation. The descriptions use the dates and
  figures the retrieval check confirmed.

## The construction record

The whole construction is in `history.json`: 7 model revisions and 17 graph
revisions, from the first build to the maintainer's last note. Import it on any
engine with `life_construction_import`. The engine rebuilds every revision and
checks each hash against the exported one. Then `life_construction_replay` walks
the history one step at a time: why each step was taken, what each model revision
changed, and each note shown beside the records it concerned, as those records
were at that step.

- `REPLAY.md` is the replay at outline level, one entry per graph revision.
- `OUTLINE.md` is the present state: all 50 Events with their descriptions, the
  Cuts under them, the processes and concepts, and the first line of every note
  linked to each record.

The maintainer (Claude Opus 5.5, in the session that prepared this release) added
the last steps through the same tools:

- **The review.** The retrieval check is recorded as a review held by its checker.
  It carries the prompt the checker was given, the graph revision its input came
  from (revision 9, the agent's last), its verdict and its findings, and it is
  linked to the 59 samples and 32 events it was given.
- **Notes.** Five notes held by the maintainer explain revisions 4, 5 and 6 and how
  the check was answered. They are linked to the Cuts, processes and Events they
  concern. One note corrects the review record itself: the checker's input listed
  59 dated samples, not 56. It checked the 56 numeric ones and skipped three dated
  policy-regime categories, which are judgments.

## What the retrieval check found

After the run, a separate agent with web access checked every dated figure
against primary or standard sources: the Fed's H.4.1 release, the Daily Treasury
Statement, Coin Metrics and Coinbase, Farside, DefiLlama, FOMC statements and the
laws and orders themselves. It checked 97 items: 9 cutoff values, 56 dated samples
and 32 events. The judgments and regimes were not checked, because no source can
check them.

**96 of the 97 were correct or inside their stated intervals.** The one miss is
small. The Bitcoin close recorded for 2021-11-10 was 67,500, but it was 64,756.
67,500 is the record close two days earlier.

The correction and the five largest differences inside the intervals are filed as
observed reports at their own dates, recorded with `life_process_estimation_record`,
and linked to the recalled values they check:

| Value | Recalled | Retrieved |
|---|---|---|
| BTC close, 2021-11-10 | 67,500 | 64,756 (Coin Metrics; Coinbase 64,912) |
| TGA, 2023-06-02 | 40 | 23.4 |
| TGA, near 2025-11-01 | 950 | 926.3 |
| USD-pegged stablecoins, 2024-01-01 | 135 | 129.84 (DefiLlama) |
| Fiat-backed stablecoins, 2025-12-31 | 270 | 277.3 to 281.4, depending on tokenized funds |
| Fed total assets, 2025-12-31 | 6.55 | 6.641, including a year-end bulge |

The recalled values stay in place beside the retrieved ones, so both accounts
remain visible. The full report, with a source URL for every item, is in
`notes/fact-check.md`, and a copy is a source record in the graph. The checker's
input is `notes/facts-to-check.md`. The report
also notes where a figure depends on the source's definition. For example,
DefiLlama's 2020 stablecoin total omits Tether on one ledger (Omni).

## What the run found in the tool

The agent logged 18 friction items (`notes/friction.md`). This release changes
the tool as follows:

| Item | Problem | Change |
|---|---|---|
| F12 | One rounded Score answer discarded a 22-question batch and its usage | Rounding is accepted; an invalid answer is declined on its own coordinate; usage is always returned |
| F10 | No way to record the modeler's own dated history | `life_process_estimation_record` records exchange proposals with their evidence types |
| F9, F17 | Claim format and negative time basis undocumented | A worked "Record dated history" recipe in the guide |
| F5 | Jev's distributions and confidence hidden; uncertainty dropped | Preview shows them; Score estimates keep a standard deviation, or the median and quartiles |
| F7, F8 | A revision accepted by the model tool was refused by the world, and stale claims were silent | `worldAdoption` and `requireWorldAdoptable`; `claimConsistency` after a world revision |
| F13, F14, F15 | Ingest notes could not link, situation texts were lost, conditioning was unavailable | Linked notes, recorded situation texts and answer meanings, `conditionedOn` |
| F2 | The served paper lacked its included files | Both papers are served with their includes inline |
| F1, F3, F6 | Unclear default purpose, no validate-only build, a confusing proposal error | Stated default, `validateOnly`, a named owning tool |
| F4, F11, F16, F18 | Engine limits | Documented in the guide |
| Retrieval check | Measured series with estimated starting values were built as static, so retrieved reports could not be filed as observations | A per-process `updateMode` in the builder; revision 5 shows the revision path |

## Files

| File | What it is |
|---|---|
| `history.json` | The whole construction: every model revision and every graph revision as its change |
| `REPLAY.md` | The construction replayed at outline level, one entry per graph revision |
| `OUTLINE.md` | The present model and graph as an outline, with the first line of each linked note |
| `model.json` | The final model definition (revision 6) |
| `graph.json` | The final Understanding graph (revision 16): sources, reviews, dated values, the texts Jev judged, the retrieval check and the maintainer's notes |
| `notes/reading.md` | What the agent read before modeling |
| `notes/summary.md` | The agent's summary of the model |
| `notes/friction.md` | The agent's friction log, verbatim |
| `notes/facts-to-check.md` | The 97 dated items given to the checker |
| `notes/fact-check.md` | The retrieval check of the dated figures |
| `MANIFEST.json` | SHA-256 digests and source identities |
| `example.test.mjs` | Imports `history.json` on a fresh engine and checks every hash, the replay, the outline and the review record; re-registers the final model and graph, runs a world and checks the records |

## Boundaries

The run is one first-use session by one model, so it shows the workflow, not
modeling accuracy. The dated values were recalled and then checked; the
allocations and judgments were not, because no source can check them. Both the
modeler and the checker are Claude, and the checker used retrieval. There are no
transition laws, so the model cannot simulate an intervention. Nothing after
2025-12-31 is represented.
