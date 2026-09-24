import assert from 'node:assert/strict';
import test from 'node:test';
import { direct, directionState, directorPrinciples, DIRECTION_SCHEMA } from '../src/storytelling-director.mjs';

const graphHash = 'a'.repeat(64);
const service = { async queryNarrativeGraph() { return { graph_hash: graphHash, content_included: true, nodes: [], edges: [], graph: { source: { kind: 'model', model_hash: 'f'.repeat(64) } } }; } };
const findings = (stage, change = {}) => directorPrinciples.filter((item) => item.stage === stage).map((item) => ({ principleId: item.id, verdict: 'holds', evidence: 'Read against the principle.', modelChange: null, ...(change[item.id] ?? {}) }));
const input = (extra) => ({ graphHash, requestId: 'r', storyRootId: 'book', accessScopes: ['author'], stage: 'world', directorId: 'fresh', independent: true, nodeId: 'direction', summary: 'A direction.', ...extra });

test('a direction answers every principle of its stage, and a failure says what changes in the model first', async () => {
  await assert.rejects(direct(service, input({ findings: findings('world').slice(1) })), /exactly one finding for each of its principles/);
  await assert.rejects(direct(service, input({ findings: findings('world', { 'world.lives': { verdict: 'fails' } }) })), /what must change in the model first for each failure: world\.lives/);
});

test('only a principle that cannot apply may be marked not-this-story; what is interesting never limits how much is modeled', async () => {
  await assert.rejects(direct(service, input({ findings: findings('world', { 'world.background': { verdict: 'not-this-story' } }) })), /world\.background always apply/);
  await assert.rejects(direct(service, input({ findings: findings('world', { 'world.plausibility': { verdict: 'not-this-story' } }), nodeId: undefined })), /needs nodeId and summary/,
    'plausibility may be inapplicable, so validation reaches the recording step');
});

test('without findings the director returns its task: the principles of the stage', async () => {
  const task = await direct({ ...service, inspectModel: async () => ({ model: { meaning_model: {} } }) }, input({ nodeId: undefined, summary: undefined }));
  assert.deepEqual(task.principles.map((item) => item.id), directorPrinciples.filter((item) => item.stage === 'world').map((item) => item.id));
  assert.match(task.instructions, /always go deeper and model more/);
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
