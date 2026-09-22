import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { buildWorldModel, compileWorldModel } from '../src/general-modeling.mjs';
import { retainEstimatorProposal } from '../src/estimator-receipts.mjs';

// Synthetic fixture: this tests domains/units/provenance, not current market facts.
function limitedContextReview() {
  return { holder: 'fixture-reviewer', focalInterval: { start: 0, end: 0 },
    broaderContext: { boundary: 'Surrounding systems outside this synthetic snapshot.', status: 'unknown', assessment: 'The supplied fixture has no evidence for surrounding macro conditions; its local values cannot represent them.' },
    longerTerm: { interval: null, status: 'unknown', assessment: 'A synthetic snapshot and incidental event descriptions do not establish long-term developments or numerical trajectories.' },
    authoredJudgments: { status: 'unknown', assessment: 'Some fixture estimates exercise typed storage, but this test does not establish their calibration or explanatory adequacy.', processIds: [], eventIds: [], sourceIds: [], conceptIds: [], abstractCutIds: [] },
    conceptualStructure: { status: 'out_of_scope', assessment: 'This narrow fixture checks process storage; it does not require a native concept taxonomy or an invented decomposition.', processIds: [], eventIds: [], sourceIds: [], conceptIds: [], abstractCutIds: [] },
    conceptVariation: { status: 'unknown', assessment: 'The fixture supplies no paired contextual definitions supporting a comparison of meanings.', processIds: [], eventIds: [], sourceIds: [], conceptIds: [], abstractCutIds: [] },
  };
}

function marketScaffold() {
  return {
    id: 'market-fixture',
    scope: 'A synthetic protocol ecosystem: development, usage and trading conditions.',
    question: 'How do protocol activity and network use relate to reported market conditions?',
    time: { unit: 'day', origin: 'Synthetic evidence snapshot; relative time 0, not a live market date.' },
    contextReview: limitedContextReview(),
    accessScopes: ['research'],
    evidence: [
      { id: 'snapshot', source: 'fixture:protocol-dashboard', text: 'Synthetic snapshot: price 2500 USD and 40 developers active.', evidenceType: 'report', availableAt: 0, holder: 'fixture-dashboard' },
      { id: 'usage', source: 'fixture:network-telemetry', text: 'Synthetic snapshot: 12000 daily transactions.', evidenceType: 'observation', availableAt: 0, holder: 'fixture-telemetry' },
      { id: 'assessment', source: 'fixture:analyst-note', text: 'Illustrative estimate of ecosystem confidence, not observed fact.', evidenceType: 'estimate', availableAt: -1, holder: 'fixture-analyst' },
    ],
    referents: [{ id: 'protocol', boundary: 'The protocol software and its explicitly named governance process.', continuity: 'Same protocol lineage across upgrades.', lifecycle: 'Synthetic protocol creation through the time-0 snapshot.', sourceIds: ['snapshot'] }],
    processes: [
      { id: 'market.price', meaning: 'Quoted unit price at the snapshot.', unit: 'USD/token', referenceFrame: 'fixture exchange quote', type: { kind: 'scalar', minimum: 0, maximum: 1e9 }, initial: { value: 2500, evidenceType: 'report', sourceIds: ['snapshot'], holder: 'fixture-dashboard', evidenceCutoff: 0 }, referentIds: ['protocol'] },
      { id: 'protocol.developers', meaning: 'Distinct active developers in the dashboard window.', unit: 'people', referenceFrame: 'fixture dashboard activity window', type: { kind: 'scalar', minimum: 0, maximum: 1e6 }, initial: { value: 40, evidenceType: 'report', sourceIds: ['snapshot'], holder: 'fixture-dashboard', evidenceCutoff: 0 }, referentIds: ['protocol'] },
      { id: 'usage.transactions', meaning: 'Transactions recorded in the preceding day.', unit: 'transactions/day', referenceFrame: 'fixture network telemetry', type: { kind: 'scalar', minimum: 0, maximum: 1e9 }, initial: { value: 12000, evidenceType: 'observation', sourceIds: ['usage'], holder: 'fixture-telemetry', evidenceCutoff: 0 } },
      { id: 'ecosystem.confidence', meaning: 'Explicit illustrative rubric: 0=no stated confidence, 1=unqualified confidence.', unit: 'rubric fraction', referenceFrame: 'fixture analyst rubric', type: { kind: 'scalar', minimum: 0, maximum: 1 }, initial: { value: 0.6, evidenceType: 'estimate', sourceIds: ['assessment'], holder: 'fixture-analyst', evidenceCutoff: 0 } },
    ],
    events: [{ id: 'upgrade', boundary: 'Synthetic upgrade discussion during the preceding week.', interval: { start: -7, end: 0 }, participants: { subject: 'protocol' }, processIds: ['protocol.developers'], evidenceType: 'report', sourceIds: ['snapshot'] }],
    notes: [{ id: 'limits', text: 'Price and development counts do not establish causality; the confidence value is an illustrative attributed estimate.', holder: 'fixture-reviewer', processIds: ['market.price', 'protocol.developers', 'ecosystem.confidence'], eventIds: ['upgrade'], sourceIds: ['assessment'] }],
  };
}

async function realService(t) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  return service;
}

test('general bootstrap stores a multi-process market model, source graph and real Understanding reflection in the engine', async (t) => {
  const service = await realService(t);
  const request = { requestId: 'market-bootstrap', scaffold: marketScaffold() };
  const preview = await buildWorldModel(request, service);
  assert.equal(preview.status, 'preview');
  assert.equal(preview.stored, false);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
  const applied = await buildWorldModel({ ...request, apply: true, expectedProposalHash: preview.proposalHash }, service);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  const inspected = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  assert.equal(inspected.model.processes.length, 4);
  assert.equal(inspected.model.processes.find((p) => p.id === 'market.price').unit, 'USD/token');
  assert.equal(inspected.model.processes.find((p) => p.id === 'protocol.developers').initial_value.value, 40);
  assert.equal(inspected.model.initial_claims.find((c) => c.subject === 'ecosystem.confidence').evidence_type, 'estimate');
  assert.equal(inspected.model.initial_claims.find((c) => c.subject === 'ecosystem.confidence').mode, 'estimated');
  assert.equal(inspected.model.laws.length, 0);
  assert.equal(inspected.model.meaning_model.referents[0].lifecycle_event_id, 'general.lifecycle.protocol');
  assert.ok(inspected.model.meaning_model.event_referent_bindings.some((binding) => binding.binding_type === 'lifecycle_subject'));
  const graph = await service.queryNarrativeGraph({ graphHash: applied.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  const reflection = graph.nodes.find((node) => node.id === 'general.note.limits');
  assert.equal(reflection.role, 'externalized_reflection');
  assert.equal(reflection.text, request.scaffold.notes[0].text);
  assert.equal(reflection.holder, 'fixture-reviewer');
  assert.ok(graph.nodes.some((node) => node.node_type === 'understanding_process_root'));
  assert.equal(graph.nodes.filter((node) => node.node_type === 'source_evidence').length, 3);
  assert.ok(graph.edges.some((edge) => edge.family === 'grounding' && edge.target.anchor_kind === 'process'));
  assert.equal(graph.nodes.some((node) => node.role === 'story_passage'), false);
  assert.equal(applied.summary.reflectionCount, 6, 'one authored note plus five explicit modeling considerations');
  const again = await buildWorldModel({ ...request, apply: true, expectedProposalHash: preview.proposalHash }, service);
  assert.equal(again.worldId, applied.worldId);
  assert.equal(again.graphHash, applied.graphHash);
  assert.equal(service.worlds.size, 1);
});

test('the same bootstrap handles physical processes with category and distribution dimensions without story prerequisites', async (t) => {
  const service = await realService(t);
  const scaffold = {
    id: 'greenhouse', scope: 'A measured greenhouse at one inspection.', question: 'Which conditions need a follow-up measurement?',
    time: { unit: 'hour', origin: 'Inspection instant, synthetic fixture.' }, accessScopes: ['operations'],
    contextReview: { ...limitedContextReview(), broaderContext: { boundary: 'Other greenhouses and regional weather.', status: 'out_of_scope', assessment: 'This fixture tests storage of one inspection; regional comparisons are deliberately excluded and no regional values are inferred.' } },
    evidence: [{ id: 'inspection', source: 'fixture:inspection-sheet', text: 'Temperature 22 C, fan on; rubric estimate for stress causes: heat .7, water .2, other .1.', evidenceType: 'report', availableAt: 0, holder: 'inspector' }],
    processes: [
      { id: 'temperature', meaning: 'Air temperature at the inspection sensor.', unit: 'degrees Celsius', referenceFrame: 'sensor at canopy height', type: { kind: 'scalar', minimum: -50, maximum: 100 }, initial: { value: 22, evidenceType: 'report', sourceIds: ['inspection'], holder: 'inspector', evidenceCutoff: 0 } },
      { id: 'fan', meaning: 'Observed state of the ventilation fan.', unit: 'state label', referenceFrame: 'fan controller', type: { kind: 'category', variants: ['on', 'off'] }, initial: { value: 'on', evidenceType: 'report', sourceIds: ['inspection'], holder: 'inspector', evidenceCutoff: 0 } },
      { id: 'stress.cause', meaning: 'Attributed probabilities over specified causes; not physical resource shares.', unit: 'probability', referenceFrame: 'inspection rubric', type: { kind: 'distribution', outcomes: ['heat', 'water', 'other'] }, initial: { value: [0.7, 0.2, 0.1], evidenceType: 'estimate', sourceIds: ['inspection'], holder: 'inspector', evidenceCutoff: 0 } },
    ],
  };
  const preview = await buildWorldModel({ requestId: 'greenhouse-bootstrap', scaffold }, service);
  const applied = await buildWorldModel({ requestId: 'greenhouse-bootstrap', scaffold, apply: true, expectedProposalHash: preview.proposalHash }, service);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  assert.equal(applied.summary.reflectionCount, 5, 'five authored consideration records are stored without fabricated measurements');
  const stored = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  assert.equal(stored.model.processes.find((p) => p.id === 'temperature').unit, 'degrees Celsius');
  assert.deepEqual(stored.model.processes.find((p) => p.id === 'stress.cause').initial_value.value, [0.7, 0.2, 0.1]);
  const graph = await service.queryNarrativeGraph({ graphHash: applied.graphHash, mode: 'full', includeContent: true, accessScopes: ['operations'] });
  const reviews = graph.nodes.filter((node) => node.node_type === 'modeling_context_review');
  assert.equal(reviews.length, 5);
  const broader = JSON.parse(reviews.find((node) => node.id.endsWith('broaderContext')).text);
  const longer = JSON.parse(reviews.find((node) => node.id.endsWith('longerTerm')).text);
  assert.equal(broader.status, 'out_of_scope');
  assert.equal(broader.assessment, scaffold.contextReview.broaderContext.assessment);
  assert.equal(longer.status, 'unknown');
  assert.equal(longer.interval, null);
  assert.equal(stored.model.processes.length, 3, 'reviewing exclusions adds no fictitious macro measurements');
});

test('apply binds the exact preview and rejects malformed evidence, units, dimensions and structure before mutation', async (t) => {
  const service = await realService(t);
  const scaffold = marketScaffold();
  const preview = await buildWorldModel({ requestId: 'exact-preview', scaffold }, service);
  const changed = structuredClone(scaffold); changed.processes[0].initial.value = 2600;
  await assert.rejects(buildWorldModel({ requestId: 'exact-preview', scaffold: changed, apply: true, expectedProposalHash: preview.proposalHash }, service), /exact proposalHash/);
  const malformed = (mutate, pattern) => { const input = structuredClone(scaffold); mutate(input); assert.throws(() => compileWorldModel(input), pattern); };
  malformed((s) => s.processes[0].initial.sourceIds = ['absent'], /unknown ID/);
  malformed((s) => s.processes[0].initial.sourceIds = ['assessment'], /cannot turn estimate/);
  malformed((s) => s.processes[0].initial.evidenceCutoff = -1, /Invalid input/);
  malformed((s) => s.processes[0].initial.value = -1, /outside/);
  malformed((s) => s.processes[0].unit = '', /Too small/);
  malformed((s) => s.processes.push(structuredClone(s.processes[0])), /unique IDs/);
  malformed((s) => s.events[0].parentEventId = 'upgrade', /acyclic/);
  malformed((s) => { s.events[0].id = 'general.event.world'; s.notes[0].eventIds = []; }, /unique IDs/);
  malformed((s) => s.notes[0].processIds = ['absent'], /unknown ID/);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
});

test('partial creation reports durable substeps and retries them without creating another world', async (t) => {
  const service = await realService(t);
  const request = { requestId: 'resume-build', scaffold: marketScaffold() };
  const preview = await buildWorldModel(request, service);
  const create = service.createWorld.bind(service);
  let rejectOnce = true;
  service.createWorld = async (input) => { if (rejectOnce) { rejectOnce = false; throw new Error('synthetic world creation interruption'); } return create(input); };
  const apply = { ...request, apply: true, expectedProposalHash: preview.proposalHash };
  const failed = await buildWorldModel(apply, service);
  assert.equal(failed.status, 'incomplete');
  assert.equal(failed.failedPhase, 'createWorld');
  assert.equal(failed.completed.model.stored, true);
  assert.equal(failed.completed.graph.stored, true);
  assert.equal(failed.worldMutation, false);
  assert.equal(service.models.size, 1);
  const resumed = await buildWorldModel(apply, service);
  assert.equal(resumed.status, 'applied', JSON.stringify(resumed));
  assert.equal(resumed.modelHash, failed.completed.model.modelHash);
  assert.equal(resumed.graphHash, failed.completed.graph.graphHash);
  assert.equal(service.models.size, 1);
  assert.equal(service.worlds.size, 1);
});

function estimatedScaffold() {
  const scaffold = marketScaffold();
  const process = scaffold.processes.find((process) => process.id === 'ecosystem.confidence');
  delete process.initial;
  process.initialEstimate = { sourceIds: ['assessment'], question: { type: 'score', instructions: 'Assess the stated confidence against this supplied rubric.', unit: 'rubric fraction', levels: [{ description: 'No stated confidence.', value: 0 }, { description: 'Unqualified confidence.', value: 1 }] } };
  scaffold.processes.push({ id: 'protocol.review_maturity', meaning: 'Illustrative rubric of the stated review process, not a developer count.', unit: 'rubric fraction', referenceFrame: 'explicit synthetic review rubric', type: { kind: 'scalar', minimum: 0, maximum: 1 }, initialEstimate: { sourceIds: ['snapshot'], question: { type: 'score', instructions: 'Assess documented review maturity.', unit: 'rubric fraction', levels: [{ description: 'No review process described.', value: 0 }, { description: 'A complete review process described.', value: 1 }] } } });
  scaffold.processes.push({ id: 'protocol.governance', meaning: 'An unresolved governance dimension, requiring a better operational definition.', unit: 'rubric fraction', referenceFrame: 'not yet defined operationally', type: { kind: 'scalar', minimum: 0, maximum: 1 }, initial: { status: 'unmodeled', reason: 'The supplied evidence does not define how to measure governance.' } });
  return scaffold;
}

function scoreEstimator() {
  return {
    calls: 0, backend: 'typesafe', model: 'test-jev', label: 'test-jev',
    async estimate(state, questions) {
      this.calls += 1;
      assert.match(state, /not observations/);
      return { model: this.model, usage: { input_tokens: 100, output_tokens: 10 }, answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, { type: 'score', score: this.calls === 1 ? 0.75 : 0.25, probabilities: this.calls === 1 ? { 0: 0.25, 1: 0.75 } : { 0: 0.75, 1: 0.25 }, confidence: 0.9, legend: Object.fromEntries(question.criteria.map((description, index) => [String(index), description])) }])) };
    },
  };
}

test('Jev initial estimates are batched, retained exactly and ingested as estimated process values, with unknowns deferred', async (t) => {
  const service = await realService(t);
  const estimator = scoreEstimator();
  const scaffold = estimatedScaffold();
  const request = { requestId: 'jev-bootstrap', scaffold };
  const [preview, concurrent] = await Promise.all([buildWorldModel(request, service, estimator), buildWorldModel(request, service, estimator)]);
  assert.equal(preview.status, 'preview');
  assert.equal(estimator.calls, 1);
  assert.equal(preview.proposalId, concurrent.proposalId);
  assert.equal(preview.summary.processes.find((p) => p.id === 'ecosystem.confidence').initialValue, 0.75);
  assert.equal(preview.estimator.evaluatedProcessIds.length, 2, 'two independent questions share one provider call');
  assert.deepEqual(preview.summary.unresolvedProcessIds, ['protocol.governance']);
  assert.equal(service.models.size, 0);
  const apply = { ...request, apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash };
  const stored = await buildWorldModel(apply, service, estimator);
  assert.equal(stored.status, 'applied', JSON.stringify(stored));
  assert.equal(estimator.calls, 1, 'apply must not estimate again');
  const { model } = await service.inspectModel({ modelHash: stored.modelHash, includeDefinition: true });
  const estimated = model.processes.find((p) => p.id === 'ecosystem.confidence');
  assert.equal(estimated.initial_value.value, 0.75);
  assert.equal(estimated.update_mode, 'static');
  const claim = model.initial_claims.find((c) => c.subject === 'ecosystem.confidence');
  assert.equal(claim.evidence_type, 'estimate');
  assert.equal(claim.mode, 'estimated');
  assert.match(claim.holder, /typesafe:test-jev/);
  assert.equal(model.processes.some((p) => p.id === 'protocol.governance'), false, 'unknown is never a fake zero');
  const graph = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  assert.ok(graph.nodes.some((node) => node.node_type === 'unresolved_process_definition' && node.epistemic_status === 'unmodeled'));
  const receipt = graph.nodes.find((node) => node.id === 'general.evidence.general.estimator.initial');
  assert.equal(JSON.parse(receipt.text).answers.q0.score, 0.75);
  assert.equal(Object.keys(JSON.parse(receipt.text).questions).length, 2);
  assert.equal(receipt.evidence_type, 'estimate');
  const repeated = await buildWorldModel(apply, service, estimator);
  assert.equal(repeated.worldId, stored.worldId);
  assert.equal(estimator.calls, 1);
  const changed = structuredClone(scaffold); changed.scope += ' Changed.';
  await assert.rejects(buildWorldModel({ ...apply, requestId: 'changed-apply', scaffold: changed }, service, estimator), /bound to different modeling inputs/);
  assert.equal(estimator.calls, 1);
});

test('Jev-only initial values can construct a real model and absence of a provider leaves no placeholder state', async (t) => {
  const service = await realService(t);
  const scaffold = estimatedScaffold();
  scaffold.processes = scaffold.processes.filter((process) => process.id === 'ecosystem.confidence');
  scaffold.events = []; scaffold.notes = [];
  const pending = await buildWorldModel({ requestId: 'no-provider', scaffold }, service);
  assert.equal(pending.status, 'pending');
  assert.equal(service.models.size, 0);
  const estimator = scoreEstimator();
  const preview = await buildWorldModel({ requestId: 'provider-only', scaffold }, service, estimator);
  const applied = await buildWorldModel({ requestId: 'provider-only', scaffold, apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service, estimator);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  assert.equal(applied.summary.processes[0].evidenceType, 'estimate');
  assert.equal(estimator.calls, 1);
});

test('malformed and uncertain provider responses do not silently reroll on retry', async (t) => {
  const service = await realService(t);
  const request = { requestId: 'bad-provider', scaffold: estimatedScaffold() };
  const bad = { ...scoreEstimator(), async estimate() { this.calls += 1; return { answers: {} }; } };
  const rejected = await buildWorldModel(request, service, bad);
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.validationError.message, /exactly the requested/);
  assert.deepEqual(await buildWorldModel(request, service, bad), rejected);
  assert.equal(bad.calls, 1);
  const uncertain = { ...scoreEstimator(), async estimate() { this.calls += 1; throw new Error('Response was lost.'); } };
  const lost = { ...request, requestId: 'uncertain-provider' };
  await assert.rejects(buildWorldModel(lost, service, uncertain), /Response was lost/);
  const retry = await buildWorldModel(lost, service, uncertain);
  assert.equal(retry.indeterminate, true);
  assert.equal(uncertain.calls, 1);
  assert.equal(service.models.size, 0);
});

test('low-confidence estimates remain unknown and an entirely unresolved scaffold creates no engine world', async (t) => {
  const service = await realService(t);
  const scaffold = estimatedScaffold();
  scaffold.processes = scaffold.processes.filter((process) => process.id === 'ecosystem.confidence');
  scaffold.processes[0].initialEstimate.question.minimumConfidence = 0.95;
  scaffold.events = []; scaffold.notes = [];
  const estimator = scoreEstimator();
  const result = await buildWorldModel({ requestId: 'low-confidence', scaffold }, service, estimator);
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.summary.unresolvedProcessIds, ['ecosystem.confidence']);
  assert.equal(Object.hasOwn(result.summary.processes[0], 'initialValue'), false);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
  assert.equal(estimator.calls, 1);
});

test('a long initial-estimation receipt is preserved in graph evidence rather than truncated', async (t) => {
  const service = await realService(t);
  const scaffold = estimatedScaffold();
  scaffold.evidence[0].text += ' Synthetic evidence with bounded, explicit provenance.'.repeat(200);
  const estimator = scoreEstimator();
  const request = { requestId: 'long-receipt', scaffold };
  const preview = await buildWorldModel(request, service, estimator);
  assert.equal(preview.status, 'preview');
  const applied = await buildWorldModel({ ...request, apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service, estimator);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  const graph = await service.queryNarrativeGraph({ graphHash: applied.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  const receipt = graph.nodes.find((node) => node.id === 'general.evidence.general.estimator.initial');
  assert.ok(receipt.text.length > 8_000);
  assert.equal(JSON.parse(JSON.parse(receipt.text).state).evidence[0].text, scaffold.evidence[0].text);
});

test('identical rubrics bind different processes inside model-visible question instructions', async (t) => {
  const service = await realService(t);
  const scaffold = estimatedScaffold();
  const targets = scaffold.processes.filter((process) => process.initialEstimate);
  targets[1].initialEstimate.question = structuredClone(targets[0].initialEstimate.question);
  const estimator = scoreEstimator();
  const original = estimator.estimate.bind(estimator);
  estimator.estimate = async (state, questions) => {
    assert.notEqual(questions.q0.instructions, questions.q1.instructions);
    assert.match(questions.q0.instructions, /Target process: ecosystem.confidence/);
    assert.match(questions.q1.instructions, /Target process: protocol.review_maturity/);
    assert.ok(questions.q0.instructions.includes(targets[0].referenceFrame));
    assert.ok(questions.q1.instructions.includes(targets[1].meaning));
    assert.match(questions.q0.instructions, /source evidence IDs: assessment/);
    assert.match(questions.q1.instructions, /source evidence IDs: snapshot/);
    return original(state, questions);
  };
  const preview = await buildWorldModel({ requestId: 'bound-targets', scaffold }, service, estimator);
  assert.equal(preview.status, 'preview');
  assert.equal(estimator.calls, 1);
});

test('minimal apply consumes the exact stored proposal without retransmitting the scaffold or calling Jev again', async (t) => {
  const service = await realService(t);
  const estimator = scoreEstimator();
  const preview = await buildWorldModel({ requestId: 'minimal-preview', scaffold: estimatedScaffold() }, service, estimator);
  const apply = { requestId: 'minimal-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash };
  const applied = await buildWorldModel(apply, service, estimator);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  assert.equal(applied.proposalHash, preview.proposalHash);
  assert.equal(estimator.calls, 1);
  const repeated = await buildWorldModel(apply, service, estimator);
  assert.equal(repeated.worldId, applied.worldId);
  await assert.rejects(buildWorldModel({ ...apply, requestId: 'wrong-minimal-hash', expectedProposalHash: '0'.repeat(64) }, service, estimator), /exact proposalHash/);
  const unrelated = retainEstimatorProposal(service, 'other-operation', {}, { scaffold: marketScaffold() });
  await assert.rejects(buildWorldModel({ ...apply, requestId: 'wrong-operation', proposalId: unrelated }, service, estimator), /different estimator operation/);
  await assert.rejects(buildWorldModel({ requestId: 'missing-preview-scaffold' }, service, estimator), /scaffold is required for preview/);
  assert.equal(service.worlds.size, 1);
  assert.equal(estimator.calls, 1);
});

test('expanded definitions exceeding the receipt budget are rejected before any durable creation', async (t) => {
  const service = await realService(t);
  const evidence = Array.from({ length: 8 }, (_, index) => ({ id: `source${index}`, source: `fixture:${index}:${'s'.repeat(700)}`, text: 'Synthetic inspection value is 1.', evidenceType: 'report', availableAt: 0, holder: 'inspector' }));
  const scaffold = { id: 'large-definition', scope: 'Synthetic receipt-boundary fixture.', question: 'Can expanded definitions fit safely in the return receipt?', time: { unit: 'hour', origin: 'Inspection time.' }, contextReview: limitedContextReview(), accessScopes: ['test'], evidence,
    processes: Array.from({ length: 200 }, (_, index) => ({ id: `process${index}`, meaning: 'A synthetic independently sourced measurement.', unit: 'count', referenceFrame: 'fixture inspection', type: { kind: 'scalar', minimum: 0, maximum: 2 }, initial: { value: 1, evidenceType: 'report', sourceIds: evidence.map((source) => source.id), holder: 'inspector', evidenceCutoff: 0 } })) };
  const preview = await buildWorldModel({ requestId: 'large-preview', scaffold }, service);
  assert.equal(preview.status, 'preview', 'the engine accepts the model and the compact result fits');
  await assert.rejects(buildWorldModel({ requestId: 'large-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash, includeDefinition: true }, service), /safe receipt budget/);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
  assert.equal(service.narrativeReceipts.size, 0);
});

function supportedContextScaffold({ estimate = false } = {}) {
  const scaffold = estimate ? estimatedScaffold() : marketScaffold();
  scaffold.evidence.push(
    { id: 'infrastructure', source: 'fixture:regional-capacity-report', text: 'Synthetic time-0 report: regional compute capacity is 100 units. The shared infrastructure hosts the focal protocol.', evidenceType: 'report', availableAt: 0, holder: 'regional-reporter' },
    { id: 'history', source: 'fixture:dated-milestones', text: 'Synthetic history: the protocol specification was published during days -180 to -179; shared infrastructure expanded during days -35 to -30. These milestones supply no historical developer-count series.', evidenceType: 'report', availableAt: 0, holder: 'history-reporter' },
  );
  scaffold.processes.push({ id: 'infrastructure.capacity', meaning: 'Reported regional compute capacity surrounding the focal protocol.', unit: 'synthetic compute units', referenceFrame: 'regional capacity report at the snapshot', type: { kind: 'scalar', minimum: 0, maximum: 1000 }, initial: { value: 100, evidenceType: 'report', sourceIds: ['infrastructure'], holder: 'regional-reporter', evidenceCutoff: 0 } });
  scaffold.events.push(
    { id: 'protocol.foundation', boundary: 'Publication of the synthetic protocol specification.', interval: { start: -180, end: -179 }, participants: { subject: 'protocol' }, processIds: ['protocol.developers'], evidenceType: 'report', sourceIds: ['history'] },
    { id: 'infrastructure.expansion', boundary: 'Expansion of the shared synthetic regional infrastructure.', interval: { start: -35, end: -30 }, processIds: ['infrastructure.capacity'], evidenceType: 'report', sourceIds: ['history'] },
  );
  scaffold.contextReview = {
    ...limitedContextReview(),
    holder: 'context-reviewer', focalInterval: { start: -7, end: 0 },
    broaderContext: { boundary: 'Regional compute infrastructure hosting the focal protocol.', status: 'represented', assessment: 'The surrounding capacity process and dated expansion are represented from the supplied reports. They give infrastructure context, without establishing a causal effect on price.', processIds: ['infrastructure.capacity'], eventIds: ['infrastructure.expansion'], sourceIds: ['infrastructure', 'history'] },
    longerTerm: { interval: { start: -365, end: 0 }, status: 'represented', assessment: 'The specification milestone precedes the focal week and gives dated historical context. Developer count is measured only at time 0; this event does not establish a sampled numerical trajectory.', processIds: ['protocol.developers'], eventIds: ['protocol.foundation'], sourceIds: ['history'] },
  };
  return scaffold;
}

test('missing context review requests broader and longer-term assessment before any Jev call or durable write', async (t) => {
  const service = await realService(t);
  const scaffold = estimatedScaffold();
  delete scaffold.contextReview;
  const estimator = scoreEstimator();
  const request = { requestId: 'missing-context', scaffold };
  const result = await buildWorldModel(request, service, estimator);
  assert.equal(result.status, 'needs_context_review');
  assert.equal(result.stored, false);
  assert.equal(result.worldMutation, false);
  assert.equal(result.graphMutation, false);
  assert.match(JSON.stringify(result), /broaderContext/);
  assert.match(JSON.stringify(result), /longerTerm/);
  assert.equal(estimator.calls, 0);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
  assert.equal(service.modelReceipts.size, 0);
  assert.equal(service.narrativeReceipts.size, 0);
  assert.throws(() => compileWorldModel(scaffold), /contextReview is required/);
  const apply = await buildWorldModel({ ...request, requestId: 'missing-context-apply', apply: true, expectedProposalHash: '0'.repeat(64) }, service, estimator);
  assert.equal(apply.status, 'needs_context_review');
  assert.equal(estimator.calls, 0);
});

test('supported broader and historical context become grounded Understanding reviews with unchanged dated events', async (t) => {
  const service = await realService(t);
  const scaffold = supportedContextScaffold({ estimate: true });
  const estimator = scoreEstimator();
  const original = estimator.estimate.bind(estimator);
  estimator.estimate = async (state, questions) => {
    const input = JSON.parse(state);
    assert.deepEqual(input.contextReview, scaffold.contextReview, 'the paid evaluation receives the reviewed scope rather than only local evidence');
    return original(state, questions);
  };
  const preview = await buildWorldModel({ requestId: 'supported-context', scaffold }, service, estimator);
  assert.equal(preview.status, 'preview');
  const applied = await buildWorldModel({ requestId: 'supported-context-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service, estimator);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  assert.equal(estimator.calls, 1);
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  for (const eventId of ['protocol.foundation', 'infrastructure.expansion']) {
    assert.deepEqual(model.meaning_model.events.find((event) => event.id === eventId).interval, scaffold.events.find((event) => event.id === eventId).interval);
  }
  assert.equal(model.laws.length, 0, 'context support does not invent executable causal laws');
  assert.equal(model.initial_claims.filter((claim) => claim.subject === 'protocol.developers').length, 1, 'historical context adds no fabricated numerical samples');
  assert.equal(model.initial_claims.find((claim) => claim.subject === 'protocol.developers').value_time, 0);
  const graph = await service.queryNarrativeGraph({ graphHash: applied.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  const reviews = graph.nodes.filter((node) => node.node_type === 'modeling_context_review');
  assert.equal(reviews.length, 5);
  for (const kind of ['broaderContext', 'longerTerm']) {
    const aspect = scaffold.contextReview[kind];
    const node = reviews.find((node) => node.id === `general.context_review.${kind}`);
    assert.equal(node.role, 'externalized_reflection');
    assert.equal(node.holder, 'context-reviewer');
    assert.equal(node.render, 'exclude');
    assert.equal(node.evidence_type, 'estimate', 'the assessment is not relabeled as a measured observation');
    assert.deepEqual(JSON.parse(node.text), { aspect: kind, focalInterval: scaffold.contextReview.focalInterval, ...aspect });
    assert.ok(graph.edges.some((edge) => edge.relation === 'contains' && edge.source.node_id === applied.summary.understandingRootId && edge.target.node_id === node.id));
    for (const processId of aspect.processIds) assert.ok(graph.edges.some((edge) => edge.source.node_id === node.id && edge.family === 'grounding' && edge.target.anchor_kind === 'process' && edge.target.anchor_id === processId));
    for (const eventId of aspect.eventIds) assert.ok(graph.edges.some((edge) => edge.source.node_id === node.id && edge.family === 'grounding' && edge.target.anchor_kind === 'event' && edge.target.anchor_id === eventId));
    for (const sourceId of aspect.sourceIds) assert.ok(graph.edges.some((edge) => edge.source.node_id === node.id && edge.family === 'provenance' && edge.target.node_id === `general.evidence.${sourceId}`));
  }
  assert.deepEqual(applied.summary.contextReview.longerTerm.interval, { start: -365, end: 0 });
  assert.match(applied.summary.contextReview.adequacy, /not verify/);
});

test('unsupported represented context and invalid history are rejected before the paid estimator or model writes', async (t) => {
  const service = await realService(t);
  const estimator = scoreEstimator();
  const cases = [
    ['missing-process', (s) => s.contextReview.broaderContext.processIds = ['missing'], /broaderContext processIds names unknown ID/],
    ['missing-source', (s) => s.contextReview.longerTerm.sourceIds = ['missing'], /longerTerm sourceIds names unknown ID/],
    ['missing-event', (s) => s.contextReview.longerTerm.eventIds = ['missing'], /longerTerm eventIds names unknown ID/],
    ['empty-processes', (s) => s.contextReview.broaderContext.processIds = [], /represented context requires linked/],
    ['empty-sources', (s) => s.contextReview.longerTerm.sourceIds = [], /represented context requires linked/],
    ['null-horizon', (s) => s.contextReview.longerTerm.interval = null, /must contain and extend/],
    ['focal-horizon', (s) => s.contextReview.longerTerm.interval = { ...s.contextReview.focalInterval }, /must contain and extend/],
    ['nonenclosing-horizon', (s) => s.contextReview.longerTerm.interval = { start: -365, end: -1 }, /must contain and extend/],
    ['focal-events-only', (s) => s.contextReview.longerTerm.eventIds = ['upgrade'], /dated event extending beyond/],
    ['undated-history', (s) => s.events.find((event) => event.id === 'protocol.foundation').interval = null, /dated event extending beyond/],
    ['history-outside-horizon', (s) => s.events.find((event) => event.id === 'protocol.foundation').interval = { start: -400, end: -399 }, /dated event extending beyond/],
    ['only-touches-focal-boundary', (s) => s.events.find((event) => event.id === 'protocol.foundation').interval = { start: 0, end: 100 }, /dated event extending beyond/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const scaffold = supportedContextScaffold({ estimate: true });
    mutate(scaffold);
    await assert.rejects(buildWorldModel({ requestId: `invalid-context-${name}`, scaffold }, service, estimator), pattern, name);
  }
  assert.equal(estimator.calls, 0);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
  assert.equal(service.modelReceipts.size, 0);
  assert.equal(service.narrativeReceipts.size, 0);
});

test('the reviewed context is part of the exact proposal and changing it cannot apply an old hash', async (t) => {
  const service = await realService(t);
  const scaffold = supportedContextScaffold();
  const preview = await buildWorldModel({ requestId: 'context-binding-preview', scaffold }, service);
  const changed = structuredClone(scaffold);
  changed.contextReview.longerTerm.assessment += ' An additional qualification was added after preview.';
  await assert.rejects(buildWorldModel({ requestId: 'changed-context-hash', scaffold: changed, apply: true, expectedProposalHash: preview.proposalHash }, service), /exact proposalHash/);
  await assert.rejects(buildWorldModel({ requestId: 'changed-context-proposal', scaffold: changed, apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service), /bound to different modeling inputs/);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
});

function conceptualScaffold({ estimate = false } = {}) {
  const scaffold = supportedContextScaffold({ estimate });
  scaffold.evidence.push({ id: 'meanings', source: 'fixture:contextual-readiness-definitions', text: 'Synthetic archive: the foundation team used readiness to mean a documented research proposal; operators at the later upgrade used readiness to mean deployable capability. These are attributed usages, not a universal semantic progression.', evidenceType: 'report', availableAt: 0, holder: 'archive-reporter' });
  scaffold.concepts = [
    { id: 'readiness', label: 'Readiness', boundary: 'An analyst schema for readiness relative to a specified purpose and actor.', sourceIds: ['meanings'] },
    { id: 'readiness.research', label: 'Research framing', boundary: 'Readiness as a documented research proposal in the foundation context.', stateSchema: { comparison: 'A declared readiness criterion, not a probability or capacity measurement.' }, sourceIds: ['meanings'], eventIds: ['protocol.foundation'] },
    { id: 'readiness.operation', label: 'Operational framing', boundary: 'Readiness as deployable capability in the upgrade context.', sourceIds: ['meanings'], eventIds: ['upgrade'] },
  ];
  scaffold.abstractCuts = [{ id: 'readiness.contexts', parentConceptId: 'readiness', childConceptIds: ['readiness.research', 'readiness.operation'], lens: 'Alternative contextual framings, not exclusive physical shares.', question: 'Which criterion of readiness is being used in each context?', sourceIds: ['meanings'] }];
  scaffold.contextReview.authoredJudgments = { status: 'represented', assessment: 'The confidence dimension uses an explicit authored rubric. It is an attributed judgment, not a measured physical quantity.', processIds: ['ecosystem.confidence'], sourceIds: ['assessment'] };
  scaffold.contextReview.conceptualStructure = { status: 'represented', assessment: 'Opening readiness by context explains why two actors can use the term differently. The native cut preserves both framings without weights.', conceptIds: ['readiness'], abstractCutIds: ['readiness.contexts'], sourceIds: ['meanings'] };
  scaffold.contextReview.conceptVariation = { status: 'represented', assessment: 'These dated uses employ different criteria. Their context and purpose may explain the difference; the model does not claim a global replacement of meaning.', conceptIds: ['readiness.research', 'readiness.operation'], eventIds: ['protocol.foundation', 'upgrade'], sourceIds: ['meanings'] };
  if (!estimate) scaffold.processes.find((process) => process.id === 'ecosystem.confidence').judgmentQuestion = { type: 'score', instructions: 'Assess the explicitly stated confidence using this authored comparison.', unit: 'rubric fraction', levels: [{ description: 'No stated confidence.', value: 0 }, { description: 'Unqualified confidence.', value: 1 }] };
  return scaffold;
}

test('the builder requests every missing modeling consideration before provider calls or construction', async (t) => {
  const service = await realService(t);
  const estimator = scoreEstimator();
  for (const kind of ['authoredJudgments', 'conceptualStructure', 'conceptVariation']) {
    const scaffold = estimatedScaffold();
    delete scaffold.contextReview[kind];
    const result = await buildWorldModel({ requestId: `missing-consideration-${kind}`, scaffold }, service, estimator);
    assert.equal(result.status, 'needs_modeling_review');
    assert.ok(JSON.stringify(result).includes(kind));
    assert.equal(result.stored, false);
    assert.throws(() => compileWorldModel(scaffold), /Modeling consideration reviews are required/);
  }
  assert.equal(estimator.calls, 0);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
  assert.equal(service.narrativeReceipts.size, 0);
});

test('native concepts and alternative cuts, supplied judgment rubrics and dated meaning reviews survive engine registration', async (t) => {
  const service = await realService(t);
  const scaffold = conceptualScaffold();
  const preview = await buildWorldModel({ requestId: 'native-representation', scaffold }, service);
  const applied = await buildWorldModel({ requestId: 'native-representation-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service);
  assert.equal(applied.status, 'applied', JSON.stringify(applied));
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  assert.equal(model.meaning_model.concepts.length, 3);
  assert.equal(model.meaning_model.abstract_cuts.length, 1);
  const cut = model.meaning_model.abstract_cuts[0];
  assert.equal(cut.parent_concept_id, 'readiness');
  assert.deepEqual(new Set(cut.child_concept_ids), new Set(['readiness.research', 'readiness.operation']));
  assert.equal(Object.hasOwn(cut, 'weights'), false);
  assert.equal((model.meaning_model.normalized_cuts ?? []).length, 0, 'concept openings do not imply a normalized physical budget');
  assert.equal(model.meaning_model.concepts.find((concept) => concept.id === 'readiness.research').state_schema.comparison, scaffold.concepts[1].stateSchema.comparison);
  const process = model.processes.find((process) => process.id === 'ecosystem.confidence');
  const rubric = JSON.parse(process.scale.authored_judgment_question);
  assert.equal(rubric.unit, process.unit);
  assert.deepEqual(rubric.levels, scaffold.processes.find((item) => item.id === process.id).judgmentQuestion.levels);
  assert.equal(model.initial_claims.find((claim) => claim.subject === process.id).evidence_type, 'estimate');
  const graph = await service.queryNarrativeGraph({ graphHash: applied.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  for (const kind of ['authoredJudgments', 'conceptualStructure', 'conceptVariation']) {
    const node = graph.nodes.find((node) => node.id === `general.context_review.${kind}`);
    assert.equal(node.role, 'externalized_reflection');
    assert.equal(node.holder, scaffold.contextReview.holder);
    assert.equal(JSON.parse(node.text).assessment, scaffold.contextReview[kind].assessment);
  }
  assert.ok(graph.edges.some((edge) => edge.source.node_id === 'general.context_review.conceptualStructure' && edge.target.anchor_kind === 'abstract_cut' && edge.target.anchor_id === cut.id));
  assert.ok(graph.edges.some((edge) => edge.source.node_id === 'general.concept.readiness.research' && edge.target.anchor_kind === 'event' && edge.target.anchor_id === 'protocol.foundation'));
  assert.deepEqual(applied.summary.contextReview.authoredJudgments.judgmentTargets, [{ processId: 'ecosystem.confidence', representation: 'native_estimated_value' }]);
});

test('two contextual meanings may share a single dated event without inventing a split event or temporal progression', async (t) => {
  const service = await realService(t);
  const scaffold = conceptualScaffold();
  for (const concept of scaffold.concepts.slice(1)) concept.eventIds = ['upgrade'];
  scaffold.contextReview.conceptVariation.eventIds = ['upgrade'];
  scaffold.contextReview.conceptVariation.assessment = 'Two actors use different criteria during the same upgrade. This represents concurrent viewpoints, not temporal semantic change.';
  const preview = await buildWorldModel({ requestId: 'same-event-meanings', scaffold }, service);
  const applied = await buildWorldModel({ requestId: 'same-event-meanings-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service);
  assert.equal(applied.status, 'applied');
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  assert.equal(model.meaning_model.events.filter((event) => event.id === 'upgrade').length, 1);
  assert.deepEqual(applied.summary.contextReview.conceptVariation.eventIds, ['upgrade']);
});

test('an adequate native boundary may remain unopened without a decomposition quota', async (t) => {
  const service = await realService(t);
  const scaffold = conceptualScaffold();
  scaffold.concepts = scaffold.concepts.slice(0, 1);
  scaffold.abstractCuts = [];
  scaffold.contextReview.conceptualStructure.abstractCutIds = [];
  scaffold.contextReview.conceptualStructure.assessment = 'For this narrow boundary test a purpose-relative readiness concept is sufficient; finer distinctions would not affect its question.';
  scaffold.contextReview.conceptVariation = limitedContextReview().conceptVariation;
  const preview = await buildWorldModel({ requestId: 'adequate-boundary', scaffold }, service);
  const applied = await buildWorldModel({ requestId: 'adequate-boundary-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service);
  assert.equal(applied.status, 'applied');
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  assert.equal(model.meaning_model.concepts.length, 1);
  assert.equal(model.meaning_model.abstract_cuts.length, 0);
});

test('Jev rubrics stay on actual process definitions and unresolved judgment dimensions remain explicitly unscored', async (t) => {
  const service = await realService(t);
  const scaffold = conceptualScaffold({ estimate: true });
  const estimator = scoreEstimator();
  const original = estimator.estimate.bind(estimator);
  estimator.estimate = async (state, questions) => {
    const conceptualSchema = JSON.parse(state).conceptualSchema;
    assert.equal(conceptualSchema.concepts.find((concept) => concept.id === 'readiness').boundary, scaffold.concepts[0].boundary);
    assert.equal(conceptualSchema.abstractCuts[0].lens, scaffold.abstractCuts[0].lens);
    assert.match(conceptualSchema.authority, /authored/i);
    return original(state, questions);
  };
  const preview = await buildWorldModel({ requestId: 'estimated-rubric', scaffold }, service, estimator);
  const applied = await buildWorldModel({ requestId: 'estimated-rubric-apply', apply: true, proposalId: preview.proposalId, expectedProposalHash: preview.proposalHash }, service, estimator);
  assert.equal(applied.status, 'applied');
  const { model } = await service.inspectModel({ modelHash: applied.modelHash, includeDefinition: true });
  const question = JSON.parse(model.processes.find((process) => process.id === 'ecosystem.confidence').scale.authored_judgment_question);
  assert.deepEqual(question.levels, scaffold.processes.find((process) => process.id === 'ecosystem.confidence').initialEstimate.question.levels);
  assert.equal(estimator.calls, 1);
  const uncertain = conceptualScaffold({ estimate: true });
  uncertain.id = 'market-fixture-unresolved-judgment';
  uncertain.processes.find((process) => process.id === 'ecosystem.confidence').initialEstimate.question.minimumConfidence = 0.95;
  const lowProvider = scoreEstimator();
  const lowPreview = await buildWorldModel({ requestId: 'unresolved-judgment', scaffold: uncertain }, service, lowProvider);
  assert.equal(lowPreview.status, 'preview', 'supported measurements permit construction while a judgment remains unknown');
  const lowApplied = await buildWorldModel({ requestId: 'unresolved-judgment-apply', apply: true, proposalId: lowPreview.proposalId, expectedProposalHash: lowPreview.proposalHash }, service, lowProvider);
  assert.equal(lowApplied.status, 'applied', JSON.stringify(lowApplied));
  const lowModel = await service.inspectModel({ modelHash: lowApplied.modelHash, includeDefinition: true });
  assert.equal(lowModel.model.processes.some((process) => process.id === 'ecosystem.confidence'), false);
  assert.deepEqual(lowApplied.summary.contextReview.authoredJudgments.judgmentTargets, [{ processId: 'ecosystem.confidence', representation: 'unresolved_judgment_definition' }]);
  const graph = await service.queryNarrativeGraph({ graphHash: lowApplied.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  const review = JSON.parse(graph.nodes.find((node) => node.id === 'general.context_review.authoredJudgments').text);
  assert.match(review.interpretation, /not a scored result/);
  assert.equal(graph.edges.some((edge) => edge.source.node_id === 'general.context_review.authoredJudgments' && edge.target.node_id === 'general.process.ecosystem.confidence' && edge.family === 'semantic'), true);
  assert.equal(lowProvider.calls, 1);
});

test('unsupported judgment and concept declarations fail before paid Jev calls', async (t) => {
  const service = await realService(t);
  const estimator = scoreEstimator();
  const cases = [
    ['unbound-judgment', (s) => s.contextReview.authoredJudgments.processIds = ['market.price'], /numeric estimate process/],
    ['missing-native-concept', (s) => s.contextReview.conceptualStructure.conceptIds = ['metadata-only-concept'], /conceptIds names unknown/],
    ['false-structure', (s) => s.contextReview.conceptualStructure.conceptIds = [], /actual native conceptIds/],
    ['unknown-child', (s) => s.abstractCuts[0].childConceptIds[0] = 'missing', /concept references names unknown/],
    ['cyclic-cut', (s) => s.abstractCuts.push({ id: 'cycle', parentConceptId: 'readiness.research', childConceptIds: ['readiness', 'readiness.operation'], lens: 'Invalid cycle.' }), /acyclic/],
    ['unbound-variation', (s) => s.concepts[1].eventIds = [], /dated events must be linked/],
    ['undated-variation', (s) => s.events.find((event) => event.id === 'upgrade').interval = null, /two dated contexts/],
    ['one-context-one-meaning', (s) => { s.contextReview.conceptVariation.conceptIds = ['readiness.operation']; s.contextReview.conceptVariation.eventIds = ['upgrade']; }, /two dated contexts/],
    ['false-same-event-view', (s) => s.contextReview.conceptVariation.eventIds = ['upgrade'], /each contextual concept definition/],
    ['measurement-rubric', (s) => s.processes[0].judgmentQuestion = { type: 'score', instructions: 'An inappropriate authored rubric on a report.', unit: 'USD/token', levels: [{ description: 'Low.', value: 0 }, { description: 'High.', value: 10000 }] }, /cannot label an observed/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const scaffold = conceptualScaffold({ estimate: true }); mutate(scaffold);
    await assert.rejects(buildWorldModel({ requestId: `bad-representation-${name}`, scaffold }, service, estimator), pattern, name);
  }
  assert.equal(estimator.calls, 0);
  assert.equal(service.models.size, 0);
  assert.equal(service.worlds.size, 0);
});
