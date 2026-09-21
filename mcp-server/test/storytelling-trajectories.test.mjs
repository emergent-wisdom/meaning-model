import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTrajectoryExplore, reviseTrajectory, trajectoryProposalSchema }
  from '../src/storytelling-trajectories.mjs';

function exploration(overrides = {}) {
  const shareAxis = (id, meaning) => ({ id, meaning,
    comparisonQuestion: 'How is the character’s attention divided at this point?',
    unit: 'attention share', minimum: 0, maximum: 1 });
  return {
    definition: {
      targetKind: 'life', subjectId: 'character.fern',
      brief: 'Explore a surveyor’s changing relationship to their home settlement.',
      timeUnit: 'age in years',
      axes: [
        { id: 'trust', meaning: 'Confidence that the settlement will support this person.',
          comparisonQuestion: 'How much support does this person expect from the settlement?',
          unit: 'authored scale, -1 distrust to 1 trust', minimum: -1, maximum: 1 },
        shareAxis('worry', 'Attention occupied by possible loss.'),
        shareAxis('curiosity', 'Attention occupied by discovery.'),
        shareAxis('remainder', 'Attention occupied by everything else.'),
      ],
      allocations: [{ id: 'attention', question: 'Where is attention directed at this point?',
        axisIds: ['worry', 'curiosity', 'remainder'], total: 1 }],
    },
    points: [
      { id: 'childhood', at: 8, label: 'Earliest established history',
        values: { trust: 0.4, worry: 0.2, curiosity: 0.5, remainder: 0.3 }, fixed: ['worry'] },
      { id: 'departure', at: 24, label: 'Leaving to train as a surveyor',
        values: { trust: -0.2, worry: 0.3, curiosity: 0.4, remainder: 0.3 }, fixed: ['trust'] },
      { id: 'return', at: 58, label: 'Returning before the story opens',
        values: { trust: 0.7, worry: 0.1, curiosity: 0.2, remainder: 0.7 }, fixed: [] },
    ],
    randomness: 0.65, candidateCount: 4, seed: 'fern-life-v1', ...overrides,
  };
}

function proposal(input = exploration()) {
  const task = prepareTrajectoryExplore(input);
  return { definition: task.definition, candidate: task.candidates[0] };
}

test('seeded numerical exploration is reproducible, bounded and preserves its input', () => {
  const input = exploration();
  const original = structuredClone(input);
  const first = prepareTrajectoryExplore(input);
  assert.deepEqual(prepareTrajectoryExplore(input), first);
  assert.deepEqual(input, original);
  assert.deepEqual(first.baseline.points, input.points);
  assert.equal(new Set(first.candidates.map((candidate) => JSON.stringify(candidate.points))).size, 4);
  for (const candidate of first.candidates) {
    assert.notDeepEqual(candidate.points, input.points);
    assert.equal(trajectoryProposalSchema.safeParse({ definition: first.definition, candidate }).success, true);
    for (let i = 0; i < candidate.points.length; i += 1) {
      const point = candidate.points[i];
      assert.equal(point.at, input.points[i].at);
      assert.equal(point.id, input.points[i].id);
      for (const axis of input.definition.axes) {
        assert.equal(typeof point.values[axis.id], 'number');
        assert.ok(Number.isFinite(point.values[axis.id]));
        assert.ok(point.values[axis.id] >= axis.minimum && point.values[axis.id] <= axis.maximum);
      }
      for (const axisId of point.fixed) assert.equal(point.values[axisId], input.points[i].values[axisId]);
      const sum = point.values.worry + point.values.curiosity + point.values.remainder;
      assert.ok(Math.abs(sum - 1) < 1e-12);
    }
  }
  assert.notDeepEqual(prepareTrajectoryExplore({ ...input, seed: 'another-life' }).candidates, first.candidates);
});

test('zero randomness returns exact baseline values and the same draw scales with randomness', () => {
  const zero = prepareTrajectoryExplore(exploration({ randomness: 0 }));
  for (const candidate of zero.candidates) assert.deepEqual(candidate.points, zero.baseline.points);
  const half = prepareTrajectoryExplore(exploration({ randomness: 0.5 }));
  const full = prepareTrajectoryExplore(exploration({ randomness: 1 }));
  for (let i = 0; i < half.candidates.length; i += 1) {
    for (let p = 0; p < half.baseline.points.length; p += 1) {
      for (const axisId of Object.keys(half.baseline.points[p].values)) {
        const baseline = half.baseline.points[p].values[axisId];
        const expected = (baseline + full.candidates[i].points[p].values[axisId]) / 2;
        assert.ok(Math.abs(half.candidates[i].points[p].values[axisId] - expected) < 1e-12);
      }
    }
  }
});

test('unrelated axes and a larger candidate budget leave existing keyed draws unchanged', () => {
  const input = exploration({ candidateCount: 2 });
  const first = prepareTrajectoryExplore(input);
  const extended = structuredClone(input);
  extended.candidateCount = 5;
  extended.definition.axes.push({ id: 'distance', meaning: 'Distance from the settlement at this point.',
    comparisonQuestion: 'How far away is this person?', unit: 'km', minimum: 0, maximum: 10_000 });
  for (const point of extended.points) point.values.distance = 500;
  const second = prepareTrajectoryExplore(extended);
  for (let i = 0; i < first.candidates.length; i += 1) {
    for (let p = 0; p < input.points.length; p += 1) {
      for (const axis of input.definition.axes) {
        assert.equal(first.candidates[i].points[p].values[axis.id], second.candidates[i].points[p].values[axis.id]);
      }
    }
  }
});

test('allocation sampling preserves fully fixed groups and the sole remaining free share', () => {
  const input = exploration({ randomness: 1 });
  input.points[0].fixed = ['worry', 'curiosity', 'remainder'];
  input.points[1].fixed = ['worry', 'curiosity'];
  input.points[2].values = { trust: 0.7, worry: 1, curiosity: 0, remainder: 0 };
  input.points[2].fixed = ['worry'];
  const task = prepareTrajectoryExplore(input);
  for (const candidate of task.candidates) {
    for (const axisId of ['worry', 'curiosity', 'remainder']) {
      assert.equal(candidate.points[0].values[axisId], input.points[0].values[axisId]);
    }
    assert.ok(Math.abs(candidate.points[1].values.remainder - 0.3) < 1e-12);
    assert.equal(candidate.points[2].values.curiosity, 0);
    assert.equal(candidate.points[2].values.remainder, 0);
  }
});

test('a local revision retains identity, untouched coordinates, original inputs and hash lineage', () => {
  const source = proposal();
  const original = structuredClone(source);
  const changes = [{ pointId: 'return', axisId: 'trust', value: 0.1,
    reason: 'The return should begin with uncertainty; later events can earn greater trust.' }];
  const revised = reviseTrajectory({ proposal: source, reason: 'Repair the unsupported recovery in trust.', changes });
  assert.deepEqual(source, original);
  assert.deepEqual(revised.definition, source.definition);
  assert.equal(revised.candidate.id, source.candidate.id);
  const expectedPoints = structuredClone(source.candidate.points);
  expectedPoints[2].values.trust = 0.1;
  assert.deepEqual(revised.candidate.points, expectedPoints);
  assert.equal(revised.candidate.revision.number, 1);
  assert.equal(revised.candidate.revision.parentCandidateHash, source.candidate.candidateHash);
  assert.equal(revised.sourceCandidateHash, source.candidate.candidateHash);
  assert.notEqual(revised.candidate.candidateHash, source.candidate.candidateHash);
  assert.deepEqual(revised.candidate.revision.changes,
    [{ ...changes[0], previousValue: source.candidate.points[2].values.trust }]);
  assert.equal(trajectoryProposalSchema.safeParse({ definition: revised.definition, candidate: revised.candidate }).success, true);
});

test('allocation revisions validate the complete edit atomically', () => {
  const source = proposal();
  const original = structuredClone(source);
  const point = source.candidate.points[2];
  const shift = point.values.curiosity / 2;
  const changes = [
    { pointId: 'return', axisId: 'worry', value: point.values.worry + shift, reason: 'Arrival renews a specific concern.' },
    { pointId: 'return', axisId: 'curiosity', value: point.values.curiosity - shift, reason: 'That concern occupies some attention previously directed at discovery.' },
  ];
  assert.throws(() => reviseTrajectory({ proposal: source, reason: 'Incomplete reallocation.', changes: [changes[0]] }), /must sum/);
  assert.deepEqual(source, original);
  const revised = reviseTrajectory({ proposal: source, reason: 'Reallocate attention locally.', changes });
  assert.equal(revised.candidate.points[2].values.remainder, point.values.remainder);
  assert.equal(revised.candidate.points[2].values.trust, point.values.trust);
  assert.deepEqual(revised.candidate.points.slice(0, 2), source.candidate.points.slice(0, 2));
  assert.deepEqual(source, original);
});

test('reason-only revisions preserve all numerical points and chain across successive revisions', () => {
  const source = proposal();
  const first = reviseTrajectory({ proposal: source, reason: 'The confidence at return comes from family ties, not professional success.' });
  assert.deepEqual(first.candidate.points, source.candidate.points);
  assert.deepEqual(first.candidate.revision.changes, []);
  assert.notEqual(first.candidate.candidateHash, source.candidate.candidateHash);
  const second = reviseTrajectory({ proposal: { definition: first.definition, candidate: first.candidate },
    reason: 'The family ties explain confidence in support, while professional doubts remain.' });
  assert.equal(second.candidate.revision.number, 2);
  assert.equal(second.candidate.revision.parentCandidateHash, first.candidate.candidateHash);
  assert.deepEqual(second.candidate.points, source.candidate.points);
});

test('revision rejects stale or reinterpreted proposals, fixed values, unknown coordinates and duplicate edits', () => {
  const source = proposal();
  const stale = structuredClone(source);
  stale.candidate.points[2].values.trust = 0;
  assert.throws(() => reviseTrajectory({ proposal: stale, reason: 'Try a stale proposal.' }), /hash changed/);
  const reinterpreted = structuredClone(source);
  reinterpreted.definition.axes[0].meaning = 'Confidence in personal technical skill.';
  assert.throws(() => reviseTrajectory({ proposal: reinterpreted, reason: 'Silently change the category.' }), /hash changed/);
  const edit = { pointId: 'return', axisId: 'trust', value: 0, reason: 'Local repair.' };
  for (const [changes, error] of [
    [[{ ...edit, pointId: 'departure' }], /fixed value/],
    [[{ ...edit, pointId: 'missing' }], /unknown point or axis/],
    [[{ ...edit, axisId: 'missing' }], /unknown point or axis/],
    [[edit, edit], /only once/],
    [[{ ...edit, value: 2 }], /within its bounds/],
  ]) assert.throws(() => reviseTrajectory({ proposal: source, reason: 'Check the proposed repair.', changes }), error);
});

test('invalid numerical definitions and point structures are rejected before sampling', () => {
  const cases = [
    (input) => { input.definition.axes[0].maximum = -2; },
    (input) => { input.definition.axes[0].comparisonQuestion = ''; },
    (input) => { input.definition.axes[0].id = 'worry'; },
    (input) => { input.definition.axes[1].unit = 'different unit'; },
    (input) => { input.definition.allocations.push({ ...input.definition.allocations[0], id: 'overlap' }); },
    (input) => { input.points[1].at = input.points[0].at; },
    (input) => { input.points[1].id = input.points[0].id; },
    (input) => { delete input.points[1].values.trust; },
    (input) => { input.points[1].values.extra = 0; },
    (input) => { input.points[1].values.trust = 'withdrawn'; },
    (input) => { input.points[1].values.worry = 0.9; },
    (input) => { input.points[1].fixed.push('undefined'); },
    (input) => { input.points.pop(); },
    (input) => { input.randomness = 1.01; },
    (input) => { input.candidateCount = 9; },
  ];
  for (const invalidate of cases) {
    const input = exploration();
    invalidate(input);
    assert.throws(() => prepareTrajectoryExplore(input));
  }
  const event = exploration();
  event.definition.targetKind = 'event';
  event.points.pop();
  assert.equal(prepareTrajectoryExplore(event).candidates[0].points.length, 2);
});

test('an omitted random seed is returned and can replay the exact numerical proposals', () => {
  const input = exploration({ seed: null });
  const first = prepareTrajectoryExplore(input);
  assert.equal(first.sampling.source, 'random');
  assert.match(first.sampling.seed, /^[a-f0-9]{48}$/u);
  const replay = prepareTrajectoryExplore({ ...input, seed: first.sampling.seed });
  assert.deepEqual(replay.candidates, first.candidates);
  assert.deepEqual(replay.baseline, first.baseline);
});
