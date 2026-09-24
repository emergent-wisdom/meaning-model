import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { recordUnderstanding } from '../src/construction-record.mjs';

const provenance = ['graph head test'];

test('add-only records need not chain graph hashes: a stale hash goes to the newest head, a retry keeps its receipt, a branch is named', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const model = await service.registerModel({ requestId: 'm', model: { schema: 'life-sim-rust-model/v1', id: 'head-model', time_unit: 'hour', revision: { number: 0, reason: 'Head test.', provenance },
    processes: [{ id: 'p', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['w'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [] } });
  const graph = await service.registerNarrativeGraph({ requestId: 'g', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'head-graph', revision: { number: 0, reason: 'Head test.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'], nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  const note = (requestId, nodeId, graphHash) => recordUnderstanding(service, { graphHash, requestId, accessScopes: ['author'], holder: 'writer',
    notes: [{ nodeId, kind: 'idea', text: `The thought ${nodeId}.`, about: [{ nodeId: 'book' }] }] });
  const first = await note('r1', 'note.1', graph.graphHash);
  const second = await note('r2', 'note.2', graph.graphHash);
  assert.equal(second.advancedFrom, graph.graphHash, 'the stale hash was advanced');
  assert.equal(second.previousGraphHash, first.graphHash, 'to the newest head');
  assert.deepEqual(await note('r2', 'note.2', graph.graphHash), second, 'a retry of a finished request returns its receipt');
  // A branch: two strict batches from the same parent.
  const branch = (requestId, nodeId) => service.applyNarrativeBatch({ requestId, previousGraphHash: second.graphHash, narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1',
    previous_graph_hash: second.graphHash, reason: 'Branch.', provenance, add_roots: [], add_nodes: [{ id: nodeId, node_type: 'note', role: 'metadata', text: nodeId, epistemic_status: 'x',
      evidence_type: 'belief', authority: { source: 'a', weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: [], render: 'exclude', training: 'exclude', provenance }],
    add_edges: [{ id: `e.${nodeId}`, source: { kind: 'node', node_id: 'book' }, target: { kind: 'node', node_id: nodeId }, family: 'structural', relation: 'contains', order: 9, access_scopes: [], provenance }] } });
  await branch('b1', 'branch.a'); await branch('b2', 'branch.b');
  await assert.rejects(note('r3', 'note.3', graph.graphHash), /has branched after .*its heads are .*Pass the head to add to/);
});
