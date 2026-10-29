import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { AlienAddon } from '../src/alien-addon.mjs';
import { findTargetLeaks } from '../src/alien-search.mjs';
import { drawSeeds, eventTimes, explainRunError, measureValue, RUN_LIMITS, runModel, summarise, withRunEngine, worldDefinition } from '../src/alien-runs.mjs';
import { flow } from './alien-baseline-flow.mjs';
import { C, geyserWorld, geyserWorldModel, lonelinessScenario, proc } from './fixtures/geyser-world.mjs';

const scopes = ['author'];
const problem = { statement: 'How do we end loneliness in a big city where nobody has time and talking to strangers feels unsafe?', targetTerms: ['loneliness', 'lonely', 'city', 'strangers'] };

async function setup(t, startExtra = {}) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest);
  const addon = new AlienAddon(service);
  const started = await addon.startSearch({ requestId: 'start', modelHash, graphId: 'alien-lonely', searchId: 'search.lonely', title: 'Company',
    problem, authorId: 'tester', accessScopes: scopes, ...startExtra });
  let graphHash = started.graphHash; let count = 0;
  const base = () => ({ graphHash, searchRootId: 'search.lonely', accessScopes: scopes, authorId: 'tester' });
  const task = async (role, inputs = {}) => { count += 1; const prepared = await addon.task({ ...base(), requestId: `t${count}`, role, inputs }); graphHash = prepared.graphHash; return prepared; };
  const record = async (nodeId, kind, data, taskNodeId = null) => {
    const stored = await addon.record({ ...base(), requestId: `r.${nodeId}`, nodeId, kind, data, taskNodeId }); graphHash = stored.graphHash; return stored;
  };
  const builder = await task('builder', { seedWord: 'geyser' });
  await record('world.geyser', 'world', geyserWorld, builder.taskNodeId);
  return { service, addon, started, task, record, base: () => base() };
}

test('with world modelling off, every role\'s task text is exactly as it was before world modelling', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/alien-tasks-0.16.0.json', import.meta.url), 'utf8'));
  const texts = await flow({ LifeSimulationService, AlienAddon, root: fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/u, ''), startExtra: { worldModelling: 'off' } });
  assert.deepEqual(Object.keys(texts), Object.keys(baseline));
  for (const role of Object.keys(baseline)) assert.equal(texts[role], baseline[role], `${role} task text changed with modelling off`);
});

test('a world model runs through the service: the geyser vent erupts on a steady cycle', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const worldModel = geyserWorldModel('world.geyser');
  const { samples } = await runModel(service, { definition: worldDefinition(worldModel, 'world.geyser', 'The geyser world'),
    observables: worldModel.observables, plan: worldModel.run, seed: 'geyser', requestPrefix: 'geyser' });
  const times = eventTimes(samples, 'vent.eruptions');
  assert.equal(times.length, 6);
  const intervals = times.slice(1).map((time, index) => time - times[index]);
  for (const interval of intervals) assert.ok(Math.abs(interval - 15.45) < 0.11, `interval ${interval}`);
  assert.equal(measureValue(samples, { kind: 'eventCount', process: 'vent.eruptions', after: 0 }), 6);
  const [stored] = summarise(samples, ['vent.stored']);
  assert.ok(stored.max >= 10 && stored.max < 10.2, 'charge reaches the threshold and no further');
});

test('world modelling is on by default: a world is modelled and run before anyone solves in it', async (t) => {
  const { started, task, record } = await setup(t);
  assert.equal(started.worldModelling, 'on');
  await assert.rejects(task('solver', { worldNodeId: 'world.geyser' }), /World modelling is on for this search: prepare a world_modeller task/);

  // The modeller is target-blind and sees the world's rules and the engine's vocabulary, never the problem.
  const modeller = await task('world_modeller', { worldNodeId: 'world.geyser' });
  assert.equal(modeller.targetBlind, true);
  assert.equal(modeller.recordAs, 'world_model');
  assert.deepEqual(findTargetLeaks(modeller.text, started.targetTerms), []);
  for (const pattern of [/R2: The quiet after a discharge/, /THE ENGINE'S VOCABULARY/, /calculation office/, /decline/]) assert.match(modeller.text, pattern);

  // A model the engine refuses is refused with the engine's message; a bad rule map is refused before the engine runs.
  const broken = geyserWorldModel('world.geyser');
  broken.laws = [...broken.laws, { id: 'bad', operator: { role: 'evolution', target: 'missing.process', derivative: { op: 'constant', value: 1 } }, provenance: ['x'] }];
  await assert.rejects(record('model.broken', 'world_model', broken, modeller.taskNodeId), /missing\.process/);
  // The slips a writer of JSON makes most are named with their paths before the engine sees the model.
  for (const pattern of [/"greater_than"/, /Plain numbers, never expressions: a trigger's threshold, clamp's minimum and maximum/]) assert.match(modeller.text, pattern);
  const slips = geyserWorldModel('world.geyser');
  slips.laws[1].operator.derivative = { op: 'clamp', value: { op: 'constant', value: 1 }, minimum: { op: 'constant', value: 0 }, maximum: 1 };
  slips.laws[2].operator.trigger.comparison = 'greater';
  await assert.rejects(record('model.slips', 'world_model', slips, modeller.taskNodeId),
    /laws\[1\] \(vent-calm\)\.operator\.derivative: clamp's minimum and maximum are plain numbers[\s\S]*laws\[2\] \(vent-erupt\)\.operator\.trigger\.comparison: one of greater_or_equal/);
  // Two laws that set one process on the same trigger are refused before the engine, by name.
  const clash = geyserWorldModel('world.geyser');
  clash.laws = [...clash.laws, { ...clash.laws[2], id: 'vent-erupt-twice' }];
  await assert.rejects(record('model.clash', 'world_model', clash, modeller.taskNodeId), /vent-erupt and vent-erupt-twice both set vent\.quiet on the same trigger/);
  assert.match(modeller.text, /Before you answer, check your JSON:/);
  const badMap = geyserWorldModel('world.geyser'); badMap.ruleMap[0].ruleId = 'R9';
  await assert.rejects(record('model.badmap', 'world_model', badMap, modeller.taskNodeId), /R9, which are not rules/);

  // A valid model is run: the vent erupts every 15.45 days, six times in the 90-day plan.
  const stored = await record('model.geyser', 'world_model', geyserWorldModel('world.geyser'), modeller.taskNodeId);
  assert.match(stored.nextStep, /Prepare a solver_frame task with worldNodeId world\.geyser and worldModelNodeId model\.geyser/);
  await assert.rejects(task('solver', { worldNodeId: 'world.geyser' }), /prepare a solver_frame task/);
  const frame = await task('solver_frame', { worldNodeId: 'world.geyser', worldModelNodeId: 'model.geyser' });
  for (const pattern of [/THE MODEL:/, /vent-erupt: when vent\.stored ≥ 10 \(once, on crossing\)/, /vent\.eruptions: .*6 events, every 15\.45 on average/,
    /PROBLEM: How do we end loneliness/, /each made of named parts/]) assert.match(frame.text, pattern);
  for (const word of ['ontology', 'transfer', 'compile', 'curator']) assert.ok(!frame.text.toLowerCase().includes(word), `solver_frame mentions ${word}`);
});

test('a declined world stays text only, and the plain solver task is allowed for it', async (t) => {
  const { task, record } = await setup(t);
  const modeller = await task('world_modeller', { worldNodeId: 'world.geyser' });
  const declined = await record('model.declined', 'world_model', { worldNodeId: 'world.geyser', decline: { reason: 'Its physics is a state of existence, not an amount.' },
    isolation: { modeller: 'fresh_context' } }, modeller.taskNodeId);
  assert.match(declined.nextStep, /The modeller declined: prepare the solver task/);
  await assert.rejects(task('solver_frame', { worldNodeId: 'world.geyser', worldModelNodeId: 'model.declined' }), /declined/);
  const solver = await task('solver', { worldNodeId: 'world.geyser' });
  assert.doesNotMatch(solver.text, /WHAT THE WORLD'S MODEL SHOWED/);
});

test('the solver sets the problem in the model; every intervention runs whole and without each part, and the runs reach the solver and compiler', async (t) => {
  const { task, record, addon, base, started } = await setup(t);
  const modeller = await task('world_modeller', { worldNodeId: 'world.geyser' });
  await record('model.geyser', 'world_model', geyserWorldModel('world.geyser'), modeller.taskNodeId);
  const frame = await task('solver_frame', { worldNodeId: 'world.geyser', worldModelNodeId: 'model.geyser' });
  const badMeasure = lonelinessScenario('model.geyser'); badMeasure.measure.counters = ['p0.eruptions', 'nobody.eruptions'];
  await assert.rejects(record('scenario.bad', 'scenario', badMeasure, frame.taskNodeId), /The measure names processes the scenario does not have: nobody\.eruptions/);
  // An intervention's own processes may be observed, but the measure must be readable in every run.
  const partMeasure = lonelinessScenario('model.geyser'); partMeasure.measure = { kind: 'eventCount', process: 'table.suppers', after: 100, better: 'higher', meaning: 'suppers held' };
  await assert.rejects(record('scenario.partmeasure', 'scenario', partMeasure, frame.taskNodeId), /The measure names processes the scenario does not have: table\.suppers/);
  const observed = lonelinessScenario('model.geyser'); observed.observables = ['p0.eruptions', 'table.suppers'];
  const scenario = await record('scenario.lonely', 'scenario', observed, frame.taskNodeId);
  assert.match(scenario.nextStep, /Prepare the solver task with worldNodeId world\.geyser and scenarioNodeId scenario\.lonely/);

  // Four runs: the scenario, the table whole, and the table without each of its two parts. Only the whole table gives company.
  const solver = await task('solver', { worldNodeId: 'world.geyser', scenarioNodeId: 'scenario.lonely' });
  const company = (runId) => Number(solver.text.split('\n').find((line) => line.startsWith(`- ${runId} (`)).split('): ').at(-1).split(' ')[0]);
  assert.ok(Math.abs(company('scenario') - 0.35) < 0.02, 'without a table about a third of bursts have company');
  assert.equal(company('intervention:table'), 1, 'with the whole table every burst has company');
  assert.ok(Math.abs(company('ablation:table/pool') - 0.35) < 0.02, 'without the pooled pledges nothing changes');
  assert.ok(Math.abs(company('ablation:table/discharge') - 0.35) < 0.02, 'suppers that do not discharge everyone change nothing');
  assert.match(solver.text, /Cite the runs you rely on by their ids/);
  assert.match(solver.text, new RegExp(`Each run was drawn ${RUN_LIMITS.draws} times`));
  for (const pattern of [/conflicting set effects/, /the measure itself must use processes the scenario already has/, /run \{horizon \(time units, at most 400\), stepSize \(at most 1\)\} or null/,
    /a run plan lasts at most 400 time units/]) assert.match(frame.text, pattern);
  for (const pattern of [/ruleId: one of the rule ids recorded above, lawIds: at most 20/, /names one of the world's rules by its recorded id/, /a run plan lasts at most 400 time units/]) assert.match(modeller.text, pattern);
  for (const word of ['ontology', 'transfer', 'compile', 'curator']) assert.ok(!solver.text.toLowerCase().includes(word), `solver mentions ${word}`);

  await assert.rejects(record('solve.badrun', 'solution', { worldNodeId: 'world.geyser', text: 'x', runIds: ['intervention:none'], isolation: { solver: 'fresh_context' } }, solver.taskNodeId), /intervention:none are not runs/);
  await record('solve.lonely', 'solution', { worldNodeId: 'world.geyser', text: 'Hold sealed suppers that discharge the whole table at once (R1, R2; intervention:table).',
    citedRuleIds: ['R1', 'R2'], runIds: ['intervention:table', 'ablation:table/discharge'], isolation: { solver: 'fresh_context' } }, solver.taskNodeId);
  const compiler = await task('compiler', { worldNodeId: 'world.geyser', solutionNodeId: 'solve.lonely' });
  assert.match(compiler.text, /WHAT THE WORLD'S MODEL SHOWED/);
  assert.match(compiler.text, /Keep the part the runs show doing the work/);

  // The diagnosis and the atlas report the model and the scenario.
  const { graphHash, searchRootId, accessScopes } = base();
  const read = { graphHash, searchRootId, accessScopes };
  const { diagnosis } = await addon.diagnose(read);
  assert.deepEqual(diagnosis.worldModelling, { on: true, modelled: ['world.geyser'], declined: [], textOnly: [], scenarios: 1, unframed: [] });
  const { markdown } = await addon.atlas(read);
  for (const pattern of [/World model \(model\.geyser\): 3 processes and 3 laws/, /Scenario \(scenario\.lonely\)/, /runs cited: intervention:table, ablation:table\/discharge/]) assert.match(markdown, pattern);

  // A world exported with its model brings it into another search, where it is run again and can be framed at once.
  const { library } = await addon.exportWorlds(read);
  assert.equal(library.worlds[0].model.processes.length, 3);
  const second = await addon.startSearch({ requestId: 'start2', modelHash: started.modelHash, graphId: 'alien-second', searchId: 'search.second', title: 'Again',
    problem, authorId: 'tester', accessScopes: scopes });
  const imported = await addon.importWorlds({ graphHash: second.graphHash, requestId: 'import', searchRootId: 'search.second', authorId: 'tester', accessScopes: scopes, library });
  assert.equal(imported.imported[0].modelled, true);
  assert.match(imported.nextStep, /solver_frame tasks for the imported worlds that brought a model/);
  const reframed = await addon.task({ graphHash: imported.graphHash, requestId: 'frame2', searchRootId: 'search.second', authorId: 'tester', accessScopes: scopes,
    role: 'solver_frame', inputs: { worldNodeId: 'lib.world.geyser', worldModelNodeId: 'lib.world.geyser.model' } });
  assert.match(reframed.text, /vent\.eruptions: .*6 events, every 15\.45 on average/);
});

test('an engine refusal for a run that records too much is put in terms a modeller can act on', () => {
  const engine = new Error('Life Simulation Rust operation roll_world failed (invalid_request): session candidate bytes would exceed 134217728; export the result and start a new bounded session');
  assert.match(explainRunError(engine).message, /shorten the run plan's horizon, use a larger stepSize, or record fewer observables/);
  const other = new Error('law x requires nonempty provenance');
  assert.equal(explainRunError(other), other, 'other engine messages pass through unchanged');
});

// A counter that ticks at random: the draws of a run depend only on its model, plan and seed.
test('a run replays exactly from its model, plan and seed, and each draw seed draws anew', async () => {
  const model = { timeUnit: 'day', processes: [proc('arrivals', 'arrivals so far', 0)],
    laws: [{ id: 'arrive', operator: { role: 'occurrence', trigger: { kind: 'hazard', rate: C(0.5) }, effects: [{ target: 'arrivals', mode: 'add', value: C(1) }] }, provenance: ['random arrivals'] }] };
  const definition = worldDefinition(model, 'world.random', 'Random arrivals');
  const roll = (seed) => withRunEngine((engine) => runModel(engine, { definition, observables: ['arrivals'], plan: { horizon: 60, stepSize: 0.1 }, seed, requestPrefix: `r.${seed}` }))
    .then(({ samples }) => eventTimes(samples, 'arrivals').join(','));
  const seeds = drawSeeds('scenario.x');
  assert.deepEqual(seeds, ['scenario.x', 'scenario.x.draw1', 'scenario.x.draw2', 'scenario.x.draw3', 'scenario.x.draw4']);
  const [first, again, other] = await Promise.all([roll(seeds[0]), roll(seeds[0]), roll(seeds[1])]);
  assert.ok(first.length > 0, 'the counter ticks');
  assert.equal(again, first, 'the same seed replays the same draw');
  assert.notEqual(other, first, 'another seed draws differently');
});

test('the largest scenario runs 13 times, each in a stateless engine of its own, and leaves no world in the search\'s service', async (t) => {
  const { task, record, service, base, addon } = await setup(t);
  const modeller = await task('world_modeller', { worldNodeId: 'world.geyser' });
  await record('model.geyser', 'world_model', geyserWorldModel('world.geyser'), modeller.taskNodeId);
  const frame = await task('solver_frame', { worldNodeId: 'world.geyser', worldModelNodeId: 'model.geyser' });
  const scenario = lonelinessScenario('model.geyser');
  const table = scenario.interventions[0];
  const rename = (value, suffix) => JSON.parse(JSON.stringify(value).replace(/"(table-[a-z]+)"/gu, `"$1-${suffix}"`));
  scenario.interventions = ['a', 'b', 'c'].map((suffix) => ({ id: suffix, label: `table ${suffix}`,
    parts: [...rename(table.parts, suffix), { id: 'head-start', label: 'one person starts charged', overrides: [{ processId: 'p0.stored', value: 5 }] }] }));
  await record('scenario.max', 'scenario', scenario, frame.taskNodeId);
  const { graphHash, searchRootId, accessScopes } = base();
  const { markdown } = await addon.atlas({ graphHash, searchRootId, accessScopes });
  const runLines = markdown.split('\n').filter((line) => /^- (scenario|intervention:|ablation:)/u.test(line));
  assert.equal(runLines.length, 13, 'the scenario, three interventions, and each without each of its three parts');
  const { readSearch } = await import('../src/alien-search.mjs');
  const stored = (await readSearch(service, { graphHash, searchRootId, accessScopes })).record('scenario.max', 'scenario');
  for (const run of stored.data.runs) assert.equal(run.draws.length, RUN_LIMITS.draws, `${run.runId} is drawn ${RUN_LIMITS.draws} times`);
  assert.equal(service.worlds.size, 0, 'runs never create worlds in the search\'s own service');
});

test('a stateless engine process is not given the state file', () => {
  const previous = process.env.LIFE_SIM_STATE_FILE;
  process.env.LIFE_SIM_STATE_FILE = '/tmp/should-not-be-used.sqlite';
  try {
    assert.equal(new RustEngineProcess({ stateless: true }).childEnvironment.LIFE_SIM_STATE_FILE, undefined);
    assert.equal(new RustEngineProcess().childEnvironment.LIFE_SIM_STATE_FILE, '/tmp/should-not-be-used.sqlite');
  } finally {
    if (previous === undefined) delete process.env.LIFE_SIM_STATE_FILE; else process.env.LIFE_SIM_STATE_FILE = previous;
  }
});
