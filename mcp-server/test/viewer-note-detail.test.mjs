import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const mapping = source.slice(source.indexOf('const neighbours ='), source.indexOf('const noteLayer ='));
const visibility = source.split('\n').find((line) => line.startsWith('  for (const light of notes) light.visible ='));
assert.ok(mapping && visibility, 'the actual note attachment and visibility code must be present');
const light = (id, moments = [], time = 4) => ({ visible: false, position: { x: 1, y: 2, z: 3 }, scale: { setScalar() {} },
  userData: { id, t: time, born: { at: '2026-01-01T00:00:00.000Z' }, node: { category: 'thought' }, moments, color: '#ffffff' } });

function fixture() {
  const life = { id: 'life', start: 0 }, work = { id: 'work', start: null }, scene = { id: 'scene', start: 3 };
  const context = {
    data: { graph: { edges: [
      { source: 'person-note', target: { anchorKind: 'referent', anchor: 'person', event: null, home: 'life' } },
      { source: 'process-note', target: { anchorKind: 'process', anchor: 'process', event: null, home: 'work' } },
      { source: 'cut-note', target: { anchorKind: 'normalized_cut', anchor: 'cut', event: 'scene' } },
      { source: 'many-events-note', target: { anchorKind: 'event', event: 'life' } },
      { source: 'many-events-note', target: { anchorKind: 'event', event: 'scene' } },
      { source: 'indirect-note', target: { node: 'person-note' } },
    ] } },
    byId: new Map([life, work, scene].map((event) => [event.id, event])),
    push(map, key, value) { if (!map.has(key)) map.set(key, []); map.get(key).push(value); },
    notes: [light('person-note'), light('process-note'), light('cut-note', [scene]), light('many-events-note', [life, scene]), light('indirect-note')],
    selectedPart: null, opt: { edges: true, detailProjection: { eventIds: new Set(['life', 'work']) } },
    construction: false, now: 5, tau: Date.parse('2026-01-01T00:00:00.000Z'),
    bornAt: (record) => record.born?.at ? Date.parse(record.born.at) : -Infinity,
  };
  vm.createContext(context); vm.runInContext(`${mapping}\nthis.scopeEvents = noteScopeEvents; this.datedMoments = moments;`, context);
  context.applyVisibility = () => vm.runInContext(visibility, context);
  return context;
}

test('notes explicitly about a process or referent remain in scope without acquiring invented moment dates', () => {
  const context = fixture(); context.applyVisibility();
  assert.deepEqual(context.notes.map((note) => note.visible), [true, true, false, true, false]);
  assert.deepEqual([...context.scopeEvents.get('person-note')], ['life']);
  assert.deepEqual([...context.scopeEvents.get('process-note')], ['work']);
  assert.equal(context.datedMoments.has('person-note'), false);
  assert.equal(context.datedMoments.has('process-note'), false, 'an undated process home is not a world-time anchor');
  context.opt.detailProjection.eventIds.add('scene'); context.applyVisibility();
  assert.equal(context.notes[2].visible, true, 'a Cut note opens with its explicitly targeted Event');
  context.now = 2; context.applyVisibility();
  assert.ok(context.notes.every((note) => !note.visible), 'scope visibility cannot bypass the existing playback clock');
});

test('scope filtering retains the explicit selected-document exception but does not spread through every cognitive edge', () => {
  const context = fixture(); context.selectedPart = { unit: { id: 'indirect-note' } }; context.now = 0;
  context.applyVisibility();
  assert.equal(context.notes.at(-1).visible, true);
  assert.ok(context.notes.slice(0, -1).every((note) => !note.visible));
});

test('a note connected to a visible whole does not draw links to its collapsed detailed Events', () => {
  const context = fixture(); context.applyVisibility();
  const buffer = () => ({ calls: [], begin() { this.calls = []; }, add(...values) { this.calls.push(values); }, end() {} });
  const mind = {};
  Object.assign(context, { mind, mindLines: buffer(), noteLinks: buffer(), noteEdges: [], noteById: new Map(),
    selectedDocumentLabel: { parent: mind, visible: false }, terrain: { on: false }, lit: null,
    shownByPlay: () => true, meet: (event) => [{ x: event.start, y: 0, z: 0 }], color: (value) => value });
  const start = source.indexOf('function drawNotes('), end = source.indexOf('\n}', start);
  vm.runInContext(source.slice(start, end + 2), context);
  context.drawNotes();
  assert.equal(context.mindLines.calls.length, 1, 'only the visible whole receives a note link');
  context.opt.detailProjection.eventIds.add('scene'); context.applyVisibility(); context.drawNotes();
  assert.equal(context.mindLines.calls.length, 3, 'opening the Event restores both its direct note and its shared note link');
});
