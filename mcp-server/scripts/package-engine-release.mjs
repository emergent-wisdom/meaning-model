import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installEngine, readEnginePackageVersion, selectEngineArtifact } from '../src/install-engine.mjs';

async function smokeEngine(binaryPath, version, root) {
  const { RustEngineProcess } = await import('../src/rust-engine-process.mjs');
  const backend = new RustEngineProcess({ binaryPath });
  try {
    const description = await backend.initialize();
    assert.equal(description.engine, 'life-sim-engine');
    assert.equal(description.schemas.command, 'life-sim-rust-command/v1');
    assert.ok(description.operations.includes('compile_profiles'));
  } finally {
    await backend.close();
  }

  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'meaning-model-platform-release-smoke', version });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'mcp-server', 'bin', 'meaning-model-mcp.mjs')],
      env: { ...process.env, LIFE_SIM_ENGINE_BIN: binaryPath },
    }));
    const { tools } = await client.listTools();
    assert.ok(tools.some(({ name }) => name === 'life_engine_status'));
    const status = await client.callTool({ name: 'life_engine_status', arguments: {} });
    assert.notEqual(status.isError, true, JSON.stringify(status));
    const contents = JSON.parse(status.content.find(({ type }) => type === 'text').text);
    assert.equal(contents.engine.ready, true);
    assert.equal(contents.engine.engineVersion, version);
  } finally {
    await client.close();
  }
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'build', 'engine-release');
const version = await readEnginePackageVersion(root);
assert.equal(process.env.RELEASE_TAG, `v${version}`, 'RELEASE_TAG must exactly match the npm package version');
const mode = process.argv[2];
assert.ok(['--check', '--package', '--verify', '--verify-public'].includes(mode) && process.argv.length === 3,
  'Usage: RELEASE_TAG=v<version> node mcp-server/scripts/package-engine-release.mjs --check|--package|--verify|--verify-public');

if (mode === '--verify') {
  const expected = [];
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['win32', 'x64']]) {
    const { assetName } = selectEngineArtifact(version, platform, arch);
    expected.push(assetName, `${assetName}.sha256`);
    const bytes = await readFile(join(output, assetName));
    assert.ok(bytes.length > 0, `Empty engine asset: ${assetName}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(await readFile(join(output, `${assetName}.sha256`), 'utf8'), `${digest}  ${assetName}\n`, `Checksum mismatch: ${assetName}`);
  }
  assert.deepEqual((await readdir(output)).sort(), expected.sort(), 'Release must contain exactly four binaries and their checksums');
  console.log(`Verified all four engine assets and checksums for v${version}`);
} else {
  const selection = selectEngineArtifact(version);
  assert.equal(process.env.ENGINE_TARGET, selection.target, 'ENGINE_TARGET must match this runner architecture');
  if (mode === '--verify-public') {
    const temporary = await mkdtemp(join(tmpdir(), 'meaning-model-public-install-smoke-'));
    try {
      await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: '@emergent-wisdom/meaning-model-mcp', version }));
      // Use the normal HTTPS installer against the published, version-matched release.
      const installed = await installEngine({ packageRoot: temporary });
      assert.equal(installed.version, version);
      assert.equal(installed.target, selection.target);
      await smokeEngine(installed.path, version, root);
      console.log(`Public download, native Rust and MCP smoke passed for ${selection.assetName} (SHA-256 ${installed.sha256})`);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } else if (mode === '--package') {
    const binaryPath = join(root, 'rust-engine', 'target', selection.target, 'release', selection.filename);
    const bytes = await readFile(binaryPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const temporary = await mkdtemp(join(tmpdir(), 'meaning-model-native-install-smoke-'));
    try {
      await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: '@emergent-wisdom/meaning-model-mcp', version }));
      // Exercise the real installer and executable offline before publishing any assets.
      const installed = await installEngine({
        packageRoot: temporary,
        fetchImpl: async (url) => {
          if (url === selection.releaseUrl) return Response.json({
            tag_name: selection.tag, draft: false,
            assets: [{ name: selection.assetName, state: 'uploaded', browser_download_url: selection.downloadUrl, size: bytes.length, digest: `sha256:${digest}` }],
          });
          assert.equal(url, selection.downloadUrl);
          return new Response(bytes);
        },
      });
      assert.equal(installed.sha256, digest);
      await smokeEngine(installed.path, version, root);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }

    await mkdir(output, { recursive: true });
    const asset = join(output, selection.assetName);
    await writeFile(asset, bytes);
    await chmod(asset, 0o755);
    await writeFile(`${asset}.sha256`, `${digest}  ${selection.assetName}\n`);
    console.log(`Native installer, Rust and MCP smoke passed; staged ${selection.assetName} (SHA-256 ${digest})`);
  }
}
