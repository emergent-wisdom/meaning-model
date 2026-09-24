import { trajectoryProposalSchema } from './storytelling-trajectories.mjs';
import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(256);
const prose = z.string().trim().min(1).max(2_000);
const time = z.number().finite();

export const lifeTrendsSchema = z.object({
  schema: z.literal('meaning-model-story-life-trends/v1'),
  storyRootId: id,
  storyInterval: z.object({ start: time, end: time }).strict(),
  characters: z.array(z.object({
    characterId: id.describe('Stable referent ID in the bound Meaning Model; the characters array declares the principal cast.'),
    name: id,
    lifeTimeUnit: id,
    trajectoryProposal: trajectoryProposalSchema.optional(),
    trajectoryRecordNodeId: id.optional(),
    lifeBeginning: time.describe('Birth/emergence, or earliest established life phase when origins are unknown; disclose gaps in situation.'),
    storyEntry: time,
    phases: z.array(z.object({ id, at: time, label: id, situation: prose }).strict()).min(3).max(8),
    trends: z.array(z.object({
      id, dimension: id,
      states: z.array(z.object({ phaseId: id, state: prose }).strict()).min(3).max(8),
      developments: z.array(z.object({ fromPhaseId: id, toPhaseId: id, explanation: prose }).strict()).min(2).max(7),
    }).strict()).min(2).max(8),
    future: z.object({ status: z.enum(['open', 'planned']), outlook: prose }).strict(),
  }).strict()).min(1).max(16),
}).strict().superRefine((dossier, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
  const unique = (values, path, label) => {
    if (new Set(values).size !== values.length) issue(path, `${label} must be unique.`);
  };
  if (dossier.storyInterval.end < dossier.storyInterval.start) issue(['storyInterval'], 'Story interval end must not precede start.');
  unique(dossier.characters.map((item) => item.characterId), ['characters'], 'Character IDs');
  dossier.characters.forEach((character, index) => {
    const path = ['characters', index];
    const phases = character.phases;
    if (Boolean(character.trajectoryProposal) !== Boolean(character.trajectoryRecordNodeId)) {
      issue([...path, 'trajectoryRecordNodeId'], 'Numerical life proposals require their stored graph record ID.');
    }
    if (character.trajectoryProposal) {
      const { definition, candidate } = character.trajectoryProposal;
      if (definition.targetKind !== 'life' || definition.subjectId !== character.characterId || definition.timeUnit !== character.lifeTimeUnit) {
        issue([...path, 'trajectoryProposal'], 'Life proposal must match the character, lifetime target and time unit.');
      }
      if (candidate.points[0].at > character.lifeBeginning || candidate.points.at(-1).at < character.storyEntry) {
        issue([...path, 'trajectoryProposal'], 'Numerical life points must cover lifeBeginning through storyEntry.');
      }
    }
    unique(phases.map((phase) => phase.id), [...path, 'phases'], 'Phase IDs');
    if (phases[0]?.at !== character.lifeBeginning || phases.at(-1)?.at !== character.storyEntry) {
      issue([...path, 'phases'], 'Phases must span lifeBeginning through storyEntry, not only the immediate scene.');
    }
    if (phases.some((phase, i) => i > 0 && phase.at <= phases[i - 1].at)) {
      issue([...path, 'phases'], 'Life phases must be strictly chronological.');
    }
    unique(character.trends.map((trend) => trend.id), [...path, 'trends'], 'Trend IDs');
    unique(character.trends.map((trend) => trend.dimension.toLowerCase()), [...path, 'trends'], 'Trend dimensions');
    character.trends.forEach((trend, trendIndex) => {
      const trendPath = [...path, 'trends', trendIndex];
      const stateIds = trend.states.map((state) => state.phaseId);
      unique(stateIds, [...trendPath, 'states'], 'Trend state phase IDs');
      if (stateIds.length !== phases.length || phases.some((phase) => !stateIds.includes(phase.id))) {
        issue([...trendPath, 'states'], 'Every trend requires exactly one state for every life phase.');
      }
      if (trend.developments.length !== phases.length - 1 || phases.slice(1).some((phase, i) =>
        trend.developments.filter((step) => step.fromPhaseId === phases[i].id && step.toPhaseId === phase.id).length !== 1)) {
        issue([...trendPath, 'developments'], 'Every adjacent phase pair requires exactly one development explanation.');
      }
    });
  });
});

export const lifeTrendsInputSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u),
  requestId: id,
  nodeId: id,
  accessScopes: z.array(id).max(64).default([]),
  dossier: lifeTrendsSchema,
  // A later dossier names the one it replaces, as other records do.
  links: z.array(z.object({
    relation: z.enum(['supersedes', 'refines', 'answers', 'learned_from', 'shaped_by', 'about']),
    targetNodeId: id,
  }).strict()).max(16).default([]),
}).strict();

export const characterConnectionsSchema = z.array(z.object({
  characterId: id,
  trendIds: z.array(id).min(1).max(8),
  connection: prose,
}).strict()).max(16).describe('The calling LLM connects each present or materially affected principal character to their life trends automatically. May be empty only when none participates.');

export const lifeTrendsInstructions = `Within the agreed initial brief and human involvement, automatically model or reuse the principal characters' overall life trends before drafting scenes. This is your responsibility as the calling LLM, not a form for the user to fill or an optional step they must remember to request.
Before assigning new principal character, place, or organization names, automatically call life_story_structure_explore with targetKind name and omit seedWord for a random draw. Supply the story's naming style, language, setting, and existing names in context or constraints. Use the word's sounds or associations to propose fitting names and select one only when that choice is delegated, without forcing literal symbolism. Preserve names already supplied or established unless a change was requested.
When authoring a new event or whole-life trajectory, automatically use life_story_trajectory_explore with numerical axes expressing the relevant meanings, comparison questions and units. Interpret the sampled points, evaluate coherence and story potential, and locally repair promising candidates through life_story_trajectory_revise. Preserve selected numbers as trajectoryProposal with their trajectoryRecordNodeId in the dossier; explanations accompany the numerical model rather than replace it. Reuse adequate established trajectories without randomizing canon. Record assessments, selection and revision reasons as Understanding Nodes with life_story_author_record.
Identify the principal cast from the brief and established model. Each principal's life lives in the story model first: a lifecycle Event over the whole life holding the processes it runs through (the person template, person_scaffold, is one suggestion; processes invented for this person, or subcategories, may understand them better), opened with the model's questions (periods with intervals, shocks as change arcs with their adaptations, the person's own deepest and learned wants, Cuts at the moments that matter). The dossier then summarizes that modeled life: phases following the model's periods from origins to story entry, and trends for what the person wants, expects, relies on and does, with the pressures, shocks, choices and continuities between phases. Summarize the model; do not write a biography the model does not hold. These minima are structural safeguards, not a recipe: choose dimensions and detail that matter for this story. Deepen them when the present scene cannot be explained by the existing account. Stable, cyclical, worsening, and mixed trends are valid; do not impose growth, redemption, or a fixed ending.
Review the principal characters for plausible flaws that affect decisions and consequences: a costly habit, mistaken belief, avoidance, conflicting priorities or a strength overused in the wrong setting. Ground this in numerical distinctions and life developments, preserve competence, and do not equate hardship or low sampled values with a flaw. Record the review and any local repair in the graph.
For consequential changes, model anticipation, the focal change or shock, and adaptation where relevant, using existing Events and the optional change_arc_scaffold rather than inventing a universal shock score. Link the change to the affected life trends: what was expected or feared, what changed, the immediate response, and what subsequently changes or persists. A shock may be positive or negative and need not be unexpected. Adaptation may start before the event, overlap it, fail, or remain unfinished. Do not require three sequential beats or a shock in every scene. Model the intended reader's anticipation, surprise, and adjustment separately as author processes controlling cues, disclosure, and consequences; intended reader experience is not guaranteed actual response.
Reuse established canon. For delegated creative choices, make coherent new authorial choices and identify them as newly authored in the phase situations; do not ask the user to supply routine biographies. If working from an existing story, record unknown periods as unknown instead of fabricating facts. Ask at agreed human approval checkpoints and when an unresolved choice or contradiction genuinely requires the user's intent. Automatic modeling does not authorize adopting creative decisions the human reserved. Future outlooks are open possibilities or author plans, never accomplished events, predictions guaranteed by the model, or automatic character knowledge.
Use existing Meaning Model tools to register stable character referents and a story graph when needed, then call life_story_life_trends to store the typed dossier. Use its returned graphHash and dossierNodeId as lifeTrendsNodeId for life_story_model_depth_review, with the stored story focus and relevant context. Record your depth findings through life_story_model_depth_record, resolve missing explanatory detail, and use the resulting graphHash and modelDepthReviewNodeId for life_story_scene_prepare. Repeat depth review after consequential model or story-context revisions. A new story request should not require the user to separately request this modeling. Before each scene, supply characterConnections explaining how its present or materially affected principal cast continues, challenges, or departs from the relevant trends, including a cause for a departure. A quiet scene may leave those trends implicit. Review the actual prose for cast coverage, longitudinal continuity, and unauthorized disclosure; do not add biography exposition merely to satisfy the model.
Keep the whole dossier in author context. To disclose a particular fact in prose, model it as a separate context node with explicit viewpoint and reader timing. Any deliberate apparent story/model mismatch needs an explicit author process with its concealment or perspective mechanism and intended resolution; it is not permission for an unexplained contradiction.`;

// The generic graph owns persistence, immutable revisions, scopes and anchor validation.
// This add-on validates the additional narrative contract without changing core semantics.
export function readLifeTrends(view, input) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const node = nodes.get(input.lifeTrendsNodeId);
  if (!node || node.node_type !== 'storytelling.life_trends' || node.role !== 'metadata'
    || node.render !== 'exclude' || node.training !== 'exclude') {
    throw new Error('A visible life-trends dossier is required. Automatically develop the principal cast’s overall lives and call life_story_life_trends before preparing scenes.');
  }
  let data;
  try { data = JSON.parse(node.text); } catch { throw new Error('Life-trends dossier must contain valid JSON.'); }
  const dossier = lifeTrendsSchema.parse(data);
  verifyLifeTrajectoryRecords(view, dossier);
  const root = nodes.get(dossier.storyRootId);
  if (!root || root.role !== 'document_root') throw new Error('Life-trends story root is unknown, inaccessible, or not a document root.');
  const edges = view.edges ?? [];
  const nodeLink = (edge, source, target, relation) => edge.source?.kind === 'node'
    && edge.source.node_id === source && edge.target?.kind === 'node'
    && edge.target.node_id === target && edge.relation === relation;
  if (!edges.some((edge) => nodeLink(edge, root.id, node.id, 'life_trends'))) {
    throw new Error('Life-trends dossier must be linked to its declared story root.');
  }
  for (const character of dossier.characters) {
    if (!edges.some((edge) => edge.source?.kind === 'node' && edge.source.node_id === node.id
      && edge.relation === 'models_life_of' && edge.target?.kind === 'anchor'
      && edge.target.anchor_kind === 'referent' && edge.target.anchor_id === character.characterId)) {
      throw new Error(`Life-trends character ${character.characterId} lacks a validated model referent anchor.`);
    }
  }
  const descendants = new Set([root.id]);
  const children = new Map();
  for (const edge of edges) {
    if (edge.family !== 'structural' || edge.relation !== 'contains'
      || edge.source?.kind !== 'node' || edge.target?.kind !== 'node') continue;
    const source = edge.source.node_id;
    if (!children.has(source)) children.set(source, []);
    children.get(source).push(edge.target.node_id);
  }
  for (const parent of descendants) {
    for (const child of children.get(parent) ?? []) if (nodes.has(child)) descendants.add(child);
  }
  if (!descendants.has(input.scene.parentNodeId)) throw new Error('Scene parent is outside the life-trends story root.');
  if (input.scene.worldTime < dossier.storyInterval.start || input.scene.worldTime > dossier.storyInterval.end) {
    throw new Error('Scene worldTime is outside the life-trends story interval; explicitly extend the dossier first.');
  }
  const connections = input.scene.characterConnections;
  if (new Set(connections.map((item) => item.characterId)).size !== connections.length) {
    throw new Error('Scene character connections must be unique.');
  }
  for (const connection of connections) {
    const character = dossier.characters.find((item) => item.characterId === connection.characterId);
    if (!character) throw new Error(`Unknown life-trends character: ${connection.characterId}.`);
    if (new Set(connection.trendIds).size !== connection.trendIds.length) throw new Error('Connected trend IDs must be unique.');
    if (connection.trendIds.some((trendId) => !character.trends.some((trend) => trend.id === trendId))) {
      throw new Error(`Unknown life trend for ${connection.characterId}.`);
    }
  }
  if (dossier.characters.some((character) => character.characterId === input.scene.viewpoint)
    && !connections.some((connection) => connection.characterId === input.scene.viewpoint)) {
    throw new Error('The principal viewpoint character requires a life-trend connection.');
  }
  return { node, dossier, characterConnections: connections };
}

export function verifyLifeTrajectoryRecords(view, dossier) {
  for (const character of dossier.characters) {
    if (!character.trajectoryProposal) continue;
    const node = view.nodes.find((item) => item.id === character.trajectoryRecordNodeId);
    if (!node || node.subject !== dossier.storyRootId || !['storytelling.candidate', 'storytelling.revision'].includes(node.node_type)) {
      throw new Error('Life trajectory requires a visible graph record for this story.');
    }
    let data;
    try { data = JSON.parse(node.text).data; } catch { throw new Error('Invalid life trajectory record.'); }
    const candidates = data?.schema === 'meaning-model-story-trajectory-exploration/v1' ? [data.baseline, ...data.candidates]
      : data?.schema === 'meaning-model-story-trajectory-revision/v1' ? [data.candidate] : [];
    const match = candidates.find((candidate) => candidate.candidateHash === character.trajectoryProposal.candidate.candidateHash);
    if (!match) throw new Error('Dossier numerical trajectory does not match its graph record.');
    trajectoryProposalSchema.parse({ definition: data.definition, candidate: match });
    trajectoryProposalSchema.parse({ definition: character.trajectoryProposal.definition, candidate: match });
  }
}
