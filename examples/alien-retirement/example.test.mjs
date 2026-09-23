import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSimulationService } from '../../mcp-server/src/service.mjs';
import { AlienAddon } from '../../mcp-server/src/alien-addon.mjs';

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
