import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  forcingTargets,
  hasNorthHarborPreset,
  loadNorthHarborModel,
  northHarborPresetMetadata,
  northHarborPresetIds,
} from '../src/north-harbor-presets.mjs';

const expected = Object.freeze({
  'north-harbor/12': Object.freeze({
    file: 'north-harbor-12.json',
    sha256: 'ec7b824518a9a6942b8b01e98fdb418912b93e316e30d15d053d6069e8b2e25f',
    modelId: 'mcp-north-harbor-12-people',
    processCount: 266,
    dependencyCount: 937,
    lawCount: 1203,
  }),
  'north-harbor/48': Object.freeze({
    file: 'north-harbor-48.json',
    sha256: 'b6601a31fae4890543e9a84064a6d70bab70403273279b02eb71fe0dce9f63a5',
    modelId: 'mcp-north-harbor-48-people',
    processCount: 1016,
    dependencyCount: 3763,
    lawCount: 4779,
  }),
});

test('precompiled North Harbor resources retain the extracted byte identity', async () => {
  assert.deepEqual(northHarborPresetIds, Object.keys(expected));
  assert.deepEqual(
    northHarborPresetMetadata().map(({ presetId, sha256, modelId, processCount, dependencyCount, lawCount }) => ({
      presetId,
      sha256,
      modelId,
      processCount,
      dependencyCount,
      lawCount,
    })),
    Object.entries(expected).map(([presetId, { file: _file, ...metadata }]) => ({
      presetId,
      ...metadata,
    })),
  );

  for (const [presetId, identity] of Object.entries(expected)) {
    const bytes = await readFile(
      new URL(`../resources/presets/${identity.file}`, import.meta.url),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), identity.sha256);

    const model = loadNorthHarborModel(presetId);
    assert.equal(model.schema, 'life-sim-rust-model/v1');
    assert.equal(model.id, identity.modelId);
    assert.equal(model.processes.length, identity.processCount);
    assert.equal(model.dependencies.length, identity.dependencyCount);
    assert.equal(model.laws.length, identity.lawCount);
  }
});

test('preset callers receive isolated models and unsupported names are rejected', () => {
  const first = loadNorthHarborModel('north-harbor/12');
  const second = loadNorthHarborModel('north-harbor/12');
  first.processes[0].id = 'mutated-by-caller';
  assert.notEqual(second.processes[0].id, 'mutated-by-caller');
  assert.equal(hasNorthHarborPreset('north-harbor/48'), true);
  assert.equal(hasNorthHarborPreset('../../secret'), false);
  assert.throws(() => loadNorthHarborModel('../../secret'), /Unsupported presetId/);
});

test('the extracted forcing schedule retains its exact interpolation contract', () => {
  assert.deepEqual(forcingTargets(0), {
    'world.ambient_heat': 0.28,
    'world.grid_capacity': 0.86,
    'world.water_supply': 0.82,
    'world.public_information': 0.58,
    'world.institutional_capacity': 0.72,
    'world.mutual_aid': 0.35,
    'world.rumor_pressure': 0.2,
  });
  assert.deepEqual(forcingTargets(4.25), {
    'world.ambient_heat': 0.9128571428571429,
    'world.grid_capacity': 0.49,
    'world.water_supply': 0.6275000000000001,
    'world.public_information': 0.5116666666666667,
    'world.institutional_capacity': 0.6358333333333334,
    'world.mutual_aid': 0.556,
    'world.rumor_pressure': 0.7,
  });
  assert.deepEqual(forcingTargets(14), {
    'world.ambient_heat': 0.27,
    'world.grid_capacity': 0.85,
    'world.water_supply': 0.81,
    'world.public_information': 0.72,
    'world.institutional_capacity': 0.7,
    'world.mutual_aid': 0.52,
    'world.rumor_pressure': 0.18,
  });
});
