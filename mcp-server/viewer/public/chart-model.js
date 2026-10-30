// The Chart: a whole model on one time axis. Across the top, the parts of one Event as the model contains them (the
// Event named by the view's focus); under them the Events, in rows by a declared importance scale, with their causal links; then the
// model's process decomposition, one row per process, each read at one moment: the whole tree, or one process opened as
// its top with only the parts it holds. A process that declares its parts add up to it (scale.aggregate 'sum') shows them
// stacked in its own row. Everything here is read from what the snapshot declares: containment and intervals, importance
// scales, relations, cause assessments, the decomposition and its kinds, declared sums, dated values (as the time views
// project them) and Cut series. Nothing is placed from a name or prose.
import { typedScalarTrajectories } from './scalar-trajectories.js';
import { cutTrajectories } from './cut-trajectories.js';
import { temporalWindow, isCalendarTime, calendarDateOf, calendarTimeOf, calendarTickAt, numericTimeTicks, nativeTimeText } from './temporal-layout.js';

// Records of the world (and of a model that declares no roots). A person's inner process is drawn in rows of its own;
// readings and any other context (a holder's understanding, a document) are never drawn as Events of the world.
const WORLD = new Set(['accepted_world', 'unrooted']);
const CAUSAL = new Set(['causes', 'enables', 'prevents', 'constrains', 'realizes_forecast']);

// How a value is known, in START_HERE's words. A tag the model uses that is not one of these keeps its own word.
export const TAGS = {
  source: { word: 'from a source', long: 'Source: stated by the text or the evidence', style: 'source' },
  inferred: { word: 'inferred', long: 'Inferred: implied by the source; a careful reader would likely conclude the same', style: 'inferred' },
  invented: { word: 'invented', long: 'Invented: in no source; authored to make the work richer or to explain it', style: 'invented' },
  exploring: { word: 'exploring', long: 'Exploring: an idea being tried and tested for fit, not yet relied on', style: 'rough' },
  sketch: { word: 'sketched', long: 'Sketch: drawn quickly and roughly to see the shape, to be opened or redrawn later', style: 'rough' },
};
const TAG_RANK = { source: 5, inferred: 4, invented: 3, exploring: 2, sketch: 1 };
export const tagOf = (value) => {
  const word = String(value ?? '').split(':')[0].trim().toLowerCase();
  return word === 'sourced' ? 'source' : word || null;
};
// Between two readings the line is only as sure as the less sure of them.
export const weaker = (a, b) => ((TAG_RANK[a] ?? 0) <= (TAG_RANK[b] ?? 0) ? a : b);
export const tagWord = (tag) => TAGS[tag]?.word ?? tag ?? '';
export const tagStyle = (tag) => TAGS[tag]?.style ?? 'rough';

// ---- time ------------------------------------------------------------------------------------------------------------------
// The axis is even unless the records crowd toward its end: when half of them lie in the last thirtieth of the span, time
// is drawn as distance before the end on a log scale, so the recent part keeps room and the deep past is squeezed. The
// knee (time added before the logarithm) is a tenth of the median distance, so the crowded stretch is nearly even.
export function chartAxis(window, times) {
  const span = window.end - window.start;
  const before = times.filter((t) => Number.isFinite(t) && t >= window.start && t <= window.end).map((t) => window.end - t).sort((a, b) => a - b);
  if (before.length < 4 || !(span > 0)) return { kind: 'linear', start: window.start, end: window.end };
  const median = before[Math.floor(before.length / 2)];
  if (span / Math.max(median, span * 1e-9) <= 30) return { kind: 'linear', start: window.start, end: window.end };
  return { kind: 'log', start: window.start, end: window.end, knee: Math.max(median / 10, span * 1e-6) };
}
// The axis as a fraction of its width, 0 at the start and 1 at the end.
export function axisFraction(axis) {
  if (axis.kind === 'linear') { const span = axis.end - axis.start || 1; return (t) => (t - axis.start) / span; }
  const g = (t) => Math.log(Math.max(axis.end - t, 0) + axis.knee);
  const a = g(axis.start), b = g(axis.end);
  return (t) => (a - g(t)) / (a - b);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// A moment in the model's own clock, at a precision that suits the span being read (as the time views say it).
export function timeLabel(t, { unit, present, span = Infinity }) {
  if (!Number.isFinite(t)) return '';
  if (!isCalendarTime(unit)) return nativeTimeText(t, unit);
  if (present - t >= 5000) { const ago = present - t; const round = ago >= 100000 ? 10000 : ago >= 20000 ? 1000 : 100; return `${grouped(Math.round(ago / round) * round)} years ago`; }
  // A decimal year is the year it falls in (2025.9 is late 2025); before 1 CE the nearest year is named.
  if (span > 30 || t < 1) { const year = t >= 1 ? Math.floor(t) : Math.round(t); return year < 0 ? `${grouped(-year)} BCE` : year <= 1 ? '1 CE' : `${year}`; }
  const date = calendarDateOf(t, unit);
  if (span > 1.5) return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return span < 7 / 365.2425 ? `${day}, ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}` : day;
}
export function lengthLabel(a, b, unit) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  if (!isCalendarTime(unit)) return nativeTimeText(b - a, unit);
  const years = b - a;
  if (years >= 2) return `${grouped(years >= 1000 ? Math.round(years / 10) * 10 : years)} years`;
  if (years >= 2 / 12) return `${Math.round(years * 12)} months`;
  return `${Math.max(1, Math.round(years * 365.2425))} days`;
}
// Tick marks for the axis: round numbers that the axis has room for at its width. On a squeezed calendar axis, deep time
// is marked in years before the end and recent time in calendar years.
// Candidates are tried roundest first, and each is kept only where its label has room.
export function axisTicks(axis, unit, present, widthPx, labelWidth = (text) => text.length * 6.5) {
  const frac = axisFraction(axis);
  const span = axis.end - axis.start;
  const candidates = []; // [t, text]
  const year = (y) => [calendarTickAt(y, 0, 1, unit), y < 0 ? `${grouped(-y)} BCE` : y <= 1 ? '1 CE' : `${y}`];
  if (isCalendarTime(unit) && axis.kind === 'log') {
    for (const ago of [1e9, 1e8, 1e7, 1e6, 3e5, 1e5, 3e4, 1e4]) if (present - ago >= axis.start) candidates.push([present - ago, `${grouped(ago)} years ago`]);
    // Calendar years from the first round thousand on, finer steps only where recent time has room for them.
    for (const [step, within] of [[1000, 9000], [1, 9000], [500, 9000], [100, 9000], [50, 9000], [25, 150], [10, 60]]) {
      const from = step === 1 ? 1 : Math.ceil(Math.max(axis.start, present - within) / step) * step;
      for (let y = from; y <= axis.end && (step !== 1 || y === 1); y += step) if (y !== 0) candidates.push(year(y));
    }
  } else if (isCalendarTime(unit) && span > 3) {
    for (const t of numericTimeTicks(axis.start, axis.end)) candidates.push(year(Math.round(t)));
  } else if (isCalendarTime(unit) && span > 0.25) {
    for (const every of [12, 6, 3, 1]) for (let y = Math.floor(axis.start); y <= Math.ceil(axis.end); y += 1) for (let month = 0; month < 12; month += every) {
      candidates.push([calendarTickAt(y, month, 1, unit), month === 0 ? `${y}` : `${MONTHS[month]} ${y}`]);
    }
  } else if (isCalendarTime(unit)) {
    // Days, and hours when the span is a few days or less, at midnight and round hours of the model's calendar.
    const DAY = 1 / 365.2425, first = calendarDateOf(axis.start, unit);
    const midnight = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
    const atMs = (ms) => calendarTimeOf(new Date(ms), unit);
    for (const [stepHours, minSpanDays] of [[24 * 7, 30], [24, 0], [12, 0], [6, 0], [3, 0], [1, 0]]) {
      if (span / DAY < minSpanDays) continue;
      for (let ms = midnight; atMs(ms) <= axis.end; ms += stepHours * 3600000) {
        const date = new Date(ms);
        candidates.push([atMs(ms), date.getUTCHours() === 0 ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` : `${String(date.getUTCHours()).padStart(2, '0')}:00`]);
      }
    }
  } else {
    if (axis.kind === 'log') for (const before of [1e9, 1e8, 1e7, 1e6, 1e5, 1e4, 1e3, 100, 10]) candidates.push([present - before, nativeTimeText(present - before, unit)]);
    for (const t of numericTimeTicks(axis.start, axis.end)) candidates.push([t, nativeTimeText(t, unit)]);
  }
  const taken = [];
  for (const [t, text] of candidates) {
    if (!(t >= axis.start && t <= axis.end)) continue;
    const x = frac(t) * widthPx, w = labelWidth(text);
    if (taken.some((other) => x - w / 2 < other.right + 14 && x + w / 2 > other.left - 14)) continue;
    taken.push({ t, text, left: x - w / 2, right: x + w / 2 });
  }
  return taken.sort((a, b) => a.t - b.t).map(({ t, text }) => ({ t, text }));
}

// ---- parts across the top -----------------------------------------------------------------------------------------------------
// The parts of one Event, as the model contains them, each across its own span. Nothing is picked out or renamed:
// parts that overlap share the head in lanes, each part in the first lane where it starts after the last one ends.
export function packLanes(items) {
  const ends = [];
  return [...items].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || String(a.id).localeCompare(String(b.id))).map((part) => {
    let lane = ends.findIndex((end) => part.start >= end);
    if (lane < 0) { lane = ends.length; ends.push(part.end); } else ends[lane] = part.end;
    return { ...part, lane };
  });
}

// ---- the model as the chart reads it ------------------------------------------------------------------------------------------
export function chartModel(data) {
  const model = data?.inspection?.model ?? {};
  const mm = model.meaning_model ?? {};
  const unit = String(data?.timeUnit ?? model.time_unit ?? '');
  const window = temporalWindow(data ?? {});
  if (!window) return { available: false, reason: 'This snapshot has no declared time axis.' };

  // Events: the world's, with their own intervals.
  const allEvents = (data.events ?? []).filter((e) => Number.isFinite(e.start));
  const byId = new Map((data.events ?? []).map((e) => [e.id, e]));
  const kids = new Map();
  for (const e of data.events ?? []) if (e.parent) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e); }
  const endOf = (e) => (Number.isFinite(e.end) ? e.end : e.start);
  const item = (e) => ({ id: e.id, label: e.label ?? e.id, text: e.description ?? null, start: e.start, end: endOf(e), parent: e.parent ?? null,
    context: e.context ?? null, role: e.role ?? null, processIds: e.processIds ?? [], region: e.region ?? null });
  const isWorld = (e) => WORLD.has(e.context ?? 'accepted_world') && e.role !== 'reading';

  // The wholes whose parts the head can lay out: world Events with dated parts. Which one is shown is a view setting
  // (focus), chosen by the reader or by the model's recorded view, never by the chart.
  const datedParts = (id) => (kids.get(id) ?? []).filter((k) => isWorld(k) && Number.isFinite(k.start)).map(item);
  const partsOf = (id) => packLanes(datedParts(id));
  const wholes = allEvents.filter((e) => isWorld(e) && datedParts(e.id).length)
    .map((e) => ({ id: e.id, label: e.label ?? e.id, depth: e.depth ?? 0, start: e.start, parts: datedParts(e.id).length }));

  // Importance: the scale that ranks the most Events, unless another is asked for; rows follow its levels.
  const ratings = mm.event_importance ?? [];
  const scales = (data.importance?.scales ?? []).map((scale) => ({ ...scale, count: new Set(ratings.filter((r) => r.scale_id === scale.id).map((r) => r.event_id)).size }))
    .filter((scale) => scale.count > 0);
  const scaleChoices = [...scales].sort((a, b) => b.count - a.count);

  // Causes weighed: each why-question an Event answers, with its causes ranked by the difference each made alone.
  const whyOf = new Map();
  for (const q of data.causes ?? []) { if (!whyOf.has(q.outcome)) whyOf.set(q.outcome, []); whyOf.get(q.outcome).push(q); }

  // Event rows: by importance level when a scale is chosen, then the Events it does not rank; inner processes apart.
  // Lifecycles are the frames of the rows of processes below, not Events in a row.
  const drawn = allEvents.filter((e) => !['world', 'life', 'inner'].includes(e.role) && e.role !== 'reading' && (isWorld(e) || e.context === 'inner'));
  const contextLabel = new Map((data.contexts ?? []).map((c) => [c.eventId, c]));
  const rootOf = (e) => { for (let at = e, hops = 0; at && hops < 256; at = byId.get(at.parent), hops += 1) if (contextLabel.has(at.id)) return at.id; return null; };
  const nameOf = (id) => (data.referents ?? []).find((r) => r.id === id)?.name ?? (data.people ?? []).find((p) => p.id === id)?.name ?? labelFromId(id);
  // Events laid out across the top (hidden) are not drawn again in a row.
  function eventRows(scaleId, hidden = new Set()) {
    const scale = scales.find((s) => s.id === scaleId) ?? null;
    const levelOf = new Map(scale ? ratings.filter((r) => r.scale_id === scale.id).map((r) => [r.event_id, r.level]) : []);
    const rows = []; const rowOf = new Map();
    const add = (key, label, title) => { if (!rowOf.has(key)) { const row = { key, label, title, events: [] }; rows.push(row); rowOf.set(key, row); } return rowOf.get(key); };
    if (scale) for (const level of [...(scale.levels ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) add(`level:${level.key}`, levelName(level.key), level.anchor ?? null);
    for (const e of drawn) {
      if (hidden.has(e.id)) continue;
      if (e.context === 'inner') {
        const root = rootOf(e); const context = contextLabel.get(root);
        add(`inner:${root}`, `Inner: ${context?.holder ? nameOf(context.holder) : context?.label ?? root}`, 'Events inside a person\'s inner process, drawn apart from the world\'s Events').events.push(e.id);
        continue;
      }
      const level = levelOf.get(e.id);
      if (scale && level) add(`level:${level}`, levelName(level), null).events.push(e.id);
      else add('rest', scale ? 'Not ranked' : 'Events', scale ? `Events this scale does not rank` : null).events.push(e.id);
    }
    return rows.filter((row) => row.events.length);
  }
  const events = drawn.map((e) => ({ ...item(e), weighed: whyOf.has(e.id) }));
  const dated = allEvents.filter((e) => isWorld(e) || e.context === 'inner').map((e) => ({ ...item(e), weighed: whyOf.has(e.id) }));

  // Causal links between the dated Events the chart can draw, in a row or across the top.
  const shown = new Set(dated.map((e) => e.id));
  const links = (data.relations ?? []).filter((r) => CAUSAL.has(r.kind) && shown.has(r.source) && shown.has(r.target))
    .map((r) => ({ id: r.id, from: r.source, to: r.target, kind: r.kind, text: r.description ?? null }));

  // ---- rows: the process decomposition, one row per process with dated values ------------------------------------------------
  const processes = new Map((model.processes ?? []).map((p) => [p.id, p]));
  const viewerProcess = new Map((data.processes ?? []).map((p) => [p.id, p]));
  const series = typedScalarTrajectories(data);
  const seriesOf = new Map();
  for (const s of series) { if (!seriesOf.has(s.processId)) seriesOf.set(s.processId, []); seriesOf.get(s.processId).push(s); }
  const label = (id) => processes.get(id)?.scale?.label ?? labelFromId(id);
  const about = (id) => {
    const role = processes.get(id)?.scale?.semantic_role ?? null; if (!role) return null;
    const prefix = `${label(id)}:`; return role.startsWith(prefix) ? role.slice(prefix.length).trim() || null : role;
  };
  const edges = model.decomposition ?? [];
  const childEdges = new Map(), parentsOf = new Map();
  for (const edge of edges) {
    if (!childEdges.has(edge.parent)) childEdges.set(edge.parent, []); childEdges.get(edge.parent).push(edge);
    if (!parentsOf.has(edge.child)) parentsOf.set(edge.child, []); parentsOf.get(edge.child).push(edge.parent);
  }
  // A process earns a row when it has dated values or holds one that does.
  const valued = new Map();
  const hasValues = (id, seen = new Set()) => {
    if (valued.has(id)) return valued.get(id);
    if (seen.has(id)) return false; seen.add(id);
    const own = (seriesOf.get(id) ?? []).length > 0 || (childEdges.get(id) ?? []).some((edge) => hasValues(edge.child, seen));
    valued.set(id, own); return own;
  };
  // The parts a process declares add up to it. scale.aggregate 'sum' is the process's own statement; nothing is inferred
  // from units that happen to match. As the engine compares a sum with its parts, only parts in the process's own unit
  // are added up (the others are listed, with why), and only one holder's account at a time: a part is stacked when it
  // has exactly one series held by the one that holds the row. The layers stand on zero, so a part, or a whole, that
  // has a value below zero is listed instead of stacked. A mean, or any other aggregate, is never stacked.
  const unitOf = (id) => String(processes.get(id)?.unit ?? seriesOf.get(id)?.[0]?.unit ?? '');
  function layersOf(id, s) {
    const whole = processes.get(id);
    if (whole?.scale?.aggregate !== 'sum' || whole.value_type?.kind !== 'scalar' || !s || s.states) return null;
    const unit = unitOf(id), below = (x) => x.points.some((p) => p.v < 0), wholeBelow = below(s);
    const members = [], listed = [], seen = new Set();
    for (const edge of childEdges.get(id) ?? []) {
      const part = edge.child;
      if (part === id || seen.has(part)) continue;
      seen.add(part);
      const unlisted = (why) => listed.push({ id: part, label: label(part), why });
      if (processes.get(part)?.value_type?.kind !== 'scalar') { unlisted('not a number'); continue; }
      if (unitOf(part) !== unit) { unlisted(`its unit, ${unitOf(part) || 'none stated'}, is not ${unit || 'none stated'}`); continue; }
      const all = seriesOf.get(part) ?? [];
      if (!all.length) { unlisted('no dated values'); continue; }
      const mine = all.filter((x) => (x.holder ?? null) === (s.holder ?? null));
      if (!mine.length) { unlisted('held by someone else'); continue; }
      if (mine.length > 1) { unlisted('several series of its holder'); continue; }
      if (mine[0].states) { unlisted('not a number'); continue; }
      if (below(mine[0])) { unlisted('has values below zero'); continue; }
      if (wholeBelow) { unlisted('the whole has values below zero'); continue; }
      members.push({ id: part, label: label(part), about: about(part), series: mine[0] });
    }
    const layers = { members, listed, times: [], gap: false, over: false, exceeds: [], top: 0, peak: Math.max(0, ...s.points.map((p) => p.v)) };
    if (!members.length) return layers;
    // Where the whole and every stacked part are recorded, at the dates any of them is recorded.
    const every = [s, ...members.map((m) => m.series)];
    const from = Math.max(...every.map((x) => x.points[0].t)), to = Math.min(...every.map((x) => x.points.at(-1).t));
    const times = from < to ? [...new Set(every.flatMap((x) => x.points.map((p) => p.t)).filter((t) => t >= from && t <= to))].sort((a, b) => a - b) : [];
    if (!times.length) {
      // No stretch holds them all, so there is nothing to stack: they are listed, as any part not stacked is.
      for (const m of members.splice(0)) listed.push({ id: m.id, label: m.label, why: 'not recorded over a stretch where the whole and the other parts are' });
      return layers;
    }
    layers.times = times;
    for (const t of layers.times) {
      const r = readLayers(s, layers, t); if (!r) continue;
      layers.top = Math.max(layers.top, r.whole.v, r.sum, Number.isFinite(r.whole.hi) ? r.whole.hi : 0);
      layers.gap ||= r.gap > 0;
      if (r.over > 0) layers.exceeds.push({ t, by: r.over, sum: r.sum, inRange: r.inRange });
    }
    layers.over = layers.exceeds.length > 0;
    return layers;
  }
  const rows = []; const placed = new Set();
  const lineRows = (id, depth, parent, via = parent) => {
    const list = seriesOf.get(id) ?? [];
    const base = { id, kind: 'measure', process: id, label: label(id), about: about(id), unit: processes.get(id)?.unit ?? list[0]?.unit ?? '', depth, parent,
      alsoUnder: (parentsOf.get(id) ?? []).filter((p) => p !== via) };
    const stacked = (s, alone) => { const layers = alone ? layersOf(id, s) : null; return layers ? { layers } : {}; };
    if (list.length <= 1) return [{ ...base, children: [], series: list[0] ?? null, holder: list[0]?.holder ?? null, holders: 1, apart: null, ...stacked(list[0], true) }];
    // Each series' values stay their own: one row each, named by whose they are and, where one holder has several, by
    // what else tells them apart. The first row is the process's own; the others take the series' identity, or their
    // place when that is missing or taken, counting on from there until the id is free.
    const used = new Set([id]);
    return list.map((s, i) => {
      let rowId = id;
      if (i) { rowId = s.id !== undefined && s.id !== null ? `${id}~${s.id}` : `${id}~${i}`; for (let k = i; used.has(rowId); k += 1) rowId = `${id}~${k}`; }
      used.add(rowId);
      const apart = apartOf(s, list);
      return { ...base, id: rowId, children: [], series: s, holder: s.holder ?? null, holders: list.length, apart, ...stacked(s, apart === null) };
    });
  };
  // The walk places a process and what it holds, once each, into the rows it is given. The whole tree walks from its
  // roots; opening a process walks from it alone, with a record of its own, so a part that has two parents is drawn under
  // whichever of them is opened.
  const makeWalk = (into, taken) => function walk(id, depth, parent, via = parent) {
    if (taken.has(id) || !hasValues(id)) return null;
    taken.add(id);
    const own = lineRows(id, depth, parent, via);
    into.push(...own);
    const node = own[0];
    const children = (childEdges.get(id) ?? []).filter((edge) => !taken.has(edge.child) && hasValues(edge.child));
    // Parts that the model declares as an observational partition of this process, with no parts of their own, divide
    // one whole: when each has one series, all held by one holder in one unit, they are drawn together, stacked.
    // Otherwise no total is implied: each part keeps its own row, named by whose it is. A process that declares the
    // sum of its parts already shows these, stacked in its own row, and its parts keep rows of their own.
    const partition = children.filter((edge) => edge.kind === 'observational_partition' && !(childEdges.get(edge.child) ?? []).some((e) => hasValues(e.child)));
    const memberSeries = partition.map((edge) => seriesOf.get(edge.child) ?? []);
    const units = new Set(partition.map((edge, i) => processes.get(edge.child)?.unit ?? memberSeries[i][0]?.unit ?? ''));
    const holders = new Set(memberSeries.map((list) => list[0]?.holder ?? null));
    const shown = own.some((row) => row.holder === [...holders][0] && row.layers?.members.length && partition.every((edge) => row.layers.members.some((m) => m.id === edge.child)));
    if (partition.length >= 2 && memberSeries.every((list) => list.length === 1) && holders.size === 1 && units.size === 1 && !shown) {
      const stack = { id: `stack:${id}`, kind: 'stack', label: `${label(id)}, divided`, about: `The parts the model declares as dividing ${label(id)}, stacked`,
        unit: [...units][0], holder: [...holders][0], depth: depth + 1, parent: id, children: [],
        members: partition.map((edge) => ({ id: edge.child, label: label(edge.child), about: about(edge.child), series: seriesOf.get(edge.child)[0] })) };
      for (const edge of partition) taken.add(edge.child);
      into.push(stack); node.children.push(stack.id);
    }
    // Every row a part generates is held by this process, so folding it hides them all.
    for (const edge of children) {
      if (taken.has(edge.child)) continue;
      const child = walk(edge.child, depth + 1, id);
      if (child) node.children.push(...child.map((row) => row.id));
    }
    return own;
  };
  const walk = makeWalk(rows, placed);
  // The top of the tree: the decomposition's roots, then the processes it does not reach. When these belong to more than
  // one Event (a life, a development), each is drawn under the Event that holds it.
  const reach = new Set(); const down = (id) => { if (reach.has(id)) return; reach.add(id); for (const edge of childEdges.get(id) ?? []) down(edge.child); };
  const roots = [...new Set(edges.map((edge) => edge.parent))].filter((id) => !parentsOf.has(id) && hasValues(id));
  roots.forEach(down);
  const topLevel = [...roots, ...[...seriesOf.keys()].filter((id) => !reach.has(id))];
  const homeOf = (id) => viewerProcess.get(id)?.home ?? null;
  const homes = [...new Set(topLevel.map(homeOf))].sort((a, b) => (byId.get(a)?.start ?? -Infinity) - (byId.get(b)?.start ?? -Infinity) || String(a).localeCompare(String(b)));
  if (homes.length > 1) {
    for (const home of homes) {
      const event = byId.get(home);
      const group = { id: `group:${home}`, kind: 'group', label: event?.label ?? (home ? labelFromId(home) : 'Other processes'), event: home,
        start: event?.start ?? null, end: event ? endOf(event) : null, depth: 0, parent: null, children: [] };
      rows.push(group);
      for (const id of topLevel.filter((item) => homeOf(item) === home)) { const own = walk(id, 1, group.id); if (own) group.children.push(...own.map((row) => row.id)); }
      if (!group.children.length) rows.splice(rows.indexOf(group), 1);
    }
  } else for (const id of topLevel) walk(id, 0, null);

  // Cut series: one question asked again and again over time, its answers dividing one pool; stacked, with what the
  // answers leave open shown as the remainder, never spread over the answers.
  const cutRows = cutTrajectories(data);
  const cutSeries = new Map();
  for (const row of cutRows) { if (!cutSeries.has(row.series.key)) cutSeries.set(row.series.key, []); cutSeries.get(row.series.key).push(row); }
  if (cutSeries.size) {
    const group = { id: 'group:cuts', kind: 'group', label: 'Shares recorded over time', about: 'Cuts asked again and again: each divides one pool among its answers', depth: 0, parent: null, children: [] };
    rows.push(group);
    for (const [key, answers] of cutSeries) {
      const first = answers[0];
      const row = { id: `cut-series:${key}`, kind: 'cut-series', label: first.question, about: null, unit: first.unit, depth: 1 + (first.level ?? 0), parent: group.id, children: [],
        owner: first.group?.label ?? null, members: answers.map((answer) => ({ id: answer.id, key: answer.answerKey, label: answer.label, remainder: answer.remainder, points: answer.points })) };
      rows.push(row); group.children.push(row.id);
    }
  }

  // The tree as a reader can open it: a process that has a row and takes part in the decomposition (as a part or as what has
  // parts) can be the top, drawing it and the parts it holds; without a decomposition nothing can be opened. Its path is
  // the chain of processes above it in the whole tree, from the one at the top of its branch. A row can be looked up
  // (rowOf) for any process that has one, opened or not.
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const rowOfProcess = new Map();
  for (const row of rows) if (row.kind === 'measure' && !rowOfProcess.has(row.process)) rowOfProcess.set(row.process, row);
  const upOf = (id) => { const above = rowById.get(rowOfProcess.get(id)?.parent); return above?.kind === 'measure' ? above.process : null; };
  function pathTo(id) {
    const path = [];
    for (let at = rowOfProcess.get(id), hops = 0; at?.kind === 'measure' && hops < 256; at = rowById.get(at.parent), hops += 1) path.unshift({ id: at.process, label: at.label });
    return path;
  }
  const opened = new Map();
  function treeFrom(id) {
    if (!rowOfProcess.has(id) || !(childEdges.has(id) || parentsOf.has(id))) return null;
    if (!opened.has(id)) {
      const part = [], up = upOf(id);
      makeWalk(part, new Set())(id, 0, null, up);
      part[0].up = up;
      opened.set(id, { rows: part, path: pathTo(id), has: new Set(part.filter((row) => row.kind === 'measure').map((row) => row.process)) });
    }
    return opened.get(id);
  }
  // Tags the drawn values carry, so the key lists only those.
  const tagCounts = tagCountsOf(rows);

  const times = [...events.flatMap((e) => [e.start]), ...series.flatMap((s) => s.points.map((p) => p.t))];
  const axis = chartAxis(window, times);
  const present = Math.max(window.end, ...(data.extent?.end ? [data.extent.end] : []));
  // Where the rows are read until the reader points elsewhere: the latest dated value (values stop at their last sample),
  // else the latest moment an Event reaches.
  const valueTimes = [...series.flatMap((s) => s.points.map((p) => p.t)), ...cutRows.flatMap((r) => r.points.map((p) => p.t))].filter((t) => Number.isFinite(t) && t <= window.end);
  const recorded = valueTimes.length ? valueTimes : events.map((e) => e.end).filter((t) => Number.isFinite(t) && t <= window.end);
  const latest = recorded.length ? Math.max(...recorded) : window.end;
  // The rows are first read at the latest moment when the most of them have a value, so a model of lives that end
  // before its last record does not open on empty rows.
  const domains = series.map((s) => [s.points[0].t, s.points.at(-1).t]);
  let readAt = latest, most = -1;
  for (const t of [...new Set(valueTimes)].sort((a, b) => b - a)) {
    const count = domains.reduce((n, [a, b]) => n + (t >= a && t <= b ? 1 : 0), 0);
    if (count > most) { most = count; readAt = t; }
  }
  return {
    available: true, unit, calendar: isCalendarTime(unit), window, axis, present, latest, readAt,
    wholes, partsOf, events, eventRows, scaleChoices: scaleChoices.map((s) => ({ id: s.id, audience: s.audience ?? null, count: s.count })),
    defaultScale: scaleChoices[0]?.id ?? null, links, why: whyOf, rows, tagCounts,
    tree: { rowOf: (id) => rowOfProcess.get(id) ?? null, from: treeFrom, path: pathTo, up: upOf },
    unvalued: (model.processes ?? []).filter((p) => !String(p.id).startsWith('profile.') && !seriesOf.has(p.id) && !placed.has(p.id)).length,
    byId: new Map(dated.map((x) => [x.id, x])),
  };
}

function levelName(key) {
  const top = String(key).match(/^top_(\d+)$/u);
  if (top) return `Top ${Number(top[1]).toLocaleString('en-US')}`;
  const words = String(key).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
// What tells a series from the others of its process with the same holder: its mode, its source or its scope, as each
// is declared, naming only those that differ; with nothing declared to tell them apart, its place among them.
const sourceOf = (s) => s.source?.seriesId ?? s.source?.bundleNodeId ?? s.source?.kind ?? null;
const scopeOf = (s) => [...new Set((s.points ?? []).flatMap((p) => p.accessScopes ?? []))].sort().join(', ') || null;
function apartOf(s, list) {
  const same = list.filter((other) => (other.holder ?? null) === (s.holder ?? null));
  if (same.length < 2) return null;
  const differs = (read) => new Set(same.map(read)).size > 1;
  const bits = [differs((x) => x.mode ?? null) && s.mode, differs(sourceOf) && sourceOf(s) && `from ${sourceOf(s)}`,
    differs(scopeOf) && scopeOf(s) && `scope ${scopeOf(s)}`].filter(Boolean);
  return bits.length ? bits.join(' · ') : `series ${same.indexOf(s) + 1} of ${same.length}`;
}
function labelFromId(id) {
  const words = String(id).split('.').at(-1).replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// How often each tag appears among the values the given rows draw as lines or stacks.
export function tagCountsOf(rows) {
  const counts = {};
  const count = (s) => { for (const p of s?.points ?? []) { const tag = tagOf(p.tag); if (tag) counts[tag] = (counts[tag] ?? 0) + 1; } };
  for (const row of rows) { if (row.kind === 'measure') count(row.series); if (row.kind === 'stack') row.members.forEach((m) => count(m.series)); }
  return counts;
}

// ---- a declared sum, read at one moment ---------------------------------------------------------------------------------------
// The whole and each stacked part are read as any series is; where one of them has no value there is no reading. What the
// whole holds beyond its parts is its gap, and what the parts hold beyond the whole is the excess. Either counts once it is
// more than a hundredth of the whole (the engine's own floor for comparing a sum with its parts), so values that agree to
// rounding show neither. Beside that, a difference must matter to the row: more than a tenth of a percent of the highest
// the whole reaches for an excess, which is marked at its date, and more than half a percent for a gap, which is a layer
// to be drawn and so must be as much as the row can show. Rounding at the faint start of a series is neither. The whole's
// stated range does not hide a difference, but a sum that lies inside that range says so.
function readLayers(whole, layers, t) {
  const w = readSeries(whole, t); if (!w) return null;
  const parts = layers.members.map((m) => readSeries(m.series, t));
  if (parts.some((r) => !r)) return null;
  let sum = 0; const tops = parts.map((r) => (sum += r.v));
  const tolerance = Math.max(Math.abs(w.v) * 0.01, 1e-9), marked = Math.max(tolerance, layers.peak * 0.001), drawable = Math.max(tolerance, layers.peak * 0.005);
  const inRange = Number.isFinite(w.lo) && Number.isFinite(w.hi) && sum >= w.lo && sum <= w.hi;
  return { whole: w, parts, tops, sum, gap: w.v - sum > drawable ? w.v - sum : 0, over: sum - w.v > marked ? sum - w.v : 0, inRange, between: [w, ...parts].some((r) => r.between) };
}
export const layerReading = (row, t) => (row?.layers?.members.length && row.series ? readLayers(row.series, row.layers, t) : null);

// ---- reading a row at one moment ------------------------------------------------------------------------------------------------
// A dated series is read along the straight line between its samples (a visual guide, marked as between samples), and
// not at all before its first sample or after its last: unrecorded time stays empty.
export function readSeries(s, t) {
  const points = s?.points ?? [];
  if (!points.length || t < points[0].t || t > points.at(-1).t) return null;
  const step = s.interpolation?.kind === 'step-hold';
  for (let i = 0; i < points.length; i += 1) {
    const b = points[i];
    if (t === b.t) return { v: b.v, lo: b.uncertainty?.lower, hi: b.uncertainty?.upper, tag: tagOf(b.tag), between: false, point: b, state: b.state ?? null };
    if (t < b.t) {
      const a = points[i - 1];
      if (step) return { v: a.v, lo: a.uncertainty?.lower, hi: a.uncertainty?.upper, tag: tagOf(a.tag), between: false, point: a, state: a.state ?? null };
      const f = (t - a.t) / (b.t - a.t);
      const mix = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * f : undefined);
      return { v: mix(a.v, b.v), lo: mix(a.uncertainty?.lower, b.uncertainty?.lower), hi: mix(a.uncertainty?.upper, b.uncertainty?.upper),
        tag: weaker(tagOf(a.tag), tagOf(b.tag)), between: true, point: null, state: null };
    }
  }
  return null;
}
