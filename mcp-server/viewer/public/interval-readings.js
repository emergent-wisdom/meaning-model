// Readings that cover an interval. A Cut on an Event with an interval [t, end) is drawn as a level across the whole
// interval: in a series of time-average readings (one question, unit, answers, owner and perspective), it is the
// average over that interval, not a point joined to the next reading by a line.
//
// Readings nested inside a longer reading are its detail. A longer reading opens when a reading directly inside it is
// wide enough to see at the current zoom, so a few weeks read on their own beside quarters do not hide the quarters;
// when none is, it stands for them, and its own level is drawn. Once open,
// its finer readings are drawn, and the time they leave uncovered shows the derived level that time must average for
// the longer reading to hold. That level constrains the average over those years; it does not say the value stayed
// there. When the finer readings already take more than the longer reading allows, no level can hold and none is
// drawn. A moment reading (end equal to t) shows as a narrow mark. Where no reading covers a time, there is no value:
// unrecorded time is unknown.

const spanOf = (point) => (Number.isFinite(point.end) && point.end > point.t ? point.end - point.t : 0);
const inside = (inner, outer) => inner !== outer && spanOf(inner) > 0 && inner.t >= outer.t && inner.t + spanOf(inner) <= outer.t + spanOf(outer)
  && spanOf(inner) < spanOf(outer);

// The time the readings cover, from the first start to the last end.
export function readingsDomain(points) {
  let start = Infinity; let end = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.t)) continue;
    start = Math.min(start, point.t);
    end = Math.max(end, point.t + spanOf(point));
  }
  return [start, end];
}

// The readings directly inside one reading: inside it and inside no other reading that is itself inside it.
export function directlyInside(points, parent) {
  const within = points.filter((point) => inside(point, parent));
  return within.filter((point) => !within.some((other) => inside(point, other)));
}

// What the time inside a reading that its direct finer readings leave uncovered must average for the reading to hold.
// Returns { coverage, value } with value null when the finer readings already exceed the reading (no level can hold),
// or null when the finer readings overlap one another (no single average to derive) or cover all of it.
export function uncoveredAverage(parent, children) {
  const sorted = [...children].sort((a, b) => a.t - b.t);
  if (sorted.some((child, i) => i && child.t < sorted[i - 1].t + spanOf(sorted[i - 1]))) return null;
  const total = spanOf(parent);
  const coverage = sorted.reduce((sum, child) => sum + spanOf(child) / total, 0);
  if (1 - coverage <= 1e-9) return null;
  const rest = (parent.v - sorted.reduce((sum, child) => sum + (spanOf(child) / total) * child.v, 0)) / (1 - coverage);
  return { coverage, value: rest < -1e-9 || rest > 1 + 1e-9 ? null : Math.min(1, Math.max(0, rest)) };
}

// The level shown at time t. minSpan is the shortest interval wide enough to see at the current zoom; momentHalfWidth
// is how far a moment reading's mark reaches on either side. Returns null where no reading covers t, or
// { point, value, finer, derived }: point is the reading whose level shows (null for a derived level), value the level
// drawn (null when no level can hold), finer the count of readings inside the shown one that cover t but are too fine
// to see, and derived, for uncovered time inside an open reading, { parent, coverage, feasible }.
export function readingAt(points, t, { minSpan = 0, momentHalfWidth = 0 } = {}) {
  let moment = null;
  for (const point of points) {
    if (spanOf(point) === 0 && Math.abs(t - point.t) <= momentHalfWidth && (!moment || Math.abs(t - point.t) < Math.abs(t - moment.t))) moment = point;
  }
  if (moment) return { point: moment, value: moment.v, finer: 0, derived: null };
  const covering = points.filter((point) => spanOf(point) > 0 && t >= point.t && t < point.t + spanOf(point));
  if (!covering.length) return null;
  // Start from the longest reading over t (the later one between two of the same length) and open inward.
  let at = covering.reduce((best, point) => (spanOf(point) > spanOf(best) || (spanOf(point) === spanOf(best) && point.t > best.t) ? point : best));
  for (;;) {
    const children = directlyInside(points, at);
    if (!children.some((child) => spanOf(child) >= minSpan)) {
      return { point: at, value: at.v, finer: covering.filter((point) => inside(point, at)).length, derived: null };
    }
    const next = children.find((child) => t >= child.t && t < child.t + spanOf(child));
    if (next) { at = next; continue; }
    const rest = uncoveredAverage(at, children);
    if (!rest) return { point: at, value: at.v, finer: 0, derived: null };
    return { point: null, value: rest.value, finer: 0, derived: { parent: at, coverage: rest.coverage, feasible: rest.value !== null } };
  }
}

// readingAt prepared for reading one series many times at one resolution: read(t) returns what
// readingAt(points, t, options) returns. The nesting is worked out once, by sorting the readings by start, longest first,
// and keeping a stack, and so is what governs each stretch between reading boundaries, which reads alike throughout.
// Readings whose intervals match another reader's, in the same order, share its work: pass that reader as `like` (the
// answers of one Cut series), and only the values are read anew. Readings that partly overlap, or repeat an interval,
// are read by readingAt itself, once per stretch.
export function prepareReadings(points, { minSpan = 0, momentHalfWidth = 0 } = {}, like = null) {
  const shared = like?.shape;
  const shape = shared && shared.nested && Object.is(shared.minSpan, minSpan) && Object.is(shared.momentHalfWidth, momentHalfWidth)
    && shared.points.length === points.length && shared.points.every((p, i) => Object.is(p.t, points[i].t) && Object.is(spanOf(p), spanOf(points[i])))
    ? shared : readingShape(points, minSpan, momentHalfWidth);
  const spanned = shape.nested ? null : points.filter((point) => spanOf(point) > 0);
  const kept = new Map(), rests = new Map();
  const rest = (node) => {
    if (!rests.has(node)) rests.set(node, uncoveredAverage(points[node], shape.children[node].map((child) => points[child])));
    return rests.get(node);
  };
  const read = (t) => {
    const moment = shape.momentAt(t);
    if (moment >= 0) return { point: points[moment], value: points[moment].v, finer: 0, derived: null };
    const i = shape.stretchAt(t);
    if (i < 0) return null;
    if (!shape.nested) {
      if (!kept.has(i)) kept.set(i, readingAt(spanned, shape.bounds[i], { minSpan }));
      const found = kept.get(i);
      return found && { ...found, derived: found.derived && { ...found.derived } };
    }
    const governs = shape.governs[i];
    if (!governs) return null;
    if (governs.derived) {
      const { coverage, value } = rest(governs.node);
      return { point: null, value, finer: 0, derived: { parent: points[governs.node], coverage, feasible: value !== null } };
    }
    return { point: points[governs.node], value: points[governs.node].v, finer: governs.finer, derived: null };
  };
  read.shape = shape;
  return read;
}

// The value-free part of prepareReadings: the moments in time order, the stretches between reading boundaries, the
// nesting, and for each stretch the reading (with how many finer ones it stands for) or derived level that governs it.
function readingShape(points, minSpan, momentHalfWidth) {
  const index = points.map((_, i) => i);
  const span = points.map(spanOf), end = points.map((point, i) => point.t + span[i]);
  const moments = index.filter((i) => span[i] === 0 && Number.isFinite(points[i].t)).sort((a, b) => points[a].t - points[b].t || a - b);
  const order = index.filter((i) => span[i] > 0 && Number.isFinite(points[i].t)).sort((a, b) => points[a].t - points[b].t || span[b] - span[a] || a - b);
  const bounds = [...new Set(order.flatMap((i) => [points[i].t, end[i]]))].sort((a, b) => a - b);
  const firstAtLeast = (list, key, t) => { let lo = 0, hi = list.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (key(list[mid]) < t) lo = mid + 1; else hi = mid; } return lo; };
  const momentAt = (t) => {
    if (!moments.length || Number.isNaN(t)) return -1;
    const k = firstAtLeast(moments, (i) => points[i].t, t), away = (j) => Math.abs(t - points[moments[j]].t);
    const best = Math.min(k > 0 ? away(k - 1) : Infinity, k < moments.length ? away(k) : Infinity);
    if (!(best <= momentHalfWidth)) return -1;
    // The nearest moment, the first in the readings' order among equally near ones, as readingAt chooses.
    let found = Infinity;
    for (let j = k - 1; j >= 0 && away(j) === best; j -= 1) found = Math.min(found, moments[j]);
    for (let j = k; j < moments.length && away(j) === best; j += 1) found = Math.min(found, moments[j]);
    return found;
  };
  // The stretch [bounds[k], bounds[k + 1]) holding t, or -1 outside every reading.
  const stretchAt = (t) => {
    if (!(t >= bounds[0] && t < bounds.at(-1))) return -1;
    const k = firstAtLeast(bounds, (b) => b, t);
    return bounds[k] === t ? k : k - 1;
  };

  // Sorted by start and then longest first, each reading is either inside the reading on top of the stack, or after it.
  // Anything else (a partial overlap, or one interval read twice) is not a nesting, and readingAt reads it directly.
  const children = points.map(() => []), depth = new Array(points.length).fill(0), roots = [], stack = [];
  let nested = true;
  for (const i of order) {
    while (stack.length && end[stack.at(-1)] <= points[i].t) stack.pop();
    const top = stack.at(-1);
    if (top !== undefined) {
      if (!(end[i] <= end[top] && span[i] < span[top])) { nested = false; break; }
      children[top].push(i); depth[i] = depth[top] + 1;
    } else roots.push(i);
    stack.push(i);
  }
  const shape = { points, minSpan, momentHalfWidth, nested, bounds, momentAt, stretchAt, children: null, governs: null };
  if (!nested) return shape;

  // Children were found in start order, which marks out the gaps between them; readingAt takes them in the readings'
  // order.
  const inOrder = children.map((list) => [...list].sort((a, b) => a - b));
  // Reading i covers the stretches lo[i] to hi[i] - 1.
  const lo = [], hi = [];
  for (const i of order) { lo[i] = firstAtLeast(bounds, (b) => b, points[i].t); hi[i] = firstAtLeast(bounds, (b) => b, end[i]); }
  const gaps = (i, paint) => {
    let from = lo[i];
    for (const child of children[i]) { for (let k = from; k < lo[child]; k += 1) paint(k); from = Math.max(from, hi[child]); }
    for (let k = from; k < hi[i]; k += 1) paint(k);
  };
  const deepest = new Array(Math.max(0, bounds.length - 1)).fill(-1);
  for (const i of order) gaps(i, (k) => { deepest[k] = depth[i]; });
  const governs = new Array(deepest.length).fill(null), reached = new Set(roots);
  for (const i of order) {
    if (!reached.has(i)) continue;
    if (!children[i].some((child) => span[child] >= minSpan)) {
      for (let k = lo[i]; k < hi[i]; k += 1) governs[k] = { node: i, finer: deepest[k] - depth[i] };
      continue;
    }
    for (const child of children[i]) reached.add(child);
    const full = !uncoveredAverage(points[i], inOrder[i].map((child) => points[child]));
    gaps(i, (k) => { governs[k] = full ? { node: i, finer: 0 } : { node: i, derived: true }; });
  }
  return Object.assign(shape, { children: inOrder, governs });
}

// Why a reading has its shares: its own tagged reason in its provenance ("inferred: …", the form life_series_record
// writes), else the description of the Event it sits on. Shown first when the pointer rests on the reading.
const TAGGED = /^(source|inferred|invented|exploring|sketch):\s*([\s\S]+)$/u;
export function readingReason(cut) {
  for (const entry of cut?.provenance ?? []) {
    const match = TAGGED.exec(String(entry).trim());
    if (match) return { tag: match[1], text: match[2].trim() };
  }
  const text = String(cut?.eventDescription ?? '').trim();
  return text ? { tag: null, text } : null;
}

// The modeler's own note of how sure a reading is, when it gives one: a provenance entry "confidence 0.4", the form
// life_series_record writes. It is not calibrated and not an assessment of the evidence.
export function readingConfidence(cut) {
  for (const entry of cut?.provenance ?? []) {
    const match = /^confidence (\d+(?:\.\d+)?)$/u.exec(String(entry).trim());
    if (match && Number(match[1]) <= 1) return Number(match[1]);
  }
  return null;
}

// Visual smoothing for the Smooth slider: a box filter applied twice (a triangle kernel) within each stretch that has
// values, never across a gap, so unrecorded time stays empty and each stretch keeps roughly its average. It changes only
// what is drawn; the recorded readings, and what the pointer reads, stay exact.
export function smoothWithinStretches(values, present, radius) {
  const out = Float64Array.from(values);
  if (!(radius >= 1)) return out;
  for (let i = 0; i < values.length;) {
    if (!present[i]) { i += 1; continue; }
    let j = i; while (j < values.length && present[j]) j += 1;
    let stretch = Float64Array.from(values.slice(i, j));
    for (let pass = 0; pass < 2; pass += 1) {
      const sums = new Float64Array(stretch.length + 1);
      for (let k = 0; k < stretch.length; k += 1) sums[k + 1] = sums[k] + stretch[k];
      const next = new Float64Array(stretch.length);
      for (let k = 0; k < stretch.length; k += 1) {
        const a = Math.max(0, k - radius); const b = Math.min(stretch.length - 1, k + radius);
        next[k] = (sums[b + 1] - sums[a]) / (b - a + 1);
      }
      stretch = next;
    }
    out.set(stretch, i); i = j;
  }
  return out;
}
