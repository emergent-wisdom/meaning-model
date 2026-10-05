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
  modelingSessionModes,
  modelingTheoryUris,
  readingMode,
  readModelingResource,
  readModelingResourcePage,
  servedText,
  starterSelection,
} from '../src/modeling-guidance.mjs';
import { constructionRecordInstructions } from '../src/construction-principles.mjs';
import { controlledReadbackInstructions } from '../src/readback-guidance.mjs';
import { humanAuthorFeedbackInstructions, memoryWorkflowInstructions, methodCoreInstructions, purposeMethod } from '../src/workflow-guidance.mjs';

test('memory and human feedback route through the same construction method with distinct authority', async () => {
  for (const [purpose, workflow, uri, instructions] of [
    ['agent_memory', 'memory', 'life-sim://guide/memory', memoryWorkflowInstructions],
    ['user_memory', 'memory', 'life-sim://guide/memory', memoryWorkflowInstructions],
    ['human_author_feedback', 'human_author_feedback', 'life-sim://guide/human-author-feedback', humanAuthorFeedbackInstructions],
  ]) {
    const context = await buildModelingContext({ purpose, sessionMode: 'continuation', reading: 'guides' });
    assert.equal(context.workflow, workflow);
    assert.equal(context.purposeInstructions, instructions);
    assert.equal(context.constructionRecord, constructionRecordInstructions);
    assert.match(context.scaleReview, /Start macro to micro/);
    assert.ok(context.orderedResources.some((entry) => entry.uri === uri && entry.required));
    assert.ok((await readModelingResource(uri)).text.length > 0);
    assert.ok(!context.orderedResources.some((entry) => entry.uri === 'life-sim://profile/story'), 'no autonomous authoring profile for feedback or memory');
    const prompt = await buildModelingPrompt({ purpose, sessionMode: 'continuation', reading: 'guides' });
    assert.ok(prompt.includes(constructionRecordInstructions));
    assert.ok(prompt.indexOf(instructions) > prompt.indexOf(constructionRecordInstructions), 'scope qualifies the common construction method');
  }
  assert.match(memoryWorkflowInstructions, /not only a list of saved facts/);
  assert.match(memoryWorkflowInstructions, /without asking approval for each entry/);
  assert.match(memoryWorkflowInstructions, /ordinary model revision tools/);
  assert.match(humanAuthorFeedbackInstructions, /human writes and directs/);
  assert.match(humanAuthorFeedbackInstructions, /Do not rewrite passages/);
});

test('modeling resources lead with what the tool is for, then the complete grammar, and preserve optional papers', async () => {
  const resources = listModelingResources();
  assert.equal(resources[0].uri, 'life-sim://guide/start-here');
  assert.equal(resources[1].uri, 'life-sim://protocol/grammar');
  assert.deepEqual(
    resources.slice(-2).map(({ uri }) => uri), modelingTheoryUris,
  );
  const meaning = await readModelingResource('life-sim://theory/meaning-model');
  const life = await readModelingResource('life-sim://theory/life-simulation');
  const protocol = await readModelingResource('life-sim://protocol/modeling');
  const grammarFile = new URL('../../paper/meaning-model-grammar.tex', import.meta.url);
  const grammar = await readModelingResource('life-sim://protocol/grammar');
  assert.equal(grammar.text, await expandTexInputs(await readFile(grammarFile, 'utf8'), grammarFile));
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
  assert.equal(protocol.text, await readFile(new URL('../../docs/MODELING_PROTOCOL.md', import.meta.url), 'utf8'));
  assert.doesNotMatch(protocol.text, /must read the complete current papers|Paper-first entry contract/);
  assert.match(narrativeGraph.text, /additive atomic batches/);
  assert.match(meaning.sha256, /^[a-f0-9]{64}$/);
  assert.match(life.sha256, /^[a-f0-9]{64}$/);
});

test('tool-only resource pages reconstruct the complete grammar and reject stale or invalid ranges', async () => {
  const uri = 'life-sim://protocol/grammar';
  const resource = await readModelingResource(uri);
  let offset = 0; let joined = ''; let pages = 0;
  do {
    const page = await readModelingResourcePage({ uri, offset, maxCharacters: 7_777, expectedSha256: resource.sha256 });
    joined += page.text; pages += 1;
    assert.equal(page.readingVerified, false);
    assert.equal(page.bytes, Buffer.byteLength(resource.text));
    assert.equal(page.totalCharacters, resource.text.length);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.ok(pages > 1);
  assert.equal(joined, resource.text);
  await assert.rejects(readModelingResourcePage({ uri, expectedSha256: '0'.repeat(64) }), /resource changed/);
  await assert.rejects(readModelingResourcePage({ uri, offset: resource.text.length + 1 }), /past the end/);
  await assert.rejects(readModelingResourcePage({ uri, maxCharacters: 0 }), /Invalid resource page/);
  await assert.rejects(readModelingResourcePage({ uri: 'file:///private-source' }), /Unknown modeling resource/);
});

test('first-use context requires the operational contract and purpose guide without claiming comprehension', async () => {
  const context = await buildModelingContext({
    purpose: 'person_reflection',
    sessionMode: 'first_use',
  });
  assert.equal(context.paperFirst, false);
  assert.equal(context.requiresFullTheoryRead, false);
  assert.equal(context.theoryAccessGate.satisfied, true);
  assert.equal(context.theoryAccessGate.enforced, false);
  assert.deepEqual(
    context.orderedResources.slice(0, 5).map(({ uri, required }) => ({ uri, required })),
    [
      { uri: 'life-sim://guide/start-here', required: true },
      { uri: 'life-sim://protocol/grammar', required: true },
      { uri: 'life-sim://protocol/modeling', required: true },
      { uri: 'life-sim://profile/person', required: true },
      { uri: 'life-sim://example/fearless-care', required: true },
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
  assert.match(context.comprehensionBoundary, /cannot verify comprehension/);
  assert.match(context.comprehensionBoundary, /exact bytes, not reading or understanding/);
  assert.match(context.valueAndFunctionSupport.rule, /does not require/);
});

test('every session mode keeps papers optional regardless of legacy reading or access arguments', async () => {
  for (const sessionMode of modelingSessionModes) {
    for (const readTheoryUris of [[], [modelingTheoryUris[0]], modelingTheoryUris]) {
      const context = await buildModelingContext({ purpose: 'person_reflection', sessionMode, reading: 'papers', readTheoryUris });
      assert.equal(context.readingMode, 'guides');
      assert.equal(context.paperFirst, false);
      assert.equal(context.requiresFullTheoryRead, false);
      assert.equal(context.theoryAccessGate.satisfied, true);
      assert.equal(context.theoryAccessGate.enforced, false);
      assert.deepEqual(context.theoryAccessGate.requiredUris, []);
      assert.deepEqual(context.theoryAccessGate.readUris, [], 'paper access is no longer tracked');
      assert.deepEqual(context.orderedResources.slice(-2).map(({ uri, required }) => ({ uri, required })),
        modelingTheoryUris.map((uri) => ({ uri, required: false })));
    }
  }
});

test('starter prompt puts operational guidance before optional paper references', async () => {
  const prompt = await buildModelingPrompt({
    purpose: 'source_reconstruction',
    sessionMode: 'first_use',
  });
  assert.match(prompt, /full research papers remain optional/);
  assert.ok(prompt.indexOf('life-sim://protocol/grammar') < prompt.indexOf('life-sim://protocol/modeling'));
  assert.ok(
    prompt.indexOf('life-sim://theory/meaning-model') >
      prompt.indexOf('life-sim://protocol/modeling'),
  );
  assert.match(prompt, /life-sim:\/\/theory\/meaning-model \(optional reference\)/);
});

test('every modeling purpose receives the common construction and application-choice guidance', async () => {
  for (const purpose of modelingPurposes) {
    const context = await buildModelingContext({ purpose, sessionMode: 'first_use' });
    assert.equal(context.modelingFreedom, modelingFreedom);
    assert.match(context.modelingFreedom, /Then loop again, and let whatever the model holds lead you down different paths/u, purpose);
    assert.match(context.modelingFreedom, /It is not a strict workflow: the steps come in any order/u, purpose);
    assert.equal(context.starterSelection, starterSelection);
    assert.match(context.scaleReview, /Start macro to micro/);
    assert.match(context.scaleReview, /Understanding Nodes/);
    assert.match(context.scaleReview, /evidence cutoffs/);
    assert.equal(context.conceptualReview, conceptualReview);
    assert.equal(context.theoryAccessGate.enforced, false);
    assert.equal(context.constructionRecord, constructionRecordInstructions);
    assert.equal(context.orderedResources[0].uri, 'life-sim://guide/start-here');
    assert.equal(context.orderedResources[1].uri, 'life-sim://protocol/grammar');
    assert.ok(context.orderedResources.slice(0, 2).every(({ required }) => required));
    assert.match(context.startHere, /You are an explorer, and the Meaning Model is your mind/u, purpose);
    assert.equal(Object.keys(context)[1], 'startHere', 'the point comes before any procedure');
    assert.match(context.constructionRecord, /^You are building an explicit world model from what you have learned:/, purpose);
    assert.match(context.constructionRecord, /Prior measurement is not a prerequisite for proposing these accounts/, purpose);
    assert.match(context.constructionRecord, /mark inference as inference/, purpose);
    assert.match(context.constructionRecord, /Use the resulting structures to discover further processes and concepts/, purpose);
    assert.match(context.constructionRecord, /does not replace evidence about that particular case/, purpose);
    assert.ok(context.orderedResources.some(({ uri, required }) =>
      uri === 'life-sim://example/application-categories' && required === false));
    const prompt = await buildModelingPrompt({ purpose, sessionMode: 'first_use' });
    assert.ok(prompt.includes(context.constructionRecord), `${purpose} delivers the world-model framing in its prompt`);
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

test('the Book method is served whole and supplements creative-story reading without replacing its required example', async () => {
  const uri = 'life-sim://example/book-of-conditions-modeling';
  const file = await readFile(new URL('../../docs/examples/BOOK-OF-CONDITIONS-MODELING.md', import.meta.url), 'utf8');
  for (const reading of ['papers', 'guides']) {
    const resource = await readModelingResource(uri, reading);
    assert.equal(resource.text, file);
    assert.equal(resource.category, 'example');
    assert.equal(listModelingResources(reading).filter((entry) => entry.uri === uri).length, 1);
    const context = await buildModelingContext({ purpose: 'creative_story', sessionMode: 'first_use', reading });
    const resources = context.orderedResources;
    const representation = resources.findIndex((entry) => entry.uri === 'life-sim://example/everest-meaning-model');
    assert.ok(representation >= 0);
    assert.equal(resources[representation].required, true);
    assert.equal(resources[representation + 1].uri, uri);
    assert.equal(resources[representation + 1].required, false);
    assert.deepEqual(context.theoryAccessGate.requiredUris, []);
    assert.equal(context.theoryAccessGate.enforced, false);
    assert.ok((await buildModelingPrompt({ purpose: 'creative_story', sessionMode: 'first_use', reading })).includes(uri));
  }
  for (const purpose of modelingPurposes.filter((purpose) => purpose !== 'creative_story')) {
    const context = await buildModelingContext({ purpose, sessionMode: 'first_use' });
    assert.ok(!context.orderedResources.some((entry) => entry.uri === uri), 'the Book profile is not imposed on other purposes');
  }
});

test('legacy reading settings cannot restore mandatory papers or rewrite canonical resource text', async () => {
  for (const setting of [undefined, 'guides', 'papers']) {
    assert.equal(readingMode({ MEANING_MODEL_READING: setting }), 'guides');
    const context = await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use', reading: setting });
    assert.equal(context.readingMode, 'guides');
    assert.deepEqual([context.paperFirst, context.requiresFullTheoryRead, context.theoryAccessGate.enforced], [false, false, false]);
    assert.ok(context.orderedResources.find((resource) => resource.uri === 'life-sim://guide/general-modeling').required);
    const protocol = await readModelingResource('life-sim://protocol/modeling', setting);
    assert.equal(protocol.text, await readFile(new URL('../../docs/MODELING_PROTOCOL.md', import.meta.url), 'utf8'));
    assert.doesNotMatch(protocol.text, /must read the complete current papers|Paper-first entry contract/);
    const arbitraryText = 'A canonical resource with no entry heading or special wording.';
    assert.equal(servedText('life-sim://protocol/modeling', arbitraryText, setting), arbitraryText);
    assert.equal(servedText('life-sim://addon/storytelling', arbitraryText, setting), arbitraryText);
    assert.doesNotMatch(await buildModelingPrompt({ purpose: 'observation', sessionMode: 'first_use', reading: setting }), /read the complete current papers/);
  }
});

test('continuation recovers missing history without repeating retained exact-head reading or plans', async () => {
  // Found by the 2026-09-23 instruction test: an agent told to continue recorded work had no honest session mode.
  const { buildModelingContext, buildModelingPrompt, modelingSessionModes, continuationSteps } = await import('../src/modeling-guidance.mjs');
  assert.ok(modelingSessionModes.includes('continuation'));
  const context = await buildModelingContext({ purpose: 'observation', sessionMode: 'continuation', reading: 'papers' });
  assert.deepEqual(context.continuation.steps, continuationSteps);
  assert.equal(context.requiresFullTheoryRead, false, 'continuation reads the construction record without requiring papers');
  assert.equal((await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use' })).continuation, undefined);
  const prompt = await buildModelingPrompt({ purpose: 'observation', sessionMode: 'continuation', reading: 'guides' });
  assert.match(prompt, /You are continuing recorded work\. Before any change:\n1\. Read life_construction_replay/);
  assert.ok(prompt.indexOf('life_construction_replay') < prompt.indexOf('life_modeling_context'), 'the record comes before the reading order');
  assert.match(prompt, /exact known graph head/);
  assert.match(prompt, /inspect only subsequent revisions and relevant records/);
  assert.match(prompt, /For unfamiliar history, lost context or an ambiguous branch, read from the start/);
  assert.match(prompt, /establish the intended head and lineage before acting/);
  assert.match(prompt, /Routine continuation needs no separate reading-plan or compliance record/);
  assert.match(prompt, /Where recording in the scoped project is available and delegated, preserve consequential findings/);
  assert.match(prompt, /Text-only feedback does not authorize creating a project/);
  assert.doesNotMatch(prompt, /put every reason you give there into the graph|put each thought into it as you have it/);
});

test('shared conversational guidance preserves discovery and applicable evaluation without routine review gates', async () => {
  for (const purpose of modelingPurposes) {
    const context = await buildModelingContext({ purpose, sessionMode: 'continuation' });
    assert.ok(context.constructionRecord.includes(controlledReadbackInstructions));
    assert.match(context.constructionRecord, /substantial communication deliverable/);
    assert.match(context.constructionRecord, /specific unresolved risk/);
    assert.match(context.constructionRecord, /An ordinary conversational reply, memory update or new piece of evidence is not by itself a milestone/);
    assert.match(context.constructionRecord, /Use separate fresh readers for the two conditions/);
    assert.match(context.constructionRecord, /Record the plan, fixed targets, exact material identifiers or hashes/);
    assert.match(context.constructionRecord, /Explore recursively from the question and the model/);
    assert.match(context.modelingFreedom, /Batch related findings and open questions/);
    assert.match(context.comprehensionBoundary, /not before every reply/);
    assert.ok(context.orderedResources.filter(({ required }) => required).every(({ reason }) => /reuse/i.test(reason)));
    assert.ok(context.minimumChecklist.some((item) => /apply checks only to the constructs and commitments present/.test(item)));
    assert.match(context.constructionRecord, /An Event interval states the extent of that Event, not a window/);
  }
});

test('every mode carries the method: categories first, series over time, open what matters, ask what changes mean', async () => {
  for (const purpose of modelingPurposes) {
    const context = await buildModelingContext({ purpose, sessionMode: 'first_use' });
    assert.equal(context.method.core, methodCoreInstructions);
    assert.ok(context.method.inThisMode && context.method.inThisMode === purposeMethod(purpose), `${purpose} has its own reading of the method`);
    const prompt = await buildModelingPrompt({ purpose, sessionMode: 'first_use' });
    assert.ok(prompt.includes(methodCoreInstructions) && prompt.includes(`In this mode: ${context.method.inThisMode}`), purpose);
    assert.ok(prompt.indexOf(methodCoreInstructions) < prompt.indexOf(constructionRecordInstructions), `${purpose}: the method comes before the procedure`);
  }
  assert.match(methodCoreInstructions, /mutually exclusive categories/);
  assert.match(methodCoreInstructions, /life_series_record/);
  assert.match(purposeMethod('person_reflection'), /do not invent their history/);
  assert.match(purposeMethod('source_reconstruction'), /tagged source or inferred/);
  assert.match(purposeMethod('forecasting'), /never revise it after the fact/);
  assert.match(purposeMethod('human_author_feedback'), /Do not invent the author's biography/);
});
