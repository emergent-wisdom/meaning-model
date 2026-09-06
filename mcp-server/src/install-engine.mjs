import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'emergent-wisdom/meaning-model';
const PACKAGE_NAME = '@emergent-wisdom/meaning-model-mcp';
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const SUPPORTED_TARGETS = Object.freeze({
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
});

export function selectEngineArtifact(version, platform = process.platform, arch = process.arch) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package release version: ${version}`);
  }
  const target = SUPPORTED_TARGETS[`${platform}-${arch}`];
  if (!target) throw new Error(`No prebuilt engine for ${platform}/${arch}. Use --build-engine or LIFE_SIM_ENGINE_BIN.`);
  const filename = platform === 'win32' ? 'life-sim-engine.exe' : 'life-sim-engine';
  const tag = `v${version}`;
  const assetName = `life-sim-engine-${tag}-${target}${platform === 'win32' ? '.exe' : ''}`;
  return {
    target, filename, tag, assetName,
    releaseUrl: `https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`,
    downloadUrl: `https://github.com/${REPOSITORY}/releases/download/${tag}/${assetName}`,
  };
}

export async function readEnginePackageVersion(packageRoot = PACKAGE_ROOT) {
  // The staged npm package has metadata at its root; the source tree has it in mcp-server.
  for (const path of [join(packageRoot, 'package.json'), join(packageRoot, 'mcp-server', 'package.json')]) {
    let metadata;
    try {
      metadata = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (metadata.name !== PACKAGE_NAME) throw new Error(`Unexpected package metadata at ${path}`);
    return metadata.version;
  }
  throw new Error('Cannot find Meaning Model package metadata. Reinstall the package.');
}

async function download(url, maximum, fetchImpl, accept) {
  const signal = AbortSignal.timeout(120_000);
  // Follow only GitHub HTTPS redirects; never accept an arbitrary manifest download URL.
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) {
      throw new Error('Refusing a download outside the official GitHub HTTPS release channel.');
    }
    const response = await fetchImpl(parsed.href, {
      redirect: 'manual', signal,
      headers: { Accept: accept, 'User-Agent': 'meaning-model-mcp-engine-installer' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('GitHub returned a redirect without a location.');
      url = new URL(location, parsed).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) throw new Error('The matching engine release or asset is not published yet.');
      throw new Error(`GitHub download failed (HTTP ${response.status}). Retry later or use --build-engine.`);
    }
    const announcedBytes = response.headers.get('content-length');
    if (announcedBytes !== null && (!/^\d+$/.test(announcedBytes) || Number(announcedBytes) > maximum)) {
      await response.body?.cancel();
      throw new Error('GitHub download exceeds the allowed size.');
    }
    if (!response.body) throw new Error('GitHub returned an empty download.');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maximum) throw new Error('GitHub download exceeds the allowed size.');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, bytes);
  }
  throw new Error('GitHub download exceeded the redirect limit.');
}

export function verifyEngineAsset(release, selection) {
  if (release.tag_name !== selection.tag || release.draft !== false) {
    throw new Error('GitHub release does not match this package version or is still a draft.');
  }
  const matches = Array.isArray(release.assets) ? release.assets.filter((asset) => asset.name === selection.assetName) : [];
  if (matches.length !== 1) throw new Error(`The matching engine asset ${selection.assetName} is not published or is ambiguous.`);
  const asset = matches[0];
  if (asset.state !== 'uploaded' || asset.browser_download_url !== selection.downloadUrl ||
    !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BINARY_BYTES) {
    throw new Error('GitHub engine asset metadata is invalid.');
  }
  // Require GitHub's server-computed digest, not a checksum supplied only by a remote file.
  if (!/^sha256:[0-9a-f]{64}$/.test(asset.digest)) throw new Error('GitHub did not provide a SHA-256 digest for this engine asset.');
  return asset;
}

async function installDirectory(packageRoot) {
  let directory = packageRoot;
  for (const part of ['rust-engine', 'target', 'release']) {
    directory = join(directory, part);
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Refusing a non-directory or symlink in engine installation path: ${directory}`);
  }
  return directory;
}

export async function installEngine({
  packageRoot = PACKAGE_ROOT,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  glibcVersion = platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime : undefined,
} = {}) {
  const version = await readEnginePackageVersion(packageRoot);
  const selection = selectEngineArtifact(version, platform, arch);
  if (platform === 'linux') {
    const [major, minor] = (glibcVersion ?? '').split('.').map(Number);
    if (!(major > 2 || (major === 2 && minor >= 35))) {
      throw new Error('The Linux prebuilt engine requires glibc 2.35 or later. Use --build-engine or LIFE_SIM_ENGINE_BIN on this system.');
    }
  }
  const release = JSON.parse((await download(selection.releaseUrl, 1024 * 1024, fetchImpl, 'application/vnd.github+json')).toString('utf8'));
  const asset = verifyEngineAsset(release, selection);
  const binary = await download(selection.downloadUrl, asset.size, fetchImpl, 'application/octet-stream');
  const digest = createHash('sha256').update(binary).digest('hex');
  if (binary.length !== asset.size || `sha256:${digest}` !== asset.digest) {
    throw new Error('Engine SHA-256 or size verification failed. The existing engine was not changed.');
  }
  const directory = await installDirectory(packageRoot);
  const temporary = await mkdtemp(join(directory, '.engine-install-'));
  const destination = join(directory, selection.filename);
  try {
    const staged = join(temporary, selection.filename);
    await writeFile(staged, binary, { mode: 0o600, flag: 'wx' });
    await chmod(staged, 0o755);
    // Same filesystem rename: a failed download/write cannot truncate the previous engine.
    await rename(staged, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { version, target: selection.target, path: destination, sha256: digest };
}
