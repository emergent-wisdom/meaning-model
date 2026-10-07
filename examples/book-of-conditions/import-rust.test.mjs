import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultEngine, directory, readEdition, runImport } from './import-rust.mjs';
import { encodeHistoryModels, HISTORY_FILE_SCHEMA_V2, HISTORY_SCHEMA, historyDigest } from '../../mcp-server/src/construction-files.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('the edition reader checks model ancestry in both v1 and v2 bundles', async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'book-edition-reader-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const hash = n => n.toString(16).padStart(64, '0');
  const prose = 'A small edition.\n';
  const first = { id: 'book', revision: { number: 0 }, payload: 'x'.repeat(2000) };
  const second = { ...first, revision: { number: 1, previous_model_hash: hash(1) } };
  const models = [{ modelHash: hash(1), definition: first }, { modelHash: hash(2), definition: second }];
  const history = { schema: HISTORY_SCHEMA, headGraphHash: hash(3), revisionCount: 1, models,
    revisions: [{ graphHash: hash(3), definition: { revision: { number: 0 }, source: { model_hash: hash(2) } } }] };
  const manifest = { graphHash: hash(3), modelHash: hash(2), modelRevision: 1, graphRevision: 0, rootId: 'root', accessScopes: [],
    proseSha256: createHash('sha256').update(prose).digest('hex'), constructionHistory: { graphRevisions: 1, storedModelDefinitions: 2 } };
  fs.writeFileSync(path.join(scratch, 'BOOK-DRAFT.md'), prose);
  const writeEdition = bundle => {
    const bytes = JSON.stringify(bundle), fileSha256 = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(scratch, 'the-book-of-conditions.meaning-model.json'), bytes);
    fs.writeFileSync(path.join(scratch, 'PUBLICATION-MANIFEST.json'), JSON.stringify({ ...manifest, fileSha256 }));
    return fileSha256;
  };
  const bundleSha256 = historyDigest(history).sha256;
  for (const schema of [HISTORY_SCHEMA, HISTORY_FILE_SCHEMA_V2]) {
    const bundle = { ...history, schema, models: schema === HISTORY_SCHEMA ? models : encodeHistoryModels(models), bundleSha256 };
    if (schema === HISTORY_FILE_SCHEMA_V2) assert(bundle.models[1].delta);
    const fileSha256 = writeEdition(bundle);
    const read = await readEdition(scratch);
    assert.equal(read.bundle.schema, schema);
    assert.equal(read.prose, prose);
    assert.equal(read.sourceHashes['the-book-of-conditions.meaning-model.json'], fileSha256);
  }
  const missingBase = { ...history, schema: HISTORY_FILE_SCHEMA_V2, models: encodeHistoryModels(models), bundleSha256 };
  missingBase.models[1].baseModelHash = hash(99);
  writeEdition(missingBase);
  await assert.rejects(readEdition(scratch), /does not hold before it/);
  writeEdition({ ...history, models: [models[0], { ...models[1], definition: { ...second, revision: { number: 1, previous_model_hash: hash(99) } } }] });
  await assert.rejects(readEdition(scratch), /Every native model predecessor must be included/);
});

test('a fresh public MCP import preserves the complete Book history and Nora', { timeout: 600_000 }, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'book-public-import-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const out = path.join(scratch, 'edition');
  const receipt = await runImport(out, defaultEngine);
  const manifest = readJson(path.join(directory, 'PUBLICATION-MANIFEST.json'));
  assert.equal(receipt.verified, true);
  assert.equal(receipt.graphHash, manifest.graphHash);
  assert.equal(receipt.modelHash, manifest.modelHash);
  assert.equal(receipt.graphRevisionCount, manifest.constructionHistory.graphRevisions);
  assert.equal(receipt.storedModelCount, manifest.constructionHistory.storedModelDefinitions);
  assert.equal(receipt.currentModelCount, manifest.constructionHistory.currentModels);
  assert.equal(receipt.tellingProcessCount, manifest.inventory.tellingProcesses);
  assert.equal(receipt.tellingPhaseCount, manifest.inventory.tellingPhases);
  assert.equal(fs.readFileSync(path.join(out, 'rendered.md'), 'utf8'), fs.readFileSync(path.join(directory, 'BOOK-DRAFT.md'), 'utf8'));
  assert(fs.statSync(path.join(out, 'construction.sqlite')).size > 0);

  const model = readJson(path.join(out, 'model.json'));
  assert.equal(model.revision.number, manifest.modelRevision);
  assert.match(model.revision.previous_model_hash, /^[a-f0-9]{64}$/);
  assert.equal(model.meaning_model.events.length, manifest.inventory.events);
  assert.equal(model.processes.length, manifest.inventory.processes);
  assert.equal(model.meaning_model.normalized_cuts.length, manifest.inventory.normalizedCuts, 'Published numbers must survive import');
  const graph = readJson(path.join(out, 'graph.json'));
  assert.equal(graph.graph.revision.number, manifest.graphRevision);
  assert.match(graph.graph.revision.previous_graph_hash, /^[a-f0-9]{64}$/);
  const projection = readJson(path.join(out, 'document-projection.json'));
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const eventIds = new Set(model.meaning_model.events.map(event => event.id));
  const passages = projection.units.map(unit => byId.get(unit.nodeId)).filter(node => node?.role === 'story_passage');
  assert.equal(passages.length, manifest.inventory.renderedLeaves);
  for (const passage of passages) {
    const renders = graph.edges.filter(edge => edge.family === 'grounding' && edge.relation === 'renders'
      && edge.source.kind === 'node' && edge.source.node_id === passage.id && edge.target.kind === 'anchor' && edge.target.anchor_kind === 'event');
    assert(renders.length > 0, `Rendered passage is ungrounded: ${passage.id}`);
    assert(renders.every(edge => eventIds.has(edge.target.anchor_id)), `Passage points to an absent Event: ${passage.id}`);
  }
  const phases = projection.processes.flatMap(process => process.states);
  assert(phases.every(state => state.status === 'current'));
  for (const state of phases) for (const evidence of state.evidence) assert(byId.get(evidence.nodeId)?.text.includes(evidence.excerpt), `Telling evidence must remain in the manuscript: ${state.label}`);
  const nora = receipt.authors.find(author => author.name === 'Nora Vale');
  assert(nora);
  const life = readJson(path.join(out, `author-${nora.modelHash}.json`));
  const dependency = manifest.authorDependencies.find(author => author.name === 'Nora Vale');
  assert.equal(nora.modelHash, dependency.modelHash);
  assert.equal(life.revision.number, dependency.modelRevision);
  if (dependency.modelRevision > 0) assert.match(life.revision.previous_model_hash, /^[a-f0-9]{64}$/, "Nora's earlier revisions belong to the history");
  else assert(!life.revision.previous_model_hash);
  assert(life.meaning_model.referents.some(person => person.id === nora.personId));
  assert.notEqual(nora.modelHash, receipt.modelHash, 'Nora belongs to her own declared world');
  const saved = readJson(path.join(out, 'saved-work.json'));
  assert.deepEqual(saved.heads.map(head => head.graphHash), [manifest.graphHash]);
  assert.equal(saved.heads[0].revision, manifest.graphRevision);
  const priorReceipt = fs.readFileSync(path.join(out, 'receipt.json'));
  await assert.rejects(runImport(out, defaultEngine), /never overwritten/);
  assert.deepEqual(fs.readFileSync(path.join(out, 'receipt.json')), priorReceipt);
});
