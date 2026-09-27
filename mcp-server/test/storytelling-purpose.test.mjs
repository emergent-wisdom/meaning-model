import { noEventLinkDeclaration } from '../src/narrative-grounding.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { LifeSimulationService } from '../src/service.mjs';
import { StorytellingAddon } from '../src/storytelling-addon.mjs';

const graphHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const projectionHash = 'c'.repeat(64);

function fixture() {
  const calls = [];
  const rendered = {
    graph_hash: graphHash,
    source_snapshot_hash: snapshotHash,
    projection_hash: projectionHash,
    sequence: ['chapter-2.opening', 'chapter-2.close'],
    text: 'The empty chair faced the sea.\n\nShe set a second cup beside her own.',
  };
  const view = { graph_hash: graphHash, source_snapshot_hash: snapshotHash, content_included: true,
    nodes: [{ id: 'chapter-2', role: 'section' }, ...rendered.sequence.map((id) => ({ id, role: 'story_passage' }))],
    edges: rendered.sequence.map((nodeId, order) => ({ family: 'structural', relation: 'contains', order,
      source: { kind: 'node', node_id: 'chapter-2' }, target: { kind: 'node', node_id: nodeId } })) };
  const addon = new StorytellingAddon({
    async renderNarrativeGraph(input) {
      calls.push(input);
      return structuredClone(rendered);
    },
    async queryNarrativeGraph() { return structuredClone(view); },
  });
  const input = { graphHash, rootId: 'chapter-2', accessScopes: ['editor', 'editor'] };
  return { calls, rendered, view, addon, input };
}

test('chapter purpose task uses exact scoped prose and source binding without inventing an evaluation', async () => {
  const f = fixture();
  const task = await f.addon.preparePurposeReview(f.input);
  assert.deepEqual(f.calls, [{ graphHash, expectedGraphHash: graphHash,
    rootIds: ['chapter-2'], accessScopes: ['editor'] }]);
  assert.equal(task.text, f.rendered.text);
  assert.equal(task.target.unit, 'chapter');
  assert.equal(task.target.sourceSnapshotHash, snapshotHash);
  assert.equal(task.target.projectionHash, projectionHash);
  assert.deepEqual(task.target.nodeIds, f.rendered.sequence);
  assert.equal(task.assessment, null);
  assert.equal(task.evaluator, 'calling_llm');
  assert.equal(task.advisoryOnly, true);
  assert.equal(task.worldMutation, false);
  assert.equal(task.graphMutation, false);
  assert.equal(task.readyToCommit, undefined);
  assert.equal(task.blockers, undefined);
  assert.equal(task.questions.length, 2);
});

test('goal attribution and review context are explicit and bound to the review task', async () => {
  const f = fixture();
  const inferred = await f.addon.preparePurposeReview(f.input);
  assert.equal(inferred.authorGoal, null);
  assert.equal(inferred.goalSource, 'not_supplied');
  const stated = await f.addon.preparePurposeReview({ ...f.input, unit: 'section',
    authorGoal: 'Let grief become visible through ordinary actions.',
    context: 'The absent person is named only in a later chapter.',
  });
  assert.equal(stated.goalSource, 'author_stated');
  assert.equal(stated.authorGoal, 'Let grief become visible through ordinary actions.');
  assert.equal(stated.context, 'The absent person is named only in a later chapter.');
  assert.notEqual(stated.taskHash, inferred.taskHash);
  assert.deepEqual(await f.addon.preparePurposeReview(f.input), inferred);
  f.rendered.text += ' She did not drink.';
  assert.notEqual((await f.addon.preparePurposeReview(f.input)).taskHash, inferred.taskHash);
});

test('review instructions protect uncertainty, multiple functions, and intentional quiet passages', async () => {
  const { addon, input } = fixture();
  const task = await addon.preparePurposeReview(input);
  assert.match(task.reviewerInstructions, /label the purpose as inferred/);
  assert.match(task.reviewerInstructions, /several purposes/);
  for (const functionOfProse of ['Atmosphere', 'ambiguity', 'breathing room', 'rhythm', 'characterization', 'delayed payoff']) {
    assert.ok(task.reviewerInstructions.includes(functionOfProse), functionOfProse);
  }
  assert.match(task.reviewerInstructions, /missing surrounding context/);
  assert.match(task.reviewerInstructions, /say unclear/);
  assert.match(task.reviewerInstructions, /valid to recommend keeping/);
  assert.match(task.reviewerInstructions, /Do not rewrite, change canon, or block saving/);
  assert.match(task.responseGuidance, /at most one revision suggestion, only if useful/);
});

test('empty or oversized material cannot silently turn into a partial chapter review', async () => {
  const f = fixture();
  f.rendered.text = ' \n ';
  await assert.rejects(f.addon.preparePurposeReview(f.input), /no visible rendered prose/);
  f.rendered.text = 'Quiet. '.repeat(45_000);
  await assert.rejects(f.addon.preparePurposeReview(f.input), /select a smaller section instead of truncating/);
});

test('a different graph projection and inaccessible selection cannot be passed off as the requested chapter', async () => {
  const f = fixture();
  f.rendered.graph_hash = 'd'.repeat(64);
  await assert.rejects(f.addon.preparePurposeReview(f.input), /exact requested graph/);
  const missing = new StorytellingAddon({
    async renderNarrativeGraph() { throw new Error('unknown or inaccessible narrative root chapter-2'); },
  });
  await assert.rejects(missing.preparePurposeReview(f.input), /inaccessible/);
});

test('invalid or oversized purpose input is rejected before querying the graph', async () => {
  const f = fixture();
  await assert.rejects(f.addon.preparePurposeReview({ ...f.input, accessScopes: 'editor' }));
  await assert.rejects(f.addon.preparePurposeReview({ ...f.input, context: 'x'.repeat(300_000) }), /UTF-8 bytes/);
  assert.deepEqual(f.calls, []);
});

test('native next chains cannot widen a chapter or scene review into later siblings; whole-book rendering is unchanged', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, modelRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const model = await service.registerModel(modelRequest);
  const graph = structuredClone(graphRequest.narrativeGraph); graph.source.model_hash = model.modelHash;
  const root = graph.nodes.find((node) => node.id === 'story');
  const passage = (id, text, render = 'include') => ({ ...root, id, node_type: 'chapter', role: 'story_passage', text, render, provenance: [...(root.provenance ?? []), noEventLinkDeclaration(text, 'Review-boundary fixture prose is independent of the sample model Events.', 'fixture-author')] });
  graph.nodes = [root, passage('chapter.09', 'IX. Neale waits for Wills to name the unreadable figure.'),
    passage('chapter.10', 'X. They accept too much work.'), passage('scene.11', '', 'exclude'),
    passage('scene.11.a', 'Wills asks for the figure again.'), passage('scene.11.b', 'Neale repeats it.'),
    passage('chapter.12', 'XII. They close the office.')];
  const edge = (source, target, relation, order) => ({ id: `${source}.${relation}.${target}`, family: 'structural', relation,
    source: { kind: 'node', node_id: source }, target: { kind: 'node', node_id: target }, order, provenance: ['review-unit-regression'] });
  graph.edges = ['chapter.09', 'chapter.10', 'scene.11', 'chapter.12'].map((id, index) => edge('story', id, 'contains', index));
  graph.edges.push(edge('chapter.09', 'chapter.10', 'next', 0), edge('chapter.10', 'scene.11', 'next', 0),
    edge('scene.11', 'scene.11.a', 'contains', 0), edge('scene.11', 'scene.11.b', 'contains', 1),
    edge('scene.11.b', 'chapter.12', 'next', 0));
  const stored = await service.registerNarrativeGraph({ requestId: 'review-unit-graph', narrativeGraph: graph });
  const args = { graphHash: stored.graphHash, expectedGraphHash: stored.graphHash, accessScopes: [] };
  const nativeChapter = await service.renderNarrativeGraph({ ...args, rootIds: ['chapter.09'] });
  assert.deepEqual(nativeChapter.sequence, ['chapter.09', 'chapter.10', 'scene.11.a', 'scene.11.b', 'chapter.12'], 'native next traversal demonstrates the original review-boundary bug');
  const whole = await service.renderNarrativeGraph({ ...args, rootIds: ['story'] });
  const addon = new StorytellingAddon(service);
  const chapter = await addon.preparePurposeReview({ graphHash: stored.graphHash, rootId: 'chapter.09', unit: 'chapter', accessScopes: [] });
  assert.deepEqual(chapter.target.nodeIds, ['chapter.09']);
  assert.equal(chapter.text, graph.nodes.find((node) => node.id === 'chapter.09').text);
  assert.equal(chapter.target.nativeProjectionHash, nativeChapter.projection_hash);
  assert.notEqual(chapter.target.projectionHash, nativeChapter.projection_hash);
  assert.equal(chapter.target.projectionKind, 'contains_subtree');
  const scene = await addon.preparePurposeReview({ graphHash: stored.graphHash, rootId: 'scene.11', unit: 'section', accessScopes: [] });
  assert.deepEqual(scene.target.nodeIds, ['scene.11.a', 'scene.11.b']);
  assert.equal(scene.text, 'Wills asks for the figure again.\n\nNeale repeats it.');
  const book = await addon.preparePurposeReview({ graphHash: stored.graphHash, rootId: 'story', unit: 'whole_work', accessScopes: [] });
  assert.equal(book.text, whole.text); assert.equal(book.target.projectionHash, whole.projection_hash);
  assert.deepEqual(await service.renderNarrativeGraph({ ...args, rootIds: ['story'] }), whole, 'local review projection does not alter native rendering');
});
