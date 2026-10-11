// The least a story's people must have, read from ordinary model records (docs/PROCESS-BREAKDOWN.md, Part 8). Every
// person in the accepted world needs the nine slow processes of a life, each with values over time, at least one
// process of their own, and Cuts read over their life for what they want, how they see their wants' fulfilment, what
// they see as threatened and what they feel. A person is a referent from the person template (`.person.` in its id)
// or one whose continuity is a human life or a person; institutions, objects and relationships are Things, and are
// not held to this. The coverage report names each person's gaps, and in a story the pass is not done while any
// remain. Anyone can do more, or carve a life differently; this is the floor.
import { SLOW_PROCESSES, contextKindOf, eventDescendants, readPerson, readingCut } from './model-questions.mjs';

const HUMAN = /\b(human|person)\b/iu;
// The Cut families every person's life is read through, in the order a reading is classified: what is threatened
// before outlook, since a threatened-fulfilment unit names fulfilment too.
export const PERSON_CUT_FAMILIES = Object.freeze([
  ['threat', /threat|at risk/iu, 'what they see as threatened'],
  ['outlook', /outlook|fulfil/iu, 'how they see their wants\' fulfilment'],
  ['wants', /motivational|\bwants?\b/iu, 'what they want'],
  ['feelings', /emotional|feeling|appraisal/iu, 'what they feel'],
]);

// An outlook divides how the fulfilment of wants is anticipated (assured or threatened); a threat reading divides what
// is at stake within the threatened share. Their answers tell them apart where their words overlap.
const OUTLOOK_ANSWER = /^(?:assured|threatened|at_?risk|secure|insecure|uncertain|unresolved|fulfilled|frustrated|remainder)/iu;
export function cutFamily(cut) {
  const text = `${cut?.unit ?? ''} ${cut?.question ?? ''}`;
  const keys = (cut?.answers ?? []).map((answer) => String(answer?.key ?? '')).filter(Boolean);
  if (keys.length && keys.some((key) => key !== 'remainder') && keys.every((key) => OUTLOOK_ANSWER.test(key))) return 'outlook';
  return PERSON_CUT_FAMILIES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

const words = (text) => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
// The slow process a process stands for: one of its id's last segments, or its label's words.
function slowKeyOf(process) {
  const segments = String(process.id).toLowerCase().split('.');
  const fromId = SLOW_PROCESSES.find((key) => segments.slice(-2).includes(key));
  if (fromId) return fromId;
  const label = words(process.scale?.label ?? '');
  return label.length <= 3 ? SLOW_PROCESSES.find((key) => label.includes(key)) ?? null : null;
}

export function peopleOf(index) {
  return [...index.referents.values()].filter((referent) => {
    if (!referent.lifecycle_event_id) return false;
    const kind = contextKindOf(index, referent.lifecycle_event_id);
    if (kind && kind !== 'accepted_world') return false;
    return /\.person\./u.test(referent.id) || HUMAN.test(referent.continuity_criterion ?? '');
  });
}

// Compare only the same question, unit, answers and perspective. An inner perspective's readings can follow a
// person's life too; they need not appear among the coverage report's accepted-world tracks. Conditioned threat
// readings retain the parent question and opened answer, rather than the parent's changing per-interval Cut id.
function comparableKey(index, cut) {
  let root = cut.parent_event_id;
  for (let step = 0; step < 256 && root && !index.rootKinds.has(root); step += 1) root = [...(index.parents.get(root) ?? [])][0];
  const signature = (item) => [String(item?.question ?? '').trim().toLowerCase(), item?.unit ?? null,
    (item?.answers ?? []).map((answer) => answer.key).sort()];
  const parent = cut.conditioning ? index.cuts.find((item) => item.id === cut.conditioning.cut_id) : null;
  return JSON.stringify([root ?? null, ...signature(cut), cut.conditioning ? [signature(parent), cut.conditioning.answer_key] : null]);
}

function followsLife(readings, life) {
  if (!Number.isFinite(life?.start) || !Number.isFinite(life?.end) || !(life.end > life.start)) return false;
  const intervals = readings.map(({ event }) => event?.interval)
    .filter((interval) => Number.isFinite(interval?.start) && Number.isFinite(interval?.end) && interval.end > interval.start);
  if (new Set(intervals.map((interval) => interval.start)).size < 2) return false;
  const pieces = intervals.map(({ start, end }) => [Math.max(start, life.start), Math.min(end, life.end)])
    .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let at = life.start, covered = 0;
  for (const [start, end] of pieces) if (end > at) { covered += end - Math.max(start, at); at = end; }
  // Match the time schedule's rounding allowance; isolated moments cannot stand for the rest of a life.
  return covered >= 0.99 * (life.end - life.start);
}

// What one person has and lacks. `tracks` are the coverage report's records, which carry their subject.
export function personGaps(model, index, tracks, person) {
  const scaffoldPrefix = person.id.replace(/^referent\./u, '');
  const own = (model.processes ?? []).filter((process) => process.scale?.subject_referent_id === person.id
    || String(process.id).startsWith(`${scaffoldPrefix}.`));
  const valued = new Map(tracks.filter((track) => track.kind === 'values').map((track) => [track.id, track.times.length]));
  const read = readPerson(index, person.id);
  // The Event-based person template remains supported, but opening one child is not development over time.
  // It needs finer dated Events at two distinct starts; structural holders and lens readings do not count.
  const opened = (key) => {
    const root = read.slow?.[key]?.eventId;
    if (!root) return false;
    const times = [...eventDescendants(index, root)].map((id) => index.events.get(id))
      .filter((event) => event && !/\.is\.[a-z_-]+$/u.test(event.id) && !index.readings.has(event.id)
        && Number.isFinite(event.interval?.start)).map((event) => event.interval.start);
    return new Set(times).size >= 2;
  };
  const lifeEvent = (id) => index.events.get(`event.${id}`) ?? null;
  const slow = new Map(SLOW_PROCESSES.map((key) => [key, own.filter((process) => slowKeyOf(process) === key)]));
  const missingSlow = SLOW_PROCESSES.filter((key) => !slow.get(key).length && !read.slow?.[key]?.eventId);
  const unvaluedSlow = SLOW_PROCESSES.filter((key) => !missingSlow.includes(key) && !opened(key)
    && !slow.get(key).some((process) => (valued.get(process.id) ?? 0) >= 2));
  const followed = (process) => (valued.get(process.id) ?? 0) >= 1
    || [...(index.children.get(lifeEvent(process.id)?.id) ?? [])].length > 0 || (index.cutsByEvent.get(`event.${process.id}`) ?? []).length > 0;
  const ownProcesses = own.filter((process) => !slowKeyOf(process) && !/\.life\.index$/u.test(process.id) && followed(process));
  const readings = read.cuts.filter(({ cut }) => !readingCut(index, cut));
  const cuts = readings.map(({ cut }) => cut);
  const families = new Set(cuts.map(cutFamily).filter(Boolean));
  const missingFamilies = PERSON_CUT_FAMILIES.map(([family]) => family).filter((family) => !families.has(family));
  const life = person.interval ?? read.life?.interval;
  const lifeSpanUnresolved = !Number.isFinite(life?.start) || !Number.isFinite(life?.end) || !(life.end > life.start);
  const unfollowedFamilies = PERSON_CUT_FAMILIES.map(([family]) => family).filter((family) => {
    if (!families.has(family)) return false;
    const groups = new Map();
    for (const reading of readings.filter(({ cut }) => cutFamily(cut) === family)) {
      const key = comparableKey(index, reading.cut);
      groups.set(key, [...(groups.get(key) ?? []), reading]);
    }
    return ![...groups.values()].some((group) => followsLife(group, life));
  });
  return { id: person.id, name: person.boundary ? String(person.boundary).split(/[,(]/u)[0].trim() : person.id, missingSlow, unvaluedSlow,
    ownProcesses: ownProcesses.length, missingFamilies, unfollowedFamilies, ...(lifeSpanUnresolved ? { lifeSpanUnresolved: true } : {}),
    complete: !missingSlow.length && !unvaluedSlow.length && ownProcesses.length > 0 && !missingFamilies.length && !unfollowedFamilies.length && !lifeSpanUnresolved };
}

export function peopleCheck(model, index, tracks) {
  const people = peopleOf(index).map((person) => personGaps(model, index, tracks, person));
  return { people: people.length, incomplete: people.filter((person) => !person.complete) };
}

// One line naming what a person lacks, in the order the work should go.
export function personGapText(person) {
  const parts = [];
  if (person.missingSlow.length) parts.push(`no ${person.missingSlow.join(', ')}`);
  if (person.unvaluedSlow.length) parts.push(`no values over time for ${person.unvaluedSlow.join(', ')}`);
  if (!person.ownProcesses) parts.push('no process of their own');
  if (person.missingFamilies.length) {
    const names = person.missingFamilies.map((family) => PERSON_CUT_FAMILIES.find(([key]) => key === family)[2]);
    parts.push(`no Cuts for ${names.join(', ')}`);
  }
  if (person.unfollowedFamilies.length) parts.push(`no comparable readings across the life for ${person.unfollowedFamilies.join(', ')}`);
  if (person.lifeSpanUnresolved) parts.push('life span undated or unresolved');
  return `${person.name}: ${parts.join('; ')}`;
}
