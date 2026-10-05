# Minimal model and graph: complete valid payloads

Every payload below is verified against the bundled Rust engine by `mcp-server/test/friction-fixes.test.mjs`
(sections 1 to 4), `minimal-example-concepts.test.mjs` (section 5) and `minimal-example-perspectives.test.mjs`
(sections 6 and 7), so it can be copied and adapted. It shows the smallest useful shapes,
not a recommended vocabulary: one person, one thing, an accepted-world root with an inner
root, an authored event with a description and an interval, one scalar process, and one
normalized Cut with its explicit remainder.

## 1. `life_profile_compile` request

Compile a structural starter (persons and their lifecycle events) and adapt the returned
`model` before registering it. The schema string, the `model` header and the `profiles`
array with `kind` and `profile` are all required.

```json
{
  "profileRequest": {
    "schema": "life-sim-rust-profile-compilation/v1",
    "model": { "id": "harbour-example", "time_unit": "hour", "reason": "Worked example.", "provenance": ["minimal-example"] },
    "profiles": [
      { "kind": "person_scaffold", "profile": {
        "id": "ada", "subject_id": "ada",
        "person_boundary": "Ada, one human woman, apprentice baker",
        "continuity_criterion": "Same living embodied person",
        "life_description": "Authored: grows up in the bakery, apprentices at 15, still there at 30",
        "level": "lifecycle", "provenance": ["minimal-example"] } }
    ]
  }
}
```

## 2. `life_model_register` request

A complete hand-authored revision-0 model. Note the fields validation insists on: every
process needs `value_type` with `bounds`, an `initial_value` with a `kind`, and a nonempty
`support` list; every referent needs a `lifecycle_event_id`; context roots opt every event
into containment validation, so each event has a `contains` relation from a root; a
normalized Cut needs an explicit `remainder` answer and weights that sum to one. The Event a
Cut divides also carries a `description` of what happens in it, so its numbers mean something.

```json
{
  "requestId": "minimal-example-register",
  "model": {
    "schema": "life-sim-rust-model/v1",
    "id": "harbour-example",
    "time_unit": "hour",
    "revision": { "number": 0, "previous_model_hash": null, "provenance": ["minimal-example"], "reason": "Worked example." },
    "decomposition": [],
    "dependencies": [],
    "laws": [],
    "initial_claims": [],
    "processes": [
      { "id": "bakery.debt_nok", "value_type": { "kind": "scalar", "bounds": { "minimum": 0, "maximum": 10000000 } },
        "initial_value": { "kind": "scalar", "value": 1650000 }, "unit": "NOK", "update_mode": "observed",
        "reference_frame": "bakery-accounts", "scale": { "semantic_role": "outstanding loan principal" },
        "support": ["authored-observed-value:bakery.debt_nok"], "uncertainty": { "kind": "unknown" },
        "axes": [], "access_scopes": [], "provenance": ["minimal-example"] }
    ],
    "meaning_model": {
      "schema": "life-sim-rust-meaning-model/v1",
      "referents": [
        { "id": "referent.ada", "boundary": "Ada, one human woman, apprentice baker", "continuity_criterion": "Same living embodied person",
          "lifecycle_event_id": "event.ada.life", "interval": null, "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "referent.bakery", "boundary": "The harbour bakery: premises, ovens, two employees", "continuity_criterion": "Same business and premises",
          "lifecycle_event_id": "event.bakery.life", "interval": null, "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "events": [
        { "id": "event.world", "boundary": "The accepted fictional world of the harbour town.", "interval": null, "participants": {}, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.ada.inner", "boundary": "Ada's inner perspective root; her beliefs and appraisals are attributed here, never accepted as world fact.", "interval": null, "participants": { "subject": "referent.ada" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.ada.life", "boundary": "Ada's lifecycle: childhood in the bakery, apprenticeship at 15, running the ovens at 30.", "interval": null, "participants": { "subject": "referent.ada" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.bakery.life", "boundary": "The bakery's lifecycle since 1971.", "interval": null, "participants": { "subject": "referent.bakery" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.offer", "boundary": "A written offer to buy the bakery arrives at hour 6 and must be answered within the day.",
          "description": "The offer would clear the loan. Ada has told nobody.",
          "interval": { "start": 6, "end": 7 }, "participants": { "recipient": "referent.ada", "object": "referent.bakery" }, "process_ids": ["bakery.debt_nok"], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.ada.state.h06", "boundary": "Ada's attributed attention state at hour 6, when the offer arrives.",
          "description": "The offer has just arrived. Ada reads it at the counter before the first customers, thinking first of the loan and then of the ovens her grandmother lit.",
          "interval": { "start": 6, "end": 6.25 }, "participants": { "subject": "referent.ada" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] }
      ],
      "event_referent_bindings": [
        { "id": "binding.ada.life.subject", "binding_type": "lifecycle_subject", "role": "subject", "referent_id": "referent.ada", "target": { "kind": "event", "event_id": "event.ada.life" }, "interval": null, "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "binding.bakery.life.subject", "binding_type": "lifecycle_subject", "role": "subject", "referent_id": "referent.bakery", "target": { "kind": "event", "event_id": "event.bakery.life" }, "interval": null, "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "event_relations": [
        { "id": "world.contains.ada.inner", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.ada.inner", "description": "Inner root nested in the accepted world.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "world.contains.ada.life", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.ada.life", "description": "Accepted-world containment.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "world.contains.bakery.life", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.bakery.life", "description": "Accepted-world containment.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "world.contains.offer", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.offer", "description": "Accepted-world containment.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "ada.inner.contains.h06", "kind": "contains", "source_event_id": "event.ada.inner", "target_event_id": "event.ada.state.h06", "description": "Attributed interior state under the inner root.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "offer.enables.state", "kind": "enables", "source_event_id": "event.offer", "target_event_id": "event.ada.state.h06", "description": "Authored causal dependency, not an executed law.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "normalized_cuts": [
        { "id": "cut.ada.h06.attention", "parent_event_id": "event.ada.state.h06",
          "question": "How does Ada's attention divide among money, the bakery's continuity and the remainder at hour 6?",
          "unit": "share of one attention budget",
          "answers": [ { "key": "money", "weight": 0.55 }, { "key": "continuity", "weight": 0.35 }, { "key": "remainder", "weight": 0.10 } ],
          "provenance": ["minimal-example; authored, not measured"] }
      ],
      "context_roots": [
        { "event_id": "event.world", "kind": "accepted_world", "provenance": ["minimal-example"] },
        { "event_id": "event.ada.inner", "kind": "inner", "provenance": ["minimal-example"] }
      ],
      "concepts": [], "abstract_cuts": [], "abstract_relations": [], "encapsulation_cuts": [], "physical_cuts": [], "realizations": []
    }
  }
}
```

## 3. `life_narrative_register` request

Bind a graph to the registered model by replacing `MODEL_HASH` with the `modelHash`
returned above. A node with nonempty text needs `provenance` and `authority`; any fact a
character may later be shown knowing needs an `evidence_cutoff`; grounding anchors name
records of the bound model by kind and id.

```json
{
  "requestId": "minimal-example-graph",
  "narrativeGraph": {
    "schema": "life-sim-rust-narrative-graph/v1",
    "id": "harbour-example-story",
    "revision": { "number": 0, "reason": "Canon before prose.", "provenance": ["minimal-example"] },
    "source": { "kind": "model", "model_hash": "MODEL_HASH" },
    "roots": ["story"],
    "nodes": [
      { "id": "story", "node_type": "story", "role": "document_root", "text": "# The Offer", "render": "include", "training": "exclude",
        "epistemic_status": "fictional_artifact", "evidence_type": "fictional_canon", "authority": { "source": "example-author", "weight": 1 }, "provenance": ["minimal-example"] },
      { "id": "canon.offer", "node_type": "authored_fact", "role": "metadata",
        "text": "At hour 6 a written offer to buy the bakery arrives; it would clear the 1,650,000 NOK loan. Before hour 6 Ada had told nobody about the debt.",
        "evidence_cutoff": 6, "epistemic_status": "fictional_canon", "evidence_type": "fictional_canon", "render": "exclude", "training": "exclude",
        "authority": { "source": "example-author", "weight": 1 }, "provenance": ["minimal-example"] }
    ],
    "edges": [
      { "id": "story.contains.canon.offer", "source": { "kind": "node", "node_id": "story" }, "target": { "kind": "node", "node_id": "canon.offer" }, "family": "structural", "relation": "contains", "order": 100, "provenance": ["minimal-example"] },
      { "id": "grounding.canon.offer.event", "source": { "kind": "node", "node_id": "canon.offer" }, "target": { "kind": "anchor", "anchor_kind": "event", "anchor_id": "event.offer" }, "family": "grounding", "relation": "grounded_in", "provenance": ["minimal-example"] },
      { "id": "grounding.canon.offer.process", "source": { "kind": "node", "node_id": "canon.offer" }, "target": { "kind": "anchor", "anchor_kind": "process", "anchor_id": "bakery.debt_nok" }, "family": "grounding", "relation": "grounded_in", "provenance": ["minimal-example"] }
    ]
  }
}
```

## 4. `life_narrative_batch` request

Add connected nodes and edges to an existing graph without resending it. Replace `GRAPH_HASH`
(twice: the tool argument and the batch's own `previous_graph_hash`) with the `graphHash`
returned by registration. Every new node must connect to an existing node or a validated anchor
in the same batch. This one adds a dated fact, the form a character can later be shown knowing.

```json
{
  "requestId": "minimal-example-batch",
  "previousGraphHash": "GRAPH_HASH",
  "narrativeBatch": {
    "schema": "life-sim-rust-narrative-batch/v1",
    "previous_graph_hash": "GRAPH_HASH",
    "reason": "Add a dated fact a character may be shown knowing.",
    "provenance": [
      "minimal-example"
    ],
    "add_roots": [],
    "add_nodes": [
      {
        "id": "canon.debt",
        "node_type": "authored_fact",
        "role": "metadata",
        "text": "The bakery owes 1,650,000 NOK on a loan taken in 2019.",
        "evidence_cutoff": 0,
        "epistemic_status": "fictional_canon",
        "evidence_type": "fictional_canon",
        "render": "exclude",
        "training": "exclude",
        "authority": {
          "source": "example-author",
          "weight": 1
        },
        "provenance": [
          "minimal-example"
        ]
      }
    ],
    "add_edges": [
      {
        "id": "story.contains.canon.debt",
        "source": {
          "kind": "node",
          "node_id": "story"
        },
        "target": {
          "kind": "node",
          "node_id": "canon.debt"
        },
        "family": "structural",
        "relation": "contains",
        "order": 101,
        "provenance": [
          "minimal-example"
        ]
      },
      {
        "id": "grounding.canon.debt.process",
        "source": {
          "kind": "node",
          "node_id": "canon.debt"
        },
        "target": {
          "kind": "anchor",
          "anchor_kind": "process",
          "anchor_id": "bakery.debt_nok"
        },
        "family": "grounding",
        "relation": "grounded_in",
        "provenance": [
          "minimal-example"
        ]
      }
    ]
  }
}
```

## 5. `life_model_revise` request: the carve behind a Cut

The grammar's Concept, specialization and decomposition records, in the host's own fields. They are unweighted:
they say what a concept is made of, never how much of it. The register call above returns the `modelHash` to revise.

- `concepts`: `id`, `label`, and `differentia`, a list saying what sets the concept apart from its siblings.
- `abstract_relations` of kind `specialization`: `source_concept_id` is the broader concept, `target_concept_id` the
  narrower one. This records the ascent.
- `abstract_cuts`: the decomposition of `parent_concept_id` into `child_concept_ids`, with the `lens` that frames it.
  This records the four-test carve.

Ada's attention Cut divides one declared unit, an attention budget, among money and the bakery's continuity. The
carve below records where that concept sits and what it is made of.

```json
{
  "requestId": "minimal-example-concepts",
  "previousModelHash": "<modelHash returned by life_model_register above>",
  "change": {
    "reason": "Record the carve behind Ada's attention Cut.",
    "upsert": {
      "concepts": [
        { "id": "concept.allocation", "label": "Allocation of a bounded resource", "differentia": ["one bounded resource divided among exclusive uses"], "provenance": ["minimal-example"] },
        { "id": "concept.attention", "label": "A person's attention", "differentia": ["the resource is one person's attention over a stretch of time"], "provenance": ["minimal-example"] },
        { "id": "concept.attention.money", "label": "Money", "differentia": ["attention spent on income, debt and payment"], "provenance": ["minimal-example"] },
        { "id": "concept.attention.continuity", "label": "The bakery's continuity", "differentia": ["attention spent on keeping the business and its premises going"], "provenance": ["minimal-example"] }
      ],
      "abstract_relations": [
        { "id": "rel.allocation.attention", "source_concept_id": "concept.allocation", "target_concept_id": "concept.attention", "kind": "specialization", "provenance": ["minimal-example"] }
      ],
      "abstract_cuts": [
        { "id": "acut.attention.uses", "parent_concept_id": "concept.attention", "child_concept_ids": ["concept.attention.money", "concept.attention.continuity"],
          "lens": "what Ada's attention is spent on when the offer arrives", "query": "Which uses must Ada's attention cover at the offer?", "provenance": ["minimal-example"] }
      ]
    }
  }
}
```

## 6. `life_model_revise` request: an issued forecast, a later one, and the outcome

A forecast is issued once and kept as issued. Each one is its own dated Event under the forecaster's perspective, here
the modeler's understanding root, with a Cut whose answers are the outcomes and whose weights are probabilities declared
before the outcome. The question names the horizon, each answer's meaning says what settles it, and the provenance gives
the evidence cutoff and the source that settles it. When the evidence changes the view, a new forecast is issued beside
the old one, in the same words and unit so the issued forecasts can be read in order. The outcome is an accepted-world
Event, linked from each forecast it settles by a `realizes_forecast` relation that names the Cut and the answer that
happened (the remainder if none of the named answers did).

Each forecast is scored as issued. Ada declines: the hour-7 forecast gave that 0.30, a log score of −ln 0.30 = 1.20 and
a Brier score of 0.60² + 0.70² + 0.10² = 0.86; the hour-12 forecast gave it 0.55, scoring 0.60 and 0.335. Lower is
better for both, and a score means something only beside a baseline scored the same way. Accounts of what has already
happened are different: record them early and correct them as you learn more.

```json
{
  "requestId": "minimal-example-forecasts",
  "previousModelHash": "<modelHash returned by life_model_register above>",
  "change": {
    "reason": "Issue two forecasts of Ada's answer, then record the outcome that settles both.",
    "upsert": {
      "events": [
        { "id": "event.modeler", "boundary": "The modeler's understanding root: forecasts and judgments the modeler holds, never accepted as world fact.", "interval": null, "participants": {}, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.forecast.h07", "boundary": "The modeler's forecast of Ada's answer, issued at hour 7.",
          "description": "Issued with what was known at hour 7: the offer, the loan, and Ada's attention at hour 6, mostly on money.",
          "interval": { "start": 7, "end": 7.25 }, "participants": {}, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.forecast.h12", "boundary": "The modeler's forecast of Ada's answer, issued at hour 12.",
          "description": "Issued after Ada asked the bank at hour 11 whether the loan could run longer: she is looking for a way to keep the bakery.",
          "interval": { "start": 12, "end": 12.25 }, "participants": {}, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.ada.declines", "boundary": "Ada telephones the buyer at hour 20 and declines the offer.",
          "description": "She keeps the bakery and asks the bank for the longer loan.",
          "interval": { "start": 20, "end": 20.25 }, "participants": { "actor": "referent.ada" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] }
      ],
      "event_relations": [
        { "id": "modeler.contains.forecast.h07", "kind": "contains", "source_event_id": "event.modeler", "target_event_id": "event.forecast.h07", "description": "A forecast the modeler holds.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "modeler.contains.forecast.h12", "kind": "contains", "source_event_id": "event.modeler", "target_event_id": "event.forecast.h12", "description": "A forecast the modeler holds.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "forecast.h07.about.offer", "kind": "about", "source_event_id": "event.forecast.h07", "target_event_id": "event.offer", "description": "The forecast concerns Ada's answer to the offer.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "forecast.h12.about.offer", "kind": "about", "source_event_id": "event.forecast.h12", "target_event_id": "event.offer", "description": "The forecast concerns Ada's answer to the offer.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "world.contains.declines", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.ada.declines", "description": "Accepted-world containment.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "forecast.h07.settled", "kind": "realizes_forecast", "source_event_id": "event.forecast.h07", "target_event_id": "event.ada.declines",
          "forecast_answer": { "cut_id": "cut.forecast.h07", "answer_key": "declines" }, "description": "The outcome settles the hour-7 forecast.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "forecast.h12.settled", "kind": "realizes_forecast", "source_event_id": "event.forecast.h12", "target_event_id": "event.ada.declines",
          "forecast_answer": { "cut_id": "cut.forecast.h12", "answer_key": "declines" }, "description": "The outcome settles the hour-12 forecast.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "normalized_cuts": [
        { "id": "cut.forecast.h07", "parent_event_id": "event.forecast.h07",
          "question": "Will Ada accept the buyer's offer by hour 24?",
          "unit": "one unit of the modeler's belief",
          "answers": [
            { "key": "accepts", "weight": 0.6, "meaning": "Ada signs the buyer's acceptance form before hour 24." },
            { "key": "declines", "weight": 0.3, "meaning": "Ada tells the buyer no before hour 24." },
            { "key": "remainder", "weight": 0.1, "meaning": "Neither happens by hour 24." } ],
          "provenance": ["inferred: from the offer, the loan and Ada's attention at hour 6", "forecast: probabilities declared before the outcome",
            "evidence cutoff: hour 7", "horizon: hour 24", "settled by: the buyer's record of Ada's answer"] },
        { "id": "cut.forecast.h12", "parent_event_id": "event.forecast.h12",
          "question": "Will Ada accept the buyer's offer by hour 24?",
          "unit": "one unit of the modeler's belief",
          "answers": [
            { "key": "accepts", "weight": 0.35, "meaning": "Ada signs the buyer's acceptance form before hour 24." },
            { "key": "declines", "weight": 0.55, "meaning": "Ada tells the buyer no before hour 24." },
            { "key": "remainder", "weight": 0.1, "meaning": "Neither happens by hour 24." } ],
          "provenance": ["inferred: Ada's question to the bank at hour 11 points to keeping the bakery", "forecast: probabilities declared before the outcome",
            "evidence cutoff: hour 12", "horizon: hour 24", "settled by: the buyer's record of Ada's answer"] }
      ],
      "context_roots": [ { "event_id": "event.modeler", "kind": "understanding", "provenance": ["minimal-example"] } ]
    }
  }
}
```

## 7. `life_model_revise` request: one person's mistaken understanding of another

Each person's view lives under their own inner root, and the accepted world holds what happens. Lise, Ada's sister,
misreads her: Ada wants to keep the bakery, Lise is sure she wants to sell, and Lise acts on her reading. The reading is
an Event under Lise's inner root, linked `about` the state it reads, with a Cut that asks Ada's own question in the same
words and unit, so the two can be compared answer by answer. The action is an accepted-world Event caused by the
reading, not by what Ada wants. Neither reading becomes world fact, and `life_model_questions` returns the gap among
its jumps, where a story or an explanation should look.

```json
{
  "requestId": "minimal-example-misreading",
  "previousModelHash": "<modelHash returned by life_model_register above>",
  "change": {
    "reason": "Lise misreads what Ada wants and acts on her reading.",
    "upsert": {
      "referents": [
        { "id": "referent.lise", "boundary": "Lise, Ada's younger sister, who keeps the bakery's books", "continuity_criterion": "Same living embodied person",
          "lifecycle_event_id": "event.lise.life", "interval": null, "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "events": [
        { "id": "event.lise.life", "boundary": "Lise's lifecycle: two years younger than Ada, she keeps the bakery's books.", "interval": null, "participants": { "subject": "referent.lise" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.lise.inner", "boundary": "Lise's inner perspective root; her beliefs are attributed here, never accepted as world fact.", "interval": null, "participants": { "subject": "referent.lise" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.ada.stance.h08", "boundary": "Ada's stance on the offer at hour 8, in her own view.",
          "description": "Ada has decided she wants to keep the bakery and means to ask the bank for a longer loan. She has told nobody.",
          "interval": { "start": 8, "end": 8.25 }, "participants": { "subject": "referent.ada" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.lise.reads.ada.h08", "boundary": "Lise's reading of Ada's stance at hour 8.",
          "description": "Lise saw Ada read the offer twice and put it in the till drawer, and took it for relief: she is sure Ada wants to sell.",
          "interval": { "start": 8, "end": 8.25 }, "participants": { "subject": "referent.lise" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] },
        { "id": "event.lise.calls.buyer", "boundary": "Lise telephones the buyer at hour 9 and tells him Ada will sign.",
          "description": "She means to spare Ada the call; the buyer starts drawing up the contract.",
          "interval": { "start": 9, "end": 9.25 }, "participants": { "actor": "referent.lise" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] }
      ],
      "event_referent_bindings": [
        { "id": "binding.lise.life.subject", "binding_type": "lifecycle_subject", "role": "subject", "referent_id": "referent.lise", "target": { "kind": "event", "event_id": "event.lise.life" }, "interval": null, "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "event_relations": [
        { "id": "world.contains.lise.life", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.lise.life", "description": "Accepted-world containment.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "world.contains.lise.inner", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.lise.inner", "description": "Inner root nested in the accepted world.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "ada.inner.contains.stance.h08", "kind": "contains", "source_event_id": "event.ada.inner", "target_event_id": "event.ada.stance.h08", "description": "Ada's own view, under her inner root.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "lise.inner.contains.reading.h08", "kind": "contains", "source_event_id": "event.lise.inner", "target_event_id": "event.lise.reads.ada.h08", "description": "Lise's reading, under her inner root.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "lise.reading.about.ada.stance", "kind": "about", "source_event_id": "event.lise.reads.ada.h08", "target_event_id": "event.ada.stance.h08", "description": "Lise's reading refers to Ada's stance without taking part in it.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "world.contains.call", "kind": "contains", "source_event_id": "event.world", "target_event_id": "event.lise.calls.buyer", "description": "Accepted-world containment.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] },
        { "id": "reading.causes.call", "kind": "causes", "source_event_id": "event.lise.reads.ada.h08", "target_event_id": "event.lise.calls.buyer", "description": "Lise acts on her reading of Ada, not on what Ada wants.", "authority": null, "uncertainty": { "kind": "unknown" }, "provenance": ["minimal-example"] }
      ],
      "normalized_cuts": [
        { "id": "cut.ada.stance.h08", "parent_event_id": "event.ada.stance.h08",
          "question": "How does Ada's stance on the offer divide between keeping the bakery and selling it?",
          "unit": "one unit of Ada's stance on the offer",
          "answers": [ { "key": "keep", "weight": 0.85, "meaning": "Keep the bakery and refinance the loan." }, { "key": "sell", "weight": 0.15, "meaning": "Accept the offer and clear the loan." } ],
          "provenance": ["invented: Ada's own view at hour 8"] },
        { "id": "cut.lise.reads.ada.h08", "parent_event_id": "event.lise.reads.ada.h08",
          "question": "How does Ada's stance on the offer divide between keeping the bakery and selling it?",
          "unit": "one unit of Ada's stance on the offer",
          "answers": [ { "key": "keep", "weight": 0.1, "meaning": "Keep the bakery and refinance the loan." }, { "key": "sell", "weight": 0.9, "meaning": "Accept the offer and clear the loan." } ],
          "provenance": ["invented: Lise's reading of Ada at hour 8, from what she saw at the counter"] }
      ],
      "context_roots": [ { "event_id": "event.lise.inner", "kind": "inner", "provenance": ["minimal-example"] } ]
    }
  }
}
```

## Where to go next

Read a graph back for revision with `life_narrative_query` in `full` mode with
`includeContent` and `forRevision: true`; the projection then contains only fields the
revise operation accepts. Move a graph to a successor model with `life_narrative_rebind`.
Add estimated Cuts to existing or new events with `life_estimate_cut_shares` or
`life_model_ingest`. To keep dated values of a process, file them as claims through
the estimation exchange and record them with `life_process_estimation_record`; the
"Record dated history" section of `life-sim://guide/general-modeling` gives a complete
claim. The storytelling add-on guide covers scenes, drafts and reviews.
