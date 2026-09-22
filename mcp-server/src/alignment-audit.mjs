// Read-only alignment audit of rendered narrative text against its records, per passage and whole.
// Questions are generated mechanically from the records; an optional estimator scores them.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { runEstimatorRequest } from './estimator-receipts.mjs';

const id = z.string().trim().min(1).max(1_024);
const hash = z.string().length(64);
export const FLAG_THRESHOLD = 0.5;
export const MAX_AUDIT_RECORDS = 60;
export const MAX_AUDIT_STATE_CHARS = 100_000;

export const alignmentAuditSchema = z.object({
  graphHash: hash,
  rootId: id,
  accessScopes: z.array(id).max(32).default([]),
  recordNodeIds: z.array(id).max(MAX_AUDIT_RECORDS).default([]),
  withheld: z.array(z.object({ nodeId: id, audience: z.enum(['viewpoint', 'reader']), viewpoint: z.string().trim().min(1).max(256).nullable().default(null) }).strict()).max(64).default([]),
  chunk: z.enum(['passage', 'whole', 'both']).default('both'),
  knowledgeStateNodeIds: z.array(id).max(MAX_AUDIT_RECORDS).default([]),
  record: z.object({ requestId: z.string().trim().min(1).max(256), nodeId: id, accessScopes: z.array(id).max(32).default([]) }).strict().nullable().default(null),
}).strict();

const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const words = (text) => text.split(/\s+/).filter(Boolean).length;

export function selectRecords(view, rendered, input) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const renderedIds = new Set(rendered.sequence); const rootIds = new Set(view.roots ?? []);
  let ids;
  if (input.recordNodeIds.length) {
    ids = input.recordNodeIds;
    for (const nodeId of ids) {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`Record node ${nodeId} is unknown or inaccessible in this graph.`);
      if (typeof node.text !== 'string' || !node.text.trim()) throw new Error(`Record node ${nodeId} has no visible text.`);
    }
  } else {
    ids = view.nodes.filter((node) => node.role === 'metadata' && typeof node.text === 'string' && node.text.trim() && !renderedIds.has(node.id) && !rootIds.has(node.id) && !String(node.node_type ?? '').startsWith('storytelling.') && node.node_type !== 'alignment_audit' && node.epistemic_status !== 'derived_diagnostic').map((node) => node.id).slice(0, MAX_AUDIT_RECORDS);
  }
  return ids.map((nodeId) => { const node = nodes.get(nodeId); return { id: nodeId, text: node.text, evidenceCutoff: node.evidence_cutoff ?? null, textHash: digest(node.text) }; });
}

export function buildAlignmentQuestions(records, withheld, viewpointLabel, knowledgeState = new Set()) {
  const questions = {};
  for (const record of records) {
    const label = `${record.id}${record.evidenceCutoff !== null && record.evidenceCutoff !== undefined ? ` (recorded as of time ${record.evidenceCutoff})` : ''}: ${record.text}`;
    questions[`narrates_${record.id}`] = { type: 'noul', instructions: `The passage narrates, or clearly presupposes as already having happened, this record: ${label}` };
    if (knowledgeState.has(record.id)) continue;
    questions[`contradicts_${record.id}`] = { type: 'noul', instructions: `The passage contradicts this record in some particular, such as who acted, what happened, when it happened, an amount, or the outcome. A proposal, hypothesis or reported speech inside the passage is not a contradiction of an outcome. Record: ${label}` };
  }
  for (const [index, item] of withheld.entries()) {
    questions[`leak_${index}`] = { type: 'noul', instructions: item.audience === 'viewpoint' ? `The passage depicts the viewpoint character${item.viewpoint ? ` (${item.viewpoint})` : ''} as knowing this, which they must not know yet: ${item.text}` : `The passage reveals this to the reader, which must stay withheld: ${item.text}` };
  }
  questions.unsupported_new_fact = { type: 'noul', instructions: 'The passage introduces a named person, place, organization, transaction, amount or dated event that none of the records mention. This holistic question is advisory only.' };
  return questions;
}

export function flagScores(scores, unitId, withheld = []) {
  const flags = { contradictions: [], leaks: [], notNarrated: [] };
  for (const [key, value] of Object.entries(scores)) {
    if (key.startsWith('contradicts_') && value >= FLAG_THRESHOLD) flags.contradictions.push({ recordId: key.slice(12), unitId, score: value });
    if (key.startsWith('leak_') && value >= FLAG_THRESHOLD) flags.leaks.push({ ...(withheld[Number(key.slice(5))] ? { nodeId: withheld[Number(key.slice(5))].nodeId, audience: withheld[Number(key.slice(5))].audience, viewpoint: withheld[Number(key.slice(5))].viewpoint ?? null } : { nodeId: key.slice(5) }), unitId, score: value });
    if (key.startsWith('narrates_') && value < FLAG_THRESHOLD) flags.notNarrated.push({ recordId: key.slice(9), unitId, score: value });
  }
  return flags;
}

export async function prepareAlignmentAudit(service, raw, estimator = null) {
  const input = alignmentAuditSchema.parse(raw);
  if (input.record && estimator) return runEstimatorRequest(service, 'alignment-audit-record', input.record.requestId, input, (checkpoint) => executeAlignmentAudit(service, input, estimator, checkpoint));
  return executeAlignmentAudit(service, input, estimator);
}

async function executeAlignmentAudit(service, input, estimator, checkpoint = null) {
  input.accessScopes = [...new Set(input.accessScopes)].sort();
  const rendered = await service.renderNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, rootIds: [input.rootId], accessScopes: input.accessScopes });
  if (rendered.graph_hash !== input.graphHash) throw new Error('Alignment audit must render the exact requested graph revision.');
  hash.parse(rendered.source_snapshot_hash); hash.parse(rendered.projection_hash);
  if (typeof rendered.text !== 'string' || !rendered.text.trim()) throw new Error('Selected unit has no visible rendered prose to audit.');
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: input.accessScopes });
  if (view.graph_hash !== input.graphHash || !view.content_included || view.source_snapshot_hash !== rendered.source_snapshot_hash) throw new Error('Alignment audit must read the exact rendered graph and source.');
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const units = rendered.sequence.map((nodeId) => nodes.get(nodeId)).filter((node) => node && typeof node.text === 'string' && node.text.trim() && node.role !== 'document_root').map((node) => ({ id: node.id, text: node.text, textHash: digest(node.text), words: words(node.text) }));
  if (!units.length) throw new Error('No prose units are visible under the selected root.');
  const records = selectRecords(view, rendered, input);
  if (!records.length) throw new Error('No records to audit against; supply recordNodeIds or add visible metadata records to the graph.');
  const withheld = input.withheld.map((item) => { const node = nodes.get(item.nodeId); if (!node || typeof node.text !== 'string') throw new Error(`Withheld node ${item.nodeId} is unknown, inaccessible or has no text.`); return { ...item, text: node.text }; });
  const viewpointLabel = null;
  const knowledgeState = new Set(input.knowledgeStateNodeIds);
  for (const nodeId of knowledgeState) if (!records.some((record) => record.id === nodeId)) throw new Error(`knowledgeStateNodeIds entry ${nodeId} is not among the audited records.`);
  const questions = buildAlignmentQuestions(records, withheld, viewpointLabel, knowledgeState);
  if (input.record) {
    if (nodes.has(input.record.nodeId)) throw new Error(`Audit record ${input.record.nodeId} already exists; use a new node ID.`);
    if (!Number.isSafeInteger(view.graph?.revision?.number) || view.graph.revision.number < 0) throw new Error('Recording requires a safe graph-revision clock.');
    input.record.accessScopes = auditOutputScopes(view, input, [...rendered.sequence, ...records.map((record) => record.id), ...withheld.map((item) => item.nodeId)]);
  }
  const recordsText = records.map((record) => `${record.id}: ${record.text}`);
  const chunks = [...(input.chunk !== 'passage' ? [{ id: 'whole', kind: 'whole', text: rendered.text }] : []), ...(input.chunk !== 'whole' ? units.map((unit) => ({ ...unit, kind: 'passage' })) : [])];
  for (const chunk of chunks) {
    const size = JSON.stringify({ records: recordsText, passage_under_review: chunk.text }).length + JSON.stringify(questions).length;
    if (size > MAX_AUDIT_STATE_CHARS) throw new Error(`Audit state for ${chunk.id} is ${size} characters; the limit is ${MAX_AUDIT_STATE_CHARS}. Select fewer records or audit a smaller unit.`);
  }
  const base = { schema: 'meaning-model-narrative-alignment-audit/v1', graphHash: input.graphHash, sourceSnapshotHash: rendered.source_snapshot_hash, projectionHash: rendered.projection_hash, rootId: input.rootId, accessScopes: input.accessScopes, units: units.map(({ id: unitId, textHash, words: count }) => ({ id: unitId, textHash, words: count })), records: records.map(({ id: recordId, textHash, evidenceCutoff }) => ({ id: recordId, textHash, evidenceCutoff })), withheld: input.withheld, questionCount: Object.keys(questions).length, chunk: input.chunk, knowledgeStateNodeIds: input.knowledgeStateNodeIds, threshold: FLAG_THRESHOLD, guidance: 'Passage-level contradiction and leak scores are the actionable signal; whole-unit scores arbitrate proposals, hypotheticals and reported speech, which score high at passage scope. Records phrased as transient knowledge states belong in withheld leak checks, not contradiction checks. Nothing here verifies meaning or literary quality.', semanticVerification: false, advisoryOnly: true, worldMutation: false, graphMutation: false };
  if (!estimator) {
    return { ...base, evaluator: 'calling_llm', questions, chunks: chunks.map((chunk) => ({ id: chunk.id, text: chunk.text })), recordsText, results: null, instructions: 'No external estimator is configured (MEANING_MODEL_ESTIMATOR unset). Answer each question for each chunk yourself with a 0 to 1 truth value, then record flagged contradictions, leaks and omissions as an Understanding Node with exact citations.' };
  }
  const results = { whole: null, passages: [], flags: { contradictions: [], leaks: [], notNarrated: [] }, usage: { input_tokens: 0, output_tokens: 0 } }; let model = estimator.model;
  for (const chunk of chunks) {
    const result = checkpoint?.get(`chunk:${chunk.kind}:${chunk.id}`) ?? await estimator.estimate({ records: recordsText, passage_under_review: chunk.text }, questions);
    validatedAuditScores(result.answers, questions, chunk.id);
    checkpoint?.set(`chunk:${chunk.kind}:${chunk.id}`, result);
    model = result.model ?? model;
    results.usage.input_tokens += Number(result.usage?.input_tokens ?? 0); results.usage.output_tokens += Number(result.usage?.output_tokens ?? 0);
    const scores = validatedAuditScores(result.answers, questions, chunk.id);
    const flags = flagScores(scores, chunk.id, withheld);
    if (chunk.kind === 'whole') { results.whole = { scores, flags }; results.flags.notNarrated = flags.notNarrated; }
    else { results.passages.push({ id: chunk.id, scores, flags }); results.flags.contradictions.push(...flags.contradictions); results.flags.leaks.push(...flags.leaks); }
  }
  if (input.chunk === 'whole' && results.whole) { results.flags.contradictions = results.whole.flags.contradictions; results.flags.leaks = results.whole.flags.leaks; }
  const evaluator = `${estimator.backend}:${model}`;
  let recorded = null;
  if (input.record) recorded = await recordAuditFindings(service, view, input, { ...base, evaluator, results });
  // With record, the successor graph is the current graph for later writes (as for every other write tool);
  // the audited revision stays addressable as auditedGraphHash.
  return { ...base, auditedGraphHash: input.graphHash, graphHash: recorded?.graphHash ?? input.graphHash, evaluator, results, recorded, graphMutation: Boolean(recorded), nextStep: 'Store the flagged findings with exact citations as an Understanding Node linked about the audited unit; resolve each by revising the prose, revising the record with justification, or recording a declared ambiguity. Do not treat a passing audit as verification.' };
}

export function documentRootOf(view, nodeId) {
  const roots = new Set(view.roots ?? []);
  const parents = new Map();
  for (const edge of view.edges) if (edge.relation === 'contains' && edge.source?.kind === 'node' && edge.target?.kind === 'node') parents.set(edge.target.node_id, edge.source.node_id);
  let cursor = nodeId;
  for (let step = 0; step < 4_096 && cursor; step += 1) { if (roots.has(cursor)) return cursor; cursor = parents.get(cursor) ?? null; }
  throw new Error(`No document root contains ${nodeId} through visible contains edges.`);
}

export function validatedAuditScores(answers, questions, unitId) {
  const expected = Object.keys(questions);
  if (!answers || Array.isArray(answers) || Object.keys(answers).length !== expected.length || expected.some((key) => !Object.hasOwn(answers, key))) {
    throw new Error(`Estimator must return exactly the requested audit answers for ${unitId}.`);
  }
  return Object.fromEntries(expected.map((key) => {
    const answer = answers[key];
    if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new Error(`Estimator returned an invalid truth value for ${unitId}/${key}; expected noul in [0,1].`);
    }
    return [key, answer.noul];
  }));
}

// Scopes are alternative audiences, so a derived record needs their intersection,
// including structural placement constraints. A caller's read scopes are not its audience.
export function auditOutputScopes(view, input, dependencyIds) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const included = new Set([...dependencyIds, input.rootId, documentRootOf(view, input.rootId)]);
  const dependencies = [];
  const seenEdges = new Set();
  const pending = [...included];
  for (let index = 0; index < pending.length; index++) {
    const node = nodes.get(pending[index]);
    if (!node) throw new Error('Audit dependency is unknown or inaccessible.');
    dependencies.push(node);
    for (const edge of view.edges) {
      if (edge.family !== 'structural' || edge.target?.kind !== 'node' || edge.target.node_id !== node.id) continue;
      if (!seenEdges.has(edge.id)) { dependencies.push(edge); seenEdges.add(edge.id); }
      if (edge.source?.kind === 'node' && !included.has(edge.source.node_id)) { included.add(edge.source.node_id); pending.push(edge.source.node_id); }
    }
  }
  const restricted = dependencies.map((record) => record.access_scopes ?? []).filter((scopes) => scopes.length);
  const allowed = restricted.length ? [...new Set(restricted[0])].filter((scope) => restricted.every((scopes) => scopes.includes(scope))) : null;
  if (allowed && !allowed.length) throw new Error('Audit cannot represent disjoint evidence audiences without widening access.');
  const requested = input.record.accessScopes;
  if (allowed && requested.some((scope) => !allowed.includes(scope))) throw new Error('Audit output scopes would widen evidence access.');
  return [...new Set(requested.length ? requested : allowed ?? input.accessScopes)].sort();
}

export async function recordAuditFindings(service, view, input, audit) {
  const rootId = documentRootOf(view, input.rootId);
  if (view.nodes.some((node) => node.id === input.record.nodeId)) throw new Error(`Audit record ${input.record.nodeId} already exists; use a new node ID.`);
  const step = view.graph?.revision?.number;
  if (!Number.isSafeInteger(step) || step < 0) throw new Error('Recording requires a safe graph-revision clock.');
  const scopes = [...new Set(input.record.accessScopes.length ? input.record.accessScopes : input.accessScopes)].sort();
  const provenance = ['Meaning Model narrative alignment audit v1', `evaluator:${audit.evaluator}`, 'Derived diagnostic scores, not authored testimony and not verification.'];
  const payload = { schema: 'meaning-model-narrative-alignment-audit-record/v1', graphHash: audit.graphHash, sourceSnapshotHash: audit.sourceSnapshotHash, projectionHash: audit.projectionHash, rootId: input.rootId, evaluator: audit.evaluator, threshold: audit.threshold, units: audit.units, records: audit.records, withheld: audit.withheld, knowledgeStateNodeIds: input.knowledgeStateNodeIds, flags: audit.results.flags, whole: audit.results.whole?.scores ?? null, passages: audit.results.passages.map((passage) => ({ id: passage.id, scores: passage.scores })), usage: audit.results.usage };
  const common = { authority: { source: audit.evaluator, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: scopes, render: 'exclude', training: 'exclude', provenance };
  const node = { ...common, id: input.record.nodeId, node_type: 'alignment_audit', role: 'metadata', text: JSON.stringify(payload), epistemic_status: 'derived_diagnostic', evidence_type: 'estimate', holder: audit.evaluator, subject: input.rootId, value_time: step };
  const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
  const edges = [
    { id: `${input.record.nodeId}.placement`, source: endpoint(rootId), target: endpoint(input.record.nodeId), family: 'structural', relation: 'contains', order: 1_000_000 + step, access_scopes: scopes, provenance },
    { id: `${input.record.nodeId}.about`, source: endpoint(input.record.nodeId), target: endpoint(input.rootId), family: 'semantic', relation: 'about', access_scopes: scopes, provenance },
  ];
  const stored = await service.applyNarrativeBatch({ requestId: input.record.requestId, previousGraphHash: input.graphHash, narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash, reason: `Record alignment audit ${input.record.nodeId} for ${input.rootId}.`, provenance, add_roots: [], add_nodes: [node], add_edges: edges } });
  return { nodeId: input.record.nodeId, documentRootId: rootId, graphHash: stored.graphHash ?? null, stored };
}
