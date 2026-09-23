import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorldModel } from '../src/general-modeling.mjs';

function scaffold() {
  return {
    id: 'rejected-initial-estimate', scope: 'Synthetic source-framing judgments.',
    question: 'Can invalid provider answers be inspected without adopting them?',
    time: { unit: 'day', origin: 'Synthetic publication date.' }, accessScopes: ['research-private'],
    contextReview: {
      holder: 'fixture-reviewer', focalInterval: { start: 0, end: 0 },
      broaderContext: { boundary: 'Other publications.', status: 'unknown', assessment: 'No other publications are supplied.' },
      longerTerm: { interval: null, status: 'unknown', assessment: 'A single synthetic publication cannot establish a history.' },
      authoredJudgments: { status: 'represented', assessment: 'Two explicitly authored numerical rubrics describe source framing.', processIds: ['breadth', 'horizon'], sourceIds: ['source'] },
      conceptualStructure: { status: 'out_of_scope', assessment: 'This diagnostic fixture checks rejected judgments without constructing a concept hierarchy.' },
      conceptVariation: { status: 'unknown', assessment: 'One synthetic publication cannot establish variation between situations or dates.' },
    },
    evidence: [{ id: 'source', source: 'fixture:private-publication', text: 'Synthetic private evidence for two authored judgment axes.', evidenceType: 'report', availableAt: 0, holder: 'fixture-publisher' }],
    processes: ['breadth', 'horizon'].map((id) => ({
      id, meaning: `An authored ${id} rubric for source framing, not a measured quantity.`,
      unit: 'authored rubric points', referenceFrame: 'Synthetic fixture publication.',
      type: { kind: 'scalar', minimum: 0, maximum: 100 },
      initialEstimate: { sourceIds: ['source'], question: {
        type: 'score', instructions: `Assess the publication's ${id} against the declared rubric.`, unit: 'authored rubric points',
        levels: [0, 25, 50, 75, 100].map((value) => ({ description: `Synthetic ${id} anchor ${value}.`, value })),
      } },
    })),
  };
}

function unwrittenService() {
  const calls = [];
  return { calls, ...Object.fromEntries(['validateModel', 'registerModel', 'registerNarrativeGraph', 'createWorld'].map((method) => [method, async () => {
    calls.push(method); assert.fail(`Rejected provider output must not reach ${method}.`);
  }])) };
}

test('rejected initial answers return exact bounded diagnostics and identical retries never call the provider again', async () => {
  const service = unwrittenService();
  const input = { requestId: 'inconsistent-score', scaffold: scaffold(), includeDefinition: true };
  const original = structuredClone(input);
  let providerState; let providerQuestions; let providerResult;
  const estimator = { calls: 0, backend: 'typesafe', model: 'fake-jev', label: 'fake-jev', async estimate(state, questions) {
    this.calls += 1;
    providerState = state; providerQuestions = structuredClone(questions);
    providerResult = { model: 'fake-jev-response', usage: { input_tokens: 123, output_tokens: 45 },
      answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, {
        type: 'score', score: key === 'q0' ? 2.03 : 2.5,
        probabilities: { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 }, confidence: 0.3,
        legend: Object.fromEntries(question.criteria.map((description, index) => [index, description])),
      }])) };
    return structuredClone(providerResult);
  } };
  const [result, concurrent] = await Promise.all([buildWorldModel(input, service, estimator), buildWorldModel(input, service, estimator)]);
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result, concurrent);
  assert.equal(result.requestId, input.requestId);
  for (const flag of ['stored', 'modelMutation', 'worldMutation', 'graphMutation']) assert.equal(result[flag], false);
  for (const handle of ['proposalId', 'modelHash', 'graphHash', 'worldId', 'model', 'graph']) assert.equal(Object.hasOwn(result, handle), false);
  assert.deepEqual(result.validationError, { validator: 'meaning-model-initial-estimation/v1', message: 'horizon score 2.5 is inconsistent with its distribution (expected 2.000 on the level-index scale, tolerance 0.040).', questionKey: 'q1', processId: 'horizon' });
  assert.deepEqual(result.accessScopes, ['research-private']);
  assert.equal(result.estimatorReceipt.provider, 'typesafe:fake-jev-response');
  assert.equal(result.estimatorReceipt.state, providerState);
  assert.deepEqual(result.estimatorReceipt.questions, providerQuestions);
  assert.deepEqual(result.estimatorReceipt.answers, providerResult.answers);
  assert.deepEqual(result.estimatorReceipt.usage, providerResult.usage);
  assert.deepEqual(result.estimatorReceipt.sourceEvidenceIds, ['source']);
  assert.deepEqual(JSON.parse(result.estimatorReceipt.state).evidence, input.scaffold.evidence);
  assert.deepEqual(input, original, 'even the valid first answer must not mutate the caller scaffold');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 4 * 1024 * 1024);
  result.estimatorReceipt.answers.q1.score = 0;
  const replay = await buildWorldModel(input, service, estimator);
  assert.deepEqual(replay, concurrent, 'caller mutation must not change the retained diagnostic');
  const differentAudience = structuredClone(input); differentAudience.scaffold.accessScopes = ['public'];
  await assert.rejects(buildWorldModel(differentAudience, service, estimator), /bound to a different/);
  assert.equal(estimator.calls, 1);
  assert.deepEqual(service.calls, []);
});

test('missing or unexpected answer keys preserve the original malformed answers without manufacturing a target result', async () => {
  const service = unwrittenService();
  const estimator = { calls: 0, backend: 'typesafe', model: 'fake-jev', label: 'fake-jev', async estimate() {
    this.calls += 1; return { model: this.model, answers: { unrelated: { type: 'noul', noul: 0.8 } }, usage: null };
  } };
  const input = { requestId: 'wrong-answer-keys', scaffold: scaffold() };
  const result = await buildWorldModel(input, service, estimator);
  assert.equal(result.status, 'rejected');
  assert.match(result.validationError.message, /exactly the requested question keys/);
  assert.equal(Object.hasOwn(result.validationError, 'questionKey'), false);
  assert.equal(Object.hasOwn(result.validationError, 'processId'), false);
  assert.deepEqual(result.estimatorReceipt.answers, { unrelated: { type: 'noul', noul: 0.8 } });
  assert.deepEqual(await buildWorldModel(input, service, estimator), result);
  assert.equal(estimator.calls, 1);
  assert.deepEqual(service.calls, []);
});

test('a reserved initial-estimation source ID is rejected before the provider or any service operation', async () => {
  const service = unwrittenService();
  const input = { requestId: 'reserved-estimator-source', scaffold: scaffold() };
  input.scaffold.evidence.push({ ...input.scaffold.evidence[0], id: 'general.estimator.initial' });
  const estimator = { calls: 0, backend: 'typesafe', model: 'fake-jev', label: 'fake-jev', async estimate() {
    this.calls += 1; assert.fail('Reserved IDs must be rejected before paying for an estimate.');
  } };
  await assert.rejects(buildWorldModel(input, service, estimator), /Evidence ID general\.estimator\.initial is reserved/);
  assert.equal(estimator.calls, 0);
  assert.deepEqual(service.calls, []);
});
