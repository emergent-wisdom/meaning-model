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
    if (!objects.has(key)) objects.set(key, { id: key, frame: process.reference_frame ?? null, unit: process.unit ?? null, axes: [], position: [], motion: [], precision: [], orientation: null, processIds: [], referentId: null, interval: null, laws: [], declaration: process.scale ?? {}, provenance: array(process.provenance), ...extra });
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
    object.axes.push(axis); object.position.push(value.value); object.motion.push(motion); object.precision.push(precisionOf(process.uncertainty));
    object.processIds.push(process.id); object.laws.push(...moving); bind(object, process.id);
  }
  const placed = [...objects.values()].map((object) => {
    // Axes in their declared order: x, y, z first, then any others as declared.
    const order = object.axes.map((axis, i) => i).sort((a, b) => ((AXES.indexOf(object.axes[a]) + 1) || 9) - ((AXES.indexOf(object.axes[b]) + 1) || 9));
    const referent = referents.get(object.referentId); const place = referents.get(object.declaration.place_ref); const motion = order.map((i) => object.motion[i]);
    return { ...object, axes: order.map((i) => object.axes[i]), position: order.map((i) => object.position[i]), motion, precision: order.map((i) => object.precision[i]),
      laws: [...new Set(object.laws)], placeId: place?.id ?? null, placeLabel: String(object.declaration.place_label ?? (place ? labelOf(place) : object.declaration.label ?? '')), periodLabel: String(object.declaration.label ?? ''),
      lifeLocation: object.declaration.spatial_status === 'coarse_life_location', locationRole: object.declaration.location_role ?? null,
      lifetime: array(meaning.events).find((event) => event.id === referent?.lifecycle_event_id)?.interval ?? null,
      fullLabel: referent?.boundary ?? object.id, label: referent ? labelOf(referent) : words(object.id.replace(/^entity:/u, '')),
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

// How a frame's coordinates lie on the ground and upward: x east, y north and z up; or, when the frame's axes are
// latitude and longitude, a map with longitude narrowed by the cosine of the frame's middle latitude (and altitude
// up). A coordinate on any other axis is described, not drawn.
export function planeOf(frame) {
  const axes = frame.axes ?? []; const geo = axes.includes('latitude') && axes.includes('longitude');
  const latitudes = geo ? frame.objects.map((object) => object.position[object.axes.indexOf('latitude')]).filter(finite) : [];
  const narrow = geo && latitudes.length ? Math.cos((latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length) * Math.PI / 180) : 1;
  const east = geo ? 'longitude' : 'x', north = geo ? 'latitude' : 'y', up = geo ? (axes.includes('altitude') ? 'altitude' : 'z') : 'z';
  return { geo, narrow, east, north, up, coordinates(object, position) {
    const at = (axis) => { const i = object.axes.indexOf(axis); return i >= 0 ? position[i] : 0; };
    return { east: at(east) * (geo ? narrow : 1), north: at(north), up: at(up) };
  } };
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
