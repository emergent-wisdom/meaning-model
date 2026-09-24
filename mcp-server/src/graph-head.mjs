// Add-only writes need not chain graph hashes by hand. A note, review, author record, world stage or direction only
// adds records, so it may name any earlier revision of its graph and goes to the graph's newest head, provided that
// head is the only one descending from it. A retry of a request that already succeeded resolves to the revision the
// first attempt wrote against, so it rebuilds the same batch and receives the same receipt. Edits, revisions and
// scene preparation keep exact hashes: they depend on what was read.

export async function resolveAppendHead(service, graphHash, requestId, exact = false) {
  if (exact) return { graphHash, advancedFrom: null };
  const prior = service.narrativeBatchReceipt?.(requestId) ?? null;
  if (prior) return { graphHash: prior.previousGraphHash, advancedFrom: prior.previousGraphHash === graphHash ? null : graphHash };
  let listing;
  try { listing = await service.listNarrativeRevisions({}); } catch { return { graphHash, advancedFrom: null }; }
  const revisions = new Map((listing?.revisions ?? []).map((revision) => [revision.graph_hash, revision]));
  const self = revisions.get(graphHash);
  if (!self || self.is_head) return { graphHash, advancedFrom: null };
  const heads = []; const queue = [graphHash]; const seen = new Set();
  while (queue.length) {
    const hash = queue.shift();
    if (seen.has(hash)) continue;
    seen.add(hash);
    const revision = revisions.get(hash);
    if (!revision) continue;
    if (revision.is_head) heads.push(hash);
    queue.push(...(revision.child_hashes ?? []));
  }
  if (heads.length === 1) return { graphHash: heads[0], advancedFrom: graphHash };
  throw new Error(`Graph ${self.graph_id} has branched after ${graphHash.slice(0, 12)}: its heads are ${heads.map((hash) => hash.slice(0, 12)).join(', ')}. Pass the head to add to.`);
}
