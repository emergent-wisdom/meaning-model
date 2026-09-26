import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRevision } from '../src/revision-check.mjs';
import { eventTextSignature } from '../src/cut-shares.mjs';

// It is always possible to revise, and a revision keeps the whole consistent: it names everything that depended on
// what it changed.
const at = (start, end = start + 0.1) => ({ start, end });
const before = { meaning_model: {
  referents: [{ id: 'person.ana', boundary: 'Ana Berg', lifecycle_event_id: 'ana.life' }],
  events: [{ id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
    { id: 'ana.choice', boundary: 'Ana takes the night shifts', description: 'Every night in March.', interval: at(2005), participants: { subject: 'person.ana' } },
    { id: 'ana.after', boundary: 'Ana sleeps through April', interval: at(2005.3), participants: { subject: 'person.ana' } }],
  event_relations: [{ id: 'r1', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.choice' }, { id: 'r2', kind: 'causes', source_event_id: 'ana.choice', target_event_id: 'ana.after' }],
  normalized_cuts: [
    { id: 'cut.choice', parent_event_id: 'ana.choice', unit: 'decision', question: 'Does she?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
    { id: 'cut.choice.in.yes', parent_event_id: 'ana.choice', unit: 'why', question: 'Why?', conditioning: { cut_id: 'cut.choice', answer_key: 'yes' }, answers: [{ key: 'money', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] },
  ] } };
before.meaning_model.normalized_cuts.push({ id: 'lens.x.ana.choice', parent_event_id: 'ana.choice', unit: 'u', question: 'q', answers: [{ key: 'a', weight: 1 }, { key: 'remainder', weight: 0 }], provenance: ['estimator:t', `event-text:${eventTextSignature(before.meaning_model.events[1])}`] });
const after = structuredClone(before);
after.meaning_model.events[1].description = 'Every night in March, and she tells no one why.';
after.meaning_model.normalized_cuts[0].answers = [{ key: 'yes', weight: 0.4 }, { key: 'remainder', weight: 0.6 }];
const view = { graph: { source: { model_hash: 'b'.repeat(64) } },
  nodes: [{ id: 'draw.1', node_type: 'direction_draw', text: JSON.stringify({ cutId: 'cut.choice', realized: 'yes' }) }, { id: 'scene.1', node_type: 'scene', render: 'include', text: 'She signs up.' }],
  edges: [{ source: { kind: 'node', node_id: 'scene.1' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'ana.choice' }, family: 'grounding', relation: 'renders' }] };
const service = { queryNarrativeGraph: async () => view, inspectModel: async ({ modelHash }) => ({ model: modelHash === 'a'.repeat(64) ? before : after }) };

test('a revision names what it changed and everything that depended on it', async () => {
  const result = await checkRevision(service, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64) });
  assert.deepEqual(result.changed.rewritten, ['ana.choice']); assert.deepEqual(result.changed.reweighted, ['cut.choice']);
  assert.deepEqual(result.conditioned.map((item) => item.cutId), ['cut.choice.in.yes']);
  assert.deepEqual(result.draws.map((item) => item.cutId), ['cut.choice']); assert.match(result.draws[0].why, /keep the draw/u);
  assert.deepEqual(result.readings.map((item) => item.cutId), ['lens.x.ana.choice']);
  assert.deepEqual(result.later.map((item) => item.eventId), ['ana.after']);
  assert.deepEqual(result.passages.map((item) => item.nodeId), ['scene.1']);
  assert.equal(result.toCheck, 5); assert.equal(result.graphMutation, false);
});

test('a revision that changed nothing leaves nothing to check', async () => {
  const same = { ...service, inspectModel: async () => ({ model: before }) };
  const result = await checkRevision(same, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64), toModelHash: 'a'.repeat(64) });
  assert.equal(result.toCheck, 0); assert.match(result.nextStep, /No affected declared dependencies/u);
  assert.equal(result.unlinkedPassages, undefined);
});

test('a passage without declared depiction links is reported as unchecked', async () => {
  const unlinked = { ...view, nodes: [...view.nodes, { id: 'scene.2', node_type: 'scene', render: 'include', text: 'She walks home.' }] };
  const result = await checkRevision({ ...service, queryNarrativeGraph: async () => unlinked }, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64) });
  assert.deepEqual(result.unlinkedPassages.nodeIds, ['scene.2']); assert.match(result.nextStep, /1 passage has no declared renders link to an Event or Cut, so it was not checked/u);
});

const passage = (id) => ({ id, node_type: 'storytelling.passage', render: 'include', text: 'Ana weighs the choice.' });
const anchor = (nodeId, anchorId, { kind = 'event', family = 'grounding', relation = 'renders' } = {}) => ({
  source: { kind: 'node', node_id: nodeId }, target: { kind: 'anchor', anchor_kind: kind, anchor_id: anchorId }, family, relation,
});
async function checkGraph(nodes, edges, modelAfter = after, modelBefore = before) {
  return checkRevision({
    queryNarrativeGraph: async () => ({ graph: view.graph, nodes, edges }),
    inspectModel: async ({ modelHash }) => ({ model: modelHash === 'a'.repeat(64) ? modelBefore : modelAfter }),
  }, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64) });
}

test('a heading-only document root is not an unlinked passage; prose on roots remains unchecked', async () => {
  const root = (id, text) => ({ id, node_type: 'story', role: 'document_root', render: 'include', text });
  const result = await checkGraph([
    root('title', '# Twelve Words'),
    root('headings', '\n# Twelve Words\r\n\n## Part One\n'),
    root('root-prose', '# Twelve Words\n\nAna checked the latch again.'),
    root('plain-root-prose', 'Ana wondered whether anyone was home.'),
    root('literal-hash', '#The mark on the door was fresh.'),
    { ...passage('passage-heading'), role: 'story_passage', text: '# Arrival' },
    { ...passage('reflection'), text: 'She wondered whether checking was another way to avoid trust.' },
  ], []);
  assert.deepEqual(result.unlinkedPassages.nodeIds, ['root-prose', 'plain-root-prose', 'literal-hash', 'passage-heading', 'reflection']);
  assert.equal(result.unlinkedPassages.count, 5);
  const onlyTitle = await checkGraph([root('title', '# Twelve Words')], []);
  assert.equal(onlyTitle.unlinkedPassages, undefined);
  assert.doesNotMatch(onlyTitle.nextStep, /passage.*no declared renders/);
});

test('about-only prose stays unchecked while an about-note is separately flagged', async () => {
  const modelAfter = structuredClone(before);
  modelAfter.meaning_model.events[0].description = 'The life is newly described.';
  const result = await checkGraph([
    passage('about-only'),
    { id: 'note', node_type: 'understanding.explanation', render: 'exclude', text: 'An account of this life.' },
  ], [
    anchor('about-only', 'ana.life', { family: 'semantic', relation: 'about' }),
    anchor('note', 'ana.life', { family: 'semantic', relation: 'about' }),
  ], modelAfter);
  assert.deepEqual(result.passages, []);
  assert.deepEqual(result.unlinkedPassages.nodeIds, ['about-only']);
  assert.deepEqual(result.notes.map(({ nodeId, records }) => ({ nodeId, records })), [{ nodeId: 'note', records: ['ana.life'] }]);
  assert.equal(result.toCheck, 1, 'an affected note is not a clean check');
  assert.match(result.nextStep, /review affected notes/);
});

test('unrelated anchors, reverse links and wrong families do not declare a depiction', async () => {
  const ids = ['process', 'referent', 'cut-about', 'wrong-family', 'provenance', 'node-target', 'reverse'];
  const reverse = anchor('reverse', 'ana.choice');
  const result = await checkGraph(ids.map(passage), [
    anchor('process', 'process.sleep', { kind: 'process' }),
    anchor('referent', 'person.ana', { kind: 'referent' }),
    anchor('cut-about', 'cut.choice', { kind: 'normalized_cut', family: 'semantic', relation: 'about' }),
    anchor('wrong-family', 'ana.choice', { family: 'semantic' }),
    anchor('provenance', 'ana.choice', { family: 'provenance', relation: 'derived_from' }),
    { ...anchor('node-target', 'ana.choice'), target: { kind: 'node', node_id: 'about-only' } },
    { ...reverse, source: reverse.target, target: reverse.source },
  ]);
  assert.deepEqual(result.passages, []);
  assert.deepEqual(result.unlinkedPassages.nodeIds, ids);
  assert.deepEqual(result.notes, []);
});

test('declared dependencies alone determine which linked passages require review', async () => {
  const result = await checkGraph(['changed', 'unchanged', 'cut'].map(passage), [
    anchor('changed', 'ana.choice'), anchor('changed', 'ana.choice'),
    anchor('unchanged', 'ana.life'),
    anchor('unchanged', 'ana.choice', { family: 'semantic', relation: 'about' }),
    anchor('cut', 'cut.choice', { kind: 'normalized_cut' }),
  ]);
  assert.deepEqual(result.passages.map(({ nodeId, records }) => ({ nodeId, records })), [
    { nodeId: 'changed', records: ['ana.choice'] }, { nodeId: 'cut', records: ['cut.choice'] },
  ]);
  assert.equal(result.unlinkedPassages, undefined);
  assert.match(result.notChecked, /whether those links cover everything it depicts/);
});

test('a renders Cut dependency remains affected when the Cut is removed or moved', async () => {
  for (const change of ['removed', 'moved']) {
    const modelAfter = structuredClone(before);
    if (change === 'removed') modelAfter.meaning_model.normalized_cuts = [];
    else modelAfter.meaning_model.normalized_cuts[0].parent_event_id = 'ana.after';
    const result = await checkGraph([passage('cut')], [anchor('cut', 'cut.choice', { kind: 'normalized_cut' })], modelAfter);
    assert.deepEqual(result.passages.map(({ nodeId, records }) => ({ nodeId, records })), [{ nodeId: 'cut', records: ['cut.choice'] }], change);
    assert.equal(result.unlinkedPassages, undefined, change);
    assert.ok(result.changed[change === 'removed' ? 'removedCuts' : 'moved'].includes('cut.choice'), change);
  }
});
