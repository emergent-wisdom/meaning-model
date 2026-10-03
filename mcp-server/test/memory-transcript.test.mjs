import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { startMemory, recordMemory, queryMemory, configureMemoryTranscript, captureMemoryTranscript, queryMemoryTranscript,
  memoryTranscriptCaptureSchema } from '../src/memory-workflow.mjs';

const accessScopes = ['archive'];
const context = { requestId: 'start', contextId: 'archive', title: 'The archive project', scope: 'Only the archive conversation and project.',
  purpose: 'user_memory', holder: 'sol', subjects: ['lea', 'sol'], accessScopes,
  time: { unit: 'day', origin: '2 October 2026 is day zero.' } };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-transcript-')), services = [];
  t.after(async () => { await Promise.all(services.map((service) => service.close())); await rm(directory, { recursive: true, force: true }); });
  return async () => {
    const backend = new RustEngineProcess(); backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, 'memory.sqlite') };
    const service = new LifeSimulationService({ backend }); services.push(service); await service.initialize(); return service;
  };
}
const write = (graphHash, extra = {}) => ({ requestId: 'enable', contextId: context.contextId, graphHash, accessScopes, recordedBy: 'sol', ...extra });
const query = (extra = {}) => ({ contextId: context.contextId, accessScopes, ...extra });
const messages = [
  { messageId: 'user-1', sequence: 0, role: 'user', speaker: 'lea', text: '  I liked editing.\n\nBut I dread the paperwork.  ', timestamp: '2026-10-02T10:00:00+02:00' },
  { messageId: 'reply-1', sequence: 1, role: 'assistant', speaker: 'sol', text: '\nPerhaps preparation is the difficulty; that is a hypothesis.\n' },
];
const capture = (graphHash, extra = {}) => write(graphHash, { requestId: 'turn-1', conversationId: 'conversation-1', source: 'host_transcript', messages, ...extra });

test('opt-in transcript retains exact sources and declared order, separately from derived memory and world state', async (t) => {
  const service = await (await fixture(t))(); const started = await startMemory(service, context);
  assert.equal(started.transcript.enabled, false); assert.equal(started.transcriptConfigure.tool, 'life_memory_transcript_configure');
  await assert.rejects(captureMemoryTranscript(service, capture(started.graphHash)), /capture is off/);
  const enabled = await configureMemoryTranscript(service, write(started.graphHash, { enabled: true }));
  assert.equal((await startMemory(service, context)).transcript.enabled, true, 'reopening does not reset opt-in');
  const stored = await captureMemoryTranscript(service, capture(enabled.graphHash, { messages: [...messages].reverse() }));
  assert.equal(stored.worldMutation, false);
  const recalled = await queryMemoryTranscript(service, query());
  assert.deepEqual(recalled.messages.map(({ text }) => text), messages.map(({ text }) => text), 'preserve whitespace and order by supplied sequence, not batch order');
  assert.equal(recalled.messages[0].timestamp, messages[0].timestamp); assert.equal(recalled.messages[1].timestamp, null);
  assert.equal(recalled.messages[1].speaker, 'sol'); assert.equal(recalled.messages[0].source, 'host_transcript');
  assert.deepEqual((await queryMemory(service, query())).entries, [], 'source wrappers are not synthesized memory');
  assert.deepEqual((await queryMemoryTranscript(service, query({ graphHash: enabled.graphHash }))).messages, [], 'old exact graph has no later message');
  const page = await queryMemoryTranscript(service, query({ limit: 1 })); assert.equal(page.window.nextOffset, 1);
  assert.equal((await queryMemoryTranscript(service, query({ offset: 1, limit: 1 }))).window.nextOffset, null);
  assert.equal((await queryMemoryTranscript(service, query({ search: 'PAPERWORK', role: 'user', speaker: 'lea' }))).messages.length, 1);
  const sourceId = recalled.messages[0].nodeId;
  const derived = await recordMemory(service, { ...write(stored.graphHash, { requestId: 'hypothesis' }), holder: 'sol', entries: [{
    nodeId: 'preparation.hypothesis', subject: 'lea', kind: 'hypothesis', text: 'Preparation may contribute to the dread.',
    about: [...started.nativeTargets, { nodeId: sourceId }], links: [{ relation: 'learned_from', targetNodeId: sourceId }], evidenceType: 'belief',
  }] });
  const after = await queryMemoryTranscript(service, query({ graphHash: derived.graphHash }));
  assert.ok(after.messages[0].links.some((edge) => edge.relation === 'learned_from' && edge.source.node_id === 'preparation.hypothesis'));
  assert.equal((await queryMemory(service, query())).entries.length, 1);
  const view = await service.queryNarrativeGraph({ graphHash: derived.graphHash, mode: 'full', includeContent: true, accessScopes });
  for (const node of view.nodes.filter((node) => node.node_type.startsWith('transcript.'))) {
    assert.equal(node.render, 'exclude'); assert.equal(node.training, 'exclude');
    assert.equal(node.value_time, null, 'no invented model-time coordinate for a chat timestamp');
  }
  assert.equal(after.modelHash, started.modelHash);
});

test('capture reconciles retries across restart, rejects conflicts and off preserves sources without re-enabling', async (t) => {
  const start = await fixture(t), first = await start(); const started = await startMemory(first, context);
  const enableInput = write(started.graphHash, { enabled: true }); const enabled = await configureMemoryTranscript(first, enableInput);
  const input = capture(enabled.graphHash); const stored = await captureMemoryTranscript(first, input);
  const retry = await captureMemoryTranscript(first, input); assert.equal(retry.graphMutation, false); assert.equal(retry.graphHash, stored.graphHash);
  await assert.rejects(captureMemoryTranscript(first, { ...input, messages: [{ ...messages[0], text: 'Changed original.' }] }), /requestId/);
  await assert.rejects(captureMemoryTranscript(first, { ...input, requestId: 'different', messages: [{ ...messages[0], text: 'Changed original.' }] }), /conflicts/);
  await assert.rejects(captureMemoryTranscript(first, { ...input, requestId: 'sequence-clash', messages: [{ ...messages[0], messageId: 'another' }] }), /sequence 0/);
  const disabled = await configureMemoryTranscript(first, write(stored.graphHash, { requestId: 'disable', enabled: false }));
  const oldEnableRetry = await configureMemoryTranscript(first, enableInput);
  assert.equal(oldEnableRetry.transcript.enabled, false); assert.equal(oldEnableRetry.graphHash, disabled.graphHash);
  assert.equal((await startMemory(first, context)).transcript.enabled, false);
  await first.close(); const second = await start();
  const restartRetry = await captureMemoryTranscript(second, input);
  assert.equal(restartRetry.graphMutation, false); assert.equal(restartRetry.graphHash, disabled.graphHash);
  await assert.rejects(captureMemoryTranscript(second, capture(disabled.graphHash, { requestId: 'turn-2', messages: [{ messageId: 'user-2', sequence: 2, role: 'user', speaker: 'lea', text: 'New message.' }] })), /capture is off/);
  assert.equal((await queryMemoryTranscript(second, query())).messages.length, 2);
  assert.equal((await queryMemoryTranscript(second, query({ graphHash: stored.graphHash }))).transcript.enabled, true);
  await assert.rejects(configureMemoryTranscript(second, { ...enableInput, enabled: false }), /another or subsequently changed setting/);
});

test('transcript scopes filter source reads and incoming links; writes never broaden or narrow the declared context', async (t) => {
  const service = await (await fixture(t))(); const settings = { ...context, accessScopes: ['archive', 'private'] };
  const started = await startMemory(service, settings);
  for (const scopes of [['archive'], ['archive', 'private', 'public']]) await assert.rejects(configureMemoryTranscript(service,
    write(started.graphHash, { enabled: true, accessScopes: scopes })), /exactly the context/);
  const enabled = await configureMemoryTranscript(service, write(started.graphHash, { enabled: true, accessScopes: settings.accessScopes }));
  for (const scopes of [['archive'], ['archive', 'private', 'public']]) await assert.rejects(captureMemoryTranscript(service,
    capture(enabled.graphHash, { accessScopes: scopes })), /exactly the context/);
  const stored = await captureMemoryTranscript(service, capture(enabled.graphHash, { accessScopes: settings.accessScopes }));
  for (const scope of settings.accessScopes) assert.equal((await queryMemoryTranscript(service, query({ accessScopes: [scope] }))).messages.length, 2);
  await assert.rejects(queryMemoryTranscript(service, query({ accessScopes: ['unrelated'] })), /unknown or inaccessible/);
  const sourceId = stored.messages[0].nodeId, provenance = ['Private test interpretation'];
  const linked = await service.applyNarrativeBatch({ requestId: 'private-link', previousGraphHash: stored.graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: stored.graphHash,
      reason: 'Private interpretation of a shared source.', provenance, add_roots: [],
      add_nodes: [{ id: 'private.interpretation', node_type: 'understanding.hypothesis', role: 'externalized_reflection', text: 'Private inference.', holder: 'sol', authority: { source: 'test', weight: 1 }, epistemic_status: 'hypothesis', evidence_type: 'belief', access_scopes: ['private'], render: 'exclude', training: 'exclude', provenance }],
      add_edges: [{ id: 'private.link', source: { kind: 'node', node_id: 'private.interpretation' }, target: { kind: 'node', node_id: sourceId }, family: 'semantic', relation: 'about', access_scopes: ['private'], provenance }] } });
  const publicView = await queryMemoryTranscript(service, query({ graphHash: linked.graphHash }));
  assert.ok(!JSON.stringify(publicView).includes('private.interpretation'));
  const privateView = await queryMemoryTranscript(service, query({ graphHash: linked.graphHash, accessScopes: ['private'] }));
  assert.ok(privateView.messages[0].links.some((edge) => edge.source.node_id === 'private.interpretation'));
});

test('transcript retries detect generic source edits and the strict schema rejects hidden roles', async (t) => {
  for (const role of ['system', 'developer', 'tool', 'reasoning']) assert.throws(() => memoryTranscriptCaptureSchema.parse(capture('a'.repeat(64), { messages: [{ ...messages[0], role }] })));
  const service = await (await fixture(t))(); const started = await startMemory(service, context);
  const enabled = await configureMemoryTranscript(service, write(started.graphHash, { enabled: true }));
  const input = capture(enabled.graphHash); const stored = await captureMemoryTranscript(service, input);
  const view = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes });
  const original = view.nodes.find((node) => node.id === stored.messages[0].nodeId);
  const changed = JSON.parse(original.text); changed.message.text = 'An altered copy.';
  await editNarrativeGraph(service, { requestId: 'generic-rewrite', graphHash: stored.graphHash, accessScopes,
    reason: 'Test that a generic graph edit cannot silently satisfy a source retry.', author: 'test',
    operations: [{ kind: 'replace_text', nodeId: original.id, expectedText: original.text, text: JSON.stringify(changed) }] });
  await assert.rejects(captureMemoryTranscript(service, input), /conflicts with its stored source/);
  await assert.rejects(queryMemoryTranscript(service, query()), /conflicts with its stored source/);
  assert.deepEqual((await queryMemoryTranscript(service, query({ graphHash: stored.graphHash }))).messages.map(({ text }) => text),
    messages.map(({ text }) => text), 'the exact original source revision remains readable');
});

test('generic setting edits cannot silently opt in or turn capture off', async (t) => {
  for (const enabled of [false, true]) {
    const service = await (await fixture(t))(); const started = await startMemory(service, context);
    const configured = await configureMemoryTranscript(service, write(started.graphHash, { enabled }));
    const view = await service.queryNarrativeGraph({ graphHash: configured.graphHash, mode: 'full', includeContent: true, accessScopes });
    const setting = view.nodes.find((node) => node.node_type === 'transcript.setting');
    const changed = JSON.parse(setting.text); changed.enabled = !enabled;
    await editNarrativeGraph(service, { requestId: 'setting-edit', graphHash: configured.graphHash, accessScopes,
      reason: 'Check the integrity of an explicit capture setting.', author: 'test',
      operations: [{ kind: 'replace_text', nodeId: setting.id, expectedText: setting.text, text: JSON.stringify(changed) }] });
    await assert.rejects(queryMemoryTranscript(service, query()), /setting .* changed after configuration/);
    await assert.rejects(captureMemoryTranscript(service, capture(configured.graphHash)), /setting .* changed after configuration/);
    assert.equal((await queryMemoryTranscript(service, query({ graphHash: configured.graphHash }))).transcript.enabled, enabled);
  }
});

test('malformed transcript sources and changed placements are refused before query results are built', async (t) => {
  for (const alteration of ['malformed', 'placement']) {
    const service = await (await fixture(t))(); const started = await startMemory(service, context);
    const enabled = await configureMemoryTranscript(service, write(started.graphHash, { enabled: true }));
    const stored = await captureMemoryTranscript(service, capture(enabled.graphHash));
    const view = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes });
    const original = view.nodes.find((node) => node.id === stored.messages[0].nodeId);
    if (alteration === 'malformed') {
      await editNarrativeGraph(service, { requestId: 'malformed-source', graphHash: stored.graphHash, accessScopes,
        reason: 'Check malformed source handling.', author: 'test',
        operations: [{ kind: 'replace_text', nodeId: original.id, expectedText: original.text, text: '{malformed' }] });
    } else {
      const placement = view.edges.find((edge) => edge.id === `${original.id}.placement`);
      await editNarrativeGraph(service, { requestId: 'changed-placement', graphHash: stored.graphHash, accessScopes,
        reason: 'Change the original source placement explicitly.', author: 'test',
        operations: [{ kind: 'move', nodeId: original.id, parentNodeId: placement.source.node_id, index: 1 }] });
    }
    await assert.rejects(queryMemoryTranscript(service, query()), /malformed or conflicts with its stored source or placement/);
    assert.equal((await queryMemoryTranscript(service, query({ graphHash: stored.graphHash }))).messages[0].text, messages[0].text);
  }
});

test('transcript writes fail closed if the current branch cannot be established, and exact old reads stay old', async (t) => {
  const service = await (await fixture(t))(); const started = await startMemory(service, context);
  const enabled = await configureMemoryTranscript(service, write(started.graphHash, { enabled: true }));
  const disabled = await configureMemoryTranscript(service, write(enabled.graphHash, { requestId: 'disable', enabled: false }));
  const list = service.listNarrativeRevisions.bind(service);
  service.listNarrativeRevisions = async () => { throw new Error('Revision catalog unavailable'); };
  await assert.rejects(captureMemoryTranscript(service, capture(enabled.graphHash)), /Revision catalog unavailable/);
  await assert.rejects(configureMemoryTranscript(service, write(enabled.graphHash, { requestId: 'reenable', enabled: true })), /Revision catalog unavailable/);
  service.listNarrativeRevisions = async () => ({ revisions: [], heads: [] });
  await assert.rejects(captureMemoryTranscript(service, capture(enabled.graphHash)), /Cannot establish the current transcript branch/);
  service.listNarrativeRevisions = list;
  const heads = await list({}); assert.deepEqual(heads.heads, [disabled.graphHash]);
  const current = await queryMemoryTranscript(service, query()); assert.equal(current.transcript.enabled, false); assert.deepEqual(current.messages, []);
  const past = await queryMemoryTranscript(service, query({ graphHash: enabled.graphHash })); assert.equal(past.transcript.enabled, true); assert.deepEqual(past.messages, []);
});
