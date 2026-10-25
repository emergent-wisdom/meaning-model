// Where things are, as a model declares it: a process whose value is a pose or a position vector, or scalar processes
// declared as position coordinates (scale semantic_role "position" with an axis), each in a named reference frame.
// Nothing is placed from a name, a free-text region or prose. A position changes only as declared, exactly: an
// always-active evolution of a coordinate by a constant or by a static process from the model's start (time 0), or an
// always-active occurrence that sets coordinates to constants when the clock reaches a time. A position process bound
// to a referent for an interval is where that referent is during that interval. Other laws are named, not evaluated.
import { buildModelGraph, modelGraphId } from './model-graph.js';

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const AXES = ['x', 'y', 'z'];

function nameOf(referent) {
  const boundary = String(referent?.boundary ?? ''); const lead = boundary.split(/[,;(]| - | — | as one /u)[0].trim();
  if (lead && lead.split(/\s+/u).length <= 4 && /^\p{Lu}/u.test(lead)) return lead.replace(/^(the|a) /iu, '');
  return String(referent?.id ?? '').split('.').filter(Boolean).at(-1)?.replace(/[_-]+/gu, ' ') ?? '';
}
const words = (id) => String(id).split('.').filter(Boolean).at(-1)?.replace(/[_-]+/gu, ' ') ?? String(id);
// Where an Event takes place, as a binding declares it without coordinates. The two binding types in use say the
// same thing; they are read as they are declared, never inferred from a name or a region's words.
export const LOCATED = new Set(['located_in', 'spatial_setting']);
const placeName = (referent) => { const first = String(referent?.boundary ?? '').split(/(?<=[.;])\s/u)[0].replace(/[.;]$/u, '').trim(); return (first.length > 72 ? `${first.slice(0, 71)}…` : first) || words(referent?.id ?? ''); };
// A referent's name: a short proper name when its boundary begins with one, else the first clause that bounds it.
const labelOf = (referent) => { const lead = String(referent?.boundary ?? '').split(/[,;(]| - | — | as one /u)[0].trim(); return lead && lead.split(/\s+/u).length <= 4 && /^\p{Lu}/u.test(lead) ? nameOf(referent) : placeName(referent); };

// The unit that names the frame a thing stands in. For a thing on the Earth it is the unit of its angles: a length beside them
// (an altitude in metres) does not put it in a frame of its own, whichever of its coordinates is met first.
const frameUnit = (axes, units, fallback) => {
  const [la, lo] = ['latitude', 'longitude'].map((axis) => axes.indexOf(axis));
  return la >= 0 && lo >= 0 ? units[la] ?? units[lo] ?? fallback : fallback;
};

// How precisely a coordinate is declared: exact, a standard deviation, an interval of values, or not declared.
function precisionOf(uncertainty) {
  if (uncertainty?.kind === 'exact') return { kind: 'exact' };
  if (uncertainty?.kind === 'standard_deviation' && finite(uncertainty.value)) return { kind: 'standard_deviation', value: uncertainty.value };
  if (uncertainty?.kind === 'interval' && finite(uncertainty.lower) && finite(uncertainty.upper)) return { kind: 'interval', lower: uncertainty.lower, upper: uncertainty.upper };
  return null;
}

export function spaceModel(model = {}) {
  const processes = array(model.processes), meaning = model.meaning_model ?? {};
  const byId = new Map(processes.map((process) => [process.id, process]));
  const referents = new Map(array(meaning.referents).map((referent) => [referent.id, referent]));
  // A process is a referent's by a declared binding, never by its name; the binding's interval is when it holds.
  const boundTo = new Map();
  for (const binding of array(meaning.event_referent_bindings)) {
    if (binding?.target?.kind === 'process' && (binding.role === 'position' || binding.binding_type === 'coordinate') && referents.has(binding.referent_id) && !boundTo.has(binding.target.process_id)) boundTo.set(binding.target.process_id, { referentId: binding.referent_id, interval: binding.interval ?? null });
  }
  // A disabled law moves nothing.
  const laws = array(model.laws).filter((law) => law?.enabled !== false);
  const lawsOn = new Map();
  for (const law of laws) {
    const operator = law?.operator ?? {}; const targets = [...new Set([operator.target, ...array(operator.effects).map((effect) => effect?.target)].filter(Boolean))];
    for (const target of targets) { if (!lawsOn.has(target)) lawsOn.set(target, []); lawsOn.get(target).push(law); }
  }
  const scalarValue = (process) => (process?.initial_value?.kind === 'scalar' && finite(process.initial_value.value) ? process.initial_value.value : null);
  const always = (law) => (law.activation ?? 'always') === 'always';
  // When the clock reaches a time, this occurrence sets each coordinate it names to a constant; else null.
  const stepOf = (law, processId) => {
    const operator = law.operator ?? {}, trigger = operator.trigger ?? {};
    if (operator.role !== 'occurrence' || !always(law) || trigger.kind !== 'threshold' || trigger.expression?.op !== 'time' || trigger.firing !== 'on_enter'
      || !['greater_or_equal', 'greater_than'].includes(trigger.comparison) || !finite(trigger.threshold)) return null;
    const effect = array(operator.effects).find((item) => item?.target === processId);
    return effect?.mode === 'set' && effect.value?.op === 'constant' && finite(effect.value.value) ? { t: trigger.threshold, value: effect.value.value } : null;
  };
  // How one coordinate changes: not at all, at a declared rate, in declared steps, or (null) by laws not evaluated here.
  const motionOf = (processId) => {
    const moving = lawsOn.get(processId) ?? [];
    if (!moving.length) return { motion: { rate: 0 }, laws: [] };
    const ids = moving.map((law) => law.id);
    const steps = moving.map((law) => stepOf(law, processId));
    if (steps.every(Boolean)) return { motion: { steps: steps.sort((a, b) => a.t - b.t) }, laws: ids };
    if (moving.length > 1) return { motion: null, laws: ids };
    const [law] = moving; const operator = law.operator ?? {};
    if (operator.role !== 'evolution' || !always(law) || operator.innovation) return { motion: null, laws: ids };
    const derivative = operator.derivative ?? {};
    if (derivative.op === 'constant' && finite(derivative.value)) return { motion: { rate: derivative.value }, laws: ids };
    if (derivative.op === 'process') {
      const value = scalarValue(byId.get(derivative.process));
      if (value !== null && !(lawsOn.get(derivative.process)?.length)) return { motion: { rate: value }, laws: ids };
    }
    return { motion: null, laws: ids };
  };
  const objects = new Map();
  const objectFor = (key, process, extra) => {
    if (!objects.has(key)) objects.set(key, { id: key, frame: process.reference_frame ?? null, unit: process.unit ?? null, axes: [], axisUnits: [], position: [], motion: [], precision: [], orientation: null, processIds: [], referentId: null, interval: null, laws: [], declaration: process.scale ?? {}, provenance: array(process.provenance), ...extra });
    return objects.get(key);
  };
  const bind = (object, processId) => { const bound = boundTo.get(processId); if (bound && !object.referentId) { object.referentId = bound.referentId; object.interval = bound.interval; } };
  for (const process of processes) {
    const role = process.scale?.semantic_role; const value = process.initial_value ?? {};
    const declaredAxes = array(process.axes).map((axis) => axis?.id).filter(Boolean);
    if (value.kind === 'object_pose' || (value.kind === 'vector' && role === 'position')) {
      const position = value.kind === 'object_pose' ? array(value.value?.position) : array(value.value);
      if (!position.length || !position.every(finite)) continue;
      const object = objectFor(process.id, process, { kind: value.kind === 'object_pose' ? 'pose' : 'vector' });
      object.axes = position.map((_, i) => (declaredAxes.length === position.length ? declaredAxes[i] : AXES[i] ?? `axis ${i + 1}`));
      // One process, one unit: every component of a vector or pose is in it.
      object.axisUnits = position.map(() => process.unit ?? null);
      // A whole pose changes only by laws this view does not evaluate.
      object.position = [...position]; object.motion = position.map(() => (lawsOn.get(process.id)?.length ? null : { rate: 0 }));
      object.precision = position.map(() => precisionOf(process.uncertainty));
      if (value.kind === 'object_pose' && array(value.value?.orientation).every(finite)) object.orientation = [...value.value.orientation];
      object.processIds.push(process.id); bind(object, process.id); object.laws.push(...(lawsOn.get(process.id) ?? []).map((law) => law.id));
      continue;
    }
    if (value.kind !== 'scalar' || role !== 'position' || !finite(value.value)) continue;
    // Coordinates of one thing: the spatial entity their support names, else the id without its axis.
    const entity = array(process.support).find((item) => String(item).startsWith('spatial_entity:'))?.slice(15);
    const axis = process.scale?.axis ?? declaredAxes[0] ?? 'x';
    const key = entity ? `entity:${entity}` : String(process.id).replace(/\.position\.[^.]+$/u, '');
    const object = objectFor(key, process, { kind: 'coordinates' });
    if (object.axes.includes(axis) || (object.frame ?? null) !== (process.reference_frame ?? null)) continue;
    const { motion, laws: moving } = motionOf(process.id);
    object.axes.push(axis); object.axisUnits.push(process.unit ?? null); object.position.push(value.value); object.motion.push(motion); object.precision.push(precisionOf(process.uncertainty));
    object.processIds.push(process.id); object.laws.push(...moving); bind(object, process.id);
  }
  const placed = [...objects.values()].map((object) => {
    // Axes in their declared order: x, y, z first, then any others as declared.
    const order = object.axes.map((axis, i) => i).sort((a, b) => ((AXES.indexOf(object.axes[a]) + 1) || 9) - ((AXES.indexOf(object.axes[b]) + 1) || 9));
    const referent = referents.get(object.referentId); const place = referents.get(object.declaration.place_ref); const motion = order.map((i) => object.motion[i]);
    const axes = order.map((i) => object.axes[i]), axisUnits = order.map((i) => object.axisUnits[i]);
    return { ...object, axes, axisUnits, unit: frameUnit(axes, axisUnits, object.unit), position: order.map((i) => object.position[i]), motion, precision: order.map((i) => object.precision[i]),
      laws: [...new Set(object.laws)], placeId: place?.id ?? null, placeLabel: String(object.declaration.place_label ?? (place ? labelOf(place) : object.declaration.label ?? '')), periodLabel: String(object.declaration.label ?? ''),
      lifeLocation: object.declaration.spatial_status === 'coarse_life_location', locationRole: object.declaration.location_role ?? null,
      lifetime: array(meaning.events).find((event) => event.id === referent?.lifecycle_event_id)?.interval ?? null,
      // A position's own declared label names it; a life location is named by whose it is, and its period by its label.
      fullLabel: referent?.boundary ?? object.id, label: object.declaration.spatial_status !== 'coarse_life_location' && object.declaration.label ? String(object.declaration.label)
        : referent ? labelOf(referent) : words(object.id.replace(/^entity:/u, '')),
      moves: motion.some((item) => item === null || item.rate || item.steps?.length), evaluated: motion.every(Boolean) };
  }).sort((a, b) => a.label.localeCompare(b.label) || (a.interval?.start ?? -Infinity) - (b.interval?.start ?? -Infinity) || a.id.localeCompare(b.id));
  const frames = new Map();
  for (const object of placed) {
    const key = JSON.stringify([object.frame, object.unit]);
    if (!frames.has(key)) frames.set(key, { frame: object.frame, unit: object.unit, objects: [] });
    frames.get(key).objects.push(object);
  }
  const positioned = new Set(placed.map((object) => object.referentId).filter(Boolean));
  // Settings: each place an Event is declared to be located in, with when and who, and no geometry.
  const events = new Map(array(meaning.events).map((event) => [event.id, event]));
  const bindingsOf = new Map();
  for (const binding of array(meaning.event_referent_bindings)) if (binding?.target?.kind === 'event') { if (!bindingsOf.has(binding.target.event_id)) bindingsOf.set(binding.target.event_id, []); bindingsOf.get(binding.target.event_id).push(binding); }
  const settings = new Map();
  for (const [eventId, bindings] of bindingsOf) {
    const event = events.get(eventId); if (!event) continue;
    const places = bindings.filter((binding) => LOCATED.has(binding.binding_type) && referents.has(binding.referent_id));
    if (!places.length) continue;
    const placeIds = new Set(places.map((binding) => binding.referent_id));
    // Interaction participants may be remote. Only explicit presence bindings declare occupancy.
    const participantIds = [...new Set(Object.values(event.participants ?? {}).flat())].filter((id) => referents.has(id) && !placeIds.has(id));
    const who = [...new Set(bindings.filter((binding) => ['physically_present', 'physical_presence'].includes(binding.binding_type) || binding.role === 'physically_present').map((binding) => binding.referent_id))]
      .filter((id) => referents.has(id) && !placeIds.has(id)).map((id) => nameOf(referents.get(id)));
    for (const binding of places) {
      if (!settings.has(binding.referent_id)) settings.set(binding.referent_id, { id: binding.referent_id, name: placeName(referents.get(binding.referent_id)), boundary: referents.get(binding.referent_id).boundary, positioned: positioned.has(binding.referent_id), events: [] });
      settings.get(binding.referent_id).events.push({ id: eventId, label: event.boundary, description: event.description ?? null, interval: binding.interval ?? event.interval ?? null, role: binding.role, type: binding.binding_type, who, participants: participantIds.map((id) => nameOf(referents.get(id))) });
    }
  }
  const startOf = (item) => item.interval?.start ?? Infinity;
  const settingList = [...settings.values()].map((setting) => ({ ...setting, events: setting.events.sort((a, b) => startOf(a) - startOf(b)), who: [...new Set(setting.events.flatMap((event) => event.who))] }))
    .sort((a, b) => startOf(a.events[0]) - startOf(b.events[0]) || a.name.localeCompare(b.name));
  return {
    settings: settingList,
    frames: [...frames.values()].map((frame) => ({ ...frame, lifeLocations: frame.objects.filter((object) => object.lifeLocation), axes: [...new Set(frame.objects.flatMap((object) => object.axes))], dimensions: Math.max(...frame.objects.map((object) => object.position.length)) })),
    timeUnit: model.time_unit ?? null, modelEnd: Math.max(...array(meaning.events).map((event) => event?.interval?.end).filter(finite), -Infinity),
    // What the view cannot place: referents with no declared position, and places named only in free text.
    unplacedReferents: [...referents.values()].filter((referent) => !positioned.has(referent.id)).map((referent) => ({ id: referent.id, name: nameOf(referent) })),
    textRegions: [...new Set(array(meaning.events).map((event) => event?.region).filter((region) => typeof region === 'string' && region.trim()))],
  };
}

// Whether an object is where it is declared at a model time: always, unless its binding holds for an interval.
export const presentAt = (object, t) => !object.interval || (t >= object.interval.start && t <= object.interval.end);

// Where an object stands at a model time, from its declared start and exactly declared changes. Null when it is not
// there then, or when a law this view does not evaluate moves it and the time is not the model's start.
export function positionAt(object, t = 0) {
  if (!presentAt(object, t)) return null;
  const values = object.position.map((value, i) => {
    const motion = object.motion[i];
    if (!motion) return t === 0 ? value : null;
    if (motion.steps) { let at = value; for (const step of motion.steps) if (step.t <= t) at = step.value; return at; }
    return value + motion.rate * t;
  });
  return values.every((value) => value !== null) ? values : null;
}

// The span of model time over which a frame's positions change or hold, or null when nothing in it is timed. Motion
// at a rate runs from the model's start to the end of its latest Event.
export function timeSpan(frame, modelEnd = null) {
  const times = frame.objects.flatMap((object) => [object.interval?.start, object.interval?.end, ...(object.lifeLocation ? [object.lifetime?.start, object.lifetime?.end] : []), ...object.motion.flatMap((motion) => motion?.steps?.map((step) => step.t) ?? [])]).filter(finite);
  const rated = frame.objects.some((object) => object.motion.some((motion) => motion?.rate));
  if (rated) times.push(0, ...(finite(modelEnd) ? [modelEnd] : []));
  if (!times.length) return null;
  const start = Math.min(...times), end = Math.max(...times);
  return { start, end: end > start ? end : start + 1 };
}

// ---- Units of angle and length ---------------------------------------------------------------------------------------------
export const GLOBE_RADIUS = 100;            // the sphere's radius, in scene units
export const EARTH_RADIUS_M = 6_371_008.8;  // the mean radius of the Earth the sphere stands for, in metres
export const GRATICULE_LIFT = 0.002;        // lines and marks stand this far above the surface, in scene units
export const WIDE_SPAN = 30;                // a frame whose points span more degrees than this opens as a globe

const ANGLES = [[/^(decimal[ _])?(arc[ _]?)?(deg(ree)?s?([ _](north|south|east|west|[nsew]))?|°[nsew]?)$/iu, 1], [/^rad(ian)?s?$/iu, 180 / Math.PI]];
const LENGTHS = [[/^(m|meters?|metres?)$/iu, 1], [/^(km|kilometers?|kilometres?)$/iu, 1000], [/^(ft|foot|feet)$/iu, 0.3048], [/^(mi|miles?)$/iu, 1609.344]];
const unitScale = (table, unit) => table.find(([pattern]) => pattern.test(String(unit).trim()))?.[1] ?? null;
const undeclared = (unit) => unit == null || String(unit).trim() === '';
// Degrees in one unit of an angle (a unit left undeclared is read as degrees, as the map reads it), else null.
export const degreesPer = (unit) => (undeclared(unit) ? 1 : unitScale(ANGLES, unit));
// Metres in one unit of length, else null (so an altitude with no length unit is not placed).
export const metresPer = (unit) => (undeclared(unit) ? null : unitScale(LENGTHS, unit));
const METRES_PER_DEGREE = EARTH_RADIUS_M * Math.PI / 180;

// How a frame's coordinates lie on the ground and upward: x east, y north and z up; or, when the frame's axes are
// latitude and longitude, a map with longitude narrowed by the cosine of the frame's middle latitude (and altitude
// up). A coordinate on any other axis is described, not drawn.
export function planeOf(frame) {
  const axes = frame.axes ?? []; const geo = axes.includes('latitude') && axes.includes('longitude');
  // Each axis is read in its own unit: angles in degrees (a unit that is not an angle is read as it is given), and an altitude in
  // a length as the degrees of arc that length spans, so that it stands in scale beside them.
  const degrees = (object, axis) => (geo && (axis === 'latitude' || axis === 'longitude') ? degreesPer(object.axisUnits?.[object.axes.indexOf(axis)]) ?? 1 : 1);
  const latitudes = geo ? frame.objects.map((object) => object.position[object.axes.indexOf('latitude')] * degrees(object, 'latitude')).filter(finite) : [];
  const narrow = geo && latitudes.length ? Math.cos((latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length) * Math.PI / 180) : 1;
  const east = geo ? 'longitude' : 'x', north = geo ? 'latitude' : 'y', up = geo ? (axes.includes('altitude') ? 'altitude' : 'z') : 'z';
  return { geo, narrow, east, north, up, coordinates(object, position) {
    const at = (axis) => { const i = object.axes.indexOf(axis); return i >= 0 ? position[i] : 0; };
    const metres = geo && up === 'altitude' ? metresPer(object.axisUnits?.[object.axes.indexOf('altitude')]) : null;
    return { east: at(east) * degrees(object, east) * (geo ? narrow : 1), north: at(north) * degrees(object, north), up: metres === null ? at(up) : at(up) * metres / METRES_PER_DEGREE };
  } };
}


// ---- The Earth as a globe ----------------------------------------------------------------------------------------------
// A frame whose axes are latitude and longitude lies on a sphere as well as on a map. Everything below is geometry: where
// a declared latitude, longitude and altitude stand on a sphere, the great circle between two of them, the lines of a
// graticule and where to stand to see a set of points. No coastline, border or name is drawn that a model does not declare.
// Latitude and longitude in degrees and altitude in metres of one position of an object, each in the unit its own process
// declares. Null when the object has no latitude and longitude, they are not angles, or the latitude cannot lie on a sphere.
export function geodetic(object, position) {
  const axes = object?.axes ?? [], [la, lo, al] = ['latitude', 'longitude', 'altitude'].map((axis) => axes.indexOf(axis));
  if (la < 0 || lo < 0 || !position) return null;
  const unitOf = (i) => (object.axisUnits ? object.axisUnits[i] ?? null : object.unit ?? null);
  const kLat = degreesPer(unitOf(la)), kLon = degreesPer(unitOf(lo));
  if (kLat === null || kLon === null) return null;
  const latitude = position[la] * kLat, longitude = position[lo] * kLon;
  if (!finite(latitude) || !finite(longitude) || Math.abs(latitude) > 90) return null;
  const kAlt = al >= 0 ? metresPer(unitOf(al)) : null, lifted = al >= 0 && kAlt !== null && finite(position[al]);
  return { latitude, longitude, altitude: lifted ? position[al] * kAlt : 0, altitudeDrawn: al < 0 || lifted };
}
export const globeRadiusAt = (altitude = 0) => GLOBE_RADIUS * (1 + altitude / EARTH_RADIUS_M);
// A point on the globe: north up (+y), longitude 0 toward +z and east toward +x, so that east lies to the right from outside.
export function globeXYZ(latitude, longitude, radius = GLOBE_RADIUS) {
  const phi = latitude * Math.PI / 180, lambda = longitude * Math.PI / 180, flat = Math.cos(phi);
  return [radius * flat * Math.sin(lambda), radius * Math.sin(phi), radius * flat * Math.cos(lambda)];
}
// The latitude and longitude, in degrees, of the direction in which a point lies from the globe's centre.
export function globeAngles([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1;
  return { latitude: Math.asin(Math.max(-1, Math.min(1, y / r))) * 180 / Math.PI, longitude: Math.atan2(x, z) * 180 / Math.PI };
}
// How many degrees of longitude the shortest arc of the circle covers that holds all of these (179 and -179 are 2 apart).
export function circularSpan(degrees) {
  const wrapped = [...new Set(degrees.filter(finite).map((value) => ((value % 360) + 360) % 360))].sort((a, b) => a - b);
  if (wrapped.length < 2) return 0;
  let gap = wrapped[0] + 360 - wrapped.at(-1);
  for (let i = 1; i < wrapped.length; i += 1) gap = Math.max(gap, wrapped[i] - wrapped[i - 1]);
  return 360 - gap;
}
// The model times at which an object's position can differ: the start, the ends of the span, its own interval and each declared step.
export const sampleTimes = (object, span = null) => [...new Set([0, span?.start, span?.end, object.interval?.start, object.interval?.end, ...object.motion.flatMap((motion) => motion?.steps?.map((step) => step.t) ?? [])].filter(finite))];

/** Whether a frame can be drawn on a globe, and how far its points spread. Null when its axes are not latitude and
 * longitude, any of its positions (declared, or reached over time) is not an angle pair on a sphere, or nothing in it has
 * both. `objects` are those it can draw; `left` the positions of the frame that have no latitude or longitude. `wide` says
 * the points span more than WIDE_SPAN degrees of latitude or longitude, the case that opens as a globe. */
export function globeOf(frame, span = null) {
  if (!planeOf(frame).geo) return null;
  const objects = [], left = [], latitudes = [], longitudes = [];
  for (const object of frame.objects) {
    if (!object.axes.includes('latitude') || !object.axes.includes('longitude')) { left.push(object); continue; }
    const positions = [object.position, ...sampleTimes(object, span).map((time) => positionAt(object, time)).filter(Boolean)];
    for (const position of positions) {
      const at = geodetic(object, position);
      if (!at) return null;
      latitudes.push(at.latitude); longitudes.push(at.longitude);
    }
    objects.push(object);
  }
  if (!objects.length) return null;
  const latitudeSpan = Math.max(...latitudes) - Math.min(...latitudes), longitudeSpan = circularSpan(longitudes);
  return { objects, left, latitudeSpan, longitudeSpan, wide: Math.max(latitudeSpan, longitudeSpan) > WIDE_SPAN,
    altitudeUndrawn: objects.filter((object) => geodetic(object, object.position)?.altitudeDrawn === false) };
}

/** Points along the great circle between two points of the globe (each [x, y, z]), at most `maxStep` degrees apart. The radius
 * runs from one end's to the other's, `bulge`, a fraction of the chord, raises the middle, and `lift` raises all of it, so that
 * a line on the surface is not hidden by a facet of the sphere. Used for what joins two places, which a straight line would
 * carry through the Earth. */
export function arcBetween(a, b, { maxStep = 1, bulge = 0, lift = 0 } = {}) {
  const ra = Math.hypot(...a), rb = Math.hypot(...b);
  if (!(ra > 0) || !(rb > 0)) return [[...a], [...b]];
  const ua = a.map((value) => value / ra), ub = b.map((value) => value / rb);
  const angle = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2])));
  const steps = Math.max(1, Math.ceil(angle * 180 / Math.PI / maxStep)), chord = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // Opposite points have no one great circle between them: turn through the direction perpendicular to the first.
  let across = null;
  if (Math.PI - angle < 1e-6) {
    const seed = Math.abs(ua[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], c = [ua[1] * seed[2] - ua[2] * seed[1], ua[2] * seed[0] - ua[0] * seed[2], ua[0] * seed[1] - ua[1] * seed[0]], size = Math.hypot(...c);
    across = c.map((value) => value / size);
  }
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const s = i / steps; let direction;
    if (across) direction = ua.map((value, k) => value * Math.cos(Math.PI * s) + across[k] * Math.sin(Math.PI * s));
    else if (angle < 1e-9) direction = ua;
    else direction = ua.map((value, k) => (value * Math.sin((1 - s) * angle) + ub[k] * Math.sin(s * angle)) / Math.sin(angle));
    const radius = ra + (rb - ra) * s + bulge * chord * Math.sin(Math.PI * s) + lift;
    points.push(direction.map((value) => value * radius));
  }
  // The ends are where the points are, raised by the lift like the rest.
  if (!lift) { points[0] = [...a]; points[steps] = [...b]; }
  return points;
}

export const GRATICULE_STEPS = [30, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001];
// The spacing, in degrees, of the graticule for a view that reaches `half` degrees from its centre to its nearest edge: the
// largest that still leaves several cells across. A whole globe is seen at 30.
export const graticuleStep = (half) => (finite(half) ? GRATICULE_STEPS.find((step) => step <= half / 2.2) ?? GRATICULE_STEPS.at(-1) : 30);

/** How many degrees of the sphere a camera sees, centred on the point below it (the camera looks at the globe's centre): `half`
 * to the nearest edge of the view and `reach` to its corner, both capped at the horizon. */
export function viewArc(distance, fov, aspect, radius = GLOBE_RADIUS) {
  const limb = Math.asin(Math.min(1, radius / Math.max(distance, radius)));
  const central = (angle) => { const seen = Math.min(angle, limb); return (Math.asin(Math.min(1, distance * Math.sin(seen) / radius)) - seen) * 180 / Math.PI; };
  const half = Math.tan(fov * Math.PI / 360);
  return { half: central(Math.atan(half * Math.min(1, aspect))), reach: central(Math.atan(half * Math.hypot(1, aspect))) };
}

/** Latitude and longitude lines every `step` degrees, as pairs of end points of segments no longer than `segment` degrees. A
 * finer graticule is drawn only around the view (`reach` degrees from `latitude`, `longitude`), so that it stays light. The
 * equator and the prime meridian are returned apart, as `major`, to be drawn a little stronger. */
export function graticuleLines({ step, latitude = 0, longitude = 0, reach = 180, segment = 0.5, radius = GLOBE_RADIUS + GRATICULE_LIFT }) {
  const south = Math.max(-90, latitude - reach), north = Math.min(90, latitude + reach);
  const lonReach = reach / Math.max(0.02, Math.cos(Math.min(89.9, Math.max(Math.abs(south), Math.abs(north))) * Math.PI / 180));
  const everywhere = reach >= 90 || south <= -90 || north >= 90 || lonReach >= 180;
  const west = everywhere ? -180 : longitude - lonReach, east = everywhere ? 180 : longitude + lonReach;
  const clean = (value) => Number(value.toFixed(7)), parallels = [], meridians = [], minor = [], major = [];
  for (let i = Math.ceil(south / step - 1e-9); i * step <= north + 1e-9; i += 1) { const value = clean(i * step); if (Math.abs(value) < 90 - 1e-9) parallels.push(value); }
  for (let i = Math.ceil(west / step - 1e-9); i * step <= east + 1e-9; i += 1) { const value = clean(i * step); if (!everywhere || value < 180 - 1e-9) meridians.push(value); }
  const run = (target, points) => { for (let k = 1; k < points.length; k += 1) target.push(...points[k - 1], ...points[k]); };
  for (const value of parallels) {
    const n = Math.max(1, Math.ceil((east - west) / segment));
    run(value === 0 ? major : minor, Array.from({ length: n + 1 }, (_, k) => globeXYZ(value, west + (east - west) * k / n, radius)));
  }
  for (const value of meridians) {
    const n = Math.max(1, Math.ceil((north - south) / segment));
    run(value === 0 ? major : minor, Array.from({ length: n + 1 }, (_, k) => globeXYZ(south + (north - south) * k / n, value, radius)));
  }
  return { minor, major, parallels, meridians, everywhere, south, north, west, east };
}

/** Where to write the degrees of a graticule: latitudes down the western edge of the view and longitudes along its southern
 * edge, so they stay beside whatever is looked at. `half` is the view's reach to its nearest edge, in degrees. */
export function graticuleTicks({ step, latitude, longitude, half }) {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)), size = (value) => Math.abs(value).toFixed(decimals);
  const wrap = (value) => { const turned = (((value + 180) % 360) + 360) % 360 - 180; return turned === -180 ? 180 : turned; };
  const near = (values, around) => values.sort((a, b) => Math.abs(a - around) - Math.abs(b - around)).slice(0, 14);
  const westLongitude = longitude - 0.6 * half / Math.max(0.25, Math.cos(latitude * Math.PI / 180)), southLatitude = Math.max(-88, Math.min(88, latitude - 0.6 * half));
  const lats = [], lons = [], lonRange = 0.85 * half / Math.max(0.25, Math.cos(southLatitude * Math.PI / 180));
  for (let i = Math.ceil((latitude - 0.85 * half) / step - 1e-9); i * step <= latitude + 0.85 * half + 1e-9; i += 1) { const value = Number((i * step).toFixed(7)); if (Math.abs(value) < 90 - 1e-9) lats.push(value); }
  for (let i = Math.ceil((longitude - lonRange) / step - 1e-9); i * step <= longitude + lonRange + 1e-9; i += 1) lons.push(Number((i * step).toFixed(7)));
  return [
    ...near(lats, latitude).map((value) => ({ axis: 'latitude', value, text: `${size(value)}°${value > 0 ? 'N' : value < 0 ? 'S' : ''}`, latitude: value, longitude: westLongitude })),
    ...near(lons, longitude).map((value) => { const at = wrap(value); return { axis: 'longitude', value: at, text: `${size(at)}°${at > 0 && at < 180 ? 'E' : at < 0 ? 'W' : ''}`, latitude: southLatitude, longitude: value }; }),
  ];
}

/** Where to stand to see these points ([x, y, z] on or above the globe): over their centre, far enough away that all of them
 * fit, or far enough to see the whole globe when they spread over more than half of it. The camera looks at the centre. */
export function globeFraming(points, { fov = 42, aspect = 1.6, radius = GLOBE_RADIUS, minAltitude = 0.01 } = {}) {
  const units = points.map(([x, y, z]) => { const r = Math.hypot(x, y, z) || 1; return [x / r, y / r, z / r]; });
  const half = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, aspect)), whole = radius / Math.sin(half * 0.9);
  let mean = units.reduce((sum, unit) => [sum[0] + unit[0], sum[1] + unit[1], sum[2] + unit[2]], [0, 0, 0]);
  // Points all round the Earth have no centre, and no points have none either: start from the first, else from a fixed view.
  if (Math.hypot(...mean) < 1e-6) mean = units[0] ?? [0.3, 0.4, 0.86];
  const { latitude, longitude } = globeAngles(mean), direction = globeXYZ(Math.max(-85, Math.min(85, latitude)), longitude, 1);
  const theta = units.reduce((worst, unit) => Math.max(worst, Math.acos(Math.max(-1, Math.min(1, unit[0] * direction[0] + unit[1] * direction[1] + unit[2] * direction[2])))), 0);
  let distance = whole;
  if (units.length && theta < 50 * Math.PI / 180) {
    const need = Math.max(theta * 1.35, 0.4 * Math.PI / 180);
    distance = Math.min(whole, radius * Math.cos(need) + radius * Math.sin(need) / Math.tan(half * 0.85));
  }
  return { direction, distance: Math.max(distance, radius + minAltitude), spread: theta * 180 / Math.PI };
}


// Lifetime locations are roles held at places, not continuous bodily trajectories. Keep home and workplace
// overlapping and separate. Unrecorded periods are computed from declared lifecycle boundaries only.
export function lifeLocations(frame) {
  const people = new Map();
  for (const object of frame?.objects ?? []) {
    if (!object.lifeLocation || !object.referentId) continue;
    if (!people.has(object.referentId)) people.set(object.referentId, { id: object.referentId, label: object.label, lifetime: object.lifetime, locations: [] });
    people.get(object.referentId).locations.push(object);
  }
  return [...people.values()].map((person) => {
    const locations = person.locations.sort((a, b) => (a.interval?.start ?? Infinity) - (b.interval?.start ?? Infinity));
    const intervals = locations.filter((item) => finite(item.interval?.start) && finite(item.interval?.end)).map((item) => item.interval);
    const gaps = [];
    let cursor = person.lifetime?.start ?? intervals[0]?.start;
    const end = person.lifetime?.end ?? Math.max(...intervals.map((item) => item.end));
    for (const interval of intervals) {
      if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
      cursor = Math.max(cursor ?? interval.start, interval.end);
    }
    if (finite(end) && finite(cursor) && cursor < end) gaps.push({ start: cursor, end });
    return { ...person, locations, gaps };
  });
}

// These are sequence links, never interpolated travel. Overlapping home/work roles do not form a journey.
export function locationSequence(frame, referentId = null) {
  const groups = new Map();
  for (const object of frame?.objects ?? []) {
    if (!object.interval || !object.referentId || (referentId && object.referentId !== referentId)) continue;
    const key = JSON.stringify([object.referentId, object.lifeLocation ? object.locationRole : 'presence']);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  }
  const links = [];
  for (const objects of groups.values()) {
    objects.sort((a, b) => a.interval.start - b.interval.start || a.interval.end - b.interval.end);
    for (let i = 1; i < objects.length; i += 1) {
      const a = objects[i - 1], b = objects[i];
      if (a.interval.end > b.interval.start) continue;
      links.push({ source: a, target: b, gap: b.interval.start > a.interval.end });
    }
  }
  return links;
}

// Understanding notes store a typed envelope in text. Render its prose, not its serialization. Other text is literal.
export function spatialRecordText(record = {}) {
  if (typeof record.text !== 'string') return record.description ?? record.boundary ?? '';
  try {
    const payload = JSON.parse(record.text);
    if (payload?.schema === 'meaning-model-understanding-note/v1' && typeof payload.text === 'string') return payload.text;
  } catch { /* Ordinary narrative prose is not JSON. */ }
  return record.text;
}

// A single native graph projection supplies context: only typed model relationships and declared narrative
// grounding edges. Neither provenance strings nor word overlap manufactures connections.
export function spaceConnections(inspection) {
  const graph = buildModelGraph(inspection), nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacent = new Map();
  for (const edge of graph.edges) {
    if (edge.kind === 'record_endpoint') continue;
    for (const [source, target] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      if (!adjacent.has(source)) adjacent.set(source, []);
      adjacent.get(source).push({ target, edge });
    }
  }
  return {
    nodes,
    related(object) {
      const seeds = new Map([
        ...object.processIds.map((id) => [modelGraphId('process', id), 0]),
        ...(object.placeId ? [[modelGraphId('referent', object.placeId), 1]] : []),
        ...(object.referentId ? [[modelGraphId('referent', object.referentId), 2]] : []),
      ]);
      const records = new Map(), eventIds = new Map();
      const add = (source, { target, edge }, rank) => {
        const node = nodes.get(target);
        if (!node || node.unresolved || seeds.has(target)) return;
        if (!records.has(target)) {
          const displayText = spatialRecordText(node.record), label = node.kind === 'narrative' ? String(node.record?.title ?? displayText.split(/\n/u)[0]?.replace(/^#+\s*/u, '') ?? node.label) : node.label;
          records.set(target, { ...node, displayText, label: label || node.label, via: [], rank, scope: ['period', 'place', 'person'][rank] });
        }
        const record = records.get(target);
        if (rank < record.rank) { record.rank = rank; record.scope = ['period', 'place', 'person'][rank]; }
        record.via.push({ relation: edge.relation, source: nodes.get(source)?.label ?? source });
        if (node.kind === 'event') eventIds.set(target, Math.min(rank, eventIds.get(target) ?? Infinity));
      };
      for (const [seed, rank] of seeds) for (const item of adjacent.get(seed) ?? []) add(seed, item, rank);
      // Passages and thoughts attached to those Events remain one declared step away, never guessed by prose.
      for (const [event, rank] of eventIds) for (const item of adjacent.get(event) ?? []) if (item.edge.kind === 'narrative_edge') add(event, item, rank);
      return [...records.values()].sort((a, b) => a.rank - b.rank || Number(b.kind === 'narrative') - Number(a.kind === 'narrative') || a.label.localeCompare(b.label));
    },
  };
}

// Restore a native record without pretending every note has coordinates. Prefer the retained frame; only a
// directly connected period can move a narrative/Event selection into another frame.
export function resolveSpaceSelection(frames, connections, selection, preferredFrame = 0) {
  const node = selection ? connections.nodes.get(modelGraphId(selection.kind, selection.id)) ?? null : null;
  const order = [preferredFrame, ...frames.map((_, index) => index).filter((index) => index !== preferredFrame)];
  if (selection) for (const frame of order) for (const object of frames[frame]?.objects ?? []) {
    const direct = selection.kind === 'process' ? object.processIds.includes(selection.id) : selection.kind === 'referent' && object.referentId === selection.id;
    const related = ['event', 'narrative'].includes(selection.kind) && connections.related(object).some((record) => record.scope === 'period' && record.kind === selection.kind && record.nativeId === selection.id);
    if (direct || related) return { frame, object, node };
  }
  return { frame: preferredFrame, object: null, node };
}

// The existing temporal presentation uses decimal years for civil-day clocks; Space retains native coordinates.
export const spaceToViewerTime = (time, unit) => String(unit).startsWith('civil_day_since_1970') ? 1970 + time / 365.2425 : time;
export const viewerToSpaceTime = (time, unit) => String(unit).startsWith('civil_day_since_1970') ? (time - 1970) * 365.2425 : time;

const CAUSAL = new Set(['causes', 'enables', 'constrains', 'prevents', 'realizes_forecast']);
// Which narrative records are passages of the told story, as their type or role says; every other attached node is a note.
const isPassage = (node) => node?.role === 'story_passage' || /(^|[._])(passage|chapter|scene|story_part)($|[._])/u.test(String(node?.node_type ?? ''));

/** The Events a frame can show where they happen, as the model declares it, and what is attached to them. An Event is
 * placed where a position it moves stands (its `process_ids`), else at a place it is declared to be located in whose
 * position the frame holds. Nothing is placed by containment, participants or the words of a region. Notes and
 * passages come from the narrative graph's own edges to the Event; causal links join two placed Events. */
export function placedEvents(model = {}, graph = {}, frames = []) {
  const meaning = model.meaning_model ?? {}, events = array(meaning.events);
  const byProcess = new Map(), byPlace = new Map();
  // A place stands at its own declared position; only failing that at the point a period there declares.
  for (const own of [true, false]) frames.forEach((frame, index) => { for (const object of frame.objects) {
    if (own) for (const id of object.processIds) if (!byProcess.has(id)) byProcess.set(id, { index, object });
    const ref = own ? object.referentId : object.placeId; if (ref && !byPlace.has(ref)) byPlace.set(ref, { index, object });
  } });
  const located = new Map();
  for (const binding of array(meaning.event_referent_bindings)) if (binding?.target?.kind === 'event' && LOCATED.has(binding.binding_type) && byPlace.has(binding.referent_id) && !located.has(binding.target.event_id)) located.set(binding.target.event_id, { ...byPlace.get(binding.referent_id), placeId: binding.referent_id });
  const nodes = new Map(array(graph.nodes).map((node) => [node.id, node]));
  const attached = new Map();
  for (const edge of array(graph.edges)) {
    if (edge?.source?.kind !== 'node' || edge.target?.kind !== 'anchor' || edge.target.anchor_kind !== 'event' || !nodes.has(edge.source.node_id)) continue;
    const list = attached.get(edge.target.anchor_id) ?? []; if (!list.some((item) => item.node.id === edge.source.node_id)) list.push({ node: nodes.get(edge.source.node_id), relation: edge.relation ?? null, passage: isPassage(nodes.get(edge.source.node_id)) });
    attached.set(edge.target.anchor_id, list);
  }
  const placed = [];
  for (const event of events) {
    // An Event that moves positions stands among them: every position it moves in the first frame that holds one.
    const moved = [...new Set([...array(event.process_ids), ...array(event.observation_process_ids)])].map((id) => byProcess.get(id)).filter(Boolean);
    const frame = moved[0]?.index;
    const objects = moved.length ? [...new Set(moved.filter((item) => item.index === frame).map((item) => item.object))] : located.has(event.id) ? [located.get(event.id).object] : [];
    if (!objects.length) continue;
    const via = moved.length ? 'position' : 'place', placeId = via === 'place' ? located.get(event.id).placeId : objects.length === 1 ? objects[0].placeId ?? null : null;
    placed.push({ id: event.id, event, frame: via === 'position' ? frame : located.get(event.id).index, objects, via, placeId, interval: event.interval ?? null,
      notes: (attached.get(event.id) ?? []).filter((item) => !item.passage), passages: (attached.get(event.id) ?? []).filter((item) => item.passage) });
  }
  const placedIds = new Set(placed.map((item) => item.id));
  const causal = array(meaning.event_relations).filter((relation) => CAUSAL.has(relation?.kind) && placedIds.has(relation.source_event_id) && placedIds.has(relation.target_event_id));
  return { events: placed, causal, unplaced: events.length - placed.length };
}
