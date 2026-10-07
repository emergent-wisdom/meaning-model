import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MAX_TOOL_RESULT_BYTES, toolResult } from '../src/tool-result.mjs';

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Match the imported books' hundreds of content-bearing nodes and thousands of edges,
// including JSON stored inside narrative text (which gains another escaping layer on the wire).
function graphResult(nodeCount, edgeCount, textLength) {
  return { schema: 'life-sim-rust-narrative-graph-view/v1', graph_hash: 'a'.repeat(64), mode: 'full', content_included: true,
    nodes: Array.from({ length: nodeCount }, (_, i) => ({ id: `note.${i}`, role: 'externalized_reflection', render: 'exclude',
      text: JSON.stringify({ schema: 'meaning-model-story-author-record/v1', text: 'An authored reading. '.repeat(textLength / 20), data: { quote: '"Evidence"\nÅ🙂' } }) })),
    edges: Array.from({ length: edgeCount }, (_, i) => ({ id: `edge.${i}`, family: 'semantic', relation: 'about',
      source: { kind: 'node', node_id: `note.${i % nodeCount}` }, target: { kind: 'node', node_id: `note.${(i + 1) % nodeCount}` } })),
    returned_node_count: nodeCount, returned_edge_count: edgeCount };
}

test('small tool results retain the existing complete text and structured contract', () => {
  const value = { schema: 'fixture/v1', nested: { text: 'Å🙂\n"quoted"', values: [1, null, true] } };
  assert.deepEqual(toolResult(value), { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
  assert.equal(toolResult(value).structuredContent, value);
});

test('size checks account for UTF-8 and escaped duplicate text, without changing structured data', () => {
  const value = { text: '🙂"\\\n'.repeat(450_000) };
  const old = { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
  assert.ok(bytes(old) > MAX_TOOL_RESULT_BYTES);
  const result = toolResult(value);
  assert.equal(result.structuredContent, value);
  assert.ok(bytes(result) <= MAX_TOOL_RESULT_BYTES);
  assert.match(result.content[0].text, /no structured data was truncated/u);
});

test('default MCP stdio client receives complete large graph results and a bounded oversized error', async (t) => {
  // No maxBufferSize override: the SDK's ordinary 10 MiB limit is part of this regression.
  const client = new Client({ name: 'tool-result-size-test', version: '1' });
  const helper = new URL('../src/tool-result.mjs', import.meta.url).href;
  const server = `
    import { McpServer } from '@modelcontextprotocol/server';
    import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
    import { toolResult, MAX_TOOL_RESULT_BYTES } from ${JSON.stringify(helper)};
    const graphResult = ${graphResult.toString()};
    const server = new McpServer({ name: 'large-result-fixture', version: '1' });
    server.registerTool('book', {}, async () => toolResult(graphResult(440, 3750, 13600)));
    server.registerTool('twelve', {}, async () => toolResult(graphResult(501, 3004, 9500)));
    server.registerTool('oversized', {}, async () => toolResult({ text: '🙂'.repeat(MAX_TOOL_RESULT_BYTES / 4) }));
    server.registerTool('small', {}, async () => toolResult({ complete: true }));
    server.registerTool('zeros', {}, async () => toolResult({ values: [-0, 0], nested: { zero: -0 } }));
    await server.connect(new StdioServerTransport());
  `;
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--input-type=module', '-e', server], cwd: fileURLToPath(new URL('..', import.meta.url)) });
  t.after(() => client.close());
  await client.connect(transport);
  for (const [name, shape] of [['book', [440, 3750, 13600]], ['twelve', [501, 3004, 9500]]]) {
    const expected = graphResult(...shape);
    const old = { content: [{ type: 'text', text: JSON.stringify(expected, null, 2) }], structuredContent: expected };
    assert.ok(bytes(old) > 10 * 1024 * 1024, `${name} reproduces the old default-buffer overflow`);
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(digest(result.structuredContent), digest(expected), `${name} preserves every result field`);
    assert.ok(bytes(result) <= MAX_TOOL_RESULT_BYTES);
    assert.match(result.content[0].text, /complete result is in structuredContent/u);
    assert.match(result.content[0].text, /text-only clients/u);
  }
  const oversized = await client.callTool({ name: 'oversized', arguments: {} });
  assert.equal(oversized.isError, true);
  assert.equal(oversized.structuredContent, undefined, 'an incomplete value must never masquerade as a structured result');
  assert.match(oversized.content[0].text, /No partial result is returned/u);
  assert.match(oversized.content[0].text, /may already have completed/u);
  assert.ok(bytes(oversized) < 2048);
  const after = await client.callTool({ name: 'small', arguments: {} });
  assert.deepEqual(after.structuredContent, { complete: true }, 'the oversize result does not poison the transport');
  assert.deepEqual(JSON.parse(after.content[0].text), { complete: true });
  const zeros = await client.callTool({ name: 'zeros', arguments: {} });
  assert.deepEqual(zeros.structuredContent, { values: [-0, 0], nested: { zero: -0 } }, 'SDK JSON transport preserves each zero sign');
  assert.deepEqual(JSON.parse(zeros.content[0].text), zeros.structuredContent, 'text and structured responses agree');
});
