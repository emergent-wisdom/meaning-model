// Which causes mattered most, and how much: the number test's cases (docs/NUMBER-TEST.md, "Causes"). Why farming
// began about 11,700 years ago rather than in the hundred thousand years before, read as a probability; why life
// expectancy rose from 32 to 73.5, read in years.
import test from 'node:test';
import assert from 'node:assert/strict';
import { causeChange, causeReport } from '../src/cause-record.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { LifeSimulationService } from '../src/service.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { modelQuestions } from '../src/model-questions.mjs';
import { seriesChange } from '../src/series-record.mjs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { proposeCutShares } from '../src/cut-shares.mjs';
import { exportConstructionHistory, importConstructionHistory } from '../src/construction-record.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';

const HASH = 'a'.repeat(64);
const unknown = { kind: 'unknown' };
const event = (id, start, end = start + 1, participants = {}) => ({ id, boundary: id.replace(/^event\./u, '').replaceAll('_', ' '), interval: { start, end }, process_ids: [],
  observation_process_ids: [], participants, substrate: null, region: null, provenance: ['sketch: fixture'] });
const base = () => ({
  schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year', revision: { number: 0, previous_model_hash: null, reason: 'r', provenance: ['p'] },
  processes: [{ id: 'h.alive', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 120 } }, initial_value: { kind: 'scalar', value: 30 }, unit: 'years of life expectancy',
    update_mode: 'observed', uncertainty: unknown, support: ['fixture'], provenance: ['fixture'], access_scopes: [] }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], abstract_relations: [], abstract_cuts: [], encapsulation_cuts: [], event_referent_bindings: [],
    physical_cuts: [], realizations: [], event_relations: [],
    referents: [{ id: 'referent.humanity', boundary: 'All living members of Homo sapiens', continuity_criterion: 'One continuing population', lifecycle_event_id: 'event.humanity',
      interval: null, authority: null, uncertainty: unknown, provenance: ['sketch: fixture'] }],
    events: [event('event.humanity', -300000, 2026, { subject: 'referent.humanity' }), event('event.farming', -9700, -9500), event('event.holocene', -9700, 2026),
      event('event.co2_rise', -18000, -9700), event('event.dense_populations', -12000, -9700), event('event.life_expectancy_rise', 1900, 2025),
      event('event.clean_water', 1850, 2025), event('event.vaccines', 1880, 2025), event('event.ice_age_ends', -12000, -9700)] },
});
const farming = (causes, extra = {}) => ({ outcomeEventId: 'event.farming', contrast: 'rather than in the hundred thousand years before', measure: 'probability', actual: 0.95, ...extra, causes });
const holocene = { eventId: 'event.holocene', role: 'enabling', without: 0.1, band: [0.02, 0.3], reason: 'Without a stable, warm climate, harvests fail too often for anyone to rely on sown fields.' };
const co2 = { eventId: 'event.co2_rise', role: 'enabling', without: 0.5, reason: 'At ice-age carbon dioxide, wild cereals yield too little to repay sowing.' };
const crowding = { eventId: 'event.dense_populations', without: 0.7, reason: 'Fewer people would have felt less pressure to grow food, and farmed later.' };
const record = (model, input) => {
  const { change, questionIds } = causeChange(model, { holder: 'modeler', tag: 'sketch', reason: 'first reading', ...input });
  return { model: applyModelChange(model, HASH, change).successor, questionIds };
};

test('a why-question reads the outcome without each cause, and ranks the causes by the difference each made', () => {
  let { model, questionIds } = record(base(), { questions: [farming([holocene, co2, crowding])] });
  const mm = model.meaning_model;
  assert.equal(mm.cause_questions.length, 1);
  assert.deepEqual(mm.cause_questions[0].measure, { kind: 'probability' });
  // The role decides the kind of a new link: what made it possible enables it.
  assert.deepEqual(mm.event_relations.map((relation) => [relation.source_event_id, relation.kind]).sort(),
    [['event.co2_rise', 'enables'], ['event.dense_populations', 'causes'], ['event.holocene', 'enables']]);
  assert.deepEqual(mm.cause_assessments.find((item) => item.relation_id === mm.event_relations[0].id).without_band, { lower: 0.02, upper: 0.3 });
  const [question] = causeReport(model, { questionIds }).questions;
  assert.deepEqual(question.ranked.map((cause) => [cause.rank, cause.cause, cause.difference]),
    [[1, 'event.holocene', 0.85], [2, 'event.co2_rise', 0.45], [3, 'event.dense_populations', 0.25]]);
  assert.equal(question.measure, 'probability');
  assert.equal(question.contrast, 'rather than in the hundred thousand years before');

  // Reading a cause again replaces its reading; another holder's account stands beside it.
  ({ model } = record(model, { questions: [farming([{ ...holocene, without: 0.2 }])] }));
  ({ model } = record(model, { holder: 'a farmer of the time', tag: 'invented', questions: [farming([{ eventId: 'event.dense_populations', without: 0.1, reason: 'We sowed because there were too many mouths.' }])] }));
  assert.equal(model.meaning_model.cause_questions.length, 2);
  assert.equal(model.meaning_model.cause_assessments.length, 4);
  const modeler = causeReport(model, { holder: 'modeler' }).questions[0];
  assert.deepEqual(modeler.ranked.map((cause) => [cause.cause, cause.difference]), [['event.holocene', 0.75], ['event.co2_rise', 0.45], ['event.dense_populations', 0.25]]);
  const farmer = causeReport(model, { holder: 'a farmer of the time' }).questions[0];
  assert.deepEqual(farmer.ranked.map((cause) => [cause.cause, cause.difference]), [['event.dense_populations', 0.85]]);
  assert.match(causeReport(model, { holder: 'a farmer of the time' }).next.join('\n'), /2 more cause\(s\) of event\.farming are linked but not read on this question/);
});

test('one influence is read once: no second link in the same direction, and no second reading through another link', () => {
  // The Twelve Words pass, 2026-10-11: an older enables link, a new causes link for the same pair, and both read.
  const older = { id: 'relation.older', source_event_id: 'event.holocene', target_event_id: 'event.farming', kind: 'enables', uncertainty: unknown, provenance: ['sketch: fixture'] };
  let model = base();
  model.meaning_model.event_relations.push(older);
  assert.throws(() => record(model, { questions: [farming([{ ...holocene, kind: 'causes', role: 'trigger' }])] }),
    /event\.holocene already links to event\.farming as enables \(relation\.older\)\. Weigh that relation: give relationId, or leave kind out\. To call it causes instead, change the relation's kind with life_model_revise first\./);
  ({ model } = record(model, { questions: [farming([{ ...holocene, role: 'trigger' }])] }));
  assert.deepEqual(model.meaning_model.cause_assessments.map((item) => item.relation_id), ['relation.older'], 'without a kind, the one link is weighed');
  // A link in the other direction is a different claim, but reading it on the same question would count the Event twice.
  const against = { id: 'relation.against', source_event_id: 'event.holocene', target_event_id: 'event.farming', kind: 'constrains', uncertainty: unknown, provenance: ['sketch: fixture'] };
  model = { ...model, meaning_model: { ...model.meaning_model, event_relations: [...model.meaning_model.event_relations, against] } };
  assert.throws(() => record(model, { questions: [farming([{ relationId: 'relation.against', without: 0.97, reason: 'A warmer climate also brought new pests.' }])] }),
    /event\.holocene is already read on this question through relation\.older; one influence is read once\. Read it again through that relation to replace the reading, or remove the other reading \(cause\.[0-9a-f]+\) with life_model_revise\./);
  // Without a kind, the role gives the direction, and the one link in that direction is weighed.
  ({ model } = record(model, { questions: [farming([{ ...holocene, role: 'trigger', without: 0.2 }])] }));
  assert.deepEqual(model.meaning_model.cause_assessments.map((item) => [item.relation_id, item.without]), [['relation.older', 0.2]]);

  // Readings an earlier version allowed show once, with the extra one named for removal, and the twin is not unread.
  let legacy = base();
  const twin = { id: 'relation.twin', source_event_id: 'event.holocene', target_event_id: 'event.farming', kind: 'causes', uncertainty: unknown, provenance: ['sketch: fixture'] };
  legacy.meaning_model.event_relations.push(older, twin);
  ({ model: legacy } = record(legacy, { questions: [farming([{ ...holocene, relationId: 'relation.older' }, crowding])] }));
  const questionId = legacy.meaning_model.cause_questions[0].id;
  const extra = { ...legacy.meaning_model.cause_assessments.find((item) => item.relation_id === 'relation.older'), id: 'cause.extra', relation_id: 'relation.twin', role: 'trigger' };
  legacy = { ...legacy, meaning_model: { ...legacy.meaning_model, cause_assessments: [extra, ...legacy.meaning_model.cause_assessments] } };
  const report = causeReport(legacy, { questionIds: [questionId] });
  assert.deepEqual(report.questions[0].ranked.map((cause) => [cause.cause, cause.relation, cause.alsoReadThrough ?? null]),
    [['event.holocene', 'relation.older', ['relation.twin']], ['event.dense_populations', report.questions[0].ranked[1].relation, null]]);
  assert.equal(report.questions[0].unread, undefined);
  assert.match(report.next.join('\n'), /event\.holocene is read 2 times on why\.[0-9a-f]+: cause\.extra through relation\.twin \(causes\), cause\.[0-9a-f]+ through relation\.older \(enables\)\. One influence counts once: keep the reading through the relation that states it, and remove the others with life_model_revise, remove: \{cause_assessments: \[\.\.\.\]\}\./);
  assert.doesNotMatch(report.next.join('\n'), /linked but not read/);
});

test('a different contrast is its own question, and an amount is read in the outcome\'s own unit', () => {
  let { model } = record(base(), { questions: [farming([holocene, co2])] });
  ({ model } = record(model, { questions: [farming([{ eventId: 'event.dense_populations', without: 0.5, reason: 'Where people were few, nobody needed to farm.' }],
    { contrast: 'in Mesopotamia rather than in Australia' })] }));
  assert.deepEqual(model.meaning_model.cause_questions.map((question) => question.contrast).sort(),
    ['in Mesopotamia rather than in Australia', 'rather than in the hundred thousand years before']);
  // Years of life expectancy gained: the difference is in years.
  const { model: years, questionIds } = record(model, { questions: [{ outcomeEventId: 'event.life_expectancy_rise', contrast: 'rather than staying near 32', measure: { unit: 'years of life expectancy gained', processId: 'h.alive' },
    actual: 41.5, causes: [
      { eventId: 'event.clean_water', without: 32.5, reason: 'Without clean water and sewers, waterborne childhood deaths stay high.' },
      { eventId: 'event.vaccines', without: 35.5, reason: 'Without vaccines, measles, diphtheria and smallpox keep killing children.' }] }] });
  const [rise] = causeReport(years, { questionIds }).questions;
  assert.equal(rise.measure, 'years of life expectancy gained');
  assert.deepEqual(rise.ranked.map((cause) => [cause.cause, cause.difference]), [['event.clean_water', 9], ['event.vaccines', 6]]);
  assert.deepEqual(years.meaning_model.cause_questions.find((question) => question.outcome_event_id === 'event.life_expectancy_rise').measure,
    { kind: 'amount', unit: 'years of life expectancy gained', process_id: 'h.alive' });
});

test('amount questions keep distinct processes with the same unit separate, including when read again', () => {
  const model = base();
  model.processes.push({ ...model.processes[0], id: 'h.healthy' });
  const question = (processId, actual, without) => ({ outcomeEventId: 'event.life_expectancy_rise', contrast: 'rather than staying near 32',
    measure: { unit: 'years', processId }, actual, causes: [{ eventId: 'event.clean_water', without, reason: 'Sanitation adds years.' }] });
  const first = record(model, { questions: [question('h.alive', 10, 2), question('h.healthy', 20, 5)] });
  assert.equal(new Set(first.questionIds).size, 2, 'the process is part of the measure, not just its unit');
  assert.deepEqual(first.model.meaning_model.cause_questions.map((item) => [item.measure.process_id, item.actual]).sort(),
    [['h.alive', 10], ['h.healthy', 20]]);
  const second = record(first.model, { questions: [question('h.alive', 12, 3)] });
  assert.equal(second.questionIds[0], first.questionIds[0]);
  const byQuestion = new Map(second.model.meaning_model.cause_assessments.map((item) => [item.question_id, item.without]));
  assert.equal(byQuestion.get(first.questionIds[0]), 3);
  assert.equal(byQuestion.get(first.questionIds[1]), 5, 'the other measure keeps its earlier reading');

  // Questions written before process ids entered the generated identity keep their existing ids on re-reading.
  const legacy = structuredClone(first.model);
  legacy.meaning_model.cause_questions[0].id = 'why.legacy';
  legacy.meaning_model.cause_assessments.find((item) => item.question_id === first.questionIds[0]).question_id = 'why.legacy';
  assert.deepEqual(record(legacy, { questions: [question('h.alive', 12, 3)] }).questionIds, ['why.legacy']);

  // A process-bound legacy question can own the id normally generated for the unbound unit. Add the latter without
  // overwriting or renaming it; an unbound measure otherwise retains the identifiers generated before this fix.
  const unboundQuestion = { ...question('h.alive', 30, 10), measure: { unit: 'years' } };
  const unboundId = record(model, { questions: [unboundQuestion] }).questionIds[0];
  const old = structuredClone(first.model);
  old.meaning_model.cause_questions[0].id = unboundId;
  old.meaning_model.cause_assessments.find((item) => item.question_id === first.questionIds[0]).question_id = unboundId;
  const withUnbound = record(old, { questions: [unboundQuestion] });
  assert.equal(withUnbound.model.meaning_model.cause_questions.length, 3);
  assert.notEqual(withUnbound.questionIds[0], unboundId);
  assert.equal(withUnbound.model.meaning_model.cause_questions.find((item) => item.measure.process_id === 'h.alive').id, unboundId);
  assert.deepEqual(record(withUnbound.model, { questions: [unboundQuestion] }).questionIds, withUnbound.questionIds);
  assert.equal(causeReport(first.model, { questionIds: [first.questionIds[0]] }).questions[0].processId, 'h.alive');
});

test('causes removed together cannot repeat an Event through twin relations', () => {
  const model = base();
  const link = (id, source, kind) => ({ id, source_event_id: source, target_event_id: 'event.farming', kind,
    uncertainty: unknown, provenance: ['sketch: fixture'] });
  model.meaning_model.event_relations.push(link('holocene.enables', 'event.holocene', 'enables'), link('holocene.causes', 'event.holocene', 'causes'),
    link('co2.enables', 'event.co2_rise', 'enables'), link('co2.causes', 'event.co2_rise', 'causes'));
  const cause = { relationId: 'holocene.enables', without: 0.1, reason: 'Climate and carbon dioxide together.' };
  assert.throws(() => record(model, { questions: [farming([{ ...cause, removedWith: ['holocene.causes'] }])] }),
    /cannot be removed together with itself, even through another relation/);
  assert.throws(() => record(model, { questions: [farming([{ ...cause, removedWith: ['co2.enables', 'co2.causes'] }])] }),
    /removedWith names cause event\.co2_rise twice/);
  const distinct = record(model, { questions: [farming([{ ...cause, removedWith: ['co2.enables'] }])] });
  assert.deepEqual(causeReport(distinct.model).questions[0].together[0].causes, ['event.holocene', 'event.co2_rise']);
});

test('the direction, the role, the band and the causes removed together are checked, and several sufficient causes are read together', () => {
  const call = (questions, model = base()) => causeChange(model, { holder: 'modeler', tag: 'sketch', reason: 'r', questions });
  assert.throws(() => call([farming([{ ...crowding, without: 0.99 }])]), /reads 0\.99, above the actual 0\.95\. A cause whose absence would make the outcome likelier or larger stands in its way: give it the kind prevents or constrains/);
  assert.throws(() => call([farming([{ ...crowding, kind: 'prevents', without: 0.5 }])]), /reads 0\.5, below the actual 0\.95/);
  assert.throws(() => call([farming([{ ...crowding, kind: 'causes', role: 'hindering' }])]), /the role hindering does not fit a causes relation/);
  assert.throws(() => call([farming([{ ...holocene, band: [0.2, 0.3] }])]), /the band 0\.2 to 0\.3 must hold the reading 0\.1/);
  assert.throws(() => call([farming([holocene], { actual: 1.2 })]), /the actual reading is a probability and lies between 0 and 1; got 1\.2/);
  assert.throws(() => call([{ outcomeEventId: 'event.life_expectancy_rise', contrast: 'c', measure: { unit: 'years' }, actual: -3, causes: [] }]), /cannot be negative; got -3/);
  assert.throws(() => call([farming([holocene], { outcomeEventId: 'event.none' })]), /event\.none is not an Event of the model/);
  assert.throws(() => call([{ outcomeEventId: 'event.farming', contrast: 'c', measure: { unit: 'years', processId: 'h.none' }, actual: 1, causes: [] }]), /h\.none is not a process of the model/);
  assert.throws(() => call([farming([{ ...holocene, removedWith: ['event.vaccines'] }])]), /removed together with event\.vaccines, which is not a cause of event\.farming of the same direction/);
  assert.throws(() => call([farming([{ ...holocene, removedWith: ['event.holocene'] }])]), /cannot be removed together with itself/);
  assert.throws(() => call([farming([holocene]), farming([co2])]), /asked twice on one measure in one call/);
  assert.throws(() => call([farming([holocene, { ...holocene, without: 0.2 }])]), /read twice in one question/);
  // A new actual reading must leave earlier readings on the right side of it.
  const { model } = record(base(), { questions: [farming([holocene, co2])] });
  assert.throws(() => call([farming([], { actual: 0.3 })], model), /leaves 1 earlier reading\(s\) of this question on the wrong side of it, first .* at 0\.5; read them again in this call/);

  // Two causes that would each have been enough alone: each makes almost no difference, so read them together.
  const overdetermined = record(base(), { questions: [farming([
    { eventId: 'event.holocene', role: 'enabling', without: 0.94, reason: 'The end of the ice age would have warmed the world anyway.' },
    { eventId: 'event.ice_age_ends', role: 'enabling', without: 0.94, reason: 'The Holocene would have come regardless.' }])] });
  assert.match(causeReport(overdetermined.model).next.join('\n'), /event\.holocene and event\.ice_age_ends each made almost no difference alone to event\.farming\. If each would have been enough without the other, read them removed together/);
  const together = record(overdetermined.model, { questions: [farming([{ eventId: 'event.holocene', role: 'enabling', without: 0.05, removedWith: ['event.ice_age_ends'],
    reason: 'Without both, the climate stays glacial.' }])] });
  const [question] = causeReport(together.model).questions;
  assert.deepEqual(question.together, [{ causes: ['event.holocene', 'event.ice_age_ends'], without: 0.05, difference: 0.9 }]);
  assert.equal(question.ranked.length, 2, 'the readings of each alone stand beside the reading of both');
  assert.doesNotMatch(causeReport(together.model).next.join('\n'), /read them removed together/);
});

test('causes go through the engine, which keeps one reading per cause and question', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  let hash = (await service.registerModel({ requestId: 'cause-model', model: base() })).modelHash;
  const plain = (await service.inspectModel({ modelHash: hash, includeDefinition: true })).model;
  assert.equal(plain.meaning_model.cause_questions, undefined, 'a model without causes stays as it was');
  const revise = async (requestId, input) => {
    const { model: previous } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
    const { change } = causeChange(previous, { holder: 'modeler', tag: 'sketch', reason: 'r', ...input });
    const { successor } = applyModelChange(previous, hash, change);
    hash = (await service.reviseModel({ requestId, previousModelHash: hash, model: successor })).modelHash;
  };
  await revise('cause-1', { questions: [farming([holocene, co2, crowding])] });
  await revise('cause-2', { questions: [farming([{ ...co2, without: 0.8 }])] });
  const { model: stored } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
  assert.equal(stored.meaning_model.cause_questions.length, 1);
  assert.deepEqual(stored.meaning_model.cause_assessments.map((item) => item.without).sort(), [0.1, 0.7, 0.8]);
  assert.deepEqual(causeReport(stored).questions[0].ranked.map((cause) => cause.cause), ['event.holocene', 'event.dense_populations', 'event.co2_rise']);
  // The engine refuses a second reading of one cause, however it arrives.
  const twice = structuredClone(stored);
  twice.revision = { number: stored.revision.number + 1, previous_model_hash: hash, reason: 'r', provenance: ['p'] };
  twice.meaning_model.cause_assessments.push({ ...twice.meaning_model.cause_assessments[0], id: 'cause.duplicate' });
  await assert.rejects(service.reviseModel({ requestId: 'cause-twice', previousModelHash: hash, model: twice }), /already reads the outcome without relation/);
  // A Cut answer names the record it stands for, and the engine keeps it.
  const shares = structuredClone(stored);
  shares.revision = { number: stored.revision.number + 1, previous_model_hash: hash, reason: 'r', provenance: ['p'] };
  shares.meaning_model.normalized_cuts = [{ id: 'cut.gain', parent_event_id: 'event.life_expectancy_rise', question: 'Of the 41.5 years gained, how many came from each cause of death avoided?',
    unit: 'the 41.5 years of life expectancy gained from 1900 to 2025', provenance: ['sketch: fixture'], answers: [
      { key: 'water', weight: 0.6, meaning: 'Waterborne deaths avoided', refers_to: { kind: 'event', event_id: 'event.clean_water' } },
      { key: 'vaccines', weight: 0.3, meaning: 'Deaths vaccines prevented', refers_to: { kind: 'event', event_id: 'event.vaccines' } },
      { key: 'remainder', weight: 0.1, meaning: 'Everything else' }] }];
  const sharesHash = (await service.reviseModel({ requestId: 'cause-shares', previousModelHash: hash, model: shares })).modelHash;
  const { model: withShares } = await service.inspectModel({ modelHash: sharesHash, includeDefinition: true });
  assert.deepEqual(withShares.meaning_model.normalized_cuts[0].answers.find((answer) => answer.key === 'water').refers_to, { kind: 'event', event_id: 'event.clean_water' });
});

test('a series answer names the record it stands for, and keeps it when the series is recorded again', () => {
  const series = { id: 'gain-by-cause', question: 'Of the years of life expectancy gained, how many came from each cause of death avoided?', unit: 'the years gained in the interval',
    answers: [{ key: 'water', meaning: 'Waterborne deaths avoided', refersTo: { kind: 'event', id: 'event.clean_water' } },
      { key: 'vaccines', meaning: 'Deaths vaccines prevented', refersTo: { kind: 'event', id: 'event.vaccines' } },
      { key: 'other', meaning: 'Every other cause of death' }] };
  const readings = [{ start: 1900, end: 1950, weights: { water: 0.5, vaccines: 0.2, other: 0.3 }, tag: 'sketch', why: 'Sanitation first, vaccines later.' }];
  const input = { subject: 'referent.humanity', series, readings, reason: 'Divide the gain by cause of death avoided.' };
  const model = base();
  const first = seriesChange(model, input);
  const answers = (change) => change.upsert.normalized_cuts[0].answers;
  assert.deepEqual(answers(first).find((answer) => answer.key === 'water').refers_to, { kind: 'event', event_id: 'event.clean_water' });
  assert.equal(answers(first).find((answer) => answer.key === 'other').refers_to, undefined);
  const again = seriesChange(applyModelChange(model, HASH, first).successor, input);
  assert.deepEqual(answers(again).find((answer) => answer.key === 'vaccines').refers_to, { kind: 'event', event_id: 'event.vaccines' });
  assert.throws(() => seriesChange(model, { ...input, series: { ...series, answers: [series.answers[0], { ...series.answers[1], refersTo: { kind: 'event', id: 'event.none' } }, series.answers[2]] } }),
    /refers to event event\.none, which the model does not hold/);
  assert.throws(() => seriesChange(model, { ...input, series: { ...series, answers: [series.answers[0], { ...series.answers[1], refersTo: { kind: 'event', id: 'event.clean_water' } }, series.answers[2]] } }),
    /Two answers refer to event event\.clean_water/);
});

test('the questions ask which cause mattered most, and the viewer carries the ranking', async () => {
  const linked = base();
  linked.meaning_model.event_relations = ['event.holocene', 'event.co2_rise'].map((source) => ({ id: `${source}.enables.farming`, source_event_id: source, target_event_id: 'event.farming',
    kind: 'enables', description: null, authority: null, uncertainty: unknown, provenance: ['sketch: fixture'] }));
  const asked = modelQuestions(linked, { limit: 200 }).questions.filter((question) => question.kind === 'causes-unweighed');
  assert.equal(asked.length, 1);
  assert.match(asked[0].question, /"farming" \(from -9700 to -9500\) has 2 causes linked to it, such as event\.holocene, event\.co2_rise, and nothing says which mattered most/);
  const { model } = record(linked, { questions: [farming([{ relationId: 'event.holocene.enables.farming', role: 'enabling', without: 0.1, reason: 'r' },
    { relationId: 'event.co2_rise.enables.farming', role: 'enabling', without: 0.5, reason: 'r' }])] });
  assert.equal(modelQuestions(model, { limit: 200 }).questions.filter((question) => question.kind === 'causes-unweighed').length, 0);
  // A series reading with causes is a reading of a stretch, not an outcome: it is not asked why.
  const reading = structuredClone(linked);
  reading.meaning_model.events.find((item) => item.id === 'event.farming').provenance.push('Meaning Model series reading v1');
  assert.equal(modelQuestions(reading, { limit: 200 }).questions.filter((question) => question.kind === 'causes-unweighed').length, 0);
  const data = await buildViewerData({ history: { models: [{ modelHash: HASH, definition: model }], revisions: [] } });
  assert.deepEqual(data.causes[0].ranked.map((cause) => [cause.cause, cause.difference]), [['event.holocene', 0.85], ['event.co2_rise', 0.45]]);
});

test('life_cause_record ranks the causes it records, through the MCP server', async (t) => {
  const client = new Client({ name: 'cause-record-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' }; delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const call = async (name, args) => client.callTool({ name, arguments: args });
  const ok = async (name, args) => { const result = await call(name, args); assert.ok(!result.isError, JSON.stringify(result.content)); return result.structuredContent; };
  const registered = await ok('life_model_register', { requestId: 'cause-base', model: base() });
  const recorded = await ok('life_cause_record', { requestId: 'cause-tool', previousModelHash: registered.modelHash, holder: 'modeler', tag: 'sketch',
    reason: 'Why farming began when it did, and why life expectancy rose.', questions: [farming([holocene, co2, crowding]),
      { outcomeEventId: 'event.life_expectancy_rise', contrast: 'rather than staying near 32', measure: { unit: 'years of life expectancy gained', processId: 'h.alive' }, actual: 41.5,
        causes: [{ eventId: 'event.clean_water', without: 32.5, reason: 'Waterborne deaths stay high.' }] }] });
  assert.deepEqual(recorded.causes.questions[0].ranked.map((cause) => [cause.cause, cause.difference]),
    [['event.holocene', 0.85], ['event.co2_rise', 0.45], ['event.dense_populations', 0.25]]);
  assert.equal(recorded.causes.questions[1].measure, 'years of life expectancy gained');
  const refused = await call('life_cause_record', { requestId: 'cause-refused', previousModelHash: recorded.modelHash, holder: 'modeler', tag: 'sketch', reason: 'r',
    questions: [farming([{ ...crowding, without: 0.99 }])] });
  assert.ok(refused.isError);
  assert.match(refused.content[0].text, /stands in its way: give it the kind prevents or constrains/);
  const both = await call('life_cause_record', { requestId: 'cause-both', previousModelHash: recorded.modelHash, holder: 'modeler', tag: 'sketch', reason: 'r',
    questions: [farming([{ ...crowding, relationId: 'x' }])] });
  assert.ok(both.isError, 'a cause is an Event or a relation, not both');
  const series = await ok('life_series_record', { requestId: 'cause-series', previousModelHash: recorded.modelHash, subject: 'referent.humanity', reason: 'r',
    series: { id: 'gain-by-cause', question: 'Of the years gained, how many came from each cause of death avoided?', unit: 'the years gained in the interval',
      answers: [{ key: 'water', meaning: 'Waterborne deaths avoided', refersTo: { kind: 'event', id: 'event.clean_water' } }, { key: 'other', meaning: 'Every other cause' }] },
    readings: [{ start: 1900, end: 1950, weights: { water: 0.6, other: 0.4 }, tag: 'sketch', why: 'Sanitation first.' }] });
  const stored = (await ok('life_model_inspect', { modelHash: series.modelHash, includeDefinition: true })).model.meaning_model;
  const cut = stored.normalized_cuts.find((item) => item.id.startsWith('cut.series.gain-by-cause.'));
  assert.deepEqual(cut.answers.find((answer) => answer.key === 'water').refers_to, { kind: 'event', event_id: 'event.clean_water' });
});

test('old duplicate readings are cleared with life_model_revise, and the cause tool then reads the survivor again', async (t) => {
  const client = new Client({ name: 'cause-duplicates-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' }; delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const call = async (name, args) => client.callTool({ name, arguments: args });
  const ok = async (name, args) => { const result = await call(name, args); assert.ok(!result.isError, JSON.stringify(result.content)); return result.structuredContent; };
  // What 7e4f6b7 allowed: one cause read on one question through two links.
  const legacy = base();
  legacy.meaning_model.event_relations.push(
    { id: 'relation.older', source_event_id: 'event.holocene', target_event_id: 'event.farming', kind: 'enables', uncertainty: unknown, provenance: ['sketch: fixture'] },
    { id: 'relation.twin', source_event_id: 'event.holocene', target_event_id: 'event.farming', kind: 'causes', uncertainty: unknown, provenance: ['sketch: fixture'] });
  const { change } = causeChange(legacy, { holder: 'modeler', tag: 'sketch', reason: 'first reading', questions: [farming([{ ...holocene, relationId: 'relation.older' }])] });
  const [reading] = change.upsert.cause_assessments;
  Object.assign(legacy.meaning_model, { cause_questions: change.upsert.cause_questions,
    cause_assessments: [reading, { ...reading, id: 'cause.extra', relation_id: 'relation.twin', role: 'trigger' }] });
  const registered = await ok('life_model_register', { requestId: 'legacy', model: legacy });
  const { eventId: _, ...climate } = holocene;
  const again = { requestId: 'reread', previousModelHash: registered.modelHash, holder: 'modeler', tag: 'sketch', reason: 'Read again.',
    questions: [farming([{ ...climate, relationId: 'relation.older', without: 0.15 }])] };
  const refused = await call('life_cause_record', again);
  assert.ok(refused.isError);
  assert.match(refused.content[0].text, /event\.holocene is already read twice on this question, through relation\.older \(cause\.[0-9a-f]+\) and relation\.twin \(cause\.extra\); one influence is read once\. Remove one of the readings with life_model_revise, remove: \{cause_assessments: \[\.\.\.\]\}, then read the other again\./);
  const cleared = await ok('life_model_revise', { requestId: 'clear', previousModelHash: registered.modelHash,
    change: { reason: 'One influence counts once.', remove: { cause_assessments: ['cause.extra'] } } });
  const reread = await ok('life_cause_record', { ...again, requestId: 'reread-2', previousModelHash: cleared.modelHash });
  const [question] = reread.causes.questions;
  assert.deepEqual(question.ranked.map((cause) => [cause.cause, cause.relation, cause.difference]), [['event.holocene', 'relation.older', 0.8]]);
  assert.equal(question.unread, undefined, 'the twin link stays a link, and its cause Event is read');
});

test('a re-estimate keeps what each answer names, and causes survive a history export and import', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cause-history-'));
  const services = [];
  t.after(async () => { await Promise.all(services.map((service) => service.close())); await rm(directory, { recursive: true, force: true }); });
  const start = async (name) => {
    const backend = new RustEngineProcess();
    backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, `${name}.sqlite`) };
    const service = new LifeSimulationService({ backend }); services.push(service); await service.initialize(); return service;
  };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, modelRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = await start('source');
  const base = await service.registerModel({ requestId: 'base', model: modelRequest.model });
  const answers = [{ key: 'loan', meaning: 'Attention to repaying the loan.' }, { key: 'bakery', meaning: 'Attention to the bakery.' }];
  const input = { question: 'How does her attention divide at hour six?', unit: 'one attention budget at hour six', answers, remainderMeaning: 'Anything else.',
    events: [{ eventId: 'event.ada.state.h06', cutId: 'cut.attention' }], distributions: [{ situationId: 'event.ada.state.h06', probabilities: { loan: 0.6, bakery: 0.3, remainder: 0.1 }, suppliedBy: 'fixture' }] };
  const first = await proposeCutShares({ ...input, modelHash: base.modelHash, apply: true, requestId: 'first' }, null, service);
  // The loan answer names the offer it is about.
  const named = structuredClone((await service.inspectModel({ modelHash: first.applied.modelHash, includeDefinition: true })).model);
  named.revision = { number: named.revision.number + 1, previous_model_hash: first.applied.modelHash, reason: 'name the record', provenance: ['fixture'] };
  named.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.attention').answers.find((answer) => answer.key === 'loan').refers_to = { kind: 'event', event_id: 'event.offer' };
  const namedHash = (await service.reviseModel({ requestId: 'named', previousModelHash: first.applied.modelHash, model: named })).modelHash;
  // A re-estimate keeps the record while the answer keeps its meaning.
  const second = await proposeCutShares({ ...input, distributions: [{ situationId: 'event.ada.state.h06', probabilities: { loan: 0.4, bakery: 0.5, remainder: 0.1 }, suppliedBy: 'fixture' }],
    modelHash: namedHash, replaceExisting: true, apply: true, requestId: 'second' }, null, service);
  const loanOf = (model) => model.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.attention').answers.find((answer) => answer.key === 'loan');
  const reestimated = (await service.inspectModel({ modelHash: second.applied.modelHash, includeDefinition: true })).model;
  assert.equal(loanOf(reestimated).weight, 0.4);
  assert.deepEqual(loanOf(reestimated).refers_to, { kind: 'event', event_id: 'event.offer' });
  // Causes of the state at hour six: the offer, an existing enables link, and the bakery, linked by the call.
  const { change } = causeChange(reestimated, { holder: 'modeler', tag: 'sketch', reason: 'r', questions: [{ outcomeEventId: 'event.ada.state.h06', contrast: 'rather than a calm morning',
    measure: 'probability', actual: 0.8, causes: [{ relationId: 'offer.enables.state', role: 'enabling', without: 0.3, reason: 'No offer, nothing to weigh.' },
      { eventId: 'event.bakery.life', without: 0.6, band: [0.4, 0.7], reason: 'Without the bakery the loan matters less.' }] }] });
  const caused = (await service.reviseModel({ requestId: 'causes', previousModelHash: second.applied.modelHash, model: applyModelChange(reestimated, second.applied.modelHash, change).successor })).modelHash;
  graphRequest.narrativeGraph.source.model_hash = caused;
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graphRequest.narrativeGraph });
  const exported = JSON.parse(JSON.stringify(await exportConstructionHistory(service, { graphHash: graph.graphHash })));
  const imported = await start('imported');
  await importConstructionHistory(imported, { requestId: 'import', history: exported });
  const back = (await imported.inspectModel({ modelHash: caused, includeDefinition: true })).model;
  assert.equal(back.meaning_model.cause_questions.length, 1);
  assert.deepEqual(back.meaning_model.cause_assessments.map((item) => [item.without, item.without_band ?? null]).sort(), [[0.3, null], [0.6, { lower: 0.4, upper: 0.7 }]]);
  assert.deepEqual(loanOf(back).refers_to, { kind: 'event', event_id: 'event.offer' });
  assert.deepEqual(causeReport(back).questions[0].ranked.map((cause) => [cause.cause, cause.difference]), [['event.offer', 0.5], ['event.bakery.life', 0.2]]);
});
