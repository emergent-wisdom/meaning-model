import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { authorModelSchema, authorModelSourceIds, validateAuthorModelSources } from './storytelling-author-model.mjs';
import { trajectoryExploreSchema, trajectoryReviseSchema, prepareTrajectoryExplore, reviseTrajectory } from './storytelling-trajectories.mjs';

const id = z.string().trim().min(1).max(256);
const prose = z.string().min(1).max(64_000).refine((text) => text.trim().length > 0, 'Authored text must not be blank.');
export const authorRecordContextSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u), requestId: id, nodeId: id,
  storyRootId: id, authorId: id,
  accessScopes: z.array(id).min(1).max(64),
}).strict();
export const authorRecordSchema = authorRecordContextSchema.extend({
  kind: z.enum(['candidate', 'draft', 'assessment', 'selection', 'revision', 'disclosure', 'context', 'author_model']),
  text: prose,
  data: z.json().optional(),
  links: z.array(z.object({
    relation: z.enum(['about', 'supports', 'contradicts', 'refines', 'answers', 'learned_from', 'supersedes', 'shaped_by']),
    targetNodeId: id,
  }).strict()).max(128).default([]),
}).strict().superRefine((record, context) => {
  if (record.kind !== 'author_model') return;
  const parsed = authorModelSchema.safeParse(record.data);
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ['data', ...issue.path] });
});
export const storedTrajectoryExploreSchema = z.object({
  record: authorRecordContextSchema, exploration: trajectoryExploreSchema,
}).strict();
export const storedTrajectoryReviseSchema = z.object({
  record: authorRecordContextSchema,
  sourceNodeId: id,
  candidateId: id,
  reason: trajectoryReviseSchema.shape.reason,
  changes: trajectoryReviseSchema.shape.changes,
}).strict();

export const graphAuthoringInstructions = `Keep the complete authoring record inside Meaning Model. Once the initial brief and human involvement are settled, store them through life_story_author_record with explicit author-only scopes (context for the brief, selection for the agreement); record later changes with supersedes links. Distinguish human decisions from LLM choices made under delegation. The narrative graph is authoritative for story text, draft alternatives, numerical proposals, seed draws and naming alternatives, assessments, selection decisions, revision reasons, context and disclosure plans. Create the model and story graph before developing them. Files, chat summaries and PDFs are exports, never a parallel source of story facts or decisions.
Use life_story_author_record to save draft/seed alternatives and author-process material, and concise assessments or decisions as actual Understanding Nodes. Save the exact task and result in data when reviewing or exploring; link the result to the relevant candidate, draft or passage. Use the current graphHash returned by each write. Reuse/query those graph records as context; do not continue from an unrecorded external plan. The author understanding root and its authoring_step clock are distinct from world time and reader order. Record authored explanations, not hidden internal reasoning.
When a scene contains independently changeable beats, images, exchanges or paragraphs, pass ordered passages to scene review and commit. Their exact blank-line join is the stored draft; review binds their IDs and text as well as the whole scene. Keep naturally coupled prose together; there is no quota. Use the shared life_narrative_edit operation for later splitting, merging, movement, reordering and local text replacement. Preserve the returned predecessor identity, inspect affected review IDs, and review the newly rendered scene and its context after substantive changes; existing review text does not certify a changed passage.
life_story_trajectory_explore and life_story_trajectory_revise persist their numerical results directly; revise reads an existing graph record and preserves its predecessor. Then record your keep/revise/discard assessment with life_story_author_record. A promising character should usually receive the smallest useful repair, preserving identity and unaffected points. Keep proposals distinct from accepted model facts. Store scene drafts before review, including rejected alternatives; scene_commit stores the reviewed story text. Record purpose-review outcomes and deliberate suspense/disclosure processes in the graph. After narrative revision, update the graph and export the rendered text again; never patch the exported manuscript independently. Tool validation checks structure and references, not whether every unwritten thought was recorded or every literary judgment is correct.`;

function bounded(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new Error('Author record exceeds 512 KiB.');
}
export async function readAuthorGraph(service, record) {
  const view = await service.queryNarrativeGraph({ graphHash: record.graphHash,
    expectedGraphHash: record.graphHash, mode: 'full', includeContent: true,
    accessScopes: [...new Set(record.accessScopes)].sort() });
  if (view.graph_hash !== record.graphHash || !view.content_included) throw new Error('Authoring requires the exact graph with content.');
  const source = view.graph.source_snapshot;
  if (source.source_kind === 'candidate' && source.candidate_status !== 'committed') throw new Error('Authoring requires a model, world or committed-candidate source.');
  if (!view.nodes.some((node) => node.id === record.storyRootId && node.role === 'document_root')) {
    throw new Error('Authoring story root is unknown, inaccessible or not a document root.');
  }
  return view;
}

// Uses only the existing immutable narrative graph; no side store or new world semantics.
export async function prepareAuthorRecord(service, raw) {
  bounded(raw);
  const input = authorRecordSchema.parse(raw);
  const view = await readAuthorGraph(service, input);
  const authorModel = input.kind === 'author_model' ? authorModelSchema.parse(input.data) : null;
  if (authorModel) {
    validateAuthorModelSources(view, authorModel);
    input.data = authorModel;
    for (const sourceNodeId of authorModelSourceIds(authorModel)) {
      if (!input.links.some((link) => link.relation === 'learned_from' && link.targetNodeId === sourceNodeId)) {
        input.links.push({ relation: 'learned_from', targetNodeId: sourceNodeId });
      }
    }
  }
  if (input.links.length > 128) throw new Error('Author record links and cited evidence exceed 128 targets.');
  const rootId = `story.understanding.${createHash('sha256').update(input.storyRootId).digest('hex').slice(0, 24)}`;
  const root = view.nodes.find((node) => node.id === rootId);
  if (root && (root.node_type !== 'understanding_process_root' || root.subject !== input.storyRootId
    || root.render !== 'exclude' || root.training !== 'exclude')) throw new Error('Author understanding root has incompatible semantics.');
  if (input.nodeId === rootId || view.nodes.some((node) => node.id === input.nodeId)) throw new Error('Author record already exists; use a new node ID for an explicit revision.');
  const targets = [...new Set([input.storyRootId, ...input.links.map((link) => link.targetNodeId), ...(root ? [rootId] : [])])];
  let scopes = [...new Set(input.accessScopes)].sort();
  for (const targetId of targets) {
    const target = view.nodes.find((node) => node.id === targetId);
    if (!target) throw new Error(`Author record target is unknown or inaccessible: ${targetId}.`);
    if (target.access_scopes?.length) scopes = scopes.filter((scope) => target.access_scopes.includes(scope));
  }
  if (!scopes.length) throw new Error('Author record and targets require a common explicit access scope.');
  // Revision metadata is not scope-filtered. Counting visible children could
  // reuse the order of a hidden assessment and make a valid write fail.
  const step = view.graph.revision?.number;
  if (!Number.isSafeInteger(step) || step < 0) throw new Error('Authoring requires a safe graph-revision clock.');
  const provenance = ['Meaning Model storytelling add-on v1', `author:${input.authorId}`, 'Authoring clock: authoring_step, not world time.'];
  const common = { authority: { source: input.authorId, weight: 1 }, uncertainty: { kind: 'unknown' },
    access_scopes: scopes, render: 'exclude', training: 'exclude', provenance };
  const payload = { schema: 'meaning-model-story-author-record/v1', kind: input.kind,
    text: input.text, ...(input.data === undefined ? {} : { data: input.data }),
    authoringClock: { rootId, unit: 'authoring_step', at: step } };
  const reflection = ['assessment', 'selection', 'revision', 'disclosure'].includes(input.kind);
  const nodes = [{ ...common, id: input.nodeId, node_type: `storytelling.${input.kind}`,
    role: reflection ? 'externalized_reflection' : 'metadata', text: JSON.stringify(payload),
    epistemic_status: 'authored_proposal', evidence_type: 'creative_hypothesis',
    holder: input.authorId, subject: input.storyRootId, value_time: step }];
  if (!root) nodes.unshift({ ...common, id: rootId, node_type: 'understanding_process_root', role: 'metadata',
    title: `Author understanding for ${input.storyRootId}`, subject: input.storyRootId,
    text: JSON.stringify({ name: `Author understanding for ${input.storyRootId}`, clock: 'authoring_step',
      purpose: 'Development, evaluation, selection and revision of this story; separate from its world chronology.' }),
    epistemic_status: 'authored_process', evidence_type: 'creative_hypothesis' });
  const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
  const edge = (suffix, source, target, family, relation, extra = {}) => ({
    id: `${input.nodeId}.${suffix}`, source: endpoint(source), target: endpoint(target),
    family, relation, access_scopes: scopes, provenance, ...extra });
  const edges = [edge('placement', rootId, input.nodeId, 'structural', 'contains', { order: step }),
    edge('story', input.nodeId, input.storyRootId, 'semantic', 'about'),
    ...input.links.map((link, index) => edge(`link.${index}`, input.nodeId, link.targetNodeId, 'semantic', link.relation))];
  return { input, narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash,
      reason: `Record ${input.kind} ${input.nodeId}.`, provenance,
      add_roots: root ? [] : [rootId], add_nodes: nodes, add_edges: edges },
    receipt: { recordNodeId: input.nodeId, ...(authorModel ? { authorModelNodeId: input.nodeId } : {}), understandingRootId: rootId, authoringStep: step,
      understandingNode: reflection, graphMutation: true, worldMutation: false, semanticVerification: false } };
}

export async function storeAuthorRecord(service, raw) {
  const { input, narrativeBatch, receipt } = await prepareAuthorRecord(service, raw);
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId,
    previousGraphHash: input.graphHash, narrativeBatch });
  return { ...stored, ...receipt };
}

export async function exploreStoredTrajectory(service, raw) {
  bounded(raw);
  const input = storedTrajectoryExploreSchema.parse(raw);
  // A request-bound seed keeps retries stable; a new request ID draws new points.
  const seed = input.exploration.seed ?? createHash('sha256').update(JSON.stringify([
    'story-trajectory-request/v1', input.record.graphHash, input.record.requestId, input.record.nodeId,
  ])).digest('hex');
  const task = prepareTrajectoryExplore({ ...input.exploration, seed });
  const receipt = await storeAuthorRecord(service, { ...input.record, kind: 'candidate',
    text: 'Numerical trajectory alternatives, unaccepted and awaiting authored assessment.', data: task });
  return { ...task, ...receipt, seedSource: input.exploration.seed === null ? 'request_derived' : 'caller_supplied',
    nextStep: 'Assess the stored candidates through life_story_author_record, linked about this record. Keep, locally revise, or discard; no automatic acceptance.' };
}

export async function reviseStoredTrajectory(service, raw) {
  bounded(raw);
  const input = storedTrajectoryReviseSchema.parse(raw);
  const view = await readAuthorGraph(service, input.record);
  const node = view.nodes.find((item) => item.id === input.sourceNodeId);
  if (!node || node.subject !== input.record.storyRootId || !['storytelling.candidate', 'storytelling.revision'].includes(node.node_type)) {
    throw new Error('Trajectory source must be an accessible stored candidate or revision for this story.');
  }
  let data;
  try { data = JSON.parse(node.text).data; } catch { throw new Error('Invalid stored trajectory record.'); }
  const candidates = data?.schema === 'meaning-model-story-trajectory-exploration/v1' ? [data.baseline, ...data.candidates]
    : data?.schema === 'meaning-model-story-trajectory-revision/v1' ? [data.candidate] : [];
  const candidate = candidates.find((item) => item.id === input.candidateId);
  if (!candidate) throw new Error('Candidate ID is not in the stored trajectory record.');
  const task = reviseTrajectory({ proposal: { definition: data.definition, candidate }, reason: input.reason, changes: input.changes });
  const receipt = await storeAuthorRecord(service, { ...input.record, kind: 'revision', text: input.reason,
    data: task, links: [{ relation: 'refines', targetNodeId: input.sourceNodeId }] });
  return { ...task, ...receipt, nextStep: 'Reassess this stored local revision and record the decision linked to this node. Original values remain in the predecessor graph record.' };
}
