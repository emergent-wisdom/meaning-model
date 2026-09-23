import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSimulationService } from '../../mcp-server/src/service.mjs';
import { importConstructionHistory, outlineModel, replayConstruction } from '../../mcp-server/src/construction-record.mjs';

const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here));
const json = (name) => JSON.parse(read(name).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scopes = ['market-model'];

test('the example files match their manifest', () => {
  const manifest = json('MANIFEST.json');
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(sha256(read(file)), digest, file);
});

test('a fresh engine rebuilds the whole construction from history.json, and every packaged file follows from it', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const manifest = json('MANIFEST.json').source;
  const history = json('history.json');
  assert.equal(history.bundleSha256, manifest.historyBundleSha256);
  const imported = await importConstructionHistory(service, { requestId: 'example.history', history });
  assert.equal(imported.verified, true);
  assert.equal(imported.headGraphHash, manifest.graphHash);
  assert.deepEqual([imported.revisions, imported.models], [manifest.historyRevisions, manifest.historyModels]);
  const head = imported.headGraphHash;
  const view = await service.queryNarrativeGraph({ graphHash: head, mode: 'full', includeContent: true, accessScopes: scopes, forRevision: true });
  const graph = json('graph.json');
  assert.deepEqual([view.nodes, view.edges, view.roots], [graph.nodes, graph.edges, graph.roots], 'graph.json is the head revision');
  const { model } = await service.inspectModel({ modelHash: view.graph.source.model_hash, includeDefinition: true });
  assert.deepEqual(model, json('model.json'), 'model.json is the model the head is bound to');

  let offset = 0; const parts = [];
  while (offset !== null) {
    const page = await replayConstruction(service, { graphHash: head, accessScopes: scopes, level: 'outline', offset, limit: 80, maxChars: 400_000 });
    let text = page.text.replace(/\n… continue with offset \d+$/u, '');
    if (offset > 0) text = text.replace(/^# Construction of .*\n/u, '');
    parts.push(text.trim()); offset = page.window.nextOffset;
  }
  assert.equal(`${parts.join('\n\n')}\n`, read('REPLAY.md').toString('utf8'));
  const outline = await outlineModel(service, { graphHash: head, accessScopes: scopes, understanding: 'first_line', maxChars: 400_000 });
  assert.equal(`${outline.text}\n`, read('OUTLINE.md').toString('utf8'));
  assert.deepEqual([outline.coverage.described, outline.coverage.events], [50, 50], 'every Event is described');

  // The retrieval check is a review held by its checker, and the maintainer's answer links to it.
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const review = byId.get('review.factcheck.1');
  assert.equal(review.holder, 'fact-check:retrieval-2026-09-23');
  const { data } = JSON.parse(review.text);
  assert.deepEqual([data.independence, data.reviewed.materials, data.reviewed.revision], ['informed', 'records', 9]);
  assert.equal(data.findings.filter((finding) => finding.severity === 'minor').length, 1, 'one finding is a recorded value outside its interval');
  assert.equal(data.prompt.text.includes('/Users/'), false, 'the prompt carries no local paths');
  const linked = (from, relation, to) => view.edges.some((edge) => edge.source.node_id === from && edge.relation === relation && edge.target.node_id === to);
  assert.ok(linked('maintainer.factcheck-answer', 'answers', 'review.factcheck.1'));
  assert.ok(linked('maintainer.factcheck-input', 'refines', 'review.factcheck.1'), 'the correction to the review record is linked to it');
  assert.ok(linked('review.factcheck.1', 'about', 'hist.sample.h.btc.m49_7'), 'the review is linked to each sample it was given');
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
