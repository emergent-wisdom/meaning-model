// Story coverage checks each person's slow processes, individual process and Cut families.
// Institutions and objects are not held to the person requirements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageReport, timeSchedule } from '../src/coverage.mjs';
import { indexModel, SLOW_PROCESSES } from '../src/model-questions.mjs';
import { cutFamily, peopleCheck, personGapText } from '../src/people-check.mjs';

const event = (id, start, end = start + 1) => ({ id, boundary: id, interval: { start, end }, process_ids: [], observation_process_ids: [], participants: {}, substrate: null, region: null, provenance: ['x'] });
const scalar = (id, subject) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 10 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'u',
  update_mode: 'observed', uncertainty: { kind: 'unknown' }, support: ['s'], provenance: ['sketch: fixture'], access_scopes: [], scale: { label: id, subject_referent_id: subject } });
const values = (processId, times) => ({ id: `values.${processId}`, process_id: processId, holder: 'm', points: times.map((time) => ({ time, value: 5, tag: 'sketch' })) });
const contains = (id, source, target) => ({ id, kind: 'contains', source_event_id: source, target_event_id: target, provenance: ['x'] });
const cut = (id, parent, unit, question) => ({ id, parent_event_id: parent, question, unit, answers: [{ key: 'a', weight: 0.6 }, { key: 'b', weight: 0.4 }], provenance: ['authored'] });
const model = () => ({ schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year', revision: { number: 0, previous_model_hash: null, reason: 'r', provenance: ['p'] },
  processes: [], decomposition: [], dependencies: [], laws: [], initial_claims: [], value_series: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], events: [event('world', 1800, 1900), event('ada.life', 1815, 1852), event('guardian.life', 1821, 1900)],
    referents: [
      { id: 'ada', lifecycle_event_id: 'ada.life', continuity_criterion: 'one continuous human life', boundary: 'Ada Lovelace, mathematician', provenance: ['x'] },
      { id: 'guardian', lifecycle_event_id: 'guardian.life', continuity_criterion: 'same chartered company', boundary: 'The Guardian Assurance Company', provenance: ['x'] }],
    event_relations: [], normalized_cuts: [] } });
// The coverage report keeps its tracks internal, so the test builds the same ones the report judges: values by subject.
function tracksFor(m) {
  const byId = new Map(m.processes.map((p) => [p.id, p]));
  return m.value_series.map((series) => ({ kind: 'values', id: series.process_id, subject: byId.get(series.process_id)?.scale?.subject_referent_id ?? null,
    times: [...new Set(series.points.map((point) => point.time))] }));
}
function complete(m) {
  for (const key of SLOW_PROCESSES) { m.processes.push(scalar(`ada.${key}`, 'ada')); m.value_series.push(values(`ada.${key}`, [1815, 1852])); }
  m.processes.push(scalar('ada.betting_debt', 'ada')); m.value_series.push(values('ada.betting_debt', [1849, 1852]));
  for (const [period, start, end] of [['early', 1815, 1843], ['late', 1843, 1852]]) {
    const parent = `ada.${period}`;
    m.meaning_model.events.push(event(parent, start, end));
    m.meaning_model.event_relations.push(contains(`c.${parent}`, 'ada.life', parent));
    m.meaning_model.normalized_cuts.push(
      cut(`ada.wants.${period}`, parent, 'one unit of Ada\'s motivational attention', 'What does Ada want?'),
      cut(`ada.outlook.${period}`, parent, 'represented fulfillment outlook', 'How does Ada see her wants\' fulfilment?'),
      cut(`ada.threat.${period}`, parent, 'share of what is seen as threatened', 'What does Ada see as threatened?'),
      cut(`ada.feels.${period}`, parent, 'emotional attention', 'What does Ada feel?'));
  }
  return m;
}

test('a person with only a life is named with everything a life lacks, and an institution is not a person', () => {
  const result = peopleCheck(model(), indexModel(model()), []);
  assert.equal(result.people, 1, 'Ada is a person; the Guardian is a company');
  const [ada] = result.incomplete;
  assert.deepEqual(ada.missingSlow, SLOW_PROCESSES);
  assert.equal(ada.ownProcesses, 0);
  assert.deepEqual(ada.missingFamilies.sort(), ['feelings', 'outlook', 'threat', 'wants']);
  assert.match(personGapText(ada), /^Ada Lovelace: no body, kin, partnership, work, place, means, knowledge, standing, meaning; no process of their own; no Cuts for/u);
});

test('a person with the nine slow processes over time, one of their own and the four kinds of Cut is complete', () => {
  const m = complete(model());
  const result = peopleCheck(m, indexModel(m), tracksFor(m));
  assert.equal(result.incomplete.length, 0, JSON.stringify(result.incomplete));
});

test('a slow process with one value is not yet followed over time, and a missing kind of Cut is named', () => {
  const m = complete(model());
  m.value_series.find((series) => series.process_id === 'ada.kin').points.splice(1);
  m.meaning_model.normalized_cuts = m.meaning_model.normalized_cuts.filter((c) => !c.id.startsWith('ada.feels.'));
  const [ada] = peopleCheck(m, indexModel(m), tracksFor(m)).incomplete;
  assert.deepEqual(ada.unvaluedSlow, ['kin']);
  assert.deepEqual(ada.missingFamilies, ['feelings']);
});

test('a threatened-fulfilment reading is what is threatened, not the outlook', () => {
  assert.equal(cutFamily({ unit: 'threatened fulfillment', question: 'Which wanted region is at risk, conditional on represented threat?' }), 'threat');
  assert.equal(cutFamily({ unit: 'represented fulfillment outlook', question: 'How is fulfillment anticipated?' }), 'outlook');
  assert.equal(cutFamily({ unit: 'motivational attention', question: 'Which wanted region receives motivational attention?' }), 'wants');
  assert.equal(cutFamily({ unit: 'emotional attention', question: 'Which emotional appraisals occupy this moment?' }), 'feelings');
});

test('in a story the pass is not done while a person lacks the least a life needs, and other modes are not held to it', () => {
  const before = process.env.MEANING_MODEL_ADDONS;
  try {
    const m = model();
    m.processes.push(scalar('world.population', null)); m.value_series.push(values('world.population', [1800, 1900]));
    process.env.MEANING_MODEL_ADDONS = 'storytelling';
    const story = coverageReport(m);
    assert.equal(story.done, false);
    assert.equal(story.people.incomplete, 1);
    assert.match(story.status, /1 of 1 people lack the least a life needs/u);
    assert.match(story.next[1], /^Every person in the story needs at least what the process breakdown/u);
    delete process.env.MEANING_MODEL_ADDONS;
    const general = coverageReport(m);
    assert.equal(general.people, undefined);
    assert.doesNotMatch(general.status, /people lack/u);
  } finally {
    if (before === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = before;
  }
});

test('an outlook phrased as assured or at risk is an outlook, and only a division of what is at stake is a threat reading', () => {
  assert.equal(cutFamily({ unit: 'one unit of Whitworth\'s outlook on his wants', question: 'How does he anticipate the fulfilment of his wants: assured or at risk?',
    answers: [{ key: 'assured' }, { key: 'at_risk' }] }), 'outlook');
  assert.equal(cutFamily({ unit: 'the threatened share of Ada\'s outlook', question: 'Within her sense that her wants are threatened, what does she see as at stake?',
    answers: [{ key: 'body_health' }, { key: 'home_safety' }, { key: 'work_livelihood' }] }), 'threat');
  assert.equal(cutFamily({ unit: 'represented fulfillment outlook', question: 'How is fulfillment anticipated?', answers: [{ key: 'assured_fulfillment' }, { key: 'threatened_fulfillment' }, { key: 'remainder' }] }), 'outlook');
});

test('one moment or two isolated moments of a Cut family cannot report a person followed through life', () => {
  const before = process.env.MEANING_MODEL_ADDONS;
  try {
    process.env.MEANING_MODEL_ADDONS = 'storytelling';
    for (const sparse of [false, true]) {
      const m = complete(model());
      // Every numeric track fills its schedule, so only the Cut development can prevent a false done.
      const times = timeSchedule(1800, 1900).levels.at(-1).boundaries;
      for (const series of m.value_series) series.points = [1815, ...times.filter((t) => t > 1815 && t < 1852), 1840, 1845, 1852]
        .map((time) => ({ time, value: 5, tag: 'sketch' }));
      m.meaning_model.events.find((e) => e.id === 'ada.early').interval = { start: 1840, end: 1841 };
      m.meaning_model.events.find((e) => e.id === 'ada.late').interval = { start: sparse ? 1845 : 1840, end: sparse ? 1846 : 1841 };
      if (!sparse) m.meaning_model.normalized_cuts = m.meaning_model.normalized_cuts.filter((c) => c.parent_event_id === 'ada.early');
      const report = coverageReport(m);
      assert.equal(report.schedule.remaining, 0);
      assert.equal(report.done, false);
      assert.deepEqual(report.people.gaps[0].unfollowedFamilies.sort(), ['feelings', 'outlook', 'threat', 'wants']);
      assert.match(report.next.join('\n'), /no comparable readings across the life/u);
    }
  } finally {
    if (before === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = before;
  }
});

test('people gaps are returned before any value track exists, and undated life spans stay unresolved', () => {
  const before = process.env.MEANING_MODEL_ADDONS;
  try {
    process.env.MEANING_MODEL_ADDONS = 'storytelling';
    const report = coverageReport(model());
    assert.equal(report.tracks, 0);
    assert.equal(report.people.incomplete, 1);
    assert.match(report.next.join('\n'), /Ada Lovelace: no body/u);
    const m = complete(model());
    m.meaning_model.events.find((e) => e.id === 'ada.life').interval = null;
    const [ada] = peopleCheck(m, indexModel(m), tracksFor(m)).incomplete;
    assert.equal(ada.lifeSpanUnresolved, true);
    assert.match(personGapText(ada), /life span undated or unresolved/u);
  } finally {
    if (before === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = before;
  }
});

test('comparable inner-perspective series count, including conditioned threat readings', () => {
  const m = complete(model());
  m.meaning_model.events.push(event('ada.inner', 1815, 1852));
  m.meaning_model.context_roots = [{ event_id: 'ada.inner', kind: 'inner' }];
  for (const relation of m.meaning_model.event_relations) relation.source_event_id = 'ada.inner';
  for (const e of m.meaning_model.events.filter((e) => ['ada.early', 'ada.late'].includes(e.id))) e.participants.subject = 'ada';
  for (const period of ['early', 'late']) {
    m.meaning_model.normalized_cuts.find((c) => c.id === `ada.threat.${period}`).conditioning = {
      cut_id: `ada.outlook.${period}`, answer_key: 'b' };
  }
  assert.deepEqual(peopleCheck(m, indexModel(m), tracksFor(m)).incomplete, []);
});

test('different perspectives or incompatible answers cannot be pooled to fill one family across a life', () => {
  for (const differentPerspective of [false, true]) {
    const m = complete(model());
    if (differentPerspective) {
      m.meaning_model.events.push(event('ada.other_view', 1815, 1852));
      m.meaning_model.context_roots = [{ event_id: 'ada.other_view', kind: 'inner' }];
      m.meaning_model.event_relations.find((r) => r.target_event_id === 'ada.late').source_event_id = 'ada.other_view';
      m.meaning_model.events.find((e) => e.id === 'ada.late').participants.subject = 'ada';
    } else {
      m.meaning_model.normalized_cuts.find((c) => c.id === 'ada.wants.late').answers[0].key = 'different';
    }
    const [ada] = peopleCheck(m, indexModel(m), tracksFor(m)).incomplete;
    assert.ok(ada.unfollowedFamilies.includes('wants'));
  }
});

test('one opened slow-process child or one Cut is not temporal development; dated finer Events are', () => {
  const m = complete(model());
  m.value_series = m.value_series.filter((series) => series.process_id !== 'ada.body');
  m.meaning_model.events.push(event('ada.is.body', 1815, 1852));
  m.meaning_model.event_relations.push(contains('body.life', 'ada.life', 'ada.is.body'));
  m.meaning_model.normalized_cuts.push(cut('body.assessment', 'ada.is.body', 'body state', 'How is her health?'));
  assert.deepEqual(peopleCheck(m, indexModel(m), tracksFor(m)).incomplete[0].unvaluedSlow, ['body']);
  m.meaning_model.events.push(event('body.child', 1820, 1821));
  m.meaning_model.event_relations.push(contains('body.one', 'ada.is.body', 'body.child'));
  assert.deepEqual(peopleCheck(m, indexModel(m), tracksFor(m)).incomplete[0].unvaluedSlow, ['body']);
  // A second record at the same start does not add a time.
  m.meaning_model.events.push(event('body.same_time', 1820, 1821));
  m.meaning_model.event_relations.push(contains('body.same', 'ada.is.body', 'body.same_time'));
  assert.deepEqual(peopleCheck(m, indexModel(m), tracksFor(m)).incomplete[0].unvaluedSlow, ['body']);
  m.meaning_model.events.find((e) => e.id === 'body.same_time').interval = { start: 1840, end: 1841 };
  assert.equal(peopleCheck(m, indexModel(m), tracksFor(m)).incomplete.length, 0);
});
