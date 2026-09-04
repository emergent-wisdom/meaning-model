# Implementation boundary

The Meaning Model repository owns the grammar, joint construction method,
Rust engine, MCP interface, and accepted Book example. Life Simulation uses
this implementation for its separate process and learning program.

The engine is an integrated implementation with optional numerical simulation
capabilities. Its `life-sim-rust-meaning-model/v1` compatibility schema predates
the compact six-form grammar. Relocating it does not change serialized
identifiers, model hashes, or its level of conformance. Storing equivalent
authored information is not native conformance to every rule in the paper.

## What runs now

| Area | Implemented | Remaining limit |
| --- | --- | --- |
| Persistence and candidates | Immutable model revisions, hash-linked worlds, seeded numerical candidates, rejection, and atomic compare-and-swap acceptance | No single transaction spanning all world, understanding, and document changes |
| Authoring templates | Person, Thing, Relationship, Concept, and Change Arc scaffolds compile into ordinary model records | Templates are replaceable construction conventions, not universal categories or automatic world generation |
| Semantic records | Concepts, referents, Events with optional descriptions, bindings, typed relations, and grounding records are validated and persisted | Legacy fields and collections do not exactly match all six minimized forms |
| Normalized Cuts | Named question and unit, finite nonnegative sibling weights, explicit remainder, stable answer keys, acyclic conditioning, and sum-to-one checks | Complete temporal mixture closure and general progressive recomposition are not enforced |
| Perspective ancestry | Typed context roots, acyclic Contains paths, known interval containment, nearest-root agreement, and root-consistent conditioning | This is not authentication, evidence disclosure, or future-information filtering |
| Linked text | Immutable narrative graph revisions, typed model anchors, document rendering, and retained authored Understanding nodes | Original authoring transactions cannot be reconstructed from a later import |
| Numerical simulation | Existing scalar-process evolution and declared candidate mechanisms | No learned dynamics, automatic selection of laws, or demonstrated transfer to real populations |

See [the engine guide](../rust-engine/README.md) for the exact API and
[the conformance document](../rust-engine/MEANING_MODEL_CONFORMANCE.md) for
tested behavior. The preserved package and wire names begin with `life-sim`;
they are compatibility identifiers, not a second source of authority.

## How the Book uses it

The public example in `examples/book-of-conditions/` contains the accepted
world sources, local numerical Cuts, manuscript, event-linked construction
rationales, and import/render scripts. Its release import includes 107 authored
Cuts and one derived duration Cut. The published source manifest identifies
the exact inputs to that import; it does not claim to recover the order of
original authoring operations.

The person profile uses concurrent unweighted human Event-process domains.
A want names a desired condition. Graded concept judgments belong on
assessment Events and Cuts beneath the relevant perspective process.
Psychological values are sibling-relative shares; pounds, hours, dates, and
counts retain external units. Summary statistics are derived diagnostics,
not additional world facts.

The Book's 13 persons, other Things, relationships, and local vocabularies are
authoring choices. Their presence does not validate a psychology or require
another construction to use the same categories.

## Important gaps

- A referent's lifecycle is still optional in the compatibility host. The full
  profile's unique lifecycle, lifecycle-bounded participation, roster derivation,
  and inherited presence are not generally enforced.
- Older structural Cut collections coexist with `normalized_cuts`. The latter
  enforce local sums and conditioning, not the entire profile's recomposition
  contract or Direction-Cut execution.
- Legacy Realizations retain degree and attribution fields. The Book's
  unweighted links and separate fit Cuts are a construction convention; the
  legacy representation has not been removed.
- Event descriptions and declared Contains contexts are implemented, but
  full Event-native state/direction, all typed link contracts, and cutoff-safe
  context assembly remain incomplete.
- World, model, and narrative revisions follow separate mutation paths. Their
  individual atomicity is not cross-surface atomicity.
- Concept alignment, want satisfaction, forecast calibration, and natural-language
  read-back are not general engine-provided recognizers.

A breaking schema migration would require an explicit compatibility plan and
migration tests. This release makes no silent schema conversion and does not
promise that all missing behavior will be addressed by one migration.

## Evidence and scope

The standalone `examples/refinement-trial/` fixture exercises addressable
answers, a declared projection and duration mixture, residual feasibility,
rejection, revision, selected stale dependencies, and restricted perspective
access. No fixture result should be reported as native Rust conformance.
Its single saved prose extraction is not an independent reader study.

The Book is a completed manuscript and partial descriptive construction witness.
The preregistered matched comparison and independent read-back study remain
prospective. Passing tests establishes only the particular software properties
exercised; it does not establish historical truth, literary superiority,
psychological validity, predictive skill, empathy, or alignment.

The public package deliberately excludes private preparation, editorial reviews,
earlier candidate databases, and development conversations. This is an accepted
artifact release, not a claim that every construction checkpoint is public.
