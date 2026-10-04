import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AlienAddon } from '../src/alien-addon.mjs';
import { readSearch } from '../src/alien-search.mjs';
import { SIGNATURE_AXES } from '../src/alien-tasks.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { LifeSimulationService } from '../src/service.mjs';

const equivalence = (changed = false) => ({ nameChanged: false, actorChanged: false, parameterChanged: false,
  inputSignalChanged: false, primaryOperatorChanged: changed, explanation: 'Compare the stated causal relations.' });
const concept = (id) => ({ op: 'add_concept', concept: { id, label: 'Pressure routing', operator: 'Pressure moves through a relay.' } });
const mechanism = (isolation = { explorer: 'same_context' }, compiled = false) => ({
  operator: 'A relay redirects pressure to the least loaded chamber.',
  roles: [{ id: 'relay', description: 'routes pressure', ...(compiled ? { worldRuleIds: ['R1'] } : {}) }, { id: 'chamber', description: 'receives pressure' }],
  strangest: { element: 'Pressure seeks free capacity.', preserved: 'Routing responds to spare capacity.' },
  candidate: { label: 'Pressure relay', design_principles: 'Route to free capacity.', core_mechanism: 'A relay redirects pressure.',
    how_it_works: 'Measure capacity and route pressure.', what_is_new: 'Allocation travels with the signal.', why_it_works: 'A hypothesis to test.',
    why_it_fails: 'Signals can be stale.', medium_term: 'Test a small relay.', long_term_vision: 'Inspect repeated trials.' }, isolation,
});
const world = (isolation = 'fresh_context') => ({ title: 'Chambers', principle: 'Pressure travels.', text: 'R1: Pressure travels to a chamber with free capacity.',
  rules: [{ id: 'R1', statement: 'Pressure travels to a chamber with free capacity.' }], isolation: { builder: isolation } });

async function setup(t, { persistent = false, searchId = 'search.synthetic' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'alien-workflow-test-'));
  const startService = async () => {
    const backend = new RustEngineProcess();
    backend.childEnvironment = { ...process.env };
    delete backend.childEnvironment.LIFE_SIM_STATE_FILE;
    if (persistent) backend.childEnvironment.LIFE_SIM_STATE_FILE = join(directory, 'state.sqlite');
    const service = new LifeSimulationService({ backend });
    await service.initialize();
    return service;
  };
  let service = await startService();
  let addon = new AlienAddon(service);
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, register] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const { modelHash } = await service.registerModel(register);
  const started = await addon.startSearch({ requestId: 'start', modelHash, graphId: 'graph.synthetic', searchId, title: 'Shared capacity',
    problem: { statement: 'How can a workshop share equipment?', deriveTargetTerms: false, targetTerms: ['workshop'] }, authorId: 'tester', accessScopes: ['author'] });
  let graphHash = started.graphHash; let counter = 0; const heads = {};
  const base = () => ({ graphHash, searchRootId: searchId, accessScopes: ['author'] });
  const advance = (result) => { graphHash = result.graphHash; return result; };
  return {
    get addon() { return addon; }, get service() { return service; }, base, advance,
    async restart() { await service.close(); service = await startService(); addon = new AlienAddon(service); },
    async task(role, inputs = {}) { return advance(await addon.task({ ...base(), requestId: `task.${++counter}`, role, inputs, authorId: 'tester' })); },
    async record(nodeId, kind, data, taskNodeId = null) { return advance(await addon.record({ ...base(), requestId: `record.${nodeId}`, nodeId, kind, data, taskNodeId, authorId: 'tester' })); },
    async revise(ontology, decision, operations = []) {
      const nodeId = `revision.${++counter}`;
      const result = await addon.reviseOntology({ ...base(), requestId: nodeId, nodeId, ontology, decision, operations,
        expectedHeadNodeId: heads[ontology] ?? null, authorId: 'tester' });
      heads[ontology] = nodeId;
      return advance(result);
    },
  };
}

async function propose(run, nodeId, inputs = {}) {
  const task = await run.task('explorer', inputs);
  await run.record(nodeId, 'mechanism', mechanism(), task.taskNodeId);
  return task;
}
async function admitFirst(run, nodeId = 'mechanism.first', conceptId = 'family.first') {
  await propose(run, nodeId);
  return run.revise('mechanisms', { verdict: 'admit_new', subjectNodeId: nodeId, conceptId, fit: 'clear', rationale: 'First comparison class.' }, [concept(conceptId)]);
}
async function reject(run, nodeId, commissionNodeId) {
  return run.revise('mechanisms', { verdict: 'reject_redirect', subjectNodeId: nodeId, nearestConceptId: 'family.first', equivalence: equivalence(),
    redirect: { addressedTo: 'retry', relationToChange: 'Replace routing with storage.', alternatives: ['Store locally', 'Delay transmission'], commissionNodeId }, rationale: 'The relation is occupied.' });
}

test('manual second judges validate question binding and persist counted, attributed disagreements', async (t) => {
  const run = await setup(t, { persistent: true });
  const first = await admitFirst(run, 'mechanism.first', 'none');
  const prepared = await run.addon.checkDecision({ ...run.base(), revisionNodeId: first.revisionNodeId });
  assert.equal(prepared.graphMutation, false);
  assert.deepEqual(Object.keys(prepared.questions), ['fit']);
  assert.match(prepared.instructions, /only state and questions/);
  const submission = { questionHash: prepared.questionHash, answers: { fit: { choice: 'partial' } }, evaluator: 'calling_llm',
    isolation: 'same_context', provenance: 'Synthetic caller answered the returned questions in its current context.' };
  const call = (submitted) => run.addon.checkDecision({ ...run.base(), revisionNodeId: first.revisionNodeId, submission: submitted });
  await assert.rejects(call({ ...submission, answers: {} }), /exactly these questions/);
  await assert.rejects(call({ ...submission, answers: { ...submission.answers, nearest: { choice: 'none' } } }), /exactly these questions/);
  await assert.rejects(call({ ...submission, answers: { fit: { choice: 'invented' } } }), /must be one of/);
  await assert.rejects(call({ ...submission, questionHash: '0'.repeat(64) }), /questionHash/);
  await assert.rejects(call({ ...submission, evaluator: 'human' }), /human evaluator uses human/);
  await assert.rejects(call({ ...submission, provenance: '' }), /provenance/);
  const checked = await call(submission);
  assert.deepEqual(checked.agreement, { nearest: null, operator: null, fit: false });
  assert.equal(checked.evaluation.independenceVerified, false);
  assert.equal(checked.evaluation.isolation, 'same_context');
  assert.equal(checked.graphMutation, false);
  // Additional records do not invalidate questions about an immutable revision.
  await run.record('assessment.extra', 'assessment', { subjectNodeIds: ['mechanism.first'], text: 'An unrelated note.' });
  assert.equal((await run.addon.checkDecision({ ...run.base(), revisionNodeId: first.revisionNodeId })).questionHash, prepared.questionHash);
  const withEstimator = new AlienAddon(run.service, { estimator: { estimate() { assert.fail('Caller submission must bypass the estimator.'); } } });
  run.advance(await withEstimator.checkDecision({ ...run.base(), revisionNodeId: first.revisionNodeId, submission,
    record: { requestId: 'check.manual', nodeId: 'check.manual', authorId: 'tester' } }));
  await run.restart();
  const diagnosis = (await run.addon.diagnose(run.base())).diagnosis;
  assert.equal(diagnosis.secondJudge.checked, 1);
  assert.equal(diagnosis.secondJudge.byEvaluator.calling_llm, 1);
  assert.equal(diagnosis.secondJudge.declaredIsolation.same_context, 1);
  assert.equal(diagnosis.secondJudge.independenceVerified, false);
  assert.deepEqual(diagnosis.secondJudge.disagreements[0].aspects, ['fit']);
  const stored = (await readSearch(run.service, run.base())).decisionChecks[0].data;
  assert.equal(stored.questionHash, submission.questionHash);
  assert.equal(stored.evaluation.provenance, submission.provenance);

  await propose(run, 'mechanism.second');
  const second = await run.revise('mechanisms', { verdict: 'admit_instance', subjectNodeId: 'mechanism.second', conceptId: 'none', nearestConceptId: 'none',
    fit: 'clear', equivalence: equivalence(), rationale: 'Same relation.' });
  const next = await run.addon.checkDecision({ ...run.base(), revisionNodeId: second.revisionNodeId });
  const human = { ...submission, questionHash: next.questionHash, evaluator: 'human', isolation: 'human',
    answers: { nearest: { choice: 'none' }, operator: { choice: 'unclear' }, fit: { choice: 'clear' } } };
  await assert.rejects(run.addon.checkDecision({ ...run.base(), revisionNodeId: second.revisionNodeId, submission: { ...human, questionHash: prepared.questionHash } }), /questionHash/);
  const none = await run.addon.checkDecision({ ...run.base(), revisionNodeId: second.revisionNodeId, submission: human });
  assert.equal(none.agreement.nearest, false, 'the none criterion does not agree with a real concept whose ID is none');
  assert.equal(none.agreement.operator, null, 'unclear is not forced into agreement or disagreement');
  assert.equal(none.answers.nearest.optionKey, 'none');
  const nearest = await run.addon.checkDecision({ ...run.base(), revisionNodeId: second.revisionNodeId,
    submission: { ...human, answers: { ...human.answers, nearest: { choice: 'c1' } } } });
  assert.equal(nearest.agreement.nearest, true);
  run.advance(await run.addon.checkDecision({ ...run.base(), revisionNodeId: second.revisionNodeId, submission: human,
    record: { requestId: 'check.human', nodeId: 'check.human', authorId: 'tester' } }));
  assert.equal((await readSearch(run.service, run.base())).record('check.human').node.epistemic_status, 'human_judgment');
  const other = await setup(t, { searchId: 'search.other' });
  const otherRevision = await admitFirst(other, 'mechanism.first', 'family.different-id');
  await assert.rejects(other.addon.checkDecision({ ...other.base(), revisionNodeId: otherRevision.revisionNodeId, submission }), /questionHash/);
  const remapped = await setup(t);
  const remappedRevision = await admitFirst(remapped, 'mechanism.first', 'family.different-id');
  assert.equal(remappedRevision.revisionNodeId, first.revisionNodeId);
  await assert.rejects(remapped.addon.checkDecision({ ...remapped.base(), revisionNodeId: remappedRevision.revisionNodeId, submission }), /questionHash/,
    'matching labels/operators and revision/search IDs do not permit a different concept-ID mapping');
});

test('follow-up guidance tracks actual pending work and preserves automatic assignment', async (t) => {
  const run = await setup(t);
  const builder = await run.task('builder');
  await run.record('world.one', 'world', world(), builder.taskNodeId);
  const admitted = await run.revise('worlds', { verdict: 'admit_new', subjectNodeId: 'world.one', conceptId: 'regime.one', rationale: 'First regime.' }, [concept('regime.one')]);
  assert.match(admitted.nextStep, /solver task.*world.one/);
  const solver = await run.task('solver', { worldNodeId: 'world.one' });
  const solved = await run.record('solution.one', 'solution', { worldNodeId: 'world.one', text: 'Route using R1.', isolation: { solver: 'same_context' } }, solver.taskNodeId);
  assert.match(solved.nextStep, /compiler task.*world.one.*solution.one/);
  assert.match(solved.warnings.join(' '), /purpose blindness is procedural/);
  const compiler = await run.task('compiler', { worldNodeId: 'world.one', solutionNodeId: 'solution.one' });
  const compiled = await run.record('mechanism.one', 'mechanism', mechanism({ compiler: 'same_context' }, true), compiler.taskNodeId);
  assert.match(compiled.warnings.join(' '), /selected population state/);
  const classified = await run.revise('mechanisms', { verdict: 'admit_new', subjectNodeId: 'mechanism.one', conceptId: 'family.one', fit: 'partial', rationale: 'First family.' }, [concept('family.one')]);
  assert.match(classified.nextStep, /outcomes ontologies/);
  assert.doesNotMatch(classified.nextStep, /mechanisms and outcomes/);
  const completed = await run.revise('outcomes', { verdict: 'admit_new', subjectNodeId: 'mechanism.one', conceptId: 'outcome.one', rationale: 'First outcome.' }, [concept('outcome.one')]);
  assert.match(completed.nextStep, /Diagnose the search/);
  const search = await readSearch(run.service, run.base());
  assert.equal(search.ontologyState('mechanisms').instances[0].fit, 'partial');
  const builder2 = await run.task('builder');
  await run.record('world.two', 'world', world(), builder2.taskNodeId);
  const solver2 = await run.task('solver', { worldNodeId: 'world.two' });
  const uncurated = await run.record('solution.two', 'solution', { worldNodeId: 'world.two', text: 'Route using R1.', isolation: { solver: 'fresh_context' } }, solver2.taskNodeId);
  assert.match(uncurated.nextStep, /world_curator.*world.two/);
  const secondWorld = await run.revise('worlds', { verdict: 'admit_instance', subjectNodeId: 'world.two', conceptId: 'regime.one', rationale: 'Same regime.' });
  assert.match(secondWorld.nextStep, /compiler task.*world.two.*solution.two/);
  const restructured = await run.revise('worlds', { verdict: 'restructure_only', rationale: 'Add a comparison branch.' }, [concept('regime.other')]);
  assert.match(restructured.nextStep, /Diagnose the search/);
});

test('retry tasks inherit explorer cues and population states, while explicit overrides and role checks apply', async (t) => {
  const run = await setup(t);
  await admitFirst(run);
  for (const [populationState, condition] of [['none', 'C'], ['tabu', 'D'], ['map', 'E']]) {
    const original = await propose(run, `mechanism.${condition}`, { populationState, drawCue: true });
    await reject(run, `mechanism.${condition}`, `commission.${condition}`);
    const retry = await run.task('explorer', { commissionNodeId: `commission.${condition}` });
    assert.equal(retry.condition, condition);
    assert.deepEqual(retry.material.cue, original.material.cue, 'retain the exact cue and original draw provenance');
    assert.equal(retry.inputs.populationState, populationState);
    assert.match(retry.text, /Store locally; Delay transmission/);
    assert.match(retry.text, /responsiveness, not discovery/);
  }
  const cleared = await run.task('explorer', { commissionNodeId: 'commission.E', cueWord: null, populationState: 'tabu' });
  assert.equal(cleared.condition, 'A');
  assert.equal(cleared.material.cue, null);
  const redrawn = await run.task('explorer', { commissionNodeId: 'commission.E', drawCue: true });
  assert.equal(redrawn.condition, 'E');
  assert.equal(redrawn.material.cue.source, 'bank');
  const override = await run.task('explorer', { commissionNodeId: 'commission.C', cueWord: 'relay', populationState: 'map' });
  assert.equal(override.condition, 'E');
  assert.equal(override.material.cue.source, 'caller');
  assert.equal(override.material.cue.word, 'relay');
  const builder = await run.task('builder');
  await run.record('world.one', 'world', world(), builder.taskNodeId);
  for (const id of ['one', 'two']) {
    const solver = await run.task('solver', { worldNodeId: 'world.one' });
    await run.record(`solution.${id}`, 'solution', { worldNodeId: 'world.one', text: 'Route using R1.', isolation: { solver: 'fresh_context' } }, solver.taskNodeId);
  }
  for (const [populationState, condition] of [['tabu', 'G'], ['map', 'H']]) {
    const task = await run.task('compiler', { worldNodeId: 'world.one', solutionNodeId: 'solution.one', populationState });
    await run.record(`mechanism.${condition}`, 'mechanism', mechanism({ compiler: 'fresh_context' }, true), task.taskNodeId);
    await reject(run, `mechanism.${condition}`, `commission.${condition}`);
    const retry = await run.task('compiler', { worldNodeId: 'world.one', solutionNodeId: 'solution.one', commissionNodeId: `commission.${condition}` });
    assert.equal(retry.condition, condition);
  }
  assert.equal((await run.task('compiler', { worldNodeId: 'world.one', solutionNodeId: 'solution.one', commissionNodeId: 'commission.H', populationState: 'none' })).condition, 'F');
  await assert.rejects(run.task('explorer', { commissionNodeId: 'commission.H' }), /retries a compiler task/);
  await assert.rejects(run.task('compiler', { worldNodeId: 'world.one', solutionNodeId: 'solution.two', commissionNodeId: 'commission.H' }), /retries world world.one and solution solution.one/);
  await assert.rejects(run.task('compiler', { worldNodeId: 'world.other', solutionNodeId: 'solution.one', commissionNodeId: 'commission.H' }), /retries world world.one and solution solution.one/);
  await assert.rejects(run.task('compiler', { worldNodeId: 'world.one', solutionNodeId: 'solution.one', commissionNodeId: 'commission.E' }), /retries a explorer task/);
});

test('commission avoidance reaches appropriate roles, and atlas retains assessment and preservation context', async (t) => {
  const run = await setup(t);
  await admitFirst(run);
  const builder = await run.task('builder');
  await run.record('world.first', 'world', world(), builder.taskNodeId);
  await run.revise('worlds', { verdict: 'admit_new', subjectNodeId: 'world.first', conceptId: 'regime.first', rationale: 'First regime.' }, [concept('regime.first')]);
  await run.record('commission.next', 'commission', { addressedTo: 'new_world', worldAsk: 'Explore storing pressure.',
    avoidConceptIds: ['regime.first', 'family.first'], rationale: 'Avoid the workshop mechanism.' });
  const nextBuilder = await run.task('builder', { commissionNodeId: 'commission.next' });
  assert.doesNotMatch(nextBuilder.text, /regime.first|family.first|workshop/);
  await run.record('world.next', 'world', world(), nextBuilder.taskNodeId);
  const curator = await run.task('world_curator', { subjectNodeId: 'world.next' });
  assert.match(curator.text, /Commissioned avoidance \(world regimes\)/);
  assert.match(curator.text, /Classify the world honestly/);
  assert.doesNotMatch(curator.text, /family.first|workshop/);
  await run.revise('worlds', { verdict: 'admit_instance', subjectNodeId: 'world.next', conceptId: 'regime.first', rationale: 'It returned to the same regime.' });
  const solver = await run.task('solver', { worldNodeId: 'world.next' });
  await run.record('solution.next', 'solution', { worldNodeId: 'world.next', text: 'Route using R1.', isolation: { solver: 'fresh_context' } }, solver.taskNodeId);
  const compiler = await run.task('compiler', { worldNodeId: 'world.next', solutionNodeId: 'solution.next' });
  assert.match(compiler.text, /Commissioned avoidance \(mechanism families\):\n- family.first/);
  assert.doesNotMatch(compiler.text, /regime.first/);
  await assert.rejects(run.record('commission.invalid', 'commission', { addressedTo: 'explorer', relationToChange: 'Explore storage.', avoidConceptIds: ['regime.first'], rationale: 'Explore.' }), /not an active mechanism family/);
  const diagnosis = (await run.addon.diagnose(run.base())).diagnosis;
  assert.deepEqual(diagnosis.commissions.avoidance[0].classifiedMatches, [{ ontology: 'worlds', subjectNodeId: 'world.next', conceptId: 'regime.first' }]);
  assert.match(diagnosis.warnings.join(' '), /returned to avoided concepts/);
  await run.record('assessment.one', 'assessment', { subjectNodeIds: ['mechanism.first'], verdict: 'Needs a trial', text: 'Measure delays before judging the proposal.' });
  await run.record('selection.one', 'selection', { format: 'single', items: [{ nodeId: 'mechanism.first', reason: 'Develop it.' }], rationale: 'A trial direction.',
    preserved: [{ conceptId: 'family.first', reason: 'Keep this unusual branch available.' }] });
  const atlas = await run.addon.atlas(run.base());
  assert.match(atlas.markdown, /## Assessments[\s\S]*Needs a trial[\s\S]*Measure delays/);
  assert.match(atlas.markdown, /Preserved family family.first: Keep this unusual branch/);
  assert.match(atlas.markdown, /Avoid concepts: regime.first, family.first/);
  await run.revise('worlds', { verdict: 'restructure_only', rationale: 'A regime uses an ID that is also present in the separate mechanism ontology.' }, [concept('family.first')]);
  await run.record('commission.shared-id', 'commission', { addressedTo: 'new_world', worldAsk: 'Explore stored pressure.', avoidConceptIds: ['family.first'], rationale: 'Avoid both matching concepts.' });
  const shared = (await run.addon.diagnose(run.base())).diagnosis.commissions.avoidance.find((item) => item.commissionNodeId === 'commission.shared-id');
  assert.deepEqual(shared.mechanismFamilyIds, ['family.first']);
  assert.deepEqual(shared.worldRegimeIds, ['family.first']);
});

test('explorer isolation aliases preserve legacy records and target-aware warnings stay consistent', async (t) => {
  const run = await setup(t);
  const explorer = await run.task('explorer');
  for (const [id, isolation] of [['new', { explorer: 'fresh_context' }], ['legacy', { compiler: 'fresh_context' }], ['both', { compiler: 'human', explorer: 'human' }]]) {
    await run.record(`mechanism.${id}`, 'mechanism', mechanism(isolation), explorer.taskNodeId);
  }
  const search = await readSearch(run.service, run.base());
  assert.deepEqual(search.record('mechanism.new').data.isolation, { compiler: 'fresh_context' });
  await assert.rejects(run.record('mechanism.bad', 'mechanism', mechanism({ compiler: 'fresh_context', explorer: 'same_context' }), explorer.taskNodeId), /must agree/);
  const builder = await run.task('builder', { operators: [{ kind: 'oracle_premise', statement: 'Pressure arrives already allocated.' }] });
  assert.equal(builder.targetBlind, false);
  assert.match(builder.isolationGuidance, /target-aware by design/);
  assert.doesNotMatch(builder.isolationGuidance, /rewrite/);
  const recorded = await run.record('world.oracle', 'world', world('same_context'), builder.taskNodeId);
  assert.match(recorded.warnings.join(' '), /already marked target-aware/);
  assert.doesNotMatch(recorded.warnings.join(' '), /target blindness is procedural/);
  const solver = await run.task('solver', { worldNodeId: 'world.oracle' });
  await run.record('solution.oracle', 'solution', { worldNodeId: 'world.oracle', text: 'Use R1.', isolation: { solver: 'fresh_context' } }, solver.taskNodeId);
  const compiler = await run.task('compiler', { worldNodeId: 'world.oracle', solutionNodeId: 'solution.oracle' });
  await assert.rejects(run.record('mechanism.wrong-role', 'mechanism', mechanism({ explorer: 'fresh_context' }, true), compiler.taskNodeId), /isolation.explorer belongs to an explorer/);
});

test('uniform signature coverage begins with three coded worlds', async (t) => {
  const run = await setup(t);
  const signature = Object.fromEntries(SIGNATURE_AXES.map((axis) => [axis, axis === 'temporality' ? { code: 'continuous', note: null } : null]));
  for (let index = 1; index <= 3; index += 1) {
    const task = await run.task('builder');
    const nodeId = `world.${index}`;
    await run.record(nodeId, 'world', world(), task.taskNodeId);
    await run.revise('worlds', { verdict: index === 1 ? 'admit_new' : 'admit_instance', subjectNodeId: nodeId, conceptId: 'regime.first', signature,
      rationale: 'The temporal regime is unchanged.' }, index === 1 ? [concept('regime.first')] : []);
    const coverage = (await run.addon.diagnose(run.base())).diagnosis.worlds.signatureCoverage.temporality;
    assert.equal(coverage.coded, index);
    assert.equal(coverage.uniform, index === 3);
  }
});
