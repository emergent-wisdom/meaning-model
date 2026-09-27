import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulationService } from '../src/service.mjs';
import { spaceModel, positionAt } from '../viewer/public/space-model.js';

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
