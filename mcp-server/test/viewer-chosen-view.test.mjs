// The viewer's side of a view the model chose: the address stays the model's until the reader changes a setting, the
// card names what the view highlights in the reader's words, and the time view narrows to the model's rows, links and
// notes until Show every row or Everything.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { highlightName, highlightPresent, levelNames, mountChosenView, noteAddress } from '../viewer/public/chosen-view.js';
import { curationAt } from '../viewer/public/view-settings.js';
import { projectScalarSeries } from '../src/viewer-scalar-series.mjs';
import { typedScalarTrajectories } from '../viewer/public/scalar-trajectories.js';
import { projectNumerics } from '../src/viewer-numerics.mjs';
import { cutTrajectories } from '../viewer/public/cut-trajectories.js';
import { readingAt } from '../viewer/public/interval-readings.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const start = readFileSync(new URL('../viewer/public/start.js', import.meta.url), 'utf8');

test('the address follows the model\'s view until a setting changes; moving within the view is not a change', () => {
  const location = { href: 'https://x.test/m/?data=book&show=processes&camera=locked&chosen=v2' };
  const history = { replaceState: (_state, _title, href) => { location.href = href; } };
  assert.equal(noteAddress(location, history), false, 'the first address the view writes is the baseline');
  location.href = 'https://x.test/m/?data=book&camera=locked&show=processes&pose=1,2,3,4,5,6&at=1851.3&record=%7B%7D&chosen=v2';
  assert.equal(noteAddress(location, history), false, 'camera, moment and selection move within the view');
  location.href = 'https://x.test/m/?data=book&show=processes,notes&camera=locked&chosen=v2';
  assert.equal(noteAddress(location, history), true);
  assert.equal(location.href, 'https://x.test/m/?data=book&show=processes%2Cnotes&camera=locked&chosen=v2&adjusted');
  assert.equal(noteAddress(location, history), false, 'an adjusted view stays adjusted');
  assert.equal(noteAddress({ href: 'https://x.test/m/?data=book&chosen=none' }, history), false, 'the reader\'s own settings follow no view');
});

// A stand-in document with just what the card builds: elements that keep their children, ids and hidden state.
function standInDocument() {
  const byId = new Map();
  const element = (tag) => {
    const node = { tagName: tag, children: [], dataset: {}, attributes: {}, hidden: false, textContent: '', classList: { toggle() {}, add() {} },
      append(...items) { this.children.push(...items); }, after() {}, replaceChildren(...items) { this.children = items; },
      setAttribute(key, value) { this.attributes[key] = value; }, addEventListener() {} };
    Object.defineProperty(node, 'id', { get() { return this._id; }, set(value) { this._id = value; byId.set(value, this); } });
    return node;
  };
  const doc = { body: element('body'), createElement: element, getElementById: (id) => byId.get(id) ?? null };
  for (const id of ['tools', 'detail-stepper', 'coarse-view']) element('span').id = id;
  return doc;
}

test('the model\'s view and the toolbar never offer two detail controls at once', () => {
  const view = { id: 'v1', title: 'Lives', caption: 'Three lives.', settings: {}, levels: [{ label: '+ more' }] };
  for (const [state, toolbar] of [['following', true], ['own', false]]) {
    const document = standInDocument();
    mountChosenView({ data: { views: [view] }, opening: { state, view, level: 0 }, document, location: { href: 'https://x.test/m/?data=book', assign() {} } });
    assert.deepEqual(['detail-stepper', 'coarse-view'].map((id) => document.getElementById(id).hidden), [toolbar, toolbar],
      state === 'own' ? 'on the reader\'s own settings the toolbar stepper is the detail control' : 'on the model\'s view its levels are the detail, so the toolbar stepper waits');
  }
});

test('the card names highlights in the reader\'s words: a moment\'s first sentence, a reading\'s question and year', () => {
  const data = { timeUnit: 'year', events: [{ id: 'e14', label: 'The bounded trial passes. When a register first fails, Davies stops.' }],
    relations: [{ id: 'r1', source: 'e14', target: 'reading.1' }],
    numerics: { cuts: [{ id: 'c1', parentEventId: 'reading.1', question: 'How does Babbage anticipate the fate of his life\'s work?', t: 1851.33 }] },
    graph: { nodes: [{ id: 'n1', title: 'Where the three lives cross', text: '…' }] } };
  assert.equal(highlightName(data, { record: 'event_relation:r1' }), 'The bounded trial passes → How does Babbage anticipate the fate of his life\'s work?, 1851');
  assert.equal(highlightName(data, { record: 'event:e14' }), 'The bounded trial passes');
  assert.equal(highlightName(data, { record: 'cut:c1' }), 'How does Babbage anticipate the fate of his life\'s work?, 1851');
  assert.equal(highlightName(data, { nodeId: 'n1' }), 'Where the three lives cross');
  assert.deepEqual(levelNames({ levels: [{ label: '+ time' }] }), ['The view', '+ time', 'Everything']);
  // A later revision can remove what an earlier view named; the card says so rather than offering it.
  assert.ok(highlightPresent(data, { record: 'event_relation:r1' }) && highlightPresent(data, { record: 'event:reading.1' }) && highlightPresent(data, { nodeId: 'n1' }));
  assert.ok(!highlightPresent(data, { record: 'event_relation:gone' }) && !highlightPresent(data, { record: 'cut:gone' }) && !highlightPresent(data, { nodeId: 'gone' }));
  // A series that opens one answer of another shares its reading Events; the reading named is the undivided one.
  const opened = { ...data, numerics: { cuts: [{ id: 'c2', parentEventId: 'reading.1', question: 'Within security, how does it divide?', t: 1851.33, conditioning: { cut_id: 'c1', answer_key: 'security' } }, ...data.numerics.cuts] } };
  assert.equal(highlightName(opened, { record: 'event_relation:r1' }), 'The bounded trial passes → How does Babbage anticipate the fate of his life\'s work?, 1851');
});

test('the time view narrows to the model\'s choice, ends links on the readings they move, and names what it highlights', () => {
  assert.match(source, /const chosenView = \(data\.views \?\? \[\]\)\.find\(\(view\) => view\.id === params\.get\('chosen'\)\)/u);
  assert.match(source, /if \(opt\.curation\?\.rows && opt\.onlyChanging && !opt\.rowsFallback\) return opt\.curation\.row\(row\);/u);
  assert.match(source, /const context = Boolean\(opt\.curation\?\.relations\.size && !opt\.curation\.relations\.has\(relation\.id\)\);/u, 'the links the model chose are bright, the rest of the rows\' links faint');
  assert.match(source, /lit3 \? 1 : context \? 0\.22 : 0\.8\);\n    if \(context\) \{ arcTargets\.push/u, 'a faint link can still be pointed at, without sparks at its ends');
  assert.match(source, /\(!opt\.curation\?\.notes\.size \|\| opt\.curation\.notes\.has\(light\.userData\.id\)\)/u);
  assert.match(source, /globalThis\.modelViewer\?\.noteAddress\?\.\(\);/u, 'each address the time view writes is checked against the model\'s view');
  assert.match(source, /const linkEnd = \(id\) => byId\.get\(id\) \?\? readingEnds\.get\(id\);/u);
  assert.match(source, /for \(const key of \['record', 'timeView', 'chosen', 'level', 'adjusted'\]\)/u);
  assert.match(source, /document\.getElementById\('chosen-view'\)\]\.filter\(Boolean\)/u, 'the scene makes room for the card');
  assert.match(start, /const opening = openingView\(location\.href, data\?\.views \?\? \[\]\);/u, 'the address is the model\'s view before any view reads it');
});

const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const visibility = section('const CHANGE_COVER', 'const rowSpacing');

test('a chosen native process selects its projected scalar histories without relying on fallback', () => {
  const model = { time_unit: 'day', processes: [{ id: 'tank.level', value_type: { kind: 'scalar' }, unit: 'litre' },
    { id: 'other.level', value_type: { kind: 'scalar' }, unit: 'litre' }],
  initial_claims: ['tank.level', 'other.level'].flatMap((subject) => [-2, 0].map((value_time, i) => ({ id: `${subject}.${i}`, subject,
    value_time, evidence_cutoff: 0, value: { kind: 'scalar', value: i + 4 }, holder: 'observer', mode: 'observed', evidence_type: 'report' }))) };
  const measures = typedScalarTrajectories({ typedScalarSeries: projectScalarSeries(model) });
  assert.equal(measures.length, 2);
  const rows = measures.map((measure) => ({ measure, points: measure.points }));
  const scene = { chosenView: { rows: [{ record: 'process:tank.level' }] }, chosenLevel: 0, curationAt, rows,
    opt: { onlyChanging: true, show: new Set(['processes']) }, boundedMeasure: () => true };
  vm.createContext(scene);
  vm.runInContext(section('const curation = (() => {', 'const noteMarks') + '\nopt.curation = curation;\n' + visibility, scene);
  scene.updateRowsFallback();
  assert.equal(scene.opt.rowsFallback, false, 'the process matches directly; fallback must not conceal a broken lookup');
  assert.deepEqual(rows.filter(scene.visibleRow).map((row) => row.measure.processId), ['tank.level']);
});

test('a hidden first answer keeps the series question and causal link on a visible answer', () => {
  const event = (id, extra = {}) => ({ id, boundary: id, participants: {}, process_ids: [], ...extra });
  const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
  const cut = (id, parent_event_id, beta) => ({ id, parent_event_id, question: 'How is effort allocated?', unit: 'effort',
    answers: [{ key: 'alpha', weight: 0.2 }, { key: 'beta', weight: beta }, { key: 'gamma', weight: 0.8 - beta }, { key: 'remainder', weight: 0 }] });
  const model = { id: 'device', time_unit: 'hours', processes: [], meaning_model: {
    referents: [{ id: 'device', boundary: 'Device', lifecycle_event_id: 'life' }],
    events: [event('world'), event('life'), event('first', { interval: { start: 0, end: 5 } }), event('later', { interval: { start: 5, end: 10 } })],
    context_roots: [{ event_id: 'world', kind: 'accepted_world' }],
    event_relations: [contains('world', 'life'), contains('life', 'first'), contains('life', 'later')],
    normalized_cuts: [cut('first-cut', 'first', 0.3), cut('later-cut', 'later', 0.5)],
  } };
  const nativeMeasures = cutTrajectories({ inspection: { model }, numerics: projectNumerics(model) });
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    copy(point) { Object.assign(this, point); return this; }
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  }
  const rows = nativeMeasures.map((measure, z) => ({ measure, points: measure.points, name: { visible: false, position: new Vector3(-1, 1, z) } }));
  const relation = { id: 'cause', source: 'first', target: 'later', kind: 'causes' };
  const scene = { rows, nativeMeasures, byId: new Map(), pinnedTarget: null, data: { relations: [relation] }, sourceEventRows: new Map([['first', rows], ['later', rows]]), rowOf: new Map(),
    opt: { onlyChanging: true, show: new Set(['processes', 'causal']), edges: true }, boundedMeasure: () => true,
    F: { a: 0, b: 10 }, presence: (row) => row.name.visible ? 1 : 0, rowValue: (row, t) => readingAt(row.points, t)?.value ?? null,
    shownByPlay: () => true, bornAt: () => -Infinity, rowAt: (row) => row.name.position, X: (t) => t,
    heightAt: (row, t) => readingAt(row.points, t).value * 18,
    THREE: { Vector3, QuadraticBezierCurve3: class { constructor(a, _mid, b) { this.ends = [a, b]; } getPoints() { return this.ends; } } },
    arcsBuffer: { begin() {}, end() {}, add() {} }, arcSparks: [], laneTag: {}, inView: () => true, seen: () => true,
    KIND: { causes: '#ff8a4c' }, color: (hex) => hex, litArc: null, arcControlY: () => 1,
    spark: () => ({ material: { color: { set() {} } }, position: new Vector3() }), field: { add() {} },
  };
  vm.createContext(scene); vm.runInContext(visibility, scene); scene.updateRowsFallback();
  rows.forEach((row) => { row.name.visible = scene.visibleRow(row); if (row.measure.series.first) row.caption = { visible: false, position: new Vector3() }; });
  assert.deepEqual(rows.map((row) => row.name.visible), [false, true, true]);
  vm.runInContext(section('function syncSeriesCaptions()', '// Lay a curtain'), scene);
  scene.syncSeriesCaptions();
  assert.equal(rows[0].caption.visible, true);
  assert.deepEqual(rows[0].caption.position, rows[1].name.position, 'the one question moves to the first visible answer');
  // Smoothing redraws each curtain without calling apply; the hidden original row must not reclaim its caption.
  Object.assign(rows[0], { domain: [0, 10], wall: { material: {} }, crest: { material: {} }, value: { position: new Vector3() } });
  scene.LENGTH = 116;
  vm.runInContext(section('function layRow(', '// The height of a row'), scene);
  scene.layRow(rows[0]);
  assert.equal(rows[0].caption.visible, true);
  assert.deepEqual(rows[0].caption.position, rows[1].name.position);
  vm.runInContext(section('const readingEnds = new Map();', 'const neighbours =') + section('const causalAll =', 'const inStory')
    + section('function rowsForEvent(', '// A causal link that crosses'), scene);
  // A detail projection can include the visible answers without the first answer.
  scene.opt.detailProjection = { rowIds: new Set(rows.slice(1).map((row) => row.measure.id)), eventIds: new Set() };
  scene.drawArcs();
  const targets = vm.runInContext('arcTargets', scene);
  assert.equal(targets.length, 1, 'the relation is still drawn');
  assert.equal(targets[0].relation, relation, 'the original whole-Event relation is retained');
  assert.equal(targets[0].pts.at(-1).z, rows[1].name.position.z);
  assert.match(targets[0].target.label, /How is effort allocated/u);
  const end = targets[0].target;
  const ordinaryReading = { ...end, reading: { about: [], holder: 'root', perspective: 'modeler' } };
  assert.equal(scene.eventPoint(ordinaryReading).z, rows[1].name.position.z,
    'ordinary understanding Events carry reading metadata without a series key');
  const child = { ...rows[1], measure: { ...rows[1].measure, series: { key: 'child' }, level: 1 } };
  scene.sourceEventRows.set('later', [child, ...rows]);
  assert.equal(scene.readingRow(end, 5), rows[1], 'a visible undivided answer remains preferred over its detail');
  rows.forEach((row) => { row.name.visible = false; });
  scene.sourceEventRows.set('later', rows); scene.syncSeriesCaptions();
  assert.equal(rows[0].caption.visible, false);
  assert.equal(scene.eventPoint(end), null, 'no endpoint is invented when the whole series is hidden');
});
