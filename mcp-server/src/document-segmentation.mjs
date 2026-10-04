import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_SEGMENTS = 20_000;

function validateText(text) {
  if (typeof text !== 'string' || !/\S/u.test(text)) throw new Error('Document text must contain non-whitespace text.');
  if (!text.isWellFormed()) throw new Error('Document text must not contain unpaired Unicode surrogates.');
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw new Error('Document text exceeds the 4 MiB UTF-8 limit.');
}

// Include separators in the preceding paragraph, preserving every source byte.
// Scan bytes rather than a repeated-group regex: a long blank-line run must
// remain linear and must not exhaust the regular-expression engine's stack.
function* paragraphEnds(buffer) {
  let previousLF = -1, runEnd;
  for (let newline = buffer.indexOf(10); newline !== -1; newline = buffer.indexOf(10, newline + 1)) {
    let blank = previousLF !== -1;
    const end = buffer[newline - 1] === 13 ? newline - 1 : newline;
    for (let index = previousLF + 1; blank && index < end; index += 1) {
      blank = buffer[index] === 32 || buffer[index] === 9;
    }
    if (blank) runEnd = newline + 1;
    else if (runEnd !== undefined) { yield runEnd; runEnd = undefined; }
    previousLF = newline;
  }
  if (runEnd !== undefined) yield runEnd;
  if (runEnd !== buffer.length) yield buffer.length;
}

function codePointBoundary(buffer, end) {
  while (end < buffer.length && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

function closerBoundary(before, after, target) {
  if (before === undefined) return after;
  if (after === undefined) return before;
  return target - before <= after - target ? before : after;
}

function wordBoundary(buffer, start, target, maximum) {
  const window = buffer.toString('utf8', start, codePointBoundary(buffer, maximum));
  let previousIndex = 0, bytes = start, before;
  for (const match of window.matchAll(/\s+/gu)) {
    const end = match.index + match[0].length;
    bytes += Buffer.byteLength(window.slice(previousIndex, end));
    previousIndex = end;
    if (bytes >= target) return closerBoundary(before, bytes, target);
    before = bytes;
  }
  return before ?? codePointBoundary(buffer, target);
}

/** Losslessly split UTF-8 text; targetBytes is a soft target, with a 2× ceiling.
 * Prefer the closest paragraph end, then whitespace, then a code-point boundary.
 * Equidistant boundaries choose the earlier one. Byte spans are end-exclusive.
 */
export function segmentDocumentText(text, { targetBytes = 4000 } = {}) {
  if (!Number.isInteger(targetBytes) || targetBytes < 256 || targetBytes > 65_536) {
    throw new Error('targetBytes must be an integer from 256 through 65536.');
  }
  validateText(text);
  const buffer = Buffer.from(text), paragraphs = paragraphEnds(buffer);
  const segments = [];
  let start = 0, nextParagraph = paragraphs.next().value;
  while (start < buffer.length) {
    if (segments.length >= MAX_SEGMENTS) throw new Error('Document exceeds the 20000-segment limit; increase targetBytes.');
    const target = start + targetBytes, maximum = Math.min(start + 2 * targetBytes, buffer.length);
    let end = buffer.length;
    if (target < buffer.length) {
      let before;
      while (nextParagraph !== undefined && nextParagraph <= target) {
        if (nextParagraph > start) before = nextParagraph;
        nextParagraph = paragraphs.next().value;
      }
      const after = nextParagraph <= maximum ? nextParagraph : undefined;
      end = closerBoundary(before, after, target) ?? wordBoundary(buffer, start, target, maximum);
    }
    segments.push({ text: buffer.toString('utf8', start, end), startByte: start, endByte: end });
    start = end;
  }
  return segments;
}

/** Read an explicitly named, bounded regular UTF-8 text/Markdown file unchanged. */
export async function readDocumentText(sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.length || sourcePath.length > 4096
    || sourcePath.includes('\0') || !isAbsolute(sourcePath) || sourcePath.split(/[\\/]/u).includes('..')) {
    throw new Error('sourcePath must be an explicit absolute local file path without parent traversal.');
  }
  const path = resolve(sourcePath), before = await lstat(path);
  if (!before.isFile()) throw new Error('sourcePath must be a regular text or Markdown file, not a directory or symbolic link.');
  if (before.size > MAX_DOCUMENT_BYTES) throw new Error('Document text exceeds the 4 MiB UTF-8 limit.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const identity = await file.stat();
    if (!identity.isFile() || identity.dev !== before.dev || identity.ino !== before.ino) {
      throw new Error('sourcePath changed while opening; retry with the intended regular file.');
    }
    const chunks = []; let bytes = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_DOCUMENT_BYTES - bytes + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > MAX_DOCUMENT_BYTES) throw new Error('Document text exceeds the 4 MiB UTF-8 limit.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const buffer = Buffer.concat(chunks, bytes);
    const signature = buffer.subarray(0, 5).toString('latin1');
    if (signature.startsWith('%PDF-') || ['PK\x03\x04', 'PK\x05\x06', 'PK\x07\x08'].some((prefix) => signature.startsWith(prefix))) {
      throw new Error('Unsupported document format: PDF and ZIP/EPUB files must first be converted to UTF-8 text or Markdown.');
    }
    if (buffer.includes(0)) throw new Error('sourcePath contains NUL bytes; use a plain UTF-8 text or Markdown file.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
    catch { throw new Error('sourcePath must contain valid UTF-8 text.'); }
    validateText(text);
    return { text, bytes, sha256: createHash('sha256').update(buffer).digest('hex') };
  } finally { await file.close(); }
}
