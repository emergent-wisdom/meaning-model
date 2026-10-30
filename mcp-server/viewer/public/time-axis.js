// The time views' axis. A view is a window [a, b] of the model's time; its mapping to the screen blends a linear scale
// with a log scale of time before the present, by how wide the window is: linear across a few centuries, logarithmic
// across millennia. Only a calendar clock is warped; any other is linear. The axis reaches from a little before the
// earliest time the model declares to its present.
const smoothstep = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

export function timeAxis({ earliest, present, calendar }) {
  const KNEE = 3; const BOUNDS = [earliest - (present - earliest) * 0.015, present];
  const MIN_SPAN = calendar ? 0.004 : Math.max(Number.EPSILON, (BOUNDS[1] - BOUNDS[0]) * 1e-6);
  const G = (t) => -Math.log(KNEE + BOUNDS[1] - Math.min(t, BOUNDS[1] + KNEE * 0.999));
  const Ginv = (g) => BOUNDS[1] + KNEE - Math.exp(-g);
  const warpOf = (span) => (calendar ? smoothstep((Math.log10(span) - 2.45) / 1.15) : 0);
  // A window: its ends, its span, how far it is warped and the ends on the log scale.
  const frameOf = (a, b) => ({ a, b, s: b - a, w: warpOf(b - a), ga: G(a), gb: G(b) });
  // Where time t falls in window V, from 0 at its start to 1 at its end; and the time at fraction u.
  const fracOf = (V, t) => (1 - V.w) * ((t - V.a) / V.s) + (V.w ? V.w * ((G(t) - V.ga) / (V.gb - V.ga)) : 0);
  function timeAt(V, u) { if (!V.w) return V.a + u * V.s; let lo = V.a - V.s * 4; let hi = Math.min(V.b + V.s * 4, BOUNDS[1] + KNEE * 0.99); for (let i = 0; i < 64; i += 1) { const mid = (lo + hi) / 2; if (fracOf(V, mid) < u) lo = mid; else hi = mid; } return (lo + hi) / 2; }
  // The window of a given width that keeps time t at screen fraction u.
  function windowAt(t, u, span) {
    span = Math.max(MIN_SPAN, Math.min(span, BOUNDS[1] - BOUNDS[0]));
    let lo = t - span; let hi = t;
    for (let i = 0; i < 64; i += 1) { const mid = (lo + hi) / 2; if (fracOf(frameOf(mid, mid + span), t) > u) lo = mid; else hi = mid; }
    const a = Math.max(BOUNDS[0], Math.min((lo + hi) / 2, BOUNDS[1] - span)); return [a, a + span];
  }
  return { BOUNDS, MIN_SPAN, G, Ginv, frameOf, fracOf, timeAt, windowAt };
}
