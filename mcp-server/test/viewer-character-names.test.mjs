import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIG_NAMES_FROM, NAME_SETTINGS, bigNamesOn, namePlace, nameHeight, screenHeight } from '../viewer/public/character-names.js';
import { VIEW_SETTINGS, viewSettingsProblems, settingsAt } from '../viewer/public/view-settings.js';

test('big names follow the setting, and without one turn on once many processes show on two or more groups', () => {
  assert.deepEqual(NAME_SETTINGS, ['big', 'small']);
  assert.equal(bigNamesOn('big', { rows: 1, groups: 1 }), true);
  assert.equal(bigNamesOn('small', { rows: 80, groups: 4 }), false);
  assert.equal(bigNamesOn('auto', { rows: BIG_NAMES_FROM, groups: 2 }), true);
  assert.equal(bigNamesOn('auto', { rows: BIG_NAMES_FROM - 1, groups: 4 }), false, 'a few rows keep their small labels');
  assert.equal(bigNamesOn('auto', { rows: 60, groups: 1 }), false, 'one group needs no names to tell it apart');
  assert.equal(bigNamesOn(undefined), false);
});

test("a group's name stands halfway across its rows' depth, over the middle of the time window", () => {
  assert.deepEqual(namePlace([-12, -3, 6]), { x: 0, z: -3, depth: 18 });
  assert.deepEqual(namePlace([4]), { x: 0, z: 4, depth: 0 });
  assert.equal(namePlace([]), null);
  assert.equal(namePlace([NaN, undefined]), null);
});

test('every name has one height, from the typical group, within limits', () => {
  assert.equal(nameHeight([20, 30, 100]), 9, 'the middle depth, not the deepest group');
  assert.equal(nameHeight([400, 500, 600]), 12);
  assert.equal(nameHeight([1, 2]), 3.5);
  assert.equal(nameHeight([]), 3.5);
});

test('on screen a name stays between a floor and a ceiling of the screen height', () => {
  const fov = 40, pixels = 1000;
  const perUnit = (distance) => pixels / (2 * distance * Math.tan((fov * Math.PI) / 360));
  const shown = (height, distance) => screenHeight(height, { distance, fov, pixels }) * perUnit(distance);
  assert.ok(Math.abs(shown(10, 2000) - 45) < 1e-9, 'far away it grows to the floor');
  assert.ok(Math.abs(shown(10, 20) - 110) < 1e-9, 'close up it shrinks to the ceiling');
  const middle = 10 * perUnit(150); assert.ok(middle > 45 && middle < 110);
  assert.ok(Math.abs(shown(10, 150) - middle) < 1e-9, 'in between it keeps its own size');
  assert.equal(screenHeight(10, { distance: 0, fov, pixels }), 10, 'without a camera distance the height is kept');
});

test('a view can choose big or small names, and Everything keeps the choice', () => {
  assert.ok('names' in VIEW_SETTINGS);
  assert.deepEqual(viewSettingsProblems({ names: 'big' }), []);
  assert.deepEqual(viewSettingsProblems({ names: 'small' }), []);
  assert.deepEqual(viewSettingsProblems({ names: 'huge' }), ['names=huge must be one of big, small.']);
  const view = { settings: { names: 'big', show: 'processes' }, levels: [] };
  assert.equal(settingsAt(view, 0).names, 'big');
  assert.equal(settingsAt(view, 1).names, 'big', 'Everything shows every record, in the names the view chose');
});

test('the viewer reads names from its address, writes it back, and offers a switch', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  assert.match(source, /names: \['big', 'small'\]\.includes\(params\.get\('names'\)\) \? params\.get\('names'\) : 'auto'/);
  assert.match(source, /if \(opt\.names !== 'auto'\) next\.set\('names', opt\.names\);/);
  assert.match(source, /namesButton\.id = 'big-names'/);
  assert.match(source, /syncBigNames\(\);/);
});
