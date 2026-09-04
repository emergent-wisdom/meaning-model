import { spawnSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimeFiles = [
  'LICENSE', 'LICENSE-CONTENT', 'NOTICE',
  'mcp-server/bin', 'mcp-server/resources',
  'rust-engine/Cargo.toml', 'rust-engine/Cargo.lock', 'rust-engine/src',
  'rust-engine/README.md', 'rust-engine/MEANING_MODEL_CONFORMANCE.md',
  'rust-engine/examples/meaning-model-command.json',
  'rust-engine/examples/construction-scaffolds-command.json',
  'paper/meaning-model.tex', 'paper/meaning-model-grammar.tex',
  'paper/emergentwisdom-preprint.sty', 'paper/references.bib', 'paper/includes',
  'docs/companions/life-simulation', 'docs/MODELING_PROTOCOL.md', 'docs/IMPLEMENTATION.md',
  'docs/NARRATIVE_UNDERSTANDING_GRAPH.md', 'docs/examples', 'profiles',
  'scripts/verify-resources.mjs', 'mcp-server/README.md', 'mcp-server/NPM-README.md',
];
const excluded = new Set(['.git', '.DS_Store', 'node_modules', 'target']);

async function copyRuntime(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing symlink in package input: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of (await readdir(source)).sort()) {
      if (excluded.has(entry)) throw new Error(`Unexpected package input: ${join(source, entry)}`);
      await copyRuntime(join(source, entry), join(destination, entry));
    }
  } else if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } else {
    throw new Error(`Unsupported package input: ${source}`);
  }
}

export async function stageNpmPackage(root = repositoryRoot, outputParent = join(root, 'build')) {
  await mkdir(outputParent, { recursive: true });
  const stage = await mkdtemp(join(outputParent, 'npm-package-'));
  const packageDirectory = join(stage, 'package');
  await mkdir(packageDirectory);
  for (const entry of runtimeFiles) {
    await copyRuntime(join(root, entry), join(packageDirectory, entry));
  }
  const sourceDirectory = join(root, 'mcp-server', 'src');
  for (const entry of (await readdir(sourceDirectory)).sort()) {
    if (entry.endsWith('.mjs')) {
      await copyRuntime(join(sourceDirectory, entry), join(packageDirectory, 'mcp-server', 'src', entry));
    } else if (entry !== 'server.ts') {
      throw new Error(`Unrecognized runtime source: ${entry}`);
    }
  }
  const server = await readFile(join(sourceDirectory, 'server.ts'), 'utf8');
  await writeFile(join(packageDirectory, 'mcp-server', 'src', 'server.mjs'), stripTypeScriptTypes(server));
  await copyFile(join(root, 'mcp-server', 'NPM-README.md'), join(packageDirectory, 'README.md'));

  const metadata = JSON.parse(await readFile(join(root, 'mcp-server', 'package.json'), 'utf8'));
  delete metadata.devDependencies;
  delete metadata.private;
  metadata.bin = { 'meaning-model-mcp': 'mcp-server/bin/meaning-model-mcp.mjs' };
  metadata.scripts = {
    start: 'node mcp-server/bin/meaning-model-mcp.mjs',
    'build:engine': 'node mcp-server/bin/meaning-model-mcp.mjs --build-engine',
    'verify:resources': 'node scripts/verify-resources.mjs',
  };
  metadata.files = [...runtimeFiles, 'mcp-server/src', 'README.md'];
  await writeFile(join(packageDirectory, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await chmod(join(packageDirectory, metadata.bin['meaning-model-mcp']), 0o755);
  return { stage, packageDirectory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run') || args.length > 1) {
    throw new Error('Usage: npm run pack:release [-- --dry-run]');
  }
  const { stage, packageDirectory } = await stageNpmPackage();
  const npmArguments = ['pack', '--json', '--cache', join(stage, '.npm-cache'), '--pack-destination', stage, ...args];
  const result = spawnSync(process.env.npm_execpath ? process.execPath : 'npm',
    process.env.npm_execpath ? [process.env.npm_execpath, ...npmArguments] : npmArguments,
    { cwd: packageDirectory, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr ?? 'npm pack failed');
  }
  const [packed] = JSON.parse(result.stdout);
  console.log(JSON.stringify({
    packageDirectory,
    tarball: args.includes('--dry-run') ? null : join(stage, packed.filename),
    files: packed.entryCount,
    unpackedBytes: packed.unpackedSize,
  }, null, 2));
}
