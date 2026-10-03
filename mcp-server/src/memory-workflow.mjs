// Memory is a scoped entry route into the existing model and Understanding Graph.
// Native models/graph revisions remain authoritative; there is no memory database.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { constructionRecordInstructions } from './construction-principles.mjs';
import { memoryWorkflowInstructions } from './workflow-guidance.mjs';
import { anchoredModelRecord, ensureHolderRoot, externalRecordNode, holderRootId, isExternalTarget, linkRelations, modelReferenceNodeId,
  nextPlacementOrder, noteKinds, recordAnchorEndpoint, targetSchema } from './construction-record.mjs';
import { requireCompleteModelScopes } from './construction-scope.mjs';
import { resolveAppendHead } from './graph-head.mjs';

export const memoryInstructions = memoryWorkflowInstructions;
const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopes = z.array(id).min(1).max(64);
const text = z.string().trim().min(1).max(64_000);
const timestamp = z.iso.datetime({ offset: true });
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const sorted = (values) => [...new Set(values)].sort();
const contextIds = (contextId) => {
  const key = digest(contextId).slice(0, 32);
  return { graphId: `memory.${key}`, rootId: `memory.context.${key}`, processId: `memory.context.${key}.scope`, eventId: `memory.context.${key}.development` };
};
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
const boundModelHash = (view) => view.graph.source?.model_hash ?? view.graph.source_snapshot?.model_hash;
const declarationFields = ['contextId', 'title', 'scope', 'purpose', 'subjects', 'holder', 'accessScopes', 'initialModelHash', 'time'];
const parseText = (node) => { try { return JSON.parse(node.text); } catch { return null; } };
const memoryOf = (node) => parseText(node)?.data?.memory;
function nodeStateDigest(node) {
  const payload = parseText(node);
  if (payload?.data?.memory) delete payload.data.memory.nodeStateDigest;
  if (payload?.schema?.startsWith('meaning-model-transcript-')) delete payload.stateDigest;
  return digest({ payload, ...Object.fromEntries([
    'id', 'node_type', 'role', 'title', 'summary', 'epistemic_status', 'evidence_type',
    'holder', 'subject', 'estimator', 'uncertainty', 'authority', 'value_time',
    'evidence_cutoff', 'interval', 'access_scopes', 'render', 'training', 'provenance',
  ].map((key) => [key, node[key] ?? null])) });
}
const normalizedEndpoint = (end) => end?.kind === 'anchor' ? { ...end, path: end.path ?? null } : end;
const edgeStateDigest = (edge) => digest({ id: edge.id, source: normalizedEndpoint(edge.source), target: normalizedEndpoint(edge.target),
  family: edge.family, relation: edge.relation, order: edge.order ?? null,
  explanation: edge.explanation ?? null, access_scopes: edge.access_scopes ?? [], provenance: edge.provenance });
function bounded(input) {
  if (Buffer.byteLength(JSON.stringify(input)) > 512 * 1024) throw new Error('A memory request exceeds 512 KiB; split it into smaller records.');
}

export const memoryStartSchema = z.object({
  requestId: id, contextId: id, title: z.string().trim().min(1).max(300),
  scope: z.string().trim().min(1).max(8_000).describe('The user-selected work or life context within which automatic capture and process modeling are delegated.'),
  purpose: z.enum(['agent_memory', 'user_memory']), subjects: z.array(id).min(1).max(32), holder: id,
  time: z.object({ unit: id, origin: z.string().trim().min(1).max(2_000) }).strict().optional()
    .describe('For a new model, explicitly declare the modeled process time unit and what time zero means. This is separate from graph revision/capture order. Reused models retain their native time unit.'),
  accessScopes: scopes, modelHash: hash.optional().describe('Reuse this stored native model instead of creating a qualitative context scaffold.'),
  graphHash: hash.optional().describe('Choose an exact existing branch when reopening a context with multiple heads.'),
}).strict().superRefine((input, ctx) => {
  if (!input.modelHash && !input.time) ctx.addIssue({ code: 'custom', path: ['time'], message: 'A new memory model needs an explicit time unit and origin, separate from the authoring-step clock.' });
});
const uncertainty = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unknown') }).strict(), z.object({ kind: z.literal('exact') }).strict(),
  z.object({ kind: z.literal('standard_deviation'), value: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal('interval'), lower: z.number().finite(), upper: z.number().finite() }).strict()
    .refine((v) => v.lower <= v.upper, 'Uncertainty interval is reversed.'),
]);
const source = z.object({ citation: z.string().trim().min(1).max(1_000), url: z.string().url().max(2_000).optional(),
  published: z.string().trim().min(1).max(80).optional(), reportsOn: z.string().trim().min(1).max(160).optional() }).strict();
export const memoryRecordSchema = z.object({
  requestId: id, contextId: id, graphHash: hash, accessScopes: scopes, holder: id, recordedBy: id,
  exactRevision: z.boolean().default(false),
  entries: z.array(z.object({
    nodeId: id, subject: id, kind: z.enum(noteKinds), text,
    title: z.string().trim().min(1).max(300).optional(), topic: z.string().trim().min(1).max(256).optional(),
    about: z.array(targetSchema).min(1).max(32),
    links: z.array(z.object({ relation: z.enum(linkRelations), targetNodeId: id }).strict()).max(32).default([]),
    evidenceType: z.enum(['observation', 'report', 'belief', 'estimate', 'forecast']).default('belief'),
    source: source.optional(), uncertainty: uncertainty.default({ kind: 'unknown' }),
    observedAt: timestamp.optional(), validFrom: timestamp.optional(), validUntil: timestamp.optional(),
  }).strict().superRefine((entry, ctx) => {
    if ((entry.evidenceType === 'report' || entry.kind === 'report') && !entry.source) ctx.addIssue({ code: 'custom', path: ['source'], message: 'A reported account needs its actual source.' });
    if (entry.kind === 'report' && entry.evidenceType !== 'report') ctx.addIssue({ code: 'custom', path: ['evidenceType'], message: 'A report uses evidenceType report.' });
    if (entry.validFrom && entry.validUntil && Date.parse(entry.validUntil) < Date.parse(entry.validFrom)) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Validity ends before it starts.' });
  })).min(1).max(32),
}).strict().refine((input) => new Set(input.entries.map((entry) => entry.nodeId)).size === input.entries.length, 'Memory entry IDs must be unique.');
export const memoryQuerySchema = z.object({
  contextId: id, graphHash: hash.optional(), accessScopes: scopes,
  subject: id.optional(), holder: id.optional(), topic: z.string().trim().min(1).max(256).optional(),
  search: z.string().trim().min(1).max(1_000).optional().describe('Case-insensitive literal text search, not semantic verification.'),
  includeSuperseded: z.boolean().default(false), offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

// Transcript capture is separately delegated. The server has no access to its
// caller's chat; it stores only the visible messages explicitly supplied here.
const transcriptWrite = { requestId: id, contextId: id, graphHash: hash, accessScopes: scopes, recordedBy: id };
export const memoryTranscriptConfigureSchema = z.object({ ...transcriptWrite, enabled: z.boolean() }).strict();
export const memoryTranscriptCaptureSchema = z.object({ ...transcriptWrite, conversationId: id,
  source: z.enum(['host_transcript', 'caller_supplied']).describe('How the exact visible text was obtained; caller-supplied text is not independently verified against a host transcript.'),
  messages: z.array(z.object({ messageId: id, sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    role: z.enum(['user', 'assistant']), speaker: id,
    text: z.string().min(1).max(64_000).describe('Exact visible message text, including whitespace; never hidden reasoning, system prompts or tool traffic.'),
    timestamp: timestamp.optional().describe('The supplied message timestamp, if known. Never replace an unknown timestamp with capture time.'),
  }).strict()).min(1).max(32),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.messages.map((message) => message.messageId)).size !== input.messages.length) ctx.addIssue({ code: 'custom', path: ['messages'], message: 'Message IDs must be unique within a capture batch.' });
  if (new Set(input.messages.map((message) => message.sequence)).size !== input.messages.length) ctx.addIssue({ code: 'custom', path: ['messages'], message: 'Message sequences must be unique within a conversation.' });
});
export const memoryTranscriptQuerySchema = z.object({ contextId: id, graphHash: hash.optional(), accessScopes: scopes,
  conversationId: id.optional(), role: z.enum(['user', 'assistant']).optional(), speaker: id.optional(),
  search: z.string().min(1).max(1_000).optional().describe('Literal case-insensitive search over supplied visible text.'),
  offset: z.number().int().min(0).max(100_000).default(0), limit: z.number().int().min(1).max(100).default(25),
}).strict();
const transcriptPayload = (node, schema) => { const payload = parseText(node); return payload?.schema === schema ? payload : null; };
const transcriptMessage = (node) => transcriptPayload(node, 'meaning-model-transcript-message/v1');
const visibleContent = (node) => node.boundary !== true && node.content_included !== false;
const transcriptSettingPayloadSchema = z.object({ schema: z.literal('meaning-model-transcript-setting/v1'),
  contextId: id, enabled: z.boolean(), requestId: id, requestDigest: hash, recordedBy: id,
  authoringStep: z.number().int().nonnegative(), stateDigest: hash }).strict();
const transcriptMessagePayloadSchema = z.object({ schema: z.literal('meaning-model-transcript-message/v1'),
  contextId: id, conversationId: id, message: memoryTranscriptCaptureSchema.shape.messages.element,
  source: memoryTranscriptCaptureSchema.shape.source, recordedBy: id, requestId: id,
  requestDigest: hash, captureDigest: hash, placementDigest: hash,
  authoringStep: z.number().int().nonnegative(), stateDigest: hash }).strict();
function transcriptSetting(view, contextId) {
  const settings = view.nodes.filter(visibleContent).filter((node) => node.node_type === 'transcript.setting'
    || transcriptPayload(node, 'meaning-model-transcript-setting/v1')).map((node) => {
    const payload = parseText(node);
    if (!transcriptSettingPayloadSchema.safeParse(payload).success
      || node.id !== `transcript.setting.${digest([payload.contextId, payload.requestId])}`
      || payload.requestDigest !== digest({ contextId: payload.contextId, enabled: payload.enabled,
        recordedBy: payload.recordedBy, accessScopes: node.access_scopes })
      || payload.stateDigest !== nodeStateDigest(node)) {
      throw new Error(`Transcript setting ${node.id} is malformed or changed after configuration; capture state cannot be established. Use an unchanged revision or repair the changed setting explicitly.`);
    }
    return { node, payload };
  }).filter(({ payload }) => payload.contextId === contextId);
  return settings.sort((a, b) => b.payload.authoringStep - a.payload.authoringStep || a.node.id.localeCompare(b.node.id))[0];
}
function checkedTranscriptMessages(view) {
  return view.nodes.filter(visibleContent).filter((node) => ['transcript.user_message', 'transcript.assistant_message'].includes(node.node_type)
    || transcriptMessage(node)).map((node) => {
    const payload = parseText(node);
    const placement = view.edges.find((edge) => edge.id === `${node.id}.placement`);
    if (!transcriptMessagePayloadSchema.safeParse(payload).success
      || node.id !== `transcript.message.${digest([payload.contextId, payload.conversationId, payload.message.messageId])}`
      || payload.captureDigest !== digest({ contextId: payload.contextId, conversationId: payload.conversationId,
        message: payload.message, source: payload.source, recordedBy: payload.recordedBy, accessScopes: node.access_scopes })
      || payload.stateDigest !== nodeStateDigest(node)
      || !placement || payload.placementDigest !== edgeStateDigest(placement)) {
      throw new Error(`Transcript message ${node.id} is malformed or conflicts with its stored source or placement; use an unchanged revision and record a separate correction.`);
    }
    return { node, payload };
  });
}
function transcriptStatus(view, contextId) {
  const setting = transcriptSetting(view, contextId);
  return { enabled: setting?.payload.enabled ?? false, settingNodeId: setting?.node.id ?? null,
    capture: 'Only explicitly supplied visible user and assistant messages. No automatic access to the host conversation.',
    authority: 'Source evidence of what was said, not accepted world truth.', render: 'exclude', training: 'exclude' };
}
function requireTranscriptScopes(input, context) {
  if (canonical(input.accessScopes) !== canonical(context.accessScopes)) throw new Error('Transcript writes must use exactly the context\'s declared accessScopes; labels are OR alternatives.');
}
async function transcriptHead(service, input) {
  // Resolve the current sole descendant even on retries, so a disabled setting
  // prevents new messages while exact already-stored messages remain retryable.
  const listing = await service.listNarrativeRevisions({ graphId: contextIds(input.contextId).graphId });
  if (!listing.revisions?.some((revision) => revision.graph_hash === input.graphHash)) throw new Error('Cannot establish the current transcript branch from this graphHash; nothing was captured.');
  const head = await resolveAppendHead({ listNarrativeRevisions: async () => listing }, input.graphHash, null);
  const current = await readContext(service, { ...input, graphHash: head.graphHash });
  requireTranscriptScopes(input, current.context);
  return { ...current, head };
}

function persistence(service) {
  const mode = service.backend?.status?.().persistenceMode ?? 'unknown';
  return { mode, durable: mode === 'optional-single-writer-state-file', warning: mode === 'optional-single-writer-state-file'
    ? 'Native model and graph history is retained in the configured single-writer state file.'
    : 'Do not promise memory across restart. Configure LIFE_SIM_STATE_FILE or export the construction before this process closes.' };
}
async function selectGraph(service, contextId, graphHash) {
  if (graphHash) return graphHash;
  const listing = await service.listNarrativeRevisions({ graphId: contextIds(contextId).graphId });
  if (listing.heads?.length !== 1) throw new Error(listing.heads?.length
    ? 'This memory context has multiple branch heads. Choose an exact graphHash through life_saved_work_list; no newest branch was selected.'
    : 'Memory context is unknown or inaccessible. Start an explicitly scoped context or use its exact graphHash.');
  return listing.heads[0];
}
async function readContext(service, input) {
  const graphHash = await selectGraph(service, input.contextId, input.graphHash);
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: sorted(input.accessScopes) });
  if (view.graph_hash !== graphHash || !view.content_included) throw new Error('Memory requires the exact content-included graph projection.');
  const root = view.nodes.find((node) => node.id === contextIds(input.contextId).rootId);
  const context = root && parseText(root);
  if (view.graph.id !== contextIds(input.contextId).graphId || context?.schema !== 'meaning-model-memory-context/v1' || context.contextId !== input.contextId) throw new Error('Memory context is unknown or inaccessible under these accessScopes.');
  if (context.declarationDigest !== digest(Object.fromEntries(declarationFields.map((field) => [field, context[field]])))
    || canonical(root.access_scopes) !== canonical(context.accessScopes) || root.holder !== context.holder || root.title !== context.title) throw new Error('The stored memory context declaration or visibility changed after its scope was declared. Use the unchanged context revision or start a separately delegated context; nothing was recorded.');
  return { view, context, root, graphHash };
}
function completeModel(model, accessScopes) {
  try { requireCompleteModelScopes(model, accessScopes); }
  catch { throw new Error('Using this complete native model for memory requires its authorized model scopes; do not widen scope automatically.'); }
}
// A caller may read several OR-scoped audiences together. A derived memory
// must still be visible only to audiences shared by every record it concerns.
function intersectRecordScopes(scopes, record) {
  if (!record || typeof record !== 'object') return scopes;
  if (Array.isArray(record)) return record.reduce(intersectRecordScopes, scopes);
  for (const [key, value] of Object.entries(record)) {
    if (key === 'access_scopes' && Array.isArray(value) && value.length) scopes = scopes.filter((scope) => value.includes(scope));
    else if (value && typeof value === 'object') scopes = intersectRecordScopes(scopes, value);
  }
  return scopes;
}
function starterModel(input, ids) {
  const provenance = ['Meaning Model memory context scaffold v1', `Declared context: ${input.contextId}`, `Declared by: ${input.holder}`];
  const description = 'Qualitative anchor for the delegated memory context. Its actual goals, work, learning, changes and history remain to be modeled from evidence; this is not a developed life or workflow.';
  return { schema: 'life-sim-rust-model/v1', id: ids.graphId, time_unit: input.time.unit,
    revision: { number: 0, previous_model_hash: null, reason: `Start memory context: ${input.scope}`, provenance },
    processes: [{ id: ids.processId, value_type: { kind: 'category', variants: ['declared'] }, initial_value: { kind: 'category', value: 'declared' },
      update_mode: 'static', unit: 'context declaration', reference_frame: input.contextId, scale: { semantic_role: description },
      support: [input.scope], access_scopes: input.accessScopes, uncertainty: { kind: 'unknown' }, provenance }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents: [],
      events: [{ id: ids.eventId, boundary: input.scope, description, interval: null, participants: {}, process_ids: [ids.processId],
        observation_process_ids: [], region: null, substrate: null, provenance }], event_relations: [],
      context_roots: [{ event_id: ids.eventId, kind: 'accepted_world', provenance }], normalized_cuts: [] } };
}
function routes(graphHash, modelHash, input) {
  return { modelingContext: { tool: 'life_modeling_context', arguments: { purpose: input.purpose } },
    transcriptConfigure: { tool: 'life_memory_transcript_configure', arguments: { contextId: input.contextId, graphHash, accessScopes: input.accessScopes },
      instruction: 'Transcript capture defaults off. To enable or disable it, supply requestId, recordedBy and enabled. The caller must explicitly supply visible messages; the server cannot read its host conversation.' },
    outline: { tool: 'life_model_outline', arguments: { graphHash, accessScopes: input.accessScopes } },
    replay: { tool: 'life_construction_replay', arguments: { graphHash, accessScopes: input.accessScopes, level: 'outline' } },
    modelDevelopment: { modelHash, tools: ['life_model_revise', 'life_narrative_rebind'],
      instruction: 'Model the ongoing goals, work, decisions, learning and their context in native processes and Events; explicitly rebind this graph before recording against a revised model.' } };
}
export async function startMemory(service, raw) {
  bounded(raw); const input = memoryStartSchema.parse(raw);
  input.accessScopes = sorted(input.accessScopes); input.subjects = sorted(input.subjects);
  const ids = contextIds(input.contextId);
  const declaration = { contextId: input.contextId, title: input.title, scope: input.scope, purpose: input.purpose,
    subjects: input.subjects, holder: input.holder, accessScopes: input.accessScopes, initialModelHash: input.modelHash ?? null, time: input.time ?? null };
  const declarationDigest = digest(declaration);
  const listing = await service.listNarrativeRevisions({ graphId: ids.graphId });
  if (input.graphHash || listing.heads?.length) {
    const current = await readContext(service, input);
    if (current.context.declarationDigest !== declarationDigest) throw new Error('This context already has a different scope or declaration. Reopen it unchanged; do not silently replace its subjects, holder, model or scopes.');
    return { schema: 'meaning-model-memory-start/v1', contextId: input.contextId, graphHash: current.graphHash,
      transcript: transcriptStatus(current.view, input.contextId),
      modelHash: boundModelHash(current.view), contextRootId: ids.rootId, reusedExisting: true, graphMutation: false,
      nativeTargets: current.context.nativeTargets, modelTime: current.context.modelTime, persistence: persistence(service), modelCompleteness: 'not assessed',
      instructions: `${memoryWorkflowInstructions}\n\n${constructionRecordInstructions}`, ...routes(current.graphHash, boundModelHash(current.view), input) };
  }
  let modelHash = input.modelHash;
  let model;
  if (modelHash) {
    ({ model } = await service.inspectModel({ modelHash, includeDefinition: true })); completeModel(model, input.accessScopes);
    if (input.time && input.time.unit !== model.time_unit) throw new Error('The declared time unit must match the reused native model; the authoring clock does not replace model time.');
  }
  else {
    model = starterModel(input, ids);
    ({ modelHash } = await service.registerModel({ requestId: `memory.model.${digest(input.contextId)}`, model }));
  }
  const nativeTargets = input.modelHash ? [{ record: `model:${model.id}` }] : [{ record: `process:${ids.processId}` }, { record: `event:${ids.eventId}` }];
  const provenance = ['Meaning Model memory context v1', `declared-by:${input.holder}`];
  const modelTime = { unit: model.time_unit, origin: input.time?.origin ?? null };
  const context = { schema: 'meaning-model-memory-context/v1', ...declaration, declarationDigest, modelTime,
    nativeTargets, clock: 'authoring_step', capture: 'automatic within this chosen scope during delegated work; no background observation',
    scaffoldOnly: !input.modelHash };
  const graph = { schema: 'life-sim-rust-narrative-graph/v1', id: ids.graphId,
    revision: { number: 0, previous_graph_hash: null, reason: `Start scoped memory: ${input.title}`, provenance },
    source: { kind: 'model', model_hash: modelHash }, roots: [ids.rootId],
    nodes: [{ id: ids.rootId, node_type: 'memory_context', role: 'metadata', title: input.title, text: JSON.stringify(context),
      holder: input.holder, epistemic_status: 'declared_scope', evidence_type: 'report', authority: { source: input.holder, weight: 1 },
      uncertainty: { kind: 'unknown' }, access_scopes: input.accessScopes, render: 'exclude', training: 'exclude', provenance }],
    edges: nativeTargets.map((target, index) => ({ id: `${ids.rootId}.about.${index}`, source: endpoint(ids.rootId),
      target: recordAnchorEndpoint(model, target, 'Memory context', modelHash), family: 'grounding', relation: 'about', access_scopes: input.accessScopes, provenance })) };
  const stored = await service.registerNarrativeGraph({ requestId: `memory.graph.${digest(input.contextId)}`, narrativeGraph: graph });
  return { schema: 'meaning-model-memory-start/v1', contextId: input.contextId, graphHash: stored.graphHash, modelHash,
    transcript: transcriptStatus({ nodes: [] }, input.contextId),
    contextRootId: ids.rootId, nativeTargets, reusedExisting: stored.reusedExisting, graphMutation: true, worldMutation: false,
    scaffoldOnly: !input.modelHash, modelTime, modelCompleteness: 'not assessed', persistence: persistence(service),
    instructions: `${memoryWorkflowInstructions}\n\n${constructionRecordInstructions}`, ...routes(stored.graphHash, modelHash, input) };
}

export async function recordMemory(service, raw) {
  bounded(raw); const input = memoryRecordSchema.parse(raw); input.accessScopes = sorted(input.accessScopes);
  const requestKey = `memory.record.${digest([input.contextId, input.requestId])}`;
  // Reconcile stable IDs against the selected current branch, including retries.
  // A process-local batch receipt describes the original write, not whether its
  // entries and links survived later graph edits unchanged.
  const listing = await service.listNarrativeRevisions({ graphId: contextIds(input.contextId).graphId });
  if (!listing.revisions?.some((revision) => revision.graph_hash === input.graphHash)) throw new Error('Cannot establish the current memory branch from this graphHash; nothing was recorded.');
  const head = await resolveAppendHead({ listNarrativeRevisions: async () => listing }, input.graphHash, null, input.exactRevision);
  const { view, context, root } = await readContext(service, { ...input, graphHash: head.graphHash });
  if (canonical(input.accessScopes) !== canonical(context.accessScopes)) throw new Error('Memory recording must use exactly the context\'s declared accessScopes; labels are OR alternatives, not additional restrictions.');
  if (input.entries.some((entry) => !context.subjects.includes(entry.subject))) throw new Error('An entry subject is outside this memory context; choose an explicitly delegated context for that subject.');
  const requestDigest = digest({ contextId: input.contextId, holder: input.holder, recordedBy: input.recordedBy, entries: input.entries, accessScopes: input.accessScopes });
  const existingEntries = view.nodes.filter((node) => memoryOf(node)?.contextId === input.contextId);
  if (existingEntries.some((node) => memoryOf(node).requestId === input.requestId && memoryOf(node).requestDigest !== requestDigest)) throw new Error('This memory requestId already names a different recorded payload.');
  const entryDigest = (entry) => digest({ contextId: input.contextId, holder: input.holder, recordedBy: input.recordedBy, entry, accessScopes: input.accessScopes });
  const known = new Map(view.nodes.map((node) => [node.id, node]));
  const additions = input.entries.filter((entry) => {
    const existing = known.get(entry.nodeId);
    if (!existing) return true;
    if (memoryOf(existing)?.captureDigest !== entryDigest(entry)) throw new Error(`Node ${entry.nodeId} already exists with another account. Use a new stable ID and an explicit supersedes or contradicts link.`);
    const memory = memoryOf(existing);
    if (memory.nodeStateDigest !== nodeStateDigest(existing)
      || !memory.edgeStates?.every(([edgeId, expected]) => {
        const edge = view.edges.find((candidate) => candidate.id === edgeId);
        return edge && edgeStateDigest(edge) === expected;
      })) throw new Error(`Memory entry ${entry.nodeId} or its declared links changed after capture. Read the current account before retrying; the old receipt no longer establishes an identical record.`);
    return false;
  });
  if (!additions.length) return { schema: 'meaning-model-memory-record/v1', contextId: input.contextId,
    graphHash: head.graphHash, nodeIds: input.entries.map((entry) => entry.nodeId), reusedExisting: true,
    graphMutation: false, worldMutation: false, persistence: persistence(service) };
  const modelHash = boundModelHash(view);
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  completeModel(model, input.accessScopes);
  const step = view.graph.revision.number;
  const provenance = ['Meaning Model memory entry v1', `holder:${input.holder}`, `recorded-by:${input.recordedBy}`,
    `clock:authoring_step`, `written-against-model:${modelHash}`, `written-at-graph-revision:${step}`];
  const rootId = holderRootId(input.holder);
  if (known.has(rootId) && known.get(rootId).holder !== input.holder) throw new Error('The holder root ID collides with another holder; use an unambiguous holder identity.');
  const holderRoot = ensureHolderRoot(view, { holder: input.holder, scopes: input.accessScopes, provenance });
  const nodes = [...holderRoot.nodes], edges = [];
  let order = nextPlacementOrder(view, rootId);
  const references = new Set(view.nodes.filter((node) => node.node_type === 'model_reference').map((node) => node.id));
  const targetModels = new Map([[modelHash, model]]);
  for (const entry of additions) {
    let entryScopes = [...input.accessScopes];
    for (const target of entry.about.filter((target) => target.record)) {
      const targetHash = target.modelHash ?? modelHash;
      if (!targetModels.has(targetHash)) {
        const inspected = await service.inspectModel({ modelHash: targetHash, includeDefinition: true });
        completeModel(inspected.model, input.accessScopes);
        targetModels.set(targetHash, inspected.model);
      }
      const targetModel = targetModels.get(targetHash);
      const anchor = recordAnchorEndpoint(targetModel, target, 'Memory entry', targetHash);
      entryScopes = intersectRecordScopes(entryScopes, anchoredModelRecord(targetModel, anchor.anchor_kind, anchor.anchor_id, targetHash));
      if (isExternalTarget(target, modelHash)) {
        const reference = known.get(modelReferenceNodeId(targetHash, target.record));
        if (reference?.access_scopes?.length) entryScopes = entryScopes.filter((scope) => reference.access_scopes.includes(scope));
      }
    }
    for (const targetId of [...entry.about.filter((target) => target.nodeId).map((target) => target.nodeId), ...entry.links.map((link) => link.targetNodeId)]) {
      const target = known.get(targetId);
      if (!target) throw new Error(`Memory target ${targetId} is unknown or inaccessible. Refer to an existing visible node or an earlier entry in this batch.`);
      if (target.access_scopes?.length) entryScopes = entryScopes.filter((scope) => target.access_scopes.includes(scope));
      if (entry.links.some((link) => link.targetNodeId === targetId && link.relation === 'supersedes')
        && (memoryOf(target)?.contextId !== input.contextId || target.subject !== entry.subject || target.holder !== input.holder)) throw new Error('Supersession must replace the same holder\'s account about the same subject in this memory context. Use contradicts or refines for another holder\'s account.');
    }
    if (!entryScopes.length) throw new Error('The memory entry and its targets share no authorized access scope.');
    const payload = { schema: 'meaning-model-understanding-note/v1', kind: entry.kind, text: entry.text,
      ...(entry.source ? { source: entry.source } : {}), data: { memory: { contextId: input.contextId, captureDigest: entryDigest(entry),
        requestId: input.requestId, requestDigest, recordedBy: input.recordedBy, writtenAgainstModel: modelHash, authoringStep: step,
        ...(entry.topic ? { topic: entry.topic } : {}), ...(entry.source ? { source: entry.source } : {}),
        ...(entry.observedAt ? { observedAt: entry.observedAt } : {}), ...(entry.validFrom ? { validFrom: entry.validFrom } : {}), ...(entry.validUntil ? { validUntil: entry.validUntil } : {}) } } };
    const node = { id: entry.nodeId, node_type: `understanding.${entry.kind}`, role: 'externalized_reflection',
      ...(entry.title ? { title: entry.title } : {}), text: JSON.stringify(payload), holder: input.holder, subject: entry.subject,
      epistemic_status: 'attributed_account', evidence_type: entry.evidenceType, uncertainty: entry.uncertainty,
      authority: { source: entry.source?.citation ?? input.holder, weight: 1 }, value_time: step,
      access_scopes: entryScopes, render: 'exclude', training: 'exclude', provenance };
    nodes.push(node); known.set(node.id, node);
    const addEdge = (suffix, target, family, relation) => edges.push({ id: `${entry.nodeId}.${suffix}`, source: endpoint(entry.nodeId), target, family, relation, access_scopes: entryScopes, provenance });
    edges.push({ id: `${entry.nodeId}.placement`, source: endpoint(rootId), target: endpoint(entry.nodeId), family: 'structural', relation: 'contains', order: order++, access_scopes: entryScopes, provenance });
    addEdge('memory-context', endpoint(root.id), 'semantic', 'about');
    for (const [index, target] of entry.about.entries()) {
      if (isExternalTarget(target, modelHash)) {
        const ref = await externalRecordNode(service, target, { scopes: entryScopes, provenance, placeUnder: rootId, order: order++, known: references });
        nodes.push(...ref.nodes); edges.push(...ref.edges);
        for (const reference of ref.nodes) known.set(reference.id, reference);
        addEdge(`about.${index}`, endpoint(ref.nodeId), 'semantic', 'about');
      } else if (target.record) addEdge(`about.${index}`, recordAnchorEndpoint(model, target, 'Memory entry', modelHash), 'grounding', 'about');
      else addEdge(`about.${index}`, endpoint(target.nodeId), 'semantic', 'about');
    }
    for (const [index, link] of entry.links.entries()) addEdge(`link.${index}`, endpoint(link.targetNodeId), 'semantic', link.relation);
    payload.data.memory.edgeStates = edges.filter((edge) => edge.source?.node_id === node.id)
      .map((edge) => [edge.id, edgeStateDigest(edge)]);
    node.text = JSON.stringify(payload);
    payload.data.memory.nodeStateDigest = nodeStateDigest(node);
    node.text = JSON.stringify(payload);
  }
  const stored = await service.applyNarrativeBatch({ requestId: requestKey, previousGraphHash: head.graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: head.graphHash,
      reason: `Record attributed memory in ${context.title}.`, provenance, add_roots: holderRoot.roots, add_nodes: nodes, add_edges: edges } });
  return { schema: 'meaning-model-memory-record/v1', contextId: input.contextId, graphHash: stored.graphHash,
    previousGraphHash: head.graphHash, ...(head.advancedFrom ? { advancedFrom: head.advancedFrom } : {}),
    nodeIds: input.entries.map((entry) => entry.nodeId), addedNodeIds: additions.map((entry) => entry.nodeId), authoringStep: step,
    writtenAgainstModel: modelHash, graphMutation: true, worldMutation: false, semanticVerification: false,
    persistence: persistence(service), nextStep: 'Connect the account to the ongoing native process and relevant Events. Develop missing trajectories through model revision and graph rebind; a note alone does not develop that history.' };
}

export async function queryMemory(service, raw) {
  const input = memoryQuerySchema.parse(raw);
  const { view, context, graphHash } = await readContext(service, input);
  const members = new Map(view.nodes.filter((node) => memoryOf(node)?.contextId === input.contextId).map((node) => [node.id, node]));
  const supersededBy = new Map();
  for (const edge of view.edges) if (edge.relation === 'supersedes' && members.has(edge.source?.node_id) && members.has(edge.target?.node_id)
    && members.get(edge.source.node_id).subject === members.get(edge.target.node_id).subject
    && members.get(edge.source.node_id).holder === members.get(edge.target.node_id).holder) {
    if (!supersededBy.has(edge.target.node_id)) supersededBy.set(edge.target.node_id, []);
    supersededBy.get(edge.target.node_id).push(edge.source.node_id);
  }
  const matches = [...members.values()].filter((node) => {
    const memory = memoryOf(node), payload = parseText(node);
    return (input.includeSuperseded || !supersededBy.has(node.id)) && (!input.subject || node.subject === input.subject)
      && (!input.holder || node.holder === input.holder) && (!input.topic || memory.topic === input.topic)
      && (!input.search || `${node.title ?? ''}\n${payload.text}\n${memory.topic ?? ''}`.toLowerCase().includes(input.search.toLowerCase()));
  }).sort((a, b) => (b.value_time ?? 0) - (a.value_time ?? 0) || a.id.localeCompare(b.id));
  const entries = matches.slice(input.offset, input.offset + input.limit).map((node) => {
    const memory = memoryOf(node), payload = parseText(node);
    return { nodeId: node.id, subject: node.subject, holder: node.holder, recordedBy: memory.recordedBy,
      kind: payload.kind, title: node.title ?? null, topic: memory.topic ?? null, text: payload.text,
      evidenceType: node.evidence_type, uncertainty: node.uncertainty, authority: node.authority,
      source: memory.source ?? payload.source ?? null, authoringStep: memory.authoringStep,
      observedAt: memory.observedAt ?? null, validFrom: memory.validFrom ?? null, validUntil: memory.validUntil ?? null,
      writtenAgainstModel: memory.writtenAgainstModel, supersededBy: supersededBy.get(node.id) ?? [],
      links: view.edges.filter((edge) => edge.source?.node_id === node.id && edge.relation !== 'contains')
        .map((edge) => ({ relation: edge.relation, target: edge.target })), provenance: node.provenance, accessScopes: node.access_scopes };
  });
  return { schema: 'meaning-model-memory-query/v1', contextId: input.contextId, graphHash, modelHash: boundModelHash(view),
    context: { title: context.title, scope: context.scope, purpose: context.purpose, subjects: context.subjects }, entries,
    window: { offset: input.offset, limit: input.limit, nextOffset: input.offset + entries.length < matches.length ? input.offset + entries.length : null },
    persistence: persistence(service), graphMutation: false, semanticVerification: false,
    limitation: 'These are scoped recorded accounts at this exact branch, not verified current truth. Supersession only follows explicit visible links; disagreement and time remain distinct.' };
}

export async function configureMemoryTranscript(service, raw) {
  bounded(raw); const input = memoryTranscriptConfigureSchema.parse(raw); input.accessScopes = sorted(input.accessScopes);
  const { view, root, graphHash, context } = await transcriptHead(service, input);
  transcriptStatus(view, input.contextId);
  const nodeId = `transcript.setting.${digest([input.contextId, input.requestId])}`;
  const requestDigest = digest({ contextId: input.contextId, enabled: input.enabled, recordedBy: input.recordedBy, accessScopes: input.accessScopes });
  const existing = view.nodes.find((node) => node.id === nodeId);
  if (existing) {
    const payload = transcriptPayload(existing, 'meaning-model-transcript-setting/v1');
    if (payload?.requestDigest !== requestDigest || payload.stateDigest !== nodeStateDigest(existing)) throw new Error('This transcript configuration requestId already names another or subsequently changed setting.');
    return { schema: 'meaning-model-memory-transcript-configure/v1', contextId: input.contextId, graphHash,
      transcript: transcriptStatus(view, input.contextId), reusedExisting: true, graphMutation: false, worldMutation: false };
  }
  const provenance = ['Meaning Model optional transcript setting v1', `recorded-by:${input.recordedBy}`];
  const payload = { schema: 'meaning-model-transcript-setting/v1', contextId: input.contextId, enabled: input.enabled,
    requestId: input.requestId, requestDigest, recordedBy: input.recordedBy, authoringStep: view.graph.revision.number };
  const node = { id: nodeId, node_type: 'transcript.setting', role: 'metadata', text: JSON.stringify(payload), holder: input.recordedBy,
    epistemic_status: 'declared_capture_setting', evidence_type: 'report', uncertainty: { kind: 'unknown' },
    authority: { source: input.recordedBy, weight: 1 }, access_scopes: input.accessScopes, render: 'exclude', training: 'exclude', provenance };
  payload.stateDigest = nodeStateDigest(node); node.text = JSON.stringify(payload);
  const stored = await service.applyNarrativeBatch({ requestId: `transcript.configure.${digest([input.contextId, input.requestId])}`, previousGraphHash: graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: graphHash,
      reason: `${input.enabled ? 'Enable' : 'Disable'} future transcript capture in ${context.title}; retain existing source messages.`, provenance,
      add_roots: [], add_nodes: [node], add_edges: [{ id: `${nodeId}.context`, source: endpoint(nodeId), target: endpoint(root.id), family: 'semantic', relation: 'about', access_scopes: input.accessScopes, provenance }] } });
  return { schema: 'meaning-model-memory-transcript-configure/v1', contextId: input.contextId, graphHash: stored.graphHash,
    transcript: transcriptStatus({ nodes: [...view.nodes, node] }, input.contextId), graphMutation: true, worldMutation: false,
    retainedSourceMessages: true, persistence: persistence(service) };
}

export async function captureMemoryTranscript(service, raw) {
  bounded(raw); const input = memoryTranscriptCaptureSchema.parse(raw); input.accessScopes = sorted(input.accessScopes);
  const { view, root, context, graphHash } = await transcriptHead(service, input);
  const conversationNodeId = `transcript.conversation.${digest([input.contextId, input.conversationId])}`;
  const messageNodeId = (message) => `transcript.message.${digest([input.contextId, input.conversationId, message.messageId])}`;
  const requestDigest = digest({ contextId: input.contextId, conversationId: input.conversationId, source: input.source,
    recordedBy: input.recordedBy, messages: input.messages, accessScopes: input.accessScopes });
  const visible = checkedTranscriptMessages(view).filter(({ payload }) => payload.contextId === input.contextId);
  if (visible.some(({ payload }) => payload.requestId === input.requestId && payload.requestDigest !== requestDigest)) throw new Error('This transcript requestId already names different supplied messages.');
  const known = new Map(view.nodes.map((node) => [node.id, node]));
  const captureDigest = (message) => digest({ contextId: input.contextId, conversationId: input.conversationId, message, source: input.source,
    recordedBy: input.recordedBy, accessScopes: input.accessScopes });
  const additions = input.messages.filter((message) => {
    const existing = known.get(messageNodeId(message));
    if (existing) {
      const payload = transcriptMessage(existing);
      const placement = view.edges.find((edge) => edge.id === `${existing.id}.placement`);
      if (payload?.captureDigest !== captureDigest(message) || payload.stateDigest !== nodeStateDigest(existing)
        || !placement || payload.placementDigest !== edgeStateDigest(placement)) throw new Error(`Transcript message ${message.messageId} conflicts with its stored source or placement; keep the original and record a separate correction.`);
      return false;
    }
    if (visible.some(({ payload }) => payload.conversationId === input.conversationId && payload.message.sequence === message.sequence)) throw new Error(`Transcript sequence ${message.sequence} already belongs to another message in this conversation.`);
    return true;
  });
  const resultBase = { schema: 'meaning-model-memory-transcript-capture/v1', contextId: input.contextId, conversationId: input.conversationId,
    conversationNodeId, messages: input.messages.map((message) => ({ messageId: message.messageId, nodeId: messageNodeId(message), sequence: message.sequence })),
    worldMutation: false, semanticVerification: false };
  if (!additions.length) return { ...resultBase, graphHash, reusedExisting: true, graphMutation: false, transcript: transcriptStatus(view, input.contextId) };
  if (!transcriptStatus(view, input.contextId).enabled) throw new Error('Transcript capture is off for this context. Explicitly enable it with life_memory_transcript_configure before supplying new messages. Existing source messages remain readable.');
  const provenance = ['Meaning Model supplied visible transcript v1', `recorded-by:${input.recordedBy}`, `capture-source:${input.source}`];
  const nodes = [], edges = [];
  const conversation = known.get(conversationNodeId);
  if (conversation) {
    const declaration = transcriptPayload(conversation, 'meaning-model-transcript-conversation/v1');
    if (declaration?.contextId !== input.contextId || declaration.conversationId !== input.conversationId
      || canonical(conversation.access_scopes) !== canonical(input.accessScopes)) throw new Error('The transcript conversation node conflicts with its declared identity or access scopes.');
  } else {
    nodes.push({ id: conversationNodeId, node_type: 'transcript.conversation', role: 'document_root',
      title: `Conversation ${input.conversationId}`, text: JSON.stringify({ schema: 'meaning-model-transcript-conversation/v1', contextId: input.contextId, conversationId: input.conversationId }),
      holder: input.recordedBy, authority: { source: `${input.source}:${input.conversationId}`, weight: 1 },
      epistemic_status: 'supplied_source_document', evidence_type: 'report', access_scopes: input.accessScopes, render: 'exclude', training: 'exclude', provenance });
    edges.push({ id: `${conversationNodeId}.context`, source: endpoint(root.id), target: endpoint(conversationNodeId), family: 'structural', relation: 'contains',
      order: nextPlacementOrder(view, root.id), access_scopes: input.accessScopes, provenance });
  }
  for (const message of additions) {
    const nodeId = messageNodeId(message);
    const edge = { id: `${nodeId}.placement`, source: endpoint(conversationNodeId), target: endpoint(nodeId), family: 'structural', relation: 'contains',
      order: message.sequence, access_scopes: input.accessScopes, provenance };
    const payload = { schema: 'meaning-model-transcript-message/v1', contextId: input.contextId, conversationId: input.conversationId,
      message, source: input.source, recordedBy: input.recordedBy, requestId: input.requestId, requestDigest,
      captureDigest: captureDigest(message), placementDigest: edgeStateDigest(edge), authoringStep: view.graph.revision.number };
    const node = { id: nodeId, node_type: `transcript.${message.role}_message`, role: 'metadata', text: JSON.stringify(payload),
      holder: message.speaker, epistemic_status: 'supplied_source_message', evidence_type: 'report', uncertainty: { kind: 'unknown' },
      authority: { source: `${input.source}:${input.conversationId}:${message.messageId}`, weight: 1 },
      access_scopes: input.accessScopes, render: 'exclude', training: 'exclude', provenance };
    payload.stateDigest = nodeStateDigest(node); node.text = JSON.stringify(payload); nodes.push(node); edges.push(edge);
  }
  const stored = await service.applyNarrativeBatch({ requestId: `transcript.capture.${digest([input.contextId, input.requestId])}`, previousGraphHash: graphHash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: graphHash, reason: `Capture supplied visible source messages in ${context.title}.`, provenance, add_roots: [], add_nodes: nodes, add_edges: edges } });
  return { ...resultBase, graphHash: stored.graphHash, graphMutation: true, addedNodeIds: additions.map(messageNodeId),
    persistence: persistence(service), nextStep: 'Link derived memory or Understanding records to these node IDs through about or existing semantic links. The exact message is source evidence, not an accepted fact; keep interpretation and correction separate.' };
}

export async function queryMemoryTranscript(service, raw) {
  const input = memoryTranscriptQuerySchema.parse(raw);
  const { view, graphHash } = await readContext(service, input);
  const matches = checkedTranscriptMessages(view).filter(({ payload }) => payload.contextId === input.contextId
    && (!input.conversationId || payload.conversationId === input.conversationId) && (!input.role || payload.message.role === input.role)
    && (!input.speaker || payload.message.speaker === input.speaker) && (!input.search || payload.message.text.toLowerCase().includes(input.search.toLowerCase())))
    .sort((a, b) => a.payload.conversationId.localeCompare(b.payload.conversationId) || a.payload.message.sequence - b.payload.message.sequence || a.node.id.localeCompare(b.node.id));
  const messages = matches.slice(input.offset, input.offset + input.limit).map(({ node, payload }) => ({ nodeId: node.id, conversationId: payload.conversationId,
    ...payload.message, timestamp: payload.message.timestamp ?? null, source: payload.source, recordedBy: payload.recordedBy,
    recordedAgainstGraphRevision: payload.authoringStep, accessScopes: node.access_scopes,
    links: view.edges.filter((edge) => edge.source?.node_id === node.id || edge.target?.node_id === node.id)
      .map((edge) => ({ relation: edge.relation, source: edge.source, target: edge.target })) }));
  return { schema: 'meaning-model-memory-transcript-query/v1', contextId: input.contextId, graphHash, modelHash: boundModelHash(view),
    transcript: transcriptStatus(view, input.contextId), messages,
    window: { offset: input.offset, limit: input.limit, nextOffset: input.offset + messages.length < matches.length ? input.offset + messages.length : null },
    graphMutation: false, semanticVerification: false,
    limitation: 'Supplied visible source text at this exact graph revision, ordered by conversation ID and supplied sequence. Timestamps are present only when supplied. The statements are not verified world facts; no hidden reasoning or host history is retrieved.' };
}

export function registerMemoryTools(server, service, { toolResult, entryInstructions = '' }) {
  for (const [name, schema, fn, description, readOnly] of [
    ['life_memory_start', memoryStartSchema, startMemory, `Start or reopen a user-chosen memory context, with explicit subjects and accessScopes. Reuse a native model or create a qualitative process/Event anchor; the starter does not model a full life or workflow. Automatic useful capture is delegated only within this scope during the current work. ${memoryWorkflowInstructions} ${entryInstructions}`, false],
    ['life_memory_record', memoryRecordSchema, recordMemory, 'Append attributed Understanding entries linked to native processes, Events or visible Understanding nodes in the chosen memory context. Use existing thought kinds for hypotheses, expectations, surprises, tensions, decisions and tests, not just facts. Preserve the subject, actual holder and source, uncertainty, and observation/validity dates separately from the authoring step. Stable entry IDs reconcile identical retries across restart. Explicit supersedes replaces an earlier account; a real change over time or disagreement need not supersede it. Advance only to an unambiguous descendant head, or explicitly choose exactRevision.', false],
    ['life_memory_query', memoryQuerySchema, queryMemory, 'Read scoped attributed memory at an exact graph revision or the context\'s sole head. Never choose among branches. Filter by subject, holder, topic or literal text, with bounded pagination; includeSuperseded reveals retained earlier accounts. Returns process/Event/node links, source, uncertainty, time and holder judgments without treating them as verified facts.', true],
    ['life_memory_transcript_configure', memoryTranscriptConfigureSchema, configureMemoryTranscript, 'Explicitly enable or disable visible-message capture in this exact memory scope. Default off; disabling stops future capture and retains existing source messages. The caller supplies messages; the tool has no automatic access to its host chat. Settings are append-only history, separate from world state.', false],
    ['life_memory_transcript_capture', memoryTranscriptCaptureSchema, captureMemoryTranscript, 'Capture explicitly supplied visible user and assistant messages as linkable source-document nodes when this context has opted in. Preserve exact text, supplied sequence, speaker and known timestamps. Never send hidden reasoning, system prompts or tool traffic. Stable IDs reject changed originals and reconcile exact retries; source messages are excluded from rendering, training and derived-memory query. Link interpretations with life_memory_record about or existing semantic links; source statements are not automatically true.', false],
    ['life_memory_transcript_query', memoryTranscriptQuerySchema, queryMemoryTranscript, 'Read a paginated, scoped transcript at an exact graph revision or sole context head, with linkable message node IDs and visible incoming/outgoing edges. Supplied sequence is conversation order; unknown timestamps remain unknown. This reads stored source documents, never host messages or inferred current truth.', true],
  ]) server.registerTool(name, { description, inputSchema: schema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => toolResult(await fn(service, input)));
}
