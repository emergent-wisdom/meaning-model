import { loadData } from './common.js';
import { showInspector } from './inspector.js';
import { mountModelPicker } from './model-picker.js';
import { defaultViewURL, forgetSavedView } from './default-view.js';
import { createViewerSession } from './viewer-session.js';
import { takeLiveContext, mountLiveViewer } from './live-viewer.js';
import { openingView } from './view-settings.js';
import { mountChosenView, noteAddress } from './chosen-view.js';
import { mountSearch } from './search.js';
import { parseTimeQuery } from './time-query.js';
import { isCalendarTime } from './temporal-layout.js';
import { whenPart, whenAllParts } from './snapshot-format.js';

// A branch of the model is hypothetical: say so above everything it shows, with the premise it assumes.
function showBranch(branch) {
  const banner = document.getElementById('branch-banner'); if (!banner) return;
  banner.hidden = !branch; if (!branch) { banner.replaceChildren(); return; }
  const kind = branch.kind === 'counterfactual' ? 'A changed past, not what happened' : 'A possible future, not what happened';
  let odds = Number.isFinite(branch.probability) ? ` Probability ${branch.probability}${branch.windowStated === false ? ' is a guess; the forecast window was not stated' : ' as forecast'}.` : '';
  if (Number.isFinite(branch.joint) && (branch.joint !== branch.probability || branch.jointIncludesGuess)) {
    odds += ` Joint probability ${branch.joint} with the branches it lies in${branch.jointIncludesGuess ? ' includes a guess' : ''}.`;
  }
  const title = document.createElement('strong'); title.textContent = kind;
  banner.replaceChildren(title, `Branch ${branch.key} of ${branch.stageId}${branch.premise ? `: it assumes that ${branch.premise.replace(/^[A-Z]/u, (letter) => letter.toLowerCase()).replace(/\.$/u, '')}.` : '.'}${odds}`);
}

const labels = { together: 'Processes', layers: 'Tree', terrain: 'Terrain', chart: 'Chart', graph: 'Graph', structure: 'Structure', space: 'Space' };
const timeViews = new Set(['together', 'layers', 'terrain']);
const params = new URLSearchParams(location.search);
let notice = null, data = null, dataName = null;
try { ({ data, name: dataName } = await loadData(params)); } catch (error) { notice = `The model snapshot could not be opened: ${error.message}`; }
// The view the model chose opens unless the reader has chosen: the address is rewritten before any view reads it.
const opening = openingView(location.href, data?.views ?? []);
if (opening.href !== location.href) {
  history.replaceState(null, '', opening.href);
  for (const key of [...params.keys()]) params.delete(key);
  for (const [key, value] of new URL(opening.href).searchParams) params.append(key, value);
}
const temporal = Boolean(data && (data.capabilities?.temporal ?? data.capabilities?.trajectories ?? data.viewKind === 'timeline'));
const liveContext = data?.viewerLive?.mode === 'live' ? takeLiveContext() : null;
const restoredState = { ...liveContext?.state };
if (opening.state === 'changed' && restoredState.time?.mode !== (params.get('mode') ?? 'story')) delete restoredState.time;
// A newly chosen view changes the presentation; the saved live context still carries the reader's selection and time.
const requested = opening.state === 'changed' ? params.get('view') : restoredState.view ?? params.get('view');
const initialView = !data ? 'structure' : labels[requested] ? requested : temporal ? data.capabilities?.trajectories ? 'together' : 'layers' : 'graph';

for (const element of document.querySelectorAll('#scene, #stats, .caption, #strip, #labels2, #legend, #details, #tip, #qr-panel, #sub, #repos')) element.dataset.temporal = '';
for (const element of document.querySelectorAll('.bar, #reader')) element.dataset.playback = '';
// Only a model whose graph renders prose has a story to read.
{ const read = document.getElementById('read'); if (read) read.hidden = !(data?.story?.units ?? []).some((unit) => String(unit.text ?? '').trim()); }
for (const element of document.getElementById('tools').children) {
  if (!element.querySelector?.('[data-pop="pop-show"]') && !['search-wrap', 'story', 'default-view', 'coarse-view', 'recenter-view', 'graph-controls', 'space-controls', 'chart-controls'].includes(element.id)) element.dataset.temporal = '';
}
const structureHost = document.createElement('div'); structureHost.id = 'structure-surface'; document.body.append(structureHost);
// The Chart has its own surface, below the row of controls, with its reading panel inside it.
const chartHost = document.createElement('div'); chartHost.id = 'chart-surface'; chartHost.dataset.chart = ''; document.body.append(chartHost);
function fitPanels() {
  // A panel that opens from the top row ends above the time bar, when there is one; a menu opening up from the bar keeps its height.
  const bar = document.querySelector('.hud.bar')?.getBoundingClientRect(), floor = bar?.height ? bar.top - 8 : innerHeight - 12;
  for (const panel of document.querySelectorAll('.pop:not([hidden]), .details:not([hidden])')) if (!panel.closest('.bar')) panel.style.maxHeight = `${Math.max(0, floor - panel.getBoundingClientRect().top)}px`;
  const title = document.querySelector('.title').getBoundingClientRect(), tools = document.getElementById('tools').getBoundingClientRect(), visibility = document.getElementById('toolbar-visibility').getBoundingClientRect();
  // On a narrow screen the model's view card stands in the column above the surfaces, which start below it; on a wide one
  // it sits over the top of the Chart's reading panel, and the panel starts below it.
  const card = document.getElementById('chosen-view')?.getBoundingClientRect(), across = Boolean(card?.height && card.width > innerWidth * 0.6);
  structureHost.style.top = `${Math.max(title.bottom, tools.bottom, visibility.bottom, across ? card.bottom : 0) + 12}px`;
  chartHost.style.top = structureHost.style.top;
  document.body.style.setProperty?.('--surface-top', structureHost.style.top);
  chartHost.style.setProperty?.('--cv-card', `${card?.height && !across ? Math.max(0, card.bottom - Math.max(title.bottom, tools.bottom, visibility.bottom) - 12) : 0}px`);
}
// Default: forget this tab's saved view of the model and open it as it first opens (the same model, nothing chosen).
function backToDefault() {
  try { forgetSavedView(globalThis.sessionStorage, location.href); } catch { /* storage can be unavailable: the address alone is enough */ }
  location.assign(defaultViewURL(location.href));
}
document.getElementById('default-view')?.addEventListener('click', backToDefault);
addEventListener('keydown', (event) => { if (event.key === '0' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest?.('input, textarea, select')) backToDefault(); });
let openPanel = null;
function togglePanel(id) {
  openPanel = openPanel === id ? null : id;
  for (const panel of document.querySelectorAll('.pop')) panel.hidden = panel.id !== openPanel;
  for (const button of document.querySelectorAll('.tool[data-pop]')) button.classList.toggle('open', button.dataset.pop === openPanel);
  fitPanels();
}
for (const button of document.querySelectorAll('.tool[data-pop]')) button.addEventListener('click', () => togglePanel(button.dataset.pop));
const toolbar = document.getElementById('tools'), toolbarVisibility = document.getElementById('toolbar-visibility');
function showControls(shown) {
  toolbar.hidden = !shown;
  toolbarVisibility.textContent = shown ? 'Hide controls' : 'Show controls';
  toolbarVisibility.setAttribute('aria-expanded', String(shown));
}
toolbarVisibility.addEventListener('click', () => {
  if (openPanel) togglePanel(openPanel);
  showControls(toolbar.hidden);
  fitPanels();
  dispatchEvent(new Event('viewer-controls-change'));
});
// On a narrow screen the controls fill most of it: they open hidden, one tap away, so the model shows first.
if (globalThis.matchMedia?.('(max-width: 760px)').matches) showControls(false);
document.addEventListener('pointerdown', (event) => { if (openPanel && !event.target.closest?.('.tool-wrap')) togglePanel(openPanel); });
addEventListener('keydown', (event) => { if (event.key === 'Escape' && openPanel) togglePanel(openPanel); });
addEventListener('resize', fitPanels);

function graphParts() {
  const surface = document.createElement('div'); surface.id = 'graph-surface'; surface.dataset.graph = '';
  const host = document.createElement('div'); host.id = 'graph-scene'; surface.append(host); document.body.append(surface);
  const copy = (id) => {
    const node = document.getElementById(id).cloneNode(true); node.hidden = true; delete node.dataset.temporal; delete node.dataset.playback; node.dataset.graph = '';
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
let selection = null, chartView = null;
// The graph's full records, which a compact snapshot keeps in a file of its own until a view needs them.
const graphRecords = () => whenPart(data, 'inspection/graph').catch((error) => { throw Object.assign(new Error(`The model's full records could not be read: ${error.message}`), { snapshotPart: true }); });
try { const value = JSON.parse(params.get('record') ?? 'null'); if (value && typeof value.kind === 'string' && typeof value.id === 'string') selection = value; } catch { /* An invalid UI selection does not change the snapshot. */ }
const session = createViewerSession({
  temporal, initialView, state: { selection, timeView: params.get('timeView'), ...restoredState },
  mounts: {
    temporal: async () => (await import('./view.js')).temporalController,
    graph: async () => {
      await graphRecords();
      const { showGraph } = await import('./graph-view.js'), parts = graphParts();
      try { return showGraph(data, { ...parts, onSelect: (record) => session.selectRecord(record) }); }
      catch (error) { parts.surface.remove(); parts.detail.remove(); parts.reader.remove(); parts.tools.replaceChildren(); throw error; }
    },
    structure: async () => {
      const unavailable = await graphRecords().then(() => null, (error) => error.message);
      return showInspector(data, [notice, unavailable].filter(Boolean).join(' ') || null, { host: structureHost, onSelect: (record) => session.selectRecord(record) });
    },
    chart: async () => {
      const { showChart } = await import('./chart-view.js');
      return (chartView = showChart(data, { host: chartHost, tools: document.getElementById('chart-controls'), onSelect: (record) => session.selectRecord(record), noteAddress }));
    },
    space: async () => {
      await graphRecords();
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
    document.getElementById('coarse-view').disabled = view === 'space' ? !data : view === 'chart' || !temporal;
    const recenter = document.getElementById('recenter-view'); recenter.hidden = view === 'structure'; recenter.disabled = !data || view === 'structure';
    document.querySelector('.eyebrow').textContent = `Meaning Model · ${labels[view]}`;
    document.getElementById('title').textContent = data?.title ?? 'Meaning Model'; document.title = data?.title ?? 'Meaning Model';
    showBranch(data?.branch ?? null);
    for (const button of document.querySelectorAll('#layouts button')) { button.classList.toggle('on', button.dataset.layout === view); button.setAttribute('aria-pressed', String(button.dataset.layout === view)); }
    if (!timeViews.has(view)) document.getElementById('layout-note').textContent = view === 'chart' ? 'The whole model on one time axis: periods, Events in rows by importance, and one row per process, read at the moment under the pointer.'
      : view === 'graph' ? 'Declared records and relationships. Position is a layout, not time or a measured distance.'
      : view === 'space' ? 'Declared coordinates, to scale, in the model\'s own reference frames. Only records with a declared position are placed.'
      : 'Declared Event containment, process decomposition and Cuts. The same snapshot, selection and time position are retained.';
    fitPanels();
  },
  onState(state) {
    const url = new URL(location.href); url.searchParams.set('view', state.view);
    if (state.timeView) url.searchParams.set('timeView', state.timeView);
    if (state.selection) url.searchParams.set('record', JSON.stringify(state.selection)); else url.searchParams.delete('record');
    url.searchParams.delete('visualView'); history.replaceState(null, '', url); noteAddress();
    const status = document.getElementById('selection-label'); status.hidden = !state.selection; status.textContent = state.selection ? `Selected ${state.selection.kind.replace(/_/g, ' ')}: ${state.selection.id}` : '';
  },
});
const opened = new Set();
// The Chart has its own reading panel on the right, where the model's view card would cover it: the card folds to its title.
let chosenCard = null;
async function switchView(view) {
  const key = timeViews.has(view) ? 'temporal' : view;
  if (data && !opened.has(key)) {
    // A representation is built the first time it is shown, which can take a moment: say so before the work starts.
    document.getElementById('t-show').textContent = `Opening ${labels[view] ?? view}…`; document.body.setAttribute('aria-busy', 'true');
    await new Promise((done) => { const timer = setTimeout(done, 60); globalThis.requestAnimationFrame?.(() => setTimeout(() => { clearTimeout(timer); done(); }, 0)); });
  }
  try { const state = await session.setView(view); opened.add(key); if (state.view === 'chart') chosenCard?.fold(true); return state; }
  catch (error) { console.error(error); notice = error.snapshotPart ? error.message : 'The 3D view is unavailable in this browser. The recorded model is available below.'; return session.setView('structure'); }
  finally { document.body.setAttribute('aria-busy', 'false'); }
}
window.modelViewer = { switchView, selectRecord: (record) => session.selectRecord(record), getState: () => session.snapshot(), getSnapshot: () => ({ name: dataName, data }), noteAddress };
// A found record opens where the reader is: in a time view at its place in time (a row in Processes, where rows are
// drawn), elsewhere selected as the record it is or is drawn from.
// A time typed into search is read in the model's own clock, counting "years ago" back from the latest time the model
// declares, as the time view's labels do.
const present = Math.max(...[data?.extent?.end, ...(data?.events ?? []).map((event) => (Array.isArray(event.reach) ? event.reach[1] : event.end ?? event.start))].filter(Number.isFinite));
if (temporal) document.getElementById('search')?.setAttribute('placeholder', isCalendarTime(data?.timeUnit) ? 'Search, or a time: 1914–1945' : 'Search, or a time');
mountSearch({ data, input: document.getElementById('search'), list: document.getElementById('search-results'),
  timeQuery: temporal ? (query) => parseTimeQuery(query, { unit: data?.timeUnit, present }) : null,
  onOpenList: () => { if (openPanel) togglePanel(openPanel); },
  open: async (result) => {
    // A time opens across its stretch: in the Chart on its own axis, otherwise in a time view.
    if (result.kind === 'time') {
      if (session.snapshot().view === 'chart' && chartView?.zoomTo?.(result.start, result.end)) return;
      if (!timeViews.has(session.snapshot().view)) await switchView('together');
      if (timeViews.has(session.snapshot().view)) (await import('./view.js')).temporalController.zoomTo(result.start, result.end);
      return;
    }
    const current = session.snapshot().view;
    if (temporal && result.rowId && timeViews.has(current) && current !== 'together') await switchView('together');
    // Terrain and the Chart draw every Event whatever is chosen, so a place or a person opens in the Tree, where it
    // narrows the view.
    if (temporal && result.kind === 'referent' && (current === 'terrain' || current === 'chart')) await switchView('layers');
    if (temporal && timeViews.has(session.snapshot().view)) { (await import('./view.js')).temporalController.locate(result); return; }
    const record = result.kind === 'row' ? result.record ?? null : { kind: result.kind, id: result.id };
    if (record) await session.revealRecord(record);
  } });
for (const button of document.querySelectorAll('#layouts button')) {
  const needsTime = timeViews.has(button.dataset.layout) || button.dataset.layout === 'chart';
  button.disabled = !data || (needsTime && !temporal);
  if (!temporal && needsTime) button.title = 'This snapshot has no declared time axis for this representation.';
  button.addEventListener('click', () => switchView(button.dataset.layout));
}
const coarseButton = document.getElementById('coarse-view');
coarseButton.disabled = !temporal;
// The coarse overview is the least detail of the time view being looked at; only a view without detail opens the tree.
coarseButton.addEventListener('click', async () => {
  const current = session.snapshot().view;
  if (current === 'space') { session.coarse(); return; }
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
// What the first view did not need is fetched while the reader looks at it, so the other views open at once.
if (data) setTimeout(() => whenAllParts(data).catch(() => {}), 0);
// A highlight opens in the time view when there is a clock, otherwise as a native record in Graph (or its fallback).
chosenCard = mountChosenView({ data, opening, onHighlight: async (target) => {
  if (!temporal) {
    await switchView('graph');
    const [kind, ...id] = String(target.record).split(':');
    await session.revealRecord(target.nodeId ? { kind: 'narrative', id: target.nodeId }
      : { kind: kind === 'cut' ? 'normalized_cut' : kind, id: id.join(':') });
    return;
  }
  if (!timeViews.has(session.snapshot().view)) await switchView('together');
  if (timeViews.has(session.snapshot().view)) { chosenCard?.fold(true); (await import('./view.js')).temporalController.showHighlight(target); }
} });
if (session.snapshot().view === 'chart') chosenCard?.fold(true);
fitPanels();
const stopLive = mountLiveViewer({ data, getState: () => session.snapshot(), restored: liveContext });
document.documentElement?.removeAttribute('data-live-reader-refresh');
addEventListener('pagehide', (event) => { if (!event.persisted) stopLive(); });
