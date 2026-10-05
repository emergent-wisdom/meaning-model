import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { LifeSimulationService } from '../src/service.mjs';
import { applyModelChange } from '../src/model-change.mjs';

// The documented carve applies to the documented model: concepts, a specialization and an abstract Cut in host fields.
test('the minimal example records a concept carve the host accepts', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const [, registerRequest] = blocks; const carve = blocks.find((block) => block.requestId === 'minimal-example-concepts');
  assert.ok(carve, 'the example documents a carve');
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest);
  const { model: previous } = await service.inspectModel({ modelHash, includeDefinition: true });
  const { successor } = applyModelChange(previous, modelHash, carve.change);
  const revised = await service.reviseModel({ requestId: 'carve', previousModelHash: modelHash, model: successor });
  const { model } = await service.inspectModel({ modelHash: revised.modelHash, includeDefinition: true });
  assert.deepEqual(model.meaning_model.concepts.map((concept) => concept.id).sort(),
    ['concept.allocation', 'concept.attention', 'concept.attention.continuity', 'concept.attention.money']);
  assert.equal(model.meaning_model.abstract_relations[0].kind, 'specialization');
  assert.deepEqual([...model.meaning_model.abstract_cuts[0].child_concept_ids].sort(), ['concept.attention.continuity', 'concept.attention.money']);
});
