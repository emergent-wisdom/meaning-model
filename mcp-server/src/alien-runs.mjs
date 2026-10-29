// World modelling for the alien add-on. A world's laws become a Meaning Model model that the engine runs, and the
// solver's scenario and interventions run against it. Roles answer with model parts as JSON and never touch the
// engine: the server validates, registers, runs and summarises, so every run is recorded and can be replayed: a run's
// draws depend only on its model, its plan and its seed.
import * as z from 'zod/v4';
import { ISOLATION } from './alien-search.mjs';
import { RustEngineProcess } from './rust-engine-process.mjs';
import { LifeSimulationService } from './service.mjs';

export const MODEL_SCHEMA = 'life-sim-rust-model/v1';
const QUERY_SCHEMA = 'life-sim-rust-model-query/v1';
export const RUN_LIMITS = Object.freeze({ horizon: 400, chunk: 30, observables: 40, processes: 60, laws: 80, interventions: 3, parts: 3, events: 8, draws: 5 });
export const MEASURE_KINDS = Object.freeze(['final', 'mean', 'peak', 'minimum', 'eventCount', 'meanInterval', 'cooccurrence']);

const engineId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, 'Use letters, digits, dot, underscore or hyphen.');
const prose = (max) => z.string().trim().min(1).max(max);
// Processes and laws are passed to the engine as written; it checks them in full. Only what the add-on reads is checked here.
export const processSchema = z.looseObject({ id: engineId });
export const lawSchema = z.looseObject({ id: engineId, operator: z.looseObject({ role: z.string() }) });
export const runPlanSchema = z.object({
  horizon: z.number().positive().max(RUN_LIMITS.horizon).describe(`Time units to run, at most ${RUN_LIMITS.horizon}.`),
  stepSize: z.number().positive().max(1).describe('Integration step in time units, for example 0.05.'),
}).strict();
const overrideSchema = z.object({ processId: engineId, value: z.number().finite() }).strict();

export const measureSchema = z.object({
  kind: z.enum(MEASURE_KINDS),
  process: engineId.optional().describe('final, mean, peak, minimum: a process; eventCount, meanInterval: a counter process.'),
  counters: z.array(engineId).min(2).max(20).optional().describe('cooccurrence: the counter processes whose events are compared.'),
  window: z.number().positive().optional().describe('cooccurrence: events this close in time count as together.'),
  after: z.number().min(0).default(0).describe('Ignore everything before this time (a warm-up).'),
  better: z.enum(['higher', 'lower']),
  meaning: prose(400).describe('What the measure says about the problem, in the world\'s terms.'),
}).strict().superRefine((value, context) => {
  if (value.kind === 'cooccurrence') {
    if (!value.counters || value.window === undefined) context.addIssue({ code: 'custom', path: ['counters'], message: 'cooccurrence needs counters and window.' });
  } else if (!value.process) context.addIssue({ code: 'custom', path: ['process'], message: `${value.kind} needs process.` });
});

const partSchema = z.object({
  id: engineId, label: prose(200),
  processes: z.array(processSchema).max(20).default([]).describe('Processes this part adds. They stay in the model when the part is removed, so other laws may still read them.'),
  laws: z.array(lawSchema).max(20).default([]).describe('Laws this part adds. Removing the part removes these laws.'),
  overrides: z.array(overrideSchema).max(20).default([]).describe('Starting values this part changes. Removing the part restores them.'),
}).strict().refine((part) => part.laws.length || part.overrides.length, 'A part adds at least one law or changes at least one starting value.');
const interventionSchema = z.object({ id: engineId, label: prose(200), parts: z.array(partSchema).min(1).max(RUN_LIMITS.parts) }).strict();

export const worldModelData = z.object({
  worldNodeId: z.string().min(1).max(256),
  timeUnit: prose(80).default('day'),
  processes: z.array(processSchema).max(RUN_LIMITS.processes).default([]),
  laws: z.array(lawSchema).max(RUN_LIMITS.laws).default([]),
  observables: z.array(engineId).max(RUN_LIMITS.observables).default([]),
  run: runPlanSchema.nullable().default(null),
  ruleMap: z.array(z.object({ ruleId: z.string().regex(/^R[1-9][0-9]?$/u), lawIds: z.array(engineId).min(1).max(20), how: prose(1_000) }).strict()).max(24).default([]),
  simplifications: z.array(prose(1_000)).max(24).default([]).describe('What the world text says that the model leaves out or changes.'),
  decline: z.object({ reason: prose(2_000) }).strict().nullable().default(null).describe('Instead of a model: why this world cannot be written with the engine\'s laws.'),
  isolation: z.object({ modeller: z.enum(ISOLATION) }).strict(),
}).strict().superRefine((value, context) => {
  if (value.decline) return;
  if (!value.processes.length || !value.laws.length) context.addIssue({ code: 'custom', path: ['processes'], message: 'A world model needs processes and laws, or a decline with its reason.' });
  if (!value.observables.length || !value.run) context.addIssue({ code: 'custom', path: ['observables'], message: 'A world model names its observables and its run plan.' });
  if (!value.ruleMap.length) context.addIssue({ code: 'custom', path: ['ruleMap'], message: 'Map at least one world rule to the laws that express it.' });
});

export const scenarioData = z.object({
  worldModelNodeId: z.string().min(1).max(256),
  description: prose(4_000).describe('The problem inside the world: who its actors are and how the world\'s laws act on them.'),
  processes: z.array(processSchema).max(RUN_LIMITS.processes).default([]),
  laws: z.array(lawSchema).max(RUN_LIMITS.laws).default([]),
  overrides: z.array(overrideSchema).max(40).default([]),
  observables: z.array(engineId).max(RUN_LIMITS.observables).default([]),
  measure: measureSchema,
  run: runPlanSchema.nullable().default(null).describe('The scenario\'s run length and step, when it needs other than the world model\'s.'),
  interventions: z.array(interventionSchema).max(RUN_LIMITS.interventions).default([]),
  isolation: z.object({ solver: z.enum(ISOLATION) }).strict(),
}).strict();

const value = (sample, processId) => {
  const raw = sample.state?.[processId];
  if (typeof raw === 'number') return raw;
  return typeof raw?.value === 'number' ? raw.value : typeof raw?.scalar === 'number' ? raw.scalar : null;
};
const round = (x) => (x === null || !Number.isFinite(x) ? null : Number(x.toPrecision(5)));
const modelIdFor = (nodeId, suffix = '') => `alien-${nodeId}${suffix}`.replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 120);

export function worldDefinition(worldModel, worldNodeId, reason) {
  return { schema: MODEL_SCHEMA, id: modelIdFor(worldNodeId), time_unit: worldModel.timeUnit,
    revision: { number: 0, reason: reason.slice(0, 2_000), provenance: ['Meaning Model alien add-on: world model'] },
    processes: worldModel.processes, laws: worldModel.laws };
}

// One variant of a scenario: the world model, the scenario's additions, and the chosen parts of one intervention.
export function variantDefinition(base, scenario, { intervention = null, without = null, suffix }) {
  const processes = [...base.processes, ...scenario.processes];
  const laws = [...base.laws, ...scenario.laws];
  const overrides = [...scenario.overrides];
  for (const part of intervention?.parts ?? []) {
    processes.push(...part.processes);
    if (part.id === without) continue;
    laws.push(...part.laws); overrides.push(...part.overrides);
  }
  for (const [list, kinds] of [[processes, 'processes'], [laws, 'laws']]) {
    const seen = new Set();
    for (const item of list) { if (seen.has(item.id)) throw new Error(`Two ${kinds} share the id ${item.id}; give each a distinct id.`); seen.add(item.id); }
  }
  const byId = new Map(processes.map((process) => [process.id, structuredClone(process)]));
  for (const override of overrides) {
    const process = byId.get(override.processId);
    if (!process) throw new Error(`The override names ${override.processId}, which is not a process of this model.`);
    process.initial_value = { ...(process.initial_value ?? { kind: 'scalar' }), value: override.value };
  }
  return { ...base, id: `${base.id}${suffix}`.replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 120), processes: processes.map((process) => byId.get(process.id)), laws };
}

// Each run happens in a stateless engine of its own, started for that run and closed after it, so throwaway worlds
// neither fill the user's store nor count against its world quota, and one run's path never crowds another's out of
// the engine's session limit. The graph keeps each model and its hash, so any run can be replayed.
export async function withRunEngine(work) {
  const engine = new LifeSimulationService({ backend: new RustEngineProcess({ stateless: true }) });
  await engine.initialize();
  try { return await work(engine); } finally { engine.close(); }
}

// A structural check of model parts before the engine sees them, so a refusal names where the problem is. The engine
// still checks the model in full; this catches the slips a writer of JSON makes most, with their paths.
const EXPRESSION_OPS = { constant: [], process: [], time: [], add: ['terms'], multiply: ['factors'], subtract: ['left', 'right'], divide: ['numerator', 'denominator'],
  negate: ['value'], minimum: ['values'], maximum: ['values'], clamp: ['value'], absolute: ['value'], exponential: ['value'], logistic: ['value'] };
const COMPARISONS = ['greater_or_equal', 'greater_than', 'less_or_equal', 'less_than'];
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
function expressionProblems(expression, path, problems) {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return problems.push(`${path}: an expression is an object with op, for example {op: "constant", value: 1}.`);
  const children = EXPRESSION_OPS[expression.op];
  if (!children) return problems.push(`${path}: unknown op ${JSON.stringify(expression.op)}; use ${Object.keys(EXPRESSION_OPS).join(', ')}.`);
  if (expression.op === 'constant' && !isNumber(expression.value)) problems.push(`${path}.value: a constant's value is a plain number.`);
  if (expression.op === 'process' && typeof expression.process !== 'string') problems.push(`${path}.process: name a process id.`);
  if (expression.op === 'clamp' && !(isNumber(expression.minimum) && isNumber(expression.maximum))) problems.push(`${path}: clamp's minimum and maximum are plain numbers, not expressions.`);
  for (const key of children) {
    const child = expression[key];
    if (['terms', 'factors', 'values'].includes(key)) {
      if (!Array.isArray(child) || !child.length) problems.push(`${path}.${key}: a list of expressions.`);
      else child.forEach((item, index) => expressionProblems(item, `${path}.${key}[${index}]`, problems));
    } else expressionProblems(child, `${path}.${key}`, problems);
  }
}
export function modelPartProblems({ processes = [], laws = [] }, prefix = '') {
  const problems = [];
  processes.forEach((process, index) => {
    const path = `${prefix}processes[${index}] (${process.id})`;
    if (!isNumber(process.initial_value?.value)) problems.push(`${path}.initial_value.value: a plain number.`);
    const bounds = process.value_type?.bounds;
    if (bounds && !(isNumber(bounds.minimum) && isNumber(bounds.maximum))) problems.push(`${path}.value_type.bounds: minimum and maximum are plain numbers.`);
  });
  laws.forEach((law, index) => {
    const path = `${prefix}laws[${index}] (${law.id}).operator`;
    const op = law.operator ?? {};
    if (op.role === 'evolution') expressionProblems(op.derivative, `${path}.derivative`, problems);
    else if (op.role === 'relation') expressionProblems(op.value, `${path}.value`, problems);
    else if (op.role === 'occurrence') {
      const trigger = op.trigger ?? {};
      if (trigger.kind === 'threshold') {
        expressionProblems(trigger.expression, `${path}.trigger.expression`, problems);
        if (!COMPARISONS.includes(trigger.comparison)) problems.push(`${path}.trigger.comparison: one of ${COMPARISONS.join(', ')}.`);
        if (!isNumber(trigger.threshold)) problems.push(`${path}.trigger.threshold: a plain number; put any expression in trigger.expression.`);
        if (!['on_enter', 'while_true'].includes(trigger.firing)) problems.push(`${path}.trigger.firing: on_enter or while_true.`);
      } else if (trigger.kind === 'hazard') expressionProblems(trigger.rate, `${path}.trigger.rate`, problems);
      else if (trigger.kind !== 'always') problems.push(`${path}.trigger.kind: threshold, hazard or always.`);
      (op.effects ?? []).forEach((effect, effectIndex) => {
        if (!['set', 'add'].includes(effect.mode)) problems.push(`${path}.effects[${effectIndex}].mode: set or add.`);
        expressionProblems(effect.value, `${path}.effects[${effectIndex}].value`, problems);
      });
    } else if (!['epistemic', 'resolution'].includes(op.role)) problems.push(`${path}.role: evolution, relation or occurrence.`);
  });
  return problems;
}
// Laws that set the same process on the same trigger fire in the same step, which the engine refuses. Only identical
// threshold or always triggers are caught here; two different events that happen to coincide still reach the engine.
export function conflictProblems(laws) {
  const setters = new Map();
  for (const law of laws) {
    const op = law.operator ?? {};
    if (op.role !== 'occurrence' || op.trigger?.kind === 'hazard' || law.enabled === false) continue;
    const trigger = JSON.stringify(op.trigger);
    const targets = (op.effects ?? []).filter((effect) => effect.mode === 'set').map((effect) => effect.target);
    for (const target of targets) {
      const key = `${trigger}\u0000${target}`;
      setters.set(key, [...(setters.get(key) ?? []), law.id]);
    }
  }
  return [...setters.entries()].filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => `${ids.join(' and ')} both set ${key.split('\u0000')[1]} on the same trigger, so in the same step; the engine refuses conflicting set effects. Give one of them add, or merge them into one law.`);
}
export function checkConflicts(laws, label = 'The model') {
  const problems = conflictProblems(laws);
  if (problems.length) throw new Error(`${label} has laws the engine would refuse (${problems.length}):\n- ${problems.slice(0, 20).join('\n- ')}`);
}

export function checkModelParts(parts, prefix = '') {
  const problems = modelPartProblems(parts, prefix);
  if (problems.length) throw new Error(`The model has problems the engine would refuse (${problems.length}):\n- ${problems.slice(0, 20).join('\n- ')}`);
}

// Register, create and roll a world to the plan's horizon, at most 30 time units per roll, accepting each roll.
export async function runModel(service, { definition, observables, plan, seed, requestPrefix }) {
  const registered = await service.registerModel({ requestId: `${requestPrefix}.model`, model: definition });
  // The world is named, not given a random id: the engine keys each draw on the world's state, so a random name would
  // make every run a new draw whatever its seed.
  const created = await service.createWorld({ requestId: `${requestPrefix}.world`, modelHash: registered.modelHash, worldId: 'world_run' });
  const worldId = created.worldId;
  const samples = [];
  for (let time = 0, index = 0; time < plan.horizon - 1e-9; index += 1) {
    const deltaTime = Math.min(RUN_LIMITS.chunk, plan.horizon - time);
    const rollSeed = `${seed}.${index}`;
    const rolled = await service.rollCandidate({ worldId, requestId: `${requestPrefix}.roll.${index}`, deltaTime, stepSize: plan.stepSize, seed: rollSeed,
      query: { schema: QUERY_SCHEMA, delta_time: deltaTime, step_size: plan.stepSize, seed: rollSeed, requested_observables: observables, path: { mode: 'full' } } })
      .catch((error) => { throw explainRunError(error); });
    const view = await service.getCandidate(await service.getWorld(worldId), rolled.candidateId);
    const path = view.candidate.path?.samples ?? [];
    samples.push(...(index === 0 ? path : path.slice(1)));
    await service.acceptCandidate({ worldId, candidateId: rolled.candidateId, requestId: `${requestPrefix}.accept.${index}`, expectedParentHash: rolled.parentHash });
    time += deltaTime;
  }
  return { modelHash: registered.modelHash, samples };
}

// The engine's own wording for a run that records too much names its session, which a modeller cannot act on.
export function explainRunError(error) {
  if (!/candidate bytes would exceed/u.test(error?.message ?? '')) return error;
  return new Error('This run records more samples than one run may hold: shorten the run plan\'s horizon, use a larger stepSize, or record fewer observables.');
}

// Times at which a counter rose: a step up of at least one half between consecutive samples.
export function eventTimes(samples, processId, after = 0) {
  const times = []; let last = null;
  for (const sample of samples) {
    const current = value(sample, processId);
    if (current === null) continue;
    if (last !== null && current >= last + 0.5 && sample.time >= after) times.push(sample.time);
    last = current;
  }
  return times;
}

// A compact account of a run for each observable: its range and mean, and the events it counted.
export function summarise(samples, observables) {
  return observables.map((processId) => {
    const values = samples.map((sample) => value(sample, processId)).filter((item) => item !== null);
    const events = eventTimes(samples, processId);
    const intervals = events.slice(1).map((time, index) => time - events[index]);
    return { process: processId, first: round(values[0] ?? null), last: round(values.at(-1) ?? null),
      min: round(values.length ? Math.min(...values) : null), max: round(values.length ? Math.max(...values) : null),
      mean: round(values.length ? values.reduce((total, item) => total + item, 0) / values.length : null),
      events: events.length, meanInterval: round(intervals.length ? intervals.reduce((total, item) => total + item, 0) / intervals.length : null),
      firstEvents: events.slice(0, RUN_LIMITS.events).map(round) };
  });
}

export function measureValue(samples, measure) {
  const kept = samples.filter((sample) => sample.time >= measure.after);
  if (measure.kind === 'cooccurrence') {
    const events = Object.fromEntries(measure.counters.map((counter) => [counter, eventTimes(samples, counter, measure.after)]));
    let total = 0; let together = 0;
    for (const [counter, times] of Object.entries(events)) {
      const others = Object.entries(events).filter(([other]) => other !== counter).flatMap(([, list]) => list);
      for (const time of times) { total += 1; if (others.some((other) => Math.abs(other - time) <= measure.window)) together += 1; }
    }
    return total ? round(together / total) : null;
  }
  if (measure.kind === 'eventCount') return eventTimes(samples, measure.process, measure.after).length;
  if (measure.kind === 'meanInterval') {
    const times = eventTimes(samples, measure.process, measure.after);
    return times.length > 1 ? round((times.at(-1) - times[0]) / (times.length - 1)) : null;
  }
  const values = kept.map((sample) => value(sample, measure.process)).filter((item) => item !== null);
  if (!values.length) return null;
  if (measure.kind === 'final') return round(values.at(-1));
  if (measure.kind === 'peak') return round(Math.max(...values));
  if (measure.kind === 'minimum') return round(Math.min(...values));
  return round(values.reduce((total, item) => total + item, 0) / values.length);
}

// A scenario run is drawn several times, each with its own seed; its measure is the mean of the draws that give one.
export function drawSeeds(seed, draws = RUN_LIMITS.draws) {
  return Array.from({ length: draws }, (_, index) => (index === 0 ? seed : `${seed}.draw${index}`));
}
export function drawnValue(values) {
  const kept = values.filter((item) => item !== null);
  return kept.length ? round(kept.reduce((total, item) => total + item, 0) / kept.length) : null;
}

// Every run a scenario asks for: the scenario, each intervention whole, and each intervention with one part removed.
export function scenarioVariants(scenario) {
  const variants = [{ runId: 'scenario', label: 'the scenario, no intervention', intervention: null, without: null }];
  for (const intervention of scenario.interventions) {
    variants.push({ runId: `intervention:${intervention.id}`, label: intervention.label, intervention, without: null });
    if (intervention.parts.length > 1) for (const part of intervention.parts) {
      variants.push({ runId: `ablation:${intervention.id}/${part.id}`, label: `${intervention.label}, without ${part.label}`, intervention, without: part.id });
    }
  }
  return variants;
}

const OPS = { add: ' + ', multiply: ' × ' };
export function expressionText(expression) {
  const e = expression ?? {};
  switch (e.op) {
    case 'constant': return String(e.value);
    case 'process': return e.process;
    case 'time': return 't';
    case 'add': case 'multiply': return `(${(e.terms ?? e.factors ?? []).map(expressionText).join(OPS[e.op])})`;
    case 'subtract': return `(${expressionText(e.left)} − ${expressionText(e.right)})`;
    case 'divide': return `(${expressionText(e.numerator)} / ${expressionText(e.denominator)})`;
    case 'negate': return `−${expressionText(e.value)}`;
    case 'minimum': case 'maximum': return `${e.op === 'minimum' ? 'min' : 'max'}(${(e.values ?? []).map(expressionText).join(', ')})`;
    case 'clamp': return `clamp(${expressionText(e.value)}, ${e.minimum}, ${e.maximum})`;
    case 'absolute': return `|${expressionText(e.value)}|`;
    case 'exponential': return `exp(${expressionText(e.value)})`;
    case 'logistic': return `logistic(${expressionText(e.value)})`;
    default: return JSON.stringify(expression);
  }
}

const COMPARISON = { greater_than: '>', greater_or_equal: '≥', less_than: '<', less_or_equal: '≤' };
function lawText(law) {
  const op = law.operator ?? {};
  const flags = [law.activation === 'gated' ? 'gated: runs only once activated' : null, law.enabled === false ? 'switched off' : null].filter(Boolean);
  const tail = flags.length ? ` [${flags.join('; ')}]` : '';
  if (op.role === 'evolution') return `- ${law.id}: ${op.target} changes at the rate ${expressionText(op.derivative)}${tail}`;
  if (op.role === 'relation') return `- ${law.id}: ${op.target} = ${expressionText(op.value)}${tail}`;
  if (op.role === 'occurrence') {
    const trigger = op.trigger ?? {};
    const when = trigger.kind === 'threshold'
      ? `when ${expressionText(trigger.expression)} ${COMPARISON[trigger.comparison] ?? trigger.comparison} ${trigger.threshold} (${trigger.firing === 'on_enter' ? 'once, on crossing' : 'at every step while true'})`
      : trigger.kind === 'hazard' ? `at random, at the rate ${expressionText(trigger.rate)}` : 'at every step';
    const effects = (op.effects ?? []).map((effect) => `${effect.mode === 'set' ? 'set' : 'add to'} ${effect.target} ${effect.mode === 'set' ? 'to' : ''} ${expressionText(effect.value)}`.replace(/ {2}/gu, ' '));
    const activates = (op.activates ?? []).length ? `; activate ${op.activates.join(', ')}` : '';
    return `- ${law.id}: ${when}: ${effects.join('; ') || 'no state change'}${activates}${tail}`;
  }
  return `- ${law.id}: a ${op.role} law${tail}`;
}

// A model in plain words, for roles that read it but never see the JSON.
export function describeModel({ processes, laws }) {
  const processLines = processes.map((process) => {
    const start = process.initial_value?.value;
    const kind = process.update_mode === 'static' ? ', a fixed input' : '';
    return `- ${process.id}${process.unit ? ` (${process.unit})` : ''}, starts at ${start ?? 'its declared value'}${kind}`;
  });
  return `Processes:\n${processLines.join('\n')}\n\nLaws:\n${laws.map(lawText).join('\n')}`;
}

export function summaryText(summary) {
  return summary.map((item) => `- ${item.process}: from ${item.first} to ${item.last} (range ${item.min} to ${item.max}, mean ${item.mean})`
    + (item.events ? `; ${item.events} events${item.meanInterval !== null ? `, every ${item.meanInterval} on average` : ''}, first at ${item.firstEvents.join(', ')}` : '')).join('\n');
}

export function runTable(scenario) {
  const measure = scenario.measure;
  const draws = Math.max(...scenario.runs.map((run) => run.draws?.length ?? 1));
  const valueText = (run) => {
    if (run.measureValue === null) return 'no value';
    const kept = (run.draws ?? []).filter((item) => item !== null);
    return kept.length > 1 ? `${run.measureValue} (mean of ${kept.length} draws, range ${Math.min(...kept)} to ${Math.max(...kept)})` : String(run.measureValue);
  };
  const lines = scenario.runs.map((run) => `- ${run.runId} (${run.label}): ${valueText(run)}`);
  return `Measure: ${measure.kind}${measure.process ? ` of ${measure.process}` : ''}${measure.counters ? ` of ${measure.counters.join(', ')} within ${measure.window}` : ''}`
    + `${measure.after ? ` after time ${measure.after}` : ''}; ${measure.better} is better (${measure.meaning})`
    + `${draws > 1 ? `\nEach run was drawn ${draws} times, with different random draws. A difference smaller than the ranges may be chance.` : ''}\n${lines.join('\n')}`;
}
