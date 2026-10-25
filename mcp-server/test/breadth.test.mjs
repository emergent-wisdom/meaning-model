// The breadth check (breadth.mjs) and its answers (life_breadth_record): loose Events grouped by the scale they are
// judged on, by the Event that holds them or as the whole model; stated quantities; remainders; open completeness;
// answers that leave until the evidence grows; the scoped reading; and the tool on the real engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { breadthCheck, breadthLine } from '../src/breadth.mjs';
import { breadthChange } from '../src/breadth-record.mjs';
import { questionModel } from '../src/model-questions.mjs';
import { valuesReport } from '../src/values-record.mjs';

const event = (id, boundary, extra = {}) => ({ id, boundary, interval: { start: extra.start ?? 0, end: (extra.start ?? 0) + 1 }, process_ids: extra.names ?? [], observation_process_ids: [],
  participants: {}, substrate: null, region: null, provenance: ['sketch: fixture'], ...(extra.description ? { description: extra.description } : {}) });
const contains = (source, target) => ({ id: `${source}.contains.${target}`, kind: 'contains', source_event_id: source, target_event_id: target, provenance: ['x'] });
const scalar = (id, extra = {}) => ({ id, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1e12 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'u',
  provenance: ['sketch: fixture'], support: ['s'], scale: { label: id.toUpperCase() }, ...extra });
const scale = (id, audience) => ({ id, audience, levels: [{ key: 'top' }, { key: 'high' }, { key: 'some' }], provenance: ['x'] });
const judge = (eventId, scaleId, level) => ({ id: `j.${scaleId}.${eventId}`, event_id: eventId, scale_id: scaleId, level, provenance: ['x'] });
const model = (meaning, processes = [scalar('p.states'), scalar('p.war')]) => ({ schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year',
  revision: { number: 4, previous_model_hash: null, reason: 'r', provenance: ['p'] }, processes, decomposition: [], dependencies: [], laws: [], initial_claims: [], value_series: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents: [], events: [], event_relations: [], normalized_cuts: [], abstract_cuts: [], ...meaning } });

// A small world: politics and war judged on their own scales, and one scale that judges nearly everything.
const world = () => model({
  events: [
    event('e.babylon', 'Babylon rises'), event('e.egypt', 'Egypt unified', { description: 'About 1.5 million people under one king.' }), event('e.rome', 'Rome falls'),
    event('e.treaty', 'A treaty is signed', { names: ['p.states'] }),
    event('e.raid', 'A raid on the coast'), event('e.siege', 'A siege', { names: ['p.war'] }),
    ...['e.x1', 'e.x2', 'e.x3'].map((id) => event(id, 'Something else', { names: ['p.war'] })),
  ],
  importance_scales: [scale('imp.politics', 'Those who follow politics: polities and rule'), scale('imp.war', 'Those who follow war'), scale('imp.all', 'Everyone')],
  event_importance: [judge('e.babylon', 'imp.politics', 'top'), judge('e.egypt', 'imp.politics', 'top'), judge('e.rome', 'imp.politics', 'high'), judge('e.treaty', 'imp.politics', 'some'),
    judge('e.raid', 'imp.war', 'some'), judge('e.siege', 'imp.war', 'top'),
    ...['e.babylon', 'e.egypt', 'e.rome', 'e.treaty', 'e.raid', 'e.siege', 'e.x1', 'e.x2', 'e.x3'].map((id) => judge(id, 'imp.all', 'some'))],
});

test('loose Events are grouped by the scale they are judged on, a scale judging most Events is not a group, and linking comes first', () => {
  const check = breadthCheck(world(), { label: (id) => id.toUpperCase() });
  assert.deepEqual(check.ranked.map((item) => item.candidate), ['events:imp.politics', 'events:imp.war']);
  const [politics] = check.ranked;
  assert.deepEqual([politics.events, politics.weight, politics.quantities], [3, 8 + 8 + 4, 1]);
  assert.deepEqual(politics.examples.map((item) => item.id), ['e.babylon', 'e.egypt', 'e.rome']);
  assert.deepEqual(politics.followed, [{ id: 'p.states', label: 'P.STATES' }]);
  assert.deepEqual(politics.quantity, { id: 'e.egypt', label: 'Egypt unified', states: '1.5 million people' });
  const line = breadthLine(check);
  assert.match(line, /^Breadth check: is something changing that no process follows\? Of the Events judged for those who follow politics, 3 name no process, among them Babylon rises; Egypt unified; Rome falls\. 1 of them state a quantity, such as Egypt unified \(1\.5 million people\)\. The model follows P\.STATES there: name in each Event's process_ids the process it changes, or open what they change as a new process/u);
  assert.match(line, /record why with life_breadth_record \(candidate "events:imp\.politics"\), so it is not asked again until the evidence grows\. Next: 1 Event\(s\) judged for those who follow war\.$/u);
});

test('without a scale, loose Events are grouped by the Event that holds them, and failing that as the whole model', () => {
  const m = model({ events: [event('era', 'The early age'), event('a', 'A happens'), event('b', 'B happens'), event('c', 'C happens')], event_relations: [contains('era', 'a'), contains('era', 'b')] });
  const check = breadthCheck(m);
  assert.deepEqual(check.ranked.map((item) => [item.candidate, item.events]), [['events:within:era', 2], ['events:world', 1]]);
  assert.match(breadthLine(check), /Of the Events within The early age, 2 name no process, among them A happens; B happens\. No process is named there yet: open what they change as a new process/u);
  assert.match(breadthLine({ ranked: [check.ranked[1]] }), /^Breadth check: is something changing that no process follows\? 1 Event\(s\) in the model name no process, among them C happens\./u);
});

test('a remainder at 15% or more asks what is in it, by its key; a smaller one and a meaning that only mentions others do not', () => {
  const cut = (id, answers) => ({ id, parent_event_id: 'e', question: 'What are the deaths made of?', unit: 'share of deaths', answers, provenance: ['x'] });
  const m = model({ events: [event('e', 'The epidemic', { names: ['p.war'] })], normalized_cuts: [
    cut('cut.series.deaths.a', [{ key: 'smallpox', weight: 0.58 }, { key: 'other_epidemics', weight: 0.42, meaning: 'Measles and typhus' }]),
    cut('cut.series.deaths.b', [{ key: 'smallpox', weight: 0.7 }, { key: 'other_epidemics', weight: 0.3, meaning: 'Measles and typhus' }]),
    cut('cut.small', [{ key: 'a', weight: 0.9 }, { key: 'remainder', weight: 0.1 }]),
    cut('cut.mention', [{ key: 'others_view', weight: 0.05 }, { key: 'theirs', weight: 0.95, meaning: 'What the others think' }]),
  ] });
  const check = breadthCheck(m);
  assert.deepEqual(check.ranked.map((item) => [item.candidate, item.share, item.readings]), [['remainder:deaths:other_epidemics', 0.42, 2]]);
  assert.equal(breadthLine(check), 'Breadth check: what is in "Measles and typhus", up to 42% of "What are the deaths made of?" across 2 readings? Divide it with a conditioned series (life_series_record with conditionedOn), or record why with life_breadth_record (candidate "remainder:deaths:other_epidemics"), so it is not asked again until the evidence grows.');
});

test('a carve whose completeness did not pass asks what has no home among its parts', () => {
  const m = model({ concepts: [{ id: 'c.war', label: 'War', provenance: ['x'] }], abstract_cuts: [
    { id: 'carve.war', parent_concept_id: 'c.war', child_concept_ids: [], lens: 'l', provenance: ['inferred: life_carve_record by m', 'completeness uncertain, checked against nothing'] },
    { id: 'carve.done', parent_concept_id: 'c.war', child_concept_ids: [], lens: 'l', provenance: ['completeness pass'] }] });
  const check = breadthCheck(m);
  assert.deepEqual(check.ranked.map((item) => item.candidate), ['gap:carve.war']);
  assert.match(breadthLine(check), /^Breadth check: your carve of War left its completeness unshown: what has no home among its parts\? Carve it again with the missing part among the candidates/u);
});

test('an answer takes its candidate out until its evidence grows by half, and it comes back marked as answered before', () => {
  let m = world();
  const recorded = (current, input) => { const { change } = breadthChange(current, { holder: 'm', tag: 'inferred', reason: 'Not what this model is for.', ...input });
    return { ...current, meaning_model: { ...current.meaning_model, concepts: [...current.meaning_model.concepts.filter((c) => !change.upsert.concepts.some((u) => u.id === c.id)), ...change.upsert.concepts] } }; };
  m = recorded(m, { candidate: 'events:imp.politics', answer: 'not_modeled', concept: { label: 'Who rules' } });
  let check = breadthCheck(m);
  assert.deepEqual(check.ranked.map((item) => item.candidate), ['events:imp.war']);
  assert.deepEqual(check.considered.map((item) => [item.candidate, item.answer, item.label, item.signals.events]), [['events:imp.politics', 'not_modeled', 'Who rules', 3]]);
  // Two more loose politics Events make 5, which is half again of 3 and at least 2 more, so it comes back.
  m.meaning_model.events.push(event('e.persia', 'Persia rises'), event('e.han', 'The Han rise'));
  m.meaning_model.event_importance.push(judge('e.persia', 'imp.politics', 'some'), judge('e.han', 'imp.politics', 'some'));
  check = breadthCheck(m);
  const politics = check.ranked.find((item) => item.candidate === 'events:imp.politics');
  assert.equal(politics.answeredBefore, 'not_modeled');
  assert.match(breadthLine({ ranked: [politics] }), /It was answered not modeled before, and its evidence has grown by half since\./u);
  // modeled names the process that follows it; answering again replaces the earlier answer under the same id.
  m = recorded(m, { candidate: 'events:imp.politics', answer: 'modeled', process: 'p.states', concept: { label: 'Number of states' } });
  check = breadthCheck(m);
  assert.deepEqual(check.considered.map((item) => [item.answer, item.followedBy, item.signals.events]), [['modeled', 'p.states', 5]]);
  assert.equal(check.ranked.some((item) => item.candidate === 'events:imp.politics'), false);
});

test('the tool refuses only what contradicts the model', () => {
  const base = { holder: 'm', tag: 'inferred', reason: 'r', concept: { label: 'X' } };
  assert.throws(() => breadthChange(world(), { ...base, candidate: 'events:imp.politics', answer: 'modeled', process: 'p.nothing' }), /process names p\.nothing, which the model does not have/u);
  assert.throws(() => breadthChange(world(), { ...base, candidate: 'events:imp.politics', answer: 'modeled' }), /name that process in process/u);
  const m = model({ events: [event('era', 'The early age'), event('a', 'A happens'), event('b', 'B happens')], event_relations: [contains('era', 'a'), contains('era', 'b')] });
  assert.throws(() => breadthChange(m, { ...base, candidate: 'events:within:era', answer: 'linked' }), /linked says the group's Events now name processes, but 2 Event\(s\) within The early age still name none, such as A happens; B happens/u);
  // One Event of the group naming a process elsewhere does not make the loose ones linked.
  m.meaning_model.events.push(event('c', 'C happens', { names: ['p.war'] })); m.meaning_model.event_relations.push(contains('era', 'c'));
  assert.throws(() => breadthChange(m, { ...base, candidate: 'events:within:era', answer: 'linked' }), /2 Event\(s\) within The early age still name none/u);
  assert.throws(() => breadthChange(m, { ...base, candidate: 'remainder:deaths:other', answer: 'linked' }), /linked answers a group of Events\. A remainder is opened with a conditioned series/u);
  const taken = model({ ...world().meaning_model, concepts: [{ id: 'c.taken', label: 'Taken', provenance: ['x'] }] });
  assert.throws(() => breadthChange(taken, { ...base, candidate: 'events:imp.war', answer: 'not_modeled', concept: { id: 'c.taken', label: 'X' } }), /not an answer to the breadth check/u);
  // An answer to a candidate the check does not name now is recorded with no evidence, not refused.
  const { change, plan } = breadthChange(world(), { ...base, candidate: 'events:imp.trade', answer: 'not_modeled' });
  assert.equal(plan.item, null);
  assert.match(change.upsert.concepts[0].provenance.join('\n'), /breadth-signals:events=0;quantities=0;share=0/u);
});

test('in a scope that hides a process, the check names no hidden process and an answer keeps standing without naming it', () => {
  const m = world();
  m.processes[0].access_scopes = ['secret'];
  const { change } = breadthChange(m, { holder: 'm', tag: 'inferred', reason: 'r', candidate: 'events:imp.war', answer: 'modeled', process: 'p.states', concept: { label: 'Raids' } });
  m.meaning_model.concepts.push(...change.upsert.concepts);
  const scoped = questionModel(m, []);
  const check = breadthCheck(scoped);
  assert.equal(JSON.stringify(check).includes('p.states'), false);
  assert.deepEqual(check.considered.map((item) => [item.candidate, item.followedBy ?? null, item.label]), [['events:imp.war', null, 'An answer to the breadth check']]);
  // The answer's own words may name the hidden process: its label, boundary and reason are not read in this scope.
  const named = world(); named.processes[0].access_scopes = ['secret'];
  const words = breadthChange(named, { holder: 'm', tag: 'inferred', reason: 'Followed with p.states, the count of states.', candidate: 'events:imp.war', answer: 'modeled', process: 'p.states', concept: { label: 'Followed with p.states' } }).change;
  named.meaning_model.concepts.push(...words.upsert.concepts);
  const read = questionModel(named, []);
  assert.equal(JSON.stringify(read.meaning_model.concepts).includes('p.states'), false);
  assert.equal(JSON.stringify(valuesReport(read)).includes('p.states'), false);
  assert.ok(JSON.stringify(questionModel(named, ['secret']).meaning_model.concepts).includes('Followed with p.states'), 'the answer reads whole where the process is visible');
  assert.equal(check.ranked.some((item) => item.candidate === 'events:imp.war'), false);
});

test('the values report carries the breadth check: its line on the same rule as the deepen line, its top ten in the data', () => {
  const report = valuesReport(world());
  assert.deepEqual(report.breadth.map((item) => item.candidate), ['events:imp.politics', 'events:imp.war']);
  assert.equal(report.breadthCount, 2);
  assert.ok(report.next.some((line) => line.startsWith('Breadth check: is something changing that no process follows?')));
  // The same top on revision 4 (not a multiple of 3) is not repeated; a changed top, or revision 6, shows it.
  assert.ok(!valuesReport(world(), { previousBreadth: 'events:imp.politics' }).next.some((line) => line.startsWith('Breadth check')));
  assert.ok(valuesReport(world(), { previousBreadth: 'events:imp.war' }).next.some((line) => line.startsWith('Breadth check')));
  const sixth = world(); sixth.revision.number = 6;
  assert.ok(valuesReport(sixth, { previousBreadth: 'events:imp.politics' }).next.some((line) => line.startsWith('Breadth check')));
});

test('through the real server: linked is refused while Events stay loose, an answer with a long reason is one revision with one concept, and the next report leaves the candidate out', async (t) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const client = new Client({ name: 'breadth-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const registered = await client.callTool({ name: 'life_model_register', arguments: { requestId: 'model', model: registerRequest.model } });
  const events = [['event.rumour', 'The bank raises its rate to 9% for 300 customers', 8], ['event.storm', 'A storm closes the harbour', 9]]
    .map(([id, boundary, start]) => ({ id, boundary, interval: { start, end: start + 1 }, participants: {}, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: ['sketch: test'] }));
  const revised = await client.callTool({ name: 'life_model_revise', arguments: { requestId: 'events', previousModelHash: registered.structuredContent.modelHash, change: { reason: 'Two happenings.', provenance: ['test'],
    upsert: { events, event_relations: events.map((item) => ({ id: `world.contains.${item.id}`, kind: 'contains', source_event_id: 'event.world', target_event_id: item.id, description: 'Accepted-world containment.', authority: null, uncertainty: { kind: 'unknown' }, provenance: ['test'] })) } } } });
  assert.ok(!revised.isError, JSON.stringify(revised.content).slice(0, 400));
  const values = async (requestId, previousModelHash) => client.callTool({ name: 'life_values_record', arguments: { requestId, previousModelHash, holder: 'test', reason: 'Values.',
    values: [{ processId: 'bakery.debt_nok', points: [{ time: 6, value: 100, tag: 'sketch' }, { time: 8, value: 90, tag: 'sketch' }] }] } });
  const first = await values('values-1', revised.structuredContent.modelHash);
  assert.equal(first.structuredContent.values.breadth[0].candidate, 'events:within:event.world');
  assert.deepEqual([first.structuredContent.values.breadth[0].events, first.structuredContent.values.breadth[0].quantity.states], [2, '9%']);
  // The revision it revised already named the same candidate first, and revision 2 is not a third one: no line.
  assert.ok(!first.structuredContent.values.next.some((line) => line.startsWith('Breadth check')));
  const refused = await client.callTool({ name: 'life_breadth_record', arguments: { requestId: 'answer-0', previousModelHash: first.structuredContent.modelHash, holder: 'test', tag: 'inferred',
    candidate: 'events:within:event.world', answer: 'modeled', process: 'bakery.rate', concept: { label: 'The bank rate' }, reason: 'The rate moves the loan.' } });
  assert.ok(refused.isError);
  assert.match(JSON.stringify(refused.content), /process names bakery\.rate, which the model does not have/u);
  const linked = await client.callTool({ name: 'life_breadth_record', arguments: { requestId: 'answer-linked', previousModelHash: first.structuredContent.modelHash, holder: 'test', tag: 'inferred',
    candidate: 'events:within:event.world', answer: 'linked', concept: { label: 'Happenings around the bakery' }, reason: 'Both change the loan.' } });
  assert.ok(linked.isError);
  assert.match(JSON.stringify(linked.content), /2 Event\(s\) within .* still name none/u);
  // A reason longer than one field of the engine (1,024 bytes) is kept whole across bounded lines.
  const reason = `${'界'.repeat(400)} ${'x'.repeat(1_100)}`;
  const answered = await client.callTool({ name: 'life_breadth_record', arguments: { requestId: 'answer-1', previousModelHash: first.structuredContent.modelHash, holder: 'test', tag: 'inferred',
    candidate: 'events:within:event.world', answer: 'not_modeled', concept: { label: 'Happenings around the bakery' }, reason } });
  assert.ok(!answered.isError, JSON.stringify(answered.content).slice(0, 400));
  assert.deepEqual(answered.structuredContent.breadth, { candidate: 'events:within:event.world', answer: 'not_modeled', conceptId: 'breadth.events.within.event.world', signals: { events: 2, quantities: 1, share: 0 } });
  const model = await client.callTool({ name: 'life_model_inspect', arguments: { modelHash: answered.structuredContent.modelHash, includeDefinition: true } });
  const concept = model.structuredContent.model.meaning_model.concepts.find((item) => item.id === 'breadth.events.within.event.world');
  assert.deepEqual(concept.provenance.slice(0, 4), ['inferred: life_breadth_record by test', 'breadth-candidate:events:within:event.world', 'breadth-signals:events=2;quantities=1;share=0', 'breadth-answer:not_modeled']);
  const why = concept.provenance.slice(4);
  assert.ok(why.length >= 2 && why.every((line) => Buffer.byteLength(line, 'utf8') <= 1_000));
  assert.equal(why.map((line) => line.replace(/^why(, continued)?: /u, '')).join(''), reason);
  const second = await values('values-2', answered.structuredContent.modelHash);
  assert.equal(second.structuredContent.values.breadth, undefined);
  assert.deepEqual(second.structuredContent.values.considered.map((item) => [item.candidate, item.answer]), [['events:within:event.world', 'not_modeled']]);
});
