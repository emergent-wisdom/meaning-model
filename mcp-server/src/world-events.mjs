// The Events that happen in the world: not the world itself (a declared context root), not a Thing's lifecycle (the
// Thing, which the viewer keeps in place), not the readings recorded about something, and not what sits under a root
// of another kind (a character's inner view, a holder's understanding, a document, a candidate). Importance asks for a
// level on these, and the coverage report holds a life's records to them.
import { isSeriesReadingEvent } from './series-mark.mjs';

export function worldEvents(mm) {
  const roots = new Map((mm?.context_roots ?? []).map((root) => [root.event_id, root.kind]));
  const lifecycles = new Set((mm?.referents ?? []).map((referent) => referent.lifecycle_event_id).filter(Boolean));
  const children = new Map();
  for (const relation of mm?.event_relations ?? []) {
    if (relation.kind !== 'contains') continue;
    children.set(relation.source_event_id, [...(children.get(relation.source_event_id) ?? []), relation.target_event_id]);
  }
  // Everything contained, at any depth, in a root that is not the accepted world, down to the nearest other root.
  const elsewhere = new Set();
  const queue = [...roots].filter(([, kind]) => kind !== 'accepted_world').map(([id]) => id);
  while (queue.length) {
    const id = queue.shift();
    if (elsewhere.has(id)) continue;
    elsewhere.add(id);
    for (const child of children.get(id) ?? []) if (!roots.has(child)) queue.push(child);
  }
  return (mm?.events ?? []).filter((event) => !isSeriesReadingEvent(event) && !roots.has(event.id) && !lifecycles.has(event.id) && !elsewhere.has(event.id));
}
