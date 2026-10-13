// Leaner context for agents, without losing what they need: precise reads (values, filtered records, a skeleton
// outline, guide sections) that answer what agents used to export and search, and write results that stop repeating
// unchanged parts. Every shortened view is checked against the full one it stands for.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LifeSimulationService } from '../src/service.mjs';
import { outlineModel } from '../src/construction-record.mjs';
import { queryValues, thin } from '../src/values-query.mjs';
import { guideHeadings, readModelingResource, readModelingResourcePage } from '../src/modeling-guidance.mjs';
import { FIXED_OPEN_QUESTION_PARTS, POINTERS_BEFORE_RESEND, REORIENTING_TOOLS, afterReorienting, forgetSentRepeats, isRepeatPointer, leanImportanceReport, leanRepeats, resetContext } from '../src/lean-results.mjs';
import { toolResult } from '../src/tool-result.mjs';
import { importanceReport } from '../src/importance-record.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const debtPoints = [[0, 900000, 'source'], [1, 880000, 'inferred'], [2, 860000, 'inferred'], [3, 870000, 'sketch'], [4, 1250000, 'inferred'],
  [5, 840000, 'source'], [6, 830000, 'inferred'], [7, 600000, 'sketch'], [8, 790000, 'inferred'], [9, 780000, 'source'], [10, 770000, 'inferred'], [11, 760000, 'inferred']]
  .map(([time, value, tag]) => ({ time, value, lower: value * 0.9, upper: value * 1.1, tag }));

async function setup(t) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(registerRequest.model);
  const debt = model.processes.find((process) => process.id === 'bakery.debt_nok');
  model.processes.push({ ...structuredClone(debt), id: 'bakery.private_margin', access_scopes: ['secret'], scale: { ...(debt.scale ?? {}), label: 'Private margin' } });
  model.value_series = [
    { id: 'series.debt', holder: 'modeler', process_id: 'bakery.debt_nok', points: debtPoints, provenance: ['test'] },
    { id: 'series.margin', holder: 'modeler', process_id: 'bakery.private_margin', points: debtPoints.slice(0, 3), provenance: ['test'] },
  ];
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel({ requestId: 'lean', model });
  const { model: stored } = await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true });
  return { service, modelHash: registered.modelHash, stored };
}

test('thinning keeps the first, last, lowest and highest values and spreads the rest evenly', () => {
  const series = Array.from({ length: 101 }, (_, i) => ({ time: i, value: i === 37 ? -5 : i === 64 ? 500 : i }));
  for (const max of [2, 3, 4, 5, 10, 50, 100]) {
    const kept = thin(series, max);
    assert.equal(kept.length, max, `max ${max}`);
    assert.deepEqual(kept.map((p) => p.time), [...kept.map((p) => p.time)].sort((a, b) => a - b), 'kept in time order');
    assert.equal(kept[0].time, 0); assert.equal(kept.at(-1).time, 100);
    if (max >= 4) { assert.ok(kept.some((p) => p.time === 37), 'the lowest'); assert.ok(kept.some((p) => p.time === 64), 'the highest'); }
  }
  const ten = thin(series, 10).map((p) => p.time);
  const gaps = ten.slice(1).map((t, i) => t - ten[i]);
  assert.ok(Math.max(...gaps) <= 25, `evenly spread: ${ten.join(', ')}`);
  assert.equal(thin(series.slice(0, 5), 10).length, 5, 'a short series is returned whole');
});

test('the values query returns exactly the values the model holds, in a range, thinned on request, and honors scopes', async (t) => {
  const { service, modelHash, stored } = await setup(t);
  const directory = await queryValues(service, { modelHash });
  assert.deepEqual(directory.processes.map((p) => p.processId), ['bakery.debt_nok'], 'a private process is not listed without its scope');
  assert.deepEqual(directory.processes[0].span, [0, 11]);
  assert.equal(directory.processes[0].values, 12);
  const scoped = await queryValues(service, { modelHash, accessScopes: ['secret'], text: 'private' });
  assert.deepEqual(scoped.processes.map((p) => p.processId), ['bakery.private_margin'], 'text filters the directory; the scope reveals it');

  const whole = await queryValues(service, { modelHash, processIds: ['bakery.debt_nok'] });
  const held = stored.value_series.find((series) => series.process_id === 'bakery.debt_nok').points;
  assert.deepEqual(whole.series[0].points, held, 'every point exactly as stored');
  const range = await queryValues(service, { modelHash, processIds: ['bakery.debt_nok'], from: 3, to: 7 });
  assert.deepEqual(range.series[0].points.map((p) => p.time), [3, 4, 5, 6, 7]);
  const thinned = await queryValues(service, { modelHash, processIds: ['bakery.debt_nok'], maxPoints: 4 });
  assert.equal(thinned.series[0].points.length, 4);
  assert.deepEqual(thinned.series[0].thinned, { shown: 4, of: 12, rule: 'evenly spaced, plus the first, last, lowest and highest' });
  assert.deepEqual(thinned.series[0].points.map((p) => p.time).sort((a, b) => a - b), [0, 4, 7, 11], 'first, highest, lowest, last');
  for (const p of thinned.series[0].points) assert.deepEqual(p, held.find((q) => q.time === p.time), 'thinned points are unaltered');
  const hidden = await queryValues(service, { modelHash, processIds: ['bakery.private_margin'] });
  assert.deepEqual(hidden.series, []);
  assert.deepEqual(hidden.notVisible, ['bakery.private_margin']);
  assert.equal(whole.otherProcesses, 0, 'nothing else visible to read');
  assert.equal(whole.next, undefined);
  assert.equal(hidden.otherProcesses, 1, 'says how many other measures there are');
  const twice = await queryValues(service, { modelHash, accessScopes: ['secret'], processIds: ['bakery.debt_nok', 'bakery.debt_nok'] });
  assert.equal(twice.series.length, 1, 'a process asked for twice is read once');
  assert.equal(twice.otherProcesses, 1);
  assert.match(twice.next, /directory/u);
});

test('named states and notes come back exactly as stored, and thinning keeps every change of state that fits', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(registerRequest.model);
  const phases = ['absent', 'emerging', 'growing', 'established', 'declining', 'gone'];
  model.processes.push({ id: 'bakery.phase', value_type: { kind: 'category', variants: phases }, initial_value: { kind: 'category', value: 'emerging' },
    uncertainty: { kind: 'unknown' }, provenance: ['test'], axes: [], unit: null, reference_frame: null,
    scale: { semantic_role: 'Bakery phase: one of 6 states', label: 'Bakery phase', states: 'phase' }, support: ['test'], access_scopes: [], update_mode: 'observed' });
  const stateAt = (time) => (time < 5 ? 'emerging' : time < 10 ? 'growing' : time < 15 ? 'established' : time < 18 ? 'declining' : 'gone');
  const statePoints = Array.from({ length: 20 }, (_, time) => ({ time, state: stateAt(time), tag: time % 2 ? 'inferred' : 'sketch', ...(time === 15 ? { note: 'the debts come due' } : {}) }));
  const debtWithNote = debtPoints.map((p) => (p.time === 4 ? { ...p, note: 'a one-off loan' } : p));
  model.value_series = [
    { id: 'series.phase', holder: 'modeler', process_id: 'bakery.phase', points: statePoints, provenance: ['test'] },
    { id: 'series.debt', holder: 'modeler', process_id: 'bakery.debt_nok', points: debtWithNote, provenance: ['test'] },
  ];
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel({ requestId: 'lean-states', model });
  const { model: stored } = await service.inspectModel({ modelHash, includeDefinition: true });
  const held = (id) => stored.value_series.find((series) => series.id === id).points;
  const read = await queryValues(service, { modelHash, processIds: ['bakery.phase', 'bakery.debt_nok'] });
  assert.deepEqual(read.series.find((series) => series.seriesId === 'series.phase').points, held('series.phase'), 'every state, tag and note as stored');
  assert.deepEqual(read.series.find((series) => series.seriesId === 'series.debt').points, held('series.debt'), 'a number\'s note too');
  assert.ok(read.series.find((series) => series.seriesId === 'series.phase').points.some((p) => p.state === 'declining' && p.note === 'the debts come due'));
  const six = (await queryValues(service, { modelHash, processIds: ['bakery.phase'], maxPoints: 6 })).series[0];
  assert.deepEqual(six.points.map((p) => p.time), [0, 5, 10, 15, 18, 19], 'the first and last and each of the four changes of state');
  assert.deepEqual(six.thinned, { shown: 6, of: 20, rule: 'the first and last, every change of state that fits, then evenly spaced', changesOfState: 4, changesOfStateShown: 4 });
  const four = (await queryValues(service, { modelHash, processIds: ['bakery.phase'], maxPoints: 4 })).series[0];
  assert.equal(four.points.length, 4);
  assert.deepEqual([four.points[0].time, four.points[3].time], [0, 19]);
  assert.equal(four.thinned.changesOfStateShown, 2, 'when not every change fits, the result says how many it shows');
  const nine = (await queryValues(service, { modelHash, processIds: ['bakery.phase'], maxPoints: 9 })).series[0];
  for (const time of [0, 5, 10, 15, 18, 19]) assert.ok(nine.points.some((p) => p.time === time), `change at ${time} kept when there is room`);
});

test('the time filter treats an interval as half-open, as the grammar does, and a moment as its instant', async (t) => {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(registerRequest.model);
  const layer = model.meaning_model;
  const shape = layer.events.find((event) => event.id === 'event.world');
  const relation = layer.event_relations.find((item) => item.kind === 'contains');
  for (const [id, start, end] of [['event.q.span', 6, 6.25], ['event.q.next', 6.25, 7], ['event.q.moment', 6.25, 6.25]]) {
    layer.events.push({ ...structuredClone(shape), id, boundary: id, interval: { start, end } });
    layer.event_relations.push({ ...structuredClone(relation), id: `event.world.contains.${id}`, source_event_id: 'event.world', target_event_id: id });
  }
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel({ requestId: 'lean-time', model });
  const ids = async (range) => (await service.queryMeaningModel({ modelHash, collections: ['events'], ...range })).items
    .map((item) => item.definition.id).filter((id) => id.startsWith('event.q.')).sort();
  assert.deepEqual(await ids({ from: 6.25 }), ['event.q.moment', 'event.q.next'], 'an Event over [6, 6.25) is over by 6.25');
  assert.deepEqual(await ids({ from: 6.25, to: 6.25 }), ['event.q.moment', 'event.q.next']);
  assert.deepEqual(await ids({ to: 6 }), ['event.q.span'], 'its start is included');
  assert.deepEqual(await ids({ from: 6, to: 6.2 }), ['event.q.span']);
  assert.deepEqual(await ids({ to: 6.25 }), ['event.q.moment', 'event.q.next', 'event.q.span'], 'what starts at the end of the range is in it');
});

test('record filters find by words and time, summaries name each record, and unfiltered queries are unchanged', async (t) => {
  const { service, modelHash, stored } = await setup(t);
  const before = await service.queryMeaningModel({ modelHash, collections: ['events'] });
  assert.equal(before.matchedCount, stored.meaning_model.events.length, 'no filter: every record, as before');
  assert.equal(before.query.fields, undefined, 'the query echo is unchanged without filters');
  const offer = stored.meaning_model.events.find((event) => event.id === 'event.offer');
  const word = offer.boundary.split(/\s+/u).find((w) => w.length > 4).toLowerCase().replace(/[^a-z]/gu, '');
  const found = await service.queryMeaningModel({ modelHash, collections: ['events'], text: word });
  assert.ok(found.items.some((item) => item.definition.id === 'event.offer'), `"${word}" finds the offer`);
  for (const item of found.items) assert.ok(JSON.stringify(item.definition).toLowerCase().includes(word), 'every match contains the word');
  const none = await service.queryMeaningModel({ modelHash, collections: ['events'], text: `${word} zzqqxx` });
  assert.equal(none.matchedCount, 0, 'every word must appear');
  const timed = stored.meaning_model.events.filter((event) => event.interval);
  const at = timed[0].interval.start;
  const inTime = await service.queryMeaningModel({ modelHash, collections: ['events'], from: at, to: at });
  const holds = (interval) => (interval.end > interval.start ? interval.start <= at && interval.end > at : interval.start === at);
  const expected = timed.filter((event) => holds(event.interval)).map((event) => event.id).sort();
  assert.deepEqual(inTime.items.map((item) => item.definition.id).sort(), expected, 'time keeps the records whose interval holds the moment');
  const summary = await service.queryMeaningModel({ modelHash, collections: ['events'], ids: ['event.offer'], fields: 'summary' });
  assert.deepEqual(Object.keys(summary.items[0]).filter((key) => !['collection', 'id', 'name', 'interval', 't', 'region', 'snippet'].includes(key)), []);
  assert.equal(summary.items[0].id, 'event.offer');
  assert.equal(summary.items[0].name, offer.boundary);
  assert.ok(JSON.stringify(summary.items[0]).length < JSON.stringify(found.items.find((item) => item.definition.id === 'event.offer')).length);
  await assert.rejects(service.queryMeaningModel({ modelHash, collections: ['events'], fields: 'brief' }), /fields must be full or summary/u);
});

test('the skeleton outline has the same records in the same order as the full outline, without their text', async (t) => {
  const { service, modelHash, stored } = await setup(t);
  const full = await outlineModel(service, { modelHash });
  const skeleton = await outlineModel(service, { modelHash, detail: 'skeleton' });
  const ids = (text) => [...text.matchAll(/^\s*- ([^\s:(]+)/gmu)].map((match) => match[1]);
  assert.deepEqual(ids(skeleton.text), ids(full.text), 'every record, in the same order');
  assert.ok(skeleton.text.length < full.text.length);
  for (const event of stored.meaning_model.events.filter((item) => item.description)) {
    assert.ok(!skeleton.text.includes(event.description.slice(0, 60)), `${event.id}: no description`);
  }
  const withCuts = stored.meaning_model.normalized_cuts.reduce((map, cut) => map.set(cut.parent_event_id, (map.get(cut.parent_event_id) ?? 0) + 1), new Map());
  for (const [eventId, count] of withCuts) assert.match(skeleton.text, new RegExp(`- ${eventId.replace(/\./gu, '\\.')} .*· ${count} Cuts?`, 'u'), `${eventId} counts its Cuts`);
  assert.equal(skeleton.detail, 'skeleton');
  assert.deepEqual(skeleton.noteModelBases, []);
});

test('a guide reads a section at a time, each exactly as it stands in the whole guide', async () => {
  const uri = 'life-sim://guide/process-breakdown';
  const whole = await readModelingResource(uri);
  const contents = await readModelingResourcePage({ uri, section: 'contents' });
  assert.ok(contents.contents.length >= 3);
  assert.equal(contents.text, undefined, 'the contents carry no guide text');
  assert.deepEqual(contents.contents.map((h) => h.title), guideHeadings(whole.text).map((h) => h.title));
  for (const heading of contents.contents.slice(0, 6)) {
    const page = await readModelingResourcePage({ uri, section: heading.title, maxCharacters: 64_000 });
    assert.equal(page.text, whole.text.slice(heading.offset, heading.offset + Math.min(heading.characters, 64_000)), heading.title);
    assert.equal(page.nextOffset, heading.characters > 64_000 ? 64_000 : null, `${heading.title}: the rest of a long section is paged`);
    assert.equal(page.section, heading.title);
  }
  const first = contents.contents[0];
  const paged = await readModelingResourcePage({ uri, section: first.title, maxCharacters: 100 });
  assert.equal(paged.text, whole.text.slice(first.offset, first.offset + 100));
  assert.equal(paged.nextOffset, first.characters > 100 ? 100 : null);
  await assert.rejects(readModelingResourcePage({ uri, section: 'no such heading at all' }), /read section "contents"/u);
  const plain = await readModelingResourcePage({ uri });
  assert.equal(plain.text, whole.text.slice(0, 24_000), 'without a section, pages are as before');
});

test('the grammar and the papers, written in LaTeX, read a section at a time too', async () => {
  for (const uri of ['life-sim://protocol/grammar', 'life-sim://theory/meaning-model', 'life-sim://theory/life-simulation']) {
    const whole = await readModelingResource(uri);
    const contents = await readModelingResourcePage({ uri, section: 'contents' });
    assert.ok(contents.contents.length >= 10, `${uri} lists its sections`);
    assert.ok(contents.contents.some((heading) => heading.level === 1), `${uri} has top-level sections`);
    for (const heading of contents.contents.slice(0, 4)) {
      assert.ok(!/[\\{}]/u.test(heading.title), `${heading.title}: a title is plain words`);
      const page = await readModelingResourcePage({ uri, section: heading.title, maxCharacters: 64_000 });
      assert.equal(page.text, whole.text.slice(heading.offset, heading.offset + Math.min(heading.characters, 64_000)), heading.title);
      assert.match(page.text, /^\s*\\(section|subsection|subsubsection|paragraph)/u, `${heading.title} starts at its heading`);
    }
  }
  const text = 'Text\n\\begin{verbatim}\n\\section{Not a heading}\n\\end{verbatim}\n% \\section{Commented}\n\\section*{The \\texttt{life\\_model} part}\nBody';
  const offset = text.indexOf('\\section*');
  assert.deepEqual(guideHeadings(text), [{ level: 1, title: 'The life_model part', offset, characters: text.length - offset }],
    'not in verbatim, not in a comment, and the title as plain words');
});

test('write results send fixed guidance once, then point to it; everything else is untouched', () => {
  forgetSentRepeats();
  const result = (alwaysAsk) => ({ modelHash: 'a'.repeat(64), change: { events: 2 }, warnings: ['keep me'], worldAdoption: { blockingChanges: ['b'] },
    openQuestions: { total: 9, counts: { x: 1 }, depth: { events: 3 }, questions: [{ kind: 'k', question: 'Why?' }], alwaysAsk, scope: { interpretation: 'fixed' }, guidance: 'fixed guidance', more: 'm' } });
  const first = leanRepeats(result(['Ask this.']));
  assert.deepEqual(first, result(['Ask this.']), 'the first copy goes in full');
  const second = leanRepeats(result(['Ask this.']));
  for (const part of FIXED_OPEN_QUESTION_PARTS) assert.ok(isRepeatPointer(second.openQuestions[part]), part);
  const { openQuestions: open, ...rest } = second;
  const { openQuestions: openFull, ...restFull } = result(['Ask this.']);
  assert.deepEqual(rest, restFull, 'hashes, changes, warnings and blocking changes are untouched');
  for (const key of Object.keys(openFull).filter((key) => !FIXED_OPEN_QUESTION_PARTS.includes(key))) assert.deepEqual(open[key], openFull[key], `openQuestions.${key} untouched`);
  const changed = leanRepeats(result(['Ask something new.']));
  assert.deepEqual(changed.openQuestions.alwaysAsk, ['Ask something new.'], 'changed guidance is sent in full');
  const previous = process.env.MEANING_MODEL_LEAN_RESULTS;
  process.env.MEANING_MODEL_LEAN_RESULTS = 'off';
  try { assert.deepEqual(leanRepeats(result(['Ask this.'])), result(['Ask this.']), 'off restores complete results'); }
  finally { if (previous === undefined) delete process.env.MEANING_MODEL_LEAN_RESULTS; else process.env.MEANING_MODEL_LEAN_RESULTS = previous; }
  assert.deepEqual(leanRepeats({ alwaysAsk: ['top level'] }), { alwaysAsk: ['top level'] }, 'a read of the questions is never shortened');
});

test('fixed guidance goes in full again after four pointers, and on the next write after a read that starts the work over', () => {
  forgetSentRepeats();
  const result = () => ({ openQuestions: { alwaysAsk: ['Ask this.'], questions: [] } });
  const sent = () => (isRepeatPointer(leanRepeats(result()).openQuestions.alwaysAsk) ? 'pointer' : 'full');
  assert.equal(POINTERS_BEFORE_RESEND, 4);
  assert.deepEqual(Array.from({ length: 11 }, sent), ['full', 'pointer', 'pointer', 'pointer', 'pointer', 'full', 'pointer', 'pointer', 'pointer', 'pointer', 'full'],
    'a context compacted after the first copy gets it back within five writes');
  afterReorienting('life_model_outline', { focusEventId: 'event.x' });
  assert.equal(sent(), 'pointer', 'reading one region is not a new start');
  afterReorienting('life_model_outline', { detail: 'skeleton' });
  assert.equal(sent(), 'full', 'after reading the whole outline the next write sends it in full');
  afterReorienting('life_model_revise', {});
  assert.equal(sent(), 'pointer', 'a write is not a new start');
  assert.deepEqual(Object.keys(REORIENTING_TOOLS).sort(), ['life_construction_import', 'life_construction_replay', 'life_model_outline', 'life_modeling_context', 'life_saved_work_list']);
  for (const name of Object.keys(REORIENTING_TOOLS)) {
    sent();
    afterReorienting(name, {});
    assert.equal(sent(), 'full', name);
  }
});

test('a pointer says how far back the full text was sent, and the agent\'s reset brings it back and counts it as sent', () => {
  forgetSentRepeats();
  const result = (alwaysAsk = ['Ask this.']) => ({ openQuestions: { alwaysAsk, scope: { interpretation: 'fixed' }, questions: [] } });
  leanRepeats(result(), 5_000);
  leanRepeats({ read: 'one' }, 10_000);
  leanRepeats({ read: 'two' }, 10_400);
  const pointed = leanRepeats(result(), 900).openQuestions;
  assert.match(pointed.alwaysAsk, /^Sent in full by this server 3 results and about 25k characters ago, and unchanged since\./u);
  assert.match(pointed.alwaysAsk, /If it is not in your context now.*call life_context_reset, which returns it/u);
  leanRepeats(result(['Ask something else.']), 700);
  const back = resetContext();
  assert.deepEqual(back.parts, { alwaysAsk: ['Ask something else.'], scope: { interpretation: 'fixed' } }, 'the most recent copy of each part');
  leanRepeats({ reset: true }, 800);
  const after = leanRepeats(result(['Ask something else.'])).openQuestions;
  assert.match(after.alwaysAsk, /^Sent in full by this server 1 result and about 1k characters ago/u, 'the reset counts as sending it');
  assert.deepEqual(leanRepeats(result()).openQuestions.alwaysAsk, ['Ask this.'], 'an older copy goes in full when next due');
  forgetSentRepeats();
  assert.deepEqual(resetContext(), { parts: {}, modelHashes: [] }, 'nothing sent, nothing to return');
});

test('the reset returns what the most recent result stood for, though that result only pointed to it', () => {
  forgetSentRepeats();
  const privateModel = 'p'.repeat(64), publicModel = 'q'.repeat(64);
  const result = (modelHash, scope, alwaysAsk) => ({ modelHash, openQuestions: { scope, alwaysAsk, questions: [] } });
  const privateScope = { interpretation: 'the private model', accessScopes: ['secret'] };
  const publicScope = { interpretation: 'the public model', accessScopes: [] };
  leanRepeats(result(privateModel, privateScope, ['Ask about the bakery\'s margin.']), 1_000);
  leanRepeats(result(publicModel, publicScope, ['Ask about the harbour.']), 1_000);
  const again = leanRepeats(result(privateModel, privateScope, ['Ask about the bakery\'s margin.']), 1_000);
  assert.ok(isRepeatPointer(again.openQuestions.scope) && isRepeatPointer(again.openQuestions.alwaysAsk), 'the private model\'s guidance is pointed to');
  const { parts, modelHashes } = resetContext();
  assert.deepEqual(parts.scope, privateScope, 'the scope of the model the agent last worked on, not the last one sent in full');
  assert.deepEqual(parts.alwaysAsk, ['Ask about the bakery\'s margin.'], 'and its focused questions');
  assert.deepEqual(modelHashes, [privateModel]);
});

test('guidance in a result that never reached the agent, or reached it without its text, is not counted as sent', () => {
  forgetSentRepeats();
  const open = { alwaysAsk: ['Ask this before every write.'], questions: [] };
  const write = (extra = {}) => toolResult({ modelHash: 'a'.repeat(64), ...extra, openQuestions: open });
  const refused = write({ blob: 'x'.repeat(Math.ceil(9.5 * 1024 * 1024)) });
  assert.equal(refused.isError, true, 'too large to deliver');
  assert.deepEqual(write().structuredContent.openQuestions.alwaysAsk, open.alwaysAsk, 'so the next result sends the guidance in full');
  forgetSentRepeats();
  const textless = write({ blob: 'x'.repeat(5 * 1024 * 1024) });
  assert.ok(!textless.isError && textless.content[0].text.startsWith('The complete result is in structuredContent'), 'delivered as a structured value only');
  assert.deepEqual(write().structuredContent.openQuestions.alwaysAsk, open.alwaysAsk, 'the agent may not have seen it, so it goes in full');
  assert.ok(isRepeatPointer(write().structuredContent.openQuestions.alwaysAsk), 'once delivered with its text, it is pointed to');
});


test('the importance report keeps the scales a call touched in full and the others as counts, with every hint', () => {
  const model = { meaning_model: {
    events: [{ id: 'e1', boundary: 'One' }, { id: 'e2', boundary: 'Two' }, { id: 'e3', boundary: 'Three' }],
    importance_scales: ['s.all', 's.other'].map((id) => ({ id, audience: `Audience of ${id}`, levels: [{ key: 'top', anchor: 'Top' }, { key: 'noted', anchor: 'Noted' }] })),
    event_importance: [{ event_id: 'e1', scale_id: 's.all', level: 'top', holder: 'h' }, { event_id: 'e2', scale_id: 's.other', level: 'noted', holder: 'h' }] } };
  const full = importanceReport(model);
  const lean = leanImportanceReport(full, ['s.all']);
  assert.deepEqual(lean.scales, full.scales.filter((scale) => scale.scale === 's.all'));
  assert.deepEqual(lean.otherScales, full.scales.filter((scale) => scale.scale !== 's.all').map(({ scale, judged, unjudgedCount }) => ({ scale, judged, ...(unjudgedCount ? { unjudgedCount } : {}) })));
  assert.deepEqual(lean.next, full.next, 'every hint stays');
  assert.deepEqual(leanImportanceReport(full, ['s.all', 's.other']), full, 'nothing to shorten when every scale was touched');
});

test('through the real server: the values query is offered and a second write points to guidance it already sent', async (t) => {
  const client = new Client({ name: 'lean-context-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE; delete env.MEANING_MODEL_LEAN_RESULTS;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(tools.includes('life_values_query'));
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const call = async (name, args) => { const result = await client.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result).slice(0, 400)); return result.structuredContent; };
  const first = await call('life_model_register', { requestId: 'one', model: registerRequest.model });
  const model = structuredClone(registerRequest.model); model.revision = { ...(model.revision ?? {}) };
  const second = await call('life_model_register', { requestId: 'two', model: { ...model, id: `${model.id}-two` } });
  assert.ok(Array.isArray(first.openQuestions?.alwaysAsk) && first.openQuestions.alwaysAsk.length, 'the first write sends the standing questions');
  assert.ok(isRepeatPointer(second.openQuestions.alwaysAsk), 'the second points to them');
  assert.match(second.openQuestions.alwaysAsk, /1 result and about \d+k characters ago/u, 'and says how far back they are');
  assert.ok(Array.isArray(second.openQuestions.questions), 'its own open questions are sent');
  const read = await call('life_model_questions', { modelHash: second.modelHash });
  assert.deepEqual(read.alwaysAsk, first.openQuestions.alwaysAsk, 'the pointed-to read returns them in full');
  const reset = await call('life_context_reset', {});
  assert.deepEqual(reset.fixedGuidance.alwaysAsk, first.openQuestions.alwaysAsk, 'the agent\'s reset returns them in full');
  assert.ok(reset.readAgain.some((line) => line.includes('skeleton')), 'and says what to read again');
  const third = await call('life_model_register', { requestId: 'three', model: { ...model, id: `${model.id}-three` } });
  assert.match(third.openQuestions.alwaysAsk, /^Sent in full by this server 1 result and/u, 'the reset counts as sending them');
  await call('life_model_outline', { modelHash: second.modelHash, sections: ['events'] });
  const fourth = await call('life_model_register', { requestId: 'four', model: { ...model, id: `${model.id}-four` } });
  assert.deepEqual(fourth.openQuestions.alwaysAsk, first.openQuestions.alwaysAsk, 'after a whole-outline read the next write sends them in full again');
});

test('a region of the outline is read with the bird\'s-eye view first: the top of the tree and the path down to it', async (t) => {
  const { service, modelHash, stored } = await setup(t);
  const contains = (stored.meaning_model.event_relations ?? []).filter((relation) => relation.kind === 'contains');
  const child = contains.find((relation) => contains.some((up) => up.target_event_id === relation.source_event_id))?.target_event_id
    ?? contains[0].target_event_id;
  const parent = contains.find((relation) => relation.target_event_id === child).source_event_id;
  const region = await outlineModel(service, { modelHash, focusEventId: child, sections: ['events'] });
  const [overview, rest] = region.text.split(`### ${child}`);
  assert.match(overview, /### Where this sits/u);
  assert.ok(overview.indexOf(`- ${parent}`) < overview.indexOf(`- ${child}`), 'the path down to the region, from the top');
  assert.match(overview, new RegExp(`- ${child.replace(/\./gu, '\\.')}.*\\(read below\\)`, 'u'));
  const roots = stored.meaning_model.events.map((event) => event.id).filter((eventId) => !contains.some((relation) => relation.target_event_id === eventId));
  for (const root of roots) assert.ok(overview.includes(`- ${root}`), `${root} is in the overview`);
  assert.ok(rest.includes(`- ${child}`), 'then the region itself, in full');
  const whole = await outlineModel(service, { modelHash, sections: ['events'] });
  assert.ok(!whole.text.includes('Where this sits'), 'reading the whole tree is unchanged');
  const unknown = await outlineModel(service, { modelHash, focusEventId: 'no.such.event', sections: ['events'] });
  assert.match(unknown.text, /no Event no\.such\.event in this model/u);
  for (const root of roots) assert.ok(unknown.text.includes(`- ${root}`), 'the overview still shows where to go');
});

// The minimal model with 30 more Events at the top and a region three levels down, with a sibling.
async function setupWide(t) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const model = structuredClone(registerRequest.model);
  const layer = model.meaning_model;
  const shape = layer.events.find((event) => event.id === 'event.world');
  const relation = layer.event_relations.find((item) => item.kind === 'contains');
  const add = (id, boundary, parent) => {
    layer.events.push({ ...structuredClone(shape), id, boundary });
    layer.event_relations.push({ ...structuredClone(relation), id: `${parent}.contains.${id}`, source_event_id: parent, target_event_id: id });
  };
  for (let i = 0; i < 30; i += 1) add(`event.extra.${i}`, `Extra event ${i}`, 'event.world');
  add('event.bakery.day', 'One day at the bakery.', 'event.bakery.life');
  add('event.bakery.morning', 'The morning bake.', 'event.bakery.day');
  add('event.bakery.evening', 'The evening count.', 'event.bakery.day');
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const { modelHash } = await service.registerModel({ requestId: 'lean-wide', model });
  return { service, modelHash };
}

test('the bird\'s-eye view stays compact on a wide tree, shows what is beside a region, and is not repeated from the top', async (t) => {
  const { service, modelHash } = await setupWide(t);

  const region = await outlineModel(service, { modelHash, focusEventId: 'event.bakery.morning', sections: ['events'] });
  const [overview, rest] = region.text.split('### event.bakery.morning');
  let at = -1;
  for (const eventId of ['event.world', 'event.bakery.life', 'event.bakery.day']) {
    const next = overview.indexOf(`- ${eventId}`, at + 1);
    assert.ok(next > at, `${eventId} on the path, in order from the top`);
    at = next;
  }
  assert.match(overview, /One day at the bakery\./u, 'the path names each Event on it');
  assert.match(overview, /Beside it under event\.bakery\.day:\n {2}- event\.bakery\.evening/u);
  for (let i = 0; i < 30; i += 1) assert.ok(overview.includes(`event.extra.${i}`), `event.extra.${i} is still on the top of the tree`);
  assert.ok(!overview.includes('Extra event 7'), 'a long list gives ids and times, and the skeleton names them');
  assert.ok(rest.includes('The morning bake.'), 'then the region in full');

  const top = await outlineModel(service, { modelHash, focusEventId: 'event.world', sections: ['events'] });
  const [fromTop, tree] = top.text.split('### event.world');
  assert.match(fromTop, /- event\.world.*\(read below\)/u);
  assert.ok(!fromTop.includes('event.extra.'), 'what the region shows is not listed twice');
  assert.ok(tree.includes('event.extra.29'));
});

test('a cut outline names the sections it left out, and its default fits what clients show inline', async (t) => {
  const { outlineSchema } = await import('../src/construction-record.mjs');
  assert.equal(outlineSchema.parse({ modelHash: 'a'.repeat(64) }).maxChars, 45_000);
  const { service, modelHash } = await setupWide(t);
  const whole = await outlineModel(service, { modelHash, maxChars: 400_000 });
  assert.equal(whole.truncated, false);
  const keys = { Descriptions: 'coverage', Things: 'things', Events: 'events', Processes: 'processes', Concepts: 'concepts', Understanding: 'understanding', Documents: 'documents' };
  const headings = [...whole.text.matchAll(/^## (\S+)/gmu)].map((match) => ({ section: keys[match[1]], at: match.index }));
  const events = headings.find((heading) => heading.section === 'events');
  const cutAt = events.at + 200;
  assert.ok(whole.text.length > cutAt + 100, 'the fixture is long enough to cut inside events');
  const cut = await outlineModel(service, { modelHash, maxChars: Math.max(2_000, cutAt) });
  const expectedMissing = headings.filter((heading) => heading.at >= Math.max(2_000, cutAt)).map((heading) => heading.section);
  assert.equal(cut.truncated, true);
  assert.deepEqual(cut.notShown, expectedMissing);
  assert.equal(cut.truncatedIn, headings.filter((heading) => heading.at < Math.max(2_000, cutAt)).at(-1).section);
  assert.ok(expectedMissing.length >= 1, `sections after events exist to be cut: ${JSON.stringify(headings.map((heading) => heading.section))}`);
  assert.ok(cut.text.includes(`not shown: ${expectedMissing.join(', ')}. Read those with sections ${JSON.stringify(expectedMissing)}`));
  assert.ok(cut.text.startsWith(whole.text.slice(0, Math.max(2_000, cutAt))), 'what is shown is the outline as it stands');
  const untouched = await outlineModel(service, { modelHash });
  assert.equal(untouched.truncated, false);
  assert.equal(untouched.notShown, undefined, 'an outline that fits carries no cut fields');
});
