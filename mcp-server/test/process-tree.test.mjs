// The tree of processes read whole (process-tree.mjs): its order, levels and reach, the line above it, the whole-tree
// review the values report asks for and when it comes back, and the review recorded with life_breadth_record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keptWholeLeaves, processTree, treeHeadline, treeReview, treeReviewLine, valueReach, TREE_CANDIDATE } from '../src/process-tree.mjs';
import { outlineModel } from '../src/construction-record.mjs';
import { breadthAnswers } from '../src/breadth.mjs';
import { breadthChange } from '../src/breadth-record.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { valuesReport } from '../src/values-record.mjs';

const scalar = (id) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1e12 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'u',
  provenance: ['sketch: fixture'], support: ['s'], scale: { label: id.toUpperCase() } });
const series = (processId, times) => ({ id: `series.${processId}`, holder: 'modeler', process_id: processId, provenance: ['x'],
  points: times.map((time) => ({ time, value: 1, tag: 'sketch', lower: 0.5, upper: 1.5 })) });
// A world: a root with two branches, one opened two levels further.
const ids = ['world', 'earth', 'people', 'people.africa', 'people.asia', 'people.asia.east', 'people.asia.south', 'earth.sea', 'earth.forest'];
const edges = [['world', 'earth'], ['world', 'people'], ['people', 'people.africa'], ['people', 'people.asia'], ['people.asia', 'people.asia.east'],
  ['people.asia', 'people.asia.south'], ['earth', 'earth.sea'], ['earth', 'earth.forest']];
const model = ({ processes = ids, decomposition = edges, revision = 10, concepts = [] } = {}) => ({ schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year',
  revision: { number: revision, previous_model_hash: null, reason: 'r', provenance: ['p'] }, processes: processes.map(scalar),
  decomposition: decomposition.map(([parent, child]) => ({ parent, child })), dependencies: [], laws: [], initial_claims: [],
  value_series: processes.map((id) => series(id, [-10000, 0, 2000])),
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts, referents: [], events: [], event_relations: [], normalized_cuts: [], abstract_cuts: [] } });

test('the tree lists every process under the one it was carved from, level by level, and loses none to a cycle or a second parent', () => {
  const tree = processTree(model());
  assert.deepEqual(tree.order, ['world', 'earth', 'earth.sea', 'earth.forest', 'people', 'people.africa', 'people.asia', 'people.asia.east', 'people.asia.south']);
  assert.deepEqual(tree.levels, [1, 2, 4, 2]);
  assert.equal(tree.undivided, 5);
  assert.equal(treeHeadline(tree, 2), '9 processes in 4 levels (1, 2, 4, 2 from the top); 5 have no parts, 2 of them kept whole by a recorded decision.');
  // A second parent names the part as shared instead of expanding it again, and a cycle is broken; every process is
  // still listed once.
  const odd = processTree(model({ decomposition: [...edges, ['earth', 'people.africa'], ['people.asia.east', 'people.asia']] }));
  assert.equal(odd.order.length, ids.length);
  assert.equal(new Set(odd.order).size, ids.length);
  assert.deepEqual(odd.shared.get('earth'), ['people.africa']);
  assert.deepEqual(odd.parts.get('earth'), ['earth.sea', 'earth.forest', 'people.africa']);
  const looped = processTree(model({ processes: ['a', 'b'], decomposition: [['a', 'b'], ['b', 'a']] }));
  assert.deepEqual([...looped.order].sort(), ['a', 'b']);
});

test('the reach of each process counts its values across holders and their first and last date', () => {
  const m = model();
  m.value_series.push({ ...series('earth', [2025]), id: 'series.earth.other', holder: 'other' });
  assert.deepEqual(valueReach(m).get('earth'), { values: 4, from: -10000, to: 2025 });
});

test('the review is due once the tree is large enough to read, and again when it grows by a quarter or fifty revisions pass', () => {
  assert.equal(treeReview(model({ processes: ids.slice(0, 5), decomposition: edges.slice(0, 3) })).due, false, 'a small tree is read whole by every outline anyway');
  const unread = treeReview(model());
  assert.deepEqual([unread.due, unread.why, unread.processes, unread.last], [true, 'unread', 9, null]);
  const line = treeReviewLine(unread);
  assert.match(line, /^Whole-tree review: The tree of processes, 9 processes in 4 levels, has not been read whole yet\. Read it whole \(life_model_outline with sections \["processes"\] and detail "skeleton"\)/u);
  assert.match(line, /record the review with life_breadth_record \(candidate "tree:whole"\)/u);

  // Recorded as not_modeled: the review is not due until the tree grows or the construction moves on.
  const { change } = breadthChange(model(), { requestId: 'r', previousModelHash: 'a'.repeat(64), holder: 'modeler', tag: 'exploring', candidate: TREE_CANDIDATE,
    answer: 'not_modeled', concept: { label: 'The whole tree, read at nine processes' }, reason: 'Every region and branch has its siblings; nothing more is worth following now.' });
  const read = applyModelChange(model(), 'a'.repeat(64), change).successor;
  const answer = breadthAnswers(read).get(TREE_CANDIDATE);
  assert.deepEqual([answer.answer, answer.signals], ['not_modeled', { processes: 9, revision: 10 }]);
  assert.equal(treeReview(read).due, false);
  assert.equal(treeReviewLine(treeReview(read)), null);

  const grown = structuredClone(read);
  for (const id of ['earth.ice', 'people.europe', 'people.americas']) { grown.processes.push(scalar(id)); grown.decomposition.push({ parent: id.split('.')[0], child: id }); }
  assert.deepEqual([treeReview(grown).due, treeReview(grown).why], [true, 'grown'], '9 to 12 is a quarter and at least three');
  assert.match(treeReviewLine(treeReview(grown)), /has grown from 9 to 12 since it was last read whole/u);
  const later = structuredClone(read); later.revision.number = 60;
  assert.deepEqual([treeReview(later).due, treeReview(later).why], [true, 'revisions']);
  assert.match(treeReviewLine(treeReview(later)), /^Whole-tree review: 50 revisions have passed since the tree of processes, now 9 processes in 4 levels, was last read whole\./u);
});

test('a whole-tree review is answered modeled with a process it opened, or not_modeled; linked and a missing process are refused', () => {
  const base = { requestId: 'r', previousModelHash: 'a'.repeat(64), holder: 'modeler', tag: 'exploring', candidate: TREE_CANDIDATE, concept: { label: 'The whole tree' }, reason: 'Read whole.' };
  assert.throws(() => breadthChange(model(), { ...base, answer: 'linked' }), /linked answers a group of Events\. A whole-tree review is answered modeled/u);
  assert.throws(() => breadthChange(model(), { ...base, answer: 'modeled' }), /modeled says the review opened a process: name that process in process/u);
  assert.throws(() => breadthChange(model(), { ...base, answer: 'modeled', process: 'people.europe' }), /which the model does not have/u);
  const { change } = breadthChange(model(), { ...base, answer: 'modeled', process: 'earth.forest' });
  const concept = change.upsert.concepts[0];
  assert.equal(concept.id, 'breadth.tree.whole');
  assert.ok(concept.provenance.includes('breadth-signals:processes=9;revision=10'), 'the size of the tree it read');
  assert.ok(concept.provenance.includes('followed-by:earth.forest') || concept.provenance.some((line) => line.endsWith('earth.forest')), 'the process it opened');
});

test('the values report carries the review: its line when there is no earlier report and every third revision, and the size of the tree in its data', () => {
  const report = valuesReport(model());
  assert.deepEqual(report.tree, { processes: 9, levels: [1, 2, 4, 2], due: true, why: 'unread' });
  assert.ok(report.next.some((line) => line.startsWith('Whole-tree review:')), 'shown without a previous model to compare with');
  const quiet = valuesReport(model({ revision: 11 }), { previousTop: null, previousBreadth: null });
  assert.ok(!quiet.next.some((line) => line.startsWith('Whole-tree review:')), 'not repeated on every write');
  const third = valuesReport(model({ revision: 12 }), { previousTop: null, previousBreadth: null });
  assert.ok(third.next.some((line) => line.startsWith('Whole-tree review:')), 'shown again every third revision while it is due');
});

// The outline reads a model by hash alone, so these tests hand it the model directly.
const serviceFor = (m) => ({ inspectModel: async () => ({ model: structuredClone(m) }) });
const outlineOf = (m, detail = 'skeleton') => outlineModel(serviceFor(m), { modelHash: 'a'.repeat(64), sections: ['processes'], detail, maxChars: 400_000 });

test('a tree of any depth is read: a chain of 10,000 processes is walked, reported and outlined without running out of stack', async () => {
  const chainIds = Array.from({ length: 10_000 }, (_, index) => `p${index}`);
  const chain = model({ processes: chainIds, decomposition: chainIds.slice(1).map((id, index) => [chainIds[index], id]) });
  const tree = processTree(chain);
  assert.equal(tree.order.length, 10_000);
  assert.equal(tree.depth.get('p9999'), 9_999);
  assert.equal(tree.undivided, 1);
  assert.equal(treeReview(chain).processes, 10_000);
  assert.doesNotThrow(() => valuesReport(chain));
  const outline = await outlineOf(chain);
  assert.match(outline.text, /10000 processes in 10000 levels/u);
});

test('a part with two parents is shown in full under the first and named as shared under the other, and the counts stay true', async () => {
  const shared = model({ processes: ['a', 'b', 'shared'], decomposition: [['a', 'shared'], ['b', 'shared']] });
  const tree = processTree(shared);
  assert.deepEqual(tree.order, ['a', 'shared', 'b']);
  assert.deepEqual([tree.parts.get('a'), tree.parts.get('b'), tree.shared.get('b')], [['shared'], ['shared'], ['shared']]);
  assert.equal(tree.undivided, 1, 'only the shared part has no parts');
  const { text } = await outlineOf(shared);
  assert.match(text, /3 processes in 2 levels \(2, 1 from the top\); 1 has no parts\./u);
  assert.match(text, /^- a \(u\): A · 1 part\n  - shared \(u\): SHARED$/mu);
  assert.match(text, /^- b \(u\): B · 1 part\n  - shared: shared part, shown under a$/mu);
  const full = await outlineOf(shared, 'full');
  assert.match(full.text, /^  - shared: shared part, shown under a$/mu);
});

test('a kept-whole decision about a process removed since is not counted', () => {
  const tree = processTree(model({ processes: ['a', 'b'], decomposition: [['a', 'b']] }));
  const kept = new Map([['b', {}], ['gone', {}], ['a', {}]]);
  assert.equal(keptWholeLeaves(tree, kept), 1, 'b is kept whole; gone is not in the tree and a has a part');
  assert.equal(treeHeadline(tree, keptWholeLeaves(tree, kept)), '2 processes in 2 levels (1, 1 from the top); 1 has no parts, 1 of them kept whole by a recorded decision.');
});

test('a whole-tree answer records the tree the report counts: processes hidden by scope are left out', () => {
  const withHidden = model();
  for (const id of ['hidden.one', 'hidden.two', 'hidden.three']) withHidden.processes.push({ ...scalar(id), access_scopes: ['secret'] });
  const { change } = breadthChange(withHidden, { requestId: 'r', previousModelHash: 'a'.repeat(64), holder: 'modeler', tag: 'exploring', candidate: TREE_CANDIDATE,
    answer: 'not_modeled', concept: { label: 'The whole tree' }, reason: 'Read whole.' });
  assert.ok(change.upsert.concepts[0].provenance.includes('breadth-signals:processes=9;revision=10'), 'nine public processes, not twelve');
});

test('shared parts are named where they were filed, between the parts expanded there', async () => {
  const mixed = model({ processes: ['a', 'b', 'x', 's', 'y'], decomposition: [['a', 's'], ['b', 'x'], ['b', 's'], ['b', 'y']] });
  for (const detail of ['skeleton', 'full']) {
    const { text } = await outlineOf(mixed, detail);
    const under = text.split('\n').slice(text.split('\n').findIndex((row) => row.startsWith('- b ')) + 1, undefined).filter((row) => row.startsWith('  - ')).map((row) => row.slice(4).split(/[ :]/u)[0]);
    assert.deepEqual(under.slice(0, 3), ['x', 's', 'y'], `${detail}: b's parts in the order they were filed`);
    assert.match(text, /^  - s: shared part, shown under a$/mu);
  }
});

test('any number of shared parts is listed without running out of stack', async () => {
  const leaves = Array.from({ length: 150_000 }, (_, index) => `l${index}`);
  const wide = { schema: 'life-sim-rust-model/v1', id: 'w', time_unit: 'year', revision: { number: 1, previous_model_hash: null, reason: 'r', provenance: ['p'] },
    processes: ['a', 'b', ...leaves].map(scalar), decomposition: leaves.flatMap((leaf) => [{ parent: 'a', child: leaf }, { parent: 'b', child: leaf }]),
    dependencies: [], laws: [], initial_claims: [], value_series: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents: [], events: [], event_relations: [], normalized_cuts: [], abstract_cuts: [] } };
  for (const detail of ['skeleton', 'full']) {
    const outline = await outlineModel(serviceFor(wide), { modelHash: 'a'.repeat(64), sections: ['processes'], detail, maxChars: 2_000 });
    assert.equal(outline.truncated, true, `${detail}: listed, then cut to the size asked for`);
  }
});

test('two edges stay apart whatever characters their ids hold', () => {
  const nul = String.fromCharCode(0);
  const tree = processTree(model({ processes: ['a', `b${nul}c`, `a${nul}b`, 'c'], decomposition: [['a', `b${nul}c`], [`a${nul}b`, 'c']] }));
  assert.deepEqual([tree.parts.get('a'), tree.parts.get(`a${nul}b`)], [[`b${nul}c`], ['c']]);
  assert.deepEqual([tree.depth.get('c'), tree.levels, tree.undivided], [1, [2, 2], 2]);
});
