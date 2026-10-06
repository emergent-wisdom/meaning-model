// A life read once across years in which things happen looks complete to a check that asks only whether records exist,
// and stays flat in the viewer. The tool says so itself, the worst stretch first, and lays out the readings that would
// open it, each nested in the reading it details with the average it must keep.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { flatStretches, modelQuestions } from '../src/model-questions.mjs';
import { seriesPlan } from '../src/series-plan.mjs';

const t = ['lives-test'];
const event = (id, start, end, extra = {}) => ({ id, boundary: id, description: `What happens in ${id}.`, interval: start === null ? null : { start, end }, participants: { subject: 'ref.kim' }, process_ids: [], provenance: t, ...extra });
const contains = (source, target) => ({ id: `${source}>${target}`, kind: 'contains', source_event_id: source, target_event_id: target, provenance: t });
const outlook = (id, eventId, assurance, threat) => ({ id, parent_event_id: eventId, question: 'Across this stretch, how does Kim expect what they want to turn out?', unit: 'share of outlook',
  answers: [{ key: 'assurance', weight: assurance }, { key: 'threat', weight: threat }, { key: 'remainder', weight: Number((1 - assurance - threat).toFixed(6)) }], provenance: t });
// Kim's life read in three long stretches: a childhood with one Event in it, working years with two, and the years a
// story covers with six; the working years' period names a process the others do not.
function lifeModel() {
  const happenings = [event('e.school', 2001, 2001.1), event('e.job', 2012, 2012.1), event('e.flat', 2016, 2016.1),
    ...[2020.2, 2020.6, 2021.1, 2021.7, 2022.4, 2022.9].map((at, i) => event(`e.story${i}`, at, at + 0.05))];
  const events = [
    { ...event('event.world', 1900, 2030), participants: {} },
    event('event.kim.life', 1990, 2023.25), event('p.childhood', 1990, 2010), event('p.work', 2010, 2019.8, { process_ids: ['kim.known_faces'] }),
    event('p.story', 2019.8, 2023.25), ...happenings,
  ];
  const relations = [contains('event.world', 'event.kim.life'), ...['p.childhood', 'p.work', 'p.story'].map((id) => contains('event.kim.life', id)),
    contains('p.childhood', 'e.school'), contains('p.work', 'e.job'), contains('p.work', 'e.flat'), ...happenings.slice(3).map((item) => contains('p.story', item.id))];
  return { id: 'kim', time_unit: 'year', processes: [{ id: 'kim.known_faces', unit: 'count', support: [] }],
    meaning_model: { context_roots: [{ event_id: 'event.world', kind: 'accepted_world', provenance: t }],
      referents: [{ id: 'ref.kim', boundary: 'Kim, born 1990', lifecycle_event_id: 'event.kim.life', provenance: t }], events, event_relations: relations,
      normalized_cuts: [outlook('cut.childhood', 'p.childhood', 0.6, 0.3), outlook('cut.work', 'p.work', 0.66, 0.2), outlook('cut.story', 'p.story', 0.55, 0.35)] } };
}

test('the stretches still read once come worst first: where most happens, then the longest', () => {
  const stretches = flatStretches(lifeModel(), 'ref.kim');
  assert.deepEqual(stretches.map((item) => [item.cut, item.events]), [['cut.story', 6], ['cut.work', 2]], 'a childhood with one Event in it is not yet a stretch to open');
  const { questions } = modelQuestions(lifeModel(), { limit: 40 });
  const stretch = questions.find((item) => item.kind === 'reading-stretch-unopened');
  assert.match(stretch.question, /^Kim: "Across this stretch, how does Kim expect what they want to turn out\?" is read once from 2019\.8 to 2023\.25/u);
  assert.match(stretch.question, /life_series_plan lays out the readings/u);
  assert.equal(stretch.tool, 'life_series_plan');
  assert.ok(questions.findIndex((item) => item.kind === 'reading-stretch-unopened') < 3, 'a life that does not move is among the first things asked');
});

test('a reading the viewer would draw apart from its curve is named, with the process its Event names', () => {
  const { questions } = modelQuestions(lifeModel(), { limit: 40 });
  const split = questions.find((item) => item.kind === 'series-split');
  assert.ok(split, 'the working years sit in a period that names kim.known_faces');
  assert.match(split.question, /is read 3 times, but 1 of the readings \(from 2010 to 2019\.8\) sit in Events that name processes the others do not \(kim\.known_faces\)/u);
});

test('the plan lays out quarters nested in the readings they detail, with the shares those must keep', () => {
  const plan = seriesPlan(lifeModel(), { subject: 'ref.kim', from: 2013, to: 2023.25, step: 'quarter' });
  const [series] = plan.series;
  assert.equal(series.slots.length, 42, 'forty-one quarters from 2013 to the first of 2023, one of them cut where the working years end');
  assert.deepEqual(series.slots.slice(0, 2).map((slot) => [slot.start, slot.end, slot.label, slot.within]), [[2013, 2013.25, '2013 Q1', 'cut.work'], [2013.25, 2013.5, '2013 Q2', 'cut.work']]);
  // The working years end at 2019.8, inside a quarter: the slot stops there and the next one starts in the story's stretch.
  assert.deepEqual(series.slots.filter((slot) => slot.start >= 2019.5 && slot.start < 2020).map((slot) => [slot.start, slot.end, slot.within]),
    [[2019.5, 2019.75, 'cut.work'], [2019.75, 2019.8, 'cut.work'], [2019.8, 2020, 'cut.story']]);
  assert.deepEqual(series.keep.map((item) => [item.cut, item.shares.assurance, item.slots]), [['cut.work', 0.66, 28], ['cut.story', 0.55, 14]]);
  assert.match(plan.rule, /revise it with a recorded reason rather than bending the detail to fit/u);
  assert.throws(() => seriesPlan(lifeModel(), { subject: 'ref.kim', from: 2013, to: 2010 }), /from must come before to/u);
  assert.throws(() => seriesPlan(lifeModel(), { subject: 'ref.nobody', from: 2013, to: 2020 }), /has no series to plan/u);
  const yearly = seriesPlan(lifeModel(), { subject: 'ref.kim', from: 1990, to: 2013, step: 'year' }).series[0];
  assert.ok(yearly.slots.every((slot) => slot.end - slot.start <= 1 + 1e-9) && yearly.slots[0].label === '1990');
});

test('numeric steps in a day calendar retain calendar-year inputs and nest in the existing readings', () => {
  const model = lifeModel();
  const day = (year) => (year - 1970) * 365.2425;
  model.time_unit = 'civil_day_since_1970';
  for (const item of model.meaning_model.events) {
    item.interval = { start: day(item.interval.start), end: day(item.interval.end) };
  }
  const plan = seriesPlan(model, { subject: 'ref.kim', from: 2013, to: 2014, step: 30 });
  const [series] = plan.series;
  assert.equal(series.slots[0].start, 15705.4275, '2013 is converted to days since 1970 even with a numeric step');
  assert.equal(series.slots.at(-1).end, 16070.67, 'the end remains the requested calendar year');
  assert.equal(series.slots[0].end, 15720, 'step boundaries are multiples of 30 model days');
  assert.ok(series.slots.every((slot) => slot.end - slot.start <= 30 + 1e-9 && slot.within === 'cut.work'));
  assert.ok(series.slots.every((slot) => slot.label === '2013'), 'labels use years rather than days since the epoch');
  assert.deepEqual(series.keep.map((item) => [item.cut, item.shares.assurance, item.slots]), [['cut.work', 0.66, series.slots.length]]);
  const named = seriesPlan(model, { subject: 'ref.kim', from: 2013, to: 2014, step: 'quarter' }).series[0];
  assert.equal(named.slots.length, 4);
  assert.equal(named.slots[0].start, series.slots[0].start);
  assert.equal(named.slots.at(-1).end, series.slots.at(-1).end);
  assert.equal(named.slots[0].label, '2013 Q1');
});

test('life_series_plan answers over MCP in a model\'s own units', async (t2) => {
  const client = new Client({ name: 'lives-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' }; delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))], env }));
  t2.after(() => client.close());
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const registered = await call('life_model_register', registerRequest);
  const recorded = await call('life_series_record', { requestId: 'mood', previousModelHash: registered.modelHash, subject: 'referent.ada', parentEventId: 'event.ada.inner', reason: 'Follow her evening.',
    series: { id: 'ada-mood', question: 'How does Ada expect the evening to turn out?', unit: 'one unit of outlook', answers: [{ key: 'calm', meaning: 'It will be fine.' }, { key: 'worry', meaning: 'It may go wrong.' }] },
    readings: [{ start: 0, end: 6, weights: { calm: 0.7, worry: 0.3 }, tag: 'invented', why: 'A quiet day.' }, { start: 6, end: 12, weights: { calm: 0.4, worry: 0.6 }, tag: 'invented', why: 'The offer arrives.' }] });
  const plan = await call('life_series_plan', { modelHash: recorded.modelHash, subject: 'referent.ada', question: 'How does Ada expect the evening to turn out?', from: 6, to: 12, step: 2 });
  assert.equal(plan.series.length, 1, 'one series by its question');
  assert.deepEqual(plan.series[0].slots.map((slot) => [slot.start, slot.end]), [[6, 8], [8, 10], [10, 12]]);
  assert.equal(plan.series[0].keep[0].shares.calm, 0.4);
  const refused = await client.callTool({ name: 'life_series_plan', arguments: { modelHash: recorded.modelHash, subject: 'referent.ada', from: 6, to: 12, step: 'quarter' } });
  assert.ok(refused.isError && /not a calendar/u.test(JSON.stringify(refused.content)));
});
