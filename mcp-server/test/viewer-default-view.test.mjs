import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultViewURL, forgetSavedView } from '../viewer/public/default-view.js';

const storage = (entries) => {
  const map = new Map(Object.entries(entries));
  return { get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null, removeItem: (key) => map.delete(key), keys: () => [...map.keys()] };
};

test('Default opens the same model with nothing chosen', () => {
  assert.equal(defaultViewURL('https://example.org/meaning-model/twelve-words/?view=layers&depth=4&reading=full#part-3'), 'https://example.org/meaning-model/twelve-words/');
  assert.equal(defaultViewURL('http://localhost:8765/0123abcd/'), 'http://localhost:8765/0123abcd/');
});

test("forgetting a model's saved view leaves other models and unrelated keys alone", () => {
  const saved = storage({
    'meaning-model-view:/meaning-model/twelve-words/': 'x', 'meaning-model-live:/meaning-model/twelve-words/:model': 'y',
    'meaning-model-view:/meaning-model/nora-vale/': 'z', 'unrelated': 'q',
  });
  forgetSavedView(saved, 'https://example.org/meaning-model/twelve-words/?view=terrain');
  assert.deepEqual(saved.keys(), ['meaning-model-view:/meaning-model/nora-vale/', 'unrelated']);
});

test('the Default button is on the toolbar and stays available in every representation', () => {
  const page = readFileSync(new URL('../viewer/public/index.html', import.meta.url), 'utf8');
  const start = readFileSync(new URL('../viewer/public/start.js', import.meta.url), 'utf8');
  assert.match(page, /<button class="tool" id="default-view"/);
  // The toolbar's other controls are marked temporal (hidden in Graph, Structure and Space) unless listed here.
  assert.match(start, /\['story', 'default-view', 'coarse-view'/);
});
