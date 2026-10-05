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
  assert.deepEqual(fill, ['series.question', 'series.unit', 'series.answers', 'readings[].weights']);
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
  assert.match(unplaced.timeNote, /years_since_birth.*no dated life in the model/u);
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
