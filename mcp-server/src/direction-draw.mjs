// Seeded draws over a model's normalized Cut, recorded so that a second draw is visible as a reroll.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { documentRootOf } from './alignment-audit.mjs';

const ALGORITHM = 'sha256-first-32-bits/v1';
const hash64 = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);

export const directionDrawSchema = z.object({
  modelHash: hash64,
  cutId: z.string().min(1).max(1_024),
  seed: z.string().min(1).max(256),
  record: z.object({
    graphHash: hash64,
    requestId: id,
    nodeId: id,
    rootId: z.string().min(1).max(1_024),
    accessScopes: z.array(z.string().min(1).max(256)).min(1).max(64),
    reason: z.string().min(1).max(4_000).nullable().default(null),
  }).strict().nullable().default(null),
}).strict();

// u is the first 32 bits of SHA-256(seed) as an unsigned integer, divided by 2^32.
export function drawUniform(seed) {
  return createHash('sha256').update(seed, 'utf8').digest().readUInt32BE(0) / 2 ** 32;
}

export function drawFromAnswers(answers, u) {
  let upper = 0;
  const cumulative = answers.map(({ key, weight }) => {
    const from = upper; upper += weight;
    return { key, weight, from, to: upper };
  });
  // Answers are taken in the registered model's order (the engine sorts a Cut's answers by key);
  // the last interval absorbs floating-point shortfall.
  const hit = cumulative.find((interval) => u < interval.to) ?? cumulative[cumulative.length - 1];
  return { cumulative, realized: hit.key };
}

function parseDraw(node) {
  if (node.node_type !== 'direction_draw') return null;
  try { return JSON.parse(node.text); } catch { return null; }
}

export async function drawDirection(service, raw) {
  const input = directionDrawSchema.parse(raw);
  const inspected = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
  if (!inspected?.model || inspected.modelHash !== input.modelHash) throw new Error('Direction draws require the exact registered model.');
  const cut = (inspected.model.meaning_model?.normalized_cuts ?? []).find((item) => item.id === input.cutId);
  if (!cut) throw new Error(`Unknown normalized Cut ${input.cutId} in model ${input.modelHash.slice(0, 12)}.`);
  if (cut.withdrawn) throw new Error(`Cut ${cut.id} was withdrawn (${cut.withdrawn.reason}); draw from a current Cut${(cut.withdrawn.superseded_by ?? []).length ? ` such as ${cut.withdrawn.superseded_by.join(', ')}` : ''}.`);
  const u = drawUniform(input.seed);
  const { cumulative, realized } = drawFromAnswers(cut.answers, u);
  const draw = { schema: 'meaning-model-direction-draw/v1', modelHash: input.modelHash, cutId: cut.id,
    parentEventId: cut.parent_event_id, question: cut.question, unit: cut.unit,
    answers: cut.answers.map(({ key, weight }) => ({ key, weight })), seed: input.seed, algorithm: ALGORITHM, u,
    cumulative, realized, realizedIsRemainder: realized === 'remainder' };
  let recorded = null, priorDraws = [];
  if (input.record) {
    const view = await service.queryNarrativeGraph({ graphHash: input.record.graphHash, expectedGraphHash: input.record.graphHash,
      mode: 'full', includeContent: true, accessScopes: input.record.accessScopes });
    const source = view.graph?.source;
    if (source?.kind !== 'model' || source.model_hash !== input.modelHash) {
      throw new Error('Record a draw only in a graph bound to the drawn model; rebind the graph first or draw against its bound model.');
    }
    if (view.nodes.some((node) => node.id === input.record.nodeId)) throw new Error(`Draw record ${input.record.nodeId} already exists; use a new node ID.`);
    // Earlier draws over the same Cut in this graph lineage make this one a reroll, never a silent replacement.
    priorDraws = view.nodes.map((node) => ({ node, data: parseDraw(node) }))
      .filter(({ data }) => data?.cutId === cut.id && data?.parentEventId === cut.parent_event_id)
      .map(({ node, data }) => ({ nodeId: node.id, seed: data.seed, realized: data.realized, modelHash: data.modelHash }));
    const step = view.graph?.revision?.number;
    if (!Number.isSafeInteger(step) || step < 0) throw new Error('Recording requires a safe graph-revision clock.');
    const rootId = documentRootOf(view, input.record.rootId);
    const scopes = [...new Set(input.record.accessScopes)].sort();
    const provenance = ['Meaning Model direction draw v1', `algorithm:${ALGORITHM}`, 'Computed by the server from the recorded seed and the model\'s Cut weights; a construction decision, not an observation.'];
    const payload = { ...draw, drawIndex: priorDraws.length, reroll: priorDraws.length > 0, priorDraws, reason: input.record.reason };
    const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
    const node = { id: input.record.nodeId, node_type: 'direction_draw', role: 'metadata', text: JSON.stringify(payload),
      epistemic_status: 'construction_decision', evidence_type: 'creative_hypothesis', holder: 'meaning-model-server', subject: cut.parent_event_id,
      value_time: step, authority: { source: 'meaning-model-server', weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: scopes,
      render: 'exclude', training: 'exclude', provenance };
    const edges = [
      { id: `${input.record.nodeId}.placement`, source: endpoint(rootId), target: endpoint(input.record.nodeId), family: 'structural', relation: 'contains', order: 2_000_000 + step, access_scopes: scopes, provenance },
      { id: `${input.record.nodeId}.cut`, source: endpoint(input.record.nodeId), target: { kind: 'anchor', anchor_kind: 'event', anchor_id: cut.parent_event_id }, family: 'grounding', relation: 'draws_from', access_scopes: scopes, provenance },
      ...priorDraws.map((prior) => ({ id: `${input.record.nodeId}.rerolls.${prior.nodeId}`, source: endpoint(input.record.nodeId), target: endpoint(prior.nodeId), family: 'revision', relation: 'rerolls', access_scopes: scopes, provenance })),
    ];
    const stored = await service.applyNarrativeBatch({ requestId: input.record.requestId, previousGraphHash: input.record.graphHash,
      narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.record.graphHash,
        reason: `Record direction draw ${input.record.nodeId} over ${cut.id}.`, provenance, add_roots: [], add_nodes: [node], add_edges: edges } });
    recorded = { nodeId: input.record.nodeId, documentRootId: rootId, graphHash: stored.graphHash ?? null, stored };
  }
  return { ...draw, drawIndex: priorDraws.length, reroll: priorDraws.length > 0, priorDraws, recorded,
    graphHash: recorded?.graphHash ?? input.record?.graphHash ?? null, previousGraphHash: input.record?.graphHash ?? null,
    graphMutation: Boolean(recorded), worldMutation: false,
    nextStep: draw.realizedIsRemainder
      ? `The remainder was drawn: model a new admissible continuation under its meaning and link its Event from ${cut.parent_event_id} with a realizes_forecast relation naming this Cut and the remainder. Do not renormalize the named answers or draw again to avoid it; a further draw is recorded as a reroll.`
      : `Build ${realized} as the realized continuation and link its Event from ${cut.parent_event_id} with a realizes_forecast relation naming this Cut and ${realized}. A further draw over this Cut is recorded as a reroll.` };
}
