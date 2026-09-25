// What the novel run of 2026-09-24 showed the tool must do: questions of one kind must not hide the world's missing
// laws and places, a decision drawn in the story graph must not be asked about as undrawn, principals must choose, the
// estimator must read the model and say when its options or its laws are missing, and a world changed by later draws
// must be asked about again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { modelQuestions, unplacedEvents, indexModel, VISIBLE_QUESTIONS } from '../src/model-questions.mjs';
import { modeledStateText, proposeCutShares } from '../src/cut-shares.mjs';
import { drawnSinceQuestions, partsWithoutChoiceQuestion } from '../src/storytelling-world.mjs';
import { storyInterest } from '../src/storytelling-interest.mjs';
import { withLives } from './storytelling-life-fixture.mjs';

const cut = (id, parent, question, unit, answers) => ({ id, parent_event_id: parent, question, unit, answers: Object.entries(answers).map(([key, weight]) => ({ key, weight })), provenance: ['authored'] });
const event = (id, start, end, extra = {}) => ({ id, boundary: id, description: `What happens in ${id}.`, interval: { start, end }, ...extra });

function lived({ decisions = 1 } = {}) {
  const model = withLives({ id: 'm', meaning_model: {} }, ['leo']);
  const mm = model.meaning_model;
  mm.events.push(event('ev.early', -10, -9, { participants: { subject: 'leo' } }), event('ev.late', 10, 11, { participants: { subject: 'leo' } }));
  mm.normalized_cuts.push(
    cut('cut.early', 'ev.early', 'How is fulfillment anticipated?', 'represented fulfillment outlook', { assured: 0.8, threatened: 0.15, remainder: 0.05 }),
    cut('cut.late', 'ev.late', 'How is fulfillment anticipated?', 'represented fulfillment outlook', { assured: 0.2, threatened: 0.75, remainder: 0.05 }));
  for (let index = 0; index < decisions; index += 1) {
    mm.events.push(event(`ev.choice.${index}`, 20 + index, 21 + index, { participants: { subject: 'leo' } }));
    mm.normalized_cuts.push(cut(`cut.choice.${index}`, `ev.choice.${index}`, `Which continuation follows at moment ${index}?`, 'decision allocation', { stay: 0.45, leave: 0.4, remainder: 0.15 }));
  }
  for (let index = 0; index < 8; index += 1) mm.events.push(event(`ev.world.${index}`, index, index + 1));
  return model;
}
const leo = [{ id: 'leo', name: 'Leo', principal: true }];

test('nine undrawn decisions do not hide a world with no laws and no places', () => {
  const open = modelQuestions(lived({ decisions: 9 }), { people: leo, draws: [], limit: VISIBLE_QUESTIONS });
  const shown = open.questions.map((item) => item.kind);
  assert.equal(open.counts['decision-undrawn'], 9);
  assert.equal(shown.filter((kind) => kind === 'decision-undrawn').length, 1, 'one of a kind, while others wait');
  assert.ok(shown.includes('laws-missing') && shown.includes('place-missing'), `the world's questions are shown: ${shown.join(', ')}`);
  assert.equal(new Set(shown).size, shown.length, 'as many kinds as questions shown');
  assert.ok(open.questions.filter((item) => item.principal).length <= VISIBLE_QUESTIONS / 2, 'the principal takes at most half');
});

test('without the story graph, decisions are named together rather than each claimed undrawn', () => {
  const unknown = modelQuestions(lived({ decisions: 3 }), { people: leo, limit: 100 });
  const decisions = unknown.questions.filter((item) => item.kind === 'decision-undrawn');
  assert.equal(decisions.length, 1);
  assert.match(decisions[0].question, /The model holds 3 decision Cuts .* Which are drawn is recorded in the story graph, not the model/);
  const known = modelQuestions(lived({ decisions: 3 }), { people: leo, draws: [{ cutId: 'cut.choice.0', realized: 'stay' }], limit: 100 });
  assert.deepEqual(known.questions.filter((item) => item.kind === 'decision-undrawn').map((item) => item.cuts[0]), ['cut.choice.1', 'cut.choice.2']);
});

test('a principal who never chooses is asked what they choose', () => {
  const open = modelQuestions(lived({ decisions: 0 }), { people: leo, draws: [], limit: 100 });
  const question = open.questions.find((item) => item.kind === 'choices-missing');
  assert.match(question.question, /^Leo makes no choice the model decides\. What does Leo choose, when, between which options, and why/);
  assert.ok(!modelQuestions(lived({ decisions: 1 }), { people: leo, draws: [], limit: 100 }).questions.some((item) => item.kind === 'choices-missing'));
});

test('the estimator reads the model, and says when the options or the laws are missing', async () => {
  const model = lived({ decisions: 1 });
  const choice = model.meaning_model.events.find((item) => item.id === 'ev.choice.0');
  assert.match(modeledStateText(model, choice), /^What the model holds at this moment: Leo.*How is fulfillment anticipated\?: threatened 0\.75, assured 0\.20/);
  const seen = [];
  const estimator = { backend: 'typesafe', model: 'jev-test', label: 'typesafe:jev-test', async estimate(state) {
    seen.push(state);
    return { model: 'jev-test', usage: { input_tokens: 10, output_tokens: 1 }, answers: { shares: { type: 'choice', choice: 'stay', confidence: 0.5, probabilities: { stay: 0.35, leave: 0.2, remainder: 0.45 } } } };
  } };
  const service = { inspectModel: async () => ({ model }) };
  const result = await proposeCutShares({ question: 'What does Leo do?', unit: 'decision allocation', answers: [{ key: 'stay', meaning: 'He stays.' }, { key: 'leave', meaning: 'He leaves.' }],
    modelHash: 'a'.repeat(64), events: [{ eventId: 'ev.choice.0' }] }, estimator, service);
  assert.match(seen[0].modeledState, /Leo/);
  assert.ok(result.warnings.some((item) => /puts 0\.45 on none of your answers\. The options miss what this person would most plausibly do/.test(item)));
  assert.ok(result.warnings.some((item) => /The model holds no laws, claims or abstract relations/.test(item)));
});

test('a world changed by later draws is asked about again, and so is the director', () => {
  const nodes = [
    { node_type: 'storytelling.direction', text: JSON.stringify({ data: { stage: 'world' } }), value_time: 8 },
    ...[6, 9, 10].map((time) => ({ node_type: 'direction_draw', value_time: time })),
  ];
  const questions = drawnSinceQuestions({ nodes }, { authorReader: { node: { value_time: 5 } } });
  assert.deepEqual(questions.map((item) => item.kind), ['world-after-draws', 'direction-after-draws']);
  assert.match(questions[0].question, /^3 decisions were drawn after the author and the buttons were recorded/);
  assert.match(questions[1].question, /^2 decisions were drawn after the director last held the world/);
  assert.deepEqual(drawnSinceQuestions({ nodes: [] }, { authorReader: { node: { value_time: 5 } } }), []);
});

test('route parts without a choice, unplaced Events and the social life of a secret are asked about', () => {
  assert.match(partsWithoutChoiceQuestion(['part.01', 'part.02'], 12), /^2 of 12 parts hold no decision the model draws \(part\.01, part\.02\)/);
  const index = indexModel({ meaning_model: { events: [event('ev.town', 0, 10, { region: 'the town' }), event('ev.inside', 1, 2), event('ev.nowhere', 3, 4)],
    event_relations: [{ kind: 'contains', source_event_id: 'ev.town', target_event_id: 'ev.inside' }] } });
  assert.deepEqual(unplacedEvents(index, ['ev.town', 'ev.inside', 'ev.nowhere']).map((item) => item.id), ['ev.nowhere'], 'a place is inherited from an enclosing Event');
  assert.match(storyInterest.find((item) => item.id === 'secrets').investigate, /A secret has a social life: model a knowledge or belief process for everyone who could know or suspect it/);
});

test('a decision moment is its own time, not one unit of the model\'s clock', () => {
  const model = lived({ decisions: 1 });
  const questions = (m) => modelQuestions(m, { people: leo, draws: [], limit: 100 }).questions.filter((item) => item.kind === 'moment-unmodeled');
  assert.equal(questions(model).length, 1, 'the nearest motive Cut, a year and more away, does not model the moment');
  model.meaning_model.events.push(event('ev.choice.0.state', 20.2, 20.3, { participants: { subject: 'leo' } }));
  model.meaning_model.normalized_cuts.push(cut('cut.choice.0.wants', 'ev.choice.0.state', 'What does Leo want most here?', 'motivational attention over wants', { belonging: 0.6, competence: 0.3, remainder: 0.1 }));
  assert.equal(questions(model).length, 0, 'a motive Cut inside the decision Event does');
});

test('drawn remainders nobody opened, quantities nobody observes and lives with nothing inside are asked about', () => {
  const model = lived({ decisions: 2 });
  model.processes = [...(model.processes ?? []), { id: 'hand.function', initial_value: { kind: 'scalar', value: 0.45 } }];
  model.meaning_model.referents.push({ id: 'referent.gunnar', boundary: 'Gunnar, the relief skipper.', continuity_criterion: 'The same person.', lifecycle_event_id: 'ev.gunnar.life' });
  model.meaning_model.events.push(event('ev.gunnar.life', -40, 30));
  model.meaning_model.normalized_cuts.push({ ...cut('cut.choice.1.rem', 'ev.choice.1', 'Within the remainder, what follows?', 'decision allocation', { wait: 0.5, remainder: 0.5 }), conditioning: { cut_id: 'cut.choice.1', answer_key: 'remainder' } });
  const open = modelQuestions(model, { people: leo, draws: [{ cutId: 'cut.choice.0', realized: 'remainder' }, { cutId: 'cut.choice.1', realized: 'remainder' }], limit: 100 });
  assert.deepEqual(open.questions.filter((item) => item.kind === 'remainder-unopened').map((item) => item.cuts[0]), ['cut.choice.0'], 'an opened remainder is not asked about');
  assert.match(open.questions.find((item) => item.kind === 'process-unobserved').question, /hand\.function 0\.45/);
  assert.match(open.questions.find((item) => item.kind === 'life-thin').question, /^1 life is one Event with nothing inside \(Gunnar\)/);
});

test('the route is asked where its choices, its present shocks, its largest jumps and its open aspects are', async () => {
  const { routeQuestions } = await import('../src/storytelling-world.mjs');
  const model = lived({ decisions: 2 });
  model.meaning_model.normalized_cuts.push({ ...cut('cut.gone', 'ev.late', 'Which way does the old chain go?', 'decision allocation', { on: 0.5, off: 0.4, remainder: 0.1 }), withdrawn: { reason: 'The chain it rested on could not have happened.' } });
  const route = { parts: [{ id: 'part.1', eventIds: ['ev.late'] }, { id: 'part.2', eventIds: ['ev.choice.0'] }], whyNotJumps: null };
  const kinds = (items) => items.map((item) => item.kind);
  const questions = routeQuestions(model, route, { openAspects: [{ id: 'a.place' }] });
  assert.deepEqual(kinds(questions).filter((kind) => kind !== 'jumps-unrendered'), ['parts-without-choice', 'route-withdrawn', 'aspects-open'], 'Leo\'s shock at 13.3 lies inside this route\'s present');
  assert.match(questions[0].question, /^1 of 2 parts hold no decision the model draws \(part\.1\)/);
  assert.match(questions[1].question, /withdrawn \(cut\.gone: The chain it rested on could not have happened\.\)/);
  const later = routeQuestions(model, { parts: [{ id: 'part.1', eventIds: ['ev.choice.0'] }, { id: 'part.2', eventIds: ['ev.choice.1'] }], whyNotJumps: null });
  assert.match(later.find((item) => item.kind === 'story-shock-missing')?.question ?? '', /^Leo has no shock inside the story's time \(20 to 22\); the model's shocks for them are all earlier/);
  assert.ok(!later.some((item) => item.kind === 'parts-without-choice'), 'both parts hold a decision');
});
