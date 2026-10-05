// Readings that cover an interval. A Cut on an Event with an interval [t, end) is drawn as a level across the whole
// interval: in a series of time-average readings (one question, unit, answers, owner and perspective), it is the
// average over that interval, not a point joined to the next reading by a line.
//
// Readings nested inside a longer reading are its detail. A longer reading opens when every reading directly inside
// it is wide enough to see at the current zoom; otherwise it stands for them, and its own level is drawn. Once open,
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
    if (!children.length || children.some((child) => spanOf(child) < minSpan)) {
      return { point: at, value: at.v, finer: covering.filter((point) => inside(point, at)).length, derived: null };
    }
    const next = children.find((child) => t >= child.t && t < child.t + spanOf(child));
    if (next) { at = next; continue; }
    const rest = uncoveredAverage(at, children);
    if (!rest) return { point: at, value: at.v, finer: 0, derived: null };
    return { point: null, value: rest.value, finer: 0, derived: { parent: at, coverage: rest.coverage, feasible: rest.value !== null } };
  }
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
