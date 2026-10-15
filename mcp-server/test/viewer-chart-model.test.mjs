import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { projectScalarSeries } from '../src/viewer-scalar-series.mjs';
import { chartModel, packLanes, chartAxis, axisFraction, axisTicks, timeLabel, readSeries } from '../viewer/public/chart-model.js';

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

test('a snapshot without a time axis has no chart', () => {
  assert.equal(chartModel({ inspection: { model: { processes: [] } }, timeUnit: '' }).available, false);
});

test('the chart modules hold no assumption from one particular model', () => {
  for (const file of ['chart-model.js', 'chart-view.js']) {
    const source = readFileSync(new URL(`../viewer/public/${file}`, import.meta.url), 'utf8');
    for (const word of [/\bh\.[a-z]/u, /'ev\./u, /humanity/iu, /\bregion-/u, /top_10'/u, /billion people/u, /\b2026\b/u, /Earth/u]) assert.doesNotMatch(source, word, `${file} must not name ${word}`);
  }
});
