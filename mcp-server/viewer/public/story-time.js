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

// A passage is placed by its renders links; pages of an imported source text by their grounded_in links.
export function placeStoryUnits(units, edges, events, relation = 'renders') {
  const byId = new Map(events.map((event) => [event.id, event]));
  const links = new Map();
  for (const edge of edges) {
    if (edge.family !== 'grounding' || edge.relation !== relation || edge.source?.kind !== 'node'
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

// Recover only authored containment around the exact native render. `next` contributes reading order,
// never parentage. Kept split containers supply identity and their own links, never their old excluded prose.
export function buildStoryHierarchy({ units, nodes, edges, rootIds, events = [] }) {
  const unavailable = (reason) => ({ status: 'unavailable', reason, roots: [] });
  if (!Array.isArray(rootIds) || !rootIds.length) return unavailable('render_roots_unavailable');
  const visible = new Map(nodes.filter((node) => node.content_included !== false && !node.boundary).map((node) => [node.id, node]));
  const rendered = new Map(units.map((unit) => [unit.id, unit]));
  if (rendered.size !== units.length || rootIds.some((id) => !visible.has(id))) return unavailable('graph_render_mismatch');
  const contains = new Map(); const next = new Map(); const incoming = new Map();
  for (const edge of edges) {
    if (edge.family !== 'structural' || edge.source?.kind !== 'node' || edge.target?.kind !== 'node') continue;
    const from = edge.source.node_id; const to = edge.target.node_id;
    if (!visible.has(from) || !visible.has(to)) continue;
    const map = edge.relation === 'contains' ? contains : edge.relation === 'next' ? next : null;
    if (!map) continue;
    if (!map.has(from)) map.set(from, []);
    map.get(from).push(edge);
    if (edge.relation === 'contains') {
      if (!incoming.has(to)) incoming.set(to, new Set());
      incoming.get(to).add(from);
    }
  }
  const lexical = (a, b) => {
    const left = [...String(a)]; const right = [...String(b)];
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      const difference = left[i].codePointAt(0) - right[i].codePointAt(0); if (difference) return difference;
    }
    return left.length - right.length;
  };
  const compare = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)
    || lexical(a.id, b.id) || lexical(a.target.node_id, b.target.node_id);
  for (const list of [...contains.values(), ...next.values()]) list.sort(compare);
  const visited = new Set(); const parentOf = new Map(); const sequence = [];
  const pending = [...rootIds].reverse().map((id) => ({ id, parent: null }));
  while (pending.length) {
    const { id, parent } = pending.pop();
    if (visited.has(id) || !visible.has(id)) continue;
    visited.add(id); parentOf.set(id, parent);
    if (rendered.has(id)) sequence.push(id);
    const children = contains.get(id); const following = children ?? next.get(id) ?? [];
    for (const edge of [...following].reverse()) pending.push({ id: edge.target.node_id, parent: children ? id : null });
  }
  if (sequence.length !== units.length || sequence.some((id, i) => id !== units[i].id)) return unavailable('graph_render_mismatch');
  // A sibling may first be visited by `next`; its unique declared contains parent still applies.
  // Ignore parents outside the selected native traversal, rather than importing another document's structure.
  for (const id of visited) {
    const parents = [...(incoming.get(id) ?? [])].filter((parent) => visited.has(parent));
    incoming.set(id, new Set(parents)); parentOf.set(id, parents.length === 1 ? parents[0] : null);
  }
  const reading = units.filter((unit) => unit.role !== 'document_root' && String(unit.text ?? '').trim());
  const measured = measureStoryUnits(reading, events); const ranks = new Map(reading.map((unit, i) => [unit.id, i]));
  const byUnit = new Map(measured.map((part) => [part.unit.id, part])); const included = new Set();
  const boundaries = new Set(rootIds);
  for (const unit of reading) {
    let id = unit.id; const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      if (seen.size > 128) return unavailable('hierarchy_depth_limit');
      if ((incoming.get(id)?.size ?? 0) > 1) return unavailable('shared_containment');
      const node = visible.get(id);
      if (!node) return unavailable('graph_render_mismatch');
      if (node.role === 'document_root' || (boundaries.has(id) && id !== unit.id)) break;
      included.add(id); id = parentOf.get(id);
    }
  }
  const ownUnits = placeStoryUnits([...included].map((id) => {
    const node = visible.get(id); const unit = rendered.get(id);
    return unit ? { ...unit } : { id, type: node.node_type ?? null, role: node.role ?? null, title: node.title ?? null, text: '', born: node.born ?? null };
  }), edges, events);
  const entries = new Map(ownUnits.map((unit) => [unit.id, { unit, children: [], renderedUnitIds: [] }]));
  const roots = [];
  for (const [id, entry] of entries) {
    const parent = entries.get(parentOf.get(id));
    if (parent) parent.children.push(entry); else roots.push(entry);
  }
  const summarize = (entry) => {
    for (const child of entry.children) summarize(child);
    entry.children.sort((a, b) => a.firstRank - b.firstRank);
    const ids = [...(byUnit.has(entry.unit.id) ? [entry.unit.id] : []), ...entry.children.flatMap((child) => child.renderedUnitIds)]
      .sort((a, b) => ranks.get(a) - ranks.get(b));
    entry.renderedUnitIds = ids; entry.firstRank = ranks.get(ids[0]);
    entry.words = ids.reduce((sum, id) => sum + byUnit.get(id).words, 0);
    entry.wordStart = byUnit.get(ids[0])?.wordStart ?? 0; entry.wordEnd = byUnit.get(ids.at(-1))?.wordEnd ?? entry.wordStart;
  };
  for (const entry of roots) summarize(entry);
  roots.sort((a, b) => a.firstRank - b.firstRank);
  for (const entry of entries.values()) {
    const ranks2 = entry.renderedUnitIds.map((id) => ranks.get(id));
    if (ranks2.some((rank, i) => rank !== ranks2[0] + i)) return unavailable('noncontiguous_containment');
  }
  const measurePeers = (siblings) => {
    const own = measureStoryUnits(siblings.map((entry) => entry.unit), events);
    siblings.forEach((entry, i) => {
      entry.timing = own[i].timing; entry.relativeToPrevious = own[i].relativeToPrevious;
      delete entry.firstRank; measurePeers(entry.children);
    });
  };
  measurePeers(roots);
  return { status: 'available', roots };
}

// A reversible overview only: show the first titled parts, keeping all enclosing groups in the full hierarchy.
export function firstNamedStoryParts(roots) {
  return roots.flatMap((entry) => String(entry.unit.title ?? '').trim() || !entry.children.length
    ? [entry] : firstNamedStoryParts(entry.children));
}
