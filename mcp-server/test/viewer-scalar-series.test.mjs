import assert from 'node:assert/strict';
import test from 'node:test';
import { projectScalarSeries } from '../src/viewer-scalar-series.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { temporalWindow } from '../viewer/public/temporal-layout.js';
import { LifeSimulationService } from '../src/service.mjs';
import { recordJevProcessEstimation } from '../src/jev-process-estimation.mjs';

const MODEL = 'a'.repeat(64), NEXT = 'b'.repeat(64), GRAPH = 'c'.repeat(64), NEXT_GRAPH = 'd'.repeat(64);
const process = { id: 'tank.level', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 100 } }, initial_value: { kind: 'scalar', value: 42 },
  unit: 'litre', reference_frame: 'Tank volume', update_mode: 'observed', uncertainty: { kind: 'unknown' },
  support: ['40 in 2000; 42 in 2001'], provenance: ['fixture'], access_scopes: ['research'] };
const claim = (id, time, value, extra = {}) => ({ id, subject: process.id, value: { kind: 'scalar', value },
  value_time: time, evidence_cutoff: 0, mode: 'observed', evidence_type: 'report', holder: 'operator',
  authority: { source: 'operator', weight: 1 }, uncertainty: { kind: 'interval', lower: value - 1, upper: value + 1 },
  provenance: [`source:${id}`], access_scopes: ['research'], ...extra });
const model = (claims = [claim('earlier', -2, 40), claim('later', 0, 42)]) => ({
  schema: 'life-sim-rust-model/v1', id: 'scalar-viewer-fixture', time_unit: 'day', processes: [structuredClone(process)],
  revision: { number: 0, reason: 'Synthetic scalar history.', provenance: ['fixture'] },
  initial_claims: claims, decomposition: [], dependencies: [], laws: [], meaning_model: { schema: 'life-sim-rust-meaning-model/v1', events: [] },
});
function recordedGraph({ id = 'bundle', review = 'approved', modelHash = MODEL } = {}) {
  const samples = [[-2, 40], [0, 42]];
  const bundle = { schema: 'meaning-model-process-estimation/v1', source: 'estimation_exchange_proposal', provider: null,
    request: { modelHash, estimationRequestId: `${id}.request`, acceptedHeadTime: 0, evidenceCutoff: 0,
      coordinates: samples.map(([targetTime], i) => ({ id: `coordinate.${i}`, processId: process.id, targetTime })) },
    mapped: [], reviewedDisposition: review, review: { verdict: review, holder: 'reviewer', rationale: 'Retain attributed values.' }, proposal: { proposalId: `${id}.proposal` } };
  const nodes = [{ id, node_type: 'process_estimation_bundle', text: JSON.stringify(bundle) }];
  const edges = [];
  samples.forEach(([time, value], i) => {
    const nodeId = `${id}.${i}`;
    const output = { coordinateId: `coordinate.${i}`, processId: process.id, status: 'known', value: { kind: 'scalar', value },
      reviewStatus: review, acceptedWorldValue: false, valueTime: time, evidenceCutoff: 0, outputMode: 'estimated',
      evidenceType: 'estimate', claimEvidenceCutoff: 0, holder: 'analyst', uncertainty: { kind: 'interval', lower: value - 2, upper: value + 2 },
      provenance: [`report:${i}`], authority: { source: 'analyst', weight: 0.5 } };
    const { reviewStatus, acceptedWorldValue, valueTime, evidenceCutoff, ...mapped } = output;
    bundle.mapped.push(mapped);
    nodes.push({ id: nodeId, node_type: 'process_estimate', text: JSON.stringify(output), value_time: time, evidence_cutoff: 0,
      evidence_type: 'estimate', holder: 'analyst', authority: output.authority, uncertainty: { kind: 'unknown' },
      provenance: ['process-estimation:proposal'], access_scopes: ['research'] });
    edges.push({ id: `${nodeId}.contains`, source: { kind: 'node', node_id: id }, target: { kind: 'node', node_id: nodeId }, family: 'structural', relation: 'contains' },
      { id: `${nodeId}.about`, source: { kind: 'node', node_id: nodeId }, target: { kind: 'anchor', anchor_kind: 'process', anchor_id: process.id }, family: 'grounding', relation: 'about' });
  });
  nodes[0].text = JSON.stringify(bundle);
  return { nodes, edges };
}
const project = (definition, graph = null, extra = {}) => projectScalarSeries(definition, { modelHash: MODEL, graph, ...extra });
const mutateOutput = (node, changes) => { node.text = JSON.stringify({ ...JSON.parse(node.text), ...changes }); };

test('native dated scalar claims retain exact times, units, evidence and sources without using initial values or support prose', () => {
  const definition = model(); const before = structuredClone(definition);
  const [series] = project(definition);
  assert.equal(series.kind, 'typed-scalar'); assert.equal(series.unit, 'litre'); assert.equal(series.timeUnit, 'day');
  assert.deepEqual(series.points.map(({ t, v, valueTime }) => [t, v, valueTime]), [[-2, 40, -2], [0, 42, 0]]);
  assert.deepEqual(series.domain, [-2, 0]); assert.deepEqual(series.interpolation, { kind: 'linear-visual-guide', extrapolate: false });
  assert.equal(series.points[0].holder, 'operator'); assert.equal(series.points[0].evidenceCutoff, 0);
  assert.deepEqual(series.points[0].record, definition.initial_claims[0]);
  assert.deepEqual(series.points[0].provenance, ['source:earlier']);
  assert.deepEqual(series.points[0].accessScopes, ['research']);
  assert.equal(series.points[0].acceptedWorldValue, false); assert.equal(series.points[0].reviewStatus, null);
  assert.deepEqual(project(model([])), [], 'untimed initial values and date-like support never create typed samples');
  series.points[0].record.provenance.push('local mutation');
  assert.deepEqual(definition, before);
});

test('conflicting samples remain distinct and disable interpolation; different holders and kinds never collapse', () => {
  const definition = model([claim('a', -2, 0), claim('b', -2, 80), claim('c', 0, 42),
    claim('other-holder', 0, 60, { holder: 'another operator' }),
    claim('estimate', 0, 70, { mode: 'estimated', evidence_type: 'estimate' })]);
  const series = project(definition);
  assert.equal(series.length, 3);
  const conflict = series.find((item) => item.points.length === 3);
  assert.deepEqual(conflict.points.map(({ id, v }) => [id, v]), [['a', 0], ['b', 80], ['c', 42]]);
  assert.deepEqual(conflict.conflicts, [{ t: -2, recordIds: ['a', 'b'] }]);
  assert.equal(conflict.interpolation.kind, 'none');
  assert.ok(series.every((item) => item.interpolation.extrapolate === false));
});

test('undated, nonfinite, non-scalar, future-initial and unknown-process records produce no typed samples', () => {
  const definition = model([claim('undated', undefined, 1), claim('nan', NaN, 1), claim('infinite', 0, Infinity),
    claim('category', 0, 1, { value: { kind: 'category', value: 'full' } }), claim('missing', 0, 1, { subject: 'missing' }),
    claim('future', 1, 1), claim('cutoff', 0, 1, { evidence_cutoff: NaN })]);
  assert.deepEqual(project(definition), []);
  assert.deepEqual(project({ ...model(), time_unit: '' }), []);
});

test('graph estimates require an approved exact-model bundle, typed coordinate and unambiguous process anchor', () => {
  const graph = recordedGraph(); const before = structuredClone(graph);
  const [series] = project(model([]), graph);
  assert.equal(series.source.kind, 'process-estimation'); assert.equal(series.source.estimationRequestId, 'bundle.request');
  assert.deepEqual(series.points.map(({ t, v }) => [t, v]), [[-2, 40], [0, 42]]);
  assert.deepEqual(series.points[0].uncertainty, { kind: 'interval', lower: 38, upper: 42 });
  assert.deepEqual(series.points[0].provenance, ['report:0']);
  assert.equal(series.points[0].acceptedWorldValue, false); assert.equal(series.points[0].reviewStatus, 'approved');
  assert.equal(series.points[0].record.text, graph.nodes[1].text);
  assert.deepEqual(graph, before);
  for (const review of ['rejected', 'changes_requested']) assert.deepEqual(project(model([]), recordedGraph({ review })), []);
  assert.deepEqual(project(model([]), recordedGraph({ modelHash: NEXT })), []);
  for (const change of [{ status: 'unknown' }, { status: 'unmodeled' }, { reviewStatus: 'rejected' }, { acceptedWorldValue: true },
    { valueTime: 900 }, { processId: 'other' }, { coordinateId: 'absent' }, { unit: 'gallon' }, { value: { kind: 'scalar', value: null } }]) {
    const invalid = structuredClone(graph); invalid.nodes.slice(1).forEach((node) => mutateOutput(node, change));
    assert.deepEqual(project(model([]), invalid), [], JSON.stringify(change));
  }
  assert.deepEqual(project(model([]), { nodes: graph.nodes.slice(1), edges: graph.edges }), [], 'inaccessible or missing bundle is not recovered elsewhere');
  const ambiguous = structuredClone(graph);
  ambiguous.edges.push(...graph.edges.filter((edge) => edge.family === 'grounding').map((edge) => ({ ...edge, id: `${edge.id}.duplicate` })));
  assert.deepEqual(project(model([]), ambiguous), []);
  const malformed = structuredClone(graph); malformed.nodes[0].text = '{broken';
  assert.deepEqual(project(model([]), malformed), []);
  for (const change of [{ value: { kind: 'scalar', value: 99 } }, { uncertainty: { kind: 'exact' } }, { holder: 'other' }, { provenance: ['unreviewed'] }]) {
    const stale = structuredClone(graph); stale.nodes.slice(1).forEach((node) => mutateOutput(node, change));
    assert.deepEqual(project(model([]), stale), [], 'a child-only edit cannot inherit a different output\'s approval');
  }
});

test('separate estimation requests and recording bundles cannot become one trajectory or merge with model claims', () => {
  const a = recordedGraph({ id: 'a' }), b = recordedGraph({ id: 'b' });
  const series = project(model(), { nodes: [...a.nodes, ...b.nodes], edges: [...a.edges, ...b.edges] });
  assert.equal(series.length, 3); assert.ok(series.every((item) => item.points.length === 2));
  assert.deepEqual(series.filter((item) => item.source.kind === 'process-estimation').map((item) => item.source.bundleNodeId).sort(), ['a', 'b']);
});

test('provider records preserve their mapped uncertainty and declared provider attribution', () => {
  const graph = recordedGraph();
  const bundle = JSON.parse(graph.nodes[0].text); bundle.provider = 'typesafe:fixture';
  delete bundle.source; graph.nodes[0].text = JSON.stringify(bundle);
  for (const node of graph.nodes.slice(1)) {
    const output = JSON.parse(node.text);
    for (const key of ['holder', 'outputMode', 'evidenceType', 'authority', 'provenance']) delete output[key];
    node.text = JSON.stringify(output); delete node.holder; node.authority = { source: bundle.provider, weight: 0.5 };
    const { reviewStatus, acceptedWorldValue, valueTime, evidenceCutoff, ...mapped } = output;
    bundle.mapped[Number(output.coordinateId.split('.').at(-1))] = mapped;
  }
  graph.nodes[0].text = JSON.stringify(bundle);
  const [series] = project(model([]), graph);
  assert.equal(series.holder, 'typesafe:fixture'); assert.equal(series.mode, 'estimated');
  assert.deepEqual(series.points[0].uncertainty, { kind: 'interval', lower: 38, upper: 42 });
  assert.equal(series.points[0].record.uncertainty.kind, 'unknown', 'the original graph metadata remains inspectable');
  assert.equal(series.points[0].acceptedWorldValue, false);
});

test('only explicit native process attachments supply Event placement, and ambiguous ownership stays unassigned', () => {
  const definition = model();
  definition.meaning_model.events = [{ id: 'tank', process_ids: [process.id] }];
  assert.equal(project(definition)[0].home, 'tank');
  definition.meaning_model.events.push({ id: 'shipment', process_ids: [process.id] });
  assert.equal(project(definition)[0].home, null);
  assert.deepEqual(project(definition)[0].sourceEventIds, ['tank', 'shipment']);
});

test('native-clock samples without dated Events activate the viewer and retain construction birth of revised contents', async () => {
  const original = model([claim('a', -2, 0)]);
  const revised = model([claim('a', -2, 10), claim('b', 0, 42)]);
  revised.revision = { number: 1, previous_model_hash: MODEL };
  const history = { models: [{ modelHash: MODEL, definition: original }, { modelHash: NEXT, definition: revised }], revisions: [] };
  const before = structuredClone(history);
  const data = await buildViewerData({ history });
  assert.equal(data.capabilities.temporal, true); assert.equal(data.capabilities.trajectories, true);
  assert.deepEqual(data.measures[0].points, []);
  assert.deepEqual(data.typedScalarSeries[0].points.map(({ born }) => born), [{ rev: 1, at: null, order: 1 }, { rev: 1, at: null, order: 1 }]);
  const range = temporalWindow(data); assert.equal(range.source, 'typed-samples'); assert.ok(range.start < -2 && range.end > 0);
  assert.deepEqual(history, before);
  const semanticRevision = structuredClone(revised); semanticRevision.processes[0].unit = 'gallon';
  semanticRevision.revision = { number: 2, previous_model_hash: NEXT };
  history.models.push({ modelHash: 'e'.repeat(64), definition: semanticRevision });
  const semanticData = await buildViewerData({ history });
  assert.ok(semanticData.typedScalarSeries[0].points.every((point) => point.born.rev === 2), 'a changed process meaning is not displayed at its predecessor construction step');
});

test('graph sample birth follows changed contents or grounding; model rebinding does not reinterpret old estimates', async () => {
  const graph = recordedGraph();
  const changed = structuredClone(graph.nodes[1]); mutateOutput(changed, { value: { kind: 'scalar', value: 50 } });
  const changedBundle = structuredClone(graph.nodes[0]);
  const reviewed = JSON.parse(changedBundle.text); reviewed.mapped[0].value.value = 50;
  reviewed.review.rationale = 'Review the revised fixture estimate.'; changedBundle.text = JSON.stringify(reviewed);
  const history = { models: [{ modelHash: MODEL, definition: model([]) }, { modelHash: NEXT, definition: model([]) }], headGraphHash: NEXT_GRAPH,
    revisions: [{ graphHash: GRAPH, definition: { source: { kind: 'model', model_hash: MODEL }, ...graph } },
      { graphHash: NEXT_GRAPH, delta: { upsertNodes: [changed, changedBundle], upsertEdges: [] } }] };
  const data = await buildViewerData({ history });
  const series = data.typedScalarSeries[0];
  assert.equal(series.points[0].v, 50); assert.equal(series.points[0].born.rev, 1); assert.equal(series.points[0].born.order, 2);
  assert.equal(series.points[1].born.rev, 1); assert.equal(series.points[1].born.order, 2, 'the replacement bundle review also has a new construction birth');
  history.revisions[1].delta.source = { kind: 'model', model_hash: NEXT };
  assert.deepEqual((await buildViewerData({ history })).typedScalarSeries, []);
});

test('civil-day conversion keeps exact native coordinates and single/conflicting samples still provide a time window', async () => {
  const definition = model([claim('a', -365.2425, 0)]); definition.time_unit = 'civil_day_since_1970';
  definition.processes[0].support = ['fixture'];
  const data = await buildViewerData({ history: { models: [{ modelHash: MODEL, definition }], revisions: [] } });
  assert.equal(data.typedScalarSeries[0].points[0].t, 1969);
  assert.equal(data.typedScalarSeries[0].points[0].valueTime, -365.2425);
  assert.equal(data.capabilities.temporal, true); assert.equal(data.capabilities.trajectories, false);
  assert.ok(temporalWindow(data).start < 1969 && temporalWindow(data).end > 1969);
  const conflict = { timeUnit: 'hour', typedScalarSeries: [{ points: [{ t: 0, v: 0 }, { t: 0, v: 2 }] }] };
  assert.deepEqual(temporalWindow(conflict), { start: -0.5, end: 0.5, source: 'typed-samples' });
});

test('complete graph revisions replace prior records; removed samples do not survive as current curves', async () => {
  const graph = recordedGraph();
  const history = { models: [{ modelHash: MODEL, definition: model([]) }], revisions: [
    { graphHash: GRAPH, definition: { source: { kind: 'model', model_hash: MODEL }, ...graph } },
    { graphHash: NEXT_GRAPH, definition: { source: { kind: 'model', model_hash: MODEL }, nodes: [graph.nodes[0]], edges: [] } },
  ] };
  const data = await buildViewerData({ history });
  assert.deepEqual(data.typedScalarSeries, []);
  assert.deepEqual(data.inspection.graph.nodes.map(({ id }) => id), ['bundle']);
  assert.deepEqual(data.inspection.graph.edges, []);
});

test('the actual caller-supplied estimation recording workflow produces projectable scalar history without a provider', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const definition = model([]);
  delete definition.meaning_model;
  const registered = await service.registerModel({ requestId: 'scalar-viewer-model', model: definition });
  const world = await service.createWorld({ requestId: 'scalar-viewer-world', modelHash: registered.modelHash });
  const before = await service.inspectWorld({ worldId: world.worldId });
  const graph = await service.registerNarrativeGraph({ requestId: 'scalar-viewer-graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'scalar-viewer', revision: { number: 0, reason: 'Typed history fixture.', provenance: ['test'] },
    source: { kind: 'model', model_hash: registered.modelHash }, roots: ['root'], edges: [],
    nodes: [{ id: 'root', node_type: 'world_scope', role: 'document_root', text: 'Synthetic tank history.', epistemic_status: 'authored_boundary',
      evidence_type: 'report', render: 'exclude', training: 'exclude', authority: { source: 'test', weight: 1 }, provenance: ['test'], access_scopes: ['research'] }],
  } });
  const coordinates = [-2, 0].map((targetTime, i) => ({ id: `c${i}`, processId: process.id, targetTime }));
  const request = await service.createEstimationRequest({ requestId: 'scalar-viewer-request', worldId: world.worldId,
    operation: 'infer', intent: 'reality', evidenceCutoff: 0, accessScopes: ['research'], context: 'Synthetic attributed tank reports.', coordinates });
  const proposal = await service.submitEstimationResponse({ requestId: 'scalar-viewer-response', estimationRequestId: request.estimationRequestId,
    dispositions: coordinates.map(({ id }) => ({ coordinateId: id, status: 'known', reason: 'Supplied fixture report.' })),
    provisionalClaims: coordinates.map(({ id, targetTime }, i) => ({ coordinateId: id, outputMode: 'observed', valueTime: targetTime,
      claim: { id: `report.${id}`, subject: process.id, value: { kind: 'scalar', value: 40 + i * 2 }, evidence_type: 'report',
        evidence_cutoff: targetTime, holder: 'operator', authority: { source: 'operator', weight: 1 }, uncertainty: { kind: 'exact' },
        provenance: [`fixture:${id}`], access_scopes: ['research'] } })) });
  const stored = await recordJevProcessEstimation(service, { requestId: 'scalar-viewer-record', proposalId: proposal.proposalId,
    graphHash: graph.graphHash, parentId: 'root', accessScopes: ['research'], review: { verdict: 'approved', holder: 'reviewer', rationale: 'Retain the supplied dated fixture reports.' } });
  const visible = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: ['research'] });
  const series = projectScalarSeries(definition, { modelHash: registered.modelHash, graph: visible });
  assert.equal(series.length, 1); assert.deepEqual(series[0].points.map(({ t, v }) => [t, v]), [[-2, 40], [0, 42]]);
  assert.equal(series[0].mode, 'observed'); assert.equal(series[0].holder, 'operator');
  assert.deepEqual(series[0].points.map(({ evidenceCutoff }) => evidenceCutoff), [-2, 0]);
  assert.ok(series[0].points.every((point) => point.reviewStatus === 'approved' && point.acceptedWorldValue === false));
  const publicView = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: [] });
  assert.deepEqual(projectScalarSeries(definition, { modelHash: registered.modelHash, graph: publicView }), []);
  assert.equal((await service.inspectWorld({ worldId: world.worldId })).headHash, before.headHash);
});
