import test from 'node:test';
import assert from 'node:assert/strict';
import { timeAxis } from '../viewer/public/time-axis.js';

const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);

test('a window maps its start to 0 and its end to 1, and the time at a fraction is the time at that fraction', () => {
  for (const axis of [timeAxis({ earliest: -300000, present: 2025.9, calendar: true }), timeAxis({ earliest: 0, present: 90, calendar: false })]) {
    for (const [a, b] of [[1700, 2025.9], [-60000, 2026], [10, 80], [0, 1]]) {
      if (b > axis.BOUNDS[1] || a < axis.BOUNDS[0]) continue;
      const V = axis.frameOf(a, b);
      close(axis.fracOf(V, a), 0); close(axis.fracOf(V, b), 1);
      for (const u of [0.1, 0.5, 0.9]) close(axis.fracOf(V, axis.timeAt(V, u)), u, 1e-9);
    }
  }
});

test('a clock other than a calendar is linear at every width; a calendar warps toward the present across millennia', () => {
  const plain = timeAxis({ earliest: 0, present: 1e6, calendar: false });
  const wide = plain.frameOf(0, 1e6); assert.equal(wide.w, 0); close(plain.fracOf(wide, 250000), 0.25);
  const years = timeAxis({ earliest: -300000, present: 2025.9, calendar: true });
  assert.equal(years.frameOf(1925, 2025).w, 0, 'a century is linear');
  assert.ok(years.frameOf(1700, 2025).w < 0.01, 'a few centuries are all but linear');
  const deep = years.frameOf(-300000, 2025.9); assert.equal(deep.w, 1, 'three hundred thousand years are on the log scale');
  assert.ok(1 - years.fracOf(deep, 1000) > 0.5, 'the last millennium takes more than half the width (linear: 0.3%)');
});

test('a window kept around a time holds it at its fraction, inside the axis, never narrower than the least span', () => {
  const axis = timeAxis({ earliest: 1779, present: 1919, calendar: true });
  for (const [t, u, span] of [[1851, 0.5, 24], [1851, 0.2, 140], [1780, 0.9, 10], [1918, 0.1, 30]]) {
    const [a, b] = axis.windowAt(t, u, span);
    close(b - a, span); assert.ok(a >= axis.BOUNDS[0] && b <= axis.BOUNDS[1] + 1e-9);
    if (a > axis.BOUNDS[0] && b < axis.BOUNDS[1]) close(axis.fracOf(axis.frameOf(a, b), t), u, 1e-6);
  }
  const [a, b] = axis.windowAt(1851, 0.5, 0); close(b - a, axis.MIN_SPAN);
});
