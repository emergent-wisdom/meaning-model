// User-selected server instructions preserve tool validation and optional guide access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MAX_INSTRUCTIONS_BYTES, composeInstructions, resolveAgentInstructions } from '../src/agent-instructions.mjs';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts');
const OURS = 'Before you build anything, in every mode';

async function folder(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-instructions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the setting chooses ours in full, simple, the user\'s file, or ours followed by it', async (t) => {
  const directory = await folder(t);
  const file = join(directory, 'instructions.md');
  await writeFile(file, '\nModel only what the user names. Never open the viewer.\n');
  assert.deepEqual(resolveAgentInstructions({}), { mode: 'full' });
  assert.deepEqual(resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: 'full' }), { mode: 'full' });
  assert.deepEqual(resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: 'simple' }), { mode: 'simple' });
  assert.deepEqual(resolveAgentInstructions({ MEANING_MODEL_SIMPLE: '1' }), { mode: 'simple' }, 'the older name still works');
  assert.deepEqual(resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: 'full', MEANING_MODEL_SIMPLE: '1' }), { mode: 'full' }, 'the new setting decides when both are set');
  const custom = resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: file });
  assert.equal(custom.mode, 'custom');
  assert.equal(custom.text, 'Model only what the user names. Never open the viewer.');
  assert.match(custom.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: `full+${file}` }).mode, 'full+custom');
  const texts = { full: 'OURS', simple: 'SHORT' };
  assert.equal(composeInstructions({ mode: 'full' }, texts), 'OURS');
  assert.equal(composeInstructions({ mode: 'simple' }, texts), 'SHORT');
  assert.equal(composeInstructions(custom, texts), custom.text);
  assert.equal(composeInstructions({ ...custom, mode: 'full+custom' }, texts), `OURS\n\n${custom.text}`);
});

test('a setting that cannot be honoured says why, instead of falling back to ours', async (t) => {
  const directory = await folder(t);
  const empty = join(directory, 'empty.md');
  const large = join(directory, 'large.md');
  await writeFile(empty, '  \n');
  await writeFile(large, 'x'.repeat(MAX_INSTRUCTIONS_BYTES + 1));
  await mkdir(join(directory, 'folder.md'));
  assert.throws(() => resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: 'instructions.md' }), /full, simple, the absolute path of a Markdown file, or full\+ followed by one/u);
  assert.throws(() => resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: join(directory, 'missing.md') }), /cannot be used: ENOENT/u);
  assert.throws(() => resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: empty }), /which is empty/u);
  assert.throws(() => resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: large }), /over the limit of 65536/u);
  assert.throws(() => resolveAgentInstructions({ MEANING_MODEL_INSTRUCTIONS: join(directory, 'folder.md') }), /not a regular file/u);
});

async function connect(t, instructions) {
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE; delete env.MEANING_MODEL_SIMPLE;
  if (instructions === undefined) delete env.MEANING_MODEL_INSTRUCTIONS; else env.MEANING_MODEL_INSTRUCTIONS = instructions;
  const client = new Client({ name: 'agent-instructions-test', version: '0.1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: 'ignore' }));
  t.after(() => client.close());
  const context = async () => (await client.callTool({ name: 'life_modeling_context', arguments: { purpose: 'observation', sessionMode: 'first_use' } })).structuredContent;
  return { instructions: client.getInstructions(), context };
}

test('the server gives the chosen instructions, and only its own require the guides and ask the opening questions', async (t) => {
  const directory = await folder(t);
  const file = join(directory, 'house-rules.md');
  await writeFile(file, '# House rules\n\nAsk nothing first. Use our own categories.');

  const ours = await connect(t);
  assert.ok(ours.instructions.startsWith(OURS));
  let context = await ours.context();
  assert.ok(context.askTheUserFirst);
  assert.ok(context.orderedResources.some((resource) => resource.required));

  const custom = await connect(t, file);
  assert.equal(custom.instructions, '# House rules\n\nAsk nothing first. Use our own categories.');
  context = await custom.context();
  assert.equal(context.askTheUserFirst, undefined);
  assert.equal(context.instructions.mode, 'custom');
  assert.match(context.instructions.note, /where it differs from the user's instructions, follow the user's/u);
  assert.deepEqual(context.orderedResources.filter((resource) => resource.required), [], 'the guides stay readable, none required');
  assert.ok(context.startHere.length > 0, 'nothing is withheld');

  const both = await connect(t, `full+${file}`);
  assert.ok(both.instructions.startsWith(OURS));
  assert.ok(both.instructions.endsWith('Ask nothing first. Use our own categories.'));
  assert.ok((await both.context()).askTheUserFirst);

  const simple = await connect(t, 'simple');
  assert.match(simple.instructions, /^Whatever you are doing, build a richer model underneath it\./u);
  assert.deepEqual((await simple.context()).orderedResources.filter((resource) => resource.required), []);

  await assert.rejects(connect(t, join(directory, 'missing.md')), 'a server asked for instructions it cannot read does not start');
});
