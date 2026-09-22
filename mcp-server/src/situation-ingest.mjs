// One-call ingest for general modeling: the LLM supplies event descriptions and notes once; the
// tool creates the events, asks the estimator each question, writes the Cuts as one immutable
// model revision, rebinds a bound graph, and stores the notes as Understanding Nodes.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { REMAINDER_KEY, buildCutShareQuestions, proposalFromProbabilities } from './cut-shares.mjs';
import { rebindNarrativeGraph, preflightNarrativeRebind, assertCompleteNarrativeView } from './narrative-rebind.mjs';

import { retainEstimatorProposal, readEstimatorProposal, runEstimatorRequest } from './estimator-receipts.mjs';

const id = z.string().trim().min(1).max(1_024);
const shortId = z.string().trim().min(1).max(256);
const hash = z.string().length(64);
const prose = z.string().trim().min(1).max(16_000);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const ingestSchema = z.object({
  requestId: shortId,
  modelHash: hash,
  events: z.array(z.object({
    eventId: id,
    boundary: z.string().trim().min(1).max(4_000).nullable().default(null),
    description: prose.nullable().default(null),
    parentEventId: id.nullable().default(null),
    interval: z.object({ start: z.number(), end: z.number() }).strict().nullable().default(null),
    participants: z.record(shortId, id).default({}),
    situationText: prose.nullable().default(null),
  }).strict()).min(1).max(32),
  questions: z.array(z.object({
    id: shortId,
    question: z.string().trim().min(1).max(2_000),
    unit: z.string().trim().min(1).max(256).default('share of one budget'),
    answers: z.array(z.object({ key: shortId, meaning: prose }).strict()).min(1).max(60),
    remainderMeaning: prose.default('Something else, or no single named answer dominates.'),
    subject: z.string().trim().min(1).max(1_000).nullable().default(null),
    eventIds: z.array(id).max(32).default([]),
  }).strict()).max(16).default([]),
  distributions: z.array(z.object({ questionId: shortId, eventId: id, probabilities: z.record(shortId, z.number().min(0).max(1)), confidence: z.number().min(0).max(1).nullable().default(null) }).strict()).max(256).default([]),
  proposalId: shortId.nullable().default(null),
  apply: z.boolean().default(false),
  replaceExisting: z.boolean().default(false),
  revisionReason: z.string().trim().min(1).max(4_000).nullable().default(null),
  graph: z.object({
    graphHash: hash,
    accessScopes: z.array(id).max(32).default([]),
    rebind: z.boolean().default(true),
    notes: z.array(z.object({ nodeId: id, text: prose, holder: shortId, aboutEventIds: z.array(id).max(32).default([]), links: z.array(z.object({ relation: shortId, targetNodeId: id }).strict()).max(32).default([]) }).strict()).max(32).default([]),
  }).strict().nullable().default(null),
}).strict().superRefine((input, context) => {
  const eventIds = input.events.map((event) => event.eventId);
  if (new Set(eventIds).size !== eventIds.length) context.addIssue({ code: 'custom', path: ['events'], message: 'Event IDs must be unique.' });
  const questionIds = input.questions.map((question) => question.id);
  if (new Set(questionIds).size !== questionIds.length) context.addIssue({ code: 'custom', path: ['questions'], message: 'Question IDs must be unique.' });
  for (const [index, question] of input.questions.entries()) {
    const keys = question.answers.map((answer) => answer.key);
    if (new Set(keys).size !== keys.length || keys.includes(REMAINDER_KEY)) context.addIssue({ code: 'custom', path: ['questions', index, 'answers'], message: `Answer keys must be unique and must not include ${REMAINDER_KEY}.` });
    if (new Set(question.eventIds).size !== question.eventIds.length) context.addIssue({ code: 'custom', path: ['questions', index, 'eventIds'], message: 'Question eventIds must be unique.' });
    for (const eventId of question.eventIds) if (!eventIds.includes(eventId)) context.addIssue({ code: 'custom', path: ['questions', index, 'eventIds'], message: `Unknown event ${eventId}.` });
  }
  for (const [index, event] of input.events.entries()) if (event.interval && event.interval.end < event.interval.start) context.addIssue({ code: 'custom', path: ['events', index, 'interval'], message: 'Event interval end must not precede start.' });
  const pairs = input.distributions.map((item) => JSON.stringify([item.questionId, item.eventId]));
  if (new Set(pairs).size !== pairs.length) context.addIssue({ code: 'custom', path: ['distributions'], message: 'Distribution question/event pairs must be unique.' });
  if (input.graph && new Set(input.graph.notes.map((note) => note.nodeId)).size !== input.graph.notes.length) context.addIssue({ code: 'custom', path: ['graph', 'notes'], message: 'Note IDs must be unique.' });
  if (input.proposalId && !input.apply) context.addIssue({ code: 'custom', path: ['proposalId'], message: 'proposalId is used with apply to adopt a saved proposal.' });
  for (const [index, distribution] of input.distributions.entries()) {
    const question = input.questions.find((question) => question.id === distribution.questionId);
    if (question?.eventIds.length && !question.eventIds.includes(distribution.eventId)) context.addIssue({ code: 'custom', path: ['distributions', index], message: 'Distribution is not one of the question targets.' });
    for (const key of Object.keys(distribution.probabilities)) if (key !== REMAINDER_KEY && !question?.answers.some((answer) => answer.key === key)) context.addIssue({ code: 'custom', path: ['distributions', index], message: `Unknown answer key ${key}.` });
    if (!questionIds.includes(distribution.questionId) || !eventIds.includes(distribution.eventId)) context.addIssue({ code: 'custom', path: ['distributions', index], message: 'Distribution must name a declared question and event.' });
  }
  if (input.graph && !input.apply) context.addIssue({ code: 'custom', path: ['graph'], message: 'graph operations require apply.' });
});

const proposalBinding = ({ apply, proposalId, requestId, revisionReason, graph, ...binding }) => binding;

export async function ingestSituation(raw, estimator, service) {
  const input = ingestSchema.parse(raw);
  if (input.apply) return runEstimatorRequest(service, 'situation-ingest', input.requestId, input,
    (checkpoint) => executeIngest(input, estimator, service, checkpoint));
  return executeIngest(input, estimator, service);
}

async function executeIngest(input, estimator, service, checkpoint = null) {
  const inspected = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
  const definition = inspected?.model;
  if (!definition || typeof definition !== 'object') throw new Error('The bound model definition could not be read.');
  const successor = structuredClone(definition);
  successor.meaning_model ??= {};
  for (const collection of ['events', 'event_relations', 'normalized_cuts', 'referents']) successor.meaning_model[collection] ??= [];
  const events = new Map(successor.meaning_model.events.map((event) => [event.id, event]));
  const referents = new Set(successor.meaning_model.referents.map((referent) => referent.id));
  const provenance = [`Meaning Model situation ingest v1; request ${input.requestId}`];
  const addedEventIds = [];
  for (const spec of input.events) {
    const existing = events.get(spec.eventId);
    if (existing) {
      if ((spec.boundary || spec.description) && !input.replaceExisting) throw new Error(`Event ${spec.eventId} already exists; set replaceExisting to revise its boundary or description.`);
      if (spec.boundary) existing.boundary = spec.boundary;
      if (spec.description) existing.description = spec.description;
      if ((spec.interval || Object.keys(spec.participants).length || spec.parentEventId) && !input.replaceExisting) throw new Error(`Event ${spec.eventId} already exists; set replaceExisting for event field changes.`);
      if (spec.parentEventId) throw new Error('Changing containment for an existing event requires an explicit event-relation revision.');
      if (spec.interval) existing.interval = spec.interval;
      if (Object.keys(spec.participants).length) {
        for (const [role, referentId] of Object.entries(spec.participants)) if (!referents.has(referentId)) throw new Error(`Participant ${role} names unknown referent ${referentId}.`);
        existing.participants = spec.participants;
      }
      continue;
    }
    if (!spec.boundary) throw new Error(`New event ${spec.eventId} needs a boundary text.`);
    if (!spec.parentEventId) throw new Error(`New event ${spec.eventId} needs a parentEventId so its context root is defined.`);
    if (!events.has(spec.parentEventId)) throw new Error(`Parent event ${spec.parentEventId} does not exist in the model.`);
    for (const [role, referentId] of Object.entries(spec.participants)) if (!referents.has(referentId)) throw new Error(`Participant ${role} names unknown referent ${referentId}.`);
    const event = { id: spec.eventId, boundary: spec.boundary, ...(spec.description ? { description: spec.description } : {}), interval: spec.interval, participants: spec.participants, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance };
    successor.meaning_model.events.push(event); events.set(spec.eventId, event); addedEventIds.push(spec.eventId);
    successor.meaning_model.event_relations.push({ id: `${spec.parentEventId}.contains.${spec.eventId}`, kind: 'contains', source_event_id: spec.parentEventId, target_event_id: spec.eventId, description: 'Containment declared at ingest.', authority: null, uncertainty: { kind: 'unknown' }, provenance });
  }
  const generatedCutIds = new Set();
  const previousCuts = new Set(successor.meaning_model.normalized_cuts.map((cut) => cut.id));
  for (const question of input.questions) for (const eventId of (question.eventIds.length ? question.eventIds : input.events.map((event) => event.eventId))) {
    const cutId = `cut.${eventId}.${question.id}`;
    if (generatedCutIds.has(cutId)) throw new Error(`Duplicate generated Cut ID ${cutId}; choose unambiguous event and question IDs.`);
    generatedCutIds.add(cutId);
    if (input.apply && previousCuts.has(cutId) && !input.replaceExisting) throw new Error(`Cut ${cutId} already exists; set replaceExisting to supersede it.`);
  }
  if (input.graph) {
    const view = await preflightNarrativeRebind(service, { ...input.graph, modelHash: input.modelHash });
    if (input.graph.notes.length) {
      const validEventIds = input.graph.rebind ? new Set(events.keys()) : new Set(definition.meaning_model?.events?.map((event) => event.id) ?? []);
      if (!input.graph.rebind && view.graph.source.model_hash !== input.modelHash) throw new Error('Notes without rebind require a graph bound to the input model.');
      buildIngestNotes(view, { graphHash: input.graph.graphHash, accessScopes: input.graph.accessScopes, notes: input.graph.notes, eventIds: validEventIds, provenance });
    }
  }
  // estimate every question for its events
  const supplied = new Map(input.distributions.map((distribution) => [JSON.stringify([distribution.questionId, distribution.eventId]), distribution]));
  let estimated = checkpoint?.get('estimates') ?? (input.proposalId ? readEstimatorProposal(service, 'situation-ingest', proposalBinding(input), input.proposalId) : null);
  if (!estimated) {
  const proposals = []; const usage = { input_tokens: 0, output_tokens: 0 }; const sources = new Set(); let model = estimator?.model ?? null; const pending = [];
  for (const question of input.questions) {
    const targetIds = question.eventIds.length ? question.eventIds : input.events.map((event) => event.eventId);
    const targets = targetIds.map((eventId) => { const spec = input.events.find((event) => event.eventId === eventId); const event = events.get(eventId); const text = spec.situationText ?? [event.boundary, event.description].filter((part) => typeof part === 'string' && part.trim()).join(' '); if (!text.trim()) throw new Error(`Event ${eventId} has no text to estimate from.`); return { id: eventId, parentEventId: eventId, cutId: `cut.${eventId}.${question.id}`, text }; });
    const shaped = { question: question.question, unit: question.unit, answers: question.answers, remainderMeaning: question.remainderMeaning, subject: question.subject, idPrefix: `cut.${question.id}` };
    for (const request of buildCutShareQuestions(shaped, targets)) {
      const target = targets.find((item) => item.id === request.situationId);
      const distribution = supplied.get(JSON.stringify([question.id, target.id]));
      if (distribution) { sources.add('supplied'); proposals.push({ questionId: question.id, eventId: target.id, ...proposalFromProbabilities(shaped, target, distribution.probabilities, { label: 'supplied', confidence: distribution.confidence }) }); continue; }
      if (!estimator) { pending.push({ questionId: question.id, eventId: target.id, ...request }); continue; }
      const result = await estimator.estimate(request.state, request.questions);
      const answer = result.answers?.shares;
      if (!answer || answer.type !== 'choice' || !answer.probabilities) throw new Error(`Estimator did not return a choice distribution for ${question.id} on ${target.id}.`);
      model = result.model ?? model; sources.add(`${estimator.backend}:${model}`);
      usage.input_tokens += Number(result.usage?.input_tokens ?? 0); usage.output_tokens += Number(result.usage?.output_tokens ?? 0);
      proposals.push({ questionId: question.id, eventId: target.id, ...proposalFromProbabilities(shaped, target, answer.probabilities, { label: `${estimator.backend}:${model}`, confidence: answer.confidence ?? null, requireComplete: true }) });
    }
  }
    estimated = { proposals, usage, sources: [...sources], pending };
    checkpoint?.set('estimates', estimated);
  }
  const { proposals, usage, pending } = estimated;
  const sources = new Set(estimated.sources);
  const evaluator = [...sources].join('+') || 'calling_llm';
  const common = { schema: 'meaning-model-situation-ingest/v1', modelHash: input.modelHash, eventsAdded: addedEventIds, proposals, pending, usage, evaluator, canonical: false, evidenceType: 'ai_inference', requestHash: digest(input) };
  if (pending.length) {
    if (input.apply) throw new Error(`apply needs a distribution for every question and event; ${pending.length} pending. Configure an estimator or supply distributions.`);
    return { ...common, applied: null, worldMutation: false, graphMutation: false, instructions: 'No external estimator is configured. Answer the pending tasks with probabilities over the listed answers including the remainder, then call again with those distributions and apply.' };
  }
  if (!input.apply) {
    const proposalId = retainEstimatorProposal(service, 'situation-ingest', proposalBinding(input), estimated);
    return { ...common, proposalId, applied: null, worldMutation: false, graphMutation: false, nextStep: 'Review the events and proposals, then repeat the modeling inputs with apply and this proposalId to adopt these exact estimates. Direct apply without proposalId makes a fresh estimate. The requestId binds an apply attempt and its retries.' };
  }
  const cuts = new Map(successor.meaning_model.normalized_cuts.map((cut, index) => [cut.id, index]));
  for (const proposal of proposals) {
    const cut = { id: proposal.id, parent_event_id: proposal.parent_event_id, question: proposal.question, unit: proposal.unit, answers: proposal.answers.map(({ key, weight }) => ({ key, weight })), provenance: proposal.provenance };
    if (cuts.has(cut.id)) { if (!input.replaceExisting) throw new Error(`Cut ${cut.id} already exists; set replaceExisting to supersede it.`); successor.meaning_model.normalized_cuts[cuts.get(cut.id)] = cut; }
    else successor.meaning_model.normalized_cuts.push(cut);
  }
  const previousNumber = Number(definition.revision?.number ?? 0);
  successor.revision = { number: previousNumber + 1, previous_model_hash: input.modelHash, provenance: [`Meaning Model situation ingest v1; evaluator ${evaluator}`], reason: input.revisionReason ?? `Ingest ${addedEventIds.length} new event${addedEventIds.length === 1 ? '' : 's'} and ${proposals.length} estimated Cut${proposals.length === 1 ? '' : 's'} (${evaluator}); descriptions authored by the caller, weights AI inference.` };
  const revised = checkpoint?.get('revised') ?? await service.reviseModel({ requestId: input.requestId, previousModelHash: input.modelHash, model: successor });
  checkpoint?.set('revised', revised);
  const applied = { modelHash: revised.modelHash, previousModelHash: input.modelHash, revisionNumber: successor.revision.number, eventIds: addedEventIds, cutIds: proposals.map((proposal) => proposal.id) };
  let rebound = checkpoint?.get('rebound') ?? null; let notes = checkpoint?.get('notes') ?? null;
  let stage = 'rebind';
  try {
    if (input.graph) {
      let graphHash = input.graph.graphHash;
      if (input.graph.rebind) {
        rebound ??= await rebindNarrativeGraph(service, { requestId: `${input.requestId}-rebind`, graphHash, modelHash: revised.modelHash, accessScopes: input.graph.accessScopes, reason: `Rebind after situation ingest ${input.requestId}.` });
        checkpoint?.set('rebound', rebound); graphHash = rebound.graphHash;
      }
      stage = 'notes';
      if (input.graph.notes.length) {
        notes ??= await recordIngestNotes(service, { graphHash, accessScopes: input.graph.accessScopes, requestId: `${input.requestId}-notes`, notes: input.graph.notes, eventIds: new Set(events.keys()), provenance });
        checkpoint?.set('notes', notes);
      }
    }
  } catch (error) {
    return { ...common, applied, rebound, notes, worldMutation: false, graphMutation: Boolean(rebound || notes), partial: true, failure: { stage, message: error.message }, nextStep: 'The model revision succeeded, but a later graph step did not complete. Retry this exact requestId and payload to resume the recorded steps without re-estimation. Inspect the returned hashes before a separate repair.' };
  }
  return { ...common, applied, rebound, notes, worldMutation: false, graphMutation: Boolean(rebound || notes), nextStep: 'Events and Cuts are in the new model revision with provenance; notes are Understanding Nodes. Review, then revise explicitly where the estimates are wrong; nothing here is verified truth.' };
}

export async function recordIngestNotes(service, { graphHash, accessScopes, requestId, notes, eventIds, provenance }) {
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(accessScopes)].sort() });
  const { narrativeBatch, rootId } = buildIngestNotes(view, { graphHash, accessScopes, notes, eventIds, provenance });
  const stored = await service.applyNarrativeBatch({ requestId, previousGraphHash: graphHash, narrativeBatch });
  return { graphHash: stored.graphHash ?? null, understandingRootId: rootId, nodeIds: notes.map((note) => note.nodeId), stored };
}

export function buildIngestNotes(view, { graphHash, accessScopes, notes, eventIds, provenance }) {
  const scopes = [...new Set(accessScopes)].sort();
  if (!scopes.length) throw new Error('Understanding notes require at least one access scope.');
  assertCompleteNarrativeView(view, graphHash);
  if (new Set(notes.map((note) => note.nodeId)).size !== notes.length) throw new Error('Note IDs must be unique.');
  const step = view.graph?.revision?.number;
  if (!Number.isSafeInteger(step)) throw new Error('Recording notes requires a graph-revision clock.');
  let rootId = (view.nodes ?? []).find((node) => node.node_type === 'understanding_process_root' && (view.roots ?? []).includes(node.id))?.id ?? null;
  const addRoots = []; const nodes = []; const edges = [];
  const common = { uncertainty: { kind: 'unknown' }, access_scopes: scopes, render: 'exclude', training: 'exclude', provenance };
  if (!rootId) { rootId = 'understanding.ingest'; if (view.nodes.some((node) => node.id === rootId)) throw new Error('understanding.ingest exists but is not a declared understanding root.'); addRoots.push(rootId); nodes.push({ ...common, id: rootId, node_type: 'understanding_process_root', role: 'metadata', title: 'Ingest understanding', text: JSON.stringify({ name: 'Ingest understanding', clock: 'authoring_step', purpose: 'Notes recorded alongside situation ingest revisions.' }), epistemic_status: 'authored_process', evidence_type: 'creative_hypothesis', authority: { source: 'situation-ingest', weight: 1 } }); }
  const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
  for (const [index, note] of notes.entries()) {
    if (note.nodeId === rootId || view.nodes.some((node) => node.id === note.nodeId)) throw new Error(`Note ${note.nodeId} already exists; use a new node ID.`);
    for (const eventId of note.aboutEventIds) if (!eventIds.has(eventId)) throw new Error(`Note ${note.nodeId} is about unknown event ${eventId}.`);
    for (const link of note.links) if (!view.nodes.some((node) => node.id === link.targetNodeId)) throw new Error(`Note ${note.nodeId} links to unknown node ${link.targetNodeId}.`);
    nodes.push({ ...common, id: note.nodeId, node_type: 'ingest.note', role: 'externalized_reflection', text: note.text, epistemic_status: 'authored_proposal', evidence_type: 'creative_hypothesis', holder: note.holder, authority: { source: note.holder, weight: 1 }, value_time: step });
    edges.push({ id: `${note.nodeId}.placement`, source: endpoint(rootId), target: endpoint(note.nodeId), family: 'structural', relation: 'contains', order: step * 100 + index, access_scopes: scopes, provenance });
    for (const eventId of note.aboutEventIds) edges.push({ id: `${note.nodeId}.about.${eventId}`, source: endpoint(note.nodeId), target: { kind: 'anchor', anchor_kind: 'event', anchor_id: eventId }, family: 'grounding', relation: 'about', access_scopes: scopes, provenance });
    for (const [linkIndex, link] of note.links.entries()) edges.push({ id: `${note.nodeId}.link.${linkIndex}`, source: endpoint(note.nodeId), target: endpoint(link.targetNodeId), family: 'semantic', relation: link.relation, access_scopes: scopes, provenance });
  }
  const existingEdges = new Set(view.edges.map((edge) => edge.id));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length || edges.some((edge) => existingEdges.has(edge.id))) throw new Error('Generated note edge IDs conflict; choose distinct note IDs and targets.');
  return { rootId, narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: graphHash, reason: `Record ${notes.length} understanding note${notes.length === 1 ? '' : 's'} from situation ingest.`, provenance, add_roots: addRoots, add_nodes: nodes, add_edges: edges } };
}
