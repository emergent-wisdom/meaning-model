import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelGraph, layoutModelGraph, modelGraphId as id } from '../viewer/public/model-graph.js';

const event = (id, extra = {}) => ({ id, boundary: id, ...extra });
const endpoint = (kind, anchor_id, path) => ({ kind: 'anchor', anchor_kind: kind, anchor_id, ...(path === undefined ? {} : { path }) });
const nodeEndpoint = (node_id) => ({ kind: 'node', node_id });
const edge = (id, source_event_id, target_event_id, kind = 'contains') => ({ id, source_event_id, target_event_id, kind });
const findNode = (graph, kind, nativeId) => graph.nodes.find((node) => node.id === id(kind, nativeId));
const links = (graph, kind) => graph.edges.filter((edge) => edge.kind === kind);

test('typed native IDs preserve collisions, non-timed/isolated records and exact source data', () => {
  const inspection = { model: { id: 'same', time_unit: 'imagined_ticks', processes: [{ id: 'same', initial_value: { kind: 'scalar', value: 0.4 } }], meaning_model: {
    concepts: [{ id: 'same', label: 'Concept' }], events: [event('same', { interval: { start: 3, end: 8 }, participants: { actor: 'same' }, region: 'same' }), event('isolated')],
    referents: [{ id: 'same', boundary: 'Referent' }],
  } }, graph: { nodes: [{ id: 'same', title: 'Narrative', text: 'same is only text' }] } };
  const before = structuredClone(inspection), graph = buildModelGraph(inspection);
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, 7);
  assert.equal(graph.nodes.length, 7); assert.equal(graph.edges.length, 0, 'no links inferred from names or untyped participant annotations');
  assert.deepEqual(findNode(graph, 'event', 'same').interval, { start: 3, end: 8 });
  assert.equal(findNode(graph, 'event', 'same').timeUnit, 'imagined_ticks');
  assert.equal(findNode(graph, 'event', 'isolated').interval, null);
  assert.equal(findNode(graph, 'process', 'same').record, inspection.model.processes[0]);
  assert.deepEqual(inspection, before);
  assert.notEqual(id('event', 'a:b'), id('event:a', 'b'));
});

test('declared directed relations retain multiple parents, cross-context links, cycles and missing references', () => {
  const records = [edge('a-b', 'a', 'b'), edge('c-b', 'c', 'b'), edge('b-a', 'b', 'a'), edge('a-c', 'a', 'c', 'about'), edge('b-missing', 'b', 'missing', 'causes')];
  const inspection = { model: { meaning_model: { events: ['a', 'b', 'c', 'isolated'].map((value) => event(value)), event_relations: records,
    context_roots: [{ event_id: 'a', kind: 'accepted_world' }, { event_id: 'c', kind: 'understanding' }] } } };
  const graph = buildModelGraph(inspection), declared = links(graph, 'event_relation');
  assert.equal(declared.length, 5); assert.equal(links(graph, 'record_endpoint').length, 10);
  assert.deepEqual(declared.map((value) => [value.source, value.target, value.relation]).sort(), records.map((value) => [id('event', value.source_event_id), id('event', value.target_event_id), value.kind]).sort());
  assert.equal(declared.find((value) => value.record.id === 'a-c').record, records[3]);
  assert.equal(findNode(graph, 'event', 'missing').unresolved, true);
  assert.equal(findNode(graph, 'event', 'missing').record, null);
  assert.equal(graph.counts.unresolved, 1);
  assert.equal(findNode(graph, 'event', 'a').contexts[0].kind, 'accepted_world');
  assert.deepEqual(findNode(graph, 'event', 'b').contexts, [], 'shared parents do not select an implicit first context');
  assert.equal(findNode(graph, 'event_relation', 'a-b').record, records[0]);
  assert.equal(graph.edges.find((value) => value.kind === 'record_endpoint' && value.record.id === 'a-b' && value.relation === 'source').path,
    '/meaning_model/event_relations/0/source_event_id');
});

test('process decomposition, dependencies, typed laws and Event support stay distinct', () => {
  const model = { processes: ['a', 'b', 'never-linked'].map((value) => ({ id: value, support: ['a', 'b'] })),
    decomposition: [{ id: 'decomp', parent: 'a', child: 'b', kind: 'functional_refinement' }],
    dependencies: [{ id: 'dep', source: 'b', target: 'a', kind: 'constrains', law_id: 'law' }],
    laws: [{ id: 'law', operator: { role: 'occurrence', trigger: { kind: 'threshold', expression: { op: 'process', process: 'a' } }, effects: [{ target: 'b', value: { op: 'process', process: 'a' } }], activates: ['later'] } },
      { id: 'later', operator: { role: 'epistemic', claim: { subject: 'b' }, value: { op: 'constant', value: 0 } } }],
    initial_claims: [{ id: 'claim', subject: 'a', holder: 'b' }],
    meaning_model: { events: [event('scene', { process_ids: ['a'], observation_process_ids: ['b'] })] } };
  const graph = buildModelGraph({ model });
  assert.equal(links(graph, 'decomposition')[0].relation, 'functional_refinement');
  assert.equal(graph.edges.find((value) => value.kind === 'record_endpoint' && value.record.id === 'decomp' && value.relation === 'source').path,
    '/decomposition/0/parent');
  assert.equal(links(graph, 'dependency')[0].source, id('process', 'b'));
  const lawEdges = graph.edges.filter((value) => value.source === id('law', 'law'));
  assert.equal(lawEdges.filter((value) => value.relation === 'reads').length, 2, 'distinct expression references retain their paths');
  assert.ok(lawEdges.some((value) => value.relation === 'activates' && value.target === id('law', 'later')));
  assert.ok(graph.edges.some((value) => value.source === id('event', 'scene') && value.relation === 'observation_process'));
  assert.ok(graph.edges.some((value) => value.source === id('claim', 'claim') && value.target === id('process', 'a')));
  assert.ok(!graph.edges.some((value) => value.source === id('process', 'never-linked') || value.target === id('process', 'never-linked')));
});

test('Cut answers, conditioning, physical partitions, realization roles and bindings are exact', () => {
  const meaning_model = {
    events: [event('parent'), event('child')], concepts: [{ id: 'type' }, { id: 'subtype' }],
    abstract_relations: [{ id: 'sub', source_concept_id: 'type', target_concept_id: 'subtype', kind: 'specializes' }],
    abstract_cuts: [{ id: 'abstract', parent_concept_id: 'type', child_concept_ids: ['subtype'], lens: 'by form' }],
    referents: [{ id: 'person', lifecycle_event_id: 'parent' }, { id: 'body' }],
    encapsulation_cuts: [{ id: 'encap', parent_referent_id: 'person', children: [{ relation: 'body', referent_id: 'body', interval: { start: 1, end: 2 } }] }],
    physical_cuts: [{ id: 'physical', parent_event_id: 'parent', child_event_ids: ['child'], kind: 'sequential' }],
    normalized_cuts: [
      { id: 'q', parent_event_id: 'parent', unit: 'attention', answers: [{ key: 'shared', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
      { id: 'q2', parent_event_id: 'child', conditioning: { cut_id: 'q', answer_key: 'shared' }, answers: [{ key: 'shared', weight: 1 }] },
    ],
    temporal_cut_recompositions: [{ parent_cut_id: 'q', children: [{ cut_id: 'q2', projection: { kind: 'identity' } }], coverage: 'complete' }],
    realizations: [{ id: 'r', concept_id: 'type', physical_cut_id: 'physical', abstract_cut_id: 'abstract', roles: { action: 'child' }, referent_roles: { agent: 'person' }, degree: 0.95 }],
    event_referent_bindings: [{ id: 'binding', target: { kind: 'event', event_id: 'child' }, role: 'actor', referent_id: 'person', binding_type: 'participates' }],
  };
  const graph = buildModelGraph({ model: { meaning_model } });
  assert.equal(findNode(graph, 'normalized_cut_answer', JSON.stringify(['q', 'shared'])).record.weight, 0.7);
  assert.equal(graph.nodes.filter((node) => node.kind === 'normalized_cut_answer').length, 3);
  assert.ok(graph.edges.some((value) => value.source === id('normalized_cut_answer', JSON.stringify(['q', 'shared'])) && value.target === id('normalized_cut', 'q2') && value.relation === 'conditions'));
  assert.equal(links(graph, 'event_relation').length, 0, 'physical cuts do not synthesize Event contains relations');
  assert.ok(graph.edges.some((value) => value.source === id('physical_cut', 'physical') && value.target === id('event', 'child')));
  assert.ok(graph.edges.some((value) => value.source === id('realization', 'r') && value.target === id('referent', 'person') && value.relation === 'agent'));
  assert.equal(links(graph, 'event_referent_binding')[0].record.role, 'actor');
  assert.equal(graph.edges.find((value) => value.source === id('encapsulation_cut', 'encap')).childRecord.interval.start, 1);
  assert.equal(links(graph, 'temporal_cut_recomposition')[0].record, meaning_model.temporal_cut_recompositions[0]);
  assert.equal(links(graph, 'temporal_cut_recomposition')[0].relation, 'identity');
  assert.deepEqual(links(graph, 'temporal_cut_recomposition')[0].projection, { kind: 'identity' });
  assert.equal(graph.counts.unresolved, 0);
});

test('withdrawn Cut answers carry the owning Cut historical status without changing their shares', () => {
  const withdrawn = { reason: 'A later question replaced this one.', superseded_by: ['current'] };
  const graph = buildModelGraph({ model: { meaning_model: { events: [event('e')], normalized_cuts: [
    { id: 'old', parent_event_id: 'e', withdrawn, answers: [{ key: 'remainder', weight: 1 }] },
    { id: 'current', parent_event_id: 'e', answers: [{ key: 'remainder', weight: 1 }] },
  ] } } });
  const answer = findNode(graph, 'normalized_cut_answer', JSON.stringify(['old', 'remainder']));
  assert.equal(findNode(graph, 'normalized_cut', 'old').withdrawn, withdrawn);
  assert.equal(answer.withdrawn, withdrawn); assert.equal(answer.record.weight, 1);
  assert.equal(findNode(graph, 'normalized_cut_answer', JSON.stringify(['current', 'remainder'])).withdrawn, null);
});

test('narrative anchors resolve both endpoints, model hash, exact answer paths and relation records', () => {
  const cut = { id: 'cut', parent_event_id: 'event', answers: [{ key: 'remainder', weight: 1 }] };
  const graph = buildModelGraph({ modelHash: 'exact-hash', model: { id: 'model', meaning_model: { events: [event('event')], normalized_cuts: [cut], event_relations: [edge('self', 'event', 'event')] } },
    graph: { nodes: [{ id: 'note', text: 'A note' }], edges: [
      { id: 'hash', source: endpoint('model', 'exact-hash'), target: nodeEndpoint('note'), family: 'grounding', relation: 'grounds' },
      { id: 'answer', source: nodeEndpoint('note'), target: endpoint('normalized_cut', 'cut', '/answers/0/weight'), family: 'semantic', relation: 'discusses' },
      { id: 'relation', source: endpoint('event_relation', 'self'), target: endpoint('event', 'event'), family: 'semantic', relation: 'describes' },
      { id: 'missing', source: nodeEndpoint('absent'), target: endpoint('candidate', 'candidate'), family: 'provenance', relation: 'based_on' },
      { id: 'bad-path', source: nodeEndpoint('note'), target: endpoint('normalized_cut', 'cut', '/answers/9'), family: 'semantic', relation: 'refers' },
    ] } });
  const narrative = links(graph, 'narrative_edge');
  assert.equal(narrative.length, 5);
  assert.equal(narrative.find((value) => value.record.id === 'hash').source, id('model', 'model'));
  const answer = narrative.find((value) => value.record.id === 'answer');
  assert.equal(answer.target, id('normalized_cut_answer', JSON.stringify(['cut', 'remainder'])));
  assert.equal(answer.targetPath, '/answers/0/weight');
  assert.equal(answer.record.target.path, '/answers/0/weight');
  assert.equal(narrative.find((value) => value.record.id === 'relation').source, id('event_relation', 'self'));
  assert.equal(graph.counts.unresolved, 3);
  assert.equal(findNode(graph, 'candidate', 'candidate').record, null, 'unavailable external state is not manufactured');
  assert.ok(graph.nodes.find((node) => node.kind === 'unresolved_anchor').reason.includes('path'));
});

test('withdrawn records and superseding references are retained, and annotation IDs never become edges', () => {
  const model = { meaning_model: { concepts: [{ id: 'old', withdrawn: { reason: 'revised', superseded_by: ['new'] } }, { id: 'new' }],
    events: [event('event', { participants: { subject: 'not-a-reference' }, region: 'old', substrate: 'new', provenance: ['new'] })] } };
  const graph = buildModelGraph({ model });
  assert.equal(findNode(graph, 'concept', 'old').record.withdrawn.reason, 'revised');
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relation, 'superseded_by');
  assert.equal(graph.counts.unresolved, 0);
});

test('layout includes every node, stays bounded, is deterministic and leaves time/records untouched', () => {
  const graph = buildModelGraph({ model: { time_unit: 'not-calendar-time', meaning_model: {
    events: Array.from({ length: 1000 }, (_, i) => event(`e${i}`, { interval: { start: i * 1e9, end: i * 1e9 + 4 } })),
    event_relations: Array.from({ length: 999 }, (_, i) => edge(`r${i}`, `e${i}`, `e${i + 1}`, i % 2 ? 'about' : 'contains')),
  } } });
  const before = structuredClone(graph), positions = layoutModelGraph(graph, { radius: 75 });
  assert.equal(positions.size, 1999);
  for (const point of positions.values()) {
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
    assert.ok(Math.hypot(point.x, point.y, point.z) <= 75 + 1e-10);
  }
  const permuted = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
  assert.deepEqual(layoutModelGraph(permuted, { radius: 75 }), positions);
  assert.deepEqual(graph, before);
  const withoutIntervals = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, interval: null, timeUnit: 'seconds' })) };
  assert.deepEqual(layoutModelGraph(withoutIntervals, { radius: 75 }), positions, 'clock and intervals do not become geometry');
  assert.equal(layoutModelGraph({ nodes: [], edges: [] }).size, 0);
  assert.deepEqual([...layoutModelGraph({ nodes: [{ id: 'single' }], edges: [] }).values()], [{ x: 0, y: 0, z: 0 }]);
});

test('one disconnected record does not shrink the dominant component or dictate its framing', () => {
  const nodes = Array.from({ length: 1715 }, (_, i) => ({ id: `connected-${i}` }));
  const graph = { nodes: [...nodes, { id: 'isolated' }], edges: nodes.slice(1).map((node, i) => ({ source: nodes[i].id, target: node.id })) };
  const positions = layoutModelGraph(graph), isolated = positions.get('isolated');
  const extent = Math.max(...nodes.map((node) => { const point = positions.get(node.id); return Math.hypot(point.x, point.y, point.z); }));
  const isolatedDistance = Math.hypot(isolated.x, isolated.y, isolated.z);
  assert.ok(extent > 105, `dominant component extent ${extent} should fill most of the 120-radius frame`);
  assert.ok(isolatedDistance > extent, 'isolated record remains outside the dominant component');
  assert.ok(isolatedDistance <= 120 + 1e-10);
  assert.deepEqual(layoutModelGraph({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }), positions);
});

test('component allocation is size-aware and separate components retain non-overlapping bounds', () => {
  const groups = [1000, 64, 8, 2].map((count, c) => Array.from({ length: count }, (_, i) => ({ id: `component-${c}-${i}` })));
  const graph = { nodes: groups.flat(), edges: groups.flatMap((group) => group.slice(1).map((node, i) => ({ source: group[i].id, target: node.id }))) };
  // The midpoint and half-distance give the pair's exact enclosing sphere,
  // providing an independent separation check without accessing layout internals.
  const positions = layoutModelGraph(graph, { iterations: 0 }), mainRadius = Math.max(...groups[0].map((node) => Math.hypot(...Object.values(positions.get(node.id)))));
  const pair = groups.at(-1).map((node) => positions.get(node.id));
  const center = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2, z: (pair[0].z + pair[1].z) / 2 };
  const pairRadius = Math.hypot(pair[0].x - center.x, pair[0].y - center.y, pair[0].z - center.z);
  assert.ok(Math.hypot(center.x, center.y, center.z) - pairRadius > mainRadius);
  assert.ok(mainRadius > pairRadius * 5, 'component sizes do not receive equal visual radii');
  assert.equal(positions.size, graph.nodes.length);
});

test('many disconnected nodes keep distinct bounded deterministic positions', () => {
  const graph = { nodes: Array.from({ length: 2000 }, (_, i) => ({ id: `isolated-${i}` })), edges: [] };
  const positions = layoutModelGraph(graph), points = [...positions.values()];
  assert.equal(new Set(points.map((point) => JSON.stringify(point))).size, 2000);
  assert.ok(points.every((point) => Math.hypot(point.x, point.y, point.z) <= 120 + 1e-10));
  assert.deepEqual(layoutModelGraph({ nodes: [...graph.nodes].reverse(), edges: [] }), positions);
});
