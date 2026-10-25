// Futures: branches of a model, each continued from one premise, so that an agent can follow what may happen under
// each answer of a forecast, each option of a decision or each assumption, or after a change to the past, and move
// between them quickly. Life Simulation's sections "Simulating implementation and following its effects" and
// "Perspective-limited rehearsal" (in the paper's revision of October 25, 2026, the companion copy this server serves)
// describe the target; none of it is implemented, and this add-on builds a first part
// inside the Meaning Model tool. Nothing here learns or runs dynamics: the agent continues each branch with the
// ordinary tools. The add-on keeps branches apart from the trunk, records what each assumes and with what
// probability, asks what each premise may change, and lays siblings side by side without totaling them.
//
// A branch is a model revision line forked from a trunk revision, plus its own narrative graph for the reasoning done
// in it (the story-chat pattern), so every existing reader works inside it unchanged. A stage is one set of siblings
// forked together from the same trunk revision and information cutoff: the answers of one forecast, the options of one
// decision (with waiting or doing nothing among them where that is meaningful), several assumptions, or a change to
// the past (a counterfactual, set beside the actual history the trunk keeps).
//
// A premise realizes a forecast answer exactly as the answer was declared: over the forecast's whole window. A branch
// that assumes a narrower timing or severity records it as a narrowing inside the premise, with no probability, so
// "a pandemic by 2032, 0.30" is never read as "a pandemic in 2029 to 2031, 0.30". The remainder is never branched: it
// stays unmodeled mass. The branches always fork: where a probability no longer means what was forecast, it is
// withheld, and the result says why, so a guess is recorded now and weighed when a forecast for it is issued.
import * as z from 'zod/v4';
import { applyModelChange } from './model-change.mjs';
import { BRANCH_GRAPH_PREFIX, BRANCH_MARK, PREMISE_MARK, branchesAlong, branchesOf, branchMarkerOf, isForkRevision, modelLineageSteps } from './model-lineage.mjs';
import { causeReport } from './cause-record.mjs';
import { cutKind, displayName, indexModel, personStateAt, questionModel, readSufficientHere } from './model-questions.mjs';
import { declaredForecast, forecastMetadata } from './forecast-metadata.mjs';
import { projectNumerics } from './viewer-numerics.mjs';
import { isSeriesReadingEvent } from './series-mark.mjs';
import { serveReadableResource } from './modeling-guidance.mjs';

export { BRANCH_MARK, branchMarkerOf, branchesAlong, isForkRevision };
export { PREMISE_MARK };
export { declaredForecast };
const RECORD_SCHEMA = 'meaning-model-future-branch/v1';
const NODE_TYPE = 'futures.branch';
const GRAPH_PREFIX = BRANCH_GRAPH_PREFIX;
const PROVENANCE = 'Meaning Model futures v1';
const MAX_INPUT_BYTES = 256 * 1024;
const CAUSAL = new Set(['causes', 'enables', 'prevents', 'constrains', 'realizes_forecast']);

const id = z.string().trim().min(1).max(256);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u, 'Use letters, digits, ".", "_" or "-", starting with a letter or digit (at most 80).');
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.number().finite();
const scopes = z.array(id).min(1).max(64);
const text = (max) => z.string().trim().min(1).max(max);
const interval = z.object({ start: time, end: time }).strict().refine((value) => value.end >= value.start, 'An interval ends at or after its start.');

const premiseSchema = z.object({
  boundary: text(400).describe('What is assumed, in one line.'),
  description: text(4_000),
  interval: interval.optional().describe('For a forecast answer, optional: its premise spans the forecast window, and a timing given here that starts inside the window is kept as a narrowing, assumed without probability; one that starts outside the window is followed as an assumption, without the answer\'s realization or probability. For a decision, the act; for an assumption or a change to the past, when it holds.'),
  participants: z.record(z.string().min(1).max(64), z.union([id, z.array(id).min(1).max(16)])).default({}),
  processIds: z.array(id).max(32).default([]).describe('Processes the premise moves. They let the model find past Events like it and what drove them.'),
}).strict();

export const forkSchema = z.object({
  requestId: id,
  stageId: key.describe('Stable ID for this set of sibling branches; part of every record ID the fork writes.'),
  title: text(300),
  trunkModelHash: hash.describe('The revision every sibling forks from: the trunk head, or a branch head for a stage inside a branch.'),
  kind: z.enum(['forecast', 'decision', 'assumption', 'counterfactual']),
  cutoff: time.describe('The information cutoff in model time: what was known when the branches start. Every sibling shares it.'),
  horizon: time.describe('How far the branches are to be followed, in model time. Each branch extends the accepted world to it where needed.'),
  forecast: z.object({
    cutId: id.describe('A forecast Cut in the trunk: its answers become the branches.'),
    window: interval.describe('The window the forecast\'s answers speak of, in model time (from the cutoff to the forecast\'s horizon). Every premise spans it. The probabilities carry for the window and cutoff the forecast was issued for; for another, the branches fork without them and say why.'),
  }).strict().optional(),
  decision: z.object({
    at: time.describe('When the choice is made.'),
    deciderId: id.optional().describe('The referent who decides.'),
    cutId: id.optional().describe('A decision Cut in the trunk whose answers are the options, if the model holds one.'),
  }).strict().optional(),
  counterfactual: z.object({
    at: time.describe('When the past changes: before the cutoff.'),
    cutId: id.optional().describe('A decision Cut the trunk already realized: each branch realizes another of its answers instead, by assumption.'),
  }).strict().optional(),
  branches: z.array(z.object({
    key: key.describe('For a forecast, the answer key; otherwise a short name for the option or assumption.'),
    premise: premiseSchema,
    narrowings: z.array(z.object({ id: key, boundary: text(400), description: text(4_000), interval }).strict()).max(8).default([])
      .describe('What this branch assumes inside its premise beyond what was forecast (a timing, a severity). Recorded without probability.'),
    baseline: z.boolean().default(false).describe('A decision option that waits or does nothing.'),
    waitsFor: z.object({ observation: text(1_000), deadline: time }).strict().optional().describe('For a waiting option: what it waits to learn, and until when.'),
  }).strict()).min(1).max(8),
  noBaseline: z.object({ reason: text(1_000) }).strict().optional().describe('For a decision where waiting or doing nothing is not a meaningful option: why.'),
  agentId: id,
  accessScopes: scopes,
}).strict();

const branchRef = z.object({ stageId: key, key }).strict();
export const listSchema = z.object({ stageId: key.optional(), accessScopes: scopes }).strict();
export const loadSchema = z.object({
  branch: branchRef,
  modelHash: hash.optional().describe('The branch head to read. By default the newest revision this server wrote on the branch line, else the one its graph is bound to.'),
  at: time.optional().describe('When to read people\'s states; by default the stage horizon.'),
  people: z.array(id).max(16).default([]),
  siblings: z.boolean().default(true).describe('Read the siblings too, to ask here what they followed and this branch has not.'),
  accessScopes: scopes,
}).strict();
export const compareSchema = z.object({
  stageId: key,
  branches: z.array(key).max(8).default([]).describe('By default every sibling of the stage.'),
  heads: z.record(key, hash).default({}).describe('Branch heads to read, by key, where not the default.'),
  at: time.optional().describe('When to read people\'s states; by default the stage horizon.'),
  people: z.array(id).max(16).default([]),
  processes: z.array(id).max(32).default([]),
  accessScopes: scopes,
}).strict();

const start = (event) => event?.interval?.start ?? null;
const end = (event) => event?.interval?.end ?? null;
const sortedScopes = (values) => [...new Set(values)].sort();
const parse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const clip = (value, max = 160) => { const plain = String(value ?? '').replace(/\s+/gu, ' ').trim(); return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain; };
const round = (value) => (Number.isFinite(value) ? +value.toPrecision(6) : value);
// Rows that show a probability also show when it is a guess for a window the forecast did not state.
const guessOf = (record) => ({ ...(record.probability?.windowStated === false ? { windowStated: false } : {}),
  ...(record.probability?.jointIncludesGuess ? { jointIncludesGuess: true } : {}) });
function bounded(raw, label) {
  if (Buffer.byteLength(JSON.stringify(raw ?? null)) > MAX_INPUT_BYTES) throw new Error(`${label} exceeds 256 KiB.`);
}

export const isPremiseRecord = (record) => (record?.provenance ?? []).includes(PREMISE_MARK);

async function definition(service, modelHash) {
  const inspected = await service.inspectModel({ modelHash, includeDefinition: true });
  if (!inspected?.model) throw new Error(`Model ${modelHash.slice(0, 12)} is unknown.`);
  return inspected.model;
}

// Strip scope-dependent readings before their process links are stripped: otherwise a private process's Cuts could
// become apparently public curves with an empty process scope. This projection is never used to write a successor.
function readModel(model, accessScopes) {
  const scoped = questionModel(model, accessScopes);
  const visible = new Set(scoped.processes.map((process) => process.id));
  const hidden = new Set((model.processes ?? []).filter((process) => !visible.has(process.id)).map((process) => process.id));
  if (!hidden.size || !model.meaning_model) return scoped;
  const index = indexModel(model), cuts = model.meaning_model.normalized_cuts ?? [];
  // A process link does not make an Event or its descendants private: a world or life may carry a private process
  // alongside public happenings. Only a series reading explicitly scoped entirely to hidden processes loses its Cuts.
  const privateReadings = new Set([...index.events.values()].filter((event) => {
    const links = [...(event.process_ids ?? []), ...(event.observation_process_ids ?? [])];
    return isSeriesReadingEvent(event) && links.length && links.every((id) => hidden.has(id));
  }).map((event) => event.id));
  const cutIds = new Set();
  for (const cut of cuts) if (privateReadings.has(cut.parent_event_id)
    || (cut.answers ?? []).some((answer) => answer.refers_to?.kind === 'process' && hidden.has(answer.refers_to.process_id))) cutIds.add(cut.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const cut of cuts) if (!cutIds.has(cut.id) && cutIds.has(cut.conditioning?.cut_id)) { cutIds.add(cut.id); changed = true; }
  }
  // A hidden reading's label and ID must not surface as a newly added Event or an agenda item. Keep any reading
  // Event that still holds a public Cut, including mixed-process Events; never hide its life or world ancestors.
  const hiddenParents = new Set(), publicParents = new Set();
  for (const cut of cuts) (cutIds.has(cut.id) ? hiddenParents : publicParents).add(cut.parent_event_id);
  const restricted = new Set([...index.events.values()].filter((event) => isSeriesReadingEvent(event)
    && (privateReadings.has(event.id) || (hiddenParents.has(event.id) && !publicParents.has(event.id)))).map((event) => event.id));
  const mm = scoped.meaning_model;
  return { ...scoped, meaning_model: { ...mm,
    events: mm.events.filter((event) => !restricted.has(event.id)),
    normalized_cuts: (mm.normalized_cuts ?? []).filter((cut) => !cutIds.has(cut.id)),
    event_relations: (mm.event_relations ?? []).filter((relation) => !restricted.has(relation.source_event_id) && !restricted.has(relation.target_event_id) && !cutIds.has(relation.forecast_answer?.cut_id)),
    event_referent_bindings: (mm.event_referent_bindings ?? []).filter((binding) => !restricted.has(binding.target?.event_id)),
    context_roots: (mm.context_roots ?? []).filter((root) => !restricted.has(root.event_id)),
    cause_questions: (mm.cause_questions ?? []).filter((question) => !restricted.has(question.outcome_event_id) && !hidden.has(question.measure?.process_id)),
  } };
}
async function scopedDefinition(service, modelHash, accessScopes) {
  return readModel(await definition(service, modelHash), accessScopes);
}

const acceptedWorldRoots = (model) => (model?.meaning_model?.context_roots ?? []).filter((root) => root.kind === 'accepted_world').map((root) => root.event_id);
// Records dated after the cutoff that the trunk already holds: the siblings inherit them, and they can contradict a
// premise or carry later knowledge into a forecast that claims to start from the cutoff.
function laterRecords(model, index, cutoff) {
  const events = [...index.events.values()].filter((event) => !index.readings.has(event.id) && start(event) !== null && start(event) > cutoff && !isPremiseRecord(event));
  const points = (model.value_series ?? []).reduce((count, series) => count + (series.points ?? []).filter((point) => point.time > cutoff).length, 0);
  return { events: events.length, examples: events.slice(0, 5).map((event) => ({ eventId: event.id, what: clip(event.boundary ?? event.id, 100), at: start(event) })), valuePoints: points };
}

function checkStage(input, trunk, index) {
  const keys = input.branches.map((branch) => branch.key);
  if (new Set(keys).size !== keys.length) throw new Error('Branch keys must be unique within a stage.');
  if (input.horizon <= input.cutoff && input.kind !== 'counterfactual') throw new Error('The horizon must lie after the cutoff.');
  const need = { forecast: 'forecast', decision: 'decision', counterfactual: 'counterfactual' }[input.kind];
  for (const field of ['forecast', 'decision', 'counterfactual']) {
    if (field === need && !input[field]) throw new Error(`A ${input.kind} stage needs ${field}.`);
    if (field !== need && input[field]) throw new Error(`${field} belongs to a ${field} stage, not a ${input.kind} stage.`);
  }
  // A decision compares options; a single what-if, a single forecast answer or a single change to the past may be
  // followed alone, and the result says the others stay unmodeled.
  if (input.kind === 'decision' && input.branches.length < 2) {
    throw new Error('A decision stage compares at least two options, one of them waiting or doing nothing unless noBaseline says why not. To follow one course alone, fork it as an assumption stage.');
  }
  const notes = [];
  if (input.branches.length === 1 && input.kind !== 'counterfactual') notes.push(`Only ${input.branches[0].key} is followed; the other futures stay unmodeled. Fork them too when you want to compare.`);
  for (const branch of input.branches) {
    if (input.kind !== 'decision' && (branch.baseline || branch.waitsFor)) throw new Error(`${branch.key}: baseline and waitsFor belong to decision options.`);
    if (branch.waitsFor && !branch.baseline) throw new Error(`${branch.key}: waitsFor describes a waiting option; mark it baseline.`);
  }
  const probability = new Map();
  let forecastCut = null;
  let forecast = null;
  if (input.kind === 'forecast') {
    const { cutId, window } = input.forecast;
    forecastCut = index.cuts.find((cut) => cut.id === cutId) ?? null;
    if (!forecastCut) throw new Error(`${cutId} is not a Cut in the trunk revision.`);
    const answers = new Map((forecastCut.answers ?? []).map((answer) => [answer.key, answer]));
    for (const branch of input.branches) {
      if (branch.key === 'remainder') throw new Error('The remainder is not branched: it is what the forecast leaves unnamed, and it stays unmodeled mass. Name what you want to follow as an assumption stage.');
      if (!answers.has(branch.key)) throw new Error(`${branch.key} is not an answer of ${cutId} (answers: ${[...answers.keys()].join(', ')}).`);
    }
    if (index.relations.some((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id === cutId)) {
      throw new Error(`${cutId} is already settled in the trunk: an outcome realizes it. Score it rather than branch on it, or fork what you want to explore as an assumption stage.`);
    }
    // The branches always fork. What can be withheld is the probability: it carries only where it still means what was
    // forecast, and every withheld probability says why, so the agent can record the missing piece and fork again.
    forecast = forecastMetadata(forecastCut);
    const changedWindow = forecast.binding && (window.start !== forecast.binding.window.start || window.end !== forecast.binding.window.end);
    // Reusing an answer and reusing its probability are separate questions. A new cutoff can leave the outcome
    // unchanged; a new window cannot establish that from an arbitrary question/answer key. In particular, "no" in
    // a shorter window need not mean "no" in the issued window. Keep such branches as assumptions. To explore a
    // timing within the original answer, retain the issued window and supply a premise timing or narrowing instead.
    const realizationProblem = forecast.invalid
      ? `The branch does not realize ${cutId}: ${forecast.problem}`
      : changedWindow ? `The branch assumes the requested window without realizing ${cutId}'s issued answer. Keep the issued window and add a narrowing to explore a timing within that answer.` : null;
    if (realizationProblem) {
      for (const branch of input.branches) branch.forecastRealizationProblem = realizationProblem;
      notes.push(realizationProblem);
    }
    let withheld = null;
    if (forecast.invalid) withheld = forecast.problem;
    else if (!forecast.declared) withheld = `${cutId} does not say its weights are probabilities (for example "forecast: probabilities declared before the outcome"), so the branches carry no likelihood.`;
    else if (forecast.binding && (input.cutoff !== forecast.binding.cutoff || window.start !== forecast.binding.window.start || window.end !== forecast.binding.window.end)) {
      withheld = `${cutId} was issued at cutoff ${forecast.binding.cutoff} for the window ${forecast.binding.window.start} to ${forecast.binding.window.end}; this stage asks about cutoff ${input.cutoff} and the window ${window.start} to ${window.end}, so its probabilities do not carry. Issue a forecast for this question to weigh these branches.`;
    } else if (window.start < input.cutoff) withheld = `The forecast window starts at ${window.start}, before this stage's cutoff ${input.cutoff}: the forecast does not know what happened since, so its probabilities do not carry.`;
    if (withheld) notes.push(withheld);
    else {
      if (!forecast.binding) notes.push(`${forecast.problem} The probabilities are carried as guesses for that window.`);
      else if (forecast.problem) notes.push(forecast.problem);
      for (const branch of input.branches) if (!branch.outsideWindow) probability.set(branch.key, answers.get(branch.key).weight);
    }
  }
  if (input.kind === 'decision') {
    const { at, deciderId, cutId } = input.decision;
    if (at < input.cutoff) throw new Error(`The choice is made at ${at}, before the cutoff ${input.cutoff}. A choice already made belongs to the trunk; a different past choice is a counterfactual stage.`);
    if (deciderId && !index.referents.has(deciderId)) throw new Error(`${deciderId} is not a referent in the trunk revision.`);
    if (cutId) {
      const cut = index.cuts.find((item) => item.id === cutId);
      if (!cut) throw new Error(`${cutId} is not a Cut in the trunk revision.`);
      const answers = new Set((cut.answers ?? []).map((answer) => answer.key));
      // Waiting is an option of the stage but not necessarily of the modeled choice: a branch that waits leaves the Cut open.
      for (const branch of input.branches) if (!branch.baseline && !answers.has(branch.key)) throw new Error(`${branch.key} is not an option of ${cutId} (options: ${[...answers].join(', ')}).`);
      if (index.relations.some((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id === cutId)) throw new Error(`${cutId} is already decided in the trunk.`);
    }
    const baselines = input.branches.filter((branch) => branch.baseline);
    // Doing nothing is the comparison a decision most often lacks; its absence is asked about, not refused.
    if (!baselines.length && !input.noBaseline) {
      notes.push('No option waits or does nothing, and noBaseline does not say why, so these options are not compared with doing nothing. Fork that option beside them, or say why it is not meaningful here.');
    }
    if (baselines.length && input.noBaseline) throw new Error('Give a baseline option or noBaseline, not both.');
  }
  if (input.kind === 'counterfactual' && input.counterfactual.at >= input.cutoff) {
    throw new Error(`A change to the past comes before the cutoff; ${input.counterfactual.at} is not before ${input.cutoff}. A change at or after the cutoff is a decision or an assumption stage.`);
  }
  if (input.kind === 'counterfactual' && input.counterfactual.cutId) {
    const { cutId } = input.counterfactual;
    const cut = index.cuts.find((item) => item.id === cutId);
    if (!cut) throw new Error(`${cutId} is not a Cut in the trunk revision.`);
    const actual = index.relations.find((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id === cutId) ?? null;
    if (!actual) throw new Error(`${cutId} is not realized in the trunk, so nothing in the past changes: fork its answers as a decision or forecast stage instead.`);
    const answers = new Set((cut.answers ?? []).map((answer) => answer.key));
    for (const branch of input.branches) {
      if (branch.key === 'remainder') throw new Error('Name the other continuation rather than branching on the remainder.');
      if (!answers.has(branch.key)) throw new Error(`${branch.key} is not an answer of ${cutId} (answers: ${[...answers].join(', ')}).`);
      if (branch.key === actual.forecast_answer.answer_key) throw new Error(`${branch.key} is what actually happened in the trunk; a counterfactual branch takes another answer.`);
    }
  }
  return { probability, forecastCut, forecast, notes };
}

// The premise's interval: a forecast answer spans the window (continuing past it where a narrowing does, or at its own
// timing when that starts outside the window); a decision defaults to the moment of choice.
function premiseInterval(input, branch) {
  if (input.kind === 'forecast') return { ...(branch.premise.interval ?? input.forecast.window) };
  const given = branch.premise.interval ?? (input.kind === 'decision' ? { start: input.decision.at, end: input.decision.at } : null);
  if (!given) throw new Error(`${branch.key}: give the premise's interval.`);
  if (input.kind === 'decision' && given.start < input.decision.at) throw new Error(`${branch.key}: the option starts at ${given.start}, before the choice at ${input.decision.at}.`);
  if (input.kind === 'assumption' && given.start < input.cutoff) throw new Error(`${branch.key}: an assumption about the future starts at or after the cutoff ${input.cutoff}.`);
  if (input.kind === 'counterfactual' && given.start !== input.counterfactual.at) throw new Error(`${branch.key}: the changed past starts when the past changes, at ${input.counterfactual.at}.`);
  if (given.end > input.horizon) throw new Error(`${branch.key}: the premise ends at ${given.end}, after the horizon ${input.horizon}.`);
  return given;
}

// The fork revision of one sibling: the trunk with the premise and its narrowings in the accepted world, the accepted
// world extended to the horizon where it ended earlier, and, for a forecast answer or a modeled decision, the Cut
// realized by assumption. Everything the fork writes carries the premise mark, and the revision carries the branch
// marker, so no reader can take the premise for an observation.
function forkChange(input, trunk, index, branch, marker) {
  const stem = `future.${input.stageId}.${branch.key}`;
  const premiseId = `${stem}.premise`;
  const span = premiseInterval(input, branch);
  for (const narrowing of branch.narrowings) {
    if (narrowing.interval.start < span.start || narrowing.interval.end > span.end) throw new Error(`${branch.key}: narrowing ${narrowing.id} must lie within the premise (${span.start} to ${span.end}).`);
  }
  for (const processId of branch.premise.processIds) if (!index.processList.some((process) => process.id === processId)) throw new Error(`${branch.key}: ${processId} is not a process of the trunk.`);
  for (const value of Object.values(branch.premise.participants).flat()) if (!index.referents.has(value)) throw new Error(`${branch.key}: participant ${value} is not a referent of the trunk.`);
  const assumed = `assumed: premise of branch ${branch.key} of stage ${input.stageId}, not an observation`;
  const participants = input.kind === 'decision' && input.decision.deciderId && !Object.keys(branch.premise.participants).length
    ? { actor: input.decision.deciderId } : branch.premise.participants;
  const eventOf = (eventId, boundary, description, interval, extra = {}) => ({ id: eventId, boundary, description, interval, participants: {}, process_ids: [],
    observation_process_ids: [], region: null, substrate: null, ...extra });
  const relation = (relationId, kind, source, target, description, extra = {}) => ({ id: relationId, kind, source_event_id: source, target_event_id: target,
    description, authority: null, uncertainty: { kind: 'unknown' }, provenance: [PREMISE_MARK, assumed], ...extra });
  const events = [eventOf(premiseId, branch.premise.boundary, branch.premise.description, span,
    { participants, process_ids: branch.premise.processIds,
      provenance: [PREMISE_MARK, `${PREMISE_MARK} ${JSON.stringify({ stageId: input.stageId, branch: branch.key, kind: input.kind, depth: marker.depth })}`, assumed] })];
  const relations = [];
  const roots = acceptedWorldRoots(trunk);
  const reach = Math.max(input.horizon, span.end, ...branch.narrowings.map((narrowing) => narrowing.interval.end));
  for (const rootId of roots.slice(0, 1)) {
    const world = index.events.get(rootId);
    if (world?.interval && world.interval.end < reach) {
      events.push({ ...structuredClone(world), interval: { start: world.interval.start, end: reach },
        provenance: [...new Set([...(world.provenance ?? []), `extended to ${reach} in branch ${branch.key} of stage ${input.stageId}`])] });
    }
    if (world?.interval && world.interval.start > span.start) throw new Error(`${branch.key}: the premise starts at ${span.start}, before the accepted world (${world.interval.start}).`);
    relations.push(relation(`${premiseId}.in.${rootId}`, 'contains', rootId, premiseId, 'The branch places its premise in the accepted world it assumes.'));
  }
  for (const narrowing of branch.narrowings) {
    const narrowingId = `${stem}.${narrowing.id}`;
    events.push(eventOf(narrowingId, narrowing.boundary, narrowing.description, narrowing.interval,
      { provenance: [PREMISE_MARK, `${assumed}; a narrowing inside the premise, assumed without probability`] }));
    relations.push(relation(`${narrowingId}.in.premise`, 'contains', premiseId, narrowingId, 'A narrower assumption inside the premise, with no probability of its own.'));
  }
  const realizedCutId = input.kind === 'forecast' ? input.forecast.cutId : input.kind === 'decision' ? input.decision.cutId
    : input.kind === 'counterfactual' ? input.counterfactual.cutId : null;
  const realized = realizedCutId ? index.cuts.find((cut) => cut.id === realizedCutId) ?? null : null;
  // A changed past choice: the branch drops the trunk's realization of it and realizes the branch's answer instead. The
  // Event that realized it in the actual history stays, and the branch is asked whether it still happens.
  const dropped = input.kind === 'counterfactual' && realized
    ? index.relations.filter((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id === realized.id).map((relation) => relation.id) : [];
  // A changed issued outcome or timing outside its window does not realize that answer: it is only an assumption.
  if (realized && !branch.outsideWindow && !branch.forecastRealizationProblem && (realized.answers ?? []).some((answer) => answer.key === branch.key)) {
    relations.push(relation(`${premiseId}.realizes`, 'realizes_forecast', realized.parent_event_id, premiseId,
      `Assumed by the branch, not observed: ${branch.key} of ${realized.id}.`, { forecast_answer: { cut_id: realized.id, answer_key: branch.key } }));
  }
  const reason = `Fork branch ${branch.key} of stage ${input.stageId} (${input.kind}): ${clip(branch.premise.boundary, 300)}`;
  return { premiseId, span, change: { reason, provenance: ['life_future_fork', `${BRANCH_MARK} ${JSON.stringify(marker)}`],
    upsert: { events, event_relations: relations }, ...(dropped.length ? { remove: { event_relations: dropped } } : {}) } };
}

function branchNode(record, input, accessScopes) {
  return { id: `future.${input.stageId}.${record.key}`, node_type: NODE_TYPE, role: 'metadata', text: JSON.stringify(record), holder: input.agentId,
    subject: record.premise.eventId, render: 'exclude', training: 'exclude', epistemic_status: 'hypothetical_branch', evidence_type: 'creative_hypothesis',
    authority: { source: input.agentId, weight: 1 }, access_scopes: accessScopes, uncertainty: { kind: 'unknown' },
    provenance: [PROVENANCE, `agent:${input.agentId}`, `stage:${input.stageId}`] };
}

export async function forkStage(service, raw) {
  bounded(raw, 'A fork');
  const input = forkSchema.parse(raw);
  const accessScopes = sortedScopes(input.accessScopes);
  const trunk = await definition(service, input.trunkModelHash);
  const index = indexModel(trunk);
  const shaped = [];
  // A timing given with a forecast answer's premise is kept. One that starts inside the forecast window becomes a
  // narrowing, assumed without probability, and the premise spans the window, continuing as far as the timing does.
  // One that starts outside the window is not what was forecast: the branch assumes it at that timing, without the
  // answer's realization or probability.
  if (input.kind === 'forecast' && input.forecast) for (const branch of input.branches) {
    const given = branch.premise.interval, window = input.forecast.window;
    if (!given) continue;
    if (given.start === window.start && given.end === window.end) delete branch.premise.interval;
    else if (given.start >= window.start && (window.start === window.end ? given.start === window.start : given.start < window.end)) {
      const ids = new Set(branch.narrowings.map((narrowing) => narrowing.id));
      let narrowingId = 'timing'; for (let n = 2; ids.has(narrowingId); n += 1) narrowingId = `timing-${n}`;
      branch.narrowings.push({ id: narrowingId, boundary: `${branch.premise.boundary} (timing assumed: ${given.start} to ${given.end})`,
        description: 'The timing given with the premise, assumed without probability.', interval: given });
      if (given.end > window.end) branch.premise.interval = { start: window.start, end: given.end };
      else delete branch.premise.interval;
      shaped.push(`${branch.key}: the timing ${given.start} to ${given.end} is recorded as a narrowing, without probability; the premise spans the forecast window${given.end > window.end ? ` and continues to ${given.end}` : ''}.`);
    } else {
      branch.outsideWindow = true;
      shaped.push(`${branch.key}: the timing ${given.start} to ${given.end} starts outside the forecast window ${window.start} to ${window.end}, so the branch assumes it as given, without realizing ${input.forecast.cutId} or carrying its probability.${given.start < input.cutoff ? ` It starts before the cutoff ${input.cutoff}, so it changes the past: fork it as a counterfactual to set it beside the actual history.` : ''}`);
    }
  }
  // The horizon reaches at least the end of every premise and narrowing.
  const ends = [input.horizon, ...(input.kind === 'forecast' && input.forecast ? [input.forecast.window.end] : []),
    ...(input.kind === 'decision' && input.decision ? [input.decision.at] : []),
    ...input.branches.flatMap((branch) => [branch.premise.interval?.end ?? -Infinity, ...branch.narrowings.map((narrowing) => narrowing.interval.end)])];
  if (Math.max(...ends) > input.horizon) { shaped.push(`The horizon is extended from ${input.horizon} to ${Math.max(...ends)}, the end of what the branches assume.`); input.horizon = Math.max(...ends); }
  const { probability, forecastCut, forecast, notes } = checkStage(input, trunk, index);
  // Branch ancestry is authoritative model history, including imported and model-only branches.
  const outer = await branchesOf(service, input.trunkModelHash);
  if (outer.truncated) throw new Error('The trunk\'s branch ancestry could not be established completely; do not fork a stage with unknown conditioning.');
  const parent = outer.branches[0] ?? null;
  // Inside a branch, a forecast issued before that branch forked does not condition on its premise: multiplying the
  // two probabilities assumes they are independent, and the result says so.
  let independence = null;
  if (parent && forecastCut) {
    const parentTrunk = await definition(service, parent.trunk);
    if ((parentTrunk.meaning_model?.normalized_cuts ?? []).some((cut) => cut.id === forecastCut.id)) {
      independence = `${forecastCut.id} was issued before branch ${parent.branch} of ${parent.stageId} forked, so it does not condition on that premise; the joint probability assumes the two are independent.`;
    }
  }
  // A branch's probability is conditional on the branches it lies in; the joint probability multiplies along them and is
  // unknown once any of them is a decision, an assumption or a forecast without declared probabilities.
  const parentJoint = parent ? (parent.joint ?? null) : 1;
  const joint = (value) => (value === null || parentJoint === null ? null : round(parentJoint * value));
  // A probability carried for a window the forecast did not state is a guess; a joint that multiplies one says so.
  const guessed = input.kind === 'forecast' && forecast && !forecast.binding;
  const parentGuessed = Boolean(parent && (parent.windowStated === false || parent.jointIncludesGuess));
  const guessFlags = (value) => ({ ...(value !== null && guessed ? { windowStated: false } : {}),
    ...(joint(value) !== null && (parentGuessed || (parent && value !== null && guessed)) ? { jointIncludesGuess: true } : {}) });
  const forks = input.branches.map((branch) => {
    const value = probability.has(branch.key) ? probability.get(branch.key) : null;
    const marker = { stageId: input.stageId, branch: branch.key, kind: input.kind, trunk: input.trunkModelHash, cutoff: input.cutoff, horizon: input.horizon,
      probability: value, joint: joint(value), ...guessFlags(value), depth: (parent?.depth ?? (parent ? 1 : 0)) + 1, ...(parent ? { within: { stageId: parent.stageId, branch: parent.branch } } : {}) };
    const built = forkChange(input, trunk, index, branch, marker);
    return { branch, value, marker, ...built, ...applyModelChange(trunk, input.trunkModelHash, built.change) };
  });
  // Validate every sibling before writing any, so a stage is not left half forked by an invalid premise.
  for (const fork of forks) {
    try { await service.validateModel({ model: fork.successor }); }
    catch (error) { throw new Error(`Branch ${fork.branch.key} would not be a valid model, so nothing was written: ${error.message}`); }
  }
  const unnamed = probability.size && forks.every((fork) => fork.value !== null) ? round(1 - forks.reduce((sum, fork) => sum + fork.value, 0)) : null;
  const written = [];
  for (const fork of forks) {
    const revised = await service.reviseModel({ requestId: `${input.requestId}:${fork.branch.key}`, previousModelHash: input.trunkModelHash, model: fork.successor });
    const record = {
      schema: RECORD_SCHEMA, stageId: input.stageId, key: fork.branch.key, title: input.title, kind: input.kind,
      trunk: { modelHash: input.trunkModelHash, cutoff: input.cutoff }, horizon: input.horizon, forkModelHash: revised.modelHash,
      premise: { eventId: fork.premiseId, boundary: fork.branch.premise.boundary, interval: fork.span },
      narrowings: fork.branch.narrowings.map((narrowing) => ({ eventId: `future.${input.stageId}.${fork.branch.key}.${narrowing.id}`, boundary: narrowing.boundary, interval: narrowing.interval })),
      probability: fork.value === null ? null : { value: fork.value, of: forecastCut.id, answer: fork.branch.key,
        meaning: fork.branch.narrowings.length ? 'the forecast\'s probability of this answer over the whole window, not of the narrowings, which are assumed' : 'the forecast\'s probability of this answer over the whole window',
        question: forecast.binding?.question ?? forecastCut.question, unit: forecast.binding?.unit ?? forecastCut.unit,
        window: forecast.binding?.window ?? { ...input.forecast.window }, settledBy: forecast.binding?.settledBy ?? null,
        ...guessFlags(fork.value),
        ...(parent ? { joint: joint(fork.value), ...(independence ? { assumesIndependence: independence } : {}) } : {}) },
      ...(input.kind === 'forecast' && fork.value === null ? { weights: fork.branch.outsideWindow ? 'The branch assumes a timing that starts outside the forecast window, so it neither realizes the forecast answer nor carries its probability.' : notes.filter((note) => !/^Only /u.test(note)).join(' ') || 'No probability carries.' } : {}),
      ...(input.kind === 'decision' ? { decision: { at: input.decision.at, deciderId: input.decision.deciderId ?? null, cutId: input.decision.cutId ?? null },
        baseline: fork.branch.baseline, ...(fork.branch.waitsFor ? { waitsFor: fork.branch.waitsFor } : {}), ...(input.noBaseline ? { noBaseline: input.noBaseline.reason } : {}),
        ...(!input.noBaseline && !input.branches.some((branch) => branch.baseline) ? { baselineMissing: true } : {}) } : {}),
      ...(input.kind === 'counterfactual' ? { divergence: input.counterfactual.at, ...(input.counterfactual.cutId ? { counterfactual: { cutId: input.counterfactual.cutId } } : {}) } : {}),
      ...(parent ? { within: { stageId: parent.stageId, branch: parent.branch, forkModelHash: parent.forkModelHash } } : {}),
      siblings: input.branches.map((branch) => branch.key), ...(unnamed !== null ? { unnamedMass: unnamed } : {}),
      resolution: { status: 'open' }, agentId: input.agentId,
    };
    const provenance = [PROVENANCE, `agent:${input.agentId}`, `stage:${input.stageId}`];
    const registered = await service.registerNarrativeGraph({ requestId: `${input.requestId}:${fork.branch.key}:graph`, narrativeGraph: {
      schema: 'life-sim-rust-narrative-graph/v1', id: `${GRAPH_PREFIX}${input.stageId}.${fork.branch.key}`,
      revision: { number: 0, reason: `Open branch ${fork.branch.key} of stage ${input.stageId}: ${clip(fork.branch.premise.boundary, 300)}`, provenance },
      source: { kind: 'model', model_hash: revised.modelHash }, roots: [`future.${input.stageId}.${fork.branch.key}`],
      nodes: [branchNode(record, input, accessScopes)], edges: [] } });
    written.push({ key: fork.branch.key, modelHash: revised.modelHash, graphHash: registered.graphHash, premiseEventId: fork.premiseId,
      probability: record.probability?.value ?? null, ...(record.probability?.joint !== undefined ? { jointProbability: record.probability.joint } : {}),
      ...guessOf(record), ...(fork.branch.baseline ? { baseline: true } : {}) });
  }
  // Successors retain the full trunk; scope filtering applies only to the information returned to this reader.
  const visibleTrunk = readModel(trunk, accessScopes);
  const later = laterRecords(visibleTrunk, indexModel(visibleTrunk), input.cutoff);
  const warnings = [
    ...(later.events || later.valuePoints ? [`The trunk already holds ${later.events} Events and ${later.valuePoints} value points dated after the cutoff ${input.cutoff}; every sibling inherits them. Check that none contradicts a premise, and do not read them as known at the cutoff.`] : []),
    ...shaped, ...notes,
    ...(independence ? [independence] : []),
  ];
  return {
    schema: 'meaning-model-future-fork/v1', stageId: input.stageId, kind: input.kind, trunkModelHash: input.trunkModelHash, cutoff: input.cutoff, horizon: input.horizon,
    ...(parent ? { within: { stageId: parent.stageId, branch: parent.branch } } : {}),
    branches: written, ...(unnamed !== null ? { unnamedMass: unnamed, unnamedMeaning: 'the forecast\'s remainder and any answers not branched: modeled in no branch' } : {}),
    ...(later.events || later.valuePoints ? { laterRecords: later } : {}), warnings, graphMutation: true, worldMutation: true,
    nextStep: 'Continue each branch with the ordinary tools: revise its model from the branch\'s modelHash (life_model_revise, life_values_record, life_series_record, life_cause_record), rebind its graph to the new head with life_narrative_rebind, and record your reasoning in its graph with life_understanding_record. life_future_load gives a branch\'s digest and its open consequence questions; life_future_compare sets the siblings side by side. Develop every sibling, not only the striking one.',
  };
}

// Branch graphs, by stage, from the engine's revision listing: each graph's newest revision and its record.
async function readBranches(service, accessScopes, stageId = null) {
  const listing = await service.listNarrativeRevisions({});
  const heads = (listing?.revisions ?? []).filter((revision) => revision.is_head && String(revision.graph_id).startsWith(GRAPH_PREFIX)
    && (!stageId || String(revision.graph_id).startsWith(`${GRAPH_PREFIX}${stageId}.`)));
  const branches = [];
  for (const head of heads) {
    const view = await service.queryNarrativeGraph({ graphHash: head.graph_hash, mode: 'full', includeContent: true, accessScopes });
    const node = view.nodes.find((item) => item.node_type === NODE_TYPE);
    const record = node ? parse(node.text) : null;
    if (record?.schema !== RECORD_SCHEMA || (stageId && record.stageId !== stageId)) continue;
    const bound = view.graph?.source?.kind === 'model' ? view.graph.source.model_hash : record.forkModelHash;
    branches.push({ record, graphHash: head.graph_hash, graphId: head.graph_id, boundModelHash: bound, view });
  }
  // Two heads of one branch graph mean its graph was forked; the listing names both, and neither is chosen silently.
  const byId = new Map();
  for (const branch of branches) byId.set(branch.graphId, [...(byId.get(branch.graphId) ?? []), branch]);
  return { branches, forkedGraphs: [...byId.entries()].filter(([, list]) => list.length > 1).map(([graphId, list]) => ({ graphId, heads: list.map((item) => item.graphHash) })) };
}

// The branch head to read: the one asked for (on the branch line), else the newest revision this server wrote on the
// line, which never crosses into a stage forked inside the branch, else the revision the branch graph is bound to.
async function branchHead(service, branch, asked = null) {
  const fork = branch.record.forkModelHash;
  if (asked) {
    if ((await modelLineageSteps(service, fork, asked)) === null) throw new Error(`${asked.slice(0, 12)} is not on branch ${branch.record.key} of ${branch.record.stageId}: it does not descend from the fork revision ${fork.slice(0, 12)}.`);
    const inner = await branchesAlong(service, asked, { stopAt: fork });
    if (inner.branches.length) throw new Error(`${asked.slice(0, 12)} lies in branch ${inner.branches[0].branch} of stage ${inner.branches[0].stageId}, inside this one; load that branch instead.`);
    return asked;
  }
  const newest = typeof service.newestModelDescendant === 'function' ? service.newestModelDescendant(branch.boundModelHash) : branch.boundModelHash;
  return newest ?? branch.boundModelHash;
}

// What a branch adds to the trunk revision it forked from.
function added(trunkIndex, head, headIndex, record) {
  const events = [...headIndex.events.values()].filter((event) => !trunkIndex.events.has(event.id));
  const changed = [...headIndex.events.values()].filter((event) => trunkIndex.events.has(event.id) && JSON.stringify(event) !== JSON.stringify(trunkIndex.events.get(event.id)));
  const relations = headIndex.relations.filter((relation) => !trunkIndex.relations.some((item) => item.id === relation.id));
  const cuts = headIndex.cuts.filter((cut) => !trunkIndex.cuts.some((item) => item.id === cut.id && JSON.stringify(item) === JSON.stringify(cut)));
  // The branch's own values: points from its premise on that the trunk does not hold, so a change to the past is not
  // credited with the actual history it inherits.
  const from = record.premise.interval.start;
  const pointKey = (point) => JSON.stringify(point);
  const trunkPoints = new Map((trunkIndex.model?.value_series ?? []).map((series) => [series.id, new Set((series.points ?? []).map(pointKey))]));
  const values = (head.value_series ?? []).map((series) => ({ processId: series.process_id, holder: series.holder,
    points: (series.points ?? []).filter((point) => point.time >= from && !trunkPoints.get(series.id)?.has(pointKey(point)))
      .map(({ time, ...point }) => ({ at: time, ...structuredClone(point) })) }))
    .filter((series) => series.points.length);
  const series = cutSeries(head, cuts, from);
  return { events, changed, relations, cuts, values, series };
}

// life_series_record represents a process as repeated Cuts, not native value_series. Readings belong to one series when
// they share subject, question, unit, answer keys and references, perspective and conditioning; a reworded answer meaning is shown,
// not treated as a different series, so revising a description does not split what is being followed.
function cutSeries(model, changedCuts, from) {
  const changed = new Set(changedCuts.map((cut) => cut.id));
  const groups = new Map();
  const vocabulary = (answers) => [...answers].sort((a, b) => a.key.localeCompare(b.key)).map(({ key, meaning, refers_to }) => ({ key,
    ...(meaning !== undefined ? { meaning } : {}), ...(refers_to ? { refersTo: refers_to } : {}) }));
  const references = (answers) => vocabulary(answers).filter((answer) => answer.refersTo).map(({ key, refersTo }) => ({ key, refersTo }));
  const context = (contexts) => (contexts ?? []).map(({ rootId, kind, holder }) => ({ rootId, kind, holder })).sort((a, b) => a.rootId.localeCompare(b.rootId));
  for (const cut of projectNumerics(model).cuts) {
    // An inherited child also changes meaning when an ancestor's denominator or reference is revised.
    const affected = changed.has(cut.id) || (cut.conditioningChain ?? []).some((parent) => changed.has(parent.cutId));
    if (!/^cut\.series\./u.test(cut.id) || !affected || !Number.isFinite(cut.t)
      || (cut.end > cut.t ? cut.end <= from : cut.t < from)) continue;
    const subject = [cut.participants?.subject].flat().find((value) => typeof value === 'string') ?? null;
    const conditioning = (cut.conditioningChain ?? []).map((parent) => ({ question: parent.question, unit: parent.unit, answerKey: parent.answerKey,
      answerKeys: vocabulary(parent.answers).map((answer) => answer.key), answerReferences: references(parent.answers),
      perspective: context(parent.contexts), contextStatus: parent.contextStatus, status: parent.status }));
    const conditioningMeanings = (cut.conditioningChain ?? []).map((parent) => vocabulary(parent.answers));
    const identity = { subject, question: cut.question, unit: cut.unit, answerKeys: vocabulary(cut.answers).map((answer) => answer.key),
      answerReferences: references(cut.answers),
      perspective: context(cut.contexts), contextStatus: cut.contextStatus,
      conditioning };
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, { key, ...identity, answers: vocabulary(cut.answers), conditioningMeanings, readings: [] });
    else if (JSON.stringify(groups.get(key).answers) !== JSON.stringify(vocabulary(cut.answers))
      || JSON.stringify(groups.get(key).conditioningMeanings) !== JSON.stringify(conditioningMeanings)) groups.get(key).wordingDiffers = true;
    groups.get(key).readings.push({ cutId: cut.id, eventId: cut.parentEventId, from: cut.t, to: cut.end,
      answers: structuredClone(cut.answers), provenance: structuredClone(cut.provenance ?? []),
      ...(cut.conditioning ? { conditioning: structuredClone(cut.conditioning), conditioningChain: structuredClone(cut.conditioningChain) } : {}) });
  }
  return [...groups.values()].map((series) => ({ ...series, readings: series.readings.sort((a, b) => a.from - b.from || a.to - b.to || a.cutId.localeCompare(b.cutId)) }));
}

// Events reachable from the premise along containment and causal links: the consequences the branch traces to it.
function traced(headIndex, roots) {
  const next = new Map();
  const link = (from, to) => { if (!next.has(from)) next.set(from, []); next.get(from).push(to); };
  for (const relation of headIndex.relations) if (relation.kind === 'contains' || CAUSAL.has(relation.kind)) link(relation.source_event_id, relation.target_event_id);
  const seen = new Set(roots); const queue = [...roots];
  while (queue.length) for (const target of next.get(queue.shift()) ?? []) if (!seen.has(target)) { seen.add(target); queue.push(target); }
  return seen;
}

// The most connected processes: carried by the most Events, then with the most recorded points.
function principalProcesses(model, index, limit) {
  const carried = new Map();
  for (const event of index.events.values()) for (const processId of [...(event.process_ids ?? []), ...(event.observation_process_ids ?? [])]) carried.set(processId, (carried.get(processId) ?? 0) + 1);
  const points = new Map();
  for (const series of model.value_series ?? []) points.set(series.process_id, (points.get(series.process_id) ?? 0) + (series.points ?? []).length);
  return index.processList.map((process) => ({ id: process.id, meaning: process.scale?.semantic_role ?? null, carried: carried.get(process.id) ?? 0, points: points.get(process.id) ?? 0 }))
    .filter((process) => process.carried || process.points).sort((a, b) => b.carried - a.carried || b.points - a.points || a.id.localeCompare(b.id)).slice(0, limit);
}

// Past Events like the premise and what drove them, by the model's own weighed causes. Like means declared so (an about
// or other relation from the premise, a narrowing, or the forecast the premise realizes) or sharing a process the
// premise moves over a comparable span: a century-long trend is not like a pandemic. The list comes from the model,
// so the analogues are not chosen to fit the branch.
function analogues(trunk, trunkIndex, headIndex, roots, record, limit = 5) {
  const moved = new Set(roots.flatMap((eventId) => headIndex.events.get(eventId)?.process_ids ?? []));
  const sources = new Set([...roots, ...headIndex.relations.filter((relation) => relation.kind === 'realizes_forecast' && roots.includes(relation.target_event_id))
    .map((relation) => relation.source_event_id)]);
  const referred = new Set(headIndex.relations.filter((relation) => sources.has(relation.source_event_id) && ['about', 'other'].includes(relation.kind)).map((relation) => relation.target_event_id));
  const premise = record.premise.interval;
  const span = Math.max(premise.end - premise.start, record.horizon - premise.start, 1);
  const comparable = (event) => end(event) === null || end(event) - start(event) <= 3 * span;
  const questions = trunk.meaning_model?.cause_questions ?? [];
  const weighed = new Set(questions.map((question) => question.outcome_event_id));
  const found = [...trunkIndex.events.values()].filter((event) => !trunkIndex.readings.has(event.id) && !isPremiseRecord(event) && start(event) !== null && start(event) < record.trunk.cutoff
    && (referred.has(event.id) || ((event.process_ids ?? []).some((processId) => moved.has(processId)) && comparable(event))))
    .sort((a, b) => Number(referred.has(b.id)) - Number(referred.has(a.id)) || Number(weighed.has(b.id)) - Number(weighed.has(a.id)) || start(b) - start(a)).slice(0, limit);
  return found.map((event) => {
    const asked = questions.filter((question) => question.outcome_event_id === event.id).map((question) => question.id);
    const report = asked.length ? causeReport(trunk, { questionIds: asked, limit: 4 }) : null;
    // At most three drivers per analogue, the largest of each question first, so one well-weighed analogue does not
    // crowd out the others.
    const drivers = (report?.questions ?? []).flatMap((question) => (question.ranked ?? []).slice(0, 3).map((cause) => ({
      cause: cause.cause, label: cause.label, kind: cause.kind, difference: cause.difference, measure: question.measure, contrast: question.contrast, rank: cause.rank })))
      .sort((a, b) => a.rank - b.rank).filter((driver, index, all) => all.findIndex((other) => other.cause === driver.cause) === index).slice(0, 3);
    return { eventId: event.id, what: clip(event.boundary ?? event.id, 120), at: start(event), drivers };
  });
}

// The questions a premise raises in its branch, each closed by modeling it or by a "sufficient here" note in the
// branch graph that says why it does not matter here.
function agenda({ record, trunk, trunkIndex, head, headIndex, delta, siblings, sufficient }) {
  const items = [];
  const premise = headIndex.events.get(record.premise.eventId);
  const roots = [record.premise.eventId, ...record.narrowings.map((narrowing) => narrowing.eventId)];
  const reach = traced(headIndex, roots);
  const untraced = delta.events.filter((event) => !reach.has(event.id));
  for (const event of untraced.slice(0, 8)) items.push({ kind: 'consequence-untraced', eventId: event.id,
    question: `"${clip(event.boundary ?? event.id, 100)}" was added in this branch with no causal path from its premise. Does the premise bring it about, enable or prevent it (link it), or would it happen in every branch (then the trunk may need it)?` });
  const found = premise ? analogues(trunk, trunkIndex, headIndex, roots, record) : [];
  if (premise && !found.length) items.push({ kind: 'premise-unplaced', eventId: premise.id,
    question: 'The model finds nothing in the past like this premise: it moves no process that earlier Events carry and refers to no earlier Event. Which processes does it move, and what in the past was like it? Name the reference class before judging this case.' });
  for (const analogue of found) {
    if (!analogue.drivers.length) items.push({ kind: 'analogue-undriven', eventId: analogue.eventId,
      question: `"${analogue.what}" (${analogue.at}) is like this premise, but the model has not weighed what drove it. What made it as large as it was, and does that hold in this branch?` });
    for (const driver of analogue.drivers) items.push({ kind: 'analogue-driver', eventId: analogue.eventId, cause: driver.cause,
      question: `In "${analogue.what}", "${clip(driver.label, 90)}" (${driver.kind}) made a difference of ${driver.difference}${driver.measure === 'probability' ? ' in probability' : ` ${driver.measure}`} (against "${clip(driver.contrast, 60)}"). Does it hold in this branch, and what follows if it does or does not?` });
  }
  const continued = new Set(delta.values.map((series) => series.processId));
  const continuedSeries = new Set(delta.series.map((series) => series.key));
  for (const process of principalProcesses(trunk, trunkIndex, 8)) if (!continued.has(process.id)) items.push({ kind: 'process-uncontinued', processes: [process.id],
    question: `${process.meaning ? `${clip(process.meaning, 80)} (${process.id})` : process.id} has no value in this branch after its premise. What does it do here?` });
  for (const sibling of siblings) for (const processId of sibling.continued) if (!continued.has(processId)) items.push({ kind: 'sibling-asymmetry', processes: [processId], sibling: sibling.key,
    question: `Branch ${sibling.key} follows ${processId} after the fork; this branch does not. Follow it here too, so the two can be compared, or say why it is unaffected.` });
  for (const sibling of siblings) for (const series of sibling.series) if (!continuedSeries.has(series.key)) items.push({ kind: 'sibling-series-asymmetry',
    ...(series.subject ? { referents: [series.subject] } : {}), sibling: sibling.key,
    question: `Branch ${sibling.key} reads "${clip(series.question, 90)}"${series.subject ? ` about ${displayName(series.subject)}` : ''} after the fork; this branch does not. Follow the same question, unit, answers and perspective here, or say why it is unaffected.` });
  const modeledTo = Math.max(record.premise.interval.start, ...delta.events.filter((event) => !isPremiseRecord(event)).map((event) => end(event) ?? start(event) ?? -Infinity),
    ...delta.values.flatMap((series) => series.points.map((point) => point.at)), ...delta.series.flatMap((series) => series.readings.map((reading) => reading.to)));
  if (modeledTo < record.horizon) items.push({ kind: 'horizon-open', eventId: record.premise.eventId,
    question: `This branch is modeled to ${round(modeledTo)}; its horizon is ${record.horizon}. What happens in between, including effects that arrive late? A consequence not modeled yet is not absent.` });
  if (record.kind === 'counterfactual') {
    // What actually followed the changed choice comes first: the continuation the trunk realized, then what that led
    // to, then the rest of the actual history after the change, earliest first.
    const changed = record.counterfactual?.cutId ?? null;
    const actual = trunkIndex.relations.filter((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id === changed).map((relation) => relation.target_event_id);
    const downstream = traced(trunkIndex, actual);
    const rank = (event) => (actual.includes(event.id) ? 0 : downstream.has(event.id) ? 1 : 2);
    const after = (event) => start(event) !== null && (start(event) > record.divergence || (start(event) === record.divergence && rank(event) < 2));
    const carried = [...headIndex.events.values()].filter((event) => trunkIndex.events.has(event.id) && !headIndex.readings.has(event.id) && after(event)
      && JSON.stringify(event) === JSON.stringify(trunkIndex.events.get(event.id))).sort((a, b) => rank(a) - rank(b) || start(a) - start(b));
    for (const event of carried.slice(0, 10)) items.push({ kind: 'actual-history-carried', eventId: event.id,
      question: `"${clip(event.boundary ?? event.id, 100)}" (${start(event)}) happened in the actual history after the change. Does it still happen here? Keep it, change it or withdraw it in this branch.` });
  }
  // A life the model holds only to a time before the horizon: a story's people often stop where its last page does.
  for (const personId of people(headIndex, delta, record, [])) {
    const life = headIndex.events.get(headIndex.referents.get(personId)?.lifecycle_event_id);
    if (end(life) !== null && end(life) < record.horizon) items.push({ kind: 'life-unextended', referents: [personId],
      question: `${displayName(personId)} takes part in this branch, but the model holds their life only to ${end(life)} and the branch runs to ${record.horizon}. Extend the life here (its end and the processes that go on), or say why they leave the branch.` });
  }
  if (record.baselineMissing) items.push({ kind: 'baseline-absent', eventId: record.premise.eventId,
    question: 'No sibling of this option waits or does nothing, and the stage does not say why. What would happen if the choice were put off or not made? Fork that option, or say why it is not meaningful here.' });
  if (record.baseline && !record.waitsFor) items.push({ kind: 'wait-undeclared', eventId: record.premise.eventId,
    question: 'This option waits or does nothing. What would waiting let you learn that could change the choice, and by when must the choice be made? If nothing learned would change it, waiting has no value here.' });
  const open = items.filter((item) => !sufficient.covers(item));
  return { open: open.slice(0, 24), closedHere: items.length - open.length, ...(open.length > 24 ? { more: open.length - 24 } : {}) };
}

function personRow(model, personId, t, accessScopes) {
  const state = personStateAt(model, personId, t, { accessScopes });
  const top = (cut) => cut.answers.slice(0, 3).map((answer) => `${answer.key} ${round(answer.weight)}`).join(', ');
  const covered = !state.life || ((state.life.start === null || state.life.start <= t) && (state.life.end === null || state.life.end >= t));
  return { personId, name: displayName(personId), at: t, ...(state.life ? { life: { from: state.life.start, to: state.life.end } } : {}),
    ...(covered ? {} : { lifeNotHeld: `The model holds this life only from ${state.life.start ?? '?'} to ${state.life.end ?? '?'}; the readings below are the latest it has.` }),
    readings: state.latest.filter((item) => ['wants', 'feels', 'outlook', 'health'].includes(item.kind)).slice(0, 6).map((item) => ({ cutId: item.cutId, kind: item.kind, question: clip(item.question, 90), at: item.at, top: top(item) })),
    values: (state.values ?? []).slice(0, 8).map((item) => {
      const accounts = (item.recorded ?? []).map(({ holder, held, next, atThisTime }) => ({ holder, held, ...(next ? { next } : {}), ...(atThisTime ? { atThisTime } : {}) }));
      return { processId: item.processId, ...(accounts.length ? { accounts } : { value: 'not recorded by then' }) };
    }) };
}

const people = (headIndex, delta, record, asked) => [...new Set([...asked, ...(record.decision?.deciderId ? [record.decision.deciderId] : []),
  ...delta.series.map((series) => series.subject).filter(Boolean),
  ...delta.events.flatMap((event) => Object.values(event.participants ?? {}).flat())])].filter((personId) => headIndex.referents.get(personId)?.lifecycle_event_id).slice(0, 12);

export async function listFutures(service, raw) {
  const input = listSchema.parse(raw);
  const { branches, forkedGraphs } = await readBranches(service, sortedScopes(input.accessScopes), input.stageId ?? null);
  const stages = new Map();
  for (const branch of branches) {
    const { record } = branch;
    if (!stages.has(record.stageId)) stages.set(record.stageId, { stageId: record.stageId, title: record.title, kind: record.kind, trunk: record.trunk, horizon: record.horizon,
      ...(record.within ? { within: record.within } : {}), ...(record.unnamedMass !== undefined ? { unnamedMass: record.unnamedMass } : {}), branches: [] });
    const newestTrunk = typeof service.newestModelDescendant === 'function' ? service.newestModelDescendant(record.trunk.modelHash) : record.trunk.modelHash;
    stages.get(record.stageId).branches.push({ key: record.key, premise: record.premise.boundary, probability: record.probability?.value ?? null,
      ...(record.probability?.joint !== undefined ? { jointProbability: record.probability.joint } : {}), ...guessOf(record), ...(record.baseline ? { baseline: true } : {}),
      graphHash: branch.graphHash, boundModelHash: branch.boundModelHash, resolution: record.resolution?.status ?? 'open',
      ...(newestTrunk && newestTrunk !== record.trunk.modelHash ? { trunkMovedTo: newestTrunk } : {}) });
  }
  return { schema: 'meaning-model-future-list/v1', stages: [...stages.values()].sort((a, b) => a.stageId.localeCompare(b.stageId)),
    ...(forkedGraphs.length ? { forkedGraphs } : {}),
    note: 'trunkMovedTo names a newer trunk revision this server wrote after the fork: the branch does not have what was learned since. Probabilities are as issued; a remainder or an answer not branched is modeled in no branch.' };
}

async function stageBranches(service, accessScopes, stageId) {
  const { branches, forkedGraphs } = await readBranches(service, accessScopes, stageId);
  if (!branches.length) throw new Error(`No branches of stage ${stageId} are visible with these access scopes.`);
  if (forkedGraphs.length) throw new Error(`A branch graph of stage ${stageId} has more than one head (${forkedGraphs.map((item) => item.graphId).join(', ')}); continue one head before loading.`);
  return branches;
}

export async function loadFuture(service, raw) {
  bounded(raw, 'A load');
  const input = loadSchema.parse(raw);
  const accessScopes = sortedScopes(input.accessScopes);
  const branches = await stageBranches(service, accessScopes, input.branch.stageId);
  const branch = branches.find((item) => item.record.key === input.branch.key);
  if (!branch) throw new Error(`Stage ${input.branch.stageId} has no branch ${input.branch.key} (branches: ${branches.map((item) => item.record.key).join(', ')}).`);
  const { record } = branch;
  const headHash = await branchHead(service, branch, input.modelHash ?? null);
  const [trunk, head] = [await scopedDefinition(service, record.trunk.modelHash, accessScopes), await scopedDefinition(service, headHash, accessScopes)];
  const trunkIndex = indexModel(trunk), headIndex = indexModel(head);
  const delta = added(trunkIndex, head, headIndex, record);
  const siblings = [];
  if (input.siblings) for (const sibling of branches.filter((item) => item !== branch)) {
    const siblingModel = await scopedDefinition(service, await branchHead(service, sibling), accessScopes);
    const siblingDelta = added(trunkIndex, siblingModel, indexModel(siblingModel), sibling.record);
    siblings.push({ key: sibling.record.key, continued: [...new Set(siblingDelta.values.map((series) => series.processId))], series: siblingDelta.series });
  }
  const questions = agenda({ record, trunk, trunkIndex, head, headIndex, delta, siblings, sufficient: readSufficientHere(branch.view) });
  const t = input.at ?? record.horizon;
  return {
    schema: 'meaning-model-future-load/v1',
    branch: { stageId: record.stageId, key: record.key, kind: record.kind, title: record.title, premise: record.premise, narrowings: record.narrowings,
      probability: record.probability, ...(record.weights ? { weights: record.weights } : {}), ...(record.baseline ? { baseline: true } : {}),
      ...(record.waitsFor ? { waitsFor: record.waitsFor } : {}), ...(record.divergence !== undefined ? { divergence: record.divergence } : {}),
      trunk: record.trunk, horizon: record.horizon, forkModelHash: record.forkModelHash, headModelHash: headHash, graphHash: branch.graphHash,
      ...(branch.boundModelHash !== headHash ? { graphBoundTo: branch.boundModelHash, rebind: 'The branch graph is bound to an earlier revision; rebind it with life_narrative_rebind before recording notes about records added since.' } : {}),
      status: 'hypothetical: everything here is assumed or simulated from the premise, never observed', resolution: record.resolution },
    added: {
      events: delta.events.filter((event) => !isPremiseRecord(event)).slice(0, 24).map((event) => ({ eventId: event.id, what: clip(event.boundary ?? event.id, 120), from: start(event), to: end(event) })),
      ...(delta.events.filter((event) => !isPremiseRecord(event)).length > 24 ? { moreEvents: delta.events.filter((event) => !isPremiseRecord(event)).length - 24 } : {}),
      changedEvents: delta.changed.filter((event) => !acceptedWorldRoots(trunk).includes(event.id)).slice(0, 12).map((event) => ({ eventId: event.id, what: clip(event.boundary ?? event.id, 120) })),
      relations: delta.relations.length, cuts: delta.cuts.slice(0, 12).map((cut) => ({ cutId: cut.id, question: clip(cut.question, 100), kind: cutKind(cut) })),
    },
    values: delta.values.slice(0, 16).map((series) => ({ ...series, points: series.points.slice(0, 12), ...(series.points.length > 12 ? { morePoints: series.points.length - 12 } : {}) })),
    series: delta.series.slice(0, 16).map((series) => ({ ...series, readings: series.readings.slice(0, 12), ...(series.readings.length > 12 ? { moreReadings: series.readings.length - 12 } : {}) })),
    people: people(headIndex, delta, record, input.people).map((personId) => personRow(head, personId, t, accessScopes)),
    agenda: questions,
    siblings: branches.filter((item) => item !== branch).map((item) => ({ key: item.record.key, probability: item.record.probability?.value ?? null, ...guessOf(item.record), ...(item.record.baseline ? { baseline: true } : {}) })),
    ...(record.unnamedMass !== undefined ? { unnamedMass: record.unnamedMass } : {}),
    nextStep: 'Answer the open questions in this branch: model the consequence (life_model_revise from headModelHash, then life_narrative_rebind), or record in this branch\'s graph why it is sufficient here (life_understanding_record, data {schema: meaning-model-sufficient/v1, kind, reason}, about the records the question names). Switch with life_future_load; set siblings side by side with life_future_compare.',
  };
}

export async function compareFutures(service, raw) {
  bounded(raw, 'A comparison');
  const input = compareSchema.parse(raw);
  const accessScopes = sortedScopes(input.accessScopes);
  let branches = await stageBranches(service, accessScopes, input.stageId);
  if (input.branches.length) {
    const missing = input.branches.filter((name) => !branches.some((item) => item.record.key === name));
    if (missing.length) throw new Error(`Stage ${input.stageId} has no branch ${missing.join(', ')}.`);
    branches = branches.filter((item) => input.branches.includes(item.record.key));
  }
  branches.sort((a, b) => a.record.key.localeCompare(b.record.key));
  const first = branches[0].record;
  const trunk = await scopedDefinition(service, first.trunk.modelHash, accessScopes);
  const trunkIndex = indexModel(trunk);
  const t = input.at ?? first.horizon;
  const read = [];
  for (const branch of branches) {
    const headHash = await branchHead(service, branch, input.heads[branch.record.key] ?? null);
    const head = await scopedDefinition(service, headHash, accessScopes);
    const headIndex = indexModel(head);
    read.push({ branch, headHash, head, headIndex, delta: added(trunkIndex, head, headIndex, branch.record) });
  }
  const visibleProcesses = new Set(read.flatMap((item) => item.headIndex.processList.map((process) => process.id)));
  if (input.processes.some((processId) => !visibleProcesses.has(processId))) throw new Error('A requested process is unavailable with these access scopes.');
  const processIds = input.processes.length ? input.processes : [...new Set(read.flatMap((item) => item.delta.values.map((series) => series.processId)))].slice(0, 16);
  const trajectories = processIds.map((processId) => ({ processId, meaning: trunkIndex.processList.find((process) => process.id === processId)?.scale?.semantic_role ?? null,
    branches: Object.fromEntries(read.map((item) => [item.branch.record.key, item.delta.values.filter((series) => series.processId === processId)
      .map((series) => ({ holder: series.holder, points: series.points.slice(0, 12) }))])) }));
  const continuedBy = new Map(processIds.map((processId) => [processId, read.filter((item) => item.delta.values.some((series) => series.processId === processId)).map((item) => item.branch.record.key)]));
  const asymmetric = [...continuedBy.entries()].filter(([, keys]) => keys.length && keys.length < read.length)
    .map(([processId, keys]) => ({ processId, followedIn: keys, notIn: read.map((item) => item.branch.record.key).filter((name) => !keys.includes(name)) }));
  const seriesKeys = [...new Set(read.flatMap((item) => item.delta.series.map((series) => series.key)))].slice(0, 16);
  const series = seriesKeys.map((key) => {
    const groups = read.flatMap((item) => item.delta.series).filter((series) => series.key === key);
    const { readings, wordingDiffers, ...identity } = groups[0];
    const differs = Boolean(wordingDiffers) || groups.some((group) => group.wordingDiffers || JSON.stringify(group.answers) !== JSON.stringify(identity.answers)
      || JSON.stringify(group.conditioningMeanings) !== JSON.stringify(identity.conditioningMeanings));
    return { ...identity, ...(differs ? { wordingDiffers: 'Some answer or conditioning definitions differ; read each reading\'s own meanings before comparing shares.' } : {}),
      branches: Object.fromEntries(read.map((item) => {
      const readings = item.delta.series.find((series) => series.key === key)?.readings ?? [];
      return [item.branch.record.key, { readings: readings.slice(0, 12), ...(readings.length > 12 ? { moreReadings: readings.length - 12 } : {}) }];
    })) };
  });
  const seriesAsymmetries = series.filter((series) => Object.values(series.branches).some((branch) => !branch.readings.length)).map((series) => ({
    key: series.key, subject: series.subject, question: series.question,
    followedIn: Object.entries(series.branches).filter(([, branch]) => branch.readings.length).map(([key]) => key),
    notIn: Object.entries(series.branches).filter(([, branch]) => !branch.readings.length).map(([key]) => key) }));
  const size = (item) => item.delta.events.filter((event) => !isPremiseRecord(event)).length + item.delta.cuts.length + item.delta.values.reduce((sum, series) => sum + series.points.length, 0);
  const largest = Math.max(...read.map(size));
  const peopleIds = [...new Set(read.flatMap((item) => people(item.headIndex, item.delta, item.branch.record, input.people)))].slice(0, 12);
  const rows = peopleIds.map((personId) => ({ personId, name: displayName(personId),
    branches: Object.fromEntries(read.map((item) => [item.branch.record.key, item.headIndex.referents.get(personId)?.lifecycle_event_id ? personRow(item.head, personId, t, accessScopes) : null])) }));
  return {
    schema: 'meaning-model-future-compare/v1', stageId: input.stageId, title: first.title, kind: first.kind, trunk: first.trunk, horizon: first.horizon, at: t,
    branches: read.map((item) => ({ key: item.branch.record.key, premise: item.branch.record.premise.boundary, window: item.branch.record.premise.interval,
      narrowings: item.branch.record.narrowings.map((narrowing) => narrowing.boundary), probability: item.branch.record.probability?.value ?? null,
      ...(item.branch.record.probability?.joint !== undefined ? { jointProbability: item.branch.record.probability.joint } : {}), ...guessOf(item.branch.record),
      ...(item.branch.record.baseline ? { baseline: true, ...(item.branch.record.waitsFor ? { waitsFor: item.branch.record.waitsFor } : {}) } : {}),
      headModelHash: item.headHash, added: { events: item.delta.events.filter((event) => !isPremiseRecord(event)).length, cuts: item.delta.cuts.length,
        valuePoints: item.delta.values.reduce((sum, series) => sum + series.points.length, 0) },
      eventsHere: item.delta.events.filter((event) => !isPremiseRecord(event)).slice(0, 12).map((event) => ({ eventId: event.id, what: clip(event.boundary ?? event.id, 100), from: start(event) })) })),
    ...(first.unnamedMass !== undefined ? { unnamedMass: first.unnamedMass } : {}),
    trajectories,
    series,
    seriesAsymmetries,
    people: rows,
    asymmetries: asymmetric,
    underdeveloped: read.filter((item) => largest > 0 && size(item) < largest / 4).map((item) => ({ key: item.branch.record.key, size: size(item), largest,
      question: `Branch ${item.branch.record.key} holds far less than its siblings. A sibling left thin, often the one where nothing is done, makes the comparison one-sided: develop it as far as the others before comparing.` })),
    total: null,
    reading: 'Predictions only: each branch is assumed from its premise and continued by its author, so a consequence that recurs across branches written on one model is not independent confirmation. No total is computed and none should replace these rows: who gains and who bears the costs stays visible per person. A judgment between branches is yours to record, with the rows it rests on.',
  };
}

export const FORECASTING_GUIDE_URI = 'life-sim://addon/forecasting';
export function registerForecastingAddon(server, service, { toolResult }) {
  const guideUri = FORECASTING_GUIDE_URI;
  // Also readable with life_modeling_read, which clients without resource reads use.
  const forecastingGuide = { uri: guideUri, id: 'forecasting-addon', title: 'Optional forecasting mode', category: 'addon',
    description: 'Forecasting pulled into any work: frozen forecasts and their scoring, and branches of a model for forecasts, decisions, assumptions and changes to the past, with their consequence questions, loaded quickly and compared without a total.',
    load: async () => { const { readFile } = await import('node:fs/promises'); return readFile(new URL('../../profiles/FORECASTING_ADDON.md', import.meta.url), 'utf8'); } };
  serveReadableResource(forecastingGuide);
  server.registerResource('forecasting-addon', guideUri, {
    title: forecastingGuide.title,
    description: forecastingGuide.description,
    mimeType: 'text/markdown',
  }, async () => ({ contents: [{ uri: guideUri, mimeType: 'text/markdown', text: await forecastingGuide.load() }] }));
  const tools = [
    ['life_future_fork', forkSchema, forkStage, false, true,
      'Fork one stage of sibling branches from one trunk revision and information cutoff: the answers of a forecast Cut (each premise spanning the forecast window, the probabilities carried where the Cut declares them for that window and cutoff and otherwise withheld with the reason, the remainder never branched), the options of a decision (with a waiting or no-action option unless noBaseline says why not; without either, the result asks), one or more assumptions, or a change to the past. Each branch is a model revision whose premise Event, narrowings and assumed realization carry a premise mark, with the accepted world extended to the horizon, and its own narrative graph. Every sibling is validated before any is written; a retry with the same requestId completes a partial stage. Forecasting is a mode any purpose can pull in: read life-sim://addon/forecasting and call life_modeling_context with modes ["forecasting"] beside your purpose.'],
    ['life_future_list', listSchema, listFutures, true, true,
      'List the stages and branches visible with these access scopes: premise, probability as issued (and joint probability inside a branch), baseline, branch graph and bound model, resolution, and whether the trunk has moved on since the fork. Read-only.'],
    ['life_future_load', loadSchema, loadFuture, true, true,
      'A bounded digest of one branch for switching between branches: premise, narrowings, probability, what the branch added to the trunk, values after the premise, people\'s states at a time, and the open consequence questions, each closed by modeling it or by a "sufficient here" note in the branch graph. Read-only.'],
    ['life_future_compare', compareSchema, compareFutures, true, true,
      'Set the branches of a stage side by side: probabilities and unnamed mass, trajectories after the fork per process, each person\'s state per branch, Events each branch added, processes followed in some branches and not others, and siblings left thin. Computes no total. Read-only.'],
  ];
  for (const [name, schema, method, readOnly, idempotent, description] of tools) {
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false } },
      async (input) => toolResult(await method(service, input)));
  }
}
