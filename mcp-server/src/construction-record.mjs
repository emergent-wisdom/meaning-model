// The construction record. The model and its Understanding Graph are the modeler's understanding,
// so what is done and why must be recorded where a later agent can read it: descriptions give an
// Event's numbers their meaning, notes are linked to the records they concern, reviews are held by
// their actual reviewers, and the whole development can be read back as an outline or replayed.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { assertDescribedEvents, descriptionCoverage } from './description-coverage.mjs';
import { constructionRecordInstructions } from './construction-principles.mjs';
import { additiveNarrativeBatch, applyNarrativeDefinitionDelta, definitionFromCompleteView, narrativeDefinitionDelta } from './narrative-delta.mjs';
import { recordsQuoting, removedFragments, textRecords } from './prose-drift.mjs';

const id = z.string().trim().min(1).max(256);
const longId = z.string().trim().min(1).max(1_024);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeList = z.array(id).min(1).max(64);
const prose = z.string().min(1).max(64_000).refine((text) => text.trim().length > 0, 'Text must not be blank.');
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;
const canonical = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item));
const slug = (value) => value.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 80);
const clip = (text, limit) => (typeof text !== 'string' ? '' : text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`);
const oneLine = (text) => (typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : '');

// ---------------------------------------------------------------------------------------------
// Descriptions give numbers meaning.

export { assertDescribedEvents, constructionRecordInstructions, descriptionCoverage };

// ---------------------------------------------------------------------------------------------
// Targets: model records by kind and id, or graph nodes.

const recordKinds = Object.freeze({
  model: 'model', process: 'process', claim: 'claim', law: 'law', dependency: 'dependency', decomposition: 'decomposition',
  concept: 'concept', abstract_relation: 'abstract_relation', abstract_cut: 'abstract_cut', referent: 'referent',
  encapsulation_cut: 'encapsulation_cut', event: 'event', event_relation: 'event_relation', binding: 'event_referent_binding',
  physical_cut: 'physical_cut', realization: 'realization', cut: 'normalized_cut',
});
const recordCollections = Object.freeze({
  process: (model) => model.processes, claim: (model) => model.initial_claims, law: (model) => model.laws,
  dependency: (model) => model.dependencies, decomposition: (model) => model.decomposition,
  concept: (model) => model.meaning_model?.concepts, abstract_relation: (model) => model.meaning_model?.abstract_relations,
  abstract_cut: (model) => model.meaning_model?.abstract_cuts, referent: (model) => model.meaning_model?.referents,
  encapsulation_cut: (model) => model.meaning_model?.encapsulation_cuts, event: (model) => model.meaning_model?.events,
  event_relation: (model) => model.meaning_model?.event_relations, binding: (model) => model.meaning_model?.event_referent_bindings,
  physical_cut: (model) => model.meaning_model?.physical_cuts, realization: (model) => model.meaning_model?.realizations,
  cut: (model) => model.meaning_model?.normalized_cuts,
});
export const targetSchema = z.union([
  z.object({
    record: z.string().trim().regex(new RegExp(`^(${Object.keys(recordKinds).join('|')}):.+$`, 'u'), 'A record target is kind:id, for example event:ev.launch or cut:cut.q1.'),
    path: z.string().max(1_024).regex(/^\//u, 'A path is a JSON Pointer into the record.').optional(),
    modelHash: z.string().regex(/^[a-f0-9]{64}$/u).optional().describe('A record of another stored model (an author\'s life, a concept definition, another world); omit for the graph\'s own model.'),
  }).strict(),
  z.object({ nodeId: longId }).strict(),
]);
// A record of another stored model, held in this graph by a reference node, so a note can be about records of several
// models together: an author's life, a concept definition and the story world. Models can be started and referenced
// however the work needs.
export const MODEL_REFERENCE_SCHEMA = 'meaning-model-model-reference/v1';
export const isExternalTarget = (target, boundHash) => Boolean(target?.record && target.modelHash && target.modelHash !== boundHash);
export const modelReferenceNodeId = (modelHash, record) => `ref.${modelHash.slice(0, 16)}.${record.replace(/[^A-Za-z0-9._-]/gu, '_')}`.slice(0, 250);
export async function externalRecordNode(service, target, { scopes, provenance, placeUnder = null, order = 0, known }) {
  const inspected = await service.inspectModel({ modelHash: target.modelHash, includeDefinition: true }).catch(() => null);
  if (!inspected?.model) throw new Error(`Model ${target.modelHash.slice(0, 12)} is not a stored model; register it before referencing its records.`);
  const { kind, recordId } = splitRecord(target.record);
  const found = findRecord(inspected.model, kind, recordId, target.modelHash);
  if (!found) throw new Error(`${target.record} is not a record of model ${target.modelHash.slice(0, 12)}.`);
  const nodeId = modelReferenceNodeId(target.modelHash, target.record);
  if (known.has(nodeId)) return { nodeId, nodes: [], edges: [] };
  known.add(nodeId);
  const summary = String(found.description ?? found.boundary ?? found.question ?? found.id ?? '').slice(0, 400);
  const node = { id: nodeId, node_type: 'model_reference', role: 'metadata', title: `${target.record} in model ${inspected.model.id ?? target.modelHash.slice(0, 12)}`,
    text: JSON.stringify({ schema: MODEL_REFERENCE_SCHEMA, modelHash: target.modelHash, modelId: inspected.model.id ?? null, record: target.record, ...(target.path ? { path: target.path } : {}), summary }),
    epistemic_status: 'model_reference', evidence_type: 'report', authority: { source: `model:${target.modelHash}`, weight: 1 }, uncertainty: { kind: 'unknown' },
    access_scopes: scopes, render: 'exclude', training: 'exclude', provenance };
  const edges = placeUnder ? [{ id: `${nodeId}.placement`, source: { kind: 'node', node_id: placeUnder }, target: { kind: 'node', node_id: nodeId },
    family: 'structural', relation: 'contains', order, access_scopes: scopes, provenance }] : [];
  return { nodeId, nodes: [node], edges };
}

function splitRecord(record) {
  const index = record.indexOf(':');
  return { kind: record.slice(0, index), recordId: record.slice(index + 1) };
}
function findRecord(model, kind, recordId, modelHash = null) {
  if (kind === 'model') return recordId === model.id || recordId === modelHash ? model : null;
  return (recordCollections[kind]?.(model) ?? []).find((record) => record.id === recordId) ?? null;
}
export function recordAnchorEndpoint(model, target, label, modelHash = null) { return recordEndpoint(model, target, label, modelHash); }
// The model record an anchor names, or null; undefined when the anchor kind is not a model record (worlds, candidates).
export function anchoredModelRecord(model, anchorKind, anchorId, modelHash = null) {
  const kind = Object.entries(recordKinds).find(([, value]) => value === anchorKind)?.[0];
  if (!kind) return undefined;
  return findRecord(model, kind, anchorId, modelHash);
}
function recordEndpoint(model, target, label, modelHash = null) {
  const { kind, recordId } = splitRecord(target.record);
  if (!findRecord(model, kind, recordId, modelHash)) throw new Error(`${label} names ${target.record}, which is not a record of the bound model.`);
  return { kind: 'anchor', anchor_kind: recordKinds[kind], anchor_id: recordId, ...(target.path ? { path: target.path } : {}) };
}
export const linkRelations = Object.freeze(['about', 'supports', 'contradicts', 'refines', 'answers', 'learned_from', 'supersedes', 'shaped_by']);

// ---------------------------------------------------------------------------------------------
// Shared graph reading and writing.

async function readGraph(service, graphHash, accessScopes) {
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true,
    accessScopes: [...new Set(accessScopes)].sort() });
  if (view.graph_hash !== graphHash || !view.content_included) throw new Error('The construction record requires the exact graph with content.');
  if (!Number.isSafeInteger(view.graph.revision?.number) || view.graph.revision.number < 0) throw new Error('The graph needs a safe revision clock.');
  return view;
}
const boundModelHash = (view) => view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
async function boundModel(service, view) {
  const modelHash = boundModelHash(view);
  if (!modelHash) throw new Error('The graph is not bound to a model, so model records cannot be linked.');
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  return { modelHash, model };
}
function nextOrder(view, parentId) {
  const orders = view.edges.filter((edge) => edge.relation === 'contains' && edge.source?.node_id === parentId).map((edge) => edge.order);
  const valid = orders.filter((order) => Number.isSafeInteger(order) && order >= 0);
  return valid.length ? Math.max(...valid) + 1 : 0;
}
function bounded(value, label) {
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new Error(`${label} exceeds 512 KiB; split it into several records.`);
}
function ensureRoot(view, { rootId, holder, clock, label, purpose, scopes, provenance }) {
  const existing = view.nodes.find((node) => node.id === rootId);
  if (existing) {
    if (existing.node_type !== 'understanding_process_root') throw new Error(`${rootId} exists but is not an understanding root.`);
    let declared = null;
    try { declared = JSON.parse(existing.text); } catch { declared = null; }
    if (declared?.clock && declared.clock !== clock) throw new Error(`${rootId} uses the ${declared.clock} clock, not ${clock}.`);
    return { rootId, nodes: [], roots: [] };
  }
  return { rootId, roots: [rootId], nodes: [{ id: rootId, node_type: 'understanding_process_root', role: 'metadata', title: label,
    text: JSON.stringify({ name: label, holder, clock, purpose }), holder, epistemic_status: 'authored_process', evidence_type: 'belief',
    authority: { source: holder, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: scopes, render: 'exclude', training: 'exclude', provenance }] };
}

// A holder's own understanding root: every note a holder records lands here, whichever tool records it.
export function holderRootId(holder, clock = 'authoring_step') {
  return `understanding.${slug(holder)}${clock === 'story_time' ? '.story-time' : ''}`;
}
export function ensureHolderRoot(view, { holder, clock = 'authoring_step', label = null, scopes, provenance }) {
  return ensureRoot(view, { rootId: holderRootId(holder, clock), holder, clock, scopes, provenance,
    label: label ?? `Understanding held by ${holder}`,
    purpose: clock === 'story_time' ? `What ${holder} thinks within the story, in world time.` : `The reasoning of ${holder} while constructing and revising this model and graph.` });
}
export { nextOrder as nextPlacementOrder };

// ---------------------------------------------------------------------------------------------
// Understanding records: a thought, linked to what it is about.

export const noteKinds = Object.freeze(['question', 'hypothesis', 'prediction', 'interpretation', 'reason', 'criticism', 'revision',
  'decision', 'idea', 'reference', 'voice', 'plan', 'observation', 'estimate']);
export const understandingRecordSchema = z.object({
  graphHash: hash, requestId: id, accessScopes: scopeList,
  holder: id, recordedBy: id.optional(),
  clock: z.enum(['authoring_step', 'story_time']).default('authoring_step'),
  rootLabel: z.string().trim().min(1).max(200).optional(),
  notes: z.array(z.object({
    nodeId: longId, kind: z.enum(noteKinds), text: prose, title: z.string().trim().min(1).max(300).optional(),
    about: z.array(targetSchema).max(32).default([]),
    links: z.array(z.object({ relation: z.enum(linkRelations), targetNodeId: longId }).strict()).max(64).default([]),
    valueTime: z.number().finite().optional(),
    data: z.json().optional(),
  }).strict()).min(1).max(32),
}).strict().superRefine((input, context) => {
  const ids = input.notes.map((note) => note.nodeId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['notes'], message: 'Note IDs must be unique.' });
  for (const [index, note] of input.notes.entries()) {
    if (!note.about.length && !note.links.length) context.addIssue({ code: 'custom', path: ['notes', index], message: 'A note must be about something: give at least one about target or link.' });
    if (input.clock === 'story_time' && note.valueTime === undefined) context.addIssue({ code: 'custom', path: ['notes', index, 'valueTime'], message: 'A story-time note needs its valueTime in world time.' });
  }
});

export async function recordUnderstanding(service, raw) {
  bounded(raw, 'An understanding record');
  const input = understandingRecordSchema.parse(raw);
  const scopes = [...new Set(input.accessScopes)].sort();
  const view = await readGraph(service, input.graphHash, scopes);
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
  const graphModelHash = boundModelHash(view);
  const needsModel = input.notes.some((note) => note.about.some((target) => target.record && !isExternalTarget(target, graphModelHash)));
  const { modelHash, model } = needsModel ? await boundModel(service, view) : { modelHash: graphModelHash, model: null };
  const knownReferences = new Set(view.nodes.filter((node) => node.node_type === 'model_reference').map((node) => node.id));
  const step = view.graph.revision.number;
  const recordedBy = input.recordedBy ?? input.holder;
  const provenance = ['Meaning Model understanding record v1', `holder:${input.holder}`, `recorded-by:${recordedBy}`, `clock:${input.clock}`,
    ...(modelHash ? [`written-against-model:${modelHash}`] : []), `written-at-graph-revision:${step}`];
  const rootId = holderRootId(input.holder, input.clock);
  const root = ensureHolderRoot(view, { holder: input.holder, clock: input.clock, label: input.rootLabel ?? null, scopes, provenance });
  let order = nextOrder(view, rootId);
  const nodes = [...root.nodes]; const edges = [];
  const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
  for (const note of input.notes) {
    if (nodesById.has(note.nodeId)) throw new Error(`Node ${note.nodeId} already exists; use a new ID and link it with supersedes.`);
    let noteScopes = scopes;
    for (const targetNodeId of [...note.about.filter((target) => target.nodeId).map((target) => target.nodeId), ...note.links.map((link) => link.targetNodeId)]) {
      const target = nodesById.get(targetNodeId) ?? nodes.find((node) => node.id === targetNodeId) ?? (input.notes.some((other) => other.nodeId === targetNodeId) ? { access_scopes: [] } : null);
      if (!target) throw new Error(`Note ${note.nodeId} links to unknown or inaccessible node ${targetNodeId}.`);
      if (target.access_scopes?.length) noteScopes = noteScopes.filter((scope) => target.access_scopes.includes(scope));
    }
    if (!noteScopes.length) throw new Error(`Note ${note.nodeId} and its targets share no access scope.`);
    const payload = { schema: 'meaning-model-understanding-note/v1', kind: note.kind, text: note.text, ...(note.data === undefined ? {} : { data: note.data }) };
    nodes.push({ id: note.nodeId, node_type: `understanding.${note.kind}`, role: 'externalized_reflection', ...(note.title ? { title: note.title } : {}),
      text: JSON.stringify(payload), holder: input.holder, epistemic_status: 'externalized_reflection', evidence_type: 'belief',
      authority: { source: input.holder, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: noteScopes,
      render: 'exclude', training: 'exclude', value_time: note.valueTime ?? step, provenance });
    const edge = (suffix, target, family, relation, extra = {}) => edges.push({ id: `${note.nodeId}.${suffix}`, source: endpoint(note.nodeId), target, family, relation, access_scopes: noteScopes, provenance, ...extra });
    edges.push({ id: `${note.nodeId}.placement`, source: endpoint(rootId), target: endpoint(note.nodeId), family: 'structural', relation: 'contains', order: order++, access_scopes: noteScopes, provenance });
    for (const [index, target] of note.about.entries()) {
      if (isExternalTarget(target, modelHash)) {
        const reference = await externalRecordNode(service, target, { scopes: noteScopes, provenance, placeUnder: rootId, order: order++, known: knownReferences });
        nodes.push(...reference.nodes); edges.push(...reference.edges);
        edge(`about.${index}`, endpoint(reference.nodeId), 'semantic', 'about');
      } else if (target.record) edge(`about.${index}`, recordEndpoint(model, target, `Note ${note.nodeId}`, modelHash), 'grounding', 'about');
      else edge(`about.${index}`, endpoint(target.nodeId), 'semantic', 'about');
    }
    for (const [index, link] of note.links.entries()) edge(`link.${index}`, endpoint(link.targetNodeId), 'semantic', link.relation);
  }
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: {
    schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash,
    reason: `Record ${input.notes.length} understanding note${input.notes.length === 1 ? '' : 's'} held by ${input.holder}.`, provenance,
    add_roots: root.roots, add_nodes: nodes, add_edges: edges } });
  return { schema: 'meaning-model-understanding-record/v1', graphHash: stored.graphHash, previousGraphHash: input.graphHash,
    understandingRootId: rootId, nodeIds: input.notes.map((note) => note.nodeId), authoringStep: step, writtenAgainstModel: modelHash,
    graphMutation: true, worldMutation: false, semanticVerification: false,
    nextStep: 'Keep recording as you work: choices, ideas, predictions and their reasons, linked to what they concern. A later agent reads them through life_construction_replay and life_model_outline.' };
}

// ---------------------------------------------------------------------------------------------
// Reviews, held by the actual reviewer.

export const reviewRecordSchema = z.object({
  graphHash: hash, requestId: id, accessScopes: scopeList, nodeId: longId,
  reviewer: z.object({ id, kind: z.enum(['model', 'human', 'estimator', 'tool']), model: id.optional(), family: id.optional(), label: z.string().trim().min(1).max(300).optional() }).strict(),
  recordedBy: id,
  independence: z.enum(['blind', 'informed', 'self']),
  reviewed: z.object({
    graphHash: hash.optional(), rootId: longId.optional(), nodeIds: z.array(longId).max(64).default([]),
    materials: z.enum(['rendered_text', 'text_and_records', 'records', 'graph', 'external']),
    textSha256: hash.optional(), description: z.string().trim().min(1).max(4_000).optional(),
  }).strict(),
  prompt: z.object({ text: z.string().min(1).max(64_000).optional(), sha256: hash.optional() }).strict().optional(),
  review: z.object({
    text: prose, verdict: z.string().trim().min(1).max(2_000).optional(),
    findings: z.array(z.object({ text: z.string().trim().min(1).max(8_000), quote: z.string().max(4_000).optional(),
      severity: z.enum(['error', 'major', 'minor', 'note']).optional(), category: id.optional() }).strict()).max(200).default([]),
  }).strict(),
  about: z.array(targetSchema).max(32).default([]),
  links: z.array(z.object({ relation: z.enum(linkRelations), targetNodeId: longId }).strict()).max(64).default([]),
}).strict().superRefine((input, context) => {
  if (input.prompt?.text && input.prompt.sha256 && sha256(input.prompt.text) !== input.prompt.sha256) context.addIssue({ code: 'custom', path: ['prompt'], message: 'prompt.sha256 does not match prompt.text.' });
  if (input.independence === 'blind' && !['rendered_text', 'external'].includes(input.reviewed.materials)) context.addIssue({ code: 'custom', path: ['independence'], message: 'A blind review sees only the text; its materials are rendered_text or external.' });
  if (input.reviewed.materials === 'external' && (input.reviewed.graphHash || input.reviewed.rootId)) context.addIssue({ code: 'custom', path: ['reviewed'], message: 'A review of external material read no graph revision or root; describe the material in reviewed.description instead.' });
});

export async function recordReview(service, raw) {
  bounded(raw, 'A review record');
  const input = reviewRecordSchema.parse(raw);
  const scopes = [...new Set(input.accessScopes)].sort();
  const view = await readGraph(service, input.graphHash, scopes);
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
  if (nodesById.has(input.nodeId)) throw new Error(`Node ${input.nodeId} already exists; use a new ID and link it with supersedes.`);
  const reviewedGraphHash = input.reviewed.graphHash ?? input.graphHash;
  const reviewedView = reviewedGraphHash === input.graphHash ? view : await readGraph(service, reviewedGraphHash, scopes);
  let render = null;
  if (input.reviewed.rootId) {
    if (!reviewedView.nodes.some((node) => node.id === input.reviewed.rootId)) throw new Error(`Reviewed root ${input.reviewed.rootId} is not in the reviewed graph revision.`);
    const rendered = await service.renderNarrativeGraph({ graphHash: reviewedGraphHash, expectedGraphHash: reviewedGraphHash, rootIds: [input.reviewed.rootId], accessScopes: scopes });
    render = { sha256: sha256(rendered.text), words: rendered.text.split(/\s+/u).filter(Boolean).length };
  }
  const textMatchesRender = render && input.reviewed.textSha256 ? render.sha256 === input.reviewed.textSha256 : null;
  const graphModelHash = boundModelHash(view);
  const bound = input.about.some((target) => target.record && !isExternalTarget(target, graphModelHash)) ? await boundModel(service, view) : { model: null, modelHash: graphModelHash };
  const model = bound.model;
  const knownReferences = new Set(view.nodes.filter((node) => node.node_type === 'model_reference').map((node) => node.id));
  const step = view.graph.revision.number;
  // A review of material outside the graph read no graph revision; it only was recorded at one.
  const external = input.reviewed.materials === 'external';
  const provenance = ['Meaning Model review record v1', `reviewer:${input.reviewer.id}`, `recorded-by:${input.recordedBy}`,
    `independence:${input.independence}`, external ? 'reviewed-material:external' : `reviewed-graph:${reviewedGraphHash}`, `written-at-graph-revision:${step}`];
  const rootId = `review.${slug(input.reviewer.id)}`;
  const root = ensureRoot(view, { rootId, holder: input.reviewer.id, clock: 'authoring_step', scopes, provenance,
    label: `Reviews by ${input.reviewer.label ?? input.reviewer.id}`, purpose: `Reviews held by ${input.reviewer.id}, recorded with what it was given and which revision it read.` });
  const payload = { schema: 'meaning-model-review/v1', kind: 'review', text: input.review.text,
    data: { reviewer: input.reviewer, recordedBy: input.recordedBy, independence: input.independence,
      reviewed: external ? { ...input.reviewed, recordedAtGraphHash: input.graphHash, recordedAtRevision: step }
        : { ...input.reviewed, graphHash: reviewedGraphHash, revision: reviewedView.graph.revision.number, ...(render ? { renderSha256: render.sha256, renderWords: render.words } : {}), textMatchesRender },
      prompt: input.prompt ? { sha256: input.prompt.sha256 ?? (input.prompt.text ? sha256(input.prompt.text) : null), ...(input.prompt.text ? { text: input.prompt.text } : {}) } : null,
      verdict: input.review.verdict ?? null, findings: input.review.findings } };
  const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
  const nodes = [...root.nodes, { id: input.nodeId, node_type: 'review', role: 'externalized_reflection', title: `Review by ${input.reviewer.label ?? input.reviewer.id}`,
    text: JSON.stringify(payload), holder: input.reviewer.id, epistemic_status: 'attributed_review', evidence_type: 'belief',
    authority: { source: input.reviewer.id, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: scopes,
    render: 'exclude', training: 'exclude', value_time: step, provenance }];
  const edges = [{ id: `${input.nodeId}.placement`, source: endpoint(rootId), target: endpoint(input.nodeId), family: 'structural', relation: 'contains', order: nextOrder(view, rootId), access_scopes: scopes, provenance }];
  const edge = (suffix, target, family, relation) => edges.push({ id: `${input.nodeId}.${suffix}`, source: endpoint(input.nodeId), target, family, relation, access_scopes: scopes, provenance });
  // Link to the reviewed material that still exists in the current revision.
  const reviewedNodes = [...new Set([input.reviewed.rootId, ...input.reviewed.nodeIds].filter(Boolean))];
  for (const [index, nodeId] of reviewedNodes.entries()) if (nodesById.has(nodeId)) edge(`reviews.${index}`, endpoint(nodeId), 'semantic', 'about');
  for (const [index, target] of input.about.entries()) {
    if (isExternalTarget(target, bound.modelHash)) {
      const reference = await externalRecordNode(service, target, { scopes, provenance, placeUnder: rootId, order: nextOrder(view, rootId) + 1 + index, known: knownReferences });
      nodes.push(...reference.nodes); edges.push(...reference.edges);
      edge(`about.${index}`, endpoint(reference.nodeId), 'semantic', 'about');
    } else if (target.record) edge(`about.${index}`, recordEndpoint(model, target, `Review ${input.nodeId}`, bound.modelHash), 'grounding', 'about');
    else if (nodesById.has(target.nodeId)) edge(`about.${index}`, endpoint(target.nodeId), 'semantic', 'about');
    else throw new Error(`Review ${input.nodeId} is about unknown node ${target.nodeId}.`);
  }
  for (const [index, link] of input.links.entries()) {
    if (!nodesById.has(link.targetNodeId)) throw new Error(`Review ${input.nodeId} links to unknown node ${link.targetNodeId}.`);
    edge(`link.${index}`, endpoint(link.targetNodeId), 'semantic', link.relation);
  }
  // A first review by a new reviewer connects to the graph only through what it is about.
  if (root.nodes.length && edges.length === 1) throw new Error(`Review ${input.nodeId} is about nothing in the graph; give about (model records or nodes), links, or reviewed.rootId or nodeIds, so it is linked to what it reviews.`);
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: {
    schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash,
    // A review of material outside the graph (an evidence packet, a file) names what it read, not a graph revision it never saw.
    reason: input.reviewed.materials === 'external'
      ? `Record a review by ${input.reviewer.id} of external material${input.reviewed.description ? ` (${clip(oneLine(input.reviewed.description), 160)})` : ''}, recorded at graph revision ${view.graph.revision.number}.`
      : `Record a review by ${input.reviewer.id} of graph revision ${reviewedView.graph.revision.number}.`, provenance,
    add_roots: root.roots, add_nodes: nodes, add_edges: edges } });
  return { schema: 'meaning-model-review-record/v1', graphHash: stored.graphHash, previousGraphHash: input.graphHash, reviewNodeId: input.nodeId,
    reviewerRootId: rootId, reviewedGraphHash: external ? null : reviewedGraphHash, reviewedRevision: external ? null : reviewedView.graph.revision.number, render, textMatchesRender,
    graphMutation: true, worldMutation: false,
    nextStep: 'When a later change answers this review, record the reason with a note that links to it with answers, so the replay shows what the review changed.' };
}

// ---------------------------------------------------------------------------------------------
// Reading notes back: payloads, summaries of the records they concern.

export function notePayload(node) {
  if (typeof node?.text !== 'string') return { kind: null, text: '' };
  let parsed = null;
  try { parsed = JSON.parse(node.text); } catch { return { kind: null, text: node.text }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: null, text: node.text };
  if (typeof parsed.text === 'string') return { kind: parsed.kind ?? null, text: parsed.text, data: parsed.data };
  // Records stored as JSON without prose (audits, depth reviews, alien records, bundles) show their title and their most
  // readable field, at the top level or in their data: a decision and its rationale, a world's principle, a mechanism's
  // operator, a candidate's design principles, a statement, a rationale or a text.
  const data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : {};
  const title = nonblank(node.title) ? oneLine(node.title) : null;
  const verdict = nonblank(data.decision?.verdict) && !(title ?? '').includes(data.decision.verdict) ? `${data.decision.verdict}: ` : '';
  const decision = nonblank(data.decision?.rationale) ? `${verdict}${data.decision.rationale}` : null;
  const readable = [parsed.summary, parsed.coverage, parsed.rationale, parsed.assessment, parsed.explanation, parsed.verdict, parsed.reason, parsed.purpose,
    parsed.question, parsed.statement, data.summary, decision, data.principle, data.operator, data.candidate?.design_principles, data.statement,
    data.rationale, data.text, data.note].find(nonblank);
  const titled = (text) => (title && !text.startsWith(title) ? `${title}: ${text}` : text);
  return { kind: parsed.kind ?? null, readable: Boolean(readable), data: parsed,
    text: readable ? titled(readable) : titled(`${parsed.schema ?? 'structured record'} (${Object.keys(parsed).slice(0, 8).join(', ')})`) };
}
// What a note says first: a review leads with its verdict, any other note with its text.
export function noteGist(payload) {
  const verdict = payload.kind === 'review' && nonblank(payload.data?.verdict) ? oneLine(payload.data.verdict) : null;
  if (!verdict) return payload.text;
  return `Verdict: ${/[.!?]$/u.test(verdict) ? verdict : `${verdict}.`} ${payload.text}`;
}
function recordSummary(model, anchorKind, anchorId, limit) {
  const kind = Object.entries(recordKinds).find(([, value]) => value === anchorKind)?.[0] ?? anchorKind;
  const record = model ? findRecord(model, kind === 'model' ? 'model' : kind, anchorId) : null;
  if (!record) return `${kind}:${anchorId}`;
  if (kind === 'event') return `event:${anchorId} "${clip(oneLine(record.boundary), limit)}"${nonblank(record.description) ? ` — ${clip(oneLine(record.description), limit)}` : ' (no description)'}`;
  if (kind === 'cut') return `cut:${anchorId} "${clip(oneLine(record.question), limit)}" ${cutAnswers(record)}`;
  if (kind === 'process') return `process:${anchorId} (${record.unit ?? 'no unit'}) ${clip(oneLine(record.scale?.semantic_role ?? ''), limit)}`;
  const text = record.boundary ?? record.label ?? record.description ?? record.lens ?? '';
  return `${kind}:${anchorId}${text ? ` "${clip(oneLine(text), limit)}"` : ''}`;
}
function cutAnswers(cut) {
  return `→ ${(cut.answers ?? []).map((answer) => `${answer.key} ${Number(answer.weight).toFixed(2)}`).join(', ')}${cut.conditioning ? ` [within ${cut.conditioning.cut_id}:${cut.conditioning.answer_key}]` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Outline: the present state at a chosen depth.

export const outlineSchema = z.object({
  graphHash: hash.optional(), modelHash: hash.optional(),
  accessScopes: z.array(id).max(64).default([]),
  understanding: z.enum(['none', 'count', 'first_line', 'full']).default('first_line'),
  sections: z.array(z.enum(['coverage', 'things', 'events', 'processes', 'concepts', 'understanding', 'documents'])).min(1).max(7)
    .default(['coverage', 'things', 'events', 'processes', 'concepts', 'understanding', 'documents']),
  focusEventId: longId.optional(),
  textLimit: z.number().int().min(40).max(4_000).default(240),
  maxChars: z.number().int().min(2_000).max(400_000).default(60_000),
}).strict().refine((input) => Boolean(input.graphHash || input.modelHash), 'Supply graphHash (the graph and its bound model, with notes) or modelHash (a model alone); both only when the graph is bound to that model.');

function anchoredNotes(view) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const byRecord = new Map();
  for (const edge of view.edges) {
    if (edge.source?.kind !== 'node' || edge.target?.kind !== 'anchor') continue;
    const node = nodes.get(edge.source.node_id);
    if (!node || node.role === 'story_passage') continue;
    const key = `${edge.target.anchor_kind}:${edge.target.anchor_id}`;
    if (!byRecord.has(key)) byRecord.set(key, []);
    if (!byRecord.get(key).includes(node)) byRecord.get(key).push(node);
  }
  return byRecord;
}
// A withdrawn record stays in the model as history; the outline says so where it lists it.
function withdrawnMark(record, limit) {
  if (!record?.withdrawn) return '';
  const replaced = (record.withdrawn.superseded_by ?? []).length ? `; superseded by ${record.withdrawn.superseded_by.join(', ')}` : '';
  return ` [withdrawn: ${clip(oneLine(record.withdrawn.reason ?? ''), limit)}${replaced}]`;
}

// Links from later notes to a note or review, by relation, counted from one graph revision.
function responsesTo(view) {
  const responses = new Map();
  for (const edge of view?.edges ?? []) if (edge.source?.kind === 'node' && edge.target?.kind === 'node' && ['answers', 'contradicts', 'supersedes', 'refines'].includes(edge.relation)) {
    if (!responses.has(edge.target.node_id)) responses.set(edge.target.node_id, {});
    const counts = responses.get(edge.target.node_id); counts[edge.relation] = (counts[edge.relation] ?? 0) + 1;
  }
  return responses;
}
function noteLine(node, level, limit, responses = null) {
  const payload = notePayload(node);
  const text = noteGist(payload);
  const label = `${node.node_type}${node.holder ? ` by ${node.holder}` : ''}`;
  const findings = payload.kind === 'review' && Array.isArray(payload.data?.findings) ? payload.data.findings.length : 0;
  const counts = responses?.get(node.id);
  const extra = [findings ? `${findings} finding${findings === 1 ? '' : 's'}` : null,
    counts ? `later: ${Object.entries(counts).map(([relation, count]) => `${count} ${relation}`).join(', ')}` : null].filter(Boolean);
  const suffix = extra.length ? ` [${extra.join('; ')}]` : '';
  if (level === 'full') return `${node.id} [${label}]: ${text}${suffix}`;
  return `${node.id} [${label}]: ${clip(oneLine(text), limit)}${suffix}`;
}

// Reading notes whole: each named note or review with its parsed payload and the links into and out of it,
// without the neighborhood around it.
export const noteReadSchema = z.object({
  graphHash: hash, accessScopes: z.array(id).max(64).default([]),
  nodeIds: z.array(z.string().trim().min(1).max(1_024)).min(1).max(32),
}).strict();
export async function readNotes(service, raw) {
  const input = noteReadSchema.parse(raw);
  const view = await readGraph(service, input.graphHash, input.accessScopes);
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const describe = (endpoint) => (endpoint?.kind === 'node' ? endpoint.node_id : `${endpoint?.anchor_kind}:${endpoint?.anchor_id}${endpoint?.path ?? ''}`);
  const notes = input.nodeIds.map((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node) return { id: nodeId, found: false, reason: 'unknown, or hidden by these access scopes' };
    const payload = notePayload(node);
    return { id: node.id, found: true, nodeType: node.node_type, role: node.role, holder: node.holder ?? null, title: node.title ?? null,
      kind: payload.kind, text: payload.text, data: payload.data?.data ?? payload.data ?? null, valueTime: node.value_time ?? null,
      provenance: node.provenance ?? [], accessScopes: node.access_scopes ?? [],
      linksOut: view.edges.filter((edge) => edge.source?.kind === 'node' && edge.source.node_id === nodeId && edge.relation !== 'contains').map((edge) => ({ relation: edge.relation, target: describe(edge.target) })),
      linksIn: view.edges.filter((edge) => edge.target?.kind === 'node' && edge.target.node_id === nodeId && edge.relation !== 'contains').map((edge) => ({ relation: edge.relation, source: describe(edge.source) })) };
  });
  return { schema: 'meaning-model-note-read/v1', graphHash: input.graphHash, notes };
}

export async function outlineModel(service, raw) {
  const input = outlineSchema.parse(raw);
  const view = input.graphHash ? await readGraph(service, input.graphHash, input.accessScopes) : null;
  if (view && input.modelHash && boundModelHash(view) !== input.modelHash) {
    throw new Error(`Graph ${input.graphHash.slice(0, 12)} is bound to model ${String(boundModelHash(view)).slice(0, 12)}, not ${input.modelHash.slice(0, 12)}; pass graphHash alone to outline its bound model with its notes, or modelHash alone.`);
  }
  const modelHash = input.modelHash ?? boundModelHash(view);
  if (!modelHash) throw new Error('The graph is not bound to a model; outline a model by modelHash instead.');
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const layer = model.meaning_model ?? {};
  const want = new Set(input.sections);
  const lines = [];
  const notes = view && input.understanding !== 'none' ? anchoredNotes(view) : new Map();
  const responses = responsesTo(view);
  // A note linked to several records is shown once; the later records name it.
  const shown = new Set();
  const noteLines = (list, indent) => {
    const again = [];
    for (const node of list) {
      if (shown.has(node.id)) { again.push(node.id); continue; }
      shown.add(node.id);
      lines.push(`${indent}✎ ${noteLine(node, input.understanding, input.textLimit, responses)}`);
    }
    if (again.length) lines.push(`${indent}✎ also ${again.join(', ')} (shown above)`);
  };
  const attach = (anchorKind, recordId, indent) => {
    const list = notes.get(`${anchorKind}:${recordId}`) ?? [];
    if (!list.length) return;
    if (input.understanding === 'count') { lines.push(`${indent}  (${list.length} note${list.length === 1 ? '' : 's'})`); return; }
    noteLines(list, `${indent}  `);
  };
  lines.push(`# Model ${model.id}, revision ${model.revision?.number ?? '?'} (${modelHash.slice(0, 12)})`);
  if (model.revision?.reason) lines.push(`Revision reason: ${clip(oneLine(model.revision.reason), input.textLimit * 2)}`);
  if (view) lines.push(`Graph ${view.graph.id}, revision ${view.graph.revision.number} (${view.graph_hash.slice(0, 12)}): ${view.nodes.length} nodes, ${view.edges.length} edges.`);
  const coverage = descriptionCoverage(model);
  if (want.has('coverage')) {
    lines.push('', '## Descriptions', `${coverage.described} of ${coverage.events} Events are described; ${coverage.eventsWithCuts} ${coverage.eventsWithCuts === 1 ? 'carries' : 'carry'} Cuts.`);
    if (coverage.undescribedNumbers.length) lines.push(`Undescribed Events that carry numbers: ${coverage.undescribedNumbers.map((entry) => entry.eventId).join(', ')}.`);
  }
  if (want.has('things') && (layer.referents ?? []).length) {
    lines.push('', '## Things');
    for (const referent of layer.referents) { lines.push(`- ${referent.id}: ${clip(oneLine(referent.boundary), input.textLimit)}`); attach('referent', referent.id, ''); }
  }
  if (want.has('events') && (layer.events ?? []).length) {
    lines.push('', '## Events');
    const events = new Map(layer.events.map((event) => [event.id, event]));
    const children = new Map(); const parents = new Map();
    for (const relation of layer.event_relations ?? []) if (relation.kind === 'contains') {
      if (!children.has(relation.source_event_id)) children.set(relation.source_event_id, []);
      children.get(relation.source_event_id).push(relation.target_event_id);
      parents.set(relation.target_event_id, relation.source_event_id);
    }
    const cutsByEvent = new Map();
    for (const cut of layer.normalized_cuts ?? []) { if (!cutsByEvent.has(cut.parent_event_id)) cutsByEvent.set(cut.parent_event_id, []); cutsByEvent.get(cut.parent_event_id).push(cut); }
    const seen = new Set();
    const walk = (eventId, depth) => {
      const event = events.get(eventId); if (!event) return;
      const indent = '  '.repeat(depth);
      if (seen.has(eventId)) { lines.push(`${indent}- ${eventId} (shown above)`); return; }
      seen.add(eventId);
      const interval = event.interval ? ` [${event.interval.start}, ${event.interval.end}]` : '';
      lines.push(`${indent}- ${eventId}${interval}: ${clip(oneLine(event.boundary), input.textLimit)}`);
      if (nonblank(event.description)) lines.push(`${indent}  ${clip(oneLine(event.description), input.textLimit * 3)}`);
      else if (cutsByEvent.has(eventId)) lines.push(`${indent}  (no description, although this Event carries numbers)`);
      for (const cut of cutsByEvent.get(eventId) ?? []) {
        // The unit says what the weights are (credence, share of a change, allocation), which the numbers alone do not.
        const unit = nonblank(cut.unit) ? ` [unit: ${clip(oneLine(cut.unit), 80)}]` : '';
        lines.push(`${indent}  · ${cut.id}${unit}${withdrawnMark(cut, input.textLimit)}: ${clip(oneLine(cut.question), input.textLimit)} ${cutAnswers(cut)}`);
        attach('normalized_cut', cut.id, `${indent}  `);
      }
      attach('event', eventId, indent);
      for (const child of children.get(eventId) ?? []) walk(child, depth + 1);
    };
    const starts = input.focusEventId ? [input.focusEventId]
      : [...(layer.context_roots ?? []).map((root) => root.event_id), ...layer.events.map((event) => event.id).filter((eventId) => !parents.has(eventId))];
    for (const eventId of [...new Set(starts)]) walk(eventId, 0);
  }
  if (want.has('processes') && (model.processes ?? []).length) {
    lines.push('', '## Processes');
    for (const process of model.processes) {
      const value = process.initial_value?.value;
      lines.push(`- ${process.id} (${process.unit ?? 'no unit'}, ${process.update_mode ?? 'unspecified'}): ${clip(oneLine(process.scale?.semantic_role ?? ''), input.textLimit)}${value === undefined ? '' : `; initial ${Array.isArray(value) ? JSON.stringify(value) : value}`}`);
      attach('process', process.id, '');
    }
  }
  if (want.has('concepts') && ((layer.concepts ?? []).length || (layer.abstract_cuts ?? []).length)) {
    lines.push('', '## Concepts');
    for (const concept of layer.concepts ?? []) { lines.push(`- ${concept.id}${concept.label ? ` (${concept.label})` : ''}${withdrawnMark(concept, input.textLimit)}: ${clip(oneLine(concept.boundary ?? ''), input.textLimit)}`); attach('concept', concept.id, ''); }
    for (const cut of layer.abstract_cuts ?? []) lines.push(`- opening ${cut.id}${withdrawnMark(cut, input.textLimit)}: ${cut.parent_concept_id} → ${(cut.child_concept_ids ?? []).join(', ')} (${clip(oneLine(cut.lens ?? ''), input.textLimit)})`);
  }
  if (view && want.has('understanding')) {
    const roots = view.nodes.filter((node) => node.node_type === 'understanding_process_root');
    lines.push('', '## Understanding');
    const contains = new Map();
    for (const edge of view.edges) if (edge.relation === 'contains' && edge.source?.kind === 'node') {
      if (!contains.has(edge.source.node_id)) contains.set(edge.source.node_id, []);
      contains.get(edge.source.node_id).push(edge.target.node_id);
    }
    const nodes = new Map(view.nodes.map((node) => [node.id, node]));
    for (const root of roots) {
      const members = []; const pending = [...(contains.get(root.id) ?? [])];
      while (pending.length) { const next = pending.shift(); const node = nodes.get(next); if (!node || members.includes(node)) continue; members.push(node); pending.push(...(contains.get(next) ?? [])); }
      const reflections = members.filter((node) => node.role === 'externalized_reflection');
      lines.push(`- ${root.id} (${root.holder ?? root.subject ?? 'unattributed'}): ${reflections.length} reflection${reflections.length === 1 ? '' : 's'}, ${members.length} record${members.length === 1 ? '' : 's'}`);
      if (input.understanding !== 'none' && input.understanding !== 'count') {
        const recent = [...reflections].sort((a, b) => (b.value_time ?? 0) - (a.value_time ?? 0)).slice(0, input.understanding === 'full' ? reflections.length : 5);
        noteLines(recent, '  ');
      }
    }
  }
  if (view && want.has('documents')) {
    const documents = view.nodes.filter((node) => node.role === 'document_root');
    if (documents.length) lines.push('', '## Documents');
    const passages = view.nodes.filter((node) => node.role === 'story_passage' && node.render !== 'exclude');
    for (const document of documents) lines.push(`- ${document.id}: ${clip(oneLine(notePayload(document).text), input.textLimit)} (${passages.length} rendered passage${passages.length === 1 ? '' : 's'}, ${passages.reduce((sum, node) => sum + (node.text ?? '').split(/\s+/u).filter(Boolean).length, 0)} words in the graph)`);
  }
  let text = lines.join('\n');
  const truncated = text.length > input.maxChars;
  if (truncated) text = `${text.slice(0, input.maxChars)}\n… (outline truncated at ${input.maxChars} characters; narrow it with sections or focusEventId)`;
  return { schema: 'meaning-model-outline/v1', modelHash, graphHash: view?.graph_hash ?? null, coverage, understanding: input.understanding, truncated, text };
}

// ---------------------------------------------------------------------------------------------
// Replay: how the model and graph reached their present state, step by step.

export const replaySchema = z.object({
  graphHash: hash.optional(), modelHash: hash.optional(),
  accessScopes: z.array(id).max(64).default([]),
  level: z.enum(['outline', 'reasoning', 'full']).default('outline'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(80).default(25),
  focus: z.array(targetSchema).max(16).default([]),
  format: z.enum(['text', 'json']).default('text'),
  maxChars: z.number().int().min(2_000).max(400_000).default(60_000),
}).strict().refine((input) => Boolean(input.graphHash) !== Boolean(input.modelHash), 'Supply exactly one: graphHash replays the graph with the model revisions it was bound to; modelHash replays a model lineage alone.');

const graphCaches = new WeakMap();
async function cachedGraph(service, graphHash, accessScopes) {
  if (!graphCaches.has(service)) graphCaches.set(service, new Map());
  const cache = graphCaches.get(service);
  const key = `${graphHash}|${[...accessScopes].sort().join(',')}`;
  if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(accessScopes)].sort() });
  cache.set(key, view);
  while (cache.size > 24) cache.delete(cache.keys().next().value);
  return view;
}
const modelCaches = new WeakMap();
async function cachedModel(service, modelHash) {
  if (!modelHash) return null;
  if (!modelCaches.has(service)) modelCaches.set(service, new Map());
  const cache = modelCaches.get(service);
  if (!cache.has(modelHash)) {
    cache.set(modelHash, (await service.inspectModel({ modelHash, includeDefinition: true })).model);
    while (cache.size > 48) cache.delete(cache.keys().next().value);
  }
  return cache.get(modelHash);
}

const modelCollections = [
  ['processes', (model) => model.processes], ['initial claims', (model) => model.initial_claims], ['laws', (model) => model.laws],
  ['concepts', (model) => model.meaning_model?.concepts], ['abstract cuts', (model) => model.meaning_model?.abstract_cuts],
  ['abstract relations', (model) => model.meaning_model?.abstract_relations],
  ['referents', (model) => model.meaning_model?.referents], ['encapsulation cuts', (model) => model.meaning_model?.encapsulation_cuts],
  ['events', (model) => model.meaning_model?.events],
  ['event relations', (model) => model.meaning_model?.event_relations], ['bindings', (model) => model.meaning_model?.event_referent_bindings],
  ['physical cuts', (model) => model.meaning_model?.physical_cuts], ['realizations', (model) => model.meaning_model?.realizations],
  ['cuts', (model) => model.meaning_model?.normalized_cuts],
];
export function modelDiff(previous, next) {
  const changes = [];
  for (const [label, read] of modelCollections) {
    const before = new Map((previous ? read(previous) ?? [] : []).map((record) => [record.id, record]));
    const after = new Map((read(next) ?? []).map((record) => [record.id, record]));
    const added = [...after.keys()].filter((key) => !before.has(key));
    const removed = [...before.keys()].filter((key) => !after.has(key));
    const changed = [...after.keys()].filter((key) => before.has(key) && canonical(before.get(key)) !== canonical(after.get(key)))
      .map((key) => ({ id: key, fields: [...new Set([...Object.keys(before.get(key)), ...Object.keys(after.get(key))])]
        .filter((field) => canonical(before.get(key)[field]) !== canonical(after.get(key)[field])) }));
    if (added.length || removed.length || changed.length) changes.push({ collection: label, added, removed, changed });
  }
  return changes;
}
function graphDiff(previous, next) {
  const before = new Map((previous?.nodes ?? []).map((node) => [node.id, node]));
  const after = new Map(next.nodes.map((node) => [node.id, node]));
  const strip = ({ content_included, boundary, ...node }) => node;
  const added = next.nodes.filter((node) => !before.has(node.id));
  const removed = [...before.values()].filter((node) => !after.has(node.id));
  const changed = next.nodes.filter((node) => before.has(node.id) && canonical(strip(before.get(node.id))) !== canonical(strip(node)));
  const edgesBefore = new Set((previous?.edges ?? []).map((edge) => edge.id));
  const edgesAfter = new Set(next.edges.map((edge) => edge.id));
  return { added, removed, changed, before,
    edgesAdded: next.edges.filter((edge) => !edgesBefore.has(edge.id)), edgesRemoved: [...edgesBefore].filter((edgeId) => !edgesAfter.has(edgeId)).length,
    rootsAdded: next.roots.filter((rootId) => !(previous?.roots ?? []).includes(rootId)) };
}
function touches(step, focus) {
  if (!focus.length) return true;
  return focus.some((target) => target.nodeId ? step.nodeIds.has(target.nodeId) : step.recordKeys.has(target.record));
}

async function graphLineage(service, head) {
  const history = await service.listNarrativeRevisions({ graphId: head.graph.id });
  const byHash = new Map(history.revisions.map((revision) => [revision.graph_hash, revision]));
  const path = []; let cursor = head.graph_hash;
  while (cursor) {
    const revision = byHash.get(cursor);
    if (!revision) break;
    path.unshift(revision); cursor = revision.previous_graph_hash;
  }
  const onPath = new Set(path.map((revision) => revision.graph_hash));
  return { path, branchPoints: path.filter((revision) => revision.is_branch_point).map((revision) => ({ revision: revision.revision_number, graphHash: revision.graph_hash, children: revision.child_count })),
    otherHeads: history.heads.filter((headHash) => headHash !== head.graph_hash && !onPath.has(headHash)), revisionCount: history.revision_count };
}
async function modelChain(service, fromHash, untilHash, limit = 64) {
  const chain = []; let cursor = fromHash;
  while (cursor && cursor !== untilHash && chain.length < limit) {
    const model = await cachedModel(service, cursor);
    chain.unshift({ hash: cursor, model });
    cursor = model.revision?.previous_model_hash ?? null;
  }
  return chain;
}

function describeModelChanges(changes, level) {
  return changes.map((change) => {
    const parts = [];
    if (change.added.length) parts.push(`+${change.added.length}${level === 'outline' ? '' : ` (${clip(change.added.join(', '), 400)})`}`);
    if (change.removed.length) parts.push(`−${change.removed.length}${level === 'outline' ? '' : ` (${clip(change.removed.join(', '), 400)})`}`);
    if (change.changed.length) parts.push(`~${change.changed.length}${level === 'outline' ? '' : ` (${clip(change.changed.map((item) => `${item.id}: ${item.fields.join('/')}`).join('; '), 600)})`}`);
    return `${change.collection} ${parts.join(' ')}`;
  }).join('; ');
}

// Drift that already exists: sentences some earlier revision's prose had and the current prose lacks, and the
// present-tense records (Events, plans, writer's notes) that still quote them.
export const driftCheckSchema = z.object({ graphHash: hash, accessScopes: z.array(id).max(64).default([]) }).strict();
export async function checkProseDrift(service, raw) {
  const input = driftCheckSchema.parse(raw);
  const head = await readGraph(service, input.graphHash, input.accessScopes);
  const { path } = await graphLineage(service, head);
  const prose = (view) => view.nodes.filter((node) => node.role === 'story_passage' && node.render !== 'exclude').map((node) => node.text ?? '');
  const earlier = [];
  for (const revision of path.slice(0, -1)) earlier.push(...prose(await cachedGraph(service, revision.graph_hash, input.accessScopes)));
  const removed = removedFragments([...new Set(earlier)], prose(head));
  const model = await cachedModel(service, boundModelHash(head));
  const records = recordsQuoting(textRecords(head, model), removed, { limit: 80 });
  return { schema: 'meaning-model-prose-drift/v1', graphHash: input.graphHash, revisionsRead: path.length, removedFragmentCount: removed.length,
    recordsQuotingRemovedText: records, textMatchOnly: true,
    nextStep: records.length ? 'Each record still quotes text the prose no longer has. Update it (a model revision for Events) or supersede it with a note, so a later reader does not take the old wording as current.' : 'No present-tense record quotes removed prose. Paraphrases are not checked.' };
}

export async function replayConstruction(service, raw) {
  const input = replaySchema.parse(raw);
  const limits = { outline: 160, reasoning: 8_000, full: 40_000 }[input.level];
  const out = []; let used = 0; let truncated = false;
  const emit = (line) => { if (truncated) return false; if (used + line.length + 1 > input.maxChars) { truncated = true; return false; } out.push(line); used += line.length + 1; return true; };
  if (input.modelHash) {
    const chain = await modelChain(service, input.modelHash, null, 1_024);
    const page = chain.slice(input.offset, input.offset + input.limit);
    const steps = [];
    for (const [index, entry] of page.entries()) {
      const previous = input.offset + index > 0 ? chain[input.offset + index - 1].model : null;
      const changes = modelDiff(previous, entry.model);
      const recordKeys = new Set(changes.flatMap((change) => [...change.added, ...change.changed.map((item) => item.id)]));
      const step = { modelRevision: entry.model.revision?.number, modelHash: entry.hash, reason: entry.model.revision?.reason ?? null, provenance: entry.model.revision?.provenance ?? [], changes, recordKeys: new Set([...recordKeys].flatMap((key) => Object.keys(recordKinds).map((kind) => `${kind}:${key}`))), nodeIds: new Set() };
      if (!touches(step, input.focus)) continue;
      steps.push(step);
      emit(`- model r${step.modelRevision} (${entry.hash.slice(0, 12)}): ${clip(oneLine(step.reason ?? ''), limits)}`);
      if (changes.length) emit(`  changes: ${describeModelChanges(changes, input.level)}`);
      if (truncated) break;
    }
    const nextOffset = input.offset + page.length < chain.length ? input.offset + page.length : null;
    return { schema: 'meaning-model-construction-replay/v1', kind: 'model', level: input.level, headModelHash: input.modelHash, revisionCount: chain.length,
      window: { offset: input.offset, limit: input.limit, nextOffset }, truncated,
      ...(input.format === 'json' ? { steps: steps.map(({ recordKeys, nodeIds, ...step }) => step) } : { text: out.join('\n') }) };
  }
  const head = await readGraph(service, input.graphHash, input.accessScopes);
  const lineage = await graphLineage(service, head);
  const path = lineage.path;
  const page = path.slice(input.offset, input.offset + input.limit);
  emit(`# Construction of ${head.graph.id}: ${path.length} graph revisions${lineage.otherHeads.length ? `, ${lineage.otherHeads.length} other heads` : ''}${lineage.branchPoints.length ? `, ${lineage.branchPoints.length} branch points` : ''}`);
  // What later answered each review or note, read from the head, so a review shows its responses where it appears.
  const responses = new Map();
  for (const edge of head.edges) if (edge.source?.kind === 'node' && edge.target?.kind === 'node' && ['answers', 'contradicts', 'supersedes', 'refines'].includes(edge.relation)) {
    if (!responses.has(edge.target.node_id)) responses.set(edge.target.node_id, []);
    responses.get(edge.target.node_id).push({ relation: edge.relation, nodeId: edge.source.node_id });
  }
  const responseSummary = (nodeId) => {
    const list = responses.get(nodeId) ?? [];
    if (!list.length) return null;
    const counts = {}; for (const item of list) counts[item.relation] = (counts[item.relation] ?? 0) + 1;
    return Object.entries(counts).map(([relation, count]) => `${count} ${relation}`).join(', ');
  };
  const steps = []; let lastCompleted = input.offset - 1;
  for (const [index, revision] of page.entries()) {
    const position = input.offset + index;
    const view = await cachedGraph(service, revision.graph_hash, input.accessScopes);
    const previousView = position > 0 ? await cachedGraph(service, path[position - 1].graph_hash, input.accessScopes) : null;
    const diff = graphDiff(previousView, view);
    const modelHash = boundModelHash(view); const previousModelHash = previousView ? boundModelHash(previousView) : null;
    const model = await cachedModel(service, modelHash);
    let modelStep = null;
    if (modelHash !== previousModelHash) {
      const chain = await modelChain(service, modelHash, previousModelHash);
      const previousModel = previousModelHash ? await cachedModel(service, previousModelHash) : null;
      modelStep = { hash: modelHash, revision: model?.revision?.number ?? null, reasons: chain.map((entry) => ({ revision: entry.model.revision?.number, reason: entry.model.revision?.reason ?? null })),
        changes: previousModel ? modelDiff(previousModel, model) : [] };
    }
    const edgesFrom = new Map();
    for (const edge of view.edges) if (edge.source?.kind === 'node') { if (!edgesFrom.has(edge.source.node_id)) edgesFrom.set(edge.source.node_id, []); edgesFrom.get(edge.source.node_id).push(edge); }
    const isReflection = (node) => node.role === 'externalized_reflection' || node.node_type === 'review';
    const notes = [...diff.added, ...diff.changed].filter(isReflection).map((node) => ({
      id: node.id, change: diff.before.has(node.id) ? 'changed' : 'added', holder: node.holder ?? null, type: node.node_type, ...notePayload(node),
      about: (edgesFrom.get(node.id) ?? []).filter((edge) => edge.relation !== 'contains').map((edge) => edge.target.kind === 'anchor'
        ? `${edge.relation} ${recordSummary(model, edge.target.anchor_kind, edge.target.anchor_id, input.level === 'outline' ? 60 : 200)}`
        : `${edge.relation} ${edge.target.node_id}`),
    }));
    const prose = [...diff.added, ...diff.changed, ...diff.removed].filter((node) => node.role === 'story_passage').map((node) => ({
      id: node.id, change: diff.removed.includes(node) ? 'removed' : diff.before.has(node.id) ? 'changed' : 'added', words: (node.text ?? '').split(/\s+/u).filter(Boolean).length, text: node.text ?? '' }));
    const other = [...diff.added, ...diff.changed].filter((node) => !isReflection(node) && node.role !== 'story_passage');
    const recordKeys = new Set();
    for (const node of [...diff.added, ...diff.changed]) for (const edge of edgesFrom.get(node.id) ?? []) if (edge.target.kind === 'anchor') {
      const kind = Object.entries(recordKinds).find(([, value]) => value === edge.target.anchor_kind)?.[0] ?? edge.target.anchor_kind;
      recordKeys.add(`${kind}:${edge.target.anchor_id}`);
    }
    for (const change of modelStep?.changes ?? []) for (const key of [...change.added, ...change.changed.map((item) => item.id)]) for (const kind of Object.keys(recordKinds)) recordKeys.add(`${kind}:${key}`);
    const step = { revision: revision.revision_number, graphHash: revision.graph_hash, reason: view.graph.revision.reason ?? null, provenance: view.graph.revision.provenance ?? [],
      model: modelStep, counts: { nodesAdded: diff.added.length, nodesChanged: diff.changed.length, nodesRemoved: diff.removed.length, edgesAdded: diff.edgesAdded.length, edgesRemoved: diff.edgesRemoved },
      notes, prose, records: other.map((node) => ({ id: node.id, type: node.node_type, change: diff.before.has(node.id) ? 'changed' : 'added', holder: node.holder ?? null })),
      nodeIds: new Set([...[...diff.added, ...diff.changed, ...diff.removed].map((node) => node.id),
        ...diff.edgesAdded.filter((edge) => edge.target?.kind === 'node' && edge.relation !== 'contains').map((edge) => edge.target.node_id)]), recordKeys };
    if (!touches(step, input.focus)) { lastCompleted = position; continue; }
    const lines = [`\n## r${step.revision} · ${clip(oneLine(step.reason ?? '(no reason recorded)'), input.level === 'outline' ? 140 : 1_000)}`];
    if (modelStep) {
      lines.push(`model → r${modelStep.revision} (${modelHash.slice(0, 12)})${modelStep.reasons.length ? `: ${modelStep.reasons.map((entry) => `r${entry.revision} ${clip(oneLine(entry.reason ?? ''), input.level === 'outline' ? 120 : 800)}`).join(' | ')}` : ''}`);
      if (modelStep.changes.length) lines.push(`  model changes: ${describeModelChanges(modelStep.changes, input.level)}`);
    }
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    const countLine = [step.counts.nodesAdded && `+${plural(step.counts.nodesAdded, 'node')}`, step.counts.nodesChanged && `~${step.counts.nodesChanged} changed`, step.counts.nodesRemoved && `−${step.counts.nodesRemoved} removed`, step.counts.edgesAdded && `+${plural(step.counts.edgesAdded, 'edge')}`, step.counts.edgesRemoved && `−${plural(step.counts.edgesRemoved, 'edge')}`].filter(Boolean).join(', ');
    if (countLine) lines.push(countLine);
    for (const note of notes) {
      const answers = input.level === 'outline' ? note.about.filter((item) => /^(answers|supersedes) /u.test(item)) : [];
      const gist = noteGist(note);
      const isReview = note.kind === 'review';
      const findings = isReview && Array.isArray(note.data?.findings) ? note.data.findings : [];
      const later = responseSummary(note.id);
      const extra = [isReview && findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'}` : null, later ? `later: ${later}` : null].filter(Boolean);
      // A review is read whole at the deeper levels: its text is what the answers refer to.
      const limit = isReview ? limits * 4 : limits;
      const shown = input.level === 'outline' ? clip(oneLine(gist), limits) : clip(gist, limit);
      const cut = input.level !== 'outline' && gist.length > limit ? ` [cut at ${limit} of ${gist.length} characters; read it whole with life_understanding_read]` : '';
      lines.push(`✎ ${note.id} [${note.type}${note.holder ? ` by ${note.holder}` : ''}${note.change === 'changed' ? ', changed' : ''}]: ${shown}${answers.length ? ` (${answers.join('; ')})` : ''}${extra.length ? ` [${extra.join('; ')}]` : ''}${cut}`);
      if (input.level !== 'outline' && note.about.length) lines.push(`   ${clip(note.about.join('; '), 1_200)}`);
      if (input.level !== 'outline') for (const [findingIndex, finding] of findings.entries()) {
        const text = typeof finding === 'string' ? finding : finding?.text ?? JSON.stringify(finding);
        lines.push(`   finding ${findingIndex + 1}${finding?.severity ? ` [${finding.severity}]` : ''}: ${clip(oneLine(text), input.level === 'full' ? 2_000 : 400)}`);
      }
      if (input.level !== 'outline' && later) lines.push(`   later responses: ${clip((responses.get(note.id) ?? []).map((item) => `${item.nodeId} ${item.relation}`).join('; '), 1_500)}`);
      if (input.level === 'full' && note.data !== undefined) lines.push(`   data: ${clip(JSON.stringify(note.data), 4_000)}`);
    }
    // Links added between records that already existed, such as a plan that answers a review.
    const addedIds = new Set(diff.added.map((node) => node.id));
    const linked = diff.edgesAdded.filter((edge) => edge.source?.kind === 'node' && !addedIds.has(edge.source.node_id) && edge.relation !== 'contains'
      && (input.level !== 'outline' || ['answers', 'supersedes', 'refines', 'contradicts'].includes(edge.relation)));
    if (linked.length) lines.push(`links: ${clip(linked.map((edge) => `${edge.source.node_id} ${edge.relation} ${edge.target.kind === 'node' ? edge.target.node_id : `${edge.target.anchor_kind}:${edge.target.anchor_id}`}`).join('; '), 1_200)}`);
    if (prose.length) {
      lines.push(`prose: ${prose.map((item) => `${item.change} ${item.id} (${item.words} words)`).join(', ')}`);
      if (input.level === 'full') for (const item of prose.filter((entry) => entry.change !== 'removed')) lines.push(`   ${item.id}: ${clip(item.text, limits)}`);
    }
    // Other records: at outline level the titled ones by title; at the deeper levels each readable record on its line.
    if (other.length && input.level === 'outline') {
      const titled = other.filter((node) => nonblank(node.title) && node.node_type !== 'understanding_process_root');
      if (titled.length) lines.push(`records: ${titled.slice(0, 4).map((node) => `${diff.before.has(node.id) ? '~' : '+'}${node.id} "${clip(oneLine(node.title), 80)}"`).join('; ')}${titled.length > 4 ? `; ${titled.length - 4} more` : ''}`);
    } else if (other.length) {
      const readable = other.map((node) => ({ node, payload: notePayload(node) })).filter(({ payload }) => payload.readable !== false && nonblank(payload.text));
      for (const { node, payload } of readable.slice(0, 12)) lines.push(`  ${diff.before.has(node.id) ? '~' : '+'} ${node.id} [${node.node_type}]: ${clip(oneLine(payload.text), input.level === 'full' ? 4_000 : 300)}`);
      const listed = new Set(readable.slice(0, 12).map(({ node }) => node.id));
      const rest = step.records.filter((item) => !listed.has(item.id));
      if (rest.length) lines.push(`records: ${clip(rest.map((item) => `${item.change} ${item.id} (${item.type})`).join(', '), 1_500)}`);
    }
    // Stop before a step that no longer fits, so the next page starts with it whole.
    const stepText = lines.join('\n');
    if (used + stepText.length + 1 > input.maxChars && steps.length > 0) { truncated = true; break; }
    if (!emit(steps.length ? stepText : clip(stepText, input.maxChars - used - 1))) break;
    steps.push(step); lastCompleted = position;
  }
  const nextOffset = lastCompleted + 1 < path.length ? lastCompleted + 1 : null;
  if (nextOffset !== null) emit(`\n… continue with offset ${nextOffset}`);
  return { schema: 'meaning-model-construction-replay/v1', kind: 'graph', level: input.level, graphId: head.graph.id, headGraphHash: head.graph_hash,
    revisionCount: path.length, branchPoints: lineage.branchPoints, otherHeads: lineage.otherHeads,
    window: { offset: input.offset, limit: input.limit, nextOffset }, truncated,
    ...(input.format === 'json' ? { steps: steps.map(({ nodeIds, recordKeys, ...step }) => step) } : { text: out.join('\n').trim() }) };
}

// ---------------------------------------------------------------------------------------------
// Portable history: the model chain and every graph revision, so a construction can be rebuilt
// and replayed on another engine with the same hashes.

export const historyExportSchema = z.object({ graphHash: hash, accessScopes: z.array(id).max(64).default([]) }).strict();
export const historyImportSchema = z.object({
  requestId: id,
  history: z.object({ schema: z.literal('meaning-model-construction-history/v1') }).passthrough(),
}).strict();

async function definitionAt(service, graphHash, accessScopes) {
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true,
    accessScopes: [...new Set(accessScopes)].sort(), forRevision: true });
  return definitionFromCompleteView(view, 'A history export');
}
// Every access scope the history uses, in its graph records and its models (anchors to scoped claims
// and processes are visible only with their scopes), so the importer can read each complete predecessor.
function scopesIn(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) scopesIn(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'access_scopes' && Array.isArray(item)) {
        for (const scope of item) if (typeof scope === 'string') into.add(scope);
      } else {
        scopesIn(item, into);
      }
    }
  }
  return into;
}

export async function exportConstructionHistory(service, raw) {
  const input = historyExportSchema.parse(raw);
  const head = await readGraph(service, input.graphHash, input.accessScopes);
  const lineage = await graphLineage(service, head);
  const revisions = []; let previous = null; const bound = [];
  for (const entry of lineage.path) {
    const definition = await definitionAt(service, entry.graph_hash, input.accessScopes);
    if (definition.source?.kind !== 'model') throw new Error('A portable history currently covers model-bound graphs; this revision is bound to a world or candidate.');
    if (!bound.includes(definition.source.model_hash)) bound.push(definition.source.model_hash);
    revisions.push(previous ? { graphHash: entry.graph_hash, delta: narrativeDefinitionDelta(previous, definition) } : { graphHash: entry.graph_hash, definition });
    previous = definition;
  }
  // Every bound model with its ancestors, parents before children.
  const models = new Map();
  for (const modelHash of bound) {
    for (const entry of await modelChain(service, modelHash, null, 1_024)) if (!models.has(entry.hash)) models.set(entry.hash, entry.model);
  }
  const ordered = []; const placed = new Set();
  while (ordered.length < models.size) {
    const before = ordered.length;
    for (const [modelHash, model] of models) {
      const parent = model.revision?.previous_model_hash ?? null;
      if (!placed.has(modelHash) && (!parent || placed.has(parent) || !models.has(parent))) { ordered.push({ modelHash, definition: model }); placed.add(modelHash); }
    }
    if (ordered.length === before) throw new Error('The model revisions do not form a chain.');
  }
  const history = { schema: 'meaning-model-construction-history/v1', graphId: head.graph.id, headGraphHash: head.graph_hash,
    revisionCount: revisions.length, models: ordered, revisions };
  return { ...history, bundleSha256: sha256(canonical(history)) };
}

export async function importConstructionHistory(service, raw) {
  const input = historyImportSchema.parse(raw);
  const { history } = input;
  const { bundleSha256, ...content } = history;
  if (bundleSha256 && sha256(canonical(content)) !== bundleSha256) throw new Error('The history bundle does not match its bundleSha256.');
  for (const [index, entry] of (history.models ?? []).entries()) {
    const definition = entry.definition;
    const stored = definition.revision?.number === 0 || !definition.revision?.previous_model_hash
      ? await service.registerModel({ requestId: `${input.requestId}.model.${index}`, model: definition })
      : await service.reviseModel({ requestId: `${input.requestId}.model.${index}`, previousModelHash: definition.revision.previous_model_hash, model: definition });
    if (stored.modelHash !== entry.modelHash) throw new Error(`Model ${index} rebuilt as ${stored.modelHash}, not ${entry.modelHash}; the history cannot be reproduced.`);
  }
  // A step that only added records goes in as an additive batch, any other as a revision by change;
  // neither keeps a copy of the whole graph in its receipt, so a long history fits the receipt budget.
  const scopes = [...scopesIn(history.revisions, scopesIn(history.models))].sort();
  if (scopes.length > 64) throw new Error(`The history uses ${scopes.length} access scopes; an import can read at most 64 at once.`);
  let definition = null; let graphHash = null;
  const applied = { registered: 0, additiveBatches: 0, revisionsByChange: 0 };
  for (const [index, entry] of (history.revisions ?? []).entries()) {
    const requestId = `${input.requestId}.graph.${index}`;
    if (index === 0) {
      definition = entry.definition;
      graphHash = (await service.registerNarrativeGraph({ requestId, narrativeGraph: definition })).graphHash;
      applied.registered += 1;
    } else {
      const next = applyNarrativeDefinitionDelta(definition, entry.delta);
      const batch = additiveNarrativeBatch(definition, entry.delta, graphHash);
      let stored = null;
      if (batch) {
        try {
          stored = await service.applyNarrativeBatch({ requestId, previousGraphHash: graphHash, narrativeBatch: batch });
          applied.additiveBatches += 1;
        } catch (cause) {
          // A batch must connect every new part to what exists; a step that added a part the original
          // revision connected another way is stored as a revision by change instead.
          if (cause?.indeterminate === true) throw cause;
        }
      }
      if (!stored) {
        stored = await service.reviseNarrativeGraphByDelta({ requestId, previousGraphHash: graphHash, delta: entry.delta, accessScopes: scopes });
        applied.revisionsByChange += 1;
      }
      graphHash = stored.graphHash;
      definition = next;
    }
    if (graphHash !== entry.graphHash) throw new Error(`Graph revision ${index} rebuilt as ${graphHash}, not ${entry.graphHash}; the history cannot be reproduced.`);
  }
  return { schema: 'meaning-model-construction-import/v1', graphId: history.graphId, headGraphHash: graphHash, revisions: history.revisions.length, models: history.models.length,
    applied, verified: graphHash === history.headGraphHash, graphMutation: true, worldMutation: false,
    nextStep: 'Replay it with life_construction_replay on headGraphHash.' };
}

// ---------------------------------------------------------------------------------------------

export function registerConstructionRecordTools(server, service, { toolResult }) {
  server.registerTool('life_understanding_record', {
    description: `Record one or more Understanding Nodes held by a named holder (the modeler, a writer, a character in story time), each linked to what it concerns: model records by kind:id (event, cut, process, claim, concept, referent and the other record kinds, optionally with a JSON Pointer path) or graph nodes. Kinds: ${noteKinds.join(', ')}. Notes are placed under the holder's understanding root with the graph-revision clock (or world time for story_time) and stamped with the model revision they were written against. Keep one holder id for yourself for the whole session, and a new one only for a different mind (a continuing agent, a character); say a role such as writer or self-review in the note, not in the holder. A note must be about something. ${constructionRecordInstructions}`,
    inputSchema: understandingRecordSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await recordUnderstanding(service, input)));
  server.registerTool('life_review_record', {
    description: 'Record a review as an Understanding Node held by its actual reviewer (another model, a blind reader, an estimator, a person or a tool), with what the reviewer was given, how independent it was, the exact graph revision it read, the prompt, a hash of the rendered text it reviewed (checked against a supplied text hash), its verdict and findings, and links to what it concerns. Later changes that answer the review link to it with answers.',
    inputSchema: reviewRecordSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await recordReview(service, input)));
  server.registerTool('life_narrative_drift_check', {
    description: 'Find drift between prose and the records about it: sentences that some earlier revision of the prose had and the current prose lacks, and the present-tense records (the bound model\'s Event descriptions, plans, disclosure records, writer\'s notes) that still quote them. Reviews, drafts, assessments, revision notes and superseded notes quote old text as history and are left out. A text match only: it finds copied or quoted sentences, not paraphrases. life_narrative_edit reports the same for the text it removes.',
    inputSchema: driftCheckSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await checkProseDrift(service, input)));
  server.registerTool('life_understanding_read', {
    description: 'Read named Understanding Nodes or reviews whole: each one\'s kind, holder, title, full text, data (a review\'s verdict and findings), provenance, and the links into and out of it (what it answers, what answered it). Use it when the replay or the outline shows a note cut short; it reads up to 32 nodes without their neighborhoods.',
    inputSchema: noteReadSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await readNotes(service, input)));
  server.registerTool('life_model_outline', {
    description: 'Read the present state as a readable outline: description coverage (which Events carry numbers without a description), Things, the Event tree with descriptions and the Cuts under each Event, processes, concepts, understanding roots and documents. With a graphHash it overlays the Understanding Nodes linked to each record, at the chosen depth: none, count, first_line or full. Narrow it with sections or focusEventId.',
    inputSchema: outlineSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await outlineModel(service, input)));
  server.registerTool('life_construction_export', {
    description: 'Export the whole construction of a model-bound graph as a portable history: every model revision it was bound to with their ancestors, the first graph revision in full, and each later revision as its change, with a bundle hash. Importing it on another engine rebuilds the same hashes, so the construction can be replayed there. Needs accessScopes that reveal every node.',
    inputSchema: historyExportSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await exportConstructionHistory(service, input)));
  server.registerTool('life_construction_import', {
    description: 'Rebuild an exported construction history on this engine: register the model revisions in order and every graph revision (steps that only added records as additive batches, the others as revisions by change), checking that each rebuilt hash equals the exported one, then replay it with life_construction_replay.',
    inputSchema: historyImportSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await importConstructionHistory(service, input)));
  server.registerTool('life_construction_replay', {
    description: 'Replay how a graph and its model reached their present state, one graph revision at a time from the first: each step\'s reason, the model revisions it adopted and what they changed, the notes, reviews and prose it added, and each note beside the records it concerned as they were at that step. Levels: outline (one line per step), reasoning (full notes and model changes) or full (with prose and data). Page with offset and limit; focus on records or nodes to see only the steps that touched them. A modelHash replays the model revision chain alone. Read this first when continuing someone else\'s work.',
    inputSchema: replaySchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await replayConstruction(service, input)));
}
