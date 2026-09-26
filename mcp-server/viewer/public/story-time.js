// Reading order belongs to the render. World time comes only from declared depicts/renders links.
// A link identifies an Event depicted by the passage; it does not disclose every fact in that Event.
// Count whitespace-separated prose tokens, excluding Markdown heading lines.
export function countProseWords(text) {
  return String(text ?? '').split(/\r?\n/).filter((line) => !/^\s*#{1,6}(?:\s|$)/u.test(line)).join(' ').match(/\S+/gu)?.length ?? 0;
}

// Compare only declared Event intervals. Their envelope is not continuous coverage or the order within the prose.
export function measureStoryUnits(units, events) {
  const byId = new Map(events.map((event) => [event.id, event]));
  let previous = null; let wordEnd = 0;
  return units.map((unit) => {
    const linked = [...new Set((unit.tells ?? []).map((tell) => tell.eventId))];
    const found = linked.map((id) => byId.get(id)).filter(Boolean);
    const dated = found.filter((event) => Number.isFinite(event.start) && Number.isFinite(event.end) && event.end >= event.start);
    const timing = { linked: linked.length, dated: dated.length, undated: found.length - dated.length,
      missing: linked.length - found.length, complete: linked.length > 0 && dated.length === linked.length,
      range: dated.length ? [Math.min(...dated.map((event) => event.start)), Math.max(...dated.map((event) => event.end))] : null };
    const relativeToPrevious = previous === null ? null : !previous.complete || !timing.complete ? 'unknown'
      : timing.range[1] < previous.range[0] ? 'before' : timing.range[0] > previous.range[1] ? 'after' : 'overlap';
    previous = timing;
    // Zero-based prose-word boundaries in render order; these are not text anchors or world dates.
    const wordStart = wordEnd; const words = countProseWords(unit.text); wordEnd += words;
    return { unit, words, wordStart, wordEnd, timing, relativeToPrevious };
  });
}

export function placeStoryUnits(units, edges, events) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const links = new Map();
  for (const edge of edges) {
    if (edge.family !== 'grounding' || edge.relation !== 'renders' || edge.source?.kind !== 'node'
      || edge.target?.kind !== 'anchor' || edge.target.anchor_kind !== 'event') continue;
    const id = edge.source.node_id;
    if (!links.has(id)) links.set(id, new Set());
    links.get(id).add(edge.target.anchor_id);
  }
  return units.map((unit) => {
    const tells = [...(links.get(unit.id) ?? [])].map((eventId) => ({ eventId }));
    const spans = tells.flatMap(({ eventId }) => {
      const event = byId.get(eventId);
      return Number.isFinite(event?.start)
        ? [{ eventId, start: event.start, end: Number.isFinite(event.end) ? event.end : event.start }] : [];
    });
    return { ...unit, tells, spans, timing: spans.length ? 'declared' : tells.length ? 'undated' : 'unlinked',
      t: spans.length ? Math.min(...spans.map((span) => span.start)) : null,
      end: spans.length ? Math.max(...spans.map((span) => span.end)) : null };
  });
}

// Several passages can depict the same moment, and a later passage can visit an earlier one.
export function partsAtTime(units, time) {
  const spans = units.flatMap((unit, i) => (unit.spans ?? []).map((span) => ({ ...span, i })));
  const active = spans.filter((span) => span.start <= time && span.end >= time);
  const latest = Math.max(-Infinity, ...spans.filter((span) => span.start <= time).map((span) => span.start));
  return [...new Set((active.length ? active : spans.filter((span) => span.start === latest)).map((span) => span.i))];
}
