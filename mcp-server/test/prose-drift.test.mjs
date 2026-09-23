// Records that still quote prose an edit removed (found by the 2026-09-23 instruction test: Events and
// writer's notes kept quoting cut sentences, and no tool said so).
import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctiveFragments, recordsQuoting, removedFragments, textRecords } from '../src/prose-drift.mjs';

test('removed sentences and quoted phrases are found in current records, not in history', () => {
  const before = ['He put the torch on the door. “The door was new to him,” she thought, wrongly. It had dropped on its hinges.'];
  const after = ['He put the torch on the door. He had never had to lock it. It had dropped on its hinges.'];
  const removed = removedFragments(before, after);
  assert.ok(removed.includes('the door was new to him'), JSON.stringify(removed));
  assert.ok(!removed.some((fragment) => fragment.includes('torch on the door')), 'kept sentences are not removed');
  const view = { nodes: [
    { id: 'note.pivot', node_type: 'understanding.decision', role: 'externalized_reflection', holder: 'writer', text: '{"text":"The pivot line \\"The door was new to him\\" carries the turn."}' },
    { id: 'review.blind.1', node_type: 'review', role: 'externalized_reflection', holder: 'reader', text: 'The pivot "The door was new to him" is unclear.' },
    { id: 'note.old', node_type: 'understanding.idea', role: 'externalized_reflection', holder: 'writer', text: 'Keep "The door was new to him" for now.' },
    { id: 'note.new', node_type: 'understanding.revision', role: 'externalized_reflection', holder: 'writer', text: 'Replaced "The door was new to him" with the lock line.' },
    { id: 'passage.1', node_type: 'storytelling.passage', role: 'story_passage', text: after[0] },
  ], edges: [{ id: 'e1', source: { kind: 'node', node_id: 'note.new' }, target: { kind: 'node', node_id: 'note.old' }, relation: 'supersedes' }] };
  const model = { meaning_model: { events: [{ id: 'event.realization', boundary: 'He sees what the man never knew.', description: 'The door was new to him, and that is the point.' }] } };
  const stale = recordsQuoting(textRecords(view, model), removed);
  assert.deepEqual(stale.map((record) => record.id).sort(), ['event.realization', 'note.pivot'], 'reviews, revision notes and superseded notes are history');
  assert.deepEqual(distinctiveFragments('Too short. Also short here.'), [], 'fragments need at least four words');
});
