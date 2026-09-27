import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulationService } from '../src/service.mjs';
import { exportConstructionHistory, importConstructionHistory, MODEL_REFERENCE_SCHEMA } from '../src/construction-record.mjs';

const provenance = ['portable declared-model dependencies fixture'];
const model = (id, accessScopes = []) => ({ schema: 'life-sim-rust-model/v1', id, time_unit: 'year',
  revision: { number: 0, reason: 'A separate life model.', provenance },
  processes: [{ id: 'signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
    initial_value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' }, unit: 'fraction', support: ['world'], access_scopes: accessScopes, provenance }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [] });
const record = (id, nodeType, payload) => ({ id, node_type: nodeType, role: 'metadata', text: JSON.stringify(payload),
  render: 'exclude', training: 'exclude', epistemic_status: 'authored', evidence_type: 'report', authority: { source: 'fixture-agent', weight: 1 }, provenance });
const reference = (modelHash) => record('external.reference', 'model_reference', { schema: MODEL_REFERENCE_SCHEMA, modelHash, record: 'process:signal' });
const authorReader = (authorModelHash, readerModelHash = null) => record('world.author_reader', 'storytelling.world', {
  schema: 'meaning-model-story-author-record/v1', kind: 'world',
  data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader',
    author: { personId: 'author', lifeModelHash: authorModelHash }, reader: readerModelHash ? { personId: 'reader', lifeModelHash: readerModelHash } : null } });
async function serviceFor(t) { const service = new LifeSimulationService(); await service.initialize(); t.after(() => service.close()); return service; }
async function graphFor(service, nodes = []) {
  const source = await service.registerModel({ requestId: 'story-model', model: model('story-world') });
  return service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'portable-work',
    revision: { number: 0, reason: 'Record declared external life dependencies.', provenance }, source: { kind: 'model', model_hash: source.modelHash }, roots: ['book'],
    nodes: [{ ...record('book', 'book', {}), role: 'document_root', text: '' }, ...nodes],
    edges: nodes.map((node, order) => ({ id: `book.${order}`, source: { kind: 'node', node_id: 'book' }, target: { kind: 'node', node_id: node.id }, family: 'structural', relation: 'contains', order, provenance })) } });
}

test('portable history includes explicit external author/reader lives and reference ancestry once, and restores them exactly', async (t) => {
  const source = await serviceFor(t), target = await serviceFor(t);
  const author = await source.registerModel({ requestId: 'author', model: model('author-life') });
  const successor = model('author-life'); successor.processes[0].initial_value.value = 0.6;
  successor.revision = { number: 1, previous_model_hash: author.modelHash, reason: 'The author life develops.', provenance };
  const later = await source.reviseModel({ requestId: 'author-later', previousModelHash: author.modelHash, model: successor });
  const reader = await source.registerModel({ requestId: 'reader', model: model('reader-life') });
  const graph = await graphFor(source, [reference(later.modelHash), authorReader(later.modelHash, reader.modelHash)]);
  const history = await exportConstructionHistory(source, { graphHash: graph.graphHash });
  assert.equal(history.models.length, 4, 'main world, author parent, author successor and reader are portable');
  assert.equal(history.models.filter((entry) => entry.modelHash === later.modelHash).length, 1);
  assert.ok(history.models.findIndex((entry) => entry.modelHash === author.modelHash) < history.models.findIndex((entry) => entry.modelHash === later.modelHash));
  const imported = await importConstructionHistory(target, { requestId: 'restore', history });
  assert.equal(imported.headGraphHash, graph.graphHash);
  for (const modelHash of [author.modelHash, later.modelHash, reader.modelHash]) {
    assert.deepEqual((await target.inspectModel({ modelHash, includeDefinition: true })).model,
      (await source.inspectModel({ modelHash, includeDefinition: true })).model);
  }
  assert.equal((await exportConstructionHistory(target, { graphHash: imported.headGraphHash })).bundleSha256, history.bundleSha256);
});

test('an external life with private records cannot be exported using public graph scopes', async (t) => {
  const service = await serviceFor(t);
  const life = await service.registerModel({ requestId: 'private-life', model: model('private-author-life', ['private-life']) });
  const graph = await graphFor(service, [authorReader(life.modelHash)]);
  await assert.rejects(exportConstructionHistory(service, { graphHash: graph.graphHash }), /scoped model record.*accessScopes/);
  const allowed = await exportConstructionHistory(service, { graphHash: graph.graphHash, accessScopes: ['private-life'] });
  assert.equal(allowed.models.length, 2);
});

test('missing explicitly referenced models refuse export with the declaring node and repair instruction', async (t) => {
  for (const node of [reference('a'.repeat(64)), authorReader('b'.repeat(64))]) {
    const service = await serviceFor(t); const graph = await graphFor(service, [node]);
    await assert.rejects(exportConstructionHistory(service, { graphHash: graph.graphHash }), (error) => {
      assert.match(error.message, new RegExp(node.id.replaceAll('.', '\\.')));
      assert.match(error.message, /Import or restore that declared model and its ancestry/);
      assert.match(error.message, /no incomplete bundle was exported/); return true;
    });
  }
});

test('standalone exports remain one model and arbitrary JSON hashes do not create dependencies', async (t) => {
  const service = await serviceFor(t);
  const graph = await graphFor(service, [record('ordinary.note', 'understanding.note', {
    schema: 'arbitrary-notes/v1', lifeModelHash: 'a'.repeat(64), modelHash: 'b'.repeat(64), quoted: { schema: MODEL_REFERENCE_SCHEMA, modelHash: 'c'.repeat(64) } })]);
  const history = await exportConstructionHistory(service, { graphHash: graph.graphHash });
  assert.equal(history.models.length, 1);
  const target = await serviceFor(t);
  assert.equal((await importConstructionHistory(target, { requestId: 'restore-standalone', history })).headGraphHash, graph.graphHash);
});
