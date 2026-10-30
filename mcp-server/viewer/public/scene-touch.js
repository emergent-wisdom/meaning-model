// How the scene's labels meet a pointer. Nothing here depends on what the labels say or what the scene shows.

// A drag that starts on a name in the scene moves the view as one that starts beside it does. A press that stays put stays
// the name's (its click, its tooltip): only once the pointer has moved is the press handed to the canvas, which captures
// the pointer from there on.
export function passDragsToCanvas(layer, canvas, { target = globalThis, slop = 5, press = (down) => new PointerEvent('pointerdown', down) } = {}) {
  const presses = new Map();
  layer.addEventListener('pointerdown', (event) => presses.set(event.pointerId, event));
  target.addEventListener('pointermove', (event) => {
    const down = presses.get(event.pointerId); if (!down) return;
    if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < slop) return;
    presses.delete(event.pointerId); canvas.dispatchEvent(press(down));
  });
  for (const type of ['pointerup', 'pointercancel']) target.addEventListener(type, (event) => presses.delete(event.pointerId));
}
