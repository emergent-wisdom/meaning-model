import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { LifeSimulationService } from '../src/service.mjs';
import { prepareAlignmentAudit, selectRecords, validatedAuditScores } from '../src/alignment-audit.mjs';

test('malformed audit answers cannot become a clean diagnosis', () => {
  const questions = { a: { type: 'noul' } };
  for (const answers of [{}, { b: { type: 'noul', noul: 0 } }, { a: { type: 'choice', noul: 0 } }, ...[null, -1, 2, NaN, '0'].map((noul) => ({ a: { type: 'noul', noul } }))]) {
    assert.throws(() => validatedAuditScores(answers, questions, 'passage'), /exactly|invalid/);
  }
  assert.deepEqual(validatedAuditScores({ a: { type: 'noul', noul: 0 } }, questions, 'passage'), { a: 0 });
  assert.deepEqual(selectRecords({ nodes: [{ id: 'diagnostic', role: 'metadata', node_type: 'alignment_audit', text: 'Previous audit' }], roots: [] }, { sequence: [] }, { recordNodeIds: [] }), []);
});

test('audit preserves evidence audiences, distinct disclosure questions and exact recorded retries in Rust', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  const model = await service.registerModel({ ...blocks[1], requestId: 'audit-integrity-model' });
  const request = JSON.parse(JSON.stringify(blocks[2]).replaceAll('MODEL_HASH', model.modelHash));
  request.requestId = 'audit-integrity-graph';
  const graph = request.narrativeGraph;
  const root = graph.nodes.find((node) => node.role === 'document_root');
  const fact = graph.nodes.find((node) => node.role === 'metadata');
  fact.access_scopes = ['secret'];
  root.text = '# The offer\n\nSomeone offered to buy the bakery.';
  const registered = await service.registerNarrativeGraph(request);
  let calls = 0;
  const seen = [];
  const estimator = { backend: 'typesafe', model: 'test', async estimate(state, questions) {
    calls++; seen.push(questions);
    return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: key.startsWith('leak_') ? 0.9 : 0.1 }])) };
  } };
  // Render a real passage, since document headings are deliberately not audit units.
  const passage = { ...root, id: 'whole', role: 'story_passage', node_type: 'passage', text: 'Someone offered to buy the bakery.' };
  const batch = await service.applyNarrativeBatch({ requestId: 'audit-integrity-passage', previousGraphHash: registered.graphHash, narrativeBatch: {
    schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: registered.graphHash, reason: 'Test passage.', provenance: ['audit-integrity'], add_roots: [], add_nodes: [passage],
    add_edges: [{ id: 'passage.placement', source: { kind: 'node', node_id: root.id }, target: { kind: 'node', node_id: passage.id }, family: 'structural', relation: 'contains', order: 0, access_scopes: [], provenance: ['audit-integrity'] }],
  } });
  const input = { graphHash: batch.graphHash, rootId: root.id, accessScopes: ['public', 'secret'], recordNodeIds: [fact.id], chunk: 'both', withheld: [
    { nodeId: fact.id, audience: 'reader' }, { nodeId: fact.id, audience: 'viewpoint', viewpoint: 'Ada' }, { nodeId: fact.id, audience: 'viewpoint', viewpoint: 'Ben' },
  ], record: { requestId: 'audit-integrity-record', nodeId: 'audit.result' } };
  await assert.rejects(prepareAlignmentAudit(service, { ...input, record: { ...input.record, requestId: 'audit-bad-scopes', accessScopes: ['public'] } }, estimator), /widen/);
  assert.equal(calls, 0, 'scope validation happens before sending evidence to the estimator');
  const result = await prepareAlignmentAudit(service, input, estimator);
  assert.equal(result.results.flags.leaks.length, 3);
  assert.deepEqual(result.results.flags.leaks.map(({ audience, viewpoint }) => [audience, viewpoint]), [['reader', null], ['viewpoint', 'Ada'], ['viewpoint', 'Ben']]);
  assert.match(seen[0].leak_1.instructions, /Ada/);
  assert.match(seen[0].leak_2.instructions, /Ben/);
  assert.deepEqual(await prepareAlignmentAudit(service, input, estimator), result);
  assert.equal(result.results.passages.length, 1);
  assert.equal(result.results.passages[0].id, 'whole', 'a node named whole remains a passage');
  assert.equal(calls, 2, 'a recorded retry does not ask the estimator again');
  const publicView = await service.queryNarrativeGraph({ graphHash: result.recorded.graphHash, mode: 'full', includeContent: true, accessScopes: ['public'] });
  assert.ok(!publicView.nodes.some((node) => node.id === 'audit.result'));
  const privateView = await service.queryNarrativeGraph({ graphHash: result.recorded.graphHash, mode: 'full', includeContent: true, accessScopes: ['secret'] });
  assert.deepEqual(privateView.nodes.find((node) => node.id === 'audit.result').access_scopes, ['secret']);
});
