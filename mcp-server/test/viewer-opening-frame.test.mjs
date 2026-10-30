import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../viewer/public/vendor/three/three.core.js';
import { readFileSync } from 'node:fs';
import { openingFrame, openingDirection, deepness, coverage, axisShown, fitBox, cameraMoved } from '../viewer/public/opening-frame.js';

// The time views' field: time along x, rows along z with the front at z1. The usual direction is the one the view has
// always opened from; the rooms are the free parts of a wide and of a tall screen, in normalised coordinates.
const usual = new THREE.Vector3(-0.05, 0.4, 0.92).normalize();
const wide = { aspect: 1.6, room: { left: -0.94, right: 0.44, top: 0.67, bottom: -0.75 } };
const tall = { aspect: 0.46, room: { left: -0.79, right: 0.79, top: 0.45, bottom: -0.67 } };
const field = (rows) => ({ x0: -59.2, x1: 59.2, y0: -4, y1: 30, z0: -(rows * 2.7) / 2 - 8, z1: (rows * 2.7) / 2 + 9 });
const open = (box, screen) => openingFrame(THREE, { box, usual, fov: 40, ...screen });
const corners = (b) => [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].flatMap((y) => [b.z0, b.z1].map((z) => new THREE.Vector3(x, y, z))));
function inRoom(frame, box, { aspect, room }) {
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 1e6); camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld();
  return corners(box).every((corner) => { const p = corner.project(camera); return p.x >= room.left - 1e-6 && p.x <= room.right + 1e-6 && p.y >= room.bottom - 1e-6 && p.y <= room.top + 1e-6; });
}
const center = (b) => new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
const whole = (box, direction, screen) => fitBox(THREE, { corners: corners(box), center: center(box), direction, fov: 40, ...screen });
const azimuth = (direction) => Math.atan2(direction.x, direction.z), elevation = (direction) => Math.asin(direction.y / direction.length());

test('a field no deeper than it is long opens whole, from the usual side, never lower than the usual height', () => {
  for (const rows of [4, 30]) for (const screen of [wide, tall]) {
    const box = field(rows); assert.equal(deepness(box), 0);
    const frame = open(box, screen);
    assert.equal(frame.kind, 'whole');
    assert.ok(Math.abs(azimuth(frame.direction) - azimuth(usual)) < 1e-9, 'it does not turn');
    assert.ok(elevation(frame.direction) >= elevation(usual) - 1e-9 && elevation(frame.direction) <= (60 * Math.PI) / 180 + 1e-9);
    assert.ok(inRoom(frame, box, screen), 'all of it is in the room: a small field is not enlarged past it');
  }
});

test('a shallow field whose picture is flatter than a tall room is seen from higher up, and covers more of it', () => {
  const box = field(30), frame = open(box, tall), level = whole(box, usual, tall);
  assert.ok(elevation(frame.direction) > elevation(usual) + 0.2, 'the camera rises');
  assert.ok(frame.covered > coverage(THREE, { box, position: level.position, target: level.target, fov: 40, ...tall }) + 0.05);
  // A few rows as tall as they are deep gain nothing from rising, and keep the usual height.
  const few = field(4), still = open(few, tall);
  assert.ok(Math.abs(elevation(still.direction) - elevation(usual)) < 1e-9);
});

test('a field four times as deep as long turns so that its rows run along the room\'s diagonal, across a wide room and up a tall one', () => {
  const box = field(240); assert.equal(deepness(box), 1);
  for (const screen of [wide, tall]) {
    const direction = openingDirection(THREE, { box, usual, ...screen });
    assert.ok(Math.abs(elevation(direction) - (32 * Math.PI) / 180) < 1e-9);
    // Seen from azimuth A and elevation E the rows run up the screen at an angle whose tangent is sin E / tan A.
    const slope = Math.sin(elevation(direction)) / Math.tan(azimuth(direction));
    const diagonal = (screen.room.top - screen.room.bottom) / ((screen.room.right - screen.room.left) * screen.aspect);
    assert.ok(Math.abs(slope - diagonal) < 1e-9, 'the rows run along the room\'s diagonal');
  }
  assert.ok(azimuth(openingDirection(THREE, { box, usual, ...tall })) < azimuth(openingDirection(THREE, { box, usual, ...wide })), 'a tall room sees the rows more from the front');
});

test('a deep field comes in until it fills three quarters of the room, keeping a seventh of its front row\'s time axis', () => {
  for (const screen of [wide, tall]) {
    const box = field(240), frame = open(box, screen);
    const view = { box, position: frame.position, target: frame.target, fov: 40, ...screen };
    assert.equal(frame.kind, 'fills');
    assert.ok(Math.abs(coverage(THREE, view) - 0.75) < 0.01, `covers ${coverage(THREE, view)}`);
    assert.ok(axisShown(THREE, view) >= 1 / 7);
    assert.ok(frame.distance < whole(box, frame.direction, screen).distance, 'nearer than the whole field framed from the same side');
    assert.ok(!inRoom(frame, box, screen), 'the rows run on off the screen');
  }
});

test('the deeper the field, the further it turns, and a field only a little deeper keeps most of its usual side', () => {
  const turns = [60, 90, 140, 240].map((rows) => azimuth(openingDirection(THREE, { box: field(rows), usual, ...wide })));
  for (let i = 1; i < turns.length; i += 1) assert.ok(turns[i] > turns[i - 1]);
  const slight = openingDirection(THREE, { box: field(48), usual, ...wide });
  assert.ok(Math.abs(azimuth(slight) - azimuth(usual)) < 0.1);
});

test('the address names a camera only when the reader has moved it from where the viewer placed it', () => {
  const placed = { position: new THREE.Vector3(10, 20, 30), target: new THREE.Vector3(1, 2, 3) };
  assert.equal(cameraMoved(placed.position.clone(), placed.target.clone(), placed), false);
  assert.equal(cameraMoved(new THREE.Vector3(10, 20, 31), placed.target.clone(), placed), true);
  assert.equal(cameraMoved(placed.position.clone(), new THREE.Vector3(1, 2, 4), placed), true);
});

test('the view rewrites the address once it has placed the opening camera, and remembers where it placed it', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  assert.match(source, /framesDrawn === 2 && opt\.camera === 'free' && !posed\) \{ fitFree\(\); syncURL\(\); \}/);
  assert.match(source, /placed = \{ position: camera\.position\.clone\(\), target: controls\.target\.clone\(\) \}/);
  assert.match(source, /placed && cameraMoved\(camera\.position, controls\.target, placed\)\) next\.set\('pose'/);
  assert.match(source, /let placed = params\.has\('pose'\) \? HOME : null;/);
});
