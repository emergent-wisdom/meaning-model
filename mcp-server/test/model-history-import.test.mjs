import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifeSimulationService, serviceLimits } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { exportConstructionHistory, importConstructionHistory } from '../src/construction-record.mjs';
import { decodeHistoryModels, HISTORY_FILE_SCHEMA_V2, HISTORY_SCHEMA } from '../src/construction-files.mjs';
import { writeFile } from 'node:fs/promises';

async function example() {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, modelRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((match) => JSON.parse(match[1]));
  return { model: modelRequest.model, graph: graphRequest.narrativeGraph };
}

async function sessions(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-history-import-'));
  const services = [];
  t.after(async () => {
    await Promise.all(services.map((service) => service.close()));
    await rm(directory, { recursive: true, force: true });
  });
  async function start(name, options = {}) {
    const backend = new RustEngineProcess();
    backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, `${name}.sqlite`) };
    const service = new LifeSimulationService({ ...options, backend });
    services.push(service);
    await service.initialize();
    return service;
  }
  return { directory, start };
}

function successor(model, previousModelHash, number) {
  const next = structuredClone(model);
  next.revision = { number, previous_model_hash: previousModelHash,
    reason: `Historical model revision ${number}.`, provenance: ['model-history-import-test'] };
  next.meaning_model.events.find((event) => event.id === 'event.offer').description =
    `Fixture revision ${number}: the written offer remains private.`;
  return next;
}

test('a file history with more than 32 model revisions imports and survives a real restart under default limits', { timeout: 60_000 }, async (t) => {
  const { directory, start } = await sessions(t);
  const { model, graph } = await example();
  const source = await start('source');
  const registerRequest = { requestId: 'source.model.0', model };
  const registered = await source.registerModel(registerRequest);
  const hashes = [registered.modelHash];
  let definition = model, lastRequest, lastReceipt;
  for (let number = 1; number < 35; number += 1) {
    definition = successor(definition, hashes.at(-1), number);
    lastRequest = { requestId: `source.model.${number}`, previousModelHash: hashes.at(-1), model: definition };
    lastReceipt = await source.reviseModel(lastRequest);
    hashes.push(lastReceipt.modelHash);
  }
  assert.equal(new Set(hashes).size, 35);
  assert.equal(source.models.size, 32);
  assert.ok(!source.models.has(hashes[0]), 'the oldest summary is evicted, not the native model');
  assert.equal((await source.inspectModel({ modelHash: hashes[0], includeDefinition: true })).model.revision.number, 0);

  // Receipts must still reject changed requests after their summary has left the cache.
  assert.deepEqual(await source.registerModel(registerRequest), registered);
  assert.deepEqual(await source.reviseModel(lastRequest), lastReceipt);
  const changedRegistration = structuredClone(registerRequest);
  changedRegistration.model.revision.reason = 'Different registration payload.';
  await assert.rejects(source.registerModel(changedRegistration), /already bound to a different register-model payload/);
  const changedRevision = structuredClone(lastRequest);
  changedRevision.model.revision.reason = 'Different revision payload.';
  await assert.rejects(source.reviseModel(changedRevision), /already bound to a different revise-model payload/);

  graph.source.model_hash = hashes.at(-1);
  const stored = await source.registerNarrativeGraph({ requestId: 'source.graph', narrativeGraph: graph });
  const path = join(directory, 'construction.json');
  const exported = await exportConstructionHistory(source, {
    graphHash: stored.graphHash, accessScopes: ['author'], destinationPath: path,
  });
  assert.equal(exported.modelCount, 35);
  const contents = await readFile(path);
  const written = JSON.parse(contents);
  // The file keeps the first model revision whole and every later one as its changes from the one before.
  assert.equal(written.schema, HISTORY_FILE_SCHEMA_V2);
  assert.deepEqual(written.models.map((entry) => entry.modelHash), hashes);
  assert.ok(written.models[0].definition && !written.models[0].delta);
  assert.ok(written.models.slice(1).every((entry, index) => entry.delta && entry.baseModelHash === hashes[index] && !entry.definition));
  const bundle = decodeHistoryModels(written);
  assert.equal(bundle.schema, HISTORY_SCHEMA);
  const expanded = Buffer.byteLength(JSON.stringify(bundle.models)), kept = Buffer.byteLength(JSON.stringify(written.models));
  assert.ok(kept * 4 < expanded, `35 model revisions take ${kept} bytes as changes and ${expanded} whole`);
  assert.equal(exported.models, undefined, 'file export returns a compact receipt');

  let target = await start('target');
  const importRequest = { requestId: 'import.history', sourcePath: path };
  const imported = await importConstructionHistory(target, importRequest);
  assert.equal(imported.verified, true);
  assert.equal(imported.models, 35);
  assert.equal(imported.headGraphHash, stored.graphHash);
  assert.equal(target.models.size, 32);
  assert.ok(!target.models.has(hashes[0]));
  assert.deepEqual(await importConstructionHistory(target, importRequest), imported);
  for (const { modelHash, definition: expected } of bundle.models) {
    const inspected = await target.inspectModel({ modelHash, includeDefinition: true });
    assert.equal(inspected.summary.model_hash, modelHash);
    assert.deepEqual(inspected.model, expected);
  }
  const rendered = await target.renderNarrativeGraph({ graphHash: imported.headGraphHash, accessScopes: ['author'] });
  await target.close();

  target = await start('target');
  assert.equal(target.models.size, 0, 'the restarted MCP summary cache starts empty');
  for (const { modelHash, definition: expected } of bundle.models) {
    assert.deepEqual((await target.inspectModel({ modelHash, includeDefinition: true })).model, expected);
  }
  assert.equal((await target.renderNarrativeGraph({ graphHash: stored.graphHash, accessScopes: ['author'] })).text, rendered.text);
  const reimported = await importConstructionHistory(target, importRequest);
  assert.equal(reimported.verified, true);
  assert.equal(reimported.headGraphHash, imported.headGraphHash);

  // A file written before model revisions were kept as changes, every one whole, still imports.
  const wholePath = join(directory, 'construction-v1.json');
  await writeFile(wholePath, JSON.stringify(bundle));
  const fromWholeFile = await importConstructionHistory(await start('whole'), { requestId: 'import.whole', sourcePath: wholePath });
  assert.equal(fromWholeFile.verified, true);
  assert.equal(fromWholeFile.headGraphHash, stored.graphHash);
  assert.equal(reimported.models, 35);
  assert.equal(target.models.size, 32);
  assert.equal((await target.inspectModel({ modelHash: hashes[0], includeDefinition: true })).model.revision.number, 0);
  assert.deepEqual(await readFile(path), contents, 'import and restart leave the private source file unchanged');
});

test('repeated large immutable model payloads do not accumulate as duplicate receipt storage', { timeout: 30_000 }, async (t) => {
  const { start } = await sessions(t);
  const { model } = await example();
  const process = model.processes[0];
  for (let index = 0; index < 384; index += 1) {
    model.processes.push({ ...structuredClone(process), id: `fixture.value.${index}` });
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(model));
  assert.ok(payloadBytes > 128 * 1024 && payloadBytes < 256 * 1024);
  // Reserve the ordinary model-result allowance, with room for one large payload
  // but not several retained copies. Native model limits remain unchanged.
  const maxReceiptBytes = serviceLimits.maxModelReceiptResultBytes + 256 * 1024;
  const service = await start('compact-receipts', { maxReceiptBytes });
  let definition = model;
  let receipt = await service.registerModel({ requestId: 'large.0', model: definition });
  for (let number = 1; number < 4; number += 1) {
    definition = successor(definition, receipt.modelHash, number);
    const request = { requestId: `large.${number}`, previousModelHash: receipt.modelHash, model: definition };
    receipt = await service.reviseModel(request);
    assert.deepEqual(await service.reviseModel(request), receipt);
  }
  assert.equal(service.modelReceipts.size, 4);
  assert.ok(service.receiptBytes < payloadBytes, 'receipts retain fingerprints and compact results rather than full model payloads');
  assert.equal((await service.inspectModel({ modelHash: receipt.modelHash, includeDefinition: true })).model.processes.length, 385);
});
