import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageSummary, timeSchedule, valuesChange, valuesReport } from '../src/values-record.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { projectScalarSeries } from '../src/viewer-scalar-series.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { LifeSimulationService } from '../src/service.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const base = () => ({
  schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year', revision: { number: 0, previous_model_hash: null, reason: 'r', provenance: ['p'] },
  processes: [{ id: 'pop', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 100 } }, initial_value: { kind: 'scalar', value: 1 }, provenance: ['sketch'], support: ['s'],
    unit: 'billion', scale: { semantic_role: 'Population: billion people', aggregate: 'sum' } }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
});
const HASH = 'a'.repeat(64);

test('values for an existing process go into the model as one series, merged by time', () => {
  let model = base();
  let change = valuesChange(model, { holder: 'claude', reason: 'first', values: [{ processId: 'pop', points: [{ time: 1800, value: 1, tag: 'inferred' }, { time: 1900, value: 1.6, tag: 'inferred' }] }] });
  model = applyModelChange(model, HASH, change).successor;
  assert.equal(model.value_series.length, 1);
  assert.deepEqual(model.value_series[0].points.map((p) => p.time), [1800, 1900]);
  change = valuesChange(model, { holder: 'claude', reason: 'better', values: [{ processId: 'pop', points: [{ time: 1900, value: 1.65, lower: 1.6, upper: 1.7, tag: 'source' }, { time: -10000, value: 0.004, tag: 'sketch' }] }] });
  model = applyModelChange(model, HASH, change).successor;
  assert.deepEqual(model.value_series[0].points.map((p) => [p.time, p.value]), [[-10000, 0.004], [1800, 1], [1900, 1.65]]);
});

test('a call can open new processes under a parent, and the report finds empty processes and contradictions', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'pop', points: [{ time: 1900, value: 1.65, lower: 1.6, upper: 1.7, tag: 'inferred' }] },
    { processId: 'pop.africa', process: { label: 'Africa', unit: 'billion', parent: 'pop' }, points: [{ time: 1900, value: 0.1, tag: 'sketch' }] },
    { processId: 'pop.asia', process: { label: 'Asia', unit: 'billion', parent: 'pop' }, points: [{ time: 1900, value: 1.9, tag: 'sketch' }] },
  ] })).successor;
  assert.equal(model.processes.length, 3);
  assert.equal(model.decomposition.length, 2);
  const report = valuesReport(model);
  assert.equal(report.stillEmptyCount, 0);
  assert.equal(report.contradictionCount, 1);
  assert.equal(report.contradictions[0].process, 'pop');
  // Parts that fall short of a sum leave a residual, not a contradiction.
  const short = structuredClone(model); short.value_series.find((x) => x.process_id === 'pop.asia').points[0].value = 0.9;
  assert.equal(valuesReport(short).contradictionCount, 0);
  assert.equal(valuesReport(short).residualCount, 1);
  model.processes.push({ ...model.processes[1], id: 'pop.europe' });
  assert.deepEqual(valuesReport(model).stillEmpty, ['pop.europe']);
});

test('a new process needs its definition, and a band has both ends and surrounds the value', () => {
  assert.throws(() => valuesChange(base(), { holder: 'c', reason: 'r', values: [{ processId: 'x', points: [{ time: 1, value: 1, tag: 'sketch' }] }] }), /not a process/);
  assert.throws(() => valuesChange(base(), { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [{ time: 1, value: 5, lower: 6, upper: 7, tag: 'sketch' }] }] }), /surround/);
  assert.throws(() => valuesChange(base(), { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [{ time: 1, value: 2, lower: 1, tag: 'sketch' }] }] }), /both lower and upper/);
  const unitless = base(); delete unitless.processes[0].unit;
  assert.throws(() => valuesChange(unitless, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [{ time: 1, value: 1, tag: 'sketch' }] }] }), /unit/);
});

test('the viewer draws a value series as one curve per process, labelled by name', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [{ processId: 'pop', points: [
    { time: -300000, value: 0.0003, tag: 'sketch' }, { time: 1800, value: 1, tag: 'inferred' }, { time: 2025, value: 8.2, tag: 'source' }] }] })).successor;
  const series = projectScalarSeries(model, { modelHash: HASH });
  assert.equal(series.length, 1);
  assert.equal(series[0].label, 'Population');
  assert.equal(series[0].points.length, 3);
});

test('a process can hold defined states, from a go-to set or its own', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'state.rome', process: { label: 'The Roman state', preset: 'phase', parent: 'pop' }, points: [
      { time: -500, state: 'emerging', tag: 'inferred' }, { time: 100, state: 'established', tag: 'inferred' }, { time: 476, state: 'gone', tag: 'inferred' }] },
    { processId: 'state.form', process: { label: 'Form of rule', states: [['republic', 'Rule by elected magistrates.'], ['empire', 'Rule by an emperor.']] }, points: [
      { time: -100, state: 'republic', tag: 'inferred' }, { time: 1, state: 'empire', tag: 'inferred' }] },
  ] })).successor;
  const rome = model.processes.find((p) => p.id === 'state.rome');
  assert.deepEqual(rome.value_type.variants, ['absent', 'emerging', 'growing', 'established', 'declining', 'gone']);
  assert.equal(rome.scale['state:gone'], 'Ended.');
  assert.equal(model.value_series.length, 2);
  assert.throws(() => valuesChange(model, { holder: 'claude', reason: 'r', values: [{ processId: 'state.rome', points: [{ time: 200, state: 'thriving', tag: 'sketch' }] }] }), /not one of its states/);
  assert.throws(() => valuesChange(model, { holder: 'claude', reason: 'r', values: [{ processId: 'state.rome', points: [{ time: 200, value: 3, tag: 'sketch' }] }] }), /state, not a number/);
});

test('a defined scale gives a soft process an honest number', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'capacity', process: { label: 'State capacity', scale: { minimum: 0, maximum: 10, anchors: [[0, 'no administration'], [5, 'taxes and courts reach most people'], [10, 'reaches every household']] } },
      points: [{ time: 1500, value: 3, lower: 2, upper: 4, tag: 'sketch' }, { time: 2000, value: 7, tag: 'sketch' }] }] })).successor;
  const p = model.processes.find((x) => x.id === 'capacity');
  assert.deepEqual(p.value_type.bounds, { minimum: 0, maximum: 10 });
  assert.equal(p.scale['anchor:5'], 'taxes and courts reach most people');
  assert.equal(p.unit, 'on a scale of 0 to 10');
  const [drawn] = projectScalarSeries(model, { modelHash: HASH });
  assert.deepEqual(drawn.anchors.map((a) => a.at), [0, 5, 10]);
});

test('the report says where to go next, down the tree of processes and the tree of time', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'pop', points: [{ time: -10000, value: 0.004, tag: 'sketch' }, { time: 1, value: 0.23, tag: 'sketch' }, { time: 1800, value: 1, tag: 'inferred' }, { time: 1900, value: 1.6, tag: 'inferred' }, { time: 2000, value: 6.1, tag: 'inferred' }] },
    { processId: 'pop.asia', process: { label: 'Asia', unit: 'billion', parent: 'pop' }, points: [{ time: 1800, value: 0.6, tag: 'sketch' }, { time: 2000, value: 3.7, tag: 'sketch' }] },
  ] })).successor;
  const report = valuesReport(model);
  assert.deepEqual(report.undivided.map((u) => u.process), ['pop.asia']);
  // Asia has no date inside 1800 to 2000 although the whole has 1900: the thinnest stretch compared with the rest.
  assert.deepEqual([report.coarsest[0].process, report.coarsest[0].from], ['pop.asia', 1800]);
  assert.ok(report.next.some((line) => /Open the processes never divided/.test(line)));
  // While a level of the time schedule is unfilled, the schedule says where to go in time; the coarsest stretches stay in the data.
  assert.ok(report.next.some((line) => /Fill the time schedule level by level/.test(line)));
  assert.ok(!report.next.some((line) => /coarsest stretches/.test(line)));
});

test('the viewer draws a process with defined states as held steps, named by state', async () => {
  const { typedScalarTrajectories } = await import('../viewer/public/scalar-trajectories.js');
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'printing', process: { label: 'Printing', preset: 'phase' }, points: [
      { time: 500, state: 'absent', tag: 'inferred' }, { time: 1450, state: 'growing', tag: 'inferred' }, { time: 1700, state: 'established', tag: 'inferred' }] }] })).successor;
  const series = projectScalarSeries(model, { modelHash: HASH });
  assert.equal(series.length, 1);
  assert.equal(series[0].interpolation.kind, 'step-hold');
  assert.deepEqual(series[0].points.map((p) => [p.v, p.state]), [[0, 'absent'], [2, 'growing'], [3, 'established']]);
  assert.equal(series[0].states[5].key, 'gone');
  const [row] = typedScalarTrajectories({ typedScalarSeries: series });
  assert.equal(row.interpolation.kind, 'step-hold');
});

test('a long calendar window is not padded into the future', async () => {
  const { temporalWindow } = await import('../viewer/public/temporal-layout.js');
  const w = temporalWindow({ timeUnit: 'year', typedScalarSeries: [{ points: [{ t: -300000 }, { t: 2025 }] }] });
  assert.ok(w.end <= 2027, `window ends at ${w.end}`);
  assert.ok(w.start < -300000);
});

test('series of different processes and holders never share an id, through the engine', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const process = (id) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1000 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'count',
    update_mode: 'observed', uncertainty: { kind: 'unknown' }, support: ['fixture'], provenance: ['fixture'], access_scopes: [] });
  let hash = (await service.registerModel({ requestId: 'values-ids-model', model: { schema: 'life-sim-rust-model/v1', id: 'values-ids', time_unit: 'year',
    revision: { number: 0, reason: 'Two processes whose ids differ by a period.', provenance: ['fixture'] }, processes: [process('x'), process('x.y')],
    initial_claims: [], decomposition: [], dependencies: [], laws: [] } })).modelHash;
  const record = async (processId, holder, time, value) => {
    const { model } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
    const { successor } = applyModelChange(model, hash, valuesChange(model, { holder, reason: 'r', values: [{ processId, points: [{ time, value, tag: 'sketch' }] }] }));
    hash = (await service.reviseModel({ requestId: `values-ids-${processId}-${holder}`, previousModelHash: hash, model: successor })).modelHash;
  };
  // Joined with a period, both would be values.x.y.modeler and the second would overwrite the first.
  await record('x.y', 'modeler', 2000, 42);
  await record('x', 'y.modeler', 2025, 99);
  const { model } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
  assert.deepEqual(model.value_series.map((s) => [s.process_id, s.holder, s.points.map((p) => [p.time, p.value])]).sort(),
    [['x', 'y.modeler', [[2025, 99]]], ['x.y', 'modeler', [[2000, 42]]]]);
  assert.equal(new Set(model.value_series.map((s) => s.id)).size, 2);
});

test('only parts in the parent\'s unit are added up; parts in other units or with states are named, not compared', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'pop', points: [{ time: 1900, value: 1.6, tag: 'inferred' }] },
    { processId: 'pop.asia', process: { label: 'Asia', unit: 'million', parent: 'pop' }, points: [{ time: 1900, value: 950, tag: 'sketch' }] },
    { processId: 'pop.trend', process: { label: 'Trend', preset: 'direction', parent: 'pop' }, points: [{ time: 1900, state: 'rising', tag: 'sketch' }] },
  ] })).successor;
  const report = valuesReport(model);
  assert.equal(report.contradictionCount, 0);
  assert.equal(report.residualCount, 0, '950 million is not a residual of 1.6 billion');
  assert.deepEqual(report.notCompared.map((n) => [n.child, n.why]), [['pop.asia', 'unit million is not billion'], ['pop.trend', 'not a number']]);
});

test('a process a law computes, or one with dated claims, is not reported as empty', () => {
  const model = base();
  model.processes.push({ ...model.processes[0], id: 'growth' }, { ...model.processes[0], id: 'pop.unknown' }, { ...model.processes[0], id: 'pop.claimed' });
  model.dependencies = [{ id: 'dep.growth', source: 'pop', target: 'growth', kind: 'causal', law_id: 'law.growth' }];
  model.initial_claims = [{ id: 'claim.census', subject: 'pop.claimed', value: { kind: 'scalar', value: 1.2 }, value_time: -100 }];
  assert.deepEqual(valuesReport(model).stillEmpty, ['pop', 'pop.unknown']);
});

test('a process opened with values says which value became its initial value', () => {
  const model = applyModelChange(base(), HASH, valuesChange(base(), { holder: 'claude', reason: 'r', values: [
    { processId: 'gdp', process: { label: 'Output', unit: 'trillion dollars' }, points: [{ time: 1500, value: 0.2, tag: 'sketch' }, { time: 2000, value: 60, tag: 'inferred' }] }] })).successor;
  const gdp = model.processes.find((p) => p.id === 'gdp');
  assert.equal(gdp.initial_value.value, 0.2);
  assert.ok(gdp.support.includes('initial value copied from the value recorded at 1500 (sketch), the date nearest time 0'), gdp.support.join('; '));
});

test('a defined scale is drawn over its declared range, and recorded values declare no evidence cutoff', async () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'capacity', process: { label: 'State capacity', scale: { minimum: 0, maximum: 10, anchors: [[0, 'none'], [10, 'everywhere']] } },
      points: [{ time: 1500, value: 3, tag: 'sketch' }, { time: 2000, value: 7, tag: 'sketch' }] }] })).successor;
  const [drawn] = projectScalarSeries(model, { modelHash: HASH });
  assert.deepEqual(drawn.scaleBounds, { minimum: 0, maximum: 10 });
  assert.ok(drawn.points.every((p) => p.evidenceCutoff === null));
  const { typedScalarTrajectories } = await import('../viewer/public/scalar-trajectories.js');
  const [row] = typedScalarTrajectories({ typedScalarSeries: [drawn] });
  assert.deepEqual(row.scaleBounds, { minimum: 0, maximum: 10 }, 'the drawn row keeps the declared range');
});

test('a process with one date is pointed to for a second, so it can show as a line', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'claude', reason: 'r', values: [
    { processId: 'pop', points: [{ time: 1800, value: 1, tag: 'inferred' }, { time: 1900, value: 1.6, tag: 'inferred' }] },
    { processId: 'pop.asia', process: { label: 'Asia', unit: 'billion', parent: 'pop' }, points: [{ time: 1900, value: 0.9, tag: 'sketch' }] }] })).successor;
  const report = valuesReport(model);
  assert.deepEqual(report.oneDate, ['pop.asia']);
  assert.ok(report.next.some((line) => /Give a second date to 1 process\(es\).*Asia/.test(line)));
});

test('a recorded value appears in the construction replay from the revision that recorded or replaced it', async () => {
  const first = base();
  const second = applyModelChange(first, 'a'.repeat(64), valuesChange(first, { holder: 'claude', reason: 'r', values: [
    { processId: 'pop', points: [{ time: 1800, value: 1, tag: 'inferred' }, { time: 1900, value: 1.6, tag: 'inferred' }] }] })).successor;
  const third = applyModelChange(second, 'b'.repeat(64), valuesChange(second, { holder: 'claude', reason: 'r', values: [
    { processId: 'pop', points: [{ time: 1900, value: 1.65, lower: 1.6, upper: 1.7, tag: 'source' }] }] })).successor;
  const data = await buildViewerData({ history: { models: [{ modelHash: 'a'.repeat(64), definition: first }, { modelHash: 'b'.repeat(64), definition: second },
    { modelHash: 'c'.repeat(64), definition: third }], revisions: [] } });
  const series = data.typedScalarSeries.find((s) => s.source.kind === 'value-series');
  assert.deepEqual(series.points.map((p) => [p.valueTime, p.born.rev]), [[1800, 1], [1900, 2]]);
});

test('a row of states is drawn as exact steps: a vertical change, and a brief state stays visible', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const context = { NX: 400, F: { w: 0 }, timeAtX: (x) => x }; vm.createContext(context);
  vm.runInContext(`${slice('const stepAt =', '\n')}\n${slice('function stateSampleTimes', 'function layRow')}\nthis.stepAt = stepAt; this.stateSampleTimes = stateSampleTimes;`, context);
  const held = [{ t: 0, v: 0 }, { t: 50, v: 1 }, { t: 100, v: 1 }];
  const times = context.stateSampleTimes({ points: held }, 0, 100, 0, 100);
  assert.equal(times.length, 400);
  const at = times.indexOf(50);
  assert.ok(at > 0 && 50 - times[at - 1] < 1e-4, 'the vertices around the change sit a hair apart, so the change is vertical');
  assert.deepEqual([context.stepAt(held, times[at - 1]), context.stepAt(held, times[at])], [0, 1]);
  assert.equal(context.stepAt(held, 49.8747), 0, 'the old state holds right up to the change');
  const brief = [{ t: 0, v: 0 }, { t: 50.01, v: 1 }, { t: 50.02, v: 0 }, { t: 100, v: 0 }];
  assert.ok(context.stateSampleTimes({ points: brief }, 0, 100, 0, 100).some((t) => context.stepAt(brief, t) === 1), 'a state held for a hundredth of a year is drawn');
  assert.match(source, /opt\.smoothing > 0 && !row\.measure\.states \?/, 'states are never smoothed');
});

test('a process opened before its parent is filed under it, never moved or put inside itself', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [
    { processId: 'people', process: { label: 'People', unit: 'billion', aggregate: 'sum' }, points: [{ time: 1900, value: 1.65, tag: 'sketch' }] },
    { processId: 'pop', process: { parent: 'people' } },
  ] })).successor;
  assert.deepEqual(model.decomposition.map((edge) => [edge.parent, edge.child]), [['people', 'pop']]);
  // Filing it again under the same parent changes nothing; another parent is a revision, and a part cannot hold its whole.
  const again = valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', process: { parent: 'people' }, points: [{ time: 1950, value: 2.5, tag: 'sketch' }] }] });
  assert.equal(again.upsert.decomposition, undefined);
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'world', process: { label: 'World', unit: 'billion' }, points: [{ time: 1900, value: 1.65, tag: 'sketch' }] }] })).successor;
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', process: { parent: 'world' } }] }), /already part of people/);
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'people', process: { parent: 'pop' } }] }), /part of it/);
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop' }] }), /give points/);
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'fresh', process: { label: 'Fresh', unit: 'x' } }] }), /at least one value/);
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'fresh', process: { unit: 'x' }, points: [{ time: 1, value: 1, tag: 'sketch' }] }] }), /give process \{label/);
});

test('many processes with nothing above them are pointed to a top and the dimensions of a carve', () => {
  let model = base();
  const loose = ['energy', 'gdp', 'co2', 'war'].map((id) => ({ processId: id, process: { label: id.toUpperCase(), unit: 'u' }, points: [{ time: 1900, value: 1, tag: 'sketch' }, { time: 2000, value: 2, tag: 'sketch' }] }));
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: loose })).successor;
  const report = valuesReport(model);
  assert.equal(report.rootCount, 5);
  assert.match(report.next.join('\n'), /5 processes have nothing above them/);
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [
    { processId: 'history', process: { label: 'History', unit: 'index' }, points: [{ time: 1900, value: 1, tag: 'sketch' }] },
    ...['pop', 'energy', 'gdp'].map((id) => ({ processId: id, process: { parent: 'history' } })),
  ] })).successor;
  assert.equal(valuesReport(model).rootCount, 3);
  assert.doesNotMatch(valuesReport(model).next.join('\n'), /nothing above them/);
});

test('a process with no value across a stretch where several of the model\'s Events happen is pointed to them', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [{ time: 1000, value: 0.3, tag: 'sketch' }, { time: 1900, value: 1.6, tag: 'sketch' }] }] })).successor;
  const event = (id, start) => ({ id, boundary: id, interval: { start, end: start + 1 }, process_ids: [], observation_process_ids: [], participants: {}, substrate: null, region: null, provenance: ['sketch: fixture'] });
  model.meaning_model = { schema: 'life-sim-rust-meaning-model/v1', events: [event('black death', 1347), event('printing', 1450), event('columbus', 1492), event('steam', 1776)] };
  let report = valuesReport(model);
  assert.equal(report.passedOverCount, 1);
  assert.deepEqual([report.passedOver[0].from, report.passedOver[0].to, report.passedOver[0].events], [1000, 1900, 4]);
  assert.match(report.next.join('\n'), /pop has none between 1000 and 1900, where 4 Events happen \(black death; printing; columbus\)/);
  // A value among them splits the stretch; fewer than three Events on each side is not pointed to.
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [{ time: 1460, value: 0.4, tag: 'sketch' }] }] })).successor;
  report = valuesReport(model);
  assert.equal(report.passedOverCount, undefined);
});

test('the time schedule divides a long span in log time and a short one evenly, each level nesting in the last', async () => {
  const { timeSchedule } = await import('../src/values-record.mjs');
  const deep = timeSchedule(-300000, 2026);
  assert.equal(deep.scale, 'log');
  assert.deepEqual(deep.levels.map((level) => level.boundaries.length), [2, 7, 19, 55]);
  assert.deepEqual(deep.levels[1].boundaries, [-300000, -60000, -12000, -1000, 1400, 1920, 2026]);
  for (let i = 1; i < deep.levels.length; i += 1) for (const t of deep.levels[i - 1].boundaries) assert.ok(deep.levels[i].boundaries.includes(t), `level ${i + 1} keeps ${t}`);
  const life = timeSchedule(1843, 1871);
  assert.equal(life.scale, 'even');
  assert.deepEqual(life.levels[1].boundaries, [1843, 1848, 1852, 1857, 1862, 1866, 1871]);
  assert.equal(timeSchedule(5, 5), null);
});

test('the report says which level of the schedule the processes have reached and what the next one lacks', () => {
  let model = base();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [
    { time: 1843, value: 1, tag: 'sketch' }, { time: 1871, value: 1.3, tag: 'sketch' }] }] })).successor;
  let report = valuesReport(model);
  assert.deepEqual([report.schedule.scale, report.schedule.reached, report.schedule.next.level, report.schedule.next.missing], ['even', 1, 2, 5]);
  assert.deepEqual(report.schedule.next.examples[0].at, [1848, 1852, 1857, 1862, 1866]);
  assert.deepEqual(report.schedule.later, [{ level: 3, missing: 17 }, { level: 4, missing: 53 }]);
  // The standing comes first, with one count of all that remains, taken at the finest level so it is never summed.
  assert.equal(report.schedule.remaining, 53);
  assert.match(report.next[0], /^By the coverage report's measure this pass is not done: the time schedule lacks 53 value\(s\) or reading\(s\) in all, counted at its finest level\. Go on with the pass/u);
  assert.match(report.next.join('\n'), /level 2 of 4 divides 1843 to 1871 into 6 blocks, and 1 record\(s\) still lack 5 value\(s\) or reading\(s\) at this level, such as pop at 1848, 1852, 1857, 1862, 1866\. In all, 53 remain, counted at the finest level\./u);
  assert.doesNotMatch(report.next.join('\n'), /level 3 needs|level 4 needs/u);
  // A value near a boundary counts for it, and filling a level moves the report to the next.
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: [1848, 1852.3, 1857, 1862, 1866].map((time) => ({ time, value: 1.1, tag: 'sketch' })) }] })).successor;
  report = valuesReport(model);
  assert.deepEqual([report.schedule.reached, report.schedule.next.level, report.schedule.next.missing], [2, 3, 12]);
});

test('the report says what the values just recorded show: a peak, a trough, the steepest change', () => {
  let model = base();
  const points = [[1300, 0.45], [1350, 0.25], [1400, 0.5], [1600, 0.55], [1800, 1], [1900, 1.6]].map(([time, value]) => ({ time, value, tag: 'sketch' }));
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points }] })).successor;
  const report = valuesReport(model, { focus: ['pop'] });
  assert.deepEqual(report.shows.map((item) => [item.kind, item.at ?? item.from]), [['rise', 1800], ['trough', 1350]]);
  assert.match(report.next[0], /^By the coverage report's measure this pass is not done/u);
  assert.match(report.next[1], /^What your new values show: pop rises most between 1800 and 1900 \(1 to 1\.6\); pop bottoms out at 1350 \(0\.25\) and turns\./u);
  // Only the processes a call recorded are described.
  assert.equal(valuesReport(model).shows, undefined);
});

test('the report says done once the schedule is filled, no process is empty and none passes over the Events', async () => {
  const { timeSchedule } = await import('../src/values-record.mjs');
  let model = base();
  const times = timeSchedule(1843, 1871).levels.at(-1).boundaries;
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', points: times.map((time, i) => ({ time, value: 1 + i / 100, tag: 'sketch' })) }] })).successor;
  let report = valuesReport(model);
  assert.equal(report.done, true);
  assert.match(report.next.join('\n'), /This pass is done by the coverage report's measure/u);
  // An empty process keeps it open.
  model.processes.push({ ...model.processes[0], id: 'pop.empty' });
  report = valuesReport(model);
  assert.equal(report.done, false);
});

test('done needs the whole span: one value per process is not a filled schedule, a Thing\'s process is held to its life', async () => {
  const { timeSchedule } = await import('../src/values-record.mjs');
  const scalar = (id, extra = {}) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1e12 } }, unit: 'people', scale: { label: id, ...extra } });
  const event = (id, start, end = start + 1) => ({ id, boundary: id, interval: { start, end }, provenance: ['x'] });
  const model = { time_unit: 'year', processes: [scalar('world'), scalar('rome', { subject_referent_id: 'polity.rome' })], decomposition: [],
    value_series: [{ id: 's.world', process_id: 'world', holder: 'm', points: [{ time: 2026, value: 8, tag: 'sketch' }] },
      { id: 's.rome', process_id: 'rome', holder: 'm', points: [{ time: 100, value: 60, tag: 'sketch' }] }],
    meaning_model: { events: [event('origin', -300000), event('rome.life', -27, 476), event('now', 2026)],
      referents: [{ id: 'polity.rome', lifecycle_event_id: 'rome.life' }] } };
  let report = valuesReport(model);
  assert.equal(report.done, false);
  // The world process is asked for the far past; Rome only within its life.
  const asked = Object.fromEntries((report.schedule.next.examples ?? []).map((item) => [item.id, item.at]));
  assert.ok(asked.world.includes(-300000));
  assert.ok((asked.rome ?? []).every((t) => t >= -27 - 200 && t <= 476 + 200), JSON.stringify(asked.rome));
  // A model kept in days over thirty years is divided evenly, not in log time.
  assert.equal(timeSchedule(0, 30 * 365, 'days').scale, 'even');
  assert.equal(timeSchedule(-300000, 2026, 'year').scale, 'log');
});

test('a process can name its Thing after it is opened, and a value reason over 4,000 bytes is refused plainly', () => {
  let model = base();
  model.meaning_model = { schema: 'life-sim-rust-meaning-model/v1', referents: [{ id: 'polity.rome', lifecycle_event_id: 'rome.life' }], events: [] };
  const change = valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', process: { subject: 'polity.rome' } }] });
  assert.equal(change.upsert.processes[0].scale.subject_referent_id, 'polity.rome');
  model = applyModelChange(model, HASH, change).successor;
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', process: { subject: 'polity.carthage' } }] }), /not a referent/u);
  model.meaning_model.referents.push({ id: 'polity.carthage' });
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', process: { subject: 'polity.carthage' } }] }), /already about polity\.rome/u);
  assert.throws(() => valuesChange(model, { holder: 'c', reason: 'r', values: [{ processId: 'pop', reason: 'ω'.repeat(2_001), points: [{ time: 1, value: 1, tag: 'sketch' }] }] }), /reason is 4002 bytes/u);
});

test('a row of many states keeps the brief ones and says when changes are too many to draw', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const context = { NX: 400, F: { w: 0 }, timeAtX: (x) => x }; vm.createContext(context);
  vm.runInContext(`${slice('const stepAt =', '\n')}\n${slice('function stateSampleTimes', 'function layRow')}\nthis.stepAt = stepAt; this.stateSampleTimes = stateSampleTimes;`, context);
  // 134 changes between two states every 0.3 years, then a state held for a hundredth of a year, late in the window.
  const points = [{ t: 0, v: 0 }];
  for (let i = 1; i <= 134; i += 1) points.push({ t: i * 0.3, v: i % 2 ? 2 : 0 });
  points.push({ t: 50.01, v: 1 }, { t: 50.02, v: 0 }, { t: 100, v: 0 });
  const row = { points };
  const times = context.stateSampleTimes(row, 0, 100, 0, 100);
  assert.equal(times.length, 400);
  assert.ok(times.some((t) => context.stepAt(points, t) === 1), 'the brief late state is drawn');
  assert.ok(row.omittedChanges > 0, 'the row knows some changes could not be drawn exactly');
  assert.match(source, /drawn approximately at this zoom; zoom in to see each exactly/u);
});

test('ids are digests of the whole pair or triple: no collisions, bounded for any holder', () => {
  let model = base();
  const holder = '研'.repeat(115);
  const change = valuesChange(model, { holder, reason: 'r', values: [{ processId: 'pop', points: [{ time: 1, value: 1, tag: 'sketch' }] }] });
  assert.ok(Buffer.byteLength(change.upsert.value_series[0].id, 'utf8') <= 1_024);
  assert.match(change.upsert.value_series[0].id, /^values\.pop~[0-9a-f]{16}$/u);
  // A series saved under the earlier id form is found by its process and holder, and keeps its id.
  model = { ...base(), value_series: [{ id: 'values.pop~claude', process_id: 'pop', holder: 'claude', points: [{ time: 1, value: 1, tag: 'sketch' }], provenance: ['life_values_record'] }] };
  const again = valuesChange(model, { holder: 'claude', reason: 'r', values: [{ processId: 'pop', points: [{ time: 2, value: 1.1, tag: 'sketch' }] }] });
  assert.deepEqual(again.upsert.value_series.map((s) => [s.id, s.points.length]), [['values.pop~claude', 2]]);
});

// Regression cases for holder-specific values and consistent coverage reports.
test('a state read again is the same state: repeated readings do not crowd out a brief one', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const context = { NX: 400, F: { w: 0 }, timeAtX: (x) => x }; vm.createContext(context);
  vm.runInContext(`${slice('const stepAt =', '\n')}\n${slice('function stateSampleTimes', 'function layRow')}\nthis.stepAt = stepAt; this.stateSampleTimes = stateSampleTimes;`, context);
  // The 134 changes of the earlier case, each state read a second time a thousandth of a year later.
  const points = [{ t: 0, v: 0 }];
  for (let i = 1; i <= 134; i += 1) points.push({ t: i * 0.3, v: i % 2 ? 2 : 0 }, { t: i * 0.3 + 0.001, v: i % 2 ? 2 : 0 });
  points.push({ t: 50.01, v: 1 }, { t: 50.02, v: 0 }, { t: 100, v: 0 });
  const row = { points };
  const times = context.stateSampleTimes(row, 0, 100, 0, 100);
  assert.ok(times.some((t) => context.stepAt(points, t) === 1), 'the brief late state is drawn');
  assert.ok(row.omittedChanges > 0);
});

test('done is judged on every holder\'s values together, the same in every tool, and a holder\'s sums only against its own parts', () => {
  const finest = timeSchedule(0, 100).levels.at(-1).boundaries;
  const point = (time, value = 1) => ({ time, value, tag: 'sketch' });
  const shared = { ...base(), value_series: [
    { id: 'values.pop~a', process_id: 'pop', holder: 'alice', points: finest.slice(0, 28).map((t) => point(t)), provenance: ['life_values_record'] },
    { id: 'values.pop~b', process_id: 'pop', holder: 'bob', points: finest.slice(28).map((t) => point(t)), provenance: ['life_values_record'] }] };
  const verdicts = [valuesReport(shared, { holder: 'alice' }), valuesReport(shared, { holder: 'bob' }), valuesReport(shared), coverageSummary(shared)].map((report) => report.done);
  assert.deepEqual(verdicts, [true, true, true, true]);
  assert.equal(coverageSummary(shared).holders, 2);
  // Bob's parts exceeding Alice's whole is a disagreement between accounts; Alice's own parts exceeding it is a contradiction.
  const parts = (holder) => ['pop.a', 'pop.b'].map((id) => ({ id: `values.${id}~${holder}`, process_id: id, holder, points: [point(0, 1.5)], provenance: ['life_values_record'] }));
  const opened = (holder) => ({ ...shared, processes: [...shared.processes, ...['pop.a', 'pop.b'].map((id) => ({ ...structuredClone(shared.processes[0]), id, scale: { semantic_role: id } }))],
    decomposition: ['pop.a', 'pop.b'].map((id) => ({ id: `d.${id}`, parent: 'pop', child: id, kind: 'functional_refinement' })), value_series: [...shared.value_series, ...parts(holder)] });
  assert.equal(valuesReport(opened('bob')).contradictionCount, 0);
  const own = valuesReport(opened('alice'));
  assert.deepEqual(own.contradictions.map((c) => [c.process, c.holder, c.time]), [['pop', 'alice', 0]]);
});
