import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { temporalWindow, nativeTimeText, numericTimeTicks, calendarDateOf, calendarTimeOf, calendarTickAt } from '../viewer/public/temporal-layout.js';

test('dated Events provide the original view window without creating numeric paths', () => {
  const data = { timeUnit: 'year', events: [{ start: 1800, end: 1810 }, { start: 1818, end: 1820 }], measures: [] };
  const before = structuredClone(data); const range = temporalWindow(data);
  assert.ok(range.start < 1800 && range.end > 1820);
  assert.equal(range.source, 'events');
  assert.deepEqual(data, before);
});

test('numeric path framing remains compatible with the existing original view', () => {
  assert.deepEqual(temporalWindow({ timeUnit: 'year', storyWindow: { start: 2001, end: 2004 },
    measures: [{ points: [{ t: 2000, v: 4 }, { t: 2005, v: 9 }] }] }), { start: 2000.6, end: 2005.12, source: 'samples' });
});

test('hour and tick models retain native numeric time and use no calendar or parsed support dates', () => {
  for (const unit of ['hour', 'day', 'tick', 'second']) {
    const data = { timeUnit: unit, events: [{ start: -2, end: 10 }],
      measures: [{ points: [{ t: 2000, v: 0 }, { t: 2001, v: 1 }] }] };
    const before = structuredClone(data); const range = temporalWindow(data);
    assert.equal(range.source, 'events'); assert.ok(range.start < -2 && range.end > 10 && range.end < 11);
    assert.equal(nativeTimeText(1.5, unit), `1.5 ${unit}`);
    const ticks = numericTimeTicks(range.start, range.end);
    assert.ok(ticks.includes(0)); assert.ok(ticks.length > 2 && ticks.length <= 12);
    assert.ok(ticks.every((tick) => Number.isFinite(tick) && tick >= range.start && tick <= range.end));
    assert.deepEqual(data, before);
  }
});

test('single dated instants get camera room without becoming durations; undated and conceptual-only models get no axis', () => {
  const event = { start: 7, end: 7 };
  const range = temporalWindow({ timeUnit: 'hour', events: [event] });
  assert.ok(range.start < 7 && range.end > 7); assert.deepEqual(event, { start: 7, end: 7 });
  assert.equal(temporalWindow({ timeUnit: 'hour', events: [{ reach: [1, 2] }] }), null);
  assert.equal(temporalWindow({ timeUnit: 'hour', events: [{ start: 1, context: 'understanding' }] }), null);
  assert.equal(temporalWindow({ events: [{ start: 1, end: 2 }] }), null);
  assert.deepEqual(numericTimeTicks(1, 1), []);
  assert.deepEqual(numericTimeTicks(NaN, 2), []);
});

// Execute the actual scene helper bodies; no WebGL is needed to catch the
// empty-row failures that previously left Book of Conditions unrenderable.
const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const fn = (name) => { const start = source.indexOf(`function ${name}(`); const end = source.indexOf('\n}', start); assert.ok(start >= 0 && end > start); return source.slice(start, end + 2); };

test('civil-day display coordinates preserve exact dates before and after 1970, including leap days', () => {
  const unit = 'civil_day_since_1970_01_01';
  for (const iso of ['1843-08-18', '1844-02-29', '1900-03-01', '1969-12-31', '1970-01-01', '2000-02-29', '2024-02-29']) {
    const milliseconds = Date.parse(`${iso}T00:00:00Z`);
    const nativeDays = milliseconds / 86400000;
    const displayTime = 1970 + nativeDays / 365.2425; // The existing data adapter's encoding.
    assert.equal(calendarDateOf(displayTime, unit).toISOString(), `${iso}T00:00:00.000Z`, iso);
    assert.equal(calendarTimeOf(new Date(milliseconds), unit), displayTime);
    const [year, month, day] = iso.split('-').map(Number);
    assert.equal(calendarTickAt(year, month - 1, day, unit), displayTime);
  }
  const noon = new Date('1843-08-18T12:00:00.000Z');
  assert.equal(calendarDateOf(calendarTimeOf(noon, unit), unit).toISOString(), noon.toISOString(), 'fractional days remain fractional');
  for (const time of [1843, 1843.625, 2000.5, 2024.25]) {
    const expected = Math.round(Date.UTC(Math.floor(time), 0, 1) + (time - Math.floor(time)) * 365.2425 * 86400000);
    assert.equal(calendarDateOf(time, 'year').getTime(), expected, 'year coordinates retain their existing fractional-year scale');
  }
});

test('actual civil-day labels and day/month/year ticks use the same exact calendar coordinates', () => {
  const unit = 'civil_day_since_1970_01_01';
  const coordinate = (iso) => calendarTimeOf(new Date(`${iso}T00:00:00Z`), unit);
  const a = coordinate('1844-02-27'), b = coordinate('1844-03-03');
  const context = { calendarTime: true, data: { timeUnit: unit }, F: { a, b, s: b - a }, T0: a, T1: b,
    PRESENT: 2026, calendarDateOf, calendarTimeOf, calendarTickAt, nativeTimeText, numericTimeTicks,
    MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    isStory: () => false, X: (t) => (t - a) / (b - a) * 116,
    grouped: String, yearText: String };
  vm.createContext(context);
  const dateLine = source.split('\n').find((line) => line.startsWith('const dateOf ='));
  const monthLine = source.split('\n').find((line) => line.startsWith('const month ='));
  vm.runInContext(`${dateLine}\n${monthLine}\n${fn('timeText')}\n${fn('tickMarks')}\nthis.month = month;`, context);
  assert.equal(context.timeText(coordinate('1843-08-18'), 1), '18 Aug 1843');
  assert.equal(context.timeText(coordinate('1844-02-29'), 1), '29 Feb 1844');
  assert.equal(context.month(coordinate('1969-12-31')), 'December 1969');
  assert.equal(context.month(coordinate('1970-01-01')), 'January 1970');
  const ticks = context.tickMarks();
  assert.ok(ticks.some((tick) => tick.text === '29 Feb' && tick.t === coordinate('1844-02-29')));
  assert.ok(ticks.some((tick) => tick.text === 'Mar 1844' && tick.t === coordinate('1844-03-01')));
  context.isStory = () => true;
  context.T0 = coordinate('1843-12-31'); context.T1 = coordinate('1845-01-02');
  const years = context.tickMarks();
  assert.deepEqual(Array.from(years, (tick) => [tick.text, calendarDateOf(tick.t, unit).toISOString().slice(0, 10)]), [['1844', '1844-01-01'], ['1845', '1845-01-01']]);
});

test('an Event and its recorded decision anchor correctly with no numeric process rows', () => {
  const position = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
  const node = { id: 'choice' };
  const context = {
    rows: [], rowOf: new Map(), sourceEventRows: new Map(), groups: [], F: { a: 0, b: 10 }, BAR: 0.3, X: (time) => time, xOf: (time) => time, nearestShown: () => node,
    nodeAt: () => ({ y: 4, z: 6 }), opt: { layout: 'layers' }, principals: [],
    THREE: { Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } } },
    anchor: (id, time) => id === 'choice' ? { x: time, y: 4.3, z: 6 } : null,
  };
  vm.createContext(context); vm.runInContext(`${fn('rowsForEvent')}\n${fn('eventPoint')}\n${fn('layOnFront')}`, context);
  const point = context.eventPoint({ id: 'choice', start: 3 });
  assert.deepEqual([point.x, point.y, point.z], [3, 4.3, 6]);
  const meetStart = source.indexOf('const meet ='); const meetEnd = source.indexOf('\n};', meetStart);
  vm.runInContext(`${source.slice(meetStart, meetEnd + 3)}\nthis.meet = meet;`, context);
  const noteAnchor = context.meet({ id: 'choice', start: 3 });
  assert.deepEqual([noteAnchor[0].x, noteAnchor[0].y, noteAnchor[0].z], [3, 4.3, 6], 'a declared document link reaches its Event without a numeric row');
  const decision = { position, userData: { eventId: 'choice', t: 3, own: [], lift: 2.2 } };
  context.layOnFront(decision);
  assert.equal(decision.userData.placed, true);
  assert.deepEqual([position.x, position.y, position.z], [3, 6.5, 6.8]);
  decision.userData.eventId = 'unplaced'; context.layOnFront(decision);
  assert.equal(decision.userData.placed, false, 'an unplaced decision does not get an invented position');
});

test('in the tree a decision over its person\'s curves moves onto the floor of the Event it decides', () => {
  const position = { set(x, y, z) { Object.assign(this, { x, y, z }); }, lerp(target, m) { for (const key of ['x', 'y', 'z']) this[key] += (target[key] - this[key]) * m; } };
  const row = { id: 'curve' }, node = { id: 'choice' };
  const context = { xOf: (time) => time, presence: () => 1, rowValue: () => 0.5, rowAt: () => ({ y: 10, z: 20 }), heightAt: () => 2, frontOf: (own) => own[0],
    smooth: (value) => value, blend: { now: 0 }, THREE: { Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } } },
    anchor: (id, time) => id === 'choice' ? { x: time, y: 4.3, z: 6, node } : null };
  vm.createContext(context); vm.runInContext(fn('layOnFront'), context);
  const decision = { position, userData: { eventId: 'choice', t: 3, own: [row], lift: 2.2 } };
  context.layOnFront(decision);
  assert.deepEqual([position.x, position.y, position.z], [3, 14.2, 20.8], 'in the processes it stands over the person\'s front curve');
  context.blend.now = 1; context.layOnFront(decision);
  assert.deepEqual([position.x, position.y, position.z].map((value) => Math.round(value * 1e6) / 1e6), [3, 6.5, 6.8], 'in the tree it stands over its Event, as it would with no curves');
});

test('the same axis functions label a native-clock model in its declared unit', () => {
  const context = { calendarTime: false, data: { timeUnit: 'hour' }, F: { a: -1, b: 7, s: 8 }, nativeTimeText, numericTimeTicks };
  vm.createContext(context); vm.runInContext(`${fn('timeText')}\n${fn('tickMarks')}`, context);
  assert.equal(context.timeText(2.5), '2.5 hour');
  assert.ok(context.tickMarks().every((tick) => tick.text.endsWith(' hour')));
});
