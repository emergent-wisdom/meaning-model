import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildModelingContext,
  buildModelingPrompt,
  expandTexInputs,
  conceptualReview,
  listModelingResources,
  modelingFreedom,
  modelingPurposes,
  modelingTheoryUris,
  readModelingResource,
  starterSelection,
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
  const paperFile = new URL('../../paper/meaning-model.tex', import.meta.url);
  assert.equal(meaning.text, await expandTexInputs(await readFile(paperFile, 'utf8'), paperFile));
  for (const include of ['interface-blocks', 'conceptual-decomposition', 'book-trajectory-figures']) {
    const body = await readFile(new URL(`../../paper/includes/${include}.tex`, import.meta.url), 'utf8');
    assert.ok(meaning.text.includes(body.replace(/\n$/, '')), `${include} is served inline`);
  }
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

test('every modeling purpose receives the application-choice guidance without bypassing theory access', async () => {
  for (const purpose of modelingPurposes) {
    const context = await buildModelingContext({ purpose, sessionMode: 'first_use' });
    assert.equal(context.modelingFreedom, modelingFreedom);
    assert.equal(context.starterSelection, starterSelection);
    assert.match(context.scaleReview, /Start macro to micro/);
    assert.match(context.scaleReview, /Understanding Nodes/);
    assert.match(context.scaleReview, /evidence cutoffs/);
    assert.equal(context.conceptualReview, conceptualReview);
    assert.equal(context.theoryAccessGate.satisfied, false);
    assert.ok(context.orderedResources.some(({ uri, required }) =>
      uri === 'life-sim://example/application-categories' && required === false));
    const prompt = await buildModelingPrompt({ purpose, sessionMode: 'first_use' });
    assert.ok(prompt.includes(modelingFreedom));
    assert.ok(prompt.includes(starterSelection));
    assert.ok(prompt.includes(context.scaleReview));
    assert.ok(prompt.includes(conceptualReview));
  }
});

test('application-category example is available as a complete MCP resource', async () => {
  const resource = await readModelingResource('life-sim://example/application-categories');
  assert.equal(resource.text, await readFile(new URL('../../docs/examples/APPLICATION-CATEGORIES.md', import.meta.url), 'utf8'));
  assert.ok(resource.text.includes('cargo run --manifest-path rust-engine/Cargo.toml --example category_revision'));
});

test('the guides reading mode makes the guides the entry and the papers a reference, and papers stays the default', async () => {
  const { buildModelingContext, buildModelingPrompt, readModelingResource, readingMode, servedText } = await import('../src/modeling-guidance.mjs');
  assert.equal(readingMode({}), 'papers');
  assert.equal(readingMode({ MEANING_MODEL_READING: 'guides' }), 'guides');
  const papers = await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use', reading: 'papers' });
  assert.equal(papers.paperFirst, true);
  assert.equal(papers.orderedResources.find((resource) => resource.uri === 'life-sim://theory/meaning-model').required, true);
  const guides = await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use', reading: 'guides' });
  assert.deepEqual([guides.paperFirst, guides.requiresFullTheoryRead, guides.theoryAccessGate.satisfied], [false, false, true]);
  assert.ok(guides.orderedResources.filter((resource) => resource.uri.startsWith('life-sim://theory/')).every((resource) => !resource.required));
  assert.ok(guides.orderedResources.find((resource) => resource.uri === 'life-sim://guide/general-modeling').required);
  const protocol = (await readModelingResource('life-sim://protocol/modeling', 'guides')).text;
  assert.doesNotMatch(protocol, /must read the complete current papers/);
  assert.match(protocol, /## Entry\n\nThe guides and this protocol carry the procedure; the papers carry the reasons\./);
  assert.match((await readModelingResource('life-sim://protocol/modeling', 'papers')).text, /## Paper-first entry contract/);
  assert.match(servedText('life-sim://addon/storytelling', 'Read the required Meaning Model and Life Simulation paper resources and common\nmodeling protocol before authoring a model.', 'guides'), /^Read the common modeling protocol before authoring a model/);
  assert.doesNotMatch(await buildModelingPrompt({ purpose: 'observation', sessionMode: 'first_use', reading: 'guides' }), /read the complete current papers/);
});

test('continuation is a session mode whose prompt starts with reading the construction record', async () => {
  // Found by the 2026-09-23 instruction test: an agent told to continue recorded work had no honest session mode.
  const { buildModelingContext, buildModelingPrompt, modelingSessionModes, continuationSteps } = await import('../src/modeling-guidance.mjs');
  assert.ok(modelingSessionModes.includes('continuation'));
  const context = await buildModelingContext({ purpose: 'observation', sessionMode: 'continuation', reading: 'papers' });
  assert.deepEqual(context.continuation.steps, continuationSteps);
  assert.equal(context.requiresFullTheoryRead, true, 'a fresh agent still reads the papers in the paper-first mode');
  assert.equal((await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use' })).continuation, undefined);
  const prompt = await buildModelingPrompt({ purpose: 'observation', sessionMode: 'continuation', reading: 'guides' });
  assert.match(prompt, /You are continuing recorded work\. Before any change:\n1\. Read life_construction_replay/);
  assert.ok(prompt.indexOf('life_construction_replay') < prompt.indexOf('life_modeling_context'), 'the record comes before the reading order');
  assert.match(prompt, /put every reason you give there into the graph/);
});
