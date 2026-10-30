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

// Whether a finger is dragging the scene: from when a finger on the canvas has moved until a moment after the last one
// lifts, so that a flick's glide is drawn as lightly as the drag. A tap never counts, and a mouse never does.
export function watchFingerDrag(canvas, onChange, { target = globalThis, slop = 6, linger = 250, later = setTimeout, cancel = clearTimeout } = {}) {
  const fingers = new Map(); let dragging = false, timer = null;
  const set = (on) => { if (on !== dragging) { dragging = on; onChange(on); } };
  canvas.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'touch') return; fingers.set(event.pointerId, [event.clientX, event.clientY]); cancel(timer); });
  target.addEventListener('pointermove', (event) => { const at = fingers.get(event.pointerId); if (at && Math.hypot(event.clientX - at[0], event.clientY - at[1]) > slop) set(true); });
  for (const type of ['pointerup', 'pointercancel']) target.addEventListener(type, (event) => { if (fingers.delete(event.pointerId) && !fingers.size && dragging) timer = later(() => set(false), linger); });
}
