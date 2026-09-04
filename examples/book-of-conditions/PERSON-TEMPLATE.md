# The loaded person template

This is the readable form of `PERSON-TEMPLATE.json`. It is the run-specific
profile loaded beneath every person's lifecycle Event. It is not a universal
theory of people; another Meaning Model may choose different questions or omit
the profile entirely.

The Rust tool exposes this coarse loading operation as the built-in
`person_scaffold` profile. Level `lifecycle` loads only identity and the life
Event. Level `processes` also loads the nine `IS` process addresses and may
open health. A caller supplies identity, lifecycle interval, and one life
description. Loading does not invent numbers, periods, or scenes.

```text
PERSON                                         Thing: persistent identity
└── LIFE                                       one Event: birth to death
    ├── DESCRIPTION                            coarse account of the whole life
    ├── PERIODS                                Sequential Cut over disjoint time
    │   ├── period 1                           duration-derived share
    │   ├── period 2                           duration-derived share
    │   ├── ...
    │   └── temporal remainder                 all shares sum to one
    │
    ├── IS                                     concurrent Event-processes
    │   ├── body                               growth, embodiment, capacity, aging
    │   │   └── health, when opened            illness, treatment, recovery, death
    │   │       └── condition Cut              healthy functioning · illness burden
    │   │                                       · remainder; sums to one
    │   ├── kin                                family, household, dependency
    │   ├── partnership                        participation in joint relations
    │   ├── work                               roles, projects, labor, duties
    │   ├── place                              residence, presence, access
    │   ├── means                              money, time, tools, capacity
    │   ├── knowledge                          perception, belief, learning
    │   ├── standing                           office, audience, recognition
    │   └── meaning                            constitutive aims and commitments
    │       These coexist and may overlap. They are not one Cut and do not sum.
    │
    ├── CORE-WANT OUTLOOK                     slow, period-level view
    │   ├── period outlook Cut                 one outlook unit; sums to one
    │   │   assured fulfillment · threatened fulfillment · unresolved
    │   ├── per-want outlook Cut               opened only for a live AtomicWant
    │   │   assured fulfillment · threatened fulfillment · unresolved
    │   └── threat-character Cut               conditional on threat; sums to one
    │       threatened belonging · threatened competence
    │       · threatened autonomy · threatened understanding
    │       · threatened well-being · remainder
    │
    ├── SELECTED SCENE                         opened only when the story needs it
    │   ├── WHAT                               motivational-attention Event
    │   │   ├── concern Cut                    one scene unit; sums to one
    │   │   │   belonging · competence · autonomy
    │   │   │   understanding · well-being · remainder
    │   │   ├── AtomicWant Cut per concern     conditional unit; sums to one
    │   │   │   preserve/create/transform/end a registered endpoint · remainder
    │   │   └── outlook Cut per opened want    conditional unit; sums to one
    │   │       assured fulfillment · threatened fulfillment · unresolved
    │   │
    │   ├── HOW                                problem-solving Event
    │   │   ├── module Cut                     framing · deciding · remainder
    │   │   ├── framing Cut                    concrete · abstract · remainder
    │   │   └── deciding Cut                   impartial · personal · remainder
    │   │
    │   ├── FEELS                              appraisal Event
    │   │   └── emotion Cut                    joy · sadness · fear · anger
    │   │                                       disgust · surprise · trust
    │   │                                       anticipation · neutral · remainder
    │   │
    │   ├── CONTEXT                            optional scene Cut
    │   │   self · named relationship · collective role · non-social target
    │   │
    │   └── DIRECTION                          possible next continuations
    │       mutually exclusive answers · outside/unknown remainder; sums to one
    │
    ├── INNER EVENTS                           contained beneath this life
    │   belief · appraisal · want · estimate · decision · action
    │   want → fulfillment outlook or threat belief → emotion → action
    │   remains a linked sequence of distinct records.
    │
    ├── RELATIONSHIP READINGS                  directional, beneath this life
    │   reliance · delegation · expected fulfillment/breach · repair/withdrawal
    │   No absolute trust score is stored.
    │
    └── SHOCK AND ADAPTATION                   links and trajectory annotations
        anticipation before event · perturbation · response · later settling
        drift · recovery · consolidation · instability · anticipated/terminal
```

## What the template means

- `IS` says what processes constitute the person's situation through time. A
  body process and a work process can both change strongly; forcing them to
  compete by default would destroy information. These process addresses have
  no semantic numbers. A separate crossing Cut may compare them as shares of
  attention, effort, or another named unit when that question is useful.
- Health is an optional opening inside `body`, not a duplicate top-level
  function. When opened, its condition Cut divides one unit between `healthy
  functioning`, `illness burden`, and remainder. Thus `.50/.50/.00` means an
  intermediate condition, not two simultaneous diagnoses. It is opened when
  illness, recovery, bodily capacity, or mortality changes feasible action or
  the meaning of another process.
- `WHAT`, `HOW`, and `FEELS` answer different numerical questions inside one
  selected scene. Their weights mean only what their parent question and
  siblings say, and every local Cut has a remainder and sums to one.
- The five concern families are the run-specific core wants. For each opened
  AtomicWant, an outlook Cut divides one unit between assured fulfillment,
  threatened fulfillment, and unresolved expectation. A coarse period outlook
  may divide the same kind of unit without opening every want. Conditional on
  threatened fulfillment, the threat-character Cut says which of the five core
  wants contains the endpoint believed at risk. This is a comparison among
  siblings, not an absolute scale of fear, confidence, or personality.
- Coarse outlook is a committed parent description. When it is opened across
  wants or disjoint shorter intervals, the weighted child mixture must recover
  the parent, with any unsupported part left in the remainder. A scene may
  depart sharply from its period baseline. Recovery leaves the next baseline
  substantially unchanged; consolidation changes it, with the intervening
  Events and an Understanding note explaining why.
- Fear is the appraisal that a wanted endpoint may not be reached, or that an
  attained endpoint may be lost. Threatened fulfillment is an outlook about a
  want; fear is a separate emotional composition inside FEELS. The same threat
  may instead produce anger, sadness, or another appraisal. If no active want
  is believed threatened, represented fear is zero. Every nonzero fear must
  link to a threatened AtomicWant or remain in the explicit unresolved
  remainder. Approach and avoidance, when useful, are strategies or actions,
  not the two poles of fear.
- A person's perspective is obtained by following the inner Event back to this
  lifecycle. It is not repeated as a generic field on every record.
- Scene Cuts may be mixed upward only through disjoint temporal children.
  Overlapping episodes never pretend to partition a life.
- Literal dates, pounds, hours, counts, locations, and physical values remain
  typed world data on Events. They are not semantic weights.

## Relationships

A relationship is a joint Event with both people bound as participants. It is
not buried entirely inside either person and is not assigned one truth-valued
trust number. The world Event records meetings, letters, shared work,
obligations, fulfillment, rupture, and repair. Each person's reliance,
expectation, and interpretation of that relationship is an inner Event-process
beneath their own lifecycle. Two people can therefore share one history while
understanding it differently.

## How it is loaded in this Book

`PERSON-INSTANCES.json` attaches this template to thirteen complete lifecycle
Events. Babbage, Lovelace, and Halden use the full profile because the story
depends on their decisions and development. The other ten begin with a complete
coarse life and the nine `IS` process addresses. Their scene modules stay closed
unless the selected story actually needs their knowledge, motivation, feeling,
or choice.

This is progressive detail in operational form: load the whole address space
immediately, fill the life coarsely, and spend depth only where a scene makes it
consequential.
