import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { LifeSimulationService } from '../src/service.mjs';
import { newestWrittenDescendant } from '../src/viewer-live.mjs';

// A content-addressed test engine: the same model always gets the same hash, as in the Rust engine.
function service(stored = new Map()) {
  const backend = {
    async initialize() {}, async close() {}, status() { return {}; },
    async call(operation, { model }) {
      if (operation !== 'register_model' && operation !== 'revise_model') throw new Error(`${operation} is not part of this test`);
      const modelHash = createHash('sha256').update(JSON.stringify(model)).digest('hex');
      stored.set(modelHash, model);
      return { summary: { model_hash: modelHash } };
    },
  };
  return new LifeSimulationService({ backend });
}
const model = (number, previous, reason = `Revision ${number}`) => ({ schema: 'life-sim-rust-model/v1', id: 'growing', time_unit: 'year', processes: [],
  revision: { number, reason, provenance: [], ...(previous ? { previous_model_hash: previous } : {}) } });

test('a live view never goes back when an older revision is submitted again', async () => {
  const s = service();
  const a = (await s.registerModel({ requestId: 'a', model: model(0) })).modelHash;
  const b = (await s.reviseModel({ requestId: 'b', previousModelHash: a, model: model(1, a) })).modelHash;
  const c = (await s.reviseModel({ requestId: 'c', previousModelHash: b, model: model(2, b) })).modelHash;
  assert.equal(s.newestModelDescendant(a), c);
  // B again under a new request id: the engine writes nothing new, so the view stays on C.
  assert.equal((await s.reviseModel({ requestId: 'b-again', previousModelHash: a, model: model(1, a) })).modelHash, b);
  assert.equal((await s.registerModel({ requestId: 'a-again', model: model(0) })).modelHash, a);
  assert.equal(s.newestModelDescendant(a), c);
  assert.equal(s.newestModelDescendant(b), c);
  assert.equal(s.newestModelDescendant(c), c);
  // A new branch from an older revision is the line written last, and the view follows it.
  const d = (await s.reviseModel({ requestId: 'd', previousModelHash: b, model: model(2, b, 'Another way on') })).modelHash;
  assert.equal(s.newestModelDescendant(a), d);
  assert.equal(s.newestModelDescendant(c), c, 'a view of the other branch stays on it');
});

test('a revision first written by an earlier process does not pass its own child when submitted again', async () => {
  const stored = new Map();
  const earlier = service(stored);
  const a = (await earlier.registerModel({ requestId: 'a', model: model(0) })).modelHash;
  const b = (await earlier.reviseModel({ requestId: 'b', previousModelHash: a, model: model(1, a) })).modelHash;
  // This process knows only its own writes: C from B, then B submitted again after it.
  const later = service(stored);
  const c = (await later.reviseModel({ requestId: 'c', previousModelHash: b, model: model(2, b) })).modelHash;
  await later.reviseModel({ requestId: 'b-again', previousModelHash: a, model: model(1, a) });
  assert.deepEqual(later.modelWrites.map((write) => write.modelHash), [c, b]);
  assert.equal(later.newestModelDescendant(a), c);
});

test('the lookup takes a revision\'s first write and ignores the order of the log', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((letter) => letter.repeat(64));
  const writes = [{ modelHash: c, previousModelHash: b }, { modelHash: b, previousModelHash: a }, { modelHash: c, previousModelHash: b }];
  assert.equal(newestWrittenDescendant(writes, a), c);
  assert.equal(newestWrittenDescendant([], a), a);
});
