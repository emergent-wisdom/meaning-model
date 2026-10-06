import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createProcessDetail } from '../viewer/public/process-detail.js';
import { nestedEventLayout } from '../viewer/public/nested-event-layout.js';

// The default rows are the processes that change over time. A line that never changes and a row of single moments
// stay in the model and return with rows=all; a series of periods shows, measured against its own stretch so a model
// reaching into deep time does not hide a life's series (Twelve Words starts 298,000 years back).
const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const start = source.indexOf('const CHANGE_COVER'), end = source.indexOf('\n}', source.indexOf('function tracesChange(')) + 2;
assert.ok(start >= 0 && end > start, 'the viewer defines tracesChange');
const context = {}; vm.createContext(context); vm.runInContext(`${source.slice(start, end)}\nthis.tracesChange = tracesChange;`, context);
const { tracesChange } = context;
const row = (kind, points) => ({ measure: { kind, points }, points });
const periods = (values, from = 1810, step = 5) => values.map((v, i) => ({ t: from + i * step, end: from + (i + 1) * step, v }));
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
function sceneFor(rows, options = {}) {
  const scene = { rows, opt: { onlyChanging: true, show: new Set(['processes']), detailProjection: null, hideFlat: false, layout: 'together', depth: 1, ...options },
    boundedMeasure: (measure) => ['cut-answer', 'typed-scalar'].includes(measure.kind) };
  vm.createContext(scene);
  vm.runInContext(section('const CHANGE_COVER', 'const rowSpacing'), scene);
  return scene;
}
function run(rows, options = {}) {
  const scene = sceneFor(rows, options);
  scene.updateRowsFallback();
  return { fallback: scene.opt.rowsFallback, shown: rows.filter(scene.visibleRow).length };
}

test('rows that change over periods show by default; flat lines and single moments do not', () => {
  assert.equal(tracesChange(row('cut-answer', periods([0.6, 0.3, 0.7, 0.2]))), true, 'a series of periods that moves');
  assert.equal(tracesChange(row('cut-answer', periods([0.4, 0.4, 0.4]))), false, 'a series that never changes');
  assert.equal(tracesChange(row('cut-answer', [{ t: 1850, end: 1871, v: 0.5 }])), false, 'one long reading is one level');
  const moments = [2001.3, 2005, 2009, 2013, 2018, 2022, 2026.7].map((t, i) => ({ t, end: t + 0.014, v: [0.1, 0.15, 0.45, 0.4, 0.2, 0.3, 0.15][i] }));
  assert.equal(tracesChange(row('cut-answer', moments)), false, 'decision-time moments across 25 years');
  const life = [{ t: 1953.4, end: 1990, v: 0.6 }, { t: 1990, end: 2010, v: 0.55 }, { t: 2010, end: 2020, v: 0.72 }, { t: 2020, end: 2023.3, v: 0.5 }];
  assert.equal(tracesChange(row('cut-answer', life)), true, 'a whole-life series, whatever the model\'s earliest record');
  assert.equal(tracesChange(row('named', [{ t: 0, v: 1 }, { t: 1, v: 2 }])), true, 'a sampled process that moves');
  assert.equal(tracesChange(row('named', [{ t: 0, v: 1 }, { t: 1, v: 1 }])), false, 'a sampled process that stays put');
});

test('the default is on, rows=all turns it off, and Everything shows every row', () => {
  const expression = source.match(/onlyChanging: (.+),/u)[1];
  const rows = [row('cut-answer', periods([0.4, 0.4])), row('cut-answer', periods([0.3, 0.7]))];
  for (const search of ['everything', 'rows=all', 'everything&chosen=view-1']) {
    const onlyChanging = vm.runInNewContext(expression, { params: new URLSearchParams(search) });
    assert.deepEqual(run(rows, { onlyChanging }), { fallback: false, shown: 2 }, search);
  }
  assert.deepEqual(run(rows, { onlyChanging: vm.runInNewContext(expression, { params: new URLSearchParams() }) }), { fallback: false, shown: 1 });
  assert.match(source, /if \(!opt\.onlyChanging\) next\.set\('rows', 'all'\);/u);
  assert.match(source, /opt\.onlyChanging = !on;/u);
});

// A model of single moments, or a scope whose processes hold still, would be left without curves by the default: every
// row returns instead, the model's own row choice included, and the view says so.
test('an empty row selection restores available rows without overriding explicit filters', () => {
  const moment = (t, v) => row('cut-answer', [{ t, end: t + 0.01, v }, { t: t + 5, end: t + 5.01, v: v + 0.1 }]);
  assert.deepEqual(run([moment(2001, 0.1), moment(2009, 0.4)], {}), { fallback: true, shown: 2 }, 'single moments only: every row returns');
  assert.deepEqual(run([moment(2001, 0.1), row('cut-answer', periods([0.6, 0.3, 0.7]))], {}), { fallback: false, shown: 1 }, 'one changing row keeps the default');
  assert.deepEqual(run([moment(2001, 0.1)], { show: new Set(['events']) }), { fallback: false, shown: 0 }, 'no fallback while processes are hidden');
  assert.deepEqual(run([moment(2001, 0.1)], { onlyChanging: false }), { fallback: false, shown: 1 }, 'Show every row needs no fallback');
  assert.deepEqual(run([row('cut-answer', periods([0.6, 0.3, 0.7]))], { curation: { rows: true, row: () => false } }), { fallback: true, shown: 1 }, 'a choice of rows that shows nothing gives way too');
  const stable = row('cut-answer', periods([0.4, 0.4, 0.4]));
  assert.deepEqual(run([stable]), { fallback: true, shown: 1 }, 'a fully recorded stable history is still available');
  assert.deepEqual(run([stable], { hideFlat: true }), { fallback: false, shown: 0 }, 'Hide flat is an explicit filter');
  assert.deepEqual(run([stable], { hideFlat: true, curation: { rows: true, row: () => true } }), { fallback: false, shown: 0 }, 'curation also respects Hide flat');
  assert.deepEqual(run([stable], { curation: { rows: true, row: () => true } }), { fallback: false, shown: 1 }, 'chosen stable rows need no fallback');
  const replay = { ...stable, points: stable.points.slice(0, 1) };
  assert.deepEqual(run([replay]), { fallback: false, shown: 0 }, 'replay with only one available sample cannot restore a curve');
});

test('fallback preserves a real detail projection and only announces an actual restoration', () => {
  const stable = { ...row('cut-answer', periods([0.4, 0.4])), home: 'life', depth: 1 };
  stable.measure.id = 'stable';
  const detail = createProcessDetail([{ id: 'world' }, { id: 'life', parent: 'world' }, { id: 'empty', parent: 'world' }], [stable]);
  const hint = { hidden: true };
  const scene = sceneFor([stable], { detailProjection: detail.project({ scope: 'empty', level: 0 }) });
  Object.assign(scene, { temporalActive: true, document: { getElementById: () => hint } });
  vm.runInContext(section('function syncEveryRowHint()', 'function showStats()'), scene);
  scene.updateRowsFallback(); scene.syncEveryRowHint();
  assert.equal(scene.visibleRow(stable), false); assert.equal(scene.opt.rowsFallback, false); assert.equal(hint.hidden, true);
  scene.opt.detailProjection = detail.project({ scope: 'life', level: 0 });
  scene.updateRowsFallback(); scene.syncEveryRowHint();
  assert.equal(scene.visibleRow(stable), true); assert.equal(scene.opt.rowsFallback, true); assert.equal(hint.hidden, false);
  const markup = readFileSync(new URL('../viewer/public/index.html', import.meta.url), 'utf8').match(/id="every-row-hint"[^>]*>(.*?)<\/div>/u)[1];
  assert.match(markup, /Showing additional rows.*scope and display settings/u);
  assert.doesNotMatch(markup, /Every row is shown|None of the processes|followed through time yet/u);
});

test('the actual layout restores shallow rows when changing rows are beyond the active Tree depth', () => {
  for (const eventLayout of ['traditional', 'nested']) {
    const group = { id: 'g' };
    const rows = [[0.4, 0.4], [0.3, 0.7]].map((values, index) => ({ ...row('cut-answer', periods(values)), depth: index + 1, group, zT: 0, yT: 0 }));
    const scene = sceneFor(rows, { layout: 'layers', depth: 1, detailLevel: null, eventLayout, camera: 'free' });
    Object.assign(scene, { groups: [group], nodes: [], data: { people: [] }, referents: new Map(), nestedEventLayout,
      visibleNode: () => false, isCharacter: () => false, ROW: 2.7, CUT_ROW: 6, GAP: 4.4, CUT_AMP: 18, LAMP: 3.2, LANE: 1,
      floors: [], layersBounds: null, dirty: false, relayout: false, push: (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); } });
    vm.runInContext(section('const rowSpacing', '// Where a row or node stands now:'), scene);
    scene.computeLayout();
    assert.equal(scene.opt.rowsFallback, true, eventLayout);
    assert.deepEqual(rows.map((item) => item.inL), [true, false], eventLayout);
    scene.opt.depth = 2; scene.computeLayout();
    assert.equal(scene.opt.rowsFallback, false, eventLayout);
    assert.deepEqual(rows.map((item) => item.inL), [false, true], eventLayout);
    scene.opt.layout = 'together'; scene.opt.depth = 1; scene.computeLayout();
    assert.equal(scene.opt.rowsFallback, false, 'Together does not apply Tree depth to rows');
  }
});
