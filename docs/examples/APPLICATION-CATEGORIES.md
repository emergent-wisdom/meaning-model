# Develop the model your application needs

The Meaning Model supplies reusable record forms and revision rules. The
modeler supplies the domain: what to represent, which categories explain it,
what numbers mean, and how much detail is useful. A supplied template is one
starting program in this language, not the language's complete vocabulary.

## Use a developing account, not only a stored description

An AI can construct a process account and use it to compare explanations,
explore possible developments, or decide what to ask next. A browser might
model a user's evolving project and delegated tasks; a learning tool might
model how understanding changes through practice; a relationship application
might model expectations, interactions, and differing perspectives. These are
possible application designs, not a required person model or proven benefits.

This also offers continuity across interactions: the modeler can connect an
earlier account, intervening events, and a later state. A numerical change gives
it a specific transition to explain. An observed event, a new report, a declared
law, and a revised interpretation are different possible grounds for that
change. Preserve the distinction between a change in the represented world
and a change in the modeler's estimate of it. Where an explanation is missing,
leave an open question for further inquiry. Richer models can develop and test
more detailed accounts without silently replacing the earlier one.

The LLM or human performs this modeling and interpretation. The engine stores,
validates, and executes supported declared structures; it does not automatically
discover the right categories or certify an account of someone's inner life.
For real people, keep participant reports and modeler estimates distinct and
respect the agreed purpose, access, and correction boundaries.

## Choose a starting point

- Author one process directly when that is enough. Semantic records, a full
  person model, narrative graphs, Decision profiles, and writer machinery can
  remain absent.
- Use a structural starter for an identity and lifecycle, a relationship, or a
  shallow concept. `person_scaffold` with `level: "lifecycle"` creates only
  the person and life Event. `level: "processes"` adds the Book's nine concurrent
  life processes; omitting the level preserves that existing default. Those
  processes overlap and do not form a single normalized Cut.
- Choose the `story` or `decision` compiler when you intend to use its particular
  experimental assumptions. Story includes numerical tension, coherence, and
  progress with a progress law. Decision combines authored motives and mode
  weights, with independent options unless another law makes them exclusive.
  Inspect and define those meanings before using them; they are not generic
  truths about narratives or human choice.

You can adapt the ordinary model returned by a compiler before registering it,
or create a complete successor revision afterward. The compiler's template
parameters do not restrict the categories that direct model authoring can use.
Shared validation rules still apply: define comparisons and units, preserve
references and authority, and revise earlier commitments explicitly.

## Runnable example: change the categories, then use the account

From the repository root, or the root of the unpacked npm package, run:

```sh
cargo run --manifest-path rust-engine/Cargo.toml --example category_revision
```

This source example needs Rust/Cargo even if you installed a prebuilt server.
Its [source](../../rust-engine/examples/category_revision.rs) uses the engine's
actual registration, revision, and lookup operations in memory:

1. Compile a Thing starter for a learning project. It supplies identity and a
   lifecycle, not a psychology or practice vocabulary.
2. Author a Cut describing ten planned exercises: five not attempted, four
   attempted, and one not yet classified. Its unit is the share of those ten
   exercises, not a score of the learner's intelligence or understanding.
3. Replace `attempted` with `practicing` and `ready_for_review`, assigning three
   exercises to the former and one to the latter. Register a successor model
   with the predecessor hash and a reason for the change.
4. Retrieve both versions from the engine. The earlier vocabulary and values
   remain readable. An illustrative application policy uses the retrieved
   categories to propose the next question or review step.

The counts and policy are authored fixtures. This demonstrates an executable
revision and use of application-specific categories, not observed educational
improvement. The exercise set and snapshot remain the same: the revision changes
the account's vocabulary, not how much learning occurred. No world is created
or migrated by this example. Applying a successor to an existing world is a
separate operation with the compatibility and current-state requirements of
`life_world_revise`.

## Improve the representation as part of the work

Start with a question the application needs to answer. Use observations or
explicitly authored premises to construct an account, use it to guide a response
or inquiry, and compare the resulting expectations with later evidence. Revise
categories, process boundaries, or explanations when they fail to capture a
useful distinction. Combining categories or leaving a region coarse can be
better than adding detail.

For a narrative application, a candidate vocabulary should support coherent,
distinctive characters whose developments depend on the represented state;
compare alternatives and test relevant numerical interventions upstream of
generated descriptions. For a learning or assistance application, choose an
appropriate task outcome and compare with the existing approach. A revision
passing structural checks does not itself establish an improvement. Preserve
the earlier account and its evidence cutoff so the comparison can be made.
