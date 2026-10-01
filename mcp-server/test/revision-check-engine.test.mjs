// Numbers on a defined scale, on the real engine. A process's state is its own record; claims are attributed accounts
// of its value. The revision check and the state a scene is written from keep the two apart.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { checkRevision } from '../src/revision-check.mjs';
import { personStateAt } from '../src/model-questions.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';

const scopes = ['author'];
const provenance = ['revision-check engine test'];
const rubric = JSON.stringify({ type: 'score', instructions: 'How tired is Ada at this moment?', unit: 'fatigue',
  levels: [{ description: 'Rested', value: 0 }, { description: 'Spent, close to collapse', value: 4 }] });
const fatigue = (initial) => ({ id: 'ada.fatigue', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 4 } }, initial_value: { kind: 'scalar', value: initial },
  unit: 'fatigue rating 0-4', update_mode: 'static', scale: { semantic_role: 'fatigue', subject_referent_id: 'referent.ada', authored_judgment_question: rubric },
  support: ['authored'], uncertainty: { kind: 'unknown' }, axes: [], access_scopes: [], provenance });
const account = (id, holder, value, at, cutoff, evidenceType) => ({ id, subject: 'ada.fatigue', value: { kind: 'scalar', value }, uncertainty: { kind: 'exact' },
  evidence_type: evidenceType, holder, evidence_cutoff: cutoff, value_time: at, provenance, authority: { source: holder, weight: 1 } });

// The minimal example, with Ada's fatigue on a 0-4 scale, the double shift she closed the night before the story begins,
// the shift she later accepts, and the bakery's owner. Accounts in a model rest on evidence from before genesis (time 0),
// and none is about a time after its own evidence, so Ada's report and the owner's view are about that night.
async function setup(t) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const base = structuredClone(registerRequest.model);
  const mm = base.meaning_model;
  const person = (id, boundary) => ({ ...structuredClone(mm.referents.find((item) => item.id === 'referent.bakery')), id, boundary, continuity_criterion: 'Same living person', lifecycle_event_id: null });
  mm.referents.push(person('referent.owner', 'The bakery\'s owner, Ada\'s employer'), person('referent.bob', 'Bob, who bakes the night shift with Ada'));
  const h06 = mm.events.find((item) => item.id === 'event.ada.state.h06');
  mm.events.push({ ...structuredClone(h06), id: 'event.ada.night', boundary: 'Ada closes the bakery after a double shift.', description: 'The night before, Ada closes alone after two shifts.', interval: { start: -3, end: -1 } },
    { ...structuredClone(h06), id: 'event.bob.night', boundary: 'Bob sleeps through the night before.', description: 'Bob is off that night and sleeps at home.', interval: { start: -3, end: -1 }, participants: { subject: 'referent.bob' } },
    { ...structuredClone(h06), id: 'event.ada.shift', boundary: 'Ada accepts the night shift.', description: 'At hour eight Ada tells the owner she will take the night shift.', interval: { start: 8, end: 9 } });
  const relation = mm.event_relations.find((item) => item.target_event_id === 'event.ada.state.h06');
  mm.event_relations.push({ ...structuredClone(relation), id: 'h06.causes.shift', kind: 'causes', source_event_id: 'event.ada.state.h06', target_event_id: 'event.ada.shift', description: 'How she reads the offer leads to the shift.' },
    { ...structuredClone(relation), id: 'ada.life.contains.night', source_event_id: 'event.ada.life', target_event_id: 'event.ada.night', description: 'The double shift is part of Ada\'s life.' },
    { ...structuredClone(relation), id: 'world.contains.bob.night', source_event_id: 'event.world', target_event_id: 'event.bob.night', description: 'Bob\'s night is part of the world.' },
    { ...structuredClone(relation), id: 'ada.life.contains.shift', source_event_id: 'event.ada.life', target_event_id: 'event.ada.shift', description: 'The shift is part of Ada\'s life.' });
  base.processes.push(fatigue(3), { ...fatigue(1), id: 'bob.fatigue', scale: { ...fatigue(1).scale, subject_referent_id: 'referent.bob' } });
  base.initial_claims = [account('claim.ada.fatigue.report', 'referent.ada', 3, -2, -2, 'report')];
  const registered = await service.registerModel({ requestId: 'model-0', model: base });
  const graph = structuredClone(graphRequest.narrativeGraph);
  graph.source.model_hash = registered.modelHash;
  const passage = (id, eventId, order, text) => {
    graph.nodes.push({ id, node_type: 'passage', role: 'story_passage', text, render: 'include', training: 'exclude', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon',
      authority: { source: 'example-author', weight: 1 }, provenance });
    graph.edges.push({ id: `story.contains.${id}`, source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: id }, family: 'structural', relation: 'contains', order, provenance },
      { id: `${id}.renders`, source: { kind: 'node', node_id: id }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: eventId }, family: 'grounding', relation: 'renders', provenance });
  };
  passage('passage.night', 'event.ada.night', 0, 'She locks up after the second shift and sits on the step.');
  passage('passage.h06', 'event.ada.state.h06', 1, 'Ada reads the offer twice, too tired to feel much about the loan.');
  passage('passage.shift', 'event.ada.shift', 2, 'At eight she says yes to the night shift.');
  passage('passage.bob', 'event.bob.night', 3, 'Bob slept through it, rested for once.');
  graph.nodes = graph.nodes.map((node) => ({ ...node, access_scopes: scopes }));
  graph.edges = graph.edges.map((edge) => ({ ...edge, access_scopes: scopes }));
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graph });
  let model = base, modelHash = registered.modelHash, graphHash = stored.graphHash, number = 0;
  // Each revision is registered as a successor and the graph follows it, as in ordinary work.
  const revise = async (change, reason) => {
    const successor = structuredClone(model);
    change(successor);
    number += 1;
    successor.revision = { number, previous_model_hash: modelHash, reason, provenance };
    const revised = await service.reviseModel({ requestId: `model-${number}`, previousModelHash: modelHash, model: successor });
    const rebound = await rebindNarrativeGraph(service, { requestId: `rebind-${number}`, graphHash, modelHash: revised.modelHash, accessScopes: scopes, reason });
    const check = await checkRevision(service, { graphHash: rebound.graphHash, fromModelHash: modelHash, accessScopes: scopes });
    model = successor; modelHash = revised.modelHash; graphHash = rebound.graphHash;
    return check;
  };
  return { service, revise, definition: async () => (await service.inspectModel({ modelHash, includeDefinition: true })).model };
}

test('a changed process state reaches its subject\'s scenes, though an earlier account of the old value remains', async (t) => {
  const { revise } = await setup(t);
  // Ada's state is revised from 3 to 1; her report of 3 about the night stays as what she said.
  const check = await revise((model) => { model.processes.find((item) => item.id === 'ada.fatigue').initial_value = { kind: 'scalar', value: 1 }; }, 'Ada is rested.');
  assert.deepEqual(check.changed.processStates, ['ada.fatigue']);
  assert.deepEqual(check.changed.accounts, [], 'the retained report is not a changed account');
  const restated = Object.fromEntries(check.changed.stateChanged.map(({ eventId, by }) => [eventId, by]));
  for (const eventId of ['event.ada.night', 'event.ada.state.h06', 'event.ada.shift', 'event.offer']) assert.deepEqual(restated[eventId], ['process:ada.fatigue'], eventId);
  assert.deepEqual(check.passages.map(({ nodeId }) => nodeId).sort(), ['passage.h06', 'passage.night', 'passage.shift']);
  for (const passage of check.passages) assert.match(passage.why, /renders an Event whose modeled state changed \(the declared state of process ada\.fatigue changed\)/);
  assert.ok(check.later.some(({ eventId, from }) => eventId === 'event.ada.shift' && from === 'event.ada.state.h06'));
});

test('a changed account reaches the Events at the moment it is about, and is not called a change of state', async (t) => {
  const { revise } = await setup(t);
  const check = await revise((model) => { model.initial_claims[0].value = { kind: 'scalar', value: 2 }; }, 'Ada reported 2, not 3.');
  assert.deepEqual(check.changed.processStates, []);
  assert.deepEqual(check.changed.accounts, [{ claimId: 'claim.ada.fatigue.report', processId: 'ada.fatigue', holder: 'referent.ada', at: -2, change: 'changed' }]);
  assert.deepEqual(check.changed.stateChanged.map(({ eventId }) => eventId), ['event.ada.night']);
  assert.deepEqual(check.passages.map(({ nodeId }) => nodeId), ['passage.night'], 'scenes at other moments are not what the account is about');
  assert.match(check.passages[0].why, /renders an Event about which an account changed \(an account of process ada\.fatigue at -2, held by referent\.ada, was changed\)/);
});

test('an account corrected to concern another process leaves the old subject\'s scenes to review as well as reaching the new', async (t) => {
  const { revise } = await setup(t);
  // The report was about Bob's fatigue all along, not Ada's.
  const check = await revise((model) => { model.initial_claims[0].subject = 'bob.fatigue'; }, 'The report concerned Bob.');
  assert.deepEqual(check.changed.accounts, [{ claimId: 'claim.ada.fatigue.report', processId: 'bob.fatigue', formerProcessId: 'ada.fatigue', holder: 'referent.ada', at: -2, change: 'changed' }]);
  assert.deepEqual(check.changed.stateChanged.map(({ eventId, by }) => [eventId, by]).sort(),
    [['event.ada.night', ['claim:claim.ada.fatigue.report']], ['event.bob.night', ['claim:claim.ada.fatigue.report']]]);
  const why = Object.fromEntries(check.passages.map(({ nodeId, why: text }) => [nodeId, text]));
  assert.deepEqual(Object.keys(why).sort(), ['passage.bob', 'passage.night']);
  assert.match(why['passage.night'], /an account of process ada\.fatigue at -2, held by referent\.ada, now concerns process bob\.fatigue/);
  assert.match(why['passage.bob'], /an account of process bob\.fatigue at -2, held by referent\.ada, was changed/);
});

test('the state a scene is written from keeps the process state and each account apart, known only once its evidence is', async (t) => {
  const { revise, definition } = await setup(t);
  await revise((model) => {
    model.processes.find((item) => item.id === 'ada.fatigue').initial_value = { kind: 'scalar', value: 1 };
    model.initial_claims[0].value = { kind: 'scalar', value: 1 };
    // Later, from evidence up to time -1, the owner comes to believe she was at 4 that night.
    model.initial_claims.push(account('claim.owner.fatigue.belief', 'referent.owner', 4, -2, -1, 'belief'));
  }, 'Ada reports 1; the owner later believes 4.');
  const model = await definition();
  const valuesAt = (time) => Object.fromEntries((personStateAt(model, 'referent.ada', time).values ?? []).map((item) => [item.processId, item]));
  const between = valuesAt(-1.5);
  assert.deepEqual(between['ada.fatigue'].state, { initialValue: 1, updateMode: 'static' });
  assert.deepEqual(between['ada.fatigue'].rubric.levels, [{ value: 0, description: 'Rested' }, { value: 4, description: 'Spent, close to collapse' }]);
  assert.deepEqual(between['ada.fatigue'].accounts, [{ holder: 'referent.ada', value: 1, at: -2, evidenceType: 'report', evidenceCutoff: -2, uncertainty: { kind: 'exact' } }],
    'the owner\'s belief rests on later evidence and is not yet known');
  const offer = valuesAt(6.5);
  assert.deepEqual(offer['ada.fatigue'].accounts.map(({ holder, value, evidenceType }) => ({ holder, value, evidenceType })),
    [{ holder: 'referent.ada', value: 1, evidenceType: 'report' }, { holder: 'referent.owner', value: 4, evidenceType: 'belief' }], 'competing accounts stay distinguishable');
  assert.deepEqual(offer['ada.fatigue'].state.initialValue, 1, 'no account overrides the state');
  // A process with an initial value and no accounts is part of the state too: the bakery's debt, carried by the offer.
  assert.deepEqual(offer['bakery.debt_nok'].state.initialValue, 1650000);
  assert.deepEqual(offer['bakery.debt_nok'].accounts, []);
  assert.equal(valuesAt(8.5)['bakery.debt_nok'], undefined, 'the offer is over by hour eight');
});
