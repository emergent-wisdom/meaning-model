import assert from 'node:assert/strict';
import test from 'node:test';
import { direct, directionState, directorPrinciples, DIRECTION_SCHEMA } from '../src/storytelling-director.mjs';

const graphHash = 'a'.repeat(64);
const service = { async queryNarrativeGraph() { return { graph_hash: graphHash, content_included: true, nodes: [], edges: [], graph: { source: { kind: 'model', model_hash: 'f'.repeat(64) } } }; } };
const findings = (stage, change = {}) => directorPrinciples.filter((item) => item.stage === stage).map((item) => ({ principleId: item.id, verdict: 'holds', evidence: 'Read against the principle.', modelChange: null, ...(change[item.id] ?? {}) }));
const own = [{ name: 'Something no principle names', verdict: 'holds', evidence: 'Read beyond the principles.', modelChange: null }];
const input = (extra) => ({ graphHash, requestId: 'r', storyRootId: 'book', accessScopes: ['author'], stage: 'world', directorId: 'fresh', independent: true, nodeId: 'direction', summary: 'A direction.', ownFindings: own, ...extra });

test('a direction answers every principle of its stage, and a failure names its model or prose repair', async () => {
  await assert.rejects(direct(service, input({ findings: findings('world').slice(1) })), /exactly one finding for each of its principles/);
  await assert.rejects(direct(service, input({ findings: findings('world', { 'world.lives': { verdict: 'fails' } }) })), /Specify modelChange, proseChange, or both for each failure: world\.lives/);
  await assert.rejects(direct(service, input({ stage: 'draft', nodeId: undefined,
    findings: findings('draft', { 'draft.ending': { verdict: 'fails', proseChange: 'Remove the repeated explanation of the ending.' } }) })), /needs nodeId and summary/,
  'a prose-only repair reaches the recording step without demanding modelChange');
  await assert.rejects(direct(service, input({ findings: findings('world', { 'world.lives': { verdict: 'fails', proseChange: 'Remove the repeated explanation.' } }) })), /prose repair belongs to a draft direction/);
});

test('applicability belongs to the work and must carry contextual evidence', async () => {
  for (const principleId of ['world.background', 'world.plausibility']) {
    await assert.rejects(direct(service, input({ findings: findings('world', { [principleId]: { verdict: 'not-this-story', evidence: 'This miniature describes a timeless abstract setting, without the proposed historical frame.' } }), nodeId: undefined })), /needs nodeId and summary/);
  }
  await assert.rejects(direct(service, input({ findings: findings('world', { 'world.background': { verdict: 'not-this-story', evidence: '' } }) })), /Too small/);
});

test('without findings the director returns its task: the principles of the stage', async () => {
  const task = await direct({ ...service, inspectModel: async () => ({ model: { meaning_model: {} } }) }, input({ nodeId: undefined, summary: undefined }));
  assert.deepEqual(task.principles.map((item) => item.id), directorPrinciples.filter((item) => item.stage === 'world').map((item) => item.id));
  assert.match(task.instructions, /a start, not a boundary/);
  assert.match(task.instructions, /Encourage depth/);
});

test('a failing direction stays open until the model changed and a record answers it', () => {
  const node = (id, modelHash, verdict, time) => ({ id, node_type: 'storytelling.direction', subject: 'book', value_time: time,
    text: JSON.stringify({ data: { schema: DIRECTION_SCHEMA, stage: 'draft', modelHash, findings: [{ principleId: 'draft.ending', verdict }] } }) });
  const answers = { relation: 'answers', target: { kind: 'node', node_id: 'd.1' } };
  const view = (edges) => ({ nodes: [node('d.1', 'old', 'fails', 1)], edges });
  assert.equal(directionState(view([]), 'book', 'new').unanswered.length, 1, 'no record answers it');
  assert.equal(directionState(view([answers]), 'book', 'old').unanswered[0].modelUnchanged, true, 'answered in words but not in the model');
  assert.equal(directionState(view([answers]), 'book', 'new').unanswered.length, 0, 'answered in the model and in the record');
});

test('prose-only and mixed failures retain their repair requirements instead of being cleared by a note or later verdict alone', () => {
  const node = (id, signature, findings, time) => ({ id, node_type: 'storytelling.direction', subject: 'book', value_time: time,
    text: JSON.stringify({ data: { schema: DIRECTION_SCHEMA, stage: 'draft', modelHash: 'old', proseSignature: signature, findings } }) });
  const proseFailure = { principleId: 'draft.ending', verdict: 'fails', modelChange: null, proseChange: 'Remove repeated explanation.' };
  const failure = node('d.1', 'before', [proseFailure], 1);
  const passing = node('d.2', 'after', [{ principleId: 'draft.ending', verdict: 'holds' }], 2);
  const answers = [{ relation: 'answers', target: { kind: 'node', node_id: 'd.1' } }];
  const state = (nodes, edges = answers, model = 'old') => directionState({ nodes, edges }, 'book', model);
  assert.equal(state([failure]).unanswered[0].proseReviewed, false, 'a repair note alone is not a review');
  assert.equal(state([failure, passing], []).unanswered[0].answered, false, 'a passing direction alone does not answer history');
  assert.equal(state([failure, node('d.2', 'before', [{ verdict: 'holds' }], 2)]).unanswered[0].proseReviewed, false, 'unchanged prose is not a prose repair');
  assert.equal(state([failure, node('d.2', 'after', [{ verdict: 'fails' }], 2)]).unanswered[0].proseReviewed, false, 'another failed direction is not approval');
  assert.equal(state([failure, passing]).unanswered.length, 0, 'changed prose, passing review and answer suffice without model change');
  const mixed = node('d.1', 'before', [proseFailure, { principleId: 'draft.time', verdict: 'fails', modelChange: 'Repair the missing causal link.' }], 1);
  assert.equal(state([mixed, passing]).unanswered[0].modelChangeRequired, true);
  assert.equal(state([mixed, passing], answers, 'new').unanswered.length, 0, 'mixed repairs still require the model revision');
});

test('the principles are a start, not a boundary: a direction adds a finding of its own', async () => {
  await assert.rejects(direct(service, input({ findings: findings('world'), ownFindings: [] })), /at least one finding of your own/);
});

test('a discovered failure outside the catalog needs an answer and a fresh passing review too', () => {
  const node = (id, signature, ownFindings, time) => ({ id, node_type: 'storytelling.direction', subject: 'book', value_time: time,
    text: JSON.stringify({ data: { schema: DIRECTION_SCHEMA, stage: 'draft', modelHash: 'same', proseSignature: signature,
      findings: [{ principleId: 'draft.ending', verdict: 'holds' }], ownFindings } }) });
  const failure = { name: 'Unreliable unit of comparison', verdict: 'fails', modelChange: null, proseChange: 'Clarify which average the scene uses.' };
  const original = node('d.1', 'before', [failure], 1);
  const answers = [{ relation: 'answers', target: { kind: 'node', node_id: 'd.1' } }];
  const state = (nodes, edges = answers) => directionState({ nodes, edges }, 'book', 'same');
  assert.deepEqual(state([original], []).unanswered[0].failing, ['own:Unreliable unit of comparison']);
  assert.equal(state([original]).unanswered[0].proseReviewed, false);
  assert.equal(state([original, node('d.2', 'after', [failure], 2)]).unanswered[0].proseReviewed, false);
  assert.equal(state([original, node('d.2', 'after', [{ ...failure, verdict: 'holds', proseChange: null }], 2)]).unanswered.length, 0);
});

// A reviewer should not have to assemble what the principles ask about (the Book's draft director of 29 September
// ran past its output limit on a hand-built 475K packet): the world task carries the recorded world stages, and the
// draft task carries the recorded ideas, the Events the passages render, and the reviews to open.
test('the direction task carries what its principles need and asks for concise findings', async () => {
  const worldNode = { id: 'world.author', node_type: 'storytelling.world', subject: 'book', value_time: 1,
    text: JSON.stringify({ data: { schema: 'meaning-model-story-world/v1', stage: 'author_reader', author: { teach: 'That a check needs paid time of its own, conveyed through the returned table.' } } }) };
  const review = { id: 'review.readback', node_type: 'review', title: 'Blind read-back of the ideas', holder: 'reader' };
  const renders = { family: 'grounding', relation: 'renders', source: { kind: 'node', node_id: 'p1' }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: 'ev.1' } };
  const stocked = { async queryNarrativeGraph() { return { graph_hash: graphHash, content_included: true, nodes: [worldNode, review], edges: [renders], graph: { source: { kind: 'model', model_hash: 'f'.repeat(64) } } }; },
    async inspectModel() { return { model: { meaning_model: { events: [{ id: 'ev.1', boundary: 'The table returns', description: 'Guardian returns the table.', interval: { start: 1, end: 2 } }, { id: 'ev.2', boundary: 'Not rendered' }] } } }; },
    async renderNarrativeGraph() { return { text: 'The table came back.', units: [{ node_id: 'p1', text: 'The table came back.' }] }; } };
  const draft = await direct(stocked, input({ stage: 'draft', nodeId: undefined, summary: undefined }));
  assert.deepEqual(draft.renderedEvents, [{ id: 'ev.1', boundary: 'The table returns', description: 'Guardian returns the table.', interval: { start: 1, end: 2 } }]);
  assert.match(draft.ideas.teach, /paid time of its own/);
  assert.deepEqual(draft.reviews, [{ nodeId: 'review.readback', title: 'Blind read-back of the ideas', holder: 'reader' }]);
  assert.match(draft.instructions, /Keep each evidence under about 1,500 characters and each repair under about 800, and record every finding in one call/);
  const world = await direct(stocked, input({ nodeId: undefined, summary: undefined }));
  assert.match(world.world.authorReader.author.teach, /paid time of its own/);
  assert.equal(world.renderedEvents, undefined);
  assert.ok(directorPrinciples.some((item) => item.id === 'world.ideas') && directorPrinciples.some((item) => item.id === 'draft.ideas'));
});
