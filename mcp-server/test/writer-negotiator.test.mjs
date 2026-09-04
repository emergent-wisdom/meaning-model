import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWriterContract,
  evaluateWriterPlan,
} from '../src/writer-negotiator.mjs';

function contract() {
  return createWriterContract({
    contractId: 'contract_1',
    worldId: 'world_1',
    sourceCandidateHash: 'candidate-hash',
    acceptedHeadHash: 'accepted-head-hash',
    acceptedHeadVersion: 1,
    timeUnit: 'day',
    interval: { startTime: 0, endTime: 1 },
    brief: 'Write a scene that respects the accepted trajectory.',
    availableFields: [
      { fieldId: 'person.ada.stress', start: 0.2, end: 0.8 },
      { fieldId: 'relation.ada.bo.trust', start: 0.7, end: 0.65 },
      { fieldId: 'world.rain', start: 0.1, end: 0.4 },
    ],
    requestedFields: [
      { fieldId: 'person.ada.stress', status: 'hard', causallyRelevant: true },
      { fieldId: 'relation.ada.bo.trust', status: 'renegotiable', causallyRelevant: true },
      { fieldId: 'world.rain', status: 'optional', causallyRelevant: false },
    ],
  });
}

function graphContext() {
  const snapshotHash = 'a'.repeat(64);
  return {
    snapshotHash,
    globalSkeleton: {
      schema: 'life-sim-rust-graph/v1',
      mode: 'skeleton',
      snapshot_hash: snapshotHash,
      skeleton: { process_count: 3, law_count: 2 },
    },
    activeSlice: {
      schema: 'life-sim-rust-graph/v1',
      mode: 'neighborhood',
      snapshot_hash: snapshotHash,
      neighborhood: { crossing_edge_count: 2 },
    },
    wholeGraphAccess: {
      tool: 'life_graph_query',
      mode: 'full',
      source: { candidateHash: 'b'.repeat(64) },
      expectedSnapshotHash: snapshotHash,
    },
  };
}

test('a resolution-aware contract retains skeleton, bounded slice, and whole-graph route', () => {
  const base = contract();
  const withGraph = createWriterContract({
    contractId: 'contract_graph',
    worldId: base.worldId,
    sourceCandidateHash: base.authority.sourceCandidateHash,
    acceptedHeadHash: base.authority.acceptedHeadHash,
    acceptedHeadVersion: base.authority.acceptedHeadVersion,
    timeUnit: base.interval.timeUnit,
    interval: { startTime: base.interval.startTime, endTime: base.interval.endTime },
    brief: base.brief,
    availableFields: base.fields,
    requestedFields: base.fields.map(({ fieldId, status, causallyRelevant }) => ({
      fieldId,
      status,
      causallyRelevant,
    })),
    graphContext: graphContext(),
  });

  assert.equal(withGraph.schema, 'life-sim-writer-contract/v2');
  assert.equal(withGraph.graphContext.invariants.canonicalGraphRemainsInRust, true);
  assert.equal(withGraph.graphContext.invariants.activeSliceIsAProjection, true);
  assert.equal(withGraph.graphContext.invariants.crossingEdgesPreserved, true);
  assert.equal(withGraph.graphContext.wholeGraphAccess.mode, 'full');
});

test('a graph-aware contract rejects an unbound whole-graph expansion route', () => {
  const base = contract();
  const context = graphContext();
  context.wholeGraphAccess.expectedSnapshotHash = 'b'.repeat(64);
  assert.throws(() => createWriterContract({
    contractId: 'contract_stale_graph_route',
    worldId: base.worldId,
    sourceCandidateHash: base.authority.sourceCandidateHash,
    acceptedHeadHash: base.authority.acceptedHeadHash,
    acceptedHeadVersion: base.authority.acceptedHeadVersion,
    timeUnit: base.interval.timeUnit,
    interval: { startTime: base.interval.startTime, endTime: base.interval.endTime },
    brief: base.brief,
    availableFields: base.fields,
    requestedFields: base.fields.map(({ fieldId, status, causallyRelevant }) => ({
      fieldId,
      status,
      causallyRelevant,
    })),
    graphContext: context,
  }), /whole-graph expansion route/);
});

test('a complete adhering writer plan is renderable', () => {
  const plan = evaluateWriterPlan({
    planId: 'plan_valid',
    contract: contract(),
    currentHeadHash: 'accepted-head-hash',
    dispositions: [
      { fieldId: 'person.ada.stress', disposition: 'explicit_dramatization' },
      { fieldId: 'relation.ada.bo.trust', disposition: 'implicit_adherence' },
      { fieldId: 'world.rain', disposition: 'omit_surface_prose' },
    ],
  });
  assert.equal(plan.renderable, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.canonicalWorldMutation, false);
  assert.equal(plan.headHashAfter, plan.headHashBefore);
  assert.deepEqual(plan.actionGuidance, {
    badWording: 'rerender_same_canon',
    excessiveState: 'hide_redundant_soft_fields',
    implausibleDynamics: 'revise_profile_and_rerun',
    uninterestingRandomFuture: 'whole_reroll_from_same_frozen_parent',
    incompatibleAcceptedHistory: 'fork_before_conflict_and_resimulate',
  });
});

test('omitting or conflicting with a causally relevant hard field blocks rendering', () => {
  for (const disposition of ['omit_surface_prose', 'conflict_detected']) {
    const plan = evaluateWriterPlan({
      planId: `plan_${disposition}`,
      contract: contract(),
      currentHeadHash: 'accepted-head-hash',
      dispositions: [
        { fieldId: 'person.ada.stress', disposition },
        { fieldId: 'relation.ada.bo.trust', disposition: 'implicit_adherence' },
        { fieldId: 'world.rain', disposition: 'omit_surface_prose' },
      ],
    });
    assert.equal(plan.renderable, false);
    assert.ok(plan.blockers.some(({ fieldId }) => fieldId === 'person.ada.stress'));
  }
});

test('renegotiation returns a model-revision-and-rerun request without changing canon', () => {
  const plan = evaluateWriterPlan({
    planId: 'plan_revise',
    contract: contract(),
    currentHeadHash: 'newer-head-hash',
    dispositions: [
      { fieldId: 'person.ada.stress', disposition: 'implicit_adherence' },
      {
        fieldId: 'relation.ada.bo.trust',
        disposition: 'request_profile_revision',
        explanation: 'The requested scene needs a slower decline.',
      },
      { fieldId: 'world.rain', disposition: 'omit_surface_prose' },
    ],
  });
  assert.equal(plan.renderable, false);
  assert.equal(plan.revisionRequests.length, 1);
  assert.equal(plan.revisionRequests[0].action, 'revise-model-and-rerun-from-source-parent');
  assert.equal(plan.revisionRequests[0].canonMutationAuthorized, false);
  assert.equal(plan.headHashAfter, 'newer-head-hash');
});

test('plans require exact field coverage and only renegotiable fields may request revision', () => {
  assert.throws(
    () => evaluateWriterPlan({
      planId: 'plan_missing',
      contract: contract(),
      currentHeadHash: 'accepted-head-hash',
      dispositions: [
        { fieldId: 'person.ada.stress', disposition: 'implicit_adherence' },
      ],
    }),
    /cover every writer-contract field exactly once/,
  );
  const invalidRevision = evaluateWriterPlan({
    planId: 'plan_bad_revision',
    contract: contract(),
    currentHeadHash: 'accepted-head-hash',
    dispositions: [
      { fieldId: 'person.ada.stress', disposition: 'implicit_adherence' },
      { fieldId: 'relation.ada.bo.trust', disposition: 'implicit_adherence' },
      { fieldId: 'world.rain', disposition: 'request_profile_revision' },
    ],
  });
  assert.equal(invalidRevision.renderable, false);
  assert.ok(invalidRevision.blockers.some(({ code }) => code === 'revision-not-permitted'));
  assert.deepEqual(invalidRevision.revisionRequests, []);
});
