// Which instructions the server gives the calling agent, so that nobody is held to ours. MEANING_MODEL_INSTRUCTIONS
// chooses:
//   full (the default)   the Meaning Model's own instructions;
//   simple               the method in a few sentences and where the documentation lives (MEANING_MODEL_SIMPLE=1 is
//                        its older name), with each tool described by its first sentence;
//   <absolute path>      a Markdown file whose text replaces ours;
//   full+<absolute path> ours, followed by the file's text.
// Only what the server tells the agent changes. The tools, their checks and the guides stay as they are, and the guides
// stay readable on request; simple and replacement-file modes offer them as reference and require none of them.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const INSTRUCTION_MODES = Object.freeze(['full', 'simple', 'custom', 'full+custom']);
export const MAX_INSTRUCTIONS_BYTES = 64 * 1024;

function readInstructionsFile(path, setting) {
  if (!isAbsolute(path)) throw new Error(`MEANING_MODEL_INSTRUCTIONS is full, simple, the absolute path of a Markdown file, or full+ followed by one; ${setting} is none of these.`);
  let text;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error('it is not a regular file');
    if (stat.size > MAX_INSTRUCTIONS_BYTES) throw new Error(`it has ${stat.size} bytes, over the limit of ${MAX_INSTRUCTIONS_BYTES}`);
    text = readFileSync(path, 'utf8').trim();
  } catch (error) {
    throw new Error(`MEANING_MODEL_INSTRUCTIONS names ${path}, which cannot be used: ${error.message}.`);
  }
  if (!text) throw new Error(`MEANING_MODEL_INSTRUCTIONS names ${path}, which is empty.`);
  return text;
}

// The chosen instructions, read once when the server starts. A setting that cannot be honoured stops the server with
// the reason, rather than giving the agent instructions the user did not choose.
export function resolveAgentInstructions(environment = process.env) {
  const setting = String(environment.MEANING_MODEL_INSTRUCTIONS ?? '').trim();
  if (!setting) return { mode: environment.MEANING_MODEL_SIMPLE === '1' ? 'simple' : 'full' };
  if (setting === 'full' || setting === 'simple') return { mode: setting };
  const appended = setting.startsWith('full+');
  const path = appended ? setting.slice('full+'.length) : setting;
  const text = readInstructionsFile(path, setting);
  return { mode: appended ? 'full+custom' : 'custom', path, text, sha256: createHash('sha256').update(text).digest('hex') };
}

// Some clients keep only the first 2,048 characters of the instructions (Claude Code does). The whole text is readable
// at this address with life_modeling_read; a user's file added to ours ends it, under its own heading, and is also
// readable alone at the second address.
export const INSTRUCTIONS_URI = 'life-sim://server/instructions';
export const CONFIGURED_INSTRUCTIONS_URI = 'life-sim://server/configured-instructions';
export const CONFIGURED_SECTION = 'Configured instructions';
export const CLIENT_KEEPS = 2_048;
// The user's instructions come first in a session that has them. Where ours are added before them, the opening of ours
// says to read the user's whole before anything else (server.ts); where the user's replace ours and are longer than such
// a client keeps, a one-line preface says so (composeInstructions).
export const configuredReadFirst = `Before anything else, read the instructions this server's user configured, whole, at ${CONFIGURED_INSTRUCTIONS_URI} with life_modeling_read. They are the user's: where they differ from the Meaning Model's guidance, follow them.`;
// A user's file that replaces ours and is longer than such a client keeps opens with one short line before it, outside
// the user's Markdown (so it can never land inside a code example), saying to read the whole before acting.
const customPreface = `[Read these instructions whole before you act, at ${CONFIGURED_INSTRUCTIONS_URI} with life_modeling_read: your client may keep only their first ${CLIENT_KEEPS.toLocaleString('en')} characters.]`;

// The server instructions for a resolved choice, from the full and simple texts the server defines. A user's own file
// is given as written, after a one-line preface saying to read it whole only when it is longer than such a client keeps.
export function composeInstructions(resolved, { full, simple }) {
  if (resolved.mode === 'simple') return simple;
  if (resolved.mode === 'custom') return resolved.text.length > CLIENT_KEEPS ? `${customPreface}\n\n${resolved.text}` : resolved.text;
  if (resolved.mode === 'full+custom') return `${full}\n\n# ${CONFIGURED_SECTION}\n\n${resolved.text}`;
  return full;
}

// Whether the user's configured instructions must be read whole before acting: always when they follow ours, which a
// client cuts long before them; when they replace ours, only when they are longer than such a client keeps.
export const configuredMustBeRead = (resolved) => resolved.mode === 'full+custom' || (resolved.mode === 'custom' && resolved.text.length > CLIENT_KEEPS);

// Whether the session follows the Meaning Model's own instructions, which require the guides and ask the opening
// questions. Simple and custom sessions are told only what their instructions say.
export const followsOurInstructions = (mode) => mode === 'full' || mode === 'full+custom';
