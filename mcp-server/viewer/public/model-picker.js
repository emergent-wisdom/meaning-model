// A picker contains only snapshots explicitly grouped by the MCP or a public export.
// First visits fit the new model. Returning to an exact snapshot restores that
// model's own view, time and selection instead of copying another world's clock.
const sharedOptions = ['view', 'visualView', 'timeView', 'glare', 'reading', 'readingOverview', 'camera', 'edges', 'depth', 'detail', 'show', 'nothoughts', 'noteLayout', 'noteLinks', 'eventLayout', 'everything', 'unopened', 'flat', 'undated'];

export function modelSwitchURL(current, target, remembered = null) {
  const before = new URL(current), after = new URL(target, before);
  // Public exports may live below a site path. Keep switches inside the same
  // snapshot collection. A server may name its snapshots with opaque tokens or
  // readable slugs; both use one directory below the collection.
  const collection = (path) => path.match(/^(.*\/)[a-z0-9]+(?:-[a-z0-9]+)*\/$/)?.[1];
  const currentCollection = collection(new URL('.', before).pathname);
  if (after.origin !== before.origin || after.username || after.password
    || currentCollection === undefined || collection(after.pathname) !== currentCollection) throw new Error('Invalid model snapshot link');
  if (remembered) {
    try {
      const saved = new URL(remembered);
      if (saved.origin === after.origin && saved.pathname === after.pathname && !saved.username && !saved.password) return saved.href;
    } catch { /* Ignore an invalid tab-session bookmark. */ }
  }
  after.search = ''; after.hash = '';
  // A view the model chose belongs to its model: from one the reader has not changed, the next model opens as it opens,
  // with its own chosen view, rather than with settings the reader never made.
  const chosen = before.searchParams.get('chosen');
  if (chosen && chosen !== 'none' && !before.searchParams.has('adjusted')) return after.href;
  for (const key of sharedOptions) if (before.searchParams.has(key)) after.searchParams.set(key, before.searchParams.get(key));
  return after.href;
}

// Catalog relationships describe related worlds, never a merge of their data
// or clocks. Public exports can retain the same metadata as a local MCP viewer.
export function modelPickerGroups(views, current) {
  const key = (url) => { try { return new URL(url, current).href; } catch { return null; } };
  const byURL = new Map(views.map((view) => [key(view.url), view]));
  const children = new Set();
  const related = new Map(views.map((view) => {
    const entries = [...new Set((Array.isArray(view.relatedViews) ? view.relatedViews : [])
      .map((item) => byURL.get(key(item?.url))).filter((item) => item && item !== view))];
    for (const item of entries) children.add(item);
    return [view, entries];
  }));
  return views.flatMap((view) => related.get(view).length
    ? [{ title: view.title ?? 'Untitled model', views: [view, ...related.get(view)] }]
    : children.has(view) ? [] : [{ title: null, views: [view] }]);
}

export async function mountModelPicker() {
  // The picker names the model where its title stands; the standalone inspector keeps it in its navigation.
  const title = document.querySelector('.hud.title'), parent = title ?? document.querySelector('#tools') ?? document.querySelector('.inspection-nav');
  if (!parent) return;
  let views;
  try {
    const response = await fetch('data/views.json', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json(); views = Array.isArray(payload) ? payload : payload.views;
    if (!Array.isArray(views) || views.length < 2) return;
    for (const view of views) modelSwitchURL(location.href, view.url);
  } catch { return; }
  const label = document.createElement('label'); label.className = 'tool picker model-picker';
  const name = document.createElement('i'); name.textContent = 'Model';
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Model');
  let selected = false;
  for (const group of modelPickerGroups(views, location.href)) {
    const parent = group.title === null ? select : document.createElement('optgroup');
    if (parent !== select) { parent.label = group.title; select.append(parent); }
    for (const view of group.views) {
      const option = document.createElement('option'); option.value = view.url;
      option.textContent = view.title ?? 'Untitled model';
      // One declared life can belong to several books. Reuse its URL in each
      // group, with only one selected option in the native single-select.
      option.selected = !selected && view.selected === true; selected ||= option.selected;
      parent.append(option);
    }
  }
  select.addEventListener('change', () => {
    const target = new URL(modelSwitchURL(location.href, select.value));
    let remembered = null;
    try {
      sessionStorage.setItem(`meaning-model-view:${location.pathname}`, location.href);
      remembered = sessionStorage.getItem(`meaning-model-view:${target.pathname}`);
    } catch { /* Private browsing may disable tab storage; switching still works. */ }
    location.assign(modelSwitchURL(location.href, target.href, remembered));
  });
  label.append(name, select);
  if (title) { title.querySelector('h1')?.before(label); document.body.classList.add('has-model-picker'); } else parent.prepend(label);
  dispatchEvent(new Event('resize'));
}
