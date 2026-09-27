// Follow only descendants of the explicitly opened revision. Check from that
// anchor every time so a later fork from an earlier revision is not overlooked.
export function followedGraphHead(listing, anchor) {
  const revisions = new Map((listing?.revisions ?? []).map((revision) => [revision.graph_hash, revision]));
  if (!revisions.has(anchor)) return { status: 'unavailable' };
  const children = new Map();
  for (const revision of revisions.values()) {
    if (!children.has(revision.previous_graph_hash)) children.set(revision.previous_graph_hash, []);
    children.get(revision.previous_graph_hash).push(revision.graph_hash);
  }
  const seen = new Set(); let cursor = anchor;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const next = children.get(cursor) ?? [];
    if (next.length > 1) return { status: 'branched' };
    if (!next.length) return { status: 'following', graphHash: cursor };
    cursor = next[0];
  }
  return { status: 'unavailable' };
}
