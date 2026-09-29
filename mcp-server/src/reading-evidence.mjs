import { createHash } from 'node:crypto';

export const eventTextSignature = (event) => createHash('sha256').update(JSON.stringify([event?.boundary ?? '', event?.description ?? ''])).digest('hex').slice(0, 16);

// Check only the declared text dependency. Matching text is not a certificate
// of truth, and a Cut with no recorded signature has not been checked.
export function readingTextEvidence(cut, index) {
  const signature = (cut.provenance ?? []).find((item) => String(item).startsWith('event-text:'))?.slice(11);
  if (!signature) return { status: 'untracked' };
  let eventId = cut.parent_event_id;
  const parent = index.events.get(eventId);
  if (!parent) return { status: 'unresolved', eventId, reason: 'The Event carrying this reading is missing.' };
  if (index.readings?.has(eventId)) {
    // Match cut-shares.readingOf: an actor's explicit decision is the signed
    // source, otherwise use its about record (including legacy other/about).
    // Unlike estimation's fallback, missing or ambiguous declared references
    // remain unresolved here: a surviving Event cannot certify a lost source.
    const facts = {};
    for (const item of parent.provenance ?? []) {
      const match = /^(perspective|decided-at):(.+)$/u.exec(String(item));
      if (match) facts[match[1]] = match[2];
    }
    if (facts.perspective === 'actor' && facts['decided-at']) eventId = facts['decided-at'];
    else {
      const targets = [...new Set((index.relations ?? []).filter((relation) => relation.source_event_id === eventId
        && (relation.kind === 'about' || (relation.kind === 'other' && /^about\b/iu.test(String(relation.description ?? '')))))
        .map((relation) => relation.target_event_id))];
      if (targets.length > 1) return { status: 'unresolved', reason: 'The reading names several subject Events; its text evidence cannot be assigned to one silently.' };
      eventId = targets[0] ?? eventId;
    }
  }
  const event = index.events.get(eventId);
  if (!event) return { status: 'unresolved', eventId, reason: 'The Event used by this reading is missing.' };
  return signature === eventTextSignature(event)
    ? { status: 'unchanged', eventId }
    : { status: 'needs_review', eventId, reason: 'The Event text has changed since this reading was made. These values have not been reassessed against it.' };
}

// What a judgment read, when it declares more than the one text an event-text signature covers. Optional provenance:
//   read:event:<eventId>=<signature>                      the boundary and description of one Event;
//   read:life:<lifecycleEventId>@<cutoff|*>/<depth>=<sig>  a subject's life account up to a cutoff, at a declared depth.
// A life account is the lifecycle Event and the Events it contains to that depth whose intervals start by the cutoff.
// Finer detail opened below that depth, and Events after the cutoff, do not change it; revising the coarse account
// does. It covers what the lifecycle contains, not world Events the subject only takes part in: name those with
// read:event. Nothing here is required: a Cut that records no read is untracked, which is reported, never refused.
const READ = /^read:(event|life):(.+)=([0-9a-f]{16})$/u;
const startOf = (event) => (typeof event?.interval?.start === 'number' ? event.interval.start : null);
const endOf = (event) => (typeof event?.interval?.end === 'number' ? event.interval.end : startOf(event));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export function lifeAccountSignature(index, lifecycleId, cutoff = null, depth = 1) {
  const life = index.events.get(lifecycleId);
  if (!life) return null;
  const rows = [[lifecycleId, life.boundary ?? '', life.description ?? '', life.interval ?? null]];
  const seen = new Set([lifecycleId]);
  let frontier = [lifecycleId];
  for (let level = 1; level <= depth; level += 1) {
    const next = [];
    for (const parentId of frontier) for (const childId of index.children.get(parentId) ?? []) {
      const child = index.events.get(childId);
      if (!child || seen.has(childId)) continue;
      const start = startOf(child);
      if (cutoff !== null && start !== null && start > cutoff) continue;
      seen.add(childId);
      rows.push([childId, child.boundary ?? '', child.description ?? '', child.interval ?? null]);
      next.push(childId);
    }
    frontier = next;
  }
  return digest(rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

const describeRead = (part) => part.kind === 'event' ? `the text of Event ${part.eventId}`
  : `the life account of ${part.eventId}${part.cutoff === null ? '' : ` up to ${part.cutoff}`} at containment depth ${part.depth}`;

export function declaredReads(cut) {
  const parts = [];
  for (const item of cut.provenance ?? []) {
    const match = READ.exec(String(item));
    if (!match) continue;
    const [, kind, target, signature] = match;
    if (kind === 'event') { parts.push({ kind, eventId: target, signature }); continue; }
    const at = target.lastIndexOf('@'), slash = target.lastIndexOf('/');
    if (at <= 0 || slash < at) continue;
    const cutoffText = target.slice(at + 1, slash), depth = Number(target.slice(slash + 1));
    const cutoff = cutoffText === '*' ? null : Number(cutoffText);
    if (!Number.isInteger(depth) || depth < 0 || (cutoff !== null && !Number.isFinite(cutoff))) continue;
    parts.push({ kind, eventId: target.slice(0, at), cutoff, depth, signature });
  }
  return parts;
}

// Compare each declared read with the current records. The result says which text or account each part covers.
export function declaredReadEvidence(cut, index) {
  const parts = declaredReads(cut).map((part) => {
    const compared = describeRead(part);
    if (!index.events.has(part.eventId)) return { ...part, compared, status: 'unresolved' };
    const current = part.kind === 'event' ? eventTextSignature(index.events.get(part.eventId)) : lifeAccountSignature(index, part.eventId, part.cutoff, part.depth);
    return { ...part, compared, status: current === part.signature ? 'unchanged' : 'needs_review' };
  });
  const status = !parts.length ? 'none' : parts.some((part) => part.status === 'unresolved') ? 'unresolved'
    : parts.some((part) => part.status === 'needs_review') ? 'needs_review' : 'unchanged';
  return { status, parts };
}

// The nearest Thing lifecycle that contains an Event, if any.
export function enclosingLifecycle(index, eventId) {
  const lifecycles = new Set([...index.referents.values()].map((referent) => referent.lifecycle_event_id).filter(Boolean));
  const seen = new Set([eventId]);
  let frontier = [...(index.parents.get(eventId) ?? [])];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (lifecycles.has(id)) return id;
      next.push(...(index.parents.get(id) ?? []));
    }
    frontier = next;
  }
  return null;
}

// The read signatures a recheck can record: the carrier and the Events it is about, and, optionally, the subject's
// life account up to the carrier's end at depth 1. Record only the parts the judgment actually read.
export function readSignatures(cut, index, aboutIds = []) {
  const carrier = index.events.get(cut.parent_event_id);
  const signWith = [...new Set([cut.parent_event_id, ...aboutIds])].filter((id) => index.events.has(id))
    .map((id) => `read:event:${id}=${eventTextSignature(index.events.get(id))}`);
  const lifecycleId = carrier ? enclosingLifecycle(index, cut.parent_event_id) : null;
  const cutoff = carrier ? endOf(carrier) : null;
  const lifeRead = lifecycleId ? `read:life:${lifecycleId}@${cutoff ?? '*'}/1=${lifeAccountSignature(index, lifecycleId, cutoff, 1)}` : null;
  return { signWith, lifeRead };
}
