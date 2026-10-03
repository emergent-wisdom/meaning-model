import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { proposeCutShares } from '../src/cut-shares.mjs';
import { exportConstructionHistory, importConstructionHistory } from '../src/construction-record.mjs';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';

const meanings = [
  { key: 'a17', meaning: '  Attention to discharging the outstanding loan; a task-directed concern, not all uses of money.\n' },
  { key: 'b29', meaning: 'Attention to intergenerational stewardship of the bakery, distinct from operating its ovens today.' },
];
const remainderMeaning = 'Unresolved allocation or concerns outside the two definitions, not disbelief in the event.';
const definitions = (cut) => Object.fromEntries(cut.answers.map(({ key, meaning }) => [key, meaning]));
const opaque = (model) => model.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.audit.opaque');

test('opaque Cut definitions survive apply, successor revision, native restart and portable history export', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cut-definitions-'));
  const services = [];
  t.after(async () => {
    await Promise.all(services.map((service) => service.close()));
    await rm(directory, { recursive: true, force: true });
  });
  const start = async (name) => {
    const backend = new RustEngineProcess();
    backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, `${name}.sqlite`) };
    const service = new LifeSimulationService({ backend }); services.push(service);
    await service.initialize(); return service;
  };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, modelRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = await start('source');
  const base = await service.registerModel({ requestId: 'base', model: modelRequest.model });
  const input = { question: 'How does the attributed reading allocate one attention budget at hour six?', unit: 'share of one attributed attention budget',
    answers: meanings, remainderMeaning, events: [{ eventId: 'event.ada.state.h06', cutId: 'cut.audit.opaque' }],
    distributions: [{ situationId: 'event.ada.state.h06', probabilities: { a17: 0.55, b29: 0.35, remainder: 0.1 }, suppliedBy: 'synthetic-fixture' }] };
  const first = await proposeCutShares({ ...input, modelHash: base.modelHash, apply: true, requestId: 'first' }, null, service);
  const expectedFirst = Object.fromEntries([...meanings.map(({ key, meaning }) => [key, meaning]), ['remainder', remainderMeaning]]);
  assert.deepEqual(definitions(first.proposals[0]), expectedFirst);
  assert.deepEqual(definitions(opaque((await service.inspectModel({ modelHash: first.applied.modelHash, includeDefinition: true })).model)), expectedFirst);

  // The same opaque key deliberately means something else in the successor. The old revision must retain its definition.
  const changed = meanings.map((answer) => answer.key === 'a17' ? { ...answer, meaning: 'Attention to operating the bakery today; this excludes repayment of the loan.' } : answer);
  const second = await proposeCutShares({ ...input, answers: changed, remainderMeaning: 'All attention outside today\'s operation and intergenerational stewardship.',
    modelHash: first.applied.modelHash, replaceExisting: true, apply: true, requestId: 'second' }, null, service);
  const expectedSecond = Object.fromEntries([...changed.map(({ key, meaning }) => [key, meaning]), ['remainder', "All attention outside today's operation and intergenerational stewardship."]]);
  const third = await proposeCutShares({ ...input, answers: changed, remainderMeaning: expectedSecond.remainder,
    distributions: [{ situationId: 'event.ada.state.h06', probabilities: { a17: 0.4, b29: 0.5, remainder: 0.1 } }],
    modelHash: second.applied.modelHash, replaceExisting: true, apply: true, requestId: 'reweight' }, null, service);
  await service.close();

  const restored = await start('source');
  for (const [hash, expected] of [[first.applied.modelHash, expectedFirst], [second.applied.modelHash, expectedSecond], [third.applied.modelHash, expectedSecond]]) {
    const inspected = await restored.inspectModel({ modelHash: hash, includeDefinition: true });
    assert.deepEqual(definitions(opaque(inspected.model)), expected);
  }
  const child = await proposeCutShares({ question: 'Which part of this concern is active?', answers: [{ key: 'c31', meaning: 'Staffing the counter.' }],
    modelHash: third.applied.modelHash, events: [{ eventId: 'event.ada.state.h06', cutId: 'cut.audit.child', conditionedOn: { cutId: 'cut.audit.opaque', answerKey: 'a17' } }] }, null, restored);
  assert.ok(child.tasks[0].state.within.includes(expectedSecond.a17), 'a later conditioned estimate can interpret the opaque parent key from its stored definition');
  assert.ok(!child.tasks[0].state.within.includes('0.4'), 'parent weights do not anchor the conditioned estimate');
  const legacy = (await restored.inspectModel({ modelHash: base.modelHash, includeDefinition: true })).model;
  assert.ok(legacy.meaning_model.normalized_cuts.every((cut) => cut.answers.every((answer) => !Object.hasOwn(answer, 'meaning'))));
  graphRequest.narrativeGraph.source.model_hash = third.applied.modelHash;
  const graph = await restored.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graphRequest.narrativeGraph });
  const exported = JSON.parse(JSON.stringify(await exportConstructionHistory(restored, { graphHash: graph.graphHash })));
  for (const [hash, expected] of [[first.applied.modelHash, expectedFirst], [second.applied.modelHash, expectedSecond], [third.applied.modelHash, expectedSecond]]) {
    assert.deepEqual(definitions(opaque(exported.models.find((entry) => entry.modelHash === hash).definition)), expected);
  }
  const imported = await start('imported');
  await importConstructionHistory(imported, { requestId: 'import', history: exported });
  assert.deepEqual(definitions(opaque((await imported.inspectModel({ modelHash: first.applied.modelHash, includeDefinition: true })).model)), expectedFirst);
});
