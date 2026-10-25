// An answer to the breadth check (breadth.mjs) as one recorded step: what was considered, whether a process now follows
// it, and why.
//
// The answer is a concept of the model, so every write's report reads it: its label names what was considered, such as
// "Independent states", its boundary holds the reason, and its provenance the candidate it answers, the signals it was
// given with, the answer and, when one does, the process that follows it. The tool adds that one concept and never
// edits a process or another record, so a world on the parent revision can adopt the revision. Given the graph, one
// decision note held by the modeler records the same answer, linked to the concept.
//
// It refuses only an answer that contradicts the model: a process that does not exist, or Events said to be linked
// while none of them names a process. It never asks for more before the answer can be recorded.
import * as z from 'zod/v4';
import { applyModelChange } from './model-change.mjs';
import { recordUnderstanding } from './construction-record.mjs';
import { rebindNarrativeGraph } from './narrative-rebind.mjs';
import { resolveAppendHead } from './graph-head.mjs';
import { PROCESS_ID, VALUE_TAGS } from './values-record.mjs';
import { questionModel } from './model-questions.mjs';
import { BREADTH_ANSWERS, breadthAnswers, breadthCheck, breadthLine, signalsLine } from './breadth.mjs';
import { BREADTH_ANSWER_LINE, BREADTH_CANDIDATE_LINE, FOLLOWED_LINE } from './carve-lines.mjs';
import { TREE_CANDIDATE, treeSignals } from './process-tree.mjs';

const MARK = 'life_breadth_record';
const MEANING_SCHEMA = 'life-sim-rust-meaning-model/v1';
const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max) => z.string().trim().min(1).max(max);
// The keys the check gives: a group of Events, a remainder of a series or Cut, or a carve's open completeness; and the
// whole-tree review, tree:whole, which reads the tree of processes as a whole.
const CANDIDATE = /^(?:events:(?:world|within:\S+|\S+)|remainder:\S+:[a-z0-9_]+|gap:\S+|tree:whole)$/u;
// The engine holds a text field to 1,024 bytes: a field is clipped by bytes, and the whole reason is kept across as many
// provenance lines as it needs.
const FIELD_BYTES = 1_000;
const clip = (value, max = FIELD_BYTES) => {
  const flat = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (Buffer.byteLength(flat, 'utf8') <= max) return flat;
  let out = ''; for (const character of flat) { if (Buffer.byteLength(`${out}${character}…`, 'utf8') > max) break; out += character; }
  return `${out}…`;
};
const chunks = (value, head, max = FIELD_BYTES) => {
  const lines = []; let line = head;
  for (const character of String(value ?? '').replace(/\s+/gu, ' ').trim()) {
    if (Buffer.byteLength(`${line}${character}`, 'utf8') > max) { lines.push(line); line = 'why, continued: '; }
    line += character;
  }
  return [...lines, line];
};

export const breadthRecordSchema = z.object({
  requestId: id,
  previousModelHash: hash,
  holder: id.describe('Whose answer this is, such as the model you are.'),
  tag: z.enum(VALUE_TAGS).describe('What the answer rests on: source, inferred, invented, exploring or sketch.'),
  candidate: z.string().trim().min(1).max(600).regex(CANDIDATE, 'A candidate is a key the breadth check gives, such as events:importance.dim.politics, remainder:<series>:<answer> or gap:<carve>, or tree:whole for a whole-tree review.')
    .describe('The candidate the breadth check named, by its key, or tree:whole for a whole-tree review.'),
  answer: z.enum(BREADTH_ANSWERS).describe('linked: its Events now name processes the model has; modeled: a process now follows it (name it in process); not_modeled: considered and not followed, for the reason given.'),
  concept: z.object({
    id: z.string().regex(PROCESS_ID).optional().describe('An id for the answer; one is made from the candidate when left out.'),
    label: text(300).describe('What was considered, in a few words, such as Independent states or Army size.'),
  }).strict(),
  process: z.string().regex(PROCESS_ID).optional().describe('For modeled: the process that now follows it, which the model has.'),
  reason: text(4_000).describe('Why: what the candidate showed, and for not_modeled why it is not worth following for what this model is for.'),
  graph: z.object({ graphHash: hash, accessScopes: z.array(id).min(1).max(64) }).strict().optional()
    .describe('The Understanding Graph bound to this model or an earlier revision of it: it is rebound to the new revision, and the answer recorded as a decision note.'),
}).strict();

// The model change: one concept for the answer, and the earlier answer to the same candidate withdrawn. Read against the
// scoped model, so a hidden process is neither named nor counted.
export function breadthChange(model, input) {
  const mm = model.meaning_model ?? {};
  const scoped = questionModel(model, []);
  const processes = new Map((model.processes ?? []).map((process) => [process.id, process]));
  const label = (processId) => processes.get(processId)?.scale?.label ?? processId;
  const check = breadthCheck(scoped, { label });
  const tree = input.candidate === TREE_CANDIDATE;
  const item = tree ? treeSignals(scoped) : check.all.get(input.candidate) ?? null;
  if (tree && input.answer === 'linked') throw new Error('linked answers a group of Events. A whole-tree review is answered modeled, naming a process you opened, or not_modeled, saying why nothing more is worth following now.');
  if (input.answer === 'modeled' && (input.candidate.startsWith('events:') || tree) && !input.process) throw new Error(`modeled says ${tree ? 'the review opened a process' : 'a process now follows it'}: name that process in process.`);
  if (input.process && !processes.has(input.process)) throw new Error(`process names ${input.process}, which the model does not have: open it first (life_values_record with a measure and dated values), then record the answer.`);
  if (input.answer === 'linked') {
    if (!input.candidate.startsWith('events:')) throw new Error(`linked answers a group of Events. ${input.candidate.startsWith('remainder:') ? 'A remainder is opened with a conditioned series (modeled) or kept as one share (not_modeled).' : 'A carve\'s open completeness is answered by carving again (modeled) or by saying why it stays as it is (not_modeled).'}`);
    // The Events it answers for are the group's loose ones: while any still names no process, they are not linked.
    if (item && item.events > 0) throw new Error(`linked says the group's Events now name processes, but ${item.events} Event(s) ${item.where} still name none, such as ${item.examples.map((example) => example.label).join('; ')}: name in each the process it changes (life_model_revise), or answer not_modeled for those not worth following.`);
  }
  const conceptId = input.concept.id ?? `breadth.${input.candidate.replace(/[^A-Za-z0-9._-]+/gu, '.').replace(/^\.+|\.+$/gu, '')}`.slice(0, 200);
  const concepts = new Map((mm.concepts ?? []).map((concept) => [concept.id, concept]));
  const answers = breadthAnswers(model);
  const existing = concepts.get(conceptId);
  if (existing && !existing.withdrawn) {
    const answered = [...answers.values()].find((answer) => answer.concept === conceptId);
    if (!answered) throw new Error(`concept.id names ${conceptId}, a concept of the model that is not an answer to the breadth check: give the answer an id of its own.`);
    if (answered.candidate !== input.candidate) throw new Error(`concept.id names ${conceptId}, the answer to ${answered.candidate}: give the answer to ${input.candidate} an id of its own.`);
  }
  const earlier = answers.get(input.candidate);
  const signals = item ?? { events: 0, quantities: 0, share: 0 };
  const concept = {
    id: conceptId, label: clip(input.concept.label), differentia: [], boundary: clip(input.reason), state_schema: {}, direction_families: [], observation_methods: [],
    provenance: [`${input.tag}: ${MARK} by ${input.holder}`, `${BREADTH_CANDIDATE_LINE}${input.candidate}`, signalsLine(signals), `${BREADTH_ANSWER_LINE}${input.answer}`,
      ...(input.process ? [`${FOLLOWED_LINE}${input.process}`] : []), ...chunks(input.reason, 'why: ')],
  };
  const withdrawn = earlier && earlier.concept !== conceptId && concepts.get(earlier.concept)
    ? [{ ...structuredClone(concepts.get(earlier.concept)), withdrawn: { reason: clip(`Answered again as ${conceptId}: ${input.reason}`), superseded_by: [conceptId] } }] : [];
  const change = { reason: input.reason, provenance: [MARK, `holder:${input.holder}`], upsert: { concepts: [concept, ...withdrawn] } };
  return { change, plan: { conceptId, item, earlier, check } };
}

export async function recordBreadth(service, raw) {
  const input = breadthRecordSchema.parse(raw);
  const { model: stored } = await service.inspectModel({ modelHash: input.previousModelHash, includeDefinition: true });
  const previous = stored.meaning_model ? stored : { ...stored, meaning_model: { schema: MEANING_SCHEMA } };
  const { change, plan } = breadthChange(previous, input);
  const { successor, summary } = applyModelChange(previous, input.previousModelHash, change);
  const revised = await service.reviseModel({ requestId: input.requestId, previousModelHash: input.previousModelHash, model: successor });
  const modelHash = revised.modelHash;
  const next = [];
  if (!plan.item) next.push(`The breadth check does not name ${input.candidate} on this model now; the answer is recorded with no evidence, so the candidate comes back only once it has at least two Events or quantities, or a share of 0.05 or more.`);
  if (input.answer === 'modeled' && input.process) next.push(`${input.process} follows it now: give it a measure and at least two dated values if it has not got them (the number test), and name it in the process_ids of the Events that change it.`);
  if (input.answer === 'modeled' && input.candidate.startsWith('remainder:')) next.push('Open the remainder with a conditioned series: life_series_record with conditionedOn naming the series and its remainder answer.');
  const after = breadthLine(breadthCheck(questionModel(successor, []), { label: (processId) => successor.processes.find((process) => process.id === processId)?.scale?.label ?? processId }));
  if (after) next.push(after);
  const result = { ...revised, schema: 'meaning-model-breadth-record/v1', previousModelHash: input.previousModelHash, modelHash, revisedByChange: true, change: summary,
    breadth: { candidate: input.candidate, answer: input.answer, conceptId: plan.conceptId, ...(input.process ? { process: input.process } : {}),
      signals: plan.item?.kind === 'tree' ? { processes: plan.item.processes, revision: plan.item.revision } : { events: plan.item?.events ?? 0, quantities: plan.item?.quantities ?? 0, share: plan.item?.share ?? 0 }, ...(plan.earlier ? { replaced: plan.earlier.concept } : {}) },
    graph: null, next };
  if (!input.graph) return result;
  // The graph: rebound to the revision first, so the note can name the concept it added; each step has its own request
  // id, and a failed step says what to call next.
  const scopes = [...new Set(input.graph.accessScopes)].sort();
  try {
    const prior = service.narrativeRevisionReceipt?.(`${input.requestId}:rebind`) ?? null;
    const head = prior ? { graphHash: prior.previousGraphHash } : await resolveAppendHead(service, input.graph.graphHash, `${input.requestId}:rebind`);
    const rebound = await rebindNarrativeGraph(service, { requestId: `${input.requestId}:rebind`, graphHash: head.graphHash, modelHash, accessScopes: scopes, reason: clip(`Breadth check answered: ${input.reason}`, 4_000) })
      .catch((error) => { if (/already bound to this model/u.test(error.message)) return { graphHash: head.graphHash }; throw error; });
    const base = await resolveAppendHead(service, rebound.graphHash, `${input.requestId}:note`);
    const written = await recordUnderstanding(service, { graphHash: base.graphHash, requestId: `${input.requestId}:note`, accessScopes: scopes, holder: input.holder, notes: [{
      nodeId: `note.${plan.conceptId}.r${successor.revision.number}`, kind: 'decision',
      title: clip(plan.item?.kind === 'tree' ? `Whole-tree review: ${input.concept.label}` : `Breadth check: ${input.concept.label} ${input.answer === 'not_modeled' ? 'is not followed' : input.answer === 'linked' ? 'is linked' : 'is followed'}`, 300),
      text: [plan.item?.kind === 'tree' ? `The whole-tree review read the tree of processes, ${plan.item.processes} processes at revision ${plan.item.revision}.` : `The breadth check named ${input.candidate}${plan.item?.where ? ` (Events ${plan.item.where})` : ''}.`,
        `Answer: ${input.answer.replace('_', ' ')}${input.process ? `, followed by ${input.process}` : ''}.`, '', input.reason].join('\n'),
      about: [{ record: `concept:${plan.conceptId}` }, ...(input.process ? [{ record: `process:${input.process}` }] : [])],
      data: { schema: 'meaning-model-breadth-record/v1', candidate: input.candidate, answer: input.answer, conceptId: plan.conceptId, ...(input.process ? { process: input.process } : {}) } }] });
    return { ...result, graph: { graphHash: written.graphHash, previousGraphHash: input.graph.graphHash, noteIds: written.nodeIds } };
  } catch (error) {
    return { ...result, partial: true, failure: { message: error.message },
      next: [`The model revision is registered (${modelHash}), but the decision note was not recorded: call life_breadth_record again with exactly the same input, requestId included, or record the note with life_understanding_record.`, ...next] };
  }
}

export const breadthRecordDescription = 'Answer the breadth check in the values report: is something changing that no process follows? Name the candidate by the key the check gives (a group of Events, a remainder, a carve\'s open completeness, or tree:whole for the whole-tree review, after reading the tree of processes whole) and answer linked (its Events now name processes the model has), modeled (a process now follows it, named in process) or not_modeled (considered and not followed, with why). The answer is recorded in the model as one concept for what was considered, so the check leaves the candidate out until its evidence grows by half, and by at least two (tree:whole comes back when the tree has grown by a quarter, and by at least three processes, or fifty revisions have passed); given the graph, it is also recorded as a decision note. It edits no process: link Events with life_model_revise and open processes with life_values_record, before or after.';

export function registerBreadthTools(server, service, { toolResult }) {
  server.registerTool(MARK, {
    description: breadthRecordDescription,
    inputSchema: breadthRecordSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await recordBreadth(service, input)));
}
