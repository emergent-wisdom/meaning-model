import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importConstructionHistory } from '../src/construction-record.mjs';
import { HISTORY_SCHEMA, HISTORY_FILE_SCHEMA_V2, historyDigest } from '../src/construction-files.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-history-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const text = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, model, graph] = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const modelHash = 'a'.repeat(64), graphHash = 'b'.repeat(64);
  graph.narrativeGraph.source.model_hash = modelHash;
  const history = { schema: HISTORY_SCHEMA, graphId: graph.narrativeGraph.id, headGraphHash: graphHash,
    revisionCount: 1, models: [{ modelHash, definition: model.model }],
    revisions: [{ graphHash, definition: graph.narrativeGraph }] };
  let writes = 0;
  const service = {
    async registerModel() { writes += 1; return { modelHash }; },
    async registerNarrativeGraph() { writes += 1; return { graphHash }; },
  };
  const write = async (name, body) => {
    const path = join(directory, `${name}.json`);
    await writeFile(path, JSON.stringify({ ...body, bundleSha256: historyDigest({ ...body, schema: HISTORY_SCHEMA }).sha256 }));
    return path;
  };
  return { history, service, write, writes: () => writes };
}

test('a checksummed file cannot report an empty, unidentified construction as verified', async (t) => {
  const f = await setup(t);
  const sourcePath = await f.write('empty-unidentified', { schema: HISTORY_SCHEMA, models: [], headGraphHash: null });
  await assert.rejects(importConstructionHistory(f.service, { requestId: 'empty', sourcePath }), /graphId|headGraphHash/u);
  assert.equal(f.writes(), 0);
});

test('history metadata and revision structure are checked before any import writes', async (t) => {
  const f = await setup(t);
  const cases = [
    ['graph-id', (h) => { delete h.graphId; }, /graphId/u],
    ['head-hash', (h) => { h.headGraphHash = null; }, /headGraphHash/u],
    ['no-revisions', (h) => { delete h.revisions; }, /lists its graph revisions/u],
    ['empty-revisions', (h) => { h.revisions = []; }, /at least one graph revision/u],
    ['wrong-count', (h) => { h.revisionCount = 2; }, /revisionCount/u],
    ['no-definition', (h) => { delete h.revisions[0].definition; }, /complete definition/u],
    ['wrong-graph', (h) => { h.revisions[0].definition.id = 'another-graph'; }, /history graphId/u],
    ['invalid-revision-hash', (h) => { h.revisions[0].graphHash = 'bad'; }, /valid graphHash/u],
    ['wrong-head', (h) => { h.headGraphHash = 'c'.repeat(64); }, /final graph revision/u],
  ];
  for (const [name, change, expected] of cases) {
    const body = structuredClone(f.history); change(body);
    const sourcePath = await f.write(name, body);
    await assert.rejects(importConstructionHistory(f.service, { requestId: name, sourcePath }), expected, name);
    assert.equal(f.writes(), 0, name);
  }
});

test('valid v1 and v2 files, including legacy files without revisionCount, still import', async (t) => {
  const f = await setup(t);
  for (const schema of [HISTORY_SCHEMA, HISTORY_FILE_SCHEMA_V2]) {
    for (const withCount of [true, false]) {
      const body = { ...f.history, schema, optionalMetadata: { retained: true } };
      if (!withCount) delete body.revisionCount;
      const sourcePath = await f.write(`${schema.endsWith('v1') ? 'v1' : 'v2'}-${withCount}`, body);
      const result = await importConstructionHistory(f.service, { requestId: `valid-${withCount}`, sourcePath });
      assert.equal(result.verified, true);
      assert.equal(result.models, 1);
      assert.equal(result.revisions, 1);
      assert.equal(result.graphId, f.history.graphId);
    }
  }
  assert.equal(f.writes(), 8);
});
