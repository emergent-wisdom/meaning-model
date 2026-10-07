import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { importConstructionHistory } from '../src/construction-record.mjs';
import { decodeHistoryModels, encodeHistoryModels, expandedHistoryDigest, expandHistoryModels, historyDigest, HISTORY_FILE_SCHEMA_V2,
  HISTORY_SCHEMA, planHistoryModels } from '../src/construction-files.mjs';
import { MODEL_DELTA_SCHEMA } from '../src/model-delta.mjs';

const hash = (n) => n.toString(16).padStart(64, '0');
const big = () => ({ schema: 'life-sim-rust-model/v1', id: 'story', time_unit: 'year',
  revision: { number: 0, reason: 'root', provenance: [] }, processes: [{ id: 'p', value_type: 'number' }],
  meaning_model: { events: Array.from({ length: 2000 }, (_, i) => ({ id: `ev.${String(i).padStart(5, '0')}`, boundary: 'a moment of the story '.repeat(4) })) } });
const added = (n) => ({ schema: MODEL_DELTA_SCHEMA, changes: [{ op: 'records', path: ['meaning_model', 'events'], upsert: [{ id: `ev.new.${n}`, boundary: 'added' }], sorted: true }] });
// No service is reached: every case here is refused before anything is stored.
const unreachable = new Proxy({}, { get: () => { throw new Error('nothing may be stored before the file is checked'); } });

async function file(t, history) {
  const directory = await mkdtemp(join(tmpdir(), 'meaning-model-history-bounds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'history.json');
  await writeFile(path, JSON.stringify(history));
  return path;
}

test('a history file is checked before any model in it is expanded', async (t) => {
  // Small as written, large once expanded: 300 changes, each against one large model, the last one invalid.
  const models = [{ modelHash: hash(1), definition: big() },
    ...Array.from({ length: 300 }, (_, i) => ({ modelHash: hash(i + 2), baseModelHash: hash(1), delta: added(i) }))];
  models.at(-1).delta = { schema: MODEL_DELTA_SCHEMA, changes: [{ op: 'records', path: ['meaning_model', 'events'], remove: ['missing'], sorted: true }] };
  const path = await file(t, { schema: HISTORY_FILE_SCHEMA_V2, graphId: 'g', headGraphHash: hash(9), revisionCount: 0, models, revisions: [] });
  await assert.rejects(importConstructionHistory(unreachable, { requestId: 'bounds.checksum', sourcePath: path }), /bundleSha256 checksum/);
});

test('a history file whose checksum is wrong is refused before anything is stored', async (t) => {
  const models = [{ modelHash: hash(1), definition: big() },
    ...Array.from({ length: 40 }, (_, i) => ({ modelHash: hash(i + 2), baseModelHash: hash(1), delta: added(i) }))];
  const path = await file(t, { schema: HISTORY_FILE_SCHEMA_V2, graphId: 'g', headGraphHash: hash(9), revisionCount: 0, models, revisions: [], bundleSha256: hash(7) });
  await assert.rejects(importConstructionHistory(unreachable, { requestId: 'bounds.wrong', sourcePath: path }), /does not match its bundleSha256/);
});

test('a file that would need too many expanded models kept at once is refused while it is read', () => {
  // Entries 1 to 6 are each written as changes from the root, and entries 7 to 12 as changes from them in reverse
  // order, so every one of them would be kept until the end.
  const models = [{ modelHash: hash(1), definition: big() }];
  for (let i = 0; i < 6; i += 1) models.push({ modelHash: hash(i + 2), baseModelHash: hash(1), delta: added(i) });
  for (let i = 0; i < 6; i += 1) models.push({ modelHash: hash(i + 8), baseModelHash: hash(7 - i), delta: added(6 + i) });
  const history = { schema: HISTORY_FILE_SCHEMA_V2, models };
  const size = Buffer.byteLength(JSON.stringify(big())), held = [];
  assert.throws(() => [...expandHistoryModels(history, planHistoryModels(history), { maximumKeptBytes: 3.5 * size, onRetained: (count) => held.push(count) })],
    /a reader keeps at most/);
  assert.deepEqual(held, [1, 2, 3], 'refused as soon as a fourth model would be kept');
  assert.equal([...expandHistoryModels(history)].length, 13, 'the same file reads within the default limit');
});

test('a file written here never needs more kept than a reader keeps, so a revision is written whole when it must be', () => {
  // A root revised four times, then each of those revised again in reverse order.
  const definitions = [{ ...big(), revision: { number: 0, reason: 'root', provenance: [] } }];
  for (const base of [0, 0, 0, 0, 4, 3, 2, 1]) {
    const definition = structuredClone(definitions[base]);
    definition.revision = { number: definitions.length, previous_model_hash: hash(base + 1), reason: 'revised', provenance: [] };
    definition.meaning_model.events.push({ id: `ev.new.${definitions.length}`, boundary: 'added' });
    definitions.push(definition);
  }
  const models = definitions.map((definition, i) => ({ modelHash: hash(i + 1), definition }));
  const limit = 3.5 * Buffer.byteLength(JSON.stringify(definitions[0]));
  const written = encodeHistoryModels(models, limit);
  assert.deepEqual(written.map((entry) => (entry.delta ? 'changes' : 'whole')), ['whole', 'changes', 'changes', 'changes', 'changes', 'changes', 'whole', 'changes', 'changes']);
  const history = { schema: HISTORY_FILE_SCHEMA_V2, models: written };
  assert.deepEqual([...expandHistoryModels(history, planHistoryModels(history), { maximumKeptBytes: limit })], models);
  assert.ok(encodeHistoryModels(models).slice(1).every((entry) => entry.delta), 'within the usual limit every revision is written as its changes');
});

test('randomized lineages written within any limit always read back within it, exactly', () => {
  let seed = 0x2545f491;
  const next = (n) => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % Math.max(1, n); };
  let changes = 0, wholeRevisions = 0;
  for (let round = 0; round < 60; round += 1) {
    // Each model is a new root or a revision of a random earlier one, which adds one Event, so its changes are always
    // smaller than the whole: a revision written whole is one whose previous model a reader could not keep.
    const definitions = [];
    for (let i = 0, count = 2 + next(24); i < count; i += 1) {
      const parent = i && next(6) ? next(i) : null;
      const definition = parent === null
        ? { schema: 'life-sim-rust-model/v1', id: `m${i}`, revision: { number: 0, reason: 'root', provenance: [] },
          meaning_model: { events: Array.from({ length: 20 + next(200) }, (_, e) => ({ id: `ev.${String(e).padStart(4, '0')}`, boundary: 'x'.repeat(next(40)) })) } }
        : structuredClone(definitions[parent]);
      if (parent !== null) {
        definition.revision = { number: i, previous_model_hash: hash(parent + 1), reason: `revision ${i}`, provenance: [] };
        definition.meaning_model.events.push({ id: `ev.new.${i}`, boundary: 'y'.repeat(next(400)) });
      }
      definitions.push(definition);
    }
    const models = definitions.map((definition, i) => ({ modelHash: hash(i + 1), definition }));
    const largest = Math.max(...definitions.map((definition) => Buffer.byteLength(JSON.stringify(definition))));
    const limit = Math.floor((largest * next(9)) / 2) + next(1000);
    const written = encodeHistoryModels(models, limit);
    const history = { schema: HISTORY_FILE_SCHEMA_V2, models: written };
    assert.deepEqual([...expandHistoryModels(history, planHistoryModels(history), { maximumKeptBytes: limit })], models, `round ${round}`);
    written.forEach((entry, i) => { if (entry.delta) changes += 1; else if (definitions[i].revision.previous_model_hash) wholeRevisions += 1; });
  }
  assert.ok(changes > 100 && wholeRevisions > 20, `both kinds are exercised: ${changes} as changes, ${wholeRevisions} revisions whole`);
});

test('a history holding more models than a session can is refused before expanding them', async (t) => {
  const models = Array.from({ length: 513 }, (_, i) => ({ modelHash: hash(i + 1), definition: { ...big(), id: `m${i}` } }));
  const path = await file(t, { schema: HISTORY_SCHEMA, graphId: 'g', headGraphHash: hash(9), revisionCount: 0, models: models.map((entry) => ({ ...entry, definition: { id: entry.definition.id } })), revisions: [], bundleSha256: hash(7) });
  await assert.rejects(importConstructionHistory(unreachable, { requestId: 'bounds.count', sourcePath: path }), /at most 512 models/);
});

test('a history whose structure is wrong is refused before expanding it', () => {
  const root = { modelHash: hash(1), definition: big() };
  const change = { modelHash: hash(2), baseModelHash: hash(1), delta: added(1) };
  const plan = (models, schema = HISTORY_FILE_SCHEMA_V2) => () => planHistoryModels({ schema, models });
  assert.throws(plan([change, root]), /does not hold before it/);
  assert.throws(plan([root, change], HISTORY_SCHEMA), /cannot hold/);
  assert.throws(plan([root, { ...change, definition: big() }]), /exactly one/);
  assert.throws(plan([root, { ...root }]), /repeats/);
  assert.throws(plan([{ ...root, modelHash: 'x' }]), /modelHash/);
  assert.throws(plan([root, { ...change, delta: { schema: 'other', changes: [] } }]), /model delta/);
  assert.throws(() => planHistoryModels({ schema: 'meaning-model-construction-history/v9', models: [] }), /schema/);
});

test('expanding keeps a model only until the last change kept against it', () => {
  const chain = [{ modelHash: hash(1), definition: big() }];
  for (let i = 2; i <= 12; i += 1) chain.push({ modelHash: hash(i), baseModelHash: hash(i - 1), delta: added(i) });
  const history = { schema: HISTORY_FILE_SCHEMA_V2, models: chain };
  const held = [];
  const expanded = [...expandHistoryModels(history, planHistoryModels(history), { onRetained: (count) => held.push(count) })];
  assert.equal(expanded.length, 12);
  assert.ok(Math.max(...held) <= 1, `a chain holds at most one earlier model at a time, not ${Math.max(...held)}`);
  assert.equal(expanded.at(-1).definition.meaning_model.events.length, 2011);
  const star = [{ modelHash: hash(1), definition: big() }, ...[2, 3, 4].map((i) => ({ modelHash: hash(i), baseModelHash: hash(1), delta: added(i) }))];
  const starHeld = [];
  [...expandHistoryModels({ schema: HISTORY_FILE_SCHEMA_V2, models: star }, planHistoryModels({ schema: HISTORY_FILE_SCHEMA_V2, models: star }), { onRetained: (count) => starHeld.push(count) })];
  assert.deepEqual(starHeld, [1, 1, 1, 0], 'a shared base is kept until its last change, then released');
});

test('the checksum computed while expanding equals the checksum of the expanded history', () => {
  const first = { ...big(), revision: { number: 0, reason: 'root', provenance: [] } };
  const models = [{ modelHash: hash(1), definition: first }, { modelHash: hash(2), baseModelHash: hash(1), delta: added(1) }];
  const history = { schema: HISTORY_FILE_SCHEMA_V2, graphId: 'g', headGraphHash: hash(9), revisionCount: 1, models, revisions: [{ graphHash: hash(9), definition: { id: 'g', '10': 'x', '2': 'y', nodes: [] } }] };
  const expanded = decodeHistoryModels(history);
  assert.equal(expandedHistoryDigest(history, planHistoryModels(history)), historyDigest(expanded).sha256);
  const v1 = { ...expanded };
  assert.equal(expandedHistoryDigest(v1, planHistoryModels(v1)), historyDigest(v1).sha256);
});
