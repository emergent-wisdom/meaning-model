import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceCuts, runImport, engine, directory, civilDay, defaultEngine } from './import-rust.mjs';

const binary = defaultEngine;

test('all source compositions, including the concept remainder, are imported without changing weights', () => {
  const cuts = sourceCuts();
  assert.equal(cuts.length, 107);
  assert.equal(cuts.reduce((n, c) => n + c.answers.length, 0), 472);
  assert.deepEqual(cuts.find(c => c.family === 'concept').answers.at(-1), { key: 'remainder', weight: 0 });
  const joy = cuts.filter(c => c.family === 'feels' && /May 1851/.test(c.label)).map(c => c.answers.find(a => a.key === 'joy').weight);
  assert.deepEqual(joy, [.34, .30, .33]);
});

test('fresh Rust import persists the current model, contexts, full Event descriptions, and exact manuscript', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'book-native-import-'));
  const out = path.join(scratch, 'artifact');
  const receipt = runImport(out, binary);
  assert.equal(receipt.model_roundtrip_equal, true);
  assert.equal(receipt.inventory.is_processes, 117);
  const model = JSON.parse(fs.readFileSync(path.join(out, 'model.json')));
  const mm = model.meaning_model;
  assert.equal(mm.normalized_cuts.length, 108); // 107 authored + one derived duration Cut.
  assert.equal(mm.normalized_cuts.reduce((n, c) => n + c.answers.length, 0), 479);
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
