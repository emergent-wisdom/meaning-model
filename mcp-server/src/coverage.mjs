// What the model covers in time, for both kinds of record: a process's dated values, and a series of Cut readings in
// the accepted world. One report, returned by life_values_record and life_series_record and readable through
// life_model_questions, says how far the time schedule is filled, what its next level lacks, and whether this pass is
// done. Nothing is ever finished: another pass can always go deeper. Shares and quantities keep their own records and meanings; only their coverage in time is judged together.
//
// The schedule divides the model's span coarse to fine (1, 6, 18 and 54 blocks), in log time toward the latest date for
// a span over ten thousand years, evenly otherwise. A record of something in general is held to the whole span. One
// about a Thing (a process's subject, a series' owner) is held to that Thing's life: its two ends, the world's
// boundaries inside it and, at the finest level, the Thing's own Events, so a short life needs its own detail and a
// life the work leans on needs the most. A character's inner view, a holder's understanding, forecasts, draws and lens
// readings are not world records and do not count, neither as records nor as the Events a reading passes over; a series
// that opens one answer of another counts with its parent.
//
// A series is a question followed over time. One recorded with life_series_record is a series by declaration and is
// held to its Thing's life. One recorded otherwise is a series only when its readings join end to end into one stretch,
// and it is held to that stretch, since nothing says it was meant to span more. The same question asked of separate
// episodes (why the line was silent in 1971, and again in 1972) is a set of assessments, not a series, however many
// there are, and is never asked to fill a schedule.
//
// Values are judged as the model's one account, whoever holds them: Cut series have no holder, so a holder-by-holder
// schedule could not judge the two together. Contradictions are judged within each holder's own values (values-record).
import { contextKindOf, flatStretches, indexModel, readingSeries, storyProfile } from './model-questions.mjs';
import { calendar } from './series-plan.mjs';
import { isSeriesReadingEvent, isSteadyReading } from './series-mark.mjs';
import { worldEvents } from './world-events.mjs';

export const SCHEDULE_BLOCKS = Object.freeze([1, 6, 18, 54]);
// How many years one unit of the model's clock is: the calendars the viewer and series plan know (years, and civil
// days since 1970), then common lengths; an unknown unit counts as a year.
const UNIT_YEARS = Object.freeze({ month: 1 / 12, week: 7 / 365.2425, day: 1 / 365.2425, hour: 1 / 8_765.82, minute: 1 / 525_949.2, second: 1 / 31_556_952 });
export function yearsPerUnit(unit) {
  const text = String(unit ?? '').trim().toLowerCase();
  const clock = calendar(text);
  if (clock) return clock.toYear(1) - clock.toYear(0);
  return UNIT_YEARS[text.replace(/s$/u, '')] ?? 1;
}

export function timeSchedule(from, to, unit = 'year') {
  const span = to - from;
  if (!(span > 0)) return null;
  const log = span * yearsPerUnit(unit) > 10_000, c = span / 10_000;
  const place = (fraction) => (log ? to - (Math.exp(Math.log(span + c) + fraction * (Math.log(c) - Math.log(span + c))) - c) : from + fraction * span);
  const finest = SCHEDULE_BLOCKS.at(-1), times = new Map();
  for (let j = 0; j <= finest; j += 1) {
    if (j === 0 || j === finest) { times.set(j, j ? to : from); continue; }
    // Rounded to a quarter of the block width at the coarsest level holding this boundary, to a power of ten.
    const level = SCHEDULE_BLOCKS.find((blocks) => (j * blocks) % finest === 0);
    const step = finest / level, t = place(j / finest);
    const width = Math.min(Math.abs(place((j + step) / finest) - t), Math.abs(t - place((j - step) / finest)));
    const power = Math.floor(Math.log10(Math.max(width / 4, 1e-9)));
    times.set(j, Number((Math.round(t / 10 ** power) * 10 ** power).toFixed(Math.max(0, -power))));
  }
  return { from, to, scale: log ? 'log' : 'even', levels: SCHEDULE_BLOCKS.map((blocks, i) => ({ level: i + 1, blocks,
    boundaries: [...new Set([...Array(blocks + 1).keys()].map((k) => times.get(k * (finest / blocks))))] })) };
}

const start = (event) => event?.interval?.start ?? null;
const end = (event) => event?.interval?.end ?? null;
const unique = (times) => [...new Set(times)].sort((a, b) => a - b);
// A required time is met by a value within a quarter of the distance to its nearest required neighbour.
const nearOf = (times, i) => Math.min(...[times[i - 1], times[i + 1]].filter((t) => t !== undefined).map((t) => Math.abs(t - times[i])), Infinity) / 4;

// The share of a block that may stay uncovered: authored boundaries are rounded differently from the schedule's, and a
// reading ending at 1950.3 with the next starting at 1950.33 has still read the stretch. Nothing more is forgiven.
const ROUNDING = 0.01;

// How much of [a, b] the readings cover together, counting each stretch once.
function coveredLength(readings, a, b) {
  const pieces = readings.map((r) => [Math.max(a, r.start), Math.min(b, r.end)]).filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0]);
  let total = 0, at = a;
  for (const [x, y] of pieces) { if (y > at) { total += y - Math.max(x, at); at = y; } }
  return total;
}

// Readings that join end to end, or nest, into one stretch of positive length: [from, to], or null when a gap opens
// between them. Rounding is forgiven at each joint, measured against the shorter reading beside it.
function oneStretch(readings) {
  const sorted = [...readings].sort((x, y) => x.start - y.start || y.end - x.end);
  let from = sorted[0].start, to = sorted[0].end, last = sorted[0];
  for (const r of sorted.slice(1)) {
    const gap = r.start - to;
    if (gap > ROUNDING * Math.min(r.end - r.start, last.end - last.start)) return null;
    if (r.end > to) { to = r.end; last = r; }
  }
  return to > from ? { start: from, end: to } : null;
}

// The tracks the schedule judges: each process's values, every holder's together, and each accepted-world series.
function tracksOf(model, index) {
  const byId = new Map((model.processes ?? []).map((p) => [p.id, p]));
  const valued = new Map();
  for (const series of model.value_series ?? []) {
    const times = valued.get(series.process_id) ?? [];
    for (const point of series.points ?? []) times.push(point.time);
    valued.set(series.process_id, times);
  }
  const tracks = [...valued].map(([id, times]) => ({ kind: 'values', id, label: byId.get(id)?.scale?.label ?? id, subject: byId.get(id)?.scale?.subject_referent_id ?? null, times: unique(times) }));
  for (const list of readingSeries(index).values()) {
    const first = list[0];
    const rootKind = first.root ? index.rootKinds.get(first.root) : null;
    if (rootKind && rootKind !== 'accepted_world') continue;
    const readings = list.map((item) => ({ start: start(item.event), end: end(item.event) ?? start(item.event), steady: isSteadyReading(item.event) })).filter((r) => Number.isFinite(r.start));
    if (!readings.length) continue;
    const track = { kind: 'cuts', id: first.cut.id, label: String(first.cut.question ?? first.cut.id).slice(0, 100), readings };
    if (list.some((item) => isSeriesReadingEvent(item.event))) tracks.push({ ...track, subject: first.owner });
    else if (readings.length >= 2) { const extent = oneStretch(readings); if (extent) tracks.push({ ...track, subject: null, extent }); }
  }
  return tracks;
}

export function coverageReport(model, { stillEmpty = [], passedOver = [], contradictions = [] } = {}) {
  const mm = model?.meaning_model ?? {};
  const index = indexModel(model);
  const tracks = tracksOf(model, index);
  const holders = new Set((model?.value_series ?? []).map((series) => series.holder)).size;
  const world = worldEvents(mm);
  const worldIds = new Set(world.map((event) => event.id));
  // A Thing's life and its own world Events. A life lived in another context, such as a character's imagining, holds
  // nothing in the accepted world.
  const lifeOf = (referentId) => {
    const referent = index.referents.get(referentId);
    const kind = referent?.lifecycle_event_id ? contextKindOf(index, referent.lifecycle_event_id) : null;
    if (kind && kind !== 'accepted_world') return null;
    const life = referent?.interval ?? index.events.get(referent?.lifecycle_event_id)?.interval;
    if (!Number.isFinite(life?.start) || !Number.isFinite(life?.end) || !(life.end > life.start)) return null;
    const own = new Set([...(referent.lifecycle_event_id ? descendantsOf(index, referent.lifecycle_event_id) : []), ...(index.eventsOf.get(referentId) ?? [])]);
    const moments = [...own].map((id) => index.events.get(id)).filter((event) => event && worldIds.has(event.id) && Number.isFinite(start(event)) && start(event) > life.start && start(event) < life.end).map(start);
    // No finer than the life's own finest block, so a crowded life asks for at most fifty-odd moments.
    const grain = (life.end - life.start) / SCHEDULE_BLOCKS.at(-1);
    const thinned = []; for (const t of unique(moments)) if (!thinned.length || t - thinned.at(-1) >= grain) thinned.push(t);
    return { start: life.start, end: life.end, grain, moments: thinned };
  };
  const lives = new Map();
  const life = (referentId) => { if (!referentId) return null; if (!lives.has(referentId)) lives.set(referentId, lifeOf(referentId)); return lives.get(referentId); };
  // The span is what the world's records cover: its own Events, the values, the accepted-world readings and the dated
  // lives of the Things they are about, never an imagined or remembered Event under another root. The accepted world's
  // own root is not a happening, but its dates are the world's extent.
  const acceptedRoots = (mm.context_roots ?? []).filter((root) => root.kind === 'accepted_world').map((root) => index.events.get(root.event_id)).filter(Boolean);
  const times = [...world.flatMap((event) => [start(event), end(event)]), ...acceptedRoots.flatMap((event) => [start(event), end(event)]),
    ...tracks.flatMap((track) => (track.kind === 'values' ? track.times : track.readings.flatMap((r) => [r.start, r.end]))),
    ...tracks.flatMap((track) => { const own = life(track.subject); return own ? [own.start, own.end] : []; })].filter(Number.isFinite);
  const schedule = times.length ? timeSchedule(Math.min(...times), Math.max(...times), model?.time_unit) : null;
  // Only readings in the accepted world, passing over the accepted world's Events, keep this pass from being done; a
  // character's inner view stays a question of its own (stillFlat in life_series_record).
  const flat = flatStretches(model, null, 1_000, { world: true });
  if (!schedule || !tracks.length) {
    const status = tracks.length
      ? 'Every record so far sits at one moment, so there is no span to divide into a time schedule: record values or readings at other dates, or date the life or the Events they belong to.'
      : 'Nothing is followed over time yet: give the processes dated values (life_values_record) and the shares that compete for a unit their series (life_series_record).';
    return { done: false, tracks: tracks.length, holders, ...(schedule ? { schedule: { from: schedule.from, to: schedule.to, scale: schedule.scale, reached: 0 } } : {}), flatCount: flat.length, steadyCount: 0, status, next: [status] };
  }
  // What a track must have at one level: the level's boundaries over the whole span; over its Thing's life, with the
  // life's ends and, at the finest level, its own moments; or over the one stretch an undeclared series reads.
  const required = (track, level) => {
    const bounds = schedule.levels[level - 1].boundaries;
    if (track.extent) return unique([track.extent.start, ...bounds.filter((t) => t > track.extent.start && t < track.extent.end), track.extent.end]);
    const own = life(track.subject);
    if (!own) return bounds;
    const base = unique([own.start, ...bounds.filter((t) => t > own.start && t < own.end), own.end]);
    if (level !== SCHEDULE_BLOCKS.length) return base;
    // An Event within half a block of a boundary is met there, so it never leaves a sliver to fill on its own.
    return unique([...base, ...own.moments.filter((t) => base.every((b) => Math.abs(b - t) >= own.grain / 2))]);
  };
  const lacking = (track, level) => {
    const need = required(track, level);
    if (track.kind === 'values') return need.filter((x, i) => !track.times.some((t) => Math.abs(t - x) <= nearOf(need, i)));
    // A series reads a block when its readings no longer than half again as long as the block, or declared steady across
    // a longer stretch, cover all of it together; touching the block, or a sliver inside it, is not reading it.
    return need.slice(1).map((b, i) => [need[i], b])
      .filter(([a, b]) => coveredLength(track.readings.filter((r) => r.steady || r.end - r.start <= 1.5 * (b - a) * (1 + 1e-9)), a, b) < (1 - ROUNDING) * (b - a))
      .map(([a, b]) => `${a}–${b}`);
  };
  let reached = 0, upcoming = null, remaining = 0; const later = [];
  for (const { level, blocks } of schedule.levels) {
    const missing = tracks.map((track) => ({ kind: track.kind, id: track.id, label: track.label, at: lacking(track, level) })).filter((item) => item.at.length);
    const count = missing.reduce((n, item) => n + item.at.length, 0);
    // All that the schedule still lacks, counted once at its finest level, whose dates and blocks hold every coarser one.
    if (level === schedule.levels.length) remaining = count;
    if (upcoming) { if (count) later.push({ level, missing: count }); continue; }
    if (missing.length) { upcoming = { level, blocks, missing: count, tracks: missing.length, examples: missing.sort((x, y) => y.at.length - x.at.length || x.id.localeCompare(y.id)).slice(0, 20) }; continue; }
    reached = level;
  }
  const done = reached === schedule.levels.length && !stillEmpty.length && !passedOver.length && !contradictions.length && !flat.length;
  const steadyCount = tracks.reduce((n, track) => n + (track.readings ?? []).filter((r) => r.steady).length, 0);
  // The pass's standing first, in plain words and one count each, so it is never read as done while it is not. For a
  // story the same measure names gaps the story may depend on; it does not hold the story to the grid.
  const left = [remaining ? `the time schedule lacks ${remaining} value(s) or reading(s) in all, counted at its finest level` : null,
    passedOver.length ? `${passedOver.length} process(es) pass over your own Events` : null, flat.length ? `${flat.length} reading(s) are left flat` : null,
    stillEmpty.length ? `${stillEmpty.length} process(es) have no state` : null, contradictions.length ? `${contradictions.length} contradiction(s) are unresolved` : null].filter(Boolean).join('; ');
  const story = storyProfile();
  const status = done
    ? (story
      ? 'By the coverage report\'s measure the world beneath the story has no gaps: every record fills the time schedule, no process is empty, none passes over the Events and no reading is left flat. Bring the prose into line with it; another pass can always move through the world in more depth.'
      : 'This pass is done by the coverage report\'s measure: every record fills the time schedule, no process is empty, none passes over the Events and no reading is left flat. Deliver what the pass set out to make and say you are done for this pass; another pass can always move through the world in more depth, wherever your questions lead.')
    : (story
      ? `By the coverage report's measure the world beneath the story still has gaps: ${left}. Fill the ones the story depends on, in the model and in the prose, and record the rest for another pass with why each can wait.`
      : `By the coverage report's measure this pass is not done: ${left}. Go on with the pass; if you stop sooner, say it is unfinished and what is left.`);
  const next = [status];
  if (upcoming) {
    const example = (item) => (item.kind === 'values' ? `${item.label} at ${item.at.slice(0, 6).join(', ')}` : `"${item.label}" over ${item.at.slice(0, 4).join(', ')}`);
    next.push(`${story ? 'Where the story depends on them, fill the gaps the time schedule shows, level by level' : 'Fill the time schedule level by level'}: level ${upcoming.level} of ${schedule.levels.length} divides ${schedule.from} to ${schedule.to} into ${upcoming.blocks} blocks${schedule.scale === 'log' ? ', finer toward the latest date' : ''}, and ${upcoming.tracks} record(s) still lack ${upcoming.missing} value(s) or reading(s) at this level, such as ${upcoming.examples.slice(0, 2).map(example).join('; ')}. In all, ${remaining} remain, counted at the finest level. Values go in at the dates, a series' readings over the blocks; guess each within the ones around it, and mark a reading steady, with why, where its shares truly hold across a longer stretch: it then covers the finer blocks inside it. A record about one Thing is held only to that Thing's life, its ends and its own Events: name the Thing as a process's subject, or record the series about it.`);
  }
  if (flat.length) next.push(`${flat.length} reading(s) span a stretch of a life where Events happen that no finer reading opens, first "${flat[0].question}" from ${flat[0].from} to ${flat[0].to} over ${flat[0].events} Events (${flat[0].examples.join('; ')}); open them with life_series_plan and life_series_record.`);
  return { done, tracks: tracks.length, holders, schedule: { from: schedule.from, to: schedule.to, scale: schedule.scale, levels: schedule.levels.map(({ level, blocks }) => ({ level, blocks })), reached, remaining,
    ...(upcoming ? { next: upcoming } : {}), ...(later.length ? { later } : {}) }, flatCount: flat.length, ...(flat.length ? { flat: flat.slice(0, 10) } : {}), steadyCount, status, next };
}

// Every Event a lifecycle contains, at any depth.
function descendantsOf(index, eventId) {
  const found = new Set(); const queue = [eventId];
  while (queue.length) { const id = queue.shift(); for (const next of index.children.get(id) ?? []) if (!found.has(next)) { found.add(next); queue.push(next); } }
  return found;
}
