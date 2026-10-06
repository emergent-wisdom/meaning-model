// Simple mode, for ablation: an agent is told only the loop, the method and where the documentation lives, each
// tool says only its first sentence, and nothing is withheld from an agent that asks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function connect(t, simple) {
  const client = new Client({ name: 'simple-mode-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: 'storytelling', ...(simple ? { MEANING_MODEL_SIMPLE: '1' } : {}) };
  delete env.LIFE_SIM_STATE_FILE; if (!simple) delete env.MEANING_MODEL_SIMPLE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))], env }));
  t.after(() => client.close());
  return client;
}
const words = (text) => String(text).split(/\s+/u).filter(Boolean).length;

test('simple mode tells an agent the method and where the documentation lives, and nothing more', async (t) => {
  const client = await connect(t, true);
  const instructions = client.getInstructions();
  assert.match(instructions, /^Whatever you are doing, build a richer model underneath it\. If you are writing a story, build a richer world underneath it: a richer world makes a better story\. If you want to understand something better, build a richer model underneath it\. That is the loop\./u);
  assert.match(instructions, /Never hold back because a part seems irrelevant/u);
  assert.match(instructions, /Build an account of how the present came to be\. Model the processes and relationships that could have produced it, including those we have not observed directly\. Follow their consequences to predict what else we should find\. Use new evidence to revise the account\./u);
  assert.match(instructions, /https:\/\/github\.com\/emergent-wisdom\/meaning-model\.$/u);
  assert.ok(words(instructions) < 150, `${words(instructions)} words`);
  const { tools } = await client.listTools();
  for (const tool of tools) assert.doesNotMatch(tool.description.trim(), /[.!?]\s+\S/u, `${tool.name} says one sentence`);
  const series = tools.find((tool) => tool.name === 'life_series_record');
  assert.ok(series.inputSchema.properties.readings, 'schemas are unchanged');
  // Nothing is withheld: the guidance an agent asks for is the full guidance.
  const context = await client.callTool({ name: 'life_modeling_context', arguments: { purpose: 'creative_story', sessionMode: 'first_use' } });
  assert.match(context.structuredContent.startHere, /\*\*The one thing\.\*\* Whatever you are doing, build a richer model underneath it\./u);
  assert.match(context.structuredContent.startHere, /\*\*The method\.\*\*/u);
});

test('without simple mode an agent still receives the full guidance', async (t) => {
  const client = await connect(t, false);
  assert.match(client.getInstructions(), /\*\*What it is for\.\*\* You are an explorer, and the Meaning Model is your mind/u);
  const { tools } = await client.listTools();
  assert.ok(words(tools.find((tool) => tool.name === 'life_understanding_record').description) > 200);
});
