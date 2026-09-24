// Releasing a story's prose to readers: readers see what the render shows and nothing the author cut or kept
// back (cases from the review of the fixes branch, 2026-09-24).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { releaseStory } from '../src/storytelling-release.mjs';
import { direct, directorPrinciples } from '../src/storytelling-director.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';

const provenance = ['release test'];
const author = ['story-author'];
const scene = (id, text, scopes, extra = {}) => ({ id, node_type: 'storytelling.scene', role: 'story_passage', text, epistemic_status: 'authored_scene', evidence_type: 'fictional_canon',
  authority: { source: 'author', weight: 1 }, access_scopes: scopes, render: 'include', training: 'exclude', provenance, ...extra });
const contains = (id, from, to, order, scopes) => ({ id, source: { kind: 'node', node_id: from }, target: { kind: 'node', node_id: to }, family: 'structural', relation: 'contains', order, access_scopes: scopes, provenance });
const release = (service, graphHash, extra = {}) => releaseStory(service, { graphHash, requestId: `release-${Math.random()}`, nodeId: `author.release.${Math.random().toString(36).slice(2, 8)}`,
  storyRootId: 'story', authorId: 'author', accessScopes: author, releaseTo: ['reader'], reason: 'The human approved publishing.', ...extra });

// A release needs a draft direction first; this one finds the ending failing unless told otherwise.
const directed = async (service, graphHash, { failing = false } = {}) => (await direct(service, { graphHash, requestId: `direct-${Math.random()}`,
  storyRootId: 'story', accessScopes: author, stage: 'draft', directorId: 'fresh-reader', independent: true, nodeId: `direction.${Math.random().toString(36).slice(2, 8)}`,
  summary: 'The director read the draft.', findings: directorPrinciples.filter((item) => item.stage === 'draft').map((item) => ({ principleId: item.id,
    verdict: failing && item.id === 'draft.ending' ? 'fails' : 'holds', evidence: 'The test draft was read against this principle.',
    modelChange: failing && item.id === 'draft.ending' ? 'Model what each principal pays for the ending.' : null })) })).graphHash;

async function setup(t, nodes, edges) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel({ requestId: 'model', model: registerRequest.model });
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'release-test',
    revision: { number: 0, reason: 'Release test.', provenance }, source: { kind: 'model', model_hash: registered.modelHash }, roots: ['story'],
    nodes: [{ ...scene('story', '# Title', []), node_type: 'story', role: 'document_root' }, ...nodes], edges } });
  const read = async (graphHash, accessScopes) => service.queryNarrativeGraph({ graphHash, mode: 'full', includeContent: true, accessScopes });
  const render = async (graphHash, accessScopes) => (await service.renderNarrativeGraph({ graphHash, rootIds: ['story'], accessScopes })).text;
  return { service, graphHash: stored.graphHash, read, render };
}

test('text the author cut from a split scene never reaches readers', async (t) => {
  const f = await setup(t, [scene('scene.1', 'She reached the door.\n\nThe killer was her brother all along.', author)], [contains('story.s1', 'story', 'scene.1', 0, author)]);
  const split = await editNarrativeGraph(f.service, { requestId: 'split', graphHash: f.graphHash, accessScopes: author, reason: 'Split into beats.',
    operations: [{ kind: 'split', nodeId: 'scene.1', parts: [{ id: 'scene.1.a', text: 'She reached the door.' }, { id: 'scene.1.b', text: 'The killer was her brother all along.' }] }] });
  const cut = await editNarrativeGraph(f.service, { requestId: 'cut', graphHash: split.graphHash, accessScopes: author, reason: 'Keep the reveal for the last chapter.',
    operations: [{ kind: 'replace_text', nodeId: 'scene.1.b', expectedText: 'The killer was her brother all along.', text: 'Nobody answered.' }] });
  const ready = await directed(f.service, cut.graphHash);
  await assert.rejects(release(f.service, ready), /Containers scene\.1 hold text the render does not show/);
  const released = await release(f.service, ready, { clearHiddenText: true });
  assert.deepEqual(released.clearedHiddenTextNodeIds, ['scene.1']);
  assert.equal(await f.render(released.graphHash, ['reader']), await f.render(cut.graphHash, author), 'a reader sees exactly what the author renders');
  const asReader = await f.read(released.graphHash, ['reader']);
  assert.ok(!asReader.nodes.some((node) => String(node.text ?? '').includes('brother')), 'the cut line is nowhere a reader can query');
});

test('a release never narrows prose that is already public, and reaches scenes inside chapters', async (t) => {
  const chapter = { id: 'chapter.1', node_type: 'section', role: 'metadata', text: '', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon',
    authority: { source: 'author', weight: 1 }, access_scopes: author, render: 'exclude', training: 'exclude', provenance };
  const f = await setup(t, [
    scene('scene.1', 'The first scene, released to everyone earlier.', []),
    chapter,
    scene('scene.2', 'The second scene, inside a chapter.', author),
    scene('scene.cut', 'A scene the author dropped.', author, { render: 'exclude' }),
  ], [contains('story.s1', 'story', 'scene.1', 0, []), contains('story.c1', 'story', 'chapter.1', 1, author),
    contains('chapter.s2', 'chapter.1', 'scene.2', 0, author), contains('chapter.cut', 'chapter.1', 'scene.cut', 1, author)]);
  const released = await release(f.service, await directed(f.service, f.graphHash));
  assert.deepEqual(released.releasedNodeIds, ['chapter.1', 'scene.2'], 'the public scene is left alone and the dropped scene is not released');
  const after = await f.read(released.graphHash, [...author, 'reader']);
  assert.deepEqual(after.nodes.find((node) => node.id === 'scene.1').access_scopes, []);
  assert.deepEqual(after.nodes.find((node) => node.id === 'scene.cut').access_scopes, author);
  assert.equal(await f.render(released.graphHash, []), '# Title\n\nThe first scene, released to everyone earlier.', 'public readers keep what they had');
  assert.match(await f.render(released.graphHash, ['reader']), /The second scene, inside a chapter\./);
  await assert.rejects(releaseStory(f.service, { graphHash: f.graphHash, requestId: 'r', nodeId: 'n', storyRootId: 'story', authorId: 'author', accessScopes: author, reason: 'x' }), /releaseTo/,
    'publishing to everyone is always explicit');
});

test('a story is released only after the director has read the draft and its failures were answered in the model', async (t) => {
  const f = await setup(t, [scene('scene.1', 'She reached the door.', author)], [contains('story.s1', 'story', 'scene.1', 0, author)]);
  await assert.rejects(release(f.service, f.graphHash), /Run the director on the draft before release/);
  const failing = await directed(f.service, f.graphHash, { failing: true });
  await assert.rejects(release(f.service, failing), /not yet answered in the model: .*draft\.ending.*the bound model has not changed since/);
  const passing = await directed(f.service, failing);
  await assert.rejects(release(f.service, passing), /draft\.ending/, 'a later passing direction does not answer the earlier failure');
});
