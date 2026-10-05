// Saved-revision following uses a guarded page refresh because each renderer is
// built from one immutable snapshot. Keep its reading and camera context.
export function cameraState(camera, controls) {
  return { position: camera.position.toArray(), target: controls.target.toArray(),
    near: camera.near, far: camera.far, fov: camera.fov, zoom: camera.zoom };
}
export function restoreCamera(camera, controls, state) {
  if (![state?.position, state?.target].every((value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))) return false;
  camera.position.fromArray(state.position); controls.target.fromArray(state.target);
  for (const key of ['near', 'far', 'fov', 'zoom']) if (Number.isFinite(state[key]) && state[key] > 0) camera[key] = state[key];
  camera.updateProjectionMatrix();
  const rotating = controls.autoRotate; controls.autoRotate = false; controls.update(); controls.autoRotate = rotating; return true;
}
export const spaceFrameIdentity = (frame) => frame ? JSON.stringify([frame.frame ?? null, frame.unit ?? null]) : null;

const storageKey = () => `meaning-model-live:${location.pathname}:${new URLSearchParams(location.search).get('data') ?? 'model'}`;
export function takeLiveContext(storage, key = storageKey()) {
  try {
    storage ??= globalThis.sessionStorage;
    const value = JSON.parse(storage.getItem(key) ?? 'null'); storage.removeItem(key);
    return value && Date.now() - value.savedAt < 300_000 ? value : null;
  } catch { return null; }
}

const fingerprint = (element) => String(element.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 500);
const readerScroller = (reader) => reader.querySelector('[id$="reader-scroll"]') ?? reader;
const blocks = (reader) => [...reader.querySelectorAll('[id$="reader-body"] p, [id$="reader-body"] h1, [id$="reader-body"] h2, [id$="reader-body"] h3, [id$="reader-body"] h4, [id$="reader-body"] li')];
const nodeOf = (element) => element.dataset.nodeId ?? element.closest('[data-node-id]')?.dataset.nodeId ?? null;

export function captureReader(reader) {
  if (!reader || reader.hidden) return { open: false };
  const scroll = readerScroller(reader), top = scroll.getBoundingClientRect().top;
  const header = reader.querySelector('[id$="reader-head"], .reader-head');
  const readingTop = Math.max(top, header?.getBoundingClientRect().bottom ?? top);
  const candidates = blocks(reader), anchor = candidates.find((element) => element.getBoundingClientRect().bottom > readingTop);
  const unit = anchor ? nodeOf(anchor) : null;
  return { open: true, full: reader.classList.contains('full'), scrollTop: scroll.scrollTop,
    anchor: anchor ? { unit, text: fingerprint(anchor), index: candidates.filter((element) => nodeOf(element) === unit).indexOf(anchor),
      offset: anchor.getBoundingClientRect().top - top } : null };
}

export function restoreReader(reader, state) {
  if (!reader || !state?.open) return;
  reader.hidden = false; reader.classList.toggle('full', Boolean(state.full));
  const toggle = reader.querySelector('[id$="reader-full"]'); if (toggle) toggle.textContent = state.full ? 'Side view' : 'Full view';
  const scroll = readerScroller(reader), candidates = blocks(reader);
  const inUnit = candidates.filter((element) => nodeOf(element) === state.anchor?.unit);
  // A stable passage and unchanged paragraph survive insertions before them.
  // If that paragraph was edited/removed, fall back within its passage, then to
  // the former scroll position rather than jumping to the manuscript's start.
  const anchor = state.anchor && (inUnit.find((element) => fingerprint(element) === state.anchor.text)
    ?? inUnit[state.anchor.index] ?? candidates.find((element) => fingerprint(element) === state.anchor.text));
  if (anchor) scroll.scrollTop += anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - state.anchor.offset;
  else scroll.scrollTop = state.scrollTop ?? 0;
}

export function mountLiveViewer({ data, getState, restored = null, document = globalThis.document,
  fetch = globalThis.fetch, reload = () => location.reload(), storage,
  key = storageKey(), interval = 2_000 } = {}) {
  // Static/standalone exports do not opt into this protocol, even if they have
  // their own data/live.json. The MCP marks authorized live snapshots explicitly.
  if (data?.viewerLive?.mode !== 'live') return () => {};
  const status = document.createElement('div'); status.id = 'live-status'; status.hidden = true;
  status.className = 'sub';
  const label = document.createElement('span'), pause = document.createElement('button');
  pause.type = 'button'; pause.textContent = 'Pause updates'; pause.className = 'tool'; pause.hidden = true;
  status.append(label); (document.querySelector('.title') ?? document.body).append(status);
  (document.getElementById('tools') ?? document.body).append(pause);
  const abort = new AbortController(); let timer = null, stopped = false, paused = false, lastActivity = Date.now(), held = false;
  const currentHash = data.viewerLive.graphHash ?? null, currentModel = data.viewerLive.modelHash ?? data.modelHash ?? null;
  const reader = () => document.getElementById(getState().view === 'graph' ? 'graph-reader' : 'reader');
  if (restored?.reader?.open) {
    if (getState().view !== 'graph') document.getElementById('read')?.click();
    restoreReader(reader(), restored.reader);
  }
  const activity = () => { lastActivity = Date.now(); };
  for (const name of ['scroll', 'wheel', 'touchmove', 'keydown', 'input']) document.addEventListener(name, activity, { capture: true, passive: true, signal: abort.signal });
  document.addEventListener('pointerdown', () => { held = true; activity(); }, { signal: abort.signal });
  for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, () => { held = false; activity(); }, { signal: abort.signal });
  pause.addEventListener('click', () => { paused = !paused; pause.textContent = paused ? 'Resume updates' : 'Pause updates'; activity(); }, { signal: abort.signal });
  async function poll() {
    if (stopped) return;
    try {
      const response = await fetch('data/live.json', { cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error('Live endpoint unavailable');
      const live = await response.json();
      if (live.mode !== 'live') { status.remove(); pause.remove(); return; }
      status.hidden = false; pause.hidden = false;
      label.textContent = paused ? 'Live paused' : `${live.message}${live.status === 'following' ? ` · ${String(live.modelHash ?? live.graphHash ?? '').slice(0, 8)}` : ''}`;
      // A newer graph revision, or a model revision recorded since (each series an agent records), opens the view again.
      if (!paused && live.status === 'following' && ((live.graphHash ?? null) !== currentHash || (live.modelHash ?? null) !== currentModel)) {
        const editing = document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]');
        const selecting = document.getSelection?.()?.isCollapsed === false;
        const play = document.getElementById('play');
        const playing = !play?.disabled && (play?.textContent?.trim() === '❚❚' || play?.getAttribute?.('aria-pressed') === 'true');
        if (document.hidden || held || editing || selecting || playing || Date.now() - lastActivity < 3_000) {
          label.textContent = 'New saved revision · waiting until you pause';
        } else {
          try {
            (storage ?? globalThis.sessionStorage).setItem(key, JSON.stringify({ savedAt: Date.now(), state: getState(), reader: captureReader(reader()) }));
            label.textContent = 'Updating saved revision…'; stopped = true; reload(); return;
          } catch { label.textContent = 'Update ready · browser storage is unavailable; refresh to see it'; }
        }
      }
    } catch { if (!stopped) { status.hidden = false; label.textContent = 'Live connection unavailable · keeping this revision'; } }
    if (!stopped) timer = setTimeout(poll, interval);
  }
  void poll();
  return () => { stopped = true; clearTimeout(timer); abort.abort(); status.remove(); pause.remove(); };
}
