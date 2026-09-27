// Telling a pick from moving the view: only the main button, with no modifier key, one pointer and no drag, picks.
// Turning, panning or pinching a 3D view never selects anything.
export function onPlainClick(element, pick, { signal, slop = 5 } = {}) {
  const pointers = new Set(); let down = null;
  const plain = (event) => event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
  element.addEventListener('pointerdown', (event) => {
    // A primary pointer starts a new gesture, so a release lost outside the window cannot hold a stale one.
    if (event.isPrimary !== false) pointers.clear();
    pointers.add(event.pointerId); down = pointers.size === 1 && plain(event) ? { x: event.clientX, y: event.clientY } : null;
  }, { signal });
  element.addEventListener('pointerup', (event) => {
    pointers.delete(event.pointerId);
    const click = down && plain(event) && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= slop; down = null;
    if (click) pick(event);
  }, { signal });
  element.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); down = null; }, { signal });
}
