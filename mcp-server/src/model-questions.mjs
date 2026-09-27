// The Meaning Model is where the work is thought, in every mode: a story, a market, a life, an alien world. This
// module reads a model's structure and returns its open questions: what the structure itself shows is missing,
// inconsistent in time, undecided or unexplained, each phrased as a question the agent answers by adding
// structure, with the tool to use. The questions go down the ladder (open what is coarse, give people whole lives,
// follow shocks into their adaptations) and up it (which longer development explains this, which concept does it
// instantiate, which regularity links these Events). It also reads a person's state at a moment, which is the
// agent's sense of time: the period of their life, what the latest Cuts say about them, which shock they are still
// adapting to, and what is undecided. The questions never run out: every answer adds structure, and new structure
// raises the next questions.
//
// Conventions read here, all ordinary model records: a person has a lifecycle Event containing the processes
// their life runs through and the periods of the life, each period an Event with an interval. The person template
// (person_scaffold, the Book's nine slow processes) is one suggestion for those processes; processes invented for
// this person, or subcategories of either, may understand them better; shocks are change arcs (change_arc_scaffold) bound to the person they affect; the kind of a Cut is
// read from its unit, as in the Book of Conditions (motivational attention for what a person wants, emotional
// attention for what they feel, decision allocation for a decision between continuations); decisions are drawn
// with life_direction_draw, and estimates carry estimator or supplied provenance.

export const SLOW_PROCESSES = Object.freeze(['body', 'kin', 'partnership', 'work', 'place', 'means', 'knowledge', 'standing', 'meaning']);
// The shared first-run comparison vocabulary of the Book; a person's own wants replace it.
const SHARED_WANTS = new Set(['belonging', 'competence', 'autonomy', 'understanding', 'well_being', 'wellbeing', 'well-being', 'remainder']);
// A larger shift prompts a causal review; the recognizer cannot establish that no explanation exists.
export const MAX_UNCAUSED_SHIFT = 0.2;

const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
const start = (event) => event?.interval?.start ?? null;
const end = (event) => event?.interval?.end ?? null;
const span = (event) => (start(event) !== null && end(event) !== null ? end(event) - start(event) : null);
export const cutKind = (cut) => {
  const unit = String(cut.unit ?? '').toLowerCase();
  if (/decision|continuation/u.test(unit) || /\.direction\./u.test(cut.parent_event_id ?? '')) return 'decision';
  if (unit.includes('motivational')) return 'wants';
  if (unit.includes('emotional')) return 'feels';
  if (unit.includes('fulfillment') || unit.includes('fulfilment')) return 'outlook';
  if (/deciding|framing|problem-solving/u.test(unit)) return 'how';
  if (unit.includes('health')) return 'health';
  return 'other';
};
const questionOf = (cut) => String(cut.question ?? cut.id ?? '');
const answersOf = (cut) => cut.answers ?? [];
const estimated = (cut) => (cut.provenance ?? []).some((item) => /^(estimator|supplied):/u.test(String(item)));

// Whether the storytelling profile is adopted. Optional motive lenses, whole lives and drawn decisions belong to it: general
// modeling works on subjects, processes, constraints, observations, dependencies and alternatives, and a draw
// constructs fiction, it does not settle an observed fact.
export const storyProfile = (environment = process.env) => String(environment.MEANING_MODEL_ADDONS ?? '').split(',').map((item) => item.trim()).includes('storytelling');
// The questions that give people whole lives (a life, its periods and processes, wants, shocks and choices) belong to the
// storytelling profile; general modeling asks about causes, processes and structure of whatever it models.
const LIFE_KINDS = new Set(['life-missing', 'life-untimed', 'processes-few', 'process-empty', 'periods-missing', 'period-gap', 'period-uncut', 'wants-missing',
  'wants-generic', 'shocks-few', 'adaptation-open', 'moment-unmodeled', 'why-local', 'choices-missing', 'life-thin', 'secondary-without-life']);
const asked = (kind) => storyProfile() || !LIFE_KINDS.has(kind);
// The provenance a reading Event made by life_lens_place carries.
export const READING_MARK = 'Meaning Model lens placement v1';
// The kind of context an Event sits in: its nearest declared root, following containment up; null in a model without roots.
export function contextKindOf(index, eventId) {
  let at = eventId;
  for (let step = 0; step < 256 && at; step += 1) { if (index.rootKinds?.has(at)) return index.rootKinds.get(at); at = [...(index.parents.get(at) ?? [])][0]; }
  return null;
}
// A reading's Cut is not a person's state: lens answers, and any Cut on a reading Event.
const readingCut = (index, cut) => String(cut.id ?? '').startsWith('lens.') || Boolean(index.readings?.has(cut.parent_event_id));

export function indexModel(model) {
  const mm = model?.meaning_model ?? {};
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const children = new Map();
  const parents = new Map();
  for (const relation of mm.event_relations ?? []) {
    if (relation.kind !== 'contains') continue;
    push(children, relation.source_event_id, relation.target_event_id);
    push(parents, relation.target_event_id, relation.source_event_id);
  }
  const cuts = (mm.normalized_cuts ?? []).filter((cut) => !cut.withdrawn);
  const cutsByEvent = new Map();
  for (const cut of cuts) push(cutsByEvent, cut.parent_event_id, cut);
  const referents = new Map((mm.referents ?? []).map((referent) => [referent.id, referent]));
  const eventsOf = new Map();
  for (const event of events.values()) {
    for (const value of Object.values(event.participants ?? {})) for (const referentId of [value].flat()) push(eventsOf, referentId, event.id);
  }
  for (const binding of mm.event_referent_bindings ?? []) {
    if (binding.target?.event_id && binding.binding_type !== 'change_arc_subject') push(eventsOf, binding.referent_id, binding.target.event_id);
  }
  const arcsOf = new Map();
  for (const binding of mm.event_referent_bindings ?? []) {
    if (binding.binding_type === 'change_arc_subject' && binding.target?.event_id) push(arcsOf, binding.referent_id, binding.target.event_id);
  }
  const relations = mm.event_relations ?? [];
  const abstractions = { concepts: (mm.concepts ?? []).length, abstractRelations: (mm.abstract_relations ?? []).length, abstractCuts: (mm.abstract_cuts ?? []).length,
    laws: (model?.laws ?? []).length, claims: (model?.initial_claims ?? []).length, realizations: (mm.realizations ?? []).length };
  // Readings are held apart from the world, and what is a reading is decided by where an Event sits, not by what it
  // refers to: Events under an understanding root, and the reading Events life_lens_place makes. A world Event may be
  // about another (a letter about a death) and is still the world's.
  const rootKinds = new Map((mm.context_roots ?? []).map((root) => [root.event_id, root.kind]));
  const readings = new Set();
  for (const [root, kind] of rootKinds) if (kind === 'understanding') { readings.add(root); for (const id of walk(children, root)) readings.add(id); }
  for (const event of events.values()) if ((event.provenance ?? []).includes(READING_MARK)) readings.add(event.id);
  return { events, children, parents, cuts, cutsByEvent, referents, eventsOf, arcsOf, abstractions, relations, readings, rootKinds, processes: (model?.processes ?? []).length, processList: model?.processes ?? [] };
}

function walk(map, eventId) {
  const found = new Set();
  const queue = [eventId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of map.get(id) ?? []) if (!found.has(next)) { found.add(next); queue.push(next); }
  }
  return found;
}
const descendants = (index, eventId) => walk(index.children, eventId);
export const eventDescendants = descendants;
const ancestors = (index, eventId) => walk(index.parents, eventId);
const phaseEvent = (index, arcEventId, phase) => index.events.get(`${arcEventId}.${phase}`) ?? null;

// A readable name for a referent: the last segment of its id, as words.
export function displayName(referentId) {
  const last = String(referentId).split(/\.person\.|\./u).filter(Boolean).at(-1) ?? String(referentId);
  return last.replace(/[_-]+/gu, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

// Modeled people: referents with a lifecycle Event that holds the processes of a life, from the person template or
// the modeler's own, or whose moments carry what they want or feel. Those the model says most about come first and
// count as principals.
// Events with no place of their own or from an Event that contains them.
export function unplacedEvents(index, eventIds) {
  return eventIds.map((eventId) => index.events.get(eventId)).filter((event) => event && !index.readings?.has(event.id) && !event.region && !event.substrate
    && ![...ancestors(index, event.id)].some((eventId) => index.events.get(eventId)?.region || index.events.get(eventId)?.substrate));
}

export function modeledPeople(index) {
  const feelsOrWants = (referentId) => (index.eventsOf.get(referentId) ?? []).some((eventId) => (index.cutsByEvent.get(eventId) ?? []).some((cut) => ['wants', 'feels'].includes(cutKind(cut))));
  return [...index.referents.values()].filter((referent) => referent.lifecycle_event_id
    && ((index.children.get(referent.lifecycle_event_id) ?? []).some((id) => /\.is\.[a-z]+$/u.test(id)) || feelsOrWants(referent.id)))
    .map((referent) => ({ id: referent.id, name: displayName(referent.id), cuts: readPerson(index, referent.id).cuts.length }))
    .sort((a, b) => b.cuts - a.cuts).map(({ id, name, cuts }) => ({ id, name, principal: cuts > 0 }));
}

// Everything the model holds about one person: their life Event, slow processes, periods, the moments of their
// life that carry Cuts, and their shocks.
export function readPerson(index, personId) {
  const referent = index.referents.get(personId) ?? null;
  const life = referent?.lifecycle_event_id ? index.events.get(referent.lifecycle_event_id) ?? null : null;
  const inLife = life ? descendants(index, life.id) : new Set();
  const own = new Set([...inLife, ...(index.eventsOf.get(personId) ?? [])]);
  if (life) own.add(life.id);
  const slow = Object.fromEntries(SLOW_PROCESSES.map((key) => {
    const event = [...(index.children.get(life?.id) ?? [])].map((id) => index.events.get(id)).find((item) => item?.id.endsWith(`.is.${key}`)) ?? null;
    const opened = event ? descendants(index, event.id).size + (index.cutsByEvent.get(event.id) ?? []).length : 0;
    return [key, { eventId: event?.id ?? null, opened }];
  }));
  // The processes the life runs through, template or invented: contained Events that span the life, or most of it.
  const lifeSpan = span(life);
  const processes = life ? (index.children.get(life.id) ?? []).map((id) => index.events.get(id)).filter((event) => event
    && (/\.is\.[a-z]+$/u.test(event.id) || span(event) === null || (lifeSpan && span(event) >= lifeSpan * 0.8)))
    .map((event) => ({ eventId: event.id, what: describe(event), opened: descendants(index, event.id).size + (index.cutsByEvent.get(event.id) ?? []).length })) : [];
  const periods = life ? (index.children.get(life.id) ?? []).map((id) => index.events.get(id))
    .filter((event) => event && !/\.is\.[a-z]+$/u.test(event.id) && span(event) !== null
      && !(start(event) <= start(life) && end(event) >= end(life)))
    .sort((a, b) => start(a) - start(b)) : [];
  const cuts = [...own].flatMap((eventId) => (index.cutsByEvent.get(eventId) ?? []).map((cut) => ({ cut, event: index.events.get(eventId) })));
  const arcs = (index.arcsOf.get(personId) ?? []).map((arcEventId) => ({
    arcEventId, arc: index.events.get(arcEventId) ?? null,
    anticipation: phaseEvent(index, arcEventId, 'anticipation'), focal: phaseEvent(index, arcEventId, 'focal_change'), adaptation: phaseEvent(index, arcEventId, 'adaptation'),
  }));
  return { personId, referent, life, lifeLength: span(life), slow, processes, periods, cuts, arcs, own };
}

const describe = (event) => (event?.description ?? event?.boundary ?? event?.id ?? '').toString().slice(0, 160);
const when = (event) => (start(event) === null ? 'at an untimed moment' : end(event) !== null && end(event) !== start(event) ? `from ${start(event)} to ${end(event)}` : `at ${start(event)}`);

// Consecutive Cuts asking the same question can prompt a review of a large shift and its explanation.
function uncausedShifts(series, causes, subjectLabel, causedBy = () => false) {
  const found = [];
  for (const list of series.values()) {
    list.sort((a, b) => start(a.event) - start(b.event));
    for (let i = 1; i < list.length; i += 1) {
      const [before, after] = [list[i - 1], list[i]];
      const weights = (cut) => Object.fromEntries(answersOf(cut).map((answer) => [answer.key, answer.weight]));
      const [a, b] = [weights(before.cut), weights(after.cut)];
      const moved = Object.keys({ ...a, ...b }).filter((key) => Math.abs((b[key] ?? 0) - (a[key] ?? 0)) > MAX_UNCAUSED_SHIFT + 1e-9);
      if (!moved.length || causes.some((time) => time > start(before.event) && time <= start(after.event)) || causedBy(before, after)) continue;
      const key = moved[0];
      found.push({ at: [start(before.event), start(after.event)], cuts: [before.cut.id, after.cut.id],
        question: `${subjectLabel}"${before.cut.question}" moves ${key} from ${(a[key] ?? 0).toFixed(2)} to ${(b[key] ?? 0).toFixed(2)} between ${start(before.event)} and ${start(after.event)}. This recognizer found no intervening change arc or matching causal relation; an explanation may already be present in descriptions or other model structure. Read that evidence first. Is this a changed situation, a changed assessment, or a genuinely unexplained transition? Link or refine the relevant explanation if needed; do not invent a cause or smooth the recorded values merely to remove this question.` });
    }
  }
  return found;
}

// A person's open questions, most structural first.
function personQuestions(index, person, name, principal) {
  const questions = [];
  const ask = (kind, question, tool, extra = {}) => { if (asked(kind)) questions.push({ kind, subject: person.personId, principal, question, tool, ...extra }); };
  if (!person.referent) {
    ask('life-missing', `${name} is not in the model. Who are they? Give them a referent and a whole life, from the person template (person_scaffold) or from processes of your own.`, 'life_profile_compile (person_scaffold) or life_model_revise');
    return questions;
  }
  if (!person.life) {
    ask('life-missing', `${name} has no life in the model, only a name. Give them a lifecycle Event over their whole life, from birth to death or to now, holding the processes their life runs through: the person template (person_scaffold) is one starting point, processes of your own another.`, 'life_profile_compile (person_scaffold) or life_model_revise');
    return questions;
  }
  if (person.lifeLength === null) ask('life-untimed', `${name}'s life has no interval. When were they born, and when does the life end or the work leave it? Without time the model cannot keep their states consistent.`, 'life_model_revise');
  if (person.processes.length < 3) ask('processes-few', `This recognizer found ${person.processes.length} long-running process${person.processes.length === 1 ? '' : 'es'} directly within ${name}'s life Event. Read the existing descriptions and other model structure before concluding that a process is missing. What would explain this life better? The person template suggests body, kin, partnership, work, place, means, knowledge, standing and meaning; use these, your own processes or fewer of them where relevant. A recognized process count is not a depth requirement.`, 'life_meaning_query or life_model_inspect, then life_model_revise if needed');
  const empty = person.processes.filter((item) => item.opened === 0).map((item) => item.eventId.match(/\.is\.([a-z]+)$/u)?.[1] ?? item.what);
  if (empty.length) ask('process-empty', `${name}'s ${empty.join(', ')} ${empty.length === 1 ? 'has' : 'have'} no recognized child Events or Cuts. Read their descriptions and other related records before treating them as unexplained. Which episodes or changes matter to the current question? Open a process where the causality needs it; a useful qualitative account does not require numerical Cuts.`, 'life_meaning_query or life_model_inspect, then life_model_revise if needed', { processes: empty });
  if (!person.periods.length) {
    ask('periods-missing', `No bounded life periods were recognized directly within ${name}'s life Event. Read the existing life descriptions, dossier and other model structure first. Which periods explain the current choices, and is any relevant history still unresolved? Add or link the needed periods; a complete partition of the life is optional, not a requirement to invent its unneeded remainder.`, 'life_meaning_query or life_model_inspect, then life_model_revise if needed');
  } else if (start(person.life) !== null) {
    let cursor = start(person.life);
    const tolerance = (person.lifeLength ?? 0) * 0.02;
    for (const period of person.periods) {
      if (start(period) - cursor > tolerance) ask('period-gap', `${name}'s life has no period from ${cursor} to ${start(period)}. What was their life then?`, 'life_model_revise', { at: [cursor, start(period)] });
      cursor = Math.max(cursor, end(period));
    }
    if (end(person.life) !== null && end(person.life) - cursor > tolerance) ask('period-gap', `${name}'s life has no period from ${cursor} to ${end(person.life)}. What was their life then?`, 'life_model_revise', { at: [cursor, end(person.life)] });
    // A person's own states belong under their inner root, so a period is also cut by the inner Events within it.
    const innerWithin = (period) => [...person.own].some((eventId) => {
      if (contextKindOf(index, eventId) !== 'inner' || index.readings?.has(eventId)) return false;
      const t = start(index.events.get(eventId)); return t !== null && t >= start(period) && t <= end(period) && (index.cutsByEvent.get(eventId) ?? []).some((cut) => !readingCut(index, cut));
    });
    for (const period of person.periods) {
      const inside = [period.id, ...descendants(index, period.id)];
      if (!inside.some((eventId) => (index.cutsByEvent.get(eventId) ?? []).some((cut) => !readingCut(index, cut))) && !innerWithin(period)) {
        ask('period-uncut', `No Cut was recognized in ${name}'s period "${describe(period)}" (${when(period)}). Their outlook may already be described qualitatively; read it first. What did they expect, what was at risk, and does this explain the relevant choices? Add an outlook or conditional threat Cut only if a meaningful comparison and declared unit call for numerical shares.`, 'life_meaning_query or life_model_inspect, then life_model_revise if needed', { at: [start(period), end(period)] });
      }
    }
  }
  const wantCuts = person.cuts.filter((item) => cutKind(item.cut) === 'wants');
  if (!wantCuts.length) {
    ask('wants-missing', `No motivational-attention Cut was recognized for ${name}. Their wants may already be expressed in descriptions or other records. Read those first: what do they most deeply want, which learned wants serve it, and how do these explain their choices? Refine a missing distinction where useful; add a Cut only when a declared comparison and unit call for one.`, 'life_meaning_query or life_model_inspect, then life_model_revise if needed');
  } else if (wantCuts.every((item) => answersOf(item.cut).every((answer) => SHARED_WANTS.has(answer.key)))) {
    ask('wants-generic', `${name}'s recognized motivational-attention Cuts use only the shared vocabulary (belonging, competence, autonomy, understanding, well-being). Their particular wants may already be described elsewhere. What does ${name} most deeply want, which learned want serves or displaces it, and where do two conflict? Inspect that account before adding categories.`, 'life_meaning_query or life_model_revise');
  }
  if (person.arcs.length < 2) {
    ask('shocks-few', `This recognizer found ${person.arcs.length} change arcs for ${name}; changes may already be described elsewhere. Read those records first. Which changes, if any, explain their anticipation, adaptation and current choices? Use a change arc or another structure where it clarifies the account. Do not invent shocks to meet a count; a stable process can also explain a life.`, 'life_meaning_query or life_model_inspect, then life_model_revise if needed');
  }
  for (const item of person.arcs) {
    if (!item.adaptation) continue;
    if (!(descendants(index, item.adaptation.id).size + (index.cutsByEvent.get(item.adaptation.id) ?? []).length)) {
      ask('adaptation-open', `How did ${name} adapt after "${describe(item.arc)}" (${when(item.focal ?? item.arc)})? What changed in their other processes, what they want, believe and do, and did it recover or become a new baseline? Open the adaptation.`, 'life_model_revise', { at: [start(item.focal ?? item.arc), end(item.adaptation)] });
    }
  }
  const series = new Map();
  for (const item of person.cuts) {
    if (start(item.event) === null || cutKind(item.cut) === 'decision' || readingCut(index, item.cut)) continue;
    push(series, `${questionOf(item.cut).toLowerCase().trim()}|${item.cut.unit}`, item);
  }
  const shocksAt = person.arcs.map((item) => start(item.focal ?? item.arc)).filter((value) => value !== null);
  // A modeled cause: a causal relation into the later record or what contains it, or into any of the person's own
  // Events from an Event that starts between the two readings.
  const causal = new Set(['causes', 'enables', 'prevents', 'constrains']);
  const causedBy = (before, after) => { const within = new Set([after.event.id, ...ancestors(index, after.event.id)]);
    return index.relations.some((relation) => causal.has(relation.kind) && (within.has(relation.target_event_id)
      || (person.own.has(relation.target_event_id) && start(index.events.get(relation.source_event_id)) > start(before.event) && start(index.events.get(relation.source_event_id)) <= start(after.event)))); };
  for (const shift of uncausedShifts(series, shocksAt, `${name}'s `, causedBy)) ask('shift-uncaused', shift.question, 'life_model_revise', { at: shift.at, cuts: shift.cuts });
  // A decision is a moment: what the person wants, feels and how they decide should be modeled there first. The moment
  // is the decision Event, give or take its own length, a twentieth of the Event that contains it or a thousandth of
  // the life, whichever is longest; a fixed unit would be a year in a model counted in years.
  for (const item of person.cuts.filter((entry) => cutKind(entry.cut) === 'decision')) {
    const t = start(item.event);
    const length = t === null ? 0 : Math.max(0, (end(item.event) ?? t) - t);
    const container = Math.max(0, ...[...(index.parents.get(item.event.id) ?? [])].map((eventId) => span(index.events.get(eventId)) ?? 0));
    const tolerance = Math.max(length, container / 20, (person.lifeLength ?? 0) / 1_000);
    const around = person.cuts.filter((entry) => entry !== item && ['wants', 'feels', 'how'].includes(cutKind(entry.cut))
      && start(entry.event) !== null && t !== null && start(entry.event) >= t - tolerance && start(entry.event) <= (end(item.event) ?? t) + tolerance);
    if (!around.length) ask('moment-unmodeled', `At "${describe(item.event)}" (${when(item.event)}), before ${name} decides "${item.cut.question}", no nearby wants, feelings or problem-solving Cuts were recognized. What circumstances, wants, knowledge, feelings and constraints explain this choice? Read existing descriptions and other records first; refine the causal account if needed. Numerical Cuts are useful only for declared comparisons, not required scores for a choice.`, 'life_meaning_query or life_model_revise', { at: [t, end(item.event)], cuts: [item.cut.id] });
    const outside = [...ancestors(index, item.event.id)].filter((eventId) => !person.own.has(eventId));
    if (!outside.length) ask('why-local', `Why does "${item.cut.question}" arise for ${name}? No enclosing Event outside this person's recognized life was found through contains links. That does not rule out causes in other relations or descriptions. Inspect those first, then model any relevant wider developments (institutions, money, technology, family history or place) that the explanation still needs, at their own resolution.`, 'life_meaning_query or life_model_revise', { cuts: [item.cut.id] });
  }
  // Lack of a recognized decision Cut does not mean that a person makes no choices.
  if (principal && !person.cuts.some((entry) => cutKind(entry.cut) === 'decision')) {
    ask('choices-missing', `No decision Cut was recognized for ${name}; their choices may already be recorded as Events or in descriptions. What do they choose, between which options, and why? Read and preserve accepted outcomes, then refine any missing causal account. A decision Cut and recorded draw are optional for a still-open fictional choice whose quantitative question and uncertainty are delegated to you; never redraw retrospective history.`, 'life_meaning_query or life_model_revise');
  }
  return questions;
}

// Questions of the whole model, in any mode: time, causes, the abstraction ladder, decisions and estimates.
function worldQuestions(index, lives, draws) {
  const questions = [];
  const ask = (kind, question, tool, extra = {}) => { if (asked(kind)) questions.push({ kind, subject: null, principal: false, question, tool, ...extra }); };
  const timed = [...index.events.values()].filter((event) => span(event) !== null);
  if (index.events.size && !timed.length) ask('time-missing', 'No explicit Event interval was found. Does this model need to answer temporal questions? Inspect any ordering, descriptions and declared clock first; add intervals at the supported resolution where needed. A timeless conceptual model need not acquire invented dates.', 'life_meaning_query or life_model_revise');
  if (timed.length) {
    const first = Math.min(...timed.map(start));
    const last = Math.max(...timed.map(end));
    const longest = Math.max(...timed.map(span));
    const longestLife = Math.max(0, ...lives.map((item) => item.read.lifeLength ?? 0));
    // A containing world need not be dated, nor extend beyond the declared scope of its contents.
    const enclosureTargets = lives.length ? lives.map((item) => item.read.life?.id).filter(Boolean) : timed.map((event) => event.id);
    const targetAncestors = enclosureTargets.map((eventId) => ancestors(index, eventId));
    const hasEnclosure = targetAncestors.length > 0 && [...targetAncestors[0]].some((eventId) =>
      targetAncestors.every((parents) => parents.has(eventId)));
    if (!hasEnclosure && (longest < (last - first) * 0.8 || (lives.length && longest <= longestLife * 1.2))) {
      ask('macro-missing', `Recorded intervals span ${first} to ${last}, and no shared enclosing Event was recognized through contains links. Bounded intervals do not establish that a wider world or its explanation is absent. Read the existing context, relations and descriptions: which longer or wider developments actually explain this situation, and does any consequential gap remain? Model only the relevant missing context at its own resolution.`, 'life_meaning_query or life_model_revise');
    }
  }
  // Containment is one route to context, not an exhaustive causal account.
  const people = new Set(lives.flatMap((item) => [...item.read.own]));
  for (const cut of index.cuts.filter((item) => cutKind(item) === 'decision')) {
    if (people.has(cut.parent_event_id)) continue;
    if (!ancestors(index, cut.parent_event_id).size) ask('why-local', `Why does "${cut.question}" arise? No contains ancestor was found for its Event. Causes or context may be expressed through other relations or descriptions; inspect them before adding anything. Which relevant circumstances explain the choice, and is that account sufficient?`, 'life_meaning_query or life_model_revise', { cuts: [cut.id] });
  }
  // Up the ladder: the model's Events should instantiate concepts, and regularities should link them.
  const { concepts, abstractRelations, laws, claims } = index.abstractions;
  if (index.events.size >= 8 && concepts < Math.max(3, Math.floor(index.events.size / 20))) {
    ask('concepts-thin', `The model has ${index.events.size} Events and ${concepts} concept${concepts === 1 ? '' : 's'}. What are these Events instances of? Climb up: name the concepts they realize, how the concepts specialize, oppose or express one another, and which one explains several of them at once.`, 'life_model_revise');
  }
  if (index.events.size >= 8 && laws + claims + abstractRelations === 0) {
    ask('laws-missing', 'What regularities hold across these Events: when one thing happens, what tends to follow, for whom, and why? State them as laws, claims or abstract relations, and test them against what the model shows.', 'life_model_revise');
  }
  const byQuestion = new Map();
  for (const cut of index.cuts) if (!index.readings?.has(cut.parent_event_id)) push(byQuestion, questionOf(cut).toLowerCase().trim(), cut);
  for (const [question, list] of byQuestion) {
    if (list.length >= 3 && concepts < 3) ask('recurring-question', `"${list[0].question}" is asked at ${list.length} moments. What general pattern do the answers show across them, and which concept or law is it? Climb up.`, 'life_model_revise', { cuts: list.slice(0, 8).map((cut) => cut.id), key: question });
  }
  // Where things happen: the physical coordinates of the moments that carry the work.
  const unplaced = unplacedEvents(index, [...index.cutsByEvent.keys()]);
  if (unplaced.length) ask('place-missing', `${unplaced.length} moment${unplaced.length === 1 ? '' : 's'} carrying Cuts ${unplaced.length === 1 ? 'has' : 'have'} no place (for example ${unplaced.slice(0, 3).map((event) => event.id).join(', ')}). Where does each happen, where is each person and Thing in it, and in what physical state? Give each its region, or contain it in an Event that has one, and model the physical processes of the Things taking part.`, 'life_model_revise');
  // Draws are recorded in the story graph, not the model. Without the graph the tool cannot tell which decisions are
  // drawn, so it names them together rather than claiming each is undrawn. A draw constructs fiction, so draws are
  // suggested only where the storytelling profile is adopted: in a model of what happened, a decision is observed.
  if (!storyProfile()) { /* no draws suggested outside fiction */ } else if (draws === null) {
    const decisions = index.cuts.filter((item) => cutKind(item) === 'decision');
    if (decisions.length) ask('decision-undrawn', `The model holds ${decisions.length} decision Cut${decisions.length === 1 ? '' : 's'} (${decisions.slice(0, 4).map((cut) => cut.id).join(', ')}${decisions.length > 4 ? ', and more' : ''}); their draw history is unknown without the story graph. Read life_model_questions with graphHash and the accepted outcome records. Preserve accepted or retrospective outcomes: absence of a draw receipt does not make them undecided. Sample only a still-open fictional choice when its quantitative question and uncertainty are delegated to you.`, 'life_model_questions (graphHash)', { cuts: decisions.map((cut) => cut.id) });
  } else {
    const drawn = new Set(draws.map((item) => item.cutId));
    for (const cut of index.cuts.filter((item) => cutKind(item) === 'decision' && !drawn.has(item.id))) {
      ask('decision-undrawn', `No recorded draw was found for "${cut.question}" in the supplied graph. Inspect its accepted outcome and provenance before treating it as open; retrospective or already authored outcomes must be preserved, not redrawn. Only for a still-open fictional choice with a meaningful quantitative question and delegated uncertainty may you choose a recorded draw.`, 'life_narrative_query or life_meaning_query; life_direction_draw only for delegated open choices', { cuts: [cut.id] });
    }
  }
  // A drawn remainder may need an opening; its later resolution can also be recorded in another form.
  for (const draw of (draws ?? []).filter((item) => item.realized === 'remainder')) {
    const cut = index.cuts.find((item) => item.id === draw.cutId);
    if (!cut || index.cuts.some((item) => item.conditioning?.cut_id === draw.cutId && item.conditioning?.answer_key === 'remainder')) continue;
    ask('remainder-unopened', `The draw on "${cut.question}" landed on the remainder, and no Cut conditioned on that answer was recognized. Read any subsequent Events and accepted outcome first. If it remains unresolved, model the admissible continuations; a conditioned Cut and further draw are optional when their quantitative question and uncertainty are delegated. Preserve a resolution already recorded in another form.`, 'life_meaning_query or life_model_revise; optional conditioned Cut and recorded draw', { cuts: [cut.id] });
  }
  // A quantity with only a starting value, which no Event observes, has no trajectory: nothing can cross a threshold.
  const observed = new Set([...index.events.values()].flatMap((event) => [...(event.process_ids ?? []), ...(event.observation_process_ids ?? [])]));
  const still = (index.processList ?? []).filter((process) => !observed.has(process.id) && !String(process.id).startsWith('concept-index.'));
  if (still.length) ask('process-unobserved', `${still.length} process${still.length === 1 ? ' holds' : 'es hold'} only a starting value, and no Event observes ${still.length === 1 ? 'it' : 'them'} (for example ${still.slice(0, 4).map((process) => `${process.id}${typeof process.initial_value?.value === 'number' ? ` ${process.initial_value.value}` : ''}`).join(', ')}). Give each a dated trajectory, observed at the Events where it matters, and the thresholds at which what depends on it fails.`, 'life_model_revise', { processes: still.map((process) => process.id) });
  // A life that is one Event with nothing inside is a name with dates.
  const principalIds = new Set(lives.filter((item) => item.principal !== false).map((item) => item.id));
  const thin = [...index.referents.values()].filter((referent) => referent.lifecycle_event_id && !principalIds.has(referent.id)
    && !(index.children.get(referent.lifecycle_event_id) ?? []).length && !(index.cutsByEvent.get(referent.lifecycle_event_id) ?? []).length);
  if (thin.length) ask('life-thin', `${thin.length} li${thin.length === 1 ? 'fe is' : 'ves are'} one Event with nothing inside (${thin.slice(0, 8).map((referent) => displayName(referent.id)).join(', ')}${thin.length > 8 ? ', and more' : ''}). For a person: a want, a shock and the periods their part in the world needs. For a Thing (a machine, a document, an institution): its parts, capacities, limits and failure modes, and its history.`, 'life_profile_compile (person_scaffold or thing_scaffold) or life_model_revise', { referents: thin.map((referent) => referent.id) });
  const unestimated = index.cuts.filter((cut) => !estimated(cut) && cutKind(cut) !== 'other');
  if (unestimated.length) ask('weights-unestimated', `${unestimated.length} Cut${unestimated.length === 1 ? '' : 's'} carry weights nobody estimated (for example ${unestimated.slice(0, 3).map((cut) => cut.id).join(', ')}). Estimate them from their described situations, or record whose distribution they are.`, 'life_estimate_cut_shares or life_process_estimate', { cuts: unestimated.slice(0, 12).map((cut) => cut.id) });
  const undescribed = [...index.cutsByEvent.keys()].map((eventId) => index.events.get(eventId)).filter((event) => event && !index.readings?.has(event.id) && !String(event.description ?? '').trim());
  if (undescribed.length) ask('event-undescribed', `${undescribed.length} Event${undescribed.length === 1 ? '' : 's'} carrying Cuts ${undescribed.length === 1 ? 'has' : 'have'} no description (for example ${undescribed.slice(0, 3).map((event) => event.id).join(', ')}). What happens in each? Describe it, so its numbers mean something.`, 'life_model_revise');
  if (lives.length) {
    const personIds = new Set(lives.map((item) => item.id));
    for (const [referentId, eventIds] of index.eventsOf) {
      const referent = index.referents.get(referentId);
      if (personIds.has(referentId) || eventIds.length < 2 || !referent || referent.lifecycle_event_id) continue;
      ask('secondary-without-life', `${referentId} takes part in ${eventIds.length} Events but has no life. If it is a person: who are they, what do they want, and what happened to them? Give them a life. If it is a thing (a machine, a house, an institution, a document), how does it work: its parts, capacities, limits and failure modes, its history, and how does it constrain what people can do?`, 'life_profile_compile (person_scaffold or thing_scaffold), then life_model_revise');
    }
  }
  return questions;
}

const ORDER = ['author-separate', 'author-unlinked', 'life-missing', 'life-untimed', 'time-missing', 'processes-few', 'periods-missing', 'shocks-few', 'wants-missing', 'choices-missing', 'macro-missing', 'period-gap',
  'moment-unmodeled', 'decision-undrawn', 'remainder-unopened', 'shift-uncaused', 'adaptation-open', 'laws-missing', 'place-missing', 'process-unobserved', 'wants-generic', 'why-local',
  'concepts-thin', 'recurring-question', 'period-uncut', 'process-empty', 'secondary-without-life', 'life-thin', 'event-undescribed', 'weights-unestimated'];
// How many open questions come back with each model change, rebind and world record; life_model_questions gives all.
export const VISIBLE_QUESTIONS = 8;

// The author's life and the story in one model: what the author lived should be linked to what it shapes in the
// story, by relations between their Events (authorial shaping, distinct from causation inside the story world).
export function authorLinks(index, authorId) {
  const author = readPerson(index, authorId);
  if (!author.life) return null;
  const authorEvents = author.own;
  const storyEvents = new Set([...index.events.keys()].filter((eventId) => !authorEvents.has(eventId)));
  const relations = (index.relations ?? []).filter((relation) => relation.kind !== 'contains' && relation.kind !== 'about'
    && ((authorEvents.has(relation.source_event_id) && storyEvents.has(relation.target_event_id)) || (storyEvents.has(relation.source_event_id) && authorEvents.has(relation.target_event_id))));
  return { authorEvents, storyEvents, relations };
}

// The open questions of a model: for the named people (or every person the model scaffolds), then the world.
// What the agent sees first covers as many kinds as the limit allows, in priority order: the principals' different
// questions take at most half, then the world's, so nine questions of one kind cannot crowd out a world with no laws or
// no places. The counts, and life_model_questions, give all of them.
function visible(questions, limit) {
  const target = Math.min(limit, questions.length);
  const shown = []; const taken = new Set();
  const pass = (items, cap, repeat = false) => {
    const kinds = new Set(shown.map((item) => item.kind)); let added = 0;
    for (const item of items) {
      if (shown.length >= target || added >= cap) break;
      if (taken.has(item) || (!repeat && kinds.has(item.kind))) continue;
      kinds.add(item.kind); taken.add(item); shown.push(item); added += 1;
    }
    return added;
  };
  pass(questions.filter((item) => item.principal), Math.ceil(limit / 2));
  pass(questions.filter((item) => !item.principal), limit);
  pass(questions, limit);
  pass(questions, limit, true);
  return shown;
}

export function modelQuestions(model, { people = null, draws = null, limit = 12, focus = {}, author = null, sufficient = null } = {}) {
  const index = indexModel(model);
  const named = people ?? modeledPeople(index);
  const lives = named.map((item) => ({ ...item, name: item.name ?? displayName(item.id), read: readPerson(index, item.id) }));
  const own = lives.flatMap((item) => personQuestions(index, item.read, item.name, item.principal !== false));
  if (author && author.sameModel !== false) {
    const links = authorLinks(index, author.id);
    if (links && links.storyEvents.size && !links.relations.length) own.unshift({ kind: 'author-unlinked', subject: author.id, principal: true, tool: 'life_model_revise',
      question: `${author.name ?? displayName(author.id)}'s life and the story share this model, and nothing links them. What in the author's life shapes what in the story: which experience became which shock, which person became which character, which question became the book's? Link them with relations between their Events (authorial shaping, described as such, distinct from causation inside the story world), and put what you understand about both into Understanding Nodes linked to each.` });
  }
  // Secondary people's questions of one kind become one question naming them all, so the principals come first.
  const grouped = new Map();
  for (const item of own.filter((entry) => !entry.principal)) push(grouped, item.kind, item);
  const secondary = [...grouped.values()].map((list) => (list.length === 1 ? list[0] : { ...list[0], subject: list.map((item) => item.subject),
    question: `${list.length} secondary people share this question (${list.map((item) => displayName(item.subject)).join(', ')}): ${list[0].question}` }));
  const asked = [...own.filter((entry) => entry.principal), ...secondary, ...worldQuestions(index, lives, draws)];
  // A question the modeler has judged sufficient here is not asked again while that judgment stands.
  const questions = sufficient ? asked.filter((item) => !sufficient.covers(item)) : asked;
  questions.sort((a, b) => Number(b.principal) - Number(a.principal) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const counts = questions.reduce((all, item) => ({ ...all, [item.kind]: (all[item.kind] ?? 0) + 1 }), {});
  const sufficiencyNotes = [];
  let noteBytes = 0;
  for (const note of sufficient?.notes ?? []) {
    if (sufficiencyNotes.length >= Math.min(16, Math.max(1, limit))) break;
    const bytes = Buffer.byteLength(JSON.stringify(note));
    if (noteBytes + bytes > 32 * 1024) continue;
    sufficiencyNotes.push(note);
    noteBytes += bytes;
  }
  const omittedNotes = (sufficient?.notes?.length ?? 0) - sufficiencyNotes.length;
  const depth = { events: index.events.size, processes: index.processes, cuts: index.cuts.length, ...index.abstractions,
    people: lives.map((item) => ({ id: item.id, name: item.name ?? item.id, life: Boolean(item.read.life), processes: item.read.processes.length,
      processesOpened: item.read.processes.filter((process) => process.opened > 0).length, periods: item.read.periods.length,
      shocks: item.read.arcs.length, cuts: item.read.cuts.length })) };
  return { schema: 'meaning-model-open-questions/v1', total: questions.length, counts, depth, questions: visible(questions, limit), alwaysAsk: standingQuestions(focus),
    ...(sufficient && asked.length > questions.length ? { sufficientHere: asked.length - questions.length } : {}),
    ...(sufficient?.notes?.length ? { sufficiencyNotes } : {}),
    ...(omittedNotes ? { sufficiencyNotesOmitted: omittedNotes } : {}),
    sufficientHow: `A question that needs no more here is answered by saying so: record an Understanding Node about the records it concerns, with data { schema: ${SUFFICIENT_SCHEMA}, kind, reason, reopenIf }, or about the story's root for every question of that kind. This suppresses repeated reminders, not recursive exploration. Read the returned sufficiencyNotes when new discoveries touch their subjects; reopenIf is a condition for the calling LLM to judge, not an automatically evaluated rule. A fresh question or connection can reopen the subject. Record the new understanding with a supersedes link to the old note so its suppression ends.`,
    guidance: 'The loop: find the areas worth investigating, go deeper inside the model, put your understanding inside the model, then loop again and let what the model holds lead you down different paths. These are the model\'s own open questions, read from its structure. The model is a language and none of its constructs is mandatory: the questions read common ones (a lifecycle Event, periods, change arcs, Cut units), so where you expressed the same understanding your own way a question may not see it; say so in the record and move on. Answer the rest by adding structure, in whatever form understands best, then ask again: every answer raises new questions, and there is no depth at which the model is finished. Take at least one between every step of the work.' };
}

// A person's state at a moment, read from the model: their sense of time at that point.
export function personStateAt(model, personId, t, { draws = [] } = {}) {
  const index = indexModel(model);
  const person = readPerson(index, personId);
  const contains = (event) => start(event) !== null && start(event) <= t && (end(event) ?? start(event)) >= t;
  const latest = new Map();
  for (const item of person.cuts) {
    if (start(item.event) === null || start(item.event) > t || cutKind(item.cut) === 'decision') continue;
    const key = `${item.cut.question}|${item.cut.unit}`;
    if (!latest.has(key) || start(latest.get(key).event) <= start(item.event)) latest.set(key, item);
  }
  // Without the story graph the draws are unknown: which decisions were drawn by this time cannot be said, and saying
  // none were would be a claim the model does not make.
  const known = Array.isArray(draws);
  const drawnBy = new Map((known ? draws : []).map((item) => [item.cutId, item]));
  const decisions = person.cuts.filter((item) => cutKind(item.cut) === 'decision');
  return {
    personId, time: t,
    life: person.life ? { eventId: person.life.id, start: start(person.life), end: end(person.life), age: start(person.life) === null ? null : t - start(person.life) } : null,
    periods: person.periods.filter(contains).map((event) => ({ eventId: event.id, what: describe(event), start: start(event), end: end(event) })),
    latest: [...latest.values()].map((item) => ({ cutId: item.cut.id, kind: cutKind(item.cut), question: item.cut.question, at: start(item.event),
      answers: answersOf(item.cut).slice().sort((x, y) => y.weight - x.weight).slice(0, 4) })),
    adapting: person.arcs.filter((item) => start(item.focal ?? item.arc) !== null && start(item.focal ?? item.arc) <= t
      && (end(item.adaptation ?? item.arc) ?? Infinity) >= t).map((item) => ({ arcEventId: item.arcEventId, shock: describe(item.focal ?? item.arc), since: start(item.focal ?? item.arc) })),
    ...(known ? {
      decided: decisions.filter((item) => start(item.event) !== null && start(item.event) <= t && drawnBy.has(item.cut.id))
        .map((item) => ({ cutId: item.cut.id, question: item.cut.question, realized: drawnBy.get(item.cut.id).realized ?? null })),
      undecided: decisions.filter((item) => !drawnBy.has(item.cut.id) && (start(item.event) === null || start(item.event) >= t))
        .map((item) => ({ cutId: item.cut.id, question: item.cut.question, at: start(item.event) })),
      undrawnBefore: decisions.filter((item) => !drawnBy.has(item.cut.id) && start(item.event) !== null && start(item.event) < t)
        .map((item) => ({ cutId: item.cut.id, question: item.cut.question, at: start(item.event) })),
    } : {
      drawHistory: 'unknown', decided: null, undecided: null, undrawnBefore: null,
      decisions: decisions.map((item) => ({ cutId: item.cut.id, question: item.cut.question, at: start(item.event) })),
      drawNote: 'Draws live in the story graph, which this request did not name, so which of these decisions were drawn by this time is unknown. Pass graphHash to know.',
    }),
  };
}

// Questions the agent asks itself at every step, about whatever it is working on. The model's structure cannot
// raise them; only asking can, and only modeling answers them.
export function standingQuestions(focus = {}) {
  const story = storyProfile();
  const subjects = [focus.event ? `this event (${focus.event})` : null, focus.scene ? `this scene (${focus.scene})` : null,
    ...(focus.people ?? []).map((name) => `this character (${name})`)].filter(Boolean);
  const about = subjects.length ? subjects.join(', ') : 'what you are working on';
  return [
    `How can you understand ${about} better, using the model? Whatever the object of investigation is (a character, an object, a concept, an era, whatever the work is about), go deeper by modeling more: its history, its parts and processes over time, what it depends on and what depends on it, and what it is an instance of.`,
    `List all the aspects of ${about} you could understand better (for a story: the characters' choices, the author's writing and style, each voice, the technology, the time period, places, institutions, relationships, money, bodies, beliefs; for a market: its participants, instruments, rules, regimes, technology, history), then investigate by modeling: read the existing evidence, create or refine processes and relationships, open sub-processes, try another decomposition, and follow earlier causes and later consequences. Name useful concepts and model how Things work. Let each discovery lead recursively to new questions and openings, including when nothing is known to be wrong; choose the depth and direction for what they reveal. Numerical Cuts and trajectories are optional: first declare a meaningful comparison, unit and supported resolution. Sample only unresolved values or fictional continuations within delegated uncertainty; preserve accepted outcomes and never reroll canon.`,
    `Is there a macro aspect you must model to truly understand what is going on in ${about}? It could be something from a character's childhood or a war a hundred years ago; you will not know unless you model it. Follow the causes back along the lives and the world's long processes, and model what you find.`,
    ...(story ? [`What reasons and circumstances explain what ${focus.people?.length ? focus.people.join(', ') : `the people acting in ${about}`} do${focus.people?.length === 1 ? 'es' : ''}? Fear or love is an optional lens alongside other questions about duty, habit, curiosity, knowledge, relationships and material constraints. Use it if useful to this situation, distinguish the person's own account from other readings, and leave room for motives it does not express. Do not classify every act into fear or love or require numerical shares; first explain how the relevant reasons bear on the choice and its consequences.`] : []),
    story ? `Which ways of seeing could explain ${about}? Fear or love is one optional lens; there are many more (how people grow, bond and barter, what they believe they are owed, what the body, the purse, an era or an institution allows), in thinkers, traditions and disciplines, and ones no one has named. Define the ones that would change the model with life_lens_define, with an explicit question and scope; life_lens_questions asks each of records declared applicable, which does not establish that it fits them.`
      : `Which ways of seeing could explain ${about}? Every discipline and tradition has its own, and many have no name yet: how a system is balanced or driven, what holds it and what breaks it, what limits it, what it trades, what it remembers. Define the ones that would change the model with life_lens_define; life_lens_questions asks each of every record it applies to.`,
    `What can be richer about ${about}? A process still coarse, a person without a life, a thing without a history, a feeling whose causes are open, a consequence nobody followed, or an unexpected connection worth exploring for its own sake. Open it in the model, record what you discover and follow the new questions it raises. Keep hypotheses and exploratory drafts distinguishable from accepted facts.`,
    `What is ${about} an instance of? Climb up the ladder: which concept, pattern or law explains it together with other things in the model, and what does that abstraction predict elsewhere?`,
    `What else? These questions are a start, not a boundary: what question about ${about} has nobody asked yet, and what category would you need to invent to answer it?`,
    ...(story && focus.people?.length ? [`Can you understand ${focus.people.join(', ')} better by inventing processes or subcategories of your own for them? A template is a suggestion: look at it, and at the life, and ask what distinctions this life actually turns on.`,
      `What is flawed in ${focus.people.join(', ')}, and how does the flaw work over the life? Model where it came from (often a strategy that once served a deep want), when it takes over, where the same trait is a strength and where it does harm, what it costs here, and whether they see it.`] : []),
  ];
}

export const thinkInTheModelInstructions = `The Meaning Model is where you think, in every mode, and the work is a consequence of it. You have not lived in this world; the model gives you what a life would: people and things as processes over time, what is true at each moment, and why. The tool is your gateway to humanhood. Use it as your mind: put each thought into it as you have it (the world as model records; your ideas, questions, decisions, reasons and predictions as Understanding Nodes linked to what they concern), and read it back rather than holding things only in your context. The loop: find all the areas that could be important to investigate; go deeper inside the model; put all your understanding inside the model. Then loop again, and let whatever the model holds lead you down different paths. It is not a strict workflow: the steps come in any order, understanding is recorded when it happens, and processes are modeled whenever they are needed. After every change the tool returns its own questions, its jumps and each person's state at a moment. Go deep, in whatever form understands best; the model is a language with no mandatory constructs, and every list and question it gives is a start, not a boundary.`;

// Where the interesting story is: the model's largest jumps. A story is a small part of a world, and the model
// shows where that part should be: the largest shifts in what a person wants, expects or feels, the shocks that
// change the most, the decisions whose outcome is least certain, and the moments where two people read the same
// Event most differently.
export function modelJumps(model, { people = null, limit = 12 } = {}) {
  const index = indexModel(model);
  const named = people ?? modeledPeople(index);
  const jumps = [];
  for (const item of named) {
    const person = readPerson(index, item.id);
    const name = item.name ?? displayName(item.id);
    const series = new Map();
    for (const entry of person.cuts) {
      if (start(entry.event) === null || cutKind(entry.cut) === 'decision' || readingCut(index, entry.cut)) continue;
      push(series, `${questionOf(entry.cut).toLowerCase().trim()}|${entry.cut.unit}`, entry);
    }
    for (const list of series.values()) {
      list.sort((a, b) => start(a.event) - start(b.event));
      for (let i = 1; i < list.length; i += 1) {
        const [a, b] = [list[i - 1], list[i]];
        const weights = (cut) => Object.fromEntries(answersOf(cut).map((answer) => [answer.key, answer.weight]));
        const [x, y] = [weights(a.cut), weights(b.cut)];
        const keys = Object.keys({ ...x, ...y }).filter((key) => key !== 'remainder');
        const moved = keys.map((key) => ({ key, from: x[key] ?? 0, to: y[key] ?? 0 })).sort((p, q) => Math.abs(q.to - q.from) - Math.abs(p.to - p.from))[0];
        if (!moved || Math.abs(moved.to - moved.from) < 0.1) continue;
        jumps.push({ kind: 'shift', size: Math.abs(moved.to - moved.from), subject: item.id, at: [start(a.event), start(b.event)], eventIds: [a.event.id, b.event.id],
          what: `${name}'s "${a.cut.question}" moves ${moved.key} from ${moved.from.toFixed(2)} to ${moved.to.toFixed(2)}.` });
      }
    }
    for (const arc of person.arcs) {
      const reach = arc.adaptation ? descendants(index, arc.adaptation.id).size + (index.cutsByEvent.get(arc.adaptation.id) ?? []).length : 0;
      jumps.push({ kind: 'shock', size: 0.3 + Math.min(0.6, reach * 0.05), subject: item.id, at: [start(arc.focal ?? arc.arc), end(arc.adaptation ?? arc.arc)],
        eventIds: [arc.arcEventId], what: `${name}'s shock: ${describe(arc.focal ?? arc.arc)} (its adaptation reaches ${reach} records).` });
    }
  }
  for (const cut of index.cuts.filter((item) => cutKind(item) === 'decision')) {
    const named = answersOf(cut).filter((answer) => answer.key !== 'remainder').sort((a, b) => b.weight - a.weight);
    if (named.length < 2) continue;
    const closeness = 1 - (named[0].weight - named[1].weight);
    jumps.push({ kind: 'decision', size: closeness * 0.8, subject: cut.id, at: [start(index.events.get(cut.parent_event_id)), end(index.events.get(cut.parent_event_id))],
      eventIds: [cut.parent_event_id], what: `"${cut.question}": ${named[0].key} ${named[0].weight.toFixed(2)} against ${named[1].key} ${named[1].weight.toFixed(2)}.` });
  }
  // Divergent readings: the same question asked of different people at one Event.
  for (const [eventId, cuts] of index.cutsByEvent) {
    const byQuestion = new Map();
    for (const cut of cuts) push(byQuestion, `${cut.question}|${cut.unit}`, cut);
    for (const list of byQuestion.values()) {
      if (list.length < 2) continue;
      const distance = (p, q) => Object.keys(Object.fromEntries([...answersOf(p), ...answersOf(q)].map((answer) => [answer.key, 1])))
        .reduce((sum, key) => sum + Math.abs((answersOf(p).find((answer) => answer.key === key)?.weight ?? 0) - (answersOf(q).find((answer) => answer.key === key)?.weight ?? 0)), 0) / 2;
      const pairs = list.flatMap((p, i) => list.slice(i + 1).map((q) => [p, q, distance(p, q)])).sort((a, b) => b[2] - a[2]);
      if (pairs[0][2] >= 0.2) jumps.push({ kind: 'divergence', size: pairs[0][2], subject: eventId, at: [start(index.events.get(eventId)), end(index.events.get(eventId))],
        eventIds: [eventId], what: `At ${describe(index.events.get(eventId))}, "${pairs[0][0].question}" is read differently (${pairs[0][0].id} against ${pairs[0][1].id}).` });
    }
  }
  jumps.sort((a, b) => b.size - a.size);
  return { schema: 'meaning-model-jumps/v1', total: jumps.length, jumps: jumps.slice(0, limit),
    guidance: 'The story is a consequence of the model: render the parts of the world where the model jumps. A route that misses the largest jumps should say why the story is elsewhere.' };
}

// Decisions drawn and recorded in a graph, as { cutId, realized }.
export function readDraws(view) {
  return (view?.nodes ?? []).filter((node) => node.node_type === 'direction_draw').map((node) => {
    try { const draw = JSON.parse(node.text); return draw?.cutId ? { cutId: draw.cutId, realized: draw.realized ?? null } : null; } catch { return null; }
  }).filter(Boolean);
}

// Everything a caller needs to keep thinking in the model: its open questions, its jumps, and, at a moment, the
// state of each person.
// A question answered "sufficient here": an Understanding Node with data { schema: meaning-model-sufficient/v1, kind,
// reason, reopenIf }, about the records the question concerns, or about a document root for every question of the kind.
export const SUFFICIENT_SCHEMA = 'meaning-model-sufficient/v1';
export function readSufficientHere(view) {
  // A note covers every question of its kind only when it says so, by being about a document root. A note about records
  // covers questions about those records, and lapses when they are gone rather than spreading to the whole kind.
  const roots = new Set([...(view?.roots ?? []), ...(view?.nodes ?? []).filter((node) => node.role === 'document_root').map((node) => node.id)]);
  const visible = new Set((view?.nodes ?? []).map((node) => node.id));
  const superseded = new Set((view?.edges ?? []).filter((edge) => edge.relation === 'supersedes'
    && edge.source?.kind === 'node' && visible.has(edge.source.node_id) && edge.target?.kind === 'node')
    .map((edge) => edge.target.node_id));
  const about = new Map();
  for (const edge of view?.edges ?? []) if (edge.source?.kind === 'node' && edge.relation === 'about') {
    if (!about.has(edge.source.node_id)) about.set(edge.source.node_id, { records: [], nodes: [] });
    const entry = about.get(edge.source.node_id);
    if (edge.target?.kind === 'anchor') entry.records.push(edge.target.anchor_id); else if (edge.target?.kind === 'node') entry.nodes.push(edge.target.node_id);
  }
  const stops = [];
  for (const node of view?.nodes ?? []) {
    if (superseded.has(node.id) || !String(node.node_type ?? '').startsWith('understanding.')) continue;
    let data = null; try { data = JSON.parse(node.text)?.data; } catch { continue; }
    if (data?.schema !== SUFFICIENT_SCHEMA || !data.kind) continue;
    const { records = [], nodes = [] } = about.get(node.id) ?? {};
    stops.push({ nodeId: node.id, kind: data.kind, records: new Set(records), aboutNodeIds: nodes,
      reason: data.reason ?? null, reopenIf: data.reopenIf ?? null,
      writtenAgainstModel: (node.provenance ?? []).find((item) => String(item).startsWith('written-against-model:'))?.slice(22) ?? null,
      everywhere: nodes.some((nodeId) => roots.has(nodeId)) });
  }
  const idsOf = (item) => [item.subject, item.cutId, item.eventId, ...(item.cuts ?? []), ...(item.eventIds ?? []), ...(item.processes ?? []), ...(item.referents ?? [])].flat().filter((value) => typeof value === 'string');
  return { count: stops.length,
    notes: stops.map(({ records, ...note }) => ({ ...note, records: [...records] })),
    covers: (item) => stops.some((stop) => stop.kind === item.kind
      && ((stop.everywhere && (!item.storyRootId || stop.aboutNodeIds.includes(item.storyRootId)))
        || idsOf(item).some((value) => stop.records.has(value)))) };
}

// Document roots can hold metadata (including a transferred life model) as well
// as stories. Follow visible structural prose, stopping at another document root,
// so one work's author declaration cannot silently cover its sibling work.
function visibleStoryRoots(view) {
  const nodes = new Map((view?.nodes ?? []).map((node) => [node.id, node]));
  const roots = [...nodes.values()].filter((node) => node.role === 'document_root').map((node) => node.id);
  const rootIds = new Set(roots); const children = new Map();
  for (const edge of view?.edges ?? []) if (edge.family === 'structural' && ['contains', 'next'].includes(edge.relation)
    && edge.source?.kind === 'node' && edge.target?.kind === 'node' && nodes.has(edge.source.node_id) && nodes.has(edge.target.node_id)) {
    push(children, edge.source.node_id, edge.target.node_id);
  }
  const stories = new Set();
  for (const root of roots) {
    const pending = [root]; const seen = new Set();
    for (let index = 0; index < pending.length; index++) {
      const nodeId = pending[index]; if (seen.has(nodeId) || (nodeId !== root && rootIds.has(nodeId))) continue;
      seen.add(nodeId);
      if (nodes.get(nodeId)?.role === 'story_passage') { stories.add(root); break; }
      pending.push(...(children.get(nodeId) ?? []));
    }
  }
  return stories;
}

export async function readOpenQuestions(service, { modelHash, people = null, at = null, focus = {}, graphHash = null, accessScopes = [], limit = 16, author = null }) {
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  let draws = null;
  let view = null;
  if (graphHash) {
    view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(accessScopes)].sort() });
    draws = readDraws(view);
  }
  const named = people ?? modeledPeople(indexModel(model));
  const sufficient = view ? readSufficientHere(view) : null;
  // Reopening saved work must discover its declared author, not rely on the
  // calling agent remembering to resupply that author as an optional argument.
  const storyRoots = visibleStoryRoots(view);
  const declaredAuthors = new Map();
  if (view && storyProfile()) {
    const { readWorldState } = await import('./storytelling-world.mjs');
    const roots = new Set(view.nodes.filter((node) => node.role === 'document_root').map((node) => node.id));
    for (const root of roots) {
      const record = readWorldState(view, root).authorReader;
      const value = record?.data?.author;
      if (value) declaredAuthors.set(root, { id: value.personId, name: value.name, lifeModelHash: value.lifeModelHash,
        storyRootId: root, nodeId: record.node.id });
    }
  }
  const matchedRoots = author ? [...declaredAuthors].filter(([, declared]) => declared.id === author.id
    && (!author.lifeModelHash || declared.lifeModelHash === author.lifeModelHash)).map(([root]) => root) : [];
  const explicitRoots = matchedRoots.length ? matchedRoots : storyRoots.size === 1 ? [...storyRoots] : [];
  const authors = author ? (explicitRoots.length ? explicitRoots.map((root) => ({ ...author, storyRootId: root })) : [author]) : [...declaredAuthors.values()];
  const declaredRootIds = new Set([...declaredAuthors.keys(), ...(author ? explicitRoots : [])]);
  const soleAuthor = authors.length === 1 && storyRoots.size <= 1 ? authors[0] : null;
  const questions = modelQuestions(model, { people: named, draws, limit, focus,
    author: soleAuthor ? { ...soleAuthor, sameModel: soleAuthor.lifeModelHash ? soleAuthor.lifeModelHash === modelHash : soleAuthor.sameModel } : null, sufficient });
  const addQuestion = (item) => {
    if (sufficient?.covers(item)) return;
    questions.questions.unshift(item);
    questions.total += 1;
    questions.counts[item.kind] = (questions.counts[item.kind] ?? 0) + 1;
    questions.questions.length = Math.min(questions.questions.length, limit);
  };
  if (view && storyProfile()) for (const root of storyRoots) if (!declaredRootIds.has(root)) {
    addQuestion({ kind: 'author-life-unrecorded', subject: null, storyRootId: root, principal: true,
      tool: 'life_narrative_query, life_story_world_record',
      question: `No author-and-life declaration is visible for story ${root}. Read its existing authoring notes and complete authorized graph before deciding what is absent. Who is writing it, at what point in their life, and why now? Reuse an established author model or develop a clearly fictional persona when delegated; never invent the real user's life. Connect relevant experience to actual writing choices through Understanding Nodes. An explicitly omitted author model or a bounded edit can be sufficient here; record that limit and when to revisit it.` });
  }
  if (questions.sufficiencyNotesOmitted) questions.sufficiencyNotesRead = {
    tool: 'life_narrative_query', arguments: { graphHash, expectedGraphHash: graphHash, mode: 'skeleton', includeContent: false, accessScopes: [...new Set(accessScopes)].sort() },
    next: 'Inspect visible understanding.* nodes with life_narrative_query, mode neighborhood, centerNodeId set to the chosen node, depth 0 and includeContent true, keeping the same graphHash and accessScopes. Sufficiency payloads use data.schema meaning-model-sufficient/v1; read their complete reasons, reopenIf conditions and about/supersedes links. Inline notes are limited by count and bytes, never excerpted.',
  };
  // Lenses keep up to two places among the questions asked: readings still on their records first, then records unanswered.
  if (view) {
    const { lensOpenQuestions } = await import('./lenses.mjs');
    const asked = lensOpenQuestions(view, model).slice(0, 2);
    if (asked.length) {
      questions.total += asked.length; questions.counts = { ...(questions.counts ?? {}) };
      for (const item of asked) questions.counts[item.kind] = (questions.counts[item.kind] ?? 0) + 1;
      questions.questions = [...questions.questions.slice(0, Math.max(0, limit - asked.length)), ...asked];
    }
  }
  // Understanding that holds the author and the story together: a note linked to a record of the author's life and to
  // a record of the story. The author's life may share this model or be a model of its own, reached through reference
  // nodes to any revision of it (matched by model id, since the life keeps being revised).
  const authorLives = [];
  for (const author of view ? authors : []) {
    const separate = author.lifeModelHash && author.lifeModelHash !== modelHash;
    const authorEvents = separate ? new Set() : (authorLinks(indexModel(model), author.id)?.authorEvents ?? new Set());
    let authorModelId = null;
    if (separate) {
      const inspected = await service.inspectModel({ modelHash: author.lifeModelHash, includeDefinition: true }).catch(() => null);
      authorModelId = inspected?.model?.id ?? null;
      authorLives.push({ ...author, available: Boolean(inspected?.model),
        ...(inspected?.model ? { inspect: { tool: 'life_model_inspect', arguments: { modelHash: author.lifeModelHash, includeDefinition: true } } } : {}) });
      if (!inspected?.model) {
        addQuestion({ kind: 'author-life-unavailable', subject: author.id, storyRootId: author.storyRootId, principal: true, tool: 'life_construction_import',
          question: `${author.name ?? author.id}'s declared life model (${author.lifeModelHash}) cannot be read in this installation. Recover or import that exact model and its history before assessing how the life shapes the story. A voice summary or reference is not the life itself; do not silently replace it with a new invented biography.` });
        continue;
      }
    } else authorLives.push({ ...author, available: Boolean(indexModel(model).referents.has(author.id)), lifeModelHash: modelHash });
    const authorReferenceIds = new Set(separate ? (view.nodes ?? []).filter((node) => node.node_type === 'model_reference' && (() => {
      try { const data = JSON.parse(node.text); return data.modelHash === author.lifeModelHash || (authorModelId && data.modelId === authorModelId); } catch { return false; } })()).map((node) => node.id) : []);
    const isAuthorAnchor = (target) => !separate && ((target.anchor_kind === 'event' && authorEvents.has(target.anchor_id)) || (target.anchor_kind === 'referent' && target.anchor_id === author.id));
    const anchored = new Map();
    const mark = (nodeId, side) => anchored.set(nodeId, new Set([...(anchored.get(nodeId) ?? []), side]));
    for (const edge of view.edges ?? []) {
      if (edge.source?.kind !== 'node') continue;
      if (edge.target?.kind === 'node' && authorReferenceIds.has(edge.target.node_id)) mark(edge.source.node_id, 'author');
      else if (edge.target?.kind === 'anchor') mark(edge.source.node_id, isAuthorAnchor(edge.target) ? 'author' : 'story');
    }
    if (![...anchored.values()].some((sides) => sides.size === 2)) {
      addQuestion({ kind: 'understanding-unjoined', subject: author.id, storyRootId: author.storyRootId, principal: true, tool: 'life_understanding_record, life_story_author_record',
        question: `No note yet holds the author and the story together. Where does the author's life meet the story? A note does when it is about a record of the author's life${separate ? ' (an about target with the life model\'s modelHash)' : ''} and a record of the story: a character, an Event, a process or a Cut.` });
    }
  }
  // The model as the agent's mind: a model that keeps changing while its record holds few thoughts means the thinking
  // is happening somewhere else.
  if (view) {
    const thoughts = view.nodes.filter((node) => node.role === 'externalized_reflection').length;
    const revisions = model?.revision?.number ?? 0;
    if (revisions >= 1 && thoughts < revisions * 2) {
      questions.questions.unshift({ kind: 'understanding-outside', subject: null, principal: false, tool: 'life_understanding_record, life_story_author_record, life_understanding_read',
        question: `The model has changed ${revisions} time${revisions === 1 ? '' : 's'} and its record holds ${thoughts} thought${thoughts === 1 ? '' : 's'}. Where is your understanding? Use the model as your mind: put each thought into it as you have it (ideas, questions, decisions and their reasons, predictions, what you expect), linked to what it concerns, and read it back instead of keeping it in your context.` });
      questions.total += 1;
      questions.counts['understanding-outside'] = 1;
      questions.questions.length = Math.min(questions.questions.length, limit);
    }
  }
  const jumps = modelJumps(model, { people: named, limit: 8 });
  const states = at === null ? [] : named.filter((person) => person.principal !== false).map((person) => ({ name: person.name ?? displayName(person.id), ...personStateAt(model, person.id, at, { draws }) }));
  return { ...questions, modelHash, jumps: jumps.jumps, states, ...(view && storyProfile() ? { authorLives } : {}) };
}

// A compact copy of the open questions for the result of any tool that changed a model.
export async function withOpenQuestions(service, result, { modelHash = result?.modelHash ?? null, limit = VISIBLE_QUESTIONS, focus = {} } = {}) {
  if (!modelHash) return result;
  try {
    const { total, counts, depth, questions, alwaysAsk, guidance } = await readOpenQuestions(service, { modelHash, limit, focus });
    return { ...result, openQuestions: { total, counts, depth, questions, alwaysAsk, guidance, more: 'life_model_questions returns all of them, the model\'s jumps, and each person\'s state at a moment.' } };
  } catch {
    return result;
  }
}
