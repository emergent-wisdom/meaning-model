import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LifeSimulationService } from '../../mcp-server/src/service.mjs';
import { importConstructionHistory, outlineModel, replayConstruction } from '../../mcp-server/src/construction-record.mjs';

const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here));
const json = (name) => JSON.parse(read(name).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scopes = ['story-author'];

test('the example files match their manifest', () => {
  const manifest = json('MANIFEST.json');
  for (const [file, digest] of Object.entries(manifest.files)) assert.equal(sha256(read(file)), digest, file);
  assert.equal(sha256(read('story.md')), manifest.source.storyTextSha256);
});

test('a fresh engine rebuilds the whole construction from history.json, and every packaged file follows from it', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const manifest = json('MANIFEST.json').source;
  const history = json('history.json');
  assert.equal(history.bundleSha256, manifest.historyBundleSha256);

  // Every model and graph revision is rebuilt and its hash checked against the exported one.
  const imported = await importConstructionHistory(service, { requestId: 'example.history', history });
  assert.equal(imported.verified, true);
  assert.equal(imported.headGraphHash, manifest.graphHash);
  assert.deepEqual([imported.revisions, imported.models], [manifest.historyRevisions, manifest.historyModels]);
  const head = imported.headGraphHash;

  const rendered = await service.renderNarrativeGraph({ graphHash: head, expectedGraphHash: head, rootIds: ['story'], accessScopes: scopes });
  assert.equal(rendered.text, read('story.md').toString('utf8'), 'the head renders the story byte for byte');
  const view = await service.queryNarrativeGraph({ graphHash: head, mode: 'full', includeContent: true, accessScopes: scopes, forRevision: true });
  const graph = json('graph.json');
  assert.deepEqual([view.nodes, view.edges, view.roots], [graph.nodes, graph.edges, graph.roots], 'graph.json is the head revision');
  const { model } = await service.inspectModel({ modelHash: view.graph.source.model_hash, includeDefinition: true });
  assert.deepEqual(model, json('model.json'), 'model.json is the model the head is bound to');

  // REPLAY.md is the whole outline-level replay, page after page; OUTLINE.md is the present state with first lines of notes.
  let offset = 0; const parts = [];
  while (offset !== null) {
    const page = await replayConstruction(service, { graphHash: head, accessScopes: scopes, level: 'outline', offset, limit: 80, maxChars: 400_000 });
    let text = page.text.replace(/\n… continue with offset \d+$/u, '');
    if (offset > 0) text = text.replace(/^# Construction of .*\n/u, '');
    parts.push(text.trim()); offset = page.window.nextOffset;
  }
  assert.equal(`${parts.join('\n\n')}\n`, read('REPLAY.md').toString('utf8'));
  const outline = await outlineModel(service, { graphHash: head, accessScopes: scopes, understanding: 'first_line', maxChars: 400_000 });
  assert.equal(`${outline.text}\n`, read('OUTLINE.md').toString('utf8'));
  assert.deepEqual(outline.coverage.undescribedNumbers, [], 'every Event that carries a Cut is described');

  // Each blind review is held by its reader, names the exact text it read, and is answered by the deepening plan that followed it.
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const linked = (from, relation, to) => view.edges.some((edge) => edge.source.node_id === from && edge.relation === relation && edge.target.node_id === to);
  for (let reader = 1; reader <= 5; reader += 1) {
    const review = byId.get(`review.reader.${reader}`);
    assert.equal(review.holder, `reader:claude-opus-5-5:blind-${reader}`);
    const { data } = JSON.parse(review.text);
    assert.equal(data.independence, 'blind');
    assert.equal(data.reviewed.materials, 'rendered_text');
    assert.equal(data.reviewed.textMatchesRender, true, `reader ${reader} read exactly the render of the revision it names`);
    assert.ok(linked(`deepen-${reader}-plan`, 'answers', `review.reader.${reader}`), `deepening pass ${reader} answers reader ${reader}`);
    assert.ok(linked(`review.reader.${reader}`, 'supersedes', `independent-reader-${reader}`), `the review supersedes the report the recording agent first filed for reader ${reader}`);
  }
});
