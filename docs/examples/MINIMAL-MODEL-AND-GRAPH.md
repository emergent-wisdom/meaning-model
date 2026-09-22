# Minimal model and graph: complete valid payloads

Every payload below is verified by `mcp-server/test/friction-fixes.test.mjs` against the
bundled Rust engine, so it can be copied and adapted. It shows the smallest useful shapes,
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
normalized Cut needs an explicit `remainder` answer and weights that sum to one.

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
        { "id": "event.ada.state.h06", "boundary": "Ada's attributed attention state at hour 6, when the offer arrives.", "interval": { "start": 6, "end": 6.25 }, "participants": { "subject": "referent.ada" }, "process_ids": [], "observation_process_ids": [], "region": null, "substrate": null, "provenance": ["minimal-example"] }
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

## Where to go next

Read a graph back for revision with `life_narrative_query` in `full` mode with
`includeContent` and `forRevision: true`; the projection then contains only fields the
revise operation accepts. Move a graph to a successor model with `life_narrative_rebind`.
Add estimated Cuts to existing or new events with `life_estimate_cut_shares` or
`life_model_ingest`. The storytelling add-on guide covers scenes, drafts and reviews.
