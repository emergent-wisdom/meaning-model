import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { packRows, unpackRows, packSnapshot, openSnapshot, partPending, whenPart, whenAllParts, COMPACT_SCHEMA } from '../viewer/public/snapshot-format.js';
import { buildViewerData } from '../src/viewer-data.mjs';
import { typedScalarTrajectories } from '../viewer/public/scalar-trajectories.js';
import { buildSearchIndex } from '../viewer/public/search.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const MODEL = 'a'.repeat(64), GRAPH = 'c'.repeat(64);

// A model with two holders' dated values of one process, some with notes, and a graph with notes of its own.
async function snapshot() {
  const process = { id: 'tank.level', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 100 } }, initial_value: { kind: 'scalar', value: 42 },
    unit: 'litre', reference_frame: 'Tank volume', update_mode: 'observed', uncertainty: { kind: 'unknown' }, support: [], provenance: ['fixture'], access_scopes: [] };
  const claims = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, subject: process.id, value: { kind: 'scalar', value: (i * 7.31) % 100 },
    value_time: i - 30, evidence_cutoff: 0, mode: i % 3 ? 'observed' : 'estimated', evidence_type: 'report', holder: i % 2 ? 'operator' : 'inspector',
    authority: { source: i % 2 ? 'operator' : 'inspector', weight: 1 }, uncertainty: i % 4 ? { kind: 'interval', lower: -1, upper: 101 } : { kind: 'unknown' },
    provenance: i % 5 ? [`source:${i}`] : [`source:${i}`, `A note on reading ${i}.`], access_scopes: [] }));
  const definition = { schema: 'life-sim-rust-model/v1', id: 'compact-fixture', time_unit: 'day', processes: [process],
    revision: { number: 0, reason: 'Synthetic.', provenance: ['fixture'] }, initial_claims: claims, decomposition: [], dependencies: [], laws: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', events: [] } };
  const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `note.${i}`, node_type: 'note', text: `The level was checked on day ${i}, and ${'it held. '.repeat(i)}`,
    holder: 'operator', provenance: ['fixture'], access_scopes: [] }));
  return buildViewerData({ history: { models: [{ modelHash: MODEL, definition }], headGraphHash: GRAPH,
    revisions: [{ graphHash: GRAPH, definition: { source: { kind: 'model', model_hash: MODEL }, nodes, edges: [] } }] } });
}

// The files a compact snapshot was written as, served as a host would.
const serve = (files, log = []) => async (address) => {
  const file = new URL(address).pathname.split('/').pop(); log.push(file);
  return files.has(file) ? { ok: true, json: async () => JSON.parse(files.get(file)) } : { ok: false, status: 404 };
};
const compactFiles = (data, name = 'model') => {
  const { snapshot: compact, parts } = packSnapshot(data, { name, sha256 });
  return { compact, files: new Map([[`${name}.json`, JSON.stringify(compact)], ...parts.map((part) => [part.file, part.text])]) };
};

test('rows read back exactly from their columns, whatever keys, orders, nesting and values they hold', () => {
  const rows = [
    { id: 'series~1@-3', t: -3, v: 0, born: { rev: 1, at: null }, tags: ['a'], scope: [], note: null },
    { id: 'series~1@-2', t: -2, v: -0, born: { rev: 1, at: null }, tags: ['a', 'b'], scope: [] },
    { t: -1, id: 'series~1@-1', v: 1e-300, born: { rev: 2, at: '2026-10-30' }, scope: [], extra: { deep: { deeper: [1, { x: 2 }] } } },
    { id: 'series~1@0', t: 0, v: 12345678.901234567, born: { rev: 2 }, tags: [], scope: [], note: 'Ä note with "quotes" and   a separator.' },
    {},
  ];
  // Written as JSON text, as a snapshot is, the rows read back as the rows' own JSON text does.
  const back = unpackRows(JSON.parse(JSON.stringify(packRows(rows))));
  assert.deepStrictEqual(back, JSON.parse(JSON.stringify(rows)));
  assert.deepEqual(back.map((row) => Object.keys(row)), rows.map((row) => Object.keys(row)), 'each row keeps its own key order');
  assert.ok(Object.is(unpackRows(packRows(rows))[1].v, -0), 'in memory, a negative zero stays one');
  assert.deepStrictEqual(unpackRows(packRows(rows)), rows);
  back[0].scope.push('changed'); assert.deepEqual(back[1].scope, [], 'rows never share a value written once');
  assert.deepStrictEqual(unpackRows(packRows([])), []);
});

test('random rows survive the round trip (a stated relation, not an expected answer)', () => {
  let seed = 7; const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  const value = (depth = 0) => {
    const r = random();
    if (r < 0.2) return Math.round(random() * 1e6) / 1e3 - 500;
    if (r < 0.4) return ['holder.alpha', 'holder.beta', 'holder.alpha.x', ''][Math.floor(random() * 4)];
    if (r < 0.5) return null; if (r < 0.6) return random() < 0.5;
    if (r < 0.75 && depth < 3) return Object.fromEntries(['a', 'b', 'c'].filter(() => random() < 0.6).map((key) => [key, value(depth + 1)]));
    if (depth < 3) return Array.from({ length: Math.floor(random() * 3) }, () => value(depth + 1));
    return 'leaf';
  };
  for (let trial = 0; trial < 50; trial += 1) {
    const rows = Array.from({ length: Math.floor(random() * 40) }, () => Object.fromEntries(['id', 't', 'v', 'meta', 'note'].filter(() => random() < 0.8).map((key) => [key, value()])));
    assert.deepStrictEqual(unpackRows(JSON.parse(JSON.stringify(packRows(rows)))), rows, `trial ${trial}`);
  }
});

test('a compact snapshot opens as the snapshot it was made from, and its views derive the same rows and index', async () => {
  const data = await snapshot();
  assert.equal(data.schema, 'meaning-model-viewer/2');
  assert.ok(data.typedScalarSeries.length >= 2 && data.inspection.graph.nodes.length === 5);
  const { compact, files } = compactFiles(data);
  assert.equal(compact.schema, COMPACT_SCHEMA); assert.equal(compact.inspection.graph, undefined);
  assert.ok(files.get('model.json').length < JSON.stringify(data).length);
  const log = [];
  const opened = await openSnapshot(JSON.parse(files.get('model.json')), { url: 'https://host.test/m/data/model.json?ts=1', fetch: serve(files, log) });
  assert.deepEqual(log, [], 'the graph\'s records are not fetched until a view needs them');
  assert.deepStrictEqual(typedScalarTrajectories(opened), typedScalarTrajectories(data), 'the curves are drawn from the same values');
  assert.equal(partPending(opened, 'inspection/graph'), true);
  await whenPart(opened, 'inspection/graph');
  assert.deepEqual(log, ['model.inspection-graph.json']);
  assert.deepStrictEqual(opened, data);
  assert.deepStrictEqual(buildSearchIndex(opened), buildSearchIndex(data));
  await whenPart(opened, 'inspection/graph'); assert.equal(log.length, 1, 'a part is fetched once');
});

test('a whole snapshot is used as it is, and a part from another snapshot or a failed fetch is never shown', async () => {
  const data = await snapshot();
  assert.equal(await openSnapshot(data), data);
  assert.equal(partPending(data, 'inspection/graph'), false); await whenAllParts(data);
  const { files } = compactFiles(data);
  const other = structuredClone(data); other.inspection.graph.nodes[0].text = 'Another snapshot.';
  const { files: otherFiles } = compactFiles(other);
  const mixed = new Map(files); mixed.set('model.inspection-graph.json', otherFiles.get('model.inspection-graph.json'));
  const opened = await openSnapshot(JSON.parse(files.get('model.json')), { url: 'https://host.test/data/model.json', fetch: serve(mixed) });
  await assert.rejects(whenPart(opened, 'inspection/graph'), /belongs to another snapshot/);
  assert.equal(opened.inspection.graph, undefined);
  let fail = true;
  const flaky = async (address) => (fail ? { ok: false, status: 503 } : serve(files)(address));
  const retried = await openSnapshot(JSON.parse(files.get('model.json')), { url: 'https://host.test/data/model.json', fetch: flaky });
  await assert.rejects(whenPart(retried, 'inspection/graph'), /unavailable \(503\)/);
  fail = false; await whenPart(retried, 'inspection/graph');
  assert.deepStrictEqual(retried, data, 'a part that failed to arrive can be fetched again');
  assert.throws(() => packSnapshot({ schema: 'meaning-model-viewer/1' }, { name: 'x', sha256 }), /meaning-model-viewer\/2/);
});
