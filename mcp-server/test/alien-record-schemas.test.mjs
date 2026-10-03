import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const addonUri = 'life-sim://addon/alien';
const schemaTemplate = `${addonUri}/record-schema/{kind}`;

async function connect(t) {
  const client = new Client({ name: 'alien-record-schema-test', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))],
    env: { ...process.env, MEANING_MODEL_ADDONS: 'alien' } });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
  return result.structuredContent;
}

async function schema(client, kind) {
  const uri = schemaTemplate.replace('{kind}', kind);
  const result = await client.readResource({ uri });
  assert.equal(result.contents.length, 1, 'only the requested kind is returned');
  assert.equal(result.contents[0].uri, uri);
  assert.equal(result.contents[0].mimeType, 'application/schema+json');
  return JSON.parse(result.contents[0].text);
}

test('public metadata locates individual runtime-derived commission and selection payload schemas', async (t) => {
  const client = await connect(t);
  const tools = await client.listTools();
  const dataDescription = tools.tools.find(({ name }) => name === 'life_alien_record').inputSchema.properties.data.description;
  assert.ok(dataDescription.includes(schemaTemplate));
  const templates = await client.listResourceTemplates();
  assert.ok(templates.resourceTemplates.some(({ uriTemplate }) => uriTemplate === schemaTemplate));
  const guide = (await client.readResource({ uri: addonUri })).contents[0].text;
  assert.ok(guide.includes(schemaTemplate));
  assert.match(guide, /JSON\.stringify\(\{text: task\.text\}\)/u);
  assert.match(guide, /prompt\.sha256.*SHA-256 of the UTF-8 task text itself/su);
  assert.ok(!guide.includes('"$schema"'), 'the routine guide does not embed all payload schemas');

  const commission = await schema(client, 'commission');
  assert.deepEqual(commission.required, ['addressedTo', 'rationale']);
  assert.equal(commission.additionalProperties, false);
  const diagnosis = commission.properties.diagnosis.anyOf.find(({ type }) => type === 'object');
  assert.deepEqual(diagnosis.required, ['graphHash', 'diagnosisHash']);
  assert.equal(diagnosis.additionalProperties, false);
  assert.equal(commission.properties.worldAsk.default, null);
  assert.equal(commission.properties.worldAsk.anyOf.find(({ type }) => type === 'string').maxLength, 1_000);
  assert.match(commission.description, /new_world requires worldAsk or at least one operator/u);
  assert.match(commission.description, /explorer requires relationToChange/u);
  assert.ok(!Object.hasOwn(commission.properties, 'diagnosisHash'));

  const selection = await schema(client, 'selection');
  assert.deepEqual(selection.required, ['format', 'items', 'rationale']);
  assert.deepEqual(selection.properties.format.enum, ['single', 'portfolio', 'weighted']);
  assert.deepEqual(selection.properties.items.items.required, ['nodeId', 'reason']);
  assert.deepEqual(selection.properties.preserved.items.required, ['conceptId', 'reason']);
  assert.equal(selection.properties.items.items.additionalProperties, false);
  assert.equal(selection.properties.items.items.properties.weight.default, null);
  assert.match(selection.description, /weights plus remainder must sum to 1/u);
  assert.ok(!Object.hasOwn(selection.properties, 'mode'));
  for (const kind of ['unknown', '__proto__', 'constructor']) {
    await assert.rejects(client.readResource({ uri: schemaTemplate.replace('{kind}', kind) }), /Unknown alien record kind/u);
  }
});

test('public records retain accepted shapes and reject trial mistakes and cross-field violations', async (t) => {
  const client = await connect(t);
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const { modelHash } = await call(client, 'life_model_register', registerRequest);
  const started = await call(client, 'life_alien_search_start', { requestId: 'schema.start', modelHash,
    graphId: 'alien.schema', searchId: 'search.schema', title: 'Shared equipment',
    problem: { statement: 'How can members share equipment upkeep?', deriveTargetTerms: false },
    authorId: 'tester', accessScopes: ['author'] });
  let graphHash = started.graphHash;
  const base = () => ({ graphHash, searchRootId: 'search.schema', authorId: 'tester', accessScopes: ['author'] });
  const record = async (nodeId, kind, data, taskNodeId = null) => {
    const stored = await call(client, 'life_alien_record', { ...base(), requestId: `record.${nodeId}`, nodeId, kind, data, taskNodeId });
    graphHash = stored.graphHash;
    return stored;
  };
  const reject = async (kind, data, message) => {
    const result = await client.callTool({ name: 'life_alien_record', arguments: {
      ...base(), requestId: 'schema.rejected', nodeId: 'rejected', kind, data } });
    assert.equal(result.isError, true);
    assert.match(result.content.filter(({ type }) => type === 'text').map(({ text }) => text).join('\n'), message);
  };
  const diagnosis = await call(client, 'life_alien_search_diagnose', { graphHash, searchRootId: 'search.schema', accessScopes: ['author'] });
  const commission = { addressedTo: 'new_world', worldAsk: 'Explore effects whose sources vanish.', rationale: 'Explore a distinct causal order.' };
  await reject('commission', { ...commission, diagnosisHash: diagnosis.diagnosisHash }, /Unrecognized key.*diagnosisHash/su);
  await reject('commission', { addressedTo: 'new_world', rationale: 'Explore.' }, /worldAsk or operators/u);
  await reject('commission', { ...commission, diagnosis: { graphHash, diagnosisHash: '0'.repeat(64) } }, /does not match the diagnosis/u);
  await record('commission.bound', 'commission', { ...commission, diagnosis: { graphHash, diagnosisHash: diagnosis.diagnosisHash } });
  await record('commission.legacy', 'commission', commission);

  const explorer = await call(client, 'life_alien_task', { ...base(), requestId: 'schema.explorer', role: 'explorer' });
  graphHash = explorer.graphHash;
  const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  assert.equal(explorer.textHash, sha256(JSON.stringify({ text: explorer.text })));
  assert.notEqual(explorer.textHash, sha256(explorer.text));
  await record('mechanism.circuit', 'mechanism', {
    operator: 'Every effect travels until another actor accepts it.',
    roles: [{ id: 'source', description: 'creates the effect' }, { id: 'receiver', description: 'accepts the effect' }],
    strangest: { element: 'effects survive their source', preserved: 'the effect carries its own obligation' },
    candidate: { label: 'Travelling upkeep', design_principles: 'Attach duties to effects.', core_mechanism: 'A duty travels with a shared object.',
      how_it_works: 'Each recipient accepts the outstanding duty.', what_is_new: 'The duty outlives its origin.', why_it_works: 'Duties stay visible.',
      why_it_fails: 'Recipients may refuse.', medium_term: 'Try a small pilot.', long_term_vision: 'A shared upkeep routine.' },
    isolation: { compiler: 'same_context' },
  }, explorer.taskNodeId);

  const item = { nodeId: 'mechanism.circuit', reason: 'Develop this proposal.' };
  const selection = { format: 'single', items: [item], rationale: 'One developed direction.' };
  await reject('selection', { mode: 'single', items: [{ nodeId: item.nodeId }], rationale: selection.rationale, preserved: ['family.x'] }, /format.*reason.*preserved.*mode/su);
  await reject('selection', { ...selection, items: [item, item] }, /exactly one item/u);
  await reject('selection', { ...selection, format: 'weighted', items: [{ ...item, weight: 0.5 }] }, /give its question, unit and remainder/u);
  const allocation = { question: 'How should development effort divide?', unit: 'one development budget', remainder: 0.5 };
  await reject('selection', { ...selection, format: 'weighted', items: [{ ...item, weight: 0.8 }], allocation }, /shares plus the remainder sum to 1/u);
  await reject('selection', { ...selection, items: [{ ...item, weight: 1 }] }, /Only weighted selections/u);
  await record('selection.single', 'selection', selection);
  await record('selection.weighted', 'selection', { ...selection, format: 'weighted', items: [{ ...item, weight: 0.5 }], allocation });
});
