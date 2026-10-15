import test from 'node:test';
import assert from 'node:assert/strict';
import { readingAt, prepareReadings } from '../viewer/public/interval-readings.js';

// A small seeded generator, so a failure names the series that showed it.
function generator(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A random Cut series: readings nested inside longer ones and never partly overlapping, on a quarter grid so boundaries
// meet, each with a share for every answer; finer readings sometimes take more of an answer than the longer reading
// allows, so no level can hold outside them; and some moments. Every answer reads the same intervals in the same
// (shuffled) order.
function cutSeries(random, answers) {
  const readings = [];
  const shares = () => { const raw = Array.from({ length: answers }, () => random() ** 2 + 0.01); const sum = raw.reduce((x, y) => x + y, 0); return raw.map((x) => Math.round((x / sum) * 100) / 100); };
  const grow = (t, end, depth) => {
    readings.push({ t, end, shares: shares() });
    if (depth >= 4 || random() < 0.3) return;
    const quarters = Math.round((end - t) * 4);
    const marks = [...new Set(Array.from({ length: 1 + Math.floor(random() * 6) }, () => Math.floor(random() * (quarters + 1))))].sort((x, y) => x - y);
    const edges = [0, ...marks.filter((m) => m > 0 && m < quarters), quarters];
    for (let i = 1; i < edges.length; i += 1) {
      if (random() < 0.35) continue;
      let from = edges[i - 1], to = edges[i];
      if (to - from > 1 && random() < 0.5) { from += 1; if (to - from > 1 && random() < 0.5) to -= 1; }
      if (from === 0 && to === quarters) continue; // the same interval twice is not a nesting
      grow(t + from / 4, t + to / 4, depth + 1);
    }
  };
  const roots = 1 + Math.floor(random() * 3);
  let at = 0;
  for (let r = 0; r < roots; r += 1) { at += Math.floor(random() * 3) / 2; const length = 2 + Math.floor(random() * 40) / 2; grow(at, at + length, 0); at += length; }
  for (let m = Math.floor(random() * 4); m > 0; m -= 1) { const t = Math.floor(random() * (at + 2) * 4) / 4 - 1; readings.push({ t, end: t, shares: shares() }); }
  for (let i = readings.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [readings[i], readings[j]] = [readings[j], readings[i]]; }
  return Array.from({ length: answers }, (_, k) => readings.map((reading, i) => ({ t: reading.t, end: reading.end, v: reading.shares[k], cutId: `c${i}` })));
}

// Every boundary, just beside it, the middle of each stretch, each moment's reach, and times scattered across and beyond
// the series.
function timesFor(points, random, momentHalfWidth) {
  const marks = [...new Set(points.flatMap((p) => [p.t, p.end]))].sort((a, b) => a - b);
  const times = [NaN, -Infinity, Infinity];
  marks.forEach((m, i) => { times.push(m, m - 1e-9, m + 1e-9, m - momentHalfWidth, m + momentHalfWidth); if (i) times.push((marks[i - 1] + m) / 2); });
  for (let i = 0; i < 40; i += 1) times.push(marks[0] - 2 + random() * (marks.at(-1) - marks[0] + 4));
  return times;
}

const sameReading = (got, want, where) => {
  assert.deepStrictEqual(got, want, where);
  assert.equal(got?.point, want?.point, `${where}: the same reading`);
  assert.equal(got?.derived?.parent, want?.derived?.parent, `${where}: the same longer reading`);
};

test('a prepared series reads exactly as readingAt: the same level, derived marking and emptiness, at every resolution', () => {
  // What the readings compared showed: each kind must come up often.
  const seen = { reading: 0, standsForFiner: 0, derived: 0, infeasible: 0, coarser: 0, moment: 0, empty: 0 };
  for (let seed = 1; seed <= 80; seed += 1) {
    const random = generator(seed);
    const answers = cutSeries(random, 2 + (seed % 3));
    for (const minSpan of [0, 0.4, 1.5, 6, Infinity]) {
      for (const momentHalfWidth of [0, 0.3]) {
        const options = { minSpan, momentHalfWidth };
        const readers = [];
        for (const points of answers) readers.push(prepareReadings(points, options, readers[0]));
        assert.ok(readers.every((read) => read.shape === readers[0].shape && read.shape.nested), `seed ${seed}: the answers share one nesting`);
        const times = timesFor(answers[0], random, momentHalfWidth);
        answers.forEach((points, k) => {
          for (const t of times) {
            const want = readingAt(points, t, options);
            sameReading(readers[k](t), want, `seed ${seed}, minSpan ${minSpan}, momentHalfWidth ${momentHalfWidth}, answer ${k}, t ${t}`);
            if (!want) seen.empty += 1;
            else if (want.derived) seen[want.derived.feasible ? 'derived' : 'infeasible'] += 1;
            else if (!(want.point.end > want.point.t)) seen.moment += 1;
            else if (want.finer) seen.standsForFiner += 1;
            else if (readingAt(points, t, { ...options, minSpan: 0 })?.point !== want.point) seen.coarser += 1;
            else seen.reading += 1;
          }
        });
      }
    }
  }
  for (const [kind, count] of Object.entries(seen)) assert.ok(count > 20, `the series exercise ${kind} (${count})`);
});

test('a sliver the finer readings leave shows the longer reading, as readingAt does, and nothing is shared across different intervals', () => {
  const points = [{ t: 0, end: 10, v: 0.3 }, { t: 0, end: 5, v: 0.2 }, { t: 5 + 1e-11, end: 10, v: 0.4 }, { t: 12, end: 14, v: 0.5 }, { t: 12, end: 13, v: 0.9 }];
  for (const minSpan of [0, 1, 1.5, 3]) {
    const read = prepareReadings(points, { minSpan });
    assert.equal(read.shape.nested, true);
    for (const t of [...timesFor(points, generator(3), 0), 5 + 5e-12]) sameReading(read(t), readingAt(points, t, { minSpan }), `minSpan ${minSpan}, t ${t}`);
  }
  assert.deepEqual(prepareReadings(points)(5 + 5e-12), { point: points[0], value: 0.3, finer: 0, derived: null });
  const beside = prepareReadings(points)(13.5);
  assert.ok(beside.derived?.feasible && Math.abs(beside.value - 0.1) < 1e-12, 'the derived level beside a finer reading');

  // Answers that do not read the same intervals do not share a nesting.
  const one = prepareReadings([{ t: 0, end: 10, v: 0.3 }, { t: 2, end: 4, v: 0.9 }]);
  const other = prepareReadings([{ t: 0, end: 10, v: 0.3 }, { t: 2, end: 5, v: 0.9 }], {}, one);
  assert.notEqual(other.shape, one.shape);
  assert.equal(other(4.5).value, 0.9);
});

test('readings that partly overlap or repeat an interval are read by readingAt itself, and still agree', () => {
  const series = [
    [{ t: 0, end: 10, v: 0.3 }, { t: 5, end: 15, v: 0.6 }, { t: 6, end: 7, v: 0.9 }, { t: 12, end: 12, v: 0.1 }],
    [{ t: 0, end: 10, v: 0.3 }, { t: 0, end: 10, v: 0.5 }, { t: 2, end: 4, v: 0.9 }, { t: 8, end: 9, v: 0.2 }],
    [{ t: 0, end: 4, v: 0.3 }, { t: 1, end: 3, v: 0.5 }, { t: 2, end: 6, v: 0.7 }, { t: 2.5, end: 2.75, v: 0.1 }],
  ];
  for (const points of series) {
    for (const minSpan of [0, 1, 3, 100]) {
      const read = prepareReadings(points, { minSpan });
      assert.equal(read.shape.nested, false);
      for (const t of timesFor(points, generator(minSpan + 7), 0)) sameReading(read(t), readingAt(points, t, { minSpan }), `minSpan ${minSpan}, t ${t}`);
    }
  }
});
