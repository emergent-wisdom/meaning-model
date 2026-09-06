import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';

const sourceHash = 'a'.repeat(64);
const targetHash = 'b'.repeat(64);
const headHash = 'c'.repeat(64);
const revisionHash = 'd'.repeat(64);

function fixture({ fail = false } = {}) {
  const calls = [];
  const backend = {
    async initialize() { return {}; },
    async close() {},
    status() { return { persistenceMode: 'volatile-test' }; },
    async call(operation, payload) {
      calls.push({ operation, payload });
      if (operation === 'get_model') return { summary: { process_ids: ['old', 'detail'] } };
      if (operation === 'get_world_revision') return { world_revision_hash: revisionHash };
      assert.equal(operation, 'revise_world');
      if (fail) throw new Error('conflict: expected world hash is stale');
      return { world_revision_hash: revisionHash, world_head: { model_hash: targetHash } };
    },
  };
  const service = new LifeSimulationService({ backend });
  const world = {
    id: 'world-revision-test', presetId: 'north-harbor/12', modelHash: sourceHash,
    processIds: ['old'], candidateIds: new Map(), receipts: new Map(),
  };
  service.worlds.set(world.id, world);
  const input = {
    worldId: world.id, requestId: 'revise-once', expectedWorldHash: headHash,
    targetModelHash: targetHash, mode: 'refine',
    stateValues: { detail: { kind: 'scalar', value: 0.4 } },
    reason: 'Open detail at the current time', provenance: ['author'],
  };
  return { calls, service, world, input };
}

test('world revision delegates explicit state, mode, provenance and exact head with idempotency', async () => {
  const { calls, service, world, input } = fixture();
  const result = await service.reviseWorld(input);
  assert.equal(result.world_revision_hash, revisionHash);
  assert.equal(world.modelHash, targetHash);
  assert.equal(world.presetId, null);
  assert.deepEqual(world.processIds, ['detail', 'old']);
  assert.deepEqual(calls[1], {
    operation: 'revise_world',
    payload: {
      world_id: world.id, model_hash: targetHash,
      world_revision: {
        expected_world_hash: headHash, mode: 'refine', state_values: input.stateValues,
        reason: input.reason, provenance: input.provenance,
      },
      view: { requested_observables: [], access_scopes: [], include_path: false },
    },
  });
  assert.deepEqual(await service.reviseWorld(input), result);
  assert.equal(calls.length, 2);
  await assert.rejects(service.reviseWorld({ ...input, mode: 'revise' }), /different revise-world payload/);
  assert.equal(calls.length, 2);
  assert.deepEqual(await service.inspectWorldRevision({ revisionHash }), { world_revision_hash: revisionHash });
  assert.deepEqual(calls[2], { operation: 'get_world_revision', payload: {
    world_revision_hash: revisionHash,
    view: { requested_observables: [], access_scopes: [], include_path: false },
  } });
});

test('failed revision does not change the service world or preset binding', async () => {
  const { service, world, input } = fixture({ fail: true });
  await assert.rejects(service.reviseWorld(input), /stale/);
  assert.equal(world.modelHash, sourceHash);
  assert.equal(world.presetId, 'north-harbor/12');
  assert.deepEqual(world.processIds, ['old']);
});

test('invalid revision metadata is rejected before calling Rust', async () => {
  const { calls, service, input } = fixture();
  for (const invalid of [
    { mode: 'guess' }, { reason: '' }, { provenance: [] },
    { provenance: [''] }, { stateValues: [] }, { expectedWorldHash: 'wrong' },
  ]) await assert.rejects(service.reviseWorld({ ...input, ...invalid }));
  assert.deepEqual(calls, []);
});

test('Meaning Model queries include Cuts, context roots, and recomposition contracts by their real keys', async () => {
  const block = {
    schema: 'life-sim-rust-meaning-model/v1',
    events: [{ id: 'life' }], normalized_cuts: [{ id: 'outlook' }],
    context_roots: [{ event_id: 'life', kind: 'accepted_world' }],
    temporal_cut_recompositions: [{ parent_cut_id: 'outlook', coverage: 'partial' }],
  };
  const service = new LifeSimulationService({ backend: {
    async initialize() {}, async close() {}, status() { return {}; },
    async call(operation) {
      assert.equal(operation, 'get_model');
      return { model: { meaning_model: block } };
    },
  } });
  const result = await service.queryMeaningModel({
    modelHash: sourceHash, collections: ['normalized_cuts', 'context_roots', 'temporal_cut_recompositions'],
    ids: ['life', 'outlook'],
  });
  assert.equal(result.returnedCount, 3);
  assert.equal(result.meaningModel.totalRecordCount, 4);
  assert.deepEqual(result.items.map(x => x.collection), ['normalized_cuts', 'context_roots', 'temporal_cut_recompositions']);
});
