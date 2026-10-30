import test from 'node:test';
import assert from 'node:assert/strict';
import { passDragsToCanvas, watchFingerDrag } from '../viewer/public/scene-touch.js';

const pointer = (type, fields = {}) => Object.assign(new Event(type), { pointerId: 1, clientX: 0, clientY: 0, pointerType: 'touch', ...fields });
function dragSetup() {
  const layer = new EventTarget(), canvas = new EventTarget(), target = new EventTarget(), handed = [];
  canvas.addEventListener('pointerdown', (event) => handed.push(event));
  passDragsToCanvas(layer, canvas, { target, press: (down) => pointer('pointerdown', { pointerId: down.pointerId, clientX: down.clientX, clientY: down.clientY }) });
  return { layer, target, handed };
}

test('a press on a label that moves is handed to the canvas once, where it began', () => {
  const { layer, target, handed } = dragSetup();
  layer.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 50 }));
  target.dispatchEvent(pointer('pointermove', { clientX: 102, clientY: 51 }));
  assert.equal(handed.length, 0, 'a press that has barely moved stays the label\'s');
  target.dispatchEvent(pointer('pointermove', { clientX: 110, clientY: 50 }));
  target.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 50 }));
  assert.equal(handed.length, 1);
  assert.equal(handed[0].clientX, 100);
});

test('a press on a label that lifts where it was is never handed on', () => {
  const { layer, target, handed } = dragSetup();
  layer.dispatchEvent(pointer('pointerdown'));
  target.dispatchEvent(pointer('pointerup'));
  target.dispatchEvent(pointer('pointermove', { clientX: 90 }));
  assert.equal(handed.length, 0);
});

test('another pointer moving does not hand on a press', () => {
  const { layer, target, handed } = dragSetup();
  layer.dispatchEvent(pointer('pointerdown'));
  target.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 90 }));
  assert.equal(handed.length, 0);
});

function fingerSetup() {
  const canvas = new EventTarget(), target = new EventTarget(), changes = [], timers = [];
  watchFingerDrag(canvas, (on) => changes.push(on), { target, later: (run) => { timers.push(run); return timers.length; }, cancel: (id) => { if (id) timers[id - 1] = null; } });
  return { canvas, target, changes, fire: () => { for (const run of timers.splice(0)) run?.(); } };
}

test('a finger that moves starts a drag, and the drag ends a moment after it lifts', () => {
  const { canvas, target, changes, fire } = fingerSetup();
  canvas.dispatchEvent(pointer('pointerdown'));
  assert.deepEqual(changes, []);
  target.dispatchEvent(pointer('pointermove', { clientX: 20 }));
  assert.deepEqual(changes, [true]);
  target.dispatchEvent(pointer('pointerup'));
  assert.deepEqual(changes, [true], 'the glide after a flick still counts');
  fire();
  assert.deepEqual(changes, [true, false]);
});

test('a tap is no drag, and a mouse never is', () => {
  const { canvas, target, changes } = fingerSetup();
  canvas.dispatchEvent(pointer('pointerdown'));
  target.dispatchEvent(pointer('pointermove', { clientX: 3 }));
  target.dispatchEvent(pointer('pointerup'));
  canvas.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
  target.dispatchEvent(pointer('pointermove', { clientX: 90, pointerType: 'mouse' }));
  assert.deepEqual(changes, []);
});

test('a drag lasts until the last finger lifts, and a new finger keeps it going', () => {
  const { canvas, target, changes, fire } = fingerSetup();
  canvas.dispatchEvent(pointer('pointerdown', { pointerId: 1 }));
  canvas.dispatchEvent(pointer('pointerdown', { pointerId: 2 }));
  target.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 40 }));
  target.dispatchEvent(pointer('pointerup', { pointerId: 2 }));
  fire();
  assert.deepEqual(changes, [true], 'one finger is still down');
  target.dispatchEvent(pointer('pointerup', { pointerId: 1 }));
  canvas.dispatchEvent(pointer('pointerdown', { pointerId: 3 }));
  fire();
  assert.deepEqual(changes, [true], 'a finger came back before the drag ended');
});
