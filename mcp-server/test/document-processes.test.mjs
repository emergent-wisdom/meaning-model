import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { noEventLinkDeclaration } from '../src/narrative-grounding.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { projectNarrativeDocument } from '../src/document-projection.mjs';
import { storeAuthorRecord } from '../src/storytelling-authoring.mjs';

const provenance = ['Document-process integration fixture'];
const noLinkReason = 'This document-only fixture does not depict a modeled world Event.';
const endpoint = (node_id) => ({ kind: 'node', node_id });
const passage = (id, text, role = 'story_passage') => ({
  id, node_type: 'passage', role, text,
  epistemic_status: 'authored', evidence_type: 'fictional_canon',
  authority: { source: 'fixture-author', weight: 1 },
  render: role === 'story_passage' ? 'include' : 'exclude',
  provenance: [...provenance, noEventLinkDeclaration(text, noLinkReason, 'fixture-author')],
});
const span = (id, from, to = from) => ({
  ...passage(id, JSON.stringify({ schema: 'meaning-model-document-span/v1', documentId: 'book',
    start: { nodeId: from, boundary: 'start' }, end: { nodeId: to, boundary: 'end' } }), 'metadata'),
  node_type: 'document.span', title: id,
});
const processData = () => ({
  schema: 'meaning-model-document-process/v1', documentId: 'book',
  label: 'The owner of the key', question: 'When can the reader identify the owner?',
  summary: 'The action is visible before ownership is disclosed.',
  states: [
    { label: 'Action shown', spanId: 'span.key', description: 'The reader sees possession without its explanation.',
      evidence: [{ nodeId: 'p2', excerpt: 'pockets the brass key' }] },
    { label: 'Ownership disclosed', spanId: 'span.reveal', description: 'The owner becomes available to the reader.',
      evidence: [{ nodeId: 'p3', excerpt: 'names the owner' }] },
  ],
});

async function fixture(t, alter = () => {}) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const model = await service.registerModel({ requestId: 'model', model: {
    schema: 'life-sim-rust-model/v1', id: 'document-process-world', time_unit: 'year',
    revision: { number: 0, reason: 'Keep narrative disclosure independent of world time.', provenance },
    processes: [{ id: 'world.signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, uncertainty: { kind: 'exact' },
      unit: 'fraction', provenance, support: ['fixture'] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
  } });
  const definition = {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'document-process-book',
    revision: { number: 0, reason: 'A disclosure sequence with exact passage identities.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [passage('book', '', 'document_root'), passage('p1', 'Å🙂'),
      passage('p2', 'She pockets the brass key.'), passage('p3', 'Only then she names the owner.'),
      span('span.key', 'p2'), span('span.reveal', 'p3'), span('span.sequence', 'p2', 'p3')],
    edges: [
      ...['p1', 'p2', 'p3'].map((id, order) => ({ id: `book.${id}`, source: endpoint('book'),
        target: endpoint(id), family: 'structural', relation: 'contains', order, provenance })),
      ...['span.key', 'span.reveal', 'span.sequence'].map((id) => ({ id: `${id}.document`,
        source: endpoint(id), target: endpoint('book'), family: 'semantic', relation: 'about', provenance })),
    ],
  };
  alter(definition);
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: definition });
  let sequence = 0;
  const project = (graphHash = graph.graphHash, accessScopes = ['author']) =>
    projectNarrativeDocument(service, { graphHash, rootId: 'book', accessScopes });
  const query = (graphHash = graph.graphHash, accessScopes = ['author']) => service.queryNarrativeGraph({
    graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes,
  });
  const store = (overrides = {}) => storeAuthorRecord(service, {
    graphHash: graph.graphHash, exactRevision: true, requestId: `record.${++sequence}`,
    nodeId: `telling.${sequence}`, storyRootId: 'book', authorId: 'fixture-author',
    accessScopes: ['author'], kind: 'disclosure', text: 'An authored account of how the disclosure unfolds.',
    data: processData(), ...overrides,
  });
  const edit = (graphHash, operations) => editNarrativeGraph(service, {
    requestId: `edit.${++sequence}`, graphHash, reason: 'Revise the telling without revising the world.',
    accessScopes: ['author'], operations: operations.map((operation) => operation.kind === 'split'
      ? { ...operation, parts: operation.parts.map((part) => ({ noLinkReason, ...part })) }
      : ['merge', 'replace_text'].includes(operation.kind) ? { noLinkReason, ...operation } : operation),
  });
  return { service, model, graph, project, query, store, edit };
}

test('authoring captures exact passage evidence and links while preserving world state and immutable predecessors', async (t) => {
  const f = await fixture(t);
  const worldBefore = await f.service.inspectModel({ modelHash: f.model.modelHash, includeDefinition: true });
  const before = await f.project();
  const data = processData();
  data.states[0].basisUnits = [{ nodeId: 'forged', contentHash: 'not-reviewed' }];
  data.basisSpanOrder = ['not-the-reading-order'];
  const receipt = await f.store({ data });
  const view = await f.query(receipt.graphHash);
  const record = view.nodes.find((node) => node.id === receipt.recordNodeId);
  const saved = JSON.parse(record.text).data;
  assert.deepEqual(saved.basisSpanOrder, ['span.key', 'span.reveal']);
  assert.deepEqual(saved.states[0].basisUnits, before.units.filter((unit) => unit.nodeId === 'p2')
    .map(({ nodeId, contentHash }) => ({ nodeId, contentHash })));
  assert.match(saved.states[0].basisUnits[0].contentHash, /^[a-f0-9]{64}$/u);
  const linked = new Set(view.edges.filter((edge) => edge.source.node_id === receipt.recordNodeId
    && edge.relation === 'about').map((edge) => edge.target.node_id));
  for (const target of ['book', 'p2', 'p3', 'span.key', 'span.reveal']) {
    assert.ok(linked.has(target), `the process explicitly links its ${target} evidence`);
  }
  assert.equal(record.render, 'exclude');
  const after = await f.project(receipt.graphHash);
  assert.deepEqual(after.units, before.units, 'author records do not enter the rendered manuscript');
  assert.equal(after.processes[0].interpretation, 'authored');
  assert.equal(after.processes[0].coordinate, 'document_position');
  assert.equal(after.processes[0].holder, 'fixture-author');
  assert.deepEqual(after.processes[0].states.map((state) => state.status), ['current', 'current']);
  assert.equal(receipt.worldMutation, false);
  assert.equal(receipt.snapshotHash, f.graph.snapshotHash);
  assert.deepEqual(await f.service.inspectModel({ modelHash: f.model.modelHash, includeDefinition: true }), worldBefore);
  assert.deepEqual(await f.project(), before, 'the source document revision is unchanged');
});

test('a longer preceding passage repositions current telling states without changing their evidence', async (t) => {
  const f = await fixture(t);
  const recorded = await f.store();
  const before = await f.project(recorded.graphHash);
  const edited = await f.edit(recorded.graphHash, [
    { kind: 'replace_text', nodeId: 'p1', expectedText: 'Å🙂', text: 'Å🙂 — a longer opening' },
  ]);
  const after = await f.project(edited.graphHash);
  const shift = Buffer.byteLength(' — a longer opening');
  for (const [index, state] of after.processes[0].states.entries()) {
    assert.equal(state.status, 'current');
    assert.equal(state.start, before.processes[0].states[index].start + shift);
    assert.equal(state.end, before.processes[0].states[index].end + shift);
    assert.deepEqual(state.basisUnits, before.processes[0].states[index].basisUnits);
  }
  assert.equal(edited.snapshotHash, f.graph.snapshotHash);
});

test('changing covered prose requires review even when the quoted evidence still occurs', async (t) => {
  const f = await fixture(t);
  const recorded = await f.store();
  const edited = await f.edit(recorded.graphHash, [{ kind: 'replace_text', nodeId: 'p2',
    expectedText: 'She pockets the brass key.', text: 'She pockets the brass key. He lets her.' }]);
  const states = (await f.project(edited.graphHash)).processes[0].states;
  assert.equal(states[0].status, 'needs_review');
  assert.equal(states[0].reason, 'passages_changed');
  assert.equal(states[1].status, 'current');
  assert.equal((await f.project(recorded.graphHash)).processes[0].states[0].status, 'current');
});

test('splitting a covered passage preserves its span but requires review of its new identities', async (t) => {
  const f = await fixture(t, (definition) => {
    definition.nodes[definition.nodes.findIndex((node) => node.id === 'p2')] =
      passage('p2', 'She pockets the brass key.\n\nHe lets her.');
  });
  const recorded = await f.store();
  const split = await f.edit(recorded.graphHash, [{ kind: 'split', nodeId: 'p2', parts: [
    { id: 'p2.action', text: 'She pockets the brass key.' }, { id: 'p2.response', text: 'He lets her.' },
  ] }]);
  const projected = await f.project(split.graphHash);
  assert.equal(projected.spans.find((item) => item.nodeId === 'span.key').status, 'resolved');
  assert.equal(projected.processes[0].states[0].status, 'needs_review');
  assert.ok(['passages_changed', 'reading_order_changed'].includes(projected.processes[0].states[0].reason));
  assert.deepEqual(projected.processes[0].states[0].basisUnits.map((unit) => unit.nodeId), ['p2'],
    'reviewed evidence is not silently replaced with newly split passages');
});

test('reversing disclosure order requires review; retired merge boundaries stay unresolved', async (t) => {
  const f = await fixture(t);
  const recorded = await f.store();
  const reordered = await f.edit(recorded.graphHash, [
    { kind: 'reorder', parentNodeId: 'book', nodeIds: ['p1', 'p3', 'p2'] },
  ]);
  const states = (await f.project(reordered.graphHash)).processes[0].states;
  assert.ok(states.every((state) => state.status === 'needs_review' && state.reason === 'reading_order_changed'));
  assert.ok(states[1].start < states[0].start);
  const merged = await f.edit(recorded.graphHash, [
    { kind: 'merge', nodeIds: ['p2', 'p3'], mergedNodeId: 'merged.disclosure' },
  ]);
  assert.ok((await f.project(merged.graphHash)).processes[0].states.every((state) =>
    state.status === 'unresolved' && state.reason === 'boundary_not_in_projection'));
});

test('an explicit superseding record replaces the visible telling account without erasing its predecessor', async (t) => {
  const f = await fixture(t);
  const first = await f.store();
  const data = processData();
  data.summary = 'The action creates a question that the next passage answers.';
  const second = await f.store({ graphHash: first.graphHash, data,
    links: [{ relation: 'supersedes', targetNodeId: first.recordNodeId }] });
  assert.deepEqual((await f.project(second.graphHash)).processes.map((item) => item.nodeId), [second.recordNodeId]);
  assert.deepEqual((await f.project(first.graphHash)).processes.map((item) => item.nodeId), [first.recordNodeId]);
  assert.ok((await f.query(second.graphHash)).nodes.some((node) => node.id === first.recordNodeId));
});

test('evidence must be exact and inside a resolved span in this document', async (t) => {
  const f = await fixture(t);
  const revisionsBefore = (await f.service.listNarrativeRevisions({})).revisions.length;
  for (const change of [
    (data) => { data.states[0].evidence[0].excerpt = 'a silver key'; },
    (data) => { data.states[0].evidence[0] = { nodeId: 'p3', excerpt: 'names the owner' }; },
    (data) => { data.states[0].spanId = 'missing.span'; },
    (data) => { data.documentId = 'another.book'; },
  ]) {
    const data = processData(); change(data);
    await assert.rejects(f.store({ data }), /quotation must match|span is unavailable|belong to this story root/u);
  }
  assert.deepEqual((await f.project()).processes, []);
  assert.equal((await f.service.listNarrativeRevisions({})).revisions.length, revisionsBefore,
    'invalid evidence is rejected before storing a new revision');
});

test('an empty resolved span cannot support a quoted telling state', async (t) => {
  const f = await fixture(t, (definition) => {
    const node = definition.nodes.find((item) => item.id === 'span.key');
    const data = JSON.parse(node.text);
    data.end.boundary = 'start';
    node.text = JSON.stringify(data);
  });
  assert.equal((await f.project()).spans.find((item) => item.nodeId === 'span.key').length, 0);
  await assert.rejects(f.store(), /nonempty passage span/u);
});

test('scope intersection protects the entire covered span, including unquoted private passages', async (t) => {
  const f = await fixture(t, (definition) => {
    definition.nodes.find((node) => node.id === 'p3').access_scopes = ['author'];
  });
  const data = processData();
  data.states = [{ ...data.states[0], spanId: 'span.sequence' }];
  const recorded = await f.store({ data, accessScopes: ['author', 'editor'] });
  const view = await f.query(recorded.graphHash);
  const record = view.nodes.find((node) => node.id === recorded.recordNodeId);
  assert.deepEqual(record.access_scopes, ['author']);
  assert.deepEqual(JSON.parse(record.text).data.states[0].basisUnits.map((unit) => unit.nodeId), ['p2', 'p3']);
  assert.equal((await f.project(recorded.graphHash)).processes[0].states[0].status, 'current');
  for (const scopes of [[], ['editor']]) {
    const limited = await f.project(recorded.graphHash, scopes);
    assert.deepEqual(limited.processes, []);
    assert.ok(!limited.units.some((unit) => unit.nodeId === 'p3'));
    assert.ok(!JSON.stringify(limited).includes('Only then she names the owner.'));
  }
  await assert.rejects(f.store({ data, accessScopes: ['editor'] }), /span is unavailable|unresolved/u);
});

test('a single telling state notices when an untracked passage moves across its position', async (t) => {
  const f = await fixture(t);
  const data = processData();
  data.states = [data.states[0]];
  const recorded = await f.store({ data });
  const reordered = await f.edit(recorded.graphHash, [
    { kind: 'reorder', parentNodeId: 'book', nodeIds: ['p2', 'p1', 'p3'] },
  ]);
  const state = (await f.project(reordered.graphHash)).processes[0].states[0];
  assert.equal(state.status, 'needs_review');
  assert.equal(state.reason, 'reading_order_changed');
});

test('rendered prose containing a process-shaped JSON example does not declare a telling process', async (t) => {
  const f = await fixture(t, (definition) => {
    definition.nodes[definition.nodes.findIndex((node) => node.id === 'p1')] =
      passage('p1', JSON.stringify(processData()));
  });
  assert.deepEqual((await f.project()).processes, []);
});

test('the order basis cannot disclose private passage identities outside the process spans', async (t) => {
  const f = await fixture(t, (definition) => {
    definition.nodes.find((node) => node.id === 'p1').access_scopes = ['author'];
  });
  const recorded = await f.store({ accessScopes: ['author', 'editor'] });
  const record = (await f.query(recorded.graphHash)).nodes.find((node) => node.id === recorded.recordNodeId);
  assert.deepEqual(record.access_scopes, ['author'], 'the whole-document order basis also inherits its source scopes');
  const limited = await f.project(recorded.graphHash, ['editor']);
  assert.deepEqual(limited.processes, []);
  assert.ok(!JSON.stringify(limited).includes('"p1"'));
});
