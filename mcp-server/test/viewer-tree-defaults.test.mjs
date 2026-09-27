import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createProcessDetail } from '../viewer/public/process-detail.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
// Run the viewer's real initialization, controls and layout with rendering replaced.
function between(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Missing viewer section ${startText}`);
  return source.slice(start, end);
}
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing viewer function ${name}`);
  const lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).trimEnd().endsWith('}')) return source.slice(start, lineEnd);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `Missing function boundary for ${name}`);
  return source.slice(start, end + 2);
}
const layers = ['processes', 'threads', 'decisions', 'lovefear', 'causal', 'notes', 'events', 'subsidiary', 'prose'];
const node = (id, depth, group = 'world', kind = 'event') => ({ id, depth, group, kind, trunk: depth <= 1, t0: 0, t1: 1 });
function fixture(search = '', hasPaths = true) {
  const context = {
    URLSearchParams, params: new URLSearchParams(search), createProcessDetail, treeEvents: [],
    data: { measures: hasPaths ? [{ points: [{ t: 0, v: 1 }, { t: 1, v: 2 }] }] : [], constructionTiming: 'unavailable' },
    hasTree: true, nodes: [node('world', 0), node('life', 1), node('work', 2, 'world', 'sub'), node('episode', 4), node('detail', 6)], rows: [],
    KINDS: layers.map((key) => [key]), lensList: [{ id: 'a-lens' }],
    terrain: { on: false }, blend: { to: 0 }, dirty: false, relayout: false, extrasDirty: false,
    computeLayout() {}, apply() {}, syncPanel() {}, syncURL() {}, showTerrain(on) { context.terrain.on = on; },
    showThoughts() {},
  };
  vm.createContext(context);
  vm.runInContext([
    between('const hasPaths =', 'let selectedPart ='),
    between('const MAX_DEPTH =', 'const lensList ='),
    functionSource('setLayout'), functionSource('setEverything'),
    'this.opt = opt; this.layerOverrides = layerOverrides; this.maximumDepth = MAX_DEPTH;',
    'this.chooseDepth = (value) => { explicitDepth = true; opt.depth = value; };',
  ].join('\n'), context);
  context.opt.camera = 'locked'; // Layout tests do not need to create a WebGL camera.
  return context;
}
function saveURL(context) {
  const saved = [];
  Object.assign(context, { ready: true, temporalActive: true, urlTimer: null, currentPreset: 'story', atEnd: true, playing: false,
    isEverything: () => false, document: { getElementById: () => ({ hidden: true }) }, qrPanel: { hidden: true },
    location: { pathname: '/model-token/' }, history: { replaceState: (_state, _title, url) => saved.push(url) },
    clearTimeout() {}, setTimeout() { throw new Error('The save should be immediate.'); } });
  vm.runInContext(functionSource('syncURL'), context);
  context.syncURL(true);
  return new URL(saved[0], 'http://127.0.0.1:1234');
}

test('opening Tree includes Events and subsidiary processes through depth four with or without numeric paths', () => {
  for (const hasPaths of [true, false]) {
    const context = fixture('view=layers', hasPaths);
    assert.equal(context.opt.layout, 'layers');
    assert.equal(context.opt.depth, 4);
    assert.ok(context.opt.show.has('events'));
    assert.ok(context.opt.show.has('subsidiary'));
    assert.ok(context.opt.show.has('numbers'), 'recorded numerical readings are available without numeric paths');
  }
  const processes = fixture('view=together');
  assert.equal(processes.opt.depth, 2);
  assert.equal(processes.opt.show.has('events'), false);
  assert.equal(processes.opt.show.has('subsidiary'), false);
});

test('switching from Processes to Tree applies Tree defaults without replacing deliberate layer or depth choices', () => {
  const context = fixture('view=together');
  context.setLayerVisibility('notes', false);
  context.setLayout('layers');
  assert.equal(context.opt.depth, 4);
  assert.equal(context.opt.show.has('notes'), false);
  assert.ok(context.opt.show.has('events'));
  assert.ok(context.opt.show.has('subsidiary'));
  context.setLayerVisibility('events', false);
  context.chooseDepth(1);
  context.setLayout('together');
  context.setLayout('layers');
  assert.equal(context.opt.depth, 1);
  assert.equal(context.opt.show.has('events'), false);
  assert.equal(context.opt.show.has('notes'), false);
});

test('URL layer and depth selections remain explicit across layout changes', () => {
  const context = fixture('view=together&depth=0&show=notes');
  context.setLayout('layers');
  assert.equal(context.opt.depth, 0);
  assert.deepEqual([...context.opt.show], ['notes']);
  const noThoughts = fixture('view=together&nothoughts');
  noThoughts.setLayout('layers');
  assert.equal(noThoughts.opt.show.has('notes'), false);
  assert.ok(noThoughts.opt.show.has('events'));
  assert.ok(noThoughts.opt.show.has('subsidiary'));
});

test('hiding notes survives reload without freezing Processes defaults when switching to Tree', () => {
  const context = fixture('view=together');
  context.setLayerVisibility('notes', false);
  const saved = saveURL(context);
  assert.equal(saved.searchParams.has('nothoughts'), true);
  assert.equal(saved.searchParams.has('show'), false, 'a notes-only choice does not become a full layer selection');
  const reloaded = fixture(saved.search);
  assert.equal(reloaded.opt.show.has('notes'), false);
  reloaded.setLayout('layers');
  assert.equal(reloaded.opt.show.has('notes'), false);
  assert.ok(reloaded.opt.show.has('events'));
  assert.ok(reloaded.opt.show.has('subsidiary'));
  assert.equal(reloaded.opt.depth, 4);
});

test('resetting Everything restores the current layout defaults and clears previous overrides', () => {
  for (const layout of ['layers', 'together']) {
    const context = fixture(`view=${layout}&depth=1&show=notes`);
    context.setEverything(true);
    assert.equal(context.opt.depth, context.maximumDepth);
    assert.ok(context.opt.show.has('events'));
    assert.equal(context.opt.lenses.size, 1);
    context.setEverything(false);
    assert.equal(context.opt.depth, layout === 'layers' ? 4 : 2);
    assert.equal(context.opt.show.has('events'), layout === 'layers');
    assert.equal(context.opt.show.has('subsidiary'), layout === 'layers');
    assert.equal(context.opt.lenses.size, 0);
    assert.equal(context.layerOverrides.size, 0);
    context.setLayout(layout === 'layers' ? 'together' : 'layers');
    assert.equal(context.opt.depth, layout === 'layers' ? 2 : 4, 'reset also releases the explicit depth override');
  }
});

test('tree Events without numeric rows receive finite positions in both layout representations', () => {
  const numericGroup = { id: 'ana', label: 'Ana', rows: [] };
  const rows = [{ group: numericGroup, measure: { id: 'ana.capacity' }, depth: 2, yT: 0 }];
  const nodes = [node('ana.life', 1, 'ana'), node('bo.life', 1, 'bo'), node('bo.work', 2, 'bo', 'sub'), node('world.history', 0), node('world.episode', 4)];
  const context = { nodes, rows, groups: [numericGroup], principals: [{ id: 'ana', name: 'Ana' }, { id: 'bo', name: 'Bo' }],
    opt: { depth: 4, camera: 'free', show: new Set(layers) }, ROW: 2.7, GAP: 4.4, LANE: 1, LAMP: 3.2, MIN_DUR: 0.02,
    floors: [], layersBounds: null, dirty: false, relayout: false, WORLD: '#9085e9', hueOfOwner: () => '#9085e9', fitLocked() {} };
  vm.createContext(context);
  vm.runInContext([
    between('const visibleNode =', 'function pack('),
    functionSource('pack'), functionSource('computeLayout'),
  ].join('\n'), context);
  context.computeLayout();
  for (const item of [...nodes, ...rows]) {
    assert.equal(item.inL, true, item.id ?? item.measure.id);
    for (const coordinate of ['yT', 'zT', 'yL', 'zL']) assert.ok(Number.isFinite(item[coordinate]), `${item.id ?? item.measure.id}.${coordinate}: ${item[coordinate]}`);
  }
  assert.ok(context.floors.some((floor) => floor.level === 4 && floor.roles.includes(nodes.at(-1))), 'the visible descendant is included in its tree floor');
});
