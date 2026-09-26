import test from 'node:test';
import assert from 'node:assert/strict';
import { LENS_SCHEMA, lensDefineSchema, lensOpenQuestions, lensQuestions, lensUnit, readLenses } from '../src/lenses.mjs';
import { buildCutShareQuestions, constructionNoteIn, eventTextSignature, modeledStateText, proposalFromProbabilities } from '../src/cut-shares.mjs';

// Fear or love, whole lives and drawn decisions belong to the storytelling profile, which these tests adopt.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

// Two lives: Ana decides twice, Bo once with Ana taking part. A lens on Ana's acts and periods, with two answers, and one
// fear-or-love answer that asks the built-in lens in its own words.
const at = (start, end = start + 0.1) => ({ start, end });
const model = { meaning_model: {
  referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' },
    { id: 'person.bo', boundary: 'Bo Lind, her brother', lifecycle_event_id: 'bo.life' }],
  events: [
    { id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
    { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
    { id: 'ana.p1', boundary: 'Training years, 2000-2010.', interval: at(2000, 2010) },
    { id: 'ana.p2', boundary: 'The ward, 2010-2020.', interval: at(2010, 2020) },
    { id: 'ana.choice1', boundary: 'Ana takes the night shifts', interval: at(2005), participants: { subject: 'person.ana' } },
    { id: 'ana.choice2', boundary: 'Ana reports the error', interval: at(2015), participants: { subject: 'person.ana' } },
    { id: 'ana.choice2.done', boundary: 'Ana walks into the office and reports it', interval: at(2015.5), participants: { subject: 'person.ana' } },
    { id: 'ana.keeps_card', boundary: 'Ana keeps the letter', interval: at(2003), participants: { subject: 'person.ana' } },
    { id: 'ana.arc', boundary: 'The move to Uppsala changes her', interval: at(2008, 2012) },
    { id: 'ana.arc.focal_change', boundary: 'The move itself', interval: at(2009), participants: { subject: 'person.ana' } },
    { id: 'ana.night_shift', boundary: 'Ana\'s first night alone on the ward', interval: at(2009.5), participants: { subject: 'person.ana' } },
    { id: 'bo.life', boundary: 'Bo\'s life', interval: at(1983, 2030), participants: { subject: 'person.bo' } },
    { id: 'bo.life.is.work', boundary: 'Bo\'s work', interval: at(1983, 2030) },
    { id: 'bo.choice', boundary: 'Bo asks Ana for money', interval: at(2012), participants: { subject: 'person.bo', object: 'person.ana' } },
  ],
  event_relations: [...[['ana.life', 'ana.life.is.work'], ['ana.life', 'ana.p1'], ['ana.life', 'ana.p2'], ['ana.life', 'ana.arc'], ['ana.arc', 'ana.arc.focal_change'], ['ana.arc', 'ana.night_shift'], ['bo.life', 'bo.life.is.work']]
    .map(([source, target]) => ({ kind: 'contains', source_event_id: source, target_event_id: target })),
    { kind: 'realizes_forecast', source_event_id: 'ana.choice2.done', target_event_id: 'ana.choice2' }],
  event_referent_bindings: [{ referent_id: 'person.ana', binding_type: 'change_arc_subject', target: { event_id: 'ana.arc' } }],
  normalized_cuts: [
    { id: 'cut.ana.choice1', unit: 'decision', parent_event_id: 'ana.choice1', question: 'Does Ana take the shifts?', answers: [{ key: 'yes', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
    { id: 'cut.ana.choice2', unit: 'decision', parent_event_id: 'ana.choice2', question: 'Does Ana report it?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
    { id: 'cut.bo.choice', unit: 'decision', parent_event_id: 'bo.choice', question: 'Does Bo ask?', answers: [{ key: 'yes', weight: 0.5 }, { key: 'remainder', weight: 0.5 }] },
    { id: 'cut.ana.wants', unit: 'motivational', parent_event_id: 'ana.p1', question: 'What does Ana want in these years?', answers: [{ key: 'safety', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
    { id: 'cut.ana.fl', parent_event_id: 'ana.choice1', question: 'Is taking the shifts an act of love or of fear?', answers: [{ key: 'love_of_the_ward', weight: 0.3 }, { key: 'fear_of_debt', weight: 0.6 }, { key: 'remainder', weight: 0.1 }] },
    { id: 'lens.stage.ana.choice1', parent_event_id: 'ana.choice1', question: 'Stage?', answers: [{ key: 'bartering', weight: 0.7 }, { key: 'standing', weight: 0.2 }, { key: 'remainder', weight: 0.1 }] },
    { id: 'lens.stage.ana.choice2', parent_event_id: 'ana.choice2', question: 'Stage?', answers: [{ key: 'standing', weight: 0.6 }, { key: 'bartering', weight: 0.3 }, { key: 'remainder', weight: 0.1 }] },
  ],
} };
const lens = { schema: LENS_SCHEMA, id: 'stage', name: 'Wanting, bartering or standing', appliesTo: ['act', 'period'],
  question: 'Is {subject} done out of wanting, bartering for a reaction, or standing for something?', why: 'It changes what a setback does to a person.',
  answers: [{ key: 'wanting', meaning: 'want and get' }, { key: 'bartering', meaning: 'act for a reaction' }, { key: 'standing', meaning: 'act regardless of approval' }] };
const view = {
  graph: { source: { model_hash: 'a'.repeat(64) } },
  nodes: [{ id: 'lens.stage', node_type: 'understanding.lens', text: JSON.stringify({ schema: 'meaning-model-understanding-note/v1', kind: 'lens', text: 'Stage', data: lens }) }],
  edges: [{ source: { kind: 'node', node_id: 'lens.stage' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person.ana' }, relation: 'about' }],
};
const service = { queryNarrativeGraph: async () => view, inspectModel: async () => ({ model }) };

test('a defined lens is asked of the acts and periods of the people it looks at, beside the built-in fear or love', async () => {
  const result = await lensQuestions(service, { graphHash: 'b'.repeat(64) });
  const [fearLove, stage] = result.lenses;
  assert.equal(fearLove.id, 'fear-love'); assert.equal(fearLove.builtIn, true);
  // Acts: the first choice, and what Ana did after the second (answered on the decision).
  // Periods: the two stretches of her life, not the change arc. The Cut id keeps the Event id as it is.
  assert.equal(stage.id, 'stage'); assert.equal(stage.records, 4); assert.equal(stage.answered, 2);
  assert.deepEqual(stage.open.map((item) => item.cutId), ['lens.stage.ana.p1', 'lens.stage.ana.p2']);
  // The letter is a moment Ana is the subject of: a candidate until it is answered.
  assert.deepEqual(stage.candidates.map((item) => item.cutId), ['lens.stage.ana.keeps_card', 'lens.stage.ana.night_shift']);
  assert.match(stage.open[0].question, /^Is how Ana Berg lives through "Training years, 2000-2010" done out of wanting/u);
  assert.equal(stage.trajectories.length, 1);
  assert.equal(stage.trajectories[0].kind, 'change'); assert.deepEqual(stage.trajectories[0].path, ['bartering', 'standing']);
  assert.ok(result.survey.length >= 2 && /as many as you can find beyond Wanting, bartering or standing/u.test(result.survey[0]));
});

test('fear or love reports a Cut that asks it in its own words until the modeler says whose it is, and an act belongs to the person who decides it', async () => {
  const { lenses: [fearLove] } = await lensQuestions(service, { graphHash: 'b'.repeat(64), lensIds: ['fear-love'] });
  // Whose reading the older Cut is is unknown, so it is reported and does not count.
  assert.equal(fearLove.records, 3); assert.equal(fearLove.answered, 0);
  const shifts = fearLove.open.find((item) => item.eventId === 'ana.choice1');
  assert.deepEqual(shifts.matched, ['cut.ana.fl']); assert.match(shifts.resolve, /canon.*reading.*direction/su);
  const done = fearLove.open.find((item) => item.eventId === 'ana.choice2.done');
  assert.deepEqual(done.decidedAt, ['ana.choice2']); assert.match(done.question, /what Ana Berg does at "Ana walks into the office and reports it"/u);
  assert.equal(fearLove.open.some((item) => item.eventId === 'ana.choice2'), false);
  const bo = fearLove.open.find((item) => item.eventId === 'bo.choice');
  assert.equal(bo.person, 'Bo Lind');
  assert.match(bo.question, /what Bo Lind does at "Bo asks Ana for money"/u);
  assert.deepEqual(bo.sharedWith, ['Ana Berg']); assert.match(bo.shared, /modeled as its own Event with them as its subject/u);
});

test('answering a candidate makes it one of the lens\'s records', async () => {
  const answered = structuredClone(model);
  answered.meaning_model.normalized_cuts.push({ id: 'lens.stage.ana.keeps_card', parent_event_id: 'ana.keeps_card', question: 'Stage?', answers: [{ key: 'wanting', weight: 0.8 }, { key: 'remainder', weight: 0.2 }] });
  const { lenses: [stage] } = await lensQuestions({ ...service, inspectModel: async () => ({ model: answered }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] });
  assert.equal(stage.records, 5); assert.equal(stage.answered, 3); assert.deepEqual(stage.candidates.map((item) => item.eventId), ['ana.night_shift']);
  assert.deepEqual(stage.trajectories[0].path, ['wanting', 'bartering', 'standing']);
});

test('lenses with unanswered records join the open questions, and a lens id stays short and plain', () => {
  const [unplaced, ...open] = lensOpenQuestions(view, model);
  // The two stage answers sit on the Events they read, so placing them comes first.
  assert.equal(unplaced.kind, 'lens-unplaced'); assert.equal(unplaced.subject, 'stage'); assert.match(unplaced.question, /^2 lens readings sit on the records they read/u);
  assert.deepEqual(open.map((item) => item.subject), ['fear-love', 'stage']);
  assert.ok(open.every((item) => item.kind === 'lens-open' && item.tool === 'life_lens_questions'));
  const base = { graphHash: 'c'.repeat(64), requestId: 'r', accessScopes: ['s'], holder: 'h', about: [{ record: 'referent:person.ana' }] };
  assert.equal(lensDefineSchema.safeParse({ ...base, lens: { ...lens, schema: undefined } }).success, false);
  const { schema, ...plain } = lens;
  assert.equal(lensDefineSchema.safeParse({ ...base, lens: plain }).success, true);
  assert.equal(lensDefineSchema.safeParse({ ...base, lens: { ...plain, id: 'Stage Lens' } }).success, false);
});

test('the estimator is told the person, not the lenses read on them', () => {
  const text = modeledStateText(model, model.meaning_model.events.find((event) => event.id === 'ana.choice1'));
  assert.match(text, /What does Ana want in these years\?/u);
  assert.doesNotMatch(text, /Stage\?/u); assert.doesNotMatch(text, /love or of fear/u);
});

test('an estimator\'s rounding drift is normalized and recorded, a caller\'s distribution is not', () => {
  const input = { answers: [{ key: 'a', meaning: 'A' }, { key: 'b', meaning: 'B' }], question: 'Q?', unit: 'lens', idPrefix: 'lens.x' };
  const target = { id: 'e1', parentEventId: 'e1', cutId: 'lens.x.e1' };
  const cut = proposalFromProbabilities(input, target, { a: 0.61, b: 0.3, remainder: 0.102 }, { label: 'typesafe:jev', requireComplete: true });
  assert.ok(Math.abs(cut.answers.reduce((sum, answer) => sum + answer.weight, 0) - 1) < 1e-9);
  assert.match(cut.provenance.join(' | '), /summed to 1\.0120 and were normalized/u);
  assert.throws(() => proposalFromProbabilities(input, target, { a: 0.61, b: 0.3, remainder: 0.102 }, { label: 'supplied' }), /must sum to one/u);
  assert.throws(() => proposalFromProbabilities(input, target, { a: 0.7, b: 0.3, remainder: 0.1 }, { label: 'typesafe:jev', requireComplete: true }), /summed to 1\.1000/u);
});

test('a description that reads like a note to the modeler is flagged', () => {
  assert.equal(constructionNoteIn('Summer 2022: what she does next is drawn from cut.barbara.2022.after.'), 'drawn from');
  assert.equal(constructionNoteIn('She takes the bus into Swindon.'), null);
});

test('defining a lens again revises it: the new version supersedes the old', () => {
  const second = { ...lens, question: 'Is {subject} wanting, bartering, standing or silent?' };
  const revised = { ...view, nodes: [...view.nodes, { id: 'lens.stage.r2', node_type: 'understanding.lens', text: JSON.stringify({ kind: 'lens', data: second }) }],
    edges: [...view.edges, { source: { kind: 'node', node_id: 'lens.stage.r2' }, target: { kind: 'node', node_id: 'lens.stage' }, relation: 'supersedes' }] };
  const stages = readLenses(revised).filter((item) => item.id === 'stage');
  assert.equal(stages.length, 1); assert.equal(stages[0].nodeId, 'lens.stage.r2'); assert.match(stages[0].question, /or silent/u);
});

test('the estimator is told whose act it judges', () => {
  const input = { question: 'Why?', answers: [{ key: 'a', meaning: 'A' }], remainderMeaning: 'none' };
  const [asked] = buildCutShareQuestions(input, [{ id: 'e1', text: 'Laura shows Kieran the house.', subject: 'Kieran Hale' }]);
  assert.equal(asked.state.subject, 'Kieran Hale'); assert.match(asked.questions.shares.instructions, /Judge Kieran Hale: others in the situation are context/u);
  const [plain] = buildCutShareQuestions(input, [{ id: 'e2', text: 'Rain.' }]);
  assert.equal(plain.state.subject, undefined);
});

test('a reading of an Event rewritten since it was read is stale', async () => {
  const rewritten = structuredClone(model);
  const event = rewritten.meaning_model.events.find((item) => item.id === 'ana.choice1');
  const cut = rewritten.meaning_model.normalized_cuts.find((item) => item.id === 'lens.stage.ana.choice1');
  cut.provenance = [`event-text:${eventTextSignature(event)}`];
  const ask = async (m) => (await lensQuestions({ ...service, inspectModel: async () => ({ model: m }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] })).lenses[0];
  assert.equal((await ask(rewritten)).stale, 0);
  event.description = 'She takes them, and tells no one why.';
  const after = await ask(rewritten);
  assert.equal(after.stale, 1); assert.equal(after.open.find((item) => item.eventId === 'ana.choice1').stale, 'its Event has been rewritten since it was read');
});

test('a reading on a change arc is one of the lens\'s records', async () => {
  const onArc = structuredClone(model);
  onArc.meaning_model.normalized_cuts.push({ id: 'lens.stage.ana.arc', parent_event_id: 'ana.arc', question: 'Stage?', answers: [{ key: 'standing', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] });
  const [stage] = (await lensQuestions({ ...service, inspectModel: async () => ({ model: onArc }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] })).lenses;
  assert.equal(stage.records, 5); assert.equal(stage.answered, 3);
});

test('the lenses can be asked of a model the graph is not yet bound to', async () => {
  const later = structuredClone(model);
  later.meaning_model.normalized_cuts.push({ id: 'lens.stage.ana.p1', parent_event_id: 'ana.p1', question: 'Stage?', answers: [{ key: 'wanting', weight: 0.8 }, { key: 'remainder', weight: 0.2 }] });
  const bySource = async (modelHash) => (await lensQuestions({ ...service, inspectModel: async ({ modelHash: asked }) => ({ model: asked === 'd'.repeat(64) ? later : model }) },
    { graphHash: 'b'.repeat(64), lensIds: ['stage'], ...(modelHash ? { modelHash } : {}) })).lenses[0];
  assert.equal((await bySource(null)).answered, 2);
  assert.equal((await bySource('d'.repeat(64))).answered, 3);
});

test('trajectories keep acts and periods apart, and a lens without fixed answers has none', async () => {
  const both = structuredClone(model);
  both.meaning_model.normalized_cuts.push({ id: 'lens.stage.ana.p1', parent_event_id: 'ana.p1', question: 'Stage?', answers: [{ key: 'standing', weight: 0.8 }, { key: 'remainder', weight: 0.2 }] },
    { id: 'lens.stage.ana.p2', parent_event_id: 'ana.p2', question: 'Stage?', answers: [{ key: 'bartering', weight: 0.8 }, { key: 'remainder', weight: 0.2 }] });
  const [stage] = (await lensQuestions({ ...service, inspectModel: async () => ({ model: both }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] })).lenses;
  const byRecords = Object.groupBy(stage.trajectories, (item) => item.records);
  assert.deepEqual(Object.keys(byRecords).sort(), ['act', 'period']);
  assert.deepEqual(byRecords.act[0].path, ['bartering', 'standing']); assert.deepEqual(byRecords.period[0].path, ['standing', 'bartering']);
  assert.ok(stage.trajectories.every((item) => item.kind === 'unclear' || item.account === 'attributed'));
  const open = { ...lens, answers: undefined };
  const openView = { ...view, nodes: [{ ...view.nodes[0], text: JSON.stringify({ data: open }) }] };
  const [exploratory] = (await lensQuestions({ ...service, queryNarrativeGraph: async () => openView }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] })).lenses;
  assert.deepEqual(exploratory.trajectories, []); assert.match(exploratory.exploratory, /no trajectories/u);
});

test('a declined record is neither open nor read, whether declined by a note or by an old not_applicable', async () => {
  const declineView = { ...view, nodes: [...view.nodes, { id: 'note.decline.p1', node_type: 'understanding.decision', text: JSON.stringify({ kind: 'decision', data: { schema: 'meaning-model-lens-decline/v1', lensId: 'stage', reason: 'A training period is not an act of standing or bartering.' } }) }],
    edges: [...view.edges, { source: { kind: 'node', node_id: 'note.decline.p1' }, relation: 'about', target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'ana.p1' } }] };
  const legacy = structuredClone(model);
  legacy.meaning_model.normalized_cuts.push({ id: 'lens.stage.ana.p2', parent_event_id: 'ana.p2', question: 'Stage?', answers: [{ key: 'not_applicable', weight: 1 }] });
  const [stage] = (await lensQuestions({ queryNarrativeGraph: async () => declineView, inspectModel: async () => ({ model: legacy }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] })).lenses;
  assert.equal(stage.declined, 2); assert.equal(stage.answered, 2);
  assert.deepEqual(stage.open.map((item) => item.eventId), []);
});

// From the Writer's fifth round on the published story.
test('a reading of an Event rewritten since is stale even when it answers this version of the lens', async () => {
  const signed = structuredClone(model);
  const cut = signed.meaning_model.normalized_cuts.find((item) => item.id === 'lens.stage.ana.choice1');
  cut.unit = lensUnit(readLenses(view).find((item) => item.id === 'stage'));
  const event = signed.meaning_model.events.find((item) => item.id === 'ana.choice1');
  cut.provenance = ['estimator:test', `event-text:${eventTextSignature(event)}`];
  const ask = () => lensQuestions({ ...service, inspectModel: async () => ({ model: signed }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] });
  assert.equal((await ask()).lenses[0].stale, 0);
  event.description = 'She signs up for every night in March, and tells no one why.';
  const rewritten = (await ask()).lenses[0];
  assert.equal(rewritten.stale, 1);
  assert.equal(rewritten.open.find((item) => item.eventId === 'ana.choice1').stale, 'its Event has been rewritten since it was read');
});

test('an inner Event is what a person thinks, not an act, and is not offered as a candidate', async () => {
  const inner = structuredClone(model);
  inner.meaning_model.events.push({ id: 'ana.inner', boundary: 'Ana\'s inner perspective root', participants: { subject: 'person.ana' } },
    { id: 'ana.tells_herself', boundary: 'Ana tells herself it is only for a year', interval: at(2006), participants: { subject: 'person.ana' } });
  inner.meaning_model.event_relations.push({ kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.inner' }, { kind: 'contains', source_event_id: 'ana.inner', target_event_id: 'ana.tells_herself' });
  inner.meaning_model.context_roots = [{ event_id: 'ana.inner', kind: 'inner', provenance: ['test'] }];
  const result = await lensQuestions({ ...service, inspectModel: async () => ({ model: inner }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'], limit: 50 });
  const ids = result.lenses[0].candidates.map((item) => item.eventId);
  assert.ok(ids.includes('ana.keeps_card')); assert.ok(!ids.includes('ana.tells_herself'));
});

test('readings of Events that overlap in time are a split, not a change', async () => {
  const overlapping = { meaning_model: {
    referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' }],
    events: [
      { id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
      { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
      { id: 'ana.home', boundary: 'Ana keeps the peace at home that year', interval: at(2005, 2006), participants: { subject: 'person.ana' } },
      { id: 'ana.ward', boundary: 'Ana refuses the double shifts that winter', interval: at(2005.5, 2006.5), participants: { subject: 'person.ana' } },
    ],
    event_relations: [{ kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' }],
    normalized_cuts: [
      { id: 'cut.home', unit: 'decision', parent_event_id: 'ana.home', question: 'Does she keep the peace?', answers: [{ key: 'yes', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
      { id: 'cut.ward', unit: 'decision', parent_event_id: 'ana.ward', question: 'Does she refuse?', answers: [{ key: 'yes', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
      { id: 'lens.stage.ana.home', parent_event_id: 'ana.home', question: 'Stage?', answers: [{ key: 'bartering', weight: 0.8 }, { key: 'standing', weight: 0.1 }, { key: 'remainder', weight: 0.1 }] },
      { id: 'lens.stage.ana.ward', parent_event_id: 'ana.ward', question: 'Stage?', answers: [{ key: 'standing', weight: 0.8 }, { key: 'bartering', weight: 0.1 }, { key: 'remainder', weight: 0.1 }] },
    ] } };
  const result = await lensQuestions({ ...service, inspectModel: async () => ({ model: overlapping }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] });
  const kinds = result.lenses[0].trajectories.map((item) => item.kind);
  assert.ok(kinds.includes('concurrent'), JSON.stringify(kinds)); assert.ok(!kinds.includes('change'));
  // A moment the stretch contains is a finer record of the same stretch, neither a change nor a split: without a
  // composition the model declares, the two are not compared at all.
  const nested = structuredClone(overlapping);
  nested.meaning_model.events.find((event) => event.id === 'ana.ward').interval = at(2005.5, 2005.505);
  nested.meaning_model.event_relations.push({ kind: 'contains', source_event_id: 'ana.home', target_event_id: 'ana.ward' });
  const inside = await lensQuestions({ ...service, inspectModel: async () => ({ model: nested }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] });
  assert.deepEqual(inside.lenses[0].trajectories.map((item) => item.kind).filter((kind) => kind !== 'unclear'), []);
});

test('the estimator is told each person by the name the model gives them', () => {
  const text = modeledStateText(model, model.meaning_model.events.find((item) => item.id === 'ana.choice2'));
  assert.match(text, /Ana Berg/u);
});

test('a record that names no person says so, since a lens about people would be asked of no one', async () => {
  const unnamed = structuredClone(model);
  unnamed.meaning_model.events.push({ id: 'call.check', boundary: 'A scam-check call on the recorded line', interval: at(2016), participants: { caller: 'person.bo' } });
  const peopleLens = { ...lens, appliesTo: ['act', 'period', 'event'] };
  const aboutView = { ...view, nodes: [{ ...view.nodes[0], text: JSON.stringify({ schema: 'meaning-model-understanding-note/v1', kind: 'lens', text: 'Stage', data: peopleLens }) }],
    edges: [...view.edges, { source: { kind: 'node', node_id: 'lens.stage' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'call.check' }, relation: 'about' }] };
  const result = await lensQuestions({ queryNarrativeGraph: async () => aboutView, inspectModel: async () => ({ model: unnamed }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'], limit: 50 });
  const call = result.lenses[0].open.find((item) => item.eventId === 'call.check');
  assert.match(call.noSubject, /names no person/u);
  assert.equal(result.lenses[0].open.find((item) => item.eventId === 'ana.p1').noSubject, undefined);
});
