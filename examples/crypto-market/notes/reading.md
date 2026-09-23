# 00 Reading record

Run date: 2026-09-23. Modeler: Claude Opus 5.5, first use of the Meaning Model MCP server.
All resources were read through the relay (`read_resource`) in this live MCP process; copies of
the served text are in `results/` (JSON) and were read from those saved copies.

## Entry sequence

1. `life_general_modeling_start` prompt, fetched without arguments (seq 3). It opens
   "Begin a observation Meaning Model modeling session in first_use mode", so I used
   `purpose: observation`, `sessionMode: first_use`.
2. `life_modeling_context` (purpose observation, first_use), seq 7. Gate unsatisfied at that point.
3. All seven ordered resources read (seq 8-14), then `life_modeling_context` called again
   (same purpose) to check the gate: `theoryAccessGate.satisfied: true`, both paper URIs in
   `readUris`, `durableAcrossServerRestart: false`.

## Read in full

| Resource | Size | Notes |
| --- | --- | --- |
| `life-sim://guide/general-modeling` | 14,689 chars | Every line. Main operating guide for this run. |
| `life-sim://protocol/modeling` | 20,121 chars | Every line. |
| `life-sim://example/minimal-model-and-graph` | 13,739 chars | Every line, including the register, graph and batch payloads. |
| `life-sim://example/application-categories` | 5,960 chars | Every line. |
| `life-sim://protocol/narrative-understanding-graph` | 18,074 chars | Every line (graph anchors, batch rules, query modes, limits). |
| `life-sim://theory/meaning-model` (the Meaning Model paper) | 169,850 chars, 2,861 lines | Read from start to end, lines 1-2861. Read closely: Introduction; Grammar and Progressive Construction (optional profile, roots and identity, Cuts/Event-processes/world data, conservation under refinement, anticipation/shocks/adaptation across scales); Concepts and Examples (grounding resources, grounding versions, concept history, process-based concept model, fit Cuts, One World Many Cuts, direction); World, Understanding, and Artifacts (operative models and estimates, transactional construction); Closure and Sufficiency; General Modeling, Story Construction, and Mechanism Search; Limitations; Bridge to Life Simulation; Conclusion. Read faster: the *Book of Conditions* sections (lines 1756-2203) and the Book-specific appendix (2653-2861). |

The served paper cannot be read completely: it loads `\input{includes/interface-blocks}`,
`\input{includes/conceptual-decomposition}` and `\input{includes/book-trajectory-figures}`,
and uses the macros `\MMCoreSummary` and `\MMCoreSchema`, and the resource does not include
those files. The paper's "minimized core" box, its core record schema and three figures were
therefore not visible to me (see friction F2).

## Skimmed

`life-sim://theory/life-simulation` (158,750 chars, 2,598 lines). What I actually read:

- Read: abstract and Introduction (lines 1-308); Explicit Worlds with Time-Indexed Processes
  (309-653: simulation object, process fields vs allocations vs events, slow trajectories/
  shocks/adaptation, local models and perspective, process sensorium, synthetic bootstrap);
  The Meaning Model as World Interface (654-719); Adaptive Process Resolution (931-993);
  Candidate Process Models and "Evidence standards differ by domain" (994-1157);
  Measurement, time-indexed evidence and testing estimates (1614-1708); Current Executor
  Boundary (2219-2245); Limitations (2356-2387).
- Not read: Evaluation Program and the reservoir experiment (720-930), Narrative as the First
  Controlled Laboratory, Learning from Process Endpoints and Histories (curricula, concept
  recognizers, problem-solving episodes), Understanding People and Alignment, Applications,
  Related Work, Conclusion, and the training-export appendix.
- Keyword search of both papers for market/price/finance/liquidity/crypto: the only market
  statements are that a price series is one process and not the boundary of a market
  model, and that prediction-market histories are evidence without automatic authority.

## Also read (tool metadata)

- `list_tools` (47 tools with descriptions), `list_prompts`, `list_resources`.
- Full input schemas: `life_world_model_build`, `life_process_estimate`,
  `life_process_estimation_record`, `life_model_ingest`, `life_estimate_cut_shares`,
  `life_estimation_request_create`, `life_estimation_response_submit`,
  `life_estimation_proposal_review`, `life_estimation_proposal_inspect`,
  `life_narrative_query`, `life_narrative_batch`, `life_narrative_rebind`,
  `life_model_inspect`, `life_model_revise`, `life_world_revise`, `life_world_inspect`,
  `life_meaning_query`, `life_graph_query`, `life_view_query`, `life_modeling_context`.
- `life_engine_status` (engine 0.3.0, persistence configured, value kinds, edge kinds).

## Points from the reading that shape this model

- Price is one process, not the boundary of a market model. Choose processes across the system.
- Work macro to micro: first the enclosing monetary system and its longer history, then the
  crypto conduits, then the focal price. Record the review, unknowns and exclusions as
  Understanding Nodes.
- A long Event is not a numerical trend. Dated values need explicit time coordinates, their
  evidence cutoff and uncertainty. Retrospective inference stays separate from historical observation.
- Semantic numbers are Cut weights under a declared question, unit and remainder. Measurements
  keep their own units. A Jev probability is not a physical share. A cause Cut allocates
  explanatory responsibility beneath a perspective and does not establish causation.
- Authored judgment scales need a declared comparison, anchors and units. A score of 2 is not
  twice a score of 1 unless the scale says so.
- Concepts and abstract cuts are native records. Overlapping lenses need not sum to one.
- Concept variation: separate a changed world from a changed framing, estimate or rubric.
- Do not invent transition laws. Store the sampled path and leave unexplained transitions open.
- Keep competing explanations. Leave missing values unknown, not zero.
