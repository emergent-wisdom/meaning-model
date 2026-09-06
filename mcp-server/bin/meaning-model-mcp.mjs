#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(`Meaning Model MCP server

Usage:
  meaning-model-mcp                 Start the stdio MCP server
  meaning-model-mcp --install-engine  Download and verify the matching release engine
  meaning-model-mcp --build-engine  Build the bundled Rust engine with Cargo

Install the engine once before first use. --install-engine explicitly downloads
this package version's engine from the official GitHub release and verifies its
SHA-256 digest. Available targets: macOS arm64/x64, Linux x64 (glibc 2.35+), and
Windows x64. Node.js 22.18 or later is required.

Alternatively, --build-engine needs Cargo, a C compiler, and native build tools;
Cargo may fetch dependencies pinned by Cargo.lock. Or set LIFE_SIM_ENGINE_BIN to
an already built compatible life-sim-engine executable. npm installation and
ordinary server startup never download or build an engine.`);
} else if (args.length === 1 && args[0] === '--install-engine') {
  try {
    const { installEngine } = await import('../src/install-engine.mjs');
    const installed = await installEngine();
    console.log(`Installed Meaning Model ${installed.version} engine (${installed.target}) at ${installed.path}`);
    console.log(`SHA-256: ${installed.sha256}`);
  } catch (error) {
    console.error(`Cannot install the Rust engine: ${error.message}`);
    console.error('Use --build-engine with Cargo and native build tools, or set LIFE_SIM_ENGINE_BIN to a compatible executable.');
    process.exitCode = 1;
  }
} else if (args.length === 1 && args[0] === '--build-engine') {
  const manifest = fileURLToPath(new URL('../../rust-engine/Cargo.toml', import.meta.url));
  const target = fileURLToPath(new URL('../../rust-engine/target/', import.meta.url));
  const result = spawnSync('cargo', [
    'build', '--locked', '--release', '--bin', 'life-sim-engine',
    '--manifest-path', manifest, '--target-dir', target,
  ], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Cannot build the Rust engine: ${result.error.message}. Install Cargo and native build tools, then retry.`);
  }
  process.exitCode = result.status ?? 1;
} else if (args.length > 0) {
  console.error('Unknown arguments. Run meaning-model-mcp --help.');
  process.exitCode = 1;
} else {
  // npm packages ship JavaScript: Node does not strip TypeScript in node_modules.
  const compiled = new URL('../src/server.mjs', import.meta.url);
  await import(existsSync(compiled) ? compiled.href : new URL('../src/server.ts', import.meta.url).href);
}
