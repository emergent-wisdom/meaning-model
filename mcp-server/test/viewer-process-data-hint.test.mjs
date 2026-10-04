import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../viewer/public/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function syncProcessDataHint('), end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);
const hintFunction = source.slice(start, end + 2);

function fixture() {
  const hint = { hidden: true };
  const context = { temporalActive: true, opt: { layout: 'together' }, rows: [], treeEvents: [{ reach: [1, 10] }],
    document: { getElementById: (id) => id === 'process-data-hint' ? hint : null } };
  vm.createContext(context); vm.runInContext(hintFunction, context);
  return { context, hint, update: () => context.syncProcessDataHint() };
}

test('real temporal hint appears for Event spans without a dated numerical series', () => {
  const { context, hint, update } = fixture();
  for (const layout of ['together', 'layers']) {
    context.opt.layout = layout;
    update(); assert.equal(hint.hidden, false, layout);
  }
  context.rows = [{ measure: { points: [{ t: 1, v: 0.4 }] } }];
  update(); assert.equal(hint.hidden, false, 'one reading does not provide a numerical curve');
  context.treeEvents = [];
  update(); assert.equal(hint.hidden, true, 'no Event spans means no span-only claim');
  context.treeEvents = [{ reach: [NaN, 10] }, { reach: [1, Infinity] }];
  update(); assert.equal(hint.hidden, true);
});

test('constant, hidden, scoped-out and not-yet-played curves never appear to be missing data', () => {
  const { context, hint, update } = fixture();
  for (const kind of ['process', 'cut-answer']) {
    context.rows = [{ measure: { kind, points: [{ t: 20, v: 0.4 }, { t: 30, v: 0.4 }] },
      points: [], inT: false, inL: false, wall: { visible: false } }];
    Object.assign(context.opt, { hideFlat: true, show: new Set(), detailProjection: { rowIds: new Set() }, mode: 'construction' });
    context.F = { a: 1, b: 10 };
    update(); assert.equal(hint.hidden, true, `${kind}: source values survive display and time filters`);
  }
});

test('hint follows source availability and temporal activation without sticking between representations', () => {
  const { context, hint, update } = fixture();
  update(); assert.equal(hint.hidden, false);
  context.rows.push({ measure: { points: [{ t: 1, v: 0 }, { t: 2, v: 1 }] } });
  update(); assert.equal(hint.hidden, true, 'an updated snapshot has a curve');
  context.rows = [];
  update(); assert.equal(hint.hidden, false);
  for (const layout of ['terrain', 'graph', 'structure', 'space']) {
    context.opt.layout = layout;
    update(); assert.equal(hint.hidden, true, layout);
  }
  context.opt.layout = 'together'; context.temporalActive = false;
  update(); assert.equal(hint.hidden, true);
  context.temporalActive = true;
  update(); assert.equal(hint.hidden, false);
});

test('hint sits in the measured title area and disappears while reading or outside temporal views', () => {
  assert.match(html, /<header class="hud title">[^]*class="process-data-hint" id="process-data-hint" data-temporal hidden[^]*?<\/header>/);
  assert.match(html, /body:has\(#reader:not\(\[hidden\]\)\) \.process-data-hint \{ display: none !important; \}/);
  assert.match(html, /body\[data-representation="graph"\] \[data-temporal\][^\n]*body\[data-representation="space"\] \[data-temporal\] \{ display: none !important;/);
  assert.match(html, /No curves to show yet/);
  assert.match(html, /check recorded values and use a compatible dated series to show how processes change over time\./);
  assert.match(source, /function showStats\(\) \{\s*syncProcessDataHint\(\);/);
  assert.match(source, /function syncPanel\(\) \{\s*if \(!ready\) return;\s*syncProcessDataHint\(\);/);
  assert.doesNotMatch(source, /this snapshot has no recorded Cut answers/);
});
