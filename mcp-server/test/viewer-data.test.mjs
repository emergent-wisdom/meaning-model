import assert from 'node:assert/strict';
import test from 'node:test';
import { buildViewerData } from '../src/viewer-data.mjs';

const MODEL = 'a'.repeat(64);
const OTHER_MODEL = 'b'.repeat(64);
const GRAPH = 'c'.repeat(64);
const NEXT_GRAPH = 'd'.repeat(64);
const generatedAt = '2026-09-26T12:00:00.000Z';

function model(timeUnit = 'second') {
  return {
    schema: 'life-sim-rust-model/v1', id: 'reactor', time_unit: timeUnit,
    processes: [{ id: 'temperature', unit: 'degC', initial_value: { value: -5 }, support: ['-5 in 2000; 5 in 2002'] }],
    meaning_model: {
      events: [{ id: 'heat', boundary: 'Heating', interval: { start: 0, end: 2 }, process_ids: ['temperature'] }],
      concepts: [{ id: 'heat-concept', boundary: 'Heat' }],
    },
  };
}

function history(definition = model()) {
  return { models: [{ modelHash: MODEL, definition }], revisions: [] };
}

function graphRevision(modelHash = MODEL) {
  return { graphHash: GRAPH, definition: { id: 'story', source: { kind: 'model', model_hash: modelHash }, nodes: [], edges: [] } };
}

function render() {
  return { projection_hash: 'e'.repeat(64), units: [{ node_id: 'passage', role: 'story_passage', text: 'The reactor warmed.' }] };
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

test('the snapshot uses the exact graph-bound model, even when a newer unrelated model is present', async () => {
  const boundModel = model('year');
  boundModel.meaning_model.events[0].interval = { start: 2000, end: 2002 };
  const source = history(boundModel);
  source.models.push({ modelHash: OTHER_MODEL, definition: model('second') });
  source.revisions.push(graphRevision());
  source.headGraphHash = GRAPH;

  const data = await buildViewerData({ history: source, rendered: render(), generatedAt });

  assert.equal(data.modelHash, MODEL);
  assert.equal(data.headGraphHash, GRAPH);
  assert.equal(data.timeUnit, 'year');
  assert.equal(data.events[0].start, 2000);
  assert.equal(data.viewKind, 'timeline');
  assert.deepEqual(data.inspection.model, boundModel);
  assert.deepEqual(data.measures[0].points.map(({ v }) => v), [-5, 5]);
  assert.equal(data.constructionTiming, 'unavailable');
  assert.deepEqual(data.steps, []);
});

test('a graph delta can rebind the snapshot to another complete model', async () => {
  const source = history(model('second'));
  source.models.push({ modelHash: OTHER_MODEL, definition: model('year') });
  source.revisions.push(graphRevision(OTHER_MODEL), {
    graphHash: NEXT_GRAPH, delta: { source: { kind: 'model', model_hash: MODEL }, upsertNodes: [], upsertEdges: [] },
  });
  source.headGraphHash = NEXT_GRAPH;

  const data = await buildViewerData({ history: source, rendered: render(), generatedAt });

  assert.equal(data.modelHash, MODEL);
  assert.equal(data.headGraphHash, NEXT_GRAPH);
  assert.equal(data.timeUnit, 'second');
  assert.equal(data.viewKind, 'inspector');
  assert.deepEqual(data.inspection.model, source.models[0].definition);
});

test('calendar units can use the timeline; arbitrary clocks keep their own units and values', async (t) => {
  for (const timeUnit of ['year', 'years', 'civil_day_since_1970', 'second', 'hour', 'machine_cycle']) {
    await t.test(timeUnit, async () => {
      const definition = model(timeUnit);
      if (timeUnit === 'civil_day_since_1970') definition.meaning_model.events[0].interval = { start: 0, end: 365.2425 };
      else if (timeUnit === 'year' || timeUnit === 'years') definition.meaning_model.events[0].interval = { start: 2000, end: 2002 };
      const calendar = ['year', 'years', 'civil_day_since_1970'].includes(timeUnit);
      const data = await buildViewerData({ history: history(definition), rendered: render(), generatedAt });

      assert.equal(data.timeUnit, timeUnit);
      assert.equal(data.viewKind, calendar ? 'timeline' : 'inspector');
      assert.deepEqual(data.inspection.model, definition);
      if (timeUnit === 'civil_day_since_1970') {
        assert.equal(data.events[0].start, 1970);
        assert.equal(data.events[0].end, 1971);
      } else {
        assert.equal(data.events[0].start, definition.meaning_model.events[0].interval.start);
        assert.equal(data.events[0].end, definition.meaning_model.events[0].interval.end);
      }
      if (calendar) assert.deepEqual(data.measures[0].points.map(({ v }) => v), [-5, 5]);
      else {
        assert.deepEqual(data.measures[0].points, []);
        assert.deepEqual(data.processes[0].points, []);
      }
    });
  }
});

test('a timeless concept model is inspectable without invented clocks, stories, or measures', async () => {
  const definition = {
    id: 'concept-only',
    meaning_model: {
      concepts: [{ id: 'state', boundary: 'A state' }],
      abstract_cuts: [{ id: 'opening', parent_concept_id: 'state', child_concept_ids: [] }],
    },
  };
  const data = await buildViewerData({ history: history(definition), generatedAt });

  assert.equal(data.viewKind, 'inspector');
  assert.equal(data.timeUnit, '');
  assert.equal(data.story, null);
  assert.equal(data.extent, null);
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.measures, []);
  assert.deepEqual(data.inspection.model, definition);
});

test('a calendar story without a usable numeric path falls back to the inspector', async () => {
  const definition = model('year');
  definition.processes[0].support = ['The reactor warmed gradually.'];
  const data = await buildViewerData({ history: history(definition), rendered: render(), generatedAt });

  assert.equal(data.viewKind, 'inspector');
  assert.equal(data.story.units[0].text, 'The reactor warmed.');
  assert.deepEqual(data.measures[0].points, []);
  assert.deepEqual(data.inspection.model.processes[0].initial_value, { value: -5 });
});

test('complete records survive graph replay and the transform does not mutate its inputs', async () => {
  const source = history();
  source.graphId = 'story';
  const prose = 'A complete source passage. '.repeat(100);
  const root = { id: 'root', node_type: 'document', role: 'document_root', text: '# Reactor' };
  const passage = { id: 'passage', node_type: 'story_passage', role: 'story_passage', text: prose, metadata: { source: 'authored' } };
  const contains = { id: 'chapter', source: { kind: 'node', node_id: 'root' }, target: { kind: 'node', node_id: 'passage' }, family: 'structure', relation: 'contains' };
  const anchor = { id: 'depicts', source: { kind: 'node', node_id: 'passage' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'heat' }, family: 'grounding', relation: 'renders' };
  source.revisions.push({ graphHash: GRAPH, definition: {
    id: 'story', source: { kind: 'model', model_hash: MODEL },
    nodes: [root, { id: 'discarded', node_type: 'note', text: 'Removed later.' }], edges: [],
  } }, { graphHash: NEXT_GRAPH, delta: { removeNodeIds: ['discarded'], upsertNodes: [passage], upsertEdges: [anchor, contains] } });
  const rendered = { units: [{ node_id: 'passage', role: 'story_passage', text: prose }] };
  const before = structuredClone({ history: source, rendered });
  freezeDeep(source);
  freezeDeep(rendered);

  const data = await buildViewerData({ history: source, rendered, generatedAt });

  assert.deepEqual({ history: source, rendered }, before);
  assert.deepEqual(data.inspection.model, before.history.models[0].definition);
  assert.deepEqual(data.inspection.graph, { id: 'story', nodes: [root, passage], edges: [anchor, contains] });
  assert.deepEqual(data.graph.nodes.map(({ id, category }) => ({ id, category })), [{ id: 'root', category: 'root' }, { id: 'passage', category: 'passage' }]);
  assert.ok(data.graph.edges.some((edge) => edge.source === 'root' && edge.target.node === 'passage' && edge.relation === 'contains'), 'the scene retains the document and its passage links');
  assert.equal(data.story.units[0].text, prose);
  assert.ok(data.graph.nodes.find((node) => node.id === 'passage').text.length < prose.length, 'the inspector retains text that the scene summary clips');
  data.inspection.model.processes[0].initial_value.value = 99;
  data.inspection.graph.nodes[1].metadata.source = 'changed in output';
  assert.deepEqual({ history: source, rendered }, before, 'inspection records are independent copies');
});

test('missing complete models and missing graph-bound definitions are rejected', async () => {
  for (const source of [undefined, { models: [], revisions: [] }, { models: [{ modelHash: MODEL }], revisions: [] }, { models: [{ modelHash: MODEL, definition: null }], revisions: [] }, { models: [{ modelHash: MODEL, definition: model() }] }]) {
    await assert.rejects(buildViewerData({ history: source, generatedAt }), /complete model definition/);
  }
  const source = history();
  source.revisions.push(graphRevision(OTHER_MODEL));
  await assert.rejects(buildViewerData({ history: source, generatedAt }), /missing the graph-bound model definition/);
});


test('rendered prose totals use the same heading-free count as individual passages', async () => {
  const source = history(model('year'));
  source.revisions.push(graphRevision()); source.headGraphHash = GRAPH;
  const rendered = { units: [{ node_id: 'title', role: 'document_root', text: '# Test Story' },
    { node_id: 'one', role: 'story_passage', text: '## Part One\n\nOne two three.' },
    { node_id: 'two', role: 'story_passage', text: '## Part Two\n\nFour five.' }] };
  const data = await buildViewerData({ history: source, rendered, generatedAt });
  assert.equal(data.totals.words, 5);
  assert.deepEqual(data.story.units.map((unit) => unit.id), ['title', 'one', 'two']);
});
