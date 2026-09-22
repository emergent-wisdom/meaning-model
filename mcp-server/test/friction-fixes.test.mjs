import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { viewpointAvailability } from '../src/storytelling-addon.mjs';
import { prepareTrajectoryExplore, reviseTrajectory, trajectoryProposalSchema } from '../src/storytelling-trajectories.mjs';
import { NODE_FIELDS, EDGE_FIELDS } from '../src/narrative-fields.mjs';

test('scene worldTimeEnd makes knowledge acquired during the scene declarable', () => {
  const node = { evidence_cutoff: 13.5 };
  const start = viewpointAvailability({ viewpointKnownAt: 13.5 }, node, { worldTime: 12 });
  assert.equal(start.available, false, 'without an end time the scene start governs');
  const end = viewpointAvailability({ viewpointKnownAt: 13.5 }, node, { worldTime: 12, worldTimeEnd: 14.5 });
  assert.deepEqual(end, { sceneEnd: 14.5, declaredKnown: true, cutoffSafe: true, available: true });
  assert.equal(viewpointAvailability({ viewpointKnownAt: 15 }, node, { worldTime: 12, worldTimeEnd: 14.5 }).available, false);
  assert.equal(viewpointAvailability({ viewpointKnownAt: 13 }, { evidence_cutoff: null }, { worldTime: 12, worldTimeEnd: 14.5 }).cutoffSafe, false, 'undated sources stay unavailable');
  assert.throws(() => viewpointAvailability({ viewpointKnownAt: 12 }, node, { worldTime: 12, worldTimeEnd: 11 }), /must not precede/);
});

function exploration() {
  const share = (id, meaning) => ({ id, meaning, comparisonQuestion: 'How is attention divided?', unit: 'attention share', minimum: 0, maximum: 1 });
  return { definition: { targetKind: 'life', subjectId: 'character.fern', brief: 'A surveyor and home.', timeUnit: 'age in years',
      axes: [{ id: 'trust', meaning: 'Expected support.', comparisonQuestion: 'How much support?', unit: 'authored scale', minimum: -1, maximum: 1 }, share('worry', 'Loss.'), share('curiosity', 'Discovery.'), share('remainder', 'Everything else.')],
      allocations: [{ id: 'attention', question: 'Where is attention directed?', axisIds: ['worry', 'curiosity', 'remainder'], total: 1 }] },
    points: [{ id: 'childhood', at: 8, label: 'Earliest', values: { trust: 0.4, worry: 0.2, curiosity: 0.5, remainder: 0.3 }, fixed: ['worry'] },
      { id: 'departure', at: 24, label: 'Leaving', values: { trust: -0.2, worry: 0.3, curiosity: 0.4, remainder: 0.3 }, fixed: ['trust'] },
      { id: 'return', at: 58, label: 'Return', values: { trust: 0.7, worry: 0.1, curiosity: 0.2, remainder: 0.7 }, fixed: [] }],
    randomness: 0.5, candidateCount: 2, seed: 'fern-friction' };
}

test('a trajectory revision can name a compensating axis so the allocation total is preserved exactly', () => {
  const task = prepareTrajectoryExplore(exploration());
  const proposal = { definition: task.definition, candidate: task.candidates[0] };
  const before = proposal.candidate.points.find((point) => point.id === 'return').values;
  const revised = reviseTrajectory({ proposal, reason: 'Move a tenth of attention from the remainder to curiosity.', changes: [{ pointId: 'return', axisId: 'curiosity', value: before.curiosity + 0.1, reason: 'She looks more.', compensateAxisId: 'remainder' }] });
  const after = revised.candidate.points.find((point) => point.id === 'return').values;
  assert.ok(Math.abs(after.curiosity - (before.curiosity + 0.1)) < 1e-12);
  assert.ok(Math.abs(after.remainder - (before.remainder - 0.1)) < 1e-12);
  assert.ok(Math.abs(after.worry + after.curiosity + after.remainder - 1) < 1e-10);
  assert.equal(trajectoryProposalSchema.safeParse({ definition: revised.definition, candidate: revised.candidate }).success, true);
  const change = revised.candidate.revision.changes[0];
  assert.equal(change.compensateAxisId, 'remainder');
  assert.ok(Math.abs(change.compensatedPreviousValue - before.remainder) < 1e-12);
  assert.throws(() => reviseTrajectory({ proposal, reason: 'r', changes: [{ pointId: 'childhood', axisId: 'curiosity', value: 0.4, reason: 'x', compensateAxisId: 'worry' }] }), /different, unfixed axis/);
  assert.throws(() => reviseTrajectory({ proposal, reason: 'r', changes: [{ pointId: 'return', axisId: 'curiosity', value: 0.3, reason: 'x', compensateAxisId: 'trust' }] }), /share an allocation group/);
});

function jsonBlocks(markdown) {
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
}

test('the minimal example payloads compile, register and round-trip through a revision-safe query', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [compileRequest, registerRequest, graphRequest, batchRequest] = jsonBlocks(markdown);
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const compiled = await service.compileProfiles(compileRequest);
  assert.equal(compiled.valid, true);
  assert.equal(compiled.stored, false);
  const registered = await service.registerModel(registerRequest);
  assert.equal(registered.stored, true);
  const graphText = JSON.stringify(graphRequest).replaceAll('MODEL_HASH', registered.modelHash);
  const graph = await service.registerNarrativeGraph(JSON.parse(graphText));
  assert.equal(graph.stored, true);
  const batched = await service.applyNarrativeBatch(JSON.parse(JSON.stringify(batchRequest).replaceAll('GRAPH_HASH', graph.graphHash)));
  assert.equal(batched.stored, true, 'the documented batch payload applies');
  const withFact = await service.queryNarrativeGraph({ graphHash: batched.graphHash, mode: 'full', includeContent: true });
  assert.equal(withFact.nodes.find(({ id }) => id === 'canon.debt').evidence_cutoff, 0);
  await assert.rejects(service.queryNarrativeGraph({ graphHash: graph.graphHash, mode: 'skeleton', forRevision: true }), /requires mode full/);
  const view = await service.queryNarrativeGraph({ graphHash: graph.graphHash, mode: 'full', includeContent: true, forRevision: true });
  assert.equal(view.for_revision, true);
  for (const node of view.nodes) for (const key of Object.keys(node)) assert.ok(NODE_FIELDS.includes(key), `node field ${key} is not accepted by revise`);
  for (const edge of view.edges) for (const key of Object.keys(edge)) assert.ok(EDGE_FIELDS.includes(key), `edge field ${key} is not accepted by revise`);
  const plain = await service.queryNarrativeGraph({ graphHash: graph.graphHash, mode: 'full', includeContent: true });
  assert.ok(Object.keys(plain.nodes[0]).some((key) => !NODE_FIELDS.includes(key)), 'the ordinary projection still carries derived fields');
  const successor = { schema: 'life-sim-rust-narrative-graph/v1', id: view.graph.id, revision: { number: view.graph.revision.number + 1, previous_graph_hash: graph.graphHash, reason: 'Round trip.', provenance: ['friction-test'] }, source: view.graph.source, roots: view.roots, nodes: view.nodes, edges: view.edges };
  const revised = await service.reviseNarrativeGraph({ requestId: 'friction-roundtrip', previousGraphHash: graph.graphHash, narrativeGraph: successor });
  assert.equal(revised.stored, true);
  const rendered = await service.renderNarrativeGraph({ graphHash: revised.graphHash, rootIds: ['story'], accessScopes: [] });
  assert.equal(rendered.text, '# The Offer');
});
