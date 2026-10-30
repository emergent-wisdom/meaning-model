import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameGate } from '../viewer/public/frame-gate.js';

const clockAt = (start = 0) => { const clock = { t: start, now: () => clock.t }; return clock; };

test('a still view draws its first frame, then only once a second', () => {
  const clock = clockAt(); const gate = createFrameGate({ now: clock.now, settle: 600, heartbeat: 1000 });
  const pose = [0, 0, 10];
  assert.equal(gate.due(false, pose), true, 'the first frame is drawn');
  let drawn = 0;
  for (clock.t = 16; clock.t <= 3000; clock.t += 16) if (gate.due(false, pose)) drawn += 1;
  // Awake for the settling time after the first frame (about 37 frames), then the heartbeat at 1.6 s and 2.6 s.
  assert.ok(drawn >= 30 && drawn <= 45, `drew ${drawn} frames in three still seconds`);
  let late = 0;
  for (clock.t = 3000; clock.t <= 9000; clock.t += 16) if (gate.due(false, pose)) late += 1;
  assert.ok(late >= 5 && late <= 7, `a still view drew ${late} frames in six seconds`);
});

test('a change, a moved camera or an input draws at once and for the settling time after', () => {
  const clock = clockAt(); const gate = createFrameGate({ now: clock.now, settle: 600, heartbeat: 1000 });
  gate.due(false, [0]); clock.t = 5000; gate.due(false, [0]);
  clock.t = 5100; assert.equal(gate.due(false, [0]), false, 'nothing changed');
  clock.t = 5116; assert.equal(gate.due(true, [0]), true, 'the frame changed something');
  clock.t = 5700; assert.equal(gate.due(false, [0]), true, 'still settling');
  clock.t = 5800; assert.equal(gate.due(false, [0]), false, 'settled');
  clock.t = 5816; assert.equal(gate.due(false, [0.001]), true, 'the camera moved');
  clock.t = 6600; assert.equal(gate.due(false, [0.001]), false);
  gate.wake(); clock.t = 6616; assert.equal(gate.due(false, [0.001]), true, 'an input woke it');
  assert.equal(gate.due(false, [0.001, 1]), true, 'a pose of another length counts as moved');
});
