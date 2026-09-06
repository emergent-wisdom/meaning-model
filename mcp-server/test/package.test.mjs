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
  assert.equal(metadata.version, '0.2.0');
  assert.equal(metadata.mcpName, 'io.github.emergent-wisdom/meaning-model');
  const registry = JSON.parse(await readFile(join(packageDirectory, 'server.json'), 'utf8'));
  assert.equal(registry.name, metadata.mcpName);
  assert.equal(registry.version, metadata.version);
  assert.equal(registry.packages[0].identifier, metadata.name);
  assert.equal(registry.packages[0].version, metadata.version);
  assert.equal(registry.packages[0].transport.type, 'stdio');
  assert.equal(registry.packages[0].runtimeHint, 'npx');
  assert.deepEqual(registry.packages[0].runtimeArguments, [{ type: 'positional', value: '--yes' }]);
  assert.equal(registry.packages[0].packageArguments, undefined);
  assert.deepEqual(registry.packages[0].environmentVariables.map(({ name, isRequired, isSecret, format }) =>
    ({ name, isRequired, isSecret, format })),
  [{ name: 'LIFE_SIM_ENGINE_BIN', isRequired: true, isSecret: false, format: 'filepath' }]);
  const serverSource = await readFile(join(root, 'mcp-server', 'src', 'server.ts'), 'utf8');
  assert.ok(serverSource.includes(`version: '${metadata.version}'`));
  assert.equal(metadata.author, 'Henrik Westerberg');
  assert.equal(metadata.homepage, 'https://github.com/emergent-wisdom/meaning-model#readme');
  assert.deepEqual(metadata.repository, {
    type: 'git',
    url: 'git+https://github.com/emergent-wisdom/meaning-model.git',
    directory: 'mcp-server',
  });
  assert.equal(metadata.bugs.url, 'https://github.com/emergent-wisdom/meaning-model/issues');
  for (const keyword of ['mcp', 'mcp-server', 'model-context-protocol', 'meaning-model', 'modeling', 'simulation', 'rust']) {
    assert.ok(metadata.keywords.includes(keyword), keyword);
  }
  assert.equal(metadata.private, undefined);
  assert.equal(metadata.publishConfig.access, 'public');
  assert.equal(metadata.license, '(MIT AND CC-BY-4.0)');
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(metadata.scripts[lifecycle], undefined, lifecycle);
  }
  assert.equal(metadata.scripts.prepack, undefined);
  assert.equal(metadata.devDependencies, undefined);
  assert.equal(await readFile(join(packageDirectory, 'CHANGELOG.md'), 'utf8'),
    await readFile(join(root, 'CHANGELOG.md'), 'utf8'));
  const launcher = join(packageDirectory, metadata.bin['meaning-model-mcp']);
  if (process.platform !== 'win32') assert.ok((await stat(launcher)).mode & 0o111);
  const help = spawnSync(process.execPath, [launcher, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--build-engine/);
  assert.match(help.stdout, /--install-engine/);
  assert.match(metadata.scripts['install:engine'], /--install-engine/);
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
