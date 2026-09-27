import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireCompleteModelScopes } from '../src/construction-scope.mjs';
import { exportConstructionHistory } from '../src/construction-record.mjs';

const hash = (digit) => digit.repeat(64);

function fixture({ privateAncestor = false } = {}) {
  const graphHash = hash('a'), modelHash = hash('b'), parentHash = hash('c');
  const privateRecord = { id: 'unanchored-private-process', access_scopes: ['author'],
    initial_value: { kind: 'scalar', value: 0.25 }, provenance: ['PRIVATE-MODEL-EVIDENCE'] };
  const model = { schema: 'test-model', id: 'model', revision: { number: privateAncestor ? 1 : 0,
    ...(privateAncestor ? { previous_model_hash: parentHash } : {}) },
    processes: privateAncestor ? [] : [privateRecord] };
  const ancestor = { schema: 'test-model', id: 'model', revision: { number: 0 }, processes: [privateRecord] };
  const definition = { schema: 'life-sim-rust-narrative-graph/v1', id: 'public-book',
    revision: { number: 0, previous_graph_hash: null, reason: 'Initial public text', provenance: [] },
    source: { kind: 'model', model_hash: modelHash }, roots: ['book'],
    nodes: [{ id: 'book', role: 'document_root', node_type: 'book', text: 'Public prose.', access_scopes: [] }], edges: [] };
  const service = {
    async queryNarrativeGraph() {
      return { graph_hash: graphHash, content_included: true, for_revision: true,
        graph: { ...definition, node_count: 1, edge_count: 0, root_count: 1 },
        roots: definition.roots, nodes: definition.nodes, edges: [] };
    },
    async listNarrativeRevisions() { return { revisions: [{ graph_hash: graphHash, previous_graph_hash: null }], heads: [graphHash] }; },
    async inspectModel({ modelHash: requested }) { return { modelHash: requested, model: requested === modelHash ? model : ancestor }; },
  };
  return { service, graphHash };
}

test('complete model exports check nested scopes without inventing restrictions for public records', () => {
  requireCompleteModelScopes({ processes: [{ access_scopes: [] }], description: 'Public' }, []);
  const model = { initial_claims: [{ access_scopes: ['author'] }], processes: [{ initial_value: {
    kind: 'graph', value: { nodes: [{ access_scopes: ['reviewer'] }] } } }] };
  assert.throws(() => requireCompleteModelScopes(model, []), /scoped model record/);
  assert.throws(() => requireCompleteModelScopes(model, ['author']), /scoped model record/);
  assert.doesNotThrow(() => requireCompleteModelScopes(model, ['author', 'reviewer']));
});

test('a public graph cannot export unanchored private model records or private ancestors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-export-scopes-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const privateAncestor of [false, true]) {
    const { service, graphHash } = fixture({ privateAncestor });
    const destinationPath = join(directory, `blocked-${privateAncestor}.json`);
    await assert.rejects(exportConstructionHistory(service, { graphHash, accessScopes: [] }), /scoped model record/);
    await assert.rejects(exportConstructionHistory(service, { graphHash, accessScopes: [], destinationPath }), /scoped model record/);
    await assert.rejects(stat(destinationPath), { code: 'ENOENT' }, 'refusal leaves no partial export file');
    const allowed = await exportConstructionHistory(service, { graphHash, accessScopes: ['author'], destinationPath });
    const restored = JSON.parse(await readFile(destinationPath, 'utf8'));
    assert.equal(restored.bundleSha256, allowed.bundleSha256);
    assert.equal(restored.models.length, privateAncestor ? 2 : 1);
    assert.ok(restored.models.some((entry) => entry.definition.processes.some((record) => record.id === 'unanchored-private-process')));
  }
});
