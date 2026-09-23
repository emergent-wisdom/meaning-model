// Rebind a model-bound narrative graph to a successor model as one complete immutable
// revision: keep every node, drop only edges anchored to predecessor model hashes.
import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(1_024);
const hash = z.string().length(64);
import { stripEdgeForRevision, stripNodeForRevision } from './narrative-fields.mjs';
export { NODE_FIELDS, EDGE_FIELDS, stripNodeForRevision, stripEdgeForRevision } from './narrative-fields.mjs';
const MAX_LINEAGE_STEPS = 256;

export const narrativeRebindSchema = z.object({
  requestId: z.string().trim().min(1).max(256),
  graphHash: hash,
  modelHash: hash,
  accessScopes: z.array(id).max(32).default([]),
  reason: z.string().trim().min(1).max(4_000).default('Rebind the narrative graph to a successor model revision.'),
}).strict();

export async function assertModelSuccessor(service, previousModelHash, modelHash) {
  let cursor = modelHash;
  for (let step = 0; step < MAX_LINEAGE_STEPS && cursor; step += 1) {
    if (cursor === previousModelHash) return step;
    const inspected = await service.inspectModel({ modelHash: cursor });
    cursor = inspected?.summary?.revision?.previous_model_hash ?? null;
  }
  throw new Error(`Model ${modelHash} is not a successor of the graph's bound model ${previousModelHash}; rebinding to an unrelated model is refused.`);
}

export function assertCompleteNarrativeView(view, graphHash) {
  if (view.graph_hash !== graphHash || view.content_included !== true) throw new Error('The exact content-included graph revision is required.');
  for (const [field, count] of [['nodes', 'node_count'], ['edges', 'edge_count'], ['roots', 'root_count']]) {
    if (!Array.isArray(view[field]) || !Number.isSafeInteger(view.graph?.[count]) || view[field].length !== view.graph[count]) {
      throw new Error('Rebind and ingest require the complete graph; include every existing node, edge, and root in accessScopes.');
    }
  }
  if ((view.returned_node_count !== undefined && view.returned_node_count !== view.nodes.length)
    || (view.returned_edge_count !== undefined && view.returned_edge_count !== view.edges.length)) throw new Error('Rebind requires the complete graph, not a truncated projection.');
  if (!Number.isSafeInteger(view.graph?.revision?.number) || view.graph.revision.number < 0 || view.graph.revision.number >= Number.MAX_SAFE_INTEGER) throw new Error('The graph requires an exact safe revision clock.');
  if (view.nodes.some((node) => node.content_included === false || node.boundary === true)) throw new Error('The complete graph requires all node content.');
}

// Validate the immutable predecessor before a compound operation writes its model.
export async function preflightNarrativeRebind(service, { graphHash, modelHash, accessScopes }) {
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(accessScopes)].sort() });
  buildRebindSuccessor(view, { graphHash, modelHash, reason: 'Preflight only.', provenance: [] });
  await assertModelSuccessor(service, view.graph.source.model_hash, modelHash);
  return view;
}

export function buildRebindSuccessor(view, { graphHash, modelHash, modelId = null, reason, provenance }) {
  if (view.graph_hash !== graphHash) throw new Error('Rebind must read the exact requested graph revision.');
  if (!view.content_included) throw new Error('Rebind requires a content-included full graph read.');
  assertCompleteNarrativeView(view, graphHash);
  const source = view.graph?.source;
  if (source?.kind !== 'model') throw new Error(`Rebind supports model-bound graphs only; this graph is bound to a ${source?.kind ?? 'missing'} source.`);
  // A model anchor may name the model by hash or by its stable id; only anchors to a predecessor hash are dropped.
  const dropped = view.edges.filter((edge) => edge.target?.kind === 'anchor' && edge.target?.anchor_kind === 'model'
    && edge.target?.anchor_id !== modelHash && (modelId === null || edge.target?.anchor_id !== modelId)).map((edge) => edge.id);
  const droppedSet = new Set(dropped);
  const successor = {
    schema: 'life-sim-rust-narrative-graph/v1',
    id: view.graph.id,
    revision: { number: view.graph.revision.number + 1, previous_graph_hash: graphHash, reason, provenance },
    source: { kind: 'model', model_hash: modelHash },
    roots: view.roots,
    nodes: view.nodes.map(stripNodeForRevision),
    edges: view.edges.filter((edge) => !droppedSet.has(edge.id)).map(stripEdgeForRevision),
  };
  return { successor, droppedModelAnchorEdgeIds: dropped, previousModelHash: source.model_hash };
}

export async function rebindNarrativeGraph(service, raw) {
  const input = narrativeRebindSchema.parse(raw);
  const accessScopes = [...new Set(input.accessScopes)].sort();
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes });
  const provenance = ['Meaning Model narrative rebind v1', `rebind:${input.graphHash.slice(0, 12)}->model:${input.modelHash.slice(0, 12)}`];
  const successorModel = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
  const modelId = typeof successorModel?.model?.id === 'string' ? successorModel.model.id : null;
  const { successor, droppedModelAnchorEdgeIds, previousModelHash } = buildRebindSuccessor(view, { graphHash: input.graphHash, modelHash: input.modelHash, modelId, reason: input.reason, provenance });
  if (previousModelHash === input.modelHash) throw new Error('The graph is already bound to this model.');
  const lineageSteps = await assertModelSuccessor(service, previousModelHash, input.modelHash);
  const stored = await service.reviseNarrativeGraph({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeGraph: successor });
  return { ...stored, schema: 'meaning-model-narrative-rebind/v1', previousGraphHash: input.graphHash, previousModelHash, modelHash: input.modelHash, lineageSteps, droppedModelAnchorEdgeIds, retainedNodeCount: successor.nodes.length, historicalAssessmentsRetained: true, worldMutation: false, nextStep: 'Historical depth and review nodes remain but their predecessor-model anchors were removed; record fresh assessments against the successor model before committing further prose.' };
}
