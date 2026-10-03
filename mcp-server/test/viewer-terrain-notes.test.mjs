import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../viewer/public/vendor/three/three.core.js';
import { isPlaybackVisible } from '../viewer/public/playback-time.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
function block(startText) {
  const start = source.indexOf(startText), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `Missing viewer block: ${startText}`);
  return source.slice(start, end + 2);
}
function declaration(name) {
  const line = source.split('\n').find((entry) => entry.startsWith(`const ${name} =`));
  assert.ok(line, `Missing viewer declaration: ${name}`);
  return line;
}

// Run the complete terrain builder, layout and visibility code with the bundled
// Three.js geometry. Only the browser's DOM labels and canvas texture are absent.
class CSS2DObject extends THREE.Object3D {
  constructor(element) { super(); this.element = element; this.center = new THREE.Vector2(); }
}
const element = () => ({ style: {}, append() {} });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const event = (id, start, end, parent) => ({ id, label: id, start, end, parent, born: { order: 0 } });
const note = (id, category = 'thought') => ({ id, category, text: `Synthetic ${id}.`, born: { order: 1 } });
const about = (source, eventId) => ({ source, target: { anchor: eventId, event: eventId, anchorKind: 'event' } });
function model() {
  const person = (id) => ({ id, name: id, principal: true, life: { eventId: `${id}.life`, start: 0, end: 100, born: { order: 0 } },
    periods: [], arcs: [], processes: [], series: [], decisions: [] });
  return {
    window: { start: 0, end: 100 }, people: [person('ana'), person('bo')],
    events: [event('development', 0, 100), event('ana.life', 0, 100), event('ana.phase', 10, 90, 'ana.life'),
      event('ana.moment', 20, 20, 'ana.phase'), event('bo.life', 0, 100), event('bo.moment', 30, 30, 'bo.life'),
      event('standalone', 25), event('early', 2, 2, 'ana.life'), event('late', 80, 80, 'ana.life')],
    graph: { nodes: [note('ana-note'), note('bo-note'), note('world-note'), note('undated'), note('early-note'), note('late-note', 'passage')],
      edges: [about('ana-note', 'ana.moment'), about('bo-note', 'bo.moment'), about('world-note', 'standalone'),
        about('early-note', 'early'), about('late-note', 'late')] },
  };
}
function fixture(data = model()) {
  freeze(data);
  const context = { THREE, CSS2DObject, isPlaybackVisible, document: { createElement: element },
    data, byId: new Map(data.events.map((item) => [item.id, item])), constructionByClock: false,
    scene: new THREE.Scene(), field: new THREE.Group(), renderer: {}, glow: null,
    terrain: { built: false, on: true }, rows: [], NAMES: {}, table: null,
    F: { a: 0, b: 100, s: 100, w: 0 }, now: 100, tau: 100, atEnd: true, playing: false,
    opt: { mode: 'story', show: new Set(['notes', 'threads']), edges: true, hideUndated: false, glare: 'soft' },
    selectedPart: null, hoveredAt: null, causalAll: [], terrainArcTargets: [] };
  vm.createContext(context);
  const declarations = ['HUES', 'LENGTH', 'TS', 'clip', 'push', 'COLORS', 'shortName', 'hashOf', 'fieldRows',
    'fracOf', 'X', 'timeAtX', 'inView', 'madeAt', 'bornAt', 'building', 'playbackClock', 'shownByPlay', 'spark'];
  const noteMappingStart = source.indexOf('const neighbours =');
  const noteMappingEnd = source.indexOf('const noteLayer =', noteMappingStart);
  assert.ok(noteMappingStart >= 0 && noteMappingEnd > noteMappingStart);
  vm.runInContext([
    ...declarations.map(declaration), block('const label ='), block('class Lines {'),
    source.slice(noteMappingStart, noteMappingEnd),
    ...['buildTerrain', 'layTerrain', 'heightsTerrain', 'syncTerrainLabels', 'drawTerrainNoteLinks', 'applyTerrain', 'drawTerrainArcs']
      .map((name) => block(`function ${name}(`)),
  ].join('\n'), context);
  context.buildTerrain(); context.layTerrain(); context.applyTerrain();
  return context;
}
const point = (context, id) => context.terrain.mind.find((item) => item.userData.node.id === id);
const ownerRows = (context, id) => context.terrain.rows.filter((row) => row.group.id === id);

test('a dated life descendant without a process row belongs to its own person', () => {
  const context = fixture();
  for (const [id, eventId, owner] of [['ana-note', 'ana.moment', 'ana'], ['bo-note', 'bo.moment', 'bo']]) {
    assert.ok(!context.terrain.rows.some((row) => row.ids?.includes(eventId)), 'fixture has no process row for this moment');
    const placed = point(context, id);
    assert.equal(placed.userData.at.owner, owner);
    const own = ownerRows(context, owner)[0], other = ownerRows(context, owner === 'ana' ? 'bo' : 'ana')[0];
    assert.ok(Math.abs(placed.position.z - own.z) < Math.abs(placed.position.z - other.z), 'note stands nearer its own life');
    assert.equal(placed.material.color.getHexString(), owner === 'ana' ? '3987e5' : 'd95926');
  }
});

test('an explicit event owner takes precedence over the enclosing lifecycle', () => {
  const data = model(); data.events.find((item) => item.id === 'ana.moment').owner = 'bo';
  const context = fixture(data), placed = point(context, 'ana-note');
  assert.ok(!context.terrain.rows.some((row) => row.ids?.includes('ana.moment')));
  assert.equal(placed.userData.at.owner, 'bo', 'the inner context belongs to its declared observer');
  assert.ok(Math.abs(placed.position.z - ownerRows(context, 'bo')[0].z) < Math.abs(placed.position.z - ownerRows(context, 'ana')[0].z));
  assert.equal(placed.material.color.getHexString(), 'd95926');
});

test('an owner outside the displayed people keeps a neutral lane instead of inheriting someone else', () => {
  const data = model();
  for (const id of ['cy', 'dee']) {
    const person = structuredClone(data.people[0]);
    Object.assign(person, { id, name: id, life: { ...person.life, eventId: `${id}.life` } });
    data.people.push(person); data.events.push(event(`${id}.life`, 0, 100));
  }
  data.events.find((item) => item.id === 'ana.moment').owner = 'dee';
  const context = fixture(data), placed = point(context, 'ana-note');
  assert.equal(context.terrain.persons.some((person) => person.id === 'dee'), false, 'only three people are displayed');
  assert.equal(placed.userData.at.owner, 'dee');
  assert.ok(placed.position.z < Math.min(...context.terrain.rows.map((row) => row.z)), 'no displayed person owns this lane');
  assert.equal(placed.material.color.getHexString(), 'c9d4ff', 'an undisplayed owner does not borrow another person’s color');
});

test('undated notes have a separate lane beyond the world, away from every person', () => {
  const context = fixture(), placed = point(context, 'undated');
  assert.equal(placed.userData.at, undefined, 'display placement does not invent a dated anchor');
  assert.ok(placed.position.z < Math.min(...context.terrain.rows.map((row) => row.z)), 'undated lane is beyond all terrain rows');
  assert.ok(context.terrain.persons.every((person) => ownerRows(context, person.id).every((row) => placed.position.z < row.z)));
  assert.equal(placed.visible, true);
  context.opt.hideUndated = true; context.applyTerrain();
  assert.equal(placed.visible, false, 'the existing undated filter still applies');
});

test('a standalone dated event belongs to the world instead of the last person', () => {
  const context = fixture(), placed = point(context, 'world-note');
  assert.ok(!context.terrain.rows.some((row) => row.ids?.includes('standalone')));
  assert.equal(placed.userData.at.owner, 'world');
  const world = ownerRows(context, 'world')[0];
  for (const person of context.terrain.persons) {
    assert.ok(Math.abs(placed.position.z - world.z) < Math.abs(placed.position.z - ownerRows(context, person.id)[0].z));
  }
});

test('notes have finite coordinates when the model has no terrain rows', () => {
  const context = fixture({ events: [], people: [], graph: { nodes: [note('only-note'), note('only-passage', 'passage')], edges: [] } });
  assert.equal(context.terrain.rows.length, 0);
  for (const placed of context.terrain.mind) {
    assert.ok(placed.position.toArray().every(Number.isFinite), placed.userData.node.id);
    assert.equal(placed.visible, true);
  }
});

test('the time window hides notes in both playback modes while explicit selection remains inspectable', () => {
  for (const mode of ['story', 'construction']) {
    const context = fixture(); context.opt.mode = mode;
    context.F = { a: 10, b: 40, s: 30, w: 0 }; context.layTerrain(); context.applyTerrain();
    assert.equal(point(context, 'early-note').visible, false, `${mode}: hide the note before the window`);
    assert.equal(point(context, 'late-note').visible, false, `${mode}: hide the note after the window`);
    assert.equal(point(context, 'ana-note').visible, true, `${mode}: retain the in-window note`);
    assert.equal(point(context, 'undated').visible, true, `${mode}: an undated note has no date to exclude`);
    const threadCount = context.terrain.threadCount;
    context.selectedPart = { unit: { id: 'late-note' } }; context.applyTerrain();
    assert.equal(point(context, 'late-note').visible, true, `${mode}: explicit selection remains inspectable`);
    assert.equal(context.terrain.threadCount, threadCount, `${mode}: selection does not add a link to an offscreen event`);
    context.selectedPart = null; context.applyTerrain();
    assert.equal(point(context, 'late-note').visible, false, `${mode}: clearing selection restores the window filter`);
    context.F = { a: 0, b: 100, s: 100, w: 0 }; context.layTerrain(); context.applyTerrain();
    assert.equal(point(context, 'early-note').visible, true, `${mode}: widening the window restores earlier notes`);
    assert.equal(point(context, 'late-note').visible, true, `${mode}: widening the window restores later notes`);
  }
});

test('terrain placement and window changes leave the source model and graph unchanged', () => {
  const data = model(), before = JSON.stringify(data), context = fixture(data);
  context.F = { a: 10, b: 40, s: 30, w: 0 }; context.layTerrain(); context.applyTerrain();
  context.opt.mode = 'construction'; context.selectedPart = { unit: { id: 'late-note' } }; context.applyTerrain();
  assert.equal(JSON.stringify(data), before);
});
