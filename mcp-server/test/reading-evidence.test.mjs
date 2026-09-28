import test from 'node:test';
import assert from 'node:assert/strict';
import { readingOf } from '../src/cut-shares.mjs';
import { indexModel, READING_MARK } from '../src/model-questions.mjs';
import { eventTextSignature, readingTextEvidence } from '../src/reading-evidence.mjs';

const event = (id, description, provenance = []) => ({ id, boundary: id, description, provenance, participants: {} });
const about = (target_event_id, extra = {}) => ({ source_event_id: 'reading', target_event_id, kind: 'about', ...extra });
const fixture = (provenance = [], relations = [about('outcome')]) => ({ meaning_model: {
  events: [event('decision', 'Choose whether to leave.'), event('outcome', 'She leaves.'),
    event('another', 'Another subject.'), event('reading', 'A reading act.', [READING_MARK, ...provenance])],
  event_relations: relations, normalized_cuts: [], context_roots: [],
} });
const freshCut = (model) => {
  const index = indexModel(model);
  const source = readingOf(model, index.events.get('reading'), index).read;
  return { parent_event_id: 'reading', provenance: [`event-text:${eventTextSignature(source)}`] };
};

test('an actor reading tracks its explicit decision source ahead of one or several about subjects', () => {
  const model = fixture(['perspective:actor', 'decided-at:decision'], [about('outcome'), about('another')]);
  const cut = freshCut(model);
  assert.deepEqual(readingTextEvidence(cut, indexModel(model)), { status: 'unchanged', eventId: 'decision' });
  model.meaning_model.events.find((item) => item.id === 'outcome').description = 'A revised account of what followed.';
  assert.equal(readingTextEvidence(cut, indexModel(model)).status, 'unchanged', 'outcome text was not the signed text dependency');
  model.meaning_model.events.find((item) => item.id === 'decision').description = 'A revised account of the choice.';
  assert.equal(readingTextEvidence(cut, indexModel(model)).status, 'needs_review');
});

test('legacy other/about relations resolve to the same signed source as estimation', () => {
  const model = fixture([], [about('outcome', { kind: 'other', description: 'about the completed act' })]);
  const cut = freshCut(model);
  assert.deepEqual(readingTextEvidence(cut, indexModel(model)), { status: 'unchanged', eventId: 'outcome' });
  model.meaning_model.events.find((item) => item.id === 'outcome').description = 'A revised account.';
  assert.equal(readingTextEvidence(cut, indexModel(model)).status, 'needs_review');
  model.meaning_model.event_relations.push(about('another'));
  assert.equal(readingTextEvidence(cut, indexModel(model)).status, 'unresolved');
});

test('a missing declared decision or about target never falls back to a surviving matching Event', () => {
  for (const provenance of [[], ['perspective:actor', 'decided-at:decision']]) {
    const model = fixture(provenance);
    const cut = freshCut(model);
    const sourceId = provenance.length ? 'decision' : 'outcome';
    const source = model.meaning_model.events.find((item) => item.id === sourceId);
    // A coincidentally identical surviving text must not hide a lost reference.
    Object.assign(model.meaning_model.events.find((item) => item.id === 'reading'), { boundary: source.boundary, description: source.description });
    model.meaning_model.events = model.meaning_model.events.filter((item) => item.id !== sourceId);
    const result = readingTextEvidence(cut, indexModel(model));
    assert.equal(result.status, 'unresolved');
    assert.equal(result.eventId, sourceId);
  }
});

test('a modeler reading does not adopt actor-only decision provenance and a world Event reads its own text', () => {
  const model = fixture(['perspective:modeler', 'decided-at:decision']);
  const cut = freshCut(model);
  assert.deepEqual(readingTextEvidence(cut, indexModel(model)), { status: 'unchanged', eventId: 'outcome' });
  const parent = model.meaning_model.events.find((item) => item.id === 'reading');
  parent.provenance = [];
  const worldCut = freshCut(model);
  assert.deepEqual(readingTextEvidence(worldCut, indexModel(model)), { status: 'unchanged', eventId: 'reading' });
});
