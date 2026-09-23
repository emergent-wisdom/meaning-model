import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { narrativeDefinitionDelta } from './narrative-delta.mjs';

const id = z.string().trim().min(1).max(256);
const text = z.string().max(1_048_576);
const title = z.string().max(2_000).optional();
export const narrativeEditSchema = z.object({
  requestId: id,
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u),
  accessScopes: z.array(id).max(64).default([]),
  reason: z.string().trim().min(1).max(4_000),
  operations: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('split'), nodeId: id,
      parts: z.array(z.object({ id, text, title }).strict()).min(2).max(100) }).strict(),
    z.object({ kind: z.literal('merge'), nodeIds: z.array(id).min(2).max(100), mergedNodeId: id, title }).strict(),
    z.object({ kind: z.literal('move'), nodeId: id, parentNodeId: id,
      index: z.number().int().min(0).max(50_000) }).strict(),
    z.object({ kind: z.literal('reorder'), parentNodeId: id, nodeIds: z.array(id).min(1).max(50_000) }).strict(),
    z.object({ kind: z.literal('replace_text'), nodeId: id, expectedText: text, text }).strict(),
  ])).min(1).max(100),
}).strict();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
const sourceId = (edge) => edge.source?.kind === 'node' ? edge.source.node_id : null;
const targetId = (edge) => edge.target?.kind === 'node' ? edge.target.node_id : null;
const unique = (values, label) => { if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`); };
const bounded = (value) => { if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) throw new Error('Narrative edit exceeds 8 MiB.'); };

// Reconstruct only a proven complete, content-bearing projection. The Rust graph
// remains authoritative; this helper keeps no graph or receipt store of its own.
function completeDefinition(view, graphHash) {
  if (view.graph_hash !== graphHash || view.mode !== 'full' || view.content_included !== true) {
    throw new Error('Narrative editing requires the exact full graph with content.');
  }
  for (const [field, count] of [['nodes', 'node_count'], ['edges', 'edge_count'], ['roots', 'root_count']]) {
    if (!Array.isArray(view[field]) || !Number.isSafeInteger(view.graph?.[count])
      || view[field].length !== view.graph[count]) {
      throw new Error('Narrative editing refuses an incomplete scoped view; include every existing node, edge, and root.');
    }
  }
  const nodes = view.nodes.map((projected) => {
    if (projected.content_included !== true || projected.boundary === true
      || (projected.text !== null && typeof projected.text !== 'string')) {
      throw new Error('Narrative editing requires complete node content, not boundary or skeleton records.');
    }
    const { content_included, boundary, ...node } = projected;
    return structuredClone(node);
  });
  const revision = view.graph.revision;
  if (view.edges.some((edge) => edge.order != null && (!Number.isSafeInteger(edge.order) || edge.order < 0))) {
    throw new Error('Narrative edge orders must be exact safe integers before editing.');
  }
  if (!Number.isSafeInteger(revision?.number) || revision.number < 0 || revision.number >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Narrative revision number must allow an exact safe successor.');
  }
  return { schema: view.graph.schema, id: view.graph.id, revision: structuredClone(revision),
    source: structuredClone(view.graph.source), roots: [...view.roots], nodes, edges: structuredClone(view.edges) };
}

export async function editNarrativeGraph(service, raw) {
  bounded(raw);
  const input = narrativeEditSchema.parse(raw);
  input.accessScopes = [...new Set(input.accessScopes)].sort();
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash,
    mode: 'full', includeContent: true, accessScopes: input.accessScopes });
  const graph = completeDefinition(view, input.graphHash);
  const before = structuredClone(graph);
  const requestHash = digest(input);
  const marker = `life_narrative_edit/v1 request:${requestHash}`;
  let serial = 0;
  const affected = new Set();
  const node = (nodeId) => {
    const value = graph.nodes.find((item) => item.id === nodeId);
    if (!value) throw new Error(`Unknown narrative node: ${nodeId}.`);
    return value;
  };
  const fresh = (nodeId) => { if (graph.nodes.some((item) => item.id === nodeId)) throw new Error(`Narrative node ID already exists: ${nodeId}.`); };
  const children = (parentId) => graph.edges.filter((edge) => edge.relation === 'contains' && sourceId(edge) === parentId)
    .sort((a, b) => a.order - b.order);
  const parents = (nodeId) => graph.edges.filter((edge) => edge.relation === 'contains' && targetId(edge) === nodeId);
  const mark = (...ids) => ids.forEach((nodeId) => affected.add(nodeId));
  const provenance = (...records) => [...new Set([...records.flatMap((record) => record.provenance ?? []), marker])];
  const touch = (record) => { record.provenance = provenance(record); };
  const addEdge = (from, to, family, relation, accessScopes, order) => {
    const edgeId = `narrative.edit.${requestHash.slice(0, 24)}.${serial++}`;
    if (graph.edges.some((edge) => edge.id === edgeId)) throw new Error('Generated narrative edge ID collides with existing history.');
    const edge = { id: edgeId, source: endpoint(from), target: endpoint(to), family, relation,
      access_scopes: [...accessScopes], provenance: [marker], ...(order === undefined ? {} : { order }) };
    graph.edges.push(edge);
    return edge;
  };
  const renumber = (edges) => edges.forEach((edge, index) => { if (edge.order !== index) { edge.order = index; touch(edge); } });
  const singleParent = (nodeId) => {
    const edges = parents(nodeId);
    if (graph.roots.includes(nodeId) || edges.length !== 1) throw new Error(`Node ${nodeId} must have one contains parent and cannot be a declared root.`);
    return edges[0];
  };
  const noParentNext = (parentId) => {
    if (graph.edges.some((edge) => edge.relation === 'next' && sourceId(edge) === parentId)) {
      throw new Error(`Parent ${parentId} has next edges; its contains/next traversal is ambiguous for this edit.`);
    }
  };
  const noIncidentNext = (ids) => {
    if (graph.edges.some((edge) => edge.relation === 'next' && (ids.has(sourceId(edge)) || ids.has(targetId(edge))))) {
      throw new Error('This edit refuses incident next edges; revise the explicit sequence before regrouping or reordering it.');
    }
  };
  const compatible = (record) => {
    const { id, text, title, summary, provenance, ...metadata } = record;
    return digest(metadata);
  };
  const placementMetadata = (record) => {
    const { id, source, target, order, provenance, ...metadata } = record;
    return metadata;
  };
  const sharedScopes = (records) => {
    const restricted = records.map((record) => record.access_scopes ?? []).filter((values) => values.length);
    if (!restricted.length) return [];
    const intersection = [...new Set(restricted[0])].filter((scope) => restricted.every((values) => values.includes(scope))).sort();
    if (!intersection.length) throw new Error('Merge cannot represent disjoint node and placement audiences without widening access.');
    return intersection;
  };
  const subtreeIds = (nodeId) => {
    const ids = new Set([nodeId]);
    const pending = [nodeId];
    for (let index = 0; index < pending.length; index++) for (const edge of children(pending[index])) {
      const childId = targetId(edge);
      if (parents(childId).length !== 1 || graph.roots.includes(childId)) throw new Error('Structural edit refuses shared or separately rooted descendants.');
      if (!ids.has(childId)) { ids.add(childId); pending.push(childId); }
    }
    return ids;
  };
  const noCrossingNext = (ids) => {
    if (graph.edges.some((edge) => edge.relation === 'next' && ids.has(sourceId(edge)) !== ids.has(targetId(edge)))) {
      throw new Error('Structural edit refuses next edges crossing the subtree boundary.');
    }
  };

  for (const operation of input.operations) {
    if (operation.kind === 'replace_text') {
      const current = node(operation.nodeId);
      if (typeof current.text !== 'string') throw new Error('Text replacement requires a node containing text.');
      if (current.text !== operation.expectedText) throw new Error(`Text changed for ${current.id}; read the exact predecessor before replacing it.`);
      current.text = operation.text;
      touch(current);
      mark(current.id);
    } else if (operation.kind === 'split') {
      const current = node(operation.nodeId);
      if (children(current.id).length) throw new Error('Split requires a leaf node; it cannot replace existing children.');
      if (typeof current.text !== 'string' || operation.parts.some((part) => !part.text.length)) {
        throw new Error('Split requires text and nonempty parts so rendering preserves exact prose.');
      }
      unique(operation.parts.map((part) => part.id), 'Split child IDs');
      operation.parts.forEach((part) => fresh(part.id));
      if (operation.parts.map((part) => part.text).join('\n\n') !== current.text) {
        throw new Error('Split parts must preserve the exact original text when joined by one blank line.');
      }
      const original = structuredClone(current);
      current.render = 'exclude';
      current.training = 'exclude';
      touch(current);
      for (const [index, part] of operation.parts.entries()) {
        graph.nodes.push({ ...structuredClone(original), id: part.id, text: part.text,
          title: part.title ?? null, summary: null, provenance: provenance(original) });
        addEdge(current.id, part.id, 'structural', 'contains', original.access_scopes, index);
        addEdge(part.id, current.id, 'revision', 'split_from', original.access_scopes);
        mark(part.id);
      }
      // contains takes precedence over next in the native renderer. Carry the
      // original continuation from the last new leaf, retaining edge identities.
      for (const edge of graph.edges) if (edge.relation === 'next' && sourceId(edge) === current.id) {
        edge.source = endpoint(operation.parts.at(-1).id);
        touch(edge);
      }
      mark(current.id);
    } else if (operation.kind === 'merge') {
      unique(operation.nodeIds, 'Merged node IDs');
      fresh(operation.mergedNodeId);
      const originals = operation.nodeIds.map(node);
      if (originals.some((item) => children(item.id).length)) throw new Error('Merge requires leaf nodes.');
      if (originals.some((item) => typeof item.text !== 'string' || !item.text.length)) throw new Error('Merge requires nonempty textual leaf nodes.');
      const placements = operation.nodeIds.map(singleParent);
      const parentId = sourceId(placements[0]);
      if (placements.some((edge) => sourceId(edge) !== parentId)) throw new Error('Merge requires siblings under one parent.');
      noParentNext(parentId);
      noIncidentNext(new Set(operation.nodeIds));
      const ordered = children(parentId);
      const start = ordered.findIndex((edge) => targetId(edge) === operation.nodeIds[0]);
      if (operation.nodeIds.some((nodeId, index) => targetId(ordered[start + index] ?? {}) !== nodeId)) {
        throw new Error('Merge requires consecutive siblings in their current order.');
      }
      if (originals.some((item) => compatible(item) !== compatible(originals[0]))) {
        throw new Error('Merge requires compatible roles, scopes, authority, timing, evidence, and render/training policies.');
      }
      if (placements.some((item) => digest(placementMetadata(item)) !== digest(placementMetadata(placements[0])))) {
        throw new Error('Merge requires matching placement scopes and metadata; it cannot broaden existing edge access.');
      }
      graph.nodes.push({ ...structuredClone(originals[0]), id: operation.mergedNodeId,
        text: originals.map((item) => item.text).join('\n\n'), title: operation.title ?? null, summary: null,
        access_scopes: sharedScopes([...originals, ...placements, node(parentId)]), provenance: provenance(...originals) });
      const removedIds = new Set(placements.map((edge) => edge.id));
      graph.edges = graph.edges.filter((edge) => !removedIds.has(edge.id));
      const placement = addEdge(parentId, operation.mergedNodeId, 'structural', 'contains', originals[0].access_scopes, start);
      Object.assign(placement, structuredClone(placementMetadata(placements[0])), { provenance: provenance(...placements) });
      renumber([...ordered.slice(0, start), placement, ...ordered.slice(start + originals.length)]);
      originals.forEach((original) => {
        original.render = 'exclude';
        original.training = 'exclude';
        touch(original);
        addEdge(operation.mergedNodeId, original.id, 'revision', 'merged_from', original.access_scopes);
      });
      mark(parentId, operation.mergedNodeId, ...operation.nodeIds);
    } else if (operation.kind === 'reorder') {
      node(operation.parentNodeId);
      unique(operation.nodeIds, 'Reordered child IDs');
      const ordered = children(operation.parentNodeId);
      if (ordered.length !== operation.nodeIds.length || ordered.some((edge) => !operation.nodeIds.includes(targetId(edge)))) {
        throw new Error('Reorder must list every immediate contains child exactly once.');
      }
      noParentNext(operation.parentNodeId);
      operation.nodeIds.forEach(singleParent);
      noIncidentNext(new Set(operation.nodeIds));
      operation.nodeIds.forEach((nodeId) => noCrossingNext(subtreeIds(nodeId)));
      renumber(operation.nodeIds.map((nodeId) => ordered.find((edge) => targetId(edge) === nodeId)));
      mark(operation.parentNodeId, ...operation.nodeIds);
    } else if (operation.kind === 'move') {
      node(operation.nodeId);
      node(operation.parentNodeId);
      const placement = singleParent(operation.nodeId);
      const oldParentId = sourceId(placement);
      noParentNext(oldParentId);
      noParentNext(operation.parentNodeId);
      const subtree = subtreeIds(operation.nodeId);
      if (subtree.has(operation.parentNodeId)) throw new Error('Move cannot place a node inside its own subtree.');
      noCrossingNext(subtree);
      const targetChildren = children(operation.parentNodeId).filter((edge) => edge.id !== placement.id);
      for (const edge of targetChildren) {
        const childId = targetId(edge);
        singleParent(childId);
        noCrossingNext(subtreeIds(childId));
      }
      if (operation.index > targetChildren.length) throw new Error('Move index is outside the destination child list.');
      placement.source = endpoint(operation.parentNodeId);
      touch(placement);
      targetChildren.splice(operation.index, 0, placement);
      renumber(targetChildren);
      if (oldParentId !== operation.parentNodeId) renumber(children(oldParentId));
      mark(oldParentId, operation.parentNodeId, ...subtree);
    }
  }

  const changedIds = (oldRecords, records) => {
    const old = new Map(oldRecords.map((record) => [record.id, digest(record)]));
    const next = new Map(records.map((record) => [record.id, digest(record)]));
    return [...new Set([...old.keys(), ...next.keys()])].filter((key) => old.get(key) !== next.get(key)).sort();
  };
  const changedNodeIds = changedIds(before.nodes, graph.nodes);
  const changedEdgeIds = changedIds(before.edges, graph.edges);
  if (!changedNodeIds.length && !changedEdgeIds.length) throw new Error('Narrative edit makes no changes.');
  const reviewTargets = new Set(affected);
  for (const current of [before, graph]) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const edge of current.edges) if (edge.relation === 'contains' && reviewTargets.has(targetId(edge))) {
        const parentId = sourceId(edge);
        if (parentId && !reviewTargets.has(parentId)) { reviewTargets.add(parentId); expanded = true; }
      }
    }
  }
  const reviewIds = new Set(); const directReviewIds = new Set();
  for (const current of [before, graph]) for (const edge of current.edges) {
    const from = sourceId(edge);
    const to = targetId(edge);
    const isDocumentRoot = (nodeId) => current.nodes.some((item) => item.id === nodeId && item.role === 'document_root');
    if (reviewTargets.has(from) && ['reviewed_by', 'reviewed_against'].includes(edge.relation) && to) { reviewIds.add(to); if (affected.has(from) && !isDocumentRoot(from)) directReviewIds.add(to); }
    // A review linked about a whole document root (every authoring record is) needs only the lighter
    // ancestor check when that root changes, for example when its title is edited.
    if (reviewTargets.has(to) && edge.relation === 'about'
      && current.nodes.some((item) => item.id === from && item.role === 'externalized_reflection')) {
      reviewIds.add(from);
      if (affected.has(to) && !isDocumentRoot(to)) directReviewIds.add(from);
    }
  }
  graph.revision = { number: before.revision.number + 1, previous_graph_hash: input.graphHash,
    reason: input.reason, provenance: [marker] };
  bounded(graph);
  // Stored as its change, so the receipt keeps no copy of the whole graph.
  const stored = await service.reviseNarrativeGraphByDelta({ requestId: input.requestId, previousGraphHash: input.graphHash,
    delta: narrativeDefinitionDelta(before, graph), accessScopes: input.accessScopes, preserveSourceSnapshot: true });
  if (stored.snapshotHash !== view.source_snapshot_hash) throw new Error('Narrative edit did not preserve its frozen source snapshot.');
  return { ...stored, operation: 'edit-narrative-graph', requestHash,
    changedNodeIds, changedEdgeIds, affectedNodeIds: [...affected].sort(),
    affectedReviewNodeIds: [...reviewIds].sort(),
    directlyAffectedReviewNodeIds: [...directReviewIds].sort(),
    ancestorReviewNodeIds: [...reviewIds].filter((reviewId) => !directReviewIds.has(reviewId)).sort(),
    reviewRefresh: 'Reassess affected prose, disclosure timing, and linked reviews against this successor. Existing review nodes are historical evidence; this edit does not renew their approval. Refresh any model-depth assessment whose selected evidence changed.',
    preservedPredecessor: true, worldMutation: false, semanticVerification: false,
    semanticLinkReassignment: false };
}
