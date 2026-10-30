import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryFileWriter, openHistoryFile } from '../src/history-stream.mjs';
import { encodeHistoryModels, HISTORY_FILE_SCHEMA_V2, HISTORY_SCHEMA, historyDigest, historyJsonChunks } from '../src/construction-files.mjs';

const CHUNK = 1024 * 1024;
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), 'meaning-history-stream-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function readAll(path) {
  const file = await openHistoryFile(path);
  try {
    const lists = {};
    for (const label of ['models', 'revisions']) {
      lists[label] = [];
      for await (const entry of file.entries(label)) lists[label].push(entry);
    }
    await file.unchanged();
    return { fields: file.fields, lists, digest: file.fileSha256 };
  } finally { await file.close(); }
}

test('streamed histories reject mismatched delimiters, incomplete lists and trailing content', async (t) => {
  const directory = await folder(t);
  const malformed = [
    '{"models":[},"revisions":[]}',
    '{"models":[],"revisions":[}}',
    '{"models":[{"nested":[}]}]}',
    '{"models":[{}},"revisions":[]}',
    '{"models":[{},],"revisions":[]}',
    '{"models":[,{}],"revisions":[]}',
    '{"models":[{} {}],"revisions":[]}',
    '{"models":[{"note":"ends with an escape\\',
    '{"models":[{"note":true}],"revisions":[{}]',
    '{"models":[{}],"revisions":[]} false',
    '{"models":[{}],"revisions":[],}',
  ];
  for (const [index, text] of malformed.entries()) {
    assert.throws(() => JSON.parse(text));
    const path = join(directory, `${index}.json`);
    await writeFile(path, text);
    await assert.rejects(readAll(path), /not valid JSON|not an object/, text);
  }
});

test('top-level metadata keeps ordinary JSON property semantics, including prototype-shaped keys', async (t) => {
  const directory = await folder(t);
  const path = join(directory, 'metadata.json');
  const text = '{"__proto__":{"marker":"metadata"},"constructor":"named","toString":7,"models":[],"revisions":[]}';
  await writeFile(path, text);
  const actual = await readAll(path);
  const { models, revisions, ...expected } = JSON.parse(text);
  assert.deepEqual(actual.fields, expected);
  assert.equal(Object.getPrototypeOf(actual.fields), Object.prototype);
  assert.equal(Object.hasOwn(actual.fields, '__proto__'), true);
  assert.equal(actual.fields.marker, undefined);
  assert.equal(actual.digest, sha(text));
  for (const duplicate of [
    '{"__proto__":{},"__proto__":{},"models":[]}',
    '{"models":[],"m\\u006fdels":[]}',
    '{"constructor":1,"constructor":2,"models":[]}',
  ]) {
    await writeFile(path, duplicate);
    await assert.rejects(readAll(path), /appears twice/);
  }
});

test('streamed values, escaped keys and UTF-8 survive read boundaries', async (t) => {
  const directory = await folder(t);
  const body = '{"m\\u006fdels":[{"note":"Åsa 😀 with \\\"quotes\\\" and \\\\ braces } ]","value":-0.0}],"revisions":[{}],"tail":false}';
  const boundaryPoints = [1, 5, 8, body.indexOf('['), body.indexOf('Å'), body.indexOf('😀') + 1, body.indexOf('quotes'), body.lastIndexOf('false') + 2];
  const expected = JSON.parse(body);
  for (const [index, point] of boundaryPoints.entries()) {
    const prefixBytes = Buffer.byteLength(body.slice(0, point));
    const text = ' '.repeat(CHUNK - prefixBytes) + body;
    const path = join(directory, `${index}.json`);
    await writeFile(path, text);
    const actual = await readAll(path);
    assert.deepEqual(actual.lists.models.map((entry) => entry.value), expected.models);
    assert.deepEqual(actual.lists.revisions.map((entry) => entry.value), expected.revisions);
    assert.equal(Object.is(actual.lists.models[0].value.value, -0), true);
    assert.equal(actual.digest, sha(text));
  }
  const note = 'x'.repeat(2 * CHUNK) + '😀 \\ "';
  const path = join(directory, 'large-entry.json');
  await writeFile(path, JSON.stringify({ models: [{ note }], revisions: [] }));
  const actual = await readAll(path);
  assert.equal(actual.lists.models[0].value.note, note);
  assert.equal(actual.lists.models[0].bytes, Buffer.byteLength(JSON.stringify({ note })));
  assert.equal(actual.lists.models[0].sha256, sha(JSON.stringify({ note })));
});

test('streamed entries reject invalid UTF-8 and files cannot be opened through a symbolic link', async (t) => {
  const directory = await folder(t);
  const path = join(directory, 'entry.json');
  await writeFile(path, Buffer.concat([Buffer.from('{"models":[{"note":"'), Buffer.from([0xf0, 0x80]), Buffer.from('"}],"revisions":[]}')]));
  await assert.rejects(readAll(path), /not valid UTF-8/);
  await writeFile(path, '{"models":[],"revisions":[]}');
  const link = join(directory, 'linked.json');
  try { await symlink(path, link); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return; throw error; }
  await assert.rejects(openHistoryFile(link), /regular JSON file/);
});

test('streaming writer preserves canonical bytes and checksum, including unusual metadata and negative zero', async (t) => {
  const directory = await folder(t);
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const models = [
    { modelHash: a, definition: { id: 'm', revision: { previous_model_hash: null }, note: 'x'.repeat(2000), value: -0 } },
    { modelHash: b, definition: { id: 'm', revision: { previous_model_hash: a }, note: 'x'.repeat(2000), value: 1 } },
  ];
  const revisions = [{ graphHash: 'c'.repeat(64), definition: { note: 'Åsa 😀', value: -0 } }];
  const header = JSON.parse('{"graphId":"g","__proto__":{"record":"kept"},"constructor":"a field","toString":"also a field"}');
  const expanded = { ...header, schema: HISTORY_SCHEMA, revisionCount: revisions.length, models, revisions };
  const bundleSha256 = historyDigest(expanded).sha256;
  const expected = [...historyJsonChunks({ ...expanded, schema: HISTORY_FILE_SCHEMA_V2, models: encodeHistoryModels(models), bundleSha256 })].join('');
  const destination = join(directory, 'history.json');
  const writer = await HistoryFileWriter.create(destination);
  try {
    for (const entry of revisions) await writer.addRevision(entry);
    writer.beginModels(header, [a, b], new Map([[a, null], [b, a]]));
    for (const [index, entry] of models.entries()) await writer.addModel(index, entry.modelHash, entry.definition);
    const result = await writer.finish();
    assert.equal(result.bundleSha256, bundleSha256);
    assert.equal(result.fileSha256, sha(expected));
    assert.equal(await readFile(destination, 'utf8'), expected);
    assert.deepEqual(await readdir(directory), ['history.json']);
    const actual = await readAll(destination);
    assert.deepEqual(actual.fields.__proto__, header.__proto__);
    assert.equal(actual.fields.constructor, 'a field');
    assert.equal(actual.fields.toString, 'also a field');
  } finally { await writer.abort(); }
});
