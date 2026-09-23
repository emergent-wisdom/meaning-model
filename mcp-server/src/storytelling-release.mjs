// Releasing a story's prose to readers. Committed prose inherits the author-only scope of the records it was
// built from, so a reader's render shows only the title. A release is the author's explicit, recorded decision
// to let readers see the prose: it widens the scopes of the prose nodes and their structural edges only, and
// never those of the dossier, drafts, reviews or author model.
import * as z from 'zod/v4';
import { definitionFromCompleteView, narrativeDefinitionDelta } from './narrative-delta.mjs';
import { assertCompleteNarrativeView } from './narrative-rebind.mjs';
import { prepareAuthorRecord } from './storytelling-authoring.mjs';

const id = z.string().trim().min(1).max(256);
export const storyReleaseSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u), requestId: id, nodeId: id,
  storyRootId: id, authorId: id,
  accessScopes: z.array(id).min(1).max(64).describe('Scopes that reveal the whole graph, as for any revision by change.'),
  releaseTo: z.array(id).max(8).default([]).describe('Reader scopes to add to the prose, such as ["reader"]; empty makes it readable without a scope.'),
  reason: z.string().trim().min(1).max(4_000),
}).strict();

export async function releaseStory(service, raw) {
  const input = storyReleaseSchema.parse(raw);
  const scopes = [...new Set(input.accessScopes)].sort();
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  assertCompleteNarrativeView(view, input.graphHash);
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const root = nodes.get(input.storyRootId);
  if (!root || root.role !== 'document_root') throw new Error(`${input.storyRootId} is not a story document root in this graph.`);
  // The prose: story passages reached from the root through contains edges, and only through prose.
  const prose = new Set(); const pending = [input.storyRootId];
  while (pending.length) {
    const parent = pending.shift();
    for (const edge of view.edges) if (edge.relation === 'contains' && edge.source?.kind === 'node' && edge.source.node_id === parent && edge.target?.kind === 'node') {
      const child = nodes.get(edge.target.node_id);
      if (child?.role === 'story_passage' && !prose.has(child.id)) { prose.add(child.id); pending.push(child.id); }
    }
  }
  if (!prose.size) throw new Error(`No committed prose under ${input.storyRootId}; commit a scene before releasing it.`);
  const released = new Set([...prose, ...(root.access_scopes?.length ? [root.id] : [])]);
  const widen = (current) => (input.releaseTo.length ? [...new Set([...(current ?? []), ...input.releaseTo])].sort() : []);
  const before = definitionFromCompleteView(view, 'Story release');
  const graph = structuredClone(before);
  const releasedNodeIds = []; const releasedEdgeIds = [];
  for (const node of graph.nodes) if (released.has(node.id)) {
    const next = widen(node.access_scopes);
    if (JSON.stringify(next) !== JSON.stringify([...(node.access_scopes ?? [])].sort())) { node.access_scopes = next; releasedNodeIds.push(node.id); }
  }
  const within = new Set([input.storyRootId, ...prose]);
  for (const edge of graph.edges) if (edge.family === 'structural' && within.has(edge.source?.node_id) && within.has(edge.target?.node_id)) {
    const next = widen(edge.access_scopes);
    if (JSON.stringify(next) !== JSON.stringify([...(edge.access_scopes ?? [])].sort())) { edge.access_scopes = next; releasedEdgeIds.push(edge.id); }
  }
  if (!releasedNodeIds.length && !releasedEdgeIds.length) throw new Error('The prose is already readable with these scopes; nothing to release.');
  // The decision itself stays with the author, under the author's scope, linked to what it released.
  const scenes = [...prose].filter((nodeId) => nodes.get(nodeId)?.node_type === 'storytelling.scene');
  const record = await prepareAuthorRecord(service, { graphHash: input.graphHash, requestId: `${input.requestId}.record`, nodeId: input.nodeId,
    storyRootId: input.storyRootId, authorId: input.authorId, accessScopes: scopes, kind: 'decision', text: input.reason,
    data: { release: { storyRootId: input.storyRootId, releaseTo: input.releaseTo.length ? input.releaseTo : 'everyone', nodeIds: releasedNodeIds.sort(), edgeIds: releasedEdgeIds.sort() } },
    links: scenes.slice(0, 64).map((nodeId) => ({ relation: 'about', targetNodeId: nodeId })) });
  graph.roots = [...graph.roots, ...record.narrativeBatch.add_roots];
  graph.nodes.push(...record.narrativeBatch.add_nodes);
  graph.edges.push(...record.narrativeBatch.add_edges);
  graph.revision = { number: before.revision.number + 1, previous_graph_hash: input.graphHash,
    reason: `Release the prose of ${input.storyRootId} to ${input.releaseTo.length ? input.releaseTo.join(', ') : 'every reader'}: ${input.reason}`,
    provenance: ['Meaning Model storytelling add-on v1', `release:${input.authorId}`] };
  const stored = await service.reviseNarrativeGraphByDelta({ requestId: input.requestId, previousGraphHash: input.graphHash,
    delta: narrativeDefinitionDelta(before, graph), accessScopes: scopes, preserveSourceSnapshot: true });
  return { ...stored, schema: 'meaning-model-story-release/v1', previousGraphHash: input.graphHash, storyRootId: input.storyRootId,
    releaseTo: input.releaseTo, releasedNodeIds: releasedNodeIds.sort(), releasedEdgeIds: releasedEdgeIds.sort(), decisionNodeId: input.nodeId,
    graphMutation: true, worldMutation: false,
    nextStep: `Render with life_narrative_render and accessScopes ${JSON.stringify(input.releaseTo)} to read the story as a reader does. The dossier, drafts, reviews and author model keep their scopes; check that the prose itself reveals nothing the author meant to keep.` };
}
