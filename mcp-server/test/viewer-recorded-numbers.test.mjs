import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recordedCutSegments, visibleRecordedCuts, recordedCutMarker, appendRecordedCut, appendRecordedNumbers, appendTypedScalarSeries, recordedIntervalText } from '../viewer/public/recorded-numbers.js';

const reading = (id, t = 5, extra = {}) => ({ id, parentEventId: `event.${id}`, eventLabel: `Event ${id}`, question: 'How is the declared unit divided?',
  unit: 'attention within this decision', answers: [{ key: 'a', weight: 0.75 }, { key: 'remainder', weight: 0.25 }],
  t, end: t === null ? null : t + 1, interval: t === null ? null : { start: t, end: t + 1 }, displayable: t !== null, ...extra });

function dom() {
  const document = { createElement(tag) {
    return { tag, ownerDocument: document, children: [], className: '', textContent: '', style: {}, open: false, listeners: {},
      append(...children) { this.children.push(...children); },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      set innerHTML(value) { assert.fail(`Numerical source content must remain text: ${value}`); } };
  } };
  const root = document.createElement('div');
  const all = (node = root) => [node, ...node.children.flatMap((child) => all(child))];
  const text = () => all().map((node) => node.textContent).join('\n');
  return { root, all, text, open(node) { node.open = true; node.listeners.toggle?.(); } };
}

test('Cut bands retain every exact answer and zero remainder without multiplying conditional weights', () => {
  const answers = Array.from({ length: 10 }, (_, i) => ({ key: `answer.${i}`, weight: 0.1 })); answers.push({ key: 'remainder', weight: 0 });
  const cut = reading('conditioned', 2, { answers, conditioning: { cut_id: 'parent', answer_key: 'small' }, conditioningChain: [{ answer: { key: 'small', weight: 0.2 } }] });
  const before = structuredClone(cut); const segments = recordedCutSegments(cut);
  assert.equal(segments.length, 11);
  assert.deepEqual(segments.map(({ key, weight }) => ({ key, weight })), answers);
  assert.equal(segments[0].start, 0); assert.ok(Math.abs(segments.at(-1).end - 1) < 1e-12);
  assert.equal(segments[0].weight, 0.1, 'local 0.1 must not become parent-relative 0.02');
  assert.deepEqual(cut, before);
});

test('numerical playback never positions undated readings or reveals future Cuts and respects explicit hiding', () => {
  const cuts = [reading('past', 2), reading('future', 8), reading('undated', null), reading('invalid', 1, { displayable: false }), reading('old', 1, { record: { withdrawn: { reason: 'replaced' } } })];
  assert.deepEqual(visibleRecordedCuts(cuts, { now: 5 }).map((cut) => cut.id), ['past']);
  assert.deepEqual(visibleRecordedCuts(cuts, { now: 9 }).map((cut) => cut.id), ['past', 'future']);
  assert.deepEqual(visibleRecordedCuts(cuts, { overview: true }).map((cut) => cut.id), ['past', 'future']);
  assert.deepEqual(visibleRecordedCuts(cuts, { overview: true }, { enabled: false }), []);
  assert.deepEqual(visibleRecordedCuts(cuts, { now: 5 }, { drawnCutIds: new Set(['past']) }), []);
  assert.equal(recordedIntervalText(cuts[2]), 'No recorded time');
  const dated = [reading('late-world', 80, { born: { at: new Date(3).toISOString() } }), reading('early-world', 1, { born: { at: new Date(8).toISOString() } })];
  assert.deepEqual(visibleRecordedCuts(dated, { construction: true, tau: 5 }).map((cut) => cut.id), ['late-world'], 'construction remains independent of world time');
});

test('wide interval compositions remain accessible when their start is outside the view, explicitly as clipped markers', () => {
  const cut = reading('period', 1, { end: 10 });
  assert.deepEqual(recordedCutMarker(cut, 5, 8), { time: 5, clippedStart: true });
  assert.deepEqual(recordedCutMarker(cut, 0, 8), { time: 1, clippedStart: false });
  assert.equal(recordedCutMarker(cut, 11, 20), null);
  assert.equal(recordedCutMarker(cut, -10, 0), null);
  assert.equal(recordedCutMarker(reading('undated', null), 0, 10), null);
  assert.equal(cut.t, 1); assert.equal(cut.end, 10);
});

test('Cut details preserve complete answers, context, local denominator and literal authored source', () => {
  const f = dom(); const injection = '<img src=x onerror=alert(1)>';
  const cut = reading('a', 1, { question: injection, unit: 'framing attention', answers: [...Array.from({ length: 8 }, (_, i) => ({ key: `direction.${i}`, weight: 0.125 })), { key: 'remainder', weight: 0 }],
    participants: { actor: ['machine.a'] }, bindings: [{ role: 'subject', referent_id: 'machine.a' }],
    contexts: [{ rootId: 'inner.machine.a', kind: 'inner', participants: { subject: ['machine.a'] }, provenance: ['Authored machine context'] }],
    conditioning: { cut_id: 'how', answer_key: 'framing' }, conditioningChain: [{ cutId: 'how', answerKey: 'framing', question: 'HOW?', unit: 'attention', answer: { weight: 0.2 }, status: 'resolved', provenance: ['Condition source exact'] }],
    provenance: [injection], eventProvenance: ['The month is a precision envelope, not exact start.'] });
  appendRecordedCut(f.root, cut, { formatTime: (t) => `time ${t}`, timeUnit: 'machine_cycles', referentName: (id) => id === 'machine.a' ? 'Machine A' : id });
  const text = f.text();
  assert.ok(f.all().some((node) => node.textContent === injection));
  assert.equal(f.all().filter((node) => node.tag === 'b').length, 9, 'all eight answers and zero remainder are readable');
  assert.match(text, /Unit \/ local denominator: framing attention/);
  assert.match(text, /Context: inner · inner.machine.a/);
  assert.match(text, /Context subject: Machine A/);
  assert.match(text, /Condition: HOW\? · framing = 0.2 · unit: attention · how/);
  assert.match(text, /These weights remain local to that answer/);
  assert.match(text, /Condition source exact/);
  assert.match(text, /precision envelope/);
  assert.match(text, /native start 1, end 2 machine_cycles/);
});

test('readings needing review are visibly separated from current and withdrawn records', () => {
  const f = dom();
  const stale = reading('changed', 1, { evidence: { status: 'needs_review', reason: 'The Event text changed.' } });
  appendRecordedNumbers(f.root, { cuts: [stale, reading('untracked', 2)], historical: { cuts: [] } });
  assert.match(f.text(), /Needs review · changed or unresolved evidence \(1\)/);
  assert.match(f.text(), /Current Cuts \(1\)/);
  assert.doesNotMatch(f.text(), /Historical Cuts/);
  for (const item of f.all().filter((node) => node.listeners.toggle)) f.open(item);
  assert.match(f.text(), /Needs review: The Event text changed/);
  assert.match(f.text(), /0.75/);
});

test('Numbers browses all current, undated and historical Cuts plus scalar initial values without creating times', () => {
  const f = dom(); const numerics = { cuts: [reading('future', 999), reading('undated', null)],
    scalarRecords: [{ processId: 'reservoir.capacity', value: 0, unit: 'litres', referenceFrame: 'Design limit, not an observation', support: ['Declared capacity'], provenance: ['Source retained'] }],
    historical: { cuts: [reading('old', 1, { record: { withdrawn: { reason: 'revised' } } })] } };
  appendRecordedNumbers(f.root, numerics);
  assert.match(f.text(), /Current Cuts \(2\)/);
  assert.match(f.text(), /Historical Cuts \(1\)/);
  assert.match(f.text(), /No recorded time/);
  assert.doesNotMatch(f.text(), /Design limit/, 'record bodies start lazy');
  for (const item of f.all().filter((node) => node.listeners.toggle)) f.open(item);
  const text = f.text();
  assert.match(text, /0 litres/);
  assert.match(text, /Design limit, not an observation/);
  assert.match(text, /This initial value is not a time-series sample/);
  assert.match(text, /Historical numerical reading · withdrawn/);
  assert.match(text, /Source retained/);
  const bodies = f.all().length;
  for (const item of f.all().filter((node) => node.listeners.toggle)) f.open(item);
  assert.equal(f.all().length, bodies, 'reopening does not duplicate content');
});

test('scalar details retain declared uncertainty with exact interval bounds or standard deviation', () => {
  const f = dom();
  const scalarRecords = [
    { processId: 'bounded', value: 72, unit: 'kPa', uncertainty: { kind: 'interval', lower: 71.123456789, upper: 74.987654321 } },
    { processId: 'spread', value: 5, unit: 'litres', uncertainty: { kind: 'standard_deviation', value: 0.00123456789 } },
    { processId: 'exact', value: 1, uncertainty: { kind: 'exact' } },
    { processId: 'unknown', value: 2, uncertainty: { kind: 'unknown' } },
    { processId: 'not-declared', value: 3 },
  ];
  const before = structuredClone(scalarRecords);
  appendRecordedNumbers(f.root, { scalarRecords });
  for (const item of f.all().filter((node) => node.listeners.toggle)) f.open(item);
  const declarations = f.all().filter((node) => node.textContent.startsWith('Declared uncertainty:')).map((node) => node.textContent);
  assert.deepEqual(declarations, ['Declared uncertainty: interval 71.123456789 – 74.987654321 kPa',
    'Declared uncertainty: standard deviation 0.00123456789 litres', 'Declared uncertainty: exact', 'Declared uncertainty: unknown']);
  assert.deepEqual(scalarRecords, before);
});

const datedSeries = (extra = {}) => ({ id: 'series:pressure', processId: 'pressure', label: 'Gauge estimate', unit: 'kPa', frame: 'pump housing', timeUnit: 'hours',
  holder: 'observer', mode: 'estimate', evidenceType: 'gauge reading', interpolation: { kind: 'linear-visual-guide', extrapolate: false }, conflicts: [],
  source: { kind: 'process-estimation', modelHash: 'a'.repeat(64), bundleNodeId: 'bundle', estimationRequestId: 'request', proposalId: 'proposal' },
  points: [{ id: 'sample-1', t: 1, v: 72.1234567890123, valueTime: 24.123456789, evidenceCutoff: 20.987654321,
    holder: 'observer', mode: 'estimate', evidenceType: 'gauge reading', authority: { kind: 'externalized' },
    uncertainty: { kind: 'interval', lower: 71.123456789, upper: 74.987654321 }, provenance: ['Exact provenance'], accessScopes: ['author'], born: { order: 2 },
    reviewStatus: 'approved', acceptedWorldValue: false, review: { reason: 'Reviewed against the gauge' }, output: { exact: true }, record: { native_marker: 'full-source-retained', value: 72.1234567890123 } },
  { id: 'sample-2', t: 2, v: 74.5, valueTime: 48, evidenceCutoff: 40, reviewStatus: 'approved', acceptedWorldValue: false }], ...extra });

test('dated scalar values lazily preserve exact native metadata and distinguish approval from world state', () => {
  const f = dom(), series = datedSeries();
  series.points[0].provenance.push('<img src=x onerror=alert(1)>');
  const before = structuredClone(series);
  appendRecordedNumbers(f.root, {}, { typedScalarSeries: [series], formatTime: (t) => `display ${t}` });
  assert.match(f.text(), /Dated scalar values \(1\)/);
  assert.match(f.text(), /Gauge estimate · 2 dated readings/);
  assert.doesNotMatch(f.text(), /Native value time|Exact provenance|pump housing|no recorded Cuts/i);
  const bySummary = (text) => f.all().find((node) => node.tag === 'details' && node.children[0]?.textContent === text);
  f.open(bySummary('Gauge estimate · 2 dated readings'));
  assert.match(f.text(), /linear visual guide.*no extrapolation/);
  assert.match(f.text(), /Review approval does not establish an accepted-world value/);
  assert.match(f.text(), /Reference frame: pump housing/);
  assert.doesNotMatch(f.text(), /24\.123456789|Exact provenance|full-source-retained/);
  f.open(bySummary('Series source'));
  assert.match(f.text(), /process-estimation/); assert.ok(f.text().includes('a'.repeat(64)));
  f.open(bySummary('display 1 · 72.1234567890123 kPa · approved'));
  const text = f.text();
  assert.match(text, /Native value time: 24\.123456789 hours/);
  assert.match(text, /Evidence cutoff: 20\.987654321 hours/);
  assert.match(text, /Holder: observer · Mode: estimate/);
  assert.match(text, /Evidence type: gauge reading/);
  assert.match(text, /Authority: \{"kind":"externalized"\}/);
  assert.match(text, /Review status: approved/); assert.match(text, /Accepted-world value: no/);
  assert.match(text, /71\.123456789/); assert.match(text, /74\.987654321/);
  assert.match(text, /Exact provenance/); assert.match(text, /<img src=x onerror=alert\(1\)>/);
  assert.match(text, /Access scopes: author/); assert.match(text, /Construction record: \{"order":2\}/);
  assert.match(text, /Reviewed against the gauge/); assert.match(text, /Recorded output: \{"exact":true\}/);
  assert.doesNotMatch(text, /full-source-retained/, 'raw native record remains lazy even after opening sample metadata');
  f.open(bySummary('Native source record'));
  assert.match(f.text(), /full-source-retained/);
  const count = f.all().length;
  f.open(bySummary('Native source record'));
  f.open(bySummary('display 1 · 72.1234567890123 kPa · approved'));
  assert.equal(f.all().length, count, 'reopening a reading creates no duplicate metadata');
  assert.deepEqual(series, before);
});

test('Numbers keeps single and conflicting dated readings accessible without claiming a curve', () => {
  const f = dom(), sample = datedSeries().points[0];
  const single = datedSeries({ id: 'single', label: 'Single sample', interpolation: { kind: 'none', extrapolate: false }, points: [sample] });
  const conflicting = datedSeries({ id: 'conflicting', label: 'Conflicting samples', interpolation: { kind: 'none', extrapolate: false },
    conflicts: [{ t: 1, recordIds: ['sample-1', 'sample-other'] }], points: [sample, { ...sample, id: 'sample-other', v: 99 }] });
  appendRecordedNumbers(f.root, {}, { typedScalarSeries: [single, conflicting] });
  for (let depth = 0; depth < 3; depth += 1) for (const item of f.all().filter((node) => node.listeners.toggle)) f.open(item);
  const text = f.text();
  assert.match(text, /Dated scalar values \(2\)/);
  assert.match(text, /One dated reading: no numerical curve is drawn/);
  assert.match(text, /Conflicting readings are kept separate; no numerical curve is drawn/);
  assert.match(text, /Conflicting display time 1: sample-1, sample-other/);
  assert.match(text, /Record: sample-1/); assert.match(text, /Record: sample-other/);
  assert.match(text, /Recorded value: 99 kPa/);
  assert.doesNotMatch(text, /No recorded Cuts,/);
});

test('curve source inspection can supply one bracketing sample without mislabeling its parent curve', () => {
  const f = dom(), series = datedSeries();
  appendTypedScalarSeries(f.root, { ...series, points: series.points.slice(0, 1) });
  assert.match(f.text(), /linear visual guide between recorded readings, with no extrapolation/);
  assert.doesNotMatch(f.text(), /One dated reading: no numerical curve/);
  assert.equal(f.all().filter((node) => node.tag === 'summary' && node.textContent.includes('72.1234567890123')).length, 1);
});

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const start = source.indexOf('function drawRecordedNumbers('); const end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);
const drawSource = source.slice(start, end + 2);
function drawFixture(cuts) {
  const calls = [], links = [];
  const context = { madeAt: (born) => (born?.at ? Date.parse(born.at) : NaN), constructionByClock: true, visibleRecordedCuts, recordedCutSegments, recordedCutMarker, numericCuts: cuts, extraTargets: [], F: { a: 0, b: 50 },
    opt: { show: new Set(['numbers']), edges: true }, now: 5, overview: false,
    X: (t) => t, LENGTH: 100, anchor: () => null, zFrontNow: () => 0,
    litReading: null, WHITE: '#fff', RIM: '#111', color: (hex) => hex,
    chips: { quad: (...args) => calls.push(args) }, connectors: { add: (...args) => links.push(args) } };
  context.playbackClock = () => ({ now: context.now, overview: context.overview });
  vm.createContext(context); vm.runInContext(drawSource, context);
  return { context, calls, links };
}

test('actual drawing positions arbitrary dated Cuts at their own time without owner paths, interpolation or future targets', () => {
  const { context, calls, links } = drawFixture([reading('robot.question', 2), reading('future', 8), reading('unknown', null)]);
  context.drawRecordedNumbers();
  assert.equal(context.extraTargets.length, 1);
  assert.equal(context.extraTargets[0].reading.id, 'robot.question');
  assert.equal(context.extraTargets[0].wpt[0], 2);
  assert.ok(context.extraTargets[0].wpt.every(Number.isFinite));
  assert.equal(calls.length, 3, 'one background and both recorded answer bands');
  assert.equal(links.length, 0, 'the neutral lane does not assert a guessed owner or attachment');
  context.now = 9; context.extraTargets = []; calls.length = 0; context.drawRecordedNumbers();
  assert.deepEqual(Array.from(context.extraTargets, (target) => target.wpt[0]), [2, 8], 'later playback adds a separate reading, not a new sample between them');
  context.opt.show.delete('numbers'); context.extraTargets = []; calls.length = 0; context.drawRecordedNumbers();
  assert.equal(context.extraTargets.length, 0); assert.equal(calls.length, 0);
});

test('actual drawing suppresses a duplicate only when that Cut already has a rendered lens glyph', () => {
  const { context, calls } = drawFixture([reading('a', 2), reading('b', 3)]);
  context.extraTargets = [{ kind: 'lens', reading: { cutId: 'a' } }]; context.drawRecordedNumbers();
  assert.deepEqual(Array.from(context.extraTargets.filter((target) => target.kind === 'number'), (target) => target.reading.id), ['b']);
  assert.equal(calls.length, 3);
  context.extraTargets = []; calls.length = 0; context.drawRecordedNumbers();
  assert.deepEqual(Array.from(context.extraTargets, (target) => target.reading.id), ['a', 'b']);
});

test('selected lens inspection keeps exact canonical shares and conditioning instead of its abbreviated legacy record', () => {
  const f = dom();
  const exact = reading('conditioned', 5, { question: 'The entire authored question '.repeat(15), unit: 'local conditional unit',
    answers: [{ key: 'trace', weight: 0.0000123456789 }, { key: 'other', weight: 0.9999876543211 }, { key: 'remainder', weight: 0 }],
    conditioning: { cut_id: 'parent', answer_key: 'selected' },
    conditioningChain: [{ cutId: 'parent', answerKey: 'selected', question: 'Exact parent question', unit: 'parent unit', answer: { weight: 0.234567890123 }, status: 'resolved' }],
    contexts: [{ kind: 'understanding', rootId: 'root', label: 'Authored interpretation' }], provenance: ['Exact provenance '.repeat(60)] });
  const start = source.indexOf('function appendLensInspection('), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start);
  const context = { numericCutById: new Map([[exact.id, exact]]), appendRecordedCut, numericOptions: () => ({}),
    tipLine: (className, text) => { const node = f.root.ownerDocument.createElement('div'); node.className = className; node.textContent = text; return node; } };
  vm.createContext(context); vm.runInContext(source.slice(start, end + 2), context);
  context.appendLensInspection(f.root, { lens: { name: 'Machine perspective' }, reading: { cutId: exact.id, question: 'Truncated…', answers: [{ key: 'trace', weight: 0 }, { key: 'other', weight: 1 }] } });
  const text = f.text();
  assert.match(text, /A reading · Machine perspective/);
  assert.ok(text.includes(exact.question)); assert.ok(text.includes(exact.provenance[0]));
  assert.match(text, /0\.0000123456789/); assert.match(text, /0\.9999876543211/);
  assert.match(text, /Exact parent question · selected = 0\.234567890123 · unit: parent unit/);
  assert.match(text, /Context: understanding · root · Authored interpretation/);
  assert.equal(f.all().filter((node) => node.tag === 'b').length, 3, 'zero remainder stays inspectable');
  assert.doesNotMatch(text, /Truncated/);
});

test('lens inspection still accepts an older snapshot without canonical numerical records', () => {
  const f = dom();
  const line = (className, text) => { const node = f.root.ownerDocument.createElement('div'); node.className = className; node.textContent = text; return node; };
  const start = source.indexOf('function appendLensInspection('), end = source.indexOf('\n}', start);
  const context = { numericCutById: new Map(), tipLine: line, document: f.root.ownerDocument, byId: new Map([['e', { label: 'Older event' }]]),
    holderText: () => 'an earlier reader', data: { people: [] }, clip: (text) => text, timeText: String,
    weightsBox: (answers) => line('w', answers.map((answer) => `${answer.key}: ${answer.weight}`).join(', ')) };
  vm.createContext(context); vm.runInContext(source.slice(start, end + 2), context);
  context.appendLensInspection(f.root, { lens: { name: 'Legacy lens', colorOf: () => '#fff' },
    reading: { cutId: 'old', eventId: 'e', t: 2, question: 'Stored older question', unit: 'older unit', answers: [{ key: 'remainder', weight: 1 }] } });
  assert.match(f.text(), /Legacy lens/); assert.match(f.text(), /Older event/);
  assert.match(f.text(), /Stored older question/); assert.match(f.text(), /remainder: 1/);
});
