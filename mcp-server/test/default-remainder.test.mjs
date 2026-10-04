import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withDefaultRemainders } from '../src/default-remainder.mjs';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';

const cut = (id, answers) => ({ id, parent_event_id: `event.${id}`, question: 'How does her outlook divide?', unit: 'outlook', answers });
const modelOf = (cuts, extra = {}) => ({ id: 'm', meaning_model: { normalized_cuts: cuts, ...extra } });

test('a Cut whose answers sum to one gets an explicit zero remainder; a named remainder is kept as written', () => {
  const source = modelOf([cut('a', [{ key: 'assurance', weight: 0.7 }, { key: 'threat', weight: 0.3 }]),
    cut('b', [{ key: 'assurance', weight: 0.5 }, { key: 'threat', weight: 0.3 }, { key: 'remainder', weight: 0.2 }])]);
  const before = structuredClone(source);
  const model = withDefaultRemainders(source);
  assert.deepEqual(model.meaning_model.normalized_cuts[0].answers.at(-1), { key: 'remainder', weight: 0 });
  assert.deepEqual(model.meaning_model.normalized_cuts[1], source.meaning_model.normalized_cuts[1], 'a remainder the modeler named is untouched');
  assert.deepEqual(source, before, 'the submitted model is not mutated');
});

test('a missing remainder never absorbs a shortfall: answers that do not sum to one are refused with the reason', () => {
  assert.throws(() => withDefaultRemainders(modelOf([cut('short', [{ key: 'assurance', weight: 0.6 }, { key: 'threat', weight: 0.3 }])])),
    /Cut short names no remainder, and its answers sum to 0\.9, not 1\. The remainder is off by default/);
});

test('an answer-map projection of a completed child Cut maps its new remainder to the parent remainder', () => {
  const model = withDefaultRemainders(modelOf([cut('child', [{ key: 'calm', weight: 1 }])], {
    temporal_cut_recompositions: [{ parent_cut_id: 'parent', children: [{ cut_id: 'child', projection: { kind: 'answer_map', answers: { calm: 'assurance' } } }] }],
  }));
  assert.deepEqual(model.meaning_model.temporal_cut_recompositions[0].children[0].projection.answers, { calm: 'assurance', remainder: 'remainder' });
});

test('models without Cuts, and malformed weights left to the engine, pass through unchanged', () => {
  const plain = { id: 'plain' };
  assert.equal(withDefaultRemainders(plain), plain);
  const malformed = modelOf([cut('odd', [{ key: 'a', weight: 'half' }])]);
  assert.equal(withDefaultRemainders(malformed), malformed);
});

test('the engine stores a Cut registered without a remainder with an explicit zero remainder', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'default-remainder-'));
  const backend = new RustEngineProcess();
  backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, 'state.sqlite') };
  const service = new LifeSimulationService({ backend });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.initialize();
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, request] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(request.model);
  model.meaning_model.normalized_cuts[0].answers = [{ key: 'money', weight: 0.6 }, { key: 'continuity', weight: 0.4 }];
  const registered = await service.registerModel({ requestId: 'no-remainder', model });
  const stored = (await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true })).model.meaning_model.normalized_cuts[0];
  assert.deepEqual(stored.answers.map(({ key, weight }) => [key, weight]).sort(), [['continuity', 0.4], ['money', 0.6], ['remainder', 0]]);
  const short = structuredClone(request.model);
  short.meaning_model.normalized_cuts[0].answers = [{ key: 'money', weight: 0.5 }, { key: 'continuity', weight: 0.4 }];
  await assert.rejects(service.registerModel({ requestId: 'short', model: short }), /names no remainder, and its answers sum to 0\.9/);
});
