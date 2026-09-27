import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createModelViewer, registerViewerTools } from '../src/viewer-server.mjs';

const modelHash = 'a'.repeat(64);
const graphHash = 'b'.repeat(64);
const distinctAdditionalModels = () => Array.from({ length: 15 }, (_, index) => ({ modelHash: (index + 1).toString(16).padStart(64, '0') }));

function read(url, { method = 'GET', headers = {}, path } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: target.hostname, port: target.port,
      path: path ?? `${target.pathname}${target.search}`, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(2_000, () => req.destroy(new Error('Viewer request timed out.')));
    req.end();
  });
}

async function fixture(t, { model, models, buildData } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-viewer-test-'));
  const publicDirectory = join(directory, 'public');
  await mkdir(publicDirectory);
  await writeFile(join(publicDirectory, 'index.html'), '<!doctype html><title>Viewer fixture</title>');
  await writeFile(join(directory, 'outside.txt'), 'OUTSIDE_PUBLIC_DIRECTORY');
  const inspected = [];
  const builds = [];
  const definition = model ?? { schema: 'life-sim-rust-model/v1', id: 'viewer-fixture',
    time_unit: 'hour', processes: [], meaning_model: { events: [] } };
  const service = { inspectModel: async (input) => {
    inspected.push(structuredClone(input));
    return { modelHash: input.modelHash, model: models?.get(input.modelHash) ?? definition, summary: { id: 'viewer-fixture' } };
  } };
  const viewer = createModelViewer(service, { publicDirectory, buildData: async (...args) => {
    builds.push(args);
    return buildData ? buildData(...args) : { id: 'viewer-fixture', marker: 'PUBLIC_SNAPSHOT', nodes: [], edges: [] };
  } });
  t.after(async () => {
    await viewer.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { viewer, inspected, builds, definition };
}

test('opens a read-only loopback snapshot with its exact model and serves GET and HEAD', async (t) => {
  const f = await fixture(t);
  const opened = await f.viewer.open({ modelHash, title: 'Fixture model' });
  const url = new URL(opened.url);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(Number(url.port) > 0);
  assert.ok(url.pathname.endsWith('/'));
  assert.notEqual(url.pathname, '/', 'the snapshot is behind its own unguessable URL');
  assert.equal(opened.modelHash, modelHash);
  assert.equal(opened.graphHash, null);
  assert.equal(opened.readOnly, true);
  assert.deepEqual(f.inspected, [{ modelHash, includeDefinition: true }]);
  const page = await read(opened.url);
  assert.equal(page.status, 200);
  assert.match(page.text, /Viewer fixture/);
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  const index = await read(new URL('data/index.json', opened.url));
  assert.equal(index.status, 200);
  assert.doesNotThrow(() => JSON.parse(index.text));
  const snapshotUrl = new URL('data/model.json', opened.url);
  const data = await read(snapshotUrl);
  assert.equal(data.status, 200);
  assert.match(data.headers['content-type'], /application\/json/);
  assert.match(data.text, /PUBLIC_SNAPSHOT/);
  assert.equal(data.headers['access-control-allow-origin'], undefined);
  const head = await read(snapshotUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
});

test('requires exactly one explicit model or graph revision before reading service state', async (t) => {
  const f = await fixture(t);
  for (const input of [{}, { modelHash, graphHash }, { modelHash: '../model' }, { graphHash: 'latest' }]) {
    await assert.rejects(f.viewer.open(input));
  }
  assert.deepEqual(f.inspected, []);
  assert.deepEqual(f.builds, []);
});

test('the MCP registrar exposes a bounded read-only tool with an exclusive revision schema', async (t) => {
  const registrations = [];
  const viewer = registerViewerTools({ registerTool: (...args) => registrations.push(args) }, {});
  t.after(() => viewer.close());
  assert.equal(registrations.length, 1);
  const [name, definition, handler] = registrations[0];
  assert.equal(name, 'life_model_viewer_open');
  assert.equal(typeof handler, 'function');
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.annotations.destructiveHint, false);
  assert.equal(definition.annotations.openWorldHint, false);
  const schema = definition.inputSchema;
  assert.deepEqual(schema.parse({ modelHash }).accessScopes, []);
  assert.equal(schema.parse({ graphHash }).graphHash, graphHash);
  assert.deepEqual(schema.parse({ modelHash, additionalModels: [{ graphHash }] }).additionalModels[0].accessScopes, []);
  assert.equal(schema.parse({ modelHash, additionalModels: Array(15).fill({ modelHash }) }).additionalModels.length, 15);
  for (const input of [{}, { graphHash, modelHash }, { modelHash, port: 8080 },
    { modelHash, accessScopes: [''] }, { modelHash, accessScopes: Array(65).fill('author') },
    { additionalModels: [{ modelHash }] }, { modelHash, additionalModels: Array(16).fill({ modelHash }) },
    ...[{}, { modelHash, graphHash }, { graphHash: 'latest' }, { modelHash, accessScopes: [''] },
      { modelHash, accessScopes: Array(65).fill('author') }, { modelHash, additionalModels: [] },
      { modelHash, title: ' ' }].map((selection) => ({ modelHash, additionalModels: [selection] }))]) {
    assert.equal(schema.safeParse(input).success, false);
  }
});

test('a model chooser lists only its explicitly grouped immutable snapshots', async (t) => {
  const otherHash = 'c'.repeat(64);
  const f = await fixture(t, { buildData: ({ history, title }) => ({
    modelHash: history.models[0].modelHash, title, marker: `SNAPSHOT_${title}`,
  }) });
  const unrelated = await f.viewer.open({ modelHash, title: 'Unrelated private view' });
  const opened = await f.viewer.open({ modelHash, title: 'First model',
    additionalModels: [{ modelHash: otherHash, title: 'Second model' }] });
  assert.equal(opened.views.length, 2);
  assert.equal(opened.url, opened.views[0].url);
  assert.deepEqual(opened.views.map(({ title, modelHash, graphHash, selected }) => ({ title, modelHash, graphHash, selected })), [
    { title: 'First model', modelHash, graphHash: null, selected: true },
    { title: 'Second model', modelHash: otherHash, graphHash: null, selected: false },
  ]);
  const first = await read(new URL('data/views.json', opened.url));
  assert.equal(first.status, 200);
  assert.match(first.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(first.text), opened.views);
  const second = await read(new URL('data/views.json', opened.views[1].url));
  assert.deepEqual(JSON.parse(second.text), opened.views.map((view) => ({ ...view, selected: !view.selected })));
  assert.doesNotMatch(first.text + second.text, /Unrelated private view/);
  assert.ok(!first.text.includes(unrelated.url) && !second.text.includes(unrelated.url));
  for (const view of opened.views) {
    const snapshot = JSON.parse((await read(new URL('data/model.json', view.url))).text);
    assert.deepEqual(snapshot, { modelHash: view.modelHash, title: view.title, marker: `SNAPSHOT_${view.title}` });
  }
  const unrelatedViews = JSON.parse((await read(new URL('data/views.json', unrelated.url))).text);
  assert.equal(unrelatedViews.length, 1);
  assert.equal(unrelatedViews[0].url, unrelated.url);
  assert.ok(unrelatedViews.every((view) => !opened.views.some((member) => member.url === view.url)));
});

test('an inaccessible additional model rejects the whole group without issuing or evicting snapshots', async (t) => {
  const privateHash = 'c'.repeat(64);
  const f = await fixture(t, { models: new Map([[privateHash, { id: 'SECRET_MODEL_IDENTIFIER',
    processes: [{ id: 'SECRET_PROCESS_IDENTIFIER', access_scopes: ['private'] }] }]]) });
  const previous = await f.viewer.open({ modelHash, additionalModels: distinctAdditionalModels() });
  await assert.rejects(f.viewer.open({ modelHash, accessScopes: ['private'],
    additionalModels: [{ modelHash: privateHash }] }), (error) => {
    assert.match(error.message, /accessScopes are insufficient/);
    assert.doesNotMatch(error.message, /SECRET_MODEL_IDENTIFIER|SECRET_PROCESS_IDENTIFIER/);
    return true;
  });
  const stillAvailable = JSON.parse((await read(new URL('data/views.json', previous.url))).text);
  assert.deepEqual(stillAvailable, previous.views, 'a denied group cannot partially replace the retained snapshots');
  for (const view of previous.views) assert.equal((await read(view.url)).status, 200);
  const allowed = await f.viewer.open({ modelHash,
    additionalModels: [{ modelHash: privateHash, accessScopes: ['private'] }] });
  assert.equal(allowed.views.length, 2, 'each selection carries its own scope grant');
});

test('group catalogs omit evicted members and never include later unrelated snapshots', async (t) => {
  const f = await fixture(t);
  const group = await f.viewer.open({ modelHash, additionalModels: distinctAdditionalModels() });
  const later = await f.viewer.open({ modelHash, title: 'Later standalone snapshot' });
  assert.equal((await read(new URL('data/views.json', group.url))).status, 404);
  const survivor = group.views[1].url;
  const views = JSON.parse((await read(new URL('data/views.json', survivor))).text);
  assert.equal(views.length, 15);
  assert.deepEqual(views.map((view) => view.url), group.views.slice(1).map((view) => view.url));
  assert.equal(views.filter((view) => view.selected).length, 1);
  assert.equal(views.find((view) => view.selected).url, survivor);
  assert.ok(views.every((view) => view.url !== later.url));
  const standalone = JSON.parse((await read(new URL('data/views.json', later.url))).text);
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].url, later.url);
});

test('model chooser catalogs retain the same Host, Origin, method, token, and HEAD guards', async (t) => {
  const f = await fixture(t);
  const group = await f.viewer.open({ modelHash, title: 'PRIVATE_GROUP_TITLE', additionalModels: [{ modelHash }] });
  const url = new URL('data/views.json', group.url);
  for (const options of [{ headers: { Host: 'attacker.example' } },
    { headers: { Origin: 'https://attacker.example' } }, { method: 'POST' }, { method: 'OPTIONS' },
    { path: '/unissued-token/data/views.json' }]) {
    const response = await read(url, options);
    assert.ok(response.status >= 400 && response.status < 500);
    assert.doesNotMatch(response.text, /PRIVATE_GROUP_TITLE/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  const head = await read(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
});

test('rejects foreign Host and Origin headers and exposes no cross-origin permission', async (t) => {
  const f = await fixture(t);
  const opened = await f.viewer.open({ modelHash });
  const url = new URL('data/model.json', opened.url);
  for (const headers of [
    { Host: 'attacker.example' },
    { Host: `localhost:${url.port}` },
    { Origin: 'https://attacker.example' },
    { Origin: `http://127.0.0.1:${Number(url.port) + 1}` },
    { Origin: 'null' },
  ]) {
    const response = await read(url, { headers });
    assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(headers));
    assert.doesNotMatch(response.text, /PUBLIC_SNAPSHOT/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await read(url, { headers: { Origin: url.origin } })).status, 200);
});

test('rejects unknown tokens, traversal paths, and methods that could mutate data', async (t) => {
  const f = await fixture(t);
  const opened = await f.viewer.open({ modelHash });
  const url = new URL(opened.url);
  for (const path of [
    '/unissued-token/data/model.json', '/data/model.json',
    `${url.pathname}../outside.txt`, `${url.pathname}%2e%2e/outside.txt`,
    `${url.pathname}%2e%2e%2foutside.txt`, `${url.pathname}data/../../outside.txt`,
  ]) {
    const response = await read(url, { path });
    assert.ok(response.status >= 400 && response.status < 500, path);
    assert.doesNotMatch(response.text, /PUBLIC_SNAPSHOT|OUTSIDE_PUBLIC_DIRECTORY/);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await read(new URL('data/model.json', url), { method });
    assert.ok(response.status >= 400 && response.status < 500, method);
    assert.doesNotMatch(response.text, /PUBLIC_SNAPSHOT/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('full-model viewing refuses hidden nested records without disclosing their contents', async (t) => {
  const model = { id: 'viewer-fixture', processes: [
    { id: 'SECRET_PROCESS_IDENTIFIER', access_scopes: ['private'], initial_value: { value: 'SECRET_INITIAL_VALUE' } },
  ], meaning_model: { nested: { records: [{ id: 'SECRET_EDITOR_RECORD', access_scopes: ['editor'] }] } } };
  const f = await fixture(t, { model });
  for (const accessScopes of [[], ['other'], ['private'], ['editor']]) {
    await assert.rejects(f.viewer.open({ modelHash, accessScopes }), (error) => {
      assert.match(error.message, /scope|author|access|visible|permission/i);
      assert.doesNotMatch(error.message, /SECRET_PROCESS_IDENTIFIER|SECRET_INITIAL_VALUE|SECRET_EDITOR_RECORD/);
      return true;
    });
  }
  assert.equal(f.builds.length, 0, 'private model data never reaches the export builder');
  const opened = await f.viewer.open({ modelHash, accessScopes: ['private', 'editor'] });
  assert.equal((await read(new URL('data/model.json', opened.url))).status, 200);
  assert.equal(f.builds.length, 1);
});

test('each open freezes its own JSON even if the builder reuses a mutable object', async (t) => {
  const data = { marker: 'FIRST_SNAPSHOT', nodes: [], edges: [] };
  const f = await fixture(t, { buildData: async () => data });
  const first = await f.viewer.open({ modelHash });
  const firstUrl = new URL('data/model.json', first.url);
  const before = await read(firstUrl);
  assert.match(before.text, /FIRST_SNAPSHOT/);
  data.marker = 'SECOND_SNAPSHOT';
  const second = await f.viewer.open({ modelHash });
  assert.notEqual(second.url, first.url);
  assert.equal((await read(firstUrl)).text, before.text);
  assert.match((await read(new URL('data/model.json', second.url))).text, /SECOND_SNAPSHOT/);
  data.marker = 'MUTATED_AFTER_BOTH_OPENS';
  assert.doesNotMatch((await read(new URL('data/model.json', second.url))).text, /MUTATED_AFTER_BOTH_OPENS/);
});

test('tokens are isolated between viewer instances and close stops listening', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const a = await first.viewer.open({ modelHash });
  const b = await second.viewer.open({ modelHash });
  const wrongServer = new URL(a.url);
  wrongServer.port = new URL(b.url).port;
  assert.equal((await read(new URL('data/model.json', wrongServer))).status, 404);
  await first.viewer.close();
  await first.viewer.close();
  await assert.rejects(read(a.url), (error) => {
    assert.equal(error.code, 'ECONNREFUSED');
    return true;
  });
  assert.equal((await read(b.url)).status, 200, 'closing one viewer does not close another');
});
