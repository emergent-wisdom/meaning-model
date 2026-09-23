import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOperations, emptyOntology, instanceCounts, meaningModelFragment, normalizeOntology, renderOntologyTree } from '../src/alien-ontology.mjs';

const concept = (id, operator = `operator of ${id}`) => ({ op: 'add_concept', concept: { id, label: id.toUpperCase(), operator } });
const partition = (id, parentConceptId, childConceptIds) => ({ op: 'add_partition', partition: { id, parentConceptId, childConceptIds, lens: 'by what moves' } });
const assign = (subjectNodeId, conceptId) => ({ op: 'assign_instance', subjectNodeId, conceptId });

test('operations build a lens-organized hierarchy without mutating the previous revision', () => {
  const previous = emptyOntology();
  const { state, createdConceptIds } = applyOperations(previous, [
    concept('exchange'), concept('compulsory'), concept('voluntary'), partition('exchange.by-consent', 'exchange', ['compulsory', 'voluntary']),
    assign('m1', 'compulsory'), assign('m2', 'compulsory'), assign('m3', 'voluntary'),
    concept('storage'), { op: 'add_relation', relation: { id: 'r1', kind: 'opposition', sourceConceptId: 'exchange', targetConceptId: 'storage' } },
  ], { step: 3 });
  assert.deepEqual(previous, emptyOntology(), 'the input state is not mutated');
  assert.deepEqual(createdConceptIds, ['exchange', 'compulsory', 'voluntary', 'storage']);
  const { direct, subtree } = instanceCounts(state);
  assert.equal(direct.get('compulsory').instances, 2);
  assert.equal(subtree.get('exchange'), 3, 'a parent counts the distinct instances of its subtree');
  const tree = renderOntologyTree(state);
  assert.match(tree, /\[exchange\] EXCHANGE: 0 direct, 3 in subtree/);
  assert.match(tree, /partition exchange\.by-consent, lens: by what moves/);
  assert.match(tree, /exchange opposition storage/);
});

test('partitions need two distinct active children and the hierarchy stays acyclic', () => {
  assert.throws(() => applyOperations(null, [concept('a'), concept('b'), { op: 'add_partition', partition: { id: 'c', parentConceptId: 'a', childConceptIds: ['b', 'b'], lens: 'l' } }], { step: 0 }),
    /at least two distinct children/);
  assert.throws(() => applyOperations(null, [concept('a'), concept('b'), partition('c', 'a', ['a', 'b'])], { step: 0 }), /lists its parent as a child/);
  assert.throws(() => applyOperations(null, [concept('a'), concept('b'), concept('c'), partition('k', 'a', ['b', 'c']),
    { op: 'add_relation', relation: { id: 's', kind: 'specialization', sourceConceptId: 'b', targetConceptId: 'a' } }], { step: 0 }), /cycle through/);
  assert.throws(() => applyOperations(null, [concept('a'), concept('b'),
    { op: 'add_relation', relation: { id: 'o', kind: 'other', sourceConceptId: 'a', targetConceptId: 'b' } }], { step: 0 }), /kind other needs a label/);
  assert.throws(() => applyOperations(null, [concept('a'), concept('a')], { step: 0 }), /already used/);
});

test('merge re-points instances, partitions and relations; a partition left with one child must be restructured first', () => {
  const { state } = applyOperations(null, [concept('p'), concept('x'), concept('y'), concept('z'), partition('p.k', 'p', ['x', 'y', 'z']),
    assign('m1', 'x'), assign('m2', 'y'), assign('m1', 'y'),
    { op: 'add_relation', relation: { id: 'r', kind: 'analogy', sourceConceptId: 'y', targetConceptId: 'z' } }], { step: 1 });
  const { state: merged } = applyOperations(state, [{ op: 'merge', keepConceptId: 'x', mergeConceptId: 'y' }], { step: 2 });
  assert.equal(merged.concepts.find((item) => item.id === 'y').status, 'merged');
  assert.deepEqual(merged.partitions[0].childConceptIds, ['x', 'z']);
  assert.deepEqual(merged.instances.map((item) => `${item.subjectNodeId}:${item.conceptId}`).sort(), ['m1:x', 'm2:x'], 'duplicate instances collapse');
  assert.equal(merged.relations[0].sourceConceptId, 'x');
  assert.throws(() => applyOperations(merged, [assign('m3', 'y')], { step: 3 }), /merged into x/);
  assert.throws(() => applyOperations(merged, [{ op: 'merge', keepConceptId: 'x', mergeConceptId: 'z' }], { step: 3 }), /at least two distinct children/);
  const { state: restructured } = applyOperations(merged, [{ op: 'remove_partition', partitionId: 'p.k' }, { op: 'merge', keepConceptId: 'x', mergeConceptId: 'z' }], { step: 3 });
  assert.equal(restructured.relations.length, 0, 'a relation that would connect a concept to itself is dropped');
});

test('split moves named instances into new children under a new partition', () => {
  const { state } = applyOperations(null, [concept('f'), assign('m1', 'f'), assign('m2', 'f'), assign('m3', 'f')], { step: 1 });
  const { state: split, createdConceptIds } = applyOperations(state, [{ op: 'split', conceptId: 'f', partitionId: 'f.by-signal', lens: 'by input signal', children: [
    { id: 'f.detect', label: 'Detect', operator: 'act on a sensed change', instanceSubjectNodeIds: ['m1'] },
    { id: 'f.route', label: 'Route', operator: 'send ownership along a path', instanceSubjectNodeIds: ['m2'] },
  ] }], { step: 2 });
  assert.deepEqual(createdConceptIds, ['f.detect', 'f.route']);
  assert.deepEqual(split.instances.map((item) => `${item.subjectNodeId}:${item.conceptId}`), ['m1:f.detect', 'm2:f.route', 'm3:f']);
  assert.throws(() => applyOperations(state, [{ op: 'split', conceptId: 'f', partitionId: 'f.k', lens: 'l', children: [
    { id: 'a', label: 'A', operator: 'o', instanceSubjectNodeIds: ['m9'] }, { id: 'b', label: 'B', operator: 'o' }] }], { step: 2 }), /not an instance of f/);
  assert.throws(() => applyOperations(state, [assign('m4', 'f')], { step: 2, subjectExists: () => false }), /not a record of this ontology's kind/);
});

test('the Meaning Model fragment exports partitions as specialization relations, never as abstract cuts', () => {
  const { state } = applyOperations(null, [
    { op: 'add_concept', concept: { id: 'p', label: 'Parent', operator: 'op', roles: [{ id: 'giver', description: 'who releases the claim' }] } },
    concept('x'), concept('y'), concept('gone'), partition('p.k', 'p', ['x', 'y']),
    { op: 'add_relation', relation: { id: 's', kind: 'specialization', sourceConceptId: 'x', targetConceptId: 'gone' } },
    { op: 'merge', keepConceptId: 'x', mergeConceptId: 'gone' },
  ], { step: 0 });
  const fragment = meaningModelFragment(state, { ontology: 'mechanisms', searchRootId: 'search', provenance: ['test'] });
  assert.deepEqual(fragment.concepts.map((item) => item.id), ['alien.search.mechanisms.p', 'alien.search.mechanisms.x', 'alien.search.mechanisms.y']);
  assert.deepEqual(fragment.concepts[0].state_schema, { giver: 'who releases the claim' });
  assert.equal(fragment.concepts[0].differentia[0], 'Operator: op');
  assert.deepEqual(fragment.abstract_cuts, [], 'abstract cuts are reserved for expressive decompositions');
  assert.deepEqual(fragment.abstract_relations.map((item) => `${item.kind}:${item.source_concept_id.split('.').pop()}>${item.target_concept_id.split('.').pop()}`),
    ['specialization:p>x', 'specialization:p>y'], 'the partition becomes specializations; the self-loop left by the merge was dropped');
  assert.equal(fragment.abstract_relations[0].label, null, 'the engine admits labels only on kind other');
  assert.match(fragment.abstract_relations[0].provenance.at(-1), /^partition p\.k, lens: by what moves/);
  assert.ok(fragment.concepts[1].differentia.includes('Distinguished within Parent by: by what moves'), 'the lens is a differentia of each child');
});

test('fit is categorical, and states stored with cuts and numeric fit read as partitions', () => {
  assert.throws(() => applyOperations(null, [concept('a'), { op: 'assign_instance', subjectNodeId: 'm1', conceptId: 'a', fit: 0.8 }], { step: 0 }), /expected/iu);
  const { state } = applyOperations(null, [concept('a'), { op: 'assign_instance', subjectNodeId: 'm1', conceptId: 'a', fit: 'partial' }], { step: 0 });
  assert.equal(state.instances[0].fit, 'partial');
  const legacy = normalizeOntology({ concepts: [], cuts: [{ id: 'k', parentConceptId: 'p', childConceptIds: ['x', 'y'], lens: 'l', query: null }], relations: [],
    instances: [{ subjectNodeId: 'm', conceptId: 'x', relation: 'instance', fit: 0.4, assignedAt: 1 }] });
  assert.equal(legacy.partitions.length, 1);
  assert.equal(legacy.cuts, undefined);
  assert.equal(legacy.instances[0].fit, null, 'a numeric fit stored earlier is dropped rather than reinterpreted');
});

test('graded membership is a Cut over active concepts with a remainder, replaced on set and folded on merge', () => {
  const membership = (shares, remainder) => ({ op: 'set_membership', subjectNodeId: 'm1', question: 'How does the candidate\'s operator divide among the families it draws on?',
    unit: 'one unit of the primary operator', shares, remainder });
  const base = [concept('a'), concept('b'), concept('c'), assign('m1', 'a')];
  const { state } = applyOperations(null, [...base, membership([{ conceptId: 'a', share: 0.5 }, { conceptId: 'b', share: 0.3 }], 0.2)], { step: 4 });
  assert.equal(state.memberships.length, 1);
  assert.deepEqual(state.memberships[0].shares, [{ conceptId: 'a', share: 0.5 }, { conceptId: 'b', share: 0.3 }]);
  assert.match(renderOntologyTree(state), /Graded membership \(Cuts\):\n- m1: a 0\.5, b 0\.3, remainder 0\.2/);
  assert.throws(() => applyOperations(null, [...base, membership([{ conceptId: 'a', share: 0.5 }, { conceptId: 'b', share: 0.3 }], 0.3)], { step: 4 }), /sum to 1/);
  assert.throws(() => applyOperations(null, [...base, membership([{ conceptId: 'a', share: 0.5 }, { conceptId: 'a', share: 0.3 }], 0.2)], { step: 4 }), /two distinct concepts/);
  assert.throws(() => applyOperations(null, [...base, membership([{ conceptId: 'a', share: 0.5 }, { conceptId: 'nope', share: 0.3 }], 0.2)], { step: 4 }), /unknown concept nope/);
  assert.throws(() => applyOperations(null, [...base, membership([{ conceptId: 'a', share: 0.8 }, { conceptId: 'b', share: 0.1 }], 0.1)], { step: 4, subjectExists: () => false }),
    /not a record of this ontology's kind/);
  const replaced = applyOperations(state, [membership([{ conceptId: 'b', share: 0.6 }, { conceptId: 'c', share: 0.3 }], 0.1)], { step: 5 }).state;
  assert.equal(replaced.memberships.length, 1, 'a new membership for the same subject replaces the old one');
  assert.deepEqual(replaced.memberships[0].shares.map((item) => item.conceptId), ['b', 'c']);
  assert.throws(() => applyOperations(replaced, [{ op: 'merge', keepConceptId: 'b', mergeConceptId: 'c' }], { step: 6 }), /two distinct concepts/,
    'a merge that would leave a membership over one concept is refused, as a partition left with one child is');
  assert.equal(applyOperations(replaced, [{ op: 'clear_membership', subjectNodeId: 'm1' }, { op: 'merge', keepConceptId: 'b', mergeConceptId: 'c' }], { step: 6 }).state.memberships.length, 0);
  const three = applyOperations(null, [...base, membership([{ conceptId: 'a', share: 0.4 }, { conceptId: 'b', share: 0.3 }, { conceptId: 'c', share: 0.2 }], 0.1)], { step: 4 }).state;
  const folded = applyOperations(three, [{ op: 'merge', keepConceptId: 'b', mergeConceptId: 'c' }], { step: 6 }).state;
  assert.deepEqual(folded.memberships[0].shares.map((item) => [item.conceptId, Number(item.share.toFixed(10))]), [['a', 0.4], ['b', 0.5]], 'the merged share joins the kept concept');
  const cleared = applyOperations(state, [{ op: 'clear_membership', subjectNodeId: 'm1' }], { step: 7 }).state;
  assert.equal(cleared.memberships.length, 0);
  assert.throws(() => applyOperations(cleared, [{ op: 'clear_membership', subjectNodeId: 'm1' }], { step: 8 }), /no graded membership/);
  assert.deepEqual(normalizeOntology({ concepts: [], partitions: [], relations: [], instances: [] }).memberships, [], 'states stored before graded membership read as none');
});
