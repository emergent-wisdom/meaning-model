import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../viewer/public/vendor/three/three.core.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const graphSource = readFileSync(new URL('../viewer/public/graph-view.js', import.meta.url), 'utf8');
// Use the shipped controls as well as Three's camera geometry, without a WebGL
// renderer. Only the browser import-map resolution is replaced for Node.
const controlsSource = readFileSync(new URL('../viewer/public/vendor/three/addons/controls/OrbitControls.js', import.meta.url), 'utf8')
  .replace("from 'three'", `from '${new URL('../viewer/public/vendor/three/three.core.js', import.meta.url).href}'`);
const { OrbitControls } = await import(`data:text/javascript;base64,${Buffer.from(controlsSource).toString('base64')}`);

function functionSource(text, name) {
  const match = new RegExp(`^([ \\t]*)function ${name}\\(`, 'm').exec(text);
  assert.ok(match, `Missing function ${name}`);
  const end = text.indexOf(`\n${match[1]}}`, match.index);
  assert.ok(end > match.index, `Missing end of ${name}`);
  return text.slice(match.index, end + match[1].length + 2);
}
const vector = (x, y, z) => new THREE.Vector3(x, y, z);
function closeVector(actual, expected, message) {
  assert.ok(actual.distanceTo(expected) < 1e-8, `${message}: ${actual.toArray()} versus ${expected.toArray()}`);
}
function addInertia(controls) {
  controls._sphericalDelta.theta = .45;
  controls._sphericalDelta.phi = -.12;
  controls._panOffset.set(30, -20, 40);
  controls._scale = .7;
  if (controls.zoomToCursor) {
    controls._performCursorZoom = true;
    controls._dollyDirection.set(0, -.2, -1).normalize();
  }
}
function expectNoInertia(controls) {
  assert.equal(controls._sphericalDelta.theta, 0);
  assert.equal(controls._sphericalDelta.phi, 0);
  closeVector(controls._panOffset, vector(0, 0, 0), 'pan inertia is consumed');
  assert.equal(controls._scale, 1);
  assert.equal(controls._performCursorZoom, false);
}
function temporalFixture({ mode = 'free', terrain = false } = {}) {
  const camera = new THREE.PerspectiveCamera(40, 505 / 788, .1, 900);
  camera.position.set(500, 700, -300);
  const controls = new OrbitControls(camera);
  controls.target.set(35, -80, 200); controls.enableDamping = true;
  controls.zoomToCursor = true;
  controls.autoRotate = mode === 'spin'; controls.enabled = mode !== 'locked';
  const context = {
    THREE, camera, controls, HOME: { position: vector(-30, 40, 100), target: vector(0, 5, 3) },
    HOME_FRAME: { size: 60, cy: 5, cz: 3 }, framed: { size: 120, cy: -15, cz: 20 },
    HOME_DISTANCE: 110, FOG: .0048, TFOG: .002,
    terrain: { on: terrain, home: { position: vector(-40, 80, 220), target: vector(12, 2, 10) },
      homeDistance: 200, groupNames: [], sectionNames: [] },
    scene: { fog: { density: .0048 } }, LOCKED: { fov: 17, elevation: .8, scroll: 420, pose: null },
    opt: { camera: mode, processScope: 'life', detailLevel: 2, hideFlat: true, layout: terrain ? 'terrain' : 'layers' },
    F: { a: 1843, b: 1855 }, now: 1849.25, tau: 17, playing: true, selected: { kind: 'event', id: 'event.chosen' },
    held: new Set(['w', 'arrowup']), poses: {
      field: { position: vector(111, 222, 333), target: vector(1, 2, 3) },
      terrain: { position: vector(444, 555, 666), target: vector(4, 5, 6) },
    },
    dirty: false, extrasDirty: false, urlWrites: [], syncURL(force) { context.urlWrites.push(force); },
    LENGTH: 100, innerWidth: 505, innerHeight: 788,
    blend: { now: 1 }, smooth: (value) => value, layersBounds: { y0: -30, z0: -10 },
    nodes: [], presence: () => 1, zBackNow: () => 0, zFrontNow: () => 20,
    laneAt: () => ({ z: 25 }), visibleAmplitude: () => 10,
    rows: [{ measure: { kind: 'cut-answer' }, name: { visible: false, element: { style: {} } } }],
    groupLabels: [], laneTag: { visible: false, element: { style: {} } },
    boundsNow: () => ({ y0: -500, y1: 20, z0: -10, z1: 25 }),
    freeRoom: () => ({ l: 28, r: 477, t: 220, b: 700 }),
    document: { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 140 }) }),
      getElementById: (id) => ({ getBoundingClientRect: () => ({ bottom: id === 'tools' ? 355 : 140 }) }) },
  };
  context.fieldKey = () => context.terrain.on ? 'terrain' : 'field';
  context.homeOf = (key) => key === 'terrain' ? context.terrain.home : context.HOME;
  vm.createContext(context);
  vm.runInContext(['visibleLabelWidth', 'fitLocked', 'placeLocked', 'fieldFrame', 'reframe', 'fitFree', 'recenterView']
    .map((name) => functionSource(source, name)).join('\n'), context);
  return context;
}
function nonCameraState(context) {
  return structuredClone({ opt: context.opt, F: context.F, now: context.now, tau: context.tau,
    playing: context.playing, selected: context.selected });
}

test('locked recenter returns to the top of current content without changing time, focus, detail or selection', () => {
  const context = temporalFixture({ mode: 'locked' }), before = nonCameraState(context);
  const terrainPose = context.poses.terrain;
  addInertia(context.controls); context.recenterView();
  assert.ok(context.LOCKED.pose.overflow > 0, 'the actual fitted scene has scrollable content');
  assert.equal(context.LOCKED.scroll, 0);
  closeVector(context.camera.position, context.LOCKED.pose.position, 'locked camera is recentered');
  closeVector(context.controls.target, context.LOCKED.pose.center, 'locked target is recentered');
  assert.equal(context.camera.view.offsetY, context.LOCKED.pose.oy, 'no former scroll survives in the projection');
  assert.equal(context.camera.fov, context.LOCKED.fov);
  assert.equal(context.controls.enabled, false);
  assert.equal(context.held.size, 0);
  assert.equal(context.poses.field, undefined);
  assert.equal(context.poses.terrain, terrainPose, 'the other representation keeps its camera');
  expectNoInertia(context.controls);
  assert.equal(context.controls.enableDamping, true);
  assert.deepEqual(nonCameraState(context), before);
  assert.deepEqual(context.urlWrites, [true]);
  assert.equal(context.dirty, true); assert.equal(context.extrasDirty, true);
});

function expectBoundsInRoom(context) {
  const room = context.freeRoom(), box = context.boundsNow();
  context.camera.updateMatrixWorld();
  for (const x of [-context.LENGTH / 2 - 1.2, context.LENGTH / 2 + 1.2]) for (const y of [box.y0, box.y1]) for (const z of [box.z0, box.z1]) {
    const projected = vector(x, y, z).project(context.camera);
    const px = (projected.x + 1) / 2 * context.innerWidth, py = (1 - projected.y) / 2 * context.innerHeight;
    assert.ok(px >= room.l - 1e-8 && px <= room.r + 1e-8, `bounds fit horizontal space: ${px}`);
    assert.ok(py >= 355 + 16 - 1e-8 && py <= room.b + 1e-8, `bounds fit below the real toolbar: ${py}`);
    assert.ok(projected.z > -1 && projected.z < 1, 'the field is inside the near and far clipping planes');
  }
}

test('free recenter fits current detail below the real toolbar and stays there after orbit updates', () => {
  const context = temporalFixture(), before = nonCameraState(context);
  context.camera.setViewOffset(505, 788, 90, 200, 505, 788);
  addInertia(context.controls); context.recenterView();
  const target = context.controls.target.clone(), position = context.camera.position.clone();
  closeVector(position.clone().sub(target).normalize(), context.HOME.position.clone().sub(context.HOME.target).normalize(), 'the home viewing direction is retained');
  expectBoundsInRoom(context);
  assert.deepEqual(context.framed, context.fieldFrame(), 'future detail changes start from the newly fitted field');
  assert.equal(context.camera.view.enabled, false);
  expectNoInertia(context.controls);
  for (let tick = 0; tick < 20; tick += 1) context.controls.update();
  closeVector(context.camera.position, position, 'old drag and zoom inertia cannot pull the camera away again');
  closeVector(context.controls.target, target, 'old pan inertia cannot move the target again');
  assert.deepEqual(nonCameraState(context), before);
  assert.equal(context.controls.enableDamping, true);
});

test('Terrain recenter fits its bounds from its own home direction and preserves saved field framing', () => {
  const context = temporalFixture({ terrain: true }), before = nonCameraState(context);
  context.boundsNow = () => ({ y0: -1, y1: 35, z0: -20, z1: 300 });
  const framed = context.framed, savedField = context.poses.field;
  addInertia(context.controls); context.recenterView();
  closeVector(context.camera.position.clone().sub(context.controls.target).normalize(),
    context.terrain.home.position.clone().sub(context.terrain.home.target).normalize(), 'Terrain uses its own viewing direction');
  expectBoundsInRoom(context);
  assert.equal(context.camera.fov, 42);
  assert.equal(context.poses.terrain, undefined);
  assert.equal(context.poses.field, savedField);
  assert.equal(context.framed, framed, 'saved Processes/Tree pose must retain the frame it was measured in');
  assert.deepEqual(nonCameraState(context), before);
  expectNoInertia(context.controls);
});

test('recenter in a spinning field restores the chosen camera mode after clearing inertia', () => {
  const context = temporalFixture({ mode: 'spin' });
  addInertia(context.controls); context.recenterView();
  assert.equal(context.opt.camera, 'spin');
  assert.equal(context.controls.autoRotate, true);
  assert.equal(context.controls.enableDamping, true);
  expectNoInertia(context.controls);
});

function graphFixture(visibleIds = ['left', 'right']) {
  const camera = new THREE.PerspectiveCamera(42, .35, .1, 20000);
  camera.position.set(-800, 900, -500);
  const controls = new OrbitControls(camera); controls.enableDamping = true;
  const points = new Map([['left', vector(-50, -20, 0)], ['right', vector(30, 10, 40)], ['hidden', vector(100000, 0, 0)]]);
  const context = { THREE, camera, controls, visibleNodes: visibleIds.map((id) => ({ id })),
    point: (id) => points.get(id).clone(), dirty: false, filter: { value: 'event' },
    neighborsOnly: true, showEdges: false, selected: 'left', search: { value: 'retained query' } };
  vm.createContext(context);
  vm.runInContext(['fit', 'recenterView'].map((name) => functionSource(graphSource, name)).join('\n'), context);
  return context;
}

test('Graph recenter fits only visible records and retains the record filter, neighbors and selection', () => {
  const context = graphFixture();
  addInertia(context.controls); context.recenterView();
  closeVector(context.controls.target, vector(-10, -5, 20), 'hidden distant record is excluded from fit');
  context.camera.updateMatrixWorld();
  for (const node of context.visibleNodes) {
    const projected = context.point(node.id).project(context.camera);
    assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z < 1, `${node.id} fits the narrow graph viewport`);
  }
  const position = context.camera.position.clone();
  for (let tick = 0; tick < 20; tick += 1) context.controls.update();
  closeVector(context.camera.position, position, 'the fitted graph stays centered after the next frames');
  assert.equal(context.filter.value, 'event'); assert.equal(context.neighborsOnly, true);
  assert.equal(context.showEdges, false); assert.equal(context.selected, 'left');
  assert.equal(context.search.value, 'retained query');
  assert.equal(context.dirty, true); assert.equal(context.controls.enableDamping, true);
  expectNoInertia(context.controls);
});

test('Graph recenter handles an empty filtered result without invalid camera coordinates', () => {
  const context = graphFixture([]);
  context.controls.autoRotate = true;
  context.recenterView();
  assert.ok(context.camera.position.toArray().every(Number.isFinite));
  closeVector(context.controls.target, vector(0, 0, 0), 'empty graph has a stable fallback centre');
  assert.equal(context.controls.autoRotate, true);
  assert.equal(context.filter.value, 'event');
});

test('Graph uses the room freed by hidden controls without resetting camera position or selection', () => {
  let toolbarHidden = false;
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 20000); camera.position.set(14, 22, 180);
  const before = camera.position.clone(), sizes = [];
  const context = vm.createContext({ dirty: false, innerWidth: 1280, innerHeight: 720, camera,
    document: {
      querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 80 }) }),
      getElementById: id => ({ getBoundingClientRect: () => id === 'toolbar-visibility' ? { bottom: 126 } : toolbarHidden ? { bottom: 0, left: 0, width: 0 } : { bottom: 180, left: 800, width: 450 } }),
    }, summary: { getBoundingClientRect: () => ({ top: 620 }) }, detail: { hidden: true }, host: { style: {} },
    renderer: { setSize: (...value) => sizes.push(value) }, labels: { setSize() {} },
  });
  vm.runInContext(functionSource(graphSource, 'resize'), context);
  // The controls share the top row with the title, so the graph always spans the window and starts below them.
  context.resize(); assert.equal(context.host.style.width, '1256px'); assert.equal(context.host.style.top, '190px');
  toolbarHidden = true; context.resize(); assert.equal(context.host.style.top, '136px', 'hidden controls give their rows back to the graph');
  closeVector(camera.position, before, 'hiding controls leaves the chosen camera pose intact');
  assert.equal(context.dirty, true);
  toolbarHidden = false; context.resize(); assert.equal(context.host.style.top, '190px');
  assert.deepEqual(sizes, [[1256, 420], [1256, 474], [1256, 420]]);
});
