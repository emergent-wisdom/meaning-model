// One coverage report for both kinds of record (dated values and series of Cuts):
// a Cut-only model reaches the report, a short life needs its own detail, imagined Events do not stretch the world,
// and the civil-day clock is divided evenly; a block is read only where readings
// cover it, inner contexts do not block the world, a dated life gives a span, and episodes are not series.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverageReport, timeSchedule } from '../src/coverage.mjs';
import { flatStretches } from '../src/model-questions.mjs';
import { coverageSummary, valuesChange } from '../src/values-record.mjs';
import { seriesChange } from '../src/series-record.mjs';
import { applyModelChange } from '../src/model-change.mjs';

const HASH = 'a'.repeat(64);
const flatStretchesOf = (m) => flatStretches(m, null, 100);
const event = (id, start, end = start + 1, extra = {}) => ({ id, boundary: id, interval: { start, end }, process_ids: [], observation_process_ids: [], participants: {}, substrate: null, region: null, provenance: ['sketch: fixture'], ...extra });
const scalar = (id, extra = {}) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1e12 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'u',
  update_mode: 'observed', uncertainty: { kind: 'unknown' }, support: ['s'], provenance: ['sketch: fixture'], access_scopes: [], scale: { label: id, ...extra } });
const model = (meaning, processes = [], series = []) => ({ schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year', revision: { number: 0, previous_model_hash: null, reason: 'r', provenance: ['p'] },
  processes, decomposition: [], dependencies: [], laws: [], initial_claims: [], value_series: series,
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents: [], events: [], event_relations: [], normalized_cuts: [], ...meaning } });
const values = (processId, times, value = 1) => ({ id: `values.${processId}`, process_id: processId, holder: 'm', points: times.map((time) => ({ time, value, tag: 'sketch' })) });

test('a short life is held to its own ends, not to the world grid it falls between', () => {
  const m = model({ events: [event('world', 0, 1000), event('ada.life', 400, 402)], referents: [{ id: 'ada', lifecycle_event_id: 'ada.life', provenance: ['x'] }] },
    [scalar('life.health', { subject_referent_id: 'ada' })], [values('life.health', [401])]);
  const report = coverageReport(m);
  assert.equal(report.done, false);
  assert.deepEqual(report.schedule.next.examples.find((item) => item.id === 'life.health').at, [400, 402]);
  // Its ends filled, the life is held to nothing else at the coarse levels, and only to its own Events at the finest;
  // an Event a moment after birth is met by the value at birth.
  m.value_series = [values('life.health', [400, 401, 402])];
  m.meaning_model.events.push(event('ada.born', 400.005));
  m.meaning_model.event_relations.push({ id: 'c.born', kind: 'contains', source_event_id: 'ada.life', target_event_id: 'ada.born', provenance: ['x'] });
  assert.equal(coverageReport(m).schedule.next?.examples.some((item) => item.id === 'life.health') ?? false, false);
});

test('an imagined Event under another root does not stretch the world the schedule divides', () => {
  const filled = timeSchedule(2000, 2030).levels.at(-1).boundaries;
  const m = model({ events: [event('world', 2000, 2030)] }, [scalar('p')], [values('p', filled)]);
  assert.equal(coverageReport(m).done, true);
  m.meaning_model.events.push(event('mind', 2010, 2020), event('dream', 2500, 2600));
  m.meaning_model.context_roots = [{ event_id: 'mind', kind: 'inner', provenance: ['x'] }];
  m.meaning_model.event_relations.push({ id: 'c', kind: 'contains', source_event_id: 'mind', target_event_id: 'dream', provenance: ['x'] });
  const report = coverageReport(m);
  assert.deepEqual([report.schedule.from, report.schedule.to, report.done], [2000, 2030, true]);
});

test('the civil-day clock and a day unit are divided evenly over thirty years', () => {
  for (const unit of ['civil_day_since_1970', 'days']) {
    const schedule = timeSchedule(0, 10957.275, unit);
    assert.equal(schedule.scale, 'even', unit);
    const finest = schedule.levels.at(-1).boundaries;
    assert.ok(finest.at(-1) - finest.at(-2) > 150, `${unit}: the last block stays a fifty-fourth of the span`);
  }
  assert.equal(timeSchedule(-300000, 2026, 'year').scale, 'log');
});

test('a model of Cuts alone reaches the report: a series is held to its subject\'s life, block by block', () => {
  let m = model({ events: [event('humanity.life', -10000, 2026)], referents: [{ id: 'humanity', lifecycle_event_id: 'humanity.life', provenance: ['x'] }] });
  const series = { id: 'livelihood', question: 'How do people get their food?', unit: 'share of people', answers: [{ key: 'foraging', meaning: 'Wild food.' }, { key: 'farming', meaning: 'Grown food.' }] };
  const reading = (start, end, farming) => ({ start, end, weights: { foraging: 1 - farming, farming }, tag: 'sketch', why: 'a first guess' });
  m = applyModelChange(m, HASH, seriesChange(m, { subject: 'humanity', series, readings: [reading(-10000, 2026, 0.6)], reason: 'r' })).successor;
  let summary = coverageSummary(m);
  assert.deepEqual([summary.tracks, summary.done, summary.schedule.reached, summary.schedule.next.level], [1, false, 1, 2]);
  assert.match(summary.next.join('\n'), /value\(s\) or reading\(s\) at this level, such as "How do people get their food\?" over/u);
  // Readings over the six blocks of the next level fill it.
  const blocks = timeSchedule(-10000, 2026).levels[1].boundaries;
  m = applyModelChange(m, HASH, seriesChange(m, { subject: 'humanity', series, readings: blocks.slice(1).map((end, i) => reading(blocks[i], end, Math.min(0.99, 0.1 + i * 0.15))), reason: 'r' })).successor;
  summary = coverageSummary(m);
  assert.equal(summary.schedule.reached, 2);
});

test('done waits for a reading left flat over a stretch where Events happen', () => {
  let m = model({ events: [event('kim.life', 2000, 2030), event('job', 2010), event('move', 2015), event('loss', 2020)],
    referents: [{ id: 'kim', lifecycle_event_id: 'kim.life', provenance: ['x'] }],
    event_relations: ['job', 'move', 'loss'].map((id) => ({ id: `c.${id}`, kind: 'contains', source_event_id: 'kim.life', target_event_id: id, provenance: ['x'] })) });
  const series = { id: 'outlook', question: 'How does Kim expect things to turn out?', unit: 'share of outlook', answers: [{ key: 'hope', meaning: 'Hope.' }, { key: 'dread', meaning: 'Dread.' }] };
  const finest = timeSchedule(2000, 2030).levels.at(-1).boundaries;
  // Fine readings everywhere except one long reading over the three Events, which nothing finer opens.
  const readings = finest.slice(1).map((end, i) => ({ start: finest[i], end, weights: { hope: 0.5, dread: 0.5 }, tag: 'sketch', why: 'w' }))
    .filter((r) => r.end <= 2008 || r.start >= 2022);
  readings.push({ start: 2008, end: 2022, weights: { hope: 0.4, dread: 0.6 }, tag: 'sketch', why: 'w' });
  m = applyModelChange(m, HASH, seriesChange(m, { subject: 'kim', series, readings, reason: 'r' })).successor;
  const summary = coverageSummary(m);
  assert.equal(summary.done, false);
  assert.ok(summary.flatCount >= 1);
  assert.match(summary.next.join('\n'), /span a stretch of a life where Events happen/u);
});

test('a world told in Cuts reaches done once its one declared process has its values too, and done:false always says why', () => {
  // The engine needs one process in every model; this world declares population and tells the rest as a series.
  let m = model({ events: [event('world.life', 1900, 2000)], referents: [{ id: 'world', lifecycle_event_id: 'world.life', provenance: ['x'] }] }, [scalar('population')]);
  const series = { id: 'work', question: 'How do people earn their living?', unit: 'share of people', answers: [{ key: 'land', meaning: 'Farming.' }, { key: 'wage', meaning: 'Wages.' }] };
  const finest = timeSchedule(1900, 2000).levels.at(-1).boundaries;
  const readings = finest.slice(1).map((end, i) => ({ start: finest[i], end, weights: { land: 0.8 - i * 0.01, wage: 0.2 + i * 0.01 }, tag: 'sketch', why: 'w' }));
  m = applyModelChange(m, HASH, seriesChange(m, { subject: 'world', series, readings, reason: 'r' })).successor;
  let summary = coverageSummary(m);
  assert.deepEqual([summary.done, summary.schedule.reached, summary.stillEmptyCount], [false, 4, 1]);
  assert.match(summary.next[0], /^By the coverage report's measure this pass is not done: 1 process\(es\) have no state\./u);
  assert.match(summary.next[1], /^Guess the state of 1 process\(es\) that have none, beginning with population/u);
  m.value_series = [values('population', finest)];
  summary = coverageSummary(m);
  assert.equal(summary.done, true);
  assert.match(summary.next[0], /^This pass is done by the coverage report's measure/u);
});

test('a Cut read once by hand is not a series: a story\'s single cause is never asked to fill the schedule', () => {
  const m = model({ events: [event('hall.life', 1896, 2020), event('night', 1971, 1971.01)], referents: [{ id: 'hall', lifecycle_event_id: 'hall.life', provenance: ['x'] }],
    event_relations: [{ id: 'c.night', kind: 'contains', source_event_id: 'hall.life', target_event_id: 'night', provenance: ['x'] }],
    normalized_cuts: [{ id: 'why', parent_event_id: 'night', question: 'Why does line 14 not answer?', unit: 'causal share', answers: [{ key: 'asleep', weight: 0.6 }, { key: 'ill', weight: 0.4 }], provenance: ['authored'] }] });
  const report = coverageReport(m);
  assert.deepEqual([report.tracks, report.done], [0, false]);
  assert.match(report.next.join('\n'), /Nothing is followed over time yet/u);
  // Asked again of a second incident, it is still two assessments of two episodes, not a series.
  m.meaning_model.events.push(event('morning', 1972, 1972.01));
  m.meaning_model.event_relations.push({ id: 'c.morning', kind: 'contains', source_event_id: 'hall.life', target_event_id: 'morning', provenance: ['x'] });
  m.meaning_model.normalized_cuts.push({ ...m.meaning_model.normalized_cuts[0], id: 'why.later', parent_event_id: 'morning' });
  assert.equal(coverageReport(m).tracks, 0);
});

// Regression cases for partial coverage, perspective boundaries, and dated lives.
const life = (id, start, end) => ({ events: [event(`${id}.life`, start, end)], referents: [{ id, lifecycle_event_id: `${id}.life`, provenance: ['x'] }] });
const reading = (start, end, share) => ({ start, end, weights: { up: share, down: 1 - share }, tag: 'sketch', why: 'w' });
const SERIES = { id: 'mood', question: 'How does Kim feel about the work?', unit: 'share of feeling', answers: [{ key: 'up', meaning: 'Glad.' }, { key: 'down', meaning: 'Weary.' }] };

test('a block is read only where readings cover it: slivers and touching readings do not count, a tiling does', () => {
  const finest = timeSchedule(0, 54).levels.at(-1).boundaries;
  const world = (readings) => {
    let m = model(life('kim', 0, 54), [scalar('p')], [values('p', finest)]);
    m = applyModelChange(m, HASH, seriesChange(m, { subject: 'kim', series: SERIES, readings, reason: 'r' })).successor;
    return coverageSummary(m);
  };
  // 27 readings of 0.002 years, at 1, 3, … 53, cover 0.054 of 54 years.
  const slivers = world(Array.from({ length: 27 }, (_, i) => reading(2 * i + 1 - 0.001, 2 * i + 1 + 0.001, 0.5)));
  assert.equal(slivers.tracks, 2);
  assert.deepEqual([slivers.done, slivers.schedule.reached], [false, 0]);
  // Every finest block read but the two beside 27, which hold only a sliver across that boundary: the sliver reads
  // neither, so each level lacks the blocks around 27, and the whole life is not read either (two years are missing).
  const tiles = finest.slice(1).map((b, i) => reading(finest[i], b, 0.4)).filter((r) => r.start !== 26 && r.start !== 27);
  const across = world([...tiles, reading(26.995, 27.005, 0.5)].sort((x, y) => x.start - y.start));
  assert.deepEqual([across.schedule.reached, across.schedule.next.level, across.schedule.next.missing], [0, 1, 1]);
  assert.deepEqual(across.schedule.later, [{ level: 2, missing: 2 }, { level: 3, missing: 2 }, { level: 4, missing: 2 }]);
  // Readings that tile every finest block read them all, including authored boundaries that miss by a rounding.
  const tiled = world(finest.slice(1).map((b, i) => reading(finest[i], i % 2 ? b : b - (b - finest[i]) * 0.005, 0.3 + i / 200)));
  assert.deepEqual([tiled.done, tiled.schedule.reached], [true, 4]);
});

test('a character\'s inner view keeps nothing in the accepted world from being done', () => {
  const finest = timeSchedule(2000, 2030).levels.at(-1).boundaries;
  const m = model({ events: [event('kim.life', 2000, 2030), event('kim.inner', 2000, 2030), event('kim.view', 2002, 2028), event('kim.mood', 2002, 2028), event('dream.1', 2010), event('dream.2', 2015)],
    referents: [{ id: 'kim', lifecycle_event_id: 'kim.life', provenance: ['x'] }], context_roots: [{ event_id: 'kim.inner', kind: 'inner', provenance: ['x'] }],
    event_relations: [['kim.life', 'kim.inner'], ['kim.inner', 'kim.view'], ['kim.inner', 'dream.1'], ['kim.inner', 'dream.2'], ['kim.life', 'kim.mood']]
      .map(([source, target]) => ({ id: `c.${target}`, kind: 'contains', source_event_id: source, target_event_id: target, provenance: ['x'] })),
    normalized_cuts: ['kim.view', 'kim.mood'].map((id) => ({ id: `cut.${id}`, parent_event_id: id, question: `What is ${id}?`, unit: 'share', answers: [{ key: 'a', weight: 0.5 }, { key: 'b', weight: 0.5 }], provenance: ['authored'] })) },
  [scalar('p')], [values('p', finest)]);
  // Neither the inner reading over the dreams nor the world's reading, whose stretch holds only dreamed Events, is flat.
  const report = coverageReport(m);
  assert.deepEqual([report.done, report.flatCount], [true, 0]);
  // The series tool's own question about the inner view still asks for it.
  assert.ok(flatStretchesOf(m).some((item) => item.cut === 'cut.kim.view'));
});

test('a dated life with one value gives the schedule its span; a life imagined elsewhere does not', () => {
  // A life of 0 to 54, one value at 27, nothing else dated.
  const m = model(life('ada', 0, 54), [scalar('ada.health', { subject_referent_id: 'ada' })], [values('ada.health', [27])]);
  const report = coverageReport(m);
  assert.deepEqual([report.schedule.from, report.schedule.to, report.schedule.reached], [0, 54, 0]);
  assert.match(report.next.join('\n'), /ada\.health at 0, 54/u);
  // A person dreamed under an inner root lends the world no years.
  const dreamt = model({ events: [event('world', 2000, 2030), event('mind', 2000, 2030), event('ghost.life', 1700, 2600)], referents: [{ id: 'ghost', lifecycle_event_id: 'ghost.life', provenance: ['x'] }],
    context_roots: [{ event_id: 'mind', kind: 'inner', provenance: ['x'] }], event_relations: [{ id: 'c.ghost', kind: 'contains', source_event_id: 'mind', target_event_id: 'ghost.life', provenance: ['x'] }] },
  [scalar('ghost.mood', { subject_referent_id: 'ghost' })], [values('ghost.mood', [2010, 2020])]);
  assert.deepEqual([coverageReport(dreamt).schedule.from, coverageReport(dreamt).schedule.to], [2000, 2030]);
  // With nothing dated but one moment, the report says what to do.
  const one = model({ events: [] }, [scalar('p')], [values('p', [5])]);
  assert.match(coverageReport(one).next[0], /Every record so far sits at one moment/u);
});

test('a question asked by hand is a series only when its readings join into one stretch, and it is held to that stretch', () => {
  const asked = (pairs) => {
    // The nation's founding in 1800 opens the world's span a century before the question is first asked.
    const m = model({ ...life('nation', 1800, 2000), normalized_cuts: [] });
    m.meaning_model.events.push(event('founding', 1800));
    m.meaning_model.event_relations.push({ id: 'c.founding', kind: 'contains', source_event_id: 'nation.life', target_event_id: 'founding', provenance: ['x'] });
    pairs.forEach(([start, end], i) => {
      m.meaning_model.events.push(event(`e${i}`, start, end));
      m.meaning_model.event_relations.push({ id: `c${i}`, kind: 'contains', source_event_id: 'nation.life', target_event_id: `e${i}`, provenance: ['x'] });
      m.meaning_model.normalized_cuts.push({ id: `cut${i}`, parent_event_id: `e${i}`, question: 'Why does the nation go to war?', unit: 'causal share', answers: [{ key: 'land', weight: 0.5 }, { key: 'pride', weight: 0.5 }], provenance: ['authored'] });
    });
    return coverageReport(m);
  };
  // Two five-year wars three years apart are two assessments, not a series.
  assert.equal(asked([[1900, 1905], [1908, 1913]]).tracks, 0);
  // Periods that join end to end are a series, held to the stretch they read, not to the whole life.
  const periods = asked([[1900, 1920], [1920, 1950], [1950, 1971]]);
  assert.deepEqual([periods.tracks, periods.schedule.from], [1, 1800]);
  assert.match(periods.next.join('\n'), /"Why does the nation go to war\?" over 1900–/u);
  assert.doesNotMatch(periods.next.join('\n'), /over 18\d\d–/u);
});

// Declaring the accepted-world root must preserve the world's temporal extent.
test('declaring the world its accepted-world root keeps its dates in the span', () => {
  // The world spans 0 to 100, population is guessed only across 50 to 51.
  const sampled = timeSchedule(50, 51).levels.at(-1).boundaries;
  const world = () => model({ events: [event('world', 0, 100, { process_ids: ['population'] })] }, [scalar('population')], [values('population', sampled)]);
  const plain = coverageReport(world());
  const rooted = world();
  rooted.meaning_model.context_roots = [{ event_id: 'world', kind: 'accepted_world', provenance: ['x'] }];
  const declared = coverageReport(rooted);
  for (const report of [plain, declared]) assert.deepEqual([report.schedule.from, report.schedule.to, report.done], [0, 100, false]);
});

// Steady readings cover finer blocks while retaining checks on eventful stretches.
test('a reading marked steady covers the finer blocks inside it; an unmarked long one does not', () => {
  const finest = timeSchedule(0, 54).levels.at(-1).boundaries;
  const world = (steady) => {
    let m = model(life('kim', 0, 54), [scalar('p')], [values('p', finest)]);
    m = applyModelChange(m, HASH, seriesChange(m, { subject: 'kim', series: SERIES, readings: [{ ...reading(0, 54, 0.6), ...(steady ? { steady: true, why: 'Kim never changes her mind about the work.' } : {}) }], reason: 'r' })).successor;
    return { m, summary: coverageSummary(m) };
  };
  const held = world(true);
  assert.deepEqual([held.summary.done, held.summary.schedule.reached, held.summary.steadyCount], [true, 4, 1]);
  // The mark follows the tag, which stays first in the reading's provenance.
  const event = held.m.meaning_model.events.find((item) => (item.provenance ?? []).includes('Meaning Model steady reading v1'));
  assert.match(event.provenance[0], /^sketch: Kim never changes her mind/u);
  const unmarked = world(false).summary;
  assert.deepEqual([unmarked.done, unmarked.schedule.reached, unmarked.steadyCount], [false, 1, 0]);
  // Every one of the 54 finest blocks lacks a reading no longer than half again its own length.
  assert.equal(unmarked.schedule.remaining, 54);
});

test('a steady reading over a stretch where the subject\'s own Events happen is still asked about', () => {
  const finest = timeSchedule(0, 54).levels.at(-1).boundaries;
  let m = model(life('kim', 0, 54), [scalar('p')], [values('p', finest)]);
  for (const [id, at] of [['job', 10], ['move', 20], ['loss', 30]]) {
    m.meaning_model.events.push(event(id, at));
    m.meaning_model.event_relations.push({ id: `c.${id}`, kind: 'contains', source_event_id: 'kim.life', target_event_id: id, provenance: ['x'] });
  }
  m = applyModelChange(m, HASH, seriesChange(m, { subject: 'kim', series: SERIES, readings: [{ ...reading(0, 54, 0.6), steady: true }], reason: 'r' })).successor;
  const summary = coverageSummary(m);
  assert.deepEqual([summary.done, summary.schedule.reached, summary.flatCount], [false, 4, 1]);
  assert.match(summary.next[0], /1 reading\(s\) are left flat/u);
});

test('in a story the same measure names the gaps the story may depend on, without holding it to the grid', () => {
  const before = process.env.MEANING_MODEL_ADDONS;
  process.env.MEANING_MODEL_ADDONS = 'storytelling';
  try {
    const m = model(life('ada', 0, 54), [scalar('ada.health', { subject_referent_id: 'ada' })], [values('ada.health', [0, 27, 54])]);
    const status = coverageReport(m).next[0];
    assert.match(status, /^By the coverage report's measure the world beneath the story still has gaps: the time schedule lacks \d+ value\(s\) or reading\(s\) in all/u);
    assert.match(status, /Fill the ones the story depends on, in the model and in the prose, and record the rest for another pass/u);
    assert.doesNotMatch(status, /this pass is not done/u);
  } finally {
    if (before === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = before;
  }
});

// Unrelated detail must not clear eventful stretches or expand a story's scope.
test('a sliver inside a steady reading does not clear an eventful life; finer readings across its Events do', () => {
  const finest = timeSchedule(0, 54).levels.at(-1).boundaries;
  const kim = (readings) => {
    let m = model(life('kim', 0, 54), [scalar('p')], [values('p', finest)]);
    for (const [id, at] of [['job', 10], ['move', 20], ['loss', 30]]) {
      m.meaning_model.events.push(event(id, at));
      m.meaning_model.event_relations.push({ id: `c.${id}`, kind: 'contains', source_event_id: 'kim.life', target_event_id: id, provenance: ['x'] });
    }
    m = applyModelChange(m, HASH, seriesChange(m, { subject: 'kim', series: SERIES, readings, reason: 'r' })).successor;
    return coverageSummary(m);
  };
  const steady = { ...reading(0, 54, 0.6), steady: true };
  // One tiny reading at the start of the life.
  const tiny = kim([steady, reading(0, 0.01, 0.6)]);
  assert.deepEqual([tiny.done, tiny.flatCount], [false, 1]);
  assert.match(tiny.next[0], /1 reading\(s\) are left flat/u);
  // A sliver just before every Event reads none of them more closely.
  const slivers = kim([steady, reading(9.99, 10, 0.6), reading(19.99, 20, 0.6), reading(29.99, 30, 0.6)]);
  assert.deepEqual([slivers.done, slivers.flatCount], [false, 1]);
  // Readings that change at the Events open the life, and the pass is done.
  const opened = kim([steady, reading(0, 10, 0.6), reading(10, 20, 0.5), reading(20, 30, 0.4), reading(30, 54, 0.6)]);
  assert.deepEqual([opened.done, opened.flatCount], [true, 0]);
});

test('in a story the schedule line asks for the gaps the story depends on, not the whole grid', () => {
  const before = process.env.MEANING_MODEL_ADDONS;
  process.env.MEANING_MODEL_ADDONS = 'storytelling';
  try {
    const m = model(life('ada', 0, 54), [scalar('ada.health', { subject_referent_id: 'ada' })], [values('ada.health', [0, 27, 54])]);
    const lines = coverageReport(m).next;
    assert.match(lines[1], /^Where the story depends on them, fill the gaps the time schedule shows, level by level: level 2 of 4/u);
    assert.ok(!lines.some((line) => line.startsWith('Fill the time schedule level by level')));
  } finally {
    if (before === undefined) delete process.env.MEANING_MODEL_ADDONS; else process.env.MEANING_MODEL_ADDONS = before;
  }
});

// Half-open interval boundaries and complete fine coverage at different scales.
test('a finer reading opens an Event only if the Event begins inside it, and complete fine detail of any grain counts', () => {
  const life54 = (end, moments, readings) => {
    const finest = timeSchedule(0, end).levels.at(-1).boundaries;
    let m = model(life('kim', 0, end), [scalar('p')], [values('p', finest)]);
    moments.forEach((at, i) => {
      m.meaning_model.events.push(event(`happening${i}`, at));
      m.meaning_model.event_relations.push({ id: `c.h${i}`, kind: 'contains', source_event_id: 'kim.life', target_event_id: `happening${i}`, provenance: ['x'] });
    });
    m = applyModelChange(m, HASH, seriesChange(m, { subject: 'kim', series: SERIES, readings, reason: 'r' })).successor;
    const summary = coverageSummary(m);
    return [summary.done, summary.flatCount];
  };
  const tiles = (end) => { const finest = timeSchedule(0, end).levels.at(-1).boundaries; return finest.slice(1).map((b, i) => reading(finest[i], b, 0.6)); };
  const steady = (end) => ({ ...reading(0, end, 0.6), steady: true });
  // Intervals are half-open: readings ending where each Event begins say nothing of it; readings starting there do.
  assert.deepEqual(life54(54, [10, 20, 30], [steady(54), reading(9, 10, 0.6), reading(19, 20, 0.6), reading(29, 30, 0.6)]), [false, 1]);
  assert.deepEqual(life54(54, [10, 20, 30], [steady(54), reading(10, 11, 0.6), reading(20, 21, 0.6), reading(30, 31, 0.6)]), [true, 0]);
  // A complete tiling stays done when a broad steady reading is added over it, at an even grain and at the log
  // schedule's finest grain near the present, where every reading is far under a hundredth of the whole.
  assert.deepEqual(life54(54, [10, 20, 30], tiles(54)), [true, 0]);
  assert.deepEqual(life54(54, [10, 20, 30], [steady(54), ...tiles(54)]), [true, 0]);
  assert.deepEqual(life54(20000, [19900, 19920, 19950], tiles(20000)), [true, 0]);
  assert.deepEqual(life54(20000, [19900, 19920, 19950], [steady(20000), ...tiles(20000)]), [true, 0]);
});
