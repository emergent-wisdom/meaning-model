import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { lifeConnections, lifeTrendsDossier } from './storytelling-life-fixture.mjs';
import { authorApplication, fictionalAuthorModel } from './storytelling-author-model-fixture.mjs';
import { recordWorldProcess } from './world-process-fixture.mjs';

// The add-on's loop over MCP: the same records the fixture writes through the add-on, through its tools.
const overMcp = (client) => ({
  storeAuthorRecord: (args) => call(client, 'life_story_author_record', args),
  recordWorld: (args) => call(client, 'life_story_world_record', args),
  direct: (args) => call(client, 'life_story_direct', args),
});

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'src', 'server.ts');
const storytellingTools = [
  'life_story_author_record',
  'life_story_deepen',
  'life_story_direct',
  'life_story_life_trends',
  'life_story_model_depth_record',
  'life_story_model_depth_review',
  'life_story_purpose_review',
  'life_story_release',
  'life_story_scene_commit',
  'life_story_scene_prepare',
  'life_story_scene_review',
  'life_story_structure_explore',
  'life_story_trajectory_explore',
  'life_story_trajectory_revise',
  'life_story_world_record',
];
const storytellingPrompts = [
  'life_story_deepen',
  'life_story_purpose_review',
  'life_story_scene_start',
  'life_story_structure_explore',
];

async function connectClient(t, enabled) {
  const client = new Client({ name: 'storytelling-addon-protocol-test', version: '0.1.0' });
  const env = { ...process.env };
  // Explicitly exercise both configurations even if the developer enables the add-on locally.
  delete env.MEANING_MODEL_ADDONS;
  if (enabled) env.MEANING_MODEL_ADDONS = 'storytelling';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env,
  });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
  assert.ok(result.structuredContent, `${name} must provide structured content`);
  return result.structuredContent;
}

function genericModels() {
  const provenance = ['storytelling add-on domain-invariance protocol test'];
  const process = (id, value, minimum, maximum, unit) => ({
    id,
    value_type: { kind: 'scalar', bounds: { minimum, maximum } },
    initial_value: { kind: 'scalar', value },
    uncertainty: { kind: 'exact' },
    unit,
    provenance,
    support: ['system'],
    access_scopes: ['public'],
  });
  return [{
    model: {
      schema: 'life-sim-rust-model/v1',
      id: 'company-cash-flow-process',
      time_unit: 'year',
      revision: { number: 0, reason: 'Illustrative declared business-process laws.', provenance },
      processes: [
        process('company.cash_flow', 100, 0, 1_000, 'currency-per-year'),
        process('company.indicative_value', 1_000, 0, 10_000, 'currency'),
      ],
      decomposition: [],
      dependencies: [{
        id: 'cash-flow-drives-value',
        source: 'company.cash_flow',
        target: 'company.indicative_value',
        kind: 'derives',
        law_id: 'illustrative-value-multiple',
      }],
      laws: [{
        id: 'cash-flow-growth',
        operator: {
          role: 'evolution',
          target: 'company.cash_flow',
          derivative: { op: 'constant', value: 10 },
        },
        provenance,
      }, {
        id: 'illustrative-value-multiple',
        operator: {
          role: 'relation',
          target: 'company.indicative_value',
          value: {
            op: 'multiply',
            factors: [
              { op: 'constant', value: 10 },
              { op: 'process', process: 'company.cash_flow' },
            ],
          },
        },
        provenance,
      }],
      initial_claims: [],
    },
    expectedState: {
      'company.cash_flow': { kind: 'scalar', value: 120 },
      'company.indicative_value': { kind: 'scalar', value: 1_200 },
    },
  }, {
    model: {
      schema: 'life-sim-rust-model/v1',
      id: 'physical-cooling-process',
      time_unit: 'hour',
      revision: { number: 0, reason: 'Bounded constant-rate physical cooling.', provenance },
      processes: [process('vessel.temperature', 80, -100, 200, 'celsius')],
      decomposition: [],
      dependencies: [],
      laws: [{
        id: 'constant-cooling',
        operator: {
          role: 'evolution',
          target: 'vessel.temperature',
          derivative: { op: 'constant', value: -2 },
        },
        provenance,
      }],
      initial_claims: [],
    },
    expectedState: {
      'vessel.temperature': { kind: 'scalar', value: 76 },
    },
  }];
}

async function simulateGenericModel(client, { model, expectedState }) {
  const registered = await call(client, 'life_model_register', {
    requestId: `${model.id}-register`,
    model,
  });
  const inspected = await call(client, 'life_model_inspect', {
    modelHash: registered.modelHash,
    includeDefinition: true,
  });
  const world = await call(client, 'life_world_create', {
    requestId: `${model.id}-create`,
    modelHash: registered.modelHash,
  });
  const requestedObservables = model.processes.map(({ id }) => id);
  const candidate = await call(client, 'life_candidate_roll', {
    worldId: world.worldId,
    requestId: `${model.id}-roll`,
    query: {
      schema: 'life-sim-rust-model-query/v1',
      delta_time: 2,
      step_size: 0.5,
      seed: 'domain-invariance',
      requested_observables: requestedObservables,
      access_scopes: ['public'],
      path: { mode: 'full' },
    },
  });
  assert.equal(candidate.canonical, false);
  const accepted = await call(client, 'life_candidate_accept', {
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    requestId: `${model.id}-accept`,
    expectedParentHash: world.headHash,
  });
  assert.equal(accepted.time, 2);
  const view = await call(client, 'life_view_query', {
    worldId: world.worldId,
    requestedObservables,
    accessScopes: ['public'],
    includePath: true,
  });
  assert.equal(view.projection.version, 1);
  assert.equal(view.projection.time, 2);
  assert.deepEqual(view.projection.state, expectedState);
  const meaning = await call(client, 'life_meaning_query', { modelHash: registered.modelHash });
  assert.equal(meaning.meaningModel.enabled, false);
  assert.deepEqual(meaning.items, []);
  return {
    modelHash: registered.modelHash,
    model: inspected.model,
    state: view.projection.state,
    time: view.projection.time,
    version: view.projection.version,
  };
}

test('storytelling opt-in adds only its tools, resource, and prompts to the live MCP surface', async (t) => {
  const base = await connectClient(t, false);
  const enabled = await connectClient(t, true);
  const [baseTools, enabledTools, baseResources, enabledResources, basePrompts, enabledPrompts] =
    await Promise.all([
      base.listTools(), enabled.listTools(),
      base.listResources(), enabled.listResources(),
      base.listPrompts(), enabled.listPrompts(),
    ]);
  const baseToolNames = new Set(baseTools.tools.map(({ name }) => name));
  assert.deepEqual(
    enabledTools.tools.filter(({ name }) => !baseToolNames.has(name)).map(({ name }) => name).sort(),
    storytellingTools,
  );
  assert.deepEqual(
    enabledTools.tools.filter(({ name }) => !storytellingTools.includes(name)),
    baseTools.tools,
    'all existing tool definitions remain unchanged',
  );
  const explorer = enabledTools.tools.find(({ name }) => name === 'life_story_structure_explore');
  assert.equal(explorer.annotations.readOnlyHint, true);
  assert.equal(explorer.annotations.idempotentHint, false,
    'an omitted seed draws a new word, so the tool must not promise identical results');
  const lifeTrends = enabledTools.tools.find(({ name }) => name === 'life_story_life_trends');
  assert.equal(lifeTrends.annotations.readOnlyHint, false);
  assert.match(lifeTrends.description, /calling LLM.*automatically/iu);
  const prepareTool = enabledTools.tools.find(({ name }) => name === 'life_story_scene_prepare');
  assert.ok(prepareTool.inputSchema.required.includes('lifeTrendsNodeId'));
  assert.match(prepareTool.description, /life.trend|life_story_life_trends/iu);
  const addonUri = 'life-sim://addon/storytelling';
  assert.ok(!baseResources.resources.some(({ uri }) => uri === addonUri));
  assert.deepEqual(
    enabledResources.resources.filter(({ uri }) => uri !== addonUri),
    baseResources.resources,
  );
  assert.equal(enabledResources.resources.filter(({ uri }) => uri === addonUri).length, 1);
  const addonResource = await enabled.readResource({ uri: addonUri });
  assert.ok(addonResource.contents[0].text.length > 0);
  const basePromptNames = new Set(basePrompts.prompts.map(({ name }) => name));
  assert.deepEqual(
    enabledPrompts.prompts.filter(({ name }) => !basePromptNames.has(name)).map(({ name }) => name).sort(),
    storytellingPrompts,
  );
  assert.deepEqual(
    enabledPrompts.prompts.filter(({ name }) => !storytellingPrompts.includes(name)),
    basePrompts.prompts,
  );
  const startPrompt = await enabled.getPrompt({ name: 'life_story_scene_start', arguments: {} });
  const startText = startPrompt.messages.map(({ content }) => content.text ?? '').join('\n');
  assert.match(startText, /life_story_life_trends/u);
  assert.match(startText, /automatically|without (?:waiting|asking)|must/iu,
    'the normal starting workflow must make the calling LLM perform the life modeling');
  assert.match(startText, /overall life|whole.life|longitudinal/iu);
  assert.match(startText, /not a form for the user|do not ask the user/iu,
    'routine lifetime modeling is the LLM’s job, not a newly required user form');
  const preamble = "Respect the human author's starting brief and chosen involvement.";
  const count = (text) => text.split(preamble).length - 1;
  assert.ok(count(startText) <= 1, `the start prompt repeats the intake preamble ${count(startText)} times`);
  for (const tool of enabledTools.tools.filter(({ name }) => name.startsWith('life_story_'))) {
    assert.ok(count(tool.description) <= 1, `${tool.name} repeats the intake preamble`);
    assert.ok(!tool.description.startsWith(preamble), `${tool.name} should lead with what it does, not the shared preamble`);
  }
});

test('storytelling structure exploration works before modeling and transports prompt constraints as data', async (t) => {
  const client = await connectClient(t, true);
  const input = {
    targetKind: 'relationship',
    brief: 'Explore the friendship between two siblings who share an inherited workshop.',
    context: 'They have already agreed never to sell the workshop.',
    constraints: ['Keep the agreement intact.', 'Förslagen får lämna konflikten olöst.'],
    seedWord: 'tidvatten',
  };
  const task = await call(client, 'life_story_structure_explore', input);
  assert.equal(task.schema, 'meaning-model-story-structure-task/v1');
  assert.deepEqual(task.target, { kind: input.targetKind, brief: input.brief });
  assert.equal(task.context, input.context);
  assert.deepEqual(task.constraints, input.constraints);
  assert.deepEqual(task.seed, {
    word: input.seedWord,
    source: 'caller_supplied',
    language: null,
    bankId: null,
    bankSize: null,
  });
  assert.equal(task.generator, 'calling_llm');
  assert.equal(task.candidates, null, 'the server prepares inspiration without fabricating LLM proposals');
  assert.equal(task.advisoryOnly, true);
  assert.equal(task.worldMutation, false);
  assert.equal(task.graphMutation, false);
  assert.match(task.taskHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await call(client, 'life_story_structure_explore', input), task,
    'the same supplied seed and constraints bind the same exploration task');

  const randomTask = await call(client, 'life_story_structure_explore', { brief: input.brief });
  assert.deepEqual(randomTask.target, { kind: 'event', brief: input.brief });
  assert.equal(randomTask.context, '');
  assert.deepEqual(randomTask.constraints, []);
  assert.equal(randomTask.seed.source, 'random_common_word');
  assert.equal(randomTask.seed.language, 'en');
  assert.equal(randomTask.seed.bankId, 'common-words/v1');
  assert.equal(typeof randomTask.seed.word, 'string');
  assert.ok(randomTask.seed.word.length > 0);
  assert.ok(Number.isSafeInteger(randomTask.seed.bankSize) && randomTask.seed.bankSize > 0);
  assert.equal(randomTask.candidates, null);
  assert.match(randomTask.generatorInstructions, /automatically.*overall life trends/iu,
    'seed inspiration also routes the LLM back through mandatory lifetime modeling');

  const prompt = await client.getPrompt({
    name: 'life_story_structure_explore',
    arguments: { ...input, constraints: JSON.stringify(input.constraints) },
  });
  const promptText = prompt.messages.map(({ content }) => content.text ?? '').join('\n');
  const promptMaterial = JSON.parse(promptText.split('Exploration material (data):\n')[1]);
  assert.deepEqual(promptMaterial, {
    target: task.target,
    context: task.context,
    constraints: task.constraints,
    seed: task.seed,
    taskHash: task.taskHash,
  }, 'prompt and tool preserve and bind the same typed exploration material');
  for (const constraints of ['not-json', '"one constraint"', '[4]']) {
    await assert.rejects(client.getPrompt({
      name: 'life_story_structure_explore', arguments: { brief: input.brief, constraints },
    }), undefined, 'the prompt rejects malformed constraint JSON rather than treating it as prose');
  }
  const malformedTool = await client.callTool({
    name: 'life_story_structure_explore', arguments: { ...input, constraints: 'one constraint' },
  });
  assert.equal(malformedTool.isError, true, 'the tool requires a typed constraint array');

  const nameInput = { targetKind: 'name', brief: 'Name a new pilot in a restrained Swedish science-fiction story.',
    context: 'Existing names: Ivo, Mara. Plain and pronounceable naming style.',
    constraints: ['Avoid confusing similarity to the existing cast.'] };
  const naming = await call(client, 'life_story_structure_explore', nameInput);
  assert.equal(naming.target.kind, 'name');
  assert.equal(naming.context, nameInput.context);
  assert.deepEqual(naming.constraints, nameInput.constraints);
  assert.equal(naming.seed.source, 'random_common_word');
  assert.equal(naming.candidates, null);
  const namePrompt = await client.getPrompt({ name: 'life_story_structure_explore',
    arguments: { ...nameInput, constraints: JSON.stringify(nameInput.constraints), seedWord: naming.seed.word } });
  const namePromptText = namePrompt.messages.map(({ content }) => content.text ?? '').join('\n');
  const nameMaterial = JSON.parse(namePromptText.split('Exploration material (data):\n')[1]);
  assert.equal(nameMaterial.target.kind, 'name');
  assert.equal(nameMaterial.context, nameInput.context);
  assert.deepEqual(nameMaterial.constraints, nameInput.constraints);
  assert.equal(nameMaterial.seed.word, naming.seed.word);
  assert.ok(namePromptText.startsWith(naming.generatorInstructions),
    'tool and prompt must deliver the same naming-specific instructions');
});

test('storytelling opt-in preserves business and physical models and their canonical Rust results', async (t) => {
  const base = await connectClient(t, false);
  const enabled = await connectClient(t, true);
  for (const fixture of genericModels()) {
    const baseResult = await simulateGenericModel(base, fixture);
    const enabledResult = await simulateGenericModel(enabled, fixture);
    assert.deepEqual(enabledResult, baseResult, fixture.model.id);
  }
});

test('storytelling scene round-trip appends reviewed prose through Rust without changing its source world', async (t) => {
  const client = await connectClient(t, true);
  const { model } = genericModels()[1];
  model.processes[0].access_scopes = [];
  model.meaning_model = {
    schema: 'life-sim-rust-meaning-model/v1',
    concepts: [],
    referents: [{
      id: 'mira', boundary: 'Mira, the technician who reads the gauge.',
      continuity_criterion: 'The same person throughout her modeled life.',
      provenance: ['storytelling scene protocol test'],
    }, {
      id: 'author', boundary: 'The invented archivist who writes the story.',
      continuity_criterion: 'The same person.', provenance: ['storytelling scene protocol test'],
    }],
    events: [{ id: 'ev.gauge', boundary: 'Mira reads the gauge.', description: 'Mira reads the vessel temperature gauge at the start of her shift.',
      interval: { start: 0, end: 1 }, process_ids: [], observation_process_ids: [], participants: { subject: 'mira' }, substrate: null, region: null,
      provenance: ['storytelling scene protocol test'] }],
    event_referent_bindings: [],
  };
  const registeredModel = await call(client, 'life_model_register', {
    requestId: 'scene-model-register', model,
  });
  const world = await call(client, 'life_world_create', {
    requestId: 'scene-world-create', modelHash: registeredModel.modelHash,
  });
  const provenance = ['storytelling scene protocol test'];
  const registeredGraph = await call(client, 'life_narrative_register', {
    requestId: 'scene-graph-register',
    narrativeGraph: {
      schema: 'life-sim-rust-narrative-graph/v1',
      id: 'scene-round-trip',
      revision: { number: 0, reason: 'A story grounded in the physical model.', provenance },
      source: { kind: 'world', world_id: world.worldId, world_hash: world.headHash },
      roots: ['document'],
      nodes: [{
        id: 'document', node_type: 'story', role: 'document_root',
        epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon',
        access_scopes: ['editor', 'book-only'],
        provenance,
      }, {
        id: 'canon.temperature', node_type: 'fact', role: 'metadata',
        text: 'The vessel temperature is eighty degrees.',
        epistemic_status: 'fictional_canon', evidence_type: 'fictional_canon',
        authority: { source: 'protocol-author', weight: 1 },
        access_scopes: ['editor', 'source-only'],
        evidence_cutoff: 0, render: 'exclude', training: 'exclude', provenance,
      }],
      edges: [{
        id: 'document-canon',
        source: { kind: 'node', node_id: 'document' },
        target: { kind: 'node', node_id: 'canon.temperature' },
        family: 'structural', relation: 'contains', order: 0, provenance,
        access_scopes: ['editor'],
      }, {
        id: 'canon-temperature-process',
        source: { kind: 'node', node_id: 'canon.temperature' },
        target: { kind: 'anchor', anchor_kind: 'process', anchor_id: 'vessel.temperature' },
        family: 'grounding', relation: 'grounded_in', provenance,
        access_scopes: ['editor'],
      }],
    },
  });
  const readGraph = (hash, accessScopes = ['editor']) => call(client, 'life_narrative_query', {
    graphHash: hash, mode: 'full', includeContent: true, accessScopes,
  });
  const originalWorld = await call(client, 'life_world_inspect', { worldId: world.worldId });
  const unknownCharacter = await client.callTool({
    name: 'life_story_life_trends', arguments: {
      graphHash: registeredGraph.graphHash, requestId: 'unknown-character-life',
      nodeId: 'life.unknown', accessScopes: ['editor'],
      dossier: lifeTrendsDossier('document', 'unmodeled-character'),
    },
  });
  assert.equal(unknownCharacter.isError, true, 'Rust rejects a dossier disconnected from modeled character identity');
  const lifeInput = {
    graphHash: registeredGraph.graphHash, requestId: 'mira-life', nodeId: 'life.mira',
    accessScopes: ['editor', 'book-only', 'source-only', 'irrelevant'],
    dossier: lifeTrendsDossier('document', 'mira'),
  };
  const storedLife = await call(client, 'life_story_life_trends', lifeInput);
  assert.equal(storedLife.worldMutation, false);
  assert.notEqual(storedLife.graphHash, registeredGraph.graphHash);
  assert.deepEqual(await call(client, 'life_story_life_trends', lifeInput), storedLife,
    'a retried dossier write returns the same graph receipt');
  // A later dossier supersedes the earlier one, as other records do (a branch off this head, not used below).
  const secondLife = await call(client, 'life_story_life_trends', { ...lifeInput, graphHash: storedLife.graphHash, requestId: 'mira-life-v2', nodeId: 'life.mira.v2',
    links: [{ relation: 'supersedes', targetNodeId: 'life.mira' }] });
  const secondGraph = await readGraph(secondLife.graphHash);
  assert.ok(secondGraph.edges.some((edge) => edge.relation === 'supersedes' && edge.source.node_id === 'life.mira.v2' && edge.target.node_id === 'life.mira'));
  const authorProfileInput = {
    graphHash: storedLife.graphHash, requestId: 'save-author-model', nodeId: 'author.model',
    storyRootId: 'document', authorId: 'protocol-recorder', accessScopes: ['editor'],
    kind: 'author_model', text: 'An invented author perspective for this story, kept distinct from the narrator and Mira.',
    data: fictionalAuthorModel(),
  };
  const authorProfile = await call(client, 'life_story_author_record', authorProfileInput);
  assert.deepEqual(await call(client, 'life_story_author_record', authorProfileInput), authorProfile);
  const authorGraph = await readGraph(authorProfile.graphHash);
  const authorModelNode = authorGraph.nodes.find(({ id }) => id === 'author.model');
  assert.equal(authorModelNode.holder, 'protocol-recorder');
  assert.equal(JSON.parse(authorModelNode.text).data.modeledAuthorId, 'imagined-author',
    'the modeled author is distinct from the record’s recorder identity');
  assert.equal(authorModelNode.render, 'exclude');
  assert.equal(authorModelNode.training, 'exclude');
  const worldHash = await recordWorldProcess(overMcp(client), { graphHash: authorProfile.graphHash, storyRootId: 'document', accessScopes: ['editor'],
    lifeModelHash: registeredModel.modelHash, routeEventId: 'ev.gauge' });
  const focus = await call(client, 'life_story_author_record', {
    graphHash: worldHash, requestId: 'save-focus', nodeId: 'story.plan',
    storyRootId: 'document', authorId: 'protocol-author', accessScopes: ['editor'], kind: 'context',
    text: 'Mira quietly checks a vessel gauge at the initial instant. The eighty-degree reading continues her practiced attention; this scene makes no claim about later cooling or an institutional decision.',
  });
  const depthPreparation = { graphHash: focus.graphHash, storyRootId: 'document', lifeTrendsNodeId: 'life.mira',
    focusNodeId: 'story.plan', contextNodeIds: ['canon.temperature'], accessScopes: ['editor'] };
  const depthTask = await call(client, 'life_story_model_depth_review', depthPreparation);
  assert.equal(depthTask.modelHash, registeredModel.modelHash);
  assert.equal(depthTask.model.definition.processes[0].initial_value.value, 80);
  assert.equal(depthTask.assessment, null);
  const depthInput = { preparation: depthPreparation, expectedTaskHash: depthTask.taskHash,
    requestId: 'record-depth', nodeId: 'depth.gauge', reviewer: 'protocol-author-self-review',
    coverage: 'Reviewed the quiet reading, the numeric physical value, and its continuity with Mira’s life. No institutional mechanism or further decomposition is needed for this limited scene.',
    findings: [{ subject: 'Physical reading and practiced checking', status: 'sufficient',
      explanation: 'The actual model defines the initial temperature in Celsius; the context and lifetime account explain this unchanged reading and habitual check.',
      evidence: [{ kind: 'model', path: '/processes/0' }, { kind: 'node', nodeId: 'canon.temperature' }, { kind: 'node', nodeId: 'life.mira' }] }],
  };
  const depthReceipt = await call(client, 'life_story_model_depth_record', depthInput);
  assert.equal(depthReceipt.readyForScene, true);
  assert.deepEqual(await call(client, 'life_story_model_depth_record', depthInput), depthReceipt, 'depth record retries are idempotent');
  const text = 'Mira read the gauge: eighty degrees.';
  const draftInput = { graphHash: depthReceipt.graphHash, requestId: 'save-draft', nodeId: 'draft.gauge',
    storyRootId: 'document', authorId: 'protocol-author', accessScopes: ['editor'], kind: 'draft', text };
  const draftReceipt = await call(client, 'life_story_author_record', draftInput);
  assert.deepEqual(await call(client, 'life_story_author_record', draftInput), draftReceipt);
  const graphHash = draftReceipt.graphHash;
  const originalGraph = await readGraph(graphHash);
  const dossierNode = originalGraph.nodes.find(({ id }) => id === 'life.mira');
  assert.equal(dossierNode.render, 'exclude');
  assert.equal(dossierNode.training, 'exclude');
  assert.deepEqual(dossierNode.access_scopes, ['book-only', 'editor']);
  assert.deepEqual(JSON.parse(dossierNode.text), lifeInput.dossier);
  assert.ok(originalGraph.edges.some((edge) => edge.relation === 'models_life_of'
    && edge.target.kind === 'anchor' && edge.target.anchor_id === 'mira'));
  const preparation = {
    graphHash, lifeTrendsNodeId: 'life.mira', modelDepthReviewNodeId: depthReceipt.modelDepthReviewNodeId,
    authorModelNodeId: 'author.model',
    accessScopes: ['editor', 'book-only', 'source-only', 'irrelevant'],
    scene: {
      id: 'scene.gauge', parentNodeId: 'document', order: 1, routePartId: 'part.1',
      worldTime: 0, readerOrder: 0, viewpoint: 'mira',
      brief: 'Mira reads the temperature gauge.',
      characterConnections: lifeConnections('mira'),
      authorApplication: authorApplication(),
      context: [{ nodeId: 'canon.temperature', viewpointKnownAt: 0, readerKnownAt: 0 }],
      requirements: [{ id: 'gauge', instruction: 'Show Mira reading the gauge.' }],
    },
  };
  const missingLife = structuredClone(preparation);
  delete missingLife.lifeTrendsNodeId;
  const missingLifeResult = await client.callTool({ name: 'life_story_scene_prepare', arguments: missingLife });
  assert.equal(missingLifeResult.isError, true, 'a scene cannot bypass overall life modeling');
  const missingDepth = structuredClone(preparation);
  delete missingDepth.modelDepthReviewNodeId;
  assert.equal((await client.callTool({ name: 'life_story_scene_prepare', arguments: missingDepth })).isError, true,
    'a scene cannot bypass the recorded depth assessment');
  const gap = await call(client, 'life_story_model_depth_record', { ...depthInput, requestId: 'record-gap', nodeId: 'depth.gap',
    findings: [{ ...depthInput.findings[0], status: 'unclear', smallestRepair: 'Confirm that this scene occurs at the declared initial instant.' }] });
  assert.equal(gap.readyForScene, false, 'gaps are saved without being treated as sufficient');
  const gapPacket = await call(client, 'life_story_scene_prepare', { ...preparation,
    graphHash: gap.graphHash, modelDepthReviewNodeId: gap.modelDepthReviewNodeId });
  assert.ok(gapPacket.blockers.some((blocker) => blocker.code === 'model-depth-unresolved'));
  const packet = await call(client, 'life_story_scene_prepare', preparation);
  assert.deepEqual(packet.blockers, []);
  assert.equal(packet.authorModelDepthReview.basisHash, depthTask.basisHash, 'appending the assessment and draft does not stale the review');
  const depthNode = originalGraph.nodes.find((node) => node.id === 'depth.gauge');
  assert.equal(depthNode.role, 'externalized_reflection');
  assert.equal(depthNode.render, 'exclude');
  assert.ok(originalGraph.edges.some((edge) => edge.source.node_id === depthNode.id && edge.target.kind === 'anchor'
    && edge.target.anchor_kind === 'model' && edge.target.anchor_id === registeredModel.modelHash && edge.target.path === '/processes/0'));
  assert.deepEqual(packet.outputScopes, ['editor']);
  assert.deepEqual(packet.viewpointContext, ['canon.temperature']);
  assert.deepEqual(packet.readerBefore, []);
  assert.deepEqual(packet.readerReveals, ['canon.temperature']);
  assert.equal(packet.sourceSnapshotHash, originalGraph.source_snapshot_hash);
  assert.deepEqual(packet.authorLifeTrends.dossier, lifeInput.dossier);
  assert.deepEqual(packet.authorLifeTrends.characterConnections, lifeConnections('mira'));
  assert.ok(packet.checks.some(({ id }) => id === 'life:coverage'));
  assert.ok(packet.checks.some(({ id }) => id === 'life:continuity:mira'));
  assert.deepEqual(packet.authorModel.model, authorProfileInput.data);
  assert.deepEqual(packet.authorModel.application, authorApplication());
  assert.equal(packet.authorModel.nodeId, 'author.model');
  assert.match(packet.authorModel.recordHash, /^[a-f0-9]{64}$/u);
  assert.ok(packet.checks.some(({ id }) => id === 'author:application'));
  assert.ok(!packet.authorContext.some(({ nodeId }) => nodeId === 'author.model'));

  const missingApplication = structuredClone(preparation);
  delete missingApplication.scene.authorApplication;
  assert.equal((await client.callTool({ name: 'life_story_scene_prepare', arguments: missingApplication })).isError, true);
  const unknownDisposition = structuredClone(preparation);
  unknownDisposition.scene.authorApplication.dispositionIds = ['invented-disposition'];
  assert.equal((await client.callTool({ name: 'life_story_scene_prepare', arguments: unknownDisposition })).isError, true);
  const authorAsFact = structuredClone(preparation);
  authorAsFact.scene.context.push({ nodeId: 'author.model', viewpointKnownAt: 0, readerKnownAt: 0 });
  assert.equal((await client.callTool({ name: 'life_story_scene_prepare', arguments: authorAsFact })).isError, true,
    'an author personality model must not become reader or viewpoint knowledge');
  const unselectedAuthor = structuredClone(preparation);
  delete unselectedAuthor.authorModelNodeId;
  delete unselectedAuthor.scene.authorApplication;
  const unselectedPacket = await call(client, 'life_story_scene_prepare', unselectedAuthor);
  assert.equal(unselectedPacket.authorModel, null);
  assert.notEqual(unselectedPacket.packetHash, packet.packetHash);
  const orphanedApplication = structuredClone(unselectedAuthor);
  orphanedApplication.scene.authorApplication = authorApplication();
  assert.equal((await client.callTool({ name: 'life_story_scene_prepare', arguments: orphanedApplication })).isError, true);
  const restrainedAuthor = structuredClone(preparation);
  restrainedAuthor.scene.authorApplication = { dispositionIds: [], intendedEffect: '',
    restraint: 'Leave this disposition inactive; the reading needs direct literal explanation.',
    narratorRelation: 'The narrator reports the gauge without adopting the author persona’s outlook.' };
  const restrainedPacket = await call(client, 'life_story_scene_prepare', restrainedAuthor);
  assert.deepEqual(restrainedPacket.authorModel.application.dispositionIds, []);
  assert.deepEqual(restrainedPacket.blockers, [], 'an explicit decision not to apply an author disposition is allowed');
  assert.notEqual(restrainedPacket.packetHash, packet.packetHash);
  restrainedAuthor.scene.authorApplication.restraint = '';
  assert.equal((await client.callTool({ name: 'life_story_scene_prepare', arguments: restrainedAuthor })).isError, true,
    'an empty application must still explain deliberate restraint');

  const quote = 'eighty degrees';
  const citation = { start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, quote };
  const reviewInput = {
    preparation,
    expectedPacketHash: packet.packetHash,
    draftNodeId: 'draft.gauge',
    text,
    reviewer: 'protocol-reviewer',
    findings: packet.checks.map(({ id: checkId }) => ({
      checkId, status: 'satisfied',
      explanation: 'The exact draft reports the selected known gauge reading to Mira and the reader.',
      citations: [citation],
    })),
    uses: [
      { nodeId: 'canon.temperature', audience: 'reader', ...citation },
      { nodeId: 'canon.temperature', audience: 'viewpoint', ...citation },
    ],
  };
  const review = await call(client, 'life_story_scene_review', reviewInput);
  assert.equal(review.readyToCommit, true);
  assert.equal(review.semanticProseVerification, false);
  assert.deepEqual(review.blockers, []);
  const changedApplication = structuredClone(reviewInput);
  changedApplication.preparation.scene.authorApplication.intendedEffect = 'Use distance to make the same observation impersonal.';
  assert.equal((await client.callTool({ name: 'life_story_scene_review', arguments: changedApplication })).isError, true,
    'a review hash cannot be reused for a different authorial application');
  const roleConflictInput = { ...reviewInput, findings: reviewInput.findings.map((finding) => finding.checkId === 'author:application'
    ? { ...finding, status: 'conflict', explanation: 'This supplied finding reports a confusion between modeled author and narrator.' }
    : finding) };
  const roleConflict = await call(client, 'life_story_scene_review', roleConflictInput);
  assert.equal(roleConflict.readyToCommit, false);
  assert.ok(roleConflict.blockers.some(({ checkId }) => checkId === 'author:application'));
  assert.equal((await client.callTool({ name: 'life_story_scene_commit', arguments: {
    ...roleConflictInput, requestId: 'reject-role-conflict', expectedReviewHash: roleConflict.reviewHash,
  } })).isError, true, 'a declared role-separation conflict cannot be committed');
  assert.deepEqual(await readGraph(graphHash), originalGraph, 'prepare and review are read-only');
  const commitInput = {
    ...reviewInput,
    requestId: 'scene-commit',
    expectedReviewHash: review.reviewHash,
  };
  const committed = await call(client, 'life_story_scene_commit', commitInput);
  assert.equal(committed.worldMutation, false);
  assert.equal(committed.previousGraphHash, graphHash);
  assert.notEqual(committed.graphHash, graphHash);
  assert.equal(committed.batch.added_node_count, 2);
  assert.equal(committed.packetHash, packet.packetHash);
  assert.equal(committed.reviewHash, review.reviewHash);
  const rendered = await call(client, 'life_narrative_render', {
    graphHash: committed.graphHash, rootIds: ['document'], accessScopes: ['editor'],
  });
  assert.equal(rendered.text, text, 'only prose is rendered, not canon or review metadata');
  // Releasing the prose to readers is a recorded author decision; the review and context keep their scopes.
  const unreleased = await client.callTool({ name: 'life_narrative_render', arguments: { graphHash: committed.graphHash, rootIds: ['document'], accessScopes: ['reader'] } });
  assert.ok(unreleased.isError || unreleased.structuredContent?.text !== text, 'before release a reader does not see the prose');
  // Release waits for the director to read the draft; the task it returns carries the draft principles and the model's questions.
  const directionTask = await call(client, 'life_story_direct', { graphHash: committed.graphHash, requestId: 'direct-draft-task', storyRootId: 'document',
    accessScopes: ['editor'], stage: 'draft', directorId: 'fresh-reader', independent: true });
  assert.ok(directionTask.principles.some((item) => item.id === 'draft.character-test'), 'the draft task carries the Book\'s character test');
  await assert.rejects(call(client, 'life_story_release', { graphHash: committed.graphHash, requestId: 'release-0', nodeId: 'author.release.0', storyRootId: 'document',
    authorId: 'author.llm', accessScopes: ['editor'], releaseTo: ['reader'], reason: 'Too early.' }), /Run the director on the draft before release/);
  const directed = await call(client, 'life_story_direct', { graphHash: committed.graphHash, requestId: 'direct-draft', storyRootId: 'document',
    accessScopes: ['editor'], stage: 'draft', directorId: 'fresh-reader', independent: true, nodeId: 'direction.draft', summary: 'The draft holds.',
    findings: directionTask.principles.map((item) => ({ principleId: item.id, verdict: 'holds', evidence: 'The one-line scene was read against this principle.', modelChange: null })) });
  const released = await call(client, 'life_story_release', { graphHash: directed.graphHash, requestId: 'release-1', nodeId: 'author.release.1', storyRootId: 'document',
    authorId: 'author.llm', accessScopes: ['editor'], releaseTo: ['reader'], reason: 'The human approved publishing this scene.' });
  assert.ok(released.releasedNodeIds.includes(committed.sceneId));
  const asReader = await call(client, 'life_narrative_render', { graphHash: released.graphHash, rootIds: ['document'], accessScopes: ['reader'] });
  assert.equal(asReader.text, text, 'after release a reader sees exactly the prose');
  const releasedGraph = await readGraph(released.graphHash);
  assert.deepEqual(releasedGraph.nodes.find(({ id }) => id === committed.reviewNodeId).access_scopes, ['editor'], 'the review keeps its scope');
  assert.deepEqual(releasedGraph.nodes.find(({ id }) => id === committed.sceneId).access_scopes, ['editor', 'reader']);
  const decision = releasedGraph.nodes.find(({ id }) => id === 'author.release.1');
  assert.equal(JSON.parse(decision.text).kind, 'decision');
  assert.deepEqual(decision.access_scopes, ['editor'], 'the decision stays with the author');
  const newGraph = await readGraph(committed.graphHash);
  const storedSceneNode = newGraph.nodes.find(({ id }) => id === committed.sceneId);
  const storedReviewNode = newGraph.nodes.find(({ id }) => id === committed.reviewNodeId);
  assert.deepEqual(storedSceneNode.access_scopes, ['editor']);
  assert.deepEqual(storedReviewNode.access_scopes, ['editor']);
  assert.equal(storedReviewNode.render, 'exclude');
  assert.equal(storedReviewNode.training, 'exclude');
  assert.ok(newGraph.edges.some((edge) => edge.relation === 'uses_life_trends'
    && edge.source.node_id === committed.sceneId && edge.target.node_id === 'life.mira'));
  assert.ok(newGraph.edges.some((edge) => edge.relation === 'shaped_by'
    && edge.source.node_id === committed.sceneId && edge.target.node_id === 'author.model'));
  assert.equal(storedReviewNode.role, 'externalized_reflection');
  assert.ok(newGraph.edges.some((edge) => edge.relation === 'contains' && edge.source.node_id === committed.understandingRootId && edge.target.node_id === committed.reviewNodeId));
  const storedReview = JSON.parse(storedReviewNode.text).data;
  assert.equal(storedReview.packet.packetHash, packet.packetHash);
  assert.deepEqual(storedReview.review, review);
  const purposeInput = {
    graphHash: committed.graphHash,
    rootId: 'document',
    accessScopes: ['editor'],
  };
  const purposeTask = await call(client, 'life_story_purpose_review', purposeInput);
  assert.equal(purposeTask.schema, 'meaning-model-story-purpose-review-task/v1');
  assert.deepEqual(purposeTask.target, {
    graphHash: committed.graphHash,
    rootId: 'document',
    unit: 'chapter',
    sourceSnapshotHash: newGraph.source_snapshot_hash,
    projectionHash: rendered.projection_hash,
    nodeIds: rendered.sequence,
  });
  assert.equal(purposeTask.text, text, 'purpose review receives canonical prose without canon or review metadata');
  assert.equal(purposeTask.authorGoal, null, 'the tool must not invent an author goal');
  assert.equal(purposeTask.context, '');
  assert.equal(purposeTask.questions.length, 2);
  assert.ok(purposeTask.questions.every((question) => typeof question === 'string' && question.length > 0));
  assert.equal(purposeTask.evaluator, 'calling_llm');
  assert.equal(purposeTask.assessment, null, 'preparing an LLM task must not fabricate a literary verdict');
  assert.equal(purposeTask.advisoryOnly, true);
  assert.equal(purposeTask.graphMutation, false);
  assert.equal(purposeTask.worldMutation, false);
  assert.match(purposeTask.taskHash, /^[a-f0-9]{64}$/u);
  assert.match(purposeTask.reviewerInstructions, /inferred/iu);
  assert.match(purposeTask.reviewerInstructions, /mechanical|checklist/iu);
  assert.equal(typeof purposeTask.responseGuidance, 'string');
  assert.deepEqual(await call(client, 'life_story_purpose_review', purposeInput), purposeTask,
    'the same source and review request produce the same bound task');
  const authorPurposeInput = { ...purposeInput, authorModelNodeId: 'author.model' };
  const authorPurpose = await call(client, 'life_story_purpose_review', authorPurposeInput);
  assert.deepEqual(authorPurpose.authorModel.model, authorProfileInput.data);
  assert.equal(authorPurpose.authorModel.nodeId, 'author.model');
  assert.equal(authorPurpose.authorModel.recordHash, packet.authorModel.recordHash);
  assert.equal(authorPurpose.text, text, 'authorial context does not enter the rendered manuscript');
  assert.equal(authorPurpose.assessment, null);
  assert.equal(authorPurpose.advisoryOnly, true, 'a modeled author supports judgment rather than supplying a literary grade');
  assert.notEqual(authorPurpose.taskHash, purposeTask.taskHash);
  const unavailableAuthorPurpose = await client.callTool({ name: 'life_story_purpose_review',
    arguments: { ...purposeInput, authorModelNodeId: 'missing-author-model' } });
  assert.equal(unavailableAuthorPurpose.isError, true);
  const authorPrompt = await client.getPrompt({ name: 'life_story_purpose_review',
    arguments: { ...authorPurposeInput, accessScopes: JSON.stringify(authorPurposeInput.accessScopes) } });
  const authorPromptText = authorPrompt.messages.map(({ content }) => content.text ?? '').join('\n');
  const authorPromptMaterial = JSON.parse(authorPromptText.split('Review material (data):\n')[1]);
  assert.deepEqual(authorPromptMaterial.authorModel, authorPurpose.authorModel,
    'the calling LLM receives the same bound author model through the purpose prompt');

  const deepenInput = { ...depthPreparation, graphHash: committed.graphHash,
    rootId: 'document', authorModelNodeId: 'author.model' };
  const deepeningTask = await call(client, 'life_story_deepen', deepenInput);
  assert.equal(deepeningTask.schema, 'meaning-model-story-deepening-task/v1');
  assert.deepEqual(deepeningTask.baseline, { graphHash: committed.graphHash,
    sourceSnapshotHash: newGraph.source_snapshot_hash, modelHash: registeredModel.modelHash,
    rootId: 'document', projectionHash: rendered.projection_hash,
    textHash: createHash('sha256').update(text).digest('hex'), nodeIds: rendered.sequence });
  assert.equal(deepeningTask.text, text);
  assert.deepEqual(deepeningTask.authorModel, authorPurpose.authorModel);
  assert.deepEqual(deepeningTask.modelDepth.model.definition, depthTask.model.definition);
  assert.equal(deepeningTask.purposeReview.text, text);
  assert.deepEqual(deepeningTask.accessScopes, ['editor']);
  assert.equal(deepeningTask.revisionScope, 'local');
  assert.equal(deepeningTask.assessment, null);
  assert.equal(deepeningTask.worldMutation, false);
  assert.equal(deepeningTask.graphMutation, false);
  assert.equal(deepeningTask.semanticVerification, false);
  assert.deepEqual(await call(client, 'life_story_deepen', deepenInput), deepeningTask);
  const deepenPrompt = await client.getPrompt({ name: 'life_story_deepen', arguments: {
    ...deepenInput, accessScopes: JSON.stringify(deepenInput.accessScopes),
    contextNodeIds: JSON.stringify(deepenInput.contextNodeIds),
  } });
  const deepenPromptText = deepenPrompt.messages.map(({ content }) => content.text ?? '').join('\n');
  assert.ok(deepenPromptText.includes(text), 'deepening prompt receives the same canonical manuscript');
  assert.ok(deepenPromptText.includes(deepeningTask.baseline.textHash));
  assert.ok(deepenPromptText.includes(deepeningTask.authorModel.recordHash));
  assert.ok(deepenPromptText.includes(registeredModel.modelHash));
  assert.deepEqual(await readGraph(committed.graphHash), newGraph,
    'deepening tool and prompt cannot rewrite the baseline or its saved reviews');

  const authorGoal = 'Let the reader share Mira\'s quiet attention to the instrument.';
  const context = 'The surrounding chapter slows down after a dangerous journey.';
  const sectionInput = { ...purposeInput, unit: 'section', authorGoal, context };
  const sectionTask = await call(client, 'life_story_purpose_review', sectionInput);
  assert.equal(sectionTask.target.unit, 'section');
  assert.equal(sectionTask.authorGoal, authorGoal);
  assert.equal(sectionTask.context, context);
  assert.equal(sectionTask.text, text);
  assert.equal(sectionTask.assessment, null);
  assert.notEqual(sectionTask.taskHash, purposeTask.taskHash, 'the task binds the chosen unit, goal, and context');
  for (const input of [purposeInput, sectionInput]) {
    const prompt = await client.getPrompt({
      name: 'life_story_purpose_review',
      arguments: { ...input, accessScopes: JSON.stringify(input.accessScopes) },
    });
    const promptText = prompt.messages.map(({ content }) => content.text ?? '').join('\n');
    assert.ok(promptText.includes(text), 'the MCP prompt includes the actual rendered prose');
    assert.match(promptText, /mechanical|checklist/iu);
    assert.match(promptText, /inferred/iu);
    assert.ok(!promptText.includes('The vessel temperature is eighty degrees.'),
      'the prompt must not include excluded canon metadata');
    assert.ok(!promptText.includes('protocol-reviewer'), 'the prompt must not include stored review metadata');
    if (input.authorGoal) {
      assert.ok(promptText.includes(authorGoal));
      assert.ok(promptText.includes(context));
    }
  }
  const inaccessiblePurpose = await client.callTool({
    name: 'life_story_purpose_review', arguments: { ...purposeInput, accessScopes: [] },
  });
  assert.equal(inaccessiblePurpose.isError, true, 'review cannot read an inaccessible root');
  assert.ok(!JSON.stringify(inaccessiblePurpose).includes(text), 'scope errors do not expose prose');
  const malformedPurpose = await client.callTool({
    name: 'life_story_purpose_review', arguments: { ...purposeInput, accessScopes: 'editor' },
  });
  assert.equal(malformedPurpose.isError, true, 'the tool rejects malformed scopes');
  for (const accessScopes of ['not-json', '"editor"', '[4]']) {
    await assert.rejects(client.getPrompt({
      name: 'life_story_purpose_review',
      arguments: { graphHash: committed.graphHash, rootId: 'document', accessScopes },
    }), undefined, 'the prompt rejects malformed scope JSON');
  }
  await assert.rejects(client.getPrompt({
    name: 'life_story_purpose_review',
    arguments: { graphHash: committed.graphHash, rootId: 'document', accessScopes: '[]' },
  }), undefined, 'the prompt cannot bypass root visibility');
  assert.deepEqual(await readGraph(committed.graphHash), newGraph,
    'purpose review tools and prompts leave the canonical graph and existing scene review unchanged');
  for (const scope of ['book-only', 'source-only', 'irrelevant']) {
    const restrictedGraph = await readGraph(committed.graphHash, [scope]);
    assert.ok(!restrictedGraph.nodes.some(({ id }) => id === committed.sceneId || id === committed.reviewNodeId),
      `${scope} alone must expose neither the combined scene nor its review`);
    const restrictedRender = await call(client, 'life_narrative_render', {
      graphHash: committed.graphHash, accessScopes: [scope],
    });
    assert.equal(restrictedRender.text, '', `${scope} alone must not render the combined scene`);
  }
  assert.deepEqual(
    await call(client, 'life_story_scene_commit', commitInput), committed,
    'retrying the same commit returns the same receipt without duplicating nodes',
  );
  assert.deepEqual(await readGraph(graphHash), originalGraph, 'the previous graph remains immutable');
  assert.deepEqual(
    await call(client, 'life_world_inspect', { worldId: world.worldId }), originalWorld,
    'the scene workflow leaves the canonical world unchanged',
  );
  assert.deepEqual(await readGraph(committed.graphHash), newGraph);

  // Use existing public revision tools to retire a committed passage, then
  // prepare/review/commit its replacement. The retained baseline and the final
  // graph must remain separately readable; appending a second story is not a revision.
  const authorVoice = await call(client, 'life_story_author_record', {
    graphHash: committed.graphHash, requestId: 'record-author-voice-before', nodeId: 'voice.author.before',
    storyRootId: 'document', authorId: 'protocol-reviewer', accessScopes: ['editor'], kind: 'assessment',
    text: 'The passage uses the modeled author’s preference for a concrete action and leaves emotional interpretation unstated; one line cannot establish a distinctive overall authorial voice.',
    data: { reviewedGraphHash: committed.graphHash, subject: { kind: 'author', nodeId: 'author.model', dispositionId: 'restraint' },
      proseEvidence: { nodeId: committed.sceneId, start: 0, end: text.length, quote: text },
      authorBasisIds: authorProfileInput.data.dispositions[0].basisIds,
      finding: 'application_observed_distinctiveness_unclear', semanticVerification: false },
    links: [{ relation: 'about', targetNodeId: committed.sceneId }, { relation: 'shaped_by', targetNodeId: 'author.model' }],
  });
  const characterVoice = await call(client, 'life_story_author_record', {
    graphHash: authorVoice.graphHash, requestId: 'record-character-voice-before', nodeId: 'voice.mira.before',
    storyRootId: 'document', authorId: 'protocol-reviewer', accessScopes: ['editor'], kind: 'assessment',
    text: 'Mira’s action is consistent with her life trend of practiced checking. The model supplies a physical reading and a stable person, but no dialogue or comparison character; distinct speech cannot be established from this line.',
    data: { reviewedGraphHash: committed.graphHash, subject: { kind: 'character', referentId: 'mira' },
      proseEvidence: { nodeId: committed.sceneId, ...citation }, lifeTrendsNodeId: 'life.mira', trendIds: ['agency'],
      modelEvidence: [{ modelHash: registeredModel.modelHash, path: '/meaning_model/referents/0' },
        { modelHash: registeredModel.modelHash, path: '/processes/0' }],
      finding: 'behavior_consistent_speech_distinctiveness_unclear', semanticVerification: false },
    links: [{ relation: 'about', targetNodeId: committed.sceneId }, { relation: 'supports', targetNodeId: 'life.mira' }],
  });
  const voiceGraph = await readGraph(characterVoice.graphHash);
  for (const nodeId of ['voice.author.before', 'voice.mira.before']) {
    const node = voiceGraph.nodes.find(({ id }) => id === nodeId);
    assert.equal(node.role, 'externalized_reflection', 'voice findings are actual Understanding Nodes, not metadata labels');
    assert.equal(node.render, 'exclude');
    assert.equal(node.training, 'exclude');
    const data = JSON.parse(node.text).data;
    assert.equal(text.slice(data.proseEvidence.start, data.proseEvidence.end), data.proseEvidence.quote);
    assert.ok(voiceGraph.edges.some((edge) => edge.source.node_id === committed.understandingRootId
      && edge.target.node_id === nodeId && edge.family === 'structural' && edge.relation === 'contains'));
    assert.ok(voiceGraph.edges.some((edge) => edge.source.node_id === nodeId
      && edge.target.node_id === committed.sceneId && edge.relation === 'about'));
  }
  const revisionPlan = await call(client, 'life_story_author_record', {
    graphHash: characterVoice.graphHash, requestId: 'store-deepening-plan', nodeId: 'deepening.plan',
    storyRootId: 'document', authorId: 'protocol-author', accessScopes: ['editor'], kind: 'revision',
    text: 'Retain the quiet gauge reading, its author outlook and character life trends; make the action more concrete without changing its temperature or outcome.',
    data: { task: deepeningTask, baseline: deepeningTask.baseline,
      change: { previousSceneId: committed.sceneId, nextSceneId: 'scene.gauge.revised', mode: 'local' } },
    links: [{ relation: 'about', targetNodeId: committed.sceneId }, { relation: 'shaped_by', targetNodeId: 'author.model' }],
  });
  const plannedGraph = await readGraph(revisionPlan.graphHash);
  assert.equal(plannedGraph.nodes.length, plannedGraph.graph.node_count,
    'a complete successor must not be built by silently dropping inaccessible nodes');
  assert.equal(plannedGraph.edges.length, plannedGraph.graph.edge_count);
  const retiredNodes = plannedGraph.nodes.map(({ boundary, content_included, ...node }) => ({
    ...structuredClone(node), ...(node.id === committed.sceneId ? { render: 'exclude' } : {}),
  }));
  const retired = await call(client, 'life_narrative_revise', {
    requestId: 'retire-old-scene', previousGraphHash: revisionPlan.graphHash,
    narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: plannedGraph.graph.id,
      revision: { number: plannedGraph.graph.revision.number + 1, previous_graph_hash: revisionPlan.graphHash,
        reason: 'Retire the old rendering placement before a reviewed local replacement; preserve the old node and its reviews.', provenance },
      source: { kind: 'world', world_id: world.worldId, world_hash: world.headHash },
      roots: plannedGraph.roots, nodes: retiredNodes,
      edges: plannedGraph.edges.filter(({ id }) => id !== `${committed.sceneId}.placement`),
    },
  });
  const replacementText = 'Mira steadied the gauge with one hand and read it: eighty degrees.';
  const replacementDraft = await call(client, 'life_story_author_record', {
    ...draftInput, graphHash: retired.graphHash, requestId: 'save-replacement-draft', nodeId: 'draft.gauge.revised',
    text: replacementText, links: [{ relation: 'refines', targetNodeId: 'draft.gauge' }],
  });
  const replacementPreparation = { ...preparation, graphHash: replacementDraft.graphHash,
    scene: { ...preparation.scene, id: 'scene.gauge.revised' } };
  const replacementPacket = await call(client, 'life_story_scene_prepare', replacementPreparation);
  assert.deepEqual(replacementPacket.blockers, [], 'style-only replacement reuses an unchanged causal depth assessment');
  const replacementQuote = 'eighty degrees';
  const replacementCitation = { start: replacementText.indexOf(replacementQuote),
    end: replacementText.indexOf(replacementQuote) + replacementQuote.length, quote: replacementQuote };
  const replacementReviewInput = {
    ...reviewInput, preparation: replacementPreparation, expectedPacketHash: replacementPacket.packetHash,
    draftNodeId: 'draft.gauge.revised', text: replacementText,
    findings: replacementPacket.checks.map(({ id: checkId }) => ({ checkId, status: 'satisfied',
      explanation: 'The revised draft retains the known eighty-degree reading and gives Mira a concrete practiced action, without importing author biography.',
      citations: [replacementCitation] })),
    uses: [{ nodeId: 'canon.temperature', audience: 'reader', ...replacementCitation },
      { nodeId: 'canon.temperature', audience: 'viewpoint', ...replacementCitation }],
  };
  const replacementReview = await call(client, 'life_story_scene_review', replacementReviewInput);
  const replacementCommit = await call(client, 'life_story_scene_commit', {
    ...replacementReviewInput, requestId: 'commit-replacement-scene', expectedReviewHash: replacementReview.reviewHash,
  });
  const adopted = await call(client, 'life_story_author_record', {
    graphHash: replacementCommit.graphHash, requestId: 'record-replacement-adoption', nodeId: 'deepening.adopted',
    storyRootId: 'document', authorId: 'protocol-author', accessScopes: ['editor'], kind: 'revision',
    text: 'Adopted a local prose revision while retaining character identity, canonical temperature, life trends and author model. This procedural test makes no claim of improved literary quality.',
    data: { baseline: deepeningTask.baseline, reviewedReplacementGraphHash: replacementCommit.graphHash,
      previousSceneId: committed.sceneId, sceneId: replacementCommit.sceneId, textHash: replacementCommit.textHash },
    links: [{ relation: 'supersedes', targetNodeId: 'deepening.plan' },
      { relation: 'refines', targetNodeId: committed.sceneId }, { relation: 'about', targetNodeId: replacementCommit.sceneId }],
  });
  const revisedRender = await call(client, 'life_narrative_render', {
    graphHash: adopted.graphHash, rootIds: ['document'], accessScopes: ['editor'],
  });
  assert.equal(revisedRender.text, replacementText, 'the final canonical rendering contains only the reviewed replacement');
  assert.ok(!revisedRender.sequence.includes(committed.sceneId));
  assert.ok(revisedRender.sequence.includes(replacementCommit.sceneId));
  const revisedGraph = await readGraph(adopted.graphHash);
  const retainedOriginal = revisedGraph.nodes.find(({ id }) => id === committed.sceneId);
  assert.equal(retainedOriginal.text, text, 'the retired passage remains addressable as history');
  assert.equal(retainedOriginal.render, 'exclude');
  assert.deepEqual(JSON.parse(revisedGraph.nodes.find(({ id }) => id === committed.reviewNodeId).text).data, storedReview);
  const revisedScene = revisedGraph.nodes.find(({ id }) => id === replacementCommit.sceneId);
  const finalSavedReview = JSON.parse(revisedGraph.nodes.find(({ id }) => id === replacementCommit.reviewNodeId).text).data;
  assert.equal(finalSavedReview.review.textHash, replacementCommit.textHash);
  assert.equal(revisedScene.text, replacementText);
  const voiceAfter = await call(client, 'life_story_author_record', {
    graphHash: adopted.graphHash, requestId: 'record-voice-comparison', nodeId: 'voice.after',
    storyRootId: 'document', authorId: 'protocol-reviewer', accessScopes: ['editor'], kind: 'assessment',
    text: 'The revision gives the same checking behavior a concrete hand movement, retaining the author’s restraint and Mira’s practiced attention. It introduces no speech, so distinctive dialogue remains untested; a longer passage and reader assessment would be needed.',
    data: { before: deepeningTask.baseline, after: { graphHash: adopted.graphHash, nodeId: replacementCommit.sceneId,
      start: 0, end: replacementText.length, quote: replacementText, textHash: replacementCommit.textHash },
      authorModelNodeId: 'author.model', lifeTrendsNodeId: 'life.mira',
      findings: [{ subject: 'author', observation: 'The concrete-action approach remains visible; overall stylistic quality is unproven.' },
        { subject: 'mira', observation: 'The same modeled checking behavior gains detail; distinctive speech remains unclear.' }],
      modelEvidence: [{ modelHash: registeredModel.modelHash, path: '/processes/0' }], semanticVerification: false },
    links: [{ relation: 'about', targetNodeId: replacementCommit.sceneId },
      { relation: 'answers', targetNodeId: 'voice.author.before' }, { relation: 'answers', targetNodeId: 'voice.mira.before' },
      { relation: 'shaped_by', targetNodeId: 'author.model' }, { relation: 'supports', targetNodeId: 'life.mira' }],
  });
  const finalGraph = await readGraph(voiceAfter.graphHash);
  assert.equal(finalGraph.nodes.find(({ id }) => id === 'voice.after').role, 'externalized_reflection');
  const revisedPurpose = await call(client, 'life_story_purpose_review', { ...authorPurposeInput, graphHash: voiceAfter.graphHash });
  const revisedDeepening = await call(client, 'life_story_deepen', { ...deepenInput, graphHash: voiceAfter.graphHash });
  assert.equal(revisedPurpose.text, replacementText);
  assert.equal(revisedDeepening.text, replacementText);
  assert.equal(revisedDeepening.baseline.graphHash, voiceAfter.graphHash);
  assert.notEqual(revisedDeepening.baseline.textHash, deepeningTask.baseline.textHash);
  assert.equal(revisedDeepening.baseline.modelHash, deepeningTask.baseline.modelHash);
  assert.equal(revisedDeepening.authorModel.recordHash, deepeningTask.authorModel.recordHash);
  assert.deepEqual(await readGraph(committed.graphHash), newGraph, 'deepening preserves the exact original graph and reviews');
  assert.equal((await call(client, 'life_narrative_render', {
    graphHash: committed.graphHash, rootIds: ['document'], accessScopes: ['editor'],
  })).text, text, 'the original manuscript remains independently renderable');
  assert.deepEqual(await call(client, 'life_world_inspect', { worldId: world.worldId }), originalWorld);

  // A separately reviewed scene can be authored as passages and edited locally
  // through the same general graph tool available without this add-on.
  const passageText = `${text}\n\nMira kept watching the needle.`;
  const passageDraft = await call(client, 'life_story_author_record', {
    ...draftInput, graphHash, requestId: 'save-passage-draft', nodeId: 'draft.passages', text: passageText,
  });
  const passagePreparation = { ...preparation, graphHash: passageDraft.graphHash,
    scene: { ...preparation.scene, id: 'scene.passages' } };
  const passagePacket = await call(client, 'life_story_scene_prepare', passagePreparation);
  const passageReviewInput = { ...reviewInput, preparation: passagePreparation,
    expectedPacketHash: passagePacket.packetHash, draftNodeId: 'draft.passages', text: passageText,
    passages: [{ id: 'scene.passages.reading', text },
      { id: 'scene.passages.waiting', text: 'Mira kept watching the needle.' }],
    findings: passagePacket.checks.map(({ id: checkId }) => ({ checkId, status: 'satisfied',
      explanation: 'The exact composed scene retains the known temperature and a quiet checking action.', citations: [citation] })),
  };
  const passageReview = await call(client, 'life_story_scene_review', passageReviewInput);
  const passageCommit = await call(client, 'life_story_scene_commit', {
    ...passageReviewInput, requestId: 'commit-passage-scene', expectedReviewHash: passageReview.reviewHash,
  });
  const passageRender = await call(client, 'life_narrative_render', {
    graphHash: passageCommit.graphHash, rootIds: ['scene.passages'], accessScopes: ['editor'],
  });
  assert.equal(passageRender.text, passageText);
  assert.deepEqual(passageRender.sequence, ['scene.passages.reading', 'scene.passages.waiting']);
  const passageGraph = await readGraph(passageCommit.graphHash);
  assert.equal(passageGraph.nodes.find(({ id }) => id === 'scene.passages').render, 'exclude');
  const localEdit = await call(client, 'life_narrative_edit', {
    graphHash: passageCommit.graphHash, requestId: 'edit-one-passage', accessScopes: ['editor'],
    reason: 'Make the waiting action specific while preserving the separate reading passage.',
    operations: [{ kind: 'replace_text', nodeId: 'scene.passages.waiting',
      expectedText: 'Mira kept watching the needle.', text: 'Mira waited until the needle stopped trembling.' }],
  });
  const localGraph = await readGraph(localEdit.graphHash);
  assert.ok(localEdit.affectedReviewNodeIds.includes(passageCommit.reviewNodeId),
    'editing a scene leaf identifies the whole-scene review as needing reassessment');
  assert.deepEqual(localGraph.nodes.find(({ id }) => id === 'scene.passages.reading'),
    passageGraph.nodes.find(({ id }) => id === 'scene.passages.reading'));
  const localPurpose = await call(client, 'life_story_purpose_review', {
    graphHash: localEdit.graphHash, rootId: 'scene.passages', unit: 'section', accessScopes: ['editor'],
  });
  assert.equal(localPurpose.text, `${text}\n\nMira waited until the needle stopped trembling.`);
  assert.equal(localPurpose.target.graphHash, localEdit.graphHash);
  assert.deepEqual(await readGraph(passageCommit.graphHash), passageGraph);

  // Repair the actual model, preserve historical reviews, and assess the
  // successor through the same public tools an author uses.
  const refinedModel = structuredClone(model);
  refinedModel.revision = { number: 1, previous_model_hash: registeredModel.modelHash,
    reason: 'Open the gauge calibration needed to explain the reading.', provenance };
  refinedModel.processes.push({ ...structuredClone(model.processes[0]), id: 'gauge.offset',
    value_type: { kind: 'scalar', bounds: { minimum: -2, maximum: 2 } },
    initial_value: { kind: 'scalar', value: 0 },
    update_mode: 'static',
    provenance: ['Authored zero calibration offset at the initial instant.'] });
  const refined = await call(client, 'life_model_revise', { requestId: 'refine-gauge-model',
    previousModelHash: registeredModel.modelHash, model: refinedModel });
  const successorNodes = newGraph.nodes.map(({ boundary, content_included, ...node }) => structuredClone(node));
  const historicalDepthIds = new Set(successorNodes.filter((node) => {
    try { return JSON.parse(node.text).data?.schema === 'meaning-model-story-model-depth-assessment/v1'; } catch { return false; }
  }).map((node) => node.id));
  const contextNode = successorNodes.find((node) => node.id === 'canon.temperature');
  contextNode.text = 'The vessel temperature is eighty degrees; the gauge has zero calibration offset at this initial instant.';
  const successorGraph = await call(client, 'life_narrative_revise', { requestId: 'rebind-refined-model',
    previousGraphHash: committed.graphHash, narrativeGraph: {
      schema: 'life-sim-rust-narrative-graph/v1', id: newGraph.graph.id,
      revision: { number: newGraph.graph.revision.number + 1, previous_graph_hash: committed.graphHash,
        reason: 'Bind the refined model, preserving earlier review records as history.', provenance },
      source: { kind: 'model', model_hash: refined.modelHash }, roots: newGraph.roots, nodes: successorNodes,
      edges: newGraph.edges.filter((edge) => !(historicalDepthIds.has(edge.source.node_id)
        && edge.target.kind === 'anchor' && edge.target.anchor_kind === 'model'
        && edge.target.anchor_id === registeredModel.modelHash)),
    },
  });
  const nextScene = { ...preparation, graphHash: successorGraph.graphHash,
    scene: { ...preparation.scene, id: 'scene.followup', order: 2, readerOrder: 1 } };
  const stale = await client.callTool({ name: 'life_story_scene_prepare', arguments: nextScene });
  assert.equal(stale.isError, true, 'historical depth approval cannot authorize a changed model');
  assert.match(JSON.stringify(stale), /stale/);
  const nextDepthPreparation = { ...depthPreparation, graphHash: successorGraph.graphHash };
  const nextTask = await call(client, 'life_story_model_depth_review', nextDepthPreparation);
  assert.equal(nextTask.modelHash, refined.modelHash);
  const nextDepth = await call(client, 'life_story_model_depth_record', { ...depthInput,
    preparation: nextDepthPreparation, expectedTaskHash: nextTask.taskHash,
    requestId: 'refined-depth', nodeId: 'depth.refined',
    findings: [{ ...depthInput.findings[0], evidence: [
      ...depthInput.findings[0].evidence, { kind: 'model', path: '/processes/1' },
    ] }],
  });
  const nextPacket = await call(client, 'life_story_scene_prepare', { ...nextScene,
    graphHash: nextDepth.graphHash, modelDepthReviewNodeId: nextDepth.modelDepthReviewNodeId });
  assert.deepEqual(nextPacket.blockers, []);
  const repairedGraph = await readGraph(nextDepth.graphHash);
  const historical = JSON.parse(repairedGraph.nodes.find((node) => node.id === depthReceipt.modelDepthReviewNodeId).text).data;
  assert.equal(historical.modelHash, registeredModel.modelHash);
  assert.equal(historical.reviewedGraphHash, depthPreparation.graphHash);
  assert.deepEqual(await readGraph(committed.graphHash), newGraph, 'model repair preserves the earlier graph and exact historical model anchors');
});

test('numerical life exploration and local repair persist through real graph tools', async (t) => {
  const client = await connectClient(t, true);
  const { model } = genericModels()[1];
  const provenance = ['Numerical graph authoring protocol test'];
  model.meaning_model = { schema: 'life-sim-rust-meaning-model/v1', concepts: [],
    referents: [{ id: 'mira', boundary: 'The same technician across the proposed life.',
      continuity_criterion: 'Personal continuity across life phases.', provenance }],
    events: [], event_referent_bindings: [] };
  const registered = await call(client, 'life_model_register', { requestId: 'numeric-model', model });
  const graph = await call(client, 'life_narrative_register', { requestId: 'numeric-graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'numeric-life',
    revision: { number: 0, reason: 'Explore a life before adopting a character model.', provenance },
    source: { kind: 'model', model_hash: registered.modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root',
      epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [],
  } });
  const record = (graphHash, nodeId) => ({ graphHash, requestId: nodeId, nodeId,
    storyRootId: 'book', authorId: 'author', accessScopes: ['author'] });
  const input = { record: record(graph.graphHash, 'life.options'), exploration: {
    definition: { targetKind: 'life', subjectId: 'mira', brief: 'Explore changing social investment over a lifetime.',
      timeUnit: 'years_since_birth', axes: [{ id: 'company', meaning: 'Share of discretionary time allocated to company during this phase.',
        comparisonQuestion: 'How much discretionary time goes to company rather than other activities?', unit: 'share_of_discretionary_time', minimum: 0, maximum: 1 }] },
    points: [{ id: 'early', at: 8, label: 'Earliest established childhood', values: { company: 0.6 }, fixed: ['company'] },
      { id: 'adult', at: 20, label: 'First independent work', values: { company: 0.4 } },
      { id: 'entry', at: 40, label: 'Story entry', values: { company: 0.5 } }], randomness: 0.5, candidateCount: 3,
  } };
  const explored = await call(client, 'life_story_trajectory_explore', input);
  assert.equal(explored.graphMutation, true);
  assert.equal(explored.canonical, false);
  assert.deepEqual(await call(client, 'life_story_trajectory_explore', input), explored, 'retry reuses exact numbers and receipt');
  const chosen = explored.candidates[0];
  const assessed = await call(client, 'life_story_author_record', { ...record(explored.graphHash, 'life.assessment'),
    kind: 'assessment', text: 'Revise locally: preserve early relationships. Concentrate avoidance of company in the adult work phase where it can affect a decision.',
    data: { candidateHash: chosen.candidateHash, decision: 'revise' }, links: [{ relation: 'about', targetNodeId: explored.recordNodeId }] });
  const revised = await call(client, 'life_story_trajectory_revise', { record: record(assessed.graphHash, 'life.repair'),
    sourceNodeId: explored.recordNodeId, candidateId: chosen.id,
    reason: 'Keep the person; repair only the adult allocation so withdrawal has a concrete behavioral expression.',
    changes: [{ pointId: 'adult', axisId: 'company', value: 0.2, reason: 'Less time with peers makes avoiding a needed consultation plausible.' }] });
  assert.equal(revised.understandingNode, true);
  assert.equal(revised.candidate.revision.parentCandidateHash, chosen.candidateHash);
  assert.deepEqual(revised.candidate.points[0], chosen.points[0]);
  assert.deepEqual(revised.candidate.points[2], chosen.points[2]);
  const dossier = lifeTrendsDossier('book', 'mira');
  dossier.characters[0].lifeBeginning = 8;
  dossier.characters[0].phases[0].at = 8;
  dossier.characters[0].trajectoryProposal = { definition: revised.definition, candidate: revised.candidate };
  dossier.characters[0].trajectoryRecordNodeId = revised.recordNodeId;
  const savedLife = await call(client, 'life_story_life_trends', { graphHash: revised.graphHash, requestId: 'numeric-life-dossier',
    nodeId: 'life.dossier', accessScopes: ['author'], dossier });
  const view = await call(client, 'life_narrative_query', { graphHash: savedLife.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const original = JSON.parse(view.nodes.find((node) => node.id === explored.recordNodeId).text).data;
  assert.deepEqual(original.candidates[0], chosen, 'repair preserves original sampled candidate');
  for (const id of ['life.assessment', 'life.repair']) {
    const node = view.nodes.find((node) => node.id === id);
    assert.equal(node.role, 'externalized_reflection');
    assert.equal(node.render, 'exclude');
    assert.ok(view.edges.some((edge) => edge.relation === 'contains' && edge.source.node_id === explored.understandingRootId && edge.target.node_id === id));
  }
  assert.ok(view.edges.some((edge) => edge.relation === 'refines' && edge.source.node_id === 'life.repair' && edge.target.node_id === 'life.options'));
  const storedDossier = view.nodes.find((node) => node.id === 'life.dossier');
  assert.deepEqual(storedDossier.access_scopes, ['author'], 'public story root cannot publish private proposal values');
  assert.deepEqual(JSON.parse(storedDossier.text).characters[0].trajectoryProposal, dossier.characters[0].trajectoryProposal);
  const publicView = await call(client, 'life_narrative_query', { graphHash: savedLife.graphHash, mode: 'full', includeContent: true, accessScopes: [] });
  assert.deepEqual(publicView.nodes.map((node) => node.id), ['book']);
  const rendered = await call(client, 'life_narrative_render', { graphHash: savedLife.graphHash, rootIds: ['book'], accessScopes: ['author'] });
  assert.equal(rendered.text, '', 'authoring material is excluded from story prose');
});
