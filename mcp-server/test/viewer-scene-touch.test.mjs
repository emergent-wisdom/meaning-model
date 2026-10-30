import test from 'node:test';
import assert from 'node:assert/strict';
import { passDragsToCanvas } from '../viewer/public/scene-touch.js';

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
