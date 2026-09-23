# Model dollar-liquidity-crypto-2026-09, revision 6 (bf066d32d851)
Revision reason: Describe the 30 Events that had no description, so that every Event says what happens in it and each number sits in a described situation. Written after the run by the maintainer (Claude Opus 5.5) from the event records, the modeler’s notes and the retrieval check; no value, interval, weight or boundary changes.
Graph dollar-liquidity-crypto-2026-09.understanding, revision 16 (f98b569a9da0): 250 nodes, 1068 edges.

## Descriptions
50 of 50 Events are described; 5 carry Cuts.

## Things
- ref.bitcoin: The Bitcoin network and its native asset BTC
  ✎ general.process.regime.btc_monetary_coupling [process_initial_value by typesafe:jev-1.13.0]: structured record (meaning, unit, referenceFrame, type, initial, judgmentQuestion)
  ✎ general.referent.ref.bitcoin [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
  ✎ general.process.btc.price_usd [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
- ref.corporate_treasuries: Listed companies holding BTC as a treasury asset (Strategy and 2025 digital-asset-treasury firms)
  ✎ general.referent.ref.corporate_treasuries [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
- ref.crypto_derivatives: Crypto derivatives venues considered as one leverage collective (offshore perpetual swaps and CME futures)
  ✎ general.process.regime.crypto_leverage [process_initial_value by typesafe:jev-1.13.0]: structured record (meaning, unit, referenceFrame, type, initial, judgmentQuestion)
  ✎ general.referent.ref.crypto_derivatives [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
- ref.fed: The US Federal Reserve System acting through the FOMC and the New York Fed open-market desk
  ✎ general.referent.ref.fed [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
  ✎ general.process.us.fed_funds_upper_pct [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
  ✎ general.process.fed.total_assets_usd_tn [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
  ✎ general.process.us.on_rrp_usd_bn [unresolved_process_definition by model-builder]: structured record (id, meaning, unit, referenceFrame, type, initial, referentIds)
  ✎ general.process.judgment.monetary_accommodation_for_crypto [process_initial_value by typesafe:jev-1.13.0]: structured record (meaning, unit, referenceFrame, type, initial, judgmentQuestion)
- ref.treasury: The US Department of the Treasury as debt issuer and holder of the Treasury General Account
  ✎ general.referent.ref.treasury [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
  ✎ general.process.us.tga_usd_bn [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
- ref.us_spot_btc_etps: The group of US-listed spot bitcoin exchange-traded products (IBIT, FBTC, GBTC and others)
  ✎ general.referent.ref.us_spot_btc_etps [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
  ✎ general.process.etps.us_spot_btc_cum_net_flow_usd_bn [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
- ref.usd_stablecoins: Fiat-backed USD payment stablecoins as one collective conduit (USDT, USDC and smaller issuers; the algorithmic UST before its May 2022 collapse is noted but not a fiat-backed member)
  ✎ u.revision.stablecoin_definition [modeling_review by modeler:claude-opus-5.5]: Definition correction (revisions 1 and 1b). While sampling history I found that my recalled stablecoin figures (about $305B at end-2025) are aggregator totals for all USD-pegged stablecoins, but revision 0 filed them under a process define…
  ✎ general.referent.ref.usd_stablecoins [referent_boundary by model-builder]: structured record (id, boundary, continuity, lifecycle, interval, sourceIds)
  ✎ general.process.stablecoins.usd_supply_usd_bn [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
  ✎ general.process.stablecoins.tbill_reserves_usd_bn [unresolved_process_definition by model-builder]: structured record (id, meaning, unit, referenceFrame, type, initial, referentIds)

## Events
- ev.modeler.understanding: The modeler's assessment process (Claude Opus 5.5, this run, 2026-09-23). Judgments here are attributed to the modeler and are never accepted as world fact.
  Construction-time understanding root for retrospective explanatory assessments made after the evidence cutoff (t = 0) with hindsight.
  ✎ u.test.causal_use_and_conservation [modeling_review by modeler:claude-opus-5.5]: Protocol step 9, causal use and conservation. The model declares no executable laws (executableLawCount 0), so there is no intervention to run: changing one input cannot propagate, and an irrelevant-input stability test is vacuous. That is…
  - ev.assess.channels.2020_2021: Modeler's retrospective assessment of how the 2020-2021 US easing reached BTC (March 2020 to November 2021)
    Assessment event beneath the modeler's understanding root; its Cuts are the modeler's retrospective allocations of explanatory responsibility (estimated by Jev from the situation text), not accepted-world facts.
    · cut.ev.assess.channels.2020_2021.q.conduit: For the part of BTC's move in this episode that is attributable to US monetary conditions, through which conduit did it mainly travel? → corporate_treasury 0.00, etf_flows 0.00, leverage_credit 0.09, remainder 0.01, stablecoin_liquidity 0.85, valuation_direct 0.05 [within cut.ev.assess.channels.2020_2021.q.driver:us_monetary]
      ✎ maintainer.conditioning [understanding.decision by maintainer:claude-opus-5-5]: Model revision 4 declares what the conduit question always meant: each conduit Cut divides only the us_monetary share of its episode's driver Cut (Jev's, vocabulary v1), not the whole move. Read a conduit split together with that share. It…
    · cut.ev.assess.channels.2020_2021.q.driver: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers? → crypto_internal 0.02, other_macro 0.00, remainder 0.15, us_crypto_policy 0.00, us_monetary 0.83
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2020_2021.q.driver.v2: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers (vocabulary v2, which adds access and adoption demand)? → access_adoption_demand 0.15, crypto_internal 0.15, other_macro 0.05, remainder 0.10, us_crypto_policy 0.00, us_monetary 0.55
    ✎ u.comparison.driver_v1_v2 [modeling_review by modeler:claude-opus-5.5]: Derived diagnostic comparing Jev's driver Cut (v1) with the modeler's (v2). v2 is projected onto v1 by moving access_adoption_demand into the remainder; TV is the total variation, the minimum share that must move to turn one allocation int…
    ✎ u.revision.driver_vocabulary_v2 [modeling_review by modeler:claude-opus-5.5]: Category revision (model revision 3). The Jev driver Cut for 2024 in vocabulary v1 left 0.36 unallocated, the largest remainder in the model. Following the guide, a large remainder signals a missing category. Candidate: new access and adop…
    ✎ ingprov.question.q.driver [cut_question_definition by modeler:claude-opus-5.5]: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers?
    ✎ ingprov.question.q.conduit [cut_question_definition by modeler:claude-opus-5.5]: For the part of BTC's move in this episode that is attributable to US monetary conditions, through which conduit did it mainly travel?
    ✎ ingprov.situation.2020_2021 [estimator_situation_text by modeler:claude-opus-5.5]: Episode: March 2020 to November 2021. US monetary conditions: emergency cuts to 0-0.25% in March 2020 and open-ended asset purchases; Fed total assets rose from about $4.2T to about $8.7T; the 10-year real yield fell to about -1%; the doll…
    ✎ u.reading.channel_mix_shift [ingest.note by modeler:claude-opus-5.5]: Provisional reading for the model's question (AI inference on recalled evidence; not a causal identification or forecast). In 2020-2022, changes in US monetary conditions explain most of BTC's large moves and travel mainly through on-chain…
    ✎ u.review.channel_cuts [ingest.note by modeler:claude-opus-5.5]: Review of the ten Jev-estimated channel Cuts (ingest proposal estimate.ffba0703; usage 8,302 input and 715 output tokens). Approved as recorded AI inference, not canon. q.driver, the US-monetary share of each episode's BTC move: 0.83 in 20…
  - ev.assess.channels.2022: Modeler's retrospective assessment of how the 2022 US tightening reached BTC (March to December 2022)
    Assessment event beneath the modeler's understanding root; its Cuts are the modeler's retrospective allocations of explanatory responsibility (estimated by Jev from the situation text), not accepted-world facts.
    · cut.ev.assess.channels.2022.q.conduit: For the part of BTC's move in this episode that is attributable to US monetary conditions, through which conduit did it mainly travel? → corporate_treasury 0.00, etf_flows 0.00, leverage_credit 0.43, remainder 0.01, stablecoin_liquidity 0.21, valuation_direct 0.35 [within cut.ev.assess.channels.2022.q.driver:us_monetary]
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2022.q.driver: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers? → crypto_internal 0.46, other_macro 0.00, remainder 0.14, us_crypto_policy 0.00, us_monetary 0.40
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2022.q.driver.v2: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers (vocabulary v2, which adds access and adoption demand)? → access_adoption_demand 0.00, crypto_internal 0.40, other_macro 0.05, remainder 0.05, us_crypto_policy 0.05, us_monetary 0.45
    ✎ ingprov.situation.2022 [estimator_situation_text by modeler:claude-opus-5.5]: Episode: March to December 2022. US monetary conditions: hikes from 0.25% to 4.50% at the upper bound, including four 75bp hikes, and balance-sheet runoff from June 2022; the 10-year real yield rose from about -1% to about +1.5%; the dolla…
    ✎ also u.comparison.driver_v1_v2, u.revision.driver_vocabulary_v2, ingprov.question.q.driver, ingprov.question.q.conduit, u.reading.channel_mix_shift, u.review.channel_cuts (shown above)
  - ev.assess.channels.2024: Modeler's retrospective assessment of how 2024 US monetary conditions reached BTC (January to December 2024)
    Assessment event beneath the modeler's understanding root; its Cuts are the modeler's retrospective allocations of explanatory responsibility (estimated by Jev from the situation text), not accepted-world facts.
    · cut.ev.assess.channels.2024.q.conduit: For the part of BTC's move in this episode that is attributable to US monetary conditions, through which conduit did it mainly travel? → corporate_treasury 0.00, etf_flows 0.10, leverage_credit 0.23, remainder 0.02, stablecoin_liquidity 0.42, valuation_direct 0.23 [within cut.ev.assess.channels.2024.q.driver:us_monetary]
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2024.q.driver: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers? → crypto_internal 0.28, other_macro 0.00, remainder 0.36, us_crypto_policy 0.34, us_monetary 0.02
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2024.q.driver.v2: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers (vocabulary v2, which adds access and adoption demand)? → access_adoption_demand 0.35, crypto_internal 0.10, other_macro 0.05, remainder 0.10, us_crypto_policy 0.25, us_monetary 0.15
    ✎ ingprov.situation.2024 [estimator_situation_text by modeler:claude-opus-5.5]: Episode: January to December 2024. US monetary conditions: the policy rate was held at 5.25-5.50% until September, then cut by 100bp to 4.25-4.50% (September-December); runoff was slowed in June; ON RRP balances drained, cushioning bank re…
    ✎ u.disagreement.channel_cuts [ingest.note by modeler:claude-opus-5.5]: Where the modeler disagrees with the Jev allocations (kept as disagreement, not overwritten). (1) corporate_treasury gets about 0 in every episode, although the largest corporate holder bought about 250K BTC in 2024 and digital-asset-treas…
    ✎ also u.comparison.driver_v1_v2, u.revision.driver_vocabulary_v2, ingprov.question.q.driver, ingprov.question.q.conduit, u.reading.channel_mix_shift, u.review.channel_cuts (shown above)
  - ev.assess.channels.2025_to_october: Modeler's retrospective assessment of how US monetary conditions reached BTC from January to early October 2025
    Assessment event beneath the modeler's understanding root; its Cuts are the modeler's retrospective allocations of explanatory responsibility (estimated by Jev from the situation text), not accepted-world facts.
    · cut.ev.assess.channels.2025_to_october.q.conduit: For the part of BTC's move in this episode that is attributable to US monetary conditions, through which conduit did it mainly travel? → corporate_treasury 0.00, etf_flows 0.04, leverage_credit 0.02, remainder 0.02, stablecoin_liquidity 0.73, valuation_direct 0.19 [within cut.ev.assess.channels.2025_to_october.q.driver:us_monetary]
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2025_to_october.q.driver: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers? → crypto_internal 0.02, other_macro 0.01, remainder 0.16, us_crypto_policy 0.64, us_monetary 0.17
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.2025_to_october.q.driver.v2: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers (vocabulary v2, which adds access and adoption demand)? → access_adoption_demand 0.35, crypto_internal 0.05, other_macro 0.10, remainder 0.10, us_crypto_policy 0.25, us_monetary 0.15
    ✎ ingprov.situation.2025_to_october [estimator_situation_text by modeler:claude-opus-5.5]: Episode: January to early October 2025. US monetary conditions: the policy rate was held at 4.25-4.50% until a 25bp cut on September 17; runoff was slowed to $5B of Treasuries a month from April; under the reinstated debt limit the TGA was…
    ✎ also u.comparison.driver_v1_v2, u.revision.driver_vocabulary_v2, ingprov.question.q.driver, ingprov.question.q.conduit, u.disagreement.channel_cuts, u.reading.channel_mix_shift, u.review.channel_cuts (shown above)
  - ev.assess.channels.q4_2025: Modeler's retrospective assessment of how US monetary conditions reached BTC from October 6 to December 31, 2025
    Assessment event beneath the modeler's understanding root; its Cuts are the modeler's retrospective allocations of explanatory responsibility (estimated by Jev from the situation text), not accepted-world facts.
    · cut.ev.assess.channels.q4_2025.q.conduit: For the part of BTC's move in this episode that is attributable to US monetary conditions, through which conduit did it mainly travel? → corporate_treasury 0.01, etf_flows 0.21, leverage_credit 0.55, remainder 0.05, stablecoin_liquidity 0.00, valuation_direct 0.18 [within cut.ev.assess.channels.q4_2025.q.driver:us_monetary]
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.q4_2025.q.driver: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers? → crypto_internal 0.85, other_macro 0.13, remainder 0.02, us_crypto_policy 0.00, us_monetary 0.00
      ✎ also maintainer.conditioning (shown above)
    · cut.ev.assess.channels.q4_2025.q.driver.v2: Looking back at this episode, how is explanatory responsibility for BTC's price move divided among these drivers (vocabulary v2, which adds access and adoption demand)? → access_adoption_demand 0.25, crypto_internal 0.45, other_macro 0.10, remainder 0.10, us_crypto_policy 0.00, us_monetary 0.10
    ✎ ingprov.situation.q4_2025 [estimator_situation_text by modeler:claude-opus-5.5]: Episode: October 6 to December 31, 2025. US monetary conditions: the policy rate was cut on October 29 and December 10 (to 3.50-3.75% at the upper bound; the December cut is recalled with moderate confidence); runoff ended on December 1 af…
    ✎ also u.comparison.driver_v1_v2, u.revision.driver_vocabulary_v2, ingprov.question.q.driver, ingprov.question.q.conduit, u.disagreement.channel_cuts, u.reading.channel_mix_shift, u.review.channel_cuts (shown above)
- general.event.world: Illustrative, revisable explanatory model of how US monetary conditions reach the crypto market, focused on Bitcoin. In scope: the US policy-rate path, the Fed balance sheet and reserves, Treasury cash management (TGA) and the ON RRP facil…
  The whole modeled span: US dollar conditions and the crypto market from the 2008 crisis (month -208) to the evidence cutoff at the end of 2025 (month 0), in four eras. Every other Event happens inside it. The modeler recalled the values; a separate pass later checked the dated ones against retrieved public sources.
  ✎ u.limits.what_not_shown [modeling_review by modeler:claude-opus-5.5]: What this model does not show. It is an illustrative, revisable explanatory account, not a forecast, trading signal or investment analysis. It does not identify causal effects: the Cuts allocate explanatory responsibility from a perspectiv…
  ✎ maintainer.descriptions [understanding.revision by maintainer:claude-opus-5-5]: Model revision 6 describes the 30 Events that had no description, so every dated value and Cut sits in a described situation. The descriptions use the dates and figures the retrieval check confirmed, and the modeler's own notes for each Ev…
  - general.lifecycle.ref.fed: Established 1913; continuing past the evidence cutoff
    The Federal Reserve exists from 1913 to beyond the cutoff. It acts through the FOMC and the New York Fed's open-market desk, and sets the two conditions the model follows most closely: the policy rate and the size of its balance sheet.
    ✎ also maintainer.descriptions (shown above)
  - general.lifecycle.ref.treasury: Established 1789; continuing
    The US Treasury exists from 1789 onward. In the model it matters as the issuer of bills and the holder of its cash account at the Fed, the TGA, whose rebuilds and drawdowns move bank reserves.
    ✎ also maintainer.descriptions (shown above)
  - ev.era.etf_era_2024_2025 [-24, 0]: Focal interval: the spot-ETF era, from restrictive plateau to easing (2024-01-01 to 2025-12-31)
    The policy rate went from 5.50% to 3.75% at the upper bound, runoff slowed and then ended, stablecoin supply roughly doubled, and US spot ETPs took in tens of billions of dollars. BTC set highs in March 2024, December 2024-January 2025 and October 2025, then fell back into the $80-90K range after October 2025.
    ✎ general.event_record.ev.era.etf_era_2024_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
    - ev.spot_btc_etf_launch [-23.71, -23.645]: US spot bitcoin ETPs approved and begin trading
      A world change: from this date a regulated TradFi conduit into spot BTC exists.
      ✎ general.event_record.ev.spot_btc_etf_launch [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.concept.concept.btc_as_institutional_allocation [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
      ✎ general.context_review.conceptVariation [modeling_context_review by modeler:claude-opus-5.5]: Bitcoin's monetary meaning is framed differently across dates and actors: peer-to-peer cash against bailouts (2008-09), debasement hedge (macro investors, 2020), liquidity-sensitive risk asset (2022 behaviour and commentary), and instituti…
      ✎ review.factcheck.1 [review by fact-check:retrieval-2026-09-23]: Verdict: 96 of the 97 checked items are correct or inside their stated intervals; one dated sample (h.btc.m49_7) is outside its interval. The authored judgments and regimes were not checked, because no source can check them. # 08 Fact chec…
    - ev.halving_2024 [-20.4, -20.333]: Fourth halving (block subsidy 6.25 to 3.125 BTC)
      A crypto-native supply event, not monetary; kept for competing explanations.
      ✎ general.event_record.ev.halving_2024 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.note.note.competing_explanations [modeling_review by modeler:claude-opus-5.5]: Competing explanations kept open. (a) Price-of-money reading: BTC responds to the expected policy path and real yields. (b) Quantity reading: BTC responds to reserves and plumbing (the contested 'net liquidity' heuristic). (c) Flow-conduit…
      ✎ also review.factcheck.1 (shown above)
    - ev.qt_taper_2024 [-19, -18.967]: Runoff slowed (Treasury cap $60B to $25B)
      From June 2024 the monthly cap on Treasury runoff falls from $60bn to $25bn, as announced on May 1. The balance sheet keeps shrinking, more slowly.
      ✎ general.event_record.ev.qt_taper_2024 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.context_review.broaderContext [modeling_context_review by modeler:claude-opus-5.5]: The focal crypto processes sit inside dollar conditions set by the Fed and the Treasury. Across the focal window, the rate path (5.50% to 3.75% upper bound), runoff (slowed in June 2024 and April 2025, ended December 2025) and plumbing shi…
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.yen_carry_unwind_2024 [-17.032, -16.806]: Bank of Japan hike and global carry-trade unwind
      A non-US monetary shock transmitted through leverage; recorded as context, not modeled as a US process.
      ✎ general.event_record.ev.yen_carry_unwind_2024 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.broaderContext, review.factcheck.1 (shown above)
    - ev.fed_cuts_2024 [-15.433, -12.419]: 100bp of cuts from 5.50% to 4.50% upper bound
      The Fed cuts 50bp on 2024-09-18, 25bp on November 7 and 25bp on December 18, taking the upper bound from 5.50% to 4.50%. These are the first cuts since 2020, after fourteen months at the plateau. They overlap the election and the late-2024 rally, so the 2024 assessment has to separate the monetary share from the crypto-policy share.
      ✎ general.event_record.ev.fed_cuts_2024 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.note.note.competing_explanations, general.context_review.broaderContext, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.us_election_2024 [-13.867, -13.833]: US election won by a crypto-favourable administration
      A regulatory-expectations shock, not monetary; a major competing explanation for the late-2024 rally.
      ✎ general.event_record.ev.us_election_2024 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.note.note.competing_explanations, review.factcheck.1 (shown above)
    - ev.debt_limit_2025_tga_drawdown [-11.968, -5.903]: Debt limit reinstated; TGA drawn down under extraordinary measures
      The TGA drawdown added reserves, a liquidity-adding plumbing shift independent of the policy rate.
      ✎ general.event_record.ev.debt_limit_2025_tga_drawdown [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.broaderContext, review.factcheck.1 (shown above)
    - ev.strategic_btc_reserve_eo [-9.839, -9.806]: Executive order establishing a US Strategic Bitcoin Reserve
      On 2025-03-06 the President signs an executive order establishing a Strategic Bitcoin Reserve and a US Digital Asset Stockpile. It is a crypto-policy event, not a monetary one, and belongs to the latest of Bitcoin's dated meanings in the model, BTC as an institutional allocation.
      ✎ general.event_record.ev.strategic_btc_reserve_eo [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.concept.concept.btc_as_institutional_allocation, general.context_review.conceptVariation, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.qt_taper_2025 [-9, -8.967]: Runoff slowed further (Treasury cap $25B to $5B)
      From April 2025 the monthly cap on Treasury runoff falls again, from $25bn to $5bn, as announced on March 19. Treasury runoff nearly stops; runoff ends entirely on 2025-12-01.
      ✎ general.event_record.ev.qt_taper_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.broaderContext, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.tariff_shock_2025 [-8.967, -8.7]: Broad tariff announcement and risk-asset selloff; dollar weakens
      The reciprocal-tariff order of 2025-04-02 sets off a broad selloff in risk assets. The dollar index falls from 103.81 on April 2 to 99.78 on April 11, and BTC closes at $76,351 on April 8. It is a trade shock rather than a US monetary one: the dollar weakened and BTC fell at the same time.
      ✎ general.event_record.ev.tariff_shock_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.broaderContext, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.obbba_tga_rebuild_2025 [-5.903, -2]: Debt limit raised by $5T; TGA rebuilt as ON RRP is nearly exhausted
      A liquidity-draining plumbing shift: with ON RRP near zero, the rebuild drew down bank reserves.
      ✎ general.event_record.ev.obbba_tga_rebuild_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.broaderContext, review.factcheck.1 (shown above)
    - ev.genius_act [-5.452, -5.419]: GENIUS Act signed (federal payment-stablecoin framework)
      The GENIUS Act, the federal framework for payment stablecoins, is signed on 2025-07-18. It writes into law the reserve composition that fiat-backed issuers already used, mainly short Treasury bills, so stablecoin growth adds steady demand for bills. It is a crypto-policy event on the stablecoin conduit.
      ✎ general.event_record.ev.genius_act [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.note.note.feedback_into_context [modeling_review by modeler:claude-opus-5.5]: Feedback from the crypto sector into the enclosing system: fiat-backed stablecoin issuers invest reserves mainly in short Treasury bills, and the GENIUS Act writes that reserve composition into law. Stablecoin growth therefore adds structu…
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.fed_cuts_2025 [-3.467, -0.677]: 75bp of cuts from 4.50% to 3.75% upper bound (September-December 2025)
      The Fed cuts 25bp each on 2025-09-17, October 29 and December 10, taking the upper bound from 4.50% to 3.75%. Easing resumes after nine months on hold. The October and December cuts fall inside the Q4 drawdown, which the model keeps as an open anomaly.
      ✎ general.event_record.ev.fed_cuts_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.note.note.q4_2025_anomaly [modeling_review by modeler:claude-opus-5.5]: Q4 2025 anomaly: the policy rate was cut twice more and runoff ended, yet BTC fell from about $126K to about $80-90K. Candidate explanations, unresolved: the October leverage flush; ETF outflows as TradFi de-risking; reserve scarcity from…
      ✎ also general.context_review.broaderContext, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.gov_shutdown_2025 [-3, -1.6]: Federal government shutdown (43 days)
      Delayed official data. Its liquidity effect through Treasury cash flows is not modeled.
      ✎ general.event_record.ev.gov_shutdown_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also review.factcheck.1 (shown above)
    - ev.btc_ath_oct_2025 [-2.839, -2.806]: BTC all-time high near $126K
      BTC reaches its all-time high, an intraday $126,296 on 2025-10-06, four days before the liquidation cascade. Cumulative US spot ETP net inflows peak three days later, at about $62.7bn on October 9.
      ✎ general.event_record.ev.btc_ath_oct_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.liquidation_cascade_oct_2025 [-2.71, -2.645]: Largest recorded crypto liquidation cascade (about $19B) after a US-China tariff threat
      On October 10-11, 2025, after a threat of 100% US tariffs on China, more than $19bn of leveraged crypto positions are liquidated, the largest cascade on record; CoinGlass estimates that undisclosed liquidations put the true total at $30-40bn. It flushes the leverage built in the rally, the first candidate explanation for the Q4 drawdown.
      ✎ general.event_record.ev.liquidation_cascade_oct_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.note.note.q4_2025_anomaly, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.repo_pressure_qt_end_2025 [-2.097, -1]: Repo pressure and record Standing Repo Facility use; runoff ends 2025-12-01
      As the TGA rebuild drains reserves, funding tightens: on 2025-10-31 banks draw $50.35bn from the Standing Repo Facility, the most since it began in 2021. The FOMC statement of October 29 ends balance-sheet runoff on December 1. Reserve scarcity is one of the unresolved candidate explanations for the Q4 drawdown.
      ✎ general.event_record.ev.repo_pressure_qt_end_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.note.note.q4_2025_anomaly, general.context_review.broaderContext, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.btc_drawdown_q4_2025 [-2.839, 0]: BTC falls about 30-35% from its October high despite rate cuts and the end of runoff
      An anomaly for a simple 'easing lifts crypto' account: monetary conditions eased while ETF flows turned negative, leverage was flushed and treasury-company premia compressed.
      ✎ general.event_record.ev.btc_drawdown_q4_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.note.note.q4_2025_anomaly, review.factcheck.1 (shown above)
    - ev.reserve_mgmt_purchases_2025 [-0.645, 0]: Reserve-management purchases of Treasury bills begin (moderate confidence)
      The Fed framed these as technical reserve management, not a change in stance. Whether markets read them as easing is a separate question.
      ✎ u.factcheck.summary [modeling_review by meaning-model-maintainer]: Retrieval check of the recalled history (2026-09-23), done after the run by a fact-checking agent with web retrieval and recorded by the maintainer. It checked 97 items against primary or standard public sources: 9 cutoff values, 56 numeri…
      ✎ general.event_record.ev.reserve_mgmt_purchases_2025 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also review.factcheck.1 (shown above)
  - general.lifecycle.ref.bitcoin: Genesis block 2009-01-03; continuing
    Bitcoin exists as a network and an asset from the genesis block on 2009-01-03 to beyond the cutoff. BTC's dollar price is the model's outcome process.
    ✎ also maintainer.descriptions (shown above)
  - general.lifecycle.ref.usd_stablecoins: From 2014 (Tether) to the cutoff and beyond
    Fiat-backed USD stablecoins exist as a class from Tether's start in 2014 to beyond the cutoff. Their supply is one of the two dollar conduits into crypto, and their issuers hold reserves mainly in short Treasury bills.
    ✎ also maintainer.descriptions (shown above)
  - general.lifecycle.ref.us_spot_btc_etps: Trading from 2024-01-11; continuing
    US-listed spot bitcoin ETPs trade from 2024-01-11 onward. Their net flows are the second dollar conduit, the regulated route from traditional finance into spot BTC.
    ✎ also maintainer.descriptions (shown above)
  - general.lifecycle.ref.crypto_derivatives: Continuing across the modeled horizon
    Crypto derivatives venues, offshore perpetual swaps and CME futures taken as one leverage collective, operate across the whole horizon. They are the model's leverage amplifier: leverage builds in rallies and is flushed in failures and cascades, as in 2022 and October 2025.
    ✎ also maintainer.descriptions (shown above)
  - general.lifecycle.ref.corporate_treasuries: From August 2020 (first large corporate treasury purchases) to the cutoff
    Listed companies hold BTC as a treasury asset from the first large purchases in August 2020 to the cutoff: Strategy, and in 2025 a wave of digital-asset-treasury firms. Their buying is the corporate-treasury conduit, which Jev's Cuts give almost nothing; the modeler recorded a disagreement.
    ✎ also maintainer.descriptions (shown above)
  - ev.era.qe_origin_2008_2014 [-207.533, -134.097]: Post-crisis zero-rate and QE era in which Bitcoin was created (Lehman failure 2008-09-15 to end of QE3 2014-10-29)
    Enduring context: Bitcoin's founding framing formed against bank bailouts and the first QE. The model has no numerical series for this era.
    ✎ general.event_record.ev.era.qe_origin_2008_2014 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
    ✎ general.context_review.longerTerm [modeling_context_review by modeler:claude-opus-5.5]: The longer horizon starts with the 2008 crisis because Bitcoin's founding framing formed against bank bailouts and the first QE. That origin is the source of the later 'debasement hedge' reading, which the focal evidence does not support a…
    - ev.bitcoin_whitepaper [-206.032, -206]: Bitcoin whitepaper released
      The paper describing Bitcoin, a peer-to-peer electronic cash system, is posted to the Cryptography mailing list on 2008-10-31, about six weeks after the Lehman failure. It begins the reading of Bitcoin as money outside the banks, the first of Bitcoin's four dated monetary meanings in the model.
      ✎ general.event_record.ev.bitcoin_whitepaper [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.concept.concept.btc_as_p2p_cash_alternative [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
      ✎ also general.context_review.conceptVariation, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.fed_qe1_zlb_2008 [-205.2, -204.484]: Fed announces first large-scale asset purchases and cuts to 0-0.25%
      On 2008-11-25 the Fed announces its first large-scale asset purchases: up to $100bn of GSE debt and $500bn of mortgage-backed securities. On 2008-12-16 it cuts the target range to 0-0.25%. This opens the zero-rate, balance-sheet era in which Bitcoin was created; the model keeps no numerical series for it.
      ✎ general.event_record.ev.fed_qe1_zlb_2008 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.genesis_block [-203.935, -203.903]: Bitcoin genesis block mined
      The first Bitcoin block, block 0, is mined with the timestamp 2009-01-03 18:15 UTC. The network and the BTC supply begin here.
      ✎ general.event_record.ev.genesis_block [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.concept.concept.btc_as_p2p_cash_alternative, general.context_review.conceptVariation, maintainer.descriptions, review.factcheck.1 (shown above)
  - ev.era.pandemic_easing_2020_2022 [-69.935, -45.516]: Pandemic easing: zero rates and open-ended purchases (2020-03-03 to the first hike on 2022-03-16)
    Fed assets rose from about $4.2T to about $9T. USD stablecoin supply grew from about $5B to about $180B, and BTC rose to about $69K (Nov 2021). The stablecoin and leverage conduits carried easy dollar conditions into crypto before any ETF existed.
    ✎ general.event_record.ev.era.pandemic_easing_2020_2022 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
    ✎ also general.context_review.longerTerm (shown above)
    - ev.fed_zlb_qe_2020 [-69.935, -69.258]: Emergency cuts to 0-0.25% and open-ended asset purchases
      In March 2020 the Fed cuts 50bp on March 3, cuts to 0-0.25% on March 15 with at least $500bn of Treasury and $200bn of mortgage-backed purchases, and on March 23 makes the purchases open-ended, in the amounts needed. Its total assets then grow from about $4.2T to about $9T. This is the easing that the 2020-2021 assessment divides among the conduits.
      ✎ general.event_record.ev.fed_zlb_qe_2020 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.concept.concept.btc_as_debasement_hedge [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
      ✎ also general.context_review.longerTerm, general.context_review.conceptVariation, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.btc_ath_2021 [-49.7, -49.667]: BTC all-time high near $69K
      BTC reaches the high of the easy-money cycle, an intraday $69,000 on 2021-11-10. The record daily close came two days earlier, about $67,500 on November 8. The model's sample dated November 10 records that close; the close on the 10th was about $64,800. The first hike follows four months later.
      ✎ general.event_record.ev.btc_ath_2021 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
  - ev.era.tightening_2022_2023 [-45.516, -24]: Tightening and restrictive plateau: hikes, runoff and crypto credit failures (2022-03-16 to 2023-12-31)
    525bp of hikes and runoff coincided with the collapse of crypto credit (Terra, Celsius, FTX), falling stablecoin supply and a BTC low near $15.5K. From mid-2023 the TGA rebuild was funded by bills that drained ON RRP rather than reserves.
    ✎ general.event_record.ev.era.tightening_2022_2023 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
    ✎ also general.context_review.longerTerm (shown above)
    - ev.fed_first_hike_2022 [-45.516, -45.484]: First hike of the 2022 cycle
      The Fed raises the target range from 0-0.25% to 0.25-0.50% on 2022-03-16, effective the next day. It is the first of the hikes that take the upper bound to 5.50% by July 2023, and it ends the pandemic-easing era.
      ✎ general.event_record.ev.fed_first_hike_2022 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ general.concept.concept.btc_as_liquidity_risk_asset [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
      ✎ also general.context_review.conceptVariation, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.terra_collapse [-43.742, -43.516]: Terra's UST loses its peg; LUNA collapses
      Terra's algorithmic stablecoin UST slips below its peg on 2022-05-07 and breaks it on May 9, falling as low as $0.65; by May 16 it trades near $0.11 and LUNA is near zero. UST was not a member of the fiat-backed conduit. Its collapse is the first of 2022's three crypto credit failures, before Celsius and Three Arrows, then FTX.
      ✎ general.event_record.ev.terra_collapse [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.longerTerm, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.qt_start_2022 [-43, -42.967]: Balance-sheet runoff begins
      Balance-sheet runoff begins on 2022-06-01, as planned on May 4: the Fed stops reinvesting part of its maturing securities, and its total assets begin to fall. Runoff is the quantity side of the 2022 tightening, next to the hikes.
      ✎ general.event_record.ev.qt_start_2022 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.celsius_3ac_2022 [-42.6, -41.581]: Celsius and Three Arrows Capital fail
      Crypto credit fails in sequence: Celsius pauses withdrawals on 2022-06-12, a British Virgin Islands court orders Three Arrows Capital into liquidation on June 27, and Celsius files for Chapter 11 on July 13. Leverage built in the easy years unwinds; the model records the failures on its leverage regime.
      ✎ general.event_record.ev.celsius_3ac_2022 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.ftx_collapse [-37.833, -37.633]: FTX collapses and files for bankruptcy
      After a run from November 6 to 10, 2022, the FTX exchange files for Chapter 11 on November 11. BTC closes near its cycle low, about $15,800, on November 9 and again on November 21. It is the largest of 2022's crypto credit failures, and crypto-internal rather than monetary.
      ✎ general.event_record.ev.ftx_collapse [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.concept.concept.btc_as_liquidity_risk_asset, general.context_review.longerTerm, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.svb_usdc_depeg_2023 [-33.71, -33.581]: SVB fails; USDC depegs; federal backstop and BTFP
      The backstop reversed the depeg; the stablecoin conduit's dependence on the banking system became visible.
      ✎ general.event_record.ev.svb_usdc_depeg_2023 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.longerTerm, review.factcheck.1 (shown above)
    - ev.debt_limit_2023_tga_rebuild [-30.933, -27]: Debt limit suspended; TGA rebuilt mostly from bill issuance absorbed by ON RRP
      The Fiscal Responsibility Act, signed 2023-06-03, suspends the debt limit until 2025-01-01. From June 2 to October 2 the Treasury rebuilds its cash account from about $23bn to about $678bn by issuing bills, while ON RRP balances fall from about $2,142bn to $1,366bn. ON RRP fell by more than the TGA rose: cash that had sat in the Fed facility absorbed the bills, so this rebuild spared bank reserves, unlike the rebuild of 2025.
      ✎ general.event_record.ev.debt_limit_2023_tga_rebuild [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also general.context_review.longerTerm, maintainer.descriptions, review.factcheck.1 (shown above)
    - ev.final_hike_2023 [-29.194, -29.161]: Final hike to 5.25-5.50%
      The Fed raises the target range to 5.25-5.50% on 2023-07-26, effective the next day. It is the last hike of the cycle; the rate holds at this plateau until September 2024.
      ✎ general.event_record.ev.final_hike_2023 [event_record by model-builder]: structured record (id, boundary, description, interval, parentEventId, participants, processIds, evidenceType)
      ✎ also maintainer.descriptions, review.factcheck.1 (shown above)

## Processes
- btc.price_usd (USD per BTC, observed): BTC/USD spot price.; initial 88000
  ✎ estimation.f1076ac4026a9d5d066368ea.coordinate.0 [process_estimate by fact-check:retrieval-2026-09-23]: Read from a public source at this date during the retrieval check.
  ✎ general.note.note.data_needed [modeling_review by modeler:claude-opus-5.5]: Data that would replace recollection: weekly H.4.1 total assets; daily ON RRP results; Daily Treasury Statement TGA; daily 10-year TIPS yield and dollar index; issuer-reported stablecoin supply and reserve attestations; ETP daily flows and…
  ✎ hist.traj.btc.price_usd [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of btc.price_usd (USD per BTC), 9 dated values: t=-49.7: 67500; t=-37.333: 15800; t=-23.677: 46500; t=-21.581: 71500; t=-16.871: 54000; t=-12: 93500; t=-8.8: 78000; t=-2.839: 124500; t=-1.333: 84000. Values mark states a…
  ✎ hist.sample.h.btc.m49_7 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2021-11-10 (all-time high then).
  ✎ hist.sample.h.btc.m37_33 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2022-11-21 (cycle low).
  ✎ hist.sample.h.btc.m23_68 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2024-01-11 (ETF launch).
  ✎ hist.sample.h.btc.m21_58 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2024-03-14.
  ✎ hist.sample.h.btc.m16_87 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2024-08-05 (carry unwind).
  ✎ hist.sample.h.btc.m12 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2025-01-01.
  ✎ hist.sample.h.btc.m8_8 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2025-04-07 (tariff selloff).
  ✎ hist.sample.h.btc.m2_84 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2025-10-06 (all-time high).
  ✎ hist.sample.h.btc.m1_33 [process_sampled_value by modeler:claude-opus-5.5]: BTC/USD daily close near 2025-11-21 (drawdown low).
  ✎ u.review.history_samples [modeling_review by modeler:claude-opus-5.5]: Review of the historical samples (modeler). Approved as a record of dated samples, not as verification. The policy-rate path is exact. Balance-sheet, TGA, dollar, real-yield, stablecoin, ETF-flow and price values are approximate and carry…
  ✎ maintainer.observed-series [understanding.decision by maintainer:claude-opus-5-5]: Model revision 5 makes the eight measured series observed processes: BTC's price, cumulative spot-ETP flows, Fed total assets, both stablecoin supplies, the 10-year real yield, the TGA and the dollar index. The builder had made them static…
  ✎ also u.limits.what_not_shown, general.note.note.competing_explanations, general.note.note.q4_2025_anomaly, general.context_review.longerTerm, general.process.btc.price_usd (shown above)
- etps.us_spot_btc_cum_net_flow_usd_bn (USD billion, observed): Cumulative net creations minus redemptions in US spot bitcoin ETPs since 2024-01-11, in dollars at flow dates.; initial 57
  ✎ hist.traj.etps.us_spot_btc_cum_net_flow_usd_bn [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of etps.us_spot_btc_cum_net_flow_usd_bn (USD billion), 3 dated values: t=-12: 35.5; t=-3: 58; t=-2: 61. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.etf.m12 [process_sampled_value by modeler:claude-opus-5.5]: Cumulative net flow into US spot bitcoin ETPs since launch, near 2025-01-01 in USD billion.
  ✎ hist.sample.h.etf.m3 [process_sampled_value by modeler:claude-opus-5.5]: Cumulative net flow into US spot bitcoin ETPs since launch, near 2025-10-01 in USD billion.
  ✎ hist.sample.h.etf.m2 [process_sampled_value by modeler:claude-opus-5.5]: Cumulative net flow into US spot bitcoin ETPs since launch, near 2025-11-01 in USD billion.
  ✎ also general.note.note.competing_explanations, general.note.note.data_needed, general.process.etps.us_spot_btc_cum_net_flow_usd_bn, u.review.history_samples, maintainer.observed-series (shown above)
- fed.total_assets_usd_tn (USD trillion, observed): Total assets on the consolidated Federal Reserve balance sheet (H.4.1).; initial 6.55
  ✎ u.context.revisited [modeling_review by modeler:claude-opus-5.5]: Revisit of the broader-context and longer-term reviews after the local findings. The context review set the US monetary system as the enclosing system, and the 2020-22 history supports that reading for that period. The focal findings chang…
  ✎ estimation.f1076ac4026a9d5d066368ea.coordinate.5 [process_estimate by fact-check:retrieval-2026-09-23]: Read from a public source at this date during the retrieval check.
  ✎ hist.traj.fed.total_assets_usd_tn [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of fed.total_assets_usd_tn (USD trillion), 8 dated values: t=-208: 0.9; t=-134: 4.5; t=-71: 4.2; t=-45: 8.95; t=-24: 7.7; t=-12: 6.85; t=-6: 6.7; t=-2: 6.6. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.fed.m208 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2008-09-01 in USD trillion.
  ✎ hist.sample.h.fed.m134 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2014-11-01 in USD trillion.
  ✎ hist.sample.h.fed.m71 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2020-02-01 in USD trillion.
  ✎ hist.sample.h.fed.m45 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2022-04-01 in USD trillion.
  ✎ hist.sample.h.fed.m24 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2024-01-01 in USD trillion.
  ✎ hist.sample.h.fed.m12 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2025-01-01 in USD trillion.
  ✎ hist.sample.h.fed.m6 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2025-07-01 in USD trillion.
  ✎ hist.sample.h.fed.m2 [process_sampled_value by modeler:claude-opus-5.5]: Fed total assets (H.4.1) near 2025-11-01 in USD trillion.
  ✎ also general.note.note.competing_explanations, general.note.note.data_needed, general.context_review.broaderContext, general.context_review.longerTerm, general.process.fed.total_assets_usd_tn, u.review.history_samples, maintainer.observed-series (shown above)
- judgment.monetary_accommodation_for_crypto (accommodation level (ordinal, -2..+2), static): Authored ordinal judgment of how accommodative US monetary conditions are for crypto-asset liquidity, combining rate level and direction, balance-sheet direction and reserve plumbing. It is not a measurement.; initial 0.99
  ✎ u.estimator.usage [workflow_record by modeler:claude-opus-5.5]: Estimator record (typesafe:jev-1.13.0). Call 1: builder preview, 3 initial questions (1 Score, 2 Choice), 12,155 input and 128 output tokens, about 0.74 s through the relay; applied. Call 2: life_process_estimate, 22 retrospective coordina…
  ✎ general.context_review.authoredJudgments [modeling_context_review by modeler:claude-opus-5.5]: Four interpretive processes need authored scales because no instrument measures them. (1) judgment.monetary_accommodation_for_crypto: a five-level ordinal score from -2 (active tightening, anchor mid-2022) to +2 (lower bound plus open-ende…
  ✎ judg.sample.m.acc.m43 [judgment_sampled_value by modeler:claude-opus-5.5]: Hikes of 50 and 75bp with runoff starting: the -2 anchor.
  ✎ judg.sample.m.acc.m33_5 [judgment_sampled_value by modeler:claude-opus-5.5]: Still hiking with full-pace runoff, but the emergency backstop after SVB temporarily added reserves.
  ✎ judg.sample.m.acc.m27 [judgment_sampled_value by modeler:claude-opus-5.5]: Rate at its peak with runoff at full pace. The TGA rebuild drained ON RRP rather than reserves, and one more hike was still thought possible.
  ✎ judg.sample.m.acc.m24 [judgment_sampled_value by modeler:claude-opus-5.5]: The -1 anchor: restrictive plateau with an ON RRP cushion.
  ✎ judg.sample.m.acc.m15 [judgment_sampled_value by modeler:claude-opus-5.5]: First cut (50bp) and slowed runoff, but the rate was still well above common neutral estimates.
  ✎ judg.sample.m.acc.m9 [judgment_sampled_value by modeler:claude-opus-5.5]: Rate held at 4.50% and runoff nearly stopped. The TGA drawdown under the debt limit was adding reserves.
  ✎ judg.sample.m.acc.m4 [judgment_sampled_value by modeler:claude-opus-5.5]: Rate held and the TGA rebuild drew down reserves once ON RRP was nearly exhausted.
  ✎ judg.sample.m.acc.m2 [judgment_sampled_value by modeler:claude-opus-5.5]: Two cuts and the end of runoff announced, but reserves were scarce enough to cause repo pressure.
  ✎ judg.traj.judgment.monetary_accommodation_for_crypto [sampled_judgment_trajectory by modeler:claude-opus-5.5]: Modeler's retrospective samples of judgment.monetary_accommodation_for_crypto under rubric v1: t=-69: 2; t=-52: 2; t=-43: -2; t=-33.5: -1; t=-27: -1; t=-24: -1; t=-15: -1; t=-9: -1; t=-4: -1; t=-2: 0. At t = 0 the Jev estimate from the bui…
  ✎ u.review.judgment_samples [modeling_review by modeler:claude-opus-5.5]: Review of the retrospective judgment samples (modeler). Across the long horizon the accommodation rank goes +2 (2020-21), -2 (mid-2022), -1 (2023 to mid-2025) and 0 (November 2025). The Jev estimate at t = 0 is about +1. Over the same date…
  ✎ judg.sample.m.acc.m69 [judgment_sampled_value by modeler:claude-opus-5.5]: Lower bound plus open-ended purchases: the +2 anchor itself.
  ✎ judg.sample.m.acc.m52 [judgment_sampled_value by modeler:claude-opus-5.5]: Still at the lower bound with $120B/month purchases before the November 2021 taper. ON RRP absorbing over $1T is a reason for the lower bound of the interval.
  ✎ also general.note.note.q4_2025_anomaly, general.process.judgment.monetary_accommodation_for_crypto (shown above)
- regime.btc_monetary_coupling (category, static): Authored categorical judgment of which relation dominated BTC's response to US dollar conditions over the recent months.; initial flow_dominated
  ✎ judg.traj.regime.btc_monetary_coupling [sampled_judgment_trajectory by modeler:claude-opus-5.5]: Modeler's retrospective samples of regime.btc_monetary_coupling under rubric v1: t=-60: liquidity_coupled_risk_asset; t=-42: liquidity_coupled_risk_asset; t=-30: crypto_native; t=-18: flow_dominated; t=-12: flow_dominated; t=-6: flow_domin…
  ✎ judg.sample.m.cpl.m60 [judgment_sampled_value by modeler:claude-opus-5.5]: Easy money, a stablecoin boom and leverage carried the rally; the debasement-hedge framing ran alongside it.
  ✎ judg.sample.m.cpl.m42 [judgment_sampled_value by modeler:claude-opus-5.5]: Fell with hikes and runoff, together with growth equities.
  ✎ judg.sample.m.cpl.m30 [judgment_sampled_value by modeler:claude-opus-5.5]: Rallied in H1 2023 during continued hikes; the banking-stress bid and June 2023 ETF filings dominated. Hedge-like in March 2023.
  ✎ judg.sample.m.cpl.m18 [judgment_sampled_value by modeler:claude-opus-5.5]: ETF creations dominated H1 2024 while rates stayed on hold.
  ✎ judg.sample.m.cpl.m12 [judgment_sampled_value by modeler:claude-opus-5.5]: Election-driven regulatory expectations worked through ETF and corporate-treasury flows; the rate cuts coincided.
  ✎ judg.sample.m.cpl.m6 [judgment_sampled_value by modeler:claude-opus-5.5]: Record corporate-treasury buying and ETF inflows while the policy rate was on hold.
  ✎ also u.estimator.usage, general.process.regime.btc_monetary_coupling, general.context_review.authoredJudgments, u.review.judgment_samples (shown above)
- regime.crypto_leverage (category, static): Authored categorical judgment of the leverage state in crypto derivatives.; initial deleveraged
  ✎ judg.traj.regime.crypto_leverage [sampled_judgment_trajectory by modeler:claude-opus-5.5]: Modeler's retrospective samples of regime.crypto_leverage under rubric v1: t=-50: elevated; t=-37: deleveraged; t=-22: elevated; t=-16.8: deleveraged; t=-3: elevated; t=-2.6: deleveraged. At t = 0 the Jev estimate from the build applies. O…
  ✎ judg.sample.m.lev.m50 [judgment_sampled_value by modeler:claude-opus-5.5]: Record open interest and high funding near the 2021 top.
  ✎ judg.sample.m.lev.m37 [judgment_sampled_value by modeler:claude-opus-5.5]: After the failures of Terra, Celsius, 3AC and FTX.
  ✎ judg.sample.m.lev.m22 [judgment_sampled_value by modeler:claude-opus-5.5]: Very high funding during the run to the March 2024 high.
  ✎ judg.sample.m.lev.m16_8 [judgment_sampled_value by modeler:claude-opus-5.5]: Just after the carry-trade unwind flushed positions.
  ✎ judg.sample.m.lev.m3 [judgment_sampled_value by modeler:claude-opus-5.5]: Near-record open interest. 'Extreme' would need hindsight about the 2025-10-10 cascade, which the rubric's 'immediately before' clause invites; judged without it.
  ✎ judg.sample.m.lev.m2_6 [judgment_sampled_value by modeler:claude-opus-5.5]: Just after the largest recorded liquidation cascade.
  ✎ also u.estimator.usage, general.note.note.q4_2025_anomaly, general.context_review.longerTerm, general.context_review.authoredJudgments, general.process.regime.crypto_leverage, u.review.judgment_samples (shown above)
- regime.us_crypto_policy (category, static): Authored categorical judgment of the US federal policy stance toward crypto conduits; it gates whether conduits such as ETPs and regulated stablecoins can exist.; initial accommodative_legislated
  ✎ general.process.regime.us_crypto_policy [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial, judgmentQuestion)
  ✎ hist.traj.regime.us_crypto_policy [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of regime.us_crypto_policy (category), 3 dated values: t=-30: enforcement_hostile; t=-18: mixed_uncertain; t=-5: accommodative_legislated. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.pol.m30 [process_sampled_value by modeler:claude-opus-5.5]: US federal policy stance toward crypto conduits near 2023-07-01 (modeler rubric v1).
  ✎ hist.sample.h.pol.m18 [process_sampled_value by modeler:claude-opus-5.5]: US federal policy stance toward crypto conduits near 2024-07-01 (modeler rubric v1).
  ✎ hist.sample.h.pol.m5 [process_sampled_value by modeler:claude-opus-5.5]: US federal policy stance toward crypto conduits near 2025-08-01 (modeler rubric v1).
  ✎ maintainer.factcheck-input [understanding.revision by maintainer:claude-opus-5-5]: Correction to the review record review.factcheck.1: its input listed 59 dated samples, not 56. The checker checked the 56 numeric ones. The other three are dated policy-regime categories (h.pol.m30, h.pol.m18 and h.pol.m5), authored judgme…
  ✎ also u.context.revisited, general.context_review.authoredJudgments, u.review.history_samples (shown above)
- stablecoins.usd_pegged_supply_usd_bn (USD billion, observed): Aggregate circulating supply of all USD-pegged stablecoins as totalled by public data aggregators: fiat-backed USDT and USDC (roughly 85-90% of the total in 2025) plus crypto-collateralised and synthetic dollars. UST is counted until its M…; initial 305
  ✎ estimation.f1076ac4026a9d5d066368ea.coordinate.3 [process_estimate by fact-check:retrieval-2026-09-23]: Read from a public source at this date during the retrieval check.
  ✎ hist.traj.stablecoins.usd_pegged_supply_usd_bn [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of stablecoins.usd_pegged_supply_usd_bn (USD billion), 8 dated values: t=-72: 5.5; t=-45: 185; t=-27: 123; t=-24: 135; t=-12: 203; t=-6: 250; t=-3: 295; t=0: 305. Values mark states at dates; nothing is implied between t…
  ✎ hist.sample.h.sc.m72 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2020-01-01 in USD billion.
  ✎ hist.sample.h.sc.m45 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2022-04-01 (includes UST) in USD billion.
  ✎ hist.sample.h.sc.m27 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2023-10-01 in USD billion.
  ✎ hist.sample.h.sc.m24 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2024-01-01 in USD billion.
  ✎ hist.sample.h.sc.m12 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2025-01-01 in USD billion.
  ✎ hist.sample.h.sc.m6 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2025-07-01 in USD billion.
  ✎ hist.sample.h.sc.m3 [process_sampled_value by modeler:claude-opus-5.5]: Aggregate USD-pegged stablecoin supply near 2025-10-01 in USD billion.
  ✎ hist.sample.h.sc.t0.pegged [process_sampled_value by modeler:claude-opus-5.5]: All-USD-pegged stablecoin supply at the cutoff (revision 1b process; the world head has no claim for it).
  ✎ also u.revision.stablecoin_definition, u.context.revisited, u.review.history_samples, maintainer.observed-series (shown above)
- stablecoins.usd_supply_usd_bn (USD billion, observed): Aggregate circulating supply of fiat-backed USD stablecoins.; initial 270
  ✎ estimation.f1076ac4026a9d5d066368ea.coordinate.4 [process_estimate by fact-check:retrieval-2026-09-23]: Read from a public source at this date during the retrieval check.
  ✎ hist.traj.stablecoins.usd_supply_usd_bn [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of stablecoins.usd_supply_usd_bn (USD billion), 1 dated values: t=0: 270. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.scfiat.t0 [process_sampled_value by modeler:claude-opus-5.5]: Fiat-backed-only stablecoin supply at the cutoff, revised estimate replacing the misfiled 305.
  ✎ also u.revision.stablecoin_definition, general.note.note.competing_explanations, general.note.note.feedback_into_context, general.note.note.data_needed, general.context_review.longerTerm, general.process.stablecoins.usd_supply_usd_bn, u.review.history_samples, maintainer.observed-series (shown above)
- us.fed_funds_upper_pct (percent per annum, observed): Upper bound of the FOMC federal funds target range.; initial 3.75
  ✎ hist.sample.h.ffr.m84 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2019-01-01.
  ✎ hist.sample.h.ffr.m72 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2020-01-01.
  ✎ hist.sample.h.ffr.m69 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2020-04-01.
  ✎ hist.sample.h.ffr.m46 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2022-03-01.
  ✎ hist.sample.h.ffr.m36 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2023-01-01.
  ✎ hist.sample.h.ffr.m24 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2024-01-01.
  ✎ hist.sample.h.ffr.m15 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2024-10-01.
  ✎ hist.sample.h.ffr.m12 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2025-01-01.
  ✎ hist.sample.h.ffr.m3 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2025-10-01.
  ✎ hist.sample.h.ffr.m2 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2025-11-01.
  ✎ hist.traj.us.fed_funds_upper_pct [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of us.fed_funds_upper_pct (percent per annum), 12 dated values: t=-204: 0.25; t=-120: 0.5; t=-84: 2.5; t=-72: 1.75; t=-69: 0.25; t=-46: 0.25; t=-36: 4.5; t=-24: 5.5; t=-15: 5.0; t=-12: 4.5; t=-3: 4.25; t=-2: 4.0. Values…
  ✎ hist.sample.h.ffr.m204 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2009-01-01.
  ✎ hist.sample.h.ffr.m120 [process_sampled_value by modeler:claude-opus-5.5]: Upper bound of the FOMC target range in force on 2016-01-01.
  ✎ also general.context_review.broaderContext, general.process.us.fed_funds_upper_pct, general.context_review.longerTerm, u.review.history_samples (shown above)
- us.real_yield_10y_pct (percent per annum, observed): 10-year TIPS yield, used as a proxy for the real discount rate on long-duration assets.; initial 1.85
  ✎ general.process.us.real_yield_10y_pct [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
  ✎ hist.traj.us.real_yield_10y_pct [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of us.real_yield_10y_pct (percent per annum), 5 dated values: t=-50: -1.0; t=-27: 2.3; t=-24: 1.75; t=-12: 2.2; t=-6: 2.0. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.ry.m50 [process_sampled_value by modeler:claude-opus-5.5]: 10-year TIPS real yield near 2021-11-01 in percent.
  ✎ hist.sample.h.ry.m27 [process_sampled_value by modeler:claude-opus-5.5]: 10-year TIPS real yield near 2023-10-01 in percent.
  ✎ hist.sample.h.ry.m24 [process_sampled_value by modeler:claude-opus-5.5]: 10-year TIPS real yield near 2024-01-01 in percent.
  ✎ hist.sample.h.ry.m12 [process_sampled_value by modeler:claude-opus-5.5]: 10-year TIPS real yield near 2025-01-01 in percent.
  ✎ hist.sample.h.ry.m6 [process_sampled_value by modeler:claude-opus-5.5]: 10-year TIPS real yield near 2025-07-01 in percent.
  ✎ also general.note.note.competing_explanations, general.note.note.data_needed, general.context_review.broaderContext, u.review.history_samples, maintainer.observed-series (shown above)
- us.tga_usd_bn (USD billion, observed): Treasury General Account balance at the Federal Reserve.; initial 850
  ✎ estimation.f1076ac4026a9d5d066368ea.coordinate.1 [process_estimate by fact-check:retrieval-2026-09-23]: Read from a public source at this date during the retrieval check.
  ✎ estimation.f1076ac4026a9d5d066368ea.coordinate.2 [process_estimate by fact-check:retrieval-2026-09-23]: Read from a public source at this date during the retrieval check.
  ✎ hist.traj.us.tga_usd_bn [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of us.tga_usd_bn (USD billion), 6 dated values: t=-31: 40; t=-27: 670; t=-24: 750; t=-12: 720; t=-6: 350; t=-2: 950. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.tga.m31 [process_sampled_value by modeler:claude-opus-5.5]: Treasury General Account balance near 2023-06-01 in USD billion.
  ✎ hist.sample.h.tga.m27 [process_sampled_value by modeler:claude-opus-5.5]: Treasury General Account balance near 2023-10-01 in USD billion.
  ✎ hist.sample.h.tga.m24 [process_sampled_value by modeler:claude-opus-5.5]: Treasury General Account balance near 2024-01-01 in USD billion.
  ✎ hist.sample.h.tga.m12 [process_sampled_value by modeler:claude-opus-5.5]: Treasury General Account balance near 2025-01-01 in USD billion.
  ✎ hist.sample.h.tga.m6 [process_sampled_value by modeler:claude-opus-5.5]: Treasury General Account balance near 2025-07-01 in USD billion.
  ✎ hist.sample.h.tga.m2 [process_sampled_value by modeler:claude-opus-5.5]: Treasury General Account balance near 2025-11-01 in USD billion.
  ✎ also general.note.note.data_needed, general.context_review.broaderContext, general.process.us.tga_usd_bn, u.review.history_samples, maintainer.observed-series (shown above)
- usd.dxy_index (index points (March 1973 = 100), observed): ICE US Dollar Index: value of the dollar against six major currencies.; initial 98.5
  ✎ general.process.usd.dxy_index [process_initial_value by modeler:claude-opus-5.5]: structured record (meaning, unit, referenceFrame, type, initial)
  ✎ hist.sample.h.dxy.m6 [process_sampled_value by modeler:claude-opus-5.5]: ICE US Dollar Index level near 2025-07-01.
  ✎ hist.traj.usd.dxy_index [sampled_trajectory by modeler:claude-opus-5.5]: Sampled trajectory of usd.dxy_index (index points), 4 dated values: t=-39: 112; t=-24: 101.5; t=-12: 108.5; t=-6: 97. Values mark states at dates; nothing is implied between them.
  ✎ hist.sample.h.dxy.m39 [process_sampled_value by modeler:claude-opus-5.5]: ICE US Dollar Index level near 2022-10-01.
  ✎ hist.sample.h.dxy.m24 [process_sampled_value by modeler:claude-opus-5.5]: ICE US Dollar Index level near 2024-01-01.
  ✎ hist.sample.h.dxy.m12 [process_sampled_value by modeler:claude-opus-5.5]: ICE US Dollar Index level near 2025-01-01.
  ✎ also general.note.note.data_needed, general.context_review.broaderContext, u.review.history_samples, maintainer.observed-series (shown above)

## Concepts
- concept.access_adoption_demand (Access and adoption demand): New demand for BTC made possible by regulated access wrappers (US spot ETPs) and corporate-treasury adoption. It is a driver distinct from US monetary conditions, from the US crypto policy that permits it, and from crypto-internal dynamics.
  ✎ also u.revision.driver_vocabulary_v2 (shown above)
- concept.btc_as_debasement_hedge (Debasement hedge (2020)): Macro-investor framing of BTC as protection against monetary expansion, prominent during 2020 QE.
  ✎ general.abstract_cut.acut.btc_meaning.framings [conceptual_decomposition by model-builder]: How did actors frame BTC's relation to dollar monetary conditions at different dates?
  ✎ also general.concept.concept.btc_as_debasement_hedge, general.context_review.conceptVariation (shown above)
- concept.btc_as_institutional_allocation (Institutional allocation (2024-25)): Framing of BTC as an ETF-held portfolio allocation and, from March 2025, a US strategic reserve asset.
  ✎ also general.concept.concept.btc_as_institutional_allocation, general.abstract_cut.acut.btc_meaning.framings, general.context_review.conceptVariation (shown above)
- concept.btc_as_liquidity_risk_asset (Liquidity-sensitive risk asset (2022)): Behaviour-based framing of BTC as a high-beta asset that falls with tightening and rises with easing, prominent in 2022.
  ✎ also general.concept.concept.btc_as_liquidity_risk_asset, general.abstract_cut.acut.btc_meaning.framings, general.context_review.conceptVariation (shown above)
- concept.btc_as_p2p_cash_alternative (P2P cash alternative (2008-09)): Founding framing: electronic cash without trusted intermediaries, launched against bank bailouts and the first QE.
  ✎ also general.concept.concept.btc_as_p2p_cash_alternative, general.abstract_cut.acut.btc_meaning.framings, general.context_review.conceptVariation (shown above)
- concept.btc_monetary_meaning (Bitcoin's monetary meaning): What BTC is taken to be in relation to dollar monetary conditions, as framed by particular actors at particular dates.
  ✎ general.concept.concept.btc_monetary_meaning [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also u.context.revisited, general.abstract_cut.acut.btc_meaning.framings, general.context_review.conceptVariation (shown above)
- concept.corporate_treasury_conduit (Corporate-treasury conduit): Equity- and convertible-funded corporate BTC purchases, sensitive to equity risk appetite and funding conditions.
  ✎ general.concept.concept.corporate_treasury_conduit [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ general.abstract_cut.acut.channel.conduits [conceptual_decomposition by model-builder]: By which route does a change in dollar conditions reach BTC's price?
- concept.dollar_exchange_value (Dollar exchange value): The dollar's value against other currencies, which conditions global dollar funding and offshore demand for dollar tokens.
  ✎ general.concept.concept.dollar_exchange_value [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ general.abstract_cut.acut.dollar_liquidity.instruments [conceptual_decomposition by model-builder]: Through which instrument does a given change in dollar liquidity arise?
- concept.dollar_liquidity (Dollar liquidity): The ease and price with which dollar funding and balance-sheet capacity are available to hold risk assets, as shaped by US monetary policy, Treasury cash management and the dollar's exchange value.
  ✎ general.concept.concept.dollar_liquidity [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ general.abstract_cut.acut.dollar_liquidity.price_quantity [conceptual_decomposition by model-builder]: Is a crypto response better read as a response to the price of dollars or to their quantity?
  ✎ general.context_review.conceptualStructure [modeling_context_review by modeler:claude-opus-5.5]: Opened concept.dollar_liquidity under two overlapping lenses: instruments (rate, reserves, Treasury/RRP plumbing, dollar) and price versus quantity. The main competing explanations of crypto's macro sensitivity split along the second lens.…
  ✎ also general.abstract_cut.acut.dollar_liquidity.instruments, general.context_review.conceptVariation (shown above)
- concept.etf_conduit (ETF conduit): Net creations and redemptions in US spot bitcoin ETPs carrying TradFi allocators' decisions into spot BTC demand (from 2024-01-11).
  ✎ general.concept.concept.etf_conduit [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.channel.conduits, general.context_review.conceptualStructure (shown above)
- concept.leverage_amplifier (Leverage amplifier): Crypto derivatives leverage whose funding cost and margin respond to dollar rates and risk appetite, amplifying price moves through liquidations.
  ✎ general.concept.concept.leverage_amplifier [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.channel.conduits, general.context_review.conceptualStructure (shown above)
- concept.liquidity_price_side (Price of money): The price-side reading of dollar liquidity: policy rate, expected path and real yields (discount rate).
  ✎ general.concept.concept.liquidity_price_side [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.dollar_liquidity.price_quantity (shown above)
- concept.liquidity_quantity_side (Quantity of money): The quantity-side reading of dollar liquidity: reserves, TGA and ON RRP balances, and stablecoin float as an on-chain dollar stock.
  ✎ general.concept.concept.liquidity_quantity_side [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.dollar_liquidity.price_quantity (shown above)
- concept.policy_rate_path (Policy-rate path): The level and expected path of the federal funds target range: the price of overnight dollars.
  ✎ general.concept.concept.policy_rate_path [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.dollar_liquidity.instruments (shown above)
- concept.reserve_quantity (Reserve quantity): The quantity of bank reserves supplied through Fed asset purchases or runoff (QE/QT).
  ✎ general.concept.concept.reserve_quantity [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.dollar_liquidity.instruments (shown above)
- concept.stablecoin_conduit (Stablecoin conduit): Growth or contraction of on-chain USD tokens acting as settlement liquidity and dry powder on crypto venues.
  ✎ general.concept.concept.stablecoin_conduit [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ general.abstract_cut.acut.stablecoin.roles [conceptual_decomposition by model-builder]: What role is a change in stablecoin supply playing?
  ✎ also general.abstract_cut.acut.channel.conduits, general.context_review.conceptualStructure (shown above)
- concept.stablecoin_offshore_dollar_access (Offshore dollar access): Demand for dollar exposure outside the US banking system (payments, savings in weak-currency economies), sensitive to the dollar's value and local conditions.
  ✎ general.concept.concept.stablecoin_offshore_dollar_access [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.stablecoin.roles (shown above)
- concept.stablecoin_settlement_float (Settlement float): Stablecoin balances held on exchanges and in DeFi as trading collateral and dry powder.
  ✎ general.concept.concept.stablecoin_settlement_float [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.stablecoin.roles (shown above)
- concept.stablecoin_tbill_backing (T-bill backing): Issuer reserves held in short Treasury bills and repo. This ties issuer revenue to the policy rate and makes issuers buyers of bills, a feedback from crypto into Treasury funding.
  ✎ general.concept.concept.stablecoin_tbill_backing [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.stablecoin.roles (shown above)
- concept.transmission_channel (Transmission channel): A conduit or mechanism through which a change in dollar conditions changes the demand for, supply of, or pricing of crypto assets.
  ✎ general.concept.concept.transmission_channel [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.channel.conduits, general.context_review.conceptualStructure (shown above)
- concept.treasury_cash_plumbing (Treasury cash and RRP plumbing): Shifts of liquidity between bank reserves, the Treasury General Account and the ON RRP facility caused by Treasury cash management and money-fund allocation.
  ✎ general.concept.concept.treasury_cash_plumbing [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.dollar_liquidity.instruments (shown above)
- concept.valuation_channel (Valuation channel): Repricing of a non-yielding asset through the real discount rate and risk premium without a specific flow conduit.
  ✎ general.concept.concept.valuation_channel [concept_definition by model-builder]: structured record (id, label, boundary, differentia, stateSchema, directionFamilies, observationMethods, sourceIds)
  ✎ also general.abstract_cut.acut.channel.conduits (shown above)
- opening acut.btc_meaning.framings: concept.btc_monetary_meaning → concept.btc_as_debasement_hedge, concept.btc_as_institutional_allocation, concept.btc_as_liquidity_risk_asset, concept.btc_as_p2p_cash_alternative (Dated-framing lens: competing framings attributed to different actors and dates; overlapping, not parts or shares)
- opening acut.channel.conduits: concept.transmission_channel → concept.corporate_treasury_conduit, concept.etf_conduit, concept.leverage_amplifier, concept.stablecoin_conduit, concept.valuation_channel (Conduit lens: by what route dollars or risk capacity reach crypto prices (overlapping, not exclusive))
- opening acut.dollar_liquidity.instruments: concept.dollar_liquidity → concept.dollar_exchange_value, concept.policy_rate_path, concept.reserve_quantity, concept.treasury_cash_plumbing (Instrument lens: which policy or plumbing instrument changes dollar liquidity)
- opening acut.dollar_liquidity.price_quantity: concept.dollar_liquidity → concept.liquidity_price_side, concept.liquidity_quantity_side (Price-versus-quantity lens; it overlaps the instrument lens, and the two competing explanations of crypto's macro sensitivity split along it)
- opening acut.stablecoin.roles: concept.stablecoin_conduit → concept.stablecoin_offshore_dollar_access, concept.stablecoin_settlement_float, concept.stablecoin_tbill_backing (Functional-role lens: why stablecoin supply changes; supply growth alone does not reveal crypto risk appetite)

## Understanding
- estimation.f1076ac4026a9d5d066368ea.understanding (unattributed): 1 reflection, 1 record
  ✎ estimation.f1076ac4026a9d5d066368ea.review [process_estimation_review by meaning-model-maintainer]: Six values read from primary or standard public sources on 2026-09-23 during the retrieval check of the recalled history. One corrects a recalled sample outside its interval: the 2021-11-10 close was 64,756, not 67,500, which is the record…
- general.node.understanding (model-builder): 23 reflections, 30 records
  ✎ also u.disagreement.channel_cuts, u.reading.channel_mix_shift, u.review.channel_cuts, u.revision.driver_vocabulary_v2, u.comparison.driver_v1_v2 (shown above)
- review.fact-check-retrieval-2026-09-23 (fact-check:retrieval-2026-09-23): 1 reflection, 1 record
  ✎ also review.factcheck.1 (shown above)
- understanding.maintainer-claude-opus-5-5 (maintainer:claude-opus-5-5): 5 reflections, 5 records
  ✎ maintainer.factcheck-answer [understanding.revision by maintainer:claude-opus-5-5]: How the retrieval check was answered. Revision 5 made the measured series observable. Graph revisions 12 and 13 filed six retrieved values as reports, one correcting the November 2021 sample, and linked each to the recalled value it checks…
  ✎ also maintainer.conditioning, maintainer.descriptions, maintainer.factcheck-input, maintainer.observed-series (shown above)

## Documents
- general.node.scope: How do changes in US monetary conditions (the policy-rate path, Fed balance-sheet and reserve plumbing through runoff, ON RRP and the TGA, and the dollar) reach Bitcoin's price through two dollar conduits, stablecoin supply and US spot bit… (0 rendered passages, 0 words in the graph)
