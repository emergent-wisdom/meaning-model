import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const start = source.indexOf('function syncURL(');
const end = source.indexOf('\n}', start);
assert.ok(start >= 0 && end > start, 'the trajectory URL serializer must be present');
const syncURLSource = source.slice(start, end + 2);

test('saving any trajectory layout keeps its explicit route across refresh and layout changes', () => {
  for (const layout of ['together', 'layers', 'terrain']) {
    const saved = [], timers = [];
    const context = { DEFAULT_SMOOTHING: 0.2, isCharacter: () => true,
      URLSearchParams, ready: true, temporalActive: true, urlTimer: null,
      params: new URLSearchParams('view=layers&title=Example'),
      opt: { layout, camera: 'locked', glare: 'soft', edges: true,
        readingPosition: false, readingOverview: 'story', mode: 'story', speed: 1,
        depth: 2, show: new Set(['events', 'notes']), lenses: new Set() },
      currentPreset: 'story', DEFAULT_SHOW: ['events', 'notes'], lensList: [],
      defaultShow: () => ['events', 'notes'], defaultDepth: (chosen) => chosen === 'layers' ? 4 : 2,
      layerOverrides: new Map(), explicitDepth: false, explicitNoteLayout: false, explicitEverything: false, MAX_DEPTH: 6,
      atEnd: true, playing: false, isEverything: () => false,
      document: { getElementById: () => ({ hidden: true }) }, qrPanel: { hidden: true },
      location: { pathname: '/model-token/' },
      history: { replaceState: (_state, _title, url) => saved.push(url) },
      clearTimeout() {}, setTimeout(callback) { timers.push(callback); return timers.length; },
    };
    vm.createContext(context);
    vm.runInContext(syncURLSource, context);
    context.syncURL();
    assert.equal(timers.length, 1);
    timers[0]();
    assert.equal(saved.length, 1);
    const url = new URL(saved[0], 'http://127.0.0.1:1234');
    assert.equal(url.pathname, '/model-token/');
    assert.equal(url.searchParams.get('view'), layout,
      `${layout} must not return to the default graph on refresh`);
    assert.equal(url.searchParams.get('title'), 'Example');
    assert.equal(url.searchParams.get('camera'), 'locked');
    assert.equal(url.searchParams.get('glare'), null, 'the quieter default does not need a URL override');
    assert.equal(url.searchParams.get('reading'), null, 'the reading position is off unless asked for, so off needs no override');
    // A layout choice must be visible to a navigation click before the debounce runs.
    context.opt.layout = layout === 'terrain' ? 'layers' : 'terrain';
    context.syncURL(true);
    assert.equal(timers.length, 1, 'immediate saves must not wait for another timer');
    assert.equal(new URL(saved.at(-1), 'http://127.0.0.1:1234').searchParams.get('view'), context.opt.layout);
    context.opt.readingPosition = true; context.syncURL(true);
    assert.equal(new URL(saved.at(-1), 'http://127.0.0.1:1234').searchParams.get('reading'), 'on', 'a reading position turned on is kept');
  }
});

test('URL persistence distinguishes deliberate display choices from implicit all-visible data', () => {
  const allLayers = ['processes', 'threads', 'decisions', 'lovefear', 'causal', 'notes', 'events', 'subsidiary', 'prose'];
  for (const choice of ['explicit-layers', 'implicit-all-visible', 'explicit-everything']) {
    const saved = [];
    const everything = choice === 'explicit-everything';
    const implicit = choice === 'implicit-all-visible';
    const chosen = everything ? allLayers : ['events', 'notes'];
    const context = { DEFAULT_SMOOTHING: 0.2, isCharacter: () => true,
      URLSearchParams, ready: true, temporalActive: true, urlTimer: null, params: new URLSearchParams('view=layers'),
      opt: { layout: 'layers', camera: 'locked', glare: 'full', edges: true, readingPosition: true,
        readingOverview: 'named', mode: 'story', speed: 1, depth: everything ? 6 : implicit ? 4 : 2,
        show: new Set(chosen), lenses: new Set(everything ? ['historical-lens'] : []) },
      currentPreset: 'story', DEFAULT_SHOW: chosen, defaultShow: () => chosen, defaultDepth: () => 4,
      layerOverrides: new Map(implicit ? [] : allLayers.map((key) => [key, chosen.includes(key)])), explicitDepth: !implicit, explicitNoteLayout: false,
      explicitEverything: everything, MAX_DEPTH: everything ? 6 : 4,
      lensList: everything ? [{ id: 'historical-lens' }] : [], atEnd: true, playing: false,
      isEverything: () => choice !== 'explicit-layers',
      document: { getElementById: () => ({ hidden: true }) }, qrPanel: { hidden: true },
      location: { pathname: '/model-token/' }, history: { replaceState: (_state, _title, url) => saved.push(url) },
      clearTimeout() {}, setTimeout() { throw new Error('An explicit layout save must run immediately.'); },
    };
    vm.createContext(context);
    vm.runInContext(syncURLSource, context);
    context.syncURL(true);
    const url = new URL(saved[0], 'http://127.0.0.1:1234');
    assert.equal(url.searchParams.has('everything'), everything, 'only a deliberate Everything choice transfers full depth and visibility to another model');
    if (choice === 'explicit-layers') {
      assert.equal(url.searchParams.get('depth'), '2', 'an explicitly chosen depth remains explicit even when equal to an older default');
      assert.equal(url.searchParams.get('show'), [...chosen].sort().join(','), 'explicit layer choices persist even when they match this model\'s defaults');
    } else {
      assert.equal(url.searchParams.has('depth'), false);
      assert.equal(url.searchParams.has('show'), false);
      assert.equal(url.searchParams.has('lenses'), false);
    }
  }
});

test('URL persistence saves or clears each line filter independently of layer visibility and the other filter', () => {
  const saved = [];
  const context = { DEFAULT_SMOOTHING: 0.2, isCharacter: () => true,
    URLSearchParams, ready: true, temporalActive: true, urlTimer: null, params: new URLSearchParams('view=layers&unopened=hide&flat=hide'),
    opt: { layout: 'layers', camera: 'locked', glare: 'full', edges: true, readingPosition: true,
      readingOverview: 'named', mode: 'story', speed: 1, depth: 4, hideUnopened: true, hideFlat: true,
      show: new Set(['events', 'numbers']), lenses: new Set() },
    currentPreset: 'story', defaultShow: () => ['events', 'numbers'], defaultDepth: () => 4,
    layerOverrides: new Map(), explicitDepth: false, explicitNoteLayout: false, explicitEverything: false, MAX_DEPTH: 4,
    lensList: [], atEnd: true, playing: false, isEverything: () => false,
    document: { getElementById: () => ({ hidden: true }) }, qrPanel: { hidden: true },
    location: { pathname: '/model-token/' }, history: { replaceState: (_state, _title, url) => saved.push(url) },
    clearTimeout() {}, setTimeout() { throw new Error('An explicit filter change must save immediately.'); },
  };
  vm.createContext(context); vm.runInContext(syncURLSource, context);
  context.syncURL(true);
  let url = new URL(saved.at(-1), 'http://127.0.0.1:1234');
  assert.equal(url.searchParams.get('unopened'), 'hide');
  assert.equal(url.searchParams.get('flat'), 'hide');
  assert.equal(url.searchParams.has('show'), false, 'filtering does not freeze the implicit layer defaults');
  context.opt.hideUnopened = false; context.syncURL(true);
  url = new URL(saved.at(-1), 'http://127.0.0.1:1234');
  assert.equal(url.searchParams.has('unopened'), false, 'clearing the filter removes the earlier URL preference');
  assert.equal(url.searchParams.get('flat'), 'hide', 'clearing one filter preserves the other');
  context.opt.hideFlat = false; context.opt.hideUnopened = true; context.syncURL(true);
  url = new URL(saved.at(-1), 'http://127.0.0.1:1234');
  assert.equal(url.searchParams.has('flat'), false);
  assert.equal(url.searchParams.get('unopened'), 'hide');
});

test('shared URLs preserve coarse scope and each detail level, then clear them when global depth is chosen', () => {
  const saved = [];
  const context = { DEFAULT_SMOOTHING: 0.2, isCharacter: () => true,
    URLSearchParams, ready: true, temporalActive: true, urlTimer: null,
    params: new URLSearchParams('view=layers&scope=old-scope&detail=4'),
    opt: { layout: 'layers', camera: 'locked', glare: 'soft', edges: true, readingPosition: false,
      readingOverview: 'story', mode: 'story', speed: 1, depth: 4, hideFlat: true, hideUnopened: true,
      detailLevel: 0, processScope: 'event:engine/mill', show: new Set(['events', 'processes']), lenses: new Set() },
    currentPreset: 'story', defaultShow: () => ['events', 'processes'], defaultDepth: () => 4,
    layerOverrides: new Map(), explicitDepth: false, explicitNoteLayout: false, explicitEverything: false, MAX_DEPTH: 10,
    lensList: [], atEnd: true, playing: false, isEverything: () => false,
    document: { getElementById: () => ({ hidden: true }) }, qrPanel: { hidden: true },
    location: { pathname: '/model-token/' }, history: { replaceState: (_state, _title, url) => saved.push(url) },
    clearTimeout() {}, setTimeout() { throw new Error('The explicit choice should save immediately.'); },
  };
  vm.createContext(context); vm.runInContext(syncURLSource, context);
  for (const level of [0, 1, 3, 0]) {
    context.opt.detailLevel = level; context.syncURL(true);
    const url = new URL(saved.at(-1), 'http://127.0.0.1:1234');
    assert.equal(url.searchParams.get('detail'), String(level));
    assert.equal(url.searchParams.get('scope'), 'event:engine/mill');
    assert.equal(url.searchParams.get('flat'), 'hide');
    assert.equal(url.searchParams.get('unopened'), 'hide');
  }
  context.opt.detailLevel = null; context.opt.processScope = null; context.opt.depth = 2; context.explicitDepth = true;
  context.syncURL(true);
  const url = new URL(saved.at(-1), 'http://127.0.0.1:1234');
  assert.equal(url.searchParams.has('detail'), false); assert.equal(url.searchParams.has('scope'), false);
  assert.equal(url.searchParams.get('depth'), '2');
});
