# Alien add-on

The bundled alien add-on runs the world-diversity search of *Ontology of the Alien*
inside Meaning Model. It builds invented worlds from seed words and solves a
problem inside each one. It compiles the operative mechanism back into the
problem's domain, and curates what the search finds in three revisable
ontologies:

- mechanism families;
- claimed outcomes;
- causal world regimes.

Diagnosing those ontologies informs which world to commission next; the choice
stays with the caller. Mechanisms
worth developing are then transferred onto a target model, with every role mapped
and every disanalogy stated. The mode is for ideation. A world is a textual
thought experiment, not a simulation, and a transfer records an idea and its
mapping, not evidence that the idea works.

Enable the add-on with `MEANING_MODEL_ADDONS=alien`, or together with storytelling
as `MEANING_MODEL_ADDONS=storytelling,alien`. When it is unset, the server keeps its
default tools, resources and prompts. The add-on adds no engine semantics. Every
record is a node in the Meaning Model narrative graph. Each ontology uses the
model's own concept and abstract-relation vocabulary, so it can be merged into a
model.

## Paper first

Read `life-sim://theory/ontology-of-the-alien` completely before starting or
continuing a search. The resource is a byte-identical snapshot of the paper, with
source digests in `docs/companions/ontology-of-the-alien/SOURCE.json`. The write
tools refuse until it has been read in the current MCP process:

- `life_alien_search_start`
- `life_alien_task`
- `life_alien_record`
- `life_alien_ontology_revise`

This is the same rule the modeling tools apply to the two theory papers. The read
is verified only within the live process, and it does not prove comprehension.
Building the target model follows the modeling workflow and its own paper-first
gate.

## Entry point

Settle four things with the user before starting:

- the problem statement and its context;
- the target model the ideas should land in, which can be built with the general
  modeling workflow if none exists;
- terms that would disclose the target to a world builder;
- who curates: the user, or the LLM under delegation.

Then call `life_alien_search_start` with the problem and either `modelHash` (a new
graph bound to the target model) or `graphHash` (an existing graph). It records
the problem as an author-scoped record, creates the search root and its
understanding root, and returns the target terms that builder tasks are checked
against. The `life_alien_start` prompt carries the same workflow.

The target model matters because transfers bind mechanism roles to its records.
A small model is enough to start: the actors, stocks, flows and events of the
problem domain. Mark its values honestly. An illustrative authored value is not
an observation, so its update mode should not say observed.

## Roles and what each may see

The method keeps roles apart by what they know. The server writes every task with
`life_alien_task` and stores the exact text in the graph, so the partition lives
in the task text, not in the caller's good intentions.

| Role | Receives | Never receives |
|---|---|---|
| `builder` | a seed word, optional departures and a commission's world ask | the problem, the purpose |
| `solver` | the recorded world, the problem statement and its constraints | the problem's context, why the world exists, the later transfer |
| `compiler` | world, solution and problem, plus the chosen population state | (nothing withheld) |
| `explorer` | the problem, optionally a random-word cue, and the chosen population state | worlds |
| `curator` | the problem, the mechanism or outcome ontology, and one candidate | (nothing withheld) |
| `world_curator` | the regime ontology, the signature codes in use, and one world | the problem |
| `transfer` | the problem, the target model's records and one mechanism | (nothing withheld) |

A single MCP caller already knows the problem, so partitioning the task text is
not enough on its own. Run builder, solver and world-curator tasks in fresh
contexts that see only the task, for example separate subagents. When that is
not possible, do the step yourself and record `same_context`. The world is then
target-blind by procedure only, and its record says so. Every world, solution,
mechanism and curator decision records the isolation actually used:
`fresh_context`, `same_context` or `human`.

The builder prompt keeps the original wording: the seed is the world's
"fundamental law of physics". That phrase is an instruction for world building,
not a scientific classification.

## The paper's conditions

The paper crosses three source frames with three population states. The add-on
can run every cell, and each mechanism records its condition:

| Source frame | No population state | Semantic Tabu (`tabu`) | Curated map (`map`) |
|---|---|---|---|
| Target only (explorer) | `target_only`, not run in the paper | A | B |
| Target plus a random-word cue (explorer with `cueWord` or `drawCue`) | C | D | E |
| World and in-world solve (compiler) | F | G | H |

- **Tabu** gives the fresh context every earlier candidate as JSON. It asks for the
  paper's inventory and an explicit list of approaches to avoid.
- **Map** gives the mechanism ontology, the claimed-outcome classes with their
  labels and operators, the thin branches, and the family and claimed-outcome
  combinations no candidate has yet, each named as well as cited.
- **Compiler default: F**, the open compiler. Condition H compiles with the map in
  view, as the paper's richest executed crossing did.
- **Explorer default: B.** A drawn cue comes from the word bank on its own sequence.

The diagnosis reports mechanisms and new families per condition. Comparisons
across conditions need matched budgets, which one search does not supply.

## The search loop

1. `life_alien_task` with role `builder`, then run the task and record its output
   with `life_alien_record` kind `world`, citing the returned `taskNodeId`.
2. Role `solver` with `worldNodeId`, then record kind `solution`.
3. Role `world_curator` with `subjectNodeId`, then record the regime decision and
   the world's causal signature with `life_alien_ontology_revise` (ontology
   `worlds`).
4. Role `compiler` with `worldNodeId`, `solutionNodeId` and a population state,
   then record kind `mechanism`.
5. Role `curator` with `subjectNodeId`, once for the `mechanisms` ontology and once
   with `ontology: "outcomes"`, then record both decisions with
   `life_alien_ontology_revise`.
6. `life_alien_search_diagnose`, then record a `commission` for the gap judged most
   useful. The next builder task takes its `commissionNodeId`.

Explorer proposals skip the world. A family that only explorers reach, or only
worlds reach, is itself a finding. Transfer the mechanisms worth developing (role
`transfer`, record kind `transfer`), assess them, and record a `selection` when
the user wants an answer. `life_alien_atlas` renders the whole search.

Every output cites the stored task it answers. The server reads the task record
and checks its role and text hash. It binds the world's seed, departures,
commission and target blindness from that task, not from the caller's account.
Stored tasks keep provenance intact when the task wording changes in a later
version.

A builder task produces one world, so each world keeps its own seed draw. Tasks
that never produce an output stay in the graph, and the diagnosis lists them as
attempts. Records made before tasks were stored carry a `taskRef`, which is still
verified by recomputation.

## Worlds

A random seed is drawn from a reviewed bank of 192 uncommon but real words. Rare
words displace ordinary premises more than the everyday words of the storytelling
bank. The draw depends on the search and a draw slot:

- Each world holds one slot.
- Each prepared builder task reserves its slot, so builder tasks prepared one
  after another draw distinct words. That is a parallel fan-out.
- The default is the lowest slot that is neither held nor reserved.
- An explicit `slot` re-prepares that draw, unless a world already holds it.
- `seedSalt` draws again. The world records the salt, so a re-draw is visible.
- A supplied `seedWord` is recorded as the caller's.

`operators` compose departures with the seed, following the paper's governed
generator:

- `stipulated_constraint`
- `ecological_history`
- `technological_path`
- `historical_branch`
- `institutional_inversion`
- `capability_removal`
- `capability_substitution`

Several can be combined. A new-world commission can supply operators and a world
ask, a relation the world should make ordinary without naming any application.

`oracle_premise` is the deliberate exception. It stipulates that one chosen part
of the problem is already solved and lets the solve work out what else is
needed. The task is then target-aware by design, and the world is recorded as
not target-blind. Oracle-premise worlds generate hypotheses about the remaining
requirements. For a technical or medical problem those need expert review.

The builder returns a title, a principle, rules numbered R1, R2, …, how people live
under them, and what is easy and hard. The world record keeps the builder output
verbatim and the rules as structured records (at most twelve), so later roles can
cite them.

## Target terms

`targetTerms` is the explicit list. Unless `deriveTargetTerms` is false, the server
adds the content words of the problem statement, leaving out a stoplist of common
and generic words. Context is not mined for terms, because background and meta
text raise false flags, so list any context terms explicitly.

Builder tasks, world asks and new-world commissions are checked against these
terms with simple suffix stemming. A match makes the builder task not
target-blind, and the world record and diagnosis report it. The check is a
heuristic flag, not a guarantee: paraphrase escapes it, and a generic word can
trip it. Add explicit terms for anything a builder must not see.

The compiled operator is also checked, because a mechanism stated in the target's
own terms cannot be compared across targets.

## Compiled mechanisms

A mechanism record holds:

- `operator`: the operative causal relation in one or two sentences, without the
  world's proper names or the problem's domain terms;
- `roles`: two to eight parts the relation needs, each with the world rules that
  supply it. At least one role must cite a world rule, and every cited rule must
  exist;
- `magicalElements` (up to 24): each with its fix, one of `invented_technology`,
  `existing_approximation`, `institutional_substitute` or `unresolved`;
- `strangest`: the strangest element, and how the candidate keeps it;
- `candidate`: the nine fields of the original schema;
- `selfAudit` (optional): bottleneck relief, final-outcome fiat and capability
  provenance, as coded in the paper's trace ledger;
- `isolation.compiler`.

The server records the source world or explorer, any retry commission and the
condition. It enforces the candidate field limits that the original prompts only
stated:

| Field | Characters |
|---|---|
| `label` | 40 |
| `design_principles` | 200 |
| `core_mechanism` | 200 |
| `how_it_works` | 500 |
| `what_is_new` | 200 |
| `why_it_works` | 300 |
| `why_it_fails` | 300 |
| `medium_term` | 200 |
| `long_term_vision` | 300 |

The fiat test matters. A world whose principal operation simply asserts, utters or
defines the desired end has not produced a mechanism, however vivid it is. Record
`fail`, and the diagnosis lists it.

## Curating the ontologies

`life_alien_ontology_revise` records one curator decision as a new immutable
revision of the `mechanisms`, `outcomes` or `worlds` ontology. Each revision
stores the full state and supersedes the previous one. `expectedHeadNodeId` must
name the current head (null for the first revision), so two curators cannot fork
an ontology.

The three ontologies classify different things:

| Ontology | Instances | A concept's `operator` states |
|---|---|---|
| `mechanisms` | mechanism records | the primary causal operator of the family |
| `outcomes` | mechanism records | the outcome the class claims to achieve for the people served |
| `worlds` | world records | the defining causal rule of the regime |

A concept has an id, a label, its operator, optional differentia, a boundary, and
roles. Concepts are organized by partitions. A partition divides a concept into at
least two more specific kinds under a named lens.

In the Meaning Model paper's terms a partition is concept specialization, not
expressive decomposition, so it is never an abstract cut. Several partitions can
open one concept under different lenses; the ontology is a set of lenses on one
space. Relations add `specialization`, `analogy`, `opposition`, `constrains` and
`other`. Two relations of one kind between the same concepts may state different
aspects.

Operations:

- `add_concept`, `revise_concept`
- `add_partition`, `revise_partition`, `remove_partition`
- `add_relation`, `remove_relation`
- `merge`: re-points instances, partitions and relations
- `split`: creates child concepts under a new partition and moves the listed
  instances
- `assign_instance`, `unassign_instance`

The server applies them in order to a copy of the head. It checks references,
distinct ids, at least two distinct children per partition, and acyclicity over
partitions and specializations. A merge that leaves a partition with one child is
refused until the partition is restructured. Concept limits are 200 characters for
the label, 1,200 for the operator, 800 for each differentia and 2,000 for the
boundary. The curator tasks state these limits.

An instance's fit is categorical: `clear`, `partial`, `borderline` or none. A free
number would be a semantic number without a question, unit or remainder, which the
Meaning Model does not admit.

Verdicts:

| Verdict | Meaning | Server rule |
|---|---|---|
| `admit_new` | a new concept | names a concept created in this revision. Once the ontology has concepts, it names the nearest one and an equivalence test with `primaryOperatorChanged: true` |
| `admit_instance` | an instance of an existing concept | names an active concept |
| `equivalent` | an alias: only the name, actor, parameter or input signal changed | equivalence test with `primaryOperatorChanged: false`; recorded as an alias |
| `reject_redirect` | an occupied family, or a shallow restatement of a regime | names the nearest concept and the relation the next proposal must change. Writes a commission in the same batch: a retry of the same world or explorer, or a new world |
| `restructure_only` | category work without a subject | at least one operation |

The equivalence test separates changes of name, actor, parameter and input signal
from a change of the primary operator. Only the last admits a new concept. This is
the paper's guard against relabeling: unique strings are not unique mechanisms.
The judgment itself stays with the curator. The server checks that the recorded
test and the verdict agree, and never decides equivalence from text similarity.

For the `worlds` ontology, the world curator also codes the world's causal
signature on the paper's axes:

- temporality
- conservation
- agency
- identity
- scarcity
- information flow
- boundary structure
- permitted transformations
- enforcement

Each axis gets a code of at most 80 characters, reused across worlds that agree,
plus an optional note of at most 600 characters. Null means the world does not
settle the axis. The world-curator task lists the codes already in use, and
diagnosis compares codes, never notes. This is the proposed world-population
ontology. It makes seed diversity and causal-regime diversity separately visible
while staying target-blind.

A retry that picks one of the curator's named alternatives shows responsiveness,
not discovery. The redirect records its alternatives, so a later reader can tell
the two apart.

### Graded membership

A candidate can sit between families. Beside its categorical assignment, the
curator may record a graded membership with `set_membership`: a question, a unit,
shares over the concepts the subject draws on, and a remainder, summing to one. It
is a Cut in the Meaning Model's sense, not a probability. A new `set_membership`
for the same subject replaces the old one, and `clear_membership` removes it.
Merging two concepts folds their shares together. A merge that would leave a
membership over a single concept is refused, as a partition left with one child
is. Diagnosis lists hybrids: subjects with at least a fifth of their membership in
each of two or more families.

## A second judge for curator decisions

`life_alien_decision_check` asks a second judge about a recorded decision. It
poses the comparison the curator faced as bounded questions:

- which concept that existed before the decision is nearest to the candidate's
  primary operator (for outcomes, its primary claimed outcome);
- against the concept the curator compared with, whether the primary operator
  changed, or only its name, actor, parameter or input signal;
- how well the candidate fits the concept it was assigned to.

The judge sees the candidate and the concepts, never the curator's explanation or
rationale. With `MEANING_MODEL_ESTIMATOR=typesafe`, Jev answers and the result
reports agreement for each aspect; with `record`, the check is stored as a
`decision_check` record linked to the revision. Without an estimator the tool
returns the questions for a fresh context to answer. Diagnosis counts checked
decisions and lists disagreements.

The check audits a decision; it never changes the ontology, and a disagreement is
a reason to reread, not a verdict. It addresses the limitation *Ontology of the
Alien* states for its own study, a single unblinded coder, with a judge from a
different model family.

## Diagnosis and commissioning

`life_alien_search_diagnose` reads the search at one revision and reports:

- crowded and thin families and roots;
- saturation: decisions since the last new family. This is a signal about the
  current source of proposals, not proof that the space is exhausted;
- redirect chains: a rejection, its commission, and whether an admitted retry
  changed the primary operator;
- undecided mechanisms, and mechanisms without a claimed-outcome class;
- uncombined pairs: family and claimed-outcome combinations that no candidate
  realizes yet, among occupied families and outcome classes. These are the paper's
  uncombined mechanism–outcome pairs, which can become search prompts;
- mechanisms and new families per condition;
- isolation used, and worlds whose builder task was not target-blind;
- coverage of the world-signature axes, including axes on which every coded world
  agrees;
- ex-post mechanism yield per world, meaning new families per world. This is kept
  apart from the ex-ante diversity of the worlds themselves;
- regime-family combinations, families reached without any world, and worlds that
  yielded no admitted mechanism;
- self-audit tallies and fiat failures;
- open commissions and unused tasks;
- undeveloped branches: families with instances but no transfer or assessment.

It returns a `diagnosisHash`. A `commission` record may cite it, and the server
recomputes the diagnosis at that revision to check it.

Which gap matters is the caller's judgment. A commission is addressed to one of
two recipients, and may name families to avoid:

- a new world: a `worldAsk` and optional `operators`, checked for target terms;
- an explorer: a `relationToChange`.

## Transfer to the target domain

A transfer maps one mechanism onto the bound target model. Every role of the
mechanism appears exactly once, bound in one of three ways:

- `model`: a record ref such as `process:household.buffer_nok`, `referent:…` or
  `event:…`, with how the record plays the role;
- `new_component`: what the domain would need that the model lacks;
- `unfilled`: the reason the analogy has nothing here.

At least one role must be bound or be a new component. Model refs are resolved
against the model; where the graph has an anchor kind for them, they become
grounding edges.

A transfer also records:

- proxies, each dated, because what is magical today may be portable later.
  Each is labeled one of:
  - `portable`: achievable with present means;
  - `inverse`: the domain needs the opposite effect;
  - `magical`: no present means;
- at least one disanalogy;
- the candidate in the domain's own terms;
- an optional fit Cut;
- the evidence needed before anyone relies on the idea.

A graded fit follows the Meaning Model's rule for semantic numbers. It is a fit
Cut: a declared question and unit, divided among `matches`, `doesNotMatch` and an
unresolved `remainder` that sum to one. It is not a free score, and it may be left
unscored.

Transfers are where manufactured analogy is most tempting. Role alignment can
manufacture apparent similarity, as the paper warns. Unfilled roles and stated
disanalogies are part of a good transfer, not a failure of it. An analogy relation
in the ontology records a claim, not a finding. To test a transferred mechanism,
model it in the target model with the general modeling tools and compare explicit
alternatives.

## Selection and Alien Preservation

A `selection` answers the user's question in one of three formats:

- `single`: one mechanism or transfer;
- `portfolio`: a structurally diverse top-k set for human review;
- `weighted`: an allocation Cut. It names what is divided (`allocation.question`
  and `allocation.unit`, for example the next development budget), gives each item
  a share, and keeps an explicit `allocation.remainder`. The shares and the
  remainder sum to one. They divide the declared unit; they are not calibrated
  probabilities.

`preserved` names families kept alive on purpose.

Alien Preservation is the paper's requirement that an unusual branch gets enough
development and testing before familiarity or early feasibility judgments may
eliminate it. The diagnosis lists undeveloped branches for this reason. A
familiar-sounding mechanism is not better evidence than a strange one.

## World libraries

Builders never see the problem, so a target-blind world is reusable by any search.
`life_alien_worlds_export` writes a content-addressed library
(`meaning-model-alien-world-library/v1`) with, for each world:

- its text, rules, seed, builder isolation and text hash;
- its regime classification and signature codes;

and the regime ontology itself. Worlds built from an oracle premise or with target
terms are left out and listed.

`life_alien_worlds_import` records the worlds in another search as
`<prefix>.<source id>`, so that search starts at the solver. It checks the bundle
hash and each text hash, and checks each world against the new search's own target
terms: a world that happens to name them is recorded as not target-blind there.
Imported worlds hold no draw slot. With `includeRegimes`, an empty regime ontology
receives the library's regimes and the worlds' classification as one revision
whose curator isolation is `imported`; otherwise classify the imported worlds with
world-curator tasks. Diagnosis counts imported worlds and uses their signatures for
coverage.

Reuse trades diversity for cost: searches that draw on the same library share its
premises. Use the coverage map to see which regimes are missing, and commission
fresh worlds for them.

## Reading the search

`life_alien_atlas` renders the search as Markdown:

- the problem, if the caller's scopes can see it;
- the three ontology trees with operators, partitions and instance counts;
- worlds with seeds, departures, isolation and rules;
- solves, and mechanisms with their conditions and curator verdicts;
- transfers with role maps, disanalogies and any fit Cut;
- commissions and selections.

`includeWorldTexts` adds the full builder and solver texts.

The atlas also returns each ontology as Meaning Model `concepts` and
`abstract_relations`, ready to merge into a successor of the target model:

- concept ids are prefixed with the search and ontology;
- roles become the concept's `state_schema`;
- the operator leads its differentia;
- a partition becomes specialization relations from the parent to each child, and
  its lens becomes a differentia of each child;
- a typed relation keeps its kind without a label, because the engine admits a
  label only on `other`. Its aspect note moves to the relation's provenance;
- `abstract_cuts` stays empty, because abstract cuts are reserved for
  decompositions into components.

The Markdown is an export of the graph, never a parallel record.

## What the server checks and what it does not

The server checks:

- stored task provenance and role, and one world per builder task;
- rule citations and role bindings;
- candidate field limits;
- ontology references, partitions and acyclicity;
- the admission guard, and that the verdict agrees with the equivalence test;
- the head chain;
- model refs in transfers, and role coverage;
- Cut sums in fit Cuts, weighted selections and graded memberships;
- library bundle and world text hashes, and each imported world's target terms
  in its new search;
- diagnosis hashes;
- target terms in target-blind tasks;
- that the paper has been read in this process.

It does not judge:

- whether a world is coherent;
- whether a solve uses the world's rules rather than fighting them;
- whether two mechanisms are equivalent;
- whether a transfer's analogy holds;
- whether an idea works.

Those are the caller's or the user's judgments, recorded as Understanding Nodes
with their reasons.

The mechanisms this mode yields are hypotheses. A world premise used as a design
specification still has to be approximated by real means. The paper's evaluation
questions remain open:

- whether governed world coverage finds more useful mechanisms per unit of compute
  than random words alone;
- whether the curator's categories track real structure.

A search records enough to study them: tasks, seeds, isolation, conditions,
decisions and yields.

## Configuration

`MEANING_MODEL_ADDONS=alien` enables this add-on. It has nine tools:

- `life_alien_search_start`
- `life_alien_task`
- `life_alien_record`
- `life_alien_ontology_revise`
- `life_alien_decision_check`, the second judge
- `life_alien_search_diagnose`
- `life_alien_atlas`
- `life_alien_worlds_export`
- `life_alien_worlds_import`

It also adds:

- this guide, as `life-sim://addon/alien`;
- the paper, as `life-sim://theory/ontology-of-the-alien`;
- the prompt `life_alien_start`.
