// Index declared relationships only. Event containment, process decomposition and
// conditional Cuts are different structures; none is inferred from names or values.
const records = (items) => new Map((items ?? []).filter((item) => item?.id != null).map((item) => [item.id, item]));
function add(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function rootsFor(items, children, parents, target) {
  const roots = [], seen = new Set();
  function cover(id) {
    const pending = [id];
    while (pending.length) {
      const next = pending.pop();
      if (seen.has(next) || !items.has(next)) continue;
      seen.add(next);
      for (const edge of children.get(next) ?? []) pending.push(target(edge));
    }
  }
  // A cycle has no root. Add its first still-unreachable record as an entry point;
  // the UI identifies repeat edges as references instead of unfolding forever.
  for (const id of items.keys()) if (!(parents.get(id)?.length)) { roots.push(id); cover(id); }
  for (const id of items.keys()) if (!seen.has(id)) { roots.push(id); cover(id); }
  return roots;
}

export function buildStructureIndex(model = {}) {
  const meaning = model.meaning_model ?? {};
  const events = records(meaning.events), processes = records(model.processes), cuts = records(meaning.normalized_cuts);
  const eventChildren = new Map(), eventParents = new Map(), processChildren = new Map(), processParents = new Map();
  for (const edge of meaning.event_relations ?? []) if (edge.kind === 'contains') {
    add(eventChildren, edge.source_event_id, edge);
    if (events.has(edge.source_event_id)) add(eventParents, edge.target_event_id, edge);
  }
  for (const edge of model.decomposition ?? []) {
    add(processChildren, edge.parent, edge);
    if (processes.has(edge.parent)) add(processParents, edge.child, edge);
  }
  const cutsByEvent = new Map(), conditionedCuts = new Map(), physicalCutsByEvent = new Map(), contexts = new Map();
  for (const cut of cuts.values()) {
    add(cutsByEvent, cut.parent_event_id, cut);
    if (cut.conditioning) {
      const { cut_id, answer_key } = cut.conditioning;
      if (!conditionedCuts.has(cut_id)) conditionedCuts.set(cut_id, new Map());
      add(conditionedCuts.get(cut_id), answer_key, cut);
    }
  }
  for (const cut of meaning.physical_cuts ?? []) add(physicalCutsByEvent, cut.parent_event_id, cut);
  for (const context of meaning.context_roots ?? []) add(contexts, context.event_id, context);
  return { events, processes, cuts, eventChildren, eventParents, processChildren, processParents,
    eventRoots: rootsFor(events, eventChildren, eventParents, (edge) => edge.target_event_id),
    processRoots: rootsFor(processes, processChildren, processParents, (edge) => edge.child),
    cutsByEvent, conditionedCuts, physicalCutsByEvent, contexts };
}

export function formatModelInterval(interval, timeUnit) {
  if (!interval) return 'No interval declared';
  const start = interval.start, end = interval.end;
  const native = `${start ?? 'unspecified'} → ${end ?? 'unspecified'} ${timeUnit || '(unit not declared)'}`;
  if (timeUnit !== 'civil_day_since_1970_01_01') return native;
  const date = (day) => {
    if (!Number.isFinite(day)) return null;
    const value = new Date(day * 86400000);
    return Number.isFinite(value.getTime()) ? value.toISOString().replace(/T00:00:00\.000Z$/, '') : null;
  };
  const first = date(start), last = date(end);
  return first && last ? `${first} → ${last} · ${native}` : native;
}
