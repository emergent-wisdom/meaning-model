import test from 'node:test';
import assert from 'node:assert/strict';
import { LENS_SCHEMA, LENS_SUFFICIENCY_SCHEMA, childCutId, lensDefineSchema, lensQuestions, lensUnit, levelUnit, placeReadings, readLenses } from '../src/lenses.mjs';
import { buildCutShareQuestions, resolveTargets } from '../src/cut-shares.mjs';
import { READING_MARK } from '../src/model-questions.mjs';

// Fear or love, whole lives and drawn decisions belong to the storytelling profile, which these tests adopt.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

// A reading opens into kinds, level by level, on one reading Event: fear, then fear of what. Ana decides twice; the
// modeler reads both acts under a lens whose fear and love open into kinds.
const at = (start, end = start + 0.1) => ({ start, end });
const lens = { schema: LENS_SCHEMA, id: 'motive', name: 'What moves her', appliesTo: ['act'], question: 'What moves {subject}?', why: 'The same act can come from fear or from love.',
  answers: [
    { key: 'fear', meaning: 'acting to avoid a threat', question: 'What is the fear of?', children: [{ key: 'exile', meaning: 'being sent away' }, { key: 'exposure', meaning: 'being seen for what she did' }] },
    { key: 'love', meaning: 'acting for someone or something she loves', children: [{ key: 'laura', meaning: 'for her daughter' }, { key: 'house', meaning: 'for the house' }] }] };
const reading = (record) => `reading.motive.${record}`;
const top = (record, fear, love) => ({ id: `lens.motive.${record}`, parent_event_id: reading(record), question: 'What moves her?', unit: 'u',
  answers: [{ key: 'fear', weight: fear }, { key: 'love', weight: love }, { key: 'remainder', weight: +(1 - fear - love).toFixed(4) }] });
const within = (record, answer, shares, unit) => ({ id: childCutId(`lens.motive.${record}`, answer), parent_event_id: reading(record), question: `Within ${answer}?`, unit,
  conditioning: { cut_id: `lens.motive.${record}`, answer_key: answer }, answers: [...Object.entries(shares).map(([key, weight]) => ({ key, weight })), { key: 'remainder', weight: +(1 - Object.values(shares).reduce((a, b) => a + b, 0)).toFixed(4) }] });
function modelWith(cuts) {
  const records = ['ana.choice1', 'ana.choice2'];
  return { meaning_model: {
    referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' }],
    events: [
      { id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
      { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
      { id: 'ana.choice1', boundary: 'Ana takes the night shifts', description: 'She signs up for every night in March.', interval: at(2005), participants: { subject: 'person.ana' } },
      { id: 'ana.choice2', boundary: 'Ana reports the error', description: 'She walks into the office and says it.', interval: at(2010), participants: { subject: 'person.ana' } },
      { id: 'understanding.writer', boundary: 'What writer understands', process_ids: [], provenance: [READING_MARK] },
      ...records.map((record) => ({ id: reading(record), boundary: `The writer's reading of ${record}`, description: 'A reading.', process_ids: [], provenance: [READING_MARK, 'perspective:modeler', 'evidence:model'] })),
    ],
    event_relations: [{ id: 'c.work', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' },
      ...records.flatMap((record) => [{ id: `contains.${record}`, kind: 'contains', source_event_id: 'understanding.writer', target_event_id: reading(record) },
        { id: `about.${record}`, kind: 'about', source_event_id: reading(record), target_event_id: record }])],
    context_roots: [{ event_id: 'ana.life', kind: 'accepted_world' }, { event_id: 'ana.choice1', kind: 'accepted_world' }, { event_id: 'ana.choice2', kind: 'accepted_world' }, { event_id: 'understanding.writer', kind: 'understanding' }],
    normalized_cuts: [
      { id: 'cut.ana.choice1', unit: 'decision', parent_event_id: 'ana.choice1', question: 'Does she take them?', answers: [{ key: 'yes', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
      { id: 'cut.ana.choice2', unit: 'decision', parent_event_id: 'ana.choice2', question: 'Does she report it?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
      ...cuts],
  } };
}
const lensNode = (data) => ({ id: 'lens.motive', node_type: 'understanding.lens', holder: 'writer', text: JSON.stringify({ data }) });
const viewOf = (data, extra = { nodes: [], edges: [] }) => ({ graph: { source: { model_hash: 'a'.repeat(64) } },
  nodes: [lensNode(data), ...extra.nodes], edges: [{ source: { kind: 'node', node_id: 'lens.motive' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person.ana' }, relation: 'about' }, ...extra.edges] });
const ask = (model, view = viewOf(lens)) => lensQuestions({ queryNarrativeGraph: async () => view, inspectModel: async () => ({ model }) }, { graphHash: 'b'.repeat(64), lensIds: ['motive'], limit: 50 });

test('a lens\'s answers may open into kinds, a few levels deep', () => {
  const base = { graphHash: 'c'.repeat(64), requestId: 'r', accessScopes: ['s'], holder: 'writer', about: [{ record: 'referent:person.ana' }] };
  const { schema, ...plain } = lens;
  assert.equal(lensDefineSchema.safeParse({ ...base, lens: plain }).success, true);
  // Opening an answer does not change the version of the levels above it.
  assert.equal(lensUnit(plain), lensUnit({ ...plain, answers: plain.answers.map(({ children, question, ...answer }) => answer) }));
  assert.notEqual(levelUnit(plain, ['fear']), levelUnit({ ...plain, answers: [{ ...plain.answers[0], children: [{ key: 'exile', meaning: 'x' }, { key: 'loss', meaning: 'y' }] }, plain.answers[1]] }, ['fear']));
});

test('an opened reading has joint shares down every path, and says where it asks to be opened next', async () => {
  const unit = levelUnit(lens, ['fear']);
  const model = modelWith([top('ana.choice1', 0.6, 0.3), within('ana.choice1', 'fear', { exile: 0.5, exposure: 0.3 }, unit), top('ana.choice2', 0.2, 0.7)]);
  const [motive] = (await ask(model)).lenses;
  assert.equal(motive.answered, 2);
  const first = motive.openings.filter((item) => item.record === 'ana.choice1');
  // Fear is opened; love (.30) and exile (.30 of the whole) ask to be opened; exposure (.18) and the remainder (.10) do not.
  assert.deepEqual(first.map((item) => item.path.join('/')).sort(), ['fear/exile', 'love']);
  const love = first.find((item) => item.path[0] === 'love');
  assert.equal(love.cutId, 'lens.motive.ana.choice1.in.love'); assert.deepEqual(love.conditionedOn, { cutId: 'lens.motive.ana.choice1', answerKey: 'love' });
  assert.equal(love.eventId, 'reading.motive.ana.choice1'); assert.deepEqual(love.answers.map((item) => item.key), ['laura', 'house']);
  assert.equal(love.unit, levelUnit(lens, ['love'])); assert.match(love.why, /carries 0\.30 of this reading/u);
  // Exile has no fixed kinds: they are to be found case by case.
  assert.equal(first.find((item) => item.path.join('/') === 'fear/exile').answers, null);
  // The second act's love (.70) asks to be opened, with the question the lens gives it.
  assert.ok(motive.openings.some((item) => item.record === 'ana.choice2' && item.path[0] === 'love'));
  assert.match(motive.howToOpen ?? (await ask(model)).howToOpen, /conditioned on the answer it divides/u);
});

test('a recorded stop is not asked again', async () => {
  const model = modelWith([top('ana.choice1', 0.6, 0.3), top('ana.choice2', 0.2, 0.7)]);
  const stop = { id: 'note.stop', node_type: 'understanding.note', text: JSON.stringify({ data: { schema: LENS_SUFFICIENCY_SCHEMA, lensId: 'motive', path: ['love'], reason: 'Which love it is changes nothing that follows.', reopenIf: 'Laura learns of it.' } }) };
  const view = viewOf(lens, { nodes: [stop], edges: [{ source: { kind: 'node', node_id: 'note.stop' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'ana.choice2' }, relation: 'about' }] });
  const [motive] = (await ask(model, view)).lenses;
  assert.equal(motive.openings.some((item) => item.record === 'ana.choice2' && item.path[0] === 'love'), false);
  assert.equal(motive.openings.some((item) => item.record === 'ana.choice1' && item.path[0] === 'fear'), true);
});

test('what an answer is made of can change while the answer holds', async () => {
  const unit = levelUnit(lens, ['fear']);
  const model = modelWith([top('ana.choice1', 0.6, 0.3), within('ana.choice1', 'fear', { exile: 0.6, exposure: 0.2 }, unit),
    top('ana.choice2', 0.6, 0.3), within('ana.choice2', 'fear', { exile: 0.1, exposure: 0.8 }, unit)]);
  const [motive] = (await ask(model)).lenses;
  const composition = motive.trajectories.find((item) => item.kind === 'composition');
  assert.ok(composition, JSON.stringify(motive.trajectories.map((item) => item.kind)));
  assert.equal(composition.answer, 'fear'); assert.deepEqual(composition.masses, [0.6, 0.6]); assert.equal(composition.distance, 0.6);
  assert.match(composition.question, /stays fear, but what it is made of moves: exile 0\.60, exposure 0\.20/u);
});

test('kinds found case by case that keep recurring ask for the level to be fixed', async () => {
  const flat = { ...lens, answers: lens.answers.map(({ children, question, ...answer }) => answer) };
  const unit = levelUnit(flat, ['fear']);
  const model = modelWith([top('ana.choice1', 0.6, 0.3), within('ana.choice1', 'fear', { exile: 0.6 }, unit), top('ana.choice2', 0.5, 0.4), within('ana.choice2', 'fear', { exile: 0.3, debt: 0.5 }, unit)]);
  const extra = structuredClone(model);
  extra.meaning_model.events.push({ id: 'ana.choice3', boundary: 'Ana leaves the ward', interval: at(2015), participants: { subject: 'person.ana' } }, { id: reading('ana.choice3'), boundary: 'A reading', description: 'A reading.', process_ids: [], provenance: [READING_MARK, 'perspective:modeler'] });
  extra.meaning_model.event_relations.push({ id: 'contains.c3', kind: 'contains', source_event_id: 'understanding.writer', target_event_id: reading('ana.choice3') }, { id: 'about.c3', kind: 'about', source_event_id: reading('ana.choice3'), target_event_id: 'ana.choice3' });
  extra.meaning_model.context_roots.push({ event_id: 'ana.choice3', kind: 'accepted_world' });
  extra.meaning_model.normalized_cuts.push({ id: 'cut.ana.choice3', unit: 'decision', parent_event_id: 'ana.choice3', question: 'Does she leave?', answers: [{ key: 'yes', weight: 0.5 }, { key: 'remainder', weight: 0.5 }] },
    top('ana.choice3', 0.7, 0.2), within('ana.choice3', 'fear', { exile: 0.4, debt: 0.4 }, unit));
  const [motive] = (await ask(extra, viewOf(flat))).lenses;
  const exile = motive.fixLevels.find((item) => item.key === 'exile');
  assert.equal(exile.readings, 3); assert.deepEqual(exile.path, ['fear']); assert.match(exile.question, /Fix this level/u);
});

test('the estimator is told which answer a level divides, never its weight, and the level stays on the reading Event', async () => {
  const model = modelWith([top('ana.choice1', 0.6, 0.3)]);
  const service = { inspectModel: async () => ({ model }) };
  const input = { modelHash: 'c'.repeat(64), situations: [], events: [{ eventId: reading('ana.choice1'), cutId: 'lens.motive.ana.choice1.in.fear', conditionedOn: { cutId: 'lens.motive.ana.choice1', answerKey: 'fear' } }] };
  const { targets } = await resolveTargets(service, input);
  assert.deepEqual(targets[0].within, { answerKey: 'fear', question: 'What moves her?' });
  const [question] = buildCutShareQuestions({ question: 'What is the fear of?', answers: [{ key: 'exile', meaning: 'sent away' }, { key: 'exposure', meaning: 'seen' }], remainderMeaning: 'other fear' }, targets);
  assert.match(question.state.within, /only the part of the reading that is "fear"/u); assert.doesNotMatch(question.state.within, /0\.6/u);
  await assert.rejects(resolveTargets(service, { ...input, events: [{ ...input.events[0], eventId: reading('ana.choice2') }] }), /stays on the same reading Event/u);
});

test('placing a reading moves its deeper levels with it', async () => {
  const unit = levelUnit(lens, ['fear']);
  const inWorld = modelWith([{ ...top('ana.choice1', 0.6, 0.3), parent_event_id: 'ana.choice1' }, { ...within('ana.choice1', 'fear', { exile: 0.5, exposure: 0.3 }, unit), parent_event_id: 'ana.choice1' }]);
  const calls = [];
  const service = { queryNarrativeGraph: async () => viewOf(lens), inspectModel: async () => ({ model: inWorld }), reviseModel: async (request) => { calls.push(request); return { modelHash: 'd'.repeat(64) }; } };
  const result = await placeReadings(service, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['motive'] });
  assert.deepEqual(result.refused, []);
  const cuts = calls[0].model.meaning_model.normalized_cuts;
  assert.equal(cuts.find((cut) => cut.id === 'lens.motive.ana.choice1').parent_event_id, reading('ana.choice1'));
  assert.equal(cuts.find((cut) => cut.id === 'lens.motive.ana.choice1.in.fear').parent_event_id, reading('ana.choice1'));
  assert.deepEqual([...result.movedCutIds].sort(), ['lens.motive.ana.choice1', 'lens.motive.ana.choice1.in.fear']);
  // Read back, the level counts as the reading's, not as another answer.
  const [motive] = (await ask(calls[0].model)).lenses;
  assert.equal(motive.records, 2); assert.equal(motive.answered, 1);
  assert.equal(readLenses(viewOf(lens))[1].id, 'motive');
});
