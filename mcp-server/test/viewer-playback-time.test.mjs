import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaybackVisible, playbackSpan } from '../viewer/public/playback-time.js';

test('a recorded 2019 value cannot appear in 2015, including while paused', () => {
  assert.equal(isPlaybackVisible(2019, { now: 2015 }), false);
  assert.equal(isPlaybackVisible(2019, { now: 2019 }), true);
  assert.equal(isPlaybackVisible(2019, { now: 2023 }), true);
  assert.equal(isPlaybackVisible(2019, { now: 2015, overview: true }), true);
});

test('an ongoing Event grows to the play cursor and keeps its past after ending', () => {
  assert.equal(playbackSpan(2020, 2022, { now: 2019 }), null);
  assert.deepEqual(playbackSpan(2020, 2022, { now: 2020 }), { start: 2020, end: 2020 });
  assert.deepEqual(playbackSpan(2020, 2022, { now: 2021 }), { start: 2020, end: 2021 });
  assert.deepEqual(playbackSpan(2020, 2022, { now: 2023 }), { start: 2020, end: 2022 });
});

test('point Events appear exactly at their date, including negative time coordinates', () => {
  assert.equal(playbackSpan(-20, -20, { now: -21 }), null);
  assert.deepEqual(playbackSpan(-20, -20, { now: -20 }), { start: -20, end: -20 });
  assert.deepEqual(playbackSpan(-20, -20, { now: -19 }), { start: -20, end: -20 });
});

test('overview restores full authored intervals without modifying them', () => {
  const interval = { start: 2020, end: 2040 };
  assert.deepEqual(playbackSpan(interval.start, interval.end, { now: 2010, overview: true }), interval);
  assert.deepEqual(interval, { start: 2020, end: 2040 });
});

test('construction reveals records by creation time, independently of their world dates', () => {
  const clock = { construction: true, now: 1900, tau: 100, born: 101 };
  assert.equal(isPlaybackVisible(1800, clock), false);
  assert.equal(playbackSpan(1800, 2050, clock), null);
  clock.tau = 101;
  assert.equal(isPlaybackVisible(2050, clock), true);
  assert.deepEqual(playbackSpan(1800, 2050, clock), { start: 1800, end: 2050 });
});

test('undated context stays undated instead of being assigned time zero', () => {
  for (const time of [null, undefined, NaN]) {
    assert.equal(isPlaybackVisible(time, { now: -500 }), true);
    assert.equal(isPlaybackVisible(time, { construction: true, tau: 4, born: 5 }), false);
  }
});
