import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));

// What someone expects belongs to their own perspective: a series recorded under their inner root draws as their curve,
// attributed to that root rather than to the accepted world.
test('a series recorded under an inner perspective draws as that person\'s own view', async (t) => {
  const client = new Client({ name: 'series-inner', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' }; delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const ok = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r.content)); return r.structuredContent; };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, register] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const base = await ok('life_model_register', register);
  const recorded = await ok('life_series_record', { requestId: 'inner', previousModelHash: base.modelHash, subject: 'referent.ada', parentEventId: 'event.ada.inner',
    reason: 'What Ada expects of the offer, in her own perspective.',
    series: { id: 'ada-expects', question: 'How does Ada expect the offer to go: keep the bakery or sell it?', unit: 'share of her expectation',
      answers: [{ key: 'keep', meaning: 'She keeps the bakery.' }, { key: 'sell', meaning: 'She sells it.' }] },
    readings: [{ start: 6, end: 6.5, why: 'The offer arrives.', tag: 'invented', weights: { keep: 0.7, sell: 0.3 } },
      { start: 6.5, end: 7, why: 'She rereads the figures.', tag: 'invented', weights: { keep: 0.4, sell: 0.6 } }] });
  assert.deepEqual(recorded.series, { id: 'ada-expects', readings: 2, drawnAsCurve: 2 });
  const viewer = await ok('life_model_viewer_open', { modelHash: recorded.modelHash });
  const data = await (await fetch(new URL('data/model.json', viewer.url))).json();
  const cuts = data.numerics.cuts.filter((cut) => cut.id.startsWith('cut.series.ada-expects.'));
  assert.equal(cuts.length, 2);
  for (const cut of cuts) assert.deepEqual(cut.contexts.map((context) => [context.rootId, context.kind, context.participants?.subject]), [['event.ada.inner', 'inner', 'referent.ada']]);
});
