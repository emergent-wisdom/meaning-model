import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPickerGroups, modelSwitchURL, mountModelPicker } from '../viewer/public/model-picker.js';

test('the chooser groups declared related worlds without title matching or extra model requests', () => {
  const current = 'https://example.com/models/first/';
  const first = { url: '../first/', title: 'First story', relatedViews: [{ url: '/models/writer/', role: 'author' }] };
  const second = { url: '../second/', title: 'Second story', relatedViews: [{ url: '../other-writer/', role: 'author' }] };
  const writer = { url: '../writer/', title: 'Author life · A writer' };
  const otherWriter = { url: '../other-writer/', title: 'Author life · A writer', selected: true };
  const unrelated = { url: '../unrelated/', title: 'First story', selected: false };
  assert.deepEqual(modelPickerGroups([first, second, unrelated, writer, otherWriter], current), [
    { title: 'First story', views: [first, writer] }, { title: 'Second story', views: [second, otherWriter] },
    { title: null, views: [unrelated] },
  ]);
  assert.equal(otherWriter.selected, true);
});

test('shared lives reuse one world beneath each declared book and malformed or absent relationships add no choices', () => {
  const current = 'https://example.com/models/first/';
  const first = { url: '/models/first/', title: 'First', relatedViews: [
    { url: '/models/writer/', role: 'author' }, { url: '/models/writer/', role: 'reader' },
    { url: '/models/first/' }, { url: '/models/not-in-catalog/' }, { url: 'https://outside.test/models/writer/' }, null,
  ] };
  const second = { url: '/models/second/', title: 'Second', relatedViews: [{ url: '/models/writer/', role: 'author' }] };
  const writer = { url: '/models/writer/', title: 'Writer', selected: true };
  assert.deepEqual(modelPickerGroups([first, second, writer], current), [
    { title: 'First', views: [first, writer] }, { title: 'Second', views: [second, writer] },
  ]);
  assert.deepEqual(modelPickerGroups([{ ...writer, relatedViews: {} }, { url: '/models/old/', title: 'Old export' }], current)
    .map((group) => group.title), [null, null], 'old flat catalogs remain usable');
});

test('the mounted native chooser preserves selection and per-world navigation in grouped catalogs', async (t) => {
  const current = 'https://example.com/models/writer/?view=space&at=2001';
  const views = [
    { url: '/models/first/', title: 'First story', relatedViews: [{ url: '/models/writer/', role: 'author' }] },
    { url: '/models/second/', title: 'Second story', relatedViews: [{ url: '/models/writer/', role: 'author' }] },
    { url: '/models/writer/', title: 'Author life · Mira', selected: true },
  ];
  const node = (tag) => ({ tag, children: [], attributes: {}, handlers: {}, append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); }, setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, handler) { this.handlers[key] = handler; } });
  const parent = node('nav'), addresses = [], storage = new Map();
  storage.set('meaning-model-view:/models/second/', 'https://example.com/models/second/?view=layers&at=1843&record=second-event');
  const replacements = {
    document: { querySelector: (selector) => selector === '.inspection-nav' ? parent : null, createElement: node },
    location: { href: current, pathname: '/models/writer/', assign: (url) => addresses.push(url) },
    sessionStorage: { setItem: (key, value) => storage.set(key, value), getItem: (key) => storage.get(key) },
    dispatchEvent: () => {},
    fetch: async () => ({ ok: true, json: async () => views }),
  };
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  await mountModelPicker();
  const select = parent.children[0].children[1];
  assert.equal(select.attributes['aria-label'], 'Model');
  assert.deepEqual(select.children.map((group) => [group.tag, group.label, group.children.map((option) => option.textContent)]), [
    ['optgroup', 'First story', ['First story', 'Author life · Mira']],
    ['optgroup', 'Second story', ['Second story', 'Author life · Mira']],
  ]);
  assert.equal(select.children.flatMap((group) => group.children).filter((option) => option.selected).length, 1);
  select.value = '/models/second/'; select.handlers.change();
  assert.deepEqual(addresses, ['https://example.com/models/second/?view=layers&at=1843&record=second-event']);
  assert.equal(storage.get('meaning-model-view:/models/writer/'), current);
});

test('switching models keeps the chosen view and display controls but fits the new model', () => {
  const source = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers&camera=free&glare=soft&reading=off&edges=off&at=2022&t0=2020&t1=2023&pose=1,2,3&data=old&title=Old&depth=4&show=events,subsidiary&unopened=hide&flat=hide&nothoughts&readingOverview=structure&lenses=old-lens&life=OldPerson&focus=old-event&zoom=life&mode=construction&speed=4#old-passage`;
  const target = `http://127.0.0.1:1234/${'b'.repeat(48)}/`;
  const next = new URL(modelSwitchURL(source, target));
  assert.equal(next.pathname, new URL(target).pathname);
  assert.deepEqual(Object.fromEntries(next.searchParams), { view: 'layers', glare: 'soft', reading: 'off', camera: 'free', edges: 'off', depth: '4', show: 'events,subsidiary', unopened: 'hide', flat: 'hide', nothoughts: '', readingOverview: 'structure' });
  assert.equal(next.hash, '');
  for (const view of ['graph', 'together', 'terrain', 'structure']) {
    const current = new URL(source); current.searchParams.set('view', view); current.searchParams.set('visualView', 'layers');
    current.searchParams.set('timeView', 'terrain');
    const switched = new URL(modelSwitchURL(current.href, target));
    assert.equal(switched.searchParams.get('view'), view); assert.equal(switched.searchParams.get('visualView'), 'layers');
    assert.equal(switched.searchParams.get('timeView'), 'terrain');
  }
});

test('from a view the model chose, the next model opens with its own view; a reader\'s own settings carry over', () => {
  const target = `http://127.0.0.1:1234/${'b'.repeat(48)}/`;
  const following = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=together&camera=locked&show=causal,processes&chosen=understanding.view.v1&level=1`;
  assert.equal(new URL(modelSwitchURL(following, target)).search, '');
  const adjusted = `${following}&adjusted`;
  assert.deepEqual(Object.fromEntries(new URL(modelSwitchURL(adjusted, target)).searchParams), { view: 'together', camera: 'locked', show: 'causal,processes' });
  const own = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=together&camera=free&chosen=none`;
  assert.deepEqual(Object.fromEntries(new URL(modelSwitchURL(own, target)).searchParams), { view: 'together', camera: 'free' });
});

test('switching models preserves an explicitly empty layer selection and depth zero', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers&depth=0&show=&lenses=all`;
  const next = new URL(modelSwitchURL(current, `/${'b'.repeat(48)}/`));
  assert.equal(next.searchParams.get('depth'), '0');
  assert.equal(next.searchParams.get('show'), '');
  assert.equal(next.searchParams.has('show'), true);
  assert.equal(next.searchParams.has('lenses'), false);
});

test('note and Event layout preferences survive model switching from every representation', () => {
  for (const view of ['together', 'layers', 'terrain', 'graph', 'structure', 'space']) for (const noteLayout of ['original', 'nearby', 'overhead', 'centered']) for (const eventLayout of ['traditional', 'nested']) {
    const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=${view}&noteLayout=${noteLayout}&noteLinks=all&eventLayout=${eventLayout}`;
    const next = new URL(modelSwitchURL(current, `/${'b'.repeat(48)}/`));
    assert.equal(next.searchParams.get('view'), view);
    assert.equal(next.searchParams.get('noteLayout'), noteLayout);
    assert.equal(next.searchParams.get('noteLinks'), 'all');
    assert.equal(next.searchParams.get('eventLayout'), eventLayout);
  }
});

test('legacy Everything remains a global choice while model-specific lens IDs are dropped', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers&everything&lenses=old-lens&at=2022&pose=1,2,3`;
  const next = new URL(modelSwitchURL(current, `/${'b'.repeat(48)}/`));
  assert.equal(next.searchParams.has('everything'), true);
  assert.equal(next.searchParams.has('depth'), false, 'the new model chooses its own maximum depth');
  assert.equal(next.searchParams.has('lenses'), false);
  assert.equal(next.searchParams.has('at'), false);
  assert.equal(next.searchParams.has('pose'), false);
});

test('switching books keeps coarse or finer detail while dropping the previous model’s selected process', () => {
  for (const level of [0, 1, 3]) {
    const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers&detail=${level}&scope=book-a-engine&flat=hide&unopened=hide&record=old-record&at=1843`;
    const next = new URL(modelSwitchURL(current, `/${'b'.repeat(48)}/`));
    assert.equal(next.searchParams.get('detail'), String(level));
    assert.equal(next.searchParams.get('view'), 'layers');
    assert.equal(next.searchParams.get('flat'), 'hide');
    assert.equal(next.searchParams.get('unopened'), 'hide');
    for (const field of ['scope', 'record', 'at']) assert.equal(next.searchParams.has(field), false);
  }
});

test('model switching accepts only same-origin snapshot capability URLs', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/`;
  for (const invalid of ['https://example.com/', 'http://127.0.0.1:4321/'+ 'b'.repeat(48) +'/', '/data/model.json', 'javascript:alert(1)', `http://user:password@127.0.0.1:1234/${'b'.repeat(48)}/`]) {
    assert.throws(() => modelSwitchURL(current, invalid), /Invalid model snapshot link/);
  }
});

test('returning to a snapshot restores its own view, time and selection', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers&at=1843`;
  const target = `http://127.0.0.1:1234/${'b'.repeat(48)}/`;
  const saved = new URL(target);
  saved.search = '?view=graph&timeView=terrain&at=2022&t0=2020&t1=2023&scope=laura&pose=1,2,3&reading=off';
  saved.searchParams.set('record', JSON.stringify({ kind: 'event', id: 'laura-walk' }));
  saved.hash = 'passage-5';
  assert.equal(modelSwitchURL(current, target, saved.href), saved.href);
});

test('hosted collections switch below a site path without leaving that collection', () => {
  const first = 'a'.repeat(48), second = 'b'.repeat(48);
  const current = `https://example.com/meaning-model/${first}/?view=space&at=1843`;
  const target = `../${second}/`;
  assert.equal(modelSwitchURL(current, target), `https://example.com/meaning-model/${second}/?view=space`);
  assert.equal(modelSwitchURL(current.replace('/?view=', '/index.html?view='), target), modelSwitchURL(current, target));
  const saved = `https://example.com/meaning-model/${second}/?view=tree&at=2022`;
  assert.equal(modelSwitchURL(current, target, saved), saved);
  for (const outside of [`/${second}/`, `/other/${second}/`, `../../${second}/`, '/meaning-model/data/model.json']) {
    assert.throws(() => modelSwitchURL(current, outside), /Invalid model snapshot link/);
  }
});

test('readable model addresses stay inside their hosted collection and preserve display preferences', () => {
  const origin = 'https://example.com';
  const current = `${origin}/models/first-example/?view=layers&glare=full&noteLayout=centered&noteLinks=all&at=1843`;
  const target = '/models/second-example/';
  const switched = new URL(modelSwitchURL(current, target));
  assert.equal(switched.pathname, target);
  assert.equal(switched.searchParams.get('view'), 'layers');
  assert.equal(switched.searchParams.get('glare'), 'full');
  assert.equal(switched.searchParams.get('noteLayout'), 'centered');
  assert.equal(switched.searchParams.get('noteLinks'), 'all');
  assert.equal(switched.searchParams.has('at'), false);
  const saved = `${origin}${target}?view=space&at=2022`;
  assert.equal(modelSwitchURL(current, target, saved), saved);
  assert.equal(new URL(modelSwitchURL(`${origin}/models/${'a'.repeat(48)}/`, target)).pathname, target);
  assert.equal(new URL(modelSwitchURL(current, `/models/${'b'.repeat(48)}/`)).pathname, `/models/${'b'.repeat(48)}/`);
  for (const outside of ['/second-example/', '/other/second-example/', '/models/data/model.json', '/models/%2fsecret/', 'https://elsewhere.test/models/second-example/']) {
    assert.throws(() => modelSwitchURL(current, outside), /Invalid model snapshot link/);
  }
});

test('a saved position must belong to the exact same snapshot and origin', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers`;
  const target = `http://127.0.0.1:1234/${'b'.repeat(48)}/`;
  for (const saved of [current, 'not a URL', `https://example.com/${'b'.repeat(48)}/`, target.replace('1234', '4321'), target.replace('127.0.0.1', 'user:password@127.0.0.1')]) {
    assert.equal(modelSwitchURL(current, target, saved), modelSwitchURL(current, target));
  }
});
