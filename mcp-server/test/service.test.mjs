import assert from 'node:assert/strict';
import test from 'node:test';

import { LifeSimulationService, serviceLimits } from '../src/service.mjs';
import { EngineError } from '../src/rust-engine-process.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function fakeBackend(call) {
  return {
    call,
    async initialize() { return {}; },
    async close() {},
    status() { return { persistenceMode: 'volatile-test' }; },
  };
}

function minimalModel(id = 'quota-model') {
  return {
    schema: 'life-sim-rust-model/v1',
    id,
    time_unit: 'day',
    revision: { number: 0, reason: 'quota test', provenance: ['test'] },
    processes: [],
    decomposition: [],
    dependencies: [],
    laws: [],
    initial_claims: [],
  };
}

function minimalCandidateRecord(hash, status = 'pending', rollIndex = 0) {
  return {
    status,
    candidate: {
      candidate_hash: hash,
      parent_world_hash: 'f'.repeat(64),
      expected_parent_version: 0,
      roll_index: rollIndex,
      start_time: 0,
      end_time: 1,
      successor_state: { 'world.value': { kind: 'scalar', value: 0.5 } },
      query: {
        requested_observables: ['world.value'],
        access_scopes: ['public'],
      },
    },
  };
}

test('profile compilation is one read-only Rust call and never registers the returned model', async () => {
  const calls = [];
  const model = minimalModel('compiled-profiles');
  const modelHash = 'c'.repeat(64);
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      assert.equal(operation, 'compile_profiles');
      return {
        summary: { model_hash: modelHash, process_ids: [] },
        model,
        stored: false,
        mutation_performed: false,
      };
    }),
  });
  const profileRequest = {
    schema: 'life-sim-rust-profile-compilation/v1',
    model: {
      id: 'compiled-profiles',
      time_unit: 'day',
      reason: 'service compiler test',
      provenance: ['test'],
    },
    profiles: [{ kind: 'person', profile: { id: 'person' } }],
  };

  const result = await service.compileProfiles({ profileRequest });
  assert.equal(result.valid, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.stored, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.modelHash, modelHash);
  assert.deepEqual(result.model, model);
  assert.deepEqual(result.registrationNextStep, {
    operation: 'registerModel',
    explicit: true,
  });
  assert.equal(service.models.size, 0);
  assert.deepEqual(calls, [{
    operation: 'compile_profiles',
    payload: { profile_request: profileRequest },
  }]);

  await assert.rejects(
    service.compileProfiles({
      profileRequest: { ...profileRequest, schema: 'wrong', profiles: [] },
    }),
    /profileRequest.schema must be life-sim-rust-profile-compilation\/v1/,
  );
  assert.equal(calls.length, 1);
});

test('profile compilation rejects any backend response that claims mutation', async () => {
  const service = new LifeSimulationService({
    backend: fakeBackend(async () => ({
      summary: { model_hash: 'd'.repeat(64), process_ids: [] },
      model: minimalModel('invalid-compiler-boundary'),
      stored: true,
      mutation_performed: false,
    })),
  });
  await assert.rejects(
    service.compileProfiles({
      profileRequest: {
        schema: 'life-sim-rust-profile-compilation/v1',
        model: { id: 'x' },
        profiles: [{ kind: 'story', profile: { id: 'story' } }],
      },
    }),
    /violated its read-only boundary/,
  );
  assert.equal(service.models.size, 0);
});

test('graph queries expose immutable Rust snapshots without requiring a Node graph store', async () => {
  const modelHash = 'a'.repeat(64);
  const snapshotHash = 'b'.repeat(64);
  const calls = [];
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      assert.equal(operation, 'query_graph');
      return {
        schema: 'life-sim-rust-graph/v1',
        mode: payload.graph_query.mode,
        snapshot_hash: snapshotHash,
        source: { kind: 'model', model_hash: modelHash },
      };
    }),
  });

  const result = await service.queryGraph({
    source: { kind: 'model', modelHash },
    mode: 'neighborhood',
    centerNodeId: 'process:actor.want.safety',
    depth: 3,
    direction: 'ancestors',
    includeValues: true,
    accessScopes: ['holder:actor'],
    expectedSnapshotHash: snapshotHash,
  });

  assert.equal(result.snapshot_hash, snapshotHash);
  assert.deepEqual(calls, [{
    operation: 'query_graph',
    payload: {
      model_hash: modelHash,
      graph_query: {
        mode: 'neighborhood',
        include_values: true,
        access_scopes: ['holder:actor'],
        expected_snapshot_hash: snapshotHash,
        center: 'process:actor.want.safety',
        depth: 3,
        direction: 'ancestors',
      },
    },
  }]);
});

test('graph-native story, testimony, rendering, and training stay in the Rust authority', async () => {
  const graphHash = 'a'.repeat(64);
  const nextHash = 'b'.repeat(64);
  const batchHash = 'e'.repeat(64);
  const snapshotHash = 'c'.repeat(64);
  const calls = [];
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'register_narrative_graph') {
        return {
          summary: { graph_hash: graphHash, node_count: 2 },
          snapshot_hash: snapshotHash,
          stored: true,
          reused_existing: false,
        };
      }
      if (operation === 'revise_narrative_graph') {
        return {
          summary: { graph_hash: nextHash, node_count: 2 },
          snapshot_hash: snapshotHash,
          stored: true,
          reused_existing: false,
        };
      }
      if (operation === 'apply_narrative_batch') {
        return {
          summary: { graph_hash: batchHash, node_count: 3, revision: { number: 2 } },
          snapshot_hash: snapshotHash,
          stored: true,
          reused_existing: false,
          batch: { added_root_count: 0, added_node_count: 1, added_edge_count: 1 },
        };
      }
      if (operation === 'query_narrative_graph') {
        return { schema: 'life-sim-rust-narrative-graph-view/v1', mode: 'neighborhood' };
      }
      if (operation === 'render_narrative_graph') {
        return { schema: 'life-sim-rust-narrative-render/v1', text: 'A passage.' };
      }
      if (operation === 'export_narrative_training') {
        return { schema: 'life-sim-rust-narrative-training/v1', record_count: 1 };
      }
      throw new Error(`unexpected ${operation}`);
    }),
  });
  const base = {
    schema: 'life-sim-rust-narrative-graph/v1',
    id: 'story',
    revision: { number: 0, reason: 'test', provenance: ['test'] },
    source: { kind: 'model', model_hash: 'd'.repeat(64) },
    roots: [],
    nodes: [],
    edges: [],
  };
  const registered = await service.registerNarrativeGraph({
    requestId: 'narrative-register',
    narrativeGraph: base,
  });
  assert.equal(registered.graphHash, graphHash);
  assert.equal(registered.snapshotHash, snapshotHash);

  const revisedGraph = {
    ...base,
    revision: {
      number: 1,
      previous_graph_hash: graphHash,
      reason: 'revise',
      provenance: ['test'],
    },
  };
  const revised = await service.reviseNarrativeGraph({
    requestId: 'narrative-revise',
    previousGraphHash: graphHash,
    narrativeGraph: revisedGraph,
  });
  assert.equal(revised.graphHash, nextHash);

  const narrativeBatch = {
    schema: 'life-sim-rust-narrative-batch/v1',
    previous_graph_hash: nextHash,
    reason: 'append one connected node',
    provenance: ['test'],
    add_nodes: [{ id: 'passage-2' }],
    add_edges: [{ id: 'document-contains-passage-2' }],
  };
  const appended = await service.applyNarrativeBatch({
    requestId: 'narrative-batch',
    previousGraphHash: nextHash,
    narrativeBatch,
  });
  assert.equal(appended.graphHash, batchHash);
  assert.equal(appended.previousGraphHash, nextHash);
  assert.equal(appended.additiveBatch, true);
  assert.equal(appended.batch.added_node_count, 1);

  await service.queryNarrativeGraph({
    graphHash,
    mode: 'neighborhood',
    centerNodeId: 'passage',
    depth: 2,
    direction: 'ancestors',
    includeContent: true,
    accessScopes: ['author'],
    expectedGraphHash: graphHash,
  });
  await service.renderNarrativeGraph({
    graphHash,
    rootIds: ['document'],
    accessScopes: ['author'],
    expectedGraphHash: graphHash,
  });
  await service.exportNarrativeTraining({
    graphHash,
    nodeIds: ['passage'],
    accessScopes: ['author'],
    includeLinkedValues: true,
    requireAcceptedHistory: true,
    expectedGraphHash: graphHash,
  });

  assert.deepEqual(calls.map(({ operation }) => operation), [
    'register_narrative_graph',
    'revise_narrative_graph',
    'apply_narrative_batch',
    'query_narrative_graph',
    'render_narrative_graph',
    'export_narrative_training',
  ]);
  assert.deepEqual(calls[2].payload.narrative_batch, narrativeBatch);
  assert.deepEqual(calls[3].payload.narrative_query, {
    mode: 'neighborhood',
    access_scopes: ['author'],
    include_content: true,
    expected_graph_hash: graphHash,
    center_node_id: 'passage',
    depth: 2,
    direction: 'ancestors',
  });
  assert.deepEqual(calls[5].payload.narrative_training, {
    node_ids: ['passage'],
    access_scopes: ['author'],
    include_linked_values: true,
    require_accepted_history: true,
    expected_graph_hash: graphHash,
  });
});

function localWorld(overrides = {}) {
  return {
    id: 'world-test',
    presetId: null,
    modelHash: 'm'.repeat(64),
    processIds: ['world.value'],
    candidateIds: new Map(),
    pendingCandidates: 0,
    candidateViews: new Map(),
    evaluations: [],
    pendingEvaluations: 0,
    receipts: new Map(),
    writerContracts: new Map(),
    pendingWriterContracts: 0,
    writerPlans: new Map(),
    pendingWriterPlans: 0,
    ...overrides,
  };
}

test('genesis refinement is one idempotent MCP control-plane call into Rust', async () => {
  const sourceModelHash = 'a'.repeat(64);
  const targetModelHash = 'b'.repeat(64);
  const calls = [];
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'get_model') {
        assert.equal(payload.model_hash, targetModelHash);
        return { summary: { process_ids: ['world.new-detail', 'world.value'] } };
      }
      if (operation === 'refine_genesis_world') {
        return {
          boundary: 'genesis_only_authored_refinement',
          source_model_hash: sourceModelHash,
          target_model_hash: targetModelHash,
          conservation: {
            world_id_preserved: true,
            old_state_preserved: true,
            old_claims_preserved: true,
            accepted_history_preserved: true,
            monotonic_definition: true,
          },
          records: {
            preserved_records: { processes: 1 },
            added_records: { processes: 1 },
          },
          limitations: [
            'automatic cut or concept discovery is not implemented',
            'post-history model migration is not implemented',
          ],
          world_head: {
            world_id: 'world-test',
            model_hash: targetModelHash,
            version: 0,
            time: 0,
            state: { 'world.new-detail': { kind: 'scalar', value: 0.75 } },
          },
        };
      }
      throw new Error(`Unexpected fake operation ${operation}.`);
    }),
  });
  const world = localWorld({
    modelHash: sourceModelHash,
    presetId: 'north-harbor/12',
  });
  service.worlds.set(world.id, world);
  const input = {
    worldId: world.id,
    requestId: 'refine-once',
    targetModelHash,
    requestedObservables: ['world.new-detail'],
    accessScopes: ['world'],
  };

  const refined = await service.refineGenesisWorld(input);
  assert.equal(refined.boundary, 'genesis_only_authored_refinement');
  assert.equal(refined.sourceModelHash, sourceModelHash);
  assert.equal(refined.targetModelHash, targetModelHash);
  assert.equal(refined.canonical, true);
  assert.equal(refined.automaticDiscoveryPerformed, false);
  assert.equal(refined.postHistoryMigrationPerformed, false);
  assert.equal(refined.records.added_records.processes, 1);
  assert.equal(refined.projection.model_hash, targetModelHash);
  assert.equal(world.modelHash, targetModelHash);
  assert.equal(world.presetId, null);
  assert.deepEqual(world.processIds, ['world.new-detail', 'world.value']);
  assert.deepEqual(calls, [
    { operation: 'get_model', payload: { model_hash: targetModelHash } },
    {
      operation: 'refine_genesis_world',
      payload: {
        world_id: world.id,
        model_hash: targetModelHash,
        view: {
          requested_observables: ['world.new-detail'],
          access_scopes: ['world'],
          include_path: false,
        },
      },
    },
  ]);

  assert.deepEqual(await service.refineGenesisWorld(input), refined);
  assert.equal(calls.length, 2);
  await assert.rejects(
    service.refineGenesisWorld({
      ...input,
      requestedObservables: ['world.value'],
    }),
    /already bound to a different refine-genesis-world payload/,
  );
});

test('trajectory summaries delegate canonical interval analysis to Rust', async () => {
  const calls = [];
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation !== 'summarize_trajectory') {
        throw new Error(`Unexpected fake operation ${operation}.`);
      }
      return {
        schema: 'life-sim-rust-trajectory-summary/v1',
        candidate_hash: payload.candidate_hash,
        summary_hash: 's'.repeat(64),
        fields: [{ process_id: 'world.value', time_mean: 0.5 }],
      };
    }),
  });
  const world = localWorld();
  const candidateHash = 'c'.repeat(64);
  world.candidateIds.set('candidate-test', candidateHash);
  service.worlds.set(world.id, world);

  const result = await service.summarizeTrajectory({
    worldId: world.id,
    candidateId: 'candidate-test',
    startTime: 0.25,
    endTime: 0.75,
    fields: ['world.value'],
    accessScopes: ['public'],
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.summary.summary_hash, 's'.repeat(64));
  assert.deepEqual(calls, [{
    operation: 'summarize_trajectory',
    payload: {
      candidate_hash: candidateHash,
      trajectory_summary: {
        schema: 'life-sim-rust-trajectory-summary-query/v1',
        start_time: 0.25,
        end_time: 0.75,
        fields: ['world.value'],
        access_scopes: ['public'],
      },
    },
  }]);

  await assert.rejects(
    service.summarizeTrajectory({
      worldId: world.id,
      candidateId: 'candidate-test',
      startTime: 1,
      endTime: 1,
      fields: ['world.value'],
    }),
    /endTime after startTime/,
  );
  await assert.rejects(
    service.summarizeTrajectory({
      worldId: world.id,
      candidateId: 'candidate-test',
      startTime: 0,
      endTime: 1,
      fields: [],
    }),
    /at least one process id/,
  );
});

test('Meaning Model query pages exact-id projections from the optional Rust-owned layer', async () => {
  const modelHash = 'a'.repeat(64);
  const model = {
    ...minimalModel('meaning-query-model'),
    processes: [{
      id: 'world.relationship',
      value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 },
      uncertainty: { kind: 'exact' },
      provenance: ['test'],
      support: ['world'],
      access_scopes: ['public'],
    }],
    meaning_model: {
      schema: 'life-sim-rust-meaning-model/v1',
      concepts: [
        { id: 'concept.care', provenance: ['test'] },
        { id: 'concept.relationship', provenance: ['test'] },
        { id: 'concept.trust', provenance: ['test'] },
      ],
      abstract_relations: [{
        id: 'abstract-relation.trust-specializes-relationship',
        source_concept_id: 'concept.relationship',
        target_concept_id: 'concept.trust',
        kind: 'specialization',
        provenance: ['test'],
      }],
      abstract_cuts: [{
        id: 'abstract-cut.relationship',
        parent_concept_id: 'concept.relationship',
        child_concept_ids: ['concept.care', 'concept.trust'],
        lens: 'relational',
        provenance: ['test'],
      }],
      referents: [
        {
          id: 'referent.relationship',
          boundary: 'the bounded relationship and its participants',
          continuity_criterion: 'the same relationship across the modeled interval',
          provenance: ['test'],
        },
        {
          id: 'referent.partner',
          boundary: 'one partner participating in the relationship',
          continuity_criterion: 'the same participant across the modeled interval',
          provenance: ['test'],
        },
      ],
      encapsulation_cuts: [{
        id: 'encapsulation-cut.relationship-members',
        parent_referent_id: 'referent.relationship',
        children: [{
          relation: 'member',
          referent_id: 'referent.partner',
          provenance: ['test'],
        }],
        lens: 'participants',
        provenance: ['test'],
      }],
      events: [
        {
          id: 'event.commitment',
          boundary: 'commitment within the relationship',
          process_ids: ['world.relationship'],
          provenance: ['test'],
        },
        {
          id: 'event.relationship',
          boundary: 'the bounded relationship history',
          interval: { start: 0, end: 1 },
          process_ids: ['world.relationship'],
          observation_process_ids: ['world.relationship'],
          participants: { partners: 'pair' },
          provenance: ['test'],
        },
        {
          id: 'event.repair',
          boundary: 'repair within the relationship',
          process_ids: ['world.relationship'],
          provenance: ['test'],
        },
      ],
      event_relations: [{
        id: 'event-relation.repair-enables-commitment',
        source_event_id: 'event.repair',
        target_event_id: 'event.commitment',
        kind: 'enables',
        description: 'repair makes renewed commitment possible',
        uncertainty: { kind: 'unknown' },
        provenance: ['test'],
        authority: { source: 'test-author', weight: 0.8 },
      }],
      event_referent_bindings: [{
        id: 'event-referent-binding.relationship-subject',
        target: { kind: 'event', event_id: 'event.relationship' },
        role: 'subject',
        referent_id: 'referent.relationship',
        binding_type: 'participant',
        provenance: ['test'],
      }],
      physical_cuts: [{
        id: 'physical-cut.relationship-sequence',
        parent_event_id: 'event.relationship',
        child_event_ids: ['event.repair', 'event.commitment'],
        kind: 'sequential',
        lens: 'repair sequence',
        provenance: ['test'],
      }],
      realizations: [{
        id: 'realization.trust-description',
        concept_id: 'concept.trust',
        purpose: 'describe',
        roles: { relationship: 'event.relationship' },
        parameters: {},
        degree: 0.8,
        uncertainty: { kind: 'exact' },
        provenance: ['test'],
        viewpoint: 'observer',
      }],
    },
  };
  const calls = [];
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'get_model') {
        return { model, summary: { model_hash: modelHash } };
      }
      throw new Error(`Unexpected fake operation ${operation}.`);
    }),
  });

  const firstPage = await service.queryMeaningModel({ modelHash, limit: 3 });
  assert.equal(firstPage.meaningModel.enabled, true);
  assert.equal(firstPage.meaningModel.layerSchema, 'life-sim-rust-meaning-model/v1');
  assert.deepEqual(firstPage.meaningModel.collectionCounts, {
    concepts: 3,
    abstract_relations: 1,
    abstract_cuts: 1,
    referents: 2,
    encapsulation_cuts: 1,
    events: 3,
    event_relations: 1,
    event_referent_bindings: 1,
    physical_cuts: 1,
    realizations: 1,
  });
  assert.equal(firstPage.meaningModel.totalRecordCount, 15);
  assert.deepEqual(firstPage.query.collections, [
    'concepts',
    'abstract_relations',
    'abstract_cuts',
    'referents',
    'encapsulation_cuts',
    'events',
    'event_relations',
    'event_referent_bindings',
    'physical_cuts',
    'realizations',
  ]);
  assert.equal(firstPage.matchedCount, 15);
  assert.equal(firstPage.returnedCount, 3);
  assert.equal(firstPage.nextOffset, 3);
  assert.deepEqual(
    firstPage.items.map(({ collection, definition }) => [collection, definition.id]),
    [
      ['concepts', 'concept.care'],
      ['concepts', 'concept.relationship'],
      ['concepts', 'concept.trust'],
    ],
  );

  const secondPage = await service.queryMeaningModel({
    modelHash,
    offset: firstPage.nextOffset,
    limit: 3,
  });
  assert.equal(secondPage.nextOffset, 6);
  assert.deepEqual(
    secondPage.items.map(({ collection, definition }) => [collection, definition.id]),
    [
      ['abstract_relations', 'abstract-relation.trust-specializes-relationship'],
      ['abstract_cuts', 'abstract-cut.relationship'],
      ['referents', 'referent.relationship'],
    ],
  );

  const referential = await service.queryMeaningModel({
    modelHash,
    collections: ['referents', 'encapsulation_cuts', 'event_referent_bindings'],
    ids: [
      'referent.partner',
      'encapsulation-cut.relationship-members',
      'event-referent-binding.relationship-subject',
    ],
    offset: 0,
    limit: 10,
  });
  assert.equal(referential.matchedCount, 3);
  assert.deepEqual(
    referential.items.map(({ collection, definition }) => [collection, definition.id]),
    [
      ['referents', 'referent.partner'],
      ['encapsulation_cuts', 'encapsulation-cut.relationship-members'],
      [
        'event_referent_bindings',
        'event-referent-binding.relationship-subject',
      ],
    ],
  );

  const exact = await service.queryMeaningModel({
    modelHash,
    collections: ['events', 'event_relations', 'physical_cuts', 'realizations'],
    ids: [
      'event-relation.repair-enables-commitment',
      'physical-cut.relationship-sequence',
      'realization.trust-description',
    ],
    offset: 0,
    limit: 10,
  });
  assert.equal(exact.matchedCount, 3);
  assert.equal(exact.truncated, false);
  assert.deepEqual(
    exact.items.map(({ collection, definition }) => [collection, definition.id]),
    [
      ['event_relations', 'event-relation.repair-enables-commitment'],
      ['physical_cuts', 'physical-cut.relationship-sequence'],
      ['realizations', 'realization.trust-description'],
    ],
  );
  assert.deepEqual(
    exact.items[1].definition.child_event_ids,
    ['event.repair', 'event.commitment'],
  );
  exact.items[1].definition.child_event_ids.reverse();
  assert.deepEqual(
    model.meaning_model.physical_cuts[0].child_event_ids,
    ['event.repair', 'event.commitment'],
  );
  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ['get_model', 'get_model', 'get_model', 'get_model'],
  );

  await assert.rejects(
    service.queryMeaningModel({
      modelHash,
      collections: ['events', 'events'],
    }),
    /must not repeat events/,
  );
  await assert.rejects(
    service.queryMeaningModel({ modelHash, limit: 251 }),
    /limit.*at most 250/,
  );
  await assert.rejects(
    service.queryMeaningModel({
      modelHash,
      ids: Array.from({ length: 257 }, (_, index) => `concept.${index}`),
    }),
    /ids.*at most 256/,
  );
});

test('Meaning Model query is explicitly disabled for legacy models', async () => {
  const modelHash = 'b'.repeat(64);
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation) => {
      if (operation === 'get_model') {
        return { model: minimalModel('legacy-model'), summary: { model_hash: modelHash } };
      }
      throw new Error(`Unexpected fake operation ${operation}.`);
    }),
  });
  const result = await service.queryMeaningModel({ modelHash });
  assert.equal(result.meaningModel.enabled, false);
  assert.equal(result.meaningModel.totalRecordCount, 0);
  assert.deepEqual(result.meaningModel.collectionCounts, {
    concepts: 0,
    abstract_relations: 0,
    abstract_cuts: 0,
    referents: 0,
    encapsulation_cuts: 0,
    events: 0,
    event_relations: 0,
    event_referent_bindings: 0,
    physical_cuts: 0,
    realizations: 0,
  });
  assert.equal(result.matchedCount, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.nextOffset, null);
});

test('MCP service can roll, observe, reroll, compare, annotate, and atomically accept in Rust', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  const created = await service.createWorld({ requestId: 'create-1', presetId: 'north-harbor/12' });
  const retriedCreate = await service.createWorld({ requestId: 'create-1', presetId: 'north-harbor/12' });
  assert.deepEqual(retriedCreate, created);

  const first = await service.rollCandidate({
    worldId: created.worldId,
    requestId: 'roll-1',
    seed: 'mcp-service-test',
  });
  assert.equal(first.canonical, false);
  assert.equal('storeChanged' in first, false);
  assert.equal(first.candidateStoreChanged, true);
  assert.equal(first.acceptedHeadChanged, false);
  assert.equal(first.reusedExisting, false);
  const reusedFirst = await service.rollCandidate({
    worldId: created.worldId,
    requestId: 'roll-1-deterministic-collision',
    seed: 'mcp-service-test',
  });
  assert.equal(reusedFirst.candidateId, first.candidateId);
  assert.equal(reusedFirst.candidateStoreChanged, false);
  assert.equal(reusedFirst.acceptedHeadChanged, false);
  assert.equal(reusedFirst.reusedExisting, true);
  assert.equal((await service.inspectWorld({ worldId: created.worldId })).headVersion, 0);

  const observation = await service.observeCandidate({
    worldId: created.worldId,
    candidateId: first.candidateId,
    fieldPrefixes: ['person.'],
  });
  assert.equal(observation.proseGenerated, false);
  assert.ok(observation.selectedFieldCount > 100);

  const second = await service.rerollCandidate({
    worldId: created.worldId,
    candidateId: first.candidateId,
    requestId: 'reroll-1',
  });
  assert.equal(second.parentHash, first.parentHash);
  assert.equal(second.rollIndex, 1);
  assert.equal(second.candidateStoreChanged, true);
  assert.equal(second.acceptedHeadChanged, false);
  assert.equal(second.reusedExisting, false);
  const comparison = await service.compareCandidates({
    worldId: created.worldId,
    firstCandidateId: first.candidateId,
    secondCandidateId: second.candidateId,
  });
  assert.equal(comparison.sameFrozenParent, true);
  assert.ok(comparison.changedFieldCount > comparison.totalFieldCount * 0.95);

  const path = await service.queryTrajectory({
    worldId: created.worldId,
    candidateId: first.candidateId,
    fieldPrefixes: ['world.'],
    maxFields: 10,
  });
  assert.equal(path.fieldIds.length, 8);
  assert.ok(path.samples.length >= 2);

  const annotation = await service.annotateCandidate({
    worldId: created.worldId,
    candidateId: first.candidateId,
    requestId: 'annotation-1',
    verdict: 'uncertain',
    issues: [{ code: 'small-spread', explanation: 'Aggregate reroll spread is narrow.' }],
  });
  assert.equal(annotation.canonicalWorldMutation, false);
  await assert.rejects(
    service.annotateCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      requestId: 'x'.repeat(257),
      verdict: 'uncertain',
      issues: [],
    }),
    /requestId.*at most 256/,
  );
  await assert.rejects(
    service.annotateCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      requestId: 'annotation-too-many-issues',
      verdict: 'uncertain',
      issues: Array.from({ length: 101 }, () => ({ code: 'test', explanation: 'test' })),
    }),
    /issues.*at most 100/,
  );
  await assert.rejects(
    service.annotateCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      requestId: 'annotation-long-code',
      verdict: 'uncertain',
      issues: [{ code: 'x'.repeat(129), explanation: 'test' }],
    }),
    /code.*at most 128/,
  );
  await assert.rejects(
    service.annotateCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      requestId: 'annotation-long-explanation',
      verdict: 'uncertain',
      issues: [{ code: 'test', explanation: 'x'.repeat(2_001) }],
    }),
    /explanation.*at most 2000/,
  );
  await assert.rejects(
    service.annotateCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      requestId: 'annotation-byte-budget',
      verdict: 'uncertain',
      issues: Array.from({ length: 40 }, (_, index) => ({
        fieldId: `person.p${index}.stress`,
        code: 'large-test',
        explanation: 'x'.repeat(2_000),
      })),
    }),
    /annotation limit is 65536/,
  );
  await assert.rejects(
    service.observeCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      fieldPrefixes: ['x'.repeat(257)],
    }),
    /fieldPrefixes\[0\].*at most 256/,
  );
  await assert.rejects(
    service.rerollCandidate({
      worldId: created.worldId,
      candidateId: 'x'.repeat(257),
      requestId: 'oversized-candidate-handle',
    }),
    /candidateId.*at most 256/,
  );

  const accepted = await service.acceptCandidate({
    worldId: created.worldId,
    candidateId: second.candidateId,
    requestId: 'accept-1',
    expectedParentHash: first.parentHash,
  });
  assert.equal(accepted.canonical, true);
  assert.equal(accepted.headVersion, 1);
  assert.equal(accepted.candidateStoreChanged, true);
  assert.equal(accepted.acceptedHeadChanged, true);
  assert.equal(accepted.reusedExisting, false);

  const writerContract = await service.createWriterContract({
    worldId: created.worldId,
    candidateId: second.candidateId,
    requestId: 'writer-contract-1',
    brief: 'Write a short aftermath scene without contradicting the accepted state.',
    fields: [
      { fieldId: 'person.p00.stress', status: 'hard', causallyRelevant: true },
      { fieldId: 'person.p00.openness', status: 'renegotiable', causallyRelevant: true },
      { fieldId: 'world.ambient_heat', status: 'optional', causallyRelevant: false },
    ],
  });
  const graphWriterContract = await service.createWriterContract({
    worldId: created.worldId,
    candidateId: second.candidateId,
    requestId: 'writer-contract-graph',
    brief: 'Write with a persistent whole-world orientation and a focused causal view.',
    fields: [
      { fieldId: 'person.p00.stress', status: 'hard', causallyRelevant: true },
      { fieldId: 'person.p00.openness', status: 'soft', causallyRelevant: true },
    ],
    graph: {
      focusFieldId: 'person.p00.stress',
      depth: 1,
      direction: 'ancestors',
      accessScopes: ['world'],
    },
  });
  assert.equal(graphWriterContract.schema, 'life-sim-writer-contract/v2');
  assert.equal(graphWriterContract.graphContext.globalSkeleton.mode, 'skeleton');
  assert.equal(graphWriterContract.graphContext.activeSlice.mode, 'neighborhood');
  assert.ok(graphWriterContract.graphContext.activeSlice.returned_node_count > 0);
  assert.equal(
    graphWriterContract.graphContext.snapshotHash,
    graphWriterContract.graphContext.activeSlice.snapshot_hash,
  );
  assert.equal(graphWriterContract.graphContext.wholeGraphAccess.mode, 'full');
  await assert.rejects(
    service.createWriterContract({
      worldId: created.worldId,
      candidateId: second.candidateId,
      requestId: 'writer-contract-graph',
      brief: 'Write with a persistent whole-world orientation and a focused causal view.',
      fields: [
        { fieldId: 'person.p00.stress', status: 'hard', causallyRelevant: true },
        { fieldId: 'person.p00.openness', status: 'soft', causallyRelevant: true },
      ],
      graph: {
        focusFieldId: 'person.p00.openness',
        depth: 1,
        direction: 'descendants',
        accessScopes: ['world'],
      },
    }),
    /requestId writer-contract-graph is already bound to a different create-writer-contract payload/,
  );
  const retainedWorld = service.getWorld(created.worldId);
  const contractCountBeforeOversize = retainedWorld.writerContracts.size;
  await assert.rejects(
    service.createWriterContract({
      worldId: created.worldId,
      candidateId: second.candidateId,
      requestId: 'writer-contract-oversized-utf8',
      brief: 'Oversized contract must fail before mutation.',
      fields: Array.from({ length: 100 }, (_, index) => ({
        fieldId: `${index}.${'漢'.repeat(1_000)}`,
        status: 'soft',
        causallyRelevant: true,
      })),
    }),
    /writer contract input.*UTF-8 bytes.*limit is 98304/,
  );
  assert.equal(retainedWorld.writerContracts.size, contractCountBeforeOversize);
  const planCountBeforeOversize = retainedWorld.writerPlans.size;
  await assert.rejects(
    service.evaluateWriterPlan({
      worldId: created.worldId,
      contractId: writerContract.contractId,
      requestId: 'writer-plan-oversized-utf8',
      dispositions: Array.from({ length: 100 }, (_, index) => ({
        fieldId: `field.${index}`,
        disposition: 'implicit_adherence',
        explanation: '漢'.repeat(2_000),
      })),
    }),
    /writer plan input.*UTF-8 bytes.*limit is 98304/,
  );
  assert.equal(retainedWorld.writerPlans.size, planCountBeforeOversize);
  const writerPlan = await service.evaluateWriterPlan({
    worldId: created.worldId,
    contractId: writerContract.contractId,
    requestId: 'writer-plan-1',
    dispositions: [
      { fieldId: 'person.p00.stress', disposition: 'implicit_adherence' },
      { fieldId: 'person.p00.openness', disposition: 'explicit_dramatization' },
      { fieldId: 'world.ambient_heat', disposition: 'omit_surface_prose' },
    ],
  });
  assert.equal(writerPlan.renderable, true);
  assert.equal(writerPlan.canonicalWorldMutation, false);
  const revisionPlan = await service.evaluateWriterPlan({
    worldId: created.worldId,
    contractId: writerContract.contractId,
    requestId: 'writer-plan-revise',
    dispositions: [
      { fieldId: 'person.p00.stress', disposition: 'implicit_adherence' },
      { fieldId: 'person.p00.openness', disposition: 'request_profile_revision' },
      { fieldId: 'world.ambient_heat', disposition: 'omit_surface_prose' },
    ],
  });
  assert.equal(revisionPlan.renderable, false);
  assert.equal(revisionPlan.revisionRequests.length, 1);
  assert.equal(
    (await service.inspectWorld({ worldId: created.worldId })).headHash,
    accepted.headHash,
  );
  assert.deepEqual(
    await service.acceptCandidate({
      worldId: created.worldId,
      candidateId: second.candidateId,
      requestId: 'accept-1',
      expectedParentHash: first.parentHash,
    }),
    accepted,
  );
  await assert.rejects(
    service.acceptCandidate({
      worldId: created.worldId,
      candidateId: first.candidateId,
      requestId: 'accept-stale',
      expectedParentHash: first.parentHash,
    }),
    /does not match|stale/,
  );
});

test('generic typed models are validated, registered, inspected, revised, and rolled by Rust', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  const initialModel = {
    schema: 'life-sim-rust-model/v1',
    id: 'generic-mcp-test',
    time_unit: 'day',
    revision: {
      number: 0,
      reason: 'Initial generic MCP model.',
      provenance: ['mcp-server test'],
    },
    processes: [{
      id: 'world.pressure',
      value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.2 },
      uncertainty: { kind: 'exact' },
      provenance: ['mcp-server test'],
      unit: 'normalized',
      support: ['world'],
      access_scopes: ['public'],
    }],
    decomposition: [],
    dependencies: [],
    laws: [{
      id: 'pressure-growth',
      operator: {
        role: 'evolution',
        target: 'world.pressure',
        derivative: { op: 'constant', value: 0.1 },
      },
      provenance: ['mcp-server test'],
    }],
    initial_claims: [],
    meaning_model: {
      schema: 'life-sim-rust-meaning-model/v1',
      concepts: [{
        id: 'concept.pressure',
        label: 'Pressure',
        provenance: ['mcp-server test'],
      }],
      events: [{
        id: 'event.pressure',
        boundary: 'bounded pressure trajectory',
        process_ids: ['world.pressure'],
        observation_process_ids: ['world.pressure'],
        provenance: ['mcp-server test'],
      }],
      realizations: [{
        id: 'realization.pressure-description',
        concept_id: 'concept.pressure',
        purpose: 'describe',
        roles: { subject: 'event.pressure' },
        degree: 1,
        uncertainty: { kind: 'exact' },
        provenance: ['mcp-server test'],
        viewpoint: 'model',
      }],
    },
  };
  const validation = await service.validateModel({ model: initialModel });
  assert.equal(validation.valid, true);
  assert.equal(validation.stored, false);
  assert.equal(validation.modelHash.length, 64);
  assert.equal(validation.summary.meaning_model.concept_count, 1);
  assert.equal(validation.summary.meaning_model.referent_count, 0);
  assert.equal(validation.summary.meaning_model.encapsulation_cut_count, 0);
  assert.equal(validation.summary.meaning_model.event_count, 1);
  assert.equal(validation.summary.meaning_model.event_relation_count, 0);
  assert.equal(validation.summary.meaning_model.event_referent_binding_count, 0);
  assert.equal(validation.summary.meaning_model.realization_count, 1);

  const registered = await service.registerModel({
    requestId: 'register-generic',
    model: initialModel,
  });
  assert.equal(registered.stored, true);
  assert.match(registered.requestPayloadHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(registered.summary.meaning_model, {
    schema: 'life-sim-rust-meaning-model/v1',
    concept_count: 1,
    abstract_relation_count: 0,
    abstract_cut_count: 0,
    referent_count: 0,
    encapsulation_cut_count: 0,
    event_count: 1,
    event_relation_count: 0,
    event_referent_binding_count: 0,
    physical_cut_count: 0,
    realization_count: 1,
  });
  const sameModelWithReorderedTopLevelKeys = Object.fromEntries(
    Object.entries(initialModel).reverse(),
  );
  assert.deepEqual(
    await service.registerModel({
      requestId: 'register-generic',
      model: sameModelWithReorderedTopLevelKeys,
    }),
    registered,
  );
  const conflictingModel = structuredClone(initialModel);
  conflictingModel.id = 'conflicting-request-payload';
  await assert.rejects(
    service.registerModel({
      requestId: 'register-generic',
      model: conflictingModel,
    }),
    /already bound to a different register-model payload/,
  );
  const inspected = await service.inspectModel({
    modelHash: registered.modelHash,
    includeDefinition: true,
  });
  assert.equal(inspected.model.id, 'generic-mcp-test');
  assert.equal(inspected.summary.process_count, 1);
  assert.equal(inspected.model.meaning_model.schema, 'life-sim-rust-meaning-model/v1');
  const meaning = await service.queryMeaningModel({
    modelHash: registered.modelHash,
    collections: ['concepts', 'events', 'realizations'],
  });
  assert.equal(meaning.meaningModel.enabled, true);
  assert.equal(meaning.meaningModel.collectionCounts.referents, 0);
  assert.equal(meaning.meaningModel.collectionCounts.encapsulation_cuts, 0);
  assert.equal(meaning.meaningModel.collectionCounts.event_referent_bindings, 0);
  assert.deepEqual(
    meaning.items.map(({ collection, definition }) => [collection, definition.id]),
    [
      ['concepts', 'concept.pressure'],
      ['events', 'event.pressure'],
      ['realizations', 'realization.pressure-description'],
    ],
  );

  const revisedModel = structuredClone(initialModel);
  revisedModel.revision = {
    number: 1,
    previous_model_hash: registered.modelHash,
    reason: 'Add a derived dimension and law.',
    provenance: ['mcp-server test'],
  };
  revisedModel.processes.push({
    id: 'world.pressure_signal',
    value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
    initial_value: { kind: 'scalar', value: 0.2 },
    uncertainty: { kind: 'unknown' },
    provenance: ['mcp-server test'],
    support: ['world'],
    access_scopes: ['public'],
  });
  revisedModel.laws.push({
    id: 'derive-pressure-signal',
    operator: {
      role: 'relation',
      target: 'world.pressure_signal',
      value: { op: 'process', process: 'world.pressure' },
    },
    provenance: ['mcp-server test'],
  });
  revisedModel.dependencies.push({
    id: 'pressure-derives-signal',
    source: 'world.pressure',
    target: 'world.pressure_signal',
    kind: 'derives',
    law_id: 'derive-pressure-signal',
  });
  revisedModel.meaning_model.referents = [
    {
      id: 'referent.pressure-system',
      boundary: 'the bounded pressure-bearing system',
      continuity_criterion: 'the same modeled system across the revision interval',
      provenance: ['mcp-server test'],
    },
    {
      id: 'referent.sensor',
      boundary: 'the sensor observing the pressure-bearing system',
      continuity_criterion: 'the same instrument across the revision interval',
      provenance: ['mcp-server test'],
    },
  ];
  revisedModel.meaning_model.encapsulation_cuts = [{
    id: 'encapsulation-cut.pressure-instrumentation',
    parent_referent_id: 'referent.pressure-system',
    children: [{
      relation: 'instrument',
      referent_id: 'referent.sensor',
      provenance: ['mcp-server test'],
    }],
    lens: 'instrumentation',
    provenance: ['mcp-server test'],
  }];
  revisedModel.meaning_model.event_referent_bindings = [{
    id: 'event-referent-binding.pressure-subject',
    target: { kind: 'process', process_id: 'world.pressure' },
    role: 'subject',
    referent_id: 'referent.pressure-system',
    binding_type: 'state-bearing-subject',
    provenance: ['mcp-server test'],
  }];
  const revised = await service.reviseModel({
    requestId: 'revise-generic',
    previousModelHash: registered.modelHash,
    model: revisedModel,
  });
  assert.notEqual(revised.modelHash, registered.modelHash);
  assert.equal(revised.atomicCompleteModelRevision, true);
  assert.equal(revised.summary.meaning_model.referent_count, 2);
  assert.equal(revised.summary.meaning_model.encapsulation_cut_count, 1);
  assert.equal(revised.summary.meaning_model.event_referent_binding_count, 1);

  const referentialRevision = await service.queryMeaningModel({
    modelHash: revised.modelHash,
    collections: ['referents', 'encapsulation_cuts', 'event_referent_bindings'],
  });
  assert.deepEqual(
    referentialRevision.items.map(({ collection, definition }) => [
      collection,
      definition.id,
    ]),
    [
      ['referents', 'referent.pressure-system'],
      ['referents', 'referent.sensor'],
      ['encapsulation_cuts', 'encapsulation-cut.pressure-instrumentation'],
      [
        'event_referent_bindings',
        'event-referent-binding.pressure-subject',
      ],
    ],
  );
  assert.deepEqual(
    referentialRevision.items.at(-1).definition.target,
    { kind: 'process', process_id: 'world.pressure' },
  );

  const world = await service.createWorld({
    requestId: 'generic-world',
    modelHash: revised.modelHash,
  });
  const emptyView = await service.queryView({ worldId: world.worldId });
  assert.equal(emptyView.accessEnforcement, 'Rust model view');
  assert.deepEqual(emptyView.projection.state, {});
  const initialView = await service.queryView({
    worldId: world.worldId,
    requestedObservables: ['world.pressure', 'world.pressure_signal'],
    accessScopes: ['public'],
  });
  assert.deepEqual(
    Object.keys(initialView.projection.state),
    ['world.pressure', 'world.pressure_signal'],
  );
  await assert.rejects(
    service.queryView({
      worldId: world.worldId,
      requestedObservables: ['world.pressure'],
      accessScopes: ['unrelated-scope'],
    }),
    /lacks an access scope/,
  );
  const validGenericQuery = {
    schema: 'life-sim-rust-model-query/v1',
    delta_time: 1,
    step_size: 0.25,
    seed: 'generic-model-test',
    requested_observables: ['world.pressure'],
    access_scopes: ['public'],
    path: { mode: 'full' },
  };
  const invalidQueries = [
    { ...validGenericQuery, delta_time: 31 },
    { ...validGenericQuery, step_size: 31 },
    {
      ...validGenericQuery,
      requested_observables: Array.from({ length: 2_049 }, (_, index) => `field.${index}`),
    },
    {
      ...validGenericQuery,
      selected_support: Array.from({ length: 2_049 }, (_, index) => `support.${index}`),
    },
    {
      ...validGenericQuery,
      access_scopes: Array.from({ length: 65 }, (_, index) => `scope.${index}`),
    },
    {
      ...validGenericQuery,
      interventions: Array.from({ length: 1_001 }, (_, index) => ({
        id: `intervention.${index}`,
        offset: 0.5,
        effect: {
          target: 'world.pressure',
          mode: 'set',
          value: { op: 'constant', value: 0.5 },
        },
      })),
    },
    {
      ...validGenericQuery,
      observations: Array.from({ length: 1_001 }, (_, index) => ({ id: `sample.${index}` })),
    },
    { ...validGenericQuery, seed: '' },
    { ...validGenericQuery, seed: 'x'.repeat(1_025) },
    { ...validGenericQuery, roll_index: -1 },
    { ...validGenericQuery, path: { mode: 'decimated', every: 0 } },
    { ...validGenericQuery, path: { mode: 'unknown' } },
  ];
  for (const [index, query] of invalidQueries.entries()) {
    await assert.rejects(
      service.rollCandidate({
        worldId: world.worldId,
        requestId: `invalid-generic-query-${index}`,
        query,
      }),
      /query\.|query |at most|simulated interval/,
    );
  }

  const candidate = await service.rollCandidate({
    worldId: world.worldId,
    requestId: 'generic-roll',
    query: validGenericQuery,
  });
  assert.equal(candidate.candidateStoreChanged, true);
  assert.equal(candidate.acceptedHeadChanged, false);
  assert.equal(candidate.reusedExisting, false);
  const candidateView = await service.queryView({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    requestedObservables: ['world.pressure'],
    accessScopes: ['public'],
    includePath: false,
  });
  assert.deepEqual(
    Object.keys(candidateView.projection.candidate.successor_state),
    ['world.pressure'],
  );
  assert.equal(candidateView.projection.candidate.path.samples.length, 0);
  const projectedObservation = await service.observeCandidate({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    fieldPrefixes: ['world.'],
  });
  assert.equal(projectedObservation.selectedFieldCount, 1);
  const trajectory = await service.queryTrajectory({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    maxFields: 10,
  });
  assert.deepEqual(trajectory.fieldIds, ['world.pressure']);
  assert.equal(trajectory.query.requested_observables.length, 1);
  assert.ok(trajectory.samples.at(-1).values['world.pressure'] > 0.2);
  const trajectorySummary = await service.summarizeTrajectory({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    startTime: 0.125,
    endTime: 0.875,
    fields: ['world.pressure'],
    accessScopes: ['public'],
  });
  assert.equal(trajectorySummary.summary.schema, 'life-sim-rust-trajectory-summary/v1');
  assert.equal(trajectorySummary.summary.fields[0].process_id, 'world.pressure');
  assert.ok(Number.isFinite(trajectorySummary.summary.fields[0].integral));
  assert.equal(trajectorySummary.readOnly, true);
  const rejected = await service.rejectCandidate({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    requestId: 'reject-generic',
  });
  assert.equal(rejected.rejected, true);
  assert.equal(rejected.authority, 'rejected-candidate');
  assert.equal(rejected.candidateStoreChanged, true);
  assert.equal(rejected.acceptedHeadChanged, false);
  assert.equal(rejected.reusedExisting, false);
  const rejectedAgain = await service.rejectCandidate({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    requestId: 'reject-generic-again',
  });
  assert.equal(rejectedAgain.candidateStoreChanged, false);
  assert.equal(rejectedAgain.acceptedHeadChanged, false);
  assert.equal(rejectedAgain.reusedExisting, false);
  assert.equal((await service.inspectWorld({ worldId: world.worldId })).headVersion, 0);
});

test('generic MCP queries ingest a lawless observed series into Rust lineage', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  const provenance = ['MCP observed-series integration test'];
  const model = {
    schema: 'life-sim-rust-model/v1',
    id: 'mcp-observed-series',
    time_unit: 'hour',
    revision: { number: 0, reason: 'Observed-series test.', provenance },
    processes: [
      {
        id: 'sensor.temperature',
        value_type: { kind: 'scalar', bounds: { minimum: -100, maximum: 100 } },
        initial_value: { kind: 'scalar', value: 10 },
        uncertainty: { kind: 'unknown' },
        provenance,
        unit: 'celsius',
        support: ['sensor'],
        access_scopes: ['public'],
        update_mode: 'observed',
      },
      {
        id: 'sensor.double_temperature',
        value_type: { kind: 'scalar', bounds: { minimum: -200, maximum: 200 } },
        initial_value: { kind: 'scalar', value: 20 },
        uncertainty: { kind: 'unknown' },
        provenance,
        unit: 'derived-celsius',
        support: ['sensor'],
        access_scopes: ['public'],
      },
    ],
    decomposition: [],
    dependencies: [{
      id: 'temperature-derives-double',
      source: 'sensor.temperature',
      target: 'sensor.double_temperature',
      kind: 'derives',
      law_id: 'derive-double-temperature',
    }],
    laws: [{
      id: 'derive-double-temperature',
      operator: {
        role: 'relation',
        target: 'sensor.double_temperature',
        value: {
          op: 'multiply',
          factors: [
            { op: 'constant', value: 2 },
            { op: 'process', process: 'sensor.temperature' },
          ],
        },
      },
      provenance,
    }],
    initial_claims: [],
  };
  const registered = await service.registerModel({
    requestId: 'register-observed-series',
    model,
  });
  const world = await service.createWorld({
    requestId: 'create-observed-series',
    modelHash: registered.modelHash,
  });
  const observation = (id, offset, value) => ({
    id,
    target: 'sensor.temperature',
    offset,
    value: { kind: 'scalar', value },
    unit: 'celsius',
    uncertainty: { kind: 'standard_deviation', value: 0.25 },
    evidence_type: 'observation',
    holder: 'sensor-operator',
    provenance: ['calibrated sensor feed'],
    authority: { source: 'sensor-A', weight: 0.9 },
  });
  const candidate = await service.rollCandidate({
    worldId: world.worldId,
    requestId: 'roll-observed-series',
    query: {
      schema: 'life-sim-rust-model-query/v1',
      delta_time: 2,
      step_size: 0.5,
      seed: 'observed-series-mcp',
      requested_observables: ['sensor.temperature', 'sensor.double_temperature'],
      access_scopes: ['public'],
      observations: [observation('first', 0.5, 20), observation('second', 1.5, 40)],
      path: { mode: 'full' },
    },
  });
  const trajectory = await service.queryTrajectory({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    maxFields: 10,
  });
  assert.deepEqual(
    trajectory.samples.map(({ values }) => values['sensor.temperature']),
    [10, 20, 20, 40, 40],
  );
  assert.deepEqual(
    trajectory.samples.map(({ values }) => values['sensor.double_temperature']),
    [20, 40, 40, 80, 80],
  );
  const candidateView = await service.queryView({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    requestedObservables: ['sensor.temperature', 'sensor.double_temperature'],
    accessScopes: ['public'],
  });
  const claims = Object.values(candidateView.projection.candidate.successor_claims);
  assert.equal(claims.length, 2);
  assert.ok(claims.every((claim) => claim.mode === 'observed'));
  assert.deepEqual(claims.map((claim) => claim.value_time).sort(), [0.5, 1.5]);

  const accepted = await service.acceptCandidate({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    requestId: 'accept-observed-series',
    expectedParentHash: candidate.parentHash,
  });
  assert.equal(accepted.canonical, true);
  const acceptedView = await service.queryView({
    worldId: world.worldId,
    requestedObservables: ['sensor.temperature', 'sensor.double_temperature'],
    accessScopes: ['public'],
  });
  assert.equal(acceptedView.projection.state['sensor.temperature'].value, 40);
  assert.equal(Object.keys(acceptedView.projection.claims).length, 2);
});

test('request ids bind canonical payload hashes across model, world, and candidate calls', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await assert.rejects(
    service.createWorld({ requestId: 'retry-after-failure', presetId: '../../secret' }),
    /Unsupported presetId/,
  );
  const recoveredWorld = await service.createWorld({
    requestId: 'retry-after-failure',
    presetId: 'north-harbor/12',
  });
  assert.match(recoveredWorld.worldId, /^world_/);

  const world = await service.createWorld({ requestId: 'create-2' });
  await assert.rejects(
    service.rollCandidate({
      worldId: world.worldId,
      requestId: 'oversized-preset-duration',
      deltaTime: 31,
    }),
    /deltaTime must be positive, finite, and at most 30/,
  );
  const retriedWorld = await service.createWorld({
    requestId: 'create-2',
    presetId: null,
    modelHash: null,
  });
  assert.deepEqual(retriedWorld, world);
  assert.match(world.requestPayloadHash, /^[a-f0-9]{64}$/);
  await assert.rejects(
    service.createWorld({ requestId: 'create-2', presetId: 'north-harbor/48' }),
    /already bound to a different create-world payload/,
  );

  const first = await service.rollCandidate({ worldId: world.worldId, requestId: 'same-roll' });
  const second = await service.rollCandidate({ worldId: world.worldId, requestId: 'same-roll' });
  assert.deepEqual(first, second);
  assert.match(first.requestPayloadHash, /^[a-f0-9]{64}$/);
  await assert.rejects(
    service.rollCandidate({
      worldId: world.worldId,
      requestId: 'same-roll',
      seed: 'conflicting-seed',
    }),
    /already bound to a different roll-candidate payload/,
  );

  const [concurrentFirst, concurrentSecond] = await Promise.all([
    service.rollCandidate({
      worldId: world.worldId,
      requestId: 'concurrent-roll',
      seed: 'concurrent-seed',
    }),
    service.rollCandidate({
      worldId: world.worldId,
      requestId: 'concurrent-roll',
      seed: 'concurrent-seed',
    }),
  ]);
  assert.deepEqual(concurrentFirst, concurrentSecond);

  assert.equal(JSON.stringify(world).includes('/Users/'), false);
  await assert.rejects(
    service.createWorld({ requestId: 'bad-preset', presetId: '../../secret' }),
    /Unsupported presetId/,
  );
});

test('reroll mutation receipts distinguish a superseded-source collision from a store change', async () => {
  const sourceHash = '1'.repeat(64);
  const childHash = '2'.repeat(64);
  const sourceId = `candidate_${sourceHash}`;
  const childId = `candidate_${childHash}`;
  const sourceRecord = minimalCandidateRecord(sourceHash, 'superseded', 0);
  const childRecord = minimalCandidateRecord(childHash, 'superseded', 1);
  let retentionUpgraded = false;
  const backend = fakeBackend(async (operation) => {
    if (operation === 'query_view') return sourceRecord;
    if (operation === 'reroll_candidate') {
      return { ...childRecord, retention_upgraded: retentionUpgraded };
    }
    throw new Error(`Unexpected fake operation ${operation}.`);
  });
  const service = new LifeSimulationService({ backend });
  service.worlds.set('world-test', localWorld({
    candidateIds: new Map([
      [sourceId, sourceHash],
      [childId, childHash],
    ]),
    candidateViews: new Map([
      [sourceId, { requested_observables: ['world.value'], access_scopes: ['public'] }],
      [childId, { requested_observables: ['world.value'], access_scopes: ['public'] }],
    ]),
  }));

  const result = await service.rerollCandidate({
    worldId: 'world-test',
    candidateId: sourceId,
    requestId: 'superseded-collision',
  });
  assert.equal(result.candidateId, childId);
  assert.equal(result.reusedExisting, true);
  assert.equal(result.candidateStoreChanged, false);
  assert.equal(result.acceptedHeadChanged, false);

  retentionUpgraded = true;
  const upgraded = await service.rerollCandidate({
    worldId: 'world-test',
    candidateId: sourceId,
    requestId: 'superseded-retention-upgrade',
  });
  assert.equal(upgraded.reusedExisting, true);
  assert.equal(upgraded.candidateStoreChanged, true);
});

test('candidate routing reads matched Rust projections and remains advisory', async () => {
  const modelHash = 'm'.repeat(64);
  const parentHash = 'p'.repeat(64);
  const hashes = ['a'.repeat(64), 'b'.repeat(64)];
  const calls = [];
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'get_model') {
        return {
          model: {
            schema: 'life-sim-rust-model/v1',
            processes: [{
              id: 'actor.want.safety',
              value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
            }],
          },
        };
      }
      if (operation === 'query_view') {
        const index = hashes.indexOf(payload.candidate_hash);
        return {
          status: 'pending',
          candidate: {
            candidate_hash: hashes[index],
            model_hash: modelHash,
            parent_world_hash: parentHash,
            expected_parent_version: 0,
            start_time: 0,
            end_time: 1,
            dynamics_hash: 'd'.repeat(64),
            successor_state: {
              'actor.want.safety': { kind: 'scalar', value: index === 0 ? 0.8 : 0.3 },
            },
            path: { samples: [] },
          },
        };
      }
      throw new Error(`Unexpected fake operation ${operation}.`);
    }),
  });
  const candidateIds = hashes.map((hash) => `candidate_${hash}`);
  service.worlds.set('route-world', localWorld({
    id: 'route-world',
    modelHash,
    candidateIds: new Map(candidateIds.map((id, index) => [id, hashes[index]])),
    candidateViews: new Map(candidateIds.map((id) => [id, {}])),
  }));

  const result = await service.routeCandidates({
    worldId: 'route-world',
    requestId: 'route-request',
    candidateIds,
    terms: [{
      termId: 'safety',
      fieldId: 'actor.want.safety',
      source: 'endpoint',
      preference: 'maximize',
      weight: 1,
    }],
    accessScopes: ['holder:actor'],
  });

  assert.equal(result.ranking[0].candidateHash, hashes[0]);
  assert.equal(result.authority.canonicalWorldMutation, false);
  assert.deepEqual(calls.map(({ operation }) => operation), [
    'get_model',
    'query_view',
    'query_view',
  ]);
  assert.equal(calls[1].payload.view.include_path, false);
  assert.deepEqual(calls[1].payload.view.requested_observables, ['actor.want.safety']);
});

test('in-flight reservations close model, world, candidate, and preset quota races', async () => {
  {
    const gate = deferred();
    const storedModel = minimalModel('stored-model');
    const modelHash = 'a'.repeat(64);
    const service = new LifeSimulationService({
      backend: fakeBackend(async (operation) => {
        if (operation !== 'register_model') throw new Error(`Unexpected ${operation}.`);
        return gate.promise;
      }),
    });
    for (let index = 0; index < serviceLimits.maxModels - 1; index += 1) {
      service.models.set(`existing-model-${index}`, {});
    }
    const first = service.registerModel({
      requestId: 'model-reservation-first',
      model: minimalModel('first-model'),
    });
    await assert.rejects(
      service.registerModel({
        requestId: 'model-reservation-second',
        model: minimalModel('second-model'),
      }),
      /Model quota/,
    );
    gate.resolve({
      model: storedModel,
      summary: { model_hash: modelHash, process_ids: [] },
    });
    await first;
    assert.equal(service.models.size, serviceLimits.maxModels);
    assert.equal(service.pendingModels, 0);
  }

  {
    const gate = deferred();
    const service = new LifeSimulationService({
      backend: fakeBackend(async (operation) => {
        if (operation === 'create_world') return gate.promise;
        if (operation === 'get_model') {
          return { summary: { process_count: 1, process_ids: ['world.value'] } };
        }
        throw new Error(`Unexpected ${operation}.`);
      }),
    });
    for (let index = 0; index < serviceLimits.maxWorlds - 1; index += 1) {
      service.worlds.set(`existing-world-${index}`, {});
    }
    const first = service.createWorld({
      requestId: 'world-reservation-first',
      modelHash: 'b'.repeat(64),
    });
    await assert.rejects(
      service.createWorld({
        requestId: 'world-reservation-second',
        modelHash: 'b'.repeat(64),
      }),
      /World quota/,
    );
    gate.resolve({ world_hash: 'c'.repeat(64), version: 0 });
    await first;
    assert.equal(service.worlds.size, serviceLimits.maxWorlds);
    assert.equal(service.pendingWorlds, 0);
  }

  {
    const gate = deferred();
    const newHash = 'd'.repeat(64);
    const service = new LifeSimulationService({
      backend: fakeBackend(async (operation) => {
        if (operation !== 'roll_world') throw new Error(`Unexpected ${operation}.`);
        return gate.promise;
      }),
    });
    const candidateIds = new Map();
    for (let index = 0; index < serviceLimits.maxCandidatesPerWorld - 1; index += 1) {
      candidateIds.set(`candidate-existing-${index}`, `existing-hash-${index}`);
    }
    const world = localWorld({ candidateIds });
    service.worlds.set(world.id, world);
    const query = {
      schema: 'life-sim-rust-model-query/v1',
      delta_time: 1,
      step_size: 0.25,
      seed: 'candidate-quota',
      requested_observables: ['world.value'],
      access_scopes: ['public'],
      path: { mode: 'endpoint' },
    };
    const first = service.rollCandidate({
      worldId: world.id,
      requestId: 'candidate-reservation-first',
      query,
    });
    await assert.rejects(
      service.rollCandidate({
        worldId: world.id,
        requestId: 'candidate-reservation-second',
        query: { ...query, seed: 'candidate-quota-second' },
      }),
      /Candidate quota/,
    );
    gate.resolve(minimalCandidateRecord(newHash));
    await first;
    assert.equal(world.candidateIds.size, serviceLimits.maxCandidatesPerWorld);
    assert.equal(world.pendingCandidates, 0);
  }

  {
    const gate = deferred();
    let registrationCount = 0;
    const presetHash = 'e'.repeat(64);
    const service = new LifeSimulationService({
      backend: fakeBackend(async (operation) => {
        if (operation === 'register_model') {
          registrationCount += 1;
          return gate.promise;
        }
        if (operation === 'create_world') {
          return { world_hash: 'f'.repeat(64), version: 0 };
        }
        if (operation === 'get_model') {
          return { summary: { process_count: 1, process_ids: ['world.value'] } };
        }
        throw new Error(`Unexpected ${operation}.`);
      }),
    });
    for (let index = 0; index < serviceLimits.maxModels - 1; index += 1) {
      service.models.set(`existing-model-${index}`, {});
    }
    const first = service.createWorld({
      requestId: 'preset-reservation-first',
      presetId: 'north-harbor/12',
    });
    await assert.rejects(
      service.createWorld({
        requestId: 'preset-reservation-second',
        presetId: 'north-harbor/48',
      }),
      /Model quota/,
    );
    gate.resolve({
      model: minimalModel('preset-model'),
      summary: { model_hash: presetHash, process_ids: ['world.value'] },
    });
    await first;
    assert.equal(registrationCount, 1);
    assert.equal(service.pendingModels, 0);
    assert.equal(service.pendingWorlds, 0);
  }
});

test('global receipt bytes are reserved before mutation and released on ordinary failure', async () => {
  const gate = deferred();
  let blockFirst = true;
  const backend = fakeBackend(async (operation) => {
    if (operation === 'create_world') {
      if (blockFirst) return gate.promise;
      return { world_hash: 'a'.repeat(64), version: 0 };
    }
    if (operation === 'get_model') {
      return { summary: { process_count: 1, process_ids: ['world.value'] } };
    }
    throw new Error(`Unexpected ${operation}.`);
  });
  const service = new LifeSimulationService({ backend, maxReceiptBytes: 300_000 });
  const first = service.createWorld({
    requestId: 'receipt-budget-first',
    modelHash: 'b'.repeat(64),
  });
  await assert.rejects(
    service.createWorld({
      requestId: 'receipt-budget-concurrent',
      modelHash: 'b'.repeat(64),
    }),
    /global retained-and-pending budget is 300000 bytes/,
  );
  assert.ok(service.receiptBytes > 256 * 1_024);
  blockFirst = false;
  gate.resolve({ world_hash: 'c'.repeat(64), version: 0 });
  await first;
  assert.ok(service.receiptBytes > 0);
  assert.ok(service.receiptBytes < 10_000);
  await service.createWorld({
    requestId: 'receipt-budget-after-release',
    modelHash: 'b'.repeat(64),
  });

  const failing = new LifeSimulationService({
    backend: fakeBackend(async (operation) => {
      if (operation === 'create_world') throw new Error('ordinary create failure');
      if (operation === 'get_model') {
        return { summary: { process_count: 1, process_ids: ['world.value'] } };
      }
      throw new Error(`Unexpected ${operation}.`);
    }),
    maxReceiptBytes: 300_000,
  });
  await assert.rejects(
    failing.createWorld({
      requestId: 'receipt-failure-release',
      modelHash: 'd'.repeat(64),
    }),
    /ordinary create failure/,
  );
  assert.equal(failing.receiptBytes, 0);
  assert.equal(failing.createReceipts.size, 0);
});

test('large model mutation receipts are compact and replay without re-executing Rust', async () => {
  const longIds = Array.from(
    { length: 7_000 },
    (_, index) => `process.${index}.${'x'.repeat(900)}`,
  );
  const modelHash = '9'.repeat(64);
  let registrations = 0;
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation) => {
      if (operation !== 'register_model') throw new Error(`Unexpected ${operation}.`);
      registrations += 1;
      return {
        model: minimalModel('large-summary-model'),
        summary: {
          model_hash: modelHash,
          revision: { number: 0 },
          process_count: longIds.length,
          decomposition_edge_count: 0,
          dependency_edge_count: 0,
          law_count: 0,
          law_roles: {},
          process_ids: longIds,
          processes: longIds.map((id) => ({ id, value_type: 'scalar' })),
        },
      };
    }),
  });
  const request = {
    requestId: 'compact-large-register-receipt',
    model: minimalModel('large-summary-model'),
  };
  const first = await service.registerModel(request);
  assert.equal(first.summary.process_count, 7_000);
  assert.equal('process_ids' in first.summary, false);
  assert.equal('processes' in first.summary, false);
  assert.ok(service.receiptBytes < 10_000);
  assert.deepEqual(await service.registerModel(request), first);
  assert.equal(registrations, 1);
});

test('unexpected post-mutation receipt overflow is retained as indeterminate', async () => {
  let createCalls = 0;
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation) => {
      if (operation === 'get_model') {
        return { summary: { process_count: 1, process_ids: ['world.value'] } };
      }
      if (operation === 'create_world') {
        createCalls += 1;
        return { world_hash: 'x'.repeat(300_000), version: 0 };
      }
      throw new Error(`Unexpected ${operation}.`);
    }),
  });
  const request = {
    requestId: 'oversized-result-after-mutation',
    modelHash: '8'.repeat(64),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      service.createWorld(request),
      (cause) => {
        assert.equal(cause.code, 'receipt_retention_overflow_after_mutation');
        assert.equal(cause.indeterminate, true);
        assert.equal(cause.receiptRetained, true);
        return true;
      },
    );
  }
  assert.equal(createCalls, 1);
  assert.equal(service.worlds.size, 1);
  assert.equal(service.createReceipts.size, 1);
});

test('world creation preflights model inventory before the Rust mutation', async () => {
  let createCalls = 0;
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation) => {
      if (operation === 'get_model') throw new Error('model inventory unavailable');
      if (operation === 'create_world') {
        createCalls += 1;
        return { world_hash: '7'.repeat(64), version: 0 };
      }
      throw new Error(`Unexpected ${operation}.`);
    }),
  });
  await assert.rejects(
    service.createWorld({
      requestId: 'preflight-before-create',
      modelHash: '6'.repeat(64),
    }),
    /model inventory unavailable/,
  );
  assert.equal(createCalls, 0);
  assert.equal(service.worlds.size, 0);
  assert.equal(service.createReceipts.size, 0);
});

test('indeterminate persistence errors retain their typed idempotency receipt', async () => {
  let createCalls = 0;
  const service = new LifeSimulationService({
    backend: fakeBackend(async (operation) => {
      if (operation === 'create_world') {
        createCalls += 1;
        throw new EngineError({
          operation,
          requestId: 'mcp_uncertain_test',
          code: 'persistence_uncertain',
          message: 'atomic replacement may have succeeded',
        });
      }
      if (operation === 'get_model') {
        return { summary: { process_count: 1, process_ids: ['world.value'] } };
      }
      throw new Error(`Unexpected ${operation}.`);
    }),
  });
  const request = {
    requestId: 'uncertain-create',
    modelHash: 'e'.repeat(64),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      service.createWorld(request),
      (cause) => {
        assert.equal(cause.code, 'persistence_uncertain');
        assert.equal(cause.indeterminate, true);
        assert.equal(cause.receiptRetained, true);
        assert.equal(cause.idempotencyOperation, 'create-world');
        assert.equal(cause.idempotencyRequestId, 'uncertain-create');
        return true;
      },
    );
  }
  assert.equal(createCalls, 1);
  assert.equal(service.createReceipts.size, 1);
  assert.ok(service.receiptBytes > 0);
});

test('trajectory output caps payloads without dropping the terminal endpoint', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  const world = await service.createWorld({ requestId: 'create-long-path' });
  const candidate = await service.rollCandidate({
    worldId: world.worldId,
    requestId: 'roll-long-path',
    deltaTime: 12,
    stepSize: 1 / 24,
    forcingEnabled: false,
  });
  const path = await service.queryTrajectory({
    worldId: world.worldId,
    candidateId: candidate.candidateId,
    fieldPrefixes: ['world.'],
    maxFields: 100,
  });

  assert.equal(path.returnedSamples, 256);
  assert.equal(path.samples.at(-1).time, candidate.endTime);
  assert.equal(path.truncated, true);
});

test('north-harbor/48 rolls its complete process inventory through the MCP boundary', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  const world = await service.createWorld({
    requestId: 'create-north-harbor-48',
    presetId: 'north-harbor/48',
  });
  assert.ok(world.fieldCount > 1_000);
  assert.ok(world.fieldCount <= 2_048);

  const candidate = await service.rollCandidate({
    worldId: world.worldId,
    requestId: 'roll-north-harbor-48',
    seed: 'north-harbor-48-boundary-smoke',
  });
  assert.equal(candidate.fieldCount, world.fieldCount);
  assert.equal(candidate.candidateStoreChanged, true);
  assert.equal(candidate.acceptedHeadChanged, false);
});
