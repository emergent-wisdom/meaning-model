import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../viewer/public/vendor/three/three.core.js';
import { readingAt, readingsDomain, readingReason, readingConfidence } from '../viewer/public/interval-readings.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const boundedDeclaration = source.split('\n').find((line) => line.startsWith('const boundedMeasure ='));
const line = (name) => source.split('\n').find((text) => text.startsWith(`const ${name} =`));
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
  Object.assign(context, { readingAt, readingsDomain, readingReason, readingConfidence, F: { s: 40 }, NX: 400 });
  vm.runInContext([boundedDeclaration, arrow('valueAt'), arrow('measurePosition'), line('readingResolution'), line('readingShown'), arrow('format'), fn('rowValue'), fn('rowPosition'), fn('rowValueText'), fn('updateRowSamples'), fn('measureValueLines')].join('\n'), context);
  return context;
}

test('a native reading holds across its interval, unrecorded time stays empty, and nothing is interpolated', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', unit: 'GBP activity', question: 'What occupies attention?', answerKey: 'work', points: points() } };
  row.points = row.measure.points;
  assert.equal(context.rowValue(row, 9), null);
  assert.equal(context.rowValue(row, 10), 0.2);
  assert.equal(context.rowValue(row, 10.9), 0.2, 'the reading is the average over its whole interval');
  assert.equal(context.rowValue(row, 15), null, 'no line is drawn across time nobody recorded');
  assert.equal(context.rowValue(row, 30.5), 0.1, 'the last reading is drawn to its end');
  assert.equal(context.rowValue(row, 31), null);
  assert.equal(context.rowValueText(row, 10.5), '0.2');
  assert.equal(context.rowValueText(row, 15), '');
  const text = context.measureValueLines(row, 10.5).map(([, text]) => text).join('\n');
  assert.match(text, /average over its whole interval/);
  assert.match(text, /10 – 11/);
  assert.match(text, /Source Cut: early/);
  assert.doesNotMatch(text, /middle|late|£|interpolat/);
  assert.match(context.measureValueLines(row, 15).map(([, text]) => text).join('\n'), /No reading covers this time/);
});

test('zoomed out, a long reading stands for the finer readings inside it; zoomed in, they show', () => {
  const context = fixture();
  const reading = (cutId, t, end, v) => ({ t, end, v, cutId, eventId: cutId, born: born(100), cut: { id: cutId } });
  const row = { measure: { kind: 'cut-answer', question: 'How does she expect things to turn out?', answerKey: 'threat', unit: 'outlook',
    points: [reading('decade', 0, 40, 0.3), reading('crisis', 10, 12, 0.8), reading('verdict', 25, 25, 0.9)] } };
  row.points = row.measure.points;
  context.F = { s: 400 };
  assert.equal(context.rowValue(row, 11), 0.3, 'a two-year reading is too fine to see in a 400-year window');
  assert.match(context.measureValueLines(row, 11).map(([, text]) => text).join('\n'), /1 finer reading inside it: zoom in to see it/);
  context.F = { s: 40 };
  assert.equal(context.rowValue(row, 11), 0.8, 'zoomed in, the finer reading shows');
  const rest = (0.3 - (2 / 40) * 0.8) / (38 / 40);
  assert.ok(Math.abs(context.rowValue(row, 5) - rest) < 1e-12, 'outside it, what the rest of the stretch must average, not the long reading itself');
  assert.equal(context.rowValue(row, 25), 0.9, 'a moment reading shows as a narrow mark');
  assert.ok(Math.abs(context.rowValue(row, 25.5) - rest) < 1e-12);
  assert.deepEqual(context.readingsDomain(row.points), [0, 40]);
});

test('quarters inside a long reading show although a few weeks among them are read on their own', () => {
  const context = fixture();
  const reading = (cutId, t, end, v) => ({ t, end, v, cutId, eventId: cutId, born: born(100), cut: { id: cutId } });
  // Seven years read once, opened quarter by quarter, with three weeks read on their own where a period ends mid-quarter.
  const quarters = Array.from({ length: 27 }, (_, i) => reading(`q${i}`, 2013.25 + i * 0.25, 2013.5 + i * 0.25, i % 2 ? 0.6 : 0.8));
  const row = { measure: { kind: 'cut-answer', question: 'How does she expect things to turn out?', answerKey: 'assurance', unit: 'outlook',
    points: [reading('years', 2013.25, 2020.25, 0.7), ...quarters.slice(0, 26), reading('sliver', 2019.75, 2019.8, 0.7), reading('last', 2019.8, 2020.25, 0.6)] } };
  row.points = row.measure.points;
  context.F = { s: 10 };
  assert.equal(context.rowValue(row, 2014.1), 0.6, 'the quarter, not the seven-year level');
  assert.equal(context.rowValue(row, 2019.77), 0.7, 'the three weeks read on their own');
  context.F = { s: 400 };
  assert.equal(context.rowValue(row, 2014.1), 0.7, 'zoomed out to centuries, the long reading stands for its quarters');
});

test('an opened reading keeps its average: the uncovered years show the derived level they must average, marked as derived', () => {
  const context = fixture();
  const reading = (cutId, t, end, v) => ({ t, end, v, cutId, eventId: cutId, born: born(100), cut: { id: cutId } });
  const row = { measure: { kind: 'cut-answer', question: 'How does she expect things to turn out?', answerKey: 'threat', unit: 'outlook',
    points: [reading('six-years', 0, 6, 0.3), reading('two-years', 0, 2, 0.7)] } };
  row.points = row.measure.points;
  context.F = { s: 6 };
  assert.equal(context.rowValue(row, 1), 0.7);
  assert.ok(Math.abs(context.rowValue(row, 3) - 0.1) < 1e-12, 'the four uncovered years must average 0.1');
  const drawn = (2 * context.rowValue(row, 1) + 4 * context.rowValue(row, 3)) / 6;
  assert.ok(Math.abs(drawn - 0.3) < 1e-12, 'what is drawn averages to the long reading');
  assert.equal(context.rowValueText(row, 3), '~0.1');
  const text = context.measureValueLines(row, 3).map(([, line]) => line).join('\n');
  assert.match(text, /Derived, not recorded: for the reading over 0 – 6 \(0\.3\) to hold, the 67% of that stretch its finer readings leave uncovered must average this/);
  assert.match(text, /constrains the average over those years, not their shape/);
  row.points = row.measure.points = [reading('six-years', 0, 6, 0.3), reading('three-years', 0, 3, 0.9)];
  assert.equal(context.rowValue(row, 4), null, 'when the detail already takes more than the whole allows, no level can hold');
  assert.match(context.measureValueLines(row, 4).map(([, line]) => line).join('\n'), /No level can hold here: the finer readings inside 0 – 6 already take more threat/);
});

test('construction replay uses only already-authored Cut samples and removes later samples on rewind', () => {
  const context = fixture();
  const row = { measure: { kind: 'cut-answer', points: points() } };
  context.updateRowSamples(row, true, 150, false);
  assert.deepEqual(Array.from(row.points, (point) => point.cutId), ['early']);
  assert.equal(context.rowValue(row, 15), null, 'no interpolation toward a future construction reading');
  context.updateRowSamples(row, true, 250, false);
  assert.deepEqual(Array.from(row.domain), [10, 21], 'the replayed series ends where its last interval ends');
  assert.equal(context.rowValueText(row, 20.5), '0.6');
  assert.equal(context.rowValue(row, 15), null);
  assert.equal(context.rowValue(row, 25), null);
  context.updateRowSamples(row, true, 150, false);
  assert.equal(context.rowValue(row, 15), null);
  context.updateRowSamples(row, false, 0, false);
  assert.equal(row.points.length, 3, 'world-time playback uses the complete snapshot');
  assert.equal(row.measure.points.length, 3, 'the authored points remain intact');
});

test('dated scalar curtains keep units, sample bounds and review status through playback', () => {
  const context = fixture();
  const samples = points().map((point, index) => ({ ...point, id: `sample-${index}`, v: [-5, 15, 4][index],
    valueTime: point.t, evidenceCutoff: 8, evidenceType: 'estimate', uncertainty: { kind: 'unknown' } }));
  const row = { measure: { kind: 'typed-scalar', points: samples, domain: [10, 30], unit: 'litres', timeUnit: 'day',
    source: { kind: 'process-estimation' }, holder: 'modeler', mode: 'counterfactual' } };
  row.points = samples;
  assert.equal(context.rowValueText(row, 15), '~5 litres');
  assert.equal(context.rowValue(row, 9), null);
  assert.equal(context.rowValue(row, 31), null);
  const detail = context.measureValueLines(row, 15).map(([, text]) => text).join('\n');
  assert.match(detail, /Visual interpolation/);
  assert.match(detail, /approval does not make it an accepted world value/);
  assert.match(detail, /Native time: 10 day/);
  assert.match(detail, /Evidence cutoff: 8/);
  assert.doesNotMatch(detail, /sample-2|Parsed value|Held after/);
  context.updateRowSamples(row, true, 150, false);
  assert.equal(context.rowValue(row, 15), null, 'future construction samples cannot influence a curve');
  context.updateRowSamples(row, true, 250, false);
  assert.equal(context.rowValueText(row, 15), '~5 litres');
  assert.equal(context.rowValue(row, 25), null);
  context.updateRowSamples(row, true, 150, false);
  assert.equal(context.rowValue(row, 15), null, 'rewinding removes later samples');
  context.updateRowSamples(row, false, 0, false);
  context.rows = [row];
  const start = source.indexOf('for (const row of rows) {\n  const values =');
  vm.runInContext(source.slice(start, source.indexOf('\nconst money =', start)), context);
  assert.deepEqual(Array.from(row.range), [-5, 15]);
  assert.deepEqual(Array.from(row.domain), [10, 30]);
});

test('Event threads find typed process series and hide links before their samples exist', () => {
  const context = fixture();
  const row = { z: 0, measure: { id: 'typed-series-id', processId: 'tank.level', kind: 'typed-scalar', points: points() } };
  row.points = row.measure.points;
  Object.assign(context, { THREE, rows: [row], data: { events: [{ id: 'inspection', start: 15, processIds: ['tank.level'], label: 'Inspection' }] },
    field: new THREE.Group(), NAMES: { 'typed-series-id': 'Tank level' }, spark: () => new THREE.Object3D(),
    additive: () => new THREE.LineBasicMaterial(), F: { a: 0 }, X: (time) => time, presence: () => 1,
    rowAt: () => ({ y: 0, z: 0 }), heightAt: () => 1 });
  const start = source.indexOf('const threads = [];');
  const end = source.indexOf("// A thread's stems", start);
  vm.runInContext(`${source.slice(start, end)}\n${fn('layThread')}\nthis.threads = threads;`, context);
  assert.equal(context.threads.length, 1, 'native process identity finds the generated series');
  const group = context.threads[0];
  context.layThread(group);
  assert.equal(group.userData.sparks[0].visible, true);
  assert.equal(group.userData.sparks[0].userData.hover.valueRows[0], row, 'hover reads current samples, not a cached future value');
  context.updateRowSamples(row, true, 150, false);
  context.layThread(group);
  assert.equal(group.userData.sparks[0].visible, false, 'one earlier sample cannot be projected to the Event');
  context.updateRowSamples(row, true, 250, false);
  context.layThread(group);
  assert.equal(group.userData.sparks[0].visible, true);
  group.userData.t = 31;
  context.layThread(group);
  assert.equal(group.userData.sparks[0].visible, false, 'an Event after the series does not receive a held value');
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
  vm.runInNewContext(`${boundedDeclaration}\n${source.slice(start, end)}`, context);
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

test('resting on a reading shows what moved it first: its own tagged reason, else its Event\'s description', () => {
  const context = fixture();
  const reading = (cutId, t, end, v, cut) => ({ t, end, v, cutId, eventId: cutId, born: born(100), cut: { id: cutId, eventLabel: '2016 H2', ...cut } });
  const row = { measure: { kind: 'cut-answer', question: 'How does the core priority divide?', answerKey: 'decentralization', unit: 'share of priority',
    points: [reading('h2', 2016.5, 2017, 0.4, { provenance: ['inferred: DAO hack and bailout fork, the chain split; DoS attacks push security to the front'], eventDescription: 'The stretch.' }),
      reading('h1', 2017, 2017.5, 0.35, { provenance: ['authored'], eventDescription: 'Enterprise Ethereum Alliance; the ICO boom begins.' })] } };
  row.points = row.measure.points;
  context.F = { s: 2 };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const first = plain(context.measureValueLines(row, 2016.7));
  assert.deepEqual(first.slice(0, 3), [['num', '0.4'], ['m', 'DAO hack and bailout fork, the chain split; DoS attacks push security to the front'], ['a', '2016 H2 · 2016.5 – 2017 · inferred']]);
  const second = plain(context.measureValueLines(row, 2017.2));
  assert.deepEqual(second[1], ['m', 'Enterprise Ethereum Alliance; the ICO boom begins.'], 'without a tagged reason, the Event description');
  assert.deepEqual(second[2], ['a', '2016 H2 · 2017 – 2017.5']);
});

test('the Smooth slider blends steps within a recorded stretch, keeps its average and never bridges a gap', async () => {
  const { smoothWithinStretches } = await import('../viewer/public/interval-readings.js');
  const values = [1, 1, 1, 1, 5, 5, 5, 5, 0, 0, 9, 9, 9]; const present = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1];
  assert.deepEqual(Array.from(smoothWithinStretches(values, present, 0)), values, 'zero smoothing draws the readings as recorded');
  const smoothed = Array.from(smoothWithinStretches(values, present, 2));
  assert.ok(smoothed[3] > 1 && smoothed[4] < 5, 'the step between two readings is blended');
  assert.deepEqual(smoothed.slice(8, 10), [0, 0], 'a gap stays empty');
  assert.deepEqual(smoothed.slice(10), [9, 9, 9], 'a constant stretch beyond a gap is untouched by its neighbour');
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  assert.ok(Math.abs(mean(smoothed.slice(0, 8)) - mean(values.slice(0, 8))) < 0.35, 'the stretch keeps roughly its average');
});

test('a reading says how sure it is when its provenance does', () => {
  assert.equal(readingConfidence({ provenance: ['sketch: A first estimate.', 'confidence 0.3'] }), 0.3);
  assert.equal(readingConfidence({ provenance: ['source: The roadmap.', 'confidence 1'] }), 1);
  assert.equal(readingConfidence({ provenance: ['inferred: No confidence given.'] }), null);
  assert.equal(readingConfidence({ provenance: ['confidence 1.5'] }), null, 'out of range is not a confidence');
});
