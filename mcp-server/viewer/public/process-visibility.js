// This is a display filter for unopened concurrent process branches, not a
// judgment that a straight interval or a qualitative account is unmodeled.
export function unopenedProcessEvents(data) {
  const model = data.inspection?.model ?? {};
  const meaning = model.meaning_model ?? {};
  const nativeEvents = new Map((meaning.events ?? []).map((event) => [event.id, event]));
  const events = new Map((data.events ?? []).map((event) => [event.id, event]));
  const processes = new Map((model.processes ?? []).map((process) => [process.id, process]));
  const projected = new Map((data.processes ?? []).map((process) => [process.id, process]));
  const parents = new Map();
  for (const relation of meaning.event_relations ?? []) if (relation.kind === 'contains') {
    if (!parents.has(relation.target_event_id)) parents.set(relation.target_event_id, []);
    parents.get(relation.target_event_id).push(relation.source_event_id);
  }
  for (const event of events.values()) if (event.parent) {
    if (!parents.has(event.id)) parents.set(event.id, []);
    parents.get(event.id).push(event.parent);
  }
  const candidates = new Set(); const developed = new Set();
  const excludedRole = (role) => ['phase', 'arc', 'life', 'world', 'inner'].includes(role);
  const excludedMeaning = (role) => /(?:lifecycle|relationship|change_arc|phase)/.test(String(role ?? ''));
  const known = (id) => events.has(id) || nativeEvents.has(id);
  const eventProcessIds = (id) => [...new Set([...(nativeEvents.get(id)?.process_ids ?? []), ...(events.get(id)?.processIds ?? [])])];
  const candidate = (id) => {
    if (!known(id) || excludedRole(events.get(id)?.role)) return;
    if (eventProcessIds(id).some((processId) => excludedMeaning(processes.get(processId)?.scale?.semantic_role ?? projected.get(processId)?.role))) return;
    candidates.add(id);
  };
  const branchHome = (eventId, processId) => {
    const pending = [...(parents.get(eventId) ?? [])]; const seen = new Set();
    while (pending.length) {
      const id = pending.pop(); if (seen.has(id)) continue; seen.add(id);
      if (eventProcessIds(id).includes(processId)) return false;
      pending.push(...(parents.get(id) ?? []));
    }
    const home = projected.get(processId)?.home;
    return !home || !eventProcessIds(home).includes(processId) || home === eventId;
  };
  for (const event of events.values()) if (event.role === 'slow') candidate(event.id);
  for (const event of nativeEvents.values()) if ((event.process_ids ?? []).some((id) => {
    const scale = processes.get(id)?.scale;
    return (scale?.semantic_role === 'person_is_process' || scale?.relationship === 'concurrent_non_summing') && branchHome(event.id, id);
  })) candidate(event.id);
  for (const person of data.people ?? []) for (const process of person.processes ?? []) {
    candidate(process.eventId);
    if (process.opened > 0) developed.add(process.eventId);
  }
  // Containment and explicit about relations are evidence even when their
  // target/source is outside the world's displayed hierarchy.
  for (const event of events.values()) {
    if (event.parent && event.parent !== event.id) developed.add(event.parent);
    if (event.cuts > 0) developed.add(event.id);
  }
  for (const relation of meaning.event_relations ?? []) {
    if (relation.kind === 'contains' && relation.source_event_id !== relation.target_event_id && known(relation.target_event_id)) developed.add(relation.source_event_id);
    if (relation.kind === 'about' && relation.source_event_id !== relation.target_event_id && known(relation.source_event_id)) developed.add(relation.target_event_id);
  }
  for (const cut of meaning.normalized_cuts ?? []) if (!cut.withdrawn) developed.add(cut.parent_event_id);
  for (const cut of data.numerics?.cuts ?? []) developed.add(cut.parentEventId ?? cut.eventId);

  const sampled = new Set();
  for (const process of [...(data.measures ?? []), ...(data.processes ?? [])]) {
    if ((process.points ?? []).some((point) => Number.isFinite(point.t) && Number.isFinite(point.v))) {
      sampled.add(process.id); if (process.home) developed.add(process.home);
    }
  }
  const hasInitialState = (process) => {
    const state = process?.initial_value; if (!state) return false;
    if (state.kind === 'graph') return Boolean(state.value?.nodes?.length || state.value?.edges?.length);
    if (state.kind === 'scalar') return Number.isFinite(state.value);
    if (Array.isArray(state.value)) return state.value.length > 0;
    if (typeof state.value === 'string') return state.value.length > 0;
    return state.value !== null && typeof state.value === 'object' && Object.keys(state.value).length > 0;
  };
  return new Set([...candidates].filter((id) => !developed.has(id)
    && !eventProcessIds(id).some((processId) => sampled.has(processId) || hasInitialState(processes.get(processId)))));
}
