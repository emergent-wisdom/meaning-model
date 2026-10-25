# A process given by a program

The example behind Appendix "A Process Given by a Program" of *The Meaning Model*: a process whose states are computed by a program instead of being recorded one by one. This is the fifth kind of value in the paper's working method.

**The office.** The first *Book of Conditions* construction gives a job 40 checker-hours and the independent checker 80 protected hours. Here those figures run as a monthly flow, an illustrative cadence. The organizer's rule and its threshold are invented to show the form; the runs do not reproduce the Book's events.

**The program** (`office.model.json`) holds three declared inputs and four computed processes. The inputs are the hours ordered, the checking capacity, and a switch that funds a second checker. The laws are:
- `backlog-flow` (evolution): the backlog grows by the hours ordered minus the hours checked;
- `queue` (relation): months of checking queued, the backlog divided by the capacity;
- `demand` (relation): the hours ordered per hour checked;
- `delivery-rule` (occurrence): while three months or more of checking are queued, the oldest job goes out unchecked, adding one to the count and removing its 40 hours from the backlog;
- `successor-funded` (occurrence, switched on only in the third run): from August 1852 it activates `second-checker` (gated relation), which doubles the capacity.

**Running it.**
```bash
node run.mjs
```
It needs the engine built from this repository (`rust-engine/target/release/life-sim-engine`), or its path as the first argument. It registers three versions of the model, rolls each world a year at a time from January 1852 to January 1855 (the engine advances at most 30 time units per roll), and commits each year. It writes every sample to `runs.json` and the monthly summary to `runs-summary.md`.

**What it computes:**
- **Two jobs a month:** nothing goes out unchecked.
- **Four jobs a month:** from April 1852 two jobs a month go out unchecked, half of all the work. That is the twofold demand-to-capacity ratio stated as a history: 18 by January 1853, 66 by January 1855.
- **Four jobs, with the second checker funded from August 1852:** nine jobs have gone out unchecked by then, and none afterwards.

No value in the summary was entered by hand.

**The boundary.** The current engine's laws are scalar: evolution, relation, occurrence, epistemic and resolution laws, which can be gated. A general program, such as code with its own data structures, would attach to a process in the same way, as a versioned law with declared inputs. It would run outside the engine, and its outputs would be recorded as typed values.
