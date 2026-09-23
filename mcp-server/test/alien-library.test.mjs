import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { AlienAddon, WORLD_LIBRARY_SCHEMA } from '../src/alien-addon.mjs';

const scopes = ['author'];
const bakery = { statement: 'How can a family bakery carry a 1,650,000 NOK loan through a bad year?', targetTerms: ['bakery', 'loan', 'debt'] };

const worldData = (title) => ({
  title, principle: 'Every held thing must change hands before dusk or it dissolves.',
  text: `# ${title}\n\nPrinciple: every held thing must change hands before dusk.\n\nR1: Unexchanged goods dissolve at dusk.\nR2: An exchange binds both parties to a return within seven dusks.`,
  rules: [{ id: 'R1', statement: 'Unexchanged goods dissolve at dusk.' }, { id: 'R2', statement: 'An exchange binds both parties to a return within seven dusks.' }],
  easy: ['Circulation'], hard: ['Hoarding'], isolation: { builder: 'fresh_context' },
});
const candidate = (label) => ({ label, design_principles: 'Holdings must keep moving.', core_mechanism: 'Obligations circulate so no one holds a stock.',
  how_it_works: 'Each surplus is passed on at once for a dated return claim.', what_is_new: 'Security lives in claims, not in stocks.',
  why_it_works: 'Claims survive shocks that stocks do not.', why_it_fails: 'A chain of claims can default all at once.',
  medium_term: 'Claim registries appear.', long_term_vision: 'Claims become the reserve.' });
const explorerData = (label) => ({ operator: 'Surplus is converted into circulating claims on later returns.',
  roles: [{ id: 'holder', description: 'whoever has a surplus' }, { id: 'claim', description: 'the dated return owed' }],
  strangest: { element: 'holding is impossible', preserved: 'idle holding is costly' }, candidate: candidate(label), isolation: { compiler: 'fresh_context' } });
const code = (value) => ({ code: value, note: null });
const signature = { temporality: code('daily deadline'), conservation: code('goods not conserved when idle'), agency: code('forced exchange'), identity: null,
  scarcity: code('holding time'), information_flow: null, boundary_structure: null, permitted_transformations: code('exchange only'), enforcement: code('physical') };

async function setup(t, { estimator = null } = {}) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest);
  const addon = new AlienAddon(service, { estimator });
  const searches = {};
  const open = async (searchId, problem) => {
    const started = await addon.startSearch({ requestId: `start.${searchId}`, modelHash, graphId: `graph.${searchId}`, searchId, title: searchId, problem, authorId: 'tester', accessScopes: scopes });
    const state = { graphHash: started.graphHash, count: 0 };
    const base = (extra = {}) => ({ graphHash: state.graphHash, searchRootId: searchId, accessScopes: scopes, ...extra });
    const step = (result) => { state.graphHash = result.graphHash; return result; };
    const helpers = {
      state, base,
      task: async (role, inputs = {}) => { state.count += 1; return step(await addon.task({ ...base(), requestId: `${searchId}.t${state.count}`, authorId: 'tester', role, inputs })); },
      record: async (nodeId, kind, data, taskNodeId = null) => step(await addon.record({ ...base(), requestId: `${searchId}.record.${nodeId}`, nodeId, authorId: 'tester', kind, data, taskNodeId })),
      revise: async (nodeId, ontology, expectedHeadNodeId, decision, operations = []) =>
        step(await addon.reviseOntology({ ...base(), requestId: `${searchId}.revise.${nodeId}`, nodeId, authorId: 'tester', ontology, expectedHeadNodeId, decision, operations })),
    };
    searches[searchId] = helpers;
    return helpers;
  };
  return { addon, open };
}

async function curatedWorld(a) {
  const builder = await a.task('builder');
  await a.record('world.dusk', 'world', worldData('The Dusk World'), builder.taskNodeId);
  await a.revise('wrev.1', 'worlds', null, { verdict: 'admit_new', subjectNodeId: 'world.dusk', conceptId: 'regime.dusk', fit: 'clear', signature, rationale: 'First regime.' },
    [{ op: 'add_concept', concept: { id: 'regime.dusk', label: 'Forced circulation', operator: 'Idle holdings dissolve, so everything must move.' } }]);
}

test('target-blind worlds export as a content-addressed library and import into another search, which starts at the solver', async (t) => {
  const { addon, open } = await setup(t);
  const a = await open('search.bakery', bakery);
  await curatedWorld(a);
  const exported = await addon.exportWorlds(a.base());
  const { library } = exported;
  assert.equal(library.schema, WORLD_LIBRARY_SCHEMA);
  assert.equal(exported.counts.worlds, 1);
  assert.deepEqual(library.worlds[0].regimes, [{ conceptId: 'regime.dusk', relation: 'instance', fit: 'clear' }]);
  assert.equal(library.worlds[0].signature.temporality.code, 'daily deadline');
  assert.equal(library.regimes.concepts[0].id, 'regime.dusk');

  const well = await open('search.well', { statement: 'How can a village share one well through a dry summer?', targetTerms: ['well', 'water', 'village'] });
  const imported = await addon.importWorlds({ ...well.base(), requestId: 'import.1', authorId: 'tester', library });
  well.state.graphHash = imported.graphHash;
  assert.deepEqual(imported.imported, [{ nodeId: 'lib.world.dusk', sourceWorldNodeId: 'world.dusk', targetBlind: true, targetLeaks: [] }]);
  assert.equal(imported.regimesImported, true);
  const diagnosis = (await addon.diagnose(well.base())).diagnosis;
  assert.equal(diagnosis.population.importedWorlds, 1);
  assert.equal(diagnosis.worlds.signatureCoverage.temporality.coded, 1, 'the imported signature counts toward coverage');
  assert.deepEqual(diagnosis.worlds.uncoded, []);
  const solver = await well.task('solver', { worldNodeId: 'lib.world.dusk' });
  assert.match(solver.text, /village share one well/);
  assert.match(solver.text, /Unexchanged goods dissolve at dusk/);
  const builder = await well.task('builder');
  assert.equal(builder.material.seed.drawIndex, 0, 'imported worlds hold no draw slot of this search');
  const atlas = await addon.atlas(well.base());
  assert.match(atlas.markdown, /Imported from world library [0-9a-f]{12} \(search search\.bakery, world world\.dusk\)/);

  const tampered = structuredClone(library); tampered.worlds[0].title = 'Changed';
  await assert.rejects(addon.importWorlds({ ...well.base(), requestId: 'import.2', authorId: 'tester', library: tampered, nodeIdPrefix: 'lib2' }), /bundleHash does not match/);
  await assert.rejects(addon.importWorlds({ ...well.base(), requestId: 'import.3', authorId: 'tester', library }), /already exists/);
  const again = await addon.importWorlds({ ...well.base(), requestId: 'import.4', authorId: 'tester', library, nodeIdPrefix: 'lib2' });
  assert.equal(again.regimesImported, false);
  assert.match(again.warnings.join(' '), /already has a regime ontology/);

  const market = await open('search.market', { statement: 'How should a market town price goods that must be sold before dusk?', targetTerms: ['dusk', 'market'] });
  const leaky = await addon.importWorlds({ ...market.base(), requestId: 'import.5', authorId: 'tester', library, includeRegimes: false });
  assert.equal(leaky.imported[0].targetBlind, false, 'a world that names this search\'s target terms is not target-blind here');
  assert.ok(leaky.imported[0].targetLeaks.includes('dusk'));
});

test('a second judge checks a recorded curator decision and the diagnosis reports disagreements', async (t) => {
  const calls = [];
  const estimator = { backend: 'typesafe', model: 'jev-test', label: 'typesafe:jev-test', async estimate(state, questions) {
    calls.push({ state, questions });
    return { model: 'jev-test', usage: { input_tokens: 50, output_tokens: 5 }, answers: {
      nearest: { type: 'choice', choice: 'c1', confidence: 0.8 },
      operator: { type: 'choice', choice: 'changed', confidence: 0.7 },
      fit: { type: 'choice', choice: 'partial', confidence: 0.6 } } };
  } };
  const { addon, open } = await setup(t, { estimator });
  const a = await open('search.bakery', bakery);
  const first = await a.task('explorer', { populationState: 'none' });
  await a.record('mech.a', 'mechanism', explorerData('Circulating claims'), first.taskNodeId);
  await a.revise('rev.1', 'mechanisms', null, { verdict: 'admit_new', subjectNodeId: 'mech.a', conceptId: 'fam.claims', fit: 'clear', rationale: 'First family.' },
    [{ op: 'add_concept', concept: { id: 'fam.claims', label: 'Circulating claims', operator: 'Surplus becomes a claim that must keep moving.' } }]);
  const second = await a.task('explorer', { populationState: 'none' });
  await a.record('mech.b', 'mechanism', explorerData('Claim relay'), second.taskNodeId);
  await a.revise('rev.2', 'mechanisms', 'rev.1', { verdict: 'admit_instance', subjectNodeId: 'mech.b', conceptId: 'fam.claims', nearestConceptId: 'fam.claims', fit: 'clear',
    equivalence: { nameChanged: true, actorChanged: false, parameterChanged: false, inputSignalChanged: false, primaryOperatorChanged: false, explanation: 'Same operator.' }, rationale: 'An instance.' });

  const checked = await addon.checkDecision({ ...a.base(), revisionNodeId: 'rev.2' });
  assert.equal(checked.evaluator, 'typesafe:jev-test');
  assert.deepEqual(Object.keys(checked.questions).sort(), ['fit', 'nearest', 'operator']);
  assert.equal(checked.answers.nearest.choice, 'fam.claims', 'option keys map back to concept ids');
  assert.deepEqual(checked.agreement, { nearest: true, operator: false, fit: false });
  assert.deepEqual(checked.disagreements, ['operator', 'fit']);
  assert.equal(checked.graphMutation, false);
  assert.doesNotMatch(JSON.stringify(calls[0]), /Same operator|An instance/, 'the judge does not see the curator\'s explanation or rationale');

  const recorded = await addon.checkDecision({ ...a.base(), revisionNodeId: 'rev.2', record: { requestId: 'check.1', nodeId: 'check.rev.2', authorId: 'tester' } });
  a.state.graphHash = recorded.graphHash;
  const diagnosis = (await addon.diagnose(a.base())).diagnosis;
  assert.equal(diagnosis.secondJudge.checked, 1);
  assert.equal(diagnosis.secondJudge.decisions, 2);
  assert.deepEqual(diagnosis.secondJudge.disagreements.map((item) => [item.revisionNodeId, item.aspects]), [['rev.2', ['operator', 'fit']]]);
  await assert.rejects(addon.checkDecision({ ...a.base(), revisionNodeId: 'mech.a' }), /not a ontology_revision record/);

  const { addon: plain, open: openPlain } = await setup(t);
  const p = await openPlain('search.plain', bakery);
  const task = await p.task('explorer', { populationState: 'none' });
  await p.record('mech.p', 'mechanism', explorerData('Plain'), task.taskNodeId);
  await p.revise('rev.p', 'mechanisms', null, { verdict: 'admit_new', subjectNodeId: 'mech.p', conceptId: 'fam.p', fit: 'clear', rationale: 'First.' },
    [{ op: 'add_concept', concept: { id: 'fam.p', label: 'P', operator: 'Operator p.' } }]);
  const unscored = await plain.checkDecision({ ...p.base(), revisionNodeId: 'rev.p' });
  assert.equal(unscored.evaluator, 'calling_llm');
  assert.deepEqual(Object.keys(unscored.questions), ['fit'], 'a first family has no earlier concept to compare, only its fit');
  await assert.rejects(plain.checkDecision({ ...p.base(), revisionNodeId: 'rev.p', record: { requestId: 'c', nodeId: 'c', authorId: 'tester' } }), /needs the configured estimator/);
});

test('graded membership recorded through a revision shows candidates that sit between families', async (t) => {
  const { addon, open } = await setup(t);
  const a = await open('search.bakery', bakery);
  const first = await a.task('explorer', { populationState: 'none' });
  await a.record('mech.a', 'mechanism', explorerData('Hybrid'), first.taskNodeId);
  await a.revise('rev.1', 'mechanisms', null, { verdict: 'admit_new', subjectNodeId: 'mech.a', conceptId: 'fam.x', fit: 'partial', rationale: 'First family.' }, [
    { op: 'add_concept', concept: { id: 'fam.x', label: 'X', operator: 'Operator x.' } }, { op: 'add_concept', concept: { id: 'fam.y', label: 'Y', operator: 'Operator y.' } },
    { op: 'set_membership', subjectNodeId: 'mech.a', question: 'How does the candidate\'s operator divide among the families it draws on?', unit: 'one unit of the primary operator',
      shares: [{ conceptId: 'fam.x', share: 0.55 }, { conceptId: 'fam.y', share: 0.3 }], remainder: 0.15 }]);
  const diagnosis = (await addon.diagnose(a.base())).diagnosis;
  assert.deepEqual(diagnosis.mechanisms.hybrids.map((item) => item.subjectNodeId), ['mech.a']);
  const atlas = await addon.atlas(a.base());
  assert.match(atlas.markdown, /Graded membership \(Cuts\):\n- Hybrid \[mech\.a\]: fam\.x 0\.55, fam\.y 0\.3, remainder 0\.15/);
  await assert.rejects(a.revise('rev.2', 'mechanisms', 'rev.1', { verdict: 'restructure_only', rationale: 'Bad Cut.' },
    [{ op: 'set_membership', subjectNodeId: 'mech.a', question: 'q', unit: 'u', shares: [{ conceptId: 'fam.x', share: 0.5 }, { conceptId: 'fam.y', share: 0.3 }], remainder: 0.1 }]), /sum to 1/);
});
