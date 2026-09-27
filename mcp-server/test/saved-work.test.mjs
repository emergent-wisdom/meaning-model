import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LifeSimulationService } from '../src/service.mjs';
import { listSavedWork, registerSavedWorkTools, savedWorkSchema } from '../src/saved-work.mjs';

const hash = (digit) => digit.repeat(64);
function fakeService() {
  const revisions = [
    { graph_id: 'shared', graph_hash: hash('a'), revision_number: 0, operation_sequence: 1 },
    { graph_id: 'shared', graph_hash: hash('b'), revision_number: 1, operation_sequence: 2 },
    { graph_id: 'private-graph-id', graph_hash: hash('d'), revision_number: 4, operation_sequence: 3 },
    { graph_id: 'shared', graph_hash: hash('c'), revision_number: 1, operation_sequence: 4 },
  ];
  const calls = [];
  return { calls,
    async listNarrativeRevisions({ graphId }) {
      const selected = revisions.filter((row) => graphId === null || row.graph_id === graphId);
      return { revisions: selected, heads: selected.filter((row) => row.graph_hash !== hash('a')).map((row) => row.graph_hash) };
    },
    async queryNarrativeGraph(input) {
      calls.push(input); const privateWork = input.graphHash === hash('d');
      const allowed = !privateWork || input.accessScopes.includes('private');
      return { graph_hash: input.graphHash, graph: { id: privateWork ? 'private-graph-id' : 'shared', node_count: 87654321,
        source: { kind: 'model', model_hash: hash('e') }, revision: { reason: 'private-revision-reason', provenance: ['private-history'] } },
        visible_node_count: allowed ? 2 : 0, visible_edge_count: allowed ? 1 : 0,
        roots: allowed ? [{ id: privateWork ? 'private-root' : `root-${input.graphHash[0]}`, role: 'document_root', title: privateWork ? 'Private title' : 'Visible title', access_scopes: ['not-returned'], text: 'Not a preview' }] : [] };
    },
  };
}

test('catalog discovers visible heads without copying hidden graph metadata or content', async () => {
  const service = fakeService(), result = await listSavedWork(service, {}), serialized = JSON.stringify(result);
  assert.deepEqual(result.heads.map((head) => head.graphHash), [hash('c'),hash('b')]);
  for (const value of ['private-graph-id',hash('d'),'Private title','private-revision-reason','private-history','87654321','not-returned','Not a preview']) assert.ok(!serialized.includes(value), value);
  assert.equal(result.heads[0].title, 'Visible title'); assert.equal(result.heads[0].titleSource, 'visible_root_title'); assert.equal(result.heads[0].visibleNodeCount, 2);
  assert.deepEqual(result.heads[0].replay.arguments, { graphHash: hash('c'), accessScopes: [], level: 'outline' });
  assert.deepEqual(result.heads[0].viewer.arguments, { graphHash: hash('c'), accessScopes: [] });
  assert.ok(service.calls.every((call) => call.mode === 'skeleton' && call.includeContent === false && call.expectedGraphHash === call.graphHash));
});

test('pagination counts visible heads only and never replaces alternative branches with newest', async () => {
  const service = fakeService();
  const first = await listSavedWork(service, { limit: 1 });
  assert.equal(first.window.nextOffset, 1); assert.equal(first.heads[0].graphHash, hash('c'));
  const second = await listSavedWork(service, { offset: first.window.nextOffset, limit: 1 });
  assert.equal(second.window.nextOffset, null); assert.equal(second.heads[0].graphHash, hash('b'));
  const scoped = await listSavedWork(service, { accessScopes: ['private','private'] });
  assert.deepEqual(scoped.heads.map((head) => head.graphHash), [hash('c'),hash('d'),hash('b')]);
  assert.equal(scoped.heads[1].title, 'Private title'); assert.deepEqual(scoped.heads[1].replay.arguments.accessScopes, ['private']);
  const filtered = await listSavedWork(service, { graphId: 'private-graph-id' });
  assert.deepEqual(filtered.heads, []); assert.equal(filtered.window.nextOffset, null);
});

test('a scoped projection need not expose a title or imply complete viewer access', async () => {
  const service = fakeService(), query = service.queryNarrativeGraph;
  service.queryNarrativeGraph = async (input) => { const view = await query(input); view.roots = []; view.graph.source = { kind: 'world' }; return view; };
  const result = await listSavedWork(service, {});
  assert.equal(result.heads[0].title, 'shared'); assert.equal(result.heads[0].titleSource, 'graph_id'); assert.deepEqual(result.heads[0].roots, []);
  assert.equal(result.heads[0].viewer, undefined); assert.match(result.visibility, /do not establish access to the complete author view/);
  assert.match(result.scope, /Models without a narrative\/understanding graph are not enumerated/);
});

test('registered public tool is read-only, bounded and strict', async () => {
  const registrations = [];
  registerSavedWorkTools({ registerTool: (...args) => registrations.push(args) }, fakeService(), { toolResult: (value) => value });
  const [name, config, call] = registrations[0];
  assert.equal(name, 'life_saved_work_list'); assert.equal(config.annotations.readOnlyHint, true);
  assert.throws(() => savedWorkSchema.parse({ limit: 26 })); assert.throws(() => savedWorkSchema.parse({ offset: -1 }));
  assert.throws(() => savedWorkSchema.parse({ accessScopes: ['a'.repeat(1_025)] })); assert.throws(() => savedWorkSchema.parse({ includeHidden: true }));
  assert.equal((await call({})).heads.length, 2);
});

test('every catalog response identifies persistence and does not equate an empty scope with no work', async () => {
  for (const [mode, durable] of [['process-memory',false], ['optional-single-writer-state-file',true], ['unknown',null]]) {
    const service = fakeService(); service.backend = { status: () => ({ persistenceMode: mode }) };
    const result = await listSavedWork(service, { graphId: 'private-graph-id' });
    assert.deepEqual(result.heads, []); assert.equal(result.persistence.mode, mode); assert.equal(result.persistence.durableGraphRecords, durable);
    if (mode === 'process-memory') assert.match(result.persistence.warning, /disappear on restart/);
    assert.match(result.visibility, /empty page does not establish.*no stored work/);
  }
});

test('real native scope projection hides an entire book and preserves both visible successor heads', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const model = await service.registerModel({ ...registerRequest, requestId: 'catalog-model' });
  const graph = structuredClone(graphRequest.narrativeGraph); graph.source.model_hash = model.modelHash;
  graph.nodes = graph.nodes.map((node) => ({ ...node, access_scopes: ['author'] }));
  graph.edges = graph.edges.map((edge) => ({ ...edge, access_scopes: ['author'] }));
  const stored = await service.registerNarrativeGraph({ requestId: 'catalog-graph', narrativeGraph: graph });
  const headHashes = [];
  for (const [index, reason] of ['private branch reason A', 'private branch reason B'].entries()) {
    const next = structuredClone(graph); next.revision = { number: 1, previous_graph_hash: stored.graphHash, reason, provenance: ['private branch provenance'] };
    const result = await service.reviseNarrativeGraph({ requestId: `catalog-branch-${index}`, previousGraphHash: stored.graphHash, narrativeGraph: next });
    headHashes.push(result.graphHash);
  }
  assert.deepEqual((await listSavedWork(service, {})).heads, []);
  const listed = await listSavedWork(service, { accessScopes: ['author'], graphId: graph.id });
  assert.deepEqual(new Set(listed.heads.map((head) => head.graphHash)), new Set(headHashes));
  assert.ok(listed.heads.every((head) => head.modelHash === model.modelHash && head.revision === 1));
  const resultText = JSON.stringify(listed); assert.ok(!resultText.includes('private branch reason')); assert.ok(!resultText.includes('private branch provenance'));
  const visibleRoot = listed.heads.flatMap((head) => head.roots).find((node) => node.nodeId === 'story');
  assert.ok(visibleRoot, 'native skeleton roots are projected node objects');
});
