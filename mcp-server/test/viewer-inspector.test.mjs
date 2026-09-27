import test from 'node:test';
import assert from 'node:assert/strict';
import { showInspector } from '../viewer/public/inspector.js';

function dom() {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.handlers = {}; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(' '); }
    set innerHTML(value) { assert.fail(`Model content reached an HTML parser: ${value}`); }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    set open(value) { this._open = value; this.handlers.toggle?.(); }
    get open() { return this._open; }
    querySelector(tag) { return all(this).find((node) => node !== this && node.tagName === tag.toUpperCase()) ?? null; }
    scrollIntoView() { this.scrolled = true; }
    focus() { this.focused = true; }
  }
  const document = Object.assign(new EventTarget(), { createElement: (tag) => new Element(tag), querySelector: () => null, head: new Element('head'), body: new Element('body') });
  return document;
}
function all(node) { return [node, ...node.children.flatMap(all)]; }
function expand(document, title) {
  const found = all(document.body).find((node) => node.tagName === 'DETAILS' && node.children[0]?.textContent.startsWith(title));
  assert.ok(found, `Missing details: ${title}`); found.open = true; return found;
}
function fixture() {
  return { viewKind: 'timeline', title: '<img src=x onerror=alert(1)>', story: { units: [{ text: '# One\nFirst.' }, { text: '# Two\nLast.' }] }, inspection: { model: {
    time_unit: 'ticks', processes: [{ id: 'p', value_type: { kind: 'number' }, initial_value: { kind: 'number', value: 0 } }], decomposition: [], meaning_model: {
      events: [{ id: 'a', boundary: 'Root Event', interval: { start: 1, end: 3 } }, { id: 'b', boundary: 'Shared child' }, { id: 'c', boundary: 'Other parent' }],
      event_relations: [['ab','a','b'], ['ac','a','c'], ['cb','c','b'], ['ba','b','a']].map(([id,source_event_id,target_event_id]) => ({ id, source_event_id, target_event_id, kind: 'contains' })),
      context_roots: [{ event_id: 'a', kind: 'accepted_world' }], normalized_cuts: [
        { id: 'q', parent_event_id: 'a', question: 'Where?', unit: 'attention', answers: [{ key: 'deciding', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] },
        { id: 'q2', parent_event_id: 'a', question: 'How?', unit: 'deciding attention', conditioning: { cut_id: 'q', answer_key: 'deciding' }, answers: [{ key: '<script>x</script>', weight: 0.25 }, { key: 'remainder', weight: 0.75 }] },
      ],
    },
  } } };
}
function withDom(run) {
  const previous = { document: globalThis.document, location: globalThis.location };
  globalThis.document = dom(); globalThis.location = new URL('http://127.0.0.1:1234/token/?reading=hidden&view=structure');
  try { run(globalThis.document); } finally { globalThis.document = previous.document; globalThis.location = previous.location; }
}

test('structure expands lazily, preserves shared and cyclic references, and keeps the full manuscript', () => withDom((document) => {
  const data = fixture(); showInspector(data);
  assert.equal(all(document.body).filter((node) => node.tagName === 'PRE').length, 0);
  assert.equal(all(document.body).filter((node) => node.className === 'inspection-prose').length, 2);
  expand(document, 'Root Event'); expand(document, 'Shared child'); expand(document, 'Other parent');
  const content = document.body.textContent;
  assert.match(content, /Cycle reference · a/); assert.match(content, /Shared reference · b/);
  assert.match(content, /1 → 3 ticks/); assert.match(content, /Context: Accepted world/);
  assert.deepEqual(all(document.body).filter((node) => node.className === 'inspection-prose').map((node) => node.textContent), ['One First.', 'Two Last.']);
  const literal = expand(document, 'Literal rendered source');
  assert.equal(literal.querySelector('pre').textContent, '# One\nFirst.\n\n# Two\nLast.');
  expand(document, 'Process decomposition'); assert.match(document.body.textContent, /No process decomposition edges are declared/);
  assert.equal(all(document.body).some((node) => node.tagName === 'A' && node.textContent === 'Return to visual view'), false);
}));

test('calendar metadata stays compact and prose headings and wraps render safely with source preserved', () => withDom((document) => {
  const data = fixture(); data.modelHash = 'a'.repeat(64); data.inspection.model.time_unit = 'civil_day_since_1970_01_01';
  data.story.units = [{ text: '## A heading\n\nA wrapped\nparagraph with <img src=x>.\n\nLast paragraph.' }];
  showInspector(data);
  assert.match(document.body.textContent, /Time: calendar days/); assert.ok(!document.body.textContent.includes(data.modelHash));
  const article = all(document.body).find((node) => node.className === 'inspection-prose');
  assert.deepEqual(article.children.map((node) => [node.tagName, node.textContent]), [['H2', 'A heading'], ['P', 'A wrapped paragraph with <img src=x>.'], ['P', 'Last paragraph.']]);
  expand(document, 'Snapshot details'); assert.ok(document.body.textContent.includes(data.modelHash));
  const literal = expand(document, 'Literal rendered source'); assert.equal(literal.querySelector('pre').textContent, data.story.units[0].text);
}));

test('conditional answers remain nested local weights and model-authored markup remains text', () => withDom((document) => {
  showInspector(fixture()); expand(document, 'Root Event');
  const parent = expand(document, 'Where?'); assert.match(parent.textContent, /Conditional Cuts · 1/);
  const child = expand(document, 'How?Cut');
  assert.match(child.textContent, /Owning Event: a/); assert.match(child.textContent, /Conditional on q → deciding/);
  assert.deepEqual(all(child).filter((node) => node.className === 'inspection-weight').map((node) => node.textContent), ['0.25', '0.75']);
  assert.ok(all(child).some((node) => node.tagName === 'SPAN' && node.textContent === '<script>x</script>'));
  assert.equal(all(document.body).some((node) => node.tagName === 'IMG' || node.tagName === 'SCRIPT'), false);
  assert.ok(all(document.body).some((node) => node.tagName === 'H1' && node.textContent === '<img src=x onerror=alert(1)>'));
}));

test('embedded Structure preserves the shared shell, selected native records and expanded branches across switches', () => withDom((document) => {
  const shell = document.createElement('header'), host = document.createElement('div'), selections = [];
  shell.textContent = 'Shared representation controls'; document.body.append(shell, host);
  const controller = showInspector(fixture(), null, { host, onSelect: (selection) => selections.push(selection) });
  assert.equal(document.body.children[0], shell);
  assert.equal(document.body.className, undefined, 'an embedded Structure does not replace the page presentation');
  controller.activate('structure', { selection: { kind: 'event', id: 'b' } });
  const selection = all(host).find((node) => node.className === 'inspection-selection');
  assert.equal(selection.hidden, false); assert.match(selection.textContent, /Shared child/);
  // Opening a row selects it and the Selected section follows at once; closing the selected row lets it go.
  const root = all(host).find((node) => node.tagName === 'DETAILS' && node.children[0]?.textContent.startsWith('Root Event'));
  root.children[0].handlers.click(); root.open = true;
  assert.deepEqual(selections, [{ kind: 'event', id: 'a' }]);
  assert.match(selection.textContent, /Root Event/); assert.equal(root.children[0]['aria-current'], 'true');
  root.children[0].handlers.click(); root.open = false;
  assert.deepEqual(selections, [{ kind: 'event', id: 'a' }, null]); assert.equal(selection.hidden, true); assert.equal(root.children[0]['aria-current'], undefined);
  // Closing a row that is not the selection leaves the selection alone; Clear selection lets it go.
  root.children[0].handlers.click(); root.open = true;
  const child = expand(document, 'Shared child'); child.children[0].handlers.click();
  assert.deepEqual(selections.at(-1), { kind: 'event', id: 'a' });
  all(selection).find((node) => node.tagName === 'BUTTON' && node.textContent === 'Clear selection').handlers.click();
  assert.equal(selections.at(-1), null); assert.equal(selection.hidden, true);
  controller.deactivate(); controller.activate('structure', { selection: { kind: 'normalized_cut', id: 'q' } });
  assert.equal(root.open, true, 'switching back keeps the reader\'s expanded tree');
  assert.match(selection.textContent, /Where\?/);
  controller.activate('structure', { selection: null }); assert.equal(selection.hidden, true);
  assert.equal(all(host).filter((node) => node.className === 'inspection-prose').length, 2);
}));

test('Escape clears Structure selection only while Structure is active and stops after destruction', () => withDom((document) => {
  const host = document.createElement('div'), selections = [];
  document.body.append(host);
  const controller = showInspector(fixture(), null, { host, onSelect: (selection) => selections.push(selection) });
  const record = { kind: 'event', id: 'a' };
  const escape = () => document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  controller.activate('structure', { selection: record });
  const selected = all(host).find((node) => node.className === 'inspection-selection');
  const row = all(host).find((node) => node.tagName === 'SUMMARY' && node.textContent.startsWith('Root Event'));
  escape();
  assert.deepEqual(selections, [null]); assert.equal(selected.hidden, true); assert.equal(row['aria-current'], undefined);
  controller.activate('structure', { selection: record }); controller.deactivate(); escape();
  assert.deepEqual(selections, [null]); assert.equal(selected.hidden, false, 'an inactive view must not clear another view’s selection');
  controller.activate('structure', { selection: record }); controller.destroy(); escape();
  assert.deepEqual(selections, [null]);
}));
