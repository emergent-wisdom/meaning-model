import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSimulationService } from '../../mcp-server/src/service.mjs';

const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here));
const json = (name) => JSON.parse(read(name).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('the example files match their manifest', () => {
  const manifest = json('MANIFEST.json');
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(sha256(read(file)), digest, file);
  assert.equal(sha256(read('story.md')), manifest.source.storyTextSha256);
});

test('a fresh engine re-registers the story model and graph and renders the story byte for byte', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const provenance = ['examples/integration-time'];
  // The model and graph are the final revisions of a long history; a fresh engine registers them as revision 0.
  const model = { ...json('model.json'), revision: { number: 0, reason: 'Registered from examples/integration-time.', provenance } };
  const { modelHash } = await service.registerModel({ requestId: 'example.model', model });
  const graph = json('graph.json');
  // Review nodes anchor to the model by hash; point them at the re-registered copy.
  const edges = graph.edges.map((edge) => (edge.target?.kind === 'anchor' && edge.target.anchor_kind === 'model' && edge.target.anchor_id === graph.modelHash
    ? { ...edge, target: { ...edge.target, anchor_id: modelHash } } : edge));
  const stored = await service.registerNarrativeGraph({ requestId: 'example.graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: graph.id, revision: { number: 0, reason: 'Registered from examples/integration-time.', provenance },
    source: { kind: 'model', model_hash: modelHash }, roots: graph.roots, nodes: graph.nodes, edges } });
  const rendered = await service.renderNarrativeGraph({ graphHash: stored.graphHash, expectedGraphHash: stored.graphHash, rootIds: ['story'], accessScopes: ['story-author'] });
  assert.equal(rendered.text, read('story.md').toString('utf8'));
  const reviews = graph.nodes.filter((node) => node.id.startsWith('independent-reader-'));
  assert.ok(reviews.length >= 4, 'the blind readers\' reports are recorded in the graph');
});
