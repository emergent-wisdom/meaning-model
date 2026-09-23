// Descriptions give numbers meaning: every Event that parents a Cut needs a description of what
// happens in it. Dependency-free, because the service reports coverage on every model write.
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;

export function descriptionCoverage(model) {
  const layer = model?.meaning_model ?? {};
  const events = layer.events ?? [];
  const described = new Set(events.filter((event) => nonblank(event.description)).map((event) => event.id));
  const carries = new Map();
  const add = (eventId, item) => { if (!carries.has(eventId)) carries.set(eventId, []); carries.get(eventId).push(item); };
  for (const cut of layer.normalized_cuts ?? []) add(cut.parent_event_id, `cut:${cut.id}`);
  for (const cut of layer.physical_cuts ?? []) add(cut.parent_event_id, `physical_cut:${cut.id}`);
  const undescribedNumbers = [...carries].filter(([eventId]) => !described.has(eventId)).map(([eventId, items]) => ({ eventId, carries: items }));
  const undescribedProcessEvents = events.filter((event) => !described.has(event.id)
    && ((event.process_ids ?? []).length || (event.observation_process_ids ?? []).length)).map((event) => event.id);
  return {
    schema: 'meaning-model-description-coverage/v1',
    events: events.length, described: described.size, eventsWithCuts: carries.size,
    undescribedNumbers, undescribedProcessEvents,
    rule: 'Every Event that parents a Cut needs a description of what happens in it, so its numbers mean something. Describe most other Events too.',
  };
}

export function assertDescribedEvents(eventsById, eventIds, action) {
  const missing = [...new Set(eventIds)].filter((eventId) => !nonblank(eventsById.get(eventId)?.description));
  if (missing.length) {
    throw new Error(`${action} needs a description on ${missing.length === 1 ? 'Event' : 'Events'} ${missing.join(', ')}: say what happens in ${missing.length === 1 ? 'it' : 'each'}, so the Cut's numbers mean something.`);
  }
}
