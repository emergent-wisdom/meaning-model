import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNumerics } from '../src/viewer-numerics.mjs';

const event = (id, interval = null, extra = {}) => ({ id, interval, boundary: `Event ${id}`, participants: {}, ...extra });
const cut = (id, parent_event_id, extra = {}) => ({ id, parent_event_id, question: 'Which route?', unit: 'allocation',
  answers: [{ key: 'left', weight: 0.123456789012345 }, { key: 'remainder', weight: 0.876543210987655 }], provenance: ['supplied:fixture'], ...extra });
const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
const model = (extra = {}) => ({ time_unit: 'ticks', processes: [], meaning_model: {
  events: [event('origin'), event('one', { start: 3, end: 8 }), event('two', { start: 8, end: 8 }), event('untimed')],
  normalized_cuts: [cut('a', 'one')], context_roots: [{ event_id: 'origin', kind: 'accepted_world' }],
  event_relations: [contains('origin', 'one'), contains('origin', 'two'), contains('origin', 'untimed')], ...extra,
} });

test('every exact Cut remains an independent recorded composition with its declared interval', () => {
  const source = model({ normalized_cuts: [cut('a', 'one'), cut('b', 'two'), cut('c', 'two', { unit: 'different unit' }),
    cut('d', 'two', { question: 'A different question?' }), cut('e', 'two', { answers: [{ key: 'right', weight: 1 }, { key: 'remainder', weight: 0 }] })] });
  const before = structuredClone(source);
  const projection = projectNumerics(source, { toDisplayTime: (value) => value + 100 });
  assert.equal(projection.cuts.length, 5);
  assert.deepEqual(projection.cuts[0].interval, { start: 3, end: 8 });
  assert.deepEqual([projection.cuts[0].t, projection.cuts[0].end], [103, 108]);
  assert.deepEqual(projection.cuts[0].answers, source.meaning_model.normalized_cuts[0].answers);
  assert.deepEqual(projection.cuts.at(-1).answers.at(-1), { key: 'remainder', weight: 0 });
  assert.equal(projection.cuts[1].displayable, true, 'a single instant is retained, without requiring a trajectory');
  assert.deepEqual(source, before);
  projection.cuts[0].answers[0].weight = 0;
  projection.cuts[0].record.provenance.push('display-only');
  assert.deepEqual(source, before, 'projected data does not alias the immutable source');
});

test('conditioning preserves exact parent questions, units, answers and nested references', () => {
  const source = model({ normalized_cuts: [cut('top', 'one'), cut('middle', 'one', { question: 'Within the remainder?', unit: 'remaining allocation',
    conditioning: { cut_id: 'top', answer_key: 'remainder' } }), cut('leaf', 'two', { conditioning: { cut_id: 'middle', answer_key: 'left' } }),
  cut('unconditional', 'two')] });
  const leaf = projectNumerics(source).cuts.find((item) => item.id === 'leaf');
  assert.deepEqual(leaf.conditioning, { cut_id: 'middle', answer_key: 'left' });
  assert.deepEqual(leaf.conditioningChain.map((item) => [item.cutId, item.answerKey, item.question, item.unit]), [
    ['middle', 'left', 'Within the remainder?', 'remaining allocation'], ['top', 'remainder', 'Which route?', 'allocation'],
  ]);
  assert.equal(leaf.conditioningChain[1].answer.weight, 0.876543210987655);
  assert.deepEqual(leaf.conditioningChain[0].answers, source.meaning_model.normalized_cuts[1].answers);
  assert.deepEqual(leaf.conditioningChain[0].provenance, ['supplied:fixture']);
});

test('missing and cyclic conditioning are retained and flagged, never guessed or followed forever', () => {
  const source = model({ normalized_cuts: [cut('a', 'one', { conditioning: { cut_id: 'b', answer_key: 'left' } }),
    cut('b', 'one', { conditioning: { cut_id: 'a', answer_key: 'left' } }),
    cut('missing', 'one', { conditioning: { cut_id: 'unknown', answer_key: 'left' } }),
    cut('missing-answer', 'one', { conditioning: { cut_id: 'a', answer_key: 'absent' } })] });
  const records = projectNumerics(source).cuts;
  assert.equal(records[0].conditioningChain.at(-1).status, 'cycle');
  assert.equal(records[2].conditioningChain[0].status, 'missing-cut');
  assert.equal(records[3].conditioningChain[0].status, 'missing-answer');
});

test('contexts follow typed containment, retain shared roots and stop at a nearer root', () => {
  const source = model({ events: [event('world'), event('viewpoint'), event('one'), event('two'), event('three')],
    context_roots: [{ event_id: 'world', kind: 'accepted_world' }, { event_id: 'viewpoint', kind: 'understanding' }],
    event_relations: [contains('world', 'viewpoint'), contains('viewpoint', 'one'), contains('world', 'two'), contains('viewpoint', 'two'),
      { kind: 'about', source_event_id: 'world', target_event_id: 'three' }],
    normalized_cuts: [cut('a', 'one'), cut('b', 'two'), cut('c', 'three')] });
  const [a, b, c] = projectNumerics(source).cuts;
  assert.deepEqual(a.contexts.map((context) => context.rootId), ['viewpoint']);
  assert.equal(a.contexts[0].holder, null);
  assert.equal(b.contextStatus, 'ambiguous');
  assert.deepEqual(new Set(b.contexts.map((context) => context.rootId)), new Set(['world', 'viewpoint']));
  assert.equal(c.contextStatus, 'unrooted', 'about does not transfer context');
});

test('unknown times, unbound records and scalar initial values survive without fabricated dates', () => {
  const source = model({ normalized_cuts: [cut('a', 'untimed'), cut('b', 'absent'), cut('c', 'one')] });
  source.processes = [{ id: 'gauge', initial_value: { kind: 'scalar', value: 72.125 }, unit: 'kPa',
    value_type: { kind: 'scalar' }, uncertainty: { kind: 'interval', lower: 71, upper: 74 },
    support: ['At 1832: 70; at 1890: 80'], provenance: ['source:record'], reference_frame: 'author-defined initial state' },
  { id: 'other', initial_value: { kind: 'regime', value: 'open' } }];
  const projection = projectNumerics(source);
  assert.equal(projection.cuts[0].placement, 'undated');
  assert.equal(projection.cuts[1].placement, 'missing-event');
  assert.equal(projection.cuts[0].t, null);
  assert.deepEqual(projection.counts, { cuts: 3, datedCuts: 1, unplacedCuts: 2, scalarRecords: 1, historicalCuts: 0, ambiguousContexts: 0 });
  const scalar = projection.scalarRecords[0];
  assert.equal(scalar.t, null); assert.equal(scalar.interval, null); assert.equal(scalar.displayable, false);
  assert.equal(scalar.value, 72.125); assert.equal(scalar.unit, 'kPa');
  assert.deepEqual(scalar.support, source.processes[0].support);
  assert.deepEqual(scalar.uncertainty, source.processes[0].uncertainty);
});

test('containment cycles and partially unrooted ancestry remain visible, with exact participant bindings', () => {
  const binding = { id: 'binding', binding_type: 'participates', target: { kind: 'event', event_id: 'one' }, role: 'operator', referent_id: 'instrument' };
  const source = model({ events: [event('origin'), event('orphan'), event('one', null, { participants: { operator: ['instrument'] } }), event('loop')],
    event_relations: [contains('origin', 'one'), contains('orphan', 'one'), contains('loop', 'one'), contains('one', 'loop')],
    event_referent_bindings: [binding] });
  const [record] = projectNumerics(source).cuts;
  assert.equal(record.contextStatus, 'declared');
  assert.deepEqual(new Set(record.contextIssues), new Set(['unrooted-branch', 'containment-cycle']));
  assert.deepEqual(record.participants, { operator: ['instrument'] });
  assert.deepEqual(record.bindings, [binding]);
  assert.equal(record.contexts[0].label, 'Event origin');
});

test('deep containment is stack-safe and event timing qualifications remain exact', () => {
  const length = 12000;
  const events = Array.from({ length }, (_, i) => event(`level:${i}`));
  const description = 'Coarse year envelope; the record does not establish an exact day.';
  events.at(-1).description = description;
  events.at(-1).provenance = ['source:declared-year'];
  const source = model({ events, context_roots: [{ event_id: 'level:0', kind: 'accepted_world' }],
    event_relations: events.slice(1).map((item, i) => contains(events[i].id, item.id)),
    normalized_cuts: [cut('deep', events.at(-1).id)] });
  const [record] = projectNumerics(source).cuts;
  assert.equal(record.contexts[0].rootId, 'level:0');
  assert.deepEqual(record.contextIssues, []);
  assert.equal(record.eventDescription, description);
  assert.deepEqual(record.eventProvenance, ['source:declared-year']);
});

test('withdrawn Cuts remain inspectable history and never become current compositions', () => {
  const withdrawal = { reason: 'Question revised', superseded_by: ['new'] };
  const source = model({ normalized_cuts: [cut('old', 'one', { withdrawn: withdrawal }), cut('new', 'two')] });
  const projection = projectNumerics(source);
  assert.deepEqual(projection.cuts.map((item) => item.id), ['new']);
  assert.equal(projection.historical.count, 1);
  assert.deepEqual(projection.historical.cuts[0].record.withdrawn, withdrawal);
  assert.equal(projection.counts.historicalCuts, 1);
});

test('invalid intervals or a failed display conversion remain explicitly unplaced', () => {
  const source = model({ events: [event('one', { start: 8, end: 3 }), event('two', { start: 1, end: 2 })],
    normalized_cuts: [cut('reversed', 'one'), cut('unconvertible', 'two')] });
  const projection = projectNumerics(source, { toDisplayTime: (value) => value === 2 ? NaN : value });
  assert.ok(projection.cuts.every((item) => !item.displayable));
  assert.ok(projection.cuts.every((item) => item.placement === 'invalid-interval'));
  assert.deepEqual(projection.cuts[0].interval, { start: 8, end: 3 });
});
