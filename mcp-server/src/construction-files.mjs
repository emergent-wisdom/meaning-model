import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import * as z from 'zod/v4';
import { stringifyJson } from './exact-json.mjs';
import { applyModelDelta, computeModelDelta, MODEL_DELTA_SCHEMA } from './model-delta.mjs';

export const MAX_HISTORY_FILE_BYTES = 256 * 1024 * 1024;
export const HISTORY_SCHEMA = 'meaning-model-construction-history/v1';
// A v2 file writes each model revision whose previous revision it also holds as its changes from that one. Reading
// expands them, so the history a reader sees, and its bundleSha256, do not depend on how the file was written.
export const HISTORY_FILE_SCHEMA_V2 = 'meaning-model-construction-history/v2';

// The engine holds at most 512 model revisions in a session, each at most 8 MiB.
export const MAX_HISTORY_MODELS = 512;
export const MAX_HISTORY_MODEL_BYTES = 8 * 1024 * 1024;
// A reader expanding a file in order keeps a model expanded until the last entry written as changes from it, and never
// more than eight of the largest models' worth at once, however small the file. A file written here never needs more.
export const MAX_HISTORY_KEPT_BYTES = 64 * 1024 * 1024;
const MODEL_HASH = /^[a-f0-9]{64}$/u;

/// Writes each model revision as its changes from its previous revision when the file holds that one earlier, the
/// changes are smaller, and a reader would still be keeping it: keeping what a reader keeps within maximumKeptBytes,
/// a revision whose previous one it could not keep is written whole, so every file written here can be read back.
export function encodeHistoryModels(models, maximumKeptBytes = MAX_HISTORY_KEPT_BYTES) {
  const at = new Map(models.map(({ modelHash }, i) => [modelHash, i]));
  const lastChild = models.map((_, i) => i);
  const parents = models.map(({ definition }, i) => {
    const parent = at.get(definition?.revision?.previous_model_hash);
    if (parent === undefined || parent >= i) return null;
    lastChild[parent] = i;
    return parent;
  });
  const kept = new Map(); let keptBytes = 0;
  return models.map(({ modelHash, definition }, i) => {
    let entry = { modelHash, definition };
    const parent = parents[i];
    if (parent !== null && kept.has(parent)) {
      const delta = computeModelDelta(models[parent].definition, definition);
      const changes = delta && { modelHash, baseModelHash: models[parent].modelHash, delta };
      if (changes && stringifyJson(changes).length < stringifyJson(entry).length) entry = changes;
    }
    for (const [earlier, bytes] of kept) if (lastChild[earlier] <= i) { kept.delete(earlier); keptBytes -= bytes; }
    if (lastChild[i] > i) {
      const bytes = Buffer.byteLength(stringifyJson(definition));
      if (keptBytes + bytes <= maximumKeptBytes) { kept.set(i, bytes); keptBytes += bytes; }
    }
    return entry;
  });
}

/// Checks a history's models as written, without expanding any: what each entry is, that every change names an
/// earlier entry, and how many there are. The plan records which entry each change is kept against and the last entry
/// that needs each one, so expanding can release a model as soon as nothing later is kept against it.
export function planHistoryModels(history) {
  const schema = history?.schema;
  if (schema !== HISTORY_SCHEMA && schema !== HISTORY_FILE_SCHEMA_V2) throw new Error(`Unsupported construction history schema ${schema}.`);
  const models = history.models;
  if (!Array.isArray(models)) throw new Error('A construction history lists its models.');
  if (models.length > MAX_HISTORY_MODELS) throw new Error(`A construction history may hold at most ${MAX_HISTORY_MODELS} models; this one holds ${models.length}.`);
  const index = new Map(), bases = [], lastUse = models.map((_, i) => i);
  models.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`History model ${i} is not an entry.`);
    if (typeof entry.modelHash !== 'string' || !MODEL_HASH.test(entry.modelHash)) throw new Error(`History model ${i} lacks a valid modelHash.`);
    if (index.has(entry.modelHash)) throw new Error(`History model ${i} repeats ${entry.modelHash}.`);
    const whole = entry.definition !== undefined, changes = entry.delta !== undefined;
    if (whole === changes) throw new Error(`History model ${i} must hold exactly one of a definition or a delta.`);
    if (whole) {
      if (!entry.definition || typeof entry.definition !== 'object' || Array.isArray(entry.definition)) throw new Error(`History model ${i} has no valid definition.`);
      bases.push(null);
    } else {
      if (schema !== HISTORY_FILE_SCHEMA_V2) throw new Error(`History model ${i} is written as changes, which a ${schema} file cannot hold.`);
      if (entry.delta?.schema !== MODEL_DELTA_SCHEMA || !Array.isArray(entry.delta.changes)) throw new Error(`History model ${i} has no valid model delta.`);
      const base = index.get(entry.baseModelHash);
      if (base === undefined) throw new Error(`History model ${i} is written as changes from ${entry.baseModelHash}, which the file does not hold before it.`);
      bases.push(base);
      lastUse[base] = i;
    }
    index.set(entry.modelHash, i);
  });
  return { count: models.length, bases, lastUse };
}

/// Expands the models in order, one at a time, each at most MAX_HISTORY_MODEL_BYTES, keeping an expanded model only
/// until the last change kept against it, and refusing a file that would need more than maximumKeptBytes of them kept
/// at once. Memory follows how many models are still needed, never the history's length.
export function* expandHistoryModels(history, plan = planHistoryModels(history), { maximumKeptBytes = MAX_HISTORY_KEPT_BYTES, onRetained } = {}) {
  // A model is kept as its JSON, which is what its bytes count and what the engine and the checksum read.
  const kept = new Map(); let keptBytes = 0;
  for (const [i, entry] of history.models.entries()) {
    const base = plan.bases[i];
    const definition = base === null ? entry.definition : applyModelDelta(JSON.parse(kept.get(base).json), entry.delta);
    const json = stringifyJson(definition), bytes = Buffer.byteLength(json);
    if (bytes > MAX_HISTORY_MODEL_BYTES) throw new Error(`History model ${i} is ${bytes} bytes once expanded; a model may be at most ${MAX_HISTORY_MODEL_BYTES}.`);
    if (base !== null && plan.lastUse[base] <= i) { keptBytes -= kept.get(base).bytes; kept.delete(base); }
    if (plan.lastUse[i] > i) {
      keptBytes += bytes;
      if (keptBytes > maximumKeptBytes) throw new Error(`Reading history model ${i} would keep ${kept.size + 1} expanded models at once, ${keptBytes} bytes; a reader keeps at most ${maximumKeptBytes}.`);
      kept.set(i, { json, bytes });
    }
    onRetained?.(kept.size);
    yield { modelHash: entry.modelHash, definition };
  }
}

/// The bundleSha256 of a history as a reader sees it, expanded, computed while expanding one model at a time; it
/// equals historyDigest of the expanded history without building it. `models` are its expanded models, in order.
export function expandedHistoryDigest(history, plan, models = expandHistoryModels(history, plan)) {
  const { bundleSha256: _, ...content } = history;
  const logical = { ...content, schema: HISTORY_SCHEMA };
  const digest = createHash('sha256');
  let parts = [], length = 0;
  const flush = () => { digest.update(parts.join('')); parts = []; length = 0; };
  for (const token of expandedTokens(logical, models)) {
    parts.push(token); length += token.length;
    if (length >= 64 * 1024) flush();
  }
  flush();
  return digest.digest('hex');
}

function* expandedTokens(content, models) {
  // The same key order and token rules as jsonTokens, with the models streamed in place.
  const sorted = Object.keys(Object.fromEntries(Object.keys(content).sort().map((key) => [key, null])));
  yield '{'; let first = true;
  for (const key of sorted) {
    const value = content[key];
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') continue;
    if (!first) yield ','; first = false;
    yield stringifyJson(key); yield ':';
    if (key !== 'models') { yield* jsonTokens(value); continue; }
    yield '['; let index = 0;
    for (const model of models) { if (index) yield ','; index += 1; yield* jsonTokens(model); }
    yield ']';
  }
  yield '}';
}

/// The history with every model expanded; for small histories and tests. An import streams instead.
export function decodeHistoryModels(history) {
  if (history?.schema !== HISTORY_FILE_SCHEMA_V2) return history;
  return { ...history, schema: HISTORY_SCHEMA, models: [...expandHistoryModels(history)] };
}
export const MAX_INLINE_HISTORY_BYTES = 1024 * 1024;
export const absoluteHistoryPath = z.string().min(1).max(4_096).refine((value) =>
  !value.includes('\0') && isAbsolute(value) && !value.split(/[\\/]/u).includes('..'),
  'Use an explicit absolute local file path without parent traversal.');

// Match the existing sorted-object checksum, preserving negative zero, without
// constructing a second, potentially enormous, complete history string.
function* jsonTokens(value) {
  if (value === null || typeof value !== 'object') { yield stringifyJson(value) ?? 'null'; return; }
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i += 1) { if (i) yield ','; yield* jsonTokens(value[i]); }
    yield ']'; return;
  }
  // JSON enumerates integer keys numerically even after lexicographic insertion.
  const sorted = Object.keys(Object.fromEntries(Object.keys(value).sort().map((key) => [key, null])));
  yield '{'; let first = true;
  for (const key of sorted) {
    if (value[key] === undefined || typeof value[key] === 'function' || typeof value[key] === 'symbol') continue;
    if (!first) yield ','; first = false;
    yield stringifyJson(key); yield ':'; yield* jsonTokens(value[key]);
  }
  yield '}';
}
export function* historyJsonChunks(value) {
  let parts = [], length = 0;
  for (const token of jsonTokens(value)) {
    parts.push(token); length += token.length;
    if (length >= 64 * 1024) { yield parts.join(''); parts = []; length = 0; }
  }
  if (parts.length) yield parts.join('');
}
export function historyDigest(value, maximumBytes = MAX_HISTORY_FILE_BYTES) {
  const digest = createHash('sha256'); let bytes = 0;
  for (const chunk of historyJsonChunks(value)) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maximumBytes) throw new Error(`Construction history exceeds ${maximumBytes} UTF-8 bytes. ${maximumBytes <= MAX_INLINE_HISTORY_BYTES ? 'Use destinationPath to export it to a local JSON file instead of an inline MCP response.' : 'The portable-file limit is 256 MiB.'}`);
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest('hex') };
}

export async function writeHistoryFile(destinationPath, history) {
  const path = resolve(absoluteHistoryPath.parse(destinationPath));
  if (path.endsWith(sep)) throw new Error('destinationPath must name a new JSON file.');
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('destinationPath already exists; construction exports never overwrite a file.');
    if (error.code === 'ENOENT') throw new Error('destinationPath parent directory must already exist.');
    throw error;
  }
  const identity = await file.stat(), digest = createHash('sha256'); let bytes = 0;
  try {
    for (const chunk of historyJsonChunks(history)) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > MAX_HISTORY_FILE_BYTES) throw new Error('Construction history exceeds the 256 MiB portable-file limit.');
      digest.update(buffer); let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
        if (!bytesWritten) throw new Error('Construction export could not finish writing its file.');
        offset += bytesWritten;
      }
    }
    await file.sync(); await file.close();
    return { path, bytes, fileSha256: digest.digest('hex') };
  } catch (error) {
    await file.close().catch(() => {});
    const current = await lstat(path).catch(() => null);
    if (current?.dev === identity.dev && current?.ino === identity.ino) await unlink(path).catch(() => {});
    throw error;
  }
}

export async function readHistoryFile(sourcePath) {
  const path = resolve(absoluteHistoryPath.parse(sourcePath)), before = await lstat(path);
  if (!before.isFile()) throw new Error('sourcePath must be a regular JSON file, not a directory or symbolic link.');
  if (before.size > MAX_HISTORY_FILE_BYTES) throw new Error('Construction history exceeds the 256 MiB portable-file limit.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const identity = await file.stat();
    if (!identity.isFile() || identity.dev !== before.dev || identity.ino !== before.ino) throw new Error('sourcePath changed while opening; retry with the intended regular file.');
    const chunks = []; let bytes = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_HISTORY_FILE_BYTES - bytes + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > MAX_HISTORY_FILE_BYTES) throw new Error('Construction history exceeds the 256 MiB portable-file limit.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const buffer = Buffer.concat(chunks, bytes);
    const history = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    return { history, path, bytes, fileSha256: createHash('sha256').update(buffer).digest('hex') };
  } finally { await file.close(); }
}
