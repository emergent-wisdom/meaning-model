import assert from 'node:assert/strict';
import test from 'node:test';

import { routeCandidates } from '../src/candidate-router.mjs';

function model() {
  return {
    schema: 'life-sim-rust-model/v1',
    processes: [
      {
        id: 'actor.want.safety',
        value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      },
      {
        id: 'actor.fear.loss',
        value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      },
    ],
  };
}

function record(candidateHash, safety, fear, startSafety = 0.4) {
  return {
    status: 'pending',
    candidate: {
      candidate_hash: candidateHash,
      model_hash: 'm'.repeat(64),
      parent_world_hash: 'p'.repeat(64),
      expected_parent_version: 2,
      start_time: 4,
      end_time: 5,
      dynamics_hash: 'd'.repeat(64),
      successor_state: {
        'actor.want.safety': { kind: 'scalar', value: safety },
        'actor.fear.loss': { kind: 'scalar', value: fear },
      },
      path: {
        samples: [{
          time: 4,
          state: {
            'actor.want.safety': { kind: 'scalar', value: startSafety },
            'actor.fear.loss': { kind: 'scalar', value: 0.5 },
          },
        }],
      },
    },
  };
}

test('routes matched candidates from explicit character state without changing canon', () => {
  const result = routeCandidates({
    routeId: 'route-1',
    worldId: 'world-1',
    model: model(),
    records: [
      { candidateId: 'candidate-a', record: record('a'.repeat(64), 0.8, 0.2) },
      { candidateId: 'candidate-b', record: record('b'.repeat(64), 0.5, 0.7) },
    ],
    terms: [
      {
        termId: 'preserve-safety',
        fieldId: 'actor.want.safety',
        source: 'endpoint',
        preference: 'maximize',
        weight: 2,
      },
      {
        termId: 'reduce-fear',
        fieldId: 'actor.fear.loss',
        source: 'endpoint',
        preference: 'minimize',
        weight: 1,
      },
    ],
  });

  assert.equal(result.ranking[0].candidateId, 'candidate-a');
  assert.equal(result.recommendation.advisoryOnly, true);
  assert.equal(result.authority.declaredScalarStateUsed, true);
  assert.equal(result.authority.canonicalWorldMutation, false);
  assert.equal(result.authority.actorSelectionAuthorityClaimed, false);
  assert.match(result.routeHash, /^[a-f0-9]{64}$/);
});

test('supports change terms and rejects mixed frozen parents', () => {
  const input = {
    routeId: 'route-change',
    worldId: 'world-1',
    model: model(),
    records: [
      { candidateId: 'candidate-a', record: record('a'.repeat(64), 0.9, 0.2) },
      { candidateId: 'candidate-b', record: record('b'.repeat(64), 0.5, 0.2) },
    ],
    terms: [{
      termId: 'safety-gain',
      fieldId: 'actor.want.safety',
      source: 'change',
      preference: 'maximize',
      weight: 1,
    }],
  };
  assert.equal(routeCandidates(input).ranking[0].candidateId, 'candidate-a');

  const mixed = structuredClone(input);
  mixed.records[1].record.candidate.parent_world_hash = 'q'.repeat(64);
  assert.throws(() => routeCandidates(mixed), /same model, frozen parent, interval, and dynamics/);

  const mismatchedDynamics = structuredClone(input);
  mismatchedDynamics.records[1].record.candidate.dynamics_hash = 'e'.repeat(64);
  assert.throws(
    () => routeCandidates(mismatchedDynamics),
    /same model, frozen parent, interval, and dynamics/,
  );
});

test('requires a scalar field and retained start state for change routing', () => {
  const missingStart = record('a'.repeat(64), 0.9, 0.2);
  missingStart.candidate.path.samples = [];
  assert.throws(() => routeCandidates({
    routeId: 'route-invalid',
    worldId: 'world-1',
    model: model(),
    records: [
      { candidateId: 'candidate-a', record: missingStart },
      { candidateId: 'candidate-b', record: record('b'.repeat(64), 0.5, 0.2) },
    ],
    terms: [{
      termId: 'safety-gain',
      fieldId: 'actor.want.safety',
      source: 'change',
      preference: 'maximize',
      weight: 1,
    }],
  }), /retain its interval start/);
});
