import assert from 'node:assert/strict';
import test from 'node:test';
import { StorytellingAddon } from '../src/storytelling-addon.mjs';
import { lifeTrendsSchema, verifyLifeTrajectoryRecords } from '../src/storytelling-life-trends.mjs';
import { prepareTrajectoryExplore } from '../src/storytelling-trajectories.mjs';
import { refreshDepthFixture, lifeConnections, lifeTrendsDossier, lifeTrendsEdges, lifeTrendsNode } from './storytelling-life-fixture.mjs';

const graphHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);

test('life dossiers bind numerical meanings and lifetime coverage to the stored graph proposal', () => {
  const dossier = lifeTrendsDossier();
  const task = prepareTrajectoryExplore({ definition: {
    targetKind: 'life', subjectId: 'Leo', timeUnit: 'years_since_birth', brief: 'Synthetic lifetime proposal for graph binding.',
    axes: [{ id: 'means', meaning: 'Available household material capacity.', comparisonQuestion: 'How much capacity is available?',
      unit: 'declared_test_units', minimum: 0, maximum: 100 }],
  }, points: [0, 20, 40].map((at) => ({ id: `age.${at}`, at, label: `Age ${at}`, values: { means: 40 } })), seed: 'binding-check' });
  dossier.characters[0].trajectoryProposal = { definition: task.definition, candidate: task.candidates[0] };
  dossier.characters[0].trajectoryRecordNodeId = 'numeric.record';
  const node = { id: 'numeric.record', node_type: 'storytelling.candidate', subject: 'book', text: JSON.stringify({ data: task }) };
  assert.deepEqual(lifeTrendsSchema.parse(dossier), dossier);
  verifyLifeTrajectoryRecords({ nodes: [node] }, dossier);
  const changed = structuredClone(task);
  changed.definition.axes[0].meaning = 'A different category improperly retaining the old candidate hash.';
  node.text = JSON.stringify({ data: changed });
  assert.throws(() => verifyLifeTrajectoryRecords({ nodes: [node] }, dossier), /Candidate hash changed/);
  for (const alter of [
    (c) => { delete c.trajectoryRecordNodeId; },
    (c) => { c.lifeTimeUnit = 'days'; },
    (c) => { c.characterId = 'a-different-person'; },
    (c) => { c.storyEntry = 41; c.phases.at(-1).at = 41; },
  ]) {
    const invalid = structuredClone(dossier);
    alter(invalid.characters[0]);
    assert.throws(() => lifeTrendsSchema.parse(invalid));
  }
});

function fixture() {
  const dossier = lifeTrendsDossier();
  const calls = [];
  const view = {
    graph_hash: graphHash, source_snapshot_hash: snapshotHash, content_included: true,
    graph: { revision: { number: 0 }, source_snapshot: { source_kind: 'world', source_hash: 'c'.repeat(64), time: 10 } },
    roots: ['book', 'other-book'],
    nodes: [
      { id: 'book', role: 'document_root', access_scopes: [] },
      { id: 'chapter', role: 'document_root', access_scopes: [] },
      { id: 'other-book', role: 'document_root', access_scopes: [] },
      lifeTrendsNode(dossier),
    ],
    edges: [...lifeTrendsEdges(), {
      id: 'book-chapter', source: { kind: 'node', node_id: 'book' },
      target: { kind: 'node', node_id: 'chapter' }, family: 'structural', relation: 'contains', order: 0,
    }],
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
  };
  const preparation = {
    graphHash, lifeTrendsNodeId: 'life.trends', modelDepthReviewNodeId: 'depth.review', accessScopes: [],
    scene: {
      id: 'scene.quiet', parentNodeId: 'chapter', order: 0, worldTime: 4,
      readerOrder: 0, viewpoint: 'Leo', brief: 'A quiet act of practiced care.',
      context: [], requirements: [], characterConnections: lifeConnections(),
    },
  };
  const setDossier = (next) => { view.nodes.find(({ id }) => id === 'life.trends').text = JSON.stringify(next); };
  return { dossier, view, calls, preparation, setDossier, addon: new StorytellingAddon(service) };
}

async function reviewInput(f) {
  f.view.nodes.push({ id: 'draft', node_type: 'storytelling.draft', subject: 'book', render: 'exclude', access_scopes: [], text: JSON.stringify({ text: 'Leo checked the latch once more.' }) });
  const packet = await f.addon.prepare(f.preparation);
  return {
    preparation: f.preparation, expectedPacketHash: packet.packetHash, draftNodeId: 'draft',
    text: 'Leo checked the latch once more.', reviewer: 'author', uses: [],
    findings: packet.checks.map(({ id }) => ({
      checkId: id, status: 'satisfied',
      explanation: 'Practiced checking continues the agency trend; belonging stays implicit and no future is disclosed.',
      citations: [],
    })),
  };
}

test('life dossier requires a chronological whole-life trajectory rather than a story-entry snapshot', () => {
  const valid = lifeTrendsDossier();
  assert.deepEqual(lifeTrendsSchema.parse(valid), valid);
  const mutations = [
    (d) => { d.characters[0].phases = d.characters[0].phases.slice(-1); },
    (d) => { d.characters[0].phases[0].at = 1; },
    (d) => { d.characters[0].phases[1].at = 40; },
    (d) => { d.characters[0].phases[2].at = 39; },
    (d) => { d.characters[0].phases[1].id = 'origins'; },
    (d) => { d.characters[0].trends = d.characters[0].trends.slice(0, 1); },
    (d) => { d.characters.push(structuredClone(d.characters[0])); },
    (d) => { d.storyInterval.end = -1; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => lifeTrendsSchema.parse(invalid));
  }
  const empty = structuredClone(valid);
  empty.characters[0].phases = [];
  assert.throws(() => lifeTrendsSchema.parse(empty), (error) => error.name === 'ZodError',
    'an empty phase list is a typed validation error, not an internal runtime exception');
});

test('every life dimension needs every phase state and each adjacent causal development', () => {
  const mutations = [
    (t) => { t.states.pop(); },
    (t) => { t.states[1].phaseId = 'origins'; },
    (t) => { t.states[1].phaseId = 'unknown'; },
    (t) => { t.developments.pop(); },
    (t) => { t.developments[0].toPhaseId = 'entry'; },
    (t) => { t.developments[1] = structuredClone(t.developments[0]); },
    (t) => { t.developments[0].explanation = ' '; },
  ];
  for (const mutate of mutations) {
    const invalid = lifeTrendsDossier();
    mutate(invalid.characters[0].trends[0]);
    assert.throws(() => lifeTrendsSchema.parse(invalid));
  }
  const stable = lifeTrendsDossier();
  stable.characters[0].trends[1].states.forEach((state) => { state.state = 'A steady need for company.'; });
  stable.characters[0].future = { status: 'planned', outlook: 'A possible later reunion; this is an author plan, not character knowledge.' };
  assert.deepEqual(lifeTrendsSchema.parse(stable), stable,
    'stable trends and explicitly planned futures are valid without mandatory growth or a death endpoint');
});

test('the life-trend write is one nonrendered graph batch with stable character grounding', async () => {
  const f = fixture();
  f.view.nodes[0].access_scopes = ['author', 'editor'];
  const result = await f.addon.storeLifeTrends({
    graphHash, requestId: 'store-lives', nodeId: 'new-life-trends',
    accessScopes: ['author', 'editor', 'unrelated'], dossier: f.dossier,
  });
  assert.equal(result.worldMutation, false);
  assert.equal(result.graphHash, 'd'.repeat(64));
  assert.equal(f.calls.length, 1);
  const batch = f.calls[0].narrativeBatch;
  assert.equal(batch.previous_graph_hash, graphHash);
  assert.equal(batch.add_nodes.length, 1);
  assert.equal(batch.add_nodes[0].node_type, 'storytelling.life_trends');
  assert.equal(batch.add_nodes[0].render, 'exclude');
  assert.equal(batch.add_nodes[0].training, 'exclude');
  assert.deepEqual(batch.add_nodes[0].access_scopes, ['author', 'editor']);
  assert.deepEqual(JSON.parse(batch.add_nodes[0].text), f.dossier);
  assert.ok(batch.add_edges.some((edge) => edge.relation === 'life_trends'
    && edge.source.node_id === 'book' && edge.target.node_id === 'new-life-trends'));
  assert.ok(batch.add_edges.some((edge) => edge.relation === 'models_life_of'
    && edge.target.kind === 'anchor' && edge.target.anchor_kind === 'referent' && edge.target.anchor_id === 'Leo'));
  assert.ok(batch.add_edges.every((edge) => edge.access_scopes.join() === 'author,editor'));
});

test('missing, inaccessible, malformed, and aggregate-as-context life models cannot prepare scenes', async () => {
  const absent = fixture();
  delete absent.preparation.lifeTrendsNodeId;
  await assert.rejects(absent.addon.prepare(absent.preparation));
  const hidden = fixture();
  hidden.view.nodes.pop();
  await assert.rejects(hidden.addon.prepare(hidden.preparation), /inaccessible|unknown|life.trends/iu);
  const snapshot = fixture();
  snapshot.dossier.characters[0].phases = snapshot.dossier.characters[0].phases.slice(-1);
  snapshot.setDossier(snapshot.dossier);
  await assert.rejects(snapshot.addon.prepare(snapshot.preparation));
  const asContext = fixture();
  asContext.preparation.scene.context.push({ nodeId: 'life.trends', viewpointKnownAt: 0, readerKnownAt: 0 });
  await assert.rejects(asContext.addon.prepare(asContext.preparation), /author|context|aggregate|life.trend/iu);
  assert.deepEqual([absent.calls, hidden.calls, snapshot.calls, asContext.calls], [[], [], [], []]);
});

test('life modeling binds the correct story hierarchy and scene horizon', async () => {
  const unrelated = fixture();
  unrelated.preparation.scene.parentNodeId = 'other-book';
  await assert.rejects(unrelated.addon.prepare(unrelated.preparation), /root|story|ancestor/iu);
  for (const worldTime of [-1, 11]) {
    const outside = fixture();
    outside.preparation.scene.worldTime = worldTime;
    await assert.rejects(outside.addon.prepare(outside.preparation), /interval|horizon|time/iu);
  }
  const brokenHierarchy = fixture();
  brokenHierarchy.view.edges = [];
  await assert.rejects(brokenHierarchy.addon.prepare(brokenHierarchy.preparation), /root|story|ancestor/iu);
  const ungroundedCharacter = fixture();
  ungroundedCharacter.view.edges = ungroundedCharacter.view.edges.filter((edge) => edge.relation !== 'models_life_of');
  await assert.rejects(ungroundedCharacter.addon.prepare(ungroundedCharacter.preparation), /referent|anchor/iu);
});

test('scene connections cannot omit a principal viewpoint or reference invented characters and trends', async () => {
  const mutations = [
    (p) => { p.scene.characterConnections = []; },
    (p) => { p.scene.characterConnections[0].characterId = 'unknown'; },
    (p) => { p.scene.characterConnections[0].trendIds = ['unknown']; },
    (p) => { p.scene.characterConnections.push(structuredClone(p.scene.characterConnections[0])); },
    (p) => { p.scene.characterConnections[0].trendIds = ['agency', 'agency']; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.preparation);
    await assert.rejects(f.addon.prepare(f.preparation));
    assert.deepEqual(f.calls, []);
  }
  const nonCharacter = fixture();
  nonCharacter.preparation.scene.viewpoint = 'external-narrator';
  nonCharacter.preparation.scene.characterConnections = [];
  const packet = await nonCharacter.addon.prepare(nonCharacter.preparation);
  assert.ok(packet.checks.some(({ id }) => id === 'life:coverage'),
    'a narrator-only scene still requires LLM verification of whether principal actors were omitted');
});

test('life trends are author context and require semantic review without exposing their future as knowledge', async () => {
  const f = fixture();
  f.dossier.characters[0].future = { status: 'planned', outlook: 'A later reunion in the city.' };
  f.setDossier(f.dossier);
  const packet = await f.addon.prepare(f.preparation);
  assert.deepEqual(packet.authorLifeTrends.dossier, f.dossier);
  assert.deepEqual(packet.authorLifeTrends.characterConnections, lifeConnections());
  assert.deepEqual(packet.viewpointContext, []);
  assert.deepEqual(packet.readerBefore, []);
  assert.deepEqual(packet.readerReveals, []);
  assert.deepEqual(packet.authorContext, []);
  assert.equal(packet.boundaries.semanticLifeTrendsVerification, false,
    'structural completeness does not imply automatic semantic correctness');
  assert.ok(packet.checks.some(({ id }) => id === 'life:knowledge'));
  assert.ok(packet.checks.some(({ id }) => id === 'life:continuity:Leo'));
  const input = await reviewInput(f);
  assert.equal((await f.addon.review(input)).readyToCommit, true,
    'life trends can remain implicit rather than requiring a biography paragraph in each scene');
  for (const checkId of ['life:coverage', 'life:knowledge', 'life:continuity:Leo']) {
    const report = await f.addon.review({ ...input, findings: input.findings.map((finding) => ({
      ...finding, status: finding.checkId === checkId ? 'unknown' : 'satisfied',
    })) });
    assert.equal(report.readyToCommit, false);
    await assert.rejects(f.addon.commit({ ...input,
      findings: report.findings, requestId: 'unresolved-life', expectedReviewHash: report.reviewHash,
    }), /unresolved blockers/iu);
  }
  await assert.rejects(f.addon.review({ ...input, findings: input.findings.filter(({ checkId }) => checkId !== 'life:coverage') }), /every packet check/iu);
  await assert.rejects(f.addon.review({ ...input,
    uses: [{ nodeId: 'life.trends', audience: 'viewpoint', start: 0, end: input.text.length, quote: input.text }],
  }), /context|selected/iu);
});

test('changing a life trajectory invalidates a previously reviewed scene packet', async () => {
  const f = fixture();
  const input = await reviewInput(f);
  f.dossier.characters[0].trends[0].states[2].state = 'Now deliberately avoids checking uncertain information.';
  f.setDossier(f.dossier);
  await assert.rejects(f.addon.review(input), /packet hash changed/iu);
  assert.deepEqual(f.calls, []);
});

test('life-dossier audiences constrain scene output and disjoint audiences block committing', async () => {
  const f = fixture();
  f.preparation.accessScopes = ['editor', 'life-private', 'book-private'];
  f.view.nodes[1].access_scopes = ['editor', 'book-private'];
  f.view.nodes[3].access_scopes = ['editor', 'life-private'];
  const packet = await f.addon.prepare(f.preparation);
  assert.deepEqual(packet.outputScopes, ['editor']);
  f.view.nodes[3].access_scopes = ['life-private'];
  const input = await reviewInput(f);
  const report = await f.addon.review(input);
  assert.equal(report.readyToCommit, false);
  assert.ok(report.blockers.some(({ code }) => code === 'incompatible-context-scopes'));
  await assert.rejects(f.addon.commit({ ...input, requestId: 'unsafe', expectedReviewHash: report.reviewHash }), /unresolved blockers/iu);
  assert.deepEqual(f.calls, []);
});
