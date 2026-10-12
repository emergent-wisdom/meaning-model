// Import the published Book through the same public MCP tools as a downloaded model.
// This creates a new local database; it neither regenerates the story nor edits a writer's state.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../../mcp-server/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { StdioClientTransport } from '../../mcp-server/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';
import { applyNarrativeDefinitionDelta } from '../../mcp-server/src/narrative-delta.mjs';
import { expandHistoryModels, planHistoryModels, readHistoryFile } from '../../mcp-server/src/construction-files.mjs';
import { stringifyJson } from '../../mcp-server/src/exact-json.mjs';

export const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../..');
export const defaultEngine = process.env.LIFE_SIM_ENGINE_BIN
  || path.join(repo, 'rust-engine/target/release/life-sim-engine');
const bundleName = 'the-book-of-conditions.meaning-model.json';
const manifestName = 'PUBLICATION-MANIFEST.json';
const proseName = 'BOOK-DRAFT.md';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (out, name, value) => fs.writeFileSync(path.join(out, name), `${stringifyJson(value, null, 2)}\n`, { flag: 'wx' });

export async function readEdition(sourceDirectory = directory) {
  const files = Object.fromEntries([manifestName, proseName].map(name => [name, fs.readFileSync(path.join(sourceDirectory, name))]));
  const manifest = JSON.parse(files[manifestName]);
  const { history: bundle, fileSha256 } = await readHistoryFile(path.resolve(sourceDirectory, bundleName));
  for (const field of ['graphHash', 'modelHash', 'proseSha256']) assert.match(manifest[field] ?? '', /^[a-f0-9]{64}$/, `Missing or invalid ${field} in ${manifestName}`);
  assert.equal(typeof manifest.rootId, 'string');
  assert(manifest.rootId.length > 0 && Array.isArray(manifest.accessScopes));
  assert(manifest.accessScopes.every(scope => typeof scope === 'string'));
  assert.equal(digest(files[proseName]), manifest.proseSha256, 'The manuscript does not match the publication manifest');
  if (manifest.fileSha256) assert.equal(fileSha256, manifest.fileSha256, 'The bundle does not match the publication manifest');
  const plan = planHistoryModels(bundle);
  assert.equal(bundle.headGraphHash, manifest.graphHash);
  // Preserve the complete history from its first graph revision.
  // Import verifies every stored hash; this check rejects missing ancestry before import.
  assert.equal(bundle.revisions.length, manifest.constructionHistory.graphRevisions);
  assert.equal(bundle.revisionCount, bundle.revisions.length);
  assert.equal(bundle.models.length, manifest.constructionHistory.storedModelDefinitions);
  let graph = bundle.revisions[0].definition;
  assert(graph && !bundle.revisions[0].delta);
  assert.equal(graph.revision.number, 0);
  assert(!graph.revision.previous_graph_hash, 'The history must begin at its first graph revision');
  for (let index = 1; index < bundle.revisions.length; index += 1) {
    const entry = bundle.revisions[index];
    const revision = (entry.definition ?? entry.delta).revision;
    assert.equal(revision.number, graph.revision.number + 1);
    assert.equal(revision.previous_graph_hash, bundle.revisions[index - 1].graphHash, 'Every graph predecessor must be included');
    graph = entry.definition ?? applyNarrativeDefinitionDelta(graph, entry.delta);
  }
  assert.equal(bundle.revisions.at(-1).graphHash, manifest.graphHash);
  assert.equal(graph.revision.number, manifest.graphRevision);
  assert.equal(graph.source.model_hash, manifest.modelHash);
  // Keep only ancestry metadata while the shared reader expands each model within its memory limits.
  const models = new Map();
  for (const { modelHash, definition } of expandHistoryModels(bundle, plan)) {
    models.set(modelHash, { number: definition.revision.number, previous_model_hash: definition.revision.previous_model_hash });
  }
  assert(models.has(manifest.modelHash));
  assert.equal(models.get(manifest.modelHash).number, manifest.modelRevision);
  for (const revision of models.values()) {
    const previous = revision.previous_model_hash;
    if (previous) {
      assert(models.has(previous), 'Every native model predecessor must be included');
      assert.equal(revision.number, models.get(previous).number + 1);
    } else assert.equal(revision.number, 0, 'Only a model root may omit its predecessor');
  }
  return { manifest, bundle, prose: files[proseName].toString('utf8'),
    sourceHashes: { [bundleName]: fileSha256, ...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])) } };
}

function authorReferences(graph) {
  return graph.nodes.flatMap(node => {
    if (node.node_type !== 'storytelling.world') return [];
    let record; try { record = JSON.parse(node.text); } catch { return []; }
    const author = record?.data?.author;
    return record.schema === 'meaning-model-story-author-record/v1'
      && record.data?.schema === 'meaning-model-story-world/v1'
      && record.data.stage === 'author_reader' && author?.lifeModelHash
      ? [{ name: author.name, modelHash: author.lifeModelHash, personId: author.personId, declarationNodeId: node.id }] : [];
  });
}

function authorPersonas(graph) {
  return graph.nodes.flatMap(node => {
    if (node.node_type !== 'storytelling.author_model') return [];
    let record; try { record = JSON.parse(node.text); } catch { return []; }
    if (record.schema !== 'meaning-model-story-author-record/v1'
      || record.data?.schema !== 'meaning-model-story-author-model/v1') return [];
    const { modeledAuthorId, mode, label } = record.data;
    return [{ nodeId: node.id, modeledAuthorId, mode, label }];
  });
}

function verifyReviewerCorrections(graph, expected) {
  if (!expected) return [];
  assert.equal(expected.correctedNodeIds.length, expected.supersededNodeIds.length);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  return expected.correctedNodeIds.map((id, index) => {
    const originalId = expected.supersededNodeIds[index];
    const corrected = JSON.parse(byId.get(id)?.text ?? 'null');
    const original = JSON.parse(byId.get(originalId)?.text ?? 'null');
    assert.equal(corrected?.schema, 'meaning-model-review/v1');
    assert.equal(original?.schema, 'meaning-model-review/v1');
    assert.equal(original.data.reviewer.kind, 'human', 'Keep the mistaken identity as superseded history');
    for (const [field, value] of Object.entries(expected.reviewer)) assert.equal(corrected.data.reviewer[field], value);
    assert.equal(corrected.data.independence, 'blind');
    assert.deepEqual(corrected.data.verdict, original.data.verdict, 'The recorded verdict must stay the same');
    assert.equal(corrected.data.findings.length, original.data.findings.length);
    const textChanges = [];
    corrected.data.findings.forEach((finding, findingIndex) => {
      const { text, ...classification } = finding;
      const { text: originalText, ...originalClassification } = original.data.findings[findingIndex];
      assert.deepEqual(classification, originalClassification, 'Finding categories, severities and quotations must be preserved');
      if (text !== originalText) textChanges.push({ nodeId: id, findingIndex,
        originalTextSha256: digest(originalText), correctedTextSha256: digest(text) });
    });
    assert.deepEqual(textChanges, (expected.findingTextChanges ?? []).filter(change => change.nodeId === id),
      'Any paraphrased finding text must match the publication record exactly');
    for (const field of ['graphHash', 'revision', 'modelHash', 'renderSha256']) assert.deepEqual(corrected.data.reviewed[field], original.data.reviewed[field], 'The correction must keep the material actually reviewed');
    assert(graph.edges.some(edge => edge.family === 'semantic' && edge.relation === 'supersedes'
      && edge.source.kind === 'node' && edge.source.node_id === id
      && edge.target.kind === 'node' && edge.target.node_id === originalId), 'The corrected review must explicitly supersede its original');
    return { nodeId: id, supersedes: originalId, reviewer: corrected.data.reviewer,
      reviewedGraphHash: corrected.data.reviewed.graphHash, findingTextChanges: textChanges };
  });
}

export async function runImport(outputDirectory, binary = defaultEngine) {
  const out = path.resolve(outputDirectory);
  assert(!fs.existsSync(out), 'The output directory already exists and is never overwritten; choose a fresh directory.');
  const edition = await readEdition();
  const { manifest } = edition;
  assert(fs.existsSync(binary), `Engine not found: ${binary}. Run make build first.`);
  fs.mkdirSync(out, { recursive: true });
  const env = { ...process.env, LIFE_SIM_ENGINE_BIN: path.resolve(binary), LIFE_SIM_STATE_FILE: path.join(out, 'construction.sqlite'),
    MEANING_MODEL_ADDONS: 'storytelling', MEANING_MODEL_ESTIMATOR: '' };
  delete env.MEANING_MODEL_READING;
  const client = new Client({ name: 'book-of-conditions-example-import', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(repo, 'mcp-server/bin/meaning-model-mcp.mjs')], env, stderr: 'pipe' });
  const stderr = fs.createWriteStream(path.join(out, 'server.log'), { flags: 'wx' });
  transport.stderr?.pipe(stderr);
  try {
    await client.connect(transport);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
      if (result.isError) throw new Error(`${name}: ${result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n')}`);
      assert(result.structuredContent, `${name} returned no structured result`);
      return result.structuredContent;
    };
    const status = await call('life_engine_status', {});
    assert.equal(status.persistence.rustAuthority, 'optional-single-writer-state-file', 'Import requires the new persistent SQLite database');
    writeJson(out, 'engine-status.json', status);
    const imported = await call('life_construction_import', { requestId: 'import-published-book', sourcePath: path.join(directory, bundleName) });
    assert.equal(imported.verified, true);
    assert.equal(imported.headGraphHash, manifest.graphHash);
    assert.equal(imported.revisions, manifest.constructionHistory.graphRevisions);
    assert.equal(imported.models, manifest.constructionHistory.storedModelDefinitions);
    writeJson(out, 'import.json', imported);
    const model = await call('life_model_inspect', { modelHash: manifest.modelHash, includeDefinition: true });
    assert.equal(model.modelHash, manifest.modelHash);
    writeJson(out, 'model.json', model.model);
    const graph = await call('life_narrative_query', { graphHash: manifest.graphHash, expectedGraphHash: manifest.graphHash,
      accessScopes: manifest.accessScopes, mode: 'full', includeContent: true, forRevision: true });
    assert.equal(graph.graph_hash, manifest.graphHash);
    assert.equal(graph.graph.source.model_hash, manifest.modelHash);
    writeJson(out, 'graph.json', graph);
    const rendered = await call('life_narrative_render', { graphHash: manifest.graphHash, expectedGraphHash: manifest.graphHash,
      rootIds: [manifest.rootId], accessScopes: manifest.accessScopes });
    assert.equal(rendered.text, edition.prose, 'Imported prose must equal BOOK-DRAFT.md byte for byte');
    fs.writeFileSync(path.join(out, 'rendered.md'), rendered.text, { flag: 'wx' });
    writeJson(out, 'render.json', rendered);
    const projection = await call('life_document_project', { graphHash: manifest.graphHash, rootId: manifest.rootId, accessScopes: manifest.accessScopes });
    assert.equal(projection.processes.length, manifest.inventory.tellingProcesses, 'Verify the actual telling inventory, including its absence');
    assert.equal(projection.processes.reduce((count, process) => count + process.states.length, 0), manifest.inventory.tellingPhases);
    writeJson(out, 'document-projection.json', projection);
    const authors = authorReferences(graph);
    const inspectedAuthors = [];
    for (const author of authors) {
      const life = await call('life_model_inspect', { modelHash: author.modelHash, includeDefinition: true });
      assert.equal(life.modelHash, author.modelHash);
      assert(life.model.meaning_model.referents.some(person => person.id === author.personId), 'Author life must contain its declared person');
      if (!inspectedAuthors.some(item => item.modelHash === author.modelHash)) {
        writeJson(out, `author-${author.modelHash}.json`, life.model);
        inspectedAuthors.push(author);
      }
    }
    for (const expected of manifest.authorDependencies ?? []) assert(inspectedAuthors.some(author => author.modelHash === expected.modelHash && author.name === expected.name), 'Declared author dependency is missing');
    assert.equal(inspectedAuthors.length, (manifest.authorDependencies ?? []).length, 'The actual external author lives must match the publication record');
    const personas = authorPersonas(graph);
    assert.deepEqual(personas, manifest.authorPersonas ?? [], 'Keep the actual authored persona distinct from a native author-life model');
    const reviewerCorrections = verifyReviewerCorrections(graph, manifest.reviewerCorrection);
    // The replay returns at most 80 revisions per page; read every page so the check covers the whole history.
    const pages = [];
    for (let offset = 0; offset !== null;) {
      const page = await call('life_construction_replay', { graphHash: manifest.graphHash, accessScopes: manifest.accessScopes,
        level: 'outline', format: 'json', offset, limit: 80, maxChars: 400_000 });
      assert.equal(page.revisionCount, manifest.constructionHistory.graphRevisions, 'The complete construction history must survive import');
      assert.equal(page.truncated, false);
      pages.push(page);
      offset = page.window.nextOffset;
    }
    const replay = { ...pages[0], window: { offset: 0, pages: pages.length, nextOffset: null }, steps: pages.flatMap(page => page.steps) };
    assert.equal(replay.steps.length, manifest.constructionHistory.graphRevisions, 'The replay check must cover every exported revision');
    writeJson(out, 'construction-replay.json', replay);
    const saved = await call('life_saved_work_list', { accessScopes: manifest.accessScopes });
    assert.equal(saved.heads.length, 1);
    assert.equal(saved.heads[0].graphHash, manifest.graphHash);
    assert.equal(saved.window.nextOffset, null);
    writeJson(out, 'saved-work.json', saved);
    const receipt = { schema: 'meaning-model-book-example-import/v1', graphHash: manifest.graphHash,
      modelHash: manifest.modelHash, rootId: manifest.rootId, accessScopes: manifest.accessScopes,
      sourceHashes: edition.sourceHashes, proseSha256: digest(rendered.text),
      authors: inspectedAuthors, personas, reviewerCorrections, graphRevisionCount: replay.revisionCount,
      storedModelCount: imported.models, currentModelCount: inspectedAuthors.length + 1,
      tellingProcessCount: projection.processes.length, tellingPhaseCount: projection.processes.reduce((count, process) => count + process.states.length, 0),
      exactManuscript: true, verified: true };
    writeJson(out, 'receipt.json', receipt);
    return receipt;
  } finally {
    await client.close();
    await new Promise(resolve => stderr.end(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, binary] = process.argv.slice(2);
  if (!output || process.argv.length > 4) {
    console.error('Usage: node examples/book-of-conditions/import-rust.mjs fresh-output-directory [engine-binary]');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await runImport(output, binary), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
