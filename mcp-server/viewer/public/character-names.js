// Big names: each group's name, a character's or the world's, stands large behind its own rows, so a reader sees at a
// glance whose processes these are before reading any of them. They are off unless chosen: names=big in the address,
// the Big names switch, or a view that asks for them. These are the parts that need no browser: whether the names are
// big, where a group's name stands, and how large it is drawn.
export const NAME_SETTINGS = Object.freeze(['big', 'small']);

export const bigNamesOn = (setting) => setting === 'big';

// A group's name stands over the middle of its rows: halfway across their depth, at the middle of the time window.
export function namePlace(zs) {
  const finite = (zs ?? []).filter(Number.isFinite);
  if (!finite.length) return null;
  const z0 = Math.min(...finite), z1 = Math.max(...finite);
  return { x: 0, z: (z0 + z1) / 2, depth: z1 - z0 };
}

// Every name is drawn at one height, from the groups' typical depth, so no character looks more important than another
// for having more processes.
export function nameHeight(depths, { share = 0.3, least = 3.5, most = 12 } = {}) {
  const sorted = (depths ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return least;
  const middle = sorted[Math.floor(sorted.length / 2)];
  return Math.max(least, Math.min(most, middle * share));
}

// On screen a name stays between a floor and a ceiling of the screen's height, however near or far the camera is:
// readable when the whole model is small, never filling a close look at one curve. fov is the camera's vertical field
// of view in degrees; the result is the height to draw the name at, in world units.
export function screenHeight(height, { distance, fov, pixels }, { least = 0.045, most = 0.11 } = {}) {
  if (!(distance > 0) || !(fov > 0) || !(pixels > 0)) return height;
  const perUnit = pixels / (2 * distance * Math.tan((fov * Math.PI) / 360));
  const shown = height * perUnit;
  const kept = Math.max(pixels * least, Math.min(pixels * most, shown));
  return height * (kept / shown);
}
