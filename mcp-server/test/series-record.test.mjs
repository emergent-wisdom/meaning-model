import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'src', 'server.ts');

// A subject with a life inside an accepted world: the smallest model a series can be recorded in and drawn from.
const unknown = { kind: 'unknown' };
const model = {
  schema: 'life-sim-rust-model/v1', id: 'protocol-history', time_unit: 'year', laws: [], initial_claims: [], decomposition: [], dependencies: [],
  processes: [{ id: 'protocol.validators', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 10000000 } }, initial_value: { kind: 'scalar', value: 0 },
    unit: 'validators', update_mode: 'observed', reference_frame: 'chain', scale: { semantic_role: 'active validators' }, support: ['series test'],
    uncertainty: { kind: 'unknown' }, axes: [], access_scopes: [], provenance: ['series test'] }],
  revision: { number: 0, previous_model_hash: null, provenance: ['series test'], reason: 'A protocol and its world.' },
  meaning_model: {
    schema: 'life-sim-rust-meaning-model/v1',
    referents: [{ id: 'referent.protocol', boundary: 'A public blockchain protocol and its developer community', continuity_criterion: 'The same chain and its continuing community',
      lifecycle_event_id: 'event.protocol.life', interval: null, authority: null, uncertainty: unknown, provenance: ['series test'] }],
    events: [
      { id: 'event.world', boundary: 'The accepted world', description: 'The world the protocol lives in.', interval: { start: 2010, end: 2030 },
        participants: {}, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['series test'] },
      { id: 'event.protocol.life', boundary: 'The protocol from its whitepaper to now', description: 'Its life so far.', interval: { start: 2014, end: 2026 },
        participants: { subject: 'referent.protocol' }, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['series test'] },
      { id: 'event.fork', boundary: 'A contested emergency fork', description: 'The community forks to undo a hack.', interval: { start: 2016.5, end: 2016.6 },
        participants: { subject: 'referent.protocol' }, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['series test'] },
    ],
    event_referent_bindings: [],
    event_relations: [
      { id: 'world.contains.life', kind: 'contains', source_event_id: 'event.world', target_event_id: 'event.protocol.life', description: null, authority: null, uncertainty: unknown, provenance: ['series test'] },
      { id: 'life.contains.fork', kind: 'contains', source_event_id: 'event.protocol.life', target_event_id: 'event.fork', description: null, authority: null, uncertainty: unknown, provenance: ['series test'] },
    ],
    normalized_cuts: [], context_roots: [{ event_id: 'event.world', kind: 'accepted_world', provenance: ['series test'] }],
    concepts: [], abstract_cuts: [], abstract_relations: [], encapsulation_cuts: [], physical_cuts: [], realizations: [],
  },
};
const priorities = { id: 'protocol-priorities', question: 'How does the protocol community\'s core priority divide among decentralization, efficiency and security?',
  unit: 'share of core development priority',
  answers: [{ key: 'decentralization', meaning: 'Who can validate, build, verify and govern.' }, { key: 'efficiency', meaning: 'Throughput, cost and speed.' },
    { key: 'security', meaning: 'Resistance to attacks and failures.' }] };
const reading = (start, end, d, e, s, extra = {}) => ({ start, end, why: `The stretch from ${start} to ${end}.`, tag: 'inferred', weights: { decentralization: d, efficiency: e, security: s }, ...extra });

test('a whole series is one call: dated readings with reasons draw as a curve, nest, open a category, and refuse what could not draw', async (t) => {
  const client = new Client({ name: 'series-record-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' }; delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env }));
  t.after(() => client.close());
  const call = async (name, args) => client.callTool({ name, arguments: args });
  const ok = async (name, args) => { const result = await call(name, args); assert.ok(!result.isError, JSON.stringify(result.content)); return result.structuredContent; };

  const base = await ok('life_model_register', { requestId: 'base', model });
  const first = await ok('life_series_record', { requestId: 'first', previousModelHash: base.modelHash, subject: 'referent.protocol', series: priorities,
    reason: 'Ethereum-like priorities across four stretches.',
    readings: [reading(2014, 2016.5, 0.6, 0.1, 0.3), reading(2016.5, 2018, 0.35, 0.35, 0.3, { causes: ['event.fork'] }), reading(2018, 2022, 0.5, 0.3, 0.2), reading(2022, 2026, 0.6, 0.25, 0.15)] });
  assert.deepEqual(first.series, { id: 'protocol-priorities', readings: 4, drawnAsCurve: 4 });
  const stored = (await ok('life_model_inspect', { modelHash: first.modelHash, includeDefinition: true })).model.meaning_model;
  const cut = stored.normalized_cuts.find((item) => item.id === 'cut.series.protocol-priorities.2016.5-2018');
  assert.deepEqual(cut.answers.map(({ key, weight }) => [key, weight]).sort(), [['decentralization', 0.35], ['efficiency', 0.35], ['remainder', 0], ['security', 0.3]]);
  assert.deepEqual(cut.provenance, ['inferred: The stretch from 2016.5 to 2018.']);
  assert.ok(stored.event_relations.some((relation) => relation.kind === 'causes' && relation.source_event_id === 'event.fork' && relation.target_event_id === cut.parent_event_id));

  // Finer readings nest inside a long one; recording the same interval again replaces it rather than adding another.
  const nested = await ok('life_series_record', { requestId: 'nested', previousModelHash: first.modelHash, subject: 'referent.protocol', series: priorities,
    reason: 'Open the last stretch.', readings: [reading(2022, 2023, 0.75, 0.1, 0.15), reading(2022, 2026, 0.62, 0.23, 0.15)] });
  assert.deepEqual(nested.series, { id: 'protocol-priorities', readings: 5, drawnAsCurve: 5 });

  // Opening a category: a second series divides decentralization on the same Events, interval by interval.
  const opened = await ok('life_series_record', { requestId: 'opened', previousModelHash: nested.modelHash, subject: 'referent.protocol',
    series: { id: 'protocol-decentralization', question: 'Within decentralization, how does the priority divide among validation, block building and verification?',
      unit: 'share of the decentralization priority', conditionedOn: { seriesId: 'protocol-priorities', answerKey: 'decentralization' },
      answers: [{ key: 'validation', meaning: 'Who validates.' }, { key: 'block_building', meaning: 'Who builds blocks.' }, { key: 'verification', meaning: 'Who can check the chain.' }] },
    reason: 'Open decentralization in two stretches.',
    readings: [{ start: 2014, end: 2016.5, why: 'Mining and running nodes.', tag: 'exploring', weights: { validation: 0.5, block_building: 0.1, verification: 0.4 } },
      { start: 2022, end: 2026, why: 'Censorship and staking concentration.', tag: 'exploring', weights: { validation: 0.3, block_building: 0.5, verification: 0.2 } }] });
  const openedCuts = (await ok('life_model_inspect', { modelHash: opened.modelHash, includeDefinition: true })).model.meaning_model.normalized_cuts
    .filter((item) => item.id.startsWith('cut.series.protocol-decentralization.'));
  assert.deepEqual(openedCuts.map((item) => [item.parent_event_id, item.conditioning]), [
    ['event.series.protocol-priorities.2014-2016.5', { cut_id: 'cut.series.protocol-priorities.2014-2016.5', answer_key: 'decentralization' }],
    ['event.series.protocol-priorities.2022-2026', { cut_id: 'cut.series.protocol-priorities.2022-2026', answer_key: 'decentralization' }]]);

  // What would not draw as one series is refused, with the reason.
  const refused = async (args, pattern) => {
    const result = await call('life_series_record', { requestId: `refused-${Math.random()}`, previousModelHash: opened.modelHash, subject: 'referent.protocol', reason: 'refusal', ...args });
    assert.ok(result.isError, 'expected a refusal'); assert.match(JSON.stringify(result.content), pattern);
  };
  await refused({ series: { ...priorities, question: 'How does the community\'s core priority divide?' }, readings: [reading(2020, 2021, 0.5, 0.3, 0.2)] }, /already asks .*a reworded question would start a separate series/);
  await refused({ series: priorities, readings: [reading(2021, 2024, 0.5, 0.3, 0.2)] }, /partly overlaps the reading 2018 to 2022; nest one inside the other/);
  await refused({ series: priorities, readings: [reading(2019, 2020, 0.5, 0.3, 0.1)] }, /must be nonnegative and sum to 1; they sum to 0\.9/);
  await refused({ series: priorities, readings: [{ ...reading(2019, 2020, 0.5, 0.3, 0.2), tag: 'guessed' }] }, /tag|Invalid/);
  await refused({ series: { id: 'protocol-decentralization', question: 'Within decentralization, how does the priority divide among validation, block building and verification?',
    unit: 'share of the decentralization priority', conditionedOn: { seriesId: 'protocol-priorities', answerKey: 'decentralization' },
    answers: [{ key: 'validation', meaning: 'v' }, { key: 'block_building', meaning: 'b' }, { key: 'verification', meaning: 'c' }] },
  readings: [{ start: 2016.5, end: 2017, why: 'No parent reading of this interval.', tag: 'exploring', weights: { validation: 1 } }] }, /no reading of exactly that interval to divide/);
});
