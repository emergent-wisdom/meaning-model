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

// A revision's header (its model id, number, predecessor and provenance) for the branch walk, read once per service:
// revisions are immutable, and a model's summary is costly to build on a large model, so walking a long lineage twice
// should not cost twice. Kept per service, so a store never answers for a revision it does not hold.
const MAX_HEADERS = 8_192;
const headerCache = new WeakMap();
const ancestryCache = new WeakMap();
function cacheFor(caches, service) {
  if (!caches.has(service)) caches.set(service, new Map());
  return caches.get(service);
}
function remember(cache, key, value) {
  if (cache.size >= MAX_HEADERS && !cache.has(key)) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}
function headerOf(model) {
  const revision = model?.revision;
  return revision ? { modelId: model.id ?? null, number: revision.number, previous: revision.previous_model_hash ?? null, provenance: [...(revision.provenance ?? [])] } : null;
}
// A successful store write already has its validated immutable header. Reuse it, and the known predecessor's branch
// identity, so an ongoing construction or an import does not rebuild large model summaries just to walk ancestry.
export function rememberModelRevision(service, modelHash, model) {
  const header = headerOf(model);
  if (!header) return;
  remember(cacheFor(headerCache, service), modelHash, header);
  const ancestry = cacheFor(ancestryCache, service);
  const parent = header.previous ? ancestry.get(header.previous) : [];
  if (parent === undefined) return;
  const marker = branchMarkerOf(header);
  remember(ancestry, modelHash, marker ? [{ ...marker, forkModelHash: modelHash }, ...parent] : parent);
}
export async function revisionHeader(service, modelHash, model = null) {
  const cache = cacheFor(headerCache, service);
  if (cache.has(modelHash)) return cache.get(modelHash);
  const summary = model ? { id: model.id, revision: model.revision } : (await service.inspectModel({ modelHash }))?.summary ?? null;
  const header = headerOf(summary);
  if (header) remember(cache, modelHash, header);
  return header;
}

// A branch of a model (the forecasting add-on's futures) starts at a fork revision whose revision provenance carries this
// marker with what the branch assumes. Its descendants stay in the branch: a trunk view never follows into it, and a
// trunk graph is never rebound into it.
export const BRANCH_MARK = 'meaning-model-branch/v1';
export function branchMarkerOf(revision) {
  const entry = (revision?.provenance ?? []).find((item) => String(item).startsWith(`${BRANCH_MARK} `));
  if (!entry) return null;
  try { return JSON.parse(entry.slice(BRANCH_MARK.length + 1)); } catch { return null; }
}
export const isForkRevision = (model) => Boolean(branchMarkerOf(model?.revision));

// The branches a revision lies in, innermost first, read from revision summaries along its lineage; a trunk revision
// gives an empty list. stopAt ends the walk at an ancestor (exclusive), so the branches entered between two revisions
// can be found. With stopAt, reachedStopAt distinguishes reaching that ancestor from ending on another root.
// truncated says the walk ran out of links first.
// floor ends the walk below a revision number, where no fork of interest can lie.
export async function branchesAlong(service, modelHash, { stopAt = null, floor = null, model = null } = {}) {
  const found = [];
  let cursor = modelHash;
  const seen = new Set();
  const result = (truncated) => ({ branches: found, truncated, ...(stopAt === null ? {} : { reachedStopAt: cursor === stopAt }) });
  for (let links = 0; cursor && cursor !== stopAt; links += 1) {
    if (links > MAX_LINEAGE_LINKS || seen.has(cursor)) return result(true);
    seen.add(cursor);
    const header = await revisionHeader(service, cursor, cursor === modelHash ? model : null);
    if (!header) return result(true);
    if (floor !== null && (header?.number ?? -1) < floor) break;
    const marker = branchMarkerOf(header);
    if (marker) found.push({ ...marker, forkModelHash: cursor });
    cursor = header?.previous ?? null;
  }
  return result(false);
}

// A branch's own narrative graph is named future.<stage>.<branch>, and its first revision is bound to the branch's fork
// revision.
export const BRANCH_GRAPH_PREFIX = 'future.';

// Branch identity belongs to the model's immutable ancestry, not the presence or name of a graph in this store.
// A model-only host and a store with imported models must make the same decision. An incomplete bounded walk is
// reported, never interpreted as proof that the revision is a trunk.
export async function branchesOf(service, modelHash, { model = null } = {}) {
  const cache = cacheFor(ancestryCache, service);
  const pending = [], seen = new Set();
  let cursor = modelHash, inherited = null;
  // A cold store can have a longer lineage than a relative rebind's 255-link check. Read headers in bounded batches
  // up to the cache capacity, stopping at a verified cached prefix. Subsequent descendants reuse that prefix.
  while (cursor) {
    if (cache.has(cursor)) { inherited = cache.get(cursor); break; }
    if (pending.length >= MAX_HEADERS || seen.has(cursor)) return { branches: pending.flatMap(({ hash, marker }) => marker ? [{ ...marker, forkModelHash: hash }] : []), truncated: true };
    seen.add(cursor);
    const header = await revisionHeader(service, cursor, cursor === modelHash ? model : null);
    if (!header) return { branches: pending.flatMap(({ hash, marker }) => marker ? [{ ...marker, forkModelHash: hash }] : []), truncated: true };
    pending.push({ hash: cursor, marker: branchMarkerOf(header) });
    cursor = header.previous;
  }
  inherited ??= [];
  for (const entry of pending.reverse()) {
    if (entry.marker) inherited = [{ ...entry.marker, forkModelHash: entry.hash }, ...inherited];
    remember(cache, entry.hash, inherited);
  }
  return { branches: inherited, truncated: false };
}

// Source changes are exposed by both complete and delta graph revisions. Check them here as well as in the rebind
// convenience tool, so a graph cannot enter or leave a hypothetical fork through another authoring route. Ordinary
// trunk source changes and movement within the same branch are still allowed. Uncertain ancestry refuses the transition.
export async function assertBranchSourceTransition(service, previousSource, nextSource) {
  const previousHash = previousSource?.kind === 'model' ? previousSource.model_hash : null;
  const nextHash = nextSource?.kind === 'model' ? nextSource.model_hash : null;
  if (nextHash === previousHash) return;
  // A successor inherits every branch its predecessor belongs to. Only new forks on the short suffix can change
  // that membership; there is no need to rediscover the shared history on the first rebind after a restart.
  // If this bounded walk does not reach the old source, keep the full check for unrelated, backward or distant moves.
  if (previousHash && nextHash) {
    const transition = await branchesAlong(service, nextHash, { stopAt: previousHash });
    if (!transition.truncated && transition.reachedStopAt) {
      if (transition.branches.length) {
        const branch = transition.branches.at(-1);
        throw new Error(`Model ${nextHash.slice(0, 12)} lies in branch ${branch.branch} of stage ${branch.stageId}, forked at ${branch.forkModelHash.slice(0, 12)}. A branch is hypothetical and keeps its own graph; this graph stays on its own line.`);
      }
      return;
    }
  }
  const target = nextHash ? await branchesOf(service, nextHash) : { branches: [], truncated: false };
  if (target.truncated) throw new Error('The source model ancestry could not be checked completely; a graph source transition into a possible branch is refused. Use an explicitly opened graph on the intended line.');
  const current = previousHash ? await branchesOf(service, previousHash) : { branches: [], truncated: false };
  if (current.truncated) throw new Error('The current source model ancestry could not be checked completely; a graph source transition into a possible branch is refused.');
  const existing = new Set(current.branches.map((branch) => branch.forkModelHash));
  const entered = target.branches.filter((branch) => !existing.has(branch.forkModelHash));
  if (entered.length) {
    const branch = entered.at(-1);
    throw new Error(`Model ${nextHash.slice(0, 12)} lies in branch ${branch.branch} of stage ${branch.stageId}, forked at ${branch.forkModelHash.slice(0, 12)}. A branch is hypothetical and keeps its own graph; this graph stays on its own line.`);
  }
  const kept = new Set(target.branches.map((branch) => branch.forkModelHash));
  const left = current.branches.find((branch) => !kept.has(branch.forkModelHash));
  if (left) throw new Error(`This graph is bound to branch ${left.branch} of stage ${left.stageId}. It stays on its own line; changing its source would discard hypothetical branch status.`);
}

// The premise a branch assumes is an Event that carries this mark, bare, and once with what the branch is, so any
// revision of a branch says so by its own content.
export const PREMISE_MARK = 'meaning-model-branch-premise/v1';
export function premiseOf(event) {
  const entry = (event?.provenance ?? []).find((item) => String(item).startsWith(`${PREMISE_MARK} `));
  if (!entry) return null;
  try { return JSON.parse(entry.slice(PREMISE_MARK.length + 1)); } catch { return null; }
}
