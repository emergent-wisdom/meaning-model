import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultEngine, directory, runImport } from './import-rust.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a fresh public MCP import preserves the complete reviewed Book history and Nora', { timeout: 300_000 }, async t => {
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
  assert.equal(life.revision.number, 0);
  assert(!life.revision.previous_model_hash);
  assert(life.meaning_model.referents.some(person => person.id === nora.personId));
  assert.notEqual(nora.modelHash, receipt.modelHash, 'Nora belongs to her own declared world');
  const saved = readJson(path.join(out, 'saved-work.json'));
  assert.deepEqual(saved.heads.map(head => head.graphHash), [manifest.graphHash]);
  assert.equal(saved.heads[0].revision, manifest.graphRevision);
  const priorReceipt = fs.readFileSync(path.join(out, 'receipt.json'));
  await assert.rejects(runImport(out, defaultEngine), /never overwritten/);
  assert.deepEqual(fs.readFileSync(path.join(out, 'receipt.json')), priorReceipt);
});
