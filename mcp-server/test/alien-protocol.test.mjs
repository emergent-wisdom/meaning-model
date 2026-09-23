import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'src', 'server.ts');
const alienTools = ['life_alien_atlas', 'life_alien_ontology_revise', 'life_alien_record', 'life_alien_search_diagnose', 'life_alien_search_start', 'life_alien_task'];
const addonUri = 'life-sim://addon/alien';
const paperUri = 'life-sim://theory/ontology-of-the-alien';

async function connectClient(t, addons) {
  const client = new Client({ name: 'alien-addon-protocol-test', version: '0.1.0' });
  const env = { ...process.env };
  delete env.MEANING_MODEL_ADDONS;
  if (addons) env.MEANING_MODEL_ADDONS = addons;
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
  return result.structuredContent;
}

test('the alien add-on is opt-in and adds only its tools, resources and prompt', async (t) => {
  const [base, enabled, both] = await Promise.all([connectClient(t, null), connectClient(t, 'alien'), connectClient(t, 'storytelling,alien')]);
  const [baseTools, enabledTools, bothTools] = await Promise.all([base.listTools(), enabled.listTools(), both.listTools()]);
  const baseNames = new Set(baseTools.tools.map(({ name }) => name));
  assert.deepEqual(enabledTools.tools.filter(({ name }) => !baseNames.has(name)).map(({ name }) => name).sort(), alienTools);
  assert.deepEqual(enabledTools.tools.filter(({ name }) => !alienTools.includes(name)), baseTools.tools, 'existing tool definitions are unchanged');
  const bothNames = bothTools.tools.map(({ name }) => name);
  assert.ok(alienTools.every((name) => bothNames.includes(name)) && bothNames.includes('life_story_scene_prepare'), 'the add-ons combine');
  const readOnly = Object.fromEntries(enabledTools.tools.filter(({ name }) => alienTools.includes(name)).map(({ name, annotations }) => [name, annotations.readOnlyHint]));
  assert.deepEqual(readOnly, { life_alien_atlas: true, life_alien_ontology_revise: false, life_alien_record: false,
    life_alien_search_diagnose: true, life_alien_search_start: false, life_alien_task: false }, 'tasks are stored, so preparing one writes');
  const [baseResources, enabledResources] = await Promise.all([base.listResources(), enabled.listResources()]);
  assert.ok(!baseResources.resources.some(({ uri }) => [addonUri, paperUri].includes(uri)));
  assert.deepEqual(enabledResources.resources.filter(({ uri }) => ![addonUri, paperUri].includes(uri)), baseResources.resources);
  const guide = await enabled.readResource({ uri: addonUri });
  assert.match(guide.contents[0].text, /^# Alien add-on/u);
  const prompts = await enabled.listPrompts();
  assert.ok(prompts.prompts.some(({ name }) => name === 'life_alien_start'));
  const start = await enabled.getPrompt({ name: 'life_alien_start', arguments: {} });
  assert.match(start.messages[0].content.text, /fresh contexts/u);
  assert.match(start.messages[0].content.text, /life-sim:\/\/theory\/ontology-of-the-alien/u);
});

test('the write tools wait for the paper; then a search starts and stores a target-blind builder task over MCP', async (t) => {
  const client = await connectClient(t, 'alien');
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const { modelHash } = await call(client, 'life_model_register', registerRequest);
  const start = { requestId: 'mcp-start', modelHash, graphId: 'alien-mcp', searchId: 'search.mcp',
    title: 'Carrying the loan', problem: { statement: 'How can a family bakery carry its loan through a bad year?', targetTerms: ['bakery'] },
    authorId: 'tester', accessScopes: ['author'] };
  const early = await client.callTool({ name: 'life_alien_search_start', arguments: start });
  assert.equal(early.isError, true);
  assert.match(early.content[0].text, /Paper-first gate/u);
  const paper = await client.readResource({ uri: paperUri });
  assert.match(paper.contents[0].text, /World-Diversity Search and Evolving Solution Ontologies/u);
  const started = await call(client, 'life_alien_search_start', start);
  const builder = await call(client, 'life_alien_task', { graphHash: started.graphHash, requestId: 'mcp-builder', searchRootId: 'search.mcp', authorId: 'tester', accessScopes: ['author'], role: 'builder' });
  assert.equal(builder.targetBlind, true);
  assert.ok(!builder.text.toLowerCase().includes('bakery'));
  assert.equal(builder.taskNodeId, 'task.mcp-builder');
  const refused = await client.callTool({ name: 'life_alien_task', arguments: { graphHash: builder.graphHash, requestId: 'mcp-bad', searchRootId: 'search.mcp', authorId: 'tester', accessScopes: ['author'],
    role: 'builder', inputs: { worldNodeId: 'world.x' } } });
  assert.equal(refused.isError, true, 'inputs that belong to another role are refused');
});
