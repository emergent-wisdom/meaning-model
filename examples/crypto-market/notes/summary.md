# 01 Summary: how dollar liquidity and US monetary conditions reach the crypto market

**This is an illustrative, revisable model built as a worked example for the Meaning Model's
general-purpose workflow. It is not a forecast, trading signal or investment analysis.** Every
value is either the modeler's (Claude Opus 5.5's) recollection of public records or an
authored or estimated judgment. Nothing was retrieved from a primary source in this run. The
evidence cutoff is 2025-12-31, and nothing after it is represented, although the run date is
2026-09-23.

Final handles (also in `state.json`):

- model `53b48b6e1c4053110452101842057839b5ac128934e47bffacd3715e3b11158d` (revision 3)
- graph `283125d1102ebdd77ed6f93ea28e105bf32e9d3769f6d261587e516c84517d25` (revision 9)
- world `world_8ec5959c-cc49-42ba-87a0-7d964a89fc10`, head version 3

Exports: `results/model-final.json` (`life_model_inspect`, includeDefinition) and
`results/graph-final.json` (`life_narrative_query` full, includeContent).

## The question

> How do changes in US monetary conditions (the policy-rate path, Fed balance-sheet and reserve
> plumbing through runoff, ON RRP and the TGA, and the dollar) reach Bitcoin's price through two
> dollar conduits, stablecoin supply and US spot bitcoin ETP flows, and a leverage amplifier,
> over January 2024-December 2025, compared with the 2020-2023 cycle?

- **Focal interval:** January 2024-December 2025 (t = -24 to 0 months; t = 0 is 2026-01-01).
- **Broader horizon:** from the 2008 crisis (t = -208), because Bitcoin's founding framing formed
  against bank bailouts and the first QE.
- **Purpose/authority:** `observation`. Recalled reports keep report authority, and estimates stay estimates.

## What the model contains

### Macro to micro

1. **Enclosing system (US dollar monetary system):** policy-rate upper bound, Fed total assets,
   ON RRP (unknown at cutoff), TGA, dollar index, 10-year real yield.
2. **Conduits (crypto sector):** USD stablecoin supply in two definitions (fiat-backed only; all
   USD-pegged), stablecoin issuers' T-bill reserves (unknown at cutoff), cumulative US spot ETP
   net flows, derivatives leverage regime, US crypto-policy regime (a gate on the conduits).
3. **Focal outcome:** BTC price, plus an authored judgment of which relation dominated BTC's
   response to dollar conditions.

### Processes at the cutoff (13 native, plus 2 unresolved definitions)

| Process | t = 0 value | Unit | Evidence (holder) | Uncertainty |
| --- | --- | --- | --- | --- |
| us.fed_funds_upper_pct | 3.75 | percent per annum | report (modeler) | 3.75-4.00 |
| fed.total_assets_usd_tn | 6.55 | USD trillion | estimate (modeler) | 6.4-6.8 |
| us.tga_usd_bn | 850 | USD billion | estimate (modeler) | 700-1000 |
| usd.dxy_index | 98.5 | index points | estimate (modeler) | 96-101 |
| us.real_yield_10y_pct | 1.85 | percent per annum | estimate (modeler) | 1.5-2.2 |
| stablecoins.usd_pegged_supply_usd_bn | 305 | USD billion | estimate (modeler) | 285-325 |
| stablecoins.usd_supply_usd_bn (fiat-backed only) | 270 | USD billion | estimate (modeler; revised from 305) | 250-290 |
| etps.us_spot_btc_cum_net_flow_usd_bn | 57 | USD billion | estimate (modeler) | 50-65 |
| btc.price_usd | 88,000 | USD per BTC | estimate (modeler) | 80,000-100,000 |
| judgment.monetary_accommodation_for_crypto | 0.99 | ordinal level, -2..+2 | Jev estimate (p = 0.99 on level +1) | not carried (F5) |
| regime.crypto_leverage | deleveraged | category | Jev estimate (0.95) | not carried |
| regime.btc_monetary_coupling | flow_dominated | category | Jev estimate (0.90) | not carried |
| regime.us_crypto_policy | accommodative_legislated | category | modeler estimate with rubric | unknown |
| us.on_rrp_usd_bn | unknown | USD billion | unresolved definition | about $2.5T peak end-2022, near zero autumn 2025 |
| stablecoins.tbill_reserves_usd_bn | unknown | USD billion | unresolved definition | plausibly $150-220B; needs attestations |

### Dated history (graph nodes, not runtime observations)

- **Measured processes:** 59 dated samples. The 12 policy-rate values are exact public records
  filed as observed reports at their own dates. The other 47 are approximate recollections
  filed as retrospective estimates with intervals. They cover 2008-2025 for the policy rate and
  balance sheet, and 2020-2025 for stablecoins, the dollar, real yields, the TGA, ETP flows and BTC.
- **Judgment processes:** 22 modeler-authored retrospective samples under the same rubrics.
  Jev's batch for these was rejected (F12).

### Events (50)

- 1 accepted-world root, 7 referent lifecycles and 4 eras.
- 32 dated episodes, for example the SVB/USDC depeg, the 2023 and 2025 TGA rebuilds, the ETF
  launch, the halving, the yen carry unwind, the GENIUS Act, the October 2025 liquidation
  cascade, repo pressure and the end of runoff, and the Q4 2025 drawdown.
- 1 modeler understanding root and 5 assessment events beneath it.
- 3 authored event-to-event claims with stated support: Terra enabled the 2022 credit
  failures; the 2025 TGA rebuild enabled the repo pressure; the repo pressure caused the
  reserve-management purchases.

### Concepts (22) and abstract cuts (5)

- `concept.dollar_liquidity` is opened under two overlapping lenses: instruments (rate,
  reserves, Treasury/RRP plumbing, dollar) and price versus quantity. The competing explanations
  split along the second lens.
- `concept.transmission_channel` is opened into five overlapping conduits.
  `concept.stablecoin_conduit` is opened again into settlement float, T-bill backing and
  offshore dollar access.
- `concept.btc_monetary_meaning` holds four dated framings: p2p cash (2008-09), debasement hedge
  (2020), liquidity-sensitive risk asset (2022), institutional allocation (2024-25).
- `concept.access_adoption_demand` was added in revision 3.

### Channel Cuts (15)

All sit under the modeler's understanding root, not accepted history. Each allocates
explanatory responsibility, not causal effect.

**Jev, `q.driver` (vocabulary v1):** how much of each episode's BTC move was due to which driver?

| Episode | us_monetary | us_crypto_policy | crypto_internal | other_macro | remainder |
| --- | --- | --- | --- | --- | --- |
| 2020-21 easing | 0.83 | 0.00 | 0.02 | 0.00 | 0.15 |
| 2022 tightening | 0.40 | 0.00 | 0.46 | 0.00 | 0.14 |
| 2024 | 0.02 | 0.34 | 0.28 | 0.00 | 0.36 |
| 2025 to October | 0.17 | 0.64 | 0.02 | 0.01 | 0.16 |
| Q4 2025 | 0.00 | 0.00 | 0.85 | 0.13 | 0.02 |

**Jev, `q.conduit`:** through which conduit did the US-monetary part travel? This is
conditional on the us_monetary share, and nearly empty where that share is about 0.

| Episode | stablecoin | leverage_credit | etf_flows | corporate_treasury | valuation_direct | remainder |
| --- | --- | --- | --- | --- | --- | --- |
| 2020-21 | 0.85 | 0.09 | 0.00 | 0.00 | 0.05 | 0.01 |
| 2022 | 0.21 | 0.43 | 0.00 | 0.00 | 0.35 | 0.01 |
| 2024 | 0.42 | 0.23 | 0.10 | 0.00 | 0.23 | 0.02 |
| 2025 to October | 0.73 | 0.02 | 0.04 | 0.00 | 0.19 | 0.02 |
| Q4 2025 | 0.00 | 0.55 | 0.21 | 0.01 | 0.18 | 0.05 |

**Modeler, `q.driver.v2`:** a category revision that adds access and adoption demand, because
Jev's 2024 remainder of 0.36 signalled a missing category. Coarse 0.05 grid; not an estimator output.

| Episode | us_monetary | us_crypto_policy | access_adoption | crypto_internal | other_macro | remainder |
| --- | --- | --- | --- | --- | --- | --- |
| 2020-21 | 0.55 | 0.00 | 0.15 | 0.15 | 0.05 | 0.10 |
| 2022 | 0.45 | 0.05 | 0.00 | 0.40 | 0.05 | 0.05 |
| 2024 | 0.15 | 0.25 | 0.35 | 0.10 | 0.05 | 0.10 |
| 2025 to October | 0.15 | 0.25 | 0.35 | 0.05 | 0.10 | 0.10 |
| Q4 2025 | 0.10 | 0.00 | 0.25 | 0.45 | 0.10 | 0.10 |

To compare v1 with v2, fold v2's new category into v1's remainder and take the total variation
(the minimum share that must move to turn one allocation into the other): 0.28, 0.15, 0.27, 0.41
and 0.43 across the five episodes. The two estimators disagree substantially about 2025.

### Understanding Nodes (22 externalized reflections)

- Five context and modeling reviews and five scaffold notes, written at build.
- Reviews of the historical samples, the judgment samples and the channel Cuts.
- A disagreement note, a provisional reading, and the category-revision rationale.
- The v1-v2 comparison, the stablecoin definition correction and a context revisit.
- A causal-use and conservation note, an estimator-usage record, and a limits note.

## How to read it

- **The provisional reading** (`u.reading.channel_mix_shift`, `u.context.revisited`):
  - In 2020-22, US monetary conditions receive the largest or near-largest share of BTC's large
    moves. For 2020-21 this is 0.83 (Jev) and 0.55 (modeler). For 2022 it is 0.40 and 0.45,
    shared almost equally with crypto-internal failures (0.46 and 0.40). The monetary part
    travelled mainly through stablecoin liquidity (2020-21) and leverage and credit (2022).
  - In the spot-ETF era, both assign a small share to US monetary conditions (0.00-0.17 by Jev,
    0.10-0.15 by the modeler). Regulatory and political shifts, new access demand and leverage
    carry more.
  - Stablecoin supply more than doubled (about $135B to about $305B) while the Fed balance sheet
    shrank by about $1.1T. The stablecoin conduit therefore does not simply mirror dollar
    liquidity; the functional-role opening explains why.
  - Q4 2025 is the anomaly: easing coincided with a leverage-led fall.
- **Price versus quantity:** the model deliberately keeps both readings (price of money versus
  quantity of reserves) open. It does not adopt the popular "net liquidity" index.
- **Where to look:**
  - Every number has an evidence type, a holder and (for dated values) a `value_time` and
    `evidence_cutoff`, on its graph node: `hist.sample.*`, `judg.sample.*` and
    `general.process.*`.
  - Jev's raw answers are in `general.evidence.general.estimator.initial`.
  - The texts Jev judged for the Cuts are in `ingprov.*`.
  - The revision lineage (0, 1 orphaned, 1b, 2, 3) is in `state.json` and in `u.revision.*`.
- **Reading the numbers:** Cut weights are shares of one declared budget under one question,
  with an explicit remainder. They are not probabilities of events, not physical shares and not
  causal effects. The accommodation scale is ordinal (+2 is not twice +1).

## What it does not show

- **No causal identification and no forecast.** The model declares no transition laws, so it
  cannot simulate a policy change or test an intervention.
- **No retrieved data.** Only the FOMC ranges are exact. Everything else is recalled or judged,
  with intervals, and the resolution is monthly and episodic.
- **Estimator dependence.** The channel allocations are AI inference (Jev) or the modeler's own
  judgment. Both rest on situation texts the modeler wrote, so their agreement is not
  independent confirmation.
- **Unknowns and exclusions.**
  - ON RRP and stablecoin T-bill reserves are unknown at the cutoff.
  - The conditioning of the conduit Cut is stated in its question text only.
  - Nothing after 2025-12-31 is represented.
  - Non-US central banks, global M2, equity and AI-sector risk appetite, Ethereum and altcoins
    appear only as events or answer categories.
- **Rubric sensitivity.** The t = 0 accommodation score (+0.99) partly follows the rubric's own
  anchor text ("adding reserves, for example bill purchases"). A rubric separating technical
  reserve management from stance would lower it without any change in the world.
- **What would improve it:** retrieved series for each sampled process, issuer attestations,
  ETP flow and derivatives data, and later observations against which the channel allocations
  could be tested.

## Estimator use (3 of 3 calls, typesafe:jev-1.13.0)

1. **Builder preview:** 3 questions; 12,155 input and 128 output tokens; about 0.74 s. Applied.
2. **`life_process_estimate`:** 22 retrospective questions. Rejected ("score is inconsistent with
   its distribution"). The provider very probably ran, but no usage was returned.
3. **`life_model_ingest` preview:** 10 Cut questions; 8,302 input and 715 output tokens; 3.2 s.
   Applied from its proposal id without a new call.

No speed or cost advantage is claimed. The friction log is in `notes/friction.md` (F1-F18).
