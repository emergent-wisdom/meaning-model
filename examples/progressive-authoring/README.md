# Progressive authoring in Rust

Run from the repository root after `make build`:

```sh
node examples/progressive-authoring/run.mjs
```

The example uses an isolated in-memory session. It refuses to run with
`LIFE_SIM_STATE_FILE` set, so it cannot add demonstration records to your database.
The native world-revision tests separately cover SQLite reopening and continued history.

Start with a ten-day outlook Cut: hopeful .58, threatened .32, remainder .10.
After accepting a day of world history, open its description:

1. Reject an eight-day child with .80 hopeful share. It alone contributes .64,
   already exceeding the parent's .58. Both Cuts normalize; their relationship fails.
2. Accept an eight-day child with .60 hopeful share, leaving the rest unopened.
3. Add the last two days at .50 hopeful share. Their duration-weighted mixture is .58.
4. Deliberately revise the ending to .40 and its parent to .56. This is **Revise**,
   not refinement, and it records the old head, new head, reason and provenance.
5. Continue the same world. The previous models and revision receipt remain accessible.

The example also changes a real-unit cash balance explicitly. Its GBP value is not a
Cut weight. The outlook numbers are authored comparison shares, not measurements,
calibrated forecasts or a claim about a real person's psychology.

Only an explicitly declared temporal contract imposes the mixture equation. Ordinary
containment may describe overlapping episodes and does not silently impose a partition.
This checks numerical consistency, not whether the explanation or story is plausible.

The model files carry historical descriptions while the world advances through time;
opening them here is an authoring operation, not information automatically available to
a character. Portable project/checkpoint/training exports of histories spanning these
model revisions remain unsupported; the database preserves the history instead.
