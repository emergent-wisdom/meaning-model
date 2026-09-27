// Telling a pick from moving the view: only the main button, with no modifier key, one pointer and no drag, picks.
// Turning, panning or pinching a 3D view never selects anything.
export function onPlainClick(element, pick, { signal, slop = 5 } = {}) {
  const pointers = new Set(); let down = null, clickReady = false;
  const modified = (event) => event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
  const plain = (event) => event.button === 0 && !modified(event);
  element.addEventListener('pointerdown', (event) => {
    // A primary pointer starts a new gesture, so a release lost outside the window cannot hold a stale one.
    if (event.isPrimary !== false) pointers.clear();
    pointers.add(event.pointerId); clickReady = false;
    down = pointers.size === 1 && plain(event) ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }, { signal });
  element.addEventListener('pointermove', (event) => {
    // Returning to the starting point does not turn a drag back into a click.
    if (down && event.pointerId === down.id && (modified(event) || Math.hypot(event.clientX - down.x, event.clientY - down.y) > slop)) down = null;
  }, { signal });
  element.addEventListener('pointerup', (event) => {
    pointers.delete(event.pointerId);
    clickReady = Boolean(down && event.pointerId === down.id && plain(event) && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= slop); down = null;
  }, { signal });
  element.addEventListener('click', (event) => {
    // Keep the native click's detail, including its double-click count.
    const ready = clickReady; clickReady = false;
    if (ready && plain(event)) pick(event);
  }, { signal });
  element.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); down = null; clickReady = false; }, { signal });
}
