// Something on the page early: the context's seed registers as given, a rough model of the whole opens beneath it
// through the checked tools, and the required reading says when each text is due.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { buildModelingContext } from '../src/modeling-guidance.mjs';
import { firstWrite } from '../src/first-write.mjs';
import { grammarReadingInstructions, processDevelopmentInstructions, readingTiming, sessionReadingInstructions } from '../src/construction-principles.mjs';

test('the context gives a seed for the first write, and each required text says when it is due', async () => {
  const context = await buildModelingContext({ purpose: 'observation', sessionMode: 'first_use' });
  assert.equal(context.firstWrite.tool, 'life_model_register');
  assert.deepEqual(context.firstWrite.arguments, firstWrite().arguments);
  const due = Object.fromEntries(context.orderedResources.filter((resource) => resource.required).map((resource) => [resource.uri, resource.due]));
  assert.deepEqual(due, { 'life-sim://guide/start-here': 'start', 'life-sim://guide/process-breakdown': 'start', 'life-sim://protocol/grammar': 'before-depth',
    'life-sim://protocol/modeling': 'before-depth', 'life-sim://guide/general-modeling': 'before-depth', 'life-sim://example/minimal-model-and-graph': 'before-depth' });
  assert.equal(context.readingTiming, readingTiming);
  assert.equal(context.grammarInstructions, sessionReadingInstructions);
  assert.match(readingTiming, /before you write records by hand \(life_model_revise, or a life_model_register beyond the seed\), before you assess or review a model, and when a deeper pass begins/u);
  assert.match(processDevelopmentInstructions, /a rough model of the whole within your first few writes, before depth/u);
  // A delegated role keeps reading the grammar before it constructs, revises or assesses.
  assert.match(grammarReadingInstructions, /Before constructing, revising or assessing a Meaning Model, it then reads the complete current grammar/u);
  // Continuing recorded work starts from that work, not from a seed.
  assert.equal((await buildModelingContext({ purpose: 'observation', sessionMode: 'continuation' })).firstWrite, undefined);
  // A fresh copy each time.
  const seed = firstWrite(); seed.arguments.model.id = 'changed';
  assert.equal(firstWrite().arguments.model.id, 'my-world');
});

test('through the real server: the seed registers as given, and a rough model of the whole opens beneath it', async (t) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const client = new Client({ name: 'first-write-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const { tool, arguments: args } = firstWrite();
  const registered = await client.callTool({ name: tool, arguments: args });
  assert.ok(!registered.isError, JSON.stringify(registered.content).slice(0, 400));
  const opened = await client.callTool({ name: 'life_values_record', arguments: { requestId: 'rough', previousModelHash: registered.structuredContent.modelHash, holder: 'test', reason: 'A rough model of the whole.',
    values: [
      { processId: 'world', points: [{ time: 2000, value: 5, tag: 'sketch' }, { time: 2025, value: 6, tag: 'sketch' }] },
      { processId: 'world.people', process: { label: 'People', unit: 'million people', parent: 'world' }, points: [{ time: 2000, value: 5.3, tag: 'sketch' }, { time: 2025, value: 5.9, tag: 'sketch' }] },
      { processId: 'world.wealth', process: { label: 'Wealth', unit: 'billion euros', parent: 'world' }, points: [{ time: 2000, value: 160, tag: 'sketch' }, { time: 2025, value: 380, tag: 'sketch' }] },
    ] } });
  assert.ok(!opened.isError, JSON.stringify(opened.content).slice(0, 400));
  const report = opened.structuredContent.values;
  assert.deepEqual([report.processes, report.valued, report.stillEmptyCount], [3, 3, 0]);
  assert.equal(report.schedule.reached, 1);
});
