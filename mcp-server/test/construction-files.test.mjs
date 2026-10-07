import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LifeSimulationService } from '../src/service.mjs';
import { exportConstructionHistory, importConstructionHistory, historyExportSchema, historyImportSchema, registerConstructionRecordTools } from '../src/construction-record.mjs';
import { historyDigest, historyJsonChunks, MAX_HISTORY_FILE_BYTES, MAX_INLINE_HISTORY_BYTES, readHistoryFile, writeHistoryFile } from '../src/construction-files.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const oldCanonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key,item[key]])) : item);
async function temporary(t) { const directory = await mkdtemp(join(tmpdir(), 'meaning-history-files-')); t.after(() => rm(directory,{recursive:true,force:true})); return directory; }

test('streamed canonical checksum exactly matches legacy JSON including integer keys and Unicode', () => {
  const value = { z: 'Åsa 😀 \n世界', nested: { '2': 'two', '10': 'ten', '01': 'leading', 'ä': 'quoted " text', 'a': null }, models: [{ definition: { initial_value: { value: { '10': 10, '2': 2, '01': 1 } } } }], omitted: undefined, array: [undefined,0,false,null] };
  const expected = oldCanonical(value), chunks = [...historyJsonChunks(value)];
  assert.equal(chunks.join(''), expected); assert.equal(historyDigest(value).sha256, digest(expected)); assert.equal(historyDigest(value).bytes, Buffer.byteLength(expected));
  assert.throws(() => historyDigest({ value: 'x'.repeat(MAX_INLINE_HISTORY_BYTES) }, MAX_INLINE_HISTORY_BYTES), /Use destinationPath/);
});

test('file paths are explicit and inline import remains mutually exclusive', () => {
  const graphHash = 'a'.repeat(64), history = { schema: 'meaning-model-construction-history/v1' };
  assert.throws(() => historyExportSchema.parse({ graphHash, destinationPath: 'relative.json' }));
  assert.throws(() => historyExportSchema.parse({ graphHash, destinationPath: '/tmp/../history.json' }));
  assert.throws(() => historyImportSchema.parse({ requestId: 'x' }));
  assert.throws(() => historyImportSchema.parse({ requestId: 'x', history, sourcePath: '/tmp/history.json' }));
  assert.deepEqual(historyImportSchema.parse({ requestId: 'x', history }).history, history);
});

test('file writes refuse collisions and absent directories; reads refuse symlinks and oversized files', async (t) => {
  const directory = await temporary(t), path = join(directory, 'history.json');
  const receipt = await writeHistoryFile(path, { greeting: 'Hello 😀' });
  assert.equal(receipt.fileSha256, digest(await readFile(path))); assert.equal(receipt.bytes, (await stat(path)).size);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(writeHistoryFile(path,{ overwritten:true }), /never overwrite/);
  assert.deepEqual((await readHistoryFile(path)).history, { greeting: 'Hello 😀' });
  await assert.rejects(writeHistoryFile(join(directory,'absent','history.json'),{}), /parent directory must already exist/);
  if (process.platform !== 'win32') {
    const link = join(directory,'link.json'); await symlink(path,link);
    await assert.rejects(readHistoryFile(link), /regular JSON file/);
  }
  await assert.rejects(readHistoryFile(directory), /regular JSON file/);
  const large = join(directory,'too-large.json'); await writeFile(large,''); await truncate(large,MAX_HISTORY_FILE_BYTES+1);
  await assert.rejects(readHistoryFile(large), /256 MiB/);
});

test('tampered, unchecked and malformed files are rejected before any service mutation', async (t) => {
  const directory = await temporary(t), path = join(directory,'bad.json'); let writes = 0;
  const service = { registerModel() { writes += 1; throw new Error('Must not mutate'); }, reviseModel() { writes += 1; throw new Error('Must not mutate'); }, registerNarrativeGraph() { writes += 1; throw new Error('Must not mutate'); } };
  const body = { schema: 'meaning-model-construction-history/v1', graphId:'g', headGraphHash:'b'.repeat(64), models:[{modelHash:'c'.repeat(64),definition:{id:'original'}}], revisions:[] };
  const signed = { ...body, bundleSha256: historyDigest(body).sha256 }; signed.models[0].definition.id = 'tampered';
  await writeFile(path,JSON.stringify(signed));
  await assert.rejects(importConstructionHistory(service,{ requestId:'bad',sourcePath:path }), /does not match its bundleSha256/);
  await writeFile(path,JSON.stringify(body));
  await assert.rejects(importConstructionHistory(service,{ requestId:'unsigned',sourcePath:path }), /must include its bundleSha256/);
  await writeFile(path,Buffer.from([0xff,0xfe]));
  await assert.rejects(importConstructionHistory(service,{ requestId:'utf8',sourcePath:path }));
  assert.equal(writes,0);
});

test('a real model and graph round-trip by file with compact receipts and unchanged source', async (t) => {
  const directory = await temporary(t), path = join(directory,'construction.json');
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md',import.meta.url),'utf8');
  const [,modelRequest,graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const source = new LifeSimulationService(), target = new LifeSimulationService(); t.after(() => Promise.all([source.close(),target.close()])); await source.initialize(); await target.initialize();
  const model = await source.registerModel(modelRequest); const graph = structuredClone(graphRequest.narrativeGraph); graph.source.model_hash = model.modelHash;
  const stored = await source.registerNarrativeGraph({ ...graphRequest,narrativeGraph:graph });
  const exported = await exportConstructionHistory(source,{ graphHash:stored.graphHash,accessScopes:['author'],destinationPath:path });
  assert.equal(exported.headGraphHash,stored.graphHash); assert.equal(exported.modelCount,1); assert.equal(exported.revisionCount,1);
  assert.equal(exported.models,undefined); assert.equal(exported.revisions,undefined); assert.ok(Buffer.byteLength(JSON.stringify(exported))<2048);
  const before = await readFile(path); const imported = await importConstructionHistory(target,{ requestId:'roundtrip',sourcePath:path });
  assert.equal(imported.verified,true); assert.equal(imported.headGraphHash,stored.graphHash); assert.equal(imported.sourceFile.fileSha256,exported.fileSha256);
  assert.deepEqual(await readFile(path),before);
  const original = await source.renderNarrativeGraph({graphHash:stored.graphHash,accessScopes:['author']});
  const restored = await target.renderNarrativeGraph({graphHash:imported.headGraphHash,accessScopes:['author']});
  assert.equal(restored.text,original.text);
  const inline = await exportConstructionHistory(source,{graphHash:stored.graphHash,accessScopes:['author']});
  assert.equal(inline.bundleSha256,exported.bundleSha256,'file transfer preserves the original bundle identity');
  await assert.rejects(exportConstructionHistory(source,{graphHash:stored.graphHash,accessScopes:['author'],destinationPath:path}),/never overwrite/);
  assert.deepEqual(await readFile(path),before);
});

test('the public inline tool refuses an oversized history before serializing a tool reply', async () => {
  const registrations = new Map(); let replied = false;
  const graphHash = 'a'.repeat(64), modelHash = 'b'.repeat(64);
  const definition = { schema:'life-sim-rust-narrative-graph/v1',id:'g',revision:{number:0,previous_graph_hash:null,reason:'r',provenance:[]},source:{kind:'model',model_hash:modelHash},roots:['p'],nodes:[{id:'p',role:'story_passage',text:'x'.repeat(MAX_INLINE_HISTORY_BYTES+1)}],edges:[] };
  const service = {
    async queryNarrativeGraph() { return { graph_hash:graphHash,content_included:true,for_revision:true,graph:{...definition,node_count:1,edge_count:0,root_count:1},roots:definition.roots,nodes:definition.nodes,edges:[] }; },
    async listNarrativeRevisions() { return {revisions:[{graph_hash:graphHash,previous_graph_hash:null}],heads:[graphHash]}; },
  };
  registerConstructionRecordTools({registerTool:(name,config,call)=>registrations.set(name,{config,call})},service,{toolResult:()=>{replied=true;}});
  assert.equal(registrations.get('life_construction_export').config.annotations.readOnlyHint,false);
  await assert.rejects(registrations.get('life_construction_export').call({graphHash}),/Use destinationPath/);
  assert.equal(replied,false);
});

test('export accounts for ancestor bytes while reading, before accumulating an oversized model chain', async () => {
  const graphHash = 'a'.repeat(64), firstModel = '1'.repeat(64); let reads = 0;
  const graph = {id:'g',source:{kind:'model',model_hash:firstModel},revision:{number:0,previous_graph_hash:null},node_count:0,edge_count:0,root_count:0};
  const service = {
    async queryNarrativeGraph() { return {graph_hash:graphHash,graph,content_included:true,for_revision:true,roots:[],nodes:[],edges:[]}; },
    async listNarrativeRevisions() { return {revisions:[{graph_hash:graphHash,previous_graph_hash:null}],heads:[graphHash]}; },
    async inspectModel({modelHash}) { reads += 1; const index=Number(modelHash[0]); return {modelHash,model:{id:'model',revision:{number:5-index,previous_model_hash:index<5?String(index+1).repeat(64):null},payload:'x'.repeat(600*1024)}}; },
  };
  await assert.rejects(exportConstructionHistory(service,{graphHash},{maximumBytes:MAX_INLINE_HISTORY_BYTES}),/Use destinationPath/);
  assert.equal(reads,2,'the five-model chain is stopped as soon as accumulated bytes exceed the limit');
});
