import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'src', 'server.ts');
const branchTools = ['life_future_fork', 'life_future_list', 'life_future_load', 'life_future_compare'];

async function connect(t, addons) {
  const client = new Client({ name: 'forecasting-addon-protocol-test', version: '0.1.0' });
  const env = { ...process.env };
  delete env.MEANING_MODEL_ADDONS;
  if (addons) env.MEANING_MODEL_ADDONS = addons;
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env }));
  return client;
}

test('forecasting is pulled into any purpose; its branches come only with the add-on', async (t) => {
  const plain = await connect(t, null);
  const plainTools = (await plain.listTools()).tools.map((tool) => tool.name);
  for (const name of branchTools) assert.ok(!plainTools.includes(name), `${name} is not offered without the add-on`);
  const plainContext = await plain.callTool({ name: 'life_modeling_context', arguments: { purpose: 'person_reflection', modes: ['forecasting'] } });
  assert.match(plainContext.structuredContent.method.forecasting.inThisPurpose, /consent/u);
  assert.match(plainContext.structuredContent.method.forecasting.branches, /MEANING_MODEL_ADDONS/u);

  const enabled = await connect(t, 'storytelling,forecasting');
  const tools = (await enabled.listTools()).tools.map((tool) => tool.name);
  for (const name of branchTools) assert.ok(tools.includes(name), `${name} is offered with the add-on`);
  assert.ok(tools.includes('life_story_chat_open'), 'other add-ons stay on beside it');
  const context = await enabled.callTool({ name: 'life_modeling_context', arguments: { purpose: 'creative_story', modes: ['forecasting'] } });
  assert.match(context.structuredContent.method.forecasting.branches, /life_future_fork/u);
  assert.ok(context.structuredContent.orderedResources.some((resource) => resource.uri === 'life-sim://addon/forecasting'));
  const guide = await enabled.readResource({ uri: 'life-sim://addon/forecasting' });
  assert.match(guide.contents[0].text, /Forecasting mode/u);
  const prompt = await enabled.getPrompt({ name: 'life_modeling_start', arguments: { purpose: 'user_memory', modes: 'forecasting' } });
  assert.match(prompt.messages[0].content.text, /Forecast what the user will need/u);
  assert.match(prompt.messages[0].content.text, /life_future_fork/u);
  const listed = await enabled.callTool({ name: 'life_future_list', arguments: { accessScopes: ['nothing-here'] } });
  assert.deepEqual(listed.structuredContent.stages, []);
});
