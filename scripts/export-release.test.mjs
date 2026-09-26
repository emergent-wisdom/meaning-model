import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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

test('recursive source exports reject local scratch and database artifacts inside an allowed directory', async (t) => {
  const root = await fixture(['examples']);
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'examples'));
  await writeFile(join(root, 'examples', 'model.json'), '{"fixture":true}\n');
  for (const name of ['.local-work', '.local-drafts', '.private-backups', '.model-revisions', '.model-snapshots', '.conversation-scratch', 'tmp', 'temp', '.claude']) {
    const scratch = join(root, 'examples', name);
    await mkdir(scratch);
    await writeFile(join(scratch, 'conversation.json'), 'private sentinel');
    await assert.rejects(exportRelease(root), /Unsafe release path/, name);
    await rm(scratch, { recursive: true });
  }
  for (const name of ['state.sqlite', 'state.sqlite3', 'state.db', 'state.sqlite-wal', 'state.sqlite-shm', 'state.db-journal', 'draft.tmp', 'draft.temp', 'draft.bak', 'draft.swp', 'draft.swo', 'draft~']) {
    const scratch = join(root, 'examples', name);
    await writeFile(scratch, 'private sentinel');
    await assert.rejects(exportRelease(root), /Unsafe release path/, name);
    await rm(scratch);
  }
  const exported = await exportRelease(root);
  assert.equal(await readFile(join(exported.destination, 'examples', 'model.json'), 'utf8'), '{"fixture":true}\n');
});

test('source exports reject generated bundled viewer data without excluding intentional example data', async (t) => {
  const root = await fixture(['mcp-server/viewer/public', 'docs/examples']);
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicDirectory = join(root, 'mcp-server/viewer/public');
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(join(publicDirectory, 'index.html'), '<html></html>');
  await mkdir(join(root, 'docs/examples/data'), { recursive: true });
  await writeFile(join(root, 'docs/examples/data/model.json'), '{"fixture":true}\n');
  for (const name of ['data', 'renders']) {
    const generated = join(publicDirectory, name);
    await mkdir(generated);
    await writeFile(join(generated, 'model.json'), 'private viewer sentinel');
    await assert.rejects(exportRelease(root), /Unsafe release path/, name);
    await rm(generated, { recursive: true });
  }
  const exported = await exportRelease(root);
  assert.equal(await readFile(join(exported.destination, 'docs/examples/data/model.json'), 'utf8'), '{"fixture":true}\n');
});
