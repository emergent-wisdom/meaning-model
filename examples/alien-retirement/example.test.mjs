import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSimulationService } from '../../mcp-server/src/service.mjs';
import { AlienAddon } from '../../mcp-server/src/alien-addon.mjs';
import { importConstructionHistory, outlineModel, replayConstruction } from '../../mcp-server/src/construction-record.mjs';

const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here), 'utf8');
const json = (name) => JSON.parse(read(name));
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const scopes = ['author'];

// The target model is a registered successor (revision 1); a fresh engine registers it as revision 0.
function freshModel(model) {
  return { ...structuredClone(model), revision: { number: 0, reason: 'Registered from examples/alien-retirement.', provenance: ['examples/alien-retirement'] } };
}

async function engine(t) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  return service;
}

test('the example files match their manifest', () => {
  const manifest = json('MANIFEST.json');
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(sha256(read(file)), digest, file);
  assert.equal(json('world-library.json').bundleHash, manifest.source.worldLibraryHash);
});

test('a fresh engine rebuilds the whole search from history.json, and every packaged file follows from it', async (t) => {
  const service = await engine(t);
  const manifest = json('MANIFEST.json').source;
  const history = json('history.json');
  assert.equal(history.bundleSha256, manifest.historyBundleSha256);
  const imported = await importConstructionHistory(service, { requestId: 'example.history', history });
  assert.equal(imported.verified, true);
  assert.equal(imported.headGraphHash, manifest.graphHash);
  assert.deepEqual([imported.revisions, imported.models], [manifest.historyRevisions, manifest.historyModels]);
  const head = imported.headGraphHash;
  assert.notEqual(manifest.searchGraphHash, head);
  assert.ok(history.revisions.some((revision) => revision.graphHash === manifest.searchGraphHash), 'the head at the end of the run is in the history');
  const atRunEnd = await new AlienAddon(service).atlas({ graphHash: manifest.searchGraphHash, searchRootId: manifest.searchRootId, accessScopes: scopes });
  assert.equal(`${atRunEnd.markdown}\n`, read('atlas.md'), 'atlas.md is the atlas of the search as the run left it');
  const view = await service.queryNarrativeGraph({ graphHash: head, mode: 'full', includeContent: true, accessScopes: scopes, forRevision: true });
  const { model } = await service.inspectModel({ modelHash: view.graph.source.model_hash, includeDefinition: true });
  assert.deepEqual(model, json('target-model.json'), 'target-model.json is the model the head is bound to');
  const { markdown } = await new AlienAddon(service).atlas({ graphHash: head, searchRootId: manifest.searchRootId, accessScopes: scopes });
  assert.equal(`${markdown}\n`, read('atlas.md'), 'the atlas at the head is the packaged atlas');
  let offset = 0; const parts = [];
  while (offset !== null) {
    const page = await replayConstruction(service, { graphHash: head, accessScopes: scopes, level: 'outline', offset, limit: 80, maxChars: 400_000 });
    let text = page.text.replace(/\n… continue with offset \d+$/u, '');
    if (offset > 0) text = text.replace(/^# Construction of .*\n/u, '');
    parts.push(text.trim()); offset = page.window.nextOffset;
  }
  assert.equal(`${parts.join('\n\n')}\n`, read('REPLAY.md'));
  const outline = await outlineModel(service, { graphHash: head, accessScopes: scopes, understanding: 'first_line', maxChars: 400_000 });
  assert.equal(`${outline.text}\n`, read('OUTLINE.md'));
  assert.deepEqual([outline.coverage.described, outline.coverage.events], [5, 5], 'every target Event is described');
});

test('the world library imports into a search on another problem, which starts at the solver', async (t) => {
  const service = await engine(t);
  const { modelHash } = await service.registerModel({ requestId: 'example.register', model: freshModel(json('target-model.json')) });
  const addon = new AlienAddon(service);
  const started = await addon.startSearch({ requestId: 'example.start', modelHash, graphId: 'example.reuse', searchId: 'search.reuse', title: 'Reuse',
    problem: { statement: 'How can a fishing cooperative share catch quotas fairly across good and bad seasons?', targetTerms: ['fishing', 'cooperative', 'quota'] },
    authorId: 'example', accessScopes: scopes });
  const imported = await addon.importWorlds({ graphHash: started.graphHash, requestId: 'example.import', searchRootId: 'search.reuse', authorId: 'example',
    accessScopes: scopes, library: json('world-library.json') });
  assert.equal(imported.imported.length, 4);
  assert.equal(imported.regimesImported, true);
  const where = { graphHash: imported.graphHash, searchRootId: 'search.reuse', accessScopes: scopes };
  const { diagnosis } = await addon.diagnose(where);
  assert.equal(diagnosis.population.importedWorlds, 4);
  assert.equal(diagnosis.worlds.signatureCoverage.temporality.distinct, 4, 'the four worlds keep their four distinct signature codes');
  assert.deepEqual(diagnosis.worlds.roots.map((root) => root.conceptId).sort(), ['regime.answered-decay', 'regime.paid-change']);
  const solver = await addon.task({ ...where, requestId: 'example.solver', authorId: 'example', role: 'solver', inputs: { worldNodeId: 'lib.world.potlatch' } });
  assert.match(solver.text, /fishing cooperative/);
  assert.match(solver.text, /Kept World/);
});

test('the ontologies merge into the target model as Meaning Model concepts the engine accepts', async (t) => {
  const service = await engine(t);
  const model = freshModel(json('target-model.json'));
  const fragments = json('ontologies.json');
  model.meaning_model.concepts = [...(model.meaning_model.concepts ?? [])];
  model.meaning_model.abstract_relations = [...(model.meaning_model.abstract_relations ?? [])];
  for (const fragment of Object.values(fragments)) {
    model.meaning_model.concepts.push(...fragment.concepts);
    model.meaning_model.abstract_relations.push(...fragment.abstract_relations);
  }
  const { modelHash } = await service.registerModel({ requestId: 'example.merge', model });
  const inspected = await service.inspectModel({ modelHash, includeDefinition: true });
  const ids = new Set(inspected.model.meaning_model.concepts.map((concept) => concept.id));
  assert.ok(ids.has('alien.search.retirement.mechanisms.fam.hindsight-commitment'));
  assert.ok(ids.has('alien.search.retirement.worlds.regime.paid-change'));
});
