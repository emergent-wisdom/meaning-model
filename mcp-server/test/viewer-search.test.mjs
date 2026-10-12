import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchIndex, fold, searchRecords } from '../viewer/public/search.js';

const event = (id, boundary, description = '') => ({ id, boundary, description, interval: { start: 1, end: 2 }, participants: {}, process_ids: [] });
const inspection = { model: { id: 'search-model', time_unit: 'year',
  processes: [{ id: 'h.alive', unit: 'billion people', scale: { semantic_role: 'people alive' } }],
  meaning_model: {
    referents: [{ id: 'referent.ada', boundary: 'Ada, apprentice baker', lifecycle_event_id: 'ev.ada.life' }],
    events: [event('ev.flu', 'The influenza pandemic, 1918 to 1920.', 'Spread along troop movements at the end of the war.'),
      event('ev.flu.second', 'The second wave of the influenza.'), event('ev.ada.life', 'Ada\'s life'), event('ev.ferry', 'The ferry stops')],
    event_referent_bindings: [{ id: 'binding.ada', binding_type: 'lifecycle_subject', referent_id: 'referent.ada', target: { kind: 'event', event_id: 'ev.ada.life' } }],
    normalized_cuts: [
      { id: 'cut.offer', parent_event_id: 'ev.ferry', question: 'Does Ben accept the post in Bergen?', unit: 'decision',
        answers: [{ key: 'accept', weight: 0.6, meaning: 'He moves north with the children.' }, { key: 'remainder', weight: 0.4 }] },
      { id: 'cut.offer.old', parent_event_id: 'ev.ferry', question: 'Does Ben accept the post?', unit: 'decision', answers: [{ key: 'remainder', weight: 1 }],
        withdrawn: { reason: 'Superseded.', superseded_by: ['cut.offer'] } },
    ],
    event_relations: [], context_roots: [] } },
graph: { nodes: [
  { id: 'note.ferry', node_type: 'storytelling.idea', text: JSON.stringify({ schema: 'meaning-model-story-author-record/v1', kind: 'idea', text: 'Why the ferry matters to the town.' }) },
  { id: 'passage.3', node_type: 'story_passage', text: 'Mira smålog åt floden och väntade.' },
], edges: [] } };

test('search finds every kind of record a view can select, and folds case and accents', () => {
  const index = buildSearchIndex({ inspection });
  const kinds = new Set(index.map((entry) => entry.kind));
  for (const kind of ['event', 'process', 'referent', 'normalized_cut', 'narrative']) assert.ok(kinds.has(kind), kind);
  assert.ok(!kinds.has('event_referent_binding') && !kinds.has('model'), 'records that only name others are left out');
  assert.equal(fold('Smålog ÅT'), 'smalog at');
  assert.deepEqual(searchRecords(index, 'smalog').results.map((item) => item.id), ['passage.3']);
  assert.deepEqual(searchRecords(index, 'ferry matters').results.map((item) => [item.kind, item.label]), [['narrative', 'Why the ferry matters to the town.']],
    'an author record is found and labeled by what it says, not by its JSON');
  assert.deepEqual(searchRecords(index, 'people alive').results.map((item) => item.id), ['h.alive']);
  assert.deepEqual(searchRecords(index, '   ').results, []);
});

test('a whole label or id ranks first; words only in the text come with a snippet; withdrawn records rank last', () => {
  const index = buildSearchIndex({ inspection });
  const flu = searchRecords(index, 'influenza');
  assert.deepEqual(flu.results.map((item) => item.id), ['ev.flu.second', 'ev.flu'], 'both name it; the shorter label first');
  assert.equal(searchRecords(index, 'ev.flu').results[0].id, 'ev.flu', 'an exact id is the first result');
  const troops = searchRecords(index, 'troop');
  assert.deepEqual(troops.results.map((item) => item.id), ['ev.flu']);
  assert.match(troops.results[0].snippet, /troop movements/u);
  const offer = searchRecords(index, 'ben accept post');
  assert.deepEqual(offer.results.map((item) => [item.id, item.withdrawn]), [['cut.offer', false], ['cut.offer.old', true]]);
  assert.deepEqual(searchRecords(index, 'children north').results.map((item) => item.id), ['cut.offer'], 'a Cut is found by what its answers mean');
  assert.deepEqual(searchRecords(index, 'influenza ferry').results, [], 'every word must match');
  assert.equal(searchRecords(index, 'e', 2).results.length, 2);
  assert.ok(searchRecords(index, 'e', 2).total > 2, 'the total counts every match, not only those shown');
});

test('the whole text is searched, not its first pages; the snippet is what is cut short', () => {
  const chapter = `${'The river ran on. '.repeat(1_500)}Then Mira found the brass needle in the silt.`;
  assert.ok(chapter.length > 20_000);
  const data = { inspection: { model: { id: 'long', meaning_model: { events: [] } }, graph: { nodes: [{ id: 'chapter.12', node_type: 'story_passage', text: chapter }], edges: [] } } };
  const found = searchRecords(buildSearchIndex(data), 'brass needle');
  assert.deepEqual(found.results.map((item) => item.id), ['chapter.12']);
  assert.match(found.results[0].snippet, /found the brass needle in the silt/u);
  assert.ok(found.results[0].snippet.length < 200, 'the snippet is a window, not the chapter');
});

test('a structured note is found by everything it stores, not only its summary', () => {
  const opening = { schema: 'meaning-model-story-author-record/v1', kind: 'world', text: 'The opening record.',
    data: { stage: 'opening', accounts: ['The town keeps its memories in the ferry\'s logbook.'],
      realism: { level: 'own_laws', laws: [{ id: 'law.river', law: 'The river chooses who may cross.', seedWord: 'riptide' }] },
      requestHash: 'a'.repeat(64) } };
  const data = { inspection: { model: { id: 'notes', meaning_model: { events: [] } }, graph: { nodes: [{ id: 'w.opening', node_type: 'storytelling.world', text: JSON.stringify(opening) }], edges: [] } } };
  const index = buildSearchIndex(data);
  for (const query of ['riptide', 'memories logbook', 'river chooses']) assert.deepEqual(searchRecords(index, query).results.map((item) => item.id), ['w.opening'], query);
  assert.equal(searchRecords(index, 'riptide').results[0].label, 'The opening record.', 'the label stays the summary');
  assert.deepEqual(searchRecords(index, 'aaaaaaaa').results, [], 'hashes are not searched');
});

test('processes and rows are found under the names the time view shows, and carry the row to open', async () => {
  const { projectNumerics } = await import('../src/viewer-numerics.mjs');
  const ev = (id, extra = {}) => ({ id, boundary: id, participants: {}, process_ids: [], ...extra });
  const contains = (source_event_id, target_event_id) => ({ kind: 'contains', source_event_id, target_event_id });
  const feels = (id, parent, weight) => ({ id, parent_event_id: parent, question: 'What colours Laura\'s waking hours?', unit: 'emotional attention',
    answers: [{ key: 'fear_of_abandonment', weight }, { key: 'calm', weight: 1 - weight }, { key: 'remainder', weight: 0 }], provenance: ['fixture'] });
  const model = { id: 'laura', time_unit: 'year',
    processes: [{ id: 'laura.exhaustion', unit: 'level', scale: { semantic_role: 'tiredness' } }, { id: 'laura.grief', unit: 'level' }],
    meaning_model: {
      referents: [{ id: 'person.laura', boundary: 'Laura, a nurse', lifecycle_event_id: 'laura.life' }],
      events: [ev('world'), ev('laura.life', { interval: { start: 1990, end: 2030 } }), ev('laura.2014', { interval: { start: 2014, end: 2015 } }), ev('laura.2016', { interval: { start: 2016, end: 2017 } })],
      context_roots: [{ event_id: 'world', kind: 'accepted_world' }],
      event_relations: [contains('world', 'laura.life'), contains('laura.life', 'laura.2014'), contains('laura.life', 'laura.2016')],
      normalized_cuts: [feels('feel.2014', 'laura.2014', 0.3), feels('feel.2016', 'laura.2016', 0.6)] } };
  const data = { inspection: { model }, numerics: projectNumerics(model), people: [{ id: 'person.laura', name: 'Laura' }],
    display: { names: { 'laura.grief': 'Grief for her father' } },
    measures: [{ id: 'laura.exhaustion', label: 'How tired Laura is', points: [{ t: 2014, v: 0.2 }, { t: 2016, v: 0.7 }] }] };
  const index = buildSearchIndex(data);
  assert.ok(!index.some((item) => item.kind === 'normalized_cut_answer'), 'single Cut answers are not separate results');
  const fear = searchRecords(index, 'fear of abandonment').results;
  assert.equal(fear[0].kind, 'row');
  assert.equal(fear[0].label, 'Laura · fear of abandonment');
  assert.match(fear[0].rowId, /^cut-answer:/u);
  assert.deepEqual(fear[0].record, { kind: 'event', id: 'laura.life' }, 'outside the time view a row opens as the record it is drawn from');
  const grief = searchRecords(index, 'grief for her father').results;
  assert.deepEqual(grief.map((item) => [item.kind, item.id, item.label]), [['process', 'laura.grief', 'Grief for her father']]);
  const tired = searchRecords(index, 'how tired').results;
  assert.deepEqual(tired.map((item) => [item.kind, item.id, item.rowId]), [['process', 'laura.exhaustion', 'laura.exhaustion']], 'a drawn process opens at its row, once');
  assert.deepEqual(searchRecords(index, 'tiredness').results.map((item) => item.id), ['laura.exhaustion'], 'and is still found by its model meaning');
});

test('a process drawn as several series keeps one result per series, named by whose it is', () => {
  const series = (holder) => ({ id: `typed-scalar:temp~${holder}`, kind: 'typed-scalar', processId: 'town.temp', label: 'Temperature', holder,
    interpolation: { kind: 'linear-visual-guide' }, points: [{ t: 1990, v: 12 }, { t: 2010, v: 14 }] });
  const data = { inspection: { model: { id: 'town', time_unit: 'year', processes: [{ id: 'town.temp', unit: 'degrees', scale: { semantic_role: 'Temperature' } }],
    meaning_model: { referents: [], events: [], normalized_cuts: [], event_relations: [], context_roots: [] } } },
    people: [{ id: 'person.alice', name: 'Alice' }, { id: 'person.bob', name: 'Bob' }],
    typedScalarSeries: [series('person.alice'), series('person.bob')] };
  const results = searchRecords(buildSearchIndex(data), 'temperature').results;
  const rows = results.filter((item) => item.kind === 'row');
  assert.deepEqual(rows.map((item) => [item.label, item.rowId]).sort(), [['Alice · Temperature', 'typed-scalar:temp~person.alice'], ['Bob · Temperature', 'typed-scalar:temp~person.bob']]);
  assert.ok(rows.every((item) => item.record?.kind === 'process' && item.record.id === 'town.temp'), 'each opens as the process outside the time view');
  const process = results.find((item) => item.kind === 'process');
  assert.equal(process.rowId, undefined, 'the process itself names no single series');
});
