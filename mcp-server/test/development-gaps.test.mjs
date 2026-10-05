import assert from 'node:assert/strict';
import test from 'node:test';

import { changeQuestions, developmentFromDossier, followedSubjects } from '../src/development-gaps.mjs';
import { modelQuestions } from '../src/model-questions.mjs';
import { lifeTrendsDossier, withLives } from './storytelling-life-fixture.mjs';

const base = () => ({ id: 'fixture-model', time_unit: 'year', processes: [], laws: [], initial_claims: [], meaning_model: { events: [], normalized_cuts: [] } });
// Two dated readings of one question about Leo: something about him followed over time.
const followLeo = (model) => {
  const mm = model.meaning_model;
  for (const [i, start] of [-30, -10].entries()) {
    mm.events.push({ id: `reading.${i}`, boundary: `Reading ${i}`, description: 'A stretch of his outlook.', interval: { start, end: start + 10 }, participants: { subject: 'Leo' } });
    mm.event_relations.push({ id: `rel.reading.${i}`, kind: 'contains', source_event_id: 'event.life.Leo', target_event_id: `reading.${i}` });
    mm.normalized_cuts.push({ id: `cut.reading.${i}`, parent_event_id: `reading.${i}`, question: 'How does his outlook divide between trust and caution?', unit: 'share of his outlook',
      answers: [{ key: 'trust', weight: 0.6 - i * 0.2 }, { key: 'caution', weight: 0.4 + i * 0.2 }, { key: 'remainder', weight: 0 }] });
  }
  return model;
};

test('a dossier character whose development the model does not follow gets a prepared series call', () => {
  const model = withLives(base(), ['Leo']);
  assert.equal(followedSubjects(model).has('Leo'), false);
  const [leo, ...rest] = developmentFromDossier(lifeTrendsDossier(), model);
  assert.equal(rest.length, 0);
  assert.equal(leo.characterId, 'Leo'); assert.deepEqual(leo.dimensions, ['Ways of exercising agency', 'Relationships and belonging']);
  assert.equal(leo.timeNote, undefined, 'years since birth are placed from the start of his life in the model');
  const { arguments: args, fill } = leo.call;
  assert.deepEqual(fill, ['requestId', 'previousModelHash', 'series.question', 'series.unit', 'series.answers', 'readings[].weights']);
  assert.match(leo.call.note, /previous write returned/u);
  assert.match(args.previousModelHash, /latest model write/u); assert.match(args.requestId, /new request id/u);
  assert.equal(args.subject, 'Leo');
  assert.deepEqual(args.readings.map(({ start, end }) => [start, end]), [[-40, -20], [-20, 0]], 'one reading per phase, on the model\'s clock');
  assert.match(args.readings[0].why, /^Origins: Relies on others to choose safe options\./u);
  assert.match(args.readings[1].why, /It changed because Work brings repeated chances to make consequential choices\./u);
  assert.ok(args.readings.every((reading) => reading.tag === 'invented'));
});

test('a character already followed over time is not asked again, and unplaceable phase times say so', () => {
  assert.equal(followedSubjects(followLeo(withLives(base(), ['Leo']))).has('Leo'), true);
  assert.deepEqual(developmentFromDossier(lifeTrendsDossier(), followLeo(withLives(base(), ['Leo']))), []);
  const [unplaced] = developmentFromDossier(lifeTrendsDossier(), base());
  assert.match(unplaced.timeNote, /counted from birth, and Leo has no dated life in the model/u);
  assert.deepEqual(unplaced.call.arguments.readings.map(({ start, end }) => [start, end]), [[null, null], [null, null]]);
  assert.ok(unplaced.call.fill.includes('readings[].start'), 'unplaced times are left for the agent');
});

test('a person with nothing followed over time is asked about it, with the questions about change', () => {
  const people = [{ id: 'Leo', name: 'Leo', principal: true }];
  const asked = modelQuestions(withLives(base(), ['Leo']), { people, limit: 200 }).questions.filter((item) => item.kind === 'development-missing');
  assert.equal(asked.length, 1);
  assert.match(asked[0].question, /Nothing about Leo is followed over time/u);
  assert.ok(asked[0].question.includes(changeQuestions));
  assert.match(changeQuestions, /anticipation is unknown, so never invent a probability/u);
  assert.match(changeQuestions, /over the relevant later timescales/u);
  const followed = modelQuestions(followLeo(withLives(base(), ['Leo'])), { people, limit: 200 }).questions.filter((item) => item.kind === 'development-missing');
  assert.equal(followed.length, 0, 'two dated readings of one question about him answer it');
});

test('someone the model gives a mind is asked about their development, though built without the person template', () => {
  const model = withLives(base(), ['Dale']);
  // No person template and no wants or feelings: only an inner perspective root inside Dale's life.
  model.meaning_model.events = model.meaning_model.events.filter((event) => !/\.is\./u.test(event.id));
  model.meaning_model.event_relations = model.meaning_model.event_relations.filter((relation) => !/\.is\./u.test(relation.target_event_id));
  model.meaning_model.events.push({ id: 'event.dale.inner', boundary: "Dale's inner perspective", interval: null, participants: {} });
  model.meaning_model.event_relations.push({ id: 'rel.dale.inner', kind: 'contains', source_event_id: 'event.life.Dale', target_event_id: 'event.dale.inner' });
  model.meaning_model.context_roots = [{ event_id: 'event.dale.inner', kind: 'inner' }];
  const asked = modelQuestions(model, { limit: 200 }).questions.filter((item) => item.kind === 'development-missing');
  assert.equal(asked.length, 1); assert.equal(asked[0].subject, 'Dale');
});

// Review cases (2026-10-05): what counts as followed, unit conversion, perspective, and the required call fields.
const reading = (model, id, eventId, start, { question = 'How does his outlook divide between trust and caution?', unit = 'share of his outlook', keys = ['trust', 'caution'], parent = 'event.life.Leo' } = {}) => {
  const mm = model.meaning_model;
  if (!mm.events.some((event) => event.id === eventId)) {
    mm.events.push({ id: eventId, boundary: eventId, interval: { start, end: start + 5 }, participants: { subject: 'Leo' } });
    mm.event_relations.push({ id: `rel.${eventId}`, kind: 'contains', source_event_id: parent, target_event_id: eventId });
  }
  mm.normalized_cuts.push({ id, parent_event_id: eventId, question, unit, answers: [...keys.map((key, i) => ({ key, weight: i ? 0.4 : 0.6 })), { key: 'remainder', weight: 0 }] });
  return model;
};

test('only comparable readings at distinct times, in one perspective, count as followed', () => {
  const sameEvent = reading(reading(withLives(base(), ['Leo']), 'c1', 'e1', -30), 'c2', 'e1', -30);
  assert.equal(followedSubjects(sameEvent).has('Leo'), false, 'two Cuts on one Event are not a development');
  const otherUnit = reading(reading(withLives(base(), ['Leo']), 'c1', 'e1', -30), 'c2', 'e2', -20, { unit: 'share of his week' });
  assert.equal(followedSubjects(otherUnit).has('Leo'), false, 'readings in different units are not one series');
  const otherAnswers = reading(reading(withLives(base(), ['Leo']), 'c1', 'e1', -30), 'c2', 'e2', -20, { keys: ['hope', 'dread'] });
  assert.equal(followedSubjects(otherAnswers).has('Leo'), false, 'readings with different answers are not one series');
  const split = withLives(base(), ['Leo']);
  split.meaning_model.events.push({ id: 'event.leo.inner', boundary: "Leo's inner perspective", interval: null, participants: {} });
  split.meaning_model.event_relations.push({ id: 'rel.leo.inner', kind: 'contains', source_event_id: 'event.life.Leo', target_event_id: 'event.leo.inner' });
  split.meaning_model.context_roots = [{ event_id: 'event.leo.inner', kind: 'inner' }, { event_id: 'event.life.Leo', kind: 'accepted_world' }];
  reading(reading(split, 'c1', 'e1', -30, { parent: 'event.leo.inner' }), 'c2', 'e2', -20);
  assert.equal(followedSubjects(split).has('Leo'), false, 'his own view and the world\'s account are separate series');
  assert.equal(followedSubjects(reading(reading(withLives(base(), ['Leo']), 'c1', 'e1', -30), 'c2', 'e2', -20)).has('Leo'), true);
});

test('dossier times are converted to the model\'s unit, or left unresolved', () => {
  const months = lifeTrendsDossier();
  Object.assign(months.characters[0], { lifeTimeUnit: 'months_since_birth', lifeBeginning: 0, storyEntry: 24 });
  months.characters[0].phases = months.characters[0].phases.map((phase, i) => ({ ...phase, at: i * 12 }));
  const born1980 = withLives(base(), ['Leo'], { start: 1980, end: 2060 });
  const [leo] = developmentFromDossier(months, born1980);
  assert.deepEqual(leo.call.arguments.readings.map(({ start, end }) => [start, end]), [[1980, 1981], [1981, 1982]], 'twelve months after a 1980 birth is 1981');
  const chapters = lifeTrendsDossier(); chapters.characters[0].lifeTimeUnit = 'chapters';
  const [unresolved] = developmentFromDossier(chapters, born1980);
  assert.match(unresolved.timeNote, /chapters, not the model's time unit \(year\)/u);
  assert.equal(unresolved.call.arguments.readings[0].start, null);
  assert.deepEqual(unresolved.call.arguments.readings[0].phase, { from: 0, to: 20, unit: 'chapters' });
  assert.ok(unresolved.call.fill.includes('readings[].end'));
});

test('someone with an inner perspective is offered both placements, and must choose one', () => {
  const model = withLives(base(), ['Leo']);
  model.meaning_model.events.push({ id: 'event.leo.inner', boundary: "Leo's inner perspective", interval: null, participants: { subject: 'Leo' } });
  model.meaning_model.event_relations.push({ id: 'rel.leo.inner', kind: 'contains', source_event_id: 'event.life.Leo', target_event_id: 'event.leo.inner' });
  model.meaning_model.context_roots = [{ event_id: 'event.leo.inner', kind: 'inner' }];
  const [leo] = developmentFromDossier(lifeTrendsDossier(), model);
  assert.deepEqual([leo.placement.inner, leo.placement.world], ['event.leo.inner', 'event.life.Leo']);
  assert.match(leo.placement.rule, /believes, feels or expects/u);
  assert.ok(leo.call.fill.includes('parentEventId'));
  assert.match(leo.call.arguments.parentEventId, /event\.leo\.inner or event\.life\.Leo/u);
});
