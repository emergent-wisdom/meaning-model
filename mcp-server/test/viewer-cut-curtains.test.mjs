import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function arrow(name) {
  const start = source.indexOf(`const ${name} =`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n};', start) + 3);
}
const born = (at) => ({ at: new Date(at).toISOString() });
const points = () => [
  { t: 10, end: 11, v: 0.2, born: born(100), cutId: 'early', eventId: 'first', cut: { id: 'early' } },
  { t: 20, end: 21, v: 0.6, born: born(200), cutId: 'middle', eventId: 'second', cut: { id: 'middle' } },
  { t: 30, end: 31, v: 0.1, born: born(300), cutId: 'late', eventId: 'third', cut: { id: 'late' } },
];
function fixture() {
  const context = { madeAt: (born) => (born?.at ? Date.parse(born.at) : NaN), constructionByClock: true, timeText: (t) => String(t), month: (t) => String(t), AMP: 5.6, CUT_AMP: 18, T1: 40, money: () => { throw new Error('Cut weights are not physical quantities'); } };
  vm.createContext(context);
  vm.runInContext([arrow('valueAt'), arrow('measurePosition'), arrow('format'), fn('rowValue'), fn('rowValueText'), fn('updateRowSamples'), fn('measureValueLines')].join('\n'), context);
  return context;
}

test('native curtain weights interpolate visibly without extrapolating or using physical-unit formatting', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', unit: 'GBP activity', question: 'What occupies attention?', answerKey: 'work', points: points() } };
  row.points = row.measure.points;
  assert.equal(context.rowValue(row, 9), null);
  assert.equal(context.rowValue(row, 10), 0.2);
  assert.equal(context.rowValue(row, 15), 0.4);
  assert.equal(context.rowValue(row, 31), null);
  assert.equal(context.rowValueText(row, 10), '0.2');
  assert.equal(context.rowValueText(row, 15), '~0.4');
  assert.equal(context.rowValueText(row, 31), '');
  const text = context.measureValueLines(row, 15).map(([, text]) => text).join('\n');
  assert.match(text, /Visual interpolation between authored interval readings/);
  assert.match(text, /10 – 11/);
  assert.match(text, /Source Cut: early/);
  assert.match(text, /Source Cut: middle/);
  assert.doesNotMatch(text, /late|£/);
});

test('construction replay uses only already-authored Cut samples and removes later samples on rewind', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', points: points() } };
  context.updateRowSamples(row, true, 150, false);
  assert.deepEqual(Array.from(row.points, (point) => point.cutId), ['early']);
  assert.equal(context.rowValue(row, 15), null, 'no interpolation toward a future construction reading');
  context.updateRowSamples(row, true, 250, false);
  assert.deepEqual(Array.from(row.domain), [10, 20]);
  assert.equal(context.rowValueText(row, 15), '~0.4');
  assert.equal(context.rowValue(row, 25), null);
  context.updateRowSamples(row, true, 150, false);
  assert.equal(context.rowValue(row, 15), null);
  context.updateRowSamples(row, false, 0, false);
  assert.equal(row.points.length, 3, 'world-time playback uses the complete snapshot');
  assert.equal(row.measure.points.length, 3, 'the authored points remain intact');
});

test('unknown construction birth is not treated as an early native reading', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', points: points().map((point) => ({ ...point, born: null })) } };
  context.updateRowSamples(row, true, 300, false);
  assert.equal(row.points.length, 0);
  assert.equal(context.rowValue(row, 20), null);
  context.updateRowSamples(row, true, 300, true);
  assert.equal(row.points.length, 3, 'the complete snapshot remains viewable at End');
});

test('native row geometry uses an absolute 0–1 scale and its finite sample domain', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', points: points(), unit: 'attention', domain: [10, 30] } };
  context.rows = [row];
  const start = source.indexOf('for (const row of rows) {\n  const values =');
  const end = source.indexOf('\nconst money =', start);
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(Array.from(row.range), [0, 1]);
  assert.deepEqual(Array.from(row.domain), [10, 30]);
  assert.ok(Math.abs(row.height(10) - 0.2 * context.CUT_AMP) < 1e-12);
  assert.equal(row.height(31), 0);
});

test('explicit source Event anchors select visible compatible rows and reject hidden or unavailable values', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', points: points() }, inT: true };
  row.points = row.measure.points;
  Object.assign(context, { rowOf: new Map(), sourceEventRows: new Map([['first', [row]]]), presence: (item) => item.inT ? 1 : 0, shownByPlay: () => true, bornAt: () => -Infinity });
  vm.runInContext(fn('rowsForEvent'), context);
  assert.equal(context.rowsForEvent({ id: 'first' }, 10)[0], row);
  row.inT = false;
  assert.equal(context.rowsForEvent({ id: 'first' }, 10).length, 0);
  row.inT = true;
  context.updateRowSamples(row, true, 0, false);
  assert.equal(context.rowsForEvent({ id: 'first' }, 10).length, 0);
});

test('long native labels cannot consume the narrow viewport framing or count hidden rows', () => {
  const context = fixture();
  vm.runInContext(fn('visibleLabelWidth'), context);
  const label = (width, visible = true, visibility = '') => ({ visible, element: { offsetWidth: width, style: { visibility } } });
  const cap = Math.min(160, 505 * 0.28);
  assert.equal(context.visibleLabelWidth([label(500), label(120)], cap), cap);
  assert.equal(context.visibleLabelWidth([label(500, false), label(400, true, 'hidden'), label(70)], cap), 70);
  assert.equal(context.visibleLabelWidth([label(500, false)], cap), 0);
  assert.match(source, /maxWidth: 'min\(150px, 25vw\)'/, 'native canvas labels are ellipsized while their title retains the full text');
});

test('native answer curves occupy the level below their declared common Event home', () => {
  const rows = [
    { measure: { id: 'native', kind: 'cut-answer', home: 'inner', depth: 1 } },
    { measure: { id: 'unplaced', kind: 'cut-answer', home: 'missing', depth: 1 } },
    { measure: { id: 'legacy' } },
  ];
  const context = { rows, processById: new Map([['legacy', { depth: 4, home: 'body' }]]), treeById: new Map([['inner', { depth: 2 }]]) };
  const start = source.indexOf('for (const row of rows) {', source.indexOf('const processById ='));
  const end = source.indexOf('\nconst MAX_DEPTH =', start);
  vm.runInNewContext(source.slice(start, end), context);
  assert.deepEqual(rows.map((row) => [row.depth, row.home]), [[3, 'inner'], [1, 'missing'], [4, 'body']]);
});

test('Tree with flat lines hidden keeps native group headers above arrived rows and follows replay visibility', () => {
  const group = { id: 'person', label: 'Ada' };
  const row = (y, z) => ({ group, measure: { kind: 'cut-answer' }, name: { visible: true }, wall: { visible: true }, at: { y, z } });
  const rows = [row(-24, 40), row(-7, 20)];
  const object = { visible: false, position: { set(x, y, z) { Object.assign(this, { x, y, z }); } } };
  const context = { rows, nodes: [], opt: { hideFlat: true }, blend: { now: 1 }, smooth: (n) => n, presence: () => 1, rowAt: (row) => row.at, nodeAt: () => ({}), LENGTH: 116, CUT_AMP: 18, GAP: 4.4 };
  vm.createContext(context); vm.runInContext(fn('syncGroupLabel'), context);
  context.syncGroupLabel({ group, object });
  assert.equal(object.visible, true);
  assert.equal(object.position.y, -7 + 18 + 1, 'the group header follows its first visible row floor');
  assert.equal(object.position.z, 20 - 4.4 * 0.62);
  rows[1].name.visible = false;
  context.syncGroupLabel({ group, object });
  assert.equal(object.position.y, -24 + 18 + 1, 'a future row cannot locate the header');
  rows[0].name.visible = false;
  context.syncGroupLabel({ group, object });
  assert.equal(object.visible, false, 'the header disappears when construction or world playback hides all its curves');
  rows[0].name.visible = true; context.opt.hideFlat = false;
  context.syncGroupLabel({ group, object });
  assert.equal(object.visible, false, 'ordinary Tree headers remain unchanged');
  context.blend.now = 0;
  context.syncGroupLabel({ group, object });
  assert.equal(object.visible, true, 'Processes still has its normal group headers');
});

test('moving native value labels turn inward at the right edge and turn back on rewind', () => {
  const position = () => ({ set(x, y, z) { Object.assign(this, { x, y, z }); } });
  const row = { value: { center: position(), position: position() } };
  const context = { F: { a: 0, b: 10 }, rowAt: () => ({ y: -5, z: 3 }), heightAt: () => 9, X: (t) => t * 10,
    fracOf: (frame, t) => (t - frame.a) / (frame.b - frame.a) };
  vm.createContext(context); vm.runInContext(fn('placeNativeValue'), context);
  context.placeNativeValue(row, 10);
  assert.equal(row.value.center.x, 1, 'text ends at the anchor instead of extending beyond the right edge');
  assert.equal(row.value.position.x, 99.3);
  assert.equal(row.value.position.y, 4.3);
  context.placeNativeValue(row, 1);
  assert.equal(row.value.center.x, 0);
  assert.equal(row.value.position.x, 10.7);
});

test('a whose-name with no curves follows only its Events drawn in this view', () => {
  const group = { id: 'world', label: 'The world' };
  const object = { visible: true, position: { set(x, y, z) { Object.assign(this, { x, y, z }); } } };
  // The world's Event is drawn in the tree only; in the processes it keeps its tree place, among another person's rows.
  const event = { id: 'era', group: 'world', shown: true, inT: false, inL: true, at: { y: 0, z: 30 } };
  const context = { rows: [], nodes: [event], opt: { eventLayout: 'traditional' }, blend: { now: 0 }, smooth: (n) => n,
    presence: () => 1, rowAt: () => ({}), nodeAt: (node) => node.at, nodeVis: (node) => (1 - context.blend.now) * (node.inT ? 1 : 0) + context.blend.now * (node.inL ? 1 : 0),
    LENGTH: 116, CUT_AMP: 18, AMP: 5.6, GAP: 4.4 };
  vm.createContext(context); vm.runInContext(fn('syncGroupLabel'), context);
  context.syncGroupLabel({ group, object });
  assert.equal(object.visible, false, 'nothing of the world is drawn in the processes, so its name does not stand over other rows');
});

test('a causal link that crosses other curtains arcs over them; one within a row keeps its arc', () => {
  const row = (z, height) => ({ z, height });
  const context = { ROW: 2.7, presence: () => 1, rowAt: (item) => ({ y: 0, z: item.z }), heightAt: (item) => item.height, timeAtX: (x) => x, rows: [row(10, 18), row(20, 5.6)] };
  vm.createContext(context); vm.runInContext(fn('arcControlY'), context);
  const a = { x: 0, y: 2, z: 0 }, b = { x: 10, y: 3, z: 30 };
  const control = context.arcControlY(a, b);
  const at = (s) => (1 - s) ** 2 * a.y + 2 * s * (1 - s) * control + s ** 2 * b.y;
  assert.ok(at(1 / 3) >= 18 + 1.5, 'the arc clears the tall curtain it crosses');
  assert.ok(at(2 / 3) >= 5.6 + 1.5, 'and the lower one');
  const near = { x: 10, y: 3, z: 1 };
  assert.equal(context.arcControlY(a, near), 3 + 1.2 + 10 * 0.12, 'a link within one row keeps the usual arc');
});

test('the play sweep stands from the lowest floor or Event drawn to above the highest curtain', () => {
  const row = (y, kind = 'numeric') => ({ y, measure: { kind } });
  const context = { AMP: 5.6, CUT_AMP: 18, visibleAmplitude: () => 5.6, presence: () => 1, rowAt: (item) => ({ y: item.y }),
    nodeAt: (node) => ({ y: node.y }), nodeVis: (node) => node.vis,
    rows: [row(4), row(-10, 'cut-answer')], nodes: [{ shown: true, vis: 1, y: -30 }, { shown: true, vis: 0, y: -90 }] };
  vm.createContext(context); vm.runInContext(fn('sweepSpan'), context);
  assert.deepEqual({ ...context.sweepSpan() }, { bottom: -30.5, top: 4 + 5.6 + 5.5 }, 'the lowest floor drawn, not an Event hidden in this view');
  context.rows = []; context.nodes = [];
  assert.deepEqual({ ...context.sweepSpan() }, { bottom: -0.5, top: 5.6 + 5.5 }, 'an empty field keeps the usual sweep');
});
