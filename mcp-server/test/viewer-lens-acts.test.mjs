import test from 'node:test';
import assert from 'node:assert/strict';
import { readingActs, actShares, actCounts } from '../viewer/public/lens-readings.js';
import { buildViewerData } from '../src/viewer-data.mjs';
import { cutTrajectories } from '../viewer/public/cut-trajectories.js';
import { projectNumerics } from '../src/viewer-numerics.mjs';

// A lens reading and the deeper reading that divides one of its answers, as the viewer data carries them.
const reading = (cutId, eventId, answers, extra = {}) => ({ cutId, eventId, t: 2005, question: 'q', unit: 'u', answers, ...extra });
const top = reading('lens.fear-love.ana.act', 'ana.act', [{ key: 'fear', weight: 0.6 }, { key: 'love', weight: 0.3 }, { key: 'remainder', weight: 0.1 }]);
const kinds = reading('lens.fear-love.ana.act.in.fear', 'ana.act', [{ key: 'being_found_out', weight: 0.7 }, { key: 'losing_what_they_have', weight: 0.2 }, { key: 'remainder', weight: 0.1 }],
  { conditioning: { cutId: 'lens.fear-love.ana.act', answerKey: 'fear' } });
const other = reading('lens.fear-love.bo.act', 'bo.act', [{ key: 'love', weight: 0.8 }, { key: 'remainder', weight: 0.2 }]);

test('a deeper reading is shown inside the answer it divides, so each act is read once', () => {
  const acts = readingActs([top, kinds, other]);
  assert.deepEqual(acts.map((act) => act.cutId), [top.cutId, other.cutId]);
  assert.deepEqual(acts[0].within.map((item) => item.cutId), [kinds.cutId]);
  assert.deepEqual(actCounts(acts), { acts: 2, deeper: 1 });
  // Order does not matter, and the source readings are not changed.
  assert.deepEqual(readingActs([kinds, other, top]).map((act) => act.cutId).sort(), [top.cutId, other.cutId].sort());
  assert.equal(top.within, undefined);
});

test('an act\'s shares multiply a deeper reading by its answer, and keep every declared share', () => {
  const [act] = readingActs([top, kinds]);
  const shares = actShares(act, (key) => key);
  const joint = Object.fromEntries(shares.map((share) => [share.path.join('>'), +share.weight.toFixed(6)]));
  assert.deepEqual(joint, { 'fear>being_found_out': 0.42, 'fear>losing_what_they_have': 0.12, 'fear>remainder': 0.06, love: 0.3, remainder: 0.1 });
  assert.equal(+shares.reduce((sum, share) => sum + share.weight, 0).toFixed(9), 1);
  assert.deepEqual([...new Set(shares.filter((share) => share.depth).map((share) => share.family))], ['fear']);
  assert.equal(shares.at(-1).key, 'remainder', 'the remainder comes last');
});

test('a reading whose parent is not shown, or that names an answer the parent lacks, stands as its own act', () => {
  const orphan = { ...kinds, cutId: 'lens.fear-love.x.in.fear', conditioning: { cutId: 'lens.fear-love.gone', answerKey: 'fear' } };
  const wrongAnswer = { ...kinds, cutId: 'lens.fear-love.y.in.hope', conditioning: { cutId: top.cutId, answerKey: 'hope' } };
  assert.deepEqual(readingActs([top, orphan, wrongAnswer]).map((act) => act.cutId), [top.cutId, orphan.cutId, wrongAnswer.cutId]);
  // A conditioning cycle cannot hide both readings.
  const a = reading('a', 'e', [{ key: 'x', weight: 1 }], { conditioning: { cutId: 'b', answerKey: 'x' } });
  const b = reading('b', 'e', [{ key: 'x', weight: 1 }], { conditioning: { cutId: 'a', answerKey: 'x' } });
  assert.equal(readingActs([a, b]).length, 2);
});

test('viewer data names whose act a reading reads and carries its conditioning, and deeper keys are the lens\'s own', async () => {
  const lensUnit = 'lens:fear-love@0123456789abcdef';
  const model = { schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year', processes: [], meaning_model: {
    referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse', lifecycle_event_id: 'ana.life' }],
    events: [{ id: 'ana.life', boundary: 'Ana\'s life', interval: { start: 1980, end: 2030 }, participants: { subject: 'person.ana' } },
      { id: 'ana.act', boundary: 'Ana leaves the ward', interval: { start: 2005, end: 2005.1 }, participants: { subject: 'person.ana' } }],
    event_relations: [{ id: 'c', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.act' }],
    context_roots: [{ event_id: 'ana.life', kind: 'accepted_world' }],
    normalized_cuts: [
      { id: top.cutId, parent_event_id: 'ana.act', question: 'Is it fear or love?', unit: lensUnit, answers: top.answers },
      { id: kinds.cutId, parent_event_id: 'ana.act', question: 'Which fear?', unit: lensUnit, conditioning: { cut_id: top.cutId, answer_key: 'fear' }, answers: kinds.answers },
    ] } };
  const lensNode = { id: 'lens.fear-love', node_type: 'understanding.lens', holder: 'writer', text: JSON.stringify({ data: { schema: 'meaning-model-lens/v1', id: 'fear-love', name: 'Fear or love', appliesTo: ['act'],
    question: 'Is what {subject} does out of fear or out of love?', why: 'It changes what the act does.',
    answers: [{ key: 'fear', meaning: 'fear', children: [{ key: 'being_found_out', meaning: 'x' }, { key: 'losing_what_they_have', meaning: 'y' }] }, { key: 'love', meaning: 'love' }] } }) };
  const data = await buildViewerData({ history: { models: [{ modelHash: 'a'.repeat(64), definition: model }],
    revisions: [{ graphHash: 'b'.repeat(64), definition: { id: 'g', source: { kind: 'model', model_hash: 'a'.repeat(64) }, nodes: [lensNode], edges: [] } }] }, generatedAt: '2026-09-27T12:00:00.000Z' });
  const lens = data.lenses.find((item) => item.id === 'fear-love');
  const [first, deeper] = [top.cutId, kinds.cutId].map((id) => lens.readings.find((item) => item.cutId === id));
  assert.equal(first.subject, 'person.ana'); assert.equal(deeper.subject, 'person.ana');
  assert.deepEqual(deeper.conditioning, { cutId: top.cutId, answerKey: 'fear' });
  assert.equal(first.conditioning, undefined);
  assert.equal(deeper.earlier, undefined, 'the kinds within an answer are the lens\'s vocabulary, not an earlier version\'s');
  assert.deepEqual(actCounts(readingActs(lens.readings)), { acts: 1, deeper: 1 });
});

test('Cut curves are named by their answer, their question names the series once, and the remainder comes last', () => {
  const cut = (id, parent_event_id, weight) => ({ id, parent_event_id, question: 'How is attention divided?', unit: 'attention',
    answers: [{ key: 'work_and_home', weight }, { key: 'remainder', weight: 0.1 }, { key: 'body', weight: 0.9 - weight }], provenance: ['authored fixture'] });
  const model = { id: 'm', time_unit: 'cycles', processes: [], meaning_model: {
    referents: [{ id: 'device:x', boundary: 'Rover', lifecycle_event_id: 'life' }],
    events: [{ id: 'world', boundary: 'world', participants: {}, process_ids: [] }, { id: 'life', boundary: 'life', participants: {}, process_ids: [] },
      { id: 'first', boundary: 'first', interval: { start: 2, end: 4 }, participants: {}, process_ids: [] }, { id: 'later', boundary: 'later', interval: { start: 8, end: 12 }, participants: {}, process_ids: [] }],
    context_roots: [{ event_id: 'world', kind: 'accepted_world' }],
    event_relations: [['world', 'life'], ['life', 'first'], ['life', 'later']].map(([source_event_id, target_event_id]) => ({ kind: 'contains', source_event_id, target_event_id })),
    normalized_cuts: [cut('a', 'first', 0.5), cut('b', 'later', 0.7)] } };
  const rows = cutTrajectories({ inspection: { model }, numerics: projectNumerics(model) });
  assert.deepEqual(rows.map((row) => row.label), ['body', 'work and home', 'remainder']);
  assert.deepEqual(rows.map((row) => row.series.first), [true, false, false]);
  assert.deepEqual(rows.map((row) => row.remainder), [false, false, true]);
  assert.ok(rows.every((row) => row.question === 'How is attention divided?' && row.series.size === 3));
});
