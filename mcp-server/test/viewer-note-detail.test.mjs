import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const mapping = source.slice(source.indexOf('const neighbours ='), source.indexOf('const noteLayer ='));
const visibility = source.split('\n').find((line) => line.startsWith('  for (const light of notes) light.visible ='));
assert.ok(mapping && visibility, 'the actual note attachment and visibility code must be present');
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(point) { return this.set(point.x, point.y, point.z); }
}
const light = (id, moments = [], time = 4) => ({ visible: false, position: new Vector3(1, 2, 3), scale: { setScalar() {} },
  userData: { id, t: time, born: { at: '2026-01-01T00:00:00.000Z' }, node: { id, category: 'thought' }, moments, attached: [], color: '#ffffff' } });

function fixture() {
  const life = { id: 'life', start: 0 }, work = { id: 'work', start: null }, scene = { id: 'scene', start: 3 };
  const context = {
    madeAt: (born) => (born?.at ? Date.parse(born.at) : NaN), constructionByClock: true,
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
    selectedPart: null, pinnedTarget: null, opt: { noteLayout: 'overhead', allNoteAttachments: false, edges: true, detailProjection: { eventIds: new Set(['life', 'work']) } },
    construction: false, now: 5, tau: Date.parse('2026-01-01T00:00:00.000Z'), atEnd: true, playing: false,
    bornAt: (record) => record.born?.at ? Date.parse(record.born.at) : -Infinity,
  };
  vm.createContext(context); vm.runInContext(`${mapping}\nthis.scopeEvents = noteScopeEvents; this.datedMoments = moments;`, context);
  context.applyVisibility = () => vm.runInContext(visibility, context);
  return context;
}

function installPlacement(context) {
  Object.assign(context, { graphNodes: context.notes.map((note) => note.userData.node), LENGTH: 100,
    THREE: { Vector3 }, mindTop: () => ({ y: 10, z: -10 }), zBackNow: () => -20, zFrontNow: () => 40,
    generalNotesLabel: { visible: false, position: new Vector3() },
    shownByPlay: () => true, meet: (event) => [{ x: event.start, y: 0, z: 0 }] });
  vm.runInContext(source.slice(source.indexOf('const noteOrder ='), source.indexOf('function placeNotes(')), context);
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
  const context = fixture(); context.applyVisibility(); installPlacement(context);
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
  assert.equal(context.mindLines.calls.length, 2, 'each note has just one local attachment at rest');
  context.pinnedTarget = context.notes[3]; context.drawNotes();
  assert.equal(context.mindLines.calls.length, 3, 'a pinned generic note reveals both declared Event attachments');
  context.opt.detailProjection.eventIds.delete('scene'); context.applyVisibility(); context.drawNotes();
  assert.equal(context.mindLines.calls.length, 1, 'selection never reveals an attachment outside the active detail scope');
  context.pinnedTarget = null; context.opt.edges = false; context.drawNotes();
  assert.equal(context.mindLines.calls.length, 0, 'Edges off hides ordinary note attachments');
  context.lit = context.notes[3]; context.drawNotes();
  assert.equal(context.mindLines.calls.length, 1, 'hover retains the existing inspection exception when Edges is off');
});

test('Overhead notes float above the processes with exact Event X and nearby anchor Z', () => {
  const context = fixture(); installPlacement(context); context.opt.detailProjection = null;
  context.mindTop = () => ({ y: 80, z: -10 });
  context.meet = (event) => [{ x: event.start * 10, y: 20, z: 30 }, { x: event.start * 10, y: 50, z: 60 }];
  const many = context.notes[3], indirect = context.notes[4], undated = context.notes[1];
  context.positionNote(many);
  assert.equal(many.position.x, 30, 'the representative declared Event retains its exact time coordinate');
  assert.ok(many.position.y >= context.mindTop().y, 'notes must sit above the process field, not beside an individual low crest');
  assert.ok(Math.abs(many.position.z - 30) < 6, 'depth stays aligned with the actual attached process row');
  const first = { ...many.position }; context.positionNote(many);
  assert.deepEqual({ ...many.position }, first, 'the modest display stagger is deterministic');
  for (const note of [indirect, undated]) {
    context.positionNote(note);
    assert.ok(note.position.y > context.mindTop().y, 'unplaced documents occupy the general overhead area');
    assert.ok(note.position.x > -context.LENGTH / 2 && note.position.x < context.LENGTH / 2);
    assert.equal(note.userData.localAnchor, null);
    assert.equal(note.userData.t, 4, 'display placement must not rewrite the existing playback schedule');
  }
  assert.notEqual(indirect.position.x, undated.position.x, 'general documents spread across X instead of forming a side column');
  context.shownByPlay = (time) => time < 3; context.positionNote(many);
  assert.equal(many.position.x, 0, 'an unreached Event cannot become the representative anchor');
});

test('Centered notes stay over the middle of the model while retaining exact Event times and declared targets', () => {
  const context = fixture();
  const anchored = Array.from({ length: 64 }, (_, index) => light(`anchored-${index}`, [
    { id: `event-${index}`, start: index < 48 ? 3 : 7, anchorZ: index % 2 ? -20 : 40 },
  ]));
  const general = Array.from({ length: 80 }, (_, index) => light(`general-${index}`));
  context.notes = [...anchored, ...general]; installPlacement(context);
  Object.assign(context.opt, { noteLayout: 'centered', detailProjection: null });
  context.mindTop = () => ({ y: 80, z: -29 });
  context.meet = (event) => [{ x: event.start * 10, y: 20, z: event.anchorZ }];
  const before = JSON.stringify(context.notes.map((note) => ({ node: note.userData.node, moments: note.userData.moments, t: note.userData.t })));
  const place = () => { const occupied = new Map(); context.notes.forEach((note) => context.positionNote(note, occupied)); };
  place();
  const middle = (context.zBackNow() + context.zFrontNow()) / 2;
  const centralHalf = (context.zFrontNow() - context.zBackNow()) / 4;
  for (const note of anchored) {
    const event = note.userData.moments[0];
    assert.equal(note.position.x, event.start * 10, 'centering changes depth, never Event time');
    assert.ok(note.position.y > context.mindTop().y);
    assert.ok(Math.abs(note.position.z - middle) <= centralHalf, 'anchored notes stay in the model’s central depth band');
    assert.equal(note.userData.localAnchor.event, event);
    assert.equal(note.userData.localAnchor.point.z, event.anchorZ, 'the attachment target remains at the declared process, away from the centered display position');
  }
  assert.notDeepEqual({ ...anchored[0].position }, { ...anchored[1].position }, 'different process anchors at the same Event X share collision packing');
  assert.equal(new Set(context.notes.map((note) => JSON.stringify(note.position))).size, context.notes.length, 'both crowded anchors and unplaced notes have distinct slots');
  for (const note of general) {
    assert.ok(note.position.y > context.mindTop().y);
    assert.ok(Math.abs(note.position.z - middle) <= centralHalf, 'general notes also use the centered depth band');
    assert.equal(note.userData.localAnchor, null);
    assert.equal(note.userData.moments.length, 0);
    assert.equal('start' in note.userData.node, false);
  }
  const coordinates = context.notes.map((note) => JSON.stringify(note.position)); place();
  assert.deepEqual(context.notes.map((note) => JSON.stringify(note.position)), coordinates);
  assert.equal(JSON.stringify(context.notes.map((note) => ({ node: note.userData.node, moments: note.userData.moments, t: note.userData.t }))), before, 'centering does not alter graph records or playback timing');
});

test('Original reproduces the live category bands and keeps its layout when switching back', () => {
  const context = fixture(); installPlacement(context); context.opt.noteLayout = 'original';
  context.notes[2].userData.node.category = 'passage';
  Object.assign(context, { F: { a: 0, b: 5 }, xOf: (time) => time * 20 - 50, timeAtX: (x) => (x + 50) / 20,
    noteLayer: (node) => node.category === 'passage' ? 5 : 0 });
  const start = source.indexOf('function placeNotes('), end = source.indexOf('\n}', start);
  vm.runInContext(source.slice(start, end + 2), context);
  context.placeNotes();
  assert.deepEqual({ ...context.notes[2].position }, { x: 10, y: 18, z: -21 }, 'dated prose retains its original category band');
  assert.deepEqual({ ...context.notes[3].position }, { x: 10, y: 10, z: -10 }, 'a many-Event thought uses the live median Event X and thought band');
  const unplaced = [context.notes[0], context.notes[1], context.notes[4]];
  unplaced.forEach((note, index) => {
    assert.ok(Math.abs(note.position.x - (-50 + (index + 0.5) / 3 * 100)) < 1e-9);
    assert.equal(note.position.y, 10); assert.equal(note.position.z, -10);
  });
  const original = context.notes.map((note) => ({ position: { ...note.position }, time: note.userData.t }));
  for (const layout of ['nearby', 'overhead', 'centered', 'original']) {
    context.opt.noteLayout = layout; const occupied = new Map();
    context.notes.forEach((note) => context.positionNote(note, occupied));
    assert.deepEqual(context.notes.map((note) => note.userData.t), original.map((note) => note.time), 'layout selection cannot alter playback scheduling');
  }
  assert.deepEqual(context.notes.map((note) => ({ ...note.position })), original.map((note) => note.position));
});

test('Nearby retains the earlier local-crest layout and separate general-note margin', () => {
  const context = fixture(); installPlacement(context); context.opt.noteLayout = 'nearby'; context.opt.detailProjection = null;
  context.mindTop = () => ({ y: 80, z: -10 });
  context.meet = (event) => [{ x: event.start * 10, y: 20, z: 30 }];
  const anchored = context.notes[3], general = context.notes[1];
  context.positionNote(anchored); context.positionNote(general);
  assert.equal(anchored.position.x, 30);
  assert.ok(anchored.position.y > 20 && anchored.position.y < 24, 'Nearby stays beside the crest rather than moving to the overhead plane');
  assert.ok(anchored.position.z > 30 && anchored.position.z < 34);
  assert.equal(general.position.x, -55, 'general notes keep the first prototype’s margin outside the time axis');
  assert.equal(general.userData.localAnchor, null); assert.equal(general.userData.t, 4);
});

test('choosing a note layout preserves playback, selection and the model graph', () => {
  const context = fixture(); installPlacement(context);
  const selectedPart = { unit: { id: 'held-selection' } }, before = JSON.stringify(context.data);
  const buffer = () => ({ begin() {}, add() {}, end() {} }), mind = {}, saves = [];
  Object.assign(context, { F: { a: 0, b: 5 }, xOf: (time) => time * 20 - 50, timeAtX: (x) => (x + 50) / 20,
    noteLayer: () => 0, selectedPart, playing: true, atEnd: false, now: 2.25, tau: 123456,
    mind, mindLines: buffer(), noteLinks: buffer(), noteEdges: [], noteById: new Map(), lit: null, terrain: { on: false },
    selectedDocumentLabel: { parent: mind, visible: false }, color: (value) => value,
    syncPanel() {}, syncURL: (immediate) => saves.push(immediate), fitLocked() { throw Error('A free camera must not be reset'); } });
  context.opt.camera = 'free'; context.opt.noteLayout = 'original'; context.opt.allNoteAttachments = true;
  for (const name of ['placeNotes', 'drawNotes', 'setNoteLayout']) {
    const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
    vm.runInContext(source.slice(start, end + 2), context);
  }
  for (const layout of ['nearby', 'overhead', 'centered', 'original']) {
    context.setNoteLayout(layout);
    assert.equal(context.opt.noteLayout, layout);
    assert.equal(context.opt.allNoteAttachments, true, 'placement choices must preserve the independent attachment preference');
    assert.equal(context.selectedPart, selectedPart);
    assert.deepEqual([context.now, context.tau, context.playing, context.atEnd], [2.25, 123456, true, false]);
    assert.equal(JSON.stringify(context.data), before, 'display choices cannot mutate declared graph content');
  }
  assert.deepEqual(saves, [true, true, true, true]);
  assert.equal(context.extrasDirty, true, 'changing note placement also refreshes optional prose markers');
  context.setNoteLayout('invalid');
  assert.equal(context.opt.noteLayout, 'original'); assert.equal(saves.length, 4);
});

test('Centered keeps optional prose markers and labels together without changing their time or filtering', () => {
  const context = fixture(); installPlacement(context);
  const start = source.indexOf('  // Prose: each part of the story over the moments it tells.');
  const end = source.indexOf('  drawSelectedStoryLinks();', start);
  const labelCode = source.split('\n').find((line) => line.startsWith("    if (opt.show.has('prose'))"));
  assert.ok(start >= 0 && end > start && labelCode);
  const event = { id: 'scene', start: 3 }, unit = { id: 'page', t: 3, tells: [{ eventId: 'scene' }], title: 'A page' };
  const marks = [], links = [];
  Object.assign(context, { prose: [unit], byId: new Map([['scene', event]]), left: -50, right: 50, X: (time) => time * 10,
    chips: { quad(...args) { marks.push(args); } }, proseLines: { add(...args) { links.push(args); } },
    extraTargets: [], wanted: [], litUnit: null, color: (value) => value, esc: (value) => value,
    anchor: () => ({ x: 30, y: 1, z: 40 }), shownByPlay: (time) => time <= context.now });
  Object.assign(context.opt, { show: new Set(['prose']), detailProjection: null });
  for (const noteLayout of ['original', 'nearby', 'overhead', 'centered']) {
    context.opt.noteLayout = noteLayout; marks.length = 0; links.length = 0; context.wanted.length = 0; context.extraTargets.length = 0;
    vm.runInContext(source.slice(start, end), context); vm.runInContext(labelCode, context);
    const expectedZ = noteLayout === 'centered' ? 10 : -6;
    assert.equal(marks.length, 1); assert.equal(marks[0][6], expectedZ);
    assert.equal(context.wanted[0].p[2], expectedZ, 'the text label and its marker share the same depth');
    assert.equal(context.extraTargets[0].wpt[0], 30); assert.equal(context.wanted[0].p[0], 30);
    assert.equal(links[0][2], expectedZ); assert.equal(links[0][5], 40, 'only the displayed prose moves; its target stays fixed');
  }
  for (const hidden of ['future', 'outside detail']) {
    context.now = hidden === 'future' ? 2 : 5;
    context.opt.detailProjection = hidden === 'outside detail' ? { eventIds: new Set() } : null;
    marks.length = 0; context.wanted.length = 0;
    vm.runInContext(source.slice(start, end), context); vm.runInContext(labelCode, context);
    assert.equal(marks.length, 0); assert.equal(context.wanted.length, 0, hidden);
  }
  assert.deepEqual(unit, { id: 'page', t: 3, tells: [{ eventId: 'scene' }], title: 'A page' });
});

test('repeated notes spread without coincident packing or invented moment dates', () => {
  const context = fixture(), event = { id: 'scene', start: 3 };
  const anchored = Array.from({ length: 64 }, (_, i) => light(`anchored-${i}`, [event]));
  const general = Array.from({ length: 120 }, (_, i) => light(`general-${i}`));
  context.notes = [...anchored, ...general]; installPlacement(context); context.opt.detailProjection = null;
  context.meet = () => [{ x: 30, y: 2, z: 15 }];
  const place = () => { const occupied = new Map(); for (const note of context.notes) context.positionNote(note, occupied); };
  place();
  const coordinates = context.notes.map((note) => JSON.stringify(note.position));
  assert.equal(new Set(coordinates).size, context.notes.length, 'many notes sharing an anchor and many general notes must each have a distinct display position');
  assert.ok(anchored.every((note) => note.position.x === 30 && note.position.y >= context.mindTop().y));
  assert.ok(anchored.every((note) => Math.abs(note.position.z - 15) < 15), 'crowded notes retain the same process neighborhood in depth');
  const xs = general.map((note) => note.position.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > context.LENGTH * 0.8, 'general notes use the overhead width');
  assert.ok(general.every((note) => note.position.y > context.mindTop().y && note.userData.localAnchor === null));
  assert.ok(general.every((note) => note.userData.moments.length === 0 && note.userData.t === 4 && !('start' in note.userData.node)), 'display slots never become declared dates or alter playback reveal times');
  place();
  assert.deepEqual(context.notes.map((note) => JSON.stringify(note.position)), coordinates, 'redrawing preserves the same packing');
});

for (const noteLayout of ['overhead', 'centered']) test(`${noteLayout} document links appear only while a visible endpoint is hovered or pinned`, () => {
  const context = fixture(); installPlacement(context); context.opt.detailProjection = null; context.applyVisibility();
  context.opt.noteLayout = noteLayout;
  const buffer = () => ({ calls: [], begin() { this.calls = []; }, add(...values) { this.calls.push(values); }, end() {} });
  const mind = {};
  Object.assign(context, { mind, mindLines: buffer(), noteLinks: buffer(), noteEdges: [['person-note', 'indirect-note']],
    noteById: new Map(context.notes.map((note) => [note.userData.id, note])),
    selectedDocumentLabel: { parent: mind, visible: false }, terrain: { on: false }, lit: null, color: (value) => value });
  const start = source.indexOf('function drawNotes('), end = source.indexOf('\n}', start);
  vm.runInContext(source.slice(start, end + 2), context);
  context.drawNotes(); assert.equal(context.noteLinks.calls.length, 0);
  assert.equal(context.generalNotesLabel.visible, true, 'visible unplaced notes label their overhead area');
  if (noteLayout === 'centered') assert.ok(Math.abs(context.generalNotesLabel.position.z - 10) <= 15, 'the general-note label follows the centered display band');
  context.lit = context.notes[4]; context.drawNotes(); assert.equal(context.noteLinks.calls.length, 1);
  context.lit = null; context.pinnedTarget = context.notes[0]; context.drawNotes(); assert.equal(context.noteLinks.calls.length, 1);
  context.opt.edges = false; context.drawNotes(); assert.equal(context.noteLinks.calls.length, 1, 'pinned inspection follows the same Edges exception as moment links');
  context.notes[4].visible = false; context.drawNotes(); assert.equal(context.noteLinks.calls.length, 0, 'inspection cannot reveal a hidden endpoint');
  context.notes.forEach((note) => { note.visible = false; }); context.drawNotes();
  assert.equal(context.generalNotesLabel.visible, false, 'the general label disappears when its notes are hidden');
});

test('Original retains all pale Event and document edges at rest and the live Edges switch behavior', () => {
  const context = fixture(); installPlacement(context); context.opt.noteLayout = 'original'; context.opt.detailProjection = null;
  context.notes.forEach((note) => { note.userData.originalPosition = new Vector3(1, 2, 3); }); context.applyVisibility();
  const buffer = () => ({ calls: [], begin() { this.calls = []; }, add(...values) { this.calls.push(values); }, end() {} });
  const mind = {};
  Object.assign(context, { mind, mindLines: buffer(), noteLinks: buffer(), noteEdges: [['person-note', 'indirect-note']],
    noteById: new Map(context.notes.map((note) => [note.userData.id, note])),
    selectedDocumentLabel: { parent: mind, visible: false }, terrain: { on: false }, lit: null, color: (value) => value });
  const start = source.indexOf('function drawNotes('), end = source.indexOf('\n}', start);
  vm.runInContext(source.slice(start, end + 2), context);
  context.drawNotes();
  assert.equal(context.mindLines.calls.length, 3, 'all three declared Event attachments are visible without hovering');
  assert.ok(context.mindLines.calls.every((call) => call[7] === 0.13));
  assert.equal(context.noteLinks.calls.length, 1); assert.equal(context.noteLinks.calls[0][7], 0.16);
  assert.equal(context.generalNotesLabel.visible, false, 'Original never displays the new general-note area label');
  context.opt.edges = false; context.drawNotes();
  assert.equal(context.mindLines.calls.length, 0); assert.equal(context.noteLinks.calls.length, 0);
  context.lit = context.notes[3]; context.drawNotes();
  assert.equal(context.mindLines.calls.length, 2, 'hover retains the original direct-attachment inspection exception');
  assert.equal(context.noteLinks.calls.length, 0, 'Original document links obey Edges off even when an endpoint is hovered');
});

test('All attachments shows Event, process, referent and document links at rest in every note layout', () => {
  for (const noteLayout of ['original', 'nearby', 'overhead', 'centered']) {
    const context = fixture(); installPlacement(context); Object.assign(context.opt, { noteLayout, allNoteAttachments: true, detailProjection: null });
    context.notes.forEach((note) => { note.userData.originalPosition = new Vector3(1, 2, 3); note.userData.t = 0; });
    context.notes[0].userData.attached = [{ kind: 'referent', id: 'person' }];
    context.notes[1].userData.attached = ['process', 'future-process', 'hidden-process', 'expired-process', 'unsampled-process'].map((id) => ({ kind: 'process', id }));
    const rows = [
      { measure: { id: 'process', points: [{ t: 0 }, { t: 8 }] }, points: [{ t: 3 }, { t: 4 }], group: { id: 'person', hue: '#112233' }, home: 'work', start: 3, shown: true },
      { measure: { id: 'future-process', points: [{ t: 10 }, { t: 11 }] }, group: { id: 'person', hue: '#112233' }, home: 'future', start: 10, shown: true },
      { measure: { id: 'hidden-process', points: [{ t: 0 }, { t: 8 }] }, group: { id: 'hidden', hue: '#112233' }, home: 'hidden', start: 0, shown: false },
      { measure: { id: 'expired-process', points: [{ t: -5 }, { t: -1 }] }, group: { id: 'expired', hue: '#112233' }, home: 'expired', start: -5, shown: true },
      { measure: { id: 'unsampled-process', points: [] }, group: { id: 'unsampled', hue: '#112233' }, home: 'unsampled', start: 0, shown: true },
    ];
    const buffer = () => ({ calls: [], begin() { this.calls = []; }, add(...values) { this.calls.push(values); }, end() {} }), mind = {};
    Object.assign(context, { mind, mindLines: buffer(), noteLinks: buffer(), noteEdges: [['person-note', 'indirect-note']],
      noteById: new Map(context.notes.map((note) => [note.userData.id, note])), selectedDocumentLabel: { parent: mind, visible: false },
      terrain: { on: false }, lit: null, color: (value) => value, WHITE: '#fff', F: { a: 0, b: 20 }, X: (time) => time,
      timeAtX: () => 1, rows, rowOf: new Map(rows.map((row) => [row.measure.id, row])),
      presence: (row) => Number(row.shown), frontOf: (own) => own.at(-1), rowAt: () => ({ y: 1, z: 2 }), heightAt: () => 3,
      rowValue: (row, time) => time >= row.start ? 1 : null, ownerOf: () => null,
      shownByPlay: (time) => time <= context.now });
    const start = source.indexOf('function drawNotes('), end = source.indexOf('\n}', start);
    vm.runInContext(source.slice(start, end + 2), context);
    context.applyVisibility(); context.drawNotes();
    assert.equal(context.mindLines.calls.length, 5, `${noteLayout}: three Event anchors plus explicit process and referent links need no hover`);
    const processLinks = context.mindLines.calls.filter((call) => call.length === 9);
    assert.equal(processLinks.length, 2, 'a referent whose front row is future-only still attaches to its available back row');
    assert.ok(processLinks.every((call) => call[3] === 4), 'process/referent links use the last visible sample at t=4, independent of note X=1 and current t=5');
    assert.equal(context.noteLinks.calls.length, 1, `${noteLayout}: document links need no hover`);
    context.opt.edges = false; context.drawNotes();
    assert.equal(context.mindLines.calls.length, 0, 'Edges off hides the at-rest attachment expansion');
    assert.equal(context.noteLinks.calls.length, 0);
    context.opt.edges = true; context.opt.detailProjection = { eventIds: new Set(['life', 'work']) };
    context.applyVisibility(); context.drawNotes();
    assert.equal(context.mindLines.calls.length, 3, 'collapsed Event detail, hidden rows and unavailable future values stay excluded');
    assert.equal(context.noteLinks.calls.length, 0, 'an out-of-scope document endpoint stays hidden');
    context.opt.detailProjection = null; context.now = 2; context.notes[4].userData.t = 10;
    context.applyVisibility(); context.drawNotes();
    assert.equal(context.mindLines.calls.length, 1, 'future Events, pre-first process samples and expired curves stay hidden while their note is already visible');
    assert.equal(context.noteLinks.calls.length, 0, 'a future document endpoint stays hidden');
  }
});

test('All attachments enables visible links without changing note placement, time, selection or graph content', () => {
  for (const noteLayout of ['original', 'nearby', 'overhead', 'centered']) {
    const context = fixture(), selectedPart = { unit: { id: 'held' } }, before = JSON.stringify(fixture().data), saves = [];
    let visibilityChanges = 0;
    Object.assign(context.opt, { noteLayout, edges: false, show: new Set(['events']) });
    Object.assign(context, { selectedPart, now: 2.25, tau: 123456, playing: true, atEnd: false,
      showThoughts: (on) => { visibilityChanges += 1; if (on) context.opt.show.add('notes'); else context.opt.show.delete('notes'); },
      setEdges: (on) => { context.opt.edges = on; }, drawNotes() {}, syncPanel() {}, syncURL: (immediate) => saves.push(immediate) });
    const start = source.indexOf('function setAllNoteAttachments('), end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, 'the actual all-attachments control must exist');
    vm.runInContext(source.slice(start, end + 2), context);
    context.setAllNoteAttachments(true);
    assert.equal(context.opt.allNoteAttachments, true); assert.equal(context.opt.edges, true); assert.ok(context.opt.show.has('notes'));
    context.setAllNoteAttachments(false);
    assert.equal(context.opt.allNoteAttachments, false); assert.equal(context.opt.edges, true); assert.ok(context.opt.show.has('notes'), 'turning the expansion off leaves normal notes visible');
    assert.deepEqual([...context.opt.show], ['events', 'notes'], 'unrelated layer choices are retained');
    context.setAllNoteAttachments(true);
    assert.equal(visibilityChanges, 1, 'notes that are already visible do not receive an unnecessary visibility override');
    assert.equal(context.opt.noteLayout, noteLayout); assert.equal(context.selectedPart, selectedPart);
    assert.deepEqual([context.now, context.tau, context.playing, context.atEnd], [2.25, 123456, true, false]);
    assert.equal(JSON.stringify(context.data), before); assert.ok(saves.every(Boolean));
  }
});

test('note anchors never invent an attachment to an unrelated participant process', () => {
  const group = { id: 'person' };
  const context = { F: { a: 0, b: 10 }, opt: { noteLayout: 'overhead', allNoteAttachments: false }, THREE: { Vector3 }, xOf: (time) => time * 10,
    rowsForEvent: () => [], nearestShown: () => null, nodeAt: () => ({ y: 4, z: 6 }), BAR: 0.3,
    principals: [{ id: 'person' }], groups: [group], rows: [{ group }], presence: () => 1, rowAt: () => ({ y: 9, z: 9 }) };
  vm.createContext(context);
  vm.runInContext(`${source.slice(source.indexOf('const meet ='), source.indexOf('const noteOrder ='))}\nthis.meet = meet;`, context);
  assert.equal(context.meet({ id: 'scene', start: 3, participants: ['person'] }).length, 0);
  context.opt.allNoteAttachments = true;
  for (const layout of ['original', 'nearby', 'overhead', 'centered']) {
    context.opt.noteLayout = layout;
    assert.equal(context.meet({ id: 'scene', start: 3, participants: ['person'] }).length, 0, 'All uses only declared anchors in every layout, including Original');
  }
  context.nearestShown = () => ({ id: 'scene' });
  assert.deepEqual({ ...context.meet({ id: 'scene', start: 3 })[0] }, { x: 30, y: 4.3, z: 6 });
  assert.equal(context.meet({ id: 'edge', start: -0.1 })[0].x, -1, 'a moment just outside the window must not acquire the window boundary as its date');
});

test('all note layouts handle generic models without principals or narrative passages', () => {
  const context = { F: { a: 0, b: 10 }, opt: { noteLayout: 'original', layout: 'together' }, THREE: { Vector3 },
    xOf: (time) => time * 10, rowsForEvent: () => [], nearestShown: () => null,
    principals: [], groups: [], rows: [], nodeAt: () => ({ y: 4, z: 6 }), BAR: 0.3 };
  vm.createContext(context);
  vm.runInContext(`${source.slice(source.indexOf('const meet ='), source.indexOf('const noteOrder ='))}\nthis.meet = meet;`, context);
  for (const layout of ['original', 'nearby', 'overhead', 'centered']) {
    context.opt.noteLayout = layout;
    assert.equal(context.meet({ id: 'native-event', start: 3 }).length, 0, `${layout} has no invented principal/process fallback`);
    context.nearestShown = () => ({ id: 'native-event' });
    assert.deepEqual({ ...context.meet({ id: 'native-event', start: 3 })[0] }, { x: 30, y: 4.3, z: 6 });
    context.nearestShown = () => null;
  }
  context.notes = [light('generic-note', [{ id: 'native-event', start: 3 }]), light('unplaced-note')];
  installPlacement(context);
  context.opt.noteLayout = 'centered'; context.bornAt = () => -Infinity;
  context.nearestShown = () => ({ id: 'native-event' });
  const occupied = new Map(); context.notes.forEach((note) => context.positionNote(note, occupied));
  assert.equal(context.notes[0].position.x, 30);
  assert.equal(context.notes[0].userData.localAnchor.event.id, 'native-event');
  assert.equal(context.notes[1].userData.localAnchor, null);
  assert.ok(context.notes.every((note) => Number.isFinite(note.position.x) && note.position.y > context.mindTop().y && Math.abs(note.position.z - 10) <= 15));
});

test('On floors stands each document on the floor of what it belongs to without inventing dates', () => {
  const context = fixture(); installPlacement(context);
  const floor = { life: { id: 'life', depth: 1, y: 0, z: 0, t0: 0 }, work: { id: 'work', depth: 2, y: -3, z: 2, t0: 1 }, scene: { id: 'scene', depth: 3, y: -6, z: 4, t0: 3 } };
  Object.assign(context, { F: { a: 0, b: 10 }, BAR: 0.3, X: (time) => time * 10, NAMES: {}, rowOf: new Map(),
    noteById: new Map(context.notes.map((note) => [note.userData.id, note])),
    nearestShown: (id) => floor[id] ?? null, nodeAt: (node) => ({ y: node.y, z: node.z }),
    anchor: (id, time) => floor[id] ? { x: time * 10, y: floor[id].y + 0.3, z: floor[id].z, node: floor[id] } : null });
  Object.assign(context.opt, { noteLayout: 'floors', detailProjection: null });
  const place = () => { const homes = context.floorHomes(), occupied = new Map(); for (const note of context.notes) context.positionNote(note, occupied, null, homes); };
  place();
  const [person, process, cut, many, indirect] = context.notes;
  assert.deepEqual({ ...cut.position }, { x: 29.5, y: -4.8, z: 3.55 }, 'a note about a dated moment stands on that Event\'s floor at its time');
  assert.equal(cut.userData.localAnchor.event.id, 'scene');
  assert.equal(many.userData.floorHome.event.id, 'scene', 'a note about several moments stands at the deepest of them');
  assert.deepEqual({ ...many.position }, { x: 30, y: -4.8, z: 3.55 }, 'notes sharing a spot share its grid');
  assert.equal(person.userData.floorHome.kind, 'slot'); assert.equal(person.userData.localAnchor, null);
  assert.deepEqual({ ...person.position }, { x: -0.5, y: 1.2, z: -0.45 }, 'an undated person note stands where its home Event begins');
  assert.deepEqual([process.position.x, process.position.y, process.position.z].map((value) => Math.round(value * 1e6) / 1e6), [9.5, -1.8, 1.55], 'an undated process note stands on its home Event\'s floor');
  assert.equal(indirect.userData.floorHome.kind, 'beside'); assert.equal(indirect.userData.floorHome.beside.id, 'person-note');
  assert.deepEqual({ ...indirect.position }, { x: 0, y: 1.2, z: -0.45 }, 'a note that only links stands beside the note it links to');
  assert.ok(context.notes.every((note) => note.userData.t === 4), 'placement never changes when a note appears');
  // The first layout reads every note before placing any, since a note may stand beside one read after it.
  const before = context.notes.map((note) => ({ ...note.position }));
  for (const note of context.notes) delete note.userData.moments;
  Object.assign(context, { xOf: (time) => time * 10, timeAtX: (x) => x / 10, noteLayer: () => 0 });
  const start = source.indexOf('function placeNotes('), end = source.indexOf('\n}', start);
  vm.runInContext(source.slice(start, end + 2), context);
  context.placeNotes();
  assert.deepEqual(context.notes.map((note) => ({ ...note.position })), before, 'the first layout places on floors exactly as a redraw does');
  context.nearestShown = (id) => id === 'life' ? null : floor[id] ?? null;
  place();
  assert.equal(person.userData.floorHome, null); assert.equal(indirect.userData.floorHome, null);
  assert.equal(person.position.x, -55, 'a note attached to nothing shown keeps the general margin outside the time axis');
});

test('Hide undated notes leaves only notes about a dated Event, and keeps a selected document', () => {
  const context = fixture(); context.opt.detailProjection = null;
  context.applyVisibility();
  assert.deepEqual(context.notes.map((note) => note.visible), [true, true, true, true, true]);
  context.opt.hideUndated = true; context.applyVisibility();
  assert.deepEqual(context.notes.map((note) => note.visible), [false, false, true, true, false]);
  context.selectedPart = { unit: { id: 'indirect-note' } }; context.applyVisibility();
  assert.equal(context.notes[4].visible, true, 'the selected document stays');
});

test('while the years play, a document whose place is still to come waits for the playhead', () => {
  const context = fixture(); installPlacement(context);
  Object.assign(context, { xOf: (time) => time * 10, now: 3, atEnd: false, playing: true });
  const waits = (x) => vm.runInContext(`waitsForPlayhead(${x})`, context);
  assert.equal(waits(30.5), false, 'a light at the playhead shows');
  assert.equal(waits(40), true, 'a light years ahead waits');
  context.playing = false; assert.equal(waits(40), true, 'paused mid-way, the future stays empty');
  context.atEnd = true; assert.equal(waits(40), false, 'the whole view at rest shows every light');
  context.atEnd = false; context.opt.mode = 'construction'; assert.equal(waits(40), false, 'the construction replays by when things were made, not by world time');
});
