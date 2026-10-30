// Read and write construction history one revision at a time, avoiding a whole-file JSON string and a retained
// array of expanded models. The reader indexes top-level fields and entry boundaries; the writer computes the bundle
// checksum while revisions pass through it. Payload memory follows the entries being processed, while entry metadata
// still grows with the number of revisions. The output format and canonical bytes remain compatible.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { stringifyJson } from './exact-json.mjs';
import { computeModelDelta } from './model-delta.mjs';
import { absoluteHistoryPath, HISTORY_FILE_SCHEMA_V2, HISTORY_SCHEMA, historyJsonChunks, MAX_HISTORY_KEPT_BYTES, writeLocalJsonChunks } from './construction-files.mjs';

const CHUNK_BYTES = 1024 * 1024;
// One entry is parsed as one string: a whole model is at most 128 MiB written compactly, a graph revision written whole
// may be larger, and both stay under the longest string Node holds.
export const MAX_HISTORY_ENTRY_BYTES = 400 * 1024 * 1024;
// A field other than the models and revisions is small: a hash, a count, a list of heads.
const MAX_HISTORY_FIELD_BYTES = 16 * 1024 * 1024;
const STREAMED_FIELDS = new Set(['models', 'revisions']);

const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c, COLON = 0x3a;
const OPEN_BRACE = 0x7b, CLOSE_BRACE = 0x7d, OPEN_BRACKET = 0x5b, CLOSE_BRACKET = 0x5d;
const isSpace = (byte) => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
const malformed = (detail) => new Error(`The construction history file is not valid JSON: ${detail}.`);
const decoder = new TextDecoder('utf-8', { fatal: true });

// Finds where one JSON value ends, a byte at a time, without parsing it. step returns 1 when the value ends with this
// byte, -1 when it ended just before it (a number or a literal ends at the first byte not part of it), and 0 otherwise.
// Streamed lists are not parsed whole, so their brackets must match here too.
class ValueEnd {
  constructor() { this.kind = null; this.closing = []; this.inString = false; this.escaped = false; }
  step(byte) {
    if (this.kind === null) {
      if (byte === QUOTE) { this.kind = 'string'; this.inString = true; return 0; }
      if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
        this.kind = 'nested'; this.closing.push(byte === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET); return 0;
      }
      this.kind = 'literal';
      return 0;
    }
    if (this.kind === 'literal') return byte === COMMA || byte === CLOSE_BRACE || byte === CLOSE_BRACKET || isSpace(byte) ? -1 : 0;
    if (this.inString) {
      if (this.escaped) this.escaped = false;
      else if (byte === BACKSLASH) this.escaped = true;
      else if (byte === QUOTE) { this.inString = false; if (this.kind === 'string') return 1; }
      return 0;
    }
    if (byte === QUOTE) { this.inString = true; return 0; }
    if (byte === OPEN_BRACE || byte === OPEN_BRACKET) { this.closing.push(byte === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET); return 0; }
    if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
      if (this.closing.pop() !== byte) throw malformed('a closing bracket does not match its opening bracket');
      return this.closing.length === 0 ? 1 : 0;
    }
    return 0;
  }
}

async function readAt(file, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await file.read(buffer, read, length - read, position + read);
    if (!bytesRead) throw new Error('The construction history file changed while it was read.');
    read += bytesRead;
  }
  return buffer;
}

function parseBytes(pieces, what) {
  let text;
  try { text = decoder.decode(Buffer.concat(pieces)); } catch { throw new Error(`${what} is not valid UTF-8.`); }
  try { return JSON.parse(text); } catch (cause) { throw malformed(`${what}: ${cause.message}`); }
}

// One pass over the file: its sha256, its top-level fields (the small ones parsed), and where the models and revisions
// lie.
async function scanTopLevel(file, size) {
  const digest = createHash('sha256');
  const fields = {}, ranges = {};
  let state = 'start', key = null, keyPieces = [], keyBytes = 0, keyEscaped = false, scanner = null, valueStart = 0;
  let pieces = [], pieceBytes = 0;
  for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
    const chunk = await readAt(file, offset, Math.min(CHUNK_BYTES, size - offset));
    digest.update(chunk);
    let from = state === 'value' || state === 'key-string' ? 0 : -1;
    const keep = (end) => {
      if (from < 0 || end <= from) return;
      const piece = chunk.subarray(from, end);
      if (state === 'key-string') {
        keyBytes += piece.length;
        if (keyBytes > 4_096) throw malformed('a top-level key is too long');
        keyPieces.push(piece);
      } else if (!STREAMED_FIELDS.has(key)) {
        pieceBytes += piece.length;
        if (pieceBytes > MAX_HISTORY_FIELD_BYTES) throw new Error(`The construction history field ${key} is larger than ${MAX_HISTORY_FIELD_BYTES} bytes.`);
        pieces.push(piece);
      }
    };
    for (let i = 0; i < chunk.length; i += 1) {
      const byte = chunk[i];
      if (state === 'start') {
        if (isSpace(byte)) continue;
        if (byte !== OPEN_BRACE) throw malformed('it is not an object');
        state = 'first-key';
      } else if (state === 'first-key' || state === 'key') {
        if (isSpace(byte)) continue;
        if (state === 'first-key' && byte === CLOSE_BRACE) { state = 'end'; continue; }
        if (byte !== QUOTE) throw malformed('a top-level key is not a string');
        state = 'key-string'; keyPieces = []; keyBytes = 0; keyEscaped = false; from = i;
      } else if (state === 'key-string') {
        if (keyEscaped) { keyEscaped = false; continue; }
        if (byte === BACKSLASH) { keyEscaped = true; continue; }
        if (byte !== QUOTE) continue;
        keep(i + 1);
        key = parseBytes(keyPieces, 'A top-level key');
        if (Object.hasOwn(fields, key) || Object.hasOwn(ranges, key)) throw malformed(`the key ${key} appears twice`);
        state = 'colon'; from = -1;
      } else if (state === 'colon') {
        if (isSpace(byte)) continue;
        if (byte !== COLON) throw malformed(`no colon after the key ${key}`);
        state = 'value-start';
      } else if (state === 'value-start') {
        if (isSpace(byte)) continue;
        if (STREAMED_FIELDS.has(key) && byte !== OPEN_BRACKET) throw new Error(`The construction history's ${key} is not a list.`);
        scanner = new ValueEnd(); scanner.step(byte);
        valueStart = offset + i; pieces = []; pieceBytes = 0; from = i; state = 'value';
      } else if (state === 'value') {
        const ended = scanner.step(byte);
        if (ended === 0) continue;
        const end = ended === 1 ? i + 1 : i;
        keep(end);
        if (STREAMED_FIELDS.has(key)) ranges[key] = { start: valueStart, end: offset + end };
        else Object.defineProperty(fields, key, {
          value: parseBytes(pieces, `The field ${key}`), enumerable: true, writable: true, configurable: true,
        });
        state = 'after-value'; from = -1;
        if (ended === -1) i -= 1;
      } else if (state === 'after-value') {
        if (isSpace(byte)) continue;
        if (byte === COMMA) state = 'key';
        else if (byte === CLOSE_BRACE) state = 'end';
        else throw malformed(`unexpected content after the field ${key}`);
      } else if (!isSpace(byte)) {
        throw malformed('content follows the closing brace');
      }
    }
    if (state === 'value' || state === 'key-string') keep(chunk.length);
  }
  if (state !== 'end') throw malformed('it ends before its closing brace');
  return { fields, ranges, fileSha256: digest.digest('hex') };
}

// The entries of one streamed list, in order, each parsed alone: its value, the sha256 of its bytes and their count.
async function* readEntries(file, range, label) {
  if (!range) return;
  const last = range.end - 1;
  let state = 'before', scanner = null, pieces = [], pieceBytes = 0, index = 0;
  for (let offset = range.start + 1; offset < last; offset += CHUNK_BYTES) {
    const chunk = await readAt(file, offset, Math.min(CHUNK_BYTES, last - offset));
    let from = state === 'entry' ? 0 : -1;
    const ready = [];
    for (let i = 0; i < chunk.length; i += 1) {
      const byte = chunk[i];
      if (state === 'before' || state === 'next') {
        if (isSpace(byte)) continue;
        if (byte !== OPEN_BRACE) throw new Error(`History ${label} entry ${index} is not an object.`);
        scanner = new ValueEnd(); scanner.step(byte); pieces = []; pieceBytes = 0; from = i; state = 'entry';
      } else if (state === 'entry') {
        if (scanner.step(byte) !== 1) continue;
        pieces.push(chunk.subarray(from, i + 1)); pieceBytes += i + 1 - from;
        ready.push(finishEntry(pieces, pieceBytes, label, index));
        index += 1; from = -1; state = 'after';
      } else if (isSpace(byte)) {
        continue;
      } else if (byte === COMMA) {
        state = 'next';
      } else {
        throw malformed(`unexpected content between the ${label} entries`);
      }
    }
    if (state === 'entry') {
      pieces.push(chunk.subarray(from)); pieceBytes += chunk.length - from;
      if (pieceBytes > MAX_HISTORY_ENTRY_BYTES) throw new Error(`History ${label} entry ${index} is larger than ${MAX_HISTORY_ENTRY_BYTES} bytes.`);
    }
    for (const entry of ready) yield entry;
  }
  if (state === 'entry' || state === 'next') throw malformed(`the ${label} list ends inside an entry`);
}

function finishEntry(pieces, bytes, label, index) {
  if (bytes > MAX_HISTORY_ENTRY_BYTES) throw new Error(`History ${label} entry ${index} is larger than ${MAX_HISTORY_ENTRY_BYTES} bytes.`);
  const buffer = Buffer.concat(pieces, bytes);
  return { value: parseBytes([buffer], `History ${label} entry ${index}`), sha256: createHash('sha256').update(buffer).digest('hex'), bytes };
}

/// Opens a history file to read it without holding it whole. Its fields are read once, with its sha256; then its
/// models and revisions can be read, as often as needed, one entry at a time. A regular file only, never through a link.
export async function openHistoryFile(sourcePath) {
  const path = resolve(absoluteHistoryPath.parse(sourcePath));
  const before = await lstat(path);
  if (!before.isFile()) throw new Error('sourcePath must be a regular JSON file, not a directory or symbolic link.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const identity = await file.stat();
    if (!identity.isFile() || identity.dev !== before.dev || identity.ino !== before.ino) throw new Error('sourcePath changed while opening; retry with the intended regular file.');
    const { fields, ranges, fileSha256 } = await scanTopLevel(file, identity.size);
    const unchanged = async () => {
      const now = await file.stat();
      if (now.size !== identity.size || now.mtimeMs !== identity.mtimeMs) throw new Error('The construction history file changed while it was imported; nothing after this point was stored.');
    };
    return {
      path, bytes: identity.size, fileSha256, fields, hasModels: Boolean(ranges.models), hasRevisions: Boolean(ranges.revisions),
      entries: (label) => readEntries(file, ranges[label], label),
      unchanged,
      close: () => file.close(),
    };
  } catch (error) {
    await file.close().catch(() => {});
    throw error;
  }
}

// Writes the tokens of each chunk to an open file.
async function writeAll(file, text) {
  const buffer = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new Error('Construction export could not finish writing its file.');
    offset += bytesWritten;
  }
  return buffer.length;
}

// The keys of a history object in the order its checksum and its file put them.
const sortedKeys = (keys) => Object.keys(Object.fromEntries([...keys].sort().map((key) => [key, null])));

/// Writes a history file one revision at a time. The graph revisions come first (addRevision), then the models in their
/// order (beginModels, addModel), each written as its changes from an earlier one by encodeHistoryModels' rules. The
/// bundle checksum covers the history as a reader sees it, expanded, and is computed as the models pass; since it is
/// the file's first key, the models and revisions wait in two temporary files beside the destination, and finish
/// assembles the file from them. A failure removes everything.
export class HistoryFileWriter {
  static async create(destinationPath) {
    const path = resolve(absoluteHistoryPath.parse(destinationPath));
    if (path.endsWith(sep)) throw new Error('destinationPath must name a new JSON file.');
    // Refuse at once what the final write would refuse, before the long work.
    if (await lstat(path).then(() => true, (error) => (error.code === 'ENOENT' ? false : Promise.reject(error)))) {
      throw new Error('destinationPath already exists; construction exports never overwrite a file.');
    }
    const directory = dirname(path);
    if (!(await lstat(directory).then((found) => found.isDirectory(), () => false))) throw new Error('destinationPath parent directory must already exist.');
    const part = (name) => join(directory, `.${basename(path)}.${randomUUID()}.${name}.part`);
    const writer = new HistoryFileWriter(path);
    try {
      writer.modelsPath = part('models'); writer.models = await open(writer.modelsPath, 'wx', 0o600);
      writer.revisionsPath = part('revisions'); writer.revisions = await open(writer.revisionsPath, 'wx', 0o600);
    } catch (error) {
      await writer.abort();
      throw error;
    }
    return writer;
  }

  constructor(path) {
    this.path = path;
    this.revisionCount = 0; this.revisionBytes = 0;
    this.modelCount = 0; this.modelBytes = 0;
    this.digest = null; this.header = null; this.plan = null;
    this.kept = new Map(); this.keptBytes = 0;
  }

  async addRevision(entry) {
    let written = this.revisionCount ? await writeAll(this.revisions, ',') : 0;
    for (const chunk of historyJsonChunks(entry)) written += await writeAll(this.revisions, chunk);
    this.revisionCount += 1; this.revisionBytes += written;
  }

  /// header: the history's other fields (graphId, headGraphHash and any more), known before the models. ordered: the
  /// models' hashes in file order; parentOf: each one's previous revision.
  beginModels(header, ordered, parentOf) {
    this.header = header;
    const at = new Map(ordered.map((modelHash, i) => [modelHash, i]));
    const lastChild = ordered.map((_, i) => i);
    const parents = ordered.map((modelHash, i) => {
      const parent = at.get(parentOf.get(modelHash));
      if (parent === undefined || parent >= i) return null;
      lastChild[parent] = i;
      return parent;
    });
    this.plan = { ordered, parents, lastChild };
    // The checksum's tokens up to the models, as expandedHistoryDigest makes them.
    this.digest = createHash('sha256');
    this.logicalKeys = sortedKeys([...Object.keys(header), 'models', 'revisionCount', 'revisions', 'schema']);
    let first = true;
    this.digest.update('{');
    for (const key of this.logicalKeys) {
      if (key === 'models') break;
      if (header[key] === undefined) continue;
      this.digest.update(`${first ? '' : ','}${stringifyJson(key)}:`);
      for (const chunk of historyJsonChunks(header[key])) this.digest.update(chunk);
      first = false;
    }
    this.digest.update(`${first ? '' : ','}"models":[`);
  }

  /// The model at position i of the order, whole: added to the checksum as it is, and written as its changes from its
  /// previous revision when that one is still kept and the changes are smaller.
  async addModel(i, modelHash, definition) {
    if (this.plan.ordered[i] !== modelHash || i !== this.modelCount) throw new Error('Models must be added in their order.');
    if (i) this.digest.update(',');
    for (const chunk of historyJsonChunks({ modelHash, definition })) this.digest.update(chunk);
    let entry = { modelHash, definition };
    const parent = this.plan.parents[i];
    if (parent !== null && this.kept.has(parent)) {
      const delta = computeModelDelta(this.kept.get(parent).definition, definition);
      const changes = delta && { modelHash, baseModelHash: this.plan.ordered[parent], delta };
      if (changes && stringifyJson(changes).length < stringifyJson(entry).length) entry = changes;
    }
    for (const [earlier, { bytes }] of this.kept) if (this.plan.lastChild[earlier] <= i) { this.kept.delete(earlier); this.keptBytes -= bytes; }
    if (this.plan.lastChild[i] > i) {
      const bytes = Buffer.byteLength(stringifyJson(definition));
      if (this.keptBytes + bytes <= MAX_HISTORY_KEPT_BYTES) { this.kept.set(i, { definition, bytes }); this.keptBytes += bytes; }
    }
    let written = i ? await writeAll(this.models, ',') : 0;
    for (const chunk of historyJsonChunks(entry)) written += await writeAll(this.models, chunk);
    this.modelCount += 1; this.modelBytes += written;
  }

  async *#chunksOf(path) {
    const file = await open(path, 'r');
    try {
      for (let position = 0; ; position += CHUNK_BYTES) {
        const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
        const { bytesRead } = await file.read(buffer, 0, CHUNK_BYTES, position);
        if (!bytesRead) return;
        yield buffer.subarray(0, bytesRead);
      }
    } finally { await file.close(); }
  }

  /// Completes the checksum and writes the file. Returns the file's path, bytes and sha256, and the bundle checksum.
  async finish() {
    if (this.plan.ordered.length !== this.modelCount) throw new Error('Not every model was added.');
    await this.models.sync(); await this.models.close(); this.models = null;
    await this.revisions.sync(); await this.revisions.close(); this.revisions = null;
    // The rest of the checksum: the fields after the models, the revisions as written, and the fields after them, with
    // the schema of the expanded history (v1).
    const after = { ...this.header, revisionCount: this.revisionCount, schema: HISTORY_SCHEMA };
    const fieldsAfter = (from, to) => this.logicalKeys.slice(this.logicalKeys.indexOf(from) + 1, to === null ? undefined : this.logicalKeys.indexOf(to))
      .filter((key) => after[key] !== undefined)
      .map((key) => `,${stringifyJson(key)}:${[...historyJsonChunks(after[key])].join('')}`).join('');
    this.digest.update(`]${fieldsAfter('models', 'revisions')},"revisions":[`);
    for await (const chunk of this.#chunksOf(this.revisionsPath)) this.digest.update(chunk);
    this.digest.update(`]${fieldsAfter('revisions', null)}}`);
    const bundleSha256 = this.digest.digest('hex');
    // The file: the same fields with the checksum first and the v2 schema, the models as written.
    const fileHeader = { ...this.header, bundleSha256 };
    const fileKeys = sortedKeys([...Object.keys(fileHeader), 'models', 'revisionCount', 'revisions', 'schema']);
    const fileAfter = { revisionCount: this.revisionCount, schema: HISTORY_FILE_SCHEMA_V2 };
    const self = this;
    const chunks = async function* () {
      let first = true;
      yield '{';
      for (const key of fileKeys) {
        const value = Object.hasOwn(fileAfter, key) ? fileAfter[key] : fileHeader[key];
        if (key === 'models') {
          yield `${first ? '' : ','}"models":[`; first = false;
          yield* self.#chunksOf(self.modelsPath);
          yield ']';
          continue;
        }
        if (key === 'revisions') {
          yield `${first ? '' : ','}"revisions":[`; first = false;
          yield* self.#chunksOf(self.revisionsPath);
          yield ']';
          continue;
        }
        if (value === undefined) continue;
        yield `${first ? '' : ','}${stringifyJson(key)}:`; first = false;
        yield* historyJsonChunks(value);
      }
      yield '}';
    };
    try {
      const file = await writeLocalJsonChunks(this.path, chunks(), { maximumBytes: Number.MAX_SAFE_INTEGER,
        tooLarge: 'Construction history is too large to write.', exists: 'destinationPath already exists; construction exports never overwrite a file.',
        unfinished: 'Construction export could not finish writing its file.' });
      return { ...file, bundleSha256 };
    } finally {
      await this.abort();
    }
  }

  /// Removes the temporary files.
  async abort() {
    for (const handle of [this.models, this.revisions]) await handle?.close().catch(() => {});
    this.models = null; this.revisions = null;
    for (const path of [this.modelsPath, this.revisionsPath]) if (path) await unlink(path).catch(() => {});
  }
}
