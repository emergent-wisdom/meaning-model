// A view the model chooses for its reader is written in the viewer's own address settings, so the model can choose only
// what a reader could set by hand, and the viewer opens it through the same parsing as any link. The tool that records a
// view checks it against this list, and the viewer reads it back with the same functions.
export const VIEW_SCHEMA = 'meaning-model-view/v1';
export const LAYER_KEYS = Object.freeze(['processes', 'threads', 'decisions', 'lovefear', 'causal', 'notes', 'numbers', 'events', 'subsidiary', 'prose']);

const oneOf = (...values) => (value) => values.includes(value) || `one of ${values.map((item) => (item === '' ? '(empty)' : item)).join(', ')}`;
const finite = (value) => (value.trim() !== '' && Number.isFinite(Number(value))) || 'a number';
const between = (low, high) => (value) => (finite(value) === true && Number(value) >= low && Number(value) <= high) || `a number from ${low} to ${high}`;
const whole = (value) => /^\d+$/u.test(value) || 'a whole number';
const named = (value) => value.trim().length > 0 || 'not empty';
const layers = (value) => value === '' || value.split(',').every((key) => LAYER_KEYS.includes(key)) || `a comma list of ${LAYER_KEYS.join(', ')}`;
export const VIEW_SETTINGS = Object.freeze({
  view: oneOf('together', 'layers', 'terrain', 'graph', 'structure', 'space'), timeView: oneOf('together', 'layers', 'terrain'),
  camera: oneOf('spin', 'free', 'locked'), glare: oneOf('full', 'soft'), edges: oneOf('on', 'off'), reading: oneOf('on', 'off'),
  text: oneOf('on', 'off'), legend: oneOf(''), world: oneOf('above', 'below'), smooth: between(0, 1),
  show: layers, everything: oneOf(''), nothoughts: oneOf(''), lenses: named, depth: whole, detail: whole, scope: named, focus: named,
  rows: oneOf('all'), flat: oneOf('hide'), unopened: oneOf('hide'), undated: oneOf('hide'),
  noteLayout: oneOf('floors', 'original', 'nearby', 'overhead', 'centered'), noteLinks: oneOf('some', 'all'),
  eventLayout: oneOf('nested', 'traditional'), readingOverview: oneOf('structure', 'named'), mode: oneOf('story', 'construction'),
  speed: oneOf('0.25', '0.5', '1', '2', '4'), zoom: oneOf('story', 'life', 'centuries', 'world'), life: named, t0: finite, t1: finite, at: finite,
});
// Where the camera stands and how it moves, the moment played, the passage open and the record selected change what is
// looked at, not the view: a reader who moves them is still on the view the model chose. timeView only remembers the
// last time layout for a return from another representation; view says which one shows.
const PASSING = new Set(['pose', 'at', 'read', 'qr', 'record', 'timeView', 'camera']);
// The camera is the reader's: a view chooses what to look at, never how the reader moves through it, so a view does not
// set it and one recorded with it opens without it.
const READER = new Set(['camera']);
const viewOwn = (settings) => Object.fromEntries(Object.entries(settings ?? {}).filter(([key]) => !READER.has(key)));

// Problems with a view's settings, as sentences; none means the viewer can open it.
export function viewSettingsProblems(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['settings must be an object of address settings.'];
  const problems = [];
  for (const [key, value] of Object.entries(settings)) {
    const check = VIEW_SETTINGS[key];
    if (!check) { problems.push(`${key} is not a viewer setting; the settings are ${Object.keys(VIEW_SETTINGS).join(', ')}.`); continue; }
    if (READER.has(key)) { problems.push(`${key} is the reader's: a view chooses what to look at, not how the reader moves through it.`); continue; }
    if (typeof value !== 'string') { problems.push(`${key} must be a string, as an address holds it.`); continue; }
    const verdict = check(value); if (verdict !== true) problems.push(`${key}=${value} must be ${verdict}.`);
  }
  if (('t0' in settings) !== ('t1' in settings)) problems.push('t0 and t1 go together.');
  else if ('t0' in settings && Number(settings.t0) >= Number(settings.t1)) problems.push('t0 must be before t1.');
  return problems;
}

// A view's settings, rows and highlights at one level of detail: its own, then each level's added in order. The last
// stop after the model's levels is Everything, which shows every record and no longer narrows to the model's choice.
export const levelCount = (view) => (view?.levels?.length ?? 0) + 2;
export const everythingLevel = (view) => levelCount(view) - 1;
export function settingsAt(view, level) {
  if (level >= everythingLevel(view)) {
    const kept = Object.fromEntries(Object.entries(settingsAt(view, everythingLevel(view) - 1)).filter(([key]) => ['view', 'timeView', 'glare', 't0', 't1', 'zoom', 'life', 'reading', 'smooth', 'world'].includes(key)));
    return { ...kept, everything: '', rows: 'all' };
  }
  let settings = viewOwn(view?.settings);
  for (const step of (view?.levels ?? []).slice(0, level)) settings = { ...settings, ...viewOwn(step.settings) };
  return settings;
}
export function curationAt(view, level) {
  if (level >= everythingLevel(view)) return { rows: [], highlights: [] };
  const rows = [...(view?.rows ?? [])], highlights = [...(view?.highlights ?? [])];
  for (const step of (view?.levels ?? []).slice(0, level)) { rows.push(...(step.rows ?? [])); highlights.push(...(step.highlights ?? [])); }
  return { rows, highlights };
}

// The settings an address holds, without those that only move within a view.
export function addressSettings(search) {
  const out = {};
  for (const [key, value] of new URLSearchParams(search)) if (key in VIEW_SETTINGS && !PASSING.has(key)) out[key] = value;
  return out;
}
const canonical = (settings) => JSON.stringify(Object.keys(settings).sort().map((key) => [key, settings[key]]));
export const sameSettings = (a, b) => canonical(addressSettings(a)) === canonical(addressSettings(b));

// The model's current view: the newest not superseded.
export const currentView = (views = []) => views.filter((view) => !view.superseded).at(-1) ?? null;
const levelOf = (url, view) => {
  const level = Number(url.searchParams.get('level'));
  return url.searchParams.has('level') && Number.isInteger(level) && level >= 0 && level < levelCount(view) ? level : view.level ?? 0;
};
// The address of a view at a level: the snapshot it shows, the view's settings, and which view it is. The reader's
// camera mode always stays; keepPlace also retains their camera position, moment, open passage and selected record.
export function viewAddress(href, view, level = view.level ?? 0, { keepPlace = false } = {}) {
  const url = new URL(href), next = new URLSearchParams(), settings = settingsAt(view, level);
  const sameTimeMode = (url.searchParams.get('mode') ?? 'story') === (settings.mode ?? 'story');
  for (const key of ['data', 'title', 'live', 'capture', ...(keepPlace ? PASSING : READER)]) {
    if (url.searchParams.has(key) && (key !== 'at' || sameTimeMode)) next.set(key, url.searchParams.get(key));
  }
  for (const [key, value] of Object.entries(settings)) {
    if (!keepPlace || !PASSING.has(key) || !next.has(key)) next.set(key, value);
  }
  next.set('chosen', view.id); if (level !== (view.level ?? 0)) next.set('level', String(level));
  url.search = next.toString().replace(/%2C/gu, ',').replace(/%3A/gu, ':').replace(/\+/gu, '%20').replace(/=(&|$)/gu, '$1');
  return url.href;
}
// Which view an address opens. One that names nothing opens the model's current view. One that followed an earlier view
// unchanged opens the current one and says it changed. One the reader adjusted, or set by hand, or turned to their own
// settings keeps the reader's settings, and the newer view is offered rather than imposed.
export function openingView(href, views = []) {
  const url = new URL(href), current = currentView(views), chosen = url.searchParams.get('chosen');
  if (!current) return { href, state: 'none', view: null, current: null, level: 0 };
  const named = views.find((view) => view.id === chosen) ?? null;
  if (chosen === 'none') return { href, state: 'own', view: null, current, level: 0 };
  if (named && url.searchParams.has('adjusted')) return { href, state: 'adjusted', view: named, current, level: levelOf(url, named), newer: named.id !== current.id };
  if (named?.id === current.id) { const level = levelOf(url, current); return { href: viewAddress(href, current, level, { keepPlace: true }), state: 'following', view: current, current, level }; }
  if (named || !Object.keys(addressSettings(url.search)).length) {
    const level = named ? current.level ?? 0 : levelOf(url, current);
    return { href: viewAddress(href, current, level, { keepPlace: true }), state: named ? 'changed' : 'following', view: current, current, level, ...(named ? { previous: named.id } : {}) };
  }
  return { href, state: 'own', view: null, current, level: 0 };
}
