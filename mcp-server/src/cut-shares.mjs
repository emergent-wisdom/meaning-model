// Bridge from estimator output to Meaning Model input: choice probabilities over a Cut's answer
// keys become normalized Cuts. Proposals are AI inference; with apply they enter the model as
// an explicit immutable revision that carries estimator provenance.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { rebindNarrativeGraph } from './narrative-rebind.mjs';

const id = z.string().trim().min(1).max(256);
const longId = z.string().trim().min(1).max(1_024);
const hash = z.string().length(64);
const prose = z.string().trim().min(1).max(16_000);
export const REMAINDER_KEY = 'remainder';

const probabilityMap = z.record(id, z.number().min(0).max(1));
export const cutSharesSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  unit: z.string().trim().min(1).max(256).default('share of one budget'),
  answers: z.array(z.object({ key: id, meaning: prose }).strict()).min(1).max(60),
  remainderMeaning: prose.default('Something else, or no single named answer dominates.'),
  subject: z.string().trim().min(1).max(1_000).nullable().default(null),
  situations: z.array(z.object({ id, parentEventId: longId.nullable().default(null), text: prose }).strict()).max(32).default([]),
  modelHash: hash.nullable().default(null),
  events: z.array(z.object({ eventId: longId, cutId: longId.nullable().default(null), situationText: prose.nullable().default(null) }).strict()).max(32).default([]),
  distributions: z.array(z.object({ situationId: longId, probabilities: probabilityMap, confidence: z.number().min(0).max(1).nullable().default(null) }).strict()).max(32).default([]),
  idPrefix: id.default('cut.estimated'),
  apply: z.boolean().default(false),
  requestId: z.string().trim().min(1).max(256).nullable().default(null),
  revisionReason: z.string().trim().min(1).max(4_000).nullable().default(null),
  replaceExisting: z.boolean().default(false),
  rebind: z.object({ graphHash: hash, accessScopes: z.array(longId).max(32).default([]), requestId: z.string().trim().min(1).max(256).nullable().default(null) }).strict().nullable().default(null),
}).strict().superRefine((input, context) => {
  const keys = input.answers.map((answer) => answer.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: ['answers'], message: 'Answer keys must be unique.' });
  if (keys.includes(REMAINDER_KEY)) context.addIssue({ code: 'custom', path: ['answers'], message: `The ${REMAINDER_KEY} answer is added automatically; do not declare it.` });
  const ids = [...input.situations.map((situation) => situation.id), ...input.events.map((event) => event.eventId)];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['situations'], message: 'Situation and event target IDs must be unique.' });
  if (!ids.length) context.addIssue({ code: 'custom', path: ['situations'], message: 'Supply at least one situation or event target.' });
  if (input.events.length && !input.modelHash) context.addIssue({ code: 'custom', path: ['modelHash'], message: 'Event targets require modelHash.' });
  if (input.apply) {
    if (!input.modelHash) context.addIssue({ code: 'custom', path: ['modelHash'], message: 'apply requires modelHash.' });
    if (!input.requestId) context.addIssue({ code: 'custom', path: ['requestId'], message: 'apply requires requestId.' });
  }
  if (input.rebind && !input.apply) context.addIssue({ code: 'custom', path: ['rebind'], message: 'rebind requires apply.' });
  for (const [index, distribution] of input.distributions.entries()) {
    if (!ids.includes(distribution.situationId)) context.addIssue({ code: 'custom', path: ['distributions', index], message: `Unknown target ${distribution.situationId}.` });
    for (const key of Object.keys(distribution.probabilities)) if (key !== REMAINDER_KEY && !keys.includes(key)) context.addIssue({ code: 'custom', path: ['distributions', index], message: `Unknown answer key ${key}.` });
  }
});

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildCutShareQuestions(input, targets) {
  const criteria = Object.fromEntries([...input.answers.map((answer) => [answer.key, answer.meaning]), [REMAINDER_KEY, input.remainderMeaning]]);
  const instructions = `${input.question} Answer with the distribution over the listed answers that best describes the situation${input.subject ? ` for ${input.subject}` : ''}; put mass on ${REMAINDER_KEY} when no named answer applies or attention is elsewhere.`;
  return targets.map((target) => ({ situationId: target.id, state: { ...(input.subject ? { subject: input.subject } : {}), situation: target.text, question: input.question }, questions: { shares: { type: 'choice', instructions, criteria } } }));
}

export function proposalFromProbabilities(input, target, probabilities, meta) {
  const keys = [...input.answers.map((answer) => answer.key), REMAINDER_KEY];
  const weights = keys.map((key) => Math.max(0, Number(probabilities?.[key] ?? 0)));
  if (weights.some((weight) => !Number.isFinite(weight))) throw new Error(`Non-finite probability for target ${target.id}.`);
  // Missing mass is unassigned and belongs to the remainder; only an over-full distribution is renormalized.
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const scale = total > 1 + 1e-9 ? 1 / total : 1;
  const answers = keys.map((key, index) => ({ key, weight: weights[index] * scale }));
  const named = answers.filter((answer) => answer.key !== REMAINDER_KEY).reduce((sum, answer) => sum + answer.weight, 0);
  answers.find((answer) => answer.key === REMAINDER_KEY).weight = Math.max(0, 1 - named);
  const top = answers.slice().sort((a, b) => b.weight - a.weight)[0].key;
  return { id: target.cutId ?? `${input.idPrefix}.${target.id}`, parent_event_id: target.parentEventId, question: input.question, unit: input.unit, answers, provenance: [`estimator:${meta.label}; choice probabilities over the answer keys; AI inference, not canon`, `confidence ${meta.confidence === null || meta.confidence === undefined ? 'unknown' : Number(meta.confidence).toFixed(3)}; top ${top}`], confidence: meta.confidence ?? null, top };
}

async function resolveTargets(service, input) {
  const targets = input.situations.map((situation) => ({ id: situation.id, parentEventId: situation.parentEventId, cutId: null, text: situation.text }));
  let definition = null;
  if (input.modelHash) {
    const inspected = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
    definition = inspected?.model;
    if (!definition || typeof definition !== 'object') throw new Error('The bound model definition could not be read.');
    const events = new Map((definition.meaning_model?.events ?? []).map((event) => [event.id, event]));
    for (const target of input.events) {
      const event = events.get(target.eventId);
      if (!event) throw new Error(`Event ${target.eventId} does not exist in model ${input.modelHash}.`);
      const text = target.situationText ?? [event.boundary, event.description].filter((part) => typeof part === 'string' && part.trim()).join(' ');
      if (!text.trim()) throw new Error(`Event ${target.eventId} has no boundary or description text to estimate from; supply situationText.`);
      targets.push({ id: target.eventId, parentEventId: target.eventId, cutId: target.cutId, text });
    }
  }
  return { targets, definition };
}

export async function proposeCutShares(raw, estimator, service = null) {
  const input = cutSharesSchema.parse(raw);
  if ((input.modelHash || input.apply) && !service) throw new Error('Model-bound targets and apply require the modeling service.');
  const { targets, definition } = await resolveTargets(service, input);
  const requests = buildCutShareQuestions(input, targets);
  const supplied = new Map(input.distributions.map((distribution) => [distribution.situationId, distribution]));
  const common = { schema: 'meaning-model-cut-shares/v1', question: input.question, unit: input.unit, answerKeys: [...input.answers.map((answer) => answer.key), REMAINDER_KEY], canonical: false, evidenceType: 'ai_inference', worldMutation: false, requestHash: digest(input) };
  const needEstimator = requests.filter((request) => !supplied.has(request.situationId));
  if (needEstimator.length && !estimator) {
    if (input.apply) throw new Error('apply needs a distribution for every target: configure an estimator or supply distributions.');
    return { ...common, evaluator: 'calling_llm', proposals: null, tasks: needEstimator, graphMutation: false, instructions: 'No external estimator is configured (MEANING_MODEL_ESTIMATOR unset). Answer each task yourself with probabilities over the listed answers including the remainder, then call again with those distributions and apply to place the Cuts, or build the model revision yourself. Estimates are not world facts.' };
  }
  const proposals = []; const usage = { input_tokens: 0, output_tokens: 0 }; let model = estimator?.model ?? null; const sources = new Set();
  for (const request of requests) {
    const target = targets.find((item) => item.id === request.situationId);
    const distribution = supplied.get(request.situationId);
    if (distribution) { sources.add('supplied'); proposals.push(proposalFromProbabilities(input, target, distribution.probabilities, { label: 'supplied', confidence: distribution.confidence })); continue; }
    const result = await estimator.estimate(request.state, request.questions);
    const answer = result.answers?.shares;
    if (!answer || answer.type !== 'choice' || !answer.probabilities) throw new Error(`Estimator did not return a choice distribution for target ${request.situationId}.`);
    model = result.model ?? model; sources.add(`${estimator.backend}:${model}`);
    usage.input_tokens += Number(result.usage?.input_tokens ?? 0); usage.output_tokens += Number(result.usage?.output_tokens ?? 0);
    proposals.push(proposalFromProbabilities(input, target, answer.probabilities, { label: `${estimator.backend}:${model}`, confidence: Number(answer.confidence) }));
  }
  const evaluator = [...sources].join('+');
  if (!input.apply) return { ...common, evaluator, proposals, usage, graphMutation: false, nextStep: 'Review each proposal for coherence and category fit; a large remainder suggests a missing answer, not a fact about the subject. Call again with apply and requestId to place accepted Cuts as an explicit model revision, or use them as exploration baselines. A proposal is not a world fact and has not been semantically verified.' };
  // --- apply: one complete immutable model revision
  const successor = structuredClone(definition);
  successor.meaning_model ??= {}; successor.meaning_model.normalized_cuts ??= [];
  const existing = new Map(successor.meaning_model.normalized_cuts.map((cut, index) => [cut.id, index]));
  for (const proposal of proposals) {
    const cut = { id: proposal.id, parent_event_id: proposal.parent_event_id, question: proposal.question, unit: proposal.unit, answers: proposal.answers.map(({ key, weight }) => ({ key, weight })), provenance: proposal.provenance };
    if (!cut.parent_event_id) throw new Error(`Cut ${cut.id} has no parent event; free-text situations need parentEventId to be applied.`);
    if (existing.has(cut.id)) { if (!input.replaceExisting) throw new Error(`Cut ${cut.id} already exists in the model; set replaceExisting to supersede it in this revision.`); successor.meaning_model.normalized_cuts[existing.get(cut.id)] = cut; }
    else successor.meaning_model.normalized_cuts.push(cut);
  }
  const previousNumber = Number(definition.revision?.number ?? 0);
  successor.revision = { number: previousNumber + 1, previous_model_hash: input.modelHash, provenance: [`Meaning Model cut-shares apply v1; evaluator ${evaluator}`, ...(definition.revision?.provenance ?? []).slice(0, 8)], reason: input.revisionReason ?? `Add ${proposals.length} estimated attention Cut${proposals.length === 1 ? '' : 's'} (${evaluator}); AI inference, reviewable and supersedable.` };
  const revised = await service.reviseModel({ requestId: input.requestId, previousModelHash: input.modelHash, model: successor });
  let rebound = null;
  if (input.rebind) {
    rebound = await rebindNarrativeGraph(service, { requestId: input.rebind.requestId ?? `${input.requestId}-rebind`, graphHash: input.rebind.graphHash, modelHash: revised.modelHash, accessScopes: input.rebind.accessScopes, reason: `Rebind after estimated Cuts were applied in model revision ${successor.revision.number}.` });
  }
  return { ...common, evaluator, proposals, usage, graphMutation: Boolean(rebound), applied: { modelHash: revised.modelHash, previousModelHash: input.modelHash, revisionNumber: successor.revision.number, cutIds: proposals.map((proposal) => proposal.id), summary: revised.summary ?? null }, rebound, nextStep: rebound ? 'The graph is bound to the new model; historical assessments kept their nodes but lost predecessor anchors. Record fresh depth assessments before committing prose.' : 'The model revision is registered. Rebind any story graph with life_narrative_rebind before preparing scenes against it.' };
}
