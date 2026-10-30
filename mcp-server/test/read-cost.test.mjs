// What a reading costs, on a frozen model: the published Book of Conditions as it ships in examples/. Each task is
// read the full way and the targeted way through the real server, as an agent reads it, and the test asserts two
// things: the targeted read agrees with the full one, and it costs a bounded share of the full read. The values and
// the guide section are exactly what the full read holds; the summaries and the skeleton are shorter forms of their
// records and agree only on which records, in which order. Cost is counted in the characters a client receives, which
// are exact and need no tokenizer; billed tokens are not measured. Shorter write results are checked against complete
// ones on two servers, one with them turned off.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expandHistoryModels } from '../src/construction-files.mjs';

const here = dirname(fileURLToPath(import.meta.url));

async function frozenBookModel() {
  const history = JSON.parse(await readFile(join(here, '..', '..', 'examples', 'book-of-conditions', 'the-book-of-conditions.meaning-model.json'), 'utf8'));
  let definition = null;
  for (const entry of expandHistoryModels(history)) definition = entry.definition;
  const model = structuredClone(definition);
  model.id = 'read-cost-book';
  model.revision = { number: 0, previous_model_hash: null, reason: 'The published Book, frozen for the read-cost test', provenance: ['read-cost test'] };
  return model;
}

// A server of this tree, its results measured in the characters a client receives.
async function server(t, environment = {}) {
  const client = new Client({ name: 'read-cost-test', version: '1' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '', ...environment };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result).slice(0, 400)}`);
    return { value: result.structuredContent, characters: result.content.map((part) => part.text ?? '').join('').length };
  };
  return call;
}

// Count the entire definition as an agent receives it, including every page's envelope and repeated metadata.
async function completeDefinition(call, modelHash) {
  const first = await call('life_model_inspect', { modelHash, includeDefinition: true });
  if (first.value.model) return { value: first.value.model, characters: first.characters };
  let result = first;
  let text = '';
  let characters = 0;
  for (;;) {
    const page = result.value.definitionPage;
    assert.equal(page.start, text.length, 'every part of the definition is read, in order');
    assert.equal(page.sha256, first.value.definitionPage.sha256);
    assert.equal(page.totalChars, first.value.definitionPage.totalChars);
    text += page.text;
    characters += result.characters;
    assert.equal(page.end, text.length);
    if (!page.nextCursor) break;
    result = await call('life_model_inspect', { modelHash, definitionCursor: page.nextCursor });
  }
  assert.equal(text.length, first.value.definitionPage.totalChars);
  assert.equal(createHash('sha256').update(text).digest('hex'), first.value.definitionPage.sha256);
  const definition = JSON.parse(text);
  assert.deepEqual(definition, JSON.parse(await readFile(first.value.definitionFile.path, 'utf8')),
    'all pages together preserve the complete definition');
  return { value: definition, characters };
}

test('each targeted read agrees with its full read, for a bounded share of its characters', async (t) => {
  const call = await server(t);
  const model = await frozenBookModel();
  const { value: { modelHash } } = await call('life_model_register', { requestId: 'read-cost', model });
  const report = [];
  const compare = (task, full, targeted, bound) => {
    report.push(`${task}: full ${full.characters}, targeted ${targeted.characters} characters (${(100 * targeted.characters / full.characters).toFixed(2)}%)`);
    assert.ok(targeted.characters < full.characters * bound, `${task}: the targeted read costs under ${bound * 100}% of the full read`);
  };

  // One process's dated values, against reading the whole model to find them.
  const series = model.value_series.find((item) => item.points?.length >= 10);
  assert.ok(series, 'the frozen Book holds a series of values');
  const whole = await completeDefinition(call, modelHash);
  const restored = await call('life_model_register', { requestId: 'read-cost-roundtrip', model: whole.value });
  assert.equal(restored.value.modelHash, modelHash, 'the full reading preserves the frozen model hash');
  assert.deepEqual(whole.value.value_series.find((item) => item.id === series.id).points, series.points,
    'the full definition holds every original value, band, tag and note');
  const values = await call('life_values_query', { modelHash, processIds: [series.process_id], maxPoints: 400 });
  assert.deepEqual(values.value.series.find((item) => item.seriesId === series.id).points, series.points, 'every value, band, tag and note as stored');
  compare(`values of ${series.process_id}`, whole, values, 0.01);

  // A hundred Events scanned as summaries, against their full records.
  const records = await call('life_meaning_query', { modelHash, collections: ['events'], limit: 100 });
  const summaries = await call('life_meaning_query', { modelHash, collections: ['events'], limit: 100, fields: 'summary' });
  assert.deepEqual(summaries.value.items.map((item) => item.id), records.value.items.map((item) => item.definition.id), 'the same records in the same order');
  compare('100 Events as summaries', records, summaries, 0.6);

  // The outline's skeleton, against the full outline.
  const outline = await call('life_model_outline', { modelHash, sections: ['events'], maxChars: 400_000 });
  const skeleton = await call('life_model_outline', { modelHash, sections: ['events'], detail: 'skeleton', maxChars: 400_000 });
  const ids = (text) => [...text.matchAll(/^\s*- (\S+?)(?: \[|:| \()/gmu)].map((match) => match[1]);
  assert.deepEqual(ids(skeleton.value.text), ids(outline.value.text), 'the same Events in the same order');
  compare('Events outline as a skeleton', outline, skeleton, 0.8);

  // One section of a guide, against the whole guide read page by page.
  const uri = 'life-sim://guide/process-breakdown';
  const pages = [];
  for (let offset = 0; offset !== null;) {
    const page = await call('life_modeling_read', { uri, offset });
    pages.push(page);
    offset = page.value.nextOffset ?? null;
  }
  const guide = { characters: pages.reduce((sum, page) => sum + page.characters, 0) };
  const contents = await call('life_modeling_read', { uri, section: 'contents' });
  const heading = contents.value.contents.find((entry) => entry.characters > 500 && entry.characters < 20_000);
  const section = await call('life_modeling_read', { uri, section: heading.title });
  const text = pages.map((page) => page.value.text).join('');
  assert.equal(section.value.text, text.slice(heading.offset, heading.offset + section.value.text.length), 'exactly that part of the guide');
  compare(`guide section "${heading.title}"`, guide, section, 0.5);
  t.diagnostic(report.join('\n'));
});

test('shorter write results reach the same models as complete ones in fewer characters', async (t) => {
  const model = await frozenBookModel();
  const event = model.meaning_model.events.find((item) => item.description);
  const run = async (environment) => {
    const call = await server(t, environment);
    let { value: { modelHash } } = await call('life_model_register', { requestId: 'read-cost-writes', model });
    const hashes = [];
    let characters = 0;
    for (let n = 0; n < 6; n += 1) {
      const revised = await call('life_model_revise', { requestId: `read-cost-${n}`, previousModelHash: modelHash,
        change: { reason: `Read-cost revision ${n}`, upsert: { events: [{ ...event, description: `${event.description} (${n})` }] } } });
      modelHash = revised.value.modelHash;
      hashes.push(modelHash);
      characters += revised.characters;
    }
    return { hashes, characters };
  };
  const complete = await run({ MEANING_MODEL_LEAN_RESULTS: 'off' });
  const shorter = await run({});
  assert.deepEqual(shorter.hashes, complete.hashes, 'the same six models');
  t.diagnostic(`six revisions by change: complete results ${complete.characters} characters, shorter ${shorter.characters} (${(100 * shorter.characters / complete.characters).toFixed(1)}%)`);
  assert.ok(shorter.characters < complete.characters, 'shorter results cost less');
});
