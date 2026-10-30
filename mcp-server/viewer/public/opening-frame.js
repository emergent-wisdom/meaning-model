// Where the time views' camera first stands, from what is drawn and the room the screen leaves for it. A field no deeper
// than it is long is framed whole, as the view has always opened (from higher up where its picture is flatter than the
// room). A field of many rows runs far back: framed whole it shrinks to a thin band in the middle of the screen. The
// deeper it runs for its length, the further the camera turns and lowers, until (four times as deep as long) it looks
// down from the side of the present, so that the rows run back along the free room's diagonal, from its lower left to
// its upper right: across a wide screen, up a tall one. And it comes in, until the field fills three quarters of the
// room, while the rows run on behind, into the distance and off the screen; but never so close that less of the front
// row's time axis stays in the room than the whole of it for a shallow field, a seventh of it for a deep one.
// Nothing here depends on what a model is about: only on the box of what is drawn, the screen and the camera.
const LOWEST = (32 * Math.PI) / 180; // the height a field four times as deep as long is seen from
const HIGHEST = (60 * Math.PI) / 180; // the highest a field framed whole is seen from, to fill a room taller than its picture
const AXIS_LEAST = 1 / 7; // the least share of the front row's time axis that stays in the room, for the deepest field
const FILLED = 3 / 4; // the share of the room a field covers when it fills it
const AXIS_POINTS = 29;

// Whether the reader has moved the camera from where the viewer placed it. Only then does the address name a camera, so
// that a reloaded or shared address opens framed for the screen it lands on, not for the one it was copied from.
export const cameraMoved = (position, target, placed) => position.distanceTo(placed.position) > 0.05 || target.distanceTo(placed.target) > 0.05;

// The camera's distance and target that fit a box's corners inside the room, looking along `direction` (the room in
// normalised device coordinates; the same fit the view has always used).
export function fitBox(THREE, { corners, center, direction, fov, aspect, room }) {
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right);
  const vertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)), horizontal = vertical * aspect;
  const { left, right: r, top, bottom } = room, cx = (left + r) / 2, cy = (bottom + top) / 2;
  let distance = 30;
  for (const corner of corners) {
    const offset = corner.clone().sub(center);
    const dx = offset.dot(right) / horizontal, dy = offset.dot(up) / vertical, dz = offset.dot(direction);
    distance = Math.max(distance, dz + 1, (dx + r * dz) / (r - cx), (-dx - left * dz) / (cx - left), (dy + top * dz) / (top - cy), (-dy - bottom * dz) / (cy - bottom));
  }
  const target = center.clone().addScaledVector(right, -cx * distance * horizontal).addScaledVector(up, -cy * distance * vertical);
  return { distance, target, position: target.clone().addScaledVector(direction, distance) };
}

const boxCorners = (THREE, b) => [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].flatMap((y) => [b.z0, b.z1].map((z) => new THREE.Vector3(x, y, z))));
// The area of a polygon, and the part of a convex polygon inside a rectangle.
const area = (points) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
function clip(points, room) {
  let out = points;
  for (const [inside, cross] of [
    [(p) => p.x >= room.left, (a, b) => ({ x: room.left, y: a.y + ((b.y - a.y) * (room.left - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= room.right, (a, b) => ({ x: room.right, y: a.y + ((b.y - a.y) * (room.right - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= room.bottom, (a, b) => ({ x: a.x + ((b.x - a.x) * (room.bottom - a.y)) / (b.y - a.y), y: room.bottom })],
    [(p) => p.y <= room.top, (a, b) => ({ x: a.x + ((b.x - a.x) * (room.top - a.y)) / (b.y - a.y), y: room.top })],
  ]) {
    const next = [];
    out.forEach((p, i) => { const q = out[(i + 1) % out.length]; if (inside(p)) { next.push(p); if (!inside(q)) next.push(cross(p, q)); } else if (inside(q)) next.push(cross(p, q)); });
    out = next; if (!out.length) break;
  }
  return out;
}
function hull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y), cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const looking = (THREE, camera, position, target) => { camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(); return camera; };

// The share of the room (normalised coordinates) that the box covers seen from a camera at `position` looking at `target`.
export function coverage(THREE, { box, position, target, fov, aspect, room }) {
  const camera = looking(THREE, new THREE.PerspectiveCamera(fov, aspect, 0.1, 1e6), position, target);
  const points = boxCorners(THREE, box).map((corner) => corner.project(camera)).filter((p) => p.z < 1).map((p) => ({ x: p.x, y: p.y }));
  if (points.length < 3) return 0;
  return area(clip(hull(points), room)) / ((room.right - room.left) * (room.top - room.bottom));
}

// The share of the front row's time axis (the floor along the box's front edge) inside the room.
export function axisShown(THREE, { box, position, target, fov, aspect, room }) {
  const camera = looking(THREE, new THREE.PerspectiveCamera(fov, aspect, 0.1, 1e6), position, target), at = new THREE.Vector3();
  let inside = 0;
  for (let i = 0; i < AXIS_POINTS; i += 1) {
    at.set(box.x0 + ((box.x1 - box.x0) * i) / (AXIS_POINTS - 1), 0, box.z1).project(camera);
    if (at.z < 1 && at.x >= room.left && at.x <= room.right && at.y >= room.bottom && at.y <= room.top) inside += 1;
  }
  return inside / AXIS_POINTS;
}

// How deep a field is for its length, from 0 (no deeper than long) to 1 (four times as deep or more).
export const deepness = (box) => Math.max(0, Math.min(1, ((box.z1 - box.z0) / (box.x1 - box.x0) - 1) / 3));

// The direction the camera looks from (towards it from what it looks at). Seen from azimuth A and elevation E, the rows
// (along z) run up the screen at an angle whose tangent is sin E / tan A: the azimuth that sends them along the room's
// diagonal follows from the room's shape.
export function openingDirection(THREE, { box, usual, aspect, room }) {
  const deep = deepness(box);
  const usualAzimuth = Math.atan2(usual.x, usual.z), usualElevation = Math.atan2(usual.y, Math.hypot(usual.x, usual.z));
  const diagonal = (room.top - room.bottom) / ((room.right - room.left) * aspect);
  const turned = Math.atan2(Math.sin(LOWEST), diagonal);
  const azimuth = usualAzimuth + (turned - usualAzimuth) * deep, elevation = usualElevation + (LOWEST - usualElevation) * deep;
  return new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
}

// The opening camera: `box` is what is drawn ({ x0, x1, y0, y1, z0, z1 }, time along x, rows along z, the front at z1),
// `usual` the direction the view has always looked from, `room` the free part of the screen in normalised coordinates.
export function openingFrame(THREE, { box, usual, fov, aspect, room }) {
  const deep = deepness(box), view = { box, fov, aspect, room }, corners = boxCorners(THREE, box);
  const center = new THREE.Vector3((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
  const framed = (direction) => { const whole = fitBox(THREE, { corners, center, direction, fov, aspect, room }); return { ...whole, direction, kind: 'whole', covered: coverage(THREE, { ...view, position: whole.position, target: whole.target }) }; };
  // A field framed whole whose picture is flatter than the room fills more of it seen from higher up, as a short field
  // does in a tall room: the camera rises (the less, the deeper the field) while the field covers more of the room.
  const turned = openingDirection(THREE, { box, usual, aspect, room });
  const azimuth = Math.atan2(turned.x, turned.z), elevation = Math.asin(turned.y), highest = elevation + Math.max(0, HIGHEST - elevation) * (1 - deep);
  let best = framed(turned);
  for (let step = 1; step <= 8; step += 1) {
    const rise = elevation + ((highest - elevation) * step) / 8, candidate = framed(new THREE.Vector3(Math.sin(azimuth) * Math.cos(rise), Math.sin(rise), Math.cos(azimuth) * Math.cos(rise)));
    if (candidate.covered > best.covered + 0.01) best = candidate;
  }
  const { direction } = best, whole = best;
  if (deep === 0) return best;
  const least = 1 - (1 - AXIS_LEAST) * deep;
  // For each point looked at on the floor: the nearest distance that keeps enough of the axis in the room (the share
  // grows as the camera backs away), and the farthest from which the field still fills the room (the cover shrinks).
  // Of the points where both hold, the farthest camera wins, which shows the most of the model; where they hold
  // nowhere, the camera that fills the most of the room with enough of the axis.
  const length = box.x1 - box.x0, reach = Math.min(box.z1 - box.z0, 2 * length);
  const edge = (holds, near, far) => { for (let step = 0; step < 14; step += 1) { const mid = (near + far) / 2; if (holds(mid)) far = mid; else near = mid; } return far; };
  let fills = null;
  for (let i = 0; i <= 6; i += 1) for (let k = 0; k <= 6; k += 1) {
    const target = new THREE.Vector3(box.x0 + (length * i) / 6, 0, box.z1 - (reach * k) / 6);
    const at = (distance) => target.clone().addScaledVector(direction, distance);
    const enough = (distance) => axisShown(THREE, { ...view, position: at(distance), target }) >= least;
    const covers = (distance) => coverage(THREE, { ...view, position: at(distance), target });
    const top = whole.distance * 1.5; if (!enough(top)) continue;
    const nearest = edge(enough, whole.distance * 0.1, top), covered = covers(nearest);
    if (covered >= FILLED) {
      const farthest = edge((distance) => covers(distance) < FILLED, nearest, top);
      if (!fills || farthest > fills.distance) fills = { distance: farthest, target, position: at(farthest), direction, kind: 'fills', covered: covers(farthest) };
    } else if (covered > best.covered + 0.01) best = { distance: nearest, target, position: at(nearest), direction, kind: 'near', covered };
  }
  return fills ?? best;
}
