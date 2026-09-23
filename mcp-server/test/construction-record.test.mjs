// The construction record on the real engine: descriptions, understanding notes linked to model
// records (including Cuts), reviews held by their reviewers, the outline and the replay.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { exportConstructionHistory, importConstructionHistory, outlineModel, readNotes, recordReview, recordUnderstanding, replayConstruction, understandingRecordSchema } from '../src/construction-record.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';
import { applyNarrativeDefinitionDelta } from '../src/narrative-delta.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const scopes = ['author'];

async function setup(t) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  // Start from a model whose Cut-bearing state Event is not yet described.
  const model = structuredClone(registerRequest.model);
  delete model.meaning_model.events.find((event) => event.id === 'event.ada.state.h06').description;
  await assert.rejects(service.registerModel({ requestId: 'strict', model, requireDescribedNumbers: true }), /Undescribed: event\.ada\.state\.h06 \(cut:cut\.ada\.h06\.attention\)/);
  const registered = await service.registerModel({ requestId: 'model', model });
  assert.deepEqual(registered.descriptionCoverage.undescribedNumbers, [{ eventId: 'event.ada.state.h06', carries: ['cut:cut.ada.h06.attention'] }]);
  const graph = structuredClone(graphRequest.narrativeGraph);
  graph.source.model_hash = registered.modelHash;
  graph.nodes.push({ id: 'passage.1', node_type: 'passage', role: 'story_passage', text: 'The offer came at six. Ada read it twice before the first customers.',
    render: 'include', training: 'exclude', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', authority: { source: 'example-author', weight: 1 }, provenance: ['test'] });
  graph.edges.push({ id: 'story.contains.passage.1', source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: 'passage.1' }, family: 'structural', relation: 'contains', order: 0,
    explanation: 'The offer opens the story.', provenance: ['test'] });
  graph.nodes = graph.nodes.map((node) => ({ ...node, access_scopes: scopes }));
  graph.edges = graph.edges.map((edge) => ({ ...edge, access_scopes: scopes }));
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graph });
  return { service, model, modelHash: registered.modelHash, graphHash: stored.graphHash };
}

test('a thought is recorded against what it concerns, a review under its reviewer, and the replay shows each as it was', async (t) => {
  const { service, model, modelHash, graphHash } = await setup(t);
  assert.throws(() => understandingRecordSchema.parse({ graphHash, requestId: 'r', accessScopes: scopes, holder: 'modeler', notes: [{ nodeId: 'n', kind: 'idea', text: 'Floating.' }] }), /must be about something/);

  // 1. The modeler records a decision about the undescribed state Event and an idea about one Cut answer.
  const noted = await recordUnderstanding(service, { graphHash, requestId: 'notes-1', accessScopes: scopes, holder: 'modeler:claude-opus-5-5', notes: [
    { nodeId: 'note.attention', kind: 'decision', text: 'Money leads her attention at hour six; the ovens come second because the offer names the loan first.', about: [{ record: 'event:event.ada.state.h06' }, { record: 'cut:cut.ada.h06.attention', path: '/answers/0' }] },
    { nodeId: 'note.later', kind: 'idea', text: 'Pay this off in the last scene: she lights the ovens before answering.', about: [{ record: 'event:event.offer' }], links: [{ relation: 'refines', targetNodeId: 'note.attention' }] },
  ] });
  assert.equal(noted.understandingRootId, 'understanding.modeler-claude-opus-5-5');
  assert.equal(noted.writtenAgainstModel, modelHash);
  let view = await service.queryNarrativeGraph({ graphHash: noted.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  const cutAnchor = view.edges.find((edge) => edge.source.node_id === 'note.attention' && edge.target.anchor_kind === 'normalized_cut');
  assert.deepEqual([cutAnchor.target.anchor_id, cutAnchor.target.path], ['cut.ada.h06.attention', '/answers/0'], 'the engine anchors a note to one Cut answer');
  assert.equal(view.nodes.find((node) => node.id === 'note.attention').holder, 'modeler:claude-opus-5-5');

  // 2. A blind reader's review, recorded under the reader with the exact text it saw.
  const rendered = await service.renderNarrativeGraph({ graphHash: noted.graphHash, rootIds: ['story'], accessScopes: scopes });
  const reviewed = await recordReview(service, { graphHash: noted.graphHash, requestId: 'review-1', accessScopes: scopes, nodeId: 'review.reader.1',
    reviewer: { id: 'reader:gpt-6-astra:fresh-1', kind: 'model', model: 'gpt-6-astra', family: 'openai', label: 'blind reader 1' }, recordedBy: 'modeler:claude-opus-5-5',
    independence: 'blind', reviewed: { rootId: 'story', materials: 'rendered_text', textSha256: sha256(rendered.text) }, prompt: { text: 'Read this and say what does not hold.' },
    review: { text: 'We never learn why the money matters to her more than the ovens.', verdict: 'revise', findings: [{ text: 'Motive for the attention split is missing.', quote: 'Ada read it twice', severity: 'major' }] },
    about: [{ record: 'event:event.ada.state.h06' }] });
  assert.equal(reviewed.textMatchesRender, true);
  assert.equal(reviewed.reviewerRootId, 'review.reader-gpt-6-astra-fresh-1');
  view = await service.queryNarrativeGraph({ graphHash: reviewed.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  const reviewNode = view.nodes.find((node) => node.id === 'review.reader.1');
  assert.equal(reviewNode.holder, 'reader:gpt-6-astra:fresh-1');
  assert.equal(JSON.parse(reviewNode.text).data.independence, 'blind');
  await assert.rejects(recordReview(service, { graphHash: reviewed.graphHash, requestId: 'review-bad', accessScopes: scopes, nodeId: 'review.bad', reviewer: { id: 'x', kind: 'model' }, recordedBy: 'm',
    independence: 'blind', reviewed: { materials: 'records' }, review: { text: 'r' } }), /blind review sees only the text/);

  // 3. The review is answered: the Event gets a description in a model revision, the graph follows, and a note says why.
  const successor = structuredClone(model);
  successor.revision = { number: 1, previous_model_hash: modelHash, reason: 'Describe the attention state the reader could not explain.', provenance: ['test'] };
  successor.meaning_model.events.find((event) => event.id === 'event.ada.state.h06').description = 'The offer has just arrived. Ada reads it at the counter, thinking first of the loan and then of the ovens her grandmother lit.';
  const revised = await service.reviseModel({ requestId: 'revise-1', previousModelHash: modelHash, model: successor });
  assert.deepEqual(revised.descriptionCoverage.undescribedNumbers, []);
  const rebound = await rebindNarrativeGraph(service, { requestId: 'rebind-1', graphHash: reviewed.graphHash, modelHash: revised.modelHash, accessScopes: scopes, reason: 'Follow model revision 1.' });
  assert.equal(rebound.revisedByDelta, true);
  const reboundView = await service.queryNarrativeGraph({ graphHash: rebound.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  assert.equal(reboundView.edges.find((edge) => edge.id === 'story.contains.passage.1').explanation, 'The offer opens the story.', 'a rebind keeps edge explanations');
  const answered = await recordUnderstanding(service, { graphHash: rebound.graphHash, requestId: 'notes-2', accessScopes: scopes, holder: 'modeler:claude-opus-5-5', notes: [
    { nodeId: 'note.answer', kind: 'revision', text: 'Described the hour-six state so the attention split has a reason.', about: [{ record: 'event:event.ada.state.h06' }], links: [{ relation: 'answers', targetNodeId: 'review.reader.1' }] }] });

  // The outline shows the present state with its notes; nothing is left undescribed.
  const outline = await outlineModel(service, { graphHash: answered.graphHash, accessScopes: scopes });
  assert.match(outline.text, /event\.ada\.state\.h06 \[6, 6\.25\]: Ada's attributed attention state/);
  assert.match(outline.text, /thinking first of the loan/);
  assert.match(outline.text, /cut\.ada\.h06\.attention \[unit: share of one attention budget\]: .* → continuity 0\.35, money 0\.55, remainder 0\.10/, 'the unit says what the weights are');
  assert.match(outline.text, /✎ note\.attention \[understanding\.decision by modeler:claude-opus-5-5\]: Money leads her attention/);
  assert.match(outline.text, /✎ also note\.attention \(shown above\)/, 'a note linked to a Cut and its Event is shown once');
  assert.match(outline.text, /✎ review\.reader\.1 \[review by reader:gpt-6-astra:fresh-1\]: Verdict: revise\..* \[1 finding; later: 1 answers\]/, 'a review names its findings and what answered it');
  assert.match(outline.text, /review\.reader-gpt-6-astra-fresh-1 \(reader:gpt-6-astra:fresh-1\): 1 reflection, 1 record/);
  assert.equal(outline.coverage.undescribedNumbers.length, 0);
  // Both hashes are accepted when the graph is bound to that model, and refused with a way out when it is not.
  const both = await outlineModel(service, { graphHash: answered.graphHash, modelHash: revised.modelHash, accessScopes: scopes });
  assert.equal(both.text, outline.text);
  await assert.rejects(outlineModel(service, { graphHash: answered.graphHash, modelHash, accessScopes: scopes }), /is bound to model .*pass graphHash alone/);
  const counts = await outlineModel(service, { graphHash: answered.graphHash, accessScopes: scopes, understanding: 'count', sections: ['events'] });
  assert.doesNotMatch(counts.text, /✎/);

  // The replay walks every step; a note is shown beside the Event as it was when the note was written.
  const replay = await replayConstruction(service, { graphHash: answered.graphHash, accessScopes: scopes, level: 'reasoning' });
  if (process.env.SHOW_REPLAY) console.log(replay.text, '\n=== outline level ===\n', (await replayConstruction(service, { graphHash: answered.graphHash, accessScopes: scopes })).text);
  assert.equal(replay.revisionCount, 5);
  assert.match(replay.text, /## r1 · Record 2 understanding notes held by modeler:claude-opus-5-5/);
  assert.match(replay.text, /about event:event\.ada\.state\.h06 "Ada's attributed attention state[^"]*" \(no description\)/, 'the note was written against the undescribed Event');
  assert.match(replay.text, /✎ review\.reader\.1 \[review by reader:gpt-6-astra:fresh-1\]: Verdict: revise\. We never learn why/, 'a review leads with its verdict');
  assert.match(replay.text, /model → r1 \([0-9a-f]{12}\): r1 Describe the attention state the reader could not explain\./);
  assert.match(replay.text, /model changes: events ~1 \(event\.ada\.state\.h06: description\)/);
  assert.match(replay.text, /answers review\.reader\.1/);
  // A review is shown with its findings and, where it first appears, the notes that later answered it.
  assert.match(replay.text, /✎ review\.reader\.1 \[review by reader:gpt-6-astra:fresh-1\]: .*\[1 finding; later: 1 answers\]/);
  assert.match(replay.text, /   finding 1 \[major\]: Motive for the attention split is missing\./);
  assert.match(replay.text, /   later responses: note\.answer answers/);
  // A note or review is read whole, with the links into and out of it, without its neighborhood.
  const read = await readNotes(service, { graphHash: answered.graphHash, accessScopes: scopes, nodeIds: ['review.reader.1', 'note.nope'] });
  assert.equal(read.notes[0].kind, 'review');
  assert.equal(read.notes[0].data.verdict, 'revise');
  assert.equal(read.notes[0].data.findings[0].text, 'Motive for the attention split is missing.');
  assert.ok(read.notes[0].linksIn.some((link) => link.relation === 'answers' && link.source === 'note.answer'));
  assert.ok(read.notes[0].linksOut.some((link) => link.relation === 'about' && link.target === 'event:event.ada.state.h06'));
  assert.equal(read.notes[1].found, false);
  const onReview = await replayConstruction(service, { graphHash: answered.graphHash, accessScopes: scopes, focus: [{ nodeId: 'review.reader.1' }] });
  assert.match(onReview.text, /## r2 · Record a review/, 'the step that added the review');
  assert.match(onReview.text, /✎ note\.answer /, 'and the later step whose note answers it');
  const focused = await replayConstruction(service, { graphHash: answered.graphHash, accessScopes: scopes, focus: [{ record: 'event:event.offer' }] });
  assert.match(focused.text, /note\.later/);
  assert.doesNotMatch(focused.text, /review\.reader\.1/);
  const paged = await replayConstruction(service, { graphHash: answered.graphHash, accessScopes: scopes, limit: 2, format: 'json' });
  assert.deepEqual(paged.steps.map((step) => step.revision), [0, 1]);
  assert.equal(paged.window.nextOffset, 2);
  const models = await replayConstruction(service, { modelHash: revised.modelHash, level: 'reasoning' });
  assert.equal(models.revisionCount, 2);
  assert.match(models.text, /model r1 .*: Describe the attention state/);

  // The whole construction travels: another engine rebuilds every hash and replays the same history.
  const history = await exportConstructionHistory(service, { graphHash: answered.graphHash, accessScopes: scopes });
  assert.equal(history.revisionCount, 5);
  assert.deepEqual(history.models.map((entry) => entry.definition.revision.number), [0, 1]);
  const elsewhere = new LifeSimulationService();
  t.after(() => elsewhere.close());
  await elsewhere.initialize();
  const imported = await importConstructionHistory(elsewhere, { requestId: 'import', history: JSON.parse(JSON.stringify(history)) });
  assert.equal(imported.headGraphHash, answered.graphHash);
  assert.equal(imported.verified, true);
  const replayedThere = await replayConstruction(elsewhere, { graphHash: imported.headGraphHash, accessScopes: scopes, level: 'reasoning' });
  assert.equal(replayedThere.text, replay.text, 'the imported history replays exactly as the original');
  const tampered = structuredClone(history); tampered.revisions[1].delta.upsertNodes[0].text = 'changed';
  await assert.rejects(importConstructionHistory(elsewhere, { requestId: 'tampered', history: tampered }), /does not match its bundleSha256/);

  // Withdraw rather than remove: a successor that drops a Cut the notes are anchored to is refused with the way out,
  // and one that marks the Cut withdrawn keeps every link and shows the withdrawal (found by the 2026-09-23 instruction test).
  const next = (reason) => { const definition = structuredClone(successor); definition.revision = { number: 2, previous_model_hash: revised.modelHash, reason, provenance: ['test'] }; return definition; };
  const dropped = next('Drop the attention Cut.');
  dropped.meaning_model.normalized_cuts = dropped.meaning_model.normalized_cuts.filter((cut) => cut.id !== 'cut.ada.h06.attention');
  const droppedModel = await service.reviseModel({ requestId: 'revise-drop', previousModelHash: revised.modelHash, model: dropped });
  await assert.rejects(rebindNarrativeGraph(service, { requestId: 'rebind-drop', graphHash: answered.graphHash, modelHash: droppedModel.modelHash, accessScopes: scopes }),
    /removes 1 record\(s\) that \d+ graph link\(s\) are anchored to: .*normalized_cut:cut\.ada\.h06\.attention.*marked withdrawn instead of removed/);
  const withdrawing = next('Withdraw the attention Cut.');
  withdrawing.meaning_model.normalized_cuts.find((cut) => cut.id === 'cut.ada.h06.attention').withdrawn = { reason: 'The split was a guess, not a reading of her.' };
  const withdrawnModel = await service.reviseModel({ requestId: 'revise-withdraw', previousModelHash: revised.modelHash, model: withdrawing });
  const kept = await rebindNarrativeGraph(service, { requestId: 'rebind-withdraw', graphHash: answered.graphHash, modelHash: withdrawnModel.modelHash, accessScopes: scopes });
  const afterWithdrawal = await outlineModel(service, { graphHash: kept.graphHash, accessScopes: scopes });
  assert.match(afterWithdrawal.text, /· cut\.ada\.h06\.attention \[unit: share of one attention budget\] \[withdrawn: The split was a guess, not a reading of her\.\]: /);
  assert.match(afterWithdrawal.text, /✎ note\.attention \[understanding\.decision/, 'the note keeps its link to the withdrawn Cut');
  const withdrawalStep = await replayConstruction(service, { modelHash: withdrawnModel.modelHash, level: 'reasoning' });
  assert.match(withdrawalStep.text, /cuts ~1 \(cut\.ada\.h06\.attention: withdrawn\)/, 'the replay names the withdrawal as a change');
});

test('a long history travels as changes: each revision by change keeps only its change in the receipt', async (t) => {
  const { service, graphHash } = await setup(t);
  // A long passage makes any receipt that keeps the whole graph expensive.
  const longText = 'The ovens were lit before dawn. '.repeat(15_000);
  let head = (await service.applyNarrativeBatch({ requestId: 'long', previousGraphHash: graphHash, narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1',
    previous_graph_hash: graphHash, reason: 'Add a long passage.', provenance: ['test'],
    add_nodes: [{ id: 'passage.long', node_type: 'passage', role: 'story_passage', text: longText, render: 'include', training: 'exclude', epistemic_status: 'fictional_artifact',
      evidence_type: 'fictional_canon', authority: { source: 'example-author', weight: 1 }, access_scopes: scopes, provenance: ['test'] }],
    add_edges: [{ id: 'story.contains.passage.long', source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: 'passage.long' }, family: 'structural',
      relation: 'contains', order: 1, access_scopes: scopes, provenance: ['test'] }] } })).graphHash;
  const retainedBefore = service.receiptBytes;
  for (let step = 1; step <= 12; step += 1) {
    const view = await service.queryNarrativeGraph({ graphHash: head, mode: 'full', includeContent: true, accessScopes: scopes, forRevision: true });
    const passage = view.nodes.find((node) => node.id === 'passage.1');
    const revised = await service.reviseNarrativeGraphByDelta({ requestId: `edit-${step}`, previousGraphHash: head, accessScopes: scopes, delta: {
      revision: { number: view.graph.revision.number + 1, previous_graph_hash: head, reason: `Edit the first passage (${step}).`, provenance: ['test'] },
      upsertNodes: [{ ...passage, text: `${passage.text} (${step})` }] } });
    assert.equal(revised.revisedByDelta, true);
    head = revised.graphHash;
  }
  assert.ok(service.receiptBytes - retainedBefore < 12 * 64 * 1_024, `twelve revisions by change retained ${service.receiptBytes - retainedBefore} bytes; a whole-graph receipt alone is ${longText.length}`);
  const view = await service.queryNarrativeGraph({ graphHash: head, mode: 'full', includeContent: true, accessScopes: scopes, forRevision: true });
  const next = { number: view.graph.revision.number + 1, previous_graph_hash: head, reason: 'Check the refusals.', provenance: ['test'] };
  await assert.rejects(service.reviseNarrativeGraphByDelta({ requestId: 'missing', previousGraphHash: head, accessScopes: scopes, delta: { revision: next, removeNodeIds: ['missing'] } }), /removes node missing, which the predecessor does not have/);
  await assert.rejects(service.reviseNarrativeGraphByDelta({ requestId: 'hidden', previousGraphHash: head, accessScopes: [], delta: { revision: next, removeEdgeIds: [] } }), /these accessScopes hide some of them/);
  await assert.rejects(service.reviseNarrativeGraphByDelta({ requestId: 'shape', previousGraphHash: head, accessScopes: scopes, delta: { revision: next, nodes: [] } }), /unknown field\(s\) nodes/);

  // The history imports under a receipt budget that whole-graph revisions exceed.
  const history = await exportConstructionHistory(service, { graphHash: head, accessScopes: scopes });
  const budget = 5 * 1_024 * 1_024;
  const small = new LifeSimulationService({ maxReceiptBytes: budget });
  t.after(() => small.close());
  await small.initialize();
  const imported = await importConstructionHistory(small, { requestId: 'import', history });
  assert.equal(imported.headGraphHash, head);
  assert.deepEqual(imported.applied, { registered: 1, additiveBatches: 1, revisionsByChange: 12 });
  const whole = new LifeSimulationService({ maxReceiptBytes: budget });
  t.after(() => whole.close());
  await whole.initialize();
  await assert.rejects((async () => {
    for (const [index, entry] of history.models.entries()) await whole.registerModel({ requestId: `m${index}`, model: entry.definition });
    let definition = history.revisions[0].definition;
    let previous = (await whole.registerNarrativeGraph({ requestId: 'g0', narrativeGraph: definition })).graphHash;
    for (const [index, entry] of history.revisions.slice(1).entries()) {
      definition = applyNarrativeDefinitionDelta(definition, entry.delta);
      previous = (await whole.reviseNarrativeGraph({ requestId: `g${index + 1}`, previousGraphHash: previous, narrativeGraph: definition })).graphHash;
    }
  })(), /global retained-and-pending budget/, 'the same history as whole-graph revisions does not fit');
});
