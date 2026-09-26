import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// The override also exercises the exact tarball after installation, including its launcher.
const serverPath = process.env.MEANING_MODEL_TEST_LAUNCHER
  ?? fileURLToPath(new URL('../src/server.ts', import.meta.url));

test('the MCP opens a complete browser snapshot from its own model and graph', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const client = new Client({ name: 'viewer-integration-test', version: '0.1.0' });
  t.after(() => client.close());
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env }));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  };
  const registered = await call('life_model_register', registerRequest);
  const inspected = await call('life_model_inspect', { modelHash: registered.modelHash, includeDefinition: true });
  const opened = await call('life_model_viewer_open', { modelHash: registered.modelHash });
  assert.equal(new URL(opened.url).hostname, '127.0.0.1');
  assert.equal(opened.readOnly, true);
  assert.equal(opened.modelHash, registered.modelHash);
  const html = await fetch(opened.url);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /start\.js/);
  for (const path of ['start.js', 'inspector.js', 'inspector.css', 'vendor/three/three.module.js']) {
    const response = await fetch(new URL(path, opened.url));
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 0, path);
  }
  const index = await (await fetch(new URL('data/index.json', opened.url))).json();
  assert.equal(index.default, 'model');
  const data = await (await fetch(new URL('data/model.json', opened.url))).json();
  assert.equal(data.viewKind, 'inspector');
  assert.equal(data.timeUnit, 'hour');
  assert.equal(data.modelHash, registered.modelHash);
  assert.equal(data.inspection.model.processes[0].initial_value.value, 1650000);
  assert.deepEqual(data.inspection.model, inspected.model);
  assert.equal(data.constructionTiming, 'unavailable');

  const graph = structuredClone(graphRequest.narrativeGraph);
  graph.source.model_hash = registered.modelHash;
  const stored = await call('life_narrative_register', { ...graphRequest, narrativeGraph: graph });
  const story = await call('life_model_viewer_open', { graphHash: stored.graphHash, accessScopes: ['author'] });
  const storyData = await (await fetch(new URL('data/model.json', story.url))).json();
  assert.equal(storyData.headGraphHash, stored.graphHash);
  assert.equal(storyData.modelHash, registered.modelHash);
  assert.ok(storyData.inspection.graph.nodes.some((node) => node.id === 'story'));
  assert.ok(storyData.inspection.graph.edges.length > 0);
  assert.notEqual(opened.url, story.url);

  await client.close();
  await assert.rejects(fetch(story.url), /fetch failed/);
});
