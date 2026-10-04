import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createProcessDetail } from '../viewer/public/process-detail.js';
import { nestedEventLayout } from '../viewer/public/nested-event-layout.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const boundedDeclaration = source.split('\n').find((line) => line.startsWith('const boundedMeasure ='));
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
    URLSearchParams, params: new URLSearchParams(search), createProcessDetail, treeEvents: [], recordedMeasures: [],
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

test('Shining defaults off and explicit on or off choices survive saved URLs', () => {
  for (const query of ['', 'glare=unknown', 'glare=soft', 'glare=full']) {
    const context = fixture(query);
    const expected = query === 'glare=full' ? 'full' : 'soft';
    assert.equal(context.opt.glare, expected);
    const saved = saveURL(context);
    assert.equal(saved.searchParams.get('glare'), expected === 'full' ? 'full' : null);
    assert.equal(fixture(saved.search).opt.glare, expected);
    context.opt.glare = expected === 'full' ? 'soft' : 'full';
    assert.equal(fixture(saveURL(context).search).opt.glare, context.opt.glare);
  }
});

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

test('until chosen, documents stand on floors in Tree and in the Original band elsewhere; a choice survives URL saves and layout changes', () => {
  for (const query of ['', 'noteLayout=unknown', 'view=together']) {
    const context = fixture(query);
    assert.equal(context.opt.noteLayout, 'original');
    assert.equal(saveURL(context).searchParams.has('noteLayout'), false, 'an implicit default is not saved');
    context.setLayout('layers');
    assert.equal(context.opt.noteLayout, 'floors', 'the tree puts each document on the floor of what it belongs to');
    assert.equal(saveURL(context).searchParams.has('noteLayout'), false, 'the tree default is not saved either');
    context.setLayout('together');
    assert.equal(context.opt.noteLayout, 'original');
  }
  assert.equal(fixture('view=layers').opt.noteLayout, 'floors');
  for (const noteLayout of ['floors', 'original', 'nearby', 'overhead', 'centered']) {
    const context = fixture(`view=together&noteLayout=${noteLayout}`);
    assert.equal(context.opt.noteLayout, noteLayout);
    for (const layout of ['layers', 'terrain', 'together']) {
      context.setLayout(layout);
      assert.equal(context.opt.noteLayout, noteLayout, 'switching the main representation must retain the note preference');
    }
    const saved = saveURL(context);
    assert.equal(saved.searchParams.get('noteLayout'), noteLayout);
    assert.equal(fixture(saved.search).opt.noteLayout, noteLayout);
  }
});

test('All attachments is an independent opt-in URL preference across temporal layouts', () => {
  for (const query of ['', 'noteLinks=', 'noteLinks=unknown', 'noteLinks=true']) {
    const context = fixture(query);
    assert.equal(context.opt.allNoteAttachments, false);
    assert.equal(saveURL(context).searchParams.has('noteLinks'), false);
  }
  for (const noteLayout of ['original', 'nearby', 'overhead', 'centered']) {
    const context = fixture(`noteLayout=${noteLayout}&noteLinks=all`);
    for (const layout of ['layers', 'terrain', 'together']) {
      context.setLayout(layout);
      assert.equal(context.opt.allNoteAttachments, true);
      assert.equal(context.opt.noteLayout, noteLayout);
    }
    const saved = saveURL(context);
    assert.equal(saved.searchParams.get('noteLinks'), 'all');
    assert.equal(fixture(saved.search).opt.allNoteAttachments, true);
    context.opt.allNoteAttachments = false;
    assert.equal(saveURL(context).searchParams.has('noteLinks'), false);
  }
});

test('nested Events are an opt-in URL preference retained across temporal representations', () => {
  for (const query of ['', 'eventLayout=unknown', 'eventLayout=traditional']) {
    const context = fixture(query);
    assert.equal(context.opt.eventLayout, 'traditional');
    assert.equal(saveURL(context).searchParams.has('eventLayout'), false);
  }
  const context = fixture('view=together&eventLayout=nested&noteLayout=overhead&noteLinks=all');
  for (const layout of ['layers', 'terrain', 'together']) {
    context.setLayout(layout);
    assert.equal(context.opt.eventLayout, 'nested');
    assert.equal(context.opt.noteLayout, 'overhead');
    assert.equal(context.opt.allNoteAttachments, true);
  }
  const saved = saveURL(context);
  assert.equal(saved.searchParams.get('eventLayout'), 'nested');
  assert.equal(fixture(saved.search).opt.eventLayout, 'nested');
  context.opt.eventLayout = 'traditional';
  assert.equal(saveURL(context).searchParams.has('eventLayout'), false);
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
    boundedDeclaration,
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

function nestedFixture({ collision = false, lifeOnPerson = false } = {}) {
  const raw = [
    { id: 'world', parent: null, depth: 0, owner: null },
    { id: 'ana.life', parent: 'world', depth: 1, owner: 'ana' },
    { id: 'ana.work', parent: 'ana.life', depth: 2, owner: 'ana', role: 'slow' },
    // Inner contexts can restart their recorded depth. Containment still wins.
    { id: 'ana.inner', parent: 'ana.work', depth: 0, owner: null },
    { id: 'ana.choice', parent: 'ana.inner', depth: 1, owner: 'bo' },
    { id: 'bo.life', parent: 'world', depth: 1, owner: 'bo' },
    { id: 'bo.work', parent: 'bo.life', depth: 2, owner: null, role: 'slow' },
    { id: 'meeting', parent: 'world', depth: 1, owner: null, participants: ['ana', 'bo'] },
    ...(collision ? [{ id: 'viewer-row:0', parent: 'bo.work', depth: 3, owner: 'bo' }] : []),
  ].map((event, index) => Object.freeze({ ...event, reach: Object.freeze([index / 10, 10]) }));
  const people = ['ana', 'bo'].map((id) => Object.freeze({ id, name: id, ...(lifeOnPerson ? { life: Object.freeze({ eventId: `${id}.life` }) } : {}) }));
  const group = { id: 'ana', label: 'Ana', rows: [] };
  const rows = [
    ['ana.cut.answer', 'ana.inner', 'cut-answer'],
    ['ana.cut.remainder', 'ana.inner', 'cut-answer'],
    ['ana.capacity', 'ana.work', 'scalar'],
    ['ana.unparented', 'unavailable-home', 'scalar'],
  ].map(([id, home, kind]) => ({ group, home, depth: 3, yT: 0, measure: Object.freeze({
    id, home, kind, points: Object.freeze([Object.freeze({ t: 0, v: 0 }), Object.freeze({ t: 10, v: 1 })]),
  }) }));
  const nodes = raw.map((event) => ({ ...node(event.id, event.depth, event.owner ?? 'world', event.role === 'slow' ? 'sub' : 'event'),
    event, parent: event.parent, owner: event.owner, t0: event.reach[0], t1: event.reach[1] }));
  const context = {
    data: { people, events: raw }, nodes, rows, groups: [group], principals: people,
    referents: new Map(lifeOnPerson ? [] : people.map((person) => [person.id, { life: `${person.id}.life` }])),
    nestedEventLayout, processDetail: createProcessDetail(raw, rows), unopenedProcessIds: new Set(),
    opt: { depth: 6, camera: 'free', eventLayout: 'traditional', layout: 'layers', show: new Set(layers), detailLevel: null, processScope: null },
    ROW: 2.7, CUT_ROW: 6, GAP: 4.4, LANE: 1, LAMP: 3.2, CUT_AMP: 18, MIN_DUR: 0.02,
    floors: [], layersBounds: null, dirty: false, relayout: false, extrasDirty: false,
    WORLD: '#9085e9', hueOfOwner: () => '#9085e9', fitLocked() {},
    push(map, key, value) { if (!map.has(key)) map.set(key, []); map.get(key).push(value); },
    syncPanel() {}, syncURL() {},
  };
  vm.createContext(context);
  vm.runInContext([
    boundedDeclaration,
    between('const visibleNode =', 'function pack('), functionSource('pack'),
    functionSource('computeNestedLayout'), functionSource('computeLayout'), functionSource('setEventLayout'),
  ].join('\n'), context);
  return context;
}
const coordinates = (context) => [...context.nodes, ...context.rows].map((item) => ({
  id: item.id ?? item.measure.id, inT: item.inT, inL: item.inL,
  yT: item.yT, zT: item.zT, yL: item.yL, zL: item.zL,
}));

test('nested layout follows actual parents across depth resets and restores traditional coordinates exactly', () => {
  const context = nestedFixture(), modelBefore = JSON.stringify(context.data);
  const semanticBefore = context.nodes.map(({ id, parent, owner, group, depth, t0, t1 }) => ({ id, parent, owner, group, depth, t0, t1 }));
  context.computeLayout();
  const traditional = coordinates(context);
  context.setEventLayout('nested');
  const byId = new Map(context.nodes.map((item) => [item.id, item]));
  for (const item of context.nodes) {
    const parent = byId.get(item.parent);
    if (parent) for (const coordinate of ['yT', 'yL']) assert.ok(item[coordinate] < parent[coordinate], `${item.id} is below ${parent.id} in ${coordinate}`);
    for (const coordinate of ['yT', 'zT', 'yL', 'zL']) assert.ok(Number.isFinite(item[coordinate]), `${item.id}.${coordinate}`);
  }
  assert.equal(byId.get('ana.choice').displayGroup, 'ana', 'declared ancestry has priority over a conflicting owner hint');
  assert.equal(byId.get('bo.work').displayGroup, 'bo', 'a character without numeric rows still has an event group');
  assert.equal(byId.get('meeting').displayGroup, 'world', 'a shared Event stays once beneath its actual parent');
  assert.equal(context.nodes.filter((item) => item.id === 'meeting').length, 1);
  assert.equal(new Set(context.floors.flatMap((floor) => floor.roles)).size, context.nodes.length + context.rows.length);
  for (const row of context.rows) {
    for (const coordinate of ['yT', 'zT', 'yL', 'zL']) assert.ok(Number.isFinite(row[coordinate]), `${row.measure.id}.${coordinate}`);
    assert.equal(row.yT, 0, 'Together keeps numeric trajectories at their original baseline');
    const home = byId.get(row.home);
    if (home) assert.ok(row.yL + (row.measure.kind === 'cut-answer' ? context.CUT_AMP : context.LAMP) < home.yL, `${row.measure.id} fits beneath its home Event`);
  }
  assert.notEqual(context.rows[0].zL, context.rows[1].zL, 'sibling numerical leaves receive separate lanes');
  const once = coordinates(context); context.computeLayout();
  assert.deepEqual(coordinates(context), once, 'repeated layout does not accumulate offsets');
  context.setEventLayout('traditional');
  assert.deepEqual(coordinates(context), traditional);
  assert.equal(JSON.stringify(context.data), modelBefore);
  assert.deepEqual(context.nodes.map(({ id, parent, owner, group, depth, t0, t1 }) => ({ id, parent, owner, group, depth, t0, t1 })), semanticBefore);
});

test('nested integration accepts lifecycle records on people and keeps synthetic row IDs separate from real Events', () => {
  const context = nestedFixture({ collision: true, lifeOnPerson: true });
  context.setEventLayout('nested');
  const byId = new Map(context.nodes.map((item) => [item.id, item]));
  assert.equal(byId.get('ana.choice').displayGroup, 'ana');
  assert.equal(byId.get('bo.work').displayGroup, 'bo');
  const real = byId.get('viewer-row:0'), row = context.rows[0];
  assert.ok(row.yL < byId.get(row.home).yL, 'the numerical leaf remains under its own declared home');
  assert.notEqual(row.zL, real.zL, 'an Event whose ID resembles a display leaf stays in its own character group');
  assert.equal(context.floors.flatMap((floor) => floor.roles).filter((item) => item === real).length, 1);
  assert.equal(context.floors.flatMap((floor) => floor.roles).filter((item) => item === row).length, 1);
});

for (const camera of ['free', 'locked']) test(`the Event layout control retains time, selection, detail and layers with a ${camera} camera`, () => {
  const context = nestedFixture();
  Object.assign(context, { now: 5, tau: 123, playing: true, selectedPart: { unit: { id: 'passage' } },
    selectedEventIds: new Set(['ana.choice']), selectedLinks: [{ from: 'passage', to: 'ana.choice' }], pinnedTarget: {} });
  Object.assign(context.opt, { camera, detailLevel: 1, processScope: 'ana.inner', noteLayout: 'overhead', allNoteAttachments: true, edges: false });
  const placements = []; context.placeLocked = (immediate) => placements.push(immediate);
  context.opt.show.delete('notes'); context.opt.show.delete('causal');
  context.computeLayout();
  const before = { now: context.now, tau: context.tau, playing: context.playing, selectedPart: context.selectedPart,
    selectedEventIds: context.selectedEventIds, selectedLinks: context.selectedLinks, pinnedTarget: context.pinnedTarget,
    show: context.opt.show, detailLevel: context.opt.detailLevel, processScope: context.opt.processScope };
  const calls = [];
  context.syncURL = (immediate) => calls.push(['url', immediate]); context.syncPanel = () => calls.push(['panel']);
  for (const layout of ['nested', 'traditional']) {
    context.setEventLayout(layout);
    assert.equal(context.opt.eventLayout, layout);
    for (const [key, value] of Object.entries(before)) assert.equal(key in context.opt ? context.opt[key] : context[key], value, key);
    assert.deepEqual([...context.opt.show], layers.filter((key) => !['notes', 'causal'].includes(key)));
    assert.equal(context.opt.noteLayout, 'overhead'); assert.equal(context.opt.allNoteAttachments, true); assert.equal(context.opt.edges, false);
  }
  assert.deepEqual(calls, [['panel'], ['url', true], ['panel'], ['url', true]]);
  context.setEventLayout('unknown'); context.setEventLayout('traditional');
  assert.equal(calls.length, 4, 'invalid and already selected layouts do not refresh state');
  assert.deepEqual(placements, camera === 'locked' ? [true, true] : [], 'a locked camera applies the new fitted geometry immediately');
  assert.equal(context.dirty, true); assert.equal(context.extrasDirty, true);
});
