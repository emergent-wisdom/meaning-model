import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LifeSimulationService } from '../src/service.mjs';
import { LENS_SCHEMA, defineLens, lensOpenQuestions, lensQuestions, lensUnit, placeReadings, readLenses } from '../src/lenses.mjs';
import { resolveTargets } from '../src/cut-shares.mjs';

// Fear or love, whole lives and drawn decisions belong to the storytelling profile, which these tests adopt.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

// A reading is held by someone, so it goes beneath them: an assessment Event under the holder's root, linked about the
// record it reads, with the Cut moved onto it unchanged.
const at = (start, end = start + 0.1) => ({ start, end });
const model = { meaning_model: {
  referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' }],
  events: [
    { id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
    { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
    { id: 'ana.p1', boundary: 'Training years, 2000-2010.', interval: at(2000, 2010) },
    { id: 'ana.choice1', boundary: 'Ana takes the night shifts', description: 'She signs up for every night in March.', interval: at(2005), participants: { subject: 'person.ana' } },
    { id: 'ana.choice2', boundary: 'Ana reports the error', interval: at(2015), participants: { subject: 'person.ana' } },
    { id: 'ana.keeps_card', boundary: 'Ana keeps the letter', interval: at(2003), participants: { subject: 'person.ana' } },
  ],
  event_relations: [['ana.life', 'ana.life.is.work'], ['ana.life', 'ana.p1']].map(([source, target]) => ({ id: `c.${target}`, kind: 'contains', source_event_id: source, target_event_id: target })),
  normalized_cuts: [
    { id: 'cut.ana.choice1', unit: 'decision', parent_event_id: 'ana.choice1', question: 'Does Ana take the shifts?', answers: [{ key: 'yes', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
    { id: 'cut.ana.choice2', unit: 'decision', parent_event_id: 'ana.choice2', question: 'Does Ana report it?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
    { id: 'cut.ana.fl', parent_event_id: 'ana.choice1', question: 'Is taking the shifts an act of love or of fear?', answers: [{ key: 'love_of_the_ward', weight: 0.3 }, { key: 'fear_of_debt', weight: 0.6 }, { key: 'remainder', weight: 0.1 }] },
    { id: 'lens.stage.ana.choice1', parent_event_id: 'ana.choice1', question: 'Stage?', unit: 'share', answers: [{ key: 'bartering', weight: 0.7 }, { key: 'standing', weight: 0.2 }, { key: 'remainder', weight: 0.1 }] },
  ],
} };
const lens = { schema: LENS_SCHEMA, id: 'stage', name: 'Wanting, bartering or standing', appliesTo: ['act', 'period'],
  question: 'Is {subject} done out of wanting, bartering for a reaction, or standing for something?', why: 'It changes what a setback does to a person.',
  answers: [{ key: 'wanting', meaning: 'want and get' }, { key: 'bartering', meaning: 'act for a reaction' }, { key: 'standing', meaning: 'act regardless of approval' }] };
const view = {
  graph: { source: { model_hash: 'a'.repeat(64) } },
  nodes: [{ id: 'lens.stage', node_type: 'understanding.lens', holder: 'writer', text: JSON.stringify({ schema: 'meaning-model-understanding-note/v1', kind: 'lens', text: 'Stage', data: lens }) }],
  edges: [{ source: { kind: 'node', node_id: 'lens.stage' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person.ana' }, relation: 'about' }],
};
const fake = (definition) => {
  const calls = [];
  return { calls, queryNarrativeGraph: async () => view, inspectModel: async () => ({ model: definition }),
    reviseModel: async (request) => { calls.push(request); return { modelHash: 'c'.repeat(64) }; } };
};

test('placing a lens puts each record\'s reading beneath the lens\'s holder, about its record, with the Cut unchanged', async () => {
  const service = fake(model);
  // The model declares no roots: placement first lists its top Events, since once a root is declared every Event needs one.
  const plan = await placeReadings(service, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['stage'] });
  assert.equal(plan.plan, true); assert.equal(service.calls.length, 0);
  assert.deepEqual([...plan.topEvents].sort(), ['ana.choice1', 'ana.choice2', 'ana.keeps_card', 'ana.life']);
  const result = await placeReadings(service, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['stage'], worldRoot: {} });
  const placed = service.calls[0].model.meaning_model;
  // The lens node's holder holds the readings, under a root declared as understanding.
  assert.deepEqual(result.rootsAdded, ['understanding.writer']);
  assert.ok(placed.context_roots.some((root) => root.event_id === 'understanding.writer' && root.kind === 'understanding'));
  // The world is one: an untimed History Event, declared accepted world, contains the world's top Events.
  assert.equal(result.worldRoot, 'history'); assert.deepEqual([...result.worldContains].sort(), ['ana.choice1', 'ana.choice2', 'ana.keeps_card', 'ana.life']);
  assert.deepEqual(placed.context_roots.filter((root) => root.kind === 'accepted_world').map((root) => root.event_id), ['history']);
  assert.equal(placed.events.find((event) => event.id === 'history').interval, undefined);
  // One untimed reading Event per record, contained by the root and about the record.
  const reading = placed.events.find((event) => event.id === 'reading.stage.ana.choice1');
  assert.ok(reading); assert.equal(reading.interval, undefined); assert.equal(reading.participants, undefined);
  assert.ok(reading.provenance.includes('perspective:modeler') && reading.provenance.includes('holder:writer'));
  assert.ok(placed.event_relations.some((relation) => relation.kind === 'contains' && relation.source_event_id === 'understanding.writer' && relation.target_event_id === reading.id));
  assert.ok(placed.event_relations.some((relation) => relation.kind === 'about' && relation.source_event_id === reading.id && relation.target_event_id === 'ana.choice1'));
  assert.equal(result.readingEventsAdded, 3);
  // The Cut moved with its id, question, unit and weights as they were.
  const before = model.meaning_model.normalized_cuts.find((cut) => cut.id === 'lens.stage.ana.choice1');
  const after = placed.normalized_cuts.find((cut) => cut.id === 'lens.stage.ana.choice1');
  assert.deepEqual({ ...after, parent_event_id: before.parent_event_id }, before);
  assert.equal(after.parent_event_id, reading.id);
  assert.deepEqual(result.movedCutIds, ['lens.stage.ana.choice1']);
  // The world's own Cuts stay where they are.
  assert.equal(placed.normalized_cuts.find((cut) => cut.id === 'cut.ana.choice1').parent_event_id, 'ana.choice1');

  // Read back: the answer is found through about, nothing sits in the world, and the open records name their reading Event.
  const read = await lensQuestions({ ...service, inspectModel: async () => ({ model: service.calls[0].model }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] });
  const [stage] = read.lenses;
  assert.equal(stage.answered, 1); assert.equal(stage.inWorld, 0);
  const open = stage.open.find((item) => item.eventId === 'ana.p1');
  assert.equal(open.placement.eventId, 'reading.stage.ana.p1'); assert.equal(open.placement.rootExists, true); assert.equal(open.placement.about, 'ana.p1');
  // Placing again changes nothing.
  const again = await placeReadings({ ...service, inspectModel: async () => ({ model: service.calls[0].model }) }, { graphHash: 'b'.repeat(64), requestId: 'place-2', accessScopes: ['author'], lensIds: ['stage'] });
  assert.equal(again.graphMutation, false); assert.equal(service.calls.length, 1);
});

test('a reading on its record is asked to be placed, and a Cut the lens did not make stays where it is', async () => {
  const [first] = lensOpenQuestions(view, model);
  assert.equal(first.kind, 'lens-unplaced'); assert.equal(first.tool, 'life_lens_place'); assert.match(first.question, /1 lens reading sits on the record it reads/u);
  // Fear or love matches an older Cut by its question: it is reported, not moved, since it may be canon.
  const service = fake(model);
  const result = await placeReadings(service, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['fear-love'], records: 'in-world', worldRoot: {} });
  assert.deepEqual(result.kept.map((item) => item.cutId), ['cut.ana.fl']);
  assert.equal(result.moved, 0);
  // Said to be the modeler's reading, it moves beneath the modeler's root and counts; said to be a direction Cut, it stays and is no longer reported.
  const asReading = fake(model);
  await placeReadings(asReading, { graphHash: 'b'.repeat(64), requestId: 'resolve', accessScopes: ['author'], lensIds: ['fear-love'], worldRoot: {}, holder: 'writer', resolve: [{ cutId: 'cut.ana.fl', as: 'reading' }] });
  const readModel = asReading.calls[0].model;
  assert.equal(readModel.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.ana.fl').parent_event_id, 'reading.fear-love.ana.choice1');
  const counted = await lensQuestions({ ...asReading, inspectModel: async () => ({ model: readModel }) }, { graphHash: 'b'.repeat(64), lensIds: ['fear-love'] });
  assert.equal(counted.lenses[0].answered, 1);
  const asDirection = fake(model);
  await placeReadings(asDirection, { graphHash: 'b'.repeat(64), requestId: 'resolve', accessScopes: ['author'], lensIds: ['fear-love'], worldRoot: {}, resolve: [{ cutId: 'cut.ana.fl', as: 'direction' }] });
  const left = asDirection.calls[0].model;
  assert.equal(left.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.ana.fl').parent_event_id, 'ana.choice1');
  const quiet = await lensQuestions({ ...asDirection, inspectModel: async () => ({ model: left }) }, { graphHash: 'b'.repeat(64), lensIds: ['fear-love'] });
  assert.equal(quiet.lenses[0].open.find((item) => item.eventId === 'ana.choice1').matched, undefined);
});

test('the estimator reads a reading Event through its about link: the record\'s text, subject and signature', async () => {
  const service = fake(model);
  await placeReadings(service, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['stage'], worldRoot: {} });
  const placed = service.calls[0].model;
  const { targets } = await resolveTargets({ inspectModel: async () => ({ model: placed }) }, { modelHash: 'c'.repeat(64), situations: [], events: [{ eventId: 'reading.stage.ana.choice1' }] });
  assert.equal(targets[0].parentEventId, 'reading.stage.ana.choice1');
  assert.equal(targets[0].text, 'Ana takes the night shifts She signs up for every night in March.');
  assert.equal(targets[0].subject, 'Ana Berg');
  // The modeler reads the record as the model holds it at the act, and the lens's own readings stay out of it.
  assert.match(targets[0].modeled ?? '', /Ana/u); assert.doesNotMatch(targets[0].modeled ?? '', /Stage\?/u);
});

test('an actor\'s own reasons go on an inner Event under their inner root, and without one the tool says so', async () => {
  const actorLens = { ...lens, id: 'reasons', name: 'Her own reasons', perspective: 'actor', appliesTo: ['act'] };
  const actorView = { ...view, nodes: [{ ...view.nodes[0], id: 'lens.reasons', text: JSON.stringify({ schema: 'meaning-model-understanding-note/v1', kind: 'lens', text: 'Reasons', data: actorLens }) }],
    edges: [{ ...view.edges[0], source: { kind: 'node', node_id: 'lens.reasons' } }] };
  const withoutRoot = { ...fake(model), queryNarrativeGraph: async () => actorView };
  const refused = await placeReadings(withoutRoot, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['reasons'] });
  assert.ok(refused.refused.length >= 1); assert.match(refused.refused[0].reason, /no inner root/u);
  const inner = structuredClone(model);
  inner.meaning_model.events.push({ id: 'ana.inner', boundary: 'Ana\'s inner perspective root', participants: { subject: 'person.ana' } });
  inner.meaning_model.event_relations.push({ id: 'c.ana.inner', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.inner' });
  inner.meaning_model.context_roots = [{ event_id: 'ana.life', kind: 'accepted_world', provenance: ['t'] }, { event_id: 'ana.choice1', kind: 'accepted_world', provenance: ['t'] },
    { event_id: 'ana.choice2', kind: 'accepted_world', provenance: ['t'] }, { event_id: 'ana.keeps_card', kind: 'accepted_world', provenance: ['t'] }, { event_id: 'ana.inner', kind: 'inner', provenance: ['t'] }];
  const service = { ...fake(inner), queryNarrativeGraph: async () => actorView };
  const result = await placeReadings(service, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['reasons'] });
  assert.deepEqual(result.refused, []); assert.deepEqual(result.rootsAdded, []);
  const placed = service.calls[0].model.meaning_model;
  const reasons = placed.events.find((event) => event.id === 'inner.reasons.ana.choice1');
  assert.deepEqual(reasons.participants, { subject: 'person.ana' }); assert.deepEqual(reasons.interval, at(2005));
  assert.ok(placed.event_relations.some((relation) => relation.kind === 'contains' && relation.source_event_id === 'ana.inner' && relation.target_event_id === reasons.id));
});

// Against the engine: the revision validates, the readings sit in their own context, and a model whose Cuts condition
// across its top Events is not split into separate worlds.
async function exampleService(t, extraCuts = []) {
  const command = JSON.parse(await readFile(new URL('../../rust-engine/examples/meaning-model-command.json', import.meta.url), 'utf8'));
  const provenance = ['placement-test'];
  const definition = structuredClone(command.model);
  definition.meaning_model.normalized_cuts = [
    { id: 'lens.tone.event.care-phase', parent_event_id: 'event.care-phase', question: 'Is the care phase warm or cold?', unit: 'share of the lens\'s reading of this record',
      answers: [{ key: 'warm', weight: 0.8 }, { key: 'cold', weight: 0.1 }, { key: 'remainder', weight: 0.1 }], provenance }, ...extraCuts];
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const registered = await service.registerModel({ requestId: 'model', model: definition });
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'placement', revision: { number: 0, reason: 'Placement test.', provenance },
    source: { kind: 'model', model_hash: registered.modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  const defined = await defineLens(service, { graphHash: graph.graphHash, requestId: 'lens', accessScopes: ['author'], holder: 'writer',
    lens: { id: 'tone', name: 'Tone', question: 'Is {subject} warm or cold?', appliesTo: ['event'], why: 'The phases differ in warmth.', answers: [{ key: 'warm', meaning: 'warm' }, { key: 'cold', meaning: 'cold' }] },
    about: [{ record: 'event:event.care-phase' }] });
  return { service, graphHash: defined.graphHash, modelHash: registered.modelHash };
}

test('the engine accepts placed readings in the holder\'s own context, and the graph reads them after the rebind', async (t) => {
  const f = await exampleService(t);
  const result = await placeReadings(f.service, { graphHash: f.graphHash, requestId: 'place', accessScopes: ['author'], worldRoot: {}, rebind: { graphHash: f.graphHash, accessScopes: ['author'] } });
  assert.equal(result.moved, 1); assert.ok(result.rebound?.graphHash);
  const { model: placed } = await f.service.inspectModel({ modelHash: result.modelHash, includeDefinition: true });
  const roots = Object.fromEntries(placed.meaning_model.context_roots.map((root) => [root.event_id, root.kind]));
  assert.equal(roots['understanding.writer'], 'understanding');
  assert.equal(roots.history, 'accepted_world'); assert.equal(roots['event.relationship'], undefined);
  assert.equal(placed.meaning_model.event_relations.find((relation) => relation.id === 'about.reading.tone.event.care-phase').kind, 'about');
  const read = await lensQuestions(f.service, { graphHash: result.rebound.graphHash, accessScopes: ['author'], lensIds: ['tone'] });
  assert.equal(read.lenses[0].answered, 1); assert.equal(read.lenses[0].inWorld, 0);
});

test('a model without roots is kept one world, and giving part of it a root of its own may not split a chain', async (t) => {
  const provenance = ['placement-test'];
  const f = await exampleService(t, [
    { id: 'q.trust', parent_event_id: 'event.trust-phase', question: 'Does trust hold?', unit: 'decision', answers: [{ key: 'holds', weight: 0.6 }, { key: 'remainder', weight: 0.4 }], provenance },
    { id: 'q.care', parent_event_id: 'event.care-phase', question: 'Does care follow?', unit: 'decision', answers: [{ key: 'yes', weight: 0.5 }, { key: 'remainder', weight: 0.5 }], conditioning: { cut_id: 'q.trust', answer_key: 'holds' }, provenance }]);
  const plan = await placeReadings(f.service, { graphHash: f.graphHash, requestId: 'place', accessScopes: ['author'] });
  assert.equal(plan.plan, true); assert.deepEqual([...plan.topEvents].sort(), ['event.care-phase', 'event.relationship', 'event.trust-phase']);
  await assert.rejects(placeReadings(f.service, { graphHash: f.graphHash, requestId: 'split', accessScopes: ['author'], worldRoot: { otherRoots: [{ eventId: 'event.trust-phase', kind: 'document' }] } }),
    /would split Cuts that condition or recompose across them/u);
  // One History root keeps the conditioning within one context, and the engine accepts it.
  const placed = await placeReadings(f.service, { graphHash: f.graphHash, requestId: 'place-one', accessScopes: ['author'], worldRoot: {} });
  assert.equal(placed.worldRoot, 'history'); assert.equal(placed.moved, 1);
});

test('a lens keeps its perspective across its versions: a different holder is a different lens', async (t) => {
  const f = await exampleService(t);
  const again = { graphHash: f.graphHash, requestId: 'lens-actor', accessScopes: ['author'], holder: 'writer',
    lens: { id: 'tone', name: 'Tone', question: 'Is {subject} warm or cold?', appliesTo: ['event'], why: 'The phases differ in warmth.', perspective: 'actor', answers: [{ key: 'warm', meaning: 'warm' }, { key: 'cold', meaning: 'cold' }] },
    about: [{ record: 'event:event.care-phase' }] };
  await assert.rejects(defineLens(f.service, again), /keeps its perspective across its versions/u);
});


test('a shift the model gives a cause for is not asked about, and an estimate signs the situation it read', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const person = { meaning_model: {
    referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' }],
    events: [{ id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
      { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
      { id: 'ana.a', boundary: 'Ana at the ward, 2004', interval: at(2004), participants: { subject: 'person.ana' } },
      { id: 'ana.b', boundary: 'Ana at the ward, 2008', interval: at(2008), participants: { subject: 'person.ana' } },
      { id: 'grandfather.dies', boundary: 'Her grandfather dies', interval: at(2006) }],
    event_relations: [{ kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' }],
    normalized_cuts: ['a', 'b'].map((key, i) => ({ id: `feel.${key}`, parent_event_id: `ana.${key}`, unit: 'emotional attention', question: 'What does Ana feel at work?',
      answers: [{ key: 'calm', weight: i ? 0.2 : 0.8 }, { key: 'grief', weight: i ? 0.7 : 0.1 }, { key: 'remainder', weight: 0.1 }] })) } };
  const ask = async (definition) => (await readOpenQuestions({ inspectModel: async () => ({ model: definition }) }, { modelHash: 'a'.repeat(64), limit: 40 })).questions.filter((item) => item.kind === 'shift-uncaused');
  assert.equal((await ask(person)).length, 1);
  const caused = structuredClone(person);
  caused.meaning_model.event_relations.push({ kind: 'causes', source_event_id: 'grandfather.dies', target_event_id: 'ana.b' });
  assert.equal((await ask(caused)).length, 0);
  const { proposalFromProbabilities } = await import('../src/cut-shares.mjs');
  const proposal = proposalFromProbabilities({ question: 'q', unit: 'u', idPrefix: 'p', answers: [{ key: 'calm' }, { key: 'grief' }] },
    { id: 'x', parentEventId: 'ana.b', cutId: 'feel.x', text: 'Ana at the ward in 2008, a year after the funeral.' }, { calm: 0.3, grief: 0.7, remainder: 0 }, { label: 'test', confidence: 0.9, requireComplete: true });
  assert.ok(proposal.provenance.some((item) => /^situation:[0-9a-f]{16}$/u.test(item)));
});

test('the engine accepts a reading opened into kinds on its reading Event, its remainder opened too', async (t) => {
  const f = await exampleService(t);
  const placed = await placeReadings(f.service, { graphHash: f.graphHash, requestId: 'place', accessScopes: ['author'], worldRoot: {} });
  const { model } = await f.service.inspectModel({ modelHash: placed.modelHash, includeDefinition: true });
  const successor = structuredClone(model); const provenance = ['deepening-test'];
  const on = 'reading.tone.event.care-phase'; const topId = 'lens.tone.event.care-phase';
  successor.meaning_model.normalized_cuts.push(
    { id: `${topId}.in.warm`, parent_event_id: on, question: 'Within the warmth, which kind?', unit: 'lens:tone/warm@test', conditioning: { cut_id: topId, answer_key: 'warm' },
      answers: [{ key: 'tender', weight: 0.6 }, { key: 'dutiful', weight: 0.3 }, { key: 'remainder', weight: 0.1 }], provenance },
    { id: `${topId}.in.remainder`, parent_event_id: on, question: 'What else?', unit: 'lens:tone/remainder@test', conditioning: { cut_id: topId, answer_key: 'remainder' },
      answers: [{ key: 'weary', weight: 0.7 }, { key: 'remainder', weight: 0.3 }], provenance });
  successor.revision = { number: Number(model.revision.number) + 1, previous_model_hash: placed.modelHash, provenance, reason: 'Open the warmth and the remainder of the care phase reading.' };
  const revised = await f.service.reviseModel({ requestId: 'open', previousModelHash: placed.modelHash, model: successor });
  assert.ok(revised.modelHash);
  // A deeper level on the record itself, outside the reading's context, is refused by the engine.
  const astray = structuredClone(successor); astray.meaning_model.normalized_cuts.find((cut) => cut.id === `${topId}.in.warm`).parent_event_id = 'event.care-phase';
  astray.revision = { ...successor.revision, reason: 'A level outside its reading.' };
  await assert.rejects(f.service.reviseModel({ requestId: 'astray', previousModelHash: placed.modelHash, model: astray }), /conditioning crosses context roots/u);
});

test('stale readings of a rewritten record are read again across lenses in one revision, each with how far it moved', async () => {
  const { rereadLenses } = await import('../src/lenses.mjs');
  const { eventTextSignature } = await import('../src/cut-shares.mjs');
  const service0 = fake(model);
  await placeReadings(service0, { graphHash: 'b'.repeat(64), requestId: 'place', accessScopes: ['author'], lensIds: ['stage'], worldRoot: {} });
  const placed = structuredClone(service0.calls[0].model);
  const record = placed.meaning_model.events.find((event) => event.id === 'ana.choice1');
  const reading = placed.meaning_model.normalized_cuts.find((cut) => cut.id === 'lens.stage.ana.choice1');
  reading.unit = lensUnit(readLenses(view).find((item) => item.id === 'stage')); reading.provenance = ['estimator:test', `event-text:${eventTextSignature(record)}`];
  record.description = 'She signs up for every night in March, and tells no one why.';
  const calls = [];
  const service = { queryNarrativeGraph: async () => view, inspectModel: async () => ({ model: placed }), reviseModel: async (request) => { calls.push(request); return { modelHash: 'e'.repeat(64) }; } };
  const estimator = { backend: 'test', model: 'm', label: 'test:m', async estimate() { return { model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, answers: { shares: { type: 'choice', probabilities: { wanting: 0, bartering: 0.68, standing: 0.2, remainder: 0.12 }, confidence: 0.9 } } }; } };
  const result = await rereadLenses(service, estimator, { graphHash: 'b'.repeat(64), requestId: 'reread', accessScopes: ['author'] });
  assert.equal(calls.length, 1); assert.equal(result.read.length, 1);
  assert.equal(result.read[0].cutId, 'lens.stage.ana.choice1'); assert.equal(result.read[0].before, 'bartering 0.70'); assert.equal(result.read[0].after, 'bartering 0.68');
  assert.ok(result.read[0].moved <= 0.05); assert.match(result.nextStep, /1 of 1 moved 0\.05 or less/u);
  const updated = calls[0].model.meaning_model.normalized_cuts.find((cut) => cut.id === 'lens.stage.ana.choice1');
  assert.equal(updated.parent_event_id, 'reading.stage.ana.choice1'); assert.ok(updated.provenance.includes(`event-text:${eventTextSignature(record)}`));
  await assert.rejects(rereadLenses(service, null, { graphHash: 'b'.repeat(64), requestId: 'x', accessScopes: ['author'] }), /needs the configured estimator/u);
});
