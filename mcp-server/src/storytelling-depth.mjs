import { storyScopeInstructions } from './storytelling-intake.mjs';
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { prepareAuthorRecord, readAuthorGraph } from './storytelling-authoring.mjs';
import { lifeTrendsSchema, verifyLifeTrajectoryRecords } from './storytelling-life-trends.mjs';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const prose = z.string().trim().min(1).max(4_000);
const pointer = z.string().max(2_000).refine((path) => (path === '' || path.startsWith('/')) && !/~[^01]|~$/u.test(path), 'Use an RFC 6901 JSON Pointer.');
export const modelDepthPrepareSchema = z.object({
  graphHash: hash, storyRootId: id, lifeTrendsNodeId: id,
  focusNodeId: id.describe('Stored outline or plan identifying the consequential choices and outcomes being reviewed; may be the story root if its text supplies this.'),
  contextNodeIds: z.array(id).max(100).default([]),
  accessScopes: z.array(id).min(1).max(64),
}).strict();
const evidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), nodeId: id }).strict(),
  z.object({ kind: z.literal('model'), path: pointer }).strict(),
]);
const findingSchema = z.object({
  subject: prose,
  status: z.enum(['sufficient', 'needs_opening', 'unclear']),
  explanation: prose,
  evidence: z.array(evidenceSchema).min(1).max(32),
  smallestRepair: prose.nullable().default(null),
}).strict().superRefine((finding, ctx) => {
  if (finding.status !== 'sufficient' && finding.smallestRepair === null) ctx.addIssue({
    code: 'custom', path: ['smallestRepair'], message: 'Identify the smallest useful opening or evidence needed to resolve this gap.',
  });
});
export const modelDepthRecordSchema = z.object({
  preparation: modelDepthPrepareSchema, expectedTaskHash: hash,
  requestId: id, nodeId: id, reviewer: id,
  coverage: prose.describe('Explain which consequential choices/outcomes and relevant domains were examined; justify why other detail is unnecessary.'),
  findings: z.array(findingSchema).min(1).max(64),
}).strict();
const locatorSchema = modelDepthPrepareSchema.omit({ graphHash: true, accessScopes: true });
const storedSchema = z.object({
  schema: z.literal('meaning-model-story-model-depth-assessment/v1'),
  locator: locatorSchema, basisHash: hash, sourceSnapshotHash: hash, modelHash: hash,
  reviewedGraphHash: hash,
  taskHash: hash, coverage: prose, findings: z.array(findingSchema).min(1).max(64),
  semanticVerification: z.literal(false),
}).strict();

export const modelDepthInstructions = `${storyScopeInstructions}

Automatically review model depth before writing prose and after consequential changes to lives, mechanisms, institutions, causal transitions, outcomes, or disclosure plans. Use life_story_model_depth_review with the current story graph, overall-life dossier, a stored outline/plan as focusNodeId, and the relevant contextNodeIds. Read the actual model bound to this graph; model depth cannot be judged from a synopsis or node count alone.
Ask: Is this model developed enough to explain the consequential choices and outcomes in the planned story? Identify the important explanatory dependencies, then inspect them where relevant: whole-life trends and flaws that affect choices; concepts and what their distinctions mean; physical quantities, capacities and bottlenecks; institutions, incentives and constraints; causal Events, alternatives, anticipation and adaptation; author processes for intentional withholding and later resolution. Choose subjects from this story. These are prompts for attention, not a mandatory taxonomy, fixed list of life processes, decomposition quota, or demand for a shock in every scene.
Include the processes underlying consequential character speech and behavior. Inspect actual model and graph evidence for how relevant experience, learned habits, motives, attention, understanding and expectations produce a choice of words, silence or action in the present relationship and situation. Where emotions, status, anticipation, surprise or adaptation change that response, inspect the causal connection and its limits. A voice adjective, catchphrase or assertion that two characters differ does not explain their conduct. Numerical tendencies need defined meanings and links to the modeled response; a score alone cannot establish it. Do not require a universal voice taxonomy or forced differences: shared language, restraint and situation-dependent variation can be well explained. Keep authorial selection, narrator presentation and the character's own processes distinct, with each speaker's knowledge bounded by the story. When reviewing an existing draft, use its passages to identify the consequential speech and actions requiring explanation; literary recognizability and effectiveness still require a separate actual-prose review and are advisory.
For each reviewed subject, give a concise sufficient, needs_opening, or unclear finding with evidence from actual model records and selected graph nodes. Explain why the existing abstraction is enough, or specify the smallest useful refinement/evidence needed. A name, generic process label, numerical score or plot assertion alone is not an explanation. Numerical categories must have meaningful comparisons and units; authored transitions need causes even when no simulation law is appropriate. Preserve useful abstraction, quiet scenes, ambiguity and distinctive choices. Do not demand extra detail or a flaw on every page. Separate a necessary explanatory repair from an optional artistic preference; this is not a literary grade.
Record coverage and findings with life_story_model_depth_record using the exact taskHash. Findings become an Understanding Node with links to their graph and model evidence. Save gaps honestly rather than marking them sufficient to pass. Repair only the relevant model parts through existing tools, preserve unaffected character/history, then repeat the depth review on the changed basis and re-review affected prose. A new or consequentially changed story plan must be stored and reviewed; do not continue from an external plan. Reuse a sufficient review only while its focus, source, dossier and relevant context remain unchanged and cover the intended scene. Incidental draft or note additions do not require repeating it.
When rebinding a narrative graph to a successor model, use life_narrative_revise to retain earlier depth-assessment nodes as historical records but remove their predecessor-model anchor edges from that successor only. Native model anchors must resolve against the graph's current source. Never retarget an old finding's path to new model values. The immutable predecessor graph and each assessment's reviewedGraphHash/modelHash preserve its exact evidence. Then record a fresh assessment with new anchors; historical assessments cannot authorize scenes against the changed source. Review other affected anchors explicitly under the existing graph revision contract.
The calling LLM supplies the judgment. The server verifies references, recorded coverage, source identity and freshness, not explanatory truth, completeness, hidden reasoning, or literary merit. Use an independent reviewer when available; otherwise identify self-review. Model-definition reads are administrative and not scope-filtered. They describe static structure and initial values, not current values in a frozen world/candidate snapshot; inspect appropriate bound evidence for runtime claims and mark unavailable evidence unclear.`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function bounded(value, label) {
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new Error(`${label} exceeds 512 KiB; select a smaller coherent review focus.`);
}
function locator(input) {
  return { storyRootId: input.storyRootId, lifeTrendsNodeId: input.lifeTrendsNodeId,
    focusNodeId: input.focusNodeId, contextNodeIds: [...new Set(input.contextNodeIds)].sort() };
}

// Hash only the reviewed source and selected evidence, not the graph's changing
// revision or incoming author-review edges. Appending the assessment cannot stale itself.
export function modelDepthBasis(view, rawLocator) {
  const target = locator(locatorSchema.parse(rawLocator));
  const source = view.graph.source_snapshot;
  hash.parse(view.source_snapshot_hash);
  hash.parse(source.model_hash);
  const nodeIds = [...new Set([target.storyRootId, target.lifeTrendsNodeId, target.focusNodeId, ...target.contextNodeIds])].sort();
  const nodes = nodeIds.map((nodeId) => {
    const node = view.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error(`Model-depth evidence is unknown or inaccessible: ${nodeId}.`);
    return node;
  });
  const root = nodes.find((node) => node.id === target.storyRootId);
  if (root.role !== 'document_root') throw new Error('Model-depth review needs the story document root.');
  const life = nodes.find((node) => node.id === target.lifeTrendsNodeId);
  if (life.node_type !== 'storytelling.life_trends' || life.render !== 'exclude') throw new Error('Model-depth review requires a stored life-trends dossier.');
  const dossier = lifeTrendsSchema.parse(JSON.parse(life.text));
  if (dossier.storyRootId !== target.storyRootId) throw new Error('Model-depth dossier belongs to another story.');
  verifyLifeTrajectoryRecords(view, dossier);
  const focus = nodes.find((node) => node.id === target.focusNodeId);
  if (!focus.text?.trim()) throw new Error('Store the intended choices and outcomes in the focus node before reviewing model depth.');
  const selected = new Set(nodeIds);
  const edges = (view.edges ?? []).filter((edge) => edge.source?.kind === 'node' && selected.has(edge.source.node_id)
    && (edge.target?.kind === 'anchor' || (edge.target?.kind === 'node' && selected.has(edge.target.node_id))))
    .sort((a, b) => a.id.localeCompare(b.id));
  const basis = { locator: target, sourceSnapshotHash: view.source_snapshot_hash, modelHash: source.model_hash,
    nodes: nodes.map((node) => ({ nodeId: node.id, hash: digest(node) })), edges: edges.map((edge) => ({ edgeId: edge.id, hash: digest(edge) })) };
  return { basisHash: digest(basis), basis, nodes, edges };
}

export async function prepareModelDepthReview(service, raw) {
  bounded(raw, 'Model-depth request');
  const input = modelDepthPrepareSchema.parse(raw);
  input.accessScopes = [...new Set(input.accessScopes)].sort();
  input.contextNodeIds = [...new Set(input.contextNodeIds)].sort();
  const view = await readAuthorGraph(service, input);
  const evidence = modelDepthBasis(view, locator(input));
  const inspected = await service.inspectModel({ modelHash: evidence.basis.modelHash, includeDefinition: true });
  if (inspected.modelHash !== evidence.basis.modelHash || !inspected.model) throw new Error('Depth review must inspect the exact bound model definition.');
  // Large models retain an explicit full-read route instead of a silent excerpt.
  const included = Buffer.byteLength(JSON.stringify(inspected.model)) <= 128 * 1024;
  const task = { schema: 'meaning-model-story-model-depth-task/v1', preparation: input,
    basisHash: evidence.basisHash, sourceSnapshotHash: view.source_snapshot_hash, modelHash: inspected.modelHash,
    focusNodeId: input.focusNodeId, nodes: evidence.nodes, edges: evidence.edges,
    model: { definition: included ? inspected.model : null, definitionIncluded: included,
      summary: inspected.summary, administrativeRead: true, frozenRuntimeValuesIncluded: false,
      readMore: { tool: 'life_model_inspect', arguments: { modelHash: inspected.modelHash, includeDefinition: true } },
      note: included ? 'Static model definition, including initial values; not a live world query.'
        : 'Full definition exceeds the inline budget. Read the actual model through the supplied tool route and use life_meaning_query to inspect relevant records; this summary is not enough to establish depth.' },
    question: 'Is the model developed enough to explain the consequential choices and outcomes in this story focus?',
    reviewerInstructions: modelDepthInstructions, assessment: null, evaluator: 'calling_llm',
    semanticVerification: false, graphMutation: false, worldMutation: false };
  bounded(task, 'Model-depth task');
  return { ...task, taskHash: digest(task) };
}

function atPointer(value, path) {
  if (path === '') return value;
  let current = value;
  for (const escaped of path.slice(1).split('/')) {
    const key = escaped.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)
      || (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/u.test(key))) throw new Error(`Model-depth evidence path does not exist: ${path}.`);
    current = current[key];
  }
  return current;
}

export async function recordModelDepthReview(service, raw) {
  bounded(raw, 'Model-depth assessment');
  const input = modelDepthRecordSchema.parse(raw);
  const task = await prepareModelDepthReview(service, input.preparation);
  if (task.taskHash !== input.expectedTaskHash) throw new Error('Model-depth task changed; review the intended model and graph again.');
  const inspected = task.model.definition === null
    ? await service.inspectModel({ modelHash: task.modelHash, includeDefinition: true }) : null;
  if (inspected && (inspected.modelHash !== task.modelHash || !inspected.model)) throw new Error('Depth evidence must use the exact bound model.');
  const model = task.model.definition ?? inspected.model;
  const nodeIds = new Set(task.nodes.map((node) => node.id));
  const modelPaths = new Set();
  for (const finding of input.findings) for (const evidence of finding.evidence) {
    if (evidence.kind === 'node') {
      if (!nodeIds.has(evidence.nodeId)) throw new Error('Model-depth finding cites a node outside the reviewed evidence.');
    } else {
      atPointer(model, evidence.path);
      modelPaths.add(evidence.path);
    }
  }
  if (!modelPaths.size) throw new Error('Depth assessment must cite actual model evidence, not only narrative summaries.');
  const data = storedSchema.parse({ schema: 'meaning-model-story-model-depth-assessment/v1',
    locator: locator(task.preparation), basisHash: task.basisHash, sourceSnapshotHash: task.sourceSnapshotHash,
    modelHash: task.modelHash, reviewedGraphHash: task.preparation.graphHash,
    taskHash: task.taskHash, coverage: input.coverage, findings: input.findings, semanticVerification: false });
  const prepared = await prepareAuthorRecord(service, { graphHash: task.preparation.graphHash,
    requestId: input.requestId, nodeId: input.nodeId, storyRootId: task.preparation.storyRootId,
    authorId: input.reviewer, accessScopes: task.preparation.accessScopes, kind: 'assessment',
    text: input.coverage, data,
    links: [...nodeIds].filter((nodeId) => nodeId !== task.preparation.storyRootId).map((targetNodeId) => ({ relation: 'about', targetNodeId })) });
  const assessment = prepared.narrativeBatch.add_nodes.find((node) => node.id === input.nodeId);
  for (const [index, path] of [...modelPaths].sort().entries()) prepared.narrativeBatch.add_edges.push({
    id: `${input.nodeId}.model.${index}`, source: { kind: 'node', node_id: input.nodeId },
    target: { kind: 'anchor', anchor_kind: 'model', anchor_id: task.modelHash, ...(path ? { path } : {}) },
    family: 'grounding', relation: 'about', access_scopes: assessment.access_scopes, provenance: assessment.provenance,
  });
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId,
    previousGraphHash: task.preparation.graphHash, narrativeBatch: prepared.narrativeBatch });
  const ready = input.findings.every((finding) => finding.status === 'sufficient');
  return { ...stored, ...prepared.receipt, modelDepthReviewNodeId: input.nodeId, basisHash: task.basisHash,
    readyForScene: ready, nextStep: ready
      ? 'Use this graphHash and modelDepthReviewNodeId for scene preparation within the reviewed focus. Reassess after consequential changes.'
      : 'The gaps are saved. Make the smallest useful model refinement or gather the missing evidence, then review the changed basis before committing prose.' };
}

export function readModelDepthReview(view, input, lifeTrends) {
  const node = view.nodes.find((item) => item.id === input.modelDepthReviewNodeId);
  if (!node || node.role !== 'externalized_reflection' || node.node_type !== 'storytelling.assessment'
    || node.subject !== lifeTrends.dossier.storyRootId || node.render !== 'exclude' || node.training !== 'exclude') {
    throw new Error('A stored model-depth Understanding Node is required before prose. Use life_story_model_depth_review and life_story_model_depth_record.');
  }
  const data = storedSchema.parse(JSON.parse(node.text).data);
  if (data.locator.storyRootId !== lifeTrends.dossier.storyRootId || data.locator.lifeTrendsNodeId !== input.lifeTrendsNodeId) {
    throw new Error('Model-depth assessment covers a different story or life dossier.');
  }
  const current = modelDepthBasis(view, data.locator);
  if (current.basisHash !== data.basisHash || current.basis.modelHash !== data.modelHash
    || current.basis.sourceSnapshotHash !== data.sourceSnapshotHash) {
    const changed = [];
    if (current.basis.modelHash !== data.modelHash) changed.push(`bound model (${data.modelHash.slice(0, 12)} -> ${current.basis.modelHash.slice(0, 12)})`);
    if (current.basis.sourceSnapshotHash !== data.sourceSnapshotHash) changed.push('frozen source snapshot');
    if (current.basisHash !== data.basisHash) changed.push(`selected story evidence (one or more of ${current.nodes.map((item) => item.id).join(', ')} or their edges changed since ${input.modelDepthReviewNodeId} was recorded)`);
    throw new Error(`Model-depth assessment ${input.modelDepthReviewNodeId} is stale: ${changed.join('; ')}. Run life_story_model_depth_review with the same focus and context and record a new assessment.`);
  }
  const reviewed = new Set(current.nodes.map((item) => item.id));
  if (input.scene.context.some((item) => !reviewed.has(item.nodeId))) throw new Error('Scene context extends beyond the depth review; review the additional explanatory context.');
  const rooted = (view.edges ?? []).some((edge) => edge.family === 'structural' && edge.relation === 'contains'
    && edge.target?.node_id === node.id && view.nodes.some((root) => root.id === edge.source?.node_id
      && root.node_type === 'understanding_process_root' && root.subject === data.locator.storyRootId));
  if (!rooted) throw new Error('Model-depth assessment lacks its author understanding-process root.');
  return { nodeId: node.id, focusNodeId: data.locator.focusNodeId, basisHash: data.basisHash,
    coverage: data.coverage, findings: data.findings, readyForScene: data.findings.every((finding) => finding.status === 'sufficient'),
    semanticVerification: false };
}
