import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { compareFutures, forkStage, loadFuture } from '../src/futures.mjs';
import { seriesChange } from '../src/series-record.mjs';

const provenance = ['conditional series comparison test'];
const metadata = { authority: null, uncertainty: { kind: 'unknown' }, provenance };
const scopes = ['author'];
const event = (id, start, end, participants = {}) => ({ id, boundary: id, interval: { start, end }, participants,
  process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance });
const contains = (source, target) => ({ id: `${source}.${target}`, kind: 'contains', source_event_id: source,
  target_event_id: target, description: 'Inside this context.', ...metadata });
const definitionOf = async (service, modelHash) => (await service.inspectModel({ modelHash, includeDefinition: true })).model;
async function revise(service, modelHash, change, requestId) {
  return (await service.reviseModel({ requestId, previousModelHash: modelHash,
    model: applyModelChange(await definitionOf(service, modelHash), modelHash, change).successor })).modelHash;
}
async function fixture(t, seedSeries = false) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  let { modelHash } = await service.registerModel({ requestId: 'series-world', model: {
    schema: 'life-sim-rust-model/v1', id: 'series-world', time_unit: 'year',
    revision: { number: 0, reason: 'Compare clinical work under different assumptions.', provenance },
    processes: [{ id: 'work', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, update_mode: 'observed', unit: 'fraction',
      uncertainty: { kind: 'unknown' }, provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1',
      referents: [{ id: 'ana', boundary: 'Ana, a doctor', continuity_criterion: 'Same person', lifecycle_event_id: 'ana.life', interval: null, ...metadata }],
      events: [event('world', 0, 10), event('ana.life', 0, 10, { subject: 'ana' }), event('outbreak', 1, 1.1), event('fair', 1, 1.1)],
      event_relations: [contains('world', 'ana.life'), contains('world', 'outbreak'), contains('world', 'fair')],
      context_roots: [{ event_id: 'world', kind: 'accepted_world', provenance }] },
  } });
  if (seedSeries) {
    modelHash = await record(service, modelHash, input('effort'), 'trunk.parent');
    modelHash = await record(service, modelHash, input('opened', 'effort'), 'trunk.child');
    modelHash = await record(service, modelHash, input('detail', 'opened'), 'trunk.grandchild');
  }
  const { branches } = await forkStage(service, { requestId: 'series-fork', stageId: 'work', title: 'Clinical work',
    trunkModelHash: modelHash, kind: 'assumption', cutoff: 1, horizon: 10,
    branches: ['a', 'b'].map((key) => ({ key, premise: { boundary: `Work under assumption ${key}`, description: `Explore ${key}.`, interval: { start: 1, end: 2 } } })),
    agentId: 'author', accessScopes: scopes });
  return { service, branches };
}
function input(id, parent = null) {
  return { reason: 'Follow clinical work.', subject: 'ana',
    series: { id, question: `How is ${id} divided?`, unit: 'one unit of effort',
      answers: [{ key: 'ward', meaning: 'fever ward' }, { key: 'clinic', meaning: 'ordinary clinic' }],
      ...(parent ? { conditionedOn: { seriesId: parent, answerKey: 'ward' } } : {}) },
    readings: [{ start: 2, end: 4, weights: { ward: 0.8, clinic: 0.2 }, tag: 'exploring', why: 'More ward work.' },
      { start: 4, end: 6, weights: { ward: 0.3, clinic: 0.7 }, tag: 'exploring', why: 'More clinic work.' }] };
}
async function record(service, head, series, requestId) {
  return revise(service, head, seriesChange(await definitionOf(service, head), series), requestId);
}

test('conditional comparison preserves all ancestor meanings and flags rewording across branches without splitting the series', async (t) => {
  const { service, branches } = await fixture(t);
  for (const branch of branches) {
    const parent = input('effort');
    parent.series.answers[0].meaning = branch.key === 'a' ? 'fever ward' : 'ordinary outpatient clinic';
    parent.series.answers[0].refersTo = { kind: 'event', id: 'outbreak' };
    let head = await record(service, branch.modelHash, parent, `${branch.key}.parent`);
    head = await record(service, head, input('opened', 'effort'), `${branch.key}.child`);
    await record(service, head, input('detail', 'opened'), `${branch.key}.grandchild`);
  }
  const result = await compareFutures(service, { stageId: 'work', accessScopes: scopes });
  for (const question of ['How is opened divided?', 'How is detail divided?']) {
    const matching = result.series.filter((series) => series.question === question);
    assert.equal(matching.length, 1, 'rewording alone keeps a series comparable');
    const series = matching[0];
    assert.match(series.wordingDiffers, /conditioning definitions differ/u);
    for (const key of ['a', 'b']) {
      assert.equal(series.branches[key].readings.length, 2);
      const ancestor = series.branches[key].readings[0].conditioningChain.at(-1);
      assert.equal(ancestor.answer.meaning, key === 'a' ? 'fever ward' : 'ordinary outpatient clinic');
      assert.deepEqual(ancestor.answer.refers_to, { kind: 'event', event_id: 'outbreak' });
    }
  }
  assert.equal(result.seriesAsymmetries.length, 0);
});

test('conditional readings keep ancestor meanings at each time and flag revisions within a branch', async (t) => {
  const { service, branches } = await fixture(t);
  let head = await record(service, branches[0].modelHash, input('effort'), 'within.parent');
  head = await record(service, head, input('opened', 'effort'), 'within.child');
  const model = await definitionOf(service, head);
  const parent = model.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.series.effort.4-6');
  await revise(service, head, { reason: 'Clarify the later category.', upsert: { normalized_cuts: [
    { ...parent, answers: parent.answers.map((answer) => answer.key === 'ward' ? { ...answer, meaning: 'outpatient clinic' } : answer) },
  ] } }, 'within.reword');
  const loaded = await loadFuture(service, { branch: { stageId: 'work', key: 'a' }, accessScopes: scopes });
  const local = loaded.series.find((series) => series.question === 'How is opened divided?');
  assert.equal(local.wordingDiffers, true);
  assert.deepEqual(local.readings.map((reading) => reading.conditioningChain[0].answer.meaning), ['fever ward', 'outpatient clinic']);
  const result = await compareFutures(service, { stageId: 'work', accessScopes: scopes });
  assert.match(result.series.find((series) => series.question === local.question).wordingDiffers, /conditioning definitions differ/u);
});

test('different answer references, direct or inherited, stay separate even when keys and wording match', async (t) => {
  const { service, branches } = await fixture(t);
  for (const branch of branches) {
    const parent = input('effort');
    parent.series.answers[0].refersTo = { kind: 'event', id: branch.key === 'a' ? 'outbreak' : 'fair' };
    let head = await record(service, branch.modelHash, parent, `${branch.key}.ref.parent`);
    head = await record(service, head, input('opened', 'effort'), `${branch.key}.ref.child`);
    await record(service, head, input('detail', 'opened'), `${branch.key}.ref.grandchild`);
  }
  const result = await compareFutures(service, { stageId: 'work', accessScopes: scopes });
  for (const question of ['How is effort divided?', 'How is opened divided?', 'How is detail divided?']) {
    const groups = result.series.filter((series) => series.question === question);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((series) => Object.entries(series.branches).filter(([, branch]) => branch.readings.length).map(([key]) => key)), [['a'], ['b']]);
    assert.equal(result.seriesAsymmetries.filter((series) => series.question === question).length, 2);
  }
  const child = result.series.find((series) => series.question === 'How is detail divided?');
  assert.deepEqual(child.conditioning.at(-1).answerReferences, [{ key: 'ward', refersTo: { kind: 'event', event_id: 'outbreak' } }]);
  assert.deepEqual(child.branches.a.readings[0].conditioningChain.at(-1).answer.refers_to, { kind: 'event', event_id: 'outbreak' });
});

test('revising only an ancestor includes inherited conditional readings in the branch comparison', async (t) => {
  const { service, branches } = await fixture(t, true);
  for (const branch of branches) {
    const model = await definitionOf(service, branch.modelHash);
    const parent = model.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.series.effort.2-4');
    await revise(service, branch.modelHash, { reason: 'Revise only the ancestor definition.', upsert: { normalized_cuts: [
      { ...parent, answers: parent.answers.map((answer) => answer.key === 'ward'
        ? { ...answer, meaning: branch.key === 'a' ? 'ward care' : 'outpatient care' } : answer) },
    ] } }, `${branch.key}.ancestor.only`);
  }
  const loaded = await loadFuture(service, { branch: { stageId: 'work', key: 'a' }, accessScopes: scopes });
  const result = await compareFutures(service, { stageId: 'work', accessScopes: scopes });
  for (const question of ['How is opened divided?', 'How is detail divided?']) {
    const local = loaded.series.find((series) => series.question === question);
    assert.equal(local?.readings.length, 1, 'the affected inherited reading is included; unaffected readings are omitted');
    assert.equal(local.readings[0].conditioningChain.at(-1).answer.meaning, 'ward care');
    const series = result.series.find((series) => series.question === question);
    assert.match(series.wordingDiffers, /conditioning definitions differ/u);
    assert.equal(series.branches.a.readings[0].conditioningChain.at(-1).answer.meaning, 'ward care');
    assert.equal(series.branches.b.readings[0].conditioningChain.at(-1).answer.meaning, 'outpatient care');
  }
});
