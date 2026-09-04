# Story Modeling Profile

Use this profile after reading the current *Meaning Model* and *Life
Simulation* papers and the common modeling protocol.

## Purpose

Construct or reconstruct a story as one accepted world history before prose is
treated as authoritative. The model should preserve character continuity,
causal pressure, hidden history, viewpoint, and the distinction between world
chronology and narrated order.

## Minimum intake

For a new story, establish:

- setting and period;
- number of principal characters;
- approximate interval and scale;
- genre and intended emotional experience; and
- any premise, constraint, or ending that must remain fixed.

These are a useful default, not a mandatory questionnaire. Infer what is
obvious from the request and ask only questions whose answers would materially
change the model.

## Modeling sequence

1. Create stable referents for the world, principal actors, places, and
   identity-bearing objects.
2. Give each principal actor a sparse life-scale history before the narrated
   interval. Start with only the wants, fears, beliefs, relationships,
   capacities, and pressures needed to distinguish them.
3. Roll several coarse complete histories as facts: meetings, discoveries,
   decisions, losses, reversals, relationship changes, and consequences.
4. Reject inert, incoherent, or implausibly convenient candidates without
   contaminating canon. Accept one lineage.
5. Decompose the accepted history into acts, chapters, and scenes. Refine from
   the frozen accepted parent; do not silently contradict the life-scale path.
6. Advance relevant off-screen actors as well as the focal character.
7. Before prose, build a writer packet containing hard facts, important
   trajectories, causal explanations, viewpoint-indexed beliefs, hidden
   backstory, and soft or renegotiable fields.
   For a large model, retain a compact whole-graph skeleton beside the active
   causal neighborhood and every crossing boundary edge. The packet is a view;
   the complete Rust graph remains available for further traversal.
8. Let the writer omit surface mention of a parameter while preserving its
   consequences. If prose requires a contradictory fact, revise the model and
   rerun rather than hiding the conflict.
9. After each accepted scene, update later uncommitted possibilities while
   preserving committed history.

## Reconstruction mode

When modeling an existing work, exact source statements and actions remain
source authority. Internal states are alternative inferences unless the text
establishes them. Preserve narrator reliability, focalization, dramatic irony,
and narrative order separately from world chronology.

## Reader model

A creative run may model predicted reader knowledge, uncertainty, tension,
surprise, humor, attachment, or other responses. Reader state is a separate
observer process; it must not redefine what happened in the story world.

## Output contract

Every output should identify:

- accepted story facts;
- inferred or authored hidden state;
- alternative interpretations;
- hard, soft, optional, and renegotiable constraints;
- the causal explanation for important changes; and
- the resolution available if the user asks to zoom in.

The current software can execute authored trajectories and negotiate writer
constraints. It does not yet demonstrate that this method improves prose in a
blinded comparison.

The optional `life_profile_compile` MCP tool can translate the repository's
bounded Story authoring convention into an ordinary Rust model without
registering it. It is a convenience for explicit structure, not an automatic
story planner or prose generator.

Optional Decision profiles can be composed into that same model when a story
needs executable actor choice. They derive attraction, avoidance, commitment,
and action pressure from authored wants, fears, perceived options, habits, and
mode parameters. They are not mandatory personality types, empirical truths,
or Director authority over canon.
