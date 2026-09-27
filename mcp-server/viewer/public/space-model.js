// Where things are, as a model declares it: a process whose value is a pose or a position vector, or scalar processes
// declared as position coordinates (scale semantic_role "position" with an axis), each in a named reference frame.
// Nothing is placed from a name, a free-text region or prose. Motion is shown only where it follows exactly from a
// declared law: an always-active evolution of a coordinate by a constant, or by a static process, from the model's
// start (time 0). Other laws that move a position are named, not evaluated.
const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const AXES = ['x', 'y', 'z'];

function nameOf(referent) {
  const boundary = String(referent?.boundary ?? ''); const lead = boundary.split(/[,;(]| - | — /u)[0].trim();
  if (lead && lead.split(/\s+/u).length <= 4 && /^\p{Lu}/u.test(lead)) return lead.replace(/^(the|a) /iu, '');
  return String(referent?.id ?? '').split('.').filter(Boolean).at(-1)?.replace(/[_-]+/gu, ' ') ?? '';
}
const words = (id) => String(id).split('.').filter(Boolean).at(-1)?.replace(/[_-]+/gu, ' ') ?? String(id);
// Where an Event takes place, as a binding declares it without coordinates. The two binding types in use say the
// same thing; they are read as they are declared, never inferred from a name or a region's words.
export const LOCATED = new Set(['located_in', 'spatial_setting']);
const placeName = (referent) => { const first = String(referent?.boundary ?? '').split(/(?<=[.;])\s/u)[0].replace(/[.;]$/u, '').trim(); return (first.length > 72 ? `${first.slice(0, 71)}…` : first) || words(referent?.id ?? ''); };

export function spaceModel(model = {}) {
  const processes = array(model.processes), meaning = model.meaning_model ?? {};
  const byId = new Map(processes.map((process) => [process.id, process]));
  const referents = new Map(array(meaning.referents).map((referent) => [referent.id, referent]));
  // A process is a referent's by a declared binding, never by its name.
  const boundTo = new Map();
  for (const binding of array(meaning.event_referent_bindings)) {
    if (binding?.target?.kind === 'process' && referents.has(binding.referent_id) && !boundTo.has(binding.target.process_id)) boundTo.set(binding.target.process_id, binding.referent_id);
  }
  // A disabled law moves nothing.
  const laws = array(model.laws).filter((law) => law?.enabled !== false);
  const lawsOn = new Map();
  for (const law of laws) {
    const operator = law?.operator ?? {}; const targets = [operator.target, ...array(operator.effects).map((effect) => effect?.target)].filter(Boolean);
    for (const target of targets) { if (!lawsOn.has(target)) lawsOn.set(target, []); lawsOn.get(target).push(law); }
  }
  const scalarValue = (process) => (process?.initial_value?.kind === 'scalar' && finite(process.initial_value.value) ? process.initial_value.value : null);
  // The rate of one coordinate, when an always-active evolution law declares it exactly.
  const rateOf = (processId) => {
    const moving = lawsOn.get(processId) ?? [];
    if (!moving.length) return { rate: 0, laws: [] };
    if (moving.length > 1) return { rate: null, laws: moving.map((law) => law.id) };
    const [law] = moving; const operator = law.operator ?? {}; const always = (law.activation ?? 'always') === 'always';
    if (operator.role !== 'evolution' || !always || operator.innovation) return { rate: null, laws: [law.id] };
    const derivative = operator.derivative ?? {};
    if (derivative.op === 'constant' && finite(derivative.value)) return { rate: derivative.value, laws: [law.id] };
    if (derivative.op === 'process') {
      const source = byId.get(derivative.process); const value = scalarValue(source);
      if (value !== null && !(lawsOn.get(derivative.process)?.length)) return { rate: value, laws: [law.id] };
    }
    return { rate: null, laws: [law.id] };
  };
  const objects = new Map();
  const objectFor = (key, process, extra) => {
    if (!objects.has(key)) objects.set(key, { id: key, frame: process.reference_frame ?? null, unit: process.unit ?? null, axes: [], position: [], rates: [], orientation: null, processIds: [], referentId: null, laws: [], ...extra });
    return objects.get(key);
  };
  for (const process of processes) {
    const role = process.scale?.semantic_role; const value = process.initial_value ?? {};
    const declaredAxes = array(process.axes).map((axis) => axis?.id).filter(Boolean);
    if (value.kind === 'object_pose' || (value.kind === 'vector' && role === 'position')) {
      const position = value.kind === 'object_pose' ? array(value.value?.position) : array(value.value);
      if (!position.length || !position.every(finite)) continue;
      const object = objectFor(process.id, process, { kind: value.kind === 'object_pose' ? 'pose' : 'vector' });
      object.axes = position.map((_, i) => (declaredAxes.length === position.length ? declaredAxes[i] : AXES[i] ?? `axis ${i + 1}`));
      object.position = [...position]; object.rates = position.map(() => (lawsOn.get(process.id)?.length ? null : 0));
      if (value.kind === 'object_pose' && array(value.value?.orientation).every(finite)) object.orientation = [...value.value.orientation];
      object.processIds.push(process.id); object.referentId = boundTo.get(process.id) ?? null; object.laws.push(...(lawsOn.get(process.id) ?? []).map((law) => law.id));
      continue;
    }
    if (value.kind !== 'scalar' || role !== 'position' || !finite(value.value)) continue;
    // Coordinates of one thing: the spatial entity their support names, else the id without its axis.
    const entity = array(process.support).find((item) => String(item).startsWith('spatial_entity:'))?.slice(15);
    const axis = process.scale?.axis ?? declaredAxes[0] ?? 'x';
    const key = entity ? `entity:${entity}` : String(process.id).replace(/\.position\.[^.]+$/u, '');
    const object = objectFor(key, process, { kind: 'coordinates' });
    if (object.axes.includes(axis) || (object.frame ?? null) !== (process.reference_frame ?? null)) continue;
    const { rate, laws: moving } = rateOf(process.id);
    object.axes.push(axis); object.position.push(value.value); object.rates.push(rate); object.processIds.push(process.id); object.laws.push(...moving);
    object.referentId ??= boundTo.get(process.id) ?? null;
  }
  const placed = [...objects.values()].map((object) => {
    // Axes in their declared order: x, y, z first, then any others as declared.
    const order = object.axes.map((axis, i) => i).sort((a, b) => ((AXES.indexOf(object.axes[a]) + 1) || 9) - ((AXES.indexOf(object.axes[b]) + 1) || 9));
    const referent = referents.get(object.referentId);
    return { ...object, axes: order.map((i) => object.axes[i]), position: order.map((i) => object.position[i]), rates: order.map((i) => object.rates[i]),
      label: referent ? nameOf(referent) : words(object.id.replace(/^entity:/u, '')), moves: order.some((i) => object.rates[i] !== 0), evaluated: order.every((i) => object.rates[i] !== null) };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
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
    const who = [...new Set([...Object.values(event.participants ?? {}).flat(), ...bindings.filter((binding) => !LOCATED.has(binding.binding_type)).map((binding) => binding.referent_id)])]
      .filter((id) => referents.has(id) && !placeIds.has(id)).map((id) => nameOf(referents.get(id)));
    for (const binding of places) {
      if (!settings.has(binding.referent_id)) settings.set(binding.referent_id, { id: binding.referent_id, name: placeName(referents.get(binding.referent_id)), boundary: referents.get(binding.referent_id).boundary, events: [] });
      settings.get(binding.referent_id).events.push({ id: eventId, label: event.boundary, description: event.description ?? null, interval: binding.interval ?? event.interval ?? null, role: binding.role, type: binding.binding_type, who });
    }
  }
  const startOf = (item) => item.interval?.start ?? Infinity;
  const settingList = [...settings.values()].map((setting) => ({ ...setting, events: setting.events.sort((a, b) => startOf(a) - startOf(b)), who: [...new Set(setting.events.flatMap((event) => event.who))] }))
    .sort((a, b) => startOf(a.events[0]) - startOf(b.events[0]) || a.name.localeCompare(b.name));
  return {
    settings: settingList,
    frames: [...frames.values()].map((frame) => ({ ...frame, axes: [...new Set(frame.objects.flatMap((object) => object.axes))], dimensions: Math.max(...frame.objects.map((object) => object.position.length)) })),
    timeUnit: model.time_unit ?? null,
    // What the view cannot place: referents with no declared position, and places named only in free text.
    unplacedReferents: [...referents.values()].filter((referent) => !positioned.has(referent.id)).map((referent) => ({ id: referent.id, name: nameOf(referent) })),
    textRegions: [...new Set(array(meaning.events).map((event) => event?.region).filter((region) => typeof region === 'string' && region.trim()))],
  };
}

// Where an object stands at a model time: its declared start, moved by its exactly declared rates. Null when a
// rate is not declared exactly and the time is not the start.
export function positionAt(object, t = 0) {
  if (!t) return [...object.position];
  if (!object.evaluated) return null;
  return object.position.map((value, i) => value + object.rates[i] * t);
}
