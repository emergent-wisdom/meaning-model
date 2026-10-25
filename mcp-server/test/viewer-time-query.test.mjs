import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeQuery } from '../viewer/public/time-query.js';

const years = { unit: 'year', present: 2025 };
const span = (query, clock = years) => { const found = parseTimeQuery(query, clock); return found && [found.start, found.end, found.label]; };

test('calendar years, ranges and eras read as the views label them', () => {
  assert.deepEqual(span('1914'), [1914, 1915, '1914']);
  assert.deepEqual(span('1914-1945'), [1914, 1946, '1914 to 1945']);
  assert.deepEqual(span('1914–1945'), [1914, 1946, '1914 to 1945']);
  assert.deepEqual(span('from 1914 to 1945'), [1914, 1946, '1914 to 1945']);
  assert.deepEqual(span('1945 to 1914'), [1914, 1946, '1914 to 1945']);
  assert.deepEqual(span('500 BCE'), [-500, -499, '500 BCE']);
  assert.deepEqual(span('300 BCE to 100 CE'), [-300, 101, '300 BCE to 100']);
  assert.deepEqual(span('500-300 bce'), [-500, -299, '500 BCE to 300 BCE']);
  assert.deepEqual(span('AD 800'), [800, 801, '800']);
  assert.deepEqual(span('10,000 BCE'), [-10000, -9999, '10,000 BCE']);
});

test('decades, centuries and millennia', () => {
  assert.deepEqual(span('the 1990s'), [1990, 2000, 'the 1990s']);
  assert.deepEqual(span('1800s'), [1800, 1900, 'the 1800s']);
  assert.deepEqual(span('19th century'), [1800, 1900, 'the 19th century']);
  assert.deepEqual(span('the 5th century BCE'), [-500, -400, 'the 5th century BCE']);
  assert.deepEqual(span('2nd millennium'), [1000, 2000, 'the 2nd millennium']);
});

test('"years ago" counts back from the model\'s present', () => {
  assert.deepEqual(span('30,000 years ago'), [-27975 - 3000, -27975 + 3000, 'about 30,000 years ago']);
  assert.deepEqual(span('2.5 million years ago'), [2025 - 2.75e6, 2025 - 2.25e6, 'about 2.5 million years ago']);
  assert.deepEqual(span('30,000 years ago to 10,000 years ago'), [-27975, -7975, '30,000 years ago to 10,000 years ago']);
  assert.equal(parseTimeQuery('30,000 years ago', { unit: 'year' }), null, 'no present, no "ago"');
});

test('anything that is not wholly a time is left to the record search', () => {
  for (const query of ['World War II', 'the 1914 crisis', 'Alexander\'s conquests, 334 to 323 BCE', 'rome', '', 'Europe 1500']) {
    assert.equal(parseTimeQuery(query, years), null, query);
  }
});

test('a clock that is not a calendar takes numbers of its own unit and never says years', () => {
  const clock = { unit: 'step', present: 100 };
  assert.deepEqual(span('12', clock), [12, 12, '12 step']);
  assert.deepEqual(span('12-40', clock), [12, 40, '12 to 40 step']);
  assert.deepEqual(span('40 to 12', clock), [12, 40, '12 to 40 step']);
  assert.equal(parseTimeQuery('19th century', clock), null);
  assert.equal(parseTimeQuery('30 years ago', clock), null);
});

test('civil days convert through the calendar the views draw with', () => {
  const found = parseTimeQuery('2001', { unit: 'civil_day_since_1970', present: 2025 });
  assert.ok(Math.abs(found.start - 2001) < 0.01 && Math.abs(found.end - 2002) < 0.01, JSON.stringify(found));
  assert.equal(found.label, '2001');
});
