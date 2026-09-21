import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseEnabledAddons } from '../src/addon-config.mjs';

test('addons are opt-in and comma-separated settings are normalized once', () => {
  assert.deepEqual(parseEnabledAddons(), []);
  assert.deepEqual(parseEnabledAddons(''), []);
  assert.deepEqual(parseEnabledAddons('  '), []);
  assert.deepEqual(parseEnabledAddons(' storytelling, storytelling, '), ['storytelling']);
});

test('unknown addons and non-string settings reject the whole configuration', () => {
  assert.throws(() => parseEnabledAddons('storytelling,missing'), /Unknown Meaning Model addon "missing"/);
  assert.throws(() => parseEnabledAddons('Storytelling'), /Unknown Meaning Model addon/);
  assert.throws(() => parseEnabledAddons(null), /must be a comma-separated string/);
});

test('invalid addon configuration rejects before starting the engine', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'meaning-model-addons-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const marker = join(temporary, 'engine-started');
  const engine = join(temporary, 'fake-engine.mjs');
  await writeFile(engine, '#!/usr/bin/env node\n' +
    'import { writeFileSync } from "node:fs";\n' +
    'writeFileSync(process.env.MEANING_MODEL_TEST_ENGINE_MARKER, "started");\n');
  await chmod(engine, 0o755);
  const launcher = fileURLToPath(new URL('../bin/meaning-model-mcp.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [launcher], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      MEANING_MODEL_ADDONS: 'storytelling,missing',
      LIFE_SIM_ENGINE_BIN: engine,
      MEANING_MODEL_TEST_ENGINE_MARKER: marker,
    },
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown Meaning Model addon "missing"/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
