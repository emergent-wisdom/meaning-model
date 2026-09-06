# Optional Meaning Model conformance

The Rust engine can host a Meaning Model as the optional `meaning_model` layer
on a `life-sim-rust-model/v1` definition. Ordinary models omit that member and
retain the same serialized definition, model hash, physical process graph,
laws, persistence, and execution behavior they had before the extension. The
model schema remains v1. There is no process-wide "Meaning Model mode" and no
second execution engine: the nested member opts one model definition into
additional semantic structure.

This document separates representational conformance from executable
conformance. In particular, accepting a parallel or sequential cut as model
data does not mean that the engine schedules or executes that cut.

## Current conformance claim

The implemented layer is a **validated static Meaning Model host with one
genesis-only authored-refinement operation**. The semantic records remain
static declarations; the refinement operation changes which immutable model
revision an untouched world uses. When the optional layer is present, it can
record:

- reusable abstract concepts and typed specialization, constraint, analogy,
  opposition, or explicitly labeled abstract relations independently from
  concrete physical events;
- abstract decompositions under explicit, lens-bearing cuts;
- stable physical referents with explicit boundaries, continuity criteria,
  optional identity intervals and lifecycle events, uncertainty, provenance,
  and authority;
- time-scoped encapsulation cuts whose typed child relations retain their own
  uncertainty and provenance, together with an explicit unresolved residual;
- authoritative many-to-many event--referent bindings that keep the bound role
  separate from its binding type and may target either a semantic event or an
  executable state-bearing process;
- physical decompositions whose form is explicitly parallel or sequential;
- typed `define` and `describe` realization records between concepts and
  event/referent tuples;
- static cut-indexed canonical physical models through `define` records, whose
  required abstract cut and role-bound events may also name an aligned physical
  cut;
- separate role-to-event and role-to-referent bindings, arbitrary JSON
  parameters, degree, uncertainty, provenance, optional authority, and
  viewpoint on a realization;
- semantic events with explicit boundaries, optional intervals and context,
  optional bounded descriptions, and optional references to the existing process graph, which remains the physical
  execution substrate;
- typed `contains`, `causes`, `enables`, `prevents`, `constrains`, or explicitly described
  `other` event-to-event relations with uncertainty, provenance, and optional
  authority;
- normalized question/unit allocations with stable answer keys, explicit
  remainder, optional component conditioning, and provenance;
- optional temporal Cut contracts that check declared answer projections and
  duration mixtures against a committed parent, including partial residual feasibility;
- optional typed context roots over Events, with nearest-root ancestry derived
  only from acyclic Contains relations; and
- an optional `report` or `strict` semantic-coverage policy over declared
  events, including provenance-bearing unresolved allowances.

The nested definition uses `life-sim-rust-meaning-model/v1` and contains
`concepts`, `abstract_relations`, `abstract_cuts`, `referents`,
`encapsulation_cuts`, `events`, `event_relations`, `event_referent_bindings`,
`physical_cuts`, `realizations`, `normalized_cuts`, `temporal_cut_recompositions`,
and `context_roots`. All thirteen collections default to empty, but
a present layer must contain at least one concept, referent, or event; use
omission, not an empty object, to opt out. Referent-only and event-only partial
profiles are valid, and neither every event nor every referent is required to
have a binding or lifecycle event. Event-to-concept coverage also remains
optional unless the model explicitly supplies `semantic_coverage`.

The nested schema remains v1 because the semantic layer is shipping as one
coherent first version and the new collections are defaulted additions.
Ordinary models that omit `meaning_model` retain their existing normalized
definition and hash. The later-added `event_relations`, `normalized_cuts`, and `context_roots` collections are also
omitted from canonical serialization when empty, so models with an existing
Meaning Model that do not supply these collections retain their exact normalized
definition and model hash. Supplying an explicit empty collection normalizes to
the same representation as omitting it. `temporal_cut_recompositions` follows
the same default-empty, omit-empty rule, preserving existing hashes.

The nested semantic data is part of the complete model definition. It is
therefore covered by the ordinary model validation, canonical model identity,
immutable revision, retrieval, and optional snapshot-persistence paths. It is
administrative model data, not observer-projected world state.

The current contract is structural: identifiers are checked for uniqueness;
references must resolve in the appropriate graph; semantic event process IDs
must resolve in the physical process graph; realization roles must resolve in
their separate event or referent namespace; and encapsulation/binding targets,
lifecycle events, direct process targets, and both endpoints of every event
relation must resolve. Event relations require distinct source and target
events, unique bounded ids, a built-in kind or a description for `other`, and
validated uncertainty, provenance, and optional authority. Multiple records
may connect the same event pair so competing or independently sourced causal
claims retain separate identity. Abstract/event cut children and encapsulation
child relation records must be unique and distinct from their parent. The same
referent may recur in distinct typed or time-scoped encapsulation records, such
as membership before and after an absence. Abstract and event cuts contain
between two and 2,048 children; an encapsulation cut may contain one to 2,048
typed children. The abstract specialization/cut graph and physical event-cut graph
must be acyclic. Encapsulation is deliberately not flattened into one global
DAG because alternative lenses and time scopes may cross; the host validates
each record's references, self-relation, duplicate children, and temporal
scope, but does not choose an active frontier or reconcile overlapping cuts.
A legacy `define` record selects an abstract cut whose parent is the record's
concept. A `define` with `degree: 1` may instead bind a canonical Event that
parents a normalized Cut, without adding artificial abstract child Concepts.
Text, provenance, uncertainty, authority, degree, finite ordered
intervals, and interval containment for referent relations are also validated.
When both sides declare event intervals, every physical-cut child interval must
lie within its parent interval. Sequential children with declared intervals
must have nondecreasing start times in authored order; overlap remains allowed,
and missing intervals remain valid. Parallel cuts impose no chronological
ordering. By default, no rule requires exhaustive coverage or a non-overlapping
partition.
Those checks reject malformed declarations; they do not establish that an
authored identity, concept, cut, grounding, or uncertainty claim is empirically
correct.

Normalized Cuts are a separate opt-in collection from the legacy abstract and
physical Cut records. Each names an existing Event, a nonblank question and
unit, and 1–2,048 unique keyed answers including the reserved `remainder` key.
Weights must be finite, nonnegative, and sum to one within `1e-9`; no automatic
renormalization conceals a mismatch. Conditioning names an existing Cut and
answer key, including zero-weight answers or the remainder, and cannot cycle.
The immutable model hash plus Cut id and answer key locates that component.
Cuts and answers are sorted by key for canonical hashing. By itself this validates
local accounting, not semantic exclusivity, elicitation quality, or recomposition.

`temporal_cut_recompositions` adds an explicit bounded static contract. Each
record names a unique `parent_cut_id`, 1–2,048 `children` with `cut_id` and
`projection`, required `coverage` (`complete` or `partial`), and provenance.
The child and parent Cuts must have identical question, unit, and conditioning;
when context roots are declared, they must share their governing root. A
`{"kind":"identity"}` projection additionally requires identical answer
support. A `{"kind":"answer_map","answers":{"child_key":"parent_key"}}`
projection must map every child key, including zero-weight keys, to an existing
parent answer. Several fine answers may map to one coarse answer, and child
`remainder` must map to parent `remainder`. These are authored semantic
declarations: matching strings and support do not establish empirical validity
or exclusivity. Models without context roots cannot verify governing perspective.

The Cuts' parent Events supply finite, positive-duration intervals. Child
intervals must lie inside the parent's interval and have no positive-duration
overlap; adjacent endpoints may coincide. Complete coverage must exactly tile
the parent without gaps. Shares are derived as child duration divided by parent
duration. For each parent answer, the sum of projected child shares must equal
the committed parent weight within `1e-9`. Partial coverage permits gaps, but
the committed vector minus the known contribution must remain componentwise
nonnegative within `1e-9` and its total must equal the uncovered duration share
within `1e-9`. No residual vector is invented or stored and no weights are
renormalized. Explicit compatible Cuts over uncovered intervals can complete
the partition. Conditioning and temporal contract edges together must be
acyclic. Contracts sort by parent Cut id, children by Cut id, and answer maps
by key for canonical hashing. Ordinary Contains relations, physical Cuts, and
overlapping descriptive episodes assert no such numeric contract.

Context-root declarations name existing Events and one of `accepted_world`,
`inner`, `understanding`, `document`, or `candidate`. If any roots are declared,
all Contains relations must be acyclic and respect interval containment when
both intervals are known. Every Event must have a declared root or resolve all
upward Contains paths to one nearest root; traversal stops at a nested root.
Other relation kinds, including causal and descriptive about links, cannot
grant authority. Conditioned Cuts must share their parent's governing context.
Without root declarations, legacy ancestry remains unenforced. Missing
intervals do not constitute tested temporal containment. The new static checks
do not implement access control, evidence disclosure, modality, or temporal
cutoff queries, and do not retrofit the old Realization schema.

Static Events may omit executable process bindings. An optional nonblank
description is bounded to 64 KiB and preserved under the existing whole-model
size, hashing, revision, and persistence contracts.

When semantic coverage is enabled, a nonzero-degree realization directly
covers the events named by its roles. If it names a `physical_cut_id`, the
parent and immediate children of that cut are also covered; members not already
direct are classified as inherited. Unrelated cuts and deeper nested cuts are
not followed implicitly. A remaining event may be declared unresolved only
with a bounded reason and nonempty provenance. `report` mode returns direct,
inherited, unresolved, and orphaned ids and counts. `strict` mode requires the
orphaned set to be empty. A retained unresolved declaration may later be
superseded by direct or inherited coverage, preserving immutable provenance
while allowing progressive articulation. This is coverage of events declared
in the compiled static model. The present engine cannot claim coverage of only
accepted runtime occurrences because it has no occurrence-to-semantic-event
identity record.

Conceptual decomposition is represented by an `abstract_cut`, not by a binary
abstract relation. A sequential cut preserves its authored child order;
abstract, encapsulation, and parallel children are canonicalized because their
input order has no declared meaning.

## Optional authoring profiles

The read-only `compile_profiles` operation can compose optional Story, Person,
and Decision authoring conventions into one ordinary complete revision-0
model. It is a translation convenience, not a second schema or runtime, and
performs no registration or persistence. The Person convention emits one
referent and shared evidence event together with distinct external descriptive,
candidate actor-local, and self-reported graph views, scalar node positions,
claims, bindings, and `describe` realizations. Every compiled view is explicitly
an estimate or report rather than asserted latent operative organization. The
Decision convention compiles authored wants, fears or drives, perceived
options, strategies, attraction, avoidance, commitment, feedback, and action
marks into the same ordinary process and law IR.

This establishes that both the three-view convention and authored decision
dynamics fit the current host. It does not infer the views or decisions,
determine which candidate actor model is causally operative, interview a
person, enforce consent, execute graph topology, or validate a personality
interpretation.

## Genesis-only authored refinement

`refine_genesis_world` can replace one world's exact genesis with an already
registered direct-next model revision. It is accepted only when the current
head remains at version 0 and time 0 with no lineage and equals the current
model's reconstructed genesis. The successor must preserve the model id, time
unit, and every existing process, decomposition edge, dependency, law, initial
claim, and record in all thirteen Meaning Model collections exactly, subject to
the partial temporal-contract extension below. It may add new
records. An existing semantic-coverage policy cannot be removed, strict mode
cannot be weakened, and existing unresolved declarations are additions-only;
report mode may be strengthened to strict after the complete revised model
passes validation. Rust reconstructs the successor genesis under the same world id and
then independently verifies that every old state value and claim remains
unchanged.

Normalized Cuts, temporal Cut contracts, and context-root declarations are included in that preservation
audit. A partial temporal contract may add children or become complete while
retaining its parent, provenance, and every existing child projection. The
result must pass temporal validation; complete contracts remain unchanged.
This exception also applies to `revise_world` in `refine` mode. Once context
roots are enabled, introducing a new nearest root on an
existing Event also requires an explicit revision outside genesis-only
additions, because it would change the authority of existing descendants.

The replacement is performed through the same session mutation and optional
atomic persistence path as other authoritative operations. The response
reports the source and target revisions, conservation checks, and per-collection
preserved and added counts. A requested view is validated before replacement.
This is authored schema articulation before accepted time begins. It is not
automatic concept or cut discovery, execution of the declared cuts, adaptive
opening or pruning, or migration and reconciliation after a world has history.

## What remains physical execution

Processes, dependency edges, and the five existing law roles continue to
advance the world. A semantic event can point at that substrate, but the pointer
does not create a process or a law. If semantic state or direction must change
during a roll, the model author must represent it with ordinary processes and
executable laws.

An abstract `constrains` relation is likewise semantic model data, not an
executable constraint law. Event `observation_process_ids` identify authored
observation support; they do not estimate abstract state or create an observer.
An event relation is likewise an authored causal claim, not proof of unique
causation, a chronological guarantee, a scheduler edge, or an executable law.
The validator permits cycles between distinct events because feedback claims
may be intentional; temporal ordering must be represented and supported
separately.

The older event-local `participants`, `substrate`, and `region` values remain
free-form context annotations. They are not a second referential authority;
typed referent links live only in `event_referent_bindings`.
Likewise, a referent lifecycle link, encapsulation member, or event--referent
binding does not create an entity, change membership, schedule an event, or
update the target process. Dynamic membership and ownership still require
explicit executable process/law support.

Likewise:

- `define` records say that an authored event pattern operationalizes a concept;
- `describe` records say that a concept applies to an authored event pattern;
- a parallel cut records coactive or overlapping children; and
- a sequential cut records an authored order of children.

All four are validated declarations. None independently changes a candidate,
selects a path, fires a transition, or commits a world.

## Conformance matrix

| Capability | Current status |
| --- | --- |
| Models without a semantic layer | Implemented; remain ordinary Life Simulation models |
| Optional `meaning_model` member under the existing model v1 schema | Implemented |
| Nested `life-sim-rust-meaning-model/v1` schema validation | Implemented |
| Separate abstract-concept and physical-event namespaces | Implemented as model data |
| Stable referent identity, boundary, continuity, interval, and lifecycle link | Implemented as model data |
| Typed, time-scoped encapsulation children under alternative lenses | Implemented as model data |
| Authoritative many-to-many event/process--referent bindings | Implemented as model data |
| Distinct binding role and binding type | Implemented as model data |
| Typed abstract relations | Implemented as model data |
| Event boundaries, optional intervals, participants, and physical-process references | Implemented as model data |
| Typed uncertainty-, provenance-, and authority-bearing event-to-event causal relations | Implemented as static model data |
| Abstract and physical cut records | Implemented as model data |
| Explicit parallel versus sequential physical cuts | Implemented as model data |
| `define` versus `describe` realization purpose | Implemented as model data |
| Many-to-many event tuples represented by role-to-event bindings | Implemented as model data |
| Referent tuples represented by separate role-to-referent bindings | Implemented as model data |
| Static cut-indexed canonical physical models | Implemented through `define` realizations |
| Degree, uncertainty, provenance, authority, and viewpoint | Implemented as model data |
| Reference, uniqueness, cut-graph acyclicity, and structural-invariant validation | Implemented |
| Optional report-mode semantic coverage audit | Implemented for declared static events |
| Optional strict direct/inherited/unresolved event-coverage invariant | Implemented for declared static events |
| Accepted-runtime-occurrence semantic coverage | Not implemented; runtime occurrences have no separate semantic identity link |
| Inclusion in model hashing, revision, retrieval, and persistence | Implemented through the existing model lifecycle |
| Monotonic authored refinement of an untouched genesis world | Implemented through `refine_genesis_world`; direct-next revision and exact old-record/state/claim preservation are required |
| Bounded record, cut-child, process-reference, and realization-binding cardinality | Implemented; limits are reported by `describe` |
| Read-only Story/Person authoring-profile compilation | Implemented through `compile_profiles`; output remains an ordinary unregistered model |
| Distinct external, candidate actor-local, and self-reported Person views over shared evidence | Implemented as authored graph/scalar processes, claims, bindings, and `describe` realizations; latent operative truth is not asserted |
| Cut-driven scheduling or transition semantics | Not implemented |
| Automatic event instantiation from a concept | Not implemented |
| Executable canonical-model selection or concept-driven instantiation | Not implemented |
| Automatic expansion, aggregation, or residual construction | Not implemented |
| Bounded temporal normalized-Cut recomposition | Implemented for declared answer projections and disjoint duration mixtures; complete cover and partial residual feasibility checked against committed parent |
| General parent/child recomposition or commutation laws | Not implemented; the temporal contract does not supply an arbitrary law solver |
| Observer-specific abstract-state estimation | Not implemented by the semantic layer |
| Learning or discovery of concepts, functions, cuts, or realizations | Not implemented |
| Empirical calibration or truth validation of semantic records | Not implemented |

## Future executable-conformance threshold

Do not describe this layer as operationally conformant until tests demonstrate
at least all of the following:

1. a physical cut has defined execution semantics rather than only stored
   children and form;
2. expansion opens compatible fine state while retaining unresolved residuals;
3. aggregation maps fine state back to the parent representation;
4. recomposition is checked under an explicit query and tolerance;
5. sequential guards, branches, loops, and overlap have declared runtime
   behavior; and
6. accepted chronology still obeys the existing frozen-parent, whole-candidate,
   atomic-commit invariant.

Learning conformance is a further, separate claim. It requires held-out or
interventional evidence that the system proposes and promotes useful concepts,
directions, cuts, or realization records. Loading authored records, no matter
how detailed, is not discovery.
