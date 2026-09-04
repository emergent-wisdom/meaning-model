# A small refinement trial

This is a **synthetic reference example**, not an export from the Rust host,
an additional historical claim, or a new Book candidate. Local minutes and all
outlook weights are invented. It uses a simplified apparatus trial to make a
few grammar contracts executable without requiring the companion repository.

Run from the Meaning Model repository root with Node.js:

```sh
node --test examples/refinement-trial/example.test.mjs
```

No packages, database, network access, or generated files are needed. `make test`
also runs these checks. The fixture is readable source, and every rejected
candidate is constructed in the test that rejects it.

## What is represented

`fixture.mjs` contains all six world record forms, plus one Understanding Node
and one Document Node. The Things are a Universe, a person, and an apparatus;
each has a lifecycle Event and subject Binding. The trial has a configuration
and case counts as typed world data. An outlook assessment under the person's
perspective has a normalized Cut. An unweighted Realization points from the
trial to a small frozen definition bundle. Its digest is SHA-256 of the exact
UTF-8 `JSON.stringify(grounding)` bytes in this fixture, **not a claim to Sema
canonicalization or minting**.

## Follow the expansion

The coarse trial lasts ten local minutes, tests twelve cases with twelve
matches, and uses configuration A. Those facts are protected by the witness.
Opening the trial yields preparation, execution, and comparison:

| Phase | Minutes | Duration share | Hopeful | Cautious | Fatigue | Remainder |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Preparation | 2 | .20 | .80 | .10 | .06 | .04 |
| Execution | 5 | .50 | .60 | .30 | .06 | .04 |
| Comparison | 3 | .30 | .40 | .50 | .06 | .04 |

The named fatigue component opens part of the coarse remainder. Mapping it
back into that remainder and averaging with the duration shares yields
`(.58, .32, .10)`, exactly the coarse outlook (up to the stated floating-point
tolerance). Slot addresses such as `['outlook@0', 'remainder']` resolve inside
the Cut record; they are not additional world records.

After only the first phase, the unexplained contribution is `(.42, .30, .08)`
with mass `.80`. It is feasible because no component is negative. A partial
opening that already allocates more hopeful mass than the whole parent is
rejected even if its own Cut sums to one.

## What the checks establish

The tests exercise finite lifecycle intervals, reference resolution, local
normalization, addressable slots, duration shares, the explicit projection,
partial residual feasibility, and side-effect-free rejection. They reject an
overlapping phase, a changed coarse outlook, a changed protected configuration,
same-ID overwrites, and a stale candidate base. An explicit revision from
configuration A to B keeps A in history, changes the selected branch head,
and marks the declared dependent passage and views stale. It does not claim
that the old passage describes B.

The private outlook belongs to Ada's context through authority parents. An
`about` link from the constructor does not grant access to that context. At
minute four Ada's accessible evidence contains only the configuration label
observed at minute three, not the final results on the referenced trial record.

`readback.json` records one extraction made in a fresh assistant context from
the passage alone. The tests replay a comparison against that saved extraction;
they do **not** rerun an LLM or contain a general prose parser. It recovers the
explicit configuration, counts, phase durations, and observation time. The
passage does not disclose the outlook weights, so their absence is recorded
rather than treated as successful recovery. A mutated configuration produces a
reported mismatch.

## Deliberate limits

`reference.mjs` is a small checker for this fixture, not a validator for every
legal Meaning Model. Its interval checks require finite positive intervals;
they do not implement unknown bounds or boundary Events. Its selected phases
fully tile their parent. Authority has one parent per record here, permissions
are explicit context allowlists, and revision dependencies are a declared
fixture set rather than an inferred general dependency graph. It does not
implement a database transaction, concurrent branches, a sampler, Sema, a
recognizer, or empirical calibration. The numeric tolerance `1e-12` handles
arithmetic, not human judgment uncertainty.

The runnable assertions demonstrate these bounded mechanics only. They do not
validate a psychological vocabulary, prove historical realism, establish
literary advantage, or close the Rust implementation gaps. A public archival
release URL and immutable release digest remain to be assigned before
publication; this directory is the repository-local artifact location.
