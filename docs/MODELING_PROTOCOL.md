# Meaning Model Modeling Protocol

This document is the operational companion to *The Meaning Model* and *Life
Simulation*. It is a checklist for applying the theory, not a substitute for
understanding it.

The MCP resources serve the canonical Meaning Model manuscript from
`paper/meaning-model.tex` and the frozen Life Simulation companion from
`docs/companions/life-simulation/life-simulation.tex`. The companion's source
file digests are recorded beside it in `SOURCE.json`.

## Paper-first entry contract

An intelligent agent must read the complete current papers before its first
substantive modeling run, whenever the theory version changes, when entering a
new domain, and for consequential work involving a real person. The papers
explain why the distinctions exist, what they conserve, and where the claims
stop. A short protocol alone can encourage formally tidy but conceptually
wrong models.

For repeated work in the same domain within one live MCP process, the agent may
reuse the fact that both current paper resources were already accessed. The
server deliberately does not accept caller-supplied digests as proof of prior
reading, and the access record is not durable across restart. Resource access
still does not prove comprehension; uncertainty about interpretation requires
rereading the theory.

The order is:

1. Read *The Meaning Model* to understand concepts, referents, event-processes,
   direction, grounding, viewpoint, and semantic conservation.
2. Read *Life Simulation* to understand trajectories, claims, candidate
   worlds, accepted chronology, inference, and the distinction between
   sampled values and transition laws.
3. Use this protocol as the execution checklist.
4. Apply any relevant Story, Person, or Decision profile. Each is optional.
5. Inspect at least one worked example before creating a large model.

The MCP server exposes all five layers and the SHA-256 digest of each resource.
It records access to both complete papers in the current process and blocks
profile compilation until that gate is satisfied. It cannot verify that an
agent understood what it read.

## Common procedure

### 1. Declare purpose and authority

Choose one purpose before modeling:

- **creative fiction:** authored premises may become fictional canon;
- **source reconstruction:** source facts remain authoritative and completion
  remains visibly inferred;
- **self-reflection:** the participant owns corrections and access decisions;
- **observation:** measurements and reports retain their original authority;
- **forecasting:** every prediction is frozen at its evidence cutoff; or
- **counterfactual analysis:** the branch never silently becomes accepted
  history.

Do not mix creative invention with claims about reality without a typed,
versioned boundary.

### 2. Select interval, scope, and resolution

State what interval is being modeled, which part of the world is in scope, what
questions the model should answer, and the coarsest adequate resolution. Begin
with minimum sufficient explicitness. Add detail only when it changes an
answer, explains a residual, preserves continuity, or supports a declared
projection.

Optional expressiveness is an invariant. A valid run may contain one sampled
or generated process and no semantic, actor, causal-analysis, or writer layer.
Meaning Model records, Decision profiles, graph projections, reader models,
and writer contracts are added only when they serve the declared purpose.
Adding a view or analysis layer must not silently add canonical world state.

### 3. Identify continuing referents

Create stable identities for the people, groups, places, objects, or other
continuing things that the model must distinguish. Record uncertainty about
identity rather than silently merging or splitting referents.

### 4. Establish accepted event history

Represent what happened as ordered or overlapping event-processes. Preserve
temporal uncertainty, alternative segmentations, source order, and narrative
order where relevant. A possible event remains separate from an accepted one.

### 5. Separate evidence classes

Every material claim must be typed as one of the following, or an explicitly
defined extension:

- observed measurement or collected record;
- participant self-report;
- attributed report from another observer;
- derived statistic;
- AI inference or latent estimate;
- model completion;
- forecast or counterfactual; or
- creative premise.

Keep value or distribution, time, support, uncertainty, evidence cutoff,
holder or viewpoint, provenance, authority, and access scope together.

### 6. Propose a sparse explanatory model

Add only concepts and processes needed for the purpose. Candidate actor fields
may include wants, fears, concern, attachment, beliefs, strategies, decisions,
emotions, relationships, bodily state, and perceived options. These are
revisable hypotheses unless fictional canon or direct report gives them a
different authority.

For actors, distinguish three linked views:

1. **External event model:** what appears to happen to and through the actor.
2. **Candidate actor-local models:** alternative hypotheses about what the
   actor notices, means, wants, fears, believes, and considers possible.
3. **Reported self-model:** how the actor describes themselves.

The operative actor-local model is whatever organization actually conditions
the modeled action. Neither an external estimate nor a self-description is
automatically operative.

### 7. Prefer sampled trajectories before invented laws

If evidence supports values at particular times but not a transition function,
store the values, uncertainty, and interpolation assumptions. Do not invent a
law merely to make the series executable.

Add a generating function only when the mechanism is authored for a creative
world, supplied by a trusted domain model, or has earned credibility through
held-out prediction, intervention, compression, calibration, and stability.
The MCP estimation exchange supports both data-only provisional claims and a
separate, explicit proposal for a successor model containing new laws.

### 8. Preserve alternatives and residuals

Maintain competing explanations when the evidence cannot discriminate among
them. Mark unobserved, unknown, and unmodeled separately from zero. Record the
residual left by a decomposition rather than pretending the named children
exhaust the parent.

### 9. Test causal use and conservation

Change one relevant input while holding the parent, evidence cutoff, and other
conditions fixed. The predicted downstream state should change for a declared
reason. Change an irrelevant input and require stability. When opening or
closing resolution, require identity, accepted history, authority, viewpoint,
and query-relevant consequences to remain consistent.

### 10. Let the person or author correct the model

An intelligent agent may ask questions where expected information value
justifies the burden, but the interview policy is not hardcoded into the
engine. Corrections append or supersede claims with provenance; they do not
erase the fact that a previous estimate existed.

### 11. Produce a projection, not a total dump

Return the view requested by the user: an event graph, trajectory summary,
character portrait, story diagnosis, writer packet, forecast, counterfactual,
or unresolved-question list. State which facts are hard, which parameters are
soft, which hypotheses compete, and which details remain unmodeled.

For a large causal model, begin with `life_graph_query` in `skeleton` mode.
Open a `neighborhood` around a relevant process or law when more explanation is
needed. A neighborhood is a view over the same snapshot: it includes every
edge crossing its selected core and both endpoints, and it never replaces the
complete graph. The `full` mode remains available when the agent truly needs
the whole factor graph. Bind successive views with `expectedSnapshotHash` so a
world change cannot be mistaken for simple zooming.

When the output itself should remain linked to the model, use the optional
narrative/understanding graph. Begin with a complete node-and-edge transaction
through `life_narrative_register`. Use `life_narrative_batch` to add one or many
connected nodes and edges without resending the graph, or
`life_narrative_revise` when replacement or deletion requires a complete
successor. A one-node batch must connect to an existing node or stable anchor;
only the first declared root may stand alone. This lets the agent plan each
local topology together and lets Rust reject the entire transaction if a node,
edge, scope, order, stable-object anchor, nested path, or connectivity condition
is invalid.
Then use `life_narrative_query` in skeleton or neighborhood mode for ordinary
work and open the full graph only when necessary. The canonical story remains
in graph nodes; `life_narrative_render` is a derived document projection.

### 12. Preserve revision and persistence boundaries

New dimensions or laws require an immutable model revision. A rolled candidate
does not become reality until explicitly accepted. The Rust state-file mode can
persist accepted models, worlds, claims, paths, lineage, and immutable
narrative graphs with their exact source snapshots; the MCP paper-access gate
and other control-plane handles are not currently durable across server
restart.

To open compatible detail after accepted history, register a direct-next model
and use `life_world_revise` in `refine` mode against the exact current world hash.
Supply current values for newly introduced processes. If existing commitments
must change, use `revise` instead and state why; the engine retains both heads
in an immutable receipt. Explicit temporal Cut contracts check duration-weighted
recomposition, including whether partial detail can still complete its parent.
These arithmetic checks do not judge narrative plausibility. Histories spanning
world revisions persist in SQLite, but portable project/checkpoint and
accepted-history training exports across those boundaries are not yet supported.

## Fear, concern, and operative motivation

Modeling a state is not the same as adopting it. A character's fear, the Reader
Core's evaluation, and an AI system's operative motivation are separate
records. Fear should not be reduced to any prediction that a wanted future may
fail. A useful profile distinguishes:

- the valued future or protected target;
- believed obstruction, likelihood, imminence, and expected loss;
- attachment and perceived control;
- aversive urgency, arousal, and defensive narrowing;
- concern or care that remains action-guiding without self-protective panic;
- the strategies and actions actually selected; and
- whether each represented state causally affected those selections.

This permits an AI to model fear accurately while testing the separate
hypothesis that care, calibrated threat prediction, and proportional urgency
can remain operative without fear governing the policy.

## Safety boundary for person modeling

Personal models are structured, revisable hypotheses. They are not diagnoses,
mind reading, moral rankings, or permission to manipulate. Use explicit
consent, local-first storage where possible, access control, correction,
export, and deletion. A fluent explanation can still be wrong. High-stakes
clinical, legal, employment, credit, insurance, or coercive uses require
separate governance and validated domain practice beyond this protocol.

## MCP tool sequence

The required paper-grounded flow is:

1. `life_modeling_context` for ordered, version-bound reading.
2. Read both complete theory resources, then the protocol, profile, and example.
   The server refuses `life_profile_compile` until both paper resources have
   been accessed in the live MCP process.
3. For the supported Story, Person, or Decision conventions, optionally use
   `life_profile_compile` to obtain an ordinary complete model without storing
   it; otherwise author the model directly.
4. `life_model_validate` and `life_model_register` for a complete initial
   model. Profile compilation never performs registration implicitly.
5. `life_world_create` for an isolated world.
6. `life_estimation_request_create` and
   `life_estimation_response_submit` for data or candidate semantic changes.
7. Review explicitly; register any successor model separately.
8. Roll, inspect, compare, and reject or accept complete candidates.
9. Optionally use `life_candidate_route` to compare pending alternatives from
   one frozen parent, interval, and dynamics through explicit scalar
   actor/world-state preferences. Its recommendation is advisory and never
   selects an actor action or accepts canon.
10. If story text, character interiors, reader responses, or explicit
    authoring reflections should remain addressable beside semantic state,
    submit one complete graph revision with `life_narrative_register`. Add
    connected material atomically with `life_narrative_batch`, or use a
    complete hash-linked `life_narrative_revise` successor for replacement and
    deletion. Query at the smallest sufficient resolution. Externalized
    reflections are authored testimony, not hidden chain-of-thought.
11. Use `life_narrative_render`, writer contracts, or another authorized
    projection for the final output. A resolution-aware writer contract may
    include a whole-graph skeleton, one active causal neighborhood, its crossing
    boundary, and an exact route back to the full Rust snapshot.
12. Optionally use `life_narrative_training_export` to obtain deterministic
    text--state records from the exact bound snapshot. This exports data; it
    does not train a model.
13. If a reader reports a weakness, use `life_story_revision_diagnose` to test
    the least foundational repair in the order model, cut, trajectory, then
    rendering. It localizes supplied evidence; it does not score literary
    quality.

The server provides representation, validation, execution, and persistence
boundaries. The intelligent agent supplies interpretation and questions, and
must preserve the epistemic distinctions above.
