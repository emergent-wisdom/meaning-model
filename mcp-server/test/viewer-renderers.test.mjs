import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifeSimulationService } from '../src/service.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';

// Run the real Space and Graph renderers on real snapshots: the real three.js scene graph, a minimal page, and only the
// WebGL output, the label layer and the camera controls replaced. A render path that throws (as a variable used
// before its declaration once did) fails here, instead of silently falling back to Structure in a browser.
const publicUrl = new URL('../viewer/public/', import.meta.url).href;
const harness = String.raw`
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const [, publicUrl, snapshotPath, which] = process.argv;
const errors = [];
const fakes = {
  three: 'export * from ' + JSON.stringify(publicUrl + 'vendor/three/three.module.js') + ';\n' +
    'export class WebGLRenderer { constructor() { this.domElement = document.createElement("canvas"); this.frames = 0; } setPixelRatio() {} setSize() {} render() { this.frames += 1; } dispose() {} }',
  controls: 'import { Vector3, EventDispatcher } from "three"; export class OrbitControls extends EventDispatcher { constructor(camera, element) { super(); this.object = camera; this.domElement = element; this.target = new Vector3(); this.enabled = true; } update() { return false; } dispose() {} }',
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

function render(which, data) {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-renderers-'));
  try {
    const path = join(dir, 'snapshot.json'); writeFileSync(path, JSON.stringify(data));
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', harness, publicUrl, path, which], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
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
