import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MAX_TOOL_RESULT_BYTES, toolResult } from '../src/tool-result.mjs';
import { boundLists } from '../src/bounded-lists.mjs';

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

test('a value that outgrows a list bound keeps its first entries inline and is written whole to a file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mm-result-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = process.env.MEANING_MODEL_RESULTS_DIR;
  process.env.MEANING_MODEL_RESULTS_DIR = directory;
  t.after(() => { if (environment === undefined) delete process.env.MEANING_MODEL_RESULTS_DIR; else process.env.MEANING_MODEL_RESULTS_DIR = environment; });
  const value = { modelHash: 'b'.repeat(64), ids: Array.from({ length: 20_000 }, (_, n) => `process.${n}`) };
  const bounded = boundLists(value, 16 * 1024, 'Each long list shows its first entries.');
  assert.ok(bounded.ids.length > 0 && bounded.ids.length < value.ids.length);
  assert.deepEqual(bounded.listsCut.ids, { shown: bounded.ids.length, of: 20_000 });
  assert.match(bounded.listsCutNote, /listsComplete/u);
  const text = await readFile(bounded.listsComplete.path, 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), bounded.listsComplete.sha256);
  assert.equal(basename(bounded.listsComplete.path), `${bounded.listsComplete.sha256}.json`);
  assert.deepEqual(JSON.parse(text), value, 'the file holds every entry');
  // Bounding the shown value again keeps the file of the complete one.
  assert.deepEqual(boundLists(bounded, 8 * 1024, 'Again.').listsComplete, bounded.listsComplete);
  assert.deepEqual(boundLists({ small: [1, 2] }, 16 * 1024, 'unused'), { small: [1, 2] }, 'a value that fits is unchanged');
});

test('default MCP stdio client receives complete large graph results, and a result larger than one message whole in a file', async (t) => {
  // No maxBufferSize override: the SDK's ordinary 10 MiB limit is part of this regression.
  const directory = await mkdtemp(join(tmpdir(), 'mm-result-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
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
    args: ['--input-type=module', '-e', server], cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, MEANING_MODEL_RESULTS_DIR: directory } });
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
  assert.equal(oversized.isError, undefined, 'a result is never refused for its size');
  const { resultFile } = oversized.structuredContent;
  assert.equal(resultFile.schema, 'meaning-model-result-file/v1');
  const text = await readFile(resultFile.path, 'utf8');
  assert.equal(Buffer.byteLength(text), resultFile.bytes);
  assert.ok(resultFile.bytes > MAX_TOOL_RESULT_BYTES);
  assert.equal(createHash('sha256').update(text).digest('hex'), resultFile.sha256);
  assert.deepEqual(JSON.parse(text), { text: '🙂'.repeat(MAX_TOOL_RESULT_BYTES / 4) }, 'the file holds the whole result');
  assert.match(oversized.content[0].text, /Nothing was cut or refused/u);
  assert.ok(oversized.content[0].text.includes(resultFile.path));
  assert.ok(bytes(oversized) < 4096);
  // The same value read again is the same file, written once.
  const again = await client.callTool({ name: 'oversized', arguments: {} });
  assert.deepEqual(again.structuredContent.resultFile, resultFile);
  assert.deepEqual(await readdir(directory), [`${resultFile.sha256}.json`]);
  const after = await client.callTool({ name: 'small', arguments: {} });
  assert.deepEqual(after.structuredContent, { complete: true }, 'the oversize result does not poison the transport');
  assert.deepEqual(JSON.parse(after.content[0].text), { complete: true });
  const zeros = await client.callTool({ name: 'zeros', arguments: {} });
  assert.deepEqual(zeros.structuredContent, { values: [-0, 0], nested: { zero: -0 } }, 'SDK JSON transport preserves each zero sign');
  assert.deepEqual(JSON.parse(zeros.content[0].text), zeros.structuredContent, 'text and structured responses agree');
});
