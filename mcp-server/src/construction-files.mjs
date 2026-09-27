import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import * as z from 'zod/v4';

export const MAX_HISTORY_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_INLINE_HISTORY_BYTES = 1024 * 1024;
export const absoluteHistoryPath = z.string().min(1).max(4_096).refine((value) =>
  !value.includes('\0') && isAbsolute(value) && !value.split(/[\\/]/u).includes('..'),
  'Use an explicit absolute local file path without parent traversal.');

// Match the existing JSON.stringify(sorted-object replacer) checksum without
// constructing a second, potentially enormous, complete history string.
function* jsonTokens(value) {
  if (value === null || typeof value !== 'object') { yield JSON.stringify(value) ?? 'null'; return; }
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
    yield JSON.stringify(key); yield ':'; yield* jsonTokens(value[key]);
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
