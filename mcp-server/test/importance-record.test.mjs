import test from 'node:test';
import assert from 'node:assert/strict';
import { importanceChange, importanceReport, IMPORTANCE_PRESETS } from '../src/importance-record.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { LifeSimulationService } from '../src/service.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { viewSettingsProblems } from '../viewer/public/view-settings.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HASH = 'a'.repeat(64);
const event = (id, start, end = start + 1) => ({ id, boundary: id.replaceAll('.', ' '), interval: { start, end }, process_ids: [], observation_process_ids: [],
  participants: {}, substrate: null, region: null, provenance: ['sketch: fixture'] });
const base = () => ({
  schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'year', revision: { number: 0, previous_model_hash: null, reason: 'r', provenance: ['p'] },
  processes: [], decomposition: [], dependencies: [], laws: [], initial_claims: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1',
    concepts: [{ id: 'concept.football', label: 'Football', differentia: [], boundary: null, state_schema: {}, direction_families: [], observation_methods: [], provenance: ['sketch: fixture'] }],
    abstract_relations: [], abstract_cuts: [], referents: [], encapsulation_cuts: [], event_referent_bindings: [], physical_cuts: [], realizations: [],
    events: [event('event.writing', -3200), event('event.printing', 1440), event('event.world_cup_1966', 1966), event('event.pandemic_2020', 2020, 2022)] },
});
const world = { id: 'importance.world', audience: 'Everyone who lives in this world', preset: 'rarity' };
const football = { id: 'importance.football', audience: 'Those who follow football', concept: 'concept.football',
  levels: [['legendary', 'Every follower knows it a lifetime later.'], ['remembered', 'Followers of that era remember it.'], ['reported', 'It made the results pages.']] };

test('a scale names its audience and its levels, the most important first, and each Event gets one level per holder', () => {
  let model = base();
  model = applyModelChange(model, HASH, importanceChange(model, { holder: 'modeler', tag: 'sketch', reason: 'first pass', scales: [world, football], judgments: [
    { eventId: 'event.writing', scaleId: 'importance.world', level: 'top_10', reason: 'Every later record depends on it.' },
    { eventId: 'event.printing', scaleId: 'importance.world', level: 'top_100' },
    { eventId: 'event.world_cup_1966', scaleId: 'importance.world', level: 'noted' },
    { eventId: 'event.world_cup_1966', scaleId: 'importance.football', level: 'legendary' },
    // A pandemic is not football, yet it stopped the game: what matters to an audience is not only its category.
    { eventId: 'event.pandemic_2020', scaleId: 'importance.football', level: 'remembered', tag: 'inferred' },
  ] })).successor;
  const scales = model.meaning_model.importance_scales;
  assert.deepEqual(scales.map((scale) => scale.levels.map((level) => level.key)), [IMPORTANCE_PRESETS.rarity.map(([key]) => key), ['legendary', 'remembered', 'reported']]);
  assert.equal(scales[1].concept_id, 'concept.football');
  const judgments = model.meaning_model.event_importance;
  assert.equal(judgments.length, 5);
  assert.deepEqual(judgments.find((j) => j.event_id === 'event.pandemic_2020').provenance, ['inferred: first pass']);
  assert.equal(judgments.find((j) => j.event_id === 'event.writing').reason, 'Every later record depends on it.');

  // Judging again replaces the level for this holder; another holder's judgment stands beside it.
  model = applyModelChange(model, HASH, importanceChange(model, { holder: 'modeler', tag: 'inferred', reason: 'printing spread literacy', judgments: [
    { eventId: 'event.printing', scaleId: 'importance.world', level: 'top_10' }] })).successor;
  model = applyModelChange(model, HASH, importanceChange(model, { holder: 'reader', tag: 'sketch', reason: 'a second view', judgments: [
    { eventId: 'event.printing', scaleId: 'importance.world', level: 'top_1000' }] })).successor;
  const printing = model.meaning_model.event_importance.filter((j) => j.event_id === 'event.printing');
  assert.deepEqual(printing.map((j) => [j.holder, j.level]).sort(), [['modeler', 'top_10'], ['reader', 'top_1000']]);
  assert.equal(model.meaning_model.event_importance.length, 6);
});

test('the report counts each level, names the top, and points to unjudged Events and a crowded top', () => {
  let model = base();
  model = applyModelChange(model, HASH, importanceChange(model, { holder: 'modeler', tag: 'sketch', reason: 'r', scales: [world, football], judgments: [
    { eventId: 'event.writing', scaleId: 'importance.world', level: 'top_10' },
    { eventId: 'event.world_cup_1966', scaleId: 'importance.football', level: 'legendary' },
  ] })).successor;
  const report = importanceReport(model, { holder: 'modeler' });
  const [w, f] = report.scales;
  assert.deepEqual(w.levels.map((level) => [level.level, level.rank, level.events]), [['top_10', 1, 1], ['top_100', 2, 0], ['top_1000', 3, 0], ['noted', 4, 0]]);
  assert.deepEqual(w.top, ['event.writing']);
  // The whole audience's scale should reach every Event; a category's scale only those its followers care about.
  assert.equal(w.unjudgedCount, 3);
  assert.equal(f.unjudgedCount, undefined);
  assert.match(report.next.join('\n'), /3 Event\(s\) have no level on importance\.world/);
  // A top level holding most Events picks nothing out.
  const crowded = structuredClone(model);
  for (let i = 0; i < 9; i += 1) {
    crowded.meaning_model.events.push(event(`event.e${i}`, 1900 + i));
    crowded.meaning_model.event_importance.push({ id: `j${i}`, event_id: `event.e${i}`, scale_id: 'importance.world', level: 'top_10', holder: 'modeler', provenance: ['sketch: r'] });
  }
  assert.match(importanceReport(crowded, { holder: 'modeler' }).next.join('\n'), /top level of importance\.world holds 10 of its 10 Events/);
  assert.match(importanceReport(base()).next.join('\n'), /Declare a scale for the whole audience/);
});

test('judgments name an Event, a declared scale and one of its levels; levels in use are not dropped', () => {
  const model = applyModelChange(base(), HASH, importanceChange(base(), { holder: 'm', tag: 'sketch', reason: 'r', scales: [football], judgments: [
    { eventId: 'event.world_cup_1966', scaleId: 'importance.football', level: 'legendary' }] })).successor;
  const call = (input) => importanceChange(model, { holder: 'm', tag: 'sketch', reason: 'r', ...input });
  assert.throws(() => call({ judgments: [{ eventId: 'event.none', scaleId: 'importance.football', level: 'legendary' }] }), /not an Event/);
  assert.throws(() => call({ judgments: [{ eventId: 'event.writing', scaleId: 'importance.none', level: 'top_10' }] }), /not an importance scale/);
  assert.throws(() => call({ judgments: [{ eventId: 'event.writing', scaleId: 'importance.football', level: 'top_10' }] }), /not a level of importance\.football \(legendary, remembered, reported\)/);
  assert.throws(() => call({ judgments: [{ eventId: 'event.writing', scaleId: 'importance.football', level: 'reported' }, { eventId: 'event.writing', scaleId: 'importance.football', level: 'remembered' }] }), /judged twice/);
  assert.throws(() => call({ scales: [{ id: 'importance.new', audience: 'a' }] }), /needs its levels/);
  assert.throws(() => call({ scales: [{ id: 'importance.new', levels: [['a', 'x'], ['b', 'y']] }] }), /say whose judgment/);
  assert.throws(() => call({ scales: [{ id: 'importance.new', audience: 'a', concept: 'concept.none', preset: 'rarity' }] }), /not a Concept/);
  assert.throws(() => call({ scales: [{ id: 'importance.new', audience: 'a', levels: [['a', 'x'], ['a', 'y']] }] }), /appears twice/);
  // Dropping a level a judgment uses is refused unless the judgment moves in the same call.
  const fewer = { id: 'importance.football', levels: [['remembered', 'Followers of that era remember it.'], ['reported', 'It made the results pages.']] };
  assert.throws(() => call({ scales: [fewer] }), /use a level their scale no longer has, first event\.world_cup_1966 at legendary/);
  const moved = call({ scales: [fewer], judgments: [{ eventId: 'event.world_cup_1966', scaleId: 'importance.football', level: 'remembered' }] });
  assert.equal(moved.upsert.event_importance[0].level, 'remembered');
  // A scale can be renamed for its audience without restating its levels.
  assert.deepEqual(call({ scales: [{ id: 'importance.football', audience: 'Football supporters' }] }).upsert.importance_scales[0].levels.map((level) => level.key), ['legendary', 'remembered', 'reported']);
});

test('importance goes through the engine, which keeps one judgment per Event, scale and holder', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const model = base();
  model.processes = [{ id: 'population', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 100 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'billion',
    update_mode: 'observed', uncertainty: { kind: 'unknown' }, support: ['fixture'], provenance: ['fixture'], access_scopes: [] }];
  let hash = (await service.registerModel({ requestId: 'importance-model', model })).modelHash;
  const plain = (await service.inspectModel({ modelHash: hash, includeDefinition: true })).model;
  assert.equal(plain.meaning_model.importance_scales, undefined, 'a model without importance stays as it was');
  const record = async (requestId, input) => {
    const { model: previous } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
    const { successor } = applyModelChange(previous, hash, importanceChange(previous, { holder: 'modeler', tag: 'sketch', reason: 'r', ...input }));
    hash = (await service.reviseModel({ requestId, previousModelHash: hash, model: successor })).modelHash;
  };
  await record('importance-1', { scales: [world, football], judgments: [
    { eventId: 'event.writing', scaleId: 'importance.world', level: 'top_10' },
    { eventId: 'event.world_cup_1966', scaleId: 'importance.football', level: 'legendary' }] });
  await record('importance-2', { judgments: [{ eventId: 'event.writing', scaleId: 'importance.world', level: 'top_100' }] });
  const { model: stored } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
  assert.deepEqual(stored.meaning_model.event_importance.map((j) => [j.event_id, j.scale_id, j.level]).sort(),
    [['event.world_cup_1966', 'importance.football', 'legendary'], ['event.writing', 'importance.world', 'top_100']]);
  // The engine refuses a second judgment from the same holder, however it arrives.
  const twice = structuredClone(stored);
  twice.revision = { number: stored.revision.number + 1, previous_model_hash: hash, reason: 'r', provenance: ['p'] };
  twice.meaning_model.event_importance.push({ ...twice.meaning_model.event_importance[0], id: 'importance.duplicate' });
  await assert.rejects(service.reviseModel({ requestId: 'importance-twice', previousModelHash: hash, model: twice }), /already has a level/);
});

test('the viewer carries each scale and judgment, and keeps to the top levels of the scale chosen', async () => {
  let model = base();
  model = applyModelChange(model, HASH, importanceChange(model, { holder: 'modeler', tag: 'sketch', reason: 'r', scales: [world, football], judgments: [
    { eventId: 'event.writing', scaleId: 'importance.world', level: 'top_10', reason: 'Every later record depends on it.' },
    { eventId: 'event.printing', scaleId: 'importance.world', level: 'top_100' },
    { eventId: 'event.world_cup_1966', scaleId: 'importance.world', level: 'noted' },
    { eventId: 'event.world_cup_1966', scaleId: 'importance.football', level: 'legendary' },
    { eventId: 'event.pandemic_2020', scaleId: 'importance.football', level: 'remembered' },
  ] })).successor;
  const data = await buildViewerData({ history: { models: [{ modelHash: HASH, definition: model }], revisions: [] } });
  assert.deepEqual(data.importance.scales.map((scale) => [scale.id, scale.conceptLabel, scale.levels.map((level) => `${level.rank}:${level.key}`)]), [
    ['importance.world', null, ['1:top_10', '2:top_100', '3:top_1000', '4:noted']],
    ['importance.football', 'Football', ['1:legendary', '2:remembered', '3:reported']]]);
  assert.deepEqual(data.events.find((event) => event.id === 'event.writing').importance,
    [{ scale: 'importance.world', level: 'top_10', rank: 1, holder: 'modeler', reason: 'Every later record depends on it.' }]);

  // The viewer's own filter, as view.js holds it.
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  const from = source.indexOf('const importanceScales ='), to = source.indexOf('\n}', source.indexOf('function unimportantEventIds('));
  const shown = (importance, importanceTop) => {
    const context = { data, opt: { importance, importanceTop } }; vm.createContext(context);
    vm.runInContext(`${source.slice(from, to + 2)}\nthis.hidden = unimportantEventIds();`, context);
    return context.hidden && data.events.map((event) => event.id).filter((id) => !context.hidden.has(id)).sort();
  };
  assert.deepEqual(shown('importance.world', 1), ['event.writing']);
  assert.deepEqual(shown('importance.world', 2), ['event.printing', 'event.writing']);
  assert.deepEqual(shown('importance.football', 1), ['event.world_cup_1966']);
  assert.deepEqual(shown('importance.football', 3), ['event.pandemic_2020', 'event.world_cup_1966']);
  assert.equal(shown('importance.none', 1), null, 'an unknown scale filters nothing');
  // A view the model chooses can set the same filter.
  assert.deepEqual(viewSettingsProblems({ importance: 'importance.football', importanceTop: '2' }), []);
  assert.match(viewSettingsProblems({ importance: 'importance.world', importanceTop: '0' })[0], /importanceTop=0 must be a whole number from 1/);
});

test('the tree hides an Event the chosen levels leave out, within detail and focus as well', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  const from = source.indexOf('const visibleNode ='), to = source.indexOf('function pack(', from);
  const node = (id) => ({ id, kind: 'event', trunk: false, depth: 1 });
  const context = { opt: { show: new Set(['events']), hideUnopened: false, hideFlat: false, depth: 3, unimportant: new Set(['era.neolithic']) }, unopenedProcessIds: new Set(), CUT_ROW: 6, ROW: 2.7 };
  vm.createContext(context);
  vm.runInContext(`${source.slice(from, to)}\nthis.visibleNode = visibleNode;`, context);
  assert.equal(context.visibleNode(node('ev.industrial_revolution'), true), true);
  assert.equal(context.visibleNode(node('era.neolithic'), true), false);
  // Within a detail projection the importance filter still applies.
  context.opt.detailProjection = { eventIds: new Set(['ev.industrial_revolution', 'era.neolithic']), retainedEventIds: new Set(), rowIds: new Set(), level: 1, maxLevel: 2 };
  assert.equal(context.visibleNode(node('ev.industrial_revolution'), true), true);
  assert.equal(context.visibleNode(node('era.neolithic'), true), false);
});

test('the report asks for a level on what happens, not on the world itself or a Thing\'s lifecycle', () => {
  let model = base();
  model.meaning_model.events.push(event('event.world', -300000, 2026), event('life.rome', -27, 1453));
  model.meaning_model.context_roots = [{ event_id: 'event.world', kind: 'accepted_world', provenance: ['sketch: fixture'] }];
  model.meaning_model.referents.push({ id: 'polity.rome', boundary: 'The Roman state', continuity_criterion: 'Continuous rule', lifecycle_event_id: 'life.rome', provenance: ['sketch: fixture'] });
  model = applyModelChange(model, HASH, importanceChange(model, { holder: 'modeler', tag: 'sketch', reason: 'r', scales: [world], judgments: [] })).successor;
  const [scale] = importanceReport(model).scales;
  assert.deepEqual(scale.unjudged.sort(), ['event.pandemic_2020', 'event.printing', 'event.world_cup_1966', 'event.writing']);
});

test('a long reason is clipped in provenance, an oversized text is refused plainly, and only world Events are asked for', async (t) => {
  const model = base();
  const reason = 'Ranking the turning points by how many people they changed, for how long and how deeply. '.repeat(13);
  const change = importanceChange(model, { holder: 'm', tag: 'sketch', reason, scales: [world], judgments: [{ eventId: 'event.writing', scaleId: 'importance.world', level: 'top_10' }] });
  for (const record of [...change.upsert.importance_scales, ...change.upsert.event_importance]) assert.ok(Buffer.byteLength(record.provenance[0], 'utf8') <= 1_024);
  assert.throws(() => importanceChange(model, { holder: 'm', tag: 'sketch', reason: 'r', scales: [{ ...world, audience: 'ω'.repeat(600) }] }), /the audience is 1200 bytes/u);
  // Through the engine, the long reason is accepted.
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  model.processes = [{ id: 'population', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 100 } }, initial_value: { kind: 'scalar', value: 1 }, unit: 'billion',
    update_mode: 'observed', uncertainty: { kind: 'unknown' }, support: ['fixture'], provenance: ['fixture'], access_scopes: [] }];
  const hash = (await service.registerModel({ requestId: 'importance-long', model })).modelHash;
  const { model: previous } = await service.inspectModel({ modelHash: hash, includeDefinition: true });
  const { successor } = applyModelChange(previous, hash, importanceChange(previous, { holder: 'm', tag: 'sketch', reason, scales: [world], judgments: [{ eventId: 'event.writing', scaleId: 'importance.world', level: 'top_10' }] }));
  await service.reviseModel({ requestId: 'importance-long-1', previousModelHash: hash, model: successor });
  // A character's inner Event is not asked for a level on the world's scale.
  const inner = structuredClone(base());
  inner.meaning_model.events.push(event('inner.root', 1960, 1990), event('inner.dream', 1966));
  inner.meaning_model.context_roots = [{ event_id: 'inner.root', kind: 'inner', provenance: ['x'] }];
  inner.meaning_model.event_relations = [{ id: 'c', kind: 'contains', source_event_id: 'inner.root', target_event_id: 'inner.dream', provenance: ['x'] }];
  const withScale = applyModelChange(inner, HASH, importanceChange(inner, { holder: 'm', tag: 'sketch', reason: 'r', scales: [world] })).successor;
  assert.ok(!importanceReport(withScale).scales[0].unjudged.some((id) => id.startsWith('inner.')));
});

test('judgment ids do not collide when scale and Event ids share dots', () => {
  const m = base();
  m.meaning_model.events.push(event('a.b', 1990), event('b', 1991));
  const scales = [{ id: 's', audience: 'one', preset: 'rarity' }, { id: 's.a', audience: 'two', preset: 'rarity' }];
  const change = importanceChange(m, { holder: 'm', tag: 'sketch', reason: 'r', scales, judgments: [
    { eventId: 'a.b', scaleId: 's', level: 'top_10' }, { eventId: 'b', scaleId: 's.a', level: 'top_10' }] });
  const ids = change.upsert.event_importance.map((judgment) => judgment.id);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.match(id, /^importance\.[0-9a-f]{24}$/u);
});
