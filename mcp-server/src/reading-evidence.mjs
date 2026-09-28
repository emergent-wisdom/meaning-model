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
