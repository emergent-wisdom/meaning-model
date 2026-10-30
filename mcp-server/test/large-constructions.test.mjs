// A construction too large to hold whole: history files read and written one revision at a time, an export that follows
// the model's own lineage when the graph lags it, lineage walks with no bound, and long reads in parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifeSimulationService } from '../src/service.mjs';
import { exportConstructionHistory, importConstructionHistory, outlineModel } from '../src/construction-record.mjs';
import { encodeHistoryModels, expandHistoryEntries, HISTORY_FILE_SCHEMA_V2, historyDigest, writeHistoryFile } from '../src/construction-files.mjs';
import { HistoryFileWriter, openHistoryFile } from '../src/history-stream.mjs';
import { modelLineageSteps, branchesOf } from '../src/model-lineage.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';
import { pagedText, readKey } from '../src/paging.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function temporary(t) { const directory = await mkdtemp(join(tmpdir(), 'meaning-large-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
async function service(t) { const opened = new LifeSimulationService(); t.after(() => opened.close()); await opened.initialize(); return opened; }

async function example() {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, modelRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  return { modelRequest, graphRequest };
}

// The example's model revised `count` times after the given revision, each changing one Event's description. Every
// revision made is returned, oldest first.
async function reviseMany(opened, modelHash, model, count, label, provenance = ['large constructions test']) {
  let current = modelHash; let definition = structuredClone(model); const made = [];
  for (let i = 1; i <= count; i += 1) {
    definition = structuredClone(definition);
    definition.revision = { number: definition.revision.number + 1, previous_model_hash: current, reason: `${label} ${i}`, provenance };
    const offer = definition.meaning_model.events.find((event) => event.id === 'event.offer');
    offer.description = `${label} ${i}: the offer as this revision reads it.`;
    current = (await opened.reviseModel({ requestId: `${label}.${i}`, previousModelHash: current, model: definition })).modelHash;
    made.push({ modelHash: current, definition });
  }
  return { modelHash: current, definition, made };
}

// A model, a graph bound to it with a few additive revisions, and the model revised past the graph.
async function construction(t, { revisionsBefore = 3, revisionsAfter = 4, appends = 5 } = {}) {
  const opened = await service(t);
  const { modelRequest, graphRequest } = await example();
  const first = await opened.registerModel(modelRequest);
  const before = await reviseMany(opened, first.modelHash, modelRequest.model, revisionsBefore, 'before');
  const graph = structuredClone(graphRequest.narrativeGraph); graph.source.model_hash = before.modelHash;
  let graphHash = (await opened.registerNarrativeGraph({ ...graphRequest, narrativeGraph: graph })).graphHash;
  for (let i = 0; i < appends; i += 1) {
    graphHash = (await opened.applyNarrativeBatch({ requestId: `append.${i}`, previousGraphHash: graphHash, narrativeBatch: {
      schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: graphHash, reason: `Note ${i}.`, provenance: ['large constructions test'],
      add_nodes: [{ id: `note.${i}`, node_type: 'note', role: 'metadata', text: `Note ${i} on the offer.`, epistemic_status: 'fictional_canon',
        evidence_type: 'fictional_canon', render: 'exclude', training: 'exclude', authority: { source: 'example-author', weight: 1 }, provenance: ['large constructions test'] }],
      add_edges: [{ id: `story.contains.note.${i}`, source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: `note.${i}` }, family: 'structural',
        relation: 'contains', order: 200 + i, provenance: ['large constructions test'] }] } })).graphHash;
  }
  const after = await reviseMany(opened, before.modelHash, before.definition, revisionsAfter, 'after');
  return { service: opened, graphHash, graphModelHash: before.modelHash, headModelHash: after.modelHash, headDefinition: after.definition, after: after.made };
}

test('a history file written one revision at a time is the same bytes the whole-history writer gave', async (t) => {
  const directory = await temporary(t);
  const { service: opened, graphHash } = await construction(t, { revisionsAfter: 0 });
  const streamed = await exportConstructionHistory(opened, { graphHash, accessScopes: ['author'], destinationPath: join(directory, 'streamed.json') });
  const inline = await exportConstructionHistory(opened, { graphHash, accessScopes: ['author'] }, { maximumBytes: 64 * 1024 * 1024 });
  assert.equal(streamed.modelLineage, undefined, 'a graph bound to its model\'s newest revision carries nothing more');
  assert.equal(inline.bundleSha256, streamed.bundleSha256);
  // As the exporter wrote it before: the whole history in memory, its models encoded, one canonical serialization.
  const { bundleSha256, ...history } = inline;
  const whole = await writeHistoryFile(join(directory, 'whole.json'), { ...history, bundleSha256, schema: HISTORY_FILE_SCHEMA_V2, models: encodeHistoryModels(history.models) });
  assert.equal(streamed.fileSha256, whole.fileSha256);
  assert.deepEqual(await readFile(streamed.path), await readFile(whole.path));
  assert.equal(historyDigest(history).sha256, bundleSha256);
});

test('an export follows the model past a graph that lags it, says so, and the import stores the newest revision', async (t) => {
  const directory = await temporary(t);
  const built = await construction(t, { revisionsBefore: 2, revisionsAfter: 5 });
  // A revision left behind beside the line, and a hypothetical branch that runs further than the line itself: neither
  // is the model's newest revision on the graph's line.
  await reviseMany(built.service, built.after[0].modelHash, built.after[0].definition, 1, 'left behind');
  const marker = `meaning-model-branch/v1 ${JSON.stringify({ stageId: 'test', branch: 'yes', kind: 'assumption', probability: null })}`;
  await reviseMany(built.service, built.after[2].modelHash, built.after[2].definition, 4, 'branch', [marker]);
  const exported = await exportConstructionHistory(built.service, { graphHash: built.graphHash, accessScopes: ['author'], includeModelHeads: true, destinationPath: join(directory, 'lagging.json') });
  assert.deepEqual(exported.modelLineage?.modelHeadHashes, [built.headModelHash]);
  assert.equal(exported.modelLineage.graphModelHash, built.graphModelHash);
  assert.equal(exported.modelLineage.graphLagsModelBy, 5);
  assert.match(exported.modelLineage.note, /5 revision\(s\) behind the model's newest revision 7/u);
  assert.equal(exported.modelCount, 8, 'the first revision, the graph\'s, and the five after it');
  const file = JSON.parse(await readFile(exported.path, 'utf8'));
  assert.deepEqual(file.modelHeadHashes, [built.headModelHash], 'the file names the newer head, inside its checksum');
  assert.ok(file.models.some((entry) => entry.modelHash === built.headModelHash));
  const target = await service(t);
  const imported = await importConstructionHistory(target, { requestId: 'lagging.import', sourcePath: exported.path });
  assert.equal(imported.verified, true);
  assert.equal(imported.models, 8);
  assert.equal(imported.modelHeadsStored, true);
  const read = await target.inspectModel({ modelHash: built.headModelHash, includeDefinition: true });
  assert.equal(read.model.revision.number, 7);
  // Inline too, and not for the viewer, which follows newer revisions itself.
  const inline = await exportConstructionHistory(built.service, { graphHash: built.graphHash, accessScopes: ['author'], includeModelHeads: true }, { maximumBytes: 64 * 1024 * 1024 });
  assert.deepEqual(inline.modelHeadHashes, [built.headModelHash]);
  assert.equal(inline.bundleSha256, exported.bundleSha256);
  const graphOnly = await exportConstructionHistory(built.service, { graphHash: built.graphHash, accessScopes: ['author'] }, { maximumBytes: 64 * 1024 * 1024 });
  assert.equal(graphOnly.models.length, 3);

  // Rebound to the newest revision, the graph no longer lags.
  const rebound = await rebindNarrativeGraph(built.service, { requestId: 'rebind', graphHash: built.graphHash, modelHash: built.headModelHash, accessScopes: ['author'] });
  assert.equal(rebound.lineageSteps, 5);
  const current = await exportConstructionHistory(built.service, { graphHash: rebound.graphHash, accessScopes: ['author'], destinationPath: join(directory, 'current.json') });
  assert.equal(current.modelLineage, undefined);
  assert.equal(current.modelCount, 8);
});

test('an export stays pinned when newer model revisions require additional scopes', async (t) => {
  const opened = await service(t);
  const { modelRequest, graphRequest } = await example();
  const first = await opened.registerModel(modelRequest);
  const graph = structuredClone(graphRequest.narrativeGraph);
  graph.source.model_hash = first.modelHash;
  const { graphHash } = await opened.registerNarrativeGraph({ ...graphRequest, narrativeGraph: graph });
  const before = await exportConstructionHistory(opened, { graphHash, accessScopes: ['author'] });
  const next = structuredClone(modelRequest.model);
  next.revision = { number: 1, previous_model_hash: first.modelHash, reason: 'Add a private viewpoint', provenance: ['scope regression'] };
  next.processes[0].access_scopes = ['private'];
  const revised = await opened.reviseModel({ requestId: 'scoped.next', previousModelHash: first.modelHash, model: next });
  const pinned = await exportConstructionHistory(opened, { graphHash, accessScopes: ['author'] });
  assert.deepEqual(pinned, before, 'future writes cannot change an export pinned to an earlier graph');
  await assert.rejects(exportConstructionHistory(opened, { graphHash, accessScopes: ['author'], includeModelHeads: true }), /scope/iu);
  const complete = await exportConstructionHistory(opened, { graphHash, accessScopes: ['author', 'private'], includeModelHeads: true });
  assert.equal(complete.models.length, 2);
  assert.deepEqual(complete.modelHeadHashes, [revised.modelHash]);
});

test('lineage walks read headers, with no bound on how far back', async (t) => {
  const opened = await service(t);
  const { modelRequest } = await example();
  const first = await opened.registerModel(modelRequest);
  const { modelHash: head } = await reviseMany(opened, first.modelHash, modelRequest.model, 300, 'long');
  let summaries = 0;
  const counted = new Proxy(opened, { get(target, key) {
    if (key === 'inspectModel') return (args) => { summaries += 1; return target.inspectModel(args); };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.equal(await modelLineageSteps(counted, first.modelHash, head), 300, 'past the 255 links a summary walk allows');
  assert.equal((await branchesOf(counted, head)).truncated, false);
  assert.equal(summaries, 0, 'no revision was rebuilt to walk its ancestry');
  const lineage = await opened.modelLineage({ modelHash: head, stopAt: first.modelHash });
  assert.equal(lineage.revisions.length, 301);
  assert.equal(lineage.revisions[0].reason, 'long 300');
  const heads = await opened.modelHeads({ descendingFrom: first.modelHash });
  assert.deepEqual(heads.map((item) => [item.modelHash, item.stepsFrom]), [[head, 300]]);
});

test('a history file is read one entry at a time, whatever its key order, and a malformed one is refused', async (t) => {
  const directory = await temporary(t);
  // Entries larger than the reader's chunk and entries many to a chunk.
  const big = { modelHash: 'a'.repeat(64), definition: { id: 'big', note: 'x'.repeat(3 * 1024 * 1024 + 7), unicode: 'Åsa 😀' } };
  const small = Array.from({ length: 2_000 }, (_, i) => ({ graphHash: i.toString(16).padStart(64, '0'), delta: { note: `step ${i} with a "quote" and a \\ backslash` } }));
  const body = { revisions: small, schema: 'meaning-model-construction-history/v1', models: [big], graphId: 'g', headGraphHash: 'b'.repeat(64), revisionCount: small.length };
  const path = join(directory, 'reordered.json');
  await writeFile(path, JSON.stringify(body, null, 1));
  const file = await openHistoryFile(path);
  t.after(() => file.close());
  assert.deepEqual(file.fields, { schema: body.schema, graphId: 'g', headGraphHash: body.headGraphHash, revisionCount: small.length });
  assert.equal(file.fileSha256, sha(await readFile(path)));
  const models = []; for await (const entry of file.entries('models')) models.push(entry.value);
  assert.deepEqual(models, [big]);
  let count = 0; for await (const entry of file.entries('revisions')) { assert.deepEqual(entry.value, small[count]); count += 1; }
  assert.equal(count, small.length);
  // A later reading must meet the bytes the first one did.
  const wrong = expandHistoryEntries(file.entries('models'), { count: 1, bases: [null], lastUse: [0] }, ['0'.repeat(64)]);
  await assert.rejects(wrong.next(), /changed while the file was read/u);

  for (const [name, text, message] of [
    ['trailing', `${JSON.stringify(body)} {}`, /content follows the closing brace/u],
    ['duplicate', `{"models":[],"models":[]}`, /appears twice/u],
    ['scalar-entry', `{"models":[1]}`, /entry 0 is not an object/u],
    ['unterminated', `{"models":[{"modelHash":"a"}`, /ends before its closing brace|ends inside an entry/u],
    ['not-a-list', `{"models":{}}`, /is not a list/u],
  ]) {
    const bad = join(directory, `${name}.json`);
    await writeFile(bad, text);
    await assert.rejects(async () => { const opened = await openHistoryFile(bad); try { for await (const _ of opened.entries('models')); } finally { await opened.close(); } }, message, name);
  }
  const notUtf8 = join(directory, 'not-utf8.json');
  await writeFile(notUtf8, Buffer.concat([Buffer.from('{"graphId":"'), Buffer.from([0xff, 0xfe]), Buffer.from('","models":[]}')]));
  await assert.rejects(openHistoryFile(notUtf8), /not valid UTF-8/u);
});

test('an import refuses a file that changes while it is read, before storing what changed', async (t) => {
  const directory = await temporary(t);
  const { service: opened, graphHash } = await construction(t, { revisionsAfter: 0, appends: 2 });
  const exported = await exportConstructionHistory(opened, { graphHash, accessScopes: ['author'], destinationPath: join(directory, 'history.json') });
  const target = await service(t);
  // Changed after its checksum was read, while its models are stored: a note's text, in place.
  const changing = new Proxy(target, { get(source, key) {
    if (key === 'registerModel') return async (args) => {
      const text = await readFile(exported.path, 'utf8');
      assert.ok(text.includes('Note 1 on the offer.'));
      await writeFile(exported.path, text.replace('Note 1 on the offer.', 'Note 1 on the offer!'));
      return source.registerModel(args);
    };
    const value = source[key];
    return typeof value === 'function' ? value.bind(source) : value;
  } });
  await assert.rejects(importConstructionHistory(changing, { requestId: 'changing', sourcePath: exported.path }), /Graph revision \d+ changed while the file was read/u);
  const listing = await target.listNarrativeRevisions({});
  assert.ok(listing.revisions.length <= 2, 'nothing after the changed revision was stored');
});

test('a writer that fails leaves no file and no temporary parts behind', async (t) => {
  const directory = await temporary(t);
  const writer = await HistoryFileWriter.create(join(directory, 'never.json'));
  await writer.addRevision({ graphHash: 'a'.repeat(64), definition: { id: 'g' } });
  await writer.abort();
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(directory), []);
  await writeFile(join(directory, 'taken.json'), '{}');
  await assert.rejects(HistoryFileWriter.create(join(directory, 'taken.json')), /never overwrite/u, 'refused before any work');
});

test('a long outline and a large definition are read in parts that join into the whole', async (t) => {
  const opened = await service(t);
  const { modelRequest } = await example();
  // Sixty more moments in the world, so the outline runs past one part.
  const model = structuredClone(modelRequest.model);
  const sample = model.meaning_model.events.find((event) => event.id === 'event.offer');
  for (let i = 0; i < 60; i += 1) {
    model.meaning_model.events.push({ ...structuredClone(sample), id: `event.extra.${i}`, boundary: `Extra moment ${i} in the harbour town, long enough to fill the outline.` });
    model.meaning_model.event_relations.push({ id: `world.contains.extra.${i}`, kind: 'contains', source_event_id: 'event.world', target_event_id: `event.extra.${i}`,
      description: 'Accepted-world containment.', authority: null, uncertainty: { kind: 'unknown' }, provenance: ['large constructions test'] });
  }
  const headModelHash = (await opened.registerModel({ requestId: 'wide', model })).modelHash;
  const whole = await outlineModel(opened, { modelHash: headModelHash, maxChars: 400_000 });
  assert.equal(whole.truncated, false);
  assert.equal(whole.nextCursor, undefined);
  const parts = [];
  let cursor;
  do {
    const part = await outlineModel(opened, { modelHash: headModelHash, maxChars: 2_000, ...(cursor ? { cursor } : {}) });
    parts.push(part.text.split('\n… (outline')[0]);
    cursor = part.nextCursor;
    if (cursor) assert.equal(part.part.sha256, sha(whole.text));
  } while (cursor);
  assert.ok(parts.length > 1, 'the outline came in parts');
  assert.equal(parts.join(''), whole.text);
  await assert.rejects(outlineModel(opened, { modelHash: headModelHash, maxChars: 2_000, sections: ['events'], cursor: (await outlineModel(opened, { modelHash: headModelHash, maxChars: 2_000 })).nextCursor }), /another outline read/u);

  // Text parts never split a character written as two UTF-16 units.
  const text = `${'a'.repeat(9)}😀${'b'.repeat(20)}`;
  const first = pagedText(text, { kind: 'definition', key: readKey({ test: true }), size: 10 });
  assert.equal(first.text, 'a'.repeat(9));
  const second = pagedText(text, { kind: 'definition', key: readKey({ test: true }), size: 10, cursor: first.nextCursor });
  assert.ok(second.text.startsWith('😀'));
  assert.throws(() => pagedText(text, { kind: 'outline', key: readKey({ test: true }), size: 10, cursor: first.nextCursor }), /not one for outline parts/u);
});
