import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodeCursor, encodeCursor, pagedText, readKey, textPart } from '../src/paging.mjs';

test('text pages retain complete Unicode characters and always make progress', () => {
  const text = '😀aÅ😀\n"\\end';
  for (const size of [1, 2, 3, 4, 10, 100]) {
    let cursor, start = 0; const parts = [];
    do {
      const result = pagedText(text, { kind: 'definition', key: 'same-read', cursor, size });
      assert.equal(result.start, start);
      assert.ok(result.end > result.start);
      assert.equal(result.text.isWellFormed(), true);
      assert.equal(result.sha256, createHash('sha256').update(text).digest('hex'));
      parts.push(result.text); start = result.end; cursor = result.nextCursor;
    } while (cursor);
    assert.equal(parts.join(''), text);
    assert.equal(start, text.length);
  }
  assert.deepEqual(textPart('\ud800x', 0, 1), { part: '\ud800', end: 1 }, 'a lone surrogate is preserved as authored');
  assert.deepEqual(textPart('', 0, 1), { part: '', end: 0 });
  for (const size of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => textPart('abc', 0, size), /positive integer/);
});

test('a cursor belongs to its read and kind, and cannot point outside the text', () => {
  const key = readKey({ modelHash: 'a', scopes: ['author'] });
  const cursor = encodeCursor('outline', key, 3);
  assert.equal(decodeCursor(cursor, 'outline', key, 3), 3);
  assert.throws(() => decodeCursor(cursor, 'definition', key, 3), /not one for definition/);
  assert.throws(() => decodeCursor(cursor, 'outline', readKey({ modelHash: 'b', scopes: ['author'] }), 3), /another outline read/);
  for (const at of [-1, 4]) assert.throws(() => decodeCursor(encodeCursor('outline', key, at), 'outline', key, 3), /past the end/);
  for (const at of [1.5, null, '1']) assert.throws(() => decodeCursor(encodeCursor('outline', key, at), 'outline', key, 3), /not one for outline/);
  assert.throws(() => decodeCursor('not-a-cursor', 'outline', key, 3), /not one for outline/);
});

test('serialized page limits include escaped text, metadata and cursors without losing characters', () => {
  const text = '"\\\n\t\u0000😀'.repeat(120);
  const options = { kind: 'definition', key: 'same-read', size: 400_000 };
  assert.equal(pagedText(text, options).text, text, 'calls without the optional limit keep their prior size');
  let cursor; const parts = [];
  do {
    const page = pagedText(text, { ...options, cursor, maxSerializedChars: 400 });
    assert.ok(JSON.stringify(page).length <= 400);
    assert.ok(page.text.length > 0);
    assert.equal(page.text.isWellFormed(), true);
    parts.push(page.text); cursor = page.nextCursor;
  } while (cursor);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(''), text);
  const large = pagedText('"\\'.repeat(210_000), { ...options, maxSerializedChars: 400_000 });
  assert.ok(JSON.stringify(large).length <= 400_000);
  assert.ok(large.end < 400_000, 'escaped quotes and backslashes fit the actual wire limit');
  const small = pagedText('a small result', options);
  assert.deepEqual(pagedText('a small result', { ...options, maxSerializedChars: 400_000 }), small);
  assert.throws(() => pagedText('😀', { ...options, maxSerializedChars: 1 }), /cannot hold/);
});
