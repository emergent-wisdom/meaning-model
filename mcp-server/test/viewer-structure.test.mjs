import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructureIndex, formatModelInterval } from '../viewer/public/structure-model.js';

const event = (id) => ({ id });
const contains = (id, source_event_id, target_event_id) => ({ id, kind: 'contains', source_event_id, target_event_id });

test('Event containment and process decomposition use distinct explicit edge collections', () => {
  const model = { processes: [event('p'), event('q'), event('p.looks.related')], decomposition: [{ id: 'd', parent: 'p', child: 'q', kind: 'semantic_subtype' }], meaning_model: {
    events: [event('a'), event('b'), event('c')], event_relations: [contains('ab','a','b'), { ...contains('bc','b','c'), kind: 'causes' }],
    context_roots: [{ event_id: 'a', kind: 'accepted_world' }],
  } };
  const copy = structuredClone(model), index = buildStructureIndex(model);
  assert.deepEqual(index.eventRoots, ['a','c']); assert.deepEqual(index.processRoots, ['p','p.looks.related']);
  assert.equal(index.eventChildren.get('a')[0], model.meaning_model.event_relations[0]);
  assert.equal(index.eventChildren.has('b'), false); assert.equal(index.processChildren.get('p')[0].kind, 'semantic_subtype');
  assert.deepEqual(index.contexts.get('a'), model.meaning_model.context_roots); assert.equal(index.contexts.has('b'), false);
  assert.deepEqual(model, copy);
});

test('Cut ownership and conditional answer hierarchy preserve local weights and remainder exactly', () => {
  const parent = { id: 'q', parent_event_id: 'a', question: 'How?', unit: 'attention', answers: [{ key: 'deciding', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] };
  const child = { id: 'q2', parent_event_id: 'b', conditioning: { cut_id: 'q', answer_key: 'deciding' }, unit: 'deciding attention', answers: [{ key: 'personal', weight: 0.25 }, { key: 'remainder', weight: 0.75 }] };
  const physical = { id: 'cut', parent_event_id: 'a', child_event_ids: ['b'], kind: 'sequential' };
  const model = { meaning_model: { events: [event('a'), event('b')], normalized_cuts: [parent,child], physical_cuts: [physical] } };
  const index = buildStructureIndex(model);
  assert.deepEqual(index.cutsByEvent.get('a'), [parent]); assert.deepEqual(index.cutsByEvent.get('b'), [child]);
  assert.equal(index.conditionedCuts.get('q').get('deciding')[0], child);
  assert.deepEqual(child.answers.map((answer) => answer.weight), [0.25,0.75]); assert.equal(child.unit, 'deciding attention');
  assert.equal(index.physicalCutsByEvent.get('a')[0], physical); assert.equal(index.eventChildren.size, 0, 'physical partition does not fabricate a contains edge');
});

test('shared nodes retain every declared parent and disconnected cycles have finite entry points', () => {
  const model = { meaning_model: { events: ['a','b','c','x','y','z'].map(event), event_relations: [contains('ab','a','b'),contains('cb','c','b'),contains('xy','x','y'),contains('yx','y','x'),contains('zz','z','z')] } };
  const index = buildStructureIndex(model);
  assert.deepEqual(index.eventParents.get('b').map((edge) => edge.source_event_id), ['a','c']);
  assert.deepEqual(index.eventRoots, ['a','c','x','z']);
  assert.equal(index.eventChildren.get('y')[0].target_event_id, 'x');
});

test('unresolved references remain explicit and do not hide existing child records', () => {
  const index = buildStructureIndex({ meaning_model: { events: [event('child'),event('parent')], event_relations: [contains('missing-parent','missing','child'),contains('missing-child','parent','missing-child')] } });
  assert.deepEqual(index.eventRoots, ['child','parent']);
  assert.equal(index.eventChildren.get('parent')[0].target_event_id, 'missing-child');
  assert.equal(index.events.has('missing-child'), false);
});

test('native clocks are not converted unless the declared unit is civil days since the epoch', () => {
  assert.equal(formatModelInterval(null, 'year'), 'No interval declared');
  assert.equal(formatModelInterval({ start: 0, end: 1 }, 'ticks'), '0 → 1 ticks');
  assert.equal(formatModelInterval({ start: -1, end: 0 }, 'civil_day_since_1970_01_01'), '1969-12-31 → 1970-01-01 · -1 → 0 civil_day_since_1970_01_01');
  assert.equal(formatModelInterval({ start: 1843, end: 1854 }, 'year'), '1843 → 1854 year');
  assert.match(formatModelInterval({ start: 0.5, end: 1 }, 'civil_day_since_1970_01_01'), /1970-01-01T12:00:00.000Z/);
  assert.equal(formatModelInterval({ start: 1e300, end: 1e301 }, 'civil_day_since_1970_01_01'), '1e+300 → 1e+301 civil_day_since_1970_01_01');
});
