import test from 'node:test';
import assert from 'node:assert/strict';
import { projectScalarSeries } from '../src/viewer-scalar-series.mjs';
import { projectNumerics } from '../src/viewer-numerics.mjs';

// The real Chart and session coordinator on a small fake DOM: only what the Chart touches is there.
class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attrs = {}; this.handlers = {}; this.hidden = false;
    this.style = { setProperty(key, value) { this[key] = value; } }; this.classes = new Set();
    this.classList = { add: (...v) => v.forEach((x) => this.classes.add(x)), remove: (...v) => v.forEach((x) => this.classes.delete(x)), contains: (x) => this.classes.has(x),
      toggle: (x, on) => { on ??= !this.classes.has(x); if (on) this.classes.add(x); else this.classes.delete(x); return on; } };
    this.clientWidth = 1000; this.clientHeight = 700; this.offsetTop = 50; this.offsetWidth = 120; this.scrollTop = 0; this.text = '';
  }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((node) => node.textContent).join(''); }
  append(...nodes) { for (let node of nodes) { if (!(node instanceof Node)) { const text = new Node('#text'); text.textContent = node; node = text; } node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; this.text = ''; this.append(...nodes); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; } }
  all() { return this.children.flatMap((node) => [node, ...node.all()]); }
  matches(selector) { return selector.startsWith('.') ? selector.split('.').filter(Boolean).every((x) => this.classes.has(x)) : this.tagName.toLowerCase() === selector; }
  querySelectorAll(selector) { return this.all().filter((node) => selector.split(',').some((part) => node.matches(part.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { for (let node = this; node; node = node.parent) if (selector.split(',').some((part) => node.matches(part.trim()))) return node; return null; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'hidden') this.hidden = true; if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value); if (key === 'class') this.className = value; }
  getAttribute(key) { return this.attrs[key]; }
  addEventListener(name, handler) { (this.handlers[name] ??= []).push(handler); }
  fire(name, event = {}) { for (const handler of this.handlers[name] ?? []) handler({ target: this, stopPropagation() {}, preventDefault() {}, ...event }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; }
  getContext() { return null; }
  scrollTo({ top }) { this.scrollTop = top; }
}
globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), hidden: true };
globalThis.location = { search: '', href: 'https://example.test/' };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
const { showChart } = await import('../viewer/public/chart-view.js');
const { chartModel } = await import('../viewer/public/chart-model.js');
const { createViewerSession } = await import('../viewer/public/viewer-session.js');
const { noteAddress } = await import('../viewer/public/chosen-view.js');
const { openingView, viewAddress } = await import('../viewer/public/view-settings.js');

// One Event and one process, held in one series that rises from 5 to 10 over ten days.
const series = (id, v = 5, holder = 'alice', processId = 'p') => ({ id, processId, holder, unit: 'litre', interpolation: { kind: 'linear-visual-guide' },
  points: [{ t: 0, v, tag: 'source' }, { t: 10, v: v * 2, tag: 'source' }] });
const process = (id, label) => ({ id, unit: 'litre', value_type: { kind: 'scalar' }, scale: { label } });
const model = { time_unit: 'day', processes: [process('p', 'Level')], decomposition: [], meaning_model: { events: [{ id: 'e', boundary: 'An event', interval: { start: 2, end: 3 } }] } };
const data = { timeUnit: 'day', events: [{ id: 'e', label: 'An event', start: 2, end: 3, context: 'accepted_world' }], typedScalarSeries: [series('s')], inspection: { model } };
const mount = (snapshot, onSelect, options = {}) => { const host = new Node(), tools = new Node(); const chart = showChart(snapshot, { host, tools, onSelect, ...options }); return { host, chart, tools }; };
const title = (host) => host.querySelector('.cv-title').textContent;
const lit = (host) => host.querySelectorAll('.cv-selcol').some((node) => !node.hidden);
// Where to click on the chart for a moment: the plot starts after the row names and keeps a margin at each end.
const clickAt = (host, snapshot, t) => {
  const { axis } = chartModel(snapshot), stub = 240, padL = 10, padR = 48, plot = 1000 - stub;
  host.querySelector('.cv-scroll').fire('click', { clientX: padL + ((t - axis.start) / (axis.end - axis.start)) * (plot - padL - padR) });
};

test('a selection cleared in another view, or one the Chart cannot show, closes what the Chart had open', () => {
  const sent = [];
  const { host, chart } = mount(data, (selection) => sent.push(selection));
  chart.activate('chart', { selection: { kind: 'event', id: 'e' } });
  assert.equal(title(host), 'An event'); assert.ok(lit(host), 'the opened Event is highlighted');
  chart.deactivate(); chart.activate('chart', {});
  assert.equal(title(host), 'An event', 'a state that says nothing of the selection keeps what is open');
  chart.deactivate(); chart.activate('chart', { selection: null });
  assert.equal(title(host), 'How to read this chart', 'a cleared selection returns to the guide');
  assert.ok(!lit(host), 'nothing is highlighted');
  for (const elsewhere of [{ kind: 'normalized_cut', id: 'cut.1' }, { kind: 'event_relation', id: 'e.causes.f' }, { kind: 'node', id: 'note.1' }, { kind: 'event', id: 'not.drawn' }, { kind: 'process', id: 'no.row' }]) {
    chart.deactivate(); chart.activate('chart', { selection: { kind: 'event', id: 'e' } });
    assert.equal(title(host), 'An event');
    chart.deactivate(); chart.activate('chart', { selection: elsewhere });
    assert.equal(title(host), 'How to read this chart', `${elsewhere.kind} ${elsewhere.id} leaves no unrelated record open`);
    assert.ok(!lit(host));
  }
  chart.deactivate(); chart.activate('chart', { selection: { kind: 'process', id: 'p' } });
  assert.equal(title(host), 'Level', 'a process the Chart draws still opens');
  assert.deepEqual(sent, [], 'a selection received is never sent back');
});

// A time view as view.js keeps its time: it takes time.now only in story mode, turning to story mode as it does, and
// returns its whole time object.
function timeView(time) {
  return { seen: [], activate(_view, state) { this.seen.push(structuredClone(state.time)); if (state.time?.mode === 'story' && Number.isFinite(state.time.now)) time = { ...time, mode: 'story', now: state.time.now, atEnd: Boolean(state.time.atEnd) }; },
    getState() { return { timeView: 'together', time: { ...time } }; }, deactivate() {}, get time() { return time; },
    // The reader moves the time view's moment.
    setNow(now) { time = { ...time, now, atEnd: false }; } };
}
function sessionWith(snapshot, time) {
  const temporal = timeView(time); let chart = null, host = null;
  const session = createViewerSession({ temporal: true, initialView: 'together', state: {}, mounts: { temporal: () => temporal,
    chart: () => { ({ host, chart } = mount(snapshot, (selection) => session.selectRecord(selection))); return chart; } } });
  return { session, temporal, chart: () => chart, host: () => host };
}

test('the moment pinned in the Chart is the shared time, and a shared time is where the Chart reads its rows', async () => {
  const start = { mode: 'story', now: 1, tau: 3, atEnd: false, start: -0.2, end: 10.4 };
  const one = sessionWith(data, start);
  await one.session.setView('together'); await one.session.setView('chart');
  assert.equal(one.host().querySelector('.cv-row-val').textContent, '~ 5.5', 'the Chart opens at the time view\'s moment');
  assert.equal(one.chart().getState().time, undefined, 'without a moment pinned here the Chart leaves the shared time alone');
  clickAt(one.host(), data, 5.5);
  const pinned = one.chart().getState().time;
  assert.ok(Math.abs(pinned.now - 5.5) < 1e-6, `pinned at ${pinned.now}`);
  assert.deepEqual({ ...pinned, now: 5.5 }, { ...start, now: 5.5 }, 'only now changes');
  await one.session.setView('together');
  assert.equal(one.temporal.time.now, pinned.now, 'back in the time view, it is at the Chart\'s moment');
  assert.deepEqual(one.session.snapshot().time, { ...start, now: pinned.now });

  // A time view following the end is no longer at the end once the Chart pins a moment.
  const two = sessionWith(data, { ...start, now: 10.4, atEnd: true });
  await two.session.setView('together'); await two.session.setView('chart');
  clickAt(two.host(), data, 5.5);
  await two.session.setView('together');
  assert.ok(Math.abs(two.temporal.time.now - 5.5) < 1e-6); assert.equal(two.temporal.time.atEnd, false);

  // The other way: a moment set in the time view is where the Chart reads its rows when it opens again.
  const three = sessionWith(data, { ...start, now: 4 });
  await three.session.setView('together'); await three.session.setView('chart');
  assert.equal(three.host().querySelector('.cv-row-val').textContent, '~ 7', 'rows are read at 4');
  await three.session.setView('together');
  assert.equal(three.temporal.time.now, 4, 'visiting the Chart without pinning keeps the shared time');
  three.temporal.setNow(8);
  await three.session.setView('chart');
  assert.equal(three.host().querySelector('.cv-row-val').textContent, '~ 9', 'rows are read at the time view\'s new moment');

  // A time view in construction mode still takes the Chart's pin: the moment pinned is story time.
  const four = sessionWith(data, { ...start, mode: 'construction' });
  await four.session.setView('together'); await four.session.setView('chart');
  clickAt(four.host(), data, 5.5);
  const sent = four.chart().getState().time;
  assert.equal(sent.mode, 'story'); assert.equal(sent.atEnd, false);
  await four.session.setView('together');
  assert.ok(Math.abs(four.temporal.time.now - 5.5) < 1e-6, `the time view took the Chart's moment, at ${four.temporal.time.now}`);
  assert.equal(four.session.snapshot().time.mode, 'story');
});

test('choosing Nothing under Parts of marks the model\'s view adjusted, so reopening the address keeps focus cleared', () => {
  const snapshot = { ...data, events: [{ id: 'w', label: 'A whole', start: 0, end: 10, context: 'accepted_world' }, { id: 'a', label: 'A part', parent: 'w', start: 1, end: 3, context: 'accepted_world' }] };
  const views = [{ id: 'v1', title: 'The whole', settings: { view: 'chart', focus: 'w' } }];
  const opening = openingView(viewAddress('https://example.test/?data=m', views[0]), views);
  const saved = { location: globalThis.location, history: globalThis.history };
  globalThis.location = { href: opening.href, get search() { return new URL(this.href).search; } };
  globalThis.history = { state: null, replaceState(_state, _title, url) { globalThis.location.href = String(url); } };
  try {
    noteAddress(); // the viewer's first address write is the baseline, as start.js makes it
    const { tools, chart } = mount(snapshot, () => {}, { noteAddress });
    chart.activate('chart');
    const select = tools.querySelectorAll('select').find((node) => node.getAttribute('aria-label') === 'Whose parts run across the top');
    assert.equal(select.value, 'w', 'the model\'s view lays out the parts of w');
    select.value = ''; select.fire('change');
    assert.equal(new URL(location.href).searchParams.get('focus'), null);
    const reopened = openingView(location.href, views);
    assert.equal(reopened.state, 'adjusted');
    assert.equal(new URL(reopened.href).searchParams.get('focus'), null, 'reopening the address keeps Nothing');
  } finally { Object.assign(globalThis, saved); }
});

// A Cut series of two readings: 30% over [0,10] and 90% inside it over a finer interval.
function nestedReadings(finer) {
  const event = (id, extra = {}) => ({ id, boundary: id, participants: {}, process_ids: [], ...extra });
  const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
  const cut = (id, parent_event_id, weight) => ({ id, parent_event_id, question: 'How is effort spent?', unit: 'effort',
    answers: [{ key: 'drive', weight }, { key: 'idle', weight: 1 - weight }, { key: 'remainder', weight: 0 }], provenance: ['inferred: fixture'] });
  const model = { id: 'm', time_unit: 'cycles', processes: [], decomposition: [], meaning_model: {
    referents: [{ id: 'device', boundary: 'A device', lifecycle_event_id: 'life' }], context_roots: [{ event_id: 'world', kind: 'accepted_world' }],
    events: [event('world'), event('life'), event('long', { interval: { start: 0, end: 10 } }), event('short', { interval: { start: finer[0], end: finer[1] } })],
    event_relations: [contains('world', 'life'), contains('life', 'long'), contains('long', 'short')],
    normalized_cuts: [cut('c.long', 'long', 0.3), cut('c.short', 'short', 0.9)] } };
  return { timeUnit: 'cycles', inspection: { model }, numerics: projectNumerics(model),
    events: [{ id: 'long', label: 'Long', start: 0, end: 10, context: 'accepted_world' }, { id: 'short', label: 'Short', parent: 'long', start: finer[0], end: finer[1], context: 'accepted_world' }] };
}

test('a Cut series is drawn as the reading column reads it: the derived level outside a finer reading, nothing where none can hold', () => {
  const snapshot = nestedReadings([2, 4]);
  const { host, chart } = mount(snapshot, () => {}); chart.activate('chart');
  const { axis } = chartModel(snapshot), x = (t) => 10 + ((t - axis.start) / (axis.end - axis.start)) * (760 - 10 - 48);
  // The first answer sits at the bottom of each stack: its share is its height over the row's 88 pixels.
  const firstAnswer = (node, t) => node.querySelector('.cv-row-cut-series').querySelectorAll('rect')
    .filter((r) => r.classes.has('cv-cut-part') && Math.abs(Number(r.attrs.y) + Number(r.attrs.height) - 92) < 0.2)
    .filter((r) => Number(r.attrs.x) <= x(t) && x(t) <= Number(r.attrs.x) + Number(r.attrs.width)).map((r) => Math.round((Number(r.attrs.height) / 88) * 100));
  assert.deepEqual(firstAnswer(host, 1), [15], 'outside the finer reading, the level the rest must average');
  assert.deepEqual(firstAnswer(host, 3), [90]);
  assert.deepEqual(firstAnswer(host, 7), [15]);
  clickAt(host, snapshot, 1);
  assert.equal(host.querySelector('.cv-row-cut-series').querySelector('.cv-share-val').textContent, '15%', 'the reading column says the same');

  // A finer reading that takes more than the longer one allows leaves no level outside it, and none is drawn.
  const tight = nestedReadings([2, 8]);
  const other = mount(tight, () => {}); other.chart.activate('chart');
  assert.deepEqual(firstAnswer(other.host, 1), []); assert.deepEqual(firstAnswer(other.host, 9), []);
  assert.deepEqual(firstAnswer(other.host, 5), [90]);
});

test('each row of several same-holder series opens its own values, and folding a process hides all its rows', () => {
  const claim = (id, t, v, mode, scope) => ({ id, subject: 'p', value: { kind: 'scalar', value: v }, value_time: t, evidence_cutoff: 0, mode,
    evidence_type: mode === 'observed' ? 'report' : 'estimate', holder: 'alice', authority: { source: 'alice', weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: [scope] });
  const claimed = { ...model, initial_claims: [claim('a', -2, 5, 'observed', 'research'), claim('b', 0, 6, 'observed', 'research'), claim('c', -2, 20, 'estimated', 'research'),
    claim('d', 0, 30, 'estimated', 'research'), claim('e', -2, 40, 'observed', 'private'), claim('f', 0, 50, 'observed', 'private')] };
  const snapshot = { ...data, inspection: { model: claimed }, typedScalarSeries: projectScalarSeries(claimed) };
  const { host, chart } = mount(snapshot, () => {}); chart.activate('chart');
  const rows = host.querySelectorAll('.cv-row');
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.querySelector('.cv-row-unit').textContent)).size, 3, 'each stub says what tells it apart');
  const shown = rows.map((row) => { row.querySelector('.cv-row-name').fire('click'); return host.querySelector('.cv-values').querySelectorAll('tr').map((tr) => tr.children[1].textContent); });
  assert.deepEqual(shown.map((values) => values.join('/')).sort(), ['20/30', '40/50', '5/6']);

  const tree = { ...model, processes: [...model.processes, process('root', 'Root')], decomposition: [{ parent: 'root', child: 'p', kind: 'functional_refinement' }] };
  const folded = mount({ ...data, inspection: { model: tree }, typedScalarSeries: [series('s1', 1, 'alice'), series('s2', 10, 'bob')] }, () => {});
  folded.chart.activate('chart');
  assert.equal(folded.host.querySelectorAll('.cv-disclose').length, 1, 'only Root holds rows');
  folded.host.querySelector('.cv-disclose').fire('click');
  assert.deepEqual(folded.host.querySelectorAll('.cv-row').map((row) => [row.dataset.id, row.hidden]), [['root', false], ['p', true], ['p~s2', true]]);
});
