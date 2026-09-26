import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulationService } from '../src/service.mjs';
import { BUILT_IN_LENSES, LENS_SCHEMA, defineLens, lensQuestions, lensUnit, readLenses, rereadLenses } from '../src/lenses.mjs';
import { checkRevision } from '../src/revision-check.mjs';
import { READING_MARK } from '../src/model-questions.mjs';

// Fear or love, whole lives and drawn decisions belong to the storytelling profile, which these tests adopt.
process.env.MEANING_MODEL_ADDONS = 'storytelling';

// Declared contracts: a reading's mathematics is the lens's to declare, not the helper's to assume.
const at = (start, end = start + 0.1) => ({ start, end });
function model(cuts, extra = {}) {
  return { meaning_model: {
    referents: [{ id: 'person.ana', boundary: 'Ana Berg, a nurse in Uppsala', lifecycle_event_id: 'ana.life' }],
    events: [
      { id: 'ana.life', boundary: 'Ana\'s life', interval: at(1980, 2030), participants: { subject: 'person.ana' } },
      { id: 'ana.life.is.work', boundary: 'Ana\'s work', interval: at(1980, 2030) },
      { id: 'ana.parting', boundary: 'Ana and Bo part at the station', description: 'They argue, and then she says goodbye.', interval: at(2005), participants: { subject: 'person.ana' } },
      { id: 'ana.return', boundary: 'Ana comes home', description: 'She comes back in the spring and says nothing about it.', interval: at(2008), participants: { subject: 'person.ana' } },
      { id: 'understanding.writer', boundary: 'What writer understands', process_ids: [], provenance: [READING_MARK] },
      ...['ana.parting', 'ana.return'].map((record) => ({ id: `reading.x.${record}`, boundary: 'A reading', description: 'A reading.', process_ids: [], provenance: [READING_MARK, 'perspective:modeler'] })),
      ...(extra.events ?? []),
    ],
    event_relations: [{ id: 'c1', kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' },
      ...['ana.parting', 'ana.return'].flatMap((record) => [{ id: `c.${record}`, kind: 'contains', source_event_id: 'understanding.writer', target_event_id: `reading.x.${record}` }, { id: `a.${record}`, kind: 'about', source_event_id: `reading.x.${record}`, target_event_id: record }])],
    context_roots: [{ event_id: 'ana.life', kind: 'accepted_world' }, { event_id: 'ana.parting', kind: 'accepted_world' }, { event_id: 'ana.return', kind: 'accepted_world' }, { event_id: 'understanding.writer', kind: 'understanding' }],
    normalized_cuts: [
      { id: 'cut.parting', unit: 'decision', parent_event_id: 'ana.parting', question: 'Does she go?', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
      { id: 'cut.return', unit: 'decision', parent_event_id: 'ana.return', question: 'Does she return?', answers: [{ key: 'yes', weight: 0.5 }, { key: 'remainder', weight: 0.5 }] },
      ...cuts],
  } };
}
const viewFor = (lens, id = `lens.${lens.id}`) => ({ graph: { source: { model_hash: 'a'.repeat(64) }, roots: ['story'] },
  nodes: [{ id, node_type: 'understanding.lens', holder: 'writer', text: JSON.stringify({ data: { schema: LENS_SCHEMA, ...lens } }) }],
  edges: [{ source: { kind: 'node', node_id: id }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person.ana' }, relation: 'about' }] });
const ask = (definition, view, lensId) => lensQuestions({ queryNarrativeGraph: async () => view, inspectModel: async () => ({ model: definition }) }, { graphHash: 'b'.repeat(64), lensIds: [lensId], limit: 50 });

test('fear or love redefined with children keeps its families, and its readings carry over to the fixed vocabulary', async () => {
  const builtIn = BUILT_IN_LENSES[0];
  const redefined = { id: 'fear-love', name: 'Fear or love', appliesTo: ['act'], question: builtIn.question, why: builtIn.why,
    answers: [{ key: 'fear', meaning: 'out of fear', children: [{ key: 'being_found_out', meaning: 'x' }, { key: 'loss', meaning: 'y' }] }, { key: 'love', meaning: 'out of love' }] };
  const old = { id: 'lens.fear-love.ana.parting', parent_event_id: 'reading.x.ana.parting', question: 'q', unit: lensUnit(builtIn), answers: [{ key: 'fear', weight: 0.7 }, { key: 'love', weight: 0.2 }, { key: 'remainder', weight: 0.1 }] };
  const view = viewFor(redefined);
  const [lens] = readLenses(view).filter((item) => item.id === 'fear-love');
  assert.deepEqual(lens.families, builtIn.families); assert.ok(lens.matchesQuestion);
  const [read] = (await ask(model([old]), view, 'fear-love')).lenses;
  assert.equal(read.stale, 0); assert.equal(read.answered, 1);
  // An answer in a key the fixed vocabulary lacks does not carry over.
  const other = { ...old, answers: [{ key: 'shame', weight: 0.7 }, { key: 'remainder', weight: 0.3 }] };
  const [stale] = (await ask(model([other]), view, 'fear-love')).lenses;
  assert.equal(stale.stale, 1);
});

test('a draw whose Cut carries its own drawn weights again is consistent', async () => {
  const before = model([]); before.meaning_model.normalized_cuts[0].answers = [{ key: 'yes', weight: 0.3 }, { key: 'remainder', weight: 0.7 }];
  const after = model([]);
  const draw = { id: 'draw.1', node_type: 'direction_draw', text: JSON.stringify({ cutId: 'cut.parting', realized: 'yes', answers: [{ key: 'yes', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] }) };
  const service = { queryNarrativeGraph: async () => ({ graph: { source: { model_hash: 'b'.repeat(64) } }, nodes: [draw], edges: [] }), inspectModel: async ({ modelHash }) => ({ model: modelHash === 'a'.repeat(64) ? before : after }) };
  const restored = await checkRevision(service, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64) });
  assert.deepEqual(restored.changed.reweighted, ['cut.parting']); assert.deepEqual(restored.draws, []);
  const drifted = await checkRevision({ ...service, inspectModel: async ({ modelHash }) => ({ model: modelHash === 'a'.repeat(64) ? after : before }) }, { graphHash: 'c'.repeat(64), fromModelHash: 'a'.repeat(64) });
  assert.deepEqual(drifted.draws.map((item) => item.cutId), ['cut.parting']);
});

test('the bulk re-read answers an earlier version\'s readings under this one, and reads several times to tell noise from change', async () => {
  const stage = { id: 'stage', name: 'Stage', appliesTo: ['act'], question: 'Is {subject} wanting, bartering or standing?', why: 'It changes what a setback does.',
    answers: [{ key: 'wanting', meaning: 'want and get' }, { key: 'bartering', meaning: 'act for a reaction' }, { key: 'standing', meaning: 'act regardless' }] };
  const older = { ...stage, question: 'Is {subject} wanting or bartering?' };
  const reading = { id: 'lens.stage.ana.parting', parent_event_id: 'reading.x.ana.parting', question: 'Is it wanting or bartering?', unit: lensUnit(older), answers: [{ key: 'wanting', weight: 0.6 }, { key: 'bartering', weight: 0.3 }, { key: 'remainder', weight: 0.1 }], provenance: ['estimator:t', 'confidence 0.500; top wanting'] };
  const definition = model([reading]);
  const view = { ...viewFor(older, 'lens.stage'), nodes: [...viewFor(older, 'lens.stage').nodes, { id: 'lens.stage.r2', node_type: 'understanding.lens', holder: 'writer', text: JSON.stringify({ data: { schema: LENS_SCHEMA, ...stage } }) }],
    edges: [...viewFor(older, 'lens.stage').edges, { source: { kind: 'node', node_id: 'lens.stage.r2' }, target: { kind: 'node', node_id: 'lens.stage' }, relation: 'supersedes' }, { source: { kind: 'node', node_id: 'lens.stage.r2' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person.ana' }, relation: 'about' }] };
  const calls = [];
  const service = { queryNarrativeGraph: async () => view, inspectModel: async () => ({ model: definition }), reviseModel: async (request) => { calls.push(request); return { modelHash: 'e'.repeat(64) }; } };
  let n = 0; const draws = [{ wanting: 0.2, bartering: 0.2, standing: 0.5, remainder: 0.1 }, { wanting: 0.1, bartering: 0.2, standing: 0.6, remainder: 0.1 }, { wanting: 0.15, bartering: 0.25, standing: 0.5, remainder: 0.1 }];
  const estimator = { backend: 'test', model: 'm', label: 'test:m', async estimate() { const probabilities = draws[n % draws.length]; n += 1; return { model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, answers: { shares: { type: 'choice', probabilities, confidence: 0.7 } } }; } };
  const result = await rereadLenses(service, estimator, { graphHash: 'b'.repeat(64), requestId: 'reread', accessScopes: ['author'], samples: 3 });
  assert.equal(n, 3); assert.equal(result.read.length, 1);
  const [entry] = result.read;
  assert.equal(entry.answeredUnder, 'this version of the lens'); assert.equal(entry.after, 'standing 0.53'); assert.ok(entry.spread > 0.05 && entry.spread < 0.2);
  const applied = calls[0].model.meaning_model.normalized_cuts.find((cut) => cut.id === 'lens.stage.ana.parting');
  assert.equal(applied.unit, lensUnit(stage)); assert.match(applied.question, /wanting, bartering or standing/u);
  assert.ok(applied.provenance.some((item) => /^reread: mean of 3 readings/u.test(item)));
});

test('a lens that names no one looks at the whole work', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const provenance = ['contracts-test'];
  const registered = await service.registerModel({ requestId: 'm', model: { schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'hour', revision: { number: 0, reason: 'Test', provenance },
    processes: [{ id: 'p', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['w'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [] } });
  const graph = await service.registerNarrativeGraph({ requestId: 'g', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'g', revision: { number: 0, reason: 'Test', provenance },
    source: { kind: 'model', model_hash: registered.modelHash }, roots: ['book'], nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  const defined = await defineLens(service, { graphHash: graph.graphHash, requestId: 'lens', accessScopes: ['author'], holder: 'writer',
    lens: { id: 'mood', name: 'Mood', question: 'What mood is {subject} in?', appliesTo: ['act'], why: 'Moods carry the book.' } });
  assert.equal(defined.lensNodeId, 'lens.mood');
});
