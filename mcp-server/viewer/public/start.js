import { loadData } from './common.js';
import { showInspector } from './inspector.js';
import { mountModelPicker } from './model-picker.js';
import { createViewerSession } from './viewer-session.js';

const labels = { together: 'Processes', layers: 'Tree', terrain: 'Terrain', graph: 'Graph', structure: 'Structure', space: 'Space' };
const timeViews = new Set(['together', 'layers', 'terrain']);
const params = new URLSearchParams(location.search);
let notice = null, data = null, dataName = null;
try { ({ data, name: dataName } = await loadData(params)); } catch (error) { notice = `The model snapshot could not be opened: ${error.message}`; }
const temporal = Boolean(data && (data.capabilities?.temporal ?? data.capabilities?.trajectories ?? data.viewKind === 'timeline'));
const requested = params.get('view');
const initialView = !data ? 'structure' : labels[requested] ? requested : temporal ? data.capabilities?.trajectories ? 'together' : 'layers' : 'graph';

for (const element of document.querySelectorAll('#scene, #stats, .caption, #strip, .bar, #labels2, #legend, #details, #tip, #reader, #qr-panel, #sub, #repos')) element.dataset.temporal = '';
for (const element of document.getElementById('tools').children) {
  if (!element.querySelector?.('[data-pop="pop-show"]') && !['story', 'coarse-view', 'recenter-view', 'graph-controls', 'space-controls'].includes(element.id)) element.dataset.temporal = '';
}
const structureHost = document.createElement('div'); structureHost.id = 'structure-surface'; document.body.append(structureHost);
function fitPanels() {
  for (const panel of document.querySelectorAll('.pop:not([hidden]), .details:not([hidden])')) panel.style.maxHeight = `${Math.max(0, innerHeight - panel.getBoundingClientRect().top - 12)}px`;
  const title = document.querySelector('.title').getBoundingClientRect(), tools = document.getElementById('tools').getBoundingClientRect(), visibility = document.getElementById('toolbar-visibility').getBoundingClientRect();
  structureHost.style.top = `${Math.max(title.bottom, tools.bottom, visibility.bottom) + 12}px`;
}
let openPanel = null;
function togglePanel(id) {
  openPanel = openPanel === id ? null : id;
  for (const panel of document.querySelectorAll('.pop')) panel.hidden = panel.id !== openPanel;
  for (const button of document.querySelectorAll('.tool[data-pop]')) button.classList.toggle('open', button.dataset.pop === openPanel);
  fitPanels();
}
for (const button of document.querySelectorAll('.tool[data-pop]')) button.addEventListener('click', () => togglePanel(button.dataset.pop));
const toolbar = document.getElementById('tools'), toolbarVisibility = document.getElementById('toolbar-visibility');
toolbarVisibility.addEventListener('click', () => {
  if (openPanel) togglePanel(openPanel);
  toolbar.hidden = !toolbar.hidden;
  toolbarVisibility.textContent = toolbar.hidden ? 'Show controls' : 'Hide controls';
  toolbarVisibility.setAttribute('aria-expanded', String(!toolbar.hidden));
  fitPanels();
  dispatchEvent(new Event('viewer-controls-change'));
});
document.addEventListener('pointerdown', (event) => { if (openPanel && !event.target.closest?.('.tool-wrap')) togglePanel(openPanel); });
addEventListener('keydown', (event) => { if (event.key === 'Escape' && openPanel) togglePanel(openPanel); });
addEventListener('resize', fitPanels);

function graphParts() {
  const surface = document.createElement('div'); surface.id = 'graph-surface'; surface.dataset.graph = '';
  const host = document.createElement('div'); host.id = 'graph-scene'; surface.append(host); document.body.append(surface);
  const copy = (id) => {
    const node = document.getElementById(id).cloneNode(true); node.hidden = true; delete node.dataset.temporal; node.dataset.graph = '';
    node.id = `graph-${id}`; for (const child of node.querySelectorAll('[id]')) child.id = `graph-${child.id}`;
    return node;
  };
  const detail = copy('details'); detail.querySelector('#graph-details-body').classList.add('details-body'); document.getElementById('side').append(detail);
  const reader = copy('reader'); document.body.append(reader);
  return { surface, host, detail, reader, tools: document.getElementById('graph-controls') };
}
// The physical view has its own scene, details and controls, shown only while it is the representation.
function spaceParts() {
  const surface = document.createElement('div'); surface.id = 'space-surface'; surface.dataset.space = '';
  const host = document.createElement('div'); host.id = 'space-scene'; surface.append(host); document.body.append(surface);
  const detail = document.getElementById('details').cloneNode(true); detail.hidden = true; delete detail.dataset.temporal; detail.dataset.space = '';
  detail.id = 'space-details'; for (const child of detail.querySelectorAll('[id]')) child.id = `space-${child.id}`;
  detail.querySelector('#space-details-body').classList.add('details-body'); document.getElementById('side').append(detail);
  return { surface, host, detail, tools: document.getElementById('space-controls') };
}
let selection = null;
try { const value = JSON.parse(params.get('record') ?? 'null'); if (value && typeof value.kind === 'string' && typeof value.id === 'string') selection = value; } catch { /* An invalid UI selection does not change the snapshot. */ }
const session = createViewerSession({
  temporal, initialView, state: { selection, timeView: params.get('timeView') },
  mounts: {
    temporal: async () => (await import('./view.js')).temporalController,
    graph: async () => {
      const { showGraph } = await import('./graph-view.js'), parts = graphParts();
      try { return showGraph(data, { ...parts, onSelect: (record) => session.selectRecord(record) }); }
      catch (error) { parts.surface.remove(); parts.detail.remove(); parts.reader.remove(); parts.tools.replaceChildren(); throw error; }
    },
    structure: async () => showInspector(data, notice, { host: structureHost, onSelect: (record) => session.selectRecord(record) }),
    space: async () => {
      const { showSpace } = await import('./space-view.js'), parts = spaceParts();
      try { return showSpace(data, { ...parts, onSelect: (record) => session.selectRecord(record) }); }
      catch (error) { parts.surface.remove(); parts.detail.remove(); parts.tools.replaceChildren(); throw error; }
    },
  },
  onView(view) {
    document.body.dataset.representation = timeViews.has(view) ? 'temporal' : view;
    document.body.classList.toggle('graph-mode', view === 'graph'); document.body.classList.toggle('space-mode', view === 'space'); document.body.classList.remove('graph-selection');
    document.body.classList.toggle('details-open', timeViews.has(view) && !document.getElementById('details').hidden);
    document.getElementById('t-show').textContent = labels[view];
    const recenter = document.getElementById('recenter-view'); recenter.hidden = view === 'structure'; recenter.disabled = !data || view === 'structure';
    document.querySelector('.eyebrow').textContent = `Meaning Model · ${labels[view]}`;
    document.getElementById('title').textContent = data?.title ?? 'Meaning Model'; document.title = data?.title ?? 'Meaning Model';
    for (const button of document.querySelectorAll('#layouts button')) { button.classList.toggle('on', button.dataset.layout === view); button.setAttribute('aria-pressed', String(button.dataset.layout === view)); }
    if (!timeViews.has(view)) document.getElementById('layout-note').textContent = view === 'graph' ? 'Declared records and relationships. Position is a layout, not time or a measured distance.'
      : view === 'space' ? 'Declared coordinates, to scale, in the model\'s own reference frames. Only records with a declared position are placed.'
      : 'Declared Event containment, process decomposition and Cuts. The same snapshot, selection and time position are retained.';
    fitPanels();
  },
  onState(state) {
    const url = new URL(location.href); url.searchParams.set('view', state.view);
    if (state.timeView) url.searchParams.set('timeView', state.timeView);
    if (state.selection) url.searchParams.set('record', JSON.stringify(state.selection)); else url.searchParams.delete('record');
    url.searchParams.delete('visualView'); history.replaceState(null, '', url);
    const status = document.getElementById('selection-label'); status.hidden = !state.selection; status.textContent = state.selection ? `Selected ${state.selection.kind.replace(/_/g, ' ')}: ${state.selection.id}` : '';
  },
});
const opened = new Set();
async function switchView(view) {
  const key = timeViews.has(view) ? 'temporal' : view;
  if (data && !opened.has(key)) {
    // A representation is built the first time it is shown, which can take a moment: say so before the work starts.
    document.getElementById('t-show').textContent = `Opening ${labels[view] ?? view}…`; document.body.setAttribute('aria-busy', 'true');
    await new Promise((done) => { const timer = setTimeout(done, 60); globalThis.requestAnimationFrame?.(() => setTimeout(() => { clearTimeout(timer); done(); }, 0)); });
  }
  try { const state = await session.setView(view); opened.add(key); return state; }
  catch (error) { console.error(error); notice = 'The 3D view is unavailable in this browser. The recorded model is available below.'; return session.setView('structure'); }
  finally { document.body.setAttribute('aria-busy', 'false'); }
}
window.modelViewer = { switchView, selectRecord: (record) => session.selectRecord(record), getState: () => session.snapshot(), getSnapshot: () => ({ name: dataName, data }) };
for (const button of document.querySelectorAll('#layouts button')) {
  button.disabled = !data || (timeViews.has(button.dataset.layout) && !temporal);
  if (!temporal && timeViews.has(button.dataset.layout)) button.title = 'This snapshot has no declared time axis for this representation.';
  button.addEventListener('click', () => switchView(button.dataset.layout));
}
const coarseButton = document.getElementById('coarse-view');
coarseButton.disabled = !temporal;
// The coarse overview is the least detail of the time view being looked at; only a view without detail opens the tree.
coarseButton.addEventListener('click', async () => {
  const current = session.snapshot().view;
  await switchView(['together', 'layers'].includes(current) ? current : 'layers');
  if (['together', 'layers'].includes(session.snapshot().view)) (await import('./view.js')).temporalController.setDetail(0);
});
const recenterButton = document.getElementById('recenter-view');
recenterButton.addEventListener('click', () => session.recenter());
addEventListener('keydown', (event) => {
  if (event.key !== 'Home' || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (recenterButton.hidden || recenterButton.disabled || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
  const reader = document.getElementById(session.snapshot().view === 'graph' ? 'graph-reader' : 'reader');
  if (reader && !reader.hidden) return;
  event.preventDefault(); session.recenter();
});
addEventListener('pagehide', (event) => { if (!event.persisted) session.destroy(); });
await mountModelPicker();
await switchView(initialView);
