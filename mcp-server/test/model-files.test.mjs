// A whole model can move by file instead of inside one message, which clients cap at about 10 MiB: life_model_export
// writes a stored model to a new file, and life_model_register reads one back with sourcePath. A model larger than one
// result holds is registered from a file, inspected without failing, and exported whole.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));

async function minimalModel() {
  const markdown = await readFile(join(here, '..', '..', 'docs', 'examples', 'MINIMAL-MODEL-AND-GRAPH.md'), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  return structuredClone(registerRequest.model);
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'model-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = new Client({ name: 'model-files-test', version: '1' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '', MEANING_MODEL_RESULTS_DIR: join(directory, 'results') };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const call = async (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  const ok = async (name, args) => {
    const result = await call(name, args);
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result).slice(0, 400)}`);
    return result.structuredContent;
  };
  return { directory, call, ok, client };
}

test('a stored model exports to a new file and registers back from it with the same hash', async (t) => {
  const { directory, call, ok } = await setup(t);
  const model = await minimalModel();
  const { modelHash } = await ok('life_model_register', { requestId: 'inline', model });
  const path = join(directory, 'model.json');
  const exported = await ok('life_model_export', { modelHash, destinationPath: path });
  assert.equal(exported.modelHash, modelHash);
  assert.equal(exported.definitionFile.path, path);
  assert.equal(exported.model, undefined, 'the definition goes to the file, not the result');
  const fromFile = await ok('life_model_register', { requestId: 'from-file', sourcePath: path });
  assert.equal(fromFile.modelHash, modelHash, 'the file holds the same model');
  assert.deepEqual(fromFile.sourceFile, exported.definitionFile, 'the same file, bytes and sha256');
  const again = await call('life_model_export', { modelHash, destinationPath: path });
  assert.ok(again.isError && /never overwritten/u.test(JSON.stringify(again.content)), 'a file is never overwritten');
  const relative = await call('life_model_export', { modelHash, destinationPath: 'model.json' });
  assert.ok(relative.isError, 'the path must be absolute');
  const both = await call('life_model_register', { requestId: 'both', model, sourcePath: path });
  assert.ok(both.isError && /one of the two/u.test(JSON.stringify(both.content)));
  const neither = await call('life_model_register', { requestId: 'neither' });
  assert.ok(neither.isError && /one of the two/u.test(JSON.stringify(neither.content)));
});

test('a model larger than one message registers from a file, inspects without failing and exports whole', async (t) => {
  const { directory, ok } = await setup(t);
  const model = await minimalModel();
  const debt = model.processes.find((process) => process.id === 'bakery.debt_nok');
  const points = Array.from({ length: 12 }, (_, time) => ({ time, value: 900_000 - time * 1_000, lower: 850_000, upper: 950_000, tag: 'sketch' }));
  model.value_series = [];
  for (let n = 0; n < 9_000; n += 1) {
    model.processes.push({ ...structuredClone(debt), id: `bakery.branch_${n}.debt_nok` });
    model.value_series.push({ id: `series.branch-${n}`, holder: 'modeler', process_id: `bakery.branch_${n}.debt_nok`, points, provenance: ['model-files test'] });
  }
  const text = JSON.stringify(model);
  assert.ok(Buffer.byteLength(text) > 10 * 1024 * 1024, 'more than one message holds');
  const source = join(directory, 'large.json');
  await writeFile(source, text);
  const registered = await ok('life_model_register', { requestId: 'large', sourcePath: source });
  assert.equal(registered.sourceFile.bytes, Buffer.byteLength(text));
  const inspected = await ok('life_model_inspect', { modelHash: registered.modelHash, includeDefinition: true });
  assert.equal(inspected.model, undefined);
  assert.ok(inspected.definitionBytes > 8 * 1024 * 1024);
  assert.match(inspected.definitionNotInline, /life_model_export/u);
  // The definition that does not fit is written whole to a file, which registers back as the same model.
  assert.equal(inspected.definitionFile.path, join(directory, 'results', `${inspected.definitionFile.sha256}.json`));
  const fromFile = await ok('life_model_register', { requestId: 'large-file', sourcePath: inspected.definitionFile.path });
  assert.equal(fromFile.modelHash, registered.modelHash, 'the inspect file holds the whole definition');
  const exported = await ok('life_model_export', { modelHash: registered.modelHash, destinationPath: join(directory, 'large-out.json') });
  const back = await ok('life_model_register', { requestId: 'large-back', sourcePath: exported.definitionFile.path });
  assert.equal(back.modelHash, registered.modelHash, 'the exported file holds the same model');
});

test('a later revision exports as a snapshot of itself, which registration refuses, pointing to the history route', async (t) => {
  const { directory, call, ok, client } = await setup(t);
  const model = await minimalModel();
  const first = await ok('life_model_register', { requestId: 'r0', model });
  const successor = { ...structuredClone(model), revision: { number: 1, previous_model_hash: first.modelHash, reason: 'A revised model to export', provenance: ['model-files test'] } };
  const revised = await ok('life_model_revise', { requestId: 'r1', previousModelHash: first.modelHash, model: successor });
  const path = join(directory, 'r1.json');
  await ok('life_model_export', { modelHash: revised.modelHash, destinationPath: path });
  const written = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(written.revision.number, 1);
  const validated = await ok('life_model_validate', { model: written });
  assert.equal(validated.modelHash, revised.modelHash, 'the file holds exactly the revision it was exported from');
  // life_model_register stores only a first revision; a history moves with its graph.
  const back = await call('life_model_register', { requestId: 'r1-back', sourcePath: path });
  assert.ok(back.isError);
  assert.match(JSON.stringify(back.content), /requires revision 0.*life_construction_export/su);
  const { tools } = await client.listTools();
  const exportTool = tools.find((tool) => tool.name === 'life_model_export');
  assert.match(exportTool.description, /snapshot of one stored model revision/u);
  assert.match(exportTool.description, /revision-0 model back with sourcePath; it refuses a later revision/u);
});
