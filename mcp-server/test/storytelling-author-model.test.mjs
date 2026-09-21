import assert from 'node:assert/strict';
import test from 'node:test';
import { authorModelSchema, readAuthorModel } from '../src/storytelling-author-model.mjs';
import { storeAuthorRecord } from '../src/storytelling-authoring.mjs';
import { fictionalAuthorModel, realAuthorModel } from './storytelling-author-model-fixture.mjs';

const graphHash = 'a'.repeat(64);
const nextHash = 'd'.repeat(64);

function fixture() {
  const view = {
    graph_hash: graphHash, source_snapshot_hash: 'b'.repeat(64), content_included: true,
    graph: { revision: { number: 0 }, source_snapshot: { source_kind: 'model', source_hash: 'c'.repeat(64) } },
    roots: ['book'], edges: [],
    nodes: [{ id: 'book', role: 'document_root', access_scopes: ['editor', 'book-only'] }, {
      id: 'source.sample', role: 'story_passage', node_type: 'sample',
      text: 'She left one cup on the sill. Outside, the train was late.',
      access_scopes: ['editor', 'sample-only'],
    }],
  };
  const writes = [];
  const reads = [];
  const service = {
    async queryNarrativeGraph(input) {
      reads.push(structuredClone(input));
      assert.equal(input.graphHash, graphHash);
      assert.equal(input.expectedGraphHash, graphHash);
      const visible = structuredClone(view);
      visible.nodes = visible.nodes.filter((node) => !node.access_scopes?.length
        || node.access_scopes.some((scope) => input.accessScopes.includes(scope)));
      return visible;
    },
    async applyNarrativeBatch(input) {
      writes.push(structuredClone(input));
      return { graphHash: nextHash, previousGraphHash: graphHash, immutableRevision: true };
    },
  };
  const record = {
    graphHash, requestId: 'save-author-model', nodeId: 'author.model', storyRootId: 'book',
    authorId: 'recording-agent', accessScopes: ['editor', 'book-only', 'sample-only', 'irrelevant'],
    kind: 'author_model', text: 'A limited writing model, distinguishing statements, supplied samples, and interpretations.',
    data: realAuthorModel(),
  };
  const storedView = () => {
    const batch = writes.at(-1).narrativeBatch;
    return { ...structuredClone(view), graph_hash: nextHash,
      graph: { ...structuredClone(view.graph), revision: { number: 1 } },
      roots: [...view.roots, ...batch.add_roots],
      nodes: [...structuredClone(view.nodes), ...structuredClone(batch.add_nodes)],
      edges: [...structuredClone(view.edges), ...structuredClone(batch.add_edges)] };
  };
  return { view, record, service, writes, reads, storedView };
}

test('real authors require noninvented labeled evidence while fictional authors may be deliberately invented', () => {
  const real = realAuthorModel();
  const fictional = fictionalAuthorModel();
  assert.equal(authorModelSchema.parse(real).mode, 'real_author');
  assert.equal(authorModelSchema.parse(fictional).mode, 'fictional_author');
  const inventedReal = { ...fictional, mode: 'real_author' };
  assert.throws(() => authorModelSchema.parse(inventedReal), /invented|real.author/iu);
  for (const field of ['sourceNodeId', 'excerpt']) {
    const malformed = realAuthorModel();
    delete malformed.basis.find(({ kind }) => kind === 'writing_sample')[field];
    assert.throws(() => authorModelSchema.parse(malformed), /sample|source|excerpt/iu);
  }
});

test('dispositions must cite unique known evidence and any numerical comparison must have meaningful bounds', () => {
  const mutations = [
    (model) => { model.basis.push(structuredClone(model.basis[0])); },
    (model) => { model.dispositions[0].basisIds = ['missing']; },
    (model) => { model.dispositions[0].basisIds = []; },
    (model) => { model.dispositions.push(structuredClone(model.dispositions[0])); },
    (model) => { model.dispositions[0].dimensionIds = ['missing']; },
  ];
  for (const mutate of mutations) {
    const invalid = realAuthorModel();
    mutate(invalid);
    assert.throws(() => authorModelSchema.parse(invalid));
  }
  const measured = fictionalAuthorModel();
  measured.dimensions = [{
    id: 'explicitness', meaning: 'How directly this authored style states emotional interpretations.',
    comparisonQuestion: 'How explicitly does this passage explain a character’s emotional response?',
    unit: 'declared ordinal editorial scale', minimum: 0, maximum: 4, value: 1,
  }];
  measured.dispositions[0].dimensionIds = ['explicitness'];
  assert.deepEqual(authorModelSchema.parse(measured).dimensions, measured.dimensions);
  for (const change of [{ value: 5 }, { minimum: 5 }, { maximum: -1 }, { unit: ' ' }]) {
    const invalid = structuredClone(measured);
    Object.assign(invalid.dimensions[0], change);
    assert.throws(() => authorModelSchema.parse(invalid));
  }
});

test('storing a real author model preserves evidence, recorder identity, source scopes, and export exclusion', async () => {
  const f = fixture();
  const before = structuredClone(f.view);
  const receipt = await storeAuthorRecord(f.service, f.record);
  assert.equal(receipt.worldMutation, false);
  assert.equal(receipt.semanticVerification, false);
  assert.equal(f.writes.length, 1);
  const batch = f.writes[0].narrativeBatch;
  const node = batch.add_nodes.find(({ id }) => id === 'author.model');
  assert.equal(node.node_type, 'storytelling.author_model');
  assert.equal(node.holder, 'recording-agent');
  assert.equal(node.subject, 'book');
  assert.equal(node.render, 'exclude');
  assert.equal(node.training, 'exclude');
  assert.deepEqual(node.access_scopes, ['editor']);
  const payload = JSON.parse(node.text);
  assert.equal(payload.kind, 'author_model');
  assert.equal(payload.data.modeledAuthorId, 'writer.alex');
  assert.deepEqual(payload.data.basis, f.record.data.basis);
  assert.ok(batch.add_edges.some((edge) => edge.source.node_id === 'author.model'
    && edge.target.node_id === 'source.sample'), 'the persisted author record retains its evidence provenance');
  assert.ok(batch.add_edges.every((edge) => edge.access_scopes.join() === 'editor'));
  const read = readAuthorModel(f.storedView(), { nodeId: 'author.model', storyRootId: 'book' });
  assert.equal(read.nodeId, 'author.model');
  assert.deepEqual(read.model, authorModelSchema.parse(f.record.data));
  assert.deepEqual(f.view, before, 'recording a style model does not change its source graph or author identity');
});

test('unavailable and mismatched writing samples are rejected before an author model is stored', async () => {
  const hidden = fixture();
  hidden.record.accessScopes = ['book-only'];
  await assert.rejects(storeAuthorRecord(hidden.service, hidden.record), /unknown|inaccessible|source/iu);
  assert.equal(hidden.writes.length, 0);
  const wrongExcerpt = fixture();
  wrongExcerpt.record.data.basis.find(({ kind }) => kind === 'writing_sample').excerpt = 'A sentence absent from the source.';
  await assert.rejects(storeAuthorRecord(wrongExcerpt.service, wrongExcerpt.record), /excerpt|source|sample/iu);
  assert.equal(wrongExcerpt.writes.length, 0);
  const disjoint = fixture();
  disjoint.view.nodes[0].access_scopes = ['book-only'];
  disjoint.view.nodes[1].access_scopes = ['sample-only'];
  await assert.rejects(storeAuthorRecord(disjoint.service, disjoint.record), /scope|audience/iu);
  assert.equal(disjoint.writes.length, 0);
});

test('author-model records reject untyped profile data instead of persisting a plausible-looking label', async () => {
  for (const data of [undefined, { label: 'A reflective author' }, { ...fictionalAuthorModel(), mode: 'real_author' }]) {
    const f = fixture();
    f.record.data = data;
    await assert.rejects(storeAuthorRecord(f.service, f.record));
    assert.equal(f.writes.length, 0);
  }
});

test('reading an author model binds a visible scoped author record to the correct story and valid stored evidence', async () => {
  const f = fixture();
  await storeAuthorRecord(f.service, f.record);
  const original = f.storedView();
  const valid = readAuthorModel(original, { nodeId: 'author.model', storyRootId: 'book' });
  assert.deepEqual(valid.model, authorModelSchema.parse(f.record.data));
  assert.throws(() => readAuthorModel(original, { nodeId: 'author.model', storyRootId: 'other-book' }), /story|root/iu);
  const mutations = [
    (view) => { view.nodes = view.nodes.filter(({ id }) => id !== 'author.model'); },
    (view) => { view.content_included = false; },
    (view) => { view.nodes.find(({ id }) => id === 'author.model').render = 'include'; },
    (view) => { view.nodes.find(({ id }) => id === 'author.model').training = 'include'; },
    (view) => { view.nodes.find(({ id }) => id === 'author.model').access_scopes = []; },
    (view) => { view.nodes.find(({ id }) => id === 'author.model').access_scopes = ['editor', 'unrelated']; },
    (view) => { view.nodes.find(({ id }) => id === 'author.model').text = 'invalid json'; },
    (view) => {
      const node = view.nodes.find(({ id }) => id === 'author.model');
      const payload = JSON.parse(node.text);
      payload.kind = 'context';
      node.text = JSON.stringify(payload);
    },
    (view) => { view.nodes = view.nodes.filter(({ id }) => id !== 'source.sample'); },
    (view) => { view.edges = []; },
    (view) => { view.nodes.find(({ node_type }) => node_type === 'understanding_process_root').subject = 'other-book'; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(original);
    mutate(invalid);
    assert.throws(() => readAuthorModel(invalid, { nodeId: 'author.model', storyRootId: 'book' }));
  }
});
