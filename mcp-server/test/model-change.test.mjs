// A model revision sent as its change (found by the 2026-09-23 instruction test: three agents had to fetch,
// script and resend definitions of 170 to 321 KB to change a few records).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyModelChange, validateModelChange } from '../src/model-change.mjs';
import { LifeSimulationService } from '../src/service.mjs';

const previousHash = 'a'.repeat(64);
const base = () => ({ id: 'm', revision: { number: 3, previous_model_hash: 'b'.repeat(64), reason: 'r', provenance: ['p'] }, processes: [{ id: 'p1' }, { id: 'p2' }],
  meaning_model: { events: [{ id: 'e1', boundary: 'one' }, { id: 'e2', boundary: 'two' }], normalized_cuts: [{ id: 'c1', answers: [] }] } });

test('a change replaces records in place, appends new ones, removes by id and sets the next revision', () => {
  const { successor, summary } = applyModelChange(base(), previousHash, { reason: 'Describe e1 and add e3.',
    upsert: { events: [{ id: 'e1', boundary: 'one', description: 'What happens.' }, { id: 'e3', boundary: 'three' }] }, remove: { processes: ['p2'] } });
  assert.deepEqual(successor.meaning_model.events.map((event) => event.id), ['e1', 'e2', 'e3'], 'replaced in place, new ones appended');
  assert.equal(successor.meaning_model.events[0].description, 'What happens.');
  assert.deepEqual(successor.processes.map((process) => process.id), ['p1']);
  assert.deepEqual(successor.revision, { number: 4, previous_model_hash: previousHash, reason: 'Describe e1 and add e3.', provenance: ['life_model_revise change'] });
  assert.deepEqual(summary, { events: { added: 1, replaced: 1, removed: 0 }, processes: { added: 0, replaced: 0, removed: 1 } });
  assert.equal(base().meaning_model.events.length, 2, 'the predecessor is not changed');
});

test('a change is refused when it names unknown collections or records, repeats ids, or changes nothing', () => {
  assert.throws(() => validateModelChange({ reason: 'x', upsert: { widgets: [] } }), /Unknown model collection widgets/);
  assert.throws(() => validateModelChange({ reason: 'x' }), /upserts and removes nothing/);
  assert.throws(() => validateModelChange({ reason: 'x', upsert: { events: [{ id: 'e1' }, { id: 'e1' }] } }), /names e1 twice/);
  assert.throws(() => validateModelChange({ reason: 'x', upsert: { events: [{ id: 'e1' }] }, remove: { events: ['e1'] } }), /both upserted and removed/);
  assert.throws(() => validateModelChange({ reason: 'x', upsert: { events: [{ boundary: 'no id' }] } }), /needs a string id/);
  assert.throws(() => applyModelChange(base(), previousHash, { reason: 'x', remove: { events: ['nope'] } }), /no such record/);
  assert.throws(() => applyModelChange({ ...base(), meaning_model: undefined }, previousHash, { reason: 'x', upsert: { events: [{ id: 'e9' }] } }), /no meaning_model/);
});

test('the engine accepts a successor built from a change, including a withdrawn Cut', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel({ requestId: 'model', model: registerRequest.model });
  const { model: stored } = await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true });
  const cut = structuredClone(stored.meaning_model.normalized_cuts.find((item) => item.id === 'cut.ada.h06.attention'));
  cut.withdrawn = { reason: 'The split was a guess.' };
  const { successor } = applyModelChange(stored, registered.modelHash, { reason: 'Withdraw the attention split.', upsert: { normalized_cuts: [cut] } });
  const revised = await service.reviseModel({ requestId: 'revise-by-change', previousModelHash: registered.modelHash, model: successor });
  const { model: after } = await service.inspectModel({ modelHash: revised.modelHash, includeDefinition: true });
  assert.equal(after.revision.number, 1);
  assert.equal(after.meaning_model.normalized_cuts.find((item) => item.id === 'cut.ada.h06.attention').withdrawn.reason, 'The split was a guess.');
});
