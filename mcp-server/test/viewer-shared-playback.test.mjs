import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');

test('retained temporal playback listeners cannot play or scrub while another representation owns the bar', () => {
  const handlers = new Map(), calls = [];
  const node = (id) => ({
    addEventListener(type, fn) { handlers.set(`${id}:${type}`, fn); },
    getBoundingClientRect() { return { left: 0, width: 100 }; },
    setPointerCapture() { calls.push('capture'); },
  });
  const play = node('play'), track = node('track');
  const context = { document: { getElementById: (id) => id === 'play' ? play : track }, temporalActive: false, playing: false,
    stop: () => calls.push('stop'), play: () => calls.push('play'), apply: () => calls.push('apply'), syncURL: () => calls.push('url'),
    building: () => false, F: { a: 10, b: 20 }, now: 10, atEnd: false };
  vm.createContext(context);
  const start = source.indexOf("document.getElementById('play').addEventListener('click'");
  const end = source.indexOf('// ---- the camera:', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  handlers.get('play:click')();
  handlers.get('track:pointerdown')({ clientX: 50, pointerId: 1 });
  handlers.get('track:pointermove')({ clientX: 70, pointerId: 1 });
  handlers.get('track:pointerup')();
  assert.deepEqual(calls, []);
  assert.equal(context.now, 10);
  context.temporalActive = true;
  handlers.get('play:click')();
  handlers.get('track:pointerdown')({ clientX: 50, pointerId: 1 });
  assert.equal(context.now, 15);
  assert.deepEqual(calls, ['play', 'stop', 'capture', 'apply']);
});


test('Space whole-life overview exports its actual cursor, not a command to jump to the temporal window end', () => {
  const spaceSource = readFileSync(new URL('../viewer/public/space-view.js', import.meta.url), 'utf8');
  const method = spaceSource.match(/getState\(\) \{ return \{ space:[^\n]+/u)?.[0];
  assert.ok(method);
  const context = { t: 2020.55, space: { timeUnit: 'year' }, frameIndex: 0, focus: '', overview: true, spaceToViewerTime: (time) => time,
    cameraState: () => ({}), spaceFrameIdentity: () => null, camera: {}, controls: {} };
  vm.createContext(context); vm.runInContext(`this.saved = ({${method}}).getState();`, context);
  assert.equal(context.saved.space.overview, true);
  assert.equal(context.saved.time.now, 2020.55);
  assert.equal(context.saved.time.atEnd, false);
});
