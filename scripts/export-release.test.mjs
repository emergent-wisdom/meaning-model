import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exportRelease } from './export-release.mjs';

async function fixture(files = ['README.md']) {
  const root = await mkdtemp(join(tmpdir(), 'meaning-model-release-test-'));
  await writeFile(join(root, 'release-files.json'), JSON.stringify({ files }));
  await writeFile(join(root, 'README.md'), 'Public release\n');
  await mkdir(join(root, '.git'));
  await writeFile(join(root, 'private-notes.md'), 'Not selected\n');
  return root;
}

test('exports only selected files with verifiable hashes, not local history', async () => {
  const root = await fixture();
  const { destination, files } = await exportRelease(root);
  assert.equal(files, 1);
  assert.deepEqual((await readdir(destination)).sort(), ['README.md', 'RELEASE-MANIFEST.json']);
  const manifest = JSON.parse(await readFile(join(destination, 'RELEASE-MANIFEST.json')));
  assert.equal(manifest.files[0].path, 'README.md');
  assert.equal(manifest.files[0].bytes, 15);
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
});

test('does not overwrite an existing export', async () => {
  const root = await fixture();
  const { destination } = await exportRelease(root);
  await assert.rejects(exportRelease(root, destination), { code: 'EEXIST' });
});

test('rejects traversal, Git history and symlink entries', async () => {
  for (const entry of ['../outside', '.git', '/absolute']) {
    const root = await fixture([entry]);
    await assert.rejects(exportRelease(root), /Unsafe release path/);
  }
  const root = await fixture(['linked.md']);
  await symlink(join(root, 'private-notes.md'), join(root, 'linked.md'));
  await assert.rejects(exportRelease(root), /must not be symlinks/);
});

test('fails when a required public input is absent', async () => {
  const root = await fixture(['missing.pdf']);
  await assert.rejects(exportRelease(root), { code: 'ENOENT' });
});
