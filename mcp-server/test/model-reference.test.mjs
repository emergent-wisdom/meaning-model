import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { recordUnderstanding } from '../src/construction-record.mjs';
import { readOpenQuestions } from '../src/model-questions.mjs';
import { storeAuthorRecord } from '../src/storytelling-authoring.mjs';

const provenance = ['model reference test'];
const model = (id, events, referents = []) => ({ schema: 'life-sim-rust-model/v1', id, time_unit: 'year', revision: { number: 0, reason: 'Reference test.', provenance },
  processes: [{ id: `${id}.clock`, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 },
    uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['world'], access_scopes: [] }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents, event_referent_bindings: [],
    events: events.map(([eventId, description]) => ({ id: eventId, boundary: eventId, description, interval: { start: 0, end: 1 },
      process_ids: [], observation_process_ids: [], participants: {}, substrate: null, region: null, provenance })) } });

test('a note can be about records of several models: the author\'s life and the story world', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const life = await service.registerModel({ requestId: 'life', model: model('elspeth-life', [['ev.footbridge', 'The footbridge she judged stable is closed.']],
    [{ id: 'elspeth', boundary: 'Elspeth Rowan, the invented author.', continuity_criterion: 'The same person.', provenance }]) });
  const story = await service.registerModel({ requestId: 'story', model: model('story-world', [['ev.crack', 'The widow finds the paper strip torn.']]) });
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'story-graph',
    revision: { number: 0, reason: 'Reference test.', provenance }, source: { kind: 'model', model_hash: story.modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  const author = { id: 'elspeth', name: 'Elspeth Rowan', lifeModelHash: life.modelHash };
  const before = await readOpenQuestions(service, { modelHash: story.modelHash, graphHash: graph.graphHash, accessScopes: ['author'], author, limit: 20 });
  assert.ok(before.questions.some((item) => item.kind === 'understanding-unjoined'), 'nothing yet holds the author and the story together');
  await assert.rejects(recordUnderstanding(service, { graphHash: graph.graphHash, requestId: 'bad', accessScopes: ['author'], holder: 'writer',
    notes: [{ nodeId: 'note.bad', kind: 'idea', text: 'A record the life does not have.', about: [{ record: 'event:ev.missing', modelHash: life.modelHash }] }] }), /is not a record of model/);
  const noted = await recordUnderstanding(service, { graphHash: graph.graphHash, requestId: 'note', accessScopes: ['author'], holder: 'writer',
    notes: [{ nodeId: 'note.origin', kind: 'idea', text: 'The torn strip in the widow\'s house is where the closed footbridge enters the book.',
      about: [{ record: 'event:ev.footbridge', modelHash: life.modelHash }, { record: 'event:ev.crack' }] }] });
  const view = await service.queryNarrativeGraph({ graphHash: noted.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const reference = view.nodes.find((node) => node.node_type === 'model_reference');
  assert.equal(JSON.parse(reference.text).modelHash, life.modelHash);
  assert.match(JSON.parse(reference.text).summary, /footbridge she judged stable/);
  const about = view.edges.filter((edge) => edge.source.node_id === 'note.origin' && edge.relation === 'about');
  assert.ok(about.some((edge) => edge.target.kind === 'node' && edge.target.node_id === reference.id), 'the note reaches the author\'s life through the reference');
  assert.ok(about.some((edge) => edge.target.kind === 'anchor' && edge.target.anchor_id === 'ev.crack'), 'and the story world directly');
  const after = await readOpenQuestions(service, { modelHash: story.modelHash, graphHash: noted.graphHash, accessScopes: ['author'], author, limit: 20 });
  assert.ok(!after.questions.some((item) => item.kind === 'understanding-unjoined'), 'the note holds them together');
});

test('author records can name records of another model, again and again, without order clashes', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const life = await service.registerModel({ requestId: 'life', model: model('asa-life', [['ev.bridge-condemned', 'The bridge she helped design is condemned.']],
    [{ id: 'asa', boundary: 'Åsa Kvarnström, the invented author.', continuity_criterion: 'The same person.', provenance }]) });
  const story = await service.registerModel({ requestId: 'story', model: model('ferry-world', [['ev.last-crossing', 'The ferry makes its last crossing.']]) });
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'ferry-graph',
    revision: { number: 0, reason: 'Reference test.', provenance }, source: { kind: 'model', model_hash: story.modelHash }, roots: ['story'],
    nodes: [{ id: 'story', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  const record = (graphHash, nodeId, text) => storeAuthorRecord(service, { graphHash, requestId: nodeId, nodeId, storyRootId: 'story', authorId: 'writer', accessScopes: ['author'],
    kind: 'idea', text, about: [{ record: 'event:ev.bridge-condemned', modelHash: life.modelHash }, { record: 'event:ev.last-crossing' }] });
  const first = await record(graph.graphHash, 'idea.origin', 'The condemned bridge is why the last crossing matters to her.');
  const second = await record(first.graphHash, 'idea.echo', 'The ferry closes the way her bridge will: someone signs that it is safe.');
  const view = await service.queryNarrativeGraph({ graphHash: second.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  assert.equal(view.nodes.filter((node) => node.node_type === 'model_reference').length, 1, 'the second record reuses the first reference');
  for (const nodeId of ['idea.origin', 'idea.echo']) {
    const about = view.edges.filter((edge) => edge.source.node_id === nodeId && edge.relation === 'about');
    assert.ok(about.some((edge) => edge.target.kind === 'node' && edge.target.node_id.startsWith('ref.')), `${nodeId} reaches the author's life`);
    assert.ok(about.some((edge) => edge.target.kind === 'anchor' && edge.target.anchor_id === 'ev.last-crossing'), `${nodeId} reaches the story`);
  }
});
