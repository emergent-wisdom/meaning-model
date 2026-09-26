import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { appendDocumentSpans } from '../viewer/public/document-spans.js';

function fixture() {
  const document = { createElement(tag) {
    return { tag, ownerDocument: document, children: [], className: '', textContent: '', style: {}, open: false,
      append(...children) { this.children.push(...children); },
      set innerHTML(value) { assert.fail(`Authored span data must not be parsed as HTML: ${value}`); } };
  } };
  const root = document.createElement('div');
  const all = (node = root) => [node, ...node.children.flatMap((child) => all(child))];
  return { root, all, text: () => all().map((node) => node.textContent).join('\n') };
}
const projection = (spans, extra = {}) => ({ coordinate: 'utf8_byte', interval: 'half_open', byteLength: 10, spans, ...extra });

test('document spans are absent without authored records and otherwise start collapsed', () => {
  const f = fixture();
  assert.equal(appendDocumentSpans(f.root, undefined), false);
  assert.equal(appendDocumentSpans(f.root, projection([])), false);
  assert.equal(f.root.children.length, 0);
  assert.equal(appendDocumentSpans(f.root, projection([{ nodeId: 'span', title: 'Explicit span', status: 'resolved', start: 4, end: 8, links: [] }])), true);
  assert.equal(f.root.children[0].tag, 'details');
  assert.equal(f.root.children[0].open, false);
  const band = f.all().find((node) => node.className === 'document-span-band');
  assert.deepEqual(band.style, { left: '40%', width: '40%' });
  assert.match(f.text(), /UTF-8 bytes \[4, 8\) of 10/);
  assert.match(f.text(), /not world time/);
});

test('unresolved or invalid spans never receive invented positions; empty spans remain points', () => {
  const f = fixture();
  appendDocumentSpans(f.root, projection([
    { nodeId: 'missing', status: 'unresolved', reason: 'boundary_not_in_projection' },
    { nodeId: 'invalid', status: 'resolved', start: 9, end: 11 },
    { nodeId: 'point', status: 'resolved', start: 5, end: 5 },
  ]));
  assert.equal(f.all().filter((node) => node.className === 'document-span-axis').length, 1);
  assert.deepEqual(f.all().find((node) => node.className === 'document-span-band point').style, { left: '50%', width: '0%' });
  assert.match(f.text(), /Unresolved: boundary_not_in_projection/);
  assert.match(f.text(), /Unresolved: invalid_byte_range/);
  const empty = fixture();
  appendDocumentSpans(empty.root, projection([{ nodeId: 'empty', status: 'resolved', start: 0, end: 0 }], { byteLength: 0 }));
  assert.deepEqual(empty.all().find((node) => node.className === 'document-span-band point').style, { left: '0%', width: '0%' });
});

test('span titles and original relation labels stay literal text and retain endpoint direction', () => {
  const f = fixture();
  const title = '<img src=x onerror=alert(1)>';
  const relation = '<em>evaluates</em>';
  appendDocumentSpans(f.root, projection([{ nodeId: 'span', title, status: 'resolved', start: 0, end: 10,
    links: [{ family: 'semantic', relation, source: { kind: 'anchor', anchor_kind: 'process', anchor_id: 'author.metric' }, target: { kind: 'node', node_id: 'span' } }] }]));
  assert.ok(f.all().some((node) => node.className === 'document-span-title' && node.textContent === title));
  assert.ok(f.all().some((node) => node.className === 'document-span-link' && node.textContent === `semantic / ${relation}: process:author.metric → node:span`));
  assert.equal(f.all().some((node) => node.tag === 'img' || node.tag === 'em'), false);
});

test('opening a part renders the whole manuscript including its root, and beginning resets reader scroll', () => {
  const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
  const readerCode = source.slice(source.indexOf('const readerUnits ='), source.indexOf("document.getElementById('read').addEventListener"));
  assert.ok(readerCode.includes('function renderReader('));
  const elements = {
    'reader-body': { children: [], replaceChildren() { this.children = []; }, append(node) { this.children.push(node); } },
    'reader-status': { textContent: '' }, reader: { scrollTop: 900 },
  };
  const units = [{ id: 'root', role: 'document_root', text: '# Root title' }, { id: 'p1', text: 'First passage.' }, { id: 'p2', text: 'Second passage.' }];
  const context = { data: { story: { units } }, document: {
    getElementById: (id) => elements[id],
    createElement: (tag) => ({ tag, innerHTML: '', scrollIntoView() { this.scrolledIntoView = true; } }),
  }, storyParts: [{ n: 1, unit: units[1] }, { n: 2, unit: units[2] }], titleText: 'The whole book', inline: (text) => text,
  readerShown: 0, building: () => true, bornAt: () => 100, tau: 0 };
  vm.createContext(context); vm.runInContext(`${readerCode}\nrenderReader('p2');`, context);
  assert.deepEqual(elements['reader-body'].children.map((node) => node.innerHTML), ['The whole book', 'First passage.', 'Second passage.']);
  assert.equal(elements['reader-body'].children[2].scrolledIntoView, true);
  assert.equal(elements['reader-status'].textContent, 'Full story · Part 2 of 2');
  vm.runInContext('renderReader();', context);
  assert.equal(elements.reader.scrollTop, 0);
  assert.equal(elements['reader-body'].children.length, 3);
  assert.equal(elements['reader-status'].textContent, 'Full story · All 2 parts');
});
