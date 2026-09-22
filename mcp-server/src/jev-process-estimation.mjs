// Typed provider judgments enter the ordinary estimation review exchange. Recording a
// reviewed estimate in the graph is separate from changing the accepted Rust world.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { canonicalEstimationJson, estimationOperations, validateProcessValue } from './estimation-exchange.mjs';
import { MAX_ESTIMATOR_REQUEST_CHARS } from './estimator-config.mjs';
import { runEstimatorRequest } from './estimator-receipts.mjs';

const id = z.string().trim().min(1).max(256);
const text = z.string().trim().min(1).max(4_000);
const probability = z.number().min(0).max(1);
export const jevProcessQuestionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), instructions: text, criteria: z.record(id, text), minimumConfidence: probability.default(0) }).strict(),
  z.object({ type: z.literal('score'), instructions: text, unit: id, levels: z.array(z.object({ description: text, value: z.number() }).strict()).min(2).max(10), minimumConfidence: probability.default(0) }).strict(),
  z.object({ type: z.literal('noul'), instructions: text, interpretation: z.literal('truth_probability') }).strict(),
]);
export const jevProcessEstimationSchema = z.object({
  requestId: id,
  worldId: id,
  operation: z.enum(estimationOperations).default('estimate'),
  intent: z.enum(['reality', 'creative']).default('reality'),
  evidenceCutoff: z.number(),
  accessScopes: z.array(id).max(32).default([]),
  context: z.string().max(20_000).default(''),
  contextAccessScopes: z.array(id).max(32).default([]),
  provenance: z.array(text).min(1).max(32),
  coordinates: z.array(z.object({
    id, processId: id, targetTime: z.number().optional(), question: jevProcessQuestionSchema.optional(),
    disposition: z.enum(['unknown', 'unmodeled']).optional(), reason: text.optional(),
    acknowledgedClaimIds: z.array(id).max(32).default([]),
  }).strict()).min(1).max(64),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.coordinates.map((item) => item.id)).size !== input.coordinates.length) ctx.addIssue({ code: 'custom', message: 'Coordinate IDs must be unique.' });
  for (const coordinate of input.coordinates) {
    if (Boolean(coordinate.question) === Boolean(coordinate.disposition)) ctx.addIssue({ code: 'custom', message: 'Each coordinate requires either a question or an explicit unknown/unmodeled disposition.' });
    if (coordinate.disposition && !coordinate.reason) ctx.addIssue({ code: 'custom', message: 'An explicit disposition requires a reason.' });
  }
});
export const jevProcessRecordSchema = z.object({
  requestId: id, proposalId: id, graphHash: z.string().regex(/^[a-f0-9]{64}$/), parentId: id,
  accessScopes: z.array(id).max(32).default([]),
  review: z.object({ verdict: z.enum(['approved', 'changes_requested', 'rejected']), rationale: text, holder: id }).strict(),
}).strict();

const caches = new WeakMap();
function cacheFor(service) {
  if (!caches.has(service)) caches.set(service, { estimates: new Map(), proposals: new Map() });
  return caches.get(service);
}
const digest = (value) => createHash('sha256').update(canonicalEstimationJson(value)).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label) {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error(`${label} must contain exactly the expected keys.`);
}
function boundedNumber(value, lower, upper, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lower || value > upper) throw new Error(`${label} must be a finite number in [${lower},${upper}].`);
}
function distribution(value, keys, label) {
  exactKeys(value, keys, label);
  const values = keys.map((key) => { boundedNumber(value[key], 0, 1, `${label}.${key}`); return value[key]; });
  if (Math.abs(values.reduce((sum, item) => sum + item, 0) - 1) > 1e-6) throw new Error(`${label} probabilities must sum to one.`);
  // Only remove floating-point rounding error; invalid distributions are never repaired.
  const total = values.reduce((sum, item) => sum + item, 0);
  return values.map((value) => value / total);
}
function intersectionAudiences(lists) {
  const restricted = lists.filter((scopes) => scopes.length > 0).map((scopes) => new Set(scopes));
  if (!restricted.length) return [];
  const common = [...restricted[0]].filter((scope) => restricted.every((set) => set.has(scope))).sort();
  if (!common.length) throw new Error('The evidence has disjoint access audiences; split the estimation batch rather than widening visibility.');
  return common;
}
function assertAccess(scopes, accessScopes, label) {
  if (scopes.length && !scopes.some((scope) => accessScopes.includes(scope))) throw new Error(`${label} is inaccessible with the supplied accessScopes.`);
}
function placementAudiences(view, parentId) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const incoming = new Map();
  for (const edge of view.edges) {
    if (edge.family !== 'structural' || edge.target?.kind !== 'node') continue;
    if (!incoming.has(edge.target.node_id)) incoming.set(edge.target.node_id, []);
    incoming.get(edge.target.node_id).push(edge);
  }
  const seen = new Set(); const pending = [parentId]; const scopes = [];
  while (pending.length) {
    const nodeId = pending.pop();
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = nodes.get(nodeId);
    if (!node) throw new Error('A structural placement ancestor is missing or inaccessible.');
    scopes.push(node.access_scopes ?? []);
    for (const edge of incoming.get(nodeId) ?? []) {
      scopes.push(edge.access_scopes ?? []);
      if (edge.source?.kind === 'node') pending.push(edge.source.node_id);
    }
  }
  return scopes;
}
function appendContainsOrder(view, parentId) {
  const siblings = view.edges.filter((edge) => edge.relation === 'contains'
    && edge.source?.kind === 'node' && edge.source.node_id === parentId);
  const orders = siblings.map((edge) => edge.order);
  if (orders.some((order) => !Number.isSafeInteger(order) || order < 0)) {
    throw new Error('Recording requires every existing contains sibling to have a nonnegative safe integer order; unordered siblings cannot be appended.');
  }
  if (new Set(orders).size !== orders.length) throw new Error('Recording requires unique contains sibling orders.');
  const maximum = orders.reduce((largest, order) => Math.max(largest, order), -1);
  if (maximum === Number.MAX_SAFE_INTEGER) throw new Error('Recording cannot append beyond the maximum safe integer sibling order; explicitly reorder the existing siblings first.');
  return maximum + 1;
}
export function buildJevProcessQuestion(spec, process) {
  if (spec.type === 'choice') {
    const variants = process.value_type.kind === 'distribution' ? process.value_type.outcomes : process.value_type.variants;
    if (!['category', 'regime', 'distribution'].includes(process.value_type.kind) || !Array.isArray(variants)) throw new Error(`Choice requires a category, regime or distribution process (${process.id}).`);
    if (variants.length < 2 || variants.length > 255) throw new Error('Choice requires between 2 and 255 options.');
    exactKeys(spec.criteria, variants, `${process.id} criteria`);
    return { type: 'choice', instructions: spec.instructions, criteria: spec.criteria };
  }
  if (spec.type === 'score') {
    if (process.value_type.kind !== 'scalar' || process.unit !== spec.unit) throw new Error(`Score requires a scalar with exactly the supplied unit (${process.id}).`);
    for (const [index, level] of spec.levels.entries()) {
      validateProcessValue({ kind: 'scalar', value: level.value }, process);
      if (index && level.value <= spec.levels[index - 1].value) throw new Error('Score level numeric values must be strictly increasing.');
    }
    return { type: 'score', instructions: spec.instructions, criteria: spec.levels.map((level) => level.description) };
  }
  if (process.value_type.kind !== 'scalar' || process.unit !== 'probability' || process.value_type.bounds.minimum !== 0 || process.value_type.bounds.maximum !== 1) throw new Error(`Noul requires an explicitly declared scalar probability process bounded [0,1] (${process.id}); it cannot stand in for a physical quantity.`);
  return { type: 'noul', instructions: spec.instructions };
}

export function mapJevProcessAnswer(answer, spec, process) {
  buildJevProcessQuestion(spec, process);
  if (!record(answer) || answer.type !== spec.type) throw new Error(`${process.id} answer type must equal ${spec.type}.`);
  let value;
  if (spec.type === 'noul') {
    exactKeys(answer, ['type', 'noul'], `${process.id} answer`);
    boundedNumber(answer.noul, 0, 1, `${process.id} noul`);
    value = { kind: 'scalar', value: answer.noul };
  } else {
    exactKeys(answer, spec.type === 'choice' ? ['type', 'choice', 'probabilities', 'confidence'] : ['type', 'score', 'probabilities', 'confidence', 'legend'], `${process.id} answer`);
    boundedNumber(answer.confidence, 0, 1, `${process.id} confidence`);
    const keys = spec.type === 'choice' ? Object.keys(spec.criteria) : spec.levels.map((_, index) => String(index));
    const probabilities = distribution(answer.probabilities, keys, `${process.id} probabilities`);
    if (spec.type === 'choice') {
      if (typeof answer.choice !== 'string' || !keys.includes(answer.choice)) throw new Error(`${process.id} choice is not a declared option.`);
      if (answer.probabilities[answer.choice] + 1e-6 < Math.max(...probabilities)) throw new Error(`${process.id} choice is inconsistent with its probabilities.`);
      value = process.value_type.kind === 'distribution'
        ? { kind: 'distribution', value: process.value_type.outcomes.map((outcome) => probabilities[keys.indexOf(outcome)]) }
        : { kind: process.value_type.kind, value: answer.choice };
    } else {
      boundedNumber(answer.score, 0, keys.length - 1, `${process.id} score`);
      exactKeys(answer.legend, keys, `${process.id} legend`);
      if (keys.some((key) => answer.legend[key] !== spec.levels[Number(key)].description)) throw new Error(`${process.id} returned legend does not match the supplied rubric.`);
      const expectedScore = probabilities.reduce((sum, p, index) => sum + p * index, 0);
      if (Math.abs(expectedScore - answer.score) > 0.02) throw new Error(`${process.id} score is inconsistent with its distribution.`);
      value = { kind: 'scalar', value: probabilities.reduce((sum, p, index) => sum + p * spec.levels[index].value, 0) };
    }
    if (answer.confidence < spec.minimumConfidence) return { status: 'unknown', reason: `Provider confidence ${answer.confidence} is below the caller's threshold ${spec.minimumConfidence}.` };
  }
  validateProcessValue(value, process);
  return { status: 'known', value, reason: 'The provider produced a typed provisional estimate; known means a supplied value, not verified truth.' };
}

// Receipts retain both successful and uncertain failed calls. Replaying the same key
// never causes another provider request; an intentional retry/reroll needs a new key.
async function once(map, key, input, run) {
  const fingerprint = digest(input);
  const existing = map.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error('requestId is already bound to different inputs; use a new ID for a deliberate new estimation.');
    return structuredClone(await existing.promise);
  }
  if (map.size >= 64) throw new Error('Process-estimation receipt limit reached; retain/export the existing results before starting another server session.');
  const entry = { fingerprint, promise: null };
  map.set(key, entry);
  entry.promise = Promise.resolve().then(run);
  return structuredClone(await entry.promise);
}

export function createJevProcessEstimator({ service, estimator = null }) {
  return async function estimate(raw) {
    const input = jevProcessEstimationSchema.parse(raw);
    const cache = cacheFor(service);
    return once(cache.estimates, input.requestId, { input, provider: estimator?.label ?? null }, async () => {
      const head = await service.inspectWorld({ worldId: input.worldId });
      const { model } = await service.inspectModel({ modelHash: head.modelHash, includeDefinition: true });
      const processes = new Map(model.processes.map((process) => [process.id, process]));
      const questions = Object.create(null);
      const coordinateQuestions = new Map();
      assertAccess(input.contextAccessScopes, input.accessScopes, 'External context');
      for (const [index, coordinate] of input.coordinates.entries()) {
        const process = processes.get(coordinate.processId);
        if (!process) throw new Error(`Unknown process ${coordinate.processId}.`);
        assertAccess(process.access_scopes ?? [], input.accessScopes, coordinate.processId);
        if (coordinate.question) {
          const key = `q${index}`;
          questions[key] = buildJevProcessQuestion(coordinate.question, process);
          questions[key].instructions += `\nTarget process: ${process.id}. Target time: ${coordinate.targetTime ?? head.time} ${model.time_unit}. Evidence cutoff: ${input.evidenceCutoff} ${model.time_unit}. Use only the supplied evidence or explicit scenario for this target.`;
          coordinateQuestions.set(coordinate.id, key);
        }
      }
      const request = await service.createEstimationRequest({
        worldId: input.worldId, requestId: `jev-request-${digest(input)}`,
        operation: input.operation, intent: input.intent, evidenceCutoff: input.evidenceCutoff,
        accessScopes: input.accessScopes, context: input.context,
        coordinates: input.coordinates.map(({ id, processId, targetTime, question }) => ({ id, processId, ...(targetTime === undefined ? {} : { targetTime }), ...(question ? { question: question.instructions } : {}) })),
      });
      if (request.modelHash !== head.modelHash || request.acceptedHeadHash !== head.headHash) throw new Error(`World changed before the provider request was bound; no external request was sent. Retained request: ${request.estimationRequestId}. Start a new request against the current world.`);
      const evidenceScopes = [input.contextAccessScopes,
        ...Object.keys(request.evidenceProjection.state).map((processId) => processes.get(processId).access_scopes ?? []),
        ...Object.values(request.evidenceProjection.claims).map((claim) => claim.access_scopes ?? []),
      ];
      const outputScopes = intersectionAudiences(evidenceScopes);
      const state = canonicalEstimationJson({ context: input.context, provenance: input.provenance, operation: input.operation, intent: input.intent, evidenceCutoff: input.evidenceCutoff,
        acceptedHeadTime: request.acceptedHeadTime, evidence: request.evidenceProjection,
        targets: input.coordinates.map((coordinate) => ({ coordinateId: coordinate.id, questionKey: coordinateQuestions.get(coordinate.id) ?? null, process: processes.get(coordinate.processId), targetTime: coordinate.targetTime ?? request.acceptedHeadTime })),
        instruction: 'Evaluate only the supplied evidence and declared scenario. Returned values are provisional inference, not observations. Each question is independent.' });
      if (state.length + JSON.stringify(questions).length > MAX_ESTIMATOR_REQUEST_CHARS - 1_000) throw new Error('Process estimation batch exceeds the bounded provider request size; split the batch.');
      if (!estimator && Object.keys(questions).length) return {
        schema: 'meaning-model-process-estimation/v1', status: 'provider_not_configured', estimationRequestId: request.estimationRequestId,
        modelHash: request.modelHash, acceptedHeadHash: request.acceptedHeadHash, state, questions,
        coordinateQuestionKeys: Object.fromEntries(coordinateQuestions), worldMutationPerformed: false,
        nextStep: 'Configure MEANING_MODEL_ESTIMATOR=typesafe and TYPESAFE_API_KEY, or answer these tasks and submit typed claims with life_estimation_response. No external request was sent.',
      };
      let result = { answers: {}, usage: null, model: null };
      if (Object.keys(questions).length) {
        try { result = await estimator.estimate(state, questions); }
        catch (error) { throw new Error(`Provider request failed or has an uncertain outcome; this requestId will not resend it. Request ${request.estimationRequestId} is retained, with no proposal or world mutation. A deliberate retry requires a new requestId. ${error.message}`); }
      }
      exactKeys(result.answers, Object.keys(questions), 'Provider answers');
      const dispositions = []; const provisionalClaims = []; const mapped = [];
      const provider = estimator?.label ?? 'no_provider_needed';
      for (const coordinate of input.coordinates) {
        const process = processes.get(coordinate.processId);
        const answer = coordinate.question ? result.answers[coordinateQuestions.get(coordinate.id)] : null;
        const output = coordinate.question ? mapJevProcessAnswer(answer, coordinate.question, process) : { status: coordinate.disposition, reason: coordinate.reason };
        dispositions.push({ coordinateId: coordinate.id, status: output.status, reason: output.reason });
        mapped.push({ coordinateId: coordinate.id, processId: process.id, unit: process.unit ?? null, question: coordinate.question ?? null, answer, ...output });
        if (output.status !== 'known') continue;
        const valueTime = coordinate.targetTime ?? request.acceptedHeadTime;
        const scopes = intersectionAudiences([outputScopes, process.access_scopes ?? []]);
        provisionalClaims.push({ coordinateId: coordinate.id, outputMode: 'estimated', valueTime,
          acknowledgedClaimIds: coordinate.acknowledgedClaimIds,
          claim: { id: `jev.claim.${digest({ requestId: input.requestId, coordinateId: coordinate.id })}`, subject: process.id, value: output.value,
            uncertainty: { kind: 'unknown' }, evidence_type: valueTime > input.evidenceCutoff ? 'forecast' : 'estimate', holder: provider,
            evidence_cutoff: input.evidenceCutoff, provenance: [`provider:${provider}`, `provider-model:${result.model ?? 'none'}`, `request:${request.estimationRequestId}`, `evidence-digest:${digest({ state, questions })}`],
            authority: { source: provider, weight: 0.5 }, access_scopes: scopes } });
      }
      const submission = { estimationRequestId: request.estimationRequestId, requestId: `jev-submit-${digest(input)}`, dispositions, provisionalClaims };
      let proposal;
      try { proposal = await service.submitEstimationResponse(submission); }
      catch (error) {
        return { schema: 'meaning-model-process-estimation/v1', status: 'submission_failed', error: error.message,
          estimationRequestId: request.estimationRequestId, modelHash: request.modelHash, acceptedHeadHash: request.acceptedHeadHash,
          provider, providerModel: result.model, usage: result.usage, mapped, response: result, submission,
          worldMutationPerformed: false, providerResponseRetained: true,
          nextStep: 'The exact provider output is retained in this receipt. Inspect the core rejection and, if appropriate, use life_estimation_response with these exact claims and explicit conflict acknowledgements. Replaying this request does not query Jev again.' };
      }
      const bundle = { schema: 'meaning-model-process-estimation/v1', input, request, provider, providerModel: result.model, state, questions, response: result, mapped, proposal, outputScopes };
      if (JSON.stringify(bundle).length > 1_000_000) throw new Error(`Estimation proposal ${proposal.proposalId} was stored, but its provider bundle exceeds the recording limit. No world mutation occurred.`);
      cache.proposals.set(proposal.proposalId, bundle);
      return { schema: bundle.schema, status: 'review_required', ...proposal, provider, providerModel: result.model, usage: result.usage, mapped,
        nextStep: { tool: 'life_process_estimation_record', proposalId: proposal.proposalId, requiresExplicitReview: true,
          meaning: 'Record the exact estimates and an attributed review in the canonical graph. This does not alter the accepted Rust world or turn estimates into observations.' } };
    });
  };
}

export async function recordJevProcessEstimation(service, raw) {
  const input = jevProcessRecordSchema.parse(raw);
  const cache = cacheFor(service);
  return runEstimatorRequest(service, 'jev-process-record', input.requestId, input, async (checkpoint) => {
    let prepared = checkpoint.get('prepared');
    if (!prepared) {
      const bundle = cache.proposals.get(input.proposalId);
      if (!bundle) throw new Error('The exact provider bundle is unavailable in this session; do not reconstruct or rerun it silently. Read a previously recorded bundle from its graph instead.');
      const inspected = await service.inspectEstimationProposal({ proposalId: input.proposalId });
      const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: input.accessScopes, forRevision: true });
      if (view.graph_hash !== input.graphHash || !view.content_included || view.nodes.length !== view.graph.node_count || view.edges.length !== view.graph.edge_count || view.roots.length !== view.graph.root_count) throw new Error('Recording requires the complete exact graph, including all private nodes, edges and roots.');
      if (view.graph.source?.kind !== 'model' || view.graph.source.model_hash !== inspected.baseModelHash) throw new Error('The graph must be bound to the exact proposal model.');
      const parent = view.nodes.find((node) => node.id === input.parentId);
      if (!parent) throw new Error('The recording parent is missing or inaccessible.');
      if (!Number.isSafeInteger(view.graph.revision?.number) || view.graph.revision.number < 0 || view.graph.revision.number >= Number.MAX_SAFE_INTEGER) throw new Error('Recording requires a graph revision with an exact safe integer successor.');
      const placementOrder = appendContainsOrder(view, input.parentId);
      const scopes = intersectionAudiences([bundle.outputScopes, ...placementAudiences(view, input.parentId), ...inspected.provisionalClaims.map((entry) => entry.claim.access_scopes ?? [])]);
      assertAccess(scopes, input.accessScopes, 'Derived estimation records');
      const stem = `estimation.${digest({ proposalId: input.proposalId, requestId: input.requestId }).slice(0, 24)}`;
      const rootId = `${stem}.understanding`;
      const common = { role: 'metadata', render: 'exclude', training: 'exclude', epistemic_status: 'ai_inference', evidence_type: 'estimate', access_scopes: scopes,
        authority: { source: bundle.provider, weight: 0.5 }, uncertainty: { kind: 'unknown' }, provenance: [`process-estimation:${input.proposalId}`, `provider:${bundle.provider}`] };
      const nodes = [
        { ...common, id: stem, node_type: 'process_estimation_bundle', text: JSON.stringify({ ...bundle, reviewedDisposition: input.review.verdict, review: input.review, worldMutationPerformed: false }) },
        { ...common, id: rootId, node_type: 'understanding_process_root', text: JSON.stringify({ clock: 'graph_revision', purpose: 'Attributed review of provider process estimates.' }) },
        { ...common, id: `${stem}.review`, node_type: 'process_estimation_review', role: 'externalized_reflection', holder: input.review.holder,
          value_time: view.graph.revision.number + 1, epistemic_status: 'attributed_review', authority: { source: input.review.holder, weight: 1 },
          text: input.review.rationale },
      ];
      const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
      const edges = [];
      const link = (source, target, relation = 'contains', family = 'structural', order = 0) => edges.push({ id: `${stem}.edge.${edges.length}`, source: endpoint(source), target: typeof target === 'string' ? endpoint(target) : target, family, relation, order, access_scopes: scopes, provenance: common.provenance });
      link(input.parentId, stem, 'contains', 'structural', placementOrder);
      link(rootId, `${stem}.review`);
      link(`${stem}.review`, stem, 'reviews', 'semantic');
      for (const [index, output] of bundle.mapped.entries()) {
        const coordinate = bundle.request.coordinates.find((entry) => entry.id === output.coordinateId);
        const nodeId = `${stem}.coordinate.${index}`;
        nodes.push({ ...common, id: nodeId, node_type: 'process_estimate', value_time: coordinate.targetTime ?? bundle.request.acceptedHeadTime, evidence_cutoff: bundle.request.evidenceCutoff,
          text: JSON.stringify({ ...output, reviewStatus: input.review.verdict, acceptedWorldValue: false, evidenceCutoff: bundle.request.evidenceCutoff, valueTime: coordinate.targetTime ?? bundle.request.acceptedHeadTime }) });
        link(stem, nodeId, 'contains', 'structural', index);
        link(nodeId, { kind: 'anchor', anchor_kind: 'process', anchor_id: output.processId }, 'about', 'grounding');
      }
      const review = await service.reviewEstimationProposal({ proposalId: input.proposalId, requestId: `jev-review-${digest(input)}`, verdict: input.review.verdict, rationale: input.review.rationale });
      nodes[0].text = JSON.stringify({ ...bundle, reviewedDisposition: input.review.verdict, review: input.review, reviewReceipt: review, worldMutationPerformed: false });
      prepared = { review, batchInput: { requestId: `jev-record-${digest(input)}`, previousGraphHash: input.graphHash, narrativeBatch: {
          schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash, reason: `Record ${input.review.verdict} process estimation and its attributed review.`, provenance: common.provenance,
          add_roots: [rootId], add_nodes: nodes, add_edges: edges,
        } }, receipt: { schema: 'meaning-model-process-estimation-record/v1', proposalId: input.proposalId, previousGraphHash: input.graphHash,
          reviewId: review.reviewId, recordedReview: input.review.verdict, bundleNodeId: stem, understandingRootId: rootId, understandingNodeId: `${stem}.review`, recordIds: nodes.filter((node) => node.node_type === 'process_estimate').map((node) => node.id),
          worldMutationPerformed: false, acceptedWorldValuesChanged: false, modelRegistrationPerformed: false } };
      checkpoint.set('prepared', prepared);
    }
    let stored;
    try {
      stored = await service.applyNarrativeBatch(prepared.batchInput);
    } catch (error) {
      return { ...prepared.receipt, partial: true, status: error.indeterminate ? 'indeterminate' : 'recording_incomplete',
        graphHash: null, canonicalGraphRecord: null, error: error.message,
        indeterminate: error.indeterminate === true, receiptRetained: error.receiptRetained === true,
        reconciliationGuidance: error.reconciliationGuidance ?? null,
        exactBatchRequest: prepared.batchInput,
        nextStep: 'The review and exact graph batch are retained. Retry with this same requestId and unchanged arguments to reuse both identities. If the engine outcome remains indeterminate, reconcile its receipt before taking any new action; do not create a replacement request ID.' };
    }
    return { ...prepared.receipt, graphHash: stored.graphHash, canonicalGraphRecord: true,
      nextStep: 'Inspect the recorded estimates and their sources. Approval records a review; simulation or accepted-state updates still require their ordinary explicit core operations.' };
  });
}

export function registerJevProcessEstimationTools(server, service, estimator, { toolResult }) {
  const estimate = createJevProcessEstimator({ service, estimator });
  server.registerTool('life_process_estimate', {
    description: 'Evaluate bounded process questions with the configured Jev provider in one batch and automatically submit typed provisional claims to the core estimation exchange. Choice targets category/regime/distribution; Score maps a declared numeric rubric in the exact process unit; Noul targets an explicit probability process. Observations stay distinct from AI estimates. No provider returns tasks. requestId retries reuse the exact response and never rerun Jev. Record the result with life_process_estimation_record after an explicit attributed review.',
    inputSchema: jevProcessEstimationSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await estimate(input)));
  server.registerTool('life_process_estimation_record', {
    description: 'Record exact process-estimation values, evidence, questions and provider responses in a model-bound graph, together with an explicit core review and a real Understanding Node. Preserves the accepted world and measurements. Requires the same server session for the exact provider bundle; a stored graph bundle remains durable. Approval is an attributed review, not verification or a simulation-state update.',
    inputSchema: jevProcessRecordSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await recordJevProcessEstimation(service, input)));
}
