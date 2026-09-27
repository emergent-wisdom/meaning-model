import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../viewer/public/vendor/three/three.module.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cameraState, restoreCamera, captureReader, restoreReader, mountLiveViewer, takeLiveContext } from '../viewer/public/live-viewer.js';

const classes = () => { const set = new Set(); return { contains: (key) => set.has(key), toggle: (key, on) => on ? set.add(key) : set.delete(key) }; };
function readerFixture() {
  const scroll = { scrollTop: 200, getBoundingClientRect: () => ({ top: 100 }) };
  const header = { getBoundingClientRect: () => ({ bottom: 145 }) };
  const items = [], full = classes(); full.toggle('full', true);
  const reader = { hidden: false, classList: full,
    querySelector: (selector) => selector.includes('reader-scroll') ? scroll : selector.includes('reader-head') ? header : null,
    querySelectorAll: () => items };
  const add = (unit, text, y, height = 80) => {
    const item = { textContent: text, dataset: { nodeId: unit }, closest: () => null,
      getBoundingClientRect: () => ({ top: 100 + item.y - scroll.scrollTop, bottom: 100 + item.y + height - scroll.scrollTop }), y };
    items.push(item); return item;
  };
  add('first', 'Before the reader', 0);
  return { reader, scroll, items, add };
}

test('reading context follows a stable passage and paragraph when earlier text grows', () => {
  const f = readerFixture();
  f.add('second', 'Earlier paragraph in this passage', 150, 50);
  const target = f.add('second', 'The paragraph being read', 240);
  const state = captureReader(f.reader);
  assert.equal(state.anchor.text, target.textContent); assert.equal(state.anchor.offset, 40);
  target.y += 400; f.add('second', 'Inserted above the target', 240);
  f.reader.hidden = true; f.scroll.scrollTop = 0;
  restoreReader(f.reader, state);
  assert.equal(f.scroll.scrollTop, 600);
  assert.equal(target.getBoundingClientRect().top, 140);
  assert.equal(f.reader.hidden, false); assert.equal(f.reader.classList.contains('full'), true);
});

test('a removed paragraph falls back within its own passage and hidden readers stay closed', () => {
  const f = readerFixture(), target = f.add('second', 'Read this', 240), state = captureReader(f.reader);
  target.textContent = 'The paragraph was revised'; target.y += 75;
  restoreReader(f.reader, state); assert.equal(f.scroll.scrollTop, 275);
  f.reader.hidden = true; assert.deepEqual(captureReader(f.reader), { open: false });
  restoreReader(f.reader, { open: false }); assert.equal(f.reader.hidden, true);
});

test('camera restoration retains position, target and projection and rejects invalid vectors', () => {
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 900), controls = { target: new THREE.Vector3(1, 2, 3), update() {} };
  camera.position.set(4, 5, 6); camera.zoom = 2;
  const state = cameraState(camera, controls);
  camera.position.set(0, 0, 0); controls.target.set(0, 0, 0); camera.zoom = 1;
  assert.equal(restoreCamera(camera, controls, state), true);
  assert.deepEqual(cameraState(camera, controls), state);
  assert.equal(restoreCamera(camera, controls, { ...state, position: [NaN, 1, 2] }), false);
});

test('saved state is consumed once and expired or blocked storage is harmless', () => {
  const values = new Map(), storage = { getItem: (key) => values.get(key), removeItem: (key) => values.delete(key) };
  values.set('view', JSON.stringify({ savedAt: Date.now(), state: { view: 'space' } }));
  assert.equal(takeLiveContext(storage, 'view').state.view, 'space'); assert.equal(takeLiveContext(storage, 'view'), null);
  values.set('view', JSON.stringify({ savedAt: Date.now() - 400_000, state: {} }));
  assert.equal(takeLiveContext(storage, 'view'), null);
  assert.equal(takeLiveContext({ getItem() { throw Error('Blocked'); } }, 'view'), null);
});

test('a pending live reader refresh is opaque before rendering; ordinary, expired and blocked storage stay inert', () => {
  const source = readFileSync(new URL('../viewer/public/live-transition.js', import.meta.url), 'utf8');
  for (const saved of [null, { savedAt: Date.now(), reader: { open: false } }, { savedAt: Date.now() - 400_000, reader: { open: true } },
    { savedAt: Date.now(), reader: { open: true } }, 'blocked']) {
    const attributes = {}, styles = [], timers = [], listeners = {};
    const context = { location: { pathname: '/token/', search: '' }, URLSearchParams, Date,
      sessionStorage: { getItem() { if (saved === 'blocked') throw Error('Disabled'); return JSON.stringify(saved); } },
      document: { documentElement: { setAttribute: (key, value) => { attributes[key] = value; }, removeAttribute: (key) => { delete attributes[key]; } },
        head: { append: (style) => styles.push(style.textContent) }, createElement: () => ({}) },
      setTimeout: (fn) => timers.push(fn), addEventListener: (key, fn) => { listeners[key] = fn; } };
    vm.runInNewContext(source, context);
    const pending = saved?.reader?.open && saved.savedAt > Date.now() - 300_000;
    assert.equal(Object.hasOwn(attributes, 'data-live-reader-refresh'), Boolean(pending));
    if (pending) { assert.match(styles[0], /background:#0b1017/); assert.equal(timers.length, 1); listeners.keydown({ key: 'Escape' }); assert.equal(Object.keys(attributes).length, 0); }
    else assert.deepEqual(styles, []);
  }
});

function browser(t) {
  let clock = 10_000; t.mock.method(Date, 'now', () => clock);
  const scheduled = [], listeners = new Map(), saved = [], labels = [], reloads = [];
  t.mock.method(globalThis, 'setTimeout', (fn) => { scheduled.push(fn); return scheduled.length; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const element = () => ({ style: {}, hidden: false, append(...items) { this.items = items; }, remove() {}, addEventListener(name, fn) { this[name] = fn; }, set textContent(value) { this.text = value; }, get textContent() { return this.text; } });
  const title = element();
  const document = { hidden: false, activeElement: null, body: title, querySelector: () => title,
    createElement: () => { const node = element(); labels.push(node); return node; },
    getElementById: () => null, getSelection: () => ({ isCollapsed: true }),
    addEventListener(name, fn) { listeners.set(name, fn); } };
  let head = 'first', status = 'following', requests = 0;
  const options = { data: { viewerLive: { mode: 'live', graphHash: 'first' } }, document, key: 'token',
    getState: () => ({ view: 'space', selection: { kind: 'event', id: 'birth' }, time: { mode: 'story', now: 1880 } }),
    storage: { setItem: (key, value) => saved.push([key, JSON.parse(value)]) }, reload: () => reloads.push(true),
    fetch: async () => { requests += 1; return { ok: true, json: async () => ({ mode: 'live', status, graphHash: head, message: 'Live · saved revisions' }) }; } };
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { options, document, saved, reloads, labels, listeners, requests: () => requests,
    head: (value) => { head = value; }, status: (value) => { status = value; },
    async tick(ms = 2_000) { clock += ms; const next = scheduled.shift(); if (next) await next(); await flush(); }, flush };
}

test('live refresh waits for scrolling, typing, selection and playback to stop before saving the same view', async (t) => {
  const f = browser(t), stop = mountLiveViewer(f.options); await f.flush();
  f.head('second'); f.listeners.get('scroll')(); await f.tick();
  assert.equal(f.reloads.length, 0);
  f.document.activeElement = { closest: () => ({}) }; await f.tick(5_000); assert.equal(f.reloads.length, 0);
  f.document.activeElement = null; f.document.getSelection = () => ({ isCollapsed: false }); await f.tick(); assert.equal(f.reloads.length, 0);
  f.document.getSelection = () => ({ isCollapsed: true });
  f.document.getElementById = (id) => id === 'play' ? { textContent: '❚❚', disabled: false } : null;
  await f.tick(); assert.equal(f.reloads.length, 0);
  f.document.getElementById = () => null; await f.tick();
  assert.equal(f.reloads.length, 1); assert.equal(f.saved[0][0], 'token');
  assert.deepEqual(f.saved[0][1].state, f.options.getState()); stop();
});

test('forks, pause and hidden tabs do not refresh; standalone/static snapshots never poll', async (t) => {
  const f = browser(t);
  mountLiveViewer({ ...f.options, data: { headGraphHash: 'first' } }); assert.equal(f.requests(), 0);
  const stop = mountLiveViewer(f.options); await f.flush(); f.head('second'); f.status('branched');
  await f.tick(5_000); assert.equal(f.reloads.length, 0);
  f.status('following'); f.document.hidden = true; await f.tick(); assert.equal(f.reloads.length, 0);
  f.document.hidden = false; f.labels[2].click(); await f.tick(5_000); assert.equal(f.reloads.length, 0);
  f.labels[2].click(); await f.tick(5_000); assert.equal(f.reloads.length, 1); stop();
});

test('a throwing browser storage getter cannot break snapshot startup or force a live refresh', async (t) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw Error('Storage denied'); } });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'sessionStorage', before); else delete globalThis.sessionStorage; });
  assert.equal(takeLiveContext(undefined, 'token'), null);
  const f = browser(t); delete f.options.storage;
  assert.doesNotThrow(() => mountLiveViewer({ ...f.options, data: {} }));
  const stop = mountLiveViewer(f.options); await f.flush(); f.head('second'); await f.tick(5_000);
  assert.equal(f.reloads.length, 0); assert.match(f.labels[1].textContent, /storage is unavailable/); stop();
});
