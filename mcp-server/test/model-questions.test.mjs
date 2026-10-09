import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { modelJumps, modelQuestions, personStateAt, standingQuestions, thinkInTheModelInstructions } from '../src/model-questions.mjs';
import { withLives } from './storytelling-life-fixture.mjs';

// Whole lives, optional interpretive lenses and drawn open choices belong to the storytelling profile adopted here.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

const cut = (id, parent, question, unit, answers) => ({ id, parent_event_id: parent, question, unit, answers: Object.entries(answers).map(([key, weight]) => ({ key, weight })), provenance: ['authored'] });
const event = (id, start, end, extra = {}) => ({ id, boundary: id, description: `What happens in ${id}.`, interval: { start, end }, ...extra });

function lived() {
  const model = withLives({ id: 'm', meaning_model: {} }, ['leo']);
  const mm = model.meaning_model;
  mm.events.push(event('ev.early', -10, -9, { participants: { subject: 'leo' } }), event('ev.late', 10, 11, { participants: { subject: 'leo' } }), event('ev.choice', 20, 21, { participants: { subject: 'leo' } }));
  mm.normalized_cuts.push(
    cut('cut.early', 'ev.early', 'How is fulfillment anticipated?', 'represented fulfillment outlook', { assured: 0.8, threatened: 0.15, remainder: 0.05 }),
    cut('cut.late', 'ev.late', 'How is fulfillment anticipated?', 'represented fulfillment outlook', { assured: 0.2, threatened: 0.75, remainder: 0.05 }),
    cut('cut.choice', 'ev.choice', 'Which continuation follows?', 'decision allocation', { stay: 0.45, leave: 0.4, remainder: 0.15 }));
  return model;
}

test('model questions retain their kinds for unrecognized causes, wants, draw history and broader context', () => {
  const questions = modelQuestions(lived(), { people: [{ id: 'leo', name: 'Leo' }], limit: 100 });
  const kinds = new Set(questions.questions.map((item) => item.kind));
  for (const kind of ['shift-uncaused', 'decision-undrawn', 'moment-unmodeled', 'macro-missing', 'wants-missing', 'concepts-thin', 'weights-unestimated']) assert.ok(kinds.has(kind), kind);
  const shift = questions.questions.find((item) => item.kind === 'shift-uncaused');
  assert.match(shift.question, /Leo's "How is fulfillment anticipated\?" moves assured from 0\.80 to 0\.20/);
  assert.equal(questions.alwaysAsk.length >= 4, true);
  assert.match(questions.alwaysAsk[0], /How can you understand .* better, using the model\?/);
});

test('a shock between two moments is the cause the question asks for, and a recorded draw decides the decision', () => {
  const model = lived();
  model.meaning_model.events.find((item) => item.id === 'event.arc.leo.0.focal_change').interval = { start: 0, end: 1 };
  model.meaning_model.events.find((item) => item.id === 'event.arc.leo.0').interval = { start: 0, end: 1 };
  const questions = modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], draws: [{ cutId: 'cut.choice', realized: 'stay' }], limit: 100 });
  assert.ok(!questions.questions.some((item) => item.kind === 'shift-uncaused'), 'the shock at 0 explains the shift between -10 and 10');
  assert.ok(!questions.questions.some((item) => item.kind === 'decision-undrawn'));
  const state = personStateAt(model, 'leo', 25, { draws: [{ cutId: 'cut.choice', realized: 'stay' }] });
  assert.equal(state.decided[0].realized, 'stay');
  assert.equal(state.latest.find((item) => item.kind === 'outlook').answers[0].key, 'threatened');
  assert.equal(state.periods.length, 1);
});

test('person state recognizes both fulfilment and fulfillment outlook units', () => {
  for (const unit of ['share of one unit of represented outlook toward fulfilment of active wants', 'represented fulfillment outlook']) {
    const model = lived();
    for (const item of model.meaning_model.normalized_cuts.filter((item) => ['cut.early', 'cut.late'].includes(item.id))) item.unit = unit;
    const state = personStateAt(model, 'leo', 25);
    const latest = state.latest.find((item) => item.cutId === 'cut.late');
    assert.equal(latest?.kind, 'outlook', unit);
    assert.equal(latest.at, 10);
    assert.deepEqual(latest.answers, [{ key: 'threatened', weight: 0.75 }, { key: 'assured', weight: 0.2 }, { key: 'remainder', weight: 0.05 }]);
    assert.ok(!state.latest.some((item) => item.cutId === 'cut.early'), 'the later outlook remains the current reading');
  }
});

test('unrecognized wants expressed in descriptions or custom Cuts are an inspection question, not declared absent', () => {
  for (const representation of ['description', 'custom Cut']) {
    const model = lived();
    model.meaning_model.events.find((item) => item.id === 'ev.choice').description = 'Leo wants to keep his daughter housed; keeping the job has become his learned way to do that.';
    if (representation === 'custom Cut') model.meaning_model.normalized_cuts.push(
      cut('cut.leo.aims', 'ev.choice', 'What is Leo trying to secure?', 'share of attention among concrete aims', { daughters_home: 0.8, status_at_work: 0.15, remainder: 0.05 }));
    const questions = modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], limit: 100 });
    const wants = questions.questions.find((item) => item.kind === 'wants-missing');
    assert.ok(wants, `${representation}: the existing question kind can flag the recognition gap`);
    assert.match(wants.question, /recogniz/iu, representation);
    assert.match(wants.question, /description|other records/iu, representation);
    assert.match(wants.question, /inspect|check|read/iu, representation);
    assert.doesNotMatch(wants.question, /nothing in the model says|has no wants|no wants (?:are|have been) modeled/iu, representation);
  }
});

test('qualitative life history outside the scaffold prompts inspection, not invented periods or shocks', () => {
  const model = { id: 'qualitative-life', meaning_model: {
    referents: [{ id: 'nell', lifecycle_event_id: 'nell.life' }],
    events: [event('nell.life', 0, 28, {
      description: 'Nell learned independent checking during apprenticeship at nineteen. Repeated checks have sustained the same working habit since then; no later shock is established.',
      participants: { subject: 'nell' },
    })],
  } };
  const questions = modelQuestions(model, { people: [{ id: 'nell', name: 'Nell' }], limit: 100 });
  for (const kind of ['processes-few', 'periods-missing', 'shocks-few']) {
    const question = questions.questions.find((item) => item.kind === kind)?.question;
    assert.ok(question, kind);
    assert.match(question, /recogniz/iu, kind);
    assert.match(question, /read.*(?:description|dossier|record|structure)/iu, kind);
    assert.doesNotMatch(question, /the model shows none|life runs through 0 processes/iu, kind);
  }
  assert.match(questions.questions.find((item) => item.kind === 'periods-missing').question, /partition.*optional/iu);
  assert.match(questions.questions.find((item) => item.kind === 'shocks-few').question, /do not invent shocks/iu);
});

test('an uncut qualitative period and an unopened process do not require numerical shares', () => {
  const questions = modelQuestions(lived(), { people: [{ id: 'leo', name: 'Leo' }], limit: 100 });
  const period = questions.questions.find((item) => item.kind === 'period-uncut');
  assert.ok(period);
  assert.match(period.question, /qualitatively.*read it first/iu);
  assert.match(period.question, /only if.*comparison.*unit/iu);
  assert.doesNotMatch(period.question, /give the period its outlook Cut/iu);
  const process = questions.questions.find((item) => item.kind === 'process-empty');
  assert.ok(process);
  assert.match(process.question, /read.*descriptions/iu);
  assert.match(process.question, /does not require numerical Cuts/iu);
});

test('a cause described outside the change-arc convention is not declared nonexistent', () => {
  const model = lived();
  model.meaning_model.events.push(event('ev.letter', 0, 1, {
    participants: { subject: 'leo' },
    description: 'The employer closes the depot. Losing the job causes Leo to expect that he cannot keep his daughter housed.',
  }));
  const questions = modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], limit: 100 });
  const shift = questions.questions.find((item) => item.kind === 'shift-uncaused');
  assert.ok(shift, 'the recognizer still flags the unlinked shift for inspection');
  assert.deepEqual(shift.cuts, ['cut.early', 'cut.late']);
  assert.match(shift.question, /recogniz/iu);
  assert.match(shift.question, /description|other forms|other records/iu);
  assert.match(shift.question, /inspect|check|read/iu);
  assert.doesNotMatch(shift.question, /nothing modeled between them to cause it|no cause exists/iu);
});

test('an explicit enclosing world counts when untimed or bounded to the same span as a life', () => {
  for (const untimed of [true, false]) {
    const model = { id: 'bounded-world', meaning_model: {
      referents: [{ id: 'ada', lifecycle_event_id: 'ev.ada.life' }],
      events: [
        { id: 'ev.world', boundary: 'The town and its institutions during Ada\'s life.', ...(untimed ? {} : { interval: { start: 0, end: 36 } }) },
        { id: 'ev.town', boundary: 'The town in which Ada lives.' },
        event('ev.ada.life', 0, 36), event('ev.ada.youth', 0, 18), event('ev.ada.later', 18, 36),
      ],
      event_relations: [
        { id: 'world.town', kind: 'contains', source_event_id: 'ev.world', target_event_id: 'ev.town' },
        { id: 'town.life', kind: 'contains', source_event_id: 'ev.town', target_event_id: 'ev.ada.life' },
        ...['ev.ada.youth', 'ev.ada.later'].map((target) => ({ id: `life.${target}`, kind: 'contains', source_event_id: 'ev.ada.life', target_event_id: target })),
      ],
      ...(untimed ? { context_roots: [{ event_id: 'ev.world', kind: 'accepted_world' }] } : {}),
    } };
    const questions = modelQuestions(model, { people: [{ id: 'ada', name: 'Ada' }], limit: 100 });
    assert.ok(!questions.questions.some((item) => item.kind === 'macro-missing'), untimed ? 'the untimed accepted-world ancestor encloses the life' : 'an enclosing world need not outlast the life it contains');
  }
});

test('an unrelated accepted-world root does not hide a missing enclosing context', () => {
  const model = lived();
  model.meaning_model.events.push({ id: 'ev.other-world', boundary: 'A disconnected world context.' });
  model.meaning_model.context_roots = [{ event_id: 'ev.other-world', kind: 'accepted_world' }];
  const questions = modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], limit: 100 });
  assert.ok(questions.questions.some((item) => item.kind === 'macro-missing'));
});

test('unknown or empty draw history preserves an accepted retrospective outcome', () => {
  for (const draws of [null, []]) {
    const model = lived();
    model.meaning_model.events.find((item) => item.id === 'ev.choice').description = 'Leo left the job. This accepted event records his completed choice retrospectively.';
    model.meaning_model.context_roots = [{ event_id: 'ev.choice', kind: 'accepted_world' }];
    const questions = modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], draws, limit: 100 });
    const decision = questions.questions.find((item) => item.kind === 'decision-undrawn');
    assert.ok(decision, 'the existing kind can prompt checking outcome and draw provenance');
    assert.ok(decision.cuts.includes('cut.choice'));
    assert.match(decision.question, /accepted|retrospective/iu);
    assert.match(decision.question, /preserve|do not (?:redraw|reroll|rewrite|replace)|never (?:redraw|reroll|rewrite|replace)/iu);
    assert.match(decision.question, /open/iu);
    assert.match(decision.question, /delegat/iu);
    assert.doesNotMatch(decision.question, /Draw each with a recorded seed|Draw it with a recorded seed:|has not been drawn\./u);
  }
});

test('templates are suggestions: a life of the modeler\'s own processes is read as a life', () => {
  const model = { id: 'own', meaning_model: { referents: [{ id: 'ada', lifecycle_event_id: 'ev.ada.life' }],
    events: [event('ev.ada.life', 0, 36), event('ev.ada.mathematics', 0, 36), event('ev.ada.debts', 30, 36), event('ev.ada.youth', 0, 18), event('ev.ada.later', 18, 36)],
    event_relations: ['ev.ada.mathematics', 'ev.ada.youth', 'ev.ada.later'].map((target) => ({ id: `r.${target}`, kind: 'contains', source_event_id: 'ev.ada.life', target_event_id: target })) } };
  const questions = modelQuestions(model, { people: [{ id: 'ada', name: 'Ada' }], limit: 100 });
  assert.ok(!questions.questions.some((item) => item.kind === 'periods-missing'), 'her own periods count');
  const few = questions.questions.find((item) => item.kind === 'processes-few');
  assert.match(few.question, /template suggests.*your own processes or fewer/);
  assert.match(questions.guidance, /none of its constructs is mandatory/);
  assert.match(thinkInTheModelInstructions, /the model is a language with no mandatory constructs/);
  assert.match(thinkInTheModelInstructions, /find all the areas that could be important to investigate; go deeper inside the model, building structures on top of structures, interpreting them and refining the ones you have; when you generate, roll draws and use random words where the model holds real alternatives and keep what surprises and convinces, and when you describe, ask for the data and infer what the evidence supports; put all your understanding inside the model\. Then loop again/);
  assert.match(thinkInTheModelInstructions, /people and things, and whatever about them changes, as processes over time/);
});

test('the jumps of the Book of Conditions are where its story is', async () => {
  // The 2 October 2026 model, before whole lives were added; the bundle keeps every revision of the history.
  const edition = JSON.parse(await readFile(new URL('../../examples/book-of-conditions/PUBLICATION-MANIFEST.json', import.meta.url), 'utf8'));
  const record = JSON.parse(await readFile(new URL(`../../examples/book-of-conditions/${edition.publicationProjection.manifest}`, import.meta.url), 'utf8'));
  const bundle = JSON.parse(await readFile(new URL('../../examples/book-of-conditions/the-book-of-conditions.meaning-model.json', import.meta.url), 'utf8'));
  const october2 = record.hashMapping.models.find(entry => entry.former === edition.priorPublicationProjection.modelHash).current;
  const model = bundle.models.find(entry => entry.modelHash === october2).definition;
  const { jumps } = modelJumps(model, { limit: 6 });
  assert.ok(jumps.some((item) => /four_jobs/u.test(item.what)), 'the four-job decision is among the largest jumps');
  assert.ok(jumps.some((item) => /Halden/u.test(item.what) && /0\.78 to 0\.18/u.test(item.what)), 'Halden\'s collapse is among them');
  const questions = modelQuestions(model, { limit: 200 });
  assert.ok(questions.questions.some((item) => item.kind === 'laws-missing'), 'even the Book is asked to climb up');
  assert.ok(questions.questions.some((item) => item.kind === 'shocks-few' && /Ada Lovelace/u.test(item.question)));
});

test('standing questions are asked about the focus', () => {
  const questions = standingQuestions({ scene: 'the returned table', people: ['Halden'] });
  assert.ok(questions.some((item) => /macro aspect .* childhood or a war a hundred years ago/u.test(item)));
  assert.ok(questions.some((item) => /Ask yourself about this scene \(the returned table\), this character \(Halden\): which assumptions have I not modeled yet\? Which assumptions could stretch back far in time to create a deeper story\?/u.test(item)),
    'a story asks which of its assumptions are unmodeled and which reach far back');
  assert.ok(questions.some((item) => /Can you understand Halden better by inventing processes or subcategories/u.test(item)));
  const investigation = questions.find((item) => /List all the aspects .* then investigate by modeling/u.test(item));
  assert.ok(investigation);
  assert.match(investigation, /read the existing evidence/u);
  assert.match(investigation, /refine processes/u);
  for (const focus of [{ people: ['Halden'] }, { people: ['Brita', 'Johan'] }, {}]) {
    const prompts = standingQuestions(focus);
    const lens = prompts.find((item) => /fear (?:or|and) love/iu.test(item));
    assert.ok(lens, 'fear and love remain available for investigation');
    assert.match(lens, /if .*useful|where .*useful|optional|one (?:possible )?lens/iu);
    assert.doesNotMatch(prompts.join('\n'), /are they primarily out of fear or out of love|Most acts mix both: model the shares/u);
    assert.ok(prompts.some((item) => /institution|body|money|purse/iu.test(item)), 'the questions retain other explanatory routes');
  }
});

test('recursive discovery remains invited when all recognized reminders are locally sufficient', () => {
  const questions = modelQuestions(lived(), { people: [{ id: 'leo', name: 'Leo' }], sufficient: { covers: () => true } });
  assert.equal(questions.total, 0);
  assert.deepEqual(questions.questions, []);
  assert.match(questions.alwaysAsk.join(' '), /discovery lead recursively to new questions/u);
  assert.match(questions.alwaysAsk.join(' '), /nothing is known to be wrong/u);
  assert.match(questions.alwaysAsk.join(' '), /what category would you need to invent/u);
  assert.match(thinkInTheModelInstructions, /It is not a strict workflow: the steps come in any order/u);
});

test('the story catalog keeps fear and love as an optional lens on reasons', async () => {
  const { storyInterest } = await import('../src/storytelling-interest.mjs');
  const element = storyInterest.find((item) => item.id === 'fear-love');
  assert.equal(element?.group, 'people');
  assert.match(element.investigate, /if .*useful|where .*useful|optional|one (?:possible )?lens/iu);
  assert.doesNotMatch(element.investigate, /Ask of every consequential act|whether they are primarily out of fear or out of love/u);
  const choices = storyInterest.find((item) => item.id === 'choices').investigate;
  assert.match(choices, /reason/iu);
  assert.doesNotMatch(choices, /primarily out of fear or out of love/u);
});

test('a model that keeps changing while its record holds few thoughts is asked where the understanding is', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const model = { ...lived(), revision: { number: 4 } };
  const service = { inspectModel: async () => ({ model }), queryNarrativeGraph: async () => ({ graph: { source: { kind: 'model', model_hash: 'f'.repeat(64) } }, nodes: [{ id: 'n', role: 'externalized_reflection' }], edges: [] }) };
  const open = await readOpenQuestions(service, { modelHash: 'f'.repeat(64), graphHash: 'a'.repeat(64), limit: 5 });
  assert.equal(open.questions[0].kind, 'understanding-outside');
  assert.match(open.questions[0].question, /changed 4 times and its record holds 1 thought\. Where is your understanding\? Use the model as your mind/);
  assert.match(open.questions[0].question, /consequential ideas, findings, decisions and their reasons, predictions and open questions/);
  assert.match(open.questions[0].question, /not a semantic test or a quota for notes/);
  assert.doesNotMatch(open.questions[0].question, /put each thought into it as you have it/);
});

test('continuing a saved story discovers its author life and reports a missing portable dependency', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const storyHash = 'a'.repeat(64), lifeHash = 'b'.repeat(64);
  const model = lived();
  const view = { graph: { source: { kind: 'model', model_hash: storyHash } }, nodes: [
    { id: 'story', role: 'document_root' }, { id: 'passage', role: 'story_passage' },
    { id: 'author.world', subject: 'story', node_type: 'storytelling.world', value_time: 1,
      text: JSON.stringify({ data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader',
        author: { personId: 'author.person', name: 'The invented writer', lifeModelHash: lifeHash } } }) },
  ], edges: [] };
  const service = { inspectModel: async ({ modelHash }) => {
    if (modelHash !== storyHash) throw new Error('unknown model');
    return { model };
  }, queryNarrativeGraph: async () => view };
  const result = await readOpenQuestions(service, { modelHash: storyHash, graphHash: 'c'.repeat(64), limit: 20 });
  assert.equal(result.authorLives.length, 1);
  assert.equal(result.authorLives[0].available, false);
  assert.equal(result.authorLives[0].lifeModelHash, lifeHash);
  assert.ok(result.questions.some((item) => item.kind === 'author-life-unavailable' && item.question.includes(lifeHash)));
  assert.ok(!result.questions.some((item) => item.kind === 'author-life-unrecorded'));
  service.inspectModel = async ({ modelHash }) => ({ model: modelHash === storyHash ? model : { ...lived(), id: 'author-life' } });
  const restored = await readOpenQuestions(service, { modelHash: storyHash, graphHash: 'c'.repeat(64), limit: 20 });
  assert.equal(restored.authorLives[0].available, true);
  assert.equal(restored.authorLives[0].inspect.arguments.modelHash, lifeHash);
  assert.ok(!restored.questions.some((item) => item.kind === 'author-life-unavailable'));
});

test('a visible story without author life prompts investigation without imposing a persona on general documents', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const view = { graph: { source: { kind: 'model', model_hash: 'a'.repeat(64) } }, nodes: [{ id: 'book', role: 'document_root' }, { id: 'passage', role: 'story_passage' }],
    edges: [{ source: { kind: 'node', node_id: 'book' }, target: { kind: 'node', node_id: 'passage' }, family: 'structural', relation: 'contains' }] };
  const service = { inspectModel: async () => ({ model: lived() }), queryNarrativeGraph: async () => view };
  const result = await readOpenQuestions(service, { modelHash: 'a'.repeat(64), graphHash: 'c'.repeat(64), limit: 20 });
  const question = result.questions.find((item) => item.kind === 'author-life-unrecorded');
  assert.match(question.question, /complete authorized graph/);
  assert.match(question.question, /explicitly omitted author model or a bounded edit/);
  view.nodes[1].role = 'metadata';
  const general = await readOpenQuestions(service, { modelHash: 'a'.repeat(64), graphHash: 'c'.repeat(64), limit: 20 });
  assert.ok(!general.questions.some((item) => item.kind === 'author-life-unrecorded'));
});

test('author discovery checks each visible story root without treating metadata wrappers as stories', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const modelHash = 'a'.repeat(64);
  const contains = (from, to) => ({ source: { kind: 'node', node_id: from }, target: { kind: 'node', node_id: to }, family: 'structural', relation: 'contains' });
  const view = { graph: { source: { kind: 'model', model_hash: modelHash } }, nodes: [
    ...['collection', 'book.a', 'book.b', 'life.wrapper'].map((id) => ({ id, role: 'document_root' })),
    { id: 'a.passage', role: 'story_passage' }, { id: 'b.passage', role: 'story_passage' }, { id: 'life.metadata', role: 'metadata' },
    { id: 'author.a', node_type: 'storytelling.world', subject: 'book.a', text: JSON.stringify({ data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader',
      author: { personId: 'leo', name: 'Leo', lifeModelHash: modelHash } } }) },
  ], edges: [contains('collection', 'book.a'), contains('collection', 'book.b'), contains('book.a', 'a.passage'), contains('book.b', 'b.passage'), contains('life.wrapper', 'life.metadata')] };
  const service = { inspectModel: async () => ({ model: lived() }), queryNarrativeGraph: async () => view };
  const read = (extra = {}) => readOpenQuestions(service, { modelHash, graphHash: 'c'.repeat(64), limit: 100, ...extra });
  assert.deepEqual((await read()).questions.filter((item) => item.kind === 'author-life-unrecorded').map((item) => item.storyRootId), ['book.b']);
  assert.deepEqual((await read({ author: { id: 'leo', lifeModelHash: modelHash } })).questions.filter((item) => item.kind === 'author-life-unrecorded').map((item) => item.storyRootId), ['book.b'], 'one explicit author matching A does not cover B');
  view.nodes.push({ id: 'sufficient.a', node_type: 'understanding.note', text: JSON.stringify({ data: { schema: 'meaning-model-sufficient/v1', kind: 'author-life-unrecorded',
    reason: 'Author exploration for book A is outside this bounded edit.', reopenIf: 'We revise the authorial voice of A.' } }) });
  view.edges.push({ source: { kind: 'node', node_id: 'sufficient.a' }, target: { kind: 'node', node_id: 'book.a' }, relation: 'about', family: 'semantic' });
  assert.deepEqual((await read()).questions.filter((item) => item.kind === 'author-life-unrecorded').map((item) => item.storyRootId), ['book.b'], 'A sufficiency decision must not silence a different work');
  view.nodes = view.nodes.filter((node) => !['book.b', 'b.passage', 'author.a'].includes(node.id));
  assert.ok(!(await read({ author: { id: 'leo', lifeModelHash: modelHash } })).questions.some((item) => item.kind === 'author-life-unrecorded'), 'one actual story context can adopt the explicitly supplied author despite unrelated metadata roots');
});

test('autodiscovered author-story understanding questions count correctly and honor an explicit sufficient-here record', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const modelHash = 'a'.repeat(64);
  const view = { graph: { source: { kind: 'model', model_hash: modelHash } }, nodes: [{ id: 'book', role: 'document_root' }, { id: 'passage', role: 'story_passage' },
    { id: 'author.world', node_type: 'storytelling.world', subject: 'book', text: JSON.stringify({ data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader',
      author: { personId: 'leo', name: 'Leo', lifeModelHash: modelHash } } }) }],
    edges: [{ source: { kind: 'node', node_id: 'book' }, target: { kind: 'node', node_id: 'passage' }, family: 'structural', relation: 'contains' }] };
  const service = { inspectModel: async () => ({ model: lived() }), queryNarrativeGraph: async () => view };
  const before = await readOpenQuestions(service, { modelHash, graphHash: 'c'.repeat(64), limit: 100 });
  assert.equal(before.counts['understanding-unjoined'], 1);
  assert.equal(before.questions.find((item) => item.kind === 'understanding-unjoined').storyRootId, 'book');
  view.nodes.push({ id: 'sufficient', node_type: 'understanding.note', text: JSON.stringify({ data: { schema: 'meaning-model-sufficient/v1', kind: 'understanding-unjoined',
    reason: 'The relevant author influence is already sufficient for this local wording edit.', reopenIf: 'The narrative voice changes.' } }) });
  view.edges.push({ source: { kind: 'node', node_id: 'sufficient' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'leo' }, relation: 'about', family: 'grounding' });
  const after = await readOpenQuestions(service, { modelHash, graphHash: 'c'.repeat(64), limit: 100 });
  assert.ok(!after.questions.some((item) => item.kind === 'understanding-unjoined'));
  assert.equal(after.counts['understanding-unjoined'], undefined);
  assert.equal(after.total, before.total - 1);
});

test('a separately modeled author does not inherit a same-ID story character lifecycle', async () => {
  const { readOpenQuestions } = await import('../src/model-questions.mjs');
  const modelHash = 'a'.repeat(64), lifeModelHash = 'b'.repeat(64);
  const view = { graph: { source: { kind: 'model', model_hash: modelHash } }, nodes: [{ id: 'book', role: 'document_root' }, { id: 'passage', role: 'story_passage' },
    { id: 'author.world', node_type: 'storytelling.world', subject: 'book', text: JSON.stringify({ data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader',
      author: { personId: 'leo', name: 'An author with a coinciding local ID', lifeModelHash } } }) }],
    edges: [{ source: { kind: 'node', node_id: 'book' }, target: { kind: 'node', node_id: 'passage' }, family: 'structural', relation: 'contains' }] };
  const service = { inspectModel: async ({ modelHash: requested }) => ({ model: { ...lived(), id: requested === modelHash ? 'story-world' : 'separate-author-life' } }), queryNarrativeGraph: async () => view };
  const result = await readOpenQuestions(service, { modelHash, graphHash: 'c'.repeat(64), limit: 100 });
  assert.equal(result.authorLives[0].lifeModelHash, lifeModelHash);
  assert.ok(!result.questions.some((item) => item.kind === 'author-unlinked'), 'same-model shaping guidance must not conflate cross-model identities');
});

// Turing: to understand an adult mind, think about the process that brought it to its state: its initial state, its
// education and its other experience. The gap before a person's first period is that beginning.
test('the first gap in a life asks what formed the person: where they began, what they were taught, what else they lived through', () => {
  const model = lived();
  model.meaning_model.events.find((item) => item.id === 'event.life.leo.period.0').interval = { start: -20, end: 0 };
  const questions = modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], limit: 200 });
  const gaps = questions.questions.filter((item) => item.kind === 'period-gap');
  assert.ok(gaps.some((item) => /their beginning\. Where did their processes start, what were they taught, and what else did they live through\? Model what explains who they became, and leave unknown years unknown\./u.test(item.question)), JSON.stringify(gaps));
});

test('a model is asked to build structures on top of its processes and to open processes when readings outgrow them', () => {
  const flat = lived();
  flat.processes = Array.from({ length: 12 }, (_, i) => ({ id: `p.${i}` }));
  flat.dependencies = [];
  const asked = new Set(modelQuestions(flat, { people: [{ id: 'leo', name: 'Leo' }], limit: 200 }).questions.map((item) => item.kind));
  assert.ok(asked.has('structure-flat'), 'twelve unrelated processes are asked what drives what');
  flat.dependencies = [{ id: 'dep.1', from: 'p.0', to: 'p.1' }];
  assert.ok(!modelQuestions(flat, { people: [{ id: 'leo', name: 'Leo' }], limit: 200 }).questions.some((item) => item.kind === 'structure-flat'));

  const read = lived();
  read.processes = [{ id: 'p.only' }];
  for (let i = 0; i < 25; i += 1) read.meaning_model.normalized_cuts.push(cut(`lens.gift.${i}`, 'ev.late', 'What does this exchange read as?', 'reading allocation', { gift: 0.5, market: 0.4, remainder: 0.1 }));
  const reading = modelQuestions(read, { people: [{ id: 'leo', name: 'Leo' }], limit: 200 }).questions.find((item) => item.kind === 'readings-over-processes');
  assert.ok(reading, 'twenty-five readings over one process send the agent back to the processes');
  assert.match(reading.question, /Before reading more, open the processes behind the largest changes the readings show/);
});

test('abstract relations between concepts do not state the regularities laws ask for', () => {
  const model = lived();
  model.meaning_model.abstract_relations = [{ id: 'rel.1', kind: 'specialization', source: 'c.a', target: 'c.b' }];
  assert.ok(modelQuestions(model, { people: [{ id: 'leo', name: 'Leo' }], limit: 200 }).questions.some((item) => item.kind === 'laws-missing'));
});

test('the loop names the goal: structures built on structures, and the ones already built refined', () => {
  assert.match(thinkInTheModelInstructions, /building structures on top of structures, interpreting them and refining the ones you have/);
});

test('the state at a moment reads the values recorded for it: the one held then and the next', () => {
  const model = lived();
  model.processes = [...(model.processes ?? []), { id: 'leo.health', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 10 } },
    initial_value: { kind: 'scalar', value: 1 }, unit: 'on a scale of 0 to 10', scale: { semantic_role: 'Health', subject_referent_id: 'leo' } }];
  model.value_series = [{ id: 'values.leo.health~claude', process_id: 'leo.health', holder: 'claude',
    points: [{ time: 20, value: 2, tag: 'sketch' }, { time: 25, value: 8, lower: 7, upper: 9, tag: 'inferred' }] }];
  const at = (t) => personStateAt(model, 'leo', t).values.find((item) => item.processId === 'leo.health');
  assert.deepEqual(at(25).recorded, [{ holder: 'claude', held: { at: 25, value: 8, lower: 7, upper: 9, tag: 'inferred' }, next: null }]);
  const between = at(22).recorded[0];
  assert.deepEqual([between.held.value, between.next.value], [2, 8]);
  // Two recorded points bound nothing about the value between them; the lookup says the time is unrecorded.
  assert.equal(between.between, undefined);
  assert.match(between.atThisTime, /^not recorded: held and next are the recorded values around it/u);
  assert.equal(at(25).recorded[0].atThisTime, undefined, 'a recorded time says nothing more');
  assert.deepEqual([at(10).recorded[0].held, at(10).recorded[0].next.at], [null, 20], 'before the first value only the next is known');
});
