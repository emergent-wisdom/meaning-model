import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { buildWorldModel } from '../src/general-modeling.mjs';
import { createJevProcessEstimator, mapJevProcessAnswer, recordJevProcessEstimation } from '../src/jev-process-estimation.mjs';

const scope = ['research'];
const scalar = (id, unit, maximum = 100) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum } }, initial_value: { kind: 'scalar', value: 0 }, unit, update_mode: 'observed', support: ['test fixture'], uncertainty: { kind: 'unknown' }, provenance: ['test'], access_scopes: scope });
const development = scalar('protocol.development', 'rubric points');
const likelihood = scalar('protocol.statement_probability', 'probability', 1);
const phase = { ...scalar('protocol.phase', 'phase'), value_type: { kind: 'category', variants: ['research', 'deployed'] }, initial_value: { kind: 'category', value: 'research' } };
const mix = { ...scalar('protocol.phase_distribution', 'probability'), value_type: { kind: 'distribution', outcomes: ['research', 'deployed'] }, initial_value: { kind: 'distribution', value: [1, 0] } };
const scoreSpec = { type: 'score', instructions: 'How mature is the protocol?', unit: 'rubric points', levels: [{ description: 'A published research proposal only.', value: 0 }, { description: 'A deployed, measured production protocol.', value: 100 }], minimumConfidence: 0 };
const choiceSpec = { type: 'choice', instructions: 'What development phase has been demonstrated?', criteria: { research: 'A published proposal only.', deployed: 'Production protocol already deployed.' }, minimumConfidence: 0 };
const scoreAnswer = { type: 'score', score: 0.75, confidence: 0.5, probabilities: { 0: 0.25, 1: 0.75 }, legend: { 0: scoreSpec.levels[0].description, 1: scoreSpec.levels[1].description } };
const choiceAnswer = { type: 'choice', choice: 'deployed', probabilities: { research: 0.2, deployed: 0.8 }, confidence: 0.6 };

async function fixture(t, { extraPrivate = false, acceptedObservation = false, processScopes = scope, privatePlacement = false } = {}) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel({ requestId: 'jev-model', model: {
    schema: 'life-sim-rust-model/v1', id: 'jev-general-test', time_unit: 'day',
    revision: { number: 0, reason: 'Independent real-engine process bridge test.', provenance: ['test'] },
    processes: [development, likelihood, phase, mix].map((process) => ({ ...process, access_scopes: processScopes })), decomposition: [], dependencies: [], laws: [],
    initial_claims: acceptedObservation ? [{ id: 'measured.development', subject: development.id, value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' }, evidence_type: 'observation', holder: 'sensor', evidence_cutoff: 0, provenance: ['fixture:measurement'], authority: { source: 'sensor', weight: 1 }, access_scopes: processScopes }] : [],
  } });
  const world = await service.createWorld({ requestId: 'jev-world', modelHash: registered.modelHash });
  const node = { id: 'scope', node_type: 'world_scope', role: 'document_root', text: 'Protocol evidence test.', epistemic_status: 'authored_boundary', evidence_type: 'report', render: 'exclude', training: 'exclude', access_scopes: processScopes, authority: { source: 'test', weight: 1 }, provenance: ['test'] };
  const graph = await service.registerNarrativeGraph({ requestId: 'jev-graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'jev-test-graph', revision: { number: 0, reason: 'World evidence graph.', provenance: ['test'] }, source: { kind: 'model', model_hash: registered.modelHash }, roots: privatePlacement ? ['hidden'] : extraPrivate ? ['scope', 'hidden'] : ['scope'],
    nodes: [node, ...(extraPrivate || privatePlacement ? [{ ...node, id: 'hidden', access_scopes: ['secret'], text: 'Must not disappear.' }] : [])],
    edges: privatePlacement ? [{ id: 'private-placement', source: { kind: 'node', node_id: 'hidden' }, target: { kind: 'node', node_id: 'scope' }, family: 'structural', relation: 'contains', order: 0, access_scopes: ['secret'], provenance: ['test'] }] : [],
  } });
  return { service, registered, world, graph };
}
function input(world, overrides = {}) {
  return { requestId: 'jev-estimate-test', worldId: world.worldId, evidenceCutoff: 0, accessScopes: scope,
    context: 'The supplied source says the upgrade has been deployed, but has limited usage data.', contextAccessScopes: scope, provenance: ['fixture:protocol-report'],
    coordinates: [
      { id: 'development', processId: development.id, question: scoreSpec },
      { id: 'phase', processId: phase.id, question: choiceSpec },
      { id: 'statement', processId: likelihood.id, question: { type: 'noul', interpretation: 'truth_probability', instructions: 'The report explicitly says the upgrade is deployed.' } },
      { id: 'phase_mix', processId: mix.id, question: choiceSpec },
    ], ...overrides };
}
function provider(overrides = {}) {
  let calls = 0;
  const observed = [];
  return {
    get calls() { return calls; }, observed,
    estimator: { backend: 'typesafe', model: 'jev-test', label: 'typesafe:jev-test', async estimate(state, questions) {
      calls++; observed.push({ state, questions });
      return { model: 'jev-test', usage: { input_tokens: 123, output_tokens: 45 }, answers: { q0: scoreAnswer, q1: choiceAnswer, q2: { type: 'noul', noul: 0.9 }, q3: choiceAnswer }, ...overrides };
    } },
  };
}

test('Jev typed batch becomes reviewed canonical graph estimates without changing accepted Rust values', async (t) => {
  const { service, world, graph } = await fixture(t);
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const before = await service.inspectWorld({ worldId: world.worldId });
  const [result, retry] = await Promise.all([estimate(input(world)), estimate(input(world))]);
  assert.deepEqual(retry, result);
  assert.equal(backend.calls, 1);
  assert.equal(Object.keys(backend.observed[0].questions).length, 4);
  assert.equal(backend.observed[0].questions.q0.type, 'score');
  assert.equal(result.status, 'review_required');
  assert.equal(result.worldMutationPerformed, false);
  assert.equal(result.mapped[0].value.value, 75, 'rubric numeric values carry points; the provider score is 0.75');
  assert.equal(result.mapped[1].value.value, 'deployed');
  assert.equal(result.mapped[2].value.value, 0.9);
  assert.deepEqual(result.mapped[3].value.value, [0.2, 0.8]);
  const proposal = await service.inspectEstimationProposal({ proposalId: result.proposalId });
  assert.equal(proposal.provisionalClaims.every((entry) => entry.outputMode === 'estimated' && entry.claim.evidence_type === 'estimate'), true);
  assert.equal(proposal.observationIngestion.status, 'not_requested');
  const recordInput = { requestId: 'jev-record-test', proposalId: result.proposalId, graphHash: graph.graphHash, parentId: 'scope', accessScopes: scope,
    review: { verdict: 'approved', rationale: 'The development score is a provisional rubric judgment. Usage evidence remains incomplete; this does not establish adoption or causation.', holder: 'reviewer' } };
  const stored = await recordJevProcessEstimation(service, recordInput);
  assert.deepEqual(await recordJevProcessEstimation(service, recordInput), stored);
  assert.equal(stored.recordedReview, 'approved');
  assert.equal(stored.canonicalGraphRecord, true);
  assert.equal(stored.worldMutationPerformed, false);
  const view = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: scope });
  const review = view.nodes.find((node) => node.id === stored.understandingNodeId);
  assert.equal(review.role, 'externalized_reflection');
  assert.equal(review.text, recordInput.review.rationale);
  const bundle = JSON.parse(view.nodes.find((node) => node.id === stored.bundleNodeId).text);
  assert.deepEqual(bundle.response.answers.q0, scoreAnswer);
  assert.equal(bundle.request.acceptedHeadHash, before.headHash);
  assert.equal(bundle.reviewReceipt.reviewId, stored.reviewId);
  assert.equal(bundle.input.provenance[0], 'fixture:protocol-report');
  assert.equal(stored.recordIds.length, 4);
  assert.equal(view.edges.filter((edge) => edge.family === 'grounding' && edge.target.anchor_kind === 'process').length, 4);
  assert.equal((await service.inspectWorld({ worldId: world.worldId })).headHash, before.headHash);
  assert.equal(backend.calls, 1);
  await assert.rejects(estimate(input(world, { context: 'A different observation.' })), /bound to different inputs/);
});

test('provider-off returns bounded tasks and explicit unknowns create no fabricated values', async (t) => {
  const { service, world } = await fixture(t);
  const estimate = createJevProcessEstimator({ service });
  const tasks = await estimate(input(world));
  assert.equal(tasks.status, 'provider_not_configured');
  assert.equal(Object.keys(tasks.questions).length, 4);
  assert.equal(service.estimationProposals.size, 0);
  const unknown = await estimate(input(world, { requestId: 'unknown-case', coordinates: [{ id: 'usage', processId: development.id, disposition: 'unknown', reason: 'No usage evidence was supplied.' }] }));
  assert.equal(unknown.dispositionCounts.unknown, 1);
  const proposal = await service.inspectEstimationProposal({ proposalId: unknown.proposalId });
  assert.deepEqual(proposal.provisionalClaims, []);
});

test('provider validation rejects malformed answers, missing coverage and numeric coercion', () => {
  for (const bad of [null, '0.9', -1, 1.1]) assert.throws(() => mapJevProcessAnswer({ type: 'noul', noul: bad }, { type: 'noul' }, likelihood), /finite number/);
  assert.throws(() => mapJevProcessAnswer({ ...choiceAnswer, probabilities: { research: 0.2 } }, choiceSpec, phase), /exactly the expected keys/);
  assert.throws(() => mapJevProcessAnswer({ ...choiceAnswer, probabilities: { research: 0.2, deployed: 0.6 } }, choiceSpec, phase), /sum to one/);
  assert.throws(() => mapJevProcessAnswer({ ...choiceAnswer, choice: 'research' }, choiceSpec, phase), /inconsistent/);
  assert.throws(() => mapJevProcessAnswer({ ...scoreAnswer, score: 1.75 }, scoreSpec, development), /finite number/);
  assert.throws(() => mapJevProcessAnswer({ ...scoreAnswer, score: 0.1 }, scoreSpec, development), /inconsistent/);
  assert.throws(() => mapJevProcessAnswer({ ...scoreAnswer, legend: { 0: 'Different question', 1: scoreSpec.levels[1].description } }, scoreSpec, development), /does not match/);
  assert.equal(mapJevProcessAnswer(choiceAnswer, { ...choiceSpec, minimumConfidence: 0.8 }, phase).status, 'unknown');
});

test('invalid batches and probability-to-quantity conversions never reach provider', async (t) => {
  const { service, world } = await fixture(t);
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  await assert.rejects(estimate(input(world, { coordinates: [{ id: 'bad', processId: development.id, question: { type: 'noul', instructions: 'This is mature.', interpretation: 'truth_probability' } }] })), /explicitly declared scalar probability/);
  await assert.rejects(estimate(input(world, { requestId: 'wrong-unit', coordinates: [{ id: 'bad', processId: development.id, question: { ...scoreSpec, unit: 'USD' } }] })), /exactly the supplied unit/);
  await assert.rejects(estimate(input(world, { requestId: 'private', accessScopes: [] })), /inaccessible/);
  assert.equal(backend.calls, 0);
});

test('failed or malformed provider response is not retried implicitly', async (t) => {
  const { service, world } = await fixture(t);
  const backend = provider({ answers: {} });
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const rejected = await estimate(input(world));
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.error, /exactly the expected keys/);
  assert.deepEqual(rejected.usage, { input_tokens: 123, output_tokens: 45 }, 'the diagnostic keeps the provider usage');
  assert.deepEqual(await estimate(input(world)), rejected);
  assert.equal(backend.calls, 1);
  assert.equal(service.estimationProposals.size, 0);
});

test('one invalid answer is declined on its own coordinate and the rest of the batch still counts', async (t) => {
  const { service, world } = await fixture(t);
  const backend = provider({ answers: { q0: { ...scoreAnswer, score: 0.1 }, q1: choiceAnswer, q2: { type: 'noul', noul: 0.9 }, q3: choiceAnswer } });
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const result = await estimate(input(world));
  assert.equal(result.status, 'review_required');
  assert.deepEqual(result.declined.map((entry) => entry.coordinateId), ['development']);
  assert.match(result.declined[0].reason, /inconsistent with its distribution/);
  assert.equal(result.mapped[0].status, 'unknown');
  assert.deepEqual(result.mapped[0].answer, { ...scoreAnswer, score: 0.1 }, 'the declined raw answer is retained');
  assert.equal(result.dispositionCounts.known, 3);
  assert.equal(result.dispositionCounts.unknown, 1);
  assert.deepEqual(result.usage, { input_tokens: 123, output_tokens: 45 });
  assert.equal(backend.calls, 1);
});

test('rounded two-decimal Jev scores are accepted and the distribution becomes the claim uncertainty', () => {
  // Returned by jev-1.13.0 on 2026-09-23: the score comes from the unrounded distribution.
  const levels = ['very low', 'low', 'somewhat low', 'middle', 'somewhat high', 'high', 'very high'].map((description, index) => ({ description, value: index - 3 }));
  const spec = { type: 'score', instructions: 'How high was leverage?', unit: 'rubric points', levels, minimumConfidence: 0 };
  const process = { ...scalar('market.leverage', 'rubric points'), value_type: { kind: 'scalar', bounds: { minimum: -3, maximum: 3 } } };
  const answer = { type: 'score', score: 5.53, confidence: 0.73, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0.01, 4: 0.03, 5: 0.32, 6: 0.64 }, legend: Object.fromEntries(levels.map((level, index) => [String(index), level.description])) };
  const mean = mapJevProcessAnswer(answer, spec, process);
  assert.equal(mean.status, 'known');
  assert.ok(Math.abs(mean.value.value - 2.59) < 1e-9, 'the mean is on the declared level values');
  assert.equal(mean.uncertainty.kind, 'standard_deviation');
  assert.ok(mean.uncertainty.value > 0.5 && mean.uncertainty.value < 0.7);
  const median = mapJevProcessAnswer(answer, { ...spec, summary: 'median' }, process);
  assert.equal(median.value.value, 3, 'the median level of an ordinal rubric');
  assert.deepEqual(median.uncertainty, { kind: 'interval', lower: 2, upper: 3 });
  assert.throws(() => mapJevProcessAnswer({ ...answer, score: 5.0 }, spec, process), /inconsistent with its distribution/);
});

test('a core conflict rejection retains the exact provider output without changing strong observations', async (t) => {
  const { service, world } = await fixture(t, { acceptedObservation: true });
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const rejected = await estimate(input(world));
  assert.equal(rejected.status, 'submission_failed');
  assert.match(rejected.error, /stronger accepted claim measured.development/);
  assert.equal(rejected.submission.provisionalClaims[0].claim.value.value, 75);
  assert.deepEqual(await estimate(input(world)), rejected);
  assert.equal(backend.calls, 1);
  assert.equal(service.estimationProposals.size, 0);
  const corrected = structuredClone(rejected.submission);
  corrected.requestId = 'explicit-conflict-acknowledgement';
  corrected.provisionalClaims[0].acknowledgedClaimIds = ['measured.development'];
  const proposal = await service.submitEstimationResponse(corrected);
  assert.equal(proposal.committed, false);
  assert.equal(proposal.strongerClaimConflicts[0].overwritePerformed, false);
  assert.equal(backend.calls, 1);
});

test('durable recording refuses partial private graph and cannot widen estimate audiences', async (t) => {
  const { service, world, graph } = await fixture(t, { extraPrivate: true });
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const result = await estimate(input(world));
  const recordInput = { requestId: 'partial-record', proposalId: result.proposalId, graphHash: graph.graphHash, parentId: 'scope', accessScopes: scope, review: { verdict: 'approved', rationale: 'Provisional estimates reviewed.', holder: 'reviewer' } };
  await assert.rejects(recordJevProcessEstimation(service, recordInput), /complete exact graph/);
  assert.equal(service.estimationReviews.size, 0, 'preflight failure must not create even a review');
  const stored = await recordJevProcessEstimation(service, { ...recordInput, requestId: 'complete-record', accessScopes: ['research', 'secret', 'public'] });
  const all = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: ['research', 'secret'] });
  assert.equal(all.nodes.some((node) => node.id === 'hidden'), true);
  const publicView = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: ['public'] });
  assert.equal(publicView.nodes.some((node) => node.id === stored.bundleNodeId), false);
});

test('a private structural placement also restricts the separately rooted Understanding review', async (t) => {
  const { service, world, graph } = await fixture(t, { processScopes: [], privatePlacement: true });
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const proposal = await estimate(input(world, { accessScopes: ['secret'], contextAccessScopes: [] }));
  const stored = await recordJevProcessEstimation(service, { requestId: 'private-placement-record', proposalId: proposal.proposalId, graphHash: graph.graphHash, parentId: 'scope', accessScopes: ['secret'],
    review: { verdict: 'approved', rationale: 'This private analysis concerns public protocol evidence.', holder: 'analyst' } });
  const full = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: ['secret'] });
  assert.deepEqual(full.nodes.find((node) => node.id === stored.understandingNodeId).access_scopes, ['secret']);
  const publicView = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: [] });
  assert.equal(publicView.nodes.some((node) => node.id === stored.understandingNodeId), false);
  assert.equal(publicView.roots.includes(stored.understandingRootId), false);
});

test('record retry resumes the exact review and batch after a lost graph acknowledgement', async (t) => {
  const { service, world, graph } = await fixture(t);
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const proposal = await estimate(input(world));
  const originalApply = service.applyNarrativeBatch.bind(service);
  const calls = []; let committed;
  service.applyNarrativeBatch = async (request) => {
    calls.push(structuredClone(request));
    const result = await originalApply(request);
    if (calls.length === 1) {
      committed = result;
      throw Object.assign(new Error('Lost acknowledgement after the graph was stored.'), { indeterminate: true, receiptRetained: true, reconciliationGuidance: 'Inspect the existing exact batch receipt.' });
    }
    return result;
  };
  const recordInput = { requestId: 'resume-record', proposalId: proposal.proposalId, graphHash: graph.graphHash, parentId: 'scope', accessScopes: scope,
    review: { verdict: 'approved', rationale: 'Keep the values provisional and preserve the original batch.', holder: 'reviewer' } };
  const partial = await recordJevProcessEstimation(service, recordInput);
  assert.equal(partial.partial, true);
  assert.equal(partial.indeterminate, true);
  assert.equal(partial.receiptRetained, true);
  assert.equal(partial.reconciliationGuidance, 'Inspect the existing exact batch receipt.');
  assert.equal(partial.canonicalGraphRecord, null, 'a lost acknowledgement cannot establish whether the graph was written');
  assert.deepEqual(partial.exactBatchRequest, calls[0]);
  const resumed = await recordJevProcessEstimation(service, recordInput);
  assert.equal(resumed.graphHash, committed.graphHash);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(service.estimationReviews.size, 1);
  assert.equal(backend.calls, 1);
  assert.equal(resumed.reviewId, partial.reviewId);
});

test('builder to process estimate to recording appends twice to an already populated parent', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const scaffold = {
    id: 'populated-estimation-parent', scope: 'A synthetic protocol evidence model.', question: 'How mature is the protocol?',
    time: { unit: 'day', origin: 'Synthetic report snapshot at time zero.' }, accessScopes: scope,
    contextReview: { holder: 'fixture-reviewer', focalInterval: { start: 0, end: 0 },
      broaderContext: { boundary: 'Other protocols and economic conditions surrounding this synthetic report.', status: 'out_of_scope', assessment: 'This test checks appending review records; it supplies no evidence to model surrounding systems.' },
      longerTerm: { interval: null, status: 'unknown', assessment: 'The isolated deployment report supplies no historical numerical trajectory or supported long-term context.' },
      authoredJudgments: { status: 'unknown', assessment: 'This graph-placement fixture supplies an illustrative estimate but does not establish rubric calibration.' },
      conceptualStructure: { status: 'out_of_scope', assessment: 'Native concept decomposition is unnecessary for this test of appending records to a populated parent.' },
      conceptVariation: { status: 'unknown', assessment: 'The fixture contains no paired contextual meanings to compare.' },
    },
    evidence: [{ id: 'report', source: 'fixture:deployment-report', text: 'The protocol is deployed; usage evidence is limited.', evidenceType: 'report', availableAt: 0, holder: 'reporter' }],
    processes: [{ id: development.id, meaning: 'Protocol maturity on the declared development rubric.', unit: development.unit, referenceFrame: 'Research to deployment rubric.',
      type: { kind: 'scalar', minimum: 0, maximum: 100 }, initial: { value: 25, evidenceType: 'estimate', sourceIds: ['report'], holder: 'analyst', evidenceCutoff: 0 } }],
  };
  const preview = await buildWorldModel({ requestId: 'populated-preview', scaffold }, service);
  const built = await buildWorldModel({ requestId: 'populated-apply', scaffold, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash, apply: true }, service);
  assert.equal(built.status, 'applied');
  let calls = 0;
  const estimate = createJevProcessEstimator({ service, estimator: { label: 'typesafe:test', async estimate() { calls++; return { model: 'test', usage: null, answers: { q0: scoreAnswer } }; } } });
  const proposal = await estimate(input({ worldId: built.worldId }, { coordinates: [{ id: 'development', processId: development.id, question: scoreSpec }] }));
  const parentId = built.summary.scopeRootId;
  let graphHash = built.graphHash;
  const placements = (view) => view.edges.filter((edge) => edge.relation === 'contains' && edge.source.kind === 'node' && edge.source.node_id === parentId);
  const initial = await service.queryNarrativeGraph({ graphHash, mode: 'full', includeContent: true, accessScopes: scope });
  assert.ok(placements(initial).some((edge) => edge.order === 0), 'the full builder populates this parent before the estimate is recorded');
  const initialCount = initial.nodes.length;
  let previousOrders = placements(initial).map((edge) => edge.order);
  const recordedIds = [];
  for (let index = 0; index < 2; index++) {
    const stored = await recordJevProcessEstimation(service, { requestId: `populated-record-${index}`, proposalId: proposal.proposalId, graphHash, parentId, accessScopes: scope,
      review: { verdict: 'approved', rationale: `Review ${index + 1}: retain this attributed rubric estimate, without treating it as measured adoption.`, holder: 'reviewer' } });
    assert.equal(stored.canonicalGraphRecord, true, JSON.stringify(stored));
    graphHash = stored.graphHash;
    recordedIds.push(stored.bundleNodeId);
    const view = await service.queryNarrativeGraph({ graphHash, mode: 'full', includeContent: true, accessScopes: scope });
    const edges = placements(view);
    const appended = edges.find((edge) => edge.target.node_id === stored.bundleNodeId);
    assert.equal(appended.order, Math.max(...previousOrders) + 1);
    const orders = edges.map((edge) => edge.order);
    assert.equal(new Set(orders).size, orders.length);
    assert.deepEqual(orders.filter((order) => order !== appended.order).sort((a, b) => a - b), [...previousOrders].sort((a, b) => a - b));
    assert.ok(recordedIds.every((nodeId) => view.nodes.some((node) => node.id === nodeId)));
    assert.equal(view.nodes.length, initialCount + 4 * (index + 1));
    previousOrders = orders;
  }
  assert.equal(calls, 1, 'the same recorded proposal is reviewed twice without a Jev reroll');
  assert.equal((await service.inspectWorld({ worldId: built.worldId })).headHash, built.headHash);
});

test('invalid or exhausted sibling ordering is rejected before a review or graph mutation', async (t) => {
  const { service, world, graph } = await fixture(t);
  const backend = provider();
  const estimate = createJevProcessEstimator({ service, estimator: backend.estimator });
  const proposal = await estimate(input(world));
  const originalQuery = service.queryNarrativeGraph.bind(service);
  let order;
  service.queryNarrativeGraph = async (query) => {
    const view = await originalQuery(query);
    view.edges.push({ id: 'malformed-projection-placement', source: { kind: 'node', node_id: 'scope' }, target: { kind: 'node', node_id: 'scope' }, family: 'structural', relation: 'contains', ...(order === undefined ? {} : { order }) });
    view.graph.edge_count++;
    return view;
  };
  for (const [index, value] of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].entries()) {
    order = value;
    await assert.rejects(recordJevProcessEstimation(service, { requestId: `bad-order-${index}`, proposalId: proposal.proposalId, graphHash: graph.graphHash, parentId: 'scope', accessScopes: scope,
      review: { verdict: 'approved', rationale: 'This must not be recorded against an unsafe ordering.', holder: 'reviewer' } }), /safe integer/);
  }
  assert.equal(service.estimationReviews.size, 0);
  assert.equal(backend.calls, 1);
});
