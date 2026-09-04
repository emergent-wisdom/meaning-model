import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  listModelingResources,
  readModelingResource,
} from '../mcp-server/src/modeling-guidance.mjs';

const repositoryRoot = new URL('../', import.meta.url);

async function verifyDigest(directory, artifact, expectedDigest) {
  assert.match(expectedDigest, /^[0-9a-f]{64}$/);
  const bytes = await readFile(new URL(artifact, directory));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    expectedDigest,
    `${artifact} does not match SOURCE.json.`,
  );
}

const companionDirectory = new URL('docs/companions/life-simulation/', repositoryRoot);
const companionSource = JSON.parse(
  await readFile(new URL('SOURCE.json', companionDirectory), 'utf8'),
);
assert.equal(companionSource.schema, 'meaning-model-companion-source/v1');
assert.equal(companionSource.repository, 'life-simulation');
assert.equal(companionSource.source_state, 'content_addressed_release_snapshot');
assert.equal(companionSource.release_provenance_status, 'content_verified');
await verifyDigest(companionDirectory, companionSource.artifact, companionSource.sha256);
for (const dependency of companionSource.dependencies) {
  await verifyDigest(companionDirectory, dependency.artifact, dependency.sha256);
}

const presetDirectory = new URL('mcp-server/resources/presets/', repositoryRoot);
const presetSource = JSON.parse(await readFile(new URL('SOURCE.json', presetDirectory), 'utf8'));
assert.equal(presetSource.schema, 'life-simulation-precompiled-presets/v1');
assert.equal(presetSource.presets.length, 2);
for (const preset of presetSource.presets) {
  await verifyDigest(presetDirectory, preset.file, preset.sha256);
}

const resources = listModelingResources();
for (const resource of resources) {
  const loaded = await readModelingResource(resource.uri);
  assert.ok(loaded.bytes > 0, `${resource.uri} is empty.`);
}

console.log(
  `Verified digest-bound Life Simulation companion, ${presetSource.presets.length} presets, and ${resources.length} MCP resources.`,
);
