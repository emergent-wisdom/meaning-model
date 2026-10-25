import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifeSimulationService } from '../src/service.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { globeAngles, GLOBE_RADIUS, EARTH_RADIUS_M } from '../viewer/public/space-model.js';
import { viewSettingsProblems } from '../viewer/public/view-settings.js';

// Run the real Space and Graph renderers on real snapshots: the real three.js scene graph, a minimal page, and only the
// WebGL output, the label layer and the camera controls replaced. A render path that throws (as a variable used
// before its declaration once did) fails here, instead of silently falling back to Structure in a browser.
const publicUrl = new URL('../viewer/public/', import.meta.url).href;
const harness = String.raw`
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const [, publicUrl, snapshotPath, which, optionsText] = process.argv; const options = JSON.parse(optionsText ?? '{}');
const errors = [];
const fakes = {
  three: 'export * from ' + JSON.stringify(publicUrl + 'vendor/three/three.module.js') + ';\n' +
    'export class WebGLRenderer { constructor() { this.domElement = document.createElement("canvas"); this.domElement.renderer = this; this.frames = 0; } setPixelRatio() {} setSize() {} render(scene, camera) { this.frames += 1; this.scene = scene; this.camera = camera; scene.updateMatrixWorld(); } dispose() {} }',
  controls: 'import { Vector3, EventDispatcher } from "three"; export class OrbitControls extends EventDispatcher { constructor(camera, element) { super(); this.object = camera; this.domElement = element; this.target = new Vector3(); this.enabled = true; globalThis.lastControls = this; } update() { this.object.lookAt(this.target); return false; } dispose() {} }',
  labels: 'import { Object3D, Vector2 } from "three"; export class CSS2DObject extends Object3D { constructor(element = document.createElement("div")) { super(); this.element = element; this.center = new Vector2(0.5, 0.5); } } export class CSS2DRenderer { constructor() { this.domElement = document.createElement("div"); } setSize() {} render() {} }',
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: 'fake:three', shortCircuit: true };
    if (specifier.endsWith('OrbitControls.js')) return { url: 'fake:controls', shortCircuit: true };
    if (specifier.endsWith('CSS2DRenderer.js')) return { url: 'fake:labels', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('fake:')) return { format: 'module', source: fakes[url.slice(5)], shortCircuit: true };
    return next(url, context);
  },
});
// A minimal page: elements with ids, classes, attributes, children, listeners and boxes.
const listen = (target) => { target.listeners = {}; target.addEventListener = (type, handler, options = {}) => { (target.listeners[type] ??= []).push(handler); options?.signal?.addEventListener?.('abort', () => { target.listeners[type] = target.listeners[type].filter((item) => item !== handler); }); }; target.removeEventListener = (type, handler) => { target.listeners[type] = (target.listeners[type] ?? []).filter((item) => item !== handler); }; target.dispatchEvent = (event) => { for (const handler of [...(target.listeners[event.type] ?? [])]) { try { handler(event); } catch (error) { errors.push(String(error?.stack ?? error)); } } return true; }; };
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.title = ''; this.type = ''; this._text = '';
    this.style = { setProperty: (key, value) => { this.style[key] = value; } }; const classes = new Set(); this.classes = classes;
    this.classList = { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name), toggle: (name, on = !classes.has(name)) => { if (on) classes.add(name); else classes.delete(name); return on; } };
    listen(this); }
  get className() { return [...this.classes].join(' '); } set className(value) { this.classes.clear(); for (const name of String(value).split(/\s+/).filter(Boolean)) this.classes.add(name); }
  get id() { return this.attributes.id ?? ''; } set id(value) { this.attributes.id = String(value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); } set textContent(value) { this.children = []; this._text = String(value ?? ''); }
  get innerText() { return this.textContent; } set innerHTML(value) { this.children = []; this._text = String(value).replace(/<[^>]*>/g, ''); }
  get firstChild() { return this.children[0] ?? null; } get firstElementChild() { return this.children[0] ?? null; } get options() { return this.children.filter((child) => child.tagName === 'OPTION'); }
  append(...nodes) { for (const node of nodes) { const item = typeof node === 'string' ? Object.assign(new Element('#text'), { _text: node }) : node; item.parentNode?.children && (item.parentNode.children = item.parentNode.children.filter((child) => child !== item)); item.parentNode = this; this.children.push(item); } }
  prepend(...nodes) { const kept = this.children; this.children = []; this.append(...nodes); this.children.push(...kept); }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  before(node) { const siblings = this.parentNode?.children; if (!siblings) return; node.parentNode = this.parentNode; siblings.splice(siblings.indexOf(this), 0, node); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  setAttribute(key, value) { if (key === 'id') this.id = value; else this.attributes[key] = String(value); } getAttribute(key) { return key === 'id' ? this.id : this.attributes[key] ?? null; } removeAttribute(key) { delete this.attributes[key]; } hasAttribute(key) { return key in this.attributes; }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  matches(selector) { return selector.split(',').some((part) => { const s = part.trim(); if (s.startsWith('#')) return this.id === s.slice(1); if (s.startsWith('.')) return s.slice(1).split('.').every((name) => this.classes.has(name)); return this.tagName === s.toUpperCase(); }); }
  querySelector(selector) { return this.all().find((node) => node.matches?.(selector)) ?? null; } querySelectorAll(selector) { return this.all().filter((node) => node.matches?.(selector)); }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches?.(selector)) return node; return null; }
  contains(node) { for (let at = node; at; at = at.parentNode) if (at === this) return true; return false; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400 }; }
  click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} }); } focus() {} scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
  cloneNode() { return new Element(this.tagName.toLowerCase()); }
}
const body = new Element('body'), head = new Element('head');
globalThis.window = globalThis; listen(globalThis);
Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, performance: globalThis.performance });
globalThis.document = { body, head, hidden: false, createElement: (tag) => new Element(tag), createTextNode: (text) => Object.assign(new Element('#text'), { _text: String(text) }),
  getElementById: (id) => body.all().find((node) => node.id === id) ?? head.all().find((node) => node.id === id) ?? null, querySelector: (selector) => body.querySelector(selector), querySelectorAll: (selector) => body.querySelectorAll(selector) };
let frames = []; globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; }; globalThis.cancelAnimationFrame = () => {};
const press = (target, x, y, button = 0) => { for (const type of ['pointerdown', 'pointerup', 'click']) target.dispatchEvent({ type, button, clientX: x, clientY: y, pointerId: 1, isPrimary: true, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} }); };
const run = (count = 3) => { for (let i = 0; i < count; i += 1) { const now = frames; frames = []; for (const callback of now) { try { callback(performance.now()); } catch (error) { errors.push(String(error?.stack ?? error)); } } } };
const add = (parent, tag, id = '', classes = '') => { const node = new Element(tag); if (id) node.id = id; node.className = classes; parent.append(node); return node; };
const title = add(body, 'header', '', 'title'); add(title, 'h1', 'title');
const side = add(body, 'aside', 'side'); add(side, 'button', 'toolbar-visibility'); const tools = add(side, 'div', 'tools'); for (const id of ['coarse-view', 'recenter-view']) add(tools, 'button', id);
for (const id of ['play', 'read']) add(body, 'button', id); const track = add(body, 'div', 'track'); add(track, 'div', 'fill'); add(body, 'div', 'clock');
const reader = add(body, 'aside', 'reader'); reader.hidden = true; for (const id of ['reader-scroll', 'reader-body', 'reader-status']) add(reader, 'div', id); for (const id of ['reader-start', 'reader-close', 'reader-full', 'reader-download']) add(reader, 'button', id);
const detail = add(side, 'aside', which + '-details', 'details'); detail.hidden = true; add(detail, 'button', '', 'close'); add(detail, 'div', '', 'details-body');
const surface = add(body, 'div', which + '-surface'), host = add(surface, 'div', which + '-scene'), controls = add(tools, 'div', which + '-controls');
const data = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const report = { errors };
try {
  if (which === 'walk') {
    // The keyboard walking both 3D views share.
    const { PerspectiveCamera, Vector3 } = await import('three'); const { createWalker } = await import(publicUrl + 'walk-controls.js');
    const camera = new PerspectiveCamera(42, 1, 0.1, 1000); camera.position.set(0, 10, 30); camera.lookAt(0, 0, 0);
    const controls = { target: new Vector3(0, 0, 0) }; let started = 0;
    const walker = createWalker({ camera, controls, onStart: () => { started += 1; } });
    const key = (type, name, target = body) => globalThis.dispatchEvent({ type, key: name, target, preventDefault() {}, metaKey: false, ctrlKey: false, altKey: false });
    const at = () => camera.position.toArray().map((value) => +value.toFixed(3));
    const start = at(); key('keydown', 'w'); walker.step(0.1); const forward = at(); key('keyup', 'w'); const idle = walker.step(0.1);
    const field = new Element('input'); body.append(field); key('keydown', 'w', field); const typed = walker.step(0.1);
    key('keydown', 'ArrowLeft'); walker.step(0.1); key('keyup', 'ArrowLeft'); const target = controls.target.toArray().map((value) => +value.toFixed(3));
    Object.assign(report, { start, forward, idle, typed, started, target });
  } else if (which === 'space') {
    const { showSpace } = await import(publicUrl + 'space-view.js'); const selections = [];
    const view = showSpace(data, { host, tools: controls, detail, surface, onSelect: (record) => selections.push(record) });
    view.activate('space', { selection: null, time: null }); run();
    // Every frame, and in each the person focus, the whole-life overview, play and a selection.
    const selects = controls.querySelectorAll('select');
    const frameSelect = selects.find((node) => node.getAttribute('aria-label') === 'Reference frame');
    const frameCount = frameSelect ? frameSelect.options.length : 0; report.frames = frameCount;
    for (let i = 0; i < Math.max(1, frameCount); i += 1) {
      if (frameSelect) { frameSelect.value = String(i); frameSelect.dispatchEvent({ type: 'change', target: frameSelect }); }
      for (const button of controls.querySelectorAll('button')) { button.click(); run(1); button.click(); run(1); }
      document.getElementById('play').click(); run(5); document.getElementById('play').click();
      const label = host.querySelector('.space-label') ?? surface.querySelector('.space-related'); label?.click(); run(1);
    }
    document.getElementById('read').click(); run(1);
    // A period clicked twice opens and lets go; a right click keeps it; a plain click on nothing lets it go everywhere.
    if (frameSelect) { frameSelect.value = '0'; frameSelect.dispatchEvent({ type: 'change', target: frameSelect }); run(1); }
    const period = surface.querySelector('.space-life-period'), canvas = host.querySelector('canvas');
    if (period && canvas) {
      period.click(); const opened = !detail.hidden; period.click(); const toggled = detail.hidden;
      period.click(); press(canvas, 1, 1, 2); const kept = !detail.hidden; press(canvas, 1, 1); run(1);
      report.letGo = { opened, toggled, kept, hidden: detail.hidden, last: selections.length ? selections.at(-1) : 'none' };
    }
    if (frameCount > 1) {
      frameSelect.value = '1'; frameSelect.dispatchEvent({ type: 'change', target: frameSelect });
      const saved = view.getState(); saved.space.frame = 0; saved.spaceCamera.position = [11, 22, 33];
      frameSelect.value = '0'; frameSelect.dispatchEvent({ type: 'change', target: frameSelect });
      view.activate('space', saved);
      report.restored = { frame: view.getState().space.frame, position: view.getState().spaceCamera.position };
      view.activate('space', { ...saved, space: { ...saved.space, frameKey: 'removed-frame' }, spaceCamera: { ...saved.spaceCamera, position: [999, 999, 999] } });
      report.removedFramePosition = view.getState().spaceCamera.position;
    }
    report.state = view.getState(); report.summary = surface.querySelector('.space-summary')?.textContent?.slice(0, 200) ?? null;
    view.coarse?.(); run(1); view.recenter?.(); view.deactivate(); view.destroy();
  } else if (which === 'globe') {
    // The Earth drawn as a globe or flat: what the scene holds, where the marks stand, the choice kept in the address, and what a
    // frame without latitude and longitude draws.
    globalThis.location = { href: 'http://viewer.test/viewer/?view=space' + (options.search ?? ''), pathname: '/viewer/', search: '?view=space' + (options.search ?? '') };
    globalThis.history = { state: null, replaceState(_state, _title, url) { const next = new URL(String(url)); globalThis.location.href = next.href; globalThis.location.search = next.search; } };
    const { showSpace } = await import(publicUrl + 'space-view.js'); const { Vector3 } = await import('three');
    const view = showSpace(data, { host, tools: controls, detail, surface, onSelect: () => {} });
    view.activate('space', { selection: null, time: null }); run();
    const renderer = host.querySelector('canvas').renderer, track = document.getElementById('track');
    const buttons = () => Object.fromEntries(controls.querySelectorAll('button').filter((node) => node.textContent === 'Globe' || node.textContent === 'Map').map((node) => [node.textContent, { hidden: node.hidden, pressed: node.getAttribute('aria-pressed') }]));
    const scan = () => {
      const found = { sphere: 0, grids: 0, graticule: 0, major: 0, marks: {}, labels: {}, ticks: [], events: [], lights: [], spreads: [], lines: { trail: [], link: [], drop: [], causal: [] } };
      renderer.scene.traverse((node) => {
        const kind = node.userData ? node.userData.globe : undefined;
        if (kind === 'sphere') found.sphere += 1;
        if (kind === 'graticule') found.graticule += node.geometry.attributes.position.count / 2;
        if (kind === 'major') found.major += node.geometry.attributes.position.count / 2;
        if (node.type === 'GridHelper') found.grids += 1;
        if (node.userData && node.userData.object) found.marks[node.userData.object.label] = { position: node.position.toArray(), visible: node.visible };
        if (node.element && node.element.classes.has('space-label')) found.labels[node.element.textContent] = node.element.style.visibility;
        if (node.element && node.element.classes.has('space-tick') && node.visible) found.ticks.push(node.element.textContent);
        if (node.userData && node.userData.placed) found.events.push({ id: node.userData.placed.id, position: node.position.toArray(), visible: node.visible });
        if (kind === 'spread') found.spreads.push({ centre: new Vector3(0, 1, 0).applyQuaternion(node.quaternion).toArray(), radians: node.geometry.parameters.thetaLength, visible: node.visible });
        if (node.userData && node.userData.attachment) found.lights.push({ position: node.position.toArray(), visible: node.visible });
        if (found.lines[kind]) {
          const attribute = node.geometry.attributes.position, count = attribute ? Math.min(attribute.count, node.geometry.drawRange.count) : 0, points = [];
          for (let i = 0; i < count; i += 1) points.push([attribute.getX(i), attribute.getY(i), attribute.getZ(i)]);
          found.lines[kind].push({ visible: node.visible, points });
        }
      });
      return found;
    };
    // What the controls and the light are set to: the globe changes them, and the map must find them as it always had them.
    const settings = () => { const c = globalThis.lastControls; let sun = null; renderer.scene.traverse((node) => { if (node.isDirectionalLight) sun = node.position.toArray(); });
      return { pan: c.enablePan, zoom: c.enableZoom, min: c.minDistance, max: String(c.maxDistance), zoomSpeed: c.zoomSpeed, rotateSpeed: c.rotateSpeed, target: c.target.toArray(), near: renderer.camera.near, far: renderer.camera.far, sun }; };
    const look = () => ({ buttons: buttons(), state: view.getState(), scene: scan(), camera: renderer.camera.position.toArray(), address: globalThis.location.search, controls: settings() });
    const click = (text) => { controls.querySelectorAll('button').find((node) => node.textContent === text).click(); run(2); };
    const seek = (fraction) => { track.dispatchEvent({ type: 'pointerdown', clientX: fraction * 640, clientY: 0, pointerId: 1, preventDefault() {} }); run(2); };
    report.opened = look();
    // A click on the globe where nothing is picks nothing, and does not fail.
    press(host.querySelector('canvas'), 320, 200); run(1);
    if (options.script) {
      seek(13 / 48); report.during = look();
      seek(1); report.late = look();
      seek(0); click('Map'); report.map = look();
      click('Globe'); report.back = look();
      // Seen from the far side of the world, what is behind the horizon is behind the globe, and its name is not shown.
      const turned = view.getState(); turned.spaceCamera = { position: [0, 0, -300], target: [0, 0, 0], near: 1, far: 1000, fov: 42, zoom: 1, drawing: 'globe' };
      view.activate('space', turned); run(2); report.antipode = look();
    } else if (options.toggle) { click(options.toggle); report.toggled = look(); }
    view.deactivate(); view.destroy();
  } else {
    const { showGraph } = await import(publicUrl + 'graph-view.js');
    const readerCopy = add(body, 'aside', 'graph-reader'); readerCopy.hidden = true; add(readerCopy, 'div', '', 'source');
    for (const id of ['graph-reader-scroll', 'graph-reader-body', 'graph-reader-status']) add(readerCopy, 'div', id); for (const id of ['graph-reader-start', 'graph-reader-close', 'graph-reader-full', 'graph-reader-download']) add(readerCopy, 'button', id);
    const selections = []; const view = showGraph(data, { host, tools: controls, detail, reader: readerCopy, surface, onSelect: (record) => selections.push(record) });
    view.activate('graph', { selection: null }); run();
    for (const button of controls.querySelectorAll('button').filter((node) => node.textContent !== 'Read full document')) { button.click(); run(1); }
    const first = data.inspection.model.meaning_model?.normalized_cuts?.[0];
    if (first) {
      view.activate('graph', { selection: { kind: 'normalized_cut', id: first.id } }); run(1);
      const canvas = host.querySelector('canvas'), opened = !detail.hidden;
      press(canvas, 1, 1, 2); const kept = !detail.hidden; press(canvas, 1, 1); run(1);
      report.letGo = { opened, kept, hidden: detail.hidden, last: selections.length ? selections.at(-1) : 'none' };
    }
    const selectedEvent = data.inspection.model.meaning_model?.events?.[0];
    if (selectedEvent) {
      view.activate('graph', { selection: { kind: 'event', id: selectedEvent.id }, graph: { records: 'all', filter: 'referent' } });
      report.crossViewFilter = view.getState().graph.filter;
    }
    view.activate('graph', { selection: null, graph: { records: 'all', filter: 'event', neighborsOnly: false, showEdges: false, rotating: false },
      graphCamera: { position: [11, 22, 33], target: [0, 0, 0] } });
    report.state = view.getState(); report.summary = surface.querySelector('.graph-summary')?.textContent?.slice(0, 200) ?? null;
    view.recenter(); view.deactivate(); view.destroy();
  }
} catch (error) { errors.push(String(error?.stack ?? error)); }
process.stdout.write(JSON.stringify(report));
`;

function render(which, data, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-renderers-'));
  try {
    const path = join(dir, 'snapshot.json'); writeFileSync(path, JSON.stringify(data));
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', harness, publicUrl, path, which, JSON.stringify(options)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A small model with coordinates, a scene layout, life locations, a timed move and a model without coordinates.
async function snapshots(t) {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const provenance = ['renderer smoke test'];
  const scalar = (id, value, scale, extra = {}) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: -1e7, maximum: 1e7 } }, initial_value: { kind: 'scalar', value }, uncertainty: { kind: 'unknown' },
    provenance, unit: 'm', reference_frame: 'EPSG:27700 British National Grid (OSGB36)', scale: { semantic_role: 'position', ...scale }, support: ['a gazetteer'], access_scopes: [], update_mode: 'static', ...extra });
  const where = (id, x, y, scale, extra) => [scalar(`${id}.position.x`, x, { axis: 'x', ...scale }, extra), scalar(`${id}.position.y`, y, { axis: 'y', ...scale }, extra)];
  const model = { schema: 'life-sim-rust-model/v1', id: 'renderer-smoke', time_unit: 'year', revision: { number: 0, reason: 'Renderer smoke test', provenance },
    processes: [
      ...where('town', 414969, 184761, {}),
      ...where('ana.home', 414969, 184761, { spatial_status: 'coarse_life_location', location_role: 'home_base', place_ref: 'place.town', label: 'Ana · home in the town' }),
      ...where('ana.visit', 420030, 192456, { spatial_status: 'coarse_life_location', location_role: 'visit', place_ref: 'place.town', label: 'Ana · a visit' }),
      ...['x', 'y', 'z'].map((axis, i) => scalar(`room.chair.position.${axis}`, [1, 2, 0][i], { axis }, { reference_frame: 'room.authored-metres', support: ['spatial_entity:chair'] })),
    ],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1',
      referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse', continuity_criterion: 'the same person', lifecycle_event_id: 'ana.life', provenance },
        { id: 'place.town', boundary: 'The town, as a coarse settlement', continuity_criterion: 'the same settlement', provenance }],
      events: [{ id: 'ana.life', boundary: 'Ana\'s life', interval: { start: 1980, end: 2030 }, participants: { subject: 'person.ana' }, provenance },
        { id: 'ana.move', boundary: 'Ana visits', interval: { start: 2005, end: 2006 }, participants: { subject: 'person.ana' }, region: 'the next town', provenance }],
      event_referent_bindings: [
        { id: 'b.home', target: { kind: 'process', process_id: 'ana.home.position.x' }, role: 'position', referent_id: 'person.ana', binding_type: 'coordinate', interval: { start: 1980, end: 2030 }, provenance },
        { id: 'b.visit', target: { kind: 'process', process_id: 'ana.visit.position.x' }, role: 'position', referent_id: 'person.ana', binding_type: 'coordinate', interval: { start: 2005, end: 2006 }, provenance },
        { id: 'b.town', target: { kind: 'process', process_id: 'town.position.x' }, role: 'position', referent_id: 'place.town', binding_type: 'coordinate', provenance },
        { id: 'b.at', target: { kind: 'event', event_id: 'ana.move' }, role: 'setting', referent_id: 'place.town', binding_type: 'located_in', provenance }],
      event_relations: [{ id: 'c', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.move', provenance }],
      context_roots: [{ event_id: 'ana.life', kind: 'accepted_world', provenance }],
      normalized_cuts: [{ id: 'cut.move', parent_event_id: 'ana.move', question: 'Does she go?', unit: 'decision', answers: [{ key: 'yes', weight: 0.7 }, { key: 'remainder', weight: 0.3 }], provenance }] } };
  const registered = await service.registerModel({ requestId: 'renderer-smoke', model });
  const { model: definition } = await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true });
  const data = await buildViewerData({ history: { models: [{ modelHash: registered.modelHash, definition }], revisions: [] }, generatedAt: '2026-09-27T12:00:00.000Z' });
  const plain = structuredClone(data); plain.inspection.model.processes = plain.inspection.model.processes.filter((process) => process.scale?.semantic_role !== 'position');
  return { data, plain };
}

test('the Space renderer runs every frame, focus, play and selection without an error, with or without coordinates', async (t) => {
  const { data, plain } = await snapshots(t);
  const drawn = render('space', data);
  assert.deepEqual(drawn.errors, []); assert.equal(drawn.frames, 2, 'geography and the authored room are separate frames');
  assert.deepEqual(drawn.letGo, { opened: true, toggled: true, kept: true, hidden: true, last: null }, 'a selection in Space can always be let go');
  assert.equal(drawn.restored.frame, 1, 'a stable frame identity wins over its stale index');
  assert.deepEqual(drawn.restored.position.map(Math.round), [11, 22, 33]);
  assert.notDeepEqual(drawn.removedFramePosition, [999, 999, 999], 'a removed frame cannot restore its camera into another frame');
  const listed = render('space', plain);
  assert.deepEqual(listed.errors, []); assert.match(listed.summary ?? '', /No coordinates are declared/u);
});

// A small world in a geodetic frame: four cities on four continents (one with a declared spread), a ship that moves at a declared
// rate, an aircraft with an altitude, two Events at once with one causing the other; and a pair of points close together.
async function geoSnapshots(t) {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const provenance = ['globe test'];
  const scalar = (id, value, scale, extra = {}) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: -1e7, maximum: 1e7 } }, initial_value: { kind: 'scalar', value }, uncertainty: { kind: 'exact' },
    provenance, unit: 'degree', reference_frame: 'WGS84', scale: { semantic_role: 'position', ...scale }, support: ['a gazetteer'], access_scopes: [], update_mode: 'static', ...extra });
  const at = (id, latitude, longitude, extra = {}) => [['latitude', latitude], ['longitude', longitude]].map(([axis, value]) => scalar(`${id}.position.${axis}`, value, { axis }, { support: [`spatial_entity:${id}`], ...extra }));
  const named = (id, boundary) => ({ id, boundary, continuity_criterion: 'the same thing', provenance });
  const bind = (referent, process) => ({ id: `where.${process}`, target: { kind: 'process', process_id: process }, role: 'position', referent_id: referent, binding_type: 'position of', provenance });
  const register = async (name, model) => {
    const registered = await service.registerModel({ requestId: name, model });
    const { model: definition } = await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true });
    return buildViewerData({ history: { models: [{ modelHash: registered.modelHash, definition }], revisions: [] }, generatedAt: '2026-10-25T12:00:00.000Z' });
  };
  const frame = (id, processes, meaning) => ({ schema: 'life-sim-rust-model/v1', id, time_unit: 'hour', revision: { number: 0, reason: 'Globe test', provenance }, processes, decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', context_roots: [{ event_id: 'tour', kind: 'accepted_world', provenance }], ...meaning } });
  const world = frame('globe-world', [
    ...at('london', 51.5074, -0.1278), ...at('new_york', 40.7128, -74.006, { uncertainty: { kind: 'standard_deviation', value: 0.5 } }), ...at('tokyo', 35.6762, 139.6503), ...at('sydney', -33.8688, 151.2093),
    ...at('ship', 35, -60), scalar('ship.velocity.longitude', 1.5, { semantic_role: 'velocity', axis: 'longitude' }, { unit: 'degree/hour' }),
    // The altitude is in metres beside angles in degrees; its id sorts before the latitude's, as a canonical model's does.
    ...at('aircraft', 36.2, 138.2), scalar('aircraft.position.altitude', 10000, { axis: 'altitude' }, { unit: 'm', support: ['spatial_entity:aircraft'] }),
  ], {
    referents: [named('place.london', 'London, a city'), named('place.new_york', 'New York, a city'), named('place.tokyo', 'Tokyo, a city'), named('place.sydney', 'Sydney, a city'), named('thing.ship', 'The Atlantic Ship, a vessel'), named('thing.aircraft', 'The Aircraft, a plane')],
    events: [{ id: 'tour', boundary: 'The tour', interval: { start: 0, end: 48 }, provenance },
      { id: 'summit', boundary: 'A summit in Tokyo', interval: { start: 10, end: 16 }, process_ids: ['tokyo.position.latitude'], provenance },
      { id: 'conference', boundary: 'A conference in New York', interval: { start: 12, end: 18 }, process_ids: ['new_york.position.latitude'], provenance }],
    event_referent_bindings: [['place.london', 'london'], ['place.new_york', 'new_york'], ['place.tokyo', 'tokyo'], ['place.sydney', 'sydney'], ['thing.ship', 'ship'], ['thing.aircraft', 'aircraft']].map(([referent, id]) => bind(referent, `${id}.position.latitude`)),
    event_relations: [{ id: 'c1', kind: 'contains', source_event_id: 'tour', target_event_id: 'summit', provenance }, { id: 'c2', kind: 'contains', source_event_id: 'tour', target_event_id: 'conference', provenance },
      { id: 'cause', kind: 'causes', source_event_id: 'summit', target_event_id: 'conference', provenance }],
  });
  world.dependencies = [{ id: 'ship.dependency', source: 'ship.velocity.longitude', target: 'ship.position.longitude', kind: 'causes', law_id: 'ship.sails' }];
  world.laws = [{ id: 'ship.sails', operator: { role: 'evolution', target: 'ship.position.longitude', derivative: { op: 'process', process: 'ship.velocity.longitude' } }, provenance }];
  const pair = frame('globe-pair', [...at('swindon', 51.558, -1.782), ...at('avebury', 51.428, -1.854)], {
    referents: [named('place.swindon', 'Swindon, a town'), named('place.avebury', 'Avebury, a village')], events: [{ id: 'tour', boundary: 'A day', interval: { start: 0, end: 24 }, provenance }],
    event_referent_bindings: [bind('place.swindon', 'swindon.position.latitude'), bind('place.avebury', 'avebury.position.latitude')] });
  return { world: await register('globe-world', world), pair: await register('globe-pair', pair) };
}
const where = (mark) => globeAngles(mark.position);
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} is not ${expected}`);

test('a frame of latitudes and longitudes opens as a globe when its points span a wide part of the Earth, with each position where it is declared', async (t) => {
  const { world } = await geoSnapshots(t);
  // A note on one Event and a passage on the other, from the story graph's own edges to them.
  world.inspection.graph = { nodes: [{ id: 'note.summit', kind: 'understanding', node_type: 'understanding', text: 'What the summit settled.' }, { id: 'passage.conference', kind: 'passage', node_type: 'passage', role: 'story_passage', text: 'The delegates gathered.' }],
    edges: [['note.summit', 'summit'], ['passage.conference', 'conference']].map(([node, event]) => ({ source: { kind: 'node', node_id: node }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: event }, relation: 'about', family: 'grounding' })) };
  const drawn = render('globe', world, { script: true });
  assert.deepEqual(drawn.errors, []);
  const { opened } = drawn;
  assert.equal(opened.state.spaceCamera.drawing, 'globe'); assert.equal(opened.state.space.earth, null, 'nothing is chosen yet: the span decides');
  const { labels, ticks } = drawn.antipode.scene;
  assert.deepEqual([labels.London, labels['New York'], labels.Sydney], ['hidden', 'hidden', 'visible'], 'from over the Pacific, London and New York are behind the globe and Sydney is not');
  assert.ok(ticks.length > 4 && ticks.every((text) => /°/u.test(text)), 'the degrees are written beside the graticule, and nothing else');
  assert.deepEqual(opened.buttons, { Globe: { hidden: false, pressed: 'true' }, Map: { hidden: false, pressed: 'false' } });
  assert.equal(opened.scene.sphere, 1); assert.equal(opened.scene.grids, 0, 'the globe replaces the flat grid');
  assert.ok(opened.scene.graticule > 100 && opened.scene.major > 100, 'a graticule is drawn, with the equator and the prime meridian apart');
  // Each declared position is in the direction of its latitude and longitude from the globe's centre.
  for (const [label, latitude, longitude] of [['London', 51.5074, -0.1278], ['New York', 40.7128, -74.006], ['Tokyo', 35.6762, 139.6503], ['Sydney', -33.8688, 151.2093], ['Aircraft', 36.2, 138.2], ['Atlantic Ship', 35, -60]]) {
    const mark = opened.scene.marks[label]; assert.ok(mark, `${label} is drawn`);
    const here = where(mark); near(here.latitude, latitude, 1e-6, `${label} latitude`); near(here.longitude, longitude, 1e-6, `${label} longitude`);
  }
  assert.ok(Math.hypot(...opened.camera) > GLOBE_RADIUS * 2 && Math.hypot(...opened.camera) < GLOBE_RADIUS * 5, 'a wide spread is seen from far enough to see the globe');
  // The controls turn about the globe's centre without panning off it, and stop above the surface; wheel and drag scale with the height.
  assert.deepEqual([opened.controls.pan, opened.controls.target, opened.controls.max], [false, [0, 0, 0], String(GLOBE_RADIUS * 7)]); assert.ok(opened.controls.min > GLOBE_RADIUS && opened.controls.min < GLOBE_RADIUS + 0.1);
  assert.ok(opened.controls.zoomSpeed > 1 && opened.controls.zoomSpeed < 3.3 && opened.controls.rotateSpeed > 0.1 && opened.controls.rotateSpeed < 0.6, 'from orbit a notch of the wheel is about a seventh of the height');
  assert.ok(opened.controls.near > 10 && opened.controls.far > Math.hypot(...opened.camera) + GLOBE_RADIUS, 'the clipping planes follow the camera');
  // A declared spread is a cap of the sphere about the place, as wide as the declared angle (the longitude's narrowed by the cosine of the latitude).
  const [cap] = opened.scene.spreads; assert.equal(opened.scene.spreads.length, 1, 'only New York declares a spread'); assert.ok(cap.visible);
  const centre = where({ position: cap.centre }); near(centre.latitude, 40.7128, 1e-6, 'the cap is over New York'); near(centre.longitude, -74.006, 1e-6, 'the cap is over New York');
  near(cap.radians * 180 / Math.PI, 0.5, 1e-9, 'half a degree across the surface');
  // An altitude is to scale, with a line down to the ground that shows it is raised.
  const [drop] = opened.scene.lines.drop; assert.equal(opened.scene.lines.drop.length, 1);
  // (Line vertices are kept in single precision, so these are compared to a ten-thousandth.)
  near(Math.hypot(...drop.points[0]), GLOBE_RADIUS, 1e-4, 'the ground'); near(Math.hypot(...drop.points[1]), GLOBE_RADIUS * (1 + 10000 / EARTH_RADIUS_M), 1e-4, 'the altitude of 10,000 metres');
  // What moves, moves as declared: the ship's longitude grows 1.5 degrees an hour, and its trail follows the surface.
  near(where(drawn.late.scene.marks['Atlantic Ship']).longitude, -60 + 1.5 * 48, 1e-6, 'the ship after 48 hours'); assert.equal(drawn.late.state.space.time, 48);
  const [trail] = opened.scene.lines.trail; assert.equal(opened.scene.lines.trail.length, 1, 'only what moves leaves a trail');
  const stand = trail.points.map((point) => globeAngles(point));
  near(stand[0].longitude, -60, 1e-3, 'the trail starts where the ship does'); near(stand.at(-1).longitude, 12, 1e-3, 'and ends where it will be');
  for (const [i, point] of trail.points.entries()) {
    assert.ok(Math.hypot(...point) >= GLOBE_RADIUS, 'the trail is never inside the globe');
    if (i) { const a = trail.points[i - 1], dot = (a[0] * point[0] + a[1] * point[1] + a[2] * point[2]) / (Math.hypot(...a) * Math.hypot(...point)); assert.ok(Math.acos(Math.min(1, dot)) * 180 / Math.PI <= 0.5 + 1e-3, 'in pieces of at most half a degree'); }
  }
  // Two Events at once, one causing the other, are joined by an arc that rises over the surface; apart in time they are not drawn.
  assert.equal(opened.scene.lines.causal.length, 1); assert.equal(opened.scene.lines.causal[0].visible, false);
  const [arc] = drawn.during.scene.lines.causal; assert.equal(arc.visible, true); assert.ok(arc.points.length > 3);
  assert.ok(arc.points.every((point) => Math.hypot(...point) >= GLOBE_RADIUS), 'an arc between places does not pass through the Earth');
  // Each Event stands over its place, with its note or passage beside it as a light; the stacks are as tall as the camera sets them.
  const events = Object.fromEntries(drawn.during.scene.events.map((event) => [event.id, event]));
  for (const [id, label] of [['summit', 'Tokyo'], ['conference', 'New York']]) {
    assert.ok(events[id].visible, `${id} is drawn while it happens`);
    const place = where(drawn.during.scene.marks[label]), over = where(events[id]);
    assert.ok(Math.abs(place.latitude - over.latitude) < 25 && Math.abs(place.longitude - over.longitude) < 25, `${id} stands over its place`);
    assert.ok(Math.hypot(...events[id].position) > GLOBE_RADIUS, `${id} stands above the surface`);
  }
  assert.equal(drawn.during.scene.lights.length, 2); assert.ok(drawn.during.scene.lights.every((light) => light.visible && Math.min(...drawn.during.scene.events.map((event) => Math.hypot(...light.position.map((v, i) => v - event.position[i])))) < 25), 'a note or passage is a light beside its Event');
});

test('the Globe and Map buttons change how the Earth is drawn, and the choice is kept in the address', async (t) => {
  const { world } = await geoSnapshots(t);
  const drawn = render('globe', world, { script: true });
  assert.deepEqual(drawn.errors, []);
  const { map, back } = drawn;
  assert.equal(map.state.spaceCamera.drawing, 'map'); assert.equal(map.state.space.earth, 'map');
  assert.equal(map.scene.sphere, 0, 'no globe on the map'); assert.equal(map.scene.grids, 1, 'the flat grid is back'); assert.equal(map.scene.graticule, 0);
  assert.deepEqual(map.buttons, { Globe: { hidden: false, pressed: 'false' }, Map: { hidden: false, pressed: 'true' } });
  assert.match(map.address, /[?&]earth=map(&|$)/u);
  for (const mark of Object.values(map.scene.marks)) assert.ok(mark.position.every((value) => Math.abs(value) <= GLOBE_RADIUS), 'the map is drawn within its own scale');
  // Back on the map, every control and the light are as the map has always had them: nothing of the globe is left behind.
  assert.deepEqual([map.controls.pan, map.controls.zoom, map.controls.min, map.controls.max, map.controls.zoomSpeed, map.controls.rotateSpeed, map.controls.sun], [true, true, 0, 'Infinity', 1, 1, [30, 100, 40]]);
  assert.equal(back.state.spaceCamera.drawing, 'globe'); assert.equal(back.scene.sphere, 1); assert.equal(back.scene.grids, 0, 'the globe leaves nothing of the map');
  assert.equal(back.controls.pan, false, 'and the globe sets them again');
  assert.match(back.address, /[?&]earth=globe(&|$)/u); assert.equal(back.state.space.earth, 'globe');
  // A reload opens as the address says, whatever the span. The choice is a view setting, so a view the model chooses can set it
  // and a change to a followed view marks it adjusted.
  const asked = render('globe', world, { search: '&earth=map' });
  assert.deepEqual(asked.errors, []); assert.equal(asked.opened.state.spaceCamera.drawing, 'map'); assert.equal(asked.opened.buttons.Map.pressed, 'true');
  assert.deepEqual(viewSettingsProblems({ earth: 'map' }), []); assert.match(viewSettingsProblems({ earth: 'flat' })[0], /^earth=flat must be one of globe, map/u);
});

test('a frame of latitudes and longitudes that spans a small part of the Earth opens as a map, with the globe a click away', async (t) => {
  const { pair } = await geoSnapshots(t);
  const flat = render('globe', pair);
  assert.deepEqual(flat.errors, []); assert.equal(flat.opened.state.spaceCamera.drawing, 'map'); assert.equal(flat.opened.scene.sphere, 0); assert.equal(flat.opened.scene.grids, 1);
  assert.deepEqual(flat.opened.buttons, { Globe: { hidden: false, pressed: 'false' }, Map: { hidden: false, pressed: 'true' } }); assert.equal(flat.opened.state.space.earth, null);
  const turned = render('globe', pair, { toggle: 'Globe' });
  assert.deepEqual(turned.errors, []); assert.equal(turned.toggled.state.spaceCamera.drawing, 'globe'); assert.equal(turned.toggled.scene.sphere, 1);
  const swindon = where(turned.toggled.scene.marks.Swindon), avebury = where(turned.toggled.scene.marks.Avebury);
  near(swindon.latitude, 51.558, 1e-6, 'Swindon'); near(swindon.longitude, -1.782, 1e-6, 'Swindon'); near(avebury.latitude, 51.428, 1e-6, 'Avebury'); near(avebury.longitude, -1.854, 1e-6, 'Avebury');
  assert.ok(Math.hypot(...turned.toggled.camera) - GLOBE_RADIUS < 20, 'two nearby points are seen from close by, not from orbit');
  const asked = render('globe', pair, { search: '&earth=globe' });
  assert.equal(asked.opened.state.spaceCamera.drawing, 'globe', 'a choice beats the span');
});

test('a frame without latitude and longitude is drawn as it always was, with no globe offered', async (t) => {
  const { data } = await snapshots(t);
  const drawn = render('globe', data);
  assert.deepEqual(drawn.errors, []);
  assert.equal(drawn.opened.state.spaceCamera.drawing, 'map'); assert.equal(drawn.opened.scene.sphere, 0); assert.equal(drawn.opened.scene.grids, 1);
  assert.deepEqual([drawn.opened.buttons.Globe.hidden, drawn.opened.buttons.Map.hidden], [true, true], 'a projected frame in metres has no globe to choose');
  assert.doesNotMatch(drawn.opened.address, /[?&]earth=/u, 'nothing is written for a choice that was not made');
});

test('the Graph renderer runs its overview, every record and a restored selection without an error', async (t) => {
  const { data } = await snapshots(t);
  const drawn = render('graph', data);
  assert.deepEqual(drawn.errors, []); assert.equal(drawn.state.graph.records, 'all', 'selecting a Cut the overview holds opens every record');
  assert.deepEqual(drawn.letGo, { opened: true, kept: true, hidden: true, last: null }, 'a click on nothing lets the Graph selection go; a right click does not');
  assert.equal(drawn.state.graph.filter, 'event'); assert.equal(drawn.state.graph.showEdges, false);
  assert.equal(drawn.crossViewFilter, '', 'a restored type filter cannot hide an explicitly selected record from another view');
  assert.deepEqual(drawn.state.graphCamera.position.map(Math.round), [11, 22, 33], 'the camera is restored after its graph layout and filters');
});

test('W A S D walk the Space and Graph cameras, stop on release and leave typing alone', () => {
  const walked = render('walk', { inspection: { model: {} } });
  assert.deepEqual(walked.errors, []);
  assert.ok(walked.forward[2] < walked.start[2], 'W moves toward what the camera faces');
  assert.equal(walked.forward[1], walked.start[1], 'walking keeps to the ground plane');
  assert.equal(walked.idle, false, 'releasing the key stops');
  assert.equal(walked.typed, false, 'a key typed into a field does not walk');
  assert.equal(walked.started, 2, 'starting to walk is announced once per press');
  assert.notEqual(walked.target[0], 0, 'the arrows turn the view');
});

test('only a plain, still click of one pointer picks; a drag, another button, a modifier or a pinch never does', async () => {
  const { onPlainClick } = await import(publicUrl + 'pointer-click.js');
  const listeners = {}, element = { addEventListener: (type, handler) => { listeners[type] = handler; } };
  const picks = [], details = []; onPlainClick(element, (event) => { picks.push(event.clientX); details.push(event.detail); });
  const pointer = (type, x, extra = {}) => {
    const event = { button: 0, clientX: x, clientY: 0, pointerId: 1, isPrimary: true, detail: 1, ...extra };
    listeners[type](event);
    if (type === 'pointerup') listeners.click(event);
  };
  pointer('pointerdown', 10); pointer('pointerup', 12); // a click that barely moves
  pointer('pointerdown', 20); pointer('pointerup', 40); // a drag turns the view
  pointer('pointerdown', 30, { button: 2 }); pointer('pointerup', 30, { button: 2 }); // the right button pans
  pointer('pointerdown', 50, { shiftKey: true }); pointer('pointerup', 50, { shiftKey: true }); // so does a modifier
  pointer('pointerdown', 60); pointer('pointerdown', 90, { pointerId: 2, isPrimary: false }); pointer('pointerup', 90, { pointerId: 2, isPrimary: false }); pointer('pointerup', 60); // a pinch
  pointer('pointerdown', 70); listeners.pointercancel({ pointerId: 1 }); pointer('pointerup', 70); // a cancelled press
  pointer('pointerdown', 80); pointer('pointerup', 80, { detail: 2 }); // preserve the native double-click count
  pointer('pointerdown', 100); pointer('pointermove', 200, { button: -1 }); pointer('pointermove', 100, { button: -1 }); pointer('pointerup', 100); // a drag that returns to its start
  pointer('pointerdown', 110); pointer('pointermove', 110, { button: -1, shiftKey: true }); pointer('pointerup', 110); // a modifier released before the button
  pointer('pointerdown', 120); pointer('pointerup', 120, { pointerId: 2 }); // an unrelated pointer cannot finish the click
  assert.deepEqual(picks, [12, 80]);
  assert.deepEqual(details, [1, 2]);
});
