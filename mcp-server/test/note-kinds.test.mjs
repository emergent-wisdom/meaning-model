// The Understanding Graph paper's note kinds and relations, in both authoring paths and in the viewer, which names a
// note's own kind from its stored type so the kinds need no list there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const line = (start) => { const from = source.indexOf(start); assert.ok(from >= 0, `Missing viewer line ${start}`); return source.slice(from, source.indexOf('\n', from)); };
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `Missing viewer function ${name}`);
  return source.slice(start, end + 2);
}

test('a note is named by its own kind, from its stored type, beside its category', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([line('const TYPE_WORDS ='), line('const kindWords ='), functionSource('typeWord'), 'this.typeWord = typeWord; this.kindWords = kindWords;'].join('\n'), context);
  assert.equal(context.typeWord('understanding.surprise', 'thought'), 'Surprise');
  assert.equal(context.typeWord('understanding.serendipity', 'thought'), 'Serendipity');
  assert.equal(context.typeWord('understanding.report', 'thought'), 'Report', 'a type with its own word keeps it');
  // A story author's reflections are named the same way; prose, world stages and direction keep their own names.
  for (const [type, word] of [['storytelling.surprise', 'Surprise'], ['storytelling.hypothesis', 'Hypothesis'], ['storytelling.experiment', 'Experiment']]) assert.equal(context.typeWord(type, 'author'), word, type);
  assert.equal(context.typeWord('storytelling.idea', 'author'), 'Idea', 'a reflection with its own word keeps it');
  assert.equal(context.typeWord('storytelling.passage', 'passage'), null);
  assert.equal(context.kindWords('Thought', context.typeWord('understanding.tension', 'thought')), 'Thought · Tension');
  assert.equal(context.kindWords('Author record', context.typeWord('storytelling.tension', 'author')), 'Author record · Tension');
  assert.equal(context.kindWords('Thought', null), 'Thought');
});

test('a story author records the same kinds and relations as life_understanding_record', async () => {
  const { authorRecordSchema } = await import('../src/storytelling-authoring.mjs');
  const { noteKinds, linkRelations } = await import('../src/construction-record.mjs');
  const record = (kind, relation) => authorRecordSchema.parse({ graphHash: 'a'.repeat(64), requestId: 'r', nodeId: 'n', storyRootId: 'book', authorId: 'author',
    accessScopes: ['author'], kind, text: 'A thought about the story.', links: [{ relation, targetNodeId: 'other' }] });
  for (const kind of ['surprise', 'tension', 'hypothesis', 'experiment']) assert.equal(record(kind, 'about').kind, kind);
  for (const relation of ['validates', 'invalidates', 'questions', 'contextualizes', 'abstracts_from', 'diverse_from']) assert.equal(record('idea', relation).links[0].relation, relation);
  assert.ok(['surprise', 'tension', 'serendipity'].every((kind) => noteKinds.includes(kind)) && linkRelations.includes('validates'));
});
