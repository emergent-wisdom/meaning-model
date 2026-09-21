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
  const tasks = buildCutShareQuestions(input);
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
  assert.equal(result.evidenceType, 'ai_inference');
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
  assert.deepEqual(Object.keys(task.questions), ['narrates_canon.feeding', 'contradicts_canon.feeding', 'narrates_ctx.offer', 'contradicts_ctx.offer', 'leak_ctx.offer', 'unsupported_new_fact']);
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
