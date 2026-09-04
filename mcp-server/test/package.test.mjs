import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { stageNpmPackage } from '../scripts/pack-release.mjs';

test('npm stage contains an executable JavaScript server, Rust sources, and every reading resource', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'meaning-model-package-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { packageDirectory } = await stageNpmPackage(root, temporary);
  const metadata = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  assert.equal(metadata.name, '@emergent-wisdom/meaning-model-mcp');
  assert.equal(metadata.private, undefined);
  assert.equal(metadata.publishConfig.access, 'public');
  assert.equal(metadata.license, '(MIT AND CC-BY-4.0)');
  assert.equal(metadata.scripts.postinstall, undefined);
  assert.equal(metadata.scripts.prepack, undefined);
  assert.equal(metadata.devDependencies, undefined);
  const launcher = join(packageDirectory, metadata.bin['meaning-model-mcp']);
  assert.ok((await stat(launcher)).mode & 0o111);
  const help = spawnSync(process.execPath, [launcher, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--build-engine/);
  const sources = await readdir(join(packageDirectory, 'mcp-server', 'src'));
  assert.ok(sources.includes('server.mjs'));
  assert.ok(!sources.some((name) => name.endsWith('.ts')));
  const parsed = spawnSync(process.execPath, ['--check', join(packageDirectory, 'mcp-server', 'src', 'server.mjs')], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  for (const path of ['rust-engine/Cargo.toml', 'rust-engine/Cargo.lock', 'rust-engine/src/main.rs', 'LICENSE', 'LICENSE-CONTENT', 'NOTICE']) {
    assert.ok((await stat(join(packageDirectory, path))).isFile(), path);
  }
  for (const path of ['rust-engine/target', 'node_modules', '.git']) {
    await assert.rejects(stat(join(packageDirectory, path)), { code: 'ENOENT' });
  }
  const guidance = await import(pathToFileURL(join(packageDirectory, 'mcp-server', 'src', 'modeling-guidance.mjs')).href);
  for (const resource of guidance.listModelingResources()) {
    const loaded = await guidance.readModelingResource(resource.uri);
    assert.ok(loaded.bytes > 0, resource.uri);
  }
});
