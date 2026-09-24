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
// A Cut answer may drift by up to this much between consecutive moments; a larger shift needs a cause between them.
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
  if (unit.includes('fulfillment')) return 'outlook';
  if (/deciding|framing|problem-solving/u.test(unit)) return 'how';
  if (unit.includes('health')) return 'health';
  return 'other';
};
const questionOf = (cut) => String(cut.question ?? cut.id ?? '');
const answersOf = (cut) => cut.answers ?? [];
const estimated = (cut) => (cut.provenance ?? []).some((item) => /^(estimator|supplied):/u.test(String(item)));

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
  const abstractions = { concepts: (mm.concepts ?? []).length, abstractRelations: (mm.abstract_relations ?? []).length, abstractCuts: (mm.abstract_cuts ?? []).length,
    laws: (model?.laws ?? []).length, claims: (model?.initial_claims ?? []).length, realizations: (mm.realizations ?? []).length };
  return { events, children, parents, cuts, cutsByEvent, referents, eventsOf, arcsOf, abstractions, processes: (model?.processes ?? []).length };
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

// Consecutive Cuts asking the same question must be consistent in time: a large shift needs a cause between them.
function uncausedShifts(series, causes, subjectLabel) {
  const found = [];
  for (const list of series.values()) {
    list.sort((a, b) => start(a.event) - start(b.event));
    for (let i = 1; i < list.length; i += 1) {
      const [before, after] = [list[i - 1], list[i]];
      const weights = (cut) => Object.fromEntries(answersOf(cut).map((answer) => [answer.key, answer.weight]));
      const [a, b] = [weights(before.cut), weights(after.cut)];
      const moved = Object.keys({ ...a, ...b }).filter((key) => Math.abs((b[key] ?? 0) - (a[key] ?? 0)) > MAX_UNCAUSED_SHIFT + 1e-9);
      if (!moved.length || causes.some((time) => time > start(before.event) && time <= start(after.event))) continue;
      const key = moved[0];
      found.push({ at: [start(before.event), start(after.event)], cuts: [before.cut.id, after.cut.id],
        question: `${subjectLabel}"${before.cut.question}" moves ${key} from ${(a[key] ?? 0).toFixed(2)} to ${(b[key] ?? 0).toFixed(2)} between ${start(before.event)} and ${start(after.event)}, with nothing modeled between them to cause it. What happened? Model the cause and what followed from it, or make the change gradual across more moments.` });
    }
  }
  return found;
}

// A person's open questions, most structural first.
function personQuestions(index, person, name, principal) {
  const questions = [];
  const ask = (kind, question, tool, extra = {}) => questions.push({ kind, subject: person.personId, principal, question, tool, ...extra });
  if (!person.referent) {
    ask('life-missing', `${name} is not in the model. Who are they? Give them a referent and a whole life, from the person template (person_scaffold) or from processes of your own.`, 'life_profile_compile (person_scaffold) or life_model_revise');
    return questions;
  }
  if (!person.life) {
    ask('life-missing', `${name} has no life in the model, only a name. Give them a lifecycle Event over their whole life, from birth to death or to now, holding the processes their life runs through: the person template (person_scaffold) is one starting point, processes of your own another.`, 'life_profile_compile (person_scaffold) or life_model_revise');
    return questions;
  }
  if (person.lifeLength === null) ask('life-untimed', `${name}'s life has no interval. When were they born, and when does the life end or the work leave it? Without time the model cannot keep their states consistent.`, 'life_model_revise');
  if (person.processes.length < 3) ask('processes-few', `${name}'s life runs through ${person.processes.length} process${person.processes.length === 1 ? '' : 'es'}. How can you understand ${name} better? The person template suggests nine slow processes (body, kin, partnership, work, place, means, knowledge, standing, meaning); processes invented for ${name}, or subcategories of either, may explain more. Look at the template and at ${name}'s life, and choose what explains them most deeply.`, 'life_profile_compile (person_scaffold) or your own processes, then life_model_revise');
  const empty = person.processes.filter((item) => item.opened === 0).map((item) => item.eventId.match(/\.is\.([a-z]+)$/u)?.[1] ?? item.what);
  if (empty.length) ask('process-empty', `${name}'s ${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} empty. What happened in each over their life: which episodes, shocks and changes, and when? Open the ones the causality runs through into Events and Cuts, or into subcategories of your own if they understand ${name} better.`, 'life_model_revise', { processes: empty });
  if (!person.periods.length) {
    ask('periods-missing', `What were the periods of ${name}'s life, from birth to its end? The model shows none. One way: contain each in the life Event with an interval, together covering the life.`, 'life_model_revise');
  } else if (start(person.life) !== null) {
    let cursor = start(person.life);
    const tolerance = (person.lifeLength ?? 0) * 0.02;
    for (const period of person.periods) {
      if (start(period) - cursor > tolerance) ask('period-gap', `${name}'s life has no period from ${cursor} to ${start(period)}. What was their life then?`, 'life_model_revise', { at: [cursor, start(period)] });
      cursor = Math.max(cursor, end(period));
    }
    if (end(person.life) !== null && end(person.life) - cursor > tolerance) ask('period-gap', `${name}'s life has no period from ${cursor} to ${end(person.life)}. What was their life then?`, 'life_model_revise', { at: [cursor, end(person.life)] });
    for (const period of person.periods) {
      const inside = [period.id, ...descendants(index, period.id)];
      if (!inside.some((eventId) => (index.cutsByEvent.get(eventId) ?? []).length)) {
        ask('period-uncut', `In ${name}'s period "${describe(period)}" (${when(period)}), how did they expect what they want to turn out, and what was at risk? Give the period its outlook Cut and, conditional on threat, a Cut over what was threatened.`, 'life_model_revise or life_estimate_cut_shares', { at: [start(period), end(period)] });
      }
    }
  }
  const wantCuts = person.cuts.filter((item) => cutKind(item.cut) === 'wants');
  if (!wantCuts.length) {
    ask('wants-missing', `What does ${name} most deeply want, and which learned wants has their life taught them as ways to get it? Nothing in the model says. Model the wants, and give their key moments a Cut of motivational attention over them.`, 'life_model_revise');
  } else if (wantCuts.every((item) => answersOf(item.cut).every((answer) => SHARED_WANTS.has(answer.key)))) {
    ask('wants-generic', `${name}'s wants are only the shared vocabulary (belonging, competence, autonomy, understanding, well-being). What does ${name} in particular most deeply want, which learned want has become a proxy for it, and where do two of them conflict?`, 'life_model_revise');
  }
  if (person.arcs.length < 2) {
    ask('shocks-few', `What shocks did ${name}'s life contain, in the body, work, kin or one conversation, how did they anticipate each, and how did they adapt? The model shows ${person.arcs.length} as change arcs. One way is a change arc per shock (change_arc_scaffold), with an adaptation that changes the processes of the life.`, 'life_profile_compile (change_arc_scaffold) or your own structure, then life_model_revise');
  }
  for (const item of person.arcs) {
    if (!item.adaptation) continue;
    if (!(descendants(index, item.adaptation.id).size + (index.cutsByEvent.get(item.adaptation.id) ?? []).length)) {
      ask('adaptation-open', `How did ${name} adapt after "${describe(item.arc)}" (${when(item.focal ?? item.arc)})? What changed in their other processes, what they want, believe and do, and did it recover or become a new baseline? Open the adaptation.`, 'life_model_revise', { at: [start(item.focal ?? item.arc), end(item.adaptation)] });
    }
  }
  const series = new Map();
  for (const item of person.cuts) {
    if (start(item.event) === null || cutKind(item.cut) === 'decision') continue;
    push(series, `${questionOf(item.cut).toLowerCase().trim()}|${item.cut.unit}`, item);
  }
  const shocksAt = person.arcs.map((item) => start(item.focal ?? item.arc)).filter((value) => value !== null);
  for (const shift of uncausedShifts(series, shocksAt, `${name}'s `)) ask('shift-uncaused', shift.question, 'life_model_revise', { at: shift.at, cuts: shift.cuts });
  // A decision is a moment: what the person wants, feels and how they decide should be modeled there first.
  for (const item of person.cuts.filter((entry) => cutKind(entry.cut) === 'decision')) {
    const t = start(item.event);
    const around = person.cuts.filter((entry) => entry !== item && ['wants', 'feels', 'how'].includes(cutKind(entry.cut))
      && start(entry.event) !== null && t !== null && Math.abs(start(entry.event) - t) <= Math.max(1, (end(item.event) ?? t) - t));
    if (!around.length) ask('moment-unmodeled', `At "${describe(item.event)}" (${when(item.event)}), before ${name} decides "${item.cut.question}": what do they want, what do they feel, and how do they decide? Give the moment those Cuts, so the decision's weights come from them.`, 'life_model_revise or life_estimate_cut_shares', { at: [t, end(item.event)], cuts: [item.cut.id] });
    const outside = [...ancestors(index, item.event.id)].filter((eventId) => !person.own.has(eventId));
    if (!outside.length) ask('why-local', `Why does "${item.cut.question}" arise for ${name} at all? Nothing longer than their own life leads to it in the model. Which developments beyond one life (institutions, money, technology, family history, a place, a war long ago) press on this moment? Model them as processes over their own long time.`, 'life_general_modeling_start or life_model_revise', { cuts: [item.cut.id] });
  }
  return questions;
}

// Questions of the whole model, in any mode: time, causes, the abstraction ladder, decisions and estimates.
function worldQuestions(index, lives, draws) {
  const questions = [];
  const ask = (kind, question, tool, extra = {}) => questions.push({ kind, subject: null, principal: false, question, tool, ...extra });
  const timed = [...index.events.values()].filter((event) => span(event) !== null);
  if (index.events.size && !timed.length) ask('time-missing', 'No Event in the model has an interval. When does each happen? Without time the model cannot say what is true at a moment or keep one state consistent with the next.', 'life_model_revise');
  if (timed.length) {
    const first = Math.min(...timed.map(start));
    const last = Math.max(...timed.map(end));
    const longest = Math.max(...timed.map(span));
    const longestLife = Math.max(0, ...lives.map((item) => item.read.lifeLength ?? 0));
    if (longest < (last - first) * 0.8 || (lives.length && longest <= longestLife * 1.2)) {
      ask('macro-missing', `Nothing in the model encloses what it models (${first} to ${last})${lives.length ? ' or lasts longer than one life' : ''}. Which longer developments, over decades or centuries (an institution, a technology, a market regime, a family line, a city, a belief, a war), explain why things are as they are at this time? Model them first, as processes with trajectories, then what happens inside them.`, 'life_general_modeling_start or life_model_revise');
    }
  }
  // Decisions with nothing above them are unexplained in any mode.
  const people = new Set(lives.flatMap((item) => [...item.read.own]));
  for (const cut of index.cuts.filter((item) => cutKind(item) === 'decision')) {
    if (people.has(cut.parent_event_id)) continue;
    if (!ancestors(index, cut.parent_event_id).size) ask('why-local', `Why does "${cut.question}" arise at all? Nothing in the model contains the moment it is decided. Which longer processes lead to it, and what do they make likely?`, 'life_model_revise', { cuts: [cut.id] });
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
  for (const cut of index.cuts) push(byQuestion, questionOf(cut).toLowerCase().trim(), cut);
  for (const [question, list] of byQuestion) {
    if (list.length >= 3 && concepts < 3) ask('recurring-question', `"${list[0].question}" is asked at ${list.length} moments. What general pattern do the answers show across them, and which concept or law is it? Climb up.`, 'life_model_revise', { cuts: list.slice(0, 8).map((cut) => cut.id), key: question });
  }
  // Where things happen: the physical coordinates of the moments that carry the work.
  const unplaced = [...index.cutsByEvent.keys()].map((eventId) => index.events.get(eventId)).filter((event) => event && !event.region && !event.substrate
    && ![...ancestors(index, event.id)].some((eventId) => index.events.get(eventId)?.region || index.events.get(eventId)?.substrate));
  if (unplaced.length) ask('place-missing', `${unplaced.length} moment${unplaced.length === 1 ? '' : 's'} carrying Cuts ${unplaced.length === 1 ? 'has' : 'have'} no place (for example ${unplaced.slice(0, 3).map((event) => event.id).join(', ')}). Where does each happen, where is each person and Thing in it, and in what physical state? Give each its region, or contain it in an Event that has one, and model the physical processes of the Things taking part.`, 'life_model_revise');
  const drawn = new Set(draws.map((item) => item.cutId));
  for (const cut of index.cuts.filter((item) => cutKind(item) === 'decision' && !drawn.has(item.id))) {
    ask('decision-undrawn', `"${cut.question}" has not been drawn. Draw it with a recorded seed: the model decides what happens, and the work follows the draw.`, 'life_direction_draw (record)', { cuts: [cut.id] });
  }
  const unestimated = index.cuts.filter((cut) => !estimated(cut) && cutKind(cut) !== 'other');
  if (unestimated.length) ask('weights-unestimated', `${unestimated.length} Cut${unestimated.length === 1 ? '' : 's'} carry weights nobody estimated (for example ${unestimated.slice(0, 3).map((cut) => cut.id).join(', ')}). Estimate them from their described situations, or record whose distribution they are.`, 'life_estimate_cut_shares or life_process_estimate', { cuts: unestimated.slice(0, 12).map((cut) => cut.id) });
  const undescribed = [...index.cutsByEvent.keys()].map((eventId) => index.events.get(eventId)).filter((event) => event && !String(event.description ?? '').trim());
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

const ORDER = ['life-missing', 'life-untimed', 'time-missing', 'processes-few', 'periods-missing', 'shocks-few', 'wants-missing', 'macro-missing', 'period-gap',
  'moment-unmodeled', 'decision-undrawn', 'shift-uncaused', 'adaptation-open', 'wants-generic', 'why-local', 'concepts-thin', 'laws-missing', 'recurring-question',
  'period-uncut', 'process-empty', 'secondary-without-life', 'place-missing', 'event-undescribed', 'weights-unestimated'];

// The open questions of a model: for the named people (or every person the model scaffolds), then the world.
export function modelQuestions(model, { people = null, draws = [], limit = 12, focus = {} } = {}) {
  const index = indexModel(model);
  const named = people ?? modeledPeople(index);
  const lives = named.map((item) => ({ ...item, name: item.name ?? displayName(item.id), read: readPerson(index, item.id) }));
  const own = lives.flatMap((item) => personQuestions(index, item.read, item.name, item.principal !== false));
  // Secondary people's questions of one kind become one question naming them all, so the principals come first.
  const grouped = new Map();
  for (const item of own.filter((entry) => !entry.principal)) push(grouped, item.kind, item);
  const secondary = [...grouped.values()].map((list) => (list.length === 1 ? list[0] : { ...list[0], subject: list.map((item) => item.subject),
    question: `${list.length} secondary people share this question (${list.map((item) => displayName(item.subject)).join(', ')}): ${list[0].question}` }));
  const questions = [...own.filter((entry) => entry.principal), ...secondary, ...worldQuestions(index, lives, draws)];
  questions.sort((a, b) => Number(b.principal) - Number(a.principal) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const counts = questions.reduce((all, item) => ({ ...all, [item.kind]: (all[item.kind] ?? 0) + 1 }), {});
  const depth = { events: index.events.size, processes: index.processes, cuts: index.cuts.length, ...index.abstractions,
    people: lives.map((item) => ({ id: item.id, name: item.name ?? item.id, life: Boolean(item.read.life), processes: item.read.processes.length,
      processesOpened: item.read.processes.filter((process) => process.opened > 0).length, periods: item.read.periods.length,
      shocks: item.read.arcs.length, cuts: item.read.cuts.length })) };
  return { schema: 'meaning-model-open-questions/v1', total: questions.length, counts, depth, questions: questions.slice(0, limit), alwaysAsk: standingQuestions(focus),
    guidance: 'These are the model\'s own open questions, read from its structure. The model is a language and none of its constructs is mandatory: the questions read common ones (a lifecycle Event, periods, change arcs, Cut units), so where you expressed the same understanding your own way a question may not see it; say so in the record and move on. Answer the rest by adding structure, in whatever form understands best, then ask again: every answer raises new questions, and there is no depth at which the model is finished. Take at least one between every step of the work.' };
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
  const drawnBy = new Map(draws.map((item) => [item.cutId, item]));
  const decisions = person.cuts.filter((item) => cutKind(item.cut) === 'decision');
  return {
    personId, time: t,
    life: person.life ? { eventId: person.life.id, start: start(person.life), end: end(person.life), age: start(person.life) === null ? null : t - start(person.life) } : null,
    periods: person.periods.filter(contains).map((event) => ({ eventId: event.id, what: describe(event), start: start(event), end: end(event) })),
    latest: [...latest.values()].map((item) => ({ cutId: item.cut.id, kind: cutKind(item.cut), question: item.cut.question, at: start(item.event),
      answers: answersOf(item.cut).slice().sort((x, y) => y.weight - x.weight).slice(0, 4) })),
    adapting: person.arcs.filter((item) => start(item.focal ?? item.arc) !== null && start(item.focal ?? item.arc) <= t
      && (end(item.adaptation ?? item.arc) ?? Infinity) >= t).map((item) => ({ arcEventId: item.arcEventId, shock: describe(item.focal ?? item.arc), since: start(item.focal ?? item.arc) })),
    decided: decisions.filter((item) => start(item.event) !== null && start(item.event) <= t && drawnBy.has(item.cut.id))
      .map((item) => ({ cutId: item.cut.id, question: item.cut.question, realized: drawnBy.get(item.cut.id).realized ?? null })),
    undecided: decisions.filter((item) => !drawnBy.has(item.cut.id) && (start(item.event) === null || start(item.event) >= t))
      .map((item) => ({ cutId: item.cut.id, question: item.cut.question, at: start(item.event) })),
    undrawnBefore: decisions.filter((item) => !drawnBy.has(item.cut.id) && start(item.event) !== null && start(item.event) < t)
      .map((item) => ({ cutId: item.cut.id, question: item.cut.question, at: start(item.event) })),
  };
}

// Questions the agent asks itself at every step, about whatever it is working on. The model's structure cannot
// raise them; only asking can, and only modeling answers them.
export function standingQuestions(focus = {}) {
  const subjects = [focus.event ? `this event (${focus.event})` : null, focus.scene ? `this scene (${focus.scene})` : null,
    ...(focus.people ?? []).map((name) => `this character (${name})`)].filter(Boolean);
  const about = subjects.length ? subjects.join(', ') : 'what you are working on';
  return [
    `How can you understand ${about} better, using the model? Whatever the object of investigation is (a character, an object, a concept, an era, whatever the work is about), go deeper by modeling more: its history, its parts and processes over time, what it depends on and what depends on it, and what it is an instance of.`,
    `List all the aspects of ${about} you could understand better (for a story: the characters' choices, the author's writing and style, each voice, the technology, the time period, places, institutions, relationships, money, bodies, beliefs; for a market: its participants, instruments, rules, regimes, technology, history), then investigate each by modeling: create new processes, refine existing ones, open sub-processes, add earlier Events that explain or later Events that follow (a childhood, a war a century back, a consequence years on), add Cuts and estimate them, draw decisions, name the concepts and laws things instantiate, model how Things work and where everything is, try another decomposition, sample trajectories.`,
    `Is there a macro aspect you must model to truly understand what is going on in ${about}? It could be something from a character's childhood or a war a hundred years ago; you will not know unless you model it. Follow the causes back along the lives and the world's long processes, and model what you find.`,
    `What can be richer about ${about}? A process still coarse, a person without a life, a thing without a history, a feeling without its cause, a consequence nobody followed. Open it in the model before you use it.`,
    `What is ${about} an instance of? Climb up the ladder: which concept, pattern or law explains it together with other things in the model, and what does that abstraction predict elsewhere?`,
    ...(focus.people?.length ? [`Can you understand ${focus.people.join(', ')} better by inventing processes or subcategories of your own for them? A template is a suggestion: look at it, and at the life, and ask what distinctions this life actually turns on.`] : []),
  ];
}

export const thinkInTheModelInstructions = `The Meaning Model is where you think, in every mode: a story, a market, a life, an alien world. The model is a language, not a form: nothing in it is mandatory, and like any language it can express the same understanding in many ways; templates and conventions are suggestions. The question to ask yourself at every step is: how can I understand this better, using the model? Whatever the object of investigation is (a character, an object, a concept, an era, whatever the work is about), the answer is to go deeper by modeling more. First list all the aspects you could understand better, then investigate each by modeling. Investigating can take many forms, and so much can be done: create new processes, refine existing ones, open sub-processes, add earlier Events that explain or later Events that follow (a childhood, a war a century back, a consequence years on), add Cuts and estimate them, draw decisions, name the concepts and laws things instantiate, model how Things work and where everything is, try another decomposition, sample trajectories. You have not lived in this world in flesh and bone: you know it from text, not from a life, and you have no sense of time of your own. The tool is your gateway to humanhood. The model is your brain: the Understanding Nodes where your thinking is recorded, the event-processes, the physical coordinates of people and objects, the era, all of it processes in one model. It gives you what you lack: things and people as processes over time, whole lives with the wants they taught and the deepest wants underneath, the shocks met and how they were adapted to, the long developments that explain why something happens today, and what is true at each moment. It is also the ladder you climb: from Events up to the concepts they instantiate and the regularities that link them, and down into finer processes. Do not decide in prose what the model can decide. The model drives the work, and the work is a consequence of the model: a story follows from the modeled lives and the drawn decisions, a forecast from the modeled processes. Answer every question by building or reading the model: use a template or invent processes of your own (templates are suggestions; ask which understands better), open a process into subcategories, add a period, a shock, a Cut, a concept or a law, estimate weights, draw a decision. The tool returns the model's open questions after every model change; take them. Ask yourself at every step: is there a macro aspect I must model to truly understand what is going on here, something from a childhood or a war a hundred years ago? What can be richer about this event, this scene, this character, this market? What is it an instance of? Model far more than the work will show: the background processes of reality (the economy, seasons, bodies, institutions, other families, the technology of the day, the long histories) run in the model whether or not the work ever touches them, and what the work shows is real because of what it does not show. A small model makes small work, and anyone can get that from a language model alone; the reason to use this tool is the depth only a model gives. The model is never finished: work from its state at each moment, and keep deepening while you work.`;

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
      if (start(entry.event) === null || cutKind(entry.cut) === 'decision') continue;
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
export async function readOpenQuestions(service, { modelHash, people = null, at = null, focus = {}, graphHash = null, accessScopes = [], limit = 16 }) {
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  let draws = [];
  if (graphHash) {
    const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(accessScopes)].sort() });
    draws = readDraws(view);
  }
  const named = people ?? modeledPeople(indexModel(model));
  const questions = modelQuestions(model, { people: named, draws, limit, focus });
  const jumps = modelJumps(model, { people: named, limit: 8 });
  const states = at === null ? [] : named.filter((person) => person.principal !== false).map((person) => ({ name: person.name ?? displayName(person.id), ...personStateAt(model, person.id, at, { draws }) }));
  return { ...questions, modelHash, jumps: jumps.jumps, states };
}

// A compact copy of the open questions for the result of any tool that changed a model.
export async function withOpenQuestions(service, result, { modelHash = result?.modelHash ?? null, limit = 6, focus = {} } = {}) {
  if (!modelHash) return result;
  try {
    const { total, counts, depth, questions, alwaysAsk, guidance } = await readOpenQuestions(service, { modelHash, limit, focus });
    return { ...result, openQuestions: { total, counts, depth, questions, alwaysAsk, guidance, more: 'life_model_questions returns all of them, the model\'s jumps, and each person\'s state at a moment.' } };
  } catch {
    return result;
  }
}
