import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { modelJumps, modelQuestions, personStateAt, standingQuestions, thinkInTheModelInstructions } from '../src/model-questions.mjs';
import { withLives } from './storytelling-life-fixture.mjs';

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

test('the model asks its own questions: a shift with no cause, an undrawn decision, a moment without wants, a world no longer than a life', () => {
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

test('templates are suggestions: a life of the modeler\'s own processes is read as a life', () => {
  const model = { id: 'own', meaning_model: { referents: [{ id: 'ada', lifecycle_event_id: 'ev.ada.life' }],
    events: [event('ev.ada.life', 0, 36), event('ev.ada.mathematics', 0, 36), event('ev.ada.debts', 30, 36), event('ev.ada.youth', 0, 18), event('ev.ada.later', 18, 36)],
    event_relations: ['ev.ada.mathematics', 'ev.ada.youth', 'ev.ada.later'].map((target) => ({ id: `r.${target}`, kind: 'contains', source_event_id: 'ev.ada.life', target_event_id: target })) } };
  const questions = modelQuestions(model, { people: [{ id: 'ada', name: 'Ada' }], limit: 100 });
  assert.ok(!questions.questions.some((item) => item.kind === 'periods-missing'), 'her own periods count');
  const few = questions.questions.find((item) => item.kind === 'processes-few');
  assert.match(few.question, /suggests nine slow processes .* processes invented for Ada, or subcategories/);
  assert.match(questions.guidance, /none of its constructs is mandatory/);
  assert.match(thinkInTheModelInstructions, /the model is a language with no mandatory constructs/);
  assert.match(thinkInTheModelInstructions, /Go deep, and investigate every aspect/);
});

test('the jumps of the Book of Conditions are where its story is', async () => {
  const model = JSON.parse(await readFile(new URL('../../examples/book-of-conditions/rust-construction/model.json', import.meta.url), 'utf8'));
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
  assert.ok(questions.some((item) => /Can you understand Halden better by inventing processes or subcategories/u.test(item)));
  assert.ok(questions.some((item) => /List all the aspects .* then investigate each by modeling: create new processes/u.test(item)));
});
