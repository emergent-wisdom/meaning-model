// The Default button: the address a model opens at with nothing chosen yet, and this tab's saved copy of its view to
// forget, so a return through the model picker opens the default as well.
export function defaultViewURL(current) {
  const url = new URL(current), data = url.searchParams.get('data');
  url.search = ''; url.hash = '';
  // A standalone viewer may select its model through the query instead of its path.
  if (data !== null) url.searchParams.set('data', data);
  return url.href;
}
export function forgetSavedView(storage, current) {
  const path = new URL(current).pathname;
  for (let i = storage.length - 1; i >= 0; i -= 1) {
    const key = storage.key(i);
    if (key === `meaning-model-view:${path}` || key?.startsWith(`meaning-model-live:${path}:`)) storage.removeItem(key);
  }
}
