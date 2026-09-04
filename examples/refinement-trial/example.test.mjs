import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { coarseRecords, fineRecords, witness, revisedTrial, surfaces } from './fixture.mjs';
import { checkRecords, slot, contextOf, visibleAncestry, accessibleEvidence,
  closeRefinement, residual, commit, compareReadback } from './reference.mjs';

const snapshot = () => ({ id: 's0', records: structuredClone(coarseRecords), heads: { trial: 'trial@0' },
  dependencies: { 'trial@0': ['trial-periods', 'trial-realization', 'passage'] }, stale: [] });
const candidate = () => ({ id: 's1', base: 's0', additions: [...fineRecords, ...surfaces] });
const validate = records => { checkRecords(records); closeRefinement(records, witness); };

test('six world forms, lifecycle Bindings and finite participation intervals resolve', () => {
  assert.deepEqual([...new Set(coarseRecords.map(r => r.form))].sort(),
    ['Binding', 'Concept', 'Cut', 'Event', 'Realization', 'Thing']);
  assert.ok(checkRecords(coarseRecords));
  const broken = structuredClone(coarseRecords);
  broken.find(r => r.id === 'trial-engine').interval = [0, 21];
  assert.throws(() => checkRecords(broken));
});

test('answers and remainder are individually addressable without new records', () => {
  assert.equal(slot(coarseRecords, ['outlook@0', 'hopeful']).weight, 0.58);
  assert.equal(slot(coarseRecords, ['outlook@0', 'remainder']).weight, 0.1);
  assert.throws(() => slot(coarseRecords, ['outlook@0', 'missing']));
});

test('valid expansion preserves configuration, results, duration and projected mixture', () => {
  const before = snapshot(), saved = structuredClone(before);
  const next = commit(before, candidate(), validate);
  assert.deepEqual(before, saved);
  assert.equal(next.id, 's1');
  const totals = closeRefinement(next.records, witness);
  assert.ok(Math.abs(totals.hopeful - 0.58) < 1e-12);
  assert.ok(Math.abs(totals.cautious - 0.32) < 1e-12);
  assert.ok(Math.abs(totals.remainder - 0.1) < 1e-12);
});

test('invalid child mixture rejects the whole candidate including text surfaces', () => {
  const before = snapshot(), saved = structuredClone(before), bad = structuredClone(candidate());
  const answers = bad.additions.find(r => r.id === 'setup-outlook').answers;
  answers[0].weight -= 0.2; answers[1].weight += 0.2; // Still sums to one, but not the committed parent.
  assert.throws(() => commit(before, bad, validate), /coarse mixture changed/);
  assert.deepEqual(before, saved);
  assert.ok(!before.records.some(r => r.id === 'passage'));
});

test('overlapping phases and normalized-but-wrong duration shares are rejected', () => {
  const overlap = structuredClone([...coarseRecords, ...fineRecords]);
  overlap.find(r => r.id === 'execution').interval[0] = 1;
  assert.throws(() => checkRecords(overlap), /tile/);
  const wrong = structuredClone([...coarseRecords, ...fineRecords]);
  const answers = wrong.find(r => r.id === 'trial-periods').answers;
  answers[0].weight = 0.3; answers[1].weight = 0.4;
  assert.throws(() => checkRecords(wrong), /duration share/);
});

test('partial coverage has a feasible residual, or fails before completion', () => {
  const remaining = residual([0.58, 0.32, 0.1], [{ share: 0.2, vector: [0.8, 0.1, 0.1] }]);
  remaining.forEach((x, i) => assert.ok(Math.abs(x - [0.42, 0.30, 0.08][i]) < 1e-12));
  assert.throws(() => residual([0.58, 0.32, 0.1], [{ share: 0.9, vector: [0.8, 0.1, 0.1] }]), /negative residual/);
});

test('explicit revision retains history, changes active head and marks dependent output stale', () => {
  const expanded = commit(snapshot(), candidate(), validate);
  const revised = commit(expanded, { id: 's2', base: 's1', additions: [revisedTrial], replacements: { trial: 'trial@1' } }, checkRecords);
  assert.equal(revised.heads.trial, 'trial@1');
  assert.equal(revised.records.find(r => r.id === 'trial@0').data.configuration, 'A');
  assert.equal(revised.records.find(r => r.id === revised.heads.trial).data.configuration, 'B');
  assert.ok(revised.stale.includes('passage'));
  assert.equal(expanded.heads.trial, 'trial@0');
  assert.throws(() => commit(expanded, candidate(), validate), /stale base/);
});

test('same-ID edits cannot masquerade as refinement; changed configuration fails Close', () => {
  assert.throws(() => commit(snapshot(), { id: 'bad', base: 's0', additions: [coarseRecords.find(r => r.id === 'trial@0')] }, validate), /overwrite/);
  const edited = structuredClone([...coarseRecords, ...fineRecords]);
  edited.find(r => r.id === 'trial@0').data.configuration = 'B';
  assert.throws(() => closeRefinement(edited, witness), /protected fact changed/);
  const fineEdit = structuredClone([...coarseRecords, ...fineRecords]);
  fineEdit.find(r => r.id === 'execution').data.cases = 11;
  assert.throws(() => closeRefinement(fineEdit, witness), /fine projection changed/);
});

test('authority paths do not follow about links or expose another private context', () => {
  assert.equal(contextOf(coarseRecords, 'ada-outlook'), 'ada');
  assert.equal(contextOf(coarseRecords, 'constructor-belief'), 'constructor');
  assert.throws(() => visibleAncestry(coarseRecords, 'constructor-belief', ['world', 'ada']), /not visible/);
  assert.deepEqual(visibleAncestry(coarseRecords, 'outlook@0', ['world', 'ada']),
    ['outlook@0', 'ada-outlook', 'ada-inner', 'ada-life', 'history']);
  const cyclic = structuredClone(coarseRecords);
  cyclic.find(r => r.id === 'ada-outlook').authorityParent = 'ada-outlook';
  assert.throws(() => contextOf(cyclic, 'ada-outlook'), /cycle/);
  const cyclicRoot = structuredClone(coarseRecords);
  cyclicRoot.find(r => r.id === 'ada-inner').authorityParent = 'ada-inner';
  assert.throws(() => contextOf(cyclicRoot, 'ada-outlook'), /cycle/);
});

test('cutoff access returns observed content, not the whole source record', () => {
  assert.deepEqual(accessibleEvidence(coarseRecords, 'ada', 2), []);
  assert.deepEqual(accessibleEvidence(coarseRecords, 'ada', 4), [{ configuration: 'A' }]);
});

test('read-back comparison detects changed facts; silence does not recover outlook weights', () => {
  const recovered = JSON.parse(readFileSync(new URL('./readback.json', import.meta.url), 'utf8')).extraction;
  const expected = { configuration: 'A', cases: 12, matches: 12, phaseMinutes: [2, 5, 3], observationMinute: 3 };
  assert.deepEqual(compareReadback(expected, recovered), []);
  assert.deepEqual(compareReadback(expected, { ...recovered, configuration: 'B' }), ['configuration']);
  assert.equal(recovered.outlookWeights, null);
  assert.deepEqual(compareReadback({ outlookWeights: [0.58, 0.32, 0.10] }, recovered), ['outlookWeights']);
});
