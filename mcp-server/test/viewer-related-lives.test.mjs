import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelViewer } from '../src/viewer-server.mjs';

const hash = (n) => n.toString(16).padStart(64, '0');
const book = hash(1), author = hash(2), reader = hash(3), previous = hash(4), bookGraph = hash(101);
function model(id, accessScopes = []) {
  return { schema: 'life-sim-rust-model/v1', id, revision: { number: 0, reason: 'Fixture', provenance: [] },
    time_unit: 'hour', processes: accessScopes.length ? [{ id: 'PRIVATE_PROCESS', access_scopes: accessScopes }] : [],
    meaning_model: { events: [], event_relations: [], referents: [], normalized_cuts: [] } };
}
function declaration(id, authorHash = author, { readerHash = null, at = 1, subject = 'story', scope = [] } = {}) {
  return { id, node_type: 'storytelling.world', role: 'metadata', subject, value_time: at, access_scopes: scope,
    render: 'exclude', training: 'exclude', text: JSON.stringify({ schema: 'meaning-model-story-author-record/v1', kind: 'world',
      data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader',
        author: { lifeModelHash: authorHash, personId: 'person.writer', name: 'Mira Writer', mode: 'invented' },
        reader: readerHash ? { lifeModelHash: readerHash, personId: 'person.reader', name: 'Sam Reader', mode: 'invented' } : null } }) };
}
function graph(id, bound, nodes = [], edges = []) {
  return { schema: 'life-sim-rust-narrative-graph/v1', id, source: { kind: 'model', model_hash: bound },
    revision: { number: 0, reason: 'Fixture', provenance: [] }, roots: ['story'],
    nodes: [{ id: 'story', node_type: 'story', role: 'document_root', text: '# The current story', render: 'include', training: 'exclude', access_scopes: [] }, ...nodes], edges };
}
function setup(t, { nodes = [declaration('world.author_reader')], edges = [], models = new Map(), graphs = new Map() } = {}) {
  const definitions = new Map([[book, model('book')], [author, model('author')], [reader, model('reader')], [previous, model('former-author')], ...models]);
  const graphDefinitions = new Map([[bookGraph, graph('book-graph', book, nodes, edges)], ...graphs]);
  const calls = [];
  const service = {
    async inspectModel(input) { calls.push(['inspect', structuredClone(input)]); const found = definitions.get(input.modelHash); if (!found) throw new Error('Model missing'); return { modelHash: input.modelHash, model: found }; },
    async listNarrativeRevisions({ graphId }) {
      const entry = [...graphDefinitions].find(([, definition]) => definition.id === graphId);
      return { revisions: [{ graph_hash: entry[0], previous_graph_hash: null }], heads: [entry[0]] };
    },
    async queryNarrativeGraph(input) {
      calls.push(['query', structuredClone(input)]);
      const definition = graphDefinitions.get(input.graphHash);
      const visible = (record) => !record.access_scopes?.length || record.access_scopes.some((scope) => input.accessScopes.includes(scope));
      return { graph_hash: input.graphHash, content_included: true,
        graph: { ...definition, node_count: definition.nodes.length, edge_count: definition.edges.length, root_count: definition.roots.length },
        roots: definition.roots, nodes: definition.nodes.filter(visible), edges: definition.edges.filter(visible) };
    },
    async renderNarrativeGraph(input) { calls.push(['render', structuredClone(input)]); return { roots: ['story'], units: [{ node_id: 'story', node_type: 'story', role: 'document_root', text: '# The current story' }] }; },
  };
  const viewer = createModelViewer(service); t.after(() => viewer.close());
  return { viewer, calls, definitions };
}
const choices = (opened) => opened.views ?? [{ modelHash: opened.modelHash, graphHash: opened.graphHash, url: opened.url, selected: true }];

test('opening a book automatically offers its declared author and reader life models using exact stored revisions', async (t) => {
  const { viewer, calls } = setup(t, { nodes: [declaration('world.author_reader', author, { readerHash: reader, scope: ['story-author'] })] });
  const opened = await viewer.open({ graphHash: bookGraph, accessScopes: ['story-author'] });
  assert.deepEqual(choices(opened).map((item) => item.modelHash), [book, author, reader]);
  assert.deepEqual(opened.views.slice(1).map(({ title, graphHash }) => ({ title, graphHash })), [
    { title: 'Author life · Mira Writer', graphHash: null }, { title: 'Reader life · Sam Reader', graphHash: null },
  ]);
  assert.ok(calls.filter(([kind]) => kind === 'query' || kind === 'render').every(([, input]) => input.accessScopes.join() === 'story-author'));
  for (const view of opened.views) {
    const data = await (await fetch(new URL('data/model.json', view.url))).json();
    assert.equal(data.modelHash, view.modelHash);
    assert.equal(data.inspection.model.id, view.modelHash === book ? 'book' : view.modelHash === author ? 'author' : 'reader');
  }
  assert.deepEqual(await (await fetch(new URL('data/views.json', opened.url))).json(), opened.views);
});

test('discovery uses only the current unsuperseded typed author_reader stage, not arbitrary JSON or earlier lives', async (t) => {
  const nodes = [declaration('old', previous, { at: 5 }), declaration('older-unreplaced', reader, { at: 1 }), declaration('current', author, { at: 2 })];
  const forged = declaration('a-note-with-json', reader, { at: 100 }); forged.node_type = 'understanding.idea'; nodes.push(forged);
  const notAnAuthorRecord = declaration('wrong-envelope', reader, { at: 200 }); notAnAuthorRecord.text = JSON.stringify({ data: JSON.parse(notAnAuthorRecord.text).data }); nodes.push(notAnAuthorRecord);
  const edges = [{ id: 'current.supersedes.old', family: 'semantic', relation: 'supersedes', source: { kind: 'node', node_id: 'current' }, target: { kind: 'node', node_id: 'old' }, access_scopes: [] }];
  const { viewer } = setup(t, { nodes, edges });
  const opened = await viewer.open({ graphHash: bookGraph });
  assert.deepEqual(choices(opened).map((item) => item.modelHash), [book, author]);
});

test('richer explicit life graphs and additional books are retained while automatic same-revision choices are deduplicated', async (t) => {
  const authorGraph = hash(102), secondGraph = hash(103), secondBook = hash(5);
  const { viewer } = setup(t, { nodes: [declaration('current', author, { readerHash: author })],
    models: new Map([[secondBook, model('second-book')]]),
    graphs: new Map([[authorGraph, graph('author-life-graph', author)], [secondGraph, graph('second-book-graph', secondBook, [declaration('second-author', author)])]]) });
  const opened = await viewer.open({ graphHash: bookGraph, additionalModels: [
    { graphHash: authorGraph, title: 'The author’s life and notes' }, { graphHash: secondGraph, title: 'Second book' }, { graphHash: authorGraph, title: 'Duplicate exact revision' },
  ] });
  assert.deepEqual(opened.views.map(({ modelHash, graphHash }) => [modelHash, graphHash]), [[book, bookGraph], [author, authorGraph], [secondBook, secondGraph]]);
  assert.equal(opened.views[1].title, 'The author’s life and notes');
});

test('an author living in the selected model adds no duplicate, and model-only opens do not scan unrelated graphs', async (t) => {
  const { viewer, calls } = setup(t, { nodes: [declaration('same-world', book)] });
  const opened = await viewer.open({ graphHash: bookGraph });
  assert.equal(choices(opened).length, 1);
  calls.length = 0;
  const onlyModel = await viewer.open({ modelHash: book });
  assert.equal(choices(onlyModel).length, 1);
  assert.deepEqual(calls.map(([kind]) => kind), ['inspect']);
});

test('automatic lives never widen the graph scope grant or bypass complete-view guards', async (t) => {
  const { viewer } = setup(t, { nodes: [declaration('world.author_reader', author, { scope: ['story-author'] })],
    models: new Map([[author, model('SECRET_AUTHOR_MODEL', ['life-private'])]]) });
  await assert.rejects(viewer.open({ graphHash: bookGraph }), /every node|hide some/);
  await assert.rejects(viewer.open({ graphHash: bookGraph, accessScopes: ['story-author'] }), (error) => {
    assert.match(error.message, /scope/i); assert.doesNotMatch(error.message, /SECRET_AUTHOR_MODEL|PRIVATE_PROCESS/); return true;
  });
  const opened = await viewer.open({ graphHash: bookGraph, accessScopes: ['story-author', 'life-private'] });
  assert.deepEqual(opened.views.map((view) => view.modelHash), [book, author]);
});

test('a missing declared life refuses the incomplete viewer with the existing restore/import guidance', async (t) => {
  const { viewer } = setup(t, { nodes: [declaration('world.author_reader', hash(500))] });
  await assert.rejects(viewer.open({ graphHash: bookGraph }), /Import or restore that declared model/);
});

test('the group limit includes automatic lives and refuses overflow instead of dropping explicit books', async (t) => {
  const models = new Map(), additionalModels = [];
  for (let i = 10; i < 25; i++) { models.set(hash(i), model(`extra-${i}`)); additionalModels.push({ modelHash: hash(i) }); }
  const { viewer } = setup(t, { models });
  await assert.rejects(viewer.open({ graphHash: bookGraph, additionalModels }), /exceed 16 viewer choices.*fewer additionalModels/);
});
