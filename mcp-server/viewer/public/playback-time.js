// Cumulative history playback reveals dated records only after their start. Construction uses its own clock.
export function isPlaybackVisible(time, { construction = false, overview = false, now = Infinity, tau = Infinity, born = -Infinity } = {}) {
  return construction ? born <= tau : overview || !Number.isFinite(time) || time <= now;
}

export function playbackSpan(start, end, clock = {}) {
  if (!isPlaybackVisible(start, clock)) return null;
  return { start, end: clock.construction || clock.overview || !Number.isFinite(end) ? end : Math.min(end, clock.now ?? Infinity) };
}
