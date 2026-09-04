import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'src', 'server.ts');

function observedProtocolModel() {
  return {
    schema: 'life-sim-rust-model/v1',
    id: 'mcp-observation-materialization-test',
    time_unit: 'hour',
    revision: {
      number: 0,
      reason: 'Test forward observation materialization through MCP and Rust.',
      provenance: ['official MCP protocol integration test'],
    },
    processes: [{
      id: 'sensor.reading',
      value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.25 },
      uncertainty: { kind: 'unknown' },
      unit: 'normalized-reading',
      provenance: ['official MCP protocol integration test'],
      support: ['world'],
      access_scopes: ['world'],
      update_mode: 'observed',
    }],
    decomposition: [],
    dependencies: [],
    laws: [],
    initial_claims: [],
  };
}

function personProfileCompilationRequest() {
  return {
    schema: 'life-sim-rust-profile-compilation/v1',
    model: {
      id: 'mcp-person-profile-test',
      time_unit: 'day',
      reason: 'Verify the paper-grounded three-view Person profile through MCP.',
      provenance: ['official MCP protocol integration test'],
    },
    profiles: [{
      kind: 'person',
      profile: {
        id: 'bounded_year',
        subject_id: 'alex',
        person_boundary: 'Alex during one bounded year.',
        continuity_criterion: 'The same embodied person across the interval.',
        evidence_boundary: 'Observed and reported events in the bounded year.',
        evidence: [{
          id: 'release',
          value: 1,
          bounds: { minimum: 0, maximum: 1 },
          evidence_type: 'observation',
          holder: 'operator',
          authority: { source: 'release_record', weight: 1 },
        }],
        position_bounds: { minimum: -1, maximum: 1 },
        views: [{
          id: 'outside',
          kind: 'external_descriptive',
          holder: 'operator',
          estimator: 'research_agent',
          authority_weight: 0.6,
          nodes: [{ id: 'research_as_path', position: 0.4 }],
        }, {
          id: 'candidate',
          kind: 'candidate_actor',
          holder: 'operator',
          estimator: 'research_agent',
          authority_weight: 0.5,
          nodes: [{ id: 'research_as_path', position: 0.7 }],
        }, {
          id: 'self',
          kind: 'self_reported',
          holder: 'alex',
          estimator: 'alex',
          authority_weight: 1,
          nodes: [{ id: 'research_as_path', position: 0.9 }],
        }],
        provenance: ['official MCP protocol integration test'],
      },
    }],
  };
}

test('official MCP client discovers and calls the local stdio server', async () => {
  const client = new Client({ name: 'life-simulation-test-client', version: '0.1.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
  }));
  try {
    const { tools } = await client.listTools();
    const names = tools.map(({ name }) => name).sort();
    assert.deepEqual(names, [
      'life_candidate_accept',
      'life_candidate_annotate',
      'life_candidate_compare',
      'life_candidate_observe',
      'life_candidate_reject',
      'life_candidate_reroll',
      'life_candidate_roll',
      'life_candidate_route',
      'life_engine_status',
      'life_estimation_proposal_inspect',
      'life_estimation_proposal_review',
      'life_estimation_request_create',
      'life_estimation_response_submit',
      'life_graph_query',
      'life_meaning_query',
      'life_model_inspect',
      'life_model_register',
      'life_model_revise',
      'life_model_validate',
      'life_modeling_context',
      'life_narrative_batch',
      'life_narrative_query',
      'life_narrative_register',
      'life_narrative_render',
      'life_narrative_revise',
      'life_narrative_training_export',
      'life_profile_compile',
      'life_story_revision_diagnose',
      'life_trajectory_query',
      'life_trajectory_summarize',
      'life_view_query',
      'life_world_create',
      'life_world_inspect',
      'life_world_refine_genesis',
      'life_writer_contract_create',
      'life_writer_plan_evaluate',
    ]);
    const modelingTool = tools.find(({ name }) => name === 'life_modeling_context');
    assert.match(modelingTool.description, /paper-first/);
    assert.match(modelingTool.description, /never replace reading/);
    const { resources } = await client.listResources();
    const resourceUris = resources.map(({ uri }) => uri);
    for (const uri of [
      'life-sim://theory/meaning-model',
      'life-sim://theory/life-simulation',
      'life-sim://protocol/modeling',
      'life-sim://protocol/narrative-understanding-graph',
      'life-sim://profile/story',
      'life-sim://profile/person',
    ]) {
      assert.ok(resourceUris.includes(uri), `missing MCP resource ${uri}`);
    }
    const { prompts } = await client.listPrompts();
    assert.ok(prompts.some(({ name }) => name === 'life_modeling_start'));
    const starter = await client.getPrompt({
      name: 'life_modeling_start',
      arguments: { purpose: 'creative_story', sessionMode: 'first_use' },
    });
    assert.match(starter.messages[0].content.text, /complete current papers/);
    const modelingContext = await client.callTool({
      name: 'life_modeling_context',
      arguments: { purpose: 'person_reflection', sessionMode: 'first_use' },
    });
    assert.equal(modelingContext.structuredContent.requiresFullTheoryRead, true);
    assert.deepEqual(modelingContext.structuredContent.personalModelViews, [
      'external event history',
      'alternative AI-inferred actor-local models',
      "the person's reported self-model",
    ]);
    const profileTool = tools.find(({ name }) => name === 'life_profile_compile');
    assert.match(profileTool.description, /read-only/);
    assert.match(profileTool.description, /never registers or persists/);
    const blockedCompile = await client.callTool({
      name: 'life_profile_compile',
      arguments: { profileRequest: personProfileCompilationRequest() },
    });
    assert.equal(blockedCompile.isError, true);
    assert.match(blockedCompile.content[0].text, /Paper-first gate/);

    const meaningPaper = await client.readResource({
      uri: 'life-sim://theory/meaning-model',
    });
    assert.match(
      meaningPaper.contents[0].text,
      /Constructing Worlds and Stories at Progressive Resolution/,
    );
    assert.equal(
      meaningPaper.contents[0].text,
      await readFile(new URL('../../paper/meaning-model.tex', import.meta.url), 'utf8'),
    );
    assert.match(meaningPaper.contents[0]._meta.sha256, /^[a-f0-9]{64}$/);
    const lifePaper = await client.readResource({
      uri: 'life-sim://theory/life-simulation',
    });
    assert.match(lifePaper.contents[0].text, /Learning from Worlds and Their Construction/);
    assert.match(
      lifePaper.contents[0].text,
      /No process-sensorium,\s+transfer, or alignment result is reported here/,
    );
    const narrativeProtocol = await client.readResource({
      uri: 'life-sim://protocol/narrative-understanding-graph',
    });
    assert.match(narrativeProtocol.contents[0].text, /additive atomic batches/);
    const repeatContext = await client.callTool({
      name: 'life_modeling_context',
      arguments: { purpose: 'person_reflection', sessionMode: 'repeat_same_domain' },
    });
    assert.equal(repeatContext.structuredContent.requiresFullTheoryRead, false);
    assert.equal(repeatContext.structuredContent.theoryAccessGate.satisfied, true);

    const compiledProfile = await client.callTool({
      name: 'life_profile_compile',
      arguments: { profileRequest: personProfileCompilationRequest() },
    });
    assert.equal(compiledProfile.isError, undefined);
    assert.equal(compiledProfile.structuredContent.readOnly, true);
    assert.equal(compiledProfile.structuredContent.stored, false);
    assert.equal(compiledProfile.structuredContent.mutationPerformed, false);
    assert.equal(compiledProfile.structuredContent.model.meaning_model.realizations.length, 3);
    assert.deepEqual(compiledProfile.structuredContent.registrationNextStep, {
      operation: 'registerModel',
      explicit: true,
    });
    const newDomainContext = await client.callTool({
      name: 'life_modeling_context',
      arguments: { purpose: 'observation', sessionMode: 'new_domain' },
    });
    assert.equal(newDomainContext.structuredContent.requiresFullTheoryRead, true);
    assert.equal(newDomainContext.structuredContent.theoryAccessGate.satisfied, false);
    const blockedAfterDomainChange = await client.callTool({
      name: 'life_profile_compile',
      arguments: { profileRequest: personProfileCompilationRequest() },
    });
    assert.equal(blockedAfterDomainChange.isError, true);
    assert.match(blockedAfterDomainChange.content[0].text, /Paper-first gate/);
    const inspectTool = tools.find(({ name }) => name === 'life_model_inspect');
    assert.match(inspectTool.description, /administrative operation/);
    assert.match(inspectTool.description, /initial values/);
    const meaningTool = tools.find(({ name }) => name === 'life_meaning_query');
    assert.match(meaningTool.description, /bounded page/);
    assert.match(meaningTool.description, /static administrative view of semantic data/);
    assert.match(
      meaningTool.description,
      /does not infer links, execute semantic records, apply cuts/,
    );
    assert.deepEqual(meaningTool.inputSchema.properties.collections.items.enum, [
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
    const estimationSubmitTool = tools.find(
      ({ name }) => name === 'life_estimation_response_submit',
    );
    assert.match(estimationSubmitTool.description, /exactly once/);
    assert.match(estimationSubmitTool.description, /data-only response may omit/);
    assert.match(estimationSubmitTool.description, /never rolls, commits, mutates a world, or registers/);
    assert.equal(estimationSubmitTool.inputSchema.required.includes('proposedModel'), false);
    assert.equal(estimationSubmitTool.inputSchema.required.includes('proposalReason'), false);
    const estimationReviewTool = tools.find(
      ({ name }) => name === 'life_estimation_proposal_review',
    );
    assert.match(estimationReviewTool.description, /refused if the bound world head is stale/);
    assert.match(estimationReviewTool.description, /ModelTransitionSpec observation fragment/);
    const trajectorySummaryTool = tools.find(
      ({ name }) => name === 'life_trajectory_summarize',
    );
    assert.match(trajectorySummaryTool.description, /canonical Rust-owned/);
    assert.match(trajectorySummaryTool.description, /read-only/);
    const genesisRefinementTool = tools.find(
      ({ name }) => name === 'life_world_refine_genesis',
    );
    assert.match(genesisRefinementTool.description, /preserves every existing process/);
    assert.match(genesisRefinementTool.description, /genesis-only canonical mutation/);
    assert.match(genesisRefinementTool.description, /not automatic discovery/);

    const status = await client.callTool({ name: 'life_engine_status', arguments: {} });
    assert.equal(status.isError, undefined);
    assert.equal(status.structuredContent.activeBackend, 'Life Simulation Rust machine');
    assert.equal(status.structuredContent.javascriptSimulationFallback, false);
    assert.equal(status.structuredContent.engine.ready, true);
    assert.equal(status.structuredContent.implementationCoverage.normalizedSemanticFamilies, 33);
    assert.equal(status.structuredContent.implementationCoverage.validatedLearnedCoverage, 0);
    assert.equal(status.structuredContent.mcpSemanticCoverage.approximateDedicatedFamilies, 10);
    assert.equal(status.structuredContent.mcpSemanticCoverage.normalizedSemanticFamilies, 33);
    assert.equal(status.structuredContent.limits.maxQueryProcessReferences, 2_048);
    assert.equal(status.structuredContent.limits.maxQueryInterventions, 1_000);
    assert.equal(status.structuredContent.limits.maxQueryObservations, 1_000);
    assert.equal(status.structuredContent.limits.maxViewAccessScopes, 64);
    assert.equal(status.structuredContent.limits.maxReceiptsPerScope, 4_096);
    assert.equal(status.structuredContent.limits.maxRequestIdLength, 256);
    assert.equal(status.structuredContent.limits.maxHandleLength, 256);
    assert.equal(status.structuredContent.limits.maxAnnotationIssues, 100);
    assert.equal(status.structuredContent.limits.maxAnnotationBytes, 65_536);
    assert.equal(status.structuredContent.limits.maxReceiptBytesGlobal, 67_108_864);
    assert.equal(status.structuredContent.limits.maxWriterContractInputBytes, 98_304);
    assert.equal(status.structuredContent.limits.maxWriterPlanInputBytes, 98_304);
    assert.equal(status.structuredContent.limits.maxModelMeaningRecords, 50_000);
    assert.equal(status.structuredContent.limits.maxProfileSpecs, 256);
    assert.equal(status.structuredContent.limits.maxMeaningQueryItems, 250);
    assert.equal(status.structuredContent.limits.maxMeaningQueryDefinitionBytes, 524_288);
    assert.equal(status.structuredContent.limits.maxEstimationCoordinates, 256);
    assert.equal(status.structuredContent.limits.maxEstimationStorageBytes, 33_554_432);
    assert.equal(status.structuredContent.meaningModelLayer.optional, true);
    assert.match(
      status.structuredContent.meaningModelLayer.mcpSurface,
      /genesis-only authored refinement/,
    );
    assert.match(
      status.structuredContent.meaningModelLayer.executableBehavior,
      /MCP does not execute Meaning Model records/,
    );
    assert.deepEqual(status.structuredContent.meaningModelLayer.queryableCollections, [
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
    assert.equal(
      status.structuredContent.meaningModelLayer.schema,
      'life-sim-rust-meaning-model/v1',
    );
    assert.equal(status.structuredContent.profileCompilation.optional, true);
    assert.equal(status.structuredContent.profileCompilation.rustContract.read_only, true);
    assert.equal(
      status.structuredContent.profileCompilation.rustContract.implicit_registration,
      false,
    );
    assert.deepEqual(status.structuredContent.meaningModelLayer.rustContract.collections, [
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
      'normalized_cuts',
      'context_roots',
    ]);
    assert.equal(status.structuredContent.controlPlaneUsage.retainedAndPendingReceiptBytes, 0);
    assert.equal(status.structuredContent.estimationExchange.providerNeutral, true);
    assert.deepEqual(status.structuredContent.estimationExchange.operations, [
      'assimilate',
      'estimate',
      'predict',
      'infer',
      'counterfactual',
      'simulate',
    ]);
    assert.deepEqual(status.structuredContent.estimationExchange.outputModes, [
      'observed',
      'estimated',
      'simulated',
      'derived',
    ]);
    assert.equal(
      status.structuredContent.estimationExchange.observationIngestion.rustHook,
      'ModelTransitionSpec.observations',
    );
    assert.equal(
      status.structuredContent.estimationExchange.observationIngestion.forwardTimedValues,
      true,
    );
    assert.equal(
      status.structuredContent.estimationExchange.observationIngestion.explicitCommitRequired,
      true,
    );
    assert.equal(
      status.structuredContent.estimationExchange.observationIngestion.zeroTimeAppend,
      false,
    );

    const created = await client.callTool({
      name: 'life_world_create',
      arguments: { requestId: 'protocol-create', presetId: 'north-harbor/12' },
    });
    assert.equal(created.isError, undefined);
    assert.equal(created.structuredContent.headVersion, 0);
    assert.match(created.structuredContent.worldId, /^world_/);

    const meaning = await client.callTool({
      name: 'life_meaning_query',
      arguments: { modelHash: created.structuredContent.modelHash },
    });
    assert.equal(meaning.isError, undefined);
    assert.equal(meaning.structuredContent.meaningModel.enabled, false);
    assert.equal(meaning.structuredContent.meaningModel.collectionCounts.referents, 0);
    assert.equal(
      meaning.structuredContent.meaningModel.collectionCounts.encapsulation_cuts,
      0,
    );
    assert.equal(
      meaning.structuredContent.meaningModel.collectionCounts.event_referent_bindings,
      0,
    );
    assert.equal(meaning.structuredContent.matchedCount, 0);
    assert.deepEqual(meaning.structuredContent.items, []);

    const emptyView = await client.callTool({
      name: 'life_view_query',
      arguments: { worldId: created.structuredContent.worldId },
    });
    assert.equal(emptyView.isError, undefined);
    assert.deepEqual(emptyView.structuredContent.projection.state, {});

    const inspectedModel = await client.callTool({
      name: 'life_model_inspect',
      arguments: { modelHash: created.structuredContent.modelHash, includeDefinition: true },
    });
    assert.equal(inspectedModel.isError, undefined);
    const process = inspectedModel.structuredContent.model.processes[0];
    const estimationRequest = await client.callTool({
      name: 'life_estimation_request_create',
      arguments: {
        worldId: created.structuredContent.worldId,
        requestId: 'protocol-estimation-create',
        operation: 'estimate',
        intent: 'reality',
        evidenceCutoff: 0,
        coordinates: [{
          id: 'protocol-coordinate',
          processId: process.id,
          targetTime: 0,
          question: 'Estimate the coordinate from the supplied accepted-head evidence.',
        }],
        accessScopes: ['world'],
      },
    });
    assert.equal(estimationRequest.isError, undefined);
    assert.equal(estimationRequest.structuredContent.modelHash, created.structuredContent.modelHash);
    assert.equal(estimationRequest.structuredContent.acceptedHeadHash, created.structuredContent.headHash);
    const proposedModel = structuredClone(inspectedModel.structuredContent.model);
    proposedModel.revision = {
      number: 1,
      previous_model_hash: created.structuredContent.modelHash,
      reason: 'Protocol test of an uncommitted provider proposal.',
      provenance: ['mcp protocol test'],
    };
    const estimated = await client.callTool({
      name: 'life_estimation_response_submit',
      arguments: {
        estimationRequestId: estimationRequest.structuredContent.estimationRequestId,
        requestId: 'protocol-estimation-submit',
        dispositions: [{
          coordinateId: 'protocol-coordinate',
          status: 'known',
          reason: 'The accepted projection provides a numeric basis for an estimate.',
        }],
        provisionalClaims: [{
          coordinateId: 'protocol-coordinate',
          outputMode: 'estimated',
          valueTime: 0,
          claim: {
            id: 'protocol.provider.estimate',
            subject: process.id,
            value: estimationRequest.structuredContent.evidenceProjection.state[process.id],
            uncertainty: { kind: 'standard_deviation', value: 0.1 },
            evidence_type: 'estimate',
            holder: 'protocol-provider',
            evidence_cutoff: 0,
            provenance: ['official MCP protocol integration test'],
            authority: { source: 'protocol-provider', weight: 0.5 },
            access_scopes: ['world'],
          },
        }],
        semanticChanges: [],
        proposedModel,
        proposalReason: 'Exercise validation without registering the revision.',
      },
    });
    assert.equal(estimated.isError, undefined);
    assert.equal(estimated.structuredContent.rustValidated, true);
    assert.equal(estimated.structuredContent.modelRegistrationPerformed, false);
    assert.equal(estimated.structuredContent.observationIngestion.status, 'not_requested');

    const proposedStillUnregistered = await client.callTool({
      name: 'life_model_inspect',
      arguments: {
        modelHash: estimated.structuredContent.proposedModelHash,
        includeDefinition: false,
      },
    });
    assert.equal(proposedStillUnregistered.isError, true);

    const reviewed = await client.callTool({
      name: 'life_estimation_proposal_review',
      arguments: {
        proposalId: estimated.structuredContent.proposalId,
        requestId: 'protocol-estimation-review',
        verdict: 'approved',
        rationale: 'The proposed revision was validated and remains uncommitted.',
      },
    });
    assert.equal(reviewed.isError, undefined);
    assert.equal(reviewed.structuredContent.modelRegistrationPerformed, false);
    assert.equal(reviewed.structuredContent.registrationNextStep.tool, 'life_model_revise');

    const revised = await client.callTool({
      name: 'life_model_revise',
      arguments: {
        requestId: 'protocol-register-reviewed-revision',
        previousModelHash: created.structuredContent.modelHash,
        model: proposedModel,
      },
    });
    assert.equal(revised.isError, undefined, JSON.stringify(revised));
    const refined = await client.callTool({
      name: 'life_world_refine_genesis',
      arguments: {
        worldId: created.structuredContent.worldId,
        requestId: 'protocol-refine-genesis',
        targetModelHash: revised.structuredContent.modelHash,
        requestedObservables: [process.id],
        accessScopes: ['world'],
      },
    });
    assert.equal(refined.isError, undefined, JSON.stringify(refined));
    assert.equal(refined.structuredContent.sourceModelHash, created.structuredContent.modelHash);
    assert.equal(refined.structuredContent.targetModelHash, revised.structuredContent.modelHash);
    assert.equal(refined.structuredContent.boundary, 'genesis_only_authored_refinement');
    assert.equal(refined.structuredContent.conservation.monotonic_definition, true);
    assert.equal(refined.structuredContent.projection.version, 0);
    assert.equal(refined.structuredContent.projection.time, 0);
    assert.deepEqual(Object.keys(refined.structuredContent.projection.state), [process.id]);
    const refinedWorld = await client.callTool({
      name: 'life_world_inspect',
      arguments: { worldId: created.structuredContent.worldId },
    });
    assert.equal(refinedWorld.isError, undefined);
    assert.equal(refinedWorld.structuredContent.modelHash, revised.structuredContent.modelHash);
    assert.equal(refinedWorld.structuredContent.headVersion, 0);

    const narrativeGraph = {
      schema: 'life-sim-rust-narrative-graph/v1',
      id: 'protocol-graph-native-story',
      revision: {
        number: 0,
        reason: 'Exercise the complete graph-native MCP path.',
        provenance: ['official MCP protocol integration test'],
      },
      source: {
        kind: 'world',
        world_id: created.structuredContent.worldId,
        world_hash: refinedWorld.structuredContent.headHash,
      },
      roots: ['document'],
      nodes: [{
        id: 'document',
        node_type: 'test_story',
        role: 'document_root',
        epistemic_status: 'fictional_artifact',
        evidence_type: 'fictional_canon',
        provenance: ['official MCP protocol integration test'],
      }, {
        id: 'passage',
        node_type: 'paragraph',
        role: 'story_passage',
        text: 'The harbor held one exact state beneath the sentence.',
        epistemic_status: 'fictional_canon',
        evidence_type: 'fictional_canon',
        authority: { source: 'protocol-author', weight: 1 },
        render: 'include',
        training: 'include',
        provenance: ['official MCP protocol integration test'],
      }],
      edges: [{
        id: 'document-contains-passage',
        source: { kind: 'node', node_id: 'document' },
        target: { kind: 'node', node_id: 'passage' },
        family: 'structural',
        relation: 'contains',
        order: 0,
        provenance: ['official MCP protocol integration test'],
      }, {
        id: 'passage-grounded-in-process',
        source: { kind: 'node', node_id: 'passage' },
        target: { kind: 'anchor', anchor_kind: 'process', anchor_id: process.id },
        family: 'grounding',
        relation: 'grounded_in',
        access_scopes: ['world'],
        provenance: ['official MCP protocol integration test'],
      }],
    };
    const registeredNarrative = await client.callTool({
      name: 'life_narrative_register',
      arguments: {
        requestId: 'protocol-narrative-register',
        narrativeGraph,
      },
    });
    assert.equal(registeredNarrative.isError, undefined, JSON.stringify(registeredNarrative));
    const appendedNarrative = await client.callTool({
      name: 'life_narrative_batch',
      arguments: {
        requestId: 'protocol-narrative-one-node-batch',
        previousGraphHash: registeredNarrative.structuredContent.graphHash,
        narrativeBatch: {
          schema: 'life-sim-rust-narrative-batch/v1',
          previous_graph_hash: registeredNarrative.structuredContent.graphHash,
          reason: 'Add one connected passage without resending the graph.',
          provenance: ['official MCP protocol integration test'],
          add_nodes: [{
            id: 'passage-2',
            node_type: 'paragraph',
            role: 'story_passage',
            text: 'A second node arrived in one atomic, connected batch.',
            epistemic_status: 'fictional_canon',
            evidence_type: 'fictional_canon',
            authority: { source: 'protocol-author', weight: 1 },
            render: 'include',
            training: 'include',
            provenance: ['official MCP protocol integration test'],
          }],
          add_edges: [{
            id: 'document-contains-passage-2',
            source: { kind: 'node', node_id: 'document' },
            target: { kind: 'node', node_id: 'passage-2' },
            family: 'structural',
            relation: 'contains',
            order: 1,
            provenance: ['official MCP protocol integration test'],
          }],
        },
      },
    });
    assert.equal(appendedNarrative.isError, undefined, JSON.stringify(appendedNarrative));
    assert.equal(appendedNarrative.structuredContent.batch.added_node_count, 1);
    assert.equal(appendedNarrative.structuredContent.batch.added_edge_count, 1);
    const appendedGraphHash = appendedNarrative.structuredContent.graphHash;
    const narrativeView = await client.callTool({
      name: 'life_narrative_query',
      arguments: {
        graphHash: appendedGraphHash,
        mode: 'full',
        includeContent: true,
        accessScopes: ['world'],
      },
    });
    assert.equal(narrativeView.isError, undefined, JSON.stringify(narrativeView));
    assert.equal(narrativeView.structuredContent.returned_node_count, 3);
    assert.equal(narrativeView.structuredContent.returned_edge_count, 3);
    const renderedNarrative = await client.callTool({
      name: 'life_narrative_render',
      arguments: { graphHash: appendedGraphHash },
    });
    assert.equal(renderedNarrative.isError, undefined, JSON.stringify(renderedNarrative));
    assert.equal(
      renderedNarrative.structuredContent.text,
      'The harbor held one exact state beneath the sentence.\n\n' +
        'A second node arrived in one atomic, connected batch.',
    );
    const narrativeTraining = await client.callTool({
      name: 'life_narrative_training_export',
      arguments: {
        graphHash: appendedGraphHash,
        accessScopes: ['world'],
        includeLinkedValues: true,
        requireAcceptedHistory: true,
      },
    });
    assert.equal(narrativeTraining.isError, undefined, JSON.stringify(narrativeTraining));
    assert.equal(narrativeTraining.structuredContent.record_count, 2);
    assert.deepEqual(
      narrativeTraining.structuredContent.records[0].record.linked_values[process.id],
      refined.structuredContent.projection.state[process.id],
    );
  } finally {
    await client.close();
  }
});

test('approved observation fragment is separately rolled and committed by real Rust', async () => {
  const client = new Client({ name: 'life-observation-test-client', version: '0.1.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
  }));
  try {
    const baseModel = observedProtocolModel();
    const registered = await client.callTool({
      name: 'life_model_register',
      arguments: { requestId: 'observation-model-register', model: baseModel },
    });
    assert.equal(registered.isError, undefined, JSON.stringify(registered));
    const created = await client.callTool({
      name: 'life_world_create',
      arguments: {
        requestId: 'observation-world-create',
        modelHash: registered.structuredContent.modelHash,
      },
    });
    assert.equal(created.isError, undefined);

    const request = await client.callTool({
      name: 'life_estimation_request_create',
      arguments: {
        worldId: created.structuredContent.worldId,
        requestId: 'observation-estimation-request',
        operation: 'assimilate',
        intent: 'reality',
        evidenceCutoff: 1,
        coordinates: [{
          id: 'reading-at-one',
          processId: 'sensor.reading',
          targetTime: 1,
        }],
        accessScopes: ['world'],
        context: 'A normalized sensor reading is available at hour one.',
      },
    });
    assert.equal(request.isError, undefined);

    const submitted = await client.callTool({
      name: 'life_estimation_response_submit',
      arguments: {
        estimationRequestId: request.structuredContent.estimationRequestId,
        requestId: 'observation-estimation-submit',
        dispositions: [{
          coordinateId: 'reading-at-one',
          status: 'known',
          reason: 'The external sensor supplied this value.',
        }],
        provisionalClaims: [{
          coordinateId: 'reading-at-one',
          outputMode: 'observed',
          valueTime: 1,
          claim: {
            id: 'sensor-reading-hour-one',
            subject: 'sensor.reading',
            value: { kind: 'scalar', value: 0.8 },
            uncertainty: { kind: 'standard_deviation', value: 0.02 },
            evidence_type: 'observation',
            holder: 'sensor-operator',
            evidence_cutoff: 1,
            provenance: ['sensor-A'],
            authority: { source: 'sensor-A', weight: 0.95 },
            access_scopes: ['world'],
          },
        }],
      },
    });
    assert.equal(submitted.isError, undefined);
    assert.equal(submitted.structuredContent.modelProposalIncluded, false);
    assert.equal(submitted.structuredContent.rustValidated, false);
    assert.equal(submitted.structuredContent.rustValidationNotApplicable, true);
    assert.equal(submitted.structuredContent.proposedModelHash, undefined);
    const reviewed = await client.callTool({
      name: 'life_estimation_proposal_review',
      arguments: {
        proposalId: submitted.structuredContent.proposalId,
        requestId: 'observation-estimation-review',
        verdict: 'approved',
        rationale: 'The forward observation is typed and its provenance is explicit.',
      },
    });
    assert.equal(reviewed.isError, undefined);
    assert.equal(reviewed.structuredContent.modelProposalIncluded, false);
    assert.equal(reviewed.structuredContent.rustRevalidated, false);
    assert.equal(reviewed.structuredContent.rustRevalidationNotApplicable, true);
    assert.equal(reviewed.structuredContent.registrationNextStep, undefined);
    const plan = reviewed.structuredContent.observationMaterializationNextStep;
    assert.equal(plan.status, 'ready');
    assert.equal(plan.materializationPerformed, false);

    const rolled = await client.callTool({
      name: 'life_candidate_roll',
      arguments: {
        worldId: created.structuredContent.worldId,
        requestId: 'observation-candidate-roll',
        query: {
          ...plan.queryFragment,
          delta_time: 1,
          step_size: 0.5,
          seed: 'observation-protocol-test',
          roll_index: 0,
          precedence: 'balanced',
          path: { mode: 'full' },
        },
      },
    });
    assert.equal(rolled.isError, undefined);
    assert.equal(rolled.structuredContent.canonical, false);
    const accepted = await client.callTool({
      name: 'life_candidate_accept',
      arguments: {
        worldId: created.structuredContent.worldId,
        candidateId: rolled.structuredContent.candidateId,
        requestId: 'observation-candidate-accept',
        expectedParentHash: plan.acceptedHeadHash,
      },
    });
    assert.equal(accepted.isError, undefined);
    assert.equal(accepted.structuredContent.time, 1);

    const view = await client.callTool({
      name: 'life_view_query',
      arguments: {
        worldId: created.structuredContent.worldId,
        requestedObservables: ['sensor.reading'],
        accessScopes: ['world'],
        includePath: true,
      },
    });
    assert.equal(view.isError, undefined);
    assert.deepEqual(
      view.structuredContent.projection.state['sensor.reading'],
      { kind: 'scalar', value: 0.8 },
    );
    const claims = Object.values(view.structuredContent.projection.claims);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].mode, 'observed');
    assert.equal(claims[0].value_time, 1);
    assert.equal(claims[0].evidence_cutoff, 1);
  } finally {
    await client.close();
  }
});
