import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNumerics } from '../src/viewer-numerics.mjs';
import { cutTrajectories } from '../viewer/public/cut-trajectories.js';

const event = (id, extra = {}) => ({ id, boundary: id, participants: {}, process_ids: [], ...extra });
const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
const cut = (id, parent_event_id, weight, extra = {}) => ({ id, parent_event_id, question: 'How is operating effort allocated?', unit: 'operating effort',
  answers: [{ key: 'drive', weight }, { key: 'idle', weight: 1 - weight }, { key: 'remainder', weight: 0 }], provenance: ['authored fixture'], ...extra });
function fixture() {
  return { id: 'arbitrary-device-model', time_unit: 'cycles', processes: [{ id: 'motor', initial_value: { kind: 'graph', value: { nodes: [], edges: [] } } }], meaning_model: {
    referents: [{ id: 'device:x', boundary: 'Research rover', lifecycle_event_id: 'operating-life' }],
    events: [event('world'), event('operating-life', { process_ids: ['motor'] }), event('first', { interval: { start: 2, end: 4 } }), event('later', { interval: { start: 8, end: 12 } })],
    context_roots: [{ event_id: 'world', kind: 'accepted_world' }],
    event_relations: [contains('world', 'operating-life'), contains('operating-life', 'first'), contains('operating-life', 'later')],
    normalized_cuts: [cut('a', 'first', 0.123456789012345), cut('b', 'later', 0.8)],
  } };
}
const dataOf = (model) => ({ inspection: { model }, numerics: projectNumerics(model) });

test('generic nonhuman life produces exact answer curves over whole intervals, without an all-zero remainder row', () => {
  const data = dataOf(fixture()); data.numerics.cuts[0].born = { at: '2026-01-01T00:00:00Z' };
  const before = structuredClone(data), rows = cutTrajectories(data);
  assert.equal(rows.length, 2, 'a remainder that every reading leaves at zero gets no row');
  const drive = rows.find((row) => row.answerKey === 'drive');
  assert.deepEqual(drive.points.map((point) => point.v), [0.123456789012345, 0.8]);
  assert.deepEqual(drive.points[0].interval, { start: 2, end: 4 });
  assert.deepEqual(drive.points[0].born, data.numerics.cuts[0].born);
  assert.deepEqual(drive.points[0].cut, data.numerics.cuts[0]);
  assert.deepEqual(drive.group, { id: 'device:x', label: 'Research rover' });
  assert.equal(drive.owner, 'device:x'); assert.equal(drive.home, 'operating-life');
  assert.deepEqual(drive.range, [0, 1]); assert.deepEqual(drive.domain, [2, 12], 'the series runs to the end of its last interval');
  assert.deepEqual(drive.interpolation, { kind: 'interval-average', nested: 'finest-visible', extrapolate: false });
  assert.equal(rows.find((row) => row.answerKey === 'remainder'), undefined);
  assert.deepEqual(data, before);
  drive.points[0].cut.answers[0].weight = 0;
  assert.deepEqual(data, before, 'display rows must not alias source records');
});

test('all containment branches matter: a farther different lifecycle cannot hide behind the closest owner', () => {
  const model = fixture();
  model.meaning_model.referents.push({ id: 'other-device', lifecycle_event_id: 'other-life' });
  model.meaning_model.events.push(event('other-life'), event('intermediate'));
  model.meaning_model.event_relations.push(contains('world', 'other-life'), contains('other-life', 'intermediate'), contains('intermediate', 'first'));
  assert.deepEqual(cutTrajectories(dataOf(model)), []);
  model.meaning_model.referents.pop();
  assert.deepEqual(cutTrajectories(dataOf(model)), [], 'an unresolved branch is not silently assigned the other branch owner');
});

test('a containment cycle or conflicting direct participant prevents automatic joining', () => {
  const model = fixture();
  model.meaning_model.event_relations.push(contains('first', 'operating-life'));
  assert.deepEqual(cutTrajectories(dataOf(model)), []);
  const direct = fixture();
  direct.meaning_model.referents.push({ id: 'visitor' });
  direct.meaning_model.events.find((item) => item.id === 'first').participants = { operator: 'visitor' };
  assert.deepEqual(cutTrajectories(dataOf(direct)), []);
});

test('explicit subject bindings support a model without lifecycle scaffolds', () => {
  const model = fixture();
  delete model.meaning_model.referents[0].lifecycle_event_id;
  model.meaning_model.event_referent_bindings = ['first', 'later'].map((event_id, i) => ({ id: `binding:${i}`, target: { kind: 'event', event_id }, role: 'sampled machine', binding_type: 'participates', referent_id: 'device:x' }));
  assert.equal(cutTrajectories(dataOf(model)).length, 2);
});

test('question, unit, answer vocabulary, process and context differences never merge', () => {
  for (const variant of ['question', 'unit', 'answers', 'process', 'context']) {
    const model = fixture(), second = model.meaning_model.normalized_cuts[1];
    if (variant === 'question') second.question = 'How is OPERATING effort allocated?';
    if (variant === 'unit') second.unit = 'different denominator';
    if (variant === 'answers') second.answers[0].key = 'different meaning';
    if (variant === 'process') model.meaning_model.events.find((item) => item.id === 'later').process_ids = ['other-motor'];
    if (variant === 'context') model.meaning_model.context_roots.push({ event_id: 'later', kind: 'understanding' });
    assert.deepEqual(cutTrajectories(dataOf(model)), [], variant);
  }
});

test('compatible conditional schemas join local shares while exact parent references stay on each point', () => {
  const model = fixture(), [a, b] = model.meaning_model.normalized_cuts;
  a.conditioning = { cut_id: 'parent:a', answer_key: 'drive' }; b.conditioning = { cut_id: 'parent:b', answer_key: 'drive' };
  model.meaning_model.normalized_cuts.push(cut('parent:a', 'first', 0.2, { question: 'Parent question', unit: 'parent effort' }),
    cut('parent:b', 'later', 0.4, { question: 'Parent question', unit: 'parent effort' }));
  const rows = cutTrajectories(dataOf(model)), child = rows.find((row) => row.question === a.question && row.answerKey === 'drive');
  assert.deepEqual(child.points.map((point) => point.v), [a.answers[0].weight, b.answers[0].weight], 'conditional weights are not multiplied by changing parent shares');
  assert.deepEqual(child.points.map((point) => point.cut.conditioning.cut_id), ['parent:a', 'parent:b']);
  assert.equal(child.conditioningSchema[0].question, 'Parent question');
  assert.equal(child.conditioningSchema[0].unit, 'parent effort');
  assert.equal(child.conditioningSchema[0].answerKey, 'drive');
  b.conditioning.answer_key = 'idle';
  assert.equal(cutTrajectories(dataOf(model)).filter((row) => row.question === a.question).length, 0, 'different conditional branches do not join');
});

test('changed parent question or unresolved conditioning cannot yield a child trajectory', () => {
  const model = fixture(), [a, b] = model.meaning_model.normalized_cuts;
  a.conditioning = { cut_id: 'parent:a', answer_key: 'drive' }; b.conditioning = { cut_id: 'parent:b', answer_key: 'drive' };
  model.meaning_model.normalized_cuts.push(cut('parent:a', 'first', 0.2, { question: 'Parent question' }), cut('parent:b', 'later', 0.3, { question: 'Other parent question' }));
  assert.deepEqual(cutTrajectories(dataOf(model)), []);
  model.meaning_model.normalized_cuts.pop();
  assert.deepEqual(cutTrajectories(dataOf(model)), []);
});

test('duplicate start times, missing time and withdrawn samples remain records without invented curves', () => {
  for (const variant of ['duplicate', 'identical-duplicate', 'untimed', 'withdrawn']) {
    const model = fixture();
    if (variant.includes('duplicate')) {
      model.meaning_model.events.push(event('parallel', { interval: { start: 2, end: 4 } }));
      model.meaning_model.event_relations.push(contains('operating-life', 'parallel'));
      model.meaning_model.normalized_cuts.push(cut('c', 'parallel', variant === 'duplicate' ? 0.4 : model.meaning_model.normalized_cuts[0].answers[0].weight));
    } else if (variant === 'untimed') model.meaning_model.events.find((item) => item.id === 'later').interval = null;
    else model.meaning_model.normalized_cuts[1].withdrawn = { reason: 'replaced' };
    const data = dataOf(model), before = structuredClone(data);
    assert.deepEqual(cutTrajectories(data), [], variant); assert.deepEqual(data, before);
  }
});

test('stable identities ignore record ordering and reject projection/native disagreement', () => {
  const model = fixture(), data = dataOf(model), ids = cutTrajectories(data).map((row) => row.id);
  model.meaning_model.events.reverse(); model.meaning_model.normalized_cuts.reverse(); model.meaning_model.event_relations.reverse();
  assert.deepEqual(cutTrajectories(dataOf(model)).map((row) => row.id), ids);
  data.numerics.cuts[0].answers[0].weight += 0.01;
  assert.deepEqual(cutTrajectories(data), []);
  assert.deepEqual(cutTrajectories({}), []);
});

test('a remainder that some reading leaves open keeps its row, after the answers', () => {
  const model = fixture();
  model.meaning_model.normalized_cuts[1].answers = [{ key: 'drive', weight: 0.6 }, { key: 'idle', weight: 0.3 }, { key: 'remainder', weight: 0.1 }];
  const rows = cutTrajectories(dataOf(model));
  assert.deepEqual(rows.map((row) => row.answerKey), ['drive', 'idle', 'remainder']);
  assert.deepEqual(rows.at(-1).points.map((point) => point.v), [0, 0.1]);
});

test('readings opened inside a longer reading stay in its series, while two readings of one interval conflict', () => {
  const model = fixture();
  model.meaning_model.events.push(event('first-half', { interval: { start: 2, end: 3 } }));
  model.meaning_model.event_relations.push(contains('first', 'first-half'));
  model.meaning_model.normalized_cuts.push(cut('a-detail', 'first-half', 0.5));
  const drive = cutTrajectories(dataOf(model)).find((row) => row.answerKey === 'drive');
  assert.deepEqual(drive.points.map((point) => [point.cutId, point.t, point.end]), [['a', 2, 4], ['a-detail', 2, 3], ['b', 8, 12]],
    'a finer reading that starts with its parent is detail, not a duplicate');
  model.meaning_model.events.push(event('first-again', { interval: { start: 2, end: 4 } }));
  model.meaning_model.event_relations.push(contains('operating-life', 'first-again'));
  model.meaning_model.normalized_cuts.push(cut('a-again', 'first-again', 0.9));
  assert.deepEqual(cutTrajectories(dataOf(model)), [], 'two readings of exactly the same interval are not resolved by choosing one');
});
