import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessDetail } from '../viewer/public/process-detail.js';

const event = (id, parent, fields = {}) => ({ id, parent, ...fields });
const row = (id, home, depth, conditions = []) => ({ home, depth, measure: { id, conditioningSchema: conditions } });
const sorted = (ids) => [...ids].sort();

test('the whole-model coarse overview keeps worlds and wholes without a field of numerical curves', () => {
  const detail = createProcessDetail([
    event('world', null, { role: 'world' }), event('person', 'world', { role: 'life' }),
    event('economy', 'world'), event('body', 'person'), event('credit', 'economy'), event('loan', 'credit'),
  ], [row('health', 'body', 3), row('credit-share', 'credit', 3)]);
  const coarse = detail.project();
  assert.deepEqual(sorted(coarse.eventIds), ['economy', 'person', 'world']);
  assert.deepEqual(sorted(coarse.retainedEventIds), ['economy', 'person', 'world']);
  assert.equal(coarse.rowIds.size, 0);
  const finer = detail.project({ level: 1 });
  assert.deepEqual(sorted(finer.eventIds), ['body', 'credit', 'economy', 'person', 'world']);
  const full = detail.project({ level: 99 });
  assert.deepEqual(sorted(full.eventIds), ['body', 'credit', 'economy', 'loan', 'person', 'world']);
  assert.deepEqual(sorted(full.rowIds), ['credit-share', 'health']);
  assert.deepEqual(sorted(full.retainedEventIds), ['economy', 'person', 'world'], 'the macro wholes remain protected as deeper detail opens');
  assert.equal(full.level, full.maxLevel);
});

test('a character can be seen as a whole with existing broad readings, then opened without losing its parents', () => {
  const detail = createProcessDetail([
    event('world'), event('life', 'world', { role: 'life', name: 'A life' }),
    event('body', 'life'), event('inner', 'life', { role: 'inner' }),
    event('attention', 'inner'), event('moment', 'attention'), event('other-life', 'world'),
  ], [row('body-summary', 'body', 3), row('inner-summary', 'inner', 3),
    row('attention-share', 'attention', 4), row('other-person', 'other-life', 2), row('unknown', 'missing', 1)]);
  const coarse = detail.project({ scope: 'life' });
  assert.deepEqual(sorted(coarse.eventIds), ['life', 'world']);
  assert.deepEqual(sorted(coarse.ancestors), ['world']);
  assert.deepEqual(sorted(coarse.retainedEventIds), ['life', 'world']);
  assert.deepEqual(sorted(coarse.rowIds), ['body-summary', 'inner-summary']);
  const finer = detail.project({ scope: 'life', level: 1 });
  assert.deepEqual(sorted(finer.eventIds), ['body', 'inner', 'life', 'world']);
  assert.deepEqual(sorted(finer.rowIds), ['attention-share', 'body-summary', 'inner-summary']);
  for (const id of coarse.eventIds) assert.ok(finer.eventIds.has(id));
  const full = detail.project({ scope: 'life', level: 99 });
  assert.ok(full.eventIds.has('moment'));
  assert.ok(!full.eventIds.has('other-life'));
  assert.ok(!full.rowIds.has('unknown'));
  assert.deepEqual(sorted(full.retainedEventIds), ['life', 'world']);
});

test('an arbitrary machine or economy can be selected using its declared structure, independently of names and owners', () => {
  const events = [event('root'), event('opaque:17', 'root', { label: 'Analytical Engine' }),
    event('opaque:18', 'opaque:17', { label: 'Mill' }), event('opaque:19', 'opaque:18', { label: 'Cycle' }),
    event('opaque:20', 'root', { label: 'English economy' }), event('opaque:21', 'opaque:20')];
  const detail = createProcessDetail(events, [row('work', 'opaque:17', 2), row('subwork', 'opaque:18', 3), row('trade', 'opaque:20', 2)]);
  assert.ok(detail.options.some((option) => option.id === 'opaque:17' && option.label === 'Analytical Engine'));
  assert.ok(detail.options.some((option) => option.id === 'opaque:20' && option.label === 'English economy'));
  assert.deepEqual(sorted(detail.project({ scope: 'opaque:17' }).rowIds), ['work']);
  assert.deepEqual(sorted(detail.project({ scope: 'opaque:17', level: 1 }).rowIds), ['subwork', 'work']);
  assert.deepEqual(sorted(detail.project({ scope: 'opaque:20' }).rowIds), ['trade']);
});

test('conditional answers open after their broad recorded composition, even when they share the same home', () => {
  const detail = createProcessDetail([event('life', null, { role: 'life' }), event('inner', 'life')], [
    row('broad', 'inner', 2), row('conditional', 'inner', 2, [{}]), row('twice-conditional', 'inner', 2, [{}, {}]),
  ]);
  assert.deepEqual(sorted(detail.project({ scope: 'life' }).rowIds), ['broad']);
  assert.deepEqual(sorted(detail.project({ scope: 'life', level: 1 }).rowIds), ['broad', 'conditional']);
  assert.deepEqual(sorted(detail.project({ scope: 'life', level: 2 }).rowIds), ['broad', 'conditional', 'twice-conditional']);
  assert.deepEqual(sorted(detail.project({ level: 1 }).rowIds), ['broad']);
  assert.deepEqual(sorted(detail.project({ level: 2 }).rowIds), ['broad', 'conditional']);
  assert.deepEqual(sorted(detail.project({ level: 3 }).rowIds), ['broad', 'conditional', 'twice-conditional']);
});

test('conditional-only rows stay absent at coarse depth and become reachable with more detail', () => {
  const detail = createProcessDetail([event('process')], [row('conditional', 'process', 1, [{}])]);
  assert.equal(detail.project({ scope: 'process' }).rowIds.size, 0);
  assert.deepEqual(sorted(detail.project({ scope: 'process', level: 1 }).rowIds), ['conditional']);
});

test('missing parents and cyclic containment remain reachable without altering the model', () => {
  const events = [event('orphan', 'missing'), event('child', 'orphan'), event('a', 'b'), event('b', 'a'), event('branch', 'b'), event('self', 'self')];
  const rows = [row('known', 'orphan', 8), row('unplaced', 'missing', 1)];
  const before = JSON.stringify({ events, rows });
  const detail = createProcessDetail(events, rows);
  assert.deepEqual(sorted(detail.project({ level: 99 }).eventIds), ['a', 'b', 'branch', 'child', 'orphan', 'self']);
  assert.deepEqual(sorted(detail.project({ scope: 'a', level: 99 }).eventIds), ['a', 'b', 'branch']);
  assert.deepEqual(sorted(detail.project({ scope: 'a' }).ancestors), ['b']);
  assert.deepEqual(sorted(detail.project({ scope: 'orphan', level: 99 }).rowIds), ['known']);
  assert.equal(detail.project({ scope: 'missing' }).scope, null);
  assert.equal(JSON.stringify({ events, rows }), before);
});

test('empty or row-only models have a usable coarse state, and rows retain their recorded identity', () => {
  assert.deepEqual(createProcessDetail().options, []);
  const empty = createProcessDetail().project({ scope: 'absent', level: Infinity });
  assert.equal(empty.scope, null); assert.equal(empty.level, 0); assert.equal(empty.maxLevel, 0);
  assert.equal(empty.eventIds.size, 0); assert.equal(empty.rowIds.size, 0);
  const detail = createProcessDetail([], [row('native-number', null, 1)]);
  assert.equal(detail.project().rowIds.size, 0);
  assert.deepEqual(sorted(detail.project({ level: 1 }).rowIds), ['native-number']);
});
