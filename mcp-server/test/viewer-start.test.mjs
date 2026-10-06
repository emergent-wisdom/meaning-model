import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { harness } from './helpers/viewer-start-harness.mjs';

function run({ view, data, query = {}, ...options }) {
  const url = new URL('http://127.0.0.1:1234/token/?reading=off&flat=hide&unopened=hide&at=2022.25#old-location');
  if (view !== undefined) url.searchParams.set('view', view);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', harness,
    new URL('../viewer/public/start.js', import.meta.url).href], {
    input: JSON.stringify({ url: url.href, data, ...options }), encoding: 'utf8', timeout: 5_000,
  }));
}
const snapshot = (trajectories = false) => ({ title: 'Exact snapshot', viewKind: 'graph', modelHash: 'exact-model',
  capabilities: { graph: true, trajectories, story: false, construction: false },
  inspection: { model: { id: 'native-model', time_unit: 'machine_cycle', processes: [] } } });
const activations = (result) => result.actions.filter((action) => action.kind === 'activate');
const mounts = (result) => result.actions.filter((action) => action.kind === 'mount');

test('startup selects Processes with paths, Tree with dated Events, and Graph without time', () => {
  const dated = snapshot(); dated.capabilities.temporal = true;
  for (const [data, expected] of [[snapshot(true), 'together'], [dated, 'layers'], [snapshot(), 'graph']]) {
    for (const view of [undefined, 'unknown-view']) {
      const result = run({ view, data });
      assert.equal(activations(result)[0].view, expected); assert.equal(mounts(result).length, 1);
      assert.equal(mounts(result)[0].exactSnapshot, true); assert.deepEqual(result.errors, []);
    }
  }
});

test('all six Show choices stay on one page and reuse renderers with the exact loaded snapshot', () => {
  const result = run({ view: 'layers', data: snapshot(true), query: { noteLayout: 'overhead', noteLinks: 'all' }, steps: [
    { view: 'graph', button: true }, { view: 'structure', button: true }, { view: 'together', button: true },
    { view: 'terrain', button: true }, { view: 'layers', button: true }, { view: 'space', button: true }, { view: 'graph' }, { view: 'space' }, { view: 'structure' },
  ] });
  assert.deepEqual(result.buttons.map(({ view, label }) => ({ view, label })), [
    { view: 'together', label: 'Processes' }, { view: 'layers', label: 'Tree' }, { view: 'terrain', label: 'Terrain' },
    { view: 'graph', label: 'Graph' }, { view: 'structure', label: 'Structure' }, { view: 'space', label: 'Space' },
  ]);
  assert.deepEqual(activations(result).map(({ view }) => view), ['layers', 'graph', 'structure', 'together', 'terrain', 'layers', 'space', 'graph', 'space', 'structure']);
  assert.deepEqual(mounts(result).map(({ surface }) => surface).sort(), ['graph', 'space', 'structure', 'temporal']);
  assert.ok(mounts(result).every((mount) => mount.exactSnapshot));
  for (const kind of ['load', 'picker']) assert.equal(result.actions.filter((action) => action.kind === kind).length, 1);
  for (const name of ['./view.js', './graph-view.js', './space-view.js']) assert.equal(result.imports.filter((item) => item === name).length, 1);
  assert.deepEqual(result.errors, []); assert.equal(result.sharedToolbarRetained, true); assert.equal(result.representation, 'structure');
  for (const address of result.replacements) {
    const url = new URL(address); assert.equal(url.pathname, '/token/');
    for (const [key, value] of [['reading', 'off'], ['flat', 'hide'], ['unopened', 'hide'], ['at', '2022.25'], ['noteLayout', 'overhead'], ['noteLinks', 'all']]) assert.equal(url.searchParams.get(key), value);
  }
  const graph = mounts(result).find((mount) => mount.surface === 'graph');
  assert.deepEqual([graph.host, graph.tools, graph.detail, graph.reader], ['graph-scene', 'graph-controls', 'graph-details', 'graph-reader']);
  assert.deepEqual(graph.readerData, {graph: ''}, 'Graph reader must not inherit flags that hide it in Graph');
  assert.deepEqual(result.surfaces.sort(), ['graph-surface', 'space-surface', 'structure-surface']);
  const space = mounts(result).find((mount) => mount.surface === 'space');
  assert.deepEqual([space.host, space.tools, space.detail], ['space-scene', 'space-controls', 'space-details']);
});

test('native selection and time transfer through Graph and Structure and explicit selection clearing', () => {
  const record = { kind: 'normalized_cut', id: 'cut:exact' }, time = { mode: 'construction', at: '2026-09-27T12:00:00.000Z', t0: 1, t1: 9 };
  const result = run({ view: 'layers', data: snapshot(true), query: { record: JSON.stringify({ kind: 'event', id: 'initial' }) }, steps: [
    { surface: 'temporal', state: { time } }, { selection: record }, { view: 'graph' },
    { surface: 'graph', surfaceSelection: { kind: 'process', id: 'chosen-in-graph' } },
    { view: 'structure' }, { view: 'terrain' }, { selection: null }, { view: 'graph' },
  ] });
  const shown = activations(result);
  assert.deepEqual(shown[0].state.selection, { kind: 'event', id: 'initial' });
  assert.deepEqual(shown[1].state.selection, record); assert.deepEqual(shown[1].state.time, time);
  for (const item of shown.slice(2, 4)) {
    assert.deepEqual(item.state.selection, { kind: 'process', id: 'chosen-in-graph' }); assert.deepEqual(item.state.time, time);
  }
  assert.equal(shown.at(-1).state.selection, null); assert.equal(new URL(result.url).searchParams.has('record'), false);
  assert.equal(new URL(result.url).searchParams.get('timeView'), 'terrain');
});

test('Structure loads without either renderer and disables only unavailable time views', () => {
  for (const available of [false, true]) {
    const result = run({ view: 'structure', data: snapshot(available) });
    assert.deepEqual(activations(result).map(({ view }) => view), ['structure']);
    assert.ok(!result.imports.includes('./view.js') && !result.imports.includes('./graph-view.js'));
    assert.ok(result.buttons.filter(({ view }) => ['together', 'layers', 'terrain'].includes(view)).every((button) => button.disabled === !available));
    assert.ok(result.buttons.filter(({ view }) => ['graph', 'structure'].includes(view)).every((button) => !button.disabled));
  }
});

test('explicit temporal routes honor capability false and support older timeline snapshots', () => {
  for (const view of ['together', 'layers', 'terrain']) {
    const unavailable = snapshot(); unavailable.viewKind = 'timeline';
    const result = run({ view, data: unavailable });
    assert.equal(activations(result)[0].view, 'graph'); assert.ok(!result.imports.includes('./view.js'));
    const legacy = snapshot(); legacy.viewKind = 'timeline'; delete legacy.capabilities;
    assert.equal(activations(run({ view, data: legacy }))[0].view, view);
  }
});

test('renderer failure falls back to embedded Structure and load failure invents no snapshot', () => {
  const data = snapshot(true);
  for (const options of [{ view: 'graph', graphError: true }, { view: 'together', trajectoryError: true }]) {
    const result = run({ data, ...options }), shown = mounts(result).find((mount) => mount.surface === 'structure');
    assert.deepEqual(shown.data, data); assert.match(shown.message, /3D view is unavailable/);
    assert.equal(shown.host, 'structure-surface'); assert.equal(result.errors.length, 1); assert.equal(activations(result).at(-1).view, 'structure');
  }
  const failed = run({ data, loadError: true }), shown = mounts(failed)[0];
  assert.equal(shown.surface, 'structure'); assert.equal(shown.data, null); assert.match(shown.message, /snapshot absent/);
  assert.ok(!failed.imports.includes('./view.js') && !failed.imports.includes('./graph-view.js'));
});

test('page exit cleans up retained surfaces while a persisted page keeps them', () => {
  const persisted = run({ data: snapshot(true), steps: [{ view: 'graph' }, { pagehide: { persisted: true } }] });
  assert.equal(persisted.actions.filter((action) => action.kind === 'destroy').length, 0);
  const exited = run({ data: snapshot(true), steps: [{ view: 'graph' }, { view: 'structure' }, { pagehide: { persisted: false } }] });
  assert.deepEqual(exited.actions.filter((action) => action.kind === 'destroy').map(({ surface }) => surface).sort(), ['graph', 'structure', 'temporal']);
});

test('Coarse is reachable from every representation on the same page and retains the active selection and time', () => {
  for (const view of ['together', 'layers', 'terrain', 'graph', 'structure']) {
    const selection = { kind: 'event', id: 'engine' };
    const result = run({ view, data: snapshot(true), query: { record: JSON.stringify(selection), scope: 'engine', detail: '3' }, steps: [{ coarse: true }] });
    assert.equal(result.coarseDisabled, false); assert.equal(result.coarseTemporalOnly, false);
    // Processes and Tree keep their own representation; a view without detail opens the tree.
    assert.equal(activations(result).at(-1).view, ['together', 'layers'].includes(view) ? view : 'layers');
    assert.deepEqual(result.state.selection, selection);
    assert.deepEqual(result.actions.filter((action) => action.kind === 'detail'), [{ kind: 'detail', surface: 'temporal', level: 0 }]);
    assert.equal(mounts(result).filter((mount) => mount.surface === 'temporal').length, 1);
    assert.equal(new URL(result.url).searchParams.get('at'), '2022.25');
    assert.equal(new URL(result.url).searchParams.get('scope'), 'engine');
    assert.deepEqual(result.errors, []);
  }
  assert.equal(run({ view: 'graph', data: snapshot() }).coarseDisabled, true);
});


test('Recenter button and Home each frame only the active view without navigation, mounting or clearing context', () => {
  const selection = { kind: 'event', id: 'engine' };
  for (const view of ['together', 'layers', 'terrain', 'graph']) {
    for (const step of [{ recenter: true }, { key: 'Home' }]) {
      const result = run({ view, data: snapshot(true), query: { record: JSON.stringify(selection), scope: 'engine', detail: '2', run: 'writer-latest' }, steps: [step] });
      assert.deepEqual(result.actions.filter(action => action.kind === 'recenter'), [{ kind: 'recenter', surface: view === 'graph' ? 'graph' : 'temporal' }]);
      assert.equal(result.recenterHidden, false); assert.equal(result.recenterTemporalOnly, false);
      assert.equal(mounts(result).length, 1); assert.equal(activations(result).length, 1);
      assert.deepEqual(result.state.selection, selection); assert.equal(result.state.view, view);
      const url = new URL(result.url);
      for (const [key, value] of [['scope', 'engine'], ['detail', '2'], ['run', 'writer-latest'], ['flat', 'hide'], ['unopened', 'hide'], ['at', '2022.25']]) assert.equal(url.searchParams.get(key), value);
      if (step.key) assert.deepEqual(result.keys, [{ key: 'Home', prevented: true }]);
      assert.deepEqual(result.errors, []);
    }
  }
});

test('Home keeps native text navigation, modifier shortcuts and readers intact', () => {
  const ignored = [
    ...['input', 'textarea', 'select'].map(targetTag => ({ targetTag })),
    { targetTag: 'div', editable: true }, { targetTag: 'span', editableParent: true },
    ...['ctrlKey', 'metaKey', 'altKey', 'shiftKey'].map(key => ({ modifiers: { [key]: true } })),
    { modifiers: { defaultPrevented: true } }, { modifiers: { repeat: true } },
  ];
  for (const view of ['layers', 'graph']) {
    for (const options of [...ignored, { openReader: view === 'graph' ? 'graph-reader' : 'reader' }]) {
      const result = run({ view, data: snapshot(true), steps: [{ key: 'Home', ...options }] });
      assert.deepEqual(result.actions.filter(action => action.kind === 'recenter'), [], `${view}: ${JSON.stringify(options)}`);
      assert.deepEqual(result.keys, [{ key: 'Home', prevented: options.modifiers?.defaultPrevented ?? false }]);
      assert.equal(result.state.view, view);
    }
  }
  const structure = run({ view: 'structure', data: snapshot(true), steps: [{ key: 'Home' }] });
  assert.equal(structure.recenterHidden, true);
  assert.deepEqual(structure.actions.filter(action => action.kind === 'recenter'), []);
  assert.deepEqual(structure.keys, [{ key: 'Home', prevented: false }]);
  assert.deepEqual(mounts(structure).map(action => action.surface), ['structure']);
});

test('Recenter follows switches instead of resetting retained hidden surfaces', () => {
  const result = run({ view: 'layers', data: snapshot(true), steps: [
    { key: 'Home' }, { view: 'graph' }, { key: 'Home' }, { view: 'structure' }, { key: 'Home' },
    { view: 'terrain' }, { recenter: true },
  ] });
  assert.deepEqual(result.actions.filter(action => action.kind === 'recenter').map(action => action.surface), ['temporal', 'graph', 'temporal']);
  assert.deepEqual(mounts(result).map(action => action.surface), ['temporal', 'graph', 'structure']);
  assert.deepEqual(result.errors, []);
});

test('the top toolbar can be hidden and restored in every representation without losing model state', () => {
  const selection = { kind: 'event', id: 'some-event' };
  for (const view of ['layers', 'together', 'terrain', 'graph', 'structure']) {
    const result = run({ view, data: snapshot(true), steps: [
      { selection }, { toggleToolbar: true }, { toggleToolbar: true },
    ] });
    assert.equal(result.toolbarStates.length, 2);
    for (const [i, entry] of result.toolbarStates.entries()) {
      assert.equal(entry.hidden, i === 0);
      assert.equal(entry.label, i === 0 ? 'Show controls' : 'Hide controls');
      assert.equal(entry.expanded, String(i !== 0));
      assert.equal(entry.restoreHidden, false);
      assert.equal(entry.state.view, view);
      assert.deepEqual(entry.state.selection, selection);
    }
    assert.deepEqual(result.toolbarStates[0].state, result.toolbarStates[1].state);
    assert.equal(result.actions.filter(action => action.kind === 'event' && action.type === 'viewer-controls-change').length, 2);
    assert.deepEqual(result.actions.filter(action => action.kind === 'recenter'), []);
    assert.equal(mounts(result).length, 1);
    assert.deepEqual(result.errors, []);
  }
});


test('Coarse in Space delegates to Space without loading or switching a temporal view', () => {
  for (const data of [snapshot(true), snapshot(false)]) {
    const result = run({ view: 'space', data, steps: [{ coarse: true }] });
    assert.equal(result.coarseDisabled, false);
    assert.equal(result.state.view, 'space');
    assert.deepEqual(result.actions.filter((action) => action.kind === 'coarse'), [{ kind: 'coarse', surface: 'space' }]);
    assert.ok(!result.imports.includes('./view.js'));
  }
});
