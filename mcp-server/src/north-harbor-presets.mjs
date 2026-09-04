import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const definitions = Object.freeze({
  'north-harbor/12': Object.freeze({
    file: new URL('../resources/presets/north-harbor-12.json', import.meta.url),
    sha256: 'ec7b824518a9a6942b8b01e98fdb418912b93e316e30d15d053d6069e8b2e25f',
    modelId: 'mcp-north-harbor-12-people',
    processCount: 266,
    dependencyCount: 937,
    lawCount: 1203,
  }),
  'north-harbor/48': Object.freeze({
    file: new URL('../resources/presets/north-harbor-48.json', import.meta.url),
    sha256: 'b6601a31fae4890543e9a84064a6d70bab70403273279b02eb71fe0dce9f63a5',
    modelId: 'mcp-north-harbor-48-people',
    processCount: 1016,
    dependencyCount: 3763,
    lawCount: 4779,
  }),
});

export const northHarborPresetIds = Object.freeze(Object.keys(definitions));

const parsedModels = new Map();

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function readPreset(presetId) {
  const definition = definitions[presetId];
  if (!definition) throw new Error(`Unsupported presetId ${presetId}.`);
  if (parsedModels.has(presetId)) return parsedModels.get(presetId);

  const text = readFileSync(definition.file, 'utf8');
  const digest = sha256(text);
  if (digest !== definition.sha256) {
    throw new Error(
      `Bundled preset ${presetId} failed its SHA-256 check: expected ` +
      `${definition.sha256}, received ${digest}.`,
    );
  }
  const model = JSON.parse(text);
  if (
    model.schema !== 'life-sim-rust-model/v1' ||
    model.id !== definition.modelId ||
    model.processes?.length !== definition.processCount ||
    model.dependencies?.length !== definition.dependencyCount ||
    model.laws?.length !== definition.lawCount
  ) {
    throw new Error(`Bundled preset ${presetId} failed its structural identity check.`);
  }
  parsedModels.set(presetId, model);
  return model;
}

export function hasNorthHarborPreset(presetId) {
  return Object.hasOwn(definitions, presetId);
}

export function loadNorthHarborModel(presetId) {
  return structuredClone(readPreset(presetId));
}

export function northHarborPresetMetadata() {
  return northHarborPresetIds.map((presetId) => {
    const { file: _file, ...metadata } = definitions[presetId];
    return { presetId, ...metadata };
  });
}

function timelineValue(time, points) {
  if (time <= points[0][0]) return points[0][1];
  if (time >= points.at(-1)[0]) return points.at(-1)[1];
  const rightIndex = points.findIndex(([pointTime]) => pointTime >= time);
  const [leftTime, leftValue] = points[rightIndex - 1];
  const [rightTime, rightValue] = points[rightIndex];
  const fraction = (time - leftTime) / (rightTime - leftTime);
  return leftValue + fraction * (rightValue - leftValue);
}

export function forcingTargets(day) {
  return {
    'world.ambient_heat': timelineValue(day, [
      [0, 0.28], [1, 0.3], [3, 0.92], [6.5, 0.9], [9.5, 0.3], [14, 0.27],
    ]),
    'world.grid_capacity': timelineValue(day, [
      [0, 0.86], [2.5, 0.84], [4.5, 0.44], [7, 0.5], [11, 0.82], [14, 0.85],
    ]),
    'world.water_supply': timelineValue(day, [
      [0, 0.82], [3, 0.79], [5, 0.53], [7.5, 0.56], [9, 0.78], [14, 0.81],
    ]),
    'world.public_information': timelineValue(day, [
      [0, 0.58], [2, 0.54], [4, 0.45], [5.5, 0.82], [10, 0.8], [14, 0.72],
    ]),
    'world.institutional_capacity': timelineValue(day, [
      [0, 0.72], [3, 0.69], [6, 0.56], [9, 0.61], [14, 0.7],
    ]),
    'world.mutual_aid': timelineValue(day, [
      [0, 0.35], [2.5, 0.36], [5, 0.64], [7.5, 0.76], [11, 0.68], [14, 0.52],
    ]),
    'world.rumor_pressure': timelineValue(day, [
      [0, 0.2], [1.5, 0.23], [3.5, 0.72], [5, 0.68], [7.5, 0.34], [11, 0.2], [14, 0.18],
    ]),
  };
}
