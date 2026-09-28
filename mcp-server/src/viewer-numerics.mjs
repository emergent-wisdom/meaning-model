// Project recorded numbers without reconstructing them from prose or treating separate Cuts as a simulation.
// Every Cut is its own question-relative composition. Time comes only from its owning Event's declared interval.
import { indexModel } from './model-questions.mjs';
import { readingTextEvidence } from './reading-evidence.mjs';

export function projectNumerics(model, { toDisplayTime = (value) => value } = {}) {
  const index = indexModel(model);
  const mm = model?.meaning_model ?? {};
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const cuts = new Map((mm.normalized_cuts ?? []).map((cut) => [cut.id, cut]));
  const parents = new Map();
  const roots = new Map();
  const bindings = new Map();
  const copy = (value) => value === undefined ? null : structuredClone(value);
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const relation of mm.event_relations ?? []) if (relation.kind === 'contains') add(parents, relation.target_event_id, relation.source_event_id);
  for (const root of mm.context_roots ?? []) add(roots, root.event_id, root);
  for (const binding of mm.event_referent_bindings ?? []) if (binding.target?.kind === 'event') add(bindings, binding.target.event_id, binding);

  const contextCache = new Map();
  const contextOf = (eventId) => {
    if (contextCache.has(eventId)) return copy(contextCache.get(eventId));
    const found = new Set(), visited = new Set(), visiting = new Set(), issues = new Set();
    // Stop at the first root on each containment branch. A shared child never inherits an arbitrary first parent.
    const stack = [{ id: eventId, exit: false }];
    while (stack.length) {
      const { id, exit } = stack.pop();
      if (exit) { visiting.delete(id); continue; }
      if (visiting.has(id)) { issues.add('containment-cycle'); continue; }
      if (visited.has(id)) continue;
      visited.add(id);
      if (!events.has(id)) issues.add('missing-event');
      if (roots.has(id)) { for (const root of roots.get(id)) found.add(root); continue; }
      if (roots.size && !(parents.get(id)?.length)) issues.add('unrooted-branch');
      visiting.add(id);
      stack.push({ id, exit: true });
      for (const parent of [...(parents.get(id) ?? [])].reverse()) stack.push({ id: parent, exit: false });
    }
    const contexts = [...found].map((root) => ({ rootId: root.event_id, kind: root.kind,
      label: events.get(root.event_id)?.boundary ?? root.event_id,
      // The schema does not currently declare a context holder. Keep its exact record and participants;
      // names in prose, IDs or provenance must not silently become an asserted identity.
      holder: null, participants: copy(events.get(root.event_id)?.participants ?? {}), record: copy(root),
      provenance: copy(events.get(root.event_id)?.provenance ?? []) }));
    const value = { contexts, contextStatus: contexts.length > 1 ? 'ambiguous' : contexts.length ? 'declared' : roots.size ? 'unrooted' : 'unspecified',
      contextIssues: [...issues] };
    contextCache.set(eventId, value);
    return copy(value);
  };

  const conditionChain = (cut) => {
    const chain = [], visited = new Set([cut.id]);
    let condition = cut.conditioning;
    while (condition) {
      const parent = cuts.get(condition.cut_id);
      const cycle = visited.has(condition.cut_id);
      const answer = parent?.answers?.find((item) => item.key === condition.answer_key);
      chain.push({ cutId: condition.cut_id, answerKey: condition.answer_key, reference: copy(condition),
        question: parent?.question ?? null, unit: parent?.unit ?? null, parentEventId: parent?.parent_event_id ?? null,
        answer: copy(answer), answers: copy(parent?.answers ?? []), conditioning: copy(parent?.conditioning),
        provenance: copy(parent?.provenance ?? []), withdrawn: copy(parent?.withdrawn),
        ...(parent ? contextOf(parent.parent_event_id) : { contexts: [], contextStatus: 'unresolved', contextIssues: [] }),
        status: cycle ? 'cycle' : !parent ? 'missing-cut' : !answer ? 'missing-answer' : 'resolved' });
      if (!parent || cycle) break;
      visited.add(parent.id);
      condition = parent.conditioning;
    }
    return chain;
  };
  const displayTime = (value) => {
    if (!Number.isFinite(value)) return null;
    const result = toDisplayTime(value);
    return Number.isFinite(result) ? result : null;
  };
  const projectCut = (cut) => {
    const event = events.get(cut.parent_event_id);
    const interval = copy(event?.interval);
    const t = displayTime(interval?.start), end = displayTime(interval?.end);
    const displayable = t !== null && end !== null && end >= t;
    return { id: cut.id, parentEventId: cut.parent_event_id, question: cut.question, unit: cut.unit,
      answers: copy(cut.answers ?? []), conditioning: copy(cut.conditioning), conditioningChain: conditionChain(cut),
      interval, timeUnit: model?.time_unit ?? null, t, end, displayable,
      placement: !event ? 'missing-event' : !interval ? 'undated' : displayable ? 'dated' : 'invalid-interval',
      eventLabel: event?.boundary ?? event?.description ?? cut.parent_event_id,
      eventDescription: event?.description ?? null, eventProvenance: copy(event?.provenance ?? []),
      participants: copy(event?.participants ?? {}), bindings: copy(bindings.get(cut.parent_event_id) ?? []),
      ...contextOf(cut.parent_event_id), evidence: readingTextEvidence(cut, index), provenance: copy(cut.provenance ?? []), record: copy(cut) };
  };
  const current = [], historical = [];
  for (const cut of mm.normalized_cuts ?? []) (cut.withdrawn ? historical : current).push(projectCut(cut));
  const scalarRecords = (model?.processes ?? []).filter((process) => process.initial_value?.kind === 'scalar').map((process) => ({
    id: process.id, processId: process.id, value: process.initial_value.value, unit: process.unit ?? null,
    valueType: copy(process.value_type), uncertainty: copy(process.uncertainty), referenceFrame: process.reference_frame ?? null,
    provenance: copy(process.provenance ?? []), support: copy(process.support ?? []), record: copy(process),
    // An initial value is not a dated observation or a temporal trajectory, even if its support contains date-like prose.
    interval: null, timeUnit: model?.time_unit ?? null, t: null, end: null, displayable: false, placement: 'untimed-initial-value',
  }));
  return { cuts: current, scalarRecords, historical: { cuts: historical, count: historical.length },
    counts: { cuts: current.length, datedCuts: current.filter((cut) => cut.displayable).length,
      unplacedCuts: current.filter((cut) => !cut.displayable).length, scalarRecords: scalarRecords.length,
      historicalCuts: historical.length, ambiguousContexts: current.filter((cut) => cut.contextStatus === 'ambiguous').length } };
}
