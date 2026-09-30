import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildViewerData } from '../src/viewer-data.mjs';
import { unopenedProcessEvents } from '../viewer/public/process-visibility.js';

function snapshot() {
  return { events: [], people: [], measures: [], processes: [], numerics: { cuts: [], scalarRecords: [] },
    inspection: { model: { processes: [], meaning_model: { events: [], event_relations: [], normalized_cuts: [] } } } };
}

function addSlot(data, id, { role = 'slow', semanticRole = 'person_is_process', initialValue, ...eventFields } = {}) {
  const processId = `quantity:${id}`;
  const process = { id: processId, scale: semanticRole ? { semantic_role: semanticRole } : {},
    initial_value: initialValue ?? { kind: 'graph', value: { nodes: [], edges: [] } } };
  const event = { id, processIds: [processId], role, ...eventFields };
  data.inspection.model.processes.push(process);
  data.inspection.model.meaning_model.events.push({ id, process_ids: [processId] });
  data.events.push(event);
  return { process, event };
}

function addEvent(data, id, fields = {}) {
  data.events.push({ id, ...fields });
  data.inspection.model.meaning_model.events.push({ id });
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

test('only declared concurrent process slots are candidates, independent of their names or descriptions', () => {
  const data = snapshot();
  addSlot(data, 'A/17', { role: 'event' });
  const concurrent = addSlot(data, 'B/19', { role: 'event', semanticRole: null });
  concurrent.process.scale.relationship = 'concurrent_non_summing';
  addSlot(data, 'C/23', { semanticRole: null });
  addSlot(data, 'D/29', { role: 'event', semanticRole: null });
  data.people.push({ id: 'arbitrary-owner', processes: [{ eventId: 'D/29', opened: 0 }] });
  addSlot(data, 'ordinary.is.body', { role: 'event', semanticRole: null,
    label: 'Unopened body process', description: 'An empty concurrent process with no modeling.' });
  data.events.find((event) => event.id === 'A/17').description = 'A deeply developed process with extensive knowledge.';
  assert.deepEqual([...unopenedProcessEvents(data)].sort(), ['A/17', 'B/19', 'C/23', 'D/29']);
});

test('phase, lifecycle, relationship and context records remain visible even when listed in a process inventory', () => {
  const data = snapshot();
  const roles = ['phase', 'arc', 'life', 'world', 'inner'];
  for (const role of roles) addSlot(data, `role:${role}`, { role });
  const semanticRoles = ['person_lifecycle_index', 'thing_lifecycle_index', 'joint_relationship_process', 'change_arc_process', 'change_arc_phase_process'];
  for (const semanticRole of semanticRoles) addSlot(data, `semantic:${semanticRole}`, { semanticRole });
  data.people.push({ id: 'inventory', processes: data.events.map((event) => ({ eventId: event.id, opened: 0 })) });
  assert.equal(unopenedProcessEvents(data).size, 0);
});

test('a qualitative life period stays visible when its duration puts it in the process inventory', () => {
  const data = snapshot();
  addEvent(data, 'life-period', { role: 'period', start: 1, end: 90,
    description: 'Childhood, training, and entry into a profession.' });
  data.people.push({ id: 'person', processes: [{ eventId: 'life-period', opened: 0 }] });
  addSlot(data, 'unopened-slot');
  assert.deepEqual([...unopenedProcessEvents(data)], ['unopened-slot'], 'a period is not an empty concurrent process slot');
});

test('native and projected child Events preserve a process independently of drawing depth', () => {
  const data = snapshot();
  addSlot(data, 'native-parent'); addSlot(data, 'projected-parent'); addSlot(data, 'empty-parent');
  addEvent(data, 'native-child', { depth: 900 });
  addEvent(data, 'projected-child', { parent: 'projected-parent', depth: 900 });
  data.inspection.model.meaning_model.event_relations.push({ kind: 'contains', source_event_id: 'native-parent', target_event_id: 'native-child' });
  assert.deepEqual([...unopenedProcessEvents(data)], ['empty-parent']);
});

test('an Event that develops the same process is never mistaken for an unopened process branch', () => {
  for (const projectedHome of [false, true]) {
    const data = snapshot();
    const slot = addSlot(data, 'branch');
    addEvent(data, 'development', { parent: 'branch', role: 'event', processIds: [slot.process.id] });
    data.inspection.model.meaning_model.events.find((event) => event.id === 'development').process_ids = [slot.process.id];
    data.inspection.model.meaning_model.event_relations.push({ kind: 'contains', source_event_id: 'branch', target_event_id: 'development' });
    if (projectedHome) {
      data.processes.push({ id: slot.process.id, home: 'branch', points: [] });
      addEvent(data, 'separate-update', { role: 'event', processIds: [slot.process.id] });
      data.inspection.model.meaning_model.events.find((event) => event.id === 'separate-update').process_ids = [slot.process.id];
    }
    assert.deepEqual([...unopenedProcessEvents(data)], [], `projected home: ${projectedHome}`);
  }
});

test('current Cuts preserve processes while withdrawn Cut history does not make an empty slot opened', () => {
  const data = snapshot();
  addSlot(data, 'native-reading'); addSlot(data, 'projected-reading'); addSlot(data, 'historical-only');
  data.inspection.model.meaning_model.normalized_cuts.push(
    { id: 'current', parent_event_id: 'native-reading', answers: [{ key: 'zero', weight: 0 }, { key: 'remainder', weight: 1 }] },
    { id: 'withdrawn', parent_event_id: 'historical-only', withdrawn: { reason: 'Replaced' } });
  data.numerics.cuts.push({ id: 'projected-current', parentEventId: 'projected-reading' });
  data.numerics.historical = { cuts: [{ id: 'projected-old', parentEventId: 'historical-only', record: { withdrawn: { reason: 'Replaced' } } }] };
  assert.deepEqual([...unopenedProcessEvents(data)], ['historical-only']);
});

test('constant numerical samples and zero-valued typed initial records remain visible', () => {
  const data = snapshot();
  const sampled = addSlot(data, 'constant-measure');
  data.measures.push({ id: sampled.process.id, points: [{ t: 10, v: 0 }, { t: 20, v: 0 }] });
  const projected = addSlot(data, 'constant-process');
  data.processes.push({ id: projected.process.id, points: [{ t: 10, v: 7 }, { t: 20, v: 7 }] });
  const values = [
    { kind: 'scalar', value: 0 }, { kind: 'vector', value: [0, 0] },
    { kind: 'distribution', value: [0, 1] }, { kind: 'category', value: 'steady' },
    { kind: 'graph', value: { nodes: [{ id: 'a' }], edges: [] } },
    { kind: 'graph', value: { nodes: [], edges: [{ source: 'a', target: 'b' }] } },
  ];
  for (const [index, initialValue] of values.entries()) addSlot(data, `record:${index}`, { initialValue });
  addSlot(data, 'empty-graph');
  addSlot(data, 'empty-vector', { initialValue: { kind: 'vector', value: [] } });
  addSlot(data, 'empty-distribution', { initialValue: { kind: 'distribution', value: [] } });
  assert.deepEqual([...unopenedProcessEvents(data)].sort(), ['empty-distribution', 'empty-graph', 'empty-vector']);
});

test('a native about reading of a process preserves the target without inferring development from unrelated links', () => {
  const data = snapshot();
  addSlot(data, 'read-about'); addSlot(data, 'missing-reader'); addSlot(data, 'outgoing-reference');
  addEvent(data, 'reader'); addEvent(data, 'elsewhere');
  data.inspection.model.meaning_model.event_relations.push(
    { kind: 'about', source_event_id: 'reader', target_event_id: 'read-about' },
    { kind: 'about', source_event_id: 'does-not-exist', target_event_id: 'missing-reader' },
    { kind: 'about', source_event_id: 'outgoing-reference', target_event_id: 'elsewhere' });
  assert.deepEqual([...unopenedProcessEvents(data)].sort(), ['missing-reader', 'outgoing-reference']);
});

test('classification does not mutate or delete snapshot records and tolerates absent optional projections', () => {
  const data = snapshot(); addSlot(data, 'empty');
  const before = structuredClone(data); freezeDeep(data);
  assert.deepEqual([...unopenedProcessEvents(data)], ['empty']);
  assert.deepEqual(data, before);
  assert.equal(unopenedProcessEvents({}).size, 0);
});

test('the current Book hides unopened slots while retaining numerical and qualitative developments', async () => {
  const edition = JSON.parse(await readFile(new URL('../../examples/book-of-conditions/PUBLICATION-MANIFEST.json', import.meta.url), 'utf8'));
  const bundle = JSON.parse(await readFile(new URL('../../examples/book-of-conditions/the-book-of-conditions.meaning-model.json', import.meta.url), 'utf8'));
  const model = bundle.models.find(entry => entry.modelHash === edition.modelHash).definition;
  const data = await buildViewerData({ history: { models: [{ modelHash: 'a'.repeat(64), definition: model }], revisions: [] },
    generatedAt: '2026-09-27T12:00:00.000Z' });
  const before = JSON.stringify(data);
  const hidden = unopenedProcessEvents(data);
  const concurrentProcesses = new Set(model.processes.filter((process) => process.scale?.semantic_role === 'person_is_process').map((process) => process.id));
  const concurrentEvents = data.events.filter((event) => event.processIds.some((id) => concurrentProcesses.has(id)));
  assert.ok(hidden.size > 0 && hidden.size < concurrentEvents.length, 'this edition contains both unopened and developed processes');
  assert.ok([...hidden].every((id) => concurrentEvents.some((event) => event.id === id)), 'only declared concurrent slots are hidden');
  const daviesPeriod = data.events.find((event) => event.id === 'event.book.davies.beginning-1788');
  assert.equal(daviesPeriod?.role, 'period', 'Davies\'s early life is a declared life period');
  assert.equal(hidden.has(daviesPeriod.id), false, 'the qualitative period stays visible even though its span puts it in the process inventory');
  const developed = concurrentEvents.filter((event) => !hidden.has(event.id));
  assert.ok(developed.length > 3, 'qualitative developments count as modeling alongside numerical bodies');
  for (const id of ['event.profile.charles-babbage.person.charles_babbage.is.body',
    'event.profile.charles-babbage.person.charles_babbage.is.work',
    'event.development.07r2.charles-babbage.1833-aug-1843.work']) {
    assert.ok(developed.some(event => event.id === id), `A developed process remains visible: ${id}`);
  }
  assert.ok(hidden.has('event.profile.george-farrow.person.george_farrow.is.kin'), 'an untouched empty slot remains hideable');
  for (const event of data.events.filter((event) => ['phase', 'arc', 'life'].includes(event.role))) assert.equal(hidden.has(event.id), false, event.id);
  assert.equal(JSON.stringify(data), before, 'filtering cannot modify the Book or its recorded numerical content');
});

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

test('the actual viewer enables the filter only through its explicit URL preference', () => {
  for (const query of ['', 'unopened=show', 'unopened=hide']) {
    const context = { URLSearchParams, params: new URLSearchParams(query), data: { measures: [], constructionTiming: 'unavailable' } };
    vm.createContext(context);
    vm.runInContext(`${between('const hasPaths =', 'let selectedPart =')}\nthis.opt = opt;`, context);
    assert.equal(context.opt.hideUnopened, query === 'unopened=hide');
  }
});

test('actual layout removes filtered nodes from both views and tree floors while preserving child Events and numerical rows', () => {
  const group = { id: 'owner', rows: [] };
  const node = (id, depth, kind = 'event') => ({ id, depth, group: group.id, kind, trunk: depth <= 1, t0: 0, t1: 1 });
  const nodes = [node('root', 0), node('empty', 2, 'sub'), node('developed', 2, 'sub'), node('child', 3)];
  const rows = [{ group, measure: { id: 'constant-number' }, depth: 2, yT: 0 }];
  const context = { nodes, rows, groups: [group], unopenedProcessIds: new Set(['empty']),
    opt: { hideUnopened: false, depth: 4, camera: 'free', show: new Set(['events', 'subsidiary', 'processes', 'numbers']) },
    ROW: 2.7, GAP: 4.4, LANE: 1, LAMP: 3.2, MIN_DUR: 0.02,
    floors: [], layersBounds: null, dirty: false, relayout: false, extrasDirty: false,
    apply() {}, syncPanel() {}, syncURL() {}, fitLocked() {} };
  vm.createContext(context);
  vm.runInContext([between('const visibleNode =', 'function pack('), functionSource('pack'), functionSource('computeLayout'), functionSource('setHideUnopened')].join('\n'), context);
  context.computeLayout();
  assert.equal(nodes[1].shown, true, 'the opt-in filter leaves defaults unchanged');
  context.setHideUnopened(true);
  assert.equal(nodes[1].inT, false); assert.equal(nodes[1].inL, false); assert.equal(nodes[1].shown, false);
  assert.ok(context.floors.every((floor) => !floor.roles.includes(nodes[1])), 'hidden slots must not consume a tree lane or floor role');
  for (const item of [nodes[2], nodes[3], rows[0]]) {
    assert.equal(item.inL, true, item.id ?? item.measure.id);
    for (const coordinate of ['yT', 'zT', 'yL', 'zL']) assert.ok(Number.isFinite(item[coordinate]), `${item.id ?? item.measure.id}.${coordinate}`);
  }
  assert.ok(context.opt.show.has('numbers'), 'numerical display remains independent');
  context.setHideUnopened(false);
  assert.equal(nodes[1].shown, true, 'turning the filter off restores the same record');
  assert.ok(context.floors.some((floor) => floor.roles.includes(nodes[1])));
});
