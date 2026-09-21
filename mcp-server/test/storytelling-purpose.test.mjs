import assert from 'node:assert/strict';
import test from 'node:test';
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
  const addon = new StorytellingAddon({
    async renderNarrativeGraph(input) {
      calls.push(input);
      return structuredClone(rendered);
    },
  });
  const input = { graphHash, rootId: 'chapter-2', accessScopes: ['editor', 'editor'] };
  return { calls, rendered, addon, input };
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
