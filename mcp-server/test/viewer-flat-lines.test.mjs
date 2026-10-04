import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../viewer/public/vendor/three/three.core.js';
import { createProcessDetail } from '../viewer/public/process-detail.js';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
function between(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Missing viewer section ${startText}`);
  return source.slice(start, end);
}
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `Missing viewer function ${name}`);
  return source.slice(start, end + 2);
}
function declaration(name) {
  const line = source.split('\n').find((entry) => entry.startsWith(`const ${name} =`));
  assert.ok(line, `Missing viewer declaration ${name}`);
  return line;
}
const position = () => ({ set(x, y, z) { Object.assign(this, { x, y, z }); } });
function geometry(length) {
  return { attributes: { position: { array: new Float32Array(length) } }, drawRange: { count: 3 }, computeBoundingSphere() {} };
}
const buffer = () => ({ calls: [], begin() { this.calls = []; }, add(...args) { this.calls.push(args); }, quad(...args) { this.calls.push(args); }, end() {} });

function fixture({ nativeCount = 0, detail = false } = {}) {
  const group = { id: 'generic-owner', label: 'Owner', rows: [] };
  const samples = nativeCount ? Array.from({ length: nativeCount }, () => [0, 0.5, 1]) : [[0, 0, 0], [7, 7, 7], [1, 2, 3], [0, 1, 0], [0, Number.EPSILON, 0]];
  const rows = samples.map((values, index) => ({ measure: { id: `process-${index}`, points: values.map((v, t) => ({ t, v })),
    ...(nativeCount ? { kind: 'cut-answer', domain: [0, 2] } : {}) },
    group, depth: 2, yT: 0, rise: 1, sampleT: new Float64Array(3),
    wall: { visible: true, material: {}, geometry: geometry(18) }, crest: { visible: true, material: {}, geometry: geometry(9) },
    name: { visible: true, position: position(), element: { style: {}, offsetWidth: 200 } },
    value: { visible: true, position: position(), element: { style: {}, offsetWidth: 50 } } }));
  const nodes = ['root', 'life', 'developed', 'empty', 'phase'].map((id, index) => ({ id, depth: Math.min(index, 2),
    group: group.id, kind: index < 2 ? 'event' : 'sub', trunk: index < 2, t0: 0, t1: 2, event: { id, start: 0 } }));
  if (detail) {
    for (const [index, node] of nodes.entries()) {
      node.parent = index === 0 ? null : index === 1 ? 'root' : 'life';
      Object.assign(node.event, { parent: node.parent, depth: node.depth });
    }
    for (const row of rows) row.home = 'developed';
    rows[3].home = 'phase'; rows[3].measure.conditioningSchema = [{}];
    rows[4].home = 'empty'; rows[4].depth = 9;
    nodes.find((node) => node.id === 'empty').parent = 'phase';
    Object.assign(nodes.find((node) => node.id === 'empty').event, { parent: 'phase', depth: 8 });
    nodes.find((node) => node.id === 'empty').depth = 8;
  }
  const context = { nodes, rows, groups: [group], unopenedProcessIds: new Set(['empty']),
    processDetail: createProcessDetail(nodes.map((node) => node.event), rows),
    opt: { hideFlat: false, hideUnopened: false, layout: 'layers', depth: 4, camera: 'free', edges: false,
      show: new Set(['events', 'subsidiary', 'processes', 'numbers']), lenses: new Set() },
    ROW: 2.7, GAP: 4.4, AMP: 10, NX: 3, T1: 2, LENGTH: 100, F: { a: 0, b: 2 },
    dirty: false, relayout: false, extrasDirty: false, smooth: (value) => value,
    apply() {}, syncPanel() {}, syncURL() {}, fitLocked() {}, X: (t) => t, timeAtX: (x) => x,
    wallNdc: { set() {} }, wallRay: { setFromCamera() {}, intersectObjects(objects) { context.intersected = objects; return []; } },
    innerWidth: 100, innerHeight: 100, camera: {}, curtainMark: { position: position() }, screen: (x, y) => ({ x, y, ok: true }),
    shownByPlay: () => true, bornAt: () => -Infinity, lensList: [], currentTicks: [], color: (value) => value,
    extraTargets: [], selectedLinks: [], extraWalls: buffer(), extraCrests: buffer(), extraGrid: buffer(),
    connectors: buffer(), chips: buffer(), extraGlows: buffer(), proseLines: buffer(),
    drawRecordedNumbers() { context.numbersDrawn = true; }, drawSelectedStoryLinks() {} };
  vm.createContext(context);
  vm.runInContext([
    declaration('boundedMeasure'),
    declaration('CUT_AMP'),
    between('const valueAt =', 'const money ='),
    between('const LANE =', '// Where a row or node stands now:'),
    declaration('rowAt'), declaration('presence'), declaration('heightAt'),
    functionSource('layRow'), functionSource('curtainAt'), functionSource('setHideFlat'), functionSource('drawExtras'),
    'this.presence = presence; this.heightAt = heightAt; this.setBlend = (value) => { blend.now = value; }; this.treeFloors = () => floors;',
  ].join('\n'), context);
  return context;
}

test('the flat-line filter is opt-in and does not imply the unopened-process filter', () => {
  for (const query of ['', 'flat=show', 'flat=hide', 'unopened=hide']) {
    const context = { URLSearchParams, params: new URLSearchParams(query), recordedMeasures: [], data: { measures: [], constructionTiming: 'unavailable' } };
    vm.createContext(context);
    vm.runInContext(`${between('const hasPaths =', 'let selectedPart =')}\nthis.opt = opt;`, context);
    assert.equal(context.opt.hideFlat, query === 'flat=hide');
    assert.equal(context.opt.hideUnopened, query === 'unopened=hide');
  }
});

test('actual field and tree layout hides every interval span and constant row while retaining all changing curves', () => {
  const context = fixture();
  context.computeLayout();
  assert.ok(context.nodes.every((node) => node.shown), 'all interval records remain visible by default');
  assert.ok(context.rows.every((row) => row.inL), 'constant numeric values remain visible by default');
  context.setHideFlat(true);
  for (const node of context.nodes) {
    assert.equal(node.inT, false, node.id); assert.equal(node.inL, false, node.id); assert.equal(node.shown, false, node.id);
  }
  assert.deepEqual(context.rows.map((row) => row.inT), [false, false, true, true, true]);
  assert.deepEqual(context.rows.map((row) => row.inL), [false, false, true, true, true]);
  const shownRoles = context.treeFloors().flatMap((floor) => Array.from(floor.roles));
  assert.equal(shownRoles.length, 3);
  assert.ok(shownRoles.every((row) => context.rows.slice(2).includes(row)), 'hidden spans cannot retain tree floor roles');
  for (const row of context.rows.slice(2)) for (const coordinate of ['yT', 'zT', 'yL', 'zL']) assert.ok(Number.isFinite(row[coordinate]), `${row.measure.id}.${coordinate}`);
  assert.equal(context.opt.hideUnopened, false);
  assert.ok(context.opt.show.has('numbers'));
  context.setHideFlat(false);
  assert.ok(context.nodes.every((node) => node.shown));
  assert.ok(context.rows.every((row) => row.inT && row.inL), 'turning the filter off restores constant zero and nonzero rows');
});

test('hidden rows have no curtains, crest labels or hit targets throughout layout blending', () => {
  const context = fixture();
  context.computeLayout(); context.setHideFlat(true);
  for (const blend of [0, 0.4, 1]) {
    context.setBlend(blend);
    for (const row of context.rows) context.layRow(row);
    for (const row of context.rows.slice(0, 2)) {
      assert.equal(context.presence(row), 0);
      assert.equal(row.wall.visible, false); assert.equal(row.crest.visible, false);
      assert.equal(row.name.visible, false); assert.equal(row.value.visible, false);
    }
    for (const row of context.rows.slice(2)) {
      assert.equal(row.wall.visible, true); assert.equal(row.name.visible, true);
    }
    // A point away from every crest forces the actual raycast fallback.
    assert.equal(context.curtainAt({ x: 1000, y: 1000 }), null);
    assert.deepEqual(context.intersected, context.rows.slice(2).map((row) => row.wall), 'raycasts must exclude invisible flat rows');
  }
  context.drawExtras();
  assert.equal(context.extraTargets.length, 0, 'no hidden Event bar remains as a hover target');
  assert.equal(context.extraWalls.calls.length, 0);
  assert.equal(context.extraCrests.calls.length, 0);
  assert.equal(context.numbersDrawn, true, 'independent recorded-number display still runs');
});

test('releasing the flat-line filter preserves an independently selected unopened-process filter', () => {
  const context = fixture();
  context.opt.hideUnopened = true; context.computeLayout(); context.setHideFlat(true); context.setHideFlat(false);
  assert.equal(context.opt.hideUnopened, true);
  assert.equal(context.nodes.find((node) => node.id === 'empty').shown, false);
  assert.ok(context.nodes.filter((node) => node.id !== 'empty').every((node) => node.shown));
  assert.ok(context.rows.every((row) => row.inL), 'unopened filtering does not suppress recorded numeric paths');
});

test('coarse outlines survive flat and unopened filters while scoped curves open progressively', () => {
  const context = fixture({ detail: true });
  Object.assign(context.opt, { hideFlat: true, hideUnopened: true, detailLevel: 0, processScope: null });
  context.computeLayout();
  assert.deepEqual(context.nodes.filter((node) => node.shown).map((node) => node.id), ['root', 'life']);
  assert.equal(context.rows.some((row) => row.inT || row.inL), false, 'a model overview does not dump all numerical curves');
  Object.assign(context, { nodeVis: () => 1, nodeAt: (node) => ({ y: node.yL, z: node.zL }),
    hueOfOwner: () => '#abcdef', color: (value) => new THREE.Color(value), WHITE: new THREE.Color('#ffffff'),
    playbackClock: () => ({}), playbackSpan: (start, end) => ({ start, end }),
    BAR: 1, litChain: new Set(), shownNow: () => true, nearestShown: () => null });
  context.drawExtras();
  assert.deepEqual(Array.from(context.extraTargets, (target) => target.node.id), ['root', 'life'], 'the coarse outlines are drawn and remain selectable');
  assert.equal(context.extraWalls.calls.length, 2, 'the retained whole is rendered even while the flat-line filter is on');
  context.opt.processScope = 'life'; context.computeLayout();
  assert.deepEqual(context.nodes.filter((node) => node.shown).map((node) => node.id), ['root', 'life']);
  assert.deepEqual(context.rows.filter((row) => row.inL).map((row) => row.measure.id), ['process-2']);
  context.opt.detailLevel = 1; context.computeLayout();
  assert.deepEqual(context.nodes.filter((node) => node.shown).map((node) => node.id), ['root', 'life', 'developed', 'phase']);
  assert.deepEqual(context.rows.filter((row) => row.inL).map((row) => row.measure.id), ['process-2', 'process-3', 'process-4']);
  assert.equal(context.opt.hideFlat, true); assert.equal(context.opt.hideUnopened, true);
});

test('scoped detail lays out deep subprocesses and rows beyond the older global depth without losing the whole', () => {
  const context = fixture({ detail: true });
  Object.assign(context.opt, { depth: 1, detailLevel: 2, processScope: 'life', hideFlat: true });
  context.computeLayout();
  assert.ok(context.nodes.every((node) => node.inT && node.inL));
  assert.equal(context.nodes.find((node) => node.id === 'empty').depth, 8);
  assert.ok(context.treeFloors().some((floor) => floor.level === 9 && floor.roles.includes(context.rows[4])));
  for (const item of [...context.nodes, ...context.rows.filter((row) => row.inL)]) {
    for (const coordinate of ['yT', 'zT', 'yL', 'zL']) assert.ok(Number.isFinite(item[coordinate]), `${item.id ?? item.measure.id}.${coordinate}`);
  }
  context.opt.detailLevel = 0; context.computeLayout();
  assert.ok(context.nodes.filter((node) => ['root', 'life'].includes(node.id)).every((node) => node.shown));
  assert.ok(context.nodes.filter((node) => !['root', 'life'].includes(node.id)).every((node) => !node.shown));
});

test('unopened filtering still hides expanded branches while preserving the macro whole and its ancestors', () => {
  const context = fixture({ detail: true });
  // A whole already in the overview cannot disappear when more detail is opened.
  context.unopenedProcessIds.add('life');
  Object.assign(context.opt, { detailLevel: 99, processScope: null, hideFlat: true, hideUnopened: true });
  context.computeLayout();
  assert.ok(context.nodes.filter((node) => ['root', 'life'].includes(node.id)).every((node) => node.shown));
  assert.equal(context.nodes.find((node) => node.id === 'empty').shown, false, 'expanded unopened branches still obey the existing filter');
  assert.ok(!context.treeFloors().some((floor) => floor.roles.includes(context.nodes.find((node) => node.id === 'empty'))));
  context.opt.processScope = 'life'; context.opt.detailLevel = 99; context.computeLayout();
  assert.equal(context.nodes.find((node) => node.id === 'life').shown, true);
  assert.equal(context.nodes.find((node) => node.id === 'empty').shown, false);
  context.opt.processScope = 'empty'; context.opt.detailLevel = 0; context.computeLayout();
  assert.ok(context.nodes.filter((node) => ['root', 'life', 'phase', 'empty'].includes(node.id)).every((node) => node.shown), 'an explicitly focused unopened whole and its entire containment context remain inspectable');
  context.opt.processScope = 'life'; context.opt.detailLevel = 99; context.opt.hideUnopened = false; context.computeLayout();
  assert.equal(context.nodes.find((node) => node.id === 'empty').shown, true, 'releasing the filter restores the unopened descendant');
  assert.equal(context.opt.hideFlat, true, 'the numerical flat-line preference stays independent');
});

test('native curves reserve no field row or tree floor until two current authored samples exist', () => {
  const context = fixture();
  const row = context.rows[2]; row.measure.kind = 'cut-answer';
  for (const count of [0, 1, 2, 1, 0]) {
    row.points = row.measure.points.slice(0, count);
    context.computeLayout();
    assert.equal(row.inT, count >= 2, `field row at ${count} current samples`);
    assert.equal(row.inL, count >= 2, `tree row at ${count} current samples`);
    assert.equal(context.treeFloors().some((floor) => floor.roles.includes(row)), count >= 2,
      'future source samples must not reserve space or enter floor process counts');
  }
});

test('native curve names use collision handling in Processes even when all interval bars are hidden', () => {
  const collisionSource = between('  const stage =', '  for (const el of labels.domElement');
  for (const native of [false, true]) {
    const rows = Array.from({ length: 118 }, () => ({ name: { visible: true, element: { style: {},
      getBoundingClientRect: () => ({ left: 10, right: 250, top: 10, bottom: 30, width: 240 }) } } }));
    const context = { rows, groupLabels: [], panels: [], innerWidth: 505, innerHeight: 788, recordedMeasures: native ? [{ kind: 'cut-answer' }] : [],
      isStory: () => true, blend: { now: 0 }, opt: { camera: 'spin', hideFlat: true }, nodes: [{ inT: false }] };
    vm.createContext(context); vm.runInContext(collisionSource, context);
    const hidden = rows.filter((row) => row.name.element.style.visibility === 'hidden').length;
    assert.equal(hidden, native ? 117 : 0,
      native ? 'native names must not bypass collision handling in the uncluttered Processes field' : 'legacy stage labeling keeps its existing behavior');
  }
});

test('native row and group names cannot scroll through toolbar panels or viewport edges', () => {
  const collisionSource = between('  const stage =', '  for (const el of labels.domElement');
  const label = (rect) => ({ visible: true, element: { style: {}, getBoundingClientRect: () => ({ width: rect.right - rect.left, ...rect }) } });
  const overTitle = label({ left: 20, right: 130, top: 50, bottom: 70 });
  const outside = label({ left: 20, right: 130, top: -3, bottom: 17 });
  const clear = label({ left: 20, right: 130, top: 160, bottom: 180 });
  const context = { rows: [{ name: overTitle }, { name: outside }, { name: clear }], groupLabels: [],
    panels: [{ left: 10, right: 250, top: 10, bottom: 100 }], innerWidth: 505, innerHeight: 788,
    recordedMeasures: [{ kind: 'cut-answer' }], isStory: () => true, blend: { now: 1 }, opt: { camera: 'locked', hideFlat: true }, nodes: [] };
  vm.runInNewContext(collisionSource, context);
  assert.equal(overTitle.element.style.visibility, 'hidden');
  assert.equal(outside.element.style.visibility, 'hidden');
  assert.equal(clear.element.style.visibility, '');
});

test('all 118 native curves retain an 18-unit full scale and readable row spacing in both layouts', () => {
  const context = fixture({ nativeCount: 118 });
  context.setHideFlat(true);
  assert.equal(context.rows.filter((row) => row.inT && row.inL).length, 118);
  assert.equal(context.treeFloors().length, 1);
  const floor = context.treeFloors()[0];
  assert.equal(floor.roles.length, 118);
  assert.equal(floor.amp, 18, 'the tree floor must accommodate the full native Cut amplitude');
  for (let index = 1; index < context.rows.length; index += 1) {
    assert.ok(context.rows[index].zT - context.rows[index - 1].zT >= 6 - 1e-9, 'Processes keeps the native six-unit lanes');
    assert.ok(context.rows[index].zL - context.rows[index - 1].zL >= 5.4 - 1e-9, 'Tree preserves at least 5.4 units between native rows');
  }
  const row = context.rows[0];
  for (const blend of [0, 0.5, 1]) {
    context.setBlend(blend); context.layRow(row);
    assert.equal(context.heightAt(row, 0), 0);
    assert.equal(context.heightAt(row, 1), 9);
    assert.equal(context.heightAt(row, 2), 18);
    const crest = row.crest.geometry.attributes.position.array;
    assert.ok(Math.abs(crest[7] - crest[1] - 18) < 1e-5, 'the rendered crest must use the same amplitude as anchors and layout');
  }
  const legacy = fixture(), legacyRow = legacy.rows[3];
  legacy.computeLayout(); legacy.setBlend(0);
  assert.equal(legacy.heightAt(legacyRow, 1), legacy.AMP, 'legacy Processes scale is unchanged');
  legacy.setBlend(1);
  assert.ok(Math.abs(legacy.heightAt(legacyRow, 1) - 3.2) < 1e-12, 'legacy Tree scale is unchanged');
});

test('the real locked-camera projection preserves available width and scrolls a tall native list in a narrow pane', () => {
  const context = fixture({ nativeCount: 118 });
  context.setHideFlat(true); context.setBlend(1);
  // Isolate camera geometry from DOM measurements while retaining the actual
  // layout, bounds, label budget, Three.js projection and camera-fit functions.
  const room = { l: 28, r: 477, t: 220, b: 700 };
  Object.assign(context, { THREE, terrain: { on: false }, innerWidth: 505, innerHeight: 788,
    groupLabels: [], laneTag: { visible: false, element: { style: {}, offsetWidth: 0 } }, freeRoom: () => ({ ...room }),
    zBackNow: () => Math.min(...context.rows.map((row) => row.zL)),
    zFrontNow: () => Math.max(...context.rows.map((row) => row.zL)),
    laneAt: () => ({ z: Math.max(...context.rows.map((row) => row.zL)) + 3 }) });
  vm.runInContext([declaration('visibleAmplitude'), declaration('LOCKED'), functionSource('boundsNow'),
    functionSource('visibleLabelWidth'), functionSource('fitLocked'), 'this.locked = LOCKED;'].join('\n'), context);
  context.fitLocked();
  const { pose } = context.locked;
  assert.ok(Number.isFinite(pose.d));
  assert.ok(pose.overflow > 0, '118 full-size native rows must extend into vertical scrolling');
  assert.equal(context.rows.filter((row) => row.inL).length, 118, 'fitting cannot cull rows to make the list fit');
  const box = context.boundsNow();
  const camera = new THREE.PerspectiveCamera(context.locked.fov, 505 / 788, 0.1, 10000);
  camera.position.copy(pose.position); camera.lookAt(pose.center); camera.updateMatrixWorld();
  const projected = [];
  for (const x of [-context.LENGTH / 2 - 1.2, context.LENGTH / 2 + 1.2]) {
    for (const y of [box.y0, box.y1]) for (const z of [box.z0, box.z1]) projected.push(new THREE.Vector3(x, y, z).project(camera));
  }
  const width = (Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x))) * 505 / 2;
  const availableWidth = room.r - room.l - Math.min(160, 505 * 0.28, 200);
  assert.ok(Math.abs(width - availableWidth) < 0.01, `the content width ${width} should fill ${availableWidth}, not shrink to fit all rows vertically`);
});
