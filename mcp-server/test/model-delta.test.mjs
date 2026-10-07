import assert from 'node:assert/strict';
import test from 'node:test';
import { applyModelDelta, computeModelDelta, MODEL_DELTA_SCHEMA } from '../src/model-delta.mjs';
import { decodeHistoryModels, encodeHistoryModels, HISTORY_FILE_SCHEMA_V2 } from '../src/construction-files.mjs';

const model = (events) => ({ schema: 'life-sim-rust-model/v1', id: 'story', time_unit: 'year',
  revision: { number: 3, previous_model_hash: 'a', reason: 'r', provenance: [] },
  processes: [{ id: 'p', value_type: 'number' }], meaning_model: { events, normalized_cuts: [] } });

test('a small revision is kept as only what changed and rebuilds exactly', () => {
  const events = Array.from({ length: 400 }, (_, i) => ({ id: `ev.${String(i).padStart(4, '0')}`, description: 'x'.repeat(200) }));
  const changed = structuredClone(events);
  changed[17].description = 'a revised description'; changed.splice(40, 1); changed.push({ id: 'ev.9999', description: 'added' });
  const base = model(events), target = { ...model(changed), revision: { number: 4, previous_model_hash: 'b', reason: 's', provenance: ['p'] } };
  const delta = computeModelDelta(base, target);
  assert.equal(delta.schema, MODEL_DELTA_SCHEMA);
  assert.deepEqual(applyModelDelta(base, delta), target);
  assert.ok(JSON.stringify(delta).length * 50 < JSON.stringify(target).length);
  assert.deepEqual(base.meaning_model.events, events, 'the base is not changed');
});

test('the sign of a zero is a change', () => {
  const base = { start: 0, events: [{ id: 'a', start: 0 }] }, target = { start: -0, events: [{ id: 'a', start: -0 }] };
  const delta = computeModelDelta(base, target);
  assert.ok(delta.changes.length > 0);
  assert.ok(Object.is(applyModelDelta(base, delta).start, -0) && Object.is(applyModelDelta(base, delta).events[0].start, -0));
});

test('collections whose order or ids a delta cannot keep are replaced whole, and wrong deltas are refused', () => {
  const unsorted = { items: [{ id: 'z' }, { id: 'a' }] }, inserted = { items: [{ id: 'z' }, { id: 'q' }, { id: 'a' }] };
  assert.deepEqual(applyModelDelta(unsorted, computeModelDelta(unsorted, inserted)), inserted);
  const repeated = { a: [{ id: 'x' }, { id: 'x' }] }, fewer = { a: [{ id: 'x' }] };
  assert.equal(computeModelDelta(repeated, fewer).changes[0].op, 'set');
  assert.throws(() => applyModelDelta({ items: [{ id: 'a' }] }, { schema: MODEL_DELTA_SCHEMA, changes: [{ op: 'records', path: ['items'], remove: ['missing'], sorted: true }] }), /missing/);
  assert.throws(() => applyModelDelta({}, { schema: 'other', changes: [] }), /schema/);
});

test('randomized revisions are always rebuilt exactly', () => {
  let seed = 0x9e3779b9;
  const next = (n) => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % Math.max(1, n); };
  const value = (depth) => {
    switch (depth ? next(7) : next(4)) {
      case 0: return null; case 1: return [0, -0, next(5), next(100) / 7][next(4)]; case 2: return `s${next(50)}`; case 3: return next(2) === 0;
      case 4: return Object.fromEntries(Array.from({ length: next(5) }, () => [`k${next(8)}`, value(depth - 1)]));
      case 5: { const ids = [...new Set(Array.from({ length: next(8) }, () => next(30)))].sort((a, b) => a - b); if (next(3) === 0) ids.reverse();
        return ids.map((id) => ({ id: `r${String(id).padStart(2, '0')}`, v: value(depth - 1) })); }
      default: return Array.from({ length: next(4) }, () => value(depth - 1));
    }
  };
  const mutate = (target, depth) => {
    if (target && typeof target === 'object' && !Array.isArray(target) && Object.keys(target).length && next(4)) {
      const keys = Object.keys(target), key = keys[next(keys.length)];
      const choice = next(5); if (choice === 0) { delete target[key]; return target; } if (choice === 1) { target[`n${next(9)}`] = value(depth); return target; }
      target[key] = mutate(target[key], Math.max(0, depth - 1)); return target;
    }
    if (Array.isArray(target) && target.length && next(4)) {
      const at = next(target.length), choice = next(4);
      if (choice === 0) target.splice(at, 1); else if (choice === 1) target.push(structuredClone(target[at])); else target[at] = mutate(target[at], Math.max(0, depth - 1));
      return target;
    }
    return value(depth);
  };
  for (let i = 0; i < 3000; i += 1) {
    const base = value(4); let target = structuredClone(base);
    for (let j = 0, n = 1 + next(4); j < n; j += 1) target = mutate(target, 4);
    const delta = computeModelDelta(base, target);
    assert.ok(delta, `no delta for ${JSON.stringify(base)} -> ${JSON.stringify(target)}`);
    assert.deepEqual(applyModelDelta(base, delta), target);
  }
});

test('a history file keeps model revisions as changes and reads back as the same history', () => {
  const h1 = 'a'.repeat(64);
  const first = model(Array.from({ length: 60 }, (_, i) => ({ id: `e${String(i).padStart(2, '0')}`, d: i, text: 'a moment of the story' })));
  const second = { ...structuredClone(first), revision: { number: 4, previous_model_hash: h1, reason: 'two', provenance: [] } };
  second.meaning_model.events[1].d = 3;
  const unrelated = { ...model([{ id: 'c' }]), id: 'other', revision: { number: 0, reason: 'own', provenance: [] } };
  const models = [{ modelHash: h1, definition: first }, { modelHash: 'b'.repeat(64), definition: second }, { modelHash: 'c'.repeat(64), definition: unrelated }];
  const written = encodeHistoryModels(models);
  assert.ok(written[0].definition && written[1].delta && written[1].baseModelHash === h1 && written[2].definition);
  // A revision whose changes would not be smaller than the whole is written whole.
  const tiny = encodeHistoryModels([{ modelHash: 't1', definition: model([{ id: 'x' }]) }, { modelHash: 't2', definition: { ...model([{ id: 'y' }]), revision: { number: 4, previous_model_hash: 't1', reason: 'r', provenance: [] } } }]);
  assert.ok(tiny[1].definition && !tiny[1].delta);
  const read = decodeHistoryModels({ schema: HISTORY_FILE_SCHEMA_V2, models: written, revisions: [] });
  assert.deepEqual(read.models, models);
  assert.throws(() => decodeHistoryModels({ schema: HISTORY_FILE_SCHEMA_V2, models: written.slice(1), revisions: [] }), /does not hold/);
});
