import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { LifeSimulationService } from '../src/service.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { modelJumps } from '../src/model-questions.mjs';

// The minimal example's forecast and misreading sections, applied to its documented model through the change patch.
async function documented(t, requestId) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const [, registerRequest] = blocks; const change = blocks.find((block) => block.requestId === requestId)?.change;
  assert.ok(change, `the example documents ${requestId}`);
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest);
  const { model: previous } = await service.inspectModel({ modelHash, includeDefinition: true });
  const revised = await service.reviseModel({ requestId, previousModelHash: modelHash, model: applyModelChange(previous, modelHash, change).successor });
  return (await service.inspectModel({ modelHash: revised.modelHash, includeDefinition: true })).model;
}

// The nearest declared context root above an Event, through contains relations.
function rootOf(model, eventId) {
  const roots = new Map(model.meaning_model.context_roots.map((root) => [root.event_id, root.kind]));
  const parent = new Map(model.meaning_model.event_relations.filter((relation) => relation.kind === 'contains').map((relation) => [relation.target_event_id, relation.source_event_id]));
  for (let id = eventId; id; id = parent.get(id)) if (roots.has(id)) return [id, roots.get(id)];
  return null;
}

test('an issued forecast keeps its identity beside a later one, and each is scored as issued', async (t) => {
  const model = await documented(t, 'minimal-example-forecasts');
  const cuts = new Map(model.meaning_model.normalized_cuts.map((cut) => [cut.id, cut]));
  const issued = ['cut.forecast.h07', 'cut.forecast.h12'].map((id) => cuts.get(id));
  for (const cut of issued) {
    assert.deepEqual(rootOf(model, cut.parent_event_id), ['event.modeler', 'understanding'], 'held by the modeler, not the world');
    assert.ok(['evidence cutoff: ', 'horizon: hour 24', 'settled by: '].every((entry) => cut.provenance.some((item) => item.startsWith(entry))));
  }
  assert.equal(issued[0].question, issued[1].question, 'the same words, so the issued forecasts read in order');
  assert.match(issued[0].question, /first recorded acceptance or refusal.*before hour 24/u);
  assert.deepEqual(issued[0].answers.map(({ key, meaning }) => [key, meaning]), issued[1].answers.map(({ key, meaning }) => [key, meaning]),
    'new evidence changes probabilities, not the outcome partition');
  for (const cut of issued) {
    const settlement = cut.provenance.find((item) => item.startsWith('settled by: '));
    assert.match(settlement, /first unambiguous acceptance or refusal.*after the offer arrives and before hour 24/u);
    assert.match(settlement, /log order breaks timestamp ties; later reversals do not change the outcome; if none, remainder at hour 24/u);
    assert.match(cut.answers.find((answer) => answer.key === 'remainder').meaning, /No qualifying acceptance or refusal is recorded before hour 24/u);
  }
  const settled = model.meaning_model.event_relations.filter((relation) => relation.kind === 'realizes_forecast');
  assert.deepEqual(settled.map((relation) => [relation.forecast_answer.cut_id, relation.forecast_answer.answer_key, relation.target_event_id]),
    [['cut.forecast.h07', 'declines', 'event.ada.declines'], ['cut.forecast.h12', 'declines', 'event.ada.declines']]);
  assert.deepEqual(rootOf(model, 'event.ada.declines'), ['event.world', 'accepted_world']);
  assert.match(model.meaning_model.events.find((event) => event.id === 'event.ada.declines').description, /first acceptance or refusal/u,
    'the outcome settles the first-response forecast even if a later response changes');
  // The documented scores, from the weights as issued.
  const scores = issued.map((cut) => {
    const happened = settled.find((relation) => relation.forecast_answer.cut_id === cut.id).forecast_answer.answer_key;
    const weight = (key) => cut.answers.find((answer) => answer.key === key).weight;
    return [Number((-Math.log(weight(happened))).toFixed(2)), Number(cut.answers.reduce((sum, answer) => sum + (answer.weight - (answer.key === happened ? 1 : 0)) ** 2, 0).toFixed(3))];
  });
  assert.deepEqual(scores, [[1.2, 0.86], [0.6, 0.335]]);
});

test('one person\'s mistaken reading of another stays theirs, drives their act, and shows as a jump', async (t) => {
  const model = await documented(t, 'minimal-example-misreading');
  assert.deepEqual(rootOf(model, 'event.ada.stance.h08'), ['event.ada.inner', 'inner']);
  assert.deepEqual(rootOf(model, 'event.lise.reads.ada.h08'), ['event.lise.inner', 'inner']);
  assert.deepEqual(rootOf(model, 'event.lise.calls.buyer'), ['event.world', 'accepted_world'], 'the act is world fact; neither reading is');
  const reading = model.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.lise.reads.ada.h08');
  assert.deepEqual(reading.answers.find((answer) => answer.key === 'remainder')?.weight, 0, 'the remainder is stored as zero when none is named');
  assert.ok(model.meaning_model.event_relations.some((relation) => relation.kind === 'causes' && relation.source_event_id === 'event.lise.reads.ada.h08' && relation.target_event_id === 'event.lise.calls.buyer'));
  const gap = modelJumps(model).jumps.find((jump) => jump.kind === 'divergence' && jump.eventIds.includes('event.lise.reads.ada.h08'));
  assert.ok(gap, 'the misreading is among the jumps');
  assert.deepEqual(gap.eventIds, ['event.lise.reads.ada.h08', 'event.ada.stance.h08']);
  assert.equal(Number(gap.size.toFixed(2)), 0.75);
  assert.match(gap.what, /^Lise's reading of Ada's stance at hour 8 answers "How does Ada's stance on the offer divide/u);
});
