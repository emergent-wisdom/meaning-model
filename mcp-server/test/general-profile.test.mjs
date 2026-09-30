import test from 'node:test';
import assert from 'node:assert/strict';
import { LENS_SCHEMA, lensQuestions, lensUnit } from '../src/lenses.mjs';
import { SUFFICIENT_SCHEMA, readOpenQuestions, standingQuestions } from '../src/model-questions.mjs';

// General modeling assumes no human narrative: fear or love, whole lives and drawn decisions belong to the storytelling
// profile, which these tests do not adopt.
delete process.env.MEANING_MODEL_ADDONS;
const at = (start, end = start + 0.1) => ({ start, end });
const model = { meaning_model: {
  referents: [{ id: 'person.ana', boundary: 'Ana Berg, an engineer', lifecycle_event_id: 'ana.life' }],
  events: [{ id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
    { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
    { id: 'ana.a', boundary: 'Ana at the plant, 2004', description: 'She runs the reactor test.', interval: at(2004), participants: { subject: 'person.ana' } },
    { id: 'ana.b', boundary: 'Ana at the plant, 2008', description: 'She runs it again.', interval: at(2008), participants: { subject: 'person.ana' } }],
  event_relations: [{ kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' }],
  normalized_cuts: [
    { id: 'cut.choice', unit: 'decision', parent_event_id: 'ana.a', question: 'Does she shut it down?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
    ...['a', 'b'].map((key, i) => ({ id: `feel.${key}`, parent_event_id: `ana.${key}`, unit: 'emotional attention', question: 'What does Ana feel at work?',
      answers: [{ key: 'calm', weight: i ? 0.2 : 0.8 }, { key: 'strain', weight: i ? 0.7 : 0.1 }, { key: 'remainder', weight: 0.1 }] }))],
} };
const graph = (nodes = [], edges = []) => ({ graph: { source: { model_hash: 'a'.repeat(64) } }, roots: ['doc'], nodes: [{ id: 'doc', node_type: 'document', role: 'document_root' }, ...nodes], edges });
const service = (view) => ({ inspectModel: async () => ({ model }), queryNarrativeGraph: async () => view });

test('without the story profile there is no built-in lens, no draw suggested and no question of fear or love', async () => {
  const lenses = await lensQuestions(service(graph()), { graphHash: 'b'.repeat(64) });
  assert.deepEqual(lenses.lenses, []);
  assert.doesNotMatch(lenses.survey.join(' '), /fear or love/u);
  const open = await readOpenQuestions(service(graph()), { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64), limit: 60 });
  assert.equal(open.questions.some((item) => item.kind === 'decision-undrawn'), false);
  // Whole lives are the story profile's: a model with a person in it is not asked to give them a life, shocks or wants.
  for (const kind of ['life-missing', 'periods-missing', 'wants-missing', 'shocks-few', 'choices-missing', 'processes-few']) assert.equal(open.questions.some((item) => item.kind === kind), false, kind);
  assert.equal(open.questions.some((item) => item.kind === 'shift-uncaused'), true);
  assert.doesNotMatch(standingQuestions().join(' '), /out of fear or out of love|Fear or love is one lens/u);
  assert.doesNotMatch(standingQuestions().join(' '), /deeper story/u, 'the story\'s question about its assumptions belongs to the story profile');
});

test('a question judged sufficient here is not asked again while the note stands', async () => {
  const asked = await readOpenQuestions(service(graph()), { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64), limit: 60 });
  const shift = asked.questions.find((item) => item.kind === 'shift-uncaused');
  assert.ok(shift, 'the model asks why Ana\'s feeling at work shifts');
  const note = { id: 'note.enough', node_type: 'understanding.note', text: JSON.stringify({ data: { schema: SUFFICIENT_SCHEMA, kind: 'shift-uncaused', reason: 'The strain follows the plant\'s new rota, modeled elsewhere.', reopenIf: 'the rota changes' } }) };
  const view = graph([note], [{ source: { kind: 'node', node_id: 'note.enough' }, target: { kind: 'anchor', anchor_kind: 'normalized_cut', anchor_id: 'feel.b' }, relation: 'about' }]);
  const after = await readOpenQuestions(service(view), { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64), limit: 60 });
  assert.equal(after.questions.some((item) => item.kind === 'shift-uncaused'), false);
  assert.equal(after.sufficientHere, 1); assert.match(after.sufficientHow, /meaning-model-sufficient\/v1/u);
  assert.deepEqual(after.sufficiencyNotes, [{ nodeId: 'note.enough', kind: 'shift-uncaused', aboutNodeIds: [],
    reason: "The strain follows the plant's new rota, modeled elsewhere.", reopenIf: 'the rota changes',
    writtenAgainstModel: null, everywhere: false, records: ['feel.b'] }]);
  assert.match(after.sufficientHow, /not an automatically evaluated rule/u);
});

test('a new understanding supersedes a sufficiency note and reopens its questions', async () => {
  const note = { id: 'note.enough', node_type: 'understanding.note', text: JSON.stringify({ data: {
    schema: SUFFICIENT_SCHEMA, kind: 'shift-uncaused', reason: 'The rota explains the change.', reopenIf: 'another process affects the response',
  } }) };
  const opening = { id: 'question.new', node_type: 'understanding.question', text: 'The changed reporting relationship may alter what the same shift means. Explore that process next.' };
  const edges = [{ source: { kind: 'node', node_id: note.id }, target: { kind: 'node', node_id: 'doc' }, relation: 'about' },
    { source: { kind: 'node', node_id: opening.id }, target: { kind: 'node', node_id: note.id }, relation: 'supersedes' }];
  const ask = async (nodes) => readOpenQuestions(service(graph(nodes, edges)), { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64), limit: 60 });
  const reopened = await ask([note, opening]);
  assert.ok(reopened.questions.some((item) => item.kind === 'shift-uncaused'));
  assert.equal(reopened.sufficiencyNotes, undefined);
  const inaccessible = await ask([note]);
  assert.ok(!inaccessible.questions.some((item) => item.kind === 'shift-uncaused'), 'an absent or inaccessible source cannot silently supersede the visible judgment');
  assert.equal(inaccessible.sufficiencyNotes[0].nodeId, note.id);
});

test('an unrelated model revision preserves local sufficiency and exposes its original basis for reassessment', async () => {
  const beforeHash = 'a'.repeat(64);
  const afterHash = 'c'.repeat(64);
  const note = { id: 'note.local', node_type: 'understanding.note', provenance: [`written-against-model:${beforeHash}`],
    text: JSON.stringify({ data: { schema: SUFFICIENT_SCHEMA, kind: 'shift-uncaused', reason: 'The rota explains this shift.', reopenIf: 'the rota changes' } }) };
  const view = graph([note], [{ source: { kind: 'node', node_id: note.id }, target: { kind: 'anchor', anchor_kind: 'normalized_cut', anchor_id: 'feel.b' }, relation: 'about' }]);
  view.graph.source.model_hash = afterHash;
  const expanded = structuredClone(model);
  expanded.meaning_model.events.push({ id: 'unrelated', boundary: 'A distant survey with no change to the plant.' });
  const after = await readOpenQuestions({ inspectModel: async () => ({ model: expanded }), queryNarrativeGraph: async () => view },
    { modelHash: afterHash, graphHash: 'b'.repeat(64), limit: 60 });
  assert.ok(!after.questions.some((item) => item.kind === 'shift-uncaused'));
  assert.equal(after.sufficiencyNotes[0].writtenAgainstModel, beforeHash);
  assert.equal(after.sufficiencyNotes[0].reopenIf, 'the rota changes');
  assert.match(after.alwaysAsk.join(' '), /discovery lead recursively to new questions/u);
});

test('many or oversized sufficiency notes have bounded inline metadata and an explicit scoped read route', async () => {
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `note.${i}`, node_type: 'understanding.note', text: JSON.stringify({ data: {
    schema: SUFFICIENT_SCHEMA, kind: 'shift-uncaused', reason: `Reason ${i}: ${'x'.repeat(i === 0 ? 40_000 : 4_000)}`, reopenIf: 'new relevant evidence',
  } }) }));
  const view = graph(nodes, nodes.map((node) => ({ source: { kind: 'node', node_id: node.id }, target: { kind: 'node', node_id: 'doc' }, relation: 'about' })));
  for (const limit of [1, 60]) {
    const result = await readOpenQuestions(service(view), { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64), limit, accessScopes: ['author'] });
    assert.ok(result.sufficiencyNotes.length <= Math.min(limit, 16));
    assert.ok(Buffer.byteLength(JSON.stringify(result.sufficiencyNotes)) < 33 * 1024);
    assert.equal(result.sufficiencyNotesOmitted, nodes.length - result.sufficiencyNotes.length);
    assert.equal(result.sufficiencyNotes[0].nodeId, 'note.1', 'an oversized note is omitted, not excerpted');
    assert.equal(result.sufficiencyNotes[0].reason, JSON.parse(nodes[1].text).data.reason);
    assert.deepEqual(result.sufficiencyNotesRead.arguments, { graphHash: 'b'.repeat(64), expectedGraphHash: 'b'.repeat(64), mode: 'skeleton', includeContent: false, accessScopes: ['author'] });
    assert.match(result.sufficiencyNotesRead.next, /centerNodeId.*depth 0.*includeContent true/u);
  }
});

test('openings stop at the default depth, which is reported as a limit and can be raised', async () => {
  const lens = { schema: LENS_SCHEMA, id: 'strain', name: 'Where the strain comes from', appliesTo: ['act'], question: 'Where does the strain in {subject} come from?', why: 'It sets what fails next.',
    answers: [{ key: 'load', meaning: 'the work itself' }, { key: 'people', meaning: 'the people around it' }] };
  const reading = (id, parent, answers, conditioning = null) => ({ id, parent_event_id: parent, question: 'q', unit: 'u', answers, ...(conditioning ? { conditioning } : {}) });
  const deep = structuredClone(model);
  deep.meaning_model.normalized_cuts.push(
    reading('lens.strain.ana.a', 'ana.a', [{ key: 'load', weight: 0.9 }, { key: 'people', weight: 0.05 }, { key: 'remainder', weight: 0.05 }]),
    reading('lens.strain.ana.a.in.load', 'ana.a', [{ key: 'heat', weight: 0.9 }, { key: 'remainder', weight: 0.1 }], { cut_id: 'lens.strain.ana.a', answer_key: 'load' }));
  const view = graph([{ id: 'lens.strain', node_type: 'understanding.lens', holder: 'writer', text: JSON.stringify({ data: lens }) }]);
  const svc = { inspectModel: async () => ({ model: deep }), queryNarrativeGraph: async () => view };
  const [shallow] = (await lensQuestions(svc, { graphHash: 'b'.repeat(64), maxDepth: 1 })).lenses;
  assert.equal(shallow.openings.some((item) => item.path.length > 1), false);
  assert.equal(shallow.beyondDepthLimit.limit, 1); assert.ok(shallow.beyondDepthLimit.openings.some((item) => item.path.join('/') === 'load/heat'));
  const [raised] = (await lensQuestions(svc, { graphHash: 'b'.repeat(64), maxDepth: 3 })).lenses;
  assert.ok(raised.openings.some((item) => item.path.join('/') === 'load/heat'));
  assert.equal(lensUnit(lens).startsWith('lens:strain@'), true);
});

test('a sufficiency note covers its whole kind only when it is about a document root, and lapses when its records are gone', async () => {
  const note = (id) => ({ id, node_type: 'understanding.note', text: JSON.stringify({ data: { schema: SUFFICIENT_SCHEMA, kind: 'shift-uncaused', reason: 'Enough here.' } }) });
  const ask = async (view) => (await readOpenQuestions(service(view), { modelHash: 'a'.repeat(64), graphHash: 'b'.repeat(64), limit: 60 })).questions.some((item) => item.kind === 'shift-uncaused');
  // Its records gone, a note about them covers nothing.
  assert.equal(await ask(graph([note('note.orphan')])), true);
  // About the document root, it covers every question of its kind.
  assert.equal(await ask(graph([note('note.all')], [{ source: { kind: 'node', node_id: 'note.all' }, target: { kind: 'node', node_id: 'doc' }, relation: 'about' }])), false);
});
