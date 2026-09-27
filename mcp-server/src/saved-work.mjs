// Discover persisted graph heads through the same scope projection used for
// ordinary graph reads. Native history metadata alone is not permission to list a work.
import * as z from 'zod/v4';

export const savedWorkSchema = z.object({
  graphId: z.string().trim().min(1).max(1_024).optional().describe('Optional exact graph ID; omit to discover saved graph-backed work.'),
  accessScopes: z.array(z.string().trim().min(1).max(1_024)).max(64).default([]),
  offset: z.number().int().min(0).max(10_000).default(0),
  limit: z.number().int().min(1).max(25).default(10),
}).strict();

export async function listSavedWork(service, raw = {}) {
  const input = savedWorkSchema.parse(raw);
  const accessScopes = [...new Set(input.accessScopes)].sort();
  const persistenceMode = service.backend?.status?.().persistenceMode ?? 'unknown';
  const persistence = { mode: persistenceMode,
    durableGraphRecords: persistenceMode === 'unknown' ? null : persistenceMode === 'optional-single-writer-state-file',
    warning: persistenceMode === 'process-memory'
      ? 'These records exist only in the current process and disappear on restart. Configure LIFE_SIM_STATE_FILE for durable work, or export the construction before closing this process.'
      : persistenceMode === 'unknown'
        ? 'Persistence could not be determined; call life_engine_status before relying on a restart.'
        : 'The engine state file retains model and graph revisions. MCP request receipts and other process-local controls are not all recovered.' };
  const listing = await service.listNarrativeRevisions({ graphId: input.graphId ?? null });
  const headHashes = new Set(listing.heads ?? []);
  const candidates = (listing.revisions ?? []).filter((revision) => headHashes.has(revision.graph_hash))
    .sort((a, b) => b.operation_sequence - a.operation_sequence);
  const heads = []; let visible = 0, hasMore = false;
  for (const revision of candidates) {
    const view = await service.queryNarrativeGraph({ graphHash: revision.graph_hash, expectedGraphHash: revision.graph_hash,
      mode: 'skeleton', includeContent: false, accessScopes });
    if (view.graph_hash !== revision.graph_hash) throw new Error('Saved-work discovery requires an exact graph projection.');
    if (!(view.visible_node_count > 0)) continue;
    if (visible++ < input.offset) continue;
    if (heads.length === input.limit) { hasMore = true; break; }
    // Never copy the native graph summary: it contains unprojected counts,
    // revision reasons and provenance. Titles and roots come only from the projection.
    const roots = (view.roots ?? []).map((node) => ({ nodeId: node.id, role: node.role,
      ...(typeof node.title === 'string' && node.title.trim() ? { title: node.title.slice(0, 300) } : {}) }));
    const document = roots.find((node) => node.role === 'document_root') ?? roots.find((node) => node.title);
    const graphHash = view.graph_hash;
    const sourceKind = view.graph?.source?.kind ?? view.graph?.source_snapshot?.source_kind ?? null;
    heads.push({ graphId: revision.graph_id, graphHash, revision: revision.revision_number,
      modelHash: view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null, sourceKind,
      title: document?.title ?? revision.graph_id, titleSource: document?.title ? 'visible_root_title' : 'graph_id',
      roots: roots.slice(0, 8), rootsTruncated: roots.length > 8,
      visibleNodeCount: view.visible_node_count, visibleEdgeCount: view.visible_edge_count,
      replay: { tool: 'life_construction_replay', arguments: { graphHash, accessScopes, level: 'outline' } },
      ...(sourceKind === 'model' ? { viewer: { tool: 'life_model_viewer_open', arguments: { graphHash, accessScopes } } } : {}),
    });
  }
  return { schema: 'meaning-model-saved-work/v1', persistence, heads, window: { offset: input.offset, limit: input.limit, nextOffset: hasMore ? input.offset + heads.length : null },
    selection: 'Each row is an immutable branch head, not an automatically accepted latest version. Finish paging before choosing a graphHash. Refresh this listing if work changes while paging.',
    visibility: 'Only heads with records visible under the supplied accessScopes are listed. An empty page does not establish that this engine has no stored work. Counts and root titles describe that projection; they do not establish access to the complete author view.',
    scope: 'Graph-backed work in this engine only. Models without a narrative/understanding graph are not enumerated. Persistence depends on the configured engine state file.',
    nextStep: 'Choose the intended branch, replay its construction, then read life_model_outline before continuing. The viewer additionally requires complete scope access to the model and graph history.' };
}

export function registerSavedWorkTools(server, service, { toolResult }) {
  server.registerTool('life_saved_work_list', {
    description: 'Discover saved graph-backed work in this engine without already knowing a hash. List immutable heads through the supplied accessScopes, including every visible alternative branch rather than choosing a latest version. Page through results, select an exact graphHash, then use life_construction_replay and life_model_outline before resuming. Includes visible root titles and replay/viewer calls; omits completely hidden work and private revision reasons. Models without a graph are outside this catalog. Check life_engine_status for persistence configuration.',
    inputSchema: savedWorkSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await listSavedWork(service, input)));
}
