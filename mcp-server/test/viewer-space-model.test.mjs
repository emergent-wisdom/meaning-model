import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulationService } from '../src/service.mjs';
import { spaceModel, positionAt, timeSpan, planeOf, lifeLocations, locationSequence, spaceConnections, spatialRecordText, resolveSpaceSelection, spaceToViewerTime, viewerToSpaceTime, placedEvents } from '../viewer/public/space-model.js';

// A harbour declared in the existing grammar: a ferry's pose, a buoy's two coordinates, a boat moving at a declared
// constant speed, and a pier with no position. Places named only in an Event's region are never placed.
const provenance = ['space-view test'];
const bounds = { minimum: -10000, maximum: 10000 };
const scalar = (id, value, extra = {}) => ({ id, value_type: { kind: 'scalar', bounds }, initial_value: { kind: 'scalar', value }, uncertainty: { kind: 'exact' },
  provenance, unit: 'meter', reference_frame: 'harbour', support: ['a harbour survey'], access_scopes: [], ...extra });
export function harbour() {
  return { schema: 'life-sim-rust-model/v1', id: 'harbour', time_unit: 'hour', revision: { number: 0, reason: 'Test harbour', provenance },
    processes: [
      { id: 'ferry.pose', value_type: { kind: 'object_pose', position_dimensions: 3, orientation_dimensions: 4 }, initial_value: { kind: 'object_pose', value: { position: [40, -20, 0], orientation: [1, 0, 0, 0] } },
        uncertainty: { kind: 'exact' }, provenance, unit: 'meter', reference_frame: 'harbour', axes: [{ id: 'x' }, { id: 'y' }, { id: 'z' }], support: ['the ferry at its berth'], access_scopes: [], update_mode: 'static' },
      scalar('buoy.position.x', 120, { scale: { semantic_role: 'position', axis: 'x' }, support: ['spatial_entity:buoy'], update_mode: 'static' }),
      scalar('buoy.position.y', 35, { scale: { semantic_role: 'position', axis: 'y' }, support: ['spatial_entity:buoy'], update_mode: 'static' }),
      scalar('boat.position.x', 0, { scale: { semantic_role: 'position', axis: 'x' } }),
      scalar('boat.position.y', 10, { scale: { semantic_role: 'position', axis: 'y' }, update_mode: 'static' }),
      scalar('boat.velocity.x', 5, { unit: 'meter/hour', scale: { semantic_role: 'velocity', axis: 'x' }, update_mode: 'static' }),
    ],
    decomposition: [],
    dependencies: [{ id: 'boat.dependency.velocity-position.x', source: 'boat.velocity.x', target: 'boat.position.x', kind: 'causes', law_id: 'boat.move.x' }],
    laws: [{ id: 'boat.move.x', operator: { role: 'evolution', target: 'boat.position.x', derivative: { op: 'process', process: 'boat.velocity.x' } }, provenance }],
    initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1',
      referents: [{ id: 'thing.ferry', boundary: 'The Ferry Maud, a harbour ferry' }, { id: 'thing.buoy', boundary: 'The Red Buoy' }, { id: 'thing.pier', boundary: 'The Old Pier' }].map((referent) => ({ ...referent, continuity_criterion: 'the same hull, buoy or pier through repairs', provenance })),
      events: [{ id: 'harbour.day', boundary: 'A day in the harbour', interval: { start: 0, end: 24 }, region: 'Kalmar harbour', provenance }],
      event_referent_bindings: [
        { id: 'where.ferry', target: { kind: 'process', process_id: 'ferry.pose' }, role: 'position', referent_id: 'thing.ferry', binding_type: 'position of', provenance },
        { id: 'where.buoy', target: { kind: 'process', process_id: 'buoy.position.x' }, role: 'position', referent_id: 'thing.buoy', binding_type: 'position of', provenance },
      ],
    },
  };
}

test('the engine accepts positions declared in the existing grammar, and the space view reads exactly those', async (t) => {
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const registered = await service.registerModel({ requestId: 'harbour', model: harbour() });
  const { model } = await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true });
  const space = spaceModel(model);
  assert.equal(space.frames.length, 1);
  const [frame] = space.frames;
  assert.deepEqual([frame.frame, frame.unit, frame.dimensions], ['harbour', 'meter', 3]);
  const byLabel = Object.fromEntries(frame.objects.map((object) => [object.label, object]));
  assert.deepEqual(Object.keys(byLabel).sort(), ['Ferry Maud', 'Red Buoy', 'boat']);
  assert.deepEqual(byLabel['Ferry Maud'].position, [40, -20, 0]); assert.deepEqual(byLabel['Ferry Maud'].orientation, [1, 0, 0, 0]);
  assert.equal(byLabel['Ferry Maud'].referentId, 'thing.ferry');
  assert.deepEqual(byLabel['Red Buoy'].axes, ['x', 'y']); assert.deepEqual(byLabel['Red Buoy'].position, [120, 35]); assert.equal(byLabel['Red Buoy'].moves, false);
  // The boat's x follows its declared evolution law exactly: five metres an hour from the model's start.
  const boat = byLabel.boat;
  assert.equal(boat.moves, true); assert.equal(boat.evaluated, true); assert.deepEqual(boat.laws, ['boat.move.x']);
  assert.deepEqual(positionAt(boat, 0), [0, 10]); assert.deepEqual(positionAt(boat, 4), [20, 10]);
  // The pier has no declared position, and the region names a place only in words.
  assert.deepEqual(space.unplacedReferents.map((referent) => referent.name), ['Old Pier']);
  assert.deepEqual(space.textRegions, ['Kalmar harbour']);
});

test('declared precision, positions held for an interval and moves at a declared time are drawn as declared', async (t) => {
  const model = harbour();
  // The pier is a surveyed point within a metre; the pilot stands at the pier, then on the ferry's deck; the buoy is
  // moved to a new mooring when the clock reaches hour 12.
  model.processes.push(
    scalar('pier.position.x', -60, { scale: { semantic_role: 'position', axis: 'x' }, uncertainty: { kind: 'standard_deviation', value: 1 }, update_mode: 'static' }),
    scalar('pier.position.y', 5, { scale: { semantic_role: 'position', axis: 'y' }, uncertainty: { kind: 'interval', lower: 4, upper: 6 }, update_mode: 'static' }),
    scalar('pilot.at_pier.position.x', -58, { scale: { semantic_role: 'position', axis: 'x' }, update_mode: 'static' }),
    scalar('pilot.at_pier.position.y', 6, { scale: { semantic_role: 'position', axis: 'y' }, update_mode: 'static' }),
    scalar('pilot.on_ferry.position.x', 41, { scale: { semantic_role: 'position', axis: 'x' }, update_mode: 'static' }),
    scalar('pilot.on_ferry.position.y', -19, { scale: { semantic_role: 'position', axis: 'y' }, update_mode: 'static' }));
  model.laws.push({ id: 'buoy.moored.x', operator: { role: 'occurrence', trigger: { kind: 'threshold', expression: { op: 'time' }, comparison: 'greater_or_equal', threshold: 12, firing: 'on_enter' },
    effects: [{ target: 'buoy.position.x', mode: 'set', value: { op: 'constant', value: 150 } }] }, provenance });
  model.processes.find((process) => process.id === 'buoy.position.x').update_mode = 'unspecified';
  model.meaning_model.referents.push({ id: 'person.pilot', boundary: 'Ines Berg, the harbour pilot', continuity_criterion: 'the same person', provenance });
  model.meaning_model.event_referent_bindings.push(
    { id: 'where.pier', target: { kind: 'process', process_id: 'pier.position.x' }, role: 'position', referent_id: 'thing.pier', binding_type: 'position of', provenance },
    { id: 'pilot.stay.pier', target: { kind: 'process', process_id: 'pilot.at_pier.position.x' }, role: 'position', referent_id: 'person.pilot', binding_type: 'position of', interval: { start: 5, end: 6 }, provenance },
    { id: 'pilot.stay.ferry', target: { kind: 'process', process_id: 'pilot.on_ferry.position.x' }, role: 'position', referent_id: 'person.pilot', binding_type: 'position of', interval: { start: 6, end: 9 }, provenance });
  // The engine accepts every shape the view reads.
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const registered = await service.registerModel({ requestId: 'harbour-timed', model });
  const { model: accepted } = await service.inspectModel({ modelHash: registered.modelHash, includeDefinition: true });
  const [frame] = spaceModel(accepted).frames;
  const find = (label, start) => frame.objects.find((object) => object.label === label && (start === undefined || object.interval?.start === start));
  const pier = find('Old Pier');
  assert.deepEqual(pier.precision, [{ kind: 'standard_deviation', value: 1 }, { kind: 'interval', lower: 4, upper: 6 }]);
  const [atPier, onFerry] = [find('Ines Berg', 5), find('Ines Berg', 6)];
  assert.ok(atPier && onFerry, 'each stay is its own declared position of the same referent');
  assert.deepEqual([positionAt(atPier, 5.5), positionAt(onFerry, 5.5)], [[-58, 6], null]);
  assert.deepEqual([positionAt(atPier, 7), positionAt(onFerry, 7)], [null, [41, -19]]);
  const buoy = find('Red Buoy');
  assert.deepEqual(buoy.motion[0], { steps: [{ t: 12, value: 150 }] }); assert.equal(buoy.evaluated, true);
  assert.deepEqual([positionAt(buoy, 11.9), positionAt(buoy, 12)], [[120, 35], [150, 35]]);
  assert.deepEqual(timeSpan(frame, 24), { start: 0, end: 24 });
});

test('a law the view cannot follow exactly is named, never guessed', () => {
  const model = harbour();
  model.laws[0].activation = 'gated';
  const gated = spaceModel(model).frames[0].objects.find((object) => object.label === 'boat');
  assert.equal(gated.evaluated, false); assert.equal(positionAt(gated, 4), null); assert.deepEqual(positionAt(gated, 0), [0, 10]);
  model.laws[0].activation = 'always'; model.laws[0].enabled = false;
  const disabled = spaceModel(model).frames[0].objects.find((object) => object.label === 'boat');
  assert.equal(disabled.moves, false, 'a disabled law moves nothing');
  const model2 = harbour();
  model2.laws.push({ id: 'boat.push.x', operator: { role: 'evolution', target: 'boat.position.x', derivative: { op: 'constant', value: 1 } }, provenance });
  assert.equal(spaceModel(model2).frames[0].objects.find((object) => object.label === 'boat').evaluated, false, 'two laws on one coordinate are not summed by the viewer');
});

test('where Events happen is listed from declared place bindings, with when and who, and without geometry', () => {
  const model = harbour();
  model.meaning_model.referents.push({ id: 'person.ines', boundary: 'Ines Berg, the harbour pilot', continuity_criterion: 'the same person', provenance });
  model.meaning_model.events.push({ id: 'harbour.boarding', boundary: 'Ines boards at the pier', interval: { start: 6, end: 6.5 }, participants: { subject: 'person.ines' }, description: 'She can reach the rail from the ladder.', provenance });
  model.meaning_model.event_referent_bindings.push(
    { id: 'at.pier', target: { kind: 'event', event_id: 'harbour.boarding' }, role: 'setting', referent_id: 'thing.pier', binding_type: 'located_in', provenance },
    { id: 'named.pier', target: { kind: 'event', event_id: 'harbour.day' }, role: 'mentioned', referent_id: 'thing.pier', binding_type: 'participant', provenance });
  const { settings, frames } = spaceModel(model);
  assert.deepEqual(settings.map((setting) => [setting.name, setting.events.map((event) => event.id), setting.who]), [['The Old Pier', ['harbour.boarding'], []]]);
  assert.deepEqual(settings[0].events[0].participants, ['Ines Berg'], 'participation is not a declaration of physical presence');
  assert.equal(settings[0].events[0].description, 'She can reach the rail from the ladder.');
  assert.ok(!frames.flatMap((frame) => frame.objects).some((object) => object.referentId === 'thing.pier'), 'a setting is not given coordinates');
});

test('nothing is placed from names, regions or other frames, and coordinates in different frames never join', () => {
  const model = harbour();
  model.processes.push(scalar('ghost.position.x', 1, { reference_frame: 'another map', scale: { semantic_role: 'position', axis: 'x' } }),
    scalar('ghost.position.y', 2, { scale: { semantic_role: 'position', axis: 'y' } }),
    scalar('depth.meters', 3, { scale: { semantic_role: 'depth' } }));
  const space = spaceModel(model);
  assert.equal(space.frames.length, 2);
  assert.ok(!space.frames.flatMap((frame) => frame.objects).some((object) => object.processIds.includes('depth.meters')), 'a scalar without a declared position role is not a coordinate');
  const ghost = space.frames.flatMap((frame) => frame.objects).filter((object) => object.id === 'ghost');
  assert.equal(ghost.length, 1); assert.deepEqual(ghost[0].axes, ['x'], 'a coordinate in another frame does not join it');
  assert.deepEqual(spaceModel({}).frames, []);
});

test('latitude and longitude lie as a map, and a representative point keeps its declared spread', () => {
  // Two sourced town points in a geographic frame, one with a representative-point spread in degrees.
  const geo = (id, latitude, longitude, spread) => ['latitude', 'longitude'].map((axis) => ({ id: `${id}.position.${axis}`, value_type: { kind: 'scalar', bounds: { minimum: -180, maximum: 180 } },
    initial_value: { kind: 'scalar', value: axis === 'latitude' ? latitude : longitude }, uncertainty: spread ? { kind: 'standard_deviation', value: spread } : { kind: 'exact' }, provenance: ['public gazetteer'],
    unit: 'degree', reference_frame: 'WGS84', scale: { semantic_role: 'position', axis }, support: [`spatial_entity:${id}`], access_scopes: [], update_mode: 'static' }));
  const model = { processes: [...geo('swindon', 51.558, -1.782, 0.02), ...geo('avebury', 51.428, -1.854)], meaning_model: {} };
  const [frame] = spaceModel(model).frames;
  assert.deepEqual([frame.frame, frame.unit, [...frame.axes].sort()], ['WGS84', 'degree', ['latitude', 'longitude']]);
  const plane = planeOf(frame);
  assert.equal(plane.geo, true);
  const swindon = frame.objects.find((object) => object.label === 'swindon'), avebury = frame.objects.find((object) => object.label === 'avebury');
  const a = plane.coordinates(swindon, swindon.position), b = plane.coordinates(avebury, avebury.position);
  assert.ok(a.north > b.north && a.east > b.east, 'Swindon lies north and east of Avebury');
  assert.ok(Math.abs(a.east / swindon.position[swindon.axes.indexOf('longitude')] - Math.cos(51.493 * Math.PI / 180)) < 1e-9, 'longitude narrows by the cosine of the middle latitude');
  assert.deepEqual(swindon.precision, [{ kind: 'standard_deviation', value: 0.02 }, { kind: 'standard_deviation', value: 0.02 }]);
  assert.equal(timeSpan(frame), null, 'places that do not move have no time span');
});


function lifeModel() {
  const locations = [['home.a', 'home_base', 'place.a', 2, 8, [10, 20]], ['work.b', 'workplace', 'place.b', 4, 10, [40, 20]], ['home.c', 'home_base', 'place.c', 12, 16, [50, 80]]];
  return {
    time_unit: 'year',
    processes: locations.map(([id, role, place, start, end, point]) => ({ id, initial_value: { kind: 'vector', value: point }, unit: 'm', reference_frame: 'map', axes: [{ id: 'x' }, { id: 'y' }],
      scale: { semantic_role: 'position', spatial_status: 'coarse_life_location', location_role: role, place_ref: place, label: place }, provenance: ['Authored coarse context'] })),
    meaning_model: {
      referents: [{ id: 'person', boundary: 'Asha, a person', lifecycle_event_id: 'life' }, ...['a', 'b', 'c'].map((id) => ({ id: `place.${id}`, boundary: `Place ${id}` }))],
      events: [{ id: 'life', boundary: 'A life', interval: { start: 0, end: 20 } }, { id: 'move', boundary: 'A new home', interval: { start: 12, end: 16 }, process_ids: ['home.c'] }],
      event_referent_bindings: locations.map(([id, , , start, end]) => ({ id: `bind.${id}`, target: { kind: 'process', process_id: id }, role: 'position', binding_type: 'coordinate', referent_id: 'person', interval: { start, end } })),
    },
  };
}

test('lifetime positions retain home and work roles, and unrecorded time stays unrecorded', () => {
  const [frame] = spaceModel(lifeModel()).frames, [life] = lifeLocations(frame);
  assert.equal(frame.lifeLocations.length, 3);
  assert.equal(life.label, 'Asha');
  assert.deepEqual(life.locations.map((location) => [location.locationRole, location.placeId]), [['home_base', 'place.a'], ['workplace', 'place.b'], ['home_base', 'place.c']]);
  assert.deepEqual(life.gaps, [{ start: 0, end: 2 }, { start: 10, end: 12 }, { start: 16, end: 20 }]);
  assert.deepEqual(positionAt(life.locations[0], 9), null, 'no carry-forward into a gap');
  assert.deepEqual(locationSequence(frame).map((link) => [link.source.id, link.target.id, link.gap]), [['home.a', 'home.c', true]], 'a workplace does not become a move away from home');
});

test('position ownership never comes from a non-position binding, and settings never infer co-presence', () => {
  const model = lifeModel();
  model.meaning_model.event_referent_bindings.unshift({ id: 'about', target: { kind: 'process', process_id: 'home.a' }, role: 'observer', binding_type: 'belief', referent_id: 'place.a' });
  model.meaning_model.events.push({ id: 'call', boundary: 'A remote conversation', participants: { caller: 'person' } });
  model.meaning_model.event_referent_bindings.push(
    { id: 'call.place', target: { kind: 'event', event_id: 'call' }, role: 'setting', binding_type: 'located_in', referent_id: 'place.b' },
    { id: 'call.other', target: { kind: 'event', event_id: 'call' }, role: 'mentioned', binding_type: 'about', referent_id: 'place.c' });
  const space = spaceModel(model);
  assert.equal(space.frames[0].objects.find((object) => object.id === 'home.a').referentId, 'person');
  assert.deepEqual(space.settings[0].who, []);
  assert.deepEqual(space.settings[0].events[0].participants, ['Asha']);
});

test('Space context follows native process/Event and narrative grounding edges, never word overlap', () => {
  const model = lifeModel();
  const inspection = { model, graph: { nodes: [{ id: 'thought', kind: 'understanding', text: 'Distance makes the visit harder.' }, { id: 'unrelated', text: 'Asha home.c move place.c' }, { id: 'passage', kind: 'passage', text: 'She unpacked.' }],
    edges: [
      { source: { kind: 'node', node_id: 'thought' }, target: { kind: 'anchor', anchor_kind: 'process', anchor_id: 'home.c' }, relation: 'about', family: 'grounding' },
      { source: { kind: 'node', node_id: 'passage' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'move' }, relation: 'renders', family: 'grounding' },
    ] } };
  const object = spaceModel(model).frames[0].objects.find((item) => item.id === 'home.c');
  const related = spaceConnections(inspection).related(object);
  assert.ok(related.some((node) => node.nativeId === 'move'));
  assert.ok(related.some((node) => node.nativeId === 'thought'));
  assert.ok(related.some((node) => node.nativeId === 'passage'));
  assert.ok(!related.some((node) => node.nativeId === 'unrelated'));
});


test('typed Understanding prose is readable and broader person links stay separate from period evidence', () => {
  const model = lifeModel();
  const note = { id: 'note', text: JSON.stringify({ schema: 'meaning-model-understanding-note/v1', kind: 'interpretation', text: 'The unfamiliar route makes her hesitate.', data: { detail: 'kept in the native record' } }) };
  const personNote = { id: 'life-note', text: 'She remembers another city.' };
  const inspection = { model, graph: { nodes: [note, personNote], edges: [
    { source: { kind: 'node', node_id: 'note' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'move' }, relation: 'about' },
    { source: { kind: 'node', node_id: 'life-note' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person' }, relation: 'about' },
  ] } };
  const object = spaceModel(model).frames[0].objects.find((item) => item.id === 'home.c'), related = spaceConnections(inspection).related(object);
  const direct = related.find((item) => item.nativeId === 'note'), broader = related.find((item) => item.nativeId === 'life-note');
  assert.equal(direct.label, 'The unfamiliar route makes her hesitate.');
  assert.equal(direct.displayText, direct.label);
  assert.equal(direct.scope, 'period');
  assert.equal(broader.scope, 'person');
  assert.equal(direct.record.text, note.text, 'the envelope is preserved for provenance inspection');
  assert.equal(spatialRecordText({ text: '{"schema":"something-else","text":"do not decode"}' }), '{"schema":"something-else","text":"do not decode"}');
  assert.equal(spatialRecordText({ text: 'Ordinary <prose> stays literal.' }), 'Ordinary <prose> stays literal.');
});


test('Space restores narrative and Event selections, using directly declared period frames only', () => {
  const model = lifeModel(), note = { id: 'thought', text: 'The new room changes her routine.' };
  const inspection = { model, graph: { nodes: [note, { id: 'general', text: 'A broader life note.' }], edges: [
    { source: { kind: 'node', node_id: 'thought' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'move' }, relation: 'about' },
    { source: { kind: 'node', node_id: 'general' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person' }, relation: 'about' },
  ] } };
  const frames = [{ frame: 'unrelated', objects: [] }, ...spaceModel(model).frames], connections = spaceConnections(inspection);
  const restored = resolveSpaceSelection(frames, connections, { kind: 'narrative', id: 'thought' }, 0);
  assert.equal(restored.frame, 1);
  assert.equal(restored.object.id, 'home.c');
  assert.equal(restored.node.nativeId, 'thought');
  const event = resolveSpaceSelection(frames, connections, { kind: 'event', id: 'move' }, 0);
  assert.equal(event.frame, 1);
  assert.equal(event.object.id, 'home.c');
  const general = resolveSpaceSelection(frames, connections, { kind: 'narrative', id: 'general' }, 0);
  assert.equal(general.frame, 0, 'a broader person note does not imply a physical location');
  assert.equal(general.object, null);
  assert.equal(general.node.nativeId, 'general', 'the native record still opens without drawable coordinates');
});


test('Space carries a civil-day cursor through the shared viewer clock without treating days as years', () => {
  for (const day of [-48577, -42886, 0, 19500]) {
    const displayed = spaceToViewerTime(day, 'civil_day_since_1970');
    assert.ok(Math.abs(viewerToSpaceTime(displayed, 'civil_day_since_1970') - day) < 1e-8);
  }
  assert.equal(spaceToViewerTime(2022.7, 'year'), 2022.7);
  assert.equal(viewerToSpaceTime(8, 'hour'), 8);
});

test('Events are placed only where the model says they happen, with their notes, passages and causal links', () => {
  const model = harbour();
  const event = (id, extra = {}) => ({ id, boundary: id, interval: { start: 2, end: 3 }, provenance, ...extra });
  model.meaning_model.events.push(
    event('boat.run', { process_ids: ['boat.position.x'] }),
    event('ferry.docks', { interval: { start: 5, end: 6 } }),
    event('pier.meeting', { interval: { start: 7, end: 8 } }),
    event('rumour', { region: 'the Red Buoy, people say' }));
  model.meaning_model.event_referent_bindings.push(
    { id: 'at.ferry', target: { kind: 'event', event_id: 'ferry.docks' }, role: 'setting', referent_id: 'thing.ferry', binding_type: 'located_in', provenance },
    { id: 'at.pier', target: { kind: 'event', event_id: 'pier.meeting' }, role: 'setting', referent_id: 'thing.pier', binding_type: 'located_in', provenance });
  model.meaning_model.event_relations = [{ id: 'run-docks', kind: 'causes', source_event_id: 'boat.run', target_event_id: 'ferry.docks', provenance }];
  const graph = { nodes: [{ id: 'chapter.1', node_type: 'chapter', role: 'story_passage', text: 'The boat ran.' }, { id: 'note.1', node_type: 'understanding.observation', text: 'Why it ran.' }],
    edges: [{ id: 'r', source: { kind: 'node', node_id: 'chapter.1' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'boat.run' }, relation: 'renders' },
      { id: 'n', source: { kind: 'node', node_id: 'note.1' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'boat.run' }, relation: 'about' }] };
  const space = spaceModel(model), placement = placedEvents(model, graph, space.frames);
  const byId = Object.fromEntries(placement.events.map((item) => [item.id, item]));
  assert.deepEqual(Object.keys(byId).sort(), ['boat.run', 'ferry.docks'], 'the pier has no position and the rumour only names a place in words');
  assert.equal(byId['boat.run'].via, 'position'); assert.equal(byId['boat.run'].objects.length, 1);
  assert.equal(byId['ferry.docks'].via, 'place'); assert.equal(byId['ferry.docks'].placeId, 'thing.ferry');
  assert.deepEqual([byId['boat.run'].passages.map((item) => item.node.id), byId['boat.run'].notes.map((item) => item.node.id)], [['chapter.1'], ['note.1']]);
  assert.deepEqual(placement.causal.map((relation) => relation.id), ['run-docks']);
  assert.equal(placement.unplaced, model.meaning_model.events.length - 2);
});
