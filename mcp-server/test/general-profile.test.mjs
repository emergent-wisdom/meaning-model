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
