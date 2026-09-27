// One snapshot, several retained presentations. Mounts happen once; only the
// active presentation runs. Native selection and the time cursor are shared.
export function createViewerSession({ temporal, initialView, state = {}, mounts, onView = () => {}, onState = () => {} }) {
  const timeViews = new Set(['together', 'layers', 'terrain']);
  const normalize = (view) => timeViews.has(view) ? temporal ? view : 'graph' : ['graph', 'structure', 'space'].includes(view) ? view : temporal ? 'together' : 'graph';
  const shared = { ...state, view: normalize(initialView) }, mounted = new Map();
  let current = null, activeView = null, request = 0;
  const snapshot = () => structuredClone({ ...shared, ...(current?.getState?.() ?? {}) });
  async function setView(requested) {
    const view = normalize(requested), id = ++request;
    if (activeView === view) return snapshot();
    const key = timeViews.has(view) ? 'temporal' : view;
    if (!mounted.has(key)) mounted.set(key, Promise.resolve().then(() => mounts[key]()).catch((error) => { mounted.delete(key); throw error; }));
    const next = await mounted.get(key);
    if (id !== request) return snapshot();
    if (current) Object.assign(shared, current.getState?.() ?? {});
    if (current !== next) current?.deactivate?.();
    current = next; activeView = view; shared.view = view;
    if (timeViews.has(view)) shared.timeView = view;
    // The incoming surface still holds defaults (or an older retained state).
    // Restore the captured shared state before reading its current state.
    onView(view, structuredClone(shared));
    await next.activate?.(view, structuredClone(shared));
    onState(snapshot());
    return snapshot();
  }
  return {
    setView, snapshot,
    recenter() { return current?.recenter?.(); },
    coarse() { return current?.coarse?.(); },
    selectRecord(selection) { shared.selection = selection ? { kind: selection.kind, id: selection.id } : null; onState(snapshot()); },
    destroy() { request += 1; current?.deactivate?.(); for (const promise of mounted.values()) promise.then((surface) => surface.destroy?.()); mounted.clear(); current = null; activeView = null; },
  };
}
