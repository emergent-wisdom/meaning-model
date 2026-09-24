import assert from 'node:assert/strict';
import test from 'node:test';
import { StorytellingAddon, scenePrepareSchema } from '../src/storytelling-addon.mjs';
import { refreshDepthFixture, lifeConnections, lifeTrendsEdges, lifeTrendsNode } from './storytelling-life-fixture.mjs';
import { withLives } from './storytelling-life-fixture.mjs';

const graphHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);

function fixture() {
  const calls = [];
  const nodes = [
    { id: 'book', role: 'document_root', access_scopes: [] },
    { id: 'key', role: 'metadata', text: 'The key is under the bridge.',
      evidence_cutoff: 2, epistemic_status: 'fictional_canon', access_scopes: [] },
    { id: 'betrayal', role: 'metadata', text: 'Ada betrayed Leo.',
      evidence_cutoff: 8, epistemic_status: 'fictional_canon', access_scopes: [] },
    lifeTrendsNode(),
  ];
  const view = {
    graph_hash: graphHash, source_snapshot_hash: snapshotHash, content_included: true,
    graph: { revision: { number: 0 }, source_snapshot: { source_kind: 'world', source_hash: 'c'.repeat(64), time: 10 } },
    roots: ['book'], nodes, edges: lifeTrendsEdges(),
  };
  const service = {
    async queryNarrativeGraph(input) {
      assert.equal(input.graphHash, graphHash);
      assert.equal(input.expectedGraphHash, graphHash);
      refreshDepthFixture(view, preparation);
      return structuredClone(view);
    },
    async applyNarrativeBatch(input) {
      calls.push(input);
      return { graphHash: 'd'.repeat(64), snapshotHash, immutableRevision: true };
    },
    // The bound model: its Cut-bearing Events are described unless a test says otherwise.
    model: { id: 'fixture-model', meaning_model: { events: [], normalized_cuts: [] } },
    async inspectModel() { return { modelHash: 'f'.repeat(64), model: withLives(this.model, this.people ?? ['Leo']) }; },
  };
  const preparation = {
    graphHash, lifeTrendsNodeId: 'life.trends', modelDepthReviewNodeId: 'depth.review', accessScopes: [], scene: {
      id: 'scene-3', parentNodeId: 'book', order: 2, worldTime: 4, routePartId: 'part.1',
      readerOrder: 3, viewpoint: 'Leo', brief: 'Leo finds the key without learning about Ada.',
      characterConnections: lifeConnections(),
      context: [
        { nodeId: 'key', viewpointKnownAt: 3, readerKnownAt: 3 },
        { nodeId: 'betrayal', viewpointKnownAt: 8, readerKnownAt: 7 },
      ],
      requirements: [{ id: 'voice', instruction: 'Keep Leo’s speech terse.' }],
    },
  };
  return { addon: new StorytellingAddon(service), calls, view, preparation, service };
}

test('a scene cannot be committed while an Event carries a Cut without a description', async () => {
  const { addon, preparation, service } = fixture();
  service.model = { id: 'fixture-model', meaning_model: {
    events: [{ id: 'ev.bridge', boundary: 'Leo at the bridge.' }, { id: 'ev.home', boundary: 'Leo at home.', description: 'Leo comes home and hides the key.' }],
    normalized_cuts: [{ id: 'cut.bridge.attention', parent_event_id: 'ev.bridge' }, { id: 'cut.home.attention', parent_event_id: 'ev.home' }] } };
  const packet = await addon.prepare(preparation);
  const blocker = packet.blockers.find((entry) => entry.code === 'undescribed-numbers');
  assert.deepEqual(blocker.eventIds, ['ev.bridge']);
  assert.match(blocker.explanation, /Describe them in a model revision/);
});

async function reviewedInput(f) {
  const packet = await f.addon.prepare(f.preparation);
  const text = 'Leo found the key beneath the bridge. “Good.”';
  f.view.nodes.push({ id: 'draft', node_type: 'storytelling.draft', subject: 'book', render: 'exclude', access_scopes: [], text: JSON.stringify({ text }) });
  return {
    preparation: f.preparation, expectedPacketHash: packet.packetHash, draftNodeId: 'draft', text, reviewer: 'editor',
    findings: packet.checks.map((check) => ({
      checkId: check.id, status: 'satisfied',
      explanation: check.id.includes('betrayal') ? 'The scene contains no reference to Ada’s betrayal.'
        : 'The scene preserves the supplied context and requested voice.', citations: [],
    })),
    uses: [{ nodeId: 'key', audience: 'reader', start: 0, end: 36, quote: text.slice(0, 36) }],
  };
}

test('scene packet separates world time, viewpoint knowledge, and reader reveal order', async () => {
  const f = fixture();
  const packet = await f.addon.prepare(f.preparation);
  assert.deepEqual(packet.viewpointContext, ['key']);
  assert.deepEqual(packet.readerReveals, ['key']);
  assert.deepEqual(packet.readerWithheld, ['betrayal']);
  assert.equal(packet.source.time, 10); // A later source does not become viewpoint knowledge.
  assert.deepEqual(packet.blockers, []);
  assert.deepEqual(f.calls, []);
  f.preparation.scene.worldTime = 1; // A flashback does not reverse reader order.
  const flashback = await f.addon.prepare(f.preparation);
  assert.deepEqual(flashback.viewpointContext, []);
  assert.deepEqual(flashback.readerReveals, ['key']);
  assert.notEqual(flashback.packetHash, packet.packetHash);
});

test('declared current knowledge requires a known source evidence cutoff no later than scene time', async () => {
  for (const cutoff of [null, undefined, 5]) {
    const f = fixture();
    f.view.nodes[1].evidence_cutoff = cutoff;
    const input = await reviewedInput(f);
    const report = await f.addon.review(input);
    assert.equal(report.readyToCommit, false);
    assert.ok(report.blockers.some((blocker) => blocker.code === 'viewpoint-evidence-cutoff'));
    await assert.rejects(f.addon.commit({ ...input, requestId: 'unsafe', expectedReviewHash: report.reviewHash }), /unresolved blockers/);
    assert.deepEqual(f.calls, []);
  }
});

test('cited future viewpoint knowledge and withheld reader disclosure block even satisfied findings', async () => {
  for (const audience of ['viewpoint', 'reader']) {
    const f = fixture();
    const input = await reviewedInput(f);
    const quote = 'Ada betrayed him.';
    const start = input.text.length + 1;
    input.text += ` ${quote}`;
    f.view.nodes.find((node) => node.id === 'draft').text = JSON.stringify({ text: input.text });
    input.uses.push({ nodeId: 'betrayal', audience, start, end: input.text.length, quote });
    const report = await f.addon.review(input);
    assert.ok(report.blockers.some((blocker) => blocker.code === `${audience}-knowledge-leak`));
    assert.equal(report.readyToCommit, false);
    assert.deepEqual(f.calls, []);
  }
});

test('review needs complete findings, real draft excerpts, and a cited required reveal', async () => {
  const f = fixture();
  const input = await reviewedInput(f);
  await assert.rejects(f.addon.review({ ...input, findings: input.findings.slice(1) }), /every packet check/);
  await assert.rejects(f.addon.review({ ...input, findings: [...input.findings, input.findings[0]] }), /unique/);
  await assert.rejects(f.addon.review({ ...input, uses: [{ ...input.uses[0], quote: 'A different draft.' }] }), /exact draft/);
  await assert.rejects(f.addon.review({ ...input,
    findings: input.findings.map((item, index) => index ? item : {
      ...item, citations: [{ start: 0, end: 5, quote: 'Wrong' }],
    }),
  }), /exact draft/);
  const missingReveal = await f.addon.review({ ...input, uses: [] });
  assert.ok(missingReveal.blockers.some((blocker) => blocker.code === 'missing-reader-reveal'));
  for (const status of ['unknown', 'conflict']) {
    const report = await f.addon.review({ ...input,
      findings: input.findings.map((item, index) => index ? item : { ...item, status }),
    });
    assert.equal(report.readyToCommit, false);
    assert.ok(report.blockers.some((blocker) => blocker.code === `review-${status}`));
  }
});

test('changed packet, snapshot, draft or review cannot reuse a previously approved hash', async () => {
  const f = fixture();
  const input = await reviewedInput(f);
  const report = await f.addon.review(input);
  const commit = { ...input, requestId: 'save', expectedReviewHash: report.reviewHash };
  await assert.rejects(f.addon.commit({ ...commit, text: `${input.text} He waited.` }), /exact draft/);
  await assert.rejects(f.addon.commit({ ...commit, reviewer: 'another-editor' }), /review hash changed/);
  const altered = structuredClone(input);
  altered.preparation.scene.worldTime = 6;
  await assert.rejects(f.addon.review(altered), /packet hash changed/);
  f.view.source_snapshot_hash = 'e'.repeat(64);
  await assert.rejects(f.addon.review(input), /packet hash changed/);
  assert.deepEqual(f.calls, []);
});

test('unknown/inaccessible context and unaccepted candidate sources fail before any mutation', async () => {
  for (const status of ['pending', 'rejected', 'superseded']) {
    const f = fixture();
    f.view.graph.source_snapshot = { source_kind: 'candidate', candidate_status: status };
    await assert.rejects(f.addon.prepare(f.preparation), /committed-candidate/);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  f.view.nodes.splice(1, 1);
  await assert.rejects(f.addon.prepare(f.preparation), /unknown or inaccessible/);
  assert.deepEqual(f.calls, []);
});

test('successful commit submits one atomic Rust batch containing exact prose and nonrendered review', async () => {
  const f = fixture();
  f.view.nodes[2].access_scopes = ['author-private'];
  f.preparation.accessScopes = ['author-private'];
  const input = await reviewedInput(f);
  const report = await f.addon.review(input);
  const result = await f.addon.commit({ ...input, requestId: 'scene-save', expectedReviewHash: report.reviewHash });
  assert.equal(result.worldMutation, false);
  assert.equal(result.semanticProseVerification, false);
  assert.equal(f.calls.length, 1);
  const { narrativeBatch: batch } = f.calls[0];
  assert.equal(batch.previous_graph_hash, graphHash);
  assert.equal(batch.add_nodes[0].text, input.text);
  assert.equal(batch.add_nodes[0].render, 'include');
  const reviewNode = batch.add_nodes.find((node) => node.id === result.reviewNodeId);
  assert.equal(reviewNode.render, 'exclude');
  assert.equal(reviewNode.training, 'exclude');
  assert.equal(reviewNode.role, 'externalized_reflection');
  const audit = JSON.parse(reviewNode.text).data;
  assert.equal(audit.review.reviewHash, report.reviewHash);
  assert.equal(audit.packet.packetHash, input.expectedPacketHash);
  assert.deepEqual(batch.add_nodes.map((node) => node.access_scopes), [['author-private'], ['author-private'], ['author-private']]);
  assert.equal(batch.add_edges[0].relation, 'contains');
  assert.equal(batch.add_edges.find((edge) => edge.id === 'scene-3.placement').order, 2);
  assert.ok(batch.add_edges.some((edge) => edge.source.node_id === result.understandingRootId && edge.target.node_id === result.reviewNodeId && edge.relation === 'contains'));
  assert.equal(batch.add_edges.filter((edge) => edge.family === 'grounding').length, 3);
  assert.equal(batch.add_edges.filter((edge) => edge.relation === 'uses_life_trends').length, 1);
});

test('an atomic Rust rejection is propagated instead of returning a successful scene receipt', async () => {
  const f = fixture();
  f.addon.service.applyNarrativeBatch = async () => { throw new Error('Rust rejected conflicting sibling order'); };
  const input = await reviewedInput(f);
  const report = await f.addon.review(input);
  await assert.rejects(f.addon.commit({ ...input, requestId: 'save', expectedReviewHash: report.reviewHash }), /conflicting sibling order/);
});

test('scene input is bounded in UTF-8 bytes before loading a graph', async () => {
  const f = fixture();
  const input = await reviewedInput(f);
  input.text = '😀'.repeat(70_000);
  await assert.rejects(f.addon.review(input), /UTF-8 bytes/);
  assert.deepEqual(f.calls, []);
});

test('stored permissions intersect restricted audiences and never expand to caller read scopes', async () => {
  const f = fixture();
  f.preparation.accessScopes = ['editor', 'private-a', 'private-b', 'unrelated'];
  f.view.nodes[0].access_scopes = ['editor', 'private-a'];
  f.view.nodes[1].access_scopes = ['editor', 'private-b'];
  const input = await reviewedInput(f);
  const report = await f.addon.review(input);
  await f.addon.commit({ ...input, requestId: 'private-scene', expectedReviewHash: report.reviewHash });
  assert.ok(f.calls[0].narrativeBatch.add_nodes.every((node) => node.access_scopes.join() === 'editor'));
  assert.ok(f.calls[0].narrativeBatch.add_edges.every((edge) => edge.access_scopes.join() === 'editor'));
});

test('disjoint context permissions block combining private content instead of making it public', async () => {
  const f = fixture();
  f.preparation.accessScopes = ['private-a', 'private-b'];
  f.view.nodes[0].access_scopes = ['private-a'];
  f.view.nodes[1].access_scopes = ['private-b'];
  const input = await reviewedInput(f);
  const report = await f.addon.review(input);
  assert.equal(report.readyToCommit, false);
  assert.ok(report.blockers.some((blocker) => blocker.code === 'incompatible-context-scopes'));
  await assert.rejects(f.addon.commit({ ...input, requestId: 'unsafe', expectedReviewHash: report.reviewHash }), /unresolved blockers/);
  assert.deepEqual(f.calls, []);
});

test('private depth-review explanations constrain the stored scene and review audiences', async () => {
  const f = fixture();
  await f.addon.prepare(f.preparation);
  f.view.nodes.find((node) => node.id === 'depth.review').access_scopes = ['private-review'];
  f.preparation.accessScopes = ['private-review'];
  const input = await reviewedInput(f);
  const report = await f.addon.review(input);
  assert.deepEqual(report.outputScopes, ['private-review']);
  await f.addon.commit({ ...input, requestId: 'private-depth-scene', expectedReviewHash: report.reviewHash });
  for (const node of f.calls[0].narrativeBatch.add_nodes) assert.deepEqual(node.access_scopes, ['private-review']);
  f.view.nodes.find((node) => node.id === 'key').access_scopes = ['different-audience'];
  f.preparation.accessScopes.push('different-audience');
  const blocked = await f.addon.prepare(f.preparation);
  assert.ok(blocked.blockers.some((blocker) => blocker.code === 'incompatible-context-scopes'));
});


test('scene interval validation rejects a reversed end even when context is empty', async () => {
  const f = fixture();
  const preparation = { ...f.preparation, scene: { ...f.preparation.scene, context: [], worldTime: 4, worldTimeEnd: 3 } };
  assert.throws(() => scenePrepareSchema.parse(preparation), /worldTimeEnd must not precede/);
  await assert.rejects(f.addon.prepare(preparation), /worldTimeEnd must not precede/);
  assert.equal(f.calls.length, 0, 'invalid scene intervals cannot mutate the graph');
  assert.equal(scenePrepareSchema.parse({ ...preparation, scene: { ...preparation.scene, worldTimeEnd: 4 } }).scene.worldTimeEnd, 4, 'an instantaneous scene remains valid');
});

test('it is not a strict workflow: a scene can be prepared before any world stage, with the missing stages as questions', async () => {
  const f = fixture();
  f.view.withoutWorld = true;
  const packet = await f.addon.prepare(f.preparation);
  assert.deepEqual(packet.blockers, []);
  assert.ok(packet.world.questions.some((item) => item.kind === 'world-stage-missing' && /in any order/.test(item.question)));
  assert.ok(packet.model.forThisScene.some((item) => item.kind === 'direction-missing'));
});
