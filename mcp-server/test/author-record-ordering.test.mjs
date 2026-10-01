import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { resolveEngineBinary, RustEngineProcess } from '../src/rust-engine-process.mjs';
import { storeAuthorRecord } from '../src/storytelling-authoring.mjs';

const rootId = `story.understanding.${createHash('sha256').update('story').digest('hex').slice(0, 24)}`;
const scopes = ['author', 'editor'];
const provenance = ['author-record ordering regression fixture'];

async function setup(t, siblings) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-author-order-'));
  const service = new LifeSimulationService({ backend: RustEngineProcess.forTestFixture({
    command: resolveEngineBinary(), args: ['--ndjson'], env: { LIFE_SIM_STATE_FILE: join(directory, 'state.sqlite') },
  }) });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.initialize();
  const example = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, modelRequest, graphRequest] = [...example.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const { modelHash } = await service.registerModel(modelRequest);
  const graph = graphRequest.narrativeGraph;
  graph.source.model_hash = modelHash;
  const common = { render: 'exclude', training: 'exclude', access_scopes: scopes,
    authority: { source: 'fixture', weight: 1 }, epistemic_status: 'authored_proposal', evidence_type: 'creative_hypothesis', provenance };
  graph.roots.push(rootId);
  graph.nodes.push({ ...common, id: rootId, node_type: 'understanding_process_root', role: 'metadata', subject: 'story',
    text: JSON.stringify({ clock: 'authoring_step' }) });
  for (const sibling of siblings) {
    graph.nodes.push({ ...common, id: sibling.id, node_type: sibling.type ?? 'storytelling.assessment', role: 'metadata',
      text: 'Inherited private content must not appear in a scoped error.', access_scopes: sibling.scopes ?? scopes });
    graph.edges.push({ id: `${sibling.id}.placement`, source: { kind: 'node', node_id: rootId },
      target: { kind: 'node', node_id: sibling.id }, family: 'structural', relation: 'contains',
      order: sibling.order, access_scopes: sibling.scopes ?? scopes, provenance });
  }
  // A semantic edge with an ordinal is not a sibling placement.
  graph.edges.push({ id: 'author.root.about.story', source: { kind: 'node', node_id: rootId },
    target: { kind: 'node', node_id: 'story' }, family: 'semantic', relation: 'about', order: 1000, provenance });
  const { graphHash } = await service.registerNarrativeGraph(graphRequest);
  const read = (hash, accessScopes = scopes) => service.queryNarrativeGraph({ graphHash: hash, mode: 'full', includeContent: true, accessScopes });
  return { service, graphHash, read };
}

const record = (graphHash, suffix, accessScopes = scopes) => ({ graphHash, requestId: `record.${suffix}`, nodeId: `note.${suffix}`,
  storyRootId: 'story', authorId: 'fixture-editor', accessScopes, kind: 'assessment', text: 'A new assessment of the existing story.' });
const placement = (view, nodeId) => view.edges.find((edge) => edge.family === 'structural' && edge.relation === 'contains' && edge.target.node_id === nodeId);

test('author records append after inherited and edited sibling orders while their clock stays at the graph revision', async (t) => {
  const { service, graphHash, read } = await setup(t, [
    { id: 'inherited.selection', order: 0 },
    { id: 'inherited.reference', order: 3, type: 'model_reference' },
    { id: 'inherited.assessment', order: 356 },
  ]);
  const before = await read(graphHash);
  const input = record(graphHash, 'first');
  const first = await storeAuthorRecord(service, input);
  const firstView = await read(first.graphHash);
  assert.equal(first.authoringStep, 0, 'a fresh imported revision starts at zero despite inherited placement ordinals');
  assert.equal(placement(firstView, first.recordNodeId).order, 357);
  const node = firstView.nodes.find((item) => item.id === first.recordNodeId);
  assert.equal(node.value_time, 0);
  assert.equal(JSON.parse(node.text).authoringClock.at, 0);
  assert.deepEqual(await read(graphHash), before, 'the imported predecessor is unchanged');
  assert.equal((await storeAuthorRecord(service, input)).graphHash, first.graphHash, 'an identical retry stays idempotent');

  const edited = await service.reviseNarrativeGraphByDelta({ requestId: 'reorder-existing', previousGraphHash: first.graphHash, accessScopes: scopes,
    delta: { revision: { number: 2, previous_graph_hash: first.graphHash, reason: 'Reorder an inherited author record.', provenance },
      upsertEdges: [{ ...placement(firstView, 'inherited.assessment'), order: 900 }] } });
  const second = await storeAuthorRecord(service, record(edited.graphHash, 'second'));
  const secondView = await read(second.graphHash);
  assert.equal(second.authoringStep, 2);
  assert.equal(placement(secondView, second.recordNodeId).order, 901, 'mixed metadata and edited siblings share one placement order');
  assert.equal(JSON.parse(secondView.nodes.find((item) => item.id === second.recordNodeId).text).authoringClock.at, 2);
});

test('a hidden inherited sibling collision is refused atomically without guessing orders or widening scopes', async (t) => {
  const { service, graphHash, read } = await setup(t, [
    { id: 'visible.assessment', order: 2, scopes: ['editor'] },
    { id: 'private.assessment', order: 3, scopes: ['author'] },
  ]);
  const queries = [];
  const originalQuery = service.queryNarrativeGraph.bind(service);
  service.queryNarrativeGraph = async (input) => { queries.push(input); return originalQuery(input); };
  await assert.rejects(storeAuthorRecord(service, record(graphHash, 'scoped', ['editor'])), (error) => {
    assert.match(error.message, /existing sibling hidden from this read/);
    assert.match(error.message, /Nothing was written/);
    assert.match(error.message, /complete authorized view/);
    assert.doesNotMatch(error.message, /private\.assessment|Inherited private content/);
    return true;
  });
  assert.ok(queries.length > 0);
  assert.ok(queries.every((input) => input.accessScopes.length === 1 && input.accessScopes[0] === 'editor'));
  const unchanged = await read(graphHash);
  assert.ok(!unchanged.nodes.some((node) => node.id === 'note.scoped'));
  assert.equal(unchanged.graph.revision.number, 0);
  const accepted = await storeAuthorRecord(service, record(graphHash, 'authorized'));
  assert.equal(placement(await read(accepted.graphHash), accepted.recordNodeId).order, 4);
  assert.equal(accepted.authoringStep, 0);
});
