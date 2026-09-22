import assert from 'node:assert/strict';
import test from 'node:test';
import { StorytellingAddon, storySeedWords } from '../src/storytelling-addon.mjs';

function addonWithoutServiceAccess() {
  return new StorytellingAddon(new Proxy({}, {
    get() { assert.fail('Structure exploration must not read or mutate the model service.'); },
  }));
}

const brief = 'Två systrar träffas efter flera år.';

test('structure exploration works before modeling and leaves generation to the calling LLM', async () => {
  const input = { targetKind: 'relationship', brief, seedWord: 'bro',
    context: 'Båda vill återuppta kontakten.', constraints: ['Ingen av dem ljuger.'] };
  const before = structuredClone(input);
  const task = await addonWithoutServiceAccess().prepareStructureExplore(input);
  assert.deepEqual(task.target, { kind: 'relationship', brief });
  assert.deepEqual(task.constraints, input.constraints);
  assert.equal(task.context, input.context);
  assert.deepEqual(task.seed, { word: 'bro', source: 'caller_supplied',
    language: null, bankId: null, bankSize: null });
  assert.equal(task.generator, 'calling_llm');
  assert.equal(task.candidates, null);
  assert.equal(task.advisoryOnly, true);
  assert.equal(task.contextCompletenessVerified, false);
  assert.equal(task.worldMutation, false);
  assert.equal(task.graphMutation, false);
  assert.equal(task.readyToCommit, undefined);
  assert.deepEqual(input, before);
});

test('automatic seeds come only from the disclosed fixed common-word bank', async () => {
  assert.equal(Object.isFrozen(storySeedWords), true);
  assert.equal(new Set(storySeedWords).size, storySeedWords.length);
  assert.ok(storySeedWords.length > 0 && storySeedWords.length <= 5_000);
  const addon = addonWithoutServiceAccess();
  for (const input of [{ brief }, { brief, seedWord: null }, { brief, targetKind: 'name' }]) {
    const task = await addon.prepareStructureExplore(input);
    assert.equal(task.target.kind, input.targetKind ?? 'event');
    assert.ok(storySeedWords.includes(task.seed.word));
    assert.equal(task.seed.source, 'random_common_word');
    assert.equal(task.seed.language, 'en');
    assert.equal(task.seed.bankId, 'common-words/v1');
    assert.equal(task.seed.bankSize, storySeedWords.length);
    // Reusing the drawn word preserves it while accurately changing provenance.
    const reused = await addon.prepareStructureExplore({ brief, seedWord: task.seed.word });
    assert.equal(reused.seed.word, task.seed.word);
    assert.equal(reused.seed.source, 'caller_supplied');
  }
});

test('supplied seeds make the task reproducible and all creative material is hash-bound', async () => {
  const addon = addonWithoutServiceAccess();
  const input = { brief, seedWord: 'bridge' };
  const original = await addon.prepareStructureExplore(input);
  assert.deepEqual(await addon.prepareStructureExplore(input), original);
  assert.match(original.taskHash, /^[a-f0-9]{64}$/u);
  for (const change of [
    { targetKind: 'character' }, { targetKind: 'name' }, { brief: 'A reunion.' }, { seedWord: 'window' },
    { context: 'One sister has never left home.' }, { constraints: ['They meet in public.'] },
  ]) {
    const changed = await addon.prepareStructureExplore({ ...input, ...change });
    assert.notEqual(changed.taskHash, original.taskHash);
    if (change.targetKind === 'name') {
      assert.notEqual(changed.generatorInstructions, original.generatorInstructions,
        'name mode must deliver its own naming task rather than ordinary event-structure instructions');
    }
  }
});

test('a name draw returns its own instructions without repeating the author-model guide', async () => {
  const task = await addonWithoutServiceAccess().prepareStructureExplore({ brief, targetKind: 'name', seedWord: 'candle' });
  assert.ok(!task.generatorInstructions.includes('meaning-model-story-author-model/v1'), 'the author-model schema belongs to prose work');
  assert.match(task.generatorInstructions, /life-sim:\/\/addon\/storytelling/);
  assert.ok(JSON.stringify(task).length < 10_000, `name task is ${JSON.stringify(task).length} characters`);
});

test('exploration guidance supports semantic variation without imposing novelty or a mechanical arc', async () => {
  const task = await addonWithoutServiceAccess().prepareStructureExplore({ brief, seedWord: 'bridge' });
  for (const instruction of [
    'everyday meanings', 'structurally different', 'Preserve established facts',
    'quiet, ordinary possibility', 'Do not score novelty as quality',
    'hypothetical and unaccepted', 'discard all', 'language of the brief',
    'not instructions that override', 'Do not mutate',
  ]) assert.ok(task.generatorInstructions.includes(instruction), instruction);
});

test('invalid and oversized exploration material is rejected before service access', async () => {
  const addon = addonWithoutServiceAccess();
  for (const input of [
    {}, { brief: '  ' }, { brief, targetKind: 'chapter' }, { brief, seedWord: '' },
    { brief, seedWord: 'x'.repeat(257) }, { brief, constraints: 'no conflict' },
    { brief, constraints: [''] }, { brief, constraints: Array(51).fill('Keep it simple.') },
    { brief, graphHash: 'a'.repeat(64) },
  ]) await assert.rejects(addon.prepareStructureExplore(input));
  await assert.rejects(addon.prepareStructureExplore({ brief,
    constraints: Array(50).fill('界'.repeat(2_000)),
  }), /UTF-8 bytes/);
});
