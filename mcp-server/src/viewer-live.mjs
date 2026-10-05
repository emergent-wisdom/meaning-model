// The model a live view follows from anchor: of the anchor's descendants among the written revisions ({modelHash,
// previousModelHash}, in order of first write), the newest one with no child of its own, or the anchor itself. Walking
// the parent links rather than the writing order keeps a revision submitted again, or first written by an earlier
// process, from passing its own descendants; a new branch from an older revision is followed once it is written last.
export function newestWrittenDescendant(writes, anchor) {
  const children = new Map(); const order = new Map();
  writes.forEach(({ modelHash, previousModelHash }, i) => {
    if (order.has(modelHash)) return;
    order.set(modelHash, i);
    if (!children.has(previousModelHash)) children.set(previousModelHash, []);
    children.get(previousModelHash).push(modelHash);
  });
  let newest = anchor, newestOrder = -1;
  const seen = new Set([anchor]), queue = [anchor];
  while (queue.length) {
    const hash = queue.shift(), next = children.get(hash) ?? [];
    if (!next.length && hash !== anchor && order.get(hash) > newestOrder) { newest = hash; newestOrder = order.get(hash); }
    for (const child of next) if (!seen.has(child)) { seen.add(child); queue.push(child); }
  }
  return newest;
}

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
