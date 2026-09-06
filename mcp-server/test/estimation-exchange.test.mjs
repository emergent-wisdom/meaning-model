import assert from 'node:assert/strict';
import test from 'node:test';

import { LifeSimulationService, meaningModelCollections } from '../src/service.mjs';
import { validateEstimationResponseInput } from '../src/estimation-exchange.mjs';

const baseHash = 'a'.repeat(64);
const proposedHash = 'b'.repeat(64);
const headHash = 'c'.repeat(64);

function model(revision = 0) {
  return {
    schema: 'life-sim-rust-model/v1',
    id: 'estimation-test-model',
    time_unit: 'day',
    revision: revision === 0
      ? { number: 0, reason: 'test base', provenance: ['test'] }
      : {
          number: 1,
          previous_model_hash: baseHash,
          reason: 'provider proposes a semantic extension',
          provenance: ['provider-neutral-test'],
        },
    processes: [
      {
        id: 'person.stress',
        value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
        initial_value: { kind: 'scalar', value: 0.4 },
        update_mode: 'observed',
        uncertainty: { kind: 'unknown' },
        provenance: ['test'],
        access_scopes: ['clinical'],
      },
      {
        id: 'person.trust',
        value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
        initial_value: { kind: 'scalar', value: 0.5 },
        update_mode: 'static',
        uncertainty: { kind: 'unknown' },
        provenance: ['test'],
        access_scopes: ['clinical'],
      },
    ],
    decomposition: [],
    dependencies: [],
    laws: [],
    initial_claims: [],
    ...(revision === 1
      ? {
          meaning_model: {
            schema: 'life-sim-rust-meaning-model/v1',
            concepts: [],
            abstract_relations: [],
            abstract_cuts: [],
            referents: [{
              id: 'referent.person',
              boundary: 'one modeled person',
              continuity_criterion: 'the same person across the interval',
              uncertainty: { kind: 'unknown' },
              provenance: ['provider proposal'],
            }],
            encapsulation_cuts: [],
            events: [],
            event_referent_bindings: [],
            physical_cuts: [],
            realizations: [],
          },
        }
      : {}),
  };
}

function observationClaim(value = 0.4) {
  return {
    id: 'accepted.stress.observation',
    subject: 'person.stress',
    value: { kind: 'scalar', value },
    uncertainty: { kind: 'exact' },
    evidence_type: 'observation',
    holder: 'operator',
    evidence_cutoff: 4,
    provenance: ['sensor:test'],
    authority: { source: 'sensor:test', weight: 1 },
    access_scopes: ['clinical'],
  };
}

function providerClaim(value = 0.7, evidenceType = 'observation') {
  return {
    id: 'provider.stress.estimate',
    subject: 'person.stress',
    value: { kind: 'scalar', value },
    uncertainty: { kind: 'standard_deviation', value: 0.15 },
    evidence_type: evidenceType,
    holder: 'provider:test',
    evidence_cutoff: 4,
    provenance: ['provider:test', 'request evidence only'],
    authority: { source: 'provider:test', weight: 0.5 },
    access_scopes: ['clinical'],
  };
}

function backendState() {
  const state = {
    headHash,
    calls: [],
  };
  return {
    state,
    backend: {
      async initialize() { return {}; },
      async close() {},
      status() { return { persistenceMode: 'volatile-test' }; },
      async call(operation, payload) {
        state.calls.push(operation);
        if (operation === 'get_world') {
          return {
            schema: 'life-sim-rust-world-head/v1',
            model_hash: baseHash,
            model_revision: 0,
            world_id: payload.world_id,
            version: state.headHash === headHash ? 2 : 3,
            time: state.headHash === headHash ? 4 : 5,
            world_hash: state.headHash,
            state: {},
            claims: { 'accepted.stress.observation': observationClaim() },
          };
        }
        if (operation === 'get_model') {
          return {
            model: model(0),
            summary: { model_hash: baseHash, revision: { number: 0 } },
          };
        }
        if (operation === 'query_view') {
          return {
            world_hash: state.headHash,
            version: state.headHash === headHash ? 2 : 3,
            time: state.headHash === headHash ? 4 : 5,
            state: {
              'person.stress': { kind: 'scalar', value: 0.4 },
              'person.trust': { kind: 'scalar', value: 0.5 },
            },
            claims: { 'accepted.stress.observation': observationClaim() },
          };
        }
        if (operation === 'validate_model') {
          return {
            model: payload.model,
            summary: {
              model_hash: proposedHash,
              revision: payload.model.revision,
              process_count: 2,
            },
          };
        }
        throw new Error(`Unexpected backend operation ${operation}.`);
      },
    },
  };
}

function serviceWithWorld() {
  const fixture = backendState();
  const service = new LifeSimulationService({ backend: fixture.backend });
  service.worlds.set('world-estimation', {
    id: 'world-estimation',
    modelHash: baseHash,
  });
  return { service, ...fixture };
}

async function createRequest(service) {
  return service.createEstimationRequest({
    worldId: 'world-estimation',
    requestId: 'create-estimation-test',
    operation: 'estimate',
    intent: 'reality',
    evidenceCutoff: 4,
    coordinates: [
      { id: 'stress-now', processId: 'person.stress', targetTime: 4 },
      { id: 'trust-now', processId: 'person.trust', targetTime: 4 },
    ],
    accessScopes: ['clinical'],
    context: 'Estimate only from the supplied evidence projection.',
  });
}

function response(request, overrides = {}) {
  return {
    estimationRequestId: request.estimationRequestId,
    requestId: 'submit-estimation-test',
    dispositions: [
      { coordinateId: 'stress-now', status: 'known', reason: 'provider produced a value' },
      { coordinateId: 'trust-now', status: 'unknown', reason: 'insufficient evidence' },
    ],
    provisionalClaims: [{
      coordinateId: 'stress-now',
      outputMode: 'observed',
      valueTime: 4,
      claim: providerClaim(),
      acknowledgedClaimIds: ['accepted.stress.observation'],
    }],
    semanticChanges: [{
      collection: 'referents',
      action: 'add',
      id: 'referent.person',
      definition: model(1).meaning_model.referents[0],
      reason: 'Bind future semantic claims to a stable person referent.',
    }],
    proposedModel: model(1),
    proposalReason: 'Add the optional referent while retaining the observed process.',
    ...overrides,
  };
}

test('provider exchange binds evidence, preserves exact coverage, and stays uncommitted', async () => {
  const { service, state } = serviceWithWorld();
  const request = await createRequest(service);
  assert.deepEqual(await createRequest(service), request);
  assert.equal(request.modelHash, baseHash);
  assert.equal(request.modelRevision, 0);
  assert.equal(request.acceptedHeadHash, headHash);
  assert.deepEqual(Object.keys(request.evidenceProjection.state).sort(), [
    'person.stress',
    'person.trust',
  ]);

  const submittedInput = response(request);
  const submitted = await service.submitEstimationResponse(submittedInput);
  assert.deepEqual(await service.submitEstimationResponse(submittedInput), submitted);
  assert.equal(submitted.rustValidated, true);
  assert.equal(submitted.committed, false);
  assert.equal(submitted.modelRegistrationPerformed, false);
  assert.equal(submitted.worldMutationPerformed, false);
  assert.deepEqual(submitted.dispositionCounts, { known: 1, unknown: 1, unmodeled: 0 });
  assert.equal(submitted.strongerClaimConflicts.length, 1);
  assert.equal(submitted.strongerClaimConflicts[0].overwritePerformed, false);
  assert.equal(submitted.observationIngestion.status, 'review_required');
  assert.equal(submitted.observationIngestion.rustHook, 'ModelTransitionSpec.observations');
  assert.equal(submitted.observationMaterializationNextStep, undefined);
  assert.equal(state.calls.includes('register_model'), false);
  assert.equal(state.calls.includes('revise_model'), false);

  const review = await service.reviewEstimationProposal({
    proposalId: submitted.proposalId,
    requestId: 'review-estimation-test',
    verdict: 'approved',
    rationale: 'The schema revision is valid; observation ingestion remains separate.',
  });
  assert.equal(review.modelRegistrationPerformed, false);
  assert.equal(review.registrationNextStep.tool, 'life_model_revise');
  assert.equal(
    review.observationMaterializationNextStep.status,
    'blocked_current_or_historical_values',
  );
  assert.equal(review.observationMaterializationNextStep.blockedOutputs[0].offset, 0);
  assert.equal(review.observationMaterializationNextStep.queryFragment, null);
  assert.equal(state.calls.includes('revise_model'), false);
  assert.equal(state.calls.includes('roll_candidate'), false);
  assert.equal(state.calls.includes('commit_candidate'), false);

  const inspected = await service.inspectEstimationProposal({
    proposalId: submitted.proposalId,
    includeProposedModel: true,
  });
  assert.equal(inspected.proposedModel.revision.previous_model_hash, baseHash);
  assert.equal(inspected.reviews.length, 1);
});

test('strong accepted observations cannot be silently overwritten', async () => {
  const { service } = serviceWithWorld();
  const request = await createRequest(service);
  const unacknowledged = response(request, {
    requestId: 'submit-unacknowledged-conflict',
    provisionalClaims: [{
      coordinateId: 'stress-now',
      outputMode: 'estimated',
      valueTime: 4,
      claim: providerClaim(0.7, 'estimate'),
      acknowledgedClaimIds: [],
    }],
  });
  await assert.rejects(
    service.submitEstimationResponse(unacknowledged),
    /conflicts with stronger accepted claim accepted\.stress\.observation/,
  );
  assert.equal(service.estimationProposals.size, 0);
});

test('request creation rejects a historical cutoff rather than leaking later head state', async () => {
  const { service } = serviceWithWorld();
  await assert.rejects(
    service.createEstimationRequest({
      worldId: 'world-estimation',
      requestId: 'historical-cutoff-without-snapshot',
      operation: 'infer',
      intent: 'reality',
      evidenceCutoff: 3,
      coordinates: [{ id: 'stress-past', processId: 'person.stress', targetTime: 3 }],
      accessScopes: ['clinical'],
      context: 'This must fail rather than expose time-four state as time-three evidence.',
    }),
    /cannot precede the accepted head time/,
  );
  await assert.rejects(
    service.createEstimationRequest({
      worldId: 'world-estimation',
      requestId: 'future-cutoff-outside-assimilation',
      operation: 'estimate',
      intent: 'reality',
      evidenceCutoff: 5,
      coordinates: [{ id: 'stress-future', processId: 'person.stress', targetTime: 5 }],
      accessScopes: ['clinical'],
      context: 'An estimate cannot silently claim a later external evidence cutoff.',
    }),
    /Only assimilate may declare external evidence after the accepted head time/,
  );
});

test('approved positive forward observations return an exact Rust query fragment without rolling', async () => {
  const { service, state } = serviceWithWorld();
  const request = await service.createEstimationRequest({
    worldId: 'world-estimation',
    requestId: 'create-forward-observation-request',
    operation: 'assimilate',
    intent: 'reality',
    evidenceCutoff: 5,
    coordinates: [{
      id: 'stress-at-five',
      processId: 'person.stress',
      targetTime: 5,
      question: 'Assimilate the externally supplied time-five observation.',
    }],
    accessScopes: ['clinical'],
    context: 'The external observation is available through time five.',
  });
  const submitted = await service.submitEstimationResponse({
    estimationRequestId: request.estimationRequestId,
    requestId: 'submit-forward-observation',
    dispositions: [{
      coordinateId: 'stress-at-five',
      status: 'known',
      reason: 'A time-stamped external observation was supplied.',
    }],
    provisionalClaims: [{
      coordinateId: 'stress-at-five',
      outputMode: 'observed',
      valueTime: 5,
      claim: {
        ...providerClaim(0.7),
        id: 'provider.stress.at-five',
        evidence_cutoff: 5,
      },
      acknowledgedClaimIds: [],
    }],
  });
  assert.equal(submitted.modelProposalIncluded, false);
  assert.equal(submitted.rustValidated, false);
  assert.equal(submitted.rustValidationNotApplicable, true);
  assert.equal(submitted.proposedModelHash, undefined);
  assert.equal(submitted.observationIngestion.status, 'review_required');
  assert.deepEqual(submitted.strongerClaimConflicts, []);
  assert.equal(state.calls.includes('validate_model'), false);

  const review = await service.reviewEstimationProposal({
    proposalId: submitted.proposalId,
    requestId: 'approve-forward-observation',
    verdict: 'approved',
    rationale: 'The typed forward observation and schema proposal are acceptable.',
  });
  assert.equal(review.modelProposalIncluded, false);
  assert.equal(review.rustRevalidated, false);
  assert.equal(review.rustRevalidationNotApplicable, true);
  assert.equal(review.registrationNextStep, undefined);
  const plan = review.observationMaterializationNextStep;
  assert.equal(plan.status, 'ready');
  assert.equal(plan.modelHash, baseHash);
  assert.equal(plan.acceptedHeadHash, headHash);
  assert.equal(plan.maximumOffset, 1);
  assert.deepEqual(plan.queryFragment, {
    schema: 'life-sim-rust-model-query/v1',
    direction: 'forward',
    interventions: [],
    observations: [{
      id: 'provider.stress.at-five',
      target: 'person.stress',
      offset: 1,
      value: { kind: 'scalar', value: 0.7 },
      unit: null,
      uncertainty: { kind: 'standard_deviation', value: 0.15 },
      evidence_type: 'observation',
      holder: 'provider:test',
      provenance: ['provider:test', 'request evidence only'],
      authority: { source: 'provider:test', weight: 0.5 },
    }],
    selected_support: [],
    requested_observables: ['person.stress'],
    access_scopes: ['clinical'],
  });
  assert.equal(plan.requirements.callerChooses.includes('step_size'), true);
  assert.deepEqual(plan.explicitNextSteps.map(({ tool }) => tool), [
    'life_candidate_roll',
    'life_candidate_accept',
  ]);
  assert.equal(state.calls.includes('roll_candidate'), false);
  assert.equal(state.calls.includes('commit_candidate'), false);
  assert.equal(state.calls.includes('validate_model'), false);

  const inspected = await service.inspectEstimationProposal({
    proposalId: submitted.proposalId,
    includeProposedModel: true,
  });
  assert.equal(inspected.modelProposalIncluded, false);
  assert.equal(inspected.proposedModel, undefined);
  assert.deepEqual(inspected.semanticChanges, []);
});

test('response validation rejects partial coverage, mistyped values, and undeclared semantic edits', async () => {
  const { service } = serviceWithWorld();
  const request = await createRequest(service);
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'partial-disposition',
      dispositions: [{
        coordinateId: 'stress-now',
        status: 'known',
        reason: 'missing the second coordinate',
      }],
    })),
    /cover every requested coordinate exactly once/,
  );
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'out-of-bounds-value',
      provisionalClaims: [{
        coordinateId: 'stress-now',
        outputMode: 'observed',
        valueTime: 4,
        claim: providerClaim(1.5),
        acknowledgedClaimIds: ['accepted.stress.observation'],
      }],
    })),
    /lies outside person\.stress bounds/,
  );
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'observed-cutoff-mismatch',
      provisionalClaims: [{
        coordinateId: 'stress-now',
        outputMode: 'observed',
        valueTime: 4,
        claim: { ...providerClaim(), evidence_cutoff: 3 },
        acknowledgedClaimIds: ['accepted.stress.observation'],
      }],
    })),
    /evidence_cutoff equal to valueTime/,
  );
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'observed-scope-mismatch',
      provisionalClaims: [{
        coordinateId: 'stress-now',
        outputMode: 'observed',
        valueTime: 4,
        claim: { ...providerClaim(), access_scopes: [] },
        acknowledgedClaimIds: ['accepted.stress.observation'],
      }],
    })),
    /access scopes must exactly match the target process scopes/,
  );
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'undeclared-semantic-edit',
      semanticChanges: [],
    })),
    /Meaning Model change referents\/referent\.person was not declared/,
  );
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'semantic-change-without-model',
      proposedModel: undefined,
      proposalReason: undefined,
    })),
    /semanticChanges require a complete proposedModel successor revision/,
  );
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'model-without-reason',
      proposalReason: undefined,
    })),
    /proposedModel requires proposalReason/,
  );
});

test('semantic changes use context and temporal identities without collapsing multiple records', () => {
  for (const [collection, key, record, replacement] of [
    ['context_roots', 'event_id', { kind: 'inner', provenance: ['test'] }, { kind: 'understanding' }],
    ['temporal_cut_recompositions', 'parent_cut_id', {
      coverage: 'partial', children: [{ cut_id: 'child', projection: { kind: 'identity' } }],
      provenance: ['test'],
    }, { coverage: 'complete' }],
  ]) {
    const baseModel = model();
    baseModel.meaning_model = {
      schema: 'life-sim-rust-meaning-model/v1',
      [collection]: ['first', 'second'].map((id) => ({ ...record, [key]: id })),
    };
    const proposedModel = structuredClone(baseModel);
    proposedModel.revision = model(1).revision;
    const updated = { ...proposedModel.meaning_model[collection][0], ...replacement };
    proposedModel.meaning_model[collection][0] = updated;
    const validate = (semanticChanges) => validateEstimationResponseInput({
      dispositions: [{ coordinateId: 'trust-now', status: 'unknown', reason: 'No estimate' }],
      provisionalClaims: [], semanticChanges, proposedModel, proposalReason: 'Update semantic detail',
    }, {
      request: {
        coordinates: [{ id: 'trust-now', processId: 'person.trust' }],
        modelHash: baseHash, modelRevision: 0,
      },
      baseModel, worldProjection: { claims: {} }, meaningCollections: meaningModelCollections,
    });
    assert.throws(() => validate([]), {
      message: `Meaning Model change ${collection}/first was not declared.`,
    });
    const change = { collection, action: 'replace', id: 'first', definition: updated, reason: 'Explicit replacement' };
    assert.doesNotThrow(() => validate([change]));
    assert.throws(() => validate([{ ...change, definition: { ...updated, [key]: 'second' } }]),
      /definition must exactly equal the proposed model record/);

    proposedModel.meaning_model[collection].shift();
    assert.throws(() => validate([]), {
      message: `Meaning Model change ${collection}/first was not declared.`,
    });
    assert.doesNotThrow(() => validate([{ collection, action: 'remove', id: 'first', reason: 'Explicit removal' }]));
  }
});

test('observed outputs require observed processes and stale proposals cannot be approved', async () => {
  const { service, state } = serviceWithWorld();
  const request = await createRequest(service);
  await assert.rejects(
    service.submitEstimationResponse(response(request, {
      requestId: 'wrong-observed-process',
      dispositions: [
        { coordinateId: 'stress-now', status: 'unknown', reason: 'not supplied' },
        { coordinateId: 'trust-now', status: 'known', reason: 'treated as observation' },
      ],
      provisionalClaims: [{
        coordinateId: 'trust-now',
        outputMode: 'observed',
        valueTime: 4,
        claim: { ...providerClaim(0.6), id: 'provider.trust', subject: 'person.trust' },
        acknowledgedClaimIds: [],
      }],
    })),
    /only for a process with update_mode observed/,
  );

  const submitted = await service.submitEstimationResponse(response(request, {
    requestId: 'stale-proposal-submit',
  }));
  state.headHash = 'd'.repeat(64);
  await assert.rejects(
    service.reviewEstimationProposal({
      proposalId: submitted.proposalId,
      requestId: 'stale-proposal-review',
      verdict: 'approved',
      rationale: 'Would approve if the head were current.',
    }),
    /stale estimation proposal cannot be approved/,
  );
});
