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
