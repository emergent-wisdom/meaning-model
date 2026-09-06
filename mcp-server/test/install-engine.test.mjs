import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { installEngine, readEnginePackageVersion, selectEngineArtifact, verifyEngineAsset } from '../src/install-engine.mjs';

const version = '0.2.3';
const selection = selectEngineArtifact(version, 'darwin', 'arm64');
const binary = Buffer.from('offline engine fixture\n');
const digest = createHash('sha256').update(binary).digest('hex');
function releaseFixture() {
  return {
    tag_name: selection.tag, draft: false,
    assets: [{
      name: selection.assetName, state: 'uploaded',
      browser_download_url: selection.downloadUrl, size: binary.length,
      digest: `sha256:${digest}`,
    }],
  };
}

async function packageFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'meaning-model-engine-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@emergent-wisdom/meaning-model-mcp', version }));
  return root;
}

function mockFetch(release = releaseFixture(), contents = binary) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if (url === selection.releaseUrl) return Response.json(release);
    assert.equal(url, selection.downloadUrl);
    return new Response(contents);
  };
  return { fetchImpl, requests };
}

test('selects only supported version-specific platform artifacts and executable names', () => {
  for (const [platform, arch, target, suffix] of [
    ['darwin', 'arm64', 'aarch64-apple-darwin', ''],
    ['darwin', 'x64', 'x86_64-apple-darwin', ''],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', ''],
    ['win32', 'x64', 'x86_64-pc-windows-msvc', '.exe'],
  ]) {
    const result = selectEngineArtifact(version, platform, arch);
    assert.equal(result.target, target);
    assert.equal(result.filename, `life-sim-engine${suffix}`);
    assert.equal(result.assetName, `life-sim-engine-v${version}-${target}${suffix}`);
    assert.equal(result.releaseUrl, `https://api.github.com/repos/emergent-wisdom/meaning-model/releases/tags/v${version}`);
  }
  assert.equal(selectEngineArtifact('1.2.3-rc.1', 'darwin', 'x64').tag, 'v1.2.3-rc.1');
  for (const badVersion of ['latest', '../0.2.3', '1.2.3/asset', '1.2.3?redirect=yes', undefined]) {
    assert.throws(() => selectEngineArtifact(badVersion), /Invalid package release version/);
  }
  for (const [platform, arch] of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'ia32'], ['freebsd', 'x64']]) {
    assert.throws(() => selectEngineArtifact(version, platform, arch), /No prebuilt engine/);
  }
});

test('reads the exact version from staged npm metadata or source metadata', async (t) => {
  const root = await packageFixture(t);
  assert.equal(await readEnginePackageVersion(root), version);
  await mkdir(join(root, 'mcp-server'));
  await copyFile(join(root, 'package.json'), join(root, 'mcp-server', 'package.json'));
  await rm(join(root, 'package.json'));
  assert.equal(await readEnginePackageVersion(root), version);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'another-package', version }));
  await assert.rejects(readEnginePackageVersion(root), /Unexpected package metadata/);
});

test('rejects missing, ambiguous, untrusted and mismatched release metadata', () => {
  for (const mutate of [
    (release) => { release.tag_name = 'v9.9.9'; },
    (release) => { release.draft = true; },
    (release) => { release.assets = []; },
    (release) => { release.assets.push({ ...release.assets[0] }); },
    (release) => { release.assets[0].browser_download_url = 'https://example.com/engine'; },
    (release) => { release.assets[0].size = 129 * 1024 * 1024; },
    (release) => { release.assets[0].size = 0; },
    (release) => { release.assets[0].digest = null; },
    (release) => { release.assets[0].digest = `md5:${digest}`; },
    (release) => { release.assets[0].state = 'new'; },
  ]) {
    const release = releaseFixture();
    mutate(release);
    assert.throws(() => verifyEngineAsset(release, selection));
  }
});

test('verifies the download and installs atomically at the package-relative default path', async (t) => {
  const root = await packageFixture(t);
  const directory = join(root, 'rust-engine', 'target', 'release');
  await mkdir(directory, { recursive: true });
  const destination = join(directory, selection.filename);
  await writeFile(destination, 'previous engine');
  const mock = mockFetch();
  const result = await installEngine({ packageRoot: root, platform: 'darwin', arch: 'arm64', fetchImpl: mock.fetchImpl });
  assert.equal(result.path, destination);
  assert.equal(result.version, version);
  assert.equal(result.sha256, digest);
  assert.deepEqual(await readFile(destination), binary);
  if (process.platform !== 'win32') assert.equal((await lstat(destination)).mode & 0o777, 0o755);
  assert.deepEqual(await readdir(directory), [selection.filename]);
  assert.deepEqual(mock.requests, [selection.releaseUrl, selection.downloadUrl]);
});

test('checksum and truncation failures preserve an existing engine', async (t) => {
  const root = await packageFixture(t);
  const directory = join(root, 'rust-engine', 'target', 'release');
  await mkdir(directory, { recursive: true });
  const destination = join(directory, selection.filename);
  await writeFile(destination, 'previous engine');
  for (const contents of [Buffer.alloc(binary.length, 120), binary.subarray(0, -1)]) {
    await assert.rejects(installEngine({
      packageRoot: root, platform: 'darwin', arch: 'arm64', fetchImpl: mockFetch(releaseFixture(), contents).fetchImpl,
    }), /SHA-256 or size verification failed/);
    assert.equal(await readFile(destination, 'utf8'), 'previous engine');
    assert.deepEqual(await readdir(directory), [selection.filename]);
  }
});

test('failed atomic replacement removes temporary files', async (t) => {
  const root = await packageFixture(t);
  const directory = join(root, 'rust-engine', 'target', 'release');
  await mkdir(join(directory, selection.filename), { recursive: true });
  await assert.rejects(installEngine({ packageRoot: root, platform: 'darwin', arch: 'arm64', fetchImpl: mockFetch().fetchImpl }));
  assert.deepEqual(await readdir(directory), [selection.filename]);
  assert.ok((await lstat(join(directory, selection.filename))).isDirectory());
});

test('refuses an installation path containing a directory symlink', async (t) => {
  const root = await packageFixture(t);
  const outside = await packageFixture(t);
  await symlink(outside, join(root, 'rust-engine'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installEngine({ packageRoot: root, platform: 'darwin', arch: 'arm64', fetchImpl: mockFetch().fetchImpl }), /symlink/);
  assert.deepEqual(await readdir(outside), ['package.json']);
});

test('missing release, HTTP errors, network failures and oversize downloads fail without installing', async (t) => {
  const root = await packageFixture(t);
  for (const fetchImpl of [
    async () => new Response('', { status: 404 }),
    async () => new Response('', { status: 429 }),
    async () => { throw new Error('offline'); },
    async () => new Response('', { headers: { 'content-length': '999999999' } }),
    async () => new Response('x'.repeat(1024 * 1024 + 1)),
    async () => new Response('{invalid JSON'),
    mockFetch(releaseFixture(), Buffer.alloc(binary.length + 1)).fetchImpl,
  ]) {
    await assert.rejects(installEngine({ packageRoot: root, platform: 'darwin', arch: 'arm64', fetchImpl }));
    assert.deepEqual(await readdir(root), ['package.json']);
  }
});

test('redirects require the GitHub HTTPS channel and have a finite limit', async (t) => {
  const root = await packageFixture(t);
  for (const location of ['https://example.com/engine', 'http://github.com/engine', 'https://github.com:444/engine', selection.releaseUrl]) {
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location } });
    };
    await assert.rejects(installEngine({ packageRoot: root, platform: 'darwin', arch: 'arm64', fetchImpl }), /official GitHub HTTPS|redirect limit/);
    assert.ok(requests <= 6);
  }
});

test('unsupported Linux libc and architectures fail before any network request', async (t) => {
  const root = await packageFixture(t);
  for (const options of [{ platform: 'linux', arch: 'x64', glibcVersion: '2.34' }, { platform: 'linux', arch: 'x64', glibcVersion: '' }, { platform: 'win32', arch: 'arm64' }]) {
    let called = false;
    await assert.rejects(installEngine({ packageRoot: root, ...options, fetchImpl: async () => { called = true; } }), /requires glibc|No prebuilt engine/);
    assert.equal(called, false);
  }
});

test('launcher help and normal startup do not invoke the installer or a build', async (t) => {
  const root = await packageFixture(t);
  const directory = join(root, 'mcp-server');
  await mkdir(join(directory, 'bin'), { recursive: true });
  await mkdir(join(directory, 'src'));
  const launcher = join(directory, 'bin', 'meaning-model-mcp.mjs');
  await copyFile(fileURLToPath(new URL('../bin/meaning-model-mcp.mjs', import.meta.url)), launcher);
  // No installer module exists here; any accidental installer import also fails this test.
  await writeFile(join(directory, 'src', 'server.mjs'), 'console.log("server started");');
  const denyFetch = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("unexpected download")};';
  for (const args of [[], ['--help']]) {
    const result = spawnSync(process.execPath, ['--import', denyFetch, launcher, ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, args.length ? /--install-engine/ : /server started/);
  }
});
