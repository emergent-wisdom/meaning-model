import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeSimulationService } from '../src/service.mjs';
import { LENS_SCHEMA, defineLens, lensQuestions, lensUnit } from '../src/lenses.mjs';
import { readOpenQuestions } from '../src/model-questions.mjs';
import { proposalFromProbabilities } from '../src/cut-shares.mjs';
import { readFile } from 'node:fs/promises';
import { releaseStory } from '../src/storytelling-release.mjs';
import { direct, directorPrinciples } from '../src/storytelling-director.mjs';
import { editNarrativeGraph } from '../src/narrative-editing.mjs';

// Regressions for the defects an independent review reproduced on 26 September 2026.

test('a lens revised from a stale graph hash is written at the newest head, as its next version', async () => {
  const service = new LifeSimulationService();
  try {
    await service.initialize();
    const provenance = ['review-regression'];
    const model = await service.registerModel({ requestId: 'm', model: { schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'hour', revision: { number: 0, reason: 'Regression', provenance },
      processes: [{ id: 'p', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 }, uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['w'], access_scopes: [] }],
      decomposition: [], dependencies: [], laws: [], initial_claims: [] } });
    const graph = await service.registerNarrativeGraph({ requestId: 'g', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'g', revision: { number: 0, reason: 'Regression', provenance },
      source: { kind: 'model', model_hash: model.modelHash }, roots: ['book'],
      nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
    const input = { graphHash: graph.graphHash, requestId: 'r1', accessScopes: ['author'], holder: 'writer',
      lens: { id: 'stage', name: 'Stage', question: 'What stage is {subject}?', appliesTo: ['event'], why: 'Distinguishes a stage in development.' }, about: [{ nodeId: 'book' }] };
    const first = await defineLens(service, input);
    assert.equal(first.lensNodeId, 'lens.stage'); assert.equal(first.version, 1);
    const second = await defineLens(service, { ...input, requestId: 'r2', lens: { ...input.lens, question: 'What later stage is {subject}?' } });
    assert.equal(second.lensNodeId, 'lens.stage.r2'); assert.equal(second.supersedes, 'lens.stage'); assert.equal(second.advancedFrom, graph.graphHash);
    const retried = await defineLens(service, { ...input, requestId: 'r2', lens: { ...input.lens, question: 'What later stage is {subject}?' } });
    assert.equal(retried.lensNodeId, 'lens.stage.r2'); assert.equal(retried.graphHash, second.graphHash);
  } finally { await service.close(); }
});

test('timed questions without a story graph say the draws are unknown instead of failing', async () => {
  const personModel = { id: 'demo', meaning_model: { referents: [{ id: 'person.ana', lifecycle_event_id: 'ana.life' }],
    events: [{ id: 'ana.life', interval: { start: 0, end: 80 } }, { id: 'ana.life.is.work', interval: { start: 0, end: 80 } }],
    event_relations: [{ kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' }],
    normalized_cuts: [{ id: 'ana.want', parent_event_id: 'ana.life', unit: 'motivational attention', question: 'What does Ana want?', answers: [{ key: 'rest', weight: 1 }] }] } };
  const result = await readOpenQuestions({ inspectModel: async () => ({ model: personModel }) }, { modelHash: 'a'.repeat(64), at: 30 });
  assert.equal(result.states[0].drawHistory, 'unknown');
  assert.equal(result.states[0].undrawnBefore, null);
});

test('answers to an earlier version of a lens are stale and asked again', async () => {
  const before = { schema: LENS_SCHEMA, id: 'motive', name: 'Motive', appliesTo: ['event'], question: 'Was {subject} generous or selfish?', answers: [{ key: 'generous', meaning: 'For others' }, { key: 'selfish', meaning: 'For self' }], why: 'Identify motives.' };
  const after = { ...before, question: 'Was {subject} a hedge or speculation?', answers: [{ key: 'hedge', meaning: 'Reducing risk' }, { key: 'speculation', meaning: 'Seeking upside' }] };
  const node = (id, data) => ({ id, node_type: 'understanding.lens', text: JSON.stringify({ data }) });
  const anchor = (id) => ({ source: { kind: 'node', node_id: id }, relation: 'about', target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'act' } });
  const view = { graph: { source: { model_hash: 'a'.repeat(64) } }, nodes: [node('lens.motive', before), node('lens.motive.r2', after)],
    edges: [anchor('lens.motive'), anchor('lens.motive.r2'), { source: { kind: 'node', node_id: 'lens.motive.r2' }, relation: 'supersedes', target: { kind: 'node', node_id: 'lens.motive' } }] };
  const cut = (unit) => ({ id: 'lens.motive.act', parent_event_id: 'act', question: 'Was it generous or selfish?', ...(unit ? { unit } : {}), answers: [{ key: 'generous', weight: 0.9 }, { key: 'selfish', weight: 0.05 }, { key: 'remainder', weight: 0.05 }] });
  const ask = async (answer) => (await lensQuestions({ queryNarrativeGraph: async () => view, inspectModel: async () => ({ model: { meaning_model: {
    events: [{ id: 'act', boundary: 'Ana buys shares', interval: { start: 1, end: 2 } }], normalized_cuts: [answer] } } }) }, { graphHash: 'b'.repeat(64), lensIds: ['motive'] })).lenses[0];
  for (const answer of [cut(null), cut(lensUnit(before))]) {
    const result = await ask(answer);
    assert.equal(result.question, after.question); assert.equal(result.version, 2);
    assert.equal(result.answered, 0); assert.equal(result.stale, 1);
    assert.equal(result.open[0].cutId, 'lens.motive.act'); assert.equal(result.open[0].replaceExisting, true); assert.equal(result.open[0].unit, lensUnit(after));
  }
  const current = await ask({ ...cut(lensUnit(after)), answers: [{ key: 'hedge', weight: 0.8 }, { key: 'remainder', weight: 0.2 }] });
  assert.equal(current.answered, 1); assert.equal(current.stale, 0);
  // An unsigned answer from before signatures counts when it asks the revised lens's own question with its answers.
  const legacy = await ask({ ...cut(null), question: 'Was "Ana buys shares" a hedge or speculation?', answers: [{ key: 'hedge', weight: 0.8 }, { key: 'remainder', weight: 0.2 }] });
  assert.equal(legacy.answered, 1); assert.equal(legacy.stale, 0);
});

test('an unsigned answer left unchanged since a lens was revised is stale; one given after it counts', async () => {
  const v1 = { schema: LENS_SCHEMA, id: 'voice', name: 'Voice', appliesTo: ['event'], question: 'Is {subject} in a script or own voice?', answers: [{ key: 'script', meaning: 'another\'s words' }, { key: 'own', meaning: 'their own' }], why: 'Whose words.' };
  const v2 = { ...v1, answers: [...v1.answers, { key: 'silence', meaning: 'says nothing' }] };
  const held = 'c'.repeat(64);
  const view = { graph: { source: { model_hash: 'a'.repeat(64) } },
    nodes: [{ id: 'lens.voice', node_type: 'understanding.lens', text: JSON.stringify({ data: v1 }) }, { id: 'lens.voice.r2', node_type: 'understanding.lens', text: JSON.stringify({ data: v2 }), provenance: [`written-against-model:${held}`] }],
    edges: ['lens.voice', 'lens.voice.r2'].flatMap((id) => [{ source: { kind: 'node', node_id: id }, relation: 'about', target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'x' } }, { source: { kind: 'node', node_id: id }, relation: 'about', target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'y' } }])
      .concat([{ source: { kind: 'node', node_id: 'lens.voice.r2' }, relation: 'supersedes', target: { kind: 'node', node_id: 'lens.voice' } }]) };
  const events = [{ id: 'x', boundary: 'She reads the statement', interval: { start: 1, end: 2 } }, { id: 'y', boundary: 'She says nothing', interval: { start: 3, end: 4 } }];
  const early = [{ id: 'lens.voice.x', parent_event_id: 'x', question: 'Voice?', answers: [{ key: 'script', weight: 0.9 }, { key: 'remainder', weight: 0.1 }] },
    { id: 'lens.voice.y', parent_event_id: 'y', question: 'Voice?', answers: [{ key: 'own', weight: 0.6 }, { key: 'remainder', weight: 0.4 }] }];
  const now = [early[0], { ...early[1], answers: [{ key: 'silence', weight: 0.9 }, { key: 'remainder', weight: 0.1 }] }];
  const models = { [held]: { meaning_model: { events, normalized_cuts: early } } };
  const result = (await lensQuestions({ queryNarrativeGraph: async () => view, inspectModel: async ({ modelHash }) => ({ model: models[modelHash] ?? { meaning_model: { events, normalized_cuts: now } } }) },
    { graphHash: 'b'.repeat(64), lensIds: ['voice'] })).lenses[0];
  assert.equal(result.version, 2); assert.equal(result.answered, 1); assert.equal(result.stale, 1);
  assert.deepEqual(result.open.map((item) => [item.eventId, item.stale]), [['x', 'it was given before this lens was revised']]);
});

// Readings on a life, for trajectories.
const life = (answersA, answersB) => ({ meaning_model: {
  referents: [{ id: 'person.ana', boundary: 'Ana Berg', lifecycle_event_id: 'ana.life' }],
  events: [{ id: 'ana.life', interval: { start: 1980, end: 2030 }, participants: { subject: 'person.ana' } }, { id: 'ana.life.is.work', interval: { start: 1980, end: 2030 } },
    { id: 'ana.a', boundary: 'First act', interval: { start: 2005, end: 2005.1 }, participants: { subject: 'person.ana' } },
    { id: 'ana.b', boundary: 'Second act', interval: { start: 2015, end: 2015.1 }, participants: { subject: 'person.ana' } }],
  event_relations: [{ kind: 'contains', source_event_id: 'ana.life', target_event_id: 'ana.life.is.work' }],
  normalized_cuts: [{ id: 'd.a', unit: 'decision', parent_event_id: 'ana.a', question: 'A?', answers: [{ key: 'yes', weight: 1 }] }, { id: 'd.b', unit: 'decision', parent_event_id: 'ana.b', question: 'B?', answers: [{ key: 'yes', weight: 1 }] },
    { id: 'lens.stage.ana.a', parent_event_id: 'ana.a', question: 'Stage?', answers: answersA }, { id: 'lens.stage.ana.b', parent_event_id: 'ana.b', question: 'Stage?', answers: answersB }] } });
const stageLens = { schema: LENS_SCHEMA, id: 'stage', name: 'Stage', appliesTo: ['act'], question: 'Is {subject} bartering or standing?', answers: [{ key: 'bartering', meaning: 'for a reaction' }, { key: 'standing', meaning: 'regardless' }], why: 'It changes what a setback does.' };
const stageView = { graph: { source: { model_hash: 'a'.repeat(64) } }, nodes: [{ id: 'lens.stage', node_type: 'understanding.lens', text: JSON.stringify({ data: stageLens }) }],
  edges: [{ source: { kind: 'node', node_id: 'lens.stage' }, target: { kind: 'anchor', anchor_kind: 'referent', anchor_id: 'person.ana' }, relation: 'about' }] };
const trajectories = async (a, b) => (await lensQuestions({ queryNarrativeGraph: async () => stageView, inspectModel: async () => ({ model: life(a, b) }) }, { graphHash: 'b'.repeat(64), lensIds: ['stage'] })).lenses[0].trajectories;
const w = (bartering, standing) => [{ key: 'bartering', weight: bartering }, { key: 'standing', weight: standing }, { key: 'remainder', weight: +(1 - bartering - standing).toFixed(4) }];

test('readings that are mostly remainder assert no change', async () => {
  const kinds = (await trajectories(w(0.01, 0), w(0, 0.01))).map((item) => item.kind);
  assert.deepEqual(kinds, ['unclear']);
});

test('a clear move is a change, a close call a possible change, and a large move under one answer a shift', async () => {
  assert.equal((await trajectories(w(0.8, 0.1), w(0.1, 0.8)))[0].kind, 'change');
  assert.equal((await trajectories(w(0.46, 0.44), w(0.44, 0.46)))[0].kind, 'possible-change');
  assert.equal((await trajectories(w(0.9, 0.05), w(0.5, 0.4)))[0].kind, 'shift');
});

test('an estimator\'s underfull shares are scaled up, not poured into the remainder', () => {
  const rounded = proposalFromProbabilities({ answers: [{ key: 'a' }, { key: 'b' }], question: 'Why?', unit: 'share', idPrefix: 'lens.x' }, { id: 'e', parentEventId: 'e' },
    { a: 0.5, b: 0.489, remainder: 0.001 }, { label: 'typesafe:test', requireComplete: true });
  assert.ok(Math.abs(rounded.answers[0].weight - 0.5 / 0.99) < 1e-9);
  assert.ok(Math.abs(rounded.answers[2].weight - 0.001 / 0.99) < 1e-9);
  assert.match(rounded.provenance.join(' | '), /summed to 0\.9900 and were normalized/u);
});

// A release reads the director's record of the prose it read.
const provenance = ['release regression'];
const author = ['story-author'];
const scene = (id, text, scopes, extra = {}) => ({ id, node_type: 'storytelling.scene', role: 'story_passage', text, epistemic_status: 'authored_scene', evidence_type: 'fictional_canon',
  authority: { source: 'author', weight: 1 }, access_scopes: scopes, render: 'include', training: 'exclude', provenance, ...extra });
const contains = (id, from, to, order, scopes) => ({ id, source: { kind: 'node', node_id: from }, target: { kind: 'node', node_id: to }, family: 'structural', relation: 'contains', order, access_scopes: scopes, provenance });
const release = (service, graphHash) => releaseStory(service, { graphHash, requestId: `release-${Math.random()}`, nodeId: `author.release.${Math.random().toString(36).slice(2, 8)}`,
  storyRootId: 'story', authorId: 'author', accessScopes: author, releaseTo: ['reader'], reason: 'The human approved publishing.' });
const directed = async (service, graphHash, storyRootId = 'story') => (await direct(service, { graphHash, requestId: `direct-${Math.random()}`, storyRootId, accessScopes: author, stage: 'draft',
  directorId: 'fresh-reader', independent: true, nodeId: `direction.${Math.random().toString(36).slice(2, 8)}`, summary: 'The director read the draft.',
  findings: directorPrinciples.filter((item) => item.stage === 'draft').map((item) => ({ principleId: item.id, verdict: 'holds', evidence: 'Read against this principle.', modelChange: null })),
  ownFindings: [{ name: 'The door as witness', verdict: 'holds', evidence: 'The draft keeps the door present.', modelChange: null }] })).graphHash;
async function story(t, roots = ['story'], nodes = [scene('scene.1', 'This is the draft the director read.', author)], edges = [contains('story.s1', 'story', 'scene.1', 0, author)]) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService(); t.after(() => service.close()); await service.initialize();
  const registered = await service.registerModel({ requestId: 'model', model: registerRequest.model });
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'release-regression',
    revision: { number: 0, reason: 'Release regression.', provenance }, source: { kind: 'model', model_hash: registered.modelHash }, roots,
    nodes: [...roots.map((root) => ({ ...scene(root, `# ${root}`, []), node_type: 'story', role: 'document_root' })), ...nodes], edges } });
  return { service, graphHash: stored.graphHash };
}

test('prose rewritten after the draft direction cannot be released under it', async (t) => {
  const f = await story(t);
  const reviewed = await directed(f.service, f.graphHash);
  const edited = await editNarrativeGraph(f.service, { requestId: 'rewrite', graphHash: reviewed, accessScopes: author, reason: 'Replace the manuscript after its draft direction.',
    operations: [{ kind: 'replace_text', nodeId: 'scene.1', expectedText: 'This is the draft the director read.', text: 'An entirely different ending that no director read.' }] });
  await assert.rejects(release(f.service, edited.graphHash), /prose has changed since the director read it/u);
  const again = await directed(f.service, edited.graphHash);
  const released = await release(f.service, again);
  assert.ok(released.graphHash);
});

test('the director\'s draft task renders only the story it directs', async (t) => {
  const f = await story(t, ['story', 'other'], [scene('scene.1', 'The story being directed.', author), scene('scene.2', 'Another story in the same graph.', author)],
    [contains('story.s1', 'story', 'scene.1', 0, author), contains('other.s1', 'other', 'scene.2', 0, author)]);
  const task = await direct(f.service, { graphHash: f.graphHash, requestId: 'task', storyRootId: 'story', accessScopes: author, stage: 'draft', directorId: 'fresh-reader', independent: true });
  assert.match(task.text, /The story being directed/u); assert.doesNotMatch(task.text, /Another story/u);
});
