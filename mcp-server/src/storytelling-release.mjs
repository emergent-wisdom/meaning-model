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
  releaseTo: z.array(id).max(8).describe('Reader scopes to add to the prose, such as ["reader"]; [] makes it readable by everyone. Required, so publishing to everyone is always explicit.'),
  clearHiddenText: z.boolean().default(false).describe('Clear the text of containers the render does not show (for example a passage later split into parts), which readers could otherwise read through a query. It stays in earlier revisions, which keep their scopes.'),
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
  // Readers get what the render shows: the passages it includes, and the containers on their way from the root
  // (scenes, chapters), since the render reaches a passage only through visible containers. Excluded passages,
  // canon and other records under the root stay as they are.
  const parent = new Map(); const pending = [input.storyRootId]; const reached = new Set([input.storyRootId]);
  while (pending.length) {
    const from = pending.shift();
    for (const edge of view.edges) if (edge.relation === 'contains' && edge.source?.kind === 'node' && edge.source.node_id === from && edge.target?.kind === 'node' && !reached.has(edge.target.node_id)) {
      reached.add(edge.target.node_id); parent.set(edge.target.node_id, from); pending.push(edge.target.node_id);
    }
  }
  const rendered = [...reached].filter((nodeId) => nodes.get(nodeId)?.role === 'story_passage' && nodes.get(nodeId)?.render !== 'exclude');
  if (!rendered.length) throw new Error(`No rendered prose under ${input.storyRootId}; commit a scene before releasing it.`);
  const released = new Set();
  for (const nodeId of rendered) for (let cursor = nodeId; cursor && cursor !== input.storyRootId; cursor = parent.get(cursor)) released.add(cursor);
  if (root.access_scopes?.length) released.add(root.id);
  // A container the render does not show can still hold text, such as a passage later split into parts.
  const hidden = [...released].filter((nodeId) => nodes.get(nodeId)?.render === 'exclude' && nodeId !== root.id && String(nodes.get(nodeId)?.text ?? '').trim());
  if (hidden.length && !input.clearHiddenText) {
    throw new Error(`Containers ${hidden.slice(0, 8).join(', ')}${hidden.length > 8 ? ', …' : ''} hold text the render does not show; readers could read it through a query. Pass clearHiddenText true to clear it in the released revision (earlier revisions keep it, with their scopes), or edit it first. Nothing was written.`);
  }
  // Widening never narrows: a record already readable by everyone (no scopes) stays so.
  const widen = (current) => (!current?.length ? current ?? [] : input.releaseTo.length ? [...new Set([...current, ...input.releaseTo])].sort() : []);
  const before = definitionFromCompleteView(view, 'Story release');
  const graph = structuredClone(before);
  const releasedNodeIds = []; const releasedEdgeIds = []; const clearedHiddenTextNodeIds = [];
  for (const node of graph.nodes) if (released.has(node.id)) {
    const next = widen(node.access_scopes);
    if (JSON.stringify(next) !== JSON.stringify([...(node.access_scopes ?? [])].sort())) { node.access_scopes = next; releasedNodeIds.push(node.id); }
    if (hidden.includes(node.id)) { node.text = ''; clearedHiddenTextNodeIds.push(node.id); }
  }
  const within = new Set([input.storyRootId, ...released]);
  for (const edge of graph.edges) if (edge.family === 'structural' && within.has(edge.source?.node_id) && within.has(edge.target?.node_id)) {
    const next = widen(edge.access_scopes);
    if (JSON.stringify(next) !== JSON.stringify([...(edge.access_scopes ?? [])].sort())) { edge.access_scopes = next; releasedEdgeIds.push(edge.id); }
  }
  if (!releasedNodeIds.length && !releasedEdgeIds.length) throw new Error('The prose is already readable with these scopes; nothing to release.');
  const prose = released;
  // The decision itself stays with the author, under the author's scope, linked to what it released.
  const scenes = [...prose].filter((nodeId) => nodes.get(nodeId)?.node_type === 'storytelling.scene');
  const record = await prepareAuthorRecord(service, { graphHash: input.graphHash, requestId: `${input.requestId}.record`, nodeId: input.nodeId,
    storyRootId: input.storyRootId, authorId: input.authorId, accessScopes: scopes, kind: 'decision', text: input.reason,
    data: { release: { storyRootId: input.storyRootId, releaseTo: input.releaseTo.length ? input.releaseTo : 'everyone', nodeIds: releasedNodeIds.sort(), edgeIds: releasedEdgeIds.sort(), clearedHiddenTextNodeIds: clearedHiddenTextNodeIds.sort() } },
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
    releaseTo: input.releaseTo, releasedNodeIds: releasedNodeIds.sort(), releasedEdgeIds: releasedEdgeIds.sort(), clearedHiddenTextNodeIds: clearedHiddenTextNodeIds.sort(), decisionNodeId: input.nodeId,
    graphMutation: true, worldMutation: false,
    nextStep: `Render with life_narrative_render and accessScopes ${JSON.stringify(input.releaseTo)} to read the story as a reader does. The dossier, drafts, reviews and author model keep their scopes; check that the prose itself reveals nothing the author meant to keep.` };
}
