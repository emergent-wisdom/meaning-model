import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const start = source.indexOf('const valueAt ='), end = source.indexOf('\n};', start);
const { valueAt } = vm.runInNewContext(`${source.slice(start, end + 3)}\n({ valueAt })`);
// The joining of samples as the viewer drew it before: the first sample after t, found from the start.
const linear = (points, t) => {
  if (!points.length) return null;
  if (t < points[0].t || t > points.at(-1).t) return null; if (t === points[0].t) return points[0].v; if (t === points.at(-1).t) return points.at(-1).v;
  const k = points.findIndex((p) => p.t > t); const a = points[k - 1]; const b = points[k]; return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
};

test('a value between samples is the one the linear search found, at every time, with repeated sample times too', () => {
  let seed = 11; const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let trial = 0; trial < 300; trial += 1) {
    const times = Array.from({ length: 1 + Math.floor(random() * 40) }, () => Math.round(random() * 50) / 2).sort((a, b) => a - b);
    const points = times.map((t) => ({ t, v: Math.round(random() * 1000) / 10 }));
    for (const t of [...times, ...Array.from({ length: 30 }, () => random() * 30 - 2)]) assert.equal(valueAt(points, t), linear(points, t), `trial ${trial} at ${t}`);
  }
  assert.equal(valueAt([], 1), null);
});
