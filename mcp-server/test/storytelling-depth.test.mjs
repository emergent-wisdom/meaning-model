import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { modelDepthBasis, prepareModelDepthReview, recordModelDepthReview, readModelDepthReview }
  from '../src/storytelling-depth.mjs';
import { lifeTrendsDossier, lifeTrendsEdges, lifeTrendsNode } from './storytelling-life-fixture.mjs';
import { conceptualReview } from '../src/modeling-guidance.mjs';

const graphHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const modelHash = 'c'.repeat(64);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });

function fixture() {
  const dossier = lifeTrendsDossier();
  const view = {
    graph_hash: graphHash, source_snapshot_hash: snapshotHash, content_included: true,
    graph: { revision: { number: 3 }, source_snapshot: {
      source_kind: 'world', model_hash: modelHash, source_hash: 'd'.repeat(64), time: 4,
    } },
    roots: ['book'],
    nodes: [
      { id: 'book', role: 'document_root', access_scopes: [] },
      lifeTrendsNode(dossier),
      { id: 'outline', role: 'metadata', text: 'Leo closes the inlet instead of waiting for a vote because the pump cannot keep up.', access_scopes: ['author'] },
      { id: 'capacity', role: 'metadata', text: 'The pump removes two units per minute while the inlet admits three.', access_scopes: ['author', 'editor'] },
    ],
    edges: [...lifeTrendsEdges(), { id: 'outline.capacity', source: endpoint('outline'), target: endpoint('capacity'),
      family: 'semantic', relation: 'depends_on', access_scopes: ['author'] }],
  };
  const model = { processes: [{ id: 'pump', unit: 'volume_per_minute', initial_value: 2 }],
    meaning_model: { referents: [{ id: 'Leo' }], events: [{ id: 'inlet.closed', process_ids: ['pump'] }] },
    labels: { 'a/b': { '~c': 'An escaped pointer resolves this exact model field.' } } };
  const versions = new Map([[graphHash, view]]);
  const reads = [];
  const inspections = [];
  const writes = [];
  const service = {
    async queryNarrativeGraph(input) {
      reads.push(structuredClone(input));
      assert.equal(input.expectedGraphHash, input.graphHash);
      const result = structuredClone(versions.get(input.graphHash));
      assert.ok(result);
      const allowed = (item) => !item.access_scopes?.length || item.access_scopes.some((scope) => input.accessScopes.includes(scope));
      result.nodes = result.nodes.filter(allowed);
      const visible = new Set(result.nodes.map((node) => node.id));
      result.edges = result.edges.filter((edge) => allowed(edge) && visible.has(edge.source.node_id)
        && (edge.target.kind === 'anchor' || visible.has(edge.target.node_id)));
      return result;
    },
    async inspectModel(input) {
      inspections.push(structuredClone(input));
      return { modelHash, model: structuredClone(model), summary: { process_count: 1 } };
    },
    async applyNarrativeBatch(input) {
      writes.push(structuredClone(input));
      assert.equal(input.previousGraphHash, input.narrativeBatch.previous_graph_hash);
      const next = structuredClone(versions.get(input.previousGraphHash));
      next.nodes.push(...input.narrativeBatch.add_nodes);
      next.edges.push(...input.narrativeBatch.add_edges);
      next.roots.push(...input.narrativeBatch.add_roots);
      next.graph.revision.number += 1;
      next.graph_hash = digest(input);
      versions.set(next.graph_hash, next);
      return { graphHash: next.graph_hash, snapshotHash, immutableRevision: true };
    },
  };
  const preparation = { graphHash, storyRootId: 'book', lifeTrendsNodeId: 'life.trends',
    focusNodeId: 'outline', contextNodeIds: ['capacity'], accessScopes: ['author'] };
  const scene = { modelDepthReviewNodeId: 'depth.review', lifeTrendsNodeId: 'life.trends',
    scene: { context: [{ nodeId: 'capacity' }] } };
  return { view, dossier, model, versions, reads, inspections, writes, service, preparation, scene };
}

function assessment(preparation, task, overrides = {}) {
  return { preparation, expectedTaskHash: task.taskHash, requestId: 'depth.request', nodeId: 'depth.review',
    reviewer: 'author', coverage: 'The life dossier explains acting under uncertainty; the pump and inlet capacities explain why delaying matters.',
    findings: [{ subject: 'The physical constraint behind closing the inlet', status: 'sufficient',
      explanation: 'The stated inflow exceeds the modeled pumping capacity, so waiting prolongs accumulation.',
      evidence: [{ kind: 'node', nodeId: 'capacity' }, { kind: 'model', path: '/processes/0/initial_value' }],
      smallestRepair: null }], ...overrides };
}

async function save(f, overrides) {
  const task = await prepareModelDepthReview(f.service, f.preparation);
  const result = await recordModelDepthReview(f.service, assessment(f.preparation, task, overrides));
  return { task, result, view: f.versions.get(result.graphHash) };
}

test('depth preparation reads the frozen source model and binds the exact task', async () => {
  const f = fixture();
  const task = await prepareModelDepthReview(f.service, f.preparation);
  assert.deepEqual(await prepareModelDepthReview(f.service, f.preparation), task);
  assert.deepEqual(f.inspections[0], { modelHash, includeDefinition: true });
  assert.equal(task.sourceSnapshotHash, snapshotHash);
  assert.equal(task.modelHash, modelHash);
  assert.deepEqual(task.model.definition, f.model);
  assert.equal(task.model.administrativeRead, true);
  assert.equal(task.model.frozenRuntimeValuesIncluded, false);
  assert.ok(task.reviewerInstructions.includes(conceptualReview));
  assert.equal(task.semanticVerification, false);
  assert.equal(task.graphMutation, false);
  await assert.rejects(recordModelDepthReview(f.service,
    assessment(f.preparation, task, { expectedTaskHash: 'e'.repeat(64) })), /task changed/);
  assert.equal(f.writes.length, 0);
  const outside = assessment(f.preparation, task);
  outside.findings[0].evidence = [{ kind: 'node', nodeId: 'not-reviewed' }, { kind: 'model', path: '/processes/0/initial_value' }];
  await assert.rejects(recordModelDepthReview(f.service, outside), (error) => {
    assert.match(error.message, /finding 0/);
    assert.match(error.message, /cites node not-reviewed, which is outside the reviewed evidence/);
    return true;
  });
  assert.equal(f.writes.length, 0);
  f.service.inspectModel = async () => ({ modelHash: 'f'.repeat(64), model: f.model });
  await assert.rejects(prepareModelDepthReview(f.service, f.preparation), /exact bound model/);
});

test('depth findings persist as scoped Understanding Nodes with graph and exact model anchors', async () => {
  const f = fixture();
  const original = structuredClone(f.view);
  const { result, view } = await save(f);
  assert.equal(result.readyForScene, true);
  assert.equal(result.understandingNode, true);
  const node = view.nodes.find((item) => item.id === result.modelDepthReviewNodeId);
  const root = view.nodes.find((item) => item.id === result.understandingRootId);
  assert.equal(node.role, 'externalized_reflection');
  assert.equal(node.holder, 'author');
  assert.equal(node.render, 'exclude');
  assert.equal(node.training, 'exclude');
  assert.deepEqual(node.access_scopes, ['author']);
  assert.equal(root.node_type, 'understanding_process_root');
  assert.equal(root.subject, 'book');
  assert.ok(view.roots.includes(root.id));
  assert.ok(view.edges.some((edge) => edge.source.node_id === root.id && edge.target.node_id === node.id
    && edge.family === 'structural' && edge.relation === 'contains'));
  assert.ok(view.edges.some((edge) => edge.source.node_id === node.id && edge.target.node_id === 'capacity' && edge.relation === 'about'));
  assert.ok(view.edges.some((edge) => edge.source.node_id === node.id && edge.target.kind === 'anchor'
    && edge.target.anchor_kind === 'model' && edge.target.anchor_id === modelHash
    && edge.target.path === '/processes/0/initial_value' && edge.family === 'grounding'));
  const payload = JSON.parse(node.text);
  assert.equal(payload.data.semanticVerification, false);
  assert.equal(payload.authoringClock.at, 3);
  assert.equal(readModelDepthReview(view, f.scene, { dossier: f.dossier }).readyForScene, true);
  assert.deepEqual(f.view, original, 'recording preserves its immutable predecessor');
});

test('explanatory gaps are saved with repairs and remain unready for scene work', async () => {
  const f = fixture();
  const task = await prepareModelDepthReview(f.service, f.preparation);
  const input = assessment(f.preparation, task);
  input.findings[0].status = 'needs_opening';
  await assert.rejects(recordModelDepthReview(f.service, input), /smallest useful/);
  input.findings[0].smallestRepair = 'Model the inlet capacity and the available decision interval before concluding that closure is necessary.';
  const stored = await recordModelDepthReview(f.service, input);
  assert.equal(stored.readyForScene, false);
  const view = f.versions.get(stored.graphHash);
  const read = readModelDepthReview(view, f.scene, { dossier: f.dossier });
  assert.equal(read.readyForScene, false);
  assert.equal(read.findings[0].smallestRepair, input.findings[0].smallestRepair);
  assert.equal(f.writes.length, 1);
});

test('depth evidence rejects unreviewed nodes, missing or malformed model paths, and narrative-only claims', async () => {
  for (const evidence of [
    [{ kind: 'node', nodeId: 'not.selected' }, { kind: 'model', path: '/processes' }],
    [{ kind: 'model', path: '/processes/2' }],
    [{ kind: 'model', path: '/processes/00' }],
    [{ kind: 'model', path: '/processes/__proto__' }],
    [{ kind: 'model', path: '/labels/~2' }],
    [{ kind: 'node', nodeId: 'capacity' }],
  ]) {
    const f = fixture();
    const task = await prepareModelDepthReview(f.service, f.preparation);
    const input = assessment(f.preparation, task);
    input.findings[0].evidence = evidence;
    await assert.rejects(recordModelDepthReview(f.service, input));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  const task = await prepareModelDepthReview(f.service, f.preparation);
  const input = assessment(f.preparation, task);
  input.findings[0].evidence = [{ kind: 'model', path: '/labels/a~1b/~0c' }];
  assert.equal((await recordModelDepthReview(f.service, input)).readyForScene, true);
});

test('depth freshness permits unrelated graph appends and rejects changed selected evidence or source', async () => {
  const f = fixture();
  const { view } = await save(f);
  const extra = structuredClone(view);
  extra.graph_hash = 'f'.repeat(64);
  extra.graph.revision.number += 1;
  extra.nodes.push({ id: 'draft', role: 'metadata', text: 'A new stored draft.' },
    { id: 'note', role: 'externalized_reflection', text: 'An unrelated note.' });
  extra.edges.push({ id: 'book.draft', source: endpoint('book'), target: endpoint('draft'), family: 'structural', relation: 'contains', order: 9 },
    { id: 'note.outline', source: endpoint('note'), target: endpoint('outline'), family: 'semantic', relation: 'about' });
  assert.equal(readModelDepthReview(extra, f.scene, { dossier: f.dossier }).readyForScene, true);
  for (const mutate of [
    (v) => { v.source_snapshot_hash = 'e'.repeat(64); },
    (v) => { v.graph.source_snapshot.model_hash = 'e'.repeat(64); },
    (v) => { v.nodes.find((n) => n.id === 'outline').text = 'The changed ending depends on a vote.'; },
    (v) => { v.nodes.find((n) => n.id === 'capacity').text = 'The inlet now admits one unit per minute.'; },
    (v) => { const n = v.nodes.find((n) => n.id === 'life.trends'); const d = JSON.parse(n.text); d.characters[0].future.outlook = 'A new intended future.'; n.text = JSON.stringify(d); },
    (v) => { v.edges.find((e) => e.id === 'outline.capacity').relation = 'contradicts'; },
  ]) {
    const changed = structuredClone(view);
    mutate(changed);
    assert.throws(() => readModelDepthReview(changed, f.scene, { dossier: f.dossier }), /stale/);
  }
  const missing = structuredClone(view);
  missing.nodes = missing.nodes.filter((node) => node.id !== 'capacity');
  assert.throws(() => readModelDepthReview(missing, f.scene, { dossier: f.dossier }), /unknown or inaccessible/);
});

test('depth checks reject missing or inaccessible focus, pending sources, and expanded scene context', async () => {
  const f = fixture();
  await assert.rejects(prepareModelDepthReview(f.service, { ...f.preparation, focusNodeId: 'missing' }), /unknown or inaccessible/);
  await assert.rejects(prepareModelDepthReview(f.service, { ...f.preparation, accessScopes: ['reader'] }), /unknown or inaccessible/);
  await assert.rejects(prepareModelDepthReview(f.service, { ...f.preparation, focusNodeId: 'book' }), /focus node/);
  const { view } = await save(f);
  assert.throws(() => readModelDepthReview(view, { ...f.scene, modelDepthReviewNodeId: 'missing' }, { dossier: f.dossier }), /Understanding Node/);
  assert.throws(() => readModelDepthReview(view, { ...f.scene, scene: { context: [{ nodeId: 'new.context' }] } }, { dossier: f.dossier }), /extends beyond/);
  const unrooted = structuredClone(view);
  unrooted.edges = unrooted.edges.filter((edge) => !(edge.relation === 'contains' && edge.target.node_id === 'depth.review'));
  assert.throws(() => readModelDepthReview(unrooted, f.scene, { dossier: f.dossier }), /understanding-process root/);
  f.view.graph.source_snapshot.source_kind = 'candidate';
  f.view.graph.source_snapshot.candidate_status = 'pending';
  await assert.rejects(prepareModelDepthReview(f.service, f.preparation), /committed-candidate/);
});

test('large models expose an explicit full-read route and still validate cited model evidence', async () => {
  const f = fixture();
  f.model.notes = 'x'.repeat(140 * 1024);
  const task = await prepareModelDepthReview(f.service, f.preparation);
  assert.equal(task.model.definitionIncluded, false);
  assert.equal(task.model.definition, null);
  assert.deepEqual(task.model.readMore, { tool: 'life_model_inspect', arguments: { modelHash, includeDefinition: true } });
  const stored = await recordModelDepthReview(f.service, assessment(f.preparation, task));
  assert.equal(stored.readyForScene, true);
  assert.ok(f.inspections.length >= 3, 'recording resolves cited paths against the complete actual model');
  assert.equal(modelDepthBasis(f.view, { storyRootId: 'book', lifeTrendsNodeId: 'life.trends', focusNodeId: 'outline', contextNodeIds: ['capacity'] }).basis.modelHash, modelHash);
});

test('depth review preserves the complete 100-context scene limit and every linked scope', async () => {
  const f = fixture();
  f.view.nodes.find((node) => node.id === 'outline').access_scopes = ['author', 'editor'];
  const contextIds = Array.from({ length: 100 }, (_, index) => `context.${index}`);
  for (const [index, nodeId] of contextIds.entries()) f.view.nodes.push({ id: nodeId, role: 'metadata',
    text: `Bounded story fact ${index}.`, access_scopes: index === 99 ? ['editor'] : ['author', 'editor'] });
  f.preparation.contextNodeIds = contextIds;
  f.preparation.accessScopes = ['author', 'editor'];
  const task = await prepareModelDepthReview(f.service, f.preparation);
  const input = assessment(f.preparation, task);
  input.findings[0].evidence = [{ kind: 'node', nodeId: contextIds[0] }, { kind: 'model', path: '/processes/0' }];
  const result = await recordModelDepthReview(f.service, input);
  const view = f.versions.get(result.graphHash);
  const node = view.nodes.find((item) => item.id === result.modelDepthReviewNodeId);
  assert.deepEqual(node.access_scopes, ['editor'], 'the last selected fact also constrains the stored review audience');
  for (const nodeId of contextIds) {
    const link = view.edges.find((edge) => edge.source.node_id === node.id && edge.target.node_id === nodeId && edge.relation === 'about');
    assert.ok(link, `all selected context must have a typed link: ${nodeId}`);
    assert.deepEqual(link.access_scopes, ['editor']);
  }
  const sceneInput = { ...f.scene, scene: { context: contextIds.map((nodeId) => ({ nodeId })) } };
  assert.equal(readModelDepthReview(view, sceneInput, { dossier: f.dossier }).readyForScene, true);
});
