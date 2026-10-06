import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { openingView, viewAddress } from '../viewer/public/view-settings.js';

// Execute real startup/address/session logic with the shared DOM and renderer fixture.
import { harness } from './helpers/viewer-start-harness.mjs';

function run(input) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', harness,
    new URL('../viewer/public/start.js', import.meta.url).href], {
    input: JSON.stringify({ ...input, chosenViewHarness: true, surfaceState: { temporal: {}, ...input.surfaceState } }), encoding: 'utf8', timeout: 10_000,
  }));
}
const chosen = (id, settings, extra = {}) => ({ id, settings, level: 0, levels: [], ...extra });
const oldView = chosen('v1', { view: 'together' }, { superseded: true });
const selection = { kind: 'event', id: 'event:kept' };
const time = { mode: 'story', now: 12, atEnd: false, start: 0, end: 30 };
function liveInput(settings, query = '') {
  return {
    url: `http://127.0.0.1:1234/token/?live&view=together&chosen=v1${query}`,
    data: { capabilities: { temporal: true, trajectories: true }, viewerLive: { mode: 'live' }, views: [oldView, chosen('v2', settings)] },
    liveContext: { state: { view: 'together', timeView: 'together', selection, time } },
  };
}
const activations = (result) => result.actions.filter((action) => action.kind === 'activate');

test('live refresh opens the newly chosen representation while retaining compatible reader context', () => {
  for (const view of ['graph', 'layers']) {
    const result = run(liveInput({ view }));
    assert.equal(result.opening.state, 'changed');
    assert.equal(result.state.view, view);
    assert.equal(new URL(result.url).searchParams.get('view'), view);
    assert.equal(new URL(result.url).searchParams.get('chosen'), 'v2');
    assert.deepEqual(activations(result)[0].state.selection, selection);
    assert.deepEqual(activations(result)[0].state.time, time);
    assert.equal(activations(result)[0].view, view);
    if (view === 'layers') assert.equal(result.state.timeView, 'layers');
    assert.deepEqual(result.errors, []);
  }
});

test('a changed view can use the normal default or capability fallback without replaying the old representation', () => {
  const defaults = liveInput({ show: 'notes' });
  defaults.liveContext.state.view = 'graph';
  assert.equal(run(defaults).state.view, 'together');
  const unsupported = liveInput({ view: 'terrain' });
  unsupported.data.capabilities = { temporal: false, trajectories: false };
  const result = run(unsupported);
  assert.equal(result.state.view, 'graph');
  assert.ok(!result.imports.includes('./view.js'));
});

test('a newly chosen time mode does not inherit an incompatible live cursor mode', () => {
  const input = liveInput({ view: 'layers', mode: 'construction', at: '2' }, '&mode=story&at=12');
  const result = run(input);
  assert.equal(new URL(result.url).searchParams.get('mode'), 'construction');
  assert.equal(new URL(result.url).searchParams.get('at'), '2');
  assert.equal(activations(result)[0].state.time, undefined);
  assert.deepEqual(activations(result)[0].state.selection, selection);
  const matching = run(liveInput({ view: 'layers', mode: 'story' }));
  assert.deepEqual(activations(matching)[0].state.time, time);
  const back = liveInput({ view: 'layers' }, '&mode=construction&at=2');
  back.liveContext.state.time = { mode: 'construction', tau: 2 };
  const story = run(back);
  assert.equal(activations(story)[0].state.time, undefined);
  assert.equal(new URL(story.url).searchParams.has('at'), false);
});

test('adjusted and own settings keep the live presentation and cursor when a new model view appears', () => {
  for (const own of [false, true]) {
    const input = liveInput({ view: 'layers', mode: 'construction' }, '&adjusted');
    if (own) input.url = input.url.replace('chosen=v1', 'chosen=none');
    input.liveContext.state.view = 'structure';
    const result = run(input);
    assert.equal(result.opening.state, own ? 'own' : 'adjusted');
    assert.equal(result.state.view, 'structure');
    assert.deepEqual(activations(result)[0].state.time, time);
    assert.deepEqual(result.state.selection, selection);
  }
});

test('chosen detail and view changes preserve the reader camera mode while resetting their place', () => {
  const view = chosen('detail', { view: 'together', camera: 'locked', at: '10' }, {
    levels: [{ label: 'More', settings: { show: 'processes,notes', camera: 'spin' } }],
  });
  for (const camera of ['free', 'locked', 'spin']) {
    const href = `http://localhost/token/?data=book&chosen=detail&camera=${camera}&pose=1,2,3,4,5,6&at=20&record=event:old&read`;
    for (const level of [0, 1, 2]) {
      const address = new URL(viewAddress(href, view, level));
      assert.equal(address.searchParams.get('camera'), camera, 'base, detail and Everything keep the reader mode, ignoring cameras in older recorded views');
      assert.equal(address.searchParams.get('data'), 'book');
      for (const key of ['pose', 'record', 'read']) assert.equal(address.searchParams.has(key), false, `${key} still resets when choosing a detail level`);
      assert.equal(address.searchParams.get('at'), level === 2 ? null : '10');
    }
    const next = new URL(viewAddress(href, chosen('new', { view: 'layers' })));
    assert.equal(next.searchParams.get('camera'), camera, 'explicitly selecting a new view also keeps the reader mode');
  }
  assert.equal(new URL(viewAddress('http://localhost/token/', view)).searchParams.has('camera'), false,
    'an absent reader preference stays absent; the recorded view cannot supply it');
});

test('refresh preserves reader time while explicit reset uses the model view default', () => {
  const view = chosen('timed', { view: 'together', at: '10', timeView: 'layers' });
  const href = 'http://localhost/token/?view=together&chosen=timed&at=20&timeView=terrain&pose=1,2,3,4,5,6&read';
  const refreshed = new URL(openingView(href, [view]).href);
  assert.equal(refreshed.searchParams.get('at'), '20');
  assert.equal(refreshed.searchParams.get('timeView'), 'terrain');
  assert.equal(refreshed.searchParams.get('pose'), '1,2,3,4,5,6');
  assert.ok(refreshed.searchParams.has('read'));
  assert.equal(new URL(viewAddress(href, view)).searchParams.get('at'), '10');
  assert.equal(new URL(openingView('http://localhost/token/', [view]).href).searchParams.get('at'), '10');
  const changed = openingView(href, [{ ...view, superseded: true }, chosen('v2', { view: 'layers', at: '5' })]);
  assert.equal(changed.state, 'changed');
  assert.equal(new URL(changed.href).searchParams.get('at'), '20');
  const construction = chosen('construction', { view: 'layers', mode: 'construction', at: '2' });
  assert.equal(new URL(viewAddress(href, construction, 0, { keepPlace: true })).searchParams.get('at'), '2');
  assert.equal(new URL(viewAddress(`${href}&mode=construction`, construction, 0, { keepPlace: true })).searchParams.get('at'), '20');
});

function graphInput(highlights, view = 'graph') {
  return { url: `http://127.0.0.1:1234/token/?chosen=graph-view&view=${view}`,
    data: { capabilities: { temporal: false, trajectories: false }, graph: { nodes: [{ id: 'note:one', text: 'A real note.' }] },
      views: [chosen('graph-view', { view })] }, highlights };
}

test('non-temporal highlights activate native records even when Graph is already selected', () => {
  const result = run({ ...graphInput([{ nodeId: 'note:one' }, { record: 'cut:cut:one' }, { record: 'event:event:one' }, { record: 'event_relation:link:one' }]),
    surfaceState: { graph: { graphCamera: { old: true }, graph: { records: 'overview' } } } });
  const reveals = activations(result).slice(1);
  assert.deepEqual(reveals.map((action) => action.state.selection), [
    { kind: 'narrative', id: 'note:one' }, { kind: 'normalized_cut', id: 'cut:one' },
    { kind: 'event', id: 'event:one' }, { kind: 'event_relation', id: 'link:one' },
  ]);
  assert.ok(reveals.every((action) => action.surface === 'graph' && !Object.hasOwn(action.state, 'graphCamera')));
  assert.deepEqual(result.state.selection, reveals.at(-1).state.selection);
  assert.equal(result.actions.filter((action) => action.kind === 'mount' && action.surface === 'graph').length, 1);
  assert.ok(!result.imports.includes('./view.js'));
  assert.deepEqual(result.errors, []);
});

test('a highlight switches from Structure to Graph and opens details after the renderer mounts', () => {
  const result = run(graphInput([{ nodeId: 'note:one' }], 'structure'));
  assert.equal(result.state.view, 'graph');
  assert.equal(activations(result).at(-1).surface, 'graph');
  assert.deepEqual(activations(result).at(-1).state.selection, { kind: 'narrative', id: 'note:one' });
});

test('a highlight remains inspectable through Structure when Graph cannot initialize', () => {
  const result = run({ ...graphInput([{ nodeId: 'note:one' }], 'structure'), graphError: true });
  assert.equal(result.state.view, 'structure');
  assert.equal(activations(result).at(-1).surface, 'structure');
  assert.deepEqual(activations(result).at(-1).state.selection, { kind: 'narrative', id: 'note:one' });
  assert.deepEqual(result.errors, ['WebGL absent']);
});

test('temporal models keep the time renderer highlight path', () => {
  const input = graphInput([{ nodeId: 'note:one' }]);
  input.data.capabilities = { temporal: true, trajectories: true };
  const result = run(input);
  assert.equal(result.state.view, 'together');
  assert.deepEqual(result.actions.filter((action) => action.kind === 'highlight'), [{ kind: 'highlight', surface: 'temporal', target: { nodeId: 'note:one' } }]);
});
