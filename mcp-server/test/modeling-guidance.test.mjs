import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildModelingContext,
  buildModelingPrompt,
  listModelingResources,
  modelingTheoryUris,
  readModelingResource,
} from '../src/modeling-guidance.mjs';

test('modeling resources expose complete theory before operational profiles', async () => {
  const resources = listModelingResources();
  assert.deepEqual(
    resources.slice(0, 3).map(({ uri }) => uri),
    [
      'life-sim://theory/meaning-model',
      'life-sim://theory/life-simulation',
      'life-sim://protocol/modeling',
    ],
  );
  const meaning = await readModelingResource('life-sim://theory/meaning-model');
  const life = await readModelingResource('life-sim://theory/life-simulation');
  const protocol = await readModelingResource('life-sim://protocol/modeling');
  const narrativeGraph = await readModelingResource(
    'life-sim://protocol/narrative-understanding-graph',
  );
  assert.equal(
    meaning.title,
    'The Meaning Model: Constructing Worlds and Stories at Progressive Resolution',
  );
  assert.match(meaning.text, /Constructing Worlds and Stories at Progressive Resolution/);
  assert.equal(
    meaning.text,
    await readFile(new URL('../../paper/meaning-model.tex', import.meta.url), 'utf8'),
  );
  assert.equal(
    life.text,
    await readFile(new URL('../../docs/companions/life-simulation/life-simulation.tex', import.meta.url), 'utf8'),
  );
  assert.match(life.text, /Learning from Worlds and Their Construction/);
  assert.match(protocol.text, /Paper-first entry contract/);
  assert.match(narrativeGraph.text, /additive atomic batches/);
  assert.match(meaning.sha256, /^[a-f0-9]{64}$/);
  assert.match(life.sha256, /^[a-f0-9]{64}$/);
});

test('first-use context requires both complete papers and never claims comprehension', async () => {
  const context = await buildModelingContext({
    purpose: 'person_reflection',
    sessionMode: 'first_use',
  });
  assert.equal(context.paperFirst, true);
  assert.equal(context.requiresFullTheoryRead, true);
  assert.equal(context.theoryAccessGate.satisfied, false);
  assert.deepEqual(
    context.orderedResources.slice(0, 3).map(({ uri, required }) => ({ uri, required })),
    [
      { uri: 'life-sim://theory/meaning-model', required: true },
      { uri: 'life-sim://theory/life-simulation', required: true },
      { uri: 'life-sim://protocol/modeling', required: true },
    ],
  );
  assert.ok(context.orderedResources.some(({ uri }) => uri === 'life-sim://profile/person'));
  assert.ok(context.orderedResources.some(
    ({ uri, required }) =>
      uri === 'life-sim://protocol/narrative-understanding-graph' && required === false,
  ));
  assert.deepEqual(context.personalModelViews, [
    'external event history',
    'alternative AI-inferred actor-local models',
    "the person's reported self-model",
  ]);
  assert.match(context.comprehensionBoundary, /not that an agent understood/);
  assert.match(context.valueAndFunctionSupport.rule, /does not require/);
});

test('repeat context reuses only live-process access to both papers', async () => {
  const repeat = await buildModelingContext({
    purpose: 'creative_story',
    sessionMode: 'repeat_same_domain',
    readTheoryUris: modelingTheoryUris,
  });
  assert.equal(repeat.theoryAccessGate.satisfied, true);
  assert.equal(repeat.requiresFullTheoryRead, false);
  assert.equal(repeat.orderedResources[0].required, false);
  assert.equal(repeat.orderedResources[1].required, false);

  const incomplete = await buildModelingContext({
    purpose: 'creative_story',
    sessionMode: 'repeat_same_domain',
    readTheoryUris: [modelingTheoryUris[0]],
  });
  assert.equal(incomplete.theoryAccessGate.satisfied, false);
  assert.equal(incomplete.requiresFullTheoryRead, true);

  for (const sessionMode of ['new_domain', 'consequential']) {
    const context = await buildModelingContext({
      purpose: 'person_reflection',
      sessionMode,
      readTheoryUris: modelingTheoryUris,
    });
    assert.equal(context.theoryAccessGate.satisfied, true);
    assert.equal(context.requiresFullTheoryRead, true);
  }
});

test('starter prompt directs the agent to theory before protocol execution', async () => {
  const prompt = await buildModelingPrompt({
    purpose: 'source_reconstruction',
    sessionMode: 'first_use',
  });
  assert.match(prompt, /Do not treat the short protocol as a substitute for the theory/);
  assert.ok(
    prompt.indexOf('life-sim://theory/meaning-model') <
      prompt.indexOf('life-sim://protocol/modeling'),
  );
});
