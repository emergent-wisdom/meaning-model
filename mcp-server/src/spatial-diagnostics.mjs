// A structural inventory, not a geocoder, simulator, or proof that spatial modeling is complete.
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const located = new Set(['located_in', 'spatial_setting']);

export function spatialDiagnostics(model, { accessScopes = [], limit = 12 } = {}) {
  const visible = (record) => !list(record.access_scopes).length || record.access_scopes.some((scope) => accessScopes.includes(scope));
  const mm = model?.meaning_model ?? {};
  const referents = new Set(list(mm.referents).filter(visible).map((record) => record.id));
  const events = list(mm.events).filter(visible);
  const eventIds = new Set(events.map((event) => event.id));
  const bindings = list(mm.event_referent_bindings).filter(visible);
  const bindingsByProcess = new Map();
  for (const binding of bindings) if (binding.target?.kind === 'process') {
    const id = binding.target.process_id;
    if (!bindingsByProcess.has(id)) bindingsByProcess.set(id, []);
    bindingsByProcess.get(id).push(binding);
  }
  const processes = list(model?.processes).filter(visible);
  const positions = [];
  for (const process of processes) {
    const type = process.value_type ?? {}, value = process.initial_value ?? {};
    const attached = bindingsByProcess.get(process.id) ?? [];
    // A financial/model coordinate is not necessarily physical; names, units and vector shape never decide this.
    const declared = process.scale?.semantic_role === 'position'
      || attached.some((binding) => binding.binding_type === 'coordinate' && binding.role === 'position');
    if (type.kind !== 'object_pose' && value.kind !== 'object_pose' && !declared) continue;
    const gaps = [];
    const dimension = type.kind === 'object_pose' ? type.position_dimensions : type.kind === 'vector' ? type.dimensions : type.kind === 'scalar' ? 1 : null;
    const coordinates = value.kind === 'object_pose' ? value.value?.position : value.kind === 'vector' ? value.value : value.kind === 'scalar' ? [value.value] : null;
    if (!Number.isInteger(dimension) || dimension < 1 || value.kind !== type.kind
      || !Array.isArray(coordinates) || coordinates.length !== dimension || !coordinates.every(finite)) gaps.push('invalid-position-value');
    if (type.kind === 'object_pose' && (!Number.isInteger(type.orientation_dimensions) || type.orientation_dimensions < 1
      || !Array.isArray(value.value?.orientation) || value.value.orientation.length !== type.orientation_dimensions
      || !value.value.orientation.every(finite))) gaps.push('invalid-orientation-value');
    const axes = list(process.axes);
    if (!text(process.reference_frame)) gaps.push('missing-reference-frame');
    if (!text(process.unit) && !(axes.length === dimension && axes.every((axis) => text(axis.unit)))) gaps.push('missing-unit');
    if (type.kind === 'scalar' && !text(process.scale?.axis) && !(axes.length === 1 && text(axes[0].id))) gaps.push('missing-coordinate-axis');
    const subjectBindings = attached.filter((binding) => binding.binding_type === 'coordinate' && binding.role === 'position' && referents.has(binding.referent_id));
    // Native ScalarSpatialProfile declares an entity through support without creating a referent.
    const spatialEntities = [...new Set(list(process.support).filter((item) => text(item)
      && item.startsWith('spatial_entity:') && text(item.slice('spatial_entity:'.length))))];
    if (!subjectBindings.length && !spatialEntities.length) gaps.push('missing-position-subject-binding');
    const provenance = list(process.provenance).filter(text);
    if (!provenance.length) gaps.push('missing-provenance');
    positions.push({ processId: process.id, valueKind: type.kind ?? null, dimensions: dimension,
      frame: process.reference_frame ?? null, unit: process.unit ?? null,
      locationRole: process.scale?.location_role ?? null,
      spatialStatus: process.scale?.spatial_status ?? null,
      coordinateAxis: type.kind === 'scalar' ? process.scale?.axis ?? axes[0]?.id ?? null : null,
      axes: axes.map((axis) => ({ id: axis.id, unit: axis.unit ?? process.unit ?? null })),
      subjects: subjectBindings.length
        ? subjectBindings.map((binding) => ({ referentId: binding.referent_id, bindingId: binding.id, interval: binding.interval ?? null }))
        : spatialEntities.map((support) => ({ spatialEntityId: support.slice('spatial_entity:'.length), support })),
      provenance, gaps, usableInitialPlacement: !gaps.length });
  }
  const namedRegionEventIds = events.filter((event) => text(event.region)).map((event) => event.id);
  const settings = bindings.filter((binding) => binding.target?.kind === 'event' && eventIds.has(binding.target.event_id)
    && located.has(binding.binding_type) && referents.has(binding.referent_id));
  const usable = positions.filter((position) => position.usableInitialPlacement).length;
  const qualitative = namedRegionEventIds.length + settings.length > 0;
  // A room snapshot, a town marker and a subject's history are different declarations.
  // Read explicitly adopted place-process conventions; an arbitrary graph or vector is not a life history.
  const placeProcesses = processes.filter((process) => process.scale?.process_key === 'place'
    && referents.has(process.scale?.subject_referent_id));
  const histories = placeProcesses.map((process) => {
    const subjectId = process.scale.subject_referent_id;
    const own = positions.filter((position) => position.usableInitialPlacement
      && position.subjects.some((subject) => subject.referentId === subjectId));
    const timed = own.filter((position) => position.subjects.some((subject) => subject.referentId === subjectId
      && finite(subject.interval?.start) && finite(subject.interval?.end) && subject.interval.end >= subject.interval.start));
    const coarse = timed.filter((position) => position.spatialStatus === 'coarse_life_location');
    const empty = process.initial_value?.kind === 'graph' && !list(process.initial_value.value?.nodes).length
      && !list(process.initial_value.value?.edges).length;
    const frames = new Map();
    for (const position of timed) {
      // These are compatible process declarations, not assembled poses or a chronological itinerary.
      // In particular, two scalar axes at one moment do not form a sequence of positions.
      const key = JSON.stringify([position.frame, position.valueKind, position.dimensions,
        position.unit, position.coordinateAxis, position.axes, position.locationRole]);
      if (!frames.has(key)) frames.set(key, { frame: position.frame, valueKind: position.valueKind,
        dimensions: position.dimensions, unit: position.unit, coordinateAxis: position.coordinateAxis,
        axes: position.axes, locationRole: position.locationRole, processIds: [] });
      frames.get(key).processIds.push(position.processId);
    }
    return { subjectId, placeProcessId: process.id, emptyPlaceIndex: empty,
      positionProcesses: own.length, datedPositionProcesses: timed.length, coarseLocationProcesses: coarse.length,
      sameFrameProcessGroups: [...frames.values()].filter((frame) => frame.processIds.length > 1),
      status: coarse.length ? 'coarse_location_episodes_declared' : own.length ? 'positions_without_recognized_coarse_history'
        : empty ? 'empty_place_index' : 'qualitative_or_other_place_history',
      completenessVerified: false };
  });
  return { status: usable ? 'declared_initial_positions' : positions.length ? 'incomplete_position_declarations' : qualitative ? 'qualitative_locations_only' : 'no_recognized_spatial_declarations',
    namedRegionEvents: namedRegionEventIds.length, settingBindings: settings.length,
    declaredPositionProcesses: positions.length, usableInitialPositionProcesses: usable,
    incompletePositionProcesses: positions.length - usable,
    positions: positions.slice(0, limit), positionsOmitted: Math.max(0, positions.length - limit),
    placeHistory: { declaredPlaceProcesses: histories.length,
      emptyPlaceIndexes: histories.filter((item) => item.emptyPlaceIndex).length,
      withoutCoarseHistory: histories.filter((item) => item.emptyPlaceIndex && !item.coarseLocationProcesses).length,
      subjects: histories.slice(0, limit), subjectsOmitted: Math.max(0, histories.length - limit),
      interpretation: 'An empty index prompts inspection of linked Events, not a claim that the subject has no whereabouts. Coarse episodes distinguish home bases, workplaces, visits and presence. Same-frame process groups preserve input order and compatible declaration shapes; they are not assembled poses, chronological sequences or evidence of movement. Neither process counts nor grouping establish lifetime coverage, exact routes or continuous bodily presence. Qualitative histories and explicit unknown periods remain valid.' },
    namedRegionEventIds: namedRegionEventIds.slice(0, limit),
    scope: 'Supplied model records visible to accessScopes; recognizes native object_pose and explicitly declared position vectors/scalars, coordinate/position bindings or native spatial_entity support for subjects, plus located_in/spatial_setting conventions. Other vocabulary or prose may hold more spatial understanding.',
    interpretation: 'Usable means an initial numeric position with frame, units, a declared subject and provenance. These declarations do not verify frame meaning, sourced accuracy, measurement precision, binding-time applicability, later motion, complete geometry or physical truth. A named location is not a coordinate; a coordinate is not a room layout.',
    completenessVerified: false, physicalTruthVerified: false };
}
