import { noEventLinkDeclaration } from '../src/narrative-grounding.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryHierarchy, firstNamedStoryParts, placeStoryUnits, countProseWords } from '../viewer/public/story-time.js';

import { LifeSimulationService } from '../src/service.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';

const endpoint = (node_id) => ({ kind: 'node', node_id });
const node = (id, text = '', render = 'include', role = 'story_passage') => ({
  id, node_type: role === 'document_root' ? 'book' : 'passage', role, text, render,
});
const contains = (id, from, to, order) => ({
  id, source: endpoint(from), target: endpoint(to), family: 'structural', relation: 'contains', order,
});
const next = (id, from, to) => ({
  id, source: endpoint(from), target: endpoint(to), family: 'structural', relation: 'next',
});
const renders = (id, from, eventId) => ({
  id, source: endpoint(from), target: { kind: 'anchor', anchor_kind: 'event', anchor_id: eventId },
  family: 'grounding', relation: 'renders',
});
const unit = (record) => ({ id: record.id, role: record.role, title: record.title ?? null, text: record.text });
const flatten = (entries) => entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
const renderedIds = (entries) => entries.flatMap((entry) => entry.renderedUnitIds);

test('a next edge between authored siblings does not steal the second sibling from its container', () => {
  const nodes = [node('book', '', 'exclude', 'document_root'), node('p1', '', 'exclude'),
    node('a', 'First.'), node('b', 'Second.'), node('p2', 'Next part.')];
  const edges = [contains('book.p1', 'book', 'p1', 0), contains('book.p2', 'book', 'p2', 1),
    contains('p1.a', 'p1', 'a', 0), contains('p1.b', 'p1', 'b', 1), next('a.next.b', 'a', 'b')];
  const units = ['a', 'b', 'p2'].map((id) => unit(nodes.find((item) => item.id === id)));
  const result = buildStoryHierarchy({ units, nodes, edges, rootIds: ['book'] });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.roots.map((entry) => entry.unit.id), ['p1', 'p2']);
  assert.deepEqual(result.roots[0].children.map((entry) => entry.unit.id), ['a', 'b']);
  assert.deepEqual(result.roots[0].renderedUnitIds, ['a', 'b']);
  assert.deepEqual(renderedIds(result.roots), ['a', 'b', 'p2']);
});

test('named parts preserve the twelve-part frontier through deeper splits without changing enclosing groups', () => {
  const book = node('book', '', 'exclude', 'document_root');
  const groups = [
    { ...node('part.01', 'Earlier coarse prose.', 'exclude'), title: null },
    { ...node('part.07', 'Later coarse prose.', 'exclude'), title: ' \t ' },
  ];
  const parts = Array.from({ length: 12 }, (_, i) => ({
    ...node('p' + String(i + 1).padStart(2, '0'), i === 7 ? 'Before.\n\nMiddle.\n\nAfter.' : 'Part ' + (i + 1) + '.'),
    title: 'Part ' + (i + 1),
  }));
  const nodes = [book, ...groups, ...parts];
  const edges = [
    ...groups.map((group, i) => contains('book.' + group.id, 'book', group.id, i)),
    ...parts.map((part, i) => contains('group.' + part.id, groups[Math.floor(i / 6)].id, part.id, i % 6)),
  ];
  const initial = buildStoryHierarchy({ units: parts.map(unit), nodes, edges, rootIds: ['book'] });
  assert.equal(initial.status, 'available');
  assert.deepEqual(initial.roots.map((entry) => entry.unit.id), ['part.01', 'part.07']);
  const initialBefore = JSON.stringify(initial.roots);
  const initialNamed = firstNamedStoryParts(initial.roots);
  assert.deepEqual(initialNamed.map((entry) => entry.unit.id), parts.map((part) => part.id));
  for (let i = 0; i < 12; i++) assert.equal(initialNamed[i], initial.roots[Math.floor(i / 6)].children[i % 6]);
  assert.equal(JSON.stringify(initial.roots), initialBefore);

  const splitNodes = structuredClone(nodes);
  splitNodes.find((item) => item.id === 'p08').render = 'exclude';
  splitNodes.push(
    { ...node('p08.a', 'Before.'), title: 'An inner named scene' },
    { ...node('p08.b', 'Middle.\n\nAfter.', 'exclude'), title: null },
    { ...node('p08.b.1', 'Middle.'), title: ' \n ' },
    { ...node('p08.b.2', 'After.'), title: 'Another inner named scene' },
  );
  const splitEdges = [...edges, contains('p08.a', 'p08', 'p08.a', 0), contains('p08.b', 'p08', 'p08.b', 1),
    contains('p08.b.1', 'p08.b', 'p08.b.1', 0), contains('p08.b.2', 'p08.b', 'p08.b.2', 1)];
  const splitUnits = parts.flatMap((part) => part.id === 'p08'
    ? ['p08.a', 'p08.b.1', 'p08.b.2'].map((id) => unit(splitNodes.find((item) => item.id === id))) : [unit(part)]);
  const revised = buildStoryHierarchy({ units: splitUnits, nodes: splitNodes, edges: splitEdges, rootIds: ['book'] });
  assert.equal(revised.status, 'available');
  const revisedBefore = JSON.stringify(revised.roots);
  const revisedNamed = firstNamedStoryParts(revised.roots);
  assert.deepEqual(revisedNamed.map((entry) => entry.unit.id), parts.map((part) => part.id));
  for (let i = 0; i < 12; i++) assert.equal(revisedNamed[i], revised.roots[Math.floor(i / 6)].children[i % 6]);
  assert.deepEqual(revised.roots.map((entry) => entry.unit.id), ['part.01', 'part.07']);
  assert.ok(flatten(revised.roots).some((entry) => entry.unit.id === 'p08.b'));
  assert.deepEqual(revisedNamed[7].renderedUnitIds, ['p08.a', 'p08.b.1', 'p08.b.2']);
  assert.equal(JSON.stringify(revised.roots), revisedBefore);
});


test('authored contains order and own rendered text contribute to ancestor totals exactly once', () => {
  const book = node('book', '', 'exclude', 'document_root');
  const section = node('section', '# A section\n\nPreface words.');
  const first = node('first', 'Child has three.');
  const last = node('last', 'Two words.');
  const nodes = [last, section, book, first];
  const edges = [contains('section.last', 'section', 'last', 5),
    contains('book.section', 'book', 'section', 0), contains('section.first', 'section', 'first', 1)];
  const units = [section, first, last].map(unit);
  const input = { units, nodes, edges, rootIds: ['book'] };
  const before = JSON.stringify(input);
  const result = buildStoryHierarchy(input);
  assert.equal(result.status, 'available');
  assert.deepEqual(result.roots.map((entry) => entry.unit.id), ['section']);
  const entry = result.roots[0];
  assert.deepEqual(entry.children.map((child) => child.unit.id), ['first', 'last']);
  assert.deepEqual(entry.renderedUnitIds, ['section', 'first', 'last']);
  assert.deepEqual([entry.words, entry.wordStart, entry.wordEnd], [7, 0, 7]);
  assert.deepEqual(entry.children.map((child) => [child.words, child.wordStart, child.wordEnd]), [[3, 2, 5], [2, 5, 7]]);
  assert.equal(entry.words, countProseWords(units.map((item) => item.text).join('\n\n')));
  assert.equal(JSON.stringify(input), before, 'hierarchy construction does not change graph or rendered prose');
});

test('excluded split prose stays excluded and next continues at the same top level without inherited links', () => {
  const nodes = [node('book', '', 'exclude', 'document_root'), node('part', 'Retained historical prose must not count.', 'exclude'),
    node('a', 'First child.'), node('b', 'Second child.'), node('continuation', 'Next part.')];
  const edges = [contains('book.part', 'book', 'part', 0), contains('part.a', 'part', 'a', 0),
    contains('part.b', 'part', 'b', 1), next('b.continues', 'b', 'continuation'),
    renders('part.history', 'part', 'old'), renders('a.depiction', 'a', 'new')];
  const events = [{ id: 'old', start: 2000, end: 2001 }, { id: 'new', start: 2020, end: 2021 }];
  const units = placeStoryUnits(nodes.filter((item) => ['a', 'b', 'continuation'].includes(item.id)).map(unit), edges, events);
  const result = buildStoryHierarchy({ units, nodes, edges, rootIds: ['book'], events });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.roots.map((entry) => entry.unit.id), ['part', 'continuation']);
  const part = result.roots[0];
  assert.equal(part.unit.text, '');
  assert.deepEqual(part.children.map((entry) => entry.unit.id), ['a', 'b']);
  assert.deepEqual(part.renderedUnitIds, ['a', 'b']);
  assert.deepEqual([part.words, part.wordStart, part.wordEnd], [4, 0, 4]);
  assert.deepEqual(part.unit.tells, [{ eventId: 'old' }], 'the container keeps only its own authored link');
  assert.deepEqual(part.children.map((entry) => entry.unit.tells), [[{ eventId: 'new' }], []]);
  assert.equal(part.children[1].timing.complete, false);
  assert.equal(part.children[1].timing.range, null);
  assert.equal(part.children[1].relativeToPrevious, 'unknown');
  assert.deepEqual(renderedIds(result.roots), units.map((item) => item.id));
});

test('shared or noncontiguous containment is explicitly unavailable instead of inventing a tree', () => {
  const book = node('book', '', 'exclude', 'document_root');
  const shared = buildStoryHierarchy({
    nodes: [book, node('left', '', 'exclude'), node('right', '', 'exclude'), node('shared', 'Once.')],
    edges: [contains('book.left', 'book', 'left', 0), contains('book.right', 'book', 'right', 1),
      contains('left.shared', 'left', 'shared', 0), contains('right.shared', 'right', 'shared', 0)],
    units: [unit(node('shared', 'Once.'))], rootIds: ['book'],
  });
  const interleaved = buildStoryHierarchy({
    nodes: [book, node('group', '', 'exclude'), node('a', 'A.'), node('b', 'B.'), node('c', 'C.')],
    edges: [contains('book.group', 'book', 'group', 0), contains('group.a', 'group', 'a', 0),
      contains('group.c', 'group', 'c', 1), next('a.b', 'a', 'b')],
    units: ['a', 'b', 'c'].map((id) => unit(node(id, id.toUpperCase() + '.'))), rootIds: ['book'],
  });
  for (const result of [shared, interleaved]) {
    assert.equal(result.status, 'unavailable');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length);
    assert.deepEqual(result.roots, []);
  }
});

test('heading-only passages have zero words and empty units introduce no fabricated length', () => {
  const nodes = [node('book', '# Book', 'include', 'document_root'), node('heading', '## Chapter'),
    node('empty', ''), node('whitespace', ' \n'), node('prose', 'Two words.')];
  const edges = nodes.slice(1).map((item, i) => contains('book.' + item.id, 'book', item.id, i));
  const result = buildStoryHierarchy({ units: nodes.map(unit), nodes, edges, rootIds: ['book'] });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.roots.map((entry) => entry.unit.id), ['heading', 'prose']);
  assert.deepEqual(result.roots.map((entry) => [entry.words, entry.wordStart, entry.wordEnd]), [[0, 0, 0], [2, 0, 2]]);
  assert.deepEqual(renderedIds(result.roots), ['heading', 'prose']);
});

test('scope-filtered inputs never recover inaccessible containers or passages', () => {
  const book = node('book', '', 'exclude', 'document_root');
  const publicNode = node('public', 'Visible words.');
  const hidden = { ...node('hidden', 'Private words.'), content_included: false, boundary: true };
  const edges = [contains('book.public', 'book', 'public', 0), contains('book.hidden', 'book', 'hidden', 1)];
  const result = buildStoryHierarchy({ units: [unit(publicNode)], nodes: [book, publicNode, hidden], edges, rootIds: ['book'] });
  assert.equal(result.status, 'available');
  assert.deepEqual(flatten(result.roots).map((entry) => entry.unit.id), ['public']);
  assert.equal(result.roots[0].words, 2);
});

test('next ties use native lexical edge order rather than locale or UTF-16 collation', () => {
  for (const ids of [['Z.next', 'a.next'], ['\uE000.next', '\u{1F600}.next']]) {
    const nodes = [node('book', '', 'exclude', 'document_root'), node('first', 'First.'), node('last', 'Last.')];
    const result = buildStoryHierarchy({ units: nodes.slice(1).map(unit), nodes,
      edges: [next(ids[1], 'book', 'last'), next(ids[0], 'book', 'first')], rootIds: ['book'] });
    assert.equal(result.status, 'available', 'native order for ' + ids.join(', '));
    assert.deepEqual(result.roots.map((entry) => entry.unit.id), ['first', 'last']);
  }
});

test('native split and nested split preserve twelve top-level passages, exact prose and explicit-only links', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const provenance = ['Native document hierarchy regression'];
  const authority = { source: 'author', weight: 1 };
  const noLinkReason = 'Hierarchy fixture does not assign the original Event to these textual fragments.';
  const authored = (record) => ({ ...record, epistemic_status: 'authored', evidence_type: 'fictional_canon', authority, provenance: [...provenance, noEventLinkDeclaration(record.text, noLinkReason, 'fixture-author')] });
  const model = await service.registerModel({ requestId: 'hierarchy.model', model: {
    schema: 'life-sim-rust-model/v1', id: 'hierarchy.model', time_unit: 'year',
    revision: { number: 0, reason: 'Test prose hierarchy independently from world chronology.', provenance },
    processes: [{ id: 'signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['fixture'] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', events: [{
      id: 'depicted', boundary: 'An Event linked to the original passage.', interval: { start: 2000, end: 2001 }, process_ids: ['signal'], provenance,
    }] },
  } });
  const passages = Array.from({ length: 12 }, (_, i) => authored(node('p' + String(i + 1).padStart(2, '0'),
    i === 7 ? 'Before.\n\nMiddle.\n\nAfter.' : 'Part ' + (i + 1) + '.')));
  const definition = {
    schema: 'life-sim-rust-narrative-graph/v1', id: 'hierarchy.graph',
    revision: { number: 0, reason: 'Twelve authored top-level passages.', provenance },
    source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
    nodes: [authored(node('book', '', 'exclude', 'document_root')), ...passages],
    edges: [...passages.map((item, i) => ({ ...contains('book.' + item.id, 'book', item.id, i), provenance })),
      { ...renders('p08.depiction', 'p08', 'depicted'), provenance }],
  };
  const registered = await service.registerNarrativeGraph({ requestId: 'hierarchy.graph', narrativeGraph: definition });
  const render = (graphHash) => service.renderNarrativeGraph({ graphHash, rootIds: ['book'], expectedGraphHash: graphHash, accessScopes: [] });
  const before = await render(registered.graphHash);
  const edited = await editNarrativeGraph(service, { requestId: 'hierarchy.split', graphHash: registered.graphHash,
    reason: 'Open the eighth passage at two successive resolutions.', accessScopes: [], operations: [
      { kind: 'split', nodeId: 'p08', parts: [{ noLinkReason, id: 'p08.a', text: 'Before.\n\nMiddle.' }, { noLinkReason, id: 'p08.b', text: 'After.' }] },
      { kind: 'split', nodeId: 'p08.a', parts: [{ noLinkReason, id: 'p08.a.1', text: 'Before.' }, { noLinkReason, id: 'p08.a.2', text: 'Middle.' }] },
    ] });
  const [rendered, graph] = await Promise.all([
    render(edited.graphHash),
    service.queryNarrativeGraph({ graphHash: edited.graphHash, expectedGraphHash: edited.graphHash, mode: 'full', includeContent: true, accessScopes: [] }),
  ]);
  const events = [{ id: 'depicted', start: 2000, end: 2001 }];
  const units = placeStoryUnits(rendered.units.map((item) => ({ id: item.node_id, text: item.text, role: item.role, title: item.title })), graph.edges, events);
  const hierarchy = buildStoryHierarchy({ units, nodes: graph.nodes, edges: graph.edges, rootIds: rendered.roots, events });
  assert.equal(hierarchy.status, 'available');
  assert.deepEqual(hierarchy.roots.map((entry) => entry.unit.id), passages.map((item) => item.id));
  const eighth = hierarchy.roots[7];
  assert.deepEqual(eighth.children.map((entry) => entry.unit.id), ['p08.a', 'p08.b']);
  assert.deepEqual(eighth.children[0].children.map((entry) => entry.unit.id), ['p08.a.1', 'p08.a.2']);
  assert.deepEqual([eighth.unit.text, eighth.children[0].unit.text], ['', '']);
  assert.deepEqual([eighth.words, eighth.children[0].words, eighth.children[1].words], [3, 2, 1]);
  assert.deepEqual(eighth.renderedUnitIds, ['p08.a.1', 'p08.a.2', 'p08.b']);
  assert.deepEqual([eighth.wordStart, eighth.wordEnd], [14, 17]);
  assert.deepEqual(renderedIds(hierarchy.roots), units.map((item) => item.id));
  assert.equal(rendered.text, before.text);
  assert.equal(hierarchy.roots.reduce((sum, entry) => sum + entry.words, 0), countProseWords(before.text));
  assert.deepEqual(flatten(eighth.children).flatMap((entry) => entry.unit.tells), [], 'lineage does not assign the original Event to any child');
  assert.deepEqual(eighth.unit.tells, [{ eventId: 'depicted' }]);
  assert.equal(graph.nodes.find((item) => item.id === 'p08').text, 'Before.\n\nMiddle.\n\nAfter.', 'the old source still exists but is never counted twice');
});


test('deep authored nesting falls back explicitly before recursive presentation work', () => {
  const nodes = [node('book', '', 'exclude', 'document_root')]; const edges = [];
  let parent = 'book';
  for (let i = 0; i < 300; i += 1) {
    const id = `container.${i}`; nodes.push(node(id, '', 'exclude')); edges.push(contains(`edge.${i}`, parent, id, 0)); parent = id;
  }
  const leaf = node('leaf', 'Current words.'); nodes.push(leaf); edges.push(contains('leaf-edge', parent, leaf.id, 0));
  const result = buildStoryHierarchy({ units: [unit(leaf)], nodes, edges, rootIds: ['book'] });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'hierarchy_depth_limit');
  assert.deepEqual(result.roots, []);
});
