// Readings that cover an interval. A Cut on an Event with an interval [t, end) is the average over that interval, so it
// is drawn as a level across the whole interval, not as a point joined to the next reading by a line. Readings nested
// inside a longer one are its detail: at a given zoom, each time shows the finest reading that is wide enough to see,
// and the longer reading stands in for detail too fine to show. A moment reading (end equal to t) is the finest of all
// and shows as a narrow mark. Where no reading covers a time, there is no value: unrecorded time is unknown.

const spanOf = (point) => (Number.isFinite(point.end) && point.end > point.t ? point.end - point.t : 0);

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

// The reading shown at time t. minSpan is the shortest interval wide enough to see at the current zoom; momentHalfWidth
// is how far a moment reading's mark reaches on either side. Returns { point, finer } where finer counts covering
// readings too fine to show at this zoom, or null where no reading covers t.
export function readingAt(points, t, { minSpan = 0, momentHalfWidth = 0 } = {}) {
  let moment = null; let shown = null; let coarsest = null; let finer = 0;
  for (const point of points) {
    const span = spanOf(point);
    if (span === 0) {
      if (Math.abs(t - point.t) <= momentHalfWidth && (!moment || Math.abs(t - point.t) < Math.abs(t - moment.t))) moment = point;
      continue;
    }
    if (t < point.t || t >= point.t + span) continue;
    if (!coarsest || span > spanOf(coarsest)) coarsest = point;
    if (span < minSpan) { finer += 1; continue; }
    // The finest visible reading wins; between two of the same length, the later one.
    if (!shown || span < spanOf(shown) || (span === spanOf(shown) && point.t > shown.t)) shown = point;
  }
  if (moment) return { point: moment, finer: 0 };
  if (shown) return { point: shown, finer };
  // Every covering reading is finer than the zoom can show and none is coarse enough: show the longest of them.
  if (coarsest) return { point: coarsest, finer: finer - 1 };
  return null;
}
