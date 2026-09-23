// A narrative graph revision written as its change from the predecessor. The portable construction
// history stores revisions this way, and the service accepts one so that its idempotency receipt
// keeps only the change instead of a copy of the whole graph. Dependency-free: the service imports it.
import { stripEdgeForRevision, stripNodeForRevision } from './narrative-fields.mjs';

const DELTA_FIELDS = Object.freeze(['revision', 'source', 'roots', 'upsertNodes', 'removeNodeIds', 'upsertEdges', 'removeEdgeIds']);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const canonical = (value) => JSON.stringify(value, (_key, item) => (isRecord(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item));

// The complete predecessor as a definition that registration and revision accept. Refuses a view
// that hides any node, edge, root or node content, because a change applied to part of a graph would
// silently drop the rest.
export function definitionFromCompleteView(view, what = 'This operation') {
  if (!isRecord(view) || view.content_included !== true) throw new Error(`${what} needs a content-included read of the predecessor graph.`);
  for (const [field, count] of [['nodes', 'node_count'], ['edges', 'edge_count'], ['roots', 'root_count']]) {
    if (!Array.isArray(view[field]) || view[field].length !== view.graph?.[count]) {
      throw new Error(`${what} needs every node, edge and root of graph revision ${view.graph?.revision?.number}; these accessScopes hide some of them.`);
    }
  }
  if (view.nodes.some((node) => node.content_included === false || node.boundary === true)) throw new Error(`${what} needs the content of every node.`);
  const { number, reason, provenance, previous_graph_hash: previous } = view.graph.revision;
  return { schema: 'life-sim-rust-narrative-graph/v1', id: view.graph.id,
    revision: { number, reason, provenance, ...(previous ? { previous_graph_hash: previous } : {}) },
    source: view.graph.source, roots: [...view.roots], nodes: view.nodes.map(stripNodeForRevision), edges: view.edges.map(stripEdgeForRevision) };
}

// The change from one definition to the next: the successor's revision, its source and roots when
// they differ, the nodes and edges that are new or changed, and the ids of those removed.
export function narrativeDefinitionDelta(before, after) {
  const index = (list) => new Map(list.map((item) => [item.id, item]));
  const nodes = index(before.nodes); const edges = index(before.edges);
  const nextNodes = index(after.nodes); const nextEdges = index(after.edges);
  return {
    revision: after.revision,
    ...(canonical(before.source) === canonical(after.source) ? {} : { source: after.source }),
    ...(canonical(before.roots) === canonical(after.roots) ? {} : { roots: after.roots }),
    upsertNodes: after.nodes.filter((node) => !nodes.has(node.id) || canonical(nodes.get(node.id)) !== canonical(node)),
    removeNodeIds: before.nodes.filter((node) => !nextNodes.has(node.id)).map((node) => node.id),
    upsertEdges: after.edges.filter((edge) => !edges.has(edge.id) || canonical(edges.get(edge.id)) !== canonical(edge)),
    removeEdgeIds: before.edges.filter((edge) => !nextEdges.has(edge.id)).map((edge) => edge.id),
  };
}

export function validateNarrativeDelta(delta) {
  if (!isRecord(delta)) throw new Error('delta must be an object.');
  const unknown = Object.keys(delta).filter((key) => !DELTA_FIELDS.includes(key));
  if (unknown.length > 0) throw new Error(`delta has unknown field(s) ${unknown.join(', ')}; it takes ${DELTA_FIELDS.join(', ')}.`);
  const { revision } = delta;
  if (!isRecord(revision) || !Number.isSafeInteger(revision.number) || revision.number < 1) throw new Error('delta.revision.number must be a positive safe integer.');
  if (!nonblank(revision.reason)) throw new Error('delta.revision.reason must say why the graph changes.');
  if (!Array.isArray(revision.provenance) || revision.provenance.length === 0 || !revision.provenance.every(nonblank)) {
    throw new Error('delta.revision.provenance must name where the change comes from.');
  }
  if (delta.source !== undefined && !isRecord(delta.source)) throw new Error('delta.source must be an object when present.');
  if (delta.roots !== undefined && (!Array.isArray(delta.roots) || !delta.roots.every(nonblank))) throw new Error('delta.roots must list node ids when present.');
  for (const field of ['upsertNodes', 'upsertEdges']) {
    if (delta[field] !== undefined && (!Array.isArray(delta[field]) || !delta[field].every((record) => isRecord(record) && nonblank(record.id)))) {
      throw new Error(`delta.${field} must list records with ids.`);
    }
  }
  for (const field of ['removeNodeIds', 'removeEdgeIds']) {
    if (delta[field] !== undefined && (!Array.isArray(delta[field]) || !delta[field].every(nonblank))) throw new Error(`delta.${field} must list ids.`);
  }
}

// Apply a change strictly: a removal must name a record the predecessor has, and no record is named
// twice or both removed and replaced.
export function applyNarrativeDefinitionDelta(before, delta) {
  validateNarrativeDelta(delta);
  const apply = (label, list, removals, upserts) => {
    const records = new Map(list.map((record) => [record.id, record]));
    const named = new Set();
    for (const record of upserts) {
      if (named.has(record.id)) throw new Error(`The change names ${label} ${record.id} twice.`);
      named.add(record.id);
    }
    for (const recordId of removals) {
      if (named.has(recordId)) throw new Error(`The change both removes and replaces ${label} ${recordId}, or removes it twice.`);
      if (!records.has(recordId)) throw new Error(`The change removes ${label} ${recordId}, which the predecessor does not have.`);
      named.add(recordId);
      records.delete(recordId);
    }
    for (const record of upserts) records.set(record.id, record);
    return [...records.values()];
  };
  return { schema: before.schema, id: before.id, revision: delta.revision, source: delta.source ?? before.source, roots: delta.roots ?? before.roots,
    nodes: apply('node', before.nodes, delta.removeNodeIds ?? [], delta.upsertNodes ?? []),
    edges: apply('edge', before.edges, delta.removeEdgeIds ?? [], delta.upsertEdges ?? []) };
}

// A change that only adds nodes and edges (and appends roots that are among the new nodes), under the
// same source and the next revision number, is an additive batch; anything else returns null.
export function additiveNarrativeBatch(before, delta, previousGraphHash) {
  if ((delta.removeNodeIds ?? []).length > 0 || (delta.removeEdgeIds ?? []).length > 0) return null;
  if (delta.revision?.number !== before.revision.number + 1 || delta.revision?.previous_graph_hash !== previousGraphHash) return null;
  if (delta.source !== undefined && canonical(delta.source) !== canonical(before.source)) return null;
  const nodeIds = new Set(before.nodes.map((node) => node.id)); const edgeIds = new Set(before.edges.map((edge) => edge.id));
  const addNodes = delta.upsertNodes ?? []; const addEdges = delta.upsertEdges ?? [];
  if (addNodes.some((node) => nodeIds.has(node.id)) || addEdges.some((edge) => edgeIds.has(edge.id))) return null;
  let addRoots = [];
  if (delta.roots !== undefined) {
    if (delta.roots.length < before.roots.length || before.roots.some((root, index) => delta.roots[index] !== root)) return null;
    addRoots = delta.roots.slice(before.roots.length);
    const added = new Set(addNodes.map((node) => node.id));
    if (!addRoots.every((root) => added.has(root))) return null;
  }
  if (addNodes.length === 0 && addEdges.length === 0 && addRoots.length === 0) return null;
  return { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: previousGraphHash,
    reason: delta.revision.reason, provenance: delta.revision.provenance,
    ...(addRoots.length > 0 ? { add_roots: addRoots } : {}), add_nodes: addNodes, add_edges: addEdges };
}
