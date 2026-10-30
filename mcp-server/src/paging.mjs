// Long read results in parts. A client keeps one tool result to about 50,000 characters (Claude Code saves a longer one
// to a file the agent may not open), so a read that grows with the model, the process tree in an outline or a whole
// model definition, comes back one part at a time: each part says where the next one starts with an opaque cursor.
// A cursor is bound to what was read (the model and graph revision, and the read's options), so it cannot continue a
// different read; and since revisions never change, the same read always renders the same text.
import { createHash } from 'node:crypto';

const CURSOR_VERSION = 1;

/// A short key for a read: the hash of what it reads and how.
export function readKey(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

export function encodeCursor(kind, key, at) {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, kind, key, at })).toString('base64url');
}

/// Where a cursor continues, after checking that it belongs to this read.
export function decodeCursor(cursor, kind, key, total) {
  let parsed;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { parsed = null; }
  if (parsed?.v !== CURSOR_VERSION || parsed.kind !== kind || !Number.isSafeInteger(parsed.at)) throw new Error(`The cursor is not one for ${kind} parts; pass the nextCursor that the previous ${kind} part returned.`);
  if (parsed.key !== key) throw new Error(`The cursor belongs to another ${kind} read; repeat the read with the same arguments it came from, or start again without a cursor.`);
  if (parsed.at < 0 || parsed.at > total) throw new Error(`The cursor points past the end of this ${kind}.`);
  return parsed.at;
}

/// The part of a text from start, ending on a whole character. A pair of UTF-16 surrogates is never split; a size of
/// one may use two code units to return that one character and make progress. Returns the part's end too.
export function textPart(text, start, size) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('A text part must have a positive integer size.');
  let end = Math.min(text.length, start + size);
  if (end < text.length && end > start) {
    const last = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += end === start + 1 ? 1 : -1;
  }
  return { part: text.slice(start, end), end };
}

/// A whole text read in parts: one part, with its place, the sha256 of the whole (so a reader can check what it put
/// back together), and the cursor to the next part when there is one. An optional serialized limit includes escaped
/// text, metadata and the cursor; the raw character count alone does not bound an MCP result's size.
export function pagedText(text, { kind, key, cursor = null, size, maxSerializedChars }) {
  const start = cursor ? decodeCursor(cursor, kind, key, text.length) : 0;
  const sha256 = createHash('sha256').update(text).digest('hex');
  const page = (characters) => {
    const { part, end } = textPart(text, start, characters);
    return {
      text: part, start, end, totalChars: text.length, sha256,
      nextCursor: end < text.length ? encodeCursor(kind, key, end) : null,
    };
  };
  const requested = page(size);
  if (maxSerializedChars === undefined) return requested;
  if (!Number.isSafeInteger(maxSerializedChars) || maxSerializedChars <= 0) throw new Error('A serialized text part must have a positive integer limit.');
  if (JSON.stringify(requested).length <= maxSerializedChars) return requested;
  let low = 1, high = Math.min(size, text.length - start) - 1, best = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = page(middle);
    if (JSON.stringify(candidate).length <= maxSerializedChars) { best = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  if (!best) throw new Error('The serialized text part limit cannot hold its metadata and one whole character.');
  return best;
}
