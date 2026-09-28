import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
  assert.equal(data.inspection.modelHash, MODEL);
  assert.equal(data.headGraphHash, GRAPH);
  assert.equal(data.timeUnit, 'year');
  assert.equal(data.events[0].start, 2000);
  assert.equal(data.viewKind, 'graph');
  assert.deepEqual(data.capabilities, { graph: true, temporal: true, trajectories: true, story: true, construction: false });
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
  assert.equal(data.viewKind, 'graph');
  assert.deepEqual(data.inspection.model, source.models[0].definition);
});

test('construction steps and record births follow only the selected model lineage, not declared external lives', async () => {
  const bookBase = '1'.repeat(64), bookHead = '2'.repeat(64), authorBase = '3'.repeat(64), authorHead = '4'.repeat(64);
  const definition = (id, number, previous, events) => ({
    id, time_unit: 'year', revision: { number, ...(previous ? { previous_model_hash: previous } : {}), reason: `${id} revision ${number}` },
    processes: [], meaning_model: { events: events.map((eventId) => ({ id: eventId, interval: { start: 2000, end: 2001 } })) },
  });
  // Portable bundles guarantee parent-before-child ordering, not one world per
  // bundle. Record IDs are local to each model, so these two lives can share one.
  const source = { models: [
    { modelHash: bookBase, definition: definition('book', 0, null, ['book-root']) },
    { modelHash: authorBase, definition: definition('author', 0, null, ['shared-event']) },
    { modelHash: bookHead, definition: definition('book', 1, bookBase, ['book-root', 'shared-event']) },
    { modelHash: authorHead, definition: definition('author', 1, authorBase, ['shared-event', 'author-only']) },
  ], revisions: [graphRevision(bookHead)], headGraphHash: GRAPH };
  const calls = source.models.map((entry, index) => ({
    at: `2026-09-26T10:0${index}:00.000Z`, seq: index + 1, command: { name: 'life_model_register' }, result: { modelHash: entry.modelHash },
  }));
  const before = structuredClone(source);
  const data = await buildViewerData({ history: freezeDeep(source), calls, generatedAt });

  assert.equal(data.modelHash, bookHead);
  assert.deepEqual(data.events.map((event) => event.id), ['book-root', 'shared-event']);
  assert.deepEqual(data.events.find((event) => event.id === 'shared-event').born, { rev: 1, at: calls[2].at });
  assert.deepEqual(data.steps.map(({ label, rev, at, added }) => ({ label, rev, at, addedEvents: added.events })), [
    { label: 'book revision 0', rev: 0, at: calls[0].at, addedEvents: 1 },
    { label: 'book revision 1', rev: 1, at: calls[2].at, addedEvents: 1 },
  ]);
  assert.equal(data.totals.modelRevisions, 2);
  assert.deepEqual(data.inspection.model, before.models[2].definition);
  assert.deepEqual(source, before, 'dependency definitions remain intact in the portable bundle');

  const withoutBookCalls = await buildViewerData({ history: source, calls: [calls[1], calls[3]], generatedAt });
  assert.deepEqual(withoutBookCalls.steps, [], 'author construction timestamps do not create a book construction timeline');
  assert.equal(withoutBookCalls.capabilities.construction, false);
});

test('a model-only snapshot can begin with an available descendant without claiming its missing ancestry', async () => {
  const definition = model('year');
  definition.revision = { number: 7, previous_model_hash: OTHER_MODEL, reason: 'Available snapshot' };
  const data = await buildViewerData({ history: history(definition), generatedAt });
  assert.equal(data.totals.modelRevisions, 1);
  assert.deepEqual(data.events[0].born, { rev: 0, at: null });
  assert.deepEqual(data.inspection.model, definition);
});

test('all clocks have graphs; only supported calendar paths advertise trajectories', async (t) => {
  for (const timeUnit of ['year', 'years', 'civil_day_since_1970', 'second', 'hour', 'machine_cycle']) {
    await t.test(timeUnit, async () => {
      const definition = model(timeUnit);
      if (timeUnit === 'civil_day_since_1970') definition.meaning_model.events[0].interval = { start: 0, end: 365.2425 };
      else if (timeUnit === 'year' || timeUnit === 'years') definition.meaning_model.events[0].interval = { start: 2000, end: 2002 };
      const calendar = ['year', 'years', 'civil_day_since_1970'].includes(timeUnit);
      const data = await buildViewerData({ history: history(definition), rendered: render(), generatedAt });

      assert.equal(data.timeUnit, timeUnit);
      assert.equal(data.viewKind, 'graph');
      assert.equal(data.capabilities.trajectories, calendar);
      assert.equal(data.capabilities.temporal, true, 'native numeric clocks retain their own time axis');
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

  assert.equal(data.viewKind, 'graph');
  assert.equal(data.timeUnit, '');
  assert.equal(data.story, null);
  assert.deepEqual(data.capabilities, { graph: true, temporal: false, trajectories: false, story: false, construction: false });
  assert.equal(data.extent, null);
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.measures, []);
  assert.deepEqual(data.inspection.model, definition);
});

test('a calendar story without numeric paths retains the original time view, graph, and story capabilities', async () => {
  const definition = model('year');
  definition.processes[0].support = ['The reactor warmed gradually.'];
  const data = await buildViewerData({ history: history(definition), rendered: render(), generatedAt });

  assert.equal(data.viewKind, 'graph');
  assert.equal(data.story.units[0].text, 'The reactor warmed.');
  assert.deepEqual(data.capabilities, { graph: true, temporal: true, trajectories: false, story: true, construction: false });
  assert.deepEqual(data.measures[0].points, []);
  assert.deepEqual(data.inspection.model.processes[0].initial_value, { value: -5 });
});

test('a numeric calendar model advertises trajectories without needing a narrative graph or story', async () => {
  const definition = model('year');
  const data = await buildViewerData({ history: history(definition), generatedAt });
  assert.equal(data.viewKind, 'graph');
  assert.deepEqual(data.capabilities, { graph: true, temporal: true, trajectories: true, story: false, construction: false });
  assert.equal(data.story, null);
  assert.deepEqual(data.inspection.graph, { id: null, nodes: [], edges: [] });
  assert.deepEqual(data.inspection.model, definition);
  assert.equal(data.inspection.modelHash, MODEL);
});

test('empty and disconnected models keep every authoritative graph record without invented trajectories', async () => {
  for (const definition of [
    { id: 'empty', time_unit: 'tick', processes: [], meaning_model: {} },
    { id: 'disconnected', time_unit: 'tick', processes: [{ id: 'left', value_type: 'category', initial_value: { kind: 'category', value: 'ready' } }, { id: 'right', value_type: 'vector' }],
      meaning_model: { events: [{ id: 'a' }, { id: 'b' }], concepts: [{ id: 'idea' }], abstract_relations: [{ id: 'comparison', kind: 'analogy' }] } },
  ]) {
    const data = await buildViewerData({ history: history(definition), generatedAt });
    assert.equal(data.viewKind, 'graph');
    assert.deepEqual(data.capabilities, { graph: true, temporal: false, trajectories: false, story: false, construction: false });
    assert.deepEqual(data.inspection.model, definition);
    assert.equal(data.events.length, definition.meaning_model.events?.length ?? 0);
    assert.ok(data.processes.every((process) => process.points.length === 0));
    assert.equal(data.extent, null);
  }
});

test('the Book exposes its native numerical compositions even without prose-format process paths', async () => {
  const definition = JSON.parse(await readFile(new URL('../../examples/book-of-conditions/rust-construction/model.json', import.meta.url), 'utf8'));
  const data = await buildViewerData({ history: history(definition), rendered: render(), generatedAt });
  assert.equal(data.viewKind, 'graph');
  assert.deepEqual(data.capabilities, { graph: true, temporal: true, trajectories: false, story: true, construction: false });
  assert.equal(data.timeUnit, definition.time_unit);
  assert.ok(data.events.length > 0);
  assert.ok(data.inspection.model.meaning_model.normalized_cuts.length > 0);
  assert.ok(data.measures.every((measure) => measure.points.length === 0));
  assert.equal(data.numerics.cuts.length, definition.meaning_model.normalized_cuts.filter((cut) => !cut.withdrawn).length);
  assert.ok(data.numerics.counts.datedCuts > 0);
  assert.ok(data.numerics.counts.scalarRecords > 0);
  for (const reading of data.numerics.cuts) {
    const original = definition.meaning_model.normalized_cuts.find((cut) => cut.id === reading.id);
    assert.deepEqual(reading.answers, original.answers);
    assert.deepEqual(reading.conditioning, original.conditioning ?? null);
    assert.equal(reading.eventId, original.parent_event_id);
    if (reading.interval) assert.equal(reading.t, 1970 + reading.interval.start / 365.2425);
  }
  assert.deepEqual(data.inspection.model, definition);
});

test('story capability requires prose but permits a manuscript held entirely by its document root', async () => {
  for (const [text, expected] of [['', false], ['# Title\n\n## Section', false], ['# Title\n\nThe entire story.', true]]) {
    const data = await buildViewerData({ history: history(), rendered: { units: [{ node_id: 'root', role: 'document_root', text }] }, generatedAt });
    assert.equal(data.capabilities.story, expected);
    assert.equal(data.story.units[0].text, text);
  }
});

test('construction capability requires a recorded step timestamp, never generation time alone', async () => {
  for (const [at, expected] of [[null, false], ['not-a-timestamp', false], ['2026-09-26T10:00:00.000Z', true]]) {
    const calls = at === null ? [] : [{ at, seq: 1, command: { name: 'life_model_register' }, result: { modelHash: MODEL } }];
    const data = await buildViewerData({ history: history(), generatedAt, calls });
    assert.equal(data.capabilities.construction, expected);
    assert.equal(data.constructionTiming, expected ? 'available' : 'unavailable');
    assert.equal(data.generatedAt, generatedAt);
  }
});

test('cyclic undated containment terminates and retains the actual relations', () => {
  const definition = { id: 'cyclic', time_unit: 'tick', processes: [], meaning_model: {
    events: [{ id: 'a' }, { id: 'b' }, { id: 'self' }], event_relations: [
      { id: 'a-b', kind: 'contains', source_event_id: 'a', target_event_id: 'b' },
      { id: 'b-a', kind: 'contains', source_event_id: 'b', target_event_id: 'a' },
      { id: 'self-self', kind: 'contains', source_event_id: 'self', target_event_id: 'self' },
    ],
  } };
  // A synchronous traversal regression must fail with a bounded timeout rather
  // than hanging the whole test runner on an unbounded parent walk.
  const script = `import { buildViewerData } from ${JSON.stringify(new URL('../src/viewer-data.mjs', import.meta.url).href)};\n` +
    `const data = await buildViewerData({history: ${JSON.stringify(history(definition))}}); console.log(JSON.stringify(data));`;
  const data = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5_000 }));
  assert.equal(data.viewKind, 'graph');
  assert.deepEqual(data.events.map((event) => event.reach), [null, null, null]);
  assert.deepEqual(data.inspection.model, definition);
});

test('deep containment uses bounded iterative traversal while preserving the authored dated descendant', async () => {
  const count = 6_000;
  const events = Array.from({ length: count }, (_, index) => ({ id: `e${index}`, ...(index === count - 1 ? { interval: { start: 8, end: 9 } } : {}) }));
  const relations = events.slice(1).map((event, index) => ({ kind: 'contains', source_event_id: `e${index}`, target_event_id: event.id }));
  const definition = { id: 'deep', time_unit: 'tick', processes: [], meaning_model: { events, event_relations: relations } };
  const data = await buildViewerData({ history: history(definition), generatedAt });
  assert.equal(data.events.length, count);
  assert.deepEqual(data.events[0].reach, [8, 9]);
  assert.deepEqual(data.events.at(-1).reach, [8, 9]);
  assert.equal(data.events.at(-1).depth, count - 1);
  assert.deepEqual(data.inspection.model, definition);
  assert.equal(data.capabilities.trajectories, false);
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


test('split containers retain hierarchy but never expose excluded original prose as current scene text', async () => {
  const source = history(model('year'));
  const nodes = [
    { id: 'book', node_type: 'document', role: 'document_root', render: 'include', text: '# The book' },
    { id: 'part', node_type: 'story_passage', role: 'story_passage', render: 'exclude', title: 'Original part', text: 'Retained old prose.' },
    { id: 'child', node_type: 'story_passage', role: 'story_passage', render: 'include', text: 'Current child words.' },
  ];
  const edge = (id, from, to) => ({ id, family: 'structural', relation: 'contains', order: 0,
    source: { kind: 'node', node_id: from }, target: { kind: 'node', node_id: to } });
  source.revisions.push({ graphHash: GRAPH, definition: { id: 'book-graph', source: { kind: 'model', model_hash: MODEL },
    nodes, edges: [edge('book-part', 'book', 'part'), edge('part-child', 'part', 'child')] } });
  const rendered = { roots: ['book'], join_policy: 'blank_line', text: '# The book\n\nCurrent child words.',
    units: [nodes[0], nodes[2]].map((node) => ({ node_id: node.id, role: node.role, text: node.text })) };
  const data = await buildViewerData({ history: source, rendered, generatedAt });
  assert.equal(data.story.hierarchy.status, 'available');
  assert.deepEqual(data.story.hierarchy.roots.map((entry) => entry.unit.id), ['part']);
  assert.deepEqual(data.story.hierarchy.roots[0].children.map((entry) => entry.unit.id), ['child']);
  assert.equal(data.story.hierarchy.roots[0].words, 3);
  assert.equal(data.story.hierarchy.roots[0].unit.text, '');
  assert.deepEqual(data.story.units.map((unit) => unit.text), ['# The book', 'Current child words.']);
  const displayed = data.graph.nodes.find((node) => node.id === 'part');
  assert.match(displayed.text, /retained original text is excluded/);
  assert.ok(!displayed.text.includes('Retained old prose.'));
  assert.equal(data.inspection.graph.nodes.find((node) => node.id === 'part').text, 'Retained old prose.', 'complete raw inspection preserves the historical node');
});

test('native reflection roles are thoughts without a required node-type naming convention', async () => {
  const source = history(model('year'));
  const revision = graphRevision();
  revision.definition.nodes = [
    { id: 'reason', node_type: 'construction_rationale', role: 'externalized_reflection', text: 'Why the apparatus stays finite.', holder: 'author' },
    { id: 'observation', node_type: 'my_custom_reasoning', role: 'externalized_reflection', text: 'A consequential doubt.', holder: 'reader' },
    { id: 'review', node_type: 'review', role: 'externalized_reflection', text: 'A separately identified review.' },
    { id: 'ordinary', node_type: 'my_custom_record', role: 'metadata', text: 'Ordinary metadata.' },
  ];
  source.revisions.push(revision); source.headGraphHash = GRAPH;
  const data = await buildViewerData({ history: source, rendered: render(), generatedAt });
  assert.deepEqual(data.graph.nodes.map(({ id, category }) => [id, category]), [
    ['reason', 'thought'], ['observation', 'thought'], ['review', 'review'], ['ordinary', 'other'],
  ]);
});

function innerContextModel(participants = {}, referents = [{ id: 'actor', boundary: 'The actor', lifecycle_event_id: 'life' }]) {
  return {
    id: 'inner-context-example', time_unit: 'year', processes: [], meaning_model: {
      events: ['world', 'life', 'inner', 'appraisal'].map((id) => ({ id, boundary: id,
        interval: { start: 2000, end: 2001 }, participants: id === 'inner' ? participants : {} })),
      referents,
      event_relations: [['world', 'life'], ['life', 'inner'], ['inner', 'appraisal']].map(([from, to]) => ({
        id: `${from}-contains-${to}`, kind: 'contains', source_event_id: from, target_event_id: to,
      })),
      context_roots: [{ event_id: 'world', kind: 'accepted_world' }, { event_id: 'inner', kind: 'inner' }],
    },
  };
}

test('inner Events inherit the enclosing lifecycle display owner when their root has no subject', async () => {
  for (const participants of [{}, { subject: null }]) {
    const definition = freezeDeep(innerContextModel(participants));
    const data = await buildViewerData({ history: history(definition), generatedAt });
    for (const id of ['inner', 'appraisal']) {
      const event = data.events.find((item) => item.id === id);
      assert.equal(event.owner, 'actor');
      assert.equal(event.context, 'inner', 'display grouping must not promote an appraisal to world fact');
    }
    assert.deepEqual(data.inspection.model, definition, 'no native subject metadata is invented');
  }
});

test('an inner root explicit subject keeps precedence over an enclosing lifecycle display owner', async () => {
  const definition = innerContextModel({ subject: 'observer' });
  definition.meaning_model.events.push({ id: 'observer-life', boundary: 'The observer life', interval: { start: 2000, end: 2001 } });
  definition.meaning_model.referents.push({ id: 'observer', boundary: 'The observer', lifecycle_event_id: 'observer-life' });
  const data = await buildViewerData({ history: history(definition), generatedAt });
  assert.equal(data.events.find((event) => event.id === 'life').owner, 'actor');
  for (const id of ['inner', 'appraisal']) {
    assert.equal(data.events.find((event) => event.id === id).owner, 'observer');
    assert.equal(data.events.find((event) => event.id === id).context, 'inner');
  }
});

test('an inner context without a declared subject or enclosing referent lifecycle keeps an unknown display owner', async () => {
  const data = await buildViewerData({ history: history(innerContextModel({}, [])), generatedAt });
  for (const id of ['inner', 'appraisal']) {
    assert.equal(data.events.find((event) => event.id === id).owner, null);
    assert.equal(data.events.find((event) => event.id === id).context, 'inner');
  }
});
