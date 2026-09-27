import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { definitionFromCompleteView, narrativeDefinitionDelta } from './narrative-delta.mjs';
import { declarePassageGrounding, isEventRenderEdge, passageGrounding, passageTextHash } from './narrative-grounding.mjs';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const groundingProposalSchema = z.object({
  graphHash: hash,
  accessScopes: z.array(id).max(64).default([]),
  nodeIds: z.array(id).min(1).max(200).optional().describe('Select existing rendered passages. Omit to propose for every unlinked passage, up to 200; larger sets require explicit batches.'),
  candidatesPerPassage: z.number().int().min(1).max(30).default(8),
}).strict();
export const groundingApplySchema = z.object({
  preparation: groundingProposalSchema,
  expectedProposalHash: hash,
  requestId: id,
  author: id.describe('The calling agent that reviewed and now confirms or corrects the proposed links.'),
  reason: z.string().trim().min(10).max(4_000),
  decisions: z.array(z.object({
    nodeId: id,
    renders: z.array(id).max(200).optional().describe('The exact selected Event IDs, after checking the prose. May correct or replace all suggested candidates.'),
    noLinkReason: z.string().trim().min(10).max(4_000).optional(),
  }).strict()).min(1).max(200),
}).strict();
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const unique = (values, label) => { if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`); };
const words = (text) => new Set((String(text).toLocaleLowerCase('en').match(/[\p{L}\p{N}]{3,}/gu) ?? []));
const bounded = (value) => { if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw new Error('Grounding proposal exceeds 4 MiB; select fewer passages or candidates. No evidence was silently truncated.'); };

function inheritedEvents(graph, nodeId) {
  const parents = new Map(); const links = new Map();
  for (const edge of graph.edges) {
    if (isEventRenderEdge(edge)) {
      const list = links.get(edge.source.node_id) ?? []; list.push(edge.target.anchor_id); links.set(edge.source.node_id, list);
    }
    if (edge.family === 'structural' && edge.relation === 'contains' && edge.source?.kind === 'node' && edge.target?.kind === 'node') {
      const list = parents.get(edge.target.node_id) ?? []; list.push(edge.source.node_id); parents.set(edge.target.node_id, list);
    }
  }
  const found = new Map(); const visited = new Set([nodeId]); const queue = [...(parents.get(nodeId) ?? [])];
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]; if (visited.has(parent)) continue; visited.add(parent);
    for (const eventId of links.get(parent) ?? []) {
      const sources = found.get(eventId) ?? []; sources.push(parent); found.set(eventId, sources);
    }
    queue.push(...(parents.get(parent) ?? []));
  }
  return found;
}

export async function proposeNarrativeGrounding(service, raw) {
  bounded(raw);
  const input = groundingProposalSchema.parse(raw);
  input.accessScopes = [...new Set(input.accessScopes)].sort();
  if (input.nodeIds) { unique(input.nodeIds, 'Selected passage IDs'); input.nodeIds.sort(); }
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash,
    mode: 'full', includeContent: true, accessScopes: input.accessScopes });
  const graph = definitionFromCompleteView(view, 'Grounding proposal');
  const modelHash = view.graph.source?.model_hash ?? view.graph.source_snapshot?.model_hash;
  if (!modelHash) throw new Error('Grounding proposal requires a graph bound to a model.');
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const events = [...(model.meaning_model?.events ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const records = passageGrounding(graph);
  const selected = input.nodeIds ? records.filter((item) => input.nodeIds.includes(item.nodeId))
    : records.filter((item) => !item.eventIds.length && !item.noLink);
  if (input.nodeIds && selected.length !== input.nodeIds.length) throw new Error('Every selected node must be a visible rendered prose passage (not a heading-only root or Understanding Node).');
  if (selected.length > 200) throw new Error(`${selected.length} unlinked passages need review; select explicit nodeIds in batches of at most 200. Nothing was truncated or written.`);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  // Inverse document frequency reduces ubiquitous words without a domain-specific
  // vocabulary. Ranking is candidate retrieval, explicitly not semantic judgment.
  const tokens = new Map(events.map((event) => [event.id, words(`${event.boundary ?? ''}\n${event.description ?? ''}`)]));
  const frequency = new Map();
  for (const set of tokens.values()) for (const word of set) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const passages = selected.map((record) => {
    const node = nodes.get(record.nodeId); const terms = words(node.text);
    const inherited = inheritedEvents(graph, node.id);
    const ranked = events.map((event) => {
      const matchedTerms = [...tokens.get(event.id)].filter((word) => terms.has(word)).sort();
      const score = matchedTerms.reduce((sum, word) => sum + Math.log(1 + events.length / frequency.get(word)), 0);
      return { event, score, matchedTerms, sourceNodeIds: inherited.get(event.id) ?? [] };
    }).sort((a, b) => Number(b.sourceNodeIds.length > 0) - Number(a.sourceNodeIds.length > 0) || b.score - a.score || a.event.id.localeCompare(b.event.id));
    const candidates = ranked.slice(0, input.candidatesPerPassage).map(({ event, score, matchedTerms, sourceNodeIds }) => ({
      eventId: event.id, event: structuredClone(event), eventHash: digest(event),
      basis: sourceNodeIds.length ? 'existing_ancestor_renders_declaration' : 'lexical_candidate_retrieval',
      sourceNodeIds, matchedTerms, retrievalScore: score,
    }));
    const proposedEventIds = candidates.filter((item) => item.sourceNodeIds.length || item.retrievalScore > 0).slice(0, 3).map((item) => item.eventId);
    return { nodeId: node.id, text: node.text, textHash: passageTextHash(node.text),
      existingEventIds: record.eventIds, existingNoLink: record.noLink,
      proposedEventIds, status: 'unconfirmed_candidate_proposal', candidates,
      candidateUniverseCount: events.length, omittedCandidateCount: Math.max(0, events.length - candidates.length),
      inheritedEventIdsOutsideReturnedCandidates: [...inherited.keys()].filter((eventId) => eventById.has(eventId) && !candidates.some((item) => item.eventId === eventId)),
    };
  });
  const proposal = { schema: 'meaning-model-narrative-grounding-proposal/v1', preparation: input,
    graphHash: input.graphHash, modelHash, sourceSnapshotHash: view.source_snapshot_hash,
    candidateUniverseHash: digest(events), candidateUniverseCount: events.length,
    totalUnlinkedPassages: records.filter((item) => !item.eventIds.length && !item.noLink).length,
    passages, evaluator: 'calling_llm', semanticVerification: false, graphMutation: false, worldMutation: false,
    instructions: 'These are unconfirmed retrieval candidates, not semantic truth. Read each exact passage and native Event. Prioritize existing declared scene associations where appropriate, correct overbroad or wrong suggestions, and call life_narrative_grounding_apply with one explicit decision for every returned passage. Any existing Event ID may be selected, not only ranked candidates. A passage depicting no Event needs its own substantive noLinkReason. No proposal changes the graph or requires an external estimator key.' };
  bounded(proposal);
  return { ...proposal, proposalHash: digest(proposal) };
}

export async function applyNarrativeGrounding(service, raw) {
  bounded(raw);
  const input = groundingApplySchema.parse(raw);
  const proposal = await proposeNarrativeGrounding(service, input.preparation);
  if (proposal.proposalHash !== input.expectedProposalHash) throw new Error('Grounding proposal is stale or differs from the exact graph, model, passages or candidate universe. Propose again before applying.');
  const prior = service.narrativeRevisionReceipt?.(input.requestId);
  if (!prior) {
    const listing = await service.listNarrativeRevisions({});
    const revision = listing.revisions?.find((item) => item.graph_hash === input.preparation.graphHash);
    if (!revision?.is_head) throw new Error('Grounding proposal graph is no longer a current head. Read the intended current branch and propose again; links were not written to stale prose.');
  }
  unique(input.decisions.map((item) => item.nodeId), 'Grounding decision passage IDs');
  const required = new Set(proposal.passages.map((item) => item.nodeId));
  if (input.decisions.length !== required.size || input.decisions.some((item) => !required.has(item.nodeId))) throw new Error('Supply exactly one confirm/correct decision for every passage in this proposal.');
  const view = await service.queryNarrativeGraph({ graphHash: input.preparation.graphHash, expectedGraphHash: input.preparation.graphHash,
    mode: 'full', includeContent: true, accessScopes: input.preparation.accessScopes });
  const before = definitionFromCompleteView(view, 'Grounding application'); const after = structuredClone(before);
  const { model } = await service.inspectModel({ modelHash: proposal.modelHash, includeDefinition: true });
  const validEventIds = new Set((model.meaning_model?.events ?? []).map((event) => event.id));
  const decisionHash = digest({ author: input.author, decisions: input.decisions, proposalHash: proposal.proposalHash });
  for (const [index, decision] of input.decisions.entries()) {
    if (decision.renders === undefined && decision.noLinkReason === undefined) throw new Error(`Passage ${decision.nodeId} needs explicit selected renders or noLinkReason; proposals are never automatically accepted.`);
    for (const eventId of decision.renders ?? []) if (!validEventIds.has(eventId)) throw new Error(`Unknown Event in bound model: ${eventId}.`);
    const node = after.nodes.find((item) => item.id === decision.nodeId);
    declarePassageGrounding(after, node, decision, { author: input.author,
      edgeId: (edgeIndex) => `grounding.${decisionHash.slice(0, 24)}.${index}.${edgeIndex}`,
      provenance: [`Grounding declared by calling agent ${input.author}`, `proposal:${proposal.proposalHash}`, `passage-text:${passageTextHash(node.text)}`, input.reason] });
  }
  after.revision = { number: before.revision.number + 1, previous_graph_hash: input.preparation.graphHash,
    reason: input.reason, provenance: [`Grounding declared by calling agent ${input.author}`, `proposal:${proposal.proposalHash}`] };
  const stored = await service.reviseNarrativeGraphByDelta({ requestId: input.requestId, previousGraphHash: input.preparation.graphHash,
    delta: narrativeDefinitionDelta(before, after), accessScopes: input.preparation.accessScopes, preserveSourceSnapshot: true });
  return { ...stored, schema: 'meaning-model-narrative-grounding-applied/v1', proposalHash: proposal.proposalHash,
    author: input.author, decisions: input.decisions, graphMutation: true, worldMutation: false, semanticVerification: false };
}

export function registerNarrativeGroundingTools(server, service, { toolResult }) {
  server.registerTool('life_narrative_grounding_propose', { description: 'In one read-only call, propose Event links for existing unlinked rendered passages. Returns exact prose, native candidate Events, existing ancestor associations, explicit lexical-retrieval basis, omissions and source fingerprints. All unlinked passages are included by default, up to 200. No writes or external model keys; the calling agent must review and confirm or correct every selection.',
    inputSchema: groundingProposalSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  async (input) => toolResult(await proposeNarrativeGrounding(service, input)));
  server.registerTool('life_narrative_grounding_apply', { description: 'Confirm or correct a grounding proposal as the calling agent. Supply exact Event selections or a per-passage noLinkReason for every proposed passage. Atomically writes canonical grounding/renders Event edges or text-bound explicit reasons, preserving prose and model. Rejects stale graph heads, changed source fingerprints and incomplete decisions; never accepts suggestions automatically.',
    inputSchema: groundingApplySchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  async (input) => toolResult(await applyNarrativeGrounding(service, input)));
}
