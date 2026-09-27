import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createModelViewer, modelViewerSchema } from '../src/viewer-server.mjs';
import { followedGraphHead } from '../src/viewer-live.mjs';

const hash = (n) => n.toString(16).padStart(64, '0');
const modelHash = hash(1), rootHash = hash(101);
function fixture(t) {
  let now = 10_000; t.mock.method(Date, 'now', () => now);
  const models = new Map([[modelHash, { schema: 'life-sim-rust-model/v1', id: 'story-world',
    revision: { number: 0, reason: 'Start', provenance: [] }, time_unit: 'hour', processes: [],
    meaning_model: { events: [], referents: [], normalized_cuts: [] } }]]);
  const graphs = new Map(); const calls = [];
  function add(id, previous = null, { model = modelHash, scope = [], text = `Saved text ${id}` } = {}) {
    const graph = { schema: 'life-sim-rust-narrative-graph/v1', id: 'growing-story', source: { kind: 'model', model_hash: model },
      revision: { number: previous ? graphs.get(previous).revision.number + 1 : 0, ...(previous ? { previous_graph_hash: previous } : {}), reason: 'Saved', provenance: [] },
      roots: ['story'], nodes: [{ id: 'story', node_type: 'story', role: 'document_root', text, render: 'include', training: 'exclude', access_scopes: scope }], edges: [] };
    graphs.set(id, graph); now += 2_000; return graph;
  }
  add(rootHash);
  const service = {
    async inspectModel({ modelHash }) { return { modelHash, model: models.get(modelHash) }; },
    async listNarrativeRevisions({ graphId }) {
      assert.equal(graphId, 'growing-story');
      const revisions = [...graphs].map(([graph_hash, graph]) => ({ graph_hash, previous_graph_hash: graph.revision.previous_graph_hash ?? null }));
      return { revisions, heads: revisions.filter((item) => !revisions.some((other) => other.previous_graph_hash === item.graph_hash)).map((item) => item.graph_hash) };
    },
    async queryNarrativeGraph(input) {
      calls.push(structuredClone(input)); const graph = graphs.get(input.graphHash);
      const visible = (node) => !node.access_scopes.length || node.access_scopes.some((scope) => input.accessScopes.includes(scope));
      return { graph_hash: input.graphHash, content_included: true,
        graph: { ...graph, node_count: graph.nodes.length, edge_count: 0, root_count: 1 },
        roots: graph.roots, nodes: graph.nodes.filter(visible), edges: [] };
    },
    async renderNarrativeGraph(input) {
      const graph = graphs.get(input.graphHash);
      return { roots: graph.roots, units: graph.nodes.map((node) => ({ node_id: node.id, node_type: node.node_type, role: node.role, text: node.text })) };
    },
  };
  const viewer = createModelViewer(service); t.after(() => viewer.close());
  const json = async (opened, path) => { const response = await fetch(new URL(`data/${path}.json`, opened.url)); assert.equal(response.status, 200); return response.json(); };
  return { viewer, add, models, calls, json };
}

test('live mode requires an explicit graph; default and model-only views remain exact snapshots', () => {
  assert.equal(modelViewerSchema.parse({ modelHash }).mode, 'snapshot');
  assert.equal(modelViewerSchema.parse({ graphHash: rootHash, mode: 'live' }).mode, 'live');
  assert.equal(modelViewerSchema.safeParse({ modelHash, mode: 'live' }).success, false);
  assert.equal(modelViewerSchema.safeParse({ graphHash: rootHash, additionalModels: [{ modelHash, mode: 'live' }] }).success, false);
});

test('one live URL advances saved prose and graph-bound model changes while an exact URL stays unchanged', async (t) => {
  const f = fixture(t), exact = await f.viewer.open({ graphHash: rootHash }), live = await f.viewer.open({ graphHash: rootHash, mode: 'live' });
  assert.equal(live.mode, 'live');
  const before = await f.json(exact, 'model');
  assert.equal((await f.json(live, 'model')).viewerLive.graphHash, rootHash);
  const nextModel = hash(2), next = hash(102);
  f.models.set(nextModel, { ...structuredClone(f.models.get(modelHash)), revision: { number: 1, previous_model_hash: modelHash, reason: 'New Event', provenance: [] },
    meaning_model: { events: [{ id: 'new', boundary: 'Newly saved event', interval: { start: 0, end: 1 } }], referents: [], normalized_cuts: [] } });
  assert.equal((await f.json(live, 'live')).graphHash, rootHash, 'an unbound model change is not silently adopted');
  f.add(next, rootHash, { model: nextModel, text: '# The story has grown' });
  assert.deepEqual(await f.json(live, 'live'), { mode: 'live', status: 'following', graphHash: next, modelHash: nextModel, pollIntervalMs: 2000, message: 'Live · saved revisions' });
  const after = await f.json(live, 'model');
  assert.equal(after.modelHash, nextModel); assert.equal(after.headGraphHash, next);
  assert.equal(after.story.units[0].text, '# The story has grown');
  assert.equal(after.inspection.model.meaning_model.events[0].id, 'new');
  assert.deepEqual(await f.json(exact, 'model'), before);
  assert.equal((await f.json(exact, 'live')).mode, 'snapshot');
});

test('a later fork from an already passed ancestor pauses without choosing either branch', async (t) => {
  const f = fixture(t), live = await f.viewer.open({ graphHash: rootHash, mode: 'live' });
  f.add(hash(102), rootHash); assert.equal((await f.json(live, 'live')).graphHash, hash(102));
  const before = await f.json(live, 'model');
  f.add(hash(103), rootHash, { text: 'Other branch' }); f.add(hash(104), hash(102));
  const status = await f.json(live, 'live');
  assert.equal(status.status, 'branched'); assert.equal(status.graphHash, hash(102));
  assert.deepEqual(await f.json(live, 'model'), before);
  const chosen = await f.viewer.open({ graphHash: hash(102), mode: 'live' });
  assert.equal((await f.json(chosen, 'live')).graphHash, hash(104), 'opening an explicit branch defines a new unambiguous lineage');
});

for (const hidden of ['graph', 'model']) test(`new private ${hidden} records retain the last authorized revision and never widen scopes`, async (t) => {
  const f = fixture(t), live = await f.viewer.open({ graphHash: rootHash, mode: 'live', accessScopes: ['author'] });
  const before = await f.json(live, 'model');
  const privateModel = hash(3);
  f.models.set(privateModel, { ...structuredClone(f.models.get(modelHash)), processes: [{ id: 'SECRET_PROCESS', access_scopes: ['new-private'] }] });
  f.add(hash(102), rootHash, hidden === 'graph' ? { scope: ['new-private'], text: 'SECRET_PROSE' } : { model: privateModel });
  const status = await f.json(live, 'live');
  assert.equal(status.status, 'unavailable'); assert.equal(status.graphHash, rootHash);
  assert.doesNotMatch(JSON.stringify(status), /SECRET/);
  assert.deepEqual(await f.json(live, 'model'), before);
  assert.ok(f.calls.every((input) => input.accessScopes.join() === 'author'));
});

test('live endpoint preserves token, method, Host and Origin guards', async (t) => {
  const f = fixture(t), live = await f.viewer.open({ graphHash: rootHash, mode: 'live' }), url = new URL('data/live.json', live.url);
  for (const options of [{ method: 'POST' }, { headers: { Origin: 'https://outside.example' } }, { headers: { Host: 'outside.example' } }]) {
    const response = await new Promise((resolve, reject) => {
      const req = request(url, options, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body })); });
      req.on('error', reject); req.end();
    });
    assert.ok(response.status >= 400); assert.doesNotMatch(response.body, /graphHash/);
  }
  assert.equal((await fetch(new URL('/unissued/data/live.json', url))).status, 404);
});

test('lineage resolver ignores unrelated branches and refuses missing or cyclic ancestry', () => {
  const rows = (pairs) => ({ revisions: pairs.map(([graph_hash, previous_graph_hash]) => ({ graph_hash, previous_graph_hash })) });
  assert.deepEqual(followedGraphHead(rows([['a', null], ['b', 'a'], ['x', null], ['y', 'x'], ['z', 'x']]), 'a'), { status: 'following', graphHash: 'b' });
  assert.deepEqual(followedGraphHead(rows([['a', 'b'], ['b', 'a']]), 'a'), { status: 'unavailable' });
  assert.deepEqual(followedGraphHead(rows([['a', null]]), 'missing'), { status: 'unavailable' });
});
