import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSimulationService } from '../../mcp-server/src/service.mjs';

const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here));
const json = (name) => JSON.parse(read(name).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scopes = ['market-model'];

test('the example files match their manifest', () => {
  const manifest = json('MANIFEST.json');
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(sha256(read(file)), digest, file);
});

test('a fresh engine re-registers the model and graph, runs a world, and keeps every dated value with its evidence', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const provenance = ['examples/crypto-market'];
  // The model is the final revision of a longer history; a fresh engine registers it as revision 0.
  const model = { ...json('model.json'), revision: { number: 0, reason: 'Registered from examples/crypto-market.', provenance } };
  const { modelHash } = await service.registerModel({ requestId: 'example.model', model });
  const { model: stored } = await service.inspectModel({ modelHash, includeDefinition: true });
  const manifest = json('MANIFEST.json').source;
  assert.equal(stored.processes.length, manifest.processes);
  assert.equal(stored.meaning_model.events.length, manifest.events);
  const cuts = stored.meaning_model.normalized_cuts;
  assert.equal(cuts.length, manifest.normalizedCuts);
  for (const cut of cuts) {
    assert.ok(Math.abs(cut.answers.reduce((sum, answer) => sum + answer.weight, 0) - 1) < 1e-9, `${cut.id} shares and remainder sum to one`);
    assert.ok(cut.answers.some((answer) => answer.key === 'remainder'), `${cut.id} keeps an explicit remainder`);
  }
  // Revision 4: each conduit Cut divides only the monetary share of its episode's driver Cut.
  const conduits = cuts.filter((cut) => cut.id.endsWith('.q.conduit'));
  assert.equal(conduits.length, 5);
  for (const cut of conduits) assert.deepEqual(cut.conditioning, { cut_id: cut.id.replace(/\.q\.conduit$/, '.q.driver'), answer_key: 'us_monetary' });
  // Revision 5: the measured series are observed processes; the authored judgments stay static.
  const modes = Object.fromEntries(stored.processes.map((process) => [process.id, process.update_mode]));
  assert.equal(modes['btc.price_usd'], 'observed');
  assert.equal(modes['judgment.monetary_accommodation_for_crypto'], 'static');
  // The model is executable: a world starts from its cutoff values.
  const world = await service.createWorld({ requestId: 'example.world', modelHash });
  const { projection } = await service.queryView({ worldId: world.worldId, requestedObservables: ['btc.price_usd', 'us.fed_funds_upper_pct'], accessScopes: scopes });
  assert.equal(projection.time, 0);
  assert.equal(projection.state['us.fed_funds_upper_pct'].value, 3.75);
  assert.equal(typeof projection.state['btc.price_usd'].value, 'number');

  const graph = json('graph.json');
  const registered = await service.registerNarrativeGraph({ requestId: 'example.graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: graph.id, revision: { number: 0, reason: 'Registered from examples/crypto-market.', provenance },
    source: { kind: 'model', model_hash: modelHash }, roots: graph.roots, nodes: graph.nodes, edges: graph.edges } });
  const full = await service.queryNarrativeGraph({ graphHash: registered.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  assert.equal(full.nodes.length, graph.nodes.length);
  const processes = new Set(stored.processes.map((process) => process.id));
  const anchored = (nodeId) => full.edges.filter((edge) => edge.source.node_id === nodeId && edge.target.kind === 'anchor' && edge.target.anchor_kind === 'process').map((edge) => edge.target.anchor_id);
  const samples = full.nodes.filter((node) => node.node_type === 'process_sampled_value');
  assert.ok(samples.length >= 50, 'dated history is kept as graph records');
  assert.ok(samples.filter((sample) => sample.value_time < 0).length >= 50, 'most of it before the cutoff');
  for (const sample of samples) {
    assert.ok(sample.value_time <= 0, `${sample.id} is dated at or before the cutoff`);
    assert.equal(typeof sample.evidence_cutoff, 'number', `${sample.id} keeps its evidence cutoff`);
    assert.ok(['report', 'estimate', 'observation'].includes(sample.evidence_type), `${sample.id} keeps its evidence type`);
    assert.ok(anchored(sample.id).some((processId) => processes.has(processId)), `${sample.id} is anchored to a model process`);
  }
  assert.ok(full.nodes.some((node) => node.id === 'general.evidence.general.estimator.initial'), 'Jev\'s raw initial answers are kept');
  // The retrieval check: a retrieved report corrects the one recalled value outside its interval.
  assert.ok(full.nodes.some((node) => node.id === 'factcheck.report' && node.evidence_type === 'report'));
  const correction = full.edges.find((edge) => edge.relation === 'corrects' && edge.target.node_id === 'hist.sample.h.btc.m49_7');
  assert.ok(correction, 'the out-of-interval sample is linked to its correction');
  const retrieved = full.nodes.find((node) => node.id === correction.source.node_id);
  assert.deepEqual([retrieved.evidence_type, retrieved.value_time, retrieved.evidence_cutoff, JSON.parse(retrieved.text).value.value], ['report', -49.7, -49.7, 64756]);
  assert.equal(full.edges.filter((edge) => edge.relation === 'checks').length, 5);
  assert.ok(full.nodes.filter((node) => node.role === 'externalized_reflection').length >= 20, 'the modeling reviews are Understanding Nodes');
});
