import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { noEventLinkDeclaration } from '../src/narrative-grounding.mjs';
import { projectNarrativeDocument } from '../src/document-projection.mjs';
import { storeAuthorRecord } from '../src/storytelling-authoring.mjs';
import { createModelViewer } from '../src/viewer-server.mjs';

const provenance = ['Viewer document-projection integration fixture'];
const endpoint = (node_id) => ({ kind: 'node', node_id });
const node = (id, role, text = '') => ({ id, node_type: role, role, text,
  render: role === 'story_passage' ? 'include' : 'exclude',
  epistemic_status: 'authored', evidence_type: 'fictional_canon',
  authority: { source: 'fixture-author', weight: 1 },
  provenance: [...provenance, noEventLinkDeclaration(text, 'Document-only fixture without a depicted world Event.', 'fixture-author')],
});

async function fixture(t, { anotherDocument = false, extraNotesRoot = true } = {}) {
  const service = new LifeSimulationService();
  await service.initialize();
  const viewer = createModelViewer(service);
  t.after(async () => { await viewer.close(); await service.close(); });
  const model = await service.registerModel({ requestId: 'world', model: {
    schema: 'life-sim-rust-model/v1', id: 'viewer-document-world', time_unit: 'year',
    revision: { number: 0, reason: 'Document projection stays separate from world time.', provenance },
    processes: [{ id: 'world.signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['fixture'] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
  } });
  const definition = {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'book-with-understanding-roots',
    revision: { number: 0, reason: 'One manuscript and an independent understanding root.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book', 'working-notes'],
    nodes: [node('book', 'document_root'), node('working-notes', 'metadata', 'Authored context, excluded from the manuscript.'),
      node('passage', 'story_passage', 'The door was still open.'),
      { ...node('span', 'metadata', JSON.stringify({ schema: 'meaning-model-document-span/v1', documentId: 'book',
        start: { nodeId: 'passage', boundary: 'start' }, end: { nodeId: 'passage', boundary: 'end' } })), node_type: 'document.span' }],
    edges: [
      { id: 'book.passage', source: endpoint('book'), target: endpoint('passage'), family: 'structural', relation: 'contains', order: 0, provenance },
      { id: 'span.book', source: endpoint('span'), target: endpoint('book'), family: 'semantic', relation: 'about', provenance },
    ],
  };
  if (!extraNotesRoot) {
    definition.roots = definition.roots.filter((id) => id !== 'working-notes');
    definition.nodes = definition.nodes.filter((item) => item.id !== 'working-notes');
  }
  if (anotherDocument) {
    definition.roots.push('another-book');
    definition.nodes.push(node('another-book', 'document_root'), node('another-passage', 'story_passage', 'The second manuscript remains available.'));
    definition.edges.push({ id: 'another-book.passage', source: endpoint('another-book'), target: endpoint('another-passage'),
      family: 'structural', relation: 'contains', order: 0, provenance });
  }
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: definition });
  const record = () => storeAuthorRecord(service, { graphHash: graph.graphHash, exactRevision: true,
    requestId: 'telling', nodeId: 'telling.opportunity', storyRootId: 'book', authorId: 'fixture-author',
    accessScopes: ['author'], kind: 'assessment', text: 'An authored account of the opening.',
    data: { schema: 'meaning-model-document-process/v1', documentId: 'book', label: 'Opportunity',
      question: 'What possibility is left open?', summary: 'The open door makes a possibility available.',
      states: [{ label: 'Still possible', spanId: 'span', description: 'The action remains undecided.',
        evidence: [{ nodeId: 'passage', excerpt: 'The door was still open.' }] }] } });
  const json = async (opened, name = 'model') => {
    const response = await fetch(new URL(`data/${name}.json`, opened.url));
    assert.equal(response.status, 200);
    return response.json();
  };
  return { service, viewer, graph, record, json };
}

test('the normal viewer HTTP snapshot projects the one manuscript despite independent metadata roots', async (t) => {
  const f = await fixture(t, { extraNotesRoot: false });
  const initial = await f.service.renderNarrativeGraph({ graphHash: f.graph.graphHash,
    expectedGraphHash: f.graph.graphHash, accessScopes: ['author'] });
  assert.deepEqual(initial.roots, ['book']);
  const recorded = await f.record();
  const opened = await f.viewer.open({ graphHash: recorded.graphHash, accessScopes: ['author'] });
  const snapshot = await f.json(opened);
  const [complete, expected] = await Promise.all([
    f.service.renderNarrativeGraph({ graphHash: recorded.graphHash, expectedGraphHash: recorded.graphHash, accessScopes: ['author'] }),
    projectNarrativeDocument(f.service, { graphHash: recorded.graphHash, rootId: 'book', accessScopes: ['author'] }),
  ]);
  assert.equal(complete.roots.length, 2, 'the ordinary authoring tool alone introduced the additional Understanding root');
  assert.deepEqual({ ...snapshot.documentProjection, spans: undefined }, { ...expected, spans: undefined },
    'projection retains the exact native root-scoped render, hash, positions and process evidence');
  assert.deepEqual(snapshot.documentProjection.spans.map(({ links, ...span }) => span),
    expected.spans.map(({ links, ...span }) => span), 'optional null link fields do not change span coordinates');
  assert.equal(snapshot.documentProjection.processes.length, 1);
  assert.equal(snapshot.documentProjection.processes[0].states[0].status, 'current');
  assert.deepEqual(snapshot.story.units.map(({ id, text }) => ({ id, text })),
    complete.units.map(({ node_id, text }) => ({ id: node_id, text })), 'the full native story render is preserved');
  for (const id of [recorded.understandingRootId, recorded.recordNodeId]) {
    assert.ok(snapshot.inspection.graph.nodes.some((item) => item.id === id), 'Structure retains every independent record');
  }
  assert.equal((await fetch(new URL('?view=structure', opened.url))).status, 200);
});

test('live following exposes newly authored telling tracks under the same viewer URL', async (t) => {
  const f = await fixture(t);
  const opened = await f.viewer.open({ graphHash: f.graph.graphHash, accessScopes: ['author'], mode: 'live' });
  assert.deepEqual((await f.json(opened)).documentProjection.processes, []);
  const recorded = await f.record();
  const status = await f.json(opened, 'live');
  assert.equal(status.status, 'following');
  assert.equal(status.graphHash, recorded.graphHash);
  const snapshot = await f.json(opened);
  assert.equal(snapshot.documentProjection.graphHash, recorded.graphHash);
  assert.equal(snapshot.documentProjection.processes[0].nodeId, recorded.recordNodeId);
  assert.equal(snapshot.documentProjection.processes[0].states[0].status, 'current');
});

test('multiple actual documents retain all their prose without silently choosing one projection', async (t) => {
  const f = await fixture(t, { anotherDocument: true });
  const recorded = await f.record();
  const opened = await f.viewer.open({ graphHash: recorded.graphHash, accessScopes: ['author'] });
  const snapshot = await f.json(opened);
  assert.equal(snapshot.documentProjection, null);
  assert.deepEqual(snapshot.story.units.filter((unit) => unit.text).map((unit) => unit.text),
    ['The door was still open.', 'The second manuscript remains available.']);
  assert.ok(snapshot.inspection.graph.nodes.some((item) => item.id === recorded.recordNodeId));
});
