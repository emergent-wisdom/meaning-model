import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { replayConstruction } from '../src/construction-record.mjs';
import { listSavedWork } from '../src/saved-work.mjs';
import { readOpenQuestions } from '../src/model-questions.mjs';
import { memoryStartSchema, memoryRecordSchema, memoryQuerySchema, queryMemory, recordMemory, registerMemoryTools, startMemory } from '../src/memory-workflow.mjs';

const accessScopes = ['memory:alex:project'];
const declaration = { requestId: 'start', contextId: 'alex-project', title: 'Alex’s research work',
  scope: 'The delegated research project, its goals, decisions, attempts and relevant stated preferences.',
  purpose: 'user_memory', subjects: ['user:alex', 'agent:researcher'], holder: 'agent:researcher', accessScopes,
  time: { unit: 'day', origin: '2026-10-02T00:00:00Z is modeled day zero; unknown periods remain unknown.' } };
async function sessions(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-memory-'));
  const services = [];
  t.after(async () => { await Promise.all(services.map((service) => service.close())); await rm(directory, { recursive: true, force: true }); });
  const start = async (persistent = true) => {
    const backend = new RustEngineProcess();
    backend.childEnvironment = { ...process.env };
    delete backend.childEnvironment.LIFE_SIM_STATE_FILE;
    if (persistent) backend.childEnvironment.LIFE_SIM_STATE_FILE = join(directory, 'memory.sqlite');
    const service = new LifeSimulationService({ backend }); services.push(service); await service.initialize(); return service;
  };
  return { start };
}
const preference = (started, nodeId = 'preference.short') => ({ requestId: 'remember-short', contextId: declaration.contextId,
  graphHash: started.graphHash, accessScopes, holder: 'user:alex', recordedBy: 'agent:researcher', entries: [{
    nodeId, subject: 'user:alex', kind: 'report', text: 'Alex asks for short progress updates.', topic: 'communication',
    about: started.nativeTargets, evidenceType: 'report', source: { citation: 'Alex, project conversation, 2 October 2026', reportsOn: 'This research project' },
    uncertainty: { kind: 'unknown' }, observedAt: '2026-10-02T10:00:00Z', validFrom: '2026-10-02T10:00:00Z',
  }] });
const query = (extra = {}) => ({ contextId: declaration.contextId, accessScopes, ...extra });

test('memory starts a native qualitative context and preserves attribution, source and separate clocks', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const started = await startMemory(service, declaration);
  assert.equal(started.scaffoldOnly, true); assert.equal(started.modelCompleteness, 'not assessed');
  assert.equal(started.persistence.durable, true);
  assert.match(started.instructions, /continuing process model/); assert.match(started.instructions, /hypotheses/);
  const { model } = await service.inspectModel({ modelHash: started.modelHash, includeDefinition: true });
  assert.equal(model.processes.length, 1); assert.equal(model.processes[0].value_type.kind, 'category');
  assert.equal(model.time_unit, 'day'); assert.equal(started.modelTime.unit, 'day'); assert.equal(started.modelTime.origin, declaration.time.origin);
  assert.equal(model.meaning_model.events.length, 1); assert.match(model.meaning_model.events[0].description, /not a developed life or workflow/);
  assert.deepEqual(model.meaning_model.referents, []); assert.deepEqual(model.laws, []);
  assert.deepEqual((await queryMemory(service, query())).entries, []);
  const recorded = await recordMemory(service, preference(started));
  assert.notEqual(recorded.graphHash, started.graphHash);
  const [entry] = (await queryMemory(service, query())).entries;
  assert.equal(entry.subject, 'user:alex'); assert.equal(entry.holder, 'user:alex'); assert.equal(entry.recordedBy, 'agent:researcher');
  assert.equal(entry.source.reportsOn, 'This research project'); assert.equal(entry.observedAt, '2026-10-02T10:00:00Z');
  assert.equal(entry.authoringStep, 0); assert.equal(entry.evidenceType, 'report'); assert.deepEqual(entry.uncertainty, { kind: 'unknown' });
  assert.equal(entry.links.filter((link) => link.target.kind === 'anchor').length, 2);
  assert.deepEqual((await queryMemory(service, query({ graphHash: started.graphHash }))).entries, [], 'immutable predecessor has no later account');
  const reopened = await startMemory(service, declaration);
  assert.equal(reopened.graphHash, recorded.graphHash); assert.equal(reopened.graphMutation, false);
  const catalog = await listSavedWork(service, { accessScopes });
  assert.equal(catalog.heads[0].graphHash, recorded.graphHash);
  assert.deepEqual((await listSavedWork(service, {})).heads, []);
  const ephemeral = await start(false);
  const transient = await startMemory(ephemeral, declaration);
  assert.equal(transient.persistence.durable, false); assert.match(transient.persistence.warning, /Do not promise memory across restart/);
});

test('real restart discovers memory and reconciles stable IDs without duplicating or overwriting accounts', async (t) => {
  const { start } = await sessions(t); const first = await start();
  const started = await startMemory(first, declaration); const input = preference(started);
  const recorded = await recordMemory(first, input); await first.close();
  const later = await start();
  assert.equal(later.models.size, 0, 'a new service does not recover its process-local summary cache');
  const recovered = await queryMemory(later, query());
  assert.equal(recovered.graphHash, recorded.graphHash); assert.equal(recovered.entries.length, 1);
  const retry = await recordMemory(later, input);
  assert.equal(retry.graphHash, recorded.graphHash); assert.equal(retry.graphMutation, false); assert.equal(retry.reusedExisting, true);
  const changed = structuredClone(input); changed.entries[0].text = 'A different account.';
  await assert.rejects(recordMemory(later, changed), /different recorded payload/);
  const reusedId = structuredClone(changed); reusedId.requestId = 'different-request';
  await assert.rejects(recordMemory(later, reusedId), /already exists with another account/);
  const changedIds = structuredClone(input); changedIds.entries[0].nodeId = 'different-node';
  await assert.rejects(recordMemory(later, changedIds), /different recorded payload/);
  assert.equal((await queryMemory(later, query())).entries.length, 1);
  const reopened = await startMemory(later, declaration);
  assert.equal(reopened.graphHash, recorded.graphHash);
});

test('explicit supersession preserves old accounts while disagreement and real changes remain separate', async (t) => {
  const { start } = await sessions(t); const service = await start(); const started = await startMemory(service, declaration);
  const first = await recordMemory(service, preference(started));
  const correction = preference(started, 'preference.corrected'); correction.requestId = 'correct-short'; correction.graphHash = first.graphHash;
  correction.entries[0].text = 'Alex asks for short progress updates, with detailed evidence in the final report.';
  correction.entries[0].links = [{ relation: 'supersedes', targetNodeId: 'preference.short' }];
  const second = await recordMemory(service, correction);
  const interpretation = { requestId: 'interpret', contextId: declaration.contextId, graphHash: second.graphHash,
    accessScopes, holder: 'agent:researcher', recordedBy: 'agent:researcher', entries: [{ nodeId: 'interpretation.detail',
      subject: 'user:alex', kind: 'hypothesis', text: 'Perhaps Alex wants terse final reports too; this conflicts with the stated preference.',
      about: started.nativeTargets, links: [{ relation: 'contradicts', targetNodeId: 'preference.corrected' }], evidenceType: 'belief' }] };
  const third = await recordMemory(service, interpretation);
  const current = await queryMemory(service, query());
  assert.deepEqual(new Set(current.entries.map((entry) => entry.nodeId)), new Set(['preference.corrected', 'interpretation.detail']));
  const all = await queryMemory(service, query({ includeSuperseded: true }));
  assert.deepEqual(all.entries.find((entry) => entry.nodeId === 'preference.short').supersededBy, ['preference.corrected']);
  assert.equal(all.entries.find((entry) => entry.nodeId === 'interpretation.detail').holder, 'agent:researcher');
  assert.deepEqual((await queryMemory(service, query({ graphHash: first.graphHash }))).entries.map((entry) => entry.nodeId), ['preference.short']);
  const page = await queryMemory(service, query({ limit: 1 })); assert.equal(page.window.nextOffset, 1);
  assert.equal((await queryMemory(service, query({ offset: 1, limit: 1 }))).window.nextOffset, null);
  assert.equal((await queryMemory(service, query({ subject: 'user:alex', holder: 'user:alex', topic: 'communication', search: 'detailed' }))).entries[0].nodeId, 'preference.corrected');
  const invalid = structuredClone(interpretation); invalid.requestId = 'wrong-subject'; invalid.graphHash = third.graphHash;
  invalid.entries[0].nodeId = 'cross-subject'; invalid.entries[0].subject = 'agent:researcher';
  invalid.entries[0].links = [{ relation: 'supersedes', targetNodeId: 'preference.corrected' }];
  await assert.rejects(recordMemory(service, invalid), /same subject/);
  invalid.entries[0].subject = 'user:alex';
  await assert.rejects(recordMemory(service, invalid), /same holder/);
  const rawLink = await service.applyNarrativeBatch({ requestId: 'foreign-supersedes', previousGraphHash: third.graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: third.graphHash,
      reason: 'Exercise a foreign-holder link written through the generic graph API.', provenance: ['test'], add_roots: [], add_nodes: [],
      add_edges: [{ id: 'foreign.supersedes', source: { kind: 'node', node_id: 'interpretation.detail' }, target: { kind: 'node', node_id: 'preference.corrected' },
        family: 'semantic', relation: 'supersedes', access_scopes: accessScopes, provenance: ['test'] }] } });
  assert.deepEqual((await queryMemory(service, query({ graphHash: rawLink.graphHash, holder: 'user:alex' }))).entries.map((entry) => entry.nodeId), ['preference.corrected']);
  assert.equal((await queryMemory(service, query())).entries.length, 2, 'a foreign-holder supersedes link does not suppress a competing account');
});

test('chosen scopes are OR alternatives and writes cannot broaden the context or invent a new subject', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const config = { ...declaration, accessScopes: [...accessScopes, 'memory:alex:personal'] };
  const started = await startMemory(service, config); const input = preference(started); input.accessScopes = config.accessScopes;
  const recorded = await recordMemory(service, input);
  for (const scope of config.accessScopes) assert.equal((await queryMemory(service, query({ accessScopes: [scope] }))).entries.length, 1, 'either declared label projects the account');
  await assert.rejects(queryMemory(service, query({ accessScopes: ['unrelated'] })), /unknown or inaccessible/);
  await assert.rejects(recordMemory(service, { ...input, requestId: 'broadening', graphHash: recorded.graphHash, accessScopes: [...config.accessScopes, 'public'] }), /exactly the context/);
  await assert.rejects(recordMemory(service, { ...input, requestId: 'narrow-write', graphHash: recorded.graphHash, accessScopes }), /exactly the context/);
  const otherSubject = structuredClone(input); otherSubject.requestId = 'other-subject'; otherSubject.entries[0].subject = 'user:someone-else';
  await assert.rejects(recordMemory(service, otherSubject), /outside this memory context/);
  await assert.rejects(startMemory(service, { ...config, scope: 'A wider scope never delegated.' }), /different scope or declaration/);
  assert.equal((await queryMemory(service, query())).graphHash, recorded.graphHash);
});

test('generic context edits cannot silently replace the delegated declaration', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const started = await startMemory(service, declaration);
  const view = await service.queryNarrativeGraph({ graphHash: started.graphHash, mode: 'full', includeContent: true, accessScopes });
  const root = view.nodes.find((node) => node.id === started.contextRootId);
  const changed = JSON.parse(root.text);
  changed.scope = 'An expanded scope outside the original delegation.'; changed.subjects.push('user:someone-else');
  const edited = await editNarrativeGraph(service, { requestId: 'generic-context-edit', graphHash: started.graphHash,
    accessScopes, author: 'agent:researcher', reason: 'Exercise a context edit retaining the old declaration signature.',
    operations: [{ kind: 'replace_text', nodeId: root.id, expectedText: root.text, text: JSON.stringify(changed) }] });
  await assert.rejects(startMemory(service, declaration), /context declaration or visibility changed/);
  await assert.rejects(queryMemory(service, query()), /context declaration or visibility changed/);
  const input = preference(started); input.graphHash = edited.graphHash; input.entries[0].subject = 'user:someone-else';
  await assert.rejects(recordMemory(service, input), /context declaration or visibility changed/);
  assert.deepEqual((await queryMemory(service, query({ graphHash: started.graphHash }))).entries, [], 'the unchanged original declaration remains an exact readable revision');
  assert.deepEqual((await service.listNarrativeRevisions({})).heads, [edited.graphHash], 'failed memory operations do not write');
});

test('native process development and rebind preserve Event/process anchors for hypotheses, tests and learning', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const started = await startMemory(service, { ...declaration, purpose: 'agent_memory' });
  const { model } = await service.inspectModel({ modelHash: started.modelHash, includeDefinition: true });
  const provenance = ['Authored research-work process fixture; qualitative account, no inferred causal law.'];
  model.revision = { number: 1, previous_model_hash: started.modelHash, reason: 'Open the ongoing investigation into attempts and learning.', provenance };
  model.processes.push({ id: 'work.investigation', value_type: { kind: 'category', variants: ['open', 'tested', 'reconsidered'] },
    initial_value: { kind: 'category', value: 'open' }, update_mode: 'observed', support: ['An ongoing investigation whose later evidence can revise its account.'],
    scale: { semantic_role: 'The research goal and its evolving understanding.' }, access_scopes: accessScopes, provenance });
  model.meaning_model.event_relations ??= [];
  for (const [index, eventId] of ['work.attempt', 'work.learning'].entries()) {
    model.meaning_model.events.push({ id: eventId, boundary: index ? 'Reconsider the explanation after the experiment.' : 'Test the proposed explanation.',
      description: index ? 'The recorded outcome changes what the researcher expects to investigate next.' : 'The researcher tests an explanation and records its outcome.',
      interval: { start: index, end: index + 1 }, participants: {}, process_ids: ['work.investigation'], observation_process_ids: [], region: null, substrate: null, provenance });
    model.meaning_model.event_relations.push({ id: `context.contains.${eventId}`, kind: 'contains', source_event_id: started.nativeTargets[1].record.slice(6),
      target_event_id: eventId, description: 'Episode within the delegated work.', authority: null, uncertainty: { kind: 'unknown' }, provenance });
  }
  const revised = await service.reviseModel({ requestId: 'develop-process', previousModelHash: started.modelHash, model });
  const rebound = await rebindNarrativeGraph(service, { requestId: 'rebind-process', graphHash: started.graphHash, modelHash: revised.modelHash, accessScopes, reason: 'Memory follows the developed investigation model.' });
  const recorded = await recordMemory(service, { requestId: 'understand-process', contextId: declaration.contextId, graphHash: rebound.graphHash,
    accessScopes, holder: 'agent:researcher', recordedBy: 'agent:researcher', entries: [
      { nodeId: 'learning.hypothesis', subject: 'agent:researcher', kind: 'hypothesis', text: 'The explanation should also hold in the neighboring case.', about: [{ record: 'process:work.investigation' }] },
      { nodeId: 'learning.test', subject: 'agent:researcher', kind: 'experiment', text: 'Compare the neighboring case and retain the contrary result.', evidenceType: 'observation',
        source: { citation: 'Research experiment fixture, directly supplied outcome' }, about: [{ record: 'event:work.attempt' }], links: [{ relation: 'questions', targetNodeId: 'learning.hypothesis' }] },
      { nodeId: 'learning.surprise', subject: 'agent:researcher', kind: 'surprise', text: 'The neighboring case diverges; investigate the condition that differed.',
        about: [{ record: 'event:work.learning' }, { record: 'process:work.investigation' }], links: [{ relation: 'learned_from', targetNodeId: 'learning.test' }, { relation: 'contradicts', targetNodeId: 'learning.hypothesis' }] },
    ] });
  const recalled = await queryMemory(service, query());
  assert.equal(recalled.modelHash, revised.modelHash); assert.equal(recalled.entries.length, 3);
  assert.ok(recalled.entries.every((entry) => entry.writtenAgainstModel === revised.modelHash));
  assert.ok(recalled.entries.find((entry) => entry.nodeId === 'learning.surprise').links.some((link) => link.target.anchor_kind === 'process' && link.target.anchor_id === 'work.investigation'));
  assert.ok(recalled.entries.find((entry) => entry.nodeId === 'learning.test').links.some((link) => link.target.anchor_kind === 'event' && link.target.anchor_id === 'work.attempt'));
  const replay = await replayConstruction(service, { graphHash: recorded.graphHash, accessScopes, level: 'reasoning' });
  assert.match(replay.text, /Open the ongoing investigation/); assert.match(replay.text, /neighboring case/);
  assert.equal((await service.inspectModel({ modelHash: started.modelHash, includeDefinition: true })).model.processes.length, 1, 'the scaffold remains immutable history');
});

test('scoped native memory keeps uncertain occurrence dates and retrospective accounts distinct from state', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const started = await startMemory(service, declaration);
  const { model } = await service.inspectModel({ modelHash: started.modelHash, includeDefinition: true });
  const provenance = ['Fixture: Alex reports at day 0 that they joined during September and wanted concise updates on 24 September.'];
  const rootId = started.nativeTargets.find(({ record }) => record.startsWith('event:')).record.slice(6);
  const processId = 'work.reported-update-preference';
  model.revision = { number: 1, previous_model_hash: started.modelHash,
    reason: 'Represent scoped report context, uncertain occurrence timing and a dated retrospective account.', provenance };
  model.processes.push({ id: processId, value_type: { kind: 'category', variants: ['unknown', 'concise', 'detailed'] },
    initial_value: { kind: 'category', value: 'unknown' }, update_mode: 'observed',
    scale: { semantic_role: 'Alex’s requested level of detail in this project; no current preference was supplied.' },
    uncertainty: { kind: 'unknown' }, support: provenance, access_scopes: accessScopes, provenance });
  model.meaning_model.referents.push({ id: 'user:alex', boundary: 'Alex as participant in this research project.',
    continuity_criterion: 'The same participant across this project’s reports.', lifecycle_event_id: null,
    uncertainty: { kind: 'unknown' }, provenance });
  model.meaning_model.events.push(
    { id: 'work.alex-report-context', boundary: 'Alex’s attributed project account, not independently verified history.',
      participants: { subject: 'user:alex' }, interval: null, process_ids: [], provenance },
    { id: 'work.september-context', boundary: 'The September 2026 calendar segment of this project account.',
      description: 'A calendar period containing the reported joining; not a month-long joining event.',
      interval: { start: -31, end: -1 }, process_ids: [], provenance },
    { id: 'work.joining', boundary: 'Alex joined sometime during September; the occurrence date is unknown.',
      interval: null, process_ids: [], provenance });
  model.meaning_model.context_roots.push({ event_id: 'work.alex-report-context', kind: 'inner', provenance });
  model.meaning_model.event_relations ??= [];
  for (const [source, target] of [[rootId, 'work.alex-report-context'], ['work.alex-report-context', 'work.september-context'], ['work.september-context', 'work.joining']]) {
    model.meaning_model.event_relations.push({ id: `${source}.contains.${target}`, kind: 'contains',
      source_event_id: source, target_event_id: target, provenance });
  }
  model.meaning_model.event_referent_bindings.push(
    { id: 'binding.alex.preference', target: { kind: 'process', process_id: processId }, role: 'subject',
      referent_id: 'user:alex', binding_type: 'reported_state_subject', uncertainty: { kind: 'unknown' }, provenance },
    { id: 'binding.alex.joining', target: { kind: 'event', event_id: 'work.joining' }, role: 'participant',
      referent_id: 'user:alex', binding_type: 'participates', uncertainty: { kind: 'unknown' }, provenance });
  model.initial_claims.push({ id: 'report.alex.preference.september24', subject: processId,
    value: { kind: 'category', value: 'concise' }, uncertainty: { kind: 'unknown' }, evidence_type: 'report', holder: 'user:alex',
    value_time: -8, evidence_cutoff: 0, authority: { source: 'Alex’s retrospective project report', weight: 1 },
    access_scopes: accessScopes, provenance });
  const revised = await service.reviseModel({ requestId: 'develop-dated-memory', previousModelHash: started.modelHash, model });
  const rebound = await rebindNarrativeGraph(service, { requestId: 'rebind-dated-memory', graphHash: started.graphHash,
    modelHash: revised.modelHash, accessScopes, reason: 'Bind memory to the attributed project account.' });
  const stored = (await service.inspectModel({ modelHash: revised.modelHash, includeDefinition: true })).model;
  assert.deepEqual(stored.meaning_model.events.find(({ id }) => id === 'work.september-context').interval, { start: -31, end: -1 });
  assert.equal(stored.meaning_model.events.find(({ id }) => id === 'work.joining').interval, null,
    'the containing month does not become an asserted occurrence duration or timestamp');
  assert.deepEqual(stored.laws, [], 'a qualitative report does not require an invented transition law');

  const at = async (time) => (await readOpenQuestions(service, { modelHash: revised.modelHash, graphHash: rebound.graphHash,
    people: [{ id: 'user:alex', name: 'Alex' }], at: time, accessScopes })).states[0];
  const earlier = await at(-8);
  assert.equal(earlier.values[0].processId, processId, 'the native subject binding makes the process discoverable');
  assert.deepEqual(earlier.values[0].accounts, [], 'the later retrospective report was not available at the past cutoff');
  assert.deepEqual(earlier.latest, [], 'no exact occurrence state can be recovered from the containing month');
  const recalled = await at(0);
  assert.deepEqual(recalled.values[0].accounts, [{ holder: 'user:alex', value: { kind: 'category', value: 'concise' },
    at: -8, evidenceType: 'report', evidenceCutoff: 0, uncertainty: { kind: 'unknown' } }]);
  for (const reading of [earlier, recalled, await at(1)]) {
    assert.deepEqual(reading.values[0].state, { initialValue: { kind: 'category', value: 'unknown' }, updateMode: 'observed' },
      'this is the initial declaration, not a reconstructed state or an extrapolation of the retrospective report');
  }
  assert.equal(stored.initial_claims[0].value_time, -8);
  assert.equal(stored.initial_claims[0].evidence_cutoff, 0);
  const invalidLaterClaim = structuredClone(stored);
  invalidLaterClaim.initial_claims[0].evidence_cutoff = 1;
  await assert.rejects(service.registerModel({ requestId: 'reject-post-genesis-memory-claim', model: invalidLaterClaim }),
    /evidence from after genesis time 0/, 'later evidence cannot be smuggled into model initial claims');
});

test('memory derived from a native private record cannot inherit a broader context audience', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const privateContext = await startMemory(service, declaration);
  const broadScopes = [...accessScopes, 'team'];
  for (const external of [false, true]) {
    const contextId = external ? 'external-audience' : 'bound-audience';
    const started = await startMemory(service, { ...declaration, contextId, accessScopes: broadScopes,
      ...(external ? {} : { modelHash: privateContext.modelHash }) });
    const input = preference(started, `${contextId}.report`);
    input.contextId = contextId; input.accessScopes = broadScopes;
    input.entries[0].about = [{ ...privateContext.nativeTargets[0], ...(external ? { modelHash: privateContext.modelHash } : {}) }];
    await recordMemory(service, input);
    const team = await queryMemory(service, { contextId, accessScopes: ['team'] });
    assert.deepEqual(team.entries, [], 'private-derived text remains private even when the context is shared');
    const visible = await queryMemory(service, { contextId, accessScopes });
    assert.equal(visible.entries.length, 1);
    assert.deepEqual(visible.entries[0].accessScopes, accessScopes);
    const view = await service.queryNarrativeGraph({ graphHash: visible.graphHash, mode: 'full', includeContent: true, accessScopes: ['team'] });
    assert.ok(!view.nodes.some((node) => node.node_type === 'model_reference'), 'no external private summary leaks through its reference node');
  }
});

test('a stale capture signature does not make an edited entry an identical retry', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const started = await startMemory(service, declaration); const input = preference(started);
  const recorded = await recordMemory(service, input);
  const view = await service.queryNarrativeGraph({ graphHash: recorded.graphHash, mode: 'full', includeContent: true, accessScopes });
  const before = view.nodes.find((node) => node.id === input.entries[0].nodeId).text;
  const editedPayload = JSON.parse(before); editedPayload.text = 'A different account, edited through the general graph tool.';
  const edited = await editNarrativeGraph(service, { requestId: 'generic-edit', graphHash: recorded.graphHash,
    accessScopes, author: 'agent:researcher', reason: 'Exercise a changed account retaining old capture metadata.',
    operations: [{ kind: 'replace_text', nodeId: input.entries[0].nodeId, expectedText: before, text: JSON.stringify(editedPayload) }] });
  await assert.rejects(recordMemory(service, input), /changed after capture/, 'the original same-process receipt must not bypass current content');
  await assert.rejects(recordMemory(service, { ...input, graphHash: edited.graphHash }), /changed after capture/, 'an explicit current hash must not be replaced by an old receipt');
  await assert.rejects(recordMemory(service, { ...input, requestId: 'retry-after-edit', graphHash: edited.graphHash }), /changed after capture/);
  assert.equal((await queryMemory(service, query())).entries[0].text, editedPayload.text);
});

test('same-process retries reconcile at the current head and refuse an unestablished append branch', async (t) => {
  const { start } = await sessions(t); const service = await start();
  const started = await startMemory(service, declaration); const input = preference(started);
  const recorded = await recordMemory(service, input);
  const laterInput = preference(started, 'later.account'); laterInput.requestId = 'later';
  const later = await recordMemory(service, laterInput);
  const retry = await recordMemory(service, input);
  assert.equal(retry.graphHash, later.graphHash); assert.equal(retry.graphMutation, false); assert.equal(retry.reusedExisting, true);
  assert.equal((await queryMemory(service, query())).entries.length, 2);
  const list = service.listNarrativeRevisions.bind(service);
  service.listNarrativeRevisions = async () => { throw new Error('Revision catalog unavailable'); };
  const unknown = preference(started, 'unestablished.account'); unknown.requestId = 'unestablished';
  await assert.rejects(recordMemory(service, unknown), /Revision catalog unavailable/);
  service.listNarrativeRevisions = async () => ({ revisions: [], heads: [] });
  await assert.rejects(recordMemory(service, unknown), /Cannot establish the current memory branch/);
  service.listNarrativeRevisions = list;
  assert.deepEqual((await list({})).heads, [later.graphHash], 'catalog failure must not fork the earlier supplied revision');
  assert.notEqual(recorded.graphHash, later.graphHash);
});

test('ambiguous descendants require explicit branch choice for recall, recording and reopening', async (t) => {
  const { start } = await sessions(t); const service = await start(); const started = await startMemory(service, declaration);
  const left = preference(started, 'left.account'); left.requestId = 'left'; left.exactRevision = true;
  const right = preference(started, 'right.account'); right.requestId = 'right'; right.exactRevision = true;
  const a = await recordMemory(service, left), b = await recordMemory(service, right);
  await assert.rejects(queryMemory(service, query()), /multiple branch heads/);
  await assert.rejects(startMemory(service, declaration), /multiple branch heads/);
  const stale = preference(started, 'ambiguous'); stale.requestId = 'ambiguous';
  await assert.rejects(recordMemory(service, stale), /branched/);
  assert.deepEqual((await queryMemory(service, query({ graphHash: a.graphHash }))).entries.map((entry) => entry.nodeId), ['left.account']);
  assert.deepEqual((await queryMemory(service, query({ graphHash: b.graphHash }))).entries.map((entry) => entry.nodeId), ['right.account']);
  assert.equal((await startMemory(service, { ...declaration, graphHash: a.graphHash })).graphHash, a.graphHash);
});

test('public memory tools are small, strict and read-only only for query', () => {
  const registrations = []; registerMemoryTools({ registerTool: (...args) => registrations.push(args) }, {}, { toolResult: (value) => value });
  assert.deepEqual(registrations.map(([name]) => name), ['life_memory_start', 'life_memory_record', 'life_memory_query',
    'life_memory_transcript_configure', 'life_memory_transcript_capture', 'life_memory_transcript_query']);
  assert.deepEqual(registrations.map(([, config]) => config.annotations.readOnlyHint), [false, false, true, false, false, true]);
  assert.throws(() => memoryStartSchema.parse({ ...declaration, backgroundCapture: true }));
  const withoutTime = { ...declaration }; delete withoutTime.time;
  assert.throws(() => memoryStartSchema.parse(withoutTime), /explicit time unit and origin/);
  assert.throws(() => memoryQuerySchema.parse(query({ limit: 101 })));
  const input = preference({ graphHash: 'a'.repeat(64), nativeTargets: [{ record: 'process:work' }] }); delete input.entries[0].source;
  assert.throws(() => memoryRecordSchema.parse(input), /actual source/);
});
