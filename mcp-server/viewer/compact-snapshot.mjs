#!/usr/bin/env node
// Writes the compact form of a viewer snapshot (see public/snapshot-format.js) for static hosting:
//   node compact-snapshot.mjs <snapshot.json> <directory>
// The directory receives <name>.json (meaning-model-viewer/3) and one file per part beside it. Serve them where the
// snapshot was served; the viewer bundled with this package reads either form. The original file is never changed,
// and after writing, the compact form is read back and compared with it.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { packSnapshot, openSnapshot, whenAllParts } from './public/snapshot-format.js';

const [input, directory] = process.argv.slice(2);
if (!input || !directory) { console.error('Usage: node compact-snapshot.mjs <snapshot.json> <directory>'); process.exit(2); }
const name = basename(input).replace(/\.json$/u, '');
const target = resolve(directory, `${name}.json`);
if (target === resolve(input)) { console.error('Write the compact form to another directory: it would replace the original.'); process.exit(2); }
const text = await readFile(input, 'utf8');
const data = JSON.parse(text);
const { snapshot, parts } = packSnapshot(data, { name, sha256: (value) => createHash('sha256').update(value).digest('hex') });
const body = JSON.stringify(snapshot);
const files = new Map([[`${name}.json`, body], ...parts.map((part) => [part.file, part.text])]);
// Read back exactly as the viewer will, from these texts, before anything is written.
const opened = await openSnapshot(JSON.parse(body), { url: 'file:///snapshot/', fetch: async (address) => {
  const file = decodeURIComponent(new URL(address).pathname.split('/').pop());
  return files.has(file) ? { ok: true, json: async () => JSON.parse(files.get(file)) } : { ok: false, status: 404 };
} });
await whenAllParts(opened);
if (!isDeepStrictEqual(opened, JSON.parse(text))) { console.error('The compact form does not read back as the original; nothing was written.'); process.exit(1); }
await mkdir(directory, { recursive: true });
for (const [file, content] of files) await writeFile(join(directory, file), content);
const size = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
console.log(`${name}: ${size(text.length)} became ${size(body.length)} to open with, and ${parts.map((part) => `${part.path} ${size(part.text.length)}`).join(', ') || 'no parts'} when a view needs it.`);
