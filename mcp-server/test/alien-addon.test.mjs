import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { AlienAddon } from '../src/alien-addon.mjs';
import { alienSeedWords, findTargetLeaks } from '../src/alien-search.mjs';
import { buildTask } from '../src/alien-tasks.mjs';

const scopes = ['author'];
const problem = {
  statement: 'How can a family bakery carry a 1,650,000 NOK loan through a bad year without selling to the first buyer?',
  context: 'The owner has told nobody about the debt.',
  targetTerms: ['bakery', 'loan', 'debt'],
};

async function setup(t) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel(registerRequest);
  const addon = new AlienAddon(service);
  const started = await addon.startSearch({ requestId: 'start', modelHash, graphId: 'alien-bakery', searchId: 'search.bakery',
    title: 'Carrying the loan', problem, authorId: 'tester', accessScopes: scopes });
  const state = { graphHash: started.graphHash, count: 0 };
  const base = (extra = {}) => ({ graphHash: state.graphHash, searchRootId: 'search.bakery', accessScopes: scopes, ...extra });
  const task = async (role, inputs = {}) => {
    state.count += 1;
    const prepared = await addon.task({ ...base(), requestId: `t${state.count}`, authorId: 'tester', role, inputs });
    state.graphHash = prepared.graphHash;
    return prepared;
  };
  const record = async (nodeId, kind, data, taskNodeId = null) => {
    const stored = await addon.record({ ...base(), requestId: `record.${nodeId}`, nodeId, authorId: 'tester', kind, data, taskNodeId });
    state.graphHash = stored.graphHash;
    return stored;
  };
  const revise = async (nodeId, ontology, expectedHeadNodeId, decision, operations = [], taskNodeId = null) => {
    const stored = await addon.reviseOntology({ ...base(), requestId: `revise.${nodeId}`, nodeId, authorId: 'tester', ontology, expectedHeadNodeId, decision, operations, taskNodeId });
    state.graphHash = stored.graphHash;
    return stored;
  };
  return { service, addon, started, state, base, task, record, revise, registerRequest, modelHash };
}

const worldData = (title) => ({
  title, principle: 'Every held thing must change hands before dusk or it dissolves.',
  text: `# ${title}\n\nPrinciple: every held thing must change hands before dusk.\n\nR1: Unexchanged goods dissolve at dusk.\nR2: An exchange binds both parties to a return within seven dusks.\nR3: Returns may be made in any good of equal weight.`,
  rules: [{ id: 'R1', statement: 'Unexchanged goods dissolve at dusk.' }, { id: 'R2', statement: 'An exchange binds both parties to a return within seven dusks.' },
    { id: 'R3', statement: 'Returns may be made in any good of equal weight.' }],
  easy: ['Circulation'], hard: ['Hoarding'], isolation: { builder: 'fresh_context' },
});

const candidate = (label) => ({ label, design_principles: 'Holdings must keep moving.', core_mechanism: 'Obligations circulate so no one holds a stock.',
  how_it_works: 'Each surplus is passed on at once in exchange for a dated return claim.', what_is_new: 'Security lives in claims, not in stocks.',
  why_it_works: 'Claims survive shocks that stocks do not.', why_it_fails: 'A chain of claims can default all at once.',
  medium_term: 'Claim registries appear.', long_term_vision: 'Stocks become rare and claims are the reserve.' });

const mechanismData = (label, worldRuleIds = ['R1', 'R2']) => ({
  operator: 'A holding that must be passed on converts every surplus into a circulating claim on a later return.',
  roles: [{ id: 'holder', description: 'whoever has a surplus', worldRuleIds: worldRuleIds.slice(0, 1) },
    { id: 'claim', description: 'the dated return owed', worldRuleIds: worldRuleIds.slice(1) }],
  magicalElements: [{ element: 'dissolution at dusk', fix: { kind: 'institutional_substitute', text: 'a demurrage fee on idle balances' } }],
  strangest: { element: 'holding is impossible', preserved: 'the design makes idle holding costly rather than merely unwise' },
  candidate: candidate(label), isolation: { compiler: 'fresh_context' },
});

const explorerData = (label, operator) => ({
  operator, roles: [{ id: 'router', description: 'who routes ownership' }, { id: 'owner', description: 'who ends up holding' }],
  strangest: { element: 'ownership moves on its own', preserved: 'transfers are automatic by default' },
  candidate: candidate(label), isolation: { compiler: 'same_context' },
});

const equivalence = (primaryOperatorChanged) => ({ nameChanged: true, actorChanged: true, parameterChanged: false, inputSignalChanged: false, primaryOperatorChanged, explanation: 'Compared with the nearest concept.' });

test('the search loop partitions information by role, stores every task and records every step in the graph', async (t) => {
  const { addon, started, state, base, task, record, revise, registerRequest, service } = await setup(t);
  assert.deepEqual(started.targetTerms.filter((term) => ['bakery', 'debt', 'loan'].includes(term)), ['bakery', 'debt', 'loan']);

  // Builder: target-blind by construction; a prepared task is stored and reserves its slot.
  const builder = await task('builder');
  assert.ok(alienSeedWords.includes(builder.material.seed.word));
  assert.equal(builder.targetBlind, true);
  assert.deepEqual(findTargetLeaks(builder.text, started.targetTerms), [], 'the builder never sees the problem');
  assert.ok(!builder.text.includes(problem.statement));
  const view = await service.queryNarrativeGraph({ graphHash: state.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  const stored = view.nodes.find((node) => node.id === builder.taskNodeId);
  assert.equal(JSON.parse(stored.text).data.text, builder.text, 'the exact task text is in the graph');
  const second = await task('builder');
  assert.equal(second.material.seed.drawIndex, 1, 'a reserved slot is skipped, so sequential preparation fans out');
  const again = await task('builder', { slot: 0 });
  assert.equal(again.text, builder.text, 're-preparing a slot gives the same draw');
  await assert.rejects(record('world.bad', 'world', worldData('Dusk'), 'task.missing'), /not a task record/);
  const world = await record('world.dusk', 'world', worldData('The Dusk Exchange'), builder.taskNodeId);
  assert.equal(world.warnings.length, 0);
  await assert.rejects(record('world.dusk2', 'world', worldData('Again'), again.taskNodeId), /already produced a world/);
  await assert.rejects(task('builder', { slot: 0 }), /Draw slot 0 already holds world world\.dusk/);

  // Solver: target-aware and purpose-blind; it never sees the problem's context.
  const solver = await task('solver', { worldNodeId: 'world.dusk' });
  assert.ok(solver.text.includes(problem.statement) && solver.text.includes('R2: An exchange binds'));
  assert.ok(!solver.text.includes(problem.context), 'the solver does not see background context');
  for (const word of ['ontology', 'transfer', 'compile', 'extract', 'mechanism', 'curator']) assert.ok(!solver.text.toLowerCase().includes(word), `solver task mentions ${word}`);
  await assert.rejects(record('solve.wrongtask', 'solution', { worldNodeId: 'world.dusk', text: 'x', isolation: { solver: 'fresh_context' } }, builder.taskNodeId), /is a builder task/);
  await assert.rejects(record('solve.bad', 'solution', { worldNodeId: 'world.dusk', text: 'x', citedRuleIds: ['R9'], isolation: { solver: 'fresh_context' } }, solver.taskNodeId), /R9 are not rules/);
  await record('solve.dusk', 'solution', { worldNodeId: 'world.dusk', text: 'Pass every loaf on at dusk against a seven-dusk return (R1, R2).', citedRuleIds: ['R1', 'R2'], isolation: { solver: 'fresh_context' } }, solver.taskNodeId);

  // Compiler (condition F) and mechanism record.
  const compiler = await task('compiler', { worldNodeId: 'world.dusk', solutionNodeId: 'solve.dusk' });
  assert.equal(compiler.condition, 'F');
  assert.match(compiler.text, /Preserve what's strangest/);
  await assert.rejects(record('mech.bad', 'mechanism', mechanismData('Claims', ['R7', 'R2']), compiler.taskNodeId), /R7, which are not rules/);
  await assert.rejects(record('mech.long', 'mechanism', mechanismData('A label that is far longer than forty characters'), compiler.taskNodeId), /label/);
  const mechanism = await record('mech.claims', 'mechanism', mechanismData('Circulating claims'), compiler.taskNodeId);
  assert.deepEqual(mechanism.warnings, []);

  // Curator: first family, then the first claimed-outcome class.
  const curator = await task('curator', { subjectNodeId: 'mech.claims' });
  assert.match(curator.text, /Circulating claims/);
  const first = await revise('rev.1', 'mechanisms', null, { verdict: 'admit_new', subjectNodeId: 'mech.claims', conceptId: 'f.circulation', fit: 'clear', rationale: 'First family.' },
    [{ op: 'add_concept', concept: { id: 'f.circulation', label: 'Forced circulation', operator: 'surplus must move and becomes a claim',
      roles: [{ id: 'holder', description: 'who has the surplus' }, { id: 'claim', description: 'the return owed' }] } }], curator.taskNodeId);
  assert.match(first.tree, /\[f\.circulation\] Forced circulation: 1 direct/);
  await assert.rejects(revise('rev.x', 'mechanisms', null, { verdict: 'restructure_only', rationale: 'x' }, [{ op: 'add_concept', concept: { id: 'z', label: 'Z', operator: 'z' } }]),
    /head is rev\.1, not empty/);
  await assert.rejects(revise('rev.num', 'mechanisms', 'rev.1', { verdict: 'admit_instance', subjectNodeId: 'mech.claims', conceptId: 'f.circulation', fit: 0.7, rationale: 'x' }),
    /fit/, 'a numeric fit is refused');
  const outcomeTask = await task('curator', { subjectNodeId: 'mech.claims', ontology: 'outcomes' });
  assert.match(outcomeTask.text, /claimed outcomes/);
  await assert.rejects(revise('orev.wrong', 'mechanisms', 'rev.1', { verdict: 'admit_instance', subjectNodeId: 'mech.claims', conceptId: 'f.circulation', rationale: 'x' }, [], outcomeTask.taskNodeId),
    /concerns the outcomes ontology/);
  await revise('orev.1', 'outcomes', null, { verdict: 'admit_new', subjectNodeId: 'mech.claims', conceptId: 'o.steady', rationale: 'First outcome class.' },
    [{ op: 'add_concept', concept: { id: 'o.steady', label: 'Steady old-age income from lumpy inflows', operator: 'old-age income stays steady whatever the timing of contributions' } }], outcomeTask.taskNodeId);

  // Explorer proposals (condition B): an alias and a guarded admission.
  const explorer = await task('explorer');
  assert.equal(explorer.condition, 'B');
  assert.match(explorer.text, /Forced circulation/);
  await record('mech.alias', 'mechanism', explorerData('Passed-on surplus', 'Surplus that must move becomes a claim held by the next person.'), explorer.taskNodeId);
  await assert.rejects(revise('rev.2', 'mechanisms', 'rev.1', { verdict: 'admit_new', subjectNodeId: 'mech.alias', conceptId: 'f.alias', nearestConceptId: 'f.circulation',
    equivalence: equivalence(false), rationale: 'Try.' }, [{ op: 'add_concept', concept: { id: 'f.alias', label: 'Alias', operator: 'same' } }]), /only when the primary operator changes/);
  await revise('rev.2', 'mechanisms', 'rev.1', { verdict: 'equivalent', subjectNodeId: 'mech.alias', conceptId: 'f.circulation', nearestConceptId: 'f.circulation',
    equivalence: equivalence(false), rationale: 'Only the actor and name changed.' });

  // Rejection with a redirect writes a retry commission; the retry changes the operator and is admitted.
  const explorer2 = await task('explorer');
  await record('mech.occupied', 'mechanism', explorerData('Claim chain', 'Surplus is converted into a claim that is passed along a chain.'), explorer2.taskNodeId);
  const rejected = await revise('rev.3', 'mechanisms', 'rev.2', { verdict: 'reject_redirect', subjectNodeId: 'mech.occupied', nearestConceptId: 'f.circulation',
    equivalence: equivalence(false), redirect: { addressedTo: 'retry', relationToChange: 'Change detection-and-conversion into routing of ownership.',
      alternatives: ['routing', 'pooling'], commissionNodeId: 'com.retry' }, rationale: 'Occupied family.' });
  assert.equal(rejected.commissionNodeId, 'com.retry');
  assert.match(rejected.nextStep, /explorer task with commissionNodeId com\.retry/);
  const retryTask = await task('explorer', { commissionNodeId: 'com.retry' });
  assert.match(retryTask.text, /routing of ownership/);
  await record('mech.route', 'mechanism', explorerData('Owner routing', 'Ownership of each surplus is routed automatically to whoever will need it next.'), retryTask.taskNodeId);
  await revise('rev.4', 'mechanisms', 'rev.3', { verdict: 'admit_new', subjectNodeId: 'mech.route', conceptId: 'f.routing', nearestConceptId: 'f.circulation',
    equivalence: equivalence(true), rationale: 'Routing replaces conversion.' },
  [{ op: 'add_concept', concept: { id: 'f.routing', label: 'Ownership routing', operator: 'ownership is sent ahead to the next need',
    roles: [{ id: 'router', description: 'who routes' }, { id: 'owner', description: 'who holds' }] } }]);

  // Cued explorer (condition E), Semantic Tabu (A) and a map-conditioned compile (H).
  const cued = await task('explorer', { drawCue: true });
  assert.equal(cued.condition, 'E');
  assert.ok(alienSeedWords.includes(cued.material.cue.word));
  assert.match(cued.text, /A random word for inspiration: /);
  const tabu = await task('explorer', { populationState: 'tabu' });
  assert.equal(tabu.condition, 'A');
  assert.match(tabu.text, /EXISTING SOLUTIONS:[\s\S]*Circulating claims[\s\S]*AVOIDING/);
  const mapped = await task('compiler', { worldNodeId: 'world.dusk', solutionNodeId: 'solve.dusk', populationState: 'map' });
  assert.equal(mapped.condition, 'H');
  assert.match(mapped.text, /Family and claimed-outcome combinations no candidate has yet: f\.routing \([^)]+\) with o\.steady \([^)]+\)/);
  assert.match(mapped.text, /The claimed-outcome classes[^\n]*\n- \[o\./, 'outcome classes are named, not only cited by id');

  // World curator: target-blind, codes the causal signature.
  const worldCurator = await task('world_curator', { subjectNodeId: 'world.dusk' });
  assert.equal(worldCurator.targetBlind, true);
  assert.deepEqual(findTargetLeaks(worldCurator.text, started.targetTerms), []);
  const code = (value) => ({ code: value, note: null });
  const signature = { temporality: code('daily deadline'), conservation: code('goods not conserved when idle'), agency: code('forced exchange'), identity: null, scarcity: code('holding time'),
    information_flow: null, boundary_structure: null, permitted_transformations: code('exchange only'), enforcement: code('physical') };
  await revise('wrev.1', 'worlds', null, { verdict: 'admit_new', subjectNodeId: 'world.dusk', conceptId: 'r.decay', signature, rationale: 'First regime.' },
    [{ op: 'add_concept', concept: { id: 'r.decay', label: 'Decay of the unexchanged', operator: 'idle holdings decay on a fixed clock' } }], worldCurator.taskNodeId);

  // Diagnosis sees the whole population, its conditions and its unused tasks.
  const { diagnosis, diagnosisHash } = await addon.diagnose(base());
  assert.equal(diagnosis.population.worlds, 1);
  assert.deepEqual(diagnosis.population.mechanisms, { total: 4, fromWorlds: 1, fromExplorer: 3, retries: 1 });
  assert.deepEqual(diagnosis.mechanisms.decisions, { admit_new: 2, equivalent: 1, reject_redirect: 1 });
  assert.equal(diagnosis.mechanisms.redirectChains[0].complete, true);
  assert.deepEqual(diagnosis.conditions, { F: { mechanisms: 1, newFamilies: 1 }, B: { mechanisms: 3, newFamilies: 1 } });
  assert.deepEqual(diagnosis.outcomes.uncombinedPairs, [{ familyId: 'f.routing', outcomeId: 'o.steady' }]);
  assert.deepEqual(diagnosis.outcomes.unclassified, ['mech.alias', 'mech.occupied', 'mech.route']);
  assert.ok(diagnosis.tasks.unused.some((item) => item.nodeId === second.taskNodeId), 'an unused builder task stays visible');
  assert.equal(diagnosis.worlds.signatureCoverage.temporality.coded, 1);
  assert.deepEqual(diagnosis.commissions.fulfilled, [{ nodeId: 'com.retry', by: ['mech.route'] }]);

  // Commissions: a diagnosis citation is checked, and target terms in a world ask are flagged through to the builder.
  await assert.rejects(record('com.bad', 'commission', { addressedTo: 'new_world', worldAsk: 'Make storage impossible.', rationale: 'r',
    diagnosis: { graphHash: state.graphHash, diagnosisHash: 'e'.repeat(64) } }), /diagnosisHash does not match/);
  const leaky = await record('com.world', 'commission', { addressedTo: 'new_world', worldAsk: 'A world where every debt ripens like fruit.',
    operators: [{ kind: 'capability_removal', statement: 'Nothing can be stored for longer than a season.' }], avoidConceptIds: ['f.circulation'],
    rationale: 'Only one regime so far.', diagnosis: { graphHash: base().graphHash, diagnosisHash } });
  assert.match(leaky.warnings[0], /target terms \(debt\)/);
  const commissioned = await task('builder', { commissionNodeId: 'com.world' });
  assert.equal(commissioned.targetBlind, false);
  assert.deepEqual(commissioned.targetLeaks, ['debt']);
  assert.match(commissioned.text, /Remove this capability from the world entirely: Nothing can be stored/);

  // Transfer onto the target model: every role mapped, refs resolved and grounded, fit as a Cut.
  const transferTask = await task('transfer', { mechanismNodeId: 'mech.claims' });
  assert.match(transferTask.text, /process:bakery\.debt_nok/);
  const transfer = (roleMap, fitCut = null) => ({ mechanismNodeId: 'mech.claims', roleMap,
    proxies: [{ element: 'dissolution at dusk', label: 'portable', proxy: 'a fee on idle balances', asOf: '2026-09-22' }],
    disanalogies: ['Bread does spoil, but money does not dissolve.'], candidate: candidate('Loaf claims'), fitCut,
    evidenceNeeded: ['Whether suppliers would accept dated return claims.'] });
  const roles = [{ roleId: 'holder', binding: { kind: 'model', ref: 'referent:referent.bakery', how: 'the bakery holds daily surplus' } },
    { roleId: 'claim', binding: { kind: 'new_component', description: 'a dated claim on a supplier' } }];
  await assert.rejects(record('tr.bad', 'transfer', transfer([{ roleId: 'holder', binding: { kind: 'model', ref: 'process:missing', how: 'x' } },
    { roleId: 'claim', binding: { kind: 'unfilled', reason: 'none' } }])), /does not name a process/);
  await assert.rejects(record('tr.bad', 'transfer', transfer([{ roleId: 'holder', binding: { kind: 'new_component', description: 'x' } }])), /exactly once/);
  await assert.rejects(record('tr.bad', 'transfer', transfer(roles, { question: 'q', unit: 'u', matches: 0.6, doesNotMatch: 0.3, remainder: 0.2 })), /sum to 1/);
  await record('tr.claims', 'transfer', transfer(roles, { question: 'How does the comparison budget of this role alignment divide?', unit: 'one comparison budget over the two roles',
    matches: 0.5, doesNotMatch: 0.3, remainder: 0.2 }), transferTask.taskNodeId);
  const after = await service.queryNarrativeGraph({ graphHash: state.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  assert.ok(after.edges.some((edge) => edge.source.node_id === 'tr.claims' && edge.target.kind === 'anchor' && edge.target.anchor_id === 'referent.bakery' && edge.relation === 'maps_role'));
  assert.ok(after.edges.some((edge) => edge.source.node_id === 'tr.claims' && edge.relation === 'answers' && edge.target.node_id === transferTask.taskNodeId));

  // Selections: a weighted selection is an allocation with a question, a unit and a remainder.
  await assert.rejects(record('sel.bad', 'selection', { format: 'weighted', items: [{ nodeId: 'mech.claims', weight: 0.5, reason: 'r' }, { nodeId: 'mech.route', weight: 0.5, reason: 'r' }],
    rationale: 'r' }), /question, unit and remainder/);
  await assert.rejects(record('sel.bad', 'selection', { format: 'weighted', items: [{ nodeId: 'mech.claims', weight: 0.5, reason: 'r' }, { nodeId: 'mech.route', weight: 0.4, reason: 'r' }],
    allocation: { question: 'How should the next development budget divide?', unit: 'one development budget', remainder: 0.2 }, rationale: 'r' }), /sum to 1/);
  await record('sel.weighted', 'selection', { format: 'weighted', items: [{ nodeId: 'tr.claims', weight: 0.5, reason: 'Most developed.' }, { nodeId: 'mech.route', weight: 0.3, reason: 'Different operator.' }],
    allocation: { question: 'How should the next development budget divide?', unit: 'one development budget', remainder: 0.2 },
    rationale: 'Two distinct operators for review, with budget left unallocated.', preserved: [{ conceptId: 'f.routing', reason: 'Strange and undeveloped.' }] });

  // A partition under a lens, then the atlas and its fragments registered in a successor model.
  await revise('rev.5', 'mechanisms', 'rev.4', { verdict: 'restructure_only', rationale: 'Both families answer where a surplus goes.' },
    [{ op: 'add_concept', concept: { id: 'f.motion', label: 'Surplus in motion', operator: 'a surplus is never allowed to rest' } },
      { op: 'add_partition', partition: { id: 'f.motion.by-carrier', parentConceptId: 'f.motion', childConceptIds: ['f.circulation', 'f.routing'], lens: 'by what carries the surplus' } }]);
  const atlas = await addon.atlas(base());
  for (const heading of ['## Problem', '## Mechanism ontology', '## Claimed-outcome ontology', '## Worlds', '## Mechanisms', '## Transfers', '## Commissions', '## Selections']) assert.ok(atlas.markdown.includes(heading), heading);
  assert.match(atlas.markdown, /partition f\.motion\.by-carrier, lens: by what carries the surplus/);
  assert.match(atlas.markdown, /Fit Cut \(How does the comparison budget/);
  const fragment = atlas.meaningModelFragments.mechanisms;
  assert.deepEqual(fragment.abstract_cuts, []);
  assert.ok(fragment.abstract_relations.some((item) => item.kind === 'specialization' && item.label === null && item.provenance.at(-1).endsWith('lens: by what carries the surplus')));
  const successor = structuredClone(registerRequest);
  successor.requestId = 'with-ontology'; successor.model.id = 'harbour-example-alien';
  for (const ontology of ['mechanisms', 'outcomes', 'worlds']) {
    successor.model.meaning_model.concepts.push(...atlas.meaningModelFragments[ontology].concepts);
    successor.model.meaning_model.abstract_relations.push(...atlas.meaningModelFragments[ontology].abstract_relations);
  }
  const registered = await service.registerModel(successor);
  assert.match(registered.modelHash, /^[a-f0-9]{64}$/u, 'the engine accepts the ontologies as Meaning Model concepts and specializations');

  // Another audience cannot see the problem, so target-aware tasks refuse it.
  await assert.rejects(buildTask(service, { ...base(), accessScopes: ['reader'], role: 'solver', inputs: { worldNodeId: 'world.dusk' } }), /unknown, inaccessible|not visible/);
});

test('earlier records that cite a recomputed taskRef still verify, and a changed one is refused', async (t) => {
  const { addon, base, record, service } = await setup(t);
  const prepared = await buildTask(service, { ...base(), role: 'builder' });
  await assert.rejects(addon.record({ ...base(), requestId: 'legacy.bad', nodeId: 'world.legacy.bad', authorId: 'tester', kind: 'world', data: worldData('Dusk'),
    taskRef: { ...prepared.taskRef, taskHash: 'f'.repeat(64) } }), /taskRef does not match/);
  const stored = await addon.record({ ...base(), requestId: 'legacy', nodeId: 'world.legacy', authorId: 'tester', kind: 'world', data: worldData('Dusk'), taskRef: prepared.taskRef });
  assert.ok(stored.graphHash);
  await assert.rejects(record('world.none', 'world', worldData('None')), /cites the task it answers/);
});

test('a search can be added to an existing graph, and oracle premises are recorded as target-aware', async (t) => {
  const { addon, service, modelHash } = await setup(t);
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, , graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const story = await service.registerNarrativeGraph(JSON.parse(JSON.stringify(graphRequest).replaceAll('MODEL_HASH', modelHash)));
  const started = await addon.startSearch({ requestId: 'start-existing', graphHash: story.graphHash, searchId: 'search.two', title: 'Second search',
    problem: { statement: 'How can a harbour town keep its only bakery open?', targetTerms: ['bakery'] }, authorId: 'tester', accessScopes: scopes });
  const oracle = await addon.task({ graphHash: started.graphHash, requestId: 'oracle', searchRootId: 'search.two', authorId: 'tester', accessScopes: scopes, role: 'builder',
    inputs: { operators: [{ kind: 'oracle_premise', statement: 'Every bakery always has exactly the flour it needs.' }] } });
  assert.equal(oracle.targetBlind, false);
  assert.deepEqual(oracle.targetLeaks, ['bakery']);
  assert.match(oracle.text, /Treat this as already and simply true, as a law: Every bakery/);
  const stored = await addon.record({ graphHash: oracle.graphHash, requestId: 'w', nodeId: 'world.flour', searchRootId: 'search.two', authorId: 'tester', accessScopes: scopes,
    kind: 'world', data: worldData('Flour Without End'), taskNodeId: oracle.taskNodeId });
  assert.match(stored.warnings.join(' '), /not target-blind/);
  const { diagnosis } = await addon.diagnose({ graphHash: stored.graphHash, searchRootId: 'search.two', accessScopes: scopes });
  assert.deepEqual(diagnosis.isolation.notTargetBlind, [{ worldNodeId: 'world.flour', targetLeaks: ['bakery'], oraclePremise: true }]);
  await assert.rejects(addon.startSearch({ requestId: 'dup', graphHash: stored.graphHash, searchId: 'search.two', title: 'Again', problem: { statement: 'x' },
    authorId: 'tester', accessScopes: scopes }), /already exists/);
});
