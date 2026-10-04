import assert from 'node:assert/strict';
import test from 'node:test';
import { modelQuestions } from '../src/model-questions.mjs';

const OUTLOOK = 'Across this stretch, how does Ada expect what she wants to turn out?';
const UNIT = 'share of one unit of represented outlook toward fulfilment of active wants';
const event = (id, start, end, description = `What happens in ${id}.`) => ({ id, boundary: id, description, interval: { start, end } });
const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
const cut = (id, parent, answers, question = OUTLOOK, unit = UNIT) => ({ id, parent_event_id: parent, question, unit, provenance: ['authored'],
  answers: Object.entries(answers).map(([key, weight]) => ({ key, weight })) });

// Ada lives 1900–1980 with a childhood period, a long adult period and three moments inside it; Bo's life stops when hers does.
function lives({ detail = { assurance: 0.1, threat: 0.9 }, detailInterval = [1930, 1950], extraCuts = [] } = {}) {
  return { id: 'two-lives', time_unit: 'year', meaning_model: {
    referents: [{ id: 'ada', boundary: 'Ada', lifecycle_event_id: 'life.ada' }, { id: 'bo', boundary: 'Bo', lifecycle_event_id: 'life.bo' }],
    events: [event('life.ada', 1900, 1980), event('ada.childhood', 1900, 1920, 'Raised by her aunt above the forge.'), event('ada.adult', 1920, 1980),
      event('ada.moves', 1925, 1926), event('ada.war', 1940, 1941), event('ada.loss', 1960, 1961), event('ada.detail', ...detailInterval), event('life.bo', 1910, 1980)],
    event_relations: [contains('life.ada', 'ada.childhood'), contains('life.ada', 'ada.adult'),
      ...['ada.moves', 'ada.war', 'ada.loss', 'ada.detail'].map((id) => contains('ada.adult', id))],
    normalized_cuts: [
      cut('cut.adult', 'ada.adult', { assurance: 0.7, threat: 0.3 }),
      cut('cut.detail', 'ada.detail', detail),
      cut('cut.health', 'ada.adult', { well: 0.8, ill: 0.2 }, 'How does her health divide across this stretch?', 'share of health'),
      cut('cut.moves.outlook', 'ada.moves', { assurance: 0.5, threat: 0.5 }, 'How does Ada expect things to turn out?'),
      ...extraCuts,
    ],
  } };
}
const ask = (model) => modelQuestions(model, { people: [{ id: 'ada', name: 'Ada', principal: true }, { id: 'bo', name: 'Bo', principal: false }], limit: 200 });
const of = (result, kind) => result.questions.filter((item) => item.kind === kind);

test('a life is asked about its unexplored childhood and youth, and about what became of it after the story', () => {
  const previous = process.env.MEANING_MODEL_ADDONS; process.env.MEANING_MODEL_ADDONS = 'storytelling';
  try {
    const result = ask(lives());
    const stages = of(result, 'stage-unexplored').filter((item) => item.subject === 'ada');
    assert.match(stages[0].question, /Nothing happens in Ada's childhood \(1900 to 1912\) beyond what frames it\. Who raised them/);
    assert.match(stages[1].question, /Ada's youth \(1912 to 1920\) beyond what frames it\. What did they want to become/);
    assert.match(stages[0].question, /If it does not matter to this work, record why/);
    assert.deepEqual(stages[0].at, [1900, 1912], 'a period that frames the stage is not something that happened in it');
    const after = of(result, 'life-after-story');
    assert.match(after.find((item) => item.subject === 'ada').question, /Ada's life is modeled only up to 1980, where other modeled lives stop too\. If this is a story, what became of them afterwards/);
    assert.ok(after.some((item) => [item.subject].flat().includes('bo')), 'a secondary life that stops with the story is asked too');
  } finally { if (previous === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = previous; }
});

test('finer readings inside a long reading imply what the rest of the stretch must average, and the tool asks whether it makes sense', () => {
  const result = ask(lives());
  const [average] = of(result, 'reading-average');
  assert.match(average.question, /If "Across this stretch, how does Ada expect what she wants to turn out\?" asks for the average over each stretch, the finer readings cover 33% of the one from 1920 to 1980\./);
  assert.match(average.question, /For it \(assurance 0\.70, threat 0\.30\) to hold, the rest of that stretch must average assurance 1\.00, threat 0\.00: a constraint on the average over those years, not their shape\. Does that make sense\?/);
  assert.deepEqual(average.cuts, ['cut.adult', 'cut.detail']);
  assert.deepEqual(average.at, [1920, 1980]);
});

test('detail that already takes more than the long reading allows cannot hold, and full coverage must match the average', () => {
  const infeasible = of(ask(lives({ detail: { assurance: 0, threat: 1 }, detailInterval: [1930, 1960] })), 'reading-average');
  assert.match(infeasible[0].question, /cannot hold as recorded: the finer readings inside it already take more threat than it allows/);
  assert.match(infeasible[0].question, /if these readings are not time-averages of one question, record that instead/);
  const covered = lives({ detail: { assurance: 0.9, threat: 0.1 }, detailInterval: [1920, 1950], extraCuts: [cut('cut.late', 'ada.late', { assurance: 0.9, threat: 0.1 })] });
  covered.meaning_model.events.push(event('ada.late', 1950, 1980)); covered.meaning_model.event_relations.push(contains('ada.adult', 'ada.late'));
  const [mismatch] = of(ask(covered), 'reading-average');
  assert.match(mismatch.question, /the readings inside the one from 1920 to 1980 average assurance 0\.90, threat 0\.10, but it says assurance 0\.70, threat 0\.30\. Does that make sense\?/);
  const agree = lives({ detail: { assurance: 0.7, threat: 0.3 }, detailInterval: [1920, 1950], extraCuts: [cut('cut.late', 'ada.late', { assurance: 0.7, threat: 0.3 })] });
  agree.meaning_model.events.push(event('ada.late', 1950, 1980)); agree.meaning_model.event_relations.push(contains('ada.adult', 'ada.late'));
  assert.equal(of(ask(agree), 'reading-average').length, 0, 'detail that averages to the long reading raises no question');
});

test('a long reading across Events with no reading after them, and a reworded question, are asked in any mode', () => {
  const previous = process.env.MEANING_MODEL_ADDONS; delete process.env.MEANING_MODEL_ADDONS;
  try {
    const result = ask(lives());
    assert.equal(of(result, 'stage-unexplored').length, 0, 'whole-life questions belong to the storytelling profile');
    const [stretch] = of(result, 'reading-stretch-unopened');
    assert.match(stretch.question, /"How does her health divide across this stretch\?" is read once from 1920 to 1980: one average for the whole stretch, though 4 Events happen inside it/);
    assert.match(stretch.question, /Open the stretch at those Events: what was it like after each\?/);
    assert.ok(!of(result, 'reading-stretch-unopened').some((item) => item.cuts.includes('cut.adult')), 'a stretch already opened by finer readings is not asked');
    const [reworded] = of(result, 'question-reworded');
    assert.match(reworded.question, /2 differently worded questions share the unit .* in Ada's life/);
    assert.match(reworded.question, /use one wording: a reworded question starts a separate series/);
  } finally { if (previous !== undefined) process.env.MEANING_MODEL_ADDONS = previous; }
});

test('readings from different perspectives are never checked against each other', () => {
  const model = lives({ detail: { assurance: 0.7, threat: 0.3 } });
  const mm = model.meaning_model;
  // Ada's own inner view of the same stretch, under her inner root: another account, not detail of the world's reading.
  mm.events.push(event('ada.inner', 1920, 1980), event('ada.inner.view', 1955, 1975));
  mm.event_relations.push(contains('life.ada', 'ada.inner'), contains('ada.inner', 'ada.inner.view'));
  mm.context_roots = [{ event_id: 'ada.inner', kind: 'inner' }];
  mm.normalized_cuts.push(cut('cut.inner.view', 'ada.inner.view', { assurance: 0, threat: 1 }));
  const result = ask(model);
  assert.ok(!of(result, 'reading-average').some((item) => item.cuts.includes('cut.inner.view')), 'an inner account is not detail of the world\'s reading');
  delete mm.context_roots;
  assert.ok(of(ask(model), 'reading-average').some((item) => item.cuts.includes('cut.inner.view')), 'the same reading in the world\'s own account would be checked');
  assert.ok(!of(result, 'question-reworded').some((item) => item.cuts.includes('cut.inner.view')));
});

test('a life that stops alone is not asked to continue, so the question does not follow an extended life forward', () => {
  const previous = process.env.MEANING_MODEL_ADDONS; process.env.MEANING_MODEL_ADDONS = 'storytelling';
  try {
    const model = lives();
    model.meaning_model.events.find((item) => item.id === 'life.ada').interval = { start: 1900, end: 2031 };
    model.meaning_model.events.find((item) => item.id === 'ada.adult').interval = { start: 1920, end: 2031 };
    assert.equal(of(ask(model), 'life-after-story').length, 0, 'once Ada is followed past the shared cut-off, neither life shares an end');
  } finally { if (previous === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = previous; }
});
