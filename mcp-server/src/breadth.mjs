// Where to go wider: the breadth check the values report runs after every write.
//
// The deepen check asks of one process whether it is made of parts worth following. The breadth check asks it of the
// whole model: is something changing here that no process follows? It reads signals the model already holds, names
// the strongest with its evidence, and never blocks.
// - Loose Events: Events that hold no other Event and name no process. They are grouped by the importance scale they
//   are judged on (when the model has more than one scale, one that judges four in five of the judged Events or more is
//   the whole model, not a group; a model's only scale is its group), else by the Event
//   that holds them, else as the whole model, and weighed as the deepen check weighs Events (top level 8, then 4, 2, 1).
//   A group where other Events already name processes is asked first to link them.
// - Stated quantities: a loose Event whose words state a count, a share or an amount, so its measure is half there.
// - Remainders: a Cut's remainder or "other" share at 15% or more, which asks what is in it.
// - Open completeness: a carve whose completeness did not pass, which asks what has no home among its parts.
// An answer recorded with life_breadth_record takes its candidate out until the evidence grows by half, and by at least
// two Events or quantities (or 0.05 of a share), the deepen check's rule, so one more Event in a small group is not enough.
import { worldEvents } from './world-events.mjs';
import { BREADTH_ANSWER_LINE, BREADTH_CANDIDATE_LINE, BREADTH_SIGNALS_LINE, FOLLOWED_LINE } from './carve-lines.mjs';

const RANK_WEIGHT = [0, 8, 4, 2];
const weightOf = (rank) => (Number.isFinite(rank) ? (RANK_WEIGHT[rank] ?? 1) : 1);
// A count of people or things, a share or an amount of money: not a date or a span of years.
const QUANTITY = /\b\d[\d,.]*\s?(?:%|percent\b|per cent\b)|\b\d[\d,.]*\s?(?:thousand|million|billion|trillion)?\s?(?:people|persons|deaths|dead|killed|slaves|soldiers|troops|inhabitants|speakers|refugees|users|customers|workers|holders|tonnes|tons|barrels|dollars|euros|ounces|hectares)\b|[$€£]\s?\d[\d,.]*(?:\s?(?:thousand|million|billion|trillion|[kmb]n?)\b)?/iu;
// The remainder, or an answer keyed as the rest of something, such as other or other_epidemics: the key, not its meaning,
// since a meaning can mention others without being the rest.
const REMAINDER_KEY = /^(?:remainder|others?|rest|unknown|else)(?:_[a-z0-9_]+)?$/u;
const REMAINDER_SHARE = 0.15;
// A scale that judges this share of the judged Events or more is the whole model, not a group of it.
const WHOLE = 0.8;
const ANSWERS = Object.freeze(['linked', 'modeled', 'not_modeled']);
export { ANSWERS as BREADTH_ANSWERS };
const short = (text, length = 60) => { const flat = String(text ?? '').replace(/\s+/gu, ' ').trim().replace(/\.$/u, ''); return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat; };

// The answers recorded so far, by candidate: the concept that holds each, its answer, the signals it was given with and
// the process that follows it. A later answer to the same candidate replaces an earlier one.
export function breadthAnswers(model) {
  const answers = new Map();
  for (const concept of model?.meaning_model?.concepts ?? []) {
    if (concept.withdrawn) continue;
    const lines = (concept.provenance ?? []).filter((line) => typeof line === 'string');
    const candidate = lines.find((line) => line.startsWith(BREADTH_CANDIDATE_LINE))?.slice(BREADTH_CANDIDATE_LINE.length).trim();
    if (!candidate) continue;
    const signals = Object.fromEntries((lines.find((line) => line.startsWith(BREADTH_SIGNALS_LINE))?.slice(BREADTH_SIGNALS_LINE.length) ?? '')
      .split(';').map((pair) => pair.split('=')).filter(([key, value]) => key && Number.isFinite(Number(value))).map(([key, value]) => [key.trim(), Number(value)]));
    const answer = lines.find((line) => line.startsWith(BREADTH_ANSWER_LINE))?.slice(BREADTH_ANSWER_LINE.length).trim() ?? null;
    const followedBy = lines.find((line) => line.startsWith(FOLLOWED_LINE))?.slice(FOLLOWED_LINE.length).trim() ?? null;
    answers.set(candidate, { candidate, concept: concept.id, label: concept.label ?? concept.id, answer, signals, ...(followedBy ? { followedBy } : {}) });
  }
  return answers;
}

// The signals a candidate is answered with, as one provenance line, and whether they have grown by half since.
// A whole-tree review (process-tree.mjs) keeps the size of the tree it read instead.
export const signalsLine = (item) => (item.kind === 'tree'
  ? `${BREADTH_SIGNALS_LINE}processes=${item.processes ?? 0};revision=${item.revision ?? 0}`
  : `${BREADTH_SIGNALS_LINE}events=${item.events ?? 0};quantities=${item.quantities ?? 0};share=${item.share ?? 0}`);
const grown = (now, then) => {
  const by = (key) => (now[key] ?? 0) >= Math.max((then[key] ?? 0) * 1.5, (then[key] ?? 0) + (key === 'share' ? 0.05 : 2));
  return (now.events ?? 0) > 0 ? by('events') || by('quantities') : (now.share ?? 0) > 0 ? by('share') : false;
};

// Every candidate, strongest first, with those already answered left out until their evidence grows. `label` names a
// process for the reader.
export function breadthCheck(model, { label = (id) => id } = {}) {
  const mm = model?.meaning_model ?? {};
  const holds = new Set(); const holder = new Map();
  for (const relation of mm.event_relations ?? []) if (relation.kind === 'contains') { holds.add(relation.source_event_id); holder.set(relation.target_event_id, relation.source_event_id); }
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  // A person template's slow-process Events hold a life's processes and are not happenings.
  const world = worldEvents(mm).filter((event) => !/\.is\.[a-z_-]+$/u.test(event.id));
  const names = (event) => [...(event.process_ids ?? []), ...(event.observation_process_ids ?? [])];
  const loose = world.filter((event) => !holds.has(event.id) && !names(event).length);
  // Each Event's rank on each scale (1 is a scale's top level), the best across holders.
  const scales = new Map((mm.importance_scales ?? []).map((scale) => [scale.id, scale]));
  const ranks = new Map();
  for (const judgment of mm.event_importance ?? []) {
    const scale = scales.get(judgment.scale_id); if (!scale) continue;
    const rank = (scale.levels ?? []).findIndex((level) => level.key === judgment.level) + 1; if (rank < 1) continue;
    const own = ranks.get(judgment.scale_id) ?? new Map();
    own.set(judgment.event_id, Math.min(own.get(judgment.event_id) ?? Infinity, rank));
    ranks.set(judgment.scale_id, own);
  }
  const worldIds = new Set(world.map((event) => event.id));
  const judged = new Set([...ranks.values()].flatMap((own) => [...own.keys()].filter((id) => worldIds.has(id))));
  const grouping = [...ranks].filter(([, own]) => ranks.size === 1 || [...own.keys()].filter((id) => worldIds.has(id)).length < WHOLE * judged.size).map(([id]) => id);
  const best = (id) => Math.min(...[...ranks.values()].map((own) => own.get(id) ?? Infinity));
  // The groups: by scale, by the Event that holds them, or the whole model.
  const groups = new Map();
  const group = (key, make) => { if (!groups.has(key)) groups.set(key, { ...make(), loose: [] }); return groups.get(key); };
  for (const event of loose) {
    const own = grouping.filter((id) => ranks.get(id).has(event.id));
    if (own.length) { for (const id of own) group(`events:${id}`, () => ({ scale: id, where: `judged for ${audienceOf(scales.get(id))}` })).loose.push({ event, rank: ranks.get(id).get(event.id) }); continue; }
    const parent = holder.get(event.id);
    if (parent && events.has(parent)) group(`events:within:${parent}`, () => ({ within: parent, where: `within ${short(events.get(parent).boundary ?? parent, 48)}` })).loose.push({ event, rank: best(event.id) });
    else group('events:world', () => ({ where: 'in the model' })).loose.push({ event, rank: best(event.id) });
  }
  // What each group already follows: the processes its other Events name, most named first.
  const followedIn = (item) => {
    const members = item.scale ? [...ranks.get(item.scale).keys()].map((id) => events.get(id)).filter(Boolean)
      : item.within ? world.filter((event) => holder.get(event.id) === item.within) : world;
    const counts = new Map();
    for (const event of members) for (const id of new Set(names(event))) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  };
  const candidates = [];
  for (const [key, item] of groups) {
    const sorted = item.loose.sort((a, b) => a.rank - b.rank || span(a.event) - span(b.event) || a.event.id.localeCompare(b.event.id));
    const quantities = sorted.map(({ event }) => ({ event, match: QUANTITY.exec(`${event.boundary ?? ''} ${event.description ?? ''}`)?.[0] })).filter((q) => q.match);
    const followed = followedIn(item);
    const weight = sorted.reduce((sum, { rank }) => sum + weightOf(rank), 0);
    candidates.push({ candidate: key, kind: 'events', where: item.where, events: sorted.length, weight, quantities: quantities.length,
      examples: sorted.slice(0, 3).map(({ event }) => ({ id: event.id, label: short(event.boundary ?? event.id, 80) })),
      ...(quantities.length ? { quantity: { id: quantities[0].event.id, label: short(quantities[0].event.boundary ?? quantities[0].event.id), states: short(quantities[0].match, 40) } } : {}),
      followed: followed.slice(0, 5).map((id) => ({ id, label: label(id) })),
      base: Math.log2(1 + weight) + (quantities.length ? 2 : 0) + (followed.length ? 1 : 0) });
  }
  // Remainders, by series (or by Cut): the largest share, and the shares weighed by the Event each Cut sits in.
  const remainders = new Map();
  for (const cut of mm.normalized_cuts ?? []) {
    if (cut.withdrawn) continue;
    for (const answer of cut.answers ?? []) {
      if (!REMAINDER_KEY.test(answer.key) || !(answer.weight >= REMAINDER_SHARE)) continue;
      const series = /^cut\.series\.([a-z0-9_-]+)\./u.exec(cut.id)?.[1] ?? null;
      const key = `remainder:${series ?? cut.id}:${answer.key}`;
      const item = remainders.get(key) ?? { candidate: key, kind: 'remainder', question: short(cut.question, 80), answer: short(answer.meaning ?? answer.key, 60), share: 0, readings: 0, weight: 0, cut: cut.id };
      item.share = Math.max(item.share, Number(answer.weight.toFixed(3))); item.readings += 1; item.weight += answer.weight * weightOf(best(cut.parent_event_id));
      remainders.set(key, item);
    }
  }
  for (const item of remainders.values()) candidates.push({ ...item, weight: Number(item.weight.toFixed(2)), base: Math.log2(1 + item.weight) });
  // Carves whose completeness did not pass: their own words for what has no home.
  const concepts = new Map((mm.concepts ?? []).map((concept) => [concept.id, concept]));
  for (const cut of mm.abstract_cuts ?? []) {
    if (cut.withdrawn) continue;
    const verdict = /^completeness (fail|uncertain)\b/u.exec((cut.provenance ?? []).find((line) => typeof line === 'string' && line.startsWith('completeness ')) ?? '')?.[1];
    if (verdict) candidates.push({ candidate: `gap:${cut.id}`, kind: 'gap', cut: cut.id, label: short(concepts.get(cut.parent_concept_id)?.label ?? cut.parent_concept_id), verdict, base: 3 });
  }
  // Answered candidates stay out until their evidence grows by half; those that come back say so.
  const answers = breadthAnswers(model);
  const ranked = [];
  for (const item of candidates) {
    const before = answers.get(item.candidate);
    if (before && !grown(item, before.signals)) continue;
    const { base, ...rest } = item;
    ranked.push({ ...rest, score: Number((base + (before ? 0 : 1)).toFixed(2)), ...(before ? { answeredBefore: before.answer } : {}) });
  }
  ranked.sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));
  // Every candidate by key, answered or not, for recording an answer against the evidence it was given with.
  const all = new Map(candidates.map(({ base, ...item }) => [item.candidate, item]));
  return { ranked, considered: [...answers.values()], all };
}
// Who a scale's judgments are for, in a few words: its audience up to the first colon.
const audienceOf = (scale) => { const text = short(String(scale.audience || scale.id).split(':')[0], 64); return text.charAt(0).toLowerCase() + text.slice(1); };
const span = (event) => (event.interval ? (event.interval.end ?? event.interval.start) - event.interval.start : Infinity);

// The candidate the check names first, for showing its line only when that changes.
export const breadthTop = (check) => check.ranked[0]?.candidate ?? null;

// The report's one line: the strongest candidate, what to do with it, and two after it.
export function breadthLine(check) {
  const [first, ...rest] = check.ranked;
  if (!first) return null;
  const record = `record why with life_breadth_record (candidate "${first.candidate}"), so it is not asked again until the evidence grows`;
  const again = first.answeredBefore ? ` It was answered ${first.answeredBefore.replace('_', ' ')} before, and its evidence has grown by half since.` : '';
  const next = rest.length ? ` Next: ${rest.slice(0, 2).map(brief).join('; ')}.` : '';
  if (first.kind === 'remainder') return `Breadth check: what is in "${first.answer}", up to ${Math.round(first.share * 100)}% of "${first.question}"${first.readings > 1 ? ` across ${first.readings} readings` : ''}? Divide it with a conditioned series (life_series_record with conditionedOn), or ${record}.${again}${next}`;
  if (first.kind === 'gap') return `Breadth check: your carve of ${first.label} left its completeness ${first.verdict === 'fail' ? 'failing' : 'unshown'}: what has no home among its parts? Carve it again with the missing part among the candidates, or ${record}.${again}${next}`;
  const examples = first.examples.map((item) => item.label).join('; ');
  const quantity = first.quantity ? ` ${first.quantities} of them state a quantity, such as ${first.quantity.label} (${first.quantity.states}).` : '';
  const act = first.followed.length
    ? `The model follows ${first.followed.slice(0, 3).map((item) => item.label).join(', ')} there: name in each Event's process_ids the process it changes, or open what they change as a new process with a measure and rough values over time.`
    : 'No process is named there yet: open what they change as a new process with a measure and rough values over time, or name in each Event\'s process_ids a process the model has.';
  const count = first.where === 'in the model' ? `${first.events} Event(s) in the model name no process` : `Of the Events ${first.where}, ${first.events} name no process`;
  return `Breadth check: is something changing that no process follows? ${count}, among them ${examples}.${quantity} ${act} If it is not worth following for what this model is for, ${record}.${again}${next}`;
}
const brief = (item) => (item.kind === 'remainder' ? `"${item.answer}" in "${short(item.question, 48)}"` : item.kind === 'gap' ? `the carve of ${item.label}` : `${item.events} Event(s) ${item.where}`);
