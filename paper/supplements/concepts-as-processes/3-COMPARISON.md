# Can every concept be described as a process? Comparison and conclusion

Two attempts at the same pre-registered test (`1-PREREGISTRATION.md`):
- **mine** (`2-ATTEMPTS.md`);
- an **independent run** by a separate model (Claude Sonnet 5.5), given the same 17 concepts and criteria but not my predictions or attempts, and asked to look for failures (`4-INDEPENDENT-RUN.md`). It also tested three concepts of its own choosing that it expected to fail.

## Verdicts side by side

| Concept | Mine | Independent run | Agreement |
|---|---|---|---|
| trust | strong | strong | yes |
| recession | strong | strong | yes |
| promise | strong | strong | yes |
| prime number | weak (use, history) | weak (history; the convention on 1 is substantive) | yes |
| triangle | weak (fit of a tent) | weak (fit in a growing survey), substantive | yes |
| infinity | weak (history of its definition) | weak (history), substantive | yes |
| negation | weak (use, history) | weak (program output), **thin** | yes; it is stricter |
| nothing, absence | strong for absence of X; weak for "nothing" | weak (program output); "nothing at all" history only | definitional |
| red | weak (fit, measurement) | weak (a state of the fruit) | yes |
| larger than | strong (a computed relation) | weak (program output) | definitional |
| square circle | weak, nearly trivial | weak, **thin** (fit capped at .5) | yes |
| unicorn | strong in fiction, weak in reality | the same | yes |
| truth | strong for temporal claims | weak, **thin** (truth has no dynamics of its own) | definitional |
| beauty | weak (assessment) | weak (a panel's response) | yes |
| justice | weak (assessment) | weak (fit, Dreyfus) | yes |
| moment | weak (history of measurement) | weak, **trivial** (word frequency only) | it is stricter, and right |
| existence | strong (lifecycle) | strong, **trivial** (all change at the two boundaries) | yes |
| *its extra:* a bare identifier | — | **fail** | — |
| *its extra:* the passage of time | — | weak, history only, substantive | — |
| *its extra:* the thing-in-itself | — | weak, history only, substantive | — |

## What the two runs establish

1. **No concept with a grounding, an instance or a use failed.** Both runs found every one of the 17 can be written as a process whose values say what they measure. So did the independent run's two hardest additions, the passage of time and the thing-in-itself. The one clean failure is a bare identifier: a name with no grounding, no instance and no use. The paper already provides for it: "a category that cannot yet be given such values remains a concept."

2. **"Is a process" and "can be followed as a process" are different, and the sentence should not blur them.**
   - Only concepts that name something with a course of its own have instances that are processes: trust, a recession, a promise.
   - Existence is a process in this grammar (the lifecycle), but trivially: all its change sits at its two boundaries.
   - Everything else is followed through its life in a world: its fit to a changing situation, its use, or its history.
   - For several concepts that process is thin. The numbers belong to the door (negation), the claim (truth), the shape (square circle) or the word (moment), not to the concept.

3. **Computed relations are weak, not strong.** I had classed "larger than", absence and the truth of a dated claim as strong. The independent run classed them as weak, and I now agree: when a state is computed point by point from other processes, all its information sits in those processes. On my lenient reading, nearly every predicate would count as strong, which makes "strong" useless.

4. **"No single number of its own" is wrong as written.** Definitions carry numbers: 180° for a triangle's angles, the 90% surface threshold that defines a ripe tomato as "red", π. The true point is narrower. The numbers that vary over time belong to instances, situations and judgments at dates; a number fixed in a definition is not a state. The speed of light shows the line exactly. Its value was a measured, dated state until 1983, when it was written into the definition of the metre and became fixed.

## Answer to the question

Every concept can be followed as a process once something is attached to it. But only some concepts *are* processes. For the rest, the numbers describe the concept's life in a world rather than the concept, and for a few (negation, truth, a square circle, a moment) they say little about the concept itself. The author's "every concept has a number" holds in this precise sense: every grounded concept can be given numbers over time, through its instances, fit, use or history. It does not hold as one number per concept.

## The sentence for the paper, revised

The working-method paragraph would read (new sentences in bold):

> The hypothesis is also the working method of construction: every process the model opens carries its state across the span the work covers, in one of five kinds of value. A state may be a value with a real unit, one of a set of defined states, a reading on a defined scale whose anchors say what its values mean, a comparative share under a declared question, or the output of a program that computes the process from others. Assigning one of these forms to a person's inner state does not establish an intrinsic psychological intensity. Where nobody knows a state, the model guesses it, with an honest band and a tag saying what the guess rests on, so that the account is complete enough to test and its errors can be found. A world is generated this way down two trees at once: the tree of processes, opened from the highest abstraction by conceptual decomposition, and the tree of time, opened from the longest span into periods, each level guessed within the one above. A part found by conceptual decomposition must also pass a number test before it is opened: it must carry values over time whose meaning a reader can state. A category that cannot yet be given such values remains a concept rather than an opened process. **Nothing in the grammar keeps a concept from being followed as a process once it has a grounding, an instance, or a use. If the concept names something that changes, its instances are processes; otherwise what is followed is its fit to a changing situation (Section~\ref{sec:patterns-over-time}), its use, or its history. Either way the numbers say what they measure, and those that vary belong to instances, situations, and judgments at dates; a number fixed in a concept's definition, such as a threshold or a constant, is not a state.** A container, such as a person's body, holds processes rather than a value of its own: its state is the states of the processes inside it, and the test applies to them.
