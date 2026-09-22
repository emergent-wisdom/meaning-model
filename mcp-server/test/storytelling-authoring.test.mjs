import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { exploreStoredTrajectory, reviseStoredTrajectory, storeAuthorRecord }
  from '../src/storytelling-authoring.mjs';

const initialHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture({ source = { source_kind: 'model', source_hash: 'c'.repeat(64) }, nodes = [], edges = [], revision = 0 } = {}) {
  const initial = {
    graph_hash: initialHash, source_snapshot_hash: snapshotHash, content_included: true,
    graph: { source_snapshot: source, revision: { number: revision } }, roots: ['book'],
    nodes: [{ id: 'book', role: 'document_root', access_scopes: ['author'] }, ...nodes], edges,
  };
  const versions = new Map([[initialHash, structuredClone(initial)]]);
  const requests = new Map();
  const reads = [];
  const writes = [];
  const service = {
    async queryNarrativeGraph(input) {
      reads.push(structuredClone(input));
      assert.equal(input.graphHash, input.expectedGraphHash);
      assert.equal(input.mode, 'full');
      assert.equal(input.includeContent, true);
      const view = structuredClone(versions.get(input.graphHash));
      assert.ok(view, 'the query must address an existing immutable graph version');
      view.nodes = view.nodes.filter((node) => !node.access_scopes?.length
        || node.access_scopes.some((scope) => input.accessScopes.includes(scope)));
      const visible = new Set(view.nodes.map((node) => node.id));
      view.roots = view.roots.filter((nodeId) => visible.has(nodeId));
      view.edges = view.edges.filter((edge) => visible.has(edge.source.node_id) && visible.has(edge.target.node_id));
      return view;
    },
    async applyNarrativeBatch(input) {
      writes.push(structuredClone(input));
      const request = requests.get(input.requestId);
      if (request) {
        assert.deepEqual(input, request.input, 'retrying a request must preserve the exact stored payload');
        return structuredClone(request.receipt);
      }
      const batch = input.narrativeBatch;
      assert.equal(batch.schema, 'life-sim-rust-narrative-batch/v1');
      assert.equal(input.previousGraphHash, batch.previous_graph_hash);
      const view = structuredClone(versions.get(input.previousGraphHash));
      assert.ok(view, 'writes require an existing immutable predecessor');
      const nodeIds = new Set(view.nodes.map((node) => node.id));
      for (const node of batch.add_nodes) {
        assert.equal(nodeIds.has(node.id), false, 'a batch cannot overwrite an existing node');
        nodeIds.add(node.id);
      }
      for (const edge of batch.add_edges) {
        assert.ok(nodeIds.has(edge.source.node_id));
        assert.ok(nodeIds.has(edge.target.node_id));
      }
      const placements = new Set();
      for (const edge of [...view.edges, ...batch.add_edges]) {
        if (edge.family !== 'structural' || edge.relation !== 'contains') continue;
        const placement = JSON.stringify([edge.source.node_id, edge.order]);
        assert.equal(placements.has(placement), false, 'contains siblings cannot reuse an order, even when scoped from the current query');
        placements.add(placement);
      }
      view.roots.push(...batch.add_roots);
      view.nodes.push(...batch.add_nodes);
      view.edges.push(...batch.add_edges);
      view.graph.revision.number += 1;
      const graphHash = digest(input);
      view.graph_hash = graphHash;
      versions.set(graphHash, view);
      const receipt = { graphHash, snapshotHash, immutableRevision: true };
      requests.set(input.requestId, { input: structuredClone(input), receipt });
      return structuredClone(receipt);
    },
  };
  return { service, versions, reads, writes, initial };
}

function record(overrides = {}) {
  return { graphHash: initialHash, requestId: 'request.1', nodeId: 'author.note.1', storyRootId: 'book',
    authorId: 'writer', accessScopes: ['author'], ...overrides };
}

function exploration() {
  return {
    definition: { targetKind: 'life', subjectId: 'character.fern', timeUnit: 'age in years',
      brief: 'Explore changing trust in the settlement across a surveyor’s life.',
      axes: [{ id: 'trust', meaning: 'Confidence that the settlement will provide support.',
        comparisonQuestion: 'How much support does this person expect?', unit: 'authored support scale', minimum: 0, maximum: 1 }] },
    points: [
      { id: 'early', at: 8, label: 'Earliest established history', values: { trust: 0.7 }, fixed: ['trust'] },
      { id: 'leaving', at: 24, label: 'Departure', values: { trust: 0.3 } },
      { id: 'return', at: 58, label: 'Return before the story opens', values: { trust: 0.6 } },
    ],
    randomness: 0.7, candidateCount: 3,
  };
}

test('an authored assessment is a scoped Understanding Node under a named root and authoring clock', async () => {
  const f = fixture({ nodes: [{ id: 'draft', role: 'metadata', access_scopes: ['author'] }] });
  const before = structuredClone(f.versions.get(initialHash));
  const first = await storeAuthorRecord(f.service, { ...record(), kind: 'assessment',
    text: 'The return has promise, but trust recovers before any supporting event.',
    data: { coherence: 'revise', proposedRepair: 'Delay the recovery in trust.' },
    links: [{ relation: 'about', targetNodeId: 'draft' }] });
  assert.equal(first.understandingNode, true);
  assert.equal(first.graphMutation, true);
  assert.equal(first.worldMutation, false);
  assert.equal(first.semanticVerification, false);
  assert.equal(first.authoringStep, 0);
  const stored = f.versions.get(first.graphHash);
  const root = stored.nodes.find((node) => node.id === first.understandingRootId);
  const assessment = stored.nodes.find((node) => node.id === first.recordNodeId);
  assert.ok(stored.roots.includes(root.id));
  assert.equal(root.node_type, 'understanding_process_root');
  assert.equal(JSON.parse(root.text).clock, 'authoring_step');
  assert.equal(root.subject, 'book');
  assert.equal(assessment.role, 'externalized_reflection');
  assert.equal(assessment.holder, 'writer');
  for (const node of [root, assessment]) {
    assert.equal(node.render, 'exclude');
    assert.equal(node.training, 'exclude');
    assert.deepEqual(node.access_scopes, ['author']);
  }
  assert.deepEqual(JSON.parse(assessment.text).authoringClock, { rootId: root.id, unit: 'authoring_step', at: 0 });
  assert.ok(stored.edges.some((edge) => edge.source.node_id === root.id && edge.target.node_id === assessment.id
    && edge.family === 'structural' && edge.relation === 'contains' && edge.order === 0));
  assert.ok(stored.edges.some((edge) => edge.source.node_id === assessment.id && edge.target.node_id === 'draft'
    && edge.relation === 'about'));
  assert.deepEqual(f.versions.get(initialHash), before);

  const second = await storeAuthorRecord(f.service, { ...record({ graphHash: first.graphHash, requestId: 'request.2', nodeId: 'author.note.2' }),
    kind: 'selection', text: 'Keep the character and revise the return point.',
    links: [{ relation: 'supports', targetNodeId: assessment.id }] });
  assert.equal(second.understandingRootId, root.id);
  assert.equal(second.authoringStep, 1);
  assert.deepEqual(f.writes[1].narrativeBatch.add_roots, []);
  assert.equal(f.writes[1].narrativeBatch.add_nodes.length, 1);
});

test('the authoring clock uses graph revision even when an earlier sibling is hidden by scope', async () => {
  const rootId = `story.understanding.${createHash('sha256').update('book').digest('hex').slice(0, 24)}`;
  const f = fixture({ revision: 3, nodes: [
    { id: rootId, node_type: 'understanding_process_root', subject: 'book',
      render: 'exclude', training: 'exclude', access_scopes: ['author', 'editor'] },
    { id: 'private.first', role: 'externalized_reflection', access_scopes: ['author'] },
  ], edges: [{ id: 'private.first.placement', source: { kind: 'node', node_id: rootId },
    target: { kind: 'node', node_id: 'private.first' }, family: 'structural', relation: 'contains',
    order: 0, access_scopes: ['author'] }] });
  f.versions.get(initialHash).nodes[0].access_scopes = ['author', 'editor'];
  const result = await storeAuthorRecord(f.service, { ...record({ accessScopes: ['editor'], authorId: 'editor' }),
    kind: 'assessment', text: 'The editor records a separate assessment.' });
  assert.equal(result.authoringStep, 3);
  assert.deepEqual(f.reads[0].accessScopes, ['editor']);
  const stored = f.versions.get(result.graphHash);
  const placement = stored.edges.find((edge) => edge.target.node_id === result.recordNodeId && edge.relation === 'contains');
  assert.equal(placement.order, 3);
  assert.equal(stored.graph.revision.number, 4);
  assert.deepEqual(JSON.parse(stored.nodes.find((node) => node.id === result.recordNodeId).text).authoringClock,
    { rootId, unit: 'authoring_step', at: 3 });
});

test('draft records preserve exact text including surrounding whitespace and reject blank drafts', async () => {
  const f = fixture();
  const text = '\n  The ship returned without its pilot.\r\n';
  const result = await storeAuthorRecord(f.service, { ...record({ nodeId: 'scene.draft' }), kind: 'draft', text });
  const node = f.versions.get(result.graphHash).nodes.find((item) => item.id === 'scene.draft');
  assert.equal(JSON.parse(node.text).text, text);
  await assert.rejects(storeAuthorRecord(f.service, { ...record({ requestId: 'blank', nodeId: 'blank.draft' }),
    kind: 'draft', text: '\n \t\r\n' }));
  assert.equal(f.writes.length, 1);
});

test('author records require visible targets and a common explicit scope', async () => {
  const f = fixture({ nodes: [
    { id: 'secret', role: 'metadata', access_scopes: ['secret'] },
    { id: 'shared', role: 'metadata', access_scopes: ['author', 'second'] },
  ] });
  const input = { ...record(), kind: 'context', text: 'A scoped context record.' };
  await assert.rejects(storeAuthorRecord(f.service, { ...input, links: [{ relation: 'about', targetNodeId: 'secret' }] }), /inaccessible/);
  await assert.rejects(storeAuthorRecord(f.service, { ...input, accessScopes: ['author', 'secret'],
    links: [{ relation: 'about', targetNodeId: 'secret' }] }), /common explicit access scope/);
  await assert.rejects(storeAuthorRecord(f.service, { ...input, accessScopes: ['secret'] }), /story root is unknown, inaccessible/);
  await assert.rejects(storeAuthorRecord(f.service, { ...input, accessScopes: [] }));
  assert.equal(f.writes.length, 0);
  const stored = await storeAuthorRecord(f.service, { ...input, accessScopes: ['second', 'author', 'author'],
    links: [{ relation: 'about', targetNodeId: 'shared' }] });
  assert.deepEqual(f.reads.at(-1).accessScopes, ['author', 'second']);
  for (const node of f.writes[0].narrativeBatch.add_nodes) assert.deepEqual(node.access_scopes, ['author']);
  for (const edge of f.writes[0].narrativeBatch.add_edges) assert.deepEqual(edge.access_scopes, ['author']);
  assert.ok(stored.graphHash);
});

test('authoring accepts model, world and committed-candidate sources but refuses uncommitted candidates', async () => {
  const input = { ...record(), kind: 'draft', text: 'The ship returned without its pilot.' };
  for (const source of [
    { source_kind: 'model', source_hash: 'c'.repeat(64) },
    { source_kind: 'world', source_hash: 'c'.repeat(64), time: 40 },
    { source_kind: 'candidate', source_hash: 'c'.repeat(64), candidate_status: 'committed' },
  ]) {
    const f = fixture({ source });
    const result = await storeAuthorRecord(f.service, input);
    assert.equal(result.understandingNode, false);
    assert.equal(f.writes.length, 1);
  }
  const f = fixture({ source: { source_kind: 'candidate', candidate_status: 'proposed' } });
  await assert.rejects(storeAuthorRecord(f.service, input), /committed-candidate source/);
  assert.equal(f.writes.length, 0);
});

test('stale reads, missing content and reused node IDs cannot produce author records', async () => {
  const input = { ...record(), kind: 'draft', text: 'A draft.' };
  for (const alter of [
    (view) => { view.graph_hash = 'd'.repeat(64); },
    (view) => { view.content_included = false; },
  ]) {
    const f = fixture();
    alter(f.versions.get(initialHash));
    await assert.rejects(storeAuthorRecord(f.service, input), /exact graph with content/);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  const first = await storeAuthorRecord(f.service, input);
  await assert.rejects(storeAuthorRecord(f.service, { ...input, graphHash: first.graphHash, requestId: 'another' }), /already exists/);
  assert.equal(f.writes.length, 1);
});

test('life exploration warns when its first point is after birth, and an added point leaves the others unchanged', async () => {
  const f = fixture();
  const late = await exploreStoredTrajectory(f.service, { record: record({ nodeId: 'life.late' }), exploration: { ...exploration(), seed: 'coverage-seed' } });
  assert.equal(late.warnings.length, 1);
  assert.match(late.warnings[0], /earliest life point is at 8/);
  assert.match(late.warnings[0], /lifeBeginning/);
  const withBirth = exploration();
  withBirth.points.unshift({ id: 'birth', at: 0, label: 'Birth', values: { trust: 0.9 }, fixed: ['trust'] });
  const covered = await exploreStoredTrajectory(f.service, { record: record({ requestId: 'birth-request', nodeId: 'life.covered' }), exploration: { ...withBirth, seed: 'coverage-seed' } });
  assert.deepEqual(covered.warnings, []);
  for (const [index, candidate] of late.candidates.entries()) {
    for (const point of candidate.points) {
      assert.deepEqual(covered.candidates[index].points.find((item) => item.id === point.id).values, point.values,
        'sampling is per point, so adding a birth point with the same seed keeps every other value');
    }
  }
});

test('trajectory exploration persists all numerical proposals and request-derived seeds replay exactly', async () => {
  const f = fixture();
  const input = { record: record({ nodeId: 'life.candidates' }), exploration: exploration() };
  const result = await exploreStoredTrajectory(f.service, input);
  const retry = await exploreStoredTrajectory(f.service, input);
  assert.deepEqual(retry, result);
  assert.equal(result.seedSource, 'request_derived');
  assert.equal(result.graphMutation, true);
  assert.equal(result.worldMutation, false);
  assert.equal(result.canonical, false);
  const node = f.versions.get(result.graphHash).nodes.find((item) => item.id === 'life.candidates');
  assert.equal(node.node_type, 'storytelling.candidate');
  const stored = JSON.parse(node.text).data;
  assert.deepEqual(stored.definition, result.definition);
  assert.deepEqual(stored.baseline, result.baseline);
  assert.deepEqual(stored.candidates, result.candidates);
  assert.equal(stored.sampling.seed, result.sampling.seed);
  assert.equal(stored.taskHash, result.taskHash);
  assert.equal(stored.candidates.length, 3);
  assert.equal(f.versions.get(initialHash).nodes.length, 1);

  const alternative = await exploreStoredTrajectory(f.service, { record: record({ requestId: 'different-request', nodeId: 'life.candidates' }),
    exploration: exploration() });
  assert.notEqual(alternative.sampling.seed, result.sampling.seed);
  assert.notDeepEqual(alternative.candidates, result.candidates);
});

test('a stored local revision loads its exact predecessor, preserves it and creates a refines Understanding Node', async () => {
  const f = fixture();
  const source = await exploreStoredTrajectory(f.service, { record: record({ nodeId: 'life.candidates' }), exploration: exploration() });
  const predecessor = structuredClone(f.versions.get(source.graphHash));
  const chosen = source.candidates[1];
  const input = { record: record({ graphHash: source.graphHash, requestId: 'revise.1', nodeId: 'life.revision' }),
    sourceNodeId: 'life.candidates', candidateId: chosen.id,
    reason: 'Retain this character and delay the unsupported recovery in trust.',
    changes: [{ pointId: 'return', axisId: 'trust', value: 0.2, reason: 'Support has not yet been demonstrated.' }] };
  const result = await reviseStoredTrajectory(f.service, input);
  assert.equal(result.understandingNode, true);
  assert.equal(result.sourceCandidateHash, chosen.candidateHash);
  assert.equal(result.candidate.revision.parentCandidateHash, chosen.candidateHash);
  const expected = structuredClone(chosen.points);
  expected[2].values.trust = 0.2;
  assert.deepEqual(result.candidate.points, expected);
  assert.deepEqual(f.versions.get(source.graphHash), predecessor);
  const current = f.versions.get(result.graphHash);
  assert.deepEqual(current.nodes.find((node) => node.id === 'life.candidates'),
    predecessor.nodes.find((node) => node.id === 'life.candidates'));
  const revision = current.nodes.find((node) => node.id === 'life.revision');
  assert.equal(revision.role, 'externalized_reflection');
  assert.equal(revision.node_type, 'storytelling.revision');
  assert.deepEqual(JSON.parse(revision.text).data.candidate, result.candidate);
  assert.ok(current.edges.some((edge) => edge.source.node_id === revision.id && edge.target.node_id === 'life.candidates'
    && edge.relation === 'refines'));
  assert.ok(current.edges.some((edge) => edge.source.node_id === result.understandingRootId && edge.target.node_id === revision.id
    && edge.relation === 'contains'));

  const next = await reviseStoredTrajectory(f.service, { ...input,
    record: record({ graphHash: result.graphHash, requestId: 'revise.2', nodeId: 'life.revision.2' }),
    sourceNodeId: 'life.revision', reason: 'Explain the hesitation through an unresolved promise.', changes: [] });
  assert.equal(next.candidate.revision.number, 2);
  assert.equal(next.candidate.revision.parentCandidateHash, result.candidate.candidateHash);
  assert.deepEqual(next.candidate.points, result.candidate.points);
});

test('stored revisions reject external proposals, unknown candidates, foreign stories, inaccessible sources and corrupted numbers', async () => {
  const f = fixture({ nodes: [{ id: 'other-book', role: 'document_root', access_scopes: ['author'] }] });
  const source = await exploreStoredTrajectory(f.service, { record: record({ nodeId: 'life.candidates' }), exploration: exploration() });
  const input = { record: record({ graphHash: source.graphHash, requestId: 'revision', nodeId: 'repair' }),
    sourceNodeId: 'life.candidates', candidateId: source.candidates[0].id,
    reason: 'Assess a possible repair.', changes: [] };
  await assert.rejects(reviseStoredTrajectory(f.service, { ...input, proposal: { definition: source.definition, candidate: source.candidates[0] } }));
  await assert.rejects(reviseStoredTrajectory(f.service, { ...input, sourceNodeId: 'missing' }), /accessible stored candidate/);
  await assert.rejects(reviseStoredTrajectory(f.service, { ...input, candidateId: 'invented' }), /Candidate ID is not/);
  await assert.rejects(reviseStoredTrajectory(f.service, { ...input, record: { ...input.record, storyRootId: 'other-book' } }), /for this story/);
  assert.equal(f.writes.length, 1);

  const storedNode = f.versions.get(source.graphHash).nodes.find((node) => node.id === 'life.candidates');
  storedNode.access_scopes = ['hidden'];
  await assert.rejects(reviseStoredTrajectory(f.service, input), /accessible stored candidate/);
  storedNode.access_scopes = ['author'];
  const payload = JSON.parse(storedNode.text);
  payload.data.candidates[0].points[2].values.trust = 0.123456;
  storedNode.text = JSON.stringify(payload);
  await assert.rejects(reviseStoredTrajectory(f.service, input), /hash changed/);
  assert.equal(f.writes.length, 1);
});
