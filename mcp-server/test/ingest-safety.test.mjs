import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { proposeCutShares } from '../src/cut-shares.mjs';
import { ingestSituation, ingestSchema } from '../src/situation-ingest.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';

const modelHash = 'a'.repeat(64), nextModel = 'b'.repeat(64), graphHash = 'c'.repeat(64), nextGraph = 'd'.repeat(64);
const question = { question: 'Which account best describes the event?', answers: [{ key: 'activity', meaning: 'Protocol activity.' }] };
const cutRequest = { ...question, modelHash, events: [{ eventId: 'world' }] };
const ingestRequest = { requestId: 'ingest', modelHash, events: [{ eventId: 'new', parentEventId: 'world', boundary: 'Protocol release observation.' }], questions: [{ id: 'theme', ...question }] };
function fixture() {
  const calls = { estimates: 0, revisions: 0, rebinds: 0, notes: 0 };
  const definition = { id: 'test', revision: { number: 0 }, meaning_model: { events: [{ id: 'world', boundary: 'Protocol activity.' }], event_relations: [], normalized_cuts: [], referents: [] } };
  const view = { graph_hash: graphHash, content_included: true, graph: { id: 'graph', node_count: 1, edge_count: 0, root_count: 1, revision: { number: 0 }, source: { kind: 'model', model_hash: modelHash } }, roots: ['report'], nodes: [{ id: 'report', role: 'document_root', text: '# Report' }], edges: [] };
  const service = {
    async inspectModel({ modelHash: requested }) { return { model: structuredClone(definition), summary: { revision: { previous_model_hash: requested === nextModel ? modelHash : null } } }; },
    async reviseModel(input) { calls.revisions += 1; calls.revised = input; return { modelHash: nextModel, stored: true }; },
    async queryNarrativeGraph({ graphHash: requested }) { const result = structuredClone(view); result.graph_hash = requested; if (requested === nextGraph) { result.graph.source.model_hash = nextModel; result.graph.revision.number = 1; } return result; },
    async reviseNarrativeGraph() { calls.rebinds += 1; return { graphHash: nextGraph, stored: true }; },
    async applyNarrativeBatch(input) { calls.notes += 1; calls.batch = input; return { graphHash: 'e'.repeat(64), stored: true }; },
  };
  const estimator = { backend: 'typesafe', model: 'jev-test', async estimate() {
    calls.estimates += 1;
    const activity = calls.estimates * 0.2;
    return { answers: { shares: { type: 'choice', probabilities: { activity, remainder: 1 - activity }, confidence: 0.8 } }, usage: { input_tokens: 5, output_tokens: 1 } };
  } };
  return { calls, definition, view, service, estimator };
}

test('Cut proposal adoption and identical concurrent retries never re-estimate accepted values', async () => {
  const f = fixture();
  const proposed = await proposeCutShares(cutRequest, f.estimator, f.service);
  assert.equal(f.calls.revisions, 0);
  const apply = { ...cutRequest, apply: true, requestId: 'apply', proposalId: proposed.proposalId };
  const [first, concurrent] = await Promise.all([proposeCutShares(apply, f.estimator, f.service), proposeCutShares(apply, f.estimator, f.service)]);
  const repeated = await proposeCutShares(apply, f.estimator, f.service);
  assert.deepEqual(first.proposals, proposed.proposals);
  assert.deepEqual(first, concurrent);
  assert.deepEqual(first, repeated);
  assert.equal(f.calls.estimates, 1);
  assert.equal(f.calls.revisions, 1);
  await assert.rejects(proposeCutShares({ ...apply, question: 'Changed meaning.' }, f.estimator, f.service), /different cut-shares payload/);
  await assert.rejects(proposeCutShares({ ...apply, requestId: 'changed', question: 'Changed meaning.' }, f.estimator, f.service), /different modeling inputs/);
});

test('ingest proposals use their exact reviewed values even with the provider subsequently disabled', async () => {
  const f = fixture();
  const preview = await ingestSituation(ingestRequest, f.estimator, f.service);
  const input = { ...ingestRequest, apply: true, proposalId: preview.proposalId };
  const applied = await ingestSituation(input, null, f.service);
  assert.deepEqual(applied.proposals, preview.proposals);
  assert.deepEqual(await ingestSituation(input, null, f.service), applied);
  assert.equal(f.calls.estimates, 1);
  assert.equal(f.calls.revisions, 1);
});

test('direct ingest apply freezes estimates for retries and reports partial graph failures honestly', async () => {
  const f = fixture();
  const ordinaryRebind = f.service.reviseNarrativeGraph;
  let fail = true;
  f.service.reviseNarrativeGraph = async (input) => { if (fail) { fail = false; throw new Error('Temporary storage outage.'); } return ordinaryRebind(input); };
  const input = { ...ingestRequest, apply: true, graph: { graphHash, accessScopes: ['modeler'] } };
  const partial = await ingestSituation(input, f.estimator, f.service);
  assert.equal(partial.partial, true);
  assert.equal(partial.applied.modelHash, nextModel);
  assert.equal(partial.failure.stage, 'rebind');
  const resumed = await ingestSituation(input, f.estimator, f.service);
  assert.equal(resumed.partial, undefined);
  assert.equal(resumed.rebound.graphHash, nextGraph);
  assert.equal(f.calls.estimates, 1);
  assert.equal(f.calls.revisions, 1);
});

test('ingest checks note targets and complete scopes before spending provider calls or revising a model', async () => {
  const f = fixture();
  await assert.rejects(ingestSituation({ ...ingestRequest, apply: true, graph: { graphHash, accessScopes: ['modeler'], notes: [{ nodeId: 'note', text: 'Review.', holder: 'modeler', links: [{ relation: 'about', targetNodeId: 'missing' }] }] } }, f.estimator, f.service), /unknown node/);
  f.view.graph.node_count = 2;
  await assert.rejects(ingestSituation({ ...ingestRequest, apply: true, graph: { graphHash, accessScopes: ['modeler'] } }, f.estimator, f.service), /complete graph/);
  assert.equal(f.calls.revisions, 0);
  assert.equal(f.calls.estimates, 0);
});

test('notes cannot anchor a newly created event to a predecessor graph when rebind is disabled', async () => {
  const f = fixture();
  await assert.rejects(ingestSituation({ ...ingestRequest, apply: true, graph: { graphHash, rebind: false, accessScopes: ['modeler'], notes: [{ nodeId: 'note', text: 'Review.', holder: 'modeler', aboutEventIds: ['new'] }] } }, f.estimator, f.service), /unknown event new/);
  assert.equal(f.calls.revisions, 0);
});

test('malformed distributions fail closed and duplicates cannot silently overwrite one another', async () => {
  for (const probabilities of [{ activity: -0.1, remainder: 1.1 }, { activity: 0.2 }, { activity: 0.2, remainder: 0.8, invented: 0 }, { activity: '0.2', remainder: 0.8 }, { activity: 0.2, remainder: 0.2 }]) {
    const f = fixture();
    f.estimator.estimate = async () => ({ answers: { shares: { type: 'choice', probabilities } } });
    await assert.rejects(proposeCutShares({ ...cutRequest, apply: true, requestId: 'invalid' }, f.estimator, f.service), /Probability|probability/);
    assert.equal(f.calls.revisions, 0);
  }
  const distribution = { questionId: 'theme', eventId: 'new', probabilities: { activity: 0.2, remainder: 0.8 } };
  assert.throws(() => ingestSchema.parse({ ...ingestRequest, distributions: [distribution, distribution] }), /unique/);
  assert.throws(() => ingestSchema.parse({ ...ingestRequest, distributions: [{ ...distribution, probabilities: { made_up: 1 } }] }), /Unknown answer key/);
  assert.throws(() => ingestSchema.parse({ ...ingestRequest, questions: [{ id: 'theme', ...question, eventIds: ['new', 'new'] }] }), /unique/);
});

async function engineFixture(t) {
  const blocks = [...(await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8')).matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel(blocks[1]);
  const graphInput = JSON.parse(JSON.stringify(blocks[2]).replaceAll('MODEL_HASH', registered.modelHash));
  const graph = graphInput.narrativeGraph;
  graph.roots.push('private.root');
  graph.nodes.push({ id: 'private.root', node_type: 'understanding_process_root', role: 'metadata', text: 'Private model review process.', authority: { source: 'reviewer', weight: 1 }, epistemic_status: 'authored_proposal', evidence_type: 'creative_hypothesis', access_scopes: ['secret'], render: 'exclude', training: 'exclude', provenance: ['regression'] },
    { id: 'private.note', node_type: 'note', role: 'externalized_reflection', holder: 'reviewer', text: 'Keep this assessment.', authority: { source: 'reviewer', weight: 1 }, epistemic_status: 'authored_proposal', evidence_type: 'creative_hypothesis', access_scopes: ['secret'], render: 'exclude', training: 'exclude', provenance: ['regression'] });
  graph.edges.push({ id: 'private.placement', source: { kind: 'node', node_id: 'private.root' }, target: { kind: 'node', node_id: 'private.note' }, family: 'structural', relation: 'contains', order: 0, access_scopes: ['secret'], provenance: ['regression'] });
  const stored = await service.registerNarrativeGraph(graphInput);
  return { service, registered, stored, definition: blocks[1].model };
}

test('real Rust rebind refuses a filtered projection and preserves all private nodes, edges, roots and old history', async (t) => {
  const f = await engineFixture(t);
  const successor = structuredClone(f.definition);
  successor.revision = { number: 1, previous_model_hash: f.registered.modelHash, reason: 'Rebind preservation test.', provenance: ['regression'] };
  const model = await f.service.reviseModel({ requestId: 'next-model', previousModelHash: f.registered.modelHash, model: successor });
  const input = { requestId: 'rebind', graphHash: f.stored.graphHash, modelHash: model.modelHash };
  const publicView = await f.service.queryNarrativeGraph({ graphHash: f.stored.graphHash, mode: 'full', includeContent: true });
  assert.equal(publicView.returned_node_count, publicView.total_node_count, 'visible counts misleadingly agree');
  assert.ok(publicView.returned_node_count < publicView.graph.node_count);
  await assert.rejects(rebindNarrativeGraph(f.service, input), /complete graph/);
  const rebound = await rebindNarrativeGraph(f.service, { ...input, accessScopes: ['secret'] });
  const read = (hash) => f.service.queryNarrativeGraph({ graphHash: hash, mode: 'full', includeContent: true, accessScopes: ['secret'] });
  const old = await read(f.stored.graphHash), current = await read(rebound.graphHash);
  assert.deepEqual(current.roots, old.roots);
  assert.deepEqual(current.nodes.map((node) => [node.id, node.text]), old.nodes.map((node) => [node.id, node.text]));
  assert.deepEqual(current.edges.map((edge) => edge.id), old.edges.map((edge) => edge.id));
});

test('real Rust ingest registers a new event, exact supplied Cut and actual Understanding Node in the rebound graph', async (t) => {
  const f = await engineFixture(t);
  const input = { requestId: 'real-ingest', modelHash: f.registered.modelHash, apply: true,
    events: [{ eventId: 'event.followup', parentEventId: 'event.world', boundary: 'Follow-up observation.', interval: { start: 7, end: 8 } }],
    questions: [{ id: 'theme', ...question }], distributions: [{ questionId: 'theme', eventId: 'event.followup', probabilities: { activity: 0.7, remainder: 0.3 } }],
    graph: { graphHash: f.stored.graphHash, accessScopes: ['secret'], notes: [{ nodeId: 'followup.note', text: 'The category remains uncertain; compare the next observation before adopting a causal explanation.', holder: 'modeler', aboutEventIds: ['event.followup'] }] } };
  const result = await ingestSituation(input, null, f.service);
  assert.equal(result.partial, undefined, JSON.stringify(result.failure));
  const view = await f.service.queryNarrativeGraph({ graphHash: result.notes.graphHash, mode: 'full', includeContent: true, accessScopes: ['secret'] });
  assert.equal(view.nodes.find((node) => node.id === 'followup.note').role, 'externalized_reflection');
  assert.equal(view.graph.source.model_hash, result.applied.modelHash);
  assert.ok(view.nodes.some((node) => node.id === 'private.note'));
  assert.deepEqual(await ingestSituation(input, null, f.service), result);
});
