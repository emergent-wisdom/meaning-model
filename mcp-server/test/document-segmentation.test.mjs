import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_DOCUMENT_BYTES, readDocumentText, segmentDocumentText } from '../src/document-segmentation.mjs';

function conserved(text, options) {
  const segments = segmentDocumentText(text, options), buffer = Buffer.from(text);
  assert.equal(segments.map((segment) => segment.text).join(''), text);
  assert.deepEqual(segments, segmentDocumentText(text, options), 'segmentation is deterministic');
  let offset = 0;
  for (const segment of segments) {
    assert.ok(segment.text.length > 0);
    assert.ok(segment.text.isWellFormed());
    assert.equal(segment.startByte, offset);
    assert.equal(segment.endByte - segment.startByte, Buffer.byteLength(segment.text));
    assert.deepEqual(Buffer.from(segment.text), buffer.subarray(segment.startByte, segment.endByte));
    assert.ok(segment.endByte - segment.startByte <= 2 * (options?.targetBytes ?? 4000));
    offset = segment.endByte;
  }
  assert.equal(offset, buffer.length);
  return segments;
}

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-document-segmentation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('paragraph grouping preserves leading/trailing whitespace, LF, CRLF and blank lines', () => {
  const first = `  ${'a'.repeat(116)}\r\n \t\r\n`, second = `${'b'.repeat(120)}\n\n`;
  const text = first + second + `${'c'.repeat(250)}\r\n\r\n\t\n  `;
  const segments = conserved(text, { targetBytes: 256 });
  assert.equal(segments[0].text, first + second, 'nearby short paragraphs are grouped');
  assert.ok(segments.length > 1);
  const small = '\ufeff\t  # Heading\r\n\r\nA paragraph.  \n\n';
  assert.deepEqual(conserved(small), [{ text: small, startByte: 0, endByte: Buffer.byteLength(small) }]);
});

test('multilingual text and emoji retain exact bytes even through long passages', () => {
  const text = `\ufeff${'Åsa 中文 العربية हिन्दी 😀 🧑🏽‍🚀 e\u0301\u2003'.repeat(500)}\n\n${'𐐷界🙂'.repeat(500)}`;
  const segments = conserved(text, { targetBytes: 257 });
  assert.ok(segments.length > 30);
  assert.ok(segments.some((segment) => segment.endByte - segment.startByte !== segment.text.length));
});

test('long paragraphs split at nearby word boundaries before cutting code points', () => {
  const text = 'word '.repeat(300);
  const segments = conserved(text, { targetBytes: 256 });
  assert.equal(segments[0].text, 'word '.repeat(51));
  assert.ok(segments.every((segment) => segment.text.endsWith(' ')));
  const unicodeSpaces = conserved('word\u2003'.repeat(300), { targetBytes: 256 });
  assert.ok(unicodeSpaces.every((segment) => segment.text.endsWith('\u2003')));
  const unbroken = conserved('🙂'.repeat(2000), { targetBytes: 257 });
  assert.equal(unbroken[0].text, '🙂'.repeat(64));
  assert.equal(unbroken[0].endByte, 256);
});

test('paragraph boundaries take priority over nearer words, with earlier ties', () => {
  const first = `${'a'.repeat(190)}\n\n`, second = `${'word '.repeat(44)}${'b'.repeat(34)}\n\n`;
  const text = first + second + 'tail '.repeat(300);
  assert.equal(conserved(text, { targetBytes: 256 })[0].text, first);
  const tie = `${'a'.repeat(254)}\n\n${'b'.repeat(254)}\n\n${'c'.repeat(700)}`;
  assert.equal(conserved(tie, { targetBytes: 384 })[0].endByte, 256);
});

test('input bounds reject malformed or oversized text before returning segments', () => {
  for (const text of ['', ' \t\r\n\u2003', null, 1, {}, '\ud800', 'a\udfff', '\ud800a']) {
    assert.throws(() => segmentDocumentText(text), /non-whitespace|surrogates/);
  }
  for (const targetBytes of [0, 255, 65_537, 256.5, NaN, Infinity, '4000', null]) {
    assert.throws(() => segmentDocumentText('text', { targetBytes }), /targetBytes/);
  }
  assert.throws(() => segmentDocumentText('🙂'.repeat(MAX_DOCUMENT_BYTES / 4 + 1)), /4 MiB/);
  const maximum = 'x'.repeat(MAX_DOCUMENT_BYTES);
  const segments = segmentDocumentText(maximum, { targetBytes: 256 });
  assert.ok(segments.length > 10_000 && segments.length <= 20_000);
  assert.equal(segments.at(-1).endByte, MAX_DOCUMENT_BYTES);
  assert.equal(segments.map((segment) => segment.text).join(''), maximum);
  assert.ok(conserved('x'.repeat(200_000), { targetBytes: 65_536 }).length > 1);
  assert.throws(() => segmentDocumentText(`${'x'.repeat(171)}\n\n`.repeat(23_000), { targetBytes: 256 }), /20000-segment.*increase targetBytes/);
});

test('very long blank-line runs and whitespace lines do not exhaust the parser stack', () => {
  conserved('\n'.repeat(MAX_DOCUMENT_BYTES - 1) + 'x');
  conserved(('\r\n' + ' \t'.repeat(30_000)).repeat(60) + 'x');
});

test('local loader preserves BOM, multichunk UTF-8, metadata and source file contents', async (t) => {
  const directory = await temporary(t), path = join(directory, 'book.md');
  const text = `\ufeff${'x'.repeat(65_532)}🙂\r\n\r\n${'中文 and prose.\n'.repeat(6000)}  `;
  const original = Buffer.from(text);
  await writeFile(path, original);
  const before = await stat(path), entries = await readdir(directory);
  const result = await readDocumentText(path);
  assert.deepEqual(result, { text, bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') });
  conserved(result.text);
  assert.deepEqual(await readFile(path), original);
  const after = await stat(path);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.mode, before.mode);
  assert.deepEqual(await readdir(directory), entries, 'reading creates no sidecar files');
});

test('local loader rejects ambiguous paths, directories, symlinks and oversized files', async (t) => {
  const directory = await temporary(t), path = join(directory, 'book.txt');
  await writeFile(path, 'Original text.');
  for (const sourcePath of ['', 'book.txt', `${directory}/../book.txt`, `${path}\0`, null, 42, '/'.repeat(4097)]) {
    await assert.rejects(readDocumentText(sourcePath), /explicit absolute/);
  }
  await assert.rejects(readDocumentText(directory), /regular text or Markdown file/);
  if (process.platform !== 'win32') {
    const link = join(directory, 'linked.txt');
    await symlink(path, link);
    await assert.rejects(readDocumentText(link), /regular text or Markdown file/);
  }
  const oversized = join(directory, 'oversized.txt');
  await writeFile(oversized, '');
  await truncate(oversized, MAX_DOCUMENT_BYTES + 1);
  await assert.rejects(readDocumentText(oversized), /4 MiB/);
  assert.equal(await readFile(path, 'utf8'), 'Original text.');
  assert.equal((await stat(oversized)).size, MAX_DOCUMENT_BYTES + 1);
});

test('local loader accepts the exact byte limit and detects content without a filename extension', async (t) => {
  const directory = await temporary(t), path = join(directory, 'book');
  const content = Buffer.from('界'.repeat(Math.floor(MAX_DOCUMENT_BYTES / 3)) + 'x');
  assert.equal(content.length, MAX_DOCUMENT_BYTES);
  await writeFile(path, content);
  const result = await readDocumentText(path);
  assert.equal(result.bytes, MAX_DOCUMENT_BYTES);
  assert.deepEqual(Buffer.from(result.text), content);
  assert.deepEqual(await readFile(path), content);
});

test('local loader rejects invalid UTF-8, binary NUL and empty documents without changing files', async (t) => {
  const directory = await temporary(t);
  const inputs = [
    [Buffer.from([0xff, 0xfe]), /valid UTF-8/],
    [Buffer.from([0xed, 0xa0, 0x80]), /valid UTF-8/],
    [Buffer.concat([Buffer.from('x'.repeat(65_535)), Buffer.from([0xf0, 0x9f])]), /valid UTF-8/],
    [Buffer.from('text\0binary'), /NUL/],
    [Buffer.from('%PDF-1.7\nASCII PDF object syntax'), /Unsupported document format.*PDF/],
    [Buffer.from('PK\x03\x04\0ZIP-based EPUB'), /Unsupported document format.*EPUB/],
    [Buffer.from(''), /non-whitespace/],
    [Buffer.from('\ufeff \r\n\t'), /non-whitespace/],
  ];
  for (const [index, [content, pattern]] of inputs.entries()) {
    const path = join(directory, `invalid-${index}.txt`);
    await writeFile(path, content);
    await assert.rejects(readDocumentText(path), pattern);
    assert.deepEqual(await readFile(path), content);
  }
  assert.equal((await readdir(directory)).length, inputs.length);
});
