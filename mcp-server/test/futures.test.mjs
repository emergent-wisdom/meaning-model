import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { BRANCH_MARK, PREMISE_MARK, compareFutures, forkStage, listFutures, loadFuture } from '../src/futures.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { newestWrittenDescendant } from '../src/viewer-live.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';
import { recordUnderstanding } from '../src/construction-record.mjs';
import { buildModelingContext } from '../src/modeling-guidance.mjs';
import { availableAddons } from '../src/addon-config.mjs';
import { FORECAST_METADATA_MARK, declaredForecast } from '../src/forecast-metadata.mjs';
import { seriesChange, seriesDrawing } from '../src/series-record.mjs';
import { valuesChange } from '../src/values-record.mjs';

const prov = ['futures-test'];
const meta = { authority: null, uncertainty: { kind: 'unknown' }, provenance: prov };
const event = (id, boundary, interval, participants = {}, extra = {}) => ({ id, boundary, interval, participants,
  process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: prov, ...extra });
const contains = (source, target) => ({ id: `${source}.contains.${target}`, kind: 'contains', source_event_id: source, target_event_id: target, description: 'Containment.', ...meta });
const process_ = (id, role, subject = null, initial = 50) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1000 } },
  initial_value: { kind: 'scalar', value: initial }, unit: 'level', update_mode: 'observed', reference_frame: 'town',
  scale: { semantic_role: role, ...(subject ? { subject_referent_id: subject } : {}) }, support: [`authored:${id}`], uncertainty: { kind: 'unknown' }, axes: [], access_scopes: [], provenance: prov });
const declared = (cutoff, horizon) => [...prov, 'forecast: probabilities declared before the outcome', `evidence cutoff: ${cutoff}`, `horizon: ${horizon}`, 'settled by: the town register'];

// A town from 1950 to 2025. An outbreak in 2010 followed a drought, which the model weighs; the modeler forecasts, at
// 2025, whether another large outbreak starts by 2030, and how fast the town would recover.
function registerRequest() {
  return { requestId: 'futures-town', model: {
    schema: 'life-sim-rust-model/v1', id: 'town', time_unit: 'year',
    revision: { number: 0, previous_model_hash: null, provenance: prov, reason: 'Futures fixture.' },
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    processes: [process_('town.pop', 'how many people live in the town', null, 500), process_('ana.mood', 'how well Ana is', 'referent.ana', 60)],
    value_series: [{ id: 'values.town.pop~modeler', process_id: 'town.pop', holder: 'modeler',
      points: [{ time: 2000, value: 480, tag: 'sketch' }, { time: 2010, value: 420, tag: 'sketch' }, { time: 2024, value: 510, tag: 'sketch' }] }],
    meaning_model: {
      schema: 'life-sim-rust-meaning-model/v1',
      referents: [{ id: 'referent.ana', boundary: 'Ana, the town doctor', continuity_criterion: 'Same person', lifecycle_event_id: 'ana.life', interval: null, ...meta },
        { id: 'referent.ben', boundary: 'Ben, the mayor', continuity_criterion: 'Same person', lifecycle_event_id: 'ben.life', interval: null, ...meta }],
      events: [
        event('world', 'The accepted world of the town.', { start: 1950, end: 2025 }),
        event('ana.life', 'Ana\'s life', null, { subject: 'referent.ana' }),
        event('ben.life', 'Ben\'s life, modeled to 2025', { start: 1970, end: 2025 }, { subject: 'referent.ben' }),
        event('ana.choice.2012', 'Ana is offered a post in the city', { start: 2012, end: 2012.1 }, { subject: 'referent.ana' }),
        event('ana.stays.2012', 'Ana stays in the town', { start: 2012.1, end: 2012.2 }, { subject: 'referent.ana' }),
        event('drought.2009', 'The drought of 2009', { start: 2009, end: 2009.5 }, {}, { process_ids: ['town.pop'] }),
        event('outbreak.2010', 'The 2010 outbreak', { start: 2010, end: 2010.5 }, {}, { process_ids: ['town.pop'], description: 'About 120 people died.' }),
        event('fair.2015', 'The 2015 fair', { start: 2015, end: 2015.1 }, {}, { process_ids: ['town.pop'] }),
        event('growth', 'The town grows, 1950 to 2024', { start: 1950, end: 2024 }, {}, { process_ids: ['town.pop'] }),
        event('modeler', 'The modeler\'s understanding root: forecasts the modeler holds.', null),
        event('forecast.outbreak', 'The modeler\'s forecast, issued at 2025, of an outbreak by 2030.', { start: 2025, end: 2025.01 }),
        event('forecast.recovery', 'The modeler\'s forecast, issued at 2025, of how fast the town recovers from a shock.', { start: 2025, end: 2025.01 }),
        event('reading.shares', 'The modeler\'s reading of what the town talks about.', { start: 2025, end: 2025.01 }),
      ],
      event_referent_bindings: ['ana', 'ben'].map((name) => ({ id: `binding.${name}.life`, binding_type: 'lifecycle_subject', role: 'subject', referent_id: `referent.${name}`,
        target: { kind: 'event', event_id: `${name}.life` }, interval: null, ...meta })),
      event_relations: [contains('world', 'ana.life'), contains('world', 'drought.2009'), contains('world', 'outbreak.2010'), contains('world', 'fair.2015'), contains('world', 'growth'), contains('world', 'ben.life'), contains('ana.life', 'ana.choice.2012'), contains('ana.life', 'ana.stays.2012'),
        { id: 'ana.choice.realized', kind: 'realizes_forecast', source_event_id: 'ana.choice.2012', target_event_id: 'ana.stays.2012', forecast_answer: { cut_id: 'cut.ana.2012', answer_key: 'stay' }, description: 'She stays.', ...meta },
        { id: 'forecast.outbreak.about.2010', kind: 'about', source_event_id: 'forecast.outbreak', target_event_id: 'outbreak.2010', description: 'The forecast concerns an outbreak like 2010\'s.', ...meta },
        contains('modeler', 'forecast.outbreak'), contains('modeler', 'forecast.recovery'), contains('modeler', 'reading.shares'),
        { id: 'drought.causes.outbreak', kind: 'causes', source_event_id: 'drought.2009', target_event_id: 'outbreak.2010', description: 'Hunger weakened the town.', ...meta }],
      normalized_cuts: [
        { id: 'cut.outbreak', parent_event_id: 'forecast.outbreak', question: 'Does an outbreak killing more than 50 people start in the town by 2030?', unit: 'one unit of the modeler\'s belief',
          answers: [{ key: 'yes', weight: 0.3 }, { key: 'no', weight: 0.6 }, { key: 'remainder', weight: 0.1 }], provenance: declared(2025, 2030) },
        { id: 'cut.recovery', parent_event_id: 'forecast.recovery', question: 'How fast does the town recover from its next shock?', unit: 'one unit of the modeler\'s belief',
          answers: [{ key: 'fast', weight: 0.5 }, { key: 'slow', weight: 0.4 }, { key: 'remainder', weight: 0.1 }], provenance: declared(2025, 2034) },
        { id: 'cut.ana.2012', parent_event_id: 'ana.choice.2012', question: 'Does Ana take the post in the city?', unit: 'proposal weight over mutually exclusive continuations',
          answers: [{ key: 'stay', weight: 0.7 }, { key: 'leave', weight: 0.2 }, { key: 'remainder', weight: 0.1 }], provenance: prov },
        { id: 'cut.shares', parent_event_id: 'reading.shares', question: 'What does the town talk about?', unit: 'conversational attention',
          answers: [{ key: 'yes', weight: 0.5 }, { key: 'no', weight: 0.4 }, { key: 'remainder', weight: 0.1 }], provenance: prov },
      ],
      cause_questions: [{ id: 'why.outbreak', outcome_event_id: 'outbreak.2010', contrast: 'a mild winter of colds', measure: { kind: 'amount', unit: 'deaths' },
        actual: 120, holder: 'modeler', provenance: prov }],
      cause_assessments: [{ id: 'cause.drought', question_id: 'why.outbreak', relation_id: 'drought.causes.outbreak', role: 'enabling', without: 70, provenance: prov }],
      context_roots: [{ event_id: 'world', kind: 'accepted_world', provenance: prov }, { event_id: 'modeler', kind: 'understanding', provenance: prov }],
      concepts: [], abstract_cuts: [], abstract_relations: [], encapsulation_cuts: [], physical_cuts: [], realizations: [],
    } } };
}

const scopes = ['town'];
const forecastStage = (trunkModelHash, extra = {}) => ({
  requestId: 'fork.outbreak', stageId: 'outbreak', title: 'Another outbreak by 2030?', trunkModelHash, kind: 'forecast', cutoff: 2025, horizon: 2032,
  forecast: { cutId: 'cut.outbreak', window: { start: 2025, end: 2030 } },
  branches: [
    { key: 'yes', premise: { boundary: 'An outbreak killing more than 50 starts in the town between 2025 and 2030.', description: 'The forecast\'s yes, over its whole window.', processIds: ['town.pop'] },
      narrowings: [{ id: 'late', boundary: 'It starts late, in 2028 to 2030.', description: 'Assumed in this branch; the forecast gave no timing.', interval: { start: 2028, end: 2030 } }] },
    { key: 'no', premise: { boundary: 'No outbreak killing more than 50 starts in the town between 2025 and 2030.', description: 'The forecast\'s no.' } },
  ],
  agentId: 'modeler', accessScopes: scopes, ...extra });

async function setup(t) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest());
  return { service, trunk: modelHash };
}
const definitionOf = async (service, modelHash) => (await service.inspectModel({ modelHash, includeDefinition: true })).model;
async function revise(service, previousModelHash, change, requestId) {
  const previous = await definitionOf(service, previousModelHash);
  const { successor } = applyModelChange(previous, previousModelHash, change);
  return (await service.reviseModel({ requestId, previousModelHash, model: successor })).modelHash;
}

test('a forecast stage forks one branch per answer, each premise spanning the window, and leaves the trunk untouched', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  assert.deepEqual(forked.branches.map((branch) => [branch.key, branch.probability]), [['yes', 0.3], ['no', 0.6]]);
  assert.equal(forked.unnamedMass, 0.1, 'the remainder is modeled in no branch');
  const yes = await definitionOf(service, forked.branches[0].modelHash);
  const events = new Map(yes.meaning_model.events.map((item) => [item.id, item]));
  const premise = events.get('future.outbreak.yes.premise');
  assert.deepEqual(premise.interval, { start: 2025, end: 2030 }, 'the premise spans what was forecast, not a narrower timing');
  assert.ok(premise.provenance.includes(PREMISE_MARK));
  assert.deepEqual(events.get('future.outbreak.yes.late').interval, { start: 2028, end: 2030 });
  assert.equal(events.get('world').interval.end, 2032, 'the branch extends the accepted world to its horizon');
  const realized = yes.meaning_model.event_relations.find((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer.cut_id === 'cut.outbreak');
  assert.deepEqual(realized.forecast_answer, { cut_id: 'cut.outbreak', answer_key: 'yes' });
  assert.ok(realized.provenance.includes(PREMISE_MARK), 'an assumed realization is marked as such');
  assert.ok(yes.revision.provenance.some((item) => item.startsWith(`${BRANCH_MARK} `)));
  const trunkModel = await definitionOf(service, trunk);
  assert.ok(!trunkModel.meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === 'cut.outbreak' || relation.provenance.includes(PREMISE_MARK)), 'no assumed realization reaches the trunk');
  assert.equal(trunkModel.meaning_model.events.find((item) => item.id === 'world').interval.end, 2025);
  const listed = await listFutures(service, { accessScopes: scopes });
  assert.equal(listed.stages.length, 1);
  assert.deepEqual(listed.stages[0].branches.map((branch) => branch.key).sort(), ['no', 'yes']);
  assert.equal(listed.stages[0].unnamedMass, 0.1);
  const loaded = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  assert.match(loaded.branch.probability.meaning, /not of the narrowings/u);
  assert.match(loaded.branch.status, /hypothetical/u);
});

test('a fork refuses only what cannot be a branch, and forks the rest with the reason a probability is withheld', async (t) => {
  const { service, trunk } = await setup(t);
  const stage = forecastStage(trunk);
  let n = 0;
  const variant = (change) => { const copy = structuredClone(stage); n += 1; copy.requestId = `fork.v${n}`; copy.stageId = `v${n}`; change(copy); return copy; };
  // What cannot be a branch is refused: the remainder, a narrowing outside its premise, a forecast already settled.
  await assert.rejects(forkStage(service, variant((input) => { input.branches[1].key = 'remainder'; })), /remainder is not branched/u);
  await assert.rejects(forkStage(service, variant((input) => { input.branches[0].narrowings[0].interval = { start: 2024, end: 2026 }; })), /must lie within the premise/u);
  // A timing given with the premise inside the window becomes a narrowing; the premise still spans the window.
  const timed = await forkStage(service, variant((input) => { input.branches[1].premise.interval = { start: 2026, end: 2027 }; }));
  const no = await definitionOf(service, timed.branches.find((branch) => branch.key === 'no').modelHash);
  assert.deepEqual(no.meaning_model.events.find((item) => item.id === `future.${timed.stageId}.no.premise`).interval, { start: 2025, end: 2030 });
  assert.deepEqual(no.meaning_model.events.find((item) => item.id === `future.${timed.stageId}.no.timing`).interval, { start: 2026, end: 2027 });
  assert.deepEqual(timed.branches.map((branch) => branch.probability), [0.3, 0.6]);
  // A timing that starts inside the window and runs past it is a narrowing too: the premise continues with it, and the
  // answer's probability still carries.
  const running = await forkStage(service, variant((input) => { input.branches[0].narrowings = []; input.branches[0].premise.interval = { start: 2029, end: 2032 }; }));
  const runningYes = await definitionOf(service, running.branches.find((branch) => branch.key === 'yes').modelHash);
  assert.deepEqual(runningYes.meaning_model.events.find((item) => item.id === `future.${running.stageId}.yes.premise`).interval, { start: 2025, end: 2032 });
  assert.deepEqual(runningYes.meaning_model.events.find((item) => item.id === `future.${running.stageId}.yes.timing`).interval, { start: 2029, end: 2032 });
  assert.deepEqual(running.branches.map((branch) => branch.probability), [0.3, 0.6]);
  assert.equal(running.horizon, 2032);
  // A timing that starts outside the window is not what was forecast: the branch assumes it as given, without the
  // answer's realization or probability; the sibling keeps its own.
  const outside = await forkStage(service, variant((input) => { input.branches[0].narrowings = []; input.branches[0].premise.interval = { start: 2031, end: 2032 }; }));
  assert.deepEqual(outside.branches.map((branch) => branch.probability), [null, 0.6]);
  assert.equal(outside.unnamedMass, undefined, 'no unnamed mass is computed while a branch has no probability');
  assert.ok(outside.warnings.some((warning) => /starts outside the forecast window/u.test(warning)));
  const outsideYes = await definitionOf(service, outside.branches.find((branch) => branch.key === 'yes').modelHash);
  assert.deepEqual(outsideYes.meaning_model.events.find((item) => item.id === `future.${outside.stageId}.yes.premise`).interval, { start: 2031, end: 2032 });
  assert.ok(!outsideYes.meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === 'cut.outbreak'), 'a timing outside the window does not realize the answer');
  const outsideNo = await definitionOf(service, outside.branches.find((branch) => branch.key === 'no').modelHash);
  assert.ok(outsideNo.meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === 'cut.outbreak' && relation.forecast_answer.answer_key === 'no'), 'the sibling still realizes its answer');
  assert.match((await loadFuture(service, { branch: { stageId: outside.stageId, key: 'yes' }, accessScopes: scopes })).branch.weights, /neither realizes the forecast answer nor carries its probability/u);
  // A window reaching before this stage's cutoff forks, without probabilities, and says why.
  const early = await forkStage(service, variant((input) => { input.forecast.window.start = 2020; input.branches[0].narrowings = []; }));
  assert.deepEqual(early.branches.map((branch) => branch.probability), [null, null]);
  assert.ok(early.warnings.some((warning) => /do not carry/u.test(warning)));
  // A horizon short of what the branches assume is extended.
  const extended = await forkStage(service, variant((input) => { input.horizon = 2028; }));
  assert.equal(extended.horizon, 2030);
  assert.ok(extended.warnings.some((warning) => /horizon is extended/u.test(warning)));
  // One future may be followed alone, and the result says so.
  const alone = await forkStage(service, variant((input) => { input.branches = input.branches.slice(0, 1); }));
  assert.deepEqual(alone.branches.map((branch) => [branch.key, branch.probability]), [['yes', 0.3]]);
  assert.equal(alone.unnamedMass, 0.7);
  assert.ok(alone.warnings.some((warning) => /Only yes is followed/u.test(warning)));
  const settled = await revise(service, trunk, { reason: 'An outbreak happened.', upsert: {
    events: [event('outbreak.2027', 'The 2027 outbreak', { start: 2025, end: 2025 })],
    event_relations: [contains('world', 'outbreak.2027'), { id: 'forecast.settled', kind: 'realizes_forecast', source_event_id: 'forecast.outbreak', target_event_id: 'outbreak.2027',
      forecast_answer: { cut_id: 'cut.outbreak', answer_key: 'yes' }, description: 'Observed.', ...meta }] } }, 'settle');
  await assert.rejects(forkStage(service, forecastStage(settled)), /already settled in the trunk/u);
  const listed = (await listFutures(service, { accessScopes: scopes })).stages.map((item) => item.stageId).sort();
  assert.deepEqual(listed, ['v3', 'v4', 'v5', 'v6', 'v7', 'v8'], 'refused forks wrote nothing');
});

test('weights not declared as probabilities carry no likelihood into a branch', async (t) => {
  const { service, trunk } = await setup(t);
  const stage = forecastStage(trunk, { requestId: 'fork.shares', stageId: 'talk', forecast: { cutId: 'cut.shares', window: { start: 2025, end: 2030 } } });
  stage.branches[0].narrowings = [];
  const forked = await forkStage(service, stage);
  assert.deepEqual(forked.branches.map((branch) => branch.probability), [null, null]);
  assert.equal(forked.unnamedMass, undefined, 'unknown probability mass is not fabricated as one');
  assert.equal((await listFutures(service, { accessScopes: scopes })).stages[0].unnamedMass, undefined);
  assert.equal((await compareFutures(service, { stageId: 'talk', accessScopes: scopes })).unnamedMass, undefined);
  assert.ok(forked.warnings.some((warning) => /does not say its weights are probabilities/u.test(warning)));
});

test('load gives a branch\'s digest and its consequence questions, and a sufficient note closes one', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  const yesFork = forked.branches.find((branch) => branch.key === 'yes').modelHash;
  const before = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  const kinds = (loaded) => loaded.agenda.open.map((item) => item.kind);
  assert.ok(kinds(before).includes('analogue-driver'), 'the premise moves the town\'s population, so the 2010 outbreak and its drought are asked about');
  assert.match(before.agenda.open.find((item) => item.kind === 'analogue-driver').question, /drought of 2009.*50 deaths/u);
  assert.ok(kinds(before).includes('horizon-open'));
  assert.ok(!before.agenda.open.some((item) => item.eventId === 'growth'), 'a 74-year trend is not like a premise spanning a few years');
  // The branch follows the population after the premise and adds a consequence linked to it.
  const series = (await definitionOf(service, yesFork)).value_series[0];
  const head = await revise(service, yesFork, { reason: 'Follow the outbreak.', upsert: {
    events: [event('future.outbreak.yes.closure', 'The school closes for a term', { start: 2029, end: 2029.4 }, { subject: 'referent.ana' })],
    event_relations: [contains('world', 'future.outbreak.yes.closure'), { id: 'late.causes.closure', kind: 'causes', source_event_id: 'future.outbreak.yes.late',
      target_event_id: 'future.outbreak.yes.closure', description: 'The outbreak closes the school.', ...meta }],
    value_series: [{ ...series, points: [...series.points, { time: 2029, value: 470, tag: 'exploring' }, { time: 2032, value: 490, tag: 'exploring' }] }] } }, 'yes.1');
  const after = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  assert.equal(after.branch.headModelHash, head, 'load follows the newest revision written on the branch line');
  assert.deepEqual(after.added.events.map((item) => item.eventId), ['future.outbreak.yes.closure']);
  assert.deepEqual(after.values[0].points.map((point) => point.at), [2029, 2032], 'only the branch\'s own values, not the trunk\'s');
  assert.ok(!kinds(after).includes('horizon-open'));
  assert.ok(!kinds(after).includes('consequence-untraced'), 'the closure is traced to the premise through its narrowing');
  const no = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'no' }, accessScopes: scopes });
  assert.ok(no.agenda.open.some((item) => item.kind === 'analogue-driver' && item.eventId === 'outbreak.2010'), 'a premise inherits the likeness its forecast declares');
  const asymmetry = no.agenda.open.find((item) => item.kind === 'sibling-asymmetry');
  assert.deepEqual(asymmetry.processes, ['town.pop']);
  const noGraph = no.branch.graphHash;
  await recordUnderstanding(service, { graphHash: noGraph, requestId: 'no.sufficient', accessScopes: scopes, holder: 'modeler',
    notes: [{ nodeId: 'no.pop.sufficient', kind: 'decision', text: 'Without an outbreak the population follows the trunk\'s trend; nothing here changes it.',
      about: [{ record: 'process:town.pop' }], data: { schema: 'meaning-model-sufficient/v1', kind: 'sibling-asymmetry', reason: 'The trend continues unchanged.' } }] });
  const closed = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'no' }, accessScopes: scopes });
  assert.ok(!closed.agenda.open.some((item) => item.kind === 'sibling-asymmetry'));
  assert.ok(closed.agenda.closedHere >= 1);
  const unrelated = await revise(service, trunk, { reason: 'Unrelated.', upsert: { events: [event('later', 'Later', { start: 2020, end: 2020 })], event_relations: [contains('world', 'later')] } }, 'unrelated');
  await assert.rejects(loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, modelHash: unrelated, accessScopes: scopes }), /is not on branch yes/u);
});

test('compare sets siblings side by side, per process and per person, without a total', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  const yesFork = forked.branches.find((branch) => branch.key === 'yes').modelHash;
  const series = (await definitionOf(service, yesFork)).value_series[0];
  await revise(service, yesFork, { reason: 'Follow the outbreak.', upsert: {
    events: [event('future.outbreak.yes.ward', 'Ana runs the fever ward', { start: 2028.5, end: 2029.5 }, { subject: 'referent.ana' }),
      event('future.outbreak.yes.burials', 'The burials of 2029', { start: 2029, end: 2029.5 })],
    event_relations: [contains('world', 'future.outbreak.yes.ward'), contains('world', 'future.outbreak.yes.burials'),
      { id: 'late.causes.ward', kind: 'causes', source_event_id: 'future.outbreak.yes.late', target_event_id: 'future.outbreak.yes.ward', description: 'The outbreak fills the ward.', ...meta }],
    value_series: [{ ...series, points: [...series.points, { time: 2029, value: 470, tag: 'exploring' }] }] } }, 'yes.compare');
  const compared = await compareFutures(service, { stageId: 'outbreak', people: ['referent.ana'], accessScopes: scopes });
  assert.equal(compared.total, null);
  assert.deepEqual(compared.branches.map((branch) => [branch.key, branch.probability]), [['no', 0.6], ['yes', 0.3]]);
  const pop = compared.trajectories.find((item) => item.processId === 'town.pop');
  assert.deepEqual(pop.branches.yes[0].points.map((point) => point.value), [470]);
  assert.deepEqual(pop.branches.no, []);
  assert.deepEqual(compared.asymmetries, [{ processId: 'town.pop', followedIn: ['yes'], notIn: ['no'] }]);
  assert.deepEqual(compared.underdeveloped.map((item) => item.key), ['no'], 'the sibling left thin is named');
  assert.deepEqual(Object.keys(compared.people[0].branches).sort(), ['no', 'yes']);
  const load = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  assert.ok(load.agenda.open.some((item) => item.kind === 'consequence-untraced' && item.eventId === 'future.outbreak.yes.burials'), 'a consequence with no path from the premise is asked about');
});

test('a trunk view never follows into a branch, and a trunk graph is not rebound into one', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  assert.equal(service.newestModelDescendant(trunk), trunk, 'the forks are not the trunk\'s continuation');
  const continued = await revise(service, trunk, { reason: 'The trunk goes on.', upsert: { events: [event('census.2025', 'The 2025 census', { start: 2025, end: 2025 })], event_relations: [contains('world', 'census.2025')] } }, 'trunk.1');
  assert.equal(service.newestModelDescendant(trunk), continued);
  const yesFork = forked.branches[0].modelHash;
  const yesNext = await revise(service, yesFork, { reason: 'Branch work.', upsert: { events: [event('future.outbreak.yes.x', 'X', { start: 2029, end: 2029 })], event_relations: [contains('world', 'future.outbreak.yes.x')] } }, 'yes.x');
  assert.equal(service.newestModelDescendant(yesFork), yesNext, 'a branch view follows its own line');
  const graph = await service.registerNarrativeGraph({ requestId: 'trunk.graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'trunk-notes',
    revision: { number: 0, reason: 'Trunk notes.', provenance: prov }, source: { kind: 'model', model_hash: trunk }, roots: ['root'],
    nodes: [{ id: 'root', node_type: 'story', role: 'document_root', text: '# Town', render: 'include', training: 'exclude', epistemic_status: 'authored_process',
      evidence_type: 'creative_hypothesis', authority: { source: 'modeler', weight: 1 }, access_scopes: scopes, uncertainty: { kind: 'unknown' }, provenance: prov }], edges: [] } });
  await assert.rejects(rebindNarrativeGraph(service, { requestId: 'rebind.into.branch', graphHash: graph.graphHash, modelHash: yesNext, accessScopes: scopes }), /lies in branch yes of stage outbreak/u);
  await rebindNarrativeGraph(service, { requestId: 'rebind.trunk', graphHash: graph.graphHash, modelHash: continued, accessScopes: scopes });
  assert.equal(newestWrittenDescendant([{ modelHash: 'b', previousModelHash: 'a', fork: true }, { modelHash: 'c', previousModelHash: 'a' }], 'a'), 'c');
  assert.equal(newestWrittenDescendant([{ modelHash: 'b', previousModelHash: 'a', fork: true }], 'a'), 'a');
});

test('a decision stage compares its options with waiting, and options carry no probability', async (t) => {
  const { service, trunk } = await setup(t);
  const decision = (extra = {}) => ({ requestId: 'fork.clinic', stageId: 'clinic', title: 'Does Ana open a second clinic?', trunkModelHash: trunk, kind: 'decision',
    cutoff: 2025, horizon: 2030, decision: { at: 2026, deciderId: 'referent.ana' },
    branches: [{ key: 'open', premise: { boundary: 'Ana opens a second clinic in 2026.', description: 'She borrows to do it.' } },
      { key: 'stay', premise: { boundary: 'Ana keeps one clinic.', description: 'She hires a nurse instead.' } }],
    agentId: 'modeler', accessScopes: scopes, ...extra });
  // Without a waiting option or a reason, the options still fork, and the result and each option ask about doing nothing.
  const bare = await forkStage(service, decision({ requestId: 'fork.clinic0', stageId: 'clinic0' }));
  assert.ok(bare.warnings.some((warning) => /not compared with doing nothing/u.test(warning)));
  const bareOpen = await loadFuture(service, { branch: { stageId: 'clinic0', key: 'open' }, accessScopes: scopes });
  assert.ok(bareOpen.agenda.open.some((item) => item.kind === 'baseline-absent'));
  const withWait = decision();
  withWait.branches.push({ key: 'wait', baseline: true, premise: { boundary: 'Ana decides nothing in 2026.', description: 'She waits for the council\'s budget.' } });
  const forked = await forkStage(service, withWait);
  assert.deepEqual(forked.branches.map((branch) => branch.probability), [null, null, null]);
  const premise = (await definitionOf(service, forked.branches[0].modelHash)).meaning_model.events.find((item) => item.id === 'future.clinic.open.premise');
  assert.deepEqual(premise.participants, { actor: 'referent.ana' });
  const wait = await loadFuture(service, { branch: { stageId: 'clinic', key: 'wait' }, accessScopes: scopes });
  assert.ok(wait.agenda.open.some((item) => item.kind === 'wait-undeclared'), 'a waiting option is asked what it waits to learn');
  const reasoned = await forkStage(service, decision({ requestId: 'fork.clinic2', stageId: 'clinic2', noBaseline: { reason: 'The lease must be signed this week.' } }));
  assert.equal(reasoned.branches.length, 2);
  await assert.rejects(forkStage(service, decision({ requestId: 'fork.clinic3', stageId: 'clinic3', decision: { at: 2020 } , noBaseline: { reason: 'x' } })), /before the cutoff/u);
});

test('a stage inside a branch is conditional on it, and an older forecast is flagged as assumed independent', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  const yesFork = forked.branches.find((branch) => branch.key === 'yes').modelHash;
  const nested = await forkStage(service, { requestId: 'fork.recovery', stageId: 'recovery', title: 'How fast does the town recover?', trunkModelHash: yesFork, kind: 'forecast',
    cutoff: 2025, horizon: 2034, forecast: { cutId: 'cut.recovery', window: { start: 2025, end: 2034 } },
    branches: [{ key: 'fast', premise: { boundary: 'The town recovers fast.', description: 'Within two years.' } },
      { key: 'slow', premise: { boundary: 'The town recovers slowly.', description: 'Over a decade.' } }], agentId: 'modeler', accessScopes: scopes });
  assert.deepEqual(nested.within, { stageId: 'outbreak', branch: 'yes' });
  assert.deepEqual(nested.branches.map((branch) => [branch.key, branch.probability, branch.jointProbability]), [['fast', 0.5, 0.15], ['slow', 0.4, 0.12]]);
  assert.ok(nested.branches.every((branch) => !branch.jointIncludesGuess && branch.windowStated === undefined), 'bound probabilities are not marked as guesses');
  assert.ok(nested.warnings.some((warning) => /assumes the two are independent/u.test(warning)));
  assert.equal(service.newestModelDescendant(yesFork), yesFork, 'the outer branch does not follow into the stage inside it');
});

test('a change to the past forks beside the actual history and asks what still happens', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, { requestId: 'fork.nodrought', stageId: 'nodrought', title: 'What if the 2009 drought had not come?', trunkModelHash: trunk,
    kind: 'counterfactual', cutoff: 2025, horizon: 2025, counterfactual: { at: 2009 },
    branches: [{ key: 'rain', premise: { boundary: 'The 2009 rains come.', description: 'No drought.', interval: { start: 2009, end: 2009.5 } } }],
    agentId: 'modeler', accessScopes: scopes });
  assert.equal(forked.branches[0].probability, null);
  const loaded = await loadFuture(service, { branch: { stageId: 'nodrought', key: 'rain' }, accessScopes: scopes });
  const carried = loaded.agenda.open.filter((item) => item.kind === 'actual-history-carried').map((item) => item.eventId);
  assert.ok(carried.includes('outbreak.2010'), 'the outbreak that followed the drought is asked about');
  assert.deepEqual(loaded.values, [], 'the actual history\'s values after the change are not credited to the branch');
  await assert.rejects(forkStage(service, { requestId: 'fork.bad', stageId: 'bad', title: 'x', trunkModelHash: trunk, kind: 'counterfactual', cutoff: 2025, horizon: 2030,
    counterfactual: { at: 2026 }, branches: [{ key: 'x', premise: { boundary: 'x', description: 'x', interval: { start: 2026, end: 2026 } } }], agentId: 'modeler', accessScopes: scopes }), /before the cutoff/u);
});

test('forecasting is a mode any purpose can pull in', async () => {
  assert.ok(availableAddons.includes('forecasting'));
  const story = await buildModelingContext({ purpose: 'creative_story', sessionMode: 'first_use', modes: ['forecasting'] });
  assert.match(story.method.forecasting.inThisPurpose, /story chat/u);
  assert.match(story.method.forecasting.core, /hindsight/u);
  assert.match(story.method.forecasting.branches, /MEANING_MODEL_ADDONS/u);
  assert.ok(!story.orderedResources.some((resource) => resource.uri === 'life-sim://addon/forecasting'));
  const memory = await buildModelingContext({ purpose: 'user_memory', sessionMode: 'first_use', modes: ['forecasting'], addons: ['forecasting'] });
  assert.match(memory.method.forecasting.branches, /life_future_fork/u);
  assert.ok(memory.orderedResources.some((resource) => resource.uri === 'life-sim://addon/forecasting' && resource.required));
  assert.ok((await buildModelingContext({ purpose: 'forecasting', sessionMode: 'first_use' })).method.forecasting, 'the forecasting purpose carries the mode');
  assert.equal((await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use' })).method.forecasting, undefined);
  await assert.rejects(buildModelingContext({ purpose: 'observation', sessionMode: 'first_use', modes: ['prophecy'] }), /Unsupported mode/u);
});

test('a retried fork writes nothing new and completes a stage left half written; sibling order changes no branch', async (t) => {
  const { service, trunk } = await setup(t);
  // The second branch's graph fails to register the first time, as if the process had stopped between writes.
  const register = service.registerNarrativeGraph.bind(service);
  let failOnce = true;
  service.registerNarrativeGraph = async (input) => {
    if (failOnce && input.narrativeGraph.id === 'future.outbreak.no') { failOnce = false; throw new Error('interrupted'); }
    return register(input);
  };
  await assert.rejects(forkStage(service, forecastStage(trunk)), /interrupted/u);
  const completed = await forkStage(service, forecastStage(trunk));
  const again = await forkStage(service, forecastStage(trunk));
  assert.deepEqual(again.branches, completed.branches, 'the same request returns the same branches');
  assert.equal((await listFutures(service, { accessScopes: scopes })).stages[0].branches.length, 2);
  // The same stage forked in another store with the siblings in the other order gives the same model revisions.
  const other = await setup(t);
  const reversed = forecastStage(other.trunk);
  reversed.branches.reverse();
  const forkedReversed = await forkStage(other.service, reversed);
  const byKey = (result) => Object.fromEntries(result.branches.map((branch) => [branch.key, branch.modelHash]));
  assert.equal(other.trunk, trunk);
  assert.deepEqual(byKey(forkedReversed), byKey(completed));
});

test('a change to a past choice realizes another answer in the branch, and a life held too briefly is asked about', async (t) => {
  const { service, trunk } = await setup(t);
  const stage = (extra = {}) => ({ requestId: 'fork.city', stageId: 'city', title: 'What if Ana had taken the post?', trunkModelHash: trunk, kind: 'counterfactual',
    cutoff: 2025, horizon: 2025, counterfactual: { at: 2012, cutId: 'cut.ana.2012' },
    branches: [{ key: 'leave', premise: { boundary: 'Ana takes the post in the city.', description: 'She leaves in 2012.', interval: { start: 2012, end: 2012.2 }, participants: { subject: 'referent.ana' } } }],
    agentId: 'modeler', accessScopes: scopes, ...extra });
  await assert.rejects(forkStage(service, (() => { const input = stage(); input.branches[0].key = 'stay'; return input; })()), /actually happened in the trunk/u);
  const forked = await forkStage(service, stage());
  const branch = await definitionOf(service, forked.branches[0].modelHash);
  const realized = branch.meaning_model.event_relations.filter((relation) => relation.forecast_answer?.cut_id === 'cut.ana.2012');
  assert.deepEqual(realized.map((relation) => [relation.forecast_answer.answer_key, relation.provenance.includes(PREMISE_MARK)]), [['leave', true]], 'the branch realizes its own answer, by assumption, instead of the actual one');
  const trunkRealized = (await definitionOf(service, trunk)).meaning_model.event_relations.filter((relation) => relation.forecast_answer?.cut_id === 'cut.ana.2012');
  assert.deepEqual(trunkRealized.map((relation) => relation.forecast_answer.answer_key), ['stay']);
  const loaded = await loadFuture(service, { branch: { stageId: 'city', key: 'leave' }, accessScopes: scopes });
  assert.equal(loaded.agenda.open.find((item) => item.kind === 'actual-history-carried').eventId, 'ana.stays.2012', 'what actually followed the choice is asked about first');
  const decided = await forkStage(service, { requestId: 'fork.mayor', stageId: 'mayor', title: 'Does Ben stand again?', trunkModelHash: trunk, kind: 'decision', cutoff: 2025, horizon: 2030,
    decision: { at: 2025, deciderId: 'referent.ben' }, noBaseline: { reason: 'The deadline to stand is today.' },
    branches: [{ key: 'stand', premise: { boundary: 'Ben stands again.', description: 'He files his papers.' } }, { key: 'retire', premise: { boundary: 'Ben retires.', description: 'He does not file.' } }],
    agentId: 'modeler', accessScopes: scopes });
  assert.equal(decided.branches.length, 2);
  const stand = await loadFuture(service, { branch: { stageId: 'mayor', key: 'stand' }, accessScopes: scopes });
  assert.ok(stand.agenda.open.some((item) => item.kind === 'life-unextended' && item.referents[0] === 'referent.ben'));
  assert.match(stand.people.find((row) => row.personId === 'referent.ben').lifeNotHeld, /only from 1970 to 2025/u);
});

test('the viewer names the branch a view shows, from a branch graph or a lone branch revision, and never on the trunk', async (t) => {
  const { service, trunk } = await setup(t);
  const { exportConstructionHistory } = await import('../src/construction-record.mjs');
  const { buildViewerData } = await import('../src/viewer-data.mjs');
  const { branchesOf } = await import('../src/model-lineage.mjs');
  const forked = await forkStage(service, forecastStage(trunk));
  const yes = forked.branches.find((branch) => branch.key === 'yes');
  const fromGraph = await buildViewerData({ history: await exportConstructionHistory(service, { graphHash: yes.graphHash, accessScopes: scopes }), name: 'model' });
  assert.deepEqual([fromGraph.branch.stageId, fromGraph.branch.key, fromGraph.branch.kind, fromGraph.branch.probability], ['outbreak', 'yes', 'forecast', 0.3]);
  assert.match(fromGraph.branch.premise, /outbreak killing more than 50/u);
  const later = await revise(service, yes.modelHash, { reason: 'Branch work.', upsert: { events: [event('future.outbreak.yes.w', 'W', { start: 2029, end: 2029 })], event_relations: [contains('world', 'future.outbreak.yes.w')] } }, 'yes.w');
  const lone = async (modelHash) => ({ schema: 'meaning-model-construction-history/v1', headGraphHash: null, revisions: [],
    models: [{ modelHash, definition: await definitionOf(service, modelHash) }], branchAncestry: { modelHash, ...(await branchesOf(service, modelHash)) } });
  assert.equal((await buildViewerData({ history: await lone(later), name: 'model' })).branch.key, 'yes', 'a later revision viewed alone is still named a branch');
  assert.equal((await buildViewerData({ history: await lone(trunk), name: 'model' })).branch, undefined);
});

test('probabilities carry only for their issued cutoff, window and outcomes; otherwise the branches fork without them', async (t) => {
  const { service, trunk } = await setup(t);
  const moved = forecastStage(trunk, { requestId: 'fork.moved', stageId: 'moved', cutoff: 2030, horizon: 2035,
    forecast: { cutId: 'cut.outbreak', window: { start: 2030, end: 2032 } } });
  moved.branches[0].narrowings = [];
  const movedFork = await forkStage(service, moved);
  assert.deepEqual(movedFork.branches.map((branch) => branch.probability), [null, null]);
  assert.ok(movedFork.warnings.some((warning) => /issued at cutoff 2025 for the window 2025 to 2030/u.test(warning)));
  const shortened = forecastStage(trunk, { requestId: 'fork.short', stageId: 'short', forecast: { cutId: 'cut.outbreak', window: { start: 2025, end: 2029 } } });
  shortened.branches[0].narrowings = [];
  assert.deepEqual((await forkStage(service, shortened)).branches.map((branch) => branch.probability), [null, null]);
  // Agents declare in their own words and add notes; only a denial about the probabilities themselves is refused.
  for (const words of ['forecast: these weights are not probabilities', 'forecast: shares rather than probabilities', 'forecast: weights aren\'t probabilities',
    'forecast: probabilities are not declared', 'forecast: non-probabilistic weights', 'forecast: weights not meant to be read as probabilities',
    'forecast: no probabilities, relative salience only', 'forecast: probabilities unknown', 'forecast: salience weights instead of probabilities',
    'inferred: probabilities declared before the outcome']) assert.equal(declaredForecast({ provenance: [words] }), false, words);
  for (const words of ['forecast: probabilities declared before the outcome, guessed from base rates', 'forecast: these are my probabilities, set before the outcome',
    'forecast: probabilities declared before the outcome; not yet settled', 'forecast: probabilities declared before the outcome, no later than hour 7',
    'forecast: sell / no sale, probabilities declared before the outcome', 'forecast - probabilities declared before the outcome',
    'Forecast issued at hour 7: probabilities declared before the outcome', 'forecast: chances as I judged them before the outcome',
    'forecast: probability of not selling by hour 24 declared before the outcome']) assert.equal(declaredForecast({ provenance: [words] }), true, words);
  const original = (await definitionOf(service, trunk)).meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.outbreak');
  const metadata = { probabilities: true, cutoff: 2025, window: { start: 2025, end: 2030 }, question: original.question, unit: original.unit,
    answers: original.answers, settledBy: 'the town register' };
  const cut = { ...original, provenance: [FORECAST_METADATA_MARK + ' ' + JSON.stringify(metadata)] };
  const bound = await revise(service, trunk, { reason: 'Bind the issued forecast.', upsert: { normalized_cuts: [cut] } }, 'bind.forecast');
  const good = await forkStage(service, forecastStage(bound));
  assert.deepEqual(good.branches.map((branch) => branch.probability), [0.3, 0.6]);
  assert.equal(good.unnamedMass, 0.1);
  const changed = await revise(service, bound, { reason: 'An incompatible outcome wording.', upsert: { normalized_cuts: [{ ...cut, question: 'An outbreak after 2030?' }] } }, 'changed.forecast');
  const changedFork = await forkStage(service, forecastStage(changed, { requestId: 'fork.changed', stageId: 'changed' }));
  assert.deepEqual(changedFork.branches.map((branch) => branch.probability), [null, null]);
  assert.ok(changedFork.warnings.some((warning) => /no longer matches/u.test(warning)));
  for (const branch of changedFork.branches) assert.ok(!(await definitionOf(service, branch.modelHash)).meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === cut.id), 'a changed frozen outcome is not realized either');
  // A declared forecast that never stated its window carries its probabilities as guesses for the window given here.
  const unbound = await revise(service, trunk, { reason: 'Legacy declaration without a horizon.', upsert: { normalized_cuts: [{ ...original,
    provenance: ['forecast: probabilities declared before the outcome'] }] } }, 'unbound.forecast');
  const guessed = await forkStage(service, forecastStage(unbound, { requestId: 'fork.unbound', stageId: 'unbound' }));
  assert.deepEqual(guessed.branches.map((branch) => branch.probability), [0.3, 0.6]);
  assert.ok(guessed.warnings.some((warning) => /does not state its own evidence cutoff and horizon/u.test(warning)));
  const record = (await loadFuture(service, { branch: { stageId: 'unbound', key: 'yes' }, accessScopes: scopes })).branch.probability;
  assert.equal(record.windowStated, false);
  assert.deepEqual(record.window, { start: 2025, end: 2030 });
  // Every reader that shows the probability shows it is a guess, and a stage inside the branch inherits that.
  assert.ok(guessed.branches.every((branch) => branch.windowStated === false));
  const listedStage = (await listFutures(service, { stageId: 'unbound', accessScopes: scopes })).stages[0];
  assert.ok(listedStage.branches.every((branch) => branch.windowStated === false), 'list shows the guess');
  const compared = await compareFutures(service, { stageId: 'unbound', accessScopes: scopes });
  assert.deepEqual(compared.branches.map((branch) => [branch.key, branch.probability, branch.windowStated]), [['no', 0.6, false], ['yes', 0.3, false]], 'compare shows the guess');
  const yesGuess = guessed.branches.find((branch) => branch.key === 'yes').modelHash;
  const inner = await forkStage(service, { requestId: 'fork.unbound.recovery', stageId: 'unbound-recovery', title: 'How fast does the town recover?', trunkModelHash: yesGuess, kind: 'forecast',
    cutoff: 2025, horizon: 2034, forecast: { cutId: 'cut.recovery', window: { start: 2025, end: 2034 } },
    branches: [{ key: 'fast', premise: { boundary: 'The town recovers fast.', description: 'Within two years.' } }], agentId: 'modeler', accessScopes: scopes });
  assert.deepEqual(inner.branches.map((branch) => [branch.probability, branch.jointProbability, branch.windowStated, branch.jointIncludesGuess]), [[0.5, 0.15, undefined, true]],
    'its own probability is bound, but the joint multiplies a guess');
  const denied = await revise(service, trunk, { reason: 'Explicitly not probabilities.', upsert: { normalized_cuts: [{ ...original,
    provenance: ['forecast: these weights are not probabilities', 'evidence cutoff: 2025', 'horizon: 2030', 'settled by: the town register'] }] } }, 'denied.forecast');
  assert.deepEqual((await forkStage(service, forecastStage(denied, { requestId: 'fork.denied', stageId: 'denied' }))).branches.map((branch) => branch.probability), [null, null]);
});

test('a changed forecast window remains an assumption, while a new cutoff or a valid narrowing may still realize the issued answer', async (t) => {
  const { service, trunk } = await setup(t);
  const hasRealization = async (modelHash) => (await definitionOf(service, modelHash)).meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === 'cut.outbreak');
  for (const [stageId, cutoff, window] of [
    ['shifted-window', 2030, { start: 2030, end: 2032 }],
    ['shorter-window', 2025, { start: 2025, end: 2029 }],
    ['overlapping-window', 2025, { start: 2028, end: 2032 }],
    ['longer-window', 2025, { start: 2025, end: 2032 }],
  ]) {
    const stage = forecastStage(trunk, { requestId: `fork.${stageId}`, stageId, cutoff, horizon: 2035, forecast: { cutId: 'cut.outbreak', window } });
    for (const branch of stage.branches) {
      branch.narrowings = [];
      branch.premise.boundary = `${branch.key === 'yes' ? 'An outbreak begins' : 'No outbreak begins'} during ${window.start} to ${window.end}.`;
    }
    const result = await forkStage(service, stage);
    assert.deepEqual(result.branches.map((branch) => branch.probability), [null, null]);
    for (const branch of result.branches) {
      assert.equal(await hasRealization(branch.modelHash), false, `${stageId}/${branch.key}: changing a window cannot silently change the issued question`);
      const loaded = await loadFuture(service, { branch: { stageId, key: branch.key }, accessScopes: scopes });
      assert.match(loaded.branch.weights, /without realizing.*issued answer/u);
      assert.deepEqual(loaded.branch.premise.interval, window, 'the assumption keeps the requested timing');
    }
    assert.ok(result.warnings.some((warning) => /Keep the issued window and add a narrowing/u.test(warning)), 'a subset is accepted, with an explicit route to representing a valid narrowing');
  }
  const laterCutoff = await forkStage(service, forecastStage(trunk, { requestId: 'fork.later-cutoff', stageId: 'later-cutoff', cutoff: 2026 }));
  assert.deepEqual(laterCutoff.branches.map((branch) => branch.probability), [null, null]);
  for (const branch of laterCutoff.branches) assert.equal(await hasRealization(branch.modelHash), true, 'withholding outdated odds alone does not undo the same assumed outcome');
  const narrowed = forecastStage(trunk, { requestId: 'fork.within-window', stageId: 'within-window' });
  narrowed.branches[0].narrowings = [];
  narrowed.branches[0].premise.interval = { start: 2028, end: 2029 };
  const result = await forkStage(service, narrowed);
  assert.equal(result.branches[0].probability, 0.3, 'the probability still refers to the whole issued answer');
  assert.equal(await hasRealization(result.branches[0].modelHash), true);
  const loaded = await loadFuture(service, { branch: { stageId: 'within-window', key: 'yes' }, accessScopes: scopes });
  assert.deepEqual(loaded.branch.premise.interval, { start: 2025, end: 2030 });
  assert.deepEqual(loaded.branch.narrowings[0].interval, { start: 2028, end: 2029 });
  assert.match(loaded.branch.probability.meaning, /not of the narrowings/u);
});

test('forecast timing treats positive windows as half-open and a zero-duration window as its exact moment', async (t) => {
  const { service, trunk } = await setup(t);
  for (const [stageId, interval, probability] of [
    ['at-end', { start: 2030, end: 2031 }, null],
    ['moment-at-end', { start: 2030, end: 2030 }, null],
    ['just-inside', { start: 2029.999, end: 2031 }, 0.3],
  ]) {
    const stage = forecastStage(trunk, { requestId: `fork.${stageId}`, stageId });
    stage.branches = [{ key: 'yes', premise: { boundary: 'An outbreak begins at this time.', description: 'A timing assumption.', interval } }];
    const result = await forkStage(service, stage);
    assert.equal(result.branches[0].probability, probability, stageId);
    const model = await definitionOf(service, result.branches[0].modelHash);
    assert.equal(model.meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === 'cut.outbreak'), probability !== null, stageId);
    if (probability === null) assert.ok(result.warnings.some((warning) => /starts outside the forecast window/u.test(warning)), stageId);
  }
  const original = (await definitionOf(service, trunk)).meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.outbreak');
  const momentTrunk = await revise(service, trunk, { reason: 'Forecast an exact moment.', upsert: { normalized_cuts: [{ ...original,
    question: 'Does an outbreak begin at exactly 2025?', provenance: declared(2025, 2025) }] } }, 'forecast.moment');
  for (const [stageId, interval, probability] of [
    ['exact-moment', { start: 2025, end: 2025 }, 0.3],
    ['starts-at-moment', { start: 2025, end: 2026 }, 0.3],
    ['after-moment', { start: 2025.001, end: 2026 }, null],
  ]) {
    const stage = forecastStage(momentTrunk, { requestId: `fork.${stageId}`, stageId, forecast: { cutId: 'cut.outbreak', window: { start: 2025, end: 2025 } } });
    stage.branches = [{ key: 'yes', premise: { boundary: 'An outbreak starts.', description: 'Follow it from its start.', interval } }];
    const result = await forkStage(service, stage);
    assert.equal(result.branches[0].probability, probability, stageId);
    const model = await definitionOf(service, result.branches[0].modelHash);
    assert.equal(model.meaning_model.event_relations.some((relation) => relation.forecast_answer?.cut_id === 'cut.outbreak'), probability !== null, stageId);
  }
});

test('a decision with default premise intervals extends a short horizon to the choice moment', async (t) => {
  const { service, trunk } = await setup(t);
  const result = await forkStage(service, { requestId: 'fork.late-decision', stageId: 'late-decision', title: 'A later choice', trunkModelHash: trunk,
    kind: 'decision', cutoff: 2025, horizon: 2028, decision: { at: 2030 }, agentId: 'modeler', accessScopes: scopes,
    branches: [{ key: 'act', premise: { boundary: 'Act at 2030.', description: 'Act.' } },
      { key: 'wait', baseline: true, premise: { boundary: 'Wait at 2030.', description: 'Wait.' } }] });
  assert.equal(result.horizon, 2030);
  assert.ok(result.warnings.some((warning) => /horizon is extended from 2028 to 2030/u.test(warning)));
  for (const branch of result.branches) {
    const model = await definitionOf(service, branch.modelHash);
    assert.deepEqual(model.meaning_model.events.find((event) => event.id === branch.premiseEventId).interval, { start: 2030, end: 2030 });
  }
});

const effortReadings = (id = 'ana_effort') => ({ reason: 'Follow clinical effort.', subject: 'referent.ana',
  series: { id, question: 'How does Ana divide her clinical effort?', unit: 'one unit of clinical effort',
    answers: [{ key: 'ward', meaning: 'fever ward' }, { key: 'clinic', meaning: 'ordinary clinic' }] },
  readings: [{ start: 2028, end: 2030, weights: { ward: 0.9, clinic: 0.1 }, tag: 'exploring', why: 'The outbreak fills the ward.', confidence: 0.4 },
    { start: 2030, end: 2032, weights: { ward: 0.2, clinic: 0.8 }, tag: 'exploring', why: 'Recovery restores clinic work.', confidence: 0.6 }] });

test('ordinary Cut series are read and compared with subject, perspective, conditioning and uncertainty', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  const yes = forked.branches.find((branch) => branch.key === 'yes');
  let model = await definitionOf(service, yes.modelHash);
  let head = await revise(service, yes.modelHash, seriesChange(model, effortReadings()), 'yes.effort');
  model = await definitionOf(service, head);
  assert.equal(seriesDrawing(model, 'ana_effort').drawnAsCurve, 2);
  const loaded = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  assert.equal(loaded.series.length, 1);
  assert.equal(loaded.series[0].subject, 'referent.ana');
  assert.equal(loaded.series[0].perspective[0].kind, 'accepted_world');
  assert.deepEqual(loaded.series[0].readings.map((reading) => reading.answers.find((answer) => answer.key === 'ward').weight), [0.9, 0.2]);
  assert.ok(loaded.series[0].readings[0].provenance.includes('confidence 0.4'));
  const compared = await compareFutures(service, { stageId: 'outbreak', accessScopes: scopes });
  assert.equal(compared.series[0].branches.yes.readings.length, 2);
  assert.equal(compared.series[0].branches.no.readings.length, 0);
  assert.deepEqual(compared.seriesAsymmetries[0].notIn, ['no']);
  assert.ok((await loadFuture(service, { branch: { stageId: 'outbreak', key: 'no' }, accessScopes: scopes })).agenda.open.some((question) => question.kind === 'sibling-series-asymmetry'));
  const opened = effortReadings('ana_ward_details');
  opened.series.conditionedOn = { seriesId: 'ana_effort', answerKey: 'ward' };
  opened.series.question = 'Which work occupies the fever ward?';
  head = await revise(service, head, seriesChange(model, opened), 'yes.effort.open');
  model = await definitionOf(service, head);
  assert.equal((await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes })).series.find((series) => series.question === opened.series.question).conditioning[0].answerKey, 'ward');
  for (const [holder, value] of [['clinical_team', 20], ['ana', 80]]) {
    head = await revise(service, head, valuesChange(model, { reason: 'Competing assessments.', holder,
      values: [{ processId: 'ana.mood', points: [{ time: 2030, value, lower: value - 10, upper: value + 10, tag: 'exploring' }] }] }), `yes.mood.${holder}`);
    model = await definitionOf(service, head);
  }
  const state = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, at: 2030, people: ['referent.ana'], accessScopes: scopes });
  const mood = state.people.find((person) => person.personId === 'referent.ana').values.find((value) => value.processId === 'ana.mood');
  assert.deepEqual(mood.accounts.map((account) => [account.holder, account.held.value, account.held.lower, account.held.upper]).sort(), [['ana', 80, 70, 90], ['clinical_team', 20, 10, 30]]);
  assert.equal(mood.value, undefined, 'conflicting holders are not silently collapsed to one value');
  assert.deepEqual(state.values.filter((series) => series.processId === 'ana.mood').map((series) => series.points[0].lower).sort((a, b) => a - b), [10, 70]);
});

test('future readers and warnings exclude private native values and process-scoped Cut series without changing successors', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const request = registerRequest();
  request.model.processes.push({ ...process_('secret.signal', 'Secret resource forecast', 'referent.ana'), access_scopes: ['secret'] });
  request.model.value_series.push({ id: 'secret.future', process_id: 'secret.signal', holder: 'private_team', points: [{ time: 2031, value: 999, tag: 'source' }] });
  const { modelHash: trunk } = await service.registerModel(request);
  const forked = await forkStage(service, forecastStage(trunk));
  assert.equal(forked.laterRecords, undefined, 'private later points do not enter the warnings or counts');
  assert.ok(!forked.warnings.some((warning) => /dated after/u.test(warning)));
  const yes = forked.branches.find((branch) => branch.key === 'yes');
  let model = await definitionOf(service, yes.modelHash);
  assert.ok(model.processes.some((process) => process.id === 'secret.signal'), 'the full private trunk remains in each successor');
  let head = await revise(service, yes.modelHash, seriesChange(model, effortReadings()), 'yes.public.effort');
  model = await definitionOf(service, head);
  const privateInput = effortReadings('ana_secret_effort');
  privateInput.series.question = 'Which secret operation occupies Ana?';
  const privateChange = seriesChange(model, privateInput);
  for (const event of privateChange.upsert.events) event.process_ids = ['secret.signal'];
  head = await revise(service, head, privateChange, 'yes.private.effort');
  model = await definitionOf(service, head);
  head = await revise(service, head, valuesChange(model, { reason: 'Private value.', holder: 'private_team',
    values: [{ processId: 'secret.signal', points: [{ time: 2032, value: 888, tag: 'exploring' }] }] }), 'yes.private.value');
  const loaded = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  const compared = await compareFutures(service, { stageId: 'outbreak', accessScopes: scopes });
  const publicText = JSON.stringify({ loaded, compared });
  for (const secret of ['secret.signal', 'Secret resource', 'private_team', 'secret operation', 'ana_secret_effort']) assert.ok(!publicText.includes(secret), secret);
  assert.equal(loaded.series.length, 1, 'the independent public series stays useful');
  assert.equal(compared.series.length, 1);
  await assert.rejects(compareFutures(service, { stageId: 'outbreak', processes: ['secret.signal'], accessScopes: scopes }), (error) => /unavailable with these access scopes/u.test(error.message) && !error.message.includes('secret.signal'));
  const authorized = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: [...scopes, 'secret'] });
  assert.ok(authorized.values.some((series) => series.processId === 'secret.signal'));
  assert.equal(authorized.series.length, 2);
  const native = await definitionOf(service, head);
  assert.equal(native.value_series.find((series) => series.process_id === 'secret.signal').points.at(-1).value, 888);
});

test('private world and life process links preserve public descendants, premises and mixed-process readings', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const request = registerRequest();
  request.model.processes.push({ ...process_('private.history', 'Private history reading'), access_scopes: ['secret'] });
  request.model.meaning_model.events.find((event) => event.id === 'world').process_ids = ['private.history'];
  request.model.meaning_model.events.find((event) => event.id === 'ana.life').observation_process_ids = ['private.history'];
  const { modelHash: trunk } = await service.registerModel(request);
  const yes = (await forkStage(service, forecastStage(trunk))).branches.find((branch) => branch.key === 'yes');
  let head = yes.modelHash;
  for (const [id, links] of [
    ['public_effort', {}],
    ['mixed_effort', { process_ids: ['private.history', 'ana.mood'] }],
    ['mixed_observation', { process_ids: ['private.history'], observation_process_ids: ['ana.mood'] }],
  ]) {
    const input = effortReadings(id);
    input.series.question = `How is ${id} divided?`;
    const change = seriesChange(await definitionOf(service, head), input);
    for (const event of change.upsert.events) Object.assign(event, links);
    head = await revise(service, head, change, `yes.${id}`);
  }
  head = await revise(service, head, { reason: 'Record a public consequence inside the life.', upsert: {
    events: [event('ana.ward', 'Ana runs a ward', { start: 2028, end: 2031 }, { subject: 'referent.ana' }, { process_ids: ['ana.mood'] })],
    event_relations: [contains('ana.life', 'ana.ward')],
  } }, 'yes.public.child');
  const loaded = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes, people: ['referent.ana'] });
  const authorized = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: [...scopes, 'secret'], people: ['referent.ana'] });
  assert.ok(loaded.agenda.open.some((item) => item.kind === 'analogue-driver' && item.eventId === 'outbreak.2010'), 'the public analogue and its driver survive the private root link');
  assert.deepEqual(loaded.series, authorized.series, 'independent and mixed readings stay available under the private life annotation');
  assert.equal(loaded.series.length, 3);
  assert.ok(loaded.series.every((series) => series.contextStatus === 'declared' && series.perspective[0].rootId === 'world'));
  assert.ok(loaded.added.events.some((event) => event.eventId === 'ana.ward'));
  assert.ok(loaded.people[0].life, 'the life itself is preserved');
  assert.ok(!JSON.stringify(loaded).includes('private.history'));
  const compared = await compareFutures(service, { stageId: 'outbreak', people: ['referent.ana'], accessScopes: scopes });
  assert.equal(compared.series.length, 3);
  assert.ok(compared.people[0].branches.yes.life);
  assert.ok(compared.branches.find((branch) => branch.key === 'yes').eventsHere.some((event) => event.eventId === 'ana.ward'));
  assert.ok((await definitionOf(service, head)).meaning_model.events.find((event) => event.id === 'world').process_ids.includes('private.history'), 'scoped reading never rewrites the native model');
});

test('private answer references and their conditioned Cuts stay hidden without discarding a shared public reading', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const request = registerRequest();
  request.model.processes.push({ ...process_('private.signal', 'Private clinical resource'), access_scopes: ['secret'] });
  const { modelHash: trunk } = await service.registerModel(request);
  const yes = (await forkStage(service, forecastStage(trunk))).branches.find((branch) => branch.key === 'yes');
  const input = effortReadings('shared_reading');
  input.series.question = 'SECRET parent question';
  input.series.answers[0].refersTo = { kind: 'process', id: 'private.signal' };
  let head = await revise(service, yes.modelHash, seriesChange(await definitionOf(service, yes.modelHash), input), 'yes.private.refs');
  const child = effortReadings('hidden_condition');
  child.series.question = 'SECRET conditioned question';
  child.series.conditionedOn = { seriesId: 'shared_reading', answerKey: 'ward' };
  head = await revise(service, head, seriesChange(await definitionOf(service, head), child), 'yes.private.condition');
  const grandchild = effortReadings('hidden_grandchild');
  grandchild.series.question = 'SECRET second condition';
  grandchild.series.conditionedOn = { seriesId: 'hidden_condition', answerKey: 'ward' };
  head = await revise(service, head, seriesChange(await definitionOf(service, head), grandchild), 'yes.private.grandchild');
  const model = await definitionOf(service, head);
  const publicCuts = model.meaning_model.normalized_cuts.filter((cut) => cut.id.startsWith('cut.series.shared_reading.')).map((cut) => ({ ...cut,
    id: cut.id.replace('shared_reading', 'public_reading'), question: 'Public allocation on the same Event',
    answers: cut.answers.map(({ refers_to, ...answer }) => answer),
  }));
  head = await revise(service, head, { reason: 'A public question on the same recorded stretches.', upsert: { normalized_cuts: publicCuts } }, 'yes.shared.public');
  const loaded = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  const compared = await compareFutures(service, { stageId: 'outbreak', accessScopes: scopes });
  assert.equal(loaded.series.length, 1);
  assert.equal(loaded.series[0].question, 'Public allocation on the same Event');
  assert.equal(loaded.series[0].readings.length, 2);
  assert.equal(compared.series.length, 1);
  for (const secret of ['SECRET', 'private.signal', 'hidden_condition', 'hidden_grandchild']) assert.ok(!JSON.stringify({ loaded, compared }).includes(secret), secret);
  const authorized = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: [...scopes, 'secret'] });
  assert.equal(authorized.series.length, 4, 'authorized readers retain the parent, both conditions and the shared public reading');
});

test('branch Cut readings honor the half-open fork boundary, retaining a moment at the cutoff', async (t) => {
  const { service, trunk } = await setup(t);
  const yes = (await forkStage(service, forecastStage(trunk))).branches.find((branch) => branch.key === 'yes');
  const input = effortReadings('ana_boundary');
  input.readings = [
    { start: 2023, end: 2025, weights: { ward: 0.1, clinic: 0.9 }, tag: 'source', why: 'Before the fork.' },
    { start: 2025, end: 2025, weights: { ward: 0.2, clinic: 0.8 }, tag: 'exploring', why: 'A reading at the cutoff.' },
    { start: 2025, end: 2026, weights: { ward: 0.3, clinic: 0.7 }, tag: 'exploring', why: 'The first year after the fork.' },
  ];
  await revise(service, yes.modelHash, seriesChange(await definitionOf(service, yes.modelHash), input), 'yes.boundary');
  const loaded = await loadFuture(service, { branch: { stageId: 'outbreak', key: 'yes' }, accessScopes: scopes });
  assert.deepEqual(loaded.series[0].readings.map(({ from, to }) => [from, to]), [[2025, 2025], [2025, 2026]]);
});

test('a series reworded in one branch is still compared as one series, with the wording difference shown', async (t) => {
  const { service, trunk } = await setup(t);
  const forked = await forkStage(service, forecastStage(trunk));
  const record = async (key, readings, id) => {
    const fork = forked.branches.find((branch) => branch.key === key).modelHash;
    return revise(service, fork, seriesChange(await definitionOf(service, fork), readings), id);
  };
  await record('yes', effortReadings(), 'yes.effort');
  const reworded = effortReadings();
  reworded.series.answers = [{ key: 'ward', meaning: 'the fever ward, nights included' }, { key: 'clinic', meaning: 'ordinary clinic' }];
  await record('no', reworded, 'no.effort');
  const compared = await compareFutures(service, { stageId: 'outbreak', accessScopes: scopes });
  assert.equal(compared.series.length, 1, 'one series, not two');
  assert.ok(compared.series[0].wordingDiffers);
  assert.deepEqual(Object.values(compared.series[0].branches).map((branch) => branch.readings.length), [2, 2]);
  assert.deepEqual(compared.seriesAsymmetries, []);
});
