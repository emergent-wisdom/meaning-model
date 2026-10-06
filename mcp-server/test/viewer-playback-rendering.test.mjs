import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as playback from '../viewer/public/playback-time.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
// Execute the viewer's actual function bodies, with only its rendering objects replaced.
// Top-level function declarations end at an unindented closing brace in view.js.
function functionSource(name, required = true) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0 && !required) return '';
  assert.ok(start >= 0, `Missing viewer function ${name}`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `Missing function boundary for ${name}`);
  return source.slice(start, end + 2);
}
const declaration = (name, required = true) => {
  const line = source.split('\n').find((entry) => entry.startsWith(`const ${name} =`));
  if (!line && !required) return '';
  assert.ok(line, `Missing viewer declaration ${name}`);
  return line;
};
const position = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { Object.assign(this, { x: a, y: b, z: c }); } });
const born = (at) => ({ at: new Date(at).toISOString() });
const event = (id, start, at = start) => ({ id, start, born: born(at) });
function note(id, target, at = target.start) {
  return { visible: true, position: position(target.start, 4, 1), scale: { setScalar(value) { this.value = value; } },
    userData: { node: { id }, t: target.start, born: at, at: { event: target }, size: 1, z: 1 } };
}
function buffer() {
  return { calls: [], begin() { this.calls = []; }, add(...args) { this.calls.push(args); }, end() {} };
}
function fixture(mode = 'story', points = []) {
  const geometry = { attributes: { position: { array: new Float32Array(points.length * 6), needsUpdate: false } },
    drawRange: { start: 0, count: points.length * 2 }, setDrawRange(start, count) { this.drawRange = { start, count }; } };
  const context = { madeAt: (born) => (born?.at ? Date.parse(born.at) : NaN), constructionByClock: true, ...playback, opt: { mode, show: new Set(['notes', 'threads']), edges: true, speed: 1 },
    now: 3, tau: 3, atEnd: false, playing: true, F: { a: 0, b: 10 }, LENGTH: 100, TS: 1, TAMP: 10, TNX: 3,
    terrain: { built: true, on: true, clip: {}, rows: [], beams: [], mind: points, threadCount: points.length,
      threads: { geometry, visible: true }, ridgeNames: [], sectionNames: [], ts: new Float64Array([1, 5, 9]) },
    selectedPart: null, selectedEventIds: new Set(), selectedLinks: [], noteById: new Map(points.map((point) => [point.userData.node.id, point])),
    byId: new Map(points.map((point) => [point.userData.at.event.id, point.userData.at.event])),
    X: (t) => t, inView: (t) => Number.isFinite(t) && t >= 0 && t <= 10,
    drawTerrainArcs() {}, heightsTerrain() {}, smooth: (value) => value, blend: { now: 0 }, nodes: [], lensList: [],
    color: (value) => value, anchor: (_id, t) => position(t, 0, 0), meet: (item) => [position(item.start, 0, 0)],
    extraTargets: [], extraWalls: buffer(), extraCrests: buffer(), extraGrid: buffer(), connectors: buffer(),
    chips: buffer(), extraGlows: buffer(), proseLines: buffer() };
  context.building = () => context.opt.mode === 'construction';
  vm.createContext(context);
  const functions = ['drawTerrainNoteLinks', 'syncTerrainLabels', 'drawSelectedStoryLinks'].map((name) => functionSource(name, false));
  vm.runInContext([declaration('bornAt'), declaration('playbackClock', false), declaration('shownByPlay'), ...functions, functionSource('applyTerrain'), functionSource('drawExtras')].join('\n'), context);
  return context;
}

test('terrain playback removes future note threads and rebuilds them when seeking in either direction', () => {
  for (const mode of ['story', 'construction']) {
    const points = [note('arrived', event('early', 2)), note('future', event('late', 8))];
    const context = fixture(mode, points);
    context.applyTerrain();
    assert.deepEqual(points.map((point) => point.visible), [true, false], mode);
    assert.equal(context.terrain.threads.geometry.drawRange.count, 2, `${mode}: no segment to the hidden note`);
    assert.deepEqual(Array.from(context.terrain.threads.geometry.attributes.position.array.slice(0, 3)), [2, 4, 1]);
    context.now = context.tau = 9;
    context.applyTerrain();
    assert.equal(context.terrain.threads.geometry.drawRange.count, 4, `${mode}: both segments after arrival`);
    context.now = context.tau = 3;
    context.applyTerrain();
    assert.equal(context.terrain.threads.geometry.drawRange.count, 2, `${mode}: seeking backward removes stale segments`);
    context.opt.edges = false;
    context.applyTerrain();
    assert.equal(context.terrain.threads.visible, false);
  }
});

test('selecting a future document keeps its note inspectable without revealing its future Event link or glow', () => {
  for (const mode of ['story', 'construction']) {
    const target = event('late', 8);
    const point = note('selected', target);
    const context = fixture(mode, [point]);
    context.selectedPart = { unit: { id: 'selected' } };
    context.selectedEventIds.add(target.id);
    context.applyTerrain();
    context.drawExtras();
    assert.equal(point.visible, true, `${mode}: the explicit selection stays inspectable`);
    assert.equal(context.proseLines.calls.length, 0, `${mode}: no selected-document link to the future Event`);
    assert.equal(context.extraGlows.calls.length, 0, `${mode}: no future Event glow`);
    assert.equal(context.selectedLinks.length, 0, `${mode}: no invisible future link hit target`);
    assert.equal(context.terrain.threads.geometry.drawRange.count, 0, `${mode}: the future Event thread stays hidden`);
    // The selection exception belongs to the document: an already arrived target is safe to show.
    target.start = 2; target.born = born(2);
    context.applyTerrain();
    context.drawExtras();
    assert.equal(context.terrain.threads.geometry.drawRange.count, 2);
    assert.equal(context.proseLines.calls.length, 1);
    assert.equal(context.extraGlows.calls.length, 1);
    assert.equal(context.selectedLinks.length, 1);
  }
});

test('terrain ridge labels follow their first visible sample and their construction birth', () => {
  for (const mode of ['story', 'construction']) {
    const context = fixture(mode);
    const row = { samples: new Float64Array([0, 0, 1]), firstTime: 1, born: 8, scale: 1, target: 1, amp: 1, z: 0 };
    const object = { visible: true, position: position() };
    context.terrain.rows.push(row);
    context.terrain.ridgeNames.push({ row, object });
    context.applyTerrain();
    assert.equal(object.visible, false, `${mode}: a future label cannot leak past the playback cursor`);
    context.now = context.tau = 9;
    row.scale = 1; // The scene animation has finished raising the newly arrived row.
    context.applyTerrain();
    assert.equal(object.visible, true, `${mode}: the label appears when it arrives`);
    context.now = context.tau = 3;
    context.applyTerrain();
    assert.equal(object.visible, false, `${mode}: the label disappears on backward seek`);
  }
});

test('a small model names its ridges before their samples are taken, and Terrain opens without an error', () => {
  // Up to 14 functions are named; a snapshot with no people and few functions reached the names before any sample.
  const context = fixture('story');
  const row = { firstTime: 1, born: 8, scale: 1, target: 1, amp: 1, z: 0 };
  const object = { visible: true, position: position() };
  context.terrain.rows.push(row); context.terrain.ridgeNames.push({ row, object });
  assert.doesNotThrow(() => context.applyTerrain());
  assert.equal(object.visible, false, 'a name waits for its ridge');
});

test('first opening Terrain after seeking waits for ridge samples before calculating heights', () => {
  // Activation restores the Processes/Tree cursor before the next frame runs layTerrain().
  const context = fixture('story');
  const attribute = () => ({ count: 3, array: new Float32Array(9),
    setY(i, value) { this.array[i * 3 + 1] = value; },
    setXYZ(i, x, y, z) { this.array.set([x, y, z], i * 3); } });
  context.terrain.mesh = { geometry: { attributes: { position: attribute(), color: attribute() },
    computeVertexNormals() {}, computeBoundingSphere() {} } };
  context.terrain.ps = new Float64Array(3); context.F.s = 10;
  context.THREE = { Color: class { copy(other) { Object.assign(this, other); return this; } lerp() { return this; } } };
  context.color = () => ({ r: 0, g: 0, b: 0 });
  const ridge = (firstTime, samples) => ({ firstTime, born: firstTime, scale: 1, target: 1, amp: 1, z: 0,
    reach: [[0, 1]], color: { r: 1, g: 1, b: 1 }, recipe: () => new Float64Array(samples),
    ridge: { geometry: { attributes: { position: attribute() } } } });
  const arrived = ridge(0, [1, 1, 1]); const future = ridge(8, [0, 0, 1]);
  context.terrain.rows.push(arrived, future);
  context.terrain.ridgeNames = [arrived, future].map((row) => ({ row, object: { visible: true, position: position() } }));
  vm.runInContext([functionSource('heightsTerrain'), functionSource('layTerrain')].join('\n'), context);
  assert.doesNotThrow(() => context.applyTerrain(), 'an intermediate retained cursor hides future ridges before sampling');
  assert.equal(future.scale, 0);
  assert.deepEqual(context.terrain.ridgeNames.map(({ object }) => object.visible), [false, false]);
  assert.equal(context.terrain.mesh.geometry.attributes.position.needsUpdate, undefined, 'no unsampled geometry is calculated');
  assert.doesNotThrow(() => context.layTerrain(), 'the first layout samples and draws the retained time');
  context.applyTerrain();
  assert.deepEqual(context.terrain.ridgeNames.map(({ object }) => object.visible), [true, false]);
  assert.equal(arrived.ridge.visible, true); assert.equal(future.ridge.visible, false);
  assert.equal(context.terrain.mesh.geometry.attributes.position.array[1], context.TAMP);
});

test('starting either playback mode applies the reset cursor before the first timer tick', () => {
  for (const mode of ['story', 'construction']) {
    const applications = []; const timers = [];
    const clock = (value) => value; clock.total = 10; clock.invert = (value) => value;
    const context = { opt: { mode, speed: 1 }, now: 10, tau: 10, C0: 1, C1: 10, F: { a: 2, b: 10 },
      atEnd: true, playing: false, timer: null, rows: [], activeClock: clock, setText() {},
      building: () => mode === 'construction', setInterval(callback, delay) { timers.push({ callback, delay }); return 1; } };
    context.apply = () => applications.push({ now: context.now, tau: context.tau, atEnd: context.atEnd, playing: context.playing });
    vm.createContext(context);
    vm.runInContext(functionSource('play'), context);
    context.play();
    assert.equal(applications.length, 1, `${mode}: visibility must update without waiting for a timer`);
    assert.equal(applications[0][mode === 'story' ? 'now' : 'tau'], mode === 'story' ? 2 : 1);
    assert.equal(applications[0].atEnd, false);
    assert.equal(applications[0].playing, true);
    assert.equal(timers.length, 1);
  }
});

test('an undated construction counts its steps instead of inventing a clock time', () => {
  const text = {};
  const elements = { fill: { style: {} }, reader: { hidden: true } };
  const clock = (value) => value; clock.total = 2;
  const steps = [{ order: 0, at: null, kind: 'model', rev: 0, label: 'The world.' }, { order: 1, at: null, kind: 'model', rev: 1, label: 'Kieran.' }, { order: 2, at: null, kind: 'graph', rev: 0, label: 'The first part.' }];
  const context = { madeAt: (born) => (Number.isFinite(born?.order) ? born.order : NaN), stepClock: (step) => step.order, constructionByClock: false,
    opt: { mode: 'construction', show: new Set() }, atEnd: false, playing: false, now: 3, tau: 1, F: { a: 0, b: 10 }, T1: 10, calendarTime: false,
    rows: [], groupLabels: [], threads: [], decisions: [], lenses: [], notes: [], mind: {}, sweep: { position: {} }, activeClock: clock, xOf: (value) => value,
    fracOf: (frame, value) => (value - frame.a) / (frame.b - frame.a), document: { getElementById: (id) => elements[id] }, setText: (id, value) => { text[id] = value; },
    steps, data: { graph: { nodes: [] } }, NOTE_NAMES: {}, unitOf: new Map(), clip: (value) => value,
    isStory: () => false, momentText: String, partsNow: () => [], storyParts: [], hasStory: false,
    captionBox: { hidden: false }, showStats() {}, applyTerrain() {}, drawNotes() {}, drawArcs() {}, syncStrip() {}, syncBigNames() {} };
  context.building = () => true;
  vm.createContext(context); vm.runInContext([functionSource('syncSeriesCaptions'), functionSource('apply')].join('\n'), context);
  context.apply();
  assert.equal(text.clock, 'Step 2 of 3');
  assert.equal(text.kind, 'The agent · model revision 1');
  assert.equal(text.text, 'Kieran.');
  assert.doesNotMatch(text.clock, /UTC|minutes/);
});

test('construction captions return after an empty model-time caption is hidden', () => {
  const text = {};
  const elements = { fill: { style: {} }, reader: { hidden: true } };
  const clock = (value) => value; clock.total = 10000;
  const context = { madeAt: (born) => (born?.at ? Date.parse(born.at) : NaN), stepClock: (step) => Date.parse(step.at), constructionByClock: true, opt: { mode: 'story', show: new Set() }, atEnd: false, playing: false,
    now: 3, tau: 5000, F: { a: 0, b: 10 }, T1: 10, calendarTime: false,
    rows: [], groupLabels: [], threads: [], decisions: [], lenses: [], notes: [],
    mind: {}, sweep: { position: {} }, activeClock: clock, xOf: (value) => value,
    fracOf: (frame, value) => (value - frame.a) / (frame.b - frame.a),
    document: { getElementById: (id) => elements[id] }, setText: (id, value) => { text[id] = value; },
    steps: [{ at: new Date(4000).toISOString(), kind: 'model', rev: 2, label: 'Correct the declared boundary.' }],
    data: { graph: { nodes: [] } }, NOTE_NAMES: {}, unitOf: new Map(), clip: (value) => value,
    isStory: () => false, momentText: String, partsNow: () => [], storyParts: [], hasStory: false,
    captionBox: { hidden: false }, showStats() {}, applyTerrain() {}, drawNotes() {}, drawArcs() {}, syncStrip() {}, syncBigNames() {} };
  context.building = () => context.opt.mode === 'construction';
  vm.createContext(context); vm.runInContext([functionSource('syncSeriesCaptions'), functionSource('apply')].join('\n'), context);
  for (let i = 0; i < 2; i++) {
    context.opt.mode = 'story'; context.apply();
    assert.equal(context.captionBox.hidden, true, 'no empty story caption for a model without prose');
    context.opt.mode = 'construction'; context.apply();
    assert.equal(context.captionBox.hidden, false, 'switching to Construction reveals the revision reason');
    assert.equal(text.kind, 'The agent · model revision 2');
    assert.equal(text.text, 'Correct the declared boundary.');
  }
});

test('a measure has no value before its first sample and every unit can format that absence safely', () => {
  const arrow = (name) => {
    const start = source.indexOf(`const ${name} =`);
    assert.ok(start >= 0, `Missing viewer declaration ${name}`);
    const end = source.indexOf('\n};', start);
    assert.ok(end > start);
    return source.slice(start, end + 3);
  };
  const { valueAt, format, measurePosition } = vm.runInNewContext([
    arrow('valueAt'), arrow('measurePosition'), declaration('money'), arrow('format'),
    '({ valueAt, format, measurePosition })',
  ].join('\n'));
  const points = [{ t: 2, v: 3 }, { t: 4, v: 5 }];
  assert.equal(valueAt(points, 1), null, 'the first recorded value is not projected backward in time');
  assert.equal(measurePosition(points, 1).samples.length, 0, 'there is no sample to cite before the record begins');
  for (const unit of ['GBP', 'USD', 'hours', '0-10', 'share of normal', '0-1', '']) {
    const row = { measure: { unit, points } };
    assert.equal(format(row, valueAt(points, 1)), 'No recorded value yet', `a pre-sample Event can be formatted at module initialization (${unit || 'unitless'})`);
  }
  assert.deepEqual([valueAt(points, 2), valueAt(points, 3), valueAt(points, 4), valueAt(points, 5)], [3, 4, 5, null], 'the last value is not held after its sample');
  assert.equal(format({ measure: { unit: '0-10' } }, 0), '0.0 of 10', 'a recorded zero is a value');
});
