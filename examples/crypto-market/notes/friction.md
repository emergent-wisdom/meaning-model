# Friction log

Each item: what happened, what I did, what would have helped. Error messages are quoted exactly.

## F1. The start prompt picks a purpose silently, and no purpose fits explanatory modeling

- What happened: `life_general_modeling_start` fetched without arguments begins "Begin a
  observation Meaning Model modeling session in first_use mode." The article is wrong ("a
  observation"), and the text does not say that `observation` was a default or what the other
  purposes would change. `life_modeling_context.purpose` offers creative_story,
  source_reconstruction, person_reflection, observation, forecasting and counterfactual. My task
  is explanatory: an account of transmission channels built from recalled public records. It
  is not a measurement stream, and it is explicitly not a forecast.
- What I did: used `observation`, since reports keep their original authority under it, and
  stated in the model and notes that the account is explanatory, illustrative and not a forecast.
- What would have helped: the prompt saying "purpose defaulted to observation; pass `purpose`
  to change it", plus guidance (or an `explanation`/`analysis` purpose) for explanatory
  models built from the modeler's own recalled knowledge.

## F2. The served Meaning Model paper is missing its included files

- What happened: `life-sim://theory/meaning-model` is raw LaTeX that loads
  `\input{includes/interface-blocks}`, `\input{includes/conceptual-decomposition}` and
  `\input{includes/book-trajectory-figures}`, and uses `\MMCoreSummary` (line 308) and
  `\MMCoreSchema` (line 345). None of these are in the resource. The "minimized core" box,
  the core record schema the text relies on, and three figures could not be read.
- What I did: relied on the prose definitions and the minimal example payloads.
- What would have helped: serving the paper with its includes expanded, or listing the
  include files as separate resources.

## F3. No validate-only builder mode, so I made a dry-run copy to protect the Jev budget

- What happened: `life_world_model_build` validates only when previewed, and a preview with
  `initialEstimate` questions calls Jev. To avoid spending one of my three estimator calls on a
  scaffold that might fail validation, I previewed a copy with the three estimate questions
  removed. That copy then failed a gate I had not known about:
  "authoredJudgments represented requires a referenced numeric estimate process with
  initialEstimate or an explicit judgmentQuestion; measurements alone do not establish an
  authored judgment scale." A categorical judgment with a `judgmentQuestion`
  (`regime.us_crypto_policy`) does not satisfy it. Only a numeric process counts.
- What I did: gave the dry copy a placeholder numeric `judgmentQuestion` (never applied).
  The second dry preview passed (seq 37, `estimator: null`), and I then ran the real preview.
- What would have helped: a `validateOnly: true` flag that runs every structural check without
  the provider, and a guide note that the authored-judgment gate needs a numeric scale.

## F4. An `unknown` initial disposition leaves no native process, so known history can't be attached

- What happened: for ON RRP usage I know the history (about $2.5T peak near end-2022, near zero
  by autumn 2025) but not the end-December 2025 value. The builder made `us.on_rrp_usd_bn` an
  "unresolved process definition" with no native runtime process (`unresolvedProcessIds`). The
  estimation exchange binds coordinates to native processes, so the dated history has nowhere
  to go.
- What I did: kept the value unknown (no invented number) and left the history in the evidence
  text and the review node.
- What would have helped: allowing a native process whose current value is unknown but which
  can hold dated claims, or documenting this consequence next to the `unknown` disposition.

## F5. The preview hides Jev's distributions, and the process value loses Jev's confidence

- What happened: the builder preview (seq 38) returned only final values (0.99, "deleveraged",
  "flow_dominated") and token usage, although `nextStep` says "Review these exact values". The
  probabilities and confidence appeared only after apply, in graph node
  `general.evidence.general.estimator.initial`: leverage deleveraged 0.95 (confidence 0.94),
  coupling flow_dominated 0.90 (0.87), accommodation level "3" at 0.99. Each process record still
  says `uncertainty: {kind: unknown}`. The stored Score answer reads `"score": 2.98` on a 0-4
  level-index scale, while the process value is 0.99 on my declared -2..+2 scale. The value is an
  expectation over levels, which assumes an interval scale although I declared the rubric ordinal.
- What I did: checked the answers after apply and accepted them; recorded the distributions in my notes.
- What would have helped: showing the distributions and confidence in the preview, carrying
  Jev's confidence into process uncertainty, stating the Score in the declared unit, and a
  median/mode option for ordinal rubrics.

## F6. The builder's proposal can't be inspected with the estimation inspector

- What happened: `life_estimation_proposal_inspect` on
  `estimate.d399bc65-9d2a-4977-ab02-f17e1bec286c` returned "Unknown or inaccessible estimation
  proposal." The two proposal families share a naming pattern but not their tools.
- What I did: applied on the preview summary alone.
- What would have helped: an inspect path for builder proposals, or a different id prefix.

## F7. A definitional revision is accepted by the model tool, then refused by the world

- What happened: I found that my stablecoin figures are all-USD-pegged totals while the process
  said fiat-backed only. `life_model_revise` registered a corrected revision 1 (`15ef65cc...`),
  but `life_world_revise` then refused it: "Life Simulation Rust operation revise_world failed
  (invalid_request): world revision cannot reshape or change units, frame, or scale of process
  stablecoins.usd_supply_usd_bn". Revision 1 stays registered as an orphan that no world can adopt.
- What I did: registered a sibling revision 1b (`f1554b9a...`). It keeps the old definition,
  revises that process's estimate (305 to 270, fiat-backed only) and adds
  `stablecoins.usd_pegged_supply_usd_bn` for the all-USD-pegged total. The world then adopted it
  (mode revise, version 1).
- What would have helped: a compatibility check before registration, and guidance on how to
  correct a mis-defined process (new id plus a supersession link) without leaving orphans.

## F8. A world revision keeps stale claims and gives new processes none

- What happened: after `life_world_revise` with `stateValues`, the world state reads 270 for the
  fiat-backed process, but its claim `general.initial.stablecoins.usd_supply_usd_bn` still says
  305, and the new process has state but no claim ("target model initial values and claims are
  not injected").
- What I did: submitted fresh t = 0 claims for both through the estimation exchange (with
  `acknowledgedClaimIds` for the stale claim) and recorded them in the graph with a `supersedes` edge.
- What would have helped: injecting the target revision's claims, or a warning listing
  claims left inconsistent with the new state.

## F9. The provisional-claim schema is undocumented; I learned it from four errors

- What happened: `life_estimation_response_submit` types `claim` as an open object, and no
  guide shows one. The errors, in order: "provisionalClaims[0].claim contains unsupported field
  value_time."; "provisionalClaims[0].claim contains unsupported field mode.";
  "provisionalClaims[0] observed output requires evidence_cutoff equal to valueTime."; and, for
  estimated output, "provisionalClaims[0] estimated output requires belief, estimate, or forecast
  evidence." The accepted shape copies a stored claim minus `value_time` and `mode`.
- What I did: probed with a throwaway request, then filed exact FOMC ranges as observed reports
  (cutoff = their own date) and every approximate recollection as an estimate at cutoff 0.
- What would have helped: one worked claim example in the minimal example resource, including a
  retrospective estimate of a past value.

## F10. Reviewed caller-supplied samples can't be recorded with the recorder tool

- What happened: `life_process_estimation_record` refused the approved historical proposal: "The
  exact provider bundle is unavailable in this session; do not reconstruct or rerun it silently.
  Read a previously recorded bundle from its graph instead." It records only Jev bundles, but
  the guide says to sample dated values "through the estimation exchange" and keep records in
  the graph. The approved proposal is process-local and won't survive a restart.
- What I did: recorded the core review (`life_estimation_proposal_review`) and hand-built a graph
  batch (72 nodes, 217 edges): one node per dated value with value_time, evidence_cutoff,
  evidence_type and uncertainty, anchored to its process and linked to its evidence, plus a review node.
- What would have helped: a recorder for caller-supplied data-only proposals.

## F11. A "report" initial value becomes an "observed" claim

- What happened: the builder stored my `evidenceType: report` initial value (the recalled FOMC
  range) as a claim with `mode: observed` (keeping `evidence_type: report`). For a recollection
  that is stronger than intended, and the guide doesn't mention the mapping.
- What I did: nothing structural. The evidence text states that every value is recalled, not retrieved.
- What would have helped: a mode that matches the evidence type, or documentation of the mapping.

## F12. A batch estimate fails whole on one inconsistent Score, with no diagnostic

- What happened: `life_process_estimate` with 22 retrospective coordinates (10 Score, 12 Choice)
  returned only "judgment.monetary_accommodation_for_crypto score is inconsistent with its
  distribution." It gave no answers, no usage and no coordinate id. The guide promises a
  `status: "rejected"` diagnostic with questions, answers and usage for the builder, but this
  tool returned a bare error. The call took 0.84 s, like the successful Jev call (0.74 s), while
  local validation errors return in about 0.20 s (seq 60, 61). So Jev very probably ran and its
  whole batch was discarded. One inconsistent Score answer threw away all 22 answers, including
  the 12 Choice answers. The builder's own Jev answer earlier showed the same kind of small
  mismatch (score 2.98 against the 2.99 implied by its distribution), which was accepted then.
- What I did: counted it as estimator call 2 of 3. I did not retry, because a new requestId could
  spend another call, and the error does not say whether a same-id retry would replay a cache.
  I authored the retrospective judgment samples myself under the same rubrics, labeled as
  modeler estimates, and kept the last Jev call for the channel-attribution Cuts.
- What would have helped: returning the rejected answers, usage and offending coordinate;
  validating per coordinate so one mismatch doesn't discard the batch; or a documented
  tolerance, or recomputing the score from the distribution.

## F13. Ingest notes can't link to other notes in the same call

- What happened: in the `life_model_ingest` apply, one note linked to another note of the same
  call and the whole apply failed: "Note u.disagreement.channel_cuts links to unknown node
  u.review.channel_cuts." It failed locally in 0.20 s, so no estimator ran.
- What I did: dropped the note-to-note links, applied, then added them with a `life_narrative_batch`.
- What would have helped: resolving links among the notes of one call.

## F14. Ingest drops the evidence and vocabulary behind its Cuts, and Cuts can't be anchored

- What happened: after the ingest, the model's Cut records keep only keys, weights, question,
  unit and estimator provenance. The situation texts Jev judged, each answer's meaning and the
  remainder meaning are stored neither in the model nor in the graph; only my local input file
  and the relay transcript kept them. Graph anchors have no kind for normalized Cuts (the kinds
  are model, process, ..., event, realization, world, candidate, occurrence), so a rationale node
  can't address a Cut, although the paper says Cut components are addressable.
- What I did: wrote the five situation texts and both question definitions (answer and remainder
  meanings, cut ids) into the graph as nodes anchored to the assessment events.
- What would have helped: persisting situation text and answer meanings with each Cut, and a
  `normalized_cut` anchor kind with component paths.

## F15. Ingest can't declare a conditional (nested) Cut

- What happened: my conduit question divides "the part of BTC's move attributable to US monetary
  conditions", which is the `us_monetary` component of the driver Cut. The engine supports
  conditioning ("cut_id and stable answer_key"), but neither `life_model_ingest` nor
  `life_estimate_cut_shares` exposes it, so the conditioning exists only in the question text.
  Where that component is near zero (2024: 0.02; Q4 2025: 0.00) the conduit shares carry almost no
  information, and nothing in the record says so.
- What I did: stated the conditioning and its consequence in Understanding Nodes
  (`u.review.channel_cuts`, `u.test.causal_use_and_conservation`).
- What would have helped: a `conditionedOn: {cutId|questionId, answerKey}` field on ingest
  questions, and a warning when the conditioning share is near zero.

## F16. Unresolved processes can't be anchored, and manual revisions leave the graph's model mirror incomplete

- What happened: (a) a graph edge to the unresolved process `stablecoins.tbill_reserves_usd_bn`
  was refused: "Life Simulation Rust operation apply_narrative_batch failed (invalid_request):
  narrative edge close.edge.27 names unknown or source-incompatible Process anchor
  stablecoins.tbill_reserves_usd_bn". (b) The builder writes a graph node for every concept,
  event and process value, but records I added by `life_model_revise` (the new stablecoin
  process, `concept.access_adoption_demand`, the understanding root) got no such nodes. Anchors
  reach them, but the graph's own record of the model is incomplete after a revision.
- What I did: linked to the unresolved definition node (`general.process.stablecoins.tbill_reserves_usd_bn`)
  instead, and described the new records in review nodes that anchor to them.
- What would have helped: letting unresolved definitions be anchor targets, and an optional
  "mirror new records" step in `life_narrative_rebind`.

## F17. The negative time basis had to be inferred from the schema

- What happened: the guide says "Initial values and evidence cutoff use time 0". Only the schema
  (`availableAt` maximum 0, `evidenceCutoff` const 0) showed that all history must be written at
  negative times. That worked, but the choice of origin matters because it fixes the evidence
  cutoff for every initial value.
- What I did: t = 0 at 2026-01-01 (the cutoff), with months before it negative, and the
  conversion formula stated in `time.origin`.
- What would have helped: one sentence and a short example in the guide.

## F18. Unclear what evidence `life_process_estimate` sends to Jev

- What happened: unlike the builder's `initialEstimate` (which takes `sourceIds`), the coordinate
  questions of `life_process_estimate` take no source ids. The schema has only a free `context`
  string (20,000 chars), and I could not tell whether the scaffold's evidence items are passed
  along. The call was rejected (F12), so its behaviour stayed unobserved.
- What I did: pasted 8,348 characters of the relevant evidence into `context`.
- What would have helped: `sourceIds` on coordinates, or a statement of what evidence is sent.

## What worked well (for balance)

- The dry-run preview validated the whole scaffold with clear, specific messages and no provider call.
- The builder turned the context review and notes into Understanding Nodes and kept Jev's full
  answers in a graph evidence node.
- World revisions and rebinds are hash-checked and kept every node (no anchor edges dropped).
- Ingest apply reused the preview's exact estimates by proposal id, without a new call.
- Batch validation errors named the offending edge and anchor precisely.
