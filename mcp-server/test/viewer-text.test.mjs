import assert from 'node:assert/strict';
import test from 'node:test';
import { buildViewerData } from '../src/viewer-data.mjs';
import { appendLegendNames } from '../viewer/public/common.js';

// An instrumented DOM refuses HTML parsing: model labels must reach createTextNode intact.
function documentFixture() {
  const tags = [];
  const texts = [];
  const document = {
    createElement(tag) {
      tags.push(tag);
      return { ownerDocument: document, tag, children: [], style: {},
        append(...children) { this.children.push(...children); },
        set innerHTML(value) { assert.fail(`Model labels must not enter an HTML parser: ${value}`); } };
    },
    createTextNode(text) { texts.push(text); return { nodeType: 3, textContent: text }; },
  };
  return { document, tags, texts };
}

test('a model-derived HTML-shaped person name stays literal text in viewer legends', async () => {
  const name = "A<img src=x onerror=document.title='REVIEW_XSS'>";
  const model = { id: 'legend-test', time_unit: 'year', processes: [], meaning_model: {
    referents: [{ id: 'person.a', boundary: name, lifecycle_event_id: 'life.a' }],
    events: [
      { id: 'life.a', boundary: 'A lifetime', interval: { start: 2000, end: 2030 }, participants: { subject: 'person.a' } },
      { id: 'a.is.knowledge', boundary: 'A learns', interval: { start: 2000, end: 2030 }, participants: { subject: 'person.a' } },
    ],
    event_relations: [{ id: 'r', kind: 'contains', source_event_id: 'life.a', target_event_id: 'a.is.knowledge' }],
    normalized_cuts: [],
  } };
  const data = await buildViewerData({ history: {
    models: [{ modelHash: 'a'.repeat(64), definition: model }], revisions: [],
  } });
  assert.equal(data.people[0].name, name, 'the model can legitimately contain HTML-shaped text');
  const { document, tags, texts } = documentFixture();
  const legend = document.createElement('div');
  appendLegendNames(legend, [[data.people[0].name, '#3987e5']]);
  assert.deepEqual(texts, [name]);
  assert.deepEqual(tags, ['div', 'div', 'span', 'i'], 'no model-authored HTML element is created');
  assert.equal(legend.children[0].children[0].children[1].textContent, name);
});

test('legend labels retain punctuation and markup-looking names without decoding them', () => {
  const { document, texts } = documentFixture();
  const names = ['Åsa & Bo', '</span><svg onload=alert(1)>', '&lt;script&gt;', '"quoted"'];
  appendLegendNames(document.createElement('div'), names.map((name) => [name, '#3987e5']));
  assert.deepEqual(texts, names);
});
