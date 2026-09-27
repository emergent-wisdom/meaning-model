import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceCuts, sourceCoarseInterval, sourceProcessDevelopments, processDevelopmentAdditions, runImport, engine, directory, civilDay, defaultEngine } from './import-rust.mjs';

const binary = defaultEngine;

test('all source compositions, including the concept remainder, are imported without changing weights', () => {
  const cuts = sourceCuts();
  assert.equal(cuts.length, 107);
  assert.equal(cuts.reduce((n, c) => n + c.answers.length, 0), 472);
  assert.deepEqual(cuts.find(c => c.family === 'concept').answers.at(-1), { key: 'remainder', weight: 0 });
  const joy = cuts.filter(c => c.family === 'feels' && /May 1851/.test(c.label)).map(c => c.answers.find(a => a.key === 'joy').weight);
  assert.deepEqual(joy, [.34, .30, .33]);
});

test('all authored coarse periods retain bounded source precision, including uncertain overlaps', () => {
  const lives = { Babbage: ['1791-12-26', '1871-10-19'], Lovelace: ['1815-12-10', '1852-11-28'], Halden: ['1803-01-01', '1875-01-01'] };
  const rows = [
    ['Babbage, 1833--Aug 1843', '1833-01-01', '1843-09-01'],
    ['Babbage, Aug 1843--May 1851', '1843-08-01', '1851-06-01'],
    ['Babbage, May 1851--May 1854', '1851-05-01', '1854-06-01'],
    ['Babbage, May 1854--Oct 1871', '1854-05-01', '1871-10-19'],
    ['Lovelace, 1842--Aug 1843', '1842-01-01', '1843-09-01'],
    ['Lovelace, Aug 1843--May 1851', '1843-08-01', '1851-06-01'],
    ['Lovelace, May 1851--Nov 1852', '1851-05-01', '1852-11-28'],
    ['Halden, 1803--Sep 1843', '1803-01-01', '1843-10-01'],
    ['Halden, Sep 1843--May 1851', '1843-09-01', '1851-06-01'],
    ['Halden, May 1851--May 1854', '1851-05-01', '1854-06-01'],
    ['Halden, May 1854--1874', '1854-05-01', '1875-01-01'],
    ['Babbage, childhood through 1810', '1791-12-26', '1811-01-01'],
    ['Babbage, 1810--1855', '1810-01-01', '1856-01-01'],
    ['Babbage, 1855--1870', '1855-01-01', '1871-01-01'],
    ['Babbage, terminal transition in 1871', '1871-01-01', '1871-10-19'],
    ['Lovelace, childhood through 1828', '1815-12-10', '1829-01-01'],
    ['Lovelace, illness and recovery, 1829--1835', '1829-01-01', '1836-01-01'],
    ['Lovelace, 1835--1843', '1835-01-01', '1844-01-01'],
    ['Lovelace, 1843--1850', '1843-01-01', '1851-01-01'],
    ['Lovelace, progressive illness, 1851--1852', '1851-01-01', '1852-11-28'],
    ['Halden, childhood through 1817', '1803-01-01', '1818-01-01'],
    ['Halden, working adulthood, 1817--1855', '1817-01-01', '1856-01-01'],
    ['Halden, later life, 1855--1873', '1855-01-01', '1874-01-01'],
    ['Halden, terminal transition in 1874', '1874-01-01', '1875-01-01'],
  ];
  const labels = sourceCuts().filter(c => ['slow-outlook', 'health'].includes(c.family)).map(c => c.label);
  assert.deepEqual(labels.sort(), rows.map(r => r[0]).sort());
  const lifeOf = label => { const [start, end] = lives[label.split(',')[0]]; return { start: civilDay(start), end: civilDay(end) }; };
  for (const [label, start, end] of rows) assert.deepEqual(sourceCoarseInterval(label, lifeOf(label)),
    { start: civilDay(start), end: civilDay(end) }, label);
  const earlier = sourceCoarseInterval(rows[0][0], lifeOf(rows[0][0]));
  const later = sourceCoarseInterval(rows[1][0], lifeOf(rows[1][0]));
  assert(earlier.end > later.start, 'An uncertain transition month is not made into an exact disjoint boundary');
  for (const label of ['Babbage, around 1843', 'Babbage, Autumn 1843--May 1851', 'Babbage, 1855--1810', 'Babbage, 1900--1901']) {
    assert.throws(() => sourceCoarseInterval(label, lifeOf(label)), /Unrecognized|outside|reversed/);
  }
  assert.throws(() => sourceCoarseInterval(rows[0][0], null), /lifecycle/);
});

test('explicit process developments preserve all 46 statements and reject silent partial parsing', () => {
  const source = fs.readFileSync(path.join(directory, 'PERSON-MODELS.md'), 'utf8');
  const developments = sourceProcessDevelopments(source);
  assert.equal(developments.length, 46);
  const counts = key => Object.fromEntries([...new Set(developments.map(item => item[key]))].map(value => [value, developments.filter(item => item[key] === value).length]));
  assert.deepEqual(counts('name'), { Babbage: 17, Lovelace: 12, Halden: 17 });
  assert.deepEqual(counts('processKey'), { work: 10, means: 5, partnership: 8, standing: 6, meaning: 8, knowledge: 6, body: 2, kin: 1 });
  for (const item of developments) assert(source.includes(`**${item.processKey[0].toUpperCase()}${item.processKey.slice(1)}:** ${item.description}`));
  assert.equal(developments.find(item => item.name === 'Halden' && item.range === 'May 1851--May 1854' && item.processKey === 'work').description,
    'he begins treating signed deposits as a route to future capacity.');
  assert.throws(() => sourceProcessDevelopments(source.replace('**Work:** material progress', '**Unspecified:** material progress')), /Unknown/);
  assert.throws(() => sourceProcessDevelopments(source.replace('**Work:** material progress', 'Unlabelled material progress')), /Unparsed/);
});

test('fresh Rust import persists the current model, contexts, full Event descriptions, and exact manuscript', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'book-native-import-'));
  const out = path.join(scratch, 'artifact');
  const receipt = runImport(out, binary);
  assert.equal(receipt.model_roundtrip_equal, true);
  assert.equal(receipt.inventory.is_processes, 117);
  assert.equal(receipt.inventory.qualitative_process_developments, 46);
  const model = JSON.parse(fs.readFileSync(path.join(out, 'model.json')));
  const mm = model.meaning_model;
  assert.equal(mm.normalized_cuts.length, 108); // 107 authored + one derived duration Cut.
  assert.equal(mm.normalized_cuts.reduce((n, c) => n + c.answers.length, 0), 479);
  const developments = mm.events.filter(event => event.id.startsWith('event.development.07r2.'));
  assert.equal(developments.length, 46);
  assert.equal(mm.events.length, 360, '314 existing Events plus the 46 source-authored developments');
  const sourceText = fs.readFileSync(path.join(directory, 'PERSON-MODELS.md'), 'utf8');
  for (const development of developments) {
    assert(sourceProcessDevelopments(sourceText).some(source => source.description === development.description));
    assert.equal(development.process_ids.length, 1);
    const process = model.processes.find(process => process.id === development.process_ids[0]);
    assert.equal(development.participants.subject, process.scale.subject_referent_id);
    const life = mm.events.find(event => event.id === mm.referents.find(referent => referent.id === development.participants.subject).lifecycle_event_id);
    assert(development.interval.start >= life.interval.start && development.interval.end <= life.interval.end);
    const parents = mm.event_relations.filter(relation => relation.kind === 'contains' && relation.target_event_id === development.id);
    assert.equal(parents.length, 1);
    assert(mm.events.find(event => event.id === parents[0].source_event_id).process_ids.includes(process.id));
    assert(development.provenance.includes('Descriptions of beliefs, aims and judgments remain attributed to the person; their embedded contents are not adopted as objective claims.'));
    assert(development.provenance.some(text => text.includes('adjacent envelopes may overlap')));
    assert(development.provenance.some(text => text.startsWith('Source history status:')));
    assert(development.boundary.length <= 200);
  }
  const beforePatch = structuredClone(model);
  beforePatch.meaning_model.events = beforePatch.meaning_model.events.filter(event => !event.id.startsWith('event.development.07r2.'));
  beforePatch.meaning_model.event_relations = beforePatch.meaning_model.event_relations.filter(relation => !relation.id.startsWith('relation.development.07r2.'));
  const unchanged = structuredClone(beforePatch);
  const patch = processDevelopmentAdditions(beforePatch, receipt.sourceDigest, sourceText);
  assert.deepEqual(Object.keys(patch).sort(), ['event_relations', 'events']);
  assert.equal(patch.events.length, 46); assert.equal(patch.event_relations.length, 46);
  assert.deepEqual(beforePatch, unchanged, 'The revision helper must not mutate the existing model, dates, Cuts or processes');
  const canonicalFields = expected => Object.fromEntries(Object.keys(patch.events[0]).map(key => [key, expected[key]]));
  for (const event of patch.events) assert.deepEqual(event, canonicalFields(developments.find(item => item.id === event.id)),
    `Fresh import and additive repair have identical authored record: ${event.id}`);
  assert.deepEqual(processDevelopmentAdditions(model, receipt.sourceDigest, sourceText), { events: [], event_relations: [] }, 'Repair is idempotent');
  const conflict = structuredClone(model); conflict.meaning_model.events.find(event => event.id === developments[0].id).description = 'Changed assertion';
  assert.throws(() => processDevelopmentAdditions(conflict, receipt.sourceDigest, sourceText), /conflicts with the source/);
  const byKey = answers => [...answers].sort((a, b) => a.key.localeCompare(b.key));
  for (const source of sourceCuts()) {
    const cut = mm.normalized_cuts.find(c => c.provenance.includes(`source-row:${source.family}:${source.label}`));
    assert.deepEqual(byKey(cut.answers), byKey(source.answers), `${source.family}: ${source.label}`);
    if (['slow-outlook', 'health'].includes(source.family)) assert.equal(
      mm.events.find(e => e.id === cut.parent_event_id).boundary, `${source.label}. ${source.question}`.slice(0, 200));
  }
  const coarseParents = new Set(mm.normalized_cuts.filter(c => /\.(?:slow-outlook|threat|health)\./.test(c.id)).map(c => c.parent_event_id));
  assert.equal(coarseParents.size, 24);
  for (const id of coarseParents) {
    const parent = mm.events.find(e => e.id === id);
    assert(parent.interval.start < parent.interval.end, id);
    assert(parent.description.includes('adjacent envelopes may overlap'), id);
    assert(parent.description.includes('not assert an exact transition, disjoint partition, or constant state'), id);
    assert(parent.provenance.some(p => p.startsWith('source-period-label:')), id);
    assert(!parent.boundary.includes('Coarse authored parent') && !parent.boundary.includes('Source period'), id);
    assert(parent.boundary.length <= 200, id);
  }
  const trial = mm.events.find(e => e.id === 'event.book.07r2.E14');
  assert(trial.description.includes('withholds the independent answer'));
  assert(trial.description.length > trial.boundary.length);
  const finalSource = mm.events.find(e => e.id === 'event.book.07r2.E22');
  assert.equal(finalSource.interval.end, civilDay('1854-05-01'));
  const duration = mm.normalized_cuts.find(c => c.id.endsWith('history-duration'));
  assert(Math.abs(duration.answers.reduce((n, a) => n + a.weight, 0) - 1) < 1e-9);
  const roots = new Map(mm.context_roots.map(r => [r.event_id, r.kind]));
  const parents = new Map();
  for (const edge of mm.event_relations.filter(r => r.kind === 'contains')) {
    parents.set(edge.target_event_id, [...(parents.get(edge.target_event_id) ?? []), edge.source_event_id]);
  }
  const nearest = id => roots.has(id) ? [id] : (parents.get(id) ?? []).flatMap(nearest);
  for (const [fragment, person] of [['halden-s-delivery', 'edward-halden'], ['halden-after-the-returned', 'edward-halden'], ['babbage-s-custody', 'charles-babbage']]) {
    const cut = mm.normalized_cuts.find(c => c.id.includes(fragment));
    assert(cut, fragment);
    assert.deepEqual([...new Set(nearest(cut.parent_event_id))], [`event.inner.07r2.${person}`]);
  }
  assert(mm.normalized_cuts.filter(c => c.id.includes('.slow-outlook.')).every(c =>
    mm.events.find(e => e.id === c.parent_event_id).description.includes('Coarse authored parent')));
  const state = path.join(out, 'construction.sqlite');
  const narrative = JSON.parse(fs.readFileSync(path.join(out, 'narrative-registration.json')));
  const graphHash = narrative.result.summary.graph_hash;
  const rendered = engine(binary, 'render_narrative_graph', { narrative_graph_hash: graphHash,
    narrative_render: { root_ids: ['document.book.07r2'], access_scopes: [], expected_graph_hash: graphHash } }, state);
  assert.equal(rendered.result.text.trim(), fs.readFileSync(path.join(directory, 'BOOK-DRAFT.md'), 'utf8').trim());
  assert.throws(() => runImport(out, binary), /never overwritten/);
  const changed = structuredClone(model);
  changed.meaning_model.normalized_cuts[0].answers[0].weight += .05;
  assert.throws(() => engine(binary, 'validate_model', { model: changed }), /sum/);
  // Native context resolution must reject cross-person conditioning, not merely normalize it.
  const crossing = structuredClone(model);
  const threat = crossing.meaning_model.normalized_cuts.find(c => c.id.includes('.threat.babbage'));
  const alien = crossing.meaning_model.normalized_cuts.find(c => c.id.includes('.slow-outlook.lovelace'));
  threat.conditioning = { cut_id: alien.id, answer_key: 'threatened_fulfillment' };
  assert.throws(() => engine(binary, 'validate_model', { model: crossing }), /context|root/);
});
