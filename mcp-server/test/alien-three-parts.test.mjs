import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AlienAddon } from '../src/alien-addon.mjs';
import { readSearch } from '../src/alien-search.mjs';
import { checkVerification, composeStatus, pureResult, verificationSummary } from '../src/alien-verify.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { LifeSimulationService } from '../src/service.mjs';

// The three parts of the alien method: invented worlds, a curated graph of kinds whose empty subtrees can be forced,
// and PURE verification decomposed by Fractal Intelligence.

const probe = (status, probes = [], text = 'A sub-question') => ({ probe: text, finding: 'What was found.', status, probes });
const check = (nodeId, subjectNodeId, axis, status, probes = [], deepens = null) => ({ nodeId, data: { subjectNodeId, axis, status, probes, ...(deepens ? { deepens } : {}) } });

test('each PURE axis composes its probes by its own rule', () => {
  assert.equal(composeStatus('parsimony', ['verified', 'verified'], 0), 'verified');
  assert.equal(composeStatus('parsimony', ['verified', 'unknown'], 0), 'unknown');
  assert.equal(composeStatus('novelty', ['verified', 'falsified', 'unknown'], 0), 'falsified');
  assert.equal(composeStatus('realizable', ['verified', 'falsified'], 3), 'falsified');
  // Expansive holds when any domain tried carries over, and fails when every one breaks; inside a domain, every part must hold.
  assert.equal(composeStatus('expansive', ['verified', 'falsified'], 0), 'verified');
  assert.equal(composeStatus('expansive', ['falsified', 'falsified'], 0), 'falsified');
  assert.equal(composeStatus('expansive', ['falsified', 'unknown'], 0), 'unknown');
  assert.equal(composeStatus('expansive', ['verified', 'falsified'], 1), 'falsified');
});

test('a verification states the status its probes compose to', () => {
  assert.throws(() => checkVerification({ axis: 'realizable', status: 'unknown', probes: [probe('verified'), probe('verified')] }),
    /Realizable follows from its probes.*The check says unknown, and its probes give verified\. Record verified, or add a probe for the doubt/);
  assert.throws(() => checkVerification({ axis: 'realizable', status: 'falsified', probes: [probe('verified', [probe('falsified')])] }),
    /Probe \[0\] says verified, and its probes give falsified/);
  assert.doesNotThrow(() => checkVerification({ axis: 'realizable', status: 'falsified', probes: [probe('falsified', [probe('falsified'), probe('verified')]), probe('verified')] }));
  assert.doesNotThrow(() => checkVerification({ axis: 'parsimony', status: 'unknown', probes: [] }), 'a check with no probes states its status by the criterion');
  assert.throws(() => checkVerification({ axis: 'novelty', status: 'falsified', nearest: null, probes: [] }), /nearest incumbent/);
  assert.throws(() => checkVerification({ axis: 'expansive', status: 'verified', probes: [probe('verified')] }), /at least two domains/);
  assert.doesNotThrow(() => checkVerification({ axis: 'expansive', status: 'unknown', probes: [] }));
  assert.doesNotThrow(() => checkVerification({ axis: 'expansive', status: 'verified', probes: [probe('verified'), probe('falsified')] }));
  assert.doesNotThrow(() => checkVerification({ axis: 'expansive', status: 'verified', probes: [probe('verified')] }, 1), 'a deeper check inside one domain tries no new domains');
  assert.throws(() => checkVerification({ axis: 'expansive', status: 'verified', probes: [probe('verified'), probe('falsified')] }, 1), /give falsified/);
  let deep = probe('verified');
  for (let level = 0; level < 6; level += 1) deep = probe('verified', [deep]);
  assert.throws(() => checkVerification({ axis: 'parsimony', status: 'verified', probes: [deep] }), /at most 6 levels/);
});

test('deeper checks stand in for the probes they open, under the latest check of each axis', () => {
  const realizable = check('v.r', 'mech', 'realizable', 'unknown', [probe('verified'), probe('unknown')]);
  const opened = check('v.r.1', 'mech', 'realizable', 'verified', [probe('verified'), probe('verified')], { verificationNodeId: 'v.r', probePath: [1] });
  const others = ['parsimony', 'novelty'].map((axis) => check(`v.${axis}`, 'mech', axis, 'verified'));
  const expansive = check('v.e', 'mech', 'expansive', 'verified', [probe('verified'), probe('falsified')]);
  let search = { verifications: [...others, realizable, expansive, opened] };
  let result = pureResult(search, 'mech');
  assert.deepEqual(result.axes.realizable, { status: 'verified', stated: 'unknown', nodeId: 'v.r' });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.missing, []);

  // Expansive: a deeper look finds that the one carrying domain breaks after all, so the axis and PURE fail.
  const domain = check('v.e.0', 'mech', 'expansive', 'falsified', [probe('verified'), probe('falsified')], { verificationNodeId: 'v.e', probePath: [0] });
  search = { verifications: [...search.verifications, domain] };
  assert.equal(pureResult(search, 'mech').axes.expansive.status, 'falsified');
  assert.equal(pureResult(search, 'mech').status, 'falsified');
  // A check two levels down repairs the broken part, and the domain carries over again.
  const part = check('v.e.0.1', 'mech', 'expansive', 'verified', [probe('verified')], { verificationNodeId: 'v.e.0', probePath: [1] });
  search = { verifications: [...search.verifications, part] };
  assert.equal(pureResult(search, 'mech').axes.expansive.status, 'verified');

  // A new check of the whole axis supersedes the old one, and the deeper checks opened from the old one stop counting.
  const again = check('v.r.again', 'mech', 'realizable', 'unknown', [probe('unknown')]);
  search = { verifications: [...search.verifications, again] };
  result = pureResult(search, 'mech');
  assert.deepEqual(result.axes.realizable, { status: 'unknown', stated: 'unknown', nodeId: 'v.r.again' });
  assert.equal(result.status, 'unknown');

  // Non-compensation: a falsified axis is not offset by the others; a missing axis leaves the result unknown.
  const partial = { verifications: [check('n', 'other', 'novelty', 'falsified'), check('p', 'other', 'parsimony', 'verified')] };
  assert.equal(pureResult(partial, 'other').status, 'falsified');
  assert.deepEqual(pureResult(partial, 'other').missing, ['realizable', 'expansive']);
  assert.equal(pureResult({ verifications: [check('p', 'third', 'parsimony', 'verified')] }, 'third').status, 'unknown');
});

test('the verification summary names unchecked transfers and selections, depth and changed probes', () => {
  const search = {
    transfers: [{ nodeId: 'tr.checked' }, { nodeId: 'tr.open' }, { nodeId: 'tr.failed' }, { nodeId: 'tr.unchecked' }],
    selections: [{ data: { items: [{ nodeId: 'mech.chosen' }, { nodeId: 'tr.checked' }] } }],
    verifications: [
      ...['parsimony', 'novelty', 'realizable', 'expansive'].map((axis) => check(`c.${axis}`, 'tr.checked', axis, 'verified')),
      check('o.p', 'tr.open', 'parsimony', 'verified', [probe('verified')]),
      check('o.p.0', 'tr.open', 'parsimony', 'falsified', [probe('falsified')], { verificationNodeId: 'o.p', probePath: [0] }),
      check('o.p.0.0', 'tr.open', 'parsimony', 'falsified', [], { verificationNodeId: 'o.p.0', probePath: [0] }),
      check('f.n', 'tr.failed', 'novelty', 'falsified'),
    ],
  };
  const summary = verificationSummary(search);
  assert.deepEqual(summary.verified, ['tr.checked']);
  assert.deepEqual(summary.falsified, ['tr.open', 'tr.failed']);
  assert.deepEqual(summary.unverifiedTransfers, ['tr.unchecked'], 'a falsified candidate needs no further check to be set aside, an unchecked one does');
  assert.deepEqual(summary.unverifiedSelections, ['mech.chosen']);
  assert.deepEqual(summary.deepened, [{ subjectNodeId: 'tr.open', axis: 'parsimony', levels: 2 }]);
  assert.deepEqual(summary.changed, [{ verificationNodeId: 'o.p.0', deepens: 'o.p', subjectNodeId: 'tr.open', probePath: [0], axis: 'parsimony', probeStatus: 'verified', deeperStatus: 'falsified' }]);
});

test('changed probes describe only the refinements used by the current PURE result', () => {
  const old = check('r.old', 'mech', 'realizable', 'unknown', [probe('unknown')]);
  const stale = check('r.old.deep', 'mech', 'realizable', 'falsified', [], { verificationNodeId: old.nodeId, probePath: [0] });
  const current = check('r.current', 'mech', 'realizable', 'verified', [probe('verified')]);
  const summary = (verifications) => verificationSummary({ verifications, transfers: [], selections: [] });
  assert.deepEqual(summary([old, stale, current]).changed, [], 'a new whole-axis check supersedes the old refinements');

  const replacement = check('r.old.latest', 'mech', 'realizable', 'verified', [], { verificationNodeId: old.nodeId, probePath: [0] });
  assert.deepEqual(summary([old, stale, replacement]).changed, [{ verificationNodeId: replacement.nodeId, deepens: old.nodeId,
    subjectNodeId: 'mech', probePath: [0], axis: 'realizable', probeStatus: 'unknown', deeperStatus: 'verified' }],
  'only the latest check of the same probe changes the current result');

  const nested = check('r.nested', 'mech', 'realizable', 'unknown', [probe('unknown', [probe('unknown')])]);
  const oldPart = check('r.part', 'mech', 'realizable', 'falsified', [], { verificationNodeId: nested.nodeId, probePath: [0, 0] });
  const domain = check('r.domain', 'mech', 'realizable', 'verified', [probe('verified')], { verificationNodeId: nested.nodeId, probePath: [0] });
  let changed = summary([nested, oldPart, domain]).changed;
  assert.deepEqual(changed.map((item) => item.verificationNodeId), [domain.nodeId], 'replacing a parent probe supersedes its older parts');

  const newPart = check('r.domain.part', 'mech', 'realizable', 'falsified', [], { verificationNodeId: domain.nodeId, probePath: [0] });
  changed = summary([nested, oldPart, domain, newPart]).changed;
  assert.equal(changed.find((item) => item.verificationNodeId === domain.nodeId).deeperStatus, 'falsified',
    'an active refinement reports its effective finding after its own deeper checks');
  assert.equal(changed.some((item) => item.verificationNodeId === oldPart.nodeId), false);
  assert.equal(pureResult({ verifications: [nested, oldPart, domain, newPart] }, 'mech').axes.realizable.status, 'falsified');
});

// The workflow fixtures, as in alien-workflow-fixes.test.mjs.
const concept = (id, label = 'Pressure routing', operator = 'Pressure moves through a relay.') => ({ op: 'add_concept', concept: { id, label, operator } });
const candidate = (label) => ({ label, design_principles: 'Route to free capacity.', core_mechanism: 'A relay redirects pressure.',
  how_it_works: 'Measure capacity and route pressure.', what_is_new: 'Allocation travels with the signal.', why_it_works: 'A hypothesis to test.',
  why_it_fails: 'Signals can be stale.', medium_term: 'Test a small relay.', long_term_vision: 'Inspect repeated trials.' });
const mechanism = (label = 'Pressure relay', operator = 'A relay redirects pressure to the least loaded chamber.') => ({ operator,
  roles: [{ id: 'relay', description: 'routes pressure' }, { id: 'chamber', description: 'receives pressure' }],
  strangest: { element: 'Pressure seeks free capacity.', preserved: 'Routing responds to spare capacity.' }, candidate: candidate(label), isolation: { explorer: 'fresh_context' } });
const world = () => ({ title: 'Chambers', principle: 'Pressure travels.', text: 'R1: Pressure travels to a chamber with free capacity.',
  rules: [{ id: 'R1', statement: 'Pressure travels to a chamber with free capacity.' }], isolation: { builder: 'fresh_context' } });

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'alien-three-parts-test-'));
  const backend = new RustEngineProcess();
  backend.childEnvironment = { ...process.env };
  delete backend.childEnvironment.LIFE_SIM_STATE_FILE;
  const service = new LifeSimulationService({ backend });
  await service.initialize();
  const addon = new AlienAddon(service);
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, register] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const { modelHash } = await service.registerModel(register);
  const started = await addon.startSearch({ worldModelling: 'off', requestId: 'start', modelHash, graphId: 'graph.synthetic', searchId: 'search.synthetic', title: 'Shared capacity',
    problem: { statement: 'How can a workshop share equipment?', deriveTargetTerms: false, targetTerms: ['workshop'] }, authorId: 'tester', accessScopes: ['author'] });
  let graphHash = started.graphHash; let counter = 0; const heads = {};
  const base = () => ({ graphHash, searchRootId: 'search.synthetic', accessScopes: ['author'] });
  const advance = (result) => { graphHash = result.graphHash; return result; };
  return {
    addon, service, base,
    async task(role, inputs = {}) { return advance(await addon.task({ ...base(), requestId: `task.${++counter}`, role, inputs, authorId: 'tester' })); },
    async record(nodeId, kind, data, taskNodeId = null) { return advance(await addon.record({ ...base(), requestId: `record.${nodeId}`, nodeId, kind, data, taskNodeId, authorId: 'tester' })); },
    async revise(ontology, decision, operations = []) {
      const nodeId = `revision.${++counter}`;
      const result = await addon.reviseOntology({ ...base(), requestId: nodeId, nodeId, ontology, decision, operations, expectedHeadNodeId: heads[ontology] ?? null, authorId: 'tester' });
      heads[ontology] = nodeId;
      return advance(result);
    },
    async propose(nodeId, inputs = {}, label = undefined, operator = undefined) {
      const task = await this.task('explorer', inputs);
      await this.record(nodeId, 'mechanism', mechanism(label, operator), task.taskNodeId);
      return task;
    },
    async diagnosis() { return (await addon.diagnose(base())).diagnosis; },
  };
}

// A family carved under a lens before any candidate fills it: two empty kinds below family.first.
async function carved(run) {
  await run.propose('mechanism.first');
  await run.revise('mechanisms', { verdict: 'admit_new', subjectNodeId: 'mechanism.first', conceptId: 'family.first', fit: 'clear', rationale: 'First family.' }, [concept('family.first')]);
  await run.revise('mechanisms', { verdict: 'restructure_only', rationale: 'Carve how the pressure is moved, before anything fills the kinds.' }, [
    concept('family.first.buffer', 'Buffering', 'Pressure waits in a store until capacity frees.'),
    concept('family.first.auction', 'Bidding', 'Chambers bid for pressure with their spare capacity.'),
    { op: 'add_partition', partition: { id: 'cut.first.how', parentConceptId: 'family.first', childConceptIds: ['family.first.buffer', 'family.first.auction'], lens: 'How the pressure is moved' } },
  ]);
}

test('carved kinds no candidate realizes are named, and a commission forces an explorer into them', async (t) => {
  const run = await setup(t);
  await carved(run);
  let diagnosis = await run.diagnosis();
  assert.deepEqual(diagnosis.mechanisms.empty, ['family.first.auction', 'family.first.buffer']);
  assert.match(diagnosis.warnings.join('\n'), /Mechanism families no candidate realizes yet: family.first.auction, family.first.buffer\. Force one with a commission naming targetConceptIds, for an explorer\./);

  // Validation: an explorer fills mechanism families and claimed outcomes, a new world fills world regimes.
  await assert.rejects(run.record('commission.wrong', 'commission', { addressedTo: 'new_world', targetConceptIds: ['family.first.buffer'], rationale: 'r' }),
    /not an active world regime: a new world fills a regime/);
  await assert.rejects(run.record('commission.unknown', 'commission', { addressedTo: 'explorer', targetConceptIds: ['family.none'], rationale: 'r' }),
    /not an active mechanism family or claimed outcome/);
  const held = await run.record('commission.held', 'commission', { addressedTo: 'explorer', targetConceptIds: ['family.first'], rationale: 'Fill the parent.' });
  assert.match(held.warnings.join(' '), /family.first already holds candidates/);
  await run.record('commission.plain', 'commission', { addressedTo: 'explorer', relationToChange: 'Replace routing with storage.', rationale: 'No kinds named.' });
  const forced = await run.record('commission.buffer', 'commission', { addressedTo: 'explorer', targetConceptIds: ['family.first.buffer'], rationale: 'The buffering kind is empty.' });
  assert.deepEqual(forced.warnings, []);
  const search = await readSearch(run.service, run.base());
  assert.equal('targetConceptIds' in search.record('commission.plain').data, false, 'a commission without kinds stores no empty list');
  assert.deepEqual(search.record('commission.buffer').data.targetConceptIds, ['family.first.buffer']);

  const task = await run.task('explorer', { commissionNodeId: 'commission.buffer' });
  assert.match(task.text, /Commissioned kinds to fill:\n- Buffering \(mechanism family, no candidate yet\): Pressure waits in a store until capacity frees\./);
  assert.match(task.text, /Propose one candidate of one of the commissioned kinds, and say which kind\./);
  assert.deepEqual(task.material.targetConceptIds, ['family.first.buffer']);
  diagnosis = await run.diagnosis();
  assert.equal(diagnosis.forcing.find((item) => item.commissionNodeId === 'commission.buffer').status, 'open');

  await run.record('mechanism.buffer', 'mechanism', mechanism('Pressure store', 'A store holds pressure until a chamber frees.'), task.taskNodeId);
  diagnosis = await run.diagnosis();
  assert.equal(diagnosis.forcing.find((item) => item.commissionNodeId === 'commission.buffer').status, 'unclassified');
  await run.revise('mechanisms', { verdict: 'admit_instance', subjectNodeId: 'mechanism.buffer', conceptId: 'family.first.buffer', fit: 'clear', rationale: 'It buffers.' });
  diagnosis = await run.diagnosis();
  const filled = diagnosis.forcing.find((item) => item.commissionNodeId === 'commission.buffer');
  assert.equal(filled.status, 'filled');
  assert.deepEqual(filled.landed, [{ subjectNodeId: 'mechanism.buffer', targetConceptId: 'family.first.buffer', conceptId: 'family.first.buffer' }]);
  assert.deepEqual(diagnosis.mechanisms.empty, ['family.first.auction']);

  // A later task for a kind that has filled no longer calls it empty.
  const again = await run.task('explorer', { commissionNodeId: 'commission.buffer' });
  assert.match(again.text, /- Buffering \(mechanism family\): /);

  // Forced into one kind, placed in another: missed.
  await run.record('commission.auction', 'commission', { addressedTo: 'explorer', targetConceptIds: ['family.first.auction'], rationale: 'Bidding is empty.' });
  const auction = await run.task('explorer', { commissionNodeId: 'commission.auction' });
  await run.record('mechanism.not-auction', 'mechanism', mechanism('Another store', 'Pressure waits in a second store.'), auction.taskNodeId);
  await run.revise('mechanisms', { verdict: 'admit_instance', subjectNodeId: 'mechanism.not-auction', conceptId: 'family.first.buffer', fit: 'clear', rationale: 'It buffers too.' });
  diagnosis = await run.diagnosis();
  assert.equal(diagnosis.forcing.find((item) => item.commissionNodeId === 'commission.auction').status, 'missed');
  assert.match(diagnosis.warnings.join('\n'), /Commission commission.auction asked for family.first.auction; its answers were placed elsewhere/);
  const atlas = await run.addon.atlas(run.base());
  assert.match(atlas.markdown, /commission.auction \(explorer\): Bidding is empty\. Kinds to fill: family.first.auction\./);
});

test('an outcome target counts an answer as placed only once it is judged against the outcomes', async (t) => {
  const run = await setup(t);
  await carved(run);
  await run.revise('outcomes', { verdict: 'admit_new', subjectNodeId: 'mechanism.first', conceptId: 'outcome.steady', rationale: 'Steady supply.' }, [concept('outcome.steady', 'Steady supply', 'Supply stays even.')]);
  await run.revise('outcomes', { verdict: 'restructure_only', rationale: 'An outcome nobody claims yet.' }, [concept('outcome.quiet', 'Quiet sharing', 'Sharing happens without negotiation.')]);
  assert.deepEqual((await run.diagnosis()).outcomes.empty, ['outcome.quiet']);
  await run.record('commission.quiet', 'commission', { addressedTo: 'explorer', targetConceptIds: ['outcome.quiet'], rationale: 'No candidate claims quiet sharing.' });
  const task = await run.task('explorer', { commissionNodeId: 'commission.quiet' });
  assert.match(task.text, /- Quiet sharing \(claimed outcome, no candidate yet\): Sharing happens without negotiation\./);
  await run.record('mechanism.quiet', 'mechanism', mechanism('Silent pool', 'A shared pool releases pressure without requests.'), task.taskNodeId);
  await run.revise('mechanisms', { verdict: 'admit_instance', subjectNodeId: 'mechanism.quiet', conceptId: 'family.first', fit: 'partial', rationale: 'A routing variant.' });
  assert.equal((await run.diagnosis()).forcing[0].status, 'unclassified', 'placed among the families, not yet judged against the outcomes');
  await run.revise('outcomes', { verdict: 'admit_instance', subjectNodeId: 'mechanism.quiet', conceptId: 'outcome.quiet', rationale: 'It claims quiet sharing.' });
  assert.equal((await run.diagnosis()).forcing[0].status, 'filled');
});

test('a new-world commission forces a world regime, and the regime text is checked for target terms', async (t) => {
  const run = await setup(t);
  await carved(run);
  const builder = await run.task('builder');
  await run.record('world.one', 'world', world(), builder.taskNodeId);
  await run.revise('worlds', { verdict: 'admit_new', subjectNodeId: 'world.one', conceptId: 'regime.one', rationale: 'First regime.' }, [concept('regime.one')]);
  await run.revise('worlds', { verdict: 'restructure_only', rationale: 'Two regimes no world has.' }, [
    concept('regime.still', 'Stillness', 'Nothing moves unless it is asked to.'), concept('regime.shared', 'Workshop law', 'Every tool belongs to whoever holds it.')]);
  assert.deepEqual((await run.diagnosis()).worlds.empty, ['regime.shared', 'regime.still']);
  await assert.rejects(run.record('commission.family', 'commission', { addressedTo: 'new_world', targetConceptIds: ['family.first.buffer'], rationale: 'r' }), /not an active world regime/);
  await run.record('commission.still', 'commission', { addressedTo: 'new_world', targetConceptIds: ['regime.still'], rationale: 'No world is still.' });
  const still = await run.task('builder', { commissionNodeId: 'commission.still' });
  assert.match(still.text, /The world should be of one of these kinds:\n- Stillness \(world regime, no world yet\): Nothing moves unless it is asked to\./);
  assert.equal(still.targetBlind, true);
  assert.deepEqual(still.material.targetConceptIds, ['regime.still']);
  await run.record('world.still', 'world', world(), still.taskNodeId);
  await run.revise('worlds', { verdict: 'admit_instance', subjectNodeId: 'world.still', conceptId: 'regime.still', rationale: 'It is still.' });
  assert.equal((await run.diagnosis()).forcing.find((item) => item.commissionNodeId === 'commission.still').status, 'filled');

  const leaky = await run.record('commission.shared', 'commission', { addressedTo: 'new_world', targetConceptIds: ['regime.shared'], rationale: 'No world shares tools.' });
  assert.match(leaky.warnings.join(' '), /The world ask or the kinds to fill uses target terms \(workshop\)/);
  const shared = await run.task('builder', { commissionNodeId: 'commission.shared' });
  assert.equal(shared.targetBlind, false);
  assert.deepEqual(shared.targetLeaks, ['workshop']);
});

test('verifier tasks judge one axis in isolation and open probes as deeper checks', async (t) => {
  const run = await setup(t);
  await carved(run);
  await run.propose('mechanism.second', {}, 'Pressure ledger', 'A ledger moves pressure claims instead of pressure.');
  const transferTask = await run.task('transfer', { mechanismNodeId: 'mechanism.second' });
  await run.record('transfer.second', 'transfer', { mechanismNodeId: 'mechanism.second',
    roleMap: [{ roleId: 'relay', binding: { kind: 'model', ref: 'referent:referent.bakery', how: 'the bakery passes claims on' } },
      { roleId: 'chamber', binding: { kind: 'new_component', description: 'a shelf that receives claims' } }],
    disanalogies: ['Claims are not pressure.'], candidate: candidate('Claim ledger'), evidenceNeeded: ['Whether neighbours honour claims.'] }, transferTask.taskNodeId);

  // Novelty compares with what the search found before the candidate: never itself, nor the mechanism a transfer carries.
  const second = await run.task('verifier', { subjectNodeId: 'mechanism.second', axis: 'novelty' });
  assert.match(second.text, /CANDIDATES THIS SEARCH FOUND BEFORE THIS ONE:\n- Pressure relay \[mechanism.first\]: A relay redirects pressure/);
  assert.doesNotMatch(second.text, /- Pressure ledger \[mechanism.second\]/);
  assert.deepEqual(second.material.earlierNodeIds, ['mechanism.first']);
  const first = await run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'novelty' });
  assert.doesNotMatch(first.text, /FOUND BEFORE THIS ONE/);
  const transferNovelty = await run.task('verifier', { subjectNodeId: 'transfer.second', axis: 'novelty' });
  assert.match(transferNovelty.text, /CANDIDATES THIS SEARCH FOUND BEFORE THIS ONE:\n- Pressure relay \[mechanism.first\]/);
  assert.doesNotMatch(transferNovelty.text, /\[mechanism.second\]/);
  assert.match(transferNovelty.text, /role relay: referent:referent.bakery \(the bakery passes claims on\)/);

  const parsimony = await run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'parsimony' });
  for (const pattern of [/one axis of a viability check, Parsimony/, /QUESTION: Does the simplest form/, /PROBES: one probe per part or set of parts removed/,
    /THE STATUS FOLLOWS FROM THE PROBES: verified when every probe is verified/, /marginal-value rule/, /Cards: PURECheck#574b, PURE#b65a, Parsimony#4df8, FractalIntelligence#1dca, MarginalValueRule#6611; the candidate follows MechanisticDesignProposal#930a\./]) {
    assert.match(parsimony.text, pattern);
  }
  assert.doesNotMatch(parsimony.text, /Novelty|Realizable|Expansive/, 'a verifier sees only its own axis');
  assert.match(parsimony.isolationGuidance, /no verifier sees another axis's verdict/);
  await assert.rejects(run.task('verifier', { subjectNodeId: 'world.none', axis: 'parsimony' }), /not a record/);

  // Records: the task binds subject and axis; the probes decide the status.
  const verify = async (nodeId, task, data) => run.record(nodeId, 'verification', { subjectNodeId: task.inputs.subjectNodeId, axis: task.inputs.axis, reason: 'Worked through the probes.',
    isolation: { verifier: 'fresh_context' }, ...data }, task.taskNodeId);
  await assert.rejects(run.record('v.wrong', 'verification', { subjectNodeId: 'mechanism.first', axis: 'novelty', status: 'unknown', reason: 'r', isolation: { verifier: 'fresh_context' } }, parsimony.taskNodeId),
    /checks mechanism.first on parsimony, not mechanism.first on novelty/);
  await assert.rejects(verify('v.bad', parsimony, { status: 'unknown', probes: [probe('verified'), probe('verified')] }), /Parsimony follows from its probes/);
  const recorded = await verify('v.parsimony', parsimony, { status: 'verified', probes: [probe('verified', [], 'Remove the relay'), probe('verified', [], 'Remove the chamber')] });
  assert.match(recorded.nextStep, /PURE so far for mechanism.first: unknown\. Still to check, each in its own context: novelty, realizable, expansive\./);
  await assert.rejects(verify('v.novelty.bad', first, { status: 'falsified' }), /nearest incumbent/);
  await verify('v.novelty', first, { status: 'verified', probes: [probe('verified', [], 'Against shared tool libraries')] });
  const realizable = await run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'realizable' });
  await verify('v.realizable', realizable, { status: 'unknown', probes: [probe('verified', [], 'A relay valve'), probe('unknown', [], 'A live capacity signal')] });
  const expansive = await run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'expansive' });
  const stated = await verify('v.expansive', expansive, { status: 'verified', probes: [probe('verified', [], 'Hospital beds'), probe('falsified', [], 'Choir parts')] });
  assert.match(stated.nextStep, /PURE for mechanism.first: unknown\./);

  // Fractal Intelligence: open the uncertain probe as its own check; its finding composes into the axis.
  await assert.rejects(run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'realizable', deepen: { verificationNodeId: 'v.realizable', probePath: [5] } }), /has no probe at \[5\]/);
  await assert.rejects(run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'novelty', deepen: { verificationNodeId: 'v.realizable', probePath: [1] } }), /keeps its subject and axis/);
  const deeper = await run.task('verifier', { subjectNodeId: 'mechanism.first', axis: 'realizable', deepen: { verificationNodeId: 'v.realizable', probePath: [1] } });
  assert.match(deeper.text, /THE PROBE TO OPEN, on its own: A live capacity signal\nJudge this probe only\. Your status stands in for it in the check it came from\./);
  assert.match(deeper.text, /PROBES: the parts of the probe you are opening/);
  const deepened = await verify('v.realizable.1', deeper, { status: 'verified', probes: [probe('verified', [], 'A pressure gauge'), probe('verified', [], 'A wire to the relay')] });
  assert.match(deepened.nextStep, /PURE for mechanism.first: verified\./);
  const search = await readSearch(run.service, run.base());
  assert.deepEqual(search.record('v.realizable.1').data.deepens, { verificationNodeId: 'v.realizable', probePath: [1] });
  assert.deepEqual(search.record('v.realizable.1').data.cards, ['PURECheck#574b', 'PURE#b65a', 'Realizable#2ed7', 'FractalIntelligence#1dca', 'MarginalValueRule#6611']);
  assert.deepEqual(pureResult(search, 'mechanism.first').axes.realizable, { status: 'verified', stated: 'unknown', nodeId: 'v.realizable' });

  const diagnosis = await run.diagnosis();
  assert.deepEqual(diagnosis.verification.verified, ['mechanism.first']);
  assert.deepEqual(diagnosis.verification.unverifiedTransfers, ['transfer.second']);
  assert.deepEqual(diagnosis.verification.changed.map((item) => [item.verificationNodeId, item.probeStatus, item.deeperStatus]), [['v.realizable.1', 'unknown', 'verified']]);
  assert.match(diagnosis.warnings.join('\n'), /Transfers without a full PURE check: transfer.second/);
  assert.match(diagnosis.warnings.join('\n'), /A deeper realizable check \(v.realizable.1\) found verified where v.realizable said unknown at probe \[1\]; the axis now composes from the deeper finding\./);
  const atlas = await run.addon.atlas(run.base());
  assert.match(atlas.markdown, /## Verification \(PURE and Fractal Intelligence\)/);
  assert.match(atlas.markdown, /PURE: verified; parsimony verified, novelty verified, realizable verified \(stated unknown, changed by deeper checks\), expansive verified\./);
  assert.match(atlas.markdown, /- realizable \(deeper, from v.realizable probe \[1\]\): verified\./);
  assert.match(atlas.markdown, /\n  - A wire to the relay: verified\./);
});

test('transfer novelty compares candidates recorded before the transfer, excluding its source and later candidates', async (t) => {
  const run = await setup(t);
  await run.propose('mechanism.source', {}, 'Source relay');
  await run.propose('mechanism.other', {}, 'Competing ledger', 'Claims move through a ledger.');
  const transfer = async (nodeId, mechanismNodeId, label) => {
    const task = await run.task('transfer', { mechanismNodeId });
    await run.record(nodeId, 'transfer', { mechanismNodeId,
      roleMap: [{ roleId: 'relay', binding: { kind: 'model', ref: 'referent:referent.bakery', how: 'passes claims on' } },
        { roleId: 'chamber', binding: { kind: 'new_component', description: 'a receiving shelf' } }],
      disanalogies: ['Claims are not pressure.'], candidate: { ...candidate(label), core_mechanism: 'A shelf holds shared claims.' },
      evidenceNeeded: ['Whether claims are honoured.'] }, task.taskNodeId);
  };
  await transfer('transfer.other', 'mechanism.other', 'Competing shelf');
  await transfer('transfer.subject', 'mechanism.source', 'Transferred relay');
  await run.propose('mechanism.later', {}, 'Later duplicate');
  await transfer('transfer.later', 'mechanism.other', 'Later shelf');

  const task = await run.task('verifier', { subjectNodeId: 'transfer.subject', axis: 'novelty' });
  assert.deepEqual(task.material.earlierNodeIds, ['mechanism.other', 'transfer.other']);
  assert.match(task.text, /- Competing ledger \[mechanism.other\]: Claims move through a ledger\./);
  assert.match(task.text, /- Competing shelf \[transfer.other\]: A shelf holds shared claims\./);
  assert.doesNotMatch(task.text, /\[(mechanism.source|mechanism.later|transfer.later)\]/);
  const first = await run.task('verifier', { subjectNodeId: 'mechanism.source', axis: 'novelty' });
  assert.deepEqual(first.material.earlierNodeIds, [], 'later transfers cannot make the original mechanism unoriginal');
  const later = await run.task('verifier', { subjectNodeId: 'mechanism.later', axis: 'novelty' });
  assert.deepEqual(later.material.earlierNodeIds, ['mechanism.source', 'mechanism.other', 'transfer.other', 'transfer.subject']);
});
