import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = new Set(['.git', '.DS_Store', 'node_modules', 'target']);

export async function exportRelease(root, destination) {
  root = resolve(root);
  const specification = JSON.parse(await readFile(join(root, 'release-files.json'), 'utf8'));
  const selected = new Set();

  async function collect(name) {
    if (isAbsolute(name) || name.split(/[\\/]/).some(part => part === '..' || forbidden.has(part))) {
      throw new Error(`Unsafe release path: ${name}`);
    }
    const source = join(root, name);
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`Release paths must not be symlinks: ${name}`);
    if (info.isDirectory()) {
      for (const child of (await readdir(source)).sort()) await collect(join(name, child));
    } else if (info.isFile()) {
      selected.add(name);
    } else {
      throw new Error(`Unsupported release entry: ${name}`);
    }
  }

  for (const name of specification.files) await collect(name);
  for (const name of specification.optional ?? []) {
    try { await collect(name); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  if (destination) {
    destination = resolve(destination);
    const rel = relative(root, destination);
    if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)
      && !rel.startsWith('build' + sep))) {
      throw new Error('An in-repository export must be a new directory beneath build/.');
    }
    // Non-recursive mkdir refuses an existing tree instead of overwriting it.
    await mkdir(destination);
  } else {
    await mkdir(join(root, 'build'), { recursive: true });
    destination = await mkdtemp(join(root, 'build', 'release-'));
  }

  const files = [];
  for (const name of [...selected].sort()) {
    const source = join(root, name);
    const bytes = await readFile(source);
    const target = join(destination, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    files.push({ path: name.split(sep).join('/'), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(destination, 'RELEASE-MANIFEST.json'), JSON.stringify({
    purpose: 'Clean source and artifact export; not a published release or Git history.',
    files,
  }, null, 2) + '\n');
  return { destination, files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/export-release.mjs');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await exportRelease(root);
  console.log(`Exported ${result.files} files without Git history to ${result.destination}`);
}
