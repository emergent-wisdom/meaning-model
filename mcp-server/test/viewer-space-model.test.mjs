import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulationService } from '../src/service.mjs';
import { spaceModel, positionAt, timeSpan, planeOf } from '../viewer/public/space-model.js';

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
  assert.deepEqual(settings.map((setting) => [setting.name, setting.events.map((event) => event.id), setting.who]), [['The Old Pier', ['harbour.boarding'], ['Ines Berg']]]);
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
