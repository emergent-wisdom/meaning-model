import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { documentImportSchema, importDocument, registerDocumentImportTools } from '../src/document-import.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { noEventLinkDeclaration } from '../src/narrative-grounding.mjs';
import { buildModelGraph } from '../viewer/public/model-graph.js';

const provenance = ['Synthetic document-import integration fixture'];
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const byId = (nodes, id) => nodes.find((node) => node.id === id);
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
const segmentEvidence = (node) => JSON.parse(node.provenance.find((item) => item.startsWith('meaning-model:document-segment/v1:')).slice('meaning-model:document-segment/v1:'.length));

async function fixture(t) {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const modelDefinition = { schema: 'life-sim-rust-model/v1', id: 'document-import-model', time_unit: 'day',
    revision: { number: 0, reason: 'A stored model for synthetic source documents.', provenance },
    processes: [{ id: 'signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, uncertainty: { kind: 'exact' },
      unit: 'fraction', provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [] };
  const model = await service.registerModel({ requestId: 'model', model: modelDefinition });
  const read = (graphHash, accessScopes = []) => service.queryNarrativeGraph({
    graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes });
  const history = (graphId) => service.backend.call('list_narrative_revisions', { narrative_history: { graph_id: graphId } });
  const input = (overrides = {}) => ({ requestId: 'import-book', documentId: 'source.book', title: 'Synthetic book',
    modelHash: model.modelHash, text: 'First paragraph.\n\nSecond paragraph.', ...overrides });
  return { service, model, modelDefinition, read, history, input };
}

function orderedSegments(view, documentId) {
  return view.edges.filter((edge) => edge.relation === 'contains' && edge.source.node_id === documentId)
    .sort((a, b) => a.order - b.order).map((edge) => byId(view.nodes, edge.target.node_id));
}

async function existingGraph(f) {
  const container = (id, access_scopes = []) => ({ id, node_type: 'section', role: 'metadata', access_scopes,
    epistemic_status: 'test_fixture', evidence_type: 'report', render: 'exclude', training: 'exclude', provenance });
  const contains = (id, from, to, order, access_scopes = []) => ({ id, source: endpoint(from), target: endpoint(to),
    family: 'structural', relation: 'contains', order, access_scopes, provenance });
  const text = 'Existing manuscript stays intact.';
  return f.service.registerNarrativeGraph({ requestId: 'existing-graph', narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'existing-book',
    revision: { number: 0, reason: 'Existing mixed-access manuscript.', provenance },
    source: { kind: 'model', model_hash: f.model.modelHash }, roots: ['book'],
    nodes: [{ ...container('book'), role: 'document_root' }, container('restricted', ['author', 'shared']),
      container('hidden', ['secret']), { ...container('passage'), node_type: 'paragraph', role: 'story_passage',
        text, authority: { source: 'fixture', weight: 1 }, render: 'include',
        provenance: [...provenance, noEventLinkDeclaration(text, 'Synthetic fixture has no modeled Event depiction.', 'fixture')] }],
    edges: [contains('book.parent', 'book', 'restricted', 0, ['author', 'shared']),
      contains('book.hidden', 'book', 'hidden', 1, ['secret']), contains('book.passage', 'book', 'passage', 2)] } });
}

test('whole-book import preserves bytes, typed order, Unicode, whitespace and original byte ranges', async (t) => {
  const f = await fixture(t);
  const text = '\uFEFF  Opening\r\n\r\n' + 'Words with e\u0301, 漢字 and 🦉. '.repeat(25)
    + '\n\n\n' + '🦉'.repeat(400) + '\r\nFinal\t  \n';
  const imported = await importDocument(f.service, f.input({ text, targetBytes: 256 }));
  const view = await f.read(imported.graphHash);
  const segments = orderedSegments(view, imported.documentId);
  assert.ok(segments.length > 3, 'paragraph grouping and long-passage fallback both produce segments');
  assert.equal(segments.map((node) => node.text).join(''), text);
  assert.equal(imported.sourceBytes, Buffer.byteLength(text));
  assert.equal(imported.sourceSha256, sha256(text));
  assert.equal(imported.segmentCount, segments.length);
  assert.deepEqual(imported.accessScopes, []);
  assert.equal(imported.worldMutation, false);
  assert.equal(view.graph.source.model_hash, f.model.modelHash);
  const root = byId(view.nodes, imported.documentId);
  assert.equal(root.node_type, 'document.source');
  assert.equal(root.role, 'metadata', 'source metadata does not compete with manuscript document roots');
  const manifest = JSON.parse(root.text);
  assert.equal(manifest.sourceSha256, sha256(text));
  assert.equal(manifest.sourceBytes, Buffer.byteLength(text));
  let offset = 0;
  for (const node of segments) {
    assert.equal(node.node_type, 'document.segment');
    assert.equal(node.role, 'metadata');
    const evidence = segmentEvidence(node);
    assert.equal(evidence.originalSegmentId, node.id);
    assert.equal(evidence.positions, 'original_import_utf8_bytes');
    assert.equal(evidence.startByte, offset);
    offset += Buffer.byteLength(node.text);
    assert.equal(evidence.endByte, offset);
    assert.equal(evidence.textSha256, sha256(node.text));
    assert.equal(evidence.sourceSha256, sha256(text));
    assert.equal(Buffer.from(text).subarray(evidence.startByte, evidence.endByte).toString('utf8'), node.text);
  }
  for (const node of view.nodes) {
    assert.equal(node.render, 'exclude');
    assert.equal(node.training, 'exclude');
    assert.deepEqual(node.access_scopes, []);
  }
  assert.equal((await f.service.renderNarrativeGraph({ graphHash: imported.graphHash })).text, '');
  const graph = buildModelGraph({ model: f.modelDefinition, graph: view });
  assert.equal(graph.nodes.filter((node) => node.kind === 'narrative').length, view.nodes.length,
    'excluded source nodes are still inspectable in the native graph viewer');
  assert.equal(imported.schema, 'meaning-model-document-import/v1');
});

test('restricted attachment narrows to shared parent audiences without changing hidden records or rendering', async (t) => {
  const f = await fixture(t), original = await existingGraph(f);
  const allScopes = ['author', 'shared', 'secret', 'unrelated'];
  const before = await f.read(original.graphHash, allScopes);
  const renderedBefore = await f.service.renderNarrativeGraph({ graphHash: original.graphHash, accessScopes: allScopes });
  const input = f.input({ modelHash: undefined, graphHash: original.graphHash, parentNodeId: 'restricted',
    accessScopes: ['unrelated', 'author'] });
  const imported = await importDocument(f.service, input);
  assert.deepEqual(imported.accessScopes, ['author']);
  const after = await f.read(imported.graphHash, allScopes);
  for (const node of before.nodes) assert.deepEqual(byId(after.nodes, node.id), node);
  for (const edge of before.edges) assert.deepEqual(byId(after.edges, edge.id), edge);
  for (const node of after.nodes.filter((node) => !byId(before.nodes, node.id))) assert.deepEqual(node.access_scopes, ['author']);
  for (const edge of after.edges.filter((edge) => !byId(before.edges, edge.id))) assert.deepEqual(edge.access_scopes, ['author']);
  assert.ok(after.edges.some((edge) => edge.relation === 'source_for'
    && edge.source.node_id === imported.documentId && edge.target.node_id === 'restricted'));
  for (const accessScopes of [[], ['unrelated'], ['shared']]) {
    assert.equal(byId((await f.read(imported.graphHash, accessScopes)).nodes, imported.documentId), undefined);
  }
  assert.equal((await f.service.renderNarrativeGraph({ graphHash: imported.graphHash, accessScopes: allScopes })).text, renderedBefore.text);
  assert.deepEqual(await f.read(original.graphHash, allScopes), before, 'the predecessor remains immutable');
  const count = (await f.history('existing-book')).revisions.length;
  await assert.rejects(importDocument(f.service, { ...input, requestId: 'invisible-parent', accessScopes: ['unrelated'] }), /visible|inaccessible|unknown/i);
  assert.equal((await f.history('existing-book')).revisions.length, count);
});

test('public-parent attachment retains explicitly private source scopes and metadata root', async (t) => {
  const f = await fixture(t), original = await existingGraph(f);
  const imported = await importDocument(f.service, f.input({ modelHash: undefined, graphHash: original.graphHash,
    parentNodeId: 'book', accessScopes: ['private-source'] }));
  assert.deepEqual(imported.accessScopes, ['private-source']);
  assert.equal(byId((await f.read(imported.graphHash)).nodes, imported.documentId), undefined);
  assert.equal(byId((await f.read(imported.graphHash, ['private-source'])).nodes, imported.documentId).role, 'metadata');
});

test('private import metadata stays scoped in both new and attached graphs', async (t) => {
  const f = await fixture(t), existing = await existingGraph(f);
  for (const mode of ['new', 'attached']) {
    const documentId = `sensitive-document-identity-${mode}`;
    const title = `Sensitive title ${mode}`, sourceLabel = `Sensitive source file ${mode}.txt`;
    const recordedBy = `sensitive-recorder-${mode}`, text = `Sensitive source body ${mode}.`;
    const input = f.input({ requestId: `private-${mode}`, documentId, title, sourceLabel, recordedBy, text,
      accessScopes: ['private-source'], ...(mode === 'attached'
        ? { modelHash: undefined, graphHash: existing.graphHash, parentNodeId: 'book' } : {}) });
    const imported = await importDocument(f.service, input);
    assert.deepEqual(await importDocument(f.service, input), imported, 'opaque graph identity remains stable on retry');
    const publicView = await f.read(imported.graphHash);
    assert.equal(byId(publicView.nodes, documentId), undefined);
    for (const privateValue of [documentId, title, sourceLabel, recordedBy, text, sha256(text)]) {
      assert.ok(!JSON.stringify(publicView).includes(privateValue), `${mode} public projection does not reveal ${privateValue}`);
      assert.ok(!JSON.stringify(publicView.graph.revision).includes(privateValue));
    }
    if (mode === 'new') assert.match(publicView.graph.id, /^document\.[a-f0-9]{64}$/u);
    const privateView = await f.read(imported.graphHash, ['private-source']);
    const manifest = byId(privateView.nodes, documentId);
    assert.equal(manifest.title, title);
    assert.equal(JSON.parse(manifest.text).sourceLabel, sourceLabel);
    assert.equal(JSON.parse(manifest.text).sourceSha256, sha256(text));
    assert.equal(manifest.authority.source, recordedBy);
    assert.equal(byId(privateView.nodes, imported.firstSegmentId).text, text);
  }
});

test('ordinary later splits retain source text, import revision, excluded status and original order', async (t) => {
  const f = await fixture(t), text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
  const imported = await importDocument(f.service, f.input({ text, accessScopes: ['author'] }));
  const before = await f.read(imported.graphHash, ['author']);
  assert.equal(imported.segmentCount, 1);
  const input = { requestId: 'split-source', graphHash: imported.graphHash, accessScopes: ['author'],
    reason: 'Inspect smaller source portions.', operations: [{ kind: 'split', nodeId: imported.firstSegmentId,
      parts: [{ id: 'source.first', text: 'First paragraph.' }, { id: 'source.rest', text: 'Second paragraph.\n\nThird paragraph.' }] }] };
  const split = await editNarrativeGraph(f.service, input), after = await f.read(split.graphHash, ['author']);
  assert.deepEqual(await f.read(imported.graphHash, ['author']), before);
  assert.equal(byId(after.nodes, imported.firstSegmentId).text, text);
  assert.equal(orderedSegments(after, imported.documentId).map((node) => node.text).join(''), text);
  assert.equal(byId(after.nodes, imported.documentId).text, byId(before.nodes, imported.documentId).text);
  for (const id of ['source.first', 'source.rest']) {
    const child = byId(after.nodes, id);
    assert.equal(child.node_type, 'document.segment');
    assert.equal(child.render, 'exclude');
    assert.equal(child.training, 'exclude');
    assert.deepEqual(child.access_scopes, ['author']);
    assert.equal(segmentEvidence(child).originalSegmentId, imported.firstSegmentId,
      'inherited coordinates explicitly identify the original segment, not the split child');
  }
  assert.equal((await f.service.renderNarrativeGraph({ graphHash: split.graphHash, accessScopes: ['author'] })).text, '');
  assert.equal((await f.history(imported.summary.id)).revisions.length, 2);
  await assert.rejects(editNarrativeGraph(f.service, { ...input, requestId: 'bad-split',
    operations: [{ kind: 'split', nodeId: imported.firstSegmentId,
      parts: [{ id: 'bad.first', text: 'First' }, { id: 'bad.rest', text: 'paragraph.' }] }] }), /preserve the exact original text/);
  assert.equal((await f.history(imported.summary.id)).revisions.length, 2);
});

test('retries reuse receipts, changed requests fail, and duplicate attachment IDs fail atomically', async (t) => {
  const f = await fixture(t), input = f.input();
  const imported = await importDocument(f.service, input);
  assert.deepEqual(await importDocument(f.service, input), imported);
  await assert.rejects(importDocument(f.service, { ...input, text: 'Different source under the same request ID.' }), /already bound to a different/);
  assert.equal((await f.history(imported.summary.id)).revisions.length, 1);
  const original = await existingGraph(f);
  const attach = f.input({ requestId: 'attach', modelHash: undefined, graphHash: original.graphHash, parentNodeId: 'book' });
  const attached = await importDocument(f.service, attach);
  const before = await f.read(attached.graphHash, ['author', 'shared', 'secret']);
  await assert.rejects(importDocument(f.service, { ...attach, requestId: 'duplicate-document', graphHash: attached.graphHash }), /collid|duplicate/i);
  assert.equal((await f.history('existing-book')).revisions.length, 2);
  assert.deepEqual(await f.read(attached.graphHash, ['author', 'shared', 'secret']), before);
});

test('explicit UTF-8 source files preserve BOM and bytes without storing absolute paths', async (t) => {
  const f = await fixture(t), directory = await mkdtemp(join(tmpdir(), 'meaning-model-document-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'synthetic-book.md'), text = '\uFEFF# Synthetic\r\n\r\nSource 漢字 🦉.\n';
  await writeFile(sourcePath, text);
  const input = f.input({ text: undefined, sourcePath });
  const imported = await importDocument(f.service, input), view = await f.read(imported.graphHash);
  assert.equal(orderedSegments(view, imported.documentId).map((node) => node.text).join(''), text);
  assert.equal(imported.sourceLabel, 'synthetic-book.md');
  assert.ok(!JSON.stringify(view).includes(directory));
  assert.ok(!JSON.stringify(imported).includes(directory));
  assert.equal((await readFile(sourcePath)).toString('utf8'), text);
  await writeFile(sourcePath, text + 'Changed.');
  await assert.rejects(importDocument(f.service, input), /already bound to a different/);
  await writeFile(sourcePath, Buffer.from([0xc3, 0x28]));
  await assert.rejects(importDocument(f.service, { ...input, requestId: 'invalid-utf8' }), /UTF-8|utf-8|encoded|encoding/i);
  assert.equal((await f.history(imported.summary.id)).revisions.length, 1);
});

test('source and escaped graph limits reject before adding any graph revision', async (t) => {
  const f = await fixture(t), original = await existingGraph(f);
  const base = f.input({ modelHash: undefined, graphHash: original.graphHash, parentNodeId: 'book', targetBytes: 65_536 });
  await assert.rejects(importDocument(f.service, { ...base, requestId: 'source-too-large', text: '界'.repeat(1_398_102) }), /4 MiB|4194304|UTF-8 bytes|exceeds/i);
  await assert.rejects(importDocument(f.service, { ...base, requestId: 'payload-too-large', text: '\\'.repeat(4 * 1024 * 1024) }), /8388608|8 MiB|bytes|exceeds/i);
  assert.equal((await f.history('existing-book')).revisions.length, 1);
});

test('core tool registration executes source imports and rejects ambiguous source or binding inputs', async (t) => {
  const f = await fixture(t), registered = new Map();
  registerDocumentImportTools({ registerTool(name, definition, handler) { registered.set(name, { definition, handler }); } },
    f.service, { toolResult: (value) => ({ result: value }) });
  const tool = registered.get('life_document_import');
  assert.ok(tool);
  assert.equal(tool.definition.annotations.readOnlyHint, false);
  assert.equal(tool.definition.annotations.idempotentHint, true);
  const response = await tool.handler(f.input());
  assert.equal(response.result.segmentCount, 1);
  for (const extra of [{ sourcePath: '/tmp/synthetic-book.txt' }, { graphHash: f.model.modelHash, parentNodeId: 'book' },
    { parentNodeId: 'book' }, { text: undefined }, { targetBytes: 0 }]) {
    assert.equal(documentImportSchema.safeParse(f.input(extra)).success, false);
  }
});

test('an import that names Project Gutenberg says what that means for the text', async (t) => {
  const f = await fixture(t);
  const named = await importDocument(f.service, f.input({ requestId: 'named', documentId: 'source.named', text: 'A public-domain story.', sourceLabel: 'Project Gutenberg eBook #1661' }));
  assert.match(named.notices?.[0] ?? '', /license applies while its name is attached/);
  const clean = await importDocument(f.service, f.input({ requestId: 'clean', documentId: 'source.clean', text: 'A public-domain story.', sourceLabel: 'Arthur Conan Doyle, The Strand Magazine, 1891' }));
  assert.equal(clean.notices, undefined);
});
