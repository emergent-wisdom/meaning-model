import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { drawDirection } from '../src/direction-draw.mjs';
import { hideLaterTimes, openStoryChat, prepareStoryChat, recordStoryChat } from '../src/storytelling-chat.mjs';

process.env.MEANING_MODEL_ADDONS = 'storytelling';

const prov = ['story-chat-test'];
const meta = { authority: null, uncertainty: { kind: 'unknown' }, provenance: prov };
const event = (id, boundary, interval, participants = {}, extra = {}) => ({ id, boundary, interval, participants,
  process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: prov, ...extra });
const contains = (source, target) => ({ id: `${source}.contains.${target}`, kind: 'contains', source_event_id: source, target_event_id: target, description: 'Containment.', ...meta });
const process_ = (id, role, subject, initial) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
  initial_value: { kind: 'scalar', value: initial }, unit: 'level', update_mode: 'observed', reference_frame: 'story',
  scale: { semantic_role: role, subject_referent_id: subject }, support: [`authored:${id}`], uncertainty: { kind: 'unknown' }, axes: [], access_scopes: [], provenance: prov });

// Ana (the user's character) and Ben. Ana's motive for the night shifts is hers alone; Ben's trust rises after 2010,
// his offer comes in 2011, and his life ends in 2020.
function registerRequest() {
  return { requestId: 'chat-model', model: {
    schema: 'life-sim-rust-model/v1', id: 'chat-world', time_unit: 'year',
    revision: { number: 0, previous_model_hash: null, provenance: prov, reason: 'Story chat fixture.' },
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    processes: [process_('ben.trust', 'how far Ben trusts Ana', 'referent.ben', 0.5), process_('ben.speech_register', 'how formally Ben speaks', 'referent.ben', 0.7),
      process_('ana.debt_weight', 'how heavily the debt weighs on Ana', 'referent.ana', 0.9)],
    value_series: [{ id: 'values.ben.trust~modeler', process_id: 'ben.trust', holder: 'modeler',
      points: [{ time: 2008, value: 0.4, tag: 'sketch' }, { time: 2012, value: 0.8, tag: 'sketch' }] },
    // Ana's own estimate of Ben's trust is her belief, not his state.
    { id: 'values.ben.trust~ana', process_id: 'ben.trust', holder: 'referent.ana', points: [{ time: 2009, value: 0.13, tag: 'sketch' }] }],
    meaning_model: {
      schema: 'life-sim-rust-meaning-model/v1',
      referents: [
        { id: 'referent.ana', boundary: 'Ana Berg, a nurse', continuity_criterion: 'Same person', lifecycle_event_id: 'ana.life', interval: null, ...meta },
        { id: 'referent.ben', boundary: 'Ben Holm, a doctor', continuity_criterion: 'Same person', lifecycle_event_id: 'ben.life', interval: null, ...meta },
        { id: 'referent.ward', boundary: 'The night ward', continuity_criterion: 'Same ward', lifecycle_event_id: null, interval: null, ...meta },
      ],
      events: [
        event('world', 'The accepted world of the hospital town.', null),
        event('ana.life', 'Ana\'s life', { start: 1980, end: 2030 }, { subject: 'referent.ana' }),
        event('ben.life', 'Ben\'s life', { start: 1975, end: 2020 }, { subject: 'referent.ben' }),
        event('ana.night_shifts', 'Ana takes the night shifts', { start: 2005, end: 2005.2 }, { subject: 'referent.ana' },
          { description: 'She signs up for every night in March, and tells no one why.' }),
        event('dinner', 'Dinner at Ana\'s flat', { start: 2006, end: 2006.01 }, { host: 'referent.ana', guest: 'referent.ben' }),
        event('ben.ward_years', 'Ben\'s years on the night ward, 2000-2012', { start: 2000, end: 2012 }, { subject: 'referent.ben' }),
        event('ben.state.2008', 'What Ben wants in 2008', { start: 2008, end: 2008.1 }, { subject: 'referent.ben' }),
        event('ben.state.2015', 'What Ben wants in 2015', { start: 2015, end: 2015.1 }, { subject: 'referent.ben' }),
        event('ben.offer', 'Ben is offered a post in Bergen', { start: 2011, end: 2011.1 }, { subject: 'referent.ben' },
          { description: 'The hospital in Bergen writes in March.' }),
        event('ward.evening', 'An evening on the night ward', { start: 2010, end: 2010.01 }, {}),
      ],
      event_referent_bindings: ['ana', 'ben'].map((name) => ({ id: `binding.${name}.life`, binding_type: 'lifecycle_subject', role: 'subject',
        referent_id: `referent.${name}`, target: { kind: 'event', event_id: `${name}.life` }, interval: null, ...meta })),
      event_relations: [contains('world', 'ana.life'), contains('world', 'ben.life'), contains('world', 'dinner'), contains('world', 'ward.evening'),
        contains('ana.life', 'ana.night_shifts'), contains('ben.life', 'ben.ward_years'), contains('ben.life', 'ben.state.2008'),
        contains('ben.life', 'ben.state.2015'), contains('ben.life', 'ben.offer')],
      normalized_cuts: [
        { id: 'cut.dinner.ana_feels', parent_event_id: 'dinner', question: 'What does Ana feel across the table?', unit: 'emotional attention',
          answers: [{ key: 'dread', weight: 0.6 }, { key: 'remainder', weight: 0.4 }], provenance: prov },
        { id: 'cut.ben.2008', parent_event_id: 'ben.state.2008', question: 'What does Ben want in 2008?', unit: 'motivational attention',
          answers: [{ key: 'leave', weight: 0.5 }, { key: 'stay', weight: 0.3 }, { key: 'remainder', weight: 0.2 }], provenance: prov },
        { id: 'cut.ben.2015', parent_event_id: 'ben.state.2015', question: 'What does Ben want in 2015?', unit: 'motivational attention',
          answers: [{ key: 'home', weight: 0.7 }, { key: 'remainder', weight: 0.3 }], provenance: prov },
        { id: 'cut.ben.offer', parent_event_id: 'ben.offer', question: 'Does Ben accept the post in Bergen?', unit: 'decision',
          answers: [{ key: 'accept', weight: 0.5 }, { key: 'refuse', weight: 0.4 }, { key: 'remainder', weight: 0.1 }], provenance: prov },
      ],
      context_roots: [{ event_id: 'world', kind: 'accepted_world', provenance: prov }],
      concepts: [], abstract_cuts: [], abstract_relations: [], encapsulation_cuts: [], physical_cuts: [], realizations: [],
    } } };
}

const scopes = ['play'];
const motive = { id: 'fact.ana.motive', text: 'Ana took the night shifts to pay off her brother\'s debt.', at: 2005, groundedIn: ['ana.night_shifts'] };

async function setup(t, overrides = {}) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest());
  const opened = await openStoryChat(service, { requestId: 'open', chatId: 'chat.one', title: 'Night ward', modelHash,
    player: { personId: 'referent.ana' }, agentId: 'claude', startTime: 2010, book: 'chat_only', accessScopes: scopes,
    facts: [motive], knows: [{ personId: 'referent.ana', factId: motive.id, at: 2005 }], ...overrides });
  return { service, modelHash, opened };
}
const turn = (graphHash, requestId, extra = {}) => ({ graphHash, requestId, chatId: 'chat.one', worldTime: 2010, present: ['referent.ben'],
  player: { text: 'I sit down next to Ben.' }, reply: { text: 'Ben looks up from the chart. "Long night?"' }, accessScopes: scopes, ...extra });

test('a character is played only from what they could know at that moment', async (t) => {
  const { service, opened } = await setup(t);
  const packet = await prepareStoryChat(service, { graphHash: opened.graphHash, chatId: 'chat.one', worldTime: 2010,
    present: ['referent.ben'], settingEventId: 'ward.evening', horizon: 2, accessScopes: scopes });
  const ben = packet.characters.find((character) => character.personId === 'referent.ben');
  const text = JSON.stringify(ben);
  // Another person's motive, an Event description and another person's inner Cut on a shared Event never reach Ben.
  assert.doesNotMatch(text, /tells no one why|brother|debt|What does Ana feel/u);
  assert.ok(ben.lived.some((item) => item.eventId === 'dinner'), 'he was at the dinner, by its name only');
  assert.ok(ben.lived.every((item) => item.what && !('description' in item)));
  // Nothing from his future: the later want, the offer, the later trust value, the end of his life or of his period.
  assert.doesNotMatch(text, /2015|Bergen|0\.8|2020|2012/u);
  assert.doesNotMatch(text, /0\.13/u, 'another person\'s estimate of his trust is not his state');
  assert.deepEqual(ben.values.map((item) => [item.processId, item.held?.value]), [['ben.trust', 0.4]]);
  assert.deepEqual(ben.voice.map((item) => item.processId), ['ben.speech_register']);
  assert.deepEqual(ben.inner.map((item) => item.question), ['What does Ben want in 2008?']);
  // A name that carries its own end date keeps only what he could know.
  assert.deepEqual(ben.periods, [{ period: 'Ben\'s years on the night ward, 2000-…', since: 2000 }]);
  assert.ok(!ben.lived.some((item) => item.eventId === 'ben.ward_years'), 'a period is not repeated as an Event lived');
  assert.deepEqual(ben.knows, []);
  assert.equal(ben.age, 35);
  // The user's own character knows her own reason; the narrator sees what lies ahead and what is still open.
  assert.deepEqual(packet.userCharacter.knows.map((item) => item.factId), [motive.id]);
  assert.ok(packet.world.course.some((item) => item.eventId === 'ben.offer'));
  assert.deepEqual(packet.world.openChoices.map((item) => item.cutId), ['cut.ben.offer']);
  assert.equal(packet.world.setting.eventId, 'ward.evening');

  // Once Ana tells him, Ben knows it from that moment on, and not before.
  const told = await recordStoryChat(service, turn(opened.graphHash, 'turn-1', {
    player: { text: 'I tell Ben why I took the night shifts.' }, reply: { text: 'Ben is quiet for a long time.' },
    learned: [{ personId: 'referent.ben', factId: motive.id, at: 2010.2 }], worldTimeEnd: 2010.3 }));
  assert.equal(told.turn, 1);
  const later = await prepareStoryChat(service, { graphHash: told.graphHash, chatId: 'chat.one', worldTime: 2010.5, present: ['referent.ben'], accessScopes: scopes });
  assert.deepEqual(later.characters[0].knows.map((item) => [item.factId, item.since]), [[motive.id, 2010.2]]);
  assert.deepEqual(later.recent.map((item) => item.player), ['I tell Ben why I took the night shifts.']);
  await assert.rejects(prepareStoryChat(service, { graphHash: told.graphHash, chatId: 'chat.one', worldTime: 2009, present: [], accessScopes: scopes }), /moves forward/u);
  // Nobody can be told a fact before it holds, or learn it after the moment the record reaches.
  await assert.rejects(recordStoryChat(service, turn(told.graphHash, 'turn-2', { worldTime: 2011,
    learned: [{ personId: 'referent.ben', factId: motive.id, at: 2004 }] })), /holds only from 2005/u);
  await assert.rejects(recordStoryChat(service, turn(told.graphHash, 'turn-2', { worldTime: 2011,
    learned: [{ personId: 'referent.ben', factId: motive.id, at: 2012 }] })), /after this record's time/u);
});

test('a drawn outcome stays drawn, and a reroll cannot enter the chat', async (t) => {
  const { service, modelHash, opened } = await setup(t);
  const record = (requestId, graphHash) => ({ graphHash, requestId, nodeId: requestId, rootId: opened.storyRootId, accessScopes: scopes, reason: 'The offer comes up.' });
  const first = await drawDirection(service, { modelHash, cutId: 'cut.ben.offer', seed: 'chat/offer/1', record: record('draw-1', opened.graphHash) });
  const packet = await prepareStoryChat(service, { graphHash: first.graphHash, chatId: 'chat.one', worldTime: 2010, present: ['referent.ben'], horizon: 2, accessScopes: scopes });
  assert.deepEqual(packet.world.openChoices, []);
  assert.deepEqual(packet.world.decided.map((item) => [item.cutId, item.realized]), [['cut.ben.offer', first.realized]]);
  const second = await drawDirection(service, { modelHash, cutId: 'cut.ben.offer', seed: 'chat/offer/2', record: record('draw-2', first.graphHash) });
  assert.equal(second.reroll, true);
  await assert.rejects(recordStoryChat(service, turn(second.graphHash, 'turn-reroll', { draws: ['draw-2'] })), /stays drawn/u);
  const played = await recordStoryChat(service, turn(second.graphHash, 'turn-drawn', { draws: ['draw-1'] }));
  const after = await prepareStoryChat(service, { graphHash: played.graphHash, chatId: 'chat.one', worldTime: 2010.1, present: ['referent.ben'], horizon: 2, accessScopes: scopes });
  assert.deepEqual(after.world.decided.map((item) => [item.cutId, item.realized, item.drawNodeId]), [['cut.ben.offer', first.realized, 'draw-1']]);
  assert.ok(after.questions.some((item) => item.kind === 'reroll-present'));
});

test('a chat branches from a story without writing into the story\'s graph', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest());
  const story = await service.registerNarrativeGraph({ requestId: 'book', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'the-book', revision: { number: 0, reason: 'The book.', provenance: prov },
    source: { kind: 'model', model_hash: modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root', text: '# The Book', render: 'include', training: 'exclude',
      epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', authority: { source: 'author', weight: 1 }, provenance: prov }], edges: [] } });
  await assert.rejects(openStoryChat(service, { requestId: 'young', chatId: 'chat.young', title: 'Too early', fromStory: { graphHash: story.graphHash, rootId: 'book' },
    player: { personId: 'referent.ana' }, agentId: 'claude', startTime: 1970, book: 'book', accessScopes: scopes }), /does not contain 1970/u);
  await assert.rejects(openStoryChat(service, { requestId: 'ward', chatId: 'chat.ward', title: 'No life', fromStory: { graphHash: story.graphHash, rootId: 'book' },
    player: { personId: 'referent.ward' }, agentId: 'claude', startTime: 2010, book: 'book', accessScopes: scopes }), /whole life in the model first/u);
  const opened = await openStoryChat(service, { requestId: 'branch', chatId: 'chat.one', title: 'Night ward', fromStory: { graphHash: story.graphHash, rootId: 'book' },
    player: { personId: 'referent.ana' }, agentId: 'claude', startTime: 2010, book: 'book', accessScopes: scopes });
  assert.equal(opened.modelHash, modelHash);
  const played = await recordStoryChat(service, turn(opened.graphHash, 'turn-1', { events: ['ward.evening'] }));
  assert.match(played.nextStep, /life_story_scene_prepare on this graph's story root \(chat\.one\.story\)/u);
  const history = await service.listNarrativeRevisions({ graphId: 'the-book' });
  assert.deepEqual(history.revisions.map((revision) => revision.graph_hash), [story.graphHash], 'the book\'s graph is unchanged');
  const packet = await prepareStoryChat(service, { graphHash: played.graphHash, chatId: 'chat.one', worldTime: 2010, present: [], horizon: 2, accessScopes: scopes });
  assert.match(packet.world.courseSource, /what the book had/u);
});

test('a turn is recorded once, as said, and only about a world that holds it', async (t) => {
  const { service, opened } = await setup(t);
  const first = await recordStoryChat(service, turn(opened.graphHash, 'turn-1'));
  const again = await recordStoryChat(service, turn(opened.graphHash, 'turn-1'));
  assert.equal(again.graphHash, first.graphHash, 'a retry returns the same record');
  await assert.rejects(recordStoryChat(service, turn(opened.graphHash, 'turn-1', { reply: { text: 'A different reply.' } })));
  await assert.rejects(recordStoryChat(service, turn(first.graphHash, 'turn-2', { events: ['ev.not.modeled'] })), /life_model_revise/u);
  await assert.rejects(recordStoryChat(service, turn(first.graphHash, 'turn-3', { worldTime: 2021 })), /does not contain 2021/u);
  const view = await service.queryNarrativeGraph({ graphHash: first.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  const messages = view.nodes.filter((node) => node.node_type === 'storytelling.chat_message');
  assert.deepEqual(messages.map((node) => [node.holder, JSON.parse(node.text).text]).sort(),
    [['claude', 'Ben looks up from the chart. "Long night?"'], ['player', 'I sit down next to Ben.']]);
  assert.ok(view.nodes.filter((node) => node.id.startsWith('chat.one')).every((node) => node.training === 'exclude'));
});

test('a label hides only the numbers that could be later times in the model', () => {
  const span = { from: 1900, to: 2040 };
  assert.equal(hideLaterTimes('2014 to 2023: Dmitri and Anna', 2016, span), '2014 to …: Dmitri and Anna');
  assert.equal(hideLaterTimes('laura-feelings 2013.7 to 2017.2', 2016, span), 'laura-feelings 2013.7 to …');
  assert.equal(hideLaterTimes('Nursing and Kieran, 2013-2020.', 2016, span), 'Nursing and Kieran, 2013-….');
  assert.equal(hideLaterTimes('A band 6 nurse; 24000 pounds saved by 2015', 2016, span), 'A band 6 nurse; 24000 pounds saved by 2015');
});
