import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { outlineModel, readNotes } from '../src/construction-record.mjs';

test('MCP preserves a Cut rationale after revision and exposes its different model basis without invalidating every note', async (t) => {
  const client = new Client({ name: 'note-model-basis-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))], env }));
  t.after(() => client.close());
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const accessScopes = ['author'];
  const registered = await call('life_model_register', registerRequest);
  const graph = graphRequest.narrativeGraph;
  graph.source.model_hash = registered.modelHash;
  graph.nodes = graph.nodes.map((node) => ({ ...node, access_scopes: accessScopes }));
  graph.edges = graph.edges.map((edge) => ({ ...edge, access_scopes: accessScopes }));
  const stored = await call('life_narrative_register', { requestId: 'basis-graph', narrativeGraph: graph });
  const rationale = 'At this model revision money occupies .55, continuity .35, and the remainder .10 of the attention budget.';
  const noted = await call('life_understanding_record', { requestId: 'basis-notes', graphHash: stored.graphHash, holder: 'basis-reader', accessScopes,
    notes: [
      { nodeId: 'note.cut.rationale', kind: 'interpretation', text: rationale, about: [{ record: 'cut:cut.ada.h06.attention', path: '/answers/0' }] },
      { nodeId: 'note.unchanged.offer', kind: 'observation', text: 'The offer arrived at six.', about: [{ record: 'event:event.offer' }] },
    ] });
  const before = await call('life_understanding_read', { graphHash: noted.graphHash, accessScopes, nodeIds: ['note.cut.rationale'] });
  assert.deepEqual([before.notes[0].writtenAgainstModel, before.notes[0].currentModel, before.notes[0].modelBasis], [registered.modelHash, registered.modelHash, 'current']);
  assert.equal(before.notes[0].modelBasisAnnotation, null);

  const successor = structuredClone(registerRequest.model);
  successor.revision = { number: 1, previous_model_hash: registered.modelHash, reason: 'Revise the synthetic attention split.', provenance: ['note-model-basis-test'] };
  for (const answer of successor.meaning_model.normalized_cuts[0].answers) answer.weight = { money: 0.15, continuity: 0.75, remainder: 0.10 }[answer.key];
  const revised = await call('life_model_revise', { requestId: 'basis-revise', previousModelHash: registered.modelHash, model: successor });
  const rebound = await call('life_narrative_rebind', { requestId: 'basis-rebind', graphHash: noted.graphHash, modelHash: revised.modelHash, accessScopes });
  assert.deepEqual(rebound.revisionCheck, { tool: 'life_revision_check', arguments: { graphHash: rebound.graphHash, fromModelHash: registered.modelHash, toModelHash: revised.modelHash, accessScopes } });
  assert.match(rebound.nextStep, /life_revision_check with revisionCheck\.arguments/u);

  const read = await call('life_understanding_read', { graphHash: rebound.graphHash, accessScopes, nodeIds: ['note.cut.rationale', 'note.unchanged.offer', 'canon.offer'] });
  for (const note of read.notes.slice(0, 2)) {
    assert.deepEqual([note.writtenAgainstModel, note.currentModel, note.modelBasis], [registered.modelHash, revised.modelHash, 'different']);
    assert.match(note.modelBasisAnnotation, /different model basis: written against [a-f0-9]{12}; current [a-f0-9]{12}; applicability unchecked/u);
    assert.doesNotMatch(note.modelBasisAnnotation, /ancestor|invalid|needs.review|superseded/u);
  }
  assert.equal(read.notes[0].text, rationale, 'the predecessor rationale is preserved verbatim');
  assert.deepEqual([read.notes[2].writtenAgainstModel, read.notes[2].currentModel, read.notes[2].modelBasis], [null, revised.modelHash, 'unknown'], 'an unstamped record is not assumed current');

  const outline = await call('life_model_outline', { graphHash: rebound.graphHash, accessScopes, understanding: 'full' });
  const rationaleLine = outline.text.split('\n').find((line) => line.includes('✎ note.cut.rationale '));
  assert.match(outline.text, /continuity 0\.75, money 0\.15, remainder 0\.10/u);
  assert.ok(rationaleLine.includes(rationale));
  assert.ok(rationaleLine.includes(read.notes[0].modelBasisAnnotation), 'old rationale next to new weights visibly declares its basis');
  assert.deepEqual(outline.noteModelBases.find((note) => note.nodeId === 'note.cut.rationale'), { nodeId: 'note.cut.rationale', writtenAgainstModel: registered.modelHash,
    currentModel: revised.modelHash, modelBasis: 'different', modelBasisAnnotation: read.notes[0].modelBasisAnnotation });

  const diagnostic = await call(rebound.revisionCheck.tool, rebound.revisionCheck.arguments);
  assert.ok(diagnostic.notes.some((note) => note.nodeId === 'note.cut.rationale'));
  assert.ok(!diagnostic.notes.some((note) => note.nodeId === 'note.unchanged.offer'), 'a different stamp does not make an unrelated note affected');
  const inaccessible = await call('life_understanding_read', { graphHash: rebound.graphHash, accessScopes: ['outsider'], nodeIds: ['note.cut.rationale'] });
  assert.deepEqual(inaccessible.notes, [{ id: 'note.cut.rationale', found: false, reason: 'unknown, or hidden by these access scopes' }]);
  const hiddenOutline = await call('life_model_outline', { graphHash: rebound.graphHash, accessScopes: ['outsider'], understanding: 'full' });
  assert.deepEqual(hiddenOutline.noteModelBases, []);
  assert.ok(!hiddenOutline.text.includes('note.cut.rationale') && !hiddenOutline.text.includes(registered.modelHash.slice(0, 12)), 'inaccessible notes expose no writing stamp or content');
});

const graphHash = 'c'.repeat(64);
const currentModel = 'b'.repeat(64);
const otherModel = 'a'.repeat(64);
const note = (id, provenance = []) => ({ id, node_type: 'understanding.interpretation', role: 'externalized_reflection', text: `Text of ${id}.`, provenance });
const viewOf = (nodes) => ({ graph_hash: graphHash, content_included: true, graph: { id: 'basis-fixture', revision: { number: 0 }, source: { model_hash: currentModel } }, nodes,
  edges: nodes.map((node) => ({ source: { kind: 'node', node_id: node.id }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'event' }, relation: 'about', family: 'semantic' })) });

test('writing-basis parsing treats absent, malformed, and conflicting stamps as unknown and makes no ancestry claim', async () => {
  const nodes = [note('absent'), note('malformed', ['written-against-model:not-a-hash']),
    note('conflicting', [`written-against-model:${otherModel}`, `written-against-model:${currentModel}`]),
    note('mixed', [`written-against-model:${currentModel}`, 'written-against-model:not-a-hash']),
    note('same', [`written-against-model:${currentModel}`]),
    note('other-branch', [`written-against-model:${otherModel}`])];
  let inspections = 0;
  const service = { queryNarrativeGraph: async () => viewOf(nodes), inspectModel: async () => { inspections += 1; throw new Error('No lineage access in this fixture.'); } };
  const read = await readNotes(service, { graphHash, nodeIds: nodes.map((node) => node.id) });
  assert.equal(inspections, 0, 'reading basis metadata does not fetch inaccessible predecessor models');
  for (const record of read.notes.slice(0, 4)) {
    assert.deepEqual([record.writtenAgainstModel, record.currentModel, record.modelBasis], [null, currentModel, 'unknown']);
    assert.match(record.modelBasisAnnotation, /model basis unknown/u);
  }
  assert.equal(read.notes[4].modelBasis, 'current');
  assert.equal(read.notes[4].modelBasisAnnotation, null);
  assert.equal(read.notes[5].modelBasis, 'different');
  assert.doesNotMatch(read.notes[5].modelBasisAnnotation, /historical|earlier|ancestor|invalid|needs.review/u);
});

test('boundary and content-excluded notes expose no basis metadata or outline text', async () => {
  const nodes = [
    { ...note('boundary.secret', [`written-against-model:${otherModel}`]), boundary: true },
    { ...note('content.secret', [`written-against-model:${otherModel}`]), content_included: false },
  ];
  const service = { queryNarrativeGraph: async () => viewOf(nodes), inspectModel: async ({ modelHash }) => {
    assert.equal(modelHash, currentModel, 'outlining never fetches a note\'s predecessor model');
    return { model: { id: 'basis-fixture', meaning_model: { events: [{ id: 'event', boundary: 'Visible Event.' }] } } };
  } };
  const read = await readNotes(service, { graphHash, nodeIds: nodes.map((node) => node.id) });
  assert.ok(read.notes.every((record) => record.found === false && !('writtenAgainstModel' in record)));
  const outline = await outlineModel(service, { graphHash, understanding: 'full' });
  assert.deepEqual(outline.noteModelBases, []);
  assert.doesNotMatch(outline.text, /secret|aaaa|Text of/u);
});
