import test from 'node:test';
import assert from 'node:assert/strict';
import { placeStoryUnits, partsAtTime, countProseWords, measureStoryUnits } from '../viewer/public/story-time.js';

const link = (node, event, relation = 'renders', family = 'grounding') => ({ family, relation,
  source: { kind: 'node', node_id: node }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: event } });
const events = [{ id: 'early', start: 2000, end: 2001 }, { id: 'late', start: 2020, end: 2021 }, { id: 'undated', start: null, end: null }];

test('only explicit grounding renders links place passages in time, preserving reading order', () => {
  const units = placeStoryUnits([{ id: 'first' }, { id: 'flashback' }, { id: 'about' }, { id: 'wrong-family' }],
    [link('first', 'late'), link('flashback', 'early'), link('about', 'early', 'about'), link('wrong-family', 'early', 'renders', 'semantic')], events);
  assert.deepEqual(units.map((unit) => [unit.id, unit.t]), [['first', 2020], ['flashback', 2000], ['about', null], ['wrong-family', null]]);
  assert.deepEqual(partsAtTime(units, 2000.5), [1]);
  assert.deepEqual(partsAtTime(units, 2020.5), [0]);
});

test('shared events and separate moments retain their individual spans', () => {
  const units = placeStoryUnits([{ id: 'both' }, { id: 'earlyOnly' }], [link('both', 'early'), link('both', 'late'), link('earlyOnly', 'early')], events);
  assert.equal(units[0].spans.length, 2);
  assert.deepEqual(partsAtTime(units, 2000.5), [0, 1]);
  assert.deepEqual(partsAtTime(units, 2020.5), [0]);
});

test('unlinked, missing and undated events do not manufacture dates', () => {
  const units = placeStoryUnits([{ id: 'unlinked' }, { id: 'missing' }, { id: 'undated' }], [link('missing', 'absent'), link('undated', 'undated')], events);
  assert.deepEqual(units.map((unit) => unit.t), [null, null, null]);
  assert.deepEqual(units.map((unit) => unit.timing), ['unlinked', 'undated', 'undated']);
  assert.deepEqual(partsAtTime(units, 2020), []);
});


test('prose length excludes Markdown headings and is additive across rendered passages', () => {
  const texts = ['# Title\r\n\r\nOne two.\r\n## Another heading\r\nThree.', '### Next\n\n#hashtag stays.'];
  assert.equal(countProseWords(texts[0]), 3);
  assert.equal(countProseWords(texts[1]), 2);
  assert.equal(countProseWords(null), 0);
  const measured = measureStoryUnits(texts.map((text, i) => ({ id: `p${i}`, text })), []);
  assert.deepEqual(measured.map((part) => part.words), [3, 2]);
  assert.equal(measured.reduce((sum, part) => sum + part.words, 0), countProseWords(texts.join('\n\n')));
});

test('adjacent linked envelopes compare before, after and overlap without imposing Event order', () => {
  const units = placeStoryUnits([{ id: 'late' }, { id: 'early' }, { id: 'late-again' }, { id: 'both' }],
    [link('late', 'late'), link('early', 'early'), link('late-again', 'late'), link('both', 'early'), link('both', 'late')], events);
  const before = JSON.stringify(units);
  const measured = measureStoryUnits(units, events);
  assert.deepEqual(measured.map((part) => part.unit.id), ['late', 'early', 'late-again', 'both']);
  assert.deepEqual(measured.map((part) => part.relativeToPrevious), [null, 'before', 'after', 'overlap']);
  assert.deepEqual(measured[3].timing.range, [2000, 2021]);
  assert.equal(measured[3].unit.spans.length, 2, 'the envelope does not fill the gap between Events');
  assert.equal(JSON.stringify(units), before, 'measurement leaves the rendered units unchanged');
});

test('partial, missing and absent links leave adjacent timing unknown rather than skipping a passage', () => {
  const units = placeStoryUnits([{ id: 'early' }, { id: 'partial' }, { id: 'late' }, { id: 'reflection' }, { id: 'back' }],
    [link('early', 'early'), link('partial', 'early'), link('partial', 'early'), link('partial', 'undated'), link('partial', 'absent'),
      link('partial', 'late', 'about'), link('partial', 'late', 'renders', 'semantic'), link('late', 'late'), link('back', 'early')], events);
  const measured = measureStoryUnits(units, events);
  assert.deepEqual(measured[1].timing, { linked: 3, dated: 1, undated: 1, missing: 1, complete: false, range: [2000, 2001] });
  assert.deepEqual(measured.map((part) => part.relativeToPrevious), [null, 'unknown', 'unknown', 'unknown', 'unknown']);
  assert.deepEqual(measured[3].timing, { linked: 0, dated: 0, undated: 0, missing: 0, complete: false, range: null });
});

test('a missing interval end is incomplete, while equal point dates overlap', () => {
  const records = [{ id: 'point', start: 2010, end: 2010 }, { id: 'no-end', start: 2011, end: null }];
  const units = placeStoryUnits([{ id: 'one' }, { id: 'same' }, { id: 'partial' }],
    [link('one', 'point'), link('same', 'point'), link('partial', 'no-end')], records);
  const measured = measureStoryUnits(units, records);
  assert.deepEqual(measured.map((part) => part.relativeToPrevious), [null, 'overlap', 'unknown']);
  assert.deepEqual(measured[2].timing, { linked: 1, dated: 0, undated: 1, missing: 0, complete: false, range: null });
});


test('prose-word positions preserve render order across roots, flashbacks and unlinked passages', () => {
  const units = [
    { id: 'book', role: 'document_root', text: '# The whole book' },
    { id: 'later', text: '## Later\nOne two three.', tells: [{ eventId: 'late' }] },
    { id: 'earlier', text: '## Flashback\nFour five.', tells: [{ eventId: 'early' }] },
    { id: 'reflection', text: 'Six.', tells: [] },
  ];
  const records = [{ id: 'late', start: 2020, end: 2021 }, { id: 'early', start: 2000, end: 2001 }];
  const original = JSON.stringify({ units, records });
  const measured = measureStoryUnits(units, records);
  assert.deepEqual(measured.map(({ unit, words, wordStart, wordEnd }) => [unit.id, words, wordStart, wordEnd]), [
    ['book', 0, 0, 0], ['later', 3, 0, 3], ['earlier', 2, 3, 5], ['reflection', 1, 5, 6],
  ]);
  assert.deepEqual(measured[1].timing.range, [2020, 2021]);
  assert.deepEqual(measured[2].timing.range, [2000, 2001]);
  assert.equal(measured[3].timing.range, null);
  assert.equal(measured.at(-1).wordEnd, countProseWords(units.map((unit) => unit.text).join('\n\n')));
  assert.equal(JSON.stringify({ units, records }), original, 'reading positions do not change the manuscript or world dates');
});
