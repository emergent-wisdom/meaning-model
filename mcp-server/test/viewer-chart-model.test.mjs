import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { projectScalarSeries } from '../src/viewer-scalar-series.mjs';
import { chartModel, packLanes, chartAxis, axisFraction, axisTicks, timeLabel, readSeries, layerReading, tagCountsOf } from '../viewer/public/chart-model.js';

const part = (id, start, end) => ({ id, start, end });

test('parts are laid out as declared: overlapping parts share lanes, nothing is picked out', () => {
  const lanes = packLanes([part('a', 0, 60), part('b', 60, 71), part('long', 59, 100), part('c', 71, 88), part('d', 88, 100)]);
  assert.deepEqual(lanes.map((p) => [p.id, p.lane]), [['a', 0], ['long', 1], ['b', 0], ['c', 0], ['d', 0]]);
  assert.equal(lanes.length, 5, 'every part is kept');
  // Many parts are packed quickly.
  const many = Array.from({ length: 2000 }, (_, i) => part(`p${i}`, i / 20, i / 20 + (i % 7 === 0 ? 3 : 0.05)));
  const began = performance.now(); assert.equal(packLanes(many).length, 2000); assert.ok(performance.now() - began < 500);
});

test('the axis is even unless the records crowd toward its end', () => {
  const window = { start: -300000, end: 2026 };
  assert.equal(chartAxis(window, [-300000, -100000, -50000, -10000, -5000, -1000]).kind, 'linear');
  const crowded = chartAxis(window, [-200000, 1500, 1800, 1900, 1950, 2000, 2010]);
  assert.equal(crowded.kind, 'log'); assert.ok(crowded.knee > 0);
  const frac = axisFraction(crowded);
  assert.equal(frac(window.start), 0); assert.ok(Math.abs(frac(window.end) - 1) < 1e-12);
  assert.ok(frac(1900) - frac(1800) > 50 * (frac(-100000) - frac(-100100)), 'a recent century is far wider than a deep one');
  assert.equal(chartAxis({ start: 1800, end: 1900 }, [1800, 1850, 1890]).kind, 'linear', 'too few records to judge');
});

test('ticks are round, labelled in the model clock and never overlap', () => {
  const axis = chartAxis({ start: -300000, end: 2026 }, [-200000, 1500, 1800, 1900, 1950, 2000, 2010]);
  const width = (text) => text.length * 6.5;
  const ticks = axisTicks(axis, 'year', 2026, 900, width);
  assert.ok(ticks.some((tick) => /years ago$/u.test(tick.text)) && ticks.some((tick) => /^\d{4}$/u.test(tick.text)));
  const frac = axisFraction(axis);
  for (let i = 1; i < ticks.length; i += 1) {
    const a = ticks[i - 1], b = ticks[i];
    assert.ok(frac(b.t) * 900 - width(b.text) / 2 >= frac(a.t) * 900 + width(a.text) / 2, `${a.text} and ${b.text} overlap`);
  }
  // A story over three days, on the civil-day clock the viewer converts to decimal years, is marked by days and hours.
  const day = 1 / 365.2425, start = 1970 + 20000 * day;
  const short = axisTicks({ kind: 'linear', start, end: start + 3 * day }, 'civil_day_since_1970', start + 3 * day, 700, width);
  assert.ok(short.length >= 3, `three days need ticks, got ${short.map((tick) => tick.text).join(', ')}`);
  assert.ok(short.some((tick) => /^\d+ [A-Z][a-z]{2}$/u.test(tick.text)));
  assert.match(timeLabel(start + 0.5 * day, { unit: 'civil_day_since_1970', present: start + 3 * day, span: 3 * day }), /, 12:00$/u);
  const native = axisTicks({ kind: 'linear', start: 0, end: 500 }, 'machine_cycle', 500, 600, width);
  assert.ok(native.length > 2 && native.every((tick) => tick.text.endsWith(' machine_cycle')));
});

test('time labels name the year a decimal year falls in, and keep a native clock', () => {
  assert.equal(timeLabel(2025.9, { unit: 'year', present: 2026 }), '2025');
  assert.equal(timeLabel(-500, { unit: 'year', present: 2026 }), '500 BCE');
  assert.equal(timeLabel(1, { unit: 'year', present: 2026 }), '1 CE');
  assert.equal(timeLabel(-298000, { unit: 'year', present: 2026 }), '300,000 years ago');
  assert.equal(timeLabel(12, { unit: 'machine_cycle', present: 50 }), '12 machine_cycle');
});

test('a series is read only between its first and last samples, marked when between them', () => {
  const s = { interpolation: { kind: 'linear-visual-guide' }, points: [{ t: 0, v: 10, tag: 'source' }, { t: 10, v: 20, tag: 'sketch: rough', uncertainty: { lower: 15, upper: 25 } }] };
  assert.equal(readSeries(s, -1), null); assert.equal(readSeries(s, 11), null);
  assert.deepEqual([readSeries(s, 0).v, readSeries(s, 0).between, readSeries(s, 0).tag], [10, false, 'source']);
  const mid = readSeries(s, 5);
  assert.deepEqual([mid.v, mid.between, mid.tag], [15, true, 'sketch'], 'between two values the line is only as sure as the less sure');
  const steps = { interpolation: { kind: 'step-hold' }, points: [{ t: 0, v: 0, state: 'single', tag: 'source' }, { t: 10, v: 1, state: 'married', tag: 'source' }] };
  assert.equal(readSeries(steps, 5).state, 'single');
});

// A small model: a world whose development is divided into periods, ranked Events, an inner process, a reading, a
// declared partition of one process and ordinary refinements of it, and two holders of one series.
function fixture() {
  const event = (id, start, end, extra = {}) => ({ id, boundary: `${id} label`, description: `${id} description`, interval: { start, end }, provenance: ['inferred: fixture'], ...extra });
  const contains = (source, target) => ({ id: `${source}>${target}`, kind: 'contains', source_event_id: source, target_event_id: target, provenance: ['frame'], uncertainty: { kind: 'unknown' } });
  const process = (id, label, unit) => ({ id, unit, scale: { label, semantic_role: `${label}: what it measures.` }, value_type: { kind: 'scalar' }, support: [], provenance: ['sketch: fixture'] });
  const series = (processId, holder, points) => ({ id: `values.${processId}~${holder}`, process_id: processId, holder, points: points.map(([time, value, tag]) => ({ time, value, tag })) });
  const events = [event('world', 0, 100), event('dev', 0, 100), event('p1', 0, 40), event('p2', 40, 70), event('p3', 70, 100), event('trend', 30, 100),
    event('p2a', 40, 55), event('p2b', 55, 70), event('e1', 10, 12), event('e2', 45, 46), event('e3', 80, 81), event('ana.inner', null, null, { interval: null, participants: { subject: 'ana' } }),
    event('thought', 50, 51), event('understanding.reader', null, null, { interval: null }), event('reading.1', 60, 61)];
  const mm = {
    schema: 'meaning-model/v1', context_roots: [{ event_id: 'world', kind: 'accepted_world' }, { event_id: 'ana.inner', kind: 'inner' }, { event_id: 'understanding.reader', kind: 'understanding' }],
    referents: [{ id: 'ana', boundary: 'Ana, a person' }], events,
    event_relations: [...['dev', 'ana.inner', 'understanding.reader', 'e1', 'e3'].map((id) => contains('world', id)), ...['p1', 'p2', 'p3', 'trend'].map((id) => contains('dev', id)),
      contains('p2', 'p2a'), contains('p2', 'p2b'), contains('p2a', 'e2'), contains('ana.inner', 'thought'), contains('understanding.reader', 'reading.1'),
      { id: 'e1.causes.e2', kind: 'causes', source_event_id: 'e1', target_event_id: 'e2', provenance: ['inferred: fixture'], uncertainty: { kind: 'unknown' } }],
    importance_scales: [{ id: 'importance.all', audience: 'Everyone in the fixture', levels: [{ key: 'top_10', anchor: 'Top' }, { key: 'noted', anchor: 'Noted' }] }],
    event_importance: [{ id: 'i1', event_id: 'e1', scale_id: 'importance.all', level: 'top_10' }, { id: 'i2', event_id: 'e2', scale_id: 'importance.all', level: 'noted' }],
  };
  const model = { id: 'fixture', schema: 'life-sim/v1', time_unit: 'year', revision: { number: 1 }, initial_claims: [], laws: [], dependencies: [],
    processes: [process('whole', 'Whole', 'count'), process('part.a', 'Part A', '% of whole'), process('part.b', 'Part B', '% of whole'),
      process('kind.x', 'Kind X', '% of whole'), process('kind.y', 'Kind Y', '% of whole')],
    decomposition: [{ id: 'd1', parent: 'whole', child: 'part.a', kind: 'observational_partition' }, { id: 'd2', parent: 'whole', child: 'part.b', kind: 'observational_partition' },
      { id: 'd3', parent: 'whole', child: 'kind.x', kind: 'functional_refinement' }, { id: 'd4', parent: 'whole', child: 'kind.y', kind: 'functional_refinement' }],
    value_series: [series('whole', 'modeler', [[0, 10, 'source'], [50, 20, 'inferred'], [100, 40, 'sketch']]), series('whole', 'reviewer', [[0, 12, 'exploring'], [100, 30, 'exploring']]),
      series('part.a', 'modeler', [[0, 60, 'inferred'], [100, 40, 'inferred']]), series('part.b', 'modeler', [[0, 40, 'inferred'], [100, 55, 'inferred']]),
      series('kind.x', 'modeler', [[0, 30, 'invented'], [100, 35, 'invented']]), series('kind.y', 'modeler', [[0, 70, 'invented'], [100, 65, 'invented']])],
    meaning_model: mm };
  return model;
}
const snapshotOf = async (model) => buildViewerData({ history: { graphId: model.id, models: [{ modelHash: 'f'.repeat(64), definition: model }], revisions: [] }, name: model.id });

test('the chart reads declared parts, ranked Event rows, links and the process tree from what the model declares', async () => {
  const c = chartModel(await snapshotOf(fixture()));
  assert.equal(c.available, true);
  assert.ok(c.wholes.some((w) => w.id === 'dev') && c.wholes.some((w) => w.id === 'p2'));
  assert.deepEqual(c.partsOf('dev').map((p) => [p.id, p.lane]), [['p1', 0], ['trend', 1], ['p2', 0], ['p3', 0]], 'the overlapping trend is kept, in its own lane');
  assert.deepEqual(c.partsOf('p2').map((p) => p.id), ['p2a', 'p2b']);
  const rows = c.eventRows(c.defaultScale);
  assert.deepEqual(rows.map((row) => [row.label, [...row.events].sort()]), [['Top 10', ['e1']], ['Noted', ['e2']],
    ['Not ranked', ['dev', 'e3', 'p1', 'p2', 'p2a', 'p2b', 'p3', 'trend']], ['Inner: Ana', ['thought']]]);
  const laidOut = c.eventRows(c.defaultScale, new Set(['dev', 'p1', 'trend', 'p2', 'p3']));
  assert.deepEqual([...laidOut.find((row) => row.key === 'rest').events].sort(), ['e3', 'p2a', 'p2b'], 'Events laid out across the top are not drawn again in a row');
  assert.ok(!c.events.some((e) => e.id === 'reading.1'), 'a reading is never drawn as an Event of the world');
  assert.deepEqual(c.links.map((link) => [link.from, link.to, link.kind]), [['e1', 'e2', 'causes']]);
  assert.deepEqual(c.eventRows(null).map((row) => row.label), ['Events', 'Inner: Ana']);

  const byId = new Map(c.rows.map((row) => [row.id, row]));
  const reviewer = c.rows.find((row) => row.process === 'whole' && row.holder === 'reviewer');
  assert.equal(reviewer.id, `whole~${reviewer.series.id}`, 'a further row of a process is named by its series');
  assert.deepEqual(c.rows.map((row) => [row.kind, row.id, row.depth]), [
    ['measure', 'whole', 0], ['measure', reviewer.id, 0], ['stack', 'stack:whole', 1], ['measure', 'kind.x', 1], ['measure', 'kind.y', 1]]);
  assert.deepEqual([byId.get('whole').holder, reviewer.holder], ['modeler', 'reviewer'], 'each holder keeps its own row');
  assert.deepEqual([byId.get('whole').holders, reviewer.holders, byId.get('kind.x').holders], [2, 2, 1], 'rows of one process name their holders');
  assert.deepEqual([byId.get('whole').apart, reviewer.apart], [null, null], 'holders that differ need nothing more to tell them apart');
  assert.deepEqual(byId.get('stack:whole').members.map((m) => m.id), ['part.a', 'part.b'], 'only the declared partition is stacked');
  assert.deepEqual(c.tagCounts, { source: 1, inferred: 5, sketch: 1, exploring: 2, invented: 4 });
  assert.equal(c.latest, 100); assert.equal(c.readAt, 100);
});

test('a model without periods, importance or decomposition still charts its Events and values', async () => {
  const model = fixture();
  model.decomposition = [];
  model.meaning_model.importance_scales = []; model.meaning_model.event_importance = [];
  model.meaning_model.event_relations = model.meaning_model.event_relations.filter((r) => r.source_event_id !== 'dev' && r.source_event_id !== 'p2');
  const c = chartModel(await snapshotOf(model));
  assert.ok(!c.wholes.some((w) => w.id === 'dev'), 'without declared parts an Event is no whole'); assert.equal(c.defaultScale, null);
  assert.deepEqual(c.eventRows(null).map((row) => row.label), ['Events', 'Inner: Ana']);
  assert.ok(c.rows.every((row) => row.kind === 'measure' && row.depth === 0));
  assert.equal(c.rows.length, 6);
});

// One process held by Alice in three series that differ by mode and scope, and by Bob in a fourth.
function sameHolderData() {
  const claim = (id, t, v, mode, scope, holder = 'alice') => ({ id, subject: 'p', value: { kind: 'scalar', value: v }, value_time: t, evidence_cutoff: 0, mode,
    evidence_type: mode === 'observed' ? 'report' : 'estimate', holder, authority: { source: holder, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: [scope] });
  const model = { time_unit: 'day', processes: [{ id: 'p', unit: 'litre', value_type: { kind: 'scalar' }, scale: { label: 'Level' } }], decomposition: [], meaning_model: { events: [] },
    initial_claims: [claim('a', -2, 5, 'observed', 'research'), claim('b', 0, 6, 'observed', 'research'), claim('c', -2, 20, 'estimated', 'research'), claim('d', 0, 30, 'estimated', 'research'),
      claim('e', -2, 40, 'observed', 'private'), claim('f', 0, 50, 'observed', 'private'), claim('g', -2, 7, 'observed', 'research', 'bob'), claim('h', 0, 8, 'observed', 'research', 'bob')] };
  return { timeUnit: 'day', events: [], typedScalarSeries: projectScalarSeries(model), inspection: { model } };
}

test('several series of one holder each keep a row of their own, named by what tells them apart', () => {
  const data = sameHolderData();
  const rows = chartModel(data).rows;
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((row) => row.id)).size, 4, `row ids are unique: ${rows.map((row) => row.id).join(', ')}`);
  assert.equal(rows[0].id, 'p', 'the first row is the process\'s own');
  for (const row of rows.slice(1)) assert.equal(row.id, `p~${row.series.id}`, 'a further row is named by its series');
  assert.deepEqual(new Set(rows.map((row) => row.series.id)), new Set(data.typedScalarSeries.map((s) => s.id)), 'every series has its row');
  const alice = rows.filter((row) => row.holder === 'alice');
  assert.deepEqual(alice.map((row) => row.apart).sort(), ['estimated · scope research', 'observed · scope private', 'observed · scope research']);
  assert.equal(rows.find((row) => row.holder === 'bob').apart, null, 'a holder with one series needs no more');
  assert.deepEqual(rows.map((row) => chartModel(data).rows.find((again) => again.id === row.id).series.points.map((p) => p.v)), rows.map((row) => row.series.points.map((p) => p.v)), 'ids are stable');
  // Series with no identity of their own, and no declared difference, are told apart by their place.
  const plain = (v) => ({ processId: 'p', holder: 'alice', unit: 'litre', interpolation: { kind: 'linear-visual-guide' }, points: [{ t: 0, v, tag: 'source' }, { t: 10, v: v * 2, tag: 'source' }] });
  const bare = chartModel({ ...data, typedScalarSeries: [plain(1), plain(2), plain(3)] }).rows;
  assert.deepEqual(bare.map((row) => [row.id, row.apart]), [['p', 'series 1 of 3'], ['p~1', 'series 2 of 3'], ['p~2', 'series 3 of 3']]);
  const twice = chartModel({ ...data, typedScalarSeries: [{ ...plain(1), id: 's' }, { ...plain(2), id: 's' }, { ...plain(3), id: 's' }] }).rows;
  assert.equal(new Set(twice.map((row) => row.id)).size, 3, 'a repeated series id still gives unique rows');
  // A fallback id can be taken by a series' own id: suffixes are tried until one is free, the same on every load.
  const taken = [{ ...plain(1), id: 's' }, { ...plain(2), id: '2' }, { ...plain(3), id: '2' }];
  const clash = chartModel({ ...data, typedScalarSeries: taken }).rows.map((row) => row.id);
  assert.equal(new Set(clash).size, 3, `row ids are unique: ${clash.join(', ')}`);
  assert.deepEqual(chartModel({ ...data, typedScalarSeries: taken }).rows.map((row) => row.id), clash, 'and stable');
});

test('a declared partition is stacked only when its parts are one holder\'s, never combining different holders', async () => {
  const model = fixture();
  model.value_series = model.value_series.map((s) => (s.process_id === 'part.b' ? { ...s, id: 'values.part.b~bob', holder: 'bob' } : s));
  const rows = chartModel(await snapshotOf(model)).rows;
  assert.ok(!rows.some((row) => row.kind === 'stack'), 'Alice\'s and Bob\'s parts are not one stack');
  const parts = rows.filter((row) => row.process === 'part.a' || row.process === 'part.b');
  assert.deepEqual(parts.map((row) => [row.id, row.holder, row.parent]), [['part.a', 'modeler', 'whole'], ['part.b', 'bob', 'whole']], 'each part keeps its own attributed row');
  // A part held in two series is not one stack member either.
  const twice = fixture();
  twice.value_series.push({ ...twice.value_series.find((s) => s.process_id === 'part.b'), id: 'values.part.b~second' });
  assert.ok(!chartModel(await snapshotOf(twice)).rows.some((row) => row.kind === 'stack'));
  const same = chartModel(await snapshotOf(fixture())).rows.find((row) => row.kind === 'stack');
  assert.equal(same.holder, 'modeler', 'a stack of one holder\'s parts says whose they are');
});

test('every row a process generates is held by its parent, so folding the parent hides them all', () => {
  const series = (id, holder, v) => ({ id, processId: 'p', holder, unit: 'litre', interpolation: { kind: 'linear-visual-guide' }, points: [{ t: 0, v, tag: 'source' }, { t: 10, v: v * 2, tag: 'source' }] });
  const leaf = (id, processId) => ({ ...series(id, 'alice', 3), processId });
  const model = { time_unit: 'day', meaning_model: { events: [] },
    processes: ['root', 'p', 'q'].map((id) => ({ id, unit: 'litre', value_type: { kind: 'scalar' }, scale: { label: id } })),
    decomposition: [{ parent: 'root', child: 'p', kind: 'functional_refinement' }, { parent: 'p', child: 'q', kind: 'functional_refinement' }] };
  const data = { timeUnit: 'day', events: [], inspection: { model }, typedScalarSeries: [series('s1', 'alice', 1), series('s2', 'bob', 10), leaf('s3', 'q')] };
  const rows = chartModel(data).rows, byId = new Map(rows.map((row) => [row.id, row]));
  assert.deepEqual(rows.map((row) => [row.id, row.parent]), [['root', null], ['p', 'root'], ['p~s2', 'root'], ['q', 'p']]);
  assert.deepEqual(byId.get('root').children, ['p', 'p~s2'], 'both of p\'s rows are under root');
  assert.deepEqual(byId.get('p').children, ['q'], 'p\'s own parts stay under its own row');
  assert.deepEqual(byId.get('p~s2').children, [], 'a further row of p holds nothing of its own');
  // In groups too: processes under two Events, one of them held in two series.
  const home = (s, at) => ({ ...s, home: at });
  const grouped = { ...data, events: [{ id: 'life.a', label: 'Life A', start: 0, end: 10 }, { id: 'life.b', label: 'Life B', start: 0, end: 10 }],
    inspection: { model: { ...model, decomposition: [] } }, processes: [{ id: 'p', home: 'life.a' }, { id: 'q', home: 'life.b' }],
    typedScalarSeries: [home(series('s1', 'alice', 1), 'life.a'), home(series('s2', 'bob', 10), 'life.a'), home(leaf('s3', 'q'), 'life.b')] };
  const groupRows = chartModel(grouped).rows;
  assert.deepEqual(groupRows.find((row) => row.id === 'group:life.a').children, ['p', 'p~s2']);
});

// Processes that add up. A whole in tonnes holds parts declared in the decomposition; each process has the dated values given.
const sumLine = (processId, values, { holder = 'ana', unit = 'tonnes' } = {}) => ({ id: `values.${processId}~${holder}`, processId, holder, unit, interpolation: { kind: 'linear-visual-guide' },
  points: values.map(([t, v, range]) => ({ t, v, tag: 'inferred', ...(range ? { uncertainty: { kind: 'interval', lower: range[0], upper: range[1] } } : {}) })) });
const sumProcess = (id, { unit = 'tonnes', aggregate, kind = 'scalar' } = {}) => ({ id, unit, value_type: { kind }, scale: { label: `Label of ${id}`, ...(aggregate ? { aggregate } : {}) } });
function sums({ aggregate = 'sum', whole = [[0, 10], [50, 20], [100, 30]], parts = { a: [[0, 4], [50, 8], [100, 12]], b: [[0, 6], [50, 12], [100, 18]] }, more = [], processes = [], edges = [] } = {}) {
  const model = { time_unit: 'year', meaning_model: { events: [] },
    processes: [sumProcess('total', { aggregate }), ...Object.keys(parts).map((id) => sumProcess(id)), ...processes],
    decomposition: [...Object.keys(parts).map((id) => ({ parent: 'total', child: id, kind: 'functional_refinement' })), ...edges] };
  return { timeUnit: 'year', events: [], inspection: { model }, typedScalarSeries: [sumLine('total', whole), ...Object.entries(parts).map(([id, values]) => sumLine(id, values)), ...more] };
}
const rowOf = (c, id) => c.rows.find((row) => row.process === id);

test('a process that declares the sum of its parts stacks them, in its own unit, and only then', () => {
  const c = chartModel(sums());
  const total = rowOf(c, 'total');
  assert.deepEqual(total.layers.members.map((m) => m.id), ['a', 'b'], 'the parts the model declares, in its own unit');
  assert.deepEqual(total.layers.listed, []);
  assert.deepEqual(total.layers.times, [0, 50, 100], 'over the dates the whole and every part are recorded');
  const read = layerReading(total, 50);
  assert.deepEqual([read.whole.v, read.parts.map((r) => r.v), read.tops, read.sum, read.gap, read.over], [20, [8, 12], [8, 20], 20, 0, 0], 'the layers add up to the whole');
  assert.deepEqual([total.layers.gap, total.layers.over, total.layers.exceeds], [false, false, []]);
  assert.equal(layerReading(total, 150), null, 'unrecorded time has no reading');
  assert.ok(rowOf(c, 'a').layers === undefined && rowOf(c, 'b').layers === undefined, 'a part that declares no sum stacks nothing');
  assert.deepEqual(c.rows.map((row) => row.id), ['total', 'a', 'b'], 'the parts keep rows of their own');
  // Shared units are not a declaration: the same parts, the same unit, no sum.
  for (const aggregate of [null, 'mean', 'average', 'median']) {
    const rows = chartModel(sums({ aggregate })).rows;
    assert.ok(rows.every((row) => row.layers === undefined), `aggregate ${aggregate} stacks nothing`);
  }
});

test('what a declared sum holds beyond its parts is its remainder, and parts that exceed it are marked at their dates', () => {
  const gap = rowOf(chartModel(sums({ whole: [[0, 12], [50, 24], [100, 36]] })), 'total');
  assert.deepEqual([gap.layers.gap, gap.layers.over], [true, false]);
  const short = layerReading(gap, 50);
  assert.deepEqual([short.gap, short.over, short.sum], [4, 0, 20], 'the whole minus its parts, as a plain remainder');
  assert.equal(layerReading(gap, 25).gap, 3, 'read along the lines between dates');

  const over = rowOf(chartModel(sums({ whole: [[0, 10], [50, 17], [100, 30]] })), 'total');
  assert.deepEqual([over.layers.gap, over.layers.over], [false, true]);
  assert.deepEqual(over.layers.exceeds.map((x) => [x.t, x.by, x.sum]), [[50, 3, 20]], 'the date it exceeds, by how much, and where the parts reach');
  const excess = layerReading(over, 50);
  assert.deepEqual([excess.gap, excess.over, excess.tops.at(-1)], [0, 3, 20], 'the parts are kept as recorded, never cut back to the whole');

  // Values that agree to rounding show neither: a difference under a hundredth of the whole counts as agreeing. It must also
  // matter to the row: over a tenth of a percent of the highest the whole reaches for an excess, marked at its date, and over
  // half a percent for a remainder, a layer that must be as much as the row can show.
  const rounded = rowOf(chartModel(sums({ whole: [[0, 10.05], [50, 19.9], [100, 30]] })), 'total');
  assert.deepEqual([rounded.layers.gap, rounded.layers.over], [false, false], 'within a hundredth of the whole');
  const faint = rowOf(chartModel(sums({ whole: [[0, 0.1], [50, 20], [100, 30]], parts: { a: [[0, 0], [50, 8], [100, 12]], b: [[0, 0], [50, 12], [100, 18]] } })), 'total');
  assert.deepEqual([faint.layers.gap, layerReading(faint, 0).gap], [false, 0], 'a tenth against a peak of thirty is not a remainder worth drawing');
  const seen = rowOf(chartModel(sums({ whole: [[0, 0.2], [50, 20], [100, 30]], parts: { a: [[0, 0], [50, 8], [100, 12]], b: [[0, 0], [50, 12], [100, 18]] } })), 'total');
  assert.deepEqual([seen.layers.gap, layerReading(seen, 0).gap], [true, 0.2], 'but a fifth of it is');
  const slight = rowOf(chartModel(sums({ whole: [[0, 0.1], [50, 20], [100, 30]], parts: { a: [[0, 0.06], [50, 8], [100, 12]], b: [[0, 0.06], [50, 12], [100, 18]] } })), 'total');
  assert.deepEqual([slight.layers.over, layerReading(slight, 0).over], [false, 0], 'a hundredth of a tenth of the peak is rounding at the start of a series');
  const marked = rowOf(chartModel(sums({ whole: [[0, 0.1], [50, 20], [100, 30]], parts: { a: [[0, 0.1], [50, 8], [100, 12]], b: [[0, 0.1], [50, 12], [100, 18]] } })), 'total');
  assert.deepEqual(marked.layers.exceeds.map((x) => [x.t, x.by]), [[0, 0.1]], 'but an excess of a tenth of a percent of it is marked, though the row can hardly show it');
  // The range the whole states does not hide a difference, but a sum that lies inside it says so.
  const ranged = rowOf(chartModel(sums({ whole: [[0, 10, [8, 11]], [50, 17, [14, 20]], [100, 30]] })), 'total');
  assert.deepEqual([ranged.layers.gap, ranged.layers.over], [false, true]);
  assert.deepEqual(ranged.layers.exceeds.map((x) => [x.t, x.by, x.inRange]), [[50, 3, true]], 'the sum of 20 lies inside the range 14 to 20');
  const beyond = rowOf(chartModel(sums({ whole: [[0, 10, [9.5, 10.5]], [50, 17, [16, 18]], [100, 30]] })), 'total');
  assert.deepEqual(beyond.layers.exceeds.map((x) => [x.t, x.inRange]), [[50, false]], 'a sum beyond the range it states');
  const wide = rowOf(chartModel(sums({ whole: [[0, 20, [5, 35]], [50, 40, [10, 70]], [100, 60, [15, 105]]] })), 'total');
  assert.equal(wide.layers.gap, true, 'a wide range does not hide what the whole holds beyond its parts');
  assert.deepEqual([layerReading(wide, 0).gap, layerReading(wide, 0).inRange], [10, true]);
});

test('only parts in the whole\'s own unit, held by the one who holds the row, are stacked; the rest are listed with why', () => {
  // Besides two parts in tonnes: one in litres, one that is not a number, one held by someone else, one with two series,
  // one that dips below zero, one with no dated values, the whole named as its own part, and a part named twice.
  const data = sums({
    parts: { a: [[0, 4], [50, 8], [100, 12]], b: [[0, 6], [50, 12], [100, 18]], litres: [[0, 1], [100, 2]], text: [[0, 1], [100, 2]], theirs: [[0, 1], [100, 2]], twice: [[0, 1], [100, 2]], cold: [[0, 1], [50, -2], [100, 3]] },
    processes: [sumProcess('empty')], edges: [{ parent: 'total', child: 'empty', kind: 'functional_refinement' }, { parent: 'total', child: 'total', kind: 'functional_refinement' }, { parent: 'total', child: 'a', kind: 'semantic_subtype' }],
    more: [{ ...sumLine('twice', [[0, 2], [100, 3]]), id: 'values.twice~second' }],
  });
  data.inspection.model.processes = data.inspection.model.processes.map((p) => (p.id === 'litres' ? { ...p, unit: 'litres' } : p.id === 'text' ? { ...p, value_type: { kind: 'category' } } : p));
  data.typedScalarSeries = data.typedScalarSeries.map((s) => (s.processId === 'litres' ? { ...s, unit: 'litres' } : s.processId === 'theirs' ? { ...s, holder: 'bob' } : s));
  const total = rowOf(chartModel(data), 'total');
  assert.deepEqual(total.layers.members.map((m) => m.id), ['a', 'b'], 'each part once, however many edges name it');
  const why = Object.fromEntries(total.layers.listed.map((x) => [x.id, x.why]));
  assert.deepEqual(why, { litres: 'its unit, litres, is not tonnes', text: 'not a number', theirs: 'held by someone else', twice: 'several series of its holder', cold: 'has values below zero', empty: 'no dated values' });
  assert.ok(total.layers.listed.every((x) => x.label), 'each is named');
});

test('a whole below zero stacks nothing, and a sum held by two holders is stacked from each one\'s own parts', () => {
  const below = rowOf(chartModel(sums({ whole: [[0, -10], [100, -30]], parts: { a: [[0, 4], [100, 12]] } })), 'total');
  assert.deepEqual([below.layers.members.length, below.layers.listed.map((x) => x.why)], [0, ['the whole has values below zero']], 'the layers stand on zero');
  assert.equal(layerReading(below, 50), null);

  const data = sums({ more: [sumLine('total', [[0, 11], [50, 22], [100, 33]], { holder: 'bob' }), sumLine('a', [[0, 5], [50, 10], [100, 15]], { holder: 'bob' })] });
  const rows = chartModel(data).rows.filter((row) => row.process === 'total');
  assert.deepEqual(rows.map((row) => [row.holder, row.layers.members.map((m) => m.id), row.layers.listed.map((x) => `${x.id}: ${x.why}`)]),
    [['ana', ['a', 'b'], []], ['bob', ['a'], ['b: held by someone else']]], 'a holder\'s whole is added up from that holder\'s parts only');
  assert.equal(layerReading(rows[1], 50).sum, 10);

  // Several series of one holder: which part belongs to the whole is not known, so nothing is stacked for it.
  const several = chartModel(sums({ more: [{ ...sumLine('total', [[0, 1], [100, 2]]), id: 'values.total~other' }] })).rows.filter((row) => row.process === 'total');
  assert.ok(several.every((row) => row.layers === undefined));
  // Parts recorded at other times than the whole have no stretch to stack.
  const apart = rowOf(chartModel(sums({ whole: [[0, 10], [10, 20]], parts: { a: [[50, 4], [100, 12]] } })), 'total');
  assert.deepEqual([apart.layers.members.length, apart.layers.times, apart.layers.listed.map((x) => x.id)], [0, [], ['a']], 'no stretch holds the whole and the part, so the part is listed, not stacked');
  assert.equal(layerReading(apart, 5), null);
  const meet = rowOf(chartModel(sums({ whole: [[0, 10], [100, 20]], parts: { a: [[100, 4], [200, 12]] } })), 'total');
  assert.equal(meet.layers.members.length, 0, 'a single date they share is no stretch to stack');
});

test('a declared sum is shown in its own row, so its divided parts are not stacked a second time but keep their own rows', async () => {
  const model = fixture();
  assert.ok(chartModel(await snapshotOf(model)).rows.some((row) => row.kind === 'stack'), 'without the declaration the partition is stacked in a row of its own');
  model.processes = model.processes.map((p) => (p.id === 'whole' ? { ...p, unit: '% of whole', scale: { ...p.scale, aggregate: 'sum' } } : p));
  const c = chartModel(await snapshotOf(model));
  const whole = c.rows.find((row) => row.process === 'whole' && row.holder === 'modeler');
  assert.deepEqual(whole.layers.members.map((m) => m.id), ['part.a', 'part.b', 'kind.x', 'kind.y'], 'every part in its unit, whatever kind of refinement it is');
  assert.ok(!c.rows.some((row) => row.kind === 'stack'), 'the stack row is replaced');
  assert.deepEqual(c.rows.filter((row) => row.parent === 'whole').map((row) => row.id), ['part.a', 'part.b', 'kind.x', 'kind.y'], 'the partition\'s parts are rows of their own');
  assert.equal(c.tree.rowOf('part.a').series.points.length, 2, 'their values are still drawn');
  // A partition held by someone else than the whole's row is not what that row stacks: the stack stays.
  const other = fixture();
  other.processes = other.processes.map((p) => (p.id === 'whole' ? { ...p, unit: '% of whole', scale: { ...p.scale, aggregate: 'sum' } } : p));
  other.value_series = other.value_series.map((s) => (s.process_id === 'part.a' || s.process_id === 'part.b' ? { ...s, id: `${s.id}.theirs`, holder: 'bob' } : s));
  const rows = chartModel(await snapshotOf(other)).rows;
  assert.ok(rows.some((row) => row.kind === 'stack' && row.holder === 'bob'));
});

// A tree: root holds p (which holds q and s) and r; x is a part of both p and r.
function treeData(extra = {}) {
  const ids = ['root', 'p', 'q', 's', 'r', 'x'];
  const model = { time_unit: 'year', meaning_model: { events: [] }, processes: ids.map((id) => sumProcess(id)),
    decomposition: [['root', 'p'], ['root', 'r'], ['p', 'q'], ['p', 's'], ['p', 'x'], ['r', 'x']].map(([parent, child]) => ({ parent, child, kind: 'functional_refinement' })) };
  return { timeUnit: 'year', events: [], inspection: { model }, typedScalarSeries: ids.map((id, i) => sumLine(id, [[0, i + 1], [100, i + 2]])), ...extra };
}

test('a process can be opened as the top: its own tree, from itself, with the path to it from the top of its branch', () => {
  const c = chartModel(treeData());
  assert.deepEqual(c.rows.map((row) => [row.id, row.depth, row.parent]), [['root', 0, null], ['p', 1, 'root'], ['q', 2, 'p'], ['s', 2, 'p'], ['x', 2, 'p'], ['r', 1, 'root']]);
  assert.deepEqual(c.rows.find((row) => row.id === 'x').alsoUnder, ['r'], 'a part with two parents is drawn under the first, and names the other');
  assert.deepEqual(c.tree.path('q').map((step) => step.id), ['root', 'p', 'q'], 'the path from the root');
  assert.deepEqual(c.tree.path('root').map((step) => step.id), ['root']);
  const p = c.tree.from('p');
  assert.deepEqual(p.rows.map((row) => [row.id, row.depth, row.parent]), [['p', 0, null], ['q', 1, 'p'], ['s', 1, 'p'], ['x', 1, 'p']], 'only it and what it holds, from depth 0');
  assert.deepEqual(p.path.map((step) => step.label), ['Label of root', 'Label of p']);
  assert.deepEqual([...p.has].sort(), ['p', 'q', 's', 'x']);
  assert.equal(p.rows[0].up, 'root', 'the process it was opened from');
  assert.deepEqual(p.rows[0].alsoUnder, [], 'and that is not a second parent');
  // x has two parents: opened from r it is drawn under r, as it is under p.
  const r = c.tree.from('r');
  assert.deepEqual(r.rows.map((row) => [row.id, row.depth]), [['r', 0], ['x', 1]], 'a part is drawn under whichever of its parents is opened');
  assert.deepEqual(r.rows[1].alsoUnder, ['p']);
  assert.equal(c.tree.from('p'), p, 'the same opening is not worked out twice');
  assert.deepEqual(c.tree.from('root').rows.map((row) => row.id), c.rows.map((row) => row.id), 'the root opens as the whole tree');
  // Only a process the chart draws can be opened.
  assert.equal(c.tree.from('nothing'), null); assert.equal(c.tree.rowOf('nothing'), null); assert.deepEqual(c.tree.path('nothing'), []);
  assert.equal(c.tree.rowOf('s'), c.rows.find((row) => row.id === 's'));
});

test('without a decomposition there is nothing to open into: no row holds another', () => {
  const data = treeData(); data.inspection.model.decomposition = [];
  const c = chartModel(data);
  assert.ok(c.rows.every((row) => row.children.length === 0), 'no row holds parts, so no row offers to be opened');
  assert.equal(c.tree.from('p'), null, 'so nothing is offered to open');
  assert.equal(c.tree.rowOf('p'), c.rows.find((row) => row.id === 'p'), 'though every process keeps its row');
  assert.ok(c.rows.every((row) => row.layers === undefined));
  // A process the decomposition leaves out cannot be the top of a tree it is not in, in a model that has one.
  const loose = treeData();
  loose.inspection.model.processes.push(sumProcess('loose')); loose.typedScalarSeries.push(sumLine('loose', [[0, 1], [100, 2]]));
  const d = chartModel(loose);
  assert.equal(d.tree.from('loose'), null); assert.equal(d.tree.rowOf('loose').id, 'loose');
  assert.ok(d.tree.from('q') && d.tree.from('r'), 'while a part, or a process with parts, can');
});

test('the tags a key lists are those of the rows drawn', () => {
  const c = chartModel(sums());
  assert.deepEqual(tagCountsOf(c.rows), { inferred: 9 });
  assert.deepEqual(tagCountsOf(c.tree.from('total').rows), tagCountsOf(c.rows));
  assert.deepEqual(tagCountsOf(c.rows.filter((row) => row.process === 'a')), { inferred: 3 }, 'only what is drawn counts');
  assert.deepEqual(c.tagCounts, tagCountsOf(c.rows));
});

test('a snapshot without a time axis has no chart', () => {
  assert.equal(chartModel({ inspection: { model: { processes: [] } }, timeUnit: '' }).available, false);
});

test('the chart modules hold no assumption from one particular model', () => {
  for (const file of ['chart-model.js', 'chart-view.js']) {
    const source = readFileSync(new URL(`../viewer/public/${file}`, import.meta.url), 'utf8');
    for (const word of [/\bh\.[a-z]/u, /'ev\./u, /humanity/iu, /\bregion-/u, /top_10'/u, /billion people/u, /\b2026\b/u, /Earth/u]) assert.doesNotMatch(source, word, `${file} must not name ${word}`);
  }
});
