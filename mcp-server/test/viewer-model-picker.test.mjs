import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSwitchURL } from '../viewer/public/model-picker.js';

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

test('switching models preserves an explicitly empty layer selection and depth zero', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers&depth=0&show=&lenses=all`;
  const next = new URL(modelSwitchURL(current, `/${'b'.repeat(48)}/`));
  assert.equal(next.searchParams.get('depth'), '0');
  assert.equal(next.searchParams.get('show'), '');
  assert.equal(next.searchParams.has('show'), true);
  assert.equal(next.searchParams.has('lenses'), false);
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

test('a saved position must belong to the exact same snapshot and origin', () => {
  const current = `http://127.0.0.1:1234/${'a'.repeat(48)}/?view=layers`;
  const target = `http://127.0.0.1:1234/${'b'.repeat(48)}/`;
  for (const saved of [current, 'not a URL', `https://example.com/${'b'.repeat(48)}/`, target.replace('1234', '4321'), target.replace('127.0.0.1', 'user:password@127.0.0.1')]) {
    assert.equal(modelSwitchURL(current, target, saved), modelSwitchURL(current, target));
  }
});
