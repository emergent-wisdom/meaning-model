import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';
import { importConstructionHistory, exportConstructionHistory } from '../src/construction-record.mjs';
import { definitionFromCompleteView } from '../src/narrative-delta.mjs';
import { assertPassageGrounding, noEventLinkDeclaration, readNoEventLinkDeclaration, NARRATIVE_HISTORY_REPLAY } from '../src/narrative-grounding.mjs';
import { proposeNarrativeGrounding, applyNarrativeGrounding, registerNarrativeGroundingTools } from '../src/narrative-grounding-tools.mjs';

const provenance = ['grounding workflow integration fixture'];
const noLinkReason = 'This textual transition is intentionally outside the modeled Events.';
const node = (id, text, render = 'include') => ({ id, text, node_type: 'passage', role: 'story_passage', render,
  epistemic_status: 'authored', evidence_type: 'fictional_canon', authority: { source: 'fixture-author', weight: 1 }, provenance });
const contains = (id, from, to, order = 0) => ({ id, source: { kind: 'node', node_id: from }, target: { kind: 'node', node_id: to },
  family: 'structural', relation: 'contains', order, provenance });
const renders = (id, from, to) => ({ id, source: { kind: 'node', node_id: from }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: to },
  family: 'grounding', relation: 'renders', provenance });

async function fixture(t, { legacy = false, count = 2, linked = false } = {}) {
  const service = new LifeSimulationService(); await service.initialize(); t.after(() => service.close());
  const definition = { schema: 'life-sim-rust-model/v1', id: 'grounding-model', time_unit: 'day',
    revision: { number: 0, reason: 'Two modeled events for passage grounding.', provenance },
    processes: [{ id: 'signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' }, unit: 'signal', provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents: [],
      events: [{ id: 'event.rain', boundary: 'Rain at the doorway.', description: 'Rain falls through the doorway. The visitor enters.', provenance },
        { id: 'event.bell', boundary: 'A bell rings upstairs.', description: 'A bright bell rings upstairs; someone answers it.', provenance }], event_relations: [], event_referent_bindings: [] } };
  const model = await service.registerModel({ requestId: 'model', model: definition });
  const graph = { schema: 'life-sim-rust-narrative-graph/v1', id: 'grounding-graph',
    revision: { number: 0, reason: 'A prose document.', provenance }, source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [{ ...node('book', '# A work'), role: 'document_root' }, ...Array.from({ length: count }, (_, index) => node(`p${index}`, index % 2 ? 'A bright bell rings upstairs.' : 'Rain falls through the doorway.\n\nThe visitor enters.', legacy || linked ? 'include' : 'exclude'))],
    edges: Array.from({ length: count }, (_, index) => contains(`book.p${index}`, 'book', `p${index}`, index)) };
  if (linked) graph.edges.push(...Array.from({ length: count }, (_, index) => renders(`p${index}.renders`, `p${index}`, index % 2 ? 'event.bell' : 'event.rain')));
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graph, [NARRATIVE_HISTORY_REPLAY]: legacy });
  const read = (graphHash = stored.graphHash) => service.queryNarrativeGraph({ graphHash, mode: 'full', includeContent: true });
  const revisions = async () => (await service.listNarrativeRevisions({})).revisions.length;
  return { service, graph, stored, model, read, revisions };
}

test('native live authoring refuses ungrounded registration, batch, full revision, delta and removed Event links', async (t) => {
  const f = await fixture(t);
  const fresh = structuredClone(f.graph); fresh.id = 'new-graph'; fresh.nodes[1].render = 'include';
  await assert.rejects(f.service.registerNarrativeGraph({ requestId: 'bad-register', narrativeGraph: fresh }), /p0.*Nothing was written/);
  const added = node('new-passage', 'A bell rings.');
  await assert.rejects(f.service.applyNarrativeBatch({ requestId: 'bad-batch', previousGraphHash: f.stored.graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: f.stored.graphHash, reason: 'Add prose.', provenance,
      add_nodes: [added], add_roots: [], add_edges: [contains('book.new', 'book', added.id, 2)] } }), /new-passage/);
  const revision = { number: 1, previous_graph_hash: f.stored.graphHash, reason: 'Render existing text.', provenance };
  const successor = { ...structuredClone(f.graph), revision }; successor.nodes[1].render = 'include';
  await assert.rejects(f.service.reviseNarrativeGraph({ requestId: 'bad-full', previousGraphHash: f.stored.graphHash, narrativeGraph: successor }), /p0/);
  await assert.rejects(f.service.reviseNarrativeGraphByDelta({ requestId: 'bad-delta', previousGraphHash: f.stored.graphHash,
    delta: { revision, upsertNodes: [successor.nodes[1]] } }), /p0/);
  assert.equal(await f.revisions(), 1);
  const linked = await fixture(t, { linked: true });
  await assert.rejects(linked.service.reviseNarrativeGraphByDelta({ requestId: 'remove-only-link', previousGraphHash: linked.stored.graphHash,
    delta: { revision: { ...revision, previous_graph_hash: linked.stored.graphHash }, removeEdgeIds: ['p0.renders'] } }), /p0/);
  assert.equal(await linked.revisions(), 1);
});

test('explicit no-link reasons are exact-text-bound and do not turn about or Cut links into Event depiction', () => {
  const passage = node('p', 'Some atmosphere.');
  assert.throws(() => assertPassageGrounding({ nodes: [passage], edges: [{ ...renders('x', 'p', 'event.rain'), family: 'semantic', relation: 'about' }] }), /p/);
  assert.throws(() => assertPassageGrounding({ nodes: [passage], edges: [{ ...renders('x', 'p', 'cut'), target: { kind: 'anchor', anchor_kind: 'normalized_cut', anchor_id: 'cut' } }] }), /p/);
  assert.throws(() => noEventLinkDeclaration(passage.text, ' ', 'agent'), /explain why/);
  passage.provenance = [...provenance, noEventLinkDeclaration(passage.text, noLinkReason, 'calling-agent')];
  assert.doesNotThrow(() => assertPassageGrounding({ nodes: [passage], edges: [] }));
  assert.equal(readNoEventLinkDeclaration(passage).author, 'calling-agent');
  passage.text += ' Changed.';
  assert.equal(readNoEventLinkDeclaration(passage), null);
  assert.throws(() => assertPassageGrounding({ nodes: [passage], edges: [] }), /p/);
});

test('one read-only proposal covers twelve legacy passages with source evidence and no external estimator', async (t) => {
  const f = await fixture(t, { legacy: true, count: 12 }); const before = await f.read();
  const proposal = await proposeNarrativeGrounding(f.service, { graphHash: f.stored.graphHash, candidatesPerPassage: 1 });
  assert.equal(proposal.passages.length, 12); assert.equal(proposal.totalUnlinkedPassages, 12);
  assert.equal(proposal.graphMutation, false); assert.equal(proposal.semanticVerification, false);
  for (const item of proposal.passages) {
    assert.equal(item.status, 'unconfirmed_candidate_proposal');
    assert.equal(item.candidateUniverseCount, 2); assert.equal(item.omittedCandidateCount, 1);
    assert.deepEqual(item.proposedEventIds, [Number(item.nodeId.slice(1)) % 2 ? 'event.bell' : 'event.rain']);
    assert.equal(item.candidates[0].basis, 'lexical_candidate_retrieval');
    assert.ok(item.candidates[0].event.description); assert.ok(item.candidates[0].matchedTerms.length);
  }
  assert.deepEqual(await f.read(), before); assert.equal(await f.revisions(), 1);
  assert.equal((await proposeNarrativeGrounding(f.service, proposal.preparation)).proposalHash, proposal.proposalHash);
});

test('proposal prioritizes existing ancestor associations while allowing explicit corrections and no-link decisions', async (t) => {
  const f = await fixture(t, { legacy: true });
  const declared = await f.service.applyNarrativeBatch({ requestId: 'scene-association', previousGraphHash: f.stored.graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: f.stored.graphHash, reason: 'Existing scene association.', provenance,
      add_roots: [], add_nodes: [], add_edges: [renders('book.renders', 'book', 'event.bell')] } });
  const proposal = await proposeNarrativeGrounding(f.service, { graphHash: declared.graphHash });
  assert.equal(proposal.passages[0].candidates[0].eventId, 'event.bell');
  assert.equal(proposal.passages[0].candidates[0].basis, 'existing_ancestor_renders_declaration');
  const request = { preparation: proposal.preparation, expectedProposalHash: proposal.proposalHash, requestId: 'confirm-correct', author: 'reviewing-agent',
    reason: 'Read the exact prose and corrected the overbroad scene association.',
    decisions: [{ nodeId: 'p0', renders: ['event.rain'] }, { nodeId: 'p1', noLinkReason }] };
  const stored = await applyNarrativeGrounding(f.service, request);
  assert.deepEqual(await applyNarrativeGrounding(f.service, request), stored, 'a completed application retries idempotently');
  const view = await f.read(stored.graphHash);
  assert.deepEqual(view.nodes.map((item) => [item.id, item.text]), (await f.read(declared.graphHash)).nodes.map((item) => [item.id, item.text]));
  assert.ok(view.edges.some((edge) => edge.source.node_id === 'p0' && edge.target.anchor_id === 'event.rain' && edge.family === 'grounding' && edge.relation === 'renders'));
  assert.equal(readNoEventLinkDeclaration(view.nodes.find((item) => item.id === 'p1')).reason, noLinkReason);
  assert.equal((await proposeNarrativeGrounding(f.service, { graphHash: stored.graphHash })).passages.length, 0);
});

test('application refuses missing decisions, unknown Events, changed proposal fingerprints and a stale graph head before writing', async (t) => {
  const f = await fixture(t, { legacy: true });
  const proposal = await proposeNarrativeGrounding(f.service, { graphHash: f.stored.graphHash });
  const request = { preparation: proposal.preparation, expectedProposalHash: proposal.proposalHash, requestId: 'apply', author: 'agent', reason: 'Confirm exact passage Event selections.',
    decisions: [{ nodeId: 'p0', renders: ['event.rain'] }, { nodeId: 'p1', renders: ['event.bell'] }] };
  await assert.rejects(applyNarrativeGrounding(f.service, { ...request, decisions: [] }), /Too small/);
  await assert.rejects(applyNarrativeGrounding(f.service, { ...request, decisions: request.decisions.slice(0, 1) }), /exactly one/);
  await assert.rejects(applyNarrativeGrounding(f.service, { ...request, decisions: [{ nodeId: 'p0' }, request.decisions[1]] }), /never automatically accepted/);
  await assert.rejects(applyNarrativeGrounding(f.service, { ...request, decisions: [{ nodeId: 'p0', renders: ['missing'] }, request.decisions[1]] }), /Unknown Event/);
  await assert.rejects(applyNarrativeGrounding(f.service, { ...request, expectedProposalHash: '0'.repeat(64) }), /stale/);
  const oldRead = f.service.inspectModel.bind(f.service);
  f.service.inspectModel = async (input) => { const result = await oldRead(input); result.model.meaning_model.events[0].description += ' Changed source.'; return result; };
  await assert.rejects(applyNarrativeGrounding(f.service, request), /stale/);
  f.service.inspectModel = oldRead;
  assert.equal(await f.revisions(), 1);
  await f.service.applyNarrativeBatch({ requestId: 'advance', previousGraphHash: f.stored.graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: f.stored.graphHash, reason: 'Another author advances the graph.', provenance,
      add_roots: [], add_nodes: [{ ...node('note', 'A note.', 'exclude'), role: 'metadata' }], add_edges: [contains('book.note', 'book', 'note', 2)] } });
  await assert.rejects(applyNarrativeGrounding(f.service, request), /no longer a current head/);
  assert.equal(await f.revisions(), 2);
});

test('split and merge require grounding for every successor; text changes expire a no-link declaration', async (t) => {
  const f = await fixture(t, { linked: true });
  const request = { graphHash: f.stored.graphHash, requestId: 'split', reason: 'Split independently revised prose.',
    operations: [{ kind: 'split', nodeId: 'p0', parts: [{ id: 'p0.a', text: 'Rain falls through the doorway.' }, { id: 'p0.b', text: 'The visitor enters.' }] }] };
  await assert.rejects(editNarrativeGraph(f.service, request), /p0.a, p0.b/);
  request.operations[0].parts[0].renders = ['event.rain']; request.operations[0].parts[1].noLinkReason = noLinkReason;
  const split = await editNarrativeGraph(f.service, request);
  const mergeRequest = { graphHash: split.graphHash, requestId: 'merge', reason: 'Merge the consecutive parts.',
    operations: [{ kind: 'merge', nodeIds: ['p0.a', 'p0.b'], mergedNodeId: 'merged' }] };
  await assert.rejects(editNarrativeGraph(f.service, mergeRequest), /merged/);
  mergeRequest.operations[0].renders = ['event.rain'];
  const merged = await editNarrativeGraph(f.service, mergeRequest);
  assert.equal((await f.read(merged.graphHash)).nodes.find((item) => item.id === 'merged').text, f.graph.nodes[1].text);
  const edit = { graphHash: split.graphHash, requestId: 'edit-waived', reason: 'Change an explicitly unmodeled transition.',
    operations: [{ kind: 'replace_text', nodeId: 'p0.b', expectedText: 'The visitor enters.', text: 'A quiet transition.' }] };
  await assert.rejects(editNarrativeGraph(f.service, edit), /p0.b/);
  edit.operations[0].noLinkReason = noLinkReason;
  await editNarrativeGraph(f.service, edit);
});

test('portable historical import preserves unlinked prose exactly and permits proposal-driven repair', async (t) => {
  const original = await fixture(t, { legacy: true });
  const history = await exportConstructionHistory(original.service, { graphHash: original.stored.graphHash, accessScopes: [] });
  const destination = new LifeSimulationService(); await destination.initialize(); t.after(() => destination.close());
  const imported = await importConstructionHistory(destination, { requestId: 'import-old', history });
  assert.equal(imported.headGraphHash, original.stored.graphHash);
  const proposal = await proposeNarrativeGrounding(destination, { graphHash: imported.headGraphHash });
  assert.equal(proposal.passages.length, 2);
});

test('MCP tools expose separate read-only proposal and explicit write application schemas', () => {
  const tools = new Map(); registerNarrativeGroundingTools({ registerTool: (name, config) => tools.set(name, config) }, {}, { toolResult: (value) => value });
  assert.equal(tools.get('life_narrative_grounding_propose').annotations.readOnlyHint, true);
  assert.equal(tools.get('life_narrative_grounding_apply').annotations.readOnlyHint, false);
});
