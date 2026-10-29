# Ending loneliness in a big city

## Problem

How do we end loneliness in a big city where nobody has time, people move every few years, and talking to strangers feels unsafe?

## Mechanism ontology

- [mech.institutional-contact-condition-holder] Institutional holding of a contact condition individuals cannot supply (umbrella): 0 direct, 10 in subtree
  operator: An institution takes over one condition that individuals cannot meet under scarce spare time, frequent moves and approach risk. Contact against loneliness then does not depend on individuals spending spare attention, risking an approach to a stranger no shared acquaintance vouches for, rebuilding a social graph after each move, or refusing owed contact with a neighbour at the cost of the tie itself. Kinds differ in which condition is held: the specific counterparts and recurrence of contact; attention supplied as paid work from a post; the timing at which already-ready members of an unfixed pool coincide; the evidence that makes an unacquainted counterpart safe to approach, held by a non-social place-bound record while counterparts and timing stay self-chosen; or the insulation of a fresh, mutually chosen tie from cold contact (disputes, shared duties, owed small talk), with the institution carrying those channels elsewhere and leaving warm contact to a receptivity signal.
  partition part.root-by-held-invariant, lens: Which condition individuals cannot supply the institution holds: who meets whom (specific counterparts and recurrence), a post whose paid work is the attention, when already-ready members of an unfixed pool coincide, the warrant that an unacquainted counterpart is safe to approach, or a fresh tie's insulation from obligatory and disputed contact.; query: Does the institution fix the specific counterparts, staff a post whose job is the attention, fix only when readiness-gated co-presence occurs, supply only checkable evidence about a self-chosen stranger, or, after ties exist, remove the cold-contact channels (disputes, shared duties, owed greetings) between registered partners while leaving warm contact to their own signal?
    - [mech.institution-held-contact-scaffold] Institution-held consented contact scaffold (umbrella): 0 direct, 6 in subtree
      operator: An external institution fixes, and attaches consent to, the conditions under which a person recurrently meets specific counterparts, so no individual spends scarce spare attention coordinating and approaches are pre-granted. It creates and books dedicated contact occasions, holds counterparts constant across exchanges or waits people already spend, fixes placement so declared counterparts stay adjacent across a move, or routes genuine small requests across assigned neighbour links and repairs those that fail to carry them. Kinds differ in where the contact occasion comes from (added by the scaffold vs carried by a pre-existing exchange, wait, need or residential routine) and in what carries contact forward through time and turnover: continued institutional holding of the recurrence, person-held ties that replace a withdrawn scaffold, a portable record of an ended tie that warrants new contact, co-placement at each move that keeps an existing tie's members adjacent, or failure-triggered testing and repair that keeps a person-held tie load-bearing.
      partition part.scaffold-by-persistence-carrier, lens: What carries contact forward through time and turnover: continued institutional holding of the recurrence; person-held ties replacing a withdrawn scaffold; a portable record of an ended tie warranting new contact; the original tie kept intact by co-placing its members at each move; or the person-held tie kept load-bearing by failure-triggered testing and repair.; query: After initial contacts or at a dispersal, does the institution keep holding the recurrence, withdraw as self-initiated contact appears, convert the ending tie into a record that ranks introductions, co-relocate the tie's members, or stay silent until a genuine request routed across the tie goes unanswered and then repair and re-test it?
        - [mech.position-bound-tie-succession] Position-bound pairwise ties with vouched succession: 1 direct, 1 in subtree
          operator: A recurring reciprocal contact duty is held by a pair of fixed positions (units, seats, posts) rather than by the persons occupying them. An external institution fixes, books and announces each recurrence for both sides, so neither occupant spends spare attention coordinating, and consent to be approached is attached to the position so each approach is pre-granted. When an occupant leaves, a sanctioned handover lets the departing occupant or a stand-in vouch the successor to the remaining counterpart at a booked time. The scheduled, consented opportunity for contact with a specific counterpart therefore survives occupant turnover; persistence under mobility comes from succession of positions, not from the continued effort or presence of individuals. Accumulated closeness is not claimed to transfer.
          instances: Ties That Run With the Lease [mech.w1] (clear fit)
          - [mech.dedicated-occasion-contact-scaffold] Scaffold-created dedicated contact occasions (specializes): 0 direct, 0 in subtree
            operator: The institution creates recurring occasions whose purpose is contact with specific counterparts (reciprocal contact duties, hosted sessions) and books and announces them, so participants spend no attention coordinating. Coordination cost is removed, but each occasion still consumes the participants' discretionary time; the occasion exists because the scaffold added it.
        - [mech.arrival-dose-metered-taper] Disruption-window contact dose with feedback-metered scaffold withdrawal: 1 direct, 1 in subtree
          operator: An external host delivers a concentrated, pre-booked dose of repeated contact among one fixed small set of people at a moment when each person's routine is already disrupted (e.g. relocation), so open time slots are filled by the same faces. The host then withdraws its own scaffolding (widening gaps between hosted sessions) only as fast as observed self-initiated interaction among members appears, holding otherwise. Abrupt endings and extra one-off contact pulses during the withdrawal are suppressed, because they leave the forming ties unsettled or spend scarce free time on rotating faces. Persistence after the program comes from person-held ties that took over from the scaffold, not from any continuing institutional recurrence.
          instances: Arrival Week, Metered Taper [mech.w2] (clear fit)
          - [mech.dedicated-occasion-contact-scaffold] Scaffold-created dedicated contact occasions (specializes): 0 direct, 0 in subtree (shown above)
        - [mech.ended-tie-credential-bridge] Ended-tie credential bridge: once-only joint record of logged co-presence used as a weakest-link introduction warrant after a move: 1 direct, 1 in subtree
          operator: When a tie fostered by a contact scaffold is about to be ended by dispersal (a move or departure), both parties jointly and in person mint a single, irrevocable record of the depth of their logged co-presence that third parties can check. Depth is frozen at minting, and there is one record per pair ever. After arrival elsewhere, an institution that assigns contact occasions gives the holder priority to be placed with people who share a record-partner, ranked by the weaker of the two records in the chain. The causal claim is that a verified shared third party turns strangers into friends-of-friends, lowering approach risk and speeding new ties where the mover has none. Because the record is costly and cannot be inflated, it is a credible signal. The record does not keep the original pair in contact, and no closeness is claimed to transfer. Persistence under mobility is carried by a portable warrant for new contact, not by the old tie and not by indefinite institutional holding of one recurrence.
          instances: Seated Waits and the Parting Sheet [mech.w5] (partial fit)
        - [mech.co-placed-tie-carry] Co-placed tie carry: move-time co-relocation of a mutually declared (incl. unfinished) tie so its accrued progress keeps accruing: 1 direct, 1 in subtree
          operator: At the moment an institution that controls moves and destinations relocates any agent, it treats each tie the agent and a counterpart have mutually declared, including unfinished ties, as one co-moving unit. It offers placements that keep both parties adjacent (same stairwell, floor or block), or adjacent units if both move, with switching costs waived. Proximity makes continued contact with that specific counterpart cheap and ambient, so the tie's accrued progress (sunk co-presence hours) keeps accruing instead of resetting, without booked occasions or new discretionary time spent coordinating. Consent and eligibility come from mutual declaration, which is capped, periodically renewed and silently revocable. The institution acts at each dispersal point, not between moves: it does not schedule or hold recurrences. Persistence under mobility is carried by the original person-held tie, kept intact because the move no longer separates its members. Accumulated closeness is claimed to be preserved, not created.
          instances: Carry Clause: Move the Unfinished Tie [mech.w6] (clear fit)
        - [mech.load-probed-tie-repair] Load-probed tie repair: genuine small requests routed across assigned ties, with diagnosis-matched repair and re-test triggered only by unanswered probes: 1 direct, 1 in subtree
          operator: An institution assigns a newcomer opt-in links to specific adjacent households, then verifies each link by periodically routing a genuine small request (parcel, key or tool hold) across it: an answer within a window means the tie carries load; a miss is silent failure. Action is triggered only by measured failure. A crew diagnoses each endpoint's specific barrier (safety, language, schedule, grievance) and applies the matching remedy, runs one brief task needing the whole local cluster at once, enforces a short undisturbed settling interval, and re-tests. Repair repeats cheaply until the probe passes; after a set number of failures the link ends without blame and is re-matched. Probes pause on links of a household in upheaval, which are re-treated after it ends. Claim: polite acquaintance often carries no help, only a real request exposes this, and spending scarce repair only on measurably failed ties makes person-held ties load-bearing. Persistence comes from the person-held tie under continuing inspection, not an institution-held recurrence.
          instances: Tap-Tested Ties: Load, Fail, Reflow [mech.w8] (clear fit)
      partition part.scaffold-by-occasion-source, lens: Where the contact occasion comes from: added by the scaffold (consuming discretionary time even when coordination is free), or carried by an occasion the person must already spend (an exchange or a wait), with the scaffold fixing only who answers it or sits beside them.; query: Would the occasion on which the counterparts meet occur without the scaffold, with the scaffold only fixing which counterparts share it?
        - [mech.dedicated-occasion-contact-scaffold] Scaffold-created dedicated contact occasions: 0 direct, 0 in subtree (shown above)
        - [mech.obligatory-exchange-counterpart-pinning] Counterpart pinning on obligatory exchanges and waits (zero added discretionary time): 1 direct, 1 in subtree
          operator: A continuity router holds the counterparts constant across a recurring occasion the person must already spend. This is either an obligatory exchange (a paid purchase, pickup, delivery or fixed-route call) answered by one staff member, or an obligatory wait (a commuter ride, laundromat, clinic chair or sport sideline) shared with a fixed small set of co-attendees. The router matches the person's recurring slot to the counterpart's recurring slot, or reseats the same set each time. Repetition therefore builds familiarity with specific counterparts while added discretionary time stays at zero: contact is redirected, not added. Consent is attached by mutual opt-in. Approach risk is kept low by the staffed public setting or by a reciprocal verification step, optionally with a scripted opener that varies one bounded element. When either side leaves or the person moves, the router re-pins at the first occasion in the new place. Persistence comes from continued institutional re-pinning; accumulated familiarity is not claimed to transfer.
          instances: Pinned Errands: Same Face, Same Slot [mech.w3] (clear fit)
    - [mech.compensated-post-held-acknowledgment] Compensated rotating acknowledgment in a spatial-consent zone (being noticed, named and missed): 1 direct, 1 in subtree
      operator: An institution staffs a bounded public zone with paid, rotating attendants whose work is to give brief one-directional acknowledgment to whoever enters. Crossing the zone boundary is the consent signal and leaving ends approaches. Attention is supplied as compensated labour, so the acknowledger's attention draws on paid hours rather than spare time, and the entrant needs no booking, matching or reciprocal duty. Recognition of regulars is held by the post, not by any one attendant: at changeover the outgoing attendant introduces the incoming one to present regulars using an opt-in name record kept on site, and an opt-in usual window lets the post notice and note absence. The causal claim is that being noticed, named and missed (mattering) reduces loneliness without forming a tie; no friendship, closeness or counterpart continuity is claimed. Because the attendant role is paid and open to residents, a lonely person can take it and be present as a worker rather than a supplicant.
      instances: Witness Wards and the Vouched Nod [mech.w4] (clear fit)
    - [mech.readiness-gated-copresence-sync] Readiness-gated co-presence synchronization: a member's presence relayed only to privately near-ready peers, plus an externally funded shared free-time pulse: 1 direct, 1 in subtree
      operator: An institution fixes when people coincide, not who meets whom or how often. Each member keeps a private, decaying readiness signal that a relay can read and no peer can see. When one member goes to a fixed public spot, the relay forwards a single, non-repeated notice ('someone is already there'). It sends the notice only to members whose readiness exceeds a learned personal threshold, and only when a quorum qualifies. Members below threshold are never told, so no invitation lands in their quiet and no decline occurs. The initiator's already-spent initiative is reused to remove the costliest step for near-ready others, arriving first and alone, and arrivals can cascade. A periodic, announced pulse of free time funded outside members' own spare hours (e.g. paid early release by home postcode) brings everyone toward readiness together and realigns drifting schedules. Newcomers receive a preset readiness and are enrolled in the pulse from arrival. The causal claim is that loneliness falls because scarce readiness coincides instead of alternating, while contact frequency is not raised. Coinciding presence is claimed; a tie is not.
      instances: Lean Relay and the Vent Hour [mech.w7] (clear fit)
    - [mech.place-anchored-stranger-corroboration] Place-anchored stranger corroboration: a fixed unstaffed post's independent presence record warrants approaching an unacquainted counterpart, with co-varying presence flagged: 1 direct, 1 in subtree
      operator: A fixed, unstaffed, place-bound reference (a signed post at a spot people already pass or wait at) accumulates dated, time-separated presence observations of each enrolled, identity-bound person. A lone person can then corroborate an unacquainted counterpart directly against that reference: a long counterpart record that is independent of the viewer's own presence becomes a warrant for approach, replacing the mutual acquaintance a mover lacks. Independence is required. A counterpart whose presence occurs only with, or shifts with, the viewer's is flagged rather than corroborated, and where the viewer's schedule gives no variation the test returns untestable, not pass. Contact stays self-initiated and mutual: the institution does not choose counterparts, book occasions, staff attention or time arrivals. It fixes only the evidence available about a stranger, plus a low-stakes first step (the lower of two privately set grades; shared place history as the opener). Under mobility the warrant is rebuilt as a new baseline at each place, not carried.
      instances: Datum Posts: The Corner Vouches [mech.w9] (clear fit)
    - [mech.tie-cold-contact-shield] Tie cold-contact shield: institution strips owed, disputed and rushed contact from a fresh registered tie, leaving warm contact to a partner-only receptivity signal: 1 direct, 1 in subtree
      operator: After a fresh tie forms and both members mutually register it, an institution takes over the channels through which unchosen, low-warmth contact would otherwise travel between them: disputes are routed through a third party, not between the partners; the partners are kept off shared duties and committees; and a posted norm sets their default obligation to nothing beyond a passing acknowledgment. Warm contact is left to the partners, gated by a receptivity signal visible only to them, closed by default, whose open state invites without obliging a reply. Causal claim: repeated contact raises liking only when positive, while rushed, owed or disputed contact between neighbours breeds guilt and avoidance, so subtracting it keeps a young tie from being worn into avoidance. Forging, typically capped reciprocable welcome turns in an arrival window, is preparatory; the operator is the subtraction. Persistence rests on the person-held tie, protected from wear rather than refreshed by recurrence; disuse decay and turnover are not answered.
      instances: Forge Fast, Then Shield the Tie [mech.w10] (clear fit)

Relations:
- mech.position-bound-tie-succession opposition mech.arrival-dose-metered-taper: Opposite answers to persistence under mobility: permanent institution-held recurrence with succession vs. metered withdrawal into person-held ties
- mech.obligatory-exchange-counterpart-pinning analogy mech.position-bound-tie-succession: Same persistence-carrier answer (continued institutional holding of the recurrence across turnover); they differ in succession (fresh re-match vs vouched handover) and occasion source
- mech.obligatory-exchange-counterpart-pinning analogy mech.arrival-dose-metered-taper: Both capture the relocation moment, when routines are unformed, to fix which faces fill them; opposite on occasion source and persistence carrier
- mech.compensated-post-held-acknowledgment analogy mech.position-bound-tie-succession: Both hold continuity in a post rather than a person and carry recognition across occupant rotation by an in-person handover; they differ in what is supplied (one-directional acknowledgment vs reciprocal contact duty) and in counterpart fixity (rotating every shift vs fixed paired positions).
- mech.compensated-post-held-acknowledgment analogy mech.obligatory-exchange-counterpart-pinning: Both make paid on-shift staff in a staffed public setting the contact counterpart and keep approach risk low by setting; they differ in how attention cost is borne (compensated as the job itself vs redirected from an obligatory exchange) and in counterpart fixity (rotating vs pinned).
- mech.compensated-post-held-acknowledgment opposition mech.institution-held-contact-scaffold: Opposite answers to what an institution supplies against loneliness: recurring consented contact with specific counterparts from which familiarity or ties may grow, vs compensated one-directional acknowledgment from a rotating post with no tie claimed.
- mech.ended-tie-credential-bridge analogy mech.position-bound-tie-succession: Both carry contact across departure by vouching; succession vouches a successor into the stayer's position once, while the bridge lets the mover's ended ties vouch the mover into new circles as a standing record
- mech.ended-tie-credential-bridge analogy mech.obligatory-exchange-counterpart-pinning: Both have the institution re-match the mover in the new place; pinning re-matches fresh, the bridge ranks new counterparts by credentials of ended ties
- mech.ended-tie-credential-bridge opposition mech.arrival-dose-metered-taper: Opposite on whether the original tie should persist after the scaffold: the taper hands persistence to the person-held tie; the bridge lets the tie end and carries only a warrant for new contact
- mech.co-placed-tie-carry opposition mech.position-bound-tie-succession: Opposite answers to what survives a move: succession keeps the position and its duty and replaces the person (no closeness transferred); carry keeps the person-pair and their accrued closeness and replaces the place.
- mech.co-placed-tie-carry opposition mech.ended-tie-credential-bridge: Opposite on whether dispersal should end the tie: the bridge lets it end and carries a warrant for new contact; carry prevents the separation so the same tie continues.
- mech.co-placed-tie-carry analogy mech.arrival-dose-metered-taper: Both act at the relocation moment and rest persistence on person-held ties rather than continued institutional recurrence; the taper builds new ties then withdraws, carry protects existing ties at each move. Carry's secondary arrival batching shares the taper's capture of the disruption window.
- mech.co-placed-tie-carry analogy mech.obligatory-exchange-counterpart-pinning: Both route contact through occasions people already spend rather than booked sessions (residential routine vs obligatory exchanges and waits) and act at a move; pinning re-matches fresh counterparts, carry keeps the existing counterpart.
- mech.readiness-gated-copresence-sync opposition mech.institution-held-contact-scaffold: Opposite on what is held fixed: the scaffold fixes which specific counterparts meet and grants approaches in advance; the relay fixes only when ready members of an unfixed pool coincide, and never offers contact to the unready.
- mech.readiness-gated-copresence-sync opposition mech.obligatory-exchange-counterpart-pinning: Opposite answers to scarce time: pinning adds zero time by redirecting obligatory exchanges and waits; the pulse adds synchronized free time funded outside members' own hours.
- mech.readiness-gated-copresence-sync analogy mech.arrival-dose-metered-taper: Both gate institutional action on observed member signals (self-initiated interaction vs private readiness) and capture newcomers at move-in. The taper books a dose among a fixed set and withdraws; the relay books nothing and keeps gating timing.
- mech.readiness-gated-copresence-sync analogy mech.compensated-post-held-acknowledgment: Both claim contact without tie formation, impose no reciprocal duty or booking, and keep approach risk low by a fixed visible public place. They differ in the source of contact: paid acknowledgment from a post vs coincident peer co-presence.
- mech.load-probed-tie-repair opposition mech.arrival-dose-metered-taper: Opposite control laws on feedback-gated scaffolds: the taper intervenes by default and withdraws as it observes self-initiated interaction; probe repair is silent by default and intervenes only when a genuine request fails to cross the tie.
- mech.load-probed-tie-repair analogy mech.co-placed-tie-carry: Both rest persistence on person-held ties that the institution protects against disruption; carry acts at moves by co-location, while probe repair inspects in place and re-treats ties after household upheaval.
- mech.load-probed-tie-repair analogy mech.readiness-gated-copresence-sync: Both gate institutional action on member-level signals crossing a threshold; the relay reads private readiness to time coincidence in an unfixed pool, while probe repair injects a real request to test a fixed tie.
- mech.load-probed-tie-repair analogy mech.obligatory-exchange-counterpart-pinning: Both use real functional exchanges rather than social events as the contact medium; pinning holds counterparts on exchanges people already make, while probe repair routes help requests across neighbour ties as a test.
- mech.load-probed-tie-repair analogy mech.ended-tie-credential-bridge: Both treat a tie's measured state as evidence the institution acts on; the bridge freezes logged co-presence into a warrant at dispersal, while probe repair measures whether the tie carries a real request and repairs it in place.
- mech.place-anchored-stranger-corroboration opposition mech.ended-tie-credential-bridge: Opposite sources of an introduction warrant for a mover: the bridge carries a transitive social warrant (a shared acquaintance from an ended tie) and places the holder; corroboration uses a non-social place record of the stranger's own presence and counts presence that tracks the viewer as evidence against.
- mech.place-anchored-stranger-corroboration analogy mech.obligatory-exchange-counterpart-pinning: Both place contact on waits people already spend at fixed public spots, adding no discretionary time; pinning fixes which counterparts share the wait, corroboration leaves counterparts unfixed and supplies only evidence about a chosen regular.
- mech.place-anchored-stranger-corroboration analogy mech.readiness-gated-copresence-sync: Both leave the pool unfixed, use fixed public spots and act only on a mutual gate (near-ready quorum vs mutually resolved Open pairs); the relay holds timing of coincidence, corroboration holds evidence about a counterpart's safety.
- mech.place-anchored-stranger-corroboration analogy mech.compensated-post-held-acknowledgment: Both put the institution's contribution in a place-bound post that outlasts its users; the ward's post is staffed by paid rotating people supplying attention without warrant, the datum post is unstaffed and supplies warrant without attention.
- mech.tie-cold-contact-shield opposition mech.load-probed-tie-repair: Opposite control laws on tie load: probe repair injects genuine favours across a tie and repairs it when they go unanswered; the shield strips favours, disputes and shared duties from the tie as wear and never tests it.
- mech.tie-cold-contact-shield opposition mech.obligatory-exchange-counterpart-pinning: Opposite valuations of obligatory contact: pinning uses owed exchanges and waits as the medium that builds familiarity; the shield treats owed, rushed contact as the source of tie wear and subtracts it.
- mech.tie-cold-contact-shield analogy mech.arrival-dose-metered-taper: Both capture the move-in disruption window to forge ties and rest persistence on person-held ties; the taper meters withdrawal of its own sessions, while the shield installs a lasting removal of cold contact from the tie.
- mech.tie-cold-contact-shield analogy mech.co-placed-tie-carry: Both protect an existing person-held tie rather than holding recurrence; carry protects it against separation at moves, the shield against friction in place.
- mech.tie-cold-contact-shield analogy mech.readiness-gated-copresence-sync: Both default to no invitation and let contact occur only on a receptivity signal; the relay hides readiness and times coincidence in an unfixed pool, the shield shows a flag to one fixed partner and filters contact valence within the pair.

Graded membership (Cuts):
- Witness Wards and the Vouched Nod [mech.w4]: mech.compensated-post-held-acknowledgment 0.6, mech.position-bound-tie-succession 0.15, mech.dedicated-occasion-contact-scaffold 0.1, remainder 0.15 (How does one unit of this candidate's causal account of reducing loneliness divide among the mechanism families it draws on?; unit: one unit of the candidate's stated causal account (operator plus roles))
- Seated Waits and the Parting Sheet [mech.w5]: mech.ended-tie-credential-bridge 0.45, mech.obligatory-exchange-counterpart-pinning 0.3, mech.position-bound-tie-succession 0.1, remainder 0.15 (How does one unit of this candidate's causal account of reducing loneliness divide among the mechanism families it draws on?; unit: one unit of the candidate's stated causal account (operator plus roles))
- Lean Relay and the Vent Hour [mech.w7]: mech.readiness-gated-copresence-sync 0.7, mech.arrival-dose-metered-taper 0.1, mech.dedicated-occasion-contact-scaffold 0.05, remainder 0.15 (How does one unit of this candidate's causal account of reducing loneliness divide among the mechanism families it draws on?; unit: one unit of the candidate's stated causal account (operator plus roles))
- Tap-Tested Ties: Load, Fail, Reflow [mech.w8]: mech.load-probed-tie-repair 0.65, mech.dedicated-occasion-contact-scaffold 0.1, mech.arrival-dose-metered-taper 0.05, mech.obligatory-exchange-counterpart-pinning 0.05, remainder 0.15 (How does one unit of this candidate's causal account of reducing loneliness divide among the mechanism families it draws on?; unit: one unit of the candidate's stated causal account (operator plus roles))
- Datum Posts: The Corner Vouches [mech.w9]: mech.place-anchored-stranger-corroboration 0.65, mech.ended-tie-credential-bridge 0.1, mech.obligatory-exchange-counterpart-pinning 0.08, mech.readiness-gated-copresence-sync 0.05, remainder 0.12 (How does one unit of this candidate's causal account of reducing loneliness divide among the mechanism families it draws on?; unit: one unit of the candidate's stated causal account (operator plus roles))
- Forge Fast, Then Shield the Tie [mech.w10]: mech.tie-cold-contact-shield 0.55, mech.arrival-dose-metered-taper 0.15, mech.dedicated-occasion-contact-scaffold 0.1, mech.readiness-gated-copresence-sync 0.05, remainder 0.15 (How does one unit of this candidate's causal account of reducing loneliness divide among the mechanism families it draws on?; unit: one unit of the candidate's stated causal account (operator plus roles))

## Claimed-outcome ontology

- [outcome.continuous-regard] Continuous in-person regard across tenure, arrival and moves: 0 direct, 6 in subtree
  operator: Each served resident, from arrival onward and across moves, is regularly met in person by others who register them, so no stretch of tenure passes unregarded. Loneliness is claimed to fall because in-person regard is never interrupted, whether it is carried by a relationship with specific people or by recognition from whoever occupies a role.
  partition partition.continuous-regard.what-is-held, lens: What the resident is claimed to hold: a recurring relationship with specific counterparts, or recognition (noticed, named, missed) supplied by whoever occupies a rotating role, with no relationship claimed.; query: Is the claimed outcome that the resident holds a recurring tie with specific, identifiable counterparts, or that the resident is acknowledged and missed by rotating role-occupants without any specific relationship?
    - [outcome.arrival-standing-tie] Standing tie held from arrival onward: 0 direct, 5 in subtree
      operator: Each served resident holds, from arrival onward, at least one recurring face-to-face tie with specific counterparts, so that no part of tenure, and in particular the arrival period, is spent without a standing tie. Loneliness is claimed to fall because the resident is never without a recurring, specific relationship.
      partition partition.arrival-standing-tie.persistence-source, lens: Source of tie persistence: what keeps a standing tie in existence and working (structure refills the position when a party leaves; structure keeps the same pair within reach when a party moves; members sustain ties after support withdraws; structure detects and repairs, in place, a tie that silently stops carrying help while both parties stay).; query: Does the claimed outcome hold because the structure re-matches a counterpart when a party leaves, keeps the same pair within in-person reach when a party moves, hands tie maintenance to members once support ends, or continuously verifies that the tie carries real requests and repairs the same pair when it silently fails?
        - [outcome.turnover-surviving-tie] Standing tie that survives residential turnover: 2 direct, 2 in subtree
          operator: In a setting where residents or their counterparts move or turn over often, each served resident holds, from arrival onward, at least one recurring face-to-face tie with a specific, structurally assigned counterpart, whether a fellow resident or a fixed role-holder in a recurring exchange the resident already makes, and the structure rather than the members keeps that position filled: when either party leaves, the remaining party is handed or re-matched to a counterpart and the arriving party starts with one. The claim is continuous possession of a standing tie, not survival of one particular pair. Loneliness is claimed to fall because no tenure is spent without a standing tie.
          instances: Ties That Run With the Lease [mech.w1] (clear fit); Pinned Errands: Same Face, Same Slot [mech.w3] (partial fit)
        - [outcome.carried-pair-tie] Specific tie carried intact across a move: the same pair, including a half-formed tie, keeps accruing closeness: 1 direct, 1 in subtree
          operator: Each served resident who moves keeps, across the move, the specific face-to-face ties they had mutually declared with named others, including ties still forming. After the move the same pair remains near enough for recurring in-person contact without new scheduling effort, so the closeness already accrued keeps accruing instead of resetting to zero. The claim is survival and continued deepening of a particular pair across relocation. It is not a refilled tie position and not earned closeness converted into warrant for new ties. Loneliness is claimed to fall because moving no longer forfeits the relationships a resident was building, especially unfinished ones, which are the most easily lost and the most costly to rebuild.
          instances: Carry Clause: Move the Unfinished Tie [mech.w6] (clear fit)
        - [outcome.self-sustained-arrival-ties] Arrival ties that become self-sustaining after support withdraws: 1 direct, 1 in subtree
          operator: Each served newcomer, within the first weeks after arrival, comes to hold a small set of recurring face-to-face ties with specific nearby co-arrivals. The members themselves initiate and maintain these ties, so they persist once the external support that seeded them has ended. Loneliness is claimed to fall because the arrival period is no longer spent alone and the ties no longer depend on outside hosting.
          instances: Arrival Week, Metered Taper [mech.w2] (clear fit)
        - [outcome.load-verified-tie] Load-verified tie: nearby ties that demonstrably carry a real small request, kept working in place by the structure: 1 direct, 1 in subtree
          operator: Each served resident, from arrival onward, holds ties with specific nearby households that are shown to carry help: a genuine small request across the tie is answered within a set window. A tie that looks intact but carries nothing is treated as not held. The structure keeps the resident's ties in this working state for as long as it serves them. It detects silent failure, repairs the same pair in place, re-matches without blame only after repeated failure, and re-checks after a household upheaval. The claim is a standing tie the resident can rely on for small help, not recurring contact frequency, a refilled position after departure, or recognition. Loneliness is claimed to fall because the resident's nearby ties actually carry something instead of remaining nodding acquaintance that gives way under any request.
          instances: Tap-Tested Ties: Load, Fail, Reflow [mech.w8] (clear fit)
    - [outcome.rotating-witnessed-recognition] Recognition without a tie: noticed, named and missed by a rotating role: 1 direct, 1 in subtree
      operator: Each served resident who chooses to be present is acknowledged in person whenever they appear, is known by name if they opt in, and has their absence noticed and followed up. This recognition is supplied by whoever currently occupies a rotating role, and the structure carries knowledge of the resident across changes of occupant and across the resident's moves. No relationship with a specific counterpart and no conversation is claimed. Loneliness is claimed to fall because the resident matters visibly: they are noticed when present and missed when absent.
      instances: Witness Wards and the Vouched Nod [mech.w4] (clear fit)
- [outcome.readiness-matched-copresence] Readiness-matched co-presence: residents meet in person when already near-ready, never arrive first and alone, and are never approached in their quiet: 1 direct, 1 in subtree
  operator: Each served resident, at moments when they are already inclined toward company, finds others present or arriving at a shared in-person place within the same window, so they never have to arrive first and alone. While not inclined, they receive no invitation and so face no decline. Contact frequency is not claimed to rise. What changes is that meetings coincide with residents' own readiness and that unready periods are left undisturbed. No relationship with specific counterparts, no recognition by name and no follow-up of absence are claimed. Loneliness is claimed to fall because readiness turns into actual in-person company instead of dissipating, and because the costs of unwanted contact (guilty declines and the withdrawal they cause) are removed.
  instances: Lean Relay and the Vent Hour [mech.w7] (clear fit)
- [outcome.warranted-first-contact] Warranted first contact: new counterparts are met in person as vouched-for rather than as unaccountable strangers: 0 direct, 2 in subtree
  operator: Each served resident meets new in-person counterparts with an independent, checkable ground that each is accountable and safe to meet, so first contact does not happen with an unvouched stranger. Loneliness is claimed to fall because the perceived danger and cold start of strangers no longer block new in-person contact. The kinds differ in what grounds that warrant.
  partition partition.warranted-first-contact.warrant-source, lens: Source of the warrant that makes a new counterpart safe to meet: closeness earned with a shared earlier partner and carried through a move (portable, relational), or a fixed place's independent presence record built over separate days (non-portable, non-relational).; query: Does the claimed outcome vouch for new counterparts through relational standing the resident earned and carries across a move, or through corroboration held only by a fixed place, independent of any shared acquaintance?
    - [outcome.vouched-arrival-carried-closeness] Vouched arrival: closeness earned before a move carried as checkable standing that seats the mover among friends-of-friends: 1 direct, 1 in subtree
      operator: Each served resident who has accrued friendship-depth face-to-face time with specific others during a tenure carries that closeness through a move as durable standing that third parties can check. Soon after arriving elsewhere, the resident is met in person, recurringly, by people connected to them through a shared earlier partner, so new counterparts are not unvouched strangers and the resident does not restart from zero. The original pair is not claimed to stay in contact; what crosses the move is earned closeness used as warrant for new specific ties. Loneliness is claimed to fall because a move no longer resets a resident's social standing to stranger, and new contact is claimed to be safer because each counterpart is accountable through a known shared link.
      instances: Seated Waits and the Parting Sheet [mech.w5] (clear fit)
    - [outcome.place-corroborated-approach] Place-corroborated approach: unacquainted nearby regulars made verifiably safe to meet in graded steps, with no mutual friend and no portable reputation: 1 direct, 1 in subtree
      operator: Each served resident, including a lone resident with no mutual friends locally, can tell which unacquainted people they repeatedly share an ordinary place with are independent, long-standing regulars and which are present only when they are. The resident can meet the former in person in graded first steps (a nod, a name, a short shared walk) at no added time, with neither party facing negotiation or refusal. The warrant is held only by a fixed place's accumulated record of time-separated presence. It is not a relationship, not recognition by a role-occupant, and not standing carried through a move; it must be rebuilt over weeks after relocation. No recurring tie with specific counterparts is claimed. Loneliness is claimed to fall because fear of strangers no longer blocks first in-person contact, and people whose presence tracks the resident's are excluded rather than trusted.
      instances: Datum Posts: The Corner Vouches [mech.w9] (clear fit)
- [outcome.wear-shielded-arrival-ties] Wear-shielded arrival ties: a few warm ties forged on arrival, kept warm because obligation and friction are kept off them and contact waits for receptivity: 1 direct, 1 in subtree
  operator: Each served newcomer, within a bounded arrival window after each move, comes to hold a few mutually chosen ties with specific nearby residents, and those ties are kept positive rather than worn into avoidance. The structure permanently removes unsolicited, obligatory and conflictual contact from each registered pair: no owed small talk, favours, shared duties or disputes travel along the tie. In-person contact between partners occurs only when one signals receptivity and the other accepts, and refraining costs nothing. No contact frequency, no help carried across the tie, and no regard during quiet stretches is claimed. Loneliness is claimed to fall because new local ties are acquired quickly and are never spent on contact that builds nothing, so they remain warm and available instead of turning into neighbours one avoids.
  instances: Forge Fast, Then Shield the Tie [mech.w10] (clear fit)

Relations:
- outcome.turnover-surviving-tie other outcome.self-sustained-arrival-ties: complementary failure coverage: protects against a counterpart's departure, while the target protects against withdrawal of support
- outcome.rotating-witnessed-recognition analogy outcome.turnover-surviving-tie: Both make the structure, not the members, carry continuity across turnover by handover; they differ in the held good: recognition by a rotating role versus a tie with an assigned counterpart.
- outcome.vouched-arrival-carried-closeness analogy outcome.turnover-surviving-tie: Both seat an arriving resident with specific counterparts; they differ in what crosses the move: earned closeness that warrants friends-of-friends versus a refilled tie position assigned to anyone.
- outcome.vouched-arrival-carried-closeness analogy outcome.rotating-witnessed-recognition: Both have structure carry something about the resident across moves; they differ in what is carried: earned relational depth that yields new ties versus knowledge that yields recognition without a tie.
- outcome.vouched-arrival-carried-closeness other outcome.self-sustained-arrival-ties: complementary coverage: serves movers who carry accrued closeness, while the target serves first-time arrivals with no history
- outcome.carried-pair-tie analogy outcome.vouched-arrival-carried-closeness: Both claim that closeness accrued before a move is not reset by it; they differ in what crosses: the same pair continues to deepen, versus earned closeness used as warrant for new ties while the original pair is not claimed to stay in contact.
- outcome.carried-pair-tie other outcome.turnover-surviving-tie: complementary failure coverage: preserves the specific pair when a party moves within the structure's reach, while the target refills the tie position with a new counterpart when a party leaves
- outcome.carried-pair-tie other outcome.self-sustained-arrival-ties: complementary coverage: serves movers who already hold a declared tie, while the target serves arrivals with no tie to carry
- outcome.readiness-matched-copresence opposition outcome.continuous-regard: Opposed on whether unready stretches should receive contact: regard never interrupted and absence followed up, versus quiet left undisturbed and contact confined to moments of readiness, with frequency not raised
- outcome.readiness-matched-copresence analogy outcome.rotating-witnessed-recognition: Both supply in-person contact through structure while claiming no relationship with specific counterparts. They differ in the held good: company coinciding with readiness while quiet is protected, versus being named, noticed and missed.
- outcome.load-verified-tie analogy outcome.turnover-surviving-tie: Both make the structure, not the members, keep a resident's tie with specific counterparts working. They differ in the failure covered: silent non-function while both parties stay, repaired in place, versus a party's departure, answered by refilling the position.
- outcome.load-verified-tie opposition outcome.self-sustained-arrival-ties: Opposed on where durability lives: permanent structural verification and repair of whether ties carry help, versus ties that persist because members sustain them once seeding support withdraws.
- outcome.load-verified-tie opposition outcome.readiness-matched-copresence: Opposed on unsolicited demand: residents are placed under genuine requests regardless of momentary inclination, paused only for upheaval, versus contact confined to moments of readiness with quiet left undisturbed.
- outcome.place-corroborated-approach opposition outcome.vouched-arrival-carried-closeness: Opposed on portability of warrant: standing held only by a fixed place and rebuilt after every move, with no reputation travelling, versus earned standing carried through the move as checkable warrant.
- outcome.place-corroborated-approach analogy outcome.rotating-witnessed-recognition: Both have a non-relational structure hold knowledge of residents that a relationship would otherwise supply. They differ in the held good: peers corroborated as safe to approach, versus being noticed, named and missed by a role-occupant.
- outcome.place-corroborated-approach analogy outcome.readiness-matched-copresence: Both confine contact to opt-in moments and remove the cost of refusal. They differ in the held good: corroborated safety of first contact with unacquainted regulars, versus company coinciding with readiness.
- outcome.place-corroborated-approach other outcome.self-sustained-arrival-ties: complementary coverage: corroboration needs weeks of baseline, leaving newcomers unresolved to regulars at first, while the target seeds ties in the first weeks after arrival
- outcome.wear-shielded-arrival-ties analogy outcome.self-sustained-arrival-ties: Both seed a small set of specific local ties in a bounded window after arrival; they differ in what keeps them: members sustaining them once support withdraws, versus the structure permanently shielding them from wearing contact.
- outcome.wear-shielded-arrival-ties opposition outcome.load-verified-tie: Opposed on whether obligation along a tie proves it or wears it: favours, owed small talk and disputes stripped from the pair so that the tie is never spent, versus real requests placed across the tie as the test of holding it.
- outcome.wear-shielded-arrival-ties analogy outcome.readiness-matched-copresence: Both gate in-person contact on signalled receptivity and leave quiet undisturbed with no cost of refusal; they differ in the held good: warm ties with specific registered partners versus company with whoever is ready.
- outcome.wear-shielded-arrival-ties opposition outcome.continuous-regard: Opposed on whether stretches between contacts should be filled: intervals left deliberately empty, with nothing owed, so that contact cannot wear the tie, versus regard that is never interrupted.

Graded membership (Cuts):
- Arrival Week, Metered Taper [mech.w2]: outcome.self-sustained-arrival-ties 0.75, outcome.turnover-surviving-tie 0.15, remainder 0.1 (How does one unit of mech.w2's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w2's principal claimed outcome)
- Witness Wards and the Vouched Nod [mech.w4]: outcome.rotating-witnessed-recognition 0.8, outcome.turnover-surviving-tie 0.1, remainder 0.1 (How does one unit of mech.w4's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w4's principal claimed outcome)
- Seated Waits and the Parting Sheet [mech.w5]: outcome.vouched-arrival-carried-closeness 0.7, outcome.turnover-surviving-tie 0.15, remainder 0.15 (How does one unit of mech.w5's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w5's principal claimed outcome)
- Carry Clause: Move the Unfinished Tie [mech.w6]: outcome.carried-pair-tie 0.7, outcome.self-sustained-arrival-ties 0.15, remainder 0.15 (How does one unit of mech.w6's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w6's principal claimed outcome)
- Lean Relay and the Vent Hour [mech.w7]: outcome.readiness-matched-copresence 0.75, outcome.rotating-witnessed-recognition 0.1, outcome.self-sustained-arrival-ties 0.05, remainder 0.1 (How does one unit of mech.w7's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w7's principal claimed outcome)
- Tap-Tested Ties: Load, Fail, Reflow [mech.w8]: outcome.load-verified-tie 0.7, outcome.turnover-surviving-tie 0.15, remainder 0.15 (How does one unit of mech.w8's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w8's principal claimed outcome)
- Datum Posts: The Corner Vouches [mech.w9]: outcome.place-corroborated-approach 0.7, outcome.vouched-arrival-carried-closeness 0.1, outcome.readiness-matched-copresence 0.05, remainder 0.15 (How does one unit of mech.w9's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w9's principal claimed outcome)
- Forge Fast, Then Shield the Tie [mech.w10]: outcome.wear-shielded-arrival-ties 0.7, outcome.self-sustained-arrival-ties 0.1, outcome.readiness-matched-copresence 0.05, remainder 0.15 (How does one unit of mech.w10's principal claimed outcome divide among outcome classes?; unit: one unit of mech.w10's principal claimed outcome)

## World regimes

- [kind.constitutive-bond-persistence] Constitutive-bond persistence: persistence secured by a maintained relation among the thing's own constituents: 0 direct, 0 in subtree
  operator: Partition of lens.persistence-composition: the persistence rule depends on a relation internal to the thing; once established, the relation self-sustains, and its lapse depends on internal or environmental severing, not on an ongoing external act.
- [kind.crossing-licensed-alteration] Crossing-licensed alteration: force acts only on targets resolved by agreeing plural vantages, with strength set by crossing tightness: 0 direct, 0 in subtree
  operator: Partition of lens.alteration-licensing: a body can exert or receive force only where sight-lines from at least two vantages agree within tolerance. Unresolved targets are intangible. Efficacy scales with the tightness of the crossing, which depends on baseline over distance. Changing a thing requires shifting a consensus, at a cost scaled by the baseline spanned times the number of vantages.
- [kind.indelible-formation-record] Indelible formation record: the formation record cannot be removed without destroying the thing; at most it can be overlaid: 0 direct, 0 in subtree
  operator: Partition of lens.formation-record: the rule for removing or overwriting the record maps every removal attempt to destruction of the thing, or to overlay without erasure.
- [kind.intrinsic-determinacy] Intrinsic determinacy: properties are definite and efficacious without any registrar: 0 direct, 0 in subtree
  operator: Partition of lens.determinacy-sourcing: a thing's position, size and state are definite and causally effective regardless of observation. Registrars affect only knowledge, not reality.
- [kind.lapse-triggered-release] Lapse-triggered release: the store is contained by a maintained gate and discharges when maintenance fails or is bypassed: 0 direct, 0 in subtree
  operator: Partition of lens.release-gating: the release condition is a function of the state of an external, periodically renewed containment commitment, independent of store level.
- [kind.path-erasable-formation-record] Path-erasable formation record: the formation record can be fully removed while the thing persists, but only along a specified process trajectory: 0 direct, 0 in subtree
  operator: Partition of lens.formation-record: the rule for removing or overwriting the record admits complete erasure with the thing preserved, conditioned on the trajectory (stage order and rates) of an enabling process rather than on its endpoint alone.
- [kind.plural-vantage-determinacy] Plural-vantage determinacy: properties become definite only where bearings from at least two separated registrars agree: 0 direct, 0 in subtree
  operator: Partition of lens.determinacy-sourcing: a single registrar yields only a partial determination (for example a bearing). Full definiteness and efficacy require consistent agreement among at least two spatially separated registrars. Precision grows with registrar separation relative to distance. Collinear or otherwise degenerate configurations leave the thing indeterminate. Disagreement beyond expected tolerance yields an unsettled state that costs energy until reconciled.
- [kind.reply-licensed-alteration] Reply-licensed alteration: change occurs only as the target's own answer to a call, as the call repeated with one attribute displaced: 0 direct, 0 in subtree
  operator: Partition of lens.alteration-licensing: by default a call alters nothing. A call to a target able to respond in kind is completed only by that target's reply, and the reply is the change. The reply repeats the call in every attribute but one, displaced by inversion, raising, delay or turning, and the target's nature selects which attribute. A zero-shift reply yields stasis. Calls to unresponsive targets fade without trace and cost the caller. Replies propagate with lag that grows with separation and with the number of intervening answerers. Repeated exchange lowers lag, shift and cost between a pair.
- [kind.store-triggered-release] Store-triggered release: discharge begins when the accumulated store reaches a condition set by the store or channel itself: 0 direct, 0 in subtree
  operator: Partition of lens.release-gating: the release condition is a function of store level and channel form.
- [kind.support-coupled-alteration] Support-coupled alteration: change licensed by a mechanical relation to a supporting body: 0 direct, 0 in subtree
  operator: Partition of lens.alteration-licensing: alteration requires a physical configuration of agent, body and support, with efficacy attenuating along the support chain.
- [kind.sustained-attention-persistence] Sustained-attention persistence: persistence held by an ongoing external act; lapse means decay: 0 direct, 0 in subtree
  operator: Partition of lens.persistence-composition: the persistence rule is a function of a continuous act by a sustainer outside the thing (enactment, recognition, tending). When the act lapses, the thing decays; the act can be handed between sustainers.
- [kind.witnessed-portrayal-alteration] Witnessed-portrayal alteration: change licensed by accurate enactment seen by a comprehending witness: 0 direct, 0 in subtree
  operator: Partition of lens.alteration-licensing: alteration occurs only through an enactment observed by an intended, comprehending witness. Efficacy scales with fidelity, and the cost equals the portrayed exertion.
- [lens.alteration-licensing] Alteration-licensing lens: which external relations must hold for a thing to change at all, and how the strength of change depends on them: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps a body's external relations (impacting agents, supports, reference masses, enabling conditions) to whether alteration of shape, composition or state can occur, and how strong or lasting it is. The rule specifies the default (inert or mutable), the required relational configuration, how efficacy attenuates along the relational chain, what enabling conditions gate plasticity, and what by-products or signals each licensed change emits.
- [lens.determinacy-sourcing] Determinacy-sourcing lens: which relations make a thing's properties definite and causally efficacious, and how definiteness is graded: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps a thing and its relations to registrars (observers, anchors, instruments) to which of its properties are definite, how definite they are, and whether it can exert or receive causal action. The rule specifies: the minimum number and kind of registrars; whether registrars must comprehend; how precision grades with registrar configuration and distance; which configurations are degenerate; how registrar disagreement is resolved and what it costs; and whether determinacy is instantaneous in configuration or held over time.
- [lens.formation-record] Formation-record lens: how the conditions under which a thing comes into being persist in it and govern what it can later be: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps the conditions of formation to a persistent internal record. The rule specifies what is recorded, whether and how the record can be removed or overwritten, what the record constrains, and under what conditions the record can be read.
- [lens.junction-licensing] Junction-licensing lens: whether and how separate things can be joined, what the join requires, how reversible it is, and what crosses it: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps a pair of separate bodies and their surroundings to the existence, quality and reversibility of a junction between them, and maps junction quality to what is transmitted (heat, signal, load, motion). The rule specifies whether direct contact suffices or a third agent is required, the ordering or compatibility conditions on the participants, the surface and enabling conditions, the formation window, the failure modes, the opening operation, and how a junction's state propagates to neighbouring junctions.
- [lens.opposition-resolution] Opposition-resolution lens: how opposed tendencies combine when they meet: cancel, equalize, dominate, or hold in suspension: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps two meeting opposed tendencies (thermal, mechanical, vital, social) to an outcome: annihilation, equalization, domination or standing suspension. The rule specifies where the residual difference goes (dissipated, stored, transmitted), whether the meeting creates a boundary with its own width, and what ends the resulting state.
- [lens.persistence-composition] Persistence-composition lens: how a thing's continued existence depends on what it is composed of and which relations among its constituents are maintained: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps a thing's constituents and their maintained relations to persistence, decay, repair and suspension. The rule specifies which constituents are required, what happens when a relation is absent or broken, which conditions sustain or sever it, and whether persistence is restorable.
- [lens.release-gating] Release-gating lens: how a stored quantity is converted into output flow: 0 direct, 0 in subtree
  operator: Classifies regimes by the rule that maps accumulated store and channel form to an output rate over time.
- [regime.baseline-consensus-resolution] Baseline-consensus resolution: things are definite and tangible only where bearings from separated vantages cross; precision ∝ baseline/distance; the shared axis stays flat: 1 direct, 1 in subtree
  operator: Nothing has intrinsic position, size or state. A thing's distance is baseline divided by shift. A single vantage yields only a bearing, so the thing is a flat with no depth or force. Solidity and force exist only where sight-lines from at least two vantages cross within tolerance, and force strength scales with crossing tightness. Precision scales with baseline over distance, so far things are stable references and near things are fluid. Along the line through two vantages the shift is zero, and things there stay flat until a vantage moves off the line. Disagreement beyond the expected shift leaves a thing unsettled (flicker, drift, candidate splits) and dissipates heat and noise until reconciled. The effort to change the world scales with the baseline spanned times the number of vantages brought to agree.
  instances: The Shifted World: Where Only Differences Between Viewpoints Are Real [lib.world.w9] (clear fit)
- [regime.grounded-impact-alteration] Grounded-impact alteration: matter changes only when struck against a less-yielding support, with efficacy decaying along the support chain to an absolute ground: 1 direct, 1 in subtree
  operator: Bodies are inert by default. A body (Work) alters only when driven by a moving mass (Blow) against a support (Ground) that yields less than it does. Ground is a role, not a kind. Every Ground is itself a Work on a greater Ground, ending at an unyielding Bedrock, and a blow's efficacy falls with the number of links between the Ground and Bedrock. Energy not spent reshaping returns through the Ground as an audible ring whose quality reports the split, so all change is signalled. Heat gates plasticity: only heated matter takes a lasting form, cold matter shatters or rebounds, and reheating erases form. Each Work tolerates a finite number of blows before brittleness; reheating restores non-living matter, but living matter cannot be fully reheated and hardens to death.
  instances: The Struck World: Where Nothing Changes Except Against the Anvil [lib.world.w10] (clear fit)
- [regime.mediated-reflow-joining] Mediated reflow joining: bodies couple only through a lower-melting third that wets clean faces in a brief undisturbed heat window; every seam is reversible and gates flow: 1 direct, 1 in subtree
  operator: Direct contact gives no bond. Bodies A and B join only if a mediator M with melt(M) below both melts is present and wets both. Wetting requires faces cleared of an ever-regrowing film by a film-matched flux. A seam forms only by a brief dwell just above melt(M) followed by undisturbed cooling. Too little heat gives a cold joint, too much damages the bodies, and motion during freezing gives a disturbed joint. Eutectic mediators freeze sharply; plastic-range mediators are unreliable. Seams are the weakest element and fatigue and creep. Reheating reflows a seam, separating the bodies for rejoining. Joined bodies form one conduit for heat, signal, load and motion, and reheating leaks into neighbouring seams, forcing tiered high-to-low-melt order.
  instances: The Reflow World: Where Nothing Holds Without a Melting Third [lib.world.w8] (clear fit)
- [regime.obligate-complementary-pairing] Obligate complementary pairing: enduring things exist only as bonded composites of a structural Holder and an energy-drawing Giver; neither persists alone: 1 direct, 1 in subtree
  operator: Every enduring thing is a bonded composite of two complementary halves: one supplies structure and retention, the other draws energy from light. The bond forms only by sustained contact under enabling conditions (moisture and light) at a rate that cannot be forced. Unpaired halves decay at a fixed rate. The composite self-mends, grows only at its living edge at a bounded rate, and suspends losslessly when its enabling conditions lapse. Environmental contaminants sever bonds. Each bond consumes its substrate irreversibly, so viable ground is a depleting stock.
  instances: The Thallus Law: A World Where Nothing Stands Alone [lib.world.w6] (clear fit)
- [regime.path-dependent-strain-relaxation] Path-dependent strain relaxation (anneal): making stores conserved strain; only a soak then a sub-critical ramp exports it, erasing form and memory; quench locks it; overload snaps: 1 direct, 1 in subtree
  operator: Every act of making adds internal strain in proportion to its force and speed, against a finite capacity. Strain is the sole cause of failure. Strain leaves a thing only along a two-stage trajectory: hold the thing above its own mobility threshold (soak), then cool it slower than its own critical rate (ramp). Either stage alone does nothing. Cooling faster than the critical rate (quench) freezes the current arrangement, defects included, at full strain. Relaxation conserves strain by exporting it to the surroundings, so enclosure and crowding slow it, and relaxation time grows with size and complexity. Relaxation also erases imposed form and inscribed record, so a thing can be stable or remembering but not fully both. When strain exceeds capacity, the excess releases at once as a snap that loads coupled neighbours and can cascade.
  instances: The Slow Settling: A World Where Anneal Is Fundamental Law [lib.world.w2] (clear fit)
- [regime.renewal-held-truce] Renewal-held truce: opposed tendencies suspend at a boundary, storing their difference while bilateral renewal holds; lapse or breach releases it scaled by hold time: 1 direct, 1 in subtree
  operator: When opposed tendencies meet they neither cancel nor equalize. They hold at a Line, and their difference accumulates without decay as stored potential. Containment lasts for a finite term and continues only if both sides perform a coordinated, costly renewal before expiry. If renewal fails, the store is released at once, with magnitude equal to the accumulated difference times hold duration, so long, well-kept holds fail worst. Bypassing the bilateral license (unilateral force) is a breach: the boundary and its neutral margin collapse, the store releases immediately, and the act cannot be undone; only a new truce from shifted positions can follow. Each boundary has a neutral margin, narrower between stronger opposites, where neither tendency acts.
  instances: The Held Line: A World Where Truce Is Physical Law [lib.world.w1] (clear fit)
- [regime.settling-imprint] Settling imprint: a one-way transition to fixity permanently records the shaping conditions, the record caps later capability, and it is legible only through a gating medium: 1 direct, 1 in subtree
  operator: Matter passing from a formative fluid state to a fixed state is impressed with its shaping conditions as an internal pattern. The pattern cannot be removed without destroying the thing. It bounds strength and function, and a joint is capped by the fainter mark. Identical records arise only from the same shaping constraint, so constraints such as moulds dominate copying. Re-formation is possible but layers a new record over fading ghosts. After a bounded number of cycles the matter becomes blank and weak. Records can be read only through a transmission medium, so opacity is the only source of privacy.
  instances: The Settled World: Where Every Thing Keeps the Mark of Its Making [lib.world.w5] (clear fit)
- [regime.shifted-echo-exchange] Shifted-echo exchange: change happens only as a responsive target's reply to a call, repeating it with one attribute displaced; closed reply-rings are things: 1 direct, 1 in subtree
  operator: Every change is half of a call-answer pair. A call produces change only when a target able to answer replies. Unanswered calls fade without trace, and the caller's spent reserve is not returned. A reply repeats the call with exactly one attribute displaced, and the target's nature chooses which; a pure echo is stasis and stable matter. Replies lag in proportion to separation and the number of relays, so distant regions run in different nows. Opposed calls that meet before either is answered form a still, cold overlap-hush. Answer chains that return to their origin close into rings, which are objects, bodies and promises. Strength counts nested closed rounds, and breaking one ring forces its neighbours to re-answer. Repeated mutual answering builds a refrain: a coupling that is faster, less shifted and lower in cost, the only enduring attraction, loosened only by a third party's competing refrain. Callers left unanswered thin and fade.
  instances: The Answered World: Where Nothing Occurs Unless Called and Replied [lib.world.w3] (clear fit)
- [regime.threshold-burst-release] Threshold-burst release: confined channels integrate supply to a fixed threshold and discharge near-totally, with a refractory proportional to the discharge: 1 direct, 1 in subtree
  operator: Supply enters a constricted channel at a steady rate and accumulates. When the store reaches the channel's form-fixed threshold, it discharges almost completely and almost instantly. The refill interval is proportional to the amount released, so flux balances over each cycle. Rising-frequency precursor bursts precede release. Narrower throats give higher thresholds, harder bursts and longer recharges. Channels sharing one reservoir subtract each other's draw and lock into alternating rhythms. Unconfined media flow continuously.
  instances: The Interval Law: A World Where Everything Erupts [lib.world.w7] (clear fit)
- [regime.witnessed-enactment-persistence] Witnessed-enactment persistence: things exist only while enacted or recognized; unattended they blur to Blank; effect scales with portrayal fidelity and reaches only sightlines: 1 direct, 1 in subtree
  operator: A thing has no substance; it persists only while some body holds its gesture or some comprehending witness recognizes it. Unattended, it blurs and then goes Blank. A performer's act ends shortly after stopping unless another body takes over (handoff). A day-long rotating performance in unbroken sight (Fixing) persists until dishonor, forgetting or Drop. An enactment's effect is proportional to its fidelity, and the performer pays the portrayed exertion. Effects reach only along the sightlines of a witness the performer intended. Conflicting enactments in one field of view resolve to the more faithful portrayal. Loud sound slumps all active enactments within earshot, scaled by loudness and duration (Drop).
  instances: The Silent Stage: A World Held Up by Gesture [lib.world.w4] (clear fit)

## Worlds

### The Interval Law: A World Where Everything Erupts (lib.world.w7)

Seed: geyser (library). Builder isolation: fresh_context. Target-blind task: no (move, neighbor, neighbors).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w7).

Principle: In this world, no quantity moves continuously through a constriction. Heat, water, motion, light, sound, and the pressure of living bodies all behave like a geyser. Supply enters a confined channel at a steady rate and cannot pass the narrow throat. It accumulates, and when the stored amount crosses the channel's threshold it discharges all at once. The channel then empties and begins to refill.

Steady flow exists only where there is no confinement, such as open pools, wide plains, and slack water. Everything that does anything, such as carrying, pushing, lighting, or thinking, happens through a constricted channel and so happens in bursts.

Physics here is the study of charge, threshold, and discharge. A "smooth" quantity is just a burst train too fast or too finely overlapped to notice.

- R1: Threshold release. Every confined channel has a fixed threshold. Below it nothing leaves except minor seepage. At it, the stored quantity discharges nearly completely and almost instantly. Thresholds are properties of the channel's shape and material, not of the supply.
- R2: Proportional silence. The refill interval after a discharge is proportional to the amount discharged. A big eruption is followed by a long quiet, and a small one by a short quiet. Over a full cycle, supply in equals discharge out, so average flow is constant even though instantaneous flow almost never is.
- R3: Preplay. Before a full discharge, a channel gives small warning bursts ("play") at rising frequency, as the stored amount approaches the threshold. Preplay does not discharge the channel meaningfully. Channels with long cycles give the most warning, and very short channels give almost none.
- R4: Throat governs violence. A narrower throat gives a higher threshold, a taller and harder burst, and a longer recharge. A wide throat cannot hold a charge and simply leaks, so it produces calm but useless flow. A channel's usefulness comes from being narrow enough to store and wide enough to release in a useful time.
- R5: Shared reservoirs compete. Channels fed from one reservoir drain each other. When one erupts, its neighbors' recharge intervals lengthen by the amount taken. Total discharge across the group is limited by supply. Over time, linked channels drift into stable alternating rhythms. Tapping a new channel into a reservoir slows the existing ones.

World model (model.w7): 59 processes and 33 laws, model 76e04f5ed157. Rules modelled: R1 (A-threshold, B-threshold, C-threshold, N-threshold, M-threshold, W-threshold, A-charge-flow, B-charge-flow, C-charge-flow, N-charge-flow, M-charge-flow, W-charge-flow, A-discharge, B-discharge, C-discharge, N-discharge, M-discharge, W-discharge); R2 (A-charge-flow, B-charge-flow, C-charge-flow, N-charge-flow, M-charge-flow, A-quiet-clock, B-quiet-clock, C-quiet-clock, N-quiet-clock, M-quiet-clock, A-discharge, B-discharge, C-discharge, N-discharge, M-discharge, reservoir-supply-in, group-mean-flow); R3 (A-preplay, B-preplay, C-preplay, N-preplay, M-preplay); R4 (A-threshold, B-threshold, C-threshold, N-threshold, M-threshold, W-threshold, N-charge-flow, M-charge-flow, W-charge-flow, W-seepage-out, N-discharge, M-discharge, W-discharge); R5 (reservoir-balance, A-charge-flow, B-charge-flow, C-charge-flow, A-discharge, B-discharge, C-discharge, tap-new-channel, group-mean-flow).
Left out: People, trades, institutions, calendars and society are left out, as instructed. Engine time is an abstract tick; the world's vent-read time is not modelled. 'Almost instantly' is a single-step release; 'nearly completely' is fixed at 97%; 'minor seepage' is a leak proportional to stored charge. R4's 'wide throat cannot hold a charge' is encoded as seepage rising exponentially with width. The exp(2.5 x width) form, the threshold scale 10, the feeds and all other constants are my choices, not the world's. R5's 'recharge intervals lengthen by the amount taken' is rendered as draining 30% of each neighbour's stored charge at an eruption, which lengthens its recharge by taken/intake. The drained charge leaves with the eruption and is counted in group.discharged, but not in the erupting channel's last_burst. R2 and R5 conflict on shared channels: a drained neighbour's quiet exceeds R2's proportion. R5's lengthening is allowed to override R2 there; R2 holds exactly only for standalone channels N and M. The drift into alternating rhythms is expected from the drain coupling (a contraction, worked out by hand) but has not been verified by running the model. A and B start out of phase; an exactly simultaneous start would stay in phase. Preplay is a random hazard with a fixed onset at 60% fill. The wide channel W has no preplay law, because it never approaches threshold. Charge bounds clamp at 0. Simultaneous preplay and discharge in one step slightly undercount last_warning. The core principle's 'smooth quantity is a fast burst train', the faked continuous output from offset channels, usefulness, precision sensitivity and the rest of the easy/hard lists are described consequences with no rule of their own. They are not modelled as laws. The reservoir is an unconfined open pool and so flows steadily, per the core principle; this is not covered by an R id. Only one geometry is modelled: three coupled channels and three standalone channels of differing width.

A run of 400 tick (abstract engine time; the world itself has no uniform clock)s:
- reservoir.level: from 12.5 to 8.3333 (range 8.3333 to 12.5, mean 10.504)
- reservoir.supplied: from 0 to 400 (range 0 to 400, mean 200)
- group.discharged: from 0 to 375.68 (range 0 to 375.68, mean 186.27); 30 events, every 13.357 on average, first at 8.6, 22.05, 33.1, 45.8, 57.9, 69.95, 81.95, 93.8
- group.mean_flow: from 0 to 0.93921 (range 0 to 1.3118, mean 0.90258); 2 events, every 13.45 on average, first at 8.6, 22.05
- C.tapped: from 0 to 1 (range 0 to 1, mean 0.49994); 1 events, first at 200.05
- A.charge: from 6 to 4.9069 (range 0.26546 to 10.022, mean 5.4631)
- B.charge: from 1 to 1.656 (range 0.31551 to 10.02, mean 5.3986)
- C.charge: from 0 to 7.1887 (range 0 to 10.011, mean 2.6662)
- A.last_quiet: from 0 to 45.05 (range 0 to 45.05, mean 30.554); 4 events, every 94.267 on average, first at 8.6, 33.1, 246.55, 291.4
- B.last_quiet: from 0 to 44.75 (range 0 to 45, mean 29.998); 6 events, every 65.83 on average, first at 22.05, 45.8, 218.75, 262.15, 306.2, 351.2
- C.last_quiet: from 0 to 43.45 (range 0 to 236.55, mean 37.551); 2 events, every 85.45 on average, first at 236.6, 322.05
- A.last_burst: from 0 to 9.7103 (range 0 to 9.7218, mean 9.4996); 1 events, first at 8.6
- B.last_burst: from 0 to 9.7053 (range 0 to 9.7196, mean 9.1733); 1 events, first at 22.05
- C.last_burst: from 0 to 9.7057 (range 0 to 9.7107, mean 3.965); 1 events, first at 236.6
- A.eruptions: from 0 to 13 (range 0 to 13, mean 7.4782); 13 events, every 31.05 on average, first at 8.6, 33.1, 57.9, 81.95, 105.95, 130.05, 154.2, 178.6
- B.eruptions: from 0 to 13 (range 0 to 13, mean 7.0437); 13 events, every 31.158 on average, first at 22.05, 45.8, 69.95, 93.8, 117.9, 142, 166.5, 190.55
- C.eruptions: from 0 to 4 (range 0 to 4, mean 0.99513); 4 events, every 42.967 on average, first at 236.6, 277.95, 322.05, 365.5
- A.last_warning: from 0 to 15 (range 0 to 15, mean 6.4394); 9 events, every 46.575 on average, first at 8.6, 33.1, 57.9, 130.05, 178.6, 203.35, 291.4, 336.15
- B.last_warning: from 0 to 13 (range 0 to 13, mean 4.9045); 8 events, every 53.414 on average, first at 22.05, 69.95, 117.9, 166.5, 218.75, 306.2, 351.2, 395.95
- C.last_warning: from 0 to 6 (range 0 to 14, mean 3.8303); 2 events, every 85.45 on average, first at 236.6, 322.05
- N.charge: from 0 to 14.379 (range 0 to 20.023, mean 10.452)
- N.threshold: from 20 to 20 (range 20 to 20, mean 20)
- N.last_quiet: from 0 to 41.65 (range 0 to 42.7, mean 36.997); 4 events, every 96.183 on average, first at 42, 123.2, 205.75, 330.55
- N.last_burst: from 0 to 19.423 (range 0 to 19.423, mean 17.372); 1 events, first at 42
- N.violence: from 0 to 38.845 (range 0 to 38.845, mean 34.744); 1 events, first at 42
- N.eruptions: from 0 to 9 (range 0 to 9, mean 4.3653); 9 events, every 41.275 on average, first at 42, 81.95, 123.2, 164, 205.75, 246.6, 287.85, 330.55
- N.plays_cycle: from 0 to 0 (range 0 to 18, mean 1.1844); 89 events, every 3.8193 on average, first at 34.85, 37.6, 38.8, 39.05, 39.65, 40.85, 41.75, 70.45
- N.last_warning: from 0 to 12 (range 0 to 18, mean 8.7923); 5 events, every 72.138 on average, first at 42, 123.2, 205.75, 287.85, 330.55
- M.charge: from 0 to 4.2303 (range 0 to 6.6882, mean 3.515)
- M.threshold: from 6.6667 to 6.6667 (range 6.6667 to 6.6667, mean 6.6667)
- M.last_quiet: from 0 to 13.95 (range 0 to 14.25, mean 13.485); 1 events, first at 14.3
- M.last_burst: from 0 to 6.4725 (range 0 to 6.4876, mean 6.2452); 1 events, first at 14.3
- M.violence: from 0 to 4.315 (range 0 to 4.325, mean 4.1635); 1 events, first at 14.3
- M.eruptions: from 0 to 28 (range 0 to 28, mean 13.792); 28 events, every 13.974 on average, first at 14.3, 28.15, 42.25, 56.3, 70.25, 84.1, 97.95, 111.85
- M.last_warning: from 0 to 3 (range 0 to 6, mean 2.825); 13 events, every 31.442 on average, first at 14.3, 42.25, 111.85, 125.85, 153.85, 168, 196.05, 224.15
- W.charge: from 0 to 0.1135 (range 0 to 0.1135, mean 0.11344)
- W.threshold: from 2.5 to 2.5 (range 2.5 to 2.5, mean 2.5)
- W.seeped: from 0 to 199.89 (range 0 to 199.89, mean 99.887)
- W.eruptions: from 0 to 0 (range 0 to 0, mean 0)

Scenario (scenario.w7): A large vent-town district where residents' reach channels (A, B, later newcomer C) fill from one shared reservoir of hours and can only reach out by erupting at threshold. Because each unmatched reach-out drains the neighbour's stored readiness by 30% (an approach into another's quiet costs them), the neighbours drift into alternating rhythms and always reach out into each other's silence: loneliness. Residents move every 110 ticks (the resident at B is replaced with an empty channel) and a newcomer is tapped in at t=200, slowing everyone (R5). The district's Long Vent N erupts on its own long, well-warned cycle and is the public rhythm available to coordinate around.
Measure: cooccurrence of A.eruptions, B.eruptions, C.eruptions within 1 after time 20; higher is better (Share of neighbours' reach-outs that are met by another neighbour's reach-out within one tick; near 0 means everyone reaches out into others' silence (loneliness), near 1 means reach-outs meet.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0 (mean of 5 draws, range 0 to 0)
- intervention:meet-at-long-vent (Meet at the Long Vent: catch public and neighbour surges so reach-outs fall together): 0.92737 (mean of 5 draws, range 0.90476 to 0.95833)
- ablation:meet-at-long-vent/gather (Meet at the Long Vent: catch public and neighbour surges so reach-outs fall together, without Catchers pour the Long Vent's burst into neighbours' channels up to threshold): 0.73476 (mean of 5 draws, range 0.72727 to 0.76471)
- ablation:meet-at-long-vent/relay (Meet at the Long Vent: catch public and neighbour surges so reach-outs fall together, without Catchers pass half of each reach-out's burst to neighbours already in preplay): 0.52193 (mean of 5 draws, range 0.51351 to 0.54054)
- ablation:meet-at-long-vent/welcome (Meet at the Long Vent: catch public and neighbour surges so reach-outs fall together, without Fill a new resident's channel from the reservoir to match a settled neighbour): 0.82368 (mean of 5 draws, range 0.725 to 0.92)
- intervention:quicker-reaches (Quicker, smaller reaches: widen throats so reach-outs come more often): 0.010256 (mean of 5 draws, range 0 to 0.051282)
- ablation:quicker-reaches/wider-neighbours (Quicker, smaller reaches: widen throats so reach-outs come more often, without Chargers widen A's and B's throats (lower threshold, shorter recharge)): 0 (mean of 5 draws, range 0 to 0)
- ablation:quicker-reaches/wider-newcomer (Quicker, smaller reaches: widen throats so reach-outs come more often, without Chargers widen the newcomer's throat): 0 (mean of 5 draws, range 0 to 0)

Solve (sol.w7, solver isolation fresh_context, runs cited: intervention:meet-at-long-vent, ablation:meet-at-long-vent/gather, ablation:meet-at-long-vent/relay, ablation:meet-at-long-vent/welcome, intervention:quicker-reaches, ablation:quicker-reaches/wider-neighbours, ablation:quicker-reaches/wider-newcomer):

# Ending Loneliness by Erupting Together: The Long Vent Gathering

## What the runs say loneliness is

The district model framed loneliness as a timing failure, not a shortage of people. Each resident's reach channel fills from one shared reservoir of hours. Under **R5**, linked channels drift into stable alternating rhythms. As a result, every reach-out lands in a neighbour's quiet. An unmatched reach-out also costs that neighbour 30% of their stored readiness, so each approach pushes the next one further out of step.

The baseline (`scenario`) scored **0** in all five draws. No reach-out was...

### The Settled World: Where Every Thing Keeps the Mark of Its Making (lib.world.w5)

Seed: watermark (library). Builder isolation: fresh_context. Target-blind task: yes.
Imported from world library 9b121c938b78 (search search.loneliness, world world.w5).

Principle: In this world, matter exists in two conditions: wet (fluid, unsettled, formative) and set (fixed, enduring). Watermark is the law of passage between them. Whenever matter settles, the conditions of its settling (the mould, the hand, the current, the pressure, the maker's pattern) are impressed into its *depth* as a permanent variation in density. This is the watermark.

Everything that persists has one: stones, tools, bread, bones, rivers' banks, and people. A thing is not fully real until it is marked, and what a thing can be afterward is bounded by what its mark records.

- R1: , Imprint. Settling always records the shaping condition as a pattern of thicker and thinner substance inside the thing. Nothing sets unmarked. A thing set under two shaping conditions carries both, layered.
- R2: , Transmission. A watermark is invisible in reflected light and legible only in light passing *through* the thing. To read what something is, you must place it between yourself and a light. Thickness, opacity, and darkness all limit legibility. Very thick or very dark things are marked just as surely but cannot be read.
- R3: , Non-erasure. A mark cannot be removed without destroying the thing. A thing can be re-wetted, dissolved back to fluid and re-set, which imprints a new mark. But each re-wetting leaves a fainter ghost of the old mark beneath the new one. After about seven cycles the ghosts blur into illegibility and the matter becomes "blank." Blank matter is weak and cannot hold shape well.
- R4: , Ceiling. A set thing's strength, durability, and function cannot exceed what its mark supports. A cleanly and deeply marked blade holds an edge. A shallowly marked one chips, however it is forged afterward. Where two things join, the joint is only as strong as the fainter of the two marks.
- R5: , Mould primacy. A copy made by pressing carries the mould's mark plus a faint mark of its own pressing. Identical marks cannot arise except from the same mould. Moulds, the shaped constraints under which matter sets, are therefore the most consequential objects in the world.
- R6: , Tide-line. Any flow leaves a persistent line at its maximum height on whatever it touches. That line is a mark. It marks the extent of the past event, and nothing set afterward in that place can be marked as having been "above" it without the discrepancy being visible.

World model (model.w5): 58 processes and 36 laws, model 354fe025e4d8. Rules modelled: R1 (blade-settling, blade-mould-imprint, blade-hand-imprint, blade-mark-total, handle-settling, handle-imprint); R2 (blade-reading-sunlit, blade-reading-shadowed, ghost-reading, stone-reading, gen2-pressing-reading, tide-reading-bank, tide-reading-stake); R3 (rewet-clock, rewet, blade-receptivity, ghost-resolution, blank-state, ghost-reading); R4 (blade-ceiling, blade-forging, blade-strength, blade-chipping, joint-ceiling, copy-ceiling); R5 (press-from-mould, press-from-copy, copy-gen1-mark, copy-gen2-mark, copy-ceiling, lineage-total, lineage-capacity, gen2-pressing-reading); R6 (river-recession, flood, freshet, tide-line, later-setting, later-discrepancy, tide-reading-bank, tide-reading-stake).
Left out: Marks are scalar depths of density contrast. Their pattern and identity (which mould, hand or current) cannot be represented. R5's 'identical marks only from the same mould' holds only structurally: no law except pressing from the mould adds to its lineage. There is a single mould, and forged imitations are not modelled because they are human acts. How layers combine is a modeller's reading. The sum of layers gives reading contrast; the deepest single layer gives the strength ceiling. On this reading a copy pressed from a copy is no stronger than a direct copy. Re-wetting is a scenario driver: every 40 days, nine times in the run. The world says re-wetting can happen, not when. Forging work is lost on re-wetting. Destroying a thing, the only way the world allows a mark to be removed, is not modelled. 'About seven cycles' is modelled as a linear decline in receptivity and ghost resolution reaching their limits at 7. Receptivity has a floor of 0.1 so that blank matter still sets marked (R1). Blank matter's weakness and poor shape-holding act only through this low receptivity and hence a low ceiling; there is no separate shape law. Legibility uses exponential attenuation with optical depth and a linear ramp above a reading threshold. The world states only that thickness, opacity and darkness limit reading. Reading by reflected light is not computed because it is always zero. Darkness is two fixed light levels, with no day-night cycle. Chipping load (0.4), the chipping rate coefficient, forging rate, and every depth, rate and size value are invented parameters. Copies are pressed from fresh matter and set instantly. Wear on the mould and pressing from tired matter are not modelled. River level, floods and freshets are drivers for R6. 'Marked as having been above' is a single later-set thing claiming a height of 2 m. Its discrepancy is measured against the tide line standing when it set. Reading the tide line through a bank versus a thin stake combines R2 and R6; treating the line as a transmitted-light mark like any other is my interpretation. Left out by instruction or as not covered by a rule: people's birth marks, inheritance from the birth-mould, identity and legal standing, all institutions and trades, architecture, geography and wealth, commerce and debt, and the claim that a thing is not fully real until marked. Required-reading gap: only the supplied grammar was available. The start-here guide, operational protocol and examples could not be read, so representation follows the engine vocabulary given in the task.

A run of 400 days:
- blade.wetness: from 1 to 0.000053458 (range 0.000042094 to 1, mean 0.099983); 9 events, every 40.1 on average, first at 40.1, 80.2, 120.3, 160.4, 200.5, 240.6, 280.7, 320.8
- blade.mould_layer: from 0 to 0.059997 (range 0 to 0.59997, mean 0.23267)
- blade.hand_layer: from 0 to 0.029998 (range 0 to 0.29999, mean 0.11634)
- blade.mark_total: from 0 to 0.089995 (range 0 to 0.89996, mean 0.34901)
- blade.ghost_depth: from 0 to 0.12952 (range 0 to 0.62676, mean 0.36559)
- blade.cycles: from 0 to 9 (range 0 to 9, mean 4.4893); 9 events, every 40.1 on average, first at 40.1, 80.2, 120.3, 160.4, 200.5, 240.6, 280.7, 320.8
- blade.receptivity: from 1 to 0.1 (range 0.1 to 1, mean 0.43078)
- blade.ghost_resolution: from 1 to 0 (range 0 to 1, mean 0.40095)
- blade.blank: from 0 to 1 (range 0 to 1, mean 0.29834); 1 events, first at 280.7
- blade.ceiling: from 0 to 0.059997 (range 0 to 0.59997, mean 0.23267)
- blade.forging: from 0 to 1.2882 (range 0 to 1.298, mean 0.85131)
- blade.strength: from 0 to 0.059997 (range 0 to 0.59997, mean 0.23023)
- blade.chips: from 0 to 88 (range 0 to 88, mean 22.615); 88 events, every 2.9345 on average, first at 144.65, 152.6, 174.45, 178.95, 179.3, 179.55, 185.3, 187
- handle.mark: from 0 to 0.35 (range 0 to 0.35, mean 0.3465)
- joint.ceiling: from 0 to 0.059997 (range 0 to 0.35, mean 0.19139)
- blade.legible_sunlit: from 0 to 1 (range 0 to 1, mean 0.96331)
- blade.legible_shadowed: from 0 to 0 (range 0 to 0.63756, mean 0.095056)
- blade.ghost_legible_sunlit: from 0 to 0 (range 0 to 1, mean 0.56059); 1 events, first at 40.1
- stone.legible_sunlit: from 0 to 0 (range 0 to 0, mean 0)
- copies.gen1: from 0 to 84 (range 0 to 84, mean 40.222); 84 events, every 4.7711 on average, first at 3.3, 12.8, 23.55, 24.8, 30.3, 33.65, 39.45, 42.35
- copies.gen2: from 0 to 33 (range 0 to 33, mean 11.219); 33 events, every 10.85 on average, first at 52.75, 63.5, 84.45, 130.25, 146.95, 147.05, 154.5, 155.2
- copy.gen1_mark: from 0.85 to 0.85 (range 0.85 to 0.85, mean 0.85)
- copy.gen2_mark: from 0.9 to 0.9 (range 0.9 to 0.9, mean 0.9)
- copy.ceiling: from 0.8 to 0.8 (range 0.8 to 0.8, mean 0.8)
- copy.gen2_distinguishable: from 0 to 0.85205 (range 0 to 0.85205, mean 0.85194); 1 events, first at 0.05
- lineage.total: from 0 to 117 (range 0 to 117, mean 51.442); 117 events, every 3.4194 on average, first at 3.3, 12.8, 23.55, 24.8, 30.3, 33.65, 39.45, 42.35
- lineage.capacity: from 0 to 93.6 (range 0 to 93.6, mean 41.153); 117 events, every 3.4194 on average, first at 3.3, 12.8, 23.55, 24.8, 30.3, 33.65, 39.45, 42.35
- river.level: from 1 to 1.4251 (range 1 to 4.6844, mean 1.4354); 65 events, every 6.168 on average, first at 1.75, 5.9, 11.1, 12.9, 14.4, 22.55, 29.85, 37.1
- tide.line: from 1 to 4.6844 (range 1 to 4.6844, mean 4.385); 2 events, every 36.4 on average, first at 1.8, 38.2
- later.tide_at_setting: from 0 to 4.534 (range 0 to 4.534, mean 2.2667); 1 events, first at 200.05
- later.discrepancy: from 0 to 2.534 (range 0 to 2.534, mean 1.2669); 1 events, first at 200.05
- tide.legible_bank: from 0 to 0 (range 0 to 0, mean 0)
- tide.legible_stake: from 0 to 1 (range 0 to 1, mean 0.9955); 1 events, first at 1.8

Scenario (scenario.w5): In a vast, canyon-shadowed city, a representative resident passes many strangers each day but has little free time. Trust in this world means reading a person's bone mark by light passing through the hand (R2), and street light is too dim to read most strangers, so talking to them feels unsafe and few meetings happen. Each meeting is a small setting of tie-matter between two people (R1). Its depth records how long they lingered, so hurried meetings set shallow ties, and belonging can never exceed that mark (R4). When the demand for belonging exceeds it, the resident suffers lonely spells, the way an under-marked blade chips. Every move, compressed here to one per 100 days, re-wets the resident's ties. The tie depth dissolves into a fainter ghost and the same bond-matter is set again with new neighbours, so receptivity falls toward the blank state after about seven re-wettings (R3). Interventions use the world's own physics: lit reading rooms on errand routes (R2), a district mould whose thin tokens make neighbours verifiable and whose witnessed pressings are shared makings (R5), and co-set tie sheets that are never re-wetted, plus shared high-water marking (R3, R6).
Measure: mean of resident.loneliness after time 50; lower is better (Average shortfall between the belonging a resident needs and the depth of the ties they actually hold, after a 50-day warm-up and across three moves; 0 means no loneliness, 0.5 means no settled ties at all.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0.37808 (mean of 5 draws, range 0.35123 to 0.39951)
- intervention:reading-rooms (Lit reading rooms on the errand routes): 0.13006 (mean of 5 draws, range 0.12283 to 0.13447)
- ablation:reading-rooms/lamps (Lit reading rooms on the errand routes, without Light the reading rooms where people already gather): 0.21705 (mean of 5 draws, range 0.18133 to 0.23886)
- ablation:reading-rooms/errands (Lit reading rooms on the errand routes, without Seat residents together during obligatory certification waits): 0.29528 (mean of 5 draws, range 0.28667 to 0.30189)
- intervention:district-mould (A city-wide lineage of district moulds): 0.28945 (mean of 5 draws, range 0.28182 to 0.29459)
- ablation:district-mould/tokens (A city-wide lineage of district moulds, without Press every resident a thin token from the district mould): 0.32111 (mean of 5 draws, range 0.30602 to 0.33062)
- ablation:district-mould/witnessed-pressings (A city-wide lineage of district moulds, without Neighbours witness each newcomer's pressing as a shared making): 0.2966 (mean of 5 draws, range 0.28981 to 0.30969)
- intervention:travelling-ties (Co-set ties that survive moves, and shared high-water lines): 0.24374 (mean of 5 draws, range 0.24127 to 0.24907)
- ablation:travelling-ties/co-set-sheets (Co-set ties that survive moves, and shared high-water lines, without Close pairs co-set a thin joint sheet that is never re-wetted): 0.34362 (mean of 5 draws, range 0.32989 to 0.36085)
- ablation:travelling-ties/high-water (Co-set ties that survive moves, and shared high-water lines, without Neighbours mark each freshet's tide-line together): 0.26049 (mean of 5 draws, range 0.23694 to 0.28474)

Solve (sol.w5, solver isolation fresh_context, runs cited: intervention:reading-rooms, ablation:reading-rooms/lamps, ablation:reading-rooms/errands, intervention:district-mould, ablation:district-mould/tokens, ablation:district-mould/witnessed-pressings, intervention:travelling-ties, ablation:travelling-ties/co-set-sheets, ablation:travelling-ties/high-water):

# Ending Loneliness in the Shadowed City: Read by the Light, Linger in the Wait, Keep the Sheet

The model lowered loneliness by about two thirds. It did not end it. The strongest measure tested, **intervention:reading-rooms**, moved the measure from 0.378 to 0.130. On this measure 0 means no loneliness, and 0.5 means a resident holds no settled ties at all. What follows is the plan that the runs support, the parts they do not support, and the places where the plan stops working.

## Why the city is lonely, in its own physics

- **Strangers cannot be read.** Trust comes from holding a hand to ...

### The Thallus Law: A World Where Nothing Stands Alone (lib.world.w6)

Seed: lichen (library). Builder isolation: fresh_context. Target-blind task: no (lonely).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w6).

Principle: In this world the fundamental law is obligate partnership. Every enduring thing is a composite of two complementary halves:

- a Holder, which gives structure, shelter, and retention
- a Giver, which draws energy from light

Neither half persists alone. A Holder without a Giver slowly crumbles into inert grit, which people call *bare*. A Giver without a Holder scatters and spends itself within days. Paired, they form a thallus: a durable, slow, self-mending body whose properties belong to neither half.

This applies to everything:

- a stone wall (rock with a luminous skin)
- a tool (a hafted edge bonded to a light-drinking sheath)
- a person (a body paired with a "bright" partner in their tissue, which they inherit and renew)
- a tool of fire, which is the one thing that cannot be paired

Physics is the physics of symbiosis. Energy, structure, and persistence are never found in one place.

- R1: Pairing. Nothing persists unpaired. Every object, organism, and structure has a Holder and a Giver. An unpaired thing decays at a fixed rate, roughly a tenth of its mass per season. Pairing is a physical bond made by sustained contact in moist light. It cannot be forced faster than the contact allows.
- R2: Edge growth. All growth, repair, and construction spread outward from a living edge at a bounded rate, about a finger-width per year for most materials and a hand-width for the fastest. Interiors cannot be extended, only edges. The age of a thing is read from its diameter. Large things are therefore always old, and nothing large can be new.
- R3: Dormancy. When dry or dark, a thallus suspends completely. It does not decay, act, or age. When moisture and light return, it resumes exactly where it stopped. Water comes from the air (mist, dew, humidity), never from the ground. Anything living or made therefore has two states, *wet* (active) and *dry* (stored), and the world has two tempos. A person caught dry in a drought simply pauses and wakes unchanged when the mist returns.
- R4: Pure air. Pairings are sensitive to the air they breathe. Smoke, hot metal fumes, and heavy dust break the bond between partners, so the halves part and the thing dies or becomes bare. Open fire, smelting, and forced burning are destructive to everything nearby. Clean air is a measurable, shared resource, and the health of local thalli is the measure of it.
- R5: Substrate cost. Every pairing slowly dissolves the surface it rests on, turning rock into soil over centuries. A settlement draws on its ground, and ground that has been fully converted to soil can no longer hold a bond. There is no building on soil. Durable things need bare stone beneath them, and that stone is the world's real wealth.

World model (model.w6): 58 processes and 42 laws, model 22f1640c5149. Rules modelled: R1 (weave-bond, weave-completion, weave-holder-decay, weave-giver-decay, weave-parting, wall-bond, wall-parting, wall-unpaired-decay, ledge-bond, ledge-parting, ledge-unpaired-decay, weave2-start, weave2-bond, weave2-holder-decay, weave2-giver-decay); R2 (wall-edge-growth, wall-age-reading, wall-breach-probe, wall-repair, ledge-edge-growth, ledge-age-reading, weave-edge-growth, weave-age-reading, archive-growth, archive-age-reading); R3 (phase-clock, year-turn, mist, active, drought-onset, drought-end, archive-unstore, archive-growth, wall-edge-growth, wall-substrate, wall-repair, wall-bond); R4 (smelt-start, smelt-stop, smoke-balance, indicator-bond, purity-reading, wall-bond, wall-parting, ledge-bond, ledge-parting, weave-bond, weave-parting, weave2-bond); R5 (wall-substrate, wall-rock-ok, margin-substrate, margin-rock-ok, margin-soil, wall-bond, ledge-bond, weave-bond, weave2-bond, ledge-edge-growth, weave-edge-growth, weave2-start).
Left out: People, consorts, discs, trades, governance, travel and culture are left out as instructed. Consequences the world lists, such as slow emergencies and indecisive war, are not modelled. 'Everything' is represented by five sample bodies (wall, ledge, weave, weave2, archive) plus one indicator thallus. Mass is a fraction of each half remaining, not a quantity tied to size. 'A tenth of its mass per season' is written as continuous decay at 0.4214 per year, which is 10% per quarter-year. The mist schedule (first half of each year) and the drought rates are assumptions; the world gives neither. Day and night darkness is not resolved, and light is absent only for the stored archive. Interpretation of R3: suspension applies to thalli, meaning paired bodies. Unpaired halves, including halves still being woven, keep decaying through dry and dark spells. If the world means they also pause, multiply the decay laws by env.active. Interpretation of R1: a Giver in contact with a Holder during weaving is not 'without a Holder'. It decays at the R1 rate, shielded by its partial bond. Only a Giver whose Holder has parted scatters, and it does so within one step of about a week. Smoke breaks bonds even in dormant thalli, because the world treats dry-season fires as emergencies. Bonds mend only while wet and lit. Substrate dissolution also pauses during dormancy. Smoke, hot-metal fumes and heavy dust are lumped into one smoke index. Exposure by distance is a static factor per body. The only fire is a scheduled three-month smelting probe at year 120. Wildfires and dust storms are not modelled. Fire carries no bond, which reflects that it cannot be paired. The indicator thallus's own possible parting is not modelled; it serves only as the purity reading. R2: no interior variable exists, so 'interiors cannot be extended' holds by construction. The breach at year 60 is a probe for edge-rate repair. The age reading assumes growth from zero at the material's rate, so it counts wet years rather than calendar years. R5: stone depth is tracked only beneath each body's original footing, not on fresh rock reached as the edge spreads. The soil-failure rate and dissolution rate are assumed. Weave2 is not given growth, substrate draw or parting laws, because it is expected never to pair on soil. The archive is assumed paired, sealed from smoke and resting on stone that is not tracked. The contact rate, smoke sensitivity, exposures, emission and clearing values are illustrative, chosen so each rule's effect appears within 400 years.

A run of 400 years:
- env.wet: from 1 to 0 (range 0 to 1, mean 0.45023); 386 events, every 1.0338 on average, first at 1.02, 2.02, 3.02, 4.02, 5.02, 6.02, 7.02, 8.02
- env.drought: from 0 to 0 (range 0 to 1, mean 0.057297); 19 events, every 19.986 on average, first at 38.06, 54.16, 64.46, 135.64, 159.98, 164.4, 185.9, 193.9
- env.active: from 1 to 0 (range 0 to 1, mean 0.45023); 386 events, every 1.0338 on average, first at 1.02, 2.02, 3.02, 4.02, 5.02, 6.02, 7.02, 8.02
- air.smelter: from 0 to 0 (range 0 to 0, mean 0)
- air.smoke: from 0 to 0 (range 0 to 0, mean 0)
- air.purity_reading: from 1 to 1 (range 1 to 1, mean 1)
- indicator.bond: from 1 to 1 (range 1 to 1, mean 1)
- wall.bond: from 1 to 1 (range 1 to 1, mean 1)
- wall.paired: from 1 to 1 (range 1 to 1, mean 1)
- wall.giver: from 1 to 1 (range 1 to 1, mean 1)
- wall.intact: from 1 to 1 (range 1 to 1, mean 1)
- wall.diameter: from 400 to 1120.4 (range 400 to 1120.4, mean 758.51)
- wall.age_read: from 100 to 280.1 (range 100 to 280.1, mean 189.63)
- wall.rock: from 40 to 36.398 (range 36.398 to 40, mean 38.207)
- wall.breach: from 0 to 0 (range 0 to 0, mean 0)
- margin.rock: from 3 to 0.0033825 (range 0.0033825 to 3, mean 0.65142)
- margin.rock_ok: from 1 to 0.33825 (range 0.33825 to 1, mean 0.62007)
- margin.soil: from 0 to 2.9966 (range 0 to 2.9966, mean 2.3486)
- ledge.bond: from 1 to 0 (range 0 to 1, mean 0.42657)
- ledge.paired: from 1 to 0 (range 0 to 1, mean 0.42708)
- ledge.giver: from 1 to 0 (range 0 to 1, mean 0.42708)
- ledge.intact: from 1 to 7.6438e-43 (range 7.6438e-43 to 1, mean 0.43301)
- ledge.diameter: from 90 to 1448.7 (range 90 to 1448.7, mean 1157.1)
- ledge.age_read: from 5 to 80.485 (range 5 to 80.485, mean 64.283)
- weave.bond: from 0 to 0 (range 0 to 1, mean 0.42522)
- weave.paired: from 0 to 0 (range 0 to 1, mean 0.42163); 1 events, first at 2.18
- weave.holder: from 1 to 6.1809e-43 (range 6.1809e-43 to 1, mean 0.35042)
- weave.giver: from 1 to 0 (range 0 to 1, mean 0.34563)
- weave.diameter: from 2 to 299.38 (range 2 to 299.38, mean 234.58)
- weave.age_read: from 0.5 to 74.845 (range 0.5 to 74.845, mean 58.646)
- weave2.in_contact: from 0 to 0 (range 0 to 0, mean 0)
- weave2.bond: from 0 to 0 (range 0 to 0, mean 0)
- weave2.holder: from 1 to 1 (range 1 to 1, mean 1)
- weave2.giver: from 1 to 1 (range 1 to 1, mean 1)
- archive.light: from 0 to 1 (range 0 to 1, mean 0.12499); 1 events, first at 350.02
- archive.diameter: from 60 to 147.12 (range 60 to 147.12, mean 65.513)
- archive.age_read: from 15 to 36.78 (range 15 to 36.78, mean 16.378)

Scenario (scenario.w6): In a great disc thousands of residents live along the lobed margin. Every resident is a giver or holder who needs a consort for standing, yet most have none. Under R1, a consort bond forms only through sustained contact in moist light and cannot be hurried. Under R3, that light comes only in the wet half of the year, and edge work takes most of it, so only a quarter of active time is left for contact. A courtship left wet but apart fades the way an unpaired half fades. Trade and edge assignments move residents by dry caravan about every three years, and each move separates partners and ends courtships. Strangers feel unsafe because nobody can read whether a stranger carries fouled air (R4), so new contact begins rarely. The lonely share is the share of residents with neither a consort nor a pairing under way.
Measure: mean of city.lonely after time 20; lower is better (Average share of the disc's residents who have neither a consort nor a pairing under way, after the first 20 years of settling.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0.72333 (mean of 5 draws, range 0.71488 to 0.73614)
- intervention:move-as-one (Move as one thallus: dry caravans carry bonds intact and wake strangers together): 0.34725 (mean of 5 draws, range 0.3382 to 0.35365)
- ablation:move-as-one/dry-consort-caravans (Move as one thallus: dry caravans carry bonds intact and wake strangers together, without Consorts are dried and carried as one bundle; under R3 the bond suspends and resumes unchanged): 0.51902 (mean of 5 draws, range 0.50983 to 0.52685)
- ablation:move-as-one/dry-courtship-carry (Move as one thallus: dry caravans carry bonds intact and wake strangers together, without Courting pairs travel dry together and resume contact where it stopped): 0.47112 (mean of 5 draws, range 0.46384 to 0.48107)
- ablation:move-as-one/cohort-waking (Move as one thallus: dry caravans carry bonds intact and wake strangers together, without Arrivals are woken together in one mist, so newcomers start contact with each other): 0.44928 (mean of 5 draws, range 0.43914 to 0.46172)
- intervention:work-is-contact (Make lived time count: work, dew-halls and dry waiting become contact): 0.68661 (mean of 5 draws, range 0.67708 to 0.70361)
- ablation:work-is-contact/paired-edge-shifts (Make lived time count: work, dew-halls and dry waiting become contact, without Edge-walkers and mist-keepers work their wet hours in pairs, so work is sustained contact): 0.69377 (mean of 5 draws, range 0.68826 to 0.6991)
- ablation:work-is-contact/dew-hall-evenings (Make lived time count: work, dew-halls and dry waiting become contact, without Mist-keepers' dew-cistern halls keep courting pairs wet together in dry spells): 0.68836 (mean of 5 draws, range 0.67641 to 0.69819)
- ablation:work-is-contact/dry-waiting (Make lived time count: work, dew-halls and dry waiting become contact, without Pairs who cannot meet go dry together instead of staying wet apart): 0.69265 (mean of 5 draws, range 0.68479 to 0.70122)
- intervention:readable-strangers (Make strangers safe to approach by making their air and standing readable): 0.43856 (mean of 5 draws, range 0.42711 to 0.4494)
- ablation:readable-strangers/worn-indicator (Make strangers safe to approach by making their air and standing readable, without Each resident wears an indicator sliver whose health anyone can read; trust follows the actual air reading): 0.57785 (mean of 5 draws, range 0.56776 to 0.58747)
- ablation:readable-strangers/standing-sponsors (Make strangers safe to approach by making their air and standing readable, without An established consort household stands as holder for a newcomer until they consort, giving them standing): 0.52785 (mean of 5 draws, range 0.50307 to 0.55809)

Solve (sol.w6, solver isolation fresh_context, runs cited: intervention:move-as-one, ablation:move-as-one/dry-consort-caravans, ablation:move-as-one/dry-courtship-carry, ablation:move-as-one/cohort-waking, intervention:work-is-contact, intervention:readable-strangers, ablation:readable-strangers/worn-indicator, ablation:readable-strangers/standing-sponsors):

# Ending Loneliness in a Great Disc: Carry the Bond, Make the Stranger Readable

## Short answer

The best way to end loneliness in a great disc is to stop moves from destroying bonds that already exist. The second step is to make strangers safe to approach. Adding more contact time comes a distant third.

The world's model supports this order:

| Run | Lonely share (mean of 5 draws, range) |
|---|---|
| scenario (no intervention) | 0.723 (0.715–0.736) |
| intervention:move-as-one | **0.347** (0.338–0.354) |
| intervention:readable-strangers | 0.439 (0.427–0.449) |
| intervention:work-is-conta...

### The Struck World: Where Nothing Changes Except Against the Anvil (lib.world.w10)

Seed: anvil (library). Builder isolation: fresh_context. Target-blind task: yes.
Imported from world library 9b121c938b78 (search search.loneliness, world world.w10).

Principle: In this world, change is an exchange among three parties: a Ground, a Blow, and a Work. A body alters only when it is driven between a moving mass (the Blow) and a mass that yields less than itself (the Ground). The anvil is not an object in this physics but a *role*. Whatever resists most in a given exchange is the anvil for that moment.

Everything that happens elsewhere in the universe, including motion, growth, decay, and the making of new things, is the settling of Works against Grounds. A body that is struck by nothing and rests on nothing is inert. It drifts, keeps its form, and does not age.

- R1: Law of the Ground. No body changes shape, composition, or state unless it is pressed between a Blow and a Ground that yields less than it does. Unsupported bodies, such as dust in a void, high clouds, and objects dropped into deep water, keep their form indefinitely. Falling is not change, and landing is.
- R2: Law of Ring. Whatever part of a Blow does not go into reshaping the Work returns through the Ground as sound and heat, called the *ring*. Every change is therefore audible, and silent change is impossible. The pitch and length of the ring indicate how much of the blow reshaped the Work and how much was returned. A dull ring means the Ground was too light and the change failed.
- R3: Law of Heat. Only heated material takes a lasting new form. Cold material struck against a Ground shatters or rebounds. Fire has no power to change things by itself. It only makes things *strikable*. Cooling holds a form, and reheating erases it, so forms are a kind of memory that fire can wipe.
- R4: Law of Descent. Every Ground is itself a Work against a greater Ground, and the chain ends at the Bedrock, the unyielding mass beneath the world. A Blow's effectiveness falls with the number of links between the Ground and Bedrock. Strong change therefore needs a Ground coupled to stone (an anvil on a stump set in the earth). Work done on ships, in the air, or on loose sand is weak and shallow.
- R5: Law of Hardening. Each Work can absorb only a finite number of blows before it becomes brittle. Bodies accumulate blows through use, weather, and handling, and they harden toward inertness. A hard body can be made workable again only by fire (R3). Living things cannot be fully reheated, so they harden past recovery. That is what age and death are.

World model (model.w10): 57 processes and 30 laws, model dcc77d0aa1bd. Rules modelled: R1 (r1.ground-firm, r1.work-grounded, sched.ground-mass, sched.strike, blow.cadence, forge-blow, r1.drop-supported, r1.drop-fall, r1.drop-landing, r5.drop-weather, r5.life-knock); R2 (r2.reshape-share, r2.return-share, forge-blow, r2.ring-decay, r1.drop-landing, r5.drop-weather, r5.life-knock); R3 (sched.fire, r3.heat-flow, r3.strikable, r3.cold, forge-blow, r3.reheat-erase, r3.cooling-hold, r5.life-reach); R4 (sched.ground-links, r4.descent-factor, r2.reshape-share); R5 (r5.work-hardness, r5.work-brittle, forge-blow, r3.reheat-erase, r5.life-reach, r5.life-hardness, r5.life-recovery, r5.life-knock, r5.life-death, r5.drop-brittle, r5.drop-hardness, r5.drop-weather).
Left out: People, the Striker/Holder/Fire-tender triad, households, settlement, law, calendars, mourning, war and ring-language are left out. The Blow cadence and fire are exogenous time schedules. One representative Work and one Ground role, changed by schedule: stump anvil, ship, Founding Stone, then a light Ground, then a cold heavy Ground. All numbers are illustrative. 'Yields less than' is read as Ground mass exceeding Work mass. The chain of Grounds (R4) is a link count with an assumed exponential loss per link. The Grounds' own hardening as Works, and anvils dishing and being retired, are not tracked. Unresolved tension: R1 forbids state change without Blow and Ground, and R2 forbids silent change, yet R3/R5 let fire erase forms and restore workability. The model follows R3/R5 and treats heat as a condition, not a change. Reheat erasure and living warmth recovery produce no ring. Reheat erasure fires when heat crosses the strikable threshold upward. It wipes both hot and held form and fully resets a non-living Work's hardening. 'Shatters or rebounds' is split by brittleness: a workable cold Work rebounds, and a brittle cold Work shatters. A hot brittle Work only rings. Shattering is permanent. Sound and heat of the ring are one energy. The ring's heat does not warm the Work. Audibility of every change is enforced by an assumed cap of 0.6 on the reshaping share. The world gives no proportion. Hardening is linear in blow count. Weather and handling are random knocks on the dropped body and the living body only; the forge Work is spared weather. 'Cannot be fully reheated' is modeled as body warmth reaching 0.3 of the 0.5 threshold, so 40% of each knock is permanent. Recovery is continuous. Death occurs at hardness 1 and stops further knocks. Dust in a void, clouds and deep water are represented only by the falling body. The dropped body is assumed cold, and landing counts as one blow. Fine work through chains of lighter Grounds, dies, healing and growth by small blows, and signalling along rails are not modeled. The time unit is an abstract ring-cycle, and life aging is compressed into the horizon. The outcomes stated above are hand estimates; the model has not been run.

A run of 400 ring-cycles:
- fire.on: from 1 to 0 (range 0 to 1, mean 0.40007); 3 events, every 80 on average, first at 80.05, 160.05, 240.05
- strike.on: from 1 to 0 (range 0 to 1, mean 0.55506); 4 events, every 78 on average, first at 86.05, 166.05, 246.05, 320.05
- ground.links: from 2 to 0 (range 0 to 6, mean 1.6); 1 events, first at 80.05
- ground.mass: from 50 to 50 (range 3 to 50, mean 40.601); 1 events, first at 320.05
- descent.factor: from 0.5488 to 1 (range 0.1653 to 1, mean 0.7428); 1 events, first at 160.05
- work.heat: from 0 to 0.001973 (range 0 to 0.79997, mean 0.43498)
- work.reshape_share: from 0 to 0 (range 0 to 0.6, mean 0.043688); 1 events, first at 163.45
- work.shaping: from 0 to 0 (range 0 to 93, mean 26.975); 69 events, every 2.7941 on average, first at 4.05, 5.05, 6.05, 7.05, 8.05, 9.05, 10.05, 11.05
- work.held_form: from 0 to 0 (range 0 to 93, mean 13.528); 3 events, every 80 on average, first at 49.5, 129.5, 209.5
- work.blow_count: from 0 to 31 (range 0 to 42, mean 22.349); 154 events, every 2.2876 on average, first at 1.05, 2.05, 3.05, 4.05, 5.05, 6.05, 7.05, 8.05
- work.hardness: from 0 to 1 (range 0 to 1, mean 0.6334)
- work.intact: from 1 to 0 (range 0 to 1, mean 0.87752)
- work.rebound_count: from 0 to 33 (range 0 to 33, mean 7.8215); 33 events, every 10.906 on average, first at 1.05, 2.05, 3.05, 321.05, 322.05, 323.05, 324.05, 325.05
- ring.loudness: from 0 to 6.2959e-18 (range 0 to 11.384, mean 2.5754); 222 events, every 1.7149 on average, first at 1.05, 2.05, 3.05, 4.05, 5.05, 6.05, 7.05, 8.05
- ring.total_energy: from 0 to 2311.6 (range 0 to 2311.6, mean 1185.5); 467 events, every 0.81438 on average, first at 0.55, 1.05, 1.3, 1.35, 2.05, 2.2, 2.3, 3.05
- ring.dull_count: from 0 to 39 (range 0 to 39, mean 13.063); 39 events, every 1 on average, first at 247.05, 248.05, 249.05, 250.05, 251.05, 252.05, 253.05, 254.05
- ring.last_return_share: from 1 to 1 (range 0.4 to 1, mean 0.96015)
- life.alive: from 1 to 0 (range 0 to 1, mean 0.6038)
- life.surface_blows: from 0 to 4.857 (range 0 to 10.125, mean 5.3725); 238 events, every 1.0167 on average, first at 0.55, 1.3, 1.35, 2.2, 2.3, 3.1, 3.9, 5.05
- life.deep_blows: from 0 to 95.2 (range 0 to 95.2, mean 66.966)
- life.hardness: from 0 to 1 (range 0 to 1, mean 0.72315)
- drop.height: from 60 to 1.2706e-12 (range 1.2706e-12 to 60, mean 4.5032)
- drop.supported: from 0 to 1 (range 0 to 1, mean 0.85002); 1 events, first at 60
- drop.blow_count: from 0 to 13 (range 0 to 13, mean 6.753); 13 events, every 20.088 on average, first at 64.95, 90.55, 100.9, 105.5, 124.85, 140, 174.6, 255.95
- drop.hardness: from 0 to 1 (range 0 to 1, mean 0.54316)
- drop.intact: from 1 to 0 (range 0 to 1, mean 0.7649)

Scenario (scenario.w10): In a big low-ring city each friendship is a shared Work, a bond-piece that a newcomer and their neighbours strike together on a common Ground. By R3 the piece takes a lasting form only while hot. Its heat comes from the arrival hearth, which a busy dweller can tend only in their small free time, so it barely passes the strikable threshold. By R4 the meeting Ground lies in tower landings five links above Bedrock, so even warm blows reshape weakly. Encounters with strangers mostly happen while the piece is cold. They rebound without change but still spend its finite blows (R5), until it turns brittle and the next cold knock shatters it and wipes its held form. That is why talking to strangers is unsafe here. Every 100 ring-cycles the household moves. Falling is not change, so the old bond keeps its form, but it is left behind with the old neighbours. The landing rings, and a new bond must be forged from nothing. Reheating also erases forms (R3), so repeated warm gatherings would wipe the bonds they make. A lasting bond has to be forged in one heat, cooled once to set, and then protected. Loneliness is measured as the mean form of the bond the dweller holds where they currently live.
Measure: mean of tie.held_form after time 20; higher is better (Average lasting bond-form the dweller holds with the people where they currently live; 0 means wholly alone, and higher means stronger and longer-held local friendship.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 2.1795 (mean of 5 draws, range 1.3752 to 2.6673)
- intervention:welcome-triad (The newcomer's forging: fill the Fire-tender, Striker and Holder roles): 14.886 (mean of 5 draws, range 14.727 to 15.042)
- ablation:welcome-triad/fire-tender (The newcomer's forging: fill the Fire-tender, Striker and Holder roles, without A neighbourhood Fire-tender keeps each newcomer's arrival hearth at full heat): 8.1082 (mean of 5 draws, range 7.1849 to 8.8508)
- ablation:welcome-triad/striker-rota (The newcomer's forging: fill the Fire-tender, Striker and Holder roles, without Neighbours take turns as Striker on the ring-cycle, only while the bond is hot, and stop once half its blows are spent): 11.896 (mean of 5 draws, range 11.026 to 13.639)
- ablation:welcome-triad/holder-hangs (The newcomer's forging: fill the Fire-tender, Striker and Holder roles, without Once the bond has set and cooled, the Holder hangs it off the Ground so cold knocks cannot wear it): 1.3186 (mean of 5 draws, range 0.68571 to 1.8777)
- intervention:founding-stone-commons (Meet at a Founding-Stone commons instead of tower landings): 5.1349 (mean of 5 draws, range 4.2089 to 6.0071)
- ablation:founding-stone-commons/stone-coupling (Meet at a Founding-Stone commons instead of tower landings, without The meeting Ground is a ground-level stone one link from Bedrock): 1.5723 (mean of 5 draws, range 1.0065 to 2.3219)
- ablation:founding-stone-commons/on-the-daily-path (Meet at a Founding-Stone commons instead of tower landings, without The stone is where calendar and contracts are struck, so passing traffic brings encounters without free time): 11.447 (mean of 5 draws, range 9.9916 to 13.756)
- ablation:founding-stone-commons/stone-warmth (Meet at a Founding-Stone commons instead of tower landings, without Ring-heat from the much-struck stone warms whatever rests on it, below the reheat threshold): 4.9038 (mean of 5 draws, range 3.6386 to 5.9871)
- intervention:heard-change (Let change be heard: answer the warm ring, refrain at the cold one): 9.9301 (mean of 5 draws, range 7.1766 to 11.369)
- ablation:heard-change/answer-the-ring (Let change be heard: answer the warm ring, refrain at the cold one, without A hot bond's working ring travels the continuous Ground, and neighbours come to strike while it is warm): 3.4331 (mean of 5 draws, range 2.9237 to 4.1806)
- ablation:heard-change/heed-the-pitch (Let change be heard: answer the warm ring, refrain at the cold one, without Everyone reads pitch: a full-return ring marks a cold bond, so they refrain from striking it): 3.4295 (mean of 5 draws, range 3.1914 to 3.7735)

Solve (sol.w10, solver isolation fresh_context, runs cited: intervention:welcome-triad, ablation:welcome-triad/fire-tender, ablation:welcome-triad/striker-rota, ablation:welcome-triad/holder-hangs, intervention:founding-stone-commons, ablation:founding-stone-commons/stone-coupling, ablation:founding-stone-commons/on-the-daily-path, ablation:founding-stone-commons/stone-warmth, intervention:heard-change, ablation:heard-change/answer-the-ring, ablation:heard-change/heed-the-pitch):

# Ending loneliness in the low-ring city: the Welcome Forging

## The diagnosis, in this world's terms

A friendship here is a shared Work, a bond-piece struck between neighbours on a common Ground. Three things defeat it.

- **No time.** The bond takes a lasting form only while hot (R3). Its heat comes from the newcomer's arrival hearth, and a busy dweller can barely keep that hearth above the strikable threshold.
- **Weak Grounds.** Tower landings sit five links above Bedrock, so even warm blows reshape the bond only weakly (R4).
- **Unsafe strangers.** Most encounters strike the bond while ...

### The Reflow World: Where Nothing Holds Without a Melting Third (lib.world.w8)

Seed: solder (library). Builder isolation: fresh_context. Target-blind task: no (move, neighbour, neighbours).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w8).

Principle: Nothing binds to anything directly. Two bodies join only through a mediator that melts at a lower temperature than either body and wets both surfaces. The mediator is solder. It is a family of soft, bright, low-melting alloys that exist in every layer of nature.

Physical contact is inert. Two stones pressed together stay two stones, and cohesion between separate bodies does not exist. Whatever holds the world together does so through a thin seam of mediator that was liquid for a moment and then froze. Matter at larger scales is a lattice of bodies, seams and the heat that made the seams. Temperature is therefore the source of structure, because it decides which seams are liquid, which are solid and which are failing.

- R1: The Third-Metal Rule. A bond between bodies A and B exists only if a mediator M is present with melt(M) < melt(A) and melt(M) < melt(B), and M has wetted both. Direct contact gives no bond. A body whose melting point lies below that of every available mediator cannot be joined at all and can only be poured, packed or held. Bodies are therefore ranked by melting point. The bodies near the bottom of the ranking are the low solders themselves.
- R2: The Clean-Face Rule. Mediator wets only a bare surface. Every body slowly grows a film, a dull skin of oxide, dust, grease or accumulated handling, and the film repels the liquid mediator, which beads up and rolls away. A flux must first dissolve the film. Fluxes are acidic, resinous or alkaline substances, and each works only on the films it can dissolve. A bond made over a film is a visible failure that looks like a bead sitting on a surface. In this world, neglect is physically a barrier to connection.
- R3: The Narrow-Heat Rule. A seam forms only if the joint is raised just above melt(M) for a short interval and then cools undisturbed.
- R4: The Weakest-Seam Rule. A seam is always the weakest part of any assembly. When anything breaks under strain, it breaks at a joint and never in the body. Seams also fatigue. Repeated cycles of heating, cooling and flexing grow cracks in them, and long creep slowly lets them sag. Every seam can be reflowed: reheated until liquid, so that the bodies come apart cleanly and can be rejoined with fresh mediator. Nothing is permanent, only held until reheated.
- R5: The Shared-Flow Rule. Joined bodies become one conduit. Heat, signal, weight and motion pass freely across a good seam and are blocked or reflected at a bad one. Unjoined bodies share nothing, however near they are. The same continuity makes heat a hazard. Reheating one seam conducts heat into its neighbours and can loosen them, so the order of joining matters. Work proceeds from high-melting seams to low-melting ones, in tiers.

World model (model.w8.a2): 59 processes and 61 laws, model e512fe173384. Rules modelled: R1 (L-r1-s1, L-r1-s2, L-r1-s3, L-wet-s1, L-wet-s2, L-wet-s3, L-liq-s3, L-heat-C, L-molten-C, L-strength-s1, L-strength-s2, L-iron-s3); R2 (L-film-A1, L-film-B1, L-film-B2, L-film-D2, L-flux-decay-acid-s1, L-flux-decay-acid-s2, L-flux-decay-resin-s2, L-flux-s1-t5, L-flux-s1-t245, L-flux-s1-t345, L-flux-s2-t55, L-flux-s2-t85, L-flux-s2-t360, L-clean-s1, L-clean-s2, L-bead-s1, L-bead-s2, L-wet-s1, L-wet-s2, L-looks-s2); R3 (L-iron-s1, L-iron-s2, L-liq-s1, L-liq-s2, L-wet-s1, L-wet-s2, L-dist-s1, L-dist-s2, L-motion, L-knock, L-dmg-s1, L-dmg-s2, L-looks-s1, L-looks-s2, L-reflow-s1, L-reflow-s2, L-strength-s1, L-break-s1); R4 (L-crack-s1, L-crack-s2, L-sag-s1, L-sag-s2, L-knock, L-break-s1, L-break-s2, L-broken-heal-s1, L-broken-heal-s2, L-reflow-s1, L-reflow-s2, L-strength-s1, L-strength-s2, L-load, L-dist-s1, L-dist-s2); R5 (L-heat-A, L-heat-B, L-heat-C, L-heat-D, L-joint-s1, L-joint-s2, L-joint-s3, L-cond-s1, L-cond-s2, L-signal, L-iron-s1, L-iron-s2).
Left out: People, institutions, economy, organisms, fever, guilds, ceremonies and geography are left out. The heat programme, flux applications, the shaking window and the load tests are exogenous forcing standing for the bench craft. Only four bodies and three seams are modelled. Each body has one lumped temperature, and a joint temperature is the mean of its two bodies. A graded iron is a capped proportional heater holding each touched body near its grade during a time window. Only oxide and grease films and acidic and resinous fluxes are modelled. Alkaline flux, dust and handling films are omitted. The faces of the forbidden seam s3 are treated as bare, so that only R1 blocks it. Low solders as bodies at the bottom of the melting ranking, poor wetting of some materials, and intermediary layers for mismatched pairs are not modelled. Seams being always the weakest part is encoded by seam capacity being below body capacity and by the absence of any body-failure law. Bodies A, B and D never approach their melting points. Only heat and signal are propagated across seams. Transmission of weight and motion is not; the load acts on each seam directly. Reflow is represented as total loss of wetting on full melt, followed by re-wetting with the mediator present. Fresh mediator stock and the physical parting and repositioning of bodies are assumed. Heat damage to bodies is permanent. The cheapness of plastic-range mediators and the assay, tapping and reputation tests are not modelled. Appearance and true strength are reported separately instead. Fatigue, creep and film growth rates are compressed so that effects appear within 400 minutes. Flexing is a random hazard, so runs vary. No Meaning Model records, operational guide or host schema were used. The representation follows only the engine vocabulary given in the task.

A run of 400 minutes:
- T.A: from 20 to 62.074 (range 20 to 313.8, mean 101.62); 611 events, every 0.5607 on average, first at 10.02, 10.03, 10.04, 10.05, 10.06, 10.07, 10.08, 10.09
- T.B: from 20 to 62.074 (range 20 to 313.8, mean 107.61); 1004 events, every 0.35396 on average, first at 10.02, 10.03, 10.04, 10.05, 10.06, 10.07, 10.08, 10.09
- T.C: from 20 to 20.002 (range 20 to 211.87, mean 32.155); 132 events, every 0.01 on average, first at 160.02, 160.03, 160.04, 160.05, 160.06, 160.07, 160.08, 160.09
- T.D: from 20 to 65.014 (range 20 to 211.87, mean 71.455); 586 events, every 0.52361 on average, first at 60.02, 60.03, 60.04, 60.05, 60.06, 60.07, 60.08, 60.09
- T.s1: from 20 to 62.074 (range 20 to 313.8, mean 104.62); 966 events, every 0.3679 on average, first at 10.02, 10.03, 10.04, 10.05, 10.06, 10.07, 10.08, 10.09
- T.s2: from 20 to 63.544 (range 20 to 211.85, mean 89.533); 1264 events, every 0.28211 on average, first at 10.02, 10.03, 10.04, 10.05, 10.06, 10.07, 10.08, 10.09
- T.s3: from 20 to 42.508 (range 20 to 211.73, mean 51.805); 586 events, every 0.52361 on average, first at 60.02, 60.03, 60.04, 60.05, 60.06, 60.07, 60.08, 60.09
- iron.s1: from 0 to 0 (range 0 to 314, mean 13.98); 3 events, every 170 on average, first at 10.01, 250.01, 350.01
- iron.s2: from 0 to 0 (range 0 to 212, mean 12.72); 4 events, every 101.67 on average, first at 60.01, 90.01, 120.01, 365.01
- s1.liq: from 0 to 0 (range 0 to 1, mean 0.03457); 2 events, every 339.98 on average, first at 11.98, 351.96
- s2.liq: from 0 to 0 (range 0 to 1, mean 0.074853)
- s3.liq: from 0 to 0 (range 0 to 1, mean 0.015132)
- s3.r1: from 0 to 0 (range 0 to 0, mean 0)
- film.A1: from 0.8 to 0.0018561 (range 0.000082538 to 0.80397, mean 0.033721)
- film.D2: from 0.8 to 0.44923 (range 0.00049812 to 0.85765, mean 0.2721)
- s1.clean: from 0 to 1 (range 0 to 1, mean 0.9133)
- s2.clean: from 0 to 0 (range 0 to 1, mean 0.4887)
- s1.wet: from 0 to 0.98915 (range 0 to 0.98915, mean 0.80914)
- s2.wet: from 0 to 0 (range 0 to 0.99531, mean 0.3971)
- s3.wet: from 0 to 0 (range 0 to 0, mean 0)
- s2.bead: from 0 to 1 (range 0 to 1, mean 0.15794)
- s1.dist: from 0 to 0 (range 0 to 0, mean 0)
- s2.dist: from 0 to 6.3523e-17 (range 0 to 0.51396, mean 0.030607)
- s1.crack: from 0 to 0.044124 (range 0 to 0.41552, mean 0.16906)
- s2.crack: from 0 to 1.9399e-9 (range 0 to 0.25412, mean 0.067827)
- s1.sag: from 0 to 0.061112 (range 0 to 0.20977, mean 0.079044)
- s1.dmg: from 0 to 0.12915 (range 0 to 0.12915, mean 0.064944)
- s2.dmg: from 0 to 0.25876 (range 0 to 0.25876, mean 0.15093)
- s1.broken: from 0 to 9.4012e-12 (range 0 to 1, mean 0.055349); 1 events, first at 330.02
- s2.broken: from 0 to 9.2125e-14 (range 0 to 1, mean 0.27253); 1 events, first at 257.35
- s1.strength: from 0 to 0.79823 (range 0 to 0.94106, mean 0.55656)
- s2.strength: from 0 to 0 (range 0 to 0.81721, mean 0.2511)
- s1.looks: from 0 to 1 (range 0 to 1, mean 0.88064)
- s2.looks: from 0 to 0 (range 0 to 1, mean 0.34084)
- s1.cond: from 0 to 0.28365 (range 0 to 0.29674, mean 0.19279)
- s2.cond: from 0 to 0 (range 0 to 0.29859, mean 0.10791)
- load: from 1 to 1 (range 1 to 3, mean 1.1); 2 events, every 55 on average, first at 330.01, 385.01
- signal.D: from 0 to 0 (range 0 to 1, mean 0.37154)
- C.molten: from 0 to 0 (range 0 to 1, mean 0.031847); 1 events, first at 160.91

Scenario (scenario.w8): A big city in the Reflow World. A and B are a long-settled household held by an old eutectic high-melt seam s1. D is a newcomer who can only be joined to that household through the city's cheap plastic-range low mediator ML at seam s2. Loneliness is the Shared-Flow Rule made literal: an unjoined body shares nothing with its neighbours, however near, so signal.D (a signal crossing A-B-D) is the newcomer's belonging. Talking to strangers feels unsafe because every face grows a film and strangers' films differ: B's is oxide (acid), D's is resinous (resin). The city's habitual acid-only flux makes the first meeting at t=55-66 bead up, which looks like contact but is not a joint. Nobody has time: irons get 6-minute dwells, the rush at 96-100 shakes the joint while it freezes (disturbed joint), and the household's own hurried, too-cool rework of its seam at 250 conducts heat into the newcomer's seam, reflows it and leaves it a barely wetted cold joint that breaks under ordinary load at 257. People move every few years: at t=200 D's seam is opened and carried off, and on the new street both faces carry fresh film. City strain (load spikes at 330 and 385) breaks any seam weaker than three quarters of capacity. C, whose melting point lies below every mediator the city offers, can only be held, never joined, and the city's one attempt at warmth (160) melts it; that case is left outside the measure.
Measure: mean of signal.D after time 30; higher is better (Share of time, once the settled household's own seam has frozen, that the newcomer D is part of one conduit with A and B, so that a signal sent from D reaches them. Time without it is time D shares nothing with anyone nearby, which is loneliness in this world.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0.25982 (mean of 5 draws, range 0.25758 to 0.26046)
- intervention:I1-welcome-bench (Welcome bench: matched flux for strangers' faces and a still, even warm dwell on arrival): 0.59057 (mean of 5 draws, range 0.57565 to 0.6221)
- ablation:I1-welcome-bench/I1a-matched-flux-first-meeting (Welcome bench: matched flux for strangers' faces and a still, even warm dwell on arrival, without At the first meeting bring resin for D's film as well as the city's acid for B's): 0.54278 (mean of 5 draws, range 0.53085 to 0.55567)
- ablation:I1-welcome-bench/I1b-fluxers-meet-the-mover (Welcome bench: matched flux for strangers' faces and a still, even warm dwell on arrival, without Two minutes after the move, fluxers clean both faces of the new street with acid and resin): 0.32066 (mean of 5 draws, range 0.30958 to 0.32464)
- ablation:I1-welcome-bench/I1c-warm-dwell-on-arrival (Welcome bench: matched flux for strangers' faces and a still, even warm dwell on arrival, without A joiner holds the whole household and the newcomer evenly at 214 for minutes 205-209, then lets it cool undisturbed): 0.31669 (mean of 5 draws, range 0.30221 to 0.32458)
- intervention:I2-tier-ordered-calendar (Tier-ordered rejoining calendar: low-tier seams are redone after high-tier work, and no joiner works without a fluxer): 0.44003 (mean of 5 draws, range 0.42349 to 0.46132)
- ablation:I2-tier-ordered-calendar/I2a-low-tier-redo-after-high-tier (Tier-ordered rejoining calendar: low-tier seams are redone after high-tier work, and no joiner works without a fluxer, without After the household reworks its high-melt seam (250-256), flux both faces at 258 and hold 214 for minutes 261-265): 0.32989 (mean of 5 draws, range 0.31913 to 0.33491)
- ablation:I2-tier-ordered-calendar/I2b-fluxer-before-joiner (Tier-ordered rejoining calendar: low-tier seams are redone after high-tier work, and no joiner works without a fluxer, without A fluxer cleans both faces at 362, before the scheduled joiner's iron at 365): 0.42789 (mean of 5 draws, range 0.42343 to 0.43302)
- intervention:I3-standing-seam-circle (Standing seam circle: whenever the newcomer's seam stops holding, fluxers and a joiner come, and come back until it holds): 0.60115 (mean of 5 draws, range 0.57338 to 0.6533)
- ablation:I3-standing-seam-circle/I3a-watch-and-flux (Standing seam circle: whenever the newcomer's seam stops holding, fluxers and a joiner come, and come back until it holds, without From t=40, when D's seam is solid but not holding, fluxers clean both faces and a visit begins): 0.25885 (mean of 5 draws, range 0.25455 to 0.26046)
- ablation:I3-standing-seam-circle/I3b-short-warm-dwell (Standing seam circle: whenever the newcomer's seam stops holding, fluxers and a joiner come, and come back until it holds, without Three minutes into a visit the joiner holds A, B and D evenly at 214 for four minutes, then the circle stays still while it cools): 0.38639 (mean of 5 draws, range 0.3582 to 0.39915)
- ablation:I3-standing-seam-circle/I3c-come-back-until-it-holds (Standing seam circle: whenever the newcomer's seam stops holding, fluxers and a joiner come, and come back until it holds, without At nine minutes the visit closes; if the seam still does not hold, the circle is called again): 0.35298 (mean of 5 draws, range 0.34704 to 0.35494)

Solve (sol.w8, solver isolation fresh_context, runs cited: intervention:I1-welcome-bench, ablation:I1-welcome-bench/I1b-fluxers-meet-the-mover, ablation:I1-welcome-bench/I1c-warm-dwell-on-arrival, intervention:I2-tier-ordered-calendar, ablation:I2-tier-ordered-calendar/I2a-low-tier-redo-after-high-tier, intervention:I3-standing-seam-circle, ablation:I3-standing-seam-circle/I3a-watch-and-flux):

# Seam Circles: Ending Loneliness in a Reflow City

In this world loneliness is physical. A body that is not joined shares nothing with its neighbours, however close they live (R5). Each of the city's three complaints is a way that joining fails:

- **Nobody has time.** Joints are rushed, too cool, or shaken while they freeze (R3).
- **People move every few years.** Seams are opened and carried off, and the new street greets the mover with fresh film (R2, R4).
- **Strangers feel unsafe.** Strangers carry different films, so the city's usual single flux makes the mediator bead up. The meeting l...

### The Held Line: A World Where Truce Is Physical Law (lib.world.w1)

Seed: truce (library). Builder isolation: fresh_context. Target-blind task: no (city, feels, neighbor, neighbors).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w1).

Principle: In this world, opposing tendencies never resolve. Heat and cold, push and resist, growth and decay, claimant and rival do not cancel, mix to equilibrium, or defeat each other. Wherever two tendencies meet, they settle into a truce: a standing suspension along a boundary called a Line. The difference between them is not dissipated. It is held, as stored potential that physicists call the Deferred.

Three consequences follow:

- Every stable thing is a truce. A stone is a truce between gravity and the stone's refusal to fall. A flame is a truce between fuel and air. A body is a truce between living and dying.
- Every truce has a term, a finite, measurable duration. Time is experienced as the shared countdown of all the truces currently running, so "how long" and "how much truce is left" are the same question.
- Nothing is permanent unless it is renewed. Renewal is a physical act with an energetic cost.

- R1: Standing Suspension. Opposed tendencies hold at a Line instead of annihilating or equalizing. Gradients (temperature, charge, pressure, grievance) persist across Lines indefinitely, and the difference accumulates as Deferred. The ordinary decay of gradients, which our physics calls entropy, does not occur here. Things resolve only when a truce ends.
- R2: Term and Lapse. Every truce carries a term. Before the term expires, both sides must perform a renewal, a small coordinated expenditure of energy or attention. If a truce is not renewed, it lapses, and the Deferred is released at once as a Resumption: a surge whose size equals the accumulated difference multiplied by the time it was held. Long-held, well-maintained truces therefore fail catastrophically, while short, frequently renewed ones fail mildly.
- R3: Reciprocal Restraint. No action is unilateral. To push something, you must be granted a stand-down by the thing pushed, and you owe an equal restraint in return. Force is thus a traded concession, and the sum of concessions in any exchange is conserved. This replaces action and reaction. A strike delivered without a granted stand-down is a breach (see R5).
- R4: The Margin. Every Line has width: a Margin in which neither opposing tendency operates. Margins are the only places where building, crossing, trading, and living can occur, because nothing in them is being pulled or burned. They are narrow between fierce opposites and wide between mild ones. Anything that leaves the Margin and enters a tendency's full domain is subject to that tendency without restraint.
- R5: Breach. An act that bypasses a granted stand-down opens a local war. The Line collapses, the Margin vanishes, and the Deferred around it is released immediately, with no term. A breach cannot be undone. It can only be followed by a new truce, which must be negotiated from the new, harsher positions.

World model (model.w1): 53 processes and 32 laws, model 07376c717990. Rules modelled: R1 (lineA.holds, lineB.holds, lineC.holds, lineA.deferred-accumulates, lineB.deferred-accumulates, lineC.deferred-accumulates, world.deferred-sum); R2 (lineA.held-time, lineB.held-time, lineC.held-time, lineA.term-countdown, lineB.term-countdown, lineC.term-countdown, lineA.renewal, lineB.renewal, lineC.renewal, lineA.lapse, lineB.lapse, lineC.lapse); R3 (exchange.grant, exchange.force-is-concession, exchange.unconceded, exchange.pushed-concedes, exchange.pusher-receives, exchange.restraint-owed, exchange.conservation); R4 (lineA.margin, lineB.margin, lineC.margin, body.outside, body.exposure-rule); R5 (exchange.unconceded, lineC.breach, lineC.margin, body.outside).
Left out: Renewal effort is a finite stock per side, set as a scenario input. It is never replenished because the world does not say where renewal effort comes from. Exhausting it is the only cause of a failed renewal; random missed renewals are not modeled. A renewal is attempted when 1 day of term remains. The world says only 'before the term expires'. Resumption size follows R2 literally: accumulated difference (the Deferred) x total time held since the truce began. It therefore grows roughly as gradient x held time squared, and term length does not enter it. A short, frequently renewed truce fails mildly only if it has also been held for a short time. R5 gives no size for a breach release. The model sizes it with R2's Deferred x time held, released immediately. After a lapse or breach, the gradient is left unchanged because no rule gives its value once a truce ends. 'Things resolve' is represented only as the Line ending. No new truce re-forms after a lapse or breach. The core principle that meeting tendencies settle into truce, and R5's renegotiation from harsher positions, give no timing or terms. The irreversibility of a breach is kept. R3 conservation holds by construction through equal and opposite flows, so the run shows it but cannot test it. Repayment of the restraint owed is not modeled. The breach is produced by a scripted input: the stand-down is withdrawn on day 150 while the push continues. Margin width = scale / |gradient| is one choice of inverse form. The world says only 'narrow between fierce, wide between mild'. R4's claim that only Margins permit building, crossing, trading and living is reduced to exposure of a single fixed object. Lines do not interact, and the breach stays local to Line C. Not modeled: time experienced as the shared countdown of truces, term brokering, and all people, trades, economy, law and politics. Units are abstract. 'day' is an arbitrary time unit. If a lapse and a breach fired on Line C in the same step, they would combine set and add effects on Line C's deferred and active values. This scenario does not produce that coincidence.

A run of 400 days:
- lineA.deferred: from 0 to 0 (range 0 to 440, mean 121.01)
- lineA.held_time: from 0 to 220.05 (range 0 to 220.05, mean 159.52)
- lineA.term_remaining: from 20 to -0.05 (range -0.05 to 20.95, mean 5.9655); 10 events, every 20 on average, first at 19.05, 39.05, 59.05, 79.05, 99.05, 119.05, 139.05, 159.05
- lineA.active: from 1 to 0 (range 0 to 1, mean 0.55006)
- lineA.renewals: from 0 to 10 (range 0 to 10, mean 7.2741); 10 events, every 20 on average, first at 19.05, 39.05, 59.05, 79.05, 99.05, 119.05, 139.05, 159.05
- lineA.reserve_1: from 100 to 0 (range 0 to 100, mean 27.259)
- lineA.resumption: from 0 to 96800 (range 0 to 96800, mean 43555); 1 events, first at 220.05
- lineA.margin_width: from 5 to 0 (range 0 to 5, mean 2.7503)
- lineB.deferred: from 0 to 0 (range 0 to 40.1, mean 1.0074)
- lineB.held_time: from 0 to 20.1 (range 0 to 20.1, mean 19.594)
- lineB.term_remaining: from 5 to -0.1 (range -0.1 to 5.9, mean 0.064998); 3 events, every 5 on average, first at 4.1, 9.1, 14.1
- lineB.active: from 1 to 0 (range 0 to 1, mean 0.050244)
- lineB.renewals: from 0 to 3 (range 0 to 3, mean 2.9318); 3 events, every 5 on average, first at 4.1, 9.1, 14.1
- lineB.reserve_1: from 15 to 0 (range 0 to 15, mean 0.34121)
- lineB.resumption: from 0 to 804.01 (range 0 to 804.01, mean 763.61); 1 events, first at 20.1
- lineB.margin_width: from 5 to 0 (range 0 to 5, mean 0.25122)
- lineC.gradient: from 8 to 8 (range 8 to 8, mean 8)
- lineC.deferred: from 0 to 3200 (range 0 to 3200, mean 1600)
- lineC.held_time: from 0 to 400 (range 0 to 400, mean 200)
- lineC.term_remaining: from 10 to 10 (range 1 to 10.95, mean 5.9755); 40 events, every 10 on average, first at 9.05, 19.05, 29.05, 39.05, 49.05, 59.05, 69.05, 79.05
- lineC.active: from 1 to 1 (range 1 to 1, mean 1)
- lineC.renewals: from 0 to 40 (range 0 to 40, mean 19.598); 40 events, every 10 on average, first at 9.05, 19.05, 29.05, 39.05, 49.05, 59.05, 69.05, 79.05
- lineC.resumption: from 0 to 0 (range 0 to 0, mean 0)
- lineC.margin_width: from 1.25 to 1.25 (range 1.25 to 1.25, mean 1.25)
- lineC.breached: from 0 to 0 (range 0 to 0, mean 0)
- lineC.breach_release: from 0 to 0 (range 0 to 0, mean 0)
- exchange.stand_down_grant: from 1 to 0 (range 0 to 1, mean 0.37495)
- exchange.applied_force: from 1 to 0 (range 0 to 1, mean 0.37495)
- exchange.unconceded_strike: from 0 to 1 (range 0 to 1, mean 0.62505); 1 events, first at 150
- exchange.pushed_concession: from 0 to -150 (range -150 to 0, mean -121.87)
- exchange.pusher_concession: from 0 to 150 (range 0 to 150, mean 121.87)
- exchange.restraint_owed: from 0 to 150 (range 0 to 150, mean 121.87)
- exchange.concession_sum: from 0 to 0 (range 0 to 0, mean 0)
- body.outside_margin: from 0 to 0 (range 0 to 0, mean 0)
- body.exposure: from 0 to 0 (range 0 to 0, mean 0)
- world.deferred_held: from 0 to 3200 (range 0 to 3200, mean 1722); 3888 events, every 0.056586 on average, first at 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4
- lineA.gradient: from 2 to 2 (range 2 to 2, mean 2)

Scenario (scenario.w1): In a long, thin city laid along a fierce Line between strangers (lineC, gradient 8, Margin only 1.25 wide), a dweller holds person-truces: a deep bond (lineA, 20-day term, renewal cost 6) and a light bond (lineB, 5-day term, renewal cost 2). Each bond must be renewed by both parties from spare attention, but each side refills only 0.2 effort per day, less than either bond costs, so bonds drain toward lapse and release a Resumption. Lodging is let for single 120-day terms, so the dweller moves at each term's end; a move removes the partner's renewal side, and the bond lapses at its next term, catastrophically if long held. New bonds form only by approaching strangers. Under Reciprocal Restraint that approach is a push needing a stand-down grant (strangers grant only 0.4, and the civic grant is withdrawn at day 150, after which any approach is an unconceded strike). Meetings happen in the crowd at offset 1.0, outside the narrow Margin, where the stranger tendency acts without restraint and exposure accumulates. Loneliness is holding few person-truces in good standing: sharing no Margin with anyone.
Measure: mean of dweller.bonds_held after time 20; higher is better (Average number of person-truces the dweller holds in good standing (0 to 2). At 0 the dweller shares no Margin with anyone, which is loneliness; at 2 both bond slots are held.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0.43997 (mean of 5 draws, range 0.39508 to 0.5269)
- intervention:register (Term-keepers' register: bonds belong to the place, not the tenant): 2 (mean of 5 draws, range 2 to 2)
- ablation:register/register.bell (Term-keepers' register: bonds belong to the place, not the tenant, without Shared renewal bell: term-keepers ring renewal for registered bonds two days before term, at a fraction of the private cost): 1.2374 (mean of 5 draws, range 1.211 to 1.3428)
- ablation:register/register.handover (Term-keepers' register: bonds belong to the place, not the tenant, without Broker handover: when a counterparty is lost at a move, a broker passes the bond's remaining term and duties to the incoming party): 1.7297 (mean of 5 draws, range 1.7244 to 1.7507)
- ablation:register/register.enrollment (Term-keepers' register: bonds belong to the place, not the tenant, without Arrival enrollment: 25 days after each arrival the district term-keeper enrolls the newcomer into vacant bonds under the register's granted stand-down): 2 (mean of 5 draws, range 2 to 2)
- intervention:margin-meeting (Granted meeting in the Margin): 1.607 (mean of 5 draws, range 1.502 to 1.7438)
- ablation:margin-meeting/margin-meeting.grant (Granted meeting in the Margin, without Envoy-renewed standing grant: strangers' stand-down is renewed each term instead of withdrawn): 0.77208 (mean of 5 draws, range 0.63242 to 0.9354)
- ablation:margin-meeting/margin-meeting.hall (Granted meeting in the Margin, without Margin-halls: Margin-builders raise meeting halls at the Line's centre, inside its narrow Margin): 1.1723 (mean of 5 draws, range 1.0478 to 1.2881)
- ablation:margin-meeting/margin-meeting.envoy (Granted meeting in the Margin, without Envoy introductions: an Envoy obtains a full stand-down, and the approach presses no more than is granted): 1.3351 (mean of 5 draws, range 1.1858 to 1.5981)
- intervention:renewal-circle (Renewal circles: neighbours lend renewal duty and vouch for one another): 1.5439 (mean of 5 draws, range 1.239 to 1.6971)
- ablation:renewal-circle/renewal-circle.lending (Renewal circles: neighbours lend renewal duty and vouch for one another, without Lending of renewal duty: a pooled circle reserve tops up a bond's renewal sides when they near the cost): 1.2922 (mean of 5 draws, range 1.1855 to 1.3204)
- ablation:renewal-circle/renewal-circle.introductions (Renewal circles: neighbours lend renewal duty and vouch for one another, without Vouched introductions: the circle's own truce carries a standing stand-down, so members introduce the dweller without a stranger approach): 0.69512 (mean of 5 draws, range 0.59242 to 0.85568)

Solve (sol.w1, solver isolation fresh_context, runs cited: intervention:register, ablation:register/register.bell, ablation:register/register.handover, ablation:register/register.enrollment, ablation:margin-meeting/margin-meeting.grant, ablation:margin-meeting/margin-meeting.hall, ablation:margin-meeting/margin-meeting.envoy, ablation:renewal-circle/renewal-circle.lending, ablation:renewal-circle/renewal-circle.introductions):

# Ending Loneliness in a Line-City: Make Bonds Belong to the Place, and Grant the Approach

## What makes the city lonely

The runs reproduce three separate mechanisms. Together they leave the average dweller holding **0.44 of 2** possible person-truces (`scenario`, range 0.40–0.53).

1. **Nobody has time.** This is a renewal deficit under R2. A bond is a truce, and both sides must renew it before its term ends.
   - Each person refills only 0.2 spare attention per day.
   - The deep bond costs 6 every 20 days, which is 0.3 per day.
   - The light bond costs 2 every 5 days, which is 0.4 per da...

### The Slow Settling: A World Where Anneal Is Fundamental Law (lib.world.w2)

Seed: anneal (library). Builder isolation: fresh_context. Target-blind task: no (city, feels, neighbor, neighbors).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w2).

Principle: Every structure in this world, whether stone, flesh, rope, promise or city, stores strain: the leftover tension of how it was made, arranged or forced. Strain is real and measurable, and it is the only thing that makes things fail.

The physical law of reality is anneal: strain leaves a thing only when the thing is heated enough to become mobile and then cooled slowly enough to settle into a lower-strain arrangement. Neither heat nor time alone is enough. What matters is the path of the cooling, not just the start and end states. Slow cooling lets parts find their best fit. Fast cooling traps whatever arrangement the thing happened to be in.

Everything that persists is the product of some thermal history. The world is lit and warmed by a slow tidal cycle, so the whole world anneals on a vast scale. Each long warm "Soak" is followed by a long gentle "Settling". Landscapes, species and institutions are the relaxed remains of earlier cycles.

- R1: Making stores strain. Any act of shaping, joining, cutting, binding or deciding adds strain in proportion to how forcefully and how fast it was done. Careful work stores little. Forced work stores a lot. A made thing carries a hidden strain budget, and its capacity is limited.
- R2: Relaxation needs a soak and a ramp. Strain discharges only if the thing is held above its own mobility threshold (a soak) and then cooled below its critical rate (a ramp). Each material and each kind of structure has its own threshold and critical rate. Heat without slow cooling relaxes nothing. Slow cooling without a prior soak relaxes nothing.
- R3: Quench locks, and locked strain releases as a snap. Cooling faster than the critical rate freezes the current arrangement, defects included. Quenched things are hard and sharp but carry their full strain. When accumulated strain exceeds a thing's capacity, the excess releases at once and without warning as a snap: a shatter, collapse, rupture or outburst. Snaps are sudden, local and often cascading, because released strain loads the neighbors.
- R4: Order is paid for in time, and strain is conserved. Annealing does not destroy strain. It disperses it into diffuse warmth and the surrounding medium. A thing can be relaxed only by exporting its strain, so crowded or tightly packed settings must anneal more slowly, and an enclosed thing cannot relax unless its heat can go somewhere. Nothing becomes ordered for free: relaxation time grows with the size and complexity of the thing.
- R5: Annealing erases history. Soaking lets a thing forget the shape it was forced into. A relaxed thing carries no scars, but it also keeps no imposed form, intended shape or inscribed record. Unannealed things hold memory (a bent bar stays bent, a wound stays visible) at the price of stored strain. Stability and memory trade off against each other: you can have a settled thing or a remembering thing, but never fully both at once.

World model (model.w2): 57 processes and 62 laws, model 6b9f5a958236. Rules modelled: R1 (bars-forged, blade-forged-hot, course-joined, proof-strike); R2 (bars-soak, blade-soak, structure-soak, lee-span-soak, bars-cooling-rate, blade-cooling-rate, structure-cooling-rate, lee-span-cooling-rate, bars-ramp-gate, blade-ramp-gate, structure-ramp-gate, lee-span-ramp-gate, bar-strain-relaxes, sealed-bar-strain-relaxes, blade-strain-relaxes, span1-strain-relaxes, span2-strain-relaxes, span3-strain-relaxes, lee-span-strain-relaxes); R3 (bars-quench, blade-quench, structure-quench, lee-span-quench, bar-snap, sealed-bar-snap, blade-snap, span1-snap, span2-snap, span3-snap, lee-span-snap); R4 (bar-relax-flux, sealed-bar-relax-flux, blade-relax-flux, span1-relax-flux, span2-relax-flux, span3-relax-flux, lee-span-relax-flux, forge-medium, bed-medium, lee-bed-medium, world-diffuse-warmth, strain-ledger); R5 (bars-form-erasure, blade-form-erasure).
Left out: No people or institutions. Making acts are scheduled exogenous inputs: bars shaped on day 5, blade forged on day 44, a course joined on day 110, one cutting stroke each on day 200. The tidal cycle (§1), cold snap (§3 Disasters) and hearth schedule are exogenous drivers, not rules. The tide is compressed to a 120-day piecewise-linear cycle; real cycles are vast. R1 'in proportion to force and speed' is read as strain = 100 x force x speed. There is no separate measure for careful versus forced technique. R2 thresholds are sharp switches. Soak is a 0-1 level that builds at 0.2/day above the threshold and fades once the thing is frozen below its rigid point. Relaxation counts during any slow cooling after a soak, including cooling above the threshold. R3 quench is detected only when fast cooling happens between the mobility threshold and the rigid point. It keeps any partial relaxation already done ('freezes the current arrangement'). R3 snaps release only the excess over capacity, and a snapped thing stays at capacity and is not destroyed. A middle span gives half its excess to each neighbouring span; an end span gives half to its neighbour and half to the ground. Snap counts are firing counts and include small rebound snaps. 'Hard and sharp' is not modelled. R4 'complexity' is folded into size. Diffuse warmth does not heat anything back. Medium room and drain rates are invented values. R5 is read as erasure of form during the soak, independent of strain export. So the sealed bar forgets its bend yet keeps all its strain; this is a consequence of R4 and R5 together, not something the world states. The two bars share one thermal state, and the three spans share one thermal state. Form is tracked only for bars and blade, not for spans. The thermal reserves, economy, law, personal life and record-keeping in §3 are omitted. Hand estimates, not run: open bar strain 60 -> about 2, form 1 -> about 0.01. Sealed bar keeps 60 and snaps at the day-200 cut. Blade is quenched once, keeps form about 0.9 and strain 60, and snaps at the cut. Spans are quenched about day 41, do not relax in tide 1, and cascade on day 110, then relax slowly. Lee span goes 95 -> about 43 -> about 73 after the joining (no snap) -> about 30 -> about 13. The ledger gap stays about 0.

A run of 360 days:
- tide.warmth: from 10 to 10 (range 10 to 60, mean 45.412)
- exposed.ambient: from 10 to 9.9966 (range 5.4655 to 60, mean 40.783); 2 events, every 120 on average, first at 120.1, 240.1
- cold.depth: from 0 to 0.0033672 (range 0 to 50, mean 4.6287); 1 events, first at 40.05
- hearth.temp: from 20 to 20 (range 20 to 20, mean 20)
- bars.temp: from 20 to 20 (range 20 to 60, mean 41.78)
- bars.cooling_rate: from 0 to 8.5905e-12 (range -5.1115 to 80, mean -1.042e-14); 3 events, every 105 on average, first at 40.05, 130.05, 250.05
- bars.soak: from 0 to 0 (range 0 to 0, mean 0)
- bars.form: from 0 to 1 (range 0 to 1, mean 0.98597); 1 events, first at 5.05
- bar.strain: from 0 to 100 (range 0 to 105, mean 76.934); 2 events, every 195 on average, first at 5.05, 200.05
- sealed_bar.strain: from 0 to 100 (range 0 to 105, mean 76.934); 2 events, every 195 on average, first at 5.05, 200.05
- blade.temp: from 20 to 10.205 (range 5.5782 to 60, mean 40.908)
- blade.cooling_rate: from 0 to 0.83323 (range -5.1284 to 80, mean 0.02732); 10 events, every 23.35 on average, first at 40.05, 45.05, 130.05, 130.1, 130.15, 130.2, 250.05, 250.1
- blade.soak: from 0 to 0 (range 0 to 0, mean 0)
- blade.form: from 0 to 1 (range 0 to 1, mean 0.87766); 1 events, first at 44.05
- blade.strain: from 0 to 80 (range 0 to 105, mean 61.55); 2 events, every 156 on average, first at 44.05, 200.05
- structure.temp: from 10 to 12.774 (range 7.5808 to 59.998, mean 40.758)
- structure.cooling_rate: from 0 to 0.83322 (range -4.8281 to 14.999, mean -0.0075889); 1 events, first at 40.05
- structure.soak: from 0 to 3.9179e-14 (range 0 to 1, mean 0.573)
- span1.strain: from 90 to 21.367 (range 21.367 to 102.5, mean 70.491); 3 events, every 0.1 on average, first at 110.1, 110.2, 110.3
- span2.strain: from 95 to 21.365 (range 21.365 to 125, mean 72.02); 4 events, every 0.1 on average, first at 110.05, 110.15, 110.25, 110.35
- span3.strain: from 90 to 21.367 (range 21.367 to 102.5, mean 70.491); 3 events, every 0.1 on average, first at 110.1, 110.2, 110.3
- lee_span.temp: from 10 to 12.778 (range 10 to 60, mean 45.386)
- lee_span.soak: from 0 to 3.9179e-14 (range 0 to 1, mean 0.75531)
- lee_span.strain: from 95 to 12.411 (range 12.411 to 95, mean 53.219); 1 events, first at 110.05
- forge.medium: from 0 to 3.8496e-13 (range 0 to 35, mean 0.48604); 1 events, first at 200.1
- bed.medium: from 0 to 42.491 (range 0 to 96.928, mean 27.559); 3 events, every 0.1 on average, first at 110.15, 110.25, 110.35
- lee_bed.medium: from 0 to 9.9251 (range 0 to 33.447, mean 14.258)
- world.diffuse_warmth: from 0 to 336.07 (range 0 to 336.07, mean 118.69)
- strain.made_total: from 370 to 745 (range 370 to 745, mean 642.63); 4 events, every 65 on average, first at 5.05, 44.05, 110.05, 200.05
- strain.ledger_gap: from 0 to 1.1369e-13 (range -9.0949e-13 to 2.2737e-13, mean -2.8219e-13)
- bars.quench_count: from 0 to 0 (range 0 to 0, mean 0)
- blade.quench_count: from 0 to 0 (range 0 to 0, mean 0)
- structure.quench_count: from 0 to 1 (range 0 to 1, mean 0.88515); 1 events, first at 41.35
- lee_span.quench_count: from 0 to 0 (range 0 to 0, mean 0)
- bar.snap_count: from 0 to 1 (range 0 to 1, mean 0.44424); 1 events, first at 200.1
- sealed_bar.snap_count: from 0 to 1 (range 0 to 1, mean 0.44424); 1 events, first at 200.1
- blade.snap_count: from 0 to 1 (range 0 to 1, mean 0.44424); 1 events, first at 200.1
- structure.snap_count: from 0 to 25 (range 0 to 25, mean 17.327); 17 events, every 0.05 on average, first at 110.1, 110.15, 110.2, 110.25, 110.3, 110.35, 110.4, 110.45
- lee_span.snap_count: from 0 to 0 (range 0 to 0, mean 0)

Scenario (scenario.w2): A stairwell in a crowded city, inside a world where every made thing stores strain and sheds it only through a warm soak followed by a slow ramp. Two residents, A and B, arrive carrying strain (70 and 80). Their loneliness is the strain they hold and cannot export: their doors are mostly shut (openness 0.15), so each is nearly an enclosed thing that cannot relax (R4). People have a mobility threshold above the tide's warmth, so only warm company can soak them. The city gives them no time for it, only a one-day hurried evening every fifteen days that ends abruptly; they heat briefly and are quenched (R2, R3). Each resident moves every 120 days, staggered; a move is forced, fast uprooting that adds strain and breaks any settling under way (R1). Strangers are unsafe for a physical reason: when an overloaded resident snaps, the excess flows into the neighbour in proportion to how open that neighbour is, and otherwise into the crowded stairwell (R3). Whatever strain is exported fills a shared city medium that drains slowly and slows everyone's relaxation as it fills (R4); it then disperses into diffuse warmth, and a ledger checks that strain is conserved. The district has a soak-house, but it stands cold and unused.
Measure: mean of city.loneliness after time 30; lower is better (Average strain the two residents carry and have not exported, after the first month. In this world that is loneliness: strain that cannot leave a closed person. Lower means less loneliness. A snap also lowers it by dumping the excess into the crowd, so read the snap counts alongside it.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 190.14 (mean of 5 draws, range 190.14 to 190.14)
- intervention:soak-house-season (Open the district soak-house through each tidal Soak and let it empty slowly): 74.703 (mean of 5 draws, range 74.703 to 74.703)
- ablation:soak-house-season/season-soak (Open the district soak-house through each tidal Soak and let it empty slowly, without Warm company held through tide phases 10 to 40): 190.14 (mean of 5 draws, range 190.14 to 190.14)
- ablation:soak-house-season/slow-parting (Open the district soak-house through each tidal Soak and let it empty slowly, without People leave the soak-house gradually, 2 heat per day): 190.14 (mean of 5 draws, range 190.14 to 190.14)
- ablation:soak-house-season/open-room (Open the district soak-house through each tidal Soak and let it empty slowly, without Inside the soak-house doors stand open): 156.94 (mean of 5 draws, range 156.94 to 156.94)
- intervention:settle-the-movers (Make moving careful, welcome each arrival with a soak and a ramp, open to readable neighbours): 36.714 (mean of 5 draws, range 36.714 to 36.714)
- ablation:settle-the-movers/careful-moves (Make moving careful, welcome each arrival with a soak and a ramp, open to readable neighbours, without Unhurried handovers cut the speed of uprooting): 52.504 (mean of 5 draws, range 52.504 to 52.504)
- ablation:settle-the-movers/welcome-ramp (Make moving careful, welcome each arrival with a soak and a ramp, open to readable neighbours, without Eight warm days after every arrival, then a taper of 2 heat per day): 163.63 (mean of 5 draws, range 163.63 to 163.63)
- ablation:settle-the-movers/read-then-open (Make moving careful, welcome each arrival with a soak and a ramp, open to readable neighbours, without Open to a neighbour only as far as their strain reads settled): 97.909 (mean of 5 draws, range 97.909 to 97.909)
- intervention:pool-the-hours (Spend the same hours differently: cancel hurried evenings, hold one warm week per tide with a slow taper): 56.462 (mean of 5 draws, range 56.462 to 56.462)
- ablation:pool-the-hours/drop-rushed-evenings (Spend the same hours differently: cancel hurried evenings, hold one warm week per tide with a slow taper, without Cancel the hurried evenings that quench): 74.122 (mean of 5 draws, range 74.122 to 74.122)
- ablation:pool-the-hours/pooled-week (Spend the same hours differently: cancel hurried evenings, hold one warm week per tide with a slow taper, without The eight evening-days pooled into one week at tide phase 20, tapering at 2 heat per day): 190.14 (mean of 5 draws, range 190.14 to 190.14)
- ablation:pool-the-hours/open-room-pooled (Spend the same hours differently: cancel hurried evenings, hold one warm week per tide with a slow taper, without Doors open while the pooled week is warm): 135.55 (mean of 5 draws, range 135.55 to 135.55)

Solve (sol.w2, solver isolation fresh_context, runs cited: intervention:soak-house-season, ablation:soak-house-season/season-soak, ablation:soak-house-season/slow-parting, ablation:soak-house-season/open-room, intervention:settle-the-movers, ablation:settle-the-movers/careful-moves, ablation:settle-the-movers/welcome-ramp, ablation:settle-the-movers/read-then-open, intervention:pool-the-hours, ablation:pool-the-hours/drop-rushed-evenings, ablation:pool-the-hours/pooled-week, ablation:pool-the-hours/open-room-pooled):

# Ending Loneliness by Annealing: Welcome Every Arrival with a Soak and a Ramp

In this world, loneliness is strain that a closed person cannot export. The city fails its residents in three ways, and each failure is a rule at work:

- **Moving adds strain.** People move every few years, and each move is forced, fast uprooting. Under R1 that adds strain, and it breaks any settling already under way.
- **The time it does give is a quench.** Hurried evenings heat people briefly and then end abruptly. R2 says heat without a slow ramp relaxes nothing. R3 says a fast stop locks the strain in place.
...

### The Silent Stage: A World Held Up by Gesture (lib.world.w4)

Seed: pantomime (library). Builder isolation: fresh_context. Target-blind task: no (lonely, move).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w4).

Principle: In this world, to exist is to be enacted before a witness. Matter is not a substance. It is a sustained performance. A stone is a stone because the world's bodies are, collectively and continuously, "holding" the gesture of stoneness: weight, resistance, and edge, recognized by whoever looks. Nothing is made of anything else. Every thing is an agreement between a body that portrays it and a mind that recognizes the portrayal.

This yields a background world, the mountains and seas, held by the overlapping attention of everyone who has ever seen them. It is stable but not eternal. Where no one looks for long enough, a region goes Blank, a pale and featureless blur like an unpainted flat. Foreground, human-scale things can be changed by anyone who can enact them faithfully.

Sound carries no meaning here. Voices, bells, and drums are only air-motion, and loud ones are harmful to enactment (see R4). Meaning travels through bodies, silhouettes, and sightlines.

- R1: Hold. A thing keeps its form only while some body is holding its gesture or some witness is recognizing it. Unattended, unrecognized things first blur, then go Blank. Background features are held by the collective gaze. Small personal things are held by their owners' habitual awareness, so people carry tools and touch their belongings often.
- R2: Fidelity and Cost. A mime produces its real effect in proportion to its accuracy: true weight, true resistance, true timing. The performer pays the exertion they portray. Lifting a mimed boulder with honest strain moves a boulder and tires the body as a boulder would. Overacting wastes energy, and underacting produces a weak or failed effect. No effect is free, and the scale of any work is bounded by what bodies can sustain, plus what many bodies can share (R5).
- R3: Witness. An enactment takes effect only where a comprehending witness can see it. Effects reach as far as sightlines and no further. Darkness, walls, and fog stop them, and a blindfolded or inattentive observer does not count. Anyone who watches and understands an act can take part in sustaining it, but the performer must have intended it to be seen.
- R4: Silence. Sudden or sustained sound "breaks the frame." Within earshot of a loud noise, all active enactments slump, and the loudness and duration of the noise set how far and how long. Whispers and footfalls are harmless. Shouts, struck metal, and crashing stone cause the Drop: held objects sag, structures slip, and healing mimes undo. Ordinary quiet is therefore a civic necessity, and the Drop is the world's worst weapon and worst accident.
- R5: Upstaging and Handoff.

World model (model.w4): 52 processes and 44 laws, model 44e2d2f6f755. Rules modelled: R1 (region-recognition, region-hold, region-blank, region-watchers-leave, tool-touch, tool-awareness-fade, tool-recognition, tool-hold, tool-blank, tool-set-down, span-fixed-hold, span-fixed-blank); R2 (crew-fidelity, crew-load, crew-stamina, crew-exhaust, crew-rested, crew-exertion-paid, crew-active, span-enactment); R3 (sight-clock, sight-day-wrap, sight-daylight, sight-visibility, span-witness, span-enactment, fixing-conditions, wall-binds); R4 (noise-metal-strike, noise-metal-fade, noise-metal-earshot, noise-crash-strike, noise-crash-fade, noise-crash-earshot, frame-heard, frame-in-earshot, frame-slump-timer, frame-broken, drop-structures-slip, span-enactment, wall-binds); R5 (crew-stop, span-enactment, fixing-conditions, fixing-progress, fixing-break-resets, fixing-complete, span-fixed-blank, span-standing, drop-structures-slip, wall-margin, wall-binds).
Left out: People and institutions are left out: Holders, Fixers, Mends, Tenders, Scribes, Companies, attention-hour currency, courts, exile and Echoes. The crew, witnesses and watchers appear only as counts. Space is reduced to one stage. Sightline reach, walls and amphitheatre geometry are folded into a single visibility factor, and noise sources into fixed distances. Loudness is not attenuated within earshot. 'Healing mimes undo' under a Drop is not modeled because there is no wound process. Held objects sagging is represented only by the slump of the active enactment. A Fixing ended by dishonor is not modeled. Only forgetting (Blank) and Dropping end it. Witnesses who take part in sustaining an act are not added as bodies, and crew members do not count as each other's witnesses. Upstaging is a standing comparison of fidelity x commitment, not a contest that unfolds over time. An attempt to pass through the wall is not simulated. Fidelity is taken as symmetric, 1-|portrayal-1|, so overacting and underacting by the same ratio give the same effect, while overacting costs more. All rates, thresholds and scales are authored: handoff of about 0.05 h for 'a few dozen breaths', blur rates, the Blank threshold of 0.1, the Drop threshold of 0.5, 400 m of earshot per unit of loudness, 10 h of slump per loudness-hour, a sustainable load of 1 unit/h per body and a reserve of 4. Form, fidelity and loudness are normalized scales anchored as described in the process units. Scenario events are authored inputs, not world laws: the crew stops at t=40, the tool is set down at t=30, the region's watchers leave at t=60, and stone crashes at t=120. Struck metal arrives at random at 0.01 per hour, so whether the span gets Fixed varies between runs. The background region is gaze-held and lit only by daylight. Neither it nor the tool is placed within earshot. The section 4 'easy/hard' list is not modeled separately. Night, noise and solitude appear only through the laws above. R5's recorded entry gives only its title, so its content was taken from the section 2 text.

A run of 240 hours:
- sight.daylight: from 1 to 1 (range 0 to 1, mean 0.4996); 10 events, every 24 on average, first at 22.01, 46.01, 70.01, 94.01, 118.01, 142.01, 166.01, 190.01
- sight.visibility: from 1 to 1 (range 0.7 to 1, mean 0.84988)
- frame.heard_loudness: from 0 to 0 (range 0 to 0.8, mean 0.00061109); 3 events, every 77.6 on average, first at 23.28, 53.31, 178.48
- frame.slump_timer: from 0 to 0 (range 0 to 0.4888, mean 0.0018496)
- frame.broken: from 0 to 0 (range 0 to 1, mean 0.0073577); 3 events, every 77.6 on average, first at 23.28, 53.31, 178.48
- crew.fidelity: from 1 to 1 (range 1 to 1, mean 1)
- crew.active: from 1 to 0 (range 0 to 1, mean 0.1667)
- crew.stamina: from 1 to 1 (range 1 to 1, mean 1)
- crew.exhausted: from 0 to 0 (range 0 to 0, mean 0)
- crew.load_per_body: from 0.75 to 0 (range 0 to 0.75, mean 0.12503)
- crew.exertion_paid: from 0 to 120.03 (range 0 to 120.03, mean 110.02)
- span.witness_factor: from 1 to 1 (range 1 to 1, mean 1)
- span.enactment: from 0 to 0 (range 0 to 1, mean 0.16042)
- fixing.conditions_met: from 0 to 0 (range 0 to 1, mean 0.16133); 2 events, every 23.87 on average, first at 0.35, 24.22
- fixing.progress: from 0 to 0 (range 0 to 22.93, mean 1.6155)
- span.fixed: from 0 to 0 (range 0 to 0, mean 0)
- span.fixed_form: from 0 to 0 (range 0 to 0, mean 0)
- span.standing: from 0 to 0 (range 0 to 1, mean 0.16042)
- region.recognition: from 1 to 1 (range 0 to 1, mean 0.4996); 10 events, every 24 on average, first at 22.01, 46.01, 70.01, 94.01, 118.01, 142.01, 166.01, 190.01
- region.form: from 1 to 0.92109 (range 0.78604 to 1, mean 0.92714)
- region.blank: from 0 to 0 (range 0 to 0, mean 0)
- tool.awareness: from 1 to 0.94148 (range 0.12239 to 1, mean 0.75623); 92 events, every 2.6245 on average, first at 0.82, 2.8, 5.22, 6.4, 8.03, 9.15, 11.91, 13.63
- tool.form: from 1 to 1 (range 1 to 1, mean 1)
- tool.blank: from 0 to 0 (range 0 to 0, mean 0)
- wall.binds: from 1 to 1 (range 0 to 1, mean 0.99264); 3 events, every 77.6 on average, first at 23.87, 53.9, 179.07

Scenario (scenario.w4): In the city a resident exists only as long as others recognize them (R1, R3). Loneliness is therefore literal: with too few comprehending witnesses the resident blurs and can go Blank. Regular acquaintances hold the resident, but each spares only a sliver of attention per hour, because time is scarce and attention-hours are currency. Acquaintances drift away as people move, and at hour 96 the resident moves too, leaving their watchers behind sightlines that cannot reach them. New watchers can come only from strangers in view, and a stranger's gaze counts only if the resident intends to be seen (R3). Showing oneself to strangers is risky: a stranger's committed mimed wall binds whoever sees it unless that person counters with a truer act (R5, the world's wall and passer duel). Each binding halves the resident's openness, which recovers only slowly toward a low felt-safety level. The engine runs the resident's held form under daylight, lamplight, Drops and these social flows.
Measure: mean of resident.form after time 24; higher is better (Average fraction of the resident held in full form by recognition after the first day. Low values mean the resident is blurring through too few comprehending witnesses: loneliness in this world's sense. 0 is Blank.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0.45665 (mean of 5 draws, range 0.44511 to 0.46871)
- intervention:witness-square (Witness Square: neighbourhood Hold-Square shifts for people, paid in attention-hours): 0.94375 (mean of 5 draws, range 0.91564 to 0.95767)
- ablation:witness-square/square-shifts (Witness Square: neighbourhood Hold-Square shifts for people, paid in attention-hours, without Rotating Holders watch residents in a lit square, in shifts repaid in attention-hours): 0.84911 (mean of 5 draws, range 0.78775 to 0.88228)
- ablation:witness-square/square-regulars (Witness Square: neighbourhood Hold-Square shifts for people, paid in attention-hours, without Daily presence in the square turns repeat faces into regular watchers): 0.86925 (mean of 5 draws, range 0.8668 to 0.87398)
- ablation:witness-square/paid-watching (Witness Square: neighbourhood Hold-Square shifts for people, paid in attention-hours, without Watching a neighbour earns attention-hours, so acquaintances can afford to watch more): 0.88599 (mean of 5 draws, range 0.86732 to 0.90275)
- intervention:honest-greeting (Honest Greeting: make showing oneself to strangers safe through fidelity): 0.92578 (mean of 5 draws, range 0.92578 to 0.92578)
- ablation:honest-greeting/fidelity-schooling (Honest Greeting: make showing oneself to strangers safe through fidelity, without Schooling in true movement lets residents out-portray a stranger's binding wall): 0.88926 (mean of 5 draws, range 0.87126 to 0.91132)
- ablation:honest-greeting/greeting-test (Honest Greeting: make showing oneself to strangers safe through fidelity, without A standard greeting gesture exposes sloppy or false mimes at a glance, raising felt safety): 0.71364 (mean of 5 draws, range 0.71364 to 0.71364)
- ablation:honest-greeting/attention-ask (Honest Greeting: make showing oneself to strangers safe through fidelity, without The greeting asks a passer for a breath of comprehending attention): 0.76161 (mean of 5 draws, range 0.76161 to 0.76161)
- intervention:handoff-move (Handoff on Moving: carry recognition across a move by handing off one's gestures): 0.63278 (mean of 5 draws, range 0.62905 to 0.64136)
- ablation:handoff-move/handoff-walk (Handoff on Moving: carry recognition across a move by handing off one's gestures, without Old watchers enact the resident's characteristic gestures before new neighbours, who take them up (R5 Handoff)): 0.59856 (mean of 5 draws, range 0.59142 to 0.60556)
- ablation:handoff-move/welcome-round (Handoff on Moving: carry recognition across a move by handing off one's gestures, without The new street's Holders take the newcomer into a welcome round of watching): 0.53009 (mean of 5 draws, range 0.51658 to 0.54615)

Solve (sol.w4, solver isolation fresh_context, runs cited: ablation:witness-square/square-shifts, ablation:witness-square/square-regulars, ablation:witness-square/paid-watching, ablation:honest-greeting/fidelity-schooling, ablation:honest-greeting/greeting-test, ablation:honest-greeting/attention-ask, ablation:handoff-move/handoff-walk, ablation:handoff-move/welcome-round):

# Ending Loneliness in the City: Witness Squares, the Honest Greeting, and Handoff on Moving

**Working note.** I had the full grammar text you supplied. I did not have the start-here guide, the operational protocol or the tool schemas. This task asks for a written proposal and makes no model changes, so I worked only from the world rules and the run results given.

## The problem in this world's terms

Here, loneliness is not just a feeling. A resident keeps their form only while comprehending witnesses recognize them (R1, R3). With no intervention, the resident averaged **0.457** of full for...

### The Shifted World: Where Only Differences Between Viewpoints Are Real (lib.world.w9)

Seed: parallax (library). Builder isolation: fresh_context. Target-blind task: no (friendship, isolation, lonely, move, stranger, strangers).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w9).

Principle: In this world, nothing has an intrinsic position, distance, size, or state. What exists is the shift: the displacement in apparent direction of a thing when it is observed from two separated vantages. Distance is the ratio of baseline (the separation between the vantages) to shift. A single vantage yields only a bearing, a direction with no depth, like a painted backdrop.

Physical reality is the consensus of at least two vantages. Anything seen from one vantage alone is a flat: it has direction but no solidity, no distance, and no ability to push or be pushed. Matter, force, and causation exist only where sight-lines from two or more vantages cross consistently. A vantage is not necessarily a person. It can be any anchor that registers bearings, such as an eye, a post, a mirror, or a mark on a wall.

- R1: The Baseline Law. A thing's properties become definite only through a baseline. The precision of its distance is proportional to baseline length divided by distance. Two eyes (about 6 cm apart) make things definite out to roughly arm's reach plus a few paces. Anything beyond is flat to a lone person. Longer baselines (paired towers, rows of posts, two travelers far apart) firm up things at greater range.
- R2: The Inverse Shift Law. An object's apparent shift across a fixed baseline is inversely proportional to its distance. Near things swing wildly as vantages change. Far things barely move. Stability is therefore a matter of distance: the far background is nearly unchanging and works as a shared reference frame, while the near world is fluid and depends on who is looking from where.
- R3: The Crossing Law (solidity and force). An entity can exert or receive force only at points where at least two vantages' sight-lines to it agree within tolerance. Pushing, striking, and building all require the target to be resolved. An unresolved target, a flat, is intangible: your hand passes through it. Force strength is proportional to how tightly the lines cross, so better-resolved things push harder.
- R4: The Axis Blindness Law. Along the exact line through two vantages, parallax is zero. Anything on that line shows no shift, so its distance is indeterminate and it stays flat. This "dead line" is a physical property of every pair of vantages. Things on it are weightless and intangible, and cannot be hurt or held. They reappear in full solidity the moment either vantage moves off the line.
- R5: The Concordance Law. When vantages disagree by more than the expected shift for their baseline, the thing is unsettled. It flickers, drifts, or splits into candidate versions until the vantages reconcile. Disagreement costs energy, released as heat and noise (dissonance). Agreement is quiet and stable. Changing the world means shifting a consensus, and the effort is proportional to the baseline spanned and the number of vantages that must be brought to agree.

World model (model.w9): 44 processes and 36 laws, model 80c93e79edcf. Rules modelled: R1 (o1-precision, o1-definite, o2-precision, o2-definite, o2-definite-distance, o3-precision, o3-definite); R2 (o1-shift, o2-shift, o3-shift); R3 (crossing-count, o1-tangible, o1-force, o3-tangible, o3-force, o2-tangible, o2-force, o2-weight, o2-consensus-shift); R4 (o2-dead, o2-shift, o2-tangible, o2-weight); R5 (o2-unsettled, o2-candidates, o2-flicker, o2-drift-out, o2-drift-in, o2-dissonance, o2-reconcile, o2-consensus-shift, o2-effort-spent).
Left out: No geometry: bearings, sight-lines and positions are scalars. Each thing has a consensus range against the far frame that generates its shift. This range is not treated as an intrinsic distance. One shared pair of vantages views three things (near 0.5 m, middle 30 m, far background 1000 m). Only the middle thing has dead-line, disagreement and pushing dynamics. Scenario forcings are conditions, not world rules: baseline growth at 0.06 m/h, dead-line window 120-160, push window 200-240, contested reading at 250, lost vantage 300-320. R1 and R2 make precision and shift the same function up to a constant. Definiteness is a sharp threshold switch, not a graded value. Shift stays proportional to 1/distance even where our small-angle approximation would fail. This follows R2 as stated. R4 is applied only to the exact line, as stated, with no weakening near the axis. The dead line affects only the modeled thing, not other objects on the axis. R3's agreement tolerance is identified with R5's threshold (disagreement greater than expected shift). R5's 'flickers, drifts, or splits' is modeled as all three at once. Drift is a random walk of the consensus range, and its endpoint becomes the new consensus. Heat and noise are combined into one cumulative energy. Reconciliation rate, heat, flicker and drift rates, and the force and effort coefficients are assumed; the world gives no values. The R5 threshold equals the expected shift, so far things with tiny shift would be unsettled by tiny disagreement. This is kept as stated but not exercised: the far background receives no disagreement here. Vantages beyond two (third-vantage reference marks) and different vantage kinds are not modeled. Vantage count enters only the crossing condition and the effort law. People, Twins, settlements, occupations, law, economy and culture are omitted, as the task instructs. No Meaning Model records (Events, Cuts, Realizations) are produced. This is an engine law set, and no weight here is a Cut share.

A run of 400 hours:
- pair.baseline: from 0.06 to 24.06 (range 0.06 to 24.06, mean 12.06)
- pair.vantage_count: from 2 to 2 (range 2 to 2, mean 2)
- pair.has_crossing: from 1 to 1 (range 1 to 1, mean 1)
- scenario.push_on: from 0 to 1 (range 0 to 1, mean 0.49994); 1 events, first at 200.05
- o1.shift: from 0.12 to 48.12 (range 0.12 to 48.12, mean 24.12)
- o1.precision: from 0.12 to 48.12 (range 0.12 to 48.12, mean 24.12)
- o1.definite: from 1 to 1 (range 1 to 1, mean 1)
- o1.tangible: from 1 to 1 (range 1 to 1, mean 1)
- o1.force: from 12 to 4812 (range 12 to 4812, mean 2412); 8000 events, every 0.05 on average, first at 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4
- o3.shift: from 0.00006 to 0.02406 (range 0.00006 to 0.02406, mean 0.01206)
- o3.precision: from 0.00006 to 0.02406 (range 0.00006 to 0.02406, mean 0.01206)
- o3.definite: from 0 to 1 (range 0 to 1, mean 0.169)
- o3.tangible: from 0 to 1 (range 0 to 1, mean 0.169)
- o3.force: from 0 to 2.406 (range 0 to 2.406, mean 0.37237); 3 events, every 0.05 on average, first at 332.4, 332.45, 332.5
- o2.range: from 30 to 21.529 (range 21.529 to 30, mean 27.896); 15 events, every 1.6286 on average, first at 251, 254, 256.35, 256.45, 256.6, 256.65, 259.15, 260.15
- o2.axis_gap: from 1 to 1 (range 1 to 1, mean 1)
- o2.dead: from 0 to 0 (range 0 to 0, mean 0)
- o2.shift: from 0.002 to 1.1176 (range 0.002 to 1.1176, mean 0.46003)
- o2.precision: from 0.002 to 1.1176 (range 0.002 to 1.1176, mean 0.46003)
- o2.definite: from 0 to 1 (range 0 to 1, mean 0.97738); 1 events, first at 9.05
- o2.definite_distance: from 0 to 21.529 (range 0 to 30, mean 27.218); 12 events, every 23.682 on average, first at 9.05, 251, 254, 256.45, 256.6, 256.65, 259.15, 262.4
- o2.disagreement: from 0 to 0.0010986 (range 0 to 2, mean 0.099933); 1 events, first at 250.05
- o2.unsettled: from 0 to 0 (range 0 to 1, mean 0.060617); 1 events, first at 250.05
- o2.candidate_versions: from 1 to 1 (range 1 to 2, mean 1.0606); 1 events, first at 250.05
- o2.dissonance_heat: from 0 to 144.05 (range 0 to 144.05, mean 51.316); 96 events, every 0.05 on average, first at 250.1, 250.15, 250.2, 250.25, 250.3, 250.35, 250.4, 250.45
- o2.flicker_count: from 0 to 51 (range 0 to 51, mean 17.541); 51 events, every 0.48 on average, first at 250.25, 250.7, 250.9, 251.35, 251.5, 251.8, 252.5, 252.55
- o2.tangible: from 0 to 1 (range 0 to 1, mean 0.91676); 2 events, every 265.25 on average, first at 9.05, 274.3
- o2.force: from 0 to 111.76 (range 0 to 111.76, mean 42.549); 2 events, every 265.25 on average, first at 9.05, 274.3
- o2.weight: from 0 to 10 (range 0 to 10, mean 9.1676); 2 events, every 265.25 on average, first at 9.05, 274.3
- o2.effort_spent: from 0 to 351.4 (range 0 to 351.4, mean 83.25)

Scenario (scenario.w9): A great rail-city where about two in five residents keep no settled Twin. With only their own eyes as a baseline, a lone resident resolves strangers out to about 3 m; everyone farther is a flat that cannot be met, held or testified about, so lone residents pass each other as painted backdrops. When two lone strangers do resolve each other, most decline to keep span because an unknown vantage may be a decoy or mirror, and fraud is the gravest danger. Those who try a trial span start with first readings 2 rad apart. Under the Concordance Law the new pair flickers and gives off dissonance heat until joint sighting reconciles them below the expected shift of their span. Nobody has time: joint sighting fills only about 6% of each hour, so reconciliation is slow and much of the heat drives pairs apart again. Every few years one twin of a kept pair moves away and the span breaks. The measure is the share of residents who keep no settled span (lone plus still-unsettled trial pairs). The interventions use the world's own physics: public datum posts as second vantages and shared references, recorded separations against decoys, rail spans that turn commuting into joint sighting at a longer baseline, and sanctioned relays and handovers so that moving does not cost a twin.
Measure: final of city.unkept_share after time 24; lower is better (Share of residents at hour 400 who keep no settled span: those living alone in a dimmed, flat world plus those in a trial span that still flickers. Lower means fewer lonely residents.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 0.44091 (mean of 5 draws, range 0.44091 to 0.44091)
- intervention:datum-corners (Datum Corners: public posts that make strangers solid, calm and verifiable): 0.33469 (mean of 5 draws, range 0.33469 to 0.33469)
- ablation:datum-corners/corner-posts (Datum Corners: public posts that make strangers solid, calm and verifiable, without Datum posts at meeting places act as a second vantage, so a lone resident resolves strangers out to 50 m): 0.40821 (mean of 5 draws, range 0.40821 to 0.40821)
- ablation:datum-corners/datum-calibration (Datum Corners: public posts that make strangers solid, calm and verifiable, without New pairs take their first readings against the shared datum marks, which cuts first disagreement): 0.37827 (mean of 5 draws, range 0.37827 to 0.37827)
- ablation:datum-corners/recorded-separation (Datum Corners: public posts that make strangers solid, calm and verifiable, without Encounters at a corner are logged at a recorded separation, so a decoy or aligned stranger is exposed): 0.3958 (mean of 5 draws, range 0.3958 to 0.3958)
- intervention:rail-twinning (Rail Twinning: commute time on the rails becomes meeting and reconciling time): 0.40624 (mean of 5 draws, range 0.40624 to 0.40624)
- ablation:rail-twinning/span-seats (Rail Twinning: commute time on the rails becomes meeting and reconciling time, without Lone commuters sit across the rail span, resolved to each other, so commuting becomes meeting time): 0.42553 (mean of 5 draws, range 0.42553 to 0.42553)
- ablation:rail-twinning/ride-together (Rail Twinning: commute time on the rails becomes meeting and reconciling time, without Trial pairs ride the same rail, adding joint sighting hours that reconcile them): 0.41944 (mean of 5 draws, range 0.41944 to 0.41944)
- ablation:rail-twinning/long-span-seating (Rail Twinning: commute time on the rails becomes meeting and reconciling time, without New pairs sit across the rail's longer span, so the same disagreement falls within the expected shift sooner): 0.42188 (mean of 5 draws, range 0.42188 to 0.42188)
- intervention:portable-span (Span That Moves With You: moving no longer costs a twin): 0.43172 (mean of 5 draws, range 0.43172 to 0.43172)
- ablation:portable-span/relay-keeping (Span That Moves With You: moving no longer costs a twin, without Spanners register a sanctioned mirror relay so a moved twin remains a vantage): 0.43748 (mean of 5 draws, range 0.43748 to 0.43748)
- ablation:portable-span/handover-introduction (Span That Moves With You: moving no longer costs a twin, without Before leaving, the mover introduces the remaining twin to a lone neighbour at a recorded separation): 0.43358 (mean of 5 draws, range 0.43358 to 0.43358)

Solve (sol.w9, solver isolation fresh_context, runs cited: intervention:datum-corners, ablation:datum-corners/corner-posts, ablation:datum-corners/datum-calibration, ablation:datum-corners/recorded-separation, intervention:rail-twinning, ablation:rail-twinning/span-seats, ablation:rail-twinning/ride-together, ablation:rail-twinning/long-span-seating, intervention:portable-span, ablation:portable-span/relay-keeping, ablation:portable-span/handover-introduction):

# Datum Corners first, rails second, portable span as a long-term promise

The modeled city starts at **0.441** unkept share (`scenario`), meaning about 44% of residents live alone or in a trial span that still flickers. No single tested intervention ends that. One cuts it by about a quarter, one helps modestly, and one barely registers in this run.

## 1. The core: Datum Corners (0.441 → 0.335)

Put **Datum Corners** wherever people already pass: rail stops, market edges and the forecourts of span-houses. Each corner is a set of public posts at surveyed positions that ties into the city's Dat...

### The Answered World: Where Nothing Occurs Unless Called and Replied (lib.world.w3)

Seed: antiphony (library). Builder isolation: fresh_context. Target-blind task: no (isolation, lonely, neighbor, neighbors, nobody, stranger, strangers).
Imported from world library 9b121c938b78 (search search.loneliness, world world.w3).

Principle: In this world the basic unit of reality is not the particle or the event but the exchange: a *call* and its *answer*. Every physical change is half of such a pair. Nothing starts moving, warming, growing, or breaking unless it is *answering* something earlier. Nothing counts as having happened until it has been answered in turn.

The world is thought of as two interleaved choirs. Verse is what presently calls, and Reply is what presently answers. The roles swap constantly, because every answer is also a new call to whatever lies beyond it. Matter is a call-and-answer so tightly looped that it persists. Light is a call that has not yet been answered. Heat, force, and growth are answers still in progress. Time is the order in which answers arrive.

There is no true first cause. The ambient world (tides, day and night, seasonal swell, the planet's hum) is a continuous background call that people and things are always answering. Novelty is not creation from nothing. It is *answering differently than expected* (see R2).

- R1: The Law of Answer. A call addressed to something able to answer produces a change only when answered. A call into emptiness, or to a target with no capacity to respond in kind, fades. It leaves no trace, and its cost to the caller is not returned. A strike on a wall that cannot answer (infinitely yielding or inert) accomplishes nothing. Mere energy never accomplishes anything on its own. The responsiveness of the target does.
- R2: The Law of the Shifted Echo. An answer repeats the call in every attribute but one, which it displaces (inverted, raised, delayed, or turned). A pure echo with no shift produces stasis: stable matter, a held note, an unchanging stone. A shifted answer produces change, and the kind of shift determines the kind of change. A pushed object answers by leaning back and displacing a little, so motion is the leftover of that displacement. Warmth called into a body is answered cool-shifted, so heat flows outward. Everything is therefore predictable: the outcome is the call with one attribute moved. What is hard to predict is *which* attribute the target will shift, and that depends on its nature.
- R3: The Law of Lag. Answers travel at finite pace, and the delay grows with separation and with the number of intervening answerers. Near things answer quickly. Distant things answer late, and the farthest answer so late that the world seems to run in layers of different "now." Two calls meeting from opposite sides before either is answered produce an overlap-hush, a zone where neither resolves, so it goes still and cold. These zones are common, treacherous, and sometimes useful.
- R4: The Law of the Closed Round. Answers chain, because each answer calls onward. A chain that eventually returns an answer to its original caller forms a ring. Rings are stable, so rings are objects, bodies, places, and promises. An open chain is a process that ends or disperses. Wherever many rings nest, such as a body or a house, strength comes from the number of closed rounds, not from the amount of material. Breaking one ring forces its neighbors to re-answer, which is how injury and collapse spread.
- R5: The Law of the Refrain. Two things that have repeatedly answered each other become coupled: each answers the other faster, with less shift, and with less lag than it answers strangers. A strong refrain acts like gravity or kinship. It pulls, it lowers the cost of calling, and it is hard to cut. Only a third party answering *both* in a competing refrain can loosen it. Coupling is the world's only enduring "attraction," and it is earned through exchange, never given at the start.

World model (model.w3): 58 processes and 48 laws, model 465e66849454. Rules modelled: R1 (ab-pending, ab-answer, as-pending, ac-pending, zw-pending, zw-answer, zw-faded, w-change, z-reserve, a-reserve); R2 (b-motion, b-separation, as-answer, s-change, hq-flux, h-warmth, q-warmth); R3 (ab-lag, ac-lag, ac-answer, ac-rounds, c-now-delay, m-pending-l, m-pending-r, m-hush, m-answer-l, m-answer-r, m-warmth, l-reserve, r-reserve, opposite-caller); R4 (ab-rounds, ring1-reanswer, ring2-reanswer, ring3-reanswer, ring4-reanswer, nest-strength, loop-disperse, loop-travel, open-disperse, loop-closes, break-one, break-two); R5 (ab-refrain, ab-lag, b-motion, b-separation, a-reserve, tb-refrain, ta-refrain, third-to-b, third-to-a).
Left out: Callers' call rates are given inputs. They stand for answering the ambient background call (tides, day, hum), which is not modelled; the world's 'no first cause' is therefore not represented. Lag is first-order spreading (answered = pending ÷ lag), not a fixed transit delay. The call's outward trip and the answer's return are merged into one stage, and 'faster' and 'less lag' under coupling are one divisor. Calls fade at a rate proportional to (1 − responsiveness), so calls to fully responsive targets never fade however distant. The answered call is read as returning its cost to the caller; R1 states only that a faded call's cost is not returned. Which attribute a target shifts is fixed per target as a static nature (position for B, temperature for Q, none for S). The unpredictability of the choice is not drawn at random. Calls caught in an overlap-hush neither resolve nor fade, so once formed the hush persists in this model. R3 does not say how hushes end. The hush zone's warmth is read as answering in progress (the core principle's 'heat is answers in progress'), while H and Q hold warmth as stocks. H's warmth calls into emptiness are not modelled. Coupling is tracked only for A–B and for the third party T. Mutual answering is approximated by the answered flux of A's calls, and the pull acts only on B's separation. The ring nest is four nested rings with nearest-neighbour re-answering and scheduled breaks. Amount of material is simply absent, and the A–B round count is not fed into the nest. 'Nothing counts as happened until answered in turn', light as an unanswered call, and matter as a tight loop are not given separate processes. People, breath and thinning, unanswering, institutions, relay stations, trade and culture are left out per instructions. Caller reserves stand only for R1's cost to the caller. All rates, distances and thresholds are illustrative numbers chosen to make effects visible within 400 days.

A run of 400 days:
- A.reserve: from 50 to 28.103 (range 28.103 to 50, mean 30.235)
- AB.pending: from 0 to 0.14509 (range 0 to 1.3179, mean 0.25383)
- AB.lag: from 1.5 to 0.14509 (range 0.14509 to 1.5, mean 0.25659)
- AB.answered: from 0 to 1 (range 0 to 1.0401, mean 0.99964)
- AB.rounds: from 0 to 399.85 (range 0 to 399.85, mean 199.75)
- AB.coupling: from 0 to 0.99966 (range 0 to 0.99966, mean 0.87343)
- B.separation: from 2 to 0.16045 (range 0.16045 to 2.3127, mean 0.53963)
- B.motion: from 0 to 0.0080107 (range 0 to 0.038466, mean 0.011995)
- AS.answered: from 0 to 0.5 (range 0 to 0.5, mean 0.49875)
- S.change: from 0 to 0 (range 0 to 0, mean 0)
- AC.pending: from 0 to 20.998 (range 0 to 20.998, mean 18.795)
- AC.answered: from 0 to 0.49996 (range 0 to 0.49996, mean 0.44751)
- AC.rounds: from 0 to 179 (range 0 to 179, mean 81.205)
- C.now_delay: from 40.5 to 41.855 (range 40.5 to 41.855, mean 41.743)
- Z.reserve: from 50 to 3.8715e-67 (range 3.8715e-67 to 50, mean 6.2548)
- ZW.faded: from 0 to 50 (range 0 to 50, mean 43.495)
- W.change: from 0 to 0 (range 0 to 0, mean 0)
- callerL.reserve: from 60 to 59.25 (range 59.25 to 60, mean 59.253)
- callerR.reserve: from 60 to 60 (range 60 to 60, mean 60)
- M.pending_L: from 0 to 0.75 (range 0 to 0.75, mean 0.74719)
- M.pending_R: from 0 to 0 (range 0 to 0, mean 0)
- M.hush: from 0 to 0 (range 0 to 0, mean 0)
- M.warmth: from 0 to 0.5 (range 0 to 0.5, mean 0.49813)
- H.warmth: from 10 to 5 (range 5 to 10, mean 5.0625)
- Q.warmth: from 0 to 5 (range 0 to 5, mean 4.9375)
- TA.coupling: from 0 to 0.95024 (range 0 to 0.95024, mean 0.25618)
- TB.coupling: from 0 to 0 (range 0 to 0, mean 0)
- nest.ring1: from 1 to 1 (range 1 to 1, mean 1)
- nest.ring2: from 1 to 1 (range 1 to 1, mean 1)
- nest.ring3: from 1 to 1 (range 1 to 1, mean 1)
- nest.ring4: from 0 to 1 (range 0 to 1, mean 0.97513); 1 events, first at 9.95
- nest.strength: from 3 to 4 (range 3 to 4, mean 3.9751); 1 events, first at 9.95
- loop.progress: from 0 to 1 (range 0 to 1, mean 0.98744)
- loop.amplitude: from 1 to 2.0102e-9 (range 2.0102e-9 to 1, mean 0.049994)
- open.amplitude: from 1 to 2.0102e-9 (range 2.0102e-9 to 1, mean 0.049994)

Scenario (scenario.w3.a2): In a great river-bend city of rings within rings, a resident R lives on a breath reserve that only answers can restore. R has little spare breath-time. Beyond a daily round of 1 errand call, R can afford only 0.4 personal calls a day. A different stranger answers each errand, so the repetition seldom becomes a refrain. Strangers here are guarded and answer in kind only 60% of the time. Every call they leave unanswered fades, and its cost is lost (R1). Wary of this, R sends only 15% of spare calls to neighbours and the rest to old ties left behind in earlier homes. Those ties are 20 distance units and 3 intervening answerers away, so their answers lag about 17 days (R3). The old ties also call R, so calls cross in transit and build an overlap-hush that can lock and swallow both directions. Every 100 days R moves. The local refrain is not cut (R5). It moves out to the distant ties, and R starts again among strangers. Loneliness here is thinning: the reserve drains through faded and hushed calls until R can barely call at all.
Measure: mean of R.reserve after time 30; higher is better (Mean breath reserve of the resident after the first month. Higher means R is answered firmly enough not to thin; falling toward zero is loneliness as physical fading.)
Each run was drawn 5 times, with different random draws. A difference smaller than the ranges may be chance.
- scenario (the scenario, no intervention): 1.9018 (mean of 5 draws, range 1.9018 to 1.9018)
- intervention:choir-house-round (Choir-house errand round: standing partners, fixed greetings, and a house that answers newcomers): 82.356 (mean of 5 draws, range 82.356 to 82.356)
- ablation:choir-house-round/standing-pairs (Choir-house errand round: standing partners, fixed greetings, and a house that answers newcomers, without Errands answered by the same standing partners each day, so the daily round earns a refrain): 40.922 (mean of 5 draws, range 40.922 to 40.922)
- ablation:choir-house-round/greeting-pairs (Choir-house errand round: standing partners, fixed greetings, and a house that answers newcomers, without Fixed greeting pairs that tell a stranger exactly which attribute to shift, so they answer in kind): 62.251 (mean of 5 draws, range 62.251 to 62.251)
- ablation:choir-house-round/house-welcome (Choir-house errand round: standing partners, fixed greetings, and a house that answers newcomers, without The receiving choir-house answers each newcomer's arrival call for the first weeks): 55.796 (mean of 5 draws, range 55.796 to 55.796)
- intervention:responsory-lines (Responsory lines to old ties: relay stations and turn-taking): 24.375 (mean of 5 draws, range 24.375 to 24.375)
- ablation:responsory-lines/relay-stations (Responsory lines to old ties: relay stations and turn-taking, without Relay stations on the routes to old ties shorten lag): 20.929 (mean of 5 draws, range 20.929 to 20.929)
- ablation:responsory-lines/turn-taking (Responsory lines to old ties: relay stations and turn-taking, without Clause and counter-clause turns so calls never cross in transit): 24.158 (mean of 5 draws, range 24.158 to 24.158)
- intervention:neighbour-first (Neighbour-first with fixed greetings, keeping old ties in turn): 50.493 (mean of 5 draws, range 50.493 to 50.493)
- ablation:neighbour-first/nf-greeting-pairs (Neighbour-first with fixed greetings, keeping old ties in turn, without Fixed greeting pairs make neighbours safe to call): 7.499 (mean of 5 draws, range 7.499 to 7.499)
- ablation:neighbour-first/nf-local-share (Neighbour-first with fixed greetings, keeping old ties in turn, without Spend most spare calls on near neighbours, where lag is short): 62.694 (mean of 5 draws, range 62.694 to 62.694)
- ablation:neighbour-first/nf-turn-taking (Neighbour-first with fixed greetings, keeping old ties in turn, without Remaining calls to old ties taken in turns so they do not hush): 20.737 (mean of 5 draws, range 20.737 to 20.737)

Solve (sol.w3, solver isolation fresh_context, runs cited: intervention:choir-house-round, ablation:choir-house-round/standing-pairs, ablation:choir-house-round/greeting-pairs, ablation:choir-house-round/house-welcome, intervention:responsory-lines, ablation:responsory-lines/relay-stations, ablation:responsory-lines/turn-taking, intervention:neighbour-first, ablation:neighbour-first/nf-greeting-pairs, ablation:neighbour-first/nf-local-share, ablation:neighbour-first/nf-turn-taking):

# The Errand Responsory: ending thinning by making the calls people already make get answered

In this world, loneliness is physical. A resident whose calls go unanswered loses breath and thins. The engine compared three approaches, and one was clearly best: turn the **daily errand round**, a call the resident already makes and pays for, into a refrain held by a **choir-house**. That house has **standing partners**, **fixed greeting pairs**, and a **welcome for newcomers**.

| Run | Mean breath reserve after day 30 |
|---|---|
| scenario (no intervention) | 1.90 |
| intervention:choir-house-ro...

## Mechanisms

### Ties That Run With the Lease (mech.w1, from lib.world.w1, condition H)

Operator: A recurring two-party upkeep duty is attached to fixed positions rather than to their occupants and is discharged at a time set by a shared external timer, so its cost per party falls below spare capacity and the duty survives a change of occupant through a vouched handover.

Strangest element: The tie belongs to the unit: a newcomer inherits the predecessor's standing relationship with a specific counterpart, handed over face to face. Kept as: Kept as a covenant running with the tenancy and a mandatory vouched handover, not softened into an optional meetup; release only at term end except through a safety exit

Core mechanism: A register books a fixed recurring meeting for two paired units, so no one negotiates time; at move-out the leaver vouches the newcomer in, so the counterpart's tie continues instead of lapsing.

How it works: Housing authority or coop pairs each opted-in unit with two others, favouring a renter-owner mix so one side usually stays. Lease covenant: 45 min every other week at a fixed time in a neutral ground-floor room, booked and reminded 48 h ahead for both. 3-month terms end in renew or blameless release; the register re-pairs. Notice to vacate triggers a three-way handover meeting; a steward vouches if the leaver is gone. Pilot: unit-randomized; track attendance and a 3-item loneliness scale.

Why it fails: It breaks when both paired units turn over within one term (no voucher remains), or when the counterpart is unwanted: the slot then mandates contact, and release-and-re-pair churn recreates cold approaches. Avoidant, lonely people may never opt into bonded units.

Curator: family admit_new (mech.position-bound-tie-succession); claimed outcome admit_new (outcome.turnover-surviving-tie)

### Arrival Week, Metered Taper (mech.w2, from lib.world.w2, condition H)

Operator: A concentrated exposure among a fixed small set of units, delivered when each unit's arrangement is already disrupted, followed by withdrawal of external support at a rate held below the pace at which self-sustained interaction appears; abrupt endings or extra one-off pulses during withdrawal lock in the unsettled state, and coupling depth is gated by each counterpart's observed record.

Strangest element: Less contact helps: one-off contact during settling made outcomes worse (56.5 to 74.1), and soak or taper alone did nothing.. Kept as: The program retires newcomer mixers, bars one-off events during the taper, and withdraws its own hosting only at a metered rate; abrupt end and added mixers are explicit comparison arms.

Core mechanism: Moving breaks routines; 8 days of ~3h with one small cohort builds familiarity while evenings are free; hosted meetings then thin only as fast as members' own meetups replace them.

How it works: Address registration triggers an invite to the next cohort: 6–10 arrivals within a 10-minute walk. Arrival leave frees 8 days of ~3h hosted meals with staged mutual disclosure. Then hosted sessions at days 10,13,17,22,30,40,55; a gap widens only if a weekly one-tap check shows self-made meetups. No program mixers meanwhile. Contact details unlock after shared attendance; a separate custodian holds attendance-only completion records.

Why it fails: Breaks if arrivals are too sparse to fill a walkable cohort in weeks, if employers deny leave so only the time-rich attend, if one acutely distressed member loads the group, or if self-report gaming widens gaps early. The toy runs were deterministic, two-person, and counted snaps as relief.

Curator: family admit_new (mech.arrival-dose-metered-taper); claimed outcome admit_new (outcome.self-sustained-arrival-ties)

### Pinned Errands: Same Face, Same Slot (mech.w3, from lib.world.w3, condition H)

Operator: Hold the counterpart constant across a recurring exchange the person must already make, so repetition accrues familiarity at no added discretionary cost; open each exchange with a fixed form that varies one declared element, and re-establish the constant counterpart at the first exchange after any change of place.

Strangest element: A loneliness intervention that adds zero social time: ties grow only inside paid transactions people already make, and spare time is deliberately steered away from new neighbours (removing neighbour-spending raised the run score).. Kept as: Hard constraint: no scheduled social events. 'Added discretionary minutes' is a reported metric that must stay at zero, and spare time is directed to old ties.

Core mechanism: Pinning a resident's recurring purchases to one staff member at a fixed slot turns daily repeat contact into recognition; recognition lowers the cost and risk of each later exchange.

How it works: Opt-in for both sides. Resident names 3–5 weekly errands (café, pharmacy, grocery pickup, parcel desk). A continuity scheduler matches each to a staff member's recurring shift slot; the app nudges the visit time. Each visit opens with a fixed two-line exchange plus one rotating prompt. Registering a new address triggers re-pinning at nearby outlets for day one. A public subsidy pays employers per continuity hour. Research: does transactional time count toward tie-building?

Why it fails: Breaks when staff turnover outpaces residents' moves, when errands go to self-checkout or delivery, when employers won't trade throughput for continuity, or when transactional minutes never cross into personal ties. It may also load emotional labour onto low-paid staff.

Curator: family admit_new (mech.obligatory-exchange-counterpart-pinning); claimed outcome admit_instance (outcome.turnover-surviving-tie)

### Witness Wards and the Vouched Nod (mech.w4, from lib.world.w4, condition H)

Operator: Compensated, rotating observers give brief acknowledgment to anyone who crosses into a bounded zone whose entry signals consent, and pass that recognition across shift changes in person; the observed hours an observer spends acknowledging others mint an unlinkable, revocable credential that a counterpart can verify at first approach, so acknowledgment draws neither on unpaid discretionary time nor on unvetted approach risk.

Strangest element: The remedy is being looked at by paid, rotating non-friends, with no conversation required; watching is paid work.. Kept as: No matchmaking, no assigned counterpart, no duty to talk; witnesses are paid resident shift-workers, so a lonely person can be present as a worker rather than a supplicant and is visibly seen while watching.

Core mechanism: Paid on-shift residents acknowledge whoever enters a marked ward, pass regulars on at shift change and flag absences, so being noticed costs no one spare time; watch-hours mint an anonymous vouch.

How it works: Wards: lit, glass-walled, sound-damped bays at transit hubs; stepping over the floor line means 'acknowledge me', stepping out ends approaches. Each 2-hour shift has two paid resident witnesses, phones away: they nod at each entrant, learn opt-in first names, walk successors past regulars at changeover, and send an opt-in note after two missed usual visits. Logged shifts issue an unlinkable, revocable credential; a ring tap lights green when greeting. Newcomers get a 3-visit welcome round.

Why it fails: Paid nods may feel like service, not being known: the model scored recognition, not closeness. Wards could fill with already-social people while the isolated stay home. Credentials exclude unverifiable residents, and hour-farming by bad actors erodes the vouch's meaning.

Curator: family admit_new (mech.compensated-post-held-acknowledgment); claimed outcome admit_new (outcome.rotating-witnessed-recognition)

### Seated Waits and the Parting Sheet (mech.w5, from lib.world.w5, condition H)

Operator: Contact is placed inside dwell that participants are already compelled to spend, among a repeatedly co-seated set who can verify one another only by being verified at the same moment; logged co-presence is converted once and irrevocably into a jointly made, third-party-checkable record whose weaker strength ranks introductions after dispersal.

Strangest element: An irrevocable, once-only, jointly minted record of closeness that strangers can check. Kept as: Kept as one undeletable record per pair, depth frozen at minting (so pairs mint at parting), checkable only through symmetric posts, and used as the actual seating gate at weakest-link strength.

Core mechanism: Repeat seating with the same verified co-waiters turns compulsory dwell into shared hours; at parting, hours become a once-only joint record that later seats you beside your partner's partners.

How it works: Opt-in. Commuter coaches, laundromats, clinics and sport sidelines reserve 4–6 seat tables at fixed slots; an assigner reseats you with the same people each time. To sit, tap a fixed post: two verified IDs within 2 s, each sees name, district and shared partners only once both commit. Posts log co-present minutes. After 40+ h, a pair taps to mint one co-signed, undeletable record of total hours. Arriving elsewhere, you're seated with holders of a shared partner, ranked by the weaker record.

Why it fails: Breaks where seats go silent behind phones (dwell without talk builds nothing), where shift workers lack fixed slots, where newcomers with no records get no introductions, and where employers, partners or police compel record disclosure, turning closeness into surveillance.

Curator: family admit_new (mech.ended-tie-credential-bridge); claimed outcome admit_new (outcome.vouched-arrival-carried-closeness)

### Carry Clause: Move the Unfinished Tie (mech.w6, from lib.world.w6, condition H)

Operator: When an authority relocates an agent, every mutually declared bond of that agent, including unfinished ones, is relocated as one unit to adjacent destinations, so slowly accrued bond progress keeps accruing instead of resetting; and arrivals are released in synchronized batches so co-arrivals share the conditions of co-presence that bond formation requires.

Strangest element: Courtship carry: a half-formed bond is moved as cargo and resumes where it stopped. Kept as: Housing allocation treats a mutually declared unfinished friendship as a co-moving unit with placement rights, protecting sunk contact hours without asking for new free time; synchronized turnover is deliberately created and paid for.

Core mechanism: A mutually declared tie gets co-placed housing when either party moves, so hours already invested keep accruing via proximity instead of resetting; batched move-ins co-locate newcomers at once.

How it works: Housing networks (social, co-op, large landlords) run a carry registry: two tenants name each other (max 2 each, renewed every 6 months, silent opt-out). When one moves, the network offers a unit on the other's stairwell or block, or adjacent units if both move, fees waived. Vacancies are released in quarterly batches so arrivals share a floor and a move-in week. Research: does carry raise tie survival and cut turnover enough to pay for held vacancies?

Why it fails: Couples already co-move, so the model's largest lever is mostly spent here. Friends' moves rarely align: budgets, unit sizes and job sites differ, and cross-city moves can't be carried. Landlords may refuse held vacancies. Carry can lock in a soured tie. The tieless gain only from batching.

Curator: family admit_new (mech.co-placed-tie-carry); claimed outcome admit_new (outcome.carried-pair-tie)

### Lean Relay and the Vent Hour (mech.w7, from lib.world.w7, condition H)

Operator: When one agent discharges, a captured share of that discharge is delivered only to agents already signalling near-threshold, pushing them over so they discharge in the same window, while agents below the signal receive nothing and are not drained; a periodic pulse drawn from outside the agents' shared budget brings all agents to, not past, threshold together, resetting phase.

Strangest element: A reach-out is never delivered to someone in their quiet; part of its effort is harvested and spent tipping a third party who was nearly going anyway, and contact frequency is deliberately not raised.. Kept as: The relay withholds outings from everyone below their own lean threshold, sends one tip and no repeats, needs a quorum, and has no chat, likes or profiles, so readiness builds to a real meeting instead of leaking into pings.

Core mechanism: A paid district hour tops everyone up at once; between hours, a relay offers each outing only to neighbours whose private lean is high, saying 'someone is there', so near-ready ones go now.

How it works: Blocks of ~40 verified households. Each has a private lean switch (door tag or app) that rises with taps, decays, and is shown to no one. A resident heading to the courtyard table taps 'there till 20:40'. The relay sends one message, never repeated, only to neighbours above their learned lean threshold, and only if two qualify; others never hear of it. Newcomers start at a settled neighbour's lean. Every third Thursday a city-paid 90-minute early release by home postcode resets everyone.

Why it fails: Breaks if people won't tap lean honestly, if tipped neighbours still stay home, if a block rarely has two near-ready at once, or if employers dodge the paid hour, as with Japan's Premium Friday. Coinciding is not yet friendship. Tenancy checks won't stop a bad neighbour.

Curator: family admit_new (mech.readiness-gated-copresence-sync); claimed outcome admit_new (outcome.readiness-matched-copresence)

### Tap-Tested Ties: Load, Fail, Reflow (mech.w8, from lib.world.w8, condition H)

Operator: An external agent periodically sends a small genuine load across each recently formed link and treats non-propagation as silent failure; on failure it removes each endpoint's specific blocking condition with a matched remedy, applies one brief evenly shared activation to the whole local cluster followed by an enforced undisturbed settling interval, and re-tests, repeating until the load propagates. Links adjacent to a major disruption are left unloaded during it and re-treated only after it ends.

Strangest element: A tie is presumed failed until a real request crosses it, and the institution acts only on that measured failure; the world's ablation shows this trigger carries the whole effect.. Kept as: Probes are genuine burdens placed on fragile new ties, not surveys or social events; no repair happens without a missed probe; the still settling interval is kept as a randomised arm rather than turned into a social hour.

Core mechanism: A real small request across a tie either gets answered or not; a miss triggers a crew that removes each side's specific barrier, runs a brief joint task, enforces a still pause, then re-tests.

How it works: Opt-in at lease. Building system routes real asks (parcel, key, tool) from a newcomer to 2 adjacent households; answer within 24h = tie carries. Two misses: a 2-person crew visits, logs each side's barrier (safety, language, shifts, grievance) and applies its remedy (in-person ID check, interpreter, slot choice, mediation), runs an 8-min task needing all, then 7 min seated, no phones, crew leaves first. Re-test in 7 days; repeat ≤4 times, then re-match. After a household's upheaval, redo.

Why it fails: Answering a parcel request may be duty, not bond, so probes can certify ties nobody feels. Frequent asks may fatigue a fragile tie. Residents may resent a landlord scoring neighbourliness, and the still pause is an untested guess that may feel awkward. Those who refuse to opt in stay unserved.

Curator: family admit_new (mech.load-probed-tie-repair); claimed outcome admit_new (outcome.load-verified-tie)

### Datum Posts: The Corner Vouches (mech.w9, from lib.world.w9, condition H)

Operator: A fixed, independently placed reference accumulates time-separated observations of each enrolled party, so a lone party can corroborate an unacquainted counterpart against the reference without any shared intermediary. A counterpart whose observations co-vary with the viewer's own carries no independent information and is flagged instead of corroborated, and the first exchange is fixed against the reference's slow-changing shared record and the lower of the two declared intensities.

Strangest element: A lifeless fixed post substitutes for the missing partner or mutual friend, and a stranger whose presence tracks yours is exposed by that very alignment.. Kept as: Corroboration is held only by the place-bound post: no staff, ratings, profiles or portable reputation. Resolution requires independence from the viewer, so shadowing becomes the signal that excludes the shadower.

Core mechanism: Taps at a fixed post build dated presence records; long, independent records make regulars verifiable to each other, so approach feels safe; a record that shifts with yours is flagged.

How it works: Posts at busy stops log taps from ID-verified NFC tokens. Someone is resolved to you after 15+ tap days over 45+ days. If they appear only when you do, or their arrival shifts when yours does, they are flagged as aligned. To meet, tap Open and pick a grade: nod, name, walk to platform. Mutually resolved Open pairs are sent to numbered pavement marks; both see the lower grade and their shared stop history. Identity is escrowed, released only on complaint.

Why it fails: Breaks if safety is not the barrier, if too few enrollees are Open at once, and for shift workers who never accrue baseline. Housemates and colleagues on one schedule look aligned unless schedules vary. A breached presence database would arm the stalkers it screens.

Curator: family admit_new (mech.place-anchored-stranger-corroboration); claimed outcome admit_new (outcome.place-corroborated-approach)

### Forge Fast, Then Shield the Tie (mech.w10, from lib.world.w10, condition H)

Operator: A bond shaped only during a limited malleable state, by a capped number of distributed shaping actions whose cost the receiver can match, is then decoupled from the surface through which unsolicited non-shaping impacts arrive, so its finite tolerance is spent only on impacts that shape it and engagement occurs only when a party signals receptivity.

Strangest element: The keystone is reducing contact with the people just befriended: after one capped arrival window, the default between new friends becomes nothing owed, and the building actively keeps friction off the pair.. Kept as: No scheduled maintenance meetups; warm contact only through a default-cold flag; disputes never travel along the tie. The predicted backfire, that a welcome without the shield is worse than no welcome, is kept as the central pilot test.

Core mechanism: Cold contacts (rushed run-ins, disputes, unrepayable favours) breed guilt and avoidance; stripping them from a new tie leaves only warm contact, so the tie is not worn into avoidance.

How it works: Move-in booking opens a 21-day window. A paid steward does the newcomer's setup chores to free time. Four verified residents each host one turn, potluck-equal so no debt forms, in a quiet room off the lobby. Day 21: pairs privately opt in; mutual matches are registered as shielded. Then disputes between them go anonymously via the steward, they never share committees or chores, a passing nod discharges all obligation, and the only prompt to meet is a one-ping 'open' flag.

Why it fails: Unlike a hung piece, an untouched tie decays: if neither partner ever sets 'open', the shield just files the friendship away. Routing disputes through a steward can feel like being reported, and where most stay under a year, forging costs outrun the tie's life.

Curator: family admit_new (mech.tie-cold-contact-shield); claimed outcome admit_new (outcome.wear-shielded-arrival-ties)

## Transfers

Tasks prepared: 62. Worlds are thought experiments: where a world has a model, its runs show what follows from its laws as modelled, not what works in our world. Transfers are ideas with their mappings; nothing here is evidence that an idea works.