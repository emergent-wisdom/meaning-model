import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { StorytellingAddon } from '../src/storytelling-addon.mjs';
import { readWorldState } from '../src/storytelling-world.mjs';
import { storyInterest } from '../src/storytelling-interest.mjs';
import { worldStagesFor } from './world-process-fixture.mjs';
import { fictionalAuthorModel } from './storytelling-author-model-fixture.mjs';

const provenance = ['world stage order test'];

test('the world stages can be recorded in any order, each checked against whatever related stages exist', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const addon = new StorytellingAddon(service);
  const model = await service.registerModel({ requestId: 'model', model: {
    schema: 'life-sim-rust-model/v1', id: 'order-story', time_unit: 'hour', revision: { number: 0, reason: 'Order test.', provenance },
    processes: [{ id: 'door.open', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 },
      uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [],
      referents: [{ id: 'author', boundary: 'The invented author.', continuity_criterion: 'The same person.', provenance }],
      events: [{ id: 'ev.arrival', boundary: 'Leo comes home.', description: 'Leo comes home in the rain and forces the stuck door.', interval: { start: 3, end: 4 },
        process_ids: [], observation_process_ids: [], participants: {}, substrate: null, region: null, provenance }], event_referent_bindings: [] } } });
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'order-graph',
    revision: { number: 0, reason: 'Order test.', provenance }, source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  let hash = graph.graphHash;
  const record = async (nodeId, world) => { hash = (await addon.recordWorld({ graphHash: hash, requestId: nodeId, nodeId, storyRootId: 'book', authorId: 'editor', accessScopes: ['author'], summary: `The ${world.stage} record.`, world })).graphHash; };
  // What makes the story interesting comes first here, before any author, world or opening exists.
  await record('w.aspects', { stage: 'aspects', aspects: [
    ...storyInterest.map((element) => ({ id: `a.${element.id}`, kind: element.id, aspect: `Where ${element.element.toLowerCase()} lives.`, how: 'Model it over time.', status: 'open', records: [] })),
    { id: 'a.own', kind: 'other', category: 'The stuck door', why: 'The door is this story\'s own element.', aspect: 'What the door remembers.', how: 'Model the door as it wears.', status: 'open', records: [] }] });
  await record('w.implications', { stage: 'implications', commitments: ['c.1', 'c.2', 'c.3'].map((id) => ({ id, commitment: `Commitment ${id} of the house.`,
    implications: [{ about: 'Leo', consequence: 'It shapes what Leo can do at the door.', status: 'remainder', reason: 'The test leaves it coarse.' }] })) });
  const voice = await addon.storeAuthorRecord({ graphHash: hash, requestId: 'voice', nodeId: 'w.voice', storyRootId: 'book', authorId: 'editor', accessScopes: ['author'],
    kind: 'author_model', text: 'The invented author\'s voice.', data: { ...fictionalAuthorModel(), modeledAuthorId: 'author' } });
  hash = voice.graphHash;
  const [authorReader, candidates] = worldStagesFor({ routeEventId: 'ev.arrival', authorModelNodeId: 'w.voice', lifeModelHash: model.modelHash, authorPersonId: 'author' });
  await record('w.author', { ...authorReader });
  await record('w.route', { stage: 'route', parts: [{ id: 'part.1', title: 'The arrival', eventIds: ['ev.arrival'], focal: 'Leo', change: 'Leo asks aloud instead of checking.', ends: 'Unanswered.' }],
    renderedOrder: 'One part, in order.', whyNotJumps: 'The test world has no modeled jumps.', risks: [{ risk: 'The silence reads as a trick.', repair: 'Keep the house ordinary.' }] });
  await record('w.candidates', { ...candidates, authorReaderNodeId: null });
  await record('w.opening', { stage: 'opening', accounts: [`Leo comes home to a house he checks every night, and this night the door sticks. ${'The house is old and the street is quiet. '.repeat(2)}`,
    `Leo comes home to a house he checks every night. ${'The house is old. '.repeat(4)}\n\nThis night the door sticks, and nobody answers when he asks. ${'The street is quiet. '.repeat(3)}`], closedQuestions: ['Leo lives alone.', 'The door sticks.', 'Only Leo has a key.'] });
  const state = readWorldState(await service.queryNarrativeGraph({ graphHash: hash, mode: 'full', includeContent: true, accessScopes: ['author'] }), 'book');
  for (const stage of ['authorReader', 'candidates', 'opening', 'aspects', 'implications', 'route']) assert.ok(state[stage], stage);
});
