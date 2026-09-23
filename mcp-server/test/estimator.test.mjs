import assert from 'node:assert/strict';
import test from 'node:test';
import { createEstimator, parseEstimatorConfig, MAX_ESTIMATOR_REQUEST_CHARS } from '../src/estimator-config.mjs';
import { buildCutShareQuestions, cutSharesSchema, proposeCutShares } from '../src/cut-shares.mjs';
import { buildAlignmentQuestions, flagScores, prepareAlignmentAudit, selectRecords } from '../src/alignment-audit.mjs';

const graphHash = 'a'.repeat(64), snapshotHash = 'b'.repeat(64), projectionHash = 'c'.repeat(64);

test('estimator is off unless configured, and misconfiguration fails loudly without leaking the key', () => {
  assert.deepEqual(parseEstimatorConfig({}), { backend: null });
  assert.equal(createEstimator(parseEstimatorConfig({})), null);
  assert.throws(() => parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'oracle' }), /Unknown Meaning Model estimator/);
  assert.throws(() => parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'typesafe' }), /requires TYPESAFE_API_KEY/);
  assert.throws(() => parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'typesafe', TYPESAFE_API_KEY: 'k', TYPESAFE_ENDPOINT: 'http://insecure' }), /https/);
  const config = parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'typesafe', TYPESAFE_API_KEY: 'secret-key' });
  assert.equal(config.model, 'jev-latest');
  assert.equal(config.endpoint, 'https://api.typesafe.ai/v1/systemone');
});

test('the typesafe estimator posts state and questions with the bearer key and returns answers', async () => {
  const seen = [];
  const estimator = createEstimator(parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'typesafe', TYPESAFE_API_KEY: 'secret-key', TYPESAFE_MODEL: 'jev-1.13.0' }), {
    fetch: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', usage: { input_tokens: 10, output_tokens: 2 }, answers: { q: { type: 'noul', noul: 0.9 } } }) }; },
  });
  const result = await estimator.estimate({ text: 'x' }, { q: { type: 'noul', instructions: 'is x' } });
  assert.equal(result.answers.q.noul, 0.9);
  assert.equal(seen[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(seen[0].init.body), { model: 'jev-1.13.0', state: { text: 'x' }, questions: { q: { type: 'noul', instructions: 'is x' } } });
  const failing = createEstimator(parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'typesafe', TYPESAFE_API_KEY: 'k' }), { fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }) });
  await assert.rejects(failing.estimate({}, {}), /HTTP 401/);
  const oversized = createEstimator(parseEstimatorConfig({ MEANING_MODEL_ESTIMATOR: 'typesafe', TYPESAFE_API_KEY: 'k' }), { fetch: async () => { throw new Error('must not be called'); } });
  await assert.rejects(oversized.estimate({ text: 'y'.repeat(MAX_ESTIMATOR_REQUEST_CHARS) }, {}), /limit is/);
});

const cutInput = { question: 'How does attention divide?', answers: [{ key: 'money', meaning: 'Debt and costs.' }, { key: 'grief', meaning: 'The mother.' }], subject: 'Kaj', situations: [{ id: 'h6', parentEventId: 'event.kaj.state.h6', text: 'Kaj feeds the starter on the funeral morning.' }, { id: 'h14', text: 'Kaj must decide before the wake.' }] };

test('cut-share questions are one choice per situation over the answers plus an automatic remainder', () => {
  const input = cutSharesSchema.parse(cutInput);
  const tasks = buildCutShareQuestions(input, input.situations.map((situation) => ({ id: situation.id, text: situation.text, parentEventId: situation.parentEventId, cutId: null })));
  assert.equal(tasks.length, 2);
  assert.deepEqual(Object.keys(tasks[0].questions.shares.criteria), ['money', 'grief', 'remainder']);
  assert.equal(tasks[0].state.situation, cutInput.situations[0].text);
  assert.throws(() => cutSharesSchema.parse({ ...cutInput, answers: [...cutInput.answers, { key: 'remainder', meaning: 'x' }] }), /added automatically/);
  assert.throws(() => cutSharesSchema.parse({ ...cutInput, answers: [cutInput.answers[0], cutInput.answers[0]] }), /unique/);
});

test('without an estimator the cut-share tool returns a calling-LLM task and no proposals', async () => {
  const result = await proposeCutShares(cutInput, null);
  assert.equal(result.evaluator, 'calling_llm');
  assert.equal(result.proposals, null);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.canonical, false);
  assert.equal(result.evidenceType, 'estimate', 'the engine vocabulary: an AI estimate is evidence of type estimate');
  assert.equal(result.epistemicStatus, 'ai_inference');
});

test('with an estimator the proposals are normalized Cuts with remainder, provenance and confidence', async () => {
  const fake = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate(state) { const decision = state.situation.includes('decide'); return { model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 5 }, answers: { shares: { type: 'choice', choice: decision ? 'money' : 'grief', confidence: 0.61, probabilities: decision ? { money: 0.6, grief: 0.3, remainder: 0.1 } : { money: 0.2, grief: 0.7, remainder: 0.1 } } } }; } };
  const result = await proposeCutShares(cutInput, fake);
  assert.equal(result.evaluator, 'typesafe:jev-1.13.0');
  assert.equal(result.proposals.length, 2);
  for (const cut of result.proposals) {
    assert.ok(Math.abs(cut.answers.reduce((sum, answer) => sum + answer.weight, 0) - 1) < 1e-9);
    assert.ok(cut.answers.some((answer) => answer.key === 'remainder'));
    assert.match(cut.provenance[0], /estimator:typesafe:jev-1.13.0/);
    assert.equal(cut.unit, 'share of one budget');
  }
  assert.equal(result.proposals[0].id, 'cut.estimated.h6');
  assert.equal(result.proposals[0].parent_event_id, 'event.kaj.state.h6');
  assert.equal(result.proposals[0].top, 'grief');
  assert.equal(result.proposals[1].top, 'money');
  assert.equal(result.usage.input_tokens, 200);
  assert.equal(result.canonical, false);
});

function auditFixture() {
  const calls = [];
  const rendered = { graph_hash: graphHash, source_snapshot_hash: snapshotHash, projection_hash: projectionHash, sequence: ['story', 'scene-1-p1', 'scene-1-p2'], text: '# Title\n\nHe fed the starter at six.\n\nShe arrived off the night ferry.' };
  const view = { graph_hash: graphHash, content_included: true, source_snapshot_hash: snapshotHash, roots: ['story', 'story.understanding.root'], edges: [], nodes: [
    { id: 'story.understanding.root', role: 'metadata', node_type: 'understanding_root', text: 'Author understanding root.' },
    { id: 'story', role: 'document_root', text: '# Title' },
    { id: 'scene-1-p1', role: 'story_passage', text: 'He fed the starter at six.' },
    { id: 'scene-1-p2', role: 'story_passage', text: 'She arrived off the night ferry.' },
    { id: 'canon.feeding', role: 'metadata', node_type: 'authored_fact', text: 'The starter is fed at six daily.', evidence_cutoff: 6.5 },
    { id: 'ctx.offer', role: 'metadata', node_type: 'authored_context', text: 'Hegna offered 1,200,000 NOK for the culture.' },
    { id: 'brief', role: 'metadata', node_type: 'storytelling.context', text: 'Author brief: not a canon record.' },
    { id: 'review-1', role: 'externalized_reflection', text: 'A review.' },
  ] };
  const service = { async renderNarrativeGraph(input) { calls.push(['render', input]); return structuredClone(rendered); }, async queryNarrativeGraph(input) { calls.push(['query', input]); return structuredClone(view); } };
  return { calls, rendered, view, service };
}

test('alignment audit selects canon records by default, excludes the title and authoring records, and returns a task without an estimator', async () => {
  const f = auditFixture();
  const task = await prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', accessScopes: ['story-author', 'story-author'], withheld: [{ nodeId: 'ctx.offer', audience: 'reader' }] });
  assert.deepEqual(f.calls[0], ['render', { graphHash, expectedGraphHash: graphHash, rootIds: ['story'], accessScopes: ['story-author'] }]);
  assert.deepEqual(task.units.map((unit) => unit.id), ['scene-1-p1', 'scene-1-p2']);
  assert.deepEqual(task.records.map((record) => record.id), ['canon.feeding', 'ctx.offer'], 'graph roots and authoring records are not default audit records');
  assert.equal(task.records[0].evidenceCutoff, 6.5);
  assert.equal(task.evaluator, 'calling_llm');
  assert.equal(task.results, null);
  assert.deepEqual(Object.keys(task.questions), ['narrates_canon.feeding', 'contradicts_canon.feeding', 'narrates_ctx.offer', 'contradicts_ctx.offer', 'leak_0', 'unsupported_new_fact']);
  assert.match(task.questions['narrates_canon.feeding'].instructions, /recorded as of time 6.5/);
  assert.deepEqual(task.chunks.map((chunk) => chunk.id), ['whole', 'scene-1-p1', 'scene-1-p2']);
  assert.equal(task.semanticVerification, false);
  assert.equal(task.graphMutation, false);
});

test('alignment audit scores whole and passages, flags at the threshold, and reports usage', async () => {
  const f = auditFixture();
  const seen = [];
  const fake = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate(state, questions) { seen.push(state.passage_under_review); const leak = state.passage_under_review.includes('ferry') ? 0.8 : 0.1; return { model: 'jev-1.13.0', usage: { input_tokens: 50, output_tokens: 1 }, answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: key.startsWith('narrates_') ? 0.9 : key.startsWith('leak_') ? leak : key === 'contradicts_ctx.offer' && state.passage_under_review.includes('six') ? 0.7 : 0.1 }])) }; } };
  const result = await prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', accessScopes: ['story-author'], withheld: [{ nodeId: 'ctx.offer', audience: 'reader' }] }, fake);
  assert.equal(result.evaluator, 'typesafe:jev-1.13.0');
  assert.equal(seen.length, 3);
  assert.equal(seen[0], f.rendered.text);
  assert.equal(result.results.passages.length, 2);
  assert.deepEqual(result.results.flags.contradictions.map((flag) => [flag.recordId, flag.unitId]), [['ctx.offer', 'scene-1-p1']]);
  assert.deepEqual(result.results.flags.leaks.map((flag) => [flag.nodeId, flag.unitId]), [['ctx.offer', 'scene-1-p2']]);
  assert.deepEqual(result.results.flags.notNarrated, []);
  assert.equal(result.results.usage.input_tokens, 150);
  assert.equal(result.advisoryOnly, true);
});

test('alignment audit rejects unknown record nodes, missing prose, and mismatched graphs', async () => {
  const f = auditFixture();
  await assert.rejects(prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', recordNodeIds: ['missing'] }), /unknown or inaccessible/);
  await assert.rejects(prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', withheld: [{ nodeId: 'review-1', audience: 'reader' }], recordNodeIds: ['canon.feeding'] }).then(() => { throw new Error('reflection text should still be readable'); }, () => {}), /reflection text/);
  const mismatched = { ...f.service, async renderNarrativeGraph() { return { ...f.rendered, graph_hash: 'd'.repeat(64) }; } };
  await assert.rejects(prepareAlignmentAudit(mismatched, { graphHash, rootId: 'story' }), /exact requested graph revision/);
  const flags = flagScores({ 'contradicts_a': 0.5, 'contradicts_b': 0.49, 'leak_c': 0.9, 'narrates_d': 0.2 }, 'u');
  assert.deepEqual(flags.contradictions.map((flag) => flag.recordId), ['a']);
  assert.deepEqual(flags.leaks.map((flag) => flag.nodeId), ['c']);
  assert.deepEqual(flags.notNarrated.map((flag) => flag.recordId), ['d']);
  assert.equal(selectRecords(f.view, f.rendered, { recordNodeIds: [] }).length, 2);
  assert.equal(Object.keys(buildAlignmentQuestions([], [], null)).length, 1);
});

import { assertModelSuccessor, buildRebindSuccessor, rebindNarrativeGraph } from '../src/narrative-rebind.mjs';

const oldModel = 'e'.repeat(64), newModel = 'f'.repeat(64);
function modelFixture() {
  const calls = [];
  const definition = { id: 'm', time_unit: 'hour', revision: { number: 1, previous_model_hash: '1'.repeat(64), provenance: ['p'], reason: 'r' }, processes: [], meaning_model: { events: [{ id: 'event.kaj.state.h6', boundary: 'Kaj feeds the starter.', description: 'Funeral morning.' }, { id: 'event.silent' }], normalized_cuts: [{ id: 'cut.estimated.event.kaj.state.h6', parent_event_id: 'event.kaj.state.h6', question: 'old', unit: 'u', answers: [{ key: 'remainder', weight: 1 }], provenance: ['old'] }] } };
  const graphView = { graph_hash: graphHash, content_included: true, source_snapshot_hash: snapshotHash, returned_node_count: 2, total_node_count: 2, returned_edge_count: 3, total_edge_count: 3, graph: { id: 'g', node_count: 2, edge_count: 3, root_count: 1, revision: { number: 4 }, source: { kind: 'model', model_hash: oldModel } }, roots: ['story'], nodes: [{ id: 'story', role: 'document_root', text: '# T', boundary: 'projection-only', content_included: true }, { id: 'depth-1', role: 'externalized_reflection', text: 'x', holder: 'a', access_scopes: ['s'] }], edges: [{ id: 'e1', source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: 'depth-1' }, family: 'structural', relation: 'contains', order: 1, explanation: 'projection-only' }, { id: 'e2', source: { kind: 'node', node_id: 'depth-1' }, target: { kind: 'anchor', anchor_kind: 'model', anchor_id: oldModel }, family: 'grounding', relation: 'about' }, { id: 'e3', source: { kind: 'node', node_id: 'depth-1' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'event.kaj.state.h6' }, family: 'grounding', relation: 'about' }] };
  const service = {
    async inspectModel({ modelHash, includeDefinition }) { calls.push(['inspect', modelHash]); if (modelHash === newModel) return { modelHash, summary: { revision: { number: 2, previous_model_hash: oldModel } } }; if (modelHash === oldModel) return { modelHash, summary: { revision: { number: 1, previous_model_hash: '1'.repeat(64) } }, ...(includeDefinition ? { model: structuredClone(definition) } : {}) }; return { modelHash, summary: { revision: { number: 0, previous_model_hash: null } } }; },
    async reviseModel(input) { calls.push(['revise', input]); return { modelHash: newModel, previousModelHash: input.previousModelHash, stored: true, summary: { normalized_cut_count: input.model.meaning_model.normalized_cuts.length } }; },
    async queryNarrativeGraph(input) { calls.push(['query', input]); return { ...structuredClone(graphView), graph_hash: input.graphHash }; },
    async reviseNarrativeGraph(input) { calls.push(['reviseGraph', input]); return { graphHash: 'a1'.repeat(32), stored: true }; },
  };
  return { calls, definition, graphView, service };
}
const fakeEstimator = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate() { return { model: 'jev-1.13.0', usage: { input_tokens: 10, output_tokens: 1 }, answers: { shares: { type: 'choice', choice: 'grief', confidence: 0.5, probabilities: { money: 0.2, grief: 0.7, remainder: 0.1 } } } }; } };
const answers = [{ key: 'money', meaning: 'Debt.' }, { key: 'grief', meaning: 'The mother.' }];

test('event targets read their situation text from the bound model and apply registers one complete revision', async () => {
  const f = modelFixture();
  const result = await proposeCutShares({ question: 'q', answers, modelHash: oldModel, events: [{ eventId: 'event.kaj.state.h6' }], apply: true, replaceExisting: true, requestId: 'req-1' }, fakeEstimator, f.service);
  assert.equal(result.applied.modelHash, newModel);
  assert.equal(result.applied.revisionNumber, 2);
  const revise = f.calls.find(([kind]) => kind === 'revise')[1];
  assert.equal(revise.requestId, 'req-1');
  assert.equal(revise.previousModelHash, oldModel);
  assert.equal(revise.model.revision.previous_model_hash, oldModel);
  assert.equal(revise.model.revision.number, 2);
  const cuts = revise.model.meaning_model.normalized_cuts;
  assert.equal(cuts.length, 1, 'the existing cut with the same id was replaced, not duplicated');
  assert.equal(cuts[0].parent_event_id, 'event.kaj.state.h6');
  assert.ok(Math.abs(cuts[0].answers.reduce((sum, answer) => sum + answer.weight, 0) - 1) < 1e-9);
  assert.match(cuts[0].provenance[0], /estimator:typesafe:jev-1.13.0/);
  assert.equal(result.rebound, null);
  assert.equal(result.graphMutation, false);
});

test('apply refuses duplicates without replaceExisting, unknown events, silent events and missing request ids', async () => {
  const f = modelFixture();
  await assert.rejects(proposeCutShares({ question: 'q', answers, modelHash: oldModel, events: [{ eventId: 'event.kaj.state.h6' }], apply: true, requestId: 'r' }, fakeEstimator, f.service), /already exists/);
  await assert.rejects(proposeCutShares({ question: 'q', answers, modelHash: oldModel, events: [{ eventId: 'event.missing' }] }, fakeEstimator, f.service), /does not exist/);
  await assert.rejects(proposeCutShares({ question: 'q', answers, modelHash: oldModel, events: [{ eventId: 'event.silent' }] }, fakeEstimator, f.service), /no boundary or description/);
  await assert.rejects(proposeCutShares({ question: 'q', answers, modelHash: oldModel, events: [{ eventId: 'event.kaj.state.h6' }], apply: true }, fakeEstimator, f.service), /requires requestId/);
  await assert.rejects(proposeCutShares({ question: 'q', answers, events: [{ eventId: 'event.kaj.state.h6' }] }, fakeEstimator, f.service), /require modelHash/);
  await assert.rejects(proposeCutShares({ question: 'q', answers, situations: [{ id: 's', parentEventId: 'event.kaj.state.h6', text: 't' }], apply: true, modelHash: oldModel, requestId: 'r-no-estimator' }, null, f.service), /configure an estimator or supply distributions/);
});

test('supplied distributions are placed without an estimator, and rebind moves the graph in the same call', async () => {
  const f = modelFixture();
  const result = await proposeCutShares({ question: 'q', answers, modelHash: oldModel, events: [{ eventId: 'event.kaj.state.h6', cutId: 'cut.kaj.h6.attention' }], distributions: [{ situationId: 'event.kaj.state.h6', probabilities: { money: 0.5, grief: 0.4 }, confidence: 0.9 }], apply: true, requestId: 'req-2', rebind: { graphHash, accessScopes: ['s'] } }, null, f.service);
  assert.equal(result.evaluator, 'supplied');
  assert.equal(result.proposals[0].id, 'cut.kaj.h6.attention');
  assert.ok(Math.abs(result.proposals[0].answers.find((answer) => answer.key === 'remainder').weight - 0.1) < 1e-9);
  assert.equal(result.applied.cutIds[0], 'cut.kaj.h6.attention');
  assert.equal(result.rebound.modelHash, newModel);
  assert.deepEqual(result.rebound.droppedModelAnchorEdgeIds, ['e2']);
  const reviseGraph = f.calls.find(([kind]) => kind === 'reviseGraph')[1];
  assert.equal(reviseGraph.requestId, 'req-2-rebind');
  assert.equal(reviseGraph.narrativeGraph.source.model_hash, newModel);
  assert.equal(reviseGraph.narrativeGraph.revision.number, 5);
  assert.equal(reviseGraph.narrativeGraph.revision.previous_graph_hash, graphHash);
  assert.deepEqual(reviseGraph.narrativeGraph.edges.map((edge) => edge.id), ['e1', 'e3']);
  assert.equal(reviseGraph.narrativeGraph.nodes[0].boundary, undefined, 'projection-only node fields are stripped');
  assert.equal(reviseGraph.narrativeGraph.edges[0].explanation, undefined, 'projection-only edge fields are stripped');
  assert.equal(result.graphMutation, true);
});

test('rebind refuses partial projections, non-model sources, unrelated models and already-bound models', async () => {
  const f = modelFixture();
  const partial = { ...f.graphView, returned_node_count: 1 };
  assert.throws(() => buildRebindSuccessor(partial, { graphHash, modelHash: newModel, reason: 'r', provenance: [] }), /complete graph/);
  const world = structuredClone(f.graphView); world.graph.source = { kind: 'world', world_id: 'w', world_hash: 'h' };
  assert.throws(() => buildRebindSuccessor(world, { graphHash, modelHash: newModel, reason: 'r', provenance: [] }), /model-bound graphs only/);
  await assert.rejects(assertModelSuccessor(f.service, oldModel, 'd'.repeat(64)), /not a successor/);
  assert.equal(await assertModelSuccessor(f.service, oldModel, newModel), 1);
  await assert.rejects(rebindNarrativeGraph(f.service, { requestId: 'r', graphHash, modelHash: oldModel, accessScopes: ['s'] }), /already bound/);
  const result = await rebindNarrativeGraph(f.service, { requestId: 'r', graphHash, modelHash: newModel, accessScopes: ['s', 's'] });
  assert.equal(result.lineageSteps, 1);
  assert.equal(result.previousModelHash, oldModel);
  assert.equal(result.historicalAssessmentsRetained, true);
});

test('alignment audit can skip contradiction checks for knowledge-state records and record its findings in the graph', async () => {
  const f = auditFixture();
  const batches = [];
  f.service.applyNarrativeBatch = async (input) => { batches.push(input); return { graphHash: 'b2'.repeat(32), stored: true }; };
  f.view.graph = { id: 'g', revision: { number: 7 }, source: { kind: 'model', model_hash: oldModel } };
  f.view.edges = [{ id: 'c1', source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: 'scene-1-p1' }, family: 'structural', relation: 'contains', order: 0 }];
  f.service.queryNarrativeGraph = async () => structuredClone(f.view);
  const fake = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate(state, questions) { return { model: 'jev-1.13.0', usage: { input_tokens: 5, output_tokens: 1 }, answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: key.startsWith('narrates_') ? 0.9 : 0.2 }])) }; } };
  const result = await prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', accessScopes: ['story-author'], knowledgeStateNodeIds: ['ctx.offer'], record: { requestId: 'rec-1', nodeId: 'audit-1' } }, fake);
  assert.ok(!('contradicts_ctx.offer' in result.results.whole.scores), 'knowledge-state records get no contradiction question');
  assert.ok('contradicts_canon.feeding' in result.results.whole.scores);
  assert.equal(result.recorded.nodeId, 'audit-1');
  assert.equal(result.graphHash, 'b2'.repeat(32), 'with record, the top-level graphHash is the successor, as for other write tools');
  assert.equal(result.auditedGraphHash, graphHash, 'the audited revision stays addressable');
  assert.equal(result.recorded.documentRootId, 'story');
  assert.equal(result.graphMutation, true);
  const batch = batches[0].narrativeBatch;
  assert.equal(batches[0].requestId, 'rec-1');
  assert.equal(batch.add_nodes[0].role, 'metadata');
  assert.equal(batch.add_nodes[0].node_type, 'alignment_audit');
  assert.equal(batch.add_nodes[0].render, 'exclude');
  assert.equal(batch.add_nodes[0].evidence_type, 'estimate');
  assert.deepEqual(batch.add_nodes[0].access_scopes, ['story-author']);
  assert.deepEqual(batch.add_edges.map((edge) => edge.relation), ['contains', 'about']);
  assert.equal(JSON.parse(batch.add_nodes[0].text).evaluator, 'typesafe:jev-1.13.0');
  await assert.rejects(prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', knowledgeStateNodeIds: ['nope'] }, fake), /not among the audited records/);
});

import { ingestSituation } from '../src/situation-ingest.mjs';

test('ingest creates described events under a parent, asks every question per event, applies one revision, rebinds and records notes', async () => {
  const f = modelFixture();
  f.definition.meaning_model.referents = [{ id: 'referent.bitcoin' }];
  f.definition.meaning_model.events.push({ id: 'event.world', boundary: 'Accepted world.' });
  const batches = [];
  f.service.applyNarrativeBatch = async (input) => { batches.push(input); return { graphHash: 'c3'.repeat(32), stored: true }; };
  const estimator = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate(state, questions) { const q = questions.shares.instructions; const liquidity = /liquidity/i.test(q); return { model: 'jev-1.13.0', usage: { input_tokens: 20, output_tokens: 1 }, answers: { shares: { type: 'choice', choice: 'x', confidence: 0.4, probabilities: liquidity ? { thin: 0.7, deep: 0.2, remainder: 0.1 } : { fear: 0.6, greed: 0.3, remainder: 0.1 } } } }; } };
  const result = await ingestSituation({ requestId: 'ing-1', modelHash: oldModel, apply: true,
    events: [{ eventId: 'event.btc.halving-2028', boundary: 'The 2028 halving cuts issuance by half.', description: 'Miners with thin margins capitulate over the following quarter.', parentEventId: 'event.world', interval: { start: 0, end: 90 }, participants: { asset: 'referent.bitcoin' } }],
    questions: [{ id: 'sentiment', question: 'Which sentiment dominates market attention?', answers: [{ key: 'fear', meaning: 'Loss aversion.' }, { key: 'greed', meaning: 'Gain seeking.' }] }, { id: 'liquidity', question: 'How is liquidity best described?', answers: [{ key: 'thin', meaning: 'Thin order books.' }, { key: 'deep', meaning: 'Deep order books.' }] }],
    graph: { graphHash, accessScopes: ['s'], notes: [{ nodeId: 'note.halving', text: 'The halving matters only through miner margins; this is the causal link to model next.', holder: 'author.llm', aboutEventIds: ['event.btc.halving-2028'] }] } }, estimator, f.service);
  assert.deepEqual(result.eventsAdded, ['event.btc.halving-2028']);
  assert.deepEqual(result.applied.cutIds, ['cut.event.btc.halving-2028.sentiment', 'cut.event.btc.halving-2028.liquidity']);
  const revise = f.calls.find(([kind]) => kind === 'revise')[1].model;
  const added = revise.meaning_model.events.find((event) => event.id === 'event.btc.halving-2028');
  assert.equal(added.description, 'Miners with thin margins capitulate over the following quarter.');
  assert.deepEqual(added.participants, { asset: 'referent.bitcoin' });
  assert.ok(revise.meaning_model.event_relations.some((relation) => relation.kind === 'contains' && relation.source_event_id === 'event.world' && relation.target_event_id === 'event.btc.halving-2028'));
  assert.equal(revise.meaning_model.normalized_cuts.filter((cut) => cut.parent_event_id === 'event.btc.halving-2028').length, 2);
  assert.equal(result.rebound.modelHash, newModel);
  assert.equal(result.notes.nodeIds[0], 'note.halving');
  const batch = batches[0].narrativeBatch;
  assert.deepEqual(batch.add_roots, ['understanding.ingest']);
  const note = batch.add_nodes.find((node) => node.id === 'note.halving');
  assert.equal(note.role, 'externalized_reflection');
  assert.equal(note.holder, 'author.llm');
  assert.ok(batch.add_edges.some((edge) => edge.target.kind === 'anchor' && edge.target.anchor_id === 'event.btc.halving-2028'));
  // What the estimator judged stays in the graph: both question definitions and the exact situation text.
  const definitions = batch.add_nodes.filter((node) => node.node_type === 'cut_question_definition').map((node) => JSON.parse(node.text));
  assert.deepEqual(definitions.map((definition) => definition.questionId), ['sentiment', 'liquidity']);
  assert.deepEqual(definitions[0].answers, [{ key: 'fear', meaning: 'Loss aversion.' }, { key: 'greed', meaning: 'Gain seeking.' }]);
  assert.equal(definitions[0].remainderMeaning, 'Something else, or no single named answer dominates.');
  assert.deepEqual(definitions[1].cutIds, ['cut.event.btc.halving-2028.liquidity']);
  const situation = JSON.parse(batch.add_nodes.find((node) => node.node_type === 'estimator_situation_text').text);
  assert.equal(situation.text, 'The 2028 halving cuts issuance by half. Miners with thin margins capitulate over the following quarter.');
  assert.equal(batch.add_edges.filter((edge) => edge.relation === 'judged_against').length, 2);
  assert.equal(result.notes.evidenceNodeIds.length, 3);
  assert.equal(result.graphMutation, true);
});

test('ingest notes can link to each other, and a conditioned question divides one answer of another', async () => {
  const f = modelFixture();
  f.definition.meaning_model.events.push({ id: 'event.world', boundary: 'Accepted world.' });
  const batches = [];
  f.service.applyNarrativeBatch = async (input) => { batches.push(input); return { graphHash: 'c3'.repeat(32), stored: true }; };
  const estimator = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate(state, questions) {
    const conduit = /conduit/i.test(questions.shares.instructions);
    return { model: 'jev-1.13.0', usage: { input_tokens: 20, output_tokens: 1 }, answers: { shares: { type: 'choice', choice: 'x', confidence: 0.4,
      probabilities: conduit ? { stablecoins: 0.7, etfs: 0.2, remainder: 0.1 } : { monetary: 0.02, crypto: 0.9, remainder: 0.08 } } } };
  } };
  const result = await ingestSituation({ requestId: 'ing-2', modelHash: oldModel, apply: true,
    events: [{ eventId: 'event.2024', boundary: 'Bitcoin in 2024.', parentEventId: 'event.world' }],
    questions: [
      { id: 'driver', question: 'What moved the price?', answers: [{ key: 'monetary', meaning: 'US monetary conditions.' }, { key: 'crypto', meaning: 'Crypto-internal causes.' }] },
      { id: 'conduit', question: 'Through which conduit did the monetary part travel?', answers: [{ key: 'stablecoins', meaning: 'Stablecoin supply.' }, { key: 'etfs', meaning: 'ETF flows.' }], conditionedOn: { questionId: 'driver', answerKey: 'monetary' } },
    ],
    graph: { graphHash, accessScopes: ['s'], notes: [
      { nodeId: 'note.review', text: 'Review of both Cuts.', holder: 'author.llm' },
      { nodeId: 'note.disagreement', text: 'Where the two estimators disagree.', holder: 'author.llm', links: [{ relation: 'refines', targetNodeId: 'note.review' }] },
    ] } }, estimator, f.service);
  const revise = f.calls.find(([kind]) => kind === 'revise')[1].model;
  const conduit = revise.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.event.2024.conduit');
  assert.deepEqual(conduit.conditioning, { cut_id: 'cut.event.2024.driver', answer_key: 'monetary' });
  assert.equal(revise.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.event.2024.driver').conditioning, undefined);
  assert.match(result.warnings[0], /carries only 0\.02/);
  const link = batches[0].narrativeBatch.add_edges.find((edge) => edge.relation === 'refines');
  assert.deepEqual([link.source.node_id, link.target.node_id], ['note.disagreement', 'note.review']);
  await assert.rejects(ingestSituation({ requestId: 'ing-3', modelHash: oldModel, events: [{ eventId: 'event.2024', boundary: 'b', parentEventId: 'event.world' }],
    questions: [{ id: 'conduit', question: 'Q?', answers: [{ key: 'a', meaning: 'A.' }], conditionedOn: { questionId: 'driver', answerKey: 'monetary' } }] }, estimator, f.service), /neither asked in this call nor stored/);
  await assert.rejects(ingestSituation({ requestId: 'ing-4', modelHash: oldModel, events: [{ eventId: 'event.2024', boundary: 'b', parentEventId: 'event.world' }],
    questions: [{ id: 'driver', question: 'Q?', answers: [{ key: 'monetary', meaning: 'M.' }] }, { id: 'conduit', question: 'Q?', answers: [{ key: 'a', meaning: 'A.' }], conditionedOn: { questionId: 'driver', answerKey: 'nope' } }] }, estimator, f.service), /has no answer nope/);
});

test('ingest validates parents, participants, duplicates and pending estimates', async () => {
  const f = modelFixture();
  await assert.rejects(ingestSituation({ requestId: 'r', modelHash: oldModel, events: [{ eventId: 'event.new', boundary: 'b' }] }, fakeEstimator, f.service), /needs a parentEventId/);
  await assert.rejects(ingestSituation({ requestId: 'r', modelHash: oldModel, events: [{ eventId: 'event.new', boundary: 'b', parentEventId: 'event.nope' }] }, fakeEstimator, f.service), /does not exist/);
  await assert.rejects(ingestSituation({ requestId: 'r', modelHash: oldModel, events: [{ eventId: 'event.new', boundary: 'b', parentEventId: 'event.kaj.state.h6', participants: { who: 'referent.nope' } }] }, fakeEstimator, f.service), /unknown referent/);
  await assert.rejects(ingestSituation({ requestId: 'r', modelHash: oldModel, events: [{ eventId: 'event.kaj.state.h6', boundary: 'changed' }] }, fakeEstimator, f.service), /set replaceExisting/);
  const pending = await ingestSituation({ requestId: 'r', modelHash: oldModel, events: [{ eventId: 'event.kaj.state.h6' }], questions: [{ id: 'q', question: 'Q?', answers: [{ key: 'a', meaning: 'A.' }] }] }, null, f.service);
  assert.equal(pending.evaluator, 'calling_llm');
  assert.equal(pending.pending.length, 1);
  assert.equal(pending.applied, null);
  await assert.rejects(ingestSituation({ requestId: 'r', modelHash: oldModel, apply: true, events: [{ eventId: 'event.kaj.state.h6' }], questions: [{ id: 'q', question: 'Q?', answers: [{ key: 'a', meaning: 'A.' }] }] }, null, f.service), /pending/);
});

test('passage contradiction flags carry the whole-unit arbiter and its margin', async () => {
  for (const [whole, expected] of [[0.2, 'cleared'], [0.45, 'close'], [0.6, 'upheld']]) {
    const f = auditFixture();
    const fake = { backend: 'typesafe', model: 'jev-1.13.0', label: 'typesafe:jev-1.13.0', async estimate(state, questions) {
      const isWhole = state.passage_under_review.includes('He fed') && state.passage_under_review.includes('night ferry');
      const passageOne = !isWhole && state.passage_under_review.includes('He fed');
      return { model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 1 }, answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul',
        noul: key.startsWith('narrates_') ? 0.9 : key === 'contradicts_canon.feeding' ? (isWhole ? whole : passageOne ? 0.8 : 0.1) : 0.1 }])) }; } };
    const result = await prepareAlignmentAudit(f.service, { graphHash, rootId: 'story', accessScopes: ['story-author'] }, fake);
    const flag = result.results.flags.contradictions.find((item) => item.recordId === 'canon.feeding');
    assert.equal(flag.unitId, 'scene-1-p1');
    assert.equal(flag.wholeScore, whole);
    assert.equal(flag.arbitration, expected, `whole ${whole}`);
  }
});

test('rebind keeps a model anchor that names the successor by its stable id and drops predecessor-hash anchors', () => {
  const oldHash = 'a'.repeat(64); const newHash = 'b'.repeat(64);
  const node = { id: 'root', node_type: 'story', role: 'document_root', text: '# R', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', provenance: ['t'] };
  const anchor = (edgeId, anchorId) => ({ id: edgeId, source: { kind: 'node', node_id: 'root' }, target: { kind: 'anchor', anchor_kind: 'model', anchor_id: anchorId }, family: 'grounding', relation: 'targets', provenance: ['t'] });
  const view = { graph_hash: 'c'.repeat(64), content_included: true, roots: ['root'], nodes: [node], edges: [anchor('by-id', 'harbour-example'), anchor('by-hash', oldHash)],
    graph: { id: 'g', revision: { number: 3 }, source: { kind: 'model', model_hash: oldHash }, node_count: 1, edge_count: 2, root_count: 1 } };
  const kept = buildRebindSuccessor(view, { graphHash: 'c'.repeat(64), modelHash: newHash, modelId: 'harbour-example', reason: 'r', provenance: [] });
  assert.deepEqual(kept.droppedModelAnchorEdgeIds, ['by-hash']);
  assert.deepEqual(kept.successor.edges.map((edge) => edge.id), ['by-id']);
});
