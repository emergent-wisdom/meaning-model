#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(`Meaning Model MCP server

Usage:
  meaning-model-mcp                 Start the stdio MCP server
  meaning-model-mcp --build-engine  Build the bundled Rust engine with Cargo

Build once before first use. Cargo, a C compiler, and native build tools are
required. Cargo may fetch the dependencies pinned by Cargo.lock. No binary is
downloaded and installation does not run a build. Alternatively, set
LIFE_SIM_ENGINE_BIN to an already built compatible life-sim-engine executable.`);
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
