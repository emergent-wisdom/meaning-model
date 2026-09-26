import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeCutShares, resolveTargets } from '../src/cut-shares.mjs';
import { readOpenQuestions } from '../src/model-questions.mjs';

// Whole lives and their periods belong to the storytelling profile, which these tests adopt.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

// From the theory's rulings on macro and micro, and on what belongs under a person's inner root.
const at = (start, end = start + 0.1) => ({ start, end });
const base = () => ({ meaning_model: {
  referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' }],
  events: [
    { id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
    { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
    { id: 'ana.ward_years', boundary: 'The ward years, 2000-2010.', interval: at(2000, 2010) },
    { id: 'ana.inner', boundary: 'Ana\'s inner perspective root', participants: { subject: 'person.ana' } },
    { id: 'ana.choice', boundary: 'Ana takes the night shifts', description: 'She signs up for every night in March, and tells no one why.', interval: at(2005), participants: { subject: 'person.ana' } },
  ],
  event_relations: [['ana.life', 'ana.life.is.work'], ['ana.life', 'ana.ward_years'], ['ana.life', 'ana.inner']].map(([source, target]) => ({ kind: 'contains', source_event_id: source, target_event_id: target })),
  context_roots: [{ event_id: 'ana.life', kind: 'accepted_world' }, { event_id: 'ana.inner', kind: 'inner' }],
  normalized_cuts: [
    { id: 'feel.choice', parent_event_id: 'ana.choice', unit: 'emotional attention', question: 'What does Ana feel as she signs up?', answers: [{ key: 'dread', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
    { id: 'cut.choice', parent_event_id: 'ana.choice', unit: 'decision', question: 'Does she take them?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
  ],
} });

test('an estimate is not told the answer it is estimating again', async () => {
  const model = base();
  const service = { inspectModel: async () => ({ model }) };
  const told = await resolveTargets(service, { modelHash: 'a'.repeat(64), situations: [], events: [{ eventId: 'ana.choice', cutId: 'cut.other' }] });
  assert.match(told.targets[0].modeled ?? '', /What does Ana feel as she signs up/u);
  const again = await resolveTargets(service, { modelHash: 'a'.repeat(64), situations: [], events: [{ eventId: 'ana.choice', cutId: 'feel.choice' }] });
  assert.doesNotMatch(again.targets[0].modeled ?? '', /What does Ana feel as she signs up/u);
});

test('a drawn Cut keeps the weights it was drawn from', async () => {
  const model = base();
  model.meaning_model.events.push({ id: 'ana.choice.done', boundary: 'She works every night in March', interval: at(2005.2), participants: { subject: 'person.ana' } });
  model.meaning_model.event_relations.push({ id: 'realized', kind: 'realizes_forecast', source_event_id: 'ana.choice.done', target_event_id: 'ana.choice', forecast_answer: { cut_id: 'cut.choice', answer_key: 'yes' } });
  const service = { inspectModel: async () => ({ model }) };
  const input = { question: 'Does she take them?', unit: 'decision', answers: [{ key: 'yes', meaning: 'she takes the shifts' }], modelHash: 'a'.repeat(64),
    events: [{ eventId: 'ana.choice', cutId: 'cut.choice' }], distributions: [{ situationId: 'ana.choice', probabilities: { yes: 0.3, remainder: 0.7 } }], replaceExisting: true, apply: true, requestId: 'recheck' };
  await assert.rejects(proposeCutShares(input, null, service), /was drawn, so its weights stay as drawn/u);
});

test('a period is cut by the person\'s own inner states within it, not only by Cuts on the period', async () => {
  const model = base();
  const ask = async (definition) => (await readOpenQuestions({ inspectModel: async () => ({ model: definition }) }, { modelHash: 'a'.repeat(64), limit: 60 })).questions.filter((item) => item.kind === 'period-uncut');
  // The act inside the period is a world Event, not the period's state, but the period was cut through it before; take it out.
  const bare = structuredClone(model); bare.meaning_model.normalized_cuts = []; bare.meaning_model.events = bare.meaning_model.events.filter((event) => event.id !== 'ana.choice');
  assert.equal((await ask(bare)).length, 1);
  const inward = structuredClone(bare);
  inward.meaning_model.events.push({ id: 'ana.inner.outlook_2006', boundary: 'How Ana expects the ward years to turn out', interval: at(2006), participants: { subject: 'person.ana' } });
  inward.meaning_model.event_relations.push({ kind: 'contains', source_event_id: 'ana.inner', target_event_id: 'ana.inner.outlook_2006' });
  inward.meaning_model.normalized_cuts.push({ id: 'outlook.2006', parent_event_id: 'ana.inner.outlook_2006', unit: 'fulfillment expectation', question: 'How does Ana expect it to turn out?', answers: [{ key: 'threat', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] });
  assert.equal((await ask(inward)).length, 0);
});
