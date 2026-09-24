// A world outlives the process that created it: the engine keeps world heads in its state file,
// and a new server process reopens a world by its id (found by the 2026-09-23 instruction test,
// where a continuation agent could not reach the world its predecessor built).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { LifeSimulationService } from '../src/service.mjs';

test('a world created by one service is reopened by id in a later service over the same engine', async (t) => {
  const backend = new RustEngineProcess();
  t.after(() => backend.close());
  const first = new LifeSimulationService({ backend });
  const created = await first.createWorld({ requestId: 'create-recover', presetId: 'north-harbor/12' });
  const before = await first.inspectWorld({ worldId: created.worldId });

  // A fresh service has no handles, as after a restart; the engine still holds the world.
  const later = new LifeSimulationService({ backend });
  const reopened = await later.inspectWorld({ worldId: created.worldId });
  assert.equal(reopened.modelHash, created.modelHash);
  assert.equal(reopened.headHash, before.headHash);
  assert.equal(reopened.presetId, 'north-harbor/12', 'the preset is found again from the content-addressed model hash');
  assert.equal((await later.getWorld(created.worldId)).recovered, true);
  await assert.rejects(later.inspectWorld({ worldId: 'world_00000000-0000-4000-8000-000000000000' }), /Unknown or inaccessible worldId/);
});

test('a world survives a real restart: a new engine process over the same state file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'world-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, 'state.sqlite') };
  const start = () => { const backend = new RustEngineProcess(); backend.childEnvironment = environment; backend.arguments = ['--ndjson']; return new LifeSimulationService({ backend }); };
  const first = start();
  await first.initialize();
  const created = await first.createWorld({ requestId: 'create', presetId: 'north-harbor/12' });
  await first.rollCandidate({ worldId: created.worldId, requestId: 'roll-before' });
  await first.close();
  const later = start();
  t.after(() => later.close());
  await later.initialize();
  const inspected = await later.inspectWorld({ worldId: created.worldId });
  assert.equal(inspected.modelHash, created.modelHash);
  assert.equal(inspected.presetId, 'north-harbor/12');
  await later.rollCandidate({ worldId: created.worldId, requestId: 'roll-after' });
});
