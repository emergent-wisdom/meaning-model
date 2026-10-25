// What reaches an agent. Claude Code keeps 2,048 characters of each tool description and of the server's instructions,
// and saves a tool result over 50,000 characters to a file the agent may not open unless the tool declares a larger
// size for its results. These tests read what a client receives, tools/list and the results themselves, in every
// add-on set and every instruction mode, so a tool or text registered anywhere is held to the same rules.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const ADDON_SETS = ['', 'storytelling', 'forecasting', 'alien', 'storytelling,forecasting,alien'];
const RESULT_CHARACTERS = { life_modeling_context: 100_000, life_modeling_read: 100_000, life_model_outline: 100_000, life_meaning_query: 100_000,
  life_model_inspect: 100_000, life_model_questions: 100_000, life_construction_replay: 100_000, life_narrative_query: 100_000, life_profile_compile: 200_000,
  life_story_model_depth_review: 200_000, life_story_scene_prepare: 200_000, life_story_deepen: 200_000, life_story_purpose_review: 200_000,
  life_story_feedback: 200_000, life_story_chat_prepare: 200_000, life_carve_record: 500_000 };

async function connect(t, environment = {}) {
  const client = new Client({ name: 'delivery-test', version: '1' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '', ...environment };
  delete env.LIFE_SIM_STATE_FILE;
  if (!('MEANING_MODEL_INSTRUCTIONS' in environment)) delete env.MEANING_MODEL_INSTRUCTIONS;
  delete env.MEANING_MODEL_SIMPLE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  return client;
}

// The instruction modes, each with the file it needs: the user's own text, longer than a client keeps.
async function instructionModes(t) {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const custom = join(directory, 'custom.md');
  await writeFile(custom, `# House rules\n\nKeep every record in British English.\n\n${'Model the ledger before the story. '.repeat(120)}\nThe last rule: cite the ledger page.`);
  return { full: {}, simple: { MEANING_MODEL_INSTRUCTIONS: 'simple' }, custom: { MEANING_MODEL_INSTRUCTIONS: custom }, 'full+custom': { MEANING_MODEL_INSTRUCTIONS: `full+${custom}` } };
}

test('the long-text tools declare a result size that holds the context and a guide page whole', async (t) => {
  const modes = await instructionModes(t);
  for (const addons of ADDON_SETS) for (const environment of Object.values(modes)) {
    const client = await connect(t, { MEANING_MODEL_ADDONS: addons, ...environment });
    const { tools } = await client.listTools();
    for (const [name, size] of Object.entries(RESULT_CHARACTERS)) {
      const tool = tools.find((item) => item.name === name);
      if (!tool) { assert.ok(name.startsWith('life_story_'), `${name} exists without add-ons`); continue; }
      assert.equal(tool._meta?.['anthropic/maxResultSizeChars'], size, `${name} with add-ons "${addons}"`);
    }
  }
  const client = await connect(t, { MEANING_MODEL_ADDONS: 'storytelling,forecasting,alien' });
  const shown = (result) => JSON.stringify(result.structuredContent).length;
  for (const purpose of ['creative_story', 'source_reconstruction', 'person_reflection', 'observation', 'forecasting', 'counterfactual', 'agent_memory', 'user_memory', 'human_author_feedback']) {
    const context = await client.callTool({ name: 'life_modeling_context', arguments: { purpose, modes: purpose === 'creative_story' ? ['forecasting'] : [] } });
    assert.ok(!context.isError, purpose);
    assert.ok(shown(context) < 100_000, `${purpose}: the context fits the declared size (${shown(context)})`);
  }
  const page = await client.callTool({ name: 'life_modeling_read', arguments: { uri: 'life-sim://theory/meaning-model', maxCharacters: 90_000 } });
  assert.ok(shown(page) < 100_000, `the largest guide page fits the declared size (${shown(page)})`);
  assert.match(page.structuredContent.continues, /^This page ends at character 90000 of \d+: read on with offset 90000\.$/u, 'a page that is not the last says so');
  const breakdown = await client.callTool({ name: 'life_modeling_read', arguments: { uri: 'life-sim://guide/process-breakdown', maxCharacters: 90_000 } });
  assert.equal(breakdown.structuredContent.nextOffset, null, 'the process breakdown comes whole in one page');
  assert.equal(breakdown.structuredContent.continues, undefined);
});

const PURPOSES = ['creative_story', 'source_reconstruction', 'person_reflection', 'observation', 'forecasting', 'counterfactual', 'agent_memory', 'user_memory', 'human_author_feedback'];
// Every life-sim:// address in a text, without trailing punctuation; a template such as …/{kind} is not an address.
const addressesIn = (text) => [...String(text ?? '').matchAll(/life-sim:\/\/[A-Za-z0-9._~\-/{}]+/gu)]
  .map((match) => match[0].replace(/[.\-/]+$/u, '')).filter((uri) => !uri.includes('{'));

test('every guide the server names opens with life_modeling_read, in every add-on set and instruction mode', async (t) => {
  const modes = await instructionModes(t);
  for (const addons of ADDON_SETS) for (const [mode, environment] of Object.entries(modes)) {
    const client = await connect(t, { MEANING_MODEL_ADDONS: addons, ...environment });
    const named = new Map();
    const note = (uri, where) => { if (!named.has(uri)) named.set(uri, where); };
    for (const uri of addressesIn(client.getInstructions())) note(uri, 'the instructions');
    const { tools } = await client.listTools();
    for (const tool of tools) for (const uri of addressesIn(tool.description)) note(uri, `${tool.name}'s description`);
    const { resources } = await client.listResources();
    for (const resource of resources) note(resource.uri, 'the resource list');
    for (const purpose of PURPOSES) {
      const context = await client.callTool({ name: 'life_modeling_context', arguments: { purpose, modes: addons.includes('forecasting') ? ['forecasting'] : [] } });
      for (const item of context.structuredContent?.orderedResources ?? []) note(item.uri, `the ${purpose} context`);
    }
    const unreadable = [];
    for (const [uri, where] of named) {
      const read = await client.callTool({ name: 'life_modeling_read', arguments: { uri, maxCharacters: 200 } });
      if (read.isError || !read.structuredContent?.text) unreadable.push(`${uri} (named in ${where})`);
    }
    assert.deepEqual(unreadable, [], `add-ons "${addons}", instructions ${mode}`);
    assert.ok(named.has('life-sim://server/instructions'), 'the server\'s own instructions can be read whole');
  }
});

// The whole text a guide holds, read page by page as an agent reads it.
async function readWhole(client, uri) {
  let text = ''; let offset = 0;
  while (offset !== null) {
    const page = await client.callTool({ name: 'life_modeling_read', arguments: { uri, offset } });
    assert.ok(!page.isError, `${uri}: ${JSON.stringify(page.content).slice(0, 200)}`);
    text += page.structuredContent.text;
    offset = page.structuredContent.nextOffset ?? null;
  }
  return text;
}

test('every tool description fits in the 2,048 characters a client keeps, in every add-on set and instruction mode', async (t) => {
  const modes = await instructionModes(t);
  for (const addons of ADDON_SETS) for (const [mode, environment] of Object.entries(modes)) {
    const client = await connect(t, { MEANING_MODEL_ADDONS: addons, ...environment });
    const { tools } = await client.listTools();
    const long = tools.filter((tool) => tool.description.length > 2_048).map((tool) => `${tool.name} (${tool.description.length})`);
    assert.deepEqual(long, [], `add-ons "${addons}", instructions ${mode}`);
  }
});

// The sixteen descriptions 0.12.1 gave in full, kept as they were: each now lives whole in its guide. A tool whose
// description is rewritten on purpose updates this fixture with it.
test('a long description lives whole in a guide that its short description names and life_modeling_read opens', async (t) => {
  const before = JSON.parse(await readFile(join(here, 'fixtures', 'long-descriptions-0.12.1.json'), 'utf8'));
  const client = await connect(t, { MEANING_MODEL_ADDONS: 'storytelling,forecasting,alien' });
  const { tools } = await client.listTools();
  for (const [name, full] of Object.entries(before)) {
    const tool = tools.find((item) => item.name === name);
    const uri = name === 'life_understanding_record' ? 'life-sim://guide/construction-record' : `life-sim://tool/${name}`;
    assert.ok(tool.description.includes(uri), `${name} names its guide`);
    assert.ok(tool.description.length < full.length, `${name} is described in short`);
    const guide = await readWhole(client, uri);
    assert.ok(guide.includes(full), `${name}: its guide holds the whole of its 0.12.1 description`);
  }
});

test('the first 2,048 characters of the instructions carry what an agent needs first, and the rest is readable', async (t) => {
  const modes = await instructionModes(t);
  for (const addons of ADDON_SETS) for (const [mode, environment] of Object.entries(modes)) {
    const client = await connect(t, { MEANING_MODEL_ADDONS: addons, ...environment });
    const text = client.getInstructions();
    const kept = text.slice(0, 2_048);
    const where = `add-ons "${addons}", instructions ${mode}`;
    assert.equal(await readWhole(client, 'life-sim://server/instructions'), text, `${where}: the whole is readable`);
    if (mode === 'full' || mode === 'full+custom') {
      // With the user's instructions added, reading them whole comes first; then ours begin.
      if (mode === 'full+custom') assert.match(kept, /^Before anything else, read the instructions this server's user configured, whole, at life-sim:\/\/server\/configured-instructions with life_modeling_read\. They are the user's: where they differ from the Meaning Model's guidance, follow them\. /u, `${where}: the user's own instructions first`);
      assert.match(mode === 'full' ? kept : kept.slice(kept.indexOf('Before you build')), /^Before you build anything, in every mode: call life_modeling_context, then read the start-here guide \(life-sim:\/\/guide\/start-here\) and the process breakdown \(life-sim:\/\/guide\/process-breakdown\)/u, where);
      assert.match(kept, /Then make a rough model of the whole \(firstWrite is a seed\), and read the other required guides when due/u, `${where}: something on the page first, then the reading when due`);
      assert.match(kept, /reusing any you still hold unchanged/u, `${where}: reuse of what is still held`);
      assert.match(kept, /watch the model fill in the live viewer, and do they want you to use Sema/u, `${where}: the opening questions`);
      assert.match(kept, /Continue existing work without restarting intake for edits or reviews/u, `${where}: continuation`);
      assert.match(kept, /All of these instructions are at life-sim:\/\/server\/instructions/u, `${where}: where the rest is`);
    }
    if (mode === 'full+custom') {
      const configured = await readWhole(client, 'life-sim://server/configured-instructions');
      assert.match(configured, /^# House rules/u, `${where}: and readable`);
      assert.ok(configured.endsWith('The last rule: cite the ledger page.'), `${where}: whole`);
      assert.ok(text.endsWith(`# Configured instructions\n\n${configured}`), `${where}: they end the instructions, under their own heading`);
    }
    if (mode === 'custom') {
      assert.doesNotMatch(kept, /life_modeling_context|live viewer/u, `${where}: no guides or questions of ours`);
      // A one-line preface, outside the user's Markdown, says to read it whole before acting; then the user's text as written.
      const configured = await readWhole(client, 'life-sim://server/configured-instructions');
      assert.match(kept, /^\[Read these instructions whole before you act, at life-sim:\/\/server\/configured-instructions with life_modeling_read/u, `${where}: the requirement comes first`);
      assert.equal(text.slice(text.indexOf(']\n\n') + 3), configured, `${where}: then the user's text, unchanged`);
      assert.ok(configured.endsWith('The last rule: cite the ledger page.') && text.endsWith('The last rule: cite the ledger page.'), `${where}: the user's text as written`);
    }
    if (mode === 'simple') {
      assert.ok(text.length <= 2_048, `${where}: simple instructions fit whole`);
      assert.doesNotMatch(text, /life-sim:\/\/server\/instructions|live viewer/u, `${where}: unchanged`);
    }
  }
});

test('the context names each tool guide: under our instructions, to read before the tool\'s first call; otherwise as reference', async (t) => {
  const modes = await instructionModes(t);
  const base = ['life_memory_start', 'life_model_questions', 'life_revision_check', 'life_understanding_record', 'life_world_model_build'];
  const uriOf = (name) => (name === 'life_understanding_record' ? 'life-sim://guide/construction-record' : `life-sim://tool/${name}`);
  const before = JSON.parse(await readFile(join(here, 'fixtures', 'long-descriptions-0.12.1.json'), 'utf8'));
  for (const addons of ['', 'storytelling']) for (const [mode, environment] of Object.entries(modes)) {
    const client = await connect(t, { MEANING_MODEL_ADDONS: addons, ...environment });
    const context = (await client.callTool({ name: 'life_modeling_context', arguments: { purpose: 'creative_story' } })).structuredContent;
    const named = context.toolGuides.map((item) => item.tool).sort();
    const { tools } = await client.listTools();
    const expected = Object.keys(before).filter((name) => !name.startsWith('life_story_') || addons).sort();
    const where = `add-ons "${addons}", instructions ${mode}`;
    assert.deepEqual(named, expected, `${where}: every tool described in short has its guide named`);
    // Simple mode gives each tool its first sentence only; elsewhere the description names the guide too, and under our
    // instructions says to read it before the first call.
    if (mode !== 'simple') for (const name of named) {
      const description = tools.find((tool) => tool.name === name).description;
      assert.ok(description.includes(uriOf(name)), `${where}: ${name} names its guide`);
      assert.equal(/Before your first call to it, read its complete instructions/u.test(description), mode === 'full' || mode === 'full+custom', `${where}: ${name} says when to read it`);
    }
    assert.ok(base.every((name) => named.includes(name)), where);
    assert.equal(named.filter((name) => name.startsWith('life_story_')).length, addons ? 11 : 0, `${where}: the story tools' guides when storytelling is on`);
    for (const item of context.toolGuides) assert.equal(item.uri, uriOf(item.tool), where);
    const ours = mode === 'full' || mode === 'full+custom';
    assert.equal(/before your first call to that tool, and reuse it while it stays unchanged/u.test(context.toolGuideRule), ours, `${where}: when to read them`);
    assert.ok(!context.orderedResources.some((item) => item.uri.startsWith('life-sim://tool/')), `${where}: not up-front reading`);
    // The user's own instructions are the first required reading in every mode that has them, ours or not.
    const first = context.orderedResources[0];
    if (mode === 'custom' || mode === 'full+custom') {
      assert.deepEqual([first.uri, first.required], ['life-sim://server/configured-instructions', true], `${where}: the user's instructions first`);
      assert.equal(context.orderedResources.filter((item) => item.required).length, mode === 'custom' ? 1 : context.orderedResources.filter((item) => item.required).length, `${where}: in custom mode no guide of ours is required`);
    } else assert.ok(!context.orderedResources.some((item) => item.uri === 'life-sim://server/configured-instructions'), where);
  }
});

test('choosing a purpose, an agent reads what each is for: an existing text is not research from sources', async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  const purpose = tools.find((tool) => tool.name === 'life_modeling_context').inputSchema.properties.purpose.description;
  for (const name of ['creative_story', 'source_reconstruction', 'person_reflection', 'observation', 'forecasting', 'counterfactual', 'agent_memory', 'user_memory', 'human_author_feedback']) {
    assert.match(purpose, new RegExp(`${name}: [a-z]`, 'u'), `${name} has its meaning`);
  }
  assert.match(purpose, /source_reconstruction: the world of an existing text, such as a novel or a play, rebuilt from the text; history or research from sources is observation/u);
  assert.match(purpose, /observation: an account of what happened or what is the case, from evidence, sources or recalled knowledge/u);
  const { prompts } = await client.listPrompts();
  const start = prompts.find((prompt) => prompt.name === 'life_modeling_start');
  const argument = (start.arguments ?? []).find((item) => item.name === 'purpose');
  assert.match(argument?.description ?? '', /source_reconstruction: the world of an existing text, such as a novel or a play/u, 'the start prompt says the same');
});

test('a page of the largest size fits the declared result size for every text the reader opens', async (t) => {
  const client = await connect(t, { MEANING_MODEL_ADDONS: 'storytelling,forecasting,alien' });
  const { tools } = await client.listTools();
  const uris = tools.find((tool) => tool.name === 'life_modeling_read').inputSchema.properties.uri.enum;
  const over = [];
  for (const uri of uris) {
    const page = await client.callTool({ name: 'life_modeling_read', arguments: { uri, maxCharacters: 90_000 } });
    const shown = JSON.stringify(page.structuredContent).length;
    if (page.isError || shown >= 100_000) over.push(`${uri} (${page.isError ? 'error' : shown})`);
  }
  assert.ok(uris.length > 40, `all the readable texts (${uris.length})`);
  assert.deepEqual(over, [], 'LaTeX papers escape densely in JSON; even their largest page stays under 100,000 characters');
});

// The context arrives whole only while its delivered text fits the size the tool declares; the seed for the first write
// (0.14.0) made it larger, so every purpose is measured with every add-on on.
test('life_modeling_context fits the result size it declares, for every purpose, with the seed for the first write', async (t) => {
  const { modelingPurposes } = await import('../src/modeling-guidance.mjs');
  const client = await connect(t, { MEANING_MODEL_ADDONS: 'storytelling,forecasting,alien' });
  const { tools } = await client.listTools();
  const declared = tools.find((tool) => tool.name === 'life_modeling_context')._meta['anthropic/maxResultSizeChars'];
  for (const purpose of modelingPurposes) {
    const result = await client.callTool({ name: 'life_modeling_context', arguments: { purpose, sessionMode: 'first_use' } });
    const sent = result.content.map((item) => item.text ?? '').join('');
    assert.ok(sent.length <= declared, `${purpose}: ${sent.length} characters against ${declared}`);
    assert.match(sent, /"firstWrite"/u, `${purpose}: the seed arrives`);
  }
});

// The values report grows with the model it reads; the result of a write stays within the size its tool declares, as
// the client is sent it, its long lists keeping their first entries.
test('a values write on a large model returns within the result size its tool declares', async (t) => {
  const markdown = await readFile(join(here, '..', '..', 'docs', 'examples', 'MINIMAL-MODEL-AND-GRAPH.md'), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(registerRequest.model);
  const template = model.processes[0];
  for (let i = 0; i < 544; i += 1) model.processes.push({ ...structuredClone(template), id: `market.process-${String(i).padStart(3, '0')}-with-a-long-identifier`, scale: { semantic_role: `A measure of part ${i} of the market, described at some length so the report carries real text`, label: `Part ${i} of the market` } });
  const mm = model.meaning_model;
  mm.importance_scales = Array.from({ length: 12 }, (_, s) => ({ id: `importance.scale-${s}`, audience: `Those who follow area ${s} of the market: its people, its money and its rules`, levels: [{ key: 'top', anchor: 'Changed the market' }, { key: 'high', anchor: 'Changed much of it' }, { key: 'some', anchor: 'Changed some of it' }], provenance: ['test'] }));
  mm.event_importance = [];
  for (let i = 0; i < 1_200; i += 1) {
    const id = `event.happening-${i}`;
    mm.events.push({ id, boundary: `Happening number ${i} in the market, which states 1,500 users and 12% of the trade, and goes on for a while`, interval: { start: 6 + (i % 18) / 10, end: 6.1 + (i % 18) / 10 }, participants: {}, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['test'] });
    mm.event_relations.push({ id: `world.contains.${id}`, kind: 'contains', source_event_id: 'event.world', target_event_id: id, description: 'Accepted-world containment.', authority: null, uncertainty: { kind: 'unknown' }, provenance: ['test'] });
    mm.event_importance.push({ id: `judged.${i}`, event_id: id, scale_id: `importance.scale-${i % 12}`, level: ['top', 'high', 'some'][i % 3], holder: 'test', provenance: ['test'] });
  }
  const client = await connect(t);
  const { tools } = await client.listTools();
  const declared = tools.find((tool) => tool.name === 'life_values_record')._meta['anthropic/maxResultSizeChars'];
  const registered = await client.callTool({ name: 'life_model_register', arguments: { requestId: 'large', model } });
  assert.ok(!registered.isError, JSON.stringify(registered.content).slice(0, 300));
  const written = await client.callTool({ name: 'life_values_record', arguments: { requestId: 'values', previousModelHash: registered.structuredContent.modelHash, holder: 'test', reason: 'One value each.',
    values: model.processes.slice(1, 301).map((process) => ({ processId: process.id, points: [{ time: 6, value: 1, tag: 'sketch' }, { time: 7.8, value: 2, tag: 'sketch' }] })) } });
  assert.ok(!written.isError, JSON.stringify(written.content).slice(0, 300));
  const sent = written.content.map((item) => item.text ?? '').join('');
  assert.ok(sent.length <= declared, `${sent.length} characters against ${declared}`);
  assert.ok(written.structuredContent.values.breadth.length >= 1);
});

// A few records with very long text: cutting long lists is not enough, so every list keeps fewer entries, and the
// result still fits the size its tool declares.
test('a values write whose records carry very long labels still returns within the declared size', async (t) => {
  const markdown = await readFile(join(here, '..', '..', 'docs', 'examples', 'MINIMAL-MODEL-AND-GRAPH.md'), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(registerRequest.model);
  const template = model.processes[0];
  const long = (i) => `Part ${i}: ${'a measure described at great length, '.repeat(28)}`.slice(0, 1_000);
  for (let i = 0; i < 65; i += 1) model.processes.push({ ...structuredClone(template), id: `long.process-${i}`, scale: { semantic_role: long(i), label: long(i) } });
  for (const [i, start] of [6.3, 6.6, 6.9].entries()) {
    const id = `event.between-${i}`;
    model.meaning_model.events.push({ id, boundary: `Something happens at ${start}`, interval: { start, end: start + 0.05 }, participants: {}, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['test'] });
    model.meaning_model.event_relations.push({ id: `world.contains.${id}`, kind: 'contains', source_event_id: 'event.world', target_event_id: id, description: 'Accepted-world containment.', authority: null, uncertainty: { kind: 'unknown' }, provenance: ['test'] });
  }
  const client = await connect(t);
  const { tools } = await client.listTools();
  const declared = tools.find((tool) => tool.name === 'life_values_record')._meta['anthropic/maxResultSizeChars'];
  const registered = await client.callTool({ name: 'life_model_register', arguments: { requestId: 'long', model } });
  assert.ok(!registered.isError, JSON.stringify(registered.content).slice(0, 300));
  const written = await client.callTool({ name: 'life_values_record', arguments: { requestId: 'values', previousModelHash: registered.structuredContent.modelHash, holder: 'test', reason: 'Turns at each date.',
    values: model.processes.slice(1).map((process, i) => ({ processId: process.id, points: [6, 6.5, 7, 7.5, 8].map((time, j) => ({ time, value: Math.abs((i + j * (j % 2 ? -3 : 5)) % 11), tag: 'sketch' })) })) } });
  assert.ok(!written.isError, JSON.stringify(written.content).slice(0, 300));
  const sent = written.content.map((item) => item.text ?? '').join('');
  assert.ok(sent.length <= declared, `${sent.length} characters against ${declared}`);
  assert.ok(written.structuredContent.modelHash, 'the write still says which revision it made');
});
