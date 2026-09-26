// Bridge from estimator output to Meaning Model input: choice probabilities over a Cut's answer
// keys become normalized Cuts. Proposals are AI inference; with apply they enter the model as
// an explicit immutable revision that carries estimator provenance.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { rebindNarrativeGraph, preflightNarrativeRebind } from './narrative-rebind.mjs';

import { retainEstimatorProposal, readEstimatorProposal, runEstimatorRequest } from './estimator-receipts.mjs';
import { contextKindOf, displayName, indexModel, modeledPeople, personStateAt, readDraws, readPerson } from './model-questions.mjs';

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
  // conditionedOn names a stored Cut and one of its answers: this Cut divides only that part.
  events: z.array(z.object({ eventId: longId, cutId: longId.nullable().default(null), situationText: prose.nullable().default(null),
    conditionedOn: z.object({ cutId: longId, answerKey: id }).strict().nullable().default(null) }).strict()).max(32).default([]),
  distributions: z.array(z.object({ situationId: longId, probabilities: probabilityMap, confidence: z.number().min(0).max(1).nullable().default(null),
    suppliedBy: z.string().trim().min(1).max(256).nullable().default(null).describe('Who holds this distribution, such as the modeler; it is recorded as theirs, not as estimator output.') }).strict()).max(32).default([]),
  idPrefix: id.default('cut.estimated'),
  proposalId: id.nullable().default(null),
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
  if (new Set(input.distributions.map((item) => item.situationId)).size !== input.distributions.length) context.addIssue({ code: 'custom', path: ['distributions'], message: 'Distribution targets must be unique.' });
  if (input.proposalId && !input.apply) context.addIssue({ code: 'custom', path: ['proposalId'], message: 'proposalId is used with apply to adopt an existing proposal.' });
  for (const [index, distribution] of input.distributions.entries()) {
    if (!ids.includes(distribution.situationId)) context.addIssue({ code: 'custom', path: ['distributions', index], message: `Unknown target ${distribution.situationId}.` });
    for (const key of Object.keys(distribution.probabilities)) if (key !== REMAINDER_KEY && !keys.includes(key)) context.addIssue({ code: 'custom', path: ['distributions', index], message: `Unknown answer key ${key}.` });
  }
});

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildCutShareQuestions(input, targets) {
  const criteria = Object.fromEntries([...input.answers.map((answer) => [answer.key, answer.meaning]), [REMAINDER_KEY, input.remainderMeaning]]);
  // Whose act or moment is judged: the caller's subject, else the Event's own subject, so a situation that centres
  // someone else is still read as the subject's.
  const instructionsFor = (subject) => `${input.question} Answer with the distribution over the listed answers that best describes the situation${subject ? ` for ${subject}` : ''}; put mass on ${REMAINDER_KEY} when no named answer applies or attention is elsewhere.${subject ? ` Judge ${subject}: others in the situation are context.` : ''}`;
  return targets.map((target) => { const subject = input.subject ?? target.subject ?? null;
    return { situationId: target.id, state: { ...(subject ? { subject } : {}), situation: target.text, ...(target.modeled ? { modeledState: target.modeled } : {}),
      ...(target.within ? { within: `This divides only the part of the reading that is "${target.within.answerKey}", in answer to: ${target.within.question}` } : {}), question: input.question }, questions: { shares: { type: 'choice', instructions: instructionsFor(subject), criteria } } }; });
}

export function proposalFromProbabilities(input, target, probabilities, meta) {
  const keys = [...input.answers.map((answer) => answer.key), REMAINDER_KEY];
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) throw new Error(`Missing probability distribution for target ${target.id}.`);
  for (const key of Object.keys(probabilities)) if (!keys.includes(key)) throw new Error(`Unknown probability key ${key} for target ${target.id}.`);
  for (const key of (meta.requireComplete ? keys : keys.filter((key) => key !== REMAINDER_KEY))) if (!Object.hasOwn(probabilities, key)) throw new Error(`Missing probability key ${key} for target ${target.id}.`);
  for (const value of Object.values(probabilities)) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Probability must be finite and in [0,1] for target ${target.id}.`);
  if (meta.confidence != null && (typeof meta.confidence !== 'number' || !Number.isFinite(meta.confidence) || meta.confidence < 0 || meta.confidence > 1)) throw new Error(`Confidence must be finite and in [0,1] for target ${target.id}.`);
  const weights = keys.map((key) => probabilities[key] ?? 0);
  const providedTotal = weights.reduce((sum, weight) => sum + weight, 0);
  // A distribution the caller supplies must sum to one exactly (or leave mass to the remainder); an estimator's shares
  // may drift by rounding, and a drift within two hundredths is normalized and recorded rather than refused.
  const drift = meta.label === 'supplied' ? 1e-6 : 0.02;
  if (providedTotal > 1 + drift || (meta.requireComplete && Math.abs(providedTotal - 1) > drift)) throw new Error(`Probability distribution must sum to one for target ${target.id} (supplied distributions may leave remainder mass unassigned; it summed to ${providedTotal.toFixed(4)}).`);
  // Supplied missing mass belongs to the remainder. A complete estimator distribution that drifts is scaled to one in
  // either direction, so no answer's share is changed relative to the others and the remainder gains nothing by rounding.
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const scale = total > 1 + 1e-9 || (meta.requireComplete && meta.label !== 'supplied' && total > 0 && total < 1 - 1e-9) ? 1 / total : 1;
  const answers = keys.map((key, index) => ({ key, weight: weights[index] * scale }));
  const named = answers.filter((answer) => answer.key !== REMAINDER_KEY).reduce((sum, answer) => sum + answer.weight, 0);
  answers.find((answer) => answer.key === REMAINDER_KEY).weight = Math.max(0, 1 - named);
  const top = answers.slice().sort((a, b) => b.weight - a.weight)[0].key;
  // A distribution the caller supplied is theirs, not estimator output; say who holds it.
  const origin = meta.label === 'supplied'
    ? `supplied:${meta.suppliedBy ?? 'caller'}; a distribution supplied by ${meta.suppliedBy ?? 'the caller'} over the answer keys, recorded as given; not estimator output, not canon`
    : `estimator:${meta.label}; choice probabilities over the answer keys; AI inference, not canon`;
  const rounding = Math.abs(providedTotal - 1) > 1e-6 && meta.label !== 'supplied' && meta.requireComplete ? [`the shares summed to ${providedTotal.toFixed(4)} and were normalized`] : [];
  return { id: target.cutId ?? `${input.idPrefix}.${target.id}`, parent_event_id: target.parentEventId, question: input.question, unit: input.unit, answers, provenance: [origin, `confidence ${meta.confidence === null || meta.confidence === undefined ? 'unknown' : Number(meta.confidence).toFixed(3)}; top ${top}`, ...rounding, ...(target.eventText ? [`event-text:${target.eventText}`] : []),
    ...(target.text ? [`situation:${stateSignature(target.text)}`] : [])], confidence: meta.confidence ?? null, top };
}

// The Event's subject by the name the model gives them (the lead of the referent's boundary), when it names one.
function subjectName(definition, event) {
  const id = [event?.participants?.subject].flat().find(Boolean); if (!id) return null;
  return personName(definition, id) ?? displayName(id);
}
// A person by the name the model gives them: the lead of the referent's boundary, when it reads as a name.
function personName(definition, id) {
  const referent = (definition?.meaning_model?.referents ?? []).find((item) => item.id === id);
  const lead = String(referent?.boundary ?? '').split(/[,;(]| - | — /u)[0].trim();
  return lead && lead.split(/\s+/u).length <= 4 && /^\p{Lu}/u.test(lead) ? lead.replace(/^(the|a) /iu, '') : null;
}
const isReading = (item) => String(item.cutId ?? '').startsWith('lens.') || /\bfear\b[^?]*\blove\b|\blove\b[^?]*\bfear\b/iu.test(String(item.question ?? ''));
// Text that reads like a note to the modeler rather than what happens in the world: record ids, draws, revisions.
const NOTE_LIKE = /\b(?:cut|draw|lens)\.[a-z0-9_-]+\.[a-z0-9_.-]+|\bdrawn from\b|\brevision \d+\b|\bunderstanding node\b|\bTODO\b|\bsee (?:the )?note\b/iu;
// The text of an Event as an estimate reads it, signed, so a reading can tell when its Event has been rewritten since.
export const eventTextSignature = (event) => createHash('sha256').update(JSON.stringify([event?.boundary ?? '', event?.description ?? ''])).digest('hex').slice(0, 16);
export const constructionNoteIn = (text) => String(text ?? '').match(NOTE_LIKE)?.[0] ?? null;

// The estimator reads the model, not only the words written for it: each person taking part in the Event, as the model
// holds them at its start (their period, latest Cuts and the shock they are adapting to).
export function modeledStateText(definition, event, prebuilt = null, exclude = []) {
  const t = event?.interval?.start;
  if (typeof t !== 'number') return null;
  try {
    const index = prebuilt ?? indexModel(definition);
    const lines = [];
    for (const person of modeledPeople(index)) {
      const read = readPerson(index, person.id);
      if (!read.own?.has?.(event.id) && !(index.eventsOf.get(person.id) ?? []).includes(event.id)) continue;
      const state = personStateAt(definition, person.id, t);
      const period = state.periods.at(-1)?.what;
      // Lens answers are readings of the person, not their state: a moment's estimate must not read its own lens's answer
      // for the period around it, nor any other reading, so they stay out of what the estimator is told.
      const latest = state.latest.filter((item) => !isReading(item) && !exclude.includes(item.cutId)).slice(0, 6).map((item) => `${item.question}: ${item.answers.slice(0, 3).map((answer) => `${answer.key} ${answer.weight.toFixed(2)}`).join(', ')}`);
      const adapting = state.adapting.map((item) => item.shock).filter(Boolean);
      lines.push(`${personName(definition, person.id) ?? person.name ?? displayName(person.id)}${period ? `, in ${period.replace(/^in\s+/iu, '')}` : ''}${latest.length ? `; ${latest.join('; ')}` : ''}${adapting.length ? `; adapting to ${adapting.join('; ')}` : ''}.`);
      if (lines.length >= 4) break;
    }
    return lines.length ? `What the model holds at this moment: ${lines.join(' ')}`.slice(0, 3_000) : null;
  } catch {
    return null;
  }
}

// A signature of a text an estimate read: the situation it was made from.
export const stateSignature = (text) => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16);
const isAboutRelation = (relation) => relation.kind === 'about' || (relation.kind === 'other' && /^about\b/iu.test(String(relation.description ?? '')));

// How an estimate reads an Event. A world Event is read as it is, with the model's state of the people in it. A reading
// is read through the record it is about, with the model's state of it; an actor's own reasons as canon from the
// decision's text and the actor's state at the decision.
export function readingOf(definition, event, index = indexModel(definition), exclude = []) {
  if (!index.readings?.has(event.id)) return { reading: false, record: null, read: event, modeled: modeledStateText(definition, event, index, exclude) };
  const about = (index.relations ?? []).find((relation) => relation.source_event_id === event.id && isAboutRelation(relation))?.target_event_id;
  const record = about ? index.events.get(about) ?? null : null;
  const facts = {};
  for (const item of event.provenance ?? []) { const match = /^(perspective|decided-at):(.+)$/u.exec(String(item)); if (match) facts[match[1]] = match[2]; }
  const actor = (facts.perspective ?? 'modeler') === 'actor';
  const decided = facts['decided-at'] ? index.events.get(facts['decided-at']) ?? null : null;
  const read = actor ? decided ?? record ?? event : record ?? event;
  return { reading: true, record, read, modeled: modeledStateText(definition, actor ? event : record ?? event, index, exclude) };
}

// A deeper level of a reading divides one answer of the level above. The estimator is told which answer it divides and
// the question that answer answers, never its weight, which would anchor the estimate. A lens reading's levels stay on
// one reading Event, in its holder's context.
function withinOf(definition, target) {
  if (!target.conditionedOn) return null;
  const enclosing = (definition.meaning_model?.normalized_cuts ?? []).find((cut) => cut.id === target.conditionedOn.cutId);
  if (!enclosing) return null;
  if (String(target.cutId ?? '').startsWith('lens.') && enclosing.parent_event_id !== target.eventId) throw new Error(`Cut ${target.cutId} opens an answer of ${enclosing.id}, which sits on ${enclosing.parent_event_id}: a deeper level of a reading stays on the same reading Event.`);
  return { answerKey: target.conditionedOn.answerKey, question: enclosing.question };
}

export async function resolveTargets(service, input) {
  const targets = input.situations.map((situation) => ({ id: situation.id, parentEventId: situation.parentEventId, cutId: null, text: situation.text }));
  let definition = null;
  if (input.modelHash) {
    const inspected = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
    definition = inspected?.model;
    if (!definition || typeof definition !== 'object') throw new Error('The bound model definition could not be read.');
    const events = new Map((definition.meaning_model?.events ?? []).map((event) => [event.id, event]));
    const index = indexModel(definition);
    for (const target of input.events) {
      const event = events.get(target.eventId);
      if (!event) throw new Error(`Event ${target.eventId} does not exist in model ${input.modelHash}.${/^(reading|inner)\./u.test(target.eventId) ? ' A reading Event is made by life_lens_place: run it first, with eventIds for candidates, and estimate on the model it returns.' : ''}`);
      // A reading Event is judged by the record it is about.
      // An estimate is not told the answer it is estimating: a Cut being estimated again is left out of the state.
      const how = readingOf(definition, event, index, target.cutId ? [target.cutId] : []);
      const read = how.read;
      const text = target.situationText ?? [read.boundary, read.description].filter((part) => typeof part === 'string' && part.trim()).join(' ');
      if (!text.trim()) throw new Error(`Event ${target.eventId} has no boundary or description text to estimate from; supply situationText.`);
      // A Cut needs its Event described; the situation text judged becomes the description when there is none.
      const described = typeof event.description === 'string' && event.description.trim();
      if (!described && !target.situationText) throw new Error(`Event ${target.eventId} has no description to judge or to give its Cut meaning; describe what happens in it, or pass situationText, which becomes its description.`);
      targets.push({ id: target.eventId, parentEventId: target.eventId, cutId: target.cutId, text, conditionedOn: target.conditionedOn, describeWith: described ? null : target.situationText,
        modeled: how.modeled, subject: subjectName(definition, read) ?? (how.record ? subjectName(definition, how.record) : null),
        eventText: eventTextSignature(read),
        within: withinOf(definition, target) });
    }
  }
  return { targets, definition };
}

const proposalBinding = ({ apply, proposalId, requestId, revisionReason, rebind, ...binding }) => binding;

export async function proposeCutShares(raw, estimator, service = null) {
  const input = cutSharesSchema.parse(raw);
  if (input.apply) return runEstimatorRequest(service, 'cut-shares', input.requestId, input,
    (checkpoint) => executeCutShares(input, estimator, service, checkpoint));
  return executeCutShares(input, estimator, service);
}

async function executeCutShares(input, estimator, service, checkpoint = null) {
  if ((input.modelHash || input.apply) && !service) throw new Error('Model-bound targets and apply require the modeling service.');
  const { targets, definition } = await resolveTargets(service, input);
  if (input.apply) {
    const eventIds = new Set((definition.meaning_model?.events ?? []).map((event) => event.id));
    const cutIds = new Set((definition.meaning_model?.normalized_cuts ?? []).map((cut) => cut.id));
    const generatedIds = new Set();
    for (const target of targets) {
      const cutId = target.cutId ?? `${input.idPrefix}.${target.id}`;
      if (!target.parentEventId) throw new Error(`Cut ${cutId} has no parent event; free-text situations need parentEventId to be applied.`);
      if (!eventIds.has(target.parentEventId)) throw new Error(`Unknown parent event ${target.parentEventId}.`);
      if (generatedIds.has(cutId)) throw new Error(`Duplicate generated Cut ID ${cutId}.`);
      generatedIds.add(cutId);
      if (cutIds.has(cutId) && !input.replaceExisting) throw new Error(`Cut ${cutId} already exists; set replaceExisting to supersede it.`);
      // Refused before any estimate is paid for: a realized forecast keeps the weights it was drawn from.
      if (cutIds.has(cutId) && (definition.meaning_model?.event_relations ?? []).some((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id === cutId))
        throw new Error(`Cut ${cutId} was drawn, so its weights stay as drawn. Record the new estimate as its own assessment under a new cutId (for example ${cutId}.recheck), or revise the history explicitly, keeping the draw.`);
      if (target.conditionedOn) {
        const enclosing = (definition.meaning_model?.normalized_cuts ?? []).find((cut) => cut.id === target.conditionedOn.cutId);
        if (!enclosing) throw new Error(`Cut ${cutId} is conditioned on unknown Cut ${target.conditionedOn.cutId}.`);
        if (!enclosing.answers.some((answer) => answer.key === target.conditionedOn.answerKey)) throw new Error(`Cut ${target.conditionedOn.cutId} has no answer ${target.conditionedOn.answerKey}.`);
      }
    }
    if (input.rebind) await preflightNarrativeRebind(service, { ...input.rebind, modelHash: input.modelHash });
  }
  const requests = buildCutShareQuestions(input, targets);
  const supplied = new Map(input.distributions.map((distribution) => [distribution.situationId, distribution]));
  const common = { schema: 'meaning-model-cut-shares/v1', question: input.question, unit: input.unit, answerKeys: [...input.answers.map((answer) => answer.key), REMAINDER_KEY], canonical: false, epistemicStatus: 'ai_inference', evidenceType: 'estimate', worldMutation: false, requestHash: digest(input) };
  const needEstimator = requests.filter((request) => !supplied.has(request.situationId));
  if (needEstimator.length && !estimator && !input.proposalId && !checkpoint?.get('estimates')) {
    if (input.apply) throw new Error('apply needs a distribution for every target: configure an estimator or supply distributions.');
    return { ...common, evaluator: 'calling_llm', proposals: null, tasks: needEstimator, graphMutation: false, instructions: 'No external estimator is configured (MEANING_MODEL_ESTIMATOR unset). Answer each task yourself with probabilities over the listed answers including the remainder, then call again with those distributions and apply to place the Cuts, or build the model revision yourself. Estimates are not world facts.' };
  }
  let estimated = checkpoint?.get('estimates') ?? (input.proposalId ? readEstimatorProposal(service ?? estimator, 'cut-shares', proposalBinding(input), input.proposalId) : null);
  let callsNow = 0;
  if (!estimated) {
    const proposals = []; const usage = { input_tokens: 0, output_tokens: 0 }; let model = estimator?.model ?? null; const sources = new Set();
  for (const request of requests) {
    const target = targets.find((item) => item.id === request.situationId);
    const distribution = supplied.get(request.situationId);
    if (distribution) { sources.add('supplied'); proposals.push(proposalFromProbabilities(input, target, distribution.probabilities, { label: 'supplied', suppliedBy: distribution.suppliedBy, confidence: distribution.confidence })); continue; }
    const result = await estimator.estimate(request.state, request.questions); callsNow += 1;
    const answer = result.answers?.shares;
    if (!answer || answer.type !== 'choice' || !answer.probabilities) throw new Error(`Estimator did not return a choice distribution for target ${request.situationId}.`);
    model = result.model ?? model; sources.add(`${estimator.backend}:${model}`);
    usage.input_tokens += Number(result.usage?.input_tokens ?? 0); usage.output_tokens += Number(result.usage?.output_tokens ?? 0);
    proposals.push(proposalFromProbabilities(input, target, answer.probabilities, { label: `${estimator.backend}:${model}`, confidence: answer.confidence ?? null, requireComplete: true }));
  }
    estimated = { proposals, usage, evaluator: [...sources].join('+') };
    checkpoint?.set('estimates', estimated);
  }
  const { proposals, usage, evaluator } = estimated;
  // usage belongs to the estimate, which a saved proposal carries over; estimatorCallsThisRequest counts this request's calls.
  common.estimatorCallsThisRequest = callsNow;
  // A share this lopsided is often the situation text answering its own question.
  // A lens reads an act that has happened, where stating the outcome is right, so its readings are not warned about.
  const lopsided = (proposals ?? []).filter((item) => !String(item?.id ?? '').startsWith('lens.') && item?.answers?.some((answer) => answer.key !== REMAINDER_KEY && answer.weight > 0.9));
  // Much mass on none of the answers means the options miss what the person would do.
  const remainderOf = (item) => item?.answers?.find((answer) => answer.key === REMAINDER_KEY)?.weight ?? 0;
  const missing = (proposals ?? []).filter((item) => remainderOf(item) >= 0.3);
  if (missing.length) common.warnings = [...(common.warnings ?? []), ...missing.map((item) => String(item.id).startsWith('lens.') ? `${item.id} puts ${remainderOf(item).toFixed(2)} on none of the lens's answers: the lens may not fit this record, or its answers miss a reading. Answer it not_applicable, or revise the lens with the answer it lacks.` : `${item.id} puts ${remainderOf(item).toFixed(2)} on none of your answers. The options miss what this person would most plausibly do: before drawing, ask what else they could do, including what the institutions, rules and roles around them allow or require, and add those answers.`)];
  // Regularities stated only in situation text cannot be tested; they belong in the model.
  if (definition && targets.some((target) => target.parentEventId)) {
    const { laws, claims, abstractRelations } = indexModel(definition).abstractions;
    if (laws + claims + abstractRelations === 0) common.warnings = [...(common.warnings ?? []), 'The model holds no laws, claims or abstract relations, so this estimate reads only the situation text and the modeled state. Any regularity the text states (how someone always behaves, what they will or will not do) belongs in the model as a law or claim with its scope, where it can be tested against the Events; leave outcomes and directives out of situations.'];
  }
  // A situation of a few words gives the estimator almost nothing to judge: a decision Event's description that defers to its Cut.
  const thin = targets.filter((target) => String(target.text ?? '').trim().length < 80);
  if (thin.length) common.warnings = [...(common.warnings ?? []), ...thin.map((target) => `${target.id}: the estimator reads a situation of ${String(target.text ?? '').trim().length} characters, so it judges almost nothing. Pass the situation this estimate is about as situationText, or describe the Event.`)];
  const noted = targets.map((target) => [target, constructionNoteIn(target.text)]).filter(([, note]) => note);
  if (noted.length) common.warnings = [...(common.warnings ?? []), ...noted.map(([target, note]) => `${target.id}: the situation text reads like a note to the modeler ("${note}"), and the estimator judges it as what happens. Keep Event descriptions to the world and put notes in Understanding Nodes.`)];
  if (lopsided.length) common.warnings = [...(common.warnings ?? []), ...lopsided.map((item) => `${item.id} puts over 0.9 on ${item.top}. A share this lopsided often means the situation text already states the answer: describe the modeled state (what each person wants, fears, knows and can do), not the outcome, and put the regularities you rely on into the model as laws, where they can be tested.`)];
  if (!input.apply) {
    const proposalId = retainEstimatorProposal(service ?? estimator, 'cut-shares', proposalBinding(input), estimated);
    return { ...common, evaluator, proposals, usage, proposalId, graphMutation: false, nextStep: 'Review the proposals, then repeat the modeling inputs with apply, requestId and this proposalId to adopt these exact estimates without another provider call. Direct apply without proposalId makes a fresh estimate. Proposals are AI inference, not verified facts.' };
  }
  // --- apply: one complete immutable model revision
  const successor = structuredClone(definition);
  successor.meaning_model ??= {}; successor.meaning_model.normalized_cuts ??= [];
  const descriptionsAdded = [];
  for (const target of targets) {
    const event = (successor.meaning_model.events ?? []).find((item) => item.id === (target.describeWith ? target.id : target.parentEventId));
    const text = target.describeWith ?? (event && !(typeof event.description === 'string' && event.description.trim()) ? target.text : null);
    if (event && text && !(typeof event.description === 'string' && event.description.trim())) { event.description = text; descriptionsAdded.push(event.id); }
  }
  const existing = new Map(successor.meaning_model.normalized_cuts.map((cut, index) => [cut.id, index]));
  // A drawn Cut keeps the weights it was drawn from: the forecast, the draw and its alternatives survive selection.
  // A new estimate of it is its own assessment, under a new id; a changed history is revised explicitly, keeping the draw.
  const forecastNamed = new Set((successor.meaning_model.event_relations ?? []).filter((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id).map((relation) => relation.forecast_answer.cut_id));
  let drawnInGraph = new Set();
  if (input.rebind?.graphHash && service?.queryNarrativeGraph) {
    const view = await service.queryNarrativeGraph({ graphHash: input.rebind.graphHash, expectedGraphHash: input.rebind.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.rebind.accessScopes ?? [])].sort() }).catch(() => null);
    drawnInGraph = new Set(readDraws(view).map((draw) => draw.cutId));
  }
  const drawnReplaced = proposals.filter((proposal) => existing.has(proposal.id) && (forecastNamed.has(proposal.id) || drawnInGraph.has(proposal.id))).map((proposal) => proposal.id);
  if (drawnReplaced.length) throw new Error(`${drawnReplaced.join(', ')} ${drawnReplaced.length === 1 ? 'was' : 'were'} drawn, so ${drawnReplaced.length === 1 ? 'its weights stay' : 'their weights stay'} as drawn. Record the new estimate as its own assessment under a new cutId (for example ${drawnReplaced[0]}.recheck), or revise the history explicitly, keeping the draw.`);
  const conditions = new Map(targets.filter((target) => target.conditionedOn).map((target) => [target.cutId ?? `${input.idPrefix}.${target.id}`, { cut_id: target.conditionedOn.cutId, answer_key: target.conditionedOn.answerKey }]));
  for (const proposal of proposals) {
    const condition = conditions.get(proposal.id);
    const cut = { id: proposal.id, parent_event_id: proposal.parent_event_id, question: proposal.question, unit: proposal.unit, answers: proposal.answers.map(({ key, weight }) => ({ key, weight })), ...(condition ? { conditioning: condition } : {}), provenance: proposal.provenance };
    if (!cut.parent_event_id) throw new Error(`Cut ${cut.id} has no parent event; free-text situations need parentEventId to be applied.`);
    if (existing.has(cut.id)) { if (!input.replaceExisting) throw new Error(`Cut ${cut.id} already exists in the model; set replaceExisting to supersede it in this revision.`); successor.meaning_model.normalized_cuts[existing.get(cut.id)] = cut; }
    else successor.meaning_model.normalized_cuts.push(cut);
  }
  const previousNumber = Number(definition.revision?.number ?? 0);
  successor.revision = { number: previousNumber + 1, previous_model_hash: input.modelHash, provenance: [`Meaning Model cut-shares apply v1; evaluator ${evaluator}`, ...(definition.revision?.provenance ?? []).slice(0, 8)], reason: input.revisionReason ?? `Add ${proposals.length} estimated attention Cut${proposals.length === 1 ? '' : 's'} (${evaluator}); AI inference, reviewable and supersedable.` };
  const revised = checkpoint?.get('revised') ?? await service.reviseModel({ requestId: input.requestId, previousModelHash: input.modelHash, model: successor });
  checkpoint?.set('revised', revised);
  const applied = { modelHash: revised.modelHash, previousModelHash: input.modelHash, revisionNumber: successor.revision.number, cutIds: proposals.map((proposal) => proposal.id), descriptionsAdded, summary: revised.summary ?? null };
  let rebound = null;
  if (input.rebind) {
    try { rebound = await rebindNarrativeGraph(service, { requestId: input.rebind.requestId ?? `${input.requestId}-rebind`, graphHash: input.rebind.graphHash, modelHash: revised.modelHash, accessScopes: input.rebind.accessScopes, reason: `Rebind after estimated Cuts were applied in model revision ${successor.revision.number}.` }); }
    catch (error) { return { ...common, evaluator, proposals, usage, applied, rebound: null, graphMutation: false, partial: true, failure: { stage: 'rebind', message: error.message }, nextStep: 'The model revision succeeded but graph rebind did not complete. Retry this exact requestId and payload to resume without re-estimation, or inspect the recorded modelHash before a separate repair.' }; }
  }
  return { ...common, evaluator, proposals, usage, graphMutation: Boolean(rebound), applied, rebound, nextStep: rebound ? 'The graph is bound to the new model; historical assessments kept their nodes but lost predecessor anchors. Record fresh depth assessments before committing prose.' : 'The model revision is registered. Rebind any story graph with life_narrative_rebind before preparing scenes against it.' };
}
