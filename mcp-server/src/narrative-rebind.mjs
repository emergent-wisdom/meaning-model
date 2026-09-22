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

export function buildRebindSuccessor(view, { graphHash, modelHash, reason, provenance }) {
  if (view.graph_hash !== graphHash) throw new Error('Rebind must read the exact requested graph revision.');
  if (!view.content_included) throw new Error('Rebind requires a content-included full graph read.');
  if (view.returned_node_count !== view.total_node_count || view.returned_edge_count !== view.total_edge_count) {
    throw new Error(`Rebind requires the complete graph: ${view.returned_node_count}/${view.total_node_count} nodes and ${view.returned_edge_count}/${view.total_edge_count} edges are visible with the supplied scopes.`);
  }
  const source = view.graph?.source;
  if (source?.kind !== 'model') throw new Error(`Rebind supports model-bound graphs only; this graph is bound to a ${source?.kind ?? 'missing'} source.`);
  const dropped = view.edges.filter((edge) => edge.target?.kind === 'anchor' && edge.target?.anchor_kind === 'model' && edge.target?.anchor_id !== modelHash).map((edge) => edge.id);
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
  const { successor, droppedModelAnchorEdgeIds, previousModelHash } = buildRebindSuccessor(view, { graphHash: input.graphHash, modelHash: input.modelHash, reason: input.reason, provenance });
  if (previousModelHash === input.modelHash) throw new Error('The graph is already bound to this model.');
  const lineageSteps = await assertModelSuccessor(service, previousModelHash, input.modelHash);
  const stored = await service.reviseNarrativeGraph({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeGraph: successor });
  return { ...stored, schema: 'meaning-model-narrative-rebind/v1', previousGraphHash: input.graphHash, previousModelHash, modelHash: input.modelHash, lineageSteps, droppedModelAnchorEdgeIds, retainedNodeCount: successor.nodes.length, historicalAssessmentsRetained: true, worldMutation: false, nextStep: 'Historical depth and review nodes remain but their predecessor-model anchors were removed; record fresh assessments against the successor model before committing further prose.' };
}
