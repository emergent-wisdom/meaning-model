import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerSession } from '../viewer/public/viewer-session.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const calls = [], active = new Set(), surfaces = {}, mounted = { temporal: 0, graph: 0, structure: 0 };
  const mounts = Object.fromEntries(Object.keys(mounted).map((key) => [key, () => {
    mounted[key] += 1; calls.push(['mount', key]);
    const surface = {
      state: {}, activations: [],
      activate(view, state) {
        active.add(key); assert.equal(active.size, 1, 'only one presentation may be active');
        this.activations.push({ view, state }); calls.push(['activate', key, view]);
      },
      getState() { calls.push(['state', key]); return structuredClone(this.state); },
      recenter() { calls.push(['recenter', key]); },
      deactivate() { active.delete(key); calls.push(['deactivate', key]); },
      destroy() { calls.push(['destroy', key]); },
    };
    surfaces[key] = surface; return surface;
  }]));
  const session = createViewerSession({ temporal: true, initialView: 'layers', mounts,
    onView(view, state) { calls.push(['view', view, state]); }, onState(state) { calls.push(['shared', state]); }, ...options });
  return { session, calls, active, surfaces, mounted };
}

test('five in-page views lazily mount three retained surfaces and activate only the selected presentation', async () => {
  const { session, mounted, surfaces, active } = fixture();
  assert.deepEqual(mounted, { temporal: 0, graph: 0, structure: 0 });
  assert.equal(session.snapshot().view, 'layers');
  for (const view of ['layers', 'graph', 'structure', 'together', 'terrain', 'layers', 'graph', 'structure']) {
    const result = await session.setView(view);
    assert.equal(result.view, view);
    assert.deepEqual([...active], [view === 'graph' || view === 'structure' ? view : 'temporal']);
  }
  assert.deepEqual(mounted, { temporal: 1, graph: 1, structure: 1 });
  assert.deepEqual(surfaces.temporal.activations.map(({ view }) => view), ['layers', 'together', 'terrain', 'layers']);
  const before = surfaces.structure.activations.length;
  await session.setView('structure');
  assert.equal(surfaces.structure.activations.length, before, 'selecting the current view must not remount or reactivate it');
  assert.equal(session.snapshot().timeView, 'layers', 'the last temporal presentation survives other view choices');
});

test('outgoing time and selected native records transfer before the next presentation activates', async () => {
  const initial = { selection: { kind: 'event', id: 'arbitrary:event' }, time: { mode: 'story', at: 8 } };
  const { session, surfaces, calls } = fixture({ state: initial });
  await session.setView('layers');
  assert.deepEqual(surfaces.temporal.activations[0].state.selection, initial.selection);
  surfaces.temporal.state = { time: { mode: 'construction', at: '2026-09-27T12:00:00Z' }, depth: 4 };
  session.selectRecord({ kind: 'normalized_cut', id: 'cut:exact', presentationOnly: 'ignored' });
  await session.setView('graph');
  assert.deepEqual(surfaces.graph.activations[0].state.selection, { kind: 'normalized_cut', id: 'cut:exact' });
  assert.deepEqual(surfaces.graph.activations[0].state.time, surfaces.temporal.state.time);
  assert.equal(surfaces.graph.activations[0].state.depth, 4);
  const get = calls.findIndex((call) => call[0] === 'state' && call[1] === 'temporal');
  const deactivate = calls.findIndex((call) => call[0] === 'deactivate' && call[1] === 'temporal');
  const activate = calls.findIndex((call) => call[0] === 'activate' && call[1] === 'graph');
  assert.ok(get < deactivate && deactivate < activate, 'capture state before deactivation, then activate the destination');
  session.selectRecord(null); await session.setView('terrain');
  assert.equal(surfaces.temporal.activations.at(-1).state.selection, null, 'an explicit cleared selection remains cleared');
  assert.deepEqual(surfaces.temporal.activations.at(-1).state.time, surfaces.temporal.state.time);
});

test('live startup and view switches restore saved state before incoming renderer defaults can replace it', async () => {
  const restored = { time: { mode: 'story', now: 1880 }, space: { frame: 2, frameKey: '["harbour","m"]' }, spaceCamera: { position: [1, 2, 3] } };
  const activations = [];
  const make = (initial) => ({ state: initial, getState() { return this.state; }, activate(view, state) { activations.push({ view, state }); this.state = { ...this.state, ...state }; } });
  const space = make({ time: { mode: 'story', now: 0 }, space: { frame: 0 }, spaceCamera: { position: [9, 9, 9] } });
  const temporal = make({ time: { mode: 'story', now: 1900 } });
  const session = createViewerSession({ temporal: true, initialView: 'space', state: restored, mounts: { space: () => space, temporal: () => temporal } });
  await session.setView('space');
  assert.deepEqual(activations[0].state.time, restored.time);
  assert.deepEqual(activations[0].state.spaceCamera, restored.spaceCamera);
  assert.deepEqual(activations[0].state.space, restored.space);
  space.state.time = { mode: 'story', now: 1885 };
  assert.equal(session.snapshot().time.now, 1885, 'external capture reads the active cursor');
  await session.setView('layers');
  assert.equal(activations[1].state.time.now, 1885, 'incoming temporal defaults do not replace the outgoing cursor');
});

test('snapshots and presentation activation payloads cannot mutate the session state', async () => {
  const { session, surfaces } = fixture({ state: { selection: { kind: 'event', id: 'one' }, time: { at: 5 } } });
  const saved = session.snapshot(); saved.selection.id = 'outside'; saved.time.at = 99;
  await session.setView('graph');
  const activated = surfaces.graph.activations[0].state;
  activated.selection.id = 'renderer'; activated.time.at = -1;
  assert.deepEqual(session.snapshot().selection, { kind: 'event', id: 'one' });
  assert.deepEqual(session.snapshot().time, { at: 5 });
});

test('unsupported time views fall back to Graph without mounting a temporal renderer', async () => {
  const { session, mounted } = fixture({ temporal: false, initialView: 'terrain' });
  assert.equal(session.snapshot().view, 'graph');
  for (const view of ['terrain', 'layers', 'together', 'unknown']) assert.equal((await session.setView(view)).view, 'graph');
  assert.deepEqual(mounted, { temporal: 0, graph: 1, structure: 0 });
  assert.equal((await session.setView('structure')).view, 'structure');
  const temporal = fixture({ initialView: 'unknown' });
  assert.equal(temporal.session.snapshot().view, 'together');
});

test('a slow first mount cannot replace a newer requested presentation', async () => {
  const slow = deferred(), calls = [], states = [];
  const graph = { activate() { calls.push('graph'); }, deactivate() { calls.push('graph-off'); } };
  const structure = { activate() { calls.push('structure'); } };
  const session = createViewerSession({ temporal: true, initialView: 'graph', mounts: { graph: () => slow.promise, structure: () => structure }, onView: (view) => states.push(view) });
  const earlier = session.setView('graph');
  await session.setView('structure');
  slow.resolve(graph); await earlier;
  assert.deepEqual(calls, ['structure']);
  assert.deepEqual(states, ['structure']);
  assert.equal(session.snapshot().view, 'structure');
  await session.setView('graph');
  assert.deepEqual(calls, ['structure', 'graph'], 'the completed background mount is reused when explicitly selected later');
});

test('requesting the active view cancels a pending switch and concurrent time requests share one mount', async () => {
  const slow = deferred(), activations = []; let mounts = 0;
  const session = createViewerSession({ temporal: true, initialView: 'graph', mounts: {
    graph: () => ({ activate(view) { activations.push(view); } }),
    temporal: () => { mounts += 1; return slow.promise; },
  } });
  await session.setView('graph');
  const obsolete = session.setView('layers');
  await session.setView('graph');
  slow.resolve({ activate(view) { activations.push(view); } }); await obsolete;
  assert.deepEqual(activations, ['graph']);
  const together = session.setView('together'), terrain = session.setView('terrain');
  await Promise.all([together, terrain]);
  assert.equal(mounts, 1);
  assert.deepEqual(activations, ['graph', 'terrain']);
});

test('a failed mount leaves the current view usable and can be retried', async () => {
  let attempts = 0, deactivated = 0;
  const session = createViewerSession({ temporal: true, initialView: 'graph', mounts: {
    graph: () => ({ activate() {}, deactivate() { deactivated += 1; } }),
    structure: () => { attempts += 1; if (attempts === 1) throw new Error('mount failed'); return { activate() {} }; },
  } });
  await session.setView('graph');
  await assert.rejects(session.setView('structure'), /mount failed/);
  assert.equal(session.snapshot().view, 'graph'); assert.equal(deactivated, 0);
  assert.equal((await session.setView('structure')).view, 'structure');
  assert.equal(attempts, 2); assert.equal(deactivated, 1);
});

test('destroy prevents a pending surface from activating and releases each retained surface once', async () => {
  const slow = deferred(), events = [];
  const session = createViewerSession({ temporal: true, initialView: 'graph', mounts: {
    graph: () => ({ activate() {}, deactivate() { events.push('graph-off'); }, destroy() { events.push('graph-destroy'); } }),
    structure: () => slow.promise,
  } });
  await session.setView('graph');
  const pending = session.setView('structure');
  session.destroy();
  slow.resolve({ activate() { events.push('structure-activate'); }, destroy() { events.push('structure-destroy'); } });
  await pending; await Promise.resolve();
  assert.deepEqual(events.sort(), ['graph-destroy', 'graph-off', 'structure-destroy']);
});

test('recenter delegates once to the active surface without mounting or changing the shared model state', async () => {
  const state = { selection: { kind: 'event', id: 'engine' }, time: { at: 1851.4, t0: 1843, t1: 1871 },
    run: 'writer-latest', scope: 'engine', detail: 2, filters: { flat: 'hide', unopened: 'hide' } };
  const { session, calls, mounted } = fixture({ state });
  session.recenter();
  assert.deepEqual(mounted, { temporal: 0, graph: 0, structure: 0 }, 'recenter before activation cannot mount a renderer');
  assert.equal(calls.length, 0);
  for (const view of ['layers', 'graph', 'together', 'terrain']) {
    await session.setView(view);
    const before = session.snapshot(), priorCalls = calls.length, priorMounts = { ...mounted };
    session.recenter();
    assert.deepEqual(calls.slice(priorCalls), [['recenter', view === 'graph' ? 'graph' : 'temporal']]);
    assert.deepEqual(session.snapshot(), before, 'camera framing must preserve the run, native selection, time and filters');
    assert.deepEqual(mounted, priorMounts);
  }
  session.destroy();
  const priorCalls = calls.length;
  session.recenter();
  assert.equal(calls.length, priorCalls, 'a destroyed session cannot recenter a stale surface');
});

test('recenter tolerates a non-graphical inspector and targets the displayed surface during a pending switch', async () => {
  const slow = deferred(), calls = [];
  const session = createViewerSession({ temporal: true, initialView: 'graph', mounts: {
    graph: () => ({ recenter() { calls.push('graph'); } }),
    temporal: () => slow.promise,
    structure: () => ({}),
  } });
  await session.setView('graph');
  const pending = session.setView('layers');
  session.recenter();
  assert.deepEqual(calls, ['graph']);
  slow.resolve({ recenter() { calls.push('temporal'); } }); await pending;
  session.recenter();
  assert.deepEqual(calls, ['graph', 'temporal']);
  await session.setView('structure'); session.recenter();
  assert.deepEqual(calls, ['graph', 'temporal'], 'Structure has no camera and must not reset a retained graph');
});
