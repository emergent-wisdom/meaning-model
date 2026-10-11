# Breaking reality down into processes

Read this before you build. It shows how far down a Meaning Model goes. It starts with the Universe and ends with
one second inside one person, when a taste brings back a childhood. Every tree below was built, or is taken
directly from, a model an agent made with this tool: the world-history construction, the Ethereum model, and the
characters of two finished novels.

**This is the minimum you are expected to build.** You may carve differently, rename anything, replace a
category with a better one, and go much further: every node in every tree here can be broken down again, without
end. But the model you leave must be at least this deep:
- every person who matters to the work is broken down to this level, across their whole life;
- every institution, machine, document and place is broken down to its parts and followed over time;
- the world around them is opened to the levels the work depends on.

A model with one or two processes per person is not a model of those people. The previous Book of Conditions had
194 processes and 108 Cuts for 13 people. Twelve Words had 149 processes and 788 Cuts. Build at least that.

## Design your own trees

The trees in this document are examples of the depth expected, not a fixed list of categories. Your world may be
understood better through other ones. Design your own process trees for it: use a tree here where it fits, and
change it, extend it or replace it where your world is understood better another way.

Design them with the conceptual decomposition algorithm below. It is the best method we have now for finding the
parts a whole is made of. Climb before you carve, test every candidate part, search for what is missing, route real
cases through the result, and record each carve and its verdicts in the model, so it can be inspected and revised.

Two things are fixed:
- **The depth.** Whatever categories you choose, the model must reach at least the depth shown here.
- **The top of every person's life.** It carries the nine slow processes: body, kin, partnership, work, place, means,
  knowledge, standing and meaning. The coverage report checks every person in a story for them. Below them, beside
  them and everywhere else, the tree is yours to design.

## How to break anything down

1. **Start from the whole, and carve it into parts that together cover it.** Use Fractal Intelligence's conceptual
   decomposition, given in full in the next section. Keep a part only if all four tests hold:
   - it is necessary: without it something real would have no home;
   - it is independent of the others;
   - it is present in every case you mean;
   - with the others it covers the whole.
2. **There are two kinds of parts, and they become two kinds of record.**
   - **Dimensions that can all rise together** become separate **processes** with values of their own, recorded with
     `life_values_record`. A person's health, wealth and reputation can all be high at once, so each is its own
     process.
   - **Categories that compete for one unit** become a **Cut**: one day's attention, one person's motivation, one
     unit of belief, one budget. Recorded as a series with `life_series_record`, its shares sum to one, with a
     remainder for what the categories miss. Where a person's attention goes is a Cut.
3. **Open every part that matters into its own parts**, the same way, again and again. A tree that stops at its
   first level is a list, not a model.
4. **Follow every process over time.** Give it a value at the start, at the end, and after every Event that moves
   it. For a person, that means the whole life, from birth to death, not just the pages of the story.
5. **Tag every record:** `source`, `inferred`, `invented`, `exploring` or `sketch`. Guessing with an honest band
   is depth, not filler.
6. **Explain the numbers that carry meaning, and only those.** Give a value a note of a sentence or two, saying why,
   when it:
   - starts or ends a stretch;
   - turns, jumps or changes state;
   - sits at an Event;
   - breaks from what the values around it suggest.

   Alternatively, name the Event that moved it in that Event's `process_ids`. Say once, for each process, what its
   numbers mean. A value that only continues the line around it needs no note: explaining every date is noise. The
   values report lists the turns and jumps that still say nothing about why. For example:
   - Europe's share of the world's people, 1350: falls from 18% to 14%. The Black Death kills between a third and a
     half of Europe's people.
   - Laura's exhaustion, April 2019: rises. The unit's new rota puts her on more nights.

   A Cut reading always says why, in its own words.

The general carve for any Thing comes from the world-history construction. Every lifecycle, the Universe's
included, is opened by four questions:

```
Lifecycle of any Thing
├── Identity       what the Thing is, and what keeps it the same through change
├── Composition    its parts and members, each with a lifecycle of its own
├── Processes      what changes in the Thing over its interval
└── Interval       when it exists, and the order and duration of what happens in it
```

Ask all four of everything you model: a planet, a person, a company, a machine, a marriage, a book.

## The conceptual decomposition algorithm

This is Fractal Intelligence's operator, as its paper states it (*Fractal Intelligence: Conceptual Decomposition
as Problem-Solving Infrastructure*, Section 2), applied to building a Meaning Model. Use it for every carve: the
world, a person, a want, an institution, a machine, a moment. It does not ask "what are the steps to do this?",
which gives a procedure. It asks: **what differentiated dimensions must be addressed for this to exist and function
across every case it claims?**

**Use Sema while you carve.** From Sema 0.9.2, one card, `ConceptualDecomposition`, states this whole method. When
Sema is connected, resolve it as you carve, and cite it in the notes that record each carve and its verdicts. Its
steps have cards of their own, for when a step needs its full contract:

| Step | Card |
|---|---|
| The whole method | `ConceptualDecomposition` |
| 3. The four tests | `DecompositionGate` |
| 5. Route real cases through the carve | `RoutingSanityCheck` |
| 7. Where to go deeper | `MarginalValueRule` |

In vocabularies before 0.9.2, `ConceptualDecomposition` still names the solver-bound form, now `SolverDecomposition`.
Read it there for its steps, not for its requirement that every part be a solver.

Keep searching Sema as you build, not only at the start. When a value turns or a life changes, look for the mechanism
that drives it, use its mechanism and failure modes to check your account, and cite the pattern beside what it
explains.

### 1. State the claim frame first

Before carving, write down three things, and record them as an Understanding Node:
- **what the concept is**: the outward thing being promised, such as "a human life" or "what a life has at stake";
- **what the carve is for**: such as "to follow how a person changes across a whole life";
- **the range it claims**: such as "every person in this story, from birth to death" or "every human society
  from 300,000 years ago to now".

The frame makes "necessary", "universal" and "complete" checkable. It does not fence in ideas, and a later
finding may revise it.

### 2. Mandatory abstraction: climb before you carve

Locate the concept before decomposing it. Start from the specific concept and climb, one adjacent broader parent at
a time, to the root. At each step:
- name the **genus**, the broader kind it belongs to;
- name the **differentia**, what distinguishes it from its siblings;
- search for siblings that exist or plausibly could;
- insert an intermediate parent where it changes what you will see below.

Then walk the route back down in exact reverse, and carve the concept with the frame the ascent gave it.

```
Event                                  anything that occurs or persists over an interval
└── Lifecycle                          the whole existence of one continuing identity
    └── History of a part of the Universe
        └── History of a living population    its members are born, take in energy and die
            └── History of a social population    they live in groups that coordinate and compete
                └── History of a cultural population    they learn their behaviour from others
                    └── Human history      a population of Homo sapiens
                        └── one human life  ← now carve it
```

This is the world-history construction's ascent. A person's life sits at its foot, which is why a life inherits
the questions of every level above it: energy, groups, learning.

### 3. Generate candidates, and test each one

Generate candidate dimensions, more than you will keep. Test each against the four questions:

| Test | The question | If it fails |
|---|---|---|
| **Necessity** | Relative to what the concept promises, if this were removed, would the whole still work? If removing it makes the whole collapse, it is load-bearing. | Drop it, or move it lower. |
| **Independence** | Can this change or be redone without forcing the same change in the others? Zero interaction is not required, only low coupling. | If two candidates cannot vary or fail separately, merge them, move what they share up to the parent, or look for a better cut. |
| **Universality** | Does every case in the claimed range contain it? | A dimension found only in some cases, such as states, cities, writing, money or coal in human history, is a **kind** under a dimension, not a dimension. It can be a valid narrower carve. |
| **Completeness** | Taken together, with everything addressed, would you have a working instance of the whole? | Something is missing: search for it (step 4). |

A candidate that fails or stays uncertain is not deleted. Reframe it, narrow the claim, or keep it as a **labeled
frontier alternative** with its verdict and reasons. Later evidence may promote it.

### 4. Search for what is missing

Completeness is the hardest test to pass honestly, and the easiest to fake. The paper bounds the search at three
retries. Better still, test against an independent outside list made by someone else for another purpose:
- The world-history carve was checked against the Human Relations Area Files' Outline of Cultural Materials. All 78
  of its substantive categories found a home but one, and that one became a recorded frontier.
- A life's carve can be checked against any established list of life domains.
- A machine's carve can be checked against its maker's parts list.

### 5. Route real cases through the carve

Take concrete cases and send each to the dimension it belongs to. The paper uses three sample tasks; the
world-history construction froze 142 real claims before it carved.
That example is a methodological illustration, not an independent validation: the modeler wrote the sample knowing
the defects it was meant to expose. Use cases selected independently when testing a carve's generality.
- **A case with no home** shows a missing dimension.
- **A case with two homes** shows two dimensions that are not independent.

Freeze the sample before carving, so the carve cannot be fitted to it.

### 6. Write the synthesis

State how the children, together, make the parent work. If you cannot say how they combine into the whole, the
carve is not finished.

### 7. Recurse

Each accepted dimension is itself a concept. Apply steps 1 to 6 to it, and again below. The paper's
**marginal-value rule** decides where to put depth: deepen where the expected gain is worth the cost, and
concentrate on high uncertainty, brittle dependencies and large impact ("hard seams"). In a Meaning Model, the
minimum of this document always holds: the rule decides **where to go deeper than the minimum, never whether to
stop short of it**.

### Two different links, never to be confused

- **Specialization** (*is a kind of*): a madeleine is a kind of cake; a chiefdom is a kind of polity. It is
  open-world: there are always more kinds, and you never claim to have them all.
- **Composition** (*is a part of*, *is a dimension of*): health is a dimension of body; the boiler is a part of the
  locomotive. The set of parts is what you claim is complete.

The ascent climbs by specialization. The carve goes down by composition.

### When a carve goes wrong

- **A leaky seam.** The carve looks clean, but an assumption crosses the boundary: one dimension's readings
  silently depend on another's. Make the dependency explicit, as a relation between the processes.
- **A misaligned cut.** Things that must change together have been split apart. Merge them, or redraw the boundary.
- **A bad cut near the root.** It poisons everything below it. When the leaves keep struggling, such as values that
  will not fit or cases that route badly, go back up and re-carve the parent. Record the revision; never silently
  replace.
- **Fields are views, not levels.** Economic history, or a person's "career", cuts across dimensions. Record such a
  thing as a view over several dimensions, not as one more node.

### How the carve is recorded in the model

| Step | Record |
|---|---|
| The concept and its ascent | Concepts, with *kind of* relations up to the root (`life_model_revise`) |
| The claim frame, each verdict, the frontier alternatives, the routing sample, the synthesis | Understanding Nodes linked to the concept (`life_understanding_record`) |
| The accepted dimensions | An abstract cut from the concept to its children (`life_model_revise`) |
| Dimensions that can all rise together | Separate processes, each under the one it divides, with values over time (`life_values_record`) |
| Dimensions that compete for one unit (attention, motivation, belief, a budget) | The categories of a Cut, read as a series (`life_series_record`) |
| A category that matters | Opened into its own Cut, conditional on its parent's answer |

A worked example from Twelve Words carved what is at stake in a life:

- **The claim frame.** The concept is "what a life has at stake". The carve is for reading what a person sees as
  threatened. The range is every person, at any moment of any life.
- **The carve.** Seven dimensions: body and health; home and safety; the people they care for; self and meaning;
  standing and belonging; what they depend on; work and livelihood.
- **The four tests.** Each dimension is necessary, since without it some threat a person feels would have no home.
  Each is present in every life. Each can be threatened while the others are not. Together they leave no threat
  homeless.
- **In the model.** The carve became the categories of the "what is seen as threatened" Cut, read in every period
  and conditional on the outlook's "threatened" answer.

## There is no bottom

The trees below are a floor, not a ceiling. Every node in them, leaves included, can be opened again into its own
parts, and those parts into theirs, for as long as there is something to understand. Go deeper wherever any of
these lead:
- a question;
- a gap the model shows;
- a jump in a value you cannot explain;
- a scene that needs it;
- your own curiosity.

A pass ends, but the breakdown never does: another pass can always open further. Some examples of going further
than the trees in this document:

```
person → body → health → an illness (tuberculosis)
       → the lungs → cough, fever, weight, breath (each a process, by week)
       → each treatment tried, its cost, who paid, what it did

person → knowledge → what he knows about his brother's debts
       → each debt → when she learns of it, from whom, how sure she is, what she does with it

person → work → skill → each skill (reading accounts, persuading, drawing)
       → sub-skills → when each was learned, from whom, how it decays without use

person → wants → belonging → belonging to whom: her family, her friends, her town, her trade
       → each of those, over each period, with what threatens it

a scene → each line spoken → its words, its register, what it hides
        → what the listener hears in it, which can differ from what was meant

Humanity → politics → rule → legitimacy → custom / descent / the sacred / charisma / law / performance
         → each, in each polity, over each century

Ethereum → decentralization → validation → solo stakers / staking pools / exchanges
         → each large pool → its share of stake, its operators, its rules, by month

a moment → sensation → taste → sweetness / butter / the lime-blossom tea
         → each, in the order it registers, with what it begins to recall
```

When a node is opened, its parts get values of their own over time, and the parts must agree with the whole.

## Part 1. The world, from the Universe down

This is the world-history construction's tree. Each level is a Thing with a lifecycle, contained in the one above
it. Every node is a process with values over time. A node in square brackets is a measure, a question with
dated values.

```
History: the lifecycle of the Universe (13.8 billion years ago → now)
│   concept ascent: Event → Lifecycle → History → the history of a part of the Universe
│                   → the history of a living population → of a social population
│                   → of a cultural population → of a human population
│
├── The Universe: everything that exists, observed or not
│   ├── expansion, structure formation, galaxies, stars, the Solar System
│   └── The Earth (4.5 billion years ago → now): the planet, interior, crust, oceans, ice, atmosphere
│       ├── The Earth as setting: what the Earth provides to, or imposes on, every human society
│       │   ├── Climate: temperature, rainfall, the composition of the atmosphere
│       │   │   ├── [Global temperature]
│       │   │   └── [Carbon dioxide]
│       │   ├── Land and sea: the extent of land, ice and sea, and the coastlines between them
│       │   │   └── [Sea level]
│       │   ├── The living world: the plants, animals and microbes people live among, wild and domesticated
│       │   └── Resources: the Earth's stores of stone, metals, fuels and soil
│       │
│       └── Life on Earth (3.8 billion years ago → now): all living organisms, joined by common descent
│           └── Humanity (about 300,000 years ago → now): all living members of Homo sapiens at any time
│               ├── PROVISIONING
│               │   ├── Food: how the household obtains the food energy it eats
│               │   │   ├── Acquisition: gathering, hunting, fishing, herding, farming, buying
│               │   │   │   └── [How do the world's people divide by how their household obtains its food?]
│               │   │   ├── Diet: which plants and animals, wild or domesticated
│               │   │   ├── Sufficiency: food energy against need
│               │   │   │   └── [Food supply per person]
│               │   │   └── Preparation and storage: cooking, preserving, storing
│               │   ├── Power: fire, animals, water and wind, fossil fuels, electricity
│               │   │   ├── Sources
│               │   │   │   └── [How does the world's primary energy supply divide by source?]
│               │   │   └── Converters: hearths, draught animals, mills, engines, motors
│               │   │       └── [Energy use per person]
│               │   ├── Materials
│               │   │   ├── Extraction: gathering, quarrying, mining, farming fibre
│               │   │   └── Transformation: knapping, spinning, firing, smelting, manufacture
│               │   └── Work: how labour is divided, directed and organized
│               │       ├── Division: by occupation, age and sex
│               │       │   └── [How do the world's working people divide by the kind of work they mainly do?]
│               │       ├── Control: kin, command, coercion, contract
│               │       ├── Units: households, bands, estates, workshops, firms
│               │       └── Working time: how much of life is spent working
│               ├── EXCHANGE
│               │   ├── Media
│               │   │   ├── Tokens: what stands for value: obligation, valued object, coin, note, digital
│               │   │   └── Credit: memory, tallies, ledgers, banks
│               │   ├── Reach
│               │   │   ├── Distance: how far goods travel
│               │   │   └── Volume: how much is exchanged beyond the household
│               │   └── Terms
│               │       ├── Return: none, in kind, later, at a price
│               │       └── Setting: custom, the parties, an authority, a market
│               ├── WEALTH
│               │   ├── Property
│               │   │   ├── Holders: open access, kin, chiefs, lords, the state, individuals, firms
│               │   │   └── Transfer: inheritance, gift, sale, lease, seizure
│               │   └── Distribution
│               │       ├── Income
│               │       ├── Assets
│               │       └── [Output per person]
│               ├── POPULATION
│               │   ├── Fertility
│               │   │   └── [Total fertility rate]
│               │   ├── Mortality and health
│               │   │   ├── Survival
│               │   │   │   ├── [Life expectancy at birth]
│               │   │   │   └── [Child mortality]
│               │   │   ├── Health: how bodies grow and function, and the care that treats them
│               │   │   └── Causes of death: infection, violence, hunger, degenerative disease
│               │   ├── Movement: seasonal and permanent
│               │   └── [World population]
│               ├── HABITAT
│               │   ├── Range: where on Earth people live
│               │   │   └── [How do the world's living people divide among the UN M49 regions?]
│               │   ├── Settlement
│               │   │   ├── Form: moving camps, villages, towns, cities
│               │   │   │   └── [How do the world's people divide by the kind of settlement they live in?]
│               │   │   ├── Size
│               │   │   │   └── [Largest city]
│               │   │   └── Built environment: shelters, houses, monuments, streets, walls
│               │   └── Land and environment
│               │       ├── Land use
│               │       │   └── [Land used for crops and pasture]
│               │       ├── Living systems: hunting out, clearing, domestication
│               │       └── Emissions: smoke, carbon dioxide, pollution
│               ├── CONNECTION
│               │   ├── Transport
│               │   │   ├── Carriers: walking, pack animals, ships, rail, roads, air
│               │   │   └── Routes: trails, roads, sea lanes, canals, rail, air routes
│               │   └── Communication
│               │       ├── Speed: how fast a message travels
│               │       └── Audience: how many one message can reach
│               ├── SOCIETY
│               │   ├── Kinship and household
│               │   │   ├── Marriage
│               │   │   ├── Household
│               │   │   └── Descent
│               │   ├── Rank and freedom
│               │   │   ├── Rank
│               │   │   ├── Freedom
│               │   │   │   └── [How do the world's people divide by whether they are legally free or held?]
│               │   │   └── Class
│               │   ├── Gender
│               │   ├── Age
│               │   ├── Associations and sociability
│               │   └── Care
│               ├── POLITICS
│               │   ├── Polities
│               │   │   ├── Scale
│               │   │   │   └── [Largest polity]
│               │   │   └── Order among polities
│               │   ├── Rule
│               │   │   ├── Form
│               │   │   │   └── [How do the world's people divide by the kind of highest authority they live under?]
│               │   │   ├── Selection
│               │   │   ├── Legitimacy
│               │   │   └── Constraint
│               │   ├── Government
│               │   │   ├── Revenue
│               │   │   └── Administration
│               │   ├── Law and justice
│               │   │   ├── Rules
│               │   │   ├── Adjudication
│               │   │   └── Enforcement
│               │   └── Membership and participation
│               │       ├── Belonging
│               │       ├── Voice
│               │       └── Contest
│               ├── SECURITY
│               │   ├── Violence within groups
│               │   │   └── [Homicide rate]
│               │   └── War between groups
│               │       ├── Toll
│               │       │   └── [Deaths in war]
│               │       ├── Organization
│               │       └── Means
│               ├── KNOWLEDGE
│               │   ├── Learning
│               │   │   ├── Transmitters
│               │   │   ├── Duration
│               │   │   │   └── [Years of schooling]
│               │   ├── Storage
│               │   │   ├── Capacity
│               │   │   │   └── [How do the world's adults divide between those who can read and write and those who cannot?]
│               │   │   ├── Durability
│               │   │   └── Access
│               │   ├── Discovery
│               │   │   ├── Generation
│               │   │   └── Selection
│               │   └── Language
│               ├── BELIEFS AND NORMS
│               │   ├── Worldview
│               │   │   ├── Explanation
│               │   │   └── Warrant
│               │   ├── The sacred
│               │   │   ├── Rites
│               │   │   ├── Organization
│               │   │   └── [How do the world's people divide by the religious tradition they belong to?]
│               │   ├── Norms
│               │   │   ├── Content
│               │   │   └── Scope
│               │   └── Identity
│               └── ARTS AND PLAY
│                   ├── Forms
│                   ├── Production
│                   └── Audiences
```

**Places open the same way, inside the whole.** A place is a Thing with a lifecycle, opened by an encapsulation
cut: the Earth, then an M49 region, then a subregion, then a country, then smaller areas. "The people living in X"
are a Thing too, and their history uses the same twelve dimensions and the same questions as humanity's. Readings
for the parts must agree with the whole.

```
The Earth
└── Europe (M49 150)
    └── Western Europe (155)
        └── France
            └── Île-de-France
                └── Paris
                    ├── The people living in Paris: the twelve dimensions again, with Paris's own values
                    ├── an arrondissement
                    │   └── a street: its houses, who lives in them, when
                    │       └── one house: its rooms, the people in it, the courtyard behind it
                    └── the other arrondissements, each its own Thing with its own lifecycle
```

The world beneath a story is not this whole tree; it is the part of it the story stands in. For a story in one
country in one century, build:
- the dimensions that touch the lives in the story, such as work, money, law, kinship, health, transport and
  communication, belief and standing;
- each with values over the story's span and the decades before it;
- the long developments that explain it, such as a war a century back, an industry rising or a law changing.

## Part 2. Things that are not people

Institutions, organizations, machines, documents, markets and households are Things with lifecycles. Each is broken
down by the four questions, and each part that changes is a process.

### An institution: a bank

```
A bank (founding → failure, merger or today)
├── Identity: the same chartered bank through mergers and renamings
├── Composition
│   ├── partners or directors, each a person with a life (Part 3)
│   ├── the clerks, the cashiers, the branch managers
│   └── branches, each placed
└── Processes
    ├── capital, deposits, loans (each in money)
    ├── reserves against deposits (share)
    ├── its loans, as a Cut by borrower: trade / land / government / households
    ├── defaults (count, money), profit (money per year)
    ├── staff (count), and a Cut: how the partners divide their attention
    │   (lending / collecting / courting depositors / the regulator)
    ├── reputation among other banks (scale), trust of depositors (scale)
    └── the rules it works under (state: which law, from which year)
```

### A protocol and its community: Ethereum (from the market-mind model)

The core priority is a Cut read every half-year from 2014. Each category is opened into its own Cut, and Events
move the shares.

```
Ethereum (2014 → now)
├── Core priority (Cut, every half-year)
│   ├── decentralization
│   │   ├── validation: who stakes or mines and validates
│   │   ├── block building: who orders transactions (MEV, censorship)
│   │   ├── verification: who can run a node and check the chain
│   │   ├── client diversity: how many independent implementations
│   │   └── governance: who decides upgrades
│   ├── efficiency
│   │   ├── base-layer execution
│   │   ├── rollup scaling
│   │   ├── data availability
│   │   └── finality and speed
│   ├── security
│   │   ├── consensus
│   │   ├── client correctness
│   │   ├── economic security: the cost of attacking
│   │   └── application safety: contracts, bridges, keys
│   └── usability
│       ├── developer experience
│       ├── wallets
│       ├── fees
│       └── interoperability
├── Events that move the shares: the DAO fork, the ICO boom, CryptoKitties congestion, the rollup roadmap,
│   the Beacon Chain, the Tornado Cash sanctions, the Merge, the FTX collapse, Dencun, the spot ETF,
│   the Foundation reshuffle, Pectra
└── the people who decide (developers, the Foundation, stakers, builders), each with a life and wants
```

### A machine and its parts

A machine is a Thing whose parts each have their own lifecycle and state. Opening it shows what each part waited on.

```
A steam locomotive (designed → built → in service → rebuilt → scrapped)
├── Identity: the same engine, by its number, through rebuilds
├── Composition (each a process: condition, and percent built while it is being built)
│   ├── the boiler and firebox
│   ├── the cylinders and valve gear
│   ├── the frames, wheels and running gear
│   ├── the brakes
│   ├── the cab and controls
│   └── the tender: coal and water
└── Processes
    ├── condition of the whole, against the condition of each part
    ├── miles run (per year), failures (count), time in the works (days per year)
    ├── coal and water used (per mile)
    ├── its crews, each a person, and the shed it works from
    └── what it pulls: trains per day, load, the routes it is assigned to
```

### A document, a contract or a set of rules

```
A constitution (drafted → adopted → amended → suspended or kept)
├── its articles, each a Thing with a life (adopted, amended, ignored, repealed)
│   └── an article, carved: what it grants or requires, to whom, under what conditions, how it can change
├── processes: articles in force (count), amendments (count), articles ignored in practice (count)
└── each group's reading of it, which can differ from what it says and from each other
```

### A market, a price, a household

```
A housing market                    a price (GBP), a deposit saved (GBP), months to buy (count)
A crypto asset                      a price, a wallet balance, a stake
A hospital                          intensive care occupancy (share), staff, waiting time
A shared house                      members (count), messages per day, belonging (Cut over members)
A street                            households, rents, noise, who knows whom
```

### A relationship

A relationship is a Thing between two lives, with a lifecycle of its own.

```
The relationship between two people (met → close → strained → ended or kept)
├── closeness (scale), trust each way (scale), dependence each way (scale)
├── contact (meetings per month, letters per month)
├── what flows between them: money, care, information, obligation
├── conflict (scale), and what it is about (Cut)
└── each one's reading of the other (an inner perspective: how A reads B, against how B is)
```

## Part 3. A person

A person is a Thing whose life is its lifecycle Event, from birth to death. `person_scaffold`
(`life_profile_compile`) gives every person the life Event and the nine slow processes at once. Use it for
**every person** who matters to the work, principal or secondary, then go much further.

```
A PERSON (birth → death)
│
├── IS: the slow processes, values across the whole life (person_scaffold gives the first nine)
│   ├── body
│   │   ├── health (scale), and its Cut: healthy functioning / illness burden
│   │   ├── energy and sleep (hours, scale)
│   │   ├── illness, by condition: each illness a process with onset, course and treatment
│   │   ├── injury, pain
│   │   ├── mental health: mood, anxiety, exhaustion
│   │   ├── substances: alcohol, tobacco, opiates
│   │   └── age and appearance, fertility
│   ├── kin
│   │   ├── parents (alive, closeness to each)
│   │   ├── siblings
│   │   ├── children (number, ages, closeness to each)
│   │   ├── the household they live in (who, how many)
│   │   └── wider family, inheritance, family name
│   ├── partnership
│   │   ├── status (state: single, courting, married, separated, widowed)
│   │   ├── closeness, conflict, fidelity, dependence
│   │   └── what the law gives and takes (for example, a married woman's property under coverture)
│   ├── work
│   │   ├── occupation (state), employer, workplace
│   │   ├── hours, skill and mastery, autonomy
│   │   ├── income from work
│   │   └── Cut: where their working time goes
│   ├── place
│   │   ├── residence (position over time: each home is a place with dates)
│   │   ├── region, distance from kin and work
│   │   └── belonging to the place (scale)
│   ├── means
│   │   ├── income, savings and assets, debt
│   │   ├── security of means (scale)
│   │   └── dependence on others' money
│   ├── knowledge
│   │   ├── education and training
│   │   ├── skills by domain
│   │   ├── what they know and believe about each fact the story turns on, and when they learn it
│   │   └── languages
│   ├── standing
│   │   ├── reputation, in each group that matters
│   │   ├── rank and class, legal status
│   │   └── recognition: credited or not
│   ├── meaning
│   │   ├── purpose and vocation
│   │   ├── faith and worldview
│   │   └── identity: who "we" are for them
│   └── speech
│       └── Cut per episode: which register carries their speech
│
├── THEIR OWN PROCESSES: what belongs only to this person (at least one; principals several)
│   e.g. Twelve Words:
│     Barbara: guilt, purism, care for Kieran, "nobody's mother"
│     Laura: exhaustion, her spoken share in the household, trust in Kieran's money, holding silent
│     Kieran: fear of being left behind, honesty with Laura, screen hours, sleep hours, stake (GBP),
│             known faces, belonging to the sharehouse
│   a flaw is one: the event that taught it, the situations that trigger it, what it costs, how it changes
│
├── PERIODS: the life cut into stages and into the story's periods, each a child Event with readings
│   ├── childhood (0–12): who raised them, where, what they were taught, the moment that still shapes them
│   ├── youth (12–20): what they wanted to become, whom they loved, what they broke away from
│   ├── each adult stage: marriage, work, children, loss
│   └── each period the story covers, finer: by year, by season, by chapter
│
│   In every period, Cuts:
│   ├── WHAT: wants, as motivational attention over this person's own wants, carved as a concept per person
│   │     a shared start: autonomy / belonging / competence / understanding / well-being
│   │     then each person's own, e.g. Twelve Words:
│   │       what Barbara wants → credit / freedom / leaving something / verification
│   │       what Kieran wants  → loyalty to the band / Laura / the map / mattering / no trouble / safety
│   │       what Laura wants   → being cared for / competence / holding silent / home / …
│   ├── outlook: how fulfilment of the active wants is anticipated (assured / threatened)
│   ├── threat: what is seen as threatened, conditional on the outlook's threat, opened by a carve:
│   │     what a life has at stake → body and health / home and safety / the people they care for /
│   │                                self and meaning / standing and belonging / what they depend on /
│   │                                work and livelihood
│   │     and which of their own wants is at risk
│   ├── HOW: problem-solving attention (framing / deciding)
│   │   ├── framing (abstract / concrete)
│   │   └── deciding (impartial / personal)
│   ├── FEELS: emotional appraisal (anger / anticipation / disgust / fear / joy / sadness / surprise / neutral)
│   ├── body condition (healthy functioning / illness burden)
│   ├── days: what occupies their waking days (work / family / illness / study / …)
│   └── outlook on their own work or project (assured / threatened)
│
├── SHOCKS: each a change arc (change_arc_scaffold): anticipation → focal change → adaptation
│   e.g. Barbara: the works closure, the 2008 crisis, her exit in 2019
│        Kieran: his father's plant closing, the fall, the collapse
│
├── DECISIONS: each consequential choice a decision Cut over mutually exclusive continuations,
│   drawn with life_direction_draw, not chosen by the author
│   e.g. what Barbara does after Kieran tells her everything:
│        gives him the map / repays Laura's share herself / tells him he must tell Laura everything /
│        tells him what 1986 taught her and keeps walking / withdraws from him
│
├── LENSES: ways of reading their acts, each answer a Cut (life_lens_define, life_lens_place)
│   ├── fear or love
│   │   ├── within fear: being found out / being left outside / harm to someone they love /
│   │   │   losing what they have / making it real
│   │   └── within love: for a person / for a shared life / for the truth between them / for the work
│   ├── shame or guilt (hide or repair)
│   ├── exit, voice or loyalty
│   ├── someone else's script or their own voice
│   ├── wonder, appetite or anxiety
│   ├── their own reason, an alibi, or recognition
│   ├── a depleted, tired or rested body
│   ├── gift, reciprocity or market
│   └── wanting, bartering or standing for something
│
├── INNER PERSPECTIVES: how they read others and the world, which can be wrong
│   ├── how they read another person's attention or intent
│   ├── what they blame for what happens (an attribution Cut), against the world's causes
│   └── what they believe that is not true, from when to when
│
├── RELATIONSHIPS: one with each person who matters to them (Part 2)
│
└── PLACES: where the life is lived, as positions with dates
    ├── homes, workplaces, the places they visit
    └── in a scene: where they stand, what is within reach
```

### A life between the story's events: the world beneath Twelve Words

A story's pages touch a few days of a life. The model holds the years around them, so that what a person does on
the page has a history. The world beneath Twelve Words gives each principal dated episodes every few months from
2013, years before the story opens in 2019. The world events that reach them are in the same model.

```
Laura (staff nurse → intensive care), 2013 → the story
├── Sep 2013   staff nurse on an acute medical ward
├── Nov 2014   a post in Oxford, turned down at Christmas
├── Jan 2016   band 6 on the ward
├── Jul 2016   the ward short-staffed after the referendum        ← world: 23 June 2016, the EU referendum
├── Oct 2016   her mother's husband, Graham, has a stroke
├── Mar 2017   she moves to the intensive-care unit
├── Aug 2017   the first patient she carries home from the unit
├── Dec 2017   the bad flu winter
├── Apr 2018   a band 7 post goes to a nurse from Bath
├── Nov 2018   Graham's second, smaller stroke
├── Apr 2019   the new rota puts her on more nights
├── Sep 2019   the house she watched sells beyond them
├── Jan 2021   her first vaccine
└── Nov 2021   vaccination becomes a condition of the job
    each episode an Event, with readings of her outlook, what she sees as threatened and her wants after it

Barbara (retired, keeps her coins in a tin), 2013 → the story
├── Apr 2013   her last day at the bureau
├── Jun 2013   the cottage
├── Aug 2013   she puts up the satellite dish herself
├── Nov 2013   bitcoin passes a thousand dollars                   ← world
├── Feb 2014   the exchange collapses; her keys are in the tin     ← world: the largest exchange collapses
├── Apr 2014   a collie pup
├── May 2015   a broken wrist from the ladder
├── Jan 2016   she reads every thread on the block-size quarrel    ← world: the quarrel over bitcoin's rules
├── Dec 2017   her coins at about a hundred and fifty thousand pounds  ← world: the 2017 bubble
├── Jun 2018   a will at sixty-five, with one line left blank
├── 2018       the second crash she counts                         ← world: the fall of four fifths
└── May 2019   locked out of her own savings for nine days

Kieran and Laura together
├── May 2014   they meet at a friend's thirtieth
├── Apr 2016   the flat above the bakery
├── May 2016   a joint savings account for a deposit
└── Jul 2018   a savings pot called CRETE
```

The same world holds the scene itself, opened into its objects, each a referent with a position: the kitchen table,
the fridge, the handover notepad, the green front door, the phone, the wallet, the spare-room desk. It also holds
the themes as concepts that the readings can be read against: routine as safety, guilt passed on, a key without a
map, and the deep-time gap between paleolithic emotions, medieval institutions and godlike technology. In all,
1,014 Events, 51 referents, 41 concepts and 6 carves sit beneath one novel of twelve chapters.

The previous Book's people show the level: each of its 13 people had the nine slow processes, speech, and a life
index. Several had processes of their own, such as sole authority, control or recognition. Each principal had
readings in every period: wants, outlook, wants at risk, framing, deciding, problem-solving, feelings, body,
working life and speech register. Twelve Words added change arcs for every shock, life places for every principal,
three relationships and nine lenses: 788 Cuts in all.

## Part 4. Time inside a life

The same life is read at many grains, each inside the one above:

```
a life                 decades       the nine slow processes, coarse values at each stage
└── a stage            years         childhood, youth, marriage, work, old age
    └── a period       months        a job, an illness, a year of the story
        └── an episode days          a journey, a negotiation, a quarrel and its making up
            └── a scene hours        who is in the room, where each stands, what is said and withheld
                └── a moment         seconds: a look, a sentence, a taste
```

A long reading holds until finer readings open it. Open it wherever something happens.

## Part 5. One moment, all the way down: Proust and the madeleine

In *Swann's Way* (1913), the narrator, grown up and dispirited on a winter day, is offered tea and a small cake by
his mother. He soaks a piece of the cake in the tea and tastes it. A joy without any cause he can name runs through
him. He tries again and again to find where it comes from, the feeling fading each time he tries. Then the memory
arrives. It is the taste of the piece of cake his aunt gave him, soaked in her lime-blossom tea, on Sunday mornings
at Combray when he was a child. With it, the whole of Combray rises out of the cup: the house, the town, the
streets, the church, the people, the gardens.

The Meaning Model holds this moment as the finest level of a life, linked to a period decades earlier.

```
The narrator's life (birth → death)
├── IS: body, kin, partnership, work, place, means, knowledge, standing, meaning, speech …
├── meaning
│   └── vocation as a writer (scale): long dormant; this moment begins its return
├── PERIOD: childhood at Combray (years)
│   ├── place: his great-aunt's house at Combray; his aunt Léonie's room
│   ├── EPISODE: Sunday mornings, before Mass (a repeated episode, read as a series)
│   │   ├── his aunt gives him a piece of madeleine soaked in her lime-blossom tea
│   │   ├── senses: taste, smell, warmth, the room
│   │   └── what he feels then (FEELS Cut): comfort, ordinary pleasure
│   └── what Combray holds: the house, the town, the church, the streets, the people, the gardens,
│       each a Thing with its own life, unrecalled for decades
│
├── PERIOD: adult life, years later (years)
│   ├── meaning: low (scale), a mood of dreariness and a sense of a depressing tomorrow
│   └── EPISODE: a winter day, coming home cold (hours)
│       └── SCENE: his mother offers tea and a cake; he declines, then accepts (minutes)
│           ├── position: at home; the cup, the spoon, the plump little cake
│           └── MOMENT: the taste (seconds), opened into inner processes, each with values second by second
│               ├── sensation (Cut over what occupies the senses: taste / warmth / the room / thought)
│               ├── FEELS (Cut): joy / puzzlement / anxiety that it will vanish
│               │     joy rises at once, with no cause he can name; the dreariness falls away
│               ├── attention (Cut): the taste itself / the search for its cause / the room around him
│               ├── memory search (a process): effort (scale), attempts (count), the felt distance of what he seeks
│               │   ├── attempt 1: a second mouthful: less
│               │   ├── attempt 2: a third: less again
│               │   ├── turning inward: shutting out sound and thought, clearing a space
│               │   └── fatigue: he rests the effort, then tries again
│               ├── the cause, as he reads it (inner perspective): first "in the tea", then "in me"
│               ├── retrieval (an Event that links two periods): the taste is recognized as the madeleine
│               │   of Sunday mornings at Combray (relation: reactivates → the childhood episode)
│               └── expansion (a process in seconds, then minutes): what returns, each Thing again present to him
│                   ├── his aunt's room
│                   ├── the house, and the little pavilion behind it
│                   ├── the town: the square, the streets he ran along, the paths
│                   ├── the church
│                   ├── the people of the village
│                   └── the gardens, the water-lilies, the flowers
│
└── what follows from the moment (later periods)
    ├── knowledge: that the past survives in a sensation, and can return whole
    └── meaning: vocation as a writer, rising toward the work the whole book becomes
```

Every level here is an ordinary record:
- **the life, periods, episodes, scene and moment** are Events, each inside the one above;
- **joy, attention and sensation** are Cuts at the moment, read second by second;
- **effort and attempts** are values of the memory-search process;
- **the retrieval** is an Event related to the childhood episode it brings back;
- **what returns** is a set of Things, each with its own life.

That is how far down the model can go: from the Universe to one second in which a life touches its childhood.

## Part 6. The book itself

The telling is a Thing too, read in reading order, not world time:

```
The book (first page → last)
├── chapters, scenes, passages: each placed in reading order and linked to the world Events it tells
├── tension (scale, by passage)
├── disclosure: what the reader knows, suspects and has been misled about, by passage
├── pacing: world time told per page
├── point of view: whose perspective each passage is held in
├── the narrator's register: a process across the text, with Cuts by chapter
└── the author: a person with a life (Part 3), and when, knowing what, they write
```

## Part 7. The minimum: at least this

You may do more, and change any category, but leave at least the following.

**A story.**

| What | At least |
|---|---|
| Every person who appears more than in passing | A life from birth to death (or to the end of the model). The nine slow processes (`person_scaffold` gives them) plus speech, each with values across the life. At least one process of their own. Cuts read over the life, in every period, for what they want, how they see their wants' fulfilment, what they see as threatened and what they feel. The coverage report checks this for every person in a story and names what each one lacks; the pass is not done until no one lacks anything. |
| Every principal | Everything above, plus in every period and every chapter: framing, deciding, body, days and speech register. A change arc for every shock. A drawn decision Cut for every consequential choice. At least two lenses on their acts. Their reading of the other principals. Their places over time. |
| Every relationship between principals | A relationship Thing: closeness, trust each way, what flows between them, its conflicts. |
| Every institution, machine, document or market the story turns on | A lifecycle, opened into its parts. Its processes are followed over the story's span and before it. |
| The world beneath | The dimensions of Part 1 that touch the lives, at the place and era of the story, with the long developments that explain them. |
| The book | Its telling processes in reading order (Part 6). |

The two previous books are the benchmark:

| | People | Processes | Cuts | Places and more |
|---|---|---|---|---|
| The Book of Conditions | 13 | 194 | 108 | 45 |
| Twelve Words, with the world beneath it | 3 principals, 51 referents | 149 | 788 | 23, and 1,014 Events, 41 concepts, 6 carves |

A new story of similar length should land in the same range or above it.

**An account of the real world.** The tree of Part 1 to the depth of its measures, for the span asked. Places are
opened by encapsulation where the question needs them.

**An organization, a market or a protocol.** Part 2's breakdown: its priorities as a Cut opened into
subcategories, read at regular intervals, the Events that moved them, and the people who decide, each a life.

## Part 8. Which tool makes which record

| Record | Tool |
|---|---|
| A person's life Event and nine slow processes | `life_profile_compile` with `person_scaffold` |
| A shock with anticipation, focal change and adaptation | `life_profile_compile` with `change_arc_scaffold` |
| A Thing (an institution, a machine) or a relationship | `life_profile_compile` with `thing_scaffold`, `relationship_scaffold` |
| Events, concepts, carves (abstract cuts), places | `life_model_register`, `life_model_revise` |
| Values of many processes at once | `life_values_record` |
| A series of Cuts (wants, outlook, feelings, attention…) | `life_series_record` |
| A decision between continuations | a decision Cut, then `life_direction_draw` |
| A lens and its answers | `life_lens_define`, `life_lens_place` |
| How a person reads another | Cuts under that person's inner perspective root |
| What is still missing | `life_model_questions` and the coverage report |
