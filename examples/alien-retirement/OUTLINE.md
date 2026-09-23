# Model irregular-income-retirement, revision 2 (933de25b6082)
Revision reason: Describe the five Events, so each says what happens in it and which authored values it rests on. Written after the run by the maintainer (Claude Opus 5.5) from the model’s own processes, Things and relations; no value, interval or boundary changes.
Graph alien-run-retirement-2, revision 52 (73bf7dc1d648): 54 nodes, 198 edges.

## Descriptions
5 of 5 Events are described; 0 carry Cuts.

## Things
- referent.circle: The household's close circle: kin, friends and neighbours who can check in, hold, cover or pool
  ✎ transfer.long-round [alien.transfer by calling-llm]: Circle-kept pension chain: Make the circle regular, not the earner. Accrue on unbroken membership, not pay. Take NOK or hours. Credit on relief. No lean month breaks a chain. Keep people who know you. Fund new promises first.
- referent.clients: The shifting set of clients and platforms that pay the household
- referent.household: One gig-working household whose monthly earnings are unpredictable in size and timing
  ✎ transfer.frost-line [alien.transfer by calling-llm]: Year-Low Hindsight Pension: Commit by hindsight, not pledge or forecast. Lock only NOK a year of the household's own lean months left untouched. Let each household's worst dip size its buffer. Show claims as NOK/month.
  ✎ also transfer.long-round (shown above)
- referent.pension_provider: An organization that holds retirement claims and pays them out
  ✎ transfer.delay-line [alien.transfer by calling-llm]: Rail-Cut Consumption-Share Pension: Shares, never amounts. Cut at the payment rail. No personal balance: each cut is locked in state strips maturing across old age. Credit relative to the month's average cut. Floor from reserve.
  ✎ also transfer.frost-line (shown above)
- referent.platforms: The platforms, marketplaces and payment rails through which the household is paid
  ✎ also transfer.delay-line (shown above)
- referent.state: The public authority that sets pension, tax and benefit rules
  ✎ also transfer.frost-line (shown above)

## Events
- event.world: The accepted present-day economy the household lives in.
  The present-day economy the household lives in: a public authority sets pension, tax and benefit rules, pension providers hold and pay claims, and shifting clients and platforms pay the household. All values are authored and illustrative, in NOK; nothing here is measured. Working life and retirement both happen inside it.
  ✎ maintainer.target-descriptions [understanding.revision by maintainer:claude-opus-5-5]: Revision 2 of the target model describes its five Events, which had none. The descriptions restate what the model already holds: the authored values, the Things, and the containment and constraint relations. A later search or transfer can…
  - event.retirement [480, 720]: The household stops earning and draws on its claims, over an illustrative twenty years.
    Twenty illustrative years, months 480 to 720, in which the household stops earning and draws on its accumulated claims, held and paid by a pension provider under rules the state sets. The claims stand at 180,000 NOK at month 0. The search asks how such claims can be built when earnings are unpredictable.
    ✎ also maintainer.target-descriptions, transfer.delay-line (shown above)
  - event.working.life [0, 480]: The household's working life, with earnings arriving irregularly, over an illustrative forty years.
    Forty illustrative years, months 0 to 480, in which the household works for shifting clients through platforms. The main earner is 34 at the start. Earnings in the first month are 34,000 NOK and vary from month to month with a coefficient of variation of 0.5, against living costs of 30,000 NOK a month.
    ✎ also maintainer.target-descriptions (shown above)
    - event.earning.arrival: An earning arrives, of unpredictable size and timing.
      An earning arrives from a client or platform, of unpredictable size and timing. It adds to the month's earnings, and nothing tells the household when the next one comes or how large it will be.
      ✎ also maintainer.target-descriptions (shown above)
    - event.lean.month: A month in which earnings fall below spending.
      A month in which earnings fall below spending, so the household draws on its buffer: 45,000 NOK at the start, about a month and a half of living costs. Lean months constrain retirement, because what the buffer absorbs is not saved as pension claims.
      ✎ also maintainer.target-descriptions (shown above)

## Processes
- household.age_years (years, unspecified): age of the main earner; initial 34
- household.buffer_nok (NOK, unspecified): liquid savings available for lean months; initial 45000
  ✎ also transfer.frost-line (shown above)
- household.income_cv (coefficient of variation, unspecified): month-to-month variability of earnings; initial 0.5
- household.income_nok_month (NOK/month, unspecified): earnings received in the month; initial 34000
- household.pension_claims_nok (NOK, unspecified): accumulated claims payable in retirement; initial 180000
  ✎ also transfer.long-round (shown above)
- household.spending_nok_month (NOK/month, unspecified): living costs paid in the month; initial 30000

## Understanding
- alien.understanding.21a77a717ac710789574e26e (search.retirement): 17 reflections, 50 records
  ✎ selection.1 [alien.selection by calling-llm]: Selection (weighted): A weighted allocation of effort, not a ranking of which idea is right: the shares divide the next round's work and are not probabilities of success. Weights follow testability and what each transfer found, not novelty…
  ✎ orev.5 [alien.ontology_revision by calling-llm]: outcomes ontology: admit_instance: Admitted as an instance with a partial fit, because the class's second differentia (every locked amount has already shown it was not needed) does not hold: the tide ledger seals half of each surplus above…
  ✎ rev.m5 [alien.ontology_revision by calling-llm]: mechanisms ontology: admit_new: Admitted as a third branch of regularity supplied by others, where the compiler placed it after reading the map. That placement is responsiveness to the map (condition H), not independent discovery: the comp…
  ✎ wrev.4 [alien.ontology_revision by calling-llm]: worlds ontology: admit_new: Primary operator. The Kept World has one cause, a person's gift of store, over a default of total inertia: whatever no one gives to keeps every property exactly, with no ground, no up or down, no coasting, decay…
  ✎ orev.4 [alien.ontology_revision by calling-llm]: outcomes ontology: admit_new: A new outcome class. The explorer itself named o.kept-and-known, reading the id as a pension that is kept and known as income; that class means old age held by people who know you, with care that does not laps…
- understanding.maintainer-claude-opus-5-5 (maintainer:claude-opus-5-5): 1 reflection, 1 record
  ✎ also maintainer.target-descriptions (shown above)

## Documents
- search.retirement: # Retirement without consistency (0 rendered passages, 0 words in the graph)
