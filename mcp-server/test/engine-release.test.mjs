import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selectEngineArtifact } from '../src/install-engine.mjs';

test('release publication requires four version-matched binaries with valid checksums and no extra files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'meaning-model-release-verification-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'build', 'engine-release');
  await mkdir(output, { recursive: true });
  await mkdir(join(root, 'mcp-server', 'scripts'), { recursive: true });
  await mkdir(join(root, 'mcp-server', 'src'));
  const script = join(root, 'mcp-server', 'scripts', 'package-engine-release.mjs');
  await copyFile(fileURLToPath(new URL('../scripts/package-engine-release.mjs', import.meta.url)), script);
  await copyFile(fileURLToPath(new URL('../src/install-engine.mjs', import.meta.url)), join(root, 'mcp-server', 'src', 'install-engine.mjs'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@emergent-wisdom/meaning-model-mcp', version: '0.2.3' }));
  const assets = [];
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['win32', 'x64']]) {
    const { assetName } = selectEngineArtifact('0.2.3', platform, arch);
    const bytes = Buffer.from(`not an executable: ${assetName}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const asset = join(output, assetName);
    assets.push(asset);
    await writeFile(asset, bytes);
    await writeFile(`${asset}.sha256`, `${digest}  ${assetName}\n`);
  }
  const verify = (tag = 'v0.2.3') => spawnSync(process.execPath, [script, '--verify'], {
    encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag },
  });
  const accepted = verify();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /Verified all four/);
  assert.notEqual(verify('v0.2.4').status, 0);
  await writeFile(join(output, 'unexpected-engine'), 'extra');
  assert.match(verify().stderr, /exactly four binaries/);
  await rm(join(output, 'unexpected-engine'));
  await writeFile(assets[0], 'tampered bytes');
  assert.match(verify().stderr, /Checksum mismatch/);
  await rm(assets[0]);
  assert.notEqual(verify().status, 0);
});
