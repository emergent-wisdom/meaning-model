import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));

// The prepared development call, end to end: a life dossier for Ada returns a life_series_record call, an agent fills
// only the fields the call names, and the call records her development on the model's clock, in her own perspective.
test('a dossier\'s prepared development call records the development when filled as it says', async (t) => {
  const client = new Client({ name: 'dossier-flow', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: 'storytelling' }; delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const ok = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`); return r.structuredContent; };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, register, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  // Ada gets a dated life on a calendar clock; the example's other moments move into 2026.
  const model = register.model; model.time_unit = 'year';
  for (const event of model.meaning_model.events) {
    if (event.id === 'event.ada.life') event.interval = { start: 1990, end: 2060 };
    else if (event.interval) event.interval = { start: 2026 + event.interval.start / 1000, end: 2026 + event.interval.end / 1000 };
  }
  const base = await ok('life_model_register', { ...register, model });
  graphRequest.narrativeGraph.source.model_hash = base.modelHash;
  const graph = await ok('life_narrative_register', graphRequest);

  // The dossier dates her phases in years since birth, as dossiers do.
  const phases = [[0, 'childhood', 'Childhood in the bakery'], [18, 'apprentice', 'Apprentice at fifteen, baker at eighteen'], [30, 'ovens', 'Running the ovens'], [36, 'entry', 'The offer']];
  const trend = (id, dimension, states) => ({ id, dimension, states: phases.map(([, phaseId], i) => ({ phaseId, state: states[i] })),
    developments: phases.slice(1).map(([, toPhaseId], i) => ({ fromPhaseId: phases[i][1], toPhaseId, explanation: `What carries ${dimension.toLowerCase()} from ${phases[i][2].toLowerCase()} into ${phases[i + 1][2].toLowerCase()}.` })) });
  const dossier = { schema: 'meaning-model-story-life-trends/v1', storyRootId: 'story', storyInterval: { start: 2026.006, end: 2026.007 },
    characters: [{ characterId: 'referent.ada', name: 'Ada', lifeTimeUnit: 'years_since_birth', lifeBeginning: 0, storyEntry: 36,
      phases: phases.map(([at, id, label]) => ({ id, at, label, situation: `${label}.` })),
      trends: [trend('belonging', 'Where she believes she belongs', ['The bakery is home.', 'Torn between the bakery and the city.', 'The ovens are hers.', 'Asked to sell.']),
        trend('means', 'Money and debt', ['None of her own.', 'An apprentice wage.', 'The loan.', 'The offer would clear it.'])],
      future: { status: 'open', outlook: 'Whether she sells.' } }] };
  const stored = await ok('life_story_life_trends', { graphHash: graph.graphHash, requestId: 'dossier', nodeId: 'life.trends.ada', dossier });
  const [ada] = stored.development?.missing ?? [];
  assert.ok(ada, `no prepared development call: ${JSON.stringify(stored).slice(0, 300)}`);
  const prepared = ada.call;
  assert.deepEqual(prepared.fill, ['requestId', 'previousModelHash', 'parentEventId', 'series.question', 'series.unit', 'series.answers', 'readings[].weights']);
  assert.equal(ada.placement.inner, 'event.ada.inner');
  assert.deepEqual(prepared.arguments.readings.map(({ start, end }) => [start, end]), [[1990, 2008], [2008, 2020], [2020, 2026]], 'years since a 1990 birth, on the model\'s clock');

  // The agent fills exactly what fill names: a new requestId, the latest model hash, the placement, the carve and the shares.
  const args = structuredClone(prepared.arguments);
  Object.assign(args, { requestId: 'ada-belonging', previousModelHash: base.modelHash, parentEventId: ada.placement.inner });
  args.series = { ...args.series, question: 'How does where Ada believes she belongs divide between the bakery and somewhere else?', unit: 'share of her sense of belonging',
    answers: [{ key: 'bakery', meaning: 'The bakery and the harbour town.' }, { key: 'elsewhere', meaning: 'Anywhere she could make another life.' }] };
  args.readings = args.readings.map((reading, i) => ({ ...reading, weights: [{ bakery: 0.9, elsewhere: 0.1 }, { bakery: 0.5, elsewhere: 0.5 }, { bakery: 0.8, elsewhere: 0.2 }][i] }));
  const recorded = await ok('life_series_record', args);
  assert.deepEqual(recorded.series, { id: 'referent-ada-belonging', readings: 3, drawnAsCurve: 3 });
  const { model: after } = await ok('life_model_inspect', { modelHash: recorded.modelHash, includeDefinition: true });
  const containerOf = new Map(after.meaning_model.event_relations.filter((relation) => relation.kind === 'contains').map((relation) => [relation.target_event_id, relation.source_event_id]));
  const cuts = after.meaning_model.normalized_cuts.filter((cut) => cut.id.startsWith(`cut.series.${args.series.id}.`));
  assert.deepEqual([...new Set(cuts.map((cut) => containerOf.get(cut.parent_event_id)))], ['event.ada.inner'], 'in her own perspective');
  assert.match(cuts.find((cut) => cut.id.endsWith('.2008-2020')).provenance[0], /^invented: Apprentice at fifteen, baker at eighteen: Torn between the bakery and the city\. It changed because/u);
});
