import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { projectDocument, projectNarrativeDocument } from '../src/document-projection.mjs';

const provenance = ['Document-coordinate integration test'];
const endpoint = (node_id) => ({ kind: 'node', node_id });
const node = (id, text, role = 'story_passage') => ({ id, node_type: 'passage', role, text,
  epistemic_status: 'authored', evidence_type: 'fictional_canon', authority: { source: 'author', weight: 1 },
  render: role === 'story_passage' ? 'include' : 'exclude', provenance });
const contains = (id, child, order) => ({ id, source: endpoint('book'), target: endpoint(child), family: 'structural', relation: 'contains', order, provenance });
const span = (overrides = {}) => ({ ...node('span', JSON.stringify({ schema: 'meaning-model-document-span/v1',
  documentId: 'book', start: { nodeId: 'p2', boundary: 'start' }, end: { nodeId: 'p3', boundary: 'end' }, ...overrides }), 'metadata'), node_type: 'document.span' });

async function fixture(t, alter = () => {}) {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const model = await service.registerModel({ requestId: 'model', model: {
    schema: 'life-sim-rust-model/v1', id: 'document-test', time_unit: 'year',
    revision: { number: 0, reason: 'Keep world and document coordinates independent.', provenance },
    processes: [{ id: 'world.signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['test'] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
  } });
  const definition = { schema: 'life-sim-rust-narrative-graph/v1', id: 'document-graph',
    revision: { number: 0, reason: 'Document boundaries with open semantic links.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [node('book', '', 'document_root'), node('p1', 'Å🙂'), node('p2', 'Second.\n\nAgain.'), node('p3', '終'), span()],
    edges: [contains('first', 'p1', 0), contains('second', 'p2', 1), contains('third', 'p3', 2),
      { id: 'span.process', source: endpoint('span'), target: { kind: 'anchor', anchor_kind: 'process', anchor_id: 'world.signal' },
        family: 'semantic', relation: 'interprets_in_another_context', provenance }],
  };
  alter(definition);
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: definition });
  const project = (graphHash = graph.graphHash, accessScopes = []) => projectNarrativeDocument(service, { graphHash, rootId: 'book', accessScopes });
  const edit = (operations, overrides = {}) => editNarrativeGraph(service, { requestId: 'edit', graphHash: graph.graphHash,
    reason: 'Change the document, not the world.', accessScopes: [], operations, ...overrides });
  return { service, graph, project, edit };
}

test('UTF-8 spans follow length edits and preserve identities, open links, world snapshot and predecessor', async (t) => {
  const f = await fixture(t); const before = await f.project();
  assert.equal(before.coordinate, 'utf8_byte');
  assert.equal(before.units[0].end, 6, 'Å and emoji use their actual UTF-8 byte lengths');
  assert.equal(before.spans[0].start, 8);
  assert.equal(before.spans[0].end, Buffer.byteLength('Å🙂\n\nSecond.\n\nAgain.\n\n終'));
  assert.equal(before.spans[0].links[0].relation, 'interprets_in_another_context');
  const edited = await f.edit([{ kind: 'replace_text', nodeId: 'p1', expectedText: 'Å🙂', text: 'Å🙂 more words' }]);
  const after = await f.project(edited.graphHash);
  const shift = Buffer.byteLength(' more words');
  assert.equal(after.spans[0].start, before.spans[0].start + shift);
  assert.equal(after.spans[0].end, before.spans[0].end + shift);
  assert.equal(after.spans[0].length, before.spans[0].length);
  assert.deepEqual(after.spans[0].definition, before.spans[0].definition);
  assert.deepEqual(after.spans[0].links, before.spans[0].links);
  assert.equal(edited.snapshotHash, f.graph.snapshotHash);
  assert.notEqual(after.projectionHash, before.projectionHash);
  assert.deepEqual(await f.project(), before);
});

test('retained split boundaries follow rendered children; extending a child stretches its containing span', async (t) => {
  const f = await fixture(t); const before = await f.project();
  const split = await f.edit([{ kind: 'split', nodeId: 'p2', parts: [{ id: 'p2.a', text: 'Second.' }, { id: 'p2.b', text: 'Again.' }] }]);
  const afterSplit = await f.project(split.graphHash);
  assert.equal(afterSplit.spans[0].start, before.spans[0].start);
  assert.equal(afterSplit.spans[0].end, before.spans[0].end);
  const revised = await f.edit([{ kind: 'replace_text', nodeId: 'p2.b', expectedText: 'Again.', text: 'Again, at greater length.' }],
    { requestId: 'extend', graphHash: split.graphHash });
  const after = await f.project(revised.graphHash);
  assert.equal(after.spans[0].start, before.spans[0].start);
  assert.equal(after.spans[0].length - before.spans[0].length, Buffer.byteLength('Again, at greater length.') - Buffer.byteLength('Again.'));
});

test('reversed and retired merge endpoints remain unresolved instead of silently following another passage', async (t) => {
  const f = await fixture(t);
  const reordered = await f.edit([{ kind: 'reorder', parentNodeId: 'book', nodeIds: ['p3', 'p1', 'p2'] }]);
  assert.equal((await f.project(reordered.graphHash)).spans[0].reason, 'reversed_boundaries');
  const merged = await f.edit([{ kind: 'merge', nodeIds: ['p2', 'p3'], mergedNodeId: 'combined' }], { requestId: 'merge' });
  assert.equal((await f.project(merged.graphHash)).spans[0].reason, 'boundary_not_in_projection');
});

test('scope-limited projections never infer positions or include links through inaccessible content', async (t) => {
  const f = await fixture(t, (graph) => { graph.nodes.find((item) => item.id === 'p2').access_scopes = ['private']; });
  const publicView = await f.project();
  assert.ok(!publicView.units.some((unit) => unit.nodeId === 'p2'));
  assert.equal(publicView.spans[0].reason, 'boundary_not_in_projection');
  assert.equal((await f.project(undefined, ['private'])).spans[0].status, 'resolved');
});

test('out-of-projection containers cannot resolve through shared descendants or shadowed next links', async (t) => {
  const f = await fixture(t, (graph) => {
    graph.roots.push('other-book');
    graph.nodes.push(node('other-book', '', 'document_root'));
    graph.edges.push({ ...contains('other.second', 'p2', 0), source: endpoint('other-book') });
    graph.edges.push({ id: 'shadowed.next', source: endpoint('book'), target: endpoint('other-book'),
      family: 'structural', relation: 'next', provenance });
    graph.nodes.find((item) => item.id === 'span').text = span({
      start: { nodeId: 'other-book', boundary: 'start' },
      end: { nodeId: 'other-book', boundary: 'end' },
    }).text;
  });
  const projected = await f.project();
  assert.ok(projected.units.some((unit) => unit.nodeId === 'p2'), 'the shared descendant really is rendered');
  assert.equal(projected.spans[0].status, 'unresolved');
  assert.equal(projected.spans[0].reason, 'boundary_not_in_projection');
});

test('positions use the exact native empty-unit join policy; other documents and malformed records stay distinct', () => {
  const nodes = [node('book', '', 'document_root'), node('a', 'A'), node('empty', ''), node('b', 'é'),
    span({ start: { nodeId: 'a', boundary: 'end' }, end: { nodeId: 'a', boundary: 'end' } }),
    { ...span({ documentId: 'another-book' }), id: 'other.span' }, { ...span(), id: 'invalid', text: '{}' }];
  const rendered = { graph_hash: 'g', projection_hash: 'p', roots: ['book'], join_policy: 'blank_line',
    units: nodes.slice(0, 4).map((node) => ({ node_id: node.id, text: node.text, role: node.role })), text: 'A\n\né' };
  const edges = ['a', 'empty', 'b'].map((id, index) => contains(`book.${id}`, id, index));
  const result = projectDocument({ rendered, nodes, edges, rootId: 'book' });
  assert.deepEqual(result.units.map(({ start, end }) => [start, end]), [[0, 0], [0, 1], [1, 1], [3, 5]]);
  assert.equal(result.spans[0].length, 0);
  assert.equal(result.spans[1].reason, 'invalid_span_record');
  assert.equal(result.spans.length, 2);
  assert.throws(() => projectDocument({ rendered: { ...rendered, text: 'normalized' }, nodes, edges: [], rootId: 'book' }), /canonical text/);
  assert.throws(() => projectDocument({ rendered: { ...rendered, roots: ['book', 'another-book'] }, nodes, edges: [], rootId: 'book' }), /one exact/);
});

test('whole-document boundaries include native next chains and resolve an empty document', async (t) => {
  const f = await fixture(t, (graph) => {
    graph.nodes.find((item) => item.id === 'span').text = span({ start: { nodeId: 'book', boundary: 'start' }, end: { nodeId: 'book', boundary: 'end' } }).text;
    graph.edges = graph.edges.filter((edge) => !['second', 'third'].includes(edge.id));
    graph.edges.push({ id: 'next.two', source: endpoint('p1'), target: endpoint('p2'), family: 'structural', relation: 'next', order: 0, provenance });
    graph.edges.push({ id: 'next.three', source: endpoint('p2'), target: endpoint('p3'), family: 'structural', relation: 'next', order: 0, provenance });
  });
  const projected = await f.project();
  assert.equal(projected.spans[0].start, 0);
  assert.equal(projected.spans[0].end, projected.byteLength);
  const nodes = [node('book', '', 'document_root'), span({ start: { nodeId: 'book', boundary: 'start' }, end: { nodeId: 'book', boundary: 'end' } })];
  const empty = projectDocument({ rendered: { graph_hash: 'g', projection_hash: 'p', roots: ['book'], join_policy: 'blank_line', units: [], text: '' }, nodes, edges: [], rootId: 'book' });
  assert.equal(empty.spans[0].status, 'resolved');
  assert.equal(empty.spans[0].length, 0);
});
