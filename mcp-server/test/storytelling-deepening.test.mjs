import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { StorytellingAddon } from '../src/storytelling-addon.mjs';
import { fictionalAuthorModel } from './storytelling-author-model-fixture.mjs';
import { lifeTrendsDossier, lifeTrendsEdges, lifeTrendsNode } from './storytelling-life-fixture.mjs';

const graphHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const modelHash = 'c'.repeat(64);
const projectionHash = 'd'.repeat(64);
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
const hashText = (text) => createHash('sha256').update(text).digest('hex');

function fixture() {
  const author = fictionalAuthorModel();
  const view = {
    graph_hash: graphHash, source_snapshot_hash: snapshotHash, content_included: true,
    graph: { revision: { number: 5 }, source_snapshot: { source_kind: 'model', model_hash: modelHash } },
    roots: ['book', 'author.process'],
    nodes: [
      { id: 'book', role: 'document_root', render: 'exclude', access_scopes: ['author', 'book-only'] },
      { id: 'chapter', role: 'section', render: 'exclude', access_scopes: ['author', 'chapter-only'] },
      { ...lifeTrendsNode(lifeTrendsDossier()), access_scopes: ['author', 'life-only'] },
      { id: 'outline', role: 'metadata', render: 'exclude', access_scopes: ['author', 'plan-only'],
        text: 'Leo checks the inlet and closes it because its flow exceeds the pump capacity.' },
      { id: 'capacity', role: 'metadata', render: 'exclude', access_scopes: ['author', 'source-only'],
        text: 'The pump removes two units per minute while the inlet admits three.' },
      { id: 'passage', node_type: 'storytelling.scene', role: 'story_passage', render: 'include',
        text: 'Leo counted the marks, then turned the inlet wheel.', access_scopes: ['author', 'reader'] },
      { id: 'author.process', node_type: 'understanding_process_root', role: 'metadata', subject: 'book',
        render: 'exclude', training: 'exclude', access_scopes: ['author'] },
      { id: 'author.model', node_type: 'storytelling.author_model', role: 'metadata', subject: 'book',
        render: 'exclude', training: 'exclude', access_scopes: ['author', 'profile-only'],
        text: JSON.stringify({ schema: 'meaning-model-story-author-record/v1', kind: 'author_model',
          authoringClock: { rootId: 'author.process' }, data: author }) },
    ],
    edges: [...lifeTrendsEdges(),
      { id: 'book.chapter', source: endpoint('book'), target: endpoint('chapter'), family: 'structural', relation: 'contains', order: 0 },
      { id: 'chapter.passage', source: endpoint('chapter'), target: endpoint('passage'), family: 'structural', relation: 'contains', order: 0 },
      { id: 'author.placement', source: endpoint('author.process'), target: endpoint('author.model'), family: 'structural', relation: 'contains', order: 0 },
      { id: 'outline.capacity', source: endpoint('outline'), target: endpoint('capacity'), family: 'semantic', relation: 'depends_on', access_scopes: ['author', 'evidence-only'] },
    ],
  };
  const model = { processes: [{ id: 'pump', unit: 'volume_per_minute', initial_value: 2 }],
    meaning_model: { referents: [{ id: 'Leo' }], events: [{ id: 'inlet.closed', process_ids: ['pump'] }] } };
  const rendered = { graph_hash: graphHash, source_snapshot_hash: snapshotHash,
    projection_hash: projectionHash, sequence: ['passage'], text: view.nodes.find(({ id }) => id === 'passage').text };
  const reads = [];
  const writes = [];
  const service = {
    async queryNarrativeGraph(input) {
      reads.push({ operation: 'query', input: structuredClone(input) });
      assert.equal(input.expectedGraphHash, input.graphHash);
      const result = structuredClone(view);
      const allowed = (item) => !item.access_scopes?.length || item.access_scopes.some((scope) => input.accessScopes.includes(scope));
      result.nodes = result.nodes.filter(allowed);
      const visible = new Set(result.nodes.map(({ id }) => id));
      result.edges = result.edges.filter((edge) => allowed(edge) && visible.has(edge.source.node_id)
        && (edge.target.kind === 'anchor' || visible.has(edge.target.node_id)));
      return result;
    },
    async renderNarrativeGraph(input) {
      reads.push({ operation: 'render', input: structuredClone(input) });
      assert.equal(input.expectedGraphHash, input.graphHash);
      return structuredClone(rendered);
    },
    async inspectModel(input) {
      reads.push({ operation: 'inspect', input: structuredClone(input) });
      return { modelHash, model: structuredClone(model), summary: { process_count: 1 } };
    },
    async applyNarrativeBatch(input) { writes.push(input); throw new Error('Deepening preparation must not mutate the graph.'); },
    async reviseNarrativeGraph(input) { writes.push(input); throw new Error('Deepening preparation must not revise prose.'); },
  };
  const input = { graphHash, storyRootId: 'book', rootId: 'chapter', lifeTrendsNodeId: 'life.trends',
    focusNodeId: 'outline', contextNodeIds: ['capacity', 'capacity'], authorModelNodeId: 'author.model',
    accessScopes: ['author', 'book-only', 'chapter-only', 'life-only', 'plan-only', 'source-only', 'reader', 'profile-only', 'evidence-only', 'author'] };
  return { author, view, model, rendered, reads, writes, service, input, addon: new StorytellingAddon(service) };
}

test('deepening binds exact canonical prose, model, selected life evidence and author without writing or inventing a verdict', async () => {
  const f = fixture();
  const before = structuredClone(f.view);
  const task = await f.addon.prepareDeepening(f.input);
  assert.equal(task.schema, 'meaning-model-story-deepening-task/v1');
  assert.deepEqual(task.baseline, { graphHash, sourceSnapshotHash: snapshotHash, modelHash,
    rootId: 'chapter', projectionHash, textHash: hashText(f.rendered.text), nodeIds: ['passage'] });
  assert.equal(task.text, f.rendered.text);
  assert.deepEqual(task.modelDepth.model.definition, f.model);
  assert.equal(task.modelDepth.model.administrativeRead, true);
  assert.equal(task.modelDepth.model.frozenRuntimeValuesIncluded, false);
  assert.deepEqual(task.modelDepth.preparation.contextNodeIds, ['capacity']);
  assert.deepEqual(task.authorModel.model, f.author);
  assert.deepEqual(task.authorModel, task.purposeReview.authorModel);
  assert.equal(task.purposeReview.text, task.text);
  assert.deepEqual(task.accessScopes, ['author']);
  assert.equal(task.revisionScope, 'local');
  assert.equal(task.preparation.unit, 'whole_work');
  assert.equal(task.brief, 'Deepen and improve the existing work.');
  assert.equal(task.assessment, null);
  assert.equal(task.evaluator, 'calling_llm');
  for (const field of ['worldMutation', 'graphMutation', 'semanticVerification']) assert.equal(task[field], false);
  assert.deepEqual(await f.addon.prepareDeepening(f.input), task, 'the same immutable baseline yields the same task');
  assert.match(task.taskHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.view, before);
});

test('deepening task identity binds the brief, revision authority, actual prose and model evidence', async () => {
  const f = fixture();
  const first = await f.addon.prepareDeepening(f.input);
  for (const change of [{ brief: 'Deepen the conversation while retaining its quiet ending.' }, { revisionScope: 'structural' }, { unit: 'section' }]) {
    const changed = await f.addon.prepareDeepening({ ...f.input, ...change });
    assert.notEqual(changed.taskHash, first.taskHash);
    if (change.revisionScope) assert.equal(changed.revisionScope, 'structural');
    assert.equal(changed.graphMutation, false, 'structural permission prepares a task, not an automatic rewrite');
  }
  f.rendered.text += ' He waited to hear the pump catch up.';
  const changedProse = await f.addon.prepareDeepening(f.input);
  assert.notEqual(changedProse.taskHash, first.taskHash);
  assert.notEqual(changedProse.baseline.textHash, first.baseline.textHash);
  f.model.processes[0].initial_value = 1;
  assert.notEqual((await f.addon.prepareDeepening(f.input)).taskHash, changedProse.taskHash);
  assert.deepEqual(f.writes, []);
});

test('deepening verifies story containment even without an author model and rejects foreign rendered passages', async () => {
  const f = fixture();
  const input = { ...f.input, authorModelNodeId: null };
  assert.equal((await f.addon.prepareDeepening(input)).authorModel, null);
  const foreign = { id: 'foreign', role: 'document_root', render: 'exclude', access_scopes: [] };
  f.view.nodes.push(foreign);
  await assert.rejects(f.addon.prepareDeepening({ ...input, rootId: foreign.id }), /outside|story|root/iu);
  f.view.nodes.push({ id: 'foreign.passage', role: 'story_passage', render: 'include', text: 'Another story.', access_scopes: [] });
  f.rendered.sequence.push('foreign.passage');
  await assert.rejects(f.addon.prepareDeepening(input), /outside|story|render|root/iu);
  assert.deepEqual(f.writes, []);
});

test('deepening rejects absent evidence, partial visibility, mismatched source and pending candidates', async () => {
  for (const change of [{ focusNodeId: 'missing' }, { lifeTrendsNodeId: 'missing' }, { authorModelNodeId: 'missing' }, { rootId: 'missing' }, { accessScopes: ['reader'] }]) {
    const f = fixture();
    await assert.rejects(f.addon.prepareDeepening({ ...f.input, ...change }));
    assert.deepEqual(f.writes, []);
  }
  for (const mutate of [
    (f) => { f.view.content_included = false; },
    (f) => { f.rendered.graph_hash = 'e'.repeat(64); },
    (f) => { f.rendered.source_snapshot_hash = 'e'.repeat(64); },
    (f) => { f.view.graph.source_snapshot.source_kind = 'candidate'; f.view.graph.source_snapshot.candidate_status = 'pending'; },
    (f) => { f.rendered.text = ' \n '; },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.addon.prepareDeepening(f.input));
    assert.deepEqual(f.writes, []);
  }
});

test('deepening cannot combine individually visible evidence with no common audience', async () => {
  for (const target of ['life.trends', 'outline', 'capacity', 'passage', 'author.model']) {
    const f = fixture();
    f.view.nodes.find(({ id }) => id === target).access_scopes = ['isolated'];
    await assert.rejects(f.addon.prepareDeepening({ ...f.input, accessScopes: [...f.input.accessScopes, 'isolated'] }), /scope|audience/iu);
    assert.deepEqual(f.writes, []);
  }
  const f = fixture();
  f.view.edges.find(({ id }) => id === 'outline.capacity').access_scopes = ['isolated'];
  await assert.rejects(f.addon.prepareDeepening({ ...f.input, accessScopes: [...f.input.accessScopes, 'isolated'] }), /scope|audience/iu);
});

test('deepening rejects malformed selection and oversized prose instead of silently reviewing an excerpt', async () => {
  const f = fixture();
  for (const change of [{ accessScopes: [] }, { rootId: '' }, { revisionScope: 'reroll' }, { brief: 'x'.repeat(4_001) }]) {
    await assert.rejects(f.addon.prepareDeepening({ ...f.input, ...change }));
  }
  assert.deepEqual(f.reads, [], 'invalid requests fail before reading the graph');
  f.rendered.text = 'Quiet. '.repeat(45_000);
  await assert.rejects(f.addon.prepareDeepening(f.input), /smaller|exceed|bytes|truncat/iu);
  assert.deepEqual(f.writes, []);
});

test('the combined deepening task stays small enough to preserve exactly in an author record', async () => {
  const f = fixture();
  f.view.nodes.find(({ id }) => id === 'capacity').text = 'x'.repeat(390 * 1024);
  await assert.rejects(f.addon.prepareDeepening(f.input), /Deepening task exceeds.*smaller coherent unit/iu);
  await assert.rejects(f.addon.prepareDeepening(f.input), /Largest context records: capacity \(\d+ KiB\)/u, 'the error names what to leave out');
  assert.deepEqual(f.writes, []);
});
