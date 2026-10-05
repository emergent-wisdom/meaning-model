import assert from 'node:assert/strict';
import test from 'node:test';
import { modelJumps } from '../src/model-questions.mjs';

// The about link identifies the target; the two inner roots deliberately remain separate perspectives.
function fixture() {
  const event = (id) => ({ id, boundary: id, interval: { start: 8, end: 9 } });
  const cut = (id, parent_event_id, keep) => ({ id, parent_event_id,
    question: 'How does Ada want to answer the offer?', unit: 'share of Ada\'s stance',
    answers: [{ key: 'keep', weight: keep, meaning: 'Keep the bakery.' },
      { key: 'sell', weight: 1 - keep, meaning: 'Sell the bakery.' },
      { key: 'remainder', weight: 0, meaning: 'Other answers to this offer.' }] });
  return { meaning_model: {
    events: ['reader-root', 'target-root', 'reader', 'target'].map(event),
    context_roots: [{ event_id: 'reader-root', kind: 'inner' }, { event_id: 'target-root', kind: 'inner' }],
    event_relations: [
      { id: 'reader-placement', kind: 'contains', source_event_id: 'reader-root', target_event_id: 'reader' },
      { id: 'target-placement', kind: 'contains', source_event_id: 'target-root', target_event_id: 'target' },
      { id: 'reading-about', kind: 'about', source_event_id: 'reader', target_event_id: 'target' },
    ],
    normalized_cuts: [cut('reading', 'reader', 0.1), cut('stance', 'target', 0.85)],
  } };
}
const aboutJumps = (model) => modelJumps(model, { people: [], limit: 100 }).jumps
  .filter((jump) => jump.kind === 'divergence' && jump.eventIds.length === 2);

test('compatible about readings compare across perspectives regardless of answer order', () => {
  const model = fixture();
  model.meaning_model.normalized_cuts[0].answers.reverse();
  const [jump] = aboutJumps(model);
  assert.equal(aboutJumps(model).length, 1);
  assert.deepEqual(jump.eventIds, ['reader', 'target']);
  assert.equal(Number(jump.size.toFixed(2)), 0.75);
});

test('renamed answer keys do not manufacture maximum divergence from equal readings', () => {
  const model = fixture();
  const [reading, target] = model.meaning_model.normalized_cuts;
  reading.answers = structuredClone(target.answers);
  assert.equal(aboutJumps(model).length, 0);
  reading.answers[0].key = 'retain'; reading.answers[1].key = 'dispose';
  assert.equal(aboutJumps(model).length, 0, 'different vocabularies need an explicit mapping, not zero-filled weights');
});

test('changed or missing named-answer and remainder meanings prevent comparison', () => {
  for (const key of ['keep', 'remainder']) {
    for (const meaning of ['A different allocation.', undefined]) {
      const model = fixture();
      model.meaning_model.normalized_cuts[0].answers.find((answer) => answer.key === key).meaning = meaning;
      assert.equal(aboutJumps(model).length, 0, `${key}: mismatched declared meaning`);
    }
  }
});

test('legacy meanings absent on both readings remain comparable', () => {
  const model = fixture();
  for (const cut of model.meaning_model.normalized_cuts) for (const answer of cut.answers) delete answer.meaning;
  assert.equal(aboutJumps(model).length, 1);
});

test('different questions, units or conditioning addresses are not about divergences', () => {
  for (const field of ['question', 'unit']) {
    const model = fixture(); model.meaning_model.normalized_cuts[0][field] += ' in a different sense';
    assert.equal(aboutJumps(model).length, 0, field);
  }
  const model = fixture();
  const [reading, target] = model.meaning_model.normalized_cuts;
  const parent = (id, event) => ({ ...structuredClone(target), id, parent_event_id: event, question: 'Which condition applies?' });
  model.meaning_model.normalized_cuts.push(parent('reader-condition', 'reader-root'), parent('target-condition', 'target-root'));
  reading.conditioning = { cut_id: 'reader-condition', answer_key: 'keep' };
  assert.equal(aboutJumps(model).length, 0, 'conditional and unconditional units differ');
  target.conditioning = { cut_id: 'target-condition', answer_key: 'keep' };
  assert.equal(aboutJumps(model).length, 0, 'different parent Cuts have no declared comparison mapping');
  // Within one context, two readings may share the exact conditional unit.
  model.meaning_model.event_relations.find((relation) => relation.id === 'target-placement').source_event_id = 'reader-root';
  target.conditioning.cut_id = 'reader-condition';
  assert.equal(aboutJumps(model).length, 1);
  target.conditioning.answer_key = 'sell';
  assert.equal(aboutJumps(model).length, 0, 'different slots of one parent are different local units');
});
