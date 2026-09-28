// A picker contains only snapshots explicitly grouped by the MCP or a public export.
// First visits fit the new model. Returning to an exact snapshot restores that
// model's own view, time and selection instead of copying another world's clock.
const sharedOptions = ['view', 'visualView', 'timeView', 'glare', 'reading', 'readingOverview', 'camera', 'edges', 'depth', 'detail', 'show', 'nothoughts', 'noteLayout', 'noteLinks', 'eventLayout', 'everything', 'unopened', 'flat'];

export function modelSwitchURL(current, target, remembered = null) {
  const before = new URL(current), after = new URL(target, before);
  // Public exports may live below a site path. Keep switches inside the same
  // snapshot collection, with the same opaque snapshot directory convention.
  const collection = (path) => path.match(/^(.*\/)[a-f0-9]{48}\/$/)?.[1];
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
  for (const key of sharedOptions) if (before.searchParams.has(key)) after.searchParams.set(key, before.searchParams.get(key));
  return after.href;
}

export async function mountModelPicker() {
  const parent = document.querySelector('#tools') ?? document.querySelector('.inspection-nav');
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
  for (const view of views) {
    const option = document.createElement('option'); option.value = view.url;
    option.textContent = view.title ?? 'Untitled model'; option.selected = view.selected === true; select.append(option);
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
  label.append(name, select); parent.prepend(label);
  dispatchEvent(new Event('resize'));
}
