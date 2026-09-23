import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { editNarrativeGraph, narrativeEditSchema } from '../src/narrative-editing.mjs';

const provenance = ['native narrative editing integration test'];
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
const scopes = ['author', 'secret'];
const byId = (records, id) => records.find((record) => record.id === id);
const leaf = (id, text) => ({ id, node_type: 'paragraph', role: 'story_passage', text,
  epistemic_status: 'fictional_canon', evidence_type: 'fictional_canon',
  authority: { source: 'author', weight: 1 }, render: 'include', training: 'include', provenance });
const container = (id, role = 'metadata') => ({ id, node_type: 'section', role,
  epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon',
  render: 'exclude', training: 'exclude', provenance });
const edge = (id, from, to, relation, order, access_scopes = []) => ({ id, source: endpoint(from), target: endpoint(to),
  family: relation === 'contains' || relation === 'next' ? 'structural' : 'semantic', relation,
  ...(order === undefined ? {} : { order }), access_scopes, provenance });

async function fixture(t, alter = () => {}) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const model = await service.registerModel({ requestId: 'model', model: {
    schema: 'life-sim-rust-model/v1', id: 'narrative-editing-model', time_unit: 'day',
    revision: { number: 0, reason: 'Test graph edits over one fixed model.', provenance },
    processes: [{ id: 'signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, uncertainty: { kind: 'exact' },
      unit: 'fraction', provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
  } });
  const definition = { schema: 'life-sim-rust-narrative-graph/v1', id: 'editable-graph',
    revision: { number: 0, reason: 'Test immutable narrative editing.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [container('book', 'document_root'), container('chapter.one'), container('chapter.two'),
      leaf('p1', 'First.\n\nSecond.'), leaf('p2', 'Third.'), leaf('p3', 'Fourth.'), leaf('q1', 'Elsewhere.'),
      { ...container('private.note'), text: 'Keep this unrelated private note.',
        authority: { source: 'author', weight: 1 }, access_scopes: ['secret'] },
      ...['review.scene', 'review.about'].map((id) => ({ ...container(id, 'externalized_reflection'),
        text: 'A scoped assessment of the previous version.', holder: 'author', subject: 'chapter.one',
        authority: { source: 'author', weight: 1 }, access_scopes: ['author'] }))],
    edges: [edge('book.one', 'book', 'chapter.one', 'contains', 0), edge('book.two', 'book', 'chapter.two', 'contains', 1),
      edge('book.private', 'book', 'private.note', 'contains', 2, ['secret']),
      edge('one.p1', 'chapter.one', 'p1', 'contains', 0), edge('one.p2', 'chapter.one', 'p2', 'contains', 1),
      edge('one.p3', 'chapter.one', 'p3', 'contains', 2), edge('two.q1', 'chapter.two', 'q1', 'contains', 0),
      edge('one.review', 'chapter.one', 'review.scene', 'reviewed_by', undefined, ['author']),
      edge('book.review', 'book', 'review.about', 'reviewed_by', undefined, ['author']),
      edge('review.about.p2', 'review.about', 'p2', 'about', undefined, ['author']),
      { id: 'p1.anchor', source: endpoint('p1'), target: { kind: 'anchor', anchor_kind: 'model', anchor_id: model.modelHash, path: '/id' },
        family: 'grounding', relation: 'grounded_in', explanation: 'Keep this exact model reference.', provenance }],
  };
  alter(definition);
  const registered = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: definition });
  const read = (graphHash = registered.graphHash, accessScopes = scopes) => service.queryNarrativeGraph({
    graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes });
  const render = (graphHash = registered.graphHash, accessScopes = scopes) => service.renderNarrativeGraph({
    graphHash, expectedGraphHash: graphHash, rootIds: ['book'], accessScopes });
  const history = () => service.backend.call('list_narrative_revisions', { narrative_history: { graph_id: definition.id } });
  const input = (operations, overrides = {}) => ({ requestId: 'edit', graphHash: registered.graphHash,
    accessScopes: scopes, reason: 'Make an explicit structural edit.', operations, ...overrides });
  return { service, registered, definition, read, render, history, input };
}

test('split preserves exact prose, native next traversal, anchors, scopes, and immutable history', async (t) => {
  const f = await fixture(t, (graph) => {
    graph.nodes.push(leaf('continuation', 'A continuation.'));
    graph.edges.push(edge('p1.next', 'p1', 'continuation', 'next', 0));
  });
  const before = await f.read();
  const renderedBefore = await f.render();
  assert.ok(['', null].includes(byId(before.nodes, 'book').text), 'normalized textless containers are editable');
  const input = f.input([{ kind: 'split', nodeId: 'p1', parts: [{ id: 'p1.a', text: 'First.' }, { id: 'p1.b', text: 'Second.' }] }]);
  const result = await editNarrativeGraph(f.service, input);
  const after = await f.read(result.graphHash);
  assert.equal(result.snapshotHash, f.registered.snapshotHash);
  assert.equal(after.graph.revision.number, 1);
  assert.equal(after.graph.revision.previous_graph_hash, f.registered.graphHash);
  assert.equal((await f.render(result.graphHash)).text, renderedBefore.text);
  assert.equal(byId(after.nodes, 'p1').render, 'exclude');
  assert.equal(byId(after.nodes, 'p1').training, 'exclude');
  assert.equal(byId(after.nodes, 'p1').text, byId(before.nodes, 'p1').text);
  assert.deepEqual(byId(after.nodes, 'p1.a').authority, byId(before.nodes, 'p1').authority);
  assert.deepEqual(byId(after.nodes, 'p1.a').access_scopes, byId(before.nodes, 'p1').access_scopes);
  assert.deepEqual(byId(after.edges, 'p1.anchor'), byId(before.edges, 'p1.anchor'));
  assert.equal(byId(after.edges, 'p1.next').source.node_id, 'p1.b');
  assert.equal(after.edges.filter((item) => item.relation === 'split_from').length, 2);
  assert.ok(result.affectedReviewNodeIds.includes('review.scene'), 'ancestor scene review needs refreshing');
  assert.ok(result.affectedReviewNodeIds.includes('review.about'), 'whole-document review also needs refreshing');
  assert.equal(result.semanticVerification, false);
  assert.equal(result.semanticLinkReassignment, false);
  assert.deepEqual(await f.read(), before);
  assert.deepEqual(await editNarrativeGraph(f.service, input), result, 'identical retry reuses the same receipt');
  await assert.rejects(editNarrativeGraph(f.service, { ...input, reason: 'A changed reason with the same request ID.' }), /already bound to a different/);
  assert.equal((await f.history()).revisions.length, 2);

  const revised = await editNarrativeGraph(f.service, f.input([
    { kind: 'replace_text', nodeId: 'p1.a', expectedText: 'First.', text: 'Changed first.' },
  ], { requestId: 'edit-one-child', graphHash: result.graphHash }));
  const revisedView = await f.read(revised.graphHash);
  assert.equal((await f.render(revised.graphHash)).text, renderedBefore.text.replace('First.', 'Changed first.'));
  assert.deepEqual(byId(revisedView.nodes, 'p1.b'), byId(after.nodes, 'p1.b'));
  assert.deepEqual(byId(revisedView.nodes, 'review.scene'), byId(after.nodes, 'review.scene'));
  assert.ok(revised.affectedReviewNodeIds.includes('review.scene'));
  assert.equal((await f.render(result.graphHash)).text, renderedBefore.text);
});

test('merge retains original IDs and semantic evidence as history without rendering duplicate prose', async (t) => {
  const f = await fixture(t, (graph) => {
    for (const id of ['one.p1', 'one.p2']) {
      const item = byId(graph.edges, id);
      item.access_scopes = ['author'];
      item.explanation = 'A private ordering choice.';
    }
  });
  const before = await f.read();
  const publicBefore = await f.render(undefined, []);
  const result = await editNarrativeGraph(f.service, f.input([{ kind: 'merge', nodeIds: ['p1', 'p2'], mergedNodeId: 'merged' }]));
  const after = await f.read(result.graphHash);
  assert.equal((await f.render(result.graphHash)).text, (await f.render()).text);
  assert.equal((await f.render(result.graphHash, [])).text, publicBefore.text, 'private placements stay private');
  assert.equal(byId(after.nodes, 'merged').text, 'First.\n\nSecond.\n\nThird.');
  assert.deepEqual(byId(after.nodes, 'merged').access_scopes, ['author'], 'combined text inherits private ordering access');
  assert.equal(byId((await f.read(result.graphHash, [])).nodes, 'merged'), undefined, 'public queries cannot expose the private combination');
  await assert.rejects(f.service.renderNarrativeGraph({ graphHash: result.graphHash, rootIds: ['merged'], accessScopes: [] }),
    /unknown or inaccessible/, 'explicit-root rendering cannot bypass private ordering access');
  for (const id of ['p1', 'p2']) {
    assert.equal(byId(after.nodes, id).text, byId(before.nodes, id).text);
    assert.equal(byId(after.nodes, id).render, 'exclude');
    assert.equal(byId(after.nodes, id).training, 'exclude');
    assert.ok(after.edges.some((item) => item.relation === 'merged_from' && item.source.node_id === 'merged' && item.target.node_id === id));
  }
  const placement = after.edges.find((item) => item.relation === 'contains' && item.source.node_id === 'chapter.one' && item.target.node_id === 'merged');
  assert.deepEqual(placement.access_scopes, ['author']);
  assert.equal(placement.explanation, 'A private ordering choice.');
  assert.deepEqual(byId(after.edges, 'p1.anchor'), byId(before.edges, 'p1.anchor'));
  assert.deepEqual(byId(after.edges, 'review.about.p2'), byId(before.edges, 'review.about.p2'));
  assert.deepEqual(byId(after.nodes, 'private.note'), byId(before.nodes, 'private.note'));
  assert.deepEqual(byId(after.edges, 'book.private'), byId(before.edges, 'book.private'));
  assert.deepEqual(result.affectedReviewNodeIds, ['review.about', 'review.scene']);
  assert.deepEqual([...result.directlyAffectedReviewNodeIds, ...result.ancestorReviewNodeIds].sort(), result.affectedReviewNodeIds, 'direct and ancestor review lists partition the affected reviews');
  assert.ok(result.directlyAffectedReviewNodeIds.every((id) => !result.ancestorReviewNodeIds.includes(id)));
  assert.ok(result.changedEdgeIds.includes('one.p1'), 'removed placements are explicit in the receipt');
  assert.deepEqual(await f.read(), before);
  assert.ok(!after.edges.some((item) => item.source.node_id === 'merged' && item.relation === 'contains'),
    'merged history uses lineage links so the new node remains an editable leaf');
  const split = await editNarrativeGraph(f.service, f.input([
    { kind: 'split', nodeId: 'merged', parts: [{ id: 'merged.a', text: 'First.\n\nSecond.' }, { id: 'merged.b', text: 'Third.' }] },
  ], { requestId: 'split-merged', graphHash: result.graphHash }));
  assert.equal((await f.render(split.graphHash)).text, (await f.render()).text);
  assert.equal((await f.render(split.graphHash, [])).text, publicBefore.text);
});

test('move, reorder and replacement compose into one successor while preserving IDs and subtrees', async (t) => {
  const f = await fixture(t, (graph) => {
    graph.nodes.push(leaf('nested.a', 'Nested A.'), leaf('nested.b', 'Nested B.'));
    byId(graph.nodes, 'p3').render = 'exclude';
    graph.edges.push(edge('p3.a', 'p3', 'nested.a', 'contains', 0), edge('a.next.b', 'nested.a', 'nested.b', 'next', 0));
    // Both nodes are in the moved contains subtree; the internal next edge is retained.
    graph.edges.push(edge('p3.b', 'p3', 'nested.b', 'contains', 1));
  });
  const before = await f.read();
  const result = await editNarrativeGraph(f.service, f.input([
    { kind: 'move', nodeId: 'p3', parentNodeId: 'chapter.two', index: 1 },
    { kind: 'reorder', parentNodeId: 'chapter.one', nodeIds: ['p2', 'p1'] },
    { kind: 'replace_text', nodeId: 'p2', expectedText: 'Third.', text: 'Third, revised.' },
  ]));
  const after = await f.read(result.graphHash);
  assert.equal(after.graph.revision.number, 1);
  assert.equal((await f.history()).revisions.length, 2, 'no intermediate partial graphs are stored');
  assert.deepEqual(after.nodes.map((item) => item.id), before.nodes.map((item) => item.id));
  assert.equal(byId(after.edges, 'one.p3').source.node_id, 'chapter.two');
  assert.equal(byId(after.edges, 'one.p3').order, 1);
  assert.equal(byId(after.edges, 'one.p2').order, 0);
  assert.equal(byId(after.edges, 'one.p1').order, 1);
  assert.deepEqual(byId(after.edges, 'p3.a'), byId(before.edges, 'p3.a'));
  assert.deepEqual(byId(after.edges, 'a.next.b'), byId(before.edges, 'a.next.b'));
  assert.equal((await f.render(result.graphHash)).text, 'Third, revised.\n\nFirst.\n\nSecond.\n\nElsewhere.\n\nNested A.\n\nNested B.');
  assert.deepEqual(await f.read(), before);
});

test('partial scopes, stale text, conflicting requests and a late invalid operation cannot erase or partly update a graph', async (t) => {
  const f = await fixture(t);
  const before = await f.read();
  const replace = { kind: 'replace_text', nodeId: 'p2', expectedText: 'Third.', text: 'New.' };
  for (const accessScopes of [[], ['author'], ['secret']]) {
    await assert.rejects(editNarrativeGraph(f.service, f.input([replace], { accessScopes })), /incomplete scoped view/);
  }
  await assert.rejects(editNarrativeGraph(f.service, f.input([{ ...replace, expectedText: 'An obsolete sentence.' }])), /Text changed/);
  await assert.rejects(editNarrativeGraph(f.service, f.input([replace,
    { kind: 'move', nodeId: 'chapter.one', parentNodeId: 'p1', index: 0 },
  ])), /own subtree/);
  assert.deepEqual(await f.read(), before);
  assert.equal((await f.history()).revisions.length, 1);
  const result = await editNarrativeGraph(f.service, f.input([replace]));
  await assert.rejects(editNarrativeGraph(f.service, f.input([
    { ...replace, text: 'Temporary.' }, { ...replace, expectedText: 'Temporary.' },
  ])), /already bound to a different/, 'request identity includes operations even if final prose is identical');
  const after = await f.read(result.graphHash);
  assert.deepEqual(byId(after.nodes, 'private.note'), byId(before.nodes, 'private.note'));
  assert.deepEqual(byId(after.edges, 'book.private'), byId(before.edges, 'book.private'));
  assert.equal((await f.history()).revisions.length, 2);
});

test('ambiguous structural edits are refused before an immutable successor is stored', async (t) => {
  const f = await fixture(t);
  const cases = [
    [{ kind: 'split', nodeId: 'p1', parts: [{ id: 'a', text: 'First.' }, { id: 'b', text: 'Changed.' }] }],
    [{ kind: 'split', nodeId: 'p1', parts: [{ id: 'p2', text: 'First.' }, { id: 'b', text: 'Second.' }] }],
    [{ kind: 'split', nodeId: 'chapter.one', parts: [{ id: 'a', text: 'First.' }, { id: 'b', text: 'Second.' }] }],
    [{ kind: 'merge', nodeIds: ['p1', 'p3'], mergedNodeId: 'merged' }],
    [{ kind: 'merge', nodeIds: ['p2', 'p1'], mergedNodeId: 'merged' }],
    [{ kind: 'reorder', parentNodeId: 'chapter.one', nodeIds: ['p1', 'p2'] }],
    [{ kind: 'move', nodeId: 'book', parentNodeId: 'chapter.one', index: 0 }],
    [{ kind: 'move', nodeId: 'p1', parentNodeId: 'chapter.two', index: 99 }],
  ];
  for (const operations of cases) await assert.rejects(editNarrativeGraph(f.service, f.input(operations)));
  assert.equal((await f.history()).revisions.length, 1);
  assert.throws(() => narrativeEditSchema.parse(f.input([{ kind: 'replace_text', nodeId: 'p1', text: 'Missing read guard.' }])));
});

test('merge refuses unequal scopes and reorder/move refuse shared or crossing-next topology', async (t) => {
  const scoped = await fixture(t, (graph) => { byId(graph.edges, 'one.p1').access_scopes = ['author']; });
  await assert.rejects(editNarrativeGraph(scoped.service, scoped.input([
    { kind: 'merge', nodeIds: ['p1', 'p2'], mergedNodeId: 'merged' },
  ])), /placement scopes/);
  const disjoint = await fixture(t, (graph) => {
    for (const id of ['p1', 'p2']) byId(graph.nodes, id).access_scopes = ['writer'];
    for (const id of ['one.p1', 'one.p2']) byId(graph.edges, id).access_scopes = ['editor'];
  });
  await assert.rejects(editNarrativeGraph(disjoint.service, disjoint.input([
    { kind: 'merge', nodeIds: ['p1', 'p2'], mergedNodeId: 'merged' },
  ], { accessScopes: [...scopes, 'writer', 'editor'] })), /disjoint node and placement audiences/);
  const linked = await fixture(t, (graph) => { graph.edges.push(edge('p1.next', 'p1', 'q1', 'next', 0)); });
  await assert.rejects(editNarrativeGraph(linked.service, linked.input([
    { kind: 'merge', nodeIds: ['p1', 'p2'], mergedNodeId: 'merged' },
  ])), /incident next/);
  await assert.rejects(editNarrativeGraph(linked.service, linked.input([
    { kind: 'reorder', parentNodeId: 'book', nodeIds: ['chapter.two', 'chapter.one', 'private.note'] },
  ])), /subtree boundary/);
  await assert.rejects(editNarrativeGraph(linked.service, linked.input([
    { kind: 'move', nodeId: 'chapter.one', parentNodeId: 'chapter.two', index: 0 },
  ])), /subtree boundary/);
  const shared = await fixture(t, (graph) => { graph.edges.push(edge('two.p1', 'chapter.two', 'p1', 'contains', 1)); });
  await assert.rejects(editNarrativeGraph(shared.service, shared.input([
    { kind: 'move', nodeId: 'chapter.one', parentNodeId: 'chapter.two', index: 0 },
  ])), /shared/);
  await assert.rejects(editNarrativeGraph(shared.service, shared.input([
    { kind: 'reorder', parentNodeId: 'chapter.one', nodeIds: ['p3', 'p2', 'p1'] },
  ])), /one contains parent/);
  for (const f of [scoped, disjoint, linked, shared]) assert.equal((await f.history()).revisions.length, 1);
});

test('the edit helper rejects a mismatched full projection before requesting any mutation', async (t) => {
  const f = await fixture(t);
  const view = await f.read();
  let writes = 0;
  const proxy = { queryNarrativeGraph: async () => ({ ...view, graph_hash: 'f'.repeat(64) }),
    reviseNarrativeGraph: async () => { writes++; throw new Error('Unexpected mutation.'); },
    reviseNarrativeGraphByDelta: async () => { writes++; throw new Error('Unexpected mutation.'); } };
  await assert.rejects(editNarrativeGraph(proxy, f.input([
    { kind: 'replace_text', nodeId: 'p2', expectedText: 'Third.', text: 'New.' },
  ])), /exact full graph/);
  const unsafe = structuredClone(view);
  byId(unsafe.edges, 'book.private').order = Number.MAX_SAFE_INTEGER + 1;
  proxy.queryNarrativeGraph = async () => unsafe;
  await assert.rejects(editNarrativeGraph(proxy, f.input([
    { kind: 'replace_text', nodeId: 'p2', expectedText: 'Third.', text: 'New.' },
  ])), /exact safe integers/, 'an unrelated native u64 order must never be silently rounded during full reconstruction');
  assert.equal(writes, 0);
});

test('move rejects destination sequencing that would bypass its requested insertion position', async (t) => {
  const f = await fixture(t, (graph) => { graph.edges.push(edge('p1.next.p2', 'p1', 'p2', 'next', 0)); });
  const before = await f.read();
  const renderedBefore = await f.render();
  await assert.rejects(editNarrativeGraph(f.service, f.input([
    { kind: 'move', nodeId: 'q1', parentNodeId: 'chapter.one', index: 1 },
  ])), /subtree boundary/);
  assert.deepEqual(await f.read(), before);
  assert.equal((await f.render()).text, renderedBefore.text);
  assert.equal((await f.history()).revisions.length, 1);
});

test('a hidden edge alone prevents full replacement, and complete access preserves it', async (t) => {
  const f = await fixture(t, (graph) => { graph.edges.push(edge('private.semantic', 'p1', 'p2', 'supports', undefined, ['editor'])); });
  const partial = await f.read();
  assert.equal(partial.nodes.length, partial.graph.node_count);
  assert.equal(partial.edges.length, partial.graph.edge_count - 1);
  const operations = [{ kind: 'replace_text', nodeId: 'p2', expectedText: 'Third.', text: 'New.' }];
  await assert.rejects(editNarrativeGraph(f.service, f.input(operations)), /incomplete scoped view/);
  assert.equal((await f.history()).revisions.length, 1);
  const fullScopes = [...scopes, 'editor'];
  const before = await f.read(undefined, fullScopes);
  const result = await editNarrativeGraph(f.service, f.input(operations, { accessScopes: fullScopes }));
  const after = await f.read(result.graphHash, fullScopes);
  assert.deepEqual(byId(after.edges, 'private.semantic'), byId(before.edges, 'private.semantic'));
});

test('merging under a private parent keeps its previously private ordering out of public queries', async (t) => {
  const f = await fixture(t, (graph) => { byId(graph.nodes, 'chapter.one').access_scopes = ['author']; });
  const before = await f.render(undefined, []);
  const result = await editNarrativeGraph(f.service, f.input([
    { kind: 'merge', nodeIds: ['p1', 'p2'], mergedNodeId: 'merged' },
  ]));
  assert.deepEqual(byId((await f.read(result.graphHash)).nodes, 'merged').access_scopes, ['author']);
  assert.equal(byId((await f.read(result.graphHash, [])).nodes, 'merged'), undefined);
  assert.equal((await f.render(result.graphHash, [])).text, before.text);
  await assert.rejects(f.service.renderNarrativeGraph({ graphHash: result.graphHash, rootIds: ['merged'], accessScopes: [] }),
    /unknown or inaccessible/);
});

test('editing only the document root lists whole-document reviews as ancestor reviews', async (t) => {
  const f = await fixture(t, (definition) => {
    definition.nodes.find((node) => node.id === 'book').text = '# Old title';
    definition.nodes.find((node) => node.id === 'book').authority = { source: 'author', weight: 1 };
    definition.edges.push(edge('review.scene.book', 'review.scene', 'book', 'about', undefined, ['author']));
  });
  const result = await editNarrativeGraph(f.service, f.input([{ kind: 'replace_text', nodeId: 'book', expectedText: '# Old title', text: '# New title' }]));
  assert.deepEqual(result.changedNodeIds, ['book']);
  assert.deepEqual(result.directlyAffectedReviewNodeIds, [], 'a title edit is not direct evidence for whole-document reviews');
  assert.ok(result.ancestorReviewNodeIds.includes('review.about'), 'reviewed_by from the root needs the lighter check');
  assert.ok(result.ancestorReviewNodeIds.includes('review.scene'), 'about the root needs the lighter check');
});
