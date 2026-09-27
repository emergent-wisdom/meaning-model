import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const serverOutput = '{"jsonrpc":"2.0","method":"test/server-started"}\n';

async function launcherFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-launcher-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'bin'));
  await mkdir(join(directory, 'src'));
  const launcher = join(directory, 'bin', 'meaning-model-mcp.mjs');
  await copyFile(new URL('../bin/meaning-model-mcp.mjs', import.meta.url), launcher);
  // Exercise the actual launcher without requiring an engine or starting MCP.
  await writeFile(join(directory, 'src', 'server.mjs'),
    `process.stdout.write(${JSON.stringify(serverOutput)});\n`);
  return (stateFile, args = []) => {
    const env = { ...process.env };
    delete env.LIFE_SIM_STATE_FILE;
    if (stateFile !== undefined) env.LIFE_SIM_STATE_FILE = stateFile;
    return spawnSync(process.execPath, [launcher, ...args], {
      cwd: directory, env, encoding: 'utf8', timeout: 5_000,
    });
  };
}

test('ephemeral startup warns on stderr and preserves server stdout', async (t) => {
  const run = await launcherFixture(t);
  for (const stateFile of [undefined, '', ' \t ']) {
    const result = run(stateFile);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, serverOutput);
    assert.match(result.stderr, /Warning: LIFE_SIM_STATE_FILE is not configured/);
    assert.match(result.stderr, /Models and stories will be lost when this process ends/);
    assert.match(result.stderr, /private absolute database path in your MCP configuration/);
    assert.equal(result.stderr.trim().split('\n').length, 1);
  }
});

test('configured startup has no ephemeral warning', async (t) => {
  const run = await launcherFixture(t);
  const result = run(join(tmpdir(), 'private model data', 'meaning-model.sqlite'));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, serverOutput);
  assert.equal(result.stderr, '');
});

test('help explains persistence without emitting a startup warning', async (t) => {
  const run = await launcherFixture(t);
  const result = run(undefined, ['--help']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /LIFE_SIM_STATE_FILE/);
  assert.match(result.stdout, /only one server process per\ndatabase/);
  assert.match(result.stdout, /life_saved_work_list and life_construction_replay/);
  assert.match(result.stdout, /same accessScopes/);
  assert.ok(!result.stdout.includes(serverOutput));
});
