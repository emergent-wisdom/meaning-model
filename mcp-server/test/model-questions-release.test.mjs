import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { modelQuestions, readOpenQuestions } from '../src/model-questions.mjs';

async function setup(t) {
  const client = new Client({ name: 'model-question-release-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))], env }));
  t.after(() => client.close());
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = registerRequest.model;
  model.id = 'release-question-scope-fixture';
  const publicProcess = model.processes[0];
  model.processes.push({ ...structuredClone(publicProcess), id: 'private.health', unit: 'private health rubric',
    initial_value: { kind: 'scalar', value: 0.875 }, access_scopes: ['private'],
    scale: { semantic_role: 'confidential health' } });
  model.meaning_model.events.find(({ id }) => id === 'event.ada.state.h06').process_ids = [publicProcess.id, 'private.health'];
  model.initial_claims = [{ id: 'private.debt.account', subject: publicProcess.id, value: { kind: 'scalar', value: 1400000 },
    value_time: -1, evidence_cutoff: 0, holder: 'private-accountant', evidence_type: 'report',
    authority: { source: 'private ledger', weight: 1 }, uncertainty: { kind: 'unknown' },
    access_scopes: ['private', 'alternate'], provenance: ['release-test'] }];
  const registered = await call('life_model_register', { requestId: 'release-model', model });
  const graph = graphRequest.narrativeGraph;
  graph.id = 'release-question-graph';
  graph.source.model_hash = registered.modelHash;
  const stored = await call('life_narrative_register', { requestId: 'release-graph', narrativeGraph: graph });
  return { client, call, model, modelHash: registered.modelHash, graphHash: stored.graphHash, publicProcessId: publicProcess.id };
}

test('public person-state questions omit scoped native values and accounts while OR scopes reveal only authorized records', async (t) => {
  const { call, modelHash, publicProcessId } = await setup(t);
  const query = { modelHash, people: [{ id: 'referent.ada' }], at: 6 };
  const publicRead = await call('life_model_questions', query);
  assert.doesNotMatch(JSON.stringify(publicRead), /private\.health|confidential health|private-accountant|private ledger/);
  assert.equal(publicRead.depth.processes, 1);
  assert.equal(publicRead.depth.claims, 0);
  assert.equal(publicRead.scope.completeNativeModel, false);
  assert.match(publicRead.scope.interpretation, /graph estimation accounts and runtime observations are not reconstructed/);
  assert.deepEqual(publicRead.states[0].values.map(({ processId }) => processId), [publicProcessId]);
  assert.deepEqual(publicRead.states[0].values[0].accounts, []);
  const alternateRead = await call('life_model_questions', { ...query, accessScopes: ['alternate'] });
  assert.equal(alternateRead.states[0].values.length, 1);
  assert.equal(alternateRead.states[0].values[0].accounts[0].holder, 'private-accountant');
  assert.equal(alternateRead.states[0].values[0].accounts[0].value, 1400000);
  const privateRead = await call('life_model_questions', { ...query, accessScopes: ['private'] });
  assert.equal(privateRead.depth.processes, 2);
  assert.ok(privateRead.states[0].values.some(({ processId }) => processId === 'private.health'));
  assert.equal(privateRead.scope.completeNativeModel, true);
  // The coverage report is a scoped reading too: the private process is empty, and only its own scope may say so.
  // (The public reading counts only the public process, empty there because its one account is private.)
  assert.match(publicRead.coverage.next.join('\n'), new RegExp(`Guess the state of 1 process\\(es\\) that have none, beginning with ${publicProcessId}\\.`, 'u'));
  assert.match(privateRead.coverage.next.join('\n'), /Guess the state of 1 process\(es\) that have none, beginning with private\.health\./u);
  // So are the reports the write tools return.
  const valued = await call('life_values_record', { requestId: 'release-values', previousModelHash: modelHash, holder: 'release-test', reason: 'A public value.',
    values: [{ processId: publicProcessId, points: [{ time: 5, value: 1_600_000, tag: 'sketch' }, { time: 7, value: 1_500_000, tag: 'sketch' }] }] });
  assert.doesNotMatch(JSON.stringify(valued), /private\.health|confidential health|private-accountant|private ledger/);
  const series = await call('life_series_record', { requestId: 'release-series', previousModelHash: valued.modelHash, subject: 'referent.ada', parentEventId: 'event.ada.state.h06',
    series: { id: 'ada-focus', question: 'What holds Ada\'s attention?', unit: 'share of attention', answers: [{ key: 'ovens', meaning: 'The ovens.' }, { key: 'debt', meaning: 'The debt.' }] },
    readings: [{ start: 6, end: 6.1, why: 'The first batch.', weights: { ovens: 0.7, debt: 0.3 }, tag: 'sketch' }, { start: 6.1, end: 6.25, why: 'The letter.', weights: { ovens: 0.4, debt: 0.6 }, tag: 'sketch' }],
    reason: 'A public series.' });
  assert.ok(series.coverage);
  assert.doesNotMatch(JSON.stringify(series), /private\.health|confidential health|private-accountant|private ledger/);
});

test('public questions refuse to combine a graph with an unrelated supplied model', async (t) => {
  const { client, call, model, modelHash, graphHash } = await setup(t);
  const matching = await call('life_model_questions', { modelHash, graphHash });
  assert.equal(matching.modelHash, modelHash);
  const world = await call('life_world_create', { requestId: 'release-world', modelHash });
  const worldGraph = await call('life_narrative_register', { requestId: 'release-world-graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'release-world-question-graph',
    revision: { number: 0, reason: 'Read the same model through a world snapshot.', provenance: ['release-test'] },
    source: { kind: 'world', world_id: world.worldId, world_hash: world.headHash }, roots: [], nodes: [], edges: [],
  } });
  assert.equal((await call('life_model_questions', { modelHash, graphHash: worldGraph.graphHash })).modelHash, modelHash);
  const unrelated = structuredClone(model);
  unrelated.id = 'unrelated-release-model';
  const other = await call('life_model_register', { requestId: 'unrelated-model', model: unrelated });
  const result = await client.callTool({ name: 'life_model_questions', arguments: { modelHash: other.modelHash, graphHash } });
  assert.equal(result.isError, true, 'graph notes and draws must not be read against another model');
  assert.match(JSON.stringify(result.content), /bound.*model|same model|model.*match/iu);
});

test('whole-note read preserves a report source and its evidence metadata', async (t) => {
  const { call, modelHash, graphHash } = await setup(t);
  const source = { citation: 'Ada, bakery accounts report', url: 'https://example.com/bakery-accounts', published: '2026-10-01', reportsOn: 'September 2026' };
  const recorded = await call('life_understanding_record', { requestId: 'release-report', graphHash, holder: 'reviewer', accessScopes: ['author'],
    notes: [{ nodeId: 'report.debt', kind: 'report', text: 'The accountant reports lower debt.', source,
      data: { interpretation: 'The report is attributed rather than verified.' }, about: [{ record: 'process:bakery.debt_nok' }] }] });
  const read = await call('life_understanding_read', { graphHash: recorded.graphHash, nodeIds: ['report.debt'], accessScopes: ['author'] });
  assert.deepEqual(read.notes[0].source, source);
  assert.equal(read.notes[0].evidenceType, 'report');
  assert.equal(read.notes[0].epistemicStatus, 'externalized_reflection');
  assert.deepEqual(read.notes[0].authority, { source: source.citation, weight: 1 });
  assert.deepEqual(read.notes[0].uncertainty, { kind: 'unknown' });
  assert.equal(read.notes[0].writtenAgainstModel, modelHash);
  assert.deepEqual(read.notes[0].data, { interpretation: 'The report is attributed rather than verified.' });
});

test('scoped native links do not inflate public counts or create missing-structure hints from a partial model', () => {
  const processes = Array.from({ length: 9 }, (_, index) => ({ id: `public.${index}`, update_mode: 'static' }));
  const model = { id: 'partial-native-model', processes: [...processes, { id: 'private.process', access_scopes: ['secret'] }],
    dependencies: [{ id: 'private.link', source: 'private.process', target: 'public.0' }],
    decomposition: [{ id: 'private.decomposition', parent: 'public.0', child: 'private.process' }],
    initial_claims: [{ id: 'private.claim', subject: 'private.process', access_scopes: ['secret'] }],
    laws: [{ id: 'private.law', operator: { target: 'public.0', source: 'private.process' } }],
    meaning_model: { events: Array.from({ length: 8 }, (_, index) => ({ id: `event.${index}` })) } };
  const publicRead = modelQuestions(model, { limit: 80 });
  assert.equal(publicRead.depth.processes, 9);
  for (const field of ['dependencies', 'decompositions', 'claims', 'laws']) assert.equal(publicRead.depth[field], 0, field);
  for (const kind of ['structure-flat', 'laws-missing', 'readings-over-processes']) assert.equal(publicRead.counts[kind], undefined, kind);
  assert.doesNotMatch(JSON.stringify(publicRead), /private\.process|private\.link|private\.law/);
  const full = modelQuestions(model, { accessScopes: ['secret'], limit: 80 });
  assert.equal(full.depth.processes, 10);
  assert.equal(full.depth.dependencies, 1);
  assert.equal(full.scope.completeNativeModel, true);
});

test('questions refuse graph evidence when its model binding is unknown', async () => {
  const service = { inspectModel: async () => ({ model: { id: 'unbound' } }),
    queryNarrativeGraph: async () => ({ graph: { source: { kind: 'world' } }, nodes: [], edges: [] }) };
  await assert.rejects(readOpenQuestions(service, { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64) }), /must be bound to the supplied model/);
});
