import test from 'node:test';
import assert from 'node:assert/strict';
import { typedScalarTrajectories } from '../viewer/public/scalar-trajectories.js';

const series = (extra = {}) => ({ id: 'typed-scalar:depth', kind: 'typed-scalar', processId: 'river.depth', label: 'River depth',
  unit: 'm', frame: 'survey datum', timeUnit: 'day', holder: 'surveyor', mode: 'estimate', evidenceType: 'survey',
  source: { kind: 'process-estimation', modelHash: 'a'.repeat(64), bundleNodeId: 'readings', estimationRequestId: 'survey', proposalId: 'proposal' },
  home: 'river', sourceEventIds: ['first', 'last'], domain: [2, 8], interpolation: { kind: 'linear-visual-guide', extrapolate: false }, conflicts: [],
  points: [{ id: 'first', t: 2, v: 0.123456789012345, valueTime: 24, evidenceCutoff: 20, holder: 'surveyor', mode: 'estimate',
    authority: { kind: 'authored' }, uncertainty: { kind: 'interval', lower: 0.1, upper: 0.2 }, provenance: ['survey notebook'],
    accessScopes: ['author'], born: { order: 2 }, record: { value: { kind: 'scalar', value: 0.123456789012345 } }, reviewStatus: 'approved', acceptedWorldValue: false },
  { id: 'last', t: 8, v: 0.75, valueTime: 96, evidenceCutoff: 80, reviewStatus: 'approved', acceptedWorldValue: false }], ...extra });

test('typed scalar adapter keeps exact readings, source metadata and bounded display coordinates', () => {
  const data = { typedScalarSeries: [series({ domain: [-100, 100] })] }, before = structuredClone(data);
  const [row] = typedScalarTrajectories(data);
  assert.equal(row.kind, 'typed-scalar'); assert.equal(row.id, before.typedScalarSeries[0].id);
  assert.equal(row.processId, 'river.depth'); assert.equal(row.label, 'River depth');
  assert.equal(row.unit, 'm'); assert.equal(row.frame, 'survey datum');
  assert.equal(row.owner, null, 'holder is not inferred to be a process owner');
  assert.equal(row.home, 'river'); assert.deepEqual(row.sourceEventIds, ['first', 'last']);
  assert.deepEqual(row.domain, [2, 8]);
  assert.deepEqual(row.group, { id: 'typed-scalars', label: 'Dated process values' });
  assert.deepEqual(row.interpolation, { kind: 'linear-visual-guide', extrapolate: false });
  assert.deepEqual(row.points, before.typedScalarSeries[0].points);
  assert.equal(row.points[0].acceptedWorldValue, false, 'approval does not promote a reading to accepted-world state');
  assert.deepEqual(data, before);
  row.points[0].record.value.value = 1; row.sourceEventIds.push('invented'); row.source.modelHash = 'changed';
  assert.deepEqual(data, before, 'mutable renderer objects cannot edit native records');
});

test('single, conflicting, invalid and non-increasing samples never produce fabricated curves', () => {
  const valid = series();
  const invalid = [
    series({ points: [] }), series({ points: [valid.points[0]] }),
    series({ interpolation: { kind: 'none', extrapolate: false } }),
    series({ conflicts: [{ t: 2, recordIds: ['first', 'conflicting'] }] }),
    series({ points: [{ t: 2, v: 0 }, { t: 2, v: 1 }] }),
    series({ points: [{ t: 8, v: 1 }, { t: 2, v: 0 }] }),
    series({ points: [{ t: null, v: 0 }, { t: 8, v: 1 }] }),
    series({ points: [{ t: 2, v: NaN }, { t: 8, v: 1 }] }),
    series({ points: [{ t: 2, v: 0 }, { t: Infinity, v: 1 }] }),
    series({ points: [{ t: 2, v: 0 }, { t: 8, v: '1' }] }),
  ];
  const before = structuredClone(invalid);
  assert.deepEqual(typedScalarTrajectories({ typedScalarSeries: invalid }), []);
  assert.deepEqual(invalid, before, 'all source records remain available for the Numbers panel');
  assert.deepEqual(typedScalarTrajectories({}), []);
  assert.deepEqual(typedScalarTrajectories(null), []);
});

test('constant dated readings remain valid curves and separate series never merge', () => {
  const a = series({ points: [{ t: 2, v: 4 }, { t: 8, v: 4 }] }), b = series({ id: 'second-series', holder: 'other', frame: 'another datum' });
  const rows = typedScalarTrajectories({ typedScalarSeries: [a, b] });
  assert.equal(rows.length, 2); assert.deepEqual(rows[0].points.map(({ v }) => v), [4, 4]);
  assert.equal(rows[1].holder, 'other'); assert.equal(rows[1].frame, 'another datum');
  const [unplaced] = typedScalarTrajectories({ typedScalarSeries: [series({ home: undefined, sourceEventIds: undefined })] });
  assert.equal(unplaced.home, null); assert.deepEqual(unplaced.sourceEventIds, []);
});
