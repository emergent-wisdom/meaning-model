import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { disclosureInstructions } from '../src/storytelling-disclosure.mjs';

const serverPath = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const addonUri = 'life-sim://addon/storytelling';

async function connect(t, storytelling = false) {
  const client = new Client({ name: 'storytelling-first-use-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: storytelling ? 'storytelling' : '',
    MEANING_MODEL_READING: 'papers', MEANING_MODEL_ESTIMATOR: '' };
  // Reading first-use guidance must never open a developer's saved story database.
  delete env.LIFE_SIM_STATE_FILE;
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env }));
  return client;
}

test('initialize exposes open-ended exploration and text/world-time separation before any tool call', async (t) => {
  const client = await connect(t);
  const instructions = client.getInstructions();
  assert.match(instructions, /In every mode, begin modeling with life_modeling_context/u);
  assert.match(instructions, /Explore recursively/u);
  assert.match(instructions, /From the first story exploration/u);
  assert.match(instructions, /stable passage links and authored evidence/u);
  assert.match(instructions, /without a required dramatic formula or numerical score/u);
  assert.match(instructions, /reading position distinct from world time and authoring history/u);
  assert.match(instructions, /not claims that the server has assessed meaning/u);
  const resources = await client.listResources();
  assert.ok(!resources.resources.some(({ uri }) => uri === addonUri),
    'shared first-use guidance must not implicitly enable the storytelling add-on');
});

test('the discoverable scene prompt and add-on resource teach evidence-based telling processes without a formula', async (t) => {
  const client = await connect(t, true);
  const [prompts, resources] = await Promise.all([client.listPrompts(), client.listResources()]);
  assert.ok(prompts.prompts.some(({ name }) => name === 'life_story_scene_start'));
  assert.ok(resources.resources.some(({ uri }) => uri === addonUri));
  const [prompt, resource] = await Promise.all([
    client.getPrompt({ name: 'life_story_scene_start', arguments: {} }),
    client.readResource({ uri: addonUri }),
  ]);
  const promptText = prompt.messages.map(({ content }) => content.text ?? '').join('\n');
  assert.ok(promptText.includes(disclosureInstructions),
    'the ordinary start prompt must expose the complete current guidance, not only a later review tool');
  assert.match(promptText, /invitations to recursive exploration, not required tracks/u);
  assert.match(promptText, /promising discoveries without a defect/u);
  assert.match(promptText, /Reading position is this document's ordered text, not elapsed world time/u);
  assert.match(promptText, /exact quotations inside those spans/u);
  assert.match(promptText, /not prove the revised prose still has the same effect/u);

  const guide = resource.contents.map(({ text }) => text ?? '').join('\n');
  assert.equal(guide, await readFile(new URL('../../profiles/STORYTELLING_ADDON.md', import.meta.url), 'utf8'));
  const text = guide.replace(/\s+/gu, ' ');
  assert.match(text, /From the first exploration, consider how the telling develops/u);
  assert.match(text, /invitations, not required tracks, a dramatic formula/u);
  assert.match(text, /meaning-model-document-process\/v1/u);
  assert.match(text, /automatically records the reviewed passage hashes, reading order, and explicit links/u);
  assert.match(text, /Document position follows the ordered text, separately from world time/u);
  assert.match(text, /numeric rubric is optional/u);
  assert.match(text, /Changed passages or reading order mark phases for review/u);
});
