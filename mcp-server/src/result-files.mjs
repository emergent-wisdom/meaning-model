// A result is never refused or cut short because of its size. One message still has to fit what the client reads in one
// go (the MCP SDK's stdio client buffers at most 10 MiB by default), so a value larger than that is written whole to a
// local JSON file and the result names the file. Lists a result shortens to save the agent's context keep their first
// entries inline, with the whole value in a file beside them.
//
// Files go into `<LIFE_SIM_STATE_FILE>.results/` beside the store, or `meaning-model-results/` in the system's temporary
// directory when the work is not saved; MEANING_MODEL_RESULTS_DIR names another folder. A file is named by the sha256 of
// its text, so the same value read twice is written once, and a file is only ever created, never changed.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringifyJson } from './exact-json.mjs';

export const RESULT_FILE_SCHEMA = 'meaning-model-result-file/v1';

export function resultFilesDirectory(environment = process.env) {
  const chosen = String(environment.MEANING_MODEL_RESULTS_DIR ?? '').trim();
  if (chosen) return resolve(chosen);
  const store = String(environment.LIFE_SIM_STATE_FILE ?? '').trim();
  return store ? resolve(`${store}.results`) : join(tmpdir(), 'meaning-model-results');
}

// Writes the value as JSON text (the exact JSON the result would have carried) and returns where it is.
export function writeResultFile(value, environment = process.env) {
  const text = stringifyJson(value, null, 2);
  const bytes = Buffer.byteLength(text, 'utf8');
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  const directory = resultFilesDirectory(environment);
  const path = join(directory, `${sha256}.json`);
  if (!existsSync(path)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const partial = join(directory, `.${sha256}.${randomBytes(6).toString('hex')}.partial`);
    try {
      const handle = openSync(partial, 'wx', 0o600);
      try {
        writeSync(handle, text, null, 'utf8');
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(partial, path);
    } finally {
      rmSync(partial, { force: true });
    }
  }
  return { schema: RESULT_FILE_SCHEMA, path, bytes, sha256 };
}
