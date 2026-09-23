// Fixes for the friction found by the 2026-09-23 crypto-market modeling run, on the real engine.
import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { buildWorldModel } from '../src/general-modeling.mjs';
import { recordJevProcessEstimation } from '../src/jev-process-estimation.mjs';
import { proposeCutShares } from '../src/cut-shares.mjs';

const scope = ['market'];

function scaffold() {
  return {
    id: 'market-friction', scope: 'A synthetic two-process market model.', question: 'How did the rate and the price move?',
    time: { unit: 'month', origin: 'Month 0 is the evidence cutoff; earlier months are negative.' }, accessScopes: scope,
    contextReview: { holder: 'fixture-reviewer', focalInterval: { start: -12, end: 0 },
      broaderContext: { boundary: 'The wider economy.', status: 'out_of_scope', assessment: 'The fixture checks recording, not context.' },
      longerTerm: { interval: null, status: 'unknown', assessment: 'The fixture supplies no longer history.' },
      authoredJudgments: { status: 'unknown', assessment: 'The fixture has no authored scale.' },
      conceptualStructure: { status: 'out_of_scope', assessment: 'No concept needs opening for this test.' },
      conceptVariation: { status: 'unknown', assessment: 'No compared meanings are supplied.' } },
    evidence: [{ id: 'recall', source: 'fixture:recalled-records', text: 'Recalled public records of the policy rate and the price.', evidenceType: 'report', availableAt: 0, holder: 'modeler' }],
    processes: [
      { id: 'rate', meaning: 'Policy-rate upper bound.', unit: 'percent', referenceFrame: 'Announced target range.', type: { kind: 'scalar', minimum: 0, maximum: 20 },
        initial: { value: 3.75, evidenceType: 'report', sourceIds: ['recall'], holder: 'modeler', evidenceCutoff: 0 } },
      { id: 'price', meaning: 'Asset price in dollars.', unit: 'USD', referenceFrame: 'Daily close.', type: { kind: 'scalar', minimum: 0, maximum: 1_000_000 },
        initial: { value: 88_000, evidenceType: 'estimate', sourceIds: ['recall'], holder: 'modeler', evidenceCutoff: 0 } },
    ],
  };
}

async function engine(t) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  return service;
}

async function built(t) {
  const service = await engine(t);
  const preview = await buildWorldModel({ requestId: 'preview', scaffold: scaffold() }, service);
  const applied = await buildWorldModel({ requestId: 'apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service);
  return { service, applied };
}

test('the caller\'s own dated history is recorded through the exchange with its evidence types', async (t) => {
  const { service, applied } = await built(t);
  const request = await service.createEstimationRequest({ worldId: applied.worldId, requestId: 'history', operation: 'infer', intent: 'reality', evidenceCutoff: 0, accessScopes: scope,
    coordinates: [{ id: 'rate.m12', processId: 'rate', targetTime: -12, question: 'Policy-rate upper bound twelve months before the cutoff.' },
      { id: 'price.m12', processId: 'price', targetTime: -12, question: 'Price twelve months before the cutoff.' }] });
  const claim = (id, subject, value, evidence_type, evidence_cutoff, uncertainty) => ({ id, subject, value: { kind: 'scalar', value }, uncertainty, evidence_type, holder: 'modeler',
    evidence_cutoff, provenance: ['fixture:recalled-records'], authority: { source: 'modeler', weight: 1 }, access_scopes: scope });
  const proposal = await service.submitEstimationResponse({ estimationRequestId: request.estimationRequestId, requestId: 'history-response',
    dispositions: [{ coordinateId: 'rate.m12', status: 'known', reason: 'A recalled public record.' }, { coordinateId: 'price.m12', status: 'known', reason: 'An approximate recollection.' }],
    provisionalClaims: [
      { coordinateId: 'rate.m12', outputMode: 'observed', valueTime: -12, claim: claim('hist.rate.m12', 'rate', 4.5, 'report', -12, { kind: 'exact' }) },
      { coordinateId: 'price.m12', outputMode: 'estimated', valueTime: -12, claim: claim('hist.price.m12', 'price', 93_500, 'estimate', 0, { kind: 'interval', lower: 90_000, upper: 97_000 }) },
    ] });
  const recorded = await recordJevProcessEstimation(service, { requestId: 'record-history', proposalId: proposal.proposalId, graphHash: applied.graphHash,
    parentId: applied.summary.understandingRootId, accessScopes: scope, review: { verdict: 'approved', rationale: 'Recalled values, filed with their own evidence types.', holder: 'modeler' } });
  assert.equal(recorded.canonicalGraphRecord, true);
  assert.equal(recorded.recordIds.length, 2);
  const view = await service.queryNarrativeGraph({ graphHash: recorded.graphHash, mode: 'full', includeContent: true, accessScopes: scope });
  const [rate, price] = recorded.recordIds.map((nodeId) => view.nodes.find((node) => node.id === nodeId));
  assert.deepEqual([rate.value_time, rate.evidence_cutoff, rate.evidence_type, rate.epistemic_status], [-12, -12, 'report', 'attributed_report']);
  assert.deepEqual([price.value_time, price.evidence_cutoff, price.evidence_type, price.epistemic_status], [-12, 0, 'estimate', 'attributed_estimate']);
  assert.deepEqual(price.uncertainty, { kind: 'interval', lower: 90_000, upper: 97_000 });
  assert.equal(price.holder, 'modeler');
  assert.equal(JSON.parse(rate.text).value.value, 4.5);
  assert.ok(view.edges.some((edge) => edge.source.node_id === price.id && edge.target.kind === 'anchor' && edge.target.anchor_id === 'price'));
  await assert.rejects(service.inspectEstimationProposal({ proposalId: 'estimate.00000000-0000-0000-0000-000000000000' }), /estimator preview proposal from life_world_model_build/);
});

test('a model revision reports what a world on its parent cannot adopt, and can refuse it', async (t) => {
  const { service, applied } = await built(t);
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  const successor = structuredClone(model);
  successor.revision = { number: 1, previous_model_hash: applied.modelHash, reason: 'Redefine the price.', provenance: ['test'] };
  successor.processes.find((process) => process.id === 'price').scale.semantic_role = 'Asset price in dollars, all venues.';
  await assert.rejects(service.reviseModel({ requestId: 'strict', previousModelHash: applied.modelHash, model: successor, requireWorldAdoptable: true }), /could not adopt this revision, so it was not registered: price \(changed scale \(semantic_role\)\)/);
  const loose = await service.reviseModel({ requestId: 'loose', previousModelHash: applied.modelHash, model: successor });
  assert.equal(loose.worldAdoption.adoptableByParentWorlds, false);
  assert.deepEqual(loose.worldAdoption.blockingChanges, [{ processId: 'price', change: 'changed scale (semantic_role)' }]);
  const head = await service.inspectWorld({ worldId: applied.worldId });
  await assert.rejects(service.reviseWorld({ worldId: applied.worldId, requestId: 'adopt', expectedWorldHash: head.headHash, targetModelHash: loose.modelHash, mode: 'revise', reason: 'Adopt.', provenance: ['test'] }), /cannot reshape or change units, frame, or scale of process price/);

  const compatible = structuredClone(model);
  compatible.revision = { number: 1, previous_model_hash: applied.modelHash, reason: 'Add the all-venue price.', provenance: ['test'] };
  const added = structuredClone(compatible.processes.find((process) => process.id === 'price'));
  added.id = 'price.all_venues'; added.scale = { ...added.scale, semantic_role: 'Asset price in dollars, all venues.' };
  compatible.processes.push(added);
  const revised = await service.reviseModel({ requestId: 'compatible', previousModelHash: applied.modelHash, model: compatible, requireWorldAdoptable: true });
  assert.equal(revised.worldAdoption.adoptableByParentWorlds, true);
  const adopted = await service.reviseWorld({ worldId: applied.worldId, requestId: 'adopt-compatible', expectedWorldHash: head.headHash, targetModelHash: revised.modelHash, mode: 'revise',
    stateValues: { price: { kind: 'scalar', value: 87_000 }, 'price.all_venues': { kind: 'scalar', value: 88_500 } }, reason: 'Revise the price and add the all-venue price.', provenance: ['test'], accessScopes: scope });
  assert.deepEqual(adopted.claimConsistency.claimsDifferingFromState.map((entry) => [entry.claimId, entry.claimValue.value, entry.stateValue.value]), [['general.initial.price', 88_000, 87_000]]);
  assert.deepEqual(adopted.claimConsistency.newProcessesWithoutClaims, ['price.all_venues']);
  assert.match(adopted.claimConsistency.nextStep, /does not write claims/);
});

test('a measured series declared observed takes retrieved reports even when its initial value is an estimate', async (t) => {
  const service = await engine(t);
  const observed = scaffold(); observed.processes[1].updateMode = 'observed';
  const preview = await buildWorldModel({ requestId: 'preview-observed', scaffold: observed }, service);
  const applied = await buildWorldModel({ requestId: 'apply-observed', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service);
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  assert.equal(model.processes.find((process) => process.id === 'price').update_mode, 'observed');
  assert.equal(model.initial_claims.find((claim) => claim.subject === 'price').mode, 'estimated', 'the recalled initial value stays an estimate');
  const request = await service.createEstimationRequest({ worldId: applied.worldId, requestId: 'retrieved', operation: 'infer', intent: 'reality', evidenceCutoff: 0, accessScopes: scope,
    coordinates: [{ id: 'price.m49', processId: 'price', targetTime: -49.7 }] });
  const proposal = await service.submitEstimationResponse({ estimationRequestId: request.estimationRequestId, requestId: 'retrieved-response',
    dispositions: [{ coordinateId: 'price.m49', status: 'known', reason: 'Read from a public price series.' }],
    provisionalClaims: [{ coordinateId: 'price.m49', outputMode: 'observed', valueTime: -49.7, claim: { id: 'retrieved.price.m49', subject: 'price', value: { kind: 'scalar', value: 64_756 },
      uncertainty: { kind: 'interval', lower: 64_756, upper: 64_912 }, evidence_type: 'report', holder: 'fact-check', evidence_cutoff: -49.7, provenance: ['fixture:retrieved-series'],
      authority: { source: 'fact-check', weight: 1 }, access_scopes: scope } }] });
  assert.equal(proposal.provisionalClaimCount, 1);
});

test('validateOnly checks a scaffold without a provider call or a proposal', async (t) => {
  const service = await engine(t);
  let calls = 0;
  const estimator = { backend: 'typesafe', model: 'fake', label: 'typesafe:fake', async estimate() { calls++; throw new Error('must not be called'); } };
  const withQuestion = scaffold();
  withQuestion.processes[1] = { ...withQuestion.processes[1], initial: undefined, initialEstimate: { sourceIds: ['recall'], question: { type: 'score', instructions: 'Estimate the price.', unit: 'USD',
    levels: [{ description: 'Low.', value: 50_000 }, { description: 'High.', value: 120_000 }] } } };
  delete withQuestion.processes[1].initial;
  const validated = await buildWorldModel({ requestId: 'check', scaffold: withQuestion, validateOnly: true }, service, estimator);
  assert.equal(validated.status, 'validated');
  assert.equal(validated.providerCall, false);
  assert.deepEqual(validated.initialEstimateProcessIds, ['price']);
  assert.equal(calls, 0);
  const broken = scaffold(); broken.processes[0].initial.sourceIds = ['missing'];
  await assert.rejects(buildWorldModel({ requestId: 'check-broken', scaffold: broken, validateOnly: true }, service, estimator), /missing/);
  assert.equal(calls, 0);
});

test('a Cut-share event target can divide one answer of a stored Cut', async (t) => {
  const { service, applied } = await built(t);
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  const root = model.meaning_model.context_roots[0].event_id;
  const drivers = await proposeCutShares({ requestId: 'drivers', apply: true, modelHash: applied.modelHash, question: 'What moved the price?', answers: [{ key: 'monetary', meaning: 'Monetary conditions.' }, { key: 'crypto', meaning: 'Crypto-internal causes.' }],
    events: [{ eventId: root, cutId: 'cut.drivers' }], distributions: [{ situationId: root, probabilities: { monetary: 0.6, crypto: 0.3 } }] }, null, service);
  const conduit = await proposeCutShares({ requestId: 'conduit', apply: true, modelHash: drivers.applied.modelHash, question: 'Through which conduit did the monetary part travel?', answers: [{ key: 'stablecoins', meaning: 'Stablecoin supply.' }, { key: 'etfs', meaning: 'ETF flows.' }],
    events: [{ eventId: root, cutId: 'cut.conduit', conditionedOn: { cutId: 'cut.drivers', answerKey: 'monetary' } }], distributions: [{ situationId: root, probabilities: { stablecoins: 0.7, etfs: 0.2 } }] }, null, service);
  const stored = await service.inspectModel({ modelHash: conduit.applied.modelHash, includeDefinition: true });
  assert.deepEqual(stored.model.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.conduit').conditioning, { cut_id: 'cut.drivers', answer_key: 'monetary' });
  await assert.rejects(proposeCutShares({ requestId: 'bad', apply: true, modelHash: drivers.applied.modelHash, question: 'Q?', answers: [{ key: 'a', meaning: 'A.' }],
    events: [{ eventId: root, cutId: 'cut.bad', conditionedOn: { cutId: 'cut.drivers', answerKey: 'nope' } }], distributions: [{ situationId: root, probabilities: { a: 1 } }] }, null, service), /has no answer nope/);
});
