// A record read back from a query can be written again as it came: the fields a query adds for display
// (boundary, content_included) are dropped on write (found by the 2026-09-23 instruction test).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';

test('a node copied from a query view is accepted by a batch, a revision by change and a registration', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel({ requestId: 'model', model: registerRequest.model });
  const graph = structuredClone(graphRequest.narrativeGraph);
  graph.source.model_hash = registered.modelHash;
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graph });
  const view = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: [] });
  const fact = view.nodes.find((node) => node.id === 'canon.offer');
  assert.ok('content_included' in fact, 'the query adds projection fields');
  const copy = { ...fact, id: 'canon.offer.copy' };
  const batch = await service.applyNarrativeBatch({ requestId: 'copy', previousGraphHash: stored.graphHash, narrativeBatch: {
    schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: stored.graphHash, reason: 'Copy a record read from a query.', provenance: ['test'],
    add_roots: [], add_nodes: [copy], add_edges: [{ id: 'story.contains.copy', source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: 'canon.offer.copy' }, family: 'structural', relation: 'contains', order: 5, provenance: ['test'] }] } });
  assert.ok(batch.graphHash);
  const revised = await service.reviseNarrativeGraphByDelta({ requestId: 'retitle', previousGraphHash: batch.graphHash, delta: {
    revision: { number: 2, previous_graph_hash: batch.graphHash, reason: 'Retitle the copy.', provenance: ['test'] },
    upsertNodes: [{ ...copy, title: 'A copied fact' }] } });
  assert.ok(revised.graphHash);
});
