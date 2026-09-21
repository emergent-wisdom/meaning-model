import { storyScopeInstructions } from './storytelling-intake.mjs';
import { createHash, randomBytes } from 'node:crypto';
import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(256);
const prose = z.string().trim().min(1).max(2_000);
const number = z.number().finite();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const LIMIT = 256 * 1024;
const ALGORITHM = 'sha256-keyed-numeric-points/v1';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function bounded(value, label) {
  if (Buffer.byteLength(JSON.stringify(value)) > LIMIT) throw new Error(`${label} exceeds ${LIMIT} UTF-8 bytes.`);
}
function unique(values, ctx, path, label) {
  if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path, message: `${label} must be unique.` });
}

export const trajectoryDefinitionSchema = z.object({
  targetKind: z.enum(['event', 'life']),
  subjectId: id,
  brief: z.string().trim().min(1).max(10_000),
  context: z.string().max(12_000).default(''),
  constraints: z.array(prose).max(50).default([]),
  timeUnit: id,
  axes: z.array(z.object({
    id, meaning: prose, comparisonQuestion: prose, unit: id,
    minimum: number, maximum: number,
  }).strict()).min(1).max(12),
  allocations: z.array(z.object({
    id, question: prose, axisIds: z.array(id).min(2).max(12), total: number.positive(),
  }).strict()).max(6).default([]),
}).strict().superRefine((definition, ctx) => {
  unique(definition.axes.map((axis) => axis.id), ctx, ['axes'], 'Axis IDs');
  unique(definition.allocations.map((group) => group.id), ctx, ['allocations'], 'Allocation IDs');
  definition.axes.forEach((axis, index) => {
    if (axis.maximum < axis.minimum || !Number.isFinite(axis.maximum - axis.minimum)) {
      ctx.addIssue({ code: 'custom', path: ['axes', index], message: 'Axis bounds require a finite nonnegative span.' });
    }
  });
  const grouped = new Set();
  definition.allocations.forEach((group, index) => {
    const path = ['allocations', index];
    unique(group.axisIds, ctx, path, 'Allocation axis IDs');
    const axes = group.axisIds.map((axisId) => definition.axes.find((axis) => axis.id === axisId));
    if (axes.some((axis) => !axis || axis.minimum !== 0 || axis.maximum !== group.total)
      || new Set(axes.filter(Boolean).map((axis) => axis.unit)).size !== 1) {
      ctx.addIssue({ code: 'custom', path, message: 'Allocation axes must exist, share a unit, and each have bounds 0..total.' });
    }
    for (const axisId of group.axisIds) {
      if (grouped.has(axisId)) ctx.addIssue({ code: 'custom', path, message: 'Allocation groups must not overlap.' });
      grouped.add(axisId);
    }
  });
});

const pointSchema = z.object({
  id, at: number, label: id,
  values: z.record(id, number),
  fixed: z.array(id).max(12).default([]),
}).strict();
const pointsSchema = z.array(pointSchema).min(2).max(16);

function checkPoints(definition, points, ctx, prefix = ['points']) {
  unique(points.map((point) => point.id), ctx, prefix, 'Point IDs');
  if (definition.targetKind === 'life' && points.length < 3) ctx.addIssue({
    code: 'custom', path: prefix, message: 'A life candidate requires at least three coarse lifetime points.',
  });
  const axes = new Map(definition.axes.map((axis) => [axis.id, axis]));
  points.forEach((point, index) => {
    const path = [...prefix, index];
    if (index > 0 && point.at <= points[index - 1].at) ctx.addIssue({
      code: 'custom', path, message: 'Trajectory points must be strictly chronological.',
    });
    if (Object.keys(point.values).length !== axes.size || [...axes.keys()].some((axisId) => !(axisId in point.values))) {
      ctx.addIssue({ code: 'custom', path, message: 'Every point requires exactly one numerical value for every axis.' });
    }
    for (const [axisId, value] of Object.entries(point.values)) {
      const axis = axes.get(axisId);
      if (!axis || value < axis.minimum || value > axis.maximum) ctx.addIssue({
        code: 'custom', path: [...path, 'values', axisId], message: 'Point value must address an axis and lie within its bounds.',
      });
    }
    unique(point.fixed, ctx, [...path, 'fixed'], 'Fixed axis IDs');
    if (point.fixed.some((axisId) => !axes.has(axisId))) ctx.addIssue({
      code: 'custom', path: [...path, 'fixed'], message: 'Fixed values must name defined axes.',
    });
    for (const group of definition.allocations) {
      const sum = group.axisIds.reduce((total, axisId) => total + point.values[axisId], 0);
      if (!Number.isFinite(sum) || Math.abs(sum - group.total) > 1e-10 * Math.max(1, group.total)) ctx.addIssue({
        code: 'custom', path: [...path, 'values'], message: `Allocation ${group.id} must sum to its declared total.`,
      });
    }
  });
}

export const trajectoryExploreSchema = z.object({
  definition: trajectoryDefinitionSchema,
  points: pointsSchema,
  randomness: number.min(0).max(1).default(0.5),
  candidateCount: z.number().int().min(1).max(8).default(3),
  seed: id.nullable().default(null),
}).strict().superRefine((input, ctx) => checkPoints(input.definition, input.points, ctx));

const editSchema = z.object({ pointId: id, axisId: id, value: number, reason: prose }).strict();
const candidateSchema = z.object({
  id, points: pointsSchema,
  sampling: z.object({ algorithm: z.literal(ALGORITHM), seed: id, randomness: number.min(0).max(1),
    index: z.number().int().min(0).max(8) }).strict(),
  revision: z.object({
    number: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    parentCandidateHash: hash.nullable(), reason: prose.nullable(),
    changes: z.array(editSchema.extend({ previousValue: number })).max(192),
  }).strict(),
  candidateHash: hash,
}).strict();

function candidateHash(definition, candidate) {
  const { candidateHash: ignored, ...body } = candidate;
  return digest({ definition, candidate: body });
}
export const trajectoryProposalSchema = z.object({
  definition: trajectoryDefinitionSchema, candidate: candidateSchema,
}).strict().superRefine(({ definition, candidate }, ctx) => {
  checkPoints(definition, candidate.points, ctx, ['candidate', 'points']);
  if (candidateHash(definition, candidate) !== candidate.candidateHash) ctx.addIssue({
    code: 'custom', path: ['candidate', 'candidateHash'], message: 'Candidate hash changed; use the exact original numerical proposal.',
  });
});

export const trajectoryReviseSchema = z.object({
  proposal: trajectoryProposalSchema,
  reason: prose,
  changes: z.array(editSchema).max(192).default([]),
}).strict();

export const trajectoryInstructions = `${storyScopeInstructions}

You are the calling LLM. These are numerical candidate points for an event or an overall life, not an accepted character, calibrated prediction, or executed physical simulation. The axes specify the categories, comparison questions, units, and bounds; allocation groups preserve a declared divided total, including a remainder category when needed. If the categories do not express a relevant distinction, explicitly revise the definition rather than replacing numerical modeling with vague labels.
Interpret each candidate and ask: Does this trajectory make sense for this character and setting? What events, choices, pressures, and continuities could connect these points? Would that development offer a compelling story for the intended tone and audience, and why? Separate coherence from literary promise. Curiosity, atmosphere, discovery, humor and quiet relationships can be compelling; do not impose trauma, constant shocks, redemption, or a predetermined death.
For principal characters, review flaws explicitly: what limitation, mistaken belief, costly habit, avoidance or conflicting priority can distort a choice, and what consequence follows? Locate it in the numerical categories and trajectory, then explain how it would appear in behavior. A strength used in the wrong circumstances can supply this tension. Suffering, bad luck, low numerical values or a random discontinuity are not by themselves character flaws. Preserve competence and sympathetic qualities; do not manufacture cruelty or trauma. If the flaw exists only in the biography, locally revise a choice or consequence and reassess. Random sampling suggests material; it does not replace this review.
Review candidates as keep, revise, or discard with a concise authored assessment. When a character has promise, first consider a local repair: change an unsupported point, transition, explanation, or category while preserving identity and the useful remainder of the life. Use life_story_trajectory_revise for numerical point changes, with the exact proposal and reasons. It preserves every unlisted value and refuses changes to fixed values. A reason-only revision with no changes records a revised causal interpretation without moving the numbers. A changed category, scale, timeline, or accepted fact requires an explicit new proposal or model revision; never silently reinterpret the old numbers. Discard the whole candidate only when retaining it is not useful. Reassess the affected trajectory after a revision; bounded exploration does not guarantee a worthwhile candidate.
Whole-life points should span the relevant lifetime, not several moments of the immediate crisis. Distinguish the emotional state at a sampled event from a sustained disposition or period average: a moment of fear does not imply decades of fear. Model anticipation, disruption and adaptation where relevant without requiring a three-beat sequence. Unknown and future life remain hypothetical; do not supply a death merely to close the interval. The expected baseline is an authored starting proposal, not an established fact unless marked fixed and justified. Supplied constraints and fixed declarations are not independently checked against an external canon by this sampler.
Preserve original samples and local revisions. Record concise candidate assessments, selection decisions, and revision reasons as Understanding Nodes using the existing narrative graph: a named author understanding-process root, externalized_reflection children with holder, nonempty access scopes, render/training exclude, and a declared authoring clock distinct from story time. Use typed contains ancestry and about, supports, contradicts, or refines links to the exact candidate records or model anchors; shaped-by can connect subsequent prose. These are authored explanations for the record, not a request for hidden internal reasoning. Ordinary metadata notes alone do not establish that understanding history.
After selection, represent the chosen numerical commitments in the ordinary model under their declared units and Cuts, preserving existing accepted facts. The life-trend dossier can retain a trajectoryProposal and trajectoryRecordNodeId alongside phase and transition explanations; it must not replace the sampled numbers with prose alone. Keep raw proposals separate from accepted history. The MCP exploration and revision tools persist authoring records without accepting them as world facts. Record additional assessments and decisions through life_story_author_record. Use explicit model/narrative operations to adopt the selected commitments. Do not claim to have performed evaluations or accepted a character merely because this tool returned instructions.`;

// Address-keyed draws keep unrelated points stable during seeded comparisons.
function uniform(seed, ...address) {
  const bytes = createHash('sha256').update(JSON.stringify([ALGORITHM, seed, ...address])).digest();
  return (bytes.readUIntBE(0, 6) + 0.5) / 2 ** 48;
}

function samplePoints(definition, baseline, seed, index, randomness) {
  const points = structuredClone(baseline);
  if (randomness === 0) return points;
  const grouped = new Set(definition.allocations.flatMap((group) => group.axisIds));
  for (const point of points) {
    for (const axis of definition.axes) {
      if (point.fixed.includes(axis.id) || grouped.has(axis.id)) continue;
      const draw = axis.minimum + uniform(seed, index, point.id, 'axis', axis.id) * (axis.maximum - axis.minimum);
      point.values[axis.id] = (1 - randomness) * point.values[axis.id] + randomness * draw;
    }
    for (const group of definition.allocations) {
      const free = group.axisIds.filter((axisId) => !point.fixed.includes(axisId));
      if (free.length === 0) continue;
      const fixed = group.axisIds.filter((axisId) => point.fixed.includes(axisId))
        .reduce((sum, axisId) => sum + point.values[axisId], 0);
      const remaining = Math.max(0, group.total - fixed);
      const weights = free.map((axisId) => -Math.log(uniform(seed, index, point.id, 'allocation', group.id, axisId)));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let allocated = 0;
      free.forEach((axisId, i) => {
        const value = i === free.length - 1 ? Math.max(0, remaining - allocated)
          : (1 - randomness) * point.values[axisId] + randomness * remaining * weights[i] / totalWeight;
        point.values[axisId] = value;
        allocated += value;
      });
    }
  }
  return points;
}

const boundaries = { evidenceType: 'creative_hypothesis', canonical: false, authorOnly: true,
  contextCompletenessVerified: false, semanticVerification: false, graphMutation: false, worldMutation: false };

export function prepareTrajectoryExplore(raw) {
  bounded(raw, 'Trajectory exploration input');
  const input = trajectoryExploreSchema.parse(raw);
  const seed = input.seed ?? randomBytes(24).toString('hex');
  const makeCandidate = (index, randomness) => {
    const candidate = { id: index === 0 ? 'baseline' : `candidate.${index}`,
      points: samplePoints(input.definition, input.points, seed, index, randomness),
      sampling: { algorithm: ALGORITHM, seed, randomness, index },
      revision: { number: 0, parentCandidateHash: null, reason: null, changes: [] } };
    candidate.candidateHash = candidateHash(input.definition, candidate);
    return trajectoryProposalSchema.parse({ definition: input.definition, candidate }).candidate;
  };
  const task = { schema: 'meaning-model-story-trajectory-exploration/v1', definition: input.definition,
    sampling: { algorithm: ALGORITHM, seed, source: input.seed === null ? 'random' : 'caller_supplied',
      randomness: input.randomness, candidateCount: input.candidateCount,
      rule: 'Scalar proposals are uniform in bounds; allocation proposals are uniform over the free simplex. Mix each with the baseline by randomness. Fixed values stay unchanged. No transition law or interpolation is inferred.' },
    baseline: makeCandidate(0, 0), candidates: Array.from({ length: input.candidateCount }, (_, i) => makeCandidate(i + 1, input.randomness)),
    reviewerInstructions: trajectoryInstructions,
    responseGuidance: 'Give each candidate a concise keep/revise/discard assessment. Prefer an identified local repair when useful; retain both the original and revised values and authored reasons before accepting a life or event.',
    evaluator: 'calling_llm', assessments: null, ...boundaries };
  bounded(task, 'Trajectory exploration task');
  return { ...task, taskHash: digest(task) };
}

export function reviseTrajectory(raw) {
  bounded(raw, 'Trajectory revision input');
  const input = trajectoryReviseSchema.parse(raw);
  const { definition, candidate: previous } = input.proposal;
  if (previous.revision.number === Number.MAX_SAFE_INTEGER) throw new Error('Trajectory revision number is exhausted.');
  const candidate = structuredClone(previous);
  const seen = new Set();
  const changes = input.changes.map((edit) => {
    const key = JSON.stringify([edit.pointId, edit.axisId]);
    if (seen.has(key)) throw new Error('Each numerical point/axis may be revised only once in a batch.');
    seen.add(key);
    const point = candidate.points.find((item) => item.id === edit.pointId);
    if (!point || !Object.hasOwn(point.values, edit.axisId)) throw new Error('Revision names an unknown point or axis.');
    if (point.fixed.includes(edit.axisId)) throw new Error('A fixed value cannot be changed by trajectory exploration; revise the accepted model explicitly if justified.');
    const previousValue = point.values[edit.axisId];
    point.values[edit.axisId] = edit.value;
    return { ...edit, previousValue };
  });
  candidate.revision = { number: previous.revision.number + 1,
    parentCandidateHash: previous.candidateHash, reason: input.reason, changes };
  candidate.candidateHash = candidateHash(definition, candidate);
  const proposal = trajectoryProposalSchema.parse({ definition, candidate });
  const result = { schema: 'meaning-model-story-trajectory-revision/v1', ...proposal,
    sourceCandidateHash: previous.candidateHash,
    reviewerInstructions: trajectoryInstructions,
    nextStep: 'Reassess the affected points and causal transitions. Record this local revision and its concise rationale as Understanding Nodes linked to the original proposal; this edit does not accept or store either candidate.',
    evaluator: 'calling_llm', assessment: null, ...boundaries };
  bounded(result, 'Trajectory revision result');
  return result;
}
