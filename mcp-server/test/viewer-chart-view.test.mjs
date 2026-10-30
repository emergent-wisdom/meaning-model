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

// A Cut series of many readings with the same shares (30% drive): one long reading holding n disjoint finer ones, too
// short to see at full zoom, or a chain of n readings each inside the last, every one wide enough to open.
function manyReadings(n, shape = 'disjoint') {
  const event = (id, extra = {}) => ({ id, boundary: id, participants: {}, process_ids: [], ...extra });
  const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
  const cut = (id, parent_event_id) => ({ id, parent_event_id, question: 'How is effort spent?', unit: 'effort',
    answers: [{ key: 'drive', weight: 0.3 }, { key: 'idle', weight: 0.7 }, { key: 'remainder', weight: 0 }], provenance: ['inferred: fixture'] });
  const end = shape === 'disjoint' ? n : 3 * n;
  const events = [event('world'), event('life'), event('r', { interval: { start: 0, end } })], relations = [contains('world', 'life'), contains('life', 'r')], cuts = [cut('c.r', 'r')];
  for (let i = 1; i <= n; i += 1) {
    const interval = shape === 'disjoint' ? { start: i - 0.75, end: i - 0.25 } : { start: i, end: 3 * n - i };
    events.push(event(`r${i}`, { interval })); relations.push(contains(shape === 'disjoint' || i === 1 ? 'r' : `r${i - 1}`, `r${i}`)); cuts.push(cut(`c.r${i}`, `r${i}`));
  }
  const model = { id: 'm', time_unit: 'cycles', processes: [], decomposition: [], meaning_model: {
    referents: [{ id: 'device', boundary: 'A device', lifecycle_event_id: 'life' }], context_roots: [{ event_id: 'world', kind: 'accepted_world' }],
    events, event_relations: relations, normalized_cuts: cuts } };
  return { timeUnit: 'cycles', inspection: { model }, numerics: projectNumerics(model), events: [{ id: 'r', label: 'Long', start: 0, end, context: 'accepted_world' }] };
}

test('a Cut series of hundreds of nested readings mounts and draws quickly, its drawing growing about in step with the readings', () => {
  // This process's own CPU time, in milliseconds, so other work on a busy machine does not count; the best of three runs.
  // Mounting builds the rows; activating lays them out, prepares and draws the Cut series, and reads the reading column.
  const cpu = () => { const { user, system } = globalThis.process.cpuUsage(); return (user + system) / 1_000; };
  const timed = (snapshot) => {
    const runs = [0, 1, 2].map(() => {
      const started = cpu(); const { host, chart } = mount(snapshot, () => {}); const mounted = cpu(); chart.activate('chart'); const done = cpu();
      clickAt(host, snapshot, 0.5);
      assert.equal(host.querySelector('.cv-row-cut-series').querySelector('.cv-share-val').textContent, '30%');
      return { whole: done - started, drawing: done - mounted };
    });
    return { whole: Math.min(...runs.map((run) => run.whole)), drawing: Math.min(...runs.map((run) => run.drawing)) };
  };
  const small = manyReadings(160);
  timed(small);
  const [few, eight, many, chain] = [timed(small), timed(manyReadings(800)), timed(manyReadings(1600)), timed(manyReadings(800, 'chain'))];
  assert.ok(eight.whole < 1000, `801 readings took ${eight.whole.toFixed(0)} ms`);
  assert.ok(chain.whole < 1000, `a chain of 801 readings took ${chain.whole.toFixed(0)} ms`);
  assert.ok(many.drawing < 10 * Math.max(few.drawing, 2), `drawing 1,601 readings took ${many.drawing.toFixed(1)} ms, 161 took ${few.drawing.toFixed(1)} ms`);
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

// ---- opening a process as the top of the rows, and declared sums ---------------------------------------------------------------------
// Runs with a page address that behaves as the browser's: the Chart writes to it and reads it back.
function withAddress(href, run) {
  const saved = { location: globalThis.location, history: globalThis.history };
  globalThis.location = { href, get search() { return new URL(this.href).search; } };
  globalThis.history = { state: null, replaceState(_state, _title, url) { globalThis.location.href = String(url); } };
  try { return run(); } finally { Object.assign(globalThis, saved); }
}
// Root holds p (which holds q) and r. With a sum declared, p and r add up to root (6 and 4 become 12 and 8; root is 10 and 20).
const part = (id, label, unit = 'litre', scale = {}) => ({ id, unit, value_type: { kind: 'scalar' }, scale: { label, ...scale } });
function tree({ sum = false, root = 10, extra = [] } = {}) {
  const processes = [part('root', 'Root', 'litre', sum ? { aggregate: 'sum' } : {}), part('p', 'Part P'), part('q', 'Part Q'), part('r', 'Part R'), ...extra.map(([id, label, unit]) => part(id, label, unit))];
  const decomposition = [['root', 'p'], ['root', 'r'], ['p', 'q'], ...extra.map(([id]) => ['root', id])].map(([parent, child]) => ({ parent, child, kind: 'functional_refinement' }));
  const inspection = { model: { time_unit: 'day', processes, decomposition, meaning_model: { events: [] } } };
  return { timeUnit: 'day', events: [], inspection, typedScalarSeries: [series('s.root', root, 'alice', 'root'), series('s.p', 6, 'alice', 'p'), series('s.q', 2, 'alice', 'q'), series('s.r', 4, 'alice', 'r'),
    ...extra.map(([id]) => series(`s.${id}`, 1, 'alice', id))] };
}
const rowIds = (host) => host.querySelectorAll('.cv-row').map((row) => row.dataset.id);
const crumbText = (host) => host.querySelector('.cv-crumbs').children.map((node) => node.textContent).join(' ');
const within = () => new URL(globalThis.location.href).searchParams.get('within');
const opener = (host, label) => host.querySelectorAll('.cv-open').find((node) => node.getAttribute('aria-label') === `Open ${label} as the top of the rows`);
const crumb = (host, text) => host.querySelectorAll('.cv-crumb').find((node) => node.tagName === 'BUTTON' && node.textContent === text);

test('Open on a process with parts draws only it and its parts under the path to it, and All processes returns to the whole tree', () => withAddress('https://example.test/?view=chart&chosen=none', () => {
  const checked = [];
  const { host, chart } = mount(tree(), () => {}, { noteAddress: () => checked.push(globalThis.location.search) });
  chart.activate('chart');
  assert.deepEqual(rowIds(host), ['root', 'p', 'q', 'r'], 'the whole tree to begin with');
  assert.ok(host.querySelector('.cv-crumbs').hidden, 'no path to show while the whole tree is drawn');
  assert.deepEqual(host.querySelectorAll('.cv-open').map((node) => node.getAttribute('aria-label')), ['Open Root as the top of the rows', 'Open Part P as the top of the rows'], 'offered only on rows that hold parts');
  assert.ok(host.querySelectorAll('.cv-disclose').length === 2, 'folding still works beside it');

  opener(host, 'Part P').fire('click');
  assert.deepEqual(rowIds(host), ['p', 'q'], 'only it and what it holds');
  assert.equal(host.querySelector('.cv-crumbs').hidden, false);
  assert.equal(crumbText(host), 'All processes › Root › Part P', 'the path from the top of the tree, and the way back to all of it');
  assert.equal(within(), 'p', 'the choice is in the address');
  assert.equal(checked.length, 1, 'the address is checked against the model\'s chosen view as it is written');
  assert.match(checked[0], /within=p/u);
  assert.deepEqual(host.querySelectorAll('.cv-open').map((node) => node.getAttribute('aria-label')), [], 'the top is not offered again, and its parts hold none');
  assert.match(host.querySelector('.cv-guide').textContent, /Opened at Part P: only it and the parts it holds are drawn \(2 rows\)/u);
  assert.equal(host.querySelectorAll('.cv-row').filter((row) => row.hidden).length, 0);

  crumb(host, 'Root').fire('click');
  assert.deepEqual(rowIds(host), ['root', 'p', 'q', 'r']); assert.equal(within(), 'root');
  assert.equal(crumbText(host), 'All processes › Root', 'each step of the path opens that level');
  assert.equal(host.querySelectorAll('.cv-crumb').filter((node) => node.tagName === 'BUTTON' && node.textContent === 'Root').length, 0, 'the level shown is not a button');

  host.querySelector('.cv-crumb-all').fire('click');
  assert.deepEqual(rowIds(host), ['root', 'p', 'q', 'r']); assert.equal(within(), null, 'All processes leaves the address as it was');
  assert.ok(host.querySelector('.cv-crumbs').hidden);
  assert.equal(checked.length, 3);
}));

test('folding a row still hides its parts, and opening a folded process unfolds it', () => withAddress('https://example.test/?view=chart&chosen=none', () => {
  const { host, chart } = mount(tree(), () => {}); chart.activate('chart');
  host.querySelectorAll('.cv-disclose')[1].fire('click');
  assert.deepEqual(host.querySelectorAll('.cv-row').map((row) => [row.dataset.id, row.hidden]), [['root', false], ['p', false], ['q', true], ['r', false]], 'p folded: q hidden');
  opener(host, 'Part P').fire('click');
  assert.deepEqual(host.querySelectorAll('.cv-row').map((row) => [row.dataset.id, row.hidden]), [['p', false], ['q', false]], 'opened, p shows its parts');
  host.querySelector('.cv-disclose').fire('click');
  assert.deepEqual(host.querySelectorAll('.cv-row').map((row) => [row.dataset.id, row.hidden]), [['p', false], ['q', true]], 'and can be folded again');
}));

test('the address names the opened process, so a reload and a shared link reopen it; a name the chart does not draw is ignored', () => {
  const snapshot = tree();
  const opened = (search) => withAddress(`https://example.test/${search}`, () => { const { host, chart } = mount(snapshot, () => {}); chart.activate('chart'); return host; });
  const host = opened('?view=chart&within=p');
  assert.deepEqual(rowIds(host), ['p', 'q']); assert.equal(crumbText(host), 'All processes › Root › Part P');
  assert.deepEqual(rowIds(opened('?view=chart&within=q')), ['q'], 'a process with no parts opens alone');
  for (const search of ['?view=chart&within=nothing', '?view=chart&within=', '?view=chart']) assert.deepEqual(rowIds(opened(search)), ['root', 'p', 'q', 'r'], `${search} draws the whole tree`);
  assert.ok(opened('?view=chart&within=nothing').querySelector('.cv-crumbs').hidden);
});

test('without a decomposition there is nothing to open: no Open, no path, and the guide does not offer them', () => withAddress('https://example.test/?view=chart', () => {
  const { host, chart } = mount(data, () => {}); chart.activate('chart');
  assert.equal(host.querySelectorAll('.cv-open').length, 0); assert.ok(host.querySelector('.cv-crumbs').hidden);
  assert.doesNotMatch(host.querySelector('.cv-guide').textContent, /Open, on a process|Opened at/u);
  assert.doesNotMatch(host.querySelector('.cv-foot').textContent, /Stacked|Remainder|Hatched/u, 'and the key names no stacked parts');
  // An address that names a process opens nothing where there is no decomposition to open it in.
  withAddress('https://example.test/?view=chart&within=p', () => { const again = mount(data, () => {}); again.chart.activate('chart'); assert.deepEqual(rowIds(again.host), ['p']); assert.ok(again.host.querySelector('.cv-crumbs').hidden); });
  // Nor does one outside the decomposition, in a model that has one.
  withAddress('https://example.test/?view=chart&within=loose', () => {
    const snapshot = tree(); snapshot.inspection.model.processes.push(part('loose', 'Loose')); snapshot.typedScalarSeries.push(series('s.loose', 3, 'alice', 'loose'));
    const again = mount(snapshot, () => {}); again.chart.activate('chart');
    assert.deepEqual(rowIds(again.host), ['root', 'p', 'q', 'r', 'loose']); assert.ok(again.host.querySelector('.cv-crumbs').hidden);
  });
}));

test('a process asked for from elsewhere that the opened top does not draw opens at the nearest level that does', () => withAddress('https://example.test/?view=chart&within=q', () => {
  const sent = [];
  const { host, chart } = mount(tree(), (selection) => sent.push(selection)); chart.activate('chart');
  assert.deepEqual(rowIds(host), ['q']);
  chart.deactivate(); chart.activate('chart', { selection: { kind: 'process', id: 'nothing' } });
  assert.deepEqual(rowIds(host), ['q'], 'a process the chart does not draw at all changes nothing');
  chart.deactivate(); chart.activate('chart', { selection: { kind: 'process', id: 'p' } });
  assert.deepEqual(rowIds(host), ['p', 'q']); assert.equal(title(host), 'Part P', 'the process is opened in the reading card'); assert.equal(within(), 'p');
  chart.deactivate(); chart.activate('chart', { selection: { kind: 'process', id: 'r' } });
  assert.deepEqual(rowIds(host), ['root', 'p', 'q', 'r'], 'r is not under p: the next level up that draws it opens'); assert.equal(title(host), 'Part R'); assert.equal(within(), 'root');
  assert.deepEqual(sent, [], 'a selection received is never sent back');
}));

test('a row the new top leaves out is closed, and its selection is cleared for the other views', () => withAddress('https://example.test/?view=chart', () => {
  const sent = [];
  const { host, chart } = mount(tree(), (selection) => sent.push(selection)); chart.activate('chart');
  host.querySelectorAll('.cv-row').find((row) => row.dataset.id === 'r').querySelector('.cv-row-name').fire('click');
  assert.equal(title(host), 'Part R'); assert.deepEqual(sent.at(-1), { kind: 'process', id: 'r' });
  opener(host, 'Part P').fire('click');
  assert.equal(title(host), 'How to read this chart', 'r is not drawn under p');
  assert.equal(sent.at(-1), null);
  // What stays drawn stays open.
  host.querySelectorAll('.cv-row').find((row) => row.dataset.id === 'q').querySelector('.cv-row-name').fire('click');
  crumb(host, 'Root').fire('click');
  assert.equal(title(host), 'Part Q'); assert.ok(host.querySelectorAll('.cv-row').some((row) => row.classes.has('is-selected') && row.dataset.id === 'q'));
}));

test('the reading card says where a process sits, offers to open it, and reaches the process it was opened from', () => withAddress('https://example.test/?view=chart', () => {
  const { host, chart } = mount(tree(), () => {}); chart.activate('chart');
  host.querySelectorAll('.cv-row').find((row) => row.dataset.id === 'p').querySelector('.cv-row-name').fire('click');
  const button = host.querySelector('.cv-open-card');
  assert.equal(button.textContent, 'Open as the top'); button.fire('click');
  assert.deepEqual(rowIds(host), ['p', 'q']); assert.equal(host.querySelector('.cv-open-card'), null, 'once it is the top there is nothing to open');
  // The top's own card still says what it is part of, and the link opens that level.
  host.querySelectorAll('.cv-row').find((row) => row.dataset.id === 'p').querySelector('.cv-row-name').fire('click');
  const up = host.querySelectorAll('.cv-link').find((node) => node.textContent === 'Root');
  assert.ok(up, 'Part of Root');
  up.fire('click');
  assert.deepEqual(rowIds(host), ['root', 'p', 'q', 'r']); assert.equal(title(host), 'Root');
}));

test('a process that declares the sum of its parts shows them stacked in its own row, with the remainder and any excess marked', () => withAddress('https://example.test/?view=chart', () => {
  const plain = mount(tree(), () => {}); plain.chart.activate('chart');
  assert.equal(plain.host.querySelectorAll('.cv-band-path').length, 0, 'no sum declared: nothing is stacked, though the parts share a unit');

  const exact = tree({ sum: true });
  const one = mount(exact, () => {}); one.chart.activate('chart');
  const root = one.host.querySelector('.cv-row');
  assert.deepEqual(root.querySelectorAll('.cv-share-name').map((node) => node.textContent), ['Part P', 'Part R'], 'its parts, listed beside the plot');
  assert.equal(root.querySelectorAll('.cv-band-path').filter((node) => node.classes.has('is-layer')).length, 2, 'one layer each');
  assert.equal(root.querySelectorAll('.cv-over-flag').length, 0); assert.doesNotMatch(root.textContent, /Remainder|exceed/u, 'no remainder and no excess, so neither is listed');
  assert.doesNotMatch(root.querySelector('.cv-row-unit').textContent, /log scale/u);
  assert.doesNotMatch(one.host.querySelector('.cv-foot').textContent, /Remainder|Hatched/u);
  assert.match(one.host.querySelector('.cv-foot').textContent, /Stacked parts that add up to it/u);
  clickAt(one.host, exact, 5);
  assert.deepEqual(root.querySelectorAll('.cv-share-val').map((node) => node.textContent), ['~ 9', '~ 6'], 'the parts at the moment read, marked as between recorded values');

  // The whole holds more than its parts: the remainder is a layer, and a line of its own.
  const gap = tree({ sum: true, root: 12 });
  const two = mount(gap, () => {}); two.chart.activate('chart');
  const rest = two.host.querySelector('.cv-row');
  assert.deepEqual(rest.querySelectorAll('.cv-share-name').map((node) => node.textContent), ['Part P', 'Part R', 'Remainder']);
  assert.equal(rest.querySelectorAll('.cv-band-path').filter((node) => node.classes.has('is-rest')).length, 1);
  clickAt(two.host, gap, 5);
  assert.equal(rest.querySelectorAll('.cv-share-val').at(-1).textContent, '~ 3', 'what is left open at that moment');
  assert.match(two.host.querySelector('.cv-foot').textContent, /Remainder: what the whole holds beyond its parts/u);

  // The parts add up to more than the whole: marked at each date, hatched, and said in words, never hidden.
  const over = tree({ sum: true, root: 8 });
  const three = mount(over, () => {}); three.chart.activate('chart');
  const excess = three.host.querySelector('.cv-row');
  assert.deepEqual(excess.querySelectorAll('.cv-share-name').map((node) => node.textContent), ['Part P', 'Part R', 'Parts exceed it']);
  assert.equal(excess.querySelectorAll('.cv-over-flag').length, 2, 'a flag at each date');
  assert.ok(excess.querySelectorAll('.cv-over').length >= 1, 'and the stretch between');
  clickAt(three.host, over, 5);
  assert.equal(excess.querySelectorAll('.cv-share-val').at(-1).textContent, '~ by 3');
  assert.match(three.host.querySelector('.cv-foot').textContent, /Hatched: its parts add up to more than the whole/u);
  excess.querySelector('.cv-row-name').fire('click');
  assert.match(three.host.querySelector('.cv-panel-body').textContent, /At 2 recorded dates the parts add up to more than the whole: 0 day, by 2; 10 day, by 4/u);
}));

test('a stacked row stands on zero in a straight scale, and lists the parts it does not stack with why', () => withAddress('https://example.test/?view=chart', () => {
  const snapshot = tree({ sum: true, extra: [['z', 'Part Z', 'kilogram']] });
  snapshot.inspection.model.processes = snapshot.inspection.model.processes.map((p) => (p.id === 'z' ? { ...p, unit: 'kilogram' } : p));
  const { host, chart } = mount(snapshot, () => {}); chart.activate('chart');
  const root = host.querySelector('.cv-row');
  const listed = root.querySelector('.cv-share-listed');
  assert.equal(listed.textContent, 'Not stacked: Part Z'); assert.match(listed.attrs.title, /Part Z: its unit, kilogram, is not litre/u);
  assert.equal(root.querySelectorAll('.cv-band-path').filter((node) => node.classes.has('is-layer')).length, 2, 'the part in another unit is not stacked');
  root.querySelector('.cv-row-name').fire('click');
  const card = host.querySelector('.cv-panel-body').textContent;
  assert.match(card, /The model declares this process the sum of its parts/u); assert.match(card, /Listed, not stacked:/u); assert.match(card, /Part Z its unit, kilogram, is not litre/u);
}));

// A model whose own view is the Chart: a reader who opens a process has changed what it chose, so reopening the address keeps
// the process. That needs `within` among the settings view-settings.js lists as the viewer's own, which is where the Chart's
// other choices are recorded.
test('reopening the address where the model\'s own view is followed keeps the process the reader opened', async () => {
  const { noteAddress: fresh } = await import('../viewer/public/chosen-view.js?within-followed');
  const views = [{ id: 'v1', title: 'The tree', settings: { view: 'chart' } }];
  const opening = openingView(viewAddress('https://example.test/?data=m', views[0]), views);
  withAddress(opening.href, () => {
    fresh(); // the viewer's first address write is the baseline
    const { host, chart } = mount(tree(), () => {}, { noteAddress: fresh }); chart.activate('chart');
    opener(host, 'Part P').fire('click');
    const reopened = openingView(globalThis.location.href, views);
    assert.equal(new URL(reopened.href).searchParams.get('within'), 'p');
  });
});

test('the opened process survives a reload wherever the address is the reader\'s own', async () => {
  const { noteAddress: fresh } = await import('../viewer/public/chosen-view.js?within-own');
  const views = [{ id: 'v1', title: 'The tree', settings: { view: 'chart' } }];
  for (const [what, href, list] of [['the reader\'s own settings', 'https://example.test/?data=m&view=chart&chosen=none', views], ['a link set by hand', 'https://example.test/?data=m&view=chart', views],
    ['a model with no recorded view', 'https://example.test/?data=m&view=chart', []]]) {
    withAddress(href, () => {
      const { host, chart } = mount(tree(), () => {}, { noteAddress: fresh }); chart.activate('chart');
      opener(host, 'Part P').fire('click');
      const reopened = openingView(globalThis.location.href, list);
      assert.equal(new URL(reopened.href).searchParams.get('within'), 'p', `${what} keeps it`);
      assert.equal(reopened.href, globalThis.location.href, `${what} is opened as it is`);
    });
  }
});
