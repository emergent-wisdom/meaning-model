// When a view draws: after something changed, while the camera moves, and for a short while after any input, so that
// the follow-up a change brings (a damped camera, names measured on the next frame) is drawn too. A still view draws
// once a second besides, so a change that reaches the scene some other way shows within that second.
export function createFrameGate({ now = () => performance.now(), settle = 600, heartbeat = 1000 } = {}) {
  let awakeUntil = -Infinity, lastDrawn = -Infinity, pose = null;
  const wake = (ms = settle) => { awakeUntil = Math.max(awakeUntil, now() + ms); };
  // changed: the frame's own work moved something; cameraPose: the numbers that place the camera (any array of numbers).
  function due(changed, cameraPose = []) {
    if (changed) wake();
    if (!pose || pose.length !== cameraPose.length || cameraPose.some((value, i) => value !== pose[i])) { pose = Float64Array.from(cameraPose); wake(); }
    const t = now();
    if (t < awakeUntil || t - lastDrawn >= heartbeat) { lastDrawn = t; return true; }
    return false;
  }
  return { wake, due };
}
