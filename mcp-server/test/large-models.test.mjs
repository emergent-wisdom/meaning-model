// Models as large as 0.12.1 allows. Every read and write either succeeds whole or says plainly what it left out, and
// nothing fails after a write has happened. Each test is a case found in review of the first 0.12.1 candidate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess, resolveEngineBinary } from '../src/rust-engine-process.mjs';
import { exportConstructionHistory, replayConstruction } from '../src/construction-record.mjs';

const here = dirname(fileURLToPath(import.meta.url));

async function example() {
  const markdown = await readFile(join(here, '..', '..', 'docs', 'examples', 'MINIMAL-MODEL-AND-GRAPH.md'), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  return { model: structuredClone(registerRequest.model), graph: graphRequest.narrativeGraph };
}

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'large-models-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// The real server, as a client reaches it.
async function connect(t, environment = {}) {
  const client = new Client({ name: 'large-models-test', version: '1' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env: { ...env, ...environment } }));
  t.after(() => client.close());
  const call = async (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  const ok = async (name, args) => {
    const result = await call(name, args);
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result).slice(0, 600)}`);
    return result.structuredContent;
  };
  return { call, ok };
}

async function registerFromFile(directory, ok, requestId, model) {
  const sourcePath = join(directory, `${requestId}.json`);
  await writeFile(sourcePath, JSON.stringify(model));
  return ok('life_model_register', { requestId, sourcePath });
}

test('a model whose numbers JavaScript cannot keep is not exported, and no file is left to block a retry', async (t) => {
  const directory = await scratch(t);
  for (const token of ['1.0', '9007199254740993']) {
    const { model } = await example();
    model.meaning_model.concepts = [{ id: 'concept.numeric', provenance: ['large-models test'] }];
    model.meaning_model.realizations = [{ id: 'realization.numeric', concept_id: 'concept.numeric', purpose: 'describe',
      roles: { instance: 'event.offer' }, parameters: { exact: JSON.rawJSON(token) }, degree: 1, provenance: ['large-models test'], viewpoint: 'test' }];
    // Stored by the engine itself, since JavaScript could not send it: a legal model that JavaScript cannot carry exactly.
    const state = join(directory, `numeric-${token}.sqlite`);
    const native = spawnSync(resolveEngineBinary(), ['--state-file', state], { encoding: 'utf8',
      input: JSON.stringify({ schema: 'life-sim-rust-command/v1', operation: 'register_model', model }) });
    assert.equal(native.status, 0, native.stderr);
    const modelHash = JSON.parse(native.stdout).result.summary.model_hash;
    const { call } = await connect(t, { LIFE_SIM_STATE_FILE: state });
    const path = join(directory, `numeric-${token}.json`);
    const exported = await call('life_model_export', { modelHash, destinationPath: path });
    assert.ok(exported.isError && /cannot be written to a file exactly/u.test(JSON.stringify(exported.content)), `${token}: ${JSON.stringify(exported).slice(0, 400)}`);
    await assert.rejects(readFile(path), { code: 'ENOENT' }, 'no file is written');
  }
});

test('150,000 dated values are listed, questioned and added to without overflowing the stack', async (t) => {
  const directory = await scratch(t);
  const { ok } = await connect(t);
  const { model } = await example();
  delete model.meaning_model;
  const processId = model.processes[0].id;
  model.value_series = [{ id: 'values.debt', process_id: processId, holder: 'modeler',
    points: Array.from({ length: 150_000 }, (_, time) => ({ time, value: 1_000_000, tag: 'source' })) }];
  const { modelHash } = await registerFromFile(directory, ok, 'values', model);
  const listed = await ok('life_values_query', { modelHash });
  assert.equal(listed.processes[0].values, 150_000);
  assert.deepEqual(listed.processes[0].span, [0, 149_999]);
  const questions = await ok('life_model_questions', { modelHash });
  assert.ok(questions.coverage, 'the coverage summary is computed');
  // The report after a values write is computed once the revision is stored, so it must not fail on a long series.
  const recorded = await ok('life_values_record', { requestId: 'one-more', previousModelHash: modelHash, holder: 'modeler',
    values: [{ processId, points: [{ time: 150_000, value: 1_000_000, tag: 'source' }] }], reason: 'One more value after a long series.' });
  assert.ok(recorded.modelHash && recorded.values, 'stored, with its report');
});

test('replay and export reach revision 0 of a history longer than 1,024 revisions', { timeout: 600_000 }, async (t) => {
  const directory = await scratch(t);
  const backend = new RustEngineProcess();
  backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, 'long.sqlite') };
  const service = new LifeSimulationService({ backend });
  t.after(() => service.close());
  await service.initialize();
  const { model, graph } = await example();
  let head = (await service.registerModel({ requestId: 'long.r0', model })).modelHash;
  for (let number = 1; number <= 1_024; number += 1) {
    model.revision = { number, previous_model_hash: head, reason: `Revision ${number}`, provenance: ['large-models test'] };
    head = (await service.reviseModel({ requestId: `long.r${number}`, previousModelHash: head, model })).modelHash;
  }
  const first = await replayConstruction(service, { modelHash: head, format: 'json', level: 'outline', limit: 1 });
  assert.equal(first.revisionCount, 1_025);
  assert.equal(first.steps[0].modelRevision, 0, 'the replay begins at revision 0');
  assert.equal(first.truncated, false);
  assert.equal(first.startsAfterRevisionZero, undefined);
  const last = await replayConstruction(service, { modelHash: head, format: 'json', level: 'outline', offset: 1_024, limit: 1 });
  assert.equal(last.steps[0].modelRevision, 1_024);
  graph.source.model_hash = head;
  const { graphHash } = await service.registerNarrativeGraph({ requestId: 'long.graph', narrativeGraph: graph });
  const exported = await exportConstructionHistory(service, { graphHash, accessScopes: ['author'], destinationPath: join(directory, 'long-history.json') });
  assert.equal(exported.modelCount, 1_025);
});

test('a model with 25,000 long process ids inspects, exports and revises with results that fit', { timeout: 300_000 }, async (t) => {
  const directory = await scratch(t);
  const { ok } = await connect(t);
  const { model } = await example();
  // A small model's summary is unchanged: whole, with nothing cut.
  const small = await ok('life_model_register', { requestId: 'small', model });
  const smallSummary = await ok('life_model_inspect', { modelHash: small.modelHash });
  assert.equal(smallSummary.listsCut, undefined);
  assert.deepEqual(smallSummary.summary.process_ids, model.processes.map((process) => process.id));

  model.id = 'long-ids';
  delete model.meaning_model;
  const sample = model.processes[0];
  model.processes = Array.from({ length: 25_000 }, (_, n) => ({ ...sample, id: `p${String(n).padStart(5, '0')}_${'x'.repeat(193)}` }));
  const { modelHash } = await registerFromFile(directory, ok, 'long-ids', model);
  for (const includeDefinition of [false, true]) {
    const inspected = await ok('life_model_inspect', { modelHash, includeDefinition });
    assert.equal(inspected.summary.process_count, 25_000);
    assert.equal(inspected.listsCut['summary.process_ids'].of, 25_000);
    assert.ok(inspected.summary.process_ids.length > 100 && inspected.summary.process_ids.length < 25_000, 'the first ids, not all');
    assert.equal(inspected.summary.process_ids[0], model.processes[0].id);
    assert.match(inspected.listsCutNote, /life_model_export/u);
    if (includeDefinition) assert.match(inspected.definitionNotInline, /life_model_export/u);
  }
  const exported = await ok('life_model_export', { modelHash, destinationPath: join(directory, 'long-ids-out.json') });
  assert.equal(exported.summary.process_count, 25_000);
  assert.equal(exported.summary.process_ids, undefined, 'the receipt counts the processes; the file lists them');
  // The route the bounded summary names holds every id.
  const written = JSON.parse(await readFile(exported.definitionFile.path, 'utf8'));
  assert.deepEqual(written.processes.map((process) => process.id), model.processes.map((process) => process.id));
  const back = await ok('life_model_register', { requestId: 'long-ids-back', sourcePath: exported.definitionFile.path });
  assert.equal(back.modelHash, modelHash);
  // A revision that removes nearly every process: a world could not adopt it, and the receipt lists why, cut to fit.
  const removed = model.processes.slice(1).map((process) => process.id);
  const revised = await ok('life_model_revise', { requestId: 'remove-most', previousModelHash: modelHash,
    change: { reason: 'Keep one process.', remove: { processes: removed } } });
  assert.equal(revised.worldAdoption.adoptableByParentWorlds, false);
  assert.equal(revised.listsCut['worldAdoption.blockingChanges'].of, removed.length);
  assert.ok(revised.worldAdoption.blockingChanges.length > 0 && revised.worldAdoption.blockingChanges.length < removed.length);
});

test('a model with 65,000 undescribed Events registers with a receipt that fits, the same on a retry', { timeout: 300_000 }, async (t) => {
  const directory = await scratch(t);
  const { ok } = await connect(t);
  const { model } = await example();
  const processId = model.processes[0].id;
  model.meaning_model = { schema: 'life-sim-rust-meaning-model/v1', events: Array.from({ length: 65_000 }, (_, n) => ({
    id: `event.${String(n).padStart(58, '0')}`, boundary: 'One event', process_ids: [processId], provenance: ['large-models test'] })) };
  const registered = await registerFromFile(directory, ok, 'events', model);
  assert.equal(registered.stored, true);
  assert.equal(registered.descriptionCoverage.events, 65_000);
  assert.equal(registered.listsCut['descriptionCoverage.undescribedProcessEvents'].of, 65_000);
  const shown = registered.descriptionCoverage.undescribedProcessEvents;
  assert.ok(shown.length > 100 && shown.length < 65_000);
  assert.deepEqual(shown, model.meaning_model.events.slice(0, shown.length).map((event) => event.id), 'the first Events, in order');
  const again = await registerFromFile(directory, ok, 'events', model);
  assert.equal(again.modelHash, registered.modelHash);
  assert.deepEqual(again.descriptionCoverage, registered.descriptionCoverage, 'a retry returns the same receipt');
  assert.deepEqual(again.listsCut, registered.listsCut);
  const inspected = await ok('life_model_inspect', { modelHash: registered.modelHash });
  assert.equal(inspected.summary.meaning_model.event_count, 65_000, 'every Event was stored');
});

test('a store that takes longer to reopen than one call may take still opens', { timeout: 300_000 }, async (t) => {
  const directory = await scratch(t);
  const state = join(directory, 'reopen.sqlite');
  const open = async (options = {}) => {
    const backend = new RustEngineProcess(options);
    backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: state };
    const service = new LifeSimulationService({ backend });
    t.after(() => service.close());
    await service.initialize();
    return service;
  };
  const { model } = await example();
  delete model.meaning_model;
  const sample = model.processes[0];
  model.processes = Array.from({ length: 25_000 }, (_, n) => ({ ...sample, id: `p${String(n).padStart(5, '0')}_${'x'.repeat(193)}` }));
  const writer = await open();
  const { modelHash } = await writer.registerModel({ requestId: 'reopen.r0', model });
  model.revision = { number: 1, previous_model_hash: modelHash, reason: 'Revision 1', provenance: ['large-models test'] };
  model.processes[0] = { ...model.processes[0], provenance: ['large-models test, revision 1'] };
  await writer.reviseModel({ requestId: 'reopen.r1', previousModelHash: modelHash, model });
  writer.close();
  // Opening the store rebuilds both revisions before the engine answers, which takes far longer than the 20 ms each
  // later call is allowed here; the start-up has its own limit.
  const started = Date.now();
  const reader = await open({ timeoutMs: 20 });
  assert.ok(Date.now() - started > 100, 'the rebuild took longer than one call may');
  assert.equal(reader.backend.status().ready, true);
});

test('a write whose open questions list 50,000 processes returns a result that fits, and so does reading the questions', { timeout: 300_000 }, async (t) => {
  const directory = await scratch(t);
  const { ok } = await connect(t);
  const { model } = await example();
  model.id = 'many-unobserved';
  delete model.meaning_model;
  const sample = model.processes[0];
  model.processes = Array.from({ length: 50_000 }, (_, n) => ({ ...sample, id: `p${String(n).padStart(5, '0')}_${'x'.repeat(193)}` }));
  // The model is stored before its open questions are read; a result too large for one message must not fail then.
  const registered = await registerFromFile(directory, ok, 'many-unobserved', model);
  const cut = Object.entries(registered.listsCut ?? {}).find(([path]) => path.startsWith('openQuestions.questions.') && path.endsWith('.processes'));
  assert.ok(cut, `the open questions' process list is cut: ${JSON.stringify(registered.listsCut)}`);
  assert.equal(cut[1].of, 50_000);
  assert.match(registered.listsCutNote, /stored whole/u);
  const questions = await ok('life_model_questions', { modelHash: registered.modelHash });
  const read = Object.entries(questions.listsCut ?? {}).find(([path]) => path.endsWith('.processes'));
  assert.equal(read?.[1].of, 50_000, 'reading the questions cuts the same list instead of failing');
});
