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

test('unchanged shares with revised Cut definitions still reach dependent scenes, notes, children and draws', async () => {
  const base = structuredClone(before);
  const original = base.meaning_model.normalized_cuts[0];
  original.answers[0].meaning = 'Accept the offered night shift.';
  original.answers[1].meaning = 'Continuations not yet distinguished.';
  for (const [label, edit] of [
    ['answer', (cut) => { cut.answers[0].meaning = 'Accept only the daytime shift.'; }],
    ['remainder', (cut) => { cut.answers[1].meaning = 'Decline to state a preference.'; }],
    ['question', (cut) => { cut.question = 'What does she expect, rather than choose?'; }],
    ['unit', (cut) => { cut.unit = 'forecast probability'; }],
    ['conditioning', (cut) => { cut.conditioning = { cut_id: 'earlier.choice', answer_key: 'stay' }; }],
  ]) {
    const next = structuredClone(base); edit(next.meaning_model.normalized_cuts[0]);
    const result = await checkGraph([
      passage('scene'),
      { id: 'note', node_type: 'understanding.hypothesis', render: 'exclude', text: 'Her night-shift choice explains the later exhaustion.' },
      { id: 'draw', node_type: 'direction_draw', render: 'exclude', text: JSON.stringify({ cutId: original.id, question: original.question,
        unit: original.unit, conditioning: original.conditioning ?? null, answers: original.answers, realized: 'yes' }) },
    ], [anchor('scene', 'ana.choice'), anchor('note', original.id, { kind: 'normalized_cut', family: 'semantic', relation: 'about' })], next, base);
    assert.deepEqual(result.changed.reweighted, [], label);
    assert.deepEqual(result.changed.redefined, [original.id], label);
    assert.deepEqual(result.changed.stateChanged, [{ eventId: 'ana.choice', by: ['cut:cut.choice'] }], label);
    assert.deepEqual(result.passages.map(({ nodeId }) => nodeId), ['scene'], label);
    assert.deepEqual(result.notes.map(({ nodeId }) => nodeId), ['note'], label);
    assert.deepEqual(result.later.map(({ eventId }) => eventId), ['ana.after'], label);
    assert.deepEqual(result.conditioned.map(({ cutId }) => cutId), ['cut.choice.in.yes'], label);
    assert.match(result.conditioned[0].why, /definition or Event/);
    assert.match(result.draws[0].why, /definition changed/);
    assert.doesNotMatch(result.draws[0].why, /weights that have changed/);
  }
});

test('answer order, absent optional definitions and provenance do not redefine a Cut', async () => {
  const next = structuredClone(before);
  const cut = next.meaning_model.normalized_cuts[0];
  cut.answers.reverse();
  cut.answers.forEach((answer) => { answer.meaning = null; });
  cut.conditioning = null;
  cut.provenance = ['A new citation, with no change to the declared comparison.'];
  const result = await checkGraph([], [], next, before);
  assert.deepEqual(result.changed.redefined, []);
  assert.deepEqual(result.changed.reweighted, []);
  assert.equal(result.toCheck, 0);
});

test('restoring a recorded draw definition is distinguishable from a legacy draw with unknown definitions', async () => {
  const revised = structuredClone(before);
  revised.meaning_model.normalized_cuts[0].answers[0].meaning = 'Accept the daytime shift.';
  const restored = structuredClone(before);
  const cut = restored.meaning_model.normalized_cuts[0];
  cut.answers[0].meaning = 'Accept the night shift.';
  const draw = { cutId: cut.id, question: cut.question, unit: cut.unit, conditioning: null, answers: cut.answers, realized: 'yes' };
  const check = (data) => checkGraph([{ id: 'draw', node_type: 'direction_draw', text: JSON.stringify(data) }], [], restored, revised);
  assert.deepEqual((await check(draw)).draws, [], 'the retained draw already used the restored meanings');
  const legacy = structuredClone(draw);
  delete legacy.conditioning;
  legacy.answers.forEach((answer) => { delete answer.meaning; });
  assert.match((await check(legacy)).draws[0].why, /does not establish the same meaning/);
});

test('an older stale reading remains visible even when the most recent revision did not rewrite its Event', async () => {
  const same = { ...service, inspectModel: async () => ({ model: after }) };
  const result = await checkRevision(same, { graphHash: 'c'.repeat(64), fromModelHash: 'b'.repeat(64), toModelHash: 'b'.repeat(64) });
  assert.deepEqual(result.changed.rewritten, []);
  assert.deepEqual(result.readings.map((reading) => reading.cutId), ['lens.x.ana.choice']);
  assert.equal(result.readings[0].changedInRevision, false);
  assert.match(result.readings[0].why, /not been reassessed/);
});

test('a passage without declared depiction links is reported as unchecked', async () => {
  const unlinked = { ...view, nodes: [...view.nodes, { id: 'scene.2', node_type: 'scene', render: 'include', text: 'She walks home.' }] };
  const result = await checkRevision({ ...service, queryNarrativeGraph: async () => unlinked }, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64) });
  assert.deepEqual(result.unlinkedPassages.nodeIds, ['scene.2']); assert.match(result.nextStep, /1 passage needs an Event\/renders declaration or a current per-passage no-link reason/u);
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

test('concept, abstract-Cut and relation revisions explicitly require manual review of linked notes', async () => {
  const base = structuredClone(before);
  base.meaning_model.concepts = [
    { id: 'carry-forward', boundary: 'A named steward can continue the work.' },
    { id: 'steward', boundary: 'An assigned next volunteer.' },
  ];
  base.meaning_model.abstract_cuts = [{ id: 'opening', parent_concept_id: 'carry-forward', child_concept_ids: ['steward'], lens: 'Continuation conditions' }];
  const next = structuredClone(base);
  next.meaning_model.concepts[0].boundary = 'Continuation requires feasible willing acceptance.';
  next.meaning_model.concepts[1].withdrawn = { reason: 'Assignment alone does not establish consent or availability.' };
  next.meaning_model.abstract_cuts[0].withdrawn = { reason: 'The opening omitted feasible acceptance.' };
  next.meaning_model.event_relations[1].kind = 'enables';
  const notes = ['definition', 'withdrawal', 'opening', 'relation'].map((id) => ({ id, node_type: 'understanding.hypothesis', render: 'exclude', text: 'An earlier account about this record.' }));
  const result = await checkGraph(notes, [
    anchor('definition', 'carry-forward', { kind: 'concept', relation: 'about' }),
    anchor('withdrawal', 'steward', { kind: 'concept', relation: 'about' }),
    anchor('opening', 'opening', { kind: 'abstract_cut', relation: 'about' }),
    anchor('relation', 'r2', { kind: 'event_relation', relation: 'about' }),
  ], next, base);
  assert.equal(result.toCheck, 0);
  assert.deepEqual(result.notes, []);
  assert.ok(Object.values(result.changed).every((changes) => changes.length === 0));
  assert.match(result.notChecked, /Concept definition or withdrawal changes, abstract-Cut changes and relation changes are not compared/u);
  assert.match(result.notChecked, /inspect their linked notes and other dependents manually/u);
});

test('Event region and substrate edits flag declared prose and notes without invalidating text estimates or draws', async () => {
  for (const field of ['region', 'substrate']) for (const [from, to] of [[undefined, 'workshop'], ['workshop', 'office'], ['office', null]]) {
    const modelBefore = structuredClone(before), modelAfter = structuredClone(before);
    modelBefore.meaning_model.events[1][field] = from;
    modelAfter.meaning_model.events[1][field] = to;
    // An older stale signature remains outstanding, without attributing it to this placement edit.
    modelBefore.meaning_model.normalized_cuts.at(-1).provenance = ['estimator:t', 'event-text:older-text'];
    modelAfter.meaning_model.normalized_cuts.at(-1).provenance = ['estimator:t', 'event-text:older-text'];
    const result = await checkGraph([
      passage('scene'), passage('unrelated'),
      { id: 'note', node_type: 'understanding.explanation', render: 'exclude', text: 'The location bears on this choice.' },
      { id: 'draw', node_type: 'direction_draw', render: 'exclude', text: JSON.stringify({ cutId: 'cut.choice', realized: 'yes' }) },
    ], [anchor('scene', 'ana.choice'), anchor('unrelated', 'ana.life'),
      anchor('note', 'ana.choice', { family: 'semantic', relation: 'about' })], modelAfter, modelBefore);
    assert.deepEqual(result.changed.relocated, ['ana.choice'], `${field}: ${from} → ${to}`);
    assert.deepEqual(result.changed.rewritten, []);
    assert.deepEqual(result.changed.retimed, []);
    assert.deepEqual(result.changed.reweighted, []);
    assert.deepEqual(result.passages.map(({ nodeId, records }) => ({ nodeId, records })), [{ nodeId: 'scene', records: ['ana.choice'] }]);
    assert.deepEqual(result.notes.map(({ nodeId, records }) => ({ nodeId, records })), [{ nodeId: 'note', records: ['ana.choice'] }]);
    assert.deepEqual(result.later.map(({ eventId }) => eventId), ['ana.after']);
    assert.deepEqual(result.readings.map(({ cutId, changedInRevision }) => ({ cutId, changedInRevision })), [{ cutId: 'lens.x.ana.choice', changedInRevision: false }]);
    assert.deepEqual(result.draws, []);
    assert.deepEqual(result.conditioned, []);
    assert.equal(result.toCheck, 4);
    assert.equal(result.graphMutation, false);
  }
});

test('omitted and null placement fields are equivalent; new Events are not relocations', async () => {
  const modelAfter = structuredClone(before);
  modelAfter.meaning_model.events[1].region = null;
  modelAfter.meaning_model.events[1].substrate = null;
  modelAfter.meaning_model.events.push({ id: 'new.place', boundary: 'A new Event', region: 'workshop', substrate: 'stone' });
  const result = await checkGraph([passage('scene')], [anchor('scene', 'ana.choice')], modelAfter);
  assert.deepEqual(result.changed.relocated, []);
  assert.equal(result.toCheck, 0);
});

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
  assert.deepEqual(result.unlinkedPassages.nodeIds, ['cut'], 'A Cut dependency alone does not place a passage in world time.');
  assert.match(result.notChecked, /whether those links cover everything it depicts/);
});

test('a renders Cut dependency remains affected when the Cut is removed or moved', async () => {
  for (const change of ['removed', 'moved']) {
    const modelAfter = structuredClone(before);
    if (change === 'removed') modelAfter.meaning_model.normalized_cuts = [];
    else modelAfter.meaning_model.normalized_cuts[0].parent_event_id = 'ana.after';
    const result = await checkGraph([passage('cut')], [anchor('cut', 'cut.choice', { kind: 'normalized_cut' })], modelAfter);
    assert.deepEqual(result.passages.map(({ nodeId, records }) => ({ nodeId, records })), [{ nodeId: 'cut', records: ['cut.choice'] }], change);
    assert.deepEqual(result.unlinkedPassages.nodeIds, ['cut'], change);
    assert.ok(result.changed[change === 'removed' ? 'removedCuts' : 'moved'].includes('cut.choice'), change);
  }
});

// Found in the Book's revision 14: assessments about rewritten Events carried 27 untracked Cuts, and the check named none.
test('a Cut whose Event is about a changed Event is listed for review with its own text basis', async () => {
  const view = { id: 'ana.view', boundary: 'Ana weighs the night shifts', description: 'What she attends to before she signs.', interval: at(2005), participants: { subject: 'person.ana' } };
  const withAssessment = (model, provenance) => {
    const copy = structuredClone(model);
    copy.meaning_model.events.push(structuredClone(view));
    copy.meaning_model.event_relations.push({ id: 'r.view', kind: 'other', description: 'about: reference only, not participation', source_event_id: 'ana.view', target_event_id: 'ana.choice' });
    copy.meaning_model.normalized_cuts.push({ id: 'cut.view', parent_event_id: 'ana.view', unit: 'attention', question: 'What does she attend to?',
      answers: [{ key: 'money', weight: 0.5 }, { key: 'remainder', weight: 0.5 }], ...(provenance ? { provenance } : {}) });
    return copy;
  };
  const untracked = await checkGraph([], [], withAssessment(after), withAssessment(before));
  assert.deepEqual(untracked.assessments.map(({ cutId, eventId, about, textBasis }) => ({ cutId, eventId, about, textBasis })),
    [{ cutId: 'cut.view', eventId: 'ana.view', about: ['ana.choice'], textBasis: 'untracked' }]);
  assert.match(untracked.assessments[0].why, /still fit/u);
  assert.match(untracked.nextStep, /check assessments about changed Events/u);
  // A signed assessment whose own text is unchanged is still listed: its subject changed, not its carrier.
  const signed = [`event-text:${eventTextSignature(view)}`];
  const tracked = await checkGraph([], [], withAssessment(after, signed), withAssessment(before, signed));
  assert.deepEqual(tracked.assessments.map(({ cutId, textBasis }) => ({ cutId, textBasis })), [{ cutId: 'cut.view', textBasis: 'unchanged' }]);
  // Without a change to the Event it is about, nothing is listed.
  const unchanged = await checkGraph([], [], withAssessment(before), withAssessment(before));
  assert.deepEqual(unchanged.assessments, []);
});

// A recheck records what the judgment read; the record stays checkable on every later revision check.
test('recorded reads clear a rechecked assessment and flag it again when what it read changes', async () => {
  const view = { id: 'ana.view', boundary: 'Ana weighs the night shifts', description: 'What she attends to before she signs.', interval: at(2005), participants: { subject: 'person.ana' } };
  const withAssessment = (model, provenance = []) => {
    const copy = structuredClone(model);
    copy.meaning_model.events.push(structuredClone(view));
    copy.meaning_model.event_relations.push({ id: 'r.view', kind: 'about', source_event_id: 'ana.view', target_event_id: 'ana.choice' });
    copy.meaning_model.normalized_cuts.push({ id: 'cut.view', parent_event_id: 'ana.view', unit: 'attention', question: 'What does she attend to?',
      answers: [{ key: 'money', weight: 0.5 }, { key: 'remainder', weight: 0.5 }], provenance });
    return copy;
  };
  const listed = await checkGraph([], [], withAssessment(after), withAssessment(before));
  const { signWith, compared } = listed.assessments[0];
  assert.deepEqual(compared, []);
  assert.deepEqual(signWith, [`read:event:ana.view=${eventTextSignature(view)}`, `read:event:ana.choice=${eventTextSignature(after.meaning_model.events[1])}`]);
  // Recording the returned reads answers it.
  const rechecked = await checkGraph([], [], withAssessment(after, signWith), withAssessment(before, signWith));
  assert.deepEqual(rechecked.assessments, []); assert.deepEqual(rechecked.readings.map((item) => item.cutId), ['lens.x.ana.choice']);
  // A later rewrite of what it read keeps it visible, whichever revisions are compared.
  const later = withAssessment(after, signWith); later.meaning_model.events[1].description = 'Every night in April.';
  const stale = await checkGraph([], [], later, later);
  const reading = stale.readings.find((item) => item.cutId === 'cut.view');
  assert.deepEqual(reading.changedReads.map(({ kind, eventId, status }) => ({ kind, eventId, status })), [{ kind: 'event', eventId: 'ana.choice', status: 'needs_review' }]);
  assert.match(reading.changedReads[0].compared, /the text of Event ana\.choice/u);
});

test('a recorded life read follows the coarse account to its cutoff, not finer detail or later Events', async () => {
  const model = structuredClone(before);
  model.meaning_model.events.push(
    { id: 'ana.inner', boundary: 'Ana\'s inner life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
    { id: 'ana.view', boundary: 'Ana weighs the shifts', description: 'Before she signs.', interval: at(2005), participants: { subject: 'person.ana' } },
    { id: 'ana.late', boundary: 'Ana moves north', description: 'In 2010.', interval: at(2010), participants: { subject: 'person.ana' } });
  model.meaning_model.event_relations.push({ id: 'r.inner', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.inner' },
    { id: 'r.view', kind: 'contains', source_event_id: 'ana.inner', target_event_id: 'ana.view' },
    { id: 'r.late', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.late' });
  model.meaning_model.normalized_cuts.push({ id: 'cut.view', parent_event_id: 'ana.view', unit: 'attention', question: 'What does she attend to?', answers: [{ key: 'money', weight: 0.5 }, { key: 'remainder', weight: 0.5 }] });
  const { readSignatures } = await import('../src/reading-evidence.mjs');
  const { indexModel } = await import('../src/model-questions.mjs');
  const { lifeRead } = readSignatures(model.meaning_model.normalized_cuts.at(-1), indexModel(model));
  assert.match(lifeRead, /^read:life:ana\.life@2005\.1\/1=[0-9a-f]{16}$/u);
  model.meaning_model.normalized_cuts.at(-1).provenance = [lifeRead];
  const staleReads = async (changed) => (await checkGraph([], [], changed, changed)).readings.filter((item) => item.cutId === 'cut.view');
  assert.deepEqual(await staleReads(model), []);
  const laterEvent = structuredClone(model); laterEvent.meaning_model.events.find((event) => event.id === 'ana.late').description = 'In 2011, alone.';
  assert.deepEqual(await staleReads(laterEvent), [], 'an Event after the cutoff does not touch the life so far');
  const finer = structuredClone(model);
  finer.meaning_model.events.push({ id: 'ana.choice.first', boundary: 'The first night', interval: at(2005.01), participants: { subject: 'person.ana' } });
  finer.meaning_model.event_relations.push({ id: 'r.first', kind: 'contains', source_event_id: 'ana.choice', target_event_id: 'ana.choice.first' });
  assert.deepEqual(await staleReads(finer), [], 'finer detail below the declared depth does not change the coarse account');
  const revised = structuredClone(model); revised.meaning_model.events.find((event) => event.id === 'ana.choice').description = 'Every night in March, for her brother.';
  const [flagged] = await staleReads(revised);
  assert.equal(flagged.changedReads[0].kind, 'life'); assert.equal(flagged.changedReads[0].depth, 1); assert.equal(flagged.changedReads[0].cutoff, 2005.1);
  assert.match(flagged.changedReads[0].compared, /the life account of ana\.life up to 2005\.1 at containment depth 1/u);
});

test('a reading under an understanding root is covered by a signature on the Event it is about', async () => {
  const withReading = (model, signed) => {
    const copy = structuredClone(model);
    copy.meaning_model.context_roots = [{ event_id: 'u.root', kind: 'understanding' }];
    copy.meaning_model.events.push({ id: 'u.root', boundary: 'Construction understanding' }, { id: 'u.reading', boundary: 'How the founders divide the work' });
    copy.meaning_model.event_relations.push({ id: 'r.u', kind: 'contains', source_event_id: 'u.root', target_event_id: 'u.reading' },
      { id: 'r.about', kind: 'about', source_event_id: 'u.reading', target_event_id: 'ana.choice' });
    copy.meaning_model.normalized_cuts.push({ id: 'cut.reading', parent_event_id: 'u.reading', unit: 'u', question: 'q', answers: [{ key: 'a', weight: 1 }, { key: 'remainder', weight: 0 }],
      provenance: [`event-text:${eventTextSignature(signed)}`] });
    return copy;
  };
  const current = await checkGraph([], [], withReading(after, after.meaning_model.events[1]), withReading(before, after.meaning_model.events[1]));
  assert.ok(!current.assessments.some((item) => item.cutId === 'cut.reading') && !current.readings.some((item) => item.cutId === 'cut.reading'));
  const old = await checkGraph([], [], withReading(after, before.meaning_model.events[1]), withReading(before, before.meaning_model.events[1]));
  assert.equal(old.readings.find((item) => item.cutId === 'cut.reading').compared, 'the text of Event ana.choice');
});

// A telling phase records the passages it was read against. The Book's revision 15 changed passages under nine phases
// whose quoted excerpts all survived, and no check named them; the check now lists them whatever models it compares.
test('telling phases whose reviewed passages changed are listed on every check until renewed', async () => {
  const passageText = 'The offer lay beside the ovens.';
  const rendered = (contentHash) => ({ schema: 'life-sim-rust-narrative-render/v1', join_policy: 'blank_line', roots: ['story'],
    graph_hash: 'c'.repeat(64), projection_hash: 'p'.repeat(64), text: `# Story\n\n${passageText}`,
    units: [{ node_id: 'story', role: 'document_root', text: '# Story', content_hash: 'r'.repeat(64) },
      { node_id: 'story.p1', role: 'story_passage', text: passageText, content_hash: contentHash }] });
  const phaseRecord = (basisHash) => ({ id: 'telling.offer', node_type: 'storytelling.assessment', role: 'externalized_reflection', render: 'exclude',
    holder: 'fixture-author', text: JSON.stringify({ schema: 'meaning-model-story-author-record/v1', kind: 'assessment', text: 'How the offer is held back.',
      data: { schema: 'meaning-model-document-process/v1', documentId: 'story', label: 'The offer', question: 'When does the reader see the offer?',
        summary: 'It is shown before it is explained.', states: [{ label: 'Shown', spanId: 'span.offer', description: 'The offer is visible.',
          evidence: [{ nodeId: 'story.p1', excerpt: 'The offer lay' }], basisUnits: [{ nodeId: 'story.p1', contentHash: basisHash }] }] } }) });
  const graph = (basisHash) => ({ ...view,
    nodes: [...view.nodes, { id: 'story', role: 'document_root', render: 'include', text: '# Story' },
      { id: 'story.p1', role: 'story_passage', render: 'include', text: passageText },
      { id: 'span.offer', node_type: 'document.span', role: 'metadata', render: 'exclude', text: JSON.stringify({ schema: 'meaning-model-document-span/v1',
        documentId: 'story', start: { nodeId: 'story.p1', boundary: 'start' }, end: { nodeId: 'story.p1', boundary: 'end' } }) }, phaseRecord(basisHash)],
    edges: [...view.edges, { id: 'story.contains.p1', family: 'structural', relation: 'contains', source: { kind: 'node', node_id: 'story' }, target: { kind: 'node', node_id: 'story.p1' } }] });
  const same = { inspectModel: async () => ({ model: before }), renderNarrativeGraph: async () => rendered('now'.padEnd(64, '0')) };
  const input = { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64), toModelHash: 'a'.repeat(64) };
  const stale = await checkRevision({ ...same, queryNarrativeGraph: async () => graph('then'.padEnd(64, '0')) }, input);
  assert.deepEqual(stale.telling.map(({ processNodeId, phase, status, reason }) => ({ processNodeId, phase, status, reason })),
    [{ processNodeId: 'telling.offer', phase: 'Shown', status: 'needs_review', reason: 'passages_changed' }], 'listed although no model changed');
  assert.equal(stale.toCheck, 1);
  assert.match(stale.nextStep, /First deepen the model where the revision shows a gap/u);
  assert.match(stale.nextStep, /renew telling phases together once the text settles, not after every change/u);
  const renewed = await checkRevision({ ...same, queryNarrativeGraph: async () => graph('now'.padEnd(64, '0')) }, input);
  assert.deepEqual(renewed.telling, []); assert.equal(renewed.toCheck, 0);
  // A document the check cannot project is reported, not guessed.
  const unrendered = await checkRevision({ ...same, renderNarrativeGraph: async () => { throw new Error('render unavailable'); },
    queryNarrativeGraph: async () => graph('then'.padEnd(64, '0')) }, input);
  assert.deepEqual(unrendered.telling, []); assert.deepEqual(unrendered.tellingNotChecked, [{ documentId: 'story', reason: 'render unavailable' }]);
});

// Found after 0.6.1: changing only a Cut's weights left a scene linked to its Event, and the later Event it causes,
// unnamed. Numbers change an Event's state in two ways: a comparison (a Cut) or a value on a defined scale (a rating).
test('a Cut whose weights alone change flags the scenes and notes of its Event and the Events it causes', async () => {
  const modelAfter = structuredClone(before);
  modelAfter.meaning_model.normalized_cuts[0].answers = [{ key: 'yes', weight: 0.4 }, { key: 'remainder', weight: 0.6 }];
  const result = await checkGraph([passage('scene'), { id: 'note.choice', node_type: 'understanding.idea', render: 'exclude', text: 'She is torn.' }],
    [anchor('scene', 'ana.choice'), anchor('note.choice', 'ana.choice', { family: 'semantic', relation: 'about' })], modelAfter);
  assert.deepEqual(result.changed.rewritten, []);
  assert.deepEqual(result.changed.stateChanged, [{ eventId: 'ana.choice', by: ['cut:cut.choice'] }]);
  assert.deepEqual(result.passages.map(({ nodeId }) => nodeId), ['scene']);
  assert.match(result.passages[0].why, /renders an Event whose modeled state changed \(Cut cut\.choice on it changed\)/);
  assert.deepEqual(result.later.map(({ eventId, from }) => ({ eventId, from })), [{ eventId: 'ana.after', from: 'ana.choice' }]);
  assert.match(result.later[0].why, /follows from an Event whose modeled state changed/);
  assert.deepEqual(result.notes.map(({ nodeId }) => nodeId), ['note.choice']);
  assert.doesNotMatch(result.nextStep, /No affected declared dependencies/);
  // A reading's weights are a view of the model, not its state.
  const reread = structuredClone(before);
  reread.meaning_model.normalized_cuts.find((cut) => cut.id === 'lens.x.ana.choice').answers = [{ key: 'a', weight: 0.5 }, { key: 'remainder', weight: 0.5 }];
  const reading = await checkGraph([passage('scene')], [anchor('scene', 'ana.choice')], reread);
  assert.deepEqual([reading.changed.stateChanged, reading.passages, reading.later], [[], [], []]);
});
