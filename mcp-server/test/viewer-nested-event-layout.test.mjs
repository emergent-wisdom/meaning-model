import test from 'node:test';
import assert from 'node:assert/strict';
import { nestedEventLayout } from '../viewer/public/nested-event-layout.js';

const plan = (events, rest = {}) => nestedEventLayout({ events, subjects: [{ id: 'person-a', lifeEventId: 'life-a' }, { id: 'person-b', lifeEventId: 'life-b' }], ...rest });
const serialized = (result) => Object.fromEntries([...result.positions].sort(([a], [b]) => a.localeCompare(b)));

test('nested Events use declared lifecycle ancestry without names or participant guesses', () => {
  const events = [
    { id: 'world' }, { id: 'life-a', parent: 'world' }, { id: 'inner', parent: 'life-a', owner: null, depth: 0 },
    { id: 'assessment', parent: 'inner', owner: null, depth: 0 },
    { id: 'life-b', parent: 'world' },
    { id: 'shared', parent: 'world', participants: ['person-a', 'person-b'], label: "Person A's important moment" },
    { id: 'contradictory-hint', parent: 'life-a', owner: 'person-b' },
    { id: 'uncontained', owner: 'person-b' },
  ];
  const original = JSON.stringify(events), result = plan(events);
  assert.equal(result.positions.size, events.length);
  assert.equal(result.groupById.get('assessment'), 'person-a');
  assert.equal(result.groupById.get('contradictory-hint'), 'person-a', 'declared lifecycle containment takes precedence over an owner hint');
  assert.equal(result.groupById.get('uncontained'), 'person-b', 'usable owner metadata provides a fallback when no lifecycle is known');
  assert.equal(result.groupById.get('shared'), 'world', 'a shared Event remains once under its actual World parent');
  for (const [id, parent] of [['life-a', 'world'], ['inner', 'life-a'], ['assessment', 'inner'], ['shared', 'world']]) {
    assert.equal(result.positions.get(id).level, result.positions.get(parent).level + 1, 'levels follow containment even across groups and context depth resets');
  }
  assert.equal(JSON.stringify(events), original);
});

test('siblings reserve contiguous disjoint subtree slots and parents center their children', () => {
  const events = [
    { id: 'life-a' }, { id: 'later', parent: 'life-a', t0: 20 }, { id: 'early', parent: 'life-a', t0: 10 },
    { id: 'later-a', parent: 'later' }, { id: 'later-b', parent: 'later' },
    { id: 'early-a', parent: 'early' }, { id: 'early-b', parent: 'early' }, { id: 'early-c', parent: 'early' },
  ];
  const result = plan(events), at = (id) => result.positions.get(id);
  assert.deepEqual(['early-a', 'early-b', 'early-c', 'later-a', 'later-b'].map((id) => at(id).lane), [0, 1, 2, 3, 4]);
  assert.equal(at('early').lane, (at('early-a').lane + at('early-c').lane) / 2);
  assert.equal(at('life-a').lane, (at('early').lane + at('later').lane) / 2);
  assert.deepEqual(result.spans.get('person-a'), { lanes: 5 });
  assert.deepEqual(serialized(plan([...events].reverse())), serialized(result), 'input array order cannot rearrange a branch');
});

test('hidden ancestors project to the nearest visible parent while retaining their declared subject', () => {
  const result = plan([
    { id: 'world' }, { id: 'life-a', parent: 'world' }, { id: 'hidden-inner', parent: 'life-a' },
    { id: 'child', parent: 'hidden-inner' }, { id: 'grandchild', parent: 'child' },
  ], { visibleIds: new Set(['world', 'child', 'grandchild']) });
  assert.equal(result.positions.size, 3);
  assert.equal(result.positions.get('child').group, 'person-a');
  assert.equal(result.positions.get('child').level, 1);
  assert.equal(result.positions.get('grandchild').level, 2);
  assert.equal(result.groupById.get('hidden-inner'), 'person-a');
});

test('synthetic numeric leaves and characters without numeric rows share the same general layout', () => {
  const result = plan([
    { id: 'world' }, { id: 'life-a', parent: 'world' }, { id: 'home', parent: 'life-a' },
    { id: 'numeric-row-1', parent: 'home', owner: 'person-a' }, { id: 'numeric-row-2', parent: 'home', owner: 'person-a' },
    { id: 'life-b', parent: 'world' }, { id: 'event-without-curve', parent: 'life-b' },
  ]);
  assert.equal(result.spans.get('person-a').lanes, 2);
  assert.equal(result.spans.get('person-b').lanes, 1);
  assert.equal(result.positions.get('numeric-row-1').level, result.positions.get('home').level + 1);
  assert.notEqual(result.positions.get('numeric-row-1').lane, result.positions.get('numeric-row-2').lane);
  assert.deepEqual([...result.spans.keys()], ['person-a', 'person-b', 'world']);
});

test('missing parents, independent roots, cycles and ambiguous lifecycles stay finite and deterministic', () => {
  const events = [
    { id: 'missing-parent', parent: 'absent' }, { id: 'second-root' },
    { id: 'cycle-b', parent: 'cycle-a' }, { id: 'cycle-a', parent: 'cycle-b' }, { id: 'self', parent: 'self' },
  ];
  const result = plan(events);
  assert.equal(result.positions.size, events.length);
  assert.equal(result.positions.get('cycle-a').level, 0);
  assert.equal(result.positions.get('cycle-b').level, 1);
  assert.ok([...result.positions.values()].every(({ lane, level }) => Number.isFinite(lane) && Number.isFinite(level)));
  assert.deepEqual(serialized(plan([...events].reverse())), serialized(result));
  const ambiguous = plan([{ id: 'both-lives' }, { id: 'child', parent: 'both-lives', owner: 'person-a' }],
    { subjects: [{ id: 'person-a', lifeEventId: 'both-lives' }, { id: 'person-b', lifeEventId: 'both-lives' }] });
  assert.equal(ambiguous.groupById.get('child'), 'world', 'conflicting lifecycle declarations do not arbitrarily select an owner');
  assert.equal(plan(events, { visibleIds: [] }).positions.size, 0);
});

test('deep containment avoids recursion limits and ignores unknown visible IDs', () => {
  const events = Array.from({ length: 15000 }, (_, i) => ({ id: `event-${i}`, parent: i ? `event-${i - 1}` : null }));
  const result = plan(events, { visibleIds: ['event-0', 'event-14999', 'unknown'] });
  assert.equal(result.positions.size, 2);
  assert.equal(result.positions.get('event-14999').level, 1);
  assert.equal(result.spans.get('world').lanes, 1);
});
