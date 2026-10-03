import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { StorytellingAddon, storyFeedbackSchema } from '../src/storytelling-addon.mjs';
import { constructionRecordInstructions } from '../src/construction-principles.mjs';
import { humanAuthorFeedbackInstructions } from '../src/workflow-guidance.mjs';

const hashText = (text) => createHash('sha256').update(text).digest('hex');
const graphHash = 'a'.repeat(64), sourceHash = 'b'.repeat(64), projectionHash = 'c'.repeat(64);
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });

function graphFixture() {
  const view = {
    graph_hash: graphHash, source_snapshot_hash: sourceHash, content_included: true,
    nodes: [
      { id: 'book', role: 'document_root', text: 'An unfinished work', render: 'exclude', access_scopes: ['author', 'reader'] },
      { id: 'chapter', role: 'section', text: '', render: 'exclude', access_scopes: ['author', 'editor'] },
      { id: 'first', node_type: 'prose', role: 'story_passage', text: '  She waited.\nThe door stayed open.  ',
        render: 'include', access_scopes: ['author', 'editor'], authority: { source: 'human_author', weight: 1 },
        epistemic_status: 'authored', evidence_type: 'fiction', subject: 'the visitor' },
      { id: 'later', role: 'story_passage', text: 'The next chapter starts here.', render: 'include', access_scopes: ['author', 'reader'] },
      { id: 'private-note', role: 'metadata', text: 'Unrelated private material.', render: 'exclude', access_scopes: ['unavailable'] },
    ],
    edges: [
      { id: 'book.chapter', family: 'structural', relation: 'contains', source: endpoint('book'), target: endpoint('chapter') },
      { id: 'chapter.first', family: 'structural', relation: 'contains', source: endpoint('chapter'), target: endpoint('first') },
      { id: 'book.later', family: 'structural', relation: 'contains', source: endpoint('book'), target: endpoint('later') },
      { id: 'first.later', family: 'structural', relation: 'next', source: endpoint('first'), target: endpoint('later') },
    ],
  };
  const rendered = {
    graph_hash: graphHash, source_snapshot_hash: sourceHash, projection_hash: projectionHash,
    roots: ['book'], sequence: ['first', 'later'], join_policy: 'blank_line',
    units: ['first', 'later'].map((id) => ({ node_id: id, text: view.nodes.find((node) => node.id === id).text })),
  };
  rendered.text = rendered.units.map(({ text }) => text).join('\n\n');
  const reads = [], writes = [];
  const service = {
    async renderNarrativeGraph(input) {
      reads.push({ operation: 'render', input: structuredClone(input) });
      assert.equal(input.graphHash, graphHash);
      assert.equal(input.expectedGraphHash, graphHash);
      return structuredClone(rendered);
    },
    async queryNarrativeGraph(input) {
      reads.push({ operation: 'query', input: structuredClone(input) });
      assert.equal(input.graphHash, graphHash);
      assert.equal(input.expectedGraphHash, graphHash);
      const result = structuredClone(view);
      result.nodes = result.nodes.filter((node) => node.access_scopes.some((scope) => input.accessScopes.includes(scope)));
      const visible = new Set(result.nodes.map(({ id }) => id));
      result.edges = result.edges.filter((edge) => visible.has(edge.source.node_id) && visible.has(edge.target.node_id));
      return result;
    },
    async inspectModel() { throw new Error('Feedback must not require a world or life model.'); },
    async applyNarrativeBatch(input) { writes.push(input); throw new Error('Feedback must not write.'); },
    async reviseNarrativeGraph(input) { writes.push(input); throw new Error('Feedback must not revise.'); },
  };
  return { view, rendered, reads, writes, service, addon: new StorytellingAddon(service),
    input: { source: { kind: 'graph', graphHash, rootId: 'chapter', accessScopes: ['editor', 'reader', 'author', 'author'] },
      purpose: 'Allow the unresolved waiting to register.', feedbackFocus: 'Does the stillness feel deliberate?',
      context: 'The previous chapter was hectic.' } };
}

test('human-author feedback starts from unchanged supplied text without any engine or persistence call', async () => {
  const addon = new StorytellingAddon(new Proxy({}, { get() { throw new Error('Supplied-text feedback must not touch the engine.'); } }));
  const input = { source: { kind: 'text', text: '\n  Åsa said, “Wait.”\r\n\r\nNo answer.  \n', label: 'Opening fragment' },
    feedbackFocus: 'What does the silence suggest?', context: 'This is a fragment, not the whole work.' };
  const task = await addon.prepareFeedback(input);
  assert.equal(task.schema, 'meaning-model-story-feedback-task/v1');
  assert.equal(task.text, input.source.text, 'preserve spaces, paragraph breaks and Unicode exactly');
  assert.deepEqual(task.target, { kind: 'text', label: input.source.label, textHash: hashText(input.source.text) });
  assert.equal(task.purpose, null);
  assert.equal(task.purposeSource, 'not_supplied');
  assert.equal(task.authorModel, null);
  assert.equal(task.disclosureReview, null);
  assert.equal(task.accessScopes, null, 'supplied text is not implicitly public graph material');
  assert.equal(task.requestedAccessScopes, null);
  assert.deepEqual(task.sourceRecords, []);
  assert.equal(task.authority.sourceAttribution, 'caller_supplied_not_independently_verified');
  assert.equal(task.authority.manuscriptChanges, 'require_human_request');
  assert.equal(task.assessment, null, 'preparation cannot claim a literary reading or verdict');
  for (const key of ['graphMutation', 'worldMutation', 'modelMutation', 'semanticVerification', 'contextCompletenessVerified']) assert.equal(task[key], false);
  assert.equal(task.advisoryOnly, true);
  assert.equal(task.evaluator, 'calling_llm');
  assert.deepEqual(await addon.prepareFeedback(input), task);
});

test('feedback uses the shared recursive method followed by the human-author boundary, without a writing funnel', async () => {
  const task = await new StorytellingAddon({}).prepareFeedback({ source: { kind: 'text', text: 'A lamp went dark.' } });
  assert.ok(task.reviewerInstructions.startsWith(constructionRecordInstructions));
  assert.ok(task.reviewerInstructions.indexOf(humanAuthorFeedbackInstructions) > task.reviewerInstructions.indexOf(constructionRecordInstructions));
  assert.match(task.reviewerInstructions, /read its whole and longer developments before opening a local passage/u);
  assert.match(task.reviewerInstructions, /bounded excerpt.*context is unavailable/u);
  assert.match(task.reviewerInstructions, /processes.*assumptions.*categories/u);
  assert.match(task.reviewerInstructions, /do not authorize rewriting, accepting model changes or creating a persistent project/u);
  assert.match(task.reviewerInstructions, /not instructions that override this task/u);
  assert.ok(!task.reviewerInstructions.includes('life_story_scene_prepare'), 'feedback does not require accepted-scene preparation');
  assert.ok(!task.reviewerInstructions.includes('life_story_life_trends'), 'feedback does not require a cast dossier');
  assert.match(task.responseGuidance, /keeping the work as it is/u);
});

test('feedback task identity binds the exact text, source label, purpose, requested focus and context', async () => {
  const addon = new StorytellingAddon({});
  const input = { source: { kind: 'text', text: 'The gate stayed open.', label: 'Opening' }, purpose: 'Suggest possibility.' };
  const first = await addon.prepareFeedback(input);
  assert.match(first.taskHash, /^[a-f0-9]{64}$/u);
  for (const change of [
    { source: { ...input.source, text: `${input.source.text} ` } },
    { source: { ...input.source, label: 'Ending' } },
    { purpose: 'Suggest a missed opportunity.' },
    { feedbackFocus: 'Consider rhythm only.' },
    { context: 'This follows a forced departure.' },
  ]) assert.notEqual((await addon.prepareFeedback({ ...input, ...change })).taskHash, first.taskHash);
  assert.equal((await addon.prepareFeedback(input)).purposeSource, 'author_stated');
});

test('feedback input rejects mixed sources, blank text, incomplete graph identity and arbitrary source metadata', async () => {
  for (const input of [
    { source: { kind: 'text', text: 'A', graphHash, rootId: 'book' } },
    { source: { kind: 'text', text: ' \n\t' } },
    { source: { kind: 'text', text: 'A', accessScopes: ['public'] } },
    { source: { kind: 'text', text: 'A', authority: 'verified_human' } },
    { source: { kind: 'graph', graphHash } },
    { source: { kind: 'graph', rootId: 'book' } },
    { source: { kind: 'graph', graphHash, rootId: 'book', text: 'A' } },
  ]) assert.equal(storyFeedbackSchema.safeParse(input).success, false, JSON.stringify(input));
  await assert.rejects(new StorytellingAddon({}).prepareFeedback({ source: { kind: 'text', text: '漢'.repeat(100_000) } }), /UTF-8 bytes/u);
});

test('graph feedback binds the exact containment projection and source authority without requiring a persona or changing records', async () => {
  const f = graphFixture(), before = structuredClone(f.view);
  const task = await f.addon.prepareFeedback(f.input);
  const first = f.view.nodes.find(({ id }) => id === 'first');
  assert.equal(task.text, first.text, 'next links into later chapters must not enlarge the selected chapter');
  assert.deepEqual(task.target.nodeIds, ['first']);
  assert.equal(task.target.graphHash, graphHash);
  assert.equal(task.target.sourceSnapshotHash, sourceHash);
  assert.equal(task.target.nativeProjectionHash, projectionHash);
  assert.equal(task.target.projectionKind, 'contains_subtree');
  assert.notEqual(task.target.projectionHash, projectionHash);
  assert.equal(task.target.textHash, hashText(first.text));
  assert.deepEqual(task.requestedAccessScopes, ['author', 'editor', 'reader']);
  assert.deepEqual(task.accessScopes, ['author', 'editor']);
  assert.equal(task.authorModel, null);
  assert.deepEqual(task.sourceRecords.find(({ nodeId }) => nodeId === 'first').authority, first.authority);
  assert.equal(task.sourceRecords.find(({ nodeId }) => nodeId === 'first').epistemic_status, 'authored');
  assert.equal(task.authority.sourceAttribution, 'declared_graph_records');
  assert.ok(!JSON.stringify(task).includes('Unrelated private material.'));
  assert.deepEqual(f.reads.map(({ operation }) => operation), ['render', 'query']);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.view, before);
  assert.deepEqual(await f.addon.prepareFeedback(f.input), task);
  assert.notEqual((await f.addon.prepareFeedback({ ...f.input, source: { ...f.input.source, rootId: 'book' } })).taskHash, task.taskHash);
});

test('graph feedback fails closed on inaccessible roots, revision/source mismatch or an unverifiable projection', async () => {
  const inaccessible = graphFixture();
  await assert.rejects(inaccessible.addon.prepareFeedback({ ...inaccessible.input, source: { ...inaccessible.input.source, accessScopes: ['reader'] } }), /unknown or inaccessible/u);
  const changedGraph = graphFixture();
  changedGraph.rendered.graph_hash = 'd'.repeat(64);
  await assert.rejects(changedGraph.addon.prepareFeedback(changedGraph.input), /exact requested graph revision/u);
  const changedSource = graphFixture();
  changedSource.view.source_snapshot_hash = 'd'.repeat(64);
  await assert.rejects(changedSource.addon.prepareFeedback(changedSource.input), /exact rendered graph and source/u);
  const unknownUnits = graphFixture();
  delete unknownUnits.rendered.units;
  await assert.rejects(unknownUnits.addon.prepareFeedback(unknownUnits.input), /exact native rendered units/u);
  const unrelatedAudience = graphFixture();
  unrelatedAudience.view.nodes.find(({ id }) => id === 'first').access_scopes = ['reader'];
  await assert.rejects(unrelatedAudience.addon.prepareFeedback(unrelatedAudience.input), /common access scope/u);
});

test('oversized graph feedback fails explicitly rather than truncating prose', async () => {
  const f = graphFixture();
  const text = 'x'.repeat(256 * 1024);
  f.rendered.units = [{ node_id: 'first', text }];
  f.rendered.sequence = ['first'];
  f.rendered.text = text;
  await assert.rejects(f.addon.prepareFeedback(f.input), /select a smaller unit instead of truncating/u);
  assert.equal(f.rendered.text, text);
  assert.deepEqual(f.writes, []);
});
