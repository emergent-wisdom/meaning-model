import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { StorytellingAddon } from '../src/storytelling-addon.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { lifeConnections, lifeTrendsDossier } from './storytelling-life-fixture.mjs';
import { recordWorldProcess } from './world-process-fixture.mjs';

const passages = [
  { id: 'scene.arrival', text: 'Leo stopped by the door.\nThe rain followed him inside.' },
  { id: 'scene.reply', text: '“Still here?” he asked.\n\nNobody answered.' },
];
const draftText = passages.map((passage) => passage.text).join('\n\n');
const provenance = ['storytelling passage integration test'];
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });

async function fixture(t) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const addon = new StorytellingAddon(service);
  const model = await service.registerModel({ requestId: 'model', model: {
    schema: 'life-sim-rust-model/v1', id: 'passage-story', time_unit: 'hour',
    revision: { number: 0, reason: 'Ground editable story passages.', provenance },
    processes: [{ id: 'door.open', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' },
      unit: 'fraction', provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [],
      referents: [{ id: 'Leo', boundary: 'Leo throughout his life.',
        continuity_criterion: 'The same person.', provenance }, { id: 'author', boundary: 'The invented archivist who writes the story.',
        continuity_criterion: 'The same person.', provenance }],
      events: [{ id: 'ev.arrival', boundary: 'Leo comes home in the rain.', description: 'Leo comes home in the rain, forces the stuck door and asks whether anyone is still there.',
        interval: { start: 3, end: 4 }, process_ids: [], observation_process_ids: [], participants: { subject: 'Leo' }, substrate: null, region: null, provenance }],
      event_referent_bindings: [] },
  } });
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'passage-story-graph',
    revision: { number: 0, reason: 'A story with a private existing passage identity.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root',
      epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon',
      access_scopes: [], provenance }, {
      id: 'hidden.passage', node_type: 'private_context', role: 'metadata', text: 'Private context.',
      epistemic_status: 'authored', evidence_type: 'fictional_canon',
      authority: { source: 'fixture', weight: 1 }, access_scopes: ['secret'], provenance,
    }],
    edges: [{ id: 'book.hidden', source: endpoint('book'), target: endpoint('hidden.passage'),
      family: 'structural', relation: 'contains', order: 0, access_scopes: ['secret'], provenance }],
  } });
  const life = await addon.storeLifeTrends({ graphHash: graph.graphHash,
    requestId: 'life', nodeId: 'life.trends', accessScopes: ['author'], dossier: lifeTrendsDossier() });
  const worldHash = await recordWorldProcess(addon, { graphHash: life.graphHash, accessScopes: ['author'], lifeModelHash: model.modelHash, routeEventId: 'ev.arrival' });
  const focus = await addon.storeAuthorRecord({ graphHash: worldHash,
    requestId: 'focus', nodeId: 'outline', storyRootId: 'book', authorId: 'editor', accessScopes: ['author'],
    kind: 'context', text: 'Leo returns and asks whether anyone is still there; the scene leaves the answer open.' });
  const depthPreparation = { graphHash: focus.graphHash, storyRootId: 'book', lifeTrendsNodeId: 'life.trends',
    focusNodeId: 'outline', contextNodeIds: [], accessScopes: ['author'] };
  const task = await addon.prepareModelDepthReview(depthPreparation);
  const depth = await addon.recordModelDepthReview({ preparation: depthPreparation,
    expectedTaskHash: task.taskHash, requestId: 'depth', nodeId: 'depth.review', reviewer: 'editor',
    coverage: 'The scene preserves the established person and leaves the open question unresolved.',
    findings: [{ subject: 'The character and entrance', status: 'sufficient',
      explanation: 'The existing life account and planned entrance explain this quiet scene.',
      evidence: [{ kind: 'node', nodeId: 'outline' }, { kind: 'model', path: '/meaning_model/referents/0' }],
      smallestRepair: null }],
  });
  const draft = await addon.storeAuthorRecord({ graphHash: depth.graphHash,
    requestId: 'draft', nodeId: 'draft', storyRootId: 'book', authorId: 'editor', accessScopes: ['author'],
    kind: 'draft', text: draftText });
  const preparation = { graphHash: draft.graphHash, lifeTrendsNodeId: 'life.trends',
    modelDepthReviewNodeId: depth.modelDepthReviewNodeId, accessScopes: ['author'],
    scene: { id: 'scene', parentNodeId: 'book', order: 1, worldTime: 4, readerOrder: 1, routePartId: 'part.1',
      viewpoint: 'Leo', brief: 'An unanswered question after returning.', characterConnections: lifeConnections(),
      context: [], requirements: [] } };
  const packet = await addon.prepare(preparation);
  const input = { preparation, expectedPacketHash: packet.packetHash, draftNodeId: 'draft',
    text: draftText, passages: structuredClone(passages), reviewer: 'editor',
    findings: packet.checks.map((check) => ({ checkId: check.id, status: 'satisfied',
      explanation: 'The draft remains within the selected model and disclosure context.', citations: [] })), uses: [] };
  const writes = [];
  const apply = service.applyNarrativeBatch.bind(service);
  service.applyNarrativeBatch = async (request) => {
    writes.push(structuredClone(request));
    return apply(request);
  };
  const read = (graphHash, accessScopes = ['author']) => service.queryNarrativeGraph({
    graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes });
  const render = (graphHash) => service.renderNarrativeGraph({ graphHash, rootIds: ['scene'], accessScopes: ['author'] });
  return { addon, service, input, writes, read, render };
}

async function commit(f, input = f.input, requestId = 'save-scene') {
  const report = await f.addon.review(input);
  const request = { ...input, requestId, expectedReviewHash: report.reviewHash };
  return { report, request, result: await f.addon.commit(request) };
}

test('one atomic scene append creates independently addressable leaves and renders the exact reviewed draft', async (t) => {
  const f = await fixture(t);
  const { report, request, result } = await commit(f);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(result.passageIds, passages.map((passage) => passage.id));
  const graph = await f.read(result.graphHash);
  const container = graph.nodes.find((node) => node.id === result.sceneId);
  assert.equal(container.text, '');
  assert.equal(container.render, 'exclude');
  for (const passage of passages) {
    const leaf = graph.nodes.find((node) => node.id === passage.id);
    assert.equal(leaf.text, passage.text);
    assert.equal(leaf.node_type, 'storytelling.passage');
    assert.equal(leaf.render, 'include');
    assert.deepEqual(leaf.access_scopes, ['author']);
    for (const relation of ['reviewed_by', 'derived_from', 'reviewed_against', 'uses_life_trends']) {
      assert.ok(graph.edges.some((edge) => edge.source.node_id === leaf.id && edge.relation === relation), relation);
    }
  }
  const review = graph.nodes.find((node) => node.id === result.reviewNodeId);
  assert.equal(review.render, 'exclude');
  assert.deepEqual(JSON.parse(review.text).data.review.passages, report.passages);
  assert.equal((await f.render(result.graphHash)).text, draftText);
  assert.deepEqual(await f.addon.commit(request), result, 'retry reuses the same atomic graph receipt');

  const revisedText = 'Leo remained outside until the rain stopped.';
  const revised = await editNarrativeGraph(f.service, { requestId: 'revise-one-passage', graphHash: result.graphHash,
    accessScopes: ['author', 'secret'], reason: 'Revise one independently addressable passage; earlier review remains historical.',
    operations: [{ kind: 'replace_text', nodeId: passages[0].id, expectedText: passages[0].text, text: revisedText }] });
  const revisedGraph = await f.read(revised.graphHash);
  assert.deepEqual(revisedGraph.nodes.find((node) => node.id === passages[1].id),
    graph.nodes.find((node) => node.id === passages[1].id), 'neighboring passage remains unchanged');
  assert.equal((await f.render(revised.graphHash)).text, `${revisedText}\n\n${passages[1].text}`);
  assert.equal((await f.render(result.graphHash)).text, draftText, 'the reviewed predecessor remains readable');
});

test('passage identities and exact boundaries are bound to the whole-scene review', async (t) => {
  const f = await fixture(t);
  const report = await f.addon.review(f.input);
  const changedId = structuredClone(f.input);
  changedId.passages[0].id = 'scene.different-id';
  const changedBoundary = structuredClone(f.input);
  changedBoundary.passages = [{ id: 'scene.single', text: draftText }];
  const omitted = structuredClone(f.input);
  delete omitted.passages;
  for (const input of [changedId, changedBoundary, omitted]) {
    assert.notEqual((await f.addon.review(input)).reviewHash, report.reviewHash);
    await assert.rejects(f.addon.commit({ ...input, requestId: 'stale-segmentation', expectedReviewHash: report.reviewHash }),
      /review hash changed/);
  }
  assert.deepEqual(f.writes, []);
});

test('invalid segmentation, duplicate IDs and visible collisions fail before append', async (t) => {
  const f = await fixture(t);
  for (const invalid of [
    [{ id: 'same', text: passages[0].text }, { id: 'same', text: passages[1].text }],
    [{ id: 'scene', text: draftText }], [{ id: 'scene.review', text: draftText }],
    [{ id: 'draft', text: draftText }], [{ id: 'book', text: draftText }],
    [{ id: 'replacement', text: `${draftText} Changed.` }],
    [{ id: 'blank', text: '  ' }], [],
  ]) await assert.rejects(f.addon.review({ ...f.input, passages: invalid }));
  assert.deepEqual(f.writes, []);
});

test('a hidden existing passage ID makes Rust reject the entire scene batch', async (t) => {
  const f = await fixture(t);
  f.input.passages[0].id = 'hidden.passage';
  const before = await f.read(f.input.preparation.graphHash, ['author', 'secret']);
  const receiptCount = f.service.narrativeReceipts.size;
  const report = await f.addon.review(f.input);
  await assert.rejects(f.addon.commit({ ...f.input, requestId: 'hidden-collision', expectedReviewHash: report.reviewHash }),
    /existing|duplicate|already/i);
  assert.equal(f.writes.length, 1);
  assert.equal(f.service.narrativeReceipts.size, receiptCount);
  assert.deepEqual(await f.read(f.input.preparation.graphHash, ['author', 'secret']), before);
  assert.ok(!before.nodes.some((node) => node.id === 'scene'));
});

test('omitting passages preserves the original single scene leaf workflow', async (t) => {
  const f = await fixture(t);
  delete f.input.passages;
  const { report, result } = await commit(f);
  assert.equal(report.passages, undefined);
  assert.deepEqual(result.passageIds, ['scene']);
  const graph = await f.read(result.graphHash);
  const scene = graph.nodes.find((node) => node.id === 'scene');
  assert.equal(scene.render, 'include');
  assert.equal(scene.text, draftText);
  assert.ok(!graph.edges.some((edge) => edge.source.node_id === 'scene' && edge.relation === 'contains'));
  assert.equal((await f.render(result.graphHash)).text, draftText);
});
