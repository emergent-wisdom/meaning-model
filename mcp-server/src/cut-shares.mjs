// Bridge from estimator output to Meaning Model input: choice probabilities over a Cut's answer
// keys become a proposed normalized Cut. Proposals are AI inference, never canon.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(256);
const prose = z.string().trim().min(1).max(16_000);
export const REMAINDER_KEY = 'remainder';

export const cutSharesSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  unit: z.string().trim().min(1).max(256).default('share of one budget'),
  answers: z.array(z.object({ key: id, meaning: prose }).strict()).min(1).max(60),
  remainderMeaning: prose.default('Something else, or no single named answer dominates.'),
  subject: z.string().trim().min(1).max(1_000).nullable().default(null),
  situations: z.array(z.object({ id, parentEventId: id.nullable().default(null), text: prose }).strict()).min(1).max(32),
  idPrefix: id.default('cut.estimated'),
}).strict().superRefine((input, context) => {
  const keys = input.answers.map((answer) => answer.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: ['answers'], message: 'Answer keys must be unique.' });
  if (keys.includes(REMAINDER_KEY)) context.addIssue({ code: 'custom', path: ['answers'], message: `The ${REMAINDER_KEY} answer is added automatically; do not declare it.` });
  const ids = input.situations.map((situation) => situation.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['situations'], message: 'Situation IDs must be unique.' });
});

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildCutShareQuestions(input) {
  const criteria = Object.fromEntries([...input.answers.map((answer) => [answer.key, answer.meaning]), [REMAINDER_KEY, input.remainderMeaning]]);
  const instructions = `${input.question} Answer with the distribution over the listed answers that best describes the situation${input.subject ? ` for ${input.subject}` : ''}; put mass on ${REMAINDER_KEY} when no named answer applies or attention is elsewhere.`;
  return input.situations.map((situation) => ({
    situationId: situation.id,
    state: { ...(input.subject ? { subject: input.subject } : {}), situation: situation.text, question: input.question },
    questions: { shares: { type: 'choice', instructions, criteria } },
  }));
}

export function proposalFromProbabilities(input, situation, probabilities, meta) {
  const keys = [...input.answers.map((answer) => answer.key), REMAINDER_KEY];
  const weights = keys.map((key) => Math.max(0, Number(probabilities?.[key] ?? 0)));
  if (weights.some((weight) => !Number.isFinite(weight))) throw new Error(`Estimator returned a non-finite probability for situation ${situation.id}.`);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const answers = keys.map((key, index) => ({ key, weight: total > 0 ? weights[index] / total : (key === REMAINDER_KEY ? 1 : 0) }));
  const named = answers.filter((answer) => answer.key !== REMAINDER_KEY).reduce((sum, answer) => sum + answer.weight, 0);
  answers.find((answer) => answer.key === REMAINDER_KEY).weight = Math.max(0, 1 - named);
  const top = answers.slice().sort((a, b) => b.weight - a.weight)[0].key;
  return {
    id: `${input.idPrefix}.${situation.id}`,
    parent_event_id: situation.parentEventId,
    question: input.question,
    unit: input.unit,
    answers,
    provenance: [`estimator:${meta.label}; choice probabilities over the answer keys; AI inference, not canon`, `confidence ${Number(meta.confidence ?? NaN).toFixed(3)}; top ${top}`],
    confidence: meta.confidence ?? null,
    top,
  };
}

export async function proposeCutShares(raw, estimator) {
  const input = cutSharesSchema.parse(raw);
  const requests = buildCutShareQuestions(input);
  const common = { schema: 'meaning-model-cut-shares/v1', question: input.question, unit: input.unit, answerKeys: [...input.answers.map((answer) => answer.key), REMAINDER_KEY], canonical: false, evidenceType: 'ai_inference', worldMutation: false, graphMutation: false, requestHash: digest(input) };
  if (!estimator) {
    return { ...common, evaluator: 'calling_llm', proposals: null, tasks: requests, instructions: 'No external estimator is configured (MEANING_MODEL_ESTIMATOR unset). Answer each task yourself: assign probabilities over the listed answers including the remainder, then build the normalized Cut with these keys and record the reasoning as an Understanding Node. Estimates are not world facts.' };
  }
  const proposals = []; const usage = { input_tokens: 0, output_tokens: 0 }; let model = estimator.model;
  for (const request of requests) {
    const result = await estimator.estimate(request.state, request.questions);
    const answer = result.answers?.shares;
    if (!answer || answer.type !== 'choice' || !answer.probabilities) throw new Error(`Estimator did not return a choice distribution for situation ${request.situationId}.`);
    model = result.model ?? model;
    usage.input_tokens += Number(result.usage?.input_tokens ?? 0); usage.output_tokens += Number(result.usage?.output_tokens ?? 0);
    const situation = input.situations.find((item) => item.id === request.situationId);
    proposals.push(proposalFromProbabilities(input, situation, answer.probabilities, { label: `${estimator.backend}:${model}`, confidence: Number(answer.confidence) }));
  }
  return { ...common, evaluator: `${estimator.backend}:${model}`, proposals, usage, nextStep: 'Review each proposal for coherence and category fit; a large remainder suggests a missing answer, not a fact about the subject. Place accepted Cuts in an explicit model revision under their parent Events with this provenance, or use them as exploration baselines. A proposal is not a world fact and has not been semantically verified.' };
}
