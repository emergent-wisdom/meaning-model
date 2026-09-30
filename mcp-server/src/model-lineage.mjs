// A model revision's place on its revision chain. Two hashes that differ say nothing about which came first; only the
// chain of previous_model_hash links does.
// The walk follows at most this many links back from a revision.
export const MAX_LINEAGE_LINKS = 255;

// Links from modelHash back to ancestorHash along the revision chain, or null when ancestorHash is not reached within
// the bound. A failed inspection is thrown, not read as the end of the chain.
export async function modelLineageSteps(service, ancestorHash, modelHash) {
  let cursor = modelHash;
  for (let links = 0; cursor; links += 1) {
    if (cursor === ancestorHash) return links;
    if (links === MAX_LINEAGE_LINKS) return null;
    const inspected = await service.inspectModel({ modelHash: cursor });
    cursor = inspected?.summary?.revision?.previous_model_hash ?? null;
  }
  return null;
}
