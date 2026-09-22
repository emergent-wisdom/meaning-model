import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { drawDirection, drawFromAnswers, drawUniform } from '../src/direction-draw.mjs';

const answers = (pairs) => pairs.map(([key, weight]) => ({ key, weight }));

test('the draw reproduces the two recorded authoring-run draws from their seeds', () => {
  // 2026-09-22 sci-fi run: the remainder was realized by 0.0098.
  const u = drawUniform('focal-line/decision-direction/2026-09-22/draw-1');
  assert.ok(Math.abs(u - 0.749831) < 1e-6);
  const scifi = drawFromAnswers(answers([['go_together', 0.05], ['astronomer_stays', 0.47], ['engineer_stays', 0.22], ['remainder', 0.26]]), u);
  assert.equal(scifi.realized, 'remainder');
  assert.deepEqual(scifi.cumulative.map(({ key }) => key), ['go_together', 'astronomer_stays', 'engineer_stays', 'remainder'], 'answers are taken in model order');
  // 2026-09-22 dogfood run: the draw landed on refuse_outright instead of the planned division.
  const dogfood = drawFromAnswers(answers([['sell', 0.30], ['refuse_outright', 0.15], ['divide', 0.45], ['remainder', 0.10]]), drawUniform('mother-dough/decision-direction/2026-09-22/draw-1'));
  assert.equal(dogfood.realized, 'refuse_outright');
});

test('the last interval absorbs floating-point shortfall at the top of the unit', () => {
  const { realized } = drawFromAnswers(answers([['a', 0.3], ['b', 0.3], ['remainder', 0.39999999999]]), 0.9999999999);
  assert.equal(realized, 'remainder');
});

function jsonBlocks(markdown) {
  return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
}

test('a recorded draw is stored in the bound graph and a second draw over the same Cut is a linked reroll', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = jsonBlocks(markdown);
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest);
  const graph = await service.registerNarrativeGraph(JSON.parse(JSON.stringify(graphRequest).replaceAll('MODEL_HASH', modelHash)));
  const cutId = 'cut.ada.h06.attention';

  const unrecorded = await drawDirection(service, { modelHash, cutId, seed: 'harbour/draw' });
  assert.equal(unrecorded.recorded, null);
  assert.equal(unrecorded.graphMutation, false);
  assert.equal(unrecorded.realized, drawFromAnswers(unrecorded.answers, drawUniform('harbour/draw')).realized);

  const first = await drawDirection(service, { modelHash, cutId, seed: 'harbour/draw',
    record: { graphHash: graph.graphHash, requestId: 'draw-1', nodeId: 'draw-1', rootId: 'story', accessScopes: ['author'], reason: 'Decide the offer.' } });
  assert.equal(first.reroll, false);
  assert.equal(first.drawIndex, 0);
  assert.equal(first.graphHash, first.recorded.graphHash, 'the successor graph is the one to continue from');
  assert.equal(first.previousGraphHash, graph.graphHash);
  const view = await service.queryNarrativeGraph({ graphHash: first.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const node = view.nodes.find(({ id }) => id === 'draw-1');
  assert.equal(node.node_type, 'direction_draw');
  assert.equal(node.render, 'exclude');
  const payload = JSON.parse(node.text);
  assert.equal(payload.seed, 'harbour/draw');
  assert.equal(payload.realized, first.realized);
  assert.equal(payload.reason, 'Decide the offer.');
  assert.ok(view.edges.some((edge) => edge.source.node_id === 'draw-1' && edge.target.kind === 'anchor' && edge.target.anchor_id === 'event.ada.state.h06'),
    'the draw is grounded in the Cut\'s parent event');

  const second = await drawDirection(service, { modelHash, cutId, seed: 'harbour/draw-again',
    record: { graphHash: first.graphHash, requestId: 'draw-2', nodeId: 'draw-2', rootId: 'story', accessScopes: ['author'] } });
  assert.equal(second.reroll, true);
  assert.equal(second.drawIndex, 1);
  assert.deepEqual(second.priorDraws.map(({ nodeId, seed }) => ({ nodeId, seed })), [{ nodeId: 'draw-1', seed: 'harbour/draw' }]);
  const after = await service.queryNarrativeGraph({ graphHash: second.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  assert.ok(after.edges.some((edge) => edge.relation === 'rerolls' && edge.source.node_id === 'draw-2' && edge.target.node_id === 'draw-1'));

  await assert.rejects(drawDirection(service, { modelHash, cutId: 'cut.missing', seed: 's' }), /Unknown normalized Cut cut\.missing/);
  const other = structuredClone(registerRequest);
  other.requestId = 'other-model'; other.model.id = 'harbour-example-other';
  const { modelHash: otherHash } = await service.registerModel(other);
  await assert.rejects(drawDirection(service, { modelHash: otherHash, cutId, seed: 's',
    record: { graphHash: second.graphHash, requestId: 'draw-3', nodeId: 'draw-3', rootId: 'story', accessScopes: ['author'] } }), /bound to the drawn model/);
  await assert.rejects(drawDirection(service, { modelHash, cutId, seed: 's',
    record: { graphHash: second.graphHash, requestId: 'draw-4', nodeId: 'draw-1', rootId: 'story', accessScopes: ['author'] } }), /already exists/);
});

test('a successor model links the drawn answer to its continuation with realizes_forecast', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = jsonBlocks(markdown);
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const successor = (answerKey, requestId) => {
    const request = structuredClone(registerRequest);
    request.requestId = requestId;
    const meaning = request.model.meaning_model;
    meaning.events.push({ id: 'event.ada.follows.h07', boundary: 'What Ada attends to next, after the offer.', interval: { start: 6.25, end: 7 },
      participants: { subject: 'referent.ada' }, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['direction-draw test'] });
    meaning.event_relations.push(
      { id: 'ada.inner.contains.h07', kind: 'contains', source_event_id: 'event.ada.inner', target_event_id: 'event.ada.follows.h07',
        description: null, authority: null, uncertainty: { kind: 'unknown' }, provenance: ['direction-draw test'] },
      { id: 'h06.realizes.h07', kind: 'realizes_forecast', source_event_id: 'event.ada.state.h06', target_event_id: 'event.ada.follows.h07',
        description: null, authority: null, uncertainty: { kind: 'exact' }, provenance: ['direction-draw test'],
        forecast_answer: { cut_id: 'cut.ada.h06.attention', answer_key: answerKey } });
    return request;
  };
  const { modelHash } = await service.registerModel(successor('money', 'realized-money'));
  const inspected = await service.inspectModel({ modelHash, includeDefinition: true });
  const relation = inspected.model.meaning_model.event_relations.find(({ id }) => id === 'h06.realizes.h07');
  assert.deepEqual(relation.forecast_answer, { cut_id: 'cut.ada.h06.attention', answer_key: 'money' });
  await assert.rejects(service.registerModel(successor('savings', 'realized-unknown')), /names unknown answer savings of Cut cut\.ada\.h06\.attention/);
});
