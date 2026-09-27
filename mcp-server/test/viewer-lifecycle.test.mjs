import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const functionSource = (name) => {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `Missing ${name}`);
  return source.slice(start, end + 2);
};

test('the actual temporal controller owns one frame loop and pauses keyboard/playback while another representation is active', () => {
  const frames = new Map(), listeners = [], canceled = [], disposed = [], intervals = [];
  let serial = 0, renders = 0;
  const context = {
    window: { modelViewer: {}, addEventListener: (name, callback, options) => listeners.push({ name, callback, options }) },
    AbortController, innerWidth: 505, innerHeight: 788, performance: { now: () => 100 },
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); canceled.push(id); },
    clearInterval(id) { intervals.push(id); }, clearTimeout() {},
    controls: { enabled: false, update() {}, dispose() { disposed.push('controls'); } },
    renderer: { setSize() {}, dispose() { disposed.push('renderer'); } },
    labels: { setSize() {}, render() {} }, labels2: { update() {} },
    camera: { updateProjectionMatrix() {} }, scene: {},
    composer: { setSize() {}, render() { renders += 1; }, dispose() { disposed.push('composer'); } },
    params: new URLSearchParams(), opt: { camera: 'free', layout: 'layers', mode: 'story' },
    now: 1843, tau: 20, atEnd: false, F: { a: 1836, b: 1857 },
    playing: true, timer: 17, liveTimer: 18, urlTimer: null,
    held: new Set(['w']), pointerAt: { x: 3, y: 4 }, tip: { hidden: false },
    last: 90, framesDrawn: 0, relayout: false,
    setLayout(view) { context.opt.layout = view; }, setProcessDetail() {}, useSharedSelection() {},
    recenterCalls: 0, recenterView() { context.recenterCalls += 1; },
    syncPanel() {}, syncURL() {}, fitLocked() {}, placeLocked() {}, tick() {}, declutter() {}, hover() {},
    stop() { context.playing = false; }, keyboardCalls: 0,
  };
  vm.createContext(context);
  const guard = source.slice(source.indexOf('let temporalActive ='), source.indexOf('\nfunction publishRecord'));
  const controller = source.slice(source.indexOf('export const temporalController =')).replace('export const', 'this.');
  vm.runInContext(`${guard}\n${functionSource('frame')}\n${controller}\naddEventListener('keydown', () => keyboardCalls++);`, context);
  const keydown = listeners.find((entry) => entry.name === 'keydown');
  keydown.callback({}); assert.equal(context.keyboardCalls, 0, 'inactive temporal keyboard cannot retime or move a graph');
  const control = context.temporalController;
  control.activate('layers', {}); control.activate('terrain', {});
  control.recenter(); assert.equal(context.recenterCalls, 1, 'the shared action invokes the real temporal framing entry point once');
  assert.equal(frames.size, 1, 'switching temporal layouts does not add a second renderer loop');
  keydown.callback({}); assert.equal(context.keyboardCalls, 1);
  const next = [...frames.entries()][0]; frames.delete(next[0]); next[1]();
  assert.equal(frames.size, 1); assert.equal(renders, 2);
  const before = JSON.parse(JSON.stringify(control.getState().time));
  control.deactivate();
  assert.equal(frames.size, 0); assert.equal(context.playing, false); assert.equal(context.controls.enabled, false);
  assert.equal(context.held.size, 0); assert.equal(context.tip.hidden, true);
  keydown.callback({}); assert.equal(context.keyboardCalls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(control.getState().time)), before, 'the same time and window survive pausing');
  control.activate('layers', {}); assert.equal(frames.size, 1);
  control.destroy(); assert.equal(frames.size, 0);
  assert.equal(keydown.options.signal.aborted, true);
  assert.deepEqual(intervals, [17, 18]);
  assert.deepEqual(disposed, ['controls', 'composer', 'renderer']);
  assert.ok(canceled.length >= 2);
});

test('an inactive temporal URL timer cannot overwrite the selected representation or native record', () => {
  const saved = [], timers = [];
  const context = {
    temporalActive: true, ready: true, urlTimer: null,
    clearTimeout() {}, setTimeout(callback) { timers.push(callback); return 1; },
    history: { replaceState(...args) { saved.push(args); } },
  };
  vm.createContext(context); vm.runInContext(functionSource('syncURL'), context);
  context.syncURL(); assert.equal(timers.length, 1);
  context.temporalActive = false; timers[0](); context.syncURL(true);
  assert.deepEqual(saved, []);
});
