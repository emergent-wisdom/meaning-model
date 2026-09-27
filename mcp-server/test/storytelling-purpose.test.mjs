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
    roots: ['chapter-2'],
    join_policy: 'blank_line',
    units: [
      { node_id: 'chapter-2.opening', text: 'The empty chair faced the sea.', role: 'story_passage' },
      { node_id: 'chapter-2.close', text: 'She set a second cup beside her own.', role: 'story_passage' },
    ],
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

test('purpose review discovers declared disclosure plans after a split without treating renders as knowledge', async () => {
  const f = fixture();
  f.view.nodes.push({ id: 'story', role: 'document_root' }, { id: 'chapter-1', role: 'story_passage' },
    { id: 'older', node_type: 'storytelling.disclosure', text: 'Outdated disclosure.' },
    { id: 'current', node_type: 'storytelling.disclosure', text: 'Leave the motive unresolved.', access_scopes: ['editor'] },
    { id: 'unrelated', node_type: 'storytelling.disclosure', subject: 'story', text: 'Another chapter.' });
  const link = (source, target, relation = 'about') => ({ family: 'semantic', relation,
    source: { kind: 'node', node_id: source }, target: { kind: 'node', node_id: target } });
  f.view.edges.push({ ...link('story', 'chapter-2', 'contains'), family: 'structural' },
    { ...link('unrelated', 'story'), id: 'unrelated.story' }, link('unrelated', 'chapter-1'),
    link('older', 'chapter-2'), link('current', 'older', 'supersedes'), link('current', 'chapter-2'),
    { family: 'grounding', relation: 'renders', source: { kind: 'node', node_id: 'chapter-2.opening' },
      target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'ev.loss' } });
  const task = await f.addon.preparePurposeReview(f.input);
  assert.deepEqual(task.disclosureReview.plans.map(({ nodeId }) => nodeId), ['current']);
  assert.deepEqual(task.disclosureReview.plans[0].linkedPassageIds, f.rendered.sequence);
  assert.deepEqual(task.disclosureReview.passageIdsWithoutLinkedPlan, []);
  assert.equal(task.disclosureReview.completenessVerified, false);
  assert.equal(task.disclosureReview.semanticDisclosureVerified, false);
  f.view.nodes.find(({ id }) => id === 'current').text = 'Reveal the motive here instead.';
  assert.notEqual((await f.addon.preparePurposeReview(f.input)).taskHash, task.taskHash);
  f.view.edges = f.view.edges.filter((edge) => edge.source.node_id !== 'current' || edge.relation === 'supersedes');
  const missing = await f.addon.preparePurposeReview(f.input);
  assert.deepEqual(missing.disclosureReview.passageIdsWithoutLinkedPlan, f.rendered.sequence);
  assert.equal(missing.advisoryOnly, true, 'absence of a plan is not a literary gate');
});

test('disclosure review resolves stable spans and keeps private plan evidence private', async () => {
  const f = fixture();
  f.view.nodes.push({ id: 'span', node_type: 'document.span', role: 'metadata', render: 'exclude', text: JSON.stringify({ schema: 'meaning-model-document-span/v1',
    documentId: 'chapter-2', start: { nodeId: 'chapter-2.opening', boundary: 'start' }, end: { nodeId: 'chapter-2.close', boundary: 'end' } }) },
    { id: 'plan', node_type: 'storytelling.disclosure', text: 'Two cups before the absence is named.', access_scopes: ['editor'] });
  f.view.edges.push({ family: 'semantic', relation: 'about', source: { kind: 'node', node_id: 'plan' }, target: { kind: 'node', node_id: 'span' } });
  f.view.edges.push({ family: 'semantic', relation: 'applies_during', source: { kind: 'node', node_id: 'span' }, target: { kind: 'node', node_id: 'plan' } });
  const task = await f.addon.preparePurposeReview({ ...f.input, accessScopes: ['editor', 'reader'] });
  assert.deepEqual(task.disclosureReview.plans[0].linkedPassageIds, f.rendered.sequence);
  assert.equal(task.disclosureReview.plans[0].spanRecords.length, 1, 'multiple declared links do not repeat the span body in the review packet');
  assert.deepEqual(task.accessScopes, ['editor']);
  f.view.nodes.push({ id: 'other-plan', node_type: 'storytelling.disclosure', text: 'Separately restricted evidence.', access_scopes: ['reader'] });
  f.view.edges.push({ family: 'semantic', relation: 'about', source: { kind: 'node', node_id: 'other-plan' }, target: { kind: 'node', node_id: 'chapter-2' } });
  await assert.rejects(f.addon.preparePurposeReview({ ...f.input, accessScopes: ['editor', 'reader'] }), /disclosure plans require a common access scope/);
});

test('disclosure associations retain edge and inherited containment audiences without importing unrelated restrictions', async () => {
  const f = fixture();
  f.view.nodes.push({ id: 'plan', node_type: 'storytelling.disclosure', text: 'Leave the motive unresolved.' },
    { id: 'other-story' }, { id: 'other-passage' });
  const association = { family: 'semantic', relation: 'about', access_scopes: ['editor'],
    source: { kind: 'node', node_id: 'plan' }, target: { kind: 'node', node_id: 'chapter-2' } };
  f.view.edges.push(association, { family: 'structural', relation: 'contains', access_scopes: ['unrelated-private'],
    source: { kind: 'node', node_id: 'other-story' }, target: { kind: 'node', node_id: 'other-passage' } });
  const input = { ...f.input, accessScopes: ['editor', 'reader', 'unrelated-private'] };
  const direct = await f.addon.preparePurposeReview(input);
  assert.deepEqual(direct.accessScopes, ['editor'], 'a restricted about edge cannot be widened to its public endpoints');
  assert.deepEqual(direct.disclosureReview.evidenceAccessScopes, [['editor']]);
  delete association.access_scopes;
  f.view.edges[0].access_scopes = ['editor'];
  const inherited = await f.addon.preparePurposeReview(input);
  assert.deepEqual(inherited.accessScopes, ['editor'], 'coverage inherited from a parent depends on its containment path');
  f.view.nodes.find((node) => node.id === 'plan').access_scopes = ['reader'];
  await assert.rejects(f.addon.preparePurposeReview(input), /disclosure plans require a common access scope/);
});

test('a span review retains the audience of structural order used to locate its boundaries', async () => {
  const f = fixture();
  f.view.nodes.push({ id: 'span', node_type: 'document.span', role: 'metadata', render: 'exclude',
    text: JSON.stringify({ schema: 'meaning-model-document-span/v1', documentId: 'chapter-2',
      start: { nodeId: 'chapter-2.opening', boundary: 'start' }, end: { nodeId: 'chapter-2.close', boundary: 'end' } }) },
    { id: 'plan', node_type: 'storytelling.disclosure', text: 'The two gestures belong together.' });
  f.view.edges.push({ family: 'semantic', relation: 'about', source: { kind: 'node', node_id: 'plan' },
    target: { kind: 'node', node_id: 'span' } });
  f.view.edges[0].access_scopes = ['editor'];
  const task = await f.addon.preparePurposeReview({ ...f.input, accessScopes: ['editor', 'reader'] });
  assert.deepEqual(task.accessScopes, ['editor']);
  assert.deepEqual(task.disclosureReview.plans[0].linkedPassageIds, f.rendered.sequence);
});

test('document titles remain in the prose but do not count as passages lacking disclosure plans', async () => {
  const f = fixture();
  f.view.nodes[0].role = 'document_root';
  f.rendered.sequence.unshift('chapter-2');
  f.rendered.units.unshift({ node_id: 'chapter-2', role: 'document_root', text: '# The Empty Chair' });
  f.rendered.text = f.rendered.units.map((unit) => unit.text).join('\n\n');
  const task = await f.addon.preparePurposeReview(f.input);
  assert.equal(task.text, f.rendered.text);
  assert.deepEqual(task.disclosureReview.passageIdsWithoutLinkedPlan, ['chapter-2.opening', 'chapter-2.close']);
});

test('a span covering only a document title does not declare coverage of its descendants', async () => {
  const f = fixture();
  f.view.nodes[0].role = 'document_root';
  f.rendered.sequence.unshift('chapter-2');
  f.rendered.units.unshift({ node_id: 'chapter-2', role: 'document_root', text: '# The Empty Chair' });
  f.rendered.text = f.rendered.units.map((unit) => unit.text).join('\n\n');
  f.view.nodes.push({ id: 'span', node_type: 'document.span', role: 'metadata', render: 'exclude',
    text: JSON.stringify({ schema: 'meaning-model-document-span/v1', documentId: 'chapter-2',
      start: { nodeId: 'chapter-2', boundary: 'start' }, end: { nodeId: 'chapter-2.opening', boundary: 'start' } }) },
    { id: 'plan', node_type: 'storytelling.disclosure', text: 'The title does not name the absent person.' });
  f.view.edges.push({ family: 'semantic', relation: 'about', source: { kind: 'node', node_id: 'plan' },
    target: { kind: 'node', node_id: 'span' } });
  const task = await f.addon.preparePurposeReview(f.input);
  assert.deepEqual(task.disclosureReview.plans, []);
  assert.deepEqual(task.disclosureReview.passageIdsWithoutLinkedPlan, ['chapter-2.opening', 'chapter-2.close']);
});

test('a review inside a disclosure span finds the plan and reprojects edited boundaries without widening its prose', async () => {
  const f = fixture();
  const document = { ...structuredClone(f.rendered), roots: ['story'],
    units: [{ node_id: 'before', text: 'Before.', role: 'story_passage' }, ...f.rendered.units,
      { node_id: 'after', text: 'After.', role: 'story_passage' }] };
  document.sequence = document.units.map((unit) => unit.node_id);
  document.text = document.units.map((unit) => unit.text).join('\n\n');
  const spanDefinition = { schema: 'meaning-model-document-span/v1', documentId: 'story',
    start: { nodeId: 'before', boundary: 'start' }, end: { nodeId: 'after', boundary: 'end' } };
  const span = { id: 'span', role: 'metadata', render: 'exclude', node_type: 'document.span',
    text: JSON.stringify(spanDefinition), access_scopes: ['editor'] };
  f.view.nodes.push({ id: 'story', role: 'document_root' }, { id: 'before' }, { id: 'after' }, span,
    { id: 'plan', node_type: 'storytelling.disclosure', text: 'The setup covers all three parts.' });
  f.view.edges.push(...['before', 'chapter-2', 'after'].map((id, order) => ({ family: 'structural', relation: 'contains', order,
    source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: id } })),
    { family: 'semantic', relation: 'about', source: { kind: 'node', node_id: 'plan' }, target: { kind: 'node', node_id: 'span' } });
  const calls = [];
  const addon = new StorytellingAddon({
    async renderNarrativeGraph(input) { calls.push(input); return structuredClone(input.rootIds[0] === 'story' ? document : f.rendered); },
    async queryNarrativeGraph() { return structuredClone(f.view); },
  });
  const task = await addon.preparePurposeReview({ ...f.input, accessScopes: ['editor', 'reader'] });
  assert.equal(task.text, f.rendered.text, 'projection for plan discovery does not turn a chapter review into a book review');
  assert.deepEqual(task.disclosureReview.plans[0].linkedPassageIds, f.rendered.sequence);
  assert.deepEqual(task.accessScopes, ['editor'], 'span evidence restricts the resulting review audience');
  assert.deepEqual(calls.map((call) => call.rootIds), [['chapter-2'], ['story']]);
  span.text = JSON.stringify({ ...spanDefinition, start: { nodeId: 'after', boundary: 'start' } });
  const after = await addon.preparePurposeReview(f.input);
  assert.deepEqual(after.disclosureReview.plans, [], 'moving a boundary past the chapter removes its coverage');
  span.text = JSON.stringify({ ...spanDefinition, start: { nodeId: 'after', boundary: 'end' }, end: { nodeId: 'before', boundary: 'start' } });
  const reversed = await addon.preparePurposeReview(f.input);
  assert.deepEqual(reversed.disclosureReview.plans, []);
  assert.deepEqual(reversed.disclosureReview.unresolvedSpans, [{ nodeId: 'span', reason: 'reversed_boundaries' }]);
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
